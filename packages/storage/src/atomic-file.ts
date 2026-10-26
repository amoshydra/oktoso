import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** Write a JSON file atomically and durably. */
export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  const directory = dirname(filePath);
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(
    temporary,
    constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC,
    mode,
  );

  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  try {
    const directoryHandle = await open(directory, constants.O_RDONLY);
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    // Directory fsync is not available on every platform. The rename is enough
    // for portability; the file itself has already been synced.
  }
}
