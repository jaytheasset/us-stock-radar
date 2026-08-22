import { supabaseSelect, supabaseUpsert } from "../supabase.ts";
import {
  toShareCountHistoryDatabaseRow,
  type ShareCountHistoryRepository,
} from "./shareCountHistory.ts";
import {
  writeLevel2ShareCountObservation,
  type Level2ShareCountValidatedCandidate,
} from "./level2ShareCountObservation.ts";
import { resolveLevel2SecAcceptanceTimestamp } from "./shareCountAcceptanceTimestamp.ts";
import { canonicalSecurityClassSupportsFromDatabaseRows } from "./shareCountSecurityIdentity.ts";

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
  const accepted = resolveLevel2SecAcceptanceTimestamp({
    rawAcceptedAt: rawPayload.accepted_at,
    publishedAt: input.rawItem.published_at,
    filedDate: rawPayload.filing_date ?? rawPayload.filed_at,
    accessionNumber: input.candidate.accessionNumber,
    rawItemId: input.rawItemId,
  });
  const { acceptedAt, acceptedAtSource, acceptedAtProvenance } = accepted;
  const filedDate = normalizeDate(
    stringValue(rawPayload.filing_date)
      || stringValue(rawPayload.filed_at)
      || stringValue(metadata.filing_date),
  );
  const ingestedAt = normalizeTimestamp(input.now || new Date().toISOString());
  const supportResult = await supabaseSelect("share_count_history", {
    select: "id,issuer_cik,source_type,canonical_security_class_id,canonical_security_class_kind,canonical_security_class_status,security_class_basis,source_fact_key,accession_number",
    issuer_cik: `eq.${issuerCik}`,
    source_type: "eq.sec_authoritative_os",
    canonical_security_class_status: "eq.mapped",
    limit: "1000",
  });
  if (!supportResult.ok || !Array.isArray(supportResult.data)) {
    throw new Error(`Level 2 canonical security-class evidence read failed: ${supportResult.error || supportResult.status}`);
  }
  const canonicalSecurityClassSupports = canonicalSecurityClassSupportsFromDatabaseRows(
    supportResult.data as Record<string, unknown>[],
    issuerCik,
  );
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
      acceptedAtSource,
      acceptedAtProvenance,
      ingestedAt,
      rawItemId: input.rawItemId,
      eventId: input.eventId,
      parentPrimaryAiRunId: input.parentPrimaryAiRunId,
      sourceExecutionId: input.sourceExecutionId,
      analyzerKey: input.analyzerKey,
      canonicalSecurityClassSupports,
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
