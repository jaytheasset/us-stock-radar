#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { supabaseServiceHeaders } from "./supabase-service-headers.mjs";

const args = parseArgs(process.argv.slice(2));
const write = args.has("write");
const dryRun = !write;
const force = args.has("force");
const limit = normalizeLimit(args.get("limit"));
const lookbackHours = normalizeLookbackHours(args.get("lookback-hours") || args.get("lookbackHours"));
const env = readLocalEnv();
const supabaseUrl = cleanSupabaseUrl(env.SUPABASE_URL || "");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
const key = serviceKey;

if (!supabaseUrl || !key) {
  console.error("Supabase env is missing. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exitCode = 1;
} else {
  try {
    const result = await runBatch();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          dryRun,
          write,
          force,
          scanned: 0,
          processed: 0,
          wouldProcess: 0,
          skippedAlreadyProcessed: 0,
          deliveriesCreated: 0,
          duplicatesSkipped: 0,
          failed: 1,
          events: [],
          error: sanitizeError(error instanceof Error ? error.message : "Alert delivery batch failed."),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function runBatch() {
  const events = await fetchRecentEvents();
  const processedIds = force ? new Set() : await fetchProcessedEventIds(events.map((event) => event.id));
  const results = [];
  let skippedAlreadyProcessed = 0;

  for (const event of events) {
    if (event.deliveryLevel !== "alert") {
      results.push({
        eventId: event.id,
        title: event.title,
        status: "skipped",
        candidatesFound: 0,
        deliveriesCreated: 0,
        duplicatesSkipped: 0,
        suppressedCount: 0,
        failedCount: 0,
      });
      continue;
    }

    if (!force && processedIds.has(event.id)) {
      skippedAlreadyProcessed += 1;
      results.push({
        eventId: event.id,
        title: event.title,
        status: "already_processed",
        candidatesFound: 0,
        deliveriesCreated: 0,
        duplicatesSkipped: 0,
        suppressedCount: 0,
        failedCount: 0,
      });
      continue;
    }

    const runResult = runEventDelivery(event.id);
    const eventResult = summarizeEventRun(event, runResult);
    results.push(eventResult);

    if (write) {
      await recordEventRun(event, eventResult, runResult);
    }
  }

  return {
    ok: true,
    dryRun,
    write,
    force,
    scanned: events.length,
    processed: write ? results.filter((event) => event.status !== "already_processed").length : 0,
    wouldProcess: dryRun ? results.filter((event) => event.status !== "already_processed").length : 0,
    skippedAlreadyProcessed,
    deliveriesCreated: results.reduce((sum, event) => sum + event.deliveriesCreated, 0),
    duplicatesSkipped: results.reduce((sum, event) => sum + event.duplicatesSkipped, 0),
    failed: results.filter((event) => event.status === "failed").length,
    events: results,
  };
}

async function fetchRecentEvents() {
  const detectedAfter = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const rows = await fetchRows("events", {
    select: "id,title,detected_at,delivery_level",
    delivery_level: "eq.alert",
    detected_at: `gte.${detectedAfter}`,
    order: "detected_at.asc",
    limit: String(limit),
  });
  return rows
    .map((row) => ({
      deliveryLevel: readDeliveryLevel(row.delivery_level),
      id: readString(row.id),
      title: readString(row.title) || null,
    }))
    .filter((event) => event.id && event.deliveryLevel === "alert");
}

async function fetchProcessedEventIds(eventIds) {
  if (!eventIds.length) return new Set();
  const rows = await fetchRows("alert_delivery_event_runs", {
    select: "event_id,status",
    event_id: `in.(${eventIds.join(",")})`,
    status: "in.(processed,skipped)",
    dry_run: "eq.false",
    limit: String(Math.max(eventIds.length, 1)),
  }).catch(() => []);
  return new Set(rows.map((row) => readString(row.event_id)).filter(Boolean));
}

function runEventDelivery(eventId) {
  const childArgs = ["scripts/run-alert-delivery-for-event.mjs", "--event-id", eventId];
  if (write) childArgs.push("--write");

  try {
    const stdout = execFileSync("node", childArgs, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return parseJson(stdout);
  } catch (error) {
    const stdout = String(error.stdout || "");
    const stderr = String(error.stderr || "");
    const parsed = parseJsonSafe(stdout);
    return (
      parsed || {
        ok: false,
        event: null,
        candidates: [],
        skipped: [],
        writes: [],
        stats: {
          candidateCount: 0,
          skippedCount: 0,
          writtenCount: 0,
          duplicateCount: 0,
        },
        error: sanitizeError(stderr || error.message || "Event delivery failed."),
      }
    );
  }
}

function summarizeEventRun(event, result) {
  const suppressedCount = Array.isArray(result.writes)
    ? result.writes.filter((item) => item.skipped && item.reason && item.reason !== "DUPLICATE_DELIVERY").length
    : 0;
  const failedCount = (Array.isArray(result.writes) ? result.writes.filter((item) => item.ok === false).length : 0) + (result.ok ? 0 : 1);

  if (!result.ok) {
    return {
      eventId: event.id,
      title: event.title,
      status: "failed",
      candidatesFound: 0,
      deliveriesCreated: 0,
      duplicatesSkipped: 0,
      suppressedCount,
      failedCount,
      error: sanitizeError(result.error || "Alert delivery event run failed."),
    };
  }

  const eventHasNoTicker = Array.isArray(result.skipped) && result.skipped.some((skip) => skip.reason === "EVENT_HAS_NO_TICKERS");
  return {
    eventId: event.id,
    title: result.event?.title || event.title,
    status: eventHasNoTicker ? "skipped" : "processed",
    candidatesFound: Number(result.stats?.candidateCount || 0),
    deliveriesCreated: Number(result.stats?.writtenCount || 0),
    duplicatesSkipped: Number(result.stats?.duplicateCount || 0),
    suppressedCount,
    failedCount,
  };
}

async function recordEventRun(event, eventResult, runResult) {
  if (event.deliveryLevel !== "alert") return;

  const payload = {
    event_id: event.id,
    status: eventResult.status === "already_processed" ? "processed" : eventResult.status,
    dry_run: false,
    processed_at: new Date().toISOString(),
    deliveries_created: eventResult.deliveriesCreated,
    duplicates_skipped: eventResult.duplicatesSkipped,
    candidates_found: eventResult.candidatesFound,
    suppressed_count: eventResult.suppressedCount,
    failed_count: eventResult.failedCount,
    result_summary: {
      event: runResult.event
        ? {
            title: runResult.event.title,
            tickers: runResult.event.tickers,
            category: runResult.event.category,
            sourceType: runResult.event.sourceType,
          }
        : null,
      stats: runResult.stats || {},
      skipped: Array.isArray(runResult.skipped)
        ? runResult.skipped.map((skip) => ({
            reason: skip.reason,
            detail: skip.detail,
          }))
        : [],
    },
    last_error: eventResult.error || null,
  };

  const inserted = await supabaseRequest("POST", "alert_delivery_event_runs", {}, payload);
  if (inserted.ok) return;

  if (/duplicate|unique/i.test(inserted.error || "")) {
    await supabaseRequest("PATCH", "alert_delivery_event_runs", { event_id: `eq.${event.id}`, dry_run: "eq.false" }, payload);
    return;
  }

  throw new Error(inserted.error || `Failed to record alert_delivery_event_runs for ${event.id}`);
}

async function fetchRows(table, query) {
  const result = await supabaseRequest("GET", table, query);
  if (!result.ok) throw new Error(`${table} read failed: ${result.error || result.status}`);
  return Array.isArray(result.data) ? result.data : [];
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

function normalizeLookbackHours(value) {
  const hours = Number(value || 6);
  return Math.max(1, Math.min(Number.isFinite(hours) ? Math.trunc(hours) : 6, 24 * 30));
}

function parseJson(value) {
  const parsed = parseJsonSafe(value);
  if (!parsed) throw new Error("Child delivery output was not valid JSON.");
  return parsed;
}

function parseJsonSafe(value) {
  const text = String(value || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
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

function readString(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readDeliveryLevel(value) {
  const normalized = readString(value).toLowerCase();
  return normalized === "archive" || normalized === "feed" || normalized === "alert" ? normalized : "";
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
