// Service worker minimo: serve solo a rendere l'app installabile.
// Non salva nulla in cache, così i dati e il codice sono sempre quelli aggiornati.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r));
});
