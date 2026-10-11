"""Ask for each administrator's password and save only their hashes in backend/.env.

Usage (from the backend folder):  python -m app.set_admin_passwords
Leave a prompt empty to keep that admin's current password.
"""
import getpass
import re
import sys

from . import config as C
from .auth import check_new_password, hash_password


def main():
    env = C.ROOT / ".env"
    if not env.exists():
        sys.exit(f"{env} not found")
    if not C.ADMIN_EMAILS:
        sys.exit("Set ADMIN_EMAIL in .env first (comma-separated for several admins).")
    hashes = []
    for i, email in enumerate(C.ADMIN_EMAILS):
        current = C.ADMIN_PASSWORD_HASHES[i] if i < len(C.ADMIN_PASSWORD_HASHES) else ""
        while True:
            pw = getpass.getpass(f"New password for {email}{' (Enter = keep current)' if current else ''}: ")
            if not pw and current:
                hashes.append(current)
                break
            try:
                check_new_password(pw)
            except Exception as e:
                print(getattr(e, "detail", e))
                continue
            if pw != getpass.getpass("Repeat it: "):
                print("Passwords do not match, try again.")
                continue
            hashes.append(hash_password(pw))
            break
    line = f"ADMIN_PASSWORD_HASH='{','.join(hashes)}'"
    text = env.read_text()
    text = re.sub(r"(?m)^ADMIN_PASSWORD_HASH=.*$", lambda _: line, text) if re.search(r"(?m)^ADMIN_PASSWORD_HASH=", text) else text.rstrip() + "\n" + line + "\n"
    env.write_text(text)
    print(f"Saved {len(hashes)} admin password hash(es) to {env}. Restart the API to apply.")


if __name__ == "__main__":
    main()
