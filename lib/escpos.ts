// Minimal ESC/POS command builder for 58mm thermal printers.
// Bytes are emitted as a Uint8Array ready to write to a BLE characteristic.

export const ESC = 0x1b;
export const GS = 0x1d;

export const CMD = {
  INIT: [ESC, 0x40],
  FEED_LINE: [0x0a],
  CUT_PAPER: [GS, 0x56, 0x41, 0x00],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  FONT_LARGE: [GS, 0x21, 0x11],
  FONT_NORMAL: [GS, 0x21, 0x00],
};

// Builds a sequence of ESC/POS byte arrays / strings into one Uint8Array.
export class EscPosBuilder {
  private chunks: number[] = [];

  raw(bytes: number[]): this {
    this.chunks.push(...bytes);
    return this;
  }

  text(str: string): this {
    // CP437 / ASCII subset is fine for English + Rs. Most cheap printers
    // print plain ASCII bytes directly.
    for (let i = 0; i < str.length; i++) {
      this.chunks.push(str.charCodeAt(i) & 0xff);
    }
    return this;
  }

  line(str = ""): this {
    return this.text(str).raw(CMD.FEED_LINE);
  }

  init(): this {
    return this.raw(CMD.INIT);
  }

  bold(on: boolean): this {
    return this.raw(on ? CMD.BOLD_ON : CMD.BOLD_OFF);
  }

  align(a: "left" | "center" | "right"): this {
    return this.raw(
      a === "center"
        ? CMD.ALIGN_CENTER
        : a === "right"
          ? CMD.ALIGN_RIGHT
          : CMD.ALIGN_LEFT
    );
  }

  large(on: boolean): this {
    return this.raw(on ? CMD.FONT_LARGE : CMD.FONT_NORMAL);
  }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i++) this.raw(CMD.FEED_LINE);
    return this;
  }

  cut(): this {
    return this.raw(CMD.CUT_PAPER);
  }

  // Prints a CODE128 barcode (works for any digit/ASCII string, widely
  // supported). HRI digits print below the bars.
  code128(data: string, height = 64): this {
    this.raw([GS, 0x48, 0x02]); // HRI text below barcode
    this.raw([GS, 0x66, 0x00]); // HRI font A
    this.raw([GS, 0x68, height]); // barcode height
    this.raw([GS, 0x77, 0x02]); // module width
    // GS k 73 n d... ; data is prefixed with "{B" to select CODE128 code set B
    const payload = [0x7b, 0x42];
    for (let i = 0; i < data.length; i++) payload.push(data.charCodeAt(i) & 0x7f);
    this.raw([GS, 0x6b, 73, payload.length]);
    this.raw(payload);
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}

/* --------------------------- Formatting --------------------------- */

// Two-column row: label on the left, value flush right, padded to `width`.
export function twoCol(left: string, right: string, width = 32): string {
  const space = Math.max(1, width - left.length - right.length);
  if (space < 1) {
    // truncate the left side if the line would overflow
    const keep = Math.max(0, width - right.length - 1);
    return left.slice(0, keep) + " " + right;
  }
  return left + " ".repeat(space) + right;
}

// Item row: name (left, truncated) + qty label + amount (right).
export function itemRow(
  name: string,
  qtyCol: string,
  amount: string,
  width = 32
): string {
  const right = `${qtyCol}  ${amount}`;
  const nameWidth = Math.max(1, width - right.length);
  const trimmed =
    name.length > nameWidth ? name.slice(0, nameWidth - 1) + "…" : name;
  return twoCol(trimmed, right, width);
}

export function rule(width = 32, ch = "-"): string {
  return ch.repeat(width);
}

export function money(n: number): string {
  return `Rs.${n.toFixed(2)}`;
}

/* ---------------------------- Receipts ---------------------------- */

import type { Bill, Item, Settings } from "./types";
import { qtyLabel, perUnit } from "./units";

function formatDate(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(
    d.getFullYear()
  ).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Builds the real customer bill as ESC/POS bytes (no tax lines).
export function buildReceipt(bill: Bill, settings: Settings): Uint8Array {
  const w = settings.paperWidth || 32;
  const b = new EscPosBuilder();

  b.init().align("center");

  if (settings.businessName) {
    b.large(true).bold(true).line(settings.businessName).large(false).bold(false);
  }
  if (settings.address) settings.address.split("\n").forEach((l) => b.line(l));
  if (settings.phone) b.line(`Ph: ${settings.phone}`);
  if (settings.gstin) b.line(`GSTIN: ${settings.gstin}`);

  b.line(rule(w, "="));
  b.align("left");
  b.line(twoCol(`Bill No: ${bill.number}`, formatDate(bill.createdAt), w));
  if (bill.customerName) b.line(`Customer: ${bill.customerName}`);
  if (bill.customerPhone) b.line(`Phone: ${bill.customerPhone}`);
  b.line(rule(w));
  b.line(twoCol("Item", "Qty  Amount", w));
  b.line(rule(w));

  for (const line of bill.lines) {
    const label = line.size ? `${line.name} ${line.size}` : line.name;
    b.line(
      itemRow(label, qtyLabel(line.qty, line.unit), money(line.price * line.qty), w)
    );
  }

  b.line(rule(w));
  const discount = bill.discount ?? 0;
  const roundOff = bill.roundOff ?? 0;
  if (discount > 0 || roundOff !== 0) {
    const sub = bill.subtotal ?? bill.total + discount - roundOff;
    b.line(twoCol("Subtotal:", money(sub), w));
    if (discount > 0) b.line(twoCol("Discount:", "-" + money(discount), w));
    if (roundOff !== 0)
      b.line(twoCol("Round off:", (roundOff >= 0 ? "+" : "-") + money(Math.abs(roundOff)), w));
  }
  b.bold(true).large(true);
  b.line(twoCol("TOTAL:", money(bill.total), Math.floor(w / 2)));
  b.large(false).bold(false);

  // payment line
  const pm = bill.paymentMethod ?? "cash";
  const pmLabel = pm === "upi" ? "UPI" : pm === "card" ? "Card" : "Cash";
  if (pm === "cash" && bill.amountPaid != null && bill.amountPaid >= bill.total) {
    b.line(twoCol("Paid (Cash):", money(bill.amountPaid), w));
    b.line(twoCol("Change:", money(bill.amountPaid - bill.total), w));
  } else {
    b.line(twoCol("Paid:", pmLabel, w));
  }
  b.line(rule(w, "="));

  b.align("center");
  if (settings.footer) settings.footer.split("\n").forEach((l) => b.line(l));
  b.feed(3).cut();

  return b.build();
}

// Prints barcode labels on the thermal printer — one stacked label per item
// (name + price + CODE128 barcode). Good for sticking on loose/unbranded goods.
export function buildLabels(items: Item[]): Uint8Array {
  const b = new EscPosBuilder();
  b.init();
  for (const item of items) {
    if (!item.barcode) continue;
    b.align("center");
    const name = item.name.length > 32 ? item.name.slice(0, 31) + "…" : item.name;
    b.bold(true).line(name).bold(false);
    b.line(`${money(item.price)} ${perUnit(item.unit)}`);
    b.feed(1);
    b.code128(item.barcode);
    b.feed(3);
  }
  b.cut();
  return b.build();
}

// A simple 32-char-wide test receipt to confirm printing works.
export function buildTestReceipt(): Uint8Array {
  const b = new EscPosBuilder();
  b.init()
    .align("center")
    .large(true)
    .bold(true)
    .line("EZO TEST")
    .large(false)
    .bold(false)
    .line("Printer Connection OK")
    .line("--------------------------------")
    .align("left")
    .line("If you can read this, the")
    .line("Web Bluetooth -> ESC/POS")
    .line("pipeline is working.")
    .line("--------------------------------")
    .align("center")
    .line("Sample chars:")
    .line("Rs.123.45  GST 18%  x2")
    .feed(1)
    .bold(true)
    .line("TOTAL: Rs.413")
    .bold(false)
    .feed(2)
    .line("Thank you!")
    .feed(3)
    .cut();
  return b.build();
}
