"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

type Tone = "ok" | "error" | "info";
type ToastItem = { id: number; msg: string; tone: Tone };

const ToastCtx = createContext<(msg: string, tone?: Tone) => void>(() => {});

/** Show a transient toast: `toast("Added Parle-G", "ok")`. */
export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => setItems((s) => s.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (msg: string, tone: Tone = "info") => {
      const id = ++idRef.current;
      setItems((s) => [...s.slice(-2), { id, msg, tone }]);
      window.setTimeout(() => remove(id), tone === "error" ? 4000 : 2400);
    },
    [remove]
  );

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex flex-col items-center gap-2 px-4 print:hidden">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const tone = item.tone;
  const Icon = tone === "ok" ? CheckCircle2 : tone === "error" ? AlertCircle : Info;
  const color =
    tone === "ok"
      ? "bg-ok text-white"
      : tone === "error"
      ? "bg-danger text-white"
      : "bg-ink text-white";
  return (
    <div
      className={`pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-semibold shadow-pop animate-pop ${color}`}
    >
      <Icon size={17} className="flex-none" />
      <span className="min-w-0 break-words">{item.msg}</span>
      <button onClick={onClose} className="ml-1 flex-none opacity-70 hover:opacity-100" aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}
