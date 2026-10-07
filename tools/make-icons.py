#!/usr/bin/env python3
"""Render apple-touch-icon.png from the same design as favicon.svg.

    python tools/make-icons.py

Writes, next to favicon.svg:

    apple-touch-icon.png   180x180, full-bleed

Why the raster exists: iOS ignores SVG favicons, so without this file the
home-screen icon is a screenshot of the page. It is full-bleed rather than
rounded because iOS applies its own mask — pre-rounding it would show a rounded
square sitting inside iOS's rounded mask.

The design is favicon.svg's: a #0e0e11 tile with the "01" index numeral in
white, centred on the 32-unit grid the SVG is drawn on. favicon.svg is the
source of truth; keep these numbers in step with it if the mark changes.

Byte-reproducible only where the same monospace face is installed: the numeral
is text, so a machine without the first candidate renders a metrically similar
but not identical "01". The tile, its colour and the numeral's size and position
come out the same everywhere.

Needs Pillow (`pip install pillow`).
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "apple-touch-icon.png")

BG = (14, 14, 17)          # #0e0e11, the tile
FG = (255, 255, 255)       # the numeral

# favicon.svg is drawn on a 32-unit grid; the raster is 180px, so one unit is
# 5.625px. These are the SVG's own numbers.
VIEWBOX = 32
SIZE = 180
TEXT_X = 16
BASELINE = 21.5
FONT_SIZE = 13

# The numeral sits one pixel above 21.5 units on the shipped raster; the SVG's
# baseline lands between pixels and this is the side of it that renders on the
# grid. Change it only together with favicon.svg.
BASELINE_NUDGE = -1

FONT_CANDIDATES = [
    "C:/Windows/Fonts/consola.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFNSMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
]


def find_font() -> str:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return path
    sys.exit(
        "No monospace face found. Add its path to FONT_CANDIDATES in "
        "tools/make-icons.py, then re-run."
    )


def main() -> None:
    unit = SIZE / VIEWBOX
    img = Image.new("RGBA", (SIZE, SIZE), BG + (255,))
    font = ImageFont.truetype(find_font(), round(FONT_SIZE * unit))
    ImageDraw.Draw(img).text(
        (TEXT_X * unit, BASELINE * unit + BASELINE_NUDGE),
        "01",
        font=font,
        fill=FG + (255,),
        anchor="ms",          # centred on the SVG's text-anchor="middle"
    )
    # RGB rather than RGBA: the tile is full-bleed and therefore completely
    # opaque, so an alpha channel would be dead weight. Saved with Pillow's
    # defaults (compress_level=6, no optimize) because that is the encoder
    # path the shipped rasters came from - with optimize=True the pixels are
    # identical but the file bytes are not, which would make every future run
    # of this generator show up as a binary change.
    img.convert("RGB").save(OUT, "PNG")
    print(f"wrote apple-touch-icon.png ({SIZE}x{SIZE}, {os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
