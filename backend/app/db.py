import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager

from . import config as C

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, phone TEXT UNIQUE, employee_id TEXT UNIQUE, name TEXT, ward TEXT,
  address TEXT, role TEXT NOT NULL DEFAULT 'citizen', status TEXT NOT NULL DEFAULT 'active', password_hash TEXT, must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER, created_by TEXT, created_at INTEGER NOT NULL, last_seen INTEGER,
  email TEXT, email_verified INTEGER NOT NULL DEFAULT 0, google_sub TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_sess_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS email_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, expires INTEGER NOT NULL, created_at INTEGER NOT NULL,
  data TEXT);
CREATE INDEX IF NOT EXISTS ix_etok_user ON email_tokens(user_id, kind, created_at);
CREATE TABLE IF NOT EXISTS oauth_states (id TEXT PRIMARY KEY, verifier TEXT NOT NULL, next TEXT, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS road_segments (id TEXT PRIMARY KEY, name TEXT, provider TEXT, locality TEXT, lat REAL, lng REAL);
CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, road_segment_id TEXT, road_name TEXT, locality TEXT, address TEXT,
  lat REAL NOT NULL, lng REAL NOT NULL, problem_type TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  verification TEXT NOT NULL, first_report_id TEXT, created_at INTEGER NOT NULL, last_observed_at INTEGER NOT NULL,
  confirmation_count INTEGER NOT NULL DEFAULT 0, clear_count INTEGER NOT NULL DEFAULT 0, resolved_at INTEGER, reopened_count INTEGER DEFAULT 0,
  critical TEXT);
CREATE INDEX IF NOT EXISTS ix_inc_geo ON incidents(status, lat, lng);
CREATE INDEX IF NOT EXISTS ix_inc_seg ON incidents(road_segment_id);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, incident_id TEXT, report_id TEXT, user_id TEXT, kind TEXT NOT NULL,
  original_key TEXT, original_hash TEXT, image_key TEXT, image_hash TEXT, lat REAL, lng REAL, gps_accuracy REAL,
  captured_at INTEGER, server_received_at INTEGER, road_segment_id TEXT, visual_analysis_status TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS ix_ev_hash ON evidence(original_hash);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, incident_id TEXT NOT NULL, lat REAL, lng REAL,
  gps_accuracy REAL, road_segment_id TEXT, road_name TEXT, address TEXT, problem_type TEXT, severity TEXT, note TEXT,
  captured_at INTEGER, device_time INTEGER, timezone TEXT, server_received_at INTEGER, verification TEXT, signals TEXT,
  evidence_id TEXT, match_decision TEXT, created_at INTEGER);
CREATE INDEX IF NOT EXISTS ix_rep_inc ON reports(incident_id);
CREATE INDEX IF NOT EXISTS ix_rep_user ON reports(user_id, created_at);
CREATE TABLE IF NOT EXISTS interactions (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
  lat REAL, lng REAL, road_segment_id TEXT, evidence_id TEXT, created_at INTEGER, UNIQUE(incident_id, user_id, kind));
CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, user_id TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS work_orders (id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, status TEXT NOT NULL, priority TEXT,
  assignee_id TEXT, created_by TEXT, note TEXT, created_at INTEGER, updated_at INTEGER, completed_at INTEGER,
  completion_lat REAL, completion_lng REAL, completion_note TEXT, completion_evidence_id TEXT);
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL, incident_id TEXT NOT NULL, user_id TEXT NOT NULL,
  kind TEXT NOT NULL, rating INTEGER, text TEXT, evidence_id TEXT, status TEXT, note TEXT, created_at INTEGER, handled_by TEXT, handled_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fb_rating ON feedback(work_order_id, user_id) WHERE kind='rating';
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, incident_id TEXT, kind TEXT NOT NULL,
  title TEXT, body TEXT, created_at INTEGER, read_at INTEGER, UNIQUE(user_id, incident_id, kind));
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, lat REAL, lng REAL, radius_m REAL);
CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, target TEXT, detail TEXT, created_at INTEGER);
"""

_local = threading.local()


def conn():
    c = getattr(_local, "c", None)
    if c is None:
        C.DATA_DIR.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(C.DB_PATH, isolation_level=None, check_same_thread=False, timeout=10)
        c.row_factory = lambda cur, row: {d[0]: v for d, v in zip(cur.description, row)}
        c.execute("PRAGMA journal_mode=WAL")
        _local.c = c
    return c


def init():
    c = conn()
    cols = {r["name"] for r in c.execute("PRAGMA table_info(users)").fetchall()}
    if cols and "employee_id" not in cols:
        c.execute("ALTER TABLE users RENAME TO users_old")
    c.executescript(SCHEMA)
    if cols and "employee_id" not in cols:
        c.execute("INSERT INTO users (id, phone, role, status, created_at, last_seen) SELECT id, phone, role, status, created_at, last_seen FROM users_old")
        c.execute("DROP TABLE users_old")
    for table, col, kind in (("users", "address", "TEXT"), ("work_orders", "review_note", "TEXT"), ("work_orders", "reviewed_by", "TEXT"),
                             ("work_orders", "reviewed_at", "INTEGER"), ("users", "email", "TEXT"), ("users", "email_verified", "INTEGER NOT NULL DEFAULT 0"),
                             ("users", "google_sub", "TEXT")):
        if col not in {r["name"] for r in c.execute(f"PRAGMA table_info({table})").fetchall()}:
            c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {kind}")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(email)")
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_users_google ON users(google_sub)")


def q(sql, *a):
    return conn().execute(sql, a).fetchall()


def one(sql, *a):
    return conn().execute(sql, a).fetchone()


def ex(sql, *a):
    return conn().execute(sql, a).rowcount


@contextmanager
def tx():
    c = conn()
    c.execute("BEGIN IMMEDIATE")
    try:
        yield
        c.execute("COMMIT")
    except BaseException:
        c.execute("ROLLBACK")
        raise


# Queries interpolate only identifiers chosen in code (table names, pydantic-validated field names); every value is bound with "?".
def insert(table, **row):
    conn().execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' * len(row))})", tuple(row.values()))  # nosec B608
    return row


def now():
    return int(time.time())


def new_id(prefix=""):
    s = uuid.uuid4().hex.upper()
    return f"{prefix}-{s[:6]}" if prefix else s.lower()


def audit(actor, action, target, detail=""):
    insert("audit_log", id=new_id(), actor_id=actor, action=action, target=target, detail=detail, created_at=now())
