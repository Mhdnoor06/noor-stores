"use client";

import { Item } from "@/lib/types";
import { money } from "@/lib/escpos";
import { perUnit } from "@/lib/units";
import { Plus, Minus } from "lucide-react";

// A product row in the New Bill picker. Reflects cart state inline: when the
// item is in the bill it highlights and shows a quantity stepper, so the
// cashier always sees what's added without leaving the list.
export default function PickerRow({
  item,
  qty,
  onAdd,
  onDec,
}: {
  item: Item;
  qty: number;
  onAdd: (item: Item) => void;
  onDec: (item: Item) => void;
}) {
  const inCart = qty > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onAdd(item)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onAdd(item)}
      className={`flex cursor-pointer items-center gap-3 rounded-tile border px-3 py-2.5 transition ${
        inCart ? "border-brand bg-brand-soft/60" : "border-line bg-white hover:border-brand/50"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {item.name}
          {item.size ? <span className="font-normal text-muted-light"> · {item.size}</span> : null}
        </p>
        <p className="text-[12.5px] font-bold text-brand">
          {money(item.price)}
          <span className="ml-0.5 text-[10px] font-normal text-muted-light">{perUnit(item.unit)}</span>
        </p>
      </div>

      {inCart ? (
        <div className="flex flex-none items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => onDec(item)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line-input bg-white text-muted-dark hover:bg-canvas"
            aria-label="Decrease"
          >
            <Minus size={15} />
          </button>
          <span className="w-6 text-center text-sm font-bold tabular-nums text-ink">{qty}</span>
          <button
            onClick={() => onAdd(item)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white shadow-brand hover:bg-brand-dark"
            aria-label="Increase"
          >
            <Plus size={15} />
          </button>
        </div>
      ) : (
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-soft text-brand">
          <Plus size={16} strokeWidth={2.4} />
        </span>
      )}
    </div>
  );
}
