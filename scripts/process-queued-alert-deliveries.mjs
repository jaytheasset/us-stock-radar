#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveSupabaseSecretKey,
  supabaseServiceHeaders,
} from "./supabase-service-headers.mjs";
import {
  getPlanLimits,
  isDiscoveryCategoryAllowed,
  isTickerAlertCategoryAllowed,
} from "../lib/subscriptionPolicy.ts";
import { buildTelegramAlertPresentation } from "../lib/telegram/telegramAlertMessage.ts";

const PLAN_RANK = {
  free: 0,
  ad_free: 1,
  pro: 2,
  advanced: 3,
  ultimate: 4,
};

const args = parseArgs(process.argv.slice(2));
const write = args.has("write");
const dryRun = !write;
const limit = normalizeLimit(args.get("limit"));
const env = readLocalEnv();
const supabaseUrl = cleanSupabaseUrl(env.SUPABASE_URL || "");
const key = resolveSupabaseSecretKey(env);

if (!supabaseUrl || !key) {
  console.error("Supabase env is missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy fallback).");
  process.exitCode = 1;
} else {
  try {
    const result = await processQueuedDeliveries({ dryRun, write, limit });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          dryRun,
          write,
          scanned: 0,
          processed: 0,
          wouldProcess: 0,
          sent: 0,
          failed: 0,
          suppressed: 0,
          items: [],
          error: sanitizeError(error instanceof Error ? error.message : "Queued delivery processing failed."),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function processQueuedDeliveries({ dryRun, write, limit }) {
  const queuedRows = await fetchDueQueuedRows(limit);
  const items = [];

  for (const row of queuedRows) {
    items.push(await processQueuedRow(row, { dryRun, write }));
  }

  return {
    ok: true,
    dryRun,
    write,
    scanned: queuedRows.length,
    processed: write ? items.length : 0,
    wouldProcess: dryRun ? items.length : 0,
    sent: items.filter((item) => item.action === "sent").length,
    failed: items.filter((item) => item.action === "failed").length,
    suppressed: items.filter((item) => item.action === "suppressed").length,
    items,
  };
}

async function fetchDueQueuedRows(limit) {
  return await fetchRows("user_alert_deliveries", {
    select:
      "id,user_id,alert_event_id,ticker,title,category,source_type,source_label,alert_lane,severity,delivered_channels,scheduled_for,delivery_status,created_at",
    delivery_status: "eq.queued",
    scheduled_for: `lte.${new Date().toISOString()}`,
    order: "scheduled_for.asc,created_at.asc",
    limit: String(limit),
  });
}

async function processQueuedRow(row, { dryRun, write }) {
  const plan = readPlan(await fetchOne("user_plan_subscriptions", { user_id: `eq.${row.user_id}` }));
  const policyError = getQueuedPolicyError(row, plan);
  if (policyError) {
    if (dryRun || !write) {
      return printableItem(row, { action: "suppressed", channels: [], error: policyError });
    }
    const updated = await patchRows(
      "user_alert_deliveries",
      { id: `eq.${row.id}`, delivery_status: "eq.queued" },
      {
        delivery_status: "suppressed",
        delivered_channels: [],
        attempted_at: new Date().toISOString(),
        last_error: policyError,
      },
    );
    if (!updated.ok) return markFailed(row, sanitizeError(updated.error || policyError));
    return printableItem(row, { action: "suppressed", channels: [], error: policyError });
  }

  const channelResult = await processQueuedChannels(row, { dryRun, plan });
  const channels = channelResult.channels;
  const noChannelsMessage = channelResult.errors.join("; ") || "No enabled delivery channels available at processing time.";

  if (dryRun || !write) {
    return printableItem(row, {
      action: channels.length ? "would_send" : "suppressed",
      channels,
      error: channels.length ? channelResult.errors.join("; ") || undefined : noChannelsMessage,
    });
  }

  const attemptedAt = new Date().toISOString();
  if (!channels.length) {
    const updated = await patchRows(
      "user_alert_deliveries",
      { id: `eq.${row.id}` },
      {
        delivery_status: "suppressed",
        attempted_at: attemptedAt,
        last_error: noChannelsMessage,
      },
    );
    if (!updated.ok) {
      return await markFailed(row, sanitizeError(updated.error || "Failed to suppress queued alert delivery."));
    }
    return printableItem(row, { action: "suppressed", channels: [], error: noChannelsMessage });
  }

  const sentAt = new Date().toISOString();
  const updated = await patchRows(
    "user_alert_deliveries",
    { id: `eq.${row.id}` },
    {
      delivery_status: "sent",
      delivered_channels: channels,
      attempted_at: attemptedAt,
      sent_at: sentAt,
      last_error: null,
    },
  );

  if (!updated.ok) {
    return await markFailed(row, sanitizeError(updated.error || "Failed to mark queued alert delivery as sent."));
  }

  return printableItem(row, { action: "sent", channels });
}

async function markFailed(row, error) {
  await patchRows(
    "user_alert_deliveries",
    { id: `eq.${row.id}` },
    {
      delivery_status: "failed",
      attempted_at: new Date().toISOString(),
      last_error: error,
    },
  ).catch(() => null);

  return printableItem(row, { action: "failed", channels: [], error });
}

async function processQueuedChannels(row, { dryRun, plan }) {
  const requested = new Set(readChannels(row.delivered_channels));
  if (!requested.size) return { channels: [], errors: [] };
  const entitledChannels = new Set(getPlanLimits(plan).channels);

  const channelRows = new Map();
  for (const channelRow of await fetchRows("user_delivery_channels", {
    select: "channel,enabled,destination,verified_at",
    user_id: `eq.${row.user_id}`,
    limit: "20",
  })) {
    const channel = readChannel(channelRow.channel);
    if (channel) channelRows.set(channel, channelRow);
  }

  const channels = [];
  const errors = [];

  for (const channel of requested) {
    if (!entitledChannels.has(channel)) {
      errors.push(`${channel}: channel is not available on the current plan.`);
      continue;
    }
    const channelRow = channelRows.get(channel);
    if (channel === "web") {
      if (channelRow?.enabled === true) channels.push("web");
      continue;
    }

    if (channel === "telegram") {
      if (env.ALERT_DELIVERY_SEND_TELEGRAM !== "true") continue;
      const destination = readString(channelRow?.destination);
      if (channelRow?.enabled === true && destination && readString(channelRow.verified_at)) {
        if (dryRun) {
          channels.push("telegram");
          continue;
        }
        const presentation = await buildQueuedTelegramPresentation(row);
        const sent = await sendTelegramMessage(destination, presentation.text, presentation);
        if (sent.ok) channels.push("telegram");
        else errors.push(`telegram: ${sanitizeError(sent.error || "Telegram send failed")}`);
      }
      continue;
    }

    errors.push(`${channel}: delivery adapter is not implemented yet.`);
  }

  return { channels, errors };
}

function getQueuedPolicyError(row, plan) {
  const category = readString(row.category);
  if (readString(row.alert_lane) === "market_discovery") {
    return isDiscoveryCategoryAllowed(plan, category)
      ? ""
      : `${category || "Unknown category"} is not available for ${plan} market-wide Discovery.`;
  }
  return isTickerAlertCategoryAllowed(plan, category)
    ? ""
    : `${category || "Unknown category"} is not a public ticker alert category.`;
}

async function sendTelegramMessage(chatId, text, options = {}) {
  if (env.ALERT_DELIVERY_SEND_TELEGRAM !== "true") {
    return { ok: false, error: "Telegram sending is disabled." };
  }

  const token = env.TELEGRAM_BOT_TOKEN || "";
  if (!token || !chatId) {
    return { ok: false, error: "Telegram is not configured." };
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
        ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
        link_preview_options: { is_disabled: true },
      }),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.ok) return { ok: true };
    return { ok: false, error: readError(data, response.statusText) };
  } catch (error) {
    return { ok: false, error: "Telegram request failed." };
  }
}

function printableItem(row, { action, channels, error }) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ticker: row.ticker || null,
    action,
    channels,
    error,
  };
}

async function fetchRows(table, query) {
  const result = await supabaseRequest("GET", table, query);
  if (!result.ok) throw new Error(`${table} read failed: ${result.error || result.status}`);
  return Array.isArray(result.data) ? result.data : [];
}

async function fetchOne(table, query) {
  const rows = await fetchRows(table, { select: "*", ...query, limit: "1" });
  return rows[0] || null;
}

async function patchRows(table, query, payload) {
  return supabaseRequest("PATCH", table, query, payload);
}

async function supabaseRequest(method, table, query, payload) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: supabaseServiceHeaders(key, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await response.text();
  const data = parseBody(body);
  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok ? undefined : readError(data, response.statusText),
  };
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const body = arg.replace(/^--/, "");
    if (body.includes("=")) {
      const [key, value = ""] = body.split("=");
      parsed.set(key, value || "true");
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed.set(body, next);
      index += 1;
      continue;
    }
    parsed.set(body, "true");
  }
  return parsed;
}

function normalizeLimit(value) {
  const limit = Number(value || 50);
  return Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : 50, 250));
}

async function buildQueuedTelegramPresentation(row) {
  const source = readString(row.alert_event_id)
    ? await fetchOne("events", { id: `eq.${readString(row.alert_event_id)}` })
    : null;
  const ticker = normalizeTicker(source?.ticker || row.ticker);
  const score = readOptionalScore(source?.score);
  const event = source
    ? {
        id: readString(source.id) || readString(row.alert_event_id) || readString(row.id),
        title: readString(source.title) || readString(row.title) || "Untitled alert event",
        quickTake: readString(source.quick_take) || undefined,
        tickers: ticker ? [ticker] : [],
        primaryTicker: ticker || undefined,
        category: readString(source.event_type) || readString(row.category) || "other",
        sourceType: readString(source.source_group) === "filings" ? "filing" : readString(source.source_group) === "news" ? "news" : "other",
        sourceLabel: readString(source.source_name) || readString(source.source_code) || undefined,
        severity: readString(row.severity) || undefined,
        score,
        signal: readSignal(source.signal),
        impact: readImpact(source.impact),
        marketScope: readMarketScope(source.market_scope),
        publishedAt: readString(source.published_at) || readString(source.detected_at) || undefined,
      }
    : {
        id: readString(row.alert_event_id) || readString(row.id),
        title: readString(row.title) || "Untitled alert event",
        tickers: ticker ? [ticker] : [],
        primaryTicker: ticker || undefined,
        category: readString(row.category) || "other",
        sourceType: readString(row.source_type) || "other",
        sourceLabel: readString(row.source_label) || undefined,
        severity: readString(row.severity) || undefined,
        marketScope: "macro",
      };
  return buildTelegramAlertPresentation(event, {
    baseUrl: env.APP_BASE_URL || "",
    callbackSecret: env.TELEGRAM_WEBHOOK_SECRET || "",
    callbackSubject: readString(row.user_id),
  });
}

function readChannels(value) {
  if (!Array.isArray(value)) return [];
  return value.map(readChannel).filter(Boolean);
}

function readChannel(value) {
  const channel = readString(value);
  return ["web", "telegram", "email", "webhook", "api"].includes(channel) ? channel : "";
}

function readPlan(row) {
  const plan = readString(row?.plan);
  const status = readString(row?.status);
  const basePlan = isPlan(plan) ? plan : "free";
  const effectiveBasePlan = status && status !== "active" ? "free" : basePlan;
  const trialPlan = readString(row?.trial_plan);
  const trialStartedAt = readString(row?.trial_started_at);
  const trialEndsTime = Date.parse(readString(row?.trial_ends_at));
  if (
    (trialPlan === "pro" || trialPlan === "advanced") &&
    trialStartedAt &&
    Number.isFinite(trialEndsTime) &&
    trialEndsTime > Date.now() &&
    PLAN_RANK[trialPlan] > PLAN_RANK[effectiveBasePlan]
  ) {
    return trialPlan;
  }
  return effectiveBasePlan;
}

function normalizeTicker(value) {
  const ticker = readString(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function readOptionalScore(value) {
  const number = Number(value);
  return value !== null && value !== "" && Number.isFinite(number)
    ? Math.max(0, Math.min(100, Math.round(number)))
    : undefined;
}

function readSignal(value) {
  const signal = readString(value).toLowerCase();
  return ["bullish", "bearish", "volatile", "neutral"].includes(signal) ? signal : undefined;
}

function readImpact(value) {
  const impact = readString(value).toLowerCase();
  return ["high", "medium", "low"].includes(impact) ? impact : undefined;
}

function readMarketScope(value) {
  const scope = readString(value).toLowerCase();
  return ["company", "sector", "theme", "macro"].includes(scope) ? scope : "company";
}

function isPlan(value) {
  return value === "free" || value === "ad_free" || value === "pro" || value === "advanced" || value === "ultimate";
}

function readString(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function parseBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function readError(data, fallback) {
  if (data && typeof data === "object" && "message" in data) return String(data.message || fallback);
  if (typeof data === "string") return data;
  return fallback;
}

function sanitizeError(value) {
  return String(value || "Unknown error")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .slice(0, 500);
}

function cleanSupabaseUrl(value) {
  return value.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

function readLocalEnv() {
  const candidates = [resolve(process.cwd(), ".env.local"), resolve(process.cwd(), ".env")];
  const parsed = {};
  for (const filepath of candidates) {
    if (!existsSync(filepath)) continue;
    for (const line of readFileSync(filepath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index === -1) continue;
      const keyName = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      parsed[keyName] = value;
    }
  }
  return { ...parsed, ...process.env };
}
