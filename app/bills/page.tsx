"use client";

import { useEffect, useState } from "react";
import { getBills, getSettings } from "@/lib/db";
import { Bill } from "@/lib/types";
import { buildReceipt, money } from "@/lib/escpos";
import { useBluetooth } from "@/components/PrinterProvider";
import PageHeader from "@/components/PageHeader";
import { Printer } from "lucide-react";

function fmt(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const { isConnected, print, connect, supported, status } = useBluetooth();

  useEffect(() => {
    getBills().then(setBills).catch(() => setBills([]));
  }, []);

  async function reprint(bill: Bill) {
    setMsg("");
    if (!isConnected) {
      setMsg("Printer not connected — connect first.");
      return;
    }
    setBusyId(bill.id);
    try {
      await print(buildReceipt(bill, await getSettings()));
      setMsg(`Reprinted bill #${bill.number}`);
    } catch (err: unknown) {
      setMsg(`${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bills"
        subtitle="View and reprint past bills."
        action={
          !isConnected && supported ? (
            <button
              onClick={() => connect()}
              disabled={status === "connecting"}
              className="btn-soft"
            >
              {status === "connecting" ? "Connecting…" : "Connect printer"}
            </button>
          ) : undefined
        }
      />

      {msg && (
        <div className="rounded-[10px] bg-ink px-3.5 py-2.5 text-sm font-medium text-white animate-pop">
          {msg}
        </div>
      )}

      {bills.length === 0 ? (
        <div className="card border-dashed p-10 text-center text-sm text-muted-light">
          No bills yet.
        </div>
      ) : (
        <div className="space-y-2.5">
          {bills.map((b) => (
            <div key={b.id} className="card overflow-hidden">
              <button
                onClick={() => setOpen(open === b.id ? null : b.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-canvas"
              >
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-xs font-bold text-brand">
                  #{b.number}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {b.customerName || `Bill #${b.number}`}
                  </p>
                  <p className="text-xs text-muted-light">{fmt(b.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-ink">{money(b.total)}</p>
                  <p className="text-xs text-muted-light">{b.lines.length} items</p>
                </div>
              </button>

              {open === b.id && (
                <div className="border-t border-line-soft bg-canvas px-4 py-3">
                  <div className="space-y-1.5">
                    {b.lines.map((l) => (
                      <div key={l.itemId} className="flex justify-between text-sm">
                        <span className="text-muted-dark">
                          {l.name} <span className="text-muted-light">×{l.qty}</span>
                        </span>
                        <span className="font-medium text-ink">
                          {money(l.price * l.qty)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center justify-between border-t border-dashed border-line pt-2">
                    <span className="font-bold">Total</span>
                    <span className="font-bold text-brand">{money(b.total)}</span>
                  </div>
                  <button
                    onClick={() => reprint(b)}
                    disabled={busyId === b.id}
                    className="btn-primary mt-3 h-10 w-full sm:w-auto"
                  >
                    <Printer size={16} />
                    {busyId === b.id ? "Printing…" : "Reprint"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
