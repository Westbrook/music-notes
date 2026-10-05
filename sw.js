/* Generated release data; paths resolve against this worker's deployment scope. */
const version = '434fb6ab4199be42';
const files = ["apple-touch-icon.png","assets/author-C7lwmWda.js","assets/author-C_D6eJVQ.css","assets/author-ui-BauXz06D.js","assets/button-content-CB62cQHJ.css","assets/button-content-DK5Fi-Iu.js","assets/listen-controller-BPyadSW2.js","assets/notation-fonts-BN8TYhU_.js","assets/offline-status-BYpr33d9.js","assets/readonly-signal-C8xoJeWf.js","assets/render-DP8OMPCQ.js","assets/semantics-BRTp3gBZ.js","assets/ui-runtime-DZIFwxVs.js","assets/workbook-BcA8Wh5c.css","assets/workbook-DbADflgO.js","author.html","favicon.ico","icons/app-192.png","icons/app-512.png","icons/app-maskable-512.png","icons/app.svg","icons/apple-touch-icon-152.png","icons/apple-touch-icon-167.png","icons/favicon-32.png","index.html","manifest.json"];
const base = self.registration.scope;
const prefix = `music-notes:${base}:`;
const cacheName = prefix + version;
const urls = new Set(files.map(file => new URL(file, base).href));
const integrity = Object.fromEntries(Object.entries({"assets/author-C_D6eJVQ.css":"sha256-c5GNSPwGWlZfnp2vjRZbe6bza6j/woY24luzhMeOUws=","assets/workbook-BcA8Wh5c.css":"sha256-b3dfezZNB09d+fMM85kVSwQvApMfv12Oos06fgpbjlU=","assets/button-content-CB62cQHJ.css":"sha256-08RDjnj5CeMqP2j5O/C80upm8Itvr1ZFKb0xC7ELCtE=","assets/ui-runtime-DZIFwxVs.js":"sha256-Bgrde+VxsqNyBtfSittbEHFyQ4JQxHzJ4DCTGpLupW0=","assets/author-ui-BauXz06D.js":"sha256-DWqa6Ouv5J/2tZseYOM3zYv/OmURmseOt+nBOSPriNs=","assets/notation-fonts-BN8TYhU_.js":"sha256-YWxsRrrX5t76xVVLbpzv7kNlaYnSF5PgjyJlFAWQ47M=","assets/author-C7lwmWda.js":"sha256-dEtCIyE18zhABC85OjzoqSS7cQPtIVZK2oPXm9H5LdY=","assets/workbook-DbADflgO.js":"sha256-K+vLvB08T5CXrm+hn9MQWkoRtQOCTfkO2mz4u17ePg4=","assets/readonly-signal-C8xoJeWf.js":"sha256-tOgdOyo8aMDvZ+P4keeDgGT8H3Jank9Ckx1mhhvzuuQ=","assets/offline-status-BYpr33d9.js":"sha256-KYuovyRXLjP/PSoWJL4MOKzVDPqcho3hEHd3Vnb7K6o=","assets/button-content-DK5Fi-Iu.js":"sha256-k5orvSxNlWg9DV9e9FISvApVnblac8RV/uUxeygalSk=","assets/listen-controller-BPyadSW2.js":"sha256-qM4Kn8tNGwZfjiSixbocOG4OuVrv1DNGb2y4+gyKyiw=","assets/render-DP8OMPCQ.js":"sha256-4RKOB9Gs3vrAb001YdmG+PAsDqCsFeopN1ozyB+yxf8=","assets/semantics-BRTp3gBZ.js":"sha256-nQombEvsZobaI+Esxwqrh3l8G6j0n4ygMFGRf+cQspo=","index.html":"sha256-9W5hkhnNBJMk4Dm55v0WbEDCFsdpxp1z+qulfBzOP28=","author.html":"sha256-x1fBAwtJ5gfBv0BJBJy1C4T6s9ogPRQCIFNpC7ai1SQ=","apple-touch-icon.png":"sha256-6S8n6c7c6uLPRWkEdhIlko7E7baGaNmuSYLdw1MKg7M=","favicon.ico":"sha256-0U0rJJsTNoA2/tj1JrBJ7oZCptftHhNbeFjKGNGKLo4=","manifest.json":"sha256-SgfLsLWcvYSzdZnOuyMNQiCCPNkmrSrI+UCrCp03rSs=","icons/app-192.png":"sha256-KyGLFWfZ2gMQw/WhqzfsGyUqdD8061973lCOUuQgjxY=","icons/app-512.png":"sha256-E7l8e7p+kiOCEcbW+ke6woPYr/hRt2zBqN5dw6jth4s=","icons/app-maskable-512.png":"sha256-E7l8e7p+kiOCEcbW+ke6woPYr/hRt2zBqN5dw6jth4s=","icons/app.svg":"sha256-Y1slMpq59SZc+Ur0rWXpFKCNEkPluZG/hd8ZzLHkhGw=","icons/apple-touch-icon-152.png":"sha256-drCeK+ncwt6tWRTkMQA9wkN5gHKOyFbS4rdRM5q4hFo=","icons/apple-touch-icon-167.png":"sha256-2CZnoXS9m8odb3xZCyyPOzHPbK5RuM7IPY9NI1N1E5w=","icons/favicon-32.png":"sha256-4KblATAAbp4eSPcud5kPx8CsErNHs8NViwrrbGI7HAc="}).map(([file, digest]) => [new URL(file, base).href, digest]));
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
