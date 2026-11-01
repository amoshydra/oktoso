# Visual Design Audit

> Status: frozen in [`design-v1`](design-lock.md) on 2026-10-26. Session transcript revision `design-v1.1` applied 2026-10-27.

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
- The session title, back action, and interrupt control stay in a sticky transcript header.

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

## Files changed

- `docs/prototypes/styles.css`: tokens, surfaces, borders, controls, attention cards, chat, details, providers, settings, mobile nav.
- `docs/ui-ia.md`: visual tokens, type scale, spacing, responsive rules, and provider/state semantics updated.
- `docs/prototypes/app.js`: neutral provider labels, unread-by-weight, single page headings, pinned modal form, and screen-reader state labels.
- `docs/visual-audit.md`: this audit and the before/after measurements.
- `docs/brand/`, `apps/web/public/`, `docs/screenshots/`: brand mark, favicons, app icons, banner, and README imagery.
- `README.md`: link to the audit and the brand banner/screenshot.
