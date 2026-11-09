import { createHash } from "node:crypto";
import type {
  AssistantConfig,
  Message,
  MessagePage,
  QuestionPrompt,
  ReplyAudit,
  ReplyAuditQuestion,
  ReplyConfidence,
  ReplyMode,
  ReplyMoment,
  ReplyMomentKind,
  ReplyOption,
  ReplyOptions,
  ReplyRejected,
  ReplyRole,
  ReplyState,
  Session,
} from "@amoshydra/oktoso-contracts";
import type { Logger } from "../lib/logger";
import type { AssistantSettingsService } from "./assistant-settings";
import { parseQuestion } from "./question-parser";
import { extractToolQuestion } from "./tool-question";
import type { SessionService } from "./session-service";

interface CacheEntry {
  expiresAt: number;
  value: ReplyOptions;
}

interface CompletionResult {
  content: string;
  reasoning: string;
  finishReason?: string;
}

interface ChoiceGeneration {
  options: ReplyOption[];
  raw: string;
  reasoning: string;
  finishReason?: string;
}

interface RoleTexts {
  answer: string;
  opposite: string;
  ask: string;
}

interface MomentContext {
  moment: ReplyMoment;
  question?: ReplyAuditQuestion;
  userGoal: string;
  lastUser: string;
  lastAssistantTail: string;
  evidence: string;
}

const CACHE_TTL_MS = 5 * 60 * 1_000;
const CACHE_MAX_ENTRIES = 100;
const CONTEXT_MESSAGE_LIMIT = 40;
const MAX_CONTEXT_PAGES = 4;
const MAX_EVIDENCE_MESSAGES = 3;
const MAX_EVIDENCE_CHARS = 400;
const MAX_MOMENT_HEAD_CHARS = 200;
const MAX_MOMENT_TAIL_CHARS = 700;
const MAX_PENDING_CHARS = 300;
const MAX_REQUEST_CHARS = 200;
const MAX_DONE_CHARS = 160;
const MAX_CONSTRAINT_CHARS = 200;
const MAX_SUGGESTION_CHARS = 80;
const MAX_ROLE_WORDS = 12;
const MIN_ROLE_WORDS = 3;
const MAX_CHOICES = 5;

const COURTESY =
  /^(anything else|does (that|this) make sense|any questions|all good|sound good|thoughts|let me know|thanks|thank you|cheers)\b/i;
const ASK_OFFER =
  /\b(want me to|should i|shall i|would you like|unless you want|if you want|let me know|say so)\b/i;
const APPROVAL =
  /\b(approve|approval|permission|allow|authorize|workflow run|merge|deploy|publish|review|sign off)\b/i;
const FAILURE =
  /\b(failed|failure|error|blocked|cannot|can't|unable|timed out|not found)\b/i;
const DELIVERED =
  /\b(done|delivered|committed|merged|published|all green|no further action|nothing else is pending|installed|released|fixed|verified)\b/i;
const ACTION_NEEDED =
  /\b(you'll need to|you need to|please (?:approve|merge|review|confirm|run)|approve (?:it|the)|waiting for (?:your|approval)|requires? (?:your )?approval|before it can go green|merge it to publish|merge (?:#\d+|the pr|it)|say the word|needs? your (?:approval|review))\b/i;
const DONE_START =
  /^(done|delivered|committed|merged|published|verified|fixed|installed|released|updated|passed|all green)\b/i;
const CONSTRAINT_WORD = /\b(do not|don't|never|only|keep|without)\b/i;
const META_TEXT =
  /\b(contrast|alt|alternative role|restatement|audit|evaluation|system prompt|context policy|json|moment|suggestion)\b/i;
const UNSAFE_TEXT =
  /\b(?:skip|bypass|ignore|circumvent)\b[^.]*\b(?:approval|review|permission|guard|check|auth|security)\b/i;
const UNSAFE_TEXT_ALT =
  /\bwithout\b[^.]*\b(?:approval|review|permission|guard|check)\b/i;
const GENERIC =
  /^(proceed with the current approach|continue with the current approach|keep going|sounds good|looks good|that works|do it|go ahead|carry on)\b/i;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "about",
  "after",
  "before",
  "when",
  "what",
  "where",
  "which",
  "while",
  "your",
  "you",
  "our",
  "their",
  "them",
  "they",
  "have",
  "has",
  "had",
  "was",
  "were",
  "are",
  "is",
  "be",
  "been",
  "will",
  "would",
  "could",
  "should",
  "can",
  "may",
  "might",
  "must",
  "not",
  "only",
  "just",
  "then",
  "than",
  "now",
  "more",
  "most",
  "some",
  "any",
  "all",
  "both",
  "each",
  "other",
  "such",
  "too",
  "very",
  "same",
  "own",
  "also",
  "but",
  "because",
  "there",
  "here",
  "its",
  "it's",
  "let",
]);

const REPLY_SYSTEM_PROMPT = `You write messages a user can send to an AI coding agent.
The hub has already classified the moment. Use the MOMENT block, not the whole transcript.

Write JSON:
- "answer": answer the pending question or proposal, or respond to the reported result.
- "opposite": the opposite decision or a different valid route. It must be mutually exclusive with answer, not a rewording.
- "ask": one question that resolves the single most important ambiguity, or "".

Rules:
- Never propose anything listed in done.
- Never contradict a constraint.
- Never bypass an approval, permission, or safety check.
- Ground every message in a real entity from MOMENT. No invented files, versions, or options.
- 3-12 words. Plain text. User voice. No quotes, no numbering, no meta commentary.
- If the moment genuinely has no decision, return all empty strings.
Return only JSON.`;

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    opposite: { type: "string" },
    ask: { type: "string" },
  },
  required: ["answer", "opposite", "ask"],
  additionalProperties: false,
} as const;

const CHOICE_SYSTEM_PROMPT = `Extract the answer choices the assistant offered in its latest message.
Rules:
- Only use choices that appear in the text. Never invent options.
- Preserve the original wording; remove numbering and explanations.
- If there are no explicit choices, return an empty array.
Return only a JSON object with a "choices" array of strings.`;

const CHOICE_SCHEMA = {
  type: "object",
  properties: {
    choices: {
      type: "array",
      items: { type: "string" },
      minItems: 0,
      maxItems: MAX_CHOICES,
    },
  },
  required: ["choices"],
  additionalProperties: false,
} as const;

export class ReplyService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly settings: AssistantSettingsService,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
  ) {}

  /**
   * The newest 40 messages for the moment, plus the most recent user turn even
   * when an agentic run has pushed it outside that window. Paging stops as soon
   * as a user message is found or the page budget is exhausted.
   */
  private async loadContext(ref: string): Promise<{
    latest: MessagePage;
    messages: Message[];
    originalRequest?: Message;
    latestRequest?: Message;
  }> {
    const first = await this.sessions.messages(ref, {
      limit: CONTEXT_MESSAGE_LIMIT,
      order: "desc",
    });
    let latestRequest = lastUserMessage(first.data);
    let cursor = first.cursor.next;
    let pages = 1;
    while (!latestRequest && cursor && pages < MAX_CONTEXT_PAGES) {
      const next = await this.sessions.messages(ref, {
        limit: CONTEXT_MESSAGE_LIMIT,
        cursor,
      });
      if (next.data.length === 0) break;
      latestRequest = lastUserMessage(next.data);
      cursor = next.cursor.next;
      pages += 1;
    }
    const originalRequest = await this.loadOriginalRequest(ref, first.data);
    return {
      latest: first,
      messages: [...first.data].reverse(),
      ...(originalRequest ? { originalRequest } : {}),
      ...(latestRequest ? { latestRequest } : {}),
    };
  }

  /**
   * The first user turn is the task anchor, but it is often far outside the
   * newest page. Fetch it oldest-first and only trust it when it is actually
   * older than the window; providers that ignore `order` may return the newest
   * page again.
   */
  private async loadOriginalRequest(
    ref: string,
    newest: Message[],
  ): Promise<Message | undefined> {
    try {
      const page = await this.sessions.messages(ref, {
        limit: 20,
        order: "asc",
      });
      const candidate = firstUserMessage(page.data);
      if (!candidate) return undefined;
      const oldest = newest.at(-1);
      if (oldest && candidate.createdAt > oldest.createdAt) return undefined;
      return candidate;
    } catch (error) {
      this.logger.warn("Original request lookup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async list(ref: string, mode: ReplyMode): Promise<ReplyOptions> {
    const { latest, messages, originalRequest, latestRequest } =
      await this.loadContext(ref);
    const config = this.settings.config();
    const session = this.sessions.cachedSession?.(ref);
    const question =
      extractToolQuestion(latest.data) ??
      questionFromPrompt(parseQuestion(latest.data, { sessionRef: ref }));
    const momentContext = buildMomentContext({
      messages,
      session,
      question,
      ...(originalRequest
        ? { originalRequest: messageText(originalRequest) }
        : {}),
      ...(latestRequest ? { latestRequest: messageText(latestRequest) } : {}),
    });
    const context = buildMomentPrompt(momentContext);

    const digest = createHash("sha256")
      .update(context)
      .digest("hex")
      .slice(0, 16);
    const cacheKey = `${ref}:${mode}:${config.reply.baseUrl}:${config.reply.model}:${digest}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached.value;
    }

    if (mode === "choices") {
      const generation = await this.choices(messages, config, question);
      const value: ReplyOptions = {
        data: generation.options,
        generatedAt: Date.now(),
        mode,
        ...(config.reply.enabled ? { model: config.reply.model } : {}),
      };
      this.cache.set(cacheKey, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      this.trimCache();
      return value;
    }

    const moment = momentContext.moment;
    const canned = cannedOptions();
    const base: ReplyOptions = {
      data: canned,
      generatedAt: Date.now(),
      mode,
      ...(config.reply.enabled ? { model: config.reply.model } : {}),
      state: moment.state,
      kind: moment.kind,
      ...(moment.pending ? { pending: moment.pending } : {}),
      confidence: moment.confidence,
    };

    if (moment.state !== "reply" || !replyModelReady(config)) {
      const value = base;
      this.cache.set(cacheKey, {
        value,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      this.trimCache();
      return value;
    }

    const generation = await this.modelRoles(context, config);
    const linted = buildRoleOptions(
      generation.roles,
      moment,
      context,
    );
    if (linted.options.length === 0) {
      return {
        ...base,
        confidence: "low",
      };
    }
    const value: ReplyOptions = {
      ...base,
      data: [
        ...canned.slice(0, 1),
        ...linted.options,
        ...canned.slice(1),
      ],
      confidence: linted.confidence,
    };
    this.cache.set(cacheKey, {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    this.trimCache();
    return value;
  }

  /**
   * Generate a fresh reply set for inspection. Unlike `list`, this bypasses
   * the cache and returns the moment, prompt, context, raw output, and lint
   * decisions.
   */
  async audit(ref: string, mode: ReplyMode): Promise<ReplyAudit> {
    const started = Date.now();
    const { latest, messages, originalRequest, latestRequest } =
      await this.loadContext(ref);
    const config = this.settings.config();
    const session = this.sessions.cachedSession?.(ref);
    const question =
      extractToolQuestion(latest.data) ??
      questionFromPrompt(parseQuestion(latest.data, { sessionRef: ref }));
    const momentContext = buildMomentContext({
      messages,
      session,
      question,
      ...(originalRequest
        ? { originalRequest: messageText(originalRequest) }
        : {}),
      ...(latestRequest ? { latestRequest: messageText(latestRequest) } : {}),
    });
    const context = buildMomentPrompt(momentContext);
    const moment = momentContext.moment;
    const systemPrompt =
      mode === "reply" ? REPLY_SYSTEM_PROMPT : CHOICE_SYSTEM_PROMPT;
    const modelStarted = Date.now();

    if (mode === "choices") {
      const generation = await this.choices(messages, config, question);
      return {
        sessionRef: ref,
        ...(session?.title ? { sessionTitle: session.title } : {}),
        ...(session?.status ? { sessionStatus: session.status } : {}),
        mode,
        ...(config.reply.enabled && config.reply.model
          ? { model: config.reply.model }
          : {}),
        generatedAt: Date.now(),
        durationMs: Date.now() - started,
        modelMs: Date.now() - modelStarted,
        systemPrompt,
        context,
        moment,
        rejected: [],
        ...(question ? { question } : {}),
        options: generation.options,
        raw: generation.raw,
        reasoning: generation.reasoning,
        ...(generation.finishReason
          ? { finishReason: generation.finishReason }
          : {}),
      };
    }

    const canned = cannedOptions();
    if (moment.state !== "reply" || !replyModelReady(config)) {
      return {
        sessionRef: ref,
        ...(session?.title ? { sessionTitle: session.title } : {}),
        ...(session?.status ? { sessionStatus: session.status } : {}),
        mode,
        ...(config.reply.enabled && config.reply.model
          ? { model: config.reply.model }
          : {}),
        generatedAt: Date.now(),
        durationMs: Date.now() - started,
        modelMs: 0,
        systemPrompt,
        context,
        moment,
        rejected: [],
        ...(question ? { question } : {}),
        options: canned,
        raw: "",
        reasoning: "",
      };
    }

    const generation = await this.modelRoles(context, config);
    const linted = buildRoleOptions(generation.roles, moment, context);
    const options =
      linted.options.length > 0
        ? [...canned.slice(0, 1), ...linted.options, ...canned.slice(1)]
        : canned;
    return {
      sessionRef: ref,
      ...(session?.title ? { sessionTitle: session.title } : {}),
      ...(session?.status ? { sessionStatus: session.status } : {}),
      mode,
      ...(config.reply.enabled && config.reply.model
        ? { model: config.reply.model }
        : {}),
      generatedAt: Date.now(),
      durationMs: Date.now() - started,
      modelMs: Date.now() - modelStarted,
      systemPrompt,
      context,
      moment: {
        ...moment,
        confidence:
          linted.options.length > 0 ? linted.confidence : "low",
      },
      rejected: linted.rejected,
      ...(question ? { question } : {}),
      options,
      raw: generation.raw,
      reasoning: generation.reasoning,
      ...(generation.finishReason
        ? { finishReason: generation.finishReason }
        : {}),
    };
  }

  private async modelRoles(
    context: string,
    config: AssistantConfig,
  ): Promise<{
    roles: RoleTexts;
    raw: string;
    reasoning: string;
    finishReason?: string;
  }> {
    try {
      const result = await this.completion(
        config,
        [
          { role: "system", content: REPLY_SYSTEM_PROMPT },
          { role: "user", content: context },
        ],
        { maxTokens: 320, schema: REPLY_SCHEMA },
      );
      const roles = parseRoles(result.content);
      if (!roles.answer && !roles.opposite && !roles.ask) {
        this.logger.warn("Reply role generation returned no usable text");
      }
      return {
        roles,
        raw: result.content,
        reasoning: result.reasoning,
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      };
    } catch (error) {
      this.logger.warn("Reply role generation failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        roles: { answer: "", opposite: "", ask: "" },
        raw: "",
        reasoning: "",
      };
    }
  }

  private async choices(
    messages: Message[],
    config: AssistantConfig,
    question: ReplyAuditQuestion | undefined,
  ): Promise<ChoiceGeneration> {
    const lastAssistant = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.streaming !== true &&
          messageText(message).length > 0,
      );
    const assistantText = lastAssistant
      ? messageText(lastAssistant).slice(0, 4_000)
      : "";

    let raw = "";
    let reasoning = "";
    let finishReason: string | undefined;
    const items: Array<{ text: string; source: "agent" | "model" }> = [];

    if (question) {
      for (const choice of question.choices) {
        const text = choice.label.trim();
        if (text) items.push({ text, source: "agent" });
      }
    } else {
      const hasCue = hasChoiceCue(assistantText);
      if (hasCue && assistantText) {
        items.push(
          ...parseChoices(assistantText).map((text) => ({
            text,
            source: "agent" as const,
          })),
        );
      }
      if (items.length < 2 && hasCue && replyModelReady(config)) {
        try {
          const result = await this.modelChoices(assistantText, config);
          raw = result.raw;
          reasoning = result.reasoning;
          finishReason = result.finishReason;
          const extracted = result.choices
            .filter((choice) => appearsInText(choice, assistantText))
            .map((text) => ({ text, source: "model" as const }));
          items.push(...extracted);
        } catch (error) {
          this.logger.warn("Reply choice extraction failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const seen = new Set<string>();
    const options = items
      .filter((item) => {
        const key = comparisonKey(item.text);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_CHOICES)
      .map((item, index) => ({
        id: `choice-${index}`,
        label: truncateLabel(item.text),
        text: item.text,
        source: item.source,
        action: "send" as const,
      }));
    return {
      options,
      raw,
      reasoning,
      ...(finishReason ? { finishReason } : {}),
    };
  }

  private async modelChoices(
    assistantText: string,
    config: AssistantConfig,
  ): Promise<{
    choices: string[];
    raw: string;
    reasoning: string;
    finishReason?: string;
  }> {
    const result = await this.completion(
      config,
      [
        { role: "system", content: CHOICE_SYSTEM_PROMPT },
        { role: "user", content: assistantText },
      ],
      { maxTokens: 600, schema: CHOICE_SCHEMA },
    );
    return {
      choices: normalizeSuggestions(result.content).slice(0, MAX_CHOICES),
      raw: result.content,
      reasoning: result.reasoning,
      ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    };
  }

  private async completion(
    config: AssistantConfig,
    messages: Array<{ role: "system" | "user"; content: string }>,
    options: {
      maxTokens: number;
      schema?: Record<string, unknown>;
      temperature?: number;
    },
  ): Promise<CompletionResult> {
    const body: Record<string, unknown> = {
      model: config.reply.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens,
      stream: false,
      ...(config.reply.disableThinking
        ? { chat_template_kwargs: { enable_thinking: false } }
        : {}),
    };
    const structured = options.schema
      ? {
          ...body,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "reply_payload",
              strict: true,
              schema: options.schema,
            },
          },
        }
      : body;

    let response = await this.post(config, structured);
    if (
      !response.ok &&
      options.schema &&
      (response.status === 400 || response.status === 422)
    ) {
      response = await this.post(config, body);
    }
    if (!response.ok) {
      throw new Error(`Reply model returned HTTP ${response.status}`);
    }
    const payload = await response.json();
    return {
      content: messageContent(payload),
      reasoning: messageReasoning(payload),
      ...messageFinishReason(payload),
    };
  }

  private post(
    config: AssistantConfig,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${trimSlash(config.reply.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(config.reply.apiKey
          ? { Authorization: `Bearer ${config.reply.apiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.reply.timeoutMs),
    });
  }

  private trimCache(): void {
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}

function replyModelReady(config: AssistantConfig): boolean {
  return (
    config.reply.enabled &&
    config.reply.baseUrl.trim().length > 0 &&
    config.reply.model.trim().length > 0
  );
}

function cannedOptions(): ReplyOption[] {
  return [
    {
      id: "continue",
      label: "Continue",
      text: "Continue.",
      source: "canned",
      action: "send",
    },
    {
      id: "alternatives",
      label: "Show alternatives",
      text: "Do not proceed yet. Propose 2-3 concrete alternatives, each in eight words or fewer, as a numbered list.",
      source: "canned",
      action: "send",
    },
    {
      id: "explain",
      label: "Explain risk",
      text: "Explain the main risk and the safest next step in a few short bullet points.",
      source: "canned",
      action: "send",
    },
    {
      id: "stop",
      label: "Stop",
      text: "",
      source: "canned",
      action: "interrupt",
    },
    {
      id: "choices",
      label: "Find choices",
      text: "",
      source: "canned",
      action: "choices",
    },
    {
      id: "phone",
      label: "Phone keyboard",
      text: "",
      source: "canned",
      action: "phone",
    },
  ];
}

function messageText(message: Message): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function reasoningText(message: Message): string {
  return message.parts
    .filter((part) => part.type === "reasoning")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function lastUserMessage(messages: Message[]): Message | undefined {
  return messages.find(
    (message) => message.role === "user" && messageText(message).length > 0,
  );
}

function firstUserMessage(messages: Message[]): Message | undefined {
  return messages.find(
    (message) => message.role === "user" && messageText(message).length > 0,
  );
}

function latestAssistantWithText(messages: Message[]): Message | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" && messageText(message).length > 0,
    );
}

function hasRunningTool(message: Message | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  return message.parts.some(
    (part) =>
      part.type === "tool" &&
      (part.status === "running" || part.status === "pending"),
  );
}

function buildMomentContext(input: {
  messages: Message[];
  session?: Session;
  question?: ReplyAuditQuestion;
  originalRequest?: string;
  latestRequest?: string;
}): MomentContext {
  const { messages, session, question } = input;
  const assistant = latestAssistantWithText(messages);
  const lastAssistantText = assistant ? messageText(assistant) : "";
  const lastAssistantTail =
    lastAssistantText.length > 0
      ? headTail(lastAssistantText)
      : latestReasoningTail(messages);
  const userTexts = messages
    .filter((message) => message.role === "user")
    .map(messageText)
    .filter(Boolean);
  const userGoal = compactRequest(
    input.originalRequest ?? userTexts[0] ?? "",
  );
  const lastUser = compactRequest(
    input.latestRequest ?? userTexts.at(-1) ?? "",
  );
  const latestMessage = messages.at(-1);
  const running =
    session?.status === "running" ||
    latestMessage?.streaming === true ||
    hasRunningTool(latestMessage);
  const sanitized = sanitizeGateText(lastAssistantText);
  const sentences = splitSentences(sanitized);
  const firstSentence = sentences[0] ?? "";
  const lastSentence = sentences.at(-1) ?? "";
  const askText = sentences.slice(-2).join(" ");
  const recentText = sentences.slice(-4).join(" ");
  const deliveredHeadline =
    /^(done|delivered|committed|merged|published|fixed|installed|verified)\b/i.test(
      sanitized.trim(),
    );
  const pendingFromText = extractAsk(askText);
  const actionNeeded =
    ACTION_NEEDED.test(recentText) && !COURTESY.test(recentText.slice(-160));
  const failure =
    (FAILURE.test(firstSentence) || FAILURE.test(lastSentence)) &&
    !deliveredHeadline;
  const delivered =
    deliveredHeadline ||
    DELIVERED.test(lastSentence) ||
    DELIVERED.test(recentText);
  const offer = ASK_OFFER.test(recentText);
  const challenge =
    lastUser.length > 0 &&
    /\?\s*$/.test(lastUser) &&
    /\b(but|why|however|disagree|wrong|not sure|concern)\b/i.test(lastUser);
  const directCorrection =
    lastUser.length > 0 &&
    /\?/.test(lastUser) &&
    /^(?:short answer:\s*)?(?:no\s*[—–:,.!-]|nope\b|not quite\b|actually\b|that'?s not\b|it isn'?t\b|it wasn'?t\b)/i.test(
      sanitized.trim(),
    );
  const actionSentence = extractActionSentence(recentText);
  const approval = isApprovalText(
    question?.text ?? pendingFromText ?? actionSentence ?? lastSentence,
  );

  let state: ReplyState;
  let kind: ReplyMomentKind;
  if (question) {
    state = "reply";
    kind = approval ? "approval" : "question";
  } else if (running) {
    state = "wait";
    kind = "running";
  } else if (pendingFromText) {
    state = "reply";
    kind = approval ? "approval" : "question";
  } else if (actionNeeded) {
    state = "reply";
    kind = approval ? "approval" : "delivery";
  } else if (failure && !directCorrection) {
    state = "reply";
    kind = /blocked/i.test(lastAssistantText) ? "blocker" : "failure";
  } else if (challenge || directCorrection) {
    state = "reply";
    kind = "challenge";
  } else if (delivered && offer) {
    state = "reply";
    kind = "delivery";
  } else if (delivered) {
    state = "done";
    kind = "delivery";
  } else {
    state = "done";
    kind = "none";
  }

  const pending =
    question?.text ??
    (state === "reply"
      ? (pendingFromText ?? actionSentence)
      : undefined);
  const done = extractDone(lastAssistantText);
  const constraints = extractConstraints([
    ...userTexts,
    ...(input.originalRequest ? [input.originalRequest] : []),
    ...(input.latestRequest ? [input.latestRequest] : []),
  ]);
  const confidence: ReplyConfidence =
    state === "reply" && !question && !failure && !actionNeeded
      ? "medium"
      : "high";
  const evidence = buildEvidence(messages);
  const moment: ReplyMoment = {
    state,
    kind,
    ...(pending ? { pending: clip(pending, MAX_PENDING_CHARS) } : {}),
    choices: (question?.choices ?? []).map((choice) => choice.label),
    done,
    constraints,
    confidence,
  };
  return {
    moment,
    ...(question ? { question } : {}),
    userGoal: clip(userGoal, MAX_REQUEST_CHARS),
    lastUser: clip(lastUser, MAX_REQUEST_CHARS),
    lastAssistantTail,
    evidence,
  };
}

function buildMomentPrompt(context: MomentContext): string {
  const moment = context.moment;
  const lines = [
    "moment:",
    `  state: ${moment.state}`,
    `  kind: ${moment.kind}`,
    ...(moment.pending ? [`  pending: ${moment.pending}`] : []),
    ...(moment.choices.length > 0
      ? [`  choices: ${JSON.stringify(moment.choices)}`]
      : []),
    ...(moment.done.length > 0
      ? ["  done:", ...moment.done.map((item) => `    - ${item}`)]
      : []),
    ...(moment.constraints.length > 0
      ? ["  constraints:", ...moment.constraints.map((item) => `    - ${item}`)]
      : []),
    `  user_goal: ${context.userGoal || "(unknown)"}`,
    `  last_user: ${context.lastUser || "(none)"}`,
    `  last_assistant_tail: ${context.lastAssistantTail || "(none)"}`,
  ];
  if (context.evidence) {
    lines.push("  evidence:", context.evidence);
  }
  return lines.join("\n");
}

function buildEvidence(messages: Message[]): string {
  const textMessages = messages.filter(
    (message) => messageText(message).length > 0,
  );
  const prior = textMessages.slice(0, -1).slice(-MAX_EVIDENCE_MESSAGES);
  return prior
    .map(
      (message) =>
        `    ${message.role}: ${clip(
          messageText(message),
          MAX_EVIDENCE_CHARS,
        )}`,
    )
    .join("\n");
}

function latestReasoningTail(messages: Message[]): string {
  const assistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  if (!assistant) return "";
  const reasoning = reasoningText(assistant);
  return reasoning ? `agent thinking: ${clip(reasoning, 500)}` : "";
}

function sanitizeGateText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/^\s*\|.*$/gm, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/"[^"]{0,200}"/g, " ")
    .replace(/“[^”]{0,200}”/g, " ")
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAsk(text: string): string | undefined {
  const sentences = splitSentences(text);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]!.trim();
    if (!sentence || COURTESY.test(sentence)) continue;
    if (/\?\s*$/.test(sentence)) return clip(sentence, MAX_PENDING_CHARS);
    if (ASK_OFFER.test(sentence)) return clip(sentence, MAX_PENDING_CHARS);
  }
  return undefined;
}

function extractActionSentence(text: string): string | undefined {
  const sentences = splitSentences(text);
  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const sentence = sentences[index]!.trim();
    if (sentence && ACTION_NEEDED.test(sentence)) {
      return clip(sentence, MAX_PENDING_CHARS);
    }
  }
  return undefined;
}

function isApprovalText(text: string): boolean {
  return APPROVAL.test(text);
}

function extractDone(text: string): string[] {
  const prose = text.replace(/```[\s\S]*?```/g, " ");
  const lines = prose
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-*]\s+/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .filter(
      (line) =>
        line.length >= 4 &&
        line.length <= MAX_DONE_CHARS &&
        !/^[#$]/.test(line),
    );
  const result: string[] = [];
  for (const line of lines) {
    if (DONE_START.test(line)) result.push(clip(line, MAX_DONE_CHARS));
    if (result.length >= 3) break;
  }
  if (result.length === 0) {
    for (const sentence of splitSentences(prose)) {
      const clean = sentence.trim();
      if (clean.length < 4 || clean.length > MAX_DONE_CHARS) continue;
      if (DONE_START.test(clean)) result.push(clip(clean, MAX_DONE_CHARS));
      if (result.length >= 3) break;
    }
  }
  return unique(result).slice(0, 3);
}

function extractConstraints(texts: string[]): string[] {
  const sentences = texts.flatMap((text) =>
    text.split("\n").flatMap((line) => splitSentences(line)),
  );
  const result: string[] = [];
  for (const sentence of sentences) {
    const clean = sentence.replace(/\s+/g, " ").trim();
    if (!clean || clean.length > MAX_CONSTRAINT_CHARS) continue;
    if (CONSTRAINT_WORD.test(clean)) {
      result.push(clean);
    }
    if (result.length >= 3) break;
  }
  return unique(result).slice(0, 3);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function headTail(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const max = MAX_MOMENT_HEAD_CHARS + MAX_MOMENT_TAIL_CHARS;
  if (clean.length <= max) return clean;
  const head = cutWords(clean.slice(0, MAX_MOMENT_HEAD_CHARS), "end");
  const tail = cutWords(clean.slice(-MAX_MOMENT_TAIL_CHARS), "start");
  return `${head}…${tail}`;
}

function cutWords(value: string, side: "start" | "end"): string {
  if (side === "end") {
    const space = value.lastIndexOf(" ");
    return space > 0 ? value.slice(0, space).trim() : value.trim();
  }
  const space = value.indexOf(" ");
  return space >= 0 ? value.slice(space + 1).trim() : value.trim();
}

function parseRoles(raw: string): RoleTexts {
  const parsed = parseJsonValue(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { answer: "", opposite: "", ask: "" };
  }
  const record = parsed as Record<string, unknown>;
  return {
    answer:
      typeof record.answer === "string" ? cleanSuggestion(record.answer) : "",
    opposite:
      typeof record.opposite === "string"
        ? cleanSuggestion(record.opposite)
        : "",
    ask: typeof record.ask === "string" ? cleanSuggestion(record.ask) : "",
  };
}

function buildRoleOptions(
  roles: RoleTexts,
  moment: ReplyMoment,
  grounding: string,
): {
  options: ReplyOption[];
  rejected: ReplyRejected[];
  confidence: ReplyConfidence;
} {
  const candidates: Array<{ role: ReplyRole; text: string }> = [
    { role: "answer", text: roles.answer },
    { role: "opposite", text: roles.opposite },
    { role: "ask", text: roles.ask },
  ];
  const rejected: ReplyRejected[] = [];
  const accepted: Array<{ role: ReplyRole; text: string }> = [];

  for (const candidate of candidates) {
    if (!candidate.text.trim()) {
      if (candidate.role !== "ask") {
        rejected.push({ ...candidate, reason: "empty" });
      }
      continue;
    }
    const reason = lintSuggestion(
      candidate.role,
      candidate.text,
      moment,
      grounding,
    );
    if (reason) {
      rejected.push({ ...candidate, reason });
      continue;
    }
    if (
      candidate.role === "opposite" &&
      accepted.some(
        (item) =>
          item.role === "answer" && similarText(item.text, candidate.text),
      )
    ) {
      rejected.push({ ...candidate, reason: "duplicate" });
      continue;
    }
    if (
      candidate.role === "ask" &&
      !/\bor\b/i.test(candidate.text) &&
      accepted.some((item) => similarText(item.text, candidate.text))
    ) {
      rejected.push({ ...candidate, reason: "duplicate" });
      continue;
    }
    accepted.push(candidate);
  }

  const answer = accepted.find((item) => item.role === "answer");
  if (!answer) {
    return { options: [], rejected, confidence: "low" };
  }
  const options = accepted.map((item) => ({
    id: `model-${item.role}`,
    label:
      item.role === "opposite"
        ? `Alt: ${truncateLabel(item.text)}`
        : item.role === "ask"
          ? `Ask: ${truncateLabel(item.text)}`
          : truncateLabel(item.text),
    text: item.text,
    source: "model" as const,
    action: "send" as const,
    role: item.role,
  }));
  return {
    options,
    rejected,
    confidence: options.some((option) => option.role === "opposite")
      ? "high"
      : "medium",
  };
}

function lintSuggestion(
  role: ReplyRole,
  raw: string,
  moment: ReplyMoment,
  grounding: string,
): string | undefined {
  const text = raw.trim();
  if (!text) return role === "ask" ? undefined : "empty";
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < MIN_ROLE_WORDS || words > MAX_ROLE_WORDS) return "length";
  if (text.length > MAX_SUGGESTION_CHARS) return "too long";
  if (META_TEXT.test(text)) return "meta";
  if (UNSAFE_TEXT.test(text) || UNSAFE_TEXT_ALT.test(text)) return "unsafe";
  if (violatesConstraints(text, moment.constraints)) return "constraint";
  if (isStale(text, moment.done)) return "stale";
  if (role === "ask" && !/\?\s*$/.test(text)) return "not a question";
  if (GENERIC.test(text)) return "generic";
  if (!hasGroundedEntity(text, grounding)) return "ungrounded";
  return undefined;
}

function violatesConstraints(
  text: string,
  constraints: string[],
): boolean {
  const tokens = tokenSet(text);
  const negative = constraints.filter((constraint) =>
    /\b(do not|don't|never|without|must not|should not)\b/i.test(constraint),
  );
  for (const constraint of negative) {
    const constraintTokens = tokenSet(constraint);
    if (constraintTokens.size === 0) continue;
    let overlap = 0;
    for (const token of constraintTokens) {
      if (tokens.has(token)) overlap += 1;
    }
    if (
      constraintTokens.size <= 5 ? overlap >= 1 : overlap >= 2
    ) {
      return true;
    }
  }
  return false;
}

function isStale(text: string, done: string[]): boolean {
  if (done.length === 0) return false;
  const action =
    /^(build|merge|commit|verify|confirm|proceed|create|run|ship|check|install|update|deploy|fix|start|continue|work)\b/i;
  if (!action.test(text)) return false;
  const tokens = tokenSet(text);
  return done.some((item) => {
    const doneTokens = tokenSet(item);
    if (doneTokens.size === 0) return false;
    let overlap = 0;
    for (const token of doneTokens) {
      if (tokens.has(token)) overlap += 1;
    }
    return overlap / Math.min(tokens.size, doneTokens.size) >= 0.5;
  });
}

function hasGroundedEntity(text: string, grounding: string): boolean {
  const source = tokenSet(
    `${grounding} ${extractNumbers(grounding)} ${extractTicks(grounding)}`,
  );
  if (source.size === 0) return true;
  const tokens = tokenSet(`${text} ${extractNumbers(text)} ${extractTicks(text)}`);
  for (const token of tokens) {
    if (source.has(token)) return true;
  }
  return false;
}

function extractNumbers(text: string): string {
  return (text.match(/\b\d+(?:\.\d+)*\b/g) ?? []).join(" ");
}

function extractTicks(text: string): string {
  return (text.match(/`([^`]+)`/g) ?? []).join(" ");
}

function tokenSet(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[._/-]+|[._/-]+$/g, ""))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
  return new Set(tokens);
}

function similarText(left: string, right: string): boolean {
  const leftKey = comparisonKey(left);
  const rightKey = comparisonKey(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  const leftTokens = tokenSet(leftKey);
  const rightTokens = tokenSet(rightKey);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.6;
}

function comparisonKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function hasChoiceCue(text: string): boolean {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  if (/\?(?:\s|$)/.test(prose)) return true;
  return /^\s*(?:options?|choices?|choose|pick|select)\b/im.test(prose);
}

function parseChoices(text: string): string[] {
  const choices: string[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/);
    if (!match?.[1]) continue;
    const choice = match[1]
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (choice.length > 0 && choice.length <= 100) choices.push(choice);
  }
  return [...new Set(choices)];
}

function appearsInText(choice: string, text: string): boolean {
  const clean = comparisonKey(choice);
  if (!clean) return false;
  const haystack = text.toLowerCase().replace(/\s+/g, " ");
  const exact = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(clean)}([^a-z0-9]|$)`,
  );
  if (exact.test(haystack)) return true;
  const prefix = clean.slice(0, Math.min(24, clean.length));
  return prefix.length >= 6 && haystack.includes(prefix);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSuggestions(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let candidates: string[] = [];
  const parsed = parseJsonValue(trimmed);
  if (Array.isArray(parsed)) {
    candidates = parsed.filter(
      (item): item is string => typeof item === "string",
    );
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["choices", "replies", "options", "suggestions", "follow_ups"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        candidates = value.filter(
          (item): item is string => typeof item === "string",
        );
        break;
      }
    }
  }
  if (candidates.length === 0) {
    candidates = trimmed
      .replace(/```(?:json)?/gi, "")
      .replace(/```/g, "")
      .split("\n");
  }

  return [
    ...new Set(
      candidates
        .map(cleanSuggestion)
        .filter(
          (item) =>
            item.length > 0 &&
            item.length <= 100 &&
            !item.toLowerCase().startsWith("here are"),
        ),
    ),
  ];
}

function cleanSuggestion(item: string): string {
  return item
    .replace(/^\s*(?:[-*]|\d+[.)])\s*/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonValue(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

function questionFromPrompt(
  prompt: QuestionPrompt | null,
): ReplyAuditQuestion | undefined {
  const first = prompt?.questions[0];
  if (!first) return undefined;
  return {
    text: first.text,
    choices: first.choices.map((choice) => ({
      label: choice.label,
      ...(choice.text && choice.text !== choice.label
        ? { description: choice.text }
        : {}),
    })),
  };
}

function compactRequest(text: string): string {
  let trimmed = text.trim();
  const isSubagent = /^You are a subagent spawned by another session\./i.test(
    trimmed,
  );
  if (isSubagent) {
    trimmed = trimmed.replace(
      /^You are a subagent spawned by another session\.\s*/i,
      "",
    );
  }
  const isWorkIn = /^Work in\s+\S+/i.test(trimmed);

  const scrubPaths = (value: string): string =>
    value.replace(
      /`?(?:~\/|\/(?:home|root|tmp|opt|var|usr)\/)[^\s`]+`?/g,
      "<path>",
    );

  if (!isSubagent && !isWorkIn) {
    return scrubPaths(trimmed).replace(/\s+/g, " ").trim();
  }

  let body = trimmed.replace(/^Work in\s+\S+\s*/i, "");
  body = scrubPaths(body);
  const lines = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^context\b/i.test(line) && !/^[-*]\s/.test(line));
  body = lines.slice(0, 2).join(" ");

  const sentences = splitSentences(body);
  const kept = sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[a-z]/i.test(sentence))
    .filter((sentence) => !/^<path>\.?$/i.test(sentence))
    .filter(
      (sentence) =>
        !/^(?:Do NOT|Only|Deliverable|Context|CONTEXT|Keep|md\b)/i.test(
          sentence,
        ),
    );
  body = kept.slice(0, 3).join(" ").replace(/\s+/g, " ").trim();
  return body || scrubPaths(trimmed);
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const headBudget = Math.ceil(max * 0.6);
  const tailBudget = Math.max(0, max - headBudget - 1);
  const headRaw = clean.slice(0, headBudget);
  const tailRaw = tailBudget > 0 ? clean.slice(-tailBudget) : "";
  const headSpace = headRaw.lastIndexOf(" ");
  const head = headSpace > 0 ? headRaw.slice(0, headSpace) : headRaw;
  const tailSpace = tailRaw.indexOf(" ");
  const tail = tailSpace >= 0 ? tailRaw.slice(tailSpace + 1) : tailRaw;
  return `${head}…${tail}`;
}

function truncateLabel(text: string): string {
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function messageContent(payload: unknown): string {
  const content = (
    payload as {
      choices?: Array<{ message?: { content?: unknown } }>;
    }
  ).choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

function messageReasoning(payload: unknown): string {
  const message = (
    payload as {
      choices?: Array<{
        message?: { reasoning_content?: unknown; reasoning?: unknown };
      }>;
    }
  ).choices?.[0]?.message;
  if (typeof message?.reasoning_content === "string") {
    return message.reasoning_content;
  }
  return typeof message?.reasoning === "string" ? message.reasoning : "";
}

function messageFinishReason(payload: unknown): { finishReason?: string } {
  const finishReason = (
    payload as { choices?: Array<{ finish_reason?: unknown }> }
  ).choices?.[0]?.finish_reason;
  return typeof finishReason === "string" && finishReason.length > 0
    ? { finishReason }
    : {};
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
