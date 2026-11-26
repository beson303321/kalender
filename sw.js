// Service Worker: macht die Seite als App installierbar und offline nutzbar.
// Strategie: immer zuerst das Neueste aus dem Netz holen, bei fehlender Verbindung die gespeicherte Version.
const CACHE = "kalender-v5";
const SHELL = [
  "./", "./index.html", "./css/style.css",
  "./js/app.js", "./js/store.js", "./js/config.js", "./js/importer.js", "./js/changelog.js", "./js/games.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Firebase-Bibliothek und Schrift: Dateien ändern sich nie (Version in der URL) → aus dem Speicher
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/") ||
      url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Eigene Dateien: zuerst Netz, sonst Speicher
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
    );
  }
  // Alles andere (Datenbank, Login) geht direkt ans Netz
});
