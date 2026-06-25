"use client";

import { useEffect, useMemo, useState } from "react";
import { getCustomers, getCreditLedger, recordRepayment } from "@/lib/db";
import { Customer, CreditEntry } from "@/lib/types";
import { money } from "@/lib/escpos";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import { HandCoins, Search, X, Wallet, Smartphone, CreditCard, Phone } from "lucide-react";

type Method = "cash" | "upi" | "card";

function fmt(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function UdhaarPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<CreditEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function refresh() {
    try {
      setCustomers(await getCustomers());
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load customers.", "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalOutstanding = useMemo(() => customers.reduce((s, c) => s + Math.max(0, c.balance), 0), [customers]);
  const withDues = useMemo(() => customers.filter((c) => c.balance > 0).length, [customers]);

  const filtered = customers.filter(
    (c) => c.name.toLowerCase().includes(query.toLowerCase()) || (c.phone || "").includes(query.trim())
  );

  async function openCustomer(c: Customer) {
    setSelected(c);
    setAmount(c.balance > 0 ? String(c.balance) : "");
    setMethod("cash");
    setLoadingLedger(true);
    try {
      setLedger(await getCreditLedger(c.id));
    } catch {
      setLedger([]);
    } finally {
      setLoadingLedger(false);
    }
  }
  function closeDetail() {
    setSelected(null);
    setLedger([]);
  }

  async function submitRepay() {
    if (!selected) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      toast("Enter a repayment amount.", "error");
      return;
    }
    setBusy(true);
    try {
      await recordRepayment(selected.id, amt, method);
      toast(`Received ${money(amt)} from ${selected.name}.`, "ok");
      await refresh();
      const updated = await getCustomers();
      const fresh = updated.find((c) => c.id === selected.id) || null;
      setCustomers(updated);
      if (fresh) await openCustomer(fresh);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to record payment.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Udhaar" subtitle="Customer credit — who owes you, and recording repayments." />

      {/* summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="eyebrow">Total outstanding</p>
          <p className="mt-1 text-2xl font-bold text-amber-deep">{money(totalOutstanding)}</p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Customers with dues</p>
          <p className="mt-1 text-2xl font-bold text-ink">{withDues}</p>
        </div>
      </div>

      {/* search */}
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} className="input pl-10" placeholder="Search by name or phone…" />
      </div>

      {/* list */}
      {loading ? (
        <div className="card p-10 text-center text-sm text-muted-light">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <HandCoins size={26} className="text-line-input" />
          <p className="text-sm text-muted">
            {customers.length === 0 ? "No credit customers yet. Balances appear here when a bill is left partly unpaid." : "No matches."}
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-line-soft overflow-hidden">
          {filtered.map((c) => {
            const owes = c.balance > 0;
            return (
              <div
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => openCustomer(c)}
                onKeyDown={(e) => e.key === "Enter" && openCustomer(c)}
                className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left hover:bg-canvas"
              >
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-sm font-bold text-brand">
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                  {c.phone && <p className="truncate text-[11.5px] text-muted-light">{c.phone}</p>}
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${owes ? "text-amber-deep" : "text-ok"}`}>{owes ? money(c.balance) : "Settled"}</p>
                  {owes && <p className="text-[10.5px] text-muted-light">outstanding</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* detail slide-over */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={closeDetail}>
          <div onClick={(e) => e.stopPropagation()} className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-pop">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-ink">{selected.name}</p>
                {selected.phone && (
                  <a href={`tel:${selected.phone}`} className="flex items-center gap-1 text-xs text-brand">
                    <Phone size={12} /> {selected.phone}
                  </a>
                )}
              </div>
              <button onClick={closeDetail} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-auto px-5 py-5">
              {/* balance + repay */}
              <div className="card space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Outstanding</span>
                  <span className={`text-xl font-bold ${selected.balance > 0 ? "text-amber-deep" : "text-ok"}`}>
                    {money(Math.max(0, selected.balance))}
                  </span>
                </div>
                {selected.balance > 0 && (
                  <>
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
                    <div className="flex items-center gap-2">
                      <input
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="Amount"
                        className="input flex-1 text-right font-bold"
                      />
                      <button onClick={() => setAmount(String(selected.balance))} className="btn-ghost h-11 flex-none px-3 text-xs">
                        Full
                      </button>
                    </div>
                    <button onClick={submitRepay} disabled={busy} className="btn-primary w-full">
                      {busy ? "Saving…" : "Record payment"}
                    </button>
                  </>
                )}
              </div>

              {/* ledger */}
              <div>
                <span className="eyebrow">History</span>
                {loadingLedger ? (
                  <p className="mt-2 text-sm text-muted-light">Loading…</p>
                ) : ledger.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-light">No entries.</p>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {ledger.map((e) => {
                      const repay = e.amount < 0;
                      return (
                        <div key={e.id} className="flex items-center justify-between rounded-tile border border-line-soft px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {repay ? `Repayment${e.method ? ` · ${e.method.toUpperCase()}` : ""}` : e.note || "Udhaar"}
                            </p>
                            <p className="text-[11px] text-muted-light">{fmt(e.createdAt)}</p>
                          </div>
                          <span className={`flex-none font-bold ${repay ? "text-ok" : "text-amber-deep"}`}>
                            {repay ? "−" : "+"}
                            {money(Math.abs(e.amount))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
