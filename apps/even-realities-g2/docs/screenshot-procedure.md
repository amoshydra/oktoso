# G2 Screenshot Procedure

Use this procedure for every G2 screenshot added to the README or documentation.

## Standard output

| Property | Value |
|---|---|
| Final size | `1280x720` |
| Color | Opaque sRGB, no alpha |
| Screen | Raw framebuffer scaled 2x: `1152x576` at `+64+72`, no synthetic panel |
| Raw capture | `576x288` RGBA framebuffer |
| Background | `docs/g2-background.png`, single fixed scene |
| Background focus | Gaussian blur `0x8` applied by the framing script only |
| Final files | `docs/glass-inbox.png`, `docs/glass-answer.png`, `docs/glass-symbols.png` |
| Raw files | `docs/captures/inbox.png`, `answer.png`, `symbols.png` |

Never commit a transparent framebuffer directly to the README. Transparent green
content disappears in GitHub light mode. Every README image must be flattened
onto the opaque background.

## 1. Capture from fixture data

Use the fake provider fixture or a temporary hub config. Do not capture a real
account, real session titles, real provider URLs with credentials, or real message
content.

```sh
pnpm dev
pnpm dev:even-g2
pnpm simulate:even-g2
```

Drive the simulator through its automation API so the capture is repeatable:

```sh
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"action":"click"}' http://127.0.0.1:9898/api/input
```

Capture the framebuffer:

```sh
curl -sS http://127.0.0.1:9898/api/screenshot/glasses \
  -o docs/captures/inbox.png
```

Use the corresponding action sequence for each screen:

```text
inbox.png    Home -> Inbox
answer.png   Recent -> session with a question -> tap chat
symbols.png  Home -> Symbols
```

Check the raw capture is `576x288` before framing:

```sh
magick identify docs/captures/inbox.png
```

## 2. Frame the capture

The committed script handles the 2x nearest-neighbor scale, dark screen panel,
rim, and alpha flattening:

```sh
pnpm --filter @amoshydra/oktoso-even-g2 frame:screenshots
```

For one image:

```sh
pnpm --filter @amoshydra/oktoso-even-g2 frame:screenshot \
  docs/captures/inbox.png docs/glass-inbox.png
```

The script requires ImageMagick 7 (`magick`).

Composite geometry:

```text
background       1280x720
screen image     1152x576 at +64+72
screen scale     200% nearest neighbor
```

The nearest-neighbor scale keeps the G2 pixel font crisp. Do not use a smooth
resize for the screen content. Blur only the background; never blur the
framebuffer or the UI.

The G2 waveguide is transparent: the real display has no black background. Do
not draw a black screen rectangle, device bezel, or synthetic panel around the
UI. The generated backdrop exists only to keep green content readable in GitHub
light mode; it is not part of the glasses display.

## 3. Verify the output

```sh
magick identify docs/glass-inbox.png
# PNG 1280x720 ... 8-bit sRGB
```

- Open the image against a white and a dark GitHub background.
- Confirm there is no alpha channel.
- Confirm the text is readable at README width.
- Confirm no real data is visible.
- Use the final `docs/glass-*.png` in the README, never `docs/captures/*.png`.

## Checklist

- [ ] Raw captures are from the fake fixture.
- [ ] Raw captures are `576x288`.
- [ ] Final images are `1280x720`, opaque, and flattened.
- [ ] The screen uses the 2x nearest-neighbor scale.
- [ ] The single background uses the `0x8` focus blur; the UI is sharp.
- [ ] The README uses only `docs/glass-*.png`.
- [ ] Light and dark rendering were reviewed.
- [ ] `pnpm --filter @amoshydra/oktoso-even-g2 frame:screenshots` regenerates the
      committed images from the committed raw captures.
