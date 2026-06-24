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
import { UNITS, CATEGORIES, perUnit } from "@/lib/units";
import PageHeader from "@/components/PageHeader";
import { ScanLine, Search, Plus, Trash2, X } from "lucide-react";

const EMPTY = {
  id: "", name: "", price: "", unit: "pcs", category: "", mrp: "", cost: "",
  size: "", code: "", barcode: "", stock: "", reorder: "",
};

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editing = form.id !== "";

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

  function openAdd() {
    setForm(EMPTY);
    setErr("");
    setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 80);
  }
  function closeForm() {
    setShowForm(false);
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
      unit: form.unit || "pcs",
      category: form.category.trim() || undefined,
      mrp: parseFloat(form.mrp) || undefined,
      costPrice: parseFloat(form.cost) || undefined,
      size: form.size.trim() || undefined,
      code: form.code.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      stock: parseInt(form.stock, 10) || 0,
      reorderLevel: parseInt(form.reorder, 10) || 0,
    };
    try {
      await upsertItem(item);
      setMsg(`Saved “${name}”.`);
      closeForm();
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
      unit: item.unit || "pcs",
      category: item.category || "",
      mrp: item.mrp ? String(item.mrp) : "",
      cost: item.costPrice ? String(item.costPrice) : "",
      size: item.size || "",
      code: item.code || "",
      barcode: item.barcode || "",
      stock: item.stock ? String(item.stock) : "",
      reorder: item.reorderLevel ? String(item.reorderLevel) : "",
    });
    setErr("");
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item?")) return;
    try {
      await deleteItem(id);
      closeForm();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete item.");
    }
  }

  async function handleScanned(code: string) {
    setErr("");
    try {
      const existing = await getItemByBarcode(code);
      if (existing) {
        handleEdit(existing);
        setMsg(`Barcode already saved — editing “${existing.name}”.`);
        return;
      }
      setForm({ ...EMPTY, barcode: code });
      setShowForm(true);
      setMsg(`New barcode ${code} — looking up product…`);
      const info = await lookupProduct(code);
      setForm((f) =>
        f.barcode === code && !f.name.trim()
          ? { ...f, name: info?.name ?? "", size: info?.quantity ?? "" }
          : f
      );
      setMsg(info ? `Found “${info.name}” — set the price and save.` : `New barcode — enter name & price.`);
      setTimeout(() => (info ? priceRef.current : nameRef.current)?.focus(), 120);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup failed.");
    }
  }

  function openCamera() {
    setErr("");
    setMsg("");
    fileRef.current?.click();
  }
  async function handleScanFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setDecoding(true);
    setErr("");
    try {
      const code = await decodeImageFile(file);
      if (code) handleScanned(code);
      else setErr("Couldn't read that barcode. Keep it flat, sharp and centered, then snap again.");
    } catch {
      setErr("Couldn't read that image. Try again.");
    } finally {
      setDecoding(false);
    }
  }

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      (i.category || "").toLowerCase().includes(query.toLowerCase()) ||
      (i.code || "").toLowerCase().includes(query.toLowerCase()) ||
      (i.barcode || "").includes(query.trim())
  );

  return (
    <div className="space-y-5">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleScanFile} className="hidden" />

      <PageHeader
        title="Items"
        subtitle="Your product catalogue and stock."
        action={
          <div className="flex gap-2">
            <button onClick={openCamera} disabled={decoding} className="btn-ghost h-10">
              <ScanLine size={17} />
              {decoding ? "Reading…" : "Scan"}
            </button>
            <button onClick={openAdd} className="btn-primary h-10">
              <Plus size={17} strokeWidth={2.3} /> Add item
            </button>
          </div>
        }
      />

      {msg && <Banner tone="ok">{msg}</Banner>}
      {err && <Banner tone="danger">{err}</Banner>}

      {/* search */}
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="input pl-10"
          placeholder="Search by name, category, code or barcode…"
        />
      </div>

      {/* list */}
      {loading ? (
        <div className="card p-10 text-center text-sm text-muted-light">Loading items…</div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <ScanLine size={26} className="text-line-input" />
          <p className="text-sm text-muted">
            {items.length === 0 ? "No products yet. Scan a barcode or add one." : "No matches."}
          </p>
          {items.length === 0 && (
            <button onClick={openAdd} className="btn-primary h-10">
              <Plus size={17} /> Add item
            </button>
          )}
        </div>
      ) : (
        <div className="card divide-y divide-line-soft overflow-hidden">
          {filtered.map((i) => (
            <button
              key={i.id}
              onClick={() => handleEdit(i)}
              className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-canvas"
            >
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-sm font-bold text-brand">
                {i.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {i.name}
                  {i.size ? <span className="font-normal text-muted-light"> · {i.size}</span> : null}
                </p>
                <p className="truncate text-[11.5px] text-muted-light">
                  {i.category || i.barcode || i.code || "No barcode"}
                </p>
              </div>
              <div className="flex flex-none flex-col items-end gap-1">
                <p className="whitespace-nowrap text-sm font-bold text-ink">
                  {money(i.price)}
                  <span className="ml-0.5 text-[10.5px] font-normal text-muted-light">{perUnit(i.unit)}</span>
                </p>
                <StockBadge stock={i.stock ?? 0} reorder={i.reorderLevel ?? 0} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* form modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={closeForm}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit}
            className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="text-base font-bold text-ink">{editing ? "Edit item" : "Add item"}</p>
              <button type="button" onClick={closeForm} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-auto px-5 py-5">
              {err && <Banner tone="danger">{err}</Banner>}

              <section className="space-y-3">
                <span className="eyebrow">Product details</span>
                <Field label="Name *">
                  <input ref={nameRef} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" placeholder="e.g. Parle-G Biscuits" required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Category">
                    <input list="cat-list" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="input" placeholder="Grocery…" />
                    <datalist id="cat-list">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
                  </Field>
                  <Field label="Pack size">
                    <input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} className="input" placeholder="500 g, 1 L" />
                  </Field>
                </div>
                <Field label="Barcode">
                  <div className="flex gap-2">
                    <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="input" inputMode="numeric" placeholder="Scan or type" />
                    <button type="button" onClick={openCamera} disabled={decoding} className="btn-ghost flex-none px-3" aria-label="Scan">
                      <ScanLine size={18} />
                    </button>
                  </div>
                </Field>
                <Field label="SKU / HSN code">
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input" placeholder="optional" />
                </Field>
              </section>

              <section className="space-y-3">
                <span className="eyebrow">Pricing</span>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Sold by (unit) *">
                    <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className="input">
                      {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </Field>
                  <Field label={`Selling price (${perUnit(form.unit)}) *`}>
                    <input ref={priceRef} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="10.00" required />
                  </Field>
                  <Field label="MRP (₹)">
                    <input value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="optional" />
                  </Field>
                  <Field label="Cost price (₹)">
                    <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="optional" />
                  </Field>
                </div>
              </section>

              <section className="space-y-3">
                <span className="eyebrow">Inventory</span>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Stock on hand">
                    <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="input" type="number" step="any" min="0" inputMode="decimal" placeholder="0" />
                  </Field>
                  <Field label="Reorder level">
                    <input value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} className="input" type="number" step="any" min="0" inputMode="decimal" placeholder="alert at ≤" />
                  </Field>
                </div>
              </section>
            </div>

            <div className="flex items-center gap-2 border-t border-line px-5 py-4">
              {editing && (
                <button
                  type="button"
                  onClick={() => handleDelete(form.id)}
                  className="btn-ghost flex-none px-3 text-danger hover:bg-danger-soft"
                  aria-label="Delete item"
                >
                  <Trash2 size={17} />
                </button>
              )}
              <button type="button" onClick={closeForm} className="btn-ghost flex-1">
                Cancel
              </button>
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save" : "Add item"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Banner({ tone, children }: { tone: "ok" | "danger"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger";
  return <div className={`rounded-tile px-3.5 py-2.5 text-sm font-medium ${cls}`}>{children}</div>;
}

function StockBadge({ stock, reorder }: { stock: number; reorder: number }) {
  const out = stock <= 0;
  const low = reorder > 0 && stock <= reorder;
  const cls = out ? "bg-danger-soft text-danger" : low ? "bg-amber-soft text-amber-deep" : "bg-ok-soft text-ok";
  return (
    <span className={`rounded px-1.5 py-0.5 font-semibold ${cls}`}>
      {out ? "Out of stock" : `${stock} in stock`}
    </span>
  );
}
