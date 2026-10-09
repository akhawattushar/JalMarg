import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if (ROOT / ".env").exists():
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
OTP_DELIVERY = E("OTP_DELIVERY", "console")
USER_AGENT = E("USER_AGENT", "JalMarg/1.0 (civic waterlogging reports)")

AUTH_SECRET = E("AUTH_SECRET", "")
ADMIN_PHONES = {p.strip() for p in E("ADMIN_PHONES", "").split(",") if p.strip()}

MAX_GPS_ACCURACY_M = float(E("MAX_GPS_ACCURACY_M", "50"))
SAME_SEGMENT_M = float(E("SAME_SEGMENT_M", "150"))
POSSIBLE_DUPLICATE_M = float(E("POSSIBLE_DUPLICATE_M", "500"))
UNKNOWN_ROAD_M = float(E("UNKNOWN_ROAD_M", "60"))
INCIDENT_TTL_H = float(E("INCIDENT_TTL_HOURS", "6"))
MAX_CAPTURE_AGE_S = int(E("MAX_CAPTURE_AGE_S", "600"))
CONFIRM_RADIUS_M = float(E("CONFIRM_RADIUS_M", "500"))
MAX_UPLOAD_MB = int(E("MAX_UPLOAD_MB", "8"))
REPORTS_PER_DAY = int(E("REPORTS_PER_DAY", "20"))
