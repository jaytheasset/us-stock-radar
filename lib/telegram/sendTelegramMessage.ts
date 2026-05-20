import "server-only";

import { getServerEnv } from "@/lib/env";

export async function sendTelegramMessage(chatId: string, text: string) {
  const token = getServerEnv().telegramBotToken;
  if (!token) {
    return {
      ok: false,
      status: 0,
      error: "TELEGRAM_BOT_TOKEN is missing",
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
      error: response.ok && data?.ok ? undefined : readTelegramError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Telegram send failed",
    };
  }
}

function readTelegramError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "description" in data) {
    return String((data as { description?: unknown }).description || fallback);
  }
  return fallback;
}
