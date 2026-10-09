import base64
import hashlib
import hmac
import json
import re
import secrets
import time

from fastapi import Depends, Header, HTTPException

from . import config as C
from . import db

ROLES = ("citizen", "commuter", "worker", "ward_officer", "admin")
STAFF = {"ward_officer": {"ward_officer", "admin"}, "worker": {"worker", "ward_officer", "admin"}, "admin": {"admin"}}


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


def _sign(body):
    return _b64(hmac.new(_secret(), body.encode(), hashlib.sha256).digest())


def issue_token(user_id, hours=24):
    body = _b64(json.dumps({"sub": user_id, "exp": int(time.time()) + hours * 3600}).encode())
    return f"{body}.{_sign(body)}", hours * 3600


def _verify(token):
    try:
        body, sig = token.split(".")
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except ValueError:
        return None
    if not hmac.compare_digest(sig, _sign(body)) or claims["exp"] < time.time():
        return None
    return claims["sub"]


def _hash(code, phone):
    return hashlib.sha256(f"{code}:{phone}:{_secret().decode()}".encode()).hexdigest()


def hash_password(pw):
    salt = secrets.token_bytes(16)
    return f"scrypt${salt.hex()}${hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1).hex()}"


def _password_ok(stored, pw):
    try:
        _, salt, digest = stored.split("$")
    except (AttributeError, ValueError):
        return False
    return hmac.compare_digest(digest, hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex())


def _check_phone(phone, purpose):
    if not re.fullmatch(r"\+91[6-9]\d{9}", phone):
        raise HTTPException(422, "Enter a valid Indian mobile number")
    if purpose == "admin" and phone not in C.ADMIN_PHONES:
        raise HTTPException(403, "This number is not registered as an administrator")
    u = db.one("SELECT role FROM users WHERE phone=?", phone)
    if purpose == "citizen" and u and u["role"] in ("worker", "ward_officer"):
        raise HTTPException(403, "Municipal staff sign in with their Employee ID")


def start_otp(phone, purpose="citizen"):
    _check_phone(phone, purpose)
    t, cur = db.now(), db.one("SELECT * FROM otps WHERE phone=?", phone) or {}
    if cur.get("sent_at", 0) > t - 30:
        raise HTTPException(429, "Please wait 30 seconds before requesting another code")
    sends = cur.get("sends", 0) + 1 if cur.get("sent_at", 0) > t - 3600 else 1
    if sends > 5:
        raise HTTPException(429, "Too many codes requested. Try again in an hour.")
    code = f"{secrets.randbelow(10**6):06d}"
    db.ex("INSERT OR REPLACE INTO otps VALUES (?,?,?,0,?,?)", phone, _hash(code, phone), t + 300, t, sends)
    if C.OTP_DELIVERY == "sns":
        import boto3
        boto3.client("sns", region_name=C.AWS_REGION).publish(
            PhoneNumber=phone, Message=f"{code} is your JalMarg sign-in code. It expires in 5 minutes.",
            MessageAttributes={"AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"}})
    else:
        print(f"[OTP] {phone}: {code}", flush=True)


def verify_otp(phone, code, purpose="citizen"):
    _check_phone(phone, purpose)
    cur = db.one("SELECT * FROM otps WHERE phone=?", phone)
    if not cur or cur["expires"] < db.now():
        raise HTTPException(400, "Code expired. Request a new one.")
    if cur["tries"] >= 5:
        raise HTTPException(429, "Too many wrong attempts. Request a new code.")
    if not hmac.compare_digest(cur["hash"], _hash(code, phone)):
        db.ex("UPDATE otps SET tries=tries+1 WHERE phone=?", phone)
        raise HTTPException(400, "Incorrect code")
    db.ex("DELETE FROM otps WHERE phone=?", phone)
    role = "admin" if phone in C.ADMIN_PHONES else "citizen"
    user = db.one("SELECT * FROM users WHERE phone=?", phone)
    if not user:
        user = db.insert("users", id=db.new_id(), phone=phone, role=role, status="active", created_at=db.now(), last_seen=db.now())
    elif role == "admin" and user["role"] != "admin":
        db.ex("UPDATE users SET role='admin' WHERE id=?", user["id"])
    return _active(db.one("SELECT * FROM users WHERE id=?", user["id"]))


def _active(user):
    if user["status"] != "active":
        raise HTTPException(403, "This account is not active. Contact your municipal administrator.")
    return user


def _password_login(user, pw, wrong):
    t = db.now()
    if not user or not user["password_hash"]:
        raise HTTPException(401, wrong)
    if (user["locked_until"] or 0) > t:
        raise HTTPException(429, f"Too many failed attempts. Try again in {(user['locked_until'] - t) // 60 + 1} min.")
    if not _password_ok(user["password_hash"], pw):
        fails = user["failed_logins"] + 1
        db.ex("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?", fails % 5, t + 900 if fails >= 5 else None, user["id"])
        raise HTTPException(401, wrong)
    db.ex("UPDATE users SET failed_logins=0, locked_until=NULL, last_seen=? WHERE id=?", t, user["id"])
    return _active(user)


def citizen_password_login(phone, pw):
    u = db.one("SELECT * FROM users WHERE phone=? AND role IN ('citizen','commuter')", phone)
    return _password_login(u, pw, "Incorrect mobile number or password")


def staff_login(employee_id, pw):
    u = db.one("SELECT * FROM users WHERE employee_id=? AND role IN ('worker','ward_officer')", employee_id.strip().upper())
    return _password_login(u, pw, "Incorrect Employee ID or password")


def set_password(user, current, new):
    if len(new) < 8 or new.isdigit() or new.isalpha():
        raise HTTPException(422, "Use at least 8 characters with letters and numbers")
    if user["password_hash"] and not user["must_change_password"] and not _password_ok(user["password_hash"], current or ""):
        raise HTTPException(401, "Current password is incorrect")
    db.ex("UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?", hash_password(new), user["id"])


def profile(u):
    return {"id": u["id"], "phone": u["phone"], "role": u["role"], "name": u["name"], "employee_id": u["employee_id"], "ward": u["ward"], "address": u["address"],
            "must_change_password": bool(u["must_change_password"]), "has_password": bool(u["password_hash"])}


def current_user(authorization: str = Header("")):
    uid = _verify(authorization[7:]) if authorization.lower().startswith("bearer ") else None
    user = db.one("SELECT * FROM users WHERE id=?", uid) if uid else None
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


def mask(phone):
    return f"Citizen ••{phone[-2:]}" if phone else "Municipal staff"
