import { NextRequest, NextResponse } from "next/server";
import { recordSnapTradeWebhook, verifySnapTradeWebhook } from "@/lib/brokerage/webhook";
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "@/lib/http/boundedRequestBody";

const MAX_BODY_BYTES = 256 * 1024;

export async function POST(request: NextRequest) {
  let body: string;
  try {
    body = await readBoundedRequestText(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid webhook." }, { status: 400 });
  }
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
