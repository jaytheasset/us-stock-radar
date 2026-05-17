#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const key = serviceKey && !serviceKey.startsWith("sb_secret_") ? serviceKey : env.SUPABASE_ANON_KEY || "";
const qaId = randomUUID();
const now = new Date().toISOString();
const rawUniqueId = `qa-alert-route:${qaId}`;
const dedupeKey = `qa-alert-route:${qaId}`;

const created = {
  rawItemId: "",
  eventId: "",
};

const checks = [];

try {
  requireEnv("SUPABASE_URL", supabaseUrl);
  requireEnv("SUPABASE_API_KEY", key);

  const eventType = await pickEventType();
  const rawItem = await insertOne("raw_items", {
    source_code: "globe",
    source_group: "news",
    source_unique_id: rawUniqueId,
    source_url: "https://www.globenewswire.com/news-release/qa-alert-route",
    title: "QA Alert Route: NVIDIA Announces Expanded Data Center Platform Availability",
    published_at: now,
    body_text:
      "QA-only source text. NVIDIA announced expanded data center platform availability across cloud partners.",
    analysis_text:
      "NVIDIA announced expanded data center platform availability across cloud partners.",
    raw_payload: {
      qa: true,
      source: "qa-alert-route",
    },
    metadata: {
      qa: true,
      temporary: true,
      cleanup_required: true,
    },
    dedupe_key: dedupeKey,
  });
  created.rawItemId = rawItem.id;
  check("raw item inserted", Boolean(created.rawItemId), rawItem);

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
    score: 82,
    delivery_level: "alert",
    impact: "high",
    signal: "bullish",
    market_scope: "company",
    sector: "Technology",
    industry_group: "Semiconductors & Compute",
    theme_group: "AI & Data Center",
    sub_theme: "AI Infrastructure",
    title: "QA Alert Route: NVIDIA Announces Expanded Data Center Platform Availability",
    quick_take: "NVIDIA platform availability expands enterprise AI deployment options.",
    summary: "QA-only alert event used to verify the alert read path and detail page.",
    reason: "QA alert route verification",
    detected_at: now,
    group_dedupe_key: dedupeKey,
    metadata: {
      qa: true,
      temporary: true,
      cleanup_required: true,
    },
  });
  created.eventId = event.id;
  check("alert event inserted", Boolean(created.eventId), event);

  await insertOne("event_analysis", {
    event_id: created.eventId,
    analysis_scope: "company",
    why_it_matters: "QA-only alert verifies that high-impact news reaches API and detail views.",
    bullish_points: [
      "Alert delivery level is stored.",
      "Company ticker is attached.",
      "Detail page can render analysis.",
    ],
    bearish_points: ["QA item should never remain after cleanup."],
    key_evidence: ["Temporary QA event inserted with delivery_level alert."],
    watch_next: ["Confirm cleanup removed all temporary rows."],
    metadata: {
      qa: true,
      temporary: true,
    },
  });
  check("event analysis inserted", true);

  await insertOne("event_tickers", {
    event_id: created.eventId,
    symbol: "NVDA",
    exchange: "NASDAQ",
    role: "primary",
    relevance_score: 100,
    sort_order: 1,
    reason: "Primary company ticker for alert route QA.",
    metadata: {
      qa: true,
      temporary: true,
    },
  });
  check("event ticker inserted", true);

  const alertEvents = await getLocalJson(`/api/events?source_group=news&delivery_level=alert&limit=20`);
  const returnedRows = Array.isArray(alertEvents.data) ? alertEvents.data : [];
  const returnedAlert = returnedRows.find((row) => row.id === created.eventId);
  check("alert event returned by /api/events", Boolean(returnedAlert), alertEvents);
  check("returned alert has delivery_level alert", returnedAlert?.delivery_level === "alert", returnedAlert);
  check("returned alert keeps ticker", returnedAlert?.ticker === "NVDA", returnedAlert);

  const detail = await fetchLocal(`/events/${created.eventId}`);
  check("alert detail page returns 200", detail.status === 200, { status: detail.status, text: detail.text.slice(0, 300) });
  check("alert detail page includes title", detail.text.includes("QA Alert Route"), {
    status: detail.status,
    text: detail.text.slice(0, 500),
  });

  const cleanupResult = await cleanup();
  check("temporary rows cleaned up", cleanupResult.ok, cleanupResult);

  const afterCleanup = await getLocalJson(`/api/events?source_group=news&delivery_level=alert&limit=20`);
  const stillVisible = Array.isArray(afterCleanup.data) && afterCleanup.data.some((row) => row.id === created.eventId);
  check("temporary alert no longer visible after cleanup", !stillVisible, afterCleanup);

  printAndExit();
} catch (error) {
  checks.push({
    name: "qa script failed",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });

  const cleanupResult = await cleanup();
  checks.push({
    name: "cleanup after failure",
    ok: cleanupResult.ok,
    detail: cleanupResult.ok ? undefined : cleanupResult,
  });

  printAndExit();
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

async function cleanup() {
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
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: prefer || "return=representation",
    },
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
    temporaryEventId: created.eventId || null,
    temporaryRawItemId: created.rawItemId || null,
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
