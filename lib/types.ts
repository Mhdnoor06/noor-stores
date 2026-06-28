// Shared data model for the POS app. No tax/GST per project decision —
// receipts show item prices and a plain total only.

// A bigger sell/buy unit on top of an item's base unit. baseQty = how many BASE
// units this pack equals (a case = 240 packets ⇒ baseQty 240). Never defined in
// terms of another pack, so all levels share one base-unit stock pool.
export interface Pack {
  id: string;
  label: string; // "Case", "Bundle", "Bag", "Tin", "Carton"
  baseQty: number; // base units per pack
  wholesalePrice?: number; // wholesale price for one pack (set ⇒ this pack is sold wholesale)
  barcode?: string; // this pack's own barcode (carton EAN/ITF-14), if any
  // Legacy fields (older saved packs). `sellable` is now derived from having a
  // wholesale price; retail is computed as base retail × baseQty, not stored.
  retailPrice?: number;
  sellable?: boolean;
}

export interface Item {
  id: string;
  name: string;
  price: number; // base-unit RETAIL price (per `unit`); 0 when the shop doesn't sell this retail
  wholesalePrice?: number; // base-unit wholesale price (set ⇒ base unit is sold wholesale)
  unit?: string; // BASE unit of stock/sale: pcs, kg, g, L, ml, packet, ...
  sellsRetail?: boolean; // derived (price > 0) — does the shop sell this to retail customers?
  sellLoose?: boolean; // can the base unit be sold singly? false = packs only (default true)
  category?: string; // department/category
  mrp?: number; // printed max retail price (optional)
  costPrice?: number; // purchase cost per base unit, for margin (optional)
  size?: string; // pack size / weight / volume, e.g. "500 g", "1 L", "330 ml"
  code?: string; // optional SKU / HSN
  barcode?: string; // base-unit barcode (EAN/UPC/etc.), used for lookup
  stock?: number; // current quantity on hand, in BASE units
  reorderLevel?: number; // low-stock threshold (0 = not tracked)
  packs?: Pack[]; // bigger sell/buy units
  // Legacy 2-level fields (still read by stock-in until Phase C generalizes it).
  caseSize?: number; // base units per case/pack (undefined or 0 = loose only)
  casePrice?: number; // selling price for one whole case (optional)
}

export interface BillLine {
  itemId: string;
  name: string;
  size?: string; // copied from the item at sale time, for the receipt
  unit?: string; // unit SOLD (base unit, or a pack label like "Case")
  price: number; // price per sold unit at time of sale
  qty: number; // count of sold units (or measured amount for kg/g/L/ml)
  packId?: string; // pack sold (undefined = base/loose)
  baseQty?: number; // base units per one sold unit (default 1) — for stock deduction
}

// A bill can be settled by any mix of cash/UPI/card, with any unpaid remainder
// (`credit`) carried on a customer's udhaar ledger.
export interface BillPayment {
  cash: number;
  upi: number;
  card: number;
}

export interface Bill {
  id: string;
  number: number; // human-friendly sequential bill no.
  createdAt: number; // epoch ms
  customerName?: string;
  customerPhone?: string;
  customerId?: string; // set when a balance is put on credit
  lines: BillLine[];
  subtotal?: number; // sum of line amounts before discount
  discount?: number; // amount knocked off
  roundOff?: number; // rounding adjustment (+/-)
  total: number; // final payable
  payment: BillPayment; // amount settled per method
  credit?: number; // balance left on udhaar (0 if fully paid)
  changeGiven?: number; // cash change returned on overpayment
  // Portion of the payment that settles the customer's OLD udhaar (per method),
  // when the cashier folds the previous balance onto this bill.
  settleOld?: BillPayment;
  // Legacy single-method fields, kept optional for older saved bills.
  paymentMethod?: "cash" | "upi" | "card";
  amountPaid?: number;
}

// An udhaar customer with a running outstanding balance (positive = owes shop).
export interface Customer {
  id: string;
  name: string;
  phone?: string;
  balance: number;
  createdAt: number;
  lastRemindedAt?: number; // epoch ms a payment reminder was last sent (undefined = never)
}

// One line in a customer's credit ledger. +amount = udhaar given on a bill,
// -amount = a repayment received.
export interface CreditEntry {
  id: string;
  customerId: string;
  billId?: string;
  amount: number;
  method?: "cash" | "upi" | "card";
  note?: string;
  createdAt: number;
}

/* --------------------------- Stock-in / Purchases --------------------------- */

// A supplier the shop buys stock from. Mirror of Customer:
// positive balance = the shop owes the vendor (payable).
export interface Vendor {
  id: string;
  name: string;
  phone?: string;
  company?: string;
  gstin?: string;
  balance: number;
  notes?: string;
  createdAt: number;
}

// One line on a purchase / stock-in document. `purchaseUnit` records whether the
// quantity was entered in cases or base units; `caseSize` is the snapshot used
// to convert to base units, and `baseQty` is what actually hits stock.
export interface PurchaseLine {
  itemId?: string; // set once mapped to a catalogue item (new items created on post)
  name: string;
  barcode?: string;
  size?: string;
  unit?: string; // base unit of the item (pcs, kg, ...)
  purchaseUnit: "case" | "unit"; // how qty was entered (base unit vs a pack)
  packId?: string; // which pack was bought (undefined = base unit), snapshot
  packLabel?: string; // pack label at time of purchase ("Bag", "Case", "Tin")
  caseSize?: number; // base units per pack at time of purchase (1 when loose)
  qty: number; // quantity in `purchaseUnit`
  baseQty: number; // qty converted to base units (added to stock)
  cost: number; // purchase cost per `purchaseUnit`
  costPerBase: number; // derived cost per base unit (for margin + item.costPrice)
  // Optional pricing captured at intake, used when creating a NEW catalogue item.
  sellPrice?: number; // selling price per base unit
  casePrice?: number; // selling price per case
  mrp?: number;
}

// A stock-in document (goods received). Mirror of Bill on the buy side.
export interface Purchase {
  id: string;
  number: number;
  createdAt: number;
  vendorId?: string;
  vendorName?: string;
  invoiceNumber?: string; // the vendor's own bill number
  invoiceImageUrl?: string; // scanned bill image (Phase 2 OCR)
  lines: PurchaseLine[];
  subtotal?: number;
  discount?: number;
  total: number;
  payment: BillPayment; // amount settled per method
  credit?: number; // unpaid balance carried onto the vendor's payable
  source: "manual" | "ocr";
  status: "draft" | "posted";
  notes?: string;
}

// One line in a vendor's payables ledger. +amount = new payable from a credit
// purchase, -amount = a payment made to the vendor. Mirror of CreditEntry.
export interface VendorEntry {
  id: string;
  vendorId: string;
  purchaseId?: string;
  amount: number;
  method?: "cash" | "upi" | "card";
  note?: string;
  billImage?: string; // optional attached bill/receipt photo (data URL)
  createdAt: number;
}

// Non-vendor cash-out (salesperson payout, sundry), for the unified cash-book.
export interface Expense {
  id: string;
  category: string;
  amount: number;
  method?: "cash" | "upi" | "card";
  note?: string;
  billImage?: string; // optional attached bill/receipt photo (data URL)
  createdAt: number;
}

// A unified "money out" row for the cash-book — either a vendor payment or an
// expense, normalised so the day's paid-out can be listed in one place.
export interface CashOut {
  id: string;
  kind: "vendor" | "expense" | "purchase";
  label: string; // vendor name / expense category
  amount: number; // positive rupee amount paid out
  method?: "cash" | "upi" | "card";
  note?: string;
  billImage?: string; // optional attached bill/receipt photo (data URL)
  createdAt: number;
  vendorId?: string;
  purchaseId?: string; // set for "purchase" rows (delete via Stock In, not here)
}

// A saved UPI payment QR image (data URL) to show customers at checkout.
export interface UpiQr {
  id: string;
  label: string;
  image: string; // data URL (e.g. data:image/png;base64,...)
  createdAt: number;
}

export interface Settings {
  businessName: string;
  address: string;
  phone: string;
  gstin: string; // optional, printed only if set
  footer: string;
  paperWidth: number; // characters per line (32 for 58mm)
  printerName: string; // last paired device name, for display
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: "Noor Stores",
  address: "",
  phone: "",
  gstin: "",
  footer: "Thank you, visit again!",
  paperWidth: 32,
  printerName: "",
};
