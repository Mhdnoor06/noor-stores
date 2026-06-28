"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getVendors,
  getVendorLedger,
  recordVendorPayment,
  recordVendorCharge,
  addVendor,
  deleteVendorEntry,
} from "@/lib/db";
import { Vendor, VendorEntry } from "@/lib/types";
import { money } from "@/lib/escpos";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import BillAttach, { BillThumb } from "@/components/BillAttach";
import { Truck, Search, X, Wallet, Smartphone, CreditCard, Phone, UserPlus, Trash2, Package } from "lucide-react";

type Method = "cash" | "upi" | "card";
type Mode = "pay" | "charge";

function fmt(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [ledger, setLedger] = useState<VendorEntry[]>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [mode, setMode] = useState<Mode>("pay");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [note, setNote] = useState("");
  const [bill, setBill] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  // Add-vendor modal
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addCompany, setAddCompany] = useState("");
  const [addOwed, setAddOwed] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const toast = useToast();

  async function refresh() {
    try {
      setVendors(await getVendors());
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load vendors.", "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalPayable = useMemo(() => vendors.reduce((s, v) => s + Math.max(0, v.balance), 0), [vendors]);
  const withDues = useMemo(() => vendors.filter((v) => v.balance > 0).length, [vendors]);

  const filtered = vendors.filter(
    (v) =>
      v.name.toLowerCase().includes(query.toLowerCase()) ||
      (v.company || "").toLowerCase().includes(query.toLowerCase()) ||
      (v.phone || "").includes(query.trim())
  );

  // Existing vendors matching the name being typed in the Add modal.
  const addNameMatches = useMemo(() => {
    const q = addName.trim().toLowerCase();
    if (q.length < 2) return [];
    return vendors.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 4);
  }, [vendors, addName]);

  async function openVendor(v: Vendor) {
    setSelected(v);
    setMode("pay");
    setAmount(v.balance > 0 ? String(v.balance) : "");
    setMethod("cash");
    setNote("");
    setBill(undefined);
    setLoadingLedger(true);
    try {
      setLedger(await getVendorLedger(v.id));
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

  async function reload(selectedId?: string) {
    const updated = await getVendors();
    setVendors(updated);
    if (selectedId) {
      const fresh = updated.find((v) => v.id === selectedId) || null;
      if (fresh) await openVendor(fresh);
    }
  }

  async function submitAction() {
    if (!selected) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      toast(mode === "pay" ? "Enter a payment amount." : "Enter an amount owed.", "error");
      return;
    }
    setBusy(true);
    try {
      if (mode === "pay") {
        await recordVendorPayment(selected.id, amt, method, undefined, bill);
        toast(`Paid ${money(amt)} to ${selected.name}.`, "ok");
      } else {
        await recordVendorCharge(selected.id, amt, note.trim() || undefined, bill);
        toast(`Added ${money(amt)} payable for ${selected.name}.`, "ok");
      }
      await reload(selected.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(e: VendorEntry) {
    const kindLabel = e.amount < 0 ? "payment" : "payable";
    if (!window.confirm(`Delete this ${kindLabel} of ${money(Math.abs(e.amount))}? The vendor's balance will be adjusted back.`)) return;
    try {
      await deleteVendorEntry(e);
      toast("Entry deleted.", "ok");
      if (selected) await reload(selected.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete.", "error");
    }
  }

  async function submitAdd() {
    const name = addName.trim();
    if (!name) {
      toast("Enter a vendor name.", "error");
      return;
    }
    // Don't create a second record for a vendor that already exists — open the
    // existing one so the amount stacks onto their balance instead.
    const dupe = vendors.find((v) => v.name.trim().toLowerCase() === name.toLowerCase());
    if (dupe) {
      setAddOpen(false);
      toast(`${dupe.name} already exists — opening their account.`, "ok");
      await openVendor(dupe);
      return;
    }
    const opening = parseFloat(addOwed);
    setAddBusy(true);
    try {
      const v = await addVendor(name, addPhone.trim() || undefined, { company: addCompany.trim() || undefined });
      if (!isNaN(opening) && opening > 0) {
        await recordVendorCharge(v.id, opening, "Opening balance");
      }
      toast(`Added ${name}.`, "ok");
      setAddOpen(false);
      setAddName("");
      setAddPhone("");
      setAddCompany("");
      setAddOwed("");
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to add vendor.", "error");
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader title="Vendors" subtitle="Suppliers you buy from — what you owe, and recording payments." />

      {/* summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <p className="eyebrow">Total payable</p>
          <p className="mt-1 text-2xl font-bold text-amber-deep">{money(totalPayable)}</p>
        </div>
        <div className="card p-4">
          <p className="eyebrow">Vendors to pay</p>
          <p className="mt-1 text-2xl font-bold text-ink">{withDues}</p>
        </div>
      </div>

      {/* search + add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="input pl-10" placeholder="Search name, company or phone…" />
        </div>
        <button onClick={() => setAddOpen(true)} className="btn-primary flex-none gap-1.5 px-3.5">
          <UserPlus size={16} /> Add
        </button>
      </div>

      {/* list */}
      {loading ? (
        <div className="card p-10 text-center text-sm text-muted-light">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <Truck size={26} className="text-line-input" />
          <p className="text-sm text-muted">
            {vendors.length === 0 ? "No vendors yet. Add one, or they appear here when you record a stock-in on credit." : "No matches."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {filtered.map((v) => {
            const owes = v.balance > 0;
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => openVendor(v)}
                onKeyDown={(e) => e.key === "Enter" && openVendor(v)}
                className="card flex cursor-pointer items-center gap-3 p-3.5 text-left transition hover:border-brand/40 hover:bg-canvas"
              >
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-sm font-bold text-brand">
                  {v.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{v.name}</p>
                  <p className="truncate text-[11.5px] text-muted-light">{v.company || v.phone || "—"}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${owes ? "text-amber-deep" : v.balance < 0 ? "text-brand" : "text-ok"}`}>
                    {owes ? money(v.balance) : v.balance < 0 ? money(-v.balance) : "Settled"}
                  </p>
                  <p className="text-[10.5px] text-muted-light">{owes ? "to pay" : v.balance < 0 ? "advance" : ""}</p>
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
                {selected.phone ? (
                  <a href={`tel:${selected.phone}`} className="flex items-center gap-1 text-xs text-brand">
                    <Phone size={12} /> {selected.phone}
                  </a>
                ) : selected.company ? (
                  <p className="truncate text-xs text-muted-light">{selected.company}</p>
                ) : null}
              </div>
              <button onClick={closeDetail} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-auto px-5 py-5">
              {/* balance + action */}
              <div className="card space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">Payable</span>
                  <span className={`text-xl font-bold ${selected.balance > 0 ? "text-amber-deep" : "text-ok"}`}>
                    {money(Math.max(0, selected.balance))}
                  </span>
                </div>

                {/* mode toggle: pay vendor vs add payable */}
                <div className="flex gap-1.5 rounded-tile border border-line-input bg-white p-1">
                  {(
                    [
                      ["pay", "Pay vendor"],
                      ["charge", "Add payable"],
                    ] as const
                  ).map(([m, label]) => (
                    <button
                      key={m}
                      onClick={() => {
                        setMode(m);
                        setAmount(m === "pay" && selected.balance > 0 ? String(selected.balance) : "");
                      }}
                      className={`flex-1 rounded-[7px] py-2 text-sm font-semibold transition ${
                        mode === m ? "bg-brand text-white shadow-brand" : "text-muted-dark hover:bg-canvas"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {mode === "pay" && (
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
                )}

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
                  {mode === "pay" && selected.balance > 0 && (
                    <button onClick={() => setAmount(String(selected.balance))} className="btn-ghost h-11 flex-none px-3 text-xs">
                      Full
                    </button>
                  )}
                </div>

                {mode === "charge" && (
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="input" />
                )}

                <BillAttach value={bill} onChange={setBill} />

                <button onClick={submitAction} disabled={busy} className="btn-primary w-full">
                  {busy ? "Saving…" : mode === "pay" ? "Record payment" : "Add payable"}
                </button>
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
                      const paid = e.amount < 0;
                      return (
                        <div key={e.id} className="flex items-center gap-2.5 rounded-tile border border-line-soft px-3 py-2 text-sm">
                          {e.billImage && <BillThumb src={e.billImage} size={34} />}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink">
                              {paid ? `Payment${e.method ? ` · ${e.method.toUpperCase()}` : ""}` : e.note || "Payable"}
                            </p>
                            <p className="text-[11px] text-muted-light">{fmt(e.createdAt)}</p>
                          </div>
                          <span className={`flex-none font-bold ${paid ? "text-ok" : "text-amber-deep"}`}>
                            {paid ? "−" : "+"}
                            {money(Math.abs(e.amount))}
                          </span>
                          {e.purchaseId ? (
                            <span className="flex h-9 w-9 flex-none items-center justify-center" title="From a stock-in — delete it on the Stock In page">
                              <Package size={13} className="text-muted-light" />
                            </span>
                          ) : (
                            <button onClick={() => deleteEntry(e)} title="Delete entry" className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-muted-light hover:bg-canvas hover:text-danger">
                              <Trash2 size={14} />
                            </button>
                          )}
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

      {/* add-vendor modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => !addBusy && setAddOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-pop sm:max-w-sm sm:rounded-card sm:pb-5">
            <div className="flex items-center justify-between">
              <p className="text-base font-bold text-ink">Add vendor</p>
              <button onClick={() => !addBusy && setAddOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2.5">
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Name" className="input" autoFocus />
              {addNameMatches.length > 0 && (
                <div className="space-y-1 rounded-tile border border-amber/30 bg-amber-soft/50 p-2">
                  <p className="px-1 text-[11px] font-semibold text-amber-deep">Already exists — tap to open instead:</p>
                  {addNameMatches.map((v) => (
                    <button
                      key={v.id}
                      onClick={async () => {
                        setAddOpen(false);
                        await openVendor(v);
                      }}
                      className="flex w-full items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-left text-sm hover:bg-canvas"
                    >
                      <Truck size={13} className="text-muted-light" />
                      <span className="flex-1 truncate">{v.name}</span>
                      {v.balance > 0 && <span className="text-[11px] text-amber-deep">{money(v.balance)}</span>}
                    </button>
                  ))}
                </div>
              )}
              <input value={addCompany} onChange={(e) => setAddCompany(e.target.value)} placeholder="Company (optional)" className="input" />
              <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" className="input" />
              <input
                value={addOwed}
                onChange={(e) => setAddOwed(e.target.value)}
                placeholder="Opening balance owed (optional)"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="input text-right"
              />
            </div>
            <button onClick={submitAdd} disabled={addBusy} className="btn-primary w-full">
              {addBusy ? "Saving…" : "Add vendor"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
