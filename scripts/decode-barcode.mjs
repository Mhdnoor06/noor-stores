// Decodes a barcode from a static image using the SAME ZXing engine + hints the
// app uses. This isolates "can ZXing read this barcode?" from camera quality.
//
// Usage: node scripts/decode-barcode.mjs <path-to-image>
import sharp from "sharp";
import zxing from "@zxing/library";
const {
  MultiFormatReader,
  BarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
} = zxing;

const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];

const hints = new Map();
hints.set(DecodeHintType.TRY_HARDER, true);
hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);

async function rawLuminance(pipeline) {
  const { data, info } = await pipeline
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lum[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return { lum, width, height };
}

function decode(lum, width, height, label) {
  const source = new RGBLuminanceSource(lum, width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  const reader = new MultiFormatReader();
  reader.setHints(hints);
  try {
    const result = reader.decode(bitmap, hints);
    const fmt = result.getBarcodeFormat?.();
    console.log(`  ✅ [${label}] ${width}x${height} -> format#${fmt} "${result.getText()}"`);
    return result.getText();
  } catch {
    console.log(`  ✗ [${label}] ${width}x${height} no read`);
    return null;
  }
}

const path = process.argv[2];
if (!path) {
  console.error("Pass an image path: node scripts/decode-barcode.mjs <image>");
  process.exit(1);
}

const meta = await sharp(path).metadata();
console.log(`Image: ${path} (${meta.width}x${meta.height}, ${meta.format})\n`);

const variants = [
  ["original", sharp(path)],
  ["grayscale", sharp(path).greyscale()],
  ["gray+normalize", sharp(path).greyscale().normalize()],
  ["gray+sharpen", sharp(path).greyscale().sharpen()],
  ["upscaled 1400w", sharp(path).resize({ width: 1400 }).greyscale().normalize()],
];

let found = null;
for (const [label, pipeline] of variants) {
  const { lum, width, height } = await rawLuminance(pipeline);
  found = decode(lum, width, height, label);
  if (found) break;
}

console.log("");
console.log(found ? `RESULT: decoded -> ${found}` : "RESULT: NOT decoded by ZXing.");
