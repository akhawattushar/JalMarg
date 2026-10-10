import math
import threading
import time
from dataclasses import dataclass

from .. import config as C
from .http import ProviderError, cached, get, post


@dataclass
class Road:
    segment_id: str
    name: str | None
    lat: float
    lng: float
    address: str
    locality: str | None


def haversine(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(a))


def dist_to_line(lat, lng, line):
    """Metres from a point to a [[lng, lat], ...] polyline."""
    k = math.cos(math.radians(lat)) * 111320
    px, py, best = lng * k, lat * 110540, math.inf
    for (ax, ay), (bx, by) in zip(line, line[1:]):
        ax, ay, bx, by = ax * k, ay * 110540, bx * k, by * 110540
        dx, dy = bx - ax, by - ay
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(px - ax - t * dx, py - ay - t * dy))
    return best


def decode_polyline(s):
    out, i, lat, lng = [], 0, 0, 0
    while i < len(s):
        for j in range(2):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                res |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if j:
                lng += d
            else:
                lat += d
        out.append([lng / 1e5, lat / 1e5])
    return out


_nominatim_lock, _nominatim_last = threading.Lock(), [0.0]


def nominatim(path, params):
    """Public Nominatim allows at most one request per second; serialise calls and cache results."""
    with _nominatim_lock:
        wait = _nominatim_last[0] + 1.0 - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        try:
            return get(f"https://nominatim.openstreetmap.org/{path}", params={**params, "accept-language": "en"})
        finally:
            _nominatim_last[0] = time.monotonic()


def photon_reverse(lat, lng):
    """Photon (komoot, open source, keyless): fallback geocoder when Nominatim is unavailable."""
    r = get("https://photon.komoot.io/reverse", params={"lat": lat, "lon": lng, "lang": "en", "limit": 1})
    f = (r.get("features") or [None])[0]
    if not f:
        return None
    p = f["properties"]
    parts = [p.get("name"), " ".join(x for x in (p.get("housenumber"), p.get("street")) if x) or None, p.get("district") or p.get("locality"),
             p.get("city"), p.get("state"), p.get("postcode")]
    seen, out = set(), []
    for x in parts:
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return {"address": ", ".join(out), "road": p.get("street") or (p.get("name") if p.get("osm_key") == "highway" else None),
            "locality": p.get("district") or p.get("locality") or p.get("city")}


def _k(lat, lng):
    return f"{round(lat, 4)},{round(lng, 4)}"


class GoogleMapsService:
    name = "google"
    attribution = "Google Maps"

    def _h(self, mask):
        return {"X-Goog-Api-Key": C.GOOGLE_KEY, "X-Goog-FieldMask": mask}

    def match_road(self, lat, lng):
        snap = get("https://roads.googleapis.com/v1/nearestRoads", params={"points": f"{lat},{lng}", "key": C.GOOGLE_KEY})
        pts = snap.get("snappedPoints") or []
        if not pts:
            return None
        pid, loc = pts[0]["placeId"], pts[0]["location"]

        def geocode():
            r = get("https://maps.googleapis.com/maps/api/geocode/json", params={"place_id": pid, "key": C.GOOGLE_KEY})
            return (r.get("results") or [{}])[0]
        g = cached("gplace:" + pid, 86400, geocode)
        comp = {t: c["long_name"] for c in g.get("address_components", []) for t in c["types"]}
        return Road(pid, comp.get("route"), loc["latitude"], loc["longitude"], g.get("formatted_address", ""),
                    comp.get("sublocality_level_1") or comp.get("sublocality") or comp.get("locality"))

    def reverse(self, lat, lng):
        def fetch():
            r = get("https://maps.googleapis.com/maps/api/geocode/json", params={"latlng": f"{lat},{lng}", "key": C.GOOGLE_KEY})
            g = (r.get("results") or [None])[0]
            if not g:
                return None
            comp = {t: c["long_name"] for c in g.get("address_components", []) for t in c["types"]}
            return {"address": g.get("formatted_address", ""), "road": comp.get("route"),
                    "locality": comp.get("sublocality_level_1") or comp.get("sublocality") or comp.get("locality")}
        return cached("grev:" + _k(lat, lng), 86400, fetch)

    def search(self, text, lat, lng):
        r = post("https://places.googleapis.com/v1/places:searchText", headers=self._h("places.displayName,places.formattedAddress,places.location"),
                 json={"textQuery": text, "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 30000}}})
        return [{"name": p["displayName"]["text"], "address": p.get("formattedAddress", ""), "lat": p["location"]["latitude"],
                 "lng": p["location"]["longitude"]} for p in r.get("places", [])]

    def routes(self, o, d):
        r = post("https://routes.googleapis.com/directions/v2:computeRoutes",
                 headers=self._h("routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline"),
                 json={"origin": {"location": {"latLng": {"latitude": o[0], "longitude": o[1]}}},
                       "destination": {"location": {"latLng": {"latitude": d[0], "longitude": d[1]}}},
                       "travelMode": "DRIVE", "computeAlternativeRoutes": True})
        return [{"geometry": decode_polyline(x["polyline"]["encodedPolyline"]), "duration_s": int(x["duration"].rstrip("s")),
                 "distance_m": x["distanceMeters"]} for x in r.get("routes", [])]

    def critical_nearby(self, lat, lng):
        r = post("https://places.googleapis.com/v1/places:searchNearby", headers=self._h("places.displayName,places.primaryType,places.location"),
                 json={"includedTypes": ["hospital", "school", "fire_station", "police"], "maxResultCount": 5,
                       "locationRestriction": {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 500}}})
        return [{"name": p["displayName"]["text"], "type": p.get("primaryType", ""),
                 "distance_m": round(haversine(lat, lng, p["location"]["latitude"], p["location"]["longitude"]))} for p in r.get("places", [])]


class OsmMapService:
    """OpenStreetMap: Nominatim (roads, search), OSRM (routes), Overpass (critical places). Free, keyless, fair-use limits."""
    name = "osm"
    attribution = "© OpenStreetMap contributors"

    def match_road(self, lat, lng):
        r = cached("nroad:" + _k(lat, lng), 86400, lambda: nominatim("reverse", {"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 17, "layer": "address"}))
        a = r.get("address") or {}
        if r.get("category") != "highway" and not a.get("road"):
            return None
        seg = f"osm:{r['osm_type']}:{r['osm_id']}" if r.get("category") == "highway" else f"osm:road:{a['road']}:{round(lat, 3)}:{round(lng, 3)}"
        return Road(seg, a.get("road") or r.get("name"), float(r["lat"]), float(r["lon"]), r.get("display_name", ""),
                    a.get("suburb") or a.get("city_district") or a.get("neighbourhood") or a.get("city"))

    def reverse(self, lat, lng):
        def fetch():
            try:
                r = nominatim("reverse", {"lat": lat, "lon": lng, "format": "jsonv2", "zoom": 18})
            except Exception:
                return photon_reverse(lat, lng)
            if not r.get("display_name"):
                return photon_reverse(lat, lng)
            a = r.get("address") or {}
            return {"address": r["display_name"], "road": a.get("road"),
                    "locality": a.get("suburb") or a.get("city_district") or a.get("neighbourhood") or a.get("city") or a.get("town") or a.get("village")}
        return cached("nrev:" + _k(lat, lng), 86400, fetch)

    def search(self, text, lat, lng):
        d = 0.5

        def fetch():
            try:
                r = nominatim("search", {"q": text, "format": "jsonv2", "limit": 6, "countrycodes": "in", "viewbox": f"{lng - d},{lat + d},{lng + d},{lat - d}"})
                return [{"name": x.get("name") or x["display_name"].split(",")[0], "address": x["display_name"], "lat": float(x["lat"]),
                         "lng": float(x["lon"])} for x in r]
            except Exception:
                r = get("https://photon.komoot.io/api/", params={"q": text, "lat": lat, "lon": lng, "limit": 6, "lang": "en"})
                return [{"name": f["properties"].get("name") or f["properties"].get("street") or text,
                         "address": ", ".join(x for x in (f["properties"].get(k) for k in ("street", "district", "city", "state")) if x),
                         "lat": f["geometry"]["coordinates"][1], "lng": f["geometry"]["coordinates"][0]} for f in r.get("features", [])]
        return cached(f"nsearch:{text.lower()}:{round(lat, 1)},{round(lng, 1)}", 3600, fetch)

    def routes(self, o, d):
        r = get(f"https://router.project-osrm.org/route/v1/driving/{o[1]},{o[0]};{d[1]},{d[0]}",
                params={"alternatives": 3, "overview": "full", "geometries": "geojson"})
        return [{"geometry": x["geometry"]["coordinates"], "duration_s": round(x["duration"]), "distance_m": round(x["distance"])}
                for x in r.get("routes", [])]

    def critical_nearby(self, lat, lng):
        ql = f'[out:json][timeout:8];nwr(around:500,{lat},{lng})[amenity~"^(hospital|school|fire_station|police)$"];out center 5;'
        r = post("https://overpass-api.de/api/interpreter", data={"data": ql})
        out = []
        for e in r.get("elements", []):
            c = e.get("center") or e
            out.append({"name": e.get("tags", {}).get("name", e["tags"]["amenity"].replace("_", " ").title()),
                        "type": e["tags"]["amenity"], "distance_m": round(haversine(lat, lng, c["lat"], c["lon"]))})
        return out


class MockMapService:
    """Tests only. roads: [(segment_id, name, lat, lng, radius_m)]."""
    name, attribution = "mock", "test"

    def __init__(self, roads=()):
        self.roads = list(roads)

    def match_road(self, lat, lng):
        hits = sorted((haversine(lat, lng, la, ln), seg, nm) for seg, nm, la, ln, rad in self.roads if haversine(lat, lng, la, ln) <= rad)
        return Road(hits[0][1], hits[0][2], lat, lng, f"{hits[0][2]}, Test City", "Test Ward") if hits else None

    def search(self, text, lat, lng):
        return [{"name": text, "address": "Test City", "lat": lat + 0.01, "lng": lng + 0.01}]

    def reverse(self, lat, lng):
        road = self.match_road(lat, lng)
        return {"address": road.address if road else "Test City", "road": road.name if road else None, "locality": "Test Ward"}

    def routes(self, o, d):
        straight = [[o[1], o[0]], [d[1], d[0]]]
        return [{"geometry": straight, "duration_s": 600, "distance_m": 2000},
                {"geometry": [straight[0], [(o[1] + d[1]) / 2, (o[0] + d[0]) / 2 + 0.01], straight[1]], "duration_s": 900, "distance_m": 3000}]

    def critical_nearby(self, lat, lng):
        return []


maps = GoogleMapsService() if C.MAP_PROVIDER == "google" else OsmMapService()
__all__ = ["maps", "Road", "ProviderError", "haversine", "dist_to_line"]
