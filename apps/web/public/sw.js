const CACHE = "oktoso-shell-v1";
const SHELL = ["/", "/site.webmanifest", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        // The shell's hashed JS/CSS are not known ahead of time. Read the
        // built index and precache every /assets/ reference with it, so an
        // offline reload can actually boot the app.
        const response = await fetch("/", { cache: "reload" });
        if (response.ok) {
          const html = await response.clone().text();
          const assets = [
            ...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
          ].map((match) => match[1]);
          await cache.put("/", response);
          await cache.addAll([
            ...SHELL.filter((url) => url !== "/"),
            ...assets,
          ]);
          return;
        }
      } catch {
        // Fall through to the plain shell list.
      }
      await cache.addAll(SHELL).catch(() => undefined);
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/apps/")) {
    return;
  }

  // The app shell is network-first so a deploy is picked up, with the cached
  // shell as the offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/");
        return cached ?? Response.error();
      }),
    );
    return;
  }

  // Hashed assets and icons are immutable enough for cache-first.
  if (
    url.pathname.startsWith("/assets/") ||
    /\.(?:woff2?|png|svg|ico)$/.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" && data.title ? data.title : "Oktoso";
  const body =
    typeof data.body === "string" && data.body
      ? data.body
      : "Something needs attention.";
  const url = typeof data.url === "string" && data.url ? data.url : "/inbox";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof data.tag === "string" && data.tag ? data.tag : "oktoso",
      data: { url },
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      requireInteraction: data.priority === "blocking",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const relative =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/inbox";
  const target = new URL(relative, self.location.origin).href;
  const targetPath = new URL(target).pathname;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const sameOrigin = windows.filter((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      const exact = sameOrigin.find((client) => {
        try {
          return new URL(client.url).pathname === targetPath;
        } catch {
          return false;
        }
      });
      const client = exact ?? sameOrigin[0];

      if (client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
