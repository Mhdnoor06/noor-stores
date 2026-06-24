// Shared data model for the POS app. No tax/GST per project decision —
// receipts show item prices and a plain total only.

export interface Item {
  id: string;
  name: string;
  price: number;
  size?: string; // pack size / weight / volume, e.g. "500 g", "1 L", "330 ml"
  code?: string; // optional SKU / HSN
  barcode?: string; // scanned product barcode (EAN/UPC/etc.), used for lookup
  stock?: number; // current quantity on hand
  reorderLevel?: number; // low-stock threshold (0 = not tracked)
}

export interface BillLine {
  itemId: string;
  name: string;
  size?: string; // copied from the item at sale time, for the receipt
  price: number; // unit price at time of sale
  qty: number;
}

export interface Bill {
  id: string;
  number: number; // human-friendly sequential bill no.
  createdAt: number; // epoch ms
  customerName?: string;
  customerPhone?: string;
  lines: BillLine[];
  total: number;
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
