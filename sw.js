// sw.js — Arena Tactics Manager PWA Service Worker
const CACHE_NAME = "atm-pwa-v6";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.json",
  "./icon.svg",
  "./vendor/three/three.module.min.js",
  "./js/state.js",
  "./js/engine.js",
  "./js/league.js",
  "./js/network.js",
  "./js/audio.js",
  "./js/models3d.js",
  "./js/renderer.js",
  "./js/hud.js",
  "./js/controller.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Neon HTTP SQL API 및 비-GET 요청은 절대 캐시하지 않고 네트워크 직통
  if (req.method !== "GET" || url.pathname.endsWith("/sql") || url.hostname.includes("neon.tech")) {
    return;
  }

  // 동일 출처 에셋은 Network-First 후 캐시 폴백으로 최신 코드 + 오프라인 기동 동시 보장
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
  }
});
