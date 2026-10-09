import time

from conftest import LAT, LNG, photo, report, user

from app import db
from app.providers import weather as W


def h(u):
    return {"Authorization": u["Authorization"]}


def test_live_report_creates_incident_with_watermarked_evidence(client):
    r = report(client, user())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == "NEW_INCIDENT" and body["incident"]["road_name"] == "MG Road"
    assert body["report"]["verification"] == "likely"
    assert not any(s.get("confidence") for s in body["report"]["signals"])
    ev = db.one("SELECT * FROM evidence")
    assert ev["original_hash"] != ev["image_hash"] and ev["image_key"].startswith("public/")
    assert client.get("/" + "files/" + ev["original_key"]).status_code == 404


def test_report_validation(client):
    u = user()
    assert report(client, u, capture_mode="gallery").status_code == 422
    poor = report(client, u, lat=LAT + 0.2, accuracy=900).json()
    assert poor["report"]["verification"] == "needs_review" and any(x["key"] == "gps" and x["status"] == "warn" for x in poor["report"]["signals"])
    assert report(client, user("worker")).status_code == 403
    assert report(client, u, img=b"not an image").status_code == 422
    assert client.post("/reports", data={"accuracy": 5}, files={"photo": ("p.jpg", photo(), "image/jpeg")}, headers=h(u)).status_code == 422
    assert report(client, {"Authorization": ""}).status_code == 401


def test_same_segment_merges_into_one_incident(client):
    a, b = user(), user()
    first = report(client, a).json()["incident"]["id"]
    second = report(client, b, lat=LAT + 0.0004).json()
    assert second["decision"] == "LIKELY_DUPLICATE" and second["incident"]["id"] == first
    assert db.one("SELECT COUNT(*) AS n FROM incidents")["n"] == 1
    assert second["incident"]["verification"] == "verified"


def test_same_user_is_told_already_reported(client):
    a = user()
    report(client, a)
    r = report(client, a, lat=LAT + 0.0002)
    assert r.status_code == 409 and r.json()["decision"] == "SAME_USER"


def test_nearby_different_road_is_separate(client):
    report(client, user())
    r = report(client, user(), lng=LNG + 0.0012)
    assert r.json()["decision"] == "NEW_INCIDENT" and r.json()["incident"]["road_name"] == "Station Road"


def test_same_road_far_segment_is_possible_duplicate(client):
    report(client, user())
    u = user()
    r = report(client, u, lat=LAT + 0.003)
    assert r.status_code == 409 and r.json()["decision"] == "POSSIBLE_DUPLICATE" and r.json()["distance_m"] > 150
    assert report(client, u, lat=LAT + 0.003, new_incident="true").json()["decision"] == "NEW_INCIDENT"


def test_different_problem_and_resolved_incidents_do_not_match(client):
    iid = report(client, user()).json()["incident"]["id"]
    assert report(client, user(), problem_type="blocked_drain").json()["decision"] == "NEW_INCIDENT"
    db.ex("UPDATE incidents SET status='resolved', resolved_at=? WHERE id=?", db.now(), iid)
    assert report(client, user()).json()["decision"] == "NEW_INCIDENT"


def test_unmatched_road_needs_review(client):
    r = report(client, user(), lat=LAT + 0.5).json()
    assert r["decision"] == "NEEDS_REVIEW" and r["report"]["verification"] == "needs_review"


def test_reused_photo_and_old_capture_are_suspicious(client):
    img = photo()
    report(client, user(), img=img)
    r = report(client, user(), lng=LNG + 0.0012, img=img).json()
    assert r["report"]["verification"] == "suspicious"
    r = report(client, user(), lat=LAT + 0.6, captured_at=int((time.time() - 3600) * 1000)).json()
    assert r["report"]["verification"] == "suspicious"


def test_i_see_it_too(client):
    a, b = user(), user()
    iid = report(client, a).json()["incident"]["id"]
    form = {"lat": LAT, "lng": LNG, "accuracy": 10}
    assert client.post(f"/incidents/{iid}/confirm", data=form, headers=h(a)).status_code == 409
    assert client.post(f"/incidents/{iid}/confirm", data={**form, "lat": LAT + 0.02}, headers=h(b)).status_code == 403
    r = client.post(f"/incidents/{iid}/confirm", data=form, files={"photo": ("p.jpg", photo(), "image/jpeg")}, headers=h(b))
    assert r.status_code == 200 and r.json()["confirmation_count"] == 1
    assert client.post(f"/incidents/{iid}/confirm", data=form, headers=h(b)).status_code == 409
    detail = client.get(f"/incidents/{iid}").json()
    assert len(detail["evidence"]) == 2 and {t["kind"] for t in detail["timeline"]} == {"reported", "confirm"}


def test_weather_unavailable_is_never_faked(client, monkeypatch):
    class Down:
        name = "down"

        def lookup(self, lat, lng):
            raise RuntimeError("offline")
    monkeypatch.setattr(W, "service", Down())
    assert client.get(f"/weather?lat={LAT}&lng={LNG}").json() == {"available": False, "provider": "down"}
    risk = client.get(f"/risk?lat={LAT}&lng={LNG}").json()
    assert not risk["weather_available"] and "Weather data unavailable" in risk["factors"][0]


def test_risk_rises_with_rain_and_reports(client, monkeypatch):
    low = client.get(f"/risk?lat={LAT}&lng={LNG}").json()
    monkeypatch.setattr(W, "service", W.MockWeatherService(next_mm=60, past_mm=35))
    from app.providers import http
    http._cache.clear()
    report(client, user())
    high = client.get(f"/risk?lat={LAT}&lng={LNG}").json()
    assert low["level"] == "LOW" and high["level"] in ("HIGH", "SEVERE") and high["score"] > low["score"]


def test_safe_route_avoids_hazard_and_reports_when_none(client):
    report(client, user(), lat=LAT, lng=LNG)
    r = client.get(f"/route?origin={LAT},{LNG - 0.02}&destination={LAT},{LNG + 0.02}").json()
    assert r["fastest"]["hazards"] and not r["recommended"]["hazards"] and r["summary"].startswith("Lower-risk route")
    report(client, user(), lat=LAT + 0.01, lng=LNG + 0.3)
    r = client.get(f"/route?origin={LAT + 0.01},{LNG + 0.29}&destination={LAT + 0.01},{LNG + 0.31}").json()
    assert r["summary"].startswith("Lower-risk") or r["summary"].startswith("No reported")


def test_unknown_road_within_500m_asks_before_new_incident(client):
    report(client, user(), lat=LAT + 0.5)
    r = report(client, user(), lat=LAT + 0.5 + 0.003)
    assert r.status_code == 409 and r.json()["decision"] == "POSSIBLE_DUPLICATE" and 300 < r.json()["distance_m"] < 500
    assert report(client, user(), lat=LAT + 0.5 + 0.006).json()["decision"] == "NEEDS_REVIEW"


def test_bedrock_vision_signal(client, monkeypatch):
    from types import SimpleNamespace as NS

    from app import config as C
    from app.providers import vision

    reply = '{"water": false, "matches": false, "reason": "dry road, no water visible"}'
    fake = NS(messages=NS(create=lambda **kw: NS(stop_reason="end_turn", content=[NS(type="text", text=reply)])))
    monkeypatch.setattr(C, "VISION_PROVIDER", "bedrock")
    monkeypatch.setattr(vision, "_client", fake)
    r = report(client, user())
    assert r.status_code == 200, r.text
    rep = r.json()["report"]
    visual = next(s for s in rep["signals"] if s["key"] == "visual")
    assert visual["status"] == "warn" and "dry road" in visual["label"] and rep["verification"] == "needs_review"
