"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getItems,
  upsertItem,
  recordSale,
  getSettings,
  nextBillNumber,
  saveBill,
  uid,
} from "@/lib/db";
import { decodeImageFile } from "@/lib/scan";
import { lookupProduct } from "@/lib/product-lookup";
import { Bill, BillLine, Item } from "@/lib/types";
import { buildReceipt, money } from "@/lib/escpos";
import { useBluetooth } from "@/components/PrinterProvider";
import ItemCard from "@/components/ItemCard";
import BillItem from "@/components/BillItem";
import PageHeader from "@/components/PageHeader";
import {
  ScanLine,
  Search,
  Printer,
  Trash2,
  ShoppingCart,
  Wallet,
  Smartphone,
  CreditCard,
} from "lucide-react";

type Pay = "cash" | "upi" | "card";

export default function NewBillPage() {
  const router = useRouter();
  const { isConnected, supported, connect, print, status } = useBluetooth();

  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<BillLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [roundOn, setRoundOn] = useState(true);
  const [pay, setPay] = useState<Pay>("cash");
  const [paid, setPaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [qa, setQa] = useState<{ barcode: string; name: string; size: string; price: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getItems().then(setItems).catch(() => setItems([]));
  }, []);

  function openCamera() {
    setMsg("");
    fileRef.current?.click();
  }

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDecoding(true);
    setMsg("");
    try {
      const code = await decodeImageFile(file);
      if (code) await handleBillScan(code);
      else setMsg("Couldn't read that barcode — keep it flat and sharp, then snap again.");
    } catch {
      setMsg("Couldn't read that image. Try again.");
    } finally {
      setDecoding(false);
    }
  }

  async function handleBillScan(code: string) {
    const found = items.find((i) => i.barcode === code);
    if (found) {
      addItem(found);
      setMsg(`Added ${found.name}`);
      return;
    }
    setQa({ barcode: code, name: "", size: "", price: "" });
    const info = await lookupProduct(code);
    if (info)
      setQa((q) => (q && q.barcode === code && !q.name ? { ...q, name: info.name, size: info.quantity ?? q.size } : q));
  }

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!qa) return;
    const name = qa.name.trim();
    const price = parseFloat(qa.price);
    if (!name || isNaN(price) || price < 0) return;
    const item: Item = { id: uid(), name, price, size: qa.size.trim() || undefined, barcode: qa.barcode };
    try {
      await upsertItem(item);
      setItems((prev) => [item, ...prev]);
      addItem(item);
      setMsg(`Added & saved ${name}`);
      setQa(null);
    } catch (err: unknown) {
      setMsg(`${err instanceof Error ? err.message : "Couldn't save item."}`);
    }
  }

  // USB/keyboard scanner: typing a barcode + Enter adds the matching item.
  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = query.trim();
    if (!q) return;
    const exact = items.find((i) => i.barcode === q || i.code === q);
    const target = exact || filtered[0];
    if (target) {
      addItem(target);
      setQuery("");
    }
  }

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          i.name.toLowerCase().includes(query.toLowerCase()) ||
          (i.code || "").toLowerCase().includes(query.toLowerCase()) ||
          (i.barcode || "").includes(query.trim())
      ),
    [items, query]
  );

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  const discountNum = Math.min(subtotal, Math.max(0, parseFloat(discount) || 0));
  const afterDiscount = Math.max(0, subtotal - discountNum);
  const total = roundOn ? Math.round(afterDiscount) : afterDiscount;
  const roundOff = +(total - afterDiscount).toFixed(2);
  const count = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);

  const paidNum = parseFloat(paid) || 0;
  const change = pay === "cash" && paidNum > 0 ? Math.max(0, paidNum - total) : 0;
  const short = pay === "cash" && paidNum > 0 && paidNum < total ? total - paidNum : 0;

  const cashOptions = useMemo(() => {
    const t = Math.ceil(total);
    const set = new Set<number>([t, Math.ceil(t / 50) * 50, Math.ceil(t / 100) * 100, 100, 200, 500, 2000]);
    return Array.from(set).filter((v) => v >= t && v > 0).sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  function addItem(item: Item) {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { itemId: item.id, name: item.name, size: item.size, unit: item.unit, price: item.price, qty: 1 }];
    });
  }
  function changeQty(itemId: string, delta: number) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0));
  }
  function setQty(itemId: string, qty: number) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, qty: Math.max(0, qty) } : l)));
  }
  function setPrice(itemId: string, price: number) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, price: Math.max(0, price) } : l)));
  }
  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }
  function clearCart() {
    setLines([]);
    setDiscount("");
    setPaid("");
    setMsg("");
  }

  async function buildBill(): Promise<Bill> {
    return {
      id: uid(),
      number: await nextBillNumber(),
      createdAt: Date.now(),
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      lines,
      subtotal,
      discount: discountNum,
      roundOff,
      total,
      paymentMethod: pay,
      amountPaid: pay === "cash" && paidNum > 0 ? paidNum : total,
    };
  }
  const saleLines = () => lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));

  async function handleSaveOnly() {
    if (lines.length === 0 || busy) return;
    setBusy(true);
    try {
      const bill = await buildBill();
      await saveBill(bill);
      recordSale(saleLines()).catch(() => {});
      router.push("/bills");
    } catch (err: unknown) {
      setMsg(`${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
    }
  }

  async function handlePrint() {
    if (lines.length === 0) return;
    setMsg("");
    if (!isConnected) {
      setMsg("Printer not connected — connect first, then print.");
      return;
    }
    setBusy(true);
    try {
      const bill = await buildBill();
      const settings = await getSettings();
      await print(buildReceipt(bill, settings));
      await saveBill(bill);
      recordSale(saleLines()).catch(() => {});
      setMsg("Printed & saved.");
      setTimeout(() => router.push("/bills"), 700);
    } catch (err: unknown) {
      setMsg(`${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  const PAY_OPTS: { id: Pay; label: string; Icon: typeof Wallet }[] = [
    { id: "cash", label: "Cash", Icon: Wallet },
    { id: "upi", label: "UPI", Icon: Smartphone },
    { id: "card", label: "Card", Icon: CreditCard },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="New Bill"
        subtitle="Scan or search items, then take payment."
        action={
          lines.length > 0 ? (
            <button onClick={clearCart} className="btn-ghost h-10 text-danger">
              <Trash2 size={16} /> Clear
            </button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* LEFT: item picker */}
        <div className="space-y-3 lg:col-span-3">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleScanFile} className="hidden" />
          <div className="flex gap-2">
            <button onClick={openCamera} disabled={decoding} className="btn-primary flex-1">
              <ScanLine size={18} />
              {decoding ? "Reading…" : "Scan barcode"}
            </button>
          </div>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              className="input pl-10"
              placeholder="Search or scan-gun a barcode, then Enter…"
            />
          </div>
          {items.length === 0 ? (
            <div className="card border-dashed p-8 text-center text-sm text-muted">
              No items yet.{" "}
              <Link href="/items" className="font-semibold text-brand hover:underline">
                Add items first →
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card p-8 text-center text-sm text-muted-light">No matches for “{query}”.</div>
          ) : (
            <div className="grid max-h-[64vh] grid-cols-2 gap-2.5 overflow-auto pb-1 sm:grid-cols-3 xl:grid-cols-4">
              {filtered.map((i) => (
                <ItemCard key={i.id} item={i} onAdd={addItem} />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: checkout */}
        <div className="space-y-4 lg:col-span-2 lg:sticky lg:top-6 lg:self-start">
          {/* cart */}
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-bold text-ink">
                <ShoppingCart size={16} /> Current bill
              </span>
              {count > 0 && <span className="pill bg-brand-soft text-brand">{count} items</span>}
            </div>

            {lines.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-sm text-muted-light">
                <ShoppingCart size={26} className="text-line-input" />
                Scan or tap items to start a bill.
              </div>
            ) : (
              <div className="max-h-[40vh] overflow-auto px-4">
                {lines.map((l) => (
                  <BillItem key={l.itemId} line={l} onQty={changeQty} onSetQty={setQty} onSetPrice={setPrice} onRemove={removeLine} />
                ))}
              </div>
            )}

            {lines.length > 0 && (
              <div className="space-y-2 border-t border-line-soft px-4 py-3">
                <Row label="Subtotal" value={money(subtotal)} />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">Discount (₹)</span>
                  <input
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0"
                    className="h-8 w-24 rounded-[9px] border border-line-input bg-white px-2.5 text-right text-sm font-semibold outline-none focus:border-brand"
                  />
                </div>
                <label className="flex items-center justify-between text-sm">
                  <span className="text-muted">Round off</span>
                  <span className="flex items-center gap-2">
                    {roundOff !== 0 && roundOn && (
                      <span className="text-xs text-muted-light">
                        {roundOff >= 0 ? "+" : "−"}
                        {money(Math.abs(roundOff))}
                      </span>
                    )}
                    <input type="checkbox" checked={roundOn} onChange={(e) => setRoundOn(e.target.checked)} className="h-4 w-4 accent-brand" />
                  </span>
                </label>
                <div className="flex items-center justify-between border-t border-line pt-2">
                  <span className="text-base font-bold">Total</span>
                  <span className="text-2xl font-bold text-brand">{money(total)}</span>
                </div>
              </div>
            )}
          </div>

          {lines.length > 0 && (
            <>
              {/* payment */}
              <div className="card space-y-3 p-4">
                <span className="eyebrow">Payment</span>
                <div className="flex gap-1.5 rounded-tile border border-line-input bg-white p-1">
                  {PAY_OPTS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      onClick={() => setPay(id)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] py-2 text-sm font-semibold transition ${
                        pay === id ? "bg-brand text-white shadow-brand" : "text-muted-dark hover:bg-canvas"
                      }`}
                    >
                      <Icon size={15} /> {label}
                    </button>
                  ))}
                </div>

                {pay === "cash" && (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setPaid(String(total))} className="rounded-md border border-line-input bg-white px-2.5 py-1.5 text-xs font-semibold text-muted-dark hover:bg-canvas">
                        Exact
                      </button>
                      {cashOptions.map((v) => (
                        <button key={v} onClick={() => setPaid(String(v))} className="rounded-md border border-line-input bg-white px-2.5 py-1.5 text-xs font-semibold text-muted-dark hover:bg-canvas">
                          ₹{v}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted">Cash received</span>
                      <input
                        value={paid}
                        onChange={(e) => setPaid(e.target.value)}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        placeholder="0"
                        className="h-9 w-28 rounded-[9px] border border-line-input bg-white px-2.5 text-right text-sm font-bold outline-none focus:border-brand"
                      />
                    </div>
                    {change > 0 && (
                      <div className="flex items-center justify-between rounded-tile bg-ok-soft px-3 py-2">
                        <span className="text-sm font-semibold text-ok">Change to return</span>
                        <span className="text-lg font-bold text-ok">{money(change)}</span>
                      </div>
                    )}
                    {short > 0 && (
                      <div className="flex items-center justify-between rounded-tile bg-amber-soft px-3 py-2 text-sm font-semibold text-amber-deep">
                        <span>Still short</span>
                        <span>{money(short)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* customer */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="input" placeholder="Customer name (optional)" />
                <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="input" inputMode="tel" placeholder="Phone (optional)" />
              </div>
            </>
          )}

          {msg && (
            <div className="rounded-tile bg-ink px-3.5 py-2.5 text-sm font-medium text-white animate-pop">{msg}</div>
          )}

          {/* actions */}
          <div className="flex flex-wrap gap-3">
            {!isConnected && supported && (
              <button onClick={() => connect()} disabled={status === "connecting"} className="btn-soft flex-1">
                {status === "connecting" ? "Connecting…" : "Connect Printer"}
              </button>
            )}
            <button onClick={handlePrint} disabled={lines.length === 0 || busy} className="btn-primary flex-1">
              <Printer size={17} />
              {busy ? "Working…" : "Print & Save"}
            </button>
            <button onClick={handleSaveOnly} disabled={lines.length === 0 || busy} className="btn-ghost">
              Save Only
            </button>
          </div>
        </div>
      </div>

      {/* quick-add modal */}
      {qa && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setQa(null)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleQuickAdd} className="card w-full max-w-sm space-y-3 p-4">
            <p className="text-sm font-bold text-ink">New product</p>
            <p className="text-xs text-muted">
              Barcode <span className="font-mono">{qa.barcode}</span> isn’t in your catalog. Set name &amp; price — it’ll be saved for next time.
            </p>
            <label className="block">
              <span className="label">Name</span>
              <input autoFocus value={qa.name} onChange={(e) => setQa({ ...qa, name: e.target.value })} className="input" placeholder="Product name" required />
            </label>
            <label className="block">
              <span className="label">Size / Weight</span>
              <input value={qa.size} onChange={(e) => setQa({ ...qa, size: e.target.value })} className="input" placeholder="e.g. 500 g, 1 L (optional)" />
            </label>
            <label className="block">
              <span className="label">Price (₹)</span>
              <input value={qa.price} onChange={(e) => setQa({ ...qa, price: e.target.value })} className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="10.00" required />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1">Add to bill</button>
              <button type="button" onClick={() => setQa(null)} className="btn-ghost">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}
