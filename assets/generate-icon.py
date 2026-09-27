"""Generate Zenix's original desktop icon with Pillow."""

from pathlib import Path
from PIL import Image, ImageDraw


OUT = Path(__file__).parent
SCALE = 4
SIZE = 512
CANVAS = SIZE * SCALE

image = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

def box(coords):
    return tuple(round(value * SCALE) for value in coords)

draw.rounded_rectangle(box((12, 12, 500, 500)), radius=110 * SCALE, fill=(17, 17, 20, 255))
draw.rounded_rectangle(box((23, 23, 489, 489)), radius=100 * SCALE, outline=(83, 83, 91, 255), width=3 * SCALE)

# The hand-drawn Z echoes the path drawn during the opening animation.
stroke = 43 * SCALE
draw.line(box((154, 168, 357, 168, 154, 344, 357, 344)), fill=(248, 250, 253, 255), width=stroke, joint="curve")
for x, y in ((154, 168), (357, 168), (154, 344), (357, 344)):
    r = stroke / 2
    draw.ellipse((x * SCALE - r, y * SCALE - r, x * SCALE + r, y * SCALE + r), fill=(248, 248, 249, 255))

draw.arc(box((99, 102, 411, 414)), start=214, end=312, fill=(128, 157, 200, 190), width=5 * SCALE)
image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
image.save(OUT / "zenix-icon.png")
image.save(OUT / "zenix-icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
