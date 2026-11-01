#!/usr/bin/env bash
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
background="${G2_SCREENSHOT_BACKGROUND:-$app_root/docs/g2-background.png}"

usage() {
  cat >&2 <<'EOF'
Usage:
  frame-screenshot.sh <raw-576x288.png> <output.png>

The raw capture is the simulator framebuffer (576x288, transparent). The output
is an opaque 1280x720 README image with the screen scaled 2x and framed on the
G2 presentation background.

Environment:
  G2_SCREENSHOT_BACKGROUND  Override the background PNG.
EOF
  exit 2
}

if [[ $# -ne 2 ]]; then
  usage
fi

input="$1"
output="$2"

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick 7 (magick) is required." >&2
  exit 1
fi
if [[ ! -f "$input" ]]; then
  echo "Missing input capture: $input" >&2
  exit 1
fi
if [[ ! -f "$background" ]]; then
  echo "Missing background: $background" >&2
  exit 1
fi

dimensions="$(magick identify -format '%w %h' "$input")"
read -r width height <<< "$dimensions"
if [[ "$width" != "576" || "$height" != "288" ]]; then
  echo "Expected a 576x288 G2 framebuffer capture, got ${width}x${height}." >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"

# The G2 waveguide is transparent; the UI has no black display background.
# Defocus the single presentation backdrop to simulate the wearer focusing on
# the HUD, then overlay the 2x framebuffer directly. Never blur the UI.
# The nearest-neighbor resize keeps the pixel font crisp.
magick "$background" -blur 0x8 \
  \( "$input" -filter point -resize 200% \) \
  -geometry +64+72 -compose over -composite \
  -flatten -alpha off -strip "$output"

echo "Wrote $output ($(magick identify -format '%wx%h' "$output"), opaque)"
