import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    hub: "packages/hub/src/main.ts",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node24",
  clean: true,
  sourcemap: true,
  splitting: false,
  // Bundle the workspace and runtime dependencies so the built hub can run
  // from dist/ with only Node installed.
  noExternal: [/.*/],
});
