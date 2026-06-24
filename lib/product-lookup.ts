// Looks up product info from a barcode using Open Food Facts (free, open,
// no API key, CORS-enabled). Good coverage for branded packaged groceries
// including Indian products. Returns null when the product isn't in the DB.
//
// We deliberately build a SHORT name (brand + product type, e.g. "Aashirvaad
// Atta", "Sunpure Oil") rather than the raw API name, which is often long and
// stuffed with marketing text. price is never returned (it's local to the shop)
// and size is returned separately so it fills its own field.

export interface ProductInfo {
  name: string;
  brand?: string;
  quantity?: string;
}

export async function lookupProduct(
  barcode: string
): Promise<ProductInfo | null> {
  const code = barcode.trim();
  if (!code) return null;
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
        code
      )}.json?fields=product_name,product_name_en,brands,categories,quantity`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    // Brand field is often "Brand Manufacturer" (e.g. "Gold winner kaleesuwari")
    // — the consumer brand is the first word or two, so cap it.
    const brand = titleCase(firstWords((p.brands || "").split(",")[0].trim(), 2));
    const quantity = (p.quantity || "").trim();
    const type = shortType(p.categories || "");
    const rawName = (p.product_name_en || p.product_name || "").trim();

    const name = buildShortName(brand, type, rawName);
    if (!name) return null;

    return {
      name,
      brand: brand || undefined,
      quantity: quantity || undefined,
    };
  } catch {
    return null;
  }
}

// Brand + a one-word product type → a short, shop-friendly name.
// Falls back to a trimmed version of the raw name when there's no brand.
function buildShortName(brand: string, type: string, rawName: string): string {
  let name = brand;
  if (type && (!brand || !brand.toLowerCase().includes(type.toLowerCase()))) {
    name = brand ? `${brand} ${type}` : type;
  }
  if (!name) name = shortenRaw(rawName);
  name = dedupeWords(name).trim();
  return capWords(name, 3, 26);
}

// The most-specific category, reduced to a single title-cased noun.
// "Sunflower oils" -> "Oil", "Attas" -> "Atta", "Potato crisps" -> "Crisp".
function shortType(categories: string): string {
  const first = categories.split(",")[0]?.trim();
  if (!first) return "";
  const words = first.split(/\s+/);
  const last = singularize(words[words.length - 1].toLowerCase());
  return titleCase(last);
}

// Fallback when there's no brand: strip marketing junk + size, keep a few words.
function shortenRaw(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  s = s.replace(
    /\b(?:is\s+)?(?:sold|manufactured|marketed|packed|distributed|imported)\s+by\s+.+?(?:limited|ltd\.?|pvt\.?\s*ltd\.?|private\s+limited|inc\.?|llp|corp(?:oration)?|company|co\.?|industries|foods?|products?)\b/gi,
    " "
  );
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(
    /\b\d+(?:\.\d+)?\s?(?:kgs?|kg|gms?|gm|g|grams?|l|ltrs?|ltr|litres?|liters?|ml|mls)\b/gi,
    " "
  );
  return s.replace(/\s+/g, " ").trim();
}

function dedupeWords(s: string): string {
  const out: string[] = [];
  for (const w of s.split(" ")) {
    if (!w) continue;
    if (out.length && out[out.length - 1].toLowerCase() === w.toLowerCase())
      continue;
    out.push(w);
  }
  return out.join(" ");
}

// Keep at most `maxWords` words and `maxChars` characters (word boundary).
function capWords(s: string, maxWords: number, maxChars: number): string {
  let words = s.split(/\s+/).filter(Boolean).slice(0, maxWords);
  let out = words.join(" ");
  while (out.length > maxChars && words.length > 1) {
    words = words.slice(0, -1);
    out = words.join(" ");
  }
  return out;
}

function firstWords(s: string, n: number): string {
  return s.split(/\s+/).filter(Boolean).slice(0, n).join(" ");
}

function singularize(w: string): string {
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
