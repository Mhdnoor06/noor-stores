"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getItems,
  upsertItem,
  commitSale,
  getSettings,
  nextBillNumber,
  getUpiQrs,
  uid,
} from "@/lib/db";
import { lookupProduct } from "@/lib/product-lookup";
import { Bill, BillLine, Item, UpiQr } from "@/lib/types";
import { buildReceipt, money } from "@/lib/escpos";
import { useBluetooth } from "@/components/PrinterProvider";
import { useToast } from "@/components/Toast";
import PickerRow from "@/components/PickerRow";
import BillItem from "@/components/BillItem";
import PageHeader from "@/components/PageHeader";
import ScannerModal from "@/components/ScannerModal";
import UpiQrModal from "@/components/UpiQrModal";
import {
  ScanLine,
  Search,
  Printer,
  Trash2,
  ShoppingCart,
  Wallet,
  Smartphone,
  CreditCard,
  Package,
  Check,
  QrCode,
} from "lucide-react";

export default function NewBillPage() {
  const router = useRouter();
  const { isConnected, supported, connect, print, status } = useBluetooth();
  const toast = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<BillLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [discount, setDiscount] = useState("");
  const [roundOn, setRoundOn] = useState(true);
  const [payCash, setPayCash] = useState("");
  const [payUpi, setPayUpi] = useState("");
  const [payCard, setPayCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [upiQrs, setUpiQrs] = useState<UpiQr[]>([]);
  // Mobile only: focus one job at a time instead of cramming everything in.
  const [mobileView, setMobileView] = useState<"items" | "cart">("items");
  const [qa, setQa] = useState<{ barcode: string; name: string; size: string; price: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getItems().then(setItems).catch(() => setItems([]));
    getUpiQrs().then(setUpiQrs).catch(() => {});
    // Keep the search box focused so a USB/Bluetooth scanner "just works":
    // scan → digits land here → Enter adds the item.
    searchRef.current?.focus();
  }, []);

  async function handleBillScan(code: string) {
    const found = items.find((i) => i.barcode === code);
    if (found) {
      addItem(found);
      toast(`Added ${found.name}`, "ok");
      return;
    }
    // Unknown product — drop out of the live scanner to capture name & price.
    setScanOpen(false);
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
      toast(`Added & saved ${name}`, "ok");
      setQa(null);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Couldn't save item.", "error");
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
      toast(`Added ${target.name}`, "ok");
      setQuery("");
      searchRef.current?.focus();
    } else {
      toast(`No item matches “${q}”`, "error");
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

  const qtyById = useMemo(() => {
    const m = new Map<string, number>();
    lines.forEach((l) => m.set(l.itemId, l.qty));
    return m;
  }, [lines]);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  const discountNum = Math.min(subtotal, Math.max(0, parseFloat(discount) || 0));
  const afterDiscount = Math.max(0, subtotal - discountNum);
  const total = roundOn ? Math.round(afterDiscount) : afterDiscount;
  const roundOff = +(total - afterDiscount).toFixed(2);
  const count = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);

  const cashNum = parseFloat(payCash) || 0;
  const upiNum = parseFloat(payUpi) || 0;
  const cardNum = parseFloat(payCard) || 0;
  const paidNum = +(cashNum + upiNum + cardNum).toFixed(2);
  const change = Math.max(0, +(paidNum - total).toFixed(2));
  const balanceDue = Math.max(0, +(total - paidNum).toFixed(2));
  const needsCustomer = balanceDue > 0;

  const cashOptions = useMemo(() => {
    const t = Math.ceil(total);
    const set = new Set<number>([t, Math.ceil(t / 50) * 50, Math.ceil(t / 100) * 100, 100, 200, 500, 2000]);
    return Array.from(set).filter((v) => v >= t && v > 0).sort((a, b) => a - b).slice(0, 4);
  }, [total]);

  // Set one method to exactly cover whatever is still unpaid.
  function payRest(method: "cash" | "upi" | "card") {
    const others = paidNum - (method === "cash" ? cashNum : method === "upi" ? upiNum : cardNum);
    const rest = Math.max(0, +(total - others).toFixed(2));
    const v = rest ? String(rest) : "";
    if (method === "cash") setPayCash(v);
    else if (method === "upi") setPayUpi(v);
    else setPayCard(v);
  }
  function clearPayments() {
    setPayCash("");
    setPayUpi("");
    setPayCard("");
  }

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
    clearPayments();
    setCustomerName("");
    setCustomerPhone("");
  }

  async function buildBill(): Promise<Bill> {
    const r2 = (n: number) => +n.toFixed(2);
    // Change is returned from the cash tendered, so the recorded cash is net.
    const netCash = Math.max(0, r2(cashNum - change));
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
      payment: { cash: netCash, upi: r2(upiNum), card: r2(cardNum) },
      credit: balanceDue,
      changeGiven: change,
    };
  }
  const saleLines = () => lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));

  // Blocks checkout when a balance is on credit but no customer is named.
  function checkoutBlocked(): string | null {
    if (needsCustomer && !customerName.trim())
      return `Enter a customer name — ₹${balanceDue} will go on udhaar.`;
    return null;
  }

  async function handleSaveOnly() {
    if (lines.length === 0 || busy) return;
    const block = checkoutBlocked();
    if (block) {
      toast(block, "error");
      setMobileView("cart");
      return;
    }
    setBusy(true);
    try {
      const bill = await buildBill();
      const { synced } = await commitSale(bill, saleLines());
      if (synced) {
        router.push("/bills");
      } else {
        toast(`Saved offline (#${bill.number}) — will sync when online.`, "info");
        clearCart();
        setBusy(false);
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }

  async function handlePrint() {
    if (lines.length === 0) return;
    const block = checkoutBlocked();
    if (block) {
      toast(block, "error");
      setMobileView("cart");
      return;
    }
    if (!isConnected) {
      toast("Printer not connected — connect it first.", "error");
      return;
    }
    setBusy(true);
    try {
      const bill = await buildBill();
      const settings = await getSettings();
      await print(buildReceipt(bill, settings)); // local Bluetooth — works offline
      const { synced } = await commitSale(bill, saleLines());
      if (synced) {
        toast("Printed & saved.", "ok");
        setTimeout(() => router.push("/bills"), 700);
      } else {
        toast(`Printed. Saved offline (#${bill.number}) — syncs when online.`, "info");
        clearCart();
        setBusy(false);
      }
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }

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

      {/* Mobile: two focused tabs instead of everything stacked at once */}
      <div className="flex gap-1.5 rounded-tile border border-line-input bg-white p-1 lg:hidden">
        <button
          onClick={() => setMobileView("items")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] py-2 text-sm font-semibold transition ${
            mobileView === "items" ? "bg-brand text-white shadow-brand" : "text-muted-dark"
          }`}
        >
          <Package size={15} /> Items
        </button>
        <button
          onClick={() => setMobileView("cart")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-[7px] py-2 text-sm font-semibold transition ${
            mobileView === "cart" ? "bg-brand text-white shadow-brand" : "text-muted-dark"
          }`}
        >
          <ShoppingCart size={15} /> Cart
          {count > 0 && (
            <span className={`ml-0.5 rounded-full px-1.5 text-[11px] ${mobileView === "cart" ? "bg-white/25" : "bg-brand-soft text-brand"}`}>
              {count}
            </span>
          )}
          {lines.length > 0 && <span className="opacity-80">· {money(total)}</span>}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* LEFT: item picker */}
        <div className={`space-y-3 lg:col-span-3 lg:block ${mobileView === "items" ? "block" : "hidden"}`}>
          <div className="flex gap-2">
            <button onClick={() => setScanOpen(true)} className="btn-primary flex-1">
              <ScanLine size={18} /> Scan barcode
            </button>
          </div>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKey}
              className="input pl-10"
              placeholder="Search, or scan with a USB/Bluetooth scanner…"
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
            <div className="max-h-[62vh] space-y-2 overflow-auto pb-1">
              {filtered.map((i) => (
                <PickerRow
                  key={i.id}
                  item={i}
                  qty={qtyById.get(i.id) || 0}
                  onAdd={addItem}
                  onDec={(it) => changeQty(it.id, -1)}
                />
              ))}
            </div>
          )}

          {/* Mobile: jump to the bill once items are in */}
          {lines.length > 0 && (
            <button onClick={() => setMobileView("cart")} className="btn-primary w-full lg:hidden">
              <ShoppingCart size={17} /> Review &amp; pay · {money(total)}
            </button>
          )}
        </div>

        {/* RIGHT: checkout */}
        <div className={`space-y-4 lg:col-span-2 lg:sticky lg:top-6 lg:self-start lg:block ${mobileView === "cart" ? "block" : "hidden"}`}>

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
            <div className="card space-y-3 p-4">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Payment</span>
                {paidNum > 0 && (
                  <button onClick={clearPayments} className="text-xs font-semibold text-muted-light hover:text-danger">
                    Reset
                  </button>
                )}
              </div>

              {/* split across methods — fill any mix */}
              <div className="space-y-2">
                <MethodRow Icon={Wallet} label="Cash" value={payCash} onChange={setPayCash} onFull={() => payRest("cash")} />
                <MethodRow Icon={Smartphone} label="UPI" value={payUpi} onChange={setPayUpi} onFull={() => payRest("upi")} />
                <MethodRow Icon={CreditCard} label="Card" value={payCard} onChange={setPayCard} onFull={() => payRest("card")} />
              </div>

              {upiQrs.length > 0 && (
                <button onClick={() => setQrOpen(true)} className="btn-soft h-10 w-full">
                  <QrCode size={16} /> Show UPI QR to customer
                </button>
              )}

              {/* cash quick amounts */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-muted-light">Cash:</span>
                <button onClick={() => setPayCash(String(total))} className="rounded-md border border-line-input bg-white px-2.5 py-1 text-xs font-semibold text-muted-dark hover:bg-canvas">
                  Exact
                </button>
                {cashOptions.map((v) => (
                  <button key={v} onClick={() => setPayCash(String(v))} className="rounded-md border border-line-input bg-white px-2.5 py-1 text-xs font-semibold text-muted-dark hover:bg-canvas">
                    ₹{v}
                  </button>
                ))}
              </div>

              {/* summary */}
              <div className="space-y-1.5 border-t border-line-soft pt-2.5">
                <Row label="Paid" value={money(paidNum)} />
                {change > 0 && (
                  <div className="flex items-center justify-between rounded-tile bg-ok-soft px-3 py-2">
                    <span className="text-sm font-semibold text-ok">Change to return</span>
                    <span className="text-lg font-bold text-ok">{money(change)}</span>
                  </div>
                )}
                {balanceDue > 0 ? (
                  <div className="flex items-center justify-between rounded-tile bg-amber-soft px-3 py-2">
                    <span className="text-sm font-semibold text-amber-deep">Balance → udhaar</span>
                    <span className="text-lg font-bold text-amber-deep">{money(balanceDue)}</span>
                  </div>
                ) : (
                  total > 0 && (
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ok">
                      <Check size={14} /> Fully paid
                    </p>
                  )
                )}
              </div>

              {/* customer — required when a balance goes on credit */}
              <div className="space-y-2 border-t border-line-soft pt-2.5">
                {needsCustomer && (
                  <p className="text-xs font-semibold text-amber-deep">
                    Whose udhaar? Name needed for the {money(balanceDue)} balance.
                  </p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className={`input ${needsCustomer && !customerName.trim() ? "border-amber ring-2 ring-amber/20" : ""}`}
                    placeholder={needsCustomer ? "Customer name *" : "Customer name (optional)"}
                  />
                  <input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="input"
                    inputMode="tel"
                    placeholder="Phone (optional)"
                  />
                </div>
              </div>
            </div>
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

      <ScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={handleBillScan}
        keepOpen
        title="Scan items into bill"
      />

      <UpiQrModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        qrs={upiQrs}
        amount={upiNum > 0 ? upiNum : Math.max(0, +(total - cashNum - cardNum).toFixed(2))}
      />

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

function MethodRow({
  Icon,
  label,
  value,
  onChange,
  onFull,
}: {
  Icon: typeof Wallet;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFull: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex w-[72px] flex-none items-center gap-1.5 text-sm font-semibold text-muted-dark">
        <Icon size={15} /> {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder="0"
        className="h-9 flex-1 rounded-[9px] border border-line-input bg-white px-2.5 text-right text-sm font-bold outline-none focus:border-brand"
      />
      <button
        type="button"
        onClick={onFull}
        className="flex-none rounded-md border border-line-input px-2 py-1.5 text-[11px] font-semibold text-muted-dark hover:bg-canvas"
      >
        Full
      </button>
    </div>
  );
}
