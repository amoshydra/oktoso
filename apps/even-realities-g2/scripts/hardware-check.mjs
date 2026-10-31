#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const manifest = readJson(join(appRoot, "app.json"));
const appPackage = readJson(join(appRoot, "package.json"));
const rootPackage = readJson(join(repoRoot, "package.json"));

check(
  manifest.package_id === "com.amoshydra.oktoso.eveng2",
  "app.json package_id changed; update the Even Hub listing and trusted origins.",
);
check(
  manifest.version === rootPackage.version,
  `app.json version ${manifest.version} does not match root package ${rootPackage.version}.`,
);
check(
  appPackage.version === rootPackage.version,
  `G2 package version ${appPackage.version} does not match root package ${rootPackage.version}.`,
);
check(
  typeof manifest.name === "string" && manifest.name.length <= 20,
  "app.json name must be 20 characters or fewer.",
);
check(manifest.entrypoint === "index.html", "app.json entrypoint must be index.html.");
check(
  manifest.edition === "202601",
  "app.json edition changed; revalidate the Even Hub SDK compatibility.",
);

const network = manifest.permissions?.find(
  (permission) => permission.name === "network",
);
check(Boolean(network), "app.json is missing the network permission.");
const whitelist = network?.whitelist ?? [];
check(whitelist.length > 0, "app.json network whitelist is empty.");
for (const origin of whitelist) {
  try {
    const url = new URL(origin);
    check(
      url.protocol === "http:" || url.protocol === "https:",
      `Network whitelist entry is not HTTP(S): ${origin}`,
    );
  } catch {
    failures.push(`Network whitelist entry is not a URL: ${origin}`);
  }
}
if (whitelist.includes("https://hub.example.com")) {
  warnings.push(
    "app.json still contains the placeholder https://hub.example.com origin. Pack with HUB_ORIGIN for hardware.",
  );
}

const distCandidates = [
  join(appRoot, "dist"),
  join(repoRoot, "dist/apps/even-g2"),
];
const dist = distCandidates.find((candidate) => existsSync(candidate));
check(
  Boolean(dist),
  "No G2 build found. Run pnpm build:single-port or pnpm build:even-g2 first.",
);
const index = dist ? join(dist, "index.html") : "";
check(Boolean(index && existsSync(index)), "dist/index.html is missing. Build the G2 app first.");

if (index && existsSync(index)) {
  const html = readFileSync(index, "utf8");
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => value && !/^(?:https?:|data:|#)/.test(value));
  check(assets.length > 0, "dist/index.html does not reference any built assets.");
  for (const asset of assets) {
    const relative = asset
      .replace(/^\/apps\/even-g2\//, "")
      .replace(/^\//, "");
    check(
      existsSync(join(dist, relative)),
      `Referenced asset is missing from dist: ${asset}`,
    );
  }

  const assetsDir = join(dist, "assets");
  if (existsSync(assetsDir)) {
    const snapshot = readdirSync(assetsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    check(snapshot.length > 0, "dist/assets/ is empty.");
  }
}

console.log("Oktoso G2 hardware preflight");
console.log(`  app version: ${manifest.version}`);
console.log(`  hub version: ${rootPackage.version}`);
console.log(`  entrypoint:  ${manifest.entrypoint}`);
console.log(`  network:     ${whitelist.join(", ") || "(none)"}`);
console.log("");

for (const warning of warnings) console.warn(`WARN  ${warning}`);
for (const failure of failures) console.error(`FAIL  ${failure}`);
if (failures.length === 0) {
  console.log("OK    Manifest, versions, and built assets are consistent.");
  console.log("");
  console.log("Next: run the scripted checks in docs/g2-hardware-validation.md.");
  process.exitCode = 0;
} else {
  console.error(`${failures.length} preflight check(s) failed.`);
  process.exitCode = 1;
}
