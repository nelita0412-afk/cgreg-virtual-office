/* Service worker de CGREG Virtual Office.
 * Solo guarda la INTERFAZ (HTML de arranque, JS/CSS con hash, íconos y fuentes) para abrir rápido y con mala señal.
 * Nunca intercepta /api ni /ws: ningún dato de servidores, atenciones, historias clínicas o consentimientos
 * se almacena en el dispositivo. */
const VERSION = 'cgreg-v2.0.0';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ['/offline.html', '/manifest.webmanifest', '/icons/icono-192.png', '/icons/icono-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

const esDatos = (url) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && esDatos(url)) return; // red directa, sin caché

  // Navegación: red primero; sin red, la interfaz guardada (sin datos) o la página sin conexión.
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const r = await fetch(req);
          if (r.ok) (await caches.open(SHELL)).put('/index.html', r.clone());
          return r;
        } catch {
          return (await caches.match('/index.html')) || (await caches.match('/offline.html'));
        }
      })(),
    );
    return;
  }

  // Archivos con hash y fuentes: caché primero (son inmutables).
  const inmutable = (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/'))) ||
    url.hostname === 'fonts.gstatic.com' || url.hostname === 'fonts.googleapis.com';
  if (inmutable) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') (await caches.open(ASSETS)).put(req, r.clone());
        return r;
      })(),
    );
  }
});

// Notificaciones push: el contenido llega sin datos clínicos (solo un título breve y el enlace interno).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(d.titulo || 'CGREG Virtual Office', {
      body: d.cuerpo || 'Tiene una novedad en CGREG Virtual Office.',
      icon: '/icons/icono-192.png',
      badge: '/icons/icono-192.png',
      tag: d.tag || 'cgreg',
      data: { enlace: d.enlace || '/inicio' },
      lang: 'es',
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.enlace || '/inicio', self.location.origin).href;
  e.waitUntil(
    (async () => {
      const ws = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const w = ws.find((c) => new URL(c.url).origin === self.location.origin);
      if (w) { await w.focus(); w.postMessage({ tipo: 'navegar', enlace: e.notification.data?.enlace || '/inicio' }); return; }
      await self.clients.openWindow(destino);
    })(),
  );
});
