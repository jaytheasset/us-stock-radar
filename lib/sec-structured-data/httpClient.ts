import { normalizeCik } from "./normalization.ts";
import type { SecRefreshMode, SecStructuredSourceClient, SecStructuredSourceDocument } from "./types.ts";

export class SecStructuredHttpClient implements SecStructuredSourceClient {
  private lastRequestAt = 0;
  private readonly userAgent: string;
  private readonly minimumIntervalMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;

  constructor(
    userAgent: string,
    minimumIntervalMs = 125,
    fetchImplementation: typeof fetch = fetch,
    now: () => Date = () => new Date(),
  ) {
    if (!userAgent.trim() || !(/@/.test(userAgent) || /https?:\/\//i.test(userAgent))) {
      throw new Error("SEC user agent must identify an organization and contact channel");
    }
    if (minimumIntervalMs < 100) throw new Error("SEC request interval must be at least 100ms");
    this.userAgent = userAgent;
    this.minimumIntervalMs = minimumIntervalMs;
    this.fetchImplementation = fetchImplementation;
    this.now = now;
  }

  async fetchSubmissions(cikInput: string, mode: SecRefreshMode) {
    const cik = normalizeCik(cikInput);
    const mainUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
    const main = await this.fetchDocument(mainUrl, "submissions", cik);
    if (mode === "incremental") return [main];
    const files = readHistoricalSubmissionFiles(main.payload);
    const historical: SecStructuredSourceDocument[] = [];
    for (const name of files) {
      historical.push(await this.fetchDocument(`https://data.sec.gov/submissions/${name}`, "submissions", cik));
    }
    return [main, ...historical];
  }

  async fetchCompanyFacts(cikInput: string, _mode: SecRefreshMode) {
    const cik = normalizeCik(cikInput);
    return this.fetchDocument(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, "companyfacts", cik);
  }

  private async fetchDocument(url: string, sourceKind: "submissions" | "companyfacts", cik: string) {
    await this.rateLimit();
    const response = await this.fetchImplementation(url, {
      headers: { Accept: "application/json", "User-Agent": this.userAgent },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`SEC ${sourceKind} fetch failed (${response.status})`);
    const rawBody = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new Error(`SEC ${sourceKind} response was not valid JSON`);
    }
    const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    return {
      sourceKind,
      sourceUrl: url,
      sourceIdentity: url,
      cik,
      fetchedAt: this.now().toISOString(),
      sourceSchemaVersion: typeof payloadRecord.schemaVersion === "string" ? payloadRecord.schemaVersion : null,
      payload,
      rawBody,
      rawBodyKind: "authoritative_http_body",
    } satisfies SecStructuredSourceDocument;
  }

  private async rateLimit() {
    const remaining = this.minimumIntervalMs - (Date.now() - this.lastRequestAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    this.lastRequestAt = Date.now();
  }
}

function readHistoricalSubmissionFiles(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const filings = (payload as Record<string, unknown>).filings;
  if (!filings || typeof filings !== "object" || Array.isArray(filings)) return [];
  const files = (filings as Record<string, unknown>).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const name = (value as Record<string, unknown>).name;
    return typeof name === "string" && /^CIK[0-9]{10}-submissions-[0-9]+\.json$/.test(name) ? [name] : [];
  });
}
