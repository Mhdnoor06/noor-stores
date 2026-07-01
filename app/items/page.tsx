"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteItem,
  getItemByBarcode,
  getItems,
  uid,
  upsertItem,
} from "@/lib/db";
import { Item, Pack } from "@/lib/types";
import { money, buildLabels } from "@/lib/escpos";
import { lookupProduct } from "@/lib/product-lookup";
import { CATEGORIES, perUnit, formatStock } from "@/lib/units";
import { getUnitPresets, addUnitPreset, UnitPreset } from "@/lib/unit-presets";
import { generateInternalBarcode } from "@/lib/barcode";
import { useBluetooth } from "@/components/PrinterProvider";
import PageHeader from "@/components/PageHeader";
import Barcode from "@/components/Barcode";
import ScannerModal from "@/components/ScannerModal";
import { ScanLine, Search, Plus, Trash2, X, Sparkles, Printer, ChevronLeft, ChevronRight, Check } from "lucide-react";

const EMPTY = {
  id: "", name: "", price: "", mrp: "", cost: "",
  size: "", code: "", barcode: "", stock: "", reorder: "", category: "",
};

// One selected selling-unit row. The smallest (by baseQty) becomes the base
// stock unit; the rest become packs. `wholesale` blank = not sold at this size.
type UnitDraft = {
  key: string;
  label: string; // chip label / unit name shown to staff
  unit: string; // unit string stored if this row is the base ("pcs", "kg", "case")
  baseQty: string; // base units inside (ignored for the base row → forced 1)
  wholesale: string; // wholesale price for this unit (blank = not sold wholesale)
  barcode: string; // pack's own barcode (base uses the product barcode above)
  atomic?: boolean; // true = an indivisible unit (pcs/kg/L) → wins a size tie as the base
};

const PAGE_SIZE = 20;
const n = (s: string) => parseFloat(s);

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  // "list" = scan to find/add a product; "field" = fill the form's barcode;
  // "unit" = fill a selling-unit row's barcode.
  const [scanMode, setScanMode] = useState<"list" | "field" | "unit">("list");
  const [scanUnitKey, setScanUnitKey] = useState<string | null>(null);
  // Selling units + pricing.
  const [units, setUnits] = useState<UnitDraft[]>([]);
  const [sellsRetail, setSellsRetail] = useState(true);
  const [presets, setPresets] = useState<UnitPreset[]>([]);
  // Inline "add custom unit" editor.
  const [customLabel, setCustomLabel] = useState("");
  const [customQty, setCustomQty] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const editing = form.id !== "";
  const { isConnected, print, connect } = useBluetooth();

  useEffect(() => {
    setPresets(getUnitPresets());
  }, []);

  // Selected units smallest → largest; the first is the base (stock) unit. On a
  // size tie an atomic unit (Piece/kg) wins, so it never gets demoted to a pack.
  const sortedUnits = useMemo(
    () =>
      [...units].sort((a, b) => {
        const d = (n(a.baseQty) || 1) - (n(b.baseQty) || 1);
        if (d !== 0) return d;
        return (a.atomic ? 0 : 1) - (b.atomic ? 0 : 1);
      }),
    [units]
  );
  const baseUnit = sortedUnits[0];
  const baseLabel = baseUnit?.label || "unit";
  const baseUnitStr = baseUnit?.unit || "pcs";

  // The chip palette: built-ins/customs, plus any unit already on this product
  // whose label isn't a known preset (so edited custom packs still show as chips).
  const palette = useMemo<UnitPreset[]>(() => {
    const known = new Set(presets.map((p) => p.label.toLowerCase()));
    const extra: UnitPreset[] = units
      .filter((u) => !known.has(u.label.toLowerCase()))
      .map((u) => ({ id: u.key, label: u.label, unit: u.unit, baseQty: n(u.baseQty) || 1 }));
    return [...presets, ...extra];
  }, [presets, units]);
  const selectedLabels = useMemo(
    () => new Set(units.map((u) => u.label.toLowerCase())),
    [units]
  );

  async function printLabel() {
    const bc = form.barcode.trim();
    if (!bc) return;
    if (!isConnected) {
      setErr("Printer not connected — connect it (top bar), then print.");
      connect();
      return;
    }
    try {
      await print(
        buildLabels([
          {
            id: form.id || "tmp",
            name: form.name.trim() || "Item",
            price: n(form.price) || 0,
            unit: baseUnitStr,
            barcode: bc,
          },
        ])
      );
      setMsg("Label sent to printer.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Print failed.");
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
    setUnits([]);
    setSellsRetail(true);
    setShowCustom(false);
    setCustomLabel("");
    setCustomQty("");
  }
  function openAdd() {
    resetForm();
    setErr("");
    setShowForm(true);
    setTimeout(() => nameRef.current?.focus(), 80);
  }
  function closeForm() {
    setShowForm(false);
    resetForm();
  }

  /* ---- selling units ---- */
  function toggleUnit(p: UnitPreset) {
    const has = units.find((u) => u.label.toLowerCase() === p.label.toLowerCase());
    if (has) {
      setUnits((us) => us.filter((u) => u.key !== has.key));
    } else {
      setUnits((us) => [
        ...us,
        { key: uid(), label: p.label, unit: p.unit, baseQty: String(p.baseQty), wholesale: "", barcode: "", atomic: p.atomic },
      ]);
    }
  }
  function patchUnit(key: string, p: Partial<UnitDraft>) {
    setUnits((us) => us.map((u) => (u.key === key ? { ...u, ...p } : u)));
  }
  function removeUnit(key: string) {
    setUnits((us) => us.filter((u) => u.key !== key));
  }
  function saveCustomUnit() {
    const label = customLabel.trim();
    const qty = n(customQty) || 1;
    if (!label) return;
    const next = addUnitPreset(label, qty);
    setPresets(next);
    const made = next.find((p) => p.label.toLowerCase() === label.toLowerCase());
    if (made && !selectedLabels.has(made.label.toLowerCase())) toggleUnit(made);
    setCustomLabel("");
    setCustomQty("");
    setShowCustom(false);
  }
  function openScanUnit(key: string) {
    setErr("");
    setScanMode("unit");
    setScanUnitKey(key);
    setScanOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setErr("Enter a product name.");
      return;
    }
    if (sortedUnits.length === 0) {
      setErr("Pick at least one selling unit (e.g. Piece, Case).");
      return;
    }

    const base = sortedUnits[0];
    const baseStr = base.unit || "pcs";

    // Build packs from every unit above the base.
    const builtPacks: Pack[] = [];
    for (const u of sortedUnits.slice(1)) {
      const baseQty = n(u.baseQty);
      if (isNaN(baseQty) || baseQty <= 1) {
        setErr(`1 ${u.label} must equal more than 1 ${baseLabel} — set how many ${baseLabel} are in a ${u.label}.`);
        return;
      }
      const wholesale = n(u.wholesale);
      builtPacks.push({
        id: u.key,
        label: u.label.trim() || "Pack",
        baseQty,
        wholesalePrice: isNaN(wholesale) ? undefined : wholesale,
        barcode: u.barcode.trim() || undefined,
      });
    }

    // Retail = one base-unit price; wholesale = per-unit prices.
    const retail = sellsRetail ? n(form.price) : 0;
    if (sellsRetail && (isNaN(retail) || retail <= 0)) {
      setErr(`Enter a retail price per ${baseLabel} (or turn off "Sell to retail").`);
      return;
    }
    const baseWholesale = n(base.wholesale);
    const hasWholesale =
      (!isNaN(baseWholesale) && baseWholesale > 0) || builtPacks.some((p) => (p.wholesalePrice ?? 0) > 0);
    if (!sellsRetail && !hasWholesale) {
      setErr("Add a retail price, or a wholesale price for at least one unit.");
      return;
    }

    setSaving(true);
    setErr("");
    const existing = new Set(items.map((i) => i.barcode).filter(Boolean) as string[]);
    const barcode = form.barcode.trim() || generateInternalBarcode(existing);
    const item: Item = {
      id: form.id || uid(),
      name,
      price: isNaN(retail) ? 0 : retail,
      wholesalePrice: !isNaN(baseWholesale) && baseWholesale > 0 ? baseWholesale : undefined,
      unit: baseStr,
      sellsRetail,
      sellLoose: true, // the smallest selected unit is always a sell option
      category: form.category?.trim() || undefined,
      mrp: n(form.mrp) || undefined,
      costPrice: n(form.cost) || undefined,
      size: form.size.trim() || undefined,
      code: form.code.trim() || undefined,
      barcode,
      stock: n(form.stock) || 0,
      reorderLevel: n(form.reorder) || 0,
      packs: builtPacks,
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
      price: item.price ? String(item.price) : "",
      mrp: item.mrp ? String(item.mrp) : "",
      cost: item.costPrice ? String(item.costPrice) : "",
      size: item.size || "",
      code: item.code || "",
      barcode: item.barcode || "",
      stock: item.stock ? String(item.stock) : "",
      reorder: item.reorderLevel ? String(item.reorderLevel) : "",
      category: item.category || "",
    });

    const baseStr = item.unit || "pcs";
    const all = getUnitPresets();
    const basePreset = all.find((p) => p.unit === baseStr);
    const baseRow: UnitDraft = {
      key: "base",
      label: basePreset?.label || baseStr,
      unit: baseStr,
      baseQty: "1",
      wholesale: item.wholesalePrice != null ? String(item.wholesalePrice) : "",
      barcode: "",
      atomic: basePreset?.atomic,
    };
    const packRows: UnitDraft[] = (item.packs ?? []).map((p) => {
      const pre = all.find((x) => x.label.toLowerCase() === p.label.toLowerCase());
      return {
        key: p.id,
        label: p.label,
        unit: pre?.unit || p.label.toLowerCase().replace(/\s+/g, "-"),
        baseQty: String(p.baseQty),
        wholesale: p.wholesalePrice != null ? String(p.wholesalePrice) : "",
        barcode: p.barcode ?? "",
        atomic: pre?.atomic,
      };
    });
    setUnits([baseRow, ...packRows]);
    setSellsRetail(item.sellsRetail ?? (item.price ?? 0) > 0);
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
      resetForm();
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

  function openScanList() {
    setErr("");
    setMsg("");
    setScanMode("list");
    setScanOpen(true);
  }
  function openScanField() {
    setErr("");
    setScanMode("field");
    setScanOpen(true);
  }
  function handleDetect(code: string) {
    if (scanMode === "field") setForm((f) => ({ ...f, barcode: code }));
    else if (scanMode === "unit" && scanUnitKey) patchUnit(scanUnitKey, { barcode: code });
    else handleScanned(code);
  }

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(query.toLowerCase()) ||
      (i.category || "").toLowerCase().includes(query.toLowerCase()) ||
      (i.code || "").toLowerCase().includes(query.toLowerCase()) ||
      (i.barcode || "").includes(query.trim())
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, items.length]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Items"
        subtitle="Your product catalogue and stock."
        action={
          <div className="flex gap-2">
            <button onClick={openScanList} className="btn-ghost h-10">
              <ScanLine size={17} /> Scan
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
        <>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {paged.map((i) => (
            <div
              key={i.id}
              onClick={() => handleEdit(i)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && handleEdit(i)}
              className="card flex cursor-pointer items-center gap-3 p-3.5 text-left transition hover:border-brand/40 hover:bg-canvas"
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
                  {money(displayPrice(i).amount)}
                  <span className="ml-0.5 text-[10.5px] font-normal text-muted-light">{displayPrice(i).suffix}</span>
                </p>
                <StockBadge item={i} />
              </div>
            </div>
          ))}
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-muted-light">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="btn-ghost h-9 px-3"
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <span className="text-xs font-semibold text-muted-dark">
                Page {safePage} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="btn-ghost h-9 px-3"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
        </>
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

              {/* 1. What is it */}
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
                    <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} className="input" inputMode="numeric" placeholder="Scan, type or generate" />
                    <button type="button" onClick={openScanField} className="btn-ghost flex-none px-3" aria-label="Scan">
                      <ScanLine size={18} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, barcode: generateInternalBarcode(new Set(items.map((i) => i.barcode).filter(Boolean) as string[])) }))}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                  >
                    <Sparkles size={13} /> Generate internal barcode
                  </button>

                  {form.barcode.trim() ? (
                    <div className="mt-2 rounded-tile border border-line bg-white p-2">
                      <div className="flex justify-center">
                        <Barcode value={form.barcode.trim()} height={44} width={1.5} fontSize={13} />
                      </div>
                      <button
                        type="button"
                        onClick={printLabel}
                        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md bg-canvas py-1.5 text-xs font-semibold text-muted-dark hover:bg-line-soft"
                      >
                        <Printer size={14} /> Print this label
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-light">
                      No barcode on the product? One is auto-generated on save.
                    </p>
                  )}
                </Field>
              </section>

              {/* 2. Units this product is sold in */}
              <section className="space-y-3">
                <span className="eyebrow">Units sold in</span>
                <p className="text-[11px] text-muted-light">
                  Tap every size you sell. The smallest one is the base unit ({baseLabel}); stock is counted in it.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {palette.map((p) => {
                    const on = selectedLabels.has(p.label.toLowerCase());
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => toggleUnit(p)}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                          on
                            ? "border-brand bg-brand text-white shadow-brand"
                            : "border-line-input bg-white text-muted-dark hover:border-brand hover:text-brand"
                        }`}
                      >
                        {on ? <Check size={12} strokeWidth={2.6} /> : <Plus size={12} />} {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowCustom((s) => !s)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-input bg-white px-3 py-1.5 text-xs font-semibold text-muted-dark hover:border-brand hover:text-brand"
                  >
                    <Plus size={12} /> Add custom
                  </button>
                </div>

                {showCustom && (
                  <div className="flex flex-wrap items-end gap-2 rounded-tile border border-line-input bg-canvas/60 p-3">
                    <label className="block flex-1">
                      <span className="text-[11px] text-muted-light">Unit name</span>
                      <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="e.g. Crate, Strip" className="input mt-0.5 h-9" />
                    </label>
                    <label className="block w-24">
                      <span className="text-[11px] text-muted-light">{baseLabel}/unit</span>
                      <input value={customQty} onChange={(e) => setCustomQty(e.target.value)} type="number" min="1" step="any" inputMode="decimal" placeholder="12" className="input mt-0.5 h-9 text-right" />
                    </label>
                    <button type="button" onClick={saveCustomUnit} className="btn-primary h-9 flex-none px-3">
                      Add
                    </button>
                  </div>
                )}
              </section>

              {/* 3. Wholesale prices — one box per selected unit */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Wholesale prices</span>
                  <span className="text-[11px] text-muted-light">Fill what you sell · blank = skip</span>
                </div>
                {sortedUnits.length === 0 ? (
                  <p className="rounded-tile border border-dashed border-line-input px-3 py-4 text-center text-xs text-muted-light">
                    Pick a unit above first.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {sortedUnits.map((u, idx) => {
                      const isBase = idx === 0;
                      return (
                        <div key={u.key} className="rounded-tile border border-line-input bg-white p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink">{u.label}</p>
                              <p className="text-[11px] text-muted-light">
                                {isBase ? `Base unit — stock is counted in ${u.label}` : `1 ${u.label} = ${u.baseQty || "?"} ${baseLabel}`}
                              </p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-light">₹</span>
                              <input
                                value={u.wholesale}
                                onChange={(e) => patchUnit(u.key, { wholesale: e.target.value })}
                                type="number" step="0.01" min="0" inputMode="decimal"
                                placeholder="price"
                                className="input h-9 w-24 text-right"
                              />
                              {!isBase && (
                                <button type="button" onClick={() => removeUnit(u.key)} className="flex h-9 w-9 flex-none items-center justify-center rounded-tile border border-line-input text-muted-light hover:bg-canvas hover:text-danger" aria-label="Remove unit">
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </div>
                          {!isBase && (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <label className="block">
                                <span className="text-[11px] text-muted-light">How many {baseLabel} in 1 {u.label}?</span>
                                <input value={u.baseQty} onChange={(e) => patchUnit(u.key, { baseQty: e.target.value })} type="number" step="any" min="0" inputMode="decimal" placeholder="12" className="input mt-0.5 h-9 text-right" />
                              </label>
                              <label className="block">
                                <span className="text-[11px] text-muted-light">Pack barcode</span>
                                <div className="mt-0.5 flex gap-1.5">
                                  <input value={u.barcode} onChange={(e) => patchUnit(u.key, { barcode: e.target.value })} inputMode="numeric" placeholder="optional" className="input h-9 flex-1" />
                                  <button type="button" onClick={() => openScanUnit(u.key)} className="btn-ghost h-9 flex-none px-2.5" aria-label="Scan pack barcode">
                                    <ScanLine size={15} />
                                  </button>
                                </div>
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* 4. Retail — one toggle, one price */}
              <section className="space-y-3">
                <span className="eyebrow">Retail</span>
                <label className="flex cursor-pointer items-center justify-between rounded-tile border border-line-input px-3.5 py-2.5">
                  <span className="text-sm font-medium text-ink">
                    Sell to retail customers?
                    <span className="block text-[11px] font-normal text-muted-light">One price per {baseLabel}, charged × quantity</span>
                  </span>
                  <input type="checkbox" checked={sellsRetail} onChange={(e) => setSellsRetail(e.target.checked)} className="h-5 w-5 flex-none accent-brand" />
                </label>
                {sellsRetail && (
                  <Field label={`Retail price (per ${baseLabel}) *`}>
                    <input ref={priceRef} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="5.00" />
                  </Field>
                )}
              </section>

              {/* 5. Inventory & cost */}
              <section className="space-y-3">
                <span className="eyebrow">Inventory &amp; cost</span>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Stock on hand (${baseLabel})`}>
                    <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} className="input" type="number" step="any" min="0" inputMode="decimal" placeholder="0" />
                  </Field>
                  <Field label="Reorder level">
                    <input value={form.reorder} onChange={(e) => setForm({ ...form, reorder: e.target.value })} className="input" type="number" step="any" min="0" inputMode="decimal" placeholder="alert at ≤" />
                  </Field>
                  <Field label={`Cost price (₹ / ${baseLabel})`}>
                    <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="optional" />
                  </Field>
                  <Field label="MRP (₹)">
                    <input value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} className="input" type="number" step="0.01" min="0" inputMode="decimal" placeholder="optional" />
                  </Field>
                </div>
                <Field label="SKU / HSN code">
                  <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="input" placeholder="optional" />
                </Field>
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

      <ScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onDetect={handleDetect}
        title={scanMode === "unit" ? "Scan pack barcode" : scanMode === "field" ? "Scan barcode" : "Scan to find / add"}
      />
    </div>
  );
}

// What price to show on the list card: the retail price when sold retail, else
// the base or first pack wholesale price (so wholesale-only items don't read ₹0).
function displayPrice(i: Item): { amount: number; suffix: string } {
  if ((i.price ?? 0) > 0) return { amount: i.price, suffix: perUnit(i.unit) };
  if (i.wholesalePrice && i.wholesalePrice > 0) return { amount: i.wholesalePrice, suffix: perUnit(i.unit) };
  const pk = (i.packs ?? []).find((p) => (p.wholesalePrice ?? 0) > 0);
  return pk ? { amount: pk.wholesalePrice as number, suffix: `/ ${pk.label}` } : { amount: i.price ?? 0, suffix: perUnit(i.unit) };
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

function StockBadge({ item }: { item: Item }) {
  const stock = item.stock ?? 0;
  const reorder = item.reorderLevel ?? 0;
  const out = stock <= 0;
  const low = reorder > 0 && stock <= reorder;
  const cls = out ? "bg-danger-soft text-danger" : low ? "bg-amber-soft text-amber-deep" : "bg-ok-soft text-ok";
  const label = out ? "Out of stock" : `${formatStock(stock, item)} in stock`;
  return (
    <span title={`${stock} ${item.unit || "pcs"}`} className={`rounded px-1.5 py-0.5 font-semibold ${cls}`}>
      {label}
    </span>
  );
}
