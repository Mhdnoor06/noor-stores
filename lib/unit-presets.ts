// The shared "unit chip" palette for the Add-Item form. A product is sold in one
// or more of these units; the smallest selected chip becomes the item's base
// (stock) unit and the rest become packs (baseQty = how many base units inside).
//
// Built-in chips cover the common retail cases; any custom chip a shopkeeper adds
// is saved to localStorage and reused on every future product (shared palette).

export interface UnitPreset {
  id: string; // stable key
  label: string; // shown on the chip: "Piece", "Pack of 4", "Case"
  unit: string; // unit string stored when this chip is the base ("pcs", "kg", "case")
  baseQty: number; // default base units inside (1 for atomic units)
  atomic?: boolean; // true = a smallest/indivisible unit (pcs, kg, L, sachet)
}

// Ordered smallest → largest so the palette reads naturally.
export const BUILTIN_UNITS: UnitPreset[] = [
  { id: "pcs", label: "Piece", unit: "pcs", baseQty: 1, atomic: true },
  { id: "sachet", label: "Sachet", unit: "sachet", baseQty: 1, atomic: true },
  { id: "kg", label: "Kilogram", unit: "kg", baseQty: 1, atomic: true },
  { id: "g", label: "Gram", unit: "g", baseQty: 1, atomic: true },
  { id: "L", label: "Litre", unit: "L", baseQty: 1, atomic: true },
  { id: "ml", label: "Millilitre", unit: "ml", baseQty: 1, atomic: true },
  { id: "pack4", label: "Pack of 4", unit: "pack", baseQty: 4 },
  { id: "pack6", label: "Pack of 6", unit: "pack", baseQty: 6 },
  { id: "bundle", label: "Bundle", unit: "bundle", baseQty: 12 },
  { id: "dozen", label: "Dozen", unit: "dozen", baseQty: 12 },
  { id: "sheet", label: "Sheet", unit: "sheet", baseQty: 12 },
  { id: "box", label: "Box", unit: "box", baseQty: 12 },
  { id: "case", label: "Case", unit: "case", baseQty: 24 },
  { id: "carton", label: "Carton", unit: "carton", baseQty: 24 },
  { id: "bag", label: "Bag", unit: "bag", baseQty: 25 },
  { id: "tin", label: "Tin", unit: "tin", baseQty: 15 },
];

const STORE_KEY = "noor.unitPresets";

function readCustom(): UnitPreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as UnitPreset[]) : [];
  } catch {
    return [];
  }
}

// Built-ins first, then any custom chips the shopkeeper has added.
export function getUnitPresets(): UnitPreset[] {
  const custom = readCustom();
  const seen = new Set(BUILTIN_UNITS.map((u) => u.id));
  return [...BUILTIN_UNITS, ...custom.filter((u) => !seen.has(u.id))];
}

// Saves a new custom chip (deduped by label, case-insensitive) and returns the
// full updated palette. The new chip is available on every product from now on.
export function addUnitPreset(label: string, baseQty: number): UnitPreset[] {
  const name = label.trim();
  if (!name) return getUnitPresets();
  const existing = getUnitPresets().find(
    (u) => u.label.toLowerCase() === name.toLowerCase()
  );
  if (existing) return getUnitPresets();
  const unit = name.toLowerCase().replace(/\s+/g, "-");
  const preset: UnitPreset = {
    id: `c_${unit}_${Math.round(Math.max(1, baseQty))}`,
    label: name,
    unit,
    baseQty: Math.max(1, baseQty || 1),
  };
  const custom = [...readCustom().filter((u) => u.id !== preset.id), preset];
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(custom));
  } catch {
    /* storage full / unavailable — chip still usable this session */
  }
  return getUnitPresets();
}
