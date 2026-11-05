/* Service worker: сеть в приоритете (чтобы расписание всегда было свежим), кэш — на случай отсутствия интернета. */
const CACHE = 'sch-v2';
const SHELL = ['./schedule.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './schedule.xlsx'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const bare = new Request(url.origin + url.pathname);
  e.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(bare, copy)); }
        return res;
      })
      .catch(() => caches.match(bare, { ignoreSearch: true }).then((r) => r || (req.mode === 'navigate' ? caches.match('./schedule.html') : Response.error())))
  );
});
