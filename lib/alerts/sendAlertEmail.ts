import "server-only";

import { Resend } from "resend";
import type { NormalizedAlertEvent } from "@/lib/alerts/delivery/types";
import { getAlertEmailConfig } from "@/lib/alerts/emailConfig";
import { renderAlertEmail } from "@/lib/alerts/renderAlertEmail";
import { createEmailUnsubscribeToken } from "@/lib/alerts/emailUnsubscribeToken";

export async function sendAlertEmail(input: { deliveryId: string; userId: string; destination: string; event: NormalizedAlertEvent; beforeSend?: () => Promise<boolean> }) {
  const config = getAlertEmailConfig();
  if (!config.sendingEnabled) return { ok: false as const, outcome: "not_sent" as const, error: "Email sending is disabled or not configured." };
  const token = createEmailUnsubscribeToken(input.userId, config.unsubscribeSecret);
  const unsubscribeUrl = new URL("/api/alerts/email/unsubscribe", config.appBaseUrl); unsubscribeUrl.searchParams.set("token", token);
  const rendered = await renderAlertEmail(input.event, config.appBaseUrl, unsubscribeUrl.toString());
  if (input.beforeSend && !await input.beforeSend()) {
    return { ok: false as const, outcome: "suppressed" as const, error: "Ticker subscription match invalidated before email send." };
  }
  try {
    const result = await new Resend(config.apiKey).emails.send({
      from: config.from, to: [input.destination], subject: rendered.subject, html: rendered.html, text: rendered.text,
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      headers: { "List-Unsubscribe": `<${unsubscribeUrl.toString()}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }, { idempotencyKey: `alert-email/${input.deliveryId}` });
    if (result.error || !result.data?.id) return { ok: false as const, outcome: "not_sent" as const, error: safeProviderError(result.error) };
    return { ok: true as const, providerMessageId: result.data.id };
  } catch {
    return { ok: false as const, outcome: "uncertain" as const, error: "Email provider outcome is uncertain; automatic retry is blocked." };
  }
}
function safeProviderError(value: unknown) { if (!value || typeof value !== "object") return "Email provider rejected the request."; const name = typeof (value as { name?: unknown }).name === "string" ? (value as { name: string }).name : "provider_error"; return `Email provider rejected the request (${name.slice(0, 80)}).`; }
