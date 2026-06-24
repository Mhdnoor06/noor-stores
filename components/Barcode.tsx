"use client";

import { useEffect, useRef, useState } from "react";
import JsBarcodeImport from "jsbarcode";
import { isValidEan13 } from "@/lib/barcode";

// jsbarcode is CommonJS (`module.exports = JsBarcode`); resolve both interop shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const JsBarcode: any = (JsBarcodeImport as any)?.default ?? JsBarcodeImport;

// Renders a barcode onto a <canvas> (most reliable jsbarcode target). EAN-13
// when the value is a valid EAN-13, else CODE128. Falls back to showing the
// raw number if rendering isn't possible.
export default function Barcode({
  value,
  height = 46,
  width = 1.8,
  fontSize = 13,
  className,
}: {
  value: string;
  height?: number;
  width?: number;
  fontSize?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !value || typeof JsBarcode !== "function") {
      setFailed(true);
      return;
    }
    const opts = {
      height,
      width,
      fontSize,
      margin: 6,
      displayValue: true,
      background: "#ffffff",
      lineColor: "#111111",
    };
    try {
      JsBarcode(el, value, { ...opts, format: isValidEan13(value) ? "EAN13" : "CODE128" });
      setFailed(false);
    } catch {
      try {
        JsBarcode(el, value, { ...opts, format: "CODE128" });
        setFailed(false);
      } catch {
        setFailed(true);
      }
    }
  }, [value, height, width, fontSize]);

  return (
    <span className={className}>
      <canvas ref={ref} className={failed ? "hidden" : "max-w-full"} />
      {failed && <span className="font-mono text-xs text-ink">{value}</span>}
    </span>
  );
}
