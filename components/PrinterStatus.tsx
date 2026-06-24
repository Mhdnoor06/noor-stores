"use client";

import { useBluetooth } from "./PrinterProvider";

const MAP: Record<string, { label: string; cls: string; dot: string }> = {
  idle: { label: "Printer off", cls: "bg-canvas text-muted-dark", dot: "bg-muted-light" },
  connecting: { label: "Connecting", cls: "bg-amber-soft text-amber-deep", dot: "bg-amber" },
  connected: { label: "Connected", cls: "bg-ok-soft text-ok", dot: "bg-ok" },
  printing: { label: "Printing", cls: "bg-brand-soft text-brand", dot: "bg-brand" },
  error: { label: "Error", cls: "bg-danger-soft text-danger", dot: "bg-danger" },
};

export default function PrinterStatus({ compact = false }: { compact?: boolean }) {
  const { status, connect, disconnect, isConnected } = useBluetooth();
  const s = MAP[status];

  return (
    <div className="flex items-center gap-2">
      <span className={`pill ${s.cls}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
        {s.label}
      </span>
      {!compact &&
        (isConnected ? (
          <button
            onClick={disconnect}
            className="text-xs font-medium text-muted-light hover:text-muted-dark"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={() => connect()}
            disabled={status === "connecting"}
            className="rounded-tile bg-brand px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            Connect
          </button>
        ))}
    </div>
  );
}
