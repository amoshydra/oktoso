export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
  retry?: number;
}

/**
 * Incremental SSE parser. Chunks may split anywhere, including mid-line and
 * between the two newlines that terminate an event.
 */
export class SseParser {
  private buffer = "";
  private dataLines: string[] = [];
  private eventName?: string;
  private eventId?: string;
  private retry?: number;

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    while (this.buffer.length > 0) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;

      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        const event = this.flush();
        if (event) events.push(event);
        continue;
      }

      if (line.startsWith(":")) continue;

      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      if (field === "data") this.dataLines.push(value);
      else if (field === "event") this.eventName = value;
      else if (field === "id") this.eventId = value;
      else if (field === "retry") {
        const n = Number(value);
        if (Number.isFinite(n)) this.retry = n;
      }
    }

    return events;
  }

  end(): SseEvent[] {
    if (this.buffer.length > 0) {
      this.buffer += "\n";
      this.push("");
    }
    const event = this.flush();
    return event ? [event] : [];
  }

  private flush(): SseEvent | undefined {
    if (this.dataLines.length === 0 && !this.eventName && !this.eventId) {
      return undefined;
    }

    const event: SseEvent = {
      data: this.dataLines.join("\n"),
      event: this.eventName,
      id: this.eventId,
      retry: this.retry,
    };
    this.dataLines = [];
    this.eventName = undefined;
    this.eventId = undefined;
    this.retry = undefined;
    return event;
  }
}
