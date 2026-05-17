import { NextRequest, NextResponse } from "next/server";
import { supabaseSelect } from "@/lib/supabase";
import {
  CALENDAR_STATUS_VALUES,
  getCalendarEventGroup,
  normalizeCalendarEventType,
  normalizeCalendarStatus,
} from "@/lib/calendarEventRegistry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = clampInt(Number(searchParams.get("limit") || 100), 1, 500);
  const group = normalizeCalendarGroup(searchParams.get("group"));
  const type = normalizeCalendarTypeParam(searchParams.get("type"));
  const ticker = normalizeTicker(searchParams.get("ticker"));
  const sourceGroup = normalizeSourceGroup(searchParams.get("source_group"));
  const status = normalizeStatus(searchParams.get("status"));
  const from = normalizeDate(searchParams.get("from"));
  const to = normalizeDate(searchParams.get("to"));

  const query: Record<string, string> = {
    select: "*",
    order: "event_date.asc.nullslast,estimated_start_date.asc.nullslast,created_at.desc",
    limit: String(limit),
  };

  if (group) query.calendar_group = `eq.${group}`;
  if (type) query.calendar_event_type = `eq.${type}`;
  if (ticker) query.ticker = `eq.${ticker}`;
  if (sourceGroup) query.source_group = `eq.${sourceGroup}`;
  if (status) query.calendar_status = `eq.${status}`;
  if (from && to) {
    query.and = `(event_date.gte.${from},event_date.lte.${to})`;
  } else if (from) {
    query.event_date = `gte.${from}`;
  } else if (to) {
    query.event_date = `lte.${to}`;
  }

  const result = await supabaseSelect("event_calendar_items", query);

  return NextResponse.json(
    {
      ok: result.ok,
      status: result.status,
      data: Array.isArray(result.data) ? result.data : [],
      count: Array.isArray(result.data) ? result.data.length : 0,
      error: result.error,
    },
    {
      status: result.ok ? 200 : result.status || 502,
    },
  );
}

function normalizeCalendarTypeParam(value: string | null) {
  if (!value) return undefined;
  const normalized = normalizeCalendarEventType(value);
  return normalized === "other_scheduled_event" && value !== "other_scheduled_event" ? undefined : normalized;
}

function normalizeCalendarGroup(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  const knownGroups = new Set([
    "earnings",
    "shareholder",
    "dividends",
    "listing_risk",
    "ipo",
    "deals_offering",
    "filings",
    "fda_clinical",
    "investor_events",
    "legal_policy",
    "other",
  ]);
  if (knownGroups.has(normalized)) return normalized;

  const typeGroup = getCalendarEventGroup(normalized);
  return typeGroup === "other" ? undefined : typeGroup;
}

function normalizeTicker(value: string | null) {
  const ticker = value?.trim().toUpperCase() || "";
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : undefined;
}

function normalizeSourceGroup(value: string | null) {
  if (value === "news" || value === "filings" || value === "market") return value;
  return undefined;
}

function normalizeStatus(value: string | null) {
  if (!value) return undefined;
  const raw = value.trim().toLowerCase();
  if (!CALENDAR_STATUS_VALUES.includes(raw as (typeof CALENDAR_STATUS_VALUES)[number])) return undefined;
  return normalizeCalendarStatus(raw);
}

function normalizeDate(value: string | null) {
  const date = value?.trim() || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return date;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
