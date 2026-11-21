# Visual Design Audit

> Status: frozen in [`design-v1`](design-lock.md) on 2026-10-26. Session transcript revision `design-v1.1` applied 2026-10-27; chat shell alignment applied 2026-11-02; wide-field layout revision applied in `design-v1.13` on 2026-11-15, aligned to the reading column in `design-v1.14`, given the mobile collision fixes in `design-v1.16`, the accessibility pass in `design-v1.17`, the accessibility follow-ups in `design-v1.18`, and session rename plus search label alignment in `design-v1.19`.

Scope: the web prototype and the design tokens in `docs/prototypes/styles.css`. The information architecture and flows are recorded in `docs/ui-ia.md`; the shipped IA is Overview + Providers-in-Settings.

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

- Inbox, Sessions, Search, and Providers no longer open with a hero card. Inbox keeps its filters and one quiet Refresh action in a toolbar; Sessions keeps a compact page lead with Refresh and New session; Search and Providers start directly with their first panel. Overview keeps its usage report and runtime cards.
- The hero gradient was removed. The hero is now a normal `surface` card.
- The topbar and page content share one gutter: 24px on desktop and 16px on mobile. The topbar title, filters, panels, and page actions now start on the same x-axis.
- The rail and mobile bottom navigation use the shared 16/18px line-icon set instead of lettermarks. Back, theme, close, branch, and disclosure controls use the same set instead of text glyphs. The attention badge is 10px/700, not 9px/800.
- Desktop controls are 32px high (`btn small`, chips, icon buttons); quiet message actions remain 28px. Mobile controls keep the 44px target, except the 32px composer send that keeps its expanded hit area.
- The Settings assistant cards pin their footer actions to the card bottom, so Save/Load models align across the two-column row.
- The wide composer keeps its agent/model/reasoning picker on one row. The composer hint is nowrap with ellipsis instead of wrapping the action bar.

Verification: 1440, 1024, 390, and 320px in dark and light. No horizontal overflow; the console is clean apart from the existing `apple-mobile-web-app-capable` deprecation warning.

Remaining: per-message model overrides are not implemented, the New session form still creates with the provider default variant, and providers that do not expose options get no picker.

## Model selector grouping (2026-11-08)

The composer and New Session model pickers now group options by the upstream model provider. The OpenCode catalog in the live hub returned 120 models across four providers, which made a flat select hard to scan.

- The model option keeps its existing native `<select>`. Grouped options use `<optgroup>` with humanized provider labels (`OpenCode`, `OpenCode Go`, `Command Code`, `llama.cpp`).
- Provider order and model order follow the provider response; groups are not alphabetized or re-sorted. Models without provider metadata and a selected model missing from the catalog remain ungrouped options.
- A catalog with one group or no provider metadata stays a flat list, including Open WebUI’s model list.
- Native select was kept deliberately: it preserves keyboard typeahead, the platform mobile picker, and screen-reader group semantics without adding a new popover, focus layer, or design token. A searchable combobox is a follow-up only if model catalogs grow beyond what grouped native scrolling can handle.

Verified at 1440 and 390px in dark and light. The composer select exposed four optgroups with 120 options; selection, running-disabled state, and reasoning variants are unchanged.

## Mobile composer placeholder (2026-11-08)

The composer now uses the static `Reply…` placeholder. The full session title stays in the textarea’s `aria-label`.

Previously the placeholder was `Reply to <session title>…`. At 360px and below, a 70-character title wrapped to three lines at the mobile 16px text scale, but the two-row composer textarea is only 64px high. Its `scrollHeight` was 88px, so the last line of the placeholder was clipped. The static placeholder removes the overflow without hiding the session title from screen readers.

Verified at 320, 360, 375, and 390px; the textarea now reports `scrollHeight === clientHeight` with an empty draft.

## Chat sidebar (2026-11-02)

The desktop chat now includes the prototype’s session sidebar.

- The sidebar is 300px, sits between the rail and the transcript, and uses the panel surface with a right border.
- It has search, provider and status filters, Today/Yesterday/Earlier groups, session rows, status dots, attention badges, and an active row with the raised surface, strong border, and 2px accent inset.
- The list loads the newest 100 sessions and refreshes after session events. The active session is injected and sorted into the list if it falls outside the loaded page.
- The transcript reading column is capped at 728px inside the panel. The panel frame may be 920px, but the prose measure stays at 728px; the 48px bottom inset gives the floating jump a clear gutter.
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
  `composer-voice` grammar. Files or images pasted into the composer
  (`Ctrl/⌘+V`) upload through the same staged-attachment path and produce the
  same chips; a paste containing files never inserts binary data into the
  textarea.
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
- Paste: a synthetic `Ctrl+V` PNG in the live composer was intercepted, uploaded
  as `paste-test.png` (68 B), and rendered as a chip; a text-only paste was not
  intercepted. The chip was removed afterward.
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

### design-v1.4 composer reply suggestions and select sizing

- `Suggest` is one quiet composer action, shown only when the reply model is
  configured. It fetches model suggestions on demand and inserts a selected
  suggestion into the draft. It never sends, never overwrites an existing draft,
  and never runs when a chat opens.
- The hub gate still classifies `reply` / `wait` / `done`, but no state is a
  dead end: `wait` and `done` get the same four-to-six suggestion chips. The
  chips are tagged `Alt`, `Next`, `Check`, `More`, or `Ask`.
- Suggestion chips use the existing surface, border, radius, and type tokens.
  They wrap above the textarea, mark model output with a `Suggested` label, and
  carry `Alt` / `Ask` role tags. Loading, empty, error, retry, and dismiss states
  stay inline and do not move the composer.
- The audit page exposes the gate result, MOMENT block, and rejected suggestions
  so a reviewer can see why a suggestion was skipped or removed.
- Selects use `field-sizing: content` so the composer and filter selects fit
  their current value. Full-width form selects keep their layout width.
- Mobile suggestion chips and their dismiss/retry controls use 44px targets. The
  row wraps without horizontal overflow at 320px.
- `apps/web/src/app/App.tsx`: suggestion state, gate notice, roles, generation,
  insert, loading, error, and dismiss behavior.
- `apps/web/src/styles.css`: suggestion row, chips, `Alt`/`Ask` tags, and mobile
  targets.
- `packages/ui/src/base.css`: `field-sizing: content` for selects.
- `docs/ui-ia.md`: composer suggestion rules and select sizing.

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

## Transcript file preview (2026-11-12)

A session that wrote a Markdown file showed the whole document as escaped JSON
inside the collapsed activity row, and the reply named the file without any way
to read it. The fix keeps the row collapsed and makes the body readable.

- A write tool part whose input carries a path and a body renders as a file card
  inside the existing disclosure: name at 12px/600, size and path at 10px, and
  the body in a 360px scroll region. Markdown renders through the transcript
  renderer at 12px/1.55 with headings capped at 14px; other bodies render as
  preformatted text at 11px.
- The row label keeps the humanized tool name and gains the file name in the
  existing quiet meta slot. No new type, spacing, radius, or color token was
  added, and nothing leaves the collapsed activity block.
- A file mention in message prose becomes a quiet button (dashed underline,
  accent on hover, 2px focus outline) when the provider advertises `files`. It
  opens a modal preview, and so does the card's file name.
- The preview is a sheet at 16px radius with a large shadow, a pinned head and a
  scrolling body: title at 16px/600, path at 11px mono, one 32px (44px mobile)
  close control. Text sits at 720px; media sits at 960px with a 520px floor and
  a centered body. Escape and the scrim close it and focus returns to the
  mention.
- Render mode follows content type with the extension as fallback: Markdown,
  preformatted text, image, `<video controls>`, `<audio controls>`, sandboxed
  HTML frame, and PDF frame. The sandboxed HTML frame has `sandbox=""`, so an
  agent-authored page cannot run scripts or reach the app.
- The body is read live through `GET /api/v1/sessions/:ref/files`, so the
  snapshot in the transcript is never mistaken for the current file.
- Bodies over 50,000 characters are cut in the card with a note. Preview caps:
  1 MB text and Markdown, 5 MB HTML, 20 MB images, media, and PDF.
- The hub jails the path to the session directory: relative paths and absolute
  paths inside it both work (agents write the absolute form), and anything
  outside returns `400`. Missing files return `404`, providers without `files`
  return `501`. Readable types render inline; other types download.

Verification: unit coverage for the parser, the path guard, the route, and the
client method. The card sits inside `.message-aux-body`, so it inherits the
collapsed-row surfaces in both themes; the 360px region keeps long documents from
pushing the composer, and the card wraps without horizontal overflow at 320px.

### Files changed

- `apps/web/src/app/tool-files.ts`, `apps/web/src/app/tool-files.test.ts`: write-tool detection, path/body extraction, truncation, size formatting.
- `apps/web/src/app/App.tsx`: file card, row meta, preview sheet, mention handling, shared size formatter.
- `apps/web/src/app/urls.ts`: previewable mention detection.
- `apps/web/src/app/markdown.ts`: mention buttons and heading offsets.
- `apps/web/src/app/urls.ts`: `sessionRef` and `fileRead` on the resource context.
- `apps/web/src/styles.css`: file card, path, preview region, and download action.
- `packages/contracts/src/common.ts`, `packages/contracts/src/openapi.ts`: `files` capability and the session file route.
- `packages/providers/src/files.ts`, `packages/providers/src/files.test.ts`: session path normalization and rejection rules.
- `packages/providers/src/types.ts`: `readFile` adapter method and file request shape.
- `packages/providers/src/opencode/adapter.ts`: provider filesystem read through `/api/fs/read/`.
- `packages/providers/src/openwebui/adapter.ts`: `files: false`.
- `packages/hub/src/services/session-service.ts`: jailed session file reads.
- `packages/hub/src/http/routes/files.ts`, `packages/hub/src/http/resource-response.ts`: file route and shared response policy.
- `packages/hub/src/app.test.ts`: read, jail, missing path, unsupported provider, and auth coverage.
- `packages/client/src/hub-client.ts`, `packages/client/src/hub-client.test.ts`: `sessionFile` and the shared blob path.
- `packages/testing/src/fake-providers.ts`: `/api/fs/read/` fixtures.
- `docs/openapi.yaml`: regenerated.
- `docs/ui-ia.md`, `docs/design.md`, `docs/code-structure.md`, `docs/interaction-contract.md`: contract and transcript rules.

## Agent activity tiles (2026-11-14)

The activity block was an expanding list: an opened group exposed one row per
event, so a long turn became thousands of pixels of vertical scroll. It is now a
fixed-grammar wrap grid.

- **Collapsed.** One header row plus a dot stamp that flows horizontally and
  wraps naturally, so six steps are one row. Dots are 4px squares (1em at a
  4px font size) with a 1px gap, no radius, and 50% opacity so the stamp reads
  as texture rather than controls. They carry the same family/status colours
  as the tiles. The header is the disclosure button; the stamp is
  `aria-hidden`.
- **Tiles.** 49px wide at the default size (56px reference × 0.875), content
  height (~53px), 4px gap, 8px radius. One tile per step: 1.09rem icon over a
  0.625rem metric. The grid wraps and never scrolls sideways.
- **Colour.** The only category signal is a 6% `color-mix` wash of the family
  hue plus the icon in that hue. No border, no fill at rest. Hover is 12%, an
  open tile is 14% plus a 2px accent inset, and focus is the standard 2px accent
  outline. Status overrides the family: error red, running amber, live subagent
  green — the success colour means "alive" only for subagents.
- **Metrics.** One value per tile, abbreviated by `metrics.ts` to about eight
  characters (1.3k ch, exit 255, 1.5 KB, 49 hits, 1k×320). The exact number
  lives in the tooltip, the aria label, and the step panel. A step with no
  metric keeps the empty line so icons stay aligned.
- **Inline step.** Selecting a tile inserts a full-width panel on its own line
  after that row — no modal. Header: status chip, name, mono subtitle, time,
  32px close (44px mobile). Body: kind-specific blocks, 22.5rem maximum with
  its own scroll. Footer: hint plus Previous / Next. Opening scrolls the panel
  into view and suspends the transcript's bottom pin until it closes.
- **Compaction.** A transcript divider outside the grid, with the reason, input
  tokens, summary size, and an inline Show summary. It wraps to two lines below
  760px.
- **Units.** Everything in this block is rem/em; the reference tile is 3.0625rem
  wide so root font-size changes scale it.

### Files changed

- `packages/contracts/src/messages.ts`: tool `metadata`/`startedAt`/`completedAt`, and the `compaction` part.
- `packages/providers/src/opencode/adapter.ts`: tool metadata and timings, compaction messages, synthetic still dropped.
- `apps/web/src/app/activity.ts`, `activity.test.ts`: step extraction, families, status, metrics.
- `apps/web/src/app/metrics.ts`, `metrics.test.ts`: compact numbers, bytes, durations, diffs, pixels.
- `apps/web/src/app/App.tsx`: `ActivityTiles`, `StepPanel`, `StepBody`, `CompactionRow`; the old activity rows and tool disclosure are gone.
- `apps/web/src/app/Icon.tsx`: terminal, code, file, file-plus, pencil, globe, bot, image, layers, bulb.
- `apps/web/src/styles.css`: tile grid, family palette (dark and light), inline panel, compaction divider, `overflow-anchor: none` on the transcript.
- `packages/testing/src/fake-providers.ts`: shell/execute/subagent metadata, timings, and a compaction fixture.
- `packages/hub/src/app.test.ts`: metadata, timings, and compaction coverage.
- `docs/ui-ia.md`, `docs/interaction-contract.md`, `docs/design.md`, `docs/design-lock.md`: rules.

## Background work (2026-11-14)

Background shells and subagents outlive the turn that starts them, so they get
their own surfaces instead of being buried in the activity grid.

- **Shell rows.** A `shell` message renders as a full-width transcript row:
  16px terminal icon, `Background shell` at 12px, the command in mono at 10px
  with ellipsis, a status pill (`running` amber, `exit N` red when non-zero),
  elapsed time, and one Show output action. Output expands into the same
  14rem mono block used elsewhere. The row is separate from the activity grid.
- **Details → Background.** Lists only live work for the open session: running
  background shells and running subagents. Each row carries an icon, type
  label, command or agent, a running pill, elapsed time, and Open session for
  subagents. The section is hidden when nothing is live.
- **Subagent liveness.** A background subagent's launch tool call completes
  immediately, so its tool status is `completed` while the child session keeps
  running. The tile takes its status from the child session's current status,
  never the launch metadata, which keeps the launch-time `running` value
  forever.
- **Data.** OpenCode's `shell` messages (`shellID`, `command`, `status`, `exit`,
  `output`, background metadata, timings) map to a transcript `shell` part.


## Background indicator and root scope (2026-11-14)

- Superseded by **design-v1.5** below: the chip is now part of an in-flow
  composer status row, and the session list is a tree.
- A subagent's status is resolved from its child session, not the launch tool
  metadata. The metadata keeps its launch-time `running` value forever, which
  made every historical subagent look live in the Background section.
- Sessions no longer default to a roots-only list; `All` is the tree and
  `Root` is a strict filter.

## Subagent tree and composer status (2026-11-15)

The session list was a flat feed. Root sessions and subagents shared one column,
so a child read as a peer, and a parent with 27 subagents produced 27 unrelated
rows. The background chip was also a second absolute pill above the composer,
which could overlap the Jump to latest action at narrow widths. Both were
structure problems, not styling problems.

- **Tree.** Root rows keep the full card width. A parent with children shows
  `N subagents` (and `N running`) in the existing 11px meta line. Children
  indent 16px with a quiet 1px rail and the 10px `SUBAGENT` tag; no new type
  size, colour, or radius. A parent is ordered by the newest update in its
  branch, so a live child lifts the family.
- **Disclosure on the right.** A chevron sits in a reserved trailing area of
  the parent card: 32px on desktop and 44px on mobile. It is a sibling of the
  session button, never a nested button. The card reserves 44px/48px trailing
  padding so time and status stay clear. The chevron rotates 90°, keeps the
  standard 2px accent focus ring, and the rest of the card still opens the
  parent.
- **Why not a left gutter.** A left gutter on every row shifted the whole list
  and cost 44px of title width at 390px. Root rows must align with the page
  gutter; children are the only rows that indent.
- **Scopes.** `All` is the tree, `Root` is roots only with child counts, and
  `Subagents` is the flat inspection list. An orphan child (parent outside the
  loaded page) stays visible under a quiet uppercase section label.
- **Sidebar.** The same tree inside the sidebar's day groups. The active
  session's parent auto-expands; a family is grouped under the parent's day.
  The sidebar keeps its compact 2px row gap and 16px child indent.
- **Composer status.** The background chip and Jump to latest are one in-flow
  flex row above the composer, aligned to the composer width. The row wraps;
  the chip truncates with ellipsis; the jump stays right. No absolute
  positioning, no overlap, no extra scrim. The chip label names the work:
  `1 subagent running`, `1 shell running`, or `N running`.
- **Responsive.** Verified at 1440, 1024, 390, and 320 in both themes. At 390
  root cards start at 33px, children at 50px, and the parent chevron sits in
  the 44px trailing area. At 320 the status row stays above the composer and
  wraps without horizontal overflow.
- **Accessibility.** The disclosure has `aria-expanded` and `aria-controls`;
  the child group is labelled `Subagents of <parent>`; child aria labels read
  `subagent of <parent>`. The parent and child cards keep their normal session
  button and status semantics.
- **Files.** `apps/web/src/app/session-tree.ts` (pure tree/filter),
  `SessionRow.tsx`, `SessionTree.tsx`, `App.tsx` mounts, `styles.css` tree and
  composer status rules, `session-tree.test.ts`.

## Question choice detail (2026-11-15)

The hub rendered a provider question as a native `<select>` with a field label
and no option copy. OpenCode sends a question, a field label, three option
descriptions, and a custom answer; the select could only show three labels.

- **Field grammar.** The field title is a 10px uppercase label (`TUI
  DEPENDENCIES`); the field description is the 14px/500 question
  (`How should the TUI handle terminal input?`); `Select one answer` is the
  11px hint. This separates the provider's label from its question without a
  new type role.
- **Option rows.** Each option is a 1px-bordered control with an 8px radius,
  8px/12px padding, a 16px radio, the label at 14px/500, the description at
  12px/1.5, and a 10px numbered index in a 4px-radius badge. The selected row
  uses the accent border plus the 2px accent inset. The rows read as choices,
  not as another layer of cards.
- **Custom answer.** `Type your own answer…` is the last row; selecting it
  reveals a 14px text input inside the row. The radio remains the selection
  control; the value is the text. Submit is disabled until the text is
  non-empty.
- **Required.** The Submit action is disabled until every required field has a
  value. OpenCode's visible fields default to required unless the provider says
  otherwise.
- **Question vs assistant text.** The field description replaces the previous
  fallback to the latest assistant question. The transcript above the card
  still carries the assistant's framing, so the card does not repeat it.
- **Files.** `packages/contracts/src/attention.ts`,
  `packages/providers/src/opencode/adapter.ts`, `apps/web/src/app/App.tsx`
  (`AttentionChoiceField`), `apps/web/src/styles.css`.

## Message delivery and queue (2026-11-15)

Steer already lived in the composer as a send label. Queue added a second
delivery mode, so the composer needed an explicit choice and a place for
messages that the provider has not delivered yet.

- **Toggle grammar.** `Steer` and `Queue` share one 28px pill control with a
  1px border and a 2px inner padding: a control, not two more chips. The active
  option uses `--accent` with `--on-accent`; the inactive option stays muted.
  The accent marks the current delivery, not a provider identity.
- **Placement.** The toggle leads the existing in-flow composer status row and
  only renders while the turn runs. It does not displace the background chip or
  Jump to latest, and the row already wraps at 320px.
- **Queue tray.** The tray is a surface panel above the composer input: 1px
  border, 8px radius, 8px padding, `Queued` at 10px/700 with a tabular count,
  message text at 11px/1.5, and quiet text actions. It is not a transcript row
  and it is not a card per message. The list caps at 24vh and scrolls; long text
  breaks with `overflow-wrap: anywhere`.
- **Primary action.** Send follows the toggle and reads `Steer` or `Queue`.
  Interrupt stays the only other action while running, so the bar keeps one
  filled control.
- **Contrast.** The active option is `--on-accent` on `--accent`, matching the
  primary button pair. Inactive options use `--muted` at 11px, which clears the
  4.5:1 floor on `--surface-2`. Remove uses `--muted` and turns `--text` on
  hover.
- **Targets.** Desktop toggle options are 28px and tray actions 28px with the
  row providing the hit area. At 760px and below the options are 32px and the
  tray actions are 44px; Remove is a 44px square.
- **States.** `aria-pressed` marks the delivery choice, the tray is labelled
  `Queued messages`, and the send action names Steer or Queue. Provider failure
  to read the tray shows inline `--danger` text without replacing the list.
- **Files.** `apps/web/src/app/App.tsx`, `apps/web/src/styles.css`,
  `docs/ui-ia.md`, `docs/interaction-contract.md`.

## Composer delivery revision (2026-11-15)

The v1.7 delivery toggle sat in the status row, up to the full composer width
away from the send action it changed, and the tray's `Steer now` collided with
the toggle's `Steer`. This revision supersedes that control.

- **One send meaning.** `Steer | Queue` is removed. While a turn runs, Send is
  always **Steer**, and the hint names steer. Delivery is no longer a mode the
  user has to read before every send.
- **Adjacent queue action.** A quiet `Queue` text action sits directly left of
  Send, between Interrupt and the primary button. It only renders while the
  turn runs, only when both deliveries are supported, and disables with an
  empty draft. It is 28px on desktop and 44px on mobile like the other quiet
  composer actions.
- **One-line queue summary.** The tray collapses to a 32px row (44px on
  mobile): a 10px uppercase `QUEUED`, a tabular count, the first message at
  11px with an ellipsis, and a 14px chevron that rotates when expanded. The
  expanded list sits under a 1px divider, caps at 24vh, and carries `Send now`
  and Remove at 28px desktop / 44px mobile. The summary hover uses
  `surface-3`; the focus outline is inset so it stays inside the border.
- **Feedback and naming.** `Send now` replaces the ambiguous `Steer now`, so
  only the send action is called Steer. A polite status region announces the
  queued count when it changes. Remove keeps the accessible name `Remove
  queued message`.
- **Mobile bar.** At 760px and below the bar stacks into a context row and an
  actions row. `Attach` stays visible; `Suggest` and `Dictate` move to a `⋯`
  disclosure anchored to the actions row; Interrupt reads `Stop`; Send remains
  the 32px icon. At 320px this removes the clipped send action and lets both
  selects show their values on the full-width row. The 200px select cap keeps
  the model readable at 390px.
- **Disclosure behavior.** The `⋯` menu closes on Escape, outside pointer, or
  selection. Escape returns focus to the toggle. The queue summary expands in
  place and drops its preview while open so the first message is not repeated.
- **Contrast.** Summary preview and count use `--muted` at 11px on
  `--surface-2`; the label uses `--faint` at 10px/700. Both clear 4.5:1 in dark
  and light. The chevron is decorative.
- **Files.** `apps/web/src/app/App.tsx`, `apps/web/src/styles.css`,
  `tests/e2e/chat.e2e.ts`, `docs/ui-ia.md`, `docs/interaction-contract.md`.

## Composer one-row revision (2026-11-15)

The v1.8 mobile bar stacked the context selects above the actions and moved
`Suggest` into the overflow. That cost about 36px of permanent height and one
tap on a common action. This revision supersedes the mobile bar.

- **Height audit.** The v1.8 composer measured about 172px: 24px padding,
  64px two-line draft, 32px context row, 8px gap, 44px actions. The one-row
  revision is about 112px: 16px padding, 44px one-line draft, 8px bar padding,
  44px row.
- **Action order.** `Suggest` and `Attach` are inline quiet actions; Send is
  the only accent control. Interrupt becomes a 32px stop square. `Dictate` and
  `Queue` move to the `⋯` menu. The `⋯`, stop, and send controls form one
  32px square cluster with 4px gaps; the text actions keep 44px hit areas. At 360px and below, `Attach` joins the menu only while
  running, keeping the row at five controls.
- **Context chip.** A 60px pill shows the agent (or the model when no agent is
  set) with an ellipsis. It is 44px on mobile, uses the pill radius and a
  subtle border, and carries the full `Model and agent: …` name.
- **Sheet.** A bottom sheet with a 16px top radius, a 16px title, a 44px close
  target, 10px uppercase field labels, 44px native selects at 16px, and a
  pinned footer. The scrim is `#0000006b`; Escape and the scrim close, Tab is
  trapped, and focus returns to the chip. It is the same sheet grammar as the
  details and file preview surfaces.
- **Draft.** The mobile textarea starts at one line (44px) and grows to 180px
  from `scrollHeight`. Desktop keeps the two-line 56px minimum. Mobile composer
  padding drops to 8px and the row gap to 4px.
- **Files.** `apps/web/src/app/App.tsx`, `apps/web/src/styles.css`,
  `tests/e2e/chat.e2e.ts`, `docs/ui-ia.md`.

## Diagram rendering (2026-11-15)

Assistant answers sometimes include Mermaid flowcharts. They now render as diagrams
instead of raw fences, without changing the transcript hierarchy.

- **Natural size, not fit-to-width.** A 1976px flowchart squeezed into a 700px
  message turns 16px labels into ~6px text. The diagram panel keeps the SVG at
  its natural width and scrolls horizontally inside the message. A 10px faint
  `Scroll to see the full diagram` hint appears only when the SVG is wider than
  the panel.
- **Surface.** The diagram uses the existing `surface-2` panel, 12px padding,
  8px radius, 12px vertical margin, and the current `surface-3` node fill,
  border, text, and line tokens. No new color, radius, type, or spacing token
  was added.
- **Theme.** Mermaid is initialized from the resolved CSS tokens for the active
  theme. Switching dark/light re-renders visible diagrams; the source is kept in
  a hidden block for that re-render.
- **Safety.** Mermaid runs with `securityLevel: "strict"` and HTML labels off.
  The generated SVG is sanitized with DOMPurify's SVG profile before insertion.
  Click handlers and raw HTML labels are not admitted.
- **Loading and failure.** The source fence stays visible until the SVG is
  ready, and remains as the fallback when parsing fails. Rendering waits 250ms
  for streaming to pause. Mermaid is a lazy dynamic import, so the main bundle
  is unchanged when a session has no diagrams.
- **Files.** `apps/web/src/app/mermaid.ts`, `markdown.ts`, `App.tsx`,
  `styles.css`, `apps/web/package.json`.

## Lineage tree (2026-11-16)

- Rows indent 12px per depth inside the details panel, so a fork reads as a
  child of the session above it without a connector line.
- The current row uses the existing active grammar: raised surface, strong
  border, 2px accent inset. It is a button for every other row only, so the
  affordance matches the behaviour.
- Titles are 12px and truncate on one line; the depth label stays at 10px faint.
  The section header carries the count and the word `partial` when capped.

## Transcript loading states (2026-11-18)

- The transcript skeleton uses three message-shaped rows of `surface-2` bars at
  the reading-column width, with the existing 4px radius and no borders. It is
  decorative, `aria-hidden`, and pulses only under
  `prefers-reduced-motion: no-preference`.
- The false-empty bug is recorded here as the rationale: the empty state
  claimed "no messages" while the first page was still loading, and a failed
  first prompt navigated into that state. Loading, waiting, error, and empty are
  now mutually exclusive.
- Copy: waiting reads "The agent is running, but no messages have been written
  yet." with Retry; empty keeps the first-prompt half only when the provider can
  send.
- Reviewed at 1440, 1024, 390, and 320px in both themes; no new tokens.

## Local data and export (2026-11-16)

- Local data is one Settings panel with four rows. Each row is name and count
  on the left, a retention select and Clear on the right; the cache keeps its
  toggle, keep-for days, and session cap because those are its controls.
- Destructive scope gets a second click: `Clear all local data` becomes
  `Confirm clear all local data` plus `Cancel`.
- Export is two text links under a `Data` heading in details, not another
  button in the pinned action bar. Format is the choice.
- Numbers and sizes use tabular figures; nothing new in the palette.

## Overview usage (2026-11-16)

- The default destination is renamed Overview; the route does not change. The
  phase-0 hero is removed because it carried a second 20px heading (the chat
  document title owns `--text-xl`) and repeated roadmap copy that had gone
  stale. Runtime status cards, the provider panel, the event stream, and diagnostics
  stay, after the usage report.
- Usage is a table above 1100px and stacked rows below. Group, sessions,
  tokens, and cost align right with tabular numerals in the sans family; the
  mono family stays reserved for references, paths, and endpoints.
- Unreported figures are em dashes. The count note names how many sessions
  reported nothing, so a provider that reports nothing never reads as free.
- The `Reported total` row is 600 weight with a stronger top border; every
  other row separates on `--border-subtle`.
- The group-by control reuses the filter chip row. No Collapse control: the
  panel lives on its own screen, so hiding it would only add chrome.
- Reviewed at 1440, 1024, 390, and 320px in both themes; no overflow, no
  console errors. The bottom bar keeps five items.

## Message search (2026-11-16)

- Results are a flat list of rows inside one panel, not cards. Rows separate on
  `--border-subtle` and the whole row is the click target, matching the session
  list grammar.
- A match is marked with the accent at 24% behind unchanged `--text`. No second
  accent, no underline; the mark is the only colour in the row.
- Metadata stays quiet: title at 14px/600, provider and role at 11px muted,
  time at 10px mono with tabular figures, snippet at 14px with the 1.5 UI line
  height.
- The scope control reuses the filter chip row and sits above Provider, so the
  three filter groups keep source order when they wrap.

## Notification focus (2026-11-15)

- A notification deep link scrolls the matching inline attention card into
  view and outlines it with the existing 2px accent. The card is not moved into
  a sheet or a new surface; it keeps the inline grammar and stays the action
  target.
- The outline is transient only in the sense that it follows the query param.
  It does not replace the card's blocking or focused states.

## Notification settings (2026-11-15)

- Routing uses the existing form grid: one full-width select per attention
  type, a digest window, and quiet-hours time fields. Selects never clip at
  320px.
- Device rows are one line at desktop and stack at 760px and below. Revoke is
  secondary; enable is the only primary action in the panel.
- The permission state is a metadata badge (`ALLOWED`, `NOT ASKED`, `BLOCKED`),
  not a status dot. It never borrows a provider hue.

## Offline and queued sends (2026-11-15)

- The queued count is a quiet topbar chip: text color, strong border, no amber.
  It must not compete with the attention marker.
- The offline line and the composer offline note are 11px muted text, not
  alerts. They state what will happen; they do not block the composer.
- A queued row keeps the normal user-message anatomy and adds one muted status
  line with Discard. It uses no new color or icon.

## Automation (2026-11-15)

- Run decisions use the existing pill geometry and semantic colors: acted
  success, escalated warning, failed danger, dry run and skipped neutral. No
  provider hue is used for policy state.
- The panel reuses the device-list row, the form-action cluster, and the 44px
  mobile targets. Watchers and approvals stack below 760px.

## Automation approvals in the Inbox (2026-11-15)

- Automation approvals reuse the Inbox group header and approval card. The
  detail line carries `watcherID · reason`; Approve is primary, Deny is danger,
  and both use the existing 44px mobile target.
- The card is not a new attention type visually; it reads as an approval and
  counts toward the same Inbox badge.

## Always-allow shapes (2026-11-15)

- **Always allow** is a quiet secondary action on an approval, not a third
  primary. Selecting it replaces the row with `Confirm always` and `Cancel`;
  the standing permission never lands on the first click.
- Remembered shapes use the same automation list row: selected label as the
  name, watcher/kind/uses/options as the meta line, Revoke as the only action.


## Transcript scroll affordances (2026-11-15)

The jump lived in a composer status row gated by `!atBottom`, so crossing the
80px threshold mounted a ~52px row and moved the composer. `jumpToLatest` also
set `atBottom(true)` before the smooth scroll, removing the row mid-animation.
The transcript hard-cut at its top and bottom with no overflow cue.

- **Frame split.** `.chat-transcript` now owns the border, radius, background,
  and shadow; `.chat-panel` is the scroll container and owns the mask. Masking
  the panel directly would also fade its 1px frame and rounded corners. The
  message DOM is unchanged; the wrapper is the minimum needed to keep the frame
  and anchor an absolutely positioned jump.
- **Mask.** A 24px `mask-image` gradient at an overflowing edge, 0 at the true
  ends. The length uses registered `<length>` properties so it eases over
  180ms. Scroll and resize updates are rAF-coalesced; the mask never changes
  layout. The panel frame stays crisp.
- **Floating jump.** 32px desktop / 44px mobile, bottom-right, 16px/12px inset.
  Opacity plus an 8px translate, with pointer events, tabIndex, and
  `aria-hidden` paired. It hides at a 2px true-bottom check, not the 80px
  autoscroll threshold, and remains visible while the smooth scroll finishes.
- **Background row.** Live shells and subagents are content: one quiet pill at
  the end of the transcript, after messages and attention cards. It opens
  Details, scrolls with the transcript, and removes the composer status row
  entirely. The queue tray stays in flow because it is user content.
- **Proof.** On the live session the composer top stayed at 804px at top,
  middle, and bottom; the jump went from opacity 1 to 0; the mask went from
  24/24 to 24/0 to 0/24. On the fake session with a live background shell, the
  `1 shell running` row was inside `.chat-panel`, and the composer did not move.
- **Files.** `apps/web/src/app/App.tsx`, `apps/web/src/styles.css`,
  `docs/prototypes/scroll-fade.html`, `docs/ui-ia.md`,
  `docs/interaction-contract.md`.

## Audit batch one: targets and measure (2026-11-15)

The typography and iconography audits found functional overlap in the mobile
composer and a lost reading measure. This pass fixes the first, highest-impact
group.

- **Hit areas.** The `⋯`, Stop, and Send cluster used 32px visuals with `-6px`
  pseudo targets and 4px gaps, so adjacent boxes overlapped by 8px. A tap on the
  right edge of `⋯` could hit Stop; the right edge of Stop could hit Send. The
  cluster is now three actual 44×44 controls with no expansion. Measured at
  320/390/421px: all three are 44×44 and their right/left edges do not cross.
- **Chip.** The context chip is 64px at 360px and below and 96px above. The
  visible label is the agent, or `Model` when no agent is set; the full pair
  stays in the accessible name and the sheet. This removes the `Deep…` model
  fallback.
- **Attach.** Inline above 420px, in `⋯` while running at 361–420px, and in `⋯`
  at all states at 360px and below. The 390 and 320 running rows measure 292px
  and 268px of content, inside their 342px and 296px bars.
- **Jump name.** The button no longer has an `aria-label` that contradicts the
  visible `Input needed` state; the visible text is the accessible name.
- **Targets.** Suggestion Dismiss and queue Remove are 32px desktop and 44px
  mobile, not 20×28 and 16×28.
- **Reading column.** Transcript children are capped at 728px inside the
  panel. The 920px panel frame remains; the right gutter holds the floating
  jump. A constant 48px bottom inset keeps the jump off the last line on
  narrower panels.
- **Details values.** `.detail strong` is 500 with tabular figures. Created,
  Updated, Cost, and Tokens are sans; references and endpoints remain mono.
  `font-synthesis: none` prevents Plex Mono faux bold.
- **Mobile inputs.** Question fields and the custom answer input join the 16px
  mobile text rule.
- **Rendering.** `font-synthesis: none` and `text-size-adjust: 100%` are set on
  the root.
- **Proof.** Details values measured: Created Inter 500, Session reference Plex
  Mono 500, Agent Inter 500. The scroll e2e test asserts the 728px measure, the
  visible-text jump name, the mask classes, and the fixed composer. The new
  composer e2e test asserts three 44px controls with no overlap.
- **Files.** `apps/web/src/app/App.tsx`, `apps/web/src/styles.css`,
  `packages/ui/src/base.css`, `tests/e2e/chat.e2e.ts`, `docs/ui-ia.md`,
  `docs/design-lock.md`.

## Audit batch two: icon grid and type roles (2026-11-15)

The iconography and typography audits found that a few controls still drew
their own glyphs or SVG and that 10/11/12px roles had drifted. This pass
consolidates both.

- **One icon grid.** `arrow-up`, `arrow-down`, and `ellipsis` were added to
  `Icon.tsx`. The composer Send arrow, the jump-pill arrow, the composer `⋯`,
  suggestion Dismiss, queue Remove, and the session disclosure now use the
  shared 1.7px-stroke set. The old Send SVG was a 16px viewBox with a 1.8px
  stroke; it was the only control off the grid.
- **Send and jump.** Send renders the same 16px arrow at all widths. The jump
  pill keeps `Input needed` / `Jump to latest` as its visible, accessible name
  and appends a 14px down arrow.
- **Size roles.** `.btn.small` is 12px. The second `.form-note` rule no longer
  drops notes to 11px. Question option descriptions are 12px. Background shell
  run titles are 12px and their status pills 11px. Message role times are 11px
  while the uppercase role label stays 10px. Markdown headings cap at 16/14px,
  so a document heading no longer matches the 20px page title.
- **Search.** The search input is 14px on desktop and 16px on mobile; it was
  18px on both.
- **Labels.** Detail and section labels moved from `faint` to `muted`; faint is
  now reserved for timestamps and hints. The uppercase tracking scale collapses
  to 0.06em and 0.08em.
- **Session state.** Rows render one status dot. The optional status pill was a
  second encoding of the same state and was removed; the accessible name still
  includes the status word.
- **Provider identity.** The Providers screen tints the 30px mark with the
  existing `--opencode` and `--openwebui` accents. Session lists and inbox cards
  stay neutral, which is what the contract already specified but did not
  implement.
- **Navigation.** Rail labels ellipsize inside the 64px rail; `Overview`
  previously overflowed its 42px content box. The active rail mark uses the
  accent, matching the bottom navigation. The attention badge is clamped to
  30px and moved in 2px so a three-digit count stays inside the rail item. In
  chat the theme toggle hides at 420px and below, giving the 320px title more
  room. Theme buttons now name the outcome, not the mechanism.
- **Panel heads.** New session and the provider form use the shared close icon
  with `Close new session` / `Close provider form`, matching details, preview,
  the context sheet, and activity steps.
- **Proof.** Typecheck, 721 unit tests, and 46 e2e tests pass. The composer e2e
  test now asserts SVG Send/More, no text in `⋯`, and the hidden chat theme
  toggle at 390px. Screenshots were reviewed at 1440, 390, and 320px in both
  dark and light themes.
- **Follow-ups.** The page-level balance questions remain: unused right field on
  list pages, Inbox row width, the duplicated chat title, and the 728px measure
  when details is open.

## Layout revision: use the wide field (2026-11-15)

The remaining audit findings were page-level: list pages stopped at 1120px,
leaving about 280px unused at 1440px; the chat repeated the title in the
transcript; and the 728px measure still produced about 104 characters per line.
This pass spends the space on the content already on the page.

- **Content field.** `.page` is `min(1320px, 100%)`. The 24px gutter is
  unchanged and the field stays left-aligned.
- **Sessions table.** At 1100px and above the page row is a five-column grid:
  dot, title, provider, project and agent, time. At 1440px the provider column
  starts at 729px and time sits at the far right, so the row reads as a table
  instead of a title followed by a wide empty field. The 300px chat sidebar
  keeps the stacked layout because its rows are too narrow for columns.
- **Inbox.** At 1200px and above groups are two-column grids with
  `align-items: start`. A blocking card is half-width, like any other card, and
  keeps priority through order and the amber edge. This avoids 1272px-wide
  question forms and roughly halves the page length.
- **Providers.** At 1100px and above the provider list and diagnostics sit side
  by side (1.45fr / 1fr). Diagnostics reflows to two columns in its 512px panel.
- **Search.** At 1100px and above the input, provider filter, and status filter
  share one wrapping toolbar. The input caps at 640px instead of spanning the
  whole page.
- **One title.** The transcript's 20px `h2` was removed. The topbar `h1` is the
  only page title, satisfying the design contract. The transcript now opens
  with a 11px context strip (project, agent, model, status) and a subtle rule.
- **Measure.** The transcript and composer cap at 672px, so the about-640px
  reading column fills the panel instead of leaving an 88px strip inside it.
  Measured on the fixture transcript: 640px at 14px Inter is about 88
  characters, down from about 104.
- **Proof.** The chat e2e asserts the 640px measure and keeps one `h1` in the
  view; the fork test now reads the topbar title. Screenshots were reviewed at
  1440, 1024, 390, and 320px in the dark theme, and the earlier icon and type
  checks still hold. No horizontal overflow at 320px; the page scroller and
  every session row report `scrollWidth === clientWidth`.
- **Not changed.** Routes, navigation order, the mobile bottom bar, the composer
  controls, the details panel breakpoints, and the type scale.


## Mobile collision audit (2026-11-15)

A 390/320px pass found two headers where a side action competed with wrapping
content, plus one tight row rhythm.

- **Session scope.** The `All`/`Root`/`Subagents` group was inline without a
  flex container. On mobile it wrapped into two rows beside the summary, and the
  summary's `newest first` text sat under the chips. The head now stacks at
  760px and below and the chips form one 32px row at 390px. The new e2e test
  asserts the scope top is below the summary and all chip tops match.
- **Inbox toolbar.** At 420px and below the chips occupy the full width and
  Refresh moves to its own row. At 390px the chips take two rows and Refresh one;
  at 320px the chips take two rows and Refresh one. Nothing overlaps.
- **Providers head.** The provider description no longer shares a row with
  `+ Add` and `Recheck` on mobile; the actions move below the copy.
- **Session rows.** A parent row's title, `N subagents`, and provider/project
  lines were separated by 2px. They now use the 4px space step, so a three-line
  parent row reads as a stack rather than a block.
- **Kept as designed.** Search status chips still wrap under their label below
  420px, per the filter rule. The 44px topbar theme button keeps its 44px target
  inside the 52px bar. The details sheet keeps its pinned footer and 12px bottom
  breathing room.
## Accessibility pass: headings, filters, and modal focus (2026-11-15)

A semantics-only pass. Routes, hierarchy, copy, spacing, color, and focus rings
are unchanged; the fixes are ARIA state, element choice, and focus handling.

- **One `h1` per view.** The transcript rendered Markdown without the heading
  offset, so a message that started with `#` produced a second `h1` beside the
  topbar title. Message prose, reasoning, and subagent task text now shift
  headings down one level, matching the compaction summary, file card, and file
  preview. The visible sizes are unchanged.
- **Inbox filters.** The five Inbox chips were the only filter group without
  `aria-pressed`; search, session scope, delivery, and dictation already had it.
  The active chip now exposes its pressed state and the count joins the
  accessible name (`Approvals, 2 items`) instead of being visual text only.
- **Details overlay.** Below 1320px the panel now exposes `role="dialog"` and
  `aria-modal="true"`; above 1320px it remains a labelled column. Escape closes
  the overlay and remains a shortcut for the desktop column. Focus returns to
  the details toggle, and only when the opener is still connected.
- **Tab trapping.** Details, the model/agent sheet, and the file preview share
  one Tab loop. If focus has escaped a sheet, the next Tab re-enters it instead
  of walking the page behind the scrim. The file preview stops its Escape from
  also closing the details panel behind it.
- **Hidden jump pill.** The pill keeps `aria-hidden`, `tabIndex=-1`, and now
  `inert` while it is hidden, so it cannot be focused programmatically either.
  While visible it has no `aria-hidden`, and its visible text stays its name.
- **Times.** Message, agent-activity, step, attention, and session timestamps use
  `<time>` with the absolute instant in `dateTime`. Relative labels (`2m`) stay
  visible and gain the exact time on hover.
- **Group names and names.** Label-only containers (`Needs your input`, the
  response branch picker) gained `role="group"` so their labels are exposed.
  Per-row settings actions now name their row (`Revoke Laptop`, `Approve <title>`,
  `Save voice transcription`), and required provider, session, and question
  fields expose `aria-required`. The disabled Answer button points at the
  missing-field hint.
- **Proof.** New `tests/e2e/accessibility.e2e.ts`: one `h1` per view with a
  Markdown heading in a mocked message, Inbox `aria-pressed` and count names,
  details/context sheet Tab traps and focus restore, a scan for unnamed
  icon-only controls across list, chat, and details, and the hidden pill's tab
  order. Typecheck, 721 unit tests, and all e2e tests pass.
- **Files.** `apps/web/src/app/App.tsx`, `SessionRow.tsx`, `SessionTree.tsx`,
  `settings-notifications.tsx`, `settings-automation.tsx`,
  `tests/e2e/accessibility.e2e.ts`, `docs/ui-ia.md`.
- **Follow-up.** The login QR overlay still needed a Tab trap, Escape close,
  and focus return, and the inline provider and new-session panels needed
  focus-on-open. Both are closed in the pass below.

## Accessibility follow-up: QR overlay, inline panels, and the Inbox live region (2026-11-15)

Semantics and focus only. No visual, copy, or layout change.

- **Login QR overlay.** The overlay is a modal dialog with one focusable
  control. Focus moves to Cancel when it opens, Tab and Shift+Tab loop inside
  the overlay, Escape or Cancel closes it, and focus returns to `Scan pairing
  QR` only while that button is still connected. Closing aborts the scanner,
  which stops the camera tracks.
- **Inline panels.** The provider form and the new-session panel are not modal,
  so they do not trap Tab. On mount they focus their first enabled field (the
  heading when no field exists); on unmount they return focus to the opener,
  captured from `document.activeElement` at mount. The focus is queued in a
  microtask so it lands after the app's push-navigation page-title focus instead
  of racing it, and a re-render never moves focus.
- **Inbox live region.** A polite `.sr-only` status region announces a newly
  arriving blocking attention item or automation approval as `New blocking
  request: <title>`. The first successful load establishes a silent baseline;
  later polls and refreshes announce only unseen IDs, and non-blocking items are
  never announced.
- **Proof.** `tests/e2e/accessibility.e2e.ts` adds four tests: a stubbed
  BarcodeDetector/getUserMedia login session covering focus, the Tab loop,
  Escape, opener restore, and the camera stop; provider-form and new-session
  focus and restore; and the live region's silence on the first load and for
  non-blocking arrivals plus its new-blocking announcement. The suite now
  reserves a free hub port instead of assuming `8801` is available. Typecheck,
  721 unit tests, and all e2e tests pass.
- **Files.** `apps/web/src/app/App.tsx`, `tests/e2e/accessibility.e2e.ts`,
  `docs/ui-ia.md`.


## Session rename (2026-11-16)

The details panel gained one capability-gated action rather than a new dialog or
a global page. The title stays the page `h1`; rename edits that title in place.

- The Name section shows the current title at the 12px detail value role.
- `Rename` swaps it for a single-line field and Save/Cancel. Enter submits,
  Escape cancels without closing the details sheet, and a failed save leaves the
  field open with the error.
- The action is hidden when the provider does not expose `rename`. OpenCode uses
  `PATCH /api/session/{id}`; Open WebUI uses the chat update endpoint. Hermes is not wired yet.
- Saving updates the topbar title and the local session cache, so the page title
  and the session row do not disagree.
- No new token, route beyond the PATCH session endpoint, or layout surface.

## Automation templates panel (2026-11-18)

The Settings → Automation surface gained a Templates panel, not a new screen.
It reuses the automation row grammar so the panel reads as part of the same
list of file-configured objects.

- The panel head uses the existing 16px title, 14px muted description, and the
  10px `mode-badge` count. The row name is 14px; the id/provider detail is 11px;
  no new type role.
- **Start** is a `.btn small` at 32px, matching the watcher Pause action on the
  same surface. Mobile keeps the 32px target for consistency with the existing
  row actions rather than raising only the new button; the panel's rows wrap
  under 760px with the existing rule.
- The accessible name includes the template (`Start Nightly review`), so a
  screen reader does not hear a column of identical "Start" buttons.
- The template error is an alert inside the panel; when the hub includes the
  created session ref, the error carries one secondary **Open session** action.
- Reason codes were replaced by one sentence each. The mapping is shared by the
  Inbox approval card and the Settings approvals/runs lists, so the same event
  reads the same way on both surfaces.
- No token, radius, contrast, or motion change. The panel adds no primary action
  and no color.

## Session assistant dock (2026-11-20)

- **Why a right-side panel.** The assistant answers questions *about the
  transcript on screen*. A separate route would hide the evidence it cites, and
  a tab inside the transcript would compete with the composer. A panel keeps
  both visible at wide widths and becomes a full-width surface on a phone,
  where the transcript is too narrow to sit beside anything.
- **Typography.** The header is the page's only in-panel title at 16px. Turn
  text is 14px/1.6, the same reading size as chat prose, because the answer is
  prose the user reads, not a control. Role labels, the scope chip, and the
  usage line are 10px uppercase metadata; the session title under
  `Assistant` is 11px. No half-step sizes were added.
- **Hierarchy.** There is exactly one primary action (Ask, then Stop), one
  quiet close control, and one decorative caret. The suggestion buttons are
  quiet by design: they are a starting point, not three competing actions.
- **Contrast.** Answer text uses `--text` on `--sidebar`, the same pair as the
  transcript. `--muted` is used only for role labels, usage, the session title,
  and the empty-state hint, all of which are non-structural. The `Read-only ·
  no writes` line is deliberately muted: it is a persistent promise, not an
  alert.
- **State is never color-only.** A stopped or failed run says `Stopped` or the
  error text in the turn header; the caret is hidden from assistive technology;
  the log is a polite live region so the answer is announced as it settles.
- **Focus.** Opening the panel moves focus to the composer; Escape closes and
  returns focus to Ask. The textarea has the standard 2px accent outline with a
  1px offset. The close control and the mobile primary action meet the 44px
  target; the desktop composer controls stay 36px, matching the chat composer.
- **Load state.** The composer is disabled until the thread's first GET
  resolves and the placeholder says `Reading this session…`. This closes a
  silent no-op where Enter would be ignored during the initial read.
- **Known follow-ups.**
  - Deltas re-render per token. At the measured ~40–90 output tokens this is
    invisible; a faster model would want batching per animation frame.
  - There is no thread list and no way to start a second thread for a session.
    That is intentional in M1 and becomes a decision in M3.
  - Answers cite evidence in prose but do not link to the message. Message
    anchors belong with the tool loop in M2.
  - The usage line only appears when the endpoint reports usage in the stream
    (llama.cpp does; some providers do not).

## Assistant write confirmations (2026-11-20)

- **The card is the consent surface.** It is deliberately not a modal: the
  answer above it is the justification, and hiding the transcript to ask for
  consent would remove the evidence the user needs to decide. It is also not a
  toast: a pending write must stay until it is decided.
- **One accent edge, one primary action.** The 2px left border carries state
  (accent pending, success done, danger failed, strong border cancelled) and
  the head carries the same state in words. Colour never carries it alone.
- **The message is editable before sending.** A model draft that cannot be
  corrected is a trap; the textarea is the same size and radius as the chat
  composer's box, 14px on desktop and 16px on mobile.
- **Failed proposals stay.** A rejected tool call shows its error in place and
  loses its buttons. That keeps a bad model turn auditable by the person who
  saw it.
- **The composer lock is visible.** Disabling the input without explanation
  reads as a bug; the placeholder names the next action.
- **Known follow-ups.**
  - The audit log records decisions but is not exposed in the UI; a read-only
    Settings view belongs with M3, when global scope makes actions less obvious.
  - A cancelled action remains in the thread forever. That is intentional now;
    a "clear decided actions" affordance can wait for a longer thread.

## Assistant evidence line (2026-11-20)

- The line exists because the context window is invisible. A session assistant
  that answers from eight of forty turns must say eight, or the answer reads as
  complete when it is not.
- It reuses the 10px metadata role and muted colour already used for token
  counts; no new tokens, no border, no control. When nothing was omitted it is
  quiet; when turns were dropped the words `older omitted` carry the warning,
  not a colour.
- It stays one line on desktop and mobile. Numbers use the inherited tabular
  figures from `.assistant-turn-meta`.
- `history Oct 26` names the provider compaction the answer read, placed after
  the session stamp. It carries a date rather than a clock time because a
  compaction is a long-horizon fact; one from today falls back to a bare time,
  the same branch as `session as of`. Without the clause, an answer built on a
  month-old summary reads as current as one that re-read the tail.

## Approval hardening (2026-11-20)

- **Cancel is not a write.** It changes hub state only, so it stays available
  when `allowWrite` is off; otherwise a config change can strand a card that
  blocks the whole thread with no recovery in the UI.
- **A decided card never shows two outcomes.** The head carries the verb, the
  right edge carries the state. `SENT / SENT` was a real defect, not a style
  choice.
- **In-flight is its own state.** `Working…` replaces the buttons while a
  decision executes, so a double tap cannot look like two successes.
- **Audit without content.** The confirmed payload is recorded as a SHA-256 and
  a byte length, with the model id; the message text is not stored.

## Thread time markers (2026-11-20)

- A thread that persists across days needs two facts the UI did not show: when
  a turn was written, and how old the session was when the answer read it.
- Day labels use a hairline rule on both sides so they read as separators, not
  as another message. Times are right-aligned and tabular so a column of turns
  scans without the eye moving.
- `session as of` is deliberately the session's last activity, not the answer
  time: it answers "could this be stale?" in one clause. Same-day sessions show
  a bare time; older ones carry the date.
- No colour is used for age. A stale answer is a fact, not a warning.

## Assistant context blocks (2026-11-20)

- The prompt now separates hub facts (`ASSISTANT`, `SITUATION`, `ATTENTION`,
  `PENDING QUESTION`) from session data (`HISTORY`, `WORK`, `FAILURES`,
  `RECENT ACTIONS`, `TRANSCRIPT`). The headings carry the trust level so the
  model describes untrusted text instead of obeying it.
- `HISTORY` is the newest provider compaction even when it sits outside the
  message window, with its timestamp. It is the only long-horizon memory
  available without a new model call.
- `FAILURES` renders failed shells with exit codes and the tail of their output,
  plus failed tools and message errors. `WORK` lists touched files and commands.
  Both start from the 20-message tail and merge what the wider 200-message page
  saw, so a failure that scrolled out of the window still appears; the tail wins
  ties and the merged lists are deduped and capped.
- The wide history read is bounded at two seconds per page. When it misses the
  deadline the answer proceeds from the cache and the same request finishes in
  the background; a late success refreshes the cache for the next ask instead of
  being discarded.
- The evidence line counts failures so the user can see that the context knew
  about one.

## Permission prompts (2026-11-20)

- A permission prompt is not a Q&A choice. The card refuses to be the approval
  UI: it shows the provider's question, choices, and risk, then points at the
  Inbox, which already renders the command. One quiet link, no primary button.
- Normal questions render their payload too. The chosen choice carries the
  accent border, so the human checks the choice rather than the model's
  sentence.
- The model's summary remains as context but is no longer the only description
  of what will be sent.
- Consequence: the assistant can draft a branch choice but cannot launder a
  destructive approval through a friendly card.

## Expired actions and interrupted runs (2026-11-20)

- Expiry is a correction, not a new control: the card keeps the payload so the
  thread still explains what was proposed, drops the buttons, and says why.
- The interrupted-run turn uses the same error role line as a failed answer.
  There is no retry button because the run no longer exists; the composer is
  the retry.
- Eviction is invisible unless it strands a card, which is why the LRU pass
  skips locked threads even when that leaves the store one or two over the cap.

## Project and global scopes (2026-11-20)

- The scope chip turns into the scope switcher. That is the smallest possible
  entry: one control that already says what the thread is scoped to, no new
  screen, no second dock.
- Global Ask lives in the Overview topbar because global questions are about
  the whole workspace, and Overview is the workspace-level surface. Adding a
  rail destination would have created a place with one button.
- Read-only scopes keep the same footer promise. Their evidence line counts
  session summaries (project) or inbox/running items (global), never turns,
  because no transcript is read.
- 12 sessions is the project cap: enough to answer "what should I pick up",
  short enough to stay under ~1.5k tokens.

## Targeted sends from project and global (2026-11-21)

- A send from a broader scope must name its target twice: once in the card
  (`To: <session>`, 11px muted with the name in text colour) and once in the
  primary action (`Send to "<session>"`). A generic "Send" would hide that the
  message leaves this thread.
- Search hits are labelled as untrusted transcript and carry the session title
  and ref. The target block repeats the title and status so the human can
  confirm the right session.
- The card keeps the same confirm/cancel grammar; nothing new to learn.
- Error copy for a 5xx names the likely cause (loading or GPU busy) because
  that is what actually happens on this host.

## Cross-session search (2026-11-21)

- The evidence line gains `N search hits` only when the context carried any.
  It answers "did the assistant actually look elsewhere?" without opening a
  panel.
- A hit names the session and ref in the answer's prose. The session scope
  cannot read that transcript, so it says the detail is outside the thread
  rather than paraphrasing a snippet as fact.
- Metadata matching is deliberately broad (any term in project, path, model,
  agent); the five-hit cap and the cited snippet keep a false positive
  visible.

## Assistant model and activity (2026-11-21)

- The model chip answers "what is answering me?" without opening Settings. It
  sits in the composer, not the header, because the chat already teaches that
  model choice happens at the point of sending. Per-thread rather than global
  because model choice is a property of the question, not the account; the
  disabled state during a run prevents a misleading mid-flight change. The menu
  names its endpoint so a local-only list is not mistaken for the product's
  full model set.
- The activity block is the chat's component, not a lookalike: same toggle,
  same 4px dot texture, same 49px tiles, same inline detail. A second visual
  grammar inside the dock would make the same information feel like a
  different system.
- `model` is a new tile kind because no existing kind means "the model call".
  It uses the dock accent; tool status still uses success/warning/danger.
- The global assistant is a modal dialog because it is not anchored to a
  session: it is a workspace-wide detour, and the backdrop says so. Session and
  project threads stay docked so the cited transcript remains on screen.
- Scope icons (bot, layers, globe) carry the distinction without another
  colour or a new control.

## Assistant endpoint settings (2026-11-21)

- The panel mirrors Reply assistance and Voice transcription: same form grid,
  same check fields, same masked key, same `form-actions` row. A fourth visual
  grammar for "the endpoint" would be noise.
- `Test connection` reports the model and latency in a single status line; a
  failure uses the danger colour and the same line height, so the form does not
  jump.
- `Load models` writes into a datalist, not a locked select: an endpoint that
  does not implement `/models` still accepts a typed id.
- The dock's `Change endpoint` link is a quiet text action inside the model
  menu, not a new header control.

## Activity order (2026-11-21)

- The activity block moved above the answer. The work precedes the prose; the
  previous order asked the reader to learn what happened after reading the
  conclusion. The live run now shows reads/search before the first token.
- The dock had drifted from the chat: 52px tiles, a green dot on every
  completed step, a separator line, different icons, and a detail strip under
  the grid. Those are corrected to the chat's component values. A second visual
  grammar for the same data was the problem, not the data.
- The remaining differences are structural, not stylistic: the dock is 400px
  wide (fewer tiles per row) and its step detail has no provider-specific
  preview or prev/next navigation, because hub steps carry no message parts.

## One activity renderer (2026-11-21)

- The dock and the chat now share `ActivityTiles`. The previous fix aligned two
  copies by hand; this removes the copy. A visual change to the grid is a
  single-file change again.
- Hub kinds inherit the tool families' muted hues instead of falling back to
  neutral grey. A run reads as read → think → search → model without inventing
  a second palette; saturation still belongs to state.
- The dock's step detail reuses the chat's `activity-step` chrome (status pill,
  title, short value, duration, close) with metric rows in the body. The old
  bespoke detail panel and its `grid-column` rule are gone; the grid is a flex
  wrap, so the panel spans with `flex: 0 0 100%` like the chat's.
- Counts beat durations in the tile: `20 turns` says more than `7ms` at the
  same width. A compacted history reads `compacted` or `none`, not a timestamp
  squeezed into 49px.
- `cancelled` has its own quiet treatment: neutral pill, faint dot. Marking a
  user stop as an error was inaccurate and looked like a fault.
