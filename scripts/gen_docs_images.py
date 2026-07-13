#!/usr/bin/env python3
"""Generate README images: docs/hero.png and docs/modes.png.

Pure PIL, supersampled for crisp edges. Reuses the extension's tile icon.
Run: python3 scripts/gen_docs_images.py
"""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DOCS.mkdir(exist_ok=True)
ICON = ROOT / "extension" / "images" / "icon-512.png"

RED = (255, 0, 51)
RED_DK = (143, 0, 22)
# Light theme — blends into GitHub's white page (and reads as a clean light
# card in dark mode).
BG_TOP = (255, 255, 255)
BG_BOT = (244, 244, 247)
INK = (17, 17, 20)         # near-black headings
MUTED = (108, 108, 118)    # secondary text
CARD = (248, 248, 251)
CARD_BORDER = (226, 226, 232)

SS = 2  # supersample

def font(path_options, size):
    for p in path_options:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()

BOLD = ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/SFNSRounded.ttf"]
REG = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/SFNS.ttf"]

def vgradient(w, h, top, bot):
    base = Image.new("RGB", (w, h), top)
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return base

def rounded(draw, box, r, **kw):
    draw.rounded_rectangle(box, radius=r, **kw)

def rgba_paste_shadow(canvas, img, xy, blur_offset, ss):
    # simple soft shadow: paste a dark, slightly larger rounded shadow behind
    x, y = xy
    sh = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    pad = 8 * ss
    sd.rounded_rectangle([x - pad, y - pad + blur_offset, x + img.width + pad, y + img.height + pad + blur_offset],
                         radius=64 * ss, fill=(0, 0, 0, 40))
    canvas.alpha_composite(sh)
    canvas.alpha_composite(img, (x, y))

def hero():
    W, H = 1200 * SS, 470 * SS
    canvas = vgradient(W, H, BG_TOP, BG_BOT).convert("RGBA")
    # faint red glow, upper-left, very subtle on white
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([-260 * SS, -300 * SS, 480 * SS, 240 * SS], fill=(255, 0, 51, 14))
    canvas.alpha_composite(glow)

    # logo tile
    tile = Image.open(ICON).convert("RGBA").resize((300 * SS, 300 * SS), Image.LANCZOS)
    tx, ty = 90 * SS, (H - tile.height) // 2
    rgba_paste_shadow(canvas, tile, (tx, ty), 10 * SS, SS)

    d = ImageDraw.Draw(canvas)
    text_x = tx + tile.width + 70 * SS
    # wordmark (two lines, tight)
    f_title = font(BOLD, 84 * SS)
    d.text((text_x, 150 * SS), "YT Shorts", font=f_title, fill=INK)
    d.text((text_x, 240 * SS), "Auto-Scroll", font=f_title, fill=RED)
    # tagline
    f_tag = font(REG, 30 * SS)
    d.text((text_x + 4 * SS, 348 * SS),
           "Hands-free YouTube Shorts for Safari —", font=f_tag, fill=MUTED)
    d.text((text_x + 4 * SS, 388 * SS),
           "auto-scroll, background audio, even Picture-in-Picture.", font=f_tag, fill=MUTED)

    # chips row (top-right)
    f_chip = font(BOLD, 22 * SS)
    chips = ["Safari", "MV3", "Open Source"]
    cx = W - 60 * SS
    for label in reversed(chips):
        tw = d.textbbox((0, 0), label, font=f_chip)[2]
        w = tw + 40 * SS
        cx -= w
        rounded(d, [cx, 60 * SS, cx + w, 60 * SS + 46 * SS], 23 * SS,
                fill=None, outline=CARD_BORDER, width=2 * SS)
        d.text((cx + 20 * SS, 71 * SS), label, font=f_chip, fill=MUTED)
        cx -= 16 * SS

    out = canvas.convert("RGB").resize((1200, 470), Image.LANCZOS)
    out.save(DOCS / "hero-light.png")
    print("wrote", DOCS / "hero-light.png")

def glyph_play(d, cx, cy, s, color):
    d.polygon([(cx - s * 0.32, cy - s * 0.5), (cx + s * 0.5, cy), (cx - s * 0.32, cy + s * 0.5)], fill=color)

def glyph_speaker(d, cx, cy, s, color):
    # box + cone + waves
    bx = cx - s * 0.55
    d.rectangle([bx, cy - s * 0.22, bx + s * 0.28, cy + s * 0.22], fill=color)
    d.polygon([(bx + s * 0.28, cy - s * 0.22), (bx + s * 0.7, cy - s * 0.5),
               (bx + s * 0.7, cy + s * 0.5), (bx + s * 0.28, cy + s * 0.22)], fill=color)
    for i, r in enumerate((0.28, 0.5)):
        d.arc([cx + s * 0.25 - s * r, cy - s * r, cx + s * 0.25 + s * r, cy + s * r],
              -55, 55, fill=color, width=max(2, int(s * 0.09)))

def glyph_pip(d, cx, cy, s, color):
    w, h = s * 1.3, s * 0.95
    d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=s * 0.12,
                        outline=color, width=max(2, int(s * 0.1)))
    iw, ih = s * 0.5, s * 0.36
    d.rounded_rectangle([cx + w / 2 - iw - s * 0.12, cy + h / 2 - ih - s * 0.12,
                         cx + w / 2 - s * 0.12, cy + h / 2 - s * 0.12], radius=s * 0.06, fill=color)

def modes():
    W, H = 1200 * SS, 310 * SS
    canvas = vgradient(W, H, BG_TOP, BG_BOT).convert("RGB")
    d = ImageDraw.Draw(canvas)
    cards = [
        (glyph_play, "Auto-scroll", ["Advances to the next Short", "the moment one ends."]),
        (glyph_speaker, "Background audio", ["Keeps playing real Shorts", "when Safari is hidden."]),
        (glyph_pip, "Background PiP", ["Real Shorts, rendering, in a", "floating window — hands-free."]),
    ]
    pad = 50 * SS
    gap = 30 * SS
    cw = (W - 2 * pad - 2 * gap) // 3
    ch = 234 * SS
    cy0 = (H - ch) // 2
    f_h = font(BOLD, 33 * SS)
    f_b = font(REG, 23 * SS)
    for i, (g, title, lines) in enumerate(cards):
        x0 = pad + i * (cw + gap)
        d.rounded_rectangle([x0, cy0, x0 + cw, cy0 + ch], radius=22 * SS,
                            fill=CARD, outline=CARD_BORDER, width=2 * SS)
        px = x0 + 34 * SS  # inner left padding
        # glyph in a light-red circle
        gcx, gcy = px + 22 * SS, cy0 + 58 * SS
        d.ellipse([gcx - 32 * SS, gcy - 32 * SS, gcx + 32 * SS, gcy + 32 * SS], fill=(255, 232, 236))
        g(d, gcx, gcy, 38 * SS, RED)
        d.text((px, cy0 + 106 * SS), title, font=f_h, fill=INK)
        for j, ln in enumerate(lines):
            d.text((px, cy0 + 152 * SS + j * 32 * SS), ln, font=f_b, fill=MUTED)
    out = canvas.resize((1200, 310), Image.LANCZOS)
    out.save(DOCS / "features-light.png")
    print("wrote", DOCS / "features-light.png")

if __name__ == "__main__":
    hero()
    modes()
