import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    hub: "packages/hub/src/main.ts",
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node24",
  // Keep dist/web and dist/apps intact when rebuilding only the hub.
  clean: false,
  sourcemap: true,
  splitting: false,
  // Bundle the workspace and runtime dependencies so the built hub can run
  // from dist/ with only Node installed.
  noExternal: [/.*/],
});
