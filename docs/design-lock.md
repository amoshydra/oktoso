# Design Lock — v1.3

Status: **frozen**.

- Version: `design-v1.3`
- Parent: `design-v1.2`
- Date: 2026-11-02
- Git tag: `design-v1.3`
- Scope: information architecture, visual language, type scale, spacing, responsive behavior, interaction states, and the static prototype.
- v1.1 scope: session transcript loading, scroll anchoring, Markdown rendering, and collapsed agent activity.
- v1.2 scope: the transcript copy action and hub-backed composer dictation.
- v1.3 scope: composer attachments, Open WebUI in-chat branch switching and retry, and OpenCode session forks.

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
