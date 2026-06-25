// Supabase-backed data access — items, bills and settings.

import { supabase } from "./supabase";
import {
  Bill,
  BillLine,
  CreditEntry,
  Customer,
  DEFAULT_SETTINGS,
  Item,
  Settings,
  UpiQr,
} from "./types";
import {
  cacheItems,
  cacheSettings,
  enqueueSale,
  getCachedItems,
  getCachedSettings,
  getOutbox,
  isNetworkError,
  isOnline,
  removeFromOutbox,
  seedBillCounter,
  takeBillNumber,
} from "./offline";

type ItemRow = {
  id: string;
  name: string;
  price: number | string;
  unit: string | null;
  category: string | null;
  mrp: number | string | null;
  cost_price: number | string | null;
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
    unit: r.unit ?? "pcs",
    category: r.category ?? undefined,
    mrp: r.mrp != null ? Number(r.mrp) : undefined,
    costPrice: r.cost_price != null ? Number(r.cost_price) : undefined,
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
    unit: item.unit ?? "pcs",
    category: item.category ?? null,
    mrp: item.mrp ?? null,
    cost_price: item.costPrice ?? null,
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
  // Network-first so the catalogue stays fresh, falling back to the local cache
  // when offline so billing/search/scan keep working.
  try {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const items = (data as ItemRow[]).map(rowToItem);
    cacheItems(items);
    return items;
  } catch (e) {
    const cached = getCachedItems();
    if (cached.length) return cached;
    throw e;
  }
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
  customer_id: string | null;
  subtotal: number | string | null;
  discount: number | string | null;
  round_off: number | string | null;
  total: number | string;
  payment_method: string | null;
  amount_paid: number | string | null;
  paid_cash: number | string | null;
  paid_upi: number | string | null;
  paid_card: number | string | null;
  credit: number | string | null;
  lines: BillLine[];
  created_at: string;
};

function num(v: number | string | null | undefined): number {
  return v != null ? Number(v) : 0;
}

function rowToBill(r: BillRow): Bill {
  const cash = num(r.paid_cash);
  const upi = num(r.paid_upi);
  const card = num(r.paid_card);
  const credit = num(r.credit);
  const total = Number(r.total);
  const paid = cash + upi + card;
  return {
    id: r.id,
    number: r.number,
    createdAt: new Date(r.created_at).getTime(),
    customerName: r.customer_name ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    customerId: r.customer_id ?? undefined,
    lines: r.lines ?? [],
    subtotal: r.subtotal != null ? Number(r.subtotal) : undefined,
    discount: r.discount != null ? Number(r.discount) : 0,
    roundOff: r.round_off != null ? Number(r.round_off) : 0,
    total,
    payment: { cash, upi, card },
    credit,
    changeGiven: Math.max(0, paid - total),
    paymentMethod: (r.payment_method as Bill["paymentMethod"]) ?? "cash",
    amountPaid: r.amount_paid != null ? Number(r.amount_paid) : paid,
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
  const pay = bill.payment ?? { cash: 0, upi: 0, card: 0 };
  const paid = pay.cash + pay.upi + pay.card;
  const credit = Math.max(0, bill.credit ?? 0);

  // If any balance is on credit, make sure it lands on a customer's udhaar.
  let customerId = bill.customerId;
  if (credit > 0) {
    const c = await ensureCustomer(bill.customerName, bill.customerPhone, bill.customerId);
    customerId = c.id;
  }

  // Derive the legacy single-method field from the dominant payment.
  const primary: Bill["paymentMethod"] =
    pay.upi >= pay.cash && pay.upi >= pay.card
      ? "upi"
      : pay.card >= pay.cash
        ? "card"
        : "cash";

  const { error } = await supabase.from("bills").insert({
    id: bill.id,
    number: bill.number,
    customer_name: bill.customerName ?? null,
    customer_phone: bill.customerPhone ?? null,
    customer_id: customerId ?? null,
    subtotal: bill.subtotal ?? bill.total,
    discount: bill.discount ?? 0,
    round_off: bill.roundOff ?? 0,
    total: bill.total,
    paid_cash: pay.cash,
    paid_upi: pay.upi,
    paid_card: pay.card,
    credit,
    payment_method: primary,
    amount_paid: paid,
    lines: bill.lines,
    created_at: new Date(bill.createdAt).toISOString(),
  });
  if (error) throw new Error(error.message);

  // Record the udhaar charge against the customer's ledger + balance.
  if (credit > 0 && customerId) {
    await supabase.from("credit_entries").insert({
      id: uid(),
      customer_id: customerId,
      bill_id: bill.id,
      amount: credit,
      note: `Bill #${bill.number}`,
      created_at: new Date(bill.createdAt).toISOString(),
    });
    await adjustBalance(customerId, credit);
  }
}

/* --------------------------- Customers / Udhaar --------------------------- */

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  balance: number | string | null;
  created_at: string;
};

function rowToCustomer(r: CustomerRow): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    balance: num(r.balance),
    createdAt: new Date(r.created_at).getTime(),
  };
}

export async function getCustomers(): Promise<Customer[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .order("balance", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as CustomerRow[]).map(rowToCustomer);
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToCustomer(data as CustomerRow) : null;
}

async function findCustomerByPhone(phone: string): Promise<Customer | null> {
  const p = phone.trim();
  if (!p) return null;
  const { data } = await supabase.from("customers").select("*").eq("phone", p).limit(1).maybeSingle();
  return data ? rowToCustomer(data as CustomerRow) : null;
}

// Finds an existing customer (by id, then phone) or creates a new one.
export async function ensureCustomer(
  name?: string,
  phone?: string,
  id?: string
): Promise<Customer> {
  if (id) {
    const existing = await getCustomer(id);
    if (existing) return existing;
  }
  if (phone && phone.trim()) {
    const byPhone = await findCustomerByPhone(phone);
    if (byPhone) return byPhone;
  }
  const customer: Customer = {
    id: id || uid(),
    name: (name || "Customer").trim() || "Customer",
    phone: phone?.trim() || undefined,
    balance: 0,
    createdAt: Date.now(),
  };
  const { error } = await supabase.from("customers").insert({
    id: customer.id,
    name: customer.name,
    phone: customer.phone ?? null,
    balance: 0,
    created_at: new Date(customer.createdAt).toISOString(),
  });
  if (error) throw new Error(error.message);
  return customer;
}

// Read-then-write balance change (non-atomic; fine for a single counter).
async function adjustBalance(customerId: string, delta: number): Promise<void> {
  const { data } = await supabase.from("customers").select("balance").eq("id", customerId).maybeSingle();
  const current = num((data as { balance: number | string } | null)?.balance);
  await supabase.from("customers").update({ balance: current + delta }).eq("id", customerId);
}

// Records a repayment from a customer, reducing their outstanding balance.
export async function recordRepayment(
  customerId: string,
  amount: number,
  method: "cash" | "upi" | "card",
  note?: string
): Promise<void> {
  const amt = Math.max(0, amount);
  if (amt <= 0) return;
  const { error } = await supabase.from("credit_entries").insert({
    id: uid(),
    customer_id: customerId,
    bill_id: null,
    amount: -amt,
    method,
    note: note ?? "Repayment",
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await adjustBalance(customerId, -amt);
}

type CreditRow = {
  id: string;
  customer_id: string;
  bill_id: string | null;
  amount: number | string;
  method: string | null;
  note: string | null;
  created_at: string;
};

function rowToCredit(r: CreditRow): CreditEntry {
  return {
    id: r.id,
    customerId: r.customer_id,
    billId: r.bill_id ?? undefined,
    amount: Number(r.amount),
    method: (r.method as CreditEntry["method"]) ?? undefined,
    note: r.note ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export async function getCreditLedger(customerId: string): Promise<CreditEntry[]> {
  const { data, error } = await supabase
    .from("credit_entries")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as CreditRow[]).map(rowToCredit);
}

/* ----------------------------- Reports ----------------------------- */

// Bills created within [startMs, endMs).
export async function getBillsBetween(startMs: number, endMs: number): Promise<Bill[]> {
  const { data, error } = await supabase
    .from("bills")
    .select("*")
    .gte("created_at", new Date(startMs).toISOString())
    .lt("created_at", new Date(endMs).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as BillRow[]).map(rowToBill);
}

// Repayments (negative ledger entries) within [startMs, endMs).
export async function getRepaymentsBetween(startMs: number, endMs: number): Promise<CreditEntry[]> {
  const { data, error } = await supabase
    .from("credit_entries")
    .select("*")
    .lt("amount", 0)
    .gte("created_at", new Date(startMs).toISOString())
    .lt("created_at", new Date(endMs).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as CreditRow[]).map(rowToCredit);
}

/* --------------------------- Offline commit/sync -------------------------- */

// Saves a sale, queuing it locally if the network is down. Returns whether it
// reached the server. The bill already carries its (locally-assigned) number.
export async function commitSale(
  bill: Bill,
  lines: { itemId: string; qty: number }[]
): Promise<{ synced: boolean }> {
  if (isOnline()) {
    try {
      await saveBill(bill);
      recordSale(lines).catch(() => {});
      return { synced: true };
    } catch (e) {
      if (isNetworkError(e)) {
        enqueueSale(bill, lines);
        return { synced: false };
      }
      throw e;
    }
  }
  enqueueSale(bill, lines);
  return { synced: false };
}

// Flushes queued offline sales to the server, in order. `saveBill`'s insert is
// the idempotency guard: a duplicate id (already-saved entry) throws a
// non-network error, so we drop it without re-running stock/credit effects.
export async function syncOutbox(): Promise<number> {
  if (!isOnline()) return 0;
  let synced = 0;
  for (const entry of getOutbox()) {
    try {
      await saveBill(entry.bill);
      await recordSale(entry.lines);
      removeFromOutbox(entry.id);
      synced++;
    } catch (e) {
      if (isNetworkError(e)) break; // connection lost again — retry later
      removeFromOutbox(entry.id); // already saved / unrecoverable — drop & move on
    }
  }
  return synced;
}

// Offline-safe, race-free bill numbers from a persisted local counter (seeded
// from the server by `seedBillCounter`). Each call consumes a unique number.
export async function nextBillNumber(): Promise<number> {
  return takeBillNumber();
}

// Raise the local counter to the server's latest number — call when online.
export async function seedLocalCounterFromServer(): Promise<void> {
  const { data, error } = await supabase
    .from("bills")
    .select("number")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return;
  seedBillCounter(data?.number ?? 0);
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
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) return getCachedSettings() ?? { ...DEFAULT_SETTINGS };
    const r = data as SettingsRow;
    const s: Settings = {
      businessName: r.business_name,
      address: r.address,
      phone: r.phone,
      gstin: r.gstin,
      footer: r.footer,
      paperWidth: r.paper_width,
      printerName: r.printer_name,
    };
    cacheSettings(s);
    return s;
  } catch {
    return getCachedSettings() ?? { ...DEFAULT_SETTINGS };
  }
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

/* ---------------------------- UPI QR codes ---------------------------- */

type UpiQrRow = { id: string; label: string; image: string; created_at: string };

export async function getUpiQrs(): Promise<UpiQr[]> {
  const { data, error } = await supabase
    .from("upi_qrs")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as UpiQrRow[]).map((r) => ({
    id: r.id,
    label: r.label,
    image: r.image,
    createdAt: new Date(r.created_at).getTime(),
  }));
}

export async function addUpiQr(label: string, image: string): Promise<void> {
  const { error } = await supabase.from("upi_qrs").insert({ id: uid(), label, image });
  if (error) throw new Error(error.message);
}

export async function deleteUpiQr(id: string): Promise<void> {
  const { error } = await supabase.from("upi_qrs").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
