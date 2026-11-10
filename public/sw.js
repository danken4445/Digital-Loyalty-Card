// TCP Service Worker for Offline Member QR Stamping Fallback (PWA)
const CACHE_NAME = 'tcp-offline-v1';
const OFFLINE_URL = '/offline';

// Pre-cache the offline shell during service worker installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_URL]).catch(() => {
        // Silently continue if pre-caching non-critical assets fails
      });
    }).then(() => self.skipWaiting())
  );
});

// Clean up old caches on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Intercept failed navigations and serve /offline fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // NEVER cache or intercept security-sensitive, transactional, or administrative endpoints
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/staff/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/t/')
  ) {
    return;
  }

  // Intercept document navigations (opening a shop card or page when offline)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cachedFallback = await cache.match(OFFLINE_URL);
        if (cachedFallback) {
          return cachedFallback;
        }
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline</title></head><body style="background:#0a0a0a;color:#fff;font-family:sans-serif;padding:24px;text-align:center;"><h2>You are offline</h2><p>Please check your internet connection.</p></body></html>',
          {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          }
        );
      })
    );
  }
});
