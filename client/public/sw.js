/* ГРР-Контроль — service worker.
   Кэшируется только статика (оболочка приложения). Запросы к API не кэшируются никогда:
   данные всегда берутся с сервера, чтобы директор не увидел устаревшие цифры. */

const VERSION = "grr-control-v3";
const SHELL = `${VERSION}-shell`;
const OFFLINE_URL = "offline.html";

const SHELL_FILES = [
  "index.html",
  "offline.html",
  "manifest.webmanifest",
  "favicon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.allSettled(
        SHELL_FILES.map((f) => cache.add(new Request(new URL(f, self.registration.scope), { cache: "reload" }))),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !n.startsWith(VERSION)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

const isApi = (url) => /\/api\//.test(url.pathname) || /\/api\//.test(url.search);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // 1. API — только сеть, без кэша. При отсутствии связи — понятный ответ на русском.
  if (isApi(url)) {
    event.respondWith(
      fetch(req, { cache: "no-store" }).catch(
        () =>
          new Response(
            JSON.stringify({ error: "Нет подключения к сети. Данные будут доступны после восстановления связи." }),
            { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } },
          ),
      ),
    );
    return;
  }

  // 2. Переходы по адресам — сеть, при её отсутствии оболочка из кэша, затем страница «Нет подключения».
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match(new URL("index.html", self.registration.scope))) ||
            (await cache.match(new URL(OFFLINE_URL, self.registration.scope))) ||
            new Response("Нет подключения", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
          );
        }
      })(),
    );
    return;
  }

  // 3. Остальная статика (js, css, иконки, шрифты) — сначала кэш, затем сеть с дозаписью в кэш.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.status === 200 || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        if (req.destination === "document" || req.destination === "") {
          const off = await cache.match(new URL(OFFLINE_URL, self.registration.scope));
          if (off) return off;
        }
        return new Response("", { status: 503, statusText: "Нет подключения" });
      }
    })(),
  );
});
