import "server-only";

import { randomUUID } from "node:crypto";
import { normalizeAlertEvent } from "@/lib/alerts/delivery/normalizeAlertEvent";
import {
  buildPublicTelegramBroadcastPresentation,
  evaluatePublicTelegramBroadcast,
  normalizePublicTelegramDestination,
} from "@/lib/alerts/delivery/publicTelegramBroadcastPolicy";
import type {
  PublicTelegramBroadcastItemResult,
  PublicTelegramBroadcastResult,
  PublicTelegramBroadcastRow,
  PublicTelegramBroadcastStatus,
} from "@/lib/alerts/delivery/types";
import { getServerEnv } from "@/lib/env";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram/sendTelegramMessage";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

type PublicTelegramBroadcastOptions = {
  dryRun?: boolean;
  limit?: number;
  now?: Date;
  write?: boolean;
};

type ClaimRow = {
  acquired?: unknown;
  attempt_status?: unknown;
};

export async function runPublicTelegramBroadcastDelivery(
  options: PublicTelegramBroadcastOptions = {},
): Promise<PublicTelegramBroadcastResult> {
  const requestedWrite = options.write === true;
  const dryRun = options.dryRun ?? !requestedWrite;
  const write = requestedWrite && !dryRun;
  const now = validDate(options.now) || new Date();
  const rows = await fetchDueBroadcastRows(now, normalizeLimit(options.limit));
  const items: PublicTelegramBroadcastItemResult[] = [];

  for (const row of rows) {
    items.push(await processBroadcastRow(row, { dryRun, now, write }));
  }

  const failed = items.filter((item) => item.action === "failed").length;
  const inProgress = items.filter(
    (item) => item.action === "in_progress",
  ).length;
  return {
    ok: failed === 0 && inProgress === 0,
    dryRun,
    write,
    scanned: rows.length,
    processed: write
      ? items.filter(
          (item) =>
            item.action !== "disabled" && item.action !== "in_progress",
        ).length
      : 0,
    wouldProcess: items.filter((item) => item.action === "would_send").length,
    sent: items.filter((item) => item.action === "sent").length,
    failed,
    suppressed: items.filter((item) => item.action === "suppressed").length,
    disabled: items.filter((item) => item.action === "disabled").length,
    duplicatesPrevented: items.filter(
      (item) => item.duplicatePrevented,
    ).length,
    inProgress,
    items,
    error:
      failed > 0
        ? `${failed} public Telegram broadcast(s) failed and remain retryable.`
        : inProgress > 0
          ? `${inProgress} public Telegram broadcast(s) require reconciliation.`
          : undefined,
  };
}

async function processBroadcastRow(
  row: PublicTelegramBroadcastRow,
  context: { dryRun: boolean; now: Date; write: boolean },
): Promise<PublicTelegramBroadcastItemResult> {
  const normalized = await normalizeAlertEvent(row.event_id);
  if (!normalized.ok) {
    return failClaimedBroadcast(
      row,
      sanitizeError(normalized.error),
      context,
    );
  }

  const eligibility = evaluatePublicTelegramBroadcast(
    normalized.event,
    context.now,
  );
  if (!eligibility.eligible) {
    return suppressClaimedBroadcast(
      row,
      `Public broadcast policy rejected the event: ${eligibility.reason}.`,
      context,
    );
  }
  if (!eligibility.due) {
    return {
      eventId: row.event_id,
      action: "disabled",
      duplicatePrevented: false,
      error: "Public broadcast is not due yet.",
    };
  }

  if (context.dryRun || !context.write) {
    return {
      eventId: row.event_id,
      action: "would_send",
      duplicatePrevented: false,
    };
  }

  const env = getServerEnv();
  const destination = normalizePublicTelegramDestination(
    env.telegramPublicChannelId,
  );
  if (
    !env.alertDeliverySendTelegramPublic ||
    !env.telegramBotToken ||
    !destination
  ) {
    return {
      eventId: row.event_id,
      action: "disabled",
      duplicatePrevented: false,
      error: !env.alertDeliverySendTelegramPublic
        ? "Public Telegram sending is disabled."
        : !env.telegramBotToken
          ? "Telegram bot is not configured."
        : "Public Telegram channel is not configured.",
    };
  }

  const claim = await claimPublicTelegramBroadcast(row.id);
  if (!claim.ok) {
    return {
      eventId: row.event_id,
      action: "failed",
      duplicatePrevented: false,
      error: sanitizeError(
        claim.error || "Failed to claim public Telegram broadcast.",
      ),
    };
  }
  if (!claim.acquired) {
    if (claim.status === "sent") {
      return {
        eventId: row.event_id,
        action: "sent",
        duplicatePrevented: true,
      };
    }
    return {
      eventId: row.event_id,
      action: "in_progress",
      duplicatePrevented:
        claim.status === "attempting" || claim.status === "uncertain",
      error: "An existing public Telegram attempt was not retried.",
    };
  }

  const presentation = buildPublicTelegramBroadcastPresentation(
    normalized.event,
    { baseUrl: env.appBaseUrl },
  );
  const sent = await sendTelegramMessage(destination, presentation.text, {
    parseMode: presentation.parseMode,
    replyMarkup: presentation.replyMarkup,
    disableWebPagePreview: true,
  });
  const status = sent.ok
    ? "sent"
    : sent.outcome === "uncertain"
      ? "uncertain"
      : "failed";
  const error = sent.ok
    ? undefined
    : sanitizeError(sent.error || "Public Telegram send failed.");
  const finished = await finishPublicTelegramBroadcast({
    deliveryId: row.id,
    attemptToken: claim.attemptToken,
    status,
    providerMessageId: sent.providerMessageId,
    error,
  });

  if (!finished.ok) {
    return {
      eventId: row.event_id,
      action: "in_progress",
      duplicatePrevented: true,
      error:
        "Public Telegram provider outcome could not be persisted; automatic retry is blocked.",
    };
  }
  if (sent.ok) {
    return {
      eventId: row.event_id,
      action: "sent",
      duplicatePrevented: false,
    };
  }
  return {
    eventId: row.event_id,
    action: status === "uncertain" ? "in_progress" : "failed",
    duplicatePrevented: status === "uncertain",
    error,
  };
}

async function suppressClaimedBroadcast(
  row: PublicTelegramBroadcastRow,
  error: string,
  context: { dryRun: boolean; write: boolean },
): Promise<PublicTelegramBroadcastItemResult> {
  if (context.dryRun || !context.write) {
    return {
      eventId: row.event_id,
      action: "suppressed",
      duplicatePrevented: false,
      error: sanitizeError(error),
    };
  }
  const claim = await claimPublicTelegramBroadcast(row.id);
  if (!claim.ok || !claim.acquired) {
    return claimFailureResult(row, claim);
  }
  const finished = await finishPublicTelegramBroadcast({
    deliveryId: row.id,
    attemptToken: claim.attemptToken,
    status: "suppressed",
    error: sanitizeError(error),
  });
  return {
    eventId: row.event_id,
    action: finished.ok ? "suppressed" : "in_progress",
    duplicatePrevented: !finished.ok,
    error: finished.ok
      ? sanitizeError(error)
      : "Public broadcast suppression could not be persisted.",
  };
}

async function failClaimedBroadcast(
  row: PublicTelegramBroadcastRow,
  error: string,
  context: { dryRun: boolean; write: boolean },
): Promise<PublicTelegramBroadcastItemResult> {
  if (context.dryRun || !context.write) {
    return {
      eventId: row.event_id,
      action: "failed",
      duplicatePrevented: false,
      error,
    };
  }
  const claim = await claimPublicTelegramBroadcast(row.id);
  if (!claim.ok || !claim.acquired) {
    return claimFailureResult(row, claim);
  }
  const finished = await finishPublicTelegramBroadcast({
    deliveryId: row.id,
    attemptToken: claim.attemptToken,
    status: "failed",
    error,
  });
  return {
    eventId: row.event_id,
    action: finished.ok ? "failed" : "in_progress",
    duplicatePrevented: !finished.ok,
    error: finished.ok
      ? error
      : "Public broadcast failure could not be persisted.",
  };
}

function claimFailureResult(
  row: PublicTelegramBroadcastRow,
  claim: Awaited<ReturnType<typeof claimPublicTelegramBroadcast>>,
): PublicTelegramBroadcastItemResult {
  if (claim.ok && claim.status === "sent") {
    return {
      eventId: row.event_id,
      action: "sent",
      duplicatePrevented: true,
    };
  }
  return {
    eventId: row.event_id,
    action: claim.ok ? "in_progress" : "failed",
    duplicatePrevented:
      claim.ok &&
      (claim.status === "attempting" || claim.status === "uncertain"),
    error: claim.ok
      ? "An existing public Telegram attempt was not retried."
      : sanitizeError(
          claim.error || "Failed to claim public Telegram broadcast.",
        ),
  };
}

async function fetchDueBroadcastRows(now: Date, limit: number) {
  const result = await supabaseSelect(
    "public_telegram_broadcast_deliveries",
    {
      select: "id,event_id,status,scheduled_for,next_retry_at",
      status: "in.(pending,failed)",
      scheduled_for: `lte.${now.toISOString()}`,
      order: "scheduled_for.asc,created_at.asc",
      limit: String(limit),
    },
  );
  if (!result.ok) {
    throw new Error(
      result.error || "Failed to fetch public Telegram broadcast queue.",
    );
  }
  return (Array.isArray(result.data) ? result.data : [])
    .map(readBroadcastRow)
    .filter(
      (row): row is PublicTelegramBroadcastRow =>
        row !== null &&
        (!row.next_retry_at || Date.parse(row.next_retry_at) <= now.getTime()),
    );
}

async function claimPublicTelegramBroadcast(deliveryId: string) {
  const attemptToken = randomUUID();
  const result = await supabaseRpc("claim_public_telegram_broadcast", {
    p_delivery_id: deliveryId,
    p_attempt_token: attemptToken,
  });
  const row = Array.isArray(result.data)
    ? (result.data[0] as ClaimRow | undefined)
    : undefined;
  return {
    ok: result.ok,
    acquired: result.ok && row?.acquired === true,
    attemptToken,
    status: readBroadcastStatus(row?.attempt_status),
    error: result.ok
      ? undefined
      : result.error || "Failed to claim public Telegram broadcast.",
  };
}

async function finishPublicTelegramBroadcast(input: {
  deliveryId: string;
  attemptToken: string;
  status: Extract<
    PublicTelegramBroadcastStatus,
    "sent" | "failed" | "suppressed" | "uncertain"
  >;
  providerMessageId?: string;
  error?: string;
}) {
  const result = await supabaseRpc("finish_public_telegram_broadcast", {
    p_delivery_id: input.deliveryId,
    p_attempt_token: input.attemptToken,
    p_status: input.status,
    p_provider_message_id: input.providerMessageId || null,
    p_last_error: input.error || null,
  });
  return {
    ok: result.ok && result.data === true,
    error:
      result.ok && result.data === true
        ? undefined
        : result.error || "Failed to finish public Telegram broadcast.",
  };
}

function readBroadcastRow(value: unknown): PublicTelegramBroadcastRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = readString(row.id);
  const eventId = readString(row.event_id);
  const status = readBroadcastStatus(row.status);
  const scheduledFor = readString(row.scheduled_for);
  if (!id || !eventId || !status || !scheduledFor) return null;
  return {
    id,
    event_id: eventId,
    status,
    scheduled_for: scheduledFor,
    next_retry_at: readString(row.next_retry_at) || null,
  };
}

function readBroadcastStatus(
  value: unknown,
): PublicTelegramBroadcastStatus | null {
  return value === "pending" ||
    value === "attempting" ||
    value === "sent" ||
    value === "failed" ||
    value === "suppressed" ||
    value === "uncertain"
    ? value
    : null;
}

function normalizeLimit(value: unknown) {
  const limit =
    typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
}

function validDate(value: Date | undefined) {
  return value && Number.isFinite(value.getTime()) ? value : null;
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function sanitizeError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .replace(/-100\d{6,16}/g, "[REDACTED_CHANNEL]")
    .replace(/@[A-Za-z][A-Za-z0-9_]{4,31}/g, "[REDACTED_CHANNEL]")
    .slice(0, 500);
}
