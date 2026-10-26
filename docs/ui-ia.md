# Agent Hub UI and Information Architecture

> Status: frozen in [`design-v1`](design-lock.md) on 2026-10-26, with the `design-v1.1` session transcript revision on 2026-10-27. Changes to this document follow the design lock policy.

This document defines what the hub looks like, how it is organized, and how the same information architecture adapts to desktop, mobile, glasses, and VR.

The interactive prototype lives in `docs/prototypes/index.html`.

## 1. Design brief

The hub answers three questions quickly:

1. What needs me now?
2. What was I working on?
3. How do I reply without switching tools?

The interface should feel like a workbench, not a marketing dashboard. Dense enough to scan many sessions, calm enough to read long agent replies, and fast enough to use from a phone or glasses.

### Primary users

- A developer running agents on a desktop, laptop, Raspberry Pi, and phone.
- A person who checks in from mobile and wants to approve or answer without opening each provider.
- A glasses or VR user who needs a glanceable inbox and short replies.

### Jobs

- Triage approvals and questions.
- Find a session by provider, project, or recency.
- Read a reply and send a follow-up.
- Start a new session with the right provider, project, agent, and model.
- Move between devices without losing read state or drafts.
- See when a provider is offline or needs authentication.

## 2. Information architecture

```text
Agent Hub
├─ Inbox
│  ├─ Needs approval
│  ├─ Needs an answer
│  ├─ Unread replies
│  └─ Errors
├─ Sessions
│  ├─ All sessions
│  ├─ By provider
│  ├─ By project
│  ├─ Active
│  └─ Archived
├─ Session
│  ├─ Transcript
│  ├─ Composer
│  ├─ Attention card
│  ├─ Details
│  └─ Actions
├─ New session
│  ├─ Provider
│  ├─ Project
│  ├─ Agent
│  ├─ Model
│  └─ First prompt
├─ Search
│  ├─ Sessions
│  ├─ Messages (later)
│  └─ Filters
├─ Providers
│  ├─ Connection
│  ├─ Health
│  ├─ Capabilities
│  └─ Models
└─ Settings
   ├─ Appearance
   ├─ Notifications
   ├─ Shortcuts
   ├─ Devices and tokens
   └─ About
```

The global navigation has five destinations: Inbox, Sessions, Search, Providers, Settings. A session is a contextual route opened from Inbox or Sessions, not a global destination.

## 3. Navigation model

### Desktop

- **Left rail:** global destinations with icons and labels. Provider health sits at the bottom.
- **Session sidebar:** search, filters, provider groups, project groups, session rows. This is the main browsing surface.
- **Main area:** inbox, session list, chat, provider settings, or search results.
- **Right details panel:** session metadata, provider link, model, agent, cost, tokens, parent session, and destructive actions.

### Tablet

- Left rail stays.
- Session sidebar and main area share the screen.
- Details open in a sheet from the right.

### Mobile

- Bottom navigation: Inbox, Sessions, Search, Settings.
- Sessions is the home list.
- Chat opens as a full-screen route.
- Details and filters open as bottom sheets.
- New session is a floating action button on Sessions and Inbox.
- Providers live inside Settings on mobile.

### Glasses

- One focus at a time. No global navigation tree.
- Inbox, item detail, chat, and reply are sequential screens.
- Double tap goes back. Long press opens the contextual menu.
- The phone handles setup, long text, and complex forms.

### VR

- Spatial panels: Inbox on the left, Sessions in the center, Chat on the right, Details above or behind.
- A wrist or controller menu switches panels.
- The same routes and data as the web client.

## 4. Desktop layout

```text
┌──────┬──────────────────────┬──────────────────────────────────┬──────────────────┐
│ Nav  │ Sessions             │ Chat                             │ Details          │
│      │                      │                                  │                  │
│ Inbox│ Search…              │ Fix auth race in gateway         │ Provider         │
│ 3    │ [All] [OpenCode] …   │ OpenCode · build · running       │ desktop-opencode │
│      │                      │                                  │ Project          │
│ Sess │ Today                │ You                              │ agent-hub        │
│      │ ● Fix auth race      │ Fix the auth race                │ Directory        │
│ Srch │   OpenCode · 2m      │                                  │ /home/me/...     │
│      │ ○ Q4 planning        │ Agent                            │ Model            │
│ Prov │   Open WebUI · 18m    │ The race comes from two          │ claude-sonnet    │
│      │ ! Pi deployment      │ writers sharing the refresh      │ Agent            │
│ Set  │   Hermes · 1h        │ token. One rotates it while      │ build            │
│      │                      │ the other reads it.              │ Cost             │
│      │ Earlier              │                                  │ $0.42            │
│      │ ...                  │ [Permission] Run shell           │ Tokens           │
│      │                      │ git push origin main             │ 142k             │
│      │                      │ [Allow once] [Always] [Deny]     │                  │
│      │                      │                                  │ Open in OpenCode │
│      │                      │ You                              │ Copy session ref │
│      │                      │ Continue with the failing test.  │ Interrupt        │
│      │                      │                                  │                  │
│      │                      │ ┌──────────────────────────────┐ │                  │
│      │                      │ │ Reply…                    ↑ │ │                  │
│      │                      │ │ / @ #                        │ │                  │
│      │                      │ └──────────────────────────────┘ │                  │
└──────┴──────────────────────┴──────────────────────────────────┴──────────────────┘
```

### Layout rules

- Left rail width: 64 px collapsed, 200 px expanded. Default 64 px.
- Session sidebar: 300 to 360 px, resizable.
- Details panel: 280 to 340 px, collapsible.
- Main area minimum width: about 400 px.
- At widths below 1320 px, details becomes a right-side overlay behind a button. At 1320 px and above it is a column.
- At widths below 761 px, use the mobile layout: single column, bottom navigation, and full-screen chat.
- At 761–1100 px, the session sidebar narrows to 300 px and the project column drops from the sessions table.

## 5. Inbox

The inbox is the default screen when something needs attention. It groups items by what the user must do.

```text
┌────────────────────────────────────────────────────────────────────┐
│ Inbox                                           3 need you         │
│ [All] [Approvals] [Questions] [Unread] [Errors]                    │
├────────────────────────────────────────────────────────────────────┤
│ BLOCKING                                                           │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ PERMISSION · OpenCode · desktop-opencode         2m            │ │
│ │ Fix auth race in gateway                                       │ │
│ │ Run shell: git push origin main                                │ │
│ │ [Allow once] [Always allow] [Deny]                 Open        │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ QUESTION · Hermes · rpi-hermes                   14m           │ │
│ │ Pi deployment notes                                            │ │
│ │ Which model should the gateway use?                            │ │
│ │ ( ) Hermes 3 70B   ( ) Hermes 3 8B   ( ) Custom                │ │
│ │ [Answer]                                           Open        │ │
│ └────────────────────────────────────────────────────────────────┘ │
│ UNREAD                                                             │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ REPLY · Open WebUI · openwebui                   18m           │ │
│ │ Q4 planning                                                    │ │
│ │ “I pulled the launch risks into three buckets…”     [Mark read]│ │
│ └────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

### Inbox rules

- Blocking items always come first.
- Each card shows type, provider, session title, age, a one-line summary, and actions.
- A card opens the session when the user clicks the title or the Open action.
- Approval actions complete in place. A successful action removes the card with a short transition and updates the badge.
- Complex forms show an "Open form" action. The form page uses the provider's field schema.
- Empty state: "Nothing needs you. Browse sessions or start a new chat."
- The inbox refreshes through SSE. A manual refresh is available but not required.

## 6. Sessions

The sessions view is the full browsing surface.

```text
┌──────────────────────┬────────────────────────────────────────────┐
│ Sessions             │ All sessions                               │
│ Search…              │                                            │
│ [All] [OpenCode] …   │ Provider  All ▾   Status  Any ▾   Sort  New│
│                      │                                            │
│ PINNED               │ ┌────────────────────────────────────────┐ │
│ ★ Fix auth race      │ │ ● Fix auth race in gateway             │ │
│                      │ │ OpenCode · agent-hub · build · 2m      │ │
│ TODAY                │ │ Needs approval · Run shell             │ │
│ ● Fix auth race      │ └────────────────────────────────────────┘ │
│ ○ Q4 planning        │ ┌────────────────────────────────────────┐ │
│ ! Pi deployment      │ │ ○ Q4 planning                          │ │
│                      │ │ Open WebUI · Product · 18m             │ │
│ EARLIER              │ │ “I pulled the launch risks…”           │ │
│ ...                  │ └────────────────────────────────────────┘ │
└──────────────────────┴────────────────────────────────────────────┘
```

### Session row

- Status dot: running, idle, error, offline.
- Title, truncated to one line.
- Provider badge with the provider name.
- Project or directory basename.
- Agent and model when available.
- Relative update time.
- Unread dot.
- Attention badge when the session is blocked.

### Filters

- Provider: all, or one configured provider.
- Project: all, or one project.
- Status: any, running, idle, error, offline.
- Attention: any, blocking, unread.
- Sort: newest, oldest, provider, project.

### Grouping

- Default: Pinned, Today, Yesterday, Earlier.
- Optional: group by provider or project.
- Collapsed groups remember their state per device.

## 7. Session and chat

The session view is the core reading and reply surface.

### Header

- Session title.
- Provider badge, project, agent, model.
- Status chip.
- Actions: details, open in provider, copy ref, interrupt, mark read, more.

### Transcript

- Full-width rows with a role label and content.
- On open, fetch the newest message page first (200 by default), render it oldest-to-newest, and start at the latest message. Never fetch the oldest page first.
- A "Load older messages" control sits at the top. Scrolling near the top loads the next older page automatically and preserves the reading position. Older pages are prepended in ascending display order.
- The transcript header stays sticky so back, session context, and interrupt remain available after starting at the bottom.
- User messages use a subtle shaded block. Assistant messages use the page background with a role label.
- Message text renders sanitized Markdown: paragraphs, lists, links, inline code, fenced code, blockquotes, and tables. Links open safely in a new tab.
- Tool calls render as compact, collapsed rows with a humanized name, status, and hidden input/output.
- Reasoning renders as a compact collapsed row with a character count; its Markdown is sanitized through the same renderer as message prose.
- Consecutive assistant turns containing only reasoning/tool activity collapse into one "Agent activity" block. Opening it exposes the individual steps.
- Permission requests render inline as a blocking card with actions.
- Question requests render inline as a form card.
- Errors render as a red-tinted card with retry and open actions.
- Streaming text appends into the current assistant message. The transcript stays anchored near the bottom only when the reader is already there.
- Code blocks use a monospace font with horizontal scrolling; syntax highlighting and copy actions are follow-ups.

### Composer

- Multiline text area with send on `Ctrl/Cmd+Enter`.
- Attachment button, disabled when the provider does not support attachments.
- Agent and model selectors when the provider supports them.
- Slash commands later.
- Voice button on mobile and glasses. Desktop can use the browser microphone later.
- Drafts persist per session and device.
- While the agent is running, show an interrupt button and allow queueing a follow-up if the provider supports it.

### Details panel

- Provider, base URL label, project, directory, branch when available.
- Native session ID and reference.
- Agent, model, status, created, updated.
- Cost and tokens when available.
- Parent session when the session is a subagent.
- "Open in provider" link.
- Copy reference.
- Interrupt and mark read.
- Provider-specific actions.

## 8. New session

```text
┌──────────────────────────────────────────────────────┐
│ New session                                      ×    │
│                                                      │
│ Provider   [desktop-opencode ▾]                       │
│ Project    [/home/me/agent-hub ▾]                     │
│ Agent      [build ▾]                                  │
│ Model      [claude-sonnet ▾]                          │
│                                                      │
│ First prompt                                          │
│ ┌──────────────────────────────────────────────────┐ │
│ │ Read the auth middleware and fix the race.       │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ [Cancel]                                  [Create]   │
└──────────────────────────────────────────────────────┘
```

- Provider comes first. It determines the available projects, agents, and models.
- Projects and models load asynchronously with a skeleton state.
- Create is disabled until the provider is online and required fields are valid.
- After creation, the client opens the session and shows the first prompt in the transcript.

## 9. Providers

```text
┌──────────────────────────────────────────────────────────────┐
│ Providers                                      + Add         │
│                                                              │
│ ● desktop-opencode   OpenCode   192.0.2.2:4096   Online  ✓   │
│   Capabilities: list read send create stream permissions      │
│                                                              │
│ ● laptop-opencode    OpenCode   192.0.2.3:4096   Online  ✓   │
│                                                              │
│ ○ openwebui          Open WebUI https://...      Auth error  │
│   Check the API key.                          [Check] [Edit] │
│                                                              │
│ ○ rpi-hermes         Hermes     192.0.2.4:8642   Offline     │
│   Last seen 4m ago.                           [Check] [Edit] │
└──────────────────────────────────────────────────────────────┘
```

- Each provider row shows health, type, address, version, and capabilities.
- Add and edit forms include base URL, token or password, label, and enabled state.
- Check runs a health request and updates the row.
- Capability chips explain why an action is hidden.
- Provider credentials never render after save.

## 10. Search

- Global search input in the top bar on desktop, a destination on mobile.
- First release searches session titles, projects, and provider names.
- Results group by provider and show a matching excerpt when message search lands.
- Filters mirror the Sessions view.
- Keyboard: `Cmd/Ctrl+K` opens search from any screen.

## 11. Settings

- Appearance: theme, density, message width.
- Notifications: attention badge, desktop notifications, sound.
- Shortcuts: command palette, new session, search, send.
- Devices and tokens: hub token rotation, connected devices later.
- About: hub version, provider versions, build info.

## 12. States

Every screen needs these states:

- **Loading:** skeletons for lists and messages. Do not block the whole app.
- **Empty:** a clear next action.
- **Offline provider:** amber status chip, cached data labeled "last synced", retry action.
- **Auth error:** red status chip with a direct path to provider settings.
- **Error:** inline error card with code and retry.
- **Streaming:** append text, keep scroll position unless the user is at the bottom.
- **Disconnected hub:** persistent banner with reconnect and last sync time.
- **No attention:** calm empty inbox with a link to sessions.

## 13. Visual language

### Tone

Quiet, precise, and work-focused. The interface should disappear behind the conversation. Avoid decorative gradients, oversized headings, and card-heavy dashboards.

### Color

The visual system uses a layered neutral palette. Borders and surface shifts carry structure. Color is reserved for state and action.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#08090b` | `#eef1f5` | Canvas |
| `rail` | `#0d0f13` | `#f7f9fc` | Nav rail and top bar |
| `sidebar` | `#111419` | `#ffffff` | Sidebar and details |
| `surface` | `#16191f` | `#ffffff` | Cards |
| `surface-2` | `#1d2129` | `#f5f7fa` | Inputs, chips, raised rows |
| `surface-3` | `#272c36` | `#e8edf4` | Active and pressed |
| `border-subtle` | `#2a2f38` | `#d6dce5` | Internal dividers |
| `border` | `#3f4652` | `#c3cbd6` | Card edges |
| `border-strong` | `#5f6878` | `#808a99` | Inputs, buttons, active rows |
| `text` | `#f4f6f9` | `#111318` | Primary text |
| `muted` | `#b5bcc8` | `#4f5764` | Secondary text |
| `faint` | `#8f97a5` | `#626b78` | Timestamps and hints |
| `accent` | `#a9bdff` | `#3550c8` | Primary actions and focus |
| `on-accent` | `#07080b` | `#ffffff` | Text and icons on accent fills |
| `success` | `#63e39a` | `#0b6b3a` | Running and approved |
| `warning` | `#ffd166` | `#8a5200` | Needs attention |
| `danger` | `#ff9292` | `#b91c1c` | Deny, error, destructive |

Provider identity and state are separate systems. In session lists and inbox cards, provider badges use a neutral mark and the provider name. Provider accents appear only on the Providers screen, where they identify a connection rather than a state:

- OpenCode: mint `#7ee2b8` dark, `#0b6b3a` light
- Open WebUI: blue `#9cc0ff` dark, `#2f4fb5` light
- Hermes: amber `#ffd166` dark, `#8a5200` light

State color is reserved for status and attention. Unread is shown by title weight, not another dot. A session has one status dot; attention has one amber marker.

### Contrast and elevation

- Faint text stays above 4.5:1 on cards and the canvas.
- Interactive controls use `border-strong`, which clears 3:1 on the card surface.
- Card edges use `border`; dividers use `border-subtle`.
- Controls use `surface-2`; active rows use `surface-2` plus an accent inset bar.
- Cards use a small shadow. Hovered cards and the composer use a medium shadow. Modals and sheets use a large shadow.
- Focus uses one 2px accent outline. Inputs use a tight offset; the composer owns its own focus ring.
- Status uses a label, a dot, and a tinted pill. Color is never the only cue.
- The topbar owns the page title and renders it as the page `h1`. Pages do not repeat it as a second content heading.

The full audit and before/after measurements are in [`visual-audit.md`](visual-audit.md).

### Typography

The type scale has six roles, not a continuum of half-steps:

| Token | Size | Role |
|---|---:|---|
| `text-2xs` | 10px | Badges, counts, uppercase section labels |
| `text-xs` | 11px | Timestamps, provider badges, status pills, filter chips |
| `text-sm` | 12px | Buttons, detail values, compact controls |
| `text-base` | 14px | Body, chat prose, session titles |
| `text-lg` | 16px | Topbar/page titles, inbox card titles |
| `text-xl` | 20px | Chat document title |

- UI: system sans stack, 14px base.
- Weights: 400, 500, 600, 700 only.
- Line height: 1.6 for chat prose, 1.5 for UI copy, 1.3 for titles.
- Numeric metadata uses tabular figures.
- Code and identifiers: system monospace.

### Spacing and shape

- Base spacing unit: 4px.
- Scale: 4, 8, 12, 16, 24, 32px. Optical 2px exceptions remain for rails and count badges.
- Radius: 4px for badges, 8px for controls, 12px for cards, 16px for sheets, 999px for pills.
- Borders carry structure. Shadows are minimal and functional.
- Icons: 16 or 18px line icons, 1.7px stroke.

## 14. Mobile layout

```text
┌──────────────────────────────────┐
│ Agent Hub                 ⌕  +   │
│ [All] [OpenCode] [Open WebUI] …  │
├──────────────────────────────────┤
│ ● Fix auth race in gateway       │
│   OpenCode · 2m · needs approval │
│                                  │
│ ○ Q4 planning                    │
│   Open WebUI · 18m               │
│                                  │
│ ! Pi deployment notes            │
│   Hermes · 1h · needs answer     │
│                                  │
├──────────────────────────────────┤
│  Inbox   Sessions   Search  Set  │
└──────────────────────────────────┘
```

Chat on mobile:

```text
┌──────────────────────────────────┐
│ ‹  Fix auth race        ⋯   ⌕    │
│    OpenCode · running            │
├──────────────────────────────────┤
│ You                              │
│ Fix the auth race                │
│                                  │
│ Agent                            │
│ The race comes from two writers  │
│ sharing the refresh token.       │
│                                  │
│ [Permission] Run shell           │
│ [Allow once] [Deny]              │
├──────────────────────────────────┤
│ Reply…                    🎤  ↑  │
└──────────────────────────────────┘
```

- Bottom nav has four destinations. Providers move under Settings.
- Chat is a full-screen route with a back button.
- Details open as a sheet.
- Composer stays above the safe area and keyboard.
- Filters wrap below 420px so no chip is clipped or hidden.
- Provider machine names drop below 480px; the provider remains identifiable by name.
- The external chat action drops below 360px; the details sheet still exposes it.
- Form fields use 16px text on mobile to avoid browser zoom.
- Modal content scrolls inside the sheet while the footer actions stay pinned.
- Long press a session row for pin, mark read, copy ref, and open in provider.
- Pull to refresh on the list.

## 15. Glasses adaptation

The glasses show one decision or one short conversation at a time.

### Inbox

```text
ATTENTION 2

> PERMISSION
  OpenCode · auth race
  git push origin main

Tap open   Swipe move
```

- Maximum three rows, one line each.
- The selected row uses `>`.
- Blocking items first.
- Footer: `Tap open  Swipe move  Hold menu`.

### Item

```text
PERMISSION
OpenCode · auth race

Run shell:
git push origin main

Allow once / Always / Deny
```

- Tap cycles the selected action; tap opens the contextual menu.
- Long press opens the menu with actions.
- Double tap returns to the inbox.

### Chat

```text
auth race
————————

The race comes from two
writers sharing the
refresh token. One
rotates it while the
other reads it.

Tap talk  Swipe scroll
```

- Six lines maximum.
- Voice reply: tap to record, tap to stop, review, send.
- Quick replies through the contextual menu: Continue, Stop, Retry, Yes, No.
- Phone keyboard fallback for long text.

### Input map

| Input | Action |
|---|---|
| Right temple tap | Primary action: open, approve, send |
| Left temple tap | Back or secondary action |
| R1 ring tap | Approve or primary |
| R1 double tap | Deny or back |
| Double tap | Back |
| Swipe up/down | Navigate or scroll |
| Long press | Contextual menu |

The hub does not care which gesture a client uses. The client maps gestures to the same attention actions.

## 16. VR adaptation

```text
        ┌──────────────┐
        │   Details    │
        └──────────────┘
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│   Inbox      │  │  Sessions    │  │      Chat        │
│              │  │              │  │                  │
│ Permission   │  │ Fix auth     │  │ Transcript       │
│ Question     │  │ Q4 planning  │  │                  │
│ Unread       │  │ Pi notes     │  │ Composer         │
└──────────────┘  └──────────────┘  └──────────────────┘
```

- Panels are spatial but use the same routes and data.
- A wrist menu switches panel focus.
- Voice is the primary composer. A virtual keyboard is a fallback.
- Attention cards stay large and reachable.
- Start with a 2D web panel in a WebXR browser, then add spatial layout.

## 17. Accessibility

- All actions are reachable by keyboard.
- Focus rings use the accent color and remain visible.
- Status is not conveyed by color alone. Pair dots with labels.
- Approval and deny actions have distinct labels and confirmation where needed.
- Message text uses semantic headings and lists.
- Respect `prefers-reduced-motion`.
- Minimum touch target: 44x44 px on mobile.
- Screen-reader labels for icon-only buttons.
- The glasses UI uses large text and short lines. The VR UI keeps panels at readable angles and distances.

## 18. Content guidelines

- Use provider names as the providers use them: OpenCode, Open WebUI, Hermes.
- Status words: running, idle, error, offline.
- Attention words: Permission, Question, Unread, Error.
- Actions: Allow once, Always allow, Deny, Answer, Mark read, Retry, Open.
- Avoid “AI agent” in every label. Use the session title and provider.
- Show timestamps as relative for recent items and absolute for older ones.
- Error messages name the failing provider and the next action.

## 19. Prototype

Open `docs/prototypes/index.html` through a local server:

```sh
python3 -m http.server 4174 --bind 0.0.0.0 --directory docs/prototypes
```

The prototype includes:

- Desktop and mobile layouts.
- Inbox, sessions, chat, and providers views.
- Mock OpenCode, Open WebUI, and Hermes data.
- Attention actions that update the inbox.
- A session switcher and a working composer mock.
- Light and dark themes through the operating system preference.

The prototype is a design artifact, not production code. It uses the same labels, hierarchy, and states described here.
