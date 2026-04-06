#!/usr/bin/env python3
"""Generate all icon PNGs from the SVG source."""
import cairosvg
import os

SVG_DIR = os.path.dirname(os.path.abspath(__file__))
SVG_FILE = os.path.join(SVG_DIR, "icon.svg")

with open(SVG_FILE, "r") as f:
    svg_data = f.read()

# ── 1. Main icon (1024x1024) ──
cairosvg.svg2png(bytestring=svg_data.encode(), write_to=os.path.join(SVG_DIR, "icon.png"),
                 output_width=1024, output_height=1024)
print("✓ icon.png (1024x1024)")

# ── 2. Android adaptive icon foreground (432x432, centered in safe zone) ──
# For adaptive icons, the foreground should just be the "A" on transparent bg
foreground_svg = svg_data.replace('fill="url(#bgGlow)"', 'fill="none"')
# Remove the background rect border too
foreground_svg = foreground_svg.replace(
    '<rect x="4" y="4" width="1016" height="1016" rx="198" ry="198" fill="none" stroke="#c8a84e" stroke-opacity="0.15" stroke-width="2"/>',
    ''
)
# Remove corner accents for cleaner foreground
for line in foreground_svg.split('\n'):
    if 'corner' in line.lower():
        foreground_svg = foreground_svg.replace(line, '')

cairosvg.svg2png(bytestring=foreground_svg.encode(), write_to=os.path.join(SVG_DIR, "android-icon-foreground.png"),
                 output_width=432, output_height=432)
print("✓ android-icon-foreground.png (432x432)")

# ── 3. Android adaptive icon background (432x432, just the dark bg) ──
bg_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bgGlow" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0%" stop-color="#1a2030"/>
      <stop offset="60%" stop-color="#111820"/>
      <stop offset="100%" stop-color="#0d1117"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bgGlow)"/>
</svg>'''
cairosvg.svg2png(bytestring=bg_svg.encode(), write_to=os.path.join(SVG_DIR, "android-icon-background.png"),
                 output_width=432, output_height=432)
print("✓ android-icon-background.png (432x432)")

# ── 4. Android monochrome icon (432x432, white on transparent) ──
mono_svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <path d="
    M 512 180
    L 310 780 L 270 780
    Q 258 780 258 768 L 258 760
    Q 258 752 266 748
    L 460 240
    Q 480 195 512 180
    Q 544 195 564 240
    L 758 748
    Q 766 752 766 760 L 766 768
    Q 766 780 754 780
    L 714 780 Z
    M 390 620 L 634 620 L 612 560 L 412 560 Z
  " fill="white" fill-rule="evenodd"/>
  <path d="M 270 770 Q 260 770 250 780 L 230 800 Q 222 810 232 815 L 350 815 Q 360 815 358 805 L 340 780 Q 335 770 320 770 Z" fill="white"/>
  <path d="M 704 770 Q 689 770 684 780 L 666 805 Q 664 815 674 815 L 792 815 Q 802 810 794 800 L 774 780 Q 764 770 754 770 Z" fill="white"/>
  <path d="M 490 195 Q 500 175 512 168 Q 524 175 534 195 L 540 210 Q 530 200 512 200 Q 494 200 484 210 Z" fill="white"/>
</svg>'''
cairosvg.svg2png(bytestring=mono_svg.encode(), write_to=os.path.join(SVG_DIR, "android-icon-monochrome.png"),
                 output_width=432, output_height=432)
print("✓ android-icon-monochrome.png (432x432)")

# ── 5. Favicon (48x48) ──
cairosvg.svg2png(bytestring=svg_data.encode(), write_to=os.path.join(SVG_DIR, "favicon.png"),
                 output_width=48, output_height=48)
print("✓ favicon.png (48x48)")

# ── 6. Splash icon (512x512 centered on dark bg, for Expo splash) ──
splash_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0d1117"/>
  <g transform="translate(56 56) scale(0.39)">
    {svg_data.split("<defs>")[1].split("</defs>")[0]}
  </g>
</svg>'''
# Simpler approach: just use the icon as splash icon
cairosvg.svg2png(bytestring=svg_data.encode(), write_to=os.path.join(SVG_DIR, "splash-icon.png"),
                 output_width=512, output_height=512)
print("✓ splash-icon.png (512x512)")

# ── 7. Site favicon (larger, 192x192 for web manifest) ──
cairosvg.svg2png(bytestring=svg_data.encode(), write_to=os.path.join(SVG_DIR, "icon-192.png"),
                 output_width=192, output_height=192)
print("✓ icon-192.png (192x192)")

print("\nDone! All icons generated.")
