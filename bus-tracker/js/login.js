import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { auth, db, ref, get, set, serverTimestamp } from "./common.js";

const pages = { student: "student.html", driver: "driver.html", admin: "admin.html" };

const $ = (id) => document.getElementById(id);
let mode = "in";

function showError(message) {
  const box = $("error");
  box.textContent = message;
  box.hidden = !message;
}

function setMode(next) {
  mode = next;
  $("tab-in").classList.toggle("active", mode === "in");
  $("tab-up").classList.toggle("active", mode === "up");
  $("signup-fields").hidden = mode === "in";
  $("submit").textContent = mode === "in" ? "Sign in" : "Create account";
  $("title").textContent = mode === "in" ? "Welcome back" : "Create your account";
  $("subtitle").textContent =
    mode === "in" ? "Sign in to open your dashboard." : "Students and drivers can register here.";
  $("password").autocomplete = mode === "in" ? "current-password" : "new-password";
  showError("");
}

async function redirectByRole(uid) {
  const snap = await get(ref(db, "users/" + uid));
  const profile = snap.val();
  if (!profile || !pages[profile.role]) {
    showError("This account has no role yet. Ask the administrator to set it up.");
    return false;
  }
  location.href = pages[profile.role];
  return true;
}

function friendly(error) {
  const code = error && error.code ? error.code : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "Email or password is incorrect.";
  }
  if (code.includes("email-already-in-use")) return "That email is already registered.";
  if (code.includes("weak-password")) return "Password must be at least 6 characters.";
  if (code.includes("invalid-email")) return "Enter a valid email address.";
  if (code.includes("network")) return "Network problem. Check your connection.";
  return "Something went wrong. " + (error && error.message ? error.message : "");
}

$("tab-in").addEventListener("click", () => setMode("in"));
$("tab-up").addEventListener("click", () => setMode("up"));

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const button = $("submit");
  button.disabled = true;
  const email = $("email").value.trim();
  const password = $("password").value;
  try {
    if (mode === "in") {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await redirectByRole(cred.user.uid);
    } else {
      const name = $("name").value.trim();
      const phone = $("phone").value.trim();
      const role = $("role").value;
      if (!name) {
        showError("Please enter your full name.");
        button.disabled = false;
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await set(ref(db, "users/" + cred.user.uid), {
        name,
        phone,
        email,
        role,
        createdAt: serverTimestamp()
      });
      location.href = pages[role];
    }
  } catch (error) {
    showError(friendly(error));
  }
  button.disabled = false;
});

onAuthStateChanged(auth, (user) => {
  if (user && mode === "in" && !$("submit").disabled) {
    redirectByRole(user.uid);
  }
});
