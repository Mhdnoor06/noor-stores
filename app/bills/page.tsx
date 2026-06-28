"use client";

import { useEffect, useState } from "react";
import { getBills, getSettings } from "@/lib/db";
import { Bill } from "@/lib/types";
import { buildReceipt, money } from "@/lib/escpos";
import { useBluetooth } from "@/components/PrinterProvider";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import { Printer, ReceiptText, X } from "lucide-react";
import { qtyLabel } from "@/lib/units";

function fmt(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

// Compact "Cash+UPI · Udhaar ₹300" summary for the collapsed row.
function paySummary(b: Bill): string {
  const parts: string[] = [];
  if (b.payment?.cash) parts.push("Cash");
  if (b.payment?.upi) parts.push("UPI");
  if (b.payment?.card) parts.push("Card");
  let s = parts.join("+");
  if ((b.credit ?? 0) > 0) s = s ? `${s} · Udhaar ${money(b.credit!)}` : `Udhaar ${money(b.credit!)}`;
  return s || "—";
}

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [openBill, setOpenBill] = useState<Bill | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { isConnected, print, connect, supported, status } = useBluetooth();
  const toast = useToast();

  useEffect(() => {
    getBills().then(setBills).catch(() => setBills([]));
  }, []);

  async function reprint(bill: Bill) {
    if (!isConnected) {
      toast("Printer not connected — connect first.", "error");
      return;
    }
    setBusyId(bill.id);
    try {
      await print(buildReceipt(bill, await getSettings()));
      toast(`Reprinted bill #${bill.number}`, "ok");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
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

      {bills.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <ReceiptText size={26} className="text-line-input" />
          <p className="text-sm text-muted">No bills yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {bills.map((b) => (
            <button
              key={b.id}
              onClick={() => setOpenBill(b)}
              className="card flex items-center gap-3 p-3.5 text-left transition hover:border-brand/40 hover:bg-canvas"
            >
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-xs font-bold text-brand">
                #{b.number}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {b.customerName || `Bill #${b.number}`}
                </p>
                <p className="truncate text-xs text-muted-light">
                  {fmt(b.createdAt)} · {paySummary(b)}
                </p>
              </div>
              <div className="flex-none text-right">
                <p className="font-bold text-ink">{money(b.total)}</p>
                {(b.credit ?? 0) > 0 ? (
                  <span className="pill bg-amber-soft text-amber-deep">Udhaar</span>
                ) : (
                  <p className="text-xs text-muted-light">{b.lines.length} items</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* bill detail slide-over */}
      {openBill && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={() => setOpenBill(null)}>
          <div onClick={(e) => e.stopPropagation()} className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-ink">{openBill.customerName || `Bill #${openBill.number}`}</p>
                <p className="truncate text-xs text-muted-light">#{openBill.number} · {fmt(openBill.createdAt)}</p>
              </div>
              <button onClick={() => setOpenBill(null)} className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-auto px-5 py-5">
              <div className="space-y-1.5">
                {openBill.lines.map((l) => (
                  <div key={l.itemId} className="flex justify-between text-sm">
                    <span className="text-muted-dark">
                      {l.name} <span className="text-muted-light">{qtyLabel(l.qty, l.unit)}</span>
                    </span>
                    <span className="font-medium text-ink">{money(l.price * l.qty)}</span>
                  </div>
                ))}
              </div>
              {(openBill.discount ?? 0) > 0 && (
                <div className="mt-2 space-y-1 border-t border-dashed border-line pt-2 text-sm">
                  <div className="flex justify-between text-muted">
                    <span>Subtotal</span>
                    <span>{money(openBill.subtotal ?? openBill.total + (openBill.discount ?? 0))}</span>
                  </div>
                  <div className="flex justify-between text-muted">
                    <span>Discount</span>
                    <span>-{money(openBill.discount ?? 0)}</span>
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between border-t border-dashed border-line pt-2">
                <span className="font-bold">Total</span>
                <span className="font-bold text-brand">{money(openBill.total)}</span>
              </div>

              {/* payment breakdown */}
              <div className="mt-2 space-y-1 border-t border-dashed border-line pt-2 text-sm">
                {(openBill.payment?.cash ?? 0) + (openBill.changeGiven ?? 0) > 0 && (
                  <PayLine label="Cash" value={money((openBill.payment?.cash ?? 0) + (openBill.changeGiven ?? 0))} />
                )}
                {(openBill.payment?.upi ?? 0) > 0 && <PayLine label="UPI" value={money(openBill.payment!.upi)} />}
                {(openBill.payment?.card ?? 0) > 0 && <PayLine label="Card" value={money(openBill.payment!.card)} />}
                {(openBill.changeGiven ?? 0) > 0 && <PayLine label="Change returned" value={money(openBill.changeGiven!)} />}
                {(openBill.credit ?? 0) > 0 && (
                  <div className="flex justify-between font-semibold text-amber-deep">
                    <span>Balance (Udhaar){openBill.customerName ? ` · ${openBill.customerName}` : ""}</span>
                    <span>{money(openBill.credit!)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-line px-5 py-4">
              <button
                onClick={() => reprint(openBill)}
                disabled={busyId === openBill.id}
                className="btn-primary h-11 w-full"
              >
                <Printer size={16} />
                {busyId === openBill.id ? "Printing…" : "Reprint"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PayLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
