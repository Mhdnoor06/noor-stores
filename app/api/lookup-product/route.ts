import { NextResponse } from "next/server";
import { resolveProduct, type ProductInfo } from "@/lib/product-lookup";

export const runtime = "nodejs";

// Product data is effectively static, so cache aggressively: an in-memory map
// per server instance for instant repeats, plus a CDN/browser cache header.
type Hit = { info: ProductInfo | null; t: number };
const TTL = 24 * 60 * 60 * 1000; // 24h
const cache = new Map<string, Hit>();

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code")?.trim();
  if (!code) return NextResponse.json(null);

  const now = Date.now();
  const cached = cache.get(code);
  if (cached && now - cached.t < TTL) {
    return NextResponse.json(cached.info, {
      headers: { "Cache-Control": "public, max-age=86400", "X-Cache": "HIT" },
    });
  }

  let info: ProductInfo | null = null;
  try {
    info = await resolveProduct(code);
  } catch {
    info = null;
  }

  // Cache misses too (negative cache) so unknown barcodes don't re-hit the
  // upstream APIs on every scan. Keep the map from growing unbounded.
  if (cache.size > 2000) cache.clear();
  cache.set(code, { info, t: now });

  return NextResponse.json(info, {
    headers: { "Cache-Control": "public, max-age=86400", "X-Cache": "MISS" },
  });
}
