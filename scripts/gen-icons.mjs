// One-off: turn the Gemini render into clean app-icon assets.
// 1) trim the light presentation margin (also removes the corner watermark),
// 2) crop just inside the squircle so every edge is solid indigo (full-bleed),
// 3) emit the PWA / Apple icon sizes.
import sharp from "sharp";
import path from "path";

const root = process.cwd();
const src = path.join(root, "Gemini_Generated_Image_9hdeve9hdeve9hde.png");
const outDir = path.join(root, "public", "icons");

const trimmed = await sharp(src).trim({ threshold: 20 }).toBuffer();
const meta = await sharp(trimmed).metadata();
console.log("trimmed to", meta.width, "x", meta.height);

// Inset ~13% past the rounded corners → pure indigo edges, symbol stays centered.
const side = Math.min(meta.width, meta.height);
const size = Math.round(side * 0.74);
const left = Math.round((meta.width - size) / 2);
const top = Math.round((meta.height - size) / 2);
const body = await sharp(trimmed).extract({ left, top, width: size, height: size }).toBuffer();

// Full-bleed icons (OS adds its own corner rounding / circle mask). The symbol
// is centred with plenty of indigo around it, so it sits inside the maskable
// safe zone without a flat-colour pad (which would seam against the gradient).
const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];
for (const [name, s] of targets) {
  await sharp(body).resize(s, s, { fit: "cover" }).png().toFile(path.join(outDir, name));
  console.log("wrote", name, `${s}x${s}`);
}
