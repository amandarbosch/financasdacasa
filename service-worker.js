'use strict';

const APP_VERSION = '4.0.0';
const CACHE_PREFIX = 'financas-da-casa-v4';
const APP_SHELL_CACHE = `${CACHE_PREFIX}-app-${APP_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-${APP_VERSION}`;
const CDN_CACHE = `${CACHE_PREFIX}-cdn-${APP_VERSION}`;
const OFFLINE_URL = './index.html';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './supabase.js',
  './auth.js',
  './app.js',
  './manifest.webmanifest'
];

const TRUSTED_CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]);

const isCacheableResponse = (response) =>
  response && (response.ok || response.type === 'opaque');

const putSafely = async (cacheName, request, response) => {
  if (!isCacheableResponse(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
};

const precacheAppShell = async () => {
  const cache = await caches.open(APP_SHELL_CACHE);
  await Promise.allSettled(
    APP_SHELL.map(async (url) => {
      const request = new Request(url, { cache: 'reload' });
      const response = await fetch(request);
      if (!isCacheableResponse(response)) {
        throw new Error(`Falha ao armazenar ${url}`);
      }
      await cache.put(request, response);
    })
  );
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAppShell().then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const validCaches = new Set([APP_SHELL_CACHE, RUNTIME_CACHE, CDN_CACHE]);
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(CACHE_PREFIX) && !validCaches.has(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
    if ('navigationPreload' in self.registration) {
      await self.registration.navigationPreload.enable();
    }
  })());
});

const networkFirstNavigation = async (event) => {
  try {
    const preload = await event.preloadResponse;
    if (preload) {
      await putSafely(RUNTIME_CACHE, event.request, preload);
      return preload;
    }

    const response = await fetch(event.request);
    await putSafely(RUNTIME_CACHE, event.request, response);
    return response;
  } catch {
    const runtimeMatch = await caches.match(event.request, { ignoreSearch: true });
    if (runtimeMatch) return runtimeMatch;

    const appShell = await caches.match(OFFLINE_URL, { ignoreSearch: true });
    if (appShell) return appShell;

    return new Response(
      '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Finanças da Casa V4</title><body><main><h1>Você está offline</h1><p>Reconecte-se para abrir o aplicativo pela primeira vez.</p></main></body></html>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' }
      }
    );
  }
};

const staleWhileRevalidate = async (request, cacheName) => {
  const cached = await caches.match(request, { ignoreSearch: false });
  const networkPromise = fetch(request)
    .then(async (response) => {
      await putSafely(cacheName, request, response);
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => null);
    return cached;
  }

  const response = await networkPromise;
  if (response) return response;
  return new Response('', { status: 504, statusText: 'Offline' });
};

const cacheFirst = async (request, cacheName) => {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    await putSafely(cacheName, request, response);
    return response;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
};

const networkFirst = async (request, cacheName) => {
  try {
    const response = await fetch(request);
    await putSafely(cacheName, request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 504, statusText: 'Offline' });
  }
};

const isSupabaseRequest = (url) =>
  url.hostname.endsWith('.supabase.co') ||
  url.pathname.includes('/auth/v1/') ||
  url.pathname.includes('/rest/v1/') ||
  url.pathname.includes('/realtime/v1/');

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isSupabaseRequest(url)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (TRUSTED_CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  const destination = request.destination;

  if (['style', 'script', 'worker'].includes(destination)) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE));
    return;
  }

  if (['image', 'font'].includes(destination)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  if (destination === 'manifest' || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(networkFirst(request, APP_SHELL_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

self.addEventListener('message', (event) => {
  const type = event.data?.type;

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (type === 'CLEAR_CACHES') {
    event.waitUntil((async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX))
          .map((name) => caches.delete(name))
      );
      await precacheAppShell();
      event.source?.postMessage({ type: 'CACHES_CLEARED' });
    })());
    return;
  }

  if (type === 'GET_VERSION') {
    event.source?.postMessage({
      type: 'APP_VERSION',
      version: APP_VERSION
    });
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'financas-refresh') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clients) => {
          clients.forEach((client) => client.postMessage({ type: 'REFRESH_DATA' }));
        })
    );
  }
});
