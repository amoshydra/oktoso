import type { Logger } from "../lib/logger";

export interface AppEnv {
  Variables: {
    requestId: string;
    logger: Logger;
  };
}
