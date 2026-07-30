import "server-only";

import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import {
  isAllowedFmpCompanyExchange,
  normalizeFmpCalendarTicker,
} from "./fmpCalendarIdentity.ts";
import type {
  FmpCalendarObservation,
  FmpCalendarPersistResult,
  FmpTickerUniverseEntry,
} from "./fmpCalendarTypes.ts";

const TICKER_PAGE_SIZE = 1_000;
const MAX_TICKER_ROWS = 25_000;

export async function loadFmpCalendarTickerUniverse() {
  const universe = new Map<string, FmpTickerUniverseEntry>();
  for (let offset = 0; offset < MAX_TICKER_ROWS; offset += TICKER_PAGE_SIZE) {
    const result = await supabaseSelect("tickers", {
      asset_type: "in.(stock,adr_or_class)",
      is_active: "eq.true",
      limit: String(TICKER_PAGE_SIZE),
      offset: String(offset),
      order: "symbol.asc",
      select: "symbol,name,exchange,asset_type,is_active",
    });
    if (!result.ok || !Array.isArray(result.data)) {
      throw new Error("Calendar ticker universe could not be loaded.");
    }
    for (const value of result.data) {
      const row =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      const symbol = normalizeFmpCalendarTicker(row?.symbol);
      const name =
        typeof row?.name === "string" && row.name.trim()
          ? row.name.trim()
          : symbol;
      const exchange =
        typeof row?.exchange === "string" ? row.exchange.trim() : "";
      const assetType =
        row?.asset_type === "stock" || row?.asset_type === "adr_or_class"
          ? row.asset_type
          : null;
      if (
        symbol &&
        name &&
        exchange &&
        assetType &&
        row?.is_active === true &&
        isAllowedFmpCompanyExchange(exchange)
      ) {
        universe.set(symbol, { assetType, exchange, name, symbol });
      }
    }
    if (result.data.length < TICKER_PAGE_SIZE) return universe;
  }
  throw new Error("Calendar ticker universe exceeded its safety limit.");
}

export async function persistFmpCalendarObservation(
  observation: FmpCalendarObservation,
): Promise<FmpCalendarPersistResult> {
  const result = await supabaseRpc("ingest_fmp_calendar_observation", {
    p_observation: {
      canonical_identity_key: observation.canonicalIdentityKey,
      category: "company",
      company_name: observation.companyName,
      details: observation.details,
      event_date: observation.eventDate,
      event_type: observation.eventType,
      fetched_at: observation.fetchedAt,
      impact_level: observation.impactLevel,
      lifecycle_status: observation.lifecycleStatus,
      mode: "backfill",
      observation_fingerprint: observation.observationFingerprint,
      provider: "fmp",
      raw_checksum: observation.rawChecksum,
      raw_payload: observation.rawPayload,
      request_date: observation.requestDate,
      run_id: observation.runId,
      schedule_confidence: observation.scheduleConfidence,
      source_event_key: observation.sourceEventKey,
      source_modified_at: observation.sourceModifiedAt,
      ticker: observation.ticker,
      title: observation.title,
    },
  });
  if (!result.ok) {
    throw new Error("Calendar observation could not be persisted.");
  }
  const value =
    result.data && typeof result.data === "object" && !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : null;
  const eventId = typeof value?.event_id === "string" ? value.event_id : "";
  const revision =
    typeof value?.revision === "number" && Number.isInteger(value.revision)
      ? value.revision
      : 0;
  if (!eventId || revision < 1) {
    throw new Error("Calendar persistence returned an invalid result.");
  }
  return {
    eventId,
    historyCreated: value?.history_created === true,
    revision,
    unchanged: value?.unchanged === true,
    upserted: value?.upserted === true,
  };
}
