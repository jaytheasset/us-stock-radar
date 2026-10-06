import "server-only";
import { SecStructuredHttpClient } from "./httpClient.ts";
import { normalizeCik } from "./normalization.ts";
import { normalizeMainSubmissions } from "./mainSubmissions.ts";
import type { SecSubmissionsRefreshRepository } from "./types.ts";

/** Dedicated, idle managed connection required. No caller-owned transaction.
 * This entry point performs HTTP itself; archived documents cannot establish freshness.
 * Transport/clock injection is for isolated verification, not a replay entry point.
 */
export class SecSubmissionsRefreshService {
  private readonly repository: SecSubmissionsRefreshRepository;
  private readonly http: SecStructuredHttpClient;
  private readonly now: () => Date;

  constructor(repository: SecSubmissionsRefreshRepository, userAgent: string, options: {
    fetchImplementation?: typeof fetch;
    now?: () => Date;
  } = {}) {
    this.repository = repository;
    this.now = options.now ?? (() => new Date());
    this.http = new SecStructuredHttpClient(userAgent, 125, options.fetchImplementation ?? fetch, this.now);
  }

  async refreshIssuerSubmissions(input: { cik: string }) {
    const cik = normalizeCik(input.cik);
    // Autocommitted sequence allocation finishes before any network wait.
    const refreshSequence = await this.repository.allocateSubmissionsRefreshSequence();
    const documents = await this.http.fetchSubmissions(cik, "incremental");
    const batch = normalizeMainSubmissions(documents, cik, this.now().toISOString());
    const confirmation = {
      cik, sourceRawId: batch.rawSources[0].id, refreshSequence,
      confirmedAt: this.now().toISOString(),
    };
    const result = await this.repository.ingestSubmissionsRefresh(batch, confirmation);
    return { ...result, confirmation };
  }
}
