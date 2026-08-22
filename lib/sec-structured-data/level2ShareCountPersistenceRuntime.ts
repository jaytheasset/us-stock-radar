import { supabaseUpsert } from "../supabase.ts";
import {
  toShareCountHistoryDatabaseRow,
  type ShareCountHistoryRepository,
} from "./shareCountHistory.ts";
import {
  writeLevel2ShareCountObservation,
  type Level2ShareCountValidatedCandidate,
} from "./level2ShareCountObservation.ts";

const LEVEL2_HISTORY_CONFLICT_COLUMNS = [
  "source_type",
  "issuer_cik",
  "accession_number",
  "filing_document",
  "source_content_hash",
  "source_fact_key",
  "source_context_ref",
].join(",");

export async function persistLevel2ShareCountObservationFromSecRawItem(input: {
  candidate: Level2ShareCountValidatedCandidate;
  rawItem: Record<string, unknown>;
  eventId: string;
  rawItemId: string;
  parentPrimaryAiRunId: string;
  sourceExecutionId: string;
  analyzerKey: string;
  now?: string;
}) {
  const rawPayload = record(input.rawItem.raw_payload) || {};
  const metadata = record(input.rawItem.metadata) || {};
  const issuerCik = normalizeCik(
    stringValue(rawPayload.cik) || stringValue(metadata.cik),
  );
  const form = stringValue(rawPayload.form_type) || stringValue(metadata.form_type);
  const acceptedAt = normalizeTimestamp(stringValue(input.rawItem.published_at));
  const filedDate = normalizeDate(
    stringValue(rawPayload.filing_date)
      || stringValue(rawPayload.filed_at)
      || stringValue(metadata.filing_date)
      || acceptedAt,
  );
  const ingestedAt = normalizeTimestamp(input.now || new Date().toISOString());
  const repository: ShareCountHistoryRepository = {
    async insertObservation(observation) {
      const result = await supabaseUpsert(
        "share_count_history",
        toShareCountHistoryDatabaseRow(observation),
        {
          onConflict: LEVEL2_HISTORY_CONFLICT_COLUMNS,
          prefer: "resolution=ignore-duplicates,return=representation",
        },
      );
      if (!result.ok) {
        throw new Error(`Level 2 share-count persistence failed: ${result.error || result.status}`);
      }
      return Array.isArray(result.data) && result.data.length === 1;
    },
    async readHistory() {
      throw new Error("Level 2 runtime repository is write-only");
    },
  };
  return writeLevel2ShareCountObservation({
    repository,
    candidate: input.candidate,
    context: {
      issuerCik,
      form,
      filedDate,
      acceptedAt,
      ingestedAt,
      rawItemId: input.rawItemId,
      eventId: input.eventId,
      parentPrimaryAiRunId: input.parentPrimaryAiRunId,
      sourceExecutionId: input.sourceExecutionId,
      analyzerKey: input.analyzerKey,
    },
  });
}

function normalizeCik(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/^0+/, "").padStart(10, "0");
}

function normalizeTimestamp(value: string) {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.valueOf())) return "";
  return parsed.toISOString();
}

function normalizeDate(value: string) {
  const match = value.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  return match?.[1] || "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
