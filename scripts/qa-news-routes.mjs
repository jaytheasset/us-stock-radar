#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { supabaseServiceHeaders } from "./supabase-service-headers.mjs";

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);

const baseUrl = String(args.get("base") || process.env.APP_LOCAL_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const env = readLocalEnv();
const supabaseUrl = cleanSupabaseUrl(env.SUPABASE_URL || "");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
const key = serviceKey;
const checks = [];

try {
  requireEnv("SUPABASE_URL", supabaseUrl);
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", key);

  const eventType = await pickEventType();
  await runCase({
    eventType,
    mode: "alert",
    score: 82,
    deliveryLevel: "alert",
    signal: "bullish",
    title: "QA Alert Route: NVIDIA Announces Expanded Data Center Platform Availability",
    detailPath: (id) => `/events/${id}`,
    routePath: "/api/events?source_group=news&delivery_level=alert&limit=50",
    expectDefaultFeedVisible: true,
  });

  await runCase({
    eventType,
    mode: "archive",
    score: 42,
    deliveryLevel: "archive",
    signal: "neutral",
    title: "QA Archive Route: Routine Company Update Preserved Below Live Feed Threshold",
    detailPath: (id) => `/news/archive/${id}`,
    routePath: "/api/events?source_group=news&delivery_level=archive&include_archive=true&limit=50",
    expectDefaultFeedVisible: false,
  });

  printAndExit();
} catch (error) {
  checks.push({
    name: "qa script failed",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  printAndExit();
}

async function runCase({
  eventType,
  mode,
  score,
  deliveryLevel,
  signal,
  title,
  detailPath,
  routePath,
  expectDefaultFeedVisible,
}) {
  const qaId = randomUUID();
  const now = new Date().toISOString();
  const created = {
    rawItemId: "",
    eventId: "",
  };

  try {
    const rawItem = await insertOne("raw_items", {
      source_code: "globe",
      source_group: "news",
      source_unique_id: `qa-${mode}-route:${qaId}`,
      source_url: `https://www.globenewswire.com/news-release/qa-${mode}-route`,
      title,
      published_at: now,
      body_text: `${title}. QA-only source text used to verify the ${mode} route.`,
      analysis_text: `${title}. QA-only source text used to verify the ${mode} route.`,
      raw_payload: {
        qa: true,
        source: `qa-${mode}-route`,
      },
      metadata: {
        qa: true,
        mode,
        temporary: true,
        cleanup_required: true,
      },
      dedupe_key: `qa-${mode}-route:${qaId}`,
    });
    created.rawItemId = rawItem.id;
    check(`${mode}: raw item inserted`, Boolean(created.rawItemId), rawItem);

    const event = await insertOne("events", {
      raw_item_id: created.rawItemId,
      source_code: "globe",
      source_group: "news",
      source_name: "GlobeNewswire",
      source_url: rawItem.source_url,
      published_at: now,
      ticker: "NVDA",
      market: "NASDAQ",
      event_type: eventType,
      score,
      delivery_level: deliveryLevel,
      impact: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
      signal,
      market_scope: "company",
      sector: "Technology",
      industry_group: "Semiconductors & Compute",
      title,
      quick_take:
        deliveryLevel === "archive"
          ? "Routine company update preserved for ticker history."
          : "High-impact company update should appear in alert views.",
      summary:
        deliveryLevel === "archive"
          ? "Routine company update preserved below the live feed threshold."
          : "High-impact company update used to verify alert routing.",
      reason: `QA ${mode} route verification`,
      detected_at: now,
      group_dedupe_key: `qa-${mode}-route:${qaId}`,
      metadata: {
        qa: true,
        mode,
        temporary: true,
        cleanup_required: true,
      },
    });
    created.eventId = event.id;
    check(`${mode}: event inserted`, Boolean(created.eventId), event);

    await insertOne("event_analysis", {
      event_id: created.eventId,
      analysis_scope: "company",
      why_it_matters: `QA-only ${mode} event verifies route behavior.`,
      bullish_points: ["Route check inserted a temporary event."],
      bearish_points: ["Temporary event must be cleaned up."],
      key_evidence: [`delivery_level=${deliveryLevel}`],
      watch_next: ["Confirm API and detail page behavior."],
      metadata: {
        qa: true,
        mode,
        temporary: true,
      },
    });
    check(`${mode}: event analysis inserted`, true);

    await insertOne("event_tickers", {
      event_id: created.eventId,
      symbol: "NVDA",
      exchange: "NASDAQ",
      role: "primary",
      relevance_score: 100,
      sort_order: 1,
      reason: `Primary company ticker for ${mode} route QA.`,
      metadata: {
        qa: true,
        mode,
        temporary: true,
      },
    });
    check(`${mode}: event ticker inserted`, true);

    const routeResult = await getLocalJson(routePath);
    const routeRows = Array.isArray(routeResult.data) ? routeResult.data : [];
    check(
      `${mode}: event returned by its route`,
      routeRows.some((row) => row.id === created.eventId),
      routeResult,
    );

    const defaultFeed = await getLocalJson("/api/events?source_group=news&limit=100");
    const defaultRows = Array.isArray(defaultFeed.data) ? defaultFeed.data : [];
    const visibleInDefault = defaultRows.some((row) => row.id === created.eventId);
    check(
      `${mode}: default feed visibility is correct`,
      visibleInDefault === expectDefaultFeedVisible,
      defaultFeed,
    );

    const detail = await fetchLocal(detailPath(created.eventId));
    check(`${mode}: detail page returns 200`, detail.status === 200, {
      status: detail.status,
      text: detail.text.slice(0, 300),
    });
    check(`${mode}: detail page includes title`, detail.text.includes(title), {
      status: detail.status,
      text: detail.text.slice(0, 500),
    });
  } finally {
    const cleanupResult = await cleanup(created);
    check(`${mode}: temporary rows cleaned up`, cleanupResult.ok, cleanupResult);

    if (created.eventId) {
      const afterCleanup = await getLocalJson(`${routePath}&_cleanup_check=${Date.now()}`);
      const stillVisible =
        Array.isArray(afterCleanup.data) && afterCleanup.data.some((row) => row.id === created.eventId);
      check(`${mode}: temporary event no longer visible after cleanup`, !stillVisible, afterCleanup);
    }
  }
}

async function pickEventType() {
  const preferred = ["product_launch", "strategic_update", "earnings", "other"];
  const rows = await supabaseGet("event_types", {
    select: "code",
    code: `in.(${preferred.join(",")})`,
    limit: "20",
  });
  const codes = new Set((Array.isArray(rows) ? rows : []).map((row) => row.code));
  for (const code of preferred) {
    if (codes.has(code)) return code;
  }

  const fallbackRows = await supabaseGet("event_types", {
    select: "code",
    limit: "1",
  });
  const fallback = Array.isArray(fallbackRows) ? fallbackRows[0]?.code : "";
  if (!fallback) throw new Error("No event_types rows found");
  return fallback;
}

async function insertOne(table, payload) {
  const rows = await supabaseRequest(table, {
    method: "POST",
    search: {},
    body: payload,
    prefer: "return=representation",
  });
  if (!Array.isArray(rows) || !rows[0]) {
    throw new Error(`Insert into ${table} returned no rows`);
  }
  return rows[0];
}

async function cleanup(created) {
  const errors = [];

  if (created.eventId) {
    for (const [table, search] of [
      ["event_tickers", { event_id: `eq.${created.eventId}` }],
      ["event_analysis", { event_id: `eq.${created.eventId}` }],
      ["ai_outputs", { event_id: `eq.${created.eventId}` }],
      ["ai_runs", { event_id: `eq.${created.eventId}` }],
      ["events", { id: `eq.${created.eventId}` }],
    ]) {
      const result = await safeDelete(table, search);
      if (!result.ok) errors.push(result);
    }
  }

  if (created.rawItemId) {
    for (const [table, search] of [
      ["ai_runs", { raw_item_id: `eq.${created.rawItemId}` }],
      ["raw_items", { id: `eq.${created.rawItemId}` }],
    ]) {
      const result = await safeDelete(table, search);
      if (!result.ok) errors.push(result);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

async function safeDelete(table, search) {
  try {
    await supabaseRequest(table, {
      method: "DELETE",
      search,
      prefer: "return=representation",
    });
    return { ok: true, table };
  } catch (error) {
    return {
      ok: false,
      table,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function supabaseGet(table, search) {
  return supabaseRequest(table, {
    method: "GET",
    search,
  });
}

async function supabaseRequest(table, { method, search, body, prefer }) {
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(search || {})) {
    if (value) url.searchParams.set(name, value);
  }

  const response = await fetch(url, {
    method,
    headers: supabaseServiceHeaders(key, {
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
    }),
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const parsed = parseBody(text);

  if (!response.ok) {
    throw new Error(`${method} ${table} failed: HTTP ${response.status} ${stringifyShort(parsed)}`);
  }

  return parsed;
}

async function getLocalJson(path) {
  const response = await fetchLocal(path);
  try {
    return response.text ? JSON.parse(response.text) : null;
  } catch {
    throw new Error(`GET ${path} did not return JSON: ${response.text.slice(0, 300)}`);
  }
}

async function fetchLocal(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed: HTTP ${response.status} ${stringifyShort(text)}`);
  }
  return {
    status: response.status,
    text,
  };
}

function check(name, ok, detail) {
  checks.push({
    name,
    ok: Boolean(ok),
    detail: ok ? undefined : detail,
  });
}

function printAndExit() {
  const summary = {
    baseUrl,
    checksPassed: checks.filter((item) => item.ok).length,
    checksFailed: checks.filter((item) => !item.ok).length,
  };

  console.log(JSON.stringify({ ok: summary.checksFailed === 0, summary, checks }, null, 2));
  process.exit(summary.checksFailed === 0 ? 0 : 1);
}

function readLocalEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  const parsed = { ...process.env };
  if (!existsSync(envPath)) return parsed;

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index < 0) continue;

    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (name) parsed[name] = value;
  }

  return parsed;
}

function cleanSupabaseUrl(value) {
  return value.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

function requireEnv(name, value) {
  if (!value) throw new Error(`${name} is missing`);
}

function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringifyShort(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}
