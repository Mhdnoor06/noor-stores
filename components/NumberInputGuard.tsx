"use client";

import { useEffect } from "react";

// Stops the mouse wheel from silently changing a focused number input — a
// frequent source of wrong amounts on a POS. We blur the field on wheel so the
// page still scrolls normally but the value is left untouched. Mounted once in
// the root layout, so it covers every number input in the app.
export default function NumberInputGuard() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement &&
        el.type === "number" &&
        el === e.target
      ) {
        el.blur();
      }
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
