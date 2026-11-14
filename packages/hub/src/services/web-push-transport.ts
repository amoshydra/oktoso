import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { Logger } from "../lib/logger";
import type {
  NotificationPayload,
  NotificationTransport,
} from "./notification-service";
import type { VapidKeys } from "./vapid";

export interface PushSubscriptionTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSender {
  send(
    subscription: PushSubscriptionTarget,
    body: string,
    options: { ttlSeconds: number; urgency: "high" | "normal" },
  ): Promise<void>;
}

export interface WebPushTransportOptions {
  store: StateStore;
  logger: Logger;
  vapid: VapidKeys & { subject: string };
  sender?: PushSender;
}

/** Default sender backed by Web Crypto. Injected in tests. */
export function createWebPushSender(
  vapid: VapidKeys & { subject: string },
): PushSender {
  return {
    async send(subscription, body, options) {
      const payload = await buildPushPayload(
        {
          data: JSON.parse(body) as Record<string, string | number | boolean>,
          options: { ttl: options.ttlSeconds, urgency: options.urgency },
        },
        {
          endpoint: subscription.endpoint,
          expirationTime: null,
          keys: subscription.keys,
        },
        vapid,
      );

      const response = await fetch(subscription.endpoint, {
        method: payload.method,
        headers: payload.headers as Record<string, string>,
        body: payload.body,
      });
      if (!response.ok) {
        throw Object.assign(
          new Error(`Push service returned ${response.status}`),
          { statusCode: response.status },
        );
      }
    },
  };
}

/**
 * Delivers a notification payload to every stored browser subscription.
 *
 * A subscription that the push service reports as gone is removed. Partial
 * success does not throw: retrying the batch would duplicate the deliveries
 * that already succeeded.
 */
export class WebPushTransport implements NotificationTransport {
  readonly publicKey: string;
  private readonly store: StateStore;
  private readonly logger: Logger;
  private readonly sender: PushSender;

  constructor(options: WebPushTransportOptions) {
    this.store = options.store;
    this.logger = options.logger;
    this.publicKey = options.vapid.publicKey;
    this.sender = options.sender ?? createWebPushSender(options.vapid);
  }

  supports(channel: string): boolean {
    if (channel !== "webpush") return false;
    return Object.keys(this.store.getState().notificationSubscriptions).length > 0;
  }

  async send(payload: NotificationPayload): Promise<void> {
    if (payload.channel !== "webpush") return;

    const subscriptions = Object.values(
      this.store.getState().notificationSubscriptions,
    );
    if (subscriptions.length === 0) return;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
      kind: payload.kind,
      count: payload.count,
      sessionRef: payload.attention.sessionRef,
      attentionID: payload.attention.id,
      type: payload.attention.type,
      priority: payload.attention.priority,
    });
    const options = {
      ttlSeconds: 3_600,
      urgency: payload.kind === "immediate" ? ("high" as const) : ("normal" as const),
    };

    let delivered = 0;
    let failed = 0;
    let lastError: unknown;

    for (const subscription of subscriptions) {
      try {
        await this.sender.send(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          options,
        );
        delivered += 1;
      } catch (error) {
        const status = statusCodeOf(error);
        if (status === 404 || status === 410) {
          await this.remove(subscription.id);
          this.logger.info("Removed expired push subscription", {
            deviceID: subscription.deviceID,
            status,
          });
          continue;
        }
        failed += 1;
        lastError = error;
        this.logger.warn("Push delivery failed", {
          deviceID: subscription.deviceID,
          status,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (delivered === 0 && failed > 0) throw lastError;
  }

  private async remove(id: string): Promise<void> {
    await this.store.update((state) => {
      delete state.notificationSubscriptions[id];
    });
  }
}

function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}
