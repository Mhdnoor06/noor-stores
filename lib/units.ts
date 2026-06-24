// Units of measure and product categories for retail.

export const UNITS: { value: string; label: string }[] = [
  { value: "pcs", label: "Piece (pcs)" },
  { value: "kg", label: "Kilogram (kg)" },
  { value: "g", label: "Gram (g)" },
  { value: "L", label: "Litre (L)" },
  { value: "ml", label: "Millilitre (ml)" },
  { value: "dozen", label: "Dozen" },
  { value: "pack", label: "Pack" },
  { value: "packet", label: "Packet" },
  { value: "box", label: "Box" },
  { value: "bottle", label: "Bottle" },
  { value: "bag", label: "Bag" },
  { value: "pair", label: "Pair" },
  { value: "m", label: "Metre (m)" },
  { value: "bundle", label: "Bundle" },
];

// Units sold by a measured amount → quantity is entered as a decimal weight /
// volume at billing time, and price is "per <unit>".
const MEASURED = new Set(["kg", "g", "L", "ml", "m"]);

export function isMeasured(unit?: string): boolean {
  return !!unit && MEASURED.has(unit);
}

// "₹40 / kg" or "₹10 / pcs"
export function perUnit(unit?: string): string {
  return `/ ${unit || "pcs"}`;
}

// How a quantity reads on screen / receipt: "1.5 kg" vs "×2".
export function qtyLabel(qty: number, unit?: string): string {
  if (isMeasured(unit)) {
    const n = Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/\.?0+$/, "");
    return `${n} ${unit}`;
  }
  return `×${qty}`;
}

export const CATEGORIES: string[] = [
  "Grocery & Staples",
  "Dairy & Eggs",
  "Beverages",
  "Snacks & Branded Foods",
  "Bakery",
  "Fruits & Vegetables",
  "Personal Care",
  "Household & Cleaning",
  "Stationery",
  "Baby Care",
  "Pet Care",
  "Frozen Foods",
  "Tobacco",
  "Other",
];
