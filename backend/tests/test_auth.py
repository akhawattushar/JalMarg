import json
import re

import pytest
from conftest import report, user

from app import auth, db, mailer, routes_auth
from app import config as C


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(mailer, "send", lambda to, subject, text, link=None, button=None: sent.append({"to": to, "subject": subject, "link": link}))
    return sent


def _token(mail):
    return re.search(r"token=([\w-]+)", mail["link"]).group(1)


def h(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_verify_login_logout(client, outbox):
    body = {"name": "Asha Verma", "email": "Asha@Example.com", "password": "monsoon2026"}
    assert client.post("/auth/register", json={**body, "password": "short"}).status_code == 422
    assert client.post("/auth/register", json={**body, "email": "not-an-email"}).status_code == 422
    assert client.post("/auth/register", json=body).status_code == 202
    u = db.one("SELECT * FROM users WHERE email='asha@example.com'")
    assert u["password_hash"] is None and not u["email_verified"]  # nothing usable until the owner clicks the link
    assert "monsoon2026" not in json.dumps(db.q("SELECT * FROM email_tokens"))
    login = {"email": "asha@example.com", "password": "monsoon2026"}
    r = client.post("/auth/login", json=login)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified"
    assert client.post("/auth/login", json={**login, "password": "wrong-pass1"}).status_code == 401

    s = client.post("/auth/verify-email", json={"token": _token(outbox[-1])}).json()
    assert s["user"]["email_verified"] and s["user"]["name"] == "Asha Verma" and s["user"]["has_password"]
    assert client.post("/auth/verify-email", json={"token": _token(outbox[-1])}).status_code == 400  # single use
    assert db.one("SELECT password_hash FROM users WHERE id=?", u["id"])["password_hash"].startswith("scrypt$")

    tok = client.post("/auth/login", json=login).json()["token"]
    assert client.get("/me", headers=h(tok)).json()["email"] == "asha@example.com"
    client.post("/auth/logout", headers=h(tok))
    assert client.get("/me", headers=h(tok)).status_code == 401
    assert client.get("/me", headers=h(s["token"])).status_code == 200  # other device stays signed in


def test_register_does_not_reveal_existing_accounts(client, outbox):
    body = {"name": "Asha", "email": "asha@example.com", "password": "monsoon2026"}
    client.post("/auth/register", json=body)
    client.post("/auth/verify-email", json={"token": _token(outbox[-1])})
    again = client.post("/auth/register", json={**body, "password": "attacker99"})
    assert again.status_code == 202 and again.json() == routes_auth.SENT
    assert "already have" in outbox[-1]["subject"]
    assert client.post("/auth/login", json={"email": "asha@example.com", "password": "attacker99"}).status_code == 401


def test_forgot_and_reset_password(client, outbox):
    client.post("/auth/register", json={"name": "Ravi", "email": "ravi@example.com", "password": "firstpass1"})
    old = client.post("/auth/verify-email", json={"token": _token(outbox[-1])}).json()["token"]
    unknown = client.post("/auth/forgot-password", json={"email": "nobody@example.com"})
    known = client.post("/auth/forgot-password", json={"email": "ravi@example.com"})
    assert unknown.json() == known.json() and len(outbox) == 2
    tok = _token(outbox[-1])
    assert client.post("/auth/reset-password", json={"token": tok, "password": "weak"}).status_code == 422
    assert client.post("/auth/reset-password", json={"token": tok, "password": "secondpass2"}).status_code == 200
    assert client.post("/auth/reset-password", json={"token": tok, "password": "thirdpass3"}).status_code == 400
    assert client.get("/me", headers=h(old)).status_code == 401  # reset signs out every device
    assert client.post("/auth/login", json={"email": "ravi@example.com", "password": "firstpass1"}).status_code == 401
    assert client.post("/auth/login", json={"email": "ravi@example.com", "password": "secondpass2"}).status_code == 200


def test_email_throttle_and_ip_rate_limit(client, outbox):
    client.post("/auth/register", json={"name": "Asha", "email": "asha@example.com", "password": "monsoon2026"})
    client.post("/auth/resend-verification", json={"email": "asha@example.com"})
    assert len(outbox) == 1  # second email within a minute is refused
    codes = [client.post("/auth/login", json={"email": "x@example.com", "password": "nope"}).status_code for _ in range(21)]
    assert codes[-1] == 429


def test_password_hashing():
    stored = auth.hash_password("monsoon2026")
    assert stored.startswith("scrypt$32768$8$1$") and "monsoon2026" not in stored
    assert auth.password_ok(stored, "monsoon2026") and not auth.password_ok(stored, "monsoon2027")
    import hashlib
    salt = bytes(16)
    legacy = f"scrypt${salt.hex()}${hashlib.scrypt(b'oldpass12', salt=salt, n=2**14, r=8, p=1).hex()}"
    assert auth.password_ok(legacy, "oldpass12")
    assert not auth.password_ok("garbage", "x") and not auth.password_ok(None, "x")


def test_admin_bootstrapped_from_env_with_hashed_password(client, monkeypatch):
    old_admin = user("admin")
    monkeypatch.setattr(C, "ADMIN_EMAIL", "admin@jalmarg.in")
    monkeypatch.setattr(C, "ADMIN_PHONE", "+919876543210")
    monkeypatch.setattr(C, "ADMIN_PASSWORD_HASH", auth.hash_password("Adm1n-secret-pass"))
    auth.bootstrap_admin()
    a = db.one("SELECT * FROM users WHERE email='admin@jalmarg.in'")
    assert a["role"] == "admin" and a["phone"] == "+919876543210" and a["password_hash"] == C.ADMIN_PASSWORD_HASH
    assert db.one("SELECT role FROM users WHERE id=?", old_admin["id"])["role"] == "citizen"
    s = client.post("/auth/login", json={"email": "ADMIN@jalmarg.in", "password": "Adm1n-secret-pass"}).json()
    assert s["user"]["role"] == "admin"
    assert client.post("/me/password", json={"new": "changed123"}, headers=h(s["token"])).status_code == 403
    # Admin manages municipal staff through the existing staff tools.
    made = client.post("/staff", json={"name": "Ward Lead", "role": "ward_officer", "ward": "Ward 3"}, headers=h(s["token"]))
    assert made.status_code == 200 and made.json()["employee_id"].startswith("JM-OFF-")
    assert client.post("/auth/forgot-password", json={"email": "admin@jalmarg.in"}).status_code == 202
    monkeypatch.setattr(C, "ADMIN_PASSWORD_HASH", "plaintext")
    with pytest.raises(RuntimeError):
        auth.bootstrap_admin()


def test_private_files_use_signed_urls_not_session_tokens(client):
    admin, citizen = user("admin"), user()
    report(client, citizen)
    url = client.get("/admin/reports", headers={"Authorization": admin["Authorization"]}).json()[0]["evidence"]["original_url"]
    assert "sig=" in url and "token" not in url
    assert client.get(url).status_code == 200
    assert client.get(url.replace("sig=", "sig=x")).status_code == 404
    assert client.get(url.split("?")[0]).status_code == 404


def test_blocked_user_sessions_are_revoked(client):
    admin, citizen = user("admin"), user()
    client.patch(f"/admin/users/{citizen['id']}", json={"status": "blocked"}, headers={"Authorization": admin["Authorization"]})
    assert db.one("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?", citizen["id"])["n"] == 0
