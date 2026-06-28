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
  getCustomers,
  uid,
} from "@/lib/db";
import { lookupProduct } from "@/lib/product-lookup";
import { Bill, BillLine, Customer, Item, UpiQr } from "@/lib/types";
import { buildReceipt, money } from "@/lib/escpos";
import { isMeasured } from "@/lib/units";
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
  UserCheck,
  X,
} from "lucide-react";

// A way the item can be sold: the base unit (loose) or one of its packs.
type SellLevel = { id: string; label: string; unit: string; price: number; baseQty: number; measured: boolean };

// Retail = ONE price per base unit; any bigger unit costs base × baseQty.
// Wholesale = each unit has its own price, and a unit is only offered wholesale
// when it has a wholesale price set. (Falls back to retail if nothing priced.)
function sellLevelsOf(item: Item, wholesale: boolean): SellLevel[] {
  const out: SellLevel[] = [];
  const base = item.unit || "pcs";
  // Retail base price, with a wholesale fallback so a wholesale-only item still
  // prices (rather than reading ₹0) if billed in retail mode.
  const retailBase = item.price || item.wholesalePrice || 0;

  if (item.sellLoose !== false) {
    if (wholesale) {
      if (item.wholesalePrice != null)
        out.push({ id: "base", label: base, unit: base, price: item.wholesalePrice, baseQty: 1, measured: isMeasured(base) });
    } else {
      out.push({ id: "base", label: base, unit: base, price: retailBase, baseQty: 1, measured: isMeasured(base) });
    }
  }
  for (const p of item.packs ?? []) {
    if (wholesale) {
      if (p.wholesalePrice == null) continue; // not sold wholesale at this size
      out.push({ id: p.id, label: p.label, unit: p.label, price: p.wholesalePrice, baseQty: p.baseQty, measured: false });
    } else {
      out.push({ id: p.id, label: p.label, unit: p.label, price: retailBase * p.baseQty, baseQty: p.baseQty, measured: false });
    }
  }
  if (out.length === 0) {
    out.push({ id: "base", label: base, unit: base, price: retailBase, baseQty: 1, measured: isMeasured(base) });
  }
  return out;
}

export default function NewBillPage() {
  const router = useRouter();
  const { isConnected, supported, connect, print, status } = useBluetooth();
  const toast = useToast();

  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<BillLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  // Picked existing udhaar customer — new credit stacks onto their balance.
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [custFocus, setCustFocus] = useState(false);
  // Fold the linked customer's previous udhaar onto this bill to clear it together.
  const [includeOld, setIncludeOld] = useState(false);
  const [discount, setDiscount] = useState("");
  const [roundOn, setRoundOn] = useState(true);
  const [wholesale, setWholesale] = useState(false); // bill price mode (retail/wholesale)
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
  // Item awaiting a unit choice (Piece / Bundle / Case) before it's added.
  const [unitPick, setUnitPick] = useState<Item | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getItems().then(setItems).catch(() => setItems([]));
    getUpiQrs().then(setUpiQrs).catch(() => {});
    getCustomers().then(setCustomers).catch(() => {});
    // Keep the search box focused so a USB/Bluetooth scanner "just works":
    // scan → digits land here → Enter adds the item.
    searchRef.current?.focus();
  }, []);

  async function handleBillScan(code: string) {
    const hit = resolveBarcode(code);
    if (hit) {
      addItem(hit.item, hit.levelId);
      toast(`Added ${hit.item.name}`, "ok");
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
    const hit = resolveBarcode(q);
    const target = hit?.item || items.find((i) => i.code === q) || filtered[0];
    if (target) {
      // A barcode names the exact unit → add it; a name/search match asks.
      if (hit) {
        addItem(target, hit.levelId);
        toast(`Added ${target.name}`, "ok");
      } else {
        handlePick(target);
      }
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

  // The currently linked customer (if one was picked from the list).
  const linkedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  );
  // Suggest existing customers as the cashier types a name/phone. Hide once an
  // exact one is linked. Customers who already owe float to the top.
  const custMatches = useMemo(() => {
    const q = customerName.trim().toLowerCase();
    const p = customerPhone.trim();
    if (linkedCustomer || (!q && !p)) return [];
    return customers
      .filter(
        (c) =>
          (q && c.name.toLowerCase().includes(q)) ||
          (p && (c.phone || "").includes(p))
      )
      .slice(0, 6);
  }, [customers, customerName, customerPhone, linkedCustomer]);

  function pickCustomer(c: Customer) {
    setCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone || "");
    setCustFocus(false);
    setIncludeOld(false);
  }
  function unlinkCustomer() {
    setCustomerId(null);
    setCustomerName("");
    setCustomerPhone("");
    setIncludeOld(false);
  }

  // The linked customer's previous balance, only when the cashier chose to add it.
  const oldBalance =
    includeOld && linkedCustomer && linkedCustomer.balance > 0 ? linkedCustomer.balance : 0;
  const collectTarget = +(total + oldBalance).toFixed(2);

  // Allocate what was paid: this bill's items first, then the old balance.
  // Whatever is left over on the bill becomes new udhaar; the rest of the old
  // balance stays owed. Each side keeps its own per-method split.
  const alloc = useMemo(() => {
    const r2 = (n: number) => +n.toFixed(2);
    const chg = Math.max(0, r2(paidNum - collectTarget));
    const tendered = { cash: Math.max(0, r2(cashNum - chg)), upi: r2(upiNum), card: r2(cardNum) };
    let billLeft = total;
    let oldLeft = oldBalance;
    const billPay = { cash: 0, upi: 0, card: 0 };
    const settle = { cash: 0, upi: 0, card: 0 };
    (["cash", "upi", "card"] as const).forEach((m) => {
      let amt = tendered[m];
      const toBill = Math.min(amt, billLeft);
      billPay[m] = r2(toBill);
      billLeft = r2(billLeft - toBill);
      amt = r2(amt - toBill);
      const toOld = Math.min(amt, oldLeft);
      settle[m] = r2(toOld);
      oldLeft = r2(oldLeft - toOld);
    });
    return {
      change: chg,
      billPay,
      settle,
      settleTotal: r2(settle.cash + settle.upi + settle.card),
      billCredit: r2(billLeft), // new udhaar created by this bill
      oldRemaining: r2(oldLeft), // old balance still owed afterwards
    };
  }, [total, oldBalance, collectTarget, paidNum, cashNum, upiNum, cardNum]);

  const change = alloc.change;
  const balanceDue = alloc.billCredit; // new udhaar from THIS bill (needs a name)
  const owedAfter = +(alloc.billCredit + alloc.oldRemaining).toFixed(2); // total left owed
  const needsCustomer = balanceDue > 0;

  const cashOptions = useMemo(() => {
    const t = Math.ceil(collectTarget);
    const set = new Set<number>([t, Math.ceil(t / 50) * 50, Math.ceil(t / 100) * 100, 100, 200, 500, 2000]);
    return Array.from(set).filter((v) => v >= t && v > 0).sort((a, b) => a - b).slice(0, 4);
  }, [collectTarget]);

  // Set one method to exactly cover whatever is still unpaid (incl. added old balance).
  function payRest(method: "cash" | "upi" | "card") {
    const others = paidNum - (method === "cash" ? cashNum : method === "upi" ? upiNum : cardNum);
    const rest = Math.max(0, +(collectTarget - others).toFixed(2));
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

  // Resolve a scanned/typed code to an item + the level whose barcode it is.
  function resolveBarcode(code: string): { item: Item; levelId: string } | null {
    for (const it of items) {
      if (it.barcode === code) return { item: it, levelId: "base" };
      const pk = (it.packs ?? []).find((p) => p.barcode === code);
      if (pk) return { item: it, levelId: pk.id };
    }
    return null;
  }

  // Picker tap: an item already in the cart just increments; a new multi-unit
  // item asks which unit first; a single-unit item is added straight away.
  function handlePick(item: Item) {
    const inCart = lines.some((l) => l.itemId === item.id);
    if (inCart) {
      addItem(item);
      return;
    }
    const levels = sellLevelsOf(item, wholesale);
    if (levels.length > 1) {
      setUnitPick(item);
      return;
    }
    addItem(item);
  }
  function chooseUnit(levelId: string) {
    if (!unitPick) return;
    addItem(unitPick, levelId);
    toast(`Added ${unitPick.name}`, "ok");
    setUnitPick(null);
  }

  function addItem(item: Item, levelId?: string) {
    const levels = sellLevelsOf(item, wholesale);
    const lvl = (levelId ? levels.find((l) => l.id === levelId) : undefined) ?? levels[0];
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [
        ...prev,
        {
          itemId: item.id,
          name: item.name,
          size: item.size,
          unit: lvl.unit,
          price: lvl.price,
          qty: 1,
          packId: lvl.id === "base" ? undefined : lvl.id,
          baseQty: lvl.baseQty,
        },
      ];
    });
  }
  // Switch a cart line to a different sell level (re-prices + base-qty).
  function setUnit(itemId: string, levelId: string) {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const lvl = sellLevelsOf(item, wholesale).find((l) => l.id === levelId);
    if (!lvl) return;
    setLines((prev) =>
      prev.map((l) =>
        l.itemId === itemId
          ? { ...l, unit: lvl.unit, price: lvl.price, baseQty: lvl.baseQty, packId: lvl.id === "base" ? undefined : lvl.id }
          : l
      )
    );
  }
  // Flip retail/wholesale and re-price every line at its current level.
  function setPriceMode(w: boolean) {
    setWholesale(w);
    setLines((prev) =>
      prev.map((l) => {
        const item = items.find((i) => i.id === l.itemId);
        if (!item) return l;
        const lvl = sellLevelsOf(item, w).find((x) => x.id === (l.packId ?? "base"));
        return lvl ? { ...l, price: lvl.price } : l;
      })
    );
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
    setCustomerId(null);
    setIncludeOld(false);
  }

  async function buildBill(): Promise<Bill> {
    return {
      id: uid(),
      number: await nextBillNumber(),
      createdAt: Date.now(),
      customerId: customerId || undefined,
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      lines,
      subtotal,
      discount: discountNum,
      roundOff,
      total,
      // Payment is split per method: what landed on THIS bill vs the old balance.
      payment: alloc.billPay,
      credit: alloc.billCredit,
      changeGiven: alloc.change,
      settleOld: alloc.settleTotal > 0 ? alloc.settle : undefined,
    };
  }
  // Stock is deducted in BASE units: a "Case" line of qty 2 removes 2×baseQty.
  const saleLines = () => lines.map((l) => ({ itemId: l.itemId, qty: l.qty * (l.baseQty ?? 1) }));

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
              {filtered.map((i) => {
                const dl = sellLevelsOf(i, wholesale)[0];
                return (
                  <PickerRow
                    key={i.id}
                    item={i}
                    qty={qtyById.get(i.id) || 0}
                    price={dl.price}
                    unitLabel={dl.label}
                    onAdd={handlePick}
                    onDec={(it) => changeQty(it.id, -1)}
                  />
                );
              })}
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

          {/* retail / wholesale price mode */}
          <div className="flex gap-1.5 rounded-tile border border-line-input bg-white p-1">
            {([["Retail", false], ["Wholesale", true]] as const).map(([label, w]) => (
              <button
                key={label}
                onClick={() => setPriceMode(w)}
                className={`flex-1 rounded-[7px] py-2 text-sm font-semibold transition ${
                  wholesale === w ? "bg-brand text-white shadow-brand" : "text-muted-dark hover:bg-canvas"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

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
                {lines.map((l) => {
                  const it = items.find((i) => i.id === l.itemId);
                  const levels = it ? sellLevelsOf(it, wholesale).map((x) => ({ id: x.id, label: x.label })) : [];
                  return (
                    <BillItem
                      key={l.itemId}
                      line={l}
                      levels={levels}
                      onQty={changeQty}
                      onSetQty={setQty}
                      onSetPrice={setPrice}
                      onSetUnit={setUnit}
                      onRemove={removeLine}
                    />
                  );
                })}
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
                  <span className={`font-bold text-brand ${oldBalance > 0 ? "text-lg" : "text-2xl"}`}>
                    {money(total)}
                  </span>
                </div>

                {/* old balance folded onto this bill — removable right here */}
                {oldBalance > 0 && (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex min-w-0 items-center gap-1.5 text-amber-deep">
                        <span className="font-semibold">Old balance</span>
                        {linkedCustomer ? (
                          <span className="truncate text-muted-light">· {linkedCustomer.name}</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-semibold text-amber-deep">{money(oldBalance)}</span>
                        <button
                          onClick={() => setIncludeOld(false)}
                          className="rounded-md p-1 text-muted-light hover:bg-canvas hover:text-danger"
                          aria-label="Remove old balance from bill"
                        >
                          <X size={15} />
                        </button>
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-line pt-2">
                      <span className="text-base font-bold">To pay</span>
                      <span className="text-2xl font-bold text-brand">{money(collectTarget)}</span>
                    </div>
                  </>
                )}
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
                <button onClick={() => setPayCash(String(collectTarget))} className="rounded-md border border-line-input bg-white px-2.5 py-1 text-xs font-semibold text-muted-dark hover:bg-canvas">
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
                {oldBalance > 0 && (
                  <>
                    <Row label="Bill" value={money(total)} />
                    <Row label="Old balance" value={money(oldBalance)} />
                    <div className="flex items-center justify-between border-t border-line-soft pt-1.5 text-sm font-bold text-ink">
                      <span>To collect</span>
                      <span>{money(collectTarget)}</span>
                    </div>
                  </>
                )}
                <Row label="Paid" value={money(paidNum)} />
                {change > 0 && (
                  <div className="flex items-center justify-between rounded-tile bg-ok-soft px-3 py-2">
                    <span className="text-sm font-semibold text-ok">Change to return</span>
                    <span className="text-lg font-bold text-ok">{money(change)}</span>
                  </div>
                )}
                {owedAfter > 0 ? (
                  <div className="flex items-center justify-between rounded-tile bg-amber-soft px-3 py-2">
                    <span className="text-sm font-semibold text-amber-deep">
                      {oldBalance > 0 ? "Remaining udhaar" : "Balance → udhaar"}
                    </span>
                    <span className="text-lg font-bold text-amber-deep">{money(owedAfter)}</span>
                  </div>
                ) : (
                  (total > 0 || oldBalance > 0) && (
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-ok">
                      <Check size={14} /> {oldBalance > 0 ? "Bill paid + old balance cleared" : "Fully paid"}
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

                {linkedCustomer ? (
                  // Existing customer is linked — new credit stacks on their balance.
                  <div className="space-y-2 rounded-xl border border-brand bg-brand-soft/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-ink">
                        <UserCheck size={15} className="shrink-0 text-brand" />
                        {linkedCustomer.name}
                        {linkedCustomer.phone ? (
                          <span className="font-normal text-ink-soft">· {linkedCustomer.phone}</span>
                        ) : null}
                      </p>
                      <button
                        onClick={unlinkCustomer}
                        className="shrink-0 rounded-lg p-1.5 text-ink-soft hover:bg-white hover:text-ink"
                        aria-label="Change customer"
                      >
                        <X size={16} />
                      </button>
                    </div>

                    {linkedCustomer.balance > 0 ? (
                      includeOld ? (
                        <button
                          onClick={() => setIncludeOld(false)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-amber bg-amber-soft px-2.5 py-1.5 text-left"
                        >
                          <span className="text-xs font-semibold text-amber-deep">
                            Old balance {money(linkedCustomer.balance)} added to bill
                          </span>
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-deep">
                            <X size={13} /> Remove
                          </span>
                        </button>
                      ) : (
                        <button
                          onClick={() => setIncludeOld(true)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5 text-left hover:border-amber"
                        >
                          <span className="text-xs text-amber-deep">
                            Old balance {money(linkedCustomer.balance)}
                          </span>
                          <span className="rounded-md bg-amber-soft px-2 py-0.5 text-[11px] font-semibold text-amber-deep">
                            + Add to bill
                          </span>
                        </button>
                      )
                    ) : (
                      <p className="text-xs text-ink-soft">No previous dues</p>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        value={customerName}
                        onChange={(e) => {
                          setCustomerName(e.target.value);
                          setCustomerId(null);
                        }}
                        onFocus={() => setCustFocus(true)}
                        onBlur={() => setTimeout(() => setCustFocus(false), 150)}
                        className={`input ${needsCustomer && !customerName.trim() ? "border-amber ring-2 ring-amber/20" : ""}`}
                        placeholder={needsCustomer ? "Customer name *" : "Customer name (optional)"}
                      />
                      <input
                        value={customerPhone}
                        onChange={(e) => {
                          setCustomerPhone(e.target.value);
                          setCustomerId(null);
                        }}
                        onFocus={() => setCustFocus(true)}
                        onBlur={() => setTimeout(() => setCustFocus(false), 150)}
                        className="input"
                        inputMode="tel"
                        placeholder="Phone (optional)"
                      />
                    </div>

                    {custFocus && custMatches.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-card">
                        {custMatches.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickCustomer(c)}
                            className="flex w-full items-center justify-between gap-2 border-b border-line-soft px-3 py-2 text-left last:border-0 hover:bg-canvas"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-ink">{c.name}</span>
                              {c.phone ? (
                                <span className="block truncate text-xs text-ink-soft">{c.phone}</span>
                              ) : null}
                            </span>
                            {c.balance > 0 ? (
                              <span className="shrink-0 text-xs font-semibold text-amber-deep">
                                Owes {money(c.balance)}
                              </span>
                            ) : (
                              <span className="shrink-0 text-xs text-ink-soft">Settled</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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

      {/* unit picker — choose Piece / Bundle / Case before adding */}
      {unitPick && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={() => setUnitPick(null)}>
          <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm space-y-3 p-4">
            <div className="flex items-center justify-between">
              <p className="min-w-0 truncate text-sm font-bold text-ink">
                {unitPick.name}
                {unitPick.size ? <span className="font-normal text-muted-light"> · {unitPick.size}</span> : null}
              </p>
              <button onClick={() => setUnitPick(null)} className="flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted-light hover:bg-canvas" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-muted">Which unit? ({wholesale ? "wholesale" : "retail"} price)</p>
            <div className="space-y-2">
              {sellLevelsOf(unitPick, wholesale).map((lv) => (
                <button
                  key={lv.id}
                  onClick={() => chooseUnit(lv.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-tile border border-line-input bg-white px-3.5 py-2.5 text-left transition hover:border-brand hover:bg-brand-soft/40"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Package size={15} className="text-brand" />
                    {lv.label}
                    {lv.baseQty > 1 && <span className="text-xs font-normal text-muted-light">· {lv.baseQty} {unitPick.unit || "pcs"}</span>}
                  </span>
                  <span className="text-sm font-bold text-brand">{money(lv.price)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
