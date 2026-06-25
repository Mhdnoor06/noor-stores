"use client";

import { useEffect, useState } from "react";
import { getBills, getSettings } from "@/lib/db";
import { Bill } from "@/lib/types";
import { buildReceipt, money } from "@/lib/escpos";
import { useBluetooth } from "@/components/PrinterProvider";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import { Printer } from "lucide-react";
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
  const [open, setOpen] = useState<string | null>(null);
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
                  <p className="truncate text-xs text-muted-light">
                    {fmt(b.createdAt)} · {paySummary(b)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-ink">{money(b.total)}</p>
                  {(b.credit ?? 0) > 0 ? (
                    <span className="pill bg-amber-soft text-amber-deep">Udhaar</span>
                  ) : (
                    <p className="text-xs text-muted-light">{b.lines.length} items</p>
                  )}
                </div>
              </button>

              {open === b.id && (
                <div className="border-t border-line-soft bg-canvas px-4 py-3">
                  <div className="space-y-1.5">
                    {b.lines.map((l) => (
                      <div key={l.itemId} className="flex justify-between text-sm">
                        <span className="text-muted-dark">
                          {l.name}{" "}
                          <span className="text-muted-light">{qtyLabel(l.qty, l.unit)}</span>
                        </span>
                        <span className="font-medium text-ink">
                          {money(l.price * l.qty)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {(b.discount ?? 0) > 0 && (
                    <div className="mt-2 space-y-1 border-t border-dashed border-line pt-2 text-sm">
                      <div className="flex justify-between text-muted">
                        <span>Subtotal</span>
                        <span>{money(b.subtotal ?? b.total + (b.discount ?? 0))}</span>
                      </div>
                      <div className="flex justify-between text-muted">
                        <span>Discount</span>
                        <span>-{money(b.discount ?? 0)}</span>
                      </div>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t border-dashed border-line pt-2">
                    <span className="font-bold">Total</span>
                    <span className="font-bold text-brand">{money(b.total)}</span>
                  </div>

                  {/* payment breakdown */}
                  <div className="mt-2 space-y-1 border-t border-dashed border-line pt-2 text-sm">
                    {(b.payment?.cash ?? 0) + (b.changeGiven ?? 0) > 0 && (
                      <PayLine label="Cash" value={money((b.payment?.cash ?? 0) + (b.changeGiven ?? 0))} />
                    )}
                    {(b.payment?.upi ?? 0) > 0 && <PayLine label="UPI" value={money(b.payment!.upi)} />}
                    {(b.payment?.card ?? 0) > 0 && <PayLine label="Card" value={money(b.payment!.card)} />}
                    {(b.changeGiven ?? 0) > 0 && <PayLine label="Change returned" value={money(b.changeGiven!)} />}
                    {(b.credit ?? 0) > 0 && (
                      <div className="flex justify-between font-semibold text-amber-deep">
                        <span>Balance (Udhaar){b.customerName ? ` · ${b.customerName}` : ""}</span>
                        <span>{money(b.credit!)}</span>
                      </div>
                    )}
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

function PayLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted">
      <span>{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
