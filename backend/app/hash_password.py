"""Print a scrypt hash for ADMIN_PASSWORD_HASH (one per admin, comma-separated). Usage: python -m app.hash_password"""
import getpass
import sys

from .auth import check_new_password, hash_password


def main():
    pw = getpass.getpass("Admin password: ")
    if pw != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match")
    try:
        check_new_password(pw)
    except Exception as e:
        sys.exit(getattr(e, "detail", str(e)))
    if len(pw) < 12:
        print("Warning: use at least 12 characters for the administrator.", file=sys.stderr)
    print(hash_password(pw))
    print("Paste into ADMIN_PASSWORD_HASH inside single quotes (several admins: comma-separated, same order as ADMIN_EMAIL).", file=sys.stderr)


if __name__ == "__main__":
    main()
