"use client";

import { Item } from "@/lib/types";
import { money } from "@/lib/escpos";
import { perUnit } from "@/lib/units";

export default function ItemCard({
  item,
  onAdd,
}: {
  item: Item;
  onAdd: (item: Item) => void;
}) {
  return (
    <button
      onClick={() => onAdd(item)}
      className="flex flex-col items-start rounded-tile border border-line bg-white p-3 text-left shadow-card transition hover:border-brand hover:shadow-sm active:scale-[.98]"
    >
      <span className="line-clamp-2 text-sm font-semibold text-ink">
        {item.name}
      </span>
      {item.size ? (
        <span className="text-xs text-muted-light">{item.size}</span>
      ) : null}
      <span className="mt-1 text-sm font-bold text-brand">
        {money(item.price)}
        <span className="ml-0.5 text-[10px] font-normal text-muted-light">
          {perUnit(item.unit)}
        </span>
      </span>
    </button>
  );
}
