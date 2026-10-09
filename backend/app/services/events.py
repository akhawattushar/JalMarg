from .. import db
from ..providers.maps import haversine

_handlers = {}


def on(event):
    def deco(fn):
        _handlers.setdefault(event, []).append(fn)
        return fn
    return deco


def publish(event, **payload):
    """In-process event bus; maps to EventBridge/SQS on AWS."""
    for fn in _handlers.get(event, []):
        fn(**payload)


def notify(user_ids, incident_id, kind, title, body, skip=None):
    t = db.now()
    for uid in set(user_ids) - {skip}:
        db.ex("INSERT OR IGNORE INTO notifications (id,user_id,incident_id,kind,title,body,created_at) VALUES (?,?,?,?,?,?,?)",
              db.new_id(), uid, incident_id, kind, title, body, t)


def notify_fresh(user_ids, incident_id, kind, title, body):
    """Like notify, but replaces an earlier notification of the same kind (repeatable events)."""
    for uid in set(user_ids):
        db.ex("DELETE FROM notifications WHERE user_id=? AND incident_id=? AND kind=?", uid, incident_id, kind)
    notify(user_ids, incident_id, kind, title, body)


def officers():
    return [u["id"] for u in db.q("SELECT id FROM users WHERE role IN ('ward_officer','admin') AND status='active'")]


def subscribers_near(lat, lng):
    return [s["user_id"] for s in db.q("SELECT user_id, lat, lng, radius_m FROM subscriptions")
            if haversine(lat, lng, s["lat"], s["lng"]) <= s["radius_m"]]


def participants(incident_id):
    return [r["user_id"] for r in db.q("SELECT user_id FROM reports WHERE incident_id=? UNION SELECT user_id FROM interactions "
                                       "WHERE incident_id=?", incident_id, incident_id)]


def _road(inc):
    return inc["road_name"] or "a nearby road"


@on("REPORT_CREATED")
def _created(incident, user_id, **_):
    notify(subscribers_near(incident["lat"], incident["lng"]), incident["id"], "nearby",
           f"Waterlogging reported on {_road(incident)}", "Reported near one of your saved places.", skip=user_id)


@on("WORK_ON_THE_WAY")
def _on_way(incident, **_):
    notify(participants(incident["id"]), incident["id"], "work_on_the_way", f"Crew on the way to {_road(incident)}",
           "A municipal field worker is heading to the location you reported.")


@on("WORK_STARTED")
def _started(incident, **_):
    notify(participants(incident["id"]), incident["id"], "work_started", f"Work started on {_road(incident)}",
           "A municipal team is working at the location you reported.")


@on("INCIDENT_RESOLVED")
def _resolved(incident, **_):
    notify(participants(incident["id"]) + subscribers_near(incident["lat"], incident["lng"]), incident["id"], "resolved",
           f"Work marked completed on {_road(incident)}", "Still flooded? Tell us from the incident page.")


@on("INCIDENT_REOPENED")
def _reopened(incident, **_):
    notify(participants(incident["id"]), incident["id"], "reopened", f"Flooding reported again on {_road(incident)}",
           "Citizens report the water is back after the work was completed.")
