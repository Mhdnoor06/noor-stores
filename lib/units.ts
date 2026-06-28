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

// Trims trailing zeros off a decimal count: 12 → "12", 12.50 → "12.5".
function trimNum(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(3).replace(/\.?0+$/, "");
}

// Decomposes a base-unit stock count into friendly pack terms using the item's
// largest pack: 112 packets (Case=240) → "112 packets"; 540 (Case=240) →
// "2 Cases + 60 packets"; 90 kg (Bag=25) → "3 Bags + 15 kg". Falls back to the
// plain base count when the item has no packs.
export function formatStock(
  stock: number,
  item: { unit?: string; packs?: { label: string; baseQty: number }[] }
): string {
  const unit = item.unit || "pcs";
  const packs = (item.packs ?? []).filter((p) => p.baseQty > 1);
  if (packs.length === 0 || stock <= 0) return `${trimNum(Math.max(0, stock))} ${unit}`;
  const pack = [...packs].sort((a, b) => b.baseQty - a.baseQty)[0];
  const whole = Math.floor(stock / pack.baseQty);
  const rem = Math.round((stock - whole * pack.baseQty) * 1000) / 1000;
  const parts: string[] = [];
  if (whole > 0) parts.push(`${whole} ${pack.label}${whole > 1 ? "s" : ""}`);
  if (rem > 0 || whole === 0) parts.push(`${trimNum(rem)} ${unit}`);
  return parts.join(" + ");
}

// Suggested pack sizes for fast item entry, chosen by category first, then the
// base unit. Returns {label, baseQty} chips the Items form can one-tap add.
export function packTemplates(
  category?: string,
  unit?: string
): { label: string; baseQty: number }[] {
  const u = unit || "pcs";
  const byCat: Record<string, { label: string; baseQty: number }[]> = {
    "Grocery & Staples":
      u === "kg" ? [{ label: "Bag", baseQty: 25 }, { label: "Bag", baseQty: 50 }] : [{ label: "Case", baseQty: 24 }],
    Beverages:
      u === "L" || u === "ml"
        ? [{ label: "Tin", baseQty: 15 }, { label: "Case", baseQty: 12 }]
        : [{ label: "Case", baseQty: 24 }],
    "Snacks & Branded Foods": [{ label: "Bundle", baseQty: 12 }, { label: "Case", baseQty: 240 }],
    "Personal Care": [{ label: "Box", baseQty: 12 }, { label: "Case", baseQty: 144 }],
    "Household & Cleaning": [{ label: "Box", baseQty: 12 }, { label: "Case", baseQty: 24 }],
  };
  if (category && byCat[category]) return byCat[category];
  if (u === "kg") return [{ label: "Bag", baseQty: 25 }, { label: "Bag", baseQty: 50 }];
  if (u === "L" || u === "ml") return [{ label: "Tin", baseQty: 15 }];
  return [{ label: "Bundle", baseQty: 12 }, { label: "Case", baseQty: 24 }];
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
