import base64
import hashlib
import hmac
import re
import secrets
import time
from collections import defaultdict, deque

from fastapi import Depends, Header, HTTPException, Request

from . import config as C
from . import db

ROLES = ("citizen", "commuter", "worker", "ward_officer", "admin")
STAFF = {"ward_officer": {"ward_officer", "admin"}, "worker": {"worker", "ward_officer", "admin"}, "admin": {"admin"}}
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$")
VERIFY_TTL, RESET_TTL = 24 * 3600, 30 * 60


def _secret():
    if C.AUTH_SECRET:
        return C.AUTH_SECRET.encode()
    p = C.DATA_DIR / "auth_secret"
    if not p.exists():
        C.DATA_DIR.mkdir(parents=True, exist_ok=True)
        p.write_text(secrets.token_hex(32))
    return p.read_text().strip().encode()


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _sha(s):
    return hashlib.sha256(s.encode()).hexdigest()


# ---------- Passwords (scrypt, parameters stored with the hash) ----------
_N, _R, _P = 2**15, 8, 1


def _scrypt(pw, salt, n, r, p):
    return hashlib.scrypt(pw.encode(), salt=salt, n=n, r=r, p=p, maxmem=128 * r * n * 2).hex()


def hash_password(pw):
    salt = secrets.token_bytes(16)
    return f"scrypt${_N}${_R}${_P}${salt.hex()}${_scrypt(pw, salt, _N, _R, _P)}"


def _parse(stored):
    parts = (stored or "").split("$")
    if len(parts) == 6 and parts[0] == "scrypt":
        return int(parts[1]), int(parts[2]), int(parts[3]), bytes.fromhex(parts[4]), parts[5]
    if len(parts) == 3 and parts[0] == "scrypt":  # legacy format, n=2**14
        return 2**14, 8, 1, bytes.fromhex(parts[1]), parts[2]
    raise ValueError("unknown hash format")


def password_ok(stored, pw):
    try:
        n, r, p, salt, digest = _parse(stored)
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, _scrypt(pw, salt, n, r, p))


def _needs_rehash(stored):
    try:
        return _parse(stored)[:3] != (_N, _R, _P)
    except (ValueError, TypeError):
        return False


_DUMMY = None


def _burn(pw):
    """Spend the same time as a real check so unknown accounts can't be told apart by timing."""
    global _DUMMY
    _DUMMY = _DUMMY or hash_password(secrets.token_hex(8))
    password_ok(_DUMMY, pw)


def check_new_password(pw):
    if len(pw) < 8 or len(pw) > 128 or pw.isdigit() or pw.isalpha():
        raise HTTPException(422, "Use 8–128 characters with letters and numbers")


def normalize_email(email):
    email = (email or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address")
    return email


# ---------- Rate limiting (per client IP, in memory) ----------
_hits = defaultdict(deque)


def rate_limit(request: Request, bucket, limit, window=60):
    key, t = (bucket, request.client.host if request.client else "?"), time.time()
    q = _hits[key]
    while q and q[0] < t - window:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Too many attempts. Please wait a minute and try again.")
    q.append(t)


# ---------- Sessions: opaque random tokens, stored hashed, valid until logout ----------
def issue_token(user_id):
    token = secrets.token_urlsafe(32)
    db.insert("sessions", id=_sha(token), user_id=user_id, created_at=db.now())
    return token


def end_session(token):
    db.ex("DELETE FROM sessions WHERE id=?", _sha(token))


def end_all_sessions(user_id, keep=None):
    db.ex("DELETE FROM sessions WHERE user_id=? AND id!=?", user_id, _sha(keep) if keep else "")


def _bearer(authorization):
    return authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""


def current_user(authorization: str = Header("")):
    token = _bearer(authorization)
    s = db.one("SELECT user_id FROM sessions WHERE id=?", _sha(token)) if token else None
    user = db.one("SELECT * FROM users WHERE id=?", s["user_id"]) if s else None
    if user and user["status"] != "active":
        raise HTTPException(403, "This account is no longer active")
    return user


def require_user(user=Depends(current_user)):
    if not user:
        raise HTTPException(401, "Sign in to continue")
    return user


def require(role):
    def dep(user=Depends(require_user)):
        if user["role"] not in STAFF[role]:
            raise HTTPException(403, "You don't have access to this")
        if user["must_change_password"]:
            raise HTTPException(403, "Set a new password before continuing")
        return user
    return dep


# ---------- Signed, short-lived URLs for private files (no session token in URLs) ----------
def sign_file(key, ttl=3600):
    exp = db.now() + ttl
    return f"exp={exp}&sig={_b64(hmac.new(_secret(), f'{key}:{exp}'.encode(), hashlib.sha256).digest())}"


def file_sig_ok(key, exp, sig):
    want = _b64(hmac.new(_secret(), f"{key}:{exp}".encode(), hashlib.sha256).digest())
    return exp >= db.now() and hmac.compare_digest(want, sig or "")


# ---------- Email tokens (verification, password reset): single use, stored hashed ----------
def new_email_token(user_id, kind, data=None, keep_previous=False):
    """keep_previous: a resend leaves earlier links working (same pending data), so clicking an older email still succeeds."""
    t = db.now()
    recent = db.q("SELECT created_at FROM email_tokens WHERE user_id=? AND kind=? AND created_at>? ORDER BY created_at DESC", user_id, kind, t - 3600)
    if recent and recent[0]["created_at"] > t - 60:
        raise HTTPException(429, "An email was just sent. Please wait a minute before asking again.")
    if len(recent) >= 5:
        raise HTTPException(429, "Too many emails requested. Try again in an hour.")
    token = secrets.token_urlsafe(32)
    if not keep_previous:
        db.ex("UPDATE email_tokens SET expires=0 WHERE user_id=? AND kind=?", user_id, kind)
    db.insert("email_tokens", id=_sha(token), user_id=user_id, kind=kind, expires=t + (VERIFY_TTL if kind == "verify" else RESET_TTL), created_at=t,
              data=data)
    return token


def use_email_token(token, kind):
    row = db.one("SELECT * FROM email_tokens WHERE id=? AND kind=?", _sha(token or ""), kind)
    if not row or row["expires"] < db.now():
        raise HTTPException(400, "This link is invalid or has expired. Request a new one.")
    db.ex("UPDATE email_tokens SET expires=0 WHERE id=?", row["id"])
    return row


def pending_password(user_id):
    """Password chosen at registration; applied only once the email owner clicks the verification link."""
    row = db.one("SELECT data FROM email_tokens WHERE user_id=? AND kind='verify' ORDER BY created_at DESC LIMIT 1", user_id)
    return row["data"] if row else None


# ---------- Logins ----------
def _active(user):
    if user["status"] != "active":
        raise HTTPException(403, "This account is not active. Contact your municipal administrator.")
    return user


def _password_login(user, pw, wrong):
    t = db.now()
    if not user or not user["password_hash"]:
        _burn(pw)
        raise HTTPException(401, wrong)
    if (user["locked_until"] or 0) > t:
        raise HTTPException(429, f"Too many failed attempts. Try again in {(user['locked_until'] - t) // 60 + 1} min.")
    if not password_ok(user["password_hash"], pw):
        fails = user["failed_logins"] + 1
        db.ex("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?", fails % 5, t + 900 if fails >= 5 else None, user["id"])
        raise HTTPException(401, wrong)
    db.ex("UPDATE users SET failed_logins=0, locked_until=NULL, last_seen=? WHERE id=?", t, user["id"])
    if _needs_rehash(user["password_hash"]) and user["role"] != "admin":
        db.ex("UPDATE users SET password_hash=? WHERE id=?", hash_password(pw), user["id"])
    return _active(user)


def email_login(email, pw):
    u = db.one("SELECT * FROM users WHERE email=? AND role IN ('citizen','commuter','admin')", email.strip().lower())
    if u and not u["email_verified"]:
        if password_ok(pending_password(u["id"]), pw):
            raise HTTPException(403, {"code": "email_unverified", "message": "Verify your email first. Check your inbox for the link."})
        u = None
    return _password_login(u, pw, "Incorrect email or password")


def staff_login(employee_id, pw):
    u = db.one("SELECT * FROM users WHERE employee_id=? AND role IN ('worker','ward_officer')", employee_id.strip().upper())
    return _password_login(u, pw, "Incorrect Employee ID or password")


def set_password(user, current, new):
    check_new_password(new)
    if user["role"] == "admin":
        raise HTTPException(403, "The administrator password is managed in the server configuration")
    if user["password_hash"] and not user["must_change_password"] and not password_ok(user["password_hash"], current or ""):
        raise HTTPException(401, "Current password is incorrect")
    db.ex("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?", hash_password(new), user["id"])


def _nth(items, i):
    return (items[i] if i < len(items) else "") or None


def bootstrap_admin():
    """Create or update the administrators from ADMIN_EMAIL / ADMIN_PHONE / ADMIN_PASSWORD_HASH (comma-separated, paired by position)."""
    if not C.ADMIN_EMAILS:
        return
    for i, email in enumerate(C.ADMIN_EMAILS):
        pw_hash = _nth(C.ADMIN_PASSWORD_HASHES, i)
        if pw_hash:
            try:
                _parse(pw_hash)
            except (ValueError, TypeError):
                raise RuntimeError(f"ADMIN_PASSWORD_HASH #{i + 1} is not a valid hash. Generate one with: python -m app.hash_password") from None
        else:
            print(f"[auth] No ADMIN_PASSWORD_HASH for {email}; that administrator cannot sign in until one is set.", flush=True)
    with db.tx():
        placeholders = ",".join("?" * len(C.ADMIN_EMAILS))
        db.ex(f"UPDATE users SET role='citizen' WHERE role='admin' AND (email IS NULL OR email NOT IN ({placeholders}))", *C.ADMIN_EMAILS)  # nosec B608
        # Release the admins' phones first so numbers can be swapped between admins without tripping the unique constraint.
        db.ex(f"UPDATE users SET phone=NULL WHERE email IN ({placeholders})", *C.ADMIN_EMAILS)  # nosec B608
        for i, email in enumerate(C.ADMIN_EMAILS):
            pw_hash, phone = _nth(C.ADMIN_PASSWORD_HASHES, i), _nth(C.ADMIN_PHONES, i)
            u = db.one("SELECT * FROM users WHERE email=?", email)
            if phone and db.one("SELECT 1 AS x FROM users WHERE phone=? AND (email IS NULL OR email!=?)", phone, email):
                print(f"[auth] Phone #{i + 1} already belongs to another account; not assigned to {email}.", flush=True)
                phone = u["phone"] if u else None
            if u:
                db.ex("UPDATE users SET role='admin', status='active', email_verified=1, phone=?, password_hash=?, must_change_password=0 WHERE id=?",
                      phone, pw_hash, u["id"])
                if u["password_hash"] != pw_hash:
                    db.ex("DELETE FROM sessions WHERE user_id=?", u["id"])
            else:
                db.insert("users", id=db.new_id(), email=email, email_verified=1, phone=phone, name="Administrator", role="admin", status="active",
                          password_hash=pw_hash, created_at=db.now())


def profile(u):
    return {"id": u["id"], "email": u["email"], "email_verified": bool(u["email_verified"]), "phone": u["phone"], "role": u["role"], "name": u["name"],
            "employee_id": u["employee_id"], "ward": u["ward"], "address": u["address"], "must_change_password": bool(u["must_change_password"]),
            "has_password": bool(u["password_hash"])}


def mask(role, uid):
    """Public label for a person; never exposes email, phone or name."""
    if role in ("worker", "ward_officer", "admin"):
        return "Municipal staff"
    return f"Citizen ••{(uid or '')[-2:].upper()}" if uid else "Citizen"
