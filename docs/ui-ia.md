# Oktoso UI and Information Architecture

> Status: frozen in [`design-v1`](design-lock.md) on 2026-10-26, with the `design-v1.1` session transcript revision on 2026-10-27, the chat shell alignment on 2026-11-02, the wide-field layout revision in `design-v1.13` on 2026-11-15, the reading-column alignment in `design-v1.14`, the mobile collision fixes in `design-v1.16`, the accessibility pass in `design-v1.17`, the accessibility follow-ups in `design-v1.18`, and session rename plus search label alignment in `design-v1.19`. Changes to this document follow the design lock policy.

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
Oktoso
├─ Overview
│  ├─ Usage
│  ├─ Runtime status
│  └─ Event stream
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
│  ├─ Scope (Sessions, Messages)
│  ├─ Sessions
│  ├─ Messages
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

The global navigation has six destinations: Overview, Inbox, Sessions, Search, Providers, Settings. Overview is the default route. A session is a contextual route opened from Inbox or Sessions, not a global destination.

### History behavior

Every screen, session, overlay, and filter change that represents navigation is addressable by URL and participates in browser history.

- Rail and bottom-nav changes, session opens, session switches, new-session, provider add/edit, details on overlay widths, inbox filters, and search filter chips push a history entry.
- Search text is reflected in the URL with a short debounce and `replaceState`, so one search does not create one entry per keystroke.
- Back and forward restore the visible route, selected session, details state, shareable filters, and inner scroll positions for the content column and transcript.
- Back from a chat returns to where it was opened, including Inbox or Search. The topbar back action uses the same history behavior and falls back to Sessions when the chat was opened directly.
- Closing an overlay opened from the app steps back to the state that opened it. Closing an overlay opened from a deep link replaces the URL instead of leaving a trapped history entry.
- Direct deep links restore the same screen after authentication. Signed-out links redirect through `/login?next=…`, and only same-origin app paths are accepted. Session refs stay opaque and URL-encoded.

## 3. Navigation model

### Desktop

- **Left rail:** global destinations with icons and labels. Labels stay on one line and ellipsize inside the 64px rail; hover exposes the full name. Provider health sits at the bottom.
- **Session sidebar:** search, filters, provider groups, project groups, session rows. This is the main browsing surface.
- **Main area:** inbox, session list, chat, provider settings, or search results.
- **Right details panel:** session metadata, provider link, model, agent, cost, tokens, parent session, and destructive actions.

### Tablet

- Left rail stays.
- Session sidebar and main area share the screen.
- Details open in a sheet from the right.

### Mobile

- Bottom navigation: Overview, Inbox, Sessions, Search, Settings. The bar holds five items; a sixth requires shortening every label or moving to icons only.
- Sessions is the home list.
- Chat opens as a full-screen route.
- Details and filters open as bottom sheets.
- New session is a page-level action on Sessions and Inbox; it opens the inline panel.
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
│ Sess │ Today                │ You                              │ oktoso        │
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
- The topbar and page content share one horizontal gutter: 24 px on desktop and 16 px on mobile. The topbar owns the page title; product pages do not repeat it in a hero card or in the transcript.
- List pages use a 1320px content field. Sessions and search results become a table at 1100px and above: status dot, title, provider, project and agent, then time. Inbox and Providers use two columns at wide widths; below their breakpoints they collapse to one.
- Where a screen has page-level actions, they sit with a compact page lead in a toolbar above the first panel, not in a separate card.
- At widths below 1320 px, details becomes a right-side overlay behind a button. At 1320 px and above it is a column.
- At widths below 761 px, use the mobile layout: single column, bottom navigation, and full-screen chat.
- At 761–1100 px, the session sidebar narrows to 300 px and session rows return to the two-line title-and-facts layout.

## 5. Overview

- Overview is the default route and the only hub-wide report. It answers "what has this cost, and is the hub healthy?" in that order.
- **Usage** comes first: a panel with a `Group by` chip row (Provider, Project, Model, Day) and a table of group, sessions, tokens, cost. Counts, tokens, and cost are right-aligned with tabular figures; an unreported figure is an em dash, never `0` or `$0.00`. The last row is `Reported total`, and a note states how many sessions did not report each figure.
- At 1100px and above the report is a table. Below, each row stacks as label and count, then `4.2M tokens · $12.40`.
- Day grouping follows each session's last update, never per-message usage; the note says so.
- The panel head states how many sessions were counted, so a bounded client-side walk never claims to be the whole history.
- Runtime status cards, the provider panel, the event stream, and diagnostics follow the report. There is no hero: the phase-0 runtime banner and its roadmap copy are gone, because it repeated the page title at 20px and made a claim that is no longer true.
- States: no sessions, no reported usage (dashes plus the count note), loading, revalidating cached usage, and an inline error inside the panel. A failed refresh keeps the last report and says so.

## 6. Inbox

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
- At 420px and below the filter chips take the full toolbar width and wrap; Refresh and New session move to their own right-aligned row under them. Above that, the tabs and actions share one row.
- New session is a page-level action in the Inbox toolbar; it opens the inline panel on Sessions. The same action sits in the Sessions toolbar.
- Filter chips expose `aria-pressed` for the active filter. Their accessible name includes the count (`Approvals, 2 items`), so the count is never a visual-only cue.
- At 1200px and above, cards form a two-column grid inside each group. Each card keeps its own height (`align-items: start`); a blocking card is no wider than any other card and is distinguished by its amber edge, not by spanning the grid.
- Each card shows type, provider, session title, age, a one-line summary, and actions.
- A card opens the session when the user clicks the title or the Open action.
- Approval actions complete in place. A successful action removes the card with a short transition and updates the badge.
- Complex forms show an "Open form" action. The form page uses the provider's field schema.
- Empty state: "Nothing needs you. Browse sessions or start a new chat."
- The inbox refreshes through SSE. A manual refresh is available but not required.
- The last successful items and approvals stay cached per screen. Returning to the Inbox renders them immediately while the background refresh runs; a cached empty list reads `Checking for requests…`, not the settled empty copy.

## 7. Sessions

The sessions view is the full browsing surface.
- The first page is cached in local storage after a successful load. When the hub is unreachable, the list renders that page and shows a quiet `Offline · showing the last synced list from <time>` line with Retry instead of an empty error. A cold load with no cache keeps the normal error state.
- The screen also keeps its last loaded page in memory. Returning from another route renders that page immediately and refreshes it in the background; a cached empty page reads `Checking for sessions…` until the refresh settles.

```text
┌──────────────────────┬────────────────────────────────────────────┐
│ Sessions             │ All sessions                               │
│ Search…              │                                            │
│ [All] [OpenCode] …   │ Provider  All ▾   Status  Any ▾   Sort  New│
│                      │                                            │
│ PINNED               │ ┌────────────────────────────────────────┐ │
│ ★ Fix auth race      │ │ ● Fix auth race in gateway             │ │
│                      │ │ OpenCode · oktoso · build · 2m      │ │
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

- One status dot: running, idle, error, offline. The row does not repeat the status as a pill; the accessible name carries the status word.
- Provider status is authoritative, with two resilience rules: a forked session with no busy/idle history is idle, and a busy run that has not updated for 30 minutes is treated as idle so the composer does not stay on Steer forever. A provider 404 removes the cached session instead of keeping a zombie header.
- Title, truncated to one line.
- Provider badge with the provider name.
- Project or directory basename.
- Agent and model when available.
- Relative update time, rendered as a `<time>` element whose `dateTime` carries the absolute update time.
- Unread is title weight, never another dot.
- Attention badge when the session is blocked.
- A subagent row is indented under its parent, carries a 10px `SUBAGENT` tag, and keeps the same dot, title, provider, project, time, and status grammar. A parent row shows `N subagents` in its meta, and `N running` when any child is live.
- A parent with subagents has a chevron disclosure at the right edge of the card: 32px on desktop, 44px on mobile. The chevron is a separate control; the rest of the card still opens the parent session. Children indent 16px, with a quiet 1px rail.
- The tree is two levels in practice but supports more. A child that has its own children gets the same disclosure.

### Subagent tree

- The Sessions list defaults to the tree: root sessions first, their subagents nested and collapsed behind the disclosure.
- `All` is the tree. `Root` is a strict roots-only filter that still shows the child count. `Subagents` is a flat list of children for inspection.
- The scope chips are one flex group. At 760px and below they move below the session summary on their own row instead of competing with the count text.
- The header count reads `N sessions · M subagents`. A parent is ordered by the newest update in its branch, so a running child lifts its parent.
- Subagents whose parent is not in the loaded page appear under `Subagents without a loaded parent`, with the same tag.
- The chat sidebar uses the same tree inside its day groups. It expands the active session's parent automatically, and keeps a family under the parent's day even when a child updates later.

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

## 8. Session and chat

The session view is the core reading and reply surface.

On desktop, a 300px session sidebar sits between the rail and the transcript. It carries search, provider and status filters, day groups, the parent/subagent tree, the active row, and an All sessions action. It is hidden at 760px and below, where Sessions remains the home list.

The Sessions view and the chat sidebar share one row component. Above 1100px the page list switches it to a table; the 300px sidebar always keeps the stacked title-and-facts layout.

### Header

- The fixed topbar owns the session title as the page `h1`, plus the provider and status subline, back action, and details toggle. It also carries the Ask action that opens the read-only assistant dock. It is the only title in the view.
- The transcript opens with a quiet context strip: project, agent, model, and the status chip. It has no document title and no second sticky header.
- Details, open in provider, copy reference, interrupt, and mark read live in the details panel and composer.
- Details carries a **Data** row with `Export Markdown` and `Export JSON` links. The format is the choice, so there is no menu; the note says attachment files are listed, not embedded.
- Details gains a **Lineage** section when the session belongs to a family: one indented row per session from the root down, the current row marked with the accent inset. Each row is a button that opens that session; the header says how many sessions the tree holds and marks it partial when a cap cut it. A lone session shows no section at all.
- The topbar theme toggle is a 32px icon control with an outcome label (`Switch to light theme` / `Switch to dark theme`). In chat it is hidden at 420px and below so the title keeps its width; the theme control stays available on the other views.
- Project, agent, model, and the status chip stay together in the transcript context strip. The provider lives in the topbar subline.

### Transcript

- The transcript is its own scroll region inside the chat shell. The composer stays pinned below it; the page itself does not scroll.
- The transcript panel and composer are capped at 672px. With the 16px transcript padding and 1px frame, the reading column fills the panel at about 640px, roughly 88 characters of Inter prose at 14px. The jump lives in a reserved lane at the bottom of the transcript frame, outside the scroll area, so it never covers the last line, media, or an action row.
- On open, fetch the newest message page first (200 by default), render it oldest-to-newest, and start at the latest message. Never fetch the oldest page first.
- If that session has a cached transcript window, paint it immediately and refresh the newest page in the background. The topbar line marks the refresh; the cached rows stay in place and the panel is `aria-busy` until the refresh settles. A cached empty transcript reads `Checking for messages…`, not the empty state.
- While a cold page loads, the transcript body shows a skeleton, not the empty state; the panel is `aria-busy` and announces "Loading transcript…" once. The empty state appears only after a successful load returns no messages. A failed load shows the alert and Retry; a failed background refresh keeps the cached window.
- A running session whose first message is not readable yet reads "The agent is running, but no messages have been written yet." with Retry, and the client re-reads once after a short delay.
- A "Load older messages" control sits at the top. Scrolling near the top loads the next older page automatically and preserves the reading position. Older pages are prepended in ascending display order.
- Opening a message deep link (`?message=<id>`, from search or an assistant reference) loads older pages until the message is in the window, scrolls it into view, and highlights the message or its activity group. A focus bar sits below the scroll region, above the jump lane, with `Fork from here` when the provider supports fork, `Load older` when the message is not in the loaded window, and Dismiss. Forking before that message creates a new session and opens it.
- A **Jump to latest** pill sits in a reserved footer lane at the bottom of the transcript frame, below the scroll area and above the composer, when the transcript scrolls. It reads "Input needed" when blocking attention is waiting below, and that visible text is its accessible name. It fades and lifts in with opacity and transform. The lane stays reserved while the transcript is scrollable, so the pill never covers a message, media, or an action row and scrolling never moves the composer. At the bottom the pill is removed from the tab order, made inert, and hidden from assistive technology; the lane clears its top border.
- Date separators (`Today`, `Yesterday`, `Oct 26`) group messages by day. Timestamps show the local hour and minute, not seconds.
- User messages use a subtle shaded block. Assistant messages use the page background with a role label. The labels are `You` and `Agent`.
- Message text renders sanitized Markdown: paragraphs, lists, links, inline code, fenced code, blockquotes, and tables. Markdown headings shift down one level (`#` renders as `h2`) so a message or preview never competes with the page title and the view keeps exactly one `h1`. The heading rules cap at 16px for `h1`/`h2` and 14px for `h3`/`h4`. Links open safely in a new tab.
- Relative Markdown links and image sources resolve against the provider base URL. For OpenCode, project-relative file references resolve through the provider filesystem read endpoint with the session directory, so `docs/spec.md` and `docs/concepts/plot.png` open the actual project files rather than a provider-root URL. Absolute links stay absolute; `mailto:` and `tel:` links stay local; unsupported schemes and unsafe data images are removed.
- Provider-hosted images and files load through the hub attachment proxy, which uses the provider credentials and enforces same-origin, size, redirect, and content-type rules. The browser receives a blob URL for private resources, so prompts and provider tokens stay out of image URLs. File links use the same proxy and download the attachment.
- File parts use the same URL resolution. Image attachments render inline with a caption; other files keep their name, MIME type, and Open action.
- Agent activity is collapsed by default, like any disclosure. The collapsed block is one header row — label, step count, errors, time — plus a preview stamp of colour-coded 4px squares — 1px apart, no radius, 50% opacity — that flows horizontally and wraps naturally at the block width, so the preview stays one row until the steps outgrow it. The stamp is silent for screen readers; the header carries the count and error text.
- Expanding is explicit (header click or keyboard). It reveals a wrapping grid of thumb-size tiles, one per step (tool call or reasoning block). A tile is 49px wide at the default size, 4px apart, 8px radius, with a soft 6% wash of its tool family: icon on top, at most one short metric below. The grid never scrolls sideways and the block header reports steps, errors, and the time.
- Tile families carry muted hues: reasoning, read, search, write, edit, shell, execute, fetch, subagent, image. Status overrides the family: error is red, running is amber, and a running subagent is green because a live child is healthy rather than a warning. Success, warning, and danger keep their semantic meaning.
- Metrics are abbreviated to about eight characters and every one comes from the provider payload: reasoning characters, shell exit or duration, execute call count, write bytes, edit line delta, read lines, search hits or files, subagent `launched`. The exact figure stays in the tooltip and in the step panel.
- Interactive states are explicit: the header and tiles lighten on hover, press with a stronger wash or inset shadow, and keep the single 2px accent `:focus-visible` outline. Dots are decorative and never focusable.
- Selecting a tile opens that step inline, on its own line directly under the tile row. It is a disclosure, never a modal: status, step name, subtitle, time, one close control, a scrolling body capped at 22.5rem, and Previous / Next. Escape closes it, arrow keys move between tiles, and focus stays on the grid.
- The step body renders by kind: reasoning as sanitized Markdown with images, shell as Command plus Output with the exit code in the label, execute as Code plus Output, write as a file card with a rendered body, read as File plus any embedded images plus Content, search as Query plus Result, fetch as Request plus Response, subagent as agent, task, prompt, child session, and Open session. Other tools fall back to Input and Output JSON.
- An image read renders from the image bytes the tool returned, not a disk read. That is why a tool read of `/tmp/...` still shows the image even when no preview root covers it: the tool output carries the bytes. Opening the same path through the file preview requires it to sit under a preview root or be an exact write/edit/read artifact.
- Inline Markdown images, video, and audio use the same validated session-file route. A relative path is anchored to the session; an absolute path must be under a preview root or a recorded artifact. A link to a session file downloads through that route; an unknown absolute path keeps the missing-image/link fallback.
- A subagent tile only says `launched`. Its panel links to the child session, which opens through the existing session route.
- A file mention in message prose is a controllable code span when the provider exposes `files`: `<code>` turns into a quiet button with a dashed underline. Activating it opens the file preview; the text around it is unchanged and other code spans stay plain.
- The preview scope is provider-derived: the session directory, the project canonical directory, saved worktrees (including ones under the OpenCode data directory), sandboxes, validated lineage roots, and exact paths the agent wrote, edited, or read. A mention outside all of those stays plain text or offers the provider fallback. The operator can add scratch roots such as `/tmp/opencode` through the host-only `files.previewRoots` config; message prose never creates a root.
- A generated HTML artifact outside every root opens in an exact-file ticket: the document loads, but sibling assets do not. A file under a root keeps the existing directory-scoped ticket, so its relative assets load.
- The file preview is a modal sheet: the file name as the sheet title, the path beneath it, one close control, and a scrolling body. Render mode follows the content type, with the extension as fallback: Markdown as Markdown, other text and code as preformatted text, images as images, video and audio with controls, HTML in a sandboxed frame (`allow-scripts`, no `allow-same-origin`), PDF in a frame. Escape and the scrim close it. A missing, escaping, oversized, or unsupported file shows a short inline error instead of a broken view.
- HTML is served to the frame through a ten-minute ticket rooted in its own directory, so relative maps, styles, and scripts load and the frame runs its own JavaScript in an opaque origin. The frame cannot read the hub token or call the hub API. A transcript video or audio file part whose URL is a session path uses the same ticket, so the element streams with `Range` requests instead of a 100 MB blob, and the player renews an expired ticket at the same position. Every other kind reads the live file through the session file endpoint.
- Preview caps are per kind: 1 MB for text and Markdown, 20 MB for images and PDF, 256 MB for media. HTML and transcript media stream through the ticket instead of a blob, so the cap applies to the file the hub serves rather than to browser memory. The sheet is 720px for text and 960px for media; below 760px it is a bottom sheet with a 520px floor so a small image never collapses the surface.
- A `?preview=<path>` query on a session URL opens the sheet directly, for a generated file the transcript does not mention; closing the sheet removes the query. The card's file name opens the same sheet. There is no download action, no file browser, and no diff.
- Consecutive assistant turns containing only reasoning/tool activity collapse into one "Agent activity" block with the tile grid. A message that mixes text and tools keeps the provider's part order: reasoning and tools first, then the text they produced, with the action row (Copy, branches, retry) at the end. The answer is therefore the last thing in the message, and Copy still belongs to the message rather than the steps.
- Live background work appears as a quiet row at the end of the transcript, after messages and attention cards: a pill reading `1 subagent running`, `1 shell running`, or `N running`. It scrolls with the transcript, opens Details, and never moves the composer. It is the only surface for that state on a phone besides Details.
- The transcript content fades at an overflowing edge with a 24px `mask-image` linear gradient, and returns to a hard edge at the true top and bottom. The panel frame stays crisp; only the scrolling content is masked. The fade length is a registered `<length>` property so it eases, and scroll updates are coalesced with requestAnimationFrame.
- Background shell runs are their own transcript rows: terminal icon, `Background shell`, the command in mono, status (`running`, `exit 0`, `exit N`), elapsed, and Show output. They are separate from the activity grid because they outlive the turn that started them.
- A provider compaction is a quiet transcript row. While the provider reports it running it reads `Compacting context…` with `reason · in progress` and no summary yet; when the summary lands the same row becomes `Context compacted` with reason, input tokens, summary size, and a Show summary disclosure. The running state is announced politely (`aria-live="polite"`). A failed compaction reads `Compaction failed` with the provider's message and a quiet **Retry** action; retrying while the session is running shows the hub's conflict line. When the provider says there is nothing to compact (`compaction.unavailable`), the row reads `Nothing to compact` with no Retry. Failures are announced politely, and the row keeps its border-top/bottom grammar.
- The Details panel has a **Background** section listing only live work for the session: running background shells and running subagents, each with its command or agent, elapsed time, and Open session for subagents. The section is absent when nothing is running.
- A subagent's liveness comes from its child session's current status, never from the launch tool's metadata, which keeps the launch-time value forever. Old subagents therefore read as completed, not running.
- A subagent whose child session is still running stays green even after its launch tool call completed; the green follows the child status, not the tool status.
- Compaction is a divider in the transcript, above or between messages and outside every tile grid: `Context compacted · auto · 853,721 tokens in · 6.7k ch summary` with Show summary expanding the sanitized summary Markdown inline.
- An audio or video attachment renders as a player in the message, not a
  download chip: native controls, `preload="metadata"`, width capped to the
  transcript. A Markdown `<video>` or `<audio>` with a session-relative path is
  resolved to a short-lived preview ticket, so it plays instead of asking the
  hub origin for an HTML page. Clicking a media mention opens the same preview
  sheet used for images, with a native player, instead of downloading. Media is
  served with byte ranges, so seeking works.
- A completed assistant message with text exposes one quiet `Copy` action after the message. It copies the raw text parts, including Markdown fences, and never includes reasoning or tool payloads. Success reads `Copied` for two seconds; failure reads `Copy failed`. Both are announced to screen readers.
- When the provider exposes in-chat branches, an assistant message with siblings shows one quiet branch picker beside Copy. It reads `‹ n / N ›`, uses 28px controls on desktop and 44px on mobile, and switches the visible path in place. The picker is absent for providers without branch support.
- When the provider exposes `retry`, a completed assistant reply shows one quiet `Retry` action beside Copy. Retry creates a new assistant sibling under the same user message and leaves the old answer reachable through the branch picker. The action is absent when the provider does not support retry, and it reads `Retrying…` while the new response runs.
- A notification deep link (`?attention=<id>`) scrolls the matching inline card into view and outlines it with the 2px accent. The card is the action surface; no separate sheet opens.
- Permission and approval requests render inline at the end of the transcript as blocking cards with actions. Question requests render inline as form cards. A select field is a radio list, not a native dropdown: the field title is a 10px uppercase label, its description is the question at 14px/500, and each option shows its label, provider description, and a 10px numbered index. When the provider allows a custom answer, the last row is `Type your own answer…` with an inline text input. On mobile, the question fields and custom answer input use 16px text so iOS does not zoom on focus. Submit stays disabled until every required field has a value. The card uses the field description instead of repeating the latest assistant question when one exists; a form with no field description falls back to the provider form description or the latest assistant question. Resolving a request removes it and reloads the session attention.
- Once a provider question is answered, its `question` tool call renders as a read-only **Question** card in the transcript: a 10px `QUESTION` badge, `Answered` and the answer time, the provider's short header, the prompt at 14px/500, and the chosen answer under an `Answer` or `Selected` label. A multi-select answer is a bulleted list; multiple questions are separated by a rule. The card stays where the tool call occurred and does not return to the inline attention area. Pending questions keep the inline form.
- Error attention renders as an inline red-tinted card with the provider message and its available actions: Dismiss, plus **Retry turn** and **Continue** when the provider supports them. The provider message keeps the reset time for a quota error; the card does not add its own advice. The message error block remains as the fallback when there is no attention item, with the same two actions.
- The assistant error card carries two quiet actions when the provider allows them: **Retry turn** (undo the failed turn and replay its user message on the current model) and **Continue** (append a continuation turn and keep partial work). Retry is hidden for providers without `retry`; Continue is hidden without `send`.
- Streaming text appends into the current assistant message. The transcript stays anchored near the bottom only when the reader is already there.
- Code blocks use a monospace font with horizontal scrolling. Each fenced block carries a quiet header: the language in 10px uppercase mono on the left, and a `Copy` action on the right. Copy copies the code without the fences, reads `Copied` for two seconds, and announces success or failure; it is 28px on desktop and the header grows to 44px on mobile. Syntax highlighting remains a follow-up. Message-level Copy still includes the fences.
- A fenced `mermaid` or `mmd` block renders as a diagram in place of the source. The diagram sits in a bordered `surface-2` panel with 12px padding, 8px radius, and 12px vertical margin; nodes use `surface-3` and the panel follows the active theme. The source stays visible while the diagram loads and when Mermaid rejects it. Wide diagrams render at their natural width in a horizontally scrollable panel, with a `Scroll to see the full diagram` hint when it overflows. Mermaid loads lazily only when a diagram is present.

### Composer

- The composer is pinned below the transcript and above the mobile bottom navigation and safe area.
- Multiline text area with send on `Ctrl/Cmd+Enter`, an explicit label, and the draft status as its description. On desktop it starts at two lines; on mobile it starts at one line and grows with the draft up to 180px.
- When the provider exposes `undo` and `redo`, the composer bar carries one quiet `Undo` action before the context chip. It undoes the latest turn and returns that prompt to the draft. It is absent when there is nothing to undo and disabled while the agent runs, with `Undo waits for the current run to finish`. Redo is not a second always-visible button; it lives in the staged banner. Open WebUI advertises `undo: false` in v1, so its composer has no Undo.
- While a turn is undone, a banner above the composer reads `Undo staged` and then `No files changed`, `N files changed, not restored`, or `N files restored`. The file list comes from the provider's read-only turn diff, so it is available before anything is written. `Show files` lists `path` and a text status (`added`, `modified`, `deleted`). The undone turn leaves the transcript, and its prompt is inserted when the draft is empty; otherwise the draft is kept and `Show prompt` exposes the undone text with `Insert prompt`.
- When the turn changed files and the provider exposes `restoreFiles`, the banner offers `Restore files`. It opens an inline confirmation naming the count and warning that current edits to those paths may be overwritten and that Redo restores the conversation and files to how they were when the turn was undone. Cancel is focused first; the confirm action uses the danger tone. After it succeeds the banner reads `N files restored` and the action disappears.
- Sending while staged accepts the undo. On OpenCode the send commits the staged revert and the new turn continues from the boundary. The composer hint reads `Sending accepts the undo`. `Sending starts a new branch` remains reserved for a provider that implements the branch mode; none does in v1.
- Undo, redo, and file-restore failures are an inline alert above the composer, never a toast.
- The banner and the undo control are quiet text actions: 28px on desktop, 44px on mobile. At 760px and below `Undo` moves into `⋯`, while `Redo` stays in the banner. The banner and confirmation controls wrap before they clip at 360px.
- Undo is not bound to `Ctrl/Cmd+Z`; that key stays with textarea undo. v1 is buttons only.
- Attachments are staged on the hub. When the provider exposes `attach`, one quiet `Attach` action opens a file picker. Pasting a file or image into the composer (`Ctrl/⌘+V`) stages it through the same path; when the clipboard contains files, the paste is treated as an attachment, not text. Staged files appear as wrapping chips above the textarea with name, size, and a remove control. Send is enabled when there is text or at least one attachment. The accept list is PNG/JPEG/GIF/WebP/AVIF, PDF, JSON, plain text, Markdown, and CSV; the limit is 20 MB per file and five files per message. Providers without `attach` show no upload action, while their existing file parts still render.
- The hub stores staged files under its data directory, expires them after one hour, and deletes them after a successful send. The web client receives only attachment IDs and metadata, never provider credentials.
- Agent, model, and reasoning selectors when the provider exposes options. Reasoning is the provider’s model variant; a model with no variants shows no reasoning selector. Changing a selector updates the session and refreshes the document header and details.
- The model selector groups models by their upstream provider with native `optgroup` sections. Provider and model order follow the provider response; a catalog with one group or no provider metadata renders a flat list. The native select remains the control so keyboard typeahead, mobile pickers, and screen-reader semantics stay intact.
- The selectors are disabled while the agent is running, and a failed change restores the previous values with an inline error.
- On mobile, the composer bar stays one row: a compact context chip opens a bottom sheet with the native agent, model, and reasoning selects. The chip shows the agent name, or `Model` when no agent is set; the sheet carries the full value and the chip's accessible name includes both. The chip is 64px at 360px and below and 96px above. `Suggest` stays inline. `⋯`, Stop, and Send are actual 44px squares with no overlapping hit expansion; Send and Stop use the same square rhythm. `Undo`, `Dictate`, and `Queue` live in `⋯`. `Attach` stays inline above 420px, moves into `⋯` while running between 361px and 420px, and moves into `⋯` at all states at 360px and below. Text entry fields remain 16px to avoid browser zoom.
- The mobile context sheet is a bottom sheet with a title, close control, scrolling body, and a pinned footer with a note and `Done`. It traps Tab, closes on Escape or the scrim, and returns focus to the chip. The selects are the same native controls as desktop; they are disabled while the run is active with the note `Changes wait for the current run to finish.`
- Slash commands later.
- Dictation is a quiet composer action when Voice transcription is enabled in the hub and the browser supports microphone capture in a secure context. The browser records audio, posts it to the hub, and the hub forwards it to the configured OpenAI-compatible STT endpoint. The transcript is appended to the draft and is never sent automatically.
- While recording, the composer shows a status row with a pulsing dot and an elapsed timer, changes the dictation action to `Stop`, and disables Send. Stopping shows `Transcribing…` until the text arrives. Errors appear inline with `Dismiss`.
- Dictation needs HTTPS or localhost. The hub does not terminate TLS; an operator serving the web client over plain HTTP on a LAN cannot use microphone capture. The Settings panel states this and notes that the hub does not store audio and never sends the endpoint key to the browser.
- Wearable clients can show short reply options from deterministic steering, a configured 4B model, or extracted agent choices.
- Drafts persist per session on the hub and follow the session across clients and reloads.
- When the browser is offline, the composer shows `Offline · sends will be queued.` A send becomes a queued optimistic row (`Queued. Sends when the hub is reachable.` with Discard), persists across a reload, and replays in order when the hub returns. The topbar shows `N queued` until the queue drains. A terminal 4xx still shows `Not sent.` with Retry.
- Drafts autosave shortly after typing and clear after a successful send.
- Form drafts use the same hub store with namespaced keys: question/attention fields per attention item, and the edit-and-fork textarea per source message. They restore after a route change or reload; answering, Cancel, or Save & fork clears the relevant slot. The tiny status line reads `Saving draft…`, `Draft saved`, or `Draft not saved`.
- While the agent is running, an interrupt button sits beside send in the composer bar. The same action is available in the details panel.
- On OpenCode, Send becomes **Steer** while the agent runs; the hint reads `Agent running · Ctrl/⌘ Enter to steer`. The message lands at the next safe step boundary, running tools finish first, and it stays in the transcript.
- While OpenCode runs and the provider supports both deliveries, one quiet **Queue** action sits beside Send on desktop and in the `⋯` menu on mobile. It applies to the current draft and queues it for the next idle boundary; it never changes what Send does, so there is no delivery mode to check. The action is absent when the provider cannot steer.
- Queued messages render as a one-line summary above the composer: `Queued · N · first message…`, with a chevron that expands the list. `Send now`, shown only while the turn is running, promotes an item to steer delivery; Remove cancels it. A delivered item leaves the summary and arrives through the transcript. The count is announced when it changes.
- A pending cross-session handoff appears at the end of the transcript as one action card per proposal, in the same card grammar as an inline question: a `Handoff` type badge, target title, project/provider and ref, editable message, reason, `Send handoff`, and `Cancel`. The agent proposes; the owner reviews and sends. Failed cards keep the message editable and show the error with `Retry handoff`; sending disables both actions. A pending proposal is aborted when the source session receives a new user message, and its card leaves the transcript; a failed proposal stays for explicit Retry. A quiet `Pending handoff cancelled because the session moved on.` notice appears at the bottom with a Dismiss action and clears itself after six seconds. A sent card stays as a read-only receipt: the message becomes prose, the status reads `Sent` in the success colour with a tabular timestamp, and Send/Cancel disappear while a polite status announces the target. Sent receipts are placed in the transcript at their sent time, with date separators rebuilt around them; pending, failed, and sending proposals stay at the end as actionable cards. When the source provider supports synthetic notices, the sent card also reads `Session receipt queued for its next turn.` The receipt enters the provider inbox without starting a turn and becomes a provider-visible synthetic notice on the next run. The transcript keeps the newest five sent receipts plus every open proposal. It scrolls to a new card when the user is at the bottom. Buttons are 44px on mobile and the textarea is 16px there.
- A handoff can carry an optional compact `Evidence` reference (queue entry, log line, commit, or run ID), shown as an 11px faint line on the card. Agent-facing MCP proposals are recorded as `agent`-authored; REST/API and assistant-action proposals are `owner`-authored. The source synthetic receipt is compact: target, time, evidence, and “No action is required.” The full message and metadata stay in the hub and the provider message metadata.
- Sent handoff messages longer than 800 characters clamp to six lines with a `Show full message` / `Show less` disclosure. The full text remains available; only the visual height changes.
- Open WebUI has no queue or steer path: Send is disabled while a response is active, the hint reads `Agent running · interrupt to send`, and the Interrupt action sits beside it. No Queue action or queue summary renders.
- `Suggest` is a quiet composer action when the reply model is configured. It fetches on demand and shows four to six model suggestions as wrapping chips above the textarea, labelled `Suggested`. Each chip carries a role tag where it helps: `Alt`, `Next`, `Check`, `More`, or `Ask`; the primary answer has none. Selecting a chip inserts the text into the draft (append when a draft already exists) and focuses the composer. It never sends. The hub still classifies the moment, but `wait` and `done` also get suggestions: a running or finished turn is still a conversation, so the row never shows a `No reply needed` notice. Loading reads `Reading session…`; a failed or empty result reads `No grounded suggestions. Try again or check the reply model.` with `Retry`. The row is dismissible. No chips render until the user asks; the visible idle session may warm the hub cache in the background.
- Mobile suggestion chips and their dismiss/retry controls use 44px targets; chips wrap above the textarea without horizontal overflow.
- The web warms the reply cache for the visible, idle session after a one-second dwell; the G2 warms it two seconds after an idle chat is open. Prefetch never renders chips, is skipped while the turn runs or the tab is hidden, and fails silently. A manual Suggest still shows its own loading state if the context changed.
- Selects use content sizing (`field-sizing: content`) so the agent, model, and reasoning controls fit their current value. Full-width form selects keep their width.

### Details panel

- Above 1320px, details is a 300px column beside the transcript.
- Between 761px and 1319px, details opens as a right-side overlay with a scrim.
- At 760px and below, details opens as a bottom sheet with a pinned footer.
- Provider, base URL label, project, directory, branch when available.
- Native session ID and reference.
- Parent session reference and an `Open parent` action when the session is a fork.
- Session name with a `Rename` action when the provider exposes the `rename` capability. The inline field saves on Enter, cancels on Escape without closing the panel, updates the topbar title and details name, and is disabled while saving. OpenCode uses `PATCH /api/session/{id}`; Open WebUI uses the chat update endpoint. Hermes is not wired into the provider registry yet; when it is, it inherits the Open WebUI adapter. A provider without the capability hides the action.
- `Fork session` when the provider exposes session forks. The action opens the new child session and keeps the parent reference visible.
- Agent, model, status, created, updated. Detail values are 12px/500; IDs, paths, references, and endpoints use mono. Times, costs, and token counts use sans with tabular figures.
- Cost and tokens when available.
- Parent session when the session is a subagent.
- "Open in provider" link.
- Copy reference.
- Interrupt and mark read.
- Provider-specific actions.
- The overlay traps Tab within the panel, re-enters the panel if focus escapes it, closes on Escape or the scrim, and returns focus to the details toggle. Below 1320px it exposes `role="dialog"` and `aria-modal="true"`; above 1320px it is a labelled column, and Escape still closes it as a shortcut.

### Assistant dock

- The chat topbar carries an **Ask** action next to Details when the hub has an
  assistant model configured. It is the only entry point to the assistant in
  M1; there is no rail destination and no sidebar entry.
- Ask opens one hub-owned thread for the session. The thread is read-only: the
  hub reads the session, attention, the pending question, a tool digest, and
  the transcript tail, then answers. It never sends, answers, approves, or
  interrupts.
- The panel is 400px on the right below the topbar and full-width at 760px and
  below. Opening it closes Details; Escape closes it and returns focus to Ask.
- Reopening a session returns to the same thread, including after a reload. One
  thread per session scope is the M1 model; there is no thread list and no new
  button.
- The composer offers four suggested questions before the first turn. While a
  run streams, the primary action becomes **Stop**. The footer always reads
  `Read-only · no writes`.
- The hub reports what it read and which model answered as **agent activity**,
  directly above the answer; the action card is the only write surface.
- The answer renders like a chat message, through the same Markdown renderer:
  headings offset by one, lists, tables, fenced code, inline media through a
  preview ticket, and Mermaid. A file mention is the chat's quiet preview
  button and opens the same sheet when the thread has a session directory.
  Project and global threads have no single directory, so they keep the text,
  code, and links without file targets. The question stays plain text.
- **Writes (M2).** When `assistant.allowWrite` is on, the model may propose one
  action: send a message, answer a **normal** pending question, stop the
  running turn, or draft a cross-session handoff. It may not answer a
  permission prompt (`destructive` or `sensitive`); that card is a failed
  proposal with a link to the Inbox, where the command and risk are shown. The
  proposal renders as an **action card** inside the answer: what would happen,
  the message text (editable for `send` and `handoff`), one primary action, and
  Cancel. Nothing is sent until that primary action is pressed, and the card
  records the outcome (`Sent`, `Answered`, `Stopped`, `Cancelled`, `Failed`).
- A **handoff action card** names the source and destination sessions, shows
  the destination project/provider/ref metadata, and keeps the instruction and
  optional `Why` and `Evidence` fields editable. The hub resolves both sessions
  before the card is shown; a missing target or a self-handoff is a failed
  proposal with the reason. `Send handoff` confirms and sends in one step, then
  the card reads `Sent`, adds `Session receipt queued for its next turn.` when
  the source provider accepted the synthetic receipt, and links to the source
  session. The source chat keeps the sent handoff card. One action at a time
  still applies.
- A pending action expires after 24 hours: the card reads `Expired`, keeps its
  payload, and loses its buttons. A thread is never evicted while an action is
  pending.
- If the hub restarts mid-answer, the thread shows one assistant turn reading
  `The answer was interrupted by a hub restart.` and accepts the next question.
- While an action is pending the composer is disabled with
  `Decide the action above first…`. One action at a time.
- Cancel is always available, even when writes are disabled; the primary
  action is then replaced by `Writes are disabled. Cancel to unlock the
  thread.` While a decision is in flight the card reads `Working…`.
- The thread shows when it happened: a day label (`Today`, `Yesterday`, or a
  date) before the first turn of each day, and a 10px time on every role line.
- Every answer carries one 10px evidence line: turns read, older turns omitted
  when the context budget dropped any, failures found in the session history,
  attention items in the context, the session's last-activity time (`session as
  of …`), the provider compaction the answer read when one exists (`history
  Nov 19`, with a bare time only when it is from today), and token usage. It is
  how a partial or stale answer announces itself.
- Every answer with work behind it carries the chat's **Agent activity** block
  above the answer, and above the live text while it streams. Tiles are the
  `context`, `history`, `search`, `model`, and `tool` families; a tile's label
  prefers a recorded count (`20 turns`, `5 hits`) over its duration. Selecting
  one opens the chat's step panel after that tile's row, with the recorded
  metrics as rows. A stopped run's in-flight step reads `cancelled`, not
  `error`. Arrow keys move between tiles; Escape closes the panel.
- The session scope does not paste the transcript. It reads turns on demand
  through four read-only tools — search, read turns, list tool calls, read one
  output — and each call is a `tool` tile with its result count (`5 hits`,
  `3 turns`, `40 calls`). The evidence line names both: `Read 3 turns · 5 tool
  calls`. The tools page the session back to 2,000 messages (200 per provider
  page, 32 MB, 5 s); if a cap stops the scan, the answer says the oldest turns
  are not loaded instead of guessing.
- **Project and global** threads get the session-scoped version of the same
  idea: list sessions, search inside them, read a chosen session's turns, and
  open its tool output. Every read names its session; a run reads at most three.
  The tile detail carries the session title, so a global answer shows which
  session each read came from.
- The footer reads `Read-only · no writes` when writes are off and
  `Writes need your confirmation` when they are on. There is no silent write
  mode.
- **Project scope.** When the session belongs to a project, the scope chip
  switches the thread to `This project`. Context is that project's sessions
  (titles, status, last activity, cost, unread), its inbox, and transcript
  search hits. Answers name the session that holds a detail, or say the detail
  is outside the scope.
- **Global scope.** The Overview topbar carries **Ask**, which opens an
  `All sessions` thread as a modal dialog with a backdrop (bottom sheet at
  760px and below). Session and project threads stay in the dock. Its context is the inbox (the authoritative "needs
  me" list), running sessions, 24-hour errors, a project rollup, a 12-session
  index, and transcript search hits.
- **MCP tokens.** In the global thread, an owner can ask the assistant to
  create, list, or reveal a short-lived MCP token. The assistant prints the
  token id, expiry, scope, and secret in a fenced block. Prior turns redact the
  secret before the next model prompt; asking again calls the reveal tool by
  id. Session and project threads do not offer this. Paired browser or device
  sessions cannot mint or reveal tokens; sign in with the owner token to use
  the flow.
- **Finding across sessions.** Every scope can search all sessions by title,
  transcript, and metadata (project, directory, model, agent, ref). A hit is
  named with its session title and ref; the session scope says it cannot read
  another session's transcript from that thread. Search and read results also
  attach **Referenced messages** under the answer: a quiet list of title, time,
  role, and a two-line excerpt. Selecting one closes the dock and opens the
  session at that message, where the transcript focus bar offers
  `Fork from here`.
- **Finding and prompting.** A session ref or `/sessions/<ref>` URL in the
  question attaches that session's metadata and last turns. From project or
  global, the assistant may propose one message to a session present in that
  context; the card shows `To: <session>` and `Send to "<session>"`. It still
  cannot answer questions or interrupt from these scopes.
- The G2 and VR surfaces are unchanged. The glasses are a consumer of
  conclusions (M5), not a chat client.

## 9. New session

```text
┌──────────────────────────────────────────────────────┐
│ New session                                      ×    │
│                                                      │
│ Provider   [desktop-opencode ▾]                       │
│ Project    [/home/me/oktoso ▾]                     │
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
- On prompt success, the client opens the session and shows the prompt in the transcript. On prompt failure it keeps the panel open with the error and offers Retry prompt and Open session; it never navigates into an empty chat.
- The panel is inline, not modal: Tab is not trapped. Opening it focuses the first field (the provider select); closing it, with Cancel or the close control, returns focus to **New session**.

## 10. Providers

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
- The credential field carries a one-line muted hint: OpenCode points at `opencode service get password` on the provider host, and Open WebUI points at **Settings → Account → API keys**. The hint replaces guesswork about where a secret comes from; it never prints the stored value.
- Saving writes the provider to `hub.config.json`, hot-loads the adapter without a hub restart, invalidates provider caches, and runs a health check.
- Check runs a health request and updates the row.
- Capability chips explain why an action is hidden.
- Provider credentials never render after save. Editing leaves the secret blank to keep the existing credential.
- The add and edit form is inline, not modal: Tab is not trapped. Opening it focuses the first enabled field (Provider ID, or Type when editing) and closing it returns focus to **+ Add** or the row's **Edit** control.

## 11. Search

- Search is a rail destination on desktop and a bottom-navigation destination on mobile. The search field is 14px on desktop and 16px on mobile.
- At 420px and below the `PROVIDER` and `STATUS` labels own their line, so wrapped chips align with the label instead of starting under its right edge.
- At 1100px and above the search input, provider filter, and status filter share one toolbar row; the input can grow to 640px. Below that they wrap in source order.
- A `Scope` control selects **Sessions** or **Messages**; the choice lives in the URL (`?scope=messages`) so the back stack restores it.
- Sessions searches titles, projects, directories, and agents through the hub session cache. Provider and status filters mirror the Sessions view; results show title, provider, project or directory, status, and unread or attention cues.
- Messages searches the transcript cache through `GET /api/v1/search`. Provider and status filters apply. Results show the session title, provider, project, role, and the matching excerpt with the query highlighted in `<mark>`. Opening a message hit adds `?message=<id>` to the session URL, scrolls that message into view, and shows the focus bar with `Fork from here`.
- Message search needs the transcript cache: when it is off, the view says so and points at Settings → Local data. While the index catches up, the summary says so and an empty result explains it.
- Both scopes keep the query, provider, and status in the URL. Typing replaces the history entry; changing a filter or the scope adds one.
- Returning to a search route renders its last successful result set from the screen cache while the same query refreshes in the background. Cached empty results read `Checking for sessions…` or `Checking messages…` until the refresh settles.
- Keyboard: `Cmd/Ctrl+K` opens search from any signed-in screen, Tab moves through filters and results, and Escape clears the query.

## 12. Settings

- **Access** is a panel in the top settings grid: credential (`Owner`, `Phone`, or `G2`), scopes, expiry, and an Admin yes/no row, with the existing Disconnect action. The note names what the profile can do. Owner shows `Scopes: All`, `Expires: Never`, `Admin: Yes`; paired sessions show a concrete expiry and `Admin: No`.
- Pairing links are generic. The app declares its profile when exchanging the code: the G2 app requests `g2`, while a phone/browser defaults to `phone`. You do not choose a profile while pairing. A G2 link cannot be upgraded to `phone`. G2 cannot edit providers, settings, or automation configuration.
- **Assistant agent** is the first assistant panel: enable, allow confirmed
  writes, base URL, model, context messages, timeout, and a masked API key.
  `Load models` fills the model datalist; `Test connection` checks the unsaved
  values; `Save` persists. The config file seeds it on first boot.
- Reply assistance and voice transcription follow unchanged.

- Appearance: theme, density, message width.
- Notifications: per-device Web Push with enable, test, and disable; a permission badge; per-type routing (Immediate, Digest, Off) for permission, approval, question, unread, and error; a digest window; quiet hours with an IANA time zone; and a device list with per-device revoke. Channel credentials stay on the hub; a device only sees its label, device ID, and last-seen time.
- Automation: pause all, per-watcher pause, pending approvals with Approve and Deny, and the most recent runs with their decision. An approval with a proposed answer offers **Always allow** behind a second confirmation; remembered shapes are listed below with uses and Revoke. **Pause all** and a per-watcher pause abort an action already in flight, not just new work. Watchers and budgets stay file-configured; the panel never edits config.
- Templates: a panel between Watchers and Approvals lists the configured `automation.templates` with the id, provider, and whether a first prompt is attached. **Start** creates the session and sends the prompt, ignoring pause, dry run, budgets, and quiet hours, and opens the new session. Start is a quiet row action (32px) with an accessible name that includes the template; while it runs the row reads `Starting…`. An empty panel names `automation.templates` and the hub config. If the session is created but the first prompt fails, the panel keeps the error and offers **Open session**, because the error is not retryable.
- Reason codes (`not_low_risk`, `form_unmapped`, `budget`, `quiet_hours`) render as one plain sentence in approvals and recent runs, in Settings and in the Inbox. The raw code stays on the run record, not on the screen.
- Pending automation approvals also appear in the Inbox under an `Automation` group, using the same approval card. They count toward the Inbox badge. Approve executes the stored plan; Deny records the decision.
- Shortcuts: command palette, new session, search, send.
- Devices and tokens: pair a browser or wearable with a five-minute link, rotate the owner token, and revoke all paired sessions. Per-device revocation is later.
- Local data: one panel for everything the hub keeps on its own disk. The
  transcript cache keeps its enable toggle, keep-for days, maximum session
  count, size readout, Save, and Clear. Reply feedback, drafts, and read markers
  each show a count and a Clear action. Retention is per store — cache 7 days,
  markers and feedback 30, drafts **Never** — because a draft is unsent work
  while the cache is derived data. **Clear all local data** asks for a second
  click. The note states that providers own the conversations and that turning
  the cache off also deletes the search index.
- Assistant: reply assistance and voice transcription endpoints. The voice section explains that web dictation needs HTTPS or localhost, that audio goes through the hub, and that the STT key stays on the hub.
- About: hub version, provider versions, build info.

## 13. States

Every screen needs these states:

- **Loading:** skeletons for lists and the transcript. Do not block the whole app. The transcript skeleton is decorative, `aria-hidden`, and paired with one polite announcement; it never replaces optimistic or queued rows.
- **Revalidating:** cached route data stays in place. A 2px accent line at the bottom of the topbar marks the background refresh, and a cached empty panel reads `Checking for …` until the request settles. A cold screen uses **Loading**, not the line.
- **Empty:** a clear next action.
- **Offline provider:** amber status chip, cached data labeled "last synced", retry action.
- **Auth error:** red status chip with a direct path to provider settings.
- **Error:** inline error card with code and retry.
- **Streaming:** append text, keep scroll position unless the user is at the bottom.
- **Disconnected hub:** persistent banner with reconnect and last sync time.
- **No attention:** calm empty inbox with a link to sessions.
- **No usage:** the Overview report renders em dashes and states how many sessions reported nothing.
- **Partial usage:** the report keeps the rows it has and the note names the sessions that did not report cost or tokens.
- **Signed out:** owner/session token form, a note to open a pairing link, and a secondary **Scan pairing QR** action only when the browser is a secure context and exposes the Barcode Detection API. The camera overlay has one cancel action and an inline camera error. It is a modal `dialog`: focus moves to Cancel on open, Tab stays inside it, Escape or Cancel closes it and stops the camera, and focus returns to **Scan pairing QR**.
- **Pairing page:** server-rendered confirmation outside the app shell. It shows the hub origin, expiry time, and one primary **Pair this device** action. An already-paired browser gets **Open Oktoso** plus a secondary **Pair again** action. An expired page points to `p` in the hub terminal. It uses the same self-hosted Inter and IBM Plex Mono stacks as the app so it does not depend on the web build or an external CDN.

## 14. Visual language

### Tone

Quiet, precise, and work-focused. The interface should disappear behind the conversation. Avoid decorative gradients, oversized headings, and card-heavy dashboards.

The brand mark is one accent tile with a dark octagonal hub and a centered node. It appears at 36px in the rail and 40px on the signed-out and pairing surfaces. It is the only logo in the shell; do not repeat it in page content or use it as a decorative icon. The same geometry supplies the favicon and app icons; those are fixed dark-theme artwork.

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

Provider identity and state are separate systems. In session lists and inbox cards, provider badges use a neutral mark and the provider name. Provider accents appear only on the Providers screen, where the 30px provider mark carries the accent tint and border to identify a connection rather than a state:

- OpenCode: mint `#7ee2b8` dark, `#0b6b3a` light
- Open WebUI: blue `#9cc0ff` dark, `#2f4fb5` light
- Hermes: amber `#ffd166` dark, `#8a5200` light

State color is reserved for status and attention. Unread is shown by title weight, not another dot. A session has one status dot; attention has one amber marker.

### Contrast and elevation

- Faint text stays above 4.5:1 on cards and the canvas.
- Interactive controls use `border-strong`, which clears 3:1 on the card surface.
- Card edges use `border`; dividers use `border-subtle`.
- Controls use `surface-2`; active rows use `surface-2` plus an accent inset bar. The active rail icon takes the accent; its label stays `text`.
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

- Sans: Inter Variable, self-hosted through Fontsource, 14px base.
- Mono: IBM Plex Mono, self-hosted through Fontsource.
- Weights: 400, 500, 600, 700 only.
- Line height: 1.6 for chat prose, 1.5 for UI copy, 1.3 for titles.
- Numeric metadata uses tabular figures.
- Code and identifiers use IBM Plex Mono.

### Spacing and shape

- Base spacing unit: 4px.
- Scale: 4, 8, 12, 16, 24, 32px. Optical 2px exceptions remain for rails and count badges.
- Radius: 4px for badges, 8px for controls, 12px for cards, 16px for sheets, 999px for pills.
- Borders carry structure. Shadows are minimal and functional.
- Icons: 16 or 18px line icons, 1.7px stroke. The rail and bottom navigation share the same set; lettermarks and text glyphs are not used for navigation or icon-only controls.
- Desktop controls are 32px high. Quiet message actions are 28px. Mobile controls keep a 44px target. The composer `⋯`, Stop, and Send cluster uses three actual 44px squares with no overlapping pseudo hit area.

## 15. Mobile layout

```text
┌──────────────────────────────────┐
│ Oktoso                 ⌕  +   │
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

- Bottom nav has five destinations: Overview, Inbox, Sessions, Search, Settings. Providers move under Settings.
- Chat is a full-height route with a back button and the session title in the topbar. The bottom navigation remains visible.
- Details open as a bottom sheet with a pinned footer.
- The composer is pinned above the bottom navigation, safe area, and keyboard.
- Filters wrap below 420px so no chip is clipped or hidden.
- Provider machine names drop below 480px; the provider remains identifiable by name.
- The external chat action drops below 360px; the details sheet still exposes it.
- Form fields use 16px text on mobile to avoid browser zoom.
- Modal content scrolls inside the sheet while the footer actions stay pinned.
- Long press a session row for pin, mark read, copy ref, and open in provider.
- Pull to refresh on the list.

## 16. Glasses adaptation

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

### Phone bridge

The `/apps/even-g2/` webview is the phone companion, not a second desktop hub.

- One header status (`Connected`, `Not connected`, or an error), one title, and a quiet version pill.
- Unpaired: one **Connect this phone** card. A pairing link or code is primary; a hub token is a disclosure.
- Connected: the pairing form collapses to `Connected · <host>` with **Pair another**. The phone keyboard is the fallback surface.
- The keyboard stays disabled with `Open a session on the glasses first` until a session is attached, and it is named for screen readers.
- A **Glasses control** panel below the phone keyboard shows a fixed 2:1 mirror of the 576×288 screen, its list, and the current selection. Tap a row to open it; swipe up or down; double-tap to go back. Up / Down / Select / Back stay as the 44px fallback. Up/Down on the phone or glasses switches the glasses list to a text mirror with a `›` marker; **Use glasses list** returns to the native list. Expand opens the same panel full-screen; Close or Escape returns. The preview keeps the app's 54-column wrapped lines and clips rather than reflowing, so content changes never resize it.
- The symbol guide is user-facing; bridge diagnostics and the reply audit sit under **Developer tools**. Every disclosure row is a 44px target.
- The page keeps browser zoom. Control borders meet 3:1 and body text meets 4.5:1 against the dark surface.

## 17. VR adaptation

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

## 18. Accessibility

- All actions are reachable by keyboard.
- Focus rings use the accent color and remain visible.
- Modal sheets and dialogs trap Tab, close on Escape, and return focus to the control that opened them. Focus never rests behind a scrim.
- Inline panels are not modal and do not trap Tab. They move focus to their first field when they open and return it to the opener when they close.
- A polite, visually hidden live region announces only blocking Inbox items that arrive after the first load. The initial list, ordinary refreshes, and non-blocking items stay silent.
- Icon-only controls carry an explicit accessible name. Toggle and filter chips expose `aria-pressed`; navigation destinations and the active session row expose `aria-current`.
- Status is not conveyed by color alone. Pair dots with labels.
- Times use `<time>` elements. Relative labels keep the absolute update time in `dateTime`.
- Approval and deny actions have distinct labels and confirmation where needed.
- Message text uses semantic headings and lists.
- Respect `prefers-reduced-motion`.
- Minimum touch target: 44x44 px on mobile.
- Screen-reader labels for icon-only buttons.
- The glasses UI uses large text and short lines. The VR UI keeps panels at readable angles and distances.

## 19. Content guidelines

- Use provider names as the providers use them: OpenCode, Open WebUI, Hermes.
- Status words: running, idle, error, offline.
- Attention words: Permission, Question, Unread, Error.
- Actions: Allow once, Always allow, Deny, Answer, Mark read, Retry, Open.
- Avoid “AI agent” in every label. Use the session title and provider.
- Show timestamps as relative for recent items and absolute for older ones.
- Error messages name the failing provider and the next action.

## 20. Prototype

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

### Sessions scope

- The Sessions list defaults to the tree. `All` shows roots with nested subagents, `Root` is roots only with child counts, and `Subagents` is a flat child list. Child sessions carry a `SUBAGENT` tag and a chevron disclosure on their parent.
