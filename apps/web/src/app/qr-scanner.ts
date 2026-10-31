interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
}

export function isPairingUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === origin && url.pathname.startsWith("/pair/");
  } catch {
    return false;
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
    "BarcodeDetector" in window &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export async function scanPairingQr(
  video: HTMLVideoElement,
  signal: AbortSignal,
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
        isPairingUrl(code.rawValue, window.location.origin),
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
