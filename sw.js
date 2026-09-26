// Kleiner Helfer im Hintergrund. Er sorgt fuer zwei Dinge:
// die App laesst sich auf den Startbildschirm legen, und sie zeigt
// etwas an, wenn das Netz kurz weg ist.
//
// Zuerst wird immer im Netz nachgesehen, damit niemand eine alte Fassung
// zu sehen bekommt. Erst wenn das Netz nicht antwortet, kommt die Kopie
// aus dem Speicher. Nach einer Aenderung also einfach neu laden.

const LAGER = 'pgm-v1';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (namen) {
        return Promise.all(namen.filter(function (n) { return n !== LAGER; })
                                .map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  // Nur eigene Dateien. Die Aufrufe an Apps Script laufen unberuehrt durch.
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(function (antwort) {
        var kopie = antwort.clone();
        caches.open(LAGER).then(function (c) { c.put(e.request, kopie); });
        return antwort;
      })
      .catch(function () { return caches.match(e.request); })
  );
});
