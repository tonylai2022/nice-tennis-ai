const CACHE_NAME = 'nice-tennis-v7';
const APP_SHELL = ['/', '/login', '/index.html', '/manifest.webmanifest', '/pwa-icon-192.png', '/pwa-icon-512.png'];

self.addEventListener('install', (event) => {
    // Cache the application shell during installation
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch((err) => {
            console.warn('[SW] Pre-caching app shell failed:', err);
        })
    );
    // Force immediate activation of the newly installed service worker
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        ).then(() => {
            // Notify clients that a new service worker version has activated
            return self.clients.matchAll({ type: 'window' }).then((clients) => {
                clients.forEach((client) => {
                    client.postMessage({ type: 'SW_ACTIVATED' });
                });
            });
        })
    );
    // Immediately take control of all open clients without waiting for a reload
    self.clients.claim();
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension:')) return;

    const url = new URL(event.request.url);
    const isSameOrigin = url.origin === self.location.origin;
    const isNavigation = event.request.mode === 'navigate' ||
        (isSameOrigin && url.pathname.endsWith('.html'));

    // Network-first strategy for HTML / navigation requests to prevent stale shells on mobile home screens
    if (isNavigation) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(event.request);
                    if (cached) return cached;
                    const fallback = await caches.match('/index.html');
                    if (fallback) return fallback;
                    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
                })
        );
        return;
    }

    // Cache-first with background revalidation for static assets
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const networkFetch = fetch(event.request)
                .then((response) => {
                    if (isSameOrigin && response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    }
                    return response;
                })
                .catch(() => cached);

            return cached || networkFetch;
        })
    );
});

self.addEventListener('push', (event) => {
    const payload = event.data?.json?.() ?? {};
    const title = payload.title || 'Lesson reminder';
    const options = {
        body: payload.body || 'You have an upcoming lesson.',
        icon: '/pwa-icon-192.png',
        badge: '/pwa-icon-192.png',
        tag: payload.lessonId ? `lesson-reminder-${payload.lessonId}` : 'lesson-reminder',
        data: { url: payload.url || '/dashboard/schedule', lessonId: payload.lessonId, startsAt: payload.startsAt },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || '/dashboard/schedule', self.location.origin).href;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        const matchingClient = clients.find((client) => client.url.startsWith(self.location.origin));
        return matchingClient ? matchingClient.focus().then(() => matchingClient.navigate(targetUrl)) : self.clients.openWindow(targetUrl);
    }));
});