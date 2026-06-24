// localStorage helpers. All reads are SSR-safe (return defaults on the server).

import { Bill, DEFAULT_SETTINGS, Item, Settings } from "./types";

const KEYS = {
  items: "ezo.items",
  bills: "ezo.bills",
  settings: "ezo.settings",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function uid(): string {
  // Date.now()-free-friendly enough for client runtime; collisions are
  // astronomically unlikely for a single-shop POS.
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

/* ----------------------------- Items ----------------------------- */

export function getItems(): Item[] {
  return read<Item[]>(KEYS.items, []);
}

export function saveItems(items: Item[]): void {
  write(KEYS.items, items);
}

export function upsertItem(item: Item): Item[] {
  const items = getItems();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  saveItems(items);
  return items;
}

export function deleteItem(id: string): Item[] {
  const items = getItems().filter((i) => i.id !== id);
  saveItems(items);
  return items;
}

/* ----------------------------- Bills ----------------------------- */

export function getBills(): Bill[] {
  // newest first
  return read<Bill[]>(KEYS.bills, []).sort((a, b) => b.createdAt - a.createdAt);
}

export function saveBill(bill: Bill): Bill[] {
  const bills = read<Bill[]>(KEYS.bills, []);
  bills.push(bill);
  write(KEYS.bills, bills);
  return getBills();
}

export function nextBillNumber(): number {
  const bills = read<Bill[]>(KEYS.bills, []);
  return bills.reduce((max, b) => Math.max(max, b.number), 0) + 1;
}

/* --------------------------- Settings ---------------------------- */

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) };
}

export function saveSettings(settings: Settings): void {
  write(KEYS.settings, settings);
}
