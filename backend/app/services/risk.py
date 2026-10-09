from .. import db
from ..providers.maps import haversine
from ..providers.weather import weather

LEVELS = ((70, "SEVERE"), (45, "HIGH"), (20, "MODERATE"), (0, "LOW"))


def assess(lat, lng):
    """Explainable rule-based waterlogging risk. Weather is one input, never the whole model."""
    wx, score, factors = weather(lat, lng), 0, []
    if wx:
        n6, p6 = wx["next_6h_mm"], wx["past_6h_mm"]
        score += 35 if n6 >= 50 else 25 if n6 >= 20 else 15 if n6 >= 7.5 else 7 if n6 >= 2.5 else 0
        score += 15 if p6 >= 30 else 8 if p6 >= 10 else 0
        factors += [f"Expected rainfall, next 6 h: {n6} mm", f"Rainfall, last 6 h: {p6} mm"]
        if wx["rain_window"]:
            factors.append("Rain window: " + " – ".join(wx["rain_window"]))
    else:
        factors.append("Weather data unavailable — risk uses community evidence only")
    d = 0.015
    near = [r for r in db.q("SELECT lat, lng, status, confirmation_count, created_at FROM incidents WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                            lat - d, lat + d, lng - d, lng + d) if haversine(lat, lng, r["lat"], r["lng"]) <= 1500]
    active = [r for r in near if r["status"] == "active"]
    confirmed = sum(r["confirmation_count"] for r in active)
    history = sum(1 for r in near if r["created_at"] > db.now() - 30 * 86400)
    score += min(25, 8 * len(active)) + min(10, 2 * confirmed) + min(15, 3 * history)
    factors += [f"Active waterlogging reports within 1.5 km: {len(active)}", f"Community confirmations: {confirmed}",
                f"Incidents here in the last 30 days: {history}"]
    level = next(name for floor, name in LEVELS if score >= floor)
    return {"level": level, "score": score, "factors": factors, "weather_available": wx is not None,
            "statement": f"JalMarg estimates {level} waterlogging risk based on "
                         f"{'current and forecast weather, ' if wx else ''}incident history and current community evidence."}
