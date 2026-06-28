"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getItems, getVendors, getPurchases, nextPurchaseNumber, recordPurchase, deletePurchase, uid } from "@/lib/db";
import { Item, Vendor, Purchase, PurchaseLine } from "@/lib/types";
import { money } from "@/lib/escpos";
import { compressImage } from "@/lib/image";
import { useToast } from "@/components/Toast";
import PageHeader from "@/components/PageHeader";
import { BillThumb } from "@/components/BillAttach";
import ScannerModal from "@/components/ScannerModal";
import { PackagePlus, Search, X, Plus, Trash2, Truck, Package, ScanLine, Loader2, Sparkles, Camera, Upload } from "lucide-react";

// A line being edited in the stock-in form. Numeric fields stay strings for
// clean inputs; they're parsed on save.
type DraftLine = {
  key: string;
  itemId?: string;
  name: string;
  barcode?: string;
  unit: string; // base unit
  isNew: boolean;
  purchaseUnit: "unit" | "case";
  packId?: string; // which catalogue pack is being bought (existing items)
  packLabel?: string; // pack label for display ("Bag", "Case", "Tin")
  caseSize: string; // base units per pack (editable per purchase)
  qty: string; // in purchaseUnit
  cost: string; // per purchaseUnit
  sellPrice: string; // per base unit (new items)
  mrp: string;
};

// Pre-fill payload when the form is opened from an AI scan.
type StockInInitial = {
  vendorName?: string;
  invoiceNumber?: string;
  invoiceImage?: string;
  source?: "manual" | "ocr";
  lines?: DraftLine[];
};

// A line scanned from a bill, as returned by /api/scan-purchase.
type ScanLineData = { name?: string; qty?: number | null; unit?: string | null; cost?: number | null; mrp?: number | null; amount?: number | null };

// Turns one scanned line into an editable DraftLine, matching it to an existing
// catalogue item by barcode/name where possible (else flagged NEW).
function scanLineToDraft(pl: ScanLineData, items: Item[]): DraftLine {
  const rawName = String(pl.name ?? "").trim();
  const lname = rawName.toLowerCase();
  const match =
    items.find((i) => i.name.toLowerCase() === lname) ||
    (lname.length >= 3 ? items.find((i) => i.name.toLowerCase().includes(lname) || lname.includes(i.name.toLowerCase())) : undefined);
  const qty = pl.qty != null && pl.qty > 0 ? pl.qty : 1;
  const cost = pl.cost != null && pl.cost > 0 ? pl.cost : pl.amount != null && qty > 0 ? Number(pl.amount) / qty : 0;
  if (match) {
    const cs = match.caseSize && match.caseSize > 1 ? match.caseSize : 1;
    return {
      key: uid(),
      itemId: match.id,
      name: match.name,
      barcode: match.barcode,
      unit: match.unit || "pcs",
      isNew: false,
      purchaseUnit: cs > 1 ? "case" : "unit",
      caseSize: cs > 1 ? String(cs) : "",
      qty: String(qty),
      cost: cost ? String(cost) : "",
      sellPrice: match.price ? String(match.price) : "",
      mrp: match.mrp ? String(match.mrp) : "",
    };
  }
  return {
    key: uid(),
    name: rawName || "Item",
    unit: "pcs",
    isNew: true,
    purchaseUnit: "unit",
    caseSize: "",
    qty: String(qty),
    cost: cost ? String(cost) : "",
    sellPrice: "",
    mrp: pl.mrp != null && pl.mrp > 0 ? String(pl.mrp) : "",
  };
}

const n = (s: string) => {
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

// Derived per-line numbers shared by the UI and the save path.
function lineCalc(l: DraftLine) {
  const cs = l.purchaseUnit === "case" ? Math.max(1, n(l.caseSize)) : 1;
  const qty = n(l.qty);
  const cost = n(l.cost);
  const baseQty = qty * cs;
  const costPerBase = cs > 0 ? cost / cs : cost;
  const lineTotal = qty * cost;
  return { cs, qty, cost, baseQty, costPerBase, lineTotal };
}

function fmt(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function StockInPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [initial, setInitial] = useState<StockInInitial | undefined>(undefined);
  const [scanning, setScanning] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null); // capture from camera
  const fileRef = useRef<HTMLInputElement>(null); // pick existing file/photo
  const toast = useToast();

  async function refresh() {
    try {
      setPurchases(await getPurchases());
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to load purchases.", "error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openManual() {
    setInitial(undefined);
    setFormOpen(true);
  }

  async function onScanPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setScanning(true);
    try {
      // Keep bills legible for OCR (larger than a normal thumbnail).
      const dataUrl = await compressImage(file, 2000, 0.85);
      const res = await fetch("/api/scan-purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed.");
      const items = await getItems().catch(() => [] as Item[]);
      const lines: DraftLine[] = Array.isArray(data.lines) ? data.lines.map((pl: ScanLineData) => scanLineToDraft(pl, items)) : [];
      if (lines.length === 0) {
        toast("Couldn't read any items — try a clearer photo, or add manually.", "error");
        return;
      }
      setInitial({
        vendorName: data.vendorName || undefined,
        invoiceNumber: data.invoiceNumber || undefined,
        invoiceImage: dataUrl,
        source: "ocr",
        lines,
      });
      setFormOpen(true);
      toast(`Scanned ${lines.length} item${lines.length === 1 ? "" : "s"} — review & save.`, "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Scan failed.", "error");
    } finally {
      setScanning(false);
    }
  }

  async function deleteOne(p: Purchase) {
    if (!window.confirm(`Delete stock-in #${p.number} (${money(p.total)})? This removes the added stock and reverses any vendor balance.`)) return;
    try {
      await deletePurchase(p);
      toast(`Stock-in #${p.number} deleted.`, "ok");
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to delete.", "error");
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader title="Stock In" subtitle="Record purchases — add stock, track what you paid and owe each vendor." />

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onScanPick} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*" onChange={onScanPick} className="hidden" />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setChooserOpen(true)} disabled={scanning} className="btn-primary gap-1.5">
          {scanning ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {scanning ? "Scanning…" : "Scan bill (AI)"}
        </button>
        <button onClick={openManual} disabled={scanning} className="btn-ghost gap-1.5">
          <Plus size={16} /> Manual
        </button>
      </div>

      {/* source chooser: camera vs file */}
      {chooserOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setChooserOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full space-y-2.5 rounded-t-2xl bg-white p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-pop sm:max-w-sm sm:rounded-card sm:pb-5"
          >
            <div className="flex items-center justify-between">
              <p className="text-base font-bold text-ink">Scan a bill</p>
              <button onClick={() => setChooserOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
                <X size={18} />
              </button>
            </div>
            <button
              onClick={() => {
                setChooserOpen(false);
                cameraRef.current?.click();
              }}
              className="flex w-full items-center gap-3 rounded-tile border border-line-input px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-canvas"
            >
              <Camera size={18} className="text-brand" /> Take a photo
            </button>
            <button
              onClick={() => {
                setChooserOpen(false);
                fileRef.current?.click();
              }}
              className="flex w-full items-center gap-3 rounded-tile border border-line-input px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-canvas"
            >
              <Upload size={18} className="text-brand" /> Choose from files
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="card p-10 text-center text-sm text-muted-light">Loading…</div>
      ) : purchases.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 p-12 text-center">
          <PackagePlus size={26} className="text-line-input" />
          <p className="text-sm text-muted">No purchases yet. Record your first stock-in.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {purchases.map((p) => {
            const credit = p.credit ?? 0;
            return (
              <div key={p.id} className="card flex items-center gap-3 p-3.5">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-tile bg-brand-soft text-brand">
                  <Truck size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">
                    {p.vendorName || "Vendor"} <span className="text-muted-light">· #{p.number}</span>
                  </p>
                  <p className="truncate text-[11.5px] text-muted-light">
                    {fmt(p.createdAt)} · {p.lines.length} item{p.lines.length === 1 ? "" : "s"}
                    {p.invoiceNumber ? ` · Inv ${p.invoiceNumber}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-ink">{money(p.total)}</p>
                  {credit > 0 ? (
                    <p className="text-[10.5px] font-semibold text-amber-deep">{money(credit)} due</p>
                  ) : (
                    <p className="text-[10.5px] text-ok">paid</p>
                  )}
                </div>
                <button onClick={() => deleteOne(p)} title="Delete stock-in" className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-muted-light hover:bg-canvas hover:text-danger">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {formOpen && <StockInForm initial={initial} onClose={() => setFormOpen(false)} onSaved={refresh} />}
    </div>
  );
}

function StockInForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: StockInInitial;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorName, setVendorName] = useState(initial?.vendorName ?? "");
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [vendorFocus, setVendorFocus] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(initial?.invoiceNumber ?? "");
  const [invoiceImage] = useState<string | undefined>(initial?.invoiceImage);
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(initial?.lines ?? []);
  const [discount, setDiscount] = useState("");
  const [payCash, setPayCash] = useState("");
  const [payUpi, setPayUpi] = useState("");
  const [payCard, setPayCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const fromScan = initial?.source === "ocr";
  // Live mirror of lines so the (long-lived) scanner callback never reads stale state.
  const linesRef = useRef<DraftLine[]>(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    getItems().then(setItems).catch(() => setItems([]));
    getVendors()
      .then((vs) => {
        setVendors(vs);
        // Auto-link a scanned vendor name to an existing vendor record.
        if (initial?.vendorName) {
          const m = vs.find((v) => v.name.trim().toLowerCase() === initial.vendorName!.trim().toLowerCase());
          if (m) {
            setVendorId(m.id);
            setVendorName(m.name);
          }
        }
      })
      .catch(() => setVendors([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const itemMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return items
      .filter((i) => i.name.toLowerCase().includes(q) || (i.barcode || "").includes(query.trim()))
      .slice(0, 6);
  }, [items, query]);

  const vendorMatches = useMemo(() => {
    const q = vendorName.trim().toLowerCase();
    if (!q) return vendors.slice(0, 6);
    return vendors
      .filter((v) => v.name.toLowerCase().includes(q) || (v.company || "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [vendors, vendorName]);

  function addExisting(it: Item) {
    setLines((prev) => [
      ...prev,
      {
        key: uid(),
        itemId: it.id,
        name: it.name,
        barcode: it.barcode,
        unit: it.unit || "pcs",
        isNew: false,
        purchaseUnit: it.caseSize && it.caseSize > 1 ? "case" : "unit",
        caseSize: it.caseSize ? String(it.caseSize) : "",
        qty: "1",
        cost: it.costPrice ? String(it.costPrice * (it.caseSize && it.caseSize > 1 ? it.caseSize : 1)) : "",
        sellPrice: it.price ? String(it.price) : "",
        mrp: it.mrp ? String(it.mrp) : "",
      },
    ]);
    setQuery("");
    searchRef.current?.focus();
  }

  function addNew() {
    const name = query.trim();
    setLines((prev) => [
      ...prev,
      {
        key: uid(),
        name: name || "New item",
        unit: "pcs",
        isNew: true,
        purchaseUnit: "unit",
        caseSize: "",
        qty: "1",
        cost: "",
        sellPrice: "",
        mrp: "",
      },
    ]);
    setQuery("");
    searchRef.current?.focus();
  }

  function patch(key: string, p: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  }
  function remove(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  // Buy-unit options for a line: the base unit + every pack defined on the
  // catalogue item (case/bag/tin). New items (no catalogue packs) fall back to
  // a base/case toggle below.
  function buyOptions(l: DraftLine): { id: string; label: string; baseQty: number }[] {
    const it = l.itemId ? items.find((i) => i.id === l.itemId) : undefined;
    const base = { id: "base", label: l.unit || "unit", baseQty: 1 };
    const packs = (it?.packs ?? []).map((p) => ({ id: p.id, label: p.label, baseQty: p.baseQty }));
    return [base, ...packs];
  }

  // Switch the buy unit (base ↔ a pack). Reconverts the entered cost so a
  // per-case figure isn't misread as per-unit, and seeds a cost hint from the
  // item's known cost price when the field is still empty.
  function setBuyUnit(l: DraftLine, optId: string) {
    if ((l.packId ?? "base") === optId) return;
    const opts = buyOptions(l);
    const opt = opts.find((o) => o.id === optId) ?? opts[0];
    const isPack = opt.id !== "base";
    const newCs = isPack ? Math.max(1, opt.baseQty) : 1;
    const oldCs = l.purchaseUnit === "case" ? Math.max(1, n(l.caseSize)) : 1;
    const cur = n(l.cost);
    let cost = l.cost;
    if (cur > 0) {
      cost = String(round2((cur / oldCs) * newCs)); // keep cost-per-base constant
    } else {
      const it = l.itemId ? items.find((i) => i.id === l.itemId) : undefined;
      if (it?.costPrice) cost = String(round2(it.costPrice * newCs));
    }
    patch(l.key, {
      purchaseUnit: isPack ? "case" : "unit",
      packId: isPack ? opt.id : undefined,
      packLabel: isPack ? opt.label : undefined,
      caseSize: isPack ? String(newCs) : "",
      cost,
    });
  }

  // Base/case toggle for new (non-catalogue) items, where units-per-case is
  // hand-entered. Converts the cost so it isn't misread when flipping.
  function toggleCase(l: DraftLine, target: "unit" | "case") {
    if (l.purchaseUnit === target) return;
    const cs = Math.max(1, n(l.caseSize));
    const cur = n(l.cost);
    let cost = l.cost;
    if (cur > 0 && cs > 1) cost = String(target === "case" ? round2(cur * cs) : round2(cur / cs));
    patch(l.key, { purchaseUnit: target, packId: undefined, packLabel: target === "case" ? "Case" : undefined, cost });
  }

  // Barcode scanned while receiving: bump an already-added line, add a known
  // item, or drop in a NEW line carrying the barcode to fill in.
  function handleScanAdd(code: string) {
    const existing = linesRef.current.find((l) => l.barcode === code);
    if (existing) {
      patch(existing.key, { qty: String(n(existing.qty) + 1) });
      toast(`+1 ${existing.name || code}`, "ok");
      return;
    }
    const item = items.find((i) => i.barcode === code);
    if (item) {
      addExisting(item);
      toast(`Added ${item.name}`, "ok");
      return;
    }
    setLines((prev) => [
      ...prev,
      { key: uid(), name: "", barcode: code, unit: "pcs", isNew: true, purchaseUnit: "unit", caseSize: "", qty: "1", cost: "", sellPrice: "", mrp: "" },
    ]);
    toast(`New barcode ${code} — fill name & price below`, "ok");
  }

  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineCalc(l).lineTotal, 0), [lines]);
  const total = Math.max(0, subtotal - n(discount));
  const paid = n(payCash) + n(payUpi) + n(payCard);
  const credit = Math.max(0, total - paid);

  function pickVendor(v: Vendor) {
    setVendorId(v.id);
    setVendorName(v.name);
    setVendorFocus(false);
  }

  async function save() {
    if (lines.length === 0) {
      toast("Add at least one item.", "error");
      return;
    }
    for (const l of lines) {
      const c = lineCalc(l);
      if (c.qty <= 0) {
        toast(`Enter a quantity for ${l.name}.`, "error");
        return;
      }
      if (l.purchaseUnit === "case" && c.cs <= 1) {
        toast(`Enter units per case for ${l.name}.`, "error");
        return;
      }
      // New items must have a sell price, else they'd sell at cost (0 margin).
      if (l.isNew && n(l.sellPrice) <= 0) {
        toast(`Set a sell price for new item “${l.name}”.`, "error");
        return;
      }
    }
    // A balance left on credit must be tied to a named vendor.
    if (credit > 0 && !vendorName.trim()) {
      toast("Enter a vendor — there's a balance left on credit.", "error");
      return;
    }
    setBusy(true);
    try {
      const purchaseLines: PurchaseLine[] = lines.map((l) => {
        const c = lineCalc(l);
        return {
          itemId: l.itemId,
          name: l.name.trim() || "Item",
          barcode: l.barcode,
          unit: l.unit,
          purchaseUnit: l.purchaseUnit,
          packId: l.purchaseUnit === "case" ? l.packId : undefined,
          packLabel: l.purchaseUnit === "case" ? l.packLabel || "Case" : undefined,
          caseSize: c.cs,
          qty: c.qty,
          baseQty: c.baseQty,
          cost: c.cost,
          costPerBase: c.costPerBase,
          sellPrice: l.isNew ? n(l.sellPrice) || undefined : undefined,
          casePrice: l.isNew && l.purchaseUnit === "case" && n(l.sellPrice) > 0 ? n(l.sellPrice) * c.cs : undefined,
          mrp: l.isNew ? n(l.mrp) || undefined : undefined,
        };
      });

      const number = await nextPurchaseNumber();
      const purchase: Purchase = {
        id: uid(),
        number,
        createdAt: Date.now(),
        vendorId: vendorId ?? undefined,
        vendorName: vendorName.trim() || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        invoiceImageUrl: invoiceImage,
        lines: purchaseLines,
        subtotal,
        discount: n(discount),
        total,
        payment: { cash: n(payCash), upi: n(payUpi), card: n(payCard) },
        credit,
        source: fromScan ? "ocr" : "manual",
        status: "posted",
      };
      await recordPurchase(purchase);
      toast(`Stock-in #${number} saved.`, "ok");
      onSaved();
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save stock-in.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas sm:items-center sm:justify-center sm:bg-black/50 sm:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden bg-canvas sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-card sm:shadow-pop">
      {/* header */}
      <div className="flex items-center justify-between border-b border-line bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          {invoiceImage && <BillThumb src={invoiceImage} size={32} />}
          <div>
            <p className="text-base font-bold text-ink">New stock-in</p>
            {fromScan && (
              <span className="flex items-center gap-1 text-[11px] font-semibold text-brand">
                <Sparkles size={11} /> AI scanned — review &amp; save
              </span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-light hover:bg-canvas">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-4 p-4">
        {/* vendor + invoice */}
        <div className="card space-y-2.5 p-4">
          <div className="relative">
            <span className="eyebrow">Vendor</span>
            <input
              value={vendorName}
              onChange={(e) => {
                setVendorName(e.target.value);
                setVendorId(null);
              }}
              onFocus={() => setVendorFocus(true)}
              onBlur={() => setTimeout(() => setVendorFocus(false), 150)}
              placeholder="Vendor name"
              className="input mt-1"
            />
            {vendorFocus && vendorMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-tile border border-line bg-white shadow-pop">
                {vendorMatches.map((v) => (
                  <button
                    key={v.id}
                    onMouseDown={() => pickVendor(v)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas"
                  >
                    <Truck size={14} className="text-muted-light" />
                    <span className="flex-1 truncate">{v.name}</span>
                    {v.balance > 0 && <span className="text-[11px] text-amber-deep">{money(v.balance)} due</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <span className="eyebrow">Invoice no. (optional)</span>
            <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Vendor's bill number" className="input mt-1" />
          </div>
        </div>

        {/* item search */}
        <div className="card p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-light" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search item to add…"
                className="input pl-10"
              />
            </div>
            <button onClick={() => setScanOpen(true)} className="btn-ghost flex-none px-3" title="Scan barcode">
              <ScanLine size={18} />
            </button>
          </div>
          {query.trim() && (
            <div className="mt-2 space-y-1">
              {itemMatches.map((it) => (
                <button
                  key={it.id}
                  onClick={() => addExisting(it)}
                  className="flex w-full items-center gap-2 rounded-tile border border-line-soft px-3 py-2 text-left text-sm hover:bg-canvas"
                >
                  <Package size={14} className="text-muted-light" />
                  <span className="flex-1 truncate">{it.name}</span>
                  <span className="text-[11px] text-muted-light">stock {it.stock ?? 0}</span>
                </button>
              ))}
              <button onClick={addNew} className="flex w-full items-center gap-2 rounded-tile border border-dashed border-brand/40 px-3 py-2 text-left text-sm text-brand hover:bg-brand-soft">
                <Plus size={14} /> Add “{query.trim()}” as new product
              </button>
            </div>
          )}
        </div>

        {/* lines */}
        {lines.length > 0 && (
          <div className="space-y-2">
            {lines.map((l) => {
              const c = lineCalc(l);
              const opts = buyOptions(l);
              const hasPacks = opts.length > 1; // catalogue item with defined packs
              const puLabel = l.purchaseUnit === "case" ? l.packLabel || "case" : l.unit || "unit";
              return (
                <div key={l.key} className="card space-y-2.5 p-3.5">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      {l.isNew ? (
                        <input
                          value={l.name}
                          onChange={(e) => patch(l.key, { name: e.target.value })}
                          placeholder="Item name"
                          className="input h-9 text-sm font-semibold"
                        />
                      ) : (
                        <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
                      )}
                      {l.barcode && <p className="mt-0.5 truncate text-[10.5px] text-muted-light">#{l.barcode}</p>}
                    </div>
                    {l.isNew && <span className="flex-none rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold text-brand">NEW</span>}
                    <button onClick={() => remove(l.key)} className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-muted-light hover:bg-canvas hover:text-danger">
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {/* buy unit: pack picker for catalogue items with packs,
                      else a base/case toggle (new + simple items) */}
                  {hasPacks ? (
                    <label className="block">
                      <span className="text-[11px] text-muted-light">Buying by</span>
                      <select
                        value={l.packId ?? "base"}
                        onChange={(e) => setBuyUnit(l, e.target.value)}
                        className="input mt-0.5 h-10"
                      >
                        {opts.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.id === "base" ? `Loose / ${o.label}` : `${o.label} (${o.baseQty} ${l.unit || "units"})`}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div className="flex gap-1.5 rounded-tile border border-line-input bg-white p-1">
                      {(
                        [
                          ["unit", `By ${l.unit || "unit"}`],
                          ["case", "By case/pack"],
                        ] as const
                      ).map(([m, label]) => (
                        <button
                          key={m}
                          onClick={() => toggleCase(l, m)}
                          className={`flex-1 rounded-[7px] py-1.5 text-xs font-semibold transition ${
                            l.purchaseUnit === m ? "bg-brand text-white shadow-brand" : "text-muted-dark hover:bg-canvas"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-3 gap-2">
                    <label className="block">
                      <span className="text-[11px] text-muted-light">Qty ({l.purchaseUnit === "case" ? `${puLabel}s` : puLabel})</span>
                      <input value={l.qty} onChange={(e) => patch(l.key, { qty: e.target.value })} type="number" min="0" step="any" inputMode="decimal" className="input mt-0.5 h-10 text-right" />
                    </label>
                    {l.purchaseUnit === "case" && (
                      <label className="block">
                        <span className="text-[11px] text-muted-light">{l.unit || "units"}/{puLabel}</span>
                        <input value={l.caseSize} onChange={(e) => patch(l.key, { caseSize: e.target.value })} type="number" min="0" step="any" inputMode="decimal" className="input mt-0.5 h-10 text-right" />
                      </label>
                    )}
                    <label className="block">
                      <span className="text-[11px] text-muted-light">Cost / {puLabel}</span>
                      <input value={l.cost} onChange={(e) => patch(l.key, { cost: e.target.value })} type="number" min="0" step="any" inputMode="decimal" className="input mt-0.5 h-10 text-right" />
                    </label>
                  </div>

                  {l.isNew && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[11px] text-muted-light">Sell price / {l.unit || "unit"}</span>
                        <input value={l.sellPrice} onChange={(e) => patch(l.key, { sellPrice: e.target.value })} type="number" min="0" step="any" inputMode="decimal" className="input mt-0.5 h-10 text-right" />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-muted-light">MRP (optional)</span>
                        <input value={l.mrp} onChange={(e) => patch(l.key, { mrp: e.target.value })} type="number" min="0" step="any" inputMode="decimal" className="input mt-0.5 h-10 text-right" />
                      </label>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-line-soft pt-2 text-[11.5px] text-muted">
                    <span>
                      +{c.baseQty || 0} {l.unit || "units"} to stock · cost {money(c.costPerBase || 0)}/{l.unit || "unit"}
                    </span>
                    <span className="font-bold text-ink">{money(c.lineTotal)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* totals + payment */}
        {lines.length > 0 && (
          <div className="card space-y-3 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="font-semibold text-ink">{money(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted">Discount</span>
              <input value={discount} onChange={(e) => setDiscount(e.target.value)} type="number" min="0" step="any" inputMode="decimal" placeholder="0" className="input h-10 w-28 text-right" />
            </div>
            <div className="flex items-center justify-between border-t border-line-soft pt-2 text-base">
              <span className="font-semibold text-ink">Total</span>
              <span className="font-bold text-ink">{money(total)}</span>
            </div>

            <div className="space-y-2 border-t border-line-soft pt-3">
              <span className="eyebrow">Paid now</span>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  <span className="text-[11px] text-muted-light">Cash</span>
                  <input value={payCash} onChange={(e) => setPayCash(e.target.value)} type="number" min="0" step="any" inputMode="decimal" placeholder="0" className="input mt-0.5 h-10 text-right" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-light">UPI</span>
                  <input value={payUpi} onChange={(e) => setPayUpi(e.target.value)} type="number" min="0" step="any" inputMode="decimal" placeholder="0" className="input mt-0.5 h-10 text-right" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-muted-light">Card</span>
                  <input value={payCard} onChange={(e) => setPayCard(e.target.value)} type="number" min="0" step="any" inputMode="decimal" placeholder="0" className="input mt-0.5 h-10 text-right" />
                </label>
              </div>
              <button onClick={() => setPayCash(String(total))} className="text-xs font-semibold text-brand hover:underline">
                Paid in full (cash)
              </button>
            </div>

            <div className="flex items-center justify-between border-t border-line-soft pt-2 text-sm">
              <span className="text-muted">Balance to vendor</span>
              <span className={`font-bold ${credit > 0 ? "text-amber-deep" : "text-ok"}`}>{money(credit)}</span>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* footer */}
      <div className="border-t border-line bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <button onClick={save} disabled={busy || lines.length === 0} className="btn-primary mx-auto block w-full max-w-2xl">
          {busy ? "Saving…" : `Save stock-in · ${money(total)}`}
        </button>
      </div>
      </div>

      <ScannerModal open={scanOpen} onClose={() => setScanOpen(false)} onDetect={handleScanAdd} keepOpen title="Scan items to add" />
    </div>
  );
}
