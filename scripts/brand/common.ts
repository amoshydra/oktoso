import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

export const repoRoot = resolve(
  fileURLToPath(new URL("../..", import.meta.url)),
);

export const captureClock = "2026-10-27T10:52:00.000Z";
export const captureClockMs = Date.parse(captureClock);

export const outputSpecs = {
  "docs/screenshots/inbox.png": { width: 1440, height: 900 },
  "docs/screenshots/session.png": { width: 1440, height: 1100 },
  "docs/brand/banner.png": { width: 1600, height: 560 },
} as const;

export interface BrandOutput {
  sha256: string;
  width: number;
  height: number;
}

export interface BrandManifest {
  version: 1;
  capture: {
    clock: string;
    deviceScaleFactor: number;
    locale: string;
    timezone: string;
  };
  sources: Record<string, string>;
  outputs: Record<string, BrandOutput>;
}

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

export async function startStaticServer(root: string): Promise<{
  base: string;
  close: () => Promise<void>;
}> {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type":
          mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to read the brand screenshot server address.");
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      }),
  };
}

export async function launchBrandBrowser(): Promise<Browser> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  try {
    return await chromium.launch(
      executablePath ? { executablePath } : undefined,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to launch Chromium for brand screenshots.\nRun: pnpm exec playwright install chromium\n${detail}`,
    );
  }
}

export function newBrandPage(
  browser: Browser,
  viewport: { width: number; height: number },
): Promise<Page> {
  return browser.newPage({
    viewport,
    deviceScaleFactor: 2,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
}

export async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolvePromise) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => resolvePromise()),
      ),
    );
  });
}

export async function captureAt(
  page: Page,
  resizePage: Page,
  output: string,
  width: number,
  height: number,
): Promise<BrandOutput> {
  const screenshot = await page.screenshot({ type: "png" });
  const dataUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
  const resized = await resizePage.evaluate(
    async ({ dataUrl: source, width: targetWidth, height: targetHeight }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Canvas 2D context is unavailable.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, targetWidth, targetHeight);
      return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
    },
    { dataUrl, width, height },
  );

  const buffer = Buffer.from(resized, "base64");
  const dimensions = pngDimensions(buffer);
  if (dimensions.width !== width || dimensions.height !== height) {
    throw new Error(
      `${output}: expected ${width}x${height}, got ${dimensions.width}x${dimensions.height}`,
    );
  }
  await mkdir(dirname(resolve(repoRoot, output)), { recursive: true });
  await writeFile(resolve(repoRoot, output), buffer);
  return {
    sha256: sha256(buffer),
    width: dimensions.width,
    height: dimensions.height,
  };
}

export async function sourceFiles(): Promise<string[]> {
  // The prototype is the capture surface. The web UI files are included as
  // well so a production-only visual change also trips the freshness check.
  const fonts = (await readdir(resolve(repoRoot, "docs/prototypes/fonts")))
    .filter((file) => file.endsWith(".woff2"))
    .sort()
    .map((file) => `docs/prototypes/fonts/${file}`);

  return [
    "docs/prototypes/index.html",
    "docs/prototypes/app.js",
    "docs/prototypes/styles.css",
    ...fonts,
    "docs/brand/banner.html",
    "apps/web/src/app/App.tsx",
    "apps/web/src/app/BrandMark.tsx",
    "apps/web/src/app/markdown.ts",
    "apps/web/src/styles.css",
    "packages/ui/src/tokens.css",
    "packages/ui/src/base.css",
  ];
}

export async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(resolve(repoRoot, path)));
}

export function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function pngDimensions(buffer: Buffer): {
  width: number;
  height: number;
} {
  if (
    buffer.length < 24 ||
    buffer.toString("ascii", 1, 4) !== "PNG" ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error("Not a PNG file.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export function manifestPath(): string {
  return resolve(repoRoot, "docs/brand/manifest.json");
}

export async function readManifest(): Promise<BrandManifest> {
  const raw = await readFile(manifestPath(), "utf8");
  return JSON.parse(raw) as BrandManifest;
}

export async function writeManifest(manifest: BrandManifest): Promise<void> {
  await writeFile(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
}

