import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";

// Retail 1D formats + TRY_HARDER so ZXing works harder per image.
export const HINTS = new Map<DecodeHintType, unknown>([
  [DecodeHintType.TRY_HARDER, true],
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
    ],
  ],
]);

// Decodes a barcode from a photo File (the phone's native camera capture).
// Returns the barcode string, or null if nothing readable was found.
export async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    return await decodeRobust(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Tries the photo as-is, then several grayscale + contrast enhanced versions.
// Real shots (glare, soft focus, faint print) often fail the plain pass but
// succeed once contrast-boosted.
async function decodeRobust(url: string): Promise<string | null> {
  const img = await loadImage(url);
  const reader = new BrowserMultiFormatReader(HINTS);

  try {
    return (await reader.decodeFromImageElement(img)).getText();
  } catch {
    /* try enhanced variants below */
  }

  // Each pass = a target width (the engine often reads better at a different
  // scale) + a contrast/grayscale boost. Crucially we also *upscale* small
  // shots to ~1500px — budget phones in low-res mode produce images ZXing can't
  // read at native size but decode fine once enlarged.
  const variants = [
    { targetW: 1500, filter: "grayscale(1) contrast(1.6)" },
    { targetW: 1200, filter: "grayscale(1) contrast(2)" },
    { targetW: 2000, filter: "grayscale(1) contrast(1.4) brightness(1.05)" },
    { targetW: 1800, filter: "grayscale(1) contrast(2.2)" },
    { targetW: 900, filter: "grayscale(1) contrast(2.4)" },
  ];
  for (const v of variants) {
    const canvas = drawToCanvas(img, v.targetW, v.filter);
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      /* next variant */
    }
  }
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

// Scales the image to `targetW` (up or down, preserving aspect, capped to keep
// the canvas sane) and applies a CSS filter while drawing.
function drawToCanvas(
  img: HTMLImageElement,
  targetW: number,
  filter: string
): HTMLCanvasElement {
  const base = img.naturalWidth || targetW;
  const w = Math.min(2400, Math.max(1, Math.round(targetW)));
  const h = Math.round((img.naturalHeight / base) * w);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.filter = filter;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
  }
  return canvas;
}
