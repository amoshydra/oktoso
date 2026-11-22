import type { HubClient } from "@amoshydra/oktoso-client";

export async function downloadAttachment(
  client: HubClient,
  providerID: string,
  url: string,
  name: string,
): Promise<void> {
  const blob = await client.attachment(providerID, url);
  saveBlob(blob, name);
}

export function saveBlob(blob: Blob, name: string): void {
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = (name || "attachment").replace(/[\\/]/g, "_");
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}

