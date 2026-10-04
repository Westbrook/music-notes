/* Generated release data; paths resolve against this worker's deployment scope. */
const version = '__VERSION__';
const files = __FILES__;
const base = self.registration.scope;
const prefix = `music-notes:${base}:`;
const cacheName = prefix + version;
const urls = new Set(files.map(file => new URL(file, base).href));
const integrity = Object.fromEntries(Object.entries(__INTEGRITY__).map(([file, digest]) => [new URL(file, base).href, digest]));
// A cached old release must not repair itself with a newer HTML/icon at the
// same URL. Verify bytes before committing any install or repair download.
const requestFor = url => new Request(url, { cache: 'reload', integrity: integrity[url] });

self.addEventListener('message', event => {
  if (event.data !== 'prepare-offline' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      const saved = new Set((await cache.keys()).map(request => request.url));
      const missing = [...urls].filter(url => !saved.has(url));
      if (missing.length) await cache.addAll(missing.map(requestFor));
      event.ports[0].postMessage(true);
    } catch { event.ports[0].postMessage(false); }
  })());
});

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    // addAll is atomic: a partial download must never become an active release.
    await cache.addAll([...urls].map(requestFor));
  })());
  // Do not skipWaiting: existing editors must keep their current release.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name);
    }
  })());
  // Do not claim already-open pages, which may use a different release.
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(base)) return;
  // Query parameters do not change these static HTML documents.
  if (event.request.mode === 'navigate') {
    if (url.pathname === new URL(base).pathname) url.pathname += 'index.html';
    url.search = '';
  }
  if (!urls.has(url.href)) return; // Never cache project data or unrelated routes.
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(url.href) ?? fetch(requestFor(url.href));
  })());
});
