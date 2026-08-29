// Service Worker for Push Notifications + same-origin PWA manifest

const FALLBACK_MANIFEST = {
  name: 'SmartHubly',
  short_name: 'SmartHubly',
  description: 'Plataforma de delivery e loja própria',
  start_url: '/',
  scope: '/',
  id: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  orientation: 'portrait-primary',
  background_color: '#0F172A',
  theme_color: '#3B82F6',
  icons: [
    { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
};

function manifestResponse(manifest) {
  return new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

async function buildManifest(request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug') || '';
  const startPath = url.searchParams.get('start_path') || (slug ? `/loja/${slug}` : '/');
  const scopePath = url.searchParams.get('scope_path') || (slug ? `/loja/${slug}/` : '/');

  const fallback = {
    ...FALLBACK_MANIFEST,
    name: slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : FALLBACK_MANIFEST.name,
    short_name: slug ? slug.slice(0, 12) : FALLBACK_MANIFEST.short_name,
    start_url: startPath,
    scope: scopePath,
    id: startPath,
  };

  if (!slug) return fallback;

  try {
    const apiUrl = new URL('https://zcnuvemvhhspfrvbttsw.supabase.co/functions/v1/driver-manifest');
    apiUrl.searchParams.set('slug', slug);
    apiUrl.searchParams.set('origin', url.origin);
    apiUrl.searchParams.set('start_path', startPath);
    apiUrl.searchParams.set('scope_path', scopePath);

    const edgeResponse = await fetch(apiUrl.toString(), { cache: 'no-store' });
    if (!edgeResponse.ok) return fallback;

    const remote = await edgeResponse.json();
    return {
      ...fallback,
      name: remote.name || fallback.name,
      short_name: remote.short_name || fallback.short_name,
      description: remote.description || fallback.description,
    };
  } catch {
    return fallback;
  }
}

self.addEventListener('push', function(event) {
  let data = { title: 'Nova entrega!', body: 'Você recebeu uma nova entrega.' };
  
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error('Error parsing push data:', e);
  }

  const options = {
    body: data.body,
    icon: '/placeholder.svg',
    badge: '/placeholder.svg',
    vibrate: [300, 100, 300, 100, 300],
    tag: 'delivery-notification',
    renotify: true,
    requireInteraction: true,
    data: data.data || {},
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    (async function() {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map(function(cacheKey) {
        return caches.delete(cacheKey);
      }));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(urlToOpen);
    })
  );
});

self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin && url.pathname === '/manifest.json') {
    event.respondWith(buildManifest(event.request).then(manifestResponse));
    return;
  }
  // For everything else: don't intercept. Letting the browser handle requests
  // natively avoids breaking POSTs, range requests, websocket upgrades and
  // streamed responses, and keeps the SW lightweight (it only exists for
  // push notifications + the same-origin manifest).
});
