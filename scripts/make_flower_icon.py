# Inspoboard app icon, flower version: a small square with an arm on each side, and a round hole in the middle.
# - The square stands on a corner (corners up, right, down, left). Each arm is a short rectangle and a half circle at its
#   end, as wide as the side of the square. Between the arms, at each corner of the square, there is a notch.
# - The shape is the union of the square and the circles, without the hole. It is one piece: one cushion of light.
# - Colors as the highlight icon (make_icon.py --highlight): purple, shaded as a soft cushion lit from the top left,
#   a white highlight on its outer edges that face the light, a soft shadow. The hole is a hollow: a bright edge on
#   its bottom right (the wall there faces the light) and a dark edge on its top left.
# All of it comes from exact distances to the circles and the square: clean, symmetric edges.
# Usage (needs Pillow, NumPy, SciPy): python3 scripts/make_flower_icon.py out.png [size]
import os, sys

_args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
if not _args:
    sys.exit(f"Usage: /usr/bin/python3 {os.path.relpath(__file__)} out.png [size]")
try:
    import numpy, scipy, PIL  # noqa: F401
except ImportError as missing:
    sys.exit(f"This script needs NumPy, SciPy, and Pillow ({missing}). The macOS Python has them: /usr/bin/python3 {os.path.relpath(__file__)} out.png [size]")
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
N = 2048
U = N / 1024
SHAPE_WIDTH = 600 * U          # the width of the flower (of a 1024 icon; the rounded square is 824)
# Sizes for a square with its corners at distance 1 from the middle.
SQUARE = 0.8                  # the inner square (its corners at this distance)
NECK = 0.22                   # a short rectangle between each side of the square and its half circle
CIRCLE_CENTER = SQUARE / np.sqrt(2) + NECK  # the center of each half circle: past the side, at the end of the rectangle
HOLE = 0.30                   # radius of the hole
LIGHT = np.array([-1.0, -1.0, 1.3]) / np.linalg.norm([-1.0, -1.0, 1.3])
FILL_LIGHT, FILL_DARK = np.array([196, 200, 255]), np.array([84, 88, 204])
SHADOW, SHADE = 0.14, 0.38

def read_gradient():
    source = Image.open(os.path.join(HERE, "..", "icon_bg.png")).convert("RGB")
    width, height = source.size
    rows = np.array([source.getpixel((width // 2, y)) for y in range(height)], dtype=float)
    colored = np.nonzero(rows.sum(axis=1) < 690)[0]
    return rows[colored[0] + 6 : colored[-1] - 5]

# Each arm is as wide as a side of the square: its half circle has half a side as its radius.
radius = float(SQUARE / np.sqrt(2))
extent = CIRCLE_CENTER + radius
unit = (SHAPE_WIDTH / 2) / extent           # pixels for each shape unit
DIRECTIONS = [(1, 1), (-1, 1), (-1, -1), (1, -1)]  # the four arms, on the diagonals

ys, xs = np.mgrid[0:N, 0:N].astype(float) + 0.5
x, y = (xs - N / 2) / unit, (ys - N / 2) / unit
# Signed distance (shape units; negative inside): the square, and four arms (a rectangle and a half circle each),
# without the hole.
side = SQUARE / np.sqrt(2)                  # distance from the middle to each side of the square
square = (np.abs(x) + np.abs(y) - SQUARE) / np.sqrt(2)
arms = []
for dx, dy in DIRECTIONS:
    along = (x * dx + y * dy) / np.sqrt(2)          # toward the arm
    across = (x * dy - y * dx) / np.sqrt(2)         # along the side of the square
    # The rectangle: as wide as the half circle, from a little inside the square to the half circle.
    # (It goes a little into the half circle too: two shapes that only touch leave a seam in the distance.)
    middle, half_length = (side - 0.05 + CIRCLE_CENTER + 0.05) / 2, (CIRCLE_CENTER + 0.05 - side + 0.05) / 2
    qx, qy = np.abs(across) - radius, np.abs(along - middle) - half_length
    box = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)
    # The half circle: the outer half of a circle at the end of the rectangle.
    half_circle = np.maximum(np.hypot(along - CIRCLE_CENTER, across) - radius, CIRCLE_CENTER - 0.05 - along)
    arms.append(np.minimum(box, half_circle))
circles = np.min(arms, axis=0)
outline = np.minimum(circles, square)
shape = np.maximum(outline, HOLE - np.hypot(x, y))
inside_distance = -shape * unit                 # pixels; positive inside
occupancy = np.clip(inside_distance / (1.0 * U) + 0.5, 0, 1)
inside = inside_distance > 0

gradient = read_gradient()
m = 100 * U
t = np.clip((ys[:, 0] - m) / (N - 2 * m), 0, 1)
positions = np.linspace(0, 1, len(gradient))
sky = np.stack([np.interp(t, positions, gradient[:, channel]) for channel in range(3)], axis=-1)
image = np.repeat(sky[:, None, :], N, axis=1)
shadow = Image.fromarray((inside * 255).astype(np.uint8)).transform((N, N), Image.AFFINE, (1, 0, -10 * U, 0, 1, -14 * U)).filter(ImageFilter.GaussianBlur(16 * U))
image *= 1 - SHADOW * (np.asarray(shadow, float) / 255)[..., None]

# The cushion: its height rises from the outer edge (smoothed so that the middle has no crease). The hole is a flat cut:
# it has no edge of its own in the light (no rim, no highlight).
edge_distance = ndimage.distance_transform_edt(outline < 0)
# The height: a soft blur of the whole outer shape. It has no creases (a distance to the edge has them along the lines
# from each notch to the middle).
body = ndimage.gaussian_filter((outline < 0).astype(float), 26 * U)
gy, gx = np.gradient(body)
steep = 70 * U
normal = np.stack([-gx * steep, -gy * steep, np.ones_like(body)], axis=-1)
normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
with np.errstate(all="ignore"):
    lambert = np.nan_to_num(np.clip(normal @ LIGHT, 0, 1))
across = np.clip((xs + ys) / (2 * N), 0, 1)
light = 1 - SHADE * (1 - lambert) - 0.25 * across
fill = FILL_DARK + (FILL_LIGHT - FILL_DARK) * np.clip(light, 0, 1)[..., None]

# The highlight: a white rim on the edges that face the light (the outside, and the far side of the hole).
ey, ex = np.gradient(-ndimage.gaussian_filter(edge_distance, 2 * U))
facing = np.clip((ex * -1 + ey * -1) / np.sqrt(2) / (np.hypot(ex, ey) + 1e-9), 0, 1) ** 0.8
rim = np.exp(-((edge_distance / (15 * U)) ** 1.5))
gleam = np.where(inside, rim * np.clip(facing * 1.8, 0, 1), 0)
# The light of the outer shape only: the hole cuts it.

# The hole is a hollow: its wall faces the middle of the hole. With the light from the top left, the wall at the
# bottom right gets the light (a bright edge) and the wall at the top left is in shade (a dark edge).
hole_r = np.hypot(x, y)
hole_edge = (hole_r - HOLE) * unit                       # pixels from the hole edge (positive in the shape)
wall = np.exp(-((np.clip(hole_edge, 0, None) / (12 * U)) ** 1.5)) * inside
toward_light = ((-x) * -1 + (-y) * -1) / np.sqrt(2) / (hole_r + 1e-9)  # the wall normal (to the middle) · light
bright = np.clip(toward_light, 0, 1) ** 0.8 * wall
dark = np.clip(-toward_light, 0, 1) ** 0.8 * wall
fill = fill * (1 - 0.45 * dark[..., None]) + np.array([44, 42, 120]) * (0.45 * dark[..., None])
fill = fill * (1 - 0.9 * bright[..., None]) + np.array([255, 255, 255]) * (0.9 * bright[..., None])

soft = occupancy[..., None]
image = image * (1 - soft) + fill * soft
shine = (gleam * occupancy)[..., None]
image = image * (1 - shine) + np.array([255, 255, 255]) * shine

result = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8)).convert("RGBA")
frame = Image.new("L", (N, N), 0)
ImageDraw.Draw(frame).rounded_rectangle([m, m, N - m, N - m], radius=185 * U, fill=255)
result.putalpha(frame)
args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
size = int(args[1]) if len(args) > 1 else 1024
result.resize((size, size), Image.LANCZOS).save(args[0])
