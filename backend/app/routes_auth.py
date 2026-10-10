import base64
import hashlib
import json
import secrets
import time
from urllib.parse import quote, urlencode

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from . import auth, db, mailer
from . import config as C
from .providers.http import client as http

r = APIRouter(prefix="/auth")
SENT = {"ok": True, "message": "If the address can be used, we've sent an email. Check your inbox and spam folder."}


def session(u):
    return {"token": auth.issue_token(u["id"]), "user": auth.profile(u)}


def _safe_next(n):
    return n if isinstance(n, str) and n.startswith("/") and not n.startswith("//") and "\\" not in n and len(n) < 200 else "/"


class Register(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    email: str = Field(max_length=254)
    password: str = Field(max_length=128)


class EmailIn(BaseModel):
    email: str = Field(max_length=254)


class Login(EmailIn):
    password: str = Field(min_length=1, max_length=128)


class TokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class Reset(TokenIn):
    password: str = Field(max_length=128)


class StaffLogin(BaseModel):
    employee_id: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)


def _send_verify(bg, u, pw_hash):
    token = auth.new_email_token(u["id"], "verify", pw_hash)
    bg.add_task(mailer.safe_send, u["email"], "Confirm your JalMarg account", f"Hi {u['name'] or 'there'}, confirm your email to finish creating your "
                "JalMarg account. The link works for 24 hours.", f"{C.APP_URL}/verify-email?token={token}", "Confirm email")


@r.post("/register", status_code=202)
def register(b: Register, bg: BackgroundTasks, request: Request):
    auth.rate_limit(request, "register", 5)
    email = auth.normalize_email(b.email)
    auth.check_new_password(b.password)
    u = db.one("SELECT * FROM users WHERE email=?", email)
    if u and u["email_verified"]:
        bg.add_task(mailer.safe_send, email, "You already have a JalMarg account", "Someone tried to create a JalMarg account with this email. "
                    "You already have one — sign in, or reset your password if you forgot it.", f"{C.APP_URL}/forgot-password", "Reset password")
        return SENT
    if u and u["role"] not in ("citizen", "commuter"):
        return SENT
    if not u:
        u = db.insert("users", id=db.new_id(), email=email, name=b.name.strip(), role="citizen", status="active", created_at=db.now(), email_verified=0)
    else:
        db.ex("UPDATE users SET name=? WHERE id=?", b.name.strip(), u["id"])
        u = db.one("SELECT * FROM users WHERE id=?", u["id"])
    _send_verify(bg, u, auth.hash_password(b.password))
    return SENT


@r.post("/resend-verification", status_code=202)
def resend(b: EmailIn, bg: BackgroundTasks, request: Request):
    auth.rate_limit(request, "email", 5)
    u = db.one("SELECT * FROM users WHERE email=? AND email_verified=0", auth.normalize_email(b.email))
    pending = auth.pending_password(u["id"]) if u else None
    if u and pending:
        try:
            _send_verify(bg, u, pending)
        except HTTPException:
            pass  # throttled; answer the same way so the response reveals nothing
    return SENT


@r.post("/verify-email")
def verify_email(b: TokenIn, request: Request):
    auth.rate_limit(request, "token", 20)
    row = auth.use_email_token(b.token, "verify")
    u = db.one("SELECT * FROM users WHERE id=?", row["user_id"])
    if not u:
        raise HTTPException(400, "This link is invalid or has expired. Request a new one.")
    if not u["email_verified"]:
        db.ex("UPDATE users SET email_verified=1, password_hash=? WHERE id=?", row["data"], u["id"])
        db.ex("UPDATE email_tokens SET expires=0 WHERE user_id=? AND kind='verify'", u["id"])
    return session(auth._active(db.one("SELECT * FROM users WHERE id=?", u["id"])))


@r.post("/login")
def login(b: Login, request: Request):
    auth.rate_limit(request, "login", 20)
    return session(auth.email_login(b.email, b.password))


@r.post("/staff")
def staff_login(b: StaffLogin, request: Request):
    auth.rate_limit(request, "login", 20)
    return session(auth.staff_login(b.employee_id, b.password))


@r.post("/forgot-password", status_code=202)
def forgot(b: EmailIn, bg: BackgroundTasks, request: Request):
    auth.rate_limit(request, "email", 5)
    u = db.one("SELECT * FROM users WHERE email=? AND role IN ('citizen','commuter') AND status='active'", auth.normalize_email(b.email))
    if u:
        try:
            token = auth.new_email_token(u["id"], "reset")
        except HTTPException:
            return SENT  # throttled; answer the same way so the response reveals nothing
        bg.add_task(mailer.safe_send, u["email"], "Reset your JalMarg password", "We received a request to reset your JalMarg password. "
                    "The link works for 30 minutes. If you didn't ask for this, ignore this email.", f"{C.APP_URL}/reset-password?token={token}",
                    "Choose a new password")
    return SENT


@r.post("/reset-password")
def reset(b: Reset, request: Request):
    auth.rate_limit(request, "token", 20)
    auth.check_new_password(b.password)
    row = auth.use_email_token(b.token, "reset")
    db.ex("UPDATE users SET password_hash=?, email_verified=1, failed_logins=0, locked_until=NULL WHERE id=?", auth.hash_password(b.password), row["user_id"])
    auth.end_all_sessions(row["user_id"])
    db.ex("UPDATE email_tokens SET expires=0 WHERE user_id=?", row["user_id"])
    return {"ok": True}


@r.post("/logout")
def logout(authorization: str = Header("")):
    token = auth._bearer(authorization)
    if token:
        auth.end_session(token)
    return {"ok": True}


# ---------- Google sign-in: authorization code flow with PKCE, state and nonce ----------
GOOGLE_AUTH, GOOGLE_TOKEN = "https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token"


def google_enabled():
    return bool(C.GOOGLE_CLIENT_ID and C.GOOGLE_CLIENT_SECRET)


def _back(**frag):
    return RedirectResponse(f"{C.APP_URL}/auth/callback#{urlencode(frag, quote_via=quote)}", status_code=302)


@r.get("/google/start")
def google_start(request: Request, next: str = "/"):
    if not google_enabled():
        raise HTTPException(404, "Google sign-in is not configured")
    auth.rate_limit(request, "google", 20)
    db.ex("DELETE FROM oauth_states WHERE expires<?", db.now())
    state, verifier, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(48), secrets.token_urlsafe(16)
    db.insert("oauth_states", id=auth._sha(state), verifier=json.dumps([verifier, nonce]), next=_safe_next(next), expires=db.now() + 600)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    q = {"client_id": C.GOOGLE_CLIENT_ID, "redirect_uri": C.GOOGLE_REDIRECT_URI, "response_type": "code", "scope": "openid email profile",
         "state": state, "nonce": nonce, "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account"}
    return RedirectResponse(f"{GOOGLE_AUTH}?{urlencode(q)}", status_code=302)


def _claims(id_token):
    try:
        body = id_token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (AttributeError, IndexError, ValueError):
        return {}


def _google_user(c):
    sub, email = str(c.get("sub") or ""), (c.get("email") or "").lower()
    if not sub or not email or c.get("email_verified") not in (True, "true"):
        raise HTTPException(400, "Your Google account has no verified email address")
    u = db.one("SELECT * FROM users WHERE google_sub=?", sub) or db.one("SELECT * FROM users WHERE email=?", email)
    if u and u["role"] not in ("citizen", "commuter"):
        raise HTTPException(403, "This account must sign in with its password")
    if not u:
        u = db.insert("users", id=db.new_id(), email=email, email_verified=1, google_sub=sub, name=(c.get("name") or "")[:60] or None,
                      role="citizen", status="active", created_at=db.now())
    elif not u["google_sub"]:
        # Google proved ownership of the email: drop any password set by an unverified sign-up for it.
        db.ex("UPDATE users SET google_sub=?, email_verified=1, password_hash=CASE WHEN email_verified=1 THEN password_hash END WHERE id=?", sub, u["id"])
        db.ex("UPDATE email_tokens SET expires=0 WHERE user_id=? AND kind='verify'", u["id"])
    return auth._active(db.one("SELECT * FROM users WHERE id=?", u["id"]))


@r.get("/google/callback")
def google_callback(state: str = "", code: str = "", error: str = ""):
    st = db.one("SELECT * FROM oauth_states WHERE id=?", auth._sha(state)) if state else None
    if st:
        db.ex("DELETE FROM oauth_states WHERE id=?", st["id"])
    if not st or st["expires"] < db.now():
        return _back(error="Sign-in expired. Please try again.")
    if error or not code:
        return _back(error="Google sign-in was cancelled.")
    verifier, nonce = json.loads(st["verifier"])
    try:
        res = http.post(GOOGLE_TOKEN, data={"code": code, "client_id": C.GOOGLE_CLIENT_ID, "client_secret": C.GOOGLE_CLIENT_SECRET,
                                            "redirect_uri": C.GOOGLE_REDIRECT_URI, "grant_type": "authorization_code", "code_verifier": verifier})
        tok = res.json() if res.status_code == 200 else {}
    except Exception as e:
        print("google token exchange failed:", type(e).__name__, flush=True)
        tok = {}
    # The ID token comes straight from Google's token endpoint over TLS, so its claims are trusted (OIDC Core 3.1.3.7);
    # issuer, audience, expiry and nonce are still checked.
    c = _claims(tok.get("id_token"))
    if (c.get("iss") not in ("accounts.google.com", "https://accounts.google.com") or c.get("aud") != C.GOOGLE_CLIENT_ID
            or int(c.get("exp") or 0) < time.time() or c.get("nonce") != nonce):
        return _back(error="Google sign-in failed. Please try again.")
    try:
        u = _google_user(c)
    except HTTPException as e:
        return _back(error=e.detail)
    one_time = secrets.token_urlsafe(32)
    db.ex("DELETE FROM login_codes WHERE expires<?", db.now())
    db.insert("login_codes", id=auth._sha(one_time), user_id=u["id"], expires=db.now() + 120)
    return _back(code=one_time, next=st["next"])


@r.post("/google/exchange")
def google_exchange(b: TokenIn, request: Request):
    auth.rate_limit(request, "token", 20)
    row = db.one("SELECT * FROM login_codes WHERE id=?", auth._sha(b.token))
    if row:
        db.ex("DELETE FROM login_codes WHERE id=?", row["id"])
    if not row or row["expires"] < db.now():
        raise HTTPException(400, "Sign-in expired. Please try again.")
    return session(auth._active(db.one("SELECT * FROM users WHERE id=?", row["user_id"])))


__all__ = ["r", "session", "google_enabled"]
