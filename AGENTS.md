# Oktoso — Agent Instructions

## UI work starts here

Any change that affects UI, layout, styling, copy, responsive behavior, accessibility, design tokens, or the prototype must first read:

1. [`docs/design-lock.md`](docs/design-lock.md) — the approved `design-v1.1` freeze and change policy.
2. [`docs/ui-ia.md`](docs/ui-ia.md) — the source of truth for information architecture, screens, flows, visual language, type scale, spacing, and responsive behavior.
3. [`docs/visual-audit.md`](docs/visual-audit.md) — the design rationale, contrast measurements, component rules, and known follow-ups.

Brand assets and their usage rules live in [`docs/brand/README.md`](docs/brand/README.md).

If implementation and documentation disagree, treat the documentation as the design intent and update both in the same change.

Do not change the IA, routes, screen structure, or interaction model unless the user explicitly asks. Visual refinement is not permission to redesign the product.

## Protect the hierarchy

The current hierarchy is deliberate:

- The topbar owns the page title and renders it as the page `h1`.
- Do not add a second page heading in the content area.
- Page content aligns to the topbar. Do not reintroduce a centered content column per page.
- Inbox card titles are 16px. Session titles and body copy are 14px. Metadata is 11px. Badges and section labels are 10px.
- Keep one primary action per surface. Secondary actions stay quiet.
- Cards are structural. Controls are interactive. Do not turn every label, status, or piece of metadata into another bordered box.
- Preserve the active-state grammar: raised surface, strong border, and the 2px accent inset.

## Design contract

### Type

Six roles only:

| Token | Size | Role |
|---|---:|---|
| `--text-2xs` | 10px | Badges, counts, uppercase section labels |
| `--text-xs` | 11px | Timestamps, provider badges, status pills, filter chips |
| `--text-sm` | 12px | Buttons, detail values, compact controls |
| `--text-base` | 14px | Body, chat prose, session titles |
| `--text-lg` | 16px | Topbar/page titles, inbox card titles |
| `--text-xl` | 20px | Chat document title |

- Sans: Inter Variable. Mono: IBM Plex Mono. Do not add a third family.
- Weights: 400, 500, 600, 700 only.
- Chat prose line height: 1.6. UI copy: 1.5. Titles: 1.3.
- Use tabular figures for times, costs, and token counts.
- Do not add half-step font sizes.

### Spacing and shape

- Spacing scale: 4, 8, 12, 16, 24, 32px. Optical 2px exceptions are allowed for rails and count badges.
- Radii: 4px badges, 8px controls, 12px cards, 16px sheets, 999px pills.
- Do not introduce a new token for one component. Reuse or extend the scale first.

### Color and state

- Color is for state and action, not decoration.
- Provider identity in session lists and inbox cards is neutral. Provider accents appear only on the Providers screen.
- Unread is title weight, never another colored dot.
- One session status dot. One amber attention marker.
- Status colors are semantic: success, warning, danger. Never use a provider hue to imply state.
- Primary accent text uses `--on-accent`, not a hard-coded black or white.

### Contrast and accessibility

- Text contrast floor: 4.5:1. Controls and focus indicators: 3:1.
- Faint text is for timestamps and hints, not structural labels.
- Every view has exactly one `h1`.
- Use a single 2px accent focus outline. Inputs use a 1px offset; the composer owns the focus ring for its textarea.
- Status, unread, and attention states must have screen-reader text, not color alone.
- Primary actions and icon-only controls use 44px targets on mobile. Filter chips use at least 32px.
- Text inputs and textareas are 16px on mobile to avoid browser zoom.
- Modal bodies scroll; modal footers stay pinned.

### Responsive behavior

- `1320px` and below: details is a right-side overlay. Above `1320px`: details is a column.
- `1100px` and below: sidebar narrows to 300px and the sessions table drops the project column.
- `760px` and below: mobile layout with bottom navigation.
- `480px` and below: hide provider machine names; keep the provider name.
- `420px` and below: filters wrap instead of clipping or hiding chips.
- `360px` and below: hide the secondary external action in the chat topbar; the details sheet exposes it.

## Prototype

The prototype is static and uses mock data.

```sh
npm run prototype
```

It serves `docs/prototypes` at `http://<host>:4174/`.

Before calling UI work complete:

- Review dark and light themes.
- Review 1440px, 1024px, 390px, and 320px widths.
- Check inbox, sessions, chat, details, providers, settings, search, and the new-session modal.
- Confirm no horizontal overflow at narrow widths.
- Check the browser console for errors.
- Run `pnpm brand:check`; if it reports changed sources, run `pnpm brand:screens` and commit the images and manifest.
- Update `docs/ui-ia.md` and `docs/visual-audit.md` when the system changes.
- Keep the prototype and the written design contract in sync.

## G2 screenshots

Follow [`apps/even-realities-g2/docs/screenshot-procedure.md`](apps/even-realities-g2/docs/screenshot-procedure.md).

- Capture raw frames at 576x288 from fixture data only.
- Keep raw captures in `apps/even-realities-g2/docs/captures/`.
- Commit opaque 1280x720 README images, never transparent framebuffer PNGs.
- Do not draw a black screen panel or bezel; the G2 waveguide is transparent.
- Use one fixed background for every G2 screenshot, with `0x8` background blur and a sharp UI.
- Regenerate with `pnpm --filter @amoshydra/oktoso-even-g2 frame:screenshots`.
- Review the final images in both GitHub light and dark mode.

## Implementation work

Before adding packages, routes, provider code, storage, or client data layers, read:

- [`docs/design.md`](docs/design.md) for the architecture and provider model.
- [`docs/plan.md`](docs/plan.md) for milestones and acceptance criteria.
- [`docs/code-structure.md`](docs/code-structure.md) for the repository layout, module boundaries, API additions, and task order.

Keep the dependency rules and vertical-slice order from the code structure document. Do not build all three provider adapters before the OpenCode web slice works.

## Product constraints

- The hub is the product; clients are thin and replaceable.
- Provider APIs are the source of truth.
- No ACP requirement and no local agent processes on the hub.
- No networking, tunnel, TLS, or discovery logic in the hub. The operator owns reachability.
- Run on Node 24+, including Termux. Prefer pure JavaScript dependencies and no native modules.
