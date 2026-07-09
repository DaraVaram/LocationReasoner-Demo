"""
Zone enrichment helpers: reverse geocoding (address) and current weather.

Both use only the Python standard library (urllib) and free, keyless public
APIs — OpenStreetMap Nominatim for reverse geocoding and Open-Meteo for
current weather/humidity. Results are cached in-process. Every call degrades
gracefully: on any network/parse error it returns None (or a partial dict) so
the demo never crashes because a third-party service is slow or unreachable.
"""

import json
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

# Cache keyed by rounded (lat, lng). Geocode never expires; weather has a TTL.
_GEOCODE_CACHE: Dict[str, Optional[str]] = {}
_WEATHER_CACHE: Dict[str, Dict[str, Any]] = {}
_WEATHER_TTL_SECONDS = 15 * 60

_USER_AGENT = "LocationReasoner-Demo/1.0 (site-selection demo)"

# WMO weather interpretation codes (Open-Meteo)
_WEATHER_CODES = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    66: "Freezing rain", 67: "Freezing rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
    80: "Light showers", 81: "Showers", 82: "Violent showers",
    85: "Snow showers", 86: "Snow showers",
    95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Thunderstorm w/ hail",
}


def _key(lat: float, lng: float) -> str:
    return f"{round(float(lat), 3)},{round(float(lng), 3)}"


def _get_json(url: str, headers: Optional[dict] = None, timeout: int = 12) -> Any:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def reverse_geocode(lat: float, lng: float) -> Optional[str]:
    """Return a short human-readable address for a coordinate, or None on failure."""
    key = _key(lat, lng)
    if key in _GEOCODE_CACHE:
        return _GEOCODE_CACHE[key]

    address: Optional[str] = None
    try:
        url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode({
            "format": "jsonv2", "lat": lat, "lon": lng,
            "zoom": 16, "addressdetails": 1,
        })
        data = _get_json(url, headers={"User-Agent": _USER_AGENT})
        addr = data.get("address", {}) if isinstance(data, dict) else {}
        # Build a compact "locality, city" style label from the most useful parts.
        parts = []
        for field in ("road", "neighbourhood", "suburb", "quarter", "city_district"):
            if addr.get(field):
                parts.append(addr[field])
                break
        for field in ("city", "town", "village", "municipality", "county"):
            if addr.get(field):
                parts.append(addr[field])
                break
        if not parts:
            address = data.get("display_name") if isinstance(data, dict) else None
        else:
            address = ", ".join(parts)
    except Exception as exc:
        print(f"[enrich] reverse_geocode failed for {key}: {exc}")
        address = None

    _GEOCODE_CACHE[key] = address
    return address


def get_weather(lat: float, lng: float) -> Optional[Dict[str, Any]]:
    """Return current weather {temp_c, temp_f, humidity, feels_c, feels_f, code, label}
    for a coordinate, or None on failure. Cached with a short TTL."""
    key = _key(lat, lng)
    cached = _WEATHER_CACHE.get(key)
    if cached and (time.time() - cached["_ts"]) < _WEATHER_TTL_SECONDS:
        return cached["data"]

    try:
        url = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode({
            "latitude": lat, "longitude": lng,
            "current": "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code",
        })
        data = _get_json(url)
        cur = data.get("current", {}) if isinstance(data, dict) else {}
        temp_c = cur.get("temperature_2m")
        feels_c = cur.get("apparent_temperature")
        code = cur.get("weather_code")
        result = {
            "temp_c": temp_c,
            "temp_f": round(temp_c * 9 / 5 + 32, 1) if temp_c is not None else None,
            "feels_c": feels_c,
            "feels_f": round(feels_c * 9 / 5 + 32, 1) if feels_c is not None else None,
            "humidity": cur.get("relative_humidity_2m"),
            "code": code,
            "label": _WEATHER_CODES.get(code, "—"),
        }
    except Exception as exc:
        print(f"[enrich] get_weather failed for {key}: {exc}")
        return None

    _WEATHER_CACHE[key] = {"_ts": time.time(), "data": result}
    return result
