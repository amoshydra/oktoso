import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import type {
  Attention,
  Message,
  ReplyOption,
} from "@agent-hub/contracts";
import { HubClient, messageFromHubEvent } from "@agent-hub/client";
import {
  clampLine,
  pageChoices,
  wrapText,
} from "@agent-hub/wearable-core";

const TOKEN_KEY = "agent-hub-even-g2-token";
const URL_KEY = "agent-hub-even-g2-url";

type Screen =
  | "pairing"
  | "inbox"
  | "attention"
  | "chat"
  | "reply"
  | "choices";

interface AppState {
  screen: Screen;
  attention: Attention[];
  selectedAttention?: Attention;
  sessionRef?: string;
  sessionTitle?: string;
  chatMessages: Message[];
  chatLines: string[];
  chatOffset: number;
  chatFollowBottom: boolean;
  replyOptions: ReplyOption[];
  replyPage: number;
  choiceOptions: ReplyOption[];
  choicePage: number;
  notice?: string;
  error?: string;
}

const state: AppState = {
  screen: "pairing",
  attention: [],
  chatMessages: [],
  chatLines: [],
  chatOffset: 0,
  chatFollowBottom: false,
  replyOptions: [],
  replyPage: 0,
  choiceOptions: [],
  choicePage: 0,
};

let bridge: EvenAppBridge | undefined;
let client: HubClient | undefined;
let storedToken = localStorage.getItem(TOKEN_KEY) ?? "";
let storedBaseURL = localStorage.getItem(URL_KEY) ?? "";
let pollTimer: ReturnType<typeof setInterval> | undefined;
const CHAT_VISIBLE_LINES = 6;
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

const phoneSession = byId<HTMLSpanElement>("phone-session");
const phoneText = byId<HTMLTextAreaElement>("phone-text");
const phoneSend = byId<HTMLButtonElement>("phone-send");
const phoneStatus = byId<HTMLDivElement>("phone-status");
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

function syncPhoneSession(): void {
  const hasSession = Boolean(state.sessionRef);
  phoneSession.textContent = hasSession
    ? clampLine(state.sessionTitle ?? state.sessionRef ?? "", 48)
    : "No session open";
  phoneSend.disabled = !hasSession || !phoneText.value.trim();
}

function updatePhoneState(): void {
  syncPhoneSession();
}

async function connect(): Promise<void> {
  const urlInput = byId<HTMLInputElement>("hub-url");
  const tokenInput = byId<HTMLInputElement>("hub-token");
  const baseUrl = (urlInput.value.trim() || storedBaseURL).replace(/\/+$/, "");
  const token = tokenInput.value.trim() || storedToken;
  if (!token) {
    setConnection("Token required", true);
    return;
  }
  setConnection("Connecting…");
  const next = new HubClient({ baseUrl, token });
  try {
    await next.authCheck();
    client = next;
    storedToken = token;
    storedBaseURL = baseUrl;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(URL_KEY, baseUrl);
    tokenInput.value = "";
    tokenInput.placeholder = "Saved token";
    setConnection("Connected");
    log("Hub connected");
    startEventStream();
    await refreshInbox();
  } catch (error) {
    client = undefined;
    setConnection("Connection failed", true);
    log(`Connect failed: ${errorMessage(error)}`);
    render();
  }
}

async function restoreConnection(): Promise<void> {
  if (!storedToken) {
    render();
    return;
  }
  setConnection("Restoring…");
  const next = new HubClient({ baseUrl: storedBaseURL, token: storedToken });
  try {
    await next.authCheck();
    client = next;
    byId<HTMLInputElement>("hub-url").value = storedBaseURL;
    byId<HTMLInputElement>("hub-token").placeholder = "Saved token";
    setConnection("Connected");
    log("Restored hub session");
    startEventStream();
    await refreshInbox();
  } catch (error) {
    client = undefined;
    setConnection("Reconnect in phone", true);
    log(`Restore failed: ${errorMessage(error)}`);
    render();
  }
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

async function refreshInbox(): Promise<void> {
  if (!client) {
    render();
    return;
  }
  const previousScreen = state.screen;
  const previousSignature = attentionListSignature(state.attention);
  const previousError = state.error;
  try {
    const page = await client.attention();
    state.attention = page.data.slice(0, 5);
    state.error = undefined;
    if (state.screen === "pairing" || state.screen === "inbox") {
      state.screen = "inbox";
    }
    const changed =
      previousScreen !== state.screen ||
      previousSignature !== attentionListSignature(state.attention) ||
      Boolean(previousError) !== false;
    updatePhoneState();
    if (changed) render();
  } catch (error) {
    state.error = errorMessage(error);
    if (state.screen === "pairing") state.screen = "inbox";
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
  render();
}

function attentionActions(item: Attention): Array<{ id: string; label: string }> {
  const actions = item.actions
    .filter((action) => action.id !== "answer" || !(item.fields?.length ?? 0))
    .map((action) => ({ id: action.id, label: action.label }));
  actions.push({ id: "open_chat", label: "Open chat" });
  return actions;
}

async function performAttention(index: number): Promise<void> {
  const item = state.selectedAttention;
  if (!item) return;
  const action = attentionActions(item)[index];
  if (!action) return;
  if (action.id === "open_chat") {
    await openChat(item.sessionRef, item.title);
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

async function openChat(ref: string, title: string): Promise<void> {
  chatLoadSequence += 1;
  state.sessionRef = ref;
  state.sessionTitle = title;
  state.chatMessages = [];
  state.chatLines = [];
  state.chatOffset = 0;
  state.chatFollowBottom = false;
  state.screen = "chat";
  state.error = undefined;
  state.notice = undefined;
  updatePhoneState();
  await loadChat(false);
}

async function loadChat(quiet: boolean): Promise<void> {
  if (!client || !state.sessionRef) return;
  const ref = state.sessionRef;
  const sequence = ++chatLoadSequence;
  try {
    const messages = await loadReadableMessages(ref);
    if (sequence !== chatLoadSequence || state.sessionRef !== ref) return;
    state.chatMessages = mergeChatMessages(state.chatMessages, messages);
    const built = buildChat(state.chatMessages);
    const previousLines = state.chatLines;
    const previousOffset = state.chatOffset;
    const previousMax = Math.max(0, previousLines.length - CHAT_VISIBLE_LINES);
    state.chatLines = built.lines;
    const nextMax = Math.max(0, state.chatLines.length - CHAT_VISIBLE_LINES);
    if (!quiet) state.chatFollowBottom = false;
    state.chatOffset = quiet
      ? state.chatFollowBottom
        ? nextMax
        : Math.min(previousOffset, nextMax)
      : Math.min(built.contextStart, nextMax);
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
  state.chatMessages = mergeChatMessages(state.chatMessages, [message]);
  const built = buildChat(state.chatMessages);
  const previousLines = state.chatLines;
  const previousOffset = state.chatOffset;
  state.chatLines = built.lines;
  const nextMax = Math.max(0, state.chatLines.length - CHAT_VISIBLE_LINES);
  state.chatOffset = state.chatFollowBottom
    ? nextMax
    : Math.min(previousOffset, nextMax);
  const changed =
    previousLines.length !== state.chatLines.length ||
    previousLines.some((line, index) => line !== state.chatLines[index]);
  if (changed || previousOffset !== state.chatOffset) {
    void updateChatView();
  }
  updatePhoneState();
}

function mergeChatMessages(
  current: Message[],
  incoming: Message[],
): Message[] {
  const byID = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byID.set(message.id, message);
  return [...byID.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
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

function buildChat(messages: Message[]): {
  lines: string[];
  contextStart: number;
} {
  if (messages.length === 0) return { lines: ["No messages yet."], contextStart: 0 };
  const lines: string[] = [];
  let latestUserStart = 0;
  let latestAssistantStart: number | undefined;
  for (const message of messages) {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) continue;
    if (message.role === "user") latestUserStart = lines.length;
    if (message.role === "assistant") latestAssistantStart = lines.length;
    lines.push(message.role.toUpperCase());
    lines.push(...wrapText(text, 52, Number.MAX_SAFE_INTEGER));
    lines.push("");
  }
  if (lines.length === 0) return { lines: ["No readable text."], contextStart: 0 };
  return {
    lines,
    contextStart: latestAssistantStart ?? latestUserStart,
  };
}

function chatView(): { header: string; body: string; footer: string } {
  const total = state.chatLines.length;
  const maxOffset = Math.max(0, total - CHAT_VISIBLE_LINES);
  const offset = Math.min(Math.max(0, state.chatOffset), maxOffset);
  state.chatOffset = offset;
  const visible = state.chatLines.slice(offset, offset + CHAT_VISIBLE_LINES);
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(total, offset + CHAT_VISIBLE_LINES);
  const footer =
    total <= CHAT_VISIBLE_LINES
      ? "Swipe up/down · Back ×2"
      : offset >= maxOffset
        ? `${first}-${last}/${total} · Swipe up`
        : offset === 0
          ? `${first}-${last}/${total} · Swipe down`
          : `${first}-${last}/${total} · Swipe`;
  return {
    header: clampLine(state.sessionTitle ?? "Session", 40),
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
  state.chatFollowBottom = next >= maxOffset;
  if (next === state.chatOffset) return;
  state.chatOffset = next;
  void updateChatView();
}

async function openReply(): Promise<void> {
  if (!client || !state.sessionRef) return;
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
  if (state.screen === "attention" || state.screen === "chat") {
    state.screen = "inbox";
    state.selectedAttention = undefined;
    state.notice = undefined;
    render();
    return;
  }
  if (state.screen === "reply" || state.screen === "choices") {
    state.screen = "chat";
    state.notice = undefined;
    render();
  }
}

function handleListClick(index: number): void {
  switch (state.screen) {
    case "inbox":
      if (state.attention.length === 0 && state.error) {
        void refreshInbox();
      } else {
        void openAttention(index);
      }
      break;
    case "attention":
      void performAttention(index);
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
    void openReply();
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
    const type =
      event?.sysEvent?.eventType ??
      event?.textEvent?.eventType ??
      event?.listEvent?.eventType;
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      back();
    } else if (
      type === OsEventTypeList.SCROLL_TOP_EVENT ||
      type === OsEventTypeList.SCROLL_BOTTOM_EVENT
    ) {
      if (state.screen === "chat") {
        moveChatLine(type === OsEventTypeList.SCROLL_TOP_EVENT ? -1 : 1);
      }
    } else if (event?.listEvent) {
      const eventType = event.listEvent.eventType ?? OsEventTypeList.CLICK_EVENT;
      if (eventType === OsEventTypeList.CLICK_EVENT) {
        handleListClick(event.listEvent.currentSelectItemIndex ?? 0);
      }
    } else if (event?.textEvent?.eventType === OsEventTypeList.CLICK_EVENT) {
      handleTextClick();
    }
  } finally {
    eventBusy = false;
    void processEvents();
  }
}

function render(): void {
  if (!bridge) return;
  if (!client) {
    const body = "AGENT HUB\n\nPair in phone\n\nOpen Agent Hub for\nEven G2 on your phone\nto enter the hub token.";
    if (setPreview("AGENT HUB", body, "Phone setup")) {
      void showPage(textPage(body, "Phone setup"));
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
  const signature = [
    listItems ? "list" : "text",
    header,
    body,
    footer,
    listItems?.join("\u001f") ?? "",
  ].join("\u001e");
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
    else void openReply();
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
  const headerHeight = body ? 24 : 32;
  const bodyHeight = body ? 44 : 0;
  const listY = 24 + bodyHeight;
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
        yPosition: 24,
        width: 576,
        height: 44,
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
  const url = byId<HTMLInputElement>("hub-url");
  url.value = storedBaseURL;
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
  setPhoneStatus("Sending…");
  try {
    await client.sendMessage(state.sessionRef, { text });
    phoneText.value = "";
    setPhoneStatus("Sent.");
    state.screen = "chat";
    await loadChat(false);
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
  } else {
    await refreshInbox();
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
      if (state.screen === "inbox") {
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
