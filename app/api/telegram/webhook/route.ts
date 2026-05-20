import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { supabaseUpsert } from "@/lib/supabase";
import { markTelegramConnectTokenUsed, verifyTelegramConnectToken } from "@/lib/telegram/telegramConnect";
import { sendTelegramMessage } from "@/lib/telegram/sendTelegramMessage";

export const dynamic = "force-dynamic";

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

  if (headerSecret !== secret) {
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE_HEADERS });
  }

  const update = (await request.json().catch(() => null)) as TelegramUpdate | null;
  const message = update?.message;
  const chatId = stringValue(message?.chat?.id);
  const chatType = stringValue(message?.chat?.type);
  const text = stringValue(message?.text);
  const token = parseStartToken(text);

  if (!message || chatType !== "private" || !chatId || !text.startsWith("/start")) {
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

  const result = await supabaseUpsert(
    "user_delivery_channels",
    {
      user_id: verification.userId,
      channel: "telegram",
      enabled: true,
      destination: chatId,
      metadata: buildTelegramMetadata(message),
      verified_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,channel",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_CHANNEL_SAVE_FAILED" },
      { status: result.status || 502, headers: NO_STORE_HEADERS },
    );
  }

  await markTelegramConnectTokenUsed(verification.tokenId);
  await sendTelegramMessage(chatId, "Telegram alerts are connected. You can manage delivery channels in STOCK RADAR.");

  return NextResponse.json({ ok: true, linked: true }, { headers: NO_STORE_HEADERS });
}

function parseStartToken(text: string) {
  const match = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,80})/);
  return match?.[1] || "";
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
