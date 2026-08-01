import "server-only";

import { getServerEnv } from "@/lib/env";
import {
  claimAdminTelegramAiDraft,
  finishAdminTelegramAiDraft,
} from "./telegramCampaigns";
import {
  ADMIN_TELEGRAM_AI_RESPONSE_SCHEMA,
  buildAdminTelegramAiPrompt,
  normalizeAdminTelegramAiFacts,
  parseAdminTelegramAiDraft,
} from "./telegramCampaignAiPolicy";

type OpenAiResponse = {
  id?: unknown;
  output_text?: unknown;
  output?: Array<{
    content?: Array<{ text?: unknown }>;
  }>;
  error?: { message?: unknown };
};

export async function generateAdminTelegramAiDraft(input: {
  actorUserId: string;
  facts: unknown;
  reason: unknown;
  requestId?: string;
  fetchImpl?: typeof fetch;
}) {
  const facts = normalizeAdminTelegramAiFacts(input.facts);
  const env = getServerEnv();
  const model = env.openAiModel;
  const requestAuditId = await claimAdminTelegramAiDraft({
    actorUserId: input.actorUserId,
    reason: input.reason,
    requestId: input.requestId,
  });

  if (!env.openAiApiKey) {
    await finishAdminTelegramAiDraft({
      actorUserId: input.actorUserId,
      requestAuditId,
      status: "failed",
      model,
      errorCode: "OPENAI_NOT_CONFIGURED",
    });
    throw new Error("ADMIN_TELEGRAM_AI_NOT_CONFIGURED");
  }

  const prompt = buildAdminTelegramAiPrompt(facts);
  const fetchImpl = input.fetchImpl || fetch;
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: prompt.instructions,
        input: prompt.input,
        max_output_tokens: 700,
        text: {
          format: {
            type: "json_schema",
            ...ADMIN_TELEGRAM_AI_RESPONSE_SCHEMA,
          },
        },
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | OpenAiResponse
      | null;
    if (!response.ok) {
      throw new Error(
        sanitizeAiError(readString(payload?.error?.message) || response.statusText),
      );
    }
    const draft = parseAdminTelegramAiDraft(readOutputText(payload));
    const auditRecorded = await finishAdminTelegramAiDraft({
      actorUserId: input.actorUserId,
      requestAuditId,
      status: "succeeded",
      model,
      responseId: readString(payload?.id),
    });
    if (!auditRecorded) {
      throw new Error("ADMIN_TELEGRAM_AI_AUDIT_FAILED");
    }
    return { draft, model, requestAuditId };
  } catch (error) {
    await finishAdminTelegramAiDraft({
      actorUserId: input.actorUserId,
      requestAuditId,
      status: "failed",
      model,
      errorCode: aiErrorCode(error),
    });
    throw new Error("ADMIN_TELEGRAM_AI_FAILED");
  }
}

function readOutputText(payload: OpenAiResponse | null) {
  const direct = readString(payload?.output_text);
  if (direct) return direct;
  for (const item of payload?.output || []) {
    for (const content of item.content || []) {
      const text = readString(content.text);
      if (text) return text;
    }
  }
  return "";
}

function aiErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("RESPONSE_INVALID")) return "RESPONSE_INVALID";
  if (message.includes("429")) return "PROVIDER_RATE_LIMITED";
  return "PROVIDER_FAILED";
}

function sanitizeAiError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .slice(0, 240);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
