# Visual Design Audit

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
- **Focus:** 2px accent outline, 2px offset.

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

## Files changed

- `docs/prototypes/styles.css`: tokens, surfaces, borders, controls, attention cards, chat, details, providers, settings, mobile nav.
- `docs/ui-ia.md`: visual tokens and component rules updated to match the audit.
- `docs/visual-audit.md`: this audit and the before/after measurements.
- `README.md`: link to the audit.
