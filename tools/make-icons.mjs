// Draws the Ts Menu app icon (a cream bowl with steam on terracotta) as PNGs.
// No dependencies: shapes are tested per pixel with 4×4 supersampling, then zlib'd.
// Run: node tools/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'icons');
mkdirSync(out, { recursive: true });

const TERRA = [192, 96, 63], CREAM = [251, 245, 234], OLIVE = [113, 125, 69], MUSTARD = [232, 182, 84];

// Returns the color at (x, y) in 0..1 space, painter's order (last match wins).
function colorAt(x, y) {
  let c = TERRA;
  // steam: three wavy strokes
  for (const cx of [0.38, 0.5, 0.62]) {
    if (y > 0.2 && y < 0.43) {
      const wx = cx + 0.028 * Math.sin((y - 0.2) * Math.PI * 7 + cx * 9);
      const taper = 0.024 * (1 - Math.abs(y - 0.315) / 0.16);
      if (Math.abs(x - wx) < Math.max(0.012, taper)) c = MUSTARD;
    }
  }
  // bowl: half disc + rim + foot
  const r = Math.hypot(x - 0.5, y - 0.5);
  if (y >= 0.5 && r <= 0.31) c = CREAM;
  if (y >= 0.475 && y <= 0.53 && x >= 0.16 && x <= 0.84) c = CREAM;
  if (y >= 0.79 && y <= 0.84 && x >= 0.4 && x <= 0.6) c = CREAM;
  // olive stripe across the bowl
  if (y >= 0.6 && y <= 0.64 && r <= 0.305) c = OLIVE;
  return c;
}

function png(size) {
  const S = 4;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const c = colorAt((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size);
        r += c[0]; g += c[1]; b += c[2];
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = r / (S * S); raw[o + 1] = g / (S * S); raw[o + 2] = b / (S * S);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(out, name), png(size));
  console.log('wrote docs/icons/' + name);
}
