from .. import config as C
from .. import db
from ..providers.maps import haversine

NEW, LIKELY, POSSIBLE, SAME_USER, REVIEW = "NEW_INCIDENT", "LIKELY_DUPLICATE", "POSSIBLE_DUPLICATE", "SAME_USER", "NEEDS_REVIEW"


def expire_stale():
    db.ex("UPDATE incidents SET status='expired' WHERE status='active' AND last_observed_at < ?", db.now() - int(C.INCIDENT_TTL_H * 3600))


def active_near(lat, lng, radius_m):
    expire_stale()
    d = radius_m / 111000
    rows = db.q("SELECT * FROM incidents WHERE status='active' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                lat - d, lat + d, lng - d * 1.2, lng + d * 1.2)
    out = [(round(haversine(lat, lng, r["lat"], r["lng"])), r) for r in rows]
    return sorted([x for x in out if x[0] <= radius_m], key=lambda x: x[0])


def involved(user_id, incident_id):
    return db.one("SELECT 1 AS x FROM reports WHERE user_id=? AND incident_id=? UNION SELECT 1 FROM interactions "
                  "WHERE user_id=? AND incident_id=? AND kind='confirm'", user_id, incident_id, user_id, incident_id) is not None


def match(user_id, lat, lng, road, problem_type):
    """Road-aware incident matching. Distance alone never decides; road identity and problem type do."""
    for dist, inc in active_near(lat, lng, C.POSSIBLE_DUPLICATE_M):
        same_seg = bool(road) and inc["road_segment_id"] == road.segment_id
        same_road = bool(road and road.name) and inc["road_name"] == road.name
        unknown = not road or not inc["road_segment_id"]
        same_type = inc["problem_type"] == problem_type
        if involved(user_id, inc["id"]) and (same_seg or same_road or unknown or dist <= C.UNKNOWN_ROAD_M):
            return SAME_USER, inc, dist
        if not same_type:
            continue
        if same_seg and dist <= C.SAME_SEGMENT_M:
            return LIKELY, inc, dist
        if same_seg or same_road or unknown:
            return POSSIBLE, inc, dist
    return (NEW if road else REVIEW), None, None
