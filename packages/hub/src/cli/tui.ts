import type { LogRecord } from "../lib/logger";
import {
  boxedPanel,
  formatCountdown,
  formatExpiry,
  pairingUrl,
  primaryPairingUrl,
  renderQrLines,
} from "./pairing-panel";
import {
  center,
  createTheme,
  padEnd,
  padStart,
  truncate,
  visibleWidth,
  wrap,
  type Theme,
} from "./terminal";
import type {
  ActivityItem,
  ActivityTone,
  PairingLinkInfo,
  UiSnapshot,
} from "./types";

export interface TuiOptions {
  version: string;
  color: boolean;
  onQuit: () => void;
  onPair: () => PairingLinkInfo;
  onRefresh: () => void;
  onOpen: (url: string) => void;
  snapshot: () => UiSnapshot;
}

interface SetupInfo {
  configPath: string;
  ownerToken?: string;
}

type PairingState = "active" | "paired" | "expired";

const MAX_ACTIVITY = 100;
const MAX_LOGS = 500;

function toneColor(theme: Theme, tone: ActivityTone | undefined): (value: string) => string {
  switch (tone) {
    case "success":
      return theme.success;
    case "warning":
      return theme.warning;
    case "danger":
      return theme.danger;
    case "muted":
      return theme.muted;
    default:
      return (value) => value;
  }
}

function leftRight(left: string, right: string, width: number): string {
  const fittedRight = truncate(right, Math.max(0, width - 1));
  const available = Math.max(0, width - visibleWidth(fittedRight) - 1);
  return `${padEnd(truncate(left, available), available)} ${fittedRight}`;
}

function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatUptime(startedAt: number, now = Date.now()): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatFields(record: LogRecord): string {
  return Object.entries(record)
    .filter(([key]) => !["time", "level", "msg", "requestId"].includes(key))
    .slice(0, 3)
    .map(([key, value]) => {
      const text =
        typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
      return `${key}=${text.replace(/\s+/g, " ")}`;
    })
    .join(" ");
}

export class TerminalUi {
  private readonly theme: Theme;
  private active = false;
  private pairing?: PairingLinkInfo;
  private pairingState: PairingState = "active";
  private setup?: SetupInfo;
  private help = false;
  private logsView = false;
  private logs: LogRecord[] = [];
  private activity: ActivityItem[] = [];
  private notice?: string;
  private logScroll = 0;
  private providerStatuses = new Map<string, string>();
  private lastAttention?: number;
  private renderTimer?: NodeJS.Timeout;
  private tickTimer?: NodeJS.Timeout;
  private noticeTimer?: NodeJS.Timeout;
  private readonly onKey = (data: Buffer | string) => this.handleKey(data.toString());
  private readonly onResize = () => this.render();

  constructor(private readonly options: TuiOptions) {
    this.theme = createTheme(options.color);
  }

  get started(): boolean {
    return this.active;
  }

  start(): boolean {
    if (this.active) return true;
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

    process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H");
    try {
      process.stdin.setRawMode(true);
    } catch {
      process.stdout.write("\x1b[?25h\x1b[?1049l");
      return false;
    }

    this.active = true;
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", this.onKey);
    process.stdout.on("resize", this.onResize);
    this.tickTimer = setInterval(() => this.tick(), 1_000);
    this.render();
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.renderTimer) clearTimeout(this.renderTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    process.stdin.off("data", this.onKey);
    process.stdout.off("resize", this.onResize);
    try {
      process.stdin.setRawMode(false);
    } catch {
      // The terminal may already be gone.
    }
    process.stdin.pause();
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }

  addActivity(item: ActivityItem): void {
    this.activity.push(item);
    while (this.activity.length > MAX_ACTIVITY) this.activity.shift();
    this.scheduleRender();
  }

  addLog(record: LogRecord): void {
    this.logs.push(record);
    while (this.logs.length > MAX_LOGS) this.logs.shift();

    if (record.level === "warn" || record.level === "error") {
      this.addActivity({
        at: Date.parse(record.time) || Date.now(),
        label: record.msg,
        detail:
          typeof record.error === "string"
            ? record.error
            : typeof record.message === "string"
              ? record.message
              : undefined,
        tone: record.level === "error" ? "danger" : "warning",
      });
    }

    if (record.msg === "pairing redeemed") {
      if (this.pairing) this.pairingState = "paired";
      this.addActivity({
        at: Date.parse(record.time) || Date.now(),
        label: "pairing",
        detail: "device paired",
        tone: "success",
      });
      this.scheduleRender();
    }

    if (record.msg === "pairing issued") {
      this.addActivity({
        at: Date.parse(record.time) || Date.now(),
        label: "pairing",
        detail: "link issued",
        tone: "muted",
      });
      this.scheduleRender();
    }
  }

  showSetup(info: SetupInfo): void {
    this.setup = info;
    this.pairing = undefined;
    this.help = false;
    this.logsView = false;
    this.scheduleRender();
  }

  showPairing(pairing: PairingLinkInfo): void {
    this.pairing = pairing;
    this.pairingState = "active";
    this.setup = undefined;
    this.help = false;
    this.logsView = false;
    this.scheduleRender();
  }

  notify(message: string): void {
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = undefined;
      this.scheduleRender();
    }, 2_000);
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (!this.active || this.renderTimer) return;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.render();
    }, 30);
  }

  private tick(): void {
    if (this.pairing && this.pairingState === "active" && Date.now() >= this.pairing.expiresAt) {
      this.pairingState = "expired";
      this.notify("Pairing link expired. Press p for a new one.");
    }

    const snapshot = this.options.snapshot();
    for (const provider of snapshot.providers) {
      const previous = this.providerStatuses.get(provider.id);
      if (
        (previous !== undefined && previous !== provider.status) ||
        (previous === undefined && provider.status !== "unknown")
      ) {
        this.addActivity({
          at: Date.now(),
          label: provider.id,
          detail: provider.status,
          tone:
            provider.status === "online"
              ? "success"
              : provider.status === "auth-error"
                ? "danger"
                : "warning",
        });
      }
      this.providerStatuses.set(provider.id, provider.status);
    }

    if (this.lastAttention === undefined) {
      if (snapshot.attention > 0) {
        this.addActivity({
          at: Date.now(),
          label: "attention",
          detail: `${snapshot.attention} item${snapshot.attention === 1 ? "" : "s"}`,
          tone: "warning",
        });
      }
    } else if (this.lastAttention !== snapshot.attention) {
      this.addActivity({
        at: Date.now(),
        label: "attention",
        detail: `${snapshot.attention} item${snapshot.attention === 1 ? "" : "s"}`,
        tone: snapshot.attention > this.lastAttention ? "warning" : "success",
      });
    }
    this.lastAttention = snapshot.attention;

    this.render();
  }

  private handleKey(data: string): void {
    if (data === "\u0003") {
      this.quit();
      return;
    }

    if (data === "\u001b[A" || data === "\u001bOA") {
      if (this.logsView && !this.pairing && !this.help && !this.setup) {
        this.logScroll += 1;
        this.render();
      }
      return;
    }
    if (data === "\u001b[B" || data === "\u001bOB") {
      if (this.logsView && !this.pairing && !this.help && !this.setup) {
        this.logScroll = Math.max(0, this.logScroll - 1);
        this.render();
      }
      return;
    }
    if (data === "\u001b") {
      if (this.setup) {
        this.setup = undefined;
      } else if (this.pairing) {
        this.pairing = undefined;
      } else if (this.help) {
        this.help = false;
      } else if (this.logsView) {
        this.logsView = false;
      }
      this.render();
      return;
    }

    for (const key of data) {
      if (key === "p") {
        if (this.help) continue;
        this.openPairing();
        continue;
      }

      if (key === "l") {
        if (this.pairing || this.help || this.setup) continue;
        this.logsView = !this.logsView;
        this.logScroll = 0;
        this.render();
        continue;
      }

      if (key === "r") {
        if (this.pairing || this.help || this.setup) continue;
        this.options.onRefresh();
        this.notify("Refreshing providers…");
        continue;
      }

      if (key === "c") {
        if (this.setup?.ownerToken) {
          this.copy(this.setup.ownerToken, "Owner token copied");
          continue;
        }
        if (this.pairing && this.pairingState === "active") {
          const url = this.pairingUrl();
          if (url) this.copy(url, "Pairing link copied");
          continue;
        }
      }

      if (key === "o" || key === "\r") {
        if (this.pairing && this.pairingState === "active") {
          const url = this.pairingUrl();
          if (url) this.options.onOpen(url);
          continue;
        }
        if (!this.pairing && !this.help && !this.setup) {
          const snapshot = this.options.snapshot();
          if (snapshot.hasWebRoot) {
            this.options.onOpen(snapshot.webUrl ?? `http://${snapshot.host}:${snapshot.port}`);
          } else {
            this.notify("Web UI is not built; nothing to open.");
          }
          continue;
        }
      }

      if (key === "?") {
        if (this.pairing || this.setup) continue;
        this.help = !this.help;
        this.render();
        continue;
      }

      if (this.logsView && (key === "j" || key === "k")) {
        if (key === "j") this.logScroll = Math.max(0, this.logScroll - 1);
        else this.logScroll += 1;
        this.render();
      }
    }
  }

  private quit(): void {
    this.stop();
    this.options.onQuit();
  }

  private openPairing(): void {
    this.showPairing(this.options.onPair());
    this.addActivity({
      at: Date.now(),
      label: "pairing",
      detail: "link issued",
      tone: "muted",
    });
  }

  private pairingUrl(): string | undefined {
    if (!this.pairing) return undefined;
    const snapshot = this.options.snapshot();
    const base = primaryPairingUrl(snapshot.urls);
    return base ? pairingUrl(base, this.pairing.code) : undefined;
  }

  private copy(value: string, message: string): void {
    process.stdout.write(
      `\x1b]52;c;${Buffer.from(value).toString("base64")}\x07`,
    );
    this.notify(message);
  }

  private render(): void {
    if (!this.active) return;

    const columns = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    if (columns < 50 || rows < 16) {
      this.writeFrame([
        "",
        center(this.theme.bold("Agent Hub"), columns),
        center(
          this.theme.muted("Terminal is too small for the dashboard."),
          columns,
        ),
        center(this.theme.muted("Resize, or run with --plain."), columns),
        "",
      ]);
      return;
    }

    if (this.setup) {
      this.writeFrame(this.setupFrame(columns, rows));
      return;
    }
    if (this.help) {
      this.writeFrame(this.helpFrame(columns, rows));
      return;
    }
    if (this.pairing) {
      this.writeFrame(this.pairingFrame(columns, rows));
      return;
    }

    this.writeFrame(this.dashboardFrame(columns, rows));
  }

  private dashboardFrame(columns: number, rows: number): string[] {
    const snapshot = this.options.snapshot();
    const header = boxedPanel({
      width: columns,
      title: "Agent Hub",
      right: `v${snapshot.version}`,
      theme: this.theme,
      lines: [
        leftRight(
          snapshot.webUrl ?? `http://${snapshot.host}:${snapshot.port}`,
          `up ${formatUptime(snapshot.startedAt)}  ${snapshot.storage}`,
          columns - 4,
        ),
      ],
    });

    const online = snapshot.providers.filter((provider) => provider.status === "online").length;
    const status = [
      leftRight(
        `Providers ${online}/${snapshot.providers.length}   Sessions ${snapshot.sessions}   Attention ${snapshot.attention}`,
        `${snapshot.subscribers} SSE`,
        columns,
      ),
      leftRight(
        `Event ${snapshot.eventSeq}   Requests ${snapshot.requests}   Errors ${snapshot.errors}`,
        this.notice ?? this.theme.muted("p pair · ? help"),
        columns,
      ),
    ];

    const footer = this.logsView
      ? columns < 64
        ? "l close · j/k · ^C quit"
        : "l close · j/k scroll · ^C quit"
      : columns < 64
        ? "p pair · l logs · ^C quit · ? help"
        : "p pair · l logs · r refresh · o open · ^C quit · ? help";

    const bodyRows = Math.max(1, rows - header.length - status.length - 3);
    const body: string[] = [];
    const title = this.logsView ? "Logs" : "Activity";

    body.push(this.theme.muted(title));
    const available = bodyRows - 1;

    if (this.logsView) {
      const all = this.logs;
      const end = Math.max(0, all.length - this.logScroll);
      const start = Math.max(0, end - available);
      const slice = all.slice(start, end);
      if (slice.length === 0) {
        body.push(this.theme.muted("No log records yet."));
      } else {
        for (const record of slice) {
          body.push(this.logLine(record, columns));
        }
      }
    } else {
      const slice = available > 0 ? this.activity.slice(-available) : [];
      if (slice.length === 0) {
        body.push(this.theme.muted("Waiting for activity. Press p to pair a device."));
      } else {
        for (const item of slice) {
          body.push(this.activityLine(item, columns));
        }
      }
    }

    while (body.length < bodyRows) body.push("");

    return [
      ...header,
      ...status,
      this.theme.muted("─".repeat(columns)),
      ...body.slice(0, bodyRows),
      this.theme.muted("─".repeat(columns)),
      truncate(footer, columns),
    ];
  }

  private activityLine(item: ActivityItem, columns: number): string {
    const time = this.theme.muted(formatClock(item.at));
    const label = toneColor(this.theme, item.tone)(
      padEnd(truncate(item.label, 14), 14),
    );
    const detailWidth = Math.max(0, columns - 24);
    const detail = truncate(
      (item.detail ?? "").replace(/\s+/g, " "),
      detailWidth,
    );
    return `${time} ${label} ${detail}`;
  }

  private logLine(record: LogRecord, columns: number): string {
    const level = this.theme.muted(padEnd(record.level, 5));
    const time = this.theme.muted(formatClock(Date.parse(record.time) || Date.now()));
    const fields = formatFields(record);
    const message = `${record.msg.replace(/\s+/g, " ")}${fields ? `  ${fields}` : ""}`;
    return `${time} ${level} ${truncate(message, Math.max(0, columns - 15))}`;
  }

  private setupFrame(columns: number, rows: number): string[] {
    const width = Math.min(columns - 4, 64);
    const inner = width - 4;
    const info = this.setup!;
    const lines: string[] = [
      "Config created",
      truncate(info.configPath, inner),
      "",
      "Owner token (shown once):",
      ...(info.ownerToken
        ? wrap(info.ownerToken, inner)
        : ["Provided by HUB_TOKEN."]),
      "",
      "Save this token. It is also in the config file.",
      "Press p to pair a device, or esc to continue.",
      info.ownerToken
        ? "c copy token · p pair · esc close"
        : "p pair · esc close",
    ];

    const panel = boxedPanel({
      lines,
      width,
      title: "Setup",
      right: "first run",
      theme: this.theme,
    });
    return this.centerPanel(panel, columns, rows);
  }

  private helpFrame(columns: number, rows: number): string[] {
    const width = Math.min(columns - 4, 58);
    const panel = boxedPanel({
      lines: [
        "p      pair a device",
        "l      toggle activity / logs",
        "j / k  scroll logs",
        "r      re-check providers",
        "o      open the web UI or pairing link",
        "c      copy link or owner token",
        "esc    close this help",
        "Ctrl+C quit",
      ],
      width,
      title: "Keys",
      theme: this.theme,
    });
    return this.centerPanel(panel, columns, rows);
  }

  private pairingFrame(columns: number, rows: number): string[] {
    const width = Math.min(columns - 4, 64);
    const inner = width - 4;
    const snapshot = this.options.snapshot();
    const base = primaryPairingUrl(snapshot.urls);
    const link = base && this.pairing
      ? pairingUrl(base, this.pairing.code)
      : undefined;

    if (this.pairingState === "paired") {
      const panel = boxedPanel({
        lines: [
          "Paired.",
          "This browser now has a 30-day session cookie.",
          "",
          "esc close",
        ],
        width,
        title: "Pair a device",
        right: "paired",
        theme: this.theme,
      });
      return this.centerPanel(panel, columns, rows);
    }

    if (this.pairingState === "expired" || !link) {
      const panel = boxedPanel({
        lines: [
          link ?? "No server URLs available.",
          "",
          "Expired. Press p for a new link.",
          "c copy · p new · esc close",
        ],
        width,
        title: "Pair a device",
        right: "expired",
        theme: this.theme,
      });
      return this.centerPanel(panel, columns, rows);
    }

    const qr = renderQrLines(link, Math.max(18, inner - 2));
    const expires = formatExpiry(this.pairing!.expiresAt);
    const topLines = [
      truncate(link, inner),
      `Expires at ${expires}`,
    ];

    let lines: string[];
    if (qr) {
      const qrWidth = Math.max(...qr.map((line) => visibleWidth(line)));
      const textWidth = inner - qrWidth - 2;
      const right = [
        ...wrap("Scan with your phone camera or open the link.", textWidth),
        "",
        ...wrap("c copy · p new · o open · esc close", textWidth),
      ];
      const side: string[] = [];
      const height = Math.max(qr.length, right.length);
      for (let index = 0; index < height; index += 1) {
        side.push(
          `${padEnd(qr[index] ?? "", qrWidth)}  ${right[index] ?? ""}`,
        );
      }
      lines = [...topLines, ...side];
    } else {
      lines = [
        ...topLines,
        "",
        "QR hidden: terminal is too narrow.",
        "c copy · p new · o open · esc close",
      ];
    }

    let panel = boxedPanel({
      lines,
      width,
      title: "Pair a device",
      right: formatCountdown(this.pairing!.expiresAt),
      theme: this.theme,
    });

    if (panel.length > rows - 2) {
      const compact = [
        truncate(link, inner),
        `Expires at ${expires}`,
        "",
        "QR hidden to fit this terminal. Use the link.",
        "",
        "c copy · p new · o open · esc close",
      ];
      panel = boxedPanel({
        lines: compact,
        width,
        title: "Pair a device",
        right: formatCountdown(this.pairing!.expiresAt),
        theme: this.theme,
      });
    }

    return this.centerPanel(panel, columns, rows);
  }

  private centerPanel(panel: string[], columns: number, rows: number): string[] {
    const top = Math.max(0, Math.floor((rows - panel.length) / 2));
    const lines: string[] = [];
    for (let index = 0; index < top; index += 1) lines.push("");
    for (const line of panel) lines.push(center(line, columns));
    return lines;
  }

  private writeFrame(lines: string[]): void {
    const rows = process.stdout.rows || 24;
    const frame: string[] = ["\x1b[H"];
    for (let index = 0; index < rows; index += 1) {
      frame.push(`${lines[index] ?? ""}\x1b[K`);
      if (index < rows - 1) frame.push("\n");
    }
    frame.push("\x1b[J");
    process.stdout.write(frame.join(""));
  }
}
