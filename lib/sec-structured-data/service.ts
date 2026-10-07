import { normalizeMainSubmissions } from "./mainSubmissions.ts";
import { normalizeCik, normalizeSecStructuredDocuments } from "./normalization.ts";
import type {
  SecIssuerIngestResult,
  SecIssuerSubmissionsIngestResult,
  SecRefreshMode,
  SecStructuredRepository,
  SecStructuredSourceClient,
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
    const normalized = normalizeMainSubmissions(documents, cik, this.now().toISOString());
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
