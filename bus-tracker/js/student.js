import {
  db,
  ref,
  onValue,
  set,
  remove,
  push,
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
  timeAgo,
  createMap,
  busIcon,
  pinIcon,
  drawRoute,
  toast
} from "./common.js";

const $ = (id) => document.getElementById(id);

const { user, profile } = await requireRole("student");
$("who-name").textContent = profile.name || "Student";
$("logout").addEventListener("click", logout);

const map = createMap("map");
const busLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
let meMarker = null;
let myPos = null;
let buses = [];
let routes = {};
let selectedId = localStorage.getItem("bt_bus") || "";
let waiting = false;
let wasFull = false;
let fitted = false;

function selectedBus() {
  return buses.find((b) => b.id === selectedId) || null;
}

function renderSelect() {
  const select = $("bus-select");
  const options = buses
    .map((b) => {
      const route = routes[b.routeId];
      const label = (b.name || "Bus") + (route ? " - " + route.name : "");
      return '<option value="' + esc(b.id) + '"' + (b.id === selectedId ? " selected" : "") + ">" + esc(label) + "</option>";
    })
    .join("");
  select.innerHTML = options || '<option value="">No buses available</option>';
  if (!selectedBus() && buses.length) {
    selectedId = buses[0].id;
    select.value = selectedId;
  }
}

function renderMarkers() {
  busLayer.clearLayers();
  buses.forEach((b) => {
    if (!hasPosition(b)) return;
    const state = isFull(b) ? "full" : b.status === "active" ? "ok" : "idle";
    const marker = L.marker([b.lat, b.lng], { icon: busIcon(state) });
    marker.bindTooltip(esc(b.name || "Bus") + (b.id === selectedId ? " (selected)" : ""));
    marker.on("click", () => {
      selectedId = b.id;
      localStorage.setItem("bt_bus", selectedId);
      $("bus-select").value = selectedId;
      renderAll();
    });
    marker.addTo(busLayer);
  });
}

function renderStatus() {
  const bus = selectedBus();
  const full = bus ? isFull(bus) : false;
  $("full-banner").hidden = !full;
  $("wait-btn").disabled = !bus || (full && !waiting);

  if (!bus) {
    $("eta").textContent = "--";
    $("eta-note").textContent = "Pick a bus to follow.";
    $("seats-left").textContent = "--";
    $("distance").textContent = "--";
    $("updated").textContent = "--";
    $("route-badge").textContent = "No route";
    $("driver-badge").textContent = "No driver";
    return;
  }

  const left = Math.max(0, capacityOf(bus) - passengerCount(bus));
  $("seats-left").textContent = left;
  $("updated").textContent = hasPosition(bus) ? timeAgo(bus.updatedAt) : "--";
  const route = routes[bus.routeId];
  $("route-badge").textContent = route ? route.name : "No route";
  $("driver-badge").textContent = bus.driverName ? "Driver: " + bus.driverName : "No driver";

  if (full) {
    $("eta").textContent = "Full";
    $("eta-note").textContent = "No seats left on this bus.";
  } else if (bus.status !== "active") {
    $("eta").textContent = "--";
    $("eta-note").textContent = "This bus has not started its trip yet.";
  } else if (!hasPosition(bus)) {
    $("eta").textContent = "--";
    $("eta-note").textContent = "Waiting for the bus location.";
  } else if (!myPos) {
    $("eta").textContent = "--";
    $("eta-note").textContent = "Allow location access to see your arrival time.";
  } else {
    const km = distanceKm(bus, myPos);
    $("distance").textContent = km.toFixed(1);
    $("eta").textContent = formatEta(etaMinutes(bus, myPos));
    $("eta-note").textContent = "Estimated from the bus's live position.";
  }
  if (!myPos || !hasPosition(bus)) $("distance").textContent = "--";

  if (full && !wasFull && waiting) {
    toast("The bus you were waiting for is now full.", "alert");
  }
  wasFull = full;
}

function renderRoute() {
  const bus = selectedBus();
  drawRoute(map, routeLayer, bus ? routes[bus.routeId] : null);
}

function renderAll() {
  renderSelect();
  renderMarkers();
  renderStatus();
  renderRoute();
  const bus = selectedBus();
  if (!fitted && bus && hasPosition(bus)) {
    map.setView([bus.lat, bus.lng], 14);
    fitted = true;
  }
}

onValue(ref(db, "buses"), (snap) => {
  buses = toArray(snap.val());
  renderAll();
});

onValue(ref(db, "routes"), (snap) => {
  routes = snap.val() || {};
  renderAll();
});

onValue(ref(db, "waiting/" + user.uid), (snap) => {
  waiting = snap.exists();
  $("wait-banner").hidden = !waiting;
  $("wait-btn").textContent = waiting ? "Cancel waiting" : "I'm waiting for the bus";
  $("wait-btn").className = waiting ? "btn btn-ghost btn-block" : "btn btn-accent btn-block";
  renderStatus();
});

$("bus-select").addEventListener("change", (event) => {
  selectedId = event.target.value;
  localStorage.setItem("bt_bus", selectedId);
  fitted = false;
  renderAll();
});

$("wait-btn").addEventListener("click", async () => {
  if (waiting) {
    await remove(ref(db, "waiting/" + user.uid));
    return;
  }
  const bus = selectedBus();
  if (!bus) return;
  if (!myPos) {
    toast("Turn on location so the driver can see where you are.", "error");
    return;
  }
  await set(ref(db, "waiting/" + user.uid), {
    name: profile.name || "Student",
    phone: profile.phone || "",
    busId: bus.id,
    routeId: bus.routeId || "",
    lat: myPos.lat,
    lng: myPos.lng,
    at: serverTimestamp()
  });
});

$("comment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("comment-text").value.trim();
  if (!text) return;
  await push(ref(db, "comments"), {
    uid: user.uid,
    name: profile.name || "Student",
    text,
    at: serverTimestamp()
  });
  $("comment-text").value = "";
  toast("Comment sent to the admin.");
});

if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      myPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!meMarker) {
        meMarker = L.marker([myPos.lat, myPos.lng], { icon: pinIcon("me", "Me") }).addTo(map);
      } else {
        meMarker.setLatLng([myPos.lat, myPos.lng]);
      }
      renderStatus();
    },
    () => {
      renderStatus();
    },
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

setInterval(renderStatus, 15000);
