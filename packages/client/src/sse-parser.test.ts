import { describe, expect, it } from "vitest";
import { SseParser } from "./sse-parser";

describe("SseParser", () => {
  it("parses events split across chunks", () => {
    const parser = new SseParser();
    expect(parser.push("id: 1\nevent: mess")).toEqual([]);
    const events = parser.push("age.delta\ndata: {\"x\":1}\n\nid: 2\ndata: two\n\n");
    expect(events).toEqual([
      { id: "1", event: "message.delta", data: '{"x":1}', retry: undefined },
      { id: "2", event: undefined, data: "two", retry: undefined },
    ]);
  });

  it("supports comments, CRLF, retry, and multiline data", () => {
    const parser = new SseParser();
    const events = parser.push(
      ": keepalive\r\nretry: 3000\r\nevent: custom\r\ndata: one\r\ndata: two\r\n\r\n",
    );
    expect(events).toEqual([
      { id: undefined, event: "custom", data: "one\ntwo", retry: 3000 },
    ]);
  });

  it("flushes a final event without a trailing blank line", () => {
    const parser = new SseParser();
    parser.push("data: final");
    expect(parser.end()).toEqual([
      { data: "final", event: undefined, id: undefined, retry: undefined },
    ]);
  });
});
