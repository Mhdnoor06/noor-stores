// Turn the Gemini render into clean app-icon assets.
// 1) trim the light presentation margin (also removes the corner watermark),
// 2) round the corners to transparent (kills the light corner triangles) WITHOUT
//    cropping/zooming, so the receipt keeps its original padding and never gets
//    clipped on splash screens or Android's circular maskable shape,
// 3) lay it on a solid brand-indigo tile → full-bleed, seamless edges.
import sharp from "sharp";
import path from "path";

const root = process.cwd();
const src = path.join(root, "Gemini_Generated_Image_9hdeve9hdeve9hde.png");
const outDir = path.join(root, "public", "icons");
const SIZE = 1024;

const trimmed = await sharp(src).trim({ threshold: 20 }).toBuffer();
const meta = await sharp(trimmed).metadata();
console.log("trimmed to", meta.width, "x", meta.height);

// Normalise to a square tile.
const sq = await sharp(trimmed).resize(SIZE, SIZE, { fit: "fill" }).toBuffer();

// Sample a straight-edge pixel for the tile background so the rounded corners
// fill with the body's own indigo (no visible seam).
const { data: px } = await sharp(sq)
  .extract({ left: 2, top: Math.round(SIZE / 2) - 1, width: 2, height: 2 })
  .raw()
  .toBuffer({ resolveWithObject: true });
const bg = { r: px[0], g: px[1], b: px[2], alpha: 1 };

// Round the corners generously (≥ the squircle's own radius) so no light remains;
// the rounded area is refilled with the indigo background, so it's invisible.
const r = Math.round(SIZE * 0.26);
const mask = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
);
const rounded = await sharp(sq).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();

const iconFull = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: bg } })
  .composite([{ input: rounded }])
  .flatten({ background: bg })
  .png()
  .toBuffer();

// Versioned filenames so caches / installed PWAs fetch the new icon instead of
// the previously-cached one. Bump the suffix again on any future icon change.
const targets = [
  ["icon-192.v2.png", 192],
  ["icon-512.v2.png", 512],
  ["icon-maskable-512.v2.png", 512],
  ["apple-touch-icon.v2.png", 180],
];
for (const [name, s] of targets) {
  await sharp(iconFull).resize(s, s).png().toFile(path.join(outDir, name));
  console.log("wrote", name, `${s}x${s}`);
}
