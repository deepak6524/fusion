"""
Real-Time Traffic Data Processing System
FastAPI Backend — Production Ready
"""

import os
import math
import pickle
import logging
from datetime import datetime, timedelta
from typing import List, Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from geopy.geocoders import Nominatim
from geopy.distance import geodesic
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

# ─────────────────────────────────────────
# Logging
# ─────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────
# App Setup
# ─────────────────────────────────────────
app = FastAPI(
    title="Real-Time Traffic Data Processing System",
    description="Simulates real-time traffic processing using ML and time-based modeling.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────
# Global: Load ML Model at Startup
# ─────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "eta_model.pkl")
eta_model = None


@app.on_event("startup")
def load_model():
    """Load the trained ETA model from disk once at startup."""
    global eta_model
    try:
        with open(MODEL_PATH, "rb") as f:
            eta_model = pickle.load(f)
        logger.info("ETA model loaded successfully from %s", MODEL_PATH)
    except FileNotFoundError:
        logger.warning("eta_model.pkl not found — ETA will use fallback formula.")
    except Exception as e:
        logger.error("Failed to load ETA model: %s", e)


# ─────────────────────────────────────────
# Pydantic Schemas
# ─────────────────────────────────────────
class RouteRequest(BaseModel):
    source: str = Field(..., example="New York, USA", description="Starting location name")
    destination: str = Field(..., example="Philadelphia, USA", description="Ending location name")
    time: int = Field(
        ...,
        ge=0,
        le=1439,
        example=8,
        description="Either minutes from now (0–1439) OR hour of day (0–23). Values ≤23 treated as hour; larger values treated as minutes offset.",
    )


class RouteOption(BaseModel):
    name: str
    distance: float  # km
    eta: float       # minutes
    traffic: Literal["Low", "Medium", "High"]


class PredictRouteResponse(BaseModel):
    distance: float
    eta: float
    traffic: Literal["Low", "Medium", "High"]
    traffic_levels: List[int]
    routes: List[RouteOption]


# ─────────────────────────────────────────
# 1. GEOCODING
# ─────────────────────────────────────────
def geocode_location(location_name: str) -> tuple[float, float]:
    """
    Convert a location name string into (latitude, longitude) using Nominatim.
    Raises HTTPException if location is not found or service is unavailable.
    """
    geolocator = Nominatim(user_agent="traffic_system_v1")
    try:
        result = geolocator.geocode(location_name, timeout=10)
        if result is None:
            raise HTTPException(
                status_code=422,
                detail=f"Location not found: '{location_name}'. Please provide a more specific name.",
            )
        logger.info("Geocoded '%s' → (%.5f, %.5f)", location_name, result.latitude, result.longitude)
        return result.latitude, result.longitude
    except GeocoderTimedOut:
        raise HTTPException(status_code=503, detail="Geocoding service timed out. Please retry.")
    except GeocoderServiceError as e:
        raise HTTPException(status_code=503, detail=f"Geocoding service error: {str(e)}")


# ─────────────────────────────────────────
# 2. DISTANCE CALCULATION
# ─────────────────────────────────────────
def calculate_distance(coord1: tuple[float, float], coord2: tuple[float, float]) -> float:
    """
    Compute geodesic (real-world curved-earth) distance in kilometers
    between two (lat, lon) coordinate pairs.
    """
    dist_km = geodesic(coord1, coord2).kilometers
    logger.info("Distance: %.3f km", dist_km)
    return round(dist_km, 3)


# ─────────────────────────────────────────
# 3. HOUR DERIVATION FROM INPUT TIME
# ─────────────────────────────────────────
def derive_hour(time_input: int) -> int:
    """
    Interpret the `time` field:
    - If 0–23  → treat directly as hour of day.
    - If 24–1439 → treat as minutes from now, compute resulting hour.
    Returns an integer hour (0–23).
    """
    if time_input <= 23:
        return time_input
    future_time = datetime.now() + timedelta(minutes=time_input)
    return future_time.hour


# ─────────────────────────────────────────
# 4. ETA PREDICTION (ML MODEL)
# ─────────────────────────────────────────
def predict_eta(distance_km: float, hour: int) -> float:
    """
    Predict travel time in minutes using the trained ML model.
    Falls back to a physics-based formula if no model is loaded.
    Features: [distance, hour]
    """
    global eta_model
    if eta_model is not None:
        try:
            features = np.array([[distance_km, hour]])
            eta_minutes = float(eta_model.predict(features)[0])
            logger.info("ML-predicted ETA: %.2f min", eta_minutes)
            return round(max(eta_minutes, 1.0), 2)
        except Exception as e:
            logger.warning("Model prediction failed (%s), using fallback.", e)

    # Fallback: assume average speed varies by hour
    avg_speed_kmh = _speed_by_hour(hour)
    eta_minutes = (distance_km / avg_speed_kmh) * 60
    logger.info("Fallback ETA: %.2f min (speed=%.1f km/h)", eta_minutes, avg_speed_kmh)
    return round(max(eta_minutes, 1.0), 2)


def _speed_by_hour(hour: int) -> float:
    """Helper: return an estimated average road speed (km/h) based on the hour."""
    if 7 <= hour <= 10 or 17 <= hour <= 20:
        return 12.0   # peak — slow (realistic city traffic)
    elif 11 <= hour <= 16:
        return 22.0   # midday — moderate
    elif 21 <= hour <= 23 or 0 <= hour <= 5:
        return 40.0   # night — fast (open roads)
    else:
        return 28.0   # other


# ─────────────────────────────────────────
# 5. TRAFFIC CLASSIFICATION
# ─────────────────────────────────────────
def classify_traffic(hour: int) -> Literal["Low", "Medium", "High"]:
    """
    Return a traffic level string based on the hour of day:
    - 7–10 AM  → High
    - 5–8 PM   → High
    - 11 AM–4 PM → Medium
    - Otherwise → Low
    """
    if (7 <= hour <= 10) or (17 <= hour <= 20):
        return "High"
    elif 11 <= hour <= 16:
        return "Medium"
    else:
        return "Low"


# ─────────────────────────────────────────
# 6. 24-HOUR TRAFFIC PATTERN GENERATION
# ─────────────────────────────────────────
def generate_traffic_pattern() -> List[int]:
    """
    Simulate a 24-hour traffic intensity array (values 0–100).
    Uses a Gaussian-inspired bell curve centered on peak hours.
    Returns a list of 24 integers.
    """
    base = [0] * 24

    def gaussian(center: float, width: float, peak: int, hours: range) -> None:
        for h in hours:
            val = peak * math.exp(-0.5 * ((h - center) / width) ** 2)
            base[h] = min(100, base[h] + int(val))

    # Morning peak: centered at 8 AM
    gaussian(center=8.0, width=1.2, peak=95, hours=range(5, 13))
    # Evening peak: centered at 6 PM
    gaussian(center=18.0, width=1.2, peak=90, hours=range(14, 23))
    # Night floor (midnight–5 AM): very low
    for h in range(0, 5):
        base[h] = max(base[h], int(5 + 3 * math.sin(h)))  # slight variation

    logger.info("Traffic pattern generated: %s", base)
    return base


# ─────────────────────────────────────────
# 7. ALTERNATIVE ROUTE SIMULATION
# ─────────────────────────────────────────
def generate_routes(distance_km: float, eta_min: float, traffic: str) -> List[RouteOption]:
    """
    Generate 3 route alternatives:
    1. Best Route       — original distance & ETA, actual traffic
    2. Less Traffic     — +10% distance, slightly adjusted ETA, lower traffic
    3. Scenic Route     — +20% distance, higher ETA, always Low traffic
    """
    traffic_order = {"Low": 0, "Medium": 1, "High": 2}
    traffic_levels_list = ["Low", "Medium", "High"]

    def lower_traffic(t: str) -> str:
        idx = max(0, traffic_order[t] - 1)
        return traffic_levels_list[idx]

    best_distance = distance_km
    best_eta = eta_min

    alt_distance = round(distance_km * 1.10, 3)
    alt_eta = round(eta_min * 0.95, 2)  # slightly less time due to less congestion

    scenic_distance = round(distance_km * 1.20, 3)
    scenic_eta = round(eta_min * 1.15, 2)

    routes = [
        RouteOption(
            name="Best Route",
            distance=best_distance,
            eta=best_eta,
            traffic=traffic,
        ),
        RouteOption(
            name="Less Traffic Route",
            distance=alt_distance,
            eta=alt_eta,
            traffic=lower_traffic(traffic),
        ),
        RouteOption(
            name="Scenic Route",
            distance=scenic_distance,
            eta=scenic_eta,
            traffic="Low",
        ),
    ]
    return routes


# ─────────────────────────────────────────
# MAIN ENDPOINT
# ─────────────────────────────────────────
@app.post("/predict-route", response_model=PredictRouteResponse, summary="Predict route ETA & traffic")
def predict_route(request: RouteRequest):
    """
    Full traffic prediction pipeline:
    geocode → distance → ETA (ML) → traffic classification → pattern → routes
    """
    logger.info("Request: source='%s', destination='%s', time=%d",
                request.source, request.destination, request.time)

    # Step 1 — Geocode both locations
    src_coords = geocode_location(request.source)
    dst_coords = geocode_location(request.destination)

    # Step 2 — Distance
    distance_km = calculate_distance(src_coords, dst_coords)

    # Step 3 — Derive hour from time input
    hour = derive_hour(request.time)
    logger.info("Effective hour of day: %d", hour)

    # Step 4 — ETA prediction
    eta_minutes = predict_eta(distance_km, hour)

    # Step 5 — Traffic classification
    traffic = classify_traffic(hour)

    # Step 6 — 24-hour traffic pattern
    traffic_levels = generate_traffic_pattern()

    # Step 7 — Alternative routes
    routes = generate_routes(distance_km, eta_minutes, traffic)

    response = PredictRouteResponse(
        distance=distance_km,
        eta=eta_minutes,
        traffic=traffic,
        traffic_levels=traffic_levels,
        routes=routes,
    )
    logger.info("Response: distance=%.3f km, ETA=%.2f min, traffic=%s", distance_km, eta_minutes, traffic)
    return response


# ─────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────
@app.get("/health", summary="Health check")
def health():
    """Returns server status and whether the ML model is loaded."""
    return {
        "status": "ok",
        "model_loaded": eta_model is not None,
        "model_path": MODEL_PATH,
    }


# ─────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
