"use client";

import { BillLine } from "@/lib/types";
import { money } from "@/lib/escpos";

export default function BillItem({
  line,
  onQty,
  onRemove,
}: {
  line: BillLine;
  onQty: (itemId: string, delta: number) => void;
  onRemove: (itemId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line-soft py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink">
          {line.name}
          {line.size ? (
            <span className="ml-1 font-normal text-muted-light">· {line.size}</span>
          ) : null}
        </p>
        <p className="text-xs text-muted-light">
          {money(line.price)} × {line.qty} ={" "}
          <span className="font-semibold text-muted-dark">
            {money(line.price * line.qty)}
          </span>
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onQty(line.itemId, -1)}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-lg text-muted-dark hover:bg-cream"
          aria-label="Decrease"
        >
          −
        </button>
        <span className="w-7 text-center text-sm font-bold">{line.qty}</span>
        <button
          onClick={() => onQty(line.itemId, 1)}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-line text-lg text-muted-dark hover:bg-cream"
          aria-label="Increase"
        >
          +
        </button>
      </div>
      <button
        onClick={() => onRemove(line.itemId)}
        className="text-xs font-medium text-danger hover:underline"
      >
        Remove
      </button>
    </div>
  );
}
