"use client";

import { useRef, useState } from "react";
import { compressImage } from "@/lib/image";
import { Paperclip, X, Loader2 } from "lucide-react";

// Full-screen image viewer used by both the editor and the read-only thumb.
function Viewer({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Bill" className="max-h-full max-w-full rounded-card object-contain" />
      <button onClick={onClose} className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink">
        <X size={18} />
      </button>
    </div>
  );
}

// Attach / preview / remove control for an optional bill photo. Stores the photo
// as a compressed data URL via onChange.
export default function BillAttach({
  value,
  onChange,
  label = "Attach bill",
}: {
  value?: string;
  onChange: (v?: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setBusy(true);
    try {
      onChange(await compressImage(file));
    } catch {
      onChange(undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onPick} className="hidden" />
      {value ? (
        <div className="flex items-center gap-2.5 rounded-tile border border-line-input p-2">
          <button onClick={() => setView(true)} className="flex-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="Bill" className="h-12 w-12 rounded-md border border-line-soft object-cover" />
          </button>
          <span className="flex-1 text-xs text-muted">Bill attached</span>
          <button onClick={() => onChange(undefined)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas hover:text-danger">
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-tile border border-dashed border-line-input py-2.5 text-sm font-semibold text-muted-dark hover:bg-canvas disabled:opacity-60"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
          {busy ? "Compressing…" : label}
        </button>
      )}
      {view && value && <Viewer src={value} onClose={() => setView(false)} />}
    </div>
  );
}

// Small read-only thumbnail for list rows; tap to view full-screen.
export function BillThumb({ src, size = 32 }: { src: string; size?: number }) {
  const [view, setView] = useState(false);
  return (
    <>
      <button onClick={() => setView(true)} className="flex-none" title="View bill">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Bill" style={{ height: size, width: size }} className="rounded-md border border-line-soft object-cover" />
      </button>
      {view && <Viewer src={src} onClose={() => setView(false)} />}
    </>
  );
}
