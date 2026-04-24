"""
train_model.py
──────────────
Trains a Gradient Boosting regression model to predict travel time (ETA in minutes)
from distance (km) and hour of day. Saves the model as eta_model.pkl.

Run once before starting the FastAPI server:
    python train_model.py
"""

import pickle
import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error

# ─────────────────────────────────────────
# Synthetic Training Data Generation
# ─────────────────────────────────────────

def generate_training_data(n_samples: int = 5000) -> tuple[np.ndarray, np.ndarray]:
    """
    Generate realistic synthetic (distance, hour) → ETA samples.

    Speed model:
    - Peak hours (7–10, 17–20): 20–30 km/h
    - Midday (11–16):           40–55 km/h
    - Night (21–6):             60–80 km/h
    Noise is added to simulate real-world variance.
    """
    rng = np.random.default_rng(42)

    distances = rng.uniform(1, 500, n_samples)   # km: short city trip to inter-city
    hours = rng.integers(0, 24, n_samples)       # hour of day: 0–23

    etas = np.zeros(n_samples)
    for i in range(n_samples):
        h = int(hours[i])
        d = distances[i]

        if (7 <= h <= 10) or (17 <= h <= 20):
            speed = rng.uniform(18, 32)      # heavy traffic
        elif 11 <= h <= 16:
            speed = rng.uniform(38, 55)      # moderate
        elif 21 <= h <= 23 or 0 <= h <= 5:
            speed = rng.uniform(58, 82)      # light night traffic
        else:
            speed = rng.uniform(45, 65)      # transition hours

        # Base ETA + proportional noise
        eta = (d / speed) * 60
        noise = rng.normal(0, eta * 0.05)    # ±5% noise
        etas[i] = max(1.0, eta + noise)

    X = np.column_stack([distances, hours])
    y = etas
    return X, y


# ─────────────────────────────────────────
# Train
# ─────────────────────────────────────────
print("Generating training data...")
X, y = generate_training_data(n_samples=8000)

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

print("Training Gradient Boosting model...")
model = GradientBoostingRegressor(
    n_estimators=200,
    learning_rate=0.08,
    max_depth=4,
    subsample=0.85,
    random_state=42,
)
model.fit(X_train, y_train)

# ─────────────────────────────────────────
# Evaluate
# ─────────────────────────────────────────
y_pred = model.predict(X_test)
mae = mean_absolute_error(y_test, y_pred)
print(f"Model MAE on test set: {mae:.2f} minutes")

# ─────────────────────────────────────────
# Save
# ─────────────────────────────────────────
MODEL_PATH = "eta_model.pkl"
with open(MODEL_PATH, "wb") as f:
    pickle.dump(model, f)

print(f"✅ Model saved to {MODEL_PATH}")

# Quick sanity check
import os
size_kb = os.path.getsize(MODEL_PATH) / 1024
print(f"   File size: {size_kb:.1f} KB")

sample_features = np.array([
    [150, 8],    # 150 km at 8 AM (peak) → expect slow
    [150, 14],   # 150 km at 2 PM (midday)
    [150, 22],   # 150 km at 10 PM (night) → expect fast
])
predictions = model.predict(sample_features)
for (d, h), eta in zip(sample_features, predictions):
    print(f"   Distance={d:.0f} km, Hour={h:.0f} → Predicted ETA: {eta:.1f} min")
