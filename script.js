/* ============================================================
   FlowRoute — script.js  (API-integrated, deployment-ready)
   Connects to FastAPI backend at /predict-route
   ============================================================ */

"use strict";

/* ──────────────────────────────────────────────
   CONFIG — change BASE_URL when deploying
────────────────────────────────────────────── */
const BASE_URL = window.FLOWROUTE_API_URL || "http://localhost:8000";

/* ──────────────────────────────────────────────
   SHARED UTILITIES
────────────────────────────────────────────── */

/** Format minutes → "Xh Ym" or "Y min" */
function formatDuration(mins) {
  const rounded = Math.round(mins);
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Add minutes to now, return "HH:MM AM/PM" */
function futureTime(addMins) {
  const d = new Date(Date.now() + Math.round(addMins) * 60000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ──────────────────────────────────────────────
   API CALL
────────────────────────────────────────────── */

/**
 * Calls POST /predict-route on the FastAPI backend.
 * @param {string} source
 * @param {string} destination
 * @param {number} timeValue  — hour (0–23) if "now" or offset is ≤23,
 *                              otherwise minutes-from-now (24–1439)
 * @returns {Promise<object>} API response JSON
 */
async function fetchRoute(source, destination, timeValue) {
  const body = { source, destination, time: timeValue };

  const res = await fetch(`${BASE_URL}/predict-route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = `Server error ${res.status}`;
    try {
      const err = await res.json();
      detail = err.detail || detail;
    } catch (_) { /* ignore */ }
    throw new Error(detail);
  }

  return res.json();
}

/* ──────────────────────────────────────────────
   INDEX PAGE LOGIC
────────────────────────────────────────────── */

if (document.getElementById("routeForm")) {
  const form = document.getElementById("routeForm");
  const sourceInput = document.getElementById("source");
  const destInput = document.getElementById("destination");
  const swapBtn = document.getElementById("swapBtn");
  const timeChips = document.querySelectorAll(".time-chips .chip");
  const customWrap = document.getElementById("customTimeWrap");
  const customTime = document.getElementById("customTime");
  const vehicleChips = document.querySelectorAll(".chip-vehicle");
  const submitBtn = document.getElementById("submitBtn");
  const overlay = document.getElementById("loadingOverlay");
  const loadingBar = document.getElementById("loadingBar");
  const loadingMsg = document.getElementById("loadingMsg");
  const loadingStep = document.getElementById("loadingStep");

  let selectedTime = "now";
  let selectedVehicle = "car";

  /* ── Time chip selection ── */
  timeChips.forEach(chip => {
    chip.addEventListener("click", () => {
      timeChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      selectedTime = chip.dataset.value;
      customWrap.classList.toggle("show", selectedTime === "custom");
    });
  });

  /* ── Vehicle chip selection ── */
  vehicleChips.forEach(chip => {
    chip.addEventListener("click", () => {
      vehicleChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      selectedVehicle = chip.dataset.vehicle;
    });
  });

  /* ── Swap source / destination ── */
  swapBtn.addEventListener("click", () => {
    [sourceInput.value, destInput.value] = [destInput.value, sourceInput.value];
  });

  /* ── Geolocation ── */
  document.querySelector(".locate-btn").addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        sourceInput.value = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      },
      () => { sourceInput.value = "Location unavailable"; }
    );
  });

  /* ── Form validation ── */
  function validate() {
    let ok = true;
    const srcErr = document.getElementById("sourceErr");
    const dstErr = document.getElementById("destErr");

    if (!sourceInput.value.trim()) {
      srcErr.classList.add("show");
      sourceInput.classList.add("error-input");
      ok = false;
    } else {
      srcErr.classList.remove("show");
      sourceInput.classList.remove("error-input");
    }

    if (!destInput.value.trim()) {
      dstErr.classList.add("show");
      destInput.classList.add("error-input");
      ok = false;
    } else {
      dstErr.classList.remove("show");
      destInput.classList.remove("error-input");
    }
    return ok;
  }

  /* ── Loading animation sequence (runs while API call is in flight) ── */
  const steps = [
    { msg: "Geocoding your locations…", step: "Resolving coordinates", pct: 14 },
    { msg: "Calculating road distance…", step: "Geodesic distance engine", pct: 30 },
    { msg: "Querying traffic model…", step: "Running ML inference", pct: 50 },
    { msg: "Scoring alternative routes…", step: "Optimising route candidates", pct: 68 },
    { msg: "Building 24-hour traffic forecast…", step: "Applying time-series model", pct: 82 },
    { msg: "Generating smart insights…", step: "Compiling recommendations", pct: 94 },
    { msg: "Ready!", step: "Complete", pct: 100 },
  ];

  let loadingInterval = null;

  function startLoadingAnimation() {
    overlay.classList.add("active");
    let i = 0;
    function tick() {
      if (i >= steps.length) return;
      const s = steps[i++];
      loadingMsg.textContent = s.msg;
      loadingStep.textContent = s.step;
      loadingBar.style.width = s.pct + "%";
    }
    tick();
    loadingInterval = setInterval(tick, 600);
  }

  function stopLoadingAnimation() {
    clearInterval(loadingInterval);
    loadingBar.style.width = "100%";
    loadingMsg.textContent = "Ready!";
    loadingStep.textContent = "Complete";
  }

  function hideOverlay() {
    overlay.classList.remove("active");
  }

  /* ── Show API error inside overlay ── */
  function showOverlayError(msg) {
    stopLoadingAnimation();
    loadingMsg.textContent = "Something went wrong";
    loadingStep.textContent = msg;
    loadingBar.style.background = "#EF4444";
    setTimeout(() => {
      hideOverlay();
      loadingBar.style.background = "";
      // Re-enable submit
      submitBtn.querySelector(".btn-text").style.display = "";
      submitBtn.querySelector(".btn-loader").style.display = "none";
      submitBtn.disabled = false;
    }, 3000);
  }

  /* ──  Resolve time → integer the backend understands ── */
  function resolveTimeParam(selectedTime, customTimeEl) {
    const now = new Date();
    if (selectedTime === "now") return now.getHours();           // 0-23
    if (selectedTime === "15") return 15;                        // minutes offset
    if (selectedTime === "30") return 30;
    if (selectedTime === "custom" && customTimeEl.value) {
      const [hh, mm] = customTimeEl.value.split(":").map(Number);
      const target = new Date(); target.setHours(hh, mm, 0, 0);
      const diffMins = Math.max(0, Math.round((target - now) / 60000));
      return diffMins <= 23 ? hh : diffMins; // if same hour, use hour directly
    }
    return now.getHours();
  }

  /* ── Departure label for display ── */
  function resolveDepartureLabel(selectedTime, customTimeEl) {
    if (selectedTime === "now") return "Now";
    if (selectedTime === "15") return "In 15 min";
    if (selectedTime === "30") return "In 30 min";
    if (selectedTime === "custom" && customTimeEl.value) return customTimeEl.value;
    return "Now";
  }

  /* ── Form submit ── */
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!validate()) return;

    const source = sourceInput.value.trim();
    const destination = destInput.value.trim();
    const timeParam = resolveTimeParam(selectedTime, customTime);
    const depLabel = resolveDepartureLabel(selectedTime, customTime);

    // Disable UI & start animation
    submitBtn.querySelector(".btn-text").style.display = "none";
    submitBtn.querySelector(".btn-loader").style.display = "flex";
    submitBtn.disabled = true;
    startLoadingAnimation();

    try {
      const apiData = await fetchRoute(source, destination, timeParam);

      stopLoadingAnimation();

      // Stash everything result.html needs
      const payload = {
        source,
        destination,
        departureLabel: depLabel,
        vehicle: selectedVehicle,
        // API response fields:
        distance: apiData.distance,
        eta: apiData.eta,
        traffic: apiData.traffic,
        traffic_levels: apiData.traffic_levels,
        routes: apiData.routes,
      };
      sessionStorage.setItem("flowroute_data", JSON.stringify(payload));

      // Short pause so the 100% bar is visible
      setTimeout(() => {
        hideOverlay();
        window.location.href = "result.html";
      }, 400);

    } catch (err) {
      showOverlayError(err.message);
    }
  });
}

/* ──────────────────────────────────────────────
   RESULT PAGE LOGIC
────────────────────────────────────────────── */

if (document.getElementById("r-source")) {

  const raw = sessionStorage.getItem("flowroute_data");
  if (!raw) { window.location.href = "index.html"; }

  const data = JSON.parse(raw);
  const {
    source, destination, departureLabel, vehicle,
    distance, eta, traffic, traffic_levels, routes,
  } = data;

  /* ── Derived values ── */
  const travelMins = Math.round(eta);
  const arrivalMins = travelMins; // departure is "now" or offset is already baked into ETA
  const baseDist = distance;

  const fuelRates = { car: 8, bike: 4, truck: 14, transit: 0 };
  const fuelLitres = ((baseDist / 100) * (fuelRates[vehicle] || 8)).toFixed(1);
  const fuelCost = vehicle === "transit" ? "₹ 0" : `₹ ${Math.round(fuelLitres * 100)}`;
  const co2Saved = (baseDist * 0.004).toFixed(1);           // rough estimate
  const effectiveSpeed = travelMins > 0
    ? Math.round((baseDist / travelMins) * 60)
    : 0;

  const trafficSubMap = {
    Low: "Smooth flow — enjoy the ride!",
    Medium: "Moderate congestion ahead.",
    High: "Heavy traffic — consider alternatives!",
  };
  const trafficSub = trafficSubMap[traffic] || "";

  const trafficPctMap = { Low: 28, Medium: 58, High: 86 };
  const trafficPct = trafficPctMap[traffic] || 28;

  /* ── Populate DOM ── */
  function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // Journey bar
  set("r-source", source);
  set("r-dest", destination);
  set("r-departure", departureLabel);
  set("r-vehicle", vehicle.charAt(0).toUpperCase() + vehicle.slice(1));

  // ETA card
  set("r-eta", futureTime(arrivalMins));
  set("r-duration", `${formatDuration(travelMins)} travel time`);

  const etaBadge = document.getElementById("r-eta-badge");
  if (traffic === "High") { etaBadge.textContent = "Delayed"; etaBadge.classList.add("red"); }
  else if (traffic === "Medium") { etaBadge.textContent = "Moderate"; etaBadge.classList.add("amber"); }
  else { etaBadge.textContent = "On Time"; }

  // Traffic card
  set("r-traffic", traffic);
  set("r-traffic-sub", trafficSub);

  const trafficColorMap = { Low: "#22C55E", Medium: "#F59E0B", High: "#EF4444" };
  const meter = document.getElementById("r-meter");
  meter.style.background = trafficColorMap[traffic];
  setTimeout(() => { meter.style.width = Math.min(trafficPct, 100) + "%"; }, 300);

  const tIcon = document.getElementById("r-traffic-icon");
  if (traffic === "High")
    tIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#EF4444"></i>';
  else if (traffic === "Medium")
    tIcon.innerHTML = '<i class="fa-solid fa-gauge" style="color:#F59E0B"></i>';
  else
    tIcon.innerHTML = '<i class="fa-solid fa-gauge-simple-high" style="color:#22C55E"></i>';

  // Distance card
  set("r-distance", `${baseDist} km`);
  set("r-speed", `Avg speed: ${effectiveSpeed} km/h`);

  // Fuel card
  set("r-fuel", fuelCost);
  set("r-emission", `CO₂ saved: ${co2Saved} kg`);
  const fuelBadge = document.getElementById("r-fuel-badge");
  if (vehicle === "transit") { fuelBadge.textContent = "Eco"; fuelBadge.style.color = "#22C55E"; }
  else if (fuelLitres > 3) { fuelBadge.textContent = "High Use"; fuelBadge.classList.add("red"); }

  /* ── Routes from API ── */
  // routes[] = [{ name, distance, eta, traffic }, ...]
  const bestRoute = routes[0];
  const altRoutes = routes.slice(1);

  // Best route card
  set("r-best-name", bestRoute.name);
  set("r-best-time", formatDuration(bestRoute.eta));
  set("r-best-dist", `${bestRoute.distance} km`);
  set("r-best-speed", `${Math.round((bestRoute.distance / bestRoute.eta) * 60)} km/h avg`);

  const bestTrafficBadge = document.getElementById("r-best-traffic-badge");
  bestTrafficBadge.textContent = bestRoute.traffic;
  bestTrafficBadge.classList.add("traffic-" + bestRoute.traffic.toLowerCase());

  const stepsContainer = document.getElementById("r-best-steps");
  stepsContainer.innerHTML = [
    { text: `Depart from <strong>${source}</strong>` },
    { text: "Take the fastest available road segment" },
    { text: "Continue on the primary route corridor" },
    { text: `Arrive at <strong>${destination}</strong>` },
  ].map(s => `
    <div class="step-item">
      <div class="step-bullet"></div>
      <div>${s.text}</div>
    </div>
  `).join("");

  // Alt routes
  const altContainer = document.getElementById("r-alt-routes");
  set("r-alt-count", `${altRoutes.length} option${altRoutes.length !== 1 ? "s" : ""}`);

  const altNotes = [
    "Less congested — may save time",
    "Quieter roads, scenic detour",
    "Via ring road / bypass",
  ];
  altContainer.innerHTML = altRoutes.map((r, i) => `
    <div class="alt-route-item">
      <div class="alt-route-top">
        <span class="alt-route-name">${r.name}</span>
        <span class="alt-route-time">${formatDuration(r.eta)}</span>
      </div>
      <div class="alt-route-meta">
        <span><i class="fa-solid fa-road" style="color:#2DD4BF"></i> ${r.distance} km</span>
        <span class="traffic-indicator traffic-${r.traffic.toLowerCase()}">${r.traffic}</span>
        <span>${altNotes[i] || ""}</span>
      </div>
    </div>
  `).join("");

  /* ── 24-hour traffic timeline from API ── */
  // traffic_levels is a 24-element array (0–100)
  const timelineContainer = document.getElementById("r-timeline");

  function trafficLevelFromValue(v) {
    if (v < 40) return "low";
    if (v < 70) return "medium";
    return "high";
  }
  function trafficColor(level) {
    if (level === "low") return "#22C55E";
    if (level === "medium") return "#F59E0B";
    return "#EF4444";
  }

  // Show every 2nd hour for readability (12 bars from 24 hours)
  const sampledHours = traffic_levels
    .map((val, h) => ({ h, val }))
    .filter((_, i) => i % 2 === 0);          // hours 0,2,4,…22

  timelineContainer.innerHTML = sampledHours.map(({ h, val }) => {
    const level = trafficLevelFromValue(val);
    const heightPct = Math.max(8, val);       // min 8% so bars are always visible
    const label = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
    return `
      <div class="timeline-bar"
           style="height:${heightPct}%;background:${trafficColor(level)};position:relative;"
           title="${label}: ${val}% congestion">
        <div class="timeline-bar-label">${label}</div>
      </div>
    `;
  }).join("");

  /* ── Tips (traffic-aware) ── */
  const allTips = [
    { icon: "fa-music", title: "Fuel Up & Tune In", text: "Perfect time for your playlist — the route has stretches of open road." },
    { icon: "fa-droplet", title: "Stay Hydrated", text: "A long drive ahead — keep a water bottle within reach." },
    { icon: "fa-traffic-light", title: "Signal Strategy", text: "Expect traffic signals en route. Budget a few extra minutes for stops." },
    { icon: "fa-cloud-sun", title: "Weather Advisory", text: "Check local weather; conditions can affect travel by 10–15 min." },
    { icon: "fa-coins", title: "Toll Ahead", text: "This route may have toll plazas. Keep exact change or FASTag ready." },
    { icon: "fa-rotate-right", title: "Consider Alternatives", text: traffic === "High" ? "Heavy traffic detected. Alternative routes may save 15+ min." : "Route looks clear — your selected path is optimal." },
    { icon: "fa-parking", title: "Parking Note", text: "Destination may have limited parking during peak hours." },
    { icon: "fa-battery-full", title: "EV Tip", text: "Charging stations may be available near the midpoint of your journey." },
  ];

  // Always show the traffic-specific tip + 3 others
  const trafficTip = allTips[5];
  const otherTips = allTips.filter((_, i) => i !== 5).slice(0, 3);
  const tipsToShow = [trafficTip, ...otherTips];

  const tipsContainer = document.getElementById("r-tips");
  tipsContainer.innerHTML = tipsToShow.map(t => `
    <div class="tip-item">
      <div class="tip-icon"><i class="fa-solid ${t.icon}"></i></div>
      <div class="tip-text"><strong>${t.title}</strong>${t.text}</div>
    </div>
  `).join("");

  /* ── Reveal animations ── */
  const revealEls = document.querySelectorAll(".reveal-item");
  revealEls.forEach((el, i) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(20px)";
    el.style.transition = `opacity 0.5s ease ${i * 0.07}s, transform 0.5s ease ${i * 0.07}s`;
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
  });
}
