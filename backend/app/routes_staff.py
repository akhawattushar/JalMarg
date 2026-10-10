import json
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import auth, db
from .common import WORK_FLOW, evidence_out, get_incident, incident_out, match_road
from .providers.maps import haversine
from .services import evidence as EV
from .services import matching, risk
from .services.events import notify_fresh, officers, participants, publish

r = APIRouter()
officer, worker, admin = auth.require("ward_officer"), auth.require("worker"), auth.require("admin")
SEV = {"ankle": 1, "knee": 2, "waist": 3, "impassable": 4}
RISK = {"LOW": 0, "MODERATE": 5, "HIGH": 10, "SEVERE": 15}


def priority(inc, t):
    """Severity, affected people, duration, current risk and critical places nearby."""
    hours = (t - inc["created_at"]) / 3600
    score = SEV[inc["severity"]] * 12 + min(20, inc["confirmation_count"] * 4) + min(15, hours * 3) + \
        RISK[risk.assess(inc["lat"], inc["lng"])["level"]] + (10 if inc["critical"] and json.loads(inc["critical"]) else 0)
    return round(score), "P1" if score >= 55 else "P2" if score >= 35 else "P3"


@r.get("/ward/dashboard")
def dashboard(user=Depends(officer)):
    matching.expire_stale()
    t = db.now()
    active = db.q("SELECT * FROM incidents WHERE status='active' AND verification!='rejected'")
    items = []
    for inc in active:
        score, prio = priority(inc, t)
        items.append(incident_out(inc, staff=True) | {"priority_score": score, "priority": prio, "age_s": t - inc["created_at"]})
    items.sort(key=lambda x: -x["priority_score"])
    done = db.q("SELECT created_at, completed_at FROM work_orders WHERE completed_at IS NOT NULL AND created_at>?", t - 30 * 86400)
    daily = db.q("SELECT date(created_at,'unixepoch','+5 hours','+30 minutes') AS day, COUNT(*) AS n FROM incidents "
                 "WHERE created_at>? GROUP BY day ORDER BY day", t - 14 * 86400)
    return {"queue": {"new": [i for i in items if i["age_s"] < 3600], "verified": [i for i in items if i["verification"] == "verified"],
                      "high": [i for i in items if i["severity"] in ("waist", "impassable")],
                      "unassigned": [i for i in items if not i["work_status"]], "aging": [i for i in items if i["age_s"] > 3 * 3600]},
            "incidents": items, "counts": {"active": len(items), "p1": sum(i["priority"] == "P1" for i in items),
                                           "open_work": db.one("SELECT COUNT(*) AS n FROM work_orders WHERE status!='done'")["n"],
                                           "to_verify": db.one("SELECT COUNT(*) AS n FROM work_orders WHERE status='pending_review'")["n"],
                                           "open_issues": db.one("SELECT COUNT(*) AS n FROM feedback WHERE kind='issue' AND status='open'")["n"],
                                           "resolved_30d": db.one("SELECT COUNT(*) AS n FROM incidents WHERE status='resolved' AND resolved_at>?", t - 30 * 86400)["n"]},
            "analytics": {"daily_incidents": daily,
                          "avg_response_min": round(sum(d["completed_at"] - d["created_at"] for d in done) / len(done) / 60) if done else None}}


@r.get("/workers")
def workers(user=Depends(officer)):
    return [{"id": u["id"], "label": f"{u['name']} · {u['employee_id']}" + (f" · {u['ward']}" if u["ward"] else "")}
            for u in db.q("SELECT * FROM users WHERE role='worker' AND status='active' ORDER BY name")]



RATING_SQL = "(SELECT ROUND(AVG(f.rating), 1) FROM feedback f JOIN work_orders w ON w.id=f.work_order_id WHERE w.assignee_id=users.id AND f.kind='rating')"


def wo_out(w):
    w = db.one("SELECT * FROM work_orders WHERE id=?", w["id"])
    inc = db.one("SELECT road_name, locality, lat, lng, severity, status FROM incidents WHERE id=?", w["incident_id"]) or {}
    who = db.one("SELECT name, employee_id FROM users WHERE id=?", w["assignee_id"]) if w["assignee_id"] else None
    ev = db.one("SELECT * FROM evidence WHERE id=?", w["completion_evidence_id"]) if w["completion_evidence_id"] else None
    off_site = round(haversine(w["completion_lat"], w["completion_lng"], inc["lat"], inc["lng"])) if w["completion_lat"] is not None and inc else None
    return w | {"incident": inc, "assignee": who, "completion_evidence": evidence_out(ev, True) if ev else None, "completion_distance_m": off_site}


class WoIn(BaseModel):
    incident_id: str
    assignee_id: str | None = None
    note: str = Field("", max_length=280)


def _worker_or_422(uid):
    if not db.one("SELECT 1 AS x FROM users WHERE id=? AND role='worker' AND status='active'", uid):
        raise HTTPException(422, "Assignee must be an active field worker")


@r.post("/work-orders")
def create_wo(b: WoIn, user=Depends(officer)):
    inc = get_incident(b.incident_id)
    if inc["status"] != "active":
        raise HTTPException(409, "Incident is not active")
    if db.one("SELECT 1 AS x FROM work_orders WHERE incident_id=? AND status!='done'", inc["id"]):
        raise HTTPException(409, "An open work order already exists for this incident")
    if b.assignee_id:
        _worker_or_422(b.assignee_id)
    t, wid = db.now(), db.new_id("WO")
    w = db.insert("work_orders", id=wid, incident_id=inc["id"], status="assigned" if b.assignee_id else "created",
                  priority=priority(inc, t)[1], assignee_id=b.assignee_id, created_by=user["id"], note=b.note, created_at=t, updated_at=t)
    db.audit(user["id"], "work_order.create", wid, inc["id"])
    publish("WORK_CREATED", incident=inc)
    if b.assignee_id:
        notify_fresh([b.assignee_id], inc["id"], "work_assigned", f"New work order {wid}", f"{inc['road_name'] or 'A reported road'} — {inc['severity']} water.")
    return wo_out(w)


@r.get("/work-orders")
def list_wo(user=Depends(worker)):
    if user["role"] == "worker":
        rows = db.q("SELECT * FROM work_orders WHERE assignee_id=? ORDER BY status='done', created_at DESC", user["id"])
    else:
        rows = db.q("SELECT * FROM work_orders ORDER BY status='done', status!='pending_review', created_at DESC LIMIT 150")
    return [wo_out(w) for w in rows]


class WoPatch(BaseModel):
    status: Literal["on_the_way", "in_progress"] | None = None
    assignee_id: str | None = None


def get_wo(wid, user):
    w = db.one("SELECT * FROM work_orders WHERE id=?", wid)
    if not w or (user["role"] == "worker" and w["assignee_id"] != user["id"]):
        raise HTTPException(404, "Work order not found")
    return w


@r.patch("/work-orders/{wid}")
def patch_wo(wid: str, b: WoPatch, user=Depends(worker)):
    """Field workers move their job forward; officers only (re)assign it."""
    w, t = get_wo(wid, user), db.now()
    if w["status"] in ("pending_review", "done"):
        raise HTTPException(409, "This work order is already completed")
    if b.assignee_id:
        if user["role"] == "worker":
            raise HTTPException(403, "Only a ward officer can assign work")
        _worker_or_422(b.assignee_id)
        db.ex("UPDATE work_orders SET assignee_id=?, status='assigned', updated_at=? WHERE id=?", b.assignee_id, t, wid)
        notify_fresh([b.assignee_id], w["incident_id"], "work_assigned", f"New work order {wid}", "You have been assigned a job.")
    if b.status:
        if user["role"] != "worker":
            raise HTTPException(403, "Progress is updated by the assigned field worker")
        cur = db.one("SELECT status FROM work_orders WHERE id=?", wid)["status"]
        if WORK_FLOW.index(b.status) != WORK_FLOW.index(cur) + 1:
            raise HTTPException(409, f"Cannot move from {cur.replace('_', ' ')} to {b.status.replace('_', ' ')}")
        db.ex("UPDATE work_orders SET status=?, updated_at=? WHERE id=?", b.status, t, wid)
        publish("WORK_ON_THE_WAY" if b.status == "on_the_way" else "WORK_STARTED", incident=get_incident(w["incident_id"]))
    if not (b.assignee_id or b.status):
        raise HTTPException(422, "Nothing to update")
    db.audit(user["id"], "work_order.update", wid, b.model_dump_json(exclude_none=True))
    return wo_out(db.one("SELECT * FROM work_orders WHERE id=?", wid))


def resolve(inc, actor):
    db.ex("UPDATE incidents SET status='resolved', resolved_at=? WHERE id=?", db.now(), inc["id"])
    db.audit(actor, "incident.resolve", inc["id"])
    publish("INCIDENT_RESOLVED", incident=inc)


@r.post("/work-orders/{wid}/complete")
def complete_wo(wid: str, photo: UploadFile = File(), lat: float = Form(ge=-90, le=90), lng: float = Form(ge=-180, le=180),
                accuracy: float = Form(gt=0), captured_at: int = Form(0), note: str = Form("", max_length=280), user=Depends(worker)):
    w = get_wo(wid, user)
    if user["role"] != "worker":
        raise HTTPException(403, "Only the assigned field worker can mark work done")
    if w["status"] != "in_progress":
        raise HTTPException(409, "Start the work before marking it done")
    inc = get_incident(w["incident_id"])
    data, img = EV.read_image(photo)
    t = db.now()
    eid = EV.store(data=data, img=img, kind="work", user_id=user["id"], incident_id=inc["id"], report_id=wid, lat=lat, lng=lng,
                   accuracy=accuracy, captured_at=(captured_at // 1000) or t, road=match_road(lat, lng), label="WORK COMPLETED")[0]
    db.ex("UPDATE work_orders SET status='pending_review', completed_at=?, updated_at=?, completion_lat=?, completion_lng=?, completion_note=?, "
          "completion_evidence_id=?, review_note=NULL WHERE id=?", t, t, lat, lng, note.strip(), eid, wid)
    db.audit(user["id"], "work_order.complete", wid)
    notify_fresh(officers(), inc["id"], "review_needed", f"Verify completed work on {inc['road_name'] or 'a reported road'}",
                 f"{user['name'] or 'A field worker'} marked {wid} done with a photo.")
    return {"work_order": wo_out(db.one("SELECT * FROM work_orders WHERE id=?", wid)), "message": "Sent to the ward officer for verification."}


class ReviewIn(BaseModel):
    approve: bool
    note: str = Field("", max_length=280)


@r.post("/work-orders/{wid}/review")
def review_wo(wid: str, b: ReviewIn, user=Depends(officer)):
    w = get_wo(wid, user)
    if w["status"] != "pending_review":
        raise HTTPException(409, "This work order is not awaiting verification")
    if not b.approve and not b.note.strip():
        raise HTTPException(422, "Tell the worker what still needs to be done")
    t, inc = db.now(), get_incident(w["incident_id"])
    if b.approve:
        db.ex("UPDATE work_orders SET status='done', reviewed_by=?, reviewed_at=?, review_note=?, updated_at=? WHERE id=?", user["id"], t, b.note.strip(), t, wid)
        if inc["status"] == "active":
            resolve(inc, user["id"])
    else:
        db.ex("UPDATE work_orders SET status='in_progress', reviewed_by=?, reviewed_at=?, review_note=?, updated_at=? WHERE id=?", user["id"], t, b.note.strip(), t, wid)
        notify_fresh([w["assignee_id"]], inc["id"], "work_rejected", f"Work on {wid} sent back", b.note.strip())
    db.audit(user["id"], "work_order.review", wid, "approved" if b.approve else "sent back")
    return wo_out(db.one("SELECT * FROM work_orders WHERE id=?", wid))


@r.post("/incidents/{iid}/resolve")
def resolve_incident(iid: str, user=Depends(officer)):
    inc = get_incident(iid)
    if inc["status"] != "active":
        raise HTTPException(409, "Incident is not active")
    resolve(inc, user["id"])
    return incident_out(get_incident(iid))


# ---------- Citizen feedback on completed work ----------
def _done_wo_for(wid, user):
    w = db.one("SELECT * FROM work_orders WHERE id=?", wid)
    if not w or w["status"] != "done":
        raise HTTPException(404, "Completed work order not found")
    if user["id"] not in participants(w["incident_id"]):
        raise HTTPException(403, "Only people who reported or confirmed this problem can give feedback")
    return w


class RatingIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: str = Field("", max_length=500)


@r.post("/work-orders/{wid}/rating")
def rate_work(wid: str, b: RatingIn, user=Depends(auth.require_user)):
    w = _done_wo_for(wid, user)
    if db.one("SELECT 1 AS x FROM feedback WHERE work_order_id=? AND user_id=? AND kind='rating'", wid, user["id"]):
        raise HTTPException(409, "You already rated this work")
    db.insert("feedback", id=db.new_id(), work_order_id=wid, incident_id=w["incident_id"], user_id=user["id"], kind="rating",
              rating=b.rating, text=b.text.strip(), created_at=db.now())
    return {"ok": True}


@r.post("/work-orders/{wid}/issue")
def raise_issue(wid: str, photo: UploadFile = File(), text: str = Form(min_length=5, max_length=500), lat: float = Form(ge=-90, le=90),
                lng: float = Form(ge=-180, le=180), accuracy: float = Form(gt=0), captured_at: int = Form(0), user=Depends(auth.require_user)):
    w = _done_wo_for(wid, user)
    inc = get_incident(w["incident_id"])
    if haversine(lat, lng, inc["lat"], inc["lng"]) > 500:
        raise HTTPException(403, "Take the photo within 500 m of the location")
    if db.one("SELECT 1 AS x FROM feedback WHERE work_order_id=? AND user_id=? AND kind='issue' AND status='open'", wid, user["id"]):
        raise HTTPException(409, "You already have an open issue for this work")
    data, img = EV.read_image(photo)
    eid = EV.store(data=data, img=img, kind="issue", user_id=user["id"], incident_id=inc["id"], report_id=wid, lat=lat, lng=lng,
                   accuracy=accuracy, captured_at=(captured_at // 1000) or db.now(), road=match_road(lat, lng), label="CITIZEN ISSUE")[0]
    db.insert("feedback", id=db.new_id(), work_order_id=wid, incident_id=inc["id"], user_id=user["id"], kind="issue", text=text.strip(),
              evidence_id=eid, status="open", created_at=db.now())
    notify_fresh(officers(), inc["id"], "issue_raised", f"Citizen issue on {inc['road_name'] or 'completed work'}", text.strip()[:140])
    return {"ok": True}


@r.get("/ward/issues")
def issues(user=Depends(officer)):
    rows = db.q("SELECT f.*, u.name AS author, u.role, i.road_name, w.assignee_id FROM feedback f JOIN users u ON u.id=f.user_id "
                "JOIN incidents i ON i.id=f.incident_id JOIN work_orders w ON w.id=f.work_order_id "
                "WHERE f.kind='issue' ORDER BY f.status='closed', f.created_at DESC LIMIT 100")
    out = []
    for f in rows:
        ev = db.one("SELECT * FROM evidence WHERE id=?", f["evidence_id"])
        worker_u = db.one("SELECT name, employee_id FROM users WHERE id=?", f["assignee_id"]) if f["assignee_id"] else None
        out.append({k: f[k] for k in ("id", "work_order_id", "incident_id", "text", "status", "note", "created_at", "road_name")}
                   | {"author": f["author"] or auth.mask(f["role"], f["user_id"]), "worker": worker_u, "evidence": evidence_out(ev, True) if ev else None})
    return out


class IssueAction(BaseModel):
    action: Literal["reopen", "close"]
    note: str = Field("", max_length=280)


@r.post("/ward/issues/{fid}")
def handle_issue(fid: str, b: IssueAction, user=Depends(officer)):
    f = db.one("SELECT * FROM feedback WHERE id=? AND kind='issue'", fid)
    if not f or f["status"] != "open":
        raise HTTPException(404, "Open issue not found")
    t, inc = db.now(), get_incident(f["incident_id"])
    db.ex("UPDATE feedback SET status='closed', note=?, handled_by=?, handled_at=? WHERE id=?", b.note.strip(), user["id"], t, fid)
    if b.action == "reopen" and inc["status"] != "active":
        db.ex("UPDATE incidents SET status='active', last_observed_at=?, reopened_count=reopened_count+1 WHERE id=?", t, inc["id"])
        publish("INCIDENT_REOPENED", incident=inc)
    notify_fresh([f["user_id"]], inc["id"], "issue_update", "Your issue was reviewed",
                 ("The incident has been reopened for more work. " if b.action == "reopen" else "The ward officer closed your issue. ") + b.note.strip())
    db.audit(user["id"], f"issue.{b.action}", fid)
    return {"ok": True}


# ---------- Staff management: admins manage officers and workers; officers manage field workers ----------
class StaffIn(BaseModel):
    name: str = Field(min_length=2, max_length=60)
    role: Literal["worker", "ward_officer"]
    ward: str = Field("", max_length=60)
    phone: str | None = Field(None, pattern=r"^\+91[6-9]\d{9}$")


class StaffPatch(BaseModel):
    role: Literal["worker", "ward_officer"] | None = None
    status: Literal["active", "blocked", "removed"] | None = None
    ward: str | None = Field(None, max_length=60)


def _temp_password():
    return "Jm-" + secrets.token_urlsafe(9)


def _manageable(actor, target_role):
    if target_role == "ward_officer" and actor["role"] != "admin":
        raise HTTPException(403, "Only the administrator manages ward officers")


def _staff_member(uid, actor):
    t = db.one("SELECT * FROM users WHERE id=? AND role IN ('worker','ward_officer')", uid)
    if not t:
        raise HTTPException(404, "Staff member not found")
    _manageable(actor, t["role"])
    return t


@r.get("/staff")
def staff(user=Depends(officer)):
    roles = "('worker','ward_officer')" if user["role"] == "admin" else "('worker')"
    return db.q(f"SELECT id, employee_id, name, role, ward, phone, status, must_change_password, created_at, last_seen, {RATING_SQL} AS rating, "  # nosec B608
                "(SELECT COUNT(*) FROM work_orders WHERE assignee_id=users.id AND status='done') AS completed "
                f"FROM users WHERE role IN {roles} AND status!='removed' ORDER BY role DESC, name")


@r.post("/staff")
def create_staff(b: StaffIn, user=Depends(officer)):
    _manageable(user, b.role)
    if b.phone and db.one("SELECT 1 AS x FROM users WHERE phone=?", b.phone):
        raise HTTPException(409, "This phone number already has an account")
    prefix = "JM-OFF-" if b.role == "ward_officer" else "JM-WRK-"
    n = db.one("SELECT COUNT(*) AS n FROM users WHERE employee_id LIKE ?", prefix + "%")["n"] + 1001
    while db.one("SELECT 1 AS x FROM users WHERE employee_id=?", f"{prefix}{n}"):
        n += 1
    pw, eid = _temp_password(), f"{prefix}{n}"
    db.insert("users", id=db.new_id(), employee_id=eid, name=b.name.strip(), role=b.role, ward=(b.ward.strip() or user["ward"]) or None, phone=b.phone,
              status="active", password_hash=auth.hash_password(pw), must_change_password=1, created_by=user["id"], created_at=db.now())
    db.audit(user["id"], "staff.create", eid, b.role)
    return {"employee_id": eid, "temporary_password": pw}


@r.patch("/staff/{uid}")
def patch_staff(uid: str, b: StaffPatch, user=Depends(officer)):
    t = _staff_member(uid, user)
    upd = b.model_dump(exclude_none=True)
    if "role" in upd:
        _manageable(user, "ward_officer")
    if not upd:
        raise HTTPException(422, "Nothing to update")
    db.ex(f"UPDATE users SET {', '.join(f'{k}=?' for k in upd)} WHERE id=?", *upd.values(), uid)  # nosec B608
    if upd.get("status") in ("blocked", "removed"):
        auth.end_all_sessions(uid)
        db.ex("UPDATE work_orders SET assignee_id=NULL, status='created' WHERE assignee_id=? AND status IN ('assigned','on_the_way','in_progress')", uid)
    db.audit(user["id"], "staff.update", t["employee_id"], json.dumps(upd))
    return {"ok": True}


@r.post("/staff/{uid}/reset-password")
def reset_staff_password(uid: str, user=Depends(officer)):
    t = _staff_member(uid, user)
    pw = _temp_password()
    db.ex("UPDATE users SET password_hash=?, must_change_password=1, failed_logins=0, locked_until=NULL WHERE id=?", auth.hash_password(pw), uid)
    auth.end_all_sessions(uid)
    db.audit(user["id"], "staff.reset_password", t["employee_id"])
    return {"employee_id": t["employee_id"], "temporary_password": pw}


@r.get("/admin/reports")
def admin_reports(verification: str | None = None, user=Depends(admin)):
    rows = db.q("SELECT r.*, u.email AS reporter_email, u.name AS reporter_name FROM reports r LEFT JOIN users u ON u.id=r.user_id " +  # nosec B608
                ("WHERE r.verification=? " if verification else "") + "ORDER BY r.created_at DESC LIMIT 100", *([verification] if verification else []))
    out = []
    for rep in rows:
        ev = db.one("SELECT * FROM evidence WHERE id=?", rep["evidence_id"])
        out.append({k: rep[k] for k in ("id", "incident_id", "road_name", "address", "problem_type", "severity", "verification", "gps_accuracy",
                                         "captured_at", "server_received_at", "match_decision", "note", "lat", "lng")}
                   | {"reporter": rep["reporter_name"] or rep["reporter_email"] or auth.mask("citizen", rep["user_id"]), "signals": json.loads(rep["signals"]),
                      "evidence": evidence_out(ev, True) if ev else None})
    return out


class Verdict(BaseModel):
    state: Literal["verified", "likely", "needs_review", "suspicious", "rejected"]


@r.post("/admin/reports/{rid}/verification")
def set_verification(rid: str, b: Verdict, user=Depends(admin)):
    rep = db.one("SELECT * FROM reports WHERE id=?", rid)
    if not rep:
        raise HTTPException(404, "Report not found")
    db.ex("UPDATE reports SET verification=? WHERE id=?", b.state, rid)
    others = db.one("SELECT COUNT(*) AS n FROM reports WHERE incident_id=? AND verification!='rejected'", rep["incident_id"])["n"]
    if b.state == "rejected" and others == 0:
        db.ex("UPDATE incidents SET verification='rejected', status='rejected' WHERE id=?", rep["incident_id"])
    elif b.state in ("verified", "rejected"):
        db.ex("UPDATE incidents SET verification=? WHERE id=?", "verified" if b.state == "verified" else "needs_review", rep["incident_id"])
    db.audit(user["id"], "report.verification", rid, b.state)
    return {"ok": True}


@r.get("/admin/users")
def users(user=Depends(admin)):
    return db.q("SELECT u.id, u.email, u.email_verified, u.phone, u.name, u.address, u.role, u.status, u.created_at, u.last_seen, "
                "(SELECT COUNT(*) FROM reports WHERE user_id=u.id) AS reports, "
                "(SELECT COUNT(*) FROM reports WHERE user_id=u.id AND verification IN ('suspicious','rejected')) AS flagged "
                "FROM users u WHERE role IN ('citizen','commuter') ORDER BY u.created_at DESC LIMIT 200")


class UserPatch(BaseModel):
    role: Literal["citizen", "commuter"] | None = None
    status: Literal["active", "blocked"] | None = None


@r.patch("/admin/users/{uid}")
def patch_user(uid: str, b: UserPatch, user=Depends(admin)):
    if not db.one("SELECT 1 AS x FROM users WHERE id=? AND role IN ('citizen','commuter')", uid):
        raise HTTPException(404, "Citizen not found")
    upd = b.model_dump(exclude_none=True)
    if not upd:
        raise HTTPException(422, "Nothing to update")
    db.ex(f"UPDATE users SET {', '.join(f'{k}=?' for k in upd)} WHERE id=?", *upd.values(), uid)  # nosec B608
    if upd.get("status") == "blocked":
        auth.end_all_sessions(uid)
    db.audit(user["id"], "user.update", uid, json.dumps(upd))
    return {"ok": True}


@r.get("/admin/audit")
def audit_log(user=Depends(admin)):
    return db.q("SELECT a.*, COALESCE(u.employee_id, u.email, u.phone) AS phone FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id "
                "ORDER BY a.created_at DESC LIMIT 200")
