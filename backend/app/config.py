import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Tests set JALMARG_IGNORE_DOTENV so a developer's .env (database path, S3, real keys) is never used by the suite.
if (ROOT / ".env").exists() and not os.environ.get("JALMARG_IGNORE_DOTENV"):
    for line in (ROOT / ".env").read_text().splitlines():
        k, _, v = line.partition("=")
        if k.strip() and not k.lstrip().startswith("#"):
            os.environ.setdefault(k.strip(), v.strip())
E = os.environ.get
DATA_DIR = Path(E("DATA_DIR", ROOT / "data"))
DB_PATH = E("DATABASE_URL", f"sqlite:///{DATA_DIR / 'jalmarg.db'}").removeprefix("sqlite:///")
APP_ENV = E("APP_ENV", "development")
CORS_ORIGINS = E("CORS_ORIGINS", "*").split(",")

GOOGLE_KEY = E("GOOGLE_MAPS_API_KEY", "")
GOOGLE_BROWSER_KEY = E("GOOGLE_MAPS_BROWSER_KEY", GOOGLE_KEY)
GOOGLE_MAP_ID = E("GOOGLE_MAP_ID", "")
GOOGLE_WEATHER_KEY = E("GOOGLE_WEATHER_API_KEY", GOOGLE_KEY)
MAP_PROVIDER = E("MAP_PROVIDER", "google" if GOOGLE_KEY else "osm")
WEATHER_PROVIDER = E("WEATHER_PROVIDER", "google" if GOOGLE_WEATHER_KEY else "open-meteo")
STORAGE_PROVIDER = E("STORAGE_PROVIDER", "local")
AWS_REGION = E("AWS_REGION", "ap-south-1")
S3_BUCKET = E("S3_BUCKET", "")
VISION_PROVIDER = E("VISION_PROVIDER", "none")
VISION_MODEL = E("VISION_MODEL", "anthropic.claude-opus-5-5")
# Nominatim's usage policy asks for an identifying User-Agent with a contact address.
CONTACT_EMAIL = E("CONTACT_EMAIL", "")
USER_AGENT = E("USER_AGENT", f"JalMarg/1.0 (civic waterlogging reports{'; ' + CONTACT_EMAIL if CONTACT_EMAIL else ''})")

AUTH_SECRET = E("AUTH_SECRET", "")
# Public URL of the web app; links in emails point here.
APP_URL = E("APP_URL", "http://localhost:5173").rstrip("/")

# Administrators, bootstrapped at startup. The password is stored only as a scrypt hash
# (generate one with: python -m app.hash_password).
# Comma-separated lists, paired by position: the 1st email gets the 1st phone and the 1st hash, and so on.
ADMIN_EMAILS = [x.strip().lower() for x in E("ADMIN_EMAIL", "").split(",") if x.strip()]
ADMIN_PHONES = [x.replace(" ", "") for x in E("ADMIN_PHONE", "").split(",")]
ADMIN_PASSWORD_HASHES = [x.strip() for x in E("ADMIN_PASSWORD_HASH", "").split(",")]

# console (prints links to the API log) | smtp
EMAIL_DELIVERY = E("EMAIL_DELIVERY", "console")
SMTP_HOST = E("SMTP_HOST", "")
SMTP_PORT = int(E("SMTP_PORT", "587"))
SMTP_USERNAME = E("SMTP_USERNAME", "")
SMTP_PASSWORD = E("SMTP_PASSWORD", "")
SMTP_FROM = E("SMTP_FROM", SMTP_USERNAME)
# starttls (port 587) | ssl (port 465) | none (local relay only)
SMTP_SECURITY = E("SMTP_SECURITY", "starttls")

MAX_GPS_ACCURACY_M = float(E("MAX_GPS_ACCURACY_M", "50"))
SAME_SEGMENT_M = float(E("SAME_SEGMENT_M", "150"))
POSSIBLE_DUPLICATE_M = float(E("POSSIBLE_DUPLICATE_M", "500"))
UNKNOWN_ROAD_M = float(E("UNKNOWN_ROAD_M", "60"))
INCIDENT_TTL_H = float(E("INCIDENT_TTL_HOURS", "6"))
MAX_CAPTURE_AGE_S = int(E("MAX_CAPTURE_AGE_S", "600"))
CONFIRM_RADIUS_M = float(E("CONFIRM_RADIUS_M", "500"))
MAX_UPLOAD_MB = int(E("MAX_UPLOAD_MB", "8"))
REPORTS_PER_DAY = int(E("REPORTS_PER_DAY", "20"))
