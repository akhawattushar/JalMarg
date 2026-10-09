import json

from .. import config as C
from .. import db

STATES = ("verified", "likely", "needs_review", "suspicious", "rejected")


def signal(key, label, status):
    return {"key": key, "label": label, "status": status}


def assess(*, capture_mode, accuracy, road, captured_at, received_at, duplicate_image, nearby, wx, visual=None):
    """Explainable evidence signals for one report. No fabricated confidence numbers."""
    skew = abs(received_at - captured_at)
    s = [
        signal("camera", "Live camera capture" if capture_mode == "live_camera" else "Not a live capture", "pass" if capture_mode == "live_camera" else "fail"),
        signal("gps", f"GPS accuracy ±{round(accuracy)} m" + ("" if accuracy <= C.MAX_GPS_ACCURACY_M else " — approximate location"),
               "pass" if accuracy <= 20 else "info" if accuracy <= C.MAX_GPS_ACCURACY_M else "warn"),
        signal("road", f"Matched to {road.name or 'a road segment'}" if road else "Road could not be matched", "pass" if road else "warn"),
        signal("time", "Captured just now" if skew <= 120 else f"Captured {skew // 60} min before upload",
               "pass" if skew <= 120 else "warn" if skew <= C.MAX_CAPTURE_AGE_S else "fail"),
        signal("image", "Photo seen before" if duplicate_image else "New photo", "fail" if duplicate_image else "pass"),
        visual or signal("visual", "Visual water detection not configured", "unavailable"),
        signal("nearby", f"{nearby} active incident(s) within 500 m" if nearby else "No other active incidents nearby", "info"),
    ]
    if wx is None:
        s.append(signal("weather", "Weather data unavailable", "unavailable"))
    else:
        wet = wx["past_6h_mm"] + (wx["current"].get("precip_mm") or 0)
        s.append(signal("weather", f"{wx['past_6h_mm']} mm rain in the last 6 h" if wet else "No rain recorded in the last 6 h", "pass" if wet >= 1 else "warn"))
    statuses = {x["key"]: x["status"] for x in s}
    if "fail" in statuses.values():
        state = "suspicious"
    elif any(statuses[k] == "warn" for k in ("gps", "road", "time", "visual")):
        state = "needs_review"
    else:
        state = "likely"
    return state, s


def refresh_incident(incident_id):
    """Incident verification from its reports plus independent community confirmations."""
    inc = db.one("SELECT verification FROM incidents WHERE id=?", incident_id)
    if inc["verification"] == "rejected":
        return
    reps = [r["verification"] for r in db.q("SELECT verification FROM reports WHERE incident_id=?", incident_id)]
    people = db.one("SELECT COUNT(DISTINCT user_id) AS n FROM (SELECT user_id FROM reports WHERE incident_id=? AND verification!='suspicious' "
                    "UNION SELECT user_id FROM interactions WHERE incident_id=? AND kind='confirm')", incident_id, incident_id)["n"]
    if people >= 3 or (people >= 2 and "likely" in reps):
        state = "verified"
    elif "likely" in reps:
        state = "likely"
    elif "needs_review" in reps or people >= 2:
        state = "needs_review"
    else:
        state = "suspicious"
    db.ex("UPDATE incidents SET verification=? WHERE id=?", state, incident_id)


def signals_json(s):
    return json.dumps(s)
