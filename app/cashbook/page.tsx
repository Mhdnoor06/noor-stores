"use client";

import { useEffect, useMemo, useState } from "react";
import { getCashOutBetween, addExpense, getVendors, recordVendorPayment, deleteCashOut } from "@/lib/db";
import { CashOut, Vendor } from "@/lib/types";
import { money } from "@/lib/escpos";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import BillAttach, { BillThumb } from "@/components/BillAttach";
import { Wallet, Smartphone, CreditCard, Truck, Tag, Package, ChevronLeft, ChevronRight, Plus, X, Search, Trash2 } from "lucide-react";

type Method = "cash" | "upi" | "card";

// Local-day [start, end) in epoch ms for a given Date.
function dayBounds(d: Date): [number, number] {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return [start, start + 86400000];
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(d: Date): string {
  if (isSameDay(d, new Date())) return "Today";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

function timeLabel(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const CATEGORIES = ["Salesman payout", "Salary", "Rent", "Transport", "Electricity", "Misc", "Other"];

type OutKind = "expense" | "vendor";

export default function CashBookPage() {
  const [day, setDay] = useState<Date>(() => new Date());
  const [rows, setRows] = useState<CashOut[]>([]);
  const [loading, setLoading] = useState(true);
  // Add paid-out modal (expense OR vendor payment)
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState<OutKind>("expense");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [note, setNote] = useState("");
  const [bill, setBill] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // Vendor picker (for "Pay vendor")
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const toast = useToast();

  async function refresh(d: Date) {
    setLoading(true);
    try {
      const [start, end] = dayBounds(d);
      setRows(await getCashOutBetween(start, end));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load cash book.", "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  // Vendors load once, lazily on first modal open.
  useEffect(() => {
    if (addOpen && vendors.length === 0) {
      getVendors().then(setVendors).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOpen]);

  const vendorMatches = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    const list = q
      ? vendors.filter((v) => v.name.toLowerCase().includes(q) || (v.company || "").toLowerCase().includes(q))
      : [...vendors].sort((a, b) => b.balance - a.balance);
    return list.slice(0, 6);
  }, [vendors, vendorQuery]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);
  const byMethod = useMemo(() => {
    const m = { cash: 0, upi: 0, card: 0 };
    for (const r of rows) if (r.method) m[r.method] += r.amount;
    return m;
  }, [rows]);

  function shiftDay(delta: number) {
    const d = new Date(day);
    d.setDate(d.getDate() + delta);
    setDay(d);
  }

  async function deleteRow(r: CashOut) {
    if (r.kind === "purchase") {
      toast("This is a stock-in payment — delete it from the Stock In page.", "error");
      return;
    }
    const what = r.kind === "vendor" ? `payment to ${r.label}` : `${r.label} expense`;
    if (!window.confirm(`Delete this ${what} of ${money(r.amount)}?${r.kind === "vendor" ? " The vendor's payable will be restored." : ""}`)) return;
    try {
      await deleteCashOut(r);
      toast("Deleted.", "ok");
      await refresh(day);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete.", "error");
    }
  }

  function openAdd() {
    setKind("expense");
    setCategory(CATEGORIES[0]);
    setCustomCategory("");
    setAmount("");
    setNote("");
    setMethod("cash");
    setVendor(null);
    setVendorQuery("");
    setBill(undefined);
    setAddOpen(true);
  }

  async function submitOut() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      toast("Enter an amount.", "error");
      return;
    }
    if (kind === "vendor" && !vendor) {
      toast("Pick a vendor.", "error");
      return;
    }
    setBusy(true);
    try {
      if (kind === "vendor" && vendor) {
        await recordVendorPayment(vendor.id, amt, method, note.trim() || undefined, bill);
        toast(`Paid ${money(amt)} to ${vendor.name}.`, "ok");
      } else {
        const cat = category === "Other" ? customCategory.trim() || "Other" : category;
        await addExpense(cat, amt, method, note.trim() || undefined, bill);
        toast(`Recorded ${money(amt)} — ${cat}.`, "ok");
      }
      setAddOpen(false);
      // The new entry lands today; jump to today so it's visible.
      const today = new Date();
      if (isSameDay(day, today)) await refresh(day);
      else setDay(today);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to record.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <PageHeader title="Cash Book" subtitle="Everything paid out — vendor payments and expenses, in one place." />

      {/* day nav + total */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => shiftDay(-1)} className="flex h-9 w-9 items-center justify-center rounded-tile border border-line-input text-muted-dark hover:bg-canvas">
            <ChevronLeft size={18} />
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-ink">{dayLabel(day)}</p>
            <p className="eyebrow">Paid out</p>
            <p className="mt-0.5 text-2xl font-bold text-amber-deep">{money(total)}</p>
          </div>
          <button
            onClick={() => shiftDay(1)}
            disabled={isSameDay(day, new Date())}
            className="flex h-9 w-9 items-center justify-center rounded-tile border border-line-input text-muted-dark hover:bg-canvas disabled:opacity-40"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line-soft pt-3 text-center">
          {(["cash", "upi", "card"] as const).map((m) => (
            <div key={m}>
              <p className="text-[11px] uppercase tracking-wide text-muted-light">{m}</p>
              <p className="text-sm font-bold text-ink">{money(byMethod[m])}</p>
            </div>
          ))}
        </div>
      </div>

      <button onClick={openAdd} className="btn-primary w-full gap-1.5">
        <Plus size={16} /> Add paid-out
      </button>

      {/* list */}
      {loading ? (
        <div className="card p-10 text-center text-sm text-muted-light">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <Wallet size={26} className="text-line-input" />
          <p className="text-sm text-muted">Nothing paid out on this day.</p>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft overflow-hidden">
          {rows.map((r) => {
            const Icon = r.kind === "vendor" ? Truck : r.kind === "purchase" ? Package : Tag;
            return (
              <div key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                {r.billImage ? (
                  <BillThumb src={r.billImage} size={40} />
                ) : (
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-brand">
                    <Icon size={17} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{r.label}</p>
                  <p className="truncate text-[11.5px] text-muted-light">
                    {timeLabel(r.createdAt)}
                    {r.method ? ` · ${r.method.toUpperCase()}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <p className="flex-none text-sm font-bold text-amber-deep">−{money(r.amount)}</p>
                {r.kind !== "purchase" && (
                  <button onClick={() => deleteRow(r)} title="Delete" className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-muted-light hover:bg-canvas hover:text-danger">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* add paid-out modal — expense OR vendor payment */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => !busy && setAddOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-pop sm:max-w-sm sm:rounded-card sm:pb-5">
            <div className="flex items-center justify-between">
              <p className="text-base font-bold text-ink">Record paid-out</p>
              <button onClick={() => !busy && setAddOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>

            {/* kind toggle */}
            <div className="flex gap-1.5 rounded-tile border border-line-input bg-white p-1">
              {(
                [
                  ["expense", "Expense"],
                  ["vendor", "Pay vendor"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`flex-1 rounded-[7px] py-2 text-sm font-semibold transition ${
                    kind === k ? "bg-brand text-white shadow-brand" : "text-muted-dark hover:bg-canvas"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-2.5">
              {kind === "expense" ? (
                <>
                  <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {category === "Other" && (
                    <input
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      placeholder="Enter category"
                      className="input"
                      autoFocus
                    />
                  )}
                </>
              ) : vendor ? (
                <div className="flex items-center justify-between rounded-tile border border-line-input px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{vendor.name}</p>
                    <p className="text-[11px] text-muted-light">
                      {vendor.balance > 0 ? `${money(vendor.balance)} payable` : "no balance"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {vendor.balance > 0 && (
                      <button onClick={() => setAmount(String(vendor.balance))} className="btn-ghost h-9 px-2.5 text-xs">
                        Full
                      </button>
                    )}
                    <button onClick={() => setVendor(null)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="relative">
                    <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
                    <input value={vendorQuery} onChange={(e) => setVendorQuery(e.target.value)} placeholder="Search vendor…" className="input pl-10" autoFocus />
                  </div>
                  <div className="mt-2 space-y-1">
                    {vendorMatches.length === 0 ? (
                      <p className="px-1 py-2 text-xs text-muted-light">No vendors. Add one from the Vendors page first.</p>
                    ) : (
                      vendorMatches.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => {
                            setVendor(v);
                            setAmount(v.balance > 0 ? String(v.balance) : "");
                          }}
                          className="flex w-full items-center gap-2 rounded-tile border border-line-soft px-3 py-2 text-left text-sm hover:bg-canvas"
                        >
                          <Truck size={14} className="text-muted-light" />
                          <span className="flex-1 truncate">{v.name}</span>
                          {v.balance > 0 && <span className="text-[11px] text-amber-deep">{money(v.balance)}</span>}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-1.5 rounded-tile border border-line-input bg-white p-1">
                {([["cash", Wallet], ["upi", Smartphone], ["card", CreditCard]] as const).map(([m, Icon]) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] py-2 text-sm font-semibold capitalize transition ${
                      method === m ? "bg-brand text-white shadow-brand" : "text-muted-dark hover:bg-canvas"
                    }`}
                  >
                    <Icon size={15} /> {m}
                  </button>
                ))}
              </div>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="input text-right font-bold"
              />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="input" />
              <BillAttach value={bill} onChange={setBill} />
            </div>

            <button onClick={submitOut} disabled={busy} className="btn-primary w-full">
              {busy ? "Saving…" : kind === "vendor" ? "Record payment" : "Record expense"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
