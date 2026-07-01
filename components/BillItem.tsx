"use client";

import { Minus, Plus, X } from "lucide-react";
import { BillLine } from "@/lib/types";
import { money } from "@/lib/escpos";
import { isMeasured, perUnit } from "@/lib/units";
import NumInput from "@/components/NumInput";

export default function BillItem({
  line,
  levels,
  onQty,
  onSetQty,
  onSetPrice,
  onSetUnit,
  onRemove,
}: {
  line: BillLine;
  levels: { id: string; label: string }[];
  onQty: (itemId: string, delta: number) => void;
  onSetQty: (itemId: string, qty: number) => void;
  onSetPrice: (itemId: string, price: number) => void;
  onSetUnit: (itemId: string, levelId: string) => void;
  onRemove: (itemId: string) => void;
}) {
  const measured = isMeasured(line.unit);

  return (
    <div className="flex items-center gap-3 border-t border-line-soft py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">
            {line.name}
            {line.size ? (
              <span className="font-normal text-muted-light"> · {line.size}</span>
            ) : null}
          </p>
          {levels.length > 1 && (
            <select
              value={line.packId ?? "base"}
              onChange={(e) => onSetUnit(line.itemId, e.target.value)}
              className="h-6 flex-none rounded-md border border-line-input bg-white px-1 text-[11px] font-semibold text-brand outline-none focus:border-brand"
              aria-label="Unit"
            >
              {levels.map((lv) => (
                <option key={lv.id} value={lv.id}>
                  {lv.label}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-light">
          <span>₹</span>
          <NumInput
            min="0"
            step="0.01"
            inputMode="decimal"
            value={line.price}
            onValueChange={(v) => onSetPrice(line.itemId, v)}
            className="h-6 w-14 rounded-md border border-line-input bg-white px-1.5 text-xs font-semibold text-ink outline-none focus:border-brand"
            aria-label="Edit price"
          />
          <span>{perUnit(line.unit)} =</span>
          <span className="font-semibold text-muted-dark">
            {money(line.price * line.qty)}
          </span>
        </div>
      </div>

      {measured ? (
        // measured units → type the exact weight/volume
        <div className="flex items-center gap-1">
          <NumInput
            step="any"
            min="0"
            inputMode="decimal"
            value={line.qty}
            onValueChange={(v) => onSetQty(line.itemId, v)}
            className="h-8 w-16 rounded-[9px] border border-line-input bg-white px-2 text-center text-sm font-bold outline-none focus:border-brand"
          />
          <span className="w-6 text-xs font-medium text-muted-light">{line.unit}</span>
        </div>
      ) : (
        // counted units → stepper; tap the number to type quantity directly
        <div className="flex items-center gap-1">
          <button
            onClick={() => onQty(line.itemId, -1)}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line-input text-muted-dark hover:bg-canvas"
            aria-label="Decrease"
          >
            <Minus size={15} />
          </button>
          <NumInput
            step="any"
            min="0"
            inputMode="decimal"
            value={line.qty}
            onValueChange={(v) => onSetQty(line.itemId, v)}
            className="h-8 w-10 rounded-[9px] border border-line-input bg-white px-1 text-center text-sm font-bold outline-none focus:border-brand"
            aria-label="Quantity"
          />
          <button
            onClick={() => onQty(line.itemId, 1)}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line-input text-muted-dark hover:bg-canvas"
            aria-label="Increase"
          >
            <Plus size={15} />
          </button>
        </div>
      )}

      <button
        onClick={() => onRemove(line.itemId)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-light hover:bg-danger-soft hover:text-danger"
        aria-label="Remove"
      >
        <X size={16} />
      </button>
    </div>
  );
}
