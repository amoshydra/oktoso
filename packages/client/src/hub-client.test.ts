import { describe, expect, it } from "vitest";
import { HubClient } from "./hub-client";

describe("HubClient.sendMessage", () => {
  it("sends answer metadata and an idempotency key", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const hub = new HubClient({
      baseUrl: "http://hub",
      token: "owner-token",
      fetchImpl,
    });

    await hub.sendMessage(
      "desktop-opencode:ses_auth",
      {
        text: "Yes",
        answer: {
          questionId: "msg_1:q0",
          messageId: "msg_1",
          revision: "msg_1:abc123",
          choiceId: "msg_1:q0:c0",
          source: "boolean",
        },
      },
      { idempotencyKey: "answer-1" },
    );

    expect(captured?.url).toBe(
      "http://hub/api/v1/sessions/desktop-opencode%3Ases_auth/messages",
    );
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer owner-token");
    expect(headers.get("idempotency-key")).toBe("answer-1");
    expect(JSON.parse(String(captured?.init?.body))).toMatchObject({
      text: "Yes",
      answer: {
        questionId: "msg_1:q0",
        messageId: "msg_1",
        revision: "msg_1:abc123",
        choiceId: "msg_1:q0:c0",
        source: "boolean",
      },
    });
  });

  it("surfaces conflict details from the hub", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "conflict",
            message: "Question changed",
            retryable: false,
            details: { reason: "question_changed" },
          },
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;

    const hub = new HubClient({ baseUrl: "", fetchImpl });
    await expect(
      hub.sendMessage("desktop-opencode:ses_auth", { text: "Yes" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "conflict",
      details: { reason: "question_changed" },
    });
  });
});
