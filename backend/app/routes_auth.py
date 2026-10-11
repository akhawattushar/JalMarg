from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, db, mailer
from . import config as C

r = APIRouter(prefix="/auth")
SENT = {"ok": True, "message": "If the address can be used, we've sent an email. Check your inbox and spam folder."}


def session(u):
    return {"token": auth.issue_token(u["id"]), "user": auth.profile(u)}


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


def _send_verify(bg, u, pw_hash, resend=False):
    token = auth.new_email_token(u["id"], "verify", pw_hash, keep_previous=resend)
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
            _send_verify(bg, u, pending, resend=True)
        except HTTPException:
            pass  # throttled; answer the same way so the response reveals nothing
    return SENT


@r.post("/verify-email")
def verify_email(b: TokenIn, request: Request):
    auth.rate_limit(request, "token", 20)
    seen = db.one("SELECT u.email_verified FROM email_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=? AND t.kind='verify'", auth._sha(b.token))
    if seen and seen["email_verified"]:
        raise HTTPException(409, "Your email is already confirmed. Sign in with your email and password.")
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


__all__ = ["r", "session"]
