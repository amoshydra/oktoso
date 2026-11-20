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
  next?: string;
  verify?: string;
  extend?: string;
  ask?: string;
}): Response {
  return completion(
    JSON.stringify({
      answer: roles.answer ?? "",
      opposite: roles.opposite ?? "",
      next: roles.next ?? "",
      verify: roles.verify ?? "",
      extend: roles.extend ?? "",
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
        label: "Ask: Should I check the mirror first?",
      },
    ]);
  });

  it("still suggests while the agent is running", async () => {
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
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        next: "Check the build after it lands.",
        verify: "Rerun the tests after the build.",
        extend: "Add a build log line.",
        ask: "Which test is still failing?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings(),
      sessions(data, session({ status: "running" })),
      logger,
    );
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("wait");
    expect(result.kind).toBe("running");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      result.data.filter((option) => option.source === "model").map((option) => option.role),
    ).toEqual(["next", "verify", "extend", "ask"]);
  });

  it("still suggests after a finished delivery", async () => {
    const data = [
      textMessage("m1", "user", "Ship it"),
      textMessage(
        "m2",
        "assistant",
        "Done. Published 1.2.3. Nothing else is pending.",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        next: "Open the 1.2.3 release notes.",
        verify: "Check the published 1.2.3 artifact.",
        extend: "Add the 1.2.3 changelog entry.",
        ask: "Who should review 1.2.3 first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("done");
    expect(result.kind).toBe("delivery");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      result.data.filter((option) => option.source === "model").map((option) => option.role),
    ).toEqual(["next", "verify", "extend", "ask"]);
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
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        next: "Open the 1.2.3 release notes.",
        verify: "Check the published 1.2.3 artifact.",
        extend: "Add the 1.2.3 changelog entry.",
        ask: "Who should review 1.2.3 first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("done");
    expect(result.pending).toBeUndefined();
    // Finished is not "no reply needed": the model still suggests next steps.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      result.data.filter((option) => option.source === "model"),
    ).toHaveLength(4);
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

  it("treats a direct correction as a challenge, not a failure", async () => {
    const data = [
      textMessage(
        "m1",
        "user",
        "Does running it over SSH cause the delay? It works without delay locally.",
      ),
      textMessage(
        "m2",
        "assistant",
        "Short answer: no — SSH isn't in the audio path, so it can't add latency by itself. Check the local environment instead.",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Check the local environment.",
        opposite: "Test the SSH launch again.",
        ask: "Should I compare the two launch environments first?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.state).toBe("reply");
    expect(result.kind).toBe("challenge");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a failure when the user asks why it failed", async () => {
    const data = [
      textMessage("m1", "user", "Why did the build fail?"),
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

  it("uses the latest request instead of a stale original goal", async () => {
    const data = [
      // Newest-first, like the desc page the hub loads.
      textMessage("m4", "assistant", "Re-signed successfully. The commit is signed."),
      textMessage("m3", "user", "i unlocked gpg. resign again"),
      textMessage("m2", "assistant", "The md file is only a template."),
      textMessage(
        "m1",
        "user",
        "load and check session ses_e34f notice that it mention a md file. but there is nothing i can do about this md file. what do you suggest?",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Let it finish.",
        opposite: "Stop the run.",
        next: "Check the signed commit.",
        verify: "Run git log --show-signature.",
        extend: "Tag the release.",
        ask: "Should I rerun the suite?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const goal = audit.context
      .split("\n")
      .find((line) => line.startsWith("  user_goal:"));

    expect(goal).toBe("  user_goal: i unlocked gpg. resign again");
    expect(goal).not.toContain("md file");
  });

  it("falls back to the last substantive request for an acknowledgement", async () => {
    const data = [
      // Newest-first, like the desc page the hub loads.
      textMessage("m4", "assistant", "Switched to the mirror."),
      textMessage("m3", "user", "yes"),
      textMessage("m2", "assistant", "Should I switch to the mirror?"),
      textMessage("m1", "user", "Fix the docker pull failure"),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Thanks.",
        opposite: "Switch back.",
        next: "Check the pull log.",
        verify: "Rerun the pull.",
        extend: "Pin the mirror.",
        ask: "Should I pin the mirror?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const goal = audit.context
      .split("\n")
      .find((line) => line.startsWith("  user_goal:"));

    expect(goal).toBe("  user_goal: Fix the docker pull failure");
  });
});

describe("ReplyService concurrency", () => {
  it("shares one generation for concurrent identical requests", async () => {
    const data = [
      textMessage("m1", "user", "Fix the docker pull failure"),
      textMessage("m2", "assistant", "Should I switch to the mirror?"),
    ];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return completionWith(
        JSON.stringify({
          answer: "Use the mirror.",
          opposite: "Retry the pull.",
          next: "Switch back to docker.",
          verify: "Check the pull logs.",
          extend: "Add a mirror fallback test.",
          ask: "Should I check the mirror first?",
        }),
        "The registry is unreachable.",
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const first = service.list("desktop-opencode:ses_1", "reply");
    const second = service.list("desktop-opencode:ses_1", "reply");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    release();
    const [a, b] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
});

describe("ReplyService role generation and lint", () => {
  it("keeps every usable role", async () => {
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
          next: "Switch back to docker.",
          verify: "Check the pull logs.",
          extend: "Add a mirror fallback test.",
          ask: "Should I check the mirror first?",
        }),
        "The registry is unreachable.",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "reply");

    expect(result.data.filter((option) => option.source === "model")).toHaveLength(
      6,
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
      audit.options.filter(
        (option) => option.source === "model" && option.role === "answer",
      ),
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
      audit.options.filter(
        (option) => option.source === "model" && option.role === "answer",
      ),
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

  it("keeps a wait reply to a wait message or an interrupt", async () => {
    const data = [
      textMessage("m1", "user", "Refactor the cache"),
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
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Let it finish.",
        opposite: "Keep it open for review.",
        next: "Check the cache keys.",
        verify: "Ping me when the tests pass.",
        ask: "Should I stop the test run?",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings(),
      sessions(data, session({ status: "running" })),
      logger,
    );
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(
      audit.options.find((option) => option.role === "answer")?.text,
    ).toBe("Let it finish.");
    expect(audit.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "opposite",
          reason: "not an interrupt",
        }),
      ]),
    );
  });

  it("allows a short acknowledgement after a finished turn", async () => {
    const data = [
      textMessage("m1", "user", "Fix the auth race"),
      textMessage(
        "m2",
        "assistant",
        "Done. Fixed the auth race in session-service.ts.",
      ),
    ];
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        answer: "Thanks, looks good.",
        next: "Show me the diff.",
        verify: "Rerun the tests.",
        extend: "Add a regression test for the race.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.moment.state).toBe("done");
    expect(
      audit.options.find((option) => option.role === "answer")?.text,
    ).toBe("Thanks, looks good.");
  });

  it("repairs a full draft that lints down below four", async () => {
    const data = [
      textMessage("m1", "user", "Refactor the reply cache. Do not change the API."),
      textMessage(
        "m2",
        "assistant",
        "Done. The cache is bounded at 100 entries in reply-service.ts. All 459 tests pass. PR #92 is green. Merge it and I'll publish 0.1.29.",
      ),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        roleCompletion({
          answer: "Merge PR #92 now.",
          opposite: "Hold off for now.",
          next: "Check the hit/miss logs.",
          verify: "Check the hit/miss ratios.",
          extend: "Acknowledge the successful cache repair and delivery.",
          ask: "Should we also update every documentation page that mentions the cache bound and the API?",
        }),
      )
      .mockResolvedValueOnce(
        roleCompletion({
          answer: "Merge PR #92 now.",
          opposite: "Hold off for now.",
          next: "Run the 459 tests again.",
          verify: "Check the diff for API changes.",
          extend: "Update the README for the cache.",
          ask: "When should I publish 0.1.29?",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit.raw).toContain("--- retry ---");
    expect(
      audit.options.filter((option) => option.source === "model").length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      audit.options.find((option) => option.role === "next")?.text,
    ).toBe("Run the 459 tests again.");
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

describe("ReplyService live gate cases", () => {
  it("finds a pending question before two explanatory sentences", async () => {
    const data = [
      textMessage("m1", "user", "Deploy the app"),
      textMessage(
        "m2",
        "assistant",
        "OVHcloud VPS-1 in Singapore. That's the answer. One thing I need from you before you paste: a domain, or not? A real domain gives your wife a link she can tap. Say which and I'll pin the config.",
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Use a domain.",
          opposite: "Use Tailscale.",
          next: "Buy a domain.",
          verify: "Check the DNS record.",
          extend: "Add Caddy TLS.",
          ask: "Which domain?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.moment.state).toBe("reply");
    expect(audit.moment.kind).toBe("question");
    expect(audit.moment.pending).toContain("a domain, or not?");
    expect(audit.context).toContain(
      "recommendation: OVHcloud VPS-1 in Singapore.",
    );
  });

  it("does not treat headings or imperatives as completed work", async () => {
    const data = [
      textMessage("m1", "user", "Finish the release"),
      textMessage(
        "m2",
        "assistant",
        "**Accessibility pass**\nRun the full suite on the merged `main` commit.\nThe build passed.",
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Thanks, looks good.",
          opposite: "Nothing else for now.",
          next: "Show me the diff.",
          verify: "Rerun the tests.",
          extend: "Add a regression test.",
          ask: "Should I tag it?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.moment.done).toContain("The build passed.");
    expect(audit.moment.done).not.toContain("Accessibility pass");
    expect(audit.moment.done).not.toContain(
      "Run the full suite on the merged `main` commit.",
    );
  });

  it("marks the latest user turn and ignores internal running commands", async () => {
    const data = [
      textMessage("m3", "user", "Do the new task"),
      textMessage("m2", "assistant", "Working on it."),
      textMessage("m1", "user", "Do the first task"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Let it finish.",
          opposite: "Stop it, focus on the new task.",
          next: "Also check the second audit.",
          verify: "Check the combined diff.",
          extend: "Keep the worktrees separate.",
          ask: "Should both audits land together?",
        }),
      ),
    );

    const service = new ReplyService(
      settings(),
      sessions(
        data,
        session({ status: "running" }),
      ),
      logger,
    );
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.moment.state).toBe("wait");
    expect(audit.context).toContain("latest_turn: user");
    expect(audit.context).not.toContain("running: shell");
  });
});

describe("ReplyService G2 reply usability", () => {
  it("keeps an approval acceptance despite the generic guard", async () => {
    const data = [
      textMessage("m1", "user", "Merge it?"),
      textMessage(
        "m2",
        "assistant",
        "PR #92 is green. Merge it and I'll publish 0.1.29.",
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Go ahead and merge it.",
          opposite: "Hold off until the checks pass.",
          next: "Run the integration tests.",
          verify: "Check the diff.",
          extend: "Add a changelog note.",
          ask: "Should I tag the release?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const answer = audit.options.find((option) => option.role === "answer");

    expect(audit.moment.kind).toBe("approval");
    expect(answer?.text).toBe("Go ahead and merge it.");
  });

  it("repairs a challenge answer that restates the diagnosis", async () => {
    const data = [
      textMessage("m1", "user", "Why does the inbox flicker?"),
      textMessage(
        "m2",
        "assistant",
        "The inbox flickers because the attention list refetches on every event.",
      ),
      textMessage(
        "m3",
        "user",
        "No — that's not it. The drawer remounts, not the list.",
      ),
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        roleCompletion({
          answer: "The drawer remounts on every event.",
          opposite: "The list refetch is still the cause.",
          next: "Check the lifecycle hooks.",
          verify: "Rerun the profiler.",
          extend: "Add a regression test.",
          ask: "What triggers the remount?",
        }),
      )
      .mockResolvedValueOnce(
        roleCompletion({
          answer: "Agreed, drop the extra remount.",
          opposite: "The list refetch is still the cause.",
          next: "Check the lifecycle hooks.",
          verify: "Rerun the profiler.",
          extend: "Add a regression test.",
          ask: "What triggers the remount?",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const answer = audit.options.find((option) => option.role === "answer");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(audit.moment.kind).toBe("challenge");
    expect(answer?.text).toBe("Agreed, drop the extra remount.");
    expect(audit.raw).toContain("--- retry ---");
  });

  it("keeps a one-word acknowledgement on a finished turn", async () => {
    const data = [
      textMessage("m1", "user", "Fix the auth race"),
      textMessage("m2", "assistant", "Done. Fixed the auth race and pushed it."),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Done.",
          opposite: "Thanks, looks good.",
          next: "Show me the diff.",
          verify: "Rerun the tests.",
          extend: "Add a regression test.",
          ask: "Should I tag it?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const texts = audit.options
      .filter((option) => option.source === "model")
      .map((option) => option.text);

    expect(texts).toContain("Done.");
    expect(audit.rejected.some((item) => item.text === "Done.")).toBe(false);
  });

  it("applies the G2 compact length limit", async () => {
    const data = [
      textMessage("m1", "user", "Fix the docker pull failure"),
      textMessage(
        "m2",
        "assistant",
        "The pull failed. Should I switch to the mirror?",
      ),
    ];
    const longNext = "Run the configured mirror pull command again now.";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Switch to the mirror.",
          opposite: "Retry the pull first.",
          next: longNext,
          verify: "Check the logs.",
          extend: "Add a retry test.",
          ask: "Which mirror?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply", "g2");

    expect(audit.systemPrompt).toContain("at most 46 characters");
    expect(
      audit.rejected.some(
        (item) => item.role === "next" && item.reason === "too long",
      ),
    ).toBe(true);
    expect(
      audit.options.some((option) => option.text === longNext),
    ).toBe(false);
  });

  it("adds a usable acknowledgement when the model writes meta for done", async () => {
    const data = [
      textMessage("m1", "user", "Ship the provider limit fix"),
      textMessage("m2", "assistant", "Done. The provider limit is fixed and pushed."),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Acknowledge the successful fix and delivery.",
          opposite: "Revert the change.",
          next: "Run the provider smoke test.",
          verify: "Check the provider status output.",
          extend: "Add a limit regression test.",
          ask: "Should I tag the release?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const ack = audit.options.find((option) => option.id === "ack");

    expect(ack?.text).toBe("Thanks, looks good.");
    expect(ack?.role).toBe("answer");
    expect(audit.rejected.some((item) => item.role === "answer")).toBe(true);
  });

  it("keeps a natural question in extend", async () => {
    const data = [
      textMessage("m1", "user", "Pick the better deploy option"),
      textMessage(
        "m2",
        "assistant",
        "TREK is the better choice. Say the word and that goes too.",
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Yes, use TREK.",
          opposite: "Stick with AdventureLog.",
          next: "Rewrite the installer.",
          verify: "Show the installer diff.",
          extend: "Can you show me the script first?",
          ask: "What makes TREK better?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const texts = audit.options
      .filter((option) => option.source === "model")
      .map((option) => option.text);

    expect(texts).toContain("Can you show me the script first?");
    expect(audit.rejected.some((item) => item.role === "extend")).toBe(false);
  });

  it("anchors an ask to the task when pending is an offer", async () => {
    const data = [
      textMessage("m1", "user", "Use TREK for the deployment"),
      textMessage(
        "m2",
        "assistant",
        "TREK is the better choice. Say the word and that goes too.",
      ),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        roleCompletion({
          answer: "Yes, use TREK.",
          opposite: "Stick with AdventureLog.",
          next: "Rewrite the installer.",
          verify: "Show the installer diff.",
          extend: "Show the TREK installer script.",
          ask: "What makes TREK better?",
        }),
      ),
    );

    const service = new ReplyService(settings(), sessions(data), logger);
    const audit = await service.audit("desktop-opencode:ses_1", "reply");
    const ask = audit.options.find((option) => option.role === "ask");

    expect(ask?.text).toBe("What makes TREK better?");
    expect(audit.rejected.some((item) => item.role === "ask")).toBe(false);
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

  it("audits a wait moment with the model", async () => {
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
    const fetchMock = vi.fn(async () =>
      roleCompletion({
        next: "Check the build after it lands.",
        verify: "Rerun the tests after the build.",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings(),
      sessions(data, session({ status: "running" })),
      logger,
    );
    const audit = await service.audit("desktop-opencode:ses_1", "reply");

    expect(audit.moment.state).toBe("wait");
    expect(audit.context).toContain("running: shell pnpm test");
    expect(audit.raw).toContain("Check the build");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.options.length).toBeGreaterThan(0);
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

describe("ReplyService answer mode", () => {
  function pending(): Message[] {
    return [
      textMessage("m1", "user", "Fix the pull"),
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
  }

  it("returns short model answers for the pending question", async () => {
    const fetchMock = vi.fn(async () =>
      completion(
        JSON.stringify({
          answers: ["Use the mirror", "Retry the pull once", "Check the mirror first"],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings(),
      sessions(pending()),
      logger,
    );
    const result = await service.list("desktop-opencode:ses_1", "answer", "g2");

    expect(result.mode).toBe("answer");
    expect(result.data.map((option) => option.text)).toEqual([
      "Use the mirror",
      "Retry the pull once",
      "Check the mirror first",
    ]);
    for (const option of result.data) {
      expect(option.source).toBe("model");
      expect(option.action).toBe("send");
      expect(option.text.length).toBeLessThanOrEqual(46);
    }
    const body = requestBody(fetchMock);
    expect(body.messages[0]?.content).toContain("pending question");
    expect(body.messages[1]?.content).toContain("Should I switch to the mirror?");
    expect(body.messages[1]?.content).toContain("Use the mirror");
    expect(body.messages[1]?.content).toContain("user: Fix the pull");
  });

  it("drops long and duplicate answers and keeps at most three", async () => {
    const fetchMock = vi.fn(async () =>
      completion(
        JSON.stringify({
          answers: [
            "Use the mirror",
            "use the mirror",
            "A very long answer that is definitely over the forty six character limit",
            "Retry the pull",
            "Check the logs",
            "Rerun the build",
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(pending()), logger);
    const result = await service.list("desktop-opencode:ses_1", "answer", "g2");

    expect(result.data.map((option) => option.text)).toEqual([
      "Use the mirror",
      "Retry the pull",
      "Check the logs",
    ]);
  });

  it("returns no answers without a pending question", async () => {
    const data = [
      textMessage("m1", "user", "Ship it"),
      textMessage("m2", "assistant", "Done. Published 1.2.3."),
    ];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(settings(), sessions(data), logger);
    const result = await service.list("desktop-opencode:ses_1", "answer", "g2");

    expect(result.data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns no answers when the reply model is disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const service = new ReplyService(
      settings({ enabled: false }),
      sessions(pending()),
      logger,
    );
    const result = await service.list("desktop-opencode:ses_1", "answer", "g2");

    expect(result.data).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
