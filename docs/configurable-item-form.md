# Configurable Item Form — Implementation Plan

## Problem

The Add Item form currently shows 18+ fields at once regardless of what the shopkeeper
actually needs. A wholesale distributor (like Noor Stores) needs wholesale price, cost
price, and pack units front-and-center. A retail-only kirana doesn't need any of that.
One fixed form layout overwhelms every user differently.

## Solution

A **Business Profile** setting the user configures once. The Add Item form reads it and
renders only the fields the user enabled, in the order that matches their business type.

---

## Phase 1 — Extend the Settings Type

**File:** `lib/types.ts`

Add two new types and extend `Settings`:

```ts
export type BusinessMode = "retail" | "wholesale" | "both";

export interface ItemFormConfig {
  // Pricing fields
  wholesalePrice: boolean;
  retailPrice: boolean;
  costPrice: boolean;
  mrp: boolean;
  // Product identity
  barcode: boolean;
  packSize: boolean;     // text label e.g. "500g", "1L"
  packUnits: boolean;    // multi-unit chips (Case, Kg, Dozen…)
  category: boolean;
  // Inventory
  stock: boolean;
  reorderLevel: boolean;
  skuHsn: boolean;
}
```

Extend `Settings`:

```ts
export interface Settings {
  // ... existing fields ...
  businessMode: BusinessMode;
  itemForm: ItemFormConfig;
}
```

Add preset configs and update `DEFAULT_SETTINGS`:

```ts
export const ITEM_FORM_PRESETS: Record<BusinessMode, ItemFormConfig> = {
  retail: {
    wholesalePrice: false, retailPrice: true,  costPrice: false, mrp: false,
    barcode: true,  packSize: true,  packUnits: false, category: false,
    stock: false,   reorderLevel: false, skuHsn: false,
  },
  wholesale: {
    wholesalePrice: true,  retailPrice: false, costPrice: true,  mrp: false,
    barcode: true,  packSize: true,  packUnits: true,  category: false,
    stock: true,    reorderLevel: false, skuHsn: false,
  },
  both: {
    wholesalePrice: true,  retailPrice: true,  costPrice: true,  mrp: false,
    barcode: true,  packSize: true,  packUnits: true,  category: false,
    stock: true,    reorderLevel: false, skuHsn: false,
  },
};

export const DEFAULT_SETTINGS: Settings = {
  // ... existing defaults ...
  businessMode: "both",
  itemForm: ITEM_FORM_PRESETS.both,
};
```

**Why:** All settings already flow through `getSettings()` / `saveSettings()` in `lib/db.ts`
and are persisted in IndexedDB. No new storage layer needed.

---

## Phase 2 — Settings Page UI

**File:** `app/settings/page.tsx`

Add a new card section **"Item Form"** below "Business details". Two parts:

### Part A — Business mode selector

Three radio-style cards (not a plain `<select>`):

```
┌─────────────────────────────────────────────────┐
│  How do you sell?                               │
├──────────────┬──────────────┬───────────────────┤
│  ○ Retail    │  ● Both      │  ○ Wholesale      │
│  Sell to     │  Wholesale + │  Distributor /    │
│  end         │  retail      │  dealer only      │
│  customers   │  customers   │                   │
└──────────────┴──────────────┴───────────────────┘
```

Selecting a mode **auto-applies the preset** (`ITEM_FORM_PRESETS[mode]`) but the user
can still override individual fields in Part B below.

### Part B — Fields checklist

Grouped into three clusters to reduce visual noise:

```
Pricing
  ☑ Wholesale price    ☑ Retail price
  ☑ Cost price         ☐ MRP

Product
  ☑ Barcode            ☑ Pack size (500g, 1L…)
  ☑ Pack units (Case, Kg…)   ☐ Category

Inventory
  ☑ Stock on hand      ☐ Reorder level
  ☐ SKU / HSN code
```

- Checking/unchecking any box clears the "preset applied" indicator so the user knows
  they've customised it.
- `Name` and `Unit` (base unit chip) are always on — not shown in the checklist.
- The card has its own **Save** button (reuses the existing `handleSave` form submit).

---

## Phase 3 — Item Form Refactor

**File:** `app/items/page.tsx`

### 3a. Load the config

```ts
const [formCfg, setFormCfg] = useState<ItemFormConfig>(DEFAULT_SETTINGS.itemForm);
const [bizMode, setBizMode] = useState<BusinessMode>(DEFAULT_SETTINGS.businessMode);

useEffect(() => {
  getSettings().then((s) => {
    setFormCfg(s.itemForm ?? DEFAULT_SETTINGS.itemForm);
    setBizMode(s.businessMode ?? "both");
  });
}, []);
```

### 3b. Section order

The form currently has a fixed section order. Make it dynamic:

| businessMode | Section order |
|---|---|
| `retail` | Product details → Units → Retail price → Inventory |
| `wholesale` | Product details → Units → Wholesale prices → Inventory |
| `both` | Product details → Units → Wholesale prices → Retail price → Inventory |

Implement as a sorted array of section keys rendered with a `switch`:

```ts
const sectionOrder =
  bizMode === "retail"
    ? ["details", "units", "retail", "inventory"]
    : bizMode === "wholesale"
    ? ["details", "units", "wholesale", "inventory"]
    : ["details", "units", "wholesale", "retail", "inventory"];
```

### 3c. Conditional field rendering

Each field checks `formCfg` before rendering:

```tsx
{/* Barcode field */}
{formCfg.barcode && (
  <Field label="Barcode">…</Field>
)}

{/* Wholesale section */}
{formCfg.wholesalePrice && (
  <section>…wholesale cards…</section>
)}

{/* Pack units chip palette */}
{formCfg.packUnits && (
  <section>…unit chips…</section>
)}

{/* Retail section */}
{formCfg.retailPrice && (
  <section>
    <span className="eyebrow">Retail</span>
    …sell to retail toggle + price field…
  </section>
)}
```

### 3d. Validation adjustments

`handleSubmit` currently requires a retail price when `sellsRetail` is true. Extend:

- If `formCfg.wholesalePrice === false`, skip wholesale validation entirely.
- If `formCfg.retailPrice === false`, skip retail price validation.
- If neither wholesale nor retail is enabled (edge case), block save with a clear error.

### 3e. Unit chip section behaviour

If `formCfg.packUnits === false` but `formCfg.wholesalePrice === true`:
- Show the wholesale price section with a **single row** for the base unit only.
- Hide the chip palette entirely.
- Base unit defaults to "Piece" silently.

If `formCfg.packUnits === false` and `formCfg.wholesalePrice === false`:
- Hide the entire Units + Wholesale section.
- The default base unit ("Piece") is used silently.

---

## Phase 4 — First-Time Setup Prompt (optional, do last)

When the app loads for the first time (no settings saved yet), show a one-time overlay
on the Items page before the user taps "Add item":

```
┌─────────────────────────────────────────────────┐
│  Quick setup — 10 seconds                       │
│                                                 │
│  How do you sell?                               │
│  ○ Retail only                                  │
│  ● Wholesale + Retail                           │
│  ○ Wholesale only                               │
│                                                 │
│         [ Set up my store → ]                   │
└─────────────────────────────────────────────────┘
```

Tapping the button saves `businessMode` + the matching preset and dismisses the overlay.
The user can always change it in Settings later.

Detect first-time: `settings.businessName === DEFAULT_SETTINGS.businessName &&
settings.businessMode === undefined` (i.e. the DB has the factory defaults and has never
been touched).

---

## File Change Summary

| File | Change |
|---|---|
| `lib/types.ts` | Add `BusinessMode`, `ItemFormConfig`; extend `Settings`; add `ITEM_FORM_PRESETS`; update `DEFAULT_SETTINGS` |
| `app/settings/page.tsx` | Add "Item Form" card: mode selector + fields checklist |
| `app/items/page.tsx` | Load `formCfg` + `bizMode` from settings; conditional field rendering; dynamic section order; updated validation |
| `lib/db.ts` | No changes — `getSettings`/`saveSettings` already handle the full `Settings` object |

---

## Build Order

1. `lib/types.ts` — types + presets + updated `DEFAULT_SETTINGS` ← no UI risk
2. `app/settings/page.tsx` — new card, save works, form config stored
3. `app/items/page.tsx` — form reads config, sections reorder and hide correctly
4. Test three modes end-to-end: retail / both / wholesale
5. (Optional) First-time setup overlay

---

## Notes

- `Name` and base `Unit` are always rendered — not configurable.
- The barcode section's "Generate internal barcode" link follows `formCfg.barcode`.
- Pack size (the text field like "500g") is independent of pack units (the chip palette)
  — a user might want to write "500g" on a retail-only item without needing Case/Dozen chips.
- MRP defaults to off because most kirana shops don't track it; accountant-type users
  can turn it on in Settings.
- This plan does not touch billing, stock-in, or any other page — the config is read
  only by the Add Item form.
