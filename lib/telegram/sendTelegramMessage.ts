import "server-only";

import { getServerEnv } from "@/lib/env";

export async function sendTelegramMessage(chatId: string, text: string) {
  const token = getServerEnv().telegramBotToken;
  if (!token) {
    return {
      ok: false,
      status: 0,
      error: "TELEGRAM_BOT_TOKEN is missing",
      outcome: "not_sent" as const,
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
    const data = await response.json().catch(() => null);

    return {
      ok: Boolean(response.ok && data?.ok),
      status: response.status,
      providerMessageId: readTelegramMessageId(data),
      error: response.ok && data?.ok ? undefined : readTelegramError(data, response.statusText),
      outcome: response.ok && data?.ok ? ("sent" as const) : ("not_sent" as const),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Telegram send failed",
      outcome: "uncertain" as const,
    };
  }
}

function readTelegramError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "description" in data) {
    return String((data as { description?: unknown }).description || fallback);
  }
  return fallback;
}

function readTelegramMessageId(data: unknown) {
  if (
    data &&
    typeof data === "object" &&
    "result" in data &&
    (data as { result?: unknown }).result &&
    typeof (data as { result?: unknown }).result === "object"
  ) {
    const messageId = (
      (data as { result: { message_id?: unknown } }).result
    ).message_id;
    if (typeof messageId === "number" || typeof messageId === "string") {
      return String(messageId);
    }
  }
  return undefined;
}
