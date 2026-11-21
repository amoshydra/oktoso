# Design Lock — v1.38

Status: **frozen**.

- Version: `design-v1.38`
- Parent: `design-v1.37`
- Date: 2026-11-21
- Git tag: `design-v1.38`
- Scope: information architecture, visual language, type scale, spacing, responsive behavior, interaction states, and the static prototype.
- v1.1 scope: session transcript loading, scroll anchoring, Markdown rendering, and collapsed agent activity.
- v1.2 scope: the transcript copy action and hub-backed composer dictation.
- v1.3 scope: composer attachments, Open WebUI in-chat branch switching and retry, and OpenCode session forks.
- v1.4 scope: composer reply suggestions and select sizing.
- v1.5 scope: the parent/subagent session tree and the in-flow composer status row.
- v1.6 scope: question choice detail, option descriptions, and custom answers.
- v1.7 scope: the composer delivery toggle and the queued-message tray.
- v1.8 scope: the steer-default send action and the collapsed queue summary.
- v1.9 scope: the one-row mobile composer, context sheet, and one-line draft.
- v1.10 scope: transcript edge masks, the floating jump, and the in-transcript background row.
- v1.11 scope: the composer 44px control cluster, the 728px reading column, details value typography, and mobile target fixes.
- v1.12 scope: the shared icon grid, type-role consistency, provider accents, and one-dot session state.
- v1.13 scope: the wide-screen content field, the sessions table, the two-column Inbox and Providers layouts, the search toolbar, and the single-title chat header.
- v1.14 scope: the chat panel and composer aligned to the 640px reading column.
- v1.15 scope: the Overview destination and its usage report, the session details Data row for export, and the Settings Local data panel.
- v1.16 scope: the mobile session-scope header, Providers panel head, Inbox toolbar stacking, and row spacing.
- v1.17 scope: the accessibility semantics and focus pass.
- v1.18 scope: login QR focus handling, inline-panel focus restore, and the Inbox live region.
- v1.20 scope: transcript loading, waiting, and error states in the chat shell.
- v1.21 scope: the Settings Automation Templates panel and human reason labels.
- v1.22 scope: the read-only session assistant dock and its topbar Ask action.
- v1.23 scope: assistant write confirmations, the action card, and the opt-in
  write badge.
- v1.24 scope: the assistant evidence line under each answer.
- v1.25 scope: the action card's disabled-writes, in-flight, and outcome states.
- v1.26 scope: assistant thread time markers and the session as-of stamp.
- v1.27 scope: the evidence line reports failures found in the context.
- v1.28 scope: the evidence line names the compaction it used.
- v1.29 scope: permission prompts are answered in the Inbox, and answer cards
  show the provider's question.
- v1.30 scope: expired actions and runs interrupted by a restart.
- v1.31 scope: project and global read-only scopes for the assistant.
- v1.33 scope: transcript search, session refs, and targeted sends from project
  and global scopes.
- v1.34 scope: cross-session search from the session scope, including metadata.
- v1.35 scope: the per-thread model picker, the activity tile block, and the
  global assistant dialog.
- v1.36 scope: runtime assistant endpoint settings and the Settings panel.
- v1.37 scope: activity order and parity with the chat's activity tile block.
- v1.38 scope: one shared activity model and renderer, with hub families and
  structured step detail.
- v1.19 scope: session rename across providers and search filter label alignment.

## What is frozen

The approved design reference is the state tagged `design-v1`:

- [`ui-ia.md`](ui-ia.md) — information architecture, screens, flows, visual language, and responsive rules.
- [`visual-audit.md`](visual-audit.md) — contrast measurements, component rules, design rationale, and known follow-ups.
- [`prototypes/index.html`](prototypes/index.html) — interactive visual reference.
- [`prototypes/styles.css`](prototypes/styles.css) — frozen token and component reference.
- [`AGENTS.md`](../AGENTS.md) — working rules for future UI changes.

The prototype is a visual specification, not production client source. Production UI code lives in `apps/web` once scaffolding begins. Do not import or copy the prototype's DOM/rendering code into the product.

## v1.1 transcript revision

The session transcript in the production client now uses newest-first pagination, starts at the latest message, loads older pages at the top with scroll anchoring, renders message prose as sanitized Markdown, collapses tool/reasoning activity, and groups consecutive tool-only assistant turns into a collapsed activity block. The fixed topbar and pinned composer keep back, context, and interrupt available.

All tokens, hierarchy, navigation, and other screens remain `design-v1`. The v1.1 revision does not change the overall information architecture.

## v1.2 chat interaction additions

The transcript and composer gained two quiet, capability-gated interactions. No
routes, screens, navigation, hierarchy, type role, spacing step, radius, or
color token was added.

- **Copy:** a completed assistant message with text exposes one quiet `Copy`
  action after the message. It is 11px, uses the existing control radius, and
  gets a 44px target on mobile. Success reads `Copied` for two seconds and is
  announced; failure reads `Copy failed`. The action copies the raw text parts,
  not reasoning or tool payloads.
- **Dictation:** when Voice transcription is enabled and the browser supports
  microphone capture in a secure context, the composer exposes one quiet
  `Dictate` action beside Send. Recording shows a status row with a pulsing dot
  and a timer, changes the action to `Stop`, and disables Send. `Stop`
  transcribes through the hub and appends the transcript to the draft; it never
  sends automatically. Errors appear inline with `Dismiss`.
- The browser records audio and posts it to the hub. The hub forwards it to the
  operator-configured OpenAI-compatible STT endpoint and does not store the
  audio. The provider key never reaches the browser.
- Browser dictation needs HTTPS or localhost. The operator-owned TLS boundary
  is unchanged; plain HTTP on a LAN cannot capture the microphone.
- The Settings copy now states the web-composer use, the secure-context
  requirement, and the privacy boundary.

## v1.3 attachment and branching additions

The composer and transcript gained capability-gated attachment and branch
controls. No routes, navigation, hierarchy, type role, spacing step, radius, or
color token was added.

- **Attachments:** when the provider exposes `attach`, the composer shows one
  quiet `Attach` action. Staged files appear as wrapping chips above the
  textarea with name, size, and a remove control. Send is enabled when there is
  text or at least one attachment. The chips use the existing 8px control
  radius and 11px metadata. The remove target is 44px on mobile.
- **In-chat branches:** when the provider exposes `branches`, an assistant
  message with siblings shows one quiet branch picker under the message, beside
  Copy. It reads `‹ n / N ›` with 28px desktop controls and 44px mobile
  controls. Switching replaces the visible path; the picker does not open a
  menu or add a toolbar. When the provider exposes `retry`, one quiet `Retry`
  action creates a new assistant sibling without overwriting the old answer.
- **Session forks:** when the provider exposes `fork`, the details panel adds
  `Fork session`. A forked session shows `Open parent` in details and keeps the
  parent reference visible. The session list keeps its existing rows; there is
  no new tree screen.
- **Capability gating:** a provider without `attach` shows no composer upload
  control. A provider without `branches` shows no picker. A provider without
  `fork` shows no fork action. Unsupported API calls return a capability error.
- Attachment files are staged on the hub, expire after one hour, and are
  removed after a successful send. The client receives only attachment IDs and
  metadata, never provider credentials or another client's file bytes.

## Chat shell alignment (2026-11-02)

The production chat now follows the design-v1 prototype shell. The fixed topbar owns the session title as the page `h1`, the provider/status subline, back, and details. A 300px session sidebar sits between the rail and the transcript on desktop. The transcript is an internal scroll region with a pinned composer; the duplicated sticky transcript header and hero card were removed. Details is a column above 1320px, a right overlay below it, and a bottom sheet on mobile. Permission, approval, question, and error attention render inline.

This aligns implementation with the existing prototype and does not add tokens, routes, or navigation. The v1.1 transcript reading model is unchanged.

## Background work (2026-11-14)

- Background shell runs render as transcript rows outside the activity grid:
  terminal icon, command, status pill, elapsed, and Show output.
- The Details panel gains a Background section listing live shells and
  subagents, with Open session for subagents. It is absent when nothing runs.
- A background subagent's liveness is the child session's status, never the
  launch call's metadata. Old subagents read as completed.
- A composer status row above the composer opens Details while background work
  is live. It names the live work (`1 subagent running`, `1 shell running`, or
  `N running`) and shares the row with Jump to latest.
- Sessions default to the parent/subagent tree; the Root and Subagents chips
  are filters, and child sessions carry a `SUBAGENT` tag.

## Question choice detail (2026-11-15)

Question forms now show the information the provider sends, instead of dropping
it into a native select.

- **Select fields.** A provider `select` renders as a radio list, not a
  dropdown. The field title is a 10px uppercase label; the field description is
  the question at 14px/500; `Select one answer` is the 11px hint. Each row has
  a radio, the option label at 14px/500, the provider description at 12px/1.5,
  and a 10px numbered index at the right. Rows use the 8px control radius and
  a 1px border; the selected row uses the accent border and 2px inset.
- **Custom answers.** A field with `custom: true` gets a final
  `Type your own answer…` row. Selecting it reveals a text input. The field
  value is the typed text, and Submit stays disabled while it is empty. The
  custom row is the last row and takes the next number.
- **Required.** OpenCode's forms expect a visible field to be answered unless
  the provider sets `required: false`. Submit reflects that: it is disabled
  until every required field has a value.
- **Question text.** The field description is the question in the card. When a
  field description exists, the card does not repeat the latest assistant
  question; the transcript above already provides that context.
- **No new tokens.** The change reuses the type scale, 8px control radius, 4px
  badge radius, accent state, and spacing steps. The option rows are controls,
  not new cards.

## Session tree and composer status (2026-11-15)

The session list now exposes subagents instead of hiding them behind a scope
filter or showing them as unrelated rows. This changes hierarchy and the
interaction model, so it is a new design version. Forks remain ordinary rows;
only `parentRef` subagents nest.

- **Sessions tree:** root sessions first, children nested behind a chevron
  disclosure. A parent shows `N subagents` in its meta and `N running` when a
  child is live. Children indent 16px with a quiet 1px rail, keep the 14px
  title, and add the existing 10px `SUBAGENT` tag. A parent is ordered by the
  newest update in its branch.
- **Disclosure:** a separate control at the right edge of the card, never a
  nested button. It is 32px on desktop and 44px on mobile. The card reserves
  trailing space so the time and status chip stay clear. The chevron rotates
  90 degrees when open. The left side of the card keeps the session action.
- **Scopes:** the list defaults to `All` (the tree). `Root` is roots only and
  keeps the child count. `Subagents` is a flat child list. A subagent whose
  parent is outside the loaded page appears under `Subagents without a loaded
  parent`.
- **Sidebar:** the chat sidebar uses the same tree inside its day groups. It
  expands the active session's parent automatically and groups a family under
  the parent's day.
- **Composer status:** the background chip and Jump to latest are one in-flow
  row above the composer, not two absolute pills. The row wraps; it never
  overlaps the transcript, the composer, or the other action. The background
  label names the kind (`1 subagent running`, `1 shell running`, `N running`).
- **Responsive:** at 760px and below the disclosure is 44px, children indent
  16px, and root rows keep the full content width. The status row wraps at
  320px. No horizontal overflow.
- **Accessibility:** the disclosure has `aria-expanded` and `aria-controls`;
  the child group is labelled `Subagents of <parent>`. Child aria labels read
  `subagent of <parent>`. The parent and child rows keep their normal session
  action and status semantics.

## Agent activity tiles (2026-11-14)

The agent activity block is a disclosure again, collapsed by default.

- Collapsed: one header row (label, step count, error count, time) plus a
  4-row dot stamp. Dots are 0.375rem, gap 0.1875rem, filled top to bottom and
  starting a new column every four steps, coloured by tool family and status.
  The stamp is `aria-hidden`; the header button carries the accessible name.
- Expanded: a wrapping grid of 49px tiles (56px reference x 0.875), 4px gap,
  8px radius, soft 6% family wash, no border, icon over one short metric. No
  horizontal scrolling.
- Selecting a tile opens the step inline under its row: a disclosure with a
  pinned header and footer and a body capped at 22.5rem. No modal.
- Status keeps its meaning: error red, running amber, live subagent green.
- Compaction is a transcript divider, outside the grid, with an inline summary.



A written Markdown file was previously readable only as escaped JSON inside the
collapsed activity row. Nothing moved out of that row and no route was added.

- A write tool part now opens to a file card instead of raw input JSON: file
  name at 12px/600, size and path at 10px, and the written body in a 360px
  scroll region. Markdown uses the transcript renderer at 12px with headings
  capped at 14px; other bodies are preformatted at 11px.
- The row keeps its humanized name, status, and chevron and gains the file name
  in the existing quiet meta slot.
- A file mention in message prose becomes a quiet button when the provider
  exposes `files`. It opens a modal preview with the file name as the title, the
  path beneath, one close control, and a scrolling body. The card's file name
  opens the same sheet. The body is the live read through
  `GET /api/v1/sessions/:ref/files`, a provider-resolved read jailed to the
  session directory.
- The preview renders by content type: Markdown, preformatted text, image,
  native video and audio controls, sandboxed HTML frame, and PDF frame. HTML
  uses a short-lived ticket rooted in its directory so relative assets load,
  and runs with scripts in an opaque origin. Media uses a 960px sheet with a
  520px floor; text stays at 720px.
- No new type, spacing, radius, color, or navigation token was added. The 360px
  preview region and the 10px metadata stay inside the existing activity body;
  the preview sheet uses the existing 16px sheet radius, large shadow, and
  pinned header with a scrolling body.

## Page chrome alignment (2026-11-07)

The production Inbox, Sessions, Search, and Providers screens no longer repeat the
page title in a hero card. The topbar `h1`, a shared 24px desktop / 16px mobile
gutter, and a compact toolbar own the page header. The rail and bottom navigation
use the existing 18px line-icon rule; desktop controls use the 32px spacing step;
the Settings card footers and the wide composer no longer wrap.

This aligns implementation with `design-v1` and adds no routes, tokens, type
roles, radii, or semantic color rules.

## Message delivery and queue (2026-11-15)

OpenCode's prompt API already separates steer from queue. The composer now
exposes both without adding a route, screen, or navigation model.

- **Delivery toggle.** While a turn runs and the provider advertises both
  `steer` and `queue`, the composer status row starts with a two-option
  `Steer | Queue` pill. The selected option uses the accent fill and
  `--on-accent` text. The toggle disappears when the turn ends, so the idle
  composer keeps one primary action: Send.
- **Send label.** The send action follows the toggle: **Steer** or **Queue**,
  and the running hint reads `Agent running · Ctrl/⌘ Enter to steer` or
  `… to queue`. Open WebUI keeps the disabled Send and the
  `Agent running · interrupt to send` hint.
- **Queue tray.** Queued messages are not optimistic transcript rows. They
  render in a quiet tray above the composer input, labelled `Queued` with a
  tabular count. Each row shows the text at 11px/1.5 with **Steer now** and an
  icon-only Remove. The tray uses the 8px control radius, the existing border,
  and a 24vh scroll cap; it never becomes a second transcript.
- **Delivery.** A delivered queued message leaves the tray and arrives through
  the normal transcript. The tray refreshes on session events and polls while
  the turn runs or items remain.
- **Responsive.** The tray stays in flow above the composer. At 760px and below
  the toggle options are 32px tall and the tray actions take 44px targets. Both
  wrap at 320px with no horizontal overflow.
- **Accessibility.** The toggle is a `role="group"` labelled `Message delivery`
  with `aria-pressed` options. The tray is labelled `Queued messages`; Remove
  carries the accessible name, and the send action's name states Steer or
  Queue. No state relies on colour alone.
- **No new tokens.** The revision reuses the type scale, spacing steps, 8px
  control radius, pill radius, accent fill, and `--on-accent`.

## Composer delivery revision (2026-11-15)

The v1.7 toggle put delivery mode in the status row, far from the send action it
changed, and put `Steer` next to a tray action named `Steer now`. This revision
removes the mode entirely and supersedes that part of v1.7.

- **Send keeps one meaning.** While a steer-capable agent runs, Send reads
  **Steer** and the hint reads `Agent running · Ctrl/⌘ Enter to steer`. The
  delivery default never changes under the user.
- **Queue is an action, not a mode.** A quiet **Queue** action sits immediately
  before Send and only renders while the turn runs and the provider supports
  both deliveries. It applies to the current draft, disables with an empty
  draft, and never relabels Send. Providers with queue but no steer keep the
  `Queue` send label.
- **Queue summary.** Queued messages collapse to one line above the composer:
  `Queued · N · first message…` with a chevron. Expanding reveals each message
  with **Send now** (running only) and Remove. The collapsed line uses the 8px
  control radius, 10px uppercase label, 11px preview, and the existing border
  and surface. The list caps at 24vh.
- **Feedback.** The tray count updates live and is announced through a polite
  status region. `Send now` replaces `Steer now` so the two steer actions no
  longer collide.
- **Responsive.** At 760px and below the summary is a 44px row and the expanded
  actions are 44px targets. The summary truncates the preview with an ellipsis
  instead of wrapping; the expanded list breaks long text. No horizontal
  overflow at 320px.
- **Mobile composer.** At 760px and below the composer bar stacks into two
  rows: the context selects first, then the actions, right-aligned. `Attach`
  stays inline; `Suggest` and `Dictate` move into a `⋯` disclosure anchored to
  the actions row; Interrupt reads `Stop`; Send stays the 32px icon. The menu
  closes on Escape, an outside pointer, or selection, and Escape returns focus
  to its toggle. Selects grow to 200px so the current model is readable.
- **No new tokens.** The revision reuses the type scale, spacing steps, 8px
  control radius, accent focus outline, and existing borders.

## Composer one-row revision (2026-11-15)

The v1.8 mobile composer used two rows for context and actions, then hid
`Suggest` in the overflow. That made the composer taller than the transcript
could afford and buried one of the most-used actions. This revision supersedes
the v1.8 mobile bar.

- **One row.** On mobile, the context chip and actions share one 44px row:
  `[Build · DeepSeek…] [Suggest] [Attach] [⋯] [Stop] [↑]`. `Suggest` and
  `Attach` stay visible. `Dictate` and `Queue` live in the `⋯` menu. Interrupt
  reads `Stop`. At 360px and below, `Attach` also moves into `⋯` while the run
  is active; the idle row keeps it inline.
- **Context chip + sheet.** The chip shows the selected agent, or the model
  when no agent is set, truncated at 60px. It opens a bottom sheet with the
  native Agent, Model, and Reasoning selects,
  a close control, a scrolling body, and a pinned footer with a session note
  and `Done`. The sheet traps Tab, closes on Escape or the scrim, and returns
  focus to the chip. Selects are disabled while the run is active.
- **One-line draft.** The textarea starts at one line on mobile (44px) and
  grows with the draft to 180px. Desktop keeps the two-line starting height.
  Composer padding is 8px on mobile and the bar gap is 4px.
- **Height.** The collapsed mobile composer is about 112px, down from about
  172px. The status row and queue summary stay conditional and unchanged.
- **Desktop.** The inline Agent/Model/Reasoning selects, visible `Suggest`,
  `Attach`, `Dictate`, `Queue`, and two-line textarea are unchanged.
- **No new tokens.** The chip uses the pill radius; the sheet uses the existing
  surface, border, 8px controls, 10px labels, and 16px sheet radius.

## Transcript scroll affordances (2026-11-15)

The scroll affordances moved out of the composer so scrolling and live
background work never change the composer's position.

- **Frame and scroller.** A `.chat-transcript` wrapper owns the panel frame:
  border, radius, background, and shadow. `.chat-panel` remains the scroll
  container and owns the mask, padding, and focus. The message DOM is unchanged;
  the wrapper exists to keep the frame crisp and anchor the floating jump.
- **Edge mask.** `.chat-panel` uses a 24px linear `mask-image` at an overflowing
  edge and 0 at the true top or bottom. Registered `<length>` properties ease
  the fade length over 180ms; scroll updates are rAF-coalesced. The frame and
  background are not masked.
- **Floating jump.** A 32px (44px on mobile) pill is absolutely positioned at
  the transcript's bottom-right, 16px/12px from the right and 12px from the
  bottom. Hidden uses opacity 0, 8px translate, no pointer events, tabIndex -1,
  and `aria-hidden`; visible restores all four. It hides at the true 2px bottom,
  not the 80px autoscroll threshold, and clicking it lets the scroll listener
  hide it at the end.
- **Background row.** Live shells and subagents render as one quiet pill at the
  end of the transcript, after messages and attention cards. It scrolls with
  the transcript, opens Details, and is content rather than composer chrome.
  The composer status row is removed. The queue tray remains in flow because it
  is user content.
- **Reduced motion.** The mask and jump transitions are removed and
  `jumpToLatest` scrolls instantly.
- **No new tokens.** The change uses 24px, 8px, 12px, 16px, the existing pill
  and control radii, and the existing surfaces and shadows.

## Audit fixes: targets and measure (2026-11-15)

The first audit pass fixed functional target overlap and restored the reading
measure. It supersedes the 32px square cluster in v1.9 and the jump overlap in
v1.10.

- **Composer cluster.** `⋯`, Stop, and Send are actual 44×44 controls on mobile.
  The `-6px` pseudo hit-area expansion is removed from that cluster, so adjacent
  targets cannot overlap. The text actions (Suggest, Attach) remain 44px tall.
- **Context chip.** The chip shows the agent name, or `Model` when no agent is
  set; the full pair stays in the accessible name and the sheet. It is 64px at
  360px and below, 96px above.
- **Attach placement.** Attach stays inline above 420px, moves into `⋯` while
  running at 361–420px, and moves into `⋯` at all states at 360px and below.
- **Reading column.** Transcript content is capped at 728px inside the panel;
  the panel frame can be 920px. The right gutter on wide screens holds the
  floating jump. A constant 48px bottom inset keeps the jump clear of the last
  line at narrower widths.
- **Jump name.** The visible `Input needed` / `Jump to latest` text is the
  button's accessible name; no `aria-label` overrides it.
- **Details values.** Detail values are 500 weight and tabular; Created,
  Updated, Cost, and Tokens use sans. Mono stays for IDs, paths, references,
  and endpoints. `font-synthesis: none` prevents faux bold.
- **Mobile inputs.** Question fields and custom answer inputs join the 16px
  mobile text rule.
- **Targets.** Suggestion Dismiss and queue Remove get 32px desktop targets and
  44px mobile targets.
- **No new tokens.** The change uses 44px, 64/96px, 728px, 48px, and existing
  surfaces, radii, and shadows.

## Audit fixes: icon grid and type roles (2026-11-15)

The second audit pass removes text glyphs from controls and collapses the
remaining 10/11/12px drift. It does not add a token, a family, or a screen.

- **Icon grid.** `arrow-up`, `arrow-down`, and `ellipsis` join the shared
  24px-grid icon set. Send, the jump pill, the composer `⋯`, suggestion
  Dismiss, queue Remove, and the session disclosure use it. No control relies on
  `×`, `⋯`, or `↓` as a text glyph.
- **Send and jump.** Send is the same 16px arrow at every width. The jump pill
  keeps its visible text as the accessible name and adds a 14px down arrow.
- **Small controls.** `.btn.small` is 12px, matching the other compact controls.
  The duplicate 11px `.form-note` rule is gone; notes stay 12px.
- **Transcript roles.** Message role times are 11px; role labels stay 10px
  uppercase. Markdown headings cap at 16px (`h1`/`h2`) and 14px (`h3`/`h4`).
- **Question choices.** Option descriptions are 12px, not 11px.
- **Shell runs.** The background run title is 12px and its status pill is 11px.
- **Search.** The search field is 14px on desktop and 16px on mobile.
- **Details labels.** Section and detail labels use `muted`, not `faint`.
  Faint remains for timestamps and hints.
- **Session state.** Rows show one status dot and no duplicate status pill. The
  accessible name keeps the status word.
- **Provider accent.** The Providers screen tints the 30px provider mark with
  the provider accent. Session lists and inbox cards stay neutral.
- **Navigation.** Rail labels ellipsize inside the 64px rail. The active rail
  icon uses the accent while its label stays text, matching the bottom
  navigation. The attention badge is clamped so a three-digit count cannot
  escape the item. In chat the topbar theme toggle hides at 420px and below.
- **Labels.** Theme controls name their outcome (`Switch to light theme` /
  `Switch to dark theme`). The New session panel uses the shared close icon
  with `Close new session`.
- **No new tokens.** The change uses existing sizes, surfaces, radii, and
  accent colors.

## Layout revision: use the wide field (2026-11-15)

The audit found that list pages left about 280px of the 1440px field unused
while the chat repeated its title. This revision spends that space on content
that was already there instead of adding new panels. Routes and navigation are
unchanged.

- **Content field.** Product pages use `min(1320px, 100%)`; the topbar gutter is
  unchanged. Content stays left-aligned.
- **Sessions table.** At 1100px and above, a page session row is a five-column
  grid: status dot, title, provider, project and agent, time. The row keeps one
  line for roots and an extra tag line for subagents. The 300px chat sidebar
  keeps the stacked title-and-facts layout at every width.
- **Inbox.** At 1200px and above each Inbox group is a two-column grid with
  `align-items: start`. Cards size to their content. Blocking priority stays in
  the amber edge and ordering, not in a full-width span.
- **Providers.** At 1100px and above Providers and Diagnostics sit side by side,
  about 1.45fr and 1fr.
- **Search.** At 1100px and above the input (max 640px), provider filter, and
  status filter form one wrapping toolbar. They wrap in source order below that.
- **One chat title.** The transcript no longer repeats the topbar `h1`. The
  context strip carries project, agent, model, and status.
- **Measure.** The transcript and composer cap at 672px; with the 16px panel
  padding and 1px frame, the reading column fills the panel at about 640px, or
  roughly 88 characters at 14px. This replaces the 728px cap from v1.11. v1.14
  corrects the first attempt, which kept a 760px panel and left an unused 88px
  strip inside it.
- **No new tokens.** The change uses the existing spacing, surface, radius, and
  accent values and no new component.

## Overview and usage (2026-11-16)

- The default destination is renamed **Overview** in the rail, the mobile bottom
  bar, the page title, and the document title. The route stays `/` and the view
  id stays `foundation`, so every deep link, e2e selector, and bookmark holds.
  This is a label change, not a new destination: the rail still has six items
  and the mobile bar still has five.
- The usage report is the first section: panel head, a `Group by` chip row
  (Provider, Project, Model, Day), and a table of group, sessions, tokens, cost.
  At 1100px and above it is a table; below, rows stack as label and count, then
  `4.2M tokens · $12.40`.
- Report figures are sans with tabular numerals and right alignment. Times,
  costs, and token counts never switch to the mono family. An unreported figure
  is an em dash, never `0` or `$0.00`, and a note states how many sessions did
  not report each figure. The last row reads `Reported total`.
- The phase-0 hero is removed. It repeated roadmap copy under a second 20px
  heading while `--text-xl` belongs to the chat document title, and its claim
  about upcoming work is no longer true. Runtime cards, the provider panel, the
  event stream, and diagnostics remain, after the report.
- No new tokens, radii, or type roles. The panel reuses the panel head, chip,
  and table grammar already in the frozen system.
- Settings gains **Local data** in place of the standalone Transcript cache
  panel: per-store counts, per-store retention, per-store Clear, the cache's
  own toggle/window/cap, and a two-step Clear all. Export is two links under a
  `Data` heading in details.
- The prototype gains the Overview view, the usage panel, and the renamed nav
  labels in the same revision.

## Mobile collision fixes (2026-11-16)

The narrow-screen pass found two headers where a side action competed with
wrapping content.

- **Session scope.** `.session-scope` is a flex group with an 8px gap. At 760px
  and below the Sessions panel head stacks: summary first, then the scope chips
  on their own row. The chips stay in one row at 390px. The old inline group
  wrapped under the summary and clipped the `newest first` text.
- **Providers head.** The Providers panel head stacks at 760px and below, so
  `+ Add` and `Recheck` sit under the description instead of squeezing it.
- **Inbox toolbar.** At 420px and below the filter chips take the full width and
  wrap; Refresh moves to its own right-aligned row. This follows the existing
  rule that filters wrap below 420px instead of clipping.
- **Session rows.** The title, tag line, and facts line use a 4px row gap and a
  4px tag offset, so a parent with a child count no longer reads as one tight
  block.
- **No new tokens.** The change uses the existing 4/8/12px spacing steps.

## Accessibility semantics and focus (2026-11-16)

This revision closes the semantics gaps found in the accessibility audit.
Routes, type, spacing, color, and focus rings are unchanged.

- **Headings.** Transcript, reasoning, and subagent Markdown use the same
  heading offset as the summary and file cards, so a `#` in a message renders as
  `h2`. Every view has one `h1`.
- **Filters and dialogs.** Inbox chips expose `aria-pressed` and include the
  count in the name. Details is a labelled column on desktop and a
  `role="dialog"` sheet below 1320px, with one shared Tab trap and focus
  restore. Escape closes the sheet and remains a shortcut for the desktop
  column. The model/agent sheet and file preview use the same trap.
- **Targets.** The chat-sidebar disclosure is 32px on desktop, matching the
  session-list contract, with 34px trailing padding.
- **No new tokens or routes.**

## Accessibility follow-ups (2026-11-16)

No visual, copy, or layout change. This closes the three follow-ups from the
v1.17 accessibility audit.

- **Login QR overlay.** The camera overlay is a modal dialog with one focusable
  control. Focus moves to Cancel on open, Tab and Shift+Tab loop inside it,
  Escape or Cancel closes it, and focus returns to `Scan pairing QR` if it is
  still connected. Closing aborts the scanner and stops the camera tracks.
- **Inline panels.** The provider form and new-session panel are not modal, so
  they do not trap Tab. They focus their first enabled field on mount (the
  heading when no field exists) and return focus to the opener on unmount. The
  focus is queued in a microtask so it does not race the page-title focus.
- **Inbox live region.** A polite `.sr-only` status region announces only
  blocking items that arrive after the first load. The initial list, ordinary
  refreshes, and non-blocking items stay silent.
- **No new tokens or routes.** The change is focus and ARIA behavior only.

## Session rename (2026-11-16)

One new provider capability and one inline details action. No new type, spacing,
radius, or color token.

- **Capability.** `ProviderCapabilities.rename` is exposed through the provider
  API. OpenCode renames with `PATCH /api/session/{id}`; Open WebUI uses the existing
  chat update endpoint. Hermes is not wired into the registry yet; when it is,
  it inherits that adapter. A provider without the capability hides the action.
- **UI.** The details panel adds a Name section with the current title and a
  `Rename` action. Rename opens an inline field with Save/Cancel; Enter saves,
  Escape cancels without closing the panel, and the panel stays open on error.
  Saving updates the topbar title, details name, and local session cache.
- **API.** `PATCH /api/v1/sessions/{ref}` accepts `{ "title": "..." }` and
  returns the updated session. Titles are trimmed, 1–200 characters.
- **No new tokens.** The field reuses the control border, surface, radius, and
  the 14px body input role; the displayed name stays 12px.
- **Search filters.** At 420px and below the `PROVIDER` and `STATUS` labels own
  their line, so wrapped chips align with the label. The chips stay one control
  group; the URL state and choices are unchanged.

## Transcript states (2026-11-18)

- The transcript body has four states and they never overlap: content, loading,
  waiting, and empty. Content wins whenever a message exists, including queued
  and optimistic rows, so a refresh never replaces them with a placeholder.
- Loading is a decorative skeleton inside the same panel: three message-shaped
  rows of `--surface-2` bars at the reading-column width. The panel carries
  `aria-busy` and one polite "Loading transcript…" announcement. The skeleton is
  hidden from assistive technology and animates only when the reader has not
  asked for reduced motion.
- A failed load shows the alert and a Retry action; it never falls through to
  "No messages yet", which would claim the transcript is complete.
- A running session with no messages yet reads "The agent is running, but no
  messages have been written yet." with a Retry action, not the empty copy. One
  automatic re-read follows after a short delay, once per session.
- The empty state appears only after a successful load returns no messages. The
  "Send the first prompt below" half is dropped when the provider cannot send.
- Creating a session with a prompt no longer navigates away when that prompt
  fails: the panel stays, the error is visible, and it offers Retry prompt and
  Open session.
- No new tokens, radii, or type roles.

## Automation templates panel (2026-11-18)

- A **Templates** panel sits between Watchers and Approvals in Settings →
  Automation. It lists the file-configured recipes; the panel still never edits
  config.
- Each row shows the template name (16px card title role is not used here; the
  row uses the existing 14px `settings-device-name` and 11px detail), then
  `id · providerID`, plus `· first prompt` when the template sends one.
- **Start** is a quiet `.btn small` row action, matching Pause, with an
  accessible name of `Start <name>`. It creates the session and sends the
  prompt, ignores pause, dry run, budgets, and quiet hours, and opens the new
  session. While it runs the row reads `Starting…`.
- Empty state: `No templates configured. Add automation.templates in the hub
  config.` Loading state: `Loading templates…` only before the first view.
- A first-prompt failure keeps the panel, shows the error, and offers **Open
  session**; there is no retry, because the session already exists.
- Rows wrap at ≤760px with the existing `.automation-list` rule; no new
  responsive behavior.
- Reason codes in approvals and recent runs render as one plain sentence. The
  mapping lives in `apps/web/src/app/automation-copy.ts`; an unknown code
  degrades to the code with spaces.
- No new tokens, radii, type roles, routes, or navigation.

## Session assistant dock (2026-11-20)

- The chat topbar gains one quiet `.btn small` **Ask** action between the
  title block and Details. It renders only when the hub reports a configured
  assistant (`GET /api/v1/assistant/status`, `enabled: true`); a hub without a
  model shows nothing.
- Ask opens a 400px right-hand panel fixed below the topbar, from the topbar
  edge to the viewport bottom. Opening it closes Details, because both are
  right-side panels and two would overlap; the reverse also holds.
- At 760px and below the panel is full-width. It is not a bottom sheet: the
  composer sits on the viewport floor and the transcript fills the rest.
- The header carries a 16px `Assistant` title, the session title at 11px muted,
  a `This session` scope chip at 10px uppercase, and a 44px close control.
  There is no second page heading.
- The log is a `role="log"` polite live region. Turns use two roles only:
  `You` and `Assistant`, both at 10px uppercase; the answer text is 14px/1.6
  with `white-space: pre-wrap`. Usage, when the model reports it, is a 10px
  tabular-figures line under the answer.
- The empty state is one muted sentence plus three quiet suggestion buttons
  (`Why is this stuck?`, `What changed most recently?`, `Draft a reply to this
  session`). They are 40px tall, `--surface-2`, and only appear before the
  first turn.
- The composer is a two-row textarea with one primary `Ask` button. Enter sends,
  Shift+Enter adds a line. While an answer streams, the primary action is
  replaced by a quiet **Stop**. The textarea is disabled until the thread has
  loaded, and its placeholder says `Reading this session…` in that state.
- The footer carries one 10px uppercase line, `Read-only · no writes`. This is
  the product promise of M1 and it is always visible.
- Streaming shows the partial answer with a 6px accent caret; the caret is
  hidden from assistive technology, and the text itself is announced through
  the polite log.
- Errors render as a 12px danger line inside the log, below the last turn. A
  stopped answer keeps its partial text and shows `Stopped` as the turn error.
- Escape closes the panel. Focus moves to the composer when the panel opens;
  closing returns focus to the Ask action.
- No new tokens, radii, or type roles. The panel reuses the surface, border,
  radius, and control grammar of the details panel.

## Assistant write confirmations (2026-11-20)

- The assistant stays read-only unless the hub config sets
  `assistant.allowWrite`. The footer says `Read-only · no writes` when it is
  off and `Writes need your confirmation` when it is on. There is no third
  state and no auto-send mode.
- When allowed, the model may propose exactly one action per answer. The
  proposal is a card inside the assistant turn, not a dialog and not a banner:
  - a 10px uppercase head, `Needs your confirmation` on the left and the
    outcome on the right (`Sent`, `Answered`, `Stopped`, `Cancelled`,
    `Failed`);
  - one 12px sentence that states exactly what would happen;
  - `send`: the proposed message in an editable 3-row field, 14px on desktop
    and 16px on mobile;
  - `answer`: the resolved choice as read-only text;
  - one primary action (`Send`, `Answer`, `Stop turn`) and one quiet `Cancel`.
- The card is a left-accent surface: 2px `--accent` while pending,
  `--success` when done, `--danger` when failed, `--border-strong` when
  cancelled. The status word is always present, so state is never color-only.
- While a card is pending, the dock composer is disabled and its placeholder
  says `Decide the action above first…`. One action at a time is a product
  rule, not a layout accident.
- A failed proposal stays visible with its error in 12px danger text. It is
  not silently dropped, and it has no buttons.
- The card reuses `.btn small`, the card radius (8px), and the existing
  surface and border tokens. No new tokens, type roles, or radii.
- **Cancel always works.** It is a local state change, so it is not gated by
  `allowWrite`. If writes are turned off while a card is pending, the primary
  action is replaced by `Writes are disabled. Cancel to unlock the thread.`
  and Cancel stays available. A pending card can never strand a thread.
- **One decision.** A confirmed action is reserved before it executes; the card
  reads `Working…` and offers no second action until it resolves. A second
  device gets `409`, not a second send.
- The card head names the action kind (`Send`, `Answer`, `Stop turn`) and the
  right side names the outcome (`Sent`, `Cancelled`, …). The state is never
  printed twice.
- Writes are audited to `dataDir/assistant-audit.jsonl` with the thread, turn,
  action id, kind, session ref, event, outcome, duration, model, and a SHA-256
  plus length of the confirmed payload. Message text is never written to the
  audit.

## Assistant evidence line (2026-11-20)

- Every assistant turn created from now on carries one 10px metadata line
  under the answer: `Read 8 turns · 1 attention item · 3252 in · 94 out`.
- It states what the run actually read after the context budget: the number of
  transcript turns included, how many older turns were omitted, how many
  attention items were in the context, and the model's token usage when
  reported.
- `older omitted` appears only when the budget dropped something. That is the
  line that makes a partial answer look partial, which is the point.
- It is static text in the existing metadata role. No chip, no expansion, no
  "what the model saw" panel; that would be a debugging tool, not a trust line.
- Turns written before this revision simply have no line. There is no backfill.

## Approval state corrections (2026-11-20)

- A pending card with writes disabled replaces the primary action with
  `Writes are disabled. Cancel to unlock the thread.` and keeps Cancel. Cancel
  is a hub-state change, never a provider write.
- A decision in flight renders `Working…` in place of the buttons. The dropped
  state names the verb on the left (`Send`, `Answer`, `Stop turn`) and the
  outcome on the right (`Sent`, `Cancelled`, `Failed`), never the same word
  twice.
- No layout, token, radius, or type-role change: these are states of the
  existing card.

## Thread time markers (2026-11-20)

- The dock is a conversation that survives days, so it says so. The first turn
  of each local day is preceded by a 10px uppercase label between two
  `--border-subtle` hairlines: `Today`, `Yesterday`, or `Mon, Nov 18`.
- Each turn's role line carries a right-aligned `HH:MM` at 10px muted with
  tabular figures. The role stays left; the time never competes with it.
- The evidence line gains the session's own timestamp, not the answer's:
  `Read 8 turns · session as of 09:12 · 3252 in · 94 out`. When the session
  last changed on another day it reads `session as of Nov 19, 18:40`. This is
  how a stale answer announces itself.
- No new tokens, radii, type roles, or controls. The markers are metadata in
  the existing 10px role.

## Evidence line: failures (2026-11-20)

- The evidence line gains one clause when the recent tail contains failed
  commands or tools: `1 failure`. It sits after `Read N turns` and before
  `session as of …`.
- It is a count, not a link. The answer's prose says what failed; the line says
  whether anything did, so "nothing is wrong" is never asserted from a context
  the reader cannot see.
- No new tokens or controls.

## Evidence line: history (2026-11-20)

- When the answer used a provider compaction, the line gains `history <date>`
  after `session as of …`: `Read 3 turns · session as of 04:05 PM · history Nov
  19 · 3561 in · 48 out`.
- A compaction from today shows a bare time; older ones show `Nov 19`, matching
  the session stamp's rule. The model's prose may also cite it, but the line is
  the part that cannot be forgotten.
- No new tokens, controls, or layout. The read that produces the compaction is
  bounded (2 s per page, stale-while-revalidate), which is invisible in the UI.

## Permission prompts (2026-11-20)

- The assistant may explain a pending permission prompt. It may not answer one.
  A question whose `risk` is `destructive` or `sensitive` produces a failed
  proposal, not a confirmation card: `This is a permission prompt. Answer it in
  the Inbox, where the command and its risk are shown.`
- The failed card keeps the provider's question, choices, and risk visible, and
  adds one link, `Open the Inbox`, to `/inbox?filter=question`. There is no
  primary action.
- For `normal` questions the card shows the provider's question text and its
  choices, with the chosen choice marked by the accent border. The primary
  action names the effect: `Answer "main"`, not `Answer`.
- The model's summary is no longer the only description of an answer. The
  question and choices are a snapshot taken from the live prompt at proposal
  time and pinned to its revision.
- No new screen, token, or type role. The blocked state reuses the danger text
  and a quiet link.

## Expired actions and interrupted runs (2026-11-20)

- A pending action that nobody decides within 24 hours becomes `Expired`. The
  card keeps its question and payload, loses its buttons, and shows the reason
  in 12px danger text. It is a hub-state change, audited as `expired`.
- A thread is never evicted while it holds a pending or deciding action. When
  the 40-thread cap is reached, the least recently used unlocked thread goes.
- A run lives in memory. If the hub restarts mid-answer, the thread's last turn
  is a question with no answer; at boot the hub appends one assistant turn
  whose role line reads `The answer was interrupted by a hub restart.` No
  buttons, no retry, and the composer accepts the next question.
- Expired and interrupted states reuse the existing error treatment: 12px
  danger text, no new controls or tokens.

## Project and global scopes (2026-11-20)

- The dock's scope chip is a button when the session belongs to a project:
  `This session` ↔ `This project`. A global thread shows a static `All
  sessions` chip. There is no new screen and no rail destination.
- The Overview topbar gains one **Ask** action that opens the global thread.
  It appears only when the assistant is configured.
- Both scopes are read-only: the footer reads `Read-only · no writes`, the
  composer has no action cards, and the service does not offer the action tool.
- The evidence line names what was read: `Read 12 sessions · 7 older omitted`
  for a project, and `1 attention item · 1 running` for global. It never claims
  a transcript was read at these scopes.
- Project context is session metadata plus that project's inbox, capped at 12
  sessions. Global context is the inbox, running sessions, 24-hour errors, and
  a project rollup. Neither includes transcripts.
- The scope chip only appears when the scope exists: no project, no toggle.

## Targeted sends from project and global (2026-11-21)

- Project and global contexts gain `SEARCH` (transcript hits) and, when the
  question names a session ref or `/sessions/<ref>` URL, `TARGET SESSION` with
  its metadata and last few text turns. Global also lists a 12-session index.
- The model may propose **one** `send`, only to a session present in that
  context: the index, the search hits, the target, or (project) the project's
  sessions. The ref is validated at proposal time; anything else fails.
- The card shows the target above the message: `To: Fix auth race in gateway`, and
  the primary action reads `Send to "Fix auth race in gateway"`. Confirm, cancel,
  and the 24-hour expiry are unchanged.
- These scopes still cannot `answer` a question or `interrupt` a turn. The
  permission-prompt rule is unchanged.
- The footer reads `Writes need your confirmation` whenever writes are enabled,
  at every scope.
- A model 5xx now reads `The assistant model is unavailable right now — it may
  still be loading or the GPU is busy. Try again.` instead of a bare status.

## Cross-session search in every scope (2026-11-21)

- Any assistant thread may answer "where does this work live?" It searches all
  sessions: transcript and title hits from the search index, plus metadata
  (project, directory, model, agent, ref). Metadata is what finds "the GPU
  orchestrator" when the words never appear in a message.
- A `SEARCH (other sessions, untrusted)` block lists up to five hits with the
  session title, ref, and a snippet. The session scope can name another session
  but cannot read its transcript from that thread; it says so.
- The evidence line gains `N search hits` when the context carried any.
- Search only runs when the question has meaningful terms; "what needs me" and
  "what is this session doing" do not query the index.
- No new controls, tokens, or screens. The block is prompt data plus one
  metadata clause.

## Assistant model and activity (2026-11-21)

- The **composer row** carries a model chip at 11px with the active model and a
  caret, below the textarea, where the chat's own model control lives. The
  header stays title + scope + close. The chip opens a listbox that names its
  source (`Models from <host>/<path>`) and lists the models the configured
  endpoint reports; choosing one applies to the next question in this thread. Past answers keep
  the model that wrote them. The chip is disabled while a run is in flight.
- The activity block mirrors the chat exactly: a toggle row (`AGENT ACTIVITY`,
  step count, errors/running, time, chevron), a 4px dot texture when collapsed,
  and the 49px tile grid when expanded. Selecting a tile opens its detail
  inline. Kinds: `read`/context, `search`, `think`/history, `model`, `tool`.
  `model` is the one added kind, in `#a9bdff`; tool status uses the existing
  success/warning/danger semantic colours.
- Steps are hub facts, not model prose: what was read, the search query and hit
  count, the compaction date, the model with token usage, and any tool call.
  They are emitted live over SSE and persisted on the turn.
- A per-thread model change does not rewrite history. The evidence line keeps
  its trust clauses; token counts live in the activity detail.
- **Global assistant is a modal `<dialog>`**: centred 560px, backdrop, native
  focus trap and Escape, bottom sheet at 760px and below. Session and project
  threads stay in the right dock, because the transcript they cite must remain
  visible. The header icon names the scope: bot (session), layers (project),
  globe (global).
- No new screen, route, or token. The dialog reuses the dock's surface, radius,
  and controls.

## Assistant endpoint settings (2026-11-21)

- Settings gains an **Assistant agent** panel, full width above Reply
  assistance: enable, allow confirmed writes, OpenAI-compatible base URL,
  model (with a datalist from Load models), context messages, timeout, API key,
  and one save.
- `Load models` reads the saved endpoint's `/models`; `Test connection` sends a
  one-token completion with the unsaved form values and reports status, model,
  and latency. Neither saves.
- The key follows the reply/transcription pattern: masked, never returned, and
  cleared with an explicit action. `hasApiKey` drives the badge.
- The dock's model menu gains one quiet `Change endpoint` link to Settings.
- Settings are runtime-owned; the config file seeds the panel on first boot and
  remains the fallback for an empty endpoint. A save applies to the next
  question without a restart.
- No new screen, route, token, or type role. The panel reuses the existing
  assistant settings form grammar.

## Activity order and parity (2026-11-21)

- Activity renders **before** the answer prose, because the reads, search, and
  model call happened first. During a run the live steps sit above the
  streaming text, so "Reading…" is preceded by what is being read.
- The block uses the chat's values, not a lookalike: 49px tiles, 18px icons,
  the same `read`/`search`/`think`/`tool` icon map, a dot only while running or
  failed (never a green dot on a completed step), and `data-status` for the
  semantic colour.
- The selected step's detail is a full-width row inserted after the tile's row,
  not a strip under the grid. Arrow keys move between tiles; each tile carries
  `aria-expanded` and a label with its status and detail.
- No separator line or extra padding inside the dock; the chat's block rhythm
  applies unchanged.

## One activity renderer (2026-11-21)

- The chat and the dock render the same `ActivityItem` through the same
  `ActivityTiles`. Only the adapters differ. A second grid was the source of the
  v1.37 drift, so it is removed rather than kept in sync by hand.
- Hub kinds reuse the tool families' muted hues: `context` reads as `read`,
  `history` as `think`, `model` as `subagent`, `tool` as `execute`. No new
  palette and no new tokens.
- A step's tile label prefers a count (`20 turns`, `5 hits`) over its duration.
  The duration remains the fallback and the model step's label.
- A step details in the chat's `activity-step` panel: status pill, label, short
  value, duration, close. The dock shows recorded metrics as rows; the chat
  keeps its preview, diff, and prev/next because provider parts carry them.
- A cancelled step is a quiet dot and a neutral status pill. It is neither
  success nor failure.
- A child step indents one step (`--space-3`) inside the same grid; it is not a
  nested grid.

## Change policy

Allowed without a new design version:

- typo and copy corrections that do not change hierarchy or meaning;
- accessibility fixes that do not change the visual system;
- brand mark and app-icon assets that reuse the existing accent/on-accent pair;
- browser/rendering fixes;
- extraction of the frozen tokens into `packages/ui`;
- implementation details that do not alter the approved screens or tokens.

Requires a new design version and tag (for example `design-v1.1`):

- changes to hierarchy, page structure, navigation, or interaction model;
- changes to the type scale, spacing scale, radii, palette, semantic color rules, or component grammar;
- new screens or materially different responsive behavior;
- changes to the primary action on a surface.

If a provider limitation makes a frozen screen impossible, document the exception in `visual-audit.md` and update this lock before shipping the divergence.

## Boundaries

This lock covers UI and UX only. Architecture, API contracts, provider adapters, storage, and deployment may evolve through their own documents and decision records. A backend change must not silently change the visual system; a UI change must not silently change the API contract.

## Verification reference

The `design-v1` reference was reviewed in dark and light themes at 1440, 1024, 390, and 320px, including inbox, sessions, chat, details, providers, settings, search, and the new-session modal. The `design-v1.1` transcript revision was verified at 1280 and 390px against live 1,000+ message sessions. The `design-v1.2` copy/dictation revision was verified at 1440, 1024, 390, and 320px in both themes; the copy action, recording state, transcription, error, and disabled states were checked against the live chat and a fake OpenAI-compatible STT endpoint. The `design-v1.15` Overview revision was reviewed in dark and light at 1440, 1024, 390, and 320px: the usage table at wide widths, the stacked rows below 1100px, the dashes for unreported data, and the renamed rail and bottom-bar labels. The `design-v1.16`–`design-v1.19` revisions were reviewed at 1440, 1024, 390, and 320px in both themes: mobile session scope and Inbox filters, the accessibility headings/focus/QR/live-region pass, the rename form and focus return, and the narrow Search filter labels. The full gates pass at 721 unit tests and 46 e2e tests. The `design-v1.3` attachment/branching revision was verified against the live OpenCode provider (upload, send, file rendering, fork) and a fake Open WebUI provider (branch picker, 2/2 → 1/2 switch, replaced transcript, retry to 3/3). The `design-v1.38` shared renderer was verified live: the dock showed `20 turns · compacted · 5 hits · 4.3 s` with a structured query/hits detail, above the answer, and the chat still opened its Reasoning preview with prev/next. The `design-v1.37` activity parity was verified live: steps render above the answer (file/bulb/search/model tiles, durations 7–73ms and 4.4s), completed tiles carry no dot, and the chat's 49px grid is used. The `design-v1.36` endpoint panel was verified live: it seeded the config endpoint and model, `Test connection` answered in 2.7 s on the 27B model, and `Change endpoint` from the dock opened Settings. The `design-v1.35` model picker and activity block were verified live: the chip listed the endpoint models (`local-model` selected), a search answer produced four tiles (`context · history · search · model`) with durations, and the model tile opened `the local model… · 3196 in / 63 out · 1.5s`. The global thread rendered as a modal `<dialog>`. The `design-v1.34` cross-session search was verified live from a session thread: "which session is working on the trip plan?" returned `plan trip` with 5 hits and stated the transcript was outside the thread. The `design-v1.33` targeted send was verified live: global search found "Fix auth race in gateway" from a memory pressure transcript hit, and a URL-named session produced a pending `Send to "Fix auth race in gateway"` card (cancelled, not sent). The `design-v1.31` project/global scopes were verified live: the session dock switched to `This project` (a project) and answered from 12 session summaries; the Overview Ask opened a global thread that reported an empty inbox and one running session; both read-only. The `design-v1.30` expired/interrupted states were verified by unit tests (24h expiry, LRU eviction with a locked thread, restart marking) and the build; the live hub has no expired action to exercise. The `design-v1.29` permission rule was verified by unit tests (a destructive question produces a failed action and no send) and the payload card by typecheck/e2e build; the live hub has no destructive question to exercise. The `design-v1.28` history clause was verified live (`history Nov 19` on a turn assembled from a day-old compaction) and in the assistant e2e. The `design-v1.26` time markers were verified in the dock at 1440 and 390px (day label, per-turn times, and the as-of stamp). The `design-v1.24` evidence line was verified live (`Read 8 turns · 1 attention item · 3252 in · 94 out`) and in the assistant e2e. The `design-v1.23` write confirmation was verified live against the local 27B model (proposal, edit, cancel) and end to end against a fake provider (confirm → provider receives the message, card reloads as `Sent`). The `design-v1.22` assistant dock was reviewed in dark and light at 1440, 1280, 1024, and 390px: empty state, streaming, persisted turns, the disabled load state, and the mobile full-width panel, with no console errors and no horizontal overflow. The full gates pass at 776 unit tests and 57 e2e tests.
