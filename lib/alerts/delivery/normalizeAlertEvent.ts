import "server-only";

import { resolveCanonicalEventFields } from "@/lib/eventFieldMapping";
import { fetchEventById, fetchEventTickers } from "@/lib/supabase";
import { type AlertCategory, isValidAlertCategory } from "@/lib/subscriptionPolicy";
import { readStoredEventMarketCap } from "@/lib/marketCapBands";
import type { NormalizedAlertEvent, NormalizedAlertSeverity, NormalizedAlertSourceType } from "@/lib/alerts/delivery/types";
import {
  normalizeStoredAlertTickers,
  type StoredAlertTickerRow,
} from "@/lib/alerts/delivery/alertTickerNormalization";

type DbRow = Record<string, unknown>;
type EventTickerRow = StoredAlertTickerRow;

export async function normalizeAlertEvent(eventId: string): Promise<
  | {
      ok: true;
      event: NormalizedAlertEvent;
    }
  | {
      ok: false;
      error: string;
    }
> {
  const normalizedEventId = eventId.trim();
  if (!normalizedEventId) {
    return { ok: false, error: "event_id is required" };
  }

  const [eventResult, tickersResult] = await Promise.all([
    fetchEventById(normalizedEventId),
    fetchEventTickers(normalizedEventId),
  ]);

  if (!eventResult.ok || !eventResult.data || typeof eventResult.data !== "object") {
    return { ok: false, error: eventResult.error || `Event not found: ${normalizedEventId}` };
  }

  const row = eventResult.data as DbRow;
  const eventMetadata = readRecord(row.metadata);
  const canonical = resolveCanonicalEventFields(row);
  const tickerRows = Array.isArray(tickersResult.data) ? (tickersResult.data as EventTickerRow[]) : [];
  const { primaryTicker, tickers } = normalizeStoredAlertTickers(
    row.ticker,
    tickerRows,
  );
  const category = normalizeCategory(readString(row.event_type));
  const sourceType = normalizeSourceType(canonical.sourceGroup);
  const title = readString(row.title) || "Untitled alert event";
  const publishedAt = readString(row.published_at) || readString(row.detected_at);
  const sourceLabel = readString(row.source_name) || formatSource(readString(row.source_code));
  const severity = normalizeSeverity(canonical.score, canonical.impact);
  const score = readOptionalScore(row.score);
  const signal = readOptionalSignal(row.signal);
  const impact = readOptionalImpact(row.impact);

  return {
    ok: true,
    event: {
      id: normalizedEventId,
      title,
      quickTake: readString(row.quick_take) || undefined,
      tickers,
      primaryTicker,
      category,
      sourceType,
      sourceLabel,
      severity,
      score,
      signal,
      impact,
      marketScope: canonical.marketScope,
      publishedAt,
      metadata: {
        cik: readString(eventMetadata.cik),
        accession_number: readString(eventMetadata.accession_number),
        raw_item_id: readString(row.raw_item_id),
        source_url: readString(row.source_url),
        primary_document_url: readString(eventMetadata.primary_document_url),
        source_group: canonical.sourceGroup,
        source_code: readString(row.source_code),
        form_type:
          readString(eventMetadata.form_type) ||
          readString(eventMetadata.sec_form_type) ||
          readString(eventMetadata.formType),
        provider:
          readString(eventMetadata.provider) ||
          readString(eventMetadata.provider_name),
        agency: readString(eventMetadata.agency),
        company_name:
          readString(row.company_name) ||
          readString(eventMetadata.company_name) ||
          readString(eventMetadata.companyName),
        delivery_level: canonical.deliveryLevel,
        score: canonical.score,
        impact: canonical.impact,
        signal: canonical.signal,
        market_scope: canonical.marketScope,
        market_cap: readStoredEventMarketCap(eventMetadata),
      },
    },
  };
}

function readOptionalScore(value: unknown) {
  const score = readNumber(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : undefined;
}

function readOptionalSignal(value: unknown): NormalizedAlertEvent["signal"] {
  const signal = readString(value).toLowerCase();
  return signal === "bullish" || signal === "bearish" || signal === "volatile" || signal === "neutral"
    ? signal
    : undefined;
}

function readOptionalImpact(value: unknown): NormalizedAlertEvent["impact"] {
  const impact = readString(value).toLowerCase();
  return impact === "high" || impact === "medium" || impact === "low" ? impact : undefined;
}

function normalizeCategory(value: string): AlertCategory {
  return isValidAlertCategory(value) ? value : "other";
}

function normalizeSourceType(sourceGroup: string): NormalizedAlertSourceType {
  if (sourceGroup === "news") return "news";
  if (sourceGroup === "filings") return "filing";
  if (sourceGroup === "market") return "other";
  return "other";
}

function normalizeSeverity(score: number, impact: string): NormalizedAlertSeverity {
  if (score >= 90) return "critical";
  if (score >= 75 || impact === "high") return "high";
  if (score >= 50 || impact === "medium") return "medium";
  return "low";
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNumber(value: unknown, fallback = Number.NaN) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function readRecord(value: unknown): DbRow {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DbRow)
    : {};
}

function formatSource(value: string) {
  const known: Record<string, string> = {
    globe: "GlobeNewswire",
    globenewswire: "GlobeNewswire",
    businesswire: "Business Wire",
    prnewswire: "PR Newswire",
    newsfile: "Newsfile",
    sec_edgar: "SEC EDGAR",
    ofac: "OFAC",
    doj: "DOJ",
    dea: "DEA",
    whitehouse: "White House",
  };
  return known[value.toLowerCase()] || value || undefined;
}
