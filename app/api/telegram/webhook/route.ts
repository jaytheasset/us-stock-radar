import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildChannelNotAvailableMessage, getChannelLockState, getUserPlan } from "@/lib/alerts/alertValidation";
import { getServerEnv } from "@/lib/env";
import {
  readBoundedRequestText,
  RequestBodyTooLargeError,
} from "@/lib/http/boundedRequestBody";
import {
  markTelegramConnectTokenUsed,
  saveTelegramConnection,
  verifyTelegramConnectToken,
  wasTelegramConnectTokenClaimed,
} from "@/lib/telegram/telegramConnect";
import {
  isPrivateTelegramChat,
  normalizeTelegramDestination,
  parseTelegramStartToken,
} from "@/lib/telegram/telegramConnectPolicy";
import { buildTelegramMuteConfirmationKeyboard } from "@/lib/telegram/telegramAlertMessage";
import { parseTelegramMuteCallbackData } from "@/lib/telegram/telegramCallbackPolicy";
import { handleTelegramConnectedCommand } from "@/lib/telegram/telegramCommandInteractions";
import {
  buildTelegramHelpText,
  isTelegramConnectedCommand,
  parseTelegramCommand,
} from "@/lib/telegram/telegramCommandPolicy";
import { resolveTelegramMuteAction } from "@/lib/telegram/telegramInteractions";
import {
  answerTelegramCallbackQuery,
  editTelegramMessageText,
  sendTelegramMessage,
  type TelegramInlineKeyboardMarkup,
} from "@/lib/telegram/sendTelegramMessage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

const MAX_BODY_BYTES = 128 * 1024;

type TelegramUpdate = {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type TelegramMessage = {
  message_id?: unknown;
  text?: unknown;
  chat?: TelegramChat;
  from?: TelegramSender;
};

type TelegramCallbackQuery = {
  id?: unknown;
  data?: unknown;
  from?: TelegramSender;
  message?: {
    message_id?: unknown;
    chat?: TelegramChat;
  };
};

type TelegramChat = {
  id?: unknown;
  type?: unknown;
  username?: unknown;
  first_name?: unknown;
  last_name?: unknown;
};

type TelegramSender = {
  id?: unknown;
  is_bot?: unknown;
  username?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  language_code?: unknown;
};

export async function POST(request: NextRequest) {
  const secret = getServerEnv().telegramWebhookSecret;
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_WEBHOOK_SECRET_MISSING" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  if (!secretsMatch(headerSecret, secret)) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  let rawBody: string;
  try {
    rawBody = await readBoundedRequestText(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { ok: false, error: "PAYLOAD_TOO_LARGE" },
        { status: 413, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { ok: false, error: "INVALID_PAYLOAD" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const update = parseTelegramUpdate(rawBody);
  if (update?.callback_query) return handleCallbackQuery(update.callback_query, secret);

  const message = update?.message;
  const chatId = normalizeTelegramDestination(message?.chat?.id);
  const chatType = stringValue(message?.chat?.type);
  const text = stringValue(message?.text);

  if (
    !message ||
    !isPrivateTelegramChat({
      chatId: message.chat?.id,
      chatType,
      senderId: message.from?.id,
      senderIsBot: message.from?.is_bot,
    })
  ) {
    return webhookResponse({ ok: true, ignored: true });
  }

  const command = parseTelegramCommand(text);
  if (command.name === "invalid") {
    await sendTelegramMessage(chatId, command.message, {
      replyMarkup: buildSiteKeyboard("Open command help", "/alerts"),
    });
    return webhookResponse({ ok: true, command: "invalid" });
  }

  if (command.name === "settings") {
    await sendTelegramMessage(
      chatId,
      "Manage watched tickers, Market Discovery, and delivery channels in Stock Radar Alerts.",
      { replyMarkup: buildSiteKeyboard("Open Alert Settings", "/alerts") },
    );
    return webhookResponse({ ok: true, command: "settings" });
  }

  if (command.name === "help") {
    await sendTelegramMessage(
      chatId,
      buildTelegramHelpText(),
      { replyMarkup: buildSiteKeyboard("Open Stock Radar Alerts", "/alerts") },
    );
    return webhookResponse({ ok: true, command: "help" });
  }

  if (isTelegramConnectedCommand(command)) {
    const presentation = await handleTelegramConnectedCommand({
      baseUrl: getServerEnv().appBaseUrl,
      command,
      destination: chatId,
    });
    await sendTelegramMessage(chatId, presentation.text, {
      replyMarkup: presentation.replyMarkup,
      disableWebPagePreview: true,
    });
    return webhookResponse({ ok: true, command: command.name });
  }

  if (command.name !== "start") return webhookResponse({ ok: true, ignored: true });

  const token = parseTelegramStartToken(text);

  if (!token) {
    await sendTelegramMessage(chatId, "Open STOCK RADAR and use Connect Telegram from Alert Center to link this chat.");
    return webhookResponse({ ok: true, ignored: true });
  }

  const verification = await verifyTelegramConnectToken(token);
  if (!verification.ok) {
    await sendTelegramMessage(chatId, "This connection link is expired. Please generate a new link from STOCK RADAR.");
    return webhookResponse({ ok: true, linked: false });
  }

  const plan = await getUserPlan(verification.userId);
  if (getChannelLockState(plan, "telegram")) {
    const message = buildChannelNotAvailableMessage("telegram");
    await sendTelegramMessage(chatId, message);
    return NextResponse.json(
      { ok: false, error: "CHANNEL_NOT_AVAILABLE", message },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const claimResult = await markTelegramConnectTokenUsed(verification.tokenId);
  if (!wasTelegramConnectTokenClaimed(claimResult)) {
    await sendTelegramMessage(chatId, "This connection link is expired. Please generate a new link from STOCK RADAR.");
    return webhookResponse({ ok: true, linked: false });
  }

  const result = await saveTelegramConnection({
    userId: verification.userId,
    destination: chatId,
    metadata: buildTelegramMetadata(message),
  });

  if (!result.ok) {
    if (result.status === 409) {
      await sendTelegramMessage(chatId, result.message);
    }
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status: result.status, headers: NO_STORE_HEADERS },
    );
  }

  await sendTelegramMessage(chatId, "Telegram alerts are connected. You can manage delivery channels in STOCK RADAR.");

  return webhookResponse({ ok: true, linked: true });
}

function parseTelegramUpdate(value: string): TelegramUpdate | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as TelegramUpdate)
      : null;
  } catch {
    return null;
  }
}

async function handleCallbackQuery(callback: TelegramCallbackQuery, tokenSecret: string) {
  const callbackQueryId = stringValue(callback.id);
  if (!callbackQueryId) return webhookResponse({ ok: true, ignored: true });

  const chat = callback.message?.chat;
  const chatId = normalizeTelegramDestination(chat?.id);
  if (
    !isPrivateTelegramChat({
      chatId: chat?.id,
      chatType: stringValue(chat?.type),
      senderId: callback.from?.id,
      senderIsBot: callback.from?.is_bot,
    })
  ) {
    await answerTelegramCallbackQuery(callbackQueryId, {
      text: "This action is only available in your private bot chat.",
      showAlert: true,
    });
    return webhookResponse({ ok: true, ignored: true });
  }

  const parsed = parseTelegramMuteCallbackData(callback.data);
  if (!parsed) {
    await answerTelegramCallbackQuery(callbackQueryId, { text: "This action is no longer available." });
    return webhookResponse({ ok: true, ignored: true });
  }

  try {
    const resolution = await resolveTelegramMuteAction({
      destination: chatId,
      token: parsed.token,
      tokenSecret,
      write: parsed.action === "confirm",
    });
    if (!resolution.ok) {
      await answerTelegramCallbackQuery(callbackQueryId, {
        text: callbackErrorMessage(resolution.error),
        showAlert: true,
      });
      return webhookResponse({ ok: true, action: "rejected" });
    }

    if (parsed.action === "prompt") {
      await answerTelegramCallbackQuery(callbackQueryId, { text: `Confirm mute for ${resolution.ticker}.` });
      await sendTelegramMessage(chatId, `Mute ${resolution.ticker} ticker alerts?`, {
        replyMarkup: buildTelegramMuteConfirmationKeyboard(
          resolution.ticker,
          tokenSecret,
          resolution.userId,
        ),
      });
      return webhookResponse({ ok: true, action: "mute_prompted" });
    }

    const messageId = numericValue(callback.message?.message_id);
    if (parsed.action === "cancel") {
      await answerTelegramCallbackQuery(callbackQueryId, { text: "Mute canceled." });
      if (messageId !== null) await editTelegramMessageText(chatId, messageId, `Mute canceled for ${resolution.ticker}.`);
      return webhookResponse({ ok: true, action: "mute_canceled" });
    }

    const confirmation = resolution.alreadyMuted
      ? `${resolution.ticker} ticker alerts are already muted.`
      : `${resolution.ticker} ticker alerts are now muted.`;
    await answerTelegramCallbackQuery(callbackQueryId, { text: confirmation });
    if (messageId !== null) await editTelegramMessageText(chatId, messageId, confirmation);
    return webhookResponse({ ok: true, action: "ticker_muted" });
  } catch {
    await answerTelegramCallbackQuery(callbackQueryId, {
      text: "Unable to process this action. Try again from a newer alert.",
      showAlert: true,
    });
    return webhookResponse({ ok: true, action: "failed" });
  }
}

function callbackErrorMessage(error: "CONNECTION_NOT_FOUND" | "ACTION_INVALID" | "READ_FAILED" | "WRITE_FAILED") {
  if (error === "CONNECTION_NOT_FOUND") return "Connect this private chat to Stock Radar first.";
  if (error === "ACTION_INVALID") return "This action is invalid or no longer available.";
  return "Unable to update Alert settings right now.";
}

function buildSiteKeyboard(text: string, pathname: string): TelegramInlineKeyboardMarkup | undefined {
  const baseUrl = normalizeBaseUrl(getServerEnv().appBaseUrl);
  if (!baseUrl) return undefined;
  return { inline_keyboard: [[{ text, url: new URL(pathname, baseUrl).toString() }]] };
}

function secretsMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function buildTelegramMetadata(message: TelegramMessage) {
  return {
    telegram_user_id: stringValue(message.from?.id),
    username: stringValue(message.from?.username || message.chat?.username) || null,
    first_name: stringValue(message.from?.first_name || message.chat?.first_name) || null,
    last_name: stringValue(message.from?.last_name || message.chat?.last_name) || null,
    language_code: stringValue(message.from?.language_code) || null,
    chat_type: stringValue(message.chat?.type) || null,
  };
}

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeBaseUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}/` : "";
  } catch {
    return "";
  }
}

function numericValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function webhookResponse(body: Record<string, unknown>) {
  return NextResponse.json(body, { headers: NO_STORE_HEADERS });
}
