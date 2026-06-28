// SERVER-ONLY AI helpers for the purchase-bill scanner. Mirrors the multi-key
// failover used in the user's `shipquery` project: Mistral OCR turns the bill
// photo into text, then a chat model parses it into structured line items.
// Never import this from client code — it reads non-public API keys.

import OpenAI from "openai";
import { Mistral } from "@mistralai/mistralai";

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "qwen/qwen3.6-plus:free";
const MISTRAL_CHAT_MODEL = process.env.MISTRAL_CHAT_MODEL || "mistral-small-latest";

function openrouter(key?: string) {
  return key ? new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: key }) : null;
}
function mistral(key?: string) {
  return key ? new Mistral({ apiKey: key }) : null;
}

const OR1 = openrouter(process.env.OPENROUTER_API_KEY);
const OR2 = openrouter(process.env.OPENROUTER_API_KEY_2);
const M1 = mistral(process.env.MISTRAL_API_KEY);
const M2 = mistral(process.env.MISTRAL_API_KEY_2);

export type ParsedLine = {
  name: string;
  qty: number | null;
  unit: string | null;
  cost: number | null; // per-unit purchase price if shown
  mrp: number | null;
  amount: number | null; // line total if shown
};
export type ParsedPurchase = {
  vendorName: string | null;
  invoiceNumber: string | null;
  date: string | null;
  lines: ParsedLine[];
  total: number | null;
};

const PARSE_SYSTEM = `You extract structured purchase data from a supplier bill/invoice (often Indian wholesale) supplied as OCR text (markdown). Return ONLY a JSON object — no prose, no code fences — exactly matching this shape:
{"vendorName": string|null, "invoiceNumber": string|null, "date": string|null, "lines": [{"name": string, "qty": number|null, "unit": string|null, "cost": number|null, "mrp": number|null, "amount": number|null}], "total": number|null}
Rules:
- "vendorName" = the SELLER / SUPPLIER / company issuing the bill — usually the business name in the letterhead at the top (NOT the buyer / "Bill To" / customer). Always try to fill this from the header even if no explicit "vendor" label exists.
- "lines" = the products or services billed. Include EVERY line that has a description with a quantity and/or an amount — including a single service/fee line. Only skip pure subtotal/tax/GST/grand-total/payment-info rows.
- "name" = description as printed (keep brand + pack size, e.g. "Amul Gold 1L").
- "qty" = quantity. "cost" = per-unit price if shown, else null. "amount" = line total if shown, else null.
- Numbers must be plain numbers: no currency symbols, no thousands commas.
- "total" = the final grand total / amount due if shown.
- If a field is genuinely absent, use null. Never invent values.`;

// ---- OCR: Mistral, two keys ----
async function ocrWith(client: Mistral, dataUrl: string): Promise<string> {
  const isPdf = dataUrl.startsWith("data:application/pdf");
  const document = isPdf
    ? ({ type: "document_url", documentUrl: dataUrl } as const)
    : ({ type: "image_url", imageUrl: dataUrl } as const);
  const res = await client.ocr.process({ model: "mistral-ocr-latest", document });
  return (res.pages ?? []).map((p) => p.markdown).join("\n\n").trim();
}

async function runOcr(dataUrl: string): Promise<string> {
  const providers = [M1, M2].filter(Boolean) as Mistral[];
  if (providers.length === 0) throw new Error("No MISTRAL_API_KEY configured for OCR.");
  let lastErr: unknown;
  for (const client of providers) {
    try {
      const text = await ocrWith(client, dataUrl);
      if (text) return text;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`OCR failed: ${lastErr instanceof Error ? lastErr.message : "all keys failed"}`);
}

// ---- Parse: try OpenRouter then Mistral chat, alternating keys ----
function extractJson(raw: string): ParsedPurchase {
  let s = raw.trim();
  // Strip ```json ... ``` fences if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // Fall back to the first {...} block.
  if (!s.startsWith("{")) {
    const i = s.indexOf("{");
    const j = s.lastIndexOf("}");
    if (i >= 0 && j > i) s = s.slice(i, j + 1);
  }
  const obj = JSON.parse(s);
  return {
    vendorName: obj.vendorName ?? null,
    invoiceNumber: obj.invoiceNumber ?? null,
    date: obj.date ?? null,
    total: obj.total ?? null,
    lines: Array.isArray(obj.lines)
      ? obj.lines.map((l: Record<string, unknown>) => ({
          name: String(l.name ?? "").trim() || "Item",
          qty: numOrNull(l.qty),
          unit: l.unit != null ? String(l.unit) : null,
          cost: numOrNull(l.cost),
          mrp: numOrNull(l.mrp),
          amount: numOrNull(l.amount),
        }))
      : [],
  };
}
function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

async function parseOpenRouter(client: OpenAI, markdown: string): Promise<ParsedPurchase> {
  const r = await client.chat.completions.create({
    model: OPENROUTER_MODEL,
    messages: [
      { role: "system", content: PARSE_SYSTEM },
      { role: "user", content: markdown },
    ],
  });
  return extractJson(r.choices?.[0]?.message?.content ?? "");
}

async function parseMistral(client: Mistral, markdown: string): Promise<ParsedPurchase> {
  const r = await client.chat.complete({
    model: MISTRAL_CHAT_MODEL,
    messages: [
      { role: "system", content: PARSE_SYSTEM },
      { role: "user", content: markdown },
    ],
  });
  const content = r.choices?.[0]?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c) => ("text" in c ? c.text : "")).join("")
        : "";
  return extractJson(text);
}

async function runParse(markdown: string): Promise<ParsedPurchase> {
  const chain: Array<() => Promise<ParsedPurchase>> = [];
  if (OR1) chain.push(() => parseOpenRouter(OR1, markdown));
  if (M1) chain.push(() => parseMistral(M1, markdown));
  if (OR2) chain.push(() => parseOpenRouter(OR2, markdown));
  if (M2) chain.push(() => parseMistral(M2, markdown));
  if (chain.length === 0) throw new Error("No AI providers configured.");
  let lastErr: unknown;
  for (const attempt of chain) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Parse failed: ${lastErr instanceof Error ? lastErr.message : "all providers failed"}`);
}

// Full pipeline: bill image/PDF (data URL) → structured purchase draft.
export async function scanPurchaseBill(dataUrl: string): Promise<ParsedPurchase & { raw: string }> {
  const markdown = await runOcr(dataUrl);
  const parsed = await runParse(markdown);
  return { ...parsed, raw: markdown };
}
