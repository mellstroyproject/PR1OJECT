// Service worker: оболочка сайта открывается даже без сети.
// API, вход через Steam и Telegram никогда не кэшируются — там всегда свежие данные.
const CACHE = 'nextproject-v1';
const SHELL = ['/', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/tg/')) return;

  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok && (e.request.mode === 'navigate' || SHELL.includes(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('/')))
  );
});

// push-уведомления: показать даже когда сайт закрыт
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'NextProject', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'NextProject', {
    body: d.body || '', tag: d.room || 'nextproject', renotify: true,
    icon: '/icon-192.png', badge: '/icon-192.png', data: { room: d.room || null }
  }));
});

// нажатие на уведомление: открыть сайт в чате на нужной комнате
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const room = (e.notification.data || {}).room || null;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin)) { c.focus(); return c.postMessage({ type: 'open-chat', room }); }
    }
    return self.clients.openWindow('/?chat=' + encodeURIComponent(room || ''));
  }));
});
