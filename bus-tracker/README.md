# BusTrack

Real-time bus tracking web app with student, driver and admin pages. Map: Leaflet + OpenStreetMap (no API key). Real time: Firebase Realtime Database + Authentication.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com and create a project.
2. Build > Authentication > Get started > enable **Email/Password**.
3. Build > Realtime Database > Create database (choose a location, start in locked mode).
4. Realtime Database > **Rules** tab > paste the content of `database.rules.json` > Publish.
5. Project settings > General > Your apps > add a **Web app** and copy the config object.
6. Paste the values into `js/firebase-config.js`. Make sure `databaseURL` matches the URL shown at the top of the Realtime Database page.

## 2. Create the admin account

1. Open `index.html` > Create account (register as student or driver with the email you want for admin).
2. In the Firebase console > Realtime Database > Data, open `users/<your uid>` and change `role` to `admin`.
3. Sign out and sign in again. You are redirected to `admin.html`.

## 3. Run it

Firebase Auth needs http(s), not file://. From this folder:

    python3 -m http.server 8000

Open http://localhost:8000. GPS needs https on real phones, so deploy with Firebase Hosting (`firebase deploy`) before testing outside localhost.

## 4. First-use flow

1. Admin > Routes: add a route (click the map for each stop, name them, save).
2. Admin > Buses: add buses, assign a route and a driver (drivers register themselves first).
3. Driver: opens driver.html, presses **Start trip**, allows location. The bus appears live on every map.
4. Student: opens student.html, picks the bus, sees ETA, presses **I'm waiting**. The driver sees the alert marker and hears a beep.
5. Driver adds each boarding student. When the count reaches capacity the student page shows "bus full".

## Data layout

    users/{uid}        name, phone, email, role
    buses/{busId}      name, capacity, routeId, driverId, driverName, driverPhone,
                       status, lat, lng, updatedAt, passengers/{id}
    routes/{routeId}   name, stops[{name, lat, lng}]
    schedules/{id}     busId, routeId, driverId, time, label
    waiting/{uid}      name, busId, routeId, lat, lng, at
    comments/{id}      uid, name, text, at

## Notes

- ETA is a straight-line estimate at 28 km/h with a 1.3 road factor. Change `etaMinutes` in `js/common.js` to tune it.
- The driver's position is written at most every 3 seconds to keep Firebase usage low.
- The driver page must stay open (screen on) to keep sending GPS.
