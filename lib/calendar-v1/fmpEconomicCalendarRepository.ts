import "server-only";

import { supabaseRpc } from "@/lib/supabase";
import type {
  FmpEconomicCalendarObservation,
  FmpEconomicCalendarPersistResult,
} from "./fmpEconomicCalendarTypes.ts";

export async function persistFmpEconomicCalendarObservation(
  observation: FmpEconomicCalendarObservation,
): Promise<FmpEconomicCalendarPersistResult> {
  const result = await supabaseRpc(
    "ingest_fmp_economic_calendar_observation",
    {
      p_observation: {
        canonical_identity_key: observation.canonicalIdentityKey,
        category: observation.category,
        details: observation.details,
        event_date: observation.eventDate,
        event_instant: observation.eventInstant,
        event_time: observation.eventTime,
        event_timezone: "America/New_York",
        event_type: observation.eventType,
        fetched_at: observation.fetchedAt,
        impact_level: observation.impactLevel,
        impact_scope: "market-wide",
        lifecycle_status: observation.lifecycleStatus,
        market_session: observation.marketSession,
        metrics: observation.metrics.map((metric) => ({
          actual: metric.actual,
          consensus: metric.consensus,
          metric_key: metric.metricKey,
          name: metric.name,
          previous: metric.previous,
          release_stage: metric.releaseStage,
          released: metric.released,
          unit: metric.unit,
        })),
        mode: "backfill",
        observation_fingerprint: observation.observationFingerprint,
        policy_subcategory: observation.policySubcategory,
        provider: "fmp",
        raw_checksum: observation.rawChecksum,
        raw_payload: observation.rawPayload,
        request_from: observation.requestFrom,
        request_to: observation.requestTo,
        run_id: observation.runId,
        schedule_confidence: observation.scheduleConfidence,
        source_agency: observation.sourceAgency,
        source_event_key: observation.sourceEventKey,
        source_name: observation.sourceName,
        time_status: observation.timeStatus,
        title: observation.title,
      },
    },
  );
  if (!result.ok) {
    throw new Error("FMP economic Calendar observation could not be persisted.");
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
    throw new Error("FMP economic Calendar persistence returned invalid data.");
  }
  return {
    eventId,
    historyCreated: value?.history_created === true,
    revision,
    unchanged: value?.unchanged === true,
    upserted: value?.upserted === true,
  };
}
