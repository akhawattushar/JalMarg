from conftest import LAT, LNG, photo, report, user

from app import db


def h(u):
    return {"Authorization": u["Authorization"]}


def done_form(lat=LAT, lng=LNG):
    return {"data": {"lat": lat, "lng": lng, "accuracy": 9, "note": "Drain desilted"}, "files": {"photo": ("w.jpg", photo(), "image/jpeg")}}


def test_work_order_lifecycle_with_officer_verification(client):
    citizen, follower, officer, worker = user(), user(), user("ward_officer"), user("worker")
    client.post("/subscriptions", json={"name": "Home", "lat": LAT, "lng": LNG, "radius_m": 1000}, headers=h(follower))
    iid = report(client, citizen).json()["incident"]["id"]
    report(client, user(), lat=LAT + 0.0003)
    assert len([n for n in client.get("/notifications", headers=h(follower)).json() if n["kind"] == "nearby"]) == 1
    assert client.get("/ward/dashboard", headers=h(citizen)).status_code == 403
    assert client.get("/ward/dashboard", headers=h(officer)).json()["counts"]["active"] == 1

    wo = client.post("/work-orders", json={"incident_id": iid, "assignee_id": worker["id"]}, headers=h(officer)).json()
    assert wo["status"] == "assigned" and client.post("/work-orders", json={"incident_id": iid}, headers=h(officer)).status_code == 409
    assert client.patch(f"/work-orders/{wo['id']}", json={"status": "on_the_way"}, headers=h(officer)).status_code == 403
    assert client.post(f"/work-orders/{wo['id']}/complete", headers=h(worker), **done_form()).status_code == 409
    for st in ("on_the_way", "in_progress"):
        assert client.patch(f"/work-orders/{wo['id']}", json={"status": st}, headers=h(worker)).json()["status"] == st
    assert {"work_on_the_way", "work_started"} <= {n["kind"] for n in client.get("/notifications", headers=h(citizen)).json()}
    assert client.post(f"/work-orders/{wo['id']}/complete", data={"lat": LAT, "lng": LNG, "accuracy": 9}, headers=h(worker)).status_code == 422

    assert client.post(f"/work-orders/{wo['id']}/complete", headers=h(worker), **done_form()).json()["work_order"]["status"] == "pending_review"
    assert client.get(f"/incidents/{iid}", headers=h(citizen)).json()["work"]["status"] == "in_progress"
    assert not any(e["kind"] == "work" for e in client.get(f"/incidents/{iid}", headers=h(citizen)).json()["evidence"])
    assert client.post(f"/work-orders/{wo['id']}/review", json={"approve": False}, headers=h(officer)).status_code == 422
    back = client.post(f"/work-orders/{wo['id']}/review", json={"approve": False, "note": "Water still standing"}, headers=h(officer)).json()
    assert back["status"] == "in_progress" and back["review_note"] == "Water still standing"
    assert "work_rejected" in {n["kind"] for n in client.get("/notifications", headers=h(worker)).json()}

    client.post(f"/work-orders/{wo['id']}/complete", headers=h(worker), **done_form())
    assert client.post(f"/work-orders/{wo['id']}/review", json={"approve": True}, headers=h(officer)).json()["status"] == "done"
    assert db.one("SELECT status FROM incidents WHERE id=?", iid)["status"] == "resolved"
    assert "resolved" in {n["kind"] for n in client.get("/notifications", headers=h(citizen)).json()}

    assert client.post(f"/work-orders/{wo['id']}/rating", json={"rating": 4, "text": "Quick"}, headers=h(user())).status_code == 403
    assert client.post(f"/work-orders/{wo['id']}/rating", json={"rating": 4, "text": "Quick"}, headers=h(citizen)).status_code == 200
    assert client.post(f"/work-orders/{wo['id']}/rating", json={"rating": 5}, headers=h(citizen)).status_code == 409
    issue = {"text": "Drain still blocked", "lat": LAT, "lng": LNG, "accuracy": 8}
    assert client.post(f"/work-orders/{wo['id']}/issue", data=issue, headers=h(citizen)).status_code == 422
    pic = lambda: {"photo": ("i.jpg", photo(), "image/jpeg")}  # noqa: E731
    assert client.post(f"/work-orders/{wo['id']}/issue", data={**issue, "lat": LAT + 0.02}, files=pic(), headers=h(citizen)).status_code == 403
    assert client.post(f"/work-orders/{wo['id']}/issue", data=issue, files=pic(), headers=h(citizen)).status_code == 200
    open_issue = client.get("/ward/issues", headers=h(officer)).json()[0]
    assert open_issue["status"] == "open" and open_issue["evidence"]["image_url"]
    client.post(f"/ward/issues/{open_issue['id']}", json={"action": "reopen", "note": "Sending crew back"}, headers=h(officer))
    assert db.one("SELECT status, reopened_count FROM incidents WHERE id=?", iid) == {"status": "active", "reopened_count": 1}
    assert client.get("/staff", headers=h(officer)).json()[0]["rating"] == 4.0


def test_admin_moderation_and_roles(client):
    admin, citizen = user("admin"), user()
    rid = report(client, citizen).json()["report"]["id"]
    assert client.get("/admin/reports", headers=h(citizen)).status_code == 403
    reps = client.get("/admin/reports", headers=h(admin)).json()
    assert reps[0]["evidence"]["original_url"]
    client.post(f"/admin/reports/{rid}/verification", json={"state": "rejected"}, headers=h(admin))
    assert db.one("SELECT status FROM incidents")["status"] == "rejected"
    assert client.patch(f"/admin/users/{citizen['id']}", json={"role": "worker"}, headers=h(admin)).status_code == 422
    client.patch(f"/admin/users/{citizen['id']}", json={"status": "blocked"}, headers=h(admin))
    assert client.get("/me", headers=h(citizen)).status_code == 401  # blocking revokes their sessions
    assert {"user.update", "report.verification"} <= {a["action"] for a in client.get("/admin/audit", headers=h(admin)).json()}


def test_staff_accounts_employee_id_login(client):
    admin, citizen = user("admin"), user()
    assert client.post("/staff", json={"name": "Ravi Kumar", "role": "worker"}, headers=h(citizen)).status_code == 403
    made = client.post("/staff", json={"name": "Ravi Kumar", "role": "worker", "ward": "Ward 12"}, headers=h(admin)).json()
    assert made["employee_id"].startswith("JM-WRK-")
    assert client.post("/auth/staff", json={"employee_id": made["employee_id"], "password": "nope"}).status_code == 401
    r = client.post("/auth/staff", json={"employee_id": made["employee_id"].lower(), "password": made["temporary_password"]}).json()
    sh = {"Authorization": f"Bearer {r['token']}"}
    assert r["user"]["must_change_password"] and r["user"]["name"] == "Ravi Kumar"
    assert client.get("/work-orders", headers=sh).status_code == 403
    client.post("/me/password", json={"new": "drainteam42"}, headers=sh)
    assert client.get("/work-orders", headers=sh).status_code == 200
    assert client.get("/workers", headers=h(user("ward_officer"))).json()[0]["label"].startswith("Ravi Kumar · JM-WRK-")
    for _ in range(5):
        client.post("/auth/staff", json={"employee_id": made["employee_id"], "password": "bad-guess1"})
    assert client.post("/auth/staff", json={"employee_id": made["employee_id"], "password": "drainteam42"}).status_code == 429


def test_profile_name_and_address(client):
    u, staff = user(), user("worker")
    me = client.patch("/me", json={"name": "Asha Verma", "address": "12 MG Road, Beawar"}, headers=h(u)).json()
    assert me["name"] == "Asha Verma" and me["address"] == "12 MG Road, Beawar"
    assert client.patch("/me", json={"name": "A"}, headers=h(u)).status_code == 422
    assert client.patch("/me", json={"name": "Renamed"}, headers=h(staff)).json()["name"] is None


def test_officer_manages_field_workers_only(client):
    officer, admin = user("ward_officer"), user("admin")
    assert client.post("/staff", json={"name": "New Officer", "role": "ward_officer"}, headers=h(officer)).status_code == 403
    made = client.post("/staff", json={"name": "Field Hand", "role": "worker"}, headers=h(officer)).json()
    wid = db.one("SELECT id FROM users WHERE employee_id=?", made["employee_id"])["id"]
    assert [m["employee_id"] for m in client.get("/staff", headers=h(officer)).json()] == [made["employee_id"]]
    assert client.patch(f"/staff/{wid}", json={"role": "ward_officer"}, headers=h(officer)).status_code == 403
    assert client.post(f"/staff/{wid}/reset-password", headers=h(officer)).json()["temporary_password"]
    iid = report(client, user()).json()["incident"]["id"]
    wo = client.post("/work-orders", json={"incident_id": iid, "assignee_id": wid}, headers=h(officer)).json()
    client.patch(f"/staff/{wid}", json={"status": "removed"}, headers=h(officer))
    assert client.get("/staff", headers=h(officer)).json() == []
    assert db.one("SELECT status, assignee_id FROM work_orders WHERE id=?", wo["id"]) == {"status": "created", "assignee_id": None}
    assert client.post("/auth/staff", json={"employee_id": made["employee_id"], "password": "whatever1"}).status_code in (401, 403)
    assert len(client.get("/staff", headers=h(admin)).json()) == 1
