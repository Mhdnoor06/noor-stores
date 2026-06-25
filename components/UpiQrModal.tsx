"use client";

import { useState } from "react";
import { UpiQr } from "@/lib/types";
import { money } from "@/lib/escpos";
import { X } from "lucide-react";

// Full-screen QR display to turn toward the customer at payment time.
export default function UpiQrModal({
  open,
  onClose,
  qrs,
  amount,
}: {
  open: boolean;
  onClose: () => void;
  qrs: UpiQr[];
  amount: number;
}) {
  const [idx, setIdx] = useState(0);
  if (!open) return null;
  const active = qrs[Math.min(idx, qrs.length - 1)];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="text-sm font-bold text-ink">Scan to pay</span>
        <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas text-muted-dark hover:bg-line-soft">
          <X size={18} />
        </button>
      </div>

      {/* QR selector (when multiple) */}
      {qrs.length > 1 && (
        <div className="flex flex-wrap justify-center gap-2 px-4 py-3">
          {qrs.map((q, i) => (
            <button
              key={q.id}
              onClick={() => setIdx(i)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                i === idx ? "bg-brand text-white shadow-brand" : "border border-line-input bg-white text-muted-dark"
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6">
        {amount > 0 && (
          <p className="text-center text-lg font-semibold text-muted-dark">
            Pay <span className="text-2xl font-bold text-brand">{money(amount)}</span>
          </p>
        )}
        {active ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={active.image} alt={active.label} className="max-h-[60vh] w-auto max-w-[90vw] rounded-xl border border-line object-contain" />
            <p className="text-sm font-semibold text-ink">{active.label}</p>
          </>
        ) : (
          <p className="text-sm text-muted-light">No QR codes added. Add them in Settings.</p>
        )}
      </div>

      <div className="px-4 py-4">
        <button onClick={onClose} className="btn-ghost w-full">
          Done
        </button>
      </div>
    </div>
  );
}
