import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { buildChannelNotAvailableMessage, getChannelLockState, getUserPlan } from "@/lib/alerts/alertValidation";
import { getServerEnv } from "@/lib/env";
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
import { sendTelegramMessage } from "@/lib/telegram/sendTelegramMessage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

type TelegramUpdate = {
  message?: TelegramMessage;
};

type TelegramMessage = {
  text?: unknown;
  chat?: {
    id?: unknown;
    type?: unknown;
    username?: unknown;
    first_name?: unknown;
    last_name?: unknown;
  };
  from?: {
    id?: unknown;
    is_bot?: unknown;
    username?: unknown;
    first_name?: unknown;
    last_name?: unknown;
    language_code?: unknown;
  };
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

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const message = update?.message;
  const chatId = normalizeTelegramDestination(message?.chat?.id);
  const chatType = stringValue(message?.chat?.type);
  const text = stringValue(message?.text);
  const token = parseTelegramStartToken(text);

  if (
    !message ||
    !isPrivateTelegramChat({
      chatId: message.chat?.id,
      chatType,
      senderId: message.from?.id,
      senderIsBot: message.from?.is_bot,
    }) ||
    !text.startsWith("/start")
  ) {
    return NextResponse.json({ ok: true, ignored: true }, { headers: NO_STORE_HEADERS });
  }

  if (!token) {
    await sendTelegramMessage(chatId, "Open STOCK RADAR and use Connect Telegram from Alert Center to link this chat.");
    return NextResponse.json({ ok: true, ignored: true }, { headers: NO_STORE_HEADERS });
  }

  const verification = await verifyTelegramConnectToken(token);
  if (!verification.ok) {
    await sendTelegramMessage(chatId, "This connection link is expired. Please generate a new link from STOCK RADAR.");
    return NextResponse.json({ ok: true, linked: false }, { headers: NO_STORE_HEADERS });
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
    return NextResponse.json({ ok: true, linked: false }, { headers: NO_STORE_HEADERS });
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

  return NextResponse.json({ ok: true, linked: true }, { headers: NO_STORE_HEADERS });
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
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value.trim() : "";
}
