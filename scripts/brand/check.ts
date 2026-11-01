import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import {
  manifestPath,
  outputSpecs,
  pngDimensions,
  readManifest,
  repoRoot,
  sha256,
  sha256File,
  sourceFiles,
  type BrandManifest,
} from "./common";

const failures: string[] = [];
const notes: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function absolute(path: string): string {
  return resolve(repoRoot, path);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(absolute(path));
    return true;
  } catch {
    return false;
  }
}

let manifest: BrandManifest;
try {
  manifest = await readManifest();
} catch {
  console.error(
    `brand:check failed\n\nMissing or unreadable ${manifestPath()}.\nRun: pnpm brand:screens`,
  );
  process.exit(1);
}

if (manifest.version !== 1) {
  fail(`Unsupported brand manifest version: ${manifest.version}. Run: pnpm brand:screens`);
}

const expectedSources = await sourceFiles();
const manifestSources = Object.keys(manifest.sources).sort();
const missingSources = expectedSources.filter(
  (file) => !manifestSources.includes(file),
);
const extraSources = manifestSources.filter(
  (file) => !expectedSources.includes(file),
);
if (missingSources.length > 0 || extraSources.length > 0) {
  const details = [
    ...missingSources.map((file) => `  added:   ${file}`),
    ...extraSources.map((file) => `  removed: ${file}`),
  ].join("\n");
  fail(`The brand source list changed.\n${details}\nRun: pnpm brand:screens`);
}

const changedSources: string[] = [];
for (const file of expectedSources) {
  if (!(await exists(file))) {
    fail(`Missing brand source: ${file}`);
    continue;
  }
  const digest = await sha256File(file);
  if (manifest.sources[file] !== digest) changedSources.push(file);
}
if (changedSources.length > 0) {
  fail(
    `Brand sources changed without a screenshot refresh:\n${changedSources
      .map((file) => `  ${file}`)
      .join("\n")}\nUpdate the prototype/screens, then run: pnpm brand:screens`,
  );
}

for (const [path, spec] of Object.entries(outputSpecs)) {
  if (!(await exists(path))) {
    fail(`Missing brand image: ${path}\nRun: pnpm brand:screens`);
    continue;
  }
  const buffer = await readFile(absolute(path));
  const digest = manifest.outputs[path]?.sha256;
  if (!digest || digest !== sha256(buffer)) {
    fail(`Brand image is stale or was edited: ${path}\nRun: pnpm brand:screens`);
    continue;
  }
  const dimensions = pngDimensions(buffer);
  if (dimensions.width !== spec.width || dimensions.height !== spec.height) {
    fail(
      `Wrong size for ${path}: ${dimensions.width}x${dimensions.height}, expected ${spec.width}x${spec.height}`,
    );
  }
}

const readme = await readFile(absolute("README.md"), "utf8");
const terminalHeading = readme.indexOf("## Terminal UI");
const terminalFence = readme.indexOf("```text", terminalHeading);
const terminalEnd =
  terminalFence === -1 ? -1 : readme.indexOf("```", terminalFence + 7);
if (terminalHeading === -1 || terminalFence === -1 || terminalEnd === -1) {
  fail("README.md is missing the Terminal UI code block.");
} else {
  const block = readme
    .slice(terminalFence + 7, terminalEnd)
    .replace(/^\n/, "")
    .replace(/\n$/, "");
  const lines = block.split("\n");
  const widths = new Set(lines.map((line) => [...line].length));
  if (widths.size !== 1) {
    const details = lines
      .map((line, index) => `  line ${index + 1}: ${[...line].length} columns`)
      .join("\n");
    fail(`The README Terminal UI block is not a rectangle.\n${details}`);
  } else if ([...widths][0] < 50) {
    fail(`The README Terminal UI block is too narrow: ${[...widths][0]} columns.`);
  } else {
    notes.push(`terminal grid ${[...widths][0]} cols`);
  }
}

const iconSpecs: Record<string, { width: number; height: number }> = {
  "apps/web/public/favicon-16.png": { width: 16, height: 16 },
  "apps/web/public/favicon-32.png": { width: 32, height: 32 },
  "apps/web/public/favicon-48.png": { width: 48, height: 48 },
  "apps/web/public/apple-touch-icon.png": { width: 180, height: 180 },
  "apps/web/public/icon-192.png": { width: 192, height: 192 },
  "apps/web/public/icon-512.png": { width: 512, height: 512 },
  "apps/web/public/maskable-192.png": { width: 192, height: 192 },
  "apps/web/public/maskable-512.png": { width: 512, height: 512 },
};
for (const [path, spec] of Object.entries(iconSpecs)) {
  if (!(await exists(path))) {
    fail(`Missing icon: ${path}`);
    continue;
  }
  try {
    const dimensions = pngDimensions(await readFile(absolute(path)));
    if (dimensions.width !== spec.width || dimensions.height !== spec.height) {
      fail(
        `Wrong size for ${path}: ${dimensions.width}x${dimensions.height}, expected ${spec.width}x${spec.height}`,
      );
    }
  } catch {
    fail(`Invalid PNG icon: ${path}`);
  }
}
notes.push(`${Object.keys(iconSpecs).length} app icons`);

try {
  const ico = await readFile(absolute("apps/web/public/favicon.ico"));
  if (
    ico.length < 6 ||
    ico.readUInt16LE(0) !== 0 ||
    ico.readUInt16LE(2) !== 1 ||
    ico.readUInt16LE(4) === 0
  ) {
    fail("apps/web/public/favicon.ico is missing or invalid.");
  }
} catch {
  fail("apps/web/public/favicon.ico is missing or unreadable.");
}

try {
  const manifestJson = JSON.parse(
    await readFile(absolute("apps/web/public/site.webmanifest"), "utf8"),
  ) as { icons?: Array<{ src?: string }> };
  if (!manifestJson.icons || manifestJson.icons.length < 4) {
    fail("apps/web/public/site.webmanifest is missing app icons.");
  } else {
    for (const icon of manifestJson.icons) {
      if (!icon.src) {
        fail("site.webmanifest has an icon without a src.");
        continue;
      }
      const path = `apps/web/public/${icon.src.replace(/^\/+/, "")}`;
      if (!(await exists(path))) {
        fail(`site.webmanifest references a missing icon: ${path}`);
      }
    }
  }
} catch {
  fail("apps/web/public/site.webmanifest is missing or invalid.");
}

for (const path of [
  "docs/brand/oktoso-mark.svg",
  "docs/brand/oktoso-mark-small.svg",
  "docs/brand/oktoso-mark-square.svg",
  "docs/brand/oktoso-mark-mono.svg",
  "docs/brand/banner.html",
  "docs/brand/banner.png",
  "docs/screenshots/inbox.png",
  "docs/screenshots/session.png",
  "apps/web/public/favicon.svg",
]) {
  if (!(await exists(path))) fail(`Missing brand asset: ${path}`);
}

if (!readme.includes("docs/brand/banner.png")) {
  fail("README.md does not reference docs/brand/banner.png.");
}
if (!readme.includes("docs/screenshots/session.png")) {
  fail("README.md does not reference docs/screenshots/session.png.");
}

if (failures.length > 0) {
  console.error(`brand:check failed\n\n${failures.join("\n\n")}`);
  process.exit(1);
}

console.log(
  `brand:check ok — ${expectedSources.length} sources fresh, ${Object.keys(outputSpecs).length} images current, ${notes.join(", ")}`,
);
