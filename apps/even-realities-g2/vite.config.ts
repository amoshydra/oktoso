import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const appVersion = (
  JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  ) as { version?: string }
).version ?? "0.0.0";
const apiTarget = process.env.HUB_DEV_API ?? "http://127.0.0.1:8787";
const devToken = process.env.HUB_DEV_TOKEN?.trim();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  server: {
    host: true,
    port: 5176,
    strictPort: true,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
        configure(proxy) {
          if (!devToken) return;
          proxy.on("proxyReq", (proxyReq, request) => {
            if (!request.headers.authorization) {
              proxyReq.setHeader("authorization", `Bearer ${devToken}`);
            }
          });
        },
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html",
        audit: "audit.html",
      },
    },
  },
});
