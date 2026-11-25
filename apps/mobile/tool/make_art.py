#!/usr/bin/env python3
"""Builds the launcher icon, splash and notification icon sources from the brand SVGs.

    python3 tool/make_art.py                     # needs rsvg-convert (librsvg)
    dart run flutter_launcher_icons              # → android/ and ios/ launcher icons
    dart run flutter_native_splash:create        # → android/ and ios/ launch screens

Sources: ../../assets/brand/logo-dark.svg (colour mark) and logo-mono.svg (one-colour mark).
Outputs: tool/art/*.png, assets/brand/mark.png and the Android notification icon.
"""
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BRAND = ROOT.parent.parent / "assets" / "brand"
ART = ROOT / "tool" / "art"
INK, NAVY, BRAND_DEEP = "#040A14", "#06203D", "#0069AC"


def inner(svg_path, prefix):
    """The mark's drawing (2048×2048 units) without its <svg> wrapper, gradient ids made unique."""
    text = svg_path.read_text()
    body = re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", text, flags=re.S)
    body = re.sub(r'id="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}"', body)
    return re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{prefix}{m.group(1)})", body)


def mark(svg_path, size, canvas, prefix="m", fill=None):
    """The mark, `size` px wide, centred on a `canvas` px square."""
    scale = size / 2048
    offset = (canvas - size) / 2
    body = inner(svg_path, prefix)
    if fill:
        # The one-colour mark carries its own fill: repaint it.
        body = re.sub(r'fill="(?!none)[^"]*"', f'fill="{fill}"', body)
        body = f'<g fill="{fill}">{body}</g>'
    return f'<g transform="translate({offset} {offset}) scale({scale})">{body}</g>'


def render(name, canvas, content, out=None):
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{canvas}" height="{canvas}" viewBox="0 0 {canvas} {canvas}">{content}</svg>'
    target = out or ART / name
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as handle:
        handle.write(svg)
    subprocess.run(["rsvg-convert", "-w", str(canvas), "-h", str(canvas), handle.name, "-o", str(target)], check=True)
    pathlib.Path(handle.name).unlink()
    print("wrote", target.relative_to(ROOT))


# The icon's ground: the hero's navy-to-ink gradient with the blade crossing the corner.
GROUND = f"""
<defs>
  <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{NAVY}"/><stop offset="0.8" stop-color="{INK}"/></linearGradient>
  <linearGradient id="blade" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="{BRAND_DEEP}" stop-opacity="0"/><stop offset="1" stop-color="#1C7FD6" stop-opacity="0.5"/></linearGradient>
</defs>
<rect width="1024" height="1024" fill="url(#ground)"/>
<path d="M0 1024 C 420 1000 800 720 1024 250 L1024 0 L900 0 C 760 520 420 860 0 930 Z" fill="url(#blade)"/>
"""

logo = BRAND / "logo-dark.svg"
mono = BRAND / "logo-mono.svg"

render("icon-1024.png", 1024, GROUND + mark(logo, 640, 1024))
# Adaptive icon layers: the launcher crops to the middle 66 %, so the mark stays inside it.
render("icon-foreground-1024.png", 1024, mark(logo, 500, 1024))
render("icon-monochrome-1024.png", 1024, mark(mono, 500, 1024, fill="#000000"))
render("splash-mark.png", 640, mark(logo, 640, 640))
# Android 12+ splash: the icon must fit a circle two thirds of the canvas wide.
render("splash-android12.png", 1152, mark(logo, 600, 1152))
render("mark.png", 384, mark(logo, 384, 384), out=ROOT / "assets" / "brand" / "mark.png")

# Status-bar icon for notifications: white on transparent (Android only uses the alpha).
for density, px in {"mdpi": 24, "hdpi": 36, "xhdpi": 48, "xxhdpi": 72, "xxxhdpi": 96}.items():
    render("", px, mark(mono, px, px, fill="#FFFFFF"), out=ROOT / "android/app/src/main/res" / f"drawable-{density}" / "ic_stat_bluelytics.png")
