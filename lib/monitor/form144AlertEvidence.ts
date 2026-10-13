import { createHash } from "node:crypto";
import { getReadyMonitorCondition } from "./conditionRegistry.ts";
import type { ListingMonitorCondition, ListingMonitorMatchResult } from "../listingMonitorMatcher.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";
import { safeSecEvidenceUrl, secondaryMonitorEvidenceSchema, type SecondaryMonitorEvidence } from "./secondaryMonitorEvidence.ts";

type RawReader = (rawItemId: string) => Promise<unknown>;

/** Called only during the original match. Uses exactly the row selected by production Matcher. */
export async function form144AlertEvidence(
  current: CurrentOwnershipReadResult,
  result: ListingMonitorMatchResult,
  conditions: readonly ListingMonitorCondition[],
  evaluatedAt: string,
  readRaw: RawReader = readRawPayload,
): Promise<SecondaryMonitorEvidence | undefined> {
  if (current.status !== "available" || current.form !== "form144" || result.status !== "match"
    || result.form144MatchedRowIndex === undefined) return undefined;
  const row = current.rows[result.form144MatchedRowIndex];
  if (!row || row.event_id !== current.eventId) return undefined;
  const provenance = record(row.provenance);
  const identity = record(provenance.issuer_identity);
  let companyName: string | null = null;
  // Reuse the preserved filing's company metadata, bound to the exact original XML.
  // No CIK lookup, security selection, analysis prose or provider call.
  try {
    const raw = record(await readRaw(current.rawItemId));
    if (raw.accession_number === current.accessionNumber && raw.form_type === current.filingForm
      && raw.ownership_source_url === provenance.source_url && typeof raw.ownership_source_text === "string"
      && createHash("sha256").update(raw.ownership_source_text).digest("hex") === provenance.source_xml_sha256
      && typeof raw.company_name === "string" && raw.company_name.trim().length > 0 && raw.company_name.length <= 500) {
      companyName = raw.company_name.trim();
    }
  } catch { /* A read failure is unknown identity, never an invented company. */ }
  const ticker = typeof row.symbol === "string" && row.symbol === identity.canonical_ticker
    && (row.symbol === identity.xml_ticker || row.symbol === identity.target_ticker)
    ? row.symbol : null;
  const saved = secondaryMonitorEvidenceSchema.safeParse({
    version: "secondary_monitor_evidence_v1", family: "form144",
    eventId: current.eventId, rawItemId: current.rawItemId, sourceExecutionId: current.sourceExecutionId,
    accessionNumber: current.accessionNumber, filingForm: current.filingForm,
    filedAt: current.filedAt || null, evaluatedAt, persistedAt: current.persistedAt,
    parserVersion: current.parserVersion, rowIndex: row.proposed_sale_index,
    sourceSha256: provenance.source_xml_sha256, companyName, ticker,
    sourceUrl: safeSecEvidenceUrl(provenance.source_url, current.accessionNumber),
    conditions: conditions.map(condition => {
      const definition = getReadyMonitorCondition(String(condition.key));
      const actual = definition?.domain === "form144" && definition.source.column
        ? row[definition.source.column] : undefined;
      const stored = typeof actual === "string" || typeof actual === "number" || typeof actual === "boolean";
      return {
        key: condition.key, label: definition?.display?.label || condition.key,
        operator: condition.operator, expected: condition.value,
        fact: stored ? actual : null, factStatus: stored ? "stored" : "not_preserved",
      };
    }),
  });
  return saved.success ? saved.data : undefined;
}

async function readRawPayload(rawItemId: string): Promise<unknown> {
  const { supabaseSelect } = await import("../supabase.ts");
  const response = await supabaseSelect("raw_items", { id: `eq.${rawItemId}`, select: "raw_payload", limit: "1" });
  if (!response.ok || !Array.isArray(response.data)) return null;
  return record(response.data[0]).raw_payload;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
