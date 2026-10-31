import { defineConfig } from "vite";

const apiTarget = process.env.HUB_DEV_API ?? "http://127.0.0.1:8787";
const devToken = process.env.HUB_DEV_TOKEN?.trim();

export default defineConfig({
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
  },
});
