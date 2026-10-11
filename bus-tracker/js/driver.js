import {
  db,
  ref,
  onValue,
  set,
  update,
  push,
  remove,
  serverTimestamp,
  requireRole,
  logout,
  toArray,
  esc,
  hasPosition,
  isFull,
  passengerCount,
  capacityOf,
  distanceKm,
  etaMinutes,
  formatEta,
  createMap,
  busIcon,
  pinIcon,
  drawRoute,
  toast,
  beep
} from "./common.js";

const $ = (id) => document.getElementById(id);

const { user, profile } = await requireRole("driver");
$("who-name").textContent = profile.name || "Driver";
$("logout").addEventListener("click", logout);

const map = createMap("map");
const routeLayer = L.layerGroup().addTo(map);
const waitLayer = L.layerGroup().addTo(map);
const otherLayer = L.layerGroup().addTo(map);
let meMarker = null;
let myPos = null;
let watchId = null;
let lastPush = 0;
let buses = [];
let routes = {};
let waitingAll = [];
let schedules = [];
let knownAlerts = new Set();
let alertsReady = false;
let fitted = false;

function myBus() {
  return buses.find((b) => b.driverId === user.uid) || null;
}

function renderTrip() {
  const bus = myBus();
  $("no-bus").hidden = !!bus;
  ["trip-card", "alerts-card", "board-card", "nearby-card", "schedule-card"].forEach((id) => {
    $(id).hidden = !bus;
  });
  if (!bus) return;

  const route = routes[bus.routeId];
  const count = passengerCount(bus);
  const cap = capacityOf(bus);
  const active = bus.status === "active";
  $("bus-title").textContent = bus.name || "My bus";
  $("route-badge").textContent = route ? "Route: " + route.name : "No route assigned";
  $("trip-badge").textContent = active ? "Trip in progress" : "Trip not started";
  $("trip-badge").className = active ? "badge" : "badge badge-muted";
  $("onboard").textContent = count;
  $("capacity").textContent = cap;
  $("seats").textContent = Math.max(0, cap - count);
  $("full-banner").hidden = !isFull(bus);
  $("trip-btn").textContent = active ? "End trip" : "Start trip";
  $("trip-btn").className = active ? "btn btn-danger btn-block" : "btn btn-block";
  $("trip-btn").disabled = !route && !active;

  drawRoute(map, routeLayer, route);

  const list = $("passengers");
  const passengers = toArray(bus.passengers);
  list.innerHTML = passengers.length
    ? passengers
        .map(
          (p) =>
            "<li><span>" +
            esc(p.name) +
            '</span><button class="btn btn-ghost btn-sm" data-remove="' +
            esc(p.id) +
            '">Remove</button></li>'
        )
        .join("")
    : '<li class="empty" style="justify-content:center">Nobody on board yet.</li>';
}

function renderAlerts() {
  const bus = myBus();
  waitLayer.clearLayers();
  const list = $("alerts");
  if (!bus) return;
  const mine = waitingAll.filter((w) => w.busId === bus.id || (bus.routeId && w.routeId === bus.routeId));

  mine.forEach((w) => {
    L.marker([w.lat, w.lng], { icon: pinIcon("alert", "✋") })
      .bindTooltip(esc(w.name) + " is waiting")
      .addTo(waitLayer);
  });

  list.innerHTML = mine.length
    ? mine
        .map((w) => {
          const meta = hasPosition(bus)
            ? distanceKm(bus, w).toFixed(1) + " km | " + formatEta(etaMinutes(bus, w)) + " away"
            : "Location shared";
          return (
            '<li class="alert"><div><strong>' +
            esc(w.name) +
            '</strong><div class="meta">' +
            esc(meta) +
            '</div></div><button class="btn btn-sm" data-board="' +
            esc(w.id) +
            '">Boarded</button></li>'
          );
        })
        .join("")
    : '<li class="empty" style="justify-content:center">No students waiting right now.</li>';

  const ids = new Set(mine.map((w) => w.id));
  if (alertsReady) {
    mine.forEach((w) => {
      if (!knownAlerts.has(w.id)) {
        toast(w.name + " is waiting on your route.", "alert");
        beep();
      }
    });
  }
  knownAlerts = ids;
  alertsReady = true;
}

function renderNearby() {
  const bus = myBus();
  const list = $("nearby");
  if (!bus) return;
  const origin = myPos || (hasPosition(bus) ? bus : null);
  otherLayer.clearLayers();
  const others = buses.filter((b) => b.id !== bus.id && hasPosition(b));
  others.forEach((b) => {
    L.marker([b.lat, b.lng], { icon: busIcon(isFull(b) ? "full" : b.status === "active" ? "ok" : "idle") })
      .bindTooltip(esc(b.name || "Bus"))
      .addTo(otherLayer);
  });
  if (!origin) {
    list.innerHTML = '<li class="empty" style="justify-content:center">Start your trip to find nearby buses.</li>';
    return;
  }
  const ranked = others
    .map((b) => ({ bus: b, km: distanceKm(origin, b) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, 3);
  list.innerHTML = ranked.length
    ? ranked
        .map(({ bus: b, km }) => {
          const phone = b.driverPhone
            ? '<a class="btn btn-sm" href="tel:' + esc(b.driverPhone) + '">Call</a>'
            : '<span class="meta">No phone</span>';
          return (
            "<li><div><strong>" +
            esc(b.name || "Bus") +
            '</strong><div class="meta">' +
            km.toFixed(1) +
            " km | " +
            esc(b.driverName || "No driver") +
            (b.driverPhone ? " | " + esc(b.driverPhone) : "") +
            "</div></div>" +
            phone +
            "</li>"
          );
        })
        .join("")
    : '<li class="empty" style="justify-content:center">No other buses online.</li>';
}

function renderSchedule() {
  const mine = schedules
    .filter((s) => s.driverId === user.uid)
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  $("schedule").innerHTML = mine.length
    ? mine
        .map((s) => {
          const route = routes[s.routeId];
          return (
            "<li><div><strong>" +
            esc(s.time) +
            '</strong><div class="meta">' +
            esc(route ? route.name : "No route") +
            (s.label ? " | " + esc(s.label) : "") +
            "</div></div></li>"
          );
        })
        .join("")
    : '<li class="empty" style="justify-content:center">No trips scheduled for you.</li>';
}

function renderAll() {
  renderTrip();
  renderAlerts();
  renderNearby();
  renderSchedule();
  const bus = myBus();
  if (!fitted && bus) {
    const route = routes[bus.routeId];
    const stops = route && route.stops ? Object.values(route.stops) : [];
    if (stops.length) {
      map.fitBounds(stops.map((s) => [s.lat, s.lng]), { padding: [40, 40] });
      fitted = true;
    } else if (hasPosition(bus)) {
      map.setView([bus.lat, bus.lng], 14);
      fitted = true;
    }
  }
}

let resumed = false;

onValue(ref(db, "buses"), (snap) => {
  buses = toArray(snap.val());
  renderAll();
  const bus = myBus();
  if (!resumed && bus) {
    resumed = true;
    if (bus.status === "active" && watchId === null) startTrip();
  }
});
onValue(ref(db, "routes"), (snap) => {
  routes = snap.val() || {};
  renderAll();
});
onValue(ref(db, "waiting"), (snap) => {
  waitingAll = toArray(snap.val());
  renderAlerts();
});
onValue(ref(db, "schedules"), (snap) => {
  schedules = toArray(snap.val());
  renderSchedule();
});

function pushPosition(pos) {
  const bus = myBus();
  if (!bus) return;
  myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  if (!meMarker) {
    meMarker = L.marker([myPos.lat, myPos.lng], { icon: busIcon("ok") }).addTo(map);
  } else {
    meMarker.setLatLng([myPos.lat, myPos.lng]);
  }
  const now = Date.now();
  if (now - lastPush < 3000) return;
  lastPush = now;
  update(ref(db, "buses/" + bus.id), {
    lat: myPos.lat,
    lng: myPos.lng,
    heading: pos.coords.heading ?? null,
    speed: pos.coords.speed ?? null,
    updatedAt: now,
    status: "active"
  });
}

function startTrip() {
  if (!("geolocation" in navigator)) {
    toast("This device has no GPS support.", "error");
    return;
  }
  watchId = navigator.geolocation.watchPosition(pushPosition, () => toast("Location permission is needed to share the bus position.", "error"), {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 15000
  });
  const bus = myBus();
  if (bus) update(ref(db, "buses/" + bus.id), { status: "active", updatedAt: Date.now() });
}

function endTrip() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  const bus = myBus();
  if (bus) update(ref(db, "buses/" + bus.id), { status: "idle", updatedAt: Date.now() });
}

$("trip-btn").addEventListener("click", () => {
  const bus = myBus();
  if (!bus) return;
  if (bus.status === "active") endTrip();
  else startTrip();
});

$("board-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const bus = myBus();
  const name = $("board-name").value.trim();
  if (!bus || !name) return;
  if (isFull(bus)) {
    toast("The bus is already full.", "error");
    return;
  }
  await push(ref(db, "buses/" + bus.id + "/passengers"), { name, at: serverTimestamp() });
  $("board-name").value = "";
});

$("passengers").addEventListener("click", async (event) => {
  const id = event.target.getAttribute("data-remove");
  const bus = myBus();
  if (id && bus) await remove(ref(db, "buses/" + bus.id + "/passengers/" + id));
});

$("alerts").addEventListener("click", async (event) => {
  const id = event.target.getAttribute("data-board");
  const bus = myBus();
  if (!id || !bus) return;
  const student = waitingAll.find((w) => w.id === id);
  if (!student) return;
  if (isFull(bus)) {
    toast("The bus is already full.", "error");
    return;
  }
  await push(ref(db, "buses/" + bus.id + "/passengers"), { name: student.name, at: serverTimestamp() });
  await remove(ref(db, "waiting/" + id));
});

$("clear-passengers").addEventListener("click", async () => {
  const bus = myBus();
  if (bus && confirm("Remove every passenger from this bus?")) {
    await remove(ref(db, "buses/" + bus.id + "/passengers"));
  }
});

