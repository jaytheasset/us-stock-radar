import { NextRequest, NextResponse } from "next/server";
import { recordSnapTradeWebhook, verifySnapTradeWebhook } from "@/lib/brokerage/webhook";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const event = verifySnapTradeWebhook({
    body,
    signature: request.headers.get("signature"),
  });
  if (!event) {
    return NextResponse.json({ error: "Invalid webhook." }, { status: 401 });
  }
  const result = await recordSnapTradeWebhook(event);
  return NextResponse.json({ ok: result.ok }, { status: result.ok ? 200 : 502 });
}
