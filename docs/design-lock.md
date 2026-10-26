# Design Lock — v1

Status: **frozen**.

- Version: `design-v1`
- Date: 2026-10-26
- Git tag: `design-v1`
- Scope: information architecture, visual language, type scale, spacing, responsive behavior, interaction states, and the static prototype.

## What is frozen

The approved design reference is the state tagged `design-v1`:

- [`ui-ia.md`](ui-ia.md) — information architecture, screens, flows, visual language, and responsive rules.
- [`visual-audit.md`](visual-audit.md) — contrast measurements, component rules, design rationale, and known follow-ups.
- [`prototypes/index.html`](prototypes/index.html) — interactive visual reference.
- [`prototypes/styles.css`](prototypes/styles.css) — frozen token and component reference.
- [`AGENTS.md`](../AGENTS.md) — working rules for future UI changes.

The prototype is a visual specification, not production client source. Production UI code lives in `apps/web` once scaffolding begins. Do not import or copy the prototype's DOM/rendering code into the product.

## Change policy

Allowed without a new design version:

- typo and copy corrections that do not change hierarchy or meaning;
- accessibility fixes that do not change the visual system;
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

The frozen reference was reviewed in dark and light themes at 1440, 1024, 390, and 320px, including inbox, sessions, chat, details, providers, settings, search, and the new-session modal.
