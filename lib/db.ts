// Supabase-backed data access — items, bills and settings.

import { supabase } from "./supabase";
import {
  Bill,
  BillLine,
  CashOut,
  CreditEntry,
  Customer,
  DEFAULT_SETTINGS,
  Expense,
  Item,
  Pack,
  Purchase,
  Settings,
  UpiQr,
  Vendor,
  VendorEntry,
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
  case_size: number | null;
  case_price: number | string | null;
  packs: unknown;
  sell_loose: boolean | null;
  wholesale_price: number | string | null;
};

function rowToPacks(raw: unknown): Pack[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    const o = p as Record<string, unknown>;
    return {
      id: String(o.id ?? uid()),
      label: String(o.label ?? "Pack"),
      baseQty: Number(o.baseQty ?? 0),
      wholesalePrice: o.wholesalePrice != null ? Number(o.wholesalePrice) : undefined,
      barcode: o.barcode != null ? String(o.barcode) : undefined,
      retailPrice: o.retailPrice != null ? Number(o.retailPrice) : undefined,
      sellable: o.sellable != null ? o.sellable !== false : undefined,
    };
  });
}

function rowToItem(r: ItemRow): Item {
  return {
    id: r.id,
    name: r.name,
    price: Number(r.price),
    wholesalePrice: r.wholesale_price != null ? Number(r.wholesale_price) : undefined,
    unit: r.unit ?? "pcs",
    sellsRetail: Number(r.price) > 0, // derived: a positive retail price ⇒ sold retail
    sellLoose: r.sell_loose ?? true,
    category: r.category ?? undefined,
    mrp: r.mrp != null ? Number(r.mrp) : undefined,
    costPrice: r.cost_price != null ? Number(r.cost_price) : undefined,
    size: r.size ?? undefined,
    code: r.code ?? undefined,
    barcode: r.barcode ?? undefined,
    stock: r.stock ?? 0,
    reorderLevel: r.reorder_level ?? 0,
    packs: rowToPacks(r.packs),
    caseSize: r.case_size != null ? Number(r.case_size) : undefined,
    casePrice: r.case_price != null ? Number(r.case_price) : undefined,
  };
}

function itemToRow(item: Item) {
  return {
    id: item.id,
    name: item.name,
    price: item.price,
    wholesale_price: item.wholesalePrice ?? null,
    unit: item.unit ?? "pcs",
    sell_loose: item.sellLoose ?? true,
    category: item.category ?? null,
    mrp: item.mrp ?? null,
    cost_price: item.costPrice ?? null,
    size: item.size ?? null,
    code: item.code ?? null,
    barcode: item.barcode ?? null,
    stock: item.stock ?? 0,
    reorder_level: item.reorderLevel ?? 0,
    packs: item.packs ?? [],
    case_size: item.caseSize ?? null,
    case_price: item.casePrice ?? null,
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

// Adds received stock back to items (mirror of recordSale) and refreshes each
// item's cost price to the latest purchase cost. Non-atomic fetch-then-update,
// fine for a single shop; failures are swallowed so a hiccup never blocks intake.
export async function recordStockIn(
  lines: { itemId: string; baseQty: number; costPerBase?: number }[]
): Promise<void> {
  const rows = lines.filter((l) => l.itemId);
  if (rows.length === 0) return;
  const ids = rows.map((l) => l.itemId);
  const { data } = await supabase.from("items").select("id, stock").in("id", ids);
  const stockMap = new Map(
    (data ?? []).map((r) => [r.id as string, (r.stock as number) ?? 0])
  );
  await Promise.all(
    rows.map((l) => {
      const update: { stock: number; cost_price?: number } = {
        stock: (stockMap.get(l.itemId) ?? 0) + l.baseQty,
      };
      if (l.costPerBase != null && l.costPerBase > 0) update.cost_price = l.costPerBase;
      return supabase.from("items").update(update).eq("id", l.itemId);
    })
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
  bill_type: string | null;
  return_of_bill_id: string | null;
};

function num(v: number | string | null | undefined): number {
  return v != null ? Number(v) : 0;
}

// Round to 2 dp to keep running balances free of float drift.
function money2(x: number): number {
  return Math.round(x * 100) / 100;
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
    billType: (r.bill_type === "return" ? "return" : "sale") as Bill["billType"],
    returnOfBillId: r.return_of_bill_id ?? undefined,
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
  const settle = bill.settleOld ?? { cash: 0, upi: 0, card: 0 };
  const settleTotal = Math.max(0, settle.cash + settle.upi + settle.card);

  // If any balance is on credit, or we're clearing an old balance, the bill must
  // be tied to a customer.
  let customerId = bill.customerId;
  if (credit > 0 || settleTotal > 0) {
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
    bill_type: bill.billType ?? "sale",
    return_of_bill_id: bill.returnOfBillId ?? null,
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

  // Settle the customer's previous balance with whatever this bill over-collected.
  // One repayment entry per method so the day-close report attributes it right.
  if (settleTotal > 0 && customerId) {
    const methods: Array<"cash" | "upi" | "card"> = ["cash", "upi", "card"];
    for (const m of methods) {
      const amt = settle[m];
      if (amt > 0) {
        await supabase.from("credit_entries").insert({
          id: uid(),
          customer_id: customerId,
          bill_id: bill.id,
          amount: -amt,
          method: m,
          note: `Old balance settled · Bill #${bill.number}`,
          created_at: new Date(bill.createdAt).toISOString(),
        });
      }
    }
    await adjustBalance(customerId, -settleTotal);
  }
}

// Saves a return bill, restores stock for returned items, and optionally reduces
// the customer's udhaar balance when the refund is applied to their credit.
export async function saveReturnBill(
  returnBill: Bill,
  stockLines: { itemId: string; qty: number }[],
  refundMethod: "cash" | "upi" | "card" | "udhaar"
): Promise<void> {
  const pay =
    refundMethod === "udhaar"
      ? { cash: 0, upi: 0, card: 0 }
      : returnBill.payment ?? { cash: 0, upi: 0, card: 0 };

  const { error } = await supabase.from("bills").insert({
    id: returnBill.id,
    number: returnBill.number,
    customer_name: returnBill.customerName ?? null,
    customer_phone: returnBill.customerPhone ?? null,
    customer_id: returnBill.customerId ?? null,
    subtotal: returnBill.total,
    discount: 0,
    round_off: 0,
    total: returnBill.total,
    paid_cash: pay.cash,
    paid_upi: pay.upi,
    paid_card: pay.card,
    credit: 0,
    payment_method: refundMethod === "udhaar" ? "cash" : refundMethod,
    amount_paid: pay.cash + pay.upi + pay.card,
    lines: returnBill.lines,
    bill_type: "return",
    return_of_bill_id: returnBill.returnOfBillId ?? null,
    created_at: new Date(returnBill.createdAt).toISOString(),
  });
  if (error) throw new Error(error.message);

  // Add returned stock back (base units).
  if (stockLines.length > 0) {
    await recordStockIn(stockLines.map((l) => ({ itemId: l.itemId, baseQty: l.qty })));
  }

  // Reduce udhaar: record as a repayment on the customer's credit ledger.
  if (refundMethod === "udhaar" && returnBill.customerId) {
    await recordRepayment(
      returnBill.customerId,
      returnBill.total,
      "cash",
      `Return · Bill #${returnBill.number}`
    );
  }
}

/* --------------------------- Customers / Udhaar --------------------------- */

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  balance: number | string | null;
  created_at: string;
  last_reminded_at: string | null;
};

function rowToCustomer(r: CustomerRow): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    balance: num(r.balance),
    createdAt: new Date(r.created_at).getTime(),
    lastRemindedAt: r.last_reminded_at ? new Date(r.last_reminded_at).getTime() : undefined,
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
  await supabase.from("customers").update({ balance: money2(current + delta) }).eq("id", customerId);
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

// Records udhaar given outside the bill flow (e.g. an opening balance at
// onboarding, or non-bill credit), increasing the customer's outstanding.
export async function recordCharge(
  customerId: string,
  amount: number,
  note?: string
): Promise<void> {
  const amt = Math.max(0, amount);
  if (amt <= 0) return;
  const { error } = await supabase.from("credit_entries").insert({
    id: uid(),
    customer_id: customerId,
    bill_id: null,
    amount: amt,
    note: note ?? "Udhaar",
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await adjustBalance(customerId, amt);
}

// Creates a credit customer directly (find-or-create by id/phone). Used by the
// "Add customer" action so dues can be tracked without first cutting a bill.
export async function addCustomer(name: string, phone?: string): Promise<Customer> {
  return ensureCustomer(name, phone);
}

// Stamps when a payment reminder was last sent, so the UI can show recency and
// avoid nagging the same customer repeatedly.
export async function markReminded(customerId: string): Promise<void> {
  await supabase
    .from("customers")
    .update({ last_reminded_at: new Date().toISOString() })
    .eq("id", customerId);
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

// For each given customer, the epoch ms at which their CURRENT run of debt
// began — i.e. the first charge after the last time their balance was clear.
// Replays each ledger oldest→newest; the streak resets whenever the running
// balance falls to zero or below. Returns a map keyed by customerId (absent =
// no outstanding streak). Used to age dues on the udhaar list.
export async function getDebtAges(customerIds: string[]): Promise<Map<string, number>> {
  const ids = customerIds.filter(Boolean);
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("credit_entries")
    .select("customer_id, amount, created_at")
    .in("customer_id", ids)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const byCustomer = new Map<string, { amount: number; at: number }[]>();
  for (const r of (data ?? []) as Pick<CreditRow, "customer_id" | "amount" | "created_at">[]) {
    const list = byCustomer.get(r.customer_id) ?? [];
    list.push({ amount: Number(r.amount), at: new Date(r.created_at).getTime() });
    byCustomer.set(r.customer_id, list);
  }

  const ages = new Map<string, number>();
  for (const [cid, entries] of byCustomer) {
    let running = 0;
    let streakStart: number | null = null;
    for (const e of entries) {
      const wasClear = running <= 0;
      running += e.amount;
      if (wasClear && running > 0) streakStart = e.at; // debt just (re)started
      if (running <= 0) streakStart = null; // fully settled — streak cleared
    }
    if (streakStart != null) ages.set(cid, streakStart);
  }
  return ages;
}

/* --------------------------- Vendors / Payables --------------------------- */

type VendorRow = {
  id: string;
  name: string;
  phone: string | null;
  company: string | null;
  gstin: string | null;
  balance: number | string | null;
  notes: string | null;
  created_at: string;
};

function rowToVendor(r: VendorRow): Vendor {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? undefined,
    company: r.company ?? undefined,
    gstin: r.gstin ?? undefined,
    balance: num(r.balance),
    notes: r.notes ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export async function getVendors(): Promise<Vendor[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("*")
    .order("balance", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as VendorRow[]).map(rowToVendor);
}

export async function getVendor(id: string): Promise<Vendor | null> {
  const { data, error } = await supabase.from("vendors").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowToVendor(data as VendorRow) : null;
}

async function findVendorByPhone(phone: string): Promise<Vendor | null> {
  const p = phone.trim();
  if (!p) return null;
  const { data } = await supabase.from("vendors").select("*").eq("phone", p).limit(1).maybeSingle();
  return data ? rowToVendor(data as VendorRow) : null;
}

async function findVendorByName(name: string): Promise<Vendor | null> {
  const nm = name.trim();
  if (!nm) return null;
  const { data } = await supabase.from("vendors").select("*").ilike("name", nm).limit(1).maybeSingle();
  return data ? rowToVendor(data as VendorRow) : null;
}

// Finds an existing vendor (by id, then phone, then exact name) or creates one.
// Name-matching prevents duplicate vendors from the stock-in flow where only a
// typed name is available.
export async function ensureVendor(
  name?: string,
  phone?: string,
  id?: string,
  extra?: { company?: string; gstin?: string }
): Promise<Vendor> {
  if (id) {
    const existing = await getVendor(id);
    if (existing) return existing;
  }
  if (phone && phone.trim()) {
    const byPhone = await findVendorByPhone(phone);
    if (byPhone) return byPhone;
  }
  if (name && name.trim()) {
    const byName = await findVendorByName(name);
    if (byName) return byName;
  }
  const vendor: Vendor = {
    id: id || uid(),
    name: (name || "Vendor").trim() || "Vendor",
    phone: phone?.trim() || undefined,
    company: extra?.company?.trim() || undefined,
    gstin: extra?.gstin?.trim() || undefined,
    balance: 0,
    createdAt: Date.now(),
  };
  const { error } = await supabase.from("vendors").insert({
    id: vendor.id,
    name: vendor.name,
    phone: vendor.phone ?? null,
    company: vendor.company ?? null,
    gstin: vendor.gstin ?? null,
    balance: 0,
    created_at: new Date(vendor.createdAt).toISOString(),
  });
  if (error) throw new Error(error.message);
  return vendor;
}

export async function addVendor(
  name: string,
  phone?: string,
  extra?: { company?: string; gstin?: string }
): Promise<Vendor> {
  return ensureVendor(name, phone, undefined, extra);
}

// Read-then-write payable change (non-atomic; fine for a single back office).
async function adjustVendorBalance(vendorId: string, delta: number): Promise<void> {
  const { data } = await supabase.from("vendors").select("balance").eq("id", vendorId).maybeSingle();
  const current = num((data as { balance: number | string } | null)?.balance);
  await supabase.from("vendors").update({ balance: money2(current + delta) }).eq("id", vendorId);
}

// Records a payment made TO a vendor, reducing what the shop owes.
export async function recordVendorPayment(
  vendorId: string,
  amount: number,
  method: "cash" | "upi" | "card",
  note?: string,
  billImage?: string
): Promise<void> {
  const amt = Math.max(0, amount);
  if (amt <= 0) return;
  const { error } = await supabase.from("vendor_ledger").insert({
    id: uid(),
    vendor_id: vendorId,
    purchase_id: null,
    amount: -amt,
    method,
    note: note ?? "Payment",
    bill_image: billImage ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await adjustVendorBalance(vendorId, -amt);
}

// Adds a payable outside the stock-in flow (e.g. an opening balance owed).
export async function recordVendorCharge(
  vendorId: string,
  amount: number,
  note?: string,
  billImage?: string
): Promise<void> {
  const amt = Math.max(0, amount);
  if (amt <= 0) return;
  const { error } = await supabase.from("vendor_ledger").insert({
    id: uid(),
    vendor_id: vendorId,
    purchase_id: null,
    amount: amt,
    note: note ?? "Payable",
    bill_image: billImage ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  await adjustVendorBalance(vendorId, amt);
}

type VendorLedgerRow = {
  id: string;
  vendor_id: string;
  purchase_id: string | null;
  amount: number | string;
  method: string | null;
  note: string | null;
  bill_image: string | null;
  created_at: string;
};

function rowToVendorEntry(r: VendorLedgerRow): VendorEntry {
  return {
    id: r.id,
    vendorId: r.vendor_id,
    purchaseId: r.purchase_id ?? undefined,
    amount: Number(r.amount),
    method: (r.method as VendorEntry["method"]) ?? undefined,
    note: r.note ?? undefined,
    billImage: r.bill_image ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export async function getVendorLedger(vendorId: string): Promise<VendorEntry[]> {
  const { data, error } = await supabase
    .from("vendor_ledger")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as VendorLedgerRow[]).map(rowToVendorEntry);
}

/* --------------------------- Purchases / Stock-in --------------------------- */

type PurchaseRow = {
  id: string;
  number: number;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_image_url: string | null;
  subtotal: number | string | null;
  discount: number | string | null;
  total: number | string;
  paid_cash: number | string | null;
  paid_upi: number | string | null;
  paid_card: number | string | null;
  credit: number | string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  lines: PurchaseLineRow[];
  created_at: string;
};

type PurchaseLineRow = Purchase["lines"][number];

function rowToPurchase(r: PurchaseRow): Purchase {
  return {
    id: r.id,
    number: r.number,
    createdAt: new Date(r.created_at).getTime(),
    vendorId: r.vendor_id ?? undefined,
    vendorName: r.vendor_name ?? undefined,
    invoiceNumber: r.invoice_number ?? undefined,
    invoiceImageUrl: r.invoice_image_url ?? undefined,
    lines: r.lines ?? [],
    subtotal: r.subtotal != null ? Number(r.subtotal) : undefined,
    discount: r.discount != null ? Number(r.discount) : 0,
    total: Number(r.total),
    payment: { cash: num(r.paid_cash), upi: num(r.paid_upi), card: num(r.paid_card) },
    credit: num(r.credit),
    source: (r.source as Purchase["source"]) ?? "manual",
    status: (r.status as Purchase["status"]) ?? "posted",
    notes: r.notes ?? undefined,
  };
}

export async function getPurchases(): Promise<Purchase[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as PurchaseRow[]).map(rowToPurchase);
}

// Next sequential purchase number (server-side; intake is a back-office task so
// no offline counter needed, unlike bills).
export async function nextPurchaseNumber(): Promise<number> {
  const { data } = await supabase
    .from("purchases")
    .select("number")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (num((data as { number: number } | null)?.number) || 0) + 1;
}

// Posts a stock-in: creates/updates catalogue items for each line, adds received
// quantity to stock (in base units) and refreshes cost price, records the
// purchase document, and posts any unpaid balance to the vendor's payable.
export async function recordPurchase(purchase: Purchase): Promise<void> {
  const pay = purchase.payment ?? { cash: 0, upi: 0, card: 0 };
  const paid = pay.cash + pay.upi + pay.card;
  const credit = Math.max(0, purchase.credit ?? 0);

  // Tie to a vendor whenever there's a balance to carry or a name given.
  let vendorId = purchase.vendorId;
  if (credit > 0 || purchase.vendorName || vendorId) {
    const v = await ensureVendor(purchase.vendorName, undefined, purchase.vendorId);
    vendorId = v.id;
  }

  // Create catalogue items for any new (unmapped) lines, then resolve itemIds.
  const lines = [...purchase.lines];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l.itemId) {
      // If this new item arrived as a pack (case/bag/tin), seed a Pack on the
      // catalogue item so billing can sell it by that unit straight away.
      const cs = l.caseSize && l.caseSize > 1 ? l.caseSize : 0;
      const basePrice = l.sellPrice ?? l.costPerBase;
      const packs: Pack[] | undefined = cs
        ? [
            {
              id: uid(),
              label: l.packLabel || "Case",
              baseQty: cs,
              retailPrice: l.casePrice ?? Math.round(basePrice * cs * 100) / 100,
              sellable: true,
            },
          ]
        : undefined;
      const newItem: Item = {
        id: uid(),
        name: l.name,
        price: basePrice,
        unit: l.unit ?? "pcs",
        size: l.size,
        barcode: l.barcode,
        mrp: l.mrp,
        costPrice: l.costPerBase,
        sellLoose: true,
        packs,
        stock: 0, // recordStockIn below adds the received qty
        reorderLevel: 0,
      };
      await upsertItem(newItem);
      lines[i] = { ...l, itemId: newItem.id };
    }
  }

  const { error } = await supabase.from("purchases").insert({
    id: purchase.id,
    number: purchase.number,
    vendor_id: vendorId ?? null,
    vendor_name: purchase.vendorName ?? null,
    invoice_number: purchase.invoiceNumber ?? null,
    invoice_image_url: purchase.invoiceImageUrl ?? null,
    subtotal: purchase.subtotal ?? purchase.total,
    discount: purchase.discount ?? 0,
    total: purchase.total,
    paid_cash: pay.cash,
    paid_upi: pay.upi,
    paid_card: pay.card,
    credit,
    source: purchase.source ?? "manual",
    status: "posted",
    notes: purchase.notes ?? null,
    lines,
    created_at: new Date(purchase.createdAt).toISOString(),
  });
  if (error) throw new Error(error.message);

  // Add received stock (base units) and refresh cost prices.
  await recordStockIn(
    lines.map((l) => ({ itemId: l.itemId as string, baseQty: l.baseQty, costPerBase: l.costPerBase }))
  );

  // Carry the unpaid portion onto the vendor's payable ledger + balance.
  if (credit > 0 && vendorId) {
    await supabase.from("vendor_ledger").insert({
      id: uid(),
      vendor_id: vendorId,
      purchase_id: purchase.id,
      amount: credit,
      note: `Purchase #${purchase.number}`,
      created_at: new Date(purchase.createdAt).toISOString(),
    });
    await adjustVendorBalance(vendorId, credit);
  }
  void paid;
}

/* ------------------------------- Expenses -------------------------------- */

type ExpenseRow = {
  id: string;
  category: string;
  amount: number | string;
  method: string | null;
  note: string | null;
  bill_image: string | null;
  created_at: string;
};

function rowToExpense(r: ExpenseRow): Expense {
  return {
    id: r.id,
    category: r.category,
    amount: Number(r.amount),
    method: (r.method as Expense["method"]) ?? undefined,
    note: r.note ?? undefined,
    billImage: r.bill_image ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
  };
}

export async function addExpense(
  category: string,
  amount: number,
  method: "cash" | "upi" | "card",
  note?: string,
  billImage?: string
): Promise<void> {
  const amt = Math.max(0, amount);
  if (amt <= 0) return;
  const { error } = await supabase.from("expenses").insert({
    id: uid(),
    category: category.trim() || "Misc",
    amount: amt,
    method,
    note: note ?? null,
    bill_image: billImage ?? null,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
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

// Purchases created within [startMs, endMs).
export async function getPurchasesBetween(startMs: number, endMs: number): Promise<Purchase[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("*")
    .gte("created_at", new Date(startMs).toISOString())
    .lt("created_at", new Date(endMs).toISOString())
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as PurchaseRow[]).map(rowToPurchase);
}

// Unified cash-book: every rupee that left the till in [startMs, endMs) —
// vendor payments (negative vendor_ledger entries) + expenses — normalised into
// one list, newest first. Drives the "paid out today" view.
export async function getCashOutBetween(startMs: number, endMs: number): Promise<CashOut[]> {
  const from = new Date(startMs).toISOString();
  const to = new Date(endMs).toISOString();

  const [payRes, expRes, purRes, vendorsRes] = await Promise.all([
    supabase
      .from("vendor_ledger")
      .select("*")
      .lt("amount", 0)
      .gte("created_at", from)
      .lt("created_at", to),
    supabase.from("expenses").select("*").gte("created_at", from).lt("created_at", to),
    supabase
      .from("purchases")
      .select("id, number, vendor_name, paid_cash, paid_upi, paid_card, created_at")
      .gte("created_at", from)
      .lt("created_at", to),
    supabase.from("vendors").select("id, name"),
  ]);
  if (payRes.error) throw new Error(payRes.error.message);
  if (expRes.error) throw new Error(expRes.error.message);
  if (purRes.error) throw new Error(purRes.error.message);

  const vendorName = new Map(
    ((vendorsRes.data ?? []) as { id: string; name: string }[]).map((v) => [v.id, v.name])
  );

  const fromPayments: CashOut[] = (payRes.data as VendorLedgerRow[]).map((r) => {
    const e = rowToVendorEntry(r);
    return {
      id: e.id,
      kind: "vendor",
      label: vendorName.get(e.vendorId) ?? "Vendor",
      amount: Math.abs(e.amount),
      method: e.method,
      note: e.note,
      billImage: e.billImage,
      createdAt: e.createdAt,
      vendorId: e.vendorId,
    };
  });

  const fromExpenses: CashOut[] = (expRes.data as ExpenseRow[]).map((r) => {
    const e = rowToExpense(r);
    return {
      id: e.id,
      kind: "expense",
      label: e.category,
      amount: e.amount,
      method: e.method,
      note: e.note,
      billImage: e.billImage,
      createdAt: e.createdAt,
    };
  });

  // Cash/UPI/card paid AT stock-in time — read straight off the purchase row so
  // it stays consistent when the purchase is deleted. One row per used method.
  type PurRow = {
    id: string;
    number: number;
    vendor_name: string | null;
    paid_cash: number | string | null;
    paid_upi: number | string | null;
    paid_card: number | string | null;
    created_at: string;
  };
  const fromPurchases: CashOut[] = [];
  for (const r of (purRes.data ?? []) as PurRow[]) {
    const at = new Date(r.created_at).getTime();
    const methods: Array<["cash" | "upi" | "card", number]> = [
      ["cash", num(r.paid_cash)],
      ["upi", num(r.paid_upi)],
      ["card", num(r.paid_card)],
    ];
    for (const [m, amt] of methods) {
      if (amt > 0) {
        fromPurchases.push({
          id: `${r.id}:${m}`,
          kind: "purchase",
          label: `${r.vendor_name || "Stock-in"} · #${r.number}`,
          amount: amt,
          method: m,
          createdAt: at,
          purchaseId: r.id,
        });
      }
    }
  }

  return [...fromPayments, ...fromExpenses, ...fromPurchases].sort((a, b) => b.createdAt - a.createdAt);
}

/* --------------------------- Deletions / corrections --------------------------- */
// Every delete UNDOES the entry's side effects (balances, stock) before removing
// the row, so a mistaken entry leaves no trace in the running totals.

// Removes a customer udhaar/repayment entry and reverses its balance effect.
export async function deleteCreditEntry(entry: CreditEntry): Promise<void> {
  const { error } = await supabase.from("credit_entries").delete().eq("id", entry.id);
  if (error) throw new Error(error.message);
  await adjustBalance(entry.customerId, -entry.amount);
}

// Removes a vendor payment/payable entry and reverses its balance effect.
export async function deleteVendorEntry(entry: VendorEntry): Promise<void> {
  const { error } = await supabase.from("vendor_ledger").delete().eq("id", entry.id);
  if (error) throw new Error(error.message);
  await adjustVendorBalance(entry.vendorId, -entry.amount);
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// Deletes a cash-book row — an expense, or a vendor payment (which re-adds the
// amount to the vendor's payable).
export async function deleteCashOut(row: CashOut): Promise<void> {
  if (row.kind === "expense") {
    await deleteExpense(row.id);
    return;
  }
  const { error } = await supabase.from("vendor_ledger").delete().eq("id", row.id);
  if (error) throw new Error(error.message);
  if (row.vendorId) await adjustVendorBalance(row.vendorId, row.amount); // undo the −payment
}

// Deletes a stock-in: removes the received quantity from stock and reverses any
// vendor payable it raised. (Items created by the purchase are kept; cost price
// is left at its latest value.)
export async function deletePurchase(purchase: Purchase): Promise<void> {
  await recordStockIn(
    purchase.lines
      .filter((l) => l.itemId)
      .map((l) => ({ itemId: l.itemId as string, baseQty: -l.baseQty }))
  );
  if ((purchase.credit ?? 0) > 0 && purchase.vendorId) {
    await supabase.from("vendor_ledger").delete().eq("purchase_id", purchase.id);
    await adjustVendorBalance(purchase.vendorId, -(purchase.credit ?? 0));
  }
  const { error } = await supabase.from("purchases").delete().eq("id", purchase.id);
  if (error) throw new Error(error.message);
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
