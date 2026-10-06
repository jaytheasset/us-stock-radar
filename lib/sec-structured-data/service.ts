import { normalizeCik, normalizeSecStructuredDocuments } from "./normalization.ts";
import type {
  SecIssuerIngestResult,
  SecIssuerSubmissionsIngestResult,
  SecRefreshMode,
  SecStructuredRepository,
  SecStructuredSourceClient,
  SecStructuredSourceDocument,
} from "./types.ts";

export class SecStructuredDataService {
  private readonly sourceClient: SecStructuredSourceClient;
  private readonly repository: SecStructuredRepository;
  private readonly now: () => Date;

  constructor(
    sourceClient: SecStructuredSourceClient,
    repository: SecStructuredRepository,
    now: () => Date = () => new Date(),
  ) {
    this.sourceClient = sourceClient;
    this.repository = repository;
    this.now = now;
  }

  /** Explicit server-side ingestion only; no reader, scheduler or O/S connection. */
  async ingestIssuerSubmissions(input: { cik: string }): Promise<SecIssuerSubmissionsIngestResult> {
    const cik = normalizeCik(input.cik);
    const documents = await this.sourceClient.fetchSubmissions(cik, "incremental");
    if (documents.length !== 1) throw new Error("expected_one_main_submissions_document");
    validateMainSubmissions(documents[0], cik);
    const normalized = normalizeSecStructuredDocuments(documents, this.now().toISOString());
    if (normalized.rejections.length || normalized.rawSources.length !== 1 ||
        normalized.issuerObservations.length !== 1 || normalized.facts.length !== 0) {
      throw new Error(`invalid_main_submissions: ${normalized.rejections.map((item) => item.reason).join(",") || "not_accepted"}`);
    }
    const counts = await this.repository.ingestBatch(normalized);
    return {
      cik, mode: "incremental", ...counts,
      sourceUpdates: { submissions: sourceUpdateCounts("submissions", 1, normalized.rawSources, new Set(counts.insertedRawSourceIds)) },
      sourceDocuments: 1, normalizedFacts: 0, rejected: 0,
    };
  }

  async ingestIssuer(input: { cik: string; mode: SecRefreshMode }): Promise<SecIssuerIngestResult> {
    const cik = normalizeCik(input.cik);
    const [submissions, companyFacts] = await Promise.all([
      this.sourceClient.fetchSubmissions(cik, input.mode),
      this.sourceClient.fetchCompanyFacts(cik, input.mode),
    ]);
    const documents = [...submissions, companyFacts];
    const normalized = normalizeSecStructuredDocuments(documents, this.now().toISOString());
    const counts = await this.repository.ingestBatch(normalized);
    const insertedRawSourceIds = new Set(counts.insertedRawSourceIds);
    const sourceUpdates = {
      submissions: sourceUpdateCounts("submissions", submissions.length, normalized.rawSources, insertedRawSourceIds),
      companyFacts: sourceUpdateCounts("companyfacts", 1, normalized.rawSources, insertedRawSourceIds),
    };
    const rejectionReasons: Record<string, number> = {};
    for (const item of normalized.rejections) rejectionReasons[item.reason] = (rejectionReasons[item.reason] ?? 0) + 1;
    return {
      cik,
      mode: input.mode,
      sourceUpdates,
      ...counts,
      rejected: normalized.rejections.length,
      rejectionReasons,
      sourceDocuments: documents.length,
      normalizedFacts: normalized.facts.length,
    };
  }
}

function validateMainSubmissions(document: SecStructuredSourceDocument, cik: string) {
  const mainUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  if (document.sourceKind !== "submissions" || normalizeCik(document.cik) !== cik ||
      document.sourceUrl !== mainUrl || document.sourceIdentity !== mainUrl) {
    throw new Error("main_submissions_identity_mismatch");
  }
  if (typeof document.rawBody !== "string" || !document.rawBody.trim()) {
    throw new Error("missing_main_submissions_body");
  }
  const payload = sourceRecord(document.payload);
  if (!payload || normalizeCik(payload.cik) !== cik) throw new Error("main_submissions_cik_mismatch");
  const recent = sourceRecord(sourceRecord(payload.filings)?.recent);
  if (typeof payload.name !== "string" || !payload.name.trim() ||
      !Array.isArray(payload.tickers) || !Array.isArray(payload.exchanges) || !recent ||
      !Array.isArray(recent.accessionNumber)) {
    throw new Error("invalid_main_submissions_structure");
  }
  // Require complete parallel ledger arrays; never truncate or infer missing entries.
  for (const field of ["form", "filingDate"]) {
    if (!Array.isArray(recent[field]) || recent[field].length !== recent.accessionNumber.length) {
      throw new Error("invalid_main_submissions_filing_arrays");
    }
  }
  for (const value of Object.values(recent)) {
    if (!Array.isArray(value) || value.length !== recent.accessionNumber.length) {
      throw new Error("invalid_main_submissions_filing_arrays");
    }
  }
}

function sourceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function sourceUpdateCounts(
  sourceKind: "submissions" | "companyfacts",
  fetched: number,
  normalized: readonly { id: string; sourceKind: string }[],
  insertedRawSourceIds: ReadonlySet<string>,
) {
  const accepted = normalized.filter((row) => row.sourceKind === sourceKind);
  const updated = accepted.filter((row) => insertedRawSourceIds.has(row.id)).length;
  return { fetched, updated, unchanged: Math.max(0, accepted.length - updated) };
}
