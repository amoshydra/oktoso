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
import { HubClient } from "@agent-hub/client";
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
  chatText: string;
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
  chatText: "",
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
let eventQueue: any[] = [];
let eventBusy = false;

const phoneSession = byId<HTMLSpanElement>("phone-session");
const phoneText = byId<HTMLTextAreaElement>("phone-text");
const phoneSend = byId<HTMLButtonElement>("phone-send");
const phoneStatus = byId<HTMLDivElement>("phone-status");
const connection = byId<HTMLSpanElement>("connection");
const connectionStatus = byId<HTMLDivElement>("connection-status");
const bridgeStatus = byId<HTMLParagraphElement>("bridge-status");
const debug = byId<HTMLPreElement>("debug");
const glassesPreview = byId<HTMLPreElement>("glasses-preview");

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
    await refreshInbox();
  } catch (error) {
    client = undefined;
    setConnection("Reconnect in phone", true);
    log(`Restore failed: ${errorMessage(error)}`);
    render();
  }
}

async function refreshInbox(): Promise<void> {
  if (!client) {
    render();
    return;
  }
  try {
    const page = await client.attention();
    state.attention = page.data.slice(0, 5);
    state.error = undefined;
    if (state.screen === "pairing" || state.screen === "inbox") {
      state.screen = "inbox";
    }
    render();
    updatePhoneState();
  } catch (error) {
    state.error = errorMessage(error);
    if (state.screen === "pairing") state.screen = "inbox";
    render();
    log(`Inbox refresh failed: ${state.error}`);
  }
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
  state.sessionRef = ref;
  state.sessionTitle = title;
  state.screen = "chat";
  state.error = undefined;
  state.notice = undefined;
  updatePhoneState();
  await loadChat(false);
}

async function loadChat(quiet: boolean): Promise<void> {
  if (!client || !state.sessionRef) return;
  try {
    const page = await client.messages(state.sessionRef, {
      limit: 8,
      order: "desc",
    });
    const messages = [...page.data].reverse();
    state.chatText = formatChat(messages);
    state.error = undefined;
    if (quiet && bridge && state.screen === "chat") {
      await updateChatBody();
      return;
    }
    render();
    updatePhoneState();
  } catch (error) {
    state.error = errorMessage(error);
    render();
    log(`Chat load failed: ${state.error}`);
  }
}

function formatChat(messages: Message[]): string {
  if (messages.length === 0) return "No messages yet.";
  const recent = messages.slice(-4);
  const blocks = recent.map((message) => {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) return "";
    return `${message.role.toUpperCase()}\n${wrapText(text, 52, 3).join("\n")}`;
  });
  return blocks.filter(Boolean).join("\n\n").slice(0, 1_100) || "No readable text.";
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
    setPreview("AGENT HUB", body, "Phone setup");
    void showPage(textPage(body, "Phone setup"));
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
    setPreview(`ATTENTION ${state.attention.length}`, items.join("\n"), "Tap open   Swipe move   Back ×2");
    void showPage(
      listPage(
        `ATTENTION ${state.attention.length}`,
        items,
        "Tap open   Swipe move   Back ×2",
      ),
    );
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
    setPreview(
      `${attentionLabel(item)} · ${clampLine(item.title, 35)}`,
      [summary, ...actions.map((action) => clampLine(action.label, 54))].join("\n"),
      "Tap choose   Back ×2",
    );
    void showPage(
      listPage(
        `${attentionLabel(item)} · ${clampLine(item.title, 35)}`,
        actions.map((action) => clampLine(action.label, 54)),
        "Tap choose   Back ×2",
        summary,
      ),
    );
    return;
  }
  if (state.screen === "chat") {
    const header = clampLine(state.sessionTitle ?? "Session", 40);
    const footer = state.notice
      ? clampLine(`✓ ${state.notice}`, 54)
      : state.error
        ? clampLine(`Offline: ${state.error}`, 54)
        : "Tap reply   Back ×2";
    setPreview(header, state.chatText, footer);
    void showPage(textPage(state.chatText, footer, header));
    return;
  }
  if (state.screen === "reply") {
    const view = replyView();
    const items = view.items.map((item) => clampLine(item, 54));
    setPreview(`REPLY ${view.page + 1}/${view.pages}`, items.join("\n"), "Tap select   Back ×2");
    void showPage(
      listPage(
        `REPLY ${view.page + 1}/${view.pages}`,
        items,
        "Tap select   Back ×2",
        state.notice,
      ),
    );
    return;
  }
  if (state.screen === "choices") {
    const view = choiceView();
    const items = view.items.map((item) => clampLine(item, 54));
    setPreview(`CHOOSE ${view.items.length}`, items.join("\n"), "Tap select   Back ×2");
    void showPage(
      listPage(
        `CHOOSE ${view.items.length}`,
        items,
        "Tap select   Back ×2",
      ),
    );
  }
}

function setPreview(header: string, body: string, footer: string): void {
  glassesPreview.textContent = [header, "", body, "", footer].join("\n");
}

async function showPage(page: RebuildPageContainer): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.rebuildPageContainer(page);
  } catch (error) {
    log(`Display update failed: ${errorMessage(error)}`);
  }
}

async function updateChatBody(): Promise<void> {
  if (!bridge) return;
  try {
    await bridge.textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 2,
        containerName: "body",
        content: state.chatText,
      }),
    );
  } catch (error) {
    log(`Transcript update failed: ${errorMessage(error)}`);
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
