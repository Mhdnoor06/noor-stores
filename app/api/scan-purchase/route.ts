import { NextRequest, NextResponse } from "next/server";
import { scanPurchaseBill } from "@/lib/ai";

// Node runtime (the AI SDKs aren't edge-compatible); allow time for OCR + parse.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { image } = await req.json();
    if (!image || typeof image !== "string" || !image.startsWith("data:")) {
      return NextResponse.json({ error: "Send a bill image as a data URL in `image`." }, { status: 400 });
    }
    const result = await scanPurchaseBill(image);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Scan failed." },
      { status: 500 }
    );
  }
}
