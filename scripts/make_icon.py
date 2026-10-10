# Inspoboard app icon: the woven rope of icon_fg.png (two figure-8s), on a sunset gradient
# (the whole gradient of icon_bg.png, its middle column, fitted into the icon height).
# - The shape comes from icon_fg.png (the drawing, earlier icon.png) itself: its black lines split it into areas. The rope areas get a purple fill;
#   the outside and the four loops show the background.
# - The outline is made again with one width everywhere: the line between two neighbor areas (each pixel belongs to
#   its nearest area; the edges are smoothed). Its color: warm white to gold, as in light from the top left.
# - The rope is shaded like a round rope, lit from the top left. A soft shadow falls to the bottom right.
# Usage (needs Pillow, NumPy, and SciPy): python3 scripts/make_icon.py icon-source.png [size] [--no-outline] && npx tauri icon icon-source.png
# --no-outline: no white outline (the rope parts show only by their shading).
# --highlight: no outline; a white highlight on the edges that face the light, and softer shadows.
# --pattern: the braid of icon_pattern.png along each rope (it follows the middle line of the rope).
# --braid: each rope IS the braid of icon_pattern.png (its outer shape too), flat colors (no shading, no shadow).
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
HIGHLIGHT = "--highlight" in sys.argv
PATTERN = "--pattern" in sys.argv
BRAID = "--braid" in sys.argv
NO_OUTLINE = "--no-outline" in sys.argv or HIGHLIGHT
# Shadow strength: the drop shadow, and how dark the rope gets away from the light.
SHADOW, ROPE_SHADE = (0.14, 0.38) if HIGHLIGHT else (0.32, 0.55)
ARGS = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
N = 2048                      # render size; the output is resized
U = N / 1024                  # pixels for each unit of a 1024 icon
SHAPE_WIDTH = 664 * U         # the width of the shape
LINE = 13.75 * U              # outline width
SMOOTH = 3.0 * U              # smoothing of the area edges
LIGHT = np.array([-1.0, -1.0, 1.3]) / np.linalg.norm([-1.0, -1.0, 1.3])
FILL_LIGHT, FILL_DARK = np.array([196, 200, 255]), np.array([84, 88, 204])
LINE_LIGHT, LINE_GOLD = np.array([255, 254, 248]), np.array([246, 214, 150])

def read_gradient():
    source = Image.open(os.path.join(HERE, "..", "icon_bg.png")).convert("RGB")
    width, height = source.size
    rows = np.array([source.getpixel((width // 2, y)) for y in range(height)], dtype=float)
    # The image has a white border around its rounded box: skip it, and a few rows of its soft edge.
    colored = np.nonzero(rows.sum(axis=1) < 690)[0]
    return rows[colored[0] + 6 : colored[-1] - 5]

# The drawing: dark lines on white. Scale it so that the shape has SHAPE_WIDTH, in the middle of the icon.
source = Image.open(os.path.join(HERE, "..", "icon_fg.png")).convert("RGBA")
pixels = np.asarray(source, float)
alpha = pixels[..., 3] / 255
gray = pixels[..., :3].mean(-1) * alpha + 255 * (1 - alpha)
lines = np.nonzero(gray < 160)
left, right, top, bottom = lines[1].min(), lines[1].max(), lines[0].min(), lines[0].max()
scale = SHAPE_WIDTH / (right - left)
shift_x, shift_y = N / 2 - (left + right) / 2 * scale, N / 2 - (top + bottom) / 2 * scale
gray_image = Image.fromarray(gray.astype(np.uint8)).transform((N, N), Image.AFFINE, (1 / scale, 0, -shift_x / scale, 0, 1 / scale, -shift_y / scale), resample=Image.BICUBIC, fillcolor=255)
drawn = np.asarray(gray_image, float) < 160

# Areas between the lines. The outside (it touches the border) and the small loops are background.
labels, count = ndimage.label(~drawn)
sizes = ndimage.sum(np.ones_like(labels), labels, index=np.arange(1, count + 1))
largest_fill = max(size for index, size in enumerate(sizes, 1) if labels[0, 0] != index)
kept = [index for index, size in enumerate(sizes, 1) if size > largest_fill * 0.01]
rope = [index for index in kept if index != labels[0, 0] and sizes[index - 1] > largest_fill * 0.15]

# Each pixel goes to its nearest area (smoothed): the lines lie in the middle between two areas.
_, (near_y, near_x) = ndimage.distance_transform_edt(~np.isin(labels, kept), return_indices=True)
nearest = labels[near_y, near_x]
weights = np.stack([ndimage.gaussian_filter((nearest == index).astype(float), SMOOTH) for index in kept])
area = np.array(kept)[weights.argmax(axis=0)]
boundary = np.zeros((N, N), bool)
boundary[:-1] |= area[:-1] != area[1:]
boundary[:, :-1] |= area[:, :-1] != area[:, 1:]
outline = ndimage.distance_transform_edt(~boundary) < LINE / 2
is_rope = np.isin(area, rope)

ys, xs = np.mgrid[0:N, 0:N].astype(float) + 0.5
diagonal = np.clip((xs + ys) / (2 * N), 0, 1)

def shade(distance, depth):
    """Light on a round rope: 0 (dark) to 1 (light). `distance`: from the edge, positive inside."""
    gy, gx = np.gradient(-distance)
    length = np.hypot(gx, gy) + 1e-9
    height = np.clip(distance / depth, 0, 1)
    side = np.sqrt(1 - height ** 2)
    normal = np.stack([gx / length * side, gy / length * side, height], axis=-1)
    with np.errstate(all="ignore"):
        return np.nan_to_num(np.clip(normal @ LIGHT, 0, 1))

def thin(mask):
    """The middle line of a shape, one pixel wide (Zhang–Suen thinning)."""
    image = np.pad(mask.astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            p = image
            n = [np.roll(np.roll(p, dy, 0), dx, 1) for dy, dx in ((1, 0), (1, -1), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1))]
            # Neighbours P2..P9 clockwise from the top: (y-1,x), (y-1,x+1), (y,x+1), (y+1,x+1), (y+1,x), (y+1,x-1), (y,x-1), (y-1,x-1).
            p2, p3, p4, p5, p6, p7, p8, p9 = n
            count = sum(n)
            ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            transitions = sum(((ring[i] == 0) & (ring[i + 1] == 1)).astype(np.uint8) for i in range(8))
            first = (p2 * p4 * p6 == 0) & (p4 * p6 * p8 == 0) if step == 0 else (p2 * p4 * p8 == 0) & (p2 * p6 * p8 == 0)
            remove = (p == 1) & (count >= 2) & (count <= 6) & (transitions == 1) & first
            if remove.any():
                image = np.where(remove, 0, image).astype(np.uint8)
                changed = True
        if not changed:
            return image[1:-1, 1:-1].astype(bool)

def along(skeleton):
    """Distance along the middle line from one of its ends (the farther pair of ends), for its pixels."""
    points = {tuple(point) for point in np.argwhere(skeleton)}
    near = lambda y, x: [(y + dy, x + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy or dx) and (y + dy, x + dx) in points]
    def walk(start):
        distance = {start: 0.0}
        queue = [start]
        for point in queue:
            for other in near(*point):
                step = distance[point] + (1.414 if other[0] != point[0] and other[1] != point[1] else 1.0)
                if other not in distance or step < distance[other]:
                    distance[other] = step
                    queue.append(other)
        return distance
    ends = [point for point in points if len(near(*point)) == 1] or [next(iter(points))]
    first = walk(ends[0])
    far = max(first, key=first.get)
    return walk(far)

def read_braid():
    """The braid tile of icon_pattern.png: its lines (0..1) and its inside (the strands and lines), only its width."""
    source = np.asarray(Image.open(os.path.join(HERE, "..", "icon_pattern.png")).convert("L"), float)
    ink = 1 - source / 255                      # the braid lines: 1 is black
    columns = np.nonzero(ink.max(axis=0) > 0.2)[0]
    ink = ink[:, columns[0] : columns[-1] + 1]
    # Sharp, like a vector drawing: 4 times larger, smooth, then a clean edge.
    ink = ndimage.zoom(ndimage.gaussian_filter(ink, 0.6), 4, order=3)
    ink = np.clip((ink - 0.38) * 8 + 0.5, 0, 1)
    # Outside: the light pixels that connect to the left or the right side of the tile.
    light_area, _ = ndimage.label(ink < 0.5)
    outside_labels = set(np.unique(light_area[:, 0])) | set(np.unique(light_area[:, -1]))
    outside_labels.discard(0)
    inside = ~np.isin(light_area, list(outside_labels))
    return ink, inside.astype(float)

def rope_frames():
    """For each rope part: a frame along the rope. u: across (−1 and 1 are its edges), v: along (pixels), the rope width."""
    small = 2                                   # the frame works at half size, then grows
    frames = []
    for index in rope:
        mask = area == index
        half = ndimage.binary_erosion(mask[::small, ::small], iterations=1)
        smooth = ndimage.gaussian_filter(half.astype(float), 3) > 0.5
        skeleton = thin(smooth)
        if skeleton.sum() < 10:
            continue
        distance_along = along(skeleton)
        width = ndimage.distance_transform_edt(smooth)
        v_line = np.zeros(skeleton.shape)
        known = np.zeros(skeleton.shape, bool)
        for (y, x), value in distance_along.items():
            v_line[y, x] = value
            known[y, x] = True
        # Each pixel: the nearest point of the middle line gives the place along the rope and the half width there.
        _, (ny, nx) = ndimage.distance_transform_edt(~known, return_indices=True)
        v = v_line[ny, nx]
        half_width = np.maximum(width[ny, nx], 1)
        yy, xx = np.mgrid[0 : skeleton.shape[0], 0 : skeleton.shape[1]]
        dy, dx = yy - ny, xx - nx
        # The side of the line: across the direction of the rope (the gradient of the place along it).
        gy, gx = np.gradient(ndimage.gaussian_filter(v, 2))
        side = np.sign(dx * gy - dy * gx)
        u = side * np.hypot(dy, dx) / half_width
        rope_width = 2 * small * np.median(width[known])
        # Smooth the frame (the nearest middle-line pixel steps), then grow it to full size: no stair steps.
        v = ndimage.gaussian_filter(v, 2.5)
        u = ndimage.gaussian_filter(u, 1.5)
        v_full = ndimage.zoom(v, small, order=1)[:N, :N] * small
        u_full = ndimage.zoom(u, small, order=1)[:N, :N]
        frames.append((index, mask, u_full, v_full, rope_width))
    return frames

def tile_coordinates(u, v, rope_width, tile_w, tile_h):
    return (v * tile_w / rope_width) % tile_h, (np.clip(u, -1, 1) + 1) / 2 * (tile_w - 1)

def with_pattern(image):
    """The braid along each rope: dark lines of icon_pattern.png, across the rope width and repeated along it."""
    ink, _ = read_braid()
    tile_h, tile_w = ink.shape
    darkness = np.zeros((N, N))
    for _, mask, u, v, rope_width in rope_frames():
        tile_y, tile_x = tile_coordinates(u, v, rope_width, tile_w, tile_h)
        sampled = np.zeros((N, N))
        sampled[mask] = ndimage.map_coordinates(ink, [tile_y[mask], tile_x[mask]], order=1, mode="grid-wrap")
        darkness = np.where(mask, np.maximum(darkness, ndimage.gaussian_filter(sampled, 0.6)), darkness)
    # The lines are a darker purple: like grooves between the strands of a braid.
    groove = np.array([62, 60, 150])
    strength = 0.75 * darkness[..., None]
    return image * (1 - strength) + groove * strength

def braid_image(background):
    """Each rope is the braid: its outer shape and its lines. Where a braid has a gap, the rope under it (or the
    background) shows. Flat colors: purple strands, white lines."""
    ink, inside = read_braid()
    tile_h, tile_w = ink.shape
    frames = rope_frames()
    covers, lines = [], []
    for _, mask, u, v, rope_width in frames:
        # Its own part, and (for the gaps of the braid on top) the other rope parts: never the background past its ends.
        near = mask | (ndimage.binary_dilation(mask, iterations=int(rope_width * 0.25)) & is_rope)
        tile_y, tile_x = tile_coordinates(u, v, rope_width, tile_w, tile_h)
        cover = np.zeros((N, N))
        line = np.zeros((N, N))
        where = near & (np.abs(u) <= 1.05)
        cover[where] = ndimage.map_coordinates(inside, [tile_y[where], tile_x[where]], order=1, mode="grid-wrap")
        line[where] = ndimage.map_coordinates(ink, [tile_y[where], tile_x[where]], order=1, mode="grid-wrap")
        covers.append(cover)
        lines.append(line)
    # The owner of a pixel: the part of the drawing there (it is on top), if its braid covers it; else another braid.
    owner = np.full((N, N), -1)
    for order, (index, mask, *_rest) in enumerate(frames):
        owner = np.where((owner == -1) & mask & (covers[order] > 0.5), order, owner)
    for order in range(len(frames)):
        owner = np.where((owner == -1) & (covers[order] > 0.5), order, owner)
    image = background.copy()
    purple = np.array([138, 146, 242], float)
    white = np.array([255, 255, 255], float)
    for order in range(len(frames)):
        mine = owner == order
        line = np.clip(ndimage.gaussian_filter(lines[order], 0.5) * 1.3, 0, 1)[..., None]
        color = purple * (1 - line) + white * line
        image = np.where(mine[..., None], color, image)
    # Soft edges: blend the outer shape a little.
    coverage = ndimage.gaussian_filter((owner >= 0).astype(float), 0.7)[..., None]
    hard = (owner >= 0)[..., None]
    return np.where(hard, image, background * (1 - coverage) + white * coverage)

# Background, with a soft shadow of the rope to the bottom right.
gradient = read_gradient()
m = 100 * U  # macOS icon grid: an 824 / 1024 rounded square
t = np.clip((ys[:, 0] - m) / (N - 2 * m), 0, 1)
positions = np.linspace(0, 1, len(gradient))
sky = np.stack([np.interp(t, positions, gradient[:, channel]) for channel in range(3)], axis=-1)
image = np.repeat(sky[:, None, :], N, axis=1)
body = is_rope | (outline & ndimage.binary_dilation(is_rope, iterations=int(LINE)))
shadow = Image.fromarray((body * 255).astype(np.uint8)).transform((N, N), Image.AFFINE, (1, 0, -10 * U, 0, 1, -14 * U)).filter(ImageFilter.GaussianBlur(16 * U))
image *= 1 - SHADOW * (np.asarray(shadow, float) / 255)[..., None]

if BRAID:
    flat = np.repeat(sky[:, None, :], N, axis=1)
    image = braid_image(flat)

# The rope: each area is shaded by its distance to its own edge.
light = np.zeros((N, N))
gleam = np.zeros((N, N))
light_2d = -np.array([1.0, 1.0]) / np.sqrt(2)  # toward the light (top left)
for index in rope:
    mask = area == index
    edge_distance = ndimage.distance_transform_edt(mask)
    # Smoothed: the raw distance has creases along the middle of the rope.
    distance = ndimage.gaussian_filter(edge_distance, 9 * U)
    lit = ROPE_SHADE * shade(distance, 60 * U) + (1 - ROPE_SHADE) * (1 - diagonal) if not HIGHLIGHT else 1 - ROPE_SHADE * (1 - shade(distance, 60 * U)) - 0.25 * diagonal
    light = np.where(mask, lit, light)
    if HIGHLIGHT:
        # A white rim on the edges of this part that face the light: strongest at the edge, gone after a few pixels.
        gy, gx = np.gradient(-ndimage.gaussian_filter(edge_distance, 2 * U))
        length = np.hypot(gx, gy) + 1e-9
        facing = np.clip((gx * light_2d[0] + gy * light_2d[1]) / length, 0, 1) ** 0.8
        rim = np.exp(-((edge_distance / (15 * U)) ** 1.5))
        gleam = np.where(mask, np.maximum(gleam, rim * np.clip(facing * 1.8, 0, 1)), gleam)
fill = FILL_DARK + (FILL_LIGHT - FILL_DARK) * np.clip(light, 0, 1)[..., None]
if not BRAID:
    image = np.where(is_rope[..., None], fill, image)
if PATTERN:
    image = with_pattern(image)
if HIGHLIGHT and not BRAID:
    image = image * (1 - gleam[..., None]) + np.array([255, 255, 255]) * gleam[..., None]

# The outline: on the rope, and on the edge of the rope against the background.
# White in the top left half, then warmer to gold at the bottom right.
line_light = np.clip(1.9 * (1 - diagonal) - 0.35, 0, 1)
line_color = LINE_GOLD + (LINE_LIGHT - LINE_GOLD) * line_light[..., None]
show_line = outline & (body | is_rope) & (not NO_OUTLINE) & (not BRAID)
soft = np.clip(ndimage.gaussian_filter(show_line.astype(float), 0.7 * U), 0, 1)[..., None]
image = image * (1 - soft) + line_color * soft

result = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8)).convert("RGBA")
square = Image.new("L", (N, N), 0)
ImageDraw.Draw(square).rounded_rectangle([m, m, N - m, N - m], radius=185 * U, fill=255)
result.putalpha(square)
size = int(ARGS[1]) if len(ARGS) > 1 else 1024
result.resize((size, size), Image.LANCZOS).save(ARGS[0])
