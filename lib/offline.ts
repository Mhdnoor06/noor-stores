// Offline support for the single-counter POS. Uses localStorage (small data,
// synchronous, reliable) to cache the catalogue + settings, hold a local bill
// counter, and queue sales made while the internet is down.

import { Bill, Item, Settings } from "./types";

const ITEMS_KEY = "noor.items.cache.v1";
const SETTINGS_KEY = "noor.settings.cache.v1";
const OUTBOX_KEY = "noor.outbox.v1";
const COUNTER_KEY = "noor.billcounter.v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, val: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

// True for fetch/connectivity failures (vs. real server/validation errors).
export function isNetworkError(e: unknown): boolean {
  if (!isOnline()) return true;
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return /failed to fetch|networkerror|load failed|fetch|timeout|network/.test(msg);
}

/* ----------------------------- Catalogue cache ---------------------------- */

export function cacheItems(items: Item[]): void {
  write(ITEMS_KEY, items);
}
export function getCachedItems(): Item[] {
  return read<Item[]>(ITEMS_KEY, []);
}
// Optimistically reduce cached stock so back-to-back offline bills stay sane.
export function applyCachedStock(lines: { itemId: string; qty: number }[]): void {
  const items = getCachedItems();
  if (items.length === 0) return;
  const dec = new Map(lines.map((l) => [l.itemId, l.qty]));
  cacheItems(
    items.map((i) => (dec.has(i.id) ? { ...i, stock: (i.stock ?? 0) - (dec.get(i.id) || 0) } : i))
  );
}

export function cacheSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}
export function getCachedSettings(): Settings | null {
  return read<Settings | null>(SETTINGS_KEY, null);
}

/* ------------------------------ Bill counter ------------------------------ */

export function peekBillCounter(): number {
  return read<number>(COUNTER_KEY, 0);
}
// Raise the local counter to at least the server's latest number.
export function seedBillCounter(serverMax: number): void {
  if (serverMax > peekBillCounter()) write(COUNTER_KEY, serverMax);
}
// Atomically take the next number (offline-safe; no network read).
export function takeBillNumber(): number {
  const n = peekBillCounter() + 1;
  write(COUNTER_KEY, n);
  return n;
}

/* -------------------------------- Outbox --------------------------------- */

export interface OutboxEntry {
  id: string;
  bill: Bill;
  lines: { itemId: string; qty: number }[];
  createdAt: number;
}

export function getOutbox(): OutboxEntry[] {
  return read<OutboxEntry[]>(OUTBOX_KEY, []);
}
export function outboxCount(): number {
  return getOutbox().length;
}
export function enqueueSale(bill: Bill, lines: { itemId: string; qty: number }[]): void {
  const o = getOutbox();
  o.push({ id: shortId(), bill, lines, createdAt: bill.createdAt });
  write(OUTBOX_KEY, o);
  applyCachedStock(lines);
}
export function removeFromOutbox(id: string): void {
  write(OUTBOX_KEY, getOutbox().filter((e) => e.id !== id));
}
