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
  stopsOf,
  hasPosition,
  isFull,
  passengerCount,
  capacityOf,
  timeAgo,
  createMap,
  busIcon,
  pinIcon,
  drawRoute,
  toast
} from "./common.js";

const $ = (id) => document.getElementById(id);

const { profile } = await requireRole("admin");
$("who-name").textContent = profile.name || "Admin";
$("logout").addEventListener("click", logout);

const map = createMap("map");
const busLayer = L.layerGroup().addTo(map);
const waitLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const draftLayer = L.layerGroup().addTo(map);

let buses = [];
let routes = {};
let waitingAll = [];
let schedules = [];
let comments = [];
let drivers = [];
let drawing = false;
let draft = [];
let tableKey = "";
let activeTab = "live";

document.getElementById("tabs").addEventListener("click", (event) => {
  const tab = event.target.getAttribute("data-tab");
  if (!tab) return;
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((el) => el.classList.toggle("active", el.getAttribute("data-tab") === tab));
  document.querySelectorAll(".panel").forEach((el) => {
    el.hidden = el.id !== "panel-" + tab;
  });
  if (tab !== "routes") {
    drawing = false;
    $("draw-toggle").textContent = "Add stops";
    routeLayer.clearLayers();
  }
  setTimeout(() => map.invalidateSize(), 50);
});

function routeName(id) {
  return routes[id] ? routes[id].name : "Not assigned";
}

function renderOverview() {
  $("n-active").textContent = buses.filter((b) => b.status === "active").length;
  $("n-waiting").textContent = waitingAll.length;
  $("n-full").textContent = buses.filter((b) => isFull(b)).length;
}

function renderLive() {
  busLayer.clearLayers();
  waitLayer.clearLayers();
  buses.forEach((b) => {
    if (!hasPosition(b)) return;
    const state = isFull(b) ? "full" : b.status === "active" ? "ok" : "idle";
    L.marker([b.lat, b.lng], { icon: busIcon(state) })
      .bindPopup(
        "<strong>" +
          esc(b.name) +
          "</strong><br>Route: " +
          esc(routeName(b.routeId)) +
          "<br>Driver: " +
          esc(b.driverName || "none") +
          "<br>On board: " +
          passengerCount(b) +
          "/" +
          capacityOf(b)
      )
      .addTo(busLayer);
  });
  waitingAll.forEach((w) => {
    L.marker([w.lat, w.lng], { icon: pinIcon("alert", "✋") })
      .bindTooltip(esc(w.name) + " is waiting")
      .addTo(waitLayer);
  });

  $("live-list").innerHTML = buses.length
    ? buses
        .map((b) => {
          const full = isFull(b);
          const badge = full
            ? '<span class="badge badge-danger">Full</span>'
            : b.status === "active"
            ? '<span class="badge">Active</span>'
            : '<span class="badge badge-muted">Idle</span>';
          return (
            "<li><div><strong>" +
            esc(b.name) +
            '</strong><div class="meta">' +
            esc(routeName(b.routeId)) +
            " | " +
            passengerCount(b) +
            "/" +
            capacityOf(b) +
            " on board | " +
            (hasPosition(b) ? timeAgo(b.updatedAt) : "no signal") +
            "</div></div>" +
            badge +
            "</li>"
          );
        })
        .join("")
    : '<li class="empty" style="justify-content:center">No buses yet. Add one in the Buses tab.</li>';
}

function renderBusTable() {
  const key = JSON.stringify([
    buses.map((b) => [b.id, b.name, b.capacity, b.routeId, b.driverId]),
    Object.keys(routes).map((id) => [id, routes[id].name]),
    drivers.map((d) => [d.id, d.name])
  ]);
  if (key === tableKey) return;
  tableKey = key;

  const routeOptions = (selected) =>
    '<option value="">None</option>' +
    Object.keys(routes)
      .map((id) => '<option value="' + esc(id) + '"' + (id === selected ? " selected" : "") + ">" + esc(routes[id].name) + "</option>")
      .join("");
  const driverOptions = (selected) =>
    '<option value="">None</option>' +
    drivers
      .map((d) => '<option value="' + esc(d.id) + '"' + (d.id === selected ? " selected" : "") + ">" + esc(d.name || d.email) + "</option>")
      .join("");

  $("bus-table").innerHTML = buses.length
    ? buses
        .map(
          (b) =>
            "<tr><td><strong>" +
            esc(b.name) +
            '</strong><div class="meta" style="color:var(--muted);font-size:12px">' +
            capacityOf(b) +
            ' seats</div></td><td><select data-route="' +
            esc(b.id) +
            '">' +
            routeOptions(b.routeId) +
            '</select></td><td><select data-driver="' +
            esc(b.id) +
            '">' +
            driverOptions(b.driverId) +
            '</select></td><td><button class="btn btn-ghost btn-sm" data-delete-bus="' +
            esc(b.id) +
            '">Delete</button></td></tr>'
        )
        .join("")
    : '<tr><td colspan="4" class="empty">No buses yet.</td></tr>';

  $("sch-bus").innerHTML = buses.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + "</option>").join("");
}

function renderRoutes() {
  const ids = Object.keys(routes);
  $("route-list").innerHTML = ids.length
    ? ids
        .map(
          (id) =>
            "<li><div><strong>" +
            esc(routes[id].name) +
            '</strong><div class="meta">' +
            stopsOf(routes[id]).length +
            ' stops</div></div><div class="row"><button class="btn btn-ghost btn-sm" data-view-route="' +
            esc(id) +
            '">View</button><button class="btn btn-ghost btn-sm" data-delete-route="' +
            esc(id) +
            '">Delete</button></div></li>'
        )
        .join("")
    : '<li class="empty" style="justify-content:center">No routes yet.</li>';
}

function renderDraft() {
  draftLayer.clearLayers();
  if (draft.length) {
    L.polyline(draft.map((s) => [s.lat, s.lng]), { color: "#f97316", weight: 5, dashArray: "8 8" }).addTo(draftLayer);
    draft.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: pinIcon("stop", String(i + 1)) }).bindTooltip(esc(s.name)).addTo(draftLayer);
    });
  }
  $("draft-stops").innerHTML = draft.length
    ? draft.map((s, i) => "<li><span>" + (i + 1) + ". " + esc(s.name) + "</span></li>").join("")
    : '<li class="empty" style="justify-content:center">No stops added yet.</li>';
}

function renderSchedule() {
  const sorted = [...schedules].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  $("schedule-list").innerHTML = sorted.length
    ? sorted
        .map((s) => {
          const bus = buses.find((b) => b.id === s.busId);
          return (
            "<li><div><strong>" +
            esc(s.time) +
            " | " +
            esc(bus ? bus.name : "Removed bus") +
            '</strong><div class="meta">' +
            esc(routeName(s.routeId)) +
            " | " +
            esc(s.driverName || "No driver") +
            (s.label ? " | " + esc(s.label) : "") +
            '</div></div><button class="btn btn-ghost btn-sm" data-delete-trip="' +
            esc(s.id) +
            '">Delete</button></li>'
          );
        })
        .join("")
    : '<li class="empty" style="justify-content:center">No trips scheduled.</li>';
}

function renderComments() {
  const sorted = [...comments].sort((a, b) => (b.at || 0) - (a.at || 0));
  $("comment-list").innerHTML = sorted.length
    ? sorted
        .map(
          (c) =>
            '<li style="align-items:flex-start"><div><strong>' +
            esc(c.name) +
            '</strong><div class="meta">' +
            (c.at ? new Date(c.at).toLocaleString() : "") +
            '</div><div style="margin-top:4px">' +
            esc(c.text) +
            '</div></div><button class="btn btn-ghost btn-sm" data-delete-comment="' +
            esc(c.id) +
            '">Delete</button></li>'
        )
        .join("")
    : '<li class="empty" style="justify-content:center">No comments yet.</li>';
}

function renderAll() {
  renderOverview();
  renderLive();
  renderBusTable();
  renderRoutes();
  renderSchedule();
  renderComments();
}

onValue(ref(db, "buses"), (snap) => {
  buses = toArray(snap.val());
  renderAll();
});
onValue(ref(db, "routes"), (snap) => {
  routes = snap.val() || {};
  renderAll();
});
onValue(ref(db, "waiting"), (snap) => {
  waitingAll = toArray(snap.val());
  renderAll();
});
onValue(ref(db, "schedules"), (snap) => {
  schedules = toArray(snap.val());
  renderSchedule();
});
onValue(ref(db, "comments"), (snap) => {
  comments = toArray(snap.val());
  renderComments();
});
onValue(ref(db, "users"), (snap) => {
  drivers = toArray(snap.val()).filter((u) => u.role === "driver");
  renderAll();
});

renderDraft();

$("draw-toggle").addEventListener("click", () => {
  drawing = !drawing;
  $("draw-toggle").textContent = drawing ? "Stop adding" : "Add stops";
  map.getContainer().style.cursor = drawing ? "crosshair" : "";
});

map.on("click", (event) => {
  if (!drawing || activeTab !== "routes") return;
  const name = prompt("Stop name", "Stop " + (draft.length + 1));
  if (name === null) return;
  draft.push({ name: name.trim() || "Stop " + (draft.length + 1), lat: event.latlng.lat, lng: event.latlng.lng });
  renderDraft();
});

$("undo-stop").addEventListener("click", () => {
  draft.pop();
  renderDraft();
});

$("save-route").addEventListener("click", async () => {
  const name = $("route-name").value.trim();
  if (!name) {
    toast("Give the route a name.", "error");
    return;
  }
  if (draft.length < 2) {
    toast("Add at least two stops.", "error");
    return;
  }
  await push(ref(db, "routes"), { name, stops: draft, createdAt: serverTimestamp() });
  draft = [];
  drawing = false;
  $("draw-toggle").textContent = "Add stops";
  map.getContainer().style.cursor = "";
  $("route-name").value = "";
  renderDraft();
  toast("Route saved.");
});

$("route-list").addEventListener("click", async (event) => {
  const view = event.target.getAttribute("data-view-route");
  const del = event.target.getAttribute("data-delete-route");
  if (view) {
    drawRoute(map, routeLayer, routes[view]);
    const stops = stopsOf(routes[view]);
    if (stops.length) map.fitBounds(stops.map((s) => [s.lat, s.lng]), { padding: [50, 50] });
  }
  if (del && confirm("Delete this route?")) {
    await remove(ref(db, "routes/" + del));
    const updates = {};
    buses.filter((b) => b.routeId === del).forEach((b) => {
      updates["buses/" + b.id + "/routeId"] = null;
    });
    if (Object.keys(updates).length) await update(ref(db), updates);
    routeLayer.clearLayers();
  }
});

$("bus-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("bus-name").value.trim();
  const capacity = Number($("bus-cap").value) || 25;
  if (!name) return;
  await push(ref(db, "buses"), { name, capacity, status: "idle", routeId: "", driverId: "" });
  $("bus-name").value = "";
  toast("Bus added.");
});

$("bus-table").addEventListener("change", async (event) => {
  const routeId = event.target.getAttribute("data-route");
  const driverBus = event.target.getAttribute("data-driver");
  if (routeId) {
    await update(ref(db, "buses/" + routeId), { routeId: event.target.value || "" });
    toast("Route updated.");
  }
  if (driverBus) {
    const driver = drivers.find((d) => d.id === event.target.value);
    await update(ref(db, "buses/" + driverBus), {
      driverId: driver ? driver.id : "",
      driverName: driver ? driver.name || "" : "",
      driverPhone: driver ? driver.phone || "" : ""
    });
    toast("Driver updated.");
  }
});

$("bus-table").addEventListener("click", async (event) => {
  const id = event.target.getAttribute("data-delete-bus");
  if (id && confirm("Delete this bus?")) await remove(ref(db, "buses/" + id));
});

$("schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const bus = buses.find((b) => b.id === $("sch-bus").value);
  const time = $("sch-time").value;
  if (!bus || !time) return;
  await push(ref(db, "schedules"), {
    busId: bus.id,
    routeId: bus.routeId || "",
    driverId: bus.driverId || "",
    driverName: bus.driverName || "",
    time,
    label: $("sch-label").value.trim()
  });
  $("sch-label").value = "";
  toast("Trip added.");
});

$("schedule-list").addEventListener("click", async (event) => {
  const id = event.target.getAttribute("data-delete-trip");
  if (id) await remove(ref(db, "schedules/" + id));
});

$("comment-list").addEventListener("click", async (event) => {
  const id = event.target.getAttribute("data-delete-comment");
  if (id) await remove(ref(db, "comments/" + id));
});
