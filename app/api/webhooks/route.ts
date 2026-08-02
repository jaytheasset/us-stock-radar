import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getAlertEmailConfig } from "@/lib/alerts/emailConfig";
import { supabaseRpc } from "@/lib/supabase";
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "@/lib/http/boundedRequestBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT = 300;
let windowStartedAt = 0;
let requestsInWindow = 0;

export async function POST(request: NextRequest) {
  if (!allowRequest()) return NextResponse.json({ ok: false }, { status: 429 });
  let payload: string;
  try {
    payload = await readBoundedRequestText(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const config = getAlertEmailConfig();
  const id = request.headers.get("svix-id") || "";
  const timestamp = request.headers.get("svix-timestamp") || "";
  const signature = request.headers.get("svix-signature") || "";
  if (!config.webhookSecret || !id || !timestamp || !signature) return NextResponse.json({ ok: false }, { status: 401 });

  let event: ReturnType<Resend["webhooks"]["verify"]>;
  try {
    event = new Resend(config.apiKey || "re_webhook_verification_only").webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: config.webhookSecret,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  if (!isTrackedEvent(event.type)) return NextResponse.json({ ok: true, ignored: true });
  const emailId = readString((event.data as { email_id?: unknown }).email_id);
  if (!emailId || !Number.isFinite(Date.parse(event.created_at))) return NextResponse.json({ ok: false }, { status: 400 });
  const result = await supabaseRpc("record_alert_email_webhook_event", {
    p_webhook_id: id,
    p_provider_message_id: emailId,
    p_event_type: event.type,
    p_event_created_at: event.created_at,
  });
  if (!result.ok) return NextResponse.json({ ok: false }, { status: 503 });
  return NextResponse.json({ ok: true, duplicate: result.data === false });
}

function isTrackedEvent(value: string): value is "email.delivered" | "email.bounced" | "email.complained" | "email.suppressed" {
  return value === "email.delivered" || value === "email.bounced" || value === "email.complained" || value === "email.suppressed";
}
function readString(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 255) : ""; }
function allowRequest(now = Date.now()) { if (now - windowStartedAt >= 60_000) { windowStartedAt = now; requestsInWindow = 0; } requestsInWindow += 1; return requestsInWindow <= RATE_LIMIT; }
