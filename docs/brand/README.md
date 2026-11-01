# Oktoso brand

The mark is an octagonal hub with a single node at its center: eight sides for
Oktoso, one place for every session. It is drawn as a flat accent tile so it
survives a 16px favicon and a 512px app icon without a second version.

## Color

| Role | Value |
|---|---|
| Tile | `--accent` (`#a9bdff` dark, `#3550c8` light) |
| Glyph | `--on-accent` (`#07080b` dark, `#ffffff` light) |
| Banner canvas | `#0b0d11` |

The app uses the theme tokens so the mark follows the product's dark and light
themes. The favicon, app icon, and banner are fixed dark-theme artwork.

## Geometry

- 512 × 512 canvas.
- Tile radius: 116 (22.7%), close to the platform app-icon mask.
- Octagon: regular, point-up, circumradius 160, 44 stroke, round joins.
- Node: 44 radius, centered.
- Keep the mark inside a 410px diameter safe circle for maskable icons.

Small raster favicons use `oktoso-mark-small.svg`, which thickens the stroke and
node for 16px and 32px. Do not use the small geometry for the app icon.

## Files

| File | Use |
|---|---|
| `oktoso-mark.svg` | Standard rounded tile; in-app mark and PWA app icon |
| `oktoso-mark-small.svg` | 16–32px favicon raster source |
| `oktoso-mark-square.svg` | Full-bleed square; Apple touch and maskable icons |
| `oktoso-mark-mono.svg` | Single-color glyph for stamps and dark/light one-color use |
| `banner.png` | README hero, 1600 × 560 |
| `banner.html` | Banner source; renders with the prototype fonts and a 1440 × 900 screenshot |

Web assets live in `apps/web/public/`: `favicon.ico`, `favicon.svg`,
`favicon-16.png`, `favicon-32.png`, `favicon-48.png`, `apple-touch-icon.png`,
`icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`, and
`site.webmanifest`. For the GitHub repository avatar, upload
`apps/web/public/icon-512.png`; GitHub applies its own circular mask.

## Regenerate

Raster icons need `rsvg-convert` and ImageMagick:

```sh
rsvg-convert -w 16 -h 16 docs/brand/oktoso-mark-small.svg -o /tmp/favicon-16.png
rsvg-convert -w 32 -h 32 docs/brand/oktoso-mark-small.svg -o /tmp/favicon-32.png
rsvg-convert -w 48 -h 48 docs/brand/oktoso-mark.svg -o /tmp/favicon-48.png
magick /tmp/favicon-16.png /tmp/favicon-32.png /tmp/favicon-48.png apps/web/public/favicon.ico
rsvg-convert -w 180 -h 180 docs/brand/oktoso-mark-square.svg -o apps/web/public/apple-touch-icon.png
rsvg-convert -w 192 -h 192 docs/brand/oktoso-mark.svg -o apps/web/public/icon-192.png
rsvg-convert -w 512 -h 512 docs/brand/oktoso-mark.svg -o apps/web/public/icon-512.png
rsvg-convert -w 192 -h 192 docs/brand/oktoso-mark-square.svg -o apps/web/public/maskable-192.png
rsvg-convert -w 512 -h 512 docs/brand/oktoso-mark-square.svg -o apps/web/public/maskable-512.png
```

The banner is a static HTML composition. Open `docs/brand/banner.html` in a
browser at 1600 × 560 and capture at 2×; the committed `banner.png` is that
capture downsampled to 1600 × 560. The screenshot inside it comes from the
prototype with mock data:

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory docs/prototypes
```

Refresh `docs/screenshots/inbox.png` (1440 × 900) and
`docs/screenshots/session.png` (1440 × 1100) from the prototype before
regenerating the banner. The session capture is the **Fix auth race in gateway**
session with the transcript scrolled to the top.
