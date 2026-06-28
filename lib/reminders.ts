// Payment-reminder + statement links for udhaar customers.
//
// These are plain deep links (WhatsApp click-to-chat / SMS) — NO WhatsApp API,
// no backend, no per-message cost. The shopkeeper taps once and the chat opens
// pre-filled on their own phone. Automated/bulk reminders (a paid tier) would
// later swap this for the official Cloud API or a self-hosted gateway.

import { Customer, CreditEntry } from "./types";
import { money } from "./escpos";

// Normalises an Indian mobile number to wa.me's digits-only, country-coded form.
// Strips spaces/dashes/“+”, drops a leading 0, and assumes +91 for bare
// 10-digit numbers. Returns null when there aren't enough digits to message.
export function normalizePhone(phone?: string): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10) d = "91" + d; // bare Indian mobile
  return d.length >= 11 ? d : null;
}

// Can we message this customer at all?
export function canRemind(c: Customer): boolean {
  return c.balance > 0 && normalizePhone(c.phone) !== null;
}

function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function smsLink(phone: string, text: string): string {
  // `?&body=` is the cross-platform-safe form for prefilled SMS bodies.
  return `sms:+${phone}?&body=${encodeURIComponent(text)}`;
}

// A short, polite Hinglish reminder of the outstanding balance.
export function reminderText(c: Customer, businessName: string): string {
  const shop = businessName?.trim() || "our shop";
  return (
    `Namaste ${c.name},\n` +
    `Aapka ${money(c.balance)} udhaar ${shop} mein pending hai. ` +
    `Jab convenient ho please clear kar dijiye. Dhanyavaad 🙏`
  );
}

// Returns the WhatsApp + SMS reminder URLs for a customer, or null if they
// can't be messaged (no balance / no valid number).
export function reminderLinks(
  c: Customer,
  businessName: string
): { whatsapp: string; sms: string } | null {
  const phone = normalizePhone(c.phone);
  if (!phone || c.balance <= 0) return null;
  const text = reminderText(c, businessName);
  return { whatsapp: waLink(phone, text), sms: smsLink(phone, text) };
}

function fmtDate(epoch: number): string {
  const d = new Date(epoch);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

// A full ledger statement the shopkeeper can send so the customer sees every
// udhaar and repayment behind the running balance.
export function statementText(
  c: Customer,
  ledger: CreditEntry[],
  businessName: string
): string {
  const shop = businessName?.trim() || "our shop";
  const lines = [...ledger]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((e) => {
      const repay = e.amount < 0;
      const label = repay
        ? `Paid${e.method ? ` (${e.method.toUpperCase()})` : ""}`
        : e.note || "Udhaar";
      return `${fmtDate(e.createdAt)}  ${repay ? "-" : "+"}${money(Math.abs(e.amount))}  ${label}`;
    });
  return (
    `${shop} — Udhaar statement\n` +
    `${c.name}\n\n` +
    (lines.length ? lines.join("\n") + "\n\n" : "") +
    `Outstanding: ${money(Math.max(0, c.balance))}`
  );
}

export function statementLinks(
  c: Customer,
  ledger: CreditEntry[],
  businessName: string
): { whatsapp: string; sms: string } | null {
  const phone = normalizePhone(c.phone);
  if (!phone) return null;
  const text = statementText(c, ledger, businessName);
  return { whatsapp: waLink(phone, text), sms: smsLink(phone, text) };
}
