#!/usr/bin/env python3
"""Builds the launcher icon, splash icon, notification icon and in-app mark from the brand SVGs.

    python3 tool/make_art.py      # needs rsvg-convert (librsvg)

Sources: ../../assets/brand/logo-dark.svg (colour mark) and logo-mono.svg (one-colour mark).
Outputs go straight into app/src/main/res: the adaptive icon layers (shown with a 16 % inset by
mipmap-anydpi/ic_launcher.xml; every Android version the app supports uses it, so there are no square
legacy icons), the Android 12+ splash icon, the status-bar icon and drawable-nodpi/mark.png (the
masthead). The same compositions as the Flutter
app's tool/make_art.py, so both apps' art matches pixel for pixel.
"""
import pathlib
import re
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
BRAND = ROOT.parent.parent / "assets" / "brand"
RES = ROOT / "app" / "src" / "main" / "res"
INK, NAVY, BRAND_DEEP = "#040A14", "#06203D", "#0069AC"
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def inner(svg_path, prefix):
    """The mark's drawing (2048×2048 units) without its <svg> wrapper, gradient ids made unique."""
    text = svg_path.read_text()
    body = re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", text, flags=re.S)
    body = re.sub(r'id="([^"]+)"', lambda m: f'id="{prefix}{m.group(1)}"', body)
    return re.sub(r"url\(#([^)]+)\)", lambda m: f"url(#{prefix}{m.group(1)})", body)


def mark(svg_path, size, canvas, prefix="m", fill=None):
    """The mark, `size` units wide, centred on a `canvas` unit square."""
    scale = size / 2048
    offset = (canvas - size) / 2
    body = inner(svg_path, prefix)
    if fill:
        # The one-colour mark carries its own fill: repaint it.
        body = re.sub(r'fill="(?!none)[^"]*"', f'fill="{fill}"', body)
        body = f'<g fill="{fill}">{body}</g>'
    return f'<g transform="translate({offset} {offset}) scale({scale})">{body}</g>'


def render(target, units, pixels, content):
    """Draws `content` (laid out on a `units` square) into a `pixels` square PNG."""
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{units}" height="{units}" viewBox="0 0 {units} {units}">{content}</svg>'
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as handle:
        handle.write(svg)
    try:
        subprocess.run(["rsvg-convert", "-w", str(pixels), "-h", str(pixels), handle.name, "-o", str(target)], check=True)
    finally:
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

for density, factor in DENSITIES.items():
    # Adaptive icon layers, 108 dp: the launcher crops to the middle 66 %, so the mark stays inside.
    layer = round(108 * factor)
    render(RES / f"drawable-{density}" / "ic_launcher_foreground.png", 1024, layer, mark(logo, 500, 1024))
    render(RES / f"drawable-{density}" / "ic_launcher_monochrome.png", 1024, layer, mark(mono, 500, 1024, fill="#000000"))
    # Android 12+ splash, 288 dp: the icon must fit a circle two thirds of the canvas wide.
    render(RES / f"drawable-{density}" / "splash_icon.png", 1152, round(288 * factor), mark(logo, 600, 1152))
    # Status-bar icon for notifications, 24 dp: white on transparent (Android only uses the alpha).
    render(RES / f"drawable-{density}" / "ic_stat_bluelytics.png", 24, round(24 * factor), mark(mono, 24, 24, fill="#FFFFFF"))

render(RES / "drawable-nodpi" / "mark.png", 384, 384, mark(logo, 384, 384))
# The Google Play listing icon (512 px), uploaded by hand in the Play Console.
render(ROOT / "build" / "art" / "play-icon-512.png", 1024, 512, GROUND + mark(logo, 640, 1024))
