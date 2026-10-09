import hashlib
import io
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageDraw, ImageFont, ImageOps

from .. import config as C
from .. import db
from ..providers.storage import storage

IST = timezone(timedelta(hours=5, minutes=30))


def read_image(upload: UploadFile):
    data = upload.file.read(C.MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > C.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Photo is larger than {C.MAX_UPLOAD_MB} MB")
    try:
        probe = Image.open(io.BytesIO(data))
        fmt = probe.format
        probe.verify()
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    except Exception:
        raise HTTPException(422, "The photo could not be read. Please retake it.") from None
    if fmt not in ("JPEG", "PNG", "WEBP") or min(img.size) < 200:
        raise HTTPException(422, "Photo is too small or not a supported image")
    return data, img


def watermark(img, lines):
    """Burns evidence context into the pixels. Context, not cryptographic proof."""
    img = img.copy()
    img.thumbnail((1600, 1600))
    w, h = img.size
    fs = max(14, w // 48)
    font = ImageFont.load_default(size=fs)
    pad, lh = fs // 2 + 4, int(fs * 1.35)
    band = len(lines) * lh + pad * 2
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    d.rectangle([0, h - band, w, h], fill=(6, 18, 38, 190))
    for i, line in enumerate(lines):
        d.text((pad, h - band + pad + i * lh), line, font=font, fill=(34, 211, 238, 255) if i == 0 else (255, 255, 255, 255))
    out = io.BytesIO()
    Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB").save(out, "JPEG", quality=85)
    return out.getvalue()


def store(*, data, img, kind, user_id, incident_id, report_id, lat, lng, accuracy, captured_at, road, label):
    t = db.now()
    original_hash = hashlib.sha256(data).hexdigest()
    shot = datetime.fromtimestamp(captured_at, IST).strftime("%d %b %Y | %I:%M:%S %p IST")
    lines = [f"JALMARG — {label}", f"Road: {road.name if road and road.name else 'Not matched'}",
             f"Location: {road.locality if road and road.locality else '—'}", f"GPS: {lat:.6f}, {lng:.6f}",
             f"Captured: {shot}", f"GPS accuracy: ±{round(accuracy)} m", f"Report ID: {report_id or incident_id}"]
    marked = watermark(img, lines)
    eid = db.new_id()
    db.insert("evidence", id=eid, incident_id=incident_id, report_id=report_id, user_id=user_id, kind=kind,
              original_key=storage.put(f"private/{eid}.jpg", data), original_hash=original_hash,
              image_key=storage.put(f"public/{eid}.jpg", marked), image_hash=hashlib.sha256(marked).hexdigest(),
              lat=lat, lng=lng, gps_accuracy=accuracy, captured_at=captured_at, server_received_at=t,
              road_segment_id=road.segment_id if road else None, visual_analysis_status="unavailable", created_at=t)
    return eid, original_hash


def seen_before(original_hash):
    return db.one("SELECT 1 AS x FROM evidence WHERE original_hash=?", original_hash) is not None
