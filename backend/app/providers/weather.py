from datetime import UTC, datetime

from .. import config as C
from .http import cached, get

G = "https://weather.googleapis.com/v1/"


def _summary(hourly, past_6h, current, alerts, provider):
    nxt = hourly[:6]
    wet = [h["time"] for h in hourly if h["precip_mm"] >= 2.5]
    return {"provider": provider, "current": current, "hourly": hourly, "alerts": alerts, "past_6h_mm": round(past_6h, 1),
            "next_6h_mm": round(sum(h["precip_mm"] for h in nxt), 1), "next_12h_mm": round(sum(h["precip_mm"] for h in hourly), 1),
            "max_probability": max([h["probability"] or 0 for h in nxt] or [0]), "rain_window": [wet[0], wet[-1]] if wet else None,
            "fetched_at": datetime.now(UTC).isoformat()}


class GoogleWeatherService:
    name = "Google Weather"

    def lookup(self, lat, lng):
        p = {"key": C.GOOGLE_WEATHER_KEY, "location.latitude": lat, "location.longitude": lng}
        cur = get(G + "currentConditions:lookup", params=p)
        fc = get(G + "forecast/hours:lookup", params={**p, "hours": 12})
        hourly = [{"time": h["interval"]["startTime"], "precip_mm": h.get("precipitation", {}).get("qpf", {}).get("quantity", 0) or 0,
                   "probability": h.get("precipitation", {}).get("probability", {}).get("percent")} for h in fc.get("forecastHours", [])]
        try:
            alerts = [{"title": a.get("alertTitle", {}).get("text", ""), "severity": a.get("severity", ""), "until": a.get("expirationTime")}
                      for a in get(G + "publicAlerts:lookup", params=p).get("weatherAlerts", [])]
        except Exception:
            alerts = []
        hist = cur.get("currentConditionsHistory", {})
        current = {"condition": cur.get("weatherCondition", {}).get("description", {}).get("text"),
                   "temp_c": cur.get("temperature", {}).get("degrees"),
                   "feels_c": cur.get("feelsLikeTemperature", {}).get("degrees"), "humidity": cur.get("relativeHumidity"),
                   "precip_mm": cur.get("precipitation", {}).get("qpf", {}).get("quantity"),
                   "wind_kmh": cur.get("wind", {}).get("speed", {}).get("value"),
                   "pressure_hpa": cur.get("airPressure", {}).get("meanSeaLevelMillibars"), "cloud_pct": cur.get("cloudCover")}
        return _summary(hourly, hist.get("qpf", {}).get("quantity", 0) or 0, current, alerts, self.name)


WMO = {0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
       61: "Light rain", 63: "Rain", 65: "Heavy rain", 80: "Rain showers", 81: "Heavy showers", 82: "Violent showers", 95: "Thunderstorm",
       96: "Thunderstorm with hail", 99: "Severe thunderstorm"}


class OpenMeteoWeatherService:
    name = "Open-Meteo"

    def lookup(self, lat, lng):
        r = get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": lat, "longitude": lng, "timezone": "UTC", "past_hours": 6, "forecast_hours": 12,
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m",
            "hourly": "precipitation,precipitation_probability"})
        h, c = r["hourly"], r["current"]
        rows = [{"time": t + "Z", "precip_mm": p or 0, "probability": pr} for t, p, pr in zip(h["time"], h["precipitation"], h["precipitation_probability"])]
        current = {"condition": WMO.get(c.get("weather_code"), "—"), "temp_c": c.get("temperature_2m"),
                   "feels_c": c.get("apparent_temperature"), "humidity": c.get("relative_humidity_2m"),
                   "precip_mm": c.get("precipitation"), "wind_kmh": c.get("wind_speed_10m"), "pressure_hpa": c.get("pressure_msl"),
                   "cloud_pct": c.get("cloud_cover")}
        return _summary(rows[6:], sum(x["precip_mm"] for x in rows[:6]), current, [], self.name)


class MockWeatherService:
    """Tests only."""
    name = "mock"

    def __init__(self, next_mm=0.0, past_mm=0.0):
        self.next_mm, self.past_mm = next_mm, past_mm

    def lookup(self, lat, lng):
        hourly = [{"time": f"2026-10-08T{h:02d}:00:00Z", "precip_mm": self.next_mm / 6 if h < 6 else 0, "probability": 80} for h in range(12)]
        return _summary(hourly, self.past_mm, {"condition": "Rain", "temp_c": 27}, [], self.name)


service = GoogleWeatherService() if C.WEATHER_PROVIDER == "google" else OpenMeteoWeatherService()


def weather(lat, lng):
    """Normalized weather, or None when the provider is unavailable. Never fabricated."""
    try:
        return cached(f"wx:{round(lat, 2)}:{round(lng, 2)}", 600, lambda: service.lookup(lat, lng))
    except Exception as e:
        print("weather unavailable:", e)
        return None
