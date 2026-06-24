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
import { ScanLine, Search, Printer } from "lucide-react";

export default function NewBillPage() {
  const router = useRouter();
  const { isConnected, supported, connect, print, status } = useBluetooth();

  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<BillLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [decoding, setDecoding] = useState(false);
  // quick-add panel for a scanned barcode that isn't in the catalog yet
  const [qa, setQa] = useState<{
    barcode: string;
    name: string;
    size: string;
    price: string;
  } | null>(null);
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
      else
        setMsg("Couldn't read that barcode — keep it flat and sharp, then snap again.");
    } catch {
      setMsg("Couldn't read that image. Try again.");
    } finally {
      setDecoding(false);
    }
  }

  // Scanned barcode → if it's a known product, add it (re-scan bumps qty).
  // If unknown, open the quick-add panel pre-filled from the product database.
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
      setQa((q) =>
        q && q.barcode === code && !q.name
          ? { ...q, name: info.name, size: info.quantity ?? q.size }
          : q
      );
  }

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!qa) return;
    const name = qa.name.trim();
    const price = parseFloat(qa.price);
    if (!name || isNaN(price) || price < 0) return;
    const item: Item = {
      id: uid(),
      name,
      price,
      size: qa.size.trim() || undefined,
      barcode: qa.barcode,
    };
    try {
      await upsertItem(item); // save to catalog for next time
      setItems((prev) => [item, ...prev]);
      addItem(item); // add to this bill
      setMsg(`Added & saved ${name}`);
      setQa(null);
    } catch (err: unknown) {
      setMsg(`${err instanceof Error ? err.message : "Couldn't save item."}`);
    }
  }

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          i.name.toLowerCase().includes(query.toLowerCase()) ||
          (i.code || "").toLowerCase().includes(query.toLowerCase())
      ),
    [items, query]
  );

  const total = useMemo(() => lines.reduce((s, l) => s + l.price * l.qty, 0), [lines]);
  const count = useMemo(() => lines.reduce((s, l) => s + l.qty, 0), [lines]);

  function addItem(item: Item) {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) => (l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        { itemId: item.id, name: item.name, size: item.size, price: item.price, qty: 1 },
      ];
    });
  }

  function changeQty(itemId: string, delta: number) {
    setLines((prev) =>
      prev
        .map((l) => (l.itemId === itemId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  async function buildBill(): Promise<Bill> {
    return {
      id: uid(),
      number: await nextBillNumber(),
      createdAt: Date.now(),
      customerName: customerName.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      lines,
      total,
    };
  }

  function saleLines() {
    return lines.map((l) => ({ itemId: l.itemId, qty: l.qty }));
  }

  async function handleSaveOnly() {
    if (lines.length === 0 || busy) return;
    setBusy(true);
    try {
      const bill = await buildBill();
      await saveBill(bill);
      recordSale(saleLines()).catch(() => {}); // decrement stock; never block
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
      recordSale(saleLines()).catch(() => {}); // decrement stock; never block
      setMsg("Printed & saved.");
      setTimeout(() => router.push("/bills"), 700);
    } catch (err: unknown) {
      setMsg(`${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="New Bill" subtitle="Scan or search items, then print." />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* LEFT: item picker */}
      <div className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScanFile}
          className="hidden"
        />
        <button
          onClick={openCamera}
          disabled={decoding}
          className="btn-primary w-full"
        >
          <ScanLine size={18} />
          {decoding ? "Reading barcode…" : "Scan to add to bill"}
        </button>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="input pl-10"
            placeholder="Or search items to add…"
          />
        </div>
        {items.length === 0 ? (
          <div className="card border-dashed p-6 text-center text-sm text-muted">
            No items yet.{" "}
            <Link href="/items" className="font-semibold text-brand hover:underline">
              Add items first →
            </Link>
          </div>
        ) : (
          <div className="grid max-h-[58vh] grid-cols-2 gap-2 overflow-auto pb-1 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map((i) => (
              <ItemCard key={i.id} item={i} onAdd={addItem} />
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: cart */}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-bold text-ink">Bill items</p>
            {count > 0 && (
              <span className="pill bg-brand-soft text-brand">{count} items</span>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-light">
              Tap items to add them.
            </p>
          ) : (
            <div>
              {lines.map((l) => (
                <BillItem key={l.itemId} line={l} onQty={changeQty} onRemove={removeLine} />
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-dashed border-line pt-3">
            <span className="text-base font-bold">Total</span>
            <span className="text-2xl font-bold text-brand">{money(total)}</span>
          </div>
        </div>

        {/* customer */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="input"
            placeholder="Customer name (optional)"
          />
          <input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            className="input"
            inputMode="tel"
            placeholder="Phone (optional)"
          />
        </div>

        {msg && (
          <div className="rounded-[10px] bg-ink px-3.5 py-2.5 text-sm font-medium text-white animate-pop">
            {msg}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {!isConnected && supported && (
            <button
              onClick={() => connect()}
              disabled={status === "connecting"}
              className="btn-soft flex-1"
            >
              {status === "connecting" ? "Connecting…" : "Connect Printer"}
            </button>
          )}
          <button
            onClick={handlePrint}
            disabled={lines.length === 0 || busy}
            className="btn-primary flex-1"
          >
            <Printer size={17} />
            {busy ? "Printing…" : "Print Bill"}
          </button>
          <button
            onClick={handleSaveOnly}
            disabled={lines.length === 0 || busy}
            className="btn-ghost"
          >
            Save Only
          </button>
        </div>
      </div>

      {/* quick-add panel for an unknown scanned barcode */}
      {qa && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          onClick={() => setQa(null)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleQuickAdd}
            className="card w-full max-w-sm space-y-3 p-4"
          >
            <p className="text-sm font-bold text-ink">New product</p>
            <p className="text-xs text-muted">
              Barcode <span className="font-mono">{qa.barcode}</span> isn’t in your
              catalog. Set name &amp; price — it’ll be saved for next time.
            </p>
            <label className="block">
              <span className="label">Name</span>
              <input
                autoFocus
                value={qa.name}
                onChange={(e) => setQa({ ...qa, name: e.target.value })}
                className="input"
                placeholder="Product name"
                required
              />
            </label>
            <label className="block">
              <span className="label">Size / Weight</span>
              <input
                value={qa.size}
                onChange={(e) => setQa({ ...qa, size: e.target.value })}
                className="input"
                placeholder="e.g. 500 g, 1 L (optional)"
              />
            </label>
            <label className="block">
              <span className="label">Price (₹)</span>
              <input
                value={qa.price}
                onChange={(e) => setQa({ ...qa, price: e.target.value })}
                className="input"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="10.00"
                required
              />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1">
                Add to bill
              </button>
              <button
                type="button"
                onClick={() => setQa(null)}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      </div>
    </div>
  );
}
