import "server-only";

import { createHash, randomBytes } from "crypto";
import { getServerEnv } from "@/lib/env";
import { supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";

const TOKEN_TTL_MINUTES = 15;

type TokenRow = {
  id?: unknown;
  user_id?: unknown;
  expires_at?: unknown;
  used_at?: unknown;
};

export type TelegramConnectVerification =
  | {
      ok: true;
      tokenId: string;
      userId: string;
    }
  | {
      ok: false;
      reason: "missing" | "invalid" | "expired" | "used";
    };

export async function createTelegramConnectToken(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashTelegramConnectToken(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();

  const result = await supabaseUpsert(
    "telegram_connect_tokens",
    {
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    },
    {
      onConflict: "token_hash",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  if (!result.ok) {
    throw new Error(result.error || "Failed to create Telegram connection token.");
  }

  return {
    token,
    tokenHash,
    expiresAt,
  };
}

export function hashTelegramConnectToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function verifyTelegramConnectToken(rawToken: string): Promise<TelegramConnectVerification> {
  const token = rawToken.trim();
  if (!token) return { ok: false, reason: "missing" };

  const tokenHash = hashTelegramConnectToken(token);
  const result = await supabaseSelect("telegram_connect_tokens", {
    select: "id,user_id,expires_at,used_at",
    token_hash: `eq.${tokenHash}`,
    limit: "1",
  });
  const row = Array.isArray(result.data) ? (result.data[0] as TokenRow | undefined) : undefined;

  if (!row) return { ok: false, reason: "invalid" };

  const tokenId = stringValue(row.id);
  const userId = stringValue(row.user_id);
  const expiresAt = stringValue(row.expires_at);
  const usedAt = stringValue(row.used_at);

  if (!tokenId || !userId || !expiresAt) return { ok: false, reason: "invalid" };
  if (usedAt) return { ok: false, reason: "used" };
  if (new Date(expiresAt).getTime() <= Date.now()) return { ok: false, reason: "expired" };

  return {
    ok: true,
    tokenId,
    userId,
  };
}

export async function markTelegramConnectTokenUsed(tokenId: string) {
  return supabaseUpdate(
    "telegram_connect_tokens",
    {
      id: `eq.${tokenId}`,
      used_at: "is.null",
    },
    {
      used_at: new Date().toISOString(),
    },
  );
}

export function buildTelegramDeepLink(token: string) {
  const username = getTelegramBotUsername();
  return `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(token)}`;
}

export function getTelegramBotUsername() {
  const username = getServerEnv().telegramBotUsername.trim().replace(/^@/, "");
  if (!username) {
    throw new Error("TELEGRAM_BOT_USERNAME is missing.");
  }
  return username;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
