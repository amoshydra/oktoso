const PAIRING_PATH = /^\/pair\/([^/?#]+)\/?$/;
const PAIRING_CODE = /^[A-Za-z0-9_-]{8,128}$/;

export interface PairingInputOptions {
  /**
   * Origin the pairing URL must match. Omit to accept a pairing URL from any
   * origin, which is useful when the client is hosted away from the hub.
   */
  origin?: string;
}

export function isPairingUrl(value: string, origin?: string): boolean {
  try {
    const url = new URL(value, origin ?? "http://localhost");
    if (origin && url.origin !== origin) return false;
    return PAIRING_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Accepts either a raw pairing code or the pairing URL printed by the hub.
 * The URL may be absolute or root-relative.
 */
export function pairingCodeFromInput(
  value: string,
  options: PairingInputOptions = {},
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (PAIRING_CODE.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed, options.origin ?? "http://localhost");
    if (options.origin && url.origin !== options.origin) return undefined;
    const match = url.pathname.match(PAIRING_PATH);
    if (!match?.[1]) return undefined;
    const code = decodeURIComponent(match[1]);
    return PAIRING_CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * BarcodeDetector and getUserMedia both require a secure context. The OS
 * camera app remains the fallback on plain-HTTP LAN origins or unsupported
 * browsers.
 */
export function canScanPairingQr(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    "BarcodeDetector" in window &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

export async function scanPairingQr(
  video: HTMLVideoElement,
  signal: AbortSignal,
  options: PairingInputOptions = {},
): Promise<string | undefined> {
  if (!canScanPairingQr() || signal.aborted) return undefined;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });

  const stop = () => {
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };

  try {
    if (signal.aborted) return undefined;
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute("playsinline", "true");
    await video.play();

    const Detector = (
      window as unknown as { BarcodeDetector: BarcodeDetectorConstructor }
    ).BarcodeDetector;
    const detector = new Detector({ formats: ["qr_code"] });

    while (!signal.aborted) {
      let codes: DetectedBarcode[] = [];
      try {
        codes = await detector.detect(video);
      } catch {
        // The video frame may not be ready yet.
      }

      const match = codes.find((code) =>
        isPairingUrl(code.rawValue, options.origin),
      );
      if (match) return match.rawValue;

      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 200);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }

    return undefined;
  } finally {
    stop();
  }
}
