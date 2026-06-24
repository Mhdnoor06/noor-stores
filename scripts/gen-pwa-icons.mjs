// Generates PWA icons from a vector "N" monogram on the brand indigo.
// Run with: node scripts/gen-pwa-icons.mjs
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "icons");

const BRAND = "#4338ca";

// "NS" wordmark on the brand indigo. `fontRatio` is the glyph size relative
// to the canvas (smaller for the maskable variant so "NS" stays inside the
// circular/squircle safe zone the OS masks to).
function svg({ size = 512, rounded = true, fontRatio = 0.46 } = {}) {
  const r = rounded ? Math.round(size * 0.22) : 0;
  const fontSize = size * fontRatio;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BRAND}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
    font-family="Arial, Helvetica, sans-serif" font-weight="800"
    font-size="${fontSize}" fill="#ffffff" letter-spacing="${size * 0.005}">NS</text>
</svg>`;
}

async function png(svgStr, size, file) {
  const buf = await sharp(Buffer.from(svgStr)).resize(size, size).png().toBuffer();
  await writeFile(join(OUT, file), buf);
  console.log("wrote", file);
}

await mkdir(OUT, { recursive: true });

// Standard icons (rounded square).
await png(svg({ size: 192 }), 192, "icon-192.png");
await png(svg({ size: 512 }), 512, "icon-512.png");

// Maskable: full-bleed square with a smaller mark so it survives Android's
// circle/squircle masks (safe zone is the inner ~80%).
await png(svg({ size: 512, rounded: false, fontRatio: 0.34 }), 512, "icon-maskable-512.png");

// Apple touch icon (iOS does not round it, so keep the rounded look).
await png(svg({ size: 180 }), 180, "apple-touch-icon.png");

console.log("done");
