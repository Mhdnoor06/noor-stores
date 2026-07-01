"use client";

import { useEffect, useMemo, useState } from "react";
import { getBills, getSettings, uid, nextBillNumber, saveReturnBill } from "@/lib/db";
import { Bill, BillLine } from "@/lib/types";
import { buildReceipt, money } from "@/lib/escpos";
import { useBluetooth } from "@/components/PrinterProvider";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import { Printer, ReceiptText, X, RotateCcw, Minus, Plus } from "lucide-react";
import { isMeasured, qtyLabel } from "@/lib/units";

function fmt(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

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

  // Return state
  const [returnOf, setReturnOf] = useState<Bill | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({});
  const [refundMethod, setRefundMethod] = useState<"cash" | "upi" | "card" | "udhaar">("cash");
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    getBills().then(setBills).catch(() => setBills([]));
  }, []);

  // Map from bill id → bill number, used to show "↩ Return of #X" labels.
  const billNumberById = useMemo(
    () => new Map(bills.map((b) => [b.id, b.number])),
    [bills]
  );

  const returnTotal = useMemo(
    () =>
      returnOf
        ? Math.round(
            returnOf.lines.reduce(
              (s, l) => s + l.price * (returnQtys[l.itemId] ?? 0),
              0
            ) * 100
          ) / 100
        : 0,
    [returnOf, returnQtys]
  );

  function openReturn(bill: Bill) {
    const qtys: Record<string, number> = {};
    bill.lines.forEach((l) => (qtys[l.itemId] = 0));
    setReturnQtys(qtys);
    setRefundMethod("cash");
    setReturnOf(bill);
  }

  function setReturnQty(itemId: string, val: number, max: number) {
    setReturnQtys((q) => ({ ...q, [itemId]: Math.min(max, Math.max(0, val)) }));
  }

  function selectAll() {
    if (!returnOf) return;
    const qtys: Record<string, number> = {};
    returnOf.lines.forEach((l) => (qtys[l.itemId] = l.qty));
    setReturnQtys(qtys);
  }

  async function handleConfirmReturn() {
    if (!returnOf || returnTotal <= 0) return;
    setReturning(true);
    try {
      const retLines: BillLine[] = returnOf.lines
        .filter((l) => (returnQtys[l.itemId] ?? 0) > 0)
        .map((l) => ({ ...l, qty: returnQtys[l.itemId]! }));

      const payment =
        refundMethod === "udhaar"
          ? { cash: 0, upi: 0, card: 0 }
          : {
              cash: refundMethod === "cash" ? returnTotal : 0,
              upi: refundMethod === "upi" ? returnTotal : 0,
              card: refundMethod === "card" ? returnTotal : 0,
            };

      const rb: Bill = {
        id: uid(),
        number: await nextBillNumber(),
        createdAt: Date.now(),
        customerName: returnOf.customerName,
        customerPhone: returnOf.customerPhone,
        customerId: returnOf.customerId,
        lines: retLines,
        total: returnTotal,
        subtotal: returnTotal,
        payment,
        billType: "return",
        returnOfBillId: returnOf.id,
      };

      const stockLines = retLines.map((l) => ({
        itemId: l.itemId,
        qty: l.qty * (l.baseQty ?? 1),
      }));

      await saveReturnBill(rb, stockLines, refundMethod);
      toast(`Returned ${money(returnTotal)} from Bill #${returnOf.number}`, "ok");
      setReturnOf(null);
      setOpenBill(null);
      setBills(await getBills());
    } catch (err) {
      toast(err instanceof Error ? err.message : "Return failed.", "error");
    } finally {
      setReturning(false);
    }
  }

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
        subtitle="View, reprint and return past bills."
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
          {bills.map((b) => {
            const isReturn = b.billType === "return";
            const origNum = isReturn && b.returnOfBillId
              ? billNumberById.get(b.returnOfBillId)
              : undefined;
            return (
              <button
                key={b.id}
                onClick={() => setOpenBill(b)}
                className="card flex items-center gap-3 p-3.5 text-left transition hover:border-brand/40 hover:bg-canvas"
              >
                <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-tile text-xs font-bold ${isReturn ? "bg-amber-soft text-amber-deep" : "bg-brand-soft text-brand"}`}>
                  {isReturn ? <RotateCcw size={16} /> : `#${b.number}`}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {isReturn
                      ? `Return${origNum ? ` of #${origNum}` : ""}`
                      : (b.customerName || `Bill #${b.number}`)}
                  </p>
                  <p className="truncate text-xs text-muted-light">
                    {fmt(b.createdAt)} · {isReturn ? `Refund · #${b.number}` : paySummary(b)}
                  </p>
                </div>
                <div className="flex-none text-right">
                  <p className={`font-bold ${isReturn ? "text-amber-deep" : "text-ink"}`}>
                    {isReturn ? `−${money(b.total)}` : money(b.total)}
                  </p>
                  {isReturn ? (
                    <span className="pill bg-amber-soft text-amber-deep">Return</span>
                  ) : (b.credit ?? 0) > 0 ? (
                    <span className="pill bg-amber-soft text-amber-deep">Udhaar</span>
                  ) : (
                    <p className="text-xs text-muted-light">{b.lines.length} items</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* bill detail slide-over */}
      {openBill && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={() => setOpenBill(null)}>
          <div onClick={(e) => e.stopPropagation()} className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-ink">
                  {openBill.billType === "return"
                    ? `Return${openBill.returnOfBillId && billNumberById.get(openBill.returnOfBillId) ? ` of Bill #${billNumberById.get(openBill.returnOfBillId)}` : ""}`
                    : (openBill.customerName || `Bill #${openBill.number}`)}
                </p>
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
                <span className="font-bold">{openBill.billType === "return" ? "Refund" : "Total"}</span>
                <span className={`font-bold ${openBill.billType === "return" ? "text-amber-deep" : "text-brand"}`}>
                  {openBill.billType === "return" ? `−${money(openBill.total)}` : money(openBill.total)}
                </span>
              </div>

              <div className="mt-2 space-y-1 border-t border-dashed border-line pt-2 text-sm">
                {(openBill.payment?.cash ?? 0) + (openBill.changeGiven ?? 0) > 0 && (
                  <PayLine label={openBill.billType === "return" ? "Cash refunded" : "Cash"} value={money((openBill.payment?.cash ?? 0) + (openBill.changeGiven ?? 0))} />
                )}
                {(openBill.payment?.upi ?? 0) > 0 && <PayLine label={openBill.billType === "return" ? "UPI refunded" : "UPI"} value={money(openBill.payment!.upi)} />}
                {(openBill.payment?.card ?? 0) > 0 && <PayLine label={openBill.billType === "return" ? "Card refunded" : "Card"} value={money(openBill.payment!.card)} />}
                {(openBill.changeGiven ?? 0) > 0 && <PayLine label="Change returned" value={money(openBill.changeGiven!)} />}
                {(openBill.credit ?? 0) > 0 && (
                  <div className="flex justify-between font-semibold text-amber-deep">
                    <span>Balance (Udhaar){openBill.customerName ? ` · ${openBill.customerName}` : ""}</span>
                    <span>{money(openBill.credit!)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 border-t border-line px-5 py-4">
              {openBill.billType !== "return" && (
                <button
                  onClick={() => { setOpenBill(null); openReturn(openBill); }}
                  className="btn-ghost flex-1 text-amber-deep hover:bg-amber-soft"
                >
                  <RotateCcw size={16} /> Return
                </button>
              )}
              <button
                onClick={() => reprint(openBill)}
                disabled={busyId === openBill.id}
                className="btn-primary flex-1"
              >
                <Printer size={16} />
                {busyId === openBill.id ? "Printing…" : "Reprint"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return modal */}
      {returnOf && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => setReturnOf(null)}>
          <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-md flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl">
            {/* header */}
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="text-base font-bold text-ink">Return items</p>
                <p className="text-xs text-muted-light">From Bill #{returnOf.number}{returnOf.customerName ? ` · ${returnOf.customerName}` : ""}</p>
              </div>
              <button onClick={() => setReturnOf(null)} className="flex h-8 w-8 flex-none items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>

            {/* item list */}
            <div className="max-h-[45vh] overflow-auto px-5 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-light">Set quantity to return for each item</p>
                <button onClick={selectAll} className="text-xs font-semibold text-brand hover:underline">
                  Select all
                </button>
              </div>
              {returnOf.lines.map((l) => {
                const retQty = returnQtys[l.itemId] ?? 0;
                const measured = isMeasured(l.unit);
                const step = measured ? 0.001 : 1;
                return (
                  <div key={l.itemId} className="flex items-center gap-3 border-t border-line-soft py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
                      <p className="text-xs text-muted-light">
                        {qtyLabel(l.qty, l.unit)} · {money(l.price)} / {l.unit || "pcs"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setReturnQty(l.itemId, retQty - step, l.qty)}
                        className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line-input text-muted-dark hover:bg-canvas"
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={l.qty}
                        step={step}
                        value={retQty || ""}
                        placeholder="0"
                        onChange={(e) => setReturnQty(l.itemId, parseFloat(e.target.value) || 0, l.qty)}
                        className="h-8 w-12 rounded-[9px] border border-line-input bg-white px-1 text-center text-sm font-bold outline-none focus:border-brand"
                      />
                      <button
                        onClick={() => setReturnQty(l.itemId, retQty + step, l.qty)}
                        className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line-input text-muted-dark hover:bg-canvas"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* refund method + total */}
            <div className="space-y-3 border-t border-line px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Refund amount</span>
                <span className="text-lg font-bold text-amber-deep">{money(returnTotal)}</span>
              </div>

              <div className="space-y-1.5">
                <p className="text-xs text-muted-light">Refund via</p>
                <div className="grid grid-cols-2 gap-2">
                  {(["cash", "upi", "card"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setRefundMethod(m)}
                      className={`rounded-tile border py-2 text-sm font-semibold capitalize transition ${
                        refundMethod === m
                          ? "border-brand bg-brand text-white"
                          : "border-line-input bg-white text-muted-dark hover:border-brand hover:text-brand"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                  {returnOf.customerId && (
                    <button
                      onClick={() => setRefundMethod("udhaar")}
                      className={`rounded-tile border py-2 text-sm font-semibold transition ${
                        refundMethod === "udhaar"
                          ? "border-brand bg-brand text-white"
                          : "border-line-input bg-white text-muted-dark hover:border-brand hover:text-brand"
                      }`}
                    >
                      Reduce udhaar
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={() => setReturnOf(null)} className="btn-ghost flex-1">
                  Cancel
                </button>
                <button
                  onClick={handleConfirmReturn}
                  disabled={returnTotal <= 0 || returning}
                  className="btn-primary flex-1"
                >
                  <RotateCcw size={16} />
                  {returning ? "Processing…" : `Confirm return`}
                </button>
              </div>
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
