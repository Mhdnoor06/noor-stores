// Supabase-backed data access for items. (Bills & settings still use
// lib/storage.ts for now — only the items path has moved to the database, to
// support barcode add/lookup.)

import { supabase } from "./supabase";
import { Bill, BillLine, DEFAULT_SETTINGS, Item, Settings } from "./types";

type ItemRow = {
  id: string;
  name: string;
  price: number | string;
  size: string | null;
  code: string | null;
  barcode: string | null;
  stock: number | null;
  reorder_level: number | null;
};

function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    name: r.name,
    price: Number(r.price),
    size: r.size ?? undefined,
    code: r.code ?? undefined,
    barcode: r.barcode ?? undefined,
    stock: r.stock ?? 0,
    reorderLevel: r.reorder_level ?? 0,
  };
}

function itemToRow(item: Item) {
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    size: item.size ?? null,
    code: item.code ?? null,
    barcode: item.barcode ?? null,
    stock: item.stock ?? 0,
    reorder_level: item.reorderLevel ?? 0,
  };
}

// Decrements stock for each sold line. Non-atomic (fetch then update) which is
// fine for a single shop; allows stock to go negative rather than blocking a
// sale. Failures are swallowed so a stock hiccup never blocks billing.
export async function recordSale(
  lines: { itemId: string; qty: number }[]
): Promise<void> {
  if (lines.length === 0) return;
  const ids = lines.map((l) => l.itemId);
  const { data } = await supabase.from("items").select("id, stock").in("id", ids);
  const stockMap = new Map(
    (data ?? []).map((r) => [r.id as string, (r.stock as number) ?? 0])
  );
  await Promise.all(
    lines.map((l) =>
      supabase
        .from("items")
        .update({ stock: (stockMap.get(l.itemId) ?? 0) - l.qty })
        .eq("id", l.itemId)
    )
  );
}

// Short client-generated id (kept identical in shape to the old localStorage
// uid so existing references stay valid).
export function uid(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

export async function getItems(): Promise<Item[]> {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as ItemRow[]).map(rowToItem);
}

// Looks up a single item by its scanned barcode. Returns null if none match.
export async function getItemByBarcode(barcode: string): Promise<Item | null> {
  const code = barcode.trim();
  if (!code) return null;
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("barcode", code)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToItem(data as ItemRow) : null;
}

export async function upsertItem(item: Item): Promise<void> {
  const { error } = await supabase.from("items").upsert(itemToRow(item));
  if (error) throw new Error(error.message);
}

export async function deleteItem(id: string): Promise<void> {
  const { error } = await supabase.from("items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/* ----------------------------- Bills ----------------------------- */

type BillRow = {
  id: string;
  number: number;
  customer_name: string | null;
  customer_phone: string | null;
  total: number | string;
  lines: BillLine[];
  created_at: string;
};

function rowToBill(r: BillRow): Bill {
  return {
    id: r.id,
    number: r.number,
    createdAt: new Date(r.created_at).getTime(),
    customerName: r.customer_name ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    lines: r.lines ?? [],
    total: Number(r.total),
  };
}

export async function getBills(): Promise<Bill[]> {
  const { data, error } = await supabase
    .from("bills")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as BillRow[]).map(rowToBill);
}

export async function saveBill(bill: Bill): Promise<void> {
  const { error } = await supabase.from("bills").insert({
    id: bill.id,
    number: bill.number,
    customer_name: bill.customerName ?? null,
    customer_phone: bill.customerPhone ?? null,
    total: bill.total,
    lines: bill.lines,
    created_at: new Date(bill.createdAt).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function nextBillNumber(): Promise<number> {
  const { data, error } = await supabase
    .from("bills")
    .select("number")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.number ?? 0) + 1;
}

/* --------------------------- Settings ---------------------------- */

type SettingsRow = {
  business_name: string;
  address: string;
  phone: string;
  gstin: string;
  footer: string;
  paper_width: number;
  printer_name: string;
};

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) return { ...DEFAULT_SETTINGS };
  const r = data as SettingsRow;
  return {
    businessName: r.business_name,
    address: r.address,
    phone: r.phone,
    gstin: r.gstin,
    footer: r.footer,
    paperWidth: r.paper_width,
    printerName: r.printer_name,
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  const { error } = await supabase.from("settings").upsert({
    id: 1,
    business_name: s.businessName,
    address: s.address,
    phone: s.phone,
    gstin: s.gstin,
    footer: s.footer,
    paper_width: s.paperWidth,
    printer_name: s.printerName,
  });
  if (error) throw new Error(error.message);
}
