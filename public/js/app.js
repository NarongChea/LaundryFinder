// ===== STATE =====
const state = {
  map: null,
  userMarker: null,
  placeMarkers: [],
  places: [],
  sortedPlaces: [],
  selectedRadius: 500,
  userLat: null,
  userLng: null,
  selectedId: null,
  radiusCircle: null,
};

// ===== DOM REFS =====
const $ = (id) => document.getElementById(id);
const btnLocate = $("btnLocate");
const btnStart = $("btnStart");
const listContainer = $("listContainer");
const resultsCount = $("resultsCount");
const detailPanel = $("detailPanel");
const detailContent = $("detailContent");
const detailClose = $("detailClose");
const mapOverlay = $("mapOverlay");
const overlayMsg = $("overlayMsg");
const toast = $("toast");
const sortSelect = $("sortSelect");
const locationBanner = $("locationBanner");
const locAddress = $("locAddress");
const locCoords = $("locCoords");

// ===== INIT MAP =====
function initMap() {
  state.map = new google.maps.Map($("map"), {
    center: { lat: 11.5564, lng: 104.9282 }, // Phnom Penh default
    zoom: 15,
    styles: mapStyles,
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: true,
    fullscreenControl: true,
  });

  mapOverlay.classList.add("hidden");
  showToast("🗺️ Map ready — click Locate Me!");
}

// ===== LOCATE USER =====
async function locateUser() {
  if (!navigator.geolocation) {
    showToast("❌ Geolocation not supported by your browser");
    return;
  }

  btnLocate.classList.add("loading");
  btnLocate.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Locating…`;
  showLoadingList();

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.userLat = pos.coords.latitude;
      state.userLng = pos.coords.longitude;
      placeUserMarker(state.userLat, state.userLng);
      showLocationBanner(state.userLat, state.userLng);
      await searchLaundry();
      resetLocateBtn();
    },
    (err) => {
      resetLocateBtn();
      const msgs = {
        1: "Location access denied. Please allow location in browser settings.",
        2: "Could not determine your location.",
        3: "Location request timed out.",
      };
      showToast("❌ " + (msgs[err.code] || "Location error"));
      showEmptyState();
    },
    { timeout: 12000, enableHighAccuracy: true }
  );
}

// ===== SHOW LOCATION BANNER =====
async function showLocationBanner(lat, lng) {
  locationBanner.style.display = "flex";
  locAddress.textContent = "Detecting address…";
  locCoords.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  try {
    const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    if (data.address) {
      locAddress.textContent = data.address;
    }
  } catch {
    locAddress.textContent = "Location detected";
  }
}

function resetLocateBtn() {
  btnLocate.classList.remove("loading");
  btnLocate.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg> Locate Me`;
}

// ===== USER MARKER =====
function placeUserMarker(lat, lng) {
  if (state.userMarker) state.userMarker.setMap(null);
  if (state.radiusCircle) state.radiusCircle.setMap(null);

  state.userMarker = new google.maps.Marker({
    position: { lat, lng },
    map: state.map,
    title: "You are here",
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: "#00c4a7",
      fillOpacity: 1,
      strokeColor: "#fff",
      strokeWeight: 3,
    },
    zIndex: 999,
  });

  state.radiusCircle = new google.maps.Circle({
    center: { lat, lng },
    radius: state.selectedRadius,
    map: state.map,
    fillColor: "#00c4a7",
    fillOpacity: 0.07,
    strokeColor: "#00c4a7",
    strokeOpacity: 0.4,
    strokeWeight: 1.5,
  });

  state.map.setCenter({ lat, lng });
  const zoomMap = { 300: 17, 500: 16, 1000: 15, 2000: 14, 5000: 13, 10000: 12 };
  state.map.setZoom(zoomMap[state.selectedRadius] || 15);
}

// ===== SEARCH =====
async function searchLaundry() {
  if (!state.userLat) return;
  showLoadingList();
  clearMarkers();

  try {
    const res = await fetch(`/api/nearby?lat=${state.userLat}&lng=${state.userLng}&radius=${state.selectedRadius}`);
    const data = await res.json();

    if (data.error) {
      showToast("❌ " + data.error);
      showEmptyState();
      return;
    }

    state.places = data.results || [];
    sortAndRender();
    showToast(
      state.places.length > 0
        ? `🧺 Found ${state.places.length} laundry shop${state.places.length > 1 ? "s" : ""} nearby!`
        : "😕 No laundry shops found. Try a larger radius."
    );
  } catch (err) {
    showToast("❌ Server error. Is the backend running?");
    showEmptyState();
  }
}

// ===== SORT & RENDER =====
function sortAndRender() {
  const sort = sortSelect.value;
  state.sortedPlaces = [...state.places];

  if (sort === "distance") {
    state.sortedPlaces.sort((a, b) => dist(a) - dist(b));
  } else if (sort === "rating") {
    state.sortedPlaces.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  } else if (sort === "name") {
    state.sortedPlaces.sort((a, b) => a.name.localeCompare(b.name));
  }

  renderList();
  renderMarkers();
  resultsCount.textContent = state.places.length;
}

function dist(place) {
  return haversine(state.userLat, state.userLng, place.geometry.location.lat, place.geometry.location.lng);
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

// ===== RENDER LIST =====
function renderList() {
  if (state.sortedPlaces.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No laundry found</div>
        <div class="empty-desc">Try increasing the search radius using the buttons above.</div>
      </div>`;
    return;
  }

  listContainer.innerHTML = state.sortedPlaces
    .map((p, i) => {
      const d = fmtDist(dist(p));
      const open = p.opening_hours;
      const statusClass = !open ? "status-unknown" : open.open_now ? "status-open" : "status-closed";
      const statusText = !open ? "Hours unknown" : open.open_now ? "Open now" : "Closed";
      const stars = p.rating ? "★".repeat(Math.round(p.rating)) + "☆".repeat(5 - Math.round(p.rating)) : "";

      return `
        <div class="place-card" data-id="${p.place_id}" data-idx="${i}" style="animation-delay:${i * 0.04}s">
          <div class="card-top">
            <div class="card-name">${p.name}</div>
            <span class="card-status ${statusClass}">${statusText}</span>
          </div>
          <div class="card-meta">
            ${p.rating ? `<span class="card-rating">★ ${p.rating.toFixed(1)}</span><span class="card-reviews">(${p.user_ratings_total || 0})</span>` : ""}
            <span class="card-dist">📍 ${d}</span>
          </div>
          ${p.vicinity ? `<div class="card-addr">${p.vicinity}</div>` : ""}
          <div class="card-actions">
            <button class="card-btn primary" onclick="openDetail('${p.place_id}')">Details</button>
            <button class="card-btn" onclick="navigateTo(${p.geometry.location.lat},${p.geometry.location.lng},'${encodeURIComponent(p.name)}')">🧭 Navigate</button>
            <button class="card-btn" onclick="focusMarker('${p.place_id}')">🗺️ Map</button>
          </div>
        </div>`;
    })
    .join("");

  // Click to highlight
  document.querySelectorAll(".place-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".card-btn")) return;
      const id = card.dataset.id;
      highlightCard(id);
      focusMarker(id);
    });
  });
}

function highlightCard(id) {
  document.querySelectorAll(".place-card").forEach((c) => c.classList.remove("active"));
  const card = document.querySelector(`[data-id="${id}"]`);
  if (card) {
    card.classList.add("active");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  state.selectedId = id;
}

// ===== MARKERS =====
function renderMarkers() {
  clearMarkers();
  state.sortedPlaces.forEach((p, i) => {
    const open = p.opening_hours;
    const color = !open ? "#7fa8b8" : open.open_now ? "#00e59b" : "#ff5a6e";

    const marker = new google.maps.Marker({
      position: { lat: p.geometry.location.lat, lng: p.geometry.location.lng },
      map: state.map,
      title: p.name,
      icon: {
        path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
        fillColor: color,
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 1.5,
        scale: 1.6,
        anchor: new google.maps.Point(12, 22),
      },
      label: {
        text: "🧺",
        fontSize: "12px",
      },
      zIndex: 100 + i,
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `
        <div style="font-family:'Outfit',sans-serif;padding:4px 2px;min-width:180px">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${p.name}</div>
          ${p.rating ? `<div style="color:#ffc542;font-size:12px">★ ${p.rating.toFixed(1)} (${p.user_ratings_total || 0} reviews)</div>` : ""}
          <div style="color:#666;font-size:11px;margin-top:4px">${p.vicinity || ""}</div>
          <div style="margin-top:8px">
            <button onclick="openDetail('${p.place_id}')" style="background:#00c4a7;color:#0a1628;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer">View Details</button>
          </div>
        </div>`,
    });

    marker.addListener("click", () => {
      state.placeMarkers.forEach((m) => m._iw && m._iw.close());
      infoWindow.open(state.map, marker);
      highlightCard(p.place_id);
    });

    marker._iw = infoWindow;
    state.placeMarkers.push(marker);
  });
}

function clearMarkers() {
  state.placeMarkers.forEach((m) => {
    if (m._iw) m._iw.close();
    m.setMap(null);
  });
  state.placeMarkers = [];
}

function focusMarker(placeId) {
  const idx = state.sortedPlaces.findIndex((p) => p.place_id === placeId);
  if (idx < 0) return;
  const place = state.sortedPlaces[idx];
  state.map.setCenter({ lat: place.geometry.location.lat, lng: place.geometry.location.lng });
  state.map.setZoom(17);
  if (state.placeMarkers[idx]) {
    google.maps.event.trigger(state.placeMarkers[idx], "click");
  }
  highlightCard(placeId);
}

// ===== DETAIL PANEL =====
async function openDetail(placeId) {
  detailPanel.classList.add("open");
  detailContent.innerHTML = `
    <div style="display:flex;justify-content:center;align-items:center;height:200px">
      <div class="spinner"></div>
    </div>`;

  try {
    const res = await fetch(`/api/place/${placeId}`);
    const data = await res.json();
    const p = data.result;
    if (!p) throw new Error("No result");
    renderDetail(p);
    highlightCard(placeId);
  } catch (e) {
    detailContent.innerHTML = `<div style="padding:40px;text-align:center;color:#7fa8b8">Could not load details.</div>`;
  }
}

function renderDetail(p) {
  const open = p.opening_hours;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const todayIdx = new Date().getDay();

  let photoHtml = `<div class="detail-photo-placeholder">🧺</div>`;
  if (p.photos && p.photos.length > 0) {
    photoHtml = `<img class="detail-photo" src="/api/photo?ref=${p.photos[0].photo_reference}&maxwidth=600" alt="${p.name}" loading="lazy" onerror="this.style.display='none'" />`;
  }

  let hoursHtml = "";
  if (open && open.weekday_text) {
    hoursHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Opening Hours</div>
        <div class="hours-grid">
          ${open.weekday_text
            .map((line, i) => {
              // weekday_text starts Monday=0, we need to adjust
              const isToday = (i + 1) % 7 === todayIdx;
              return `<div class="hours-row ${isToday ? "hours-today" : ""}">
                <span class="hours-day">${line.split(":")[0]}</span>
                <span class="hours-time">${line.substring(line.indexOf(":") + 1).trim()}</span>
              </div>`;
            })
            .join("")}
        </div>
      </div>`;
  }

  let reviewsHtml = "";
  if (p.reviews && p.reviews.length > 0) {
    reviewsHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Reviews</div>
        <div class="reviews-list">
          ${p.reviews
            .slice(0, 3)
            .map(
              (r) => `
            <div class="review-item">
              <div class="review-header">
                <span class="review-author">${r.author_name}</span>
                <span class="review-stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</span>
              </div>
              <div class="review-text">${r.text || ""}</div>
            </div>`
            )
            .join("")}
        </div>
      </div>`;
  }

  const statusBadge = !open
    ? `<span class="badge" style="background:rgba(127,168,184,0.15);color:#7fa8b8">Hours unknown</span>`
    : open.open_now
    ? `<span class="badge badge-open">✅ Open now</span>`
    : `<span class="badge badge-closed">🔴 Closed</span>`;

  const priceLevels = ["", "$", "$$", "$$$", "$$$$"];
  const priceLabel = p.price_level ? `<span class="badge" style="background:rgba(0,196,167,0.15);color:#00c4a7">${priceLevels[p.price_level]}</span>` : "";

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.geometry.location.lat},${p.geometry.location.lng}&destination_place_id=${p.place_id}`;

  detailContent.innerHTML = `
    ${photoHtml}
    <div class="detail-name">${p.name}</div>
    <div class="detail-badge-row">
      ${p.rating ? `<span class="badge badge-rating">★ ${p.rating.toFixed(1)} (${p.user_ratings_total || 0})</span>` : ""}
      ${statusBadge}
      ${priceLabel}
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Location & Contact</div>
      ${p.formatted_address ? `<div class="info-row"><span class="info-icon">📍</span><div class="info-text">${p.formatted_address}</div></div>` : ""}
      ${p.formatted_phone_number ? `<div class="info-row"><span class="info-icon">📞</span><div class="info-text"><a href="tel:${p.formatted_phone_number}">${p.formatted_phone_number}</a></div></div>` : ""}
      ${p.website ? `<div class="info-row"><span class="info-icon">🌐</span><div class="info-text"><a href="${p.website}" target="_blank" rel="noopener">Visit website</a></div></div>` : ""}
    </div>

    ${hoursHtml}
    ${reviewsHtml}

    <div class="detail-actions">
      <a href="${mapsUrl}" target="_blank" rel="noopener" class="action-btn primary">
        🧭 Get Directions (Google Maps)
      </a>
      <button class="action-btn secondary" onclick="focusMarker('${p.place_id}')">
        🗺️ Show on Map
      </button>
      ${p.formatted_phone_number ? `<a href="tel:${p.formatted_phone_number}" class="action-btn secondary">📞 Call Now</a>` : ""}
    </div>
  `;
}

function navigateTo(lat, lng, name) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url, "_blank");
}

// ===== HELPERS =====
function showLoadingList() {
  listContainer.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">Searching for laundry shops…</div>
    </div>`;
}

function showEmptyState() {
  resultsCount.textContent = "0";
  listContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📍</div>
      <div class="empty-title">Find Laundry Near You</div>
      <div class="empty-desc">Click <strong>Locate Me</strong> to detect your location and discover nearby laundry shops.</div>
    </div>`;
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

// ===== EVENTS =====
btnLocate.addEventListener("click", locateUser);
btnStart && btnStart.addEventListener("click", locateUser);
detailClose.addEventListener("click", () => detailPanel.classList.remove("open"));
sortSelect.addEventListener("change", sortAndRender);

document.querySelectorAll(".radius-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".radius-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.selectedRadius = parseInt(btn.dataset.r);
    if (state.userLat) {
      placeUserMarker(state.userLat, state.userLng);
      searchLaundry();
    }
  });
});

// ===== DARK MAP STYLES =====
const mapStyles = [
  { elementType: "geometry", stylers: [{ color: "#0d1b2e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0d1b2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#7fa8b8" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1a2f4f" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0d1b2e" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#243d5e" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#071422" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4d9de0" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#142030" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0f2d20" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#1a7b4f" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#0f1f35" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#1a2f4f" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#c4d5e3" }] },
];
