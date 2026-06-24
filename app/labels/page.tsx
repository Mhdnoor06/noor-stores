"use client";

import { useEffect, useMemo, useState } from "react";
import { getItems, upsertItem } from "@/lib/db";
import { Item } from "@/lib/types";
import { money, buildLabels } from "@/lib/escpos";
import { perUnit } from "@/lib/units";
import { generateInternalBarcode, isInternalBarcode } from "@/lib/barcode";
import { useBluetooth } from "@/components/PrinterProvider";
import PageHeader from "@/components/PageHeader";
import Barcode from "@/components/Barcode";
import { Printer, FileDown, Sparkles, CheckSquare, Square } from "lucide-react";

export default function LabelsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { isConnected, print, connect, supported, status } = useBluetooth();

  async function refresh() {
    const data = await getItems();
    setItems(data);
    setSelected(new Set(data.filter((i) => isInternalBarcode(i.barcode)).map((i) => i.id)));
  }
  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  // Only in-store ("20"-prefixed) barcodes need labels — products that came with
  // their own printed barcode are skipped. `missing` = no barcode at all yet.
  const labelled = useMemo(() => items.filter((i) => isInternalBarcode(i.barcode)), [items]);
  const missing = useMemo(() => items.filter((i) => !i.barcode), [items]);
  const chosen = labelled.filter((i) => selected.has(i.id));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === labelled.length ? new Set() : new Set(labelled.map((i) => i.id))));
  }

  async function genMissing() {
    setBusy(true);
    setMsg("");
    try {
      const existing = new Set(items.map((i) => i.barcode).filter(Boolean) as string[]);
      for (const it of missing) {
        const bc = generateInternalBarcode(existing);
        existing.add(bc);
        await upsertItem({ ...it, barcode: bc });
      }
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
      await print(buildLabels(chosen));
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
        subtitle="Labels for in-store items (no printed barcode). Scanned products already have their own."
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
          No in-store labels needed yet. Items added without a barcode get an internal one — those show up
          here to print. Use “Generate missing” if any are still without a barcode.
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
            {labelled.map((i) => {
              const on = selected.has(i.id);
              return (
                <div
                  key={i.id}
                  onClick={() => toggle(i.id)}
                  className={`label-cell flex cursor-pointer flex-col items-center rounded-tile border bg-white p-3 text-center transition ${
                    on ? "border-brand" : "border-line opacity-60 print:hidden"
                  }`}
                >
                  <p className="mb-1 line-clamp-2 text-[12px] font-bold leading-tight text-ink">{i.name}</p>
                  <Barcode value={i.barcode!} height={42} width={1.6} fontSize={12} />
                  <p className="mt-1 text-[12px] font-semibold text-ink">
                    {money(i.price)}
                    <span className="text-[10px] font-normal text-muted-light"> {perUnit(i.unit)}</span>
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
