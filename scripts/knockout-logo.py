#!/usr/bin/env python3
"""Knock out the solid purple field of logo-nenasas.jpg into a transparent PNG."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IN = ROOT / "public" / "logo-nenasas.jpg"
DEFAULT_OUT = ROOT / "public" / "logo-nenasas.png"


def sample_key(rgb: Image.Image) -> tuple[float, float, float]:
    px = rgb.load()
    w, h = rgb.size
    pts = [
        (0, 0),
        (w - 1, 0),
        (0, h - 1),
        (w - 1, h - 1),
        (w // 2, 0),
        (0, h // 2),
        (w // 2, h - 1),
        (w - 1, h // 2),
    ]
    rs = gs = bs = 0
    for x, y in pts:
        r, g, b = px[x, y]
        rs += r
        gs += g
        bs += b
    n = len(pts)
    return rs / n, gs / n, bs / n


def knockout(
    src: Path,
    dest: Path,
    inner: float,
    outer: float,
    trim: bool,
    pad: int,
) -> None:
    rgb = Image.open(src).convert("RGB")
    kr, kg, kb = sample_key(rgb)
    pixels = rgb.load()
    w, h = rgb.size
    out = Image.new("RGBA", (w, h))
    dest_px = out.load()
    span = max(outer - inner, 1.0)

    min_x, min_y, max_x, max_y = w, h, 0, 0

    for y in range(h):
        for x in range(w):
            r, g, b = pixels[x, y]
            dist = math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2)
            if dist <= inner:
                dest_px[x, y] = (0, 0, 0, 0)
                continue
            if dist >= outer:
                alpha = 255
                t = 0.0
            else:
                t = 1.0 - (dist - inner) / span
                alpha = int(round(255 * (1.0 - t)))
            # Despill: pull residual purple out of anti-aliased edges.
            r = min(255, max(0, int(round(r - kr * t))))
            g = min(255, max(0, int(round(g - kg * t))))
            b = min(255, max(0, int(round(b - kb * t))))
            # JPEG mixes the black outline with the field → leftover purple.
            # Lime/flame stays; dark purple becomes the outline; leftover field dies.
            lime = g > 140 and g >= r - 30
            purple = (not lime) and b > g + 20 and b > 70
            if purple:
                if max(r, g, b) < 120:
                    r, g, b = 0, 0, 0
                else:
                    dest_px[x, y] = (0, 0, 0, 0)
                    continue
            dest_px[x, y] = (r, g, b, alpha)
            if alpha:
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y

    if trim and max_x >= min_x:
        box = (
            max(min_x - pad, 0),
            max(min_y - pad, 0),
            min(max_x + 1 + pad, w),
            min(max_y + 1 + pad, h),
        )
        out = out.crop(box)

    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    print(f"{src.name} {rgb.size} -> {dest} {out.size}  key=({kr:.0f},{kg:.0f},{kb:.0f})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Make the Nenasas logo PNG with a transparent field.")
    parser.add_argument("--input", type=Path, default=DEFAULT_IN)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--inner", type=float, default=28, help="Distance at which pixels are fully transparent.")
    parser.add_argument("--outer", type=float, default=58, help="Distance at which pixels are fully opaque.")
    parser.add_argument("--no-trim", action="store_true", help="Keep the original canvas.")
    parser.add_argument("--pad", type=int, default=16, help="Transparent padding around the trimmed artwork.")
    args = parser.parse_args()
    knockout(args.input, args.output, args.inner, args.outer, trim=not args.no_trim, pad=args.pad)


if __name__ == "__main__":
    main()
