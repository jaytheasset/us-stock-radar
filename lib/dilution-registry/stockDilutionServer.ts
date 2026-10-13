import { supabaseSelect } from "@/lib/supabase";
import {
  PostgresIssuerCommonClassUniverseRepository,
} from "@/lib/sec-structured-data/issuerCommonClassUniverse";
import { resolveIssuerTotalCommonSharesAt } from "@/lib/sec-structured-data/issuerTotalCommonSharesAggregator";
import {
  PostgresShareCountHistoryRepository,
  type ShareCountHistorySqlClient,
} from "@/lib/sec-structured-data/shareCountHistory";
import { buildStockDilutionSnapshot } from "./stockDilution";

const INSTRUMENT_SELECT = [
  "id",
  "instrument_key",
  "instrument_type",
  "name",
].join(",");

const SNAPSHOT_SELECT = [
  "id",
  "instrument_id",
  "as_of_date",
  "status",
  "original_amount",
  "remaining_amount",
  "interest_rate",
  "remaining_units",
  "original_capacity",
  "used_amount",
  "remaining_capacity",
  "shares_issued",
  "remaining_potential_shares",
  "conversion_price",
  "exercise_price",
  "price_formula",
  "available_date",
  "start_date",
  "end_date",
  "last_checked",
].join(",");

const CORPORATE_ACTION_ADJUSTMENT_SELECT = [
  "id",
  "projection_id",
  "instrument_id",
  "base_snapshot_id",
  "status",
  "review_reason",
  "effective_date",
  "execution_ids",
  "supersedes_projection_id",
  "adjusted_fields",
].join(",");

const ACTIVITY_SELECT = [
  "id",
  "instrument_id",
  "activity_type",
  "activity_date",
  "period_start",
  "period_end",
  "units_cancelled",
  "shares_issued",
  "details",
  "last_checked",
].join(",");

const TOTAL_SELECT = [
  "id",
  "instrument_type",
  "name",
  "total_shares",
  "other_shares",
  "as_of_date",
  "last_checked",
].join(",");

const SHARE_HISTORY_SELECT = [
  "id",
  "observation_type",
  "issuer_cik",
  "shares_outstanding",
  "as_of",
  "security_class_basis",
  "security_class_identity",
  "security_class_metadata",
  "canonical_security_class_id",
  "canonical_security_class_kind",
  "canonical_security_class_status",
  "canonical_security_class_provenance",
  "share_basis_identity",
  "share_basis_metadata",
  "accession_number",
  "form",
  "filing_document",
  "filed_date",
  "accepted_at",
  "accepted_at_source",
  "accepted_at_provenance",
  "ingested_at",
  "source_concept_namespace_uri",
  "source_concept_local_name",
  "source_fact_key",
  "source_context_ref",
  "source_artifact_id",
  "filing_ledger_raw_source_id",
  "source_fact_identity",
  "source_context",
  "source_dimensions",
  "source_provenance",
  "source_type",
  "authoritative_status",
  "authoritative_decision_version",
  "authoritative_decision_reason",
  "authoritative_decision_lineage",
  "source_document_url",
  "source_content_hash",
  "source_evidence",
  "source_analyzer",
  "snapshot_publication_valid",
  "os_correction",
  "created_at",
].join(",");

const UNIVERSE_SELECT = [
  "id",
  "snapshot_version",
  "issuer_cik",
  "universe_as_of",
  "accepted_at",
  "source_accession",
  "source_form",
  "source_filed_date",
  "source_documents",
  "status",
  "reason",
  "required_canonical_security_class_ids",
  "class_evidence",
  "aggregate_evidence",
  "excluded_evidence",
  "completeness_provenance",
  "source_identity_hash",
  "created_at",
].join(",");

export async function fetchStockDilution(
  symbolValue: string,
  options: { now?: Date } = {},
) {
  const symbol = normalizeSymbol(symbolValue);
  if (!symbol) return null;
  const tickerRows = await selectRows("sec_issuer_ticker_observations", {
    limit: "1",
    order: "observed_at.desc,id.desc",
    select: "issuer_cik",
    ticker: `eq.${symbol}`,
  });
  const issuerCik = readCik(tickerRows[0]?.issuer_cik);
  if (!issuerCik) return null;

  const instrumentRows = await selectRows("dilution_instruments", {
    issuer_cik: `eq.${issuerCik}`,
    limit: "100",
    order: "id.asc",
    select: INSTRUMENT_SELECT,
  });
  if (!instrumentRows.length) return null;
  const instrumentIds = instrumentRows.map((row) => String(row.id)).filter(Boolean);
  const now = options.now ?? new Date();
  const fetchedAt = now.toISOString();
  const [snapshotRows, adjustmentRows, activityRows, totalRows, outstanding] = await Promise.all([
    selectRows("dilution_instrument_snapshots", {
      instrument_id: `in.(${instrumentIds.join(",")})`,
      limit: "200",
      order: "as_of_date.desc,id.desc",
      select: SNAPSHOT_SELECT,
    }),
    selectRows("dilution_corporate_action_adjustments", {
      instrument_id: `in.(${instrumentIds.join(",")})`,
      limit: "500",
      order: "as_of_date.desc,effective_date.desc.nullslast,id.desc",
      select: CORPORATE_ACTION_ADJUSTMENT_SELECT,
    }),
    selectRows("dilution_instrument_activity", {
      issuer_cik: `eq.${issuerCik}`,
      limit: "100",
      order: "activity_date.desc.nullslast,id.desc",
      select: ACTIVITY_SELECT,
    }),
    selectRows("dilution_totals", {
      issuer_cik: `eq.${issuerCik}`,
      limit: "100",
      order: "as_of_date.desc.nullslast,id.desc",
      select: TOTAL_SELECT,
    }),
    resolveOutstanding(issuerCik, fetchedAt),
  ]);

  return buildStockDilutionSnapshot({
    adjustmentRows,
    activityRows,
    fetchedAt,
    instrumentRows,
    outstanding,
    snapshotRows,
    symbol,
    totalRows,
  });
}

async function resolveOutstanding(issuerCik: string, targetAt: string) {
  const client = new SupabaseShareCountReadClient();
  const result = await resolveIssuerTotalCommonSharesAt({
    cik: issuerCik,
    repository: new PostgresShareCountHistoryRepository(client),
    targetAt,
    universeRepository: new PostgresIssuerCommonClassUniverseRepository(client),
  });
  const shares = result.totalCommonShares?.integerShares;
  return result.status === "RESOLVED" && shares && result.universeAsOf
    ? { asOf: result.universeAsOf, shares }
    : null;
}

class SupabaseShareCountReadClient implements ShareCountHistorySqlClient {
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ) {
    if (!/^\s*select\b/i.test(text)) {
      throw new Error("The dilution O/S adapter is read only");
    }
    let rows: Record<string, unknown>[];
    if (/\bfrom\s+public\.share_count_history_eligible\b/i.test(text)) {
      const [cik, asOfFrom, asOfTo, classKey, classId, effectiveDates] = values;
      const dateField = effectiveDates === true ? "effective_as_of" : "as_of";
      const asOfFromText = readFilterValue(asOfFrom);
      const asOfToText = readFilterValue(asOfTo);
      rows = await selectRows("share_count_history_eligible", compactSearch({
        and: asOfFromText && asOfToText
          ? `(${dateField}.gte.${asOfFromText},${dateField}.lte.${asOfToText})`
          : "",
        [dateField]: asOfFromText
          ? `gte.${asOfFromText}`
          : asOfToText
            ? `lte.${asOfToText}`
            : "",
        canonical_security_class_id: equalityFilter(classId),
        issuer_cik: equalityFilter(cik),
        limit: "500",
        order: "as_of.asc,accepted_at.asc,accession_number.asc,id.asc",
        select: SHARE_HISTORY_SELECT,
        "security_class_identity->>canonicalKey": equalityFilter(classKey),
      }));
    } else if (/\bfrom\s+public\.issuer_common_class_universe_snapshots\b/i.test(text)) {
      const [cik, universeAsOfTo, acceptedAtTo] = values;
      rows = await selectRows("issuer_common_class_universe_snapshots", compactSearch({
        accepted_at: upperFilter(acceptedAtTo),
        issuer_cik: equalityFilter(cik),
        limit: "500",
        order: "universe_as_of.asc,accepted_at.asc,source_accession.asc,source_identity_hash.asc",
        select: UNIVERSE_SELECT,
        universe_as_of: upperFilter(universeAsOfTo),
      }));
    } else {
      throw new Error("Unsupported read-only O/S query");
    }
    return { rowCount: rows.length, rows: rows as Row[] };
  }
}

async function selectRows(table: string, search: Record<string, string>) {
  const result = await supabaseSelect(table, search);
  if (!result.ok || !Array.isArray(result.data)) {
    throw new Error(`Unable to read ${table}`);
  }
  return result.data.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
}

function compactSearch(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item));
}

function equalityFilter(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? `eq.${text}` : "";
}

function upperFilter(value: unknown) {
  const text = readFilterValue(value);
  return text ? `lte.${text}` : "";
}

function readFilterValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readCik(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return /^\d{10}$/.test(text) && text !== "0000000000" ? text : "";
}

function normalizeSymbol(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}
