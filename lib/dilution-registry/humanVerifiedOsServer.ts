import "server-only";

import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";
import {
  mapSecFilingArtifactDatabaseRow,
  type SecFilingXbrlArtifactRepository,
  type SecFilingXbrlRawArtifact,
} from "@/lib/sec-structured-data/filingXbrlContext";
import {
  mapIssuerCommonClassUniverseDatabaseRow,
  type IssuerCommonClassUniverseReadFilter,
  type IssuerCommonClassUniverseRepository,
} from "@/lib/sec-structured-data/issuerCommonClassUniverse";
import {
  writeHumanVerifiedShareCountObservation,
  type HumanVerifiedShareCountApproval,
  type HumanVerifiedSecFilingLedger,
} from "@/lib/sec-structured-data/humanVerifiedShareCountObservation";
import {
  mapShareCountHistoryDatabaseRow,
  toShareCountHistoryDatabaseRow,
  type ShareCountHistoryObservation,
  type ShareCountHistoryReadFilter,
  type ShareCountHistoryRepository,
} from "@/lib/sec-structured-data/shareCountHistory";
import type { DilutionRegistryPayload } from "./preview";
import { readDilutionRegistryOsSourceBundle } from "./osPreviewServer";

const HISTORY_SELECT = [
  "id", "observation_type", "issuer_cik", "shares_outstanding", "as_of",
  "security_class_basis", "security_class_identity", "security_class_metadata",
  "canonical_security_class_id", "canonical_security_class_kind",
  "canonical_security_class_status", "canonical_security_class_provenance",
  "share_basis_identity", "share_basis_metadata", "accession_number", "form",
  "filing_document", "filed_date", "accepted_at", "accepted_at_source",
  "accepted_at_provenance", "ingested_at", "source_concept_namespace_uri",
  "source_concept_local_name", "source_fact_key", "source_context_ref",
  "source_artifact_id", "filing_ledger_raw_source_id", "source_fact_identity",
  "source_context", "source_dimensions", "source_provenance", "source_type",
  "authoritative_status", "authoritative_decision_version",
  "authoritative_decision_reason", "authoritative_decision_lineage",
  "source_document_url", "source_content_hash", "source_evidence",
  "source_analyzer", "created_at",
  "snapshot_publication_valid",
].join(",");

const UNIVERSE_SELECT = [
  "id", "snapshot_version", "issuer_cik", "universe_as_of", "accepted_at",
  "source_accession", "source_form", "source_filed_date", "source_documents",
  "status", "reason", "required_canonical_security_class_ids", "class_evidence",
  "aggregate_evidence", "excluded_evidence", "completeness_provenance",
  "source_identity_hash", "created_at",
].join(",");

const ARTIFACT_SELECT = [
  "id", "cik", "source_url", "source_identity", "fetched_at", "content_hash",
  "raw_content_kind", "raw_content", "payload",
].join(",");

export async function applyHumanVerifiedOsOnServer(input: {
  payload: DilutionRegistryPayload;
  approval: HumanVerifiedShareCountApproval;
  ingestedAt: string;
}) {
  const historyRepository = new SupabaseShareCountHistoryRepository();
  const universeRepository = new SupabaseIssuerCommonClassUniverseRepository();
  const artifactRepository = new SupabaseSecFilingArtifactRepository();
  return writeHumanVerifiedShareCountObservation(input, {
    artifactRepository,
    historyRepository,
    universeRepository,
    readLedger: readExactFilingLedgerFromSupabase,
    readSourceBundle: readDilutionRegistryOsSourceBundle,
  });
}

class SupabaseShareCountHistoryRepository
implements ShareCountHistoryRepository {
  async insertObservation(observation: ShareCountHistoryObservation) {
    const result = await supabaseUpsert(
      "share_count_history",
      toShareCountHistoryDatabaseRow(observation),
      {
        onConflict: [
          "source_type", "issuer_cik", "accession_number", "filing_document",
          "source_content_hash", "source_fact_key", "source_context_ref",
        ].join(","),
        prefer: "resolution=ignore-duplicates,return=representation",
      },
    );
    if (!result.ok) throw new Error("share_count_history insert failed");
    return rows(result.data).length === 1;
  }

  async readHistory(cik: string, filter: ShareCountHistoryReadFilter = {}) {
    const search: Record<string, string> = {
      issuer_cik: `eq.${cik}`,
      limit: "1000",
      order: "as_of.asc,accepted_at.asc,accession_number.asc,id.asc",
      select: HISTORY_SELECT,
    };
    if (filter.asOfFrom) search.as_of = `gte.${filter.asOfFrom}`;
    if (filter.asOfTo) search.as_of = `lte.${filter.asOfTo}`;
    if (filter.asOfFrom && filter.asOfTo) {
      search.and = `(as_of.gte.${filter.asOfFrom},as_of.lte.${filter.asOfTo})`;
      delete search.as_of;
    }
    if (filter.securityClassCanonicalKey) {
      search["security_class_identity->>canonicalKey"] =
        `eq.${filter.securityClassCanonicalKey}`;
    }
    if (filter.canonicalSecurityClassId) {
      search.canonical_security_class_id = `eq.${filter.canonicalSecurityClassId}`;
    }
    const result = await supabaseSelect("share_count_history_eligible", search);
    if (!result.ok) throw new Error("share_count_history read failed");
    return rows(result.data).map(mapShareCountHistoryDatabaseRow);
  }
}

class SupabaseIssuerCommonClassUniverseRepository
implements IssuerCommonClassUniverseRepository {
  async insertSnapshot(): Promise<boolean> {
    throw new Error("Admin O/S Apply does not create class-universe snapshots");
  }

  async readSnapshots(cik: string, filter: IssuerCommonClassUniverseReadFilter = {}) {
    const search: Record<string, string> = {
      issuer_cik: `eq.${cik}`,
      limit: "1000",
      order: "universe_as_of.asc,accepted_at.asc,source_accession.asc,source_identity_hash.asc",
      select: UNIVERSE_SELECT,
    };
    if (filter.universeAsOfTo) search.universe_as_of = `lte.${filter.universeAsOfTo}`;
    if (filter.acceptedAtTo) search.accepted_at = `lte.${filter.acceptedAtTo}`;
    const result = await supabaseSelect(
      "issuer_common_class_universe_snapshots",
      search,
    );
    if (!result.ok) throw new Error("class-universe read failed");
    return rows(result.data).map(mapIssuerCommonClassUniverseDatabaseRow);
  }
}

class SupabaseSecFilingArtifactRepository
implements SecFilingXbrlArtifactRepository {
  async ingestArtifacts(artifacts: readonly SecFilingXbrlRawArtifact[]) {
    let inserted = 0;
    for (const artifact of artifacts) {
      const result = await supabaseUpsert(
        "sec_structured_raw_sources",
        {
          id: artifact.id,
          source_kind: "filing_xbrl",
          source_url: artifact.sourceUrl,
          source_identity: artifact.sourceIdentity,
          cik: artifact.issuerCik,
          fetched_at: artifact.fetchedAt,
          ingested_at: artifact.fetchedAt,
          content_hash: artifact.contentHash,
          source_schema_version: "filing-xbrl-context-v1",
          raw_content_kind: artifact.rawContentKind,
          raw_content: artifact.rawContent,
          payload: {
            accession: artifact.accession,
            role: artifact.role,
            document_name: artifact.documentName,
            content_type: artifact.contentType,
          },
        },
        {
          onConflict: "source_kind,source_identity,content_hash",
          prefer: "resolution=ignore-duplicates,return=representation",
        },
      );
      if (!result.ok) throw new Error("SEC artifact insert failed");
      inserted += rows(result.data).length;
    }
    return { inserted, deduped: artifacts.length - inserted };
  }

  async readArtifacts(issuerCik: string, accession: string) {
    const result = await supabaseSelect("sec_structured_raw_sources", {
      cik: `eq.${issuerCik}`,
      limit: "100",
      order: "source_url.asc,content_hash.asc",
      "payload->>accession": `eq.${accession}`,
      select: ARTIFACT_SELECT,
      source_kind: "eq.filing_xbrl",
    });
    if (!result.ok) throw new Error("SEC artifact read failed");
    return rows(result.data).map(mapSecFilingArtifactDatabaseRow);
  }
}

async function readExactFilingLedgerFromSupabase(
  accessionNumber: string,
): Promise<HumanVerifiedSecFilingLedger | null> {
  const result = await supabaseSelect("sec_filing_ledger", {
    accession_number: `eq.${accessionNumber}`,
    limit: "2",
    select: [
      "issuer_cik", "accession_number", "form", "filed_date", "accepted_at",
      "primary_document", "source_raw_id",
    ].join(","),
  });
  if (!result.ok) throw new Error("SEC filing-ledger read failed");
  const values = rows(result.data);
  if (values.length !== 1) return null;
  const row = values[0]!;
  const ledger = {
    issuerCik: text(row.issuer_cik),
    accessionNumber: text(row.accession_number),
    form: text(row.form),
    filedDate: text(row.filed_date),
    acceptedAt: timestamp(row.accepted_at),
    primaryDocument: text(row.primary_document),
    sourceRawId: text(row.source_raw_id),
  };
  return CIK_PATTERN.test(ledger.issuerCik)
    && ACCESSION_PATTERN.test(ledger.accessionNumber)
    && DATE_PATTERN.test(ledger.filedDate)
    && Boolean(ledger.acceptedAt)
    && UUID_PATTERN.test(ledger.sourceRawId)
    && ledger.form
    && ledger.primaryDocument
    && ledger.accessionNumber === accessionNumber
    ? ledger
    : null;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function timestamp(value: unknown) {
  const source = text(value);
  return source && !Number.isNaN(new Date(source).valueOf())
    ? new Date(source).toISOString()
    : "";
}

const CIK_PATTERN = /^[0-9]{10}$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
