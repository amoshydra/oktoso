# Visual Design Audit

> Status: frozen in [`design-v1`](design-lock.md) on 2026-10-26. Session transcript revision `design-v1.1` applied 2026-10-27; chat shell alignment applied 2026-11-02.

Scope: the web prototype and the design tokens in `docs/prototypes/styles.css`. The information architecture and flows in `docs/ui-ia.md` did not change.

## What was wrong

The first pass used a narrow neutral range. Text contrast passed for primary copy, but the surfaces, borders, and secondary text sat too close to the background.

Measured with WCAG 2.2 contrast ratios:

| Pair | Before (dark) | Before (light) | Problem |
|---|---:|---:|---|
| Faint text on background | 3.23 | 2.46 | Failed 4.5:1 for small text |
| Muted text on background | 6.16 | 5.01 | Passed, but close to the floor in light mode |
| Border on surface | 1.24 | 1.27 | Cards and inputs blended into the page |
| Border on background | 1.31 | 1.19 | Section edges disappeared |
| Surface on background | 1.05 | 1.05 | Panels read as one flat field |
| Primary button text | 8.29 | 5.16 | Fine, but the button had no clear secondary style |
| Status color on surface | 10.68 | 5.02 | Color passed; the status element had no container |

The component layer made it worse:

- Buttons and chips were transparent with a weak border.
- Status was a dot plus text, not a visible control.
- Attention cards separated themselves with color only.
- Active session and nav states used a surface that was almost the same as the background.
- Inputs used the page background and a weak border.
- Focus relied on a subtle border change.

## What changed

### 1. A real surface ladder

The interface now has six levels:

| Level | Dark | Light | Use |
|---|---|---|---|
| Canvas | `#08090b` | `#eef1f5` | Page background |
| Rail | `#0d0f13` | `#f7f9fc` | Navigation rail, top bar |
| Panel | `#111419` | `#ffffff` | Sidebar, details |
| Card | `#16191f` | `#ffffff` | Cards and raised rows |
| Raised | `#1d2129` | `#f5f7fa` | Inputs, chips, hover |
| Active | `#272c36` | `#e8edf4` | Active rows and pressed states |

The difference between canvas and panel is small by design. Borders and shadows carry the separation, because raising every surface creates noise.

### 2. Border hierarchy

| Token | Dark | Light | Use |
|---|---|---|---|
| `border-subtle` | `#2a2f38` | `#d6dce5` | Internal dividers, list separators |
| `border` | `#3f4652` | `#c3cbd6` | Card edges, panels |
| `border-strong` | `#5f6878` | `#808a99` | Inputs, buttons, chips, active rows |

`border-strong` reaches 3.13:1 on the dark card surface and 3.49:1 on white. That clears the WCAG non-text contrast target for interactive boundaries. Card edges use the softer border because the surface and shadow already separate them.

### 3. Text tiers

| Token | Dark | Light | Contrast on card |
|---|---|---|---:|
| Text | `#f4f6f9` | `#111318` | 16.26 / 18.58 |
| Muted | `#b5bcc8` | `#4f5764` | 9.21 / 7.29 |
| Faint | `#8f97a5` | `#626b78` | 5.98 / 5.39 |

Faint text now clears 4.5:1 on cards and the canvas. Timestamps, labels, and hints stay quiet without disappearing.

### 4. Controls look like controls

- Secondary buttons and icon buttons use a raised surface, a strong border, and a small shadow.
- Chips use the same treatment. Active chips use an accent tint and accent text.
- Inputs use the raised surface with a strong border. Focus adds an accent border and a 3px accent ring.
- The composer uses a raised surface, a strong border, and a larger shadow. Focus is obvious.
- The send button stays a solid accent block.
- Danger actions use a tinted surface and a danger border.

### 5. Active and selected states

- The active session row gets a raised surface, a strong border, a small shadow, and a 2px accent bar.
- The active nav item gets a raised surface, a border, an accent icon, and an inset accent bar.
- The mobile bottom navigation uses an accent top line and accent icon.
- Hover states raise the surface and strengthen the border instead of changing text color alone.

### 6. Attention is visible before it is read

- Blocking cards use a left warning bar, a warning border, and a subtle warm tint.
- Type badges have a filled surface, colored text, and a colored border.
- Inline permission cards use the same visual grammar inside the transcript.
- Status chips are pill-shaped with a tinted border, so status survives a grayscale screenshot.

### 7. Depth without decoration

- Cards use `shadow-sm`.
- Hovered cards and the composer use `shadow-md`.
- Modals and mobile sheets use `shadow-lg`.
- Inset highlights are minimal. The goal is legibility, not glass effects.

### 8. Focus and accessibility

- Every interactive element gets a visible 2px accent outline on `:focus-visible`.
- Controls use the strong border, so their boundaries are visible without focus.
- Status uses a label and a dot, not color alone.
- Muted and faint text remain distinct from primary text.
- Primary actions, option buttons, and icon-only controls use 44px targets on mobile. The bottom navigation is 54px.

## Design-lead review: what mattered next

The first pass fixed the contrast failure. The second pass treated contrast as a floor, not the goal.

The remaining problems were hierarchy, rhythm, and semantics:

1. **Hierarchy was flat.** Page title, card title, session title, metadata, and badge text were all within a few pixels of one another. The interface was readable but the eye had no clear entry point.
2. **Color carried conflicting meanings.** OpenCode used a mint close to success, Hermes used the warning amber, and Open WebUI used an accent-like blue. Provider identity, session status, attention, and unread could all appear as tiny dots in the same row.
3. **Typography was a continuum.** The stylesheet used 17 font sizes, including 8px, 9.5px, 10.5px, 12.5px, and 13.5px. That is accumulation, not a system.
4. **Spacing was locally tuned.** More than 50 padding combinations made cards and controls feel subtly uneven.
5. **Edge cases broke the polish.** Inputs had a double focus ring. Mobile filters clipped a chip. The mobile modal pushed its primary action below the fold.

### Second-pass changes

- **Six type roles:** 10, 11, 12, 14, 16, and 20px. Body and chat prose are 14px. Page and card titles are 16px. Only 400, 500, 600, and 700 weights remain.
- **Typefaces:** Inter Variable for the UI and IBM Plex Mono for code and identifiers, self-hosted through Fontsource. The six-size scale and weight rules are unchanged.
- **A stronger page frame:** the topbar owns the page title. Duplicate content headings were removed, and page content now aligns to the topbar instead of floating in a centered column.
- **State color is exclusive:** provider marks are neutral in lists. Provider accents appear only on the Providers screen. Unread is title weight, not a second dot. Attention has one amber marker.
- **A spacing and radius system:** 4, 8, 12, 16, 24, and 32px spacing; 4, 8, 12, 16, and pill radii. Optical 2px exceptions remain for rails and count badges.
- **One focus language:** buttons and links get a 2px accent outline. Inputs get the same outline at a tighter offset. Their old box-shadow rings were removed.
- **Responsive containment:** details becomes a right-side overlay below 1320px and a column above it. Filter chips wrap below 420px. Provider machine names drop below 480px. The external chat action drops below 360px. Form fields are 16px to avoid browser zoom. Modal footers are pinned while the form body scrolls.
- **Inline credential hints:** the provider form explains where its secret comes from with the existing muted hint type at 12px, so no new control, color, or component enters the system. Prose stays on the shared 1.5 line height and inline commands use IBM Plex Mono.
- **Accessibility labels:** session status, unread, and needs-attention states now have screen-reader text instead of relying on a colored dot.

The card border remains softer than the control border. Cards are structural; controls must clear 3:1. Pushing every card edge to 3:1 would turn the interface into a wireframe.

### Still worth a follow-up

- The details overlay transition is intentionally immediate. If the implementation animates it, use transform and opacity only.
- Search result and session-table rows are clickable `div`s in the prototype. They need button semantics and full keyboard focus behavior before implementation.
- The modal closes with Escape but does not yet trap focus; add a focus loop before shipping.
- Real provider content will stress this system with long titles, images, and wide code. The type and spacing rules are ready for that pass.

## After measurements

| Pair | After (dark) | After (light) |
|---|---:|---:|
| Text on canvas | 18.40 | 16.40 |
| Muted on canvas | 10.43 | 6.44 |
| Faint on canvas | 6.77 | 4.76 |
| Text on card | 16.26 | 18.58 |
| Muted on card | 9.21 | 7.29 |
| Faint on card | 5.98 | 5.39 |
| Border on card | 1.85 | 1.64 |
| Strong border on card | 3.13 | 3.49 |
| Accent on card | 9.56 | 6.70 |
| Success on raised | 9.97 | 6.16 |
| Warning on raised | 11.19 | 5.95 |
| Danger on raised | 7.51 | 6.03 |
| Primary button text | 10.88 | 6.70 |

Tinted labels and controls remain above 4.5:1 in both themes. The lowest light-mode tinted label is 4.94:1 (error badge); the lowest dark-mode tinted label is 6.01:1 (error badge).

## Component rules

- **Cards:** `surface`, `border`, `shadow-sm`. No transparent cards on the canvas.
- **Controls:** `surface-2`, `border-strong`, `shadow-sm`.
- **Inputs:** `surface-2`, `border-strong`, accent focus ring.
- **Active rows:** `surface-2`, `border-strong`, 2px accent inset.
- **Blocking attention:** warning left bar, warning border, warm tint.
- **Status:** pill with a tinted border and a label.
- **Dividers:** `border-subtle`.
- **Modal and sheets:** `surface`, `border-strong`, `shadow-lg`.
- **Focus:** 2px accent outline. Buttons use a 2px offset; inputs use 1px; the composer owns the focus ring for its textarea.

## What did not change

- The IA, routes, screen structure, and interaction model.
- The desktop three-column layout and mobile bottom navigation.
- The attention priority model.
- The provider and session data model.
- The glasses and VR adaptations.

## Remaining notes

- Card borders sit below 3:1 because they are structural, not interactive. Interactive controls use the strong border.
- Decorative dividers use the subtle border. They are not the only cue for a boundary.
- A future high-contrast theme can raise `border` and `border-subtle` without changing layout.
- The prototype is mock data. Real provider content may include longer text, images, and code, which will need a second pass after the API is live.

## Session transcript revision (design-v1.1)

The transcript reading model changed after live providers exposed 1,000+ message sessions:

- Initial load is newest-first and starts at the latest message.
- Older pages load at the top with scroll anchoring; the oldest message is never the initial page.
- Message prose renders sanitized Markdown.
- Tool/reasoning rows are compact disclosures; consecutive tool-only assistant turns collapse into an "Agent activity" block.
- The session title, back action, and status stay in the fixed topbar; interrupt stays in the pinned composer and details panel.

The type scale, spacing, radii, palette, semantic color rules, navigation, and all other screens remain `design-v1`. The pre-existing prototype remains the visual reference for those surfaces.

## Auth affordance (2026-10-31)

- The signed-out screen gained a secondary **Scan pairing QR** action when the browser is a secure context and exposes the Barcode Detection API, plus a camera overlay with one cancel action and an inline error.
- The action reuses existing surfaces, borders, radii, and control styles. It adds no new type, spacing, or color tokens.
- The server-rendered `/pair/<code>` confirmation page sits outside the app shell and uses the same neutral palette.
- The action is hidden on unsupported or insecure browsers. The phone camera app remains the fallback.

## Brand mark (2026-11-02)

The placeholder `OK` and `AH` blocks were replaced by the Oktoso mark: an accent
tile with a dark octagonal hub and a centered node.

- The mark uses only `--accent` and `--on-accent`, so it follows the active dark
  or light theme. It adds no type, spacing, radius, or color token.
- Sizes are 36px in the rail and 40px on the signed-out and pairing surfaces.
  The rail mark is the only logo in the app shell; page content does not repeat
  it. The Even G2 phone setup page uses the same 36px mark.
- The pairing page uses the fixed dark-theme mark and the shared favicon.
- `apps/web` now ships `favicon.ico`, an SVG favicon, 16/32/48px PNG fallbacks,
  an Apple touch icon, 192/512px app icons, maskable icons, and a web manifest.
  The geometry and regeneration steps are in [`brand/README.md`](brand/README.md).
- The README banner is composed from the prototype at 1440px and the same mark.
  It changes no product screen. `pnpm brand:screens` regenerates the screenshots
  and banner, and CI runs `pnpm brand:check` to catch stale sources or images.

## Chat shell revision (2026-11-02)

The production chat now follows the design-v1 shell instead of the Phase 2 page-flow layout. No new type, spacing, radius, or color tokens were introduced.

- The fixed topbar owns the session title as the page `h1`, the provider/status subline, the back action, and the details toggle. The duplicate 12px sticky header and the hero card were removed.
- The transcript is its own scroll region. The composer is pinned below it, so replying no longer requires scrolling to the end.
- A floating "Jump to latest" control appears when the reader is scrolled away from the bottom and reads "Input needed" when blocking attention is waiting below.
- Details is a 300px column above 1320px, a right-side overlay from 761 to 1319px, and a bottom sheet at 760px and below. The overlay traps Tab, closes on Escape or the scrim, and restores focus.
- Permission, approval, question, and error attention render inline at the end of the transcript. Permission actions and the question form were verified against the fake providers; resolving a request removes the card without a page reload.
- Date separators group messages by day. Timestamps show the hour and minute instead of seconds. Role labels read `You` and `Agent`.
- Provider errors extract the provider message instead of dumping JSON. The message error remains as a fallback when no attention item exists.
- Developer chrome was removed from the chat and global footer: the phase badge, the design-reference footer, and phase suffixes in the topbar. No phase copy remains in the product surfaces.
- Mobile send is a 32px icon button with an expanded 44px hit area, and it sits at the end of the composer bar beside the selection picker. The hint no longer needs to act as a spacer.
- The activity chevron is now an `aria-hidden` element, so it no longer enters the disclosure's accessible name. The composer has an explicit label. Status and error states keep their text labels.
- Markdown links and image sources resolve against the provider base URL instead of the hub origin. Absolute URLs stay absolute, `mailto:` and `tel:` links stay local, and unsafe schemes or data images are removed. Safe data images render; unresolvable images become an inline fallback.
- File parts use the same resolver. Image files render inline with a caption; other files keep an Open action. Open WebUI image/file content parts and `files` arrays are normalized into file parts, and OpenCode form descriptions are preserved as question detail.
- An opened agent activity group stays open while new activity appends because the disclosure key is now the first message in the group, not the changing last message.
- The details panel falls back to the provider base URL when a session has no native URL, so OpenCode sessions also get an Open in provider action.

Verification: dark and light themes at 1440, 1024, 390, and 320px. No horizontal page overflow; code blocks and tables scroll inside their containers. The browser console is clean. Lighthouse accessibility is 100. Keyboard Escape and focus return were checked for the details overlay.

Remaining: the desktop session sidebar from the prototype, message editing as a tree operation, per-code-block copy and syntax highlighting, Open WebUI attachment sending, a full session-family tree, and a final message-measure pass once the sidebar narrows the chat column.

## Session selection picker (2026-11-02)

The composer now exposes the provider’s session selection instead of leaving model and agent control to provider-native screens.

- The picker loads `ProviderOptions` for the session provider. Agent and model selects appear when the provider returns options; a reasoning select appears only when the selected model exposes variants.
- Agent and model labels use the provider’s names. Variant IDs are humanized (`max` → `Max`) because OpenCode does not provide labels for them.
- Changing a selector posts to `/api/v1/sessions/{ref}/selection` and updates the session. The document header, details panel, and picker stay in sync.
- OpenCode uses its dedicated `/api/session/{id}/agent` and `/api/session/{id}/model` routes. Model variants are sent as `Model.Ref.variant`.
- Open WebUI updates the chat’s `models` array; it has no agent or variant selector.
- The picker is disabled while the agent is running. A failed change restores the previous values and shows an inline error.
- The picker lives in the composer bar. Field labels are visible at desktop widths and hidden at 1100px and below; the mobile selects use the 12px compact control role with zero horizontal padding, while text entry stays at 16px to avoid browser zoom. Send collapses to a 32px icon button below 760px so Agent, Model, Reasoning, and Send share one row at 390px and 320px without horizontal overflow.

Verified at 1440, 1024, 390, and 320px in dark and light themes. Changing reasoning from `max` to `high` updated the session to `commandcode/claude-sonnet#high`; changing the agent to `plan` updated the document header. Open WebUI showed a model-only picker. The contract now includes `ModelVariant` and `SessionSelectionInput`; the OpenAPI document is regenerated.

## Page chrome and control alignment (2026-11-07)

The remaining Phase 0 page chrome was removed from the product screens so the topbar is the only page header again. No routes, tokens, type roles, spacing steps, radii, or semantic color rules were added.

- Inbox, Sessions, Search, and Providers no longer open with a hero card. Inbox keeps its filters and one quiet Refresh action in a toolbar; Sessions keeps a compact page lead with Refresh and New session; Search and Providers start directly with their first panel. Foundation keeps its status hero.
- The hero gradient was removed. The hero is now a normal `surface` card.
- The topbar and page content share one gutter: 24px on desktop and 16px on mobile. The topbar title, filters, panels, and page actions now start on the same x-axis.
- The rail and mobile bottom navigation use the shared 16/18px line-icon set instead of lettermarks. Back, theme, close, branch, and disclosure controls use the same set instead of text glyphs. The attention badge is 10px/700, not 9px/800.
- Desktop controls are 32px high (`btn small`, chips, icon buttons); quiet message actions remain 28px. Mobile controls keep the 44px target, except the 32px composer send that keeps its expanded hit area.
- The Settings assistant cards pin their footer actions to the card bottom, so Save/Load models align across the two-column row.
- The wide composer keeps its agent/model/reasoning picker on one row. The composer hint is nowrap with ellipsis instead of wrapping the action bar.

Verification: 1440, 1024, 390, and 320px in dark and light. No horizontal overflow; the console is clean apart from the existing `apple-mobile-web-app-capable` deprecation warning.

Remaining: per-message model overrides are not implemented, the New session form still creates with the provider default variant, and providers that do not expose options get no picker.

## Chat sidebar (2026-11-02)

The desktop chat now includes the prototype’s session sidebar.

- The sidebar is 300px, sits between the rail and the transcript, and uses the panel surface with a right border.
- It has search, provider and status filters, Today/Yesterday/Earlier groups, session rows, status dots, attention badges, and an active row with the raised surface, strong border, and 2px accent inset.
- The list loads the newest 100 sessions and refreshes after session events. The active session is injected and sorted into the list if it falls outside the loaded page.
- The transcript now has a readable measure: 728px at 1440px and 612px at 1024px, instead of 920px.
- The sidebar is hidden and unmounted at 760px and below; mobile chat keeps the full-width route.
- The All sessions action returns to the full list.

Verified at 1440, 1024, 390, and 320px. Search, provider/status filtering, active-row switching, and All sessions were exercised against the live provider. No horizontal overflow.

## Attachment proxy (2026-11-02)

Private provider images and files now render through the hub instead of the browser hitting the provider directly.

- `GET /api/v1/attachments?provider=<id>&url=<absolute URL>` requires hub auth and uses the selected provider’s credentials.
- The provider adapter resolves the request. It only accepts URLs on the configured provider origin, rejects credential-bearing URLs, follows at most three same-origin redirects, and caps the body at 20 MB.
- The hub serves only known raster image types inline. Other known types are downloaded; unknown types are forced to `application/octet-stream`. Every response sets `X-Content-Type-Options: nosniff`, a sandbox CSP, and a private cache policy.
- The web client fetches provider resources with its normal hub auth, then renders a blob URL. This works for both paired cookie auth and the pasted owner-token fallback; a plain `<img src="/api/v1/...">` would drop the bearer header.
- Markdown images, image file parts, and file Open actions all use the same path. Third-party public images still load directly.
- OpenCode writes project-relative file references (`docs/spec.md`, `docs/concepts/plot.png`). Those are resolved through the provider’s `/api/fs/read/...` endpoint with the session directory, not against the provider origin root. Markdown links use the authenticated proxy; clicking one fetches the provider file with the session credentials.
- Verified against live session `desktop-opencode:ses_e697a2765ffeQU4TBjcJe7WmnZ`: 10 storyboard images rendered at 1400×940 or 1440×900 from blob URLs, and clicking `docs/vr-interaction-spec.md` fetched the file through the proxy with HTTP 200. One reasoning block references `concepts/storyboards/01-browse.png` while the file is under `docs/concepts/...`; that path falls back because it does not exist relative to the session directory.
- Verified with provider resource tests for same-origin fetches, same-origin redirects, cross-origin rejection, 20 MB limits, auth errors, and missing files; hub tests for inline/download headers, cross-origin rejection, and auth; and a browser run with the owner-token fallback where markdown images and image file parts rendered from blob URLs.
- The desktop session sidebar and branch/model controls remain broader follow-ups.

Files changed: `packages/providers/src/http/resource.ts`, `packages/providers/src/types.ts`, both provider adapters, `packages/hub/src/http/routes/attachments.ts`, `packages/hub/src/app.ts`, `packages/client/src/hub-client.ts`, `apps/web/src/app/markdown.ts`, `apps/web/src/app/App.tsx`, `packages/testing/src/fake-providers.ts`, and the new provider/hub/web tests.

## Chat interaction additions (design-v1.2)

The copy action and hub-backed dictation are additive. They reuse the existing
type scale, spacing, radii, surfaces, borders, and focus grammar.

### Copy

- One quiet action after a completed assistant message with text. It is 11px,
  `--faint` on the page background, with a transparent border that becomes a
  `--surface-2` hover. The control radius is the existing 8px.
- The action is right-aligned under the message. It never appears for
  activity-only messages, while streaming, or for user messages.
- Success changes the label to `Copied` in `--success` for two seconds and
  announces "Copied to clipboard" through a `role="status"` node. Failure
  reads `Copy failed` in place. The label is not color-only.
- The action copies the raw text parts, including Markdown fences. Reasoning
  and tool payloads are excluded. A temporary textarea fallback covers
  non-secure origins where the async Clipboard API is unavailable.
- Mobile target: 44px. Desktop target: 28px; the control is still a full text
  button, not an icon-only affordance.

### Dictation

- One quiet `Dictate` action beside Send when the hub reports Voice
  transcription enabled, the page is a secure context, and the browser exposes
  `getUserMedia` and `MediaRecorder`. Otherwise the action is hidden; the
  Settings panel explains the requirement.
- While recording, a status row above the composer bar shows a 6px pulsing dot,
  `Recording`, and an elapsed `m:ss` timer. The action changes to `Stop` in
  `--accent`, and Send is disabled. The textarea remains editable.
- Stop changes the status to `Transcribing…`; the transcript is appended to the
  current draft with a separating space. Nothing is sent automatically.
- Errors use the existing inline alert above the composer with a `Dismiss`
  action. Microphone permission, missing device, device-in-use, network,
  disabled, unconfigured, and upstream errors have distinct human copy.
- The status row stays visible at 760px and below, where the composer hint is
  hidden. The action and Copy use 44px targets on mobile; the composer textarea
  remains 16px to avoid browser zoom.
- Privacy: audio goes from the browser to the hub and then to the configured
  OpenAI-compatible STT endpoint. The hub does not persist the audio and the
  endpoint key never reaches the browser.
- The `Permissions-Policy` response now allows `microphone=(self)` for the web
  client. The browser still asks the user for permission; third-party frames
  remain blocked.
- Limits: 25 MiB audio, 120-second client recording cap, WebM/Opus, Ogg/Opus,
  WAV, MP4/M4A, MPEG, and FLAC.

### Verification

- Copy, copied feedback, failure copy, and the screen-reader announcement were
  checked in the live chat.
- Dictation was exercised end to end with a synthetic microphone stream and a
  fake OpenAI-compatible STT endpoint: start, recording timer, Stop,
  transcribing, draft append, send gating, and Dismiss.
- Permission denial and an unreachable STT endpoint produced the expected
  inline errors.
- The Dictate action is absent when transcription is disabled.
- Dark and light themes were reviewed at 1440, 1024, 390, and 320px. No
  horizontal overflow. Copy and Dictate are 44px on mobile.
- The browser console has no runtime errors. Two advisory issues remain: the
  production Markdown renderer's lazy images without dimensions, and form
  fields without `id`/`name` (the composer textarea was given both; provider
  selects remain the existing pattern).

## Attachment and branching revision (design-v1.3)

The composer and transcript gained capability-gated attachments and branches.
No new type, spacing, radius, or color tokens were introduced.

### Attachments

- One quiet `Attach` action in the composer when `provider.capabilities.attach`
  is true. It is 11px/28px desktop and 44px mobile, using the existing
  `composer-voice` grammar.
- Staged files are a wrapping row above the textarea. Each chip is an 8px
  control surface with a 12px name, an 11px tabular size, and a remove control.
  The name truncates; the chip never exceeds the composer width. The remove
  target is 44px on mobile.
- Send is enabled when there is text or at least one attachment. Attachment-only
  sends are supported. Sending is disabled while an upload is in flight.
- The composer stays within the existing card grammar: the chips are controls,
  not nested cards. No new bordered metadata rows.
- Upload is capped at 20 MB per file and five files per message. The accept
  list is images, PDF, JSON, plain text, Markdown, and CSV. Unsupported or
  oversized files produce the existing inline alert with Dismiss.
- The hub stores staged files under `<dataDir>/attachments`, expires them after
  one hour, and removes them after a successful send. The client sees only
  metadata.

### Branches and forks

- In-chat branch points render one quiet picker under the active assistant
  message, beside Copy. It is a pill: 28px arrow buttons on desktop, 44px on
  mobile, 11px count. Previous/Next are disabled at the ends rather than
  disappearing.
- Switching replaces the visible path and starts at the latest message. The
  picker updates to the new index/count. The action is disabled while switching.
- When `retry` is available, one quiet `Retry` action sits beside Copy. It
  reads `Retrying…` while the new sibling runs, then refreshes the transcript
  and picker. The old answer is never overwritten; it remains a branch sibling.
- OpenCode session-level forks live in the details panel as a single
  `Fork session` action. A forked session shows its parent reference and an
  `Open parent` action. There is no new tree screen or sidebar section.
- Capability gating: no `attach` means no upload action; no `branches` means no
  picker; no `fork` means no fork action. The API returns a capability error if
  a client calls an unsupported action.

### Verification

- Live OpenCode: uploaded `tmp-attachment.txt` (49 B), sent it with a prompt,
  saw the user message render `tmp-attachment.txt` / `text/plain`, and received
  `ORANGE` from the model. The staged file was deleted after send. The test
  session was deleted from the provider.
- Live OpenCode fork: `Fork session` opened a `(fork #1)` session with a new
  reference and the inherited history; the fork was deleted afterward.
- Fake Open WebUI: the branch fixture rendered `‹ 2 / 2 ›` under
  "Alternative two."; Previous replaced the transcript with
  "Alternative one." → "Continue alternative one." → "Answer one." and the
  picker became `‹ 1 / 2 ›`.
- Fake Open WebUI retry: Retry on "Alternative two." created a new sibling, the
  picker became `‹ 3 / 3 ›`, and the transcript showed the new reply. The old
  answers remained reachable through the picker.
- Mobile: the branch arrows and attachment remove control are 44px; the
  attachment chip fits at 390px; no horizontal overflow.
- Tests: 240 total after the attachment/branching slice. Typecheck, web/hub
  builds, and OpenAPI check pass.

## Files changed

- `apps/web/src/app/App.tsx`: chat shell, desktop session sidebar, topbar context, inline attention, details panel, date separators, error copy, focus handling, provider URL resolution, image attachments, stable activity keys, attachment proxy client, composer selection picker.
- `apps/web/src/app/markdown.ts`: provider-relative link and image resolution, OpenCode filesystem links, provider-image marking, safe image rendering, image fallbacks.
- `apps/web/src/app/urls.ts`: link, image, session-resource, and attachment URL resolver with OpenCode filesystem reads, safe-scheme, and same-origin rules.
- `apps/web/src/app/urls.test.ts`: resolver, OpenCode filesystem, and same-origin coverage.
- `apps/web/src/styles.css`: chat shell and desktop session sidebar, pinned composer, details column/overlay/sheet, inline attention, date separators, mobile composer actions, image attachments, selection picker.
- `packages/providers/src/http/resource.ts`: provider resource fetch, same-origin validation, redirect limits, size cap.
- `packages/providers/src/http/resource.test.ts`: resource proxy coverage.
- `packages/providers/src/types.ts`: provider resource method.
- `packages/providers/src/opencode/adapter.ts`: form description detail, authenticated resource fetch.
- `packages/providers/src/openwebui/adapter.ts`: image and file content normalization, authenticated resource fetch.
- `packages/hub/src/http/routes/attachments.ts`: authenticated attachment proxy and response policy.
- `packages/hub/src/app.ts`: attachment route registration.
- `packages/hub/src/app.test.ts`: proxy headers, cross-origin, and auth coverage.
- `packages/client/src/hub-client.ts`: authenticated blob fetch for attachments, session selection.
- `packages/client/src/hub-client.test.ts`: send, attachment, and selection client coverage.
- `packages/contracts/src/common.ts`: model variants in provider options.
- `packages/contracts/src/sessions.ts`: session selection input.
- `packages/contracts/src/openapi.ts`: selection route and schemas.
- `packages/hub/src/http/routes/sessions.ts`: session selection route.
- `packages/hub/src/services/session-service.ts`: provider selection pass-through and cache update.
- `packages/hub/src/providers/openwebui-adapter.test.ts`: Open WebUI model options and switching.
- `docs/openapi.yaml`: regenerated selection route and schemas.
- `packages/testing/src/fake-providers.ts`: question detail, attachment fixtures, selection endpoints, agent and model variants.
- `docs/ui-ia.md`: chat header, transcript, composer, details, mobile, and attachment rules updated to the shipped shell.
- `docs/design-lock.md`: chat shell alignment.
- `docs/visual-audit.md`: this audit and the before/after measurements.
- `docs/brand/`, `apps/web/public/`, `docs/screenshots/`: brand mark, favicons, app icons, banner, and README imagery.
- `README.md`: link to the audit and the brand banner/screenshot.

### design-v1.2 interaction slice

- `apps/web/src/app/chat-actions.ts`: message copy text, transcript append, timer formatting, and audio MIME selection.
- `apps/web/src/app/chat-actions.test.ts`: copy, append, and timer coverage.
- `apps/web/src/app/App.tsx`: copy action, hub-backed dictation, microphone error copy, recording timer, send gating, and settings copy.
- `apps/web/src/styles.css`: copy action, dictation status, voice action, screen-reader utility, and mobile targets.
- `packages/contracts/src/settings.ts`: transcription result schema.
- `packages/contracts/src/openapi.ts`: multipart transcription route and result schema.
- `packages/client/src/hub-client.ts`: multipart transcription client.
- `packages/client/src/hub-client.test.ts`: transcription request and capability-error coverage.
- `packages/hub/src/services/transcription-service.ts`: configured upstream transcription, limits, logging, and errors.
- `packages/hub/src/http/routes/transcribe.ts`: multipart audio validation and route.
- `packages/hub/src/http/limits.ts`: JSON and audio body limits and accepted audio types.
- `packages/hub/src/http/middleware/security.ts`: audio route limit and `microphone=(self)`.
- `packages/hub/src/app.ts`, `packages/hub/src/main.ts`: transcription service and route wiring.
- `packages/hub/src/app.test.ts`: success, disabled, unconfigured, oversized-exemption, failure, timeout, and microphone-policy coverage.
- `docs/openapi.yaml`: regenerated transcription route and schema.
- `docs/interaction-contract.md`: chat interaction contract.
- `docs/design.md`: ADR-012.
- `docs/design-lock.md`: design-v1.2.
- `docs/ui-ia.md`: copy and dictation rules.
- `docs/visual-audit.md`: this section.

### design-v1.3 attachment and branching slice

- `packages/contracts/src/messages.ts`: attachment, branch point, branch switch, and fork schemas; attachment limits.
- `packages/contracts/src/common.ts`: `attach`, `branches`, and `fork` capabilities.
- `packages/contracts/src/openapi.ts`: attachment upload/delete, branches, fork, and multipart schemas.
- `packages/providers/src/types.ts`: provider attachment input and branch/fork adapter methods.
- `packages/providers/src/opencode/adapter.ts`: data-URI prompt files, inline file normalization, and session forks.
- `packages/providers/src/openwebui/adapter.ts`: branch listing, branch switching, retry-as-a-sibling, and read-only attachment capability.
- `packages/hub/src/services/attachment-store.ts`: staged file storage, limits, expiry, and cleanup.
- `packages/hub/src/services/session-service.ts`: attachment resolution, branch/retry service methods, and fork creation.
- `packages/hub/src/http/routes/attachments.ts`: upload and delete routes.
- `packages/hub/src/http/routes/sessions.ts`: branch, retry, and fork routes.
- `packages/hub/src/http/middleware/security.ts`: 20 MiB attachment route limit.
- `packages/hub/src/app.ts`, `packages/hub/src/main.ts`: attachment store wiring.
- `packages/client/src/hub-client.ts`: upload/delete, branches, switch, and fork methods.
- `apps/web/src/app/App.tsx`: attachment chips/upload/send, branch picker, fork/parent actions, and capability gating.
- `apps/web/src/styles.css`: attachment chips, branch picker, and mobile targets.
- `packages/hub/src/app.test.ts`: staged upload/send/cleanup, capability rejection, branch switching, retry, and fork coverage.
- `packages/hub/src/providers/opencode-live.test.ts`: attachment normalization and fork coverage.
- `packages/hub/src/providers/openwebui-adapter.test.ts`: branch listing/switch and retry coverage.
- `packages/client/src/hub-client.test.ts`: upload/branch/retry/fork client coverage.
- `packages/testing/src/fake-providers.ts`: attachment echo, branch fixture, and fork endpoint.
- `docs/openapi.yaml`: regenerated attachment/branch/fork schemas.
- `docs/interaction-contract.md`: implementation status and API details.
- `docs/design-lock.md`: design-v1.3.
- `docs/ui-ia.md`: attachment, branch, and fork rules.
- `docs/visual-audit.md`: this section.
