#!/usr/bin/env python3
"""
gen_icons.py — icon/logo generation pipeline for "YT Shorts Auto-Scroll".

There is no SVG rasterizer on this machine, so this script redraws the exact same
geometry as assets/icon.svg using PIL. The coordinate constants below mirror the
numbers documented in assets/icon.svg's header comment; if you change one, change
the other.

Pipeline: draw at 2048x2048 (supersample) -> LANCZOS downscale to a 1024 "master"
-> LANCZOS downscale the master to every required output size. Two masters are
built from the same artwork: a rounded-tile master (used for the extension icons)
and a full-bleed square master with zero corner radius (used for the macOS
AppIcon set, since Tahoe applies its own squircle mask and pre-rounded art would
render double-rounded). Toolbar glyphs are a third, independently-proportioned
render: black-only, no tile, simplified for legibility at 16/19px.

Usage:
    python3 scripts/gen_icons.py [--out OUTPUT_ROOT]

No other CLI args are required. Safe to re-run; every output is overwritten.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Shared coordinate constants — mirror assets/icon.svg (1024x1024 space).
# ---------------------------------------------------------------------------

BASE = 1024

# Tile
CORNER_RADIUS = 225                    # ~22% of 1024, matches svg rect rx/ry
GRADIENT_TOP = (0xFF, 0x00, 0x33)      # #FF0033
GRADIENT_BOTTOM = (0x8F, 0x00, 0x16)   # #8F0016

# Play triangle (pre-rounding vertices) — matches the <path> comment in icon.svg.
# Nudged right of the true tile center (512,512) for optical centering.
TRI_TOP = (402, 220)
TRI_APEX = (702, 390)
TRI_BOTTOM = (402, 560)
TRI_CORNER_RADIUS = 34

# Double chevron ("v") — matches the two <polyline> elements in icon.svg.
CHEVRON_STROKE = 46
CHEVRON1 = [(402, 650), (512, 720), (622, 650)]
CHEVRON2 = [(402, 760), (512, 830), (622, 760)]
CHEVRON2_OPACITY = 0.7

WHITE_OPAQUE = (255, 255, 255, 255)
BLACK_OPAQUE = (0, 0, 0, 255)

SUPERSAMPLE = 2048  # per spec: draw at 2048, downscale to a 1024 master


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _unit(vx: float, vy: float) -> tuple[float, float]:
    length = math.hypot(vx, vy)
    return (vx / length, vy / length)


def _quad_bezier(p0, p1, p2, t):
    x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
    y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
    return (x, y)


def rounded_polygon(vertices, radius, curve_samples=20):
    """Approximate a polygon with rounded corners (quadratic-bezier-at-vertex
    method — the same technique used to hand-compute the SVG triangle path)
    as a dense list of points suitable for ImageDraw.polygon."""
    n = len(vertices)
    pts: list[tuple[float, float]] = []
    for i, v in enumerate(vertices):
        vprev = vertices[(i - 1) % n]
        vnext = vertices[(i + 1) % n]
        din = _unit(v[0] - vprev[0], v[1] - vprev[1])
        dout = _unit(vnext[0] - v[0], vnext[1] - v[1])
        a = (v[0] - din[0] * radius, v[1] - din[1] * radius)
        b = (v[0] + dout[0] * radius, v[1] + dout[1] * radius)
        pts.append(a)
        for s in range(1, curve_samples):
            t = s / curve_samples
            pts.append(_quad_bezier(a, v, b, t))
        pts.append(b)
    return pts


def draw_thick_polyline(draw: ImageDraw.ImageDraw, points, width, fill):
    """Thick stroked polyline with round joints and round end caps —
    mirrors stroke-linecap="round" stroke-linejoin="round" in the SVG."""
    draw.line(points, fill=fill, width=max(1, round(width)), joint="curve")
    r = width / 2
    for (x, y) in (points[0], points[-1]):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def scale_pt(pt, scale):
    return (pt[0] * scale, pt[1] * scale)


# ---------------------------------------------------------------------------
# Master renders (full-color, gradient tile + white glyph)
# ---------------------------------------------------------------------------

def _vertical_gradient(size, top_rgb, bottom_rgb):
    grad = Image.new("RGBA", (size, size))
    gdraw = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / max(1, size - 1)
        r = round(top_rgb[0] + (bottom_rgb[0] - top_rgb[0]) * t)
        g = round(top_rgb[1] + (bottom_rgb[1] - top_rgb[1]) * t)
        b = round(top_rgb[2] + (bottom_rgb[2] - top_rgb[2]) * t)
        gdraw.line([(0, y), (size, y)], fill=(r, g, b, 255))
    return grad


def render_master(square_size: int, corner_radius_frac: float) -> Image.Image:
    """Render the full-color icon (tile + play triangle + double chevron) at
    square_size, then the caller downscales it. corner_radius_frac=0 gives the
    full-bleed square variant used for the macOS AppIcon set."""
    scale = square_size / BASE
    img = Image.new("RGBA", (square_size, square_size), (0, 0, 0, 0))

    # Tile: vertical gradient masked to a rounded (or square) tile shape.
    gradient = _vertical_gradient(square_size, GRADIENT_TOP, GRADIENT_BOTTOM)
    mask = Image.new("L", (square_size, square_size), 0)
    mdraw = ImageDraw.Draw(mask)
    radius_px = corner_radius_frac * square_size
    if radius_px > 0:
        mdraw.rounded_rectangle([0, 0, square_size - 1, square_size - 1], radius=radius_px, fill=255)
    else:
        mdraw.rectangle([0, 0, square_size - 1, square_size - 1], fill=255)
    img.paste(gradient, (0, 0), mask)

    draw = ImageDraw.Draw(img)

    # Play triangle — opaque white, safe to draw directly (alpha=255 overwrite
    # is a correct composite).
    tri_verts = [scale_pt(TRI_TOP, scale), scale_pt(TRI_APEX, scale), scale_pt(TRI_BOTTOM, scale)]
    tri_poly = rounded_polygon(tri_verts, TRI_CORNER_RADIUS * scale)
    draw.polygon(tri_poly, fill=WHITE_OPAQUE)

    # Chevron 1 — opaque white, safe to draw directly.
    c1 = [scale_pt(p, scale) for p in CHEVRON1]
    draw_thick_polyline(draw, c1, CHEVRON_STROKE * scale, WHITE_OPAQUE)

    # Chevron 2 — 70% opacity over the gradient. ImageDraw overwrites rather
    # than alpha-blends, so this must be composited from a separate layer to
    # correctly blend against the background instead of discarding it.
    layer = Image.new("RGBA", (square_size, square_size), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(layer)
    c2 = [scale_pt(p, scale) for p in CHEVRON2]
    draw_thick_polyline(ldraw, c2, CHEVRON_STROKE * scale, WHITE_OPAQUE)
    r, g, b, a = layer.split()
    a = a.point(lambda v: round(v * CHEVRON2_OPACITY))
    layer = Image.merge("RGBA", (r, g, b, a))
    img = Image.alpha_composite(img, layer)

    return img


def build_master(corner_radius_frac: float) -> Image.Image:
    hi_res = render_master(SUPERSAMPLE, corner_radius_frac)
    master = hi_res.resize((BASE, BASE), Image.LANCZOS)
    return master


def downscale(master: Image.Image, size: int) -> Image.Image:
    if size == master.width:
        return master.copy()
    return master.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------------------
# Toolbar template glyphs (black on transparent, no tile)
# ---------------------------------------------------------------------------

def render_toolbar_glyph(target_size: int, double_chevron: bool, supersample: int = 16) -> Image.Image:
    """Independently-proportioned glyph (not just a downscale of the color
    master) so it stays legible at 16-38px: bigger/bolder triangle, sharp
    (unrounded) corners since rounding eats too much of a shape this small,
    a clear gap before the chevron, and single-vs-double chevron by size."""
    ss = target_size * supersample
    img = Image.new("RGBA", (ss, ss), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # The symmetric chevron needs no optical correction, so it sits at the true
    # canvas center; the play triangle's bounding-box center aligns to the
    # chevron's center plus a 1% rightward optical nudge (its visual mass is
    # left-heavy). Nudging both together reads like a flag on a pole at small
    # sizes. (This differs from the tile design, where only the triangle is
    # nudged ~4% right within a much larger canvas.)
    cx_chev = ss * 0.50
    cx_tri = ss * (0.50 + 0.01)

    tri_half_w = ss * 0.20
    tri_half_h = ss * 0.22
    tri_cy = ss * 0.33
    tri_top = (cx_tri - tri_half_w, tri_cy - tri_half_h)
    tri_apex = (cx_tri + tri_half_w, tri_cy)
    tri_bottom = (cx_tri - tri_half_w, tri_cy + tri_half_h)
    tri_poly = rounded_polygon([tri_top, tri_apex, tri_bottom], radius=0, curve_samples=1)
    draw.polygon(tri_poly, fill=BLACK_OPAQUE)

    half_w = ss * 0.25
    depth = ss * 0.15
    stroke = ss * 0.15
    gap = ss * 0.09
    top1_y = (tri_cy + tri_half_h) + gap

    if double_chevron:
        c1 = [(cx_chev - half_w, top1_y), (cx_chev, top1_y + depth), (cx_chev + half_w, top1_y)]
        draw_thick_polyline(draw, c1, stroke, BLACK_OPAQUE)
        top2_y = top1_y + depth + ss * 0.05
        c2 = [(cx_chev - half_w, top2_y), (cx_chev, top2_y + depth), (cx_chev + half_w, top2_y)]
        draw_thick_polyline(draw, c2, stroke, (0, 0, 0, round(255 * CHEVRON2_OPACITY)))
    else:
        # Single chevron — double chevron is illegible at 16/19px.
        c = [(cx_chev - half_w, top1_y), (cx_chev, top1_y + depth), (cx_chev + half_w, top1_y)]
        draw_thick_polyline(draw, c, stroke, BLACK_OPAQUE)

    return img.resize((target_size, target_size), Image.LANCZOS)


def tint_glyph_white(glyph: Image.Image) -> Image.Image:
    """Simulate how Safari would render a template image in a dark toolbar,
    for the preview contact sheet only (not part of the shipped assets)."""
    r, g, b, a = glyph.split()
    white = Image.new("L", glyph.size, 255)
    return Image.merge("RGBA", (white, white, white, a))


# ---------------------------------------------------------------------------
# Contents.json for the macOS AppIcon.appiconset
# ---------------------------------------------------------------------------

def write_contents_json(appicon_dir: Path) -> Path:
    images = [
        {"size": "16x16", "idiom": "mac", "filename": "icon-16.png", "scale": "1x"},
        {"size": "16x16", "idiom": "mac", "filename": "icon-32.png", "scale": "2x"},
        {"size": "32x32", "idiom": "mac", "filename": "icon-32.png", "scale": "1x"},
        {"size": "32x32", "idiom": "mac", "filename": "icon-64.png", "scale": "2x"},
        {"size": "128x128", "idiom": "mac", "filename": "icon-128.png", "scale": "1x"},
        {"size": "128x128", "idiom": "mac", "filename": "icon-256.png", "scale": "2x"},
        {"size": "256x256", "idiom": "mac", "filename": "icon-256.png", "scale": "1x"},
        {"size": "256x256", "idiom": "mac", "filename": "icon-512.png", "scale": "2x"},
        {"size": "512x512", "idiom": "mac", "filename": "icon-512.png", "scale": "1x"},
        {"size": "512x512", "idiom": "mac", "filename": "icon-1024.png", "scale": "2x"},
    ]
    contents = {"images": images, "info": {"version": 1, "author": "xcode"}}
    out_path = appicon_dir / "Contents.json"
    out_path.write_text(json.dumps(contents, indent=2) + "\n")
    return out_path


# ---------------------------------------------------------------------------
# Contact sheet
# ---------------------------------------------------------------------------

def _label_font(size=18):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)
    except Exception:
        return ImageFont.load_default()


def build_preview(color_master: Image.Image, toolbar_glyphs: dict, out_path: Path) -> None:
    cell = 200
    pad = 24
    label_h = 26
    items_light = [
        ("icon-512", downscale(color_master, 512).resize((cell, cell), Image.LANCZOS)),
        ("icon-48", downscale(color_master, 48).resize((cell, cell), Image.NEAREST)),
        ("toolbar-38", toolbar_glyphs[38].resize((cell, cell), Image.NEAREST)),
        ("toolbar-16", toolbar_glyphs[16].resize((cell, cell), Image.NEAREST)),
    ]
    items_dark = [
        ("icon-512", items_light[0][1]),
        ("icon-48", items_light[1][1]),
        ("toolbar-38", tint_glyph_white(toolbar_glyphs[38]).resize((cell, cell), Image.NEAREST)),
        ("toolbar-16", tint_glyph_white(toolbar_glyphs[16]).resize((cell, cell), Image.NEAREST)),
    ]

    n = len(items_light)
    strip_w = pad + n * (cell + pad)
    strip_h = pad + cell + label_h + pad
    sheet_h = strip_h * 2
    sheet = Image.new("RGB", (strip_w, sheet_h), (255, 255, 255))

    font = _label_font()

    def draw_strip(base_img: Image.Image, y_offset: int, items, bg, fg):
        d = ImageDraw.Draw(base_img)
        d.rectangle([0, y_offset, strip_w, y_offset + strip_h], fill=bg)
        x = pad
        y = y_offset + pad
        for label, icon in items:
            if icon.mode == "RGBA":
                base_img.paste(icon, (x, y), icon)
            else:
                base_img.paste(icon, (x, y))
            d.text((x, y + cell + 4), label, fill=fg, font=font)
            x += cell + pad

    draw_strip(sheet, 0, items_light, (255, 255, 255), (20, 20, 20))
    draw_strip(sheet, strip_h, items_dark, (28, 28, 30), (235, 235, 235))

    sheet.save(out_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

EXTENSION_ICON_SIZES = [48, 96, 128, 256, 512]
TOOLBAR_SIZES = [16, 19, 32, 38]
TOOLBAR_DOUBLE_CHEVRON = {16: False, 19: False, 32: True, 38: True}
APPICON_SIZES = [16, 32, 64, 128, 256, 512, 1024]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=str, default=None, help="output root (default: repo root)")
    args = parser.parse_args()

    repo_root = Path(args.out).resolve() if args.out else Path(__file__).resolve().parent.parent

    extension_images_dir = repo_root / "extension" / "images"
    appicon_dir = repo_root / "assets" / "appicon"
    preview_path = repo_root / "assets" / "preview.png"

    extension_images_dir.mkdir(parents=True, exist_ok=True)
    appicon_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []

    # --- Full-color rounded-tile master -> extension/images/icon-*.png ---
    rounded_master = build_master(CORNER_RADIUS / BASE)
    for size in EXTENSION_ICON_SIZES:
        out_path = extension_images_dir / f"icon-{size}.png"
        downscale(rounded_master, size).save(out_path)
        print(f"wrote {out_path}")
        written.append(out_path)

    # --- Full-bleed square master (radius=0) -> assets/appicon/icon-*.png ---
    square_master = build_master(0.0)
    for size in APPICON_SIZES:
        out_path = appicon_dir / f"icon-{size}.png"
        downscale(square_master, size).save(out_path)
        print(f"wrote {out_path}")
        written.append(out_path)

    contents_path = write_contents_json(appicon_dir)
    print(f"wrote {contents_path}")
    written.append(contents_path)

    # --- Toolbar template glyphs -> extension/images/toolbar-*.png ---
    toolbar_glyphs: dict[int, Image.Image] = {}
    for size in TOOLBAR_SIZES:
        glyph = render_toolbar_glyph(size, double_chevron=TOOLBAR_DOUBLE_CHEVRON[size])
        toolbar_glyphs[size] = glyph
        out_path = extension_images_dir / f"toolbar-{size}.png"
        glyph.save(out_path)
        print(f"wrote {out_path}")
        written.append(out_path)

    # --- Contact sheet ---
    build_preview(rounded_master, toolbar_glyphs, preview_path)
    print(f"wrote {preview_path}")
    written.append(preview_path)

    # --- Verify every output on disk with PIL and print a table ---
    print("\nVerification:")
    header = f"{'file':55s} {'expected':>10s} {'actual':>10s} {'mode':>6s} {'ok':>4s}"
    print(header)
    print("-" * len(header))
    expected_sizes = {}
    for size in EXTENSION_ICON_SIZES:
        expected_sizes[extension_images_dir / f"icon-{size}.png"] = size
    for size in TOOLBAR_SIZES:
        expected_sizes[extension_images_dir / f"toolbar-{size}.png"] = size
    for size in APPICON_SIZES:
        expected_sizes[appicon_dir / f"icon-{size}.png"] = size

    all_ok = True
    for path, expected in sorted(expected_sizes.items(), key=lambda kv: str(kv[0])):
        with Image.open(path) as im:
            w, h = im.size
            mode = im.mode
        ok = (w == expected and h == expected)
        all_ok = all_ok and ok
        rel = path.relative_to(repo_root)
        print(f"{str(rel):55s} {expected:>7d}px {w:>4d}x{h:<4d} {mode:>6s} {'OK' if ok else 'FAIL':>4s}")

    print(f"\n{contents_path.relative_to(repo_root)} present: {contents_path.exists()}")
    print(f"{preview_path.relative_to(repo_root)} present: {preview_path.exists()}")
    print(f"\nAll sizes correct: {all_ok}")


if __name__ == "__main__":
    main()
