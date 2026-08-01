import "server-only";

import { createHash, randomBytes } from "crypto";
import { getServerEnv } from "@/lib/env";
import { supabaseDelete, supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";
import {
  classifyTelegramConnectToken,
  isTelegramDestinationUniqueConflict,
  normalizeTelegramDestination,
  TELEGRAM_DESTINATION_CONFLICT_CODE,
  TELEGRAM_DESTINATION_CONFLICT_MESSAGE,
} from "@/lib/telegram/telegramConnectPolicy";

const TOKEN_TTL_MINUTES = 15;

type TokenRow = {
  id?: unknown;
  user_id?: unknown;
  expires_at?: unknown;
  used_at?: unknown;
};

type DeliveryChannelOwnerRow = {
  user_id?: unknown;
  enabled?: unknown;
};

export type TelegramConnectionResult =
  | { ok: true }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
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
  const revokeResult = await supabaseUpdate(
    "telegram_connect_tokens",
    {
      user_id: `eq.${userId}`,
      used_at: "is.null",
    },
    {
      used_at: new Date().toISOString(),
    },
  );
  if (!revokeResult.ok) {
    throw new Error("Failed to revoke the previous Telegram connection link.");
  }

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

  if (!tokenId || !userId || !expiresAt) return { ok: false, reason: "invalid" };
  const tokenState = classifyTelegramConnectToken({
    expiresAt,
    usedAt: row.used_at,
  });
  if (tokenState !== "valid") return { ok: false, reason: tokenState };

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

export function wasTelegramConnectTokenClaimed(result: Awaited<ReturnType<typeof markTelegramConnectTokenUsed>>) {
  return result.ok && Array.isArray(result.data) && result.data.length === 1;
}

export async function saveTelegramConnection(input: {
  userId: string;
  destination: string;
  metadata: Record<string, unknown>;
}): Promise<TelegramConnectionResult> {
  const destination = normalizeTelegramDestination(input.destination);
  if (!destination) {
    return {
      ok: false,
      status: 400,
      error: "TELEGRAM_DESTINATION_INVALID",
      message: "Telegram private chat information is invalid.",
    };
  }

  const ownerResult = await supabaseSelect("user_delivery_channels", {
    select: "user_id",
    channel: "eq.telegram",
    destination: `eq.${destination}`,
    limit: "1",
  });
  if (!ownerResult.ok) {
    return {
      ok: false,
      status: ownerResult.status || 502,
      error: "TELEGRAM_DESTINATION_CHECK_FAILED",
      message: "Failed to verify Telegram account ownership.",
    };
  }

  const ownerRow = Array.isArray(ownerResult.data)
    ? (ownerResult.data[0] as DeliveryChannelOwnerRow | undefined)
    : undefined;
  const ownerId = stringValue(ownerRow?.user_id);
  if (ownerId && ownerId !== input.userId) return telegramDestinationConflict();

  const currentResult = await supabaseSelect("user_delivery_channels", {
    select: "enabled",
    user_id: `eq.${input.userId}`,
    channel: "eq.telegram",
    limit: "1",
  });
  if (!currentResult.ok) {
    return {
      ok: false,
      status: currentResult.status || 502,
      error: "TELEGRAM_CHANNEL_STATE_CHECK_FAILED",
      message: "Failed to verify the current Telegram connection.",
    };
  }
  const currentRow = Array.isArray(currentResult.data)
    ? (currentResult.data[0] as DeliveryChannelOwnerRow | undefined)
    : undefined;

  const saveResult = await supabaseUpsert(
    "user_delivery_channels",
    {
      user_id: input.userId,
      channel: "telegram",
      enabled: currentRow ? currentRow.enabled === true : true,
      destination,
      metadata: input.metadata,
      verified_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,channel",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  if (!saveResult.ok) {
    if (isTelegramDestinationUniqueConflict(saveResult)) return telegramDestinationConflict();
    return {
      ok: false,
      status: saveResult.status || 502,
      error: "TELEGRAM_CHANNEL_SAVE_FAILED",
      message: "Failed to save Telegram connection.",
    };
  }

  return { ok: true };
}

export async function disconnectTelegramForUser(userId: string) {
  const tokensResult = await supabaseDelete("telegram_connect_tokens", {
    user_id: `eq.${userId}`,
    used_at: "is.null",
  });
  if (!tokensResult.ok) return tokensResult;

  return supabaseDelete("user_delivery_channels", {
    user_id: `eq.${userId}`,
    channel: "eq.telegram",
  });
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

function telegramDestinationConflict(): TelegramConnectionResult {
  return {
    ok: false,
    status: 409,
    error: TELEGRAM_DESTINATION_CONFLICT_CODE,
    message: TELEGRAM_DESTINATION_CONFLICT_MESSAGE,
  };
}
