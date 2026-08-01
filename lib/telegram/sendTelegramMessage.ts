import "server-only";

import { getServerEnv } from "@/lib/env";

export type TelegramInlineKeyboardButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramMessageOptions = {
  parseMode?: "HTML" | "MarkdownV2";
  replyMarkup?: TelegramInlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
};

type TelegramApiResult = {
  ok: boolean;
  status: number;
  providerMessageId?: string;
  error?: string;
  outcome: "sent" | "not_sent" | "uncertain";
};

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options: TelegramMessageOptions = {},
) {
  const validationError = validateMessageOptions(options);
  if (validationError) return failedResult(validationError);

  return callTelegramBotApi("sendMessage", {
    chat_id: chatId,
    text,
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    ...(options.disableWebPagePreview === undefined
      ? {}
      : { link_preview_options: { is_disabled: options.disableWebPagePreview } }),
  });
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  options: { text?: string; showAlert?: boolean } = {},
) {
  return callTelegramBotApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(options.text ? { text: options.text.slice(0, 200) } : {}),
    ...(options.showAlert === undefined ? {} : { show_alert: options.showAlert }),
  });
}

export async function editTelegramMessageText(
  chatId: string,
  messageId: string | number,
  text: string,
  options: TelegramMessageOptions = {},
) {
  const validationError = validateMessageOptions(options);
  if (validationError) return failedResult(validationError);

  return callTelegramBotApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    ...(options.disableWebPagePreview === undefined
      ? {}
      : { link_preview_options: { is_disabled: options.disableWebPagePreview } }),
  });
}

function validateMessageOptions(options: TelegramMessageOptions) {
  if (!options.replyMarkup) return "";
  const rows = options.replyMarkup.inline_keyboard;
  if (!Array.isArray(rows) || !rows.length) return "Telegram inline keyboard is empty.";

  for (const row of rows) {
    if (!Array.isArray(row) || !row.length) return "Telegram inline keyboard row is empty.";
    for (const button of row) {
      if (!button?.text?.trim()) return "Telegram inline keyboard button text is missing.";
      const hasUrl = typeof button.url === "string" && button.url.length > 0;
      const hasCallback = typeof button.callback_data === "string" && button.callback_data.length > 0;
      if (hasUrl === hasCallback) return "Telegram inline keyboard button action is invalid.";
      if (hasCallback && Buffer.byteLength(button.callback_data || "", "utf8") > 64) {
        return "Telegram callback_data exceeds 64 bytes.";
      }
      if (hasUrl && !isSafeTelegramButtonUrl(button.url || "")) {
        return "Telegram inline keyboard URL is invalid.";
      }
    }
  }
  return "";
}

function isSafeTelegramButtonUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

async function callTelegramBotApi(
  method: "sendMessage" | "answerCallbackQuery" | "editMessageText",
  payload: Record<string, unknown>,
): Promise<TelegramApiResult> {
  const token = getServerEnv().telegramBotToken;
  if (!token) return failedResult("TELEGRAM_BOT_TOKEN is missing");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    const ok = Boolean(response.ok && data?.ok);

    return {
      ok,
      status: response.status,
      providerMessageId: readTelegramMessageId(data),
      error: ok ? undefined : readTelegramError(data, response.statusText),
      outcome: ok ? "sent" : "not_sent",
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: redactTelegramError(error instanceof Error ? error.message : "Telegram request failed", token),
      outcome: "uncertain",
    };
  }
}

function redactTelegramError(value: string, token: string) {
  return value
    .replaceAll(token, "[redacted]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .slice(0, 500);
}

function failedResult(error: string): TelegramApiResult {
  return { ok: false, status: 0, error, outcome: "not_sent" };
}

function readTelegramError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "description" in data) {
    return String((data as { description?: unknown }).description || fallback).slice(0, 500);
  }
  return fallback || "Telegram request failed";
}

function readTelegramMessageId(data: unknown) {
  if (
    data &&
    typeof data === "object" &&
    "result" in data &&
    (data as { result?: unknown }).result &&
    typeof (data as { result?: unknown }).result === "object"
  ) {
    const messageId = (data as { result: { message_id?: unknown } }).result.message_id;
    if (typeof messageId === "number" || typeof messageId === "string") return String(messageId);
  }
  return undefined;
}
