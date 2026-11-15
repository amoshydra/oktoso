# Design Lock — v1.12

Status: **frozen**.

- Version: `design-v1.12`
- Parent: `design-v1.11`
- Date: 2026-11-15
- Git tag: `design-v1.12`
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

The `design-v1` reference was reviewed in dark and light themes at 1440, 1024, 390, and 320px, including inbox, sessions, chat, details, providers, settings, search, and the new-session modal. The `design-v1.1` transcript revision was verified at 1280 and 390px against live 1,000+ message sessions. The `design-v1.2` copy/dictation revision was verified at 1440, 1024, 390, and 320px in both themes; the copy action, recording state, transcription, error, and disabled states were checked against the live chat and a fake OpenAI-compatible STT endpoint. The `design-v1.3` attachment/branching revision was verified against the live OpenCode provider (upload, send, file rendering, fork) and a fake Open WebUI provider (branch picker, 2/2 → 1/2 switch, replaced transcript, retry to 3/3).
