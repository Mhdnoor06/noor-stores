"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getBillsBetween, getRepaymentsBetween, getCashOutBetween, getSettings } from "@/lib/db";
import { Bill, CreditEntry, CashOut } from "@/lib/types";
import { money, buildDaySummary } from "@/lib/escpos";
import { useBluetooth } from "@/components/PrinterProvider";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import { ChevronLeft, ChevronRight, Printer, Wallet, Smartphone, CreditCard } from "lucide-react";

const pad = (x: number) => String(x).padStart(2, "0");
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function dayRange(dateStr: string): [number, number] {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  return [start, start + 24 * 60 * 60 * 1000];
}
function shiftDay(dateStr: string, days: number): string {
  const [start] = dayRange(dateStr);
  const d = new Date(start + days * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function prettyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export default function ReportPage() {
  const [date, setDate] = useState(todayStr());
  const [bills, setBills] = useState<Bill[]>([]);
  const [repays, setRepays] = useState<CreditEntry[]>([]);
  const [cashOut, setCashOut] = useState<CashOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { isConnected, print, connect, supported, status } = useBluetooth();
  const toast = useToast();

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const [start, end] = dayRange(d);
      const [b, r, c] = await Promise.all([
        getBillsBetween(start, end),
        getRepaymentsBetween(start, end),
        getCashOutBetween(start, end),
      ]);
      setBills(b);
      setRepays(r);
      setCashOut(c);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load report.", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const s = useMemo(() => {
    const sum = (f: (b: Bill) => number) => bills.reduce((a, b) => a + f(b), 0);
    const repayBy = (m: string) =>
      repays.filter((e) => (e.method ?? "cash") === m).reduce((a, e) => a + Math.abs(e.amount), 0);
    return {
      billCount: bills.length,
      salesTotal: sum((b) => b.total),
      cashSales: sum((b) => b.payment?.cash ?? 0),
      upiSales: sum((b) => b.payment?.upi ?? 0),
      cardSales: sum((b) => b.payment?.card ?? 0),
      creditGiven: sum((b) => b.credit ?? 0),
      discountTotal: sum((b) => b.discount ?? 0),
      repayCash: repayBy("cash"),
      repayUpi: repayBy("upi"),
      repayCard: repayBy("card"),
    };
  }, [bills, repays]);

  const cashIn = s.cashSales + s.repayCash;
  const upiIn = s.upiSales + s.repayUpi;
  const cardIn = s.cardSales + s.repayCard;
  const totalCollected = cashIn + upiIn + cardIn;
  const creditCollected = s.repayCash + s.repayUpi + s.repayCard;

  const paidOut = useMemo(() => {
    const by = (m: string) => cashOut.filter((c) => (c.method ?? "cash") === m).reduce((a, c) => a + c.amount, 0);
    const cash = by("cash"), upi = by("upi"), card = by("card");
    return { cash, upi, card, total: cash + upi + card };
  }, [cashOut]);
  const netCashDrawer = cashIn - paidOut.cash;
  const isToday = date === todayStr();

  async function printSummary() {
    if (!isConnected) {
      toast("Printer not connected — connect first.", "error");
      return;
    }
    setBusy(true);
    try {
      const settings = await getSettings();
      await print(buildDaySummary({ dateLabel: prettyDate(date), ...s }, settings));
      toast("Day close printed.", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Print failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <PageHeader
        title="Day Close"
        subtitle="Daily sales summary and cash reconciliation."
        action={
          !isConnected && supported ? (
            <button onClick={() => connect()} disabled={status === "connecting"} className="btn-soft">
              {status === "connecting" ? "Connecting…" : "Connect printer"}
            </button>
          ) : (
            <button onClick={printSummary} disabled={busy} className="btn-ghost">
              <Printer size={16} /> {busy ? "Printing…" : "Print summary"}
            </button>
          )
        }
      />

      {/* date picker */}
      <div className="flex items-center gap-2">
        <button onClick={() => setDate((d) => shiftDay(d, -1))} className="btn-ghost h-11 flex-none px-3" aria-label="Previous day">
          <ChevronLeft size={18} />
        </button>
        <div className="relative flex-1">
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value || todayStr())}
            className="input text-center font-semibold"
          />
        </div>
        <button
          onClick={() => setDate((d) => shiftDay(d, 1))}
          disabled={isToday}
          className="btn-ghost h-11 flex-none px-3 disabled:opacity-40"
          aria-label="Next day"
        >
          <ChevronRight size={18} />
        </button>
        {!isToday && (
          <button onClick={() => setDate(todayStr())} className="btn-ghost h-11 flex-none px-3 text-xs">
            Today
          </button>
        )}
      </div>
      <p className="-mt-2 text-center text-xs text-muted-light">{prettyDate(date)}</p>

      {loading ? (
        <div className="card p-10 text-center text-sm text-muted-light">Loading…</div>
      ) : (
        <>
          {/* headline tiles */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4">
              <p className="eyebrow">Total sales</p>
              <p className="mt-1 text-2xl font-bold text-brand">{money(s.salesTotal)}</p>
            </div>
            <div className="card p-4">
              <p className="eyebrow">Bills</p>
              <p className="mt-1 text-2xl font-bold text-ink">{s.billCount}</p>
            </div>
          </div>

          {/* collected */}
          <div className="card divide-y divide-line-soft overflow-hidden">
            <div className="px-4 py-3">
              <span className="eyebrow">Money collected</span>
            </div>
            <CollectRow Icon={Wallet} label="Cash" amount={cashIn} sales={s.cashSales} repay={s.repayCash} />
            <CollectRow Icon={Smartphone} label="UPI" amount={upiIn} sales={s.upiSales} repay={s.repayUpi} />
            <CollectRow Icon={CreditCard} label="Card" amount={cardIn} sales={s.cardSales} repay={s.repayCard} />
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-bold text-ink">Total in hand</span>
              <span className="text-lg font-bold text-ok">{money(totalCollected)}</span>
            </div>
          </div>

          {/* udhaar */}
          <div className="card space-y-2 p-4">
            <span className="eyebrow">Udhaar (credit)</span>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Given today</span>
              <span className="font-bold text-amber-deep">{money(s.creditGiven)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Collected today</span>
              <span className="font-bold text-ok">{money(creditCollected)}</span>
            </div>
          </div>

          {/* paid out */}
          <div className="card divide-y divide-line-soft overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="eyebrow">Paid out (purchases, vendors, expenses)</span>
              <span className="text-sm font-bold text-amber-deep">{money(paidOut.total)}</span>
            </div>
            <div className="grid grid-cols-3 divide-x divide-line-soft">
              {([["Cash", paidOut.cash], ["UPI", paidOut.upi], ["Card", paidOut.card]] as const).map(([label, amt]) => (
                <div key={label} className="px-3 py-2.5 text-center">
                  <p className="text-[11px] uppercase tracking-wide text-muted-light">{label}</p>
                  <p className="text-sm font-bold text-ink">{money(amt)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* net cash in drawer */}
          <div className="card flex items-center justify-between p-4">
            <div>
              <span className="text-sm font-bold text-ink">Net cash in drawer</span>
              <p className="text-[11px] text-muted-light">cash in − cash paid out</p>
            </div>
            <span className={`text-lg font-bold ${netCashDrawer < 0 ? "text-danger" : "text-ok"}`}>{money(netCashDrawer)}</span>
          </div>

          {s.discountTotal > 0 && (
            <p className="text-center text-xs text-muted-light">Discounts given today: {money(s.discountTotal)}</p>
          )}
        </>
      )}
    </div>
  );
}

function CollectRow({
  Icon,
  label,
  amount,
  sales,
  repay,
}: {
  Icon: typeof Wallet;
  label: string;
  amount: number;
  sales: number;
  repay: number;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-tile bg-brand-soft text-brand">
        <Icon size={16} />
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-ink">{label}</p>
        {repay > 0 && (
          <p className="text-[11px] text-muted-light">
            {money(sales)} sales + {money(repay)} udhaar
          </p>
        )}
      </div>
      <span className="text-sm font-bold text-ink">{money(amount)}</span>
    </div>
  );
}
