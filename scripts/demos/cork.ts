// An original cork board picture for the demo vault "Small white dogs" (no photo, no copyright): cork granules in a
// light pine frame with mitered corners, and a soft shadow where the cork meets the frame. Writes a PNG; the demo
// uses a JPEG copy of it (scripts/demos/dogs/cork-board.jpg; macOS: sips -s format jpeg).
//
//   npx rolldown scripts/demos/cork.ts --platform node --format esm -o <scratch>/cork.mjs && node <scratch>/cork.mjs <out.png>

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 2400;
const H = 1700;
const FRAME = 70;

let seed = 2024;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

/** Smooth value noise (a grid of random values, bilinear with smoothstep), 0..1. */
function valueNoise(cell: number): (x: number, y: number) => number {
  const cols = Math.ceil(W / cell) + 2;
  const rows = Math.ceil(H / cell) + 2;
  const grid = Float32Array.from({ length: cols * rows }, random);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / cell;
    const gy = y / cell;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = smooth(gx - x0);
    const ty = smooth(gy - y0);
    // The grid wraps (any x and y give a value).
    const at = (cx: number, cy: number) => grid[(((cy % rows) + rows) % rows) * cols + (((cx % cols) + cols) % cols)]!;
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

const rgb = new Float32Array(W * H * 3);
const set = (x: number, y: number, r: number, g: number, b: number) => {
  const at = (y * W + x) * 3;
  rgb[at] = r;
  rgb[at + 1] = g;
  rgb[at + 2] = b;
};

// Cork: a warm brown base, broad patches, then many granules (lighter and darker specks of 1 to 5 px).
const broad = valueNoise(160);
const middle = valueNoise(28);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const shade = 0.9 + 0.1 * broad(x, y) + 0.08 * (middle(x, y) - 0.5) + (random() - 0.5) * 0.06;
    set(x, y, 206 * shade, 158 * shade, 104 * shade);
  }
}
for (let count = 0; count < (W * H) / 16; count += 1) {
  const cx = random() * W;
  const cy = random() * H;
  const radius = 0.6 + random() ** 3 * 2.4;
  const kind = random();
  // Dark pores, light chips, and a few reddish granules.
  const tint: [number, number, number] = kind < 0.4 ? [0.74, 0.68, 0.62] : kind < 0.9 ? [1.1, 1.09, 1.06] : [0.98, 0.86, 0.76];
  for (let y = Math.floor(cy - radius); y <= cy + radius; y += 1) {
    for (let x = Math.floor(cx - radius); x <= cx + radius; x += 1) {
      if (x < 0 || y < 0 || x >= W || y >= H || (x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      const at = (y * W + x) * 3;
      rgb[at] *= tint[0];
      rgb[at + 1] *= tint[1];
      rgb[at + 2] *= tint[2];
    }
  }
}

// The frame: light pine with grain along each side, mitered corners, a bevel, and a shadow on the cork.
const grain = valueNoise(9);
const knots = valueNoise(220);
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const left = x;
    const right = W - 1 - x;
    const top = y;
    const bottom = H - 1 - y;
    const edge = Math.min(left, right, top, bottom);
    if (edge >= FRAME) {
      // A soft shadow on the cork along the inner edge of the frame.
      const inside = edge - FRAME;
      if (inside < 26) {
        const dark = 1 - 0.38 * (1 - inside / 26) ** 2;
        const at = (y * W + x) * 3;
        rgb[at] *= dark;
        rgb[at + 1] *= dark;
        rgb[at + 2] *= dark;
      }
      continue;
    }
    // The side of the frame (mitered at the corners): the grain runs along it.
    const horizontal = Math.min(top, bottom) < Math.min(left, right);
    const along = horizontal ? x : y;
    const across = horizontal ? y : x;
    const lines = 0.5 + 0.5 * Math.sin(across * 0.9 + grain(along * 0.15, across * 3) * 9 + knots(along, across) * 6);
    const shade = 0.9 + 0.08 * lines + (random() - 0.5) * 0.03;
    // Bevel: lighter at the outer edge, darker at the inner edge.
    const bevel = 1.06 - 0.16 * (edge / FRAME);
    const tone = shade * bevel;
    set(x, y, 232 * tone, 196 * tone, 146 * tone);
    // A thin line where the two sides meet at a corner.
    if (Math.abs(Math.min(top, bottom) - Math.min(left, right)) < 1) set(x, y, 170, 136, 92);
  }
}

// PNG (RGB, 8 bit).
const rows: Buffer[] = [];
for (let y = 0; y < H; y += 1) {
  const row = Buffer.alloc(1 + W * 3);
  for (let x = 0; x < W * 3; x += 1) row[1 + x] = Math.max(0, Math.min(255, Math.round(rgb[y * W * 3 + x]!)));
  rows.push(row);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
};
const header = Buffer.alloc(13);
header.writeUInt32BE(W, 0);
header.writeUInt32BE(H, 4);
header[8] = 8;
header[9] = 2;
writeFileSync(process.argv[2] ?? "cork-board.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
