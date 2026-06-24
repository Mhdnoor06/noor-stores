"use client";

import { useEffect, useRef, useState } from "react";
import {
  deleteItem,
  getItemByBarcode,
  getItems,
  uid,
  upsertItem,
} from "@/lib/db";
import { Item } from "@/lib/types";
import { money } from "@/lib/escpos";
import { decodeImageFile } from "@/lib/scan";
import { lookupProduct } from "@/lib/product-lookup";
import PageHeader from "@/components/PageHeader";
import { ScanLine, Search } from "lucide-react";

const EMPTY = {
  id: "",
  name: "",
  price: "",
  size: "",
  code: "",
  barcode: "",
  stock: "",
  reorder: "",
};

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = form.id !== "";

  // Opens the phone's native camera (reliable autofocus) to photograph a
  // barcode. We decode the still rather than fighting the live video stream,
  // which won't focus on many phones.
  function openCamera() {
    setErr("");
    setMsg("");
    fileRef.current?.click();
  }

  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same shot
    if (!file) return;
    setDecoding(true);
    setErr("");
    try {
      const code = await decodeImageFile(file);
      if (code) handleScanned(code);
      else
        setErr(
          "Couldn't read that barcode. Keep it flat, sharp and centered with white space on both sides, then snap again."
        );
    } catch {
      setErr("Couldn't read that image. Try again.");
    } finally {
      setDecoding(false);
    }
  }

  async function refresh() {
    try {
      setItems(await getItems());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function resetForm() {
    setForm(EMPTY);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const price = parseFloat(form.price);
    if (!name || isNaN(price) || price < 0) return;
    setSaving(true);
    setErr("");
    const item: Item = {
      id: form.id || uid(),
      name,
      price,
      size: form.size.trim() || undefined,
      code: form.code.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      stock: parseInt(form.stock, 10) || 0,
      reorderLevel: parseInt(form.reorder, 10) || 0,
    };
    try {
      await upsertItem(item);
      resetForm();
      setMsg(`Saved “${name}”.`);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save item.");
    } finally {
      setSaving(false);
    }
  }

  function handleEdit(item: Item) {
    setForm({
      id: item.id,
      name: item.name,
      price: String(item.price),
      size: item.size || "",
      code: item.code || "",
      barcode: item.barcode || "",
      stock: item.stock ? String(item.stock) : "",
      reorder: item.reorderLevel ? String(item.reorderLevel) : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item?")) return;
    try {
      await deleteItem(id);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete item.");
    }
  }

  // Core of this feature: a scanned barcode either opens the existing product
  // for editing, or pre-fills a new item form so you just add name + price.
  async function handleScanned(code: string) {
    setErr("");
    try {
      const existing = await getItemByBarcode(code);
      if (existing) {
        handleEdit(existing);
        setMsg(`Barcode already saved — editing “${existing.name}”.`);
        return;
      }

      // New barcode — show it immediately, then try to auto-fill the name from
      // the product database while the user gets ready to set the price.
      setForm({ ...EMPTY, barcode: code });
      setMsg(`New barcode ${code} — looking up product name…`);
      window.scrollTo({ top: 0, behavior: "smooth" });

      const info = await lookupProduct(code);
      if (info) {
        // only fill if the user hasn't started typing a name meanwhile
        setForm((f) =>
          f.barcode === code && !f.name.trim()
            ? { ...f, name: info.name, size: info.quantity ?? f.size }
            : f
        );
        setMsg(`Found “${info.name}” — set the price and save.`);
        setTimeout(() => priceRef.current?.focus(), 150);
      } else {
        setMsg(`New barcode ${code} — not in product database. Enter name & price.`);
        setTimeout(() => nameRef.current?.focus(), 150);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed.");
    }
  }

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      (i.code || "").toLowerCase().includes(query.toLowerCase()) ||
      (i.barcode || "").includes(query.trim())
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Items"
        subtitle="Add and manage the products you sell."
      />

      {/* Hidden native-camera input — the reliable way to scan on phones */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleScanFile}
        className="hidden"
      />

      {/* Scan button — the primary way to add a product */}
      <button
        onClick={openCamera}
        disabled={decoding}
        className="btn-primary w-full"
      >
        <ScanLine size={18} />
        {decoding ? "Reading barcode…" : "Scan barcode to add a product"}
      </button>

      {msg && (
        <div className="rounded-[10px] bg-brand-soft px-3.5 py-2.5 text-sm font-medium text-brand">
          {msg}
        </div>
      )}
      {err && (
        <div className="rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {err}
        </div>
      )}

      {/* form */}
      <form onSubmit={handleSubmit} className="card p-4">
        <p className="mb-3 text-sm font-bold text-ink">
          {editing ? "Edit item" : "Add new item"}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Name *</span>
            <input
              ref={nameRef}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input"
              placeholder="e.g. Parle-G"
              required
            />
          </label>
          <label className="block">
            <span className="label">Price (₹) *</span>
            <input
              ref={priceRef}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              className="input"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              placeholder="10.00"
              required
            />
          </label>
          <label className="block">
            <span className="label">Size / Weight</span>
            <input
              value={form.size}
              onChange={(e) => setForm({ ...form, size: e.target.value })}
              className="input"
              placeholder="e.g. 500 g, 1 L, 330 ml"
            />
          </label>
          <label className="block">
            <span className="label">Barcode</span>
            <div className="flex gap-2">
              <input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                className="input"
                inputMode="numeric"
                placeholder="Scan or type"
              />
              <button
                type="button"
                onClick={openCamera}
                disabled={decoding}
                className="btn-ghost flex-none px-3"
                aria-label="Scan barcode"
              >
                <ScanLine size={18} />
              </button>
            </div>
          </label>
          <label className="block">
            <span className="label">Code / SKU</span>
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="input"
              placeholder="optional"
            />
          </label>
          <label className="block">
            <span className="label">Stock on hand</span>
            <input
              value={form.stock}
              onChange={(e) => setForm({ ...form, stock: e.target.value })}
              className="input"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="0"
            />
          </label>
          <label className="block">
            <span className="label">Reorder level</span>
            <input
              value={form.reorder}
              onChange={(e) => setForm({ ...form, reorder: e.target.value })}
              className="input"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="alert when stock ≤ this"
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Add item"}
          </button>
          {(editing || form.barcode) && (
            <button type="button" onClick={resetForm} className="btn-ghost">
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* search */}
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input pl-10"
          placeholder="Search by name, code or barcode…"
        />
      </div>

      {/* list */}
      {loading ? (
        <div className="card p-8 text-center text-sm text-muted-light">
          Loading items…
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted-light">
          {items.length === 0 ? "No items yet. Scan one to add it." : "No matches."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((i) => (
            <div key={i.id} className="card flex items-center gap-3 p-3.5">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-sm font-bold text-brand">
                {i.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {i.name}
                  {i.size ? (
                    <span className="ml-1 font-normal text-muted">· {i.size}</span>
                  ) : null}
                </p>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-light">
                  <span>{i.barcode ? `▦ ${i.barcode}` : i.code || "No barcode"}</span>
                  <StockBadge stock={i.stock ?? 0} reorder={i.reorderLevel ?? 0} />
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-ink">{money(i.price)}</p>
                <div className="mt-0.5 flex justify-end gap-2 text-xs">
                  <button
                    onClick={() => handleEdit(i)}
                    className="font-medium text-brand hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(i.id)}
                    className="font-medium text-danger hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

function StockBadge({ stock, reorder }: { stock: number; reorder: number }) {
  const low = reorder > 0 && stock <= reorder;
  const out = stock <= 0;
  const cls = out
    ? "bg-danger-soft text-danger"
    : low
      ? "bg-amber-soft text-amber-deep"
      : "bg-ok-soft text-ok";
  return (
    <span className={`rounded px-1.5 py-0.5 font-semibold ${cls}`}>
      {out ? "Out of stock" : `${stock} in stock`}
    </span>
  );
}
