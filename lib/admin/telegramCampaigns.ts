import "server-only";

import { randomUUID } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import {
  isAdminTelegramCampaignStatus,
  isAdminTelegramNoticeType,
  normalizeAdminTelegramCampaignContent,
  type AdminTelegramCampaignContent,
  type AdminTelegramCampaignStatus,
  type AdminTelegramNoticeType,
} from "./telegramCampaignPolicy";

type Row = Record<string, unknown>;

export type AdminTelegramCampaign = AdminTelegramCampaignContent & {
  id: string;
  status: AdminTelegramCampaignStatus;
  scheduledFor: string | null;
  createdBy: string | null;
  createdByLabel: string | null;
  updatedBy: string | null;
  updatedByLabel: string | null;
  sentBy: string | null;
  sentByLabel: string | null;
  canceledBy: string | null;
  canceledByLabel: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  canceledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  providerMessageId: string | null;
  deliveryOutcome: "none" | "sent" | "not_sent" | "uncertain";
  retryAllowed: boolean;
  lastError: string | null;
  attemptCount: number;
  attemptTrigger: "admin" | "scheduler" | "local_mock" | null;
  version: number;
};

export async function listAdminTelegramCampaigns(input: {
  status?: unknown;
  query?: unknown;
  limit?: number;
} = {}): Promise<AdminTelegramCampaign[]> {
  const status = readString(input.status);
  const query = safeSearch(input.query);
  if (status && !isAdminTelegramCampaignStatus(status)) return [];
  const result = await supabaseSelect("admin_telegram_campaigns", {
    select: CAMPAIGN_SELECT,
    ...(status ? { status: `eq.${status}` } : {}),
    ...(query
      ? {
          or: `(title.ilike.*${query}*,body.ilike.*${query}*,ticker.ilike.*${query}*,source_label.ilike.*${query}*)`,
        }
      : {}),
    order: "created_at.desc,id.desc",
    limit: String(Math.max(1, Math.min(input.limit || 100, 250))),
  });
  if (!result.ok) return [];
  return enrichCampaignActors(readRows(result.data).map(readCampaign));
}

export async function getAdminTelegramCampaign(id: string) {
  if (!isUuid(id)) return null;
  const result = await supabaseSelect("admin_telegram_campaigns", {
    select: CAMPAIGN_SELECT,
    id: `eq.${id}`,
    limit: "1",
  });
  if (!result.ok) return null;
  const row = readRows(result.data)[0];
  if (!row) return null;
  const [campaign] = await enrichCampaignActors([readCampaign(row)]);
  return campaign || null;
}

export async function saveAdminTelegramCampaign(input: {
  actorUserId: string;
  baseUrl?: string;
  campaignId?: unknown;
  content: unknown;
  reason: unknown;
  requestId?: string;
  expectedVersion?: unknown;
}) {
  const content = normalizeAdminTelegramCampaignContent(input.content, {
    baseUrl: safeBaseUrl(input.baseUrl) || safeBaseUrl(getServerEnv().appBaseUrl),
  });
  const result = await supabaseRpc("admin_save_telegram_campaign", {
    p_actor_user_id: input.actorUserId,
    p_campaign_id: optionalUuid(input.campaignId),
    p_notice_type: content.noticeType,
    p_title: content.title,
    p_body: content.body,
    p_ticker: content.ticker,
    p_source_label: content.sourceLabel,
    p_source_url: content.sourceUrl,
    p_analysis_url: content.analysisUrl,
    p_live_room_url: content.liveRoomUrl,
    p_reason: readString(input.reason),
    p_request_id: cleanRequestId(input.requestId),
    p_expected_version: optionalPositiveInt(input.expectedVersion),
  });
  if (!result.ok) {
    throw new Error(result.error || "ADMIN_TELEGRAM_CAMPAIGN_SAVE_FAILED");
  }
  const id = readString(result.data);
  if (!isUuid(id)) throw new Error("ADMIN_TELEGRAM_CAMPAIGN_SAVE_FAILED");
  return getAdminTelegramCampaign(id);
}

export async function scheduleAdminTelegramCampaign(input: {
  actorUserId: string;
  campaignId: unknown;
  scheduledForUtc: unknown;
  reason: unknown;
  requestId?: string;
  expectedVersion?: unknown;
}) {
  const campaignId = requireUuid(input.campaignId);
  const scheduledFor = requireFutureIso(input.scheduledForUtc);
  const result = await supabaseRpc("admin_schedule_telegram_campaign", {
    p_actor_user_id: input.actorUserId,
    p_campaign_id: campaignId,
    p_scheduled_for: scheduledFor,
    p_reason: readString(input.reason),
    p_request_id: cleanRequestId(input.requestId),
    p_expected_version: optionalPositiveInt(input.expectedVersion),
  });
  if (!result.ok || result.data !== true) {
    throw new Error(result.error || "ADMIN_TELEGRAM_CAMPAIGN_SCHEDULE_FAILED");
  }
  return getAdminTelegramCampaign(campaignId);
}

export async function cancelAdminTelegramCampaign(input: {
  actorUserId: string;
  campaignId: unknown;
  reason: unknown;
  requestId?: string;
  expectedVersion?: unknown;
}) {
  const campaignId = requireUuid(input.campaignId);
  const result = await supabaseRpc("admin_cancel_telegram_campaign", {
    p_actor_user_id: input.actorUserId,
    p_campaign_id: campaignId,
    p_reason: readString(input.reason),
    p_request_id: cleanRequestId(input.requestId),
    p_expected_version: optionalPositiveInt(input.expectedVersion),
  });
  if (!result.ok || result.data !== true) {
    throw new Error(result.error || "ADMIN_TELEGRAM_CAMPAIGN_CANCEL_FAILED");
  }
  return getAdminTelegramCampaign(campaignId);
}

export async function claimAdminTelegramCampaign(input: {
  actorUserId: string;
  campaignId: unknown;
  reason: unknown;
  requestId?: string;
  expectedVersion?: unknown;
}) {
  const attemptToken = randomUUID();
  const result = await supabaseRpc("admin_claim_telegram_campaign", {
    p_actor_user_id: input.actorUserId,
    p_campaign_id: requireUuid(input.campaignId),
    p_attempt_token: attemptToken,
    p_reason: readString(input.reason),
    p_request_id: cleanRequestId(input.requestId),
    p_expected_version: optionalPositiveInt(input.expectedVersion),
  });
  if (!result.ok) {
    throw new Error(result.error || "ADMIN_TELEGRAM_CAMPAIGN_CLAIM_FAILED");
  }
  const row = readRows(result.data)[0];
  if (!row) throw new Error("ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT");
  return { attemptToken, campaign: readCampaign(row) };
}

export async function claimDueAdminTelegramCampaign(input: {
  trigger: "scheduler" | "local_mock";
  actorUserId?: string;
  reason?: unknown;
  requestId?: string;
}) {
  const attemptToken = randomUUID();
  const result = await supabaseRpc("claim_due_admin_telegram_campaign", {
    p_attempt_token: attemptToken,
    p_trigger: input.trigger,
    p_actor_user_id:
      input.trigger === "local_mock" ? optionalUuid(input.actorUserId) : null,
    p_reason: input.trigger === "local_mock" ? readString(input.reason) : null,
    p_request_id:
      input.trigger === "local_mock" ? cleanRequestId(input.requestId) : null,
  });
  if (!result.ok) {
    throw new Error(result.error || "ADMIN_TELEGRAM_CAMPAIGN_CLAIM_FAILED");
  }
  const row = readRows(result.data)[0];
  return row ? { attemptToken, campaign: readCampaign(row) } : null;
}

export async function finishAdminTelegramCampaign(input: {
  campaignId: string;
  attemptToken: string;
  outcome: "sent" | "not_sent" | "uncertain";
  providerMessageId?: string;
  error?: string;
}) {
  const result = await supabaseRpc("finish_admin_telegram_campaign", {
    p_campaign_id: input.campaignId,
    p_attempt_token: input.attemptToken,
    p_outcome: input.outcome,
    p_provider_message_id: readString(input.providerMessageId) || null,
    p_last_error: sanitizeProviderError(input.error) || null,
  });
  return {
    ok: result.ok && result.data === true,
    error:
      result.ok && result.data === true
        ? undefined
        : result.error || "ADMIN_TELEGRAM_CAMPAIGN_FINISH_FAILED",
  };
}

export async function claimAdminTelegramAiDraft(input: {
  actorUserId: string;
  reason: unknown;
  requestId?: string;
}) {
  const result = await supabaseRpc("admin_claim_telegram_ai_draft", {
    p_actor_user_id: input.actorUserId,
    p_reason: readString(input.reason),
    p_request_id: cleanRequestId(input.requestId),
  });
  if (!result.ok) {
    throw new Error(result.error || "ADMIN_TELEGRAM_AI_CLAIM_FAILED");
  }
  const id = readString(result.data);
  if (!isUuid(id)) throw new Error("ADMIN_TELEGRAM_AI_CLAIM_FAILED");
  return id;
}

export async function finishAdminTelegramAiDraft(input: {
  actorUserId: string;
  requestAuditId: string;
  status: "succeeded" | "failed";
  model: string;
  responseId?: string;
  errorCode?: string;
}) {
  const result = await supabaseRpc("admin_finish_telegram_ai_draft", {
    p_actor_user_id: input.actorUserId,
    p_request_audit_id: input.requestAuditId,
    p_status: input.status,
    p_model: input.model,
    p_response_id: readString(input.responseId) || null,
    p_error_code: readString(input.errorCode) || null,
  });
  return result.ok && isUuid(readString(result.data));
}

const CAMPAIGN_SELECT = [
  "id",
  "status",
  "notice_type",
  "title",
  "body",
  "ticker",
  "source_label",
  "source_url",
  "analysis_url",
  "live_room_url",
  "scheduled_for",
  "created_by",
  "updated_by",
  "sent_by",
  "canceled_by",
  "created_at",
  "updated_at",
  "sent_at",
  "canceled_at",
  "started_at",
  "completed_at",
  "provider_message_id",
  "delivery_outcome",
  "retry_allowed",
  "last_error",
  "attempt_count",
  "attempt_trigger",
  "version",
].join(",");

async function enrichCampaignActors(campaigns: AdminTelegramCampaign[]) {
  const ids = [
    ...new Set(
      campaigns
        .flatMap((campaign) => [
          campaign.createdBy,
          campaign.updatedBy,
          campaign.sentBy,
          campaign.canceledBy,
        ])
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (!ids.length) return campaigns;
  const [profiles, accounts] = await Promise.all([
    supabaseSelect("live_room_member_profiles", {
      select: "user_id,display_name",
      user_id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    }),
    supabaseSelect("user_profiles", {
      select: "id,email",
      id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    }),
  ]);
  const profileMap = mapRows(profiles.data, "user_id");
  const accountMap = mapRows(accounts.data, "id");
  const label = (id: string | null) => {
    if (!id) return null;
    return (
      readString(profileMap.get(id)?.display_name) ||
      readString(accountMap.get(id)?.email) ||
      id
    );
  };
  return campaigns.map((campaign) => ({
    ...campaign,
    createdByLabel: label(campaign.createdBy),
    updatedByLabel: label(campaign.updatedBy),
    sentByLabel: label(campaign.sentBy),
    canceledByLabel: label(campaign.canceledBy),
  }));
}

function readCampaign(row: Row): AdminTelegramCampaign {
  const status = readString(row.status);
  const noticeType = readString(row.notice_type);
  return {
    id: readString(row.id),
    status: isAdminTelegramCampaignStatus(status) ? status : "draft",
    noticeType: isAdminTelegramNoticeType(noticeType) ? noticeType : null,
    title: readNullableString(row.title),
    body: readNullableString(row.body),
    ticker: readNullableString(row.ticker),
    sourceLabel: readNullableString(row.source_label),
    sourceUrl: readNullableString(row.source_url),
    analysisUrl: readNullableString(row.analysis_url),
    liveRoomUrl: readNullableString(row.live_room_url),
    scheduledFor: readNullableString(row.scheduled_for),
    createdBy: readNullableString(row.created_by),
    createdByLabel: null,
    updatedBy: readNullableString(row.updated_by),
    updatedByLabel: null,
    sentBy: readNullableString(row.sent_by),
    sentByLabel: null,
    canceledBy: readNullableString(row.canceled_by),
    canceledByLabel: null,
    createdAt: readString(row.created_at),
    updatedAt: readString(row.updated_at),
    sentAt: readNullableString(row.sent_at),
    canceledAt: readNullableString(row.canceled_at),
    startedAt: readNullableString(row.started_at),
    completedAt: readNullableString(row.completed_at),
    providerMessageId: readNullableString(row.provider_message_id),
    deliveryOutcome: readDeliveryOutcome(row.delivery_outcome),
    retryAllowed: row.retry_allowed === true,
    lastError: readNullableString(row.last_error),
    attemptCount: readNonNegativeInt(row.attempt_count),
    attemptTrigger: readAttemptTrigger(row.attempt_trigger),
    version: Math.max(1, readNonNegativeInt(row.version)),
  };
}

function readDeliveryOutcome(value: unknown) {
  return value === "sent" || value === "not_sent" || value === "uncertain"
    ? value
    : "none";
}

function readAttemptTrigger(value: unknown) {
  return value === "admin" || value === "scheduler" || value === "local_mock"
    ? value
    : null;
}

function requireUuid(value: unknown) {
  const id = readString(value);
  if (!isUuid(id)) throw new Error("ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND");
  return id;
}

function optionalUuid(value: unknown) {
  const id = readString(value);
  return id ? requireUuid(id) : null;
}

function requireFutureIso(value: unknown) {
  const text = readString(value);
  const time = Date.parse(text);
  if (!Number.isFinite(time) || time <= Date.now() + 30_000) {
    throw new Error("ADMIN_TELEGRAM_SCHEDULE_INVALID");
  }
  return new Date(time).toISOString();
}

function optionalPositiveInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function cleanRequestId(value: unknown) {
  return readString(value).slice(0, 240) || randomUUID();
}

function safeSearch(value: unknown) {
  return readString(value).replace(/[,*()]/g, " ").trim().slice(0, 100);
}

function sanitizeProviderError(value: unknown) {
  return readString(value)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .replace(/-100\d{6,16}/g, "[REDACTED_CHANNEL]")
    .replace(/@[A-Za-z][A-Za-z0-9_]{4,31}/g, "[REDACTED_CHANNEL]")
    .slice(0, 500);
}

function safeBaseUrl(value: unknown) {
  const raw = readString(value);
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? `${url.origin}/`
      : "";
  } catch {
    return "";
  }
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Row =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function mapRows(value: unknown, key: string) {
  return new Map(
    readRows(value).map((row) => [readString(row[key]), row] as const),
  );
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNullableString(value: unknown) {
  const text = readString(value);
  return text || null;
}

function readNonNegativeInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
