#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve("app.json");
const generatedManifestPath = resolve(".app.pack.json");
const hubOrigin = process.env.HUB_ORIGIN?.trim();

let manifestToPack = manifestPath;

try {
  if (hubOrigin) {
    let origin;
    try {
      origin = new URL(hubOrigin).origin;
    } catch {
      throw new Error(`HUB_ORIGIN is not a valid URL: ${hubOrigin}`);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const network = manifest.permissions?.find(
      (permission) => permission.name === "network",
    );
    if (!network) {
      throw new Error("app.json has no network permission to configure");
    }

    network.whitelist = [origin, "http://127.0.0.1:8787"];
    writeFileSync(
      generatedManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    manifestToPack = generatedManifestPath;
    console.log(`Packing with hub origin ${origin}`);
  } else {
    console.warn(
      "HUB_ORIGIN is not set; packing the placeholder whitelist from app.json",
    );
  }

  const result = spawnSync("evenhub", ["pack", manifestToPack, "dist"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(generatedManifestPath, { force: true });
}
