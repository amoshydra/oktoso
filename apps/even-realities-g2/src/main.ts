import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import type {
  AnswerChoice,
  Attention,
  AttentionField,
  Message,
  PendingQuestion,
  QuestionPrompt,
  ReplyOption,
  SendAnswer,
  Session,
} from "@agent-hub/contracts";
import { HubClient, messageFromHubEvent } from "@agent-hub/client";
import {
  chatScrollStep,
  clampLine,
  frameSignature,
  pageChoices,
  wrapText,
} from "@agent-hub/wearable-core";
import {
  activityForMessages,
  buildChat,
  initialViewport,
  mergeChatMessages,
  nextViewport,
} from "./chat-model";
import {
  buildAnswerMetadata,
  buildAnswerRows,
  buildAnswerSummary,
  type AnswerRow,
} from "./answer-model";
import { glassInput } from "./input";

const TOKEN_KEY = "agent-hub-even-g2-token";
const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Screen =
  | "pairing"
  | "home"
  | "inbox"
  | "sessions"
  | "attention"
  | "glass-form"
  | "glass-options"
  | "chat"
  | "answer"
  | "answer-more"
  | "answer-type"
  | "answer-sent"
  | "answer-confirm"
  | "answer-stale"
  | "reply"
  | "choices";

interface AppState {
  screen: Screen;
  attention: Attention[];
  attentionTotal: number;
  sessions: Session[];
  returnScreen: Screen;
  selectedAttention?: Attention;
  sessionRef?: string;
  sessionTitle?: string;
  sessionProject?: string;
  chatMessages: Message[];
  chatLines: string[];
  chatLineMessages: number[];
  chatMessageCount: number;
  chatOffset: number;
  chatNewBelow: boolean;
  chatActivity: string;
  formValues: Record<string, unknown>;
  formOptionsField?: AttentionField;
  formError?: string;
  formBusy: boolean;
  replyOptions: ReplyOption[];
  replyPage: number;
  replyReturnScreen: Screen;
  choiceOptions: ReplyOption[];
  choicePage: number;
  question?: QuestionPrompt;
  answerText?: string;
  pendingAnswerText?: string;
  answerBusy: boolean;
  answerError?: string;
  answerMode: boolean;
  answerStale?: "changed" | "resolved";
  answerKey?: string;
  answerKeyText?: string;
  pendingAnswerChoice?: AnswerChoice;
  notice?: string;
  error?: string;
}

const state: AppState = {
  screen: "pairing",
  attention: [],
  attentionTotal: 0,
  sessions: [],
  returnScreen: "home",
  chatMessages: [],
  chatLines: [],
  chatLineMessages: [],
  chatMessageCount: 0,
  chatOffset: 0,
  chatNewBelow: false,
  chatActivity: "",
  formValues: {},
  formOptionsField: undefined,
  formError: undefined,
  formBusy: false,
  replyOptions: [],
  replyPage: 0,
  replyReturnScreen: "chat",
  choiceOptions: [],
  choicePage: 0,
  question: undefined,
  answerText: undefined,
  pendingAnswerText: undefined,
  answerBusy: false,
  answerError: undefined,
  answerMode: false,
  answerStale: undefined,
  answerKey: undefined,
  answerKeyText: undefined,
  pendingAnswerChoice: undefined,
};

let bridge: EvenAppBridge | undefined;
let client: HubClient | undefined;
let storedToken = localStorage.getItem(TOKEN_KEY) ?? "";
let pollTimer: ReturnType<typeof setInterval> | undefined;
const CHAT_VISIBLE_LINES = 6;
const CHAT_SCROLL_BURST_MS = 500;
let eventQueue: any[] = [];
let eventBusy = false;
let previewListItems: string[] | undefined;
let previewCursor = 0;
let lastGlassSignature = "";
let chatLoadSequence = 0;
let chatUpdateInFlight = false;
let chatUpdateQueued = false;
let eventController: AbortController | undefined;
let eventRefreshTimer: ReturnType<typeof setTimeout> | undefined;
let lastChatScrollAt = 0;
let chatScrollBurst = 0;
let phoneFormItem: Attention | undefined;
let phoneFormValues: Record<string, unknown> = {};

const phoneSession = byId<HTMLSpanElement>("phone-session");
const phoneText = byId<HTMLTextAreaElement>("phone-text");
const phoneSend = byId<HTMLButtonElement>("phone-send");
const phoneStatus = byId<HTMLDivElement>("phone-status");
const phoneFormPanel = byId<HTMLElement>("phone-form-panel");
const phoneFormTitle = byId<HTMLElement>("phone-form-title");
const phoneFormSummary = byId<HTMLElement>("phone-form-summary");
const phoneFormFields = byId<HTMLDivElement>("phone-form-fields");
const phoneFormSubmit = byId<HTMLButtonElement>("phone-form-submit");
const phoneFormCancel = byId<HTMLButtonElement>("phone-form-cancel");
const phoneFormStatus = byId<HTMLDivElement>("phone-form-status");
const phoneQuestionPanel = byId<HTMLElement>("phone-question-panel");
const phoneQuestionSession = byId<HTMLElement>("phone-question-session");
const phoneQuestionText = byId<HTMLElement>("phone-question-text");
const phoneQuestionChoices = byId<HTMLDivElement>("phone-question-choices");
const phoneQuestionType = byId<HTMLButtonElement>("phone-question-type");
const phoneQuestionStatus = byId<HTMLDivElement>("phone-question-status");
const connection = byId<HTMLSpanElement>("connection");
const connectionStatus = byId<HTMLDivElement>("connection-status");
const bridgeStatus = byId<HTMLParagraphElement>("bridge-status");
const debug = byId<HTMLPreElement>("debug");
const glassesPreview = byId<HTMLPreElement>("glasses-preview");
const previewSelection = byId<HTMLDivElement>("preview-selection");

function log(message: string): void {
  debug.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${debug.textContent ?? ""}`.slice(0, 4_000);
}

function setConnection(label: string, error = false): void {
  connection.textContent = label;
  connectionStatus.textContent = error ? label : "";
  connectionStatus.className = error ? "status error" : "status";
}

function setPhoneStatus(message: string, error = false): void {
  phoneStatus.textContent = message;
  phoneStatus.className = error ? "status error" : "status";
}

function setPhoneFormStatus(message: string, error = false): void {
  phoneFormStatus.textContent = message;
  phoneFormStatus.className = error ? "status error" : "status";
}

function hidePhoneForm(): void {
  phoneFormItem = undefined;
  phoneFormValues = {};
  phoneFormFields.replaceChildren();
  phoneFormPanel.hidden = true;
  setPhoneFormStatus("");
}

function showPhoneForm(item: Attention): void {
  const fields = item.fields ?? [];
  if (fields.length === 0) {
    hidePhoneForm();
    return;
  }
  phoneFormItem = item;
  phoneFormValues = {};
  phoneFormTitle.textContent = item.title;
  phoneFormSummary.textContent = item.summary;
  phoneFormFields.replaceChildren();
  setPhoneFormStatus("");
  for (const [index, field] of fields.entries()) {
    phoneFormValues[field.id] = fieldDefault(field);
    phoneFormFields.append(renderPhoneField(field, index));
  }
  phoneFormSubmit.disabled = !item.actions.some((action) => action.id === "answer");
  phoneFormPanel.hidden = false;
  phoneFormPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function renderPhoneField(field: AttentionField, index: number): HTMLElement {
  if (field.type === "multiselect") {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = `${field.label}${field.required ? " *" : ""}`;
    fieldset.append(legend);
    const selected = Array.isArray(phoneFormValues[field.id])
      ? (phoneFormValues[field.id] as string[])
      : [];
    for (const option of field.options ?? []) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selected.includes(option.value);
      checkbox.addEventListener("change", () => {
        const current = Array.isArray(phoneFormValues[field.id])
          ? (phoneFormValues[field.id] as string[])
          : [];
        phoneFormValues[field.id] = checkbox.checked
          ? [...current, option.value]
          : current.filter((value) => value !== option.value);
      });
      label.append(checkbox, document.createTextNode(option.label));
      fieldset.append(label);
    }
    if (field.description) {
      const help = document.createElement("small");
      help.className = "hint";
      help.textContent = field.description;
      fieldset.append(help);
    }
    return fieldset;
  }

  const label = document.createElement("label");
  label.textContent = `${field.label}${field.required ? " *" : ""}`;
  const id = `phone-form-field-${index}`;
  if (field.type === "boolean") {
    const input = document.createElement("input");
    input.id = id;
    input.type = "checkbox";
    input.checked = Boolean(phoneFormValues[field.id]);
    input.addEventListener("change", () => {
      phoneFormValues[field.id] = input.checked;
    });
    label.append(input);
  } else if (field.type === "select") {
    const select = document.createElement("select");
    select.id = id;
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose…";
    select.append(empty);
    for (const option of field.options ?? []) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      select.append(item);
    }
    select.value =
      typeof phoneFormValues[field.id] === "string"
        ? (phoneFormValues[field.id] as string)
        : "";
    select.addEventListener("change", () => {
      phoneFormValues[field.id] = select.value;
    });
    label.append(select);
  } else if (field.type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.id = id;
    textarea.rows = 3;
    textarea.placeholder = field.placeholder ?? "";
    textarea.value =
      typeof phoneFormValues[field.id] === "string"
        ? (phoneFormValues[field.id] as string)
        : "";
    textarea.addEventListener("input", () => {
      phoneFormValues[field.id] = textarea.value;
    });
    label.append(textarea);
  } else {
    const input = document.createElement("input");
    input.id = id;
    input.type = field.type === "number" ? "number" : "text";
    input.placeholder = field.placeholder ?? "";
    input.value =
      typeof phoneFormValues[field.id] === "string" ||
      typeof phoneFormValues[field.id] === "number"
        ? String(phoneFormValues[field.id])
        : "";
    input.addEventListener("input", () => {
      phoneFormValues[field.id] = input.value;
    });
    label.append(input);
  }
  if (field.description) {
    const help = document.createElement("small");
    help.className = "hint";
    help.textContent = field.description;
    label.append(help);
  }
  return label;
}

function fieldDefault(field: AttentionField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (field.type === "boolean") return false;
  if (field.type === "multiselect") return [];
  return "";
}

function missingPhoneFields(item: Attention): AttentionField[] {
  return (item.fields ?? []).filter((field) => {
    if (!field.required) return false;
    const value = phoneFormValues[field.id];
    return (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    );
  });
}

async function submitPhoneForm(): Promise<void> {
  const item = phoneFormItem;
  if (!item || !client) return;
  const missing = missingPhoneFields(item);
  if (missing.length > 0) {
    setPhoneFormStatus(
      `Required: ${missing.map((field) => field.label).join(", ")}`,
      true,
    );
    return;
  }

  const fields: Record<string, unknown> = {};
  for (const field of item.fields ?? []) {
    const value = phoneFormValues[field.id];
    fields[field.id] =
      field.type === "number" && typeof value === "string" && value !== ""
        ? Number(value)
        : value;
  }

  phoneFormSubmit.disabled = true;
  setPhoneFormStatus("Submitting…");
  try {
    await client.actOnAttention(item.id, "answer", { fields });
    state.selectedAttention = undefined;
    hidePhoneForm();
    state.screen = "inbox";
    await refreshInbox();
    render();
  } catch (error) {
    setPhoneFormStatus(errorMessage(error), true);
  } finally {
    phoneFormSubmit.disabled = false;
  }
}

function syncPhoneSession(): void {
  const hasSession = Boolean(state.sessionRef);
  phoneSession.textContent = hasSession
    ? clampLine(state.sessionTitle ?? state.sessionRef ?? "", 48)
    : "No session open";
  phoneSend.textContent = state.answerMode ? "Send answer" : "Send to session";
  phoneSend.disabled =
    !hasSession || !phoneText.value.trim() || state.answerBusy;
}

function updatePhoneState(): void {
  syncPhoneSession();
}

function activeQuestion(): PendingQuestion | undefined {
  return state.question?.questions[0];
}

function answerRows(): AnswerRow[] {
  const question = activeQuestion();
  return question && state.question
    ? buildAnswerRows(question, state.question)
    : [];
}

function answerSummary(): string {
  const question = activeQuestion();
  return question ? buildAnswerSummary(question) : "";
}

function answerHeader(prefix = "ANSWER"): string {
  return clampLine(
    `${prefix} · ${state.sessionTitle ?? "Session"}`,
    40,
  );
}

function answerMetadata(choice?: AnswerChoice): SendAnswer | undefined {
  return state.question
    ? buildAnswerMetadata(state.question, choice)
    : undefined;
}

function newAnswerKey(): string {
  const generated = globalThis.crypto?.randomUUID?.();
  return (
    generated ??
    `answer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );
}

function answerKeyFor(text: string): string {
  if (!state.answerKey || state.answerKeyText !== text) {
    state.answerKey = newAnswerKey();
    state.answerKeyText = text;
  }
  return state.answerKey;
}

const buildHubURL = (import.meta.env.VITE_HUB_URL ?? "").replace(/\/+$/, "");

function hubBaseURL(): string {
  if (buildHubURL) return buildHubURL;
  return window.location.origin === "null" ? "" : window.location.origin;
}

async function refreshStoredSession(
  hub: HubClient,
  check: { auth?: { kind: string; expiresAt?: number } },
  viaToken: boolean,
): Promise<void> {
  if (!viaToken) return;
  if (check.auth?.kind !== "session") return;
  if (check.auth.expiresAt === undefined) return;
  if (check.auth.expiresAt - Date.now() > SESSION_REFRESH_WINDOW_MS) return;

  try {
    const refreshed = await hub.refresh();
    hub.setToken(refreshed.token);
    storedToken = refreshed.token;
    localStorage.setItem(TOKEN_KEY, refreshed.token);
  } catch {
    // Keep the old token until it expires.
  }
}

async function connect(): Promise<void> {
  const tokenInput = byId<HTMLInputElement>("hub-token");
  const baseUrl = hubBaseURL();
  const inputToken = tokenInput.value.trim();
  const token = inputToken || storedToken;
  setConnection("Connecting…");

  const candidates: Array<{ hub: HubClient; viaToken: boolean }> = [
    ...(token
      ? [{ hub: new HubClient({ baseUrl, token }), viaToken: true }]
      : []),
    { hub: new HubClient({ baseUrl }), viaToken: false },
  ];

  for (const candidate of candidates) {
    try {
      const check = await candidate.hub.authCheck();
      await refreshStoredSession(candidate.hub, check, candidate.viaToken);
      client = candidate.hub;
      if (candidate.viaToken && inputToken) {
        storedToken = inputToken;
        localStorage.setItem(TOKEN_KEY, inputToken);
      } else if (!candidate.viaToken) {
        storedToken = "";
        localStorage.removeItem(TOKEN_KEY);
      }
      tokenInput.value = "";
      tokenInput.placeholder = storedToken ? "Saved token" : "Paired with cookie";
      setConnection("Connected");
      log("Hub connected");
      startEventStream();
      await refreshInbox();
      state.screen = "home";
      render();
      return;
    } catch {
      // Try the next credential.
    }
  }

  client = undefined;
  setConnection(token ? "Connection failed" : "Pair or enter token", true);
  log("Connect failed: no accepted hub credential");
  render();
}

async function restoreConnection(): Promise<void> {
  const baseUrl = hubBaseURL();
  setConnection("Restoring…");

  const candidates: Array<{ hub: HubClient; viaToken: boolean }> = [
    ...(storedToken
      ? [{ hub: new HubClient({ baseUrl, token: storedToken }), viaToken: true }]
      : []),
    // A browser paired through /api/v1/auth/connect has an HttpOnly cookie.
    { hub: new HubClient({ baseUrl }), viaToken: false },
  ];

  for (const candidate of candidates) {
    try {
      const check = await candidate.hub.authCheck();
      await refreshStoredSession(candidate.hub, check, candidate.viaToken);
      client = candidate.hub;
      if (!candidate.viaToken) {
        storedToken = "";
        localStorage.removeItem(TOKEN_KEY);
      }
      byId<HTMLInputElement>("hub-token").placeholder = storedToken
        ? "Saved token"
        : "Paired with cookie";
      setConnection("Connected");
      log("Restored hub session");
      startEventStream();
      await refreshInbox();
      state.screen = "home";
      render();
      return;
    } catch {
      // Try the next credential.
    }
  }

  client = undefined;
  setConnection(
    storedToken ? "Reconnect in phone" : "Not connected",
    Boolean(storedToken),
  );
  render();
}

function startEventStream(): void {
  eventController?.abort();
  if (!client) return;
  const controller = new AbortController();
  eventController = controller;
  void client
    .startEvents({
      after: 0,
      signal: controller.signal,
      onStatus: (status) => log(`Hub events: ${status}`),
      onEvent: (event) => {
        if (controller.signal.aborted) return;
        if (event.type === "resync") {
          void refreshInbox();
          if (state.screen === "chat" && state.sessionRef) {
            void loadChat(true);
          }
          return;
        }
        if (event.type === "session.updated" && state.screen === "inbox") {
          scheduleEventRefresh(() => refreshInbox());
        }
        if (
          (event.type === "message.created" || event.type === "message.updated") &&
          state.screen === "chat" &&
          event.sessionRef === state.sessionRef
        ) {
          const message = messageFromHubEvent(event);
          if (message) applyLiveMessage(message);
          else scheduleEventRefresh(() => loadChat(true));
        }
        if (
          event.type === "session.updated" &&
          state.screen === "chat" &&
          event.sessionRef === state.sessionRef
        ) {
          scheduleEventRefresh(() => loadChat(true));
        }
        if (event.type.startsWith("attention.") && state.screen === "inbox") {
          scheduleEventRefresh(() => refreshInbox());
        }
      },
    })
    .catch((error) => {
      if (!controller.signal.aborted) {
        log(`Hub events stopped: ${errorMessage(error)}`);
      }
    });
}

function scheduleEventRefresh(action: () => void | Promise<void>): void {
  if (eventRefreshTimer) clearTimeout(eventRefreshTimer);
  eventRefreshTimer = setTimeout(() => {
    eventRefreshTimer = undefined;
    void action();
  }, 500);
}

async function openSessions(): Promise<void> {
  if (!client) return;
  try {
    const page = await client.sessions({ limit: 5 });
    state.sessions = page.data;
    state.error = undefined;
    state.screen = "sessions";
    render();
  } catch (error) {
    state.error = errorMessage(error);
    state.screen = "sessions";
    render();
    log(`Session list failed: ${state.error}`);
  }
}

async function refreshInbox(): Promise<void> {
  if (!client) {
    render();
    return;
  }
  const previousScreen = state.screen;
  const previousSignature = attentionListSignature(state.attention);
  const previousTotal = state.attentionTotal;
  const previousError = state.error;
  try {
    const page = await client.attention();
    state.attentionTotal = page.data.length;
    state.attention = page.data.slice(0, 5);
    if (
      phoneFormItem &&
      !page.data.some((item) => item.id === phoneFormItem?.id)
    ) {
      hidePhoneForm();
    }
    state.error = undefined;
    if (state.screen === "pairing") state.screen = "home";
    const changed =
      previousScreen !== state.screen ||
      previousSignature !== attentionListSignature(state.attention) ||
      previousTotal !== state.attentionTotal ||
      Boolean(previousError) !== false;
    updatePhoneState();
    if (changed) render();
  } catch (error) {
    state.error = errorMessage(error);
    if (state.screen === "pairing") state.screen = "home";
    const changed =
      previousScreen !== state.screen ||
      previousError !== state.error;
    if (changed) render();
    log(`Inbox refresh failed: ${state.error}`);
  }
}

function attentionListSignature(items: Attention[]): string {
  return items
    .map((item) => `${attentionLabel(item)}|${item.title}`)
    .join("\n");
}

async function openAttention(index: number): Promise<void> {
  const item = state.attention[index];
  if (!item) return;
  state.selectedAttention = item;
  state.error = undefined;
  state.screen = "attention";
  if (item.fields?.length && !canUseGlassForm(item)) showPhoneForm(item);
  else hidePhoneForm();
  render();
}

function canUseGlassForm(item: Attention): boolean {
  const fields = item.fields ?? [];
  return (
    fields.length > 0 &&
    fields.every((field) => field.type === "boolean" || field.type === "select") &&
    item.actions.some((action) => action.id === "answer")
  );
}

function attentionActions(item: Attention): Array<{ id: string; label: string }> {
  const hasFields = (item.fields?.length ?? 0) > 0;
  const hasAnswer = item.actions.some((action) => action.id === "answer");
  const actions = item.actions
    .filter((action) => action.id !== "answer" || !hasFields)
    .map((action) => ({ id: action.id, label: action.label }));
  const fieldActions: Array<{ id: string; label: string }> = [];
  if (canUseGlassForm(item)) {
    fieldActions.push({ id: "glass_form", label: "Answer on glass" });
  }
  if (hasFields && hasAnswer) {
    fieldActions.push({ id: "phone_form", label: "Answer on phone" });
  }
  actions.push({ id: "open_chat", label: "Open chat" });
  return [...fieldActions, ...actions];
}

function openGlassForm(item: Attention): void {
  state.formValues = {};
  state.formOptionsField = undefined;
  state.formError = undefined;
  state.formBusy = false;
  for (const field of item.fields ?? []) {
    state.formValues[field.id] =
      field.defaultValue !== undefined
        ? field.defaultValue
        : field.type === "boolean"
          ? undefined
          : "";
  }
  hidePhoneForm();
  state.screen = "glass-form";
  render();
}

function glassFormView(item: Attention): { items: string[]; footer: string } {
  const fields = item.fields ?? [];
  const items = fields.map((field) => {
    const value = state.formValues[field.id];
    const display =
      value === undefined || value === ""
        ? "Choose…"
        : field.type === "boolean"
          ? value
            ? "Yes"
            : "No"
          : optionLabel(field, String(value));
    return clampLine(`${field.label}: ${display}`, 54);
  });
  items.push("Submit answer");
  return {
    items,
    footer: state.formError
      ? clampLine(state.formError, 54)
      : "Tap change   Back ×2",
  };
}

function optionLabel(field: AttentionField, value: string): string {
  return field.options?.find((option) => option.value === value)?.label ?? value;
}

function editGlassField(item: Attention, index: number): void {
  const field = item.fields?.[index];
  if (!field) return;
  state.formError = undefined;
  if (field.type === "boolean") {
    const current = state.formValues[field.id];
    state.formValues[field.id] = current === undefined ? true : !current;
    render();
    return;
  }
  if (field.type === "select") {
    state.formOptionsField = field;
    state.screen = "glass-options";
    render();
  }
}

async function submitGlassForm(item: Attention): Promise<void> {
  if (!client || state.formBusy) return;
  const missing = (item.fields ?? []).filter((field) => {
    if (!field.required) return false;
    const value = state.formValues[field.id];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    state.formError = `Required: ${missing.map((field) => field.label).join(", ")}`;
    render();
    return;
  }
  state.formBusy = true;
  state.formError = undefined;
  try {
    const fields: Record<string, unknown> = {};
    for (const field of item.fields ?? []) {
      fields[field.id] = state.formValues[field.id];
    }
    await client.actOnAttention(item.id, "answer", { fields });
    state.selectedAttention = undefined;
    state.formValues = {};
    state.formOptionsField = undefined;
    state.screen = "inbox";
    await refreshInbox();
    render();
  } catch (error) {
    state.formError = errorMessage(error);
    render();
  } finally {
    state.formBusy = false;
  }
}

async function performAttention(index: number): Promise<void> {
  const item = state.selectedAttention;
  if (!item) return;
  const action = attentionActions(item)[index];
  if (!action) return;
  if (action.id === "open_chat") {
    await openChat(item.sessionRef, item.title, "inbox");
    return;
  }
  if (action.id === "glass_form") {
    openGlassForm(item);
    return;
  }
  if (action.id === "phone_form") {
    showPhoneForm(item);
    return;
  }
  if (!client) return;
  try {
    await client.actOnAttention(item.id, action.id, {});
    state.selectedAttention = undefined;
    await refreshInbox();
  } catch (error) {
    state.error = errorMessage(error);
    render();
    log(`Attention action failed: ${state.error}`);
  }
}

async function openChat(
  ref: string,
  title: string,
  origin: Screen = "inbox",
): Promise<void> {
  chatLoadSequence += 1;
  state.sessionRef = ref;
  state.sessionTitle = title;
  state.sessionProject = undefined;
  state.returnScreen = origin;
  state.chatMessages = [];
  state.chatLines = [];
  state.chatLineMessages = [];
  state.chatMessageCount = 0;
  state.chatOffset = 0;
  state.chatNewBelow = false;
  state.chatActivity = "";
  state.question = undefined;
  state.answerText = undefined;
  state.pendingAnswerText = undefined;
  state.answerError = undefined;
  state.answerBusy = false;
  state.answerMode = false;
  state.answerStale = undefined;
  state.answerKey = undefined;
  state.answerKeyText = undefined;
  state.pendingAnswerChoice = undefined;
  lastChatScrollAt = 0;
  chatScrollBurst = 0;
  state.screen = "chat";
  state.error = undefined;
  state.notice = undefined;
  hidePhoneForm();
  updatePhoneState();
  updatePhoneQuestion();
  void client
    ?.session(ref)
    .then((session) => {
      if (state.sessionRef !== ref) return;
      state.sessionProject = session.project;
      if (state.screen === "chat") render();
    })
    .catch(() => undefined);
  void loadQuestion(ref);
  await loadChat(false);
  if (client) void client.markRead(ref).catch(() => undefined);
}

async function loadQuestion(ref: string): Promise<void> {
  if (!client) return;
  try {
    const question = await client.question(ref);
    if (state.sessionRef !== ref) return;
    state.question = question ?? undefined;
    state.answerMode = false;
    updatePhoneQuestion();
    if (state.screen === "chat") render();
  } catch (error) {
    log(`Question load failed: ${errorMessage(error)}`);
  }
}

function openAnswer(): void {
  if (!state.question) {
    void openReply();
    return;
  }
  state.screen = "answer";
  state.answerError = undefined;
  state.answerStale = undefined;
  state.answerKey = undefined;
  state.answerKeyText = undefined;
  state.pendingAnswerText = undefined;
  state.pendingAnswerChoice = undefined;
  state.answerMode = false;
  updatePhoneQuestion();
  render();
}

async function sendAnswer(
  text: string,
  source: "glass" | "phone" = "glass",
  choice?: AnswerChoice,
): Promise<void> {
  if (!client || !state.sessionRef || state.answerBusy) return;
  const ref = state.sessionRef;
  const answer = answerMetadata(choice);
  const idempotencyKey = answer ? answerKeyFor(text) : undefined;
  state.answerBusy = true;
  state.answerText = text;
  state.answerError = undefined;
  updatePhoneQuestion();
  if (source === "phone") setPhoneStatus("Sending answer…");

  try {
    await client.sendMessage(
      ref,
      { text, ...(answer ? { answer } : {}) },
      idempotencyKey ? { idempotencyKey } : {},
    );
    if (state.sessionRef !== ref) return;
    state.answerBusy = false;
    state.question = undefined;
    state.answerMode = false;
    state.answerStale = undefined;
    state.answerKey = undefined;
    state.answerKeyText = undefined;
    state.pendingAnswerText = undefined;
    state.pendingAnswerChoice = undefined;
    state.screen = "answer-sent";
    updatePhoneQuestion();
    if (source === "phone") {
      phoneText.value = "";
      setPhoneStatus("Answer sent.");
    }
    render();
  } catch (error) {
    state.answerBusy = false;
    const status = (error as { status?: number }).status;
    const reason = (
      error as { details?: { reason?: string } }
    ).details?.reason;
    if (
      status === 409 &&
      (reason === "question_changed" || reason === "question_resolved")
    ) {
      state.answerStale =
        reason === "question_resolved" ? "resolved" : "changed";
      state.answerKey = undefined;
      state.answerKeyText = undefined;
      state.screen = "answer-stale";
      if (source === "phone") {
        setPhoneStatus("Question changed. Review before answering.", true);
      }
      updatePhoneQuestion();
      render();
      log(`Answer rejected: ${reason}`);
      return;
    }

    state.answerError = errorMessage(error);
    state.screen = "answer";
    if (source === "phone") setPhoneStatus(state.answerError, true);
    render();
    log(`Answer send failed: ${state.answerError}`);
  }
}

function focusPhoneAnswer(): void {
  phoneText.focus();
  phoneText.scrollIntoView({ block: "center", behavior: "smooth" });
  setPhoneStatus("Type your answer, then send.");
}

function openTypeAnswer(): void {
  state.answerMode = true;
  state.screen = "answer-type";
  updatePhoneQuestion();
  focusPhoneAnswer();
  render();
}

async function openAttentionByID(id: string | undefined): Promise<void> {
  if (!id) {
    state.screen = "inbox";
    render();
    return;
  }
  let item = state.attention.find((candidate) => candidate.id === id);
  if (!item) {
    await refreshInbox();
    item = state.attention.find((candidate) => candidate.id === id);
  }
  if (item) {
    state.selectedAttention = item;
    state.screen = "attention";
    render();
  } else {
    state.screen = "inbox";
    render();
  }
}

async function performAnswerRow(index: number): Promise<void> {
  if (state.screen === "answer-stale") {
    if (state.answerStale === "changed" && index === 0 && state.sessionRef) {
      await loadQuestion(state.sessionRef);
      state.answerStale = undefined;
      state.screen = state.question ? "answer" : "chat";
      render();
      return;
    }
    const ref = state.sessionRef;
    state.answerStale = undefined;
    state.question = undefined;
    state.screen = "chat";
    state.answerMode = false;
    updatePhoneQuestion();
    render();
    if (ref) void loadQuestion(ref);
    return;
  }

  if (state.screen === "answer-confirm") {
    if (index === 0) {
      const text = state.pendingAnswerText;
      if (text) await sendAnswer(text, "glass", state.pendingAnswerChoice);
    } else {
      state.pendingAnswerText = undefined;
      state.pendingAnswerChoice = undefined;
      state.screen = "answer";
      render();
    }
    return;
  }

  if (state.screen === "answer-more") {
    if (index === 0) {
      await openReply();
    } else if (index === 1) {
      state.screen = "chat";
      state.answerMode = false;
      updatePhoneQuestion();
      render();
    } else if (index === 2 && client && state.sessionRef) {
      try {
        await client.interrupt(state.sessionRef);
      } catch (error) {
        log(`Interrupt failed: ${errorMessage(error)}`);
      }
      state.screen = "chat";
      render();
    }
    return;
  }

  const row = answerRows()[index];
  if (!row) return;
  if (row.kind === "choice") {
    if (row.choice.requiresConfirmation) {
      state.pendingAnswerText = row.choice.text;
      state.pendingAnswerChoice = row.choice;
      state.screen = "answer-confirm";
      render();
    } else {
      await sendAnswer(row.choice.text, "glass", row.choice);
    }
    return;
  }

  if (row.action === "type" || row.action === "phone") {
    openTypeAnswer();
  } else if (row.action === "more") {
    state.screen = "answer-more";
    render();
  } else if (row.action === "read") {
    state.screen = "chat";
    state.answerMode = false;
    updatePhoneQuestion();
    render();
  } else if (row.action === "attention") {
    await openAttentionByID(state.question?.attentionID);
  }
}

function updatePhoneQuestion(): void {
  const question = activeQuestion();
  const visible =
    Boolean(question && state.sessionRef) &&
    [
      "chat",
      "answer",
      "answer-more",
      "answer-type",
      "answer-sent",
      "answer-confirm",
    ].includes(state.screen);
  phoneQuestionPanel.hidden = !visible;
  if (!question || !visible) {
    phoneQuestionChoices.replaceChildren();
    phoneQuestionStatus.textContent = "";
    return;
  }

  phoneQuestionSession.textContent = clampLine(
    state.sessionTitle ?? state.sessionRef ?? "",
    48,
  );
  const formal = Boolean(state.question?.attentionID);
  phoneQuestionText.textContent = formal
    ? "This question has a formal answer form in Inbox."
    : question.context
      ? `${question.text}\n${question.context}`
      : question.text;
  phoneQuestionChoices.replaceChildren();
  for (const choice of formal ? [] : question.choices.slice(0, 6)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = choice.text;
    button.disabled = state.answerBusy;
    button.addEventListener("click", () => {
      void sendAnswer(choice.text, "phone", choice);
    });
    phoneQuestionChoices.append(button);
  }
  phoneQuestionType.hidden = formal || !question.allowsFreeText;
  phoneQuestionType.disabled = state.answerBusy;
  phoneQuestionStatus.textContent = state.answerBusy
    ? "Sending…"
    : state.answerError ?? "";
  phoneQuestionStatus.className = state.answerError
    ? "status error"
    : "status";
}

async function loadChat(quiet: boolean): Promise<void> {
  if (!client || !state.sessionRef) return;
  const ref = state.sessionRef;
  const sequence = ++chatLoadSequence;
  try {
    const messages = await loadReadableMessages(ref);
    if (sequence !== chatLoadSequence || state.sessionRef !== ref) return;
    const previousIDs = new Set(state.chatMessages.map((message) => message.id));
    const newMessageID = messages.findLast(
      (message) => !previousIDs.has(message.id),
    )?.id;
    const previousLines = state.chatLines;
    const previousOffset = state.chatOffset;
    state.chatMessages = mergeChatMessages(state.chatMessages, messages);
    const built = buildChat(state.chatMessages);
    state.chatLines = built.lines;
    state.chatLineMessages = built.lineMessages;
    state.chatMessageCount = built.messageCount;
    state.chatActivity = activityForMessages(state.chatMessages);
    const viewport = quiet
      ? nextViewport({
          previousOffset,
          previousLineCount: previousLines.length,
          newBelow: state.chatNewBelow,
          build: built,
          visibleLines: CHAT_VISIBLE_LINES,
          ...(newMessageID ? { newMessageID } : {}),
        })
      : initialViewport(built, CHAT_VISIBLE_LINES);
    state.chatOffset = viewport.offset;
    state.chatNewBelow = viewport.newBelow;
    state.error = undefined;
    const changed =
      previousLines.length !== state.chatLines.length ||
      previousLines.some((line, index) => line !== state.chatLines[index]);
    if (quiet && bridge && state.screen === "chat") {
      if (changed || previousOffset !== state.chatOffset) {
        await updateChatView();
      }
      updatePhoneState();
      return;
    }
    render();
    updatePhoneState();
  } catch (error) {
    if (sequence !== chatLoadSequence || state.sessionRef !== ref) return;
    state.error = errorMessage(error);
    render();
    log(`Chat load failed: ${state.error}`);
  }
}

function applyLiveMessage(message: Message): void {
  if (state.screen !== "chat" || message.sessionRef !== state.sessionRef) return;
  const isNew = !state.chatMessages.some((item) => item.id === message.id);
  const previousLines = state.chatLines;
  const previousOffset = state.chatOffset;
  state.chatMessages = mergeChatMessages(state.chatMessages, [message]);
  const built = buildChat(state.chatMessages);
  state.chatLines = built.lines;
  state.chatLineMessages = built.lineMessages;
  state.chatMessageCount = built.messageCount;
  state.chatActivity = activityForMessages(state.chatMessages);
  const viewport = nextViewport({
    previousOffset,
    previousLineCount: previousLines.length,
    newBelow: state.chatNewBelow,
    build: built,
    visibleLines: CHAT_VISIBLE_LINES,
    ...(isNew ? { newMessageID: message.id } : {}),
  });
  state.chatOffset = viewport.offset;
  state.chatNewBelow = viewport.newBelow;
  const changed =
    previousLines.length !== state.chatLines.length ||
    previousLines.some((line, index) => line !== state.chatLines[index]);
  if (changed || previousOffset !== state.chatOffset) {
    void updateChatView();
  }
  updatePhoneState();
}

async function loadReadableMessages(ref: string): Promise<Message[]> {
  if (!client) return [];
  const collected: Message[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
    const page = await client.messages(ref, {
      limit: 50,
      order: "desc",
      ...(cursor ? { cursor } : {}),
    });
    collected.push(...page.data);
    if (hasReadableText(collected)) break;
    if (!page.cursor.next) break;
    cursor = page.cursor.next;
  }
  return [...collected].reverse();
}

function hasReadableText(messages: Message[]): boolean {
  return messages.some((message) =>
    message.parts.some((part) => part.type === "text" && part.text.trim()),
  );
}

function chatView(): { header: string; body: string; footer: string } {
  const total = state.chatLines.length;
  const maxOffset = Math.max(0, total - CHAT_VISIBLE_LINES);
  const offset = Math.min(Math.max(0, state.chatOffset), maxOffset);
  state.chatOffset = offset;
  const visible = state.chatLines.slice(offset, offset + CHAT_VISIBLE_LINES);
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(total, offset + CHAT_VISIBLE_LINES);
  const visibleLast = Math.min(total - 1, offset + CHAT_VISIBLE_LINES - 1);
  const firstMessage = state.chatLineMessages[offset];
  const lastMessage = state.chatLineMessages[visibleLast];
  const messageLabel =
    firstMessage === undefined || lastMessage === undefined || state.chatMessageCount === 0
      ? ""
      : firstMessage === lastMessage
        ? `M${firstMessage + 1}/${state.chatMessageCount}`
        : `M${firstMessage + 1}-${lastMessage + 1}/${state.chatMessageCount}`;
  const hint =
    total <= CHAT_VISIBLE_LINES
      ? "Swipe up/down · Back ×2"
      : offset >= maxOffset
        ? "Swipe up"
        : offset === 0
          ? "Swipe down"
          : "Swipe";
  const footer = clampLine(
    [
      state.question ? "? Answer" : "",
      `${first}-${last}/${total}`,
      messageLabel,
      state.chatActivity,
      state.chatNewBelow ? "New below" : "",
      hint,
    ]
      .filter(Boolean)
      .join(" · "),
    60,
  );
  return {
    header: clampLine(
      state.sessionProject
        ? `${state.sessionProject} · ${state.sessionTitle ?? "Session"}`
        : (state.sessionTitle ?? "Session"),
      40,
    ),
    body: visible.join("\n"),
    footer,
  };
}

async function updateChatView(): Promise<void> {
  if (!bridge) return;
  if (chatUpdateInFlight) {
    chatUpdateQueued = true;
    return;
  }
  chatUpdateInFlight = true;
  try {
    const view = chatView();
    if (!setPreview(view.header, view.body, view.footer)) return;
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
        containerName: "body",
        content: view.body,
      }),
    );
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 3,
        containerName: "footer",
        content: view.footer,
      }),
    );
  } catch (error) {
    log(`Chat view update failed: ${errorMessage(error)}`);
  } finally {
    chatUpdateInFlight = false;
    if (chatUpdateQueued) {
      chatUpdateQueued = false;
      void updateChatView();
    }
  }
}

function moveChatLine(delta: number): void {
  if (state.screen !== "chat") return;
  const maxOffset = Math.max(0, state.chatLines.length - CHAT_VISIBLE_LINES);
  const next = Math.min(maxOffset, Math.max(0, state.chatOffset + delta));
  if (next >= maxOffset) state.chatNewBelow = false;
  if (next === state.chatOffset) return;
  state.chatOffset = next;
  void updateChatView();
}

function scrollChat(direction: -1 | 1): void {
  const now = Date.now();
  chatScrollBurst =
    now - lastChatScrollAt <= CHAT_SCROLL_BURST_MS
      ? Math.min(chatScrollBurst + 1, 4)
      : 0;
  lastChatScrollAt = now;
  // Require several rapid swipes before accelerating. Deliberate reading
  // stays line-by-line; the fastest step is four lines, not a full page.
  moveChatLine(direction * chatScrollStep(chatScrollBurst));
}

async function openReply(): Promise<void> {
  if (!client || !state.sessionRef) return;
  state.replyReturnScreen =
    state.screen === "answer-more" ? "answer-more" : "chat";
  state.replyPage = 0;
  try {
    const options = await client.replyOptions(state.sessionRef, "reply");
    state.replyOptions = options.data;
    state.screen = "reply";
    state.error = undefined;
    state.notice = undefined;
    render();
  } catch (error) {
    state.error = errorMessage(error);
    render();
    log(`Reply options failed: ${state.error}`);
  }
}

function replyView(): {
  items: string[];
  options: ReplyOption[];
  page: number;
  pages: number;
  hasPrevious: boolean;
  hasNext: boolean;
} {
  const page = pageChoices(state.replyOptions, state.replyPage, 3);
  const items = page.items.map((option) => option.label);
  const hasPrevious = page.page > 0;
  const hasNext = page.page < page.pages - 1;
  if (hasPrevious) items.unshift("← Previous choices");
  if (hasNext) items.push("More choices →");
  return {
    items,
    options: page.items,
    page: page.page,
    pages: page.pages,
    hasPrevious,
    hasNext,
  };
}

async function performReply(index: number): Promise<void> {
  const view = replyView();
  let optionIndex = index;
  if (view.hasPrevious) {
    if (index === 0) {
      state.replyPage = Math.max(0, view.page - 1);
      render();
      return;
    }
    optionIndex -= 1;
  }
  if (optionIndex >= view.options.length) {
    if (view.hasNext) {
      state.replyPage = view.page + 1;
      render();
    }
    return;
  }
  const option = view.options[optionIndex];
  if (!option) return;
  await executeReply(option);
}

async function executeReply(option: ReplyOption): Promise<void> {
  if (!client || !state.sessionRef) return;
  try {
    if (option.action === "interrupt") {
      await client.interrupt(state.sessionRef);
      state.screen = "chat";
      await loadChat(false);
      return;
    }
    if (option.action === "phone") {
      phoneText.focus();
      setPhoneStatus("Type on the phone, then send.");
      state.screen = "chat";
      render();
      return;
    }
    if (option.action === "choices") {
      const choices = await client.replyOptions(state.sessionRef, "choices");
      if (choices.data.length === 0) {
        state.screen = "chat";
        state.notice = "No numbered choices found in the latest reply.";
        render();
        return;
      }
      state.choiceOptions = choices.data;
      state.choicePage = 0;
      state.screen = "choices";
      render();
      return;
    }
    if (option.action === "voice") {
      phoneText.focus();
      setPhoneStatus("Voice is not enabled yet; type on the phone.");
      state.screen = "chat";
      render();
      return;
    }
    if (option.text) {
      await client.sendMessage(state.sessionRef, { text: option.text });
      state.question = undefined;
      updatePhoneQuestion();
      state.screen = "chat";
      state.notice = "Reply sent.";
      await loadChat(false);
    }
  } catch (error) {
    state.error = errorMessage(error);
    render();
    log(`Reply failed: ${state.error}`);
  }
}

function choiceView(): {
  items: string[];
  options: ReplyOption[];
  hasPrevious: boolean;
  hasNext: boolean;
} {
  const page = pageChoices(state.choiceOptions, state.choicePage, 3);
  const items = page.items.map((option) => option.label);
  const hasPrevious = page.page > 0;
  const hasNext = page.page < page.pages - 1;
  if (hasPrevious) items.unshift("← Previous choices");
  if (hasNext) items.push("More choices →");
  return {
    items,
    options: page.items,
    hasPrevious,
    hasNext,
  };
}

async function performChoice(index: number): Promise<void> {
  const view = choiceView();
  let optionIndex = index;
  if (view.hasPrevious) {
    if (index === 0) {
      state.choicePage = Math.max(0, state.choicePage - 1);
      render();
      return;
    }
    optionIndex -= 1;
  }
  if (optionIndex >= view.options.length) {
    if (view.hasNext) {
      state.choicePage += 1;
      render();
    }
    return;
  }
  const option = view.options[optionIndex];
  if (!option || !client || !state.sessionRef) return;
  try {
    await client.sendMessage(state.sessionRef, { text: option.text });
    state.question = undefined;
    updatePhoneQuestion();
    state.screen = "chat";
    state.notice = "Choice sent.";
    await loadChat(false);
  } catch (error) {
    state.error = errorMessage(error);
    render();
    log(`Choice send failed: ${state.error}`);
  }
}

function back(): void {
  hidePhoneForm();
  if (state.screen === "answer") {
    state.screen = "chat";
    state.answerMode = false;
    updatePhoneQuestion();
    render();
    return;
  }
  if (state.screen === "answer-more") {
    state.screen = "answer";
    render();
    return;
  }
  if (state.screen === "answer-type") {
    state.screen = "answer";
    state.answerMode = false;
    updatePhoneQuestion();
    render();
    return;
  }
  if (state.screen === "answer-sent") {
    state.screen = "chat";
    state.answerMode = false;
    updatePhoneQuestion();
    render();
    void loadChat(false);
    return;
  }
  if (state.screen === "answer-confirm") {
    state.pendingAnswerText = undefined;
    state.pendingAnswerChoice = undefined;
    state.screen = "answer";
    render();
    return;
  }
  if (state.screen === "answer-stale") {
    const ref = state.sessionRef;
    state.answerStale = undefined;
    state.question = undefined;
    state.screen = "chat";
    state.answerMode = false;
    updatePhoneQuestion();
    render();
    void loadChat(false);
    if (ref) void loadQuestion(ref);
    return;
  }
  if (state.screen === "chat") {
    state.screen = state.returnScreen;
    state.selectedAttention = undefined;
    state.notice = undefined;
    state.answerMode = false;
    updatePhoneQuestion();
    render();
    void refreshInbox();
    return;
  }
  if (state.screen === "reply") {
    state.screen = state.replyReturnScreen;
    state.replyReturnScreen = "chat";
    state.notice = undefined;
    render();
    return;
  }
  if (state.screen === "choices") {
    state.screen = "reply";
    state.notice = undefined;
    render();
    return;
  }
  if (state.screen === "glass-options") {
    state.screen = "glass-form";
    state.formOptionsField = undefined;
    render();
    return;
  }
  if (state.screen === "glass-form") {
    state.screen = "attention";
    state.formOptionsField = undefined;
    state.formError = undefined;
    render();
    return;
  }
  if (state.screen === "attention") {
    state.screen = "inbox";
    state.selectedAttention = undefined;
    state.notice = undefined;
    render();
    return;
  }
  if (state.screen === "inbox" || state.screen === "sessions") {
    state.screen = "home";
    state.selectedAttention = undefined;
    state.notice = undefined;
    render();
  }
}

function handleListClick(index: number): void {
  switch (state.screen) {
    case "home":
      if (index === 0) {
        state.screen = "inbox";
        render();
        void refreshInbox();
      } else if (index === 1) {
        void openSessions();
      } else if (index === 2 && state.sessionRef) {
        void openChat(state.sessionRef, state.sessionTitle ?? "Session", "home");
      } else if (state.error) {
        void refreshInbox();
      }
      break;
    case "sessions": {
      const session = state.sessions[index];
      if (session) void openChat(session.ref, session.title, "sessions");
      break;
    }
    case "inbox":
      if (state.attention.length === 0 && state.error) {
        void refreshInbox();
      } else {
        void openAttention(index);
      }
      break;
    case "glass-form": {
      const item = state.selectedAttention;
      if (!item) break;
      if (index === (item.fields?.length ?? 0)) {
        void submitGlassForm(item);
      } else {
        editGlassField(item, index);
      }
      break;
    }
    case "glass-options": {
      const field = state.formOptionsField;
      const option = field?.options?.[index];
      if (field && option) {
        state.formValues[field.id] = option.value;
        state.formOptionsField = undefined;
        state.formError = undefined;
        state.screen = "glass-form";
        render();
      }
      break;
    }
    case "attention":
      void performAttention(index);
      break;
    case "answer":
    case "answer-more":
    case "answer-confirm":
    case "answer-stale":
      void performAnswerRow(index);
      break;
    case "reply":
      void performReply(index);
      break;
    case "choices":
      void performChoice(index);
      break;
    default:
      break;
  }
}

function handleTextClick(): void {
  if (state.screen === "chat") {
    if (state.question) openAnswer();
    else void openReply();
    return;
  }
  if (state.screen === "answer-type") {
    focusPhoneAnswer();
    return;
  }
  if (state.screen === "answer-sent") {
    state.screen = "chat";
    state.answerMode = false;
    updatePhoneQuestion();
    render();
    void loadChat(false);
    return;
  }
  if (state.screen === "pairing") {
    phoneText.focus();
  }
}

function onEvenEvent(event: any): void {
  eventQueue.push(event);
  void processEvents();
}

async function processEvents(): Promise<void> {
  if (eventBusy || eventQueue.length === 0) return;
  eventBusy = true;
  const event = eventQueue.shift();
  try {
    const input = glassInput(event);
    if (input?.type === "back") {
      back();
    } else if (input?.type === "scroll") {
      if (state.screen === "chat") scrollChat(input.direction);
    } else if (input?.type === "list-click") {
      handleListClick(input.index);
    } else if (input?.type === "text-click") {
      handleTextClick();
    }
  } finally {
    eventBusy = false;
    void processEvents();
  }
}

function render(): void {
  if (!bridge) return;
  updatePhoneQuestion();
  updatePhoneState();
  if (!client) {
    const body = "Pair in phone\n\nOpen Agent Hub for\nEven G2 on your phone\nto pair or enter a token.";
    if (setPreview("AGENT HUB", body, "Phone setup")) {
      void showPage(textPage(body, "Phone setup"));
    }
    return;
  }
  if (state.screen === "home") {
    const items = [
      `Inbox · ${state.attentionTotal}`,
      "Recent sessions",
      ...(state.sessionTitle
        ? [
            `Current · ${clampLine(
              state.sessionProject
                ? `${state.sessionProject} · ${state.sessionTitle}`
                : state.sessionTitle,
              44,
            )}`,
          ]
        : []),
      ...(state.error ? ["Retry connection"] : []),
    ];
    if (
      setPreview(
        "AGENT HUB",
        items.join("\n"),
        "Tap open   Swipe move",
        items,
      )
    ) {
      void showPage(
        listPage("AGENT HUB", items, "Tap open   Swipe move"),
      );
    }
    return;
  }
  if (state.screen === "sessions") {
    const items = state.sessions.length
      ? state.sessions.map((session) =>
          clampLine(
            `${session.unread ? "UNREAD" : session.status.toUpperCase()} · ${session.title}`,
            54,
          ),
        )
      : [state.error ? "Offline · back to retry" : "No recent sessions"];
    if (
      setPreview(
        `RECENT ${state.sessions.length}`,
        items.join("\n"),
        "Tap open   Swipe move   Back ×2",
        items,
      )
    ) {
      void showPage(
        listPage(
          `RECENT ${state.sessions.length}`,
          items,
          "Tap open   Swipe move   Back ×2",
        ),
      );
    }
    return;
  }
  if (state.screen === "inbox") {
    const items = state.attention.length
      ? state.attention.map((item) =>
          clampLine(
            `${attentionLabel(item)} · ${item.title}`,
            54,
          ),
        )
      : [state.error ? "Offline · double-tap to retry" : "Nothing needs you"];
    if (state.error) items.push("Retry connection");
    if (
      setPreview(
        `ATTENTION ${state.attention.length}`,
        items.join("\n"),
        "Tap open   Swipe move   Back ×2",
        items,
      )
    ) {
      void showPage(
        listPage(
          `ATTENTION ${state.attention.length}`,
          items,
          "Tap open   Swipe move   Back ×2",
        ),
      );
    }
    return;
  }
  if (state.screen === "glass-form") {
    const item = state.selectedAttention;
    if (!item) {
      state.screen = "inbox";
      render();
      return;
    }
    const view = glassFormView(item);
    const header = `FORM · ${clampLine(item.title, 34)}`;
    if (setPreview(header, view.items.join("\n"), view.footer, view.items)) {
      void showPage(listPage(header, view.items, view.footer, item.summary));
    }
    return;
  }
  if (state.screen === "glass-options") {
    const field = state.formOptionsField;
    if (!field) {
      state.screen = "glass-form";
      render();
      return;
    }
    const items = (field.options ?? []).map((option) =>
      clampLine(option.label, 54),
    );
    if (items.length === 0) items.push("No options");
    const header = `SELECT · ${clampLine(field.label, 38)}`;
    if (
      setPreview(
        header,
        items.join("\n"),
        "Tap select   Back ×2",
        items,
      )
    ) {
      void showPage(listPage(header, items, "Tap select   Back ×2"));
    }
    return;
  }
  if (state.screen === "attention") {
    const item = state.selectedAttention;
    if (!item) {
      state.screen = "inbox";
      render();
      return;
    }
    const actions = attentionActions(item);
    const summary = wrapText(item.summary, 54, 2).join("\n");
    if (
      setPreview(
        `${attentionLabel(item)} · ${clampLine(item.title, 35)}`,
        [summary, ...actions.map((action) => clampLine(action.label, 54))].join("\n"),
        "Tap choose   Back ×2",
        actions.map((action) => clampLine(action.label, 54)),
      )
    ) {
      void showPage(
        listPage(
          `${attentionLabel(item)} · ${clampLine(item.title, 35)}`,
          actions.map((action) => clampLine(action.label, 54)),
          "Tap choose   Back ×2",
          summary,
        ),
      );
    }
    return;
  }
  if (
    state.screen === "answer" ||
    state.screen === "answer-more" ||
    state.screen === "answer-confirm"
  ) {
    const question = activeQuestion();
    if (!question) {
      state.screen = "chat";
      render();
      return;
    }

    if (state.screen === "answer-confirm") {
      const header = answerHeader("CONFIRM");
      const text = state.pendingAnswerText ?? "";
      const body = wrapText(`Send this answer?\n“${text}”`, 54, 2).join("\n");
      const items = ["Send", "Cancel"];
      if (setPreview(header, body, "This cannot be undone.", items)) {
        void showPage(listPage(header, items, "This cannot be undone.", body));
      }
      return;
    }

    if (state.screen === "answer-more") {
      const header = answerHeader("MORE");
      const body = clampLine(`Q  ${question.text}`, 54);
      const items = ["More replies", "Read chat", "Stop"];
      if (setPreview(header, body, "Tap choose · Back ×2", items)) {
        void showPage(listPage(header, items, "Tap choose · Back ×2", body));
      }
      return;
    }

    const header = answerHeader();
    const body = answerSummary();
    const rows = answerRows();
    const items = rows.map((row) => row.label);
    const footer = state.answerError
      ? clampLine(`Couldn't send: ${state.answerError}`, 60)
      : "Swipe choose · Tap send · Back ×2";
    if (setPreview(header, body, footer, items)) {
      void showPage(listPage(header, items, footer, body));
    }
    return;
  }
  if (state.screen === "answer-stale") {
    const header = "ANSWER · changed";
    const body =
      state.answerStale === "resolved"
        ? "Answered already.\nRead the latest chat."
        : "Question changed.\nReview before answering.";
    const items =
      state.answerStale === "resolved" ? ["Read chat"] : ["Review", "Read chat"];
    if (setPreview(header, body, "Tap choose · Back ×2", items)) {
      void showPage(listPage(header, items, "Tap choose · Back ×2", body));
    }
    return;
  }
  if (state.screen === "answer-type" || state.screen === "answer-sent") {
    if (state.screen === "answer-type") {
      const header = answerHeader("TYPE");
      const body = "Type on the phone.\nThe answer sends from there.";
      const footer = "Tap to focus phone · Back ×2";
      if (setPreview(header, body, footer)) {
        void showPage(textPage(body, footer, header));
      }
      return;
    }

    const header = answerHeader();
    const body = `Sent\n“${clampLine(state.answerText ?? "", 60)}”`;
    const footer = "Tap to return · Back ×2";
    if (setPreview(header, body, footer)) {
      void showPage(textPage(body, footer, header));
    }
    return;
  }
  if (state.screen === "chat") {
    const view = chatView();
    if (setPreview(view.header, view.body, view.footer)) {
      void showPage(textPage(view.body, view.footer, view.header));
    }
    return;
  }
  if (state.screen === "reply") {
    const view = replyView();
    const items = view.items.map((item) => clampLine(item, 54));
    if (
      setPreview(
        `REPLY ${view.page + 1}/${view.pages}`,
        items.join("\n"),
        "Tap select   Back ×2",
        items,
      )
    ) {
      void showPage(
        listPage(
          `REPLY ${view.page + 1}/${view.pages}`,
          items,
          "Tap select   Back ×2",
          state.notice,
        ),
      );
    }
    return;
  }
  if (state.screen === "choices") {
    const view = choiceView();
    const items = view.items.map((item) => clampLine(item, 54));
    if (
      setPreview(
        `CHOOSE ${view.items.length}`,
        items.join("\n"),
        "Tap select   Back ×2",
        items,
      )
    ) {
      void showPage(
        listPage(
          `CHOOSE ${view.items.length}`,
          items,
          "Tap select   Back ×2",
        ),
      );
    }
  }
}

function setPreview(
  header: string,
  body: string,
  footer: string,
  listItems?: string[],
): boolean {
  const signature = frameSignature(header, body, footer, listItems);
  if (signature === lastGlassSignature) return false;
  lastGlassSignature = signature;
  glassesPreview.textContent = [header, "", body, "", footer].join("\n");
  if (listItems) {
    previewListItems = listItems;
    previewCursor = 0;
    updatePreviewSelection();
  } else {
    previewListItems = undefined;
    previewSelection.textContent = "No list selection";
  }
  return true;
}

function updatePreviewSelection(): void {
  if (!previewListItems || previewListItems.length === 0) {
    previewSelection.textContent = "No list selection";
    return;
  }
  previewCursor = Math.min(
    Math.max(0, previewCursor),
    previewListItems.length - 1,
  );
  previewSelection.textContent = `Preview ${previewCursor + 1}/${previewListItems.length} · ${previewListItems[previewCursor]}`;
}

function simulate(action: "up" | "down" | "click" | "double"): void {
  if (action === "double") {
    back();
    return;
  }
  if (state.screen === "chat") {
    if (action === "up") moveChatLine(-1);
    else if (action === "down") moveChatLine(1);
    else handleTextClick();
    return;
  }
  if (state.screen === "answer-type" || state.screen === "answer-sent") {
    if (action === "click") handleTextClick();
    return;
  }
  if (state.screen === "pairing") {
    phoneText.focus();
    return;
  }
  if (!previewListItems || previewListItems.length === 0) return;
  if (action === "up" || action === "down") {
    previewCursor = Math.min(
      Math.max(0, previewCursor + (action === "up" ? -1 : 1)),
      previewListItems.length - 1,
    );
    updatePreviewSelection();
    return;
  }
  handleListClick(previewCursor);
}

async function showPage(page: RebuildPageContainer): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.rebuildPageContainer(page);
  } catch (error) {
    log(`Display update failed: ${errorMessage(error)}`);
  }
}

function textPage(body: string, footer: string, header?: string): RebuildPageContainer {
  const texts = [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 36,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 1,
      containerName: "header",
      isEventCapture: 0,
      content: header ?? "AGENT HUB",
    }),
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 38,
      width: 576,
      height: 204,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 4,
      paddingLength: 4,
      containerID: 2,
      containerName: "body",
      isEventCapture: 1,
      content: body,
    }),
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 246,
      width: 576,
      height: 42,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 3,
      containerName: "footer",
      isEventCapture: 0,
      content: footer,
    }),
  ];
  return new RebuildPageContainer({ containerTotalNum: 3, textObject: texts });
}

function listPage(
  header: string,
  items: string[],
  footer: string,
  body?: string,
): RebuildPageContainer {
  const headerHeight = 32;
  const bodyHeight = body ? 56 : 0;
  const bodyY = headerHeight;
  const listY = headerHeight + bodyHeight;
  const listHeight = 244 - listY;
  const texts = [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: headerHeight,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 1,
      containerName: "header",
      isEventCapture: 0,
      content: header,
    }),
  ];
  if (body) {
    texts.push(
      new TextContainerProperty({
        xPosition: 0,
        yPosition: bodyY,
        width: 576,
        height: bodyHeight,
        borderWidth: 0,
        borderColor: 5,
        borderRadius: 0,
        paddingLength: 4,
        containerID: 2,
        containerName: "summary",
        isEventCapture: 0,
        content: body,
      }),
    );
  }
  const list = new ListContainerProperty({
    xPosition: 0,
    yPosition: listY,
    width: 576,
    height: listHeight,
    borderWidth: 0,
    borderColor: 5,
    borderRadius: 4,
    paddingLength: 0,
    containerID: body ? 3 : 2,
    containerName: "list",
    isEventCapture: 1,
    itemContainer: new ListItemContainerProperty({
      itemCount: Math.max(1, items.length),
      itemWidth: 568,
      itemName: items.length ? items : ["(empty)"],
      isItemSelectBorderEn: 1,
    }),
  });
  texts.push(
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 246,
      width: 576,
      height: 42,
      borderWidth: 0,
      borderColor: 5,
      borderRadius: 0,
      paddingLength: 4,
      containerID: 4,
      containerName: "footer",
      isEventCapture: 0,
      content: footer,
    }),
  );
  return new RebuildPageContainer({
    containerTotalNum: body ? 4 : 3,
    textObject: texts,
    listObject: [list],
  });
}

function attentionLabel(item: Attention): string {
  switch (item.type) {
    case "permission":
      return "PERMISSION";
    case "approval":
      return "APPROVAL";
    case "question":
      return "QUESTION";
    case "unread":
      return "UNREAD";
    case "error":
      return "ERROR";
    default:
      return "ATTENTION";
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setupPhone(): void {
  byId<HTMLSpanElement>("hub-origin").textContent = hubBaseURL() || "same origin";
  const token = byId<HTMLInputElement>("hub-token");
  if (storedToken) token.placeholder = "Saved token";
  byId<HTMLButtonElement>("connect").addEventListener("click", () => {
    void connect();
  });
  phoneText.addEventListener("input", syncPhoneSession);
  phoneSend.addEventListener("click", () => {
    void sendPhone();
  });
  byId<HTMLButtonElement>("phone-refresh").addEventListener("click", () => {
    void refreshCurrent();
  });
  phoneFormSubmit.addEventListener("click", () => void submitPhoneForm());
  phoneFormCancel.addEventListener("click", () => hidePhoneForm());
  phoneQuestionType.addEventListener("click", () => openTypeAnswer());
  byId<HTMLButtonElement>("sim-up").addEventListener("click", () => simulate("up"));
  byId<HTMLButtonElement>("sim-down").addEventListener("click", () => simulate("down"));
  byId<HTMLButtonElement>("sim-click").addEventListener("click", () => simulate("click"));
  byId<HTMLButtonElement>("sim-double").addEventListener("click", () => simulate("double"));
  syncPhoneSession();
}

async function sendPhone(): Promise<void> {
  const text = phoneText.value.trim();
  if (!text || !client || !state.sessionRef) return;
  phoneSend.disabled = true;

  if (state.answerMode && state.question) {
    await sendAnswer(text, "phone");
    syncPhoneSession();
    return;
  }

  setPhoneStatus("Sending…");
  try {
    await client.sendMessage(state.sessionRef, { text });
    phoneText.value = "";
    setPhoneStatus("Sent.");
    state.screen = "chat";
    await loadChat(false);
    await loadQuestion(state.sessionRef);
  } catch (error) {
    setPhoneStatus(errorMessage(error), true);
  } finally {
    syncPhoneSession();
  }
}

async function refreshCurrent(): Promise<void> {
  if (!client) return;
  if (state.screen === "chat" && state.sessionRef) {
    await loadChat(false);
    await loadQuestion(state.sessionRef);
  } else if (state.screen === "sessions") {
    await openSessions();
  } else {
    await refreshInbox();
    if (state.screen === "home") render();
  }
}

async function init(): Promise<void> {
  setupPhone();
  try {
    const result = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), 2_500),
      ),
    ]);
    if (!result) {
      bridgeStatus.textContent =
        "No Even Hub bridge detected. Open the app through Even Hub or the simulator.";
      log("Bridge not available");
      return;
    }
    bridge = result;
    bridgeStatus.textContent = "Connected to Even Hub bridge.";
    log("Bridge ready");
    await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            borderWidth: 0,
            borderColor: 5,
            borderRadius: 0,
            paddingLength: 4,
            containerID: 1,
            containerName: "body",
            isEventCapture: 1,
            content: "Agent Hub\nConnecting…",
          }),
        ],
      }),
    );
    bridge.onEvenHubEvent(onEvenEvent);
    pollTimer = setInterval(() => {
      if (!client) return;
      if (state.screen === "inbox" || state.screen === "home") {
        void refreshInbox();
      } else if (state.screen === "chat" && state.sessionRef) {
        void loadChat(true);
      }
    }, 4_000);
    await restoreConnection();
  } catch (error) {
    bridgeStatus.textContent = `Bridge error: ${errorMessage(error)}`;
    log(`Bridge error: ${errorMessage(error)}`);
  }
}

window.addEventListener("beforeunload", () => {
  if (pollTimer) clearInterval(pollTimer);
});

void init();
