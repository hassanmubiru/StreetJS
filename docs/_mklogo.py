"""Rasterize the StreetJS logo (docs/assets/images/logo.svg) to PNG.
npm blocks SVG in READMEs, so a raster logo is required to display on npmjs.com.
The SVG is simple (gradient rounded square + white 'S' bezier), so we redraw it
faithfully with Pillow at high resolution."""
from PIL import Image, ImageDraw

VB = 120          # SVG viewBox
S = 1024          # output size (px)
k = S / VB        # scale

def sp(x, y):     # scale a viewBox point to px
    return (x * k, y * k)

# Cubic bezier segments of the 'S' (converted from the SVG path to absolute coords)
segs = [
    ((76, 44), (76, 37), (70, 32), (60, 32)),
    ((60, 32), (50, 32), (43, 37), (43, 45)),
    ((43, 45), (43, 63), (78, 54), (78, 73)),
    ((78, 73), (78, 81), (70, 86), (59, 86)),
    ((59, 86), (48, 86), (40, 81), (39, 73)),
]

def bez(p0, p1, p2, p3, t):
    mt = 1 - t
    x = mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0]
    y = mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1]
    return x, y

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# --- gradient rounded square (diagonal #3B82F6 -> #2563EB) ---
c0 = (0x3B, 0x82, 0xF6)
c1 = (0x25, 0x63, 0xEB)
grad = Image.new("RGB", (S, S))
gpx = grad.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        gpx[x, y] = (
            int(c0[0] + (c1[0]-c0[0])*t),
            int(c0[1] + (c1[1]-c0[1])*t),
            int(c0[2] + (c1[2]-c0[2])*t),
        )
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([sp(6, 6)[0], sp(6, 6)[1], sp(114, 114)[0], sp(114, 114)[1]],
                     radius=26*k, fill=255)
img.paste(grad, (0, 0), mask)

# --- white 'S' stroke: stamp circles along the bezier to emulate width-9 round caps ---
r = (9 / 2) * k
white = (255, 255, 255, 255)
for seg in segs:
    p0, p1, p2, p3 = seg
    n = 240
    for i in range(n + 1):
        t = i / n
        x, y = bez(p0, p1, p2, p3, t)
        px, py = x * k, y * k
        draw.ellipse([px - r, py - r, px + r, py + r], fill=white)

img.save("docs/assets/images/logo.png", "PNG")
# also a 512 variant for crisp README display
img.resize((512, 512), Image.LANCZOS).save("docs/assets/images/logo-512.png", "PNG")
print("wrote docs/assets/images/logo.png (1024) + logo-512.png")
