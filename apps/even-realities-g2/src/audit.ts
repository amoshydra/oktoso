import "@fontsource-variable/inter/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "./audit.css";
import type {
  ReplyAudit,
  ReplyFeedbackEntry,
  ReplyFeedbackInput,
  ReplyFeedbackVerdict,
  ReplyMode,
  Session,
} from "@amoshydra/oktoso-contracts";
import { HubClient, HubError } from "@amoshydra/oktoso-client";

const TOKEN_KEY = "oktoso-audit-token";
const LEGACY_TOKEN_KEYS = ["oktoso-token", "oktoso-even-g2-token"];

const authPanel = byId("auth-panel");
const tokenInput = byId<HTMLInputElement>("token");
const connectButton = byId<HTMLButtonElement>("connect");
const authStatus = byId("auth-status");
const workbench = byId("workbench");
const historyPanel = byId("history-panel");
const sessionSelect = byId<HTMLSelectElement>("session");
const modeSelect = byId<HTMLSelectElement>("mode");
const reloadSessionsButton = byId<HTMLButtonElement>("reload-sessions");
const generateButton = byId<HTMLButtonElement>("generate");
const generateStatus = byId("generate-status");
const auditPanel = byId("audit");
const auditMeta = byId("audit-meta");
const systemPrompt = byId("system-prompt");
const contextOutput = byId("context");
const rawOutput = byId("raw");
const reasoningOutput = byId("reasoning");
const questionPanel = byId("question-panel");
const questionDetail = byId("question-detail");
const momentPanel = byId("moment-panel");
const momentDetail = byId("moment-detail");
const rejectedPanel = byId("rejected-panel");
const rejectedDetail = byId("rejected-detail");
const optionsList = byId("options");
const overallGroup = byId("overall");
const tagsFieldset = byId("tags");
const noteInput = byId<HTMLTextAreaElement>("note");
const saveButton = byId<HTMLButtonElement>("save");
const saveStatus = byId("save-status");
const historyList = byId("history");
const historyStatus = byId("history-status");
const exportButton = byId<HTMLButtonElement>("export");

let client: HubClient | undefined;
let token = "";
let sessions: Session[] = [];
let currentAudit: ReplyAudit | undefined;
let overall: ReplyFeedbackVerdict | undefined;
const ratings = new Map<string, ReplyFeedbackVerdict>();

connectButton.addEventListener("click", () => {
  void connect(tokenInput.value.trim());
});
tokenInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void connect(tokenInput.value.trim());
});
reloadSessionsButton.addEventListener("click", () => {
  void loadSessions();
});
generateButton.addEventListener("click", () => {
  void generate();
});
saveButton.addEventListener("click", () => {
  void saveFeedback();
});
exportButton.addEventListener("click", () => {
  void exportFeedback();
});
overallGroup.querySelectorAll<HTMLButtonElement>("[data-verdict]").forEach((button) => {
  button.addEventListener("click", () => {
    overall = button.dataset.verdict as ReplyFeedbackVerdict;
    syncVerdicts();
  });
});

void boot();

async function boot(): Promise<void> {
  const stored = storedToken();
  tokenInput.value = stored;
  if (!stored) {
    authStatus.textContent =
      "Paste the hub token, or pair the G2 phone surface first.";
    return;
  }
  await connect(stored).catch(() => {
    authStatus.textContent = "That token was rejected. Paste a valid token.";
  });
}

async function connect(candidate: string): Promise<void> {
  connectButton.disabled = true;
  authStatus.textContent = "Connecting…";
  try {
    const hub = new HubClient({
      baseUrl: "",
      token: candidate || undefined,
    });
    await hub.authCheck();
    client = hub;
    token = candidate;
    if (candidate) localStorage.setItem(TOKEN_KEY, candidate);
    authPanel.hidden = true;
    workbench.hidden = false;
    historyPanel.hidden = false;
    authStatus.textContent = "";
    await Promise.all([loadSessions(), loadHistory()]);
  } catch (error) {
    authStatus.textContent = describe(error);
    authStatus.classList.add("error");
  } finally {
    connectButton.disabled = false;
  }
}

function storedToken(): string {
  const direct = localStorage.getItem(TOKEN_KEY);
  if (direct) return direct;
  for (const key of LEGACY_TOKEN_KEYS) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return "";
}

async function loadSessions(): Promise<void> {
  if (!client) return;
  const selected = sessionSelect.value;
  generateStatus.textContent = "Loading sessions…";
  generateStatus.classList.remove("error");
  try {
    const page = await client.sessions({ limit: 50, scope: "all" });
    sessions = page.data;
    renderSessionOptions(selected);
    generateStatus.textContent = `${sessions.length} sessions available`;
  } catch (error) {
    generateStatus.textContent = describe(error);
    generateStatus.classList.add("error");
  }
}

function renderSessionOptions(selected: string): void {
  sessionSelect.replaceChildren();
  const groups = new Map<string, Session[]>();
  for (const session of sessions) {
    const items = groups.get(session.providerID) ?? [];
    items.push(session);
    groups.set(session.providerID, items);
  }
  for (const [provider, items] of groups) {
    const group = document.createElement("optgroup");
    group.label = provider;
    for (const session of items) {
      const option = document.createElement("option");
      option.value = session.ref;
      option.textContent = `${session.parentRef ? "› " : ""}${session.title}${
        session.status === "running" ? " · running" : ""
      }`;
      group.append(option);
    }
    sessionSelect.append(group);
  }
  if (selected && sessions.some((session) => session.ref === selected)) {
    sessionSelect.value = selected;
  } else if (sessions[0]) {
    sessionSelect.value = sessions[0].ref;
  }
}

async function generate(): Promise<void> {
  if (!client) return;
  const ref = sessionSelect.value;
  const mode = modeSelect.value as ReplyMode;
  if (!ref) {
    generateStatus.textContent = "Choose a session first.";
    generateStatus.classList.add("error");
    return;
  }
  generateButton.disabled = true;
  generateStatus.textContent = "Generating…";
  generateStatus.classList.remove("error");
  try {
    currentAudit = await client.replyAudit(ref, mode);
    ratings.clear();
    overall = undefined;
    noteInput.value = "";
    tagsFieldset
      .querySelectorAll<HTMLInputElement>("input[type=checkbox]")
      .forEach((checkbox) => {
        checkbox.checked = false;
      });
    renderAudit(currentAudit);
    generateStatus.textContent = "Generated a fresh audit.";
  } catch (error) {
    generateStatus.textContent = describe(error);
    generateStatus.classList.add("error");
  } finally {
    generateButton.disabled = false;
  }
}

function renderAudit(audit: ReplyAudit): void {
  auditPanel.hidden = false;
  auditMeta.replaceChildren(
    metaItem("Session", audit.sessionTitle ?? audit.sessionRef),
    metaItem("Status", audit.sessionStatus ?? "unknown"),
    metaItem("Mode", audit.mode),
    metaItem("Model", audit.model ?? "not configured"),
    metaItem("Total", `${audit.durationMs} ms`),
    metaItem("Model time", `${audit.modelMs} ms`),
    metaItem("Finish", audit.finishReason ?? "—"),
    metaItem("Generated", formatDate(audit.generatedAt)),
  );
  systemPrompt.textContent = audit.systemPrompt;
  contextOutput.textContent = audit.context || "(no context)";
  rawOutput.textContent = audit.raw || "(no model output)";
  reasoningOutput.textContent = audit.reasoning || "(no reasoning output)";
  renderMoment(audit);
  renderRejected(audit.rejected);
  renderQuestion(audit.question);
  renderOptions(audit);
  syncVerdicts();
  saveStatus.textContent = "";
}

function renderMoment(audit: ReplyAudit): void {
  const moment = audit.moment;
  momentDetail.replaceChildren(
    momentRow("State", moment.state),
    momentRow("Kind", moment.kind),
    momentRow("Confidence", moment.confidence),
    ...(moment.pending ? [momentRow("Pending", moment.pending)] : []),
    ...(moment.choices.length > 0
      ? [momentRow("Choices", moment.choices.join("\n"))]
      : []),
    ...(moment.done.length > 0
      ? [momentRow("Done", moment.done.join("\n"))]
      : []),
    ...(moment.constraints.length > 0
      ? [momentRow("Constraints", moment.constraints.join("\n"))]
      : []),
  );
  momentPanel.hidden = false;
}

function momentRow(label: string, value: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "moment-row";
  const key = document.createElement("span");
  key.className = "moment-key";
  key.textContent = label;
  const content = document.createElement("span");
  content.className = "moment-value";
  content.textContent = value;
  row.append(key, content);
  return row;
}

function renderRejected(rejected: ReplyAudit["rejected"]): void {
  rejectedDetail.replaceChildren();
  if (rejected.length === 0) {
    rejectedPanel.hidden = true;
    return;
  }
  rejectedPanel.hidden = false;
  for (const item of rejected) {
    const row = document.createElement("div");
    row.className = "rejected-row";
    const head = document.createElement("div");
    head.className = "rejected-head";
    const role = document.createElement("span");
    role.className = "badge";
    role.textContent = item.role ?? "role";
    const reason = document.createElement("span");
    reason.textContent = item.reason;
    head.append(role, reason);
    const text = document.createElement("div");
    text.className = "rejected-text";
    text.textContent = item.text || "(empty)";
    row.append(head, text);
    rejectedDetail.append(row);
  }
}

function renderQuestion(question: ReplyAudit["question"]): void {
  questionDetail.replaceChildren();
  if (!question) {
    questionPanel.hidden = true;
    return;
  }
  questionPanel.hidden = false;

  if (question.header) {
    const header = document.createElement("div");
    header.className = "question-header";
    header.textContent = question.header;
    questionDetail.append(header);
  }

  const text = document.createElement("p");
  text.className = "question-text";
  text.textContent = question.text;
  questionDetail.append(text);

  for (const choice of question.choices) {
    const row = document.createElement("div");
    row.className = "question-choice";
    const label = document.createElement("div");
    label.className = "question-choice-label";
    label.textContent = choice.label;
    row.append(label);
    if (choice.description) {
      const description = document.createElement("div");
      description.className = "question-choice-description";
      description.textContent = choice.description;
      row.append(description);
    }
    questionDetail.append(row);
  }
}

function metaItem(label: string, value: string): HTMLElement {
  const item = document.createElement("span");
  item.append(`${label} `);
  const strong = document.createElement("strong");
  strong.textContent = value;
  item.append(strong);
  return item;
}

function renderOptions(audit: ReplyAudit): void {
  optionsList.replaceChildren();
  for (const option of audit.options) {
    const card = document.createElement("div");
    card.className = "option";

    const head = document.createElement("div");
    head.className = "option-head";
    const label = document.createElement("span");
    label.textContent = option.label;
    const badges = document.createElement("span");
    badges.className = "option-badges";
    if (option.role) {
      const role = document.createElement("span");
      role.className = "badge";
      role.textContent = option.role;
      badges.append(role);
    }
    const badge = document.createElement("span");
    badge.className = `badge ${option.source}`;
    badge.textContent = option.source;
    badges.append(badge);
    head.append(label, badges);

    const text = document.createElement("div");
    text.className = "option-text";
    text.textContent = option.text || option.label;

    const actions = document.createElement("div");
    actions.className = "option-actions";
    for (const [verdict, caption] of [
      ["useful", "Useful"],
      ["not_useful", "Not useful"],
      ["unsure", "Unsure"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.optionId = option.id;
      button.dataset.verdict = verdict;
      button.textContent = caption;
      button.addEventListener("click", () => {
        ratings.set(option.id, verdict);
        syncOptionRatings();
      });
      actions.append(button);
    }

    card.append(head, text, actions);
    optionsList.append(card);
  }
  syncOptionRatings();
}

function syncOptionRatings(): void {
  optionsList
    .querySelectorAll<HTMLButtonElement>("button[data-option-id]")
    .forEach((button) => {
      const id = button.dataset.optionId ?? "";
      button.setAttribute(
        "aria-pressed",
        String(ratings.get(id) === button.dataset.verdict),
      );
    });
}

function syncVerdicts(): void {
  overallGroup
    .querySelectorAll<HTMLButtonElement>("[data-verdict]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.verdict === overall),
      );
    });
}

async function saveFeedback(): Promise<void> {
  if (!client || !currentAudit) return;
  const tags = [
    ...tagsFieldset.querySelectorAll<HTMLInputElement>("input:checked"),
  ].map((checkbox) => checkbox.value);
  if (
    ratings.size === 0 &&
    !overall &&
    tags.length === 0 &&
    !noteInput.value.trim()
  ) {
    saveStatus.textContent = "Rate an option or add a note first.";
    saveStatus.classList.add("error");
    return;
  }
  const audit = currentAudit;
  const input: ReplyFeedbackInput = {
    sessionRef: audit.sessionRef,
    ...(audit.sessionTitle ? { sessionTitle: audit.sessionTitle } : {}),
    mode: audit.mode,
    ...(audit.model ? { model: audit.model } : {}),
    systemPrompt: audit.systemPrompt,
    context: audit.context,
    options: audit.options,
    ratings: [...ratings].map(([optionId, verdict]) => ({
      optionId,
      verdict,
    })),
    ...(overall ? { overall } : {}),
    tags,
    ...(noteInput.value.trim() ? { note: noteInput.value.trim() } : {}),
    ...(audit.raw ? { raw: audit.raw } : {}),
    ...(audit.reasoning ? { reasoning: audit.reasoning } : {}),
  };

  saveButton.disabled = true;
  saveStatus.textContent = "Saving…";
  saveStatus.classList.remove("error");
  try {
    await client.saveReplyFeedback(input);
    saveStatus.textContent = "Saved feedback.";
    ratings.clear();
    overall = undefined;
    syncOptionRatings();
    syncVerdicts();
    noteInput.value = "";
    tagsFieldset
      .querySelectorAll<HTMLInputElement>("input[type=checkbox]")
      .forEach((checkbox) => {
        checkbox.checked = false;
      });
    await loadHistory();
  } catch (error) {
    saveStatus.textContent = describe(error);
    saveStatus.classList.add("error");
  } finally {
    saveButton.disabled = false;
  }
}

async function loadHistory(): Promise<void> {
  if (!client) return;
  historyStatus.textContent = "Loading feedback…";
  historyStatus.classList.remove("error");
  try {
    const page = await client.replyFeedback(50);
    renderHistory(page.data);
    historyStatus.textContent = page.data.length
      ? `${page.data.length} recent entries`
      : "No feedback saved yet.";
  } catch (error) {
    historyStatus.textContent = describe(error);
    historyStatus.classList.add("error");
  }
}

function renderHistory(entries: ReplyFeedbackEntry[]): void {
  historyList.replaceChildren();
  for (const entry of entries) {
    const card = document.createElement("div");
    card.className = "entry";

    const head = document.createElement("div");
    head.className = "entry-head";
    const title = document.createElement("span");
    title.className = "entry-title";
    title.textContent = entry.sessionTitle ?? entry.sessionRef;
    const meta = document.createElement("span");
    meta.textContent = `${formatDate(entry.createdAt)} · ${entry.mode}${
      entry.overall ? ` · ${entry.overall}` : ""
    }`;
    head.append(title, meta);

    const counts = countVerdicts(entry);
    const summary = document.createElement("div");
    summary.className = "entry-head";
    const summaryText = document.createElement("span");
    summaryText.textContent = `Useful ${counts.useful} · Not useful ${counts.not_useful} · Unsure ${counts.unsure}`;
    summary.append(summaryText);

    card.append(head, summary);
    if (entry.tags?.length) {
      const tags = document.createElement("div");
      tags.className = "entry-tags";
      for (const tag of entry.tags) {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = tag;
        tags.append(badge);
      }
      card.append(tags);
    }
    if (entry.note) {
      const note = document.createElement("div");
      note.className = "entry-note";
      note.textContent = entry.note;
      card.append(note);
    }
    historyList.append(card);
  }
}

function countVerdicts(entry: ReplyFeedbackEntry): Record<
  ReplyFeedbackVerdict,
  number
> {
  const counts: Record<ReplyFeedbackVerdict, number> = {
    useful: 0,
    not_useful: 0,
    unsure: 0,
  };
  for (const rating of entry.ratings) counts[rating.verdict] += 1;
  return counts;
}

async function exportFeedback(): Promise<void> {
  historyStatus.textContent = "Exporting…";
  historyStatus.classList.remove("error");
  try {
    const headers: Record<string, string> = {
      Accept: "application/x-ndjson",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch("/api/v1/reply-feedback/export", {
      headers,
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Export failed: HTTP ${response.status}`);
    }
    const body = await response.text();
    const blob = new Blob([body], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reply-feedback-${fileStamp(Date.now())}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
    historyStatus.textContent = "Exported JSONL.";
  } catch (error) {
    historyStatus.textContent = describe(error);
    historyStatus.classList.add("error");
  }
}

function describe(error: unknown): string {
  if (error instanceof HubError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")} ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function fileStamp(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}${String(date.getDate()).padStart(2, "0")}-${String(
    date.getHours(),
  ).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
