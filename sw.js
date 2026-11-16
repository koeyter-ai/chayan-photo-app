/* 讓 App 可以「加入主畫面」並在沒網路時也能開啟、拍照暫存 */
var CACHE = 'chayan-v1';
var SHELL = ['./', 'index.html', 'app.js', 'generate.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png',
  'templates/photo.docx', 'templates/form.xlsx',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return; // 上傳（POST）不經過快取
  // 先抓網路上最新的，失敗才用快取
  e.respondWith(fetch(e.request).then(function (r) {
    if (r.ok) { var copy = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copy); }); }
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); }));
});
