import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  push,
  remove,
  get,
  onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export { ref, onValue, set, update, push, remove, get, onDisconnect, serverTimestamp };

export const DEFAULT_CENTER = [31.9539, 35.9106];

export function requireRole(role) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        location.href = "index.html";
        return;
      }
      const snap = await get(ref(db, "users/" + user.uid));
      const profile = snap.val();
      if (!profile || profile.role !== role) {
        location.href = "index.html";
        return;
      }
      resolve({ user, profile });
    });
  });
}

export function logout() {
  return signOut(auth).then(() => {
    location.href = "index.html";
  });
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

export function toArray(obj) {
  if (!obj) return [];
  return Object.entries(obj).map(([id, value]) => ({ id, ...value }));
}

export function stopsOf(route) {
  if (!route || !route.stops) return [];
  return Object.values(route.stops);
}

export function passengerCount(bus) {
  return Object.keys((bus && bus.passengers) || {}).length;
}

export function capacityOf(bus) {
  return Number((bus && bus.capacity) || 25);
}

export function isFull(bus) {
  return passengerCount(bus) >= capacityOf(bus);
}

export function hasPosition(bus) {
  return bus && typeof bus.lat === "number" && typeof bus.lng === "number";
}

export function distanceKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function etaMinutes(from, to, speedKmh = 28) {
  const km = distanceKm(from, to) * 1.3;
  return Math.max(1, Math.round((km / speedKmh) * 60));
}

export function formatEta(minutes) {
  if (minutes < 60) return minutes + " min";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + " h " + m + " min";
}

export function timeAgo(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return s + " s ago";
  if (s < 3600) return Math.round(s / 60) + " min ago";
  return Math.round(s / 3600) + " h ago";
}

export function createMap(id, center = DEFAULT_CENTER, zoom = 12) {
  const map = L.map(id, { zoomControl: true }).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);
  return map;
}

export function busIcon(state) {
  const cls = state === "full" ? "pin pin-bus pin-full" : state === "idle" ? "pin pin-bus pin-idle" : "pin pin-bus";
  return L.divIcon({
    className: "",
    html: '<div class="' + cls + '">🚌</div>',
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });
}

export function pinIcon(kind, label) {
  return L.divIcon({
    className: "",
    html: '<div class="pin pin-' + kind + '">' + label + "</div>",
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

export function toast(message, tone = "info") {
  let host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast toast-" + tone;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

export function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch (e) {
    return;
  }
}

export function drawRoute(map, layerGroup, route, color = "#0f766e") {
  layerGroup.clearLayers();
  const stops = stopsOf(route);
  if (!stops.length) return;
  const points = stops.map((s) => [s.lat, s.lng]);
  L.polyline(points, { color, weight: 5, opacity: 0.75 }).addTo(layerGroup);
  stops.forEach((s, i) => {
    L.marker([s.lat, s.lng], { icon: pinIcon("stop", String(i + 1)) })
      .bindTooltip(esc(s.name || "Stop " + (i + 1)))
      .addTo(layerGroup);
  });
}
