import json

from fastapi import HTTPException

from . import db
from .auth import mask
from .providers import maps as M
from .providers.storage import storage

PROBLEMS = ("waterlogging", "blocked_drain", "sewer_overflow")
SEVERITIES = ("ankle", "knee", "waist", "impassable")
WORK_FLOW = ("created", "assigned", "on_the_way", "in_progress", "pending_review", "done")


def match_road(lat, lng):
    try:
        road = M.maps.match_road(lat, lng)
    except Exception as e:
        print("road matching unavailable:", e)
        return None
    if road:
        db.ex("INSERT OR IGNORE INTO road_segments VALUES (?,?,?,?,?,?)", road.segment_id, road.name, M.maps.name, road.locality, road.lat, road.lng)
    return road


def get_incident(iid):
    inc = db.one("SELECT * FROM incidents WHERE id=?", iid)
    if not inc:
        raise HTTPException(404, "Incident not found")
    return inc


def near_or_403(inc, lat, lng, radius):
    if M.haversine(lat, lng, inc["lat"], inc["lng"]) > radius:
        raise HTTPException(403, f"You need to be within {round(radius)} m of this incident")


def work_of(iid):
    return db.one("SELECT * FROM work_orders WHERE incident_id=? ORDER BY created_at DESC LIMIT 1", iid)


def incident_out(inc, lat=None, lng=None, staff=False):
    out = {k: inc[k] for k in ("id", "road_name", "locality", "address", "lat", "lng", "problem_type", "severity", "status", "verification",
                               "created_at", "last_observed_at", "confirmation_count", "clear_count", "resolved_at", "reopened_count")}
    w = work_of(inc["id"])
    # Citizens only see completion once an officer has verified it.
    out["work_status"] = (w["status"] if staff or w["status"] != "pending_review" else "in_progress") if w else None
    out["critical"] = json.loads(inc["critical"]) if inc.get("critical") else []
    if lat is not None:
        out["distance_m"] = round(M.haversine(lat, lng, inc["lat"], inc["lng"]))
    return out


def evidence_out(e, staff=False):
    out = {"id": e["id"], "kind": e["kind"], "image_url": storage.url(e["image_key"]), "captured_at": e["captured_at"],
           "received_at": e["server_received_at"], "gps_accuracy": e["gps_accuracy"]}
    if staff:
        out |= {"original_url": storage.url(e["original_key"]), "original_hash": e["original_hash"], "lat": e["lat"], "lng": e["lng"]}
    return out


def user_label(u):
    return mask(u["phone"]) if u else "Citizen"


__all__ = ["PROBLEMS", "SEVERITIES", "WORK_FLOW", "match_road", "get_incident", "incident_out", "evidence_out", "near_or_403", "user_label", "work_of"]
