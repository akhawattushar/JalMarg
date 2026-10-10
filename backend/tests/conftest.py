import io
import os
import random
import tempfile
import time

_tmp = tempfile.mkdtemp()
os.environ.update(JALMARG_IGNORE_DOTENV="1", DATA_DIR=_tmp, DATABASE_URL=f"sqlite:///{_tmp}/test.db", MAP_PROVIDER="osm", WEATHER_PROVIDER="open-meteo",
                  STORAGE_PROVIDER="local", VISION_PROVIDER="none", EMAIL_DELIVERY="console", APP_ENV="test")
for _k in ("ADMIN_EMAIL", "ADMIN_PASSWORD_HASH", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_SECRET"):
    os.environ.pop(_k, None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import auth, db  # noqa: E402
from app.main import app  # noqa: E402
from app.providers import http  # noqa: E402
from app.providers import maps as M  # noqa: E402
from app.providers import weather as W  # noqa: E402

LAT, LNG = 26.1000, 74.3200
ROADS = [("seg-mg-1", "MG Road", LAT, LNG, 120), ("seg-mg-2", "MG Road", LAT + 0.003, LNG, 120),
         ("seg-station", "Station Road", LAT, LNG + 0.0012, 60)]


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    for t in ("users", "incidents", "reports", "evidence", "interactions", "comments", "work_orders", "notifications", "subscriptions", "audit_log", "sessions",
              "email_tokens", "oauth_states", "login_codes"):
        db.ex(f"DELETE FROM {t}")
    http._cache.clear()
    auth._hits.clear()
    monkeypatch.setattr(M, "maps", M.MockMapService(ROADS))
    monkeypatch.setattr(W, "service", W.MockWeatherService())


@pytest.fixture
def client():
    return TestClient(app)


def user(role="citizen"):
    u = db.insert("users", id=db.new_id(), email=f"u{random.randint(10**7, 10**8 - 1)}@example.com", email_verified=1, role=role, status="active",
                  created_at=db.now(), last_seen=db.now())
    return {"Authorization": "Bearer " + auth.issue_token(u["id"]), "id": u["id"]}


def photo():
    img = Image.effect_noise((640, 480), random.randint(20, 90)).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG")
    return buf.getvalue()


def report(client, who, lat=LAT, lng=LNG, img=None, **kw):
    form = {"lat": lat, "lng": lng, "accuracy": 8, "captured_at": int(time.time() * 1000), "severity": "knee", "capture_mode": "live_camera", **kw}
    return client.post("/reports", data=form, files={"photo": ("p.jpg", img or photo(), "image/jpeg")}, headers={"Authorization": who["Authorization"]})
