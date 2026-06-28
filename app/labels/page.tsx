"use client";

import { useEffect, useMemo, useState } from "react";
import { getItems, upsertItem } from "@/lib/db";
import { Item } from "@/lib/types";
import { money, buildLabelCards } from "@/lib/escpos";
import { perUnit } from "@/lib/units";
import { generateInternalBarcode, isInternalBarcode } from "@/lib/barcode";
import { useBluetooth } from "@/components/PrinterProvider";
import PageHeader from "@/components/PageHeader";
import Barcode from "@/components/Barcode";
import { Printer, FileDown, Sparkles, CheckSquare, Square } from "lucide-react";

// A printable target — either an item's base unit or one of its packs. Packs
// (cases/bundles) often have no barcode, so we mint internal ones and print
// labels so they can be scanned at billing/stock-in.
type Target = {
  key: string;
  itemId: string;
  packId?: string;
  name: string;
  barcode?: string;
  price: number;
  unit?: string;
};

export default function LabelsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { isConnected, print, connect, supported, status } = useBluetooth();

  // Flatten the catalogue into label targets: base unit + each pack.
  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    for (const i of items) {
      out.push({ key: i.id, itemId: i.id, name: i.name, barcode: i.barcode, price: i.price, unit: i.unit });
      for (const p of i.packs ?? []) {
        out.push({
          key: `${i.id}:${p.id}`,
          itemId: i.id,
          packId: p.id,
          name: `${i.name} (${p.label})`,
          barcode: p.barcode,
          // Retail label price: base retail × pack size (older packs may still
          // carry an explicit retailPrice).
          price: p.retailPrice && p.retailPrice > 0 ? p.retailPrice : (i.price || 0) * p.baseQty,
          unit: p.label,
        });
      }
    }
    return out;
  }, [items]);

  async function refresh() {
    const data = await getItems();
    setItems(data);
  }
  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  // Pre-select every internal-barcoded target once items load.
  useEffect(() => {
    setSelected(new Set(targets.filter((t) => isInternalBarcode(t.barcode)).map((t) => t.key)));
  }, [targets]);

  // Only in-store ("20"-prefixed) barcodes need labels — units/packs that came
  // with their own printed barcode are skipped. `missing` = no barcode yet.
  const labelled = useMemo(() => targets.filter((t) => isInternalBarcode(t.barcode)), [targets]);
  const missing = useMemo(() => targets.filter((t) => !t.barcode), [targets]);
  const chosen = labelled.filter((t) => selected.has(t.key));

  function toggle(key: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === labelled.length ? new Set() : new Set(labelled.map((t) => t.key))));
  }

  async function genMissing() {
    setBusy(true);
    setMsg("");
    try {
      const existing = new Set(
        items.flatMap((i) => [i.barcode, ...(i.packs ?? []).map((p) => p.barcode)]).filter(Boolean) as string[]
      );
      // Mint codes, grouping edits per item so multiple packs on one item are
      // written in a single upsert.
      const edits = new Map<string, Item>();
      for (const t of missing) {
        const bc = generateInternalBarcode(existing);
        existing.add(bc);
        const base = edits.get(t.itemId) ?? { ...items.find((i) => i.id === t.itemId)! };
        if (t.packId) {
          base.packs = (base.packs ?? []).map((p) => (p.id === t.packId ? { ...p, barcode: bc } : p));
        } else {
          base.barcode = bc;
        }
        edits.set(t.itemId, base);
      }
      for (const it of edits.values()) await upsertItem(it);
      await refresh();
      setMsg(`Generated ${missing.length} barcode(s).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function printThermal() {
    if (chosen.length === 0) return;
    setMsg("");
    if (!isConnected) {
      setMsg("Printer not connected — connect first.");
      return;
    }
    setBusy(true);
    try {
      await print(buildLabelCards(chosen.map((t) => ({ name: t.name, barcode: t.barcode as string, price: t.price, unit: t.unit }))));
      setMsg(`Sent ${chosen.length} label(s) to the printer.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Print failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="print:hidden">
      <PageHeader
        title="Barcode Labels"
        subtitle="Labels for in-store items & no-barcode packs. Scanned products already have their own."
        action={
          <div className="flex flex-wrap gap-2">
            {missing.length > 0 && (
              <button onClick={genMissing} disabled={busy} className="btn-ghost h-10">
                <Sparkles size={16} /> Generate {missing.length} missing
              </button>
            )}
            {!isConnected && supported && (
              <button onClick={() => connect()} disabled={status === "connecting"} className="btn-soft h-10">
                {status === "connecting" ? "Connecting…" : "Connect printer"}
              </button>
            )}
            <button onClick={printThermal} disabled={busy || chosen.length === 0} className="btn-ghost h-10">
              <Printer size={16} /> Thermal ({chosen.length})
            </button>
            <button onClick={() => window.print()} disabled={chosen.length === 0} className="btn-primary h-10">
              <FileDown size={16} /> A4 Sheet ({chosen.length})
            </button>
          </div>
        }
      />
      </div>

      {msg && <div className="rounded-tile bg-brand-soft px-3.5 py-2.5 text-sm font-medium text-brand print:hidden">{msg}</div>}

      {labelled.length === 0 ? (
        <div className="card p-12 text-center text-sm text-muted-light print:hidden">
          No in-store labels needed yet. Items and packs added without a barcode get an internal one — those show
          up here to print. Use “Generate missing” if any are still without a barcode.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between print:hidden">
            <button onClick={toggleAll} className="inline-flex items-center gap-2 text-sm font-semibold text-muted-dark hover:text-ink">
              {selected.size === labelled.length ? <CheckSquare size={17} className="text-brand" /> : <Square size={17} />}
              Select all ({chosen.length}/{labelled.length})
            </button>
            <span className="text-xs text-muted-light">Tip: A4 sheet → print to PDF or take to a print shop.</span>
          </div>

          {/* printable label grid */}
          <div className="print-area grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
            {labelled.map((t) => {
              const on = selected.has(t.key);
              return (
                <div
                  key={t.key}
                  onClick={() => toggle(t.key)}
                  className={`label-cell flex cursor-pointer flex-col items-center rounded-tile border bg-white p-3 text-center transition ${
                    on ? "border-brand" : "border-line opacity-60 print:hidden"
                  }`}
                >
                  <p className="mb-1 line-clamp-2 text-[12px] font-bold leading-tight text-ink">{t.name}</p>
                  <Barcode value={t.barcode!} height={42} width={1.6} fontSize={12} />
                  <p className="mt-1 text-[12px] font-semibold text-ink">
                    {money(t.price)}
                    <span className="text-[10px] font-normal text-muted-light"> {perUnit(t.unit)}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
