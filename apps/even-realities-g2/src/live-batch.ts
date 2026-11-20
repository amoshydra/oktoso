/**
 * Coalesce bursty live updates into one apply per window.
 *
 * A turn emits `message.updated` about five times a second. Applying each one
 * rebuilds the chat and writes to the glasses over BLE; on a phone and a pair
 * of glasses that is the difference between a readable stream and a warm
 * radio. `push` does not extend the window (throttle, not debounce) and the
 * timer always fires, so the final state is never dropped.
 */
export class LiveBatcher<T> {
  private pending = new Map<string, T>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly apply: (items: T[]) => void,
    private readonly waitMs = 600,
  ) {}

  push(key: string, item: T): void {
    this.pending.set(key, item);
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => this.flush(), this.waitMs);
  }

  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pending.size === 0) return;
    const items = [...this.pending.values()];
    this.pending.clear();
    this.apply(items);
  }

  clear(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
