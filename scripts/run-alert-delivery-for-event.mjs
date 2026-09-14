#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSupabaseSecretKey, supabaseServiceHeaders } from "./supabase-service-headers.mjs";
import {
  getPlanLimits,
  isDiscoveryCategoryAllowed,
  isTickerAlertCategoryAllowed,
  isValidAlertCategory,
} from "../lib/subscriptionPolicy.ts";
import { loadAlertDeliveryRuntime } from "./alert-delivery-runtime.mjs";
import { buildDeliveryDedupeKey } from "../lib/alerts/delivery/eventDeliveryDedupe.ts";
import { readStoredEventMarketCap } from "../lib/marketCapBands.ts";
import {
  allAlertMarketCapFilterIds,
  matchesAlertMarketCapFilters,
} from "../lib/alerts/marketCapFilter.ts";

const PLAN_RANK = {
  free: 0,
  ad_free: 1,
  pro: 2,
  advanced: 3,
  ultimate: 4,
};

const args = parseArgs(process.argv.slice(2));
const eventId = String(args.get("event-id") || args.get("eventId") || "").trim();
const write = args.has("write");
const dryRun = !write;
const env = readLocalEnv();
const supabaseUrl = cleanSupabaseUrl(env.SUPABASE_URL || "");
const key = resolveSupabaseSecretKey(env);
let runtime;

if (!eventId) {
  console.error("Usage: npm run deliver:event -- --event-id <event-id> [--write]");
  process.exitCode = 1;
} else if (!supabaseUrl || !key) {
  console.error("Supabase env is missing. Check SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy fallback).");
  process.exitCode = 1;
} else {
  let result;
  try {
    runtime = await loadAlertDeliveryRuntime(env);
    result = await runDelivery(eventId, { dryRun, write });
  } catch (error) {
    result = {
      ok: false,
      event: null,
      candidates: [],
      skipped: [],
      writes: [],
      stats: { candidateCount: 0, skippedCount: 0, writtenCount: 0, duplicateCount: 0 },
      error: error instanceof Error ? error.message : "Delivery run failed",
    };
  }

  console.log(JSON.stringify(toPrintableResult(result), null, 2));

  process.exitCode = result.ok ? 0 : 1;
}

async function runDelivery(id, options) {
  const normalized = await normalizeEvent(id);
  if (!normalized.ok) {
    return {
      ok: false,
      event: null,
      candidates: [],
      skipped: [],
      writes: [],
      stats: { candidateCount: 0, skippedCount: 0, writtenCount: 0, duplicateCount: 0 },
      error: normalized.error,
    };
  }

  if (normalized.event.deliveryLevel !== "alert") {
    return {
      ok: true,
      event: normalized.event,
      candidates: [],
      skipped: [
        {
          reason: "EVENT_NOT_ALERT_DELIVERY_LEVEL",
          detail: `delivery_level=${normalized.event.deliveryLevel || "unknown"}`,
        },
      ],
      writes: [],
      stats: { candidateCount: 0, skippedCount: 1, writtenCount: 0, duplicateCount: 0 },
    };
  }

  const evaluation = await evaluate(normalized.event);
  const writes = [];

  if (options.write && !options.dryRun) {
    for (const candidate of evaluation.candidates) {
      const inserted = await insertDelivery({ userId: candidate.userId, event: normalized.event, candidate });
      writes.push(inserted);
      if (inserted.ok && !inserted.skipped && inserted.row?.id && candidate.deliveryStatus === "sent") {
        inserted.processing = await runtime.processQueuedDeliveryById(inserted.row.id, options);
      }
    }
  }

  return {
    ok: writes.every((item) => item.ok && !["failed", "in_progress"].includes(item.processing?.action)),
    event: normalized.event,
    candidates: evaluation.candidates,
    skipped: evaluation.skipped,
    writes,
    stats: {
      candidateCount: evaluation.candidates.length,
      skippedCount: evaluation.skipped.length,
      writtenCount: writes.filter((writeResult) => writeResult.ok && !writeResult.skipped).length,
      duplicateCount: writes.filter((writeResult) => writeResult.reason === "DUPLICATE_DELIVERY").length,
    },
  };
}

async function normalizeEvent(id) {
  const event = await fetchOne("events", { id: `eq.${id}` });
  if (!event) return { ok: false, error: `Event not found: ${id}` };
  const identity = await runtime.readSecForm25EventIdentity(event);
  if (identity.status === "blocked") return { ok: false, error: `FORM25_IDENTITY_BLOCKED: ${identity.reason}` };

  const tickerRows = await fetchRows("event_tickers", {
    event_id: `eq.${id}`,
    order: "sort_order.asc",
    limit: "50",
  });
  const tickers = identity.status === "available" ? [identity.ticker]
    : uniqueTickers([...tickerRows.map((row) => row.symbol), event.ticker]);
  const primaryTicker =
    identity.ticker ||
    uniqueTickers(tickerRows.filter((row) => row.role === "primary").map((row) => row.symbol))[0] ||
    normalizeTicker(event.ticker) ||
    tickers[0];
  const score = readOptionalScore(event.score);
  const impact = readString(event.impact);
  const deliveryLevel = readDeliveryLevel(event.delivery_level);
  const eventType = readString(event.event_type);
  const category = isValidAlertCategory(eventType) ? eventType : "other";
  const sourceGroup = readString(event.source_group);
  const metadata = readRecord(event.metadata);

  return {
    ok: true,
    event: {
      id,
      title: readString(event.title) || "Untitled alert event",
      quickTake: readString(event.quick_take) || undefined,
      tickers,
      primaryTicker,
      category,
      sourceType: sourceGroup === "filings" ? "filing" : sourceGroup === "news" ? "news" : "other",
      sourceLabel: readString(event.source_name) || readString(event.source_code) || null,
      severity: (score ?? 0) >= 90 ? "critical" : (score ?? 0) >= 75 || impact === "high" ? "high" : (score ?? 0) >= 50 ? "medium" : "low",
      score,
      signal: readSignal(event.signal),
      impact: readImpact(event.impact),
      marketScope: readMarketScope(event.market_scope),
      deliveryLevel,
      publishedAt: readString(event.published_at) || readString(event.detected_at) || null,
      marketCap: readStoredEventMarketCap(metadata),
      metadata: { source_code: readString(event.source_code), cik: readString(metadata.cik),
        accession_number: readString(metadata.accession_number), raw_item_id: readString(event.raw_item_id),
        source_url: readString(event.source_url), primary_document_url: readString(metadata.primary_document_url) },
    },
  };
}

async function evaluate(event) {
  if (!event.tickers.length) {
    return {
      candidates: [],
      skipped: [{ reason: "EVENT_HAS_NO_TICKERS", detail: "Watchlist and Discovery delivery require ticker linkage." }],
    };
  }

  const users = (await fetchRows("user_profiles", { select: "id", limit: "500" })).map((row) => readString(row.id)).filter(Boolean);
  const candidates = [];
  const skipped = [];
  const now = new Date();
  const matchTickers = runtime.createAlertTickerMatcher();

  for (const userId of users) {
    const context = await fetchUserContext(userId);
    const match = await matchTickers(event, context.alertSubscriptions);
    const { matchedTickers } = match;
    const eligibleChannels = resolveEligibleChannels(context.plan, context.channels);

    if (!eligibleChannels.length) {
      skipped.push({ userId, reason: "NO_ENABLED_CHANNELS" });
      continue;
    }

    if (!matchesAlertMarketCapFilters(event.marketCap, context.preferences.marketCapFilters)) {
      skipped.push({ userId, reason: "MARKET_CAP_FILTERED" });
      continue;
    }

    if (matchedTickers.length) {
      if (!isTickerAlertCategoryAllowed(context.plan, event.category)) {
        skipped.push({ userId, reason: "TICKER_ALERT_CATEGORY_NOT_ACTIVE", detail: event.category });
        continue;
      }
      const reason = getWatchlistSkipReason(event, context.preferences);
      if (reason) {
        skipped.push({ userId, reason });
        continue;
      }
      candidates.push({ ...buildCandidate({ userId, plan: context.plan, alertLane: "watchlist", matchedTickers, eligibleChannels, now }), tickerMatch: match.provenance });
      continue;
    }

    if (!context.preferences.discoveryEnabled) {
      skipped.push({ userId, reason: "DISCOVERY_DISABLED" });
      continue;
    }

    if (!isDiscoveryCategoryAllowed(context.plan, event.category)) {
      skipped.push({
        userId,
        reason: "DISCOVERY_CATEGORY_NOT_ACTIVE",
        detail: `${event.category} is not available for ${context.plan} market-wide Discovery.`,
      });
      continue;
    }

    if (!context.discoveryCategories.has(event.category)) {
      skipped.push({ userId, reason: "DISCOVERY_CATEGORY_NOT_ACTIVE", detail: event.category });
      continue;
    }

    candidates.push(buildCandidate({ userId, plan: context.plan, alertLane: "market_discovery", matchedTickers: event.tickers, eligibleChannels, now }));
  }

  return { candidates, skipped };
}

async function fetchUserContext(userId) {
  const [planRow, preferencesRow, watchlistRows, categoryRows, channelRows] = await Promise.all([
    fetchOne("user_plan_subscriptions", { user_id: `eq.${userId}` }),
    fetchOne("alert_preferences", { user_id: `eq.${userId}` }),
    fetchRows("user_alert_tickers", { select: "id,ticker", user_id: `eq.${userId}`, enabled: "eq.true", limit: "1000" }),
    fetchRows("user_discovery_categories", { select: "category", user_id: `eq.${userId}`, enabled: "eq.true", limit: "100" }),
    fetchRows("user_delivery_channels", { select: "channel,enabled,destination,verified_at", user_id: `eq.${userId}`, limit: "20" }),
  ]);

  return {
    plan: readPlan(planRow),
    preferences: {
      watchlistNewsEnabled: readBoolean(preferencesRow?.watchlist_news_enabled, true),
      watchlistFilingsEnabled: readBoolean(preferencesRow?.watchlist_filings_enabled, true),
      watchlistCalendarEnabled: readBoolean(preferencesRow?.watchlist_calendar_enabled, true),
      discoveryEnabled: readBoolean(preferencesRow?.discovery_enabled, true),
      marketCapFilters: readStringArray(preferencesRow?.market_cap_filters, allAlertMarketCapFilterIds),
    },
    alertSubscriptions: watchlistRows.map((row) => ({ id: readString(row.id), ticker: normalizeTicker(row.ticker) })).filter((row) => row.ticker),
    discoveryCategories: new Set(categoryRows.map((row) => readString(row.category)).filter(Boolean)),
    channels: channelRows,
  };
}

function buildCandidate({ userId, plan, alertLane, matchedTickers, eligibleChannels, now }) {
  const delayMinutes = getPlanLimits(plan).alertDelayMinutes;
  return {
    userId,
    plan,
    alertLane,
    matchedTickers,
    eligibleChannels,
    delayMinutes,
    scheduledFor: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
    deliveryStatus: delayMinutes > 0 ? "queued" : "sent",
  };
}

function getWatchlistSkipReason(event, preferences) {
  if (event.sourceType === "news" && !preferences.watchlistNewsEnabled) return "WATCHLIST_NEWS_DISABLED";
  if (event.sourceType === "filing" && !preferences.watchlistFilingsEnabled) return "WATCHLIST_FILINGS_DISABLED";
  if (event.sourceType === "calendar" && !preferences.watchlistCalendarEnabled) return "WATCHLIST_CALENDAR_DISABLED";
  return "";
}

function readStringArray(value, fallback) {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [...fallback];
}

function resolveEligibleChannels(plan, rows) {
  const available = new Set(getPlanLimits(plan).channels);
  return rows
    .filter((row) => row.enabled === true)
    .map((row) => ({
      channel: readString(row.channel),
      destination: readString(row.destination) || undefined,
      connected: readString(row.channel) === "web" || Boolean(readString(row.destination) && readString(row.verified_at)),
    }))
    .filter((row) => available.has(row.channel) && row.connected);
}

async function insertDelivery({ userId, event, candidate }) {
  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    alert_event_id: event.id,
    ticker: event.primaryTicker || event.tickers[0] || null,
    title: event.title,
    category: event.category,
    source_type: event.sourceType,
    source_label: event.sourceLabel,
    alert_lane: candidate.alertLane,
    severity: event.severity,
    delivered_channels: candidate.eligibleChannels.map((channel) => channel.channel),
    delivery_status: "queued",
    ...(candidate.tickerMatch ? { ticker_match: candidate.tickerMatch } : {}),
    delivered_at: now,
    scheduled_for: candidate.scheduledFor,
    sent_at: null,
    attempted_at: null,
    last_error: null,
    dedupe_key: buildDeliveryDedupeKey(event.id),
  };

  const result = await supabasePost("user_alert_deliveries", payload);
  if (result.ok) return { ok: true, row: Array.isArray(result.data) ? result.data[0] : null };
  if (result.status === 409 || /duplicate|unique/i.test(result.error || "")) {
    return { ok: true, skipped: true, reason: "DUPLICATE_DELIVERY" };
  }
  return { ok: false, status: result.status, error: result.error || "insert failed" };
}

async function fetchOne(table, query) {
  const rows = await fetchRows(table, { select: "*", ...query, limit: "1" });
  return rows[0] || null;
}

async function fetchRows(table, query) {
  const result = await supabaseGet(table, query);
  if (!result.ok) throw new Error(`${table} read failed: ${result.error || result.status}`);
  return Array.isArray(result.data) ? result.data : [];
}

async function supabaseGet(table, query) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
  }
  const response = await fetch(url, {
    headers: supabaseServiceHeaders(key, {
      Accept: "application/json",
    }),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, error: response.ok ? undefined : readError(data, response.statusText) };
}

async function supabasePost(table, payload) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: "POST",
    headers: supabaseServiceHeaders(key, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data, error: response.ok ? undefined : readError(data, response.statusText) };
}

function readPlan(row) {
  const plan = readString(row?.plan);
  const status = readString(row?.status);
  const basePlan = isPlan(plan) ? plan : "free";
  const effectiveBasePlan = status && status !== "active" ? "free" : basePlan;
  if (PLAN_RANK[effectiveBasePlan] >= PLAN_RANK.pro) return effectiveBasePlan;

  const trialPlan = readString(row?.trial_plan);
  const trialStartedAt = readString(row?.trial_started_at);
  const trialEndsAt = readString(row?.trial_ends_at);
  const trialEndsTime = Date.parse(trialEndsAt);
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

function isPlan(plan) {
  if (plan === "free" || plan === "ad_free" || plan === "pro" || plan === "advanced" || plan === "ultimate") return true;
  return false;
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

function toPrintableResult(result) {
  return {
    ok: result.ok,
    dryRun,
    write,
    event: result.event
      ? {
          id: result.event.id,
          title: result.event.title,
          tickers: result.event.tickers,
          category: result.event.category,
          sourceType: result.event.sourceType,
          severity: result.event.severity,
          deliveryLevel: result.event.deliveryLevel,
        }
      : null,
    candidates: result.candidates.map((candidate) => ({
      userId: candidate.userId,
      plan: candidate.plan,
      alertLane: candidate.alertLane,
      matchedTickers: candidate.matchedTickers,
      scheduledFor: candidate.scheduledFor,
      deliveryStatus: candidate.deliveryStatus,
      eligibleChannels: candidate.eligibleChannels.map((channel) => channel.channel),
    })),
    skipped: result.skipped,
    writes: result.writes,
    stats: result.stats,
    error: result.error,
  };
}

function uniqueTickers(values) {
  const seen = new Set();
  const tickers = [];
  for (const value of values) {
    const ticker = normalizeTicker(value);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    tickers.push(ticker);
  }
  return tickers;
}

function normalizeTicker(value) {
  const ticker = readString(value).toUpperCase();
  if (!ticker || ticker === "N/A" || ticker === "NA" || ticker === "UNKNOWN" || ticker === "-") return "";
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function readBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readOptionalScore(value) {
  const number = readNumber(value, Number.NaN);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : undefined;
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

function readDeliveryLevel(value) {
  const level = readString(value);
  if (level === "archive" || level === "feed" || level === "alert") return level;
  return "";
}

function readString(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readError(data, fallback) {
  if (data && typeof data === "object" && "message" in data) return String(data.message || fallback);
  if (typeof data === "string") return data;
  return fallback;
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
