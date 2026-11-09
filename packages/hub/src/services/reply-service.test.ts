import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantConfig,
  Message,
  MessagePart,
  Session,
} from "@amoshydra/oktoso-contracts";
import type { Logger } from "../lib/logger";
import type { AssistantSettingsService } from "./assistant-settings";
import { ReplyService } from "./reply-service";
import type { SessionService } from "./session-service";

const now = 1_793_000_000_000;

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const baseConfig: AssistantConfig = {
  reply: {
    enabled: true,
    baseUrl: "http://model.test/v1",
    model: "small-model",
    disableThinking: true,
    timeoutMs: 1_000,
  },
  transcription: {
    enabled: false,
    baseUrl: "",
    model: "",
    timeoutMs: 1_000,
  },
};

function settings(
  overrides: Partial<AssistantConfig["reply"]> = {},
): AssistantSettingsService {
  return {
    config: () => ({
      ...baseConfig,
      reply: { ...baseConfig.reply, ...overrides },
    }),
  } as unknown as AssistantSettingsService;
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    ref: "desktop-opencode:ses_1",
    providerID: "desktop-opencode",
    nativeID: "ses_1",
    title: "Docker pull failure",
    status: "idle",
    unread: false,
    updatedAt: now,
    createdAt: now,
    ...overrides,
  };
}

function message(
  id: string,
  role: Message["role"],
  parts: MessagePart[],
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    sessionRef: "desktop-opencode:ses_1",
    role,
    parts,
    createdAt: now,
    completedAt: now,
    ...overrides,
  };
}

function textMessage(
  id: string,
  role: Message["role"],
  text: string,
): Message {
  return message(id, role, [{ type: "text", text }]);
}

function completion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function completionWith(
  content: string,
  reasoning: string,
  finishReason = "stop",
): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { content, reasoning_content: reasoning },
          finish_reason: finishReason,
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function roleCompletion(roles: {
  answer?: string;
  opposite?: string;
  ask?: string;
}): Response {
  return completion(
    JSON.stringify({
      answer: roles.answer ?? "",
      opposite: roles.opposite ?? "",
      ask: roles.ask ?? "",
    }),
  );
}

function sessions(
  data: Message[],
  cachedSession?: Session,
): SessionService {
  return {
    messages: vi.fn(async () => ({
      data: [...data],
      cursor: { next: null, previous: null },
    })),
    cachedSession: vi.fn(() => cachedSession),
  } as unknown as SessionService;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index = 0): {
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string };
} {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReplyService gate", () => {
  it("answers a pending provider question", async () => {
    const data = [
      textMessage("m1", "user", "Do the thing"),
      message("m2", "assistant", [
        {
          type: "tool",
          id: "q",
          name: "question",
          status: "running",
          input: {
            questions: [
              {
                header: "Direction",
                question: "Should I switch to the mirror?",
                options: [
                  { label: "Use the mirror" },
                  { label: "Retry the pull" },
                ],
              },
            ],
          },
        },
      ]),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Use the mirror.",
        opposite: "Retry the pull.",
        ask: "Should I check the mirror first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("reply");
    expect(result.kind).toBe("question");
    expect(result.pending).toBe("Should I switch to the mirror?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      result.data.filter((option) => option.source === "model").map((option) => ({
        role: option.role,
        text: option.text,
        label: option.label,
      })),
    ).toEqual([
      { role: "answer", text: "Use the mirror.", label: "Use the mirror." },
      {
        role: "opposite",
        text: "Retry the pull.",
        label: "Alt: Retry the pull.",
      },
      {
        role: "ask",
        text: "Should I check the mirror first?",
        label: "Should I check the mirror first?",
      },
    ]);
  });

  it("waits while the agent is running and has not asked", async () => {
    const data = [
      textMessage("m1", "user", "Fix the build"),
      message("m2", "assistant", [
        {
          type: "tool",
          id: "t1",
          name: "shell",
          status: "running",
          input: { command: "pnpm test" },
        },
      ]),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings(),
      sessions(data, session({ status: "running" })),
      logger,
    );
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("wait");
    expect(result.kind).toBe("running");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data.every((option) => option.source === "canned")).toBe(
      true,
    );
  });

  it("returns done after a finished delivery with no ask", async () => {
    const data = [
      textMessage("m1", "user", "Ship it"),
      textMessage(
        "m2",
        "assistant",
        "Done. Published 1.2.3. Nothing else is pending.",
      ),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("done");
    expect(result.kind).toBe("delivery");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data.every((option) => option.source === "canned")).toBe(
      true,
    );
  });

  it("treats a post-delivery explicit next action as a reply", async () => {
    const data = [
      textMessage("m1", "user", "Merge it"),
      textMessage(
        "m2",
        "assistant",
        "Done, verified both ways. You'll need to approve it in the PR page before it can go green, then merge it to publish 0.2.1. Nothing else is pending.",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Approve the PR for 0.2.1.",
        opposite: "Fix the Windows backend first.",
        ask: "Should I approve the workflow run first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("reply");
    expect(result.kind).toBe("approval");
    expect(result.pending).toContain("approve");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a completed text question as a reply", async () => {
    const data = [
      textMessage("m1", "user", "Fix the docker pull failure"),
      textMessage(
        "m2",
        "assistant",
        "The pull failed. Should I switch to the mirror?",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Use the mirror.",
        opposite: "Retry the pull.",
        ask: "Should I check the mirror first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("reply");
    expect(result.kind).toBe("question");
    expect(result.pending).toBe("Should I switch to the mirror?");
  });

  it("does not treat a courtesy question as an ask", async () => {
    const data = [
      textMessage("m1", "user", "Ship it"),
      textMessage(
        "m2",
        "assistant",
        "Published 1.2.3. Anything else?",
      ),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("done");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a failure as a reply", async () => {
    const data = [
      textMessage("m1", "user", "Fix the build"),
      textMessage(
        "m2",
        "assistant",
        "The build failed: missing dependency. I cannot continue.",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Install the missing dependency.",
        opposite: "Stop and check the lockfile.",
        ask: "Should I check the lockfile first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("reply");
    expect(result.kind).toBe("failure");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("ReplyService moment", () => {
  it("includes the original request, done items, and constraints", async () => {
    const data = [
      textMessage("m1", "user", "Do the task"),
      textMessage(
        "m2",
        "assistant",
        "Done. Hub drop edge case fixed. Should I continue?",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Continue with the next fix.",
        opposite: "Stop and review the edge case.",
        ask: "Should I review the edge case first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.moment.state).toBe("reply");
    expect(audit.moment.done.length).toBeGreaterThan(0);
    expect(audit.context).toContain("done:");
    expect(audit.context).toContain("Hub drop edge case");
  });

  it("captures user constraints from subagent prompts", async () => {
    const data = [
      textMessage(
        "m1",
        "user",
        "You are a subagent spawned by another session.\nBake a face rig into the avatar.\n\nCONTEXT\n- Do NOT modify main. Only the worktree may be written.",
      ),
      textMessage("m2", "assistant", "Should I start the bake?"),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Start the face bake.",
        opposite: "Wait for the worktree review.",
        ask: "Should I bake the face rig now?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.context).toContain("user_goal: Bake a face rig into the avatar.");
    expect(audit.moment.constraints.some((item) => /do not/i.test(item))).toBe(
      true,
    );
    expect(audit.context).not.toContain("You are a subagent spawned");
  });
});

describe("ReplyService role generation and lint", () => {
  it("keeps a valid answer, opposite, and ask", async () => {
    const data = [
      textMessage("m1", "user", "Fix the docker pull failure"),
      textMessage(
        "m2",
        "assistant",
        "The pull failed. Should I switch to the mirror?",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      completionWith(
        JSON.stringify({
          answer: "Use the mirror.",
          opposite: "Retry the pull.",
          ask: "Should I check the mirror first?",
        }),
        "The registry is unreachable.",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.data.filter((option) => option.source === "model")).toHaveLength(
      3,
    );
    expect(result.confidence).toBe("high");
  });

  it("rejects a stale answer and falls back to canned options", async () => {
    const data = [
      textMessage("m1", "user", "Continue"),
      textMessage(
        "m2",
        "assistant",
        "Done. Hub drop edge case fixed. Should I continue?",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Start on the hub drop edge case.",
        opposite: "Stop and review it.",
        ask: "Should I review it first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(
      audit.options.filter((option) => option.source === "model"),
    ).toHaveLength(0);
    expect(audit.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "answer", reason: "stale" }),
      ]),
    );
  });

  it("rejects a constraint violation", async () => {
    const data = [
      textMessage("m1", "user", "Do not commit."),
      textMessage("m2", "assistant", "Should I commit the changes?"),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Commit the changes.",
        opposite: "Wait for review.",
        ask: "Should I show the diff first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "answer", reason: "constraint" }),
      ]),
    );
    expect(
      audit.options.filter((option) => option.source === "model"),
    ).toHaveLength(0);
  });

  it("rejects safety, meta, generic, and ungrounded text", async () => {
    const data = [
      textMessage("m1", "user", "Fix the docker pull failure"),
      textMessage(
        "m2",
        "assistant",
        "The pull failed. Should I switch to the mirror?",
      ),
    ];

    const cases = [
      "Merge and skip approval.",
      "Confirm the contrast is labeled.",
      "Proceed with the current approach.",
      "Swap avatar.vrm.",
    ];
    for (const answer of cases) {
      const fetchMock = vi.fn(async () =>
        roleCompletion({ answer, opposite: "", ask: "" }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const service = new ReplyService(settings(), sessions(data), logger);
      const audit = await service.audit("desktop-opencode:ses_1", "reply");
      expect(
        audit.rejected.some(
          (item) => item.role === "answer" && item.text === answer,
        ),
      ).toBe(true);
    }
  });

  it("rejects an ask that is not a question and a duplicate opposite", async () => {
    const data = [
      textMessage("m1", "user", "Fix the docker pull failure"),
      textMessage(
        "m2",
        "assistant",
        "The pull failed. Should I switch to the mirror?",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Use the mirror.",
        opposite: "Use the mirror now.",
        ask: "Check the logs.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "opposite", reason: "duplicate" }),
        expect.objectContaining({ role: "ask", reason: "not a question" }),
      ]),
    );
    expect(
      audit.options.filter((option) => option.source === "model"),
    ).toHaveLength(1);
  });

  it("does not call the model when the reply model is not configured", async () => {
    const data = [
      textMessage("m1", "user", "Fix the build"),
      textMessage("m2", "assistant", "Should I continue?"),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings({ enabled: false }),
      sessions(data),
      logger,
    );
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data.every((option) => option.source === "canned")).toBe(
      true,
    );
  });
});

describe("ReplyService caching", () => {
  it("reuses the cache for identical content and misses when the text changes", async () => {
    const data = [
      textMessage("m1", "user", "Fix the build"),
      textMessage("m2", "assistant", "Should I continue?"),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Continue the build.",
        opposite: "Stop the build.",
        ask: "Should I check the build logs?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    await service.list("desktop-opencode:ses_1", "reply");
    await service.list("desktop-opencode:ses_1", "reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    data[1] = textMessage("m2", "assistant", "Should I retry the build?");
    await service.list("desktop-opencode:ses_1", "reply");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejected generation", async () => {
    const data = [
      textMessage("m1", "user", "Fix the build"),
      textMessage("m2", "assistant", "Should I continue?"),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Proceed with the current approach.",
        opposite: "",
        ask: "",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const first = await service.list("desktop-opencode:ses_1", "reply");
    const second = await service.list("desktop-opencode:ses_1", "reply");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.confidence).toBe("low");
    expect(second.confidence).toBe("low");
  });

  it("falls back when the endpoint rejects structured output", async () => {
    const data = [
      textMessage("m1", "user", "Fix the build"),
      textMessage("m2", "assistant", "Should I continue?"),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("bad schema", { status: 400 }))
      .mockResolvedValueOnce(
        roleCompletion({
          answer: "Continue the build.",
          opposite: "Stop the build.",
          ask: "Should I check the build logs?",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1).response_format).toBeUndefined();
    expect(
      result.data.filter((option) => option.source === "model"),
    ).toHaveLength(3);
  });
});

describe("ReplyService audit", () => {
  it("returns the moment, context, raw output, and lint results", async () => {
    const data = [
      textMessage("m1", "user", "Fix the docker pull failure"),
      textMessage(
        "m2",
        "assistant",
        "The pull failed. Should I switch to the mirror?",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      completionWith(
        JSON.stringify({
          answer: "Use the mirror.",
          opposite: "Retry the pull.",
          ask: "Should I check the mirror first?",
        }),
        "The registry is unreachable.",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.systemPrompt).toContain("MOMENT");
    expect(audit.systemPrompt).toContain("opposite");
    expect(audit.context).toContain("moment:");
    expect(audit.context).toContain("pending: Should I switch to the mirror?");
    expect(audit.moment.state).toBe("reply");
    expect(audit.moment.kind).toBe("question");
    expect(audit.rejected).toEqual([]);
    expect(audit.raw).toContain("Use the mirror.");
    expect(audit.reasoning).toBe("The registry is unreachable.");
    expect(audit.finishReason).toBe("stop");

    await service.audit("desktop-opencode:ses_1", "reply");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not call the model for wait or done audits", async () => {
    const data = [
      textMessage("m1", "user", "Fix the build"),
      message("m2", "assistant", [
        {
          type: "tool",
          id: "t1",
          name: "shell",
          status: "running",
          input: { command: "pnpm test" },
        },
      ]),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings(),
      sessions(data, session({ status: "running" })),
      logger,
    );
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.moment.state).toBe("wait");
    expect(audit.raw).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ReplyService choices", () => {
  it("returns explicit choices from a provider question without a model call", async () => {
    const data = [
      message("m1", "assistant", [
        {
          type: "tool",
          id: "q",
          name: "question",
          status: "running",
          input: {
            questions: [
              {
                question: "Which registry?",
                options: [{ label: "mirror" }, { label: "upstream" }],
              },
            ],
          },
        },
      ]),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "choices");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data.map((option) => option.text)).toEqual([
      "mirror",
      "upstream",
    ]);
  });

  it("parses numbered choices introduced as options", async () => {
    const data = [
      textMessage(
        "m1",
        "assistant",
        "Options:\n1. use the mirror\n2. retry the pull",
      ),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "choices");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data.map((option) => option.text)).toEqual([
      "use the mirror",
      "retry the pull",
    ]);
  });

  it("does not treat a plan list or URL query as choices", async () => {
    const data = [
      textMessage(
        "m1",
        "assistant",
        "Plan:\n1. Inspect the repo\n2. Update the docs\n3. Run the tests\n\nhttps://example.test/?debug=true",
      ),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "choices");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
  });

  it("filters invented model choices against the assistant text", async () => {
    const data = [
      textMessage(
        "m1",
        "assistant",
        "Choose one option for the deployment.",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      completion(
        '{"choices":["What is the capital of France?","deployment"]}',
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "choices");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      text: "deployment",
      source: "model",
    });
  });
});
