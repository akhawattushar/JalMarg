import hashlib
import json
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import auth, db
from . import config as C
from .common import PROBLEMS, SEVERITIES, evidence_out, get_incident, incident_out, match_road, near_or_403, user_label, work_of
from .providers import maps as M
from .providers import vision
from .providers import weather as W
from .providers.storage import storage
from .services import evidence as EV
from .services import matching, risk
from .services import verification as V
from .services.events import participants, publish

r = APIRouter()
Lat, Lng = Field(ge=-90, le=90), Field(ge=-180, le=180)


@r.get("/config")
def config():
    return {"map_provider": M.maps.name, "map_attribution": M.maps.attribution, "weather_provider": W.service.name,
            "google_maps_key": C.GOOGLE_BROWSER_KEY if M.maps.name == "google" else "", "google_map_id": C.GOOGLE_MAP_ID,
            "max_gps_accuracy_m": C.MAX_GPS_ACCURACY_M, "problem_types": PROBLEMS, "severities": SEVERITIES}


class Phone(BaseModel):
    phone: str
    purpose: Literal["citizen", "admin"] = "citizen"


class Otp(Phone):
    code: str = Field(min_length=6, max_length=6)


class PasswordLogin(BaseModel):
    phone: str
    password: str = Field(min_length=1, max_length=128)


class StaffLogin(BaseModel):
    employee_id: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=1, max_length=128)


class NewPassword(BaseModel):
    current: str = ""
    new: str = Field(max_length=128)


def _session(u):
    token, ttl = auth.issue_token(u["id"])
    return {"token": token, "expires_in": ttl, "user": auth.profile(u)}


@r.post("/auth/otp/start")
def otp_start(b: Phone):
    auth.start_otp(b.phone, b.purpose)
    return {"sent": True, "expires_in": 300}


@r.post("/auth/otp/verify")
def otp_verify(b: Otp):
    return _session(auth.verify_otp(b.phone, b.code, b.purpose))


@r.post("/auth/password")
def password_login(b: PasswordLogin):
    return _session(auth.citizen_password_login(b.phone, b.password))


@r.post("/auth/staff")
def staff_login(b: StaffLogin):
    return _session(auth.staff_login(b.employee_id, b.password))


@r.get("/me")
def me(user=Depends(auth.require_user)):
    db.ex("UPDATE users SET last_seen=? WHERE id=?", db.now(), user["id"])
    return auth.profile(user)


class ProfileIn(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=60)
    address: str | None = Field(None, max_length=200)


@r.patch("/me")
def update_me(b: ProfileIn, user=Depends(auth.require_user)):
    upd = {k: v.strip() for k, v in b.model_dump(exclude_none=True).items()}
    if user["role"] in ("worker", "ward_officer"):
        upd.pop("name", None)
    if upd:
        db.ex(f"UPDATE users SET {', '.join(f'{k}=?' for k in upd)} WHERE id=?", *upd.values(), user["id"])
    return auth.profile(db.one("SELECT * FROM users WHERE id=?", user["id"]))


@r.post("/me/password")
def change_password(b: NewPassword, user=Depends(auth.require_user)):
    auth.set_password(user, b.current, b.new)
    return auth.profile(db.one("SELECT * FROM users WHERE id=?", user["id"]))


class Check(BaseModel):
    lat: float = Lat
    lng: float = Lng
    accuracy: float = Field(gt=0)
    problem_type: Literal[PROBLEMS] = "waterlogging"


def _match_payload(decision, inc, dist, road):
    return {"decision": decision, "distance_m": dist, "incident": incident_out(inc) if inc else None,
            "road": {"name": road.name, "segment_id": road.segment_id, "address": road.address} if road else None}


@r.post("/reports/check")
def check(b: Check, user=Depends(auth.require_user)):
    road = match_road(b.lat, b.lng)
    return _match_payload(*matching.match(user["id"], b.lat, b.lng, road, b.problem_type), road)


def _critical(iid, lat, lng):
    try:
        db.ex("UPDATE incidents SET critical=? WHERE id=?", json.dumps(M.maps.critical_nearby(lat, lng)), iid)
    except Exception as e:
        print("critical places unavailable:", e)


@r.post("/reports")
def create_report(bg: BackgroundTasks, photo: UploadFile = File(), lat: float = Form(ge=-90, le=90), lng: float = Form(ge=-180, le=180),
                  accuracy: float = Form(gt=0), captured_at: int = Form(), device_time: int = Form(0), timezone: str = Form("", max_length=64),
                  problem_type: Literal[PROBLEMS] = Form("waterlogging"), severity: Literal[SEVERITIES] = Form(),
                  note: str = Form("", max_length=280), capture_mode: str = Form(), new_incident: bool = Form(False),
                  user=Depends(auth.require_user)):
    if capture_mode != "live_camera":
        raise HTTPException(422, "The first report needs a live camera photo. Gallery images are not accepted.")
    if user["role"] in ("worker", "ward_officer"):
        raise HTTPException(403, "Municipal staff accounts can't file citizen reports")
    if db.one("SELECT COUNT(*) AS n FROM reports WHERE user_id=? AND created_at>?", user["id"], db.now() - 86400)["n"] >= C.REPORTS_PER_DAY:
        raise HTTPException(429, "Daily report limit reached")
    data, img = EV.read_image(photo)
    road = match_road(lat, lng)
    decision, inc, dist = matching.match(user["id"], lat, lng, road, problem_type)
    if decision == matching.SAME_USER or (decision == matching.POSSIBLE and not new_incident):
        return JSONResponse(_match_payload(decision, inc, dist, road), status_code=409)
    t, captured = db.now(), captured_at // 1000
    original_hash = hashlib.sha256(data).hexdigest()
    state, signals = V.assess(capture_mode=capture_mode, accuracy=accuracy, road=road, captured_at=captured, received_at=t,
                              duplicate_image=EV.seen_before(original_hash), nearby=len(matching.active_near(lat, lng, 500)), wx=W.weather(lat, lng),
                              visual=vision.check(img, problem_type))
    rid = db.new_id("JM")
    with db.tx():
        if decision == matching.LIKELY:
            iid = inc["id"]
            db.ex("UPDATE incidents SET last_observed_at=?, confirmation_count=confirmation_count+1, severity=? WHERE id=?", t, severity, iid)
        else:
            iid = db.new_id("INC")
            db.insert("incidents", id=iid, road_segment_id=road.segment_id if road else None, road_name=road.name if road else None,
                      locality=road.locality if road else None, address=road.address if road else None,
                      lat=road.lat if road else round(lat, 4), lng=road.lng if road else round(lng, 4), problem_type=problem_type,
                      severity=severity, status="active", verification=state, first_report_id=rid, created_at=t, last_observed_at=t)
        eid, _ = EV.store(data=data, img=img, kind="report", user_id=user["id"], incident_id=iid, report_id=rid, lat=lat, lng=lng,
                          accuracy=accuracy, captured_at=captured, road=road, label="LIVE EVIDENCE")
        db.insert("reports", id=rid, user_id=user["id"], incident_id=iid, lat=lat, lng=lng, gps_accuracy=accuracy,
                  road_segment_id=road.segment_id if road else None, road_name=road.name if road else None, address=road.address if road else None,
                  problem_type=problem_type, severity=severity, note=note.strip(), captured_at=captured, device_time=device_time // 1000,
                  timezone=timezone, server_received_at=t, verification=state, signals=V.signals_json(signals), evidence_id=eid,
                  match_decision=decision, created_at=t)
    V.refresh_incident(iid)
    inc = get_incident(iid)
    if decision == matching.LIKELY:
        publish("REPORT_MERGED", incident=inc, user_id=user["id"])
    else:
        publish("REPORT_CREATED", incident=inc, user_id=user["id"])
        bg.add_task(_critical, iid, inc["lat"], inc["lng"])
    outcome = decision if decision in (matching.LIKELY, matching.REVIEW) else matching.NEW
    return {"decision": outcome, "merged": decision == matching.LIKELY, "report": {"id": rid, "verification": state, "signals": signals},
            "incident": incident_out(inc)}


@r.get("/reports/{rid}")
def get_report(rid: str, user=Depends(auth.require_user)):
    rep = db.one("SELECT * FROM reports WHERE id=?", rid)
    if not rep or (rep["user_id"] != user["id"] and user["role"] not in auth.STAFF["ward_officer"]):
        raise HTTPException(404, "Report not found")
    return rep | {"signals": json.loads(rep["signals"])}


@r.get("/incidents/nearby")
def nearby(lat: float, lng: float, radius: float = 5000):
    matching.expire_stale()
    radius, d = min(radius, 25000), min(radius, 25000) / 111000
    rows = db.q("SELECT * FROM incidents WHERE (status='active' OR (status IN ('resolved','cleared') AND COALESCE(resolved_at, last_observed_at)>?)) "
                "AND verification!='rejected' AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                db.now() - 6 * 3600, lat - d, lat + d, lng - d * 1.2, lng + d * 1.2)
    out = [incident_out(i, lat, lng) for i in rows]
    return sorted([i for i in out if i["distance_m"] <= radius], key=lambda i: i["distance_m"])


@r.get("/incidents/{iid}")
def incident_detail(iid: str, user=Depends(auth.current_user)):
    inc = get_incident(iid)
    staff = bool(user) and user["role"] in auth.STAFF["ward_officer"]
    w = work_of(iid)
    hidden = "" if staff else " AND kind!='issue'" + ("" if w and w["status"] == "done" else " AND kind!='work'")
    ev = db.q(f"SELECT * FROM evidence WHERE incident_id=?{hidden} ORDER BY created_at DESC LIMIT 12", iid)
    acts = db.q("SELECT i.kind, i.created_at, u.phone FROM interactions i LEFT JOIN users u ON u.id=i.user_id WHERE incident_id=? "
                "AND kind!='follow' ORDER BY i.created_at DESC LIMIT 30", iid)
    reps = db.q("SELECT r.created_at, r.verification, u.phone FROM reports r LEFT JOIN users u ON u.id=r.user_id WHERE incident_id=? ORDER BY r.created_at", iid)
    mine = {k["kind"] for k in db.q("SELECT kind FROM interactions WHERE incident_id=? AND user_id=?", iid, user["id"])} if user else set()
    fb = db.one("SELECT ROUND(AVG(rating), 1) AS avg, COUNT(*) AS n FROM feedback WHERE work_order_id=? AND kind='rating'", w["id"]) if w else None
    mine_fb = {f["kind"] for f in db.q("SELECT kind FROM feedback WHERE work_order_id=? AND user_id=? AND (kind='rating' OR status='open')",
                                        w["id"], user["id"])} if w and user else set()
    who = db.one("SELECT name, employee_id FROM users WHERE id=?", w["assignee_id"]) if w and w["assignee_id"] else None
    return incident_out(inc, staff=staff) | {
        "evidence": [evidence_out(e, staff) for e in ev], "report_count": len(reps),
        "timeline": sorted([{"kind": "reported", "at": x["created_at"], "who": auth.mask(x["phone"])} for x in reps] +
                           [{"kind": a["kind"], "at": a["created_at"], "who": auth.mask(a["phone"])} for a in acts], key=lambda x: -x["at"]),
        "work": {k: w[k] for k in ("id", "priority", "created_at", "updated_at", "completed_at", "completion_note", "review_note")}
        | {"status": w["status"] if staff or w["status"] != "pending_review" else "in_progress", "assignee": who,
           "rating": fb["avg"], "ratings": fb["n"]} if w else None,
        "weather": W.weather(inc["lat"], inc["lng"]), "risk": risk.assess(inc["lat"], inc["lng"]),
        "me": {"reported": bool(user) and any(True for _ in db.q("SELECT 1 FROM reports WHERE incident_id=? AND user_id=?", iid, user["id"])),
               "confirmed": "confirm" in mine, "following": "follow" in mine, "cleared": "clear" in mine,
               "participant": bool(user) and user["id"] in participants(iid), "rated": "rating" in mine_fb, "issue_open": "issue" in mine_fb}}


def _interaction(inc, user, kind, lat, lng, evidence_id=None):
    if db.ex("INSERT OR IGNORE INTO interactions VALUES (?,?,?,?,?,?,?,?,?)", db.new_id(), inc["id"], user["id"], kind, lat, lng,
             inc["road_segment_id"], evidence_id, db.now()) == 0:
        raise HTTPException(409, {"confirm": "You already confirmed this incident", "clear": "You already reported this road as clear",
                                  "still_flooded": "You already reported this", "follow": "Already following"}[kind])


def _photo_evidence(photo, inc, user, lat, lng, accuracy, captured_at, kind):
    if not photo:
        return None
    data, img = EV.read_image(photo)
    return EV.store(data=data, img=img, kind=kind, user_id=user["id"], incident_id=inc["id"], report_id=None, lat=lat, lng=lng,
                    accuracy=accuracy, captured_at=captured_at // 1000, road=match_road(lat, lng), label="LIVE EVIDENCE")[0]


@r.post("/incidents/{iid}/confirm")
def confirm(iid: str, lat: float = Form(), lng: float = Form(), accuracy: float = Form(gt=0), captured_at: int = Form(0),
            comment: str = Form("", max_length=280), photo: UploadFile | None = File(None), user=Depends(auth.require_user)):
    inc = get_incident(iid)
    if inc["status"] != "active":
        raise HTTPException(409, "This incident is no longer active")
    if db.one("SELECT 1 AS x FROM reports WHERE incident_id=? AND user_id=?", iid, user["id"]):
        raise HTTPException(409, "This problem is already reported by you")
    near_or_403(inc, lat, lng, C.CONFIRM_RADIUS_M)
    eid = _photo_evidence(photo, inc, user, lat, lng, accuracy, captured_at or db.now() * 1000, "confirmation")
    _interaction(inc, user, "confirm", lat, lng, eid)
    db.ex("UPDATE incidents SET confirmation_count=confirmation_count+1, last_observed_at=? WHERE id=?", db.now(), iid)
    if comment.strip():
        db.insert("comments", id=db.new_id(), incident_id=iid, user_id=user["id"], text=comment.strip(), created_at=db.now())
    V.refresh_incident(iid)
    publish("REPORT_CONFIRMED", incident=inc, user_id=user["id"])
    return incident_out(get_incident(iid))


@r.post("/incidents/{iid}/evidence")
def add_evidence(iid: str, photo: UploadFile = File(), lat: float = Form(), lng: float = Form(), accuracy: float = Form(gt=0),
                 captured_at: int = Form(), user=Depends(auth.require_user)):
    inc = get_incident(iid)
    near_or_403(inc, lat, lng, C.CONFIRM_RADIUS_M)
    _photo_evidence(photo, inc, user, lat, lng, accuracy, captured_at, "additional")
    db.ex("UPDATE incidents SET last_observed_at=? WHERE id=? AND status='active'", db.now(), iid)
    return {"ok": True}


class Pos(BaseModel):
    lat: float = Lat
    lng: float = Lng


@r.post("/incidents/{iid}/clear")
def clear(iid: str, b: Pos, user=Depends(auth.require_user)):
    inc = get_incident(iid)
    near_or_403(inc, b.lat, b.lng, C.CONFIRM_RADIUS_M)
    _interaction(inc, user, "clear", b.lat, b.lng)
    db.ex("UPDATE incidents SET clear_count=clear_count+1 WHERE id=?", iid)
    inc = get_incident(iid)
    if inc["status"] == "active" and inc["clear_count"] >= 3 and inc["clear_count"] > inc["confirmation_count"] // 2:
        db.ex("UPDATE incidents SET status='cleared', resolved_at=? WHERE id=?", db.now(), iid)
    return incident_out(get_incident(iid))


@r.post("/incidents/{iid}/reopen")
def reopen(iid: str, b: Pos, user=Depends(auth.require_user)):
    inc = get_incident(iid)
    if inc["status"] not in ("resolved", "cleared"):
        raise HTTPException(409, "Only resolved incidents can be reopened")
    if db.now() - (inc["resolved_at"] or 0) > 86400:
        raise HTTPException(409, "This was resolved over a day ago — please file a new live report")
    near_or_403(inc, b.lat, b.lng, C.CONFIRM_RADIUS_M)
    _interaction(inc, user, "still_flooded", b.lat, b.lng)
    db.ex("UPDATE incidents SET status='active', last_observed_at=?, reopened_count=reopened_count+1, clear_count=0 WHERE id=?", db.now(), iid)
    publish("INCIDENT_REOPENED", incident=inc)
    return incident_out(get_incident(iid))


@r.post("/incidents/{iid}/subscribe")
def follow(iid: str, user=Depends(auth.require_user)):
    inc = get_incident(iid)
    _interaction(inc, user, "follow", None, None)
    return {"following": True}


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=280)


@r.get("/incidents/{iid}/comments")
def comments(iid: str):
    return [{"id": c["id"], "text": c["text"], "at": c["created_at"], "who": user_label(c)}
            for c in db.q("SELECT c.*, u.phone FROM comments c LEFT JOIN users u ON u.id=c.user_id WHERE incident_id=? ORDER BY c.created_at DESC", iid)]


@r.post("/incidents/{iid}/comments")
def add_comment(iid: str, b: CommentIn, user=Depends(auth.require_user)):
    get_incident(iid)
    db.insert("comments", id=db.new_id(), incident_id=iid, user_id=user["id"], text=b.text.strip(), created_at=db.now())
    publish("COMMENT_ADDED", incident_id=iid)
    return {"ok": True}


@r.get("/weather")
def weather(lat: float, lng: float):
    wx = W.weather(lat, lng)
    return {"available": wx is not None, "provider": W.service.name, **(wx or {})}


@r.get("/risk")
def get_risk(lat: float, lng: float):
    return risk.assess(lat, lng)


@r.get("/hotspots")
def hotspots(lat: float | None = None, lng: float | None = None, radius: float = 20000):
    rows = db.q("SELECT road_segment_id, MAX(road_name) AS road_name, MAX(locality) AS locality, AVG(lat) AS lat, AVG(lng) AS lng, COUNT(*) AS incidents, "
                "MAX(last_observed_at) AS last_observed_at, AVG(CASE WHEN resolved_at IS NOT NULL THEN resolved_at-created_at END) AS avg_duration_s, "
                "SUM(status='active') AS active FROM incidents WHERE road_segment_id IS NOT NULL AND verification!='rejected' AND created_at>? "
                "GROUP BY road_segment_id HAVING COUNT(*)>=3 ORDER BY incidents DESC", db.now() - 30 * 86400)
    if lat is not None:
        rows = [h for h in rows if M.haversine(lat, lng, h["lat"], h["lng"]) <= radius]
    return rows


@r.get("/places/reverse")
def reverse(lat: float, lng: float):
    road = match_road(lat, lng)
    if not road:
        raise HTTPException(404, "Address not found for this location")
    return {"address": road.address, "road": road.name, "locality": road.locality}


@r.get("/places/search")
def places(q: str, lat: float, lng: float):
    if len(q.strip()) < 2:
        return []
    try:
        return M.maps.search(q.strip()[:100], lat, lng)
    except Exception:
        raise HTTPException(503, "Place search is temporarily unavailable")


@r.get("/route")
def route(origin: str, destination: str):
    try:
        o, d = [float(x) for x in origin.split(",")], [float(x) for x in destination.split(",")]
    except ValueError:
        raise HTTPException(422, "origin and destination must be 'lat,lng'")
    try:
        options = M.maps.routes(o, d)
    except Exception:
        raise HTTPException(503, "Routing is temporarily unavailable")
    if not options:
        raise HTTPException(404, "No route found")
    hazards = matching.active_near((o[0] + d[0]) / 2, (o[1] + d[1]) / 2, M.haversine(*o, *d) / 2 + 3000)
    weight = {"ankle": 1, "knee": 3, "waist": 8, "impassable": 20}
    for opt in options:
        hit = [i for _, i in hazards if M.dist_to_line(i["lat"], i["lng"], opt["geometry"]) <= 40]
        opt["hazards"] = [{k: i[k] for k in ("id", "road_name", "severity", "lat", "lng", "status")} for i in hit]
        opt["penalty"] = sum(weight[i["severity"]] for i in hit)
    fastest = min(options, key=lambda x: x["duration_s"])
    best = min(options, key=lambda x: (x["penalty"], x["duration_s"]))
    if not best["hazards"]:
        summary = (f"Lower-risk route. Avoids {len(fastest['hazards'])} currently reported waterlogging zone(s)."
                   if fastest["hazards"] else "No reported waterlogging on this route.")
    else:
        summary = f"No lower-risk route found. {len(best['hazards'])} active waterlogging incident(s) remain on the available routes."
    return {"recommended": best, "fastest": fastest, "options": options, "recommended_index": options.index(best), "summary": summary,
            "extra_min": round((best["duration_s"] - fastest["duration_s"]) / 60), "provider": M.maps.name}


@r.get("/notifications")
def notifications(user=Depends(auth.require_user)):
    return db.q("SELECT id, incident_id, kind, title, body, created_at, read_at FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50", user["id"])


@r.post("/notifications/{nid}/read")
def read(nid: str, user=Depends(auth.require_user)):
    db.ex("UPDATE notifications SET read_at=? WHERE id=? AND user_id=?", db.now(), nid, user["id"])
    return {"ok": True}


@r.post("/notifications/read-all")
def read_all(user=Depends(auth.require_user)):
    db.ex("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL", db.now(), user["id"])
    return {"ok": True}


class SubIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    lat: float = Lat
    lng: float = Lng
    radius_m: float = Field(1500, ge=200, le=10000)


@r.get("/subscriptions")
def subs(user=Depends(auth.require_user)):
    return db.q("SELECT id, name, lat, lng, radius_m FROM subscriptions WHERE user_id=?", user["id"])


@r.post("/subscriptions")
def add_sub(b: SubIn, user=Depends(auth.require_user)):
    if db.one("SELECT COUNT(*) AS n FROM subscriptions WHERE user_id=?", user["id"])["n"] >= 5:
        raise HTTPException(409, "You can save up to 5 places")
    return db.insert("subscriptions", id=db.new_id(), user_id=user["id"], **b.model_dump())


@r.delete("/subscriptions/{sid}")
def del_sub(sid: str, user=Depends(auth.require_user)):
    db.ex("DELETE FROM subscriptions WHERE id=? AND user_id=?", sid, user["id"])
    return {"ok": True}


@r.get("/files/{key:path}")
def files(key: str, token: str = "", user=Depends(auth.current_user)):
    user = user or auth.current_user(f"Bearer {token}")
    if not key.startswith("public/") and not (user and user["role"] in auth.STAFF["ward_officer"]):
        raise HTTPException(404)
    data = storage.read(key)
    if data is None:
        raise HTTPException(404)
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})
