import { normalizeCik, normalizeSecStructuredDocuments } from "./normalization.ts";
import type {
  SecIssuerIngestResult,
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

  async ingestIssuer(input: { cik: string; mode: SecRefreshMode }): Promise<SecIssuerIngestResult> {
    const cik = normalizeCik(input.cik);
    const [submissions, companyFacts] = await Promise.all([
      this.sourceClient.fetchSubmissions(cik, input.mode),
      this.sourceClient.fetchCompanyFacts(cik, input.mode),
    ]);
    const documents = [...submissions, companyFacts];
    const normalized = normalizeSecStructuredDocuments(documents, this.now().toISOString());
    const counts = await this.repository.ingestBatch(normalized);
    const rejectionReasons: Record<string, number> = {};
    for (const item of normalized.rejections) rejectionReasons[item.reason] = (rejectionReasons[item.reason] ?? 0) + 1;
    return {
      cik,
      mode: input.mode,
      ...counts,
      rejected: normalized.rejections.length,
      rejectionReasons,
      sourceDocuments: documents.length,
      normalizedFacts: normalized.facts.length,
    };
  }
}
