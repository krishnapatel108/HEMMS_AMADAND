// ═══════════════════════════════════════════════════════════════
//  HEMM Report — sw.js (Service Worker)
//  PWA caching, offline support, background sync for reports
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'hemm-v26';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/admin.html',
  '/css/theme.css',
  '/css/operator.css',
  '/css/dashboard.css',
  '/css/admin.css',
  '/js/config.js',
  '/js/utils.js',
  '/js/supabase-client.js',
  '/js/auth.js',
  '/js/operator.js',
  '/js/dashboard.js',
  '/js/admin.js',
  '/js/sheets-export.js',
  '/manifest.json',
];

// Supabase API hostname (for network-first strategy)
const API_HOST = 'supabase.co';

// Background Sync tag for failed report submissions
const SYNC_TAG = 'hemm-report-sync';

// ═══════════════════════════════════════════════════════════════
//  INSTALL — Pre-cache static assets
// ═══════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Fetch and cache all assets individually with {cache: 'reload'}
        // to bypass the browser's HTTP cache.
        const promises = STATIC_ASSETS.map((url) => {
          const req = new Request(url, { cache: 'reload' });
          return cache.add(req).catch((err) => {
            console.warn('SW install: failed to cache ' + url, err);
          });
        });
        return Promise.all(promises);
      })
      .then(() => self.skipWaiting())
  );
});

// ═══════════════════════════════════════════════════════════════
//  ACTIVATE — Clean up old caches
// ═══════════════════════════════════════════════════════════════

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        );
      })
      .then(() => self.clients.claim())
  );
});

// ═══════════════════════════════════════════════════════════════
//  FETCH — Routing strategies
//    • API calls (Supabase)  → Network-first, no cache
//    • Static assets         → Cache-first, network fallback
// ═══════════════════════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST/PUT/DELETE go to network)
  if (event.request.method !== 'GET') return;

  // ── Network-first for API calls ────────────────────────────
  if (url.hostname.includes(API_HOST)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ── Cache-first for static assets ─────────────────────────
  event.respondWith(cacheFirst(event.request));
});

// ── Cache-first strategy ─────────────────────────────────────
async function cacheFirst(request) {
  try {
    const cached = await caches.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    // Cache successful responses for known static assets
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    // Offline: try cache one more time, then return offline fallback
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

// ── Network-first strategy ───────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (_) {
    // Network failed — try cache as fallback for GET requests
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'Offline — नेटवर्क उपलब्ध नहीं है' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Offline fallback for HTML pages ──────────────────────────
function offlineFallback(request) {
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('text/html')) {
    return caches.match('/index.html');
  }
  return new Response('Offline', { status: 503 });
}

// ═══════════════════════════════════════════════════════════════
//  BACKGROUND SYNC — Retry failed report submissions
// ═══════════════════════════════════════════════════════════════

// Listen for sync events to retry queued reports
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueuedReports());
  }
});

// Replay all queued report submissions from IndexedDB
async function replayQueuedReports() {
  try {
    const queue = await getQueuedReports();
    if (!queue.length) return;

    const results = await Promise.allSettled(
      queue.map(async (item) => {
        const response = await fetch(item.url, {
          method: 'POST',
          headers: item.headers,
          body: item.body,
        });
        if (response.ok || response.status < 500) {
          await removeFromQueue(item.id);
        } else {
          throw new Error('Server error: ' + response.status);
        }
      })
    );

    // Notify clients about sync results
    const clients = await self.clients.matchAll({ type: 'window' });
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    clients.forEach((client) => {
      client.postMessage({
        type: 'SYNC_COMPLETE',
        succeeded,
        failed,
        total: queue.length,
      });
    });
  } catch (err) {
    console.error('replayQueuedReports:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
//  INDEXEDDB QUEUE — Store failed requests for retry
// ═══════════════════════════════════════════════════════════════

const DB_NAME = 'hemm-sw-queue';
const STORE_NAME = 'pending-reports';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function addToQueue(url, headers, body) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({
      url,
      headers: Object.fromEntries(new Headers(headers).entries()),
      body,
      timestamp: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getQueuedReports() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function removeFromQueue(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ═══════════════════════════════════════════════════════════════
//  MESSAGE HANDLER — Queue reports from main thread
// ═══════════════════════════════════════════════════════════════

// Main thread can send { type: 'QUEUE_REPORT', url, headers, body }
// when a submission fails due to offline state
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'QUEUE_REPORT') {
    const { url, headers, body } = event.data;
    addToQueue(url, headers, body)
      .then(() => {
        // Register for background sync
        if (self.registration.sync) {
          return self.registration.sync.register(SYNC_TAG);
        }
      })
      .then(() => {
        event.source.postMessage({
          type: 'QUEUE_CONFIRM',
          message: 'Report queued for sync — रिपोर्ट सिंक के लिए कतार में है',
        });
      })
      .catch((err) => {
        console.error('SW message QUEUE_REPORT:', err);
      });
  }
});
