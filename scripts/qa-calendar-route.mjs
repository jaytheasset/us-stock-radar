#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSupabaseSecretKey, supabaseServiceHeaders } from "./supabase-service-headers.mjs";

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
const key = resolveSupabaseSecretKey(env);
const qaId = randomUUID();
const now = new Date().toISOString();
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const checks = [];
const created = {
  rawItemId: "",
  eventId: "",
  calendarItemId: "",
  duplicateCalendarItemId: "",
};

try {
  requireEnv("SUPABASE_URL", supabaseUrl);
  requireEnv("SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY", key);

  const rawItem = await insertOne("raw_items", {
    source_code: "globe",
    source_group: "news",
    source_unique_id: `qa-calendar-route:${qaId}`,
    source_url: "https://www.globenewswire.com/news-release/qa-calendar-route",
    title: "QA Calendar Route: Earnings Call Scheduled",
    published_at: now,
    body_text: "QA-only source text. The company will host an earnings call tomorrow at 9:00 a.m. ET.",
    analysis_text: "The company will host an earnings call tomorrow at 9:00 a.m. ET.",
    raw_payload: { qa: true },
    metadata: { qa: true, temporary: true },
    dedupe_key: `qa-calendar-route:${qaId}`,
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
    ticker: "QCAL",
    market: "NASDAQ",
    event_type: "earnings",
    score: 55,
    delivery_level: "feed",
    impact: "medium",
    signal: "neutral",
    market_scope: "company",
    sector: "Technology",
    industry_group: "Semiconductors & Compute",
    title: "QA Calendar Route: Earnings Call Scheduled",
    quick_take: "QA event verifies calendar extraction storage.",
    summary: "QA-only event used to verify calendar route behavior.",
    reason: "QA calendar route verification",
    detected_at: now,
    group_dedupe_key: `qa-calendar-route:${qaId}`,
    metadata: { qa: true, temporary: true },
  });
  created.eventId = event.id;
  check("event inserted", Boolean(created.eventId), event);

  const calendarItem = await insertOne("event_calendar_items", {
    source_event_id: created.eventId,
    raw_item_id: created.rawItemId,
    source_code: "globe",
    source_group: "news",
    ticker: "QCAL",
    company_name: "QA Calendar",
    calendar_event_key: `qcal:earnings_call:${tomorrow}:09:00:00:qa-calendar-route`,
    calendar_event_type: "earnings_call",
    calendar_group: "earnings",
    calendar_title: "Q1 earnings conference call",
    event_date: tomorrow,
    event_time: "09:00:00",
    event_timezone: "America/New_York",
    date_precision: "exact",
    estimated_start_date: null,
    estimated_end_date: null,
    is_estimated: false,
    confidence: "high",
    calendar_status: "tentative",
    confirmation_source: "news",
    confirmed_at: null,
    confirmed_by_event_id: null,
    superseded_by_item_id: null,
    source_url: rawItem.source_url,
    evidence: "The company will host an earnings call tomorrow at 9:00 a.m. ET.",
    metadata: { qa: true, temporary: true },
  });
  created.calendarItemId = calendarItem.id;
  check("calendar item inserted", Boolean(created.calendarItemId), calendarItem);

  const duplicateCalendarItem = await insertOne("event_calendar_items", {
    source_event_id: created.eventId,
    raw_item_id: created.rawItemId,
    source_code: "globe",
    source_group: "news",
    ticker: "QCAL",
    company_name: "QA Calendar",
    calendar_event_key: `qcal:earnings_call:${tomorrow}:09:00:00:qa-calendar-route-correction`,
    calendar_event_type: "earnings_call",
    calendar_group: "earnings",
    calendar_title: "Corrected Q1 earnings call",
    event_date: tomorrow,
    event_time: "09:00:00",
    event_timezone: "America/New_York",
    date_precision: "exact",
    estimated_start_date: null,
    estimated_end_date: null,
    is_estimated: false,
    confidence: "high",
    calendar_status: "tentative",
    confirmation_source: "news",
    confirmed_at: null,
    confirmed_by_event_id: null,
    superseded_by_item_id: null,
    source_url: rawItem.source_url,
    evidence: "Corrected QA duplicate for the same earnings call date and time.",
    metadata: { qa: true, temporary: true, duplicate: true },
  });
  created.duplicateCalendarItemId = duplicateCalendarItem.id;
  check("duplicate calendar item inserted", Boolean(created.duplicateCalendarItemId), duplicateCalendarItem);

  const calendar = await getLocalJson("/api/calendar?ticker=QCAL&source_group=news&limit=50");
  const rows = Array.isArray(calendar.data) ? calendar.data : [];
  const returned = rows.find((row) => row.id === created.calendarItemId || row.id === created.duplicateCalendarItemId);
  check("calendar item returned by /api/calendar", Boolean(returned), calendar);
  check("duplicate calendar items collapse to one API row", rows.length === 1, calendar);
  check("calendar item keeps group", returned?.calendar_group === "earnings", returned);
  check("calendar item keeps type", returned?.calendar_event_type === "earnings_call", returned);
  check("calendar item keeps tentative status", returned?.calendar_status === "tentative", returned);
  check("calendar item keeps calendar event key", typeof returned?.calendar_event_key === "string", returned);
  check("calendar item keeps event link", returned?.source_event_id === created.eventId, returned);

  const tentativeCalendar = await getLocalJson("/api/calendar?ticker=QCAL&status=tentative&limit=50");
  const tentativeRows = Array.isArray(tentativeCalendar.data) ? tentativeCalendar.data : [];
  check(
    "calendar status filter returns tentative item",
    tentativeRows.length === 1 &&
      tentativeRows.some((row) => row.id === created.calendarItemId || row.id === created.duplicateCalendarItemId),
    tentativeCalendar,
  );

  const cleanupResult = await cleanup();
  check("temporary rows cleaned up", cleanupResult.ok, cleanupResult);

  const afterCleanup = await getLocalJson("/api/calendar?ticker=QCAL&source_group=news&limit=50");
  const stillVisible =
    Array.isArray(afterCleanup.data) &&
    afterCleanup.data.some((row) => row.id === created.calendarItemId || row.id === created.duplicateCalendarItemId);
  check("temporary calendar item no longer visible after cleanup", !stillVisible, afterCleanup);

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
  for (const [table, search] of [
    ["event_calendar_items", { id: `eq.${created.duplicateCalendarItemId || "00000000-0000-0000-0000-000000000000"}` }],
    ["event_calendar_items", { id: `eq.${created.calendarItemId || "00000000-0000-0000-0000-000000000000"}` }],
    ["events", { id: `eq.${created.eventId || "00000000-0000-0000-0000-000000000000"}` }],
    ["raw_items", { id: `eq.${created.rawItemId || "00000000-0000-0000-0000-000000000000"}` }],
  ]) {
    const result = await safeDelete(table, search);
    if (!result.ok) errors.push(result);
  }
  return { ok: errors.length === 0, errors };
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
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status} ${stringifyShort(text)}`);
  return text ? JSON.parse(text) : null;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
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
