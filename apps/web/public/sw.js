const CACHE = 'pontoproof-v5';
const MODEL_CACHE = 'pontoproof-biometric-models-v2';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(k=>k.startsWith('pontoproof-')&&k!==CACHE&&k!==MODEL_CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url=new URL(event.request.url);
  // Model weights are immutable within a release and expensive to download.
  // Cache-first makes every biometric capture after the first one start much faster.
  if(url.origin===self.location.origin && url.pathname.startsWith('/models/human/')){
    event.respondWith((async()=>{
      const cache=await caches.open(MODEL_CACHE);
      const cached=await cache.match(event.request);
      if(cached)return cached;
      const response=await fetch(event.request);
      if(response.ok)cache.put(event.request,response.clone());
      return response;
    })());
    return;
  }
  // Keep the application itself network-first so deployments update immediately.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(r => r || caches.match('/'))));
});
