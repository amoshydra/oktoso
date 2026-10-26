import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { writeJsonAtomic } from "./atomic-file";
import {
  createInitialState,
  zHubState,
  type HubState,
  type StateStore,
} from "./state";

export interface JsonStateStoreOptions {
  filePath: string;
  mode?: number;
}

export class JsonStateStore implements StateStore {
  readonly kind = "json";
  private state: HubState;
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private readonly mode: number,
    state: HubState,
  ) {
    this.state = state;
  }

  static async open(options: JsonStateStoreOptions): Promise<JsonStateStore> {
    const mode = options.mode ?? 0o600;
    await mkdir(dirname(options.filePath), { recursive: true, mode: 0o700 });

    let state: HubState;
    try {
      const raw = await readFile(options.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      state = migrate(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(
          `Unable to load hub state from ${options.filePath}: ${(error as Error).message}`,
          { cause: error },
        );
      }
      state = createInitialState();
      await writeJsonAtomic(options.filePath, state, mode);
    }

    return new JsonStateStore(options.filePath, mode, state);
  }

  getState(): HubState {
    return this.state;
  }

  async update(
    mutator: (state: HubState) => void | Promise<void>,
  ): Promise<HubState> {
    let result!: HubState;
    const next = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      await mutator(draft);
      const parsed = zHubState.parse(draft);
      await writeJsonAtomic(this.filePath, parsed, this.mode);
      this.state = parsed;
      result = parsed;
    });
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
    return result;
  }

  async close(): Promise<void> {
    await this.queue;
  }
}

function migrate(raw: unknown): HubState {
  if (!raw || typeof raw !== "object") {
    throw new Error("State must be a JSON object");
  }

  const schemaVersion = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion === undefined) {
    return zHubState.parse({ ...createInitialState(), ...raw, schemaVersion: 1 });
  }
  if (schemaVersion !== 1) {
    throw new Error(
      `Unsupported hub state schema version: ${String(schemaVersion)}. Back up the state file and migrate it explicitly.`,
    );
  }
  return zHubState.parse(raw);
}
