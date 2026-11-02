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

  it("requests question summaries with repeated refs", async () => {
    let url = "";
    const fetchImpl = (async (input: RequestInfo | URL) => {
      url = String(input);
      return new Response(JSON.stringify({ data: [], failed: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const hub = new HubClient({
      baseUrl: "http://hub",
      token: "owner-token",
      fetchImpl,
    });
    await hub.questionSummaries(["desktop-opencode:ses_a", "openwebui:chat_b"]);
    expect(url).toBe(
      "http://hub/api/v1/questions?ref=desktop-opencode%3Ases_a&ref=openwebui%3Achat_b",
    );
  });
});

describe("HubClient.attachment", () => {
  it("fetches a provider attachment with the token", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init };
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as typeof fetch;
    const hub = new HubClient({
      baseUrl: "http://hub",
      token: "owner-token",
      fetchImpl,
    });

    const blob = await hub.attachment(
      "desktop-opencode",
      "http://127.0.0.1:4096/api/files/shot.png",
    );

    expect(captured?.url).toBe(
      "http://hub/api/v1/attachments?provider=desktop-opencode&url=http%3A%2F%2F127.0.0.1%3A4096%2Fapi%2Ffiles%2Fshot.png",
    );
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer owner-token");
    expect(headers.get("accept")).toBe("*/*");
    expect(captured?.init?.credentials).toBe("same-origin");
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(4);
  });
});

describe("HubClient.transcribe", () => {
  it("posts multipart audio and returns the transcript", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init };
      return new Response(
        JSON.stringify({
          data: { text: "hello from the hub", model: "whisper-1" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;
    const hub = new HubClient({
      baseUrl: "http://hub",
      token: "owner-token",
      fetchImpl,
    });

    const result = await hub.transcribe(
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
      { language: "en" },
    );

    expect(result).toEqual({
      text: "hello from the hub",
      model: "whisper-1",
    });
    expect(captured?.url).toBe("http://hub/api/v1/transcribe");
    const headers = new Headers(captured?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer owner-token");
    expect(headers.get("accept")).toBe("application/json");
    expect(captured?.init?.credentials).toBe("same-origin");
    const form = captured?.init?.body as FormData;
    expect(form.get("language")).toBe("en");
    const file = form.get("audio") as File;
    expect(file.name).toBe("audio.webm");
    expect(file.type).toBe("audio/webm");
    expect(file.size).toBe(3);
  });

  it("surfaces transcription capability errors", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "transcription_disabled",
            message: "Voice transcription is disabled in the hub settings",
            retryable: false,
          },
        }),
        {
          status: 409,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;
    const hub = new HubClient({ baseUrl: "", fetchImpl });
    await expect(
      hub.transcribe(new Blob([new Uint8Array([1])], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      status: 409,
      code: "transcription_disabled",
    });
  });
});

describe("HubClient.setSessionSelection", () => {
  it("posts the model and agent and returns the updated session", async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const session = {
      ref: "desktop-opencode:ses_auth",
      providerID: "desktop-opencode",
      nativeID: "ses_auth",
      title: "Fix auth race",
      agent: "plan",
      model: "commandcode/claude-sonnet#high",
      status: "idle",
      unread: false,
      createdAt: 1,
      updatedAt: 2,
    };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init };
      return new Response(JSON.stringify(session), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const hub = new HubClient({
      baseUrl: "http://hub",
      token: "owner-token",
      fetchImpl,
    });

    const updated = await hub.setSessionSelection(session.ref, {
      agent: "plan",
      model: "commandcode/claude-sonnet#high",
    });

    expect(captured?.url).toBe(
      "http://hub/api/v1/sessions/desktop-opencode%3Ases_auth/selection",
    );
    expect(JSON.parse(String(captured?.init?.body))).toEqual({
      agent: "plan",
      model: "commandcode/claude-sonnet#high",
    });
    expect(updated).toMatchObject({
      agent: "plan",
      model: "commandcode/claude-sonnet#high",
    });
  });
});
