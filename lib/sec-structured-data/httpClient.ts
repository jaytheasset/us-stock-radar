import { normalizeCik } from "./normalization.ts";
import { SecRequestPolicy } from "./secRequestPolicy.ts";
import type { SecRefreshMode, SecStructuredSourceClient, SecStructuredSourceDocument } from "./types.ts";

export class SecStructuredHttpError extends Error {
  readonly sourceKind: "submissions" | "companyfacts";
  readonly status: number;

  constructor(sourceKind: "submissions" | "companyfacts", status: number) {
    super(`SEC ${sourceKind} fetch failed (${status})`);
    this.name = "SecStructuredHttpError";
    this.sourceKind = sourceKind;
    this.status = status;
  }
}

export class SecStructuredHttpClient implements SecStructuredSourceClient {
  private readonly requestPolicy: SecRequestPolicy;
  private readonly now: () => Date;

  constructor(
    userAgent: string,
    minimumIntervalMs = 125,
    fetchImplementation: typeof fetch = fetch,
    now: () => Date = () => new Date(),
    requestPolicy?: SecRequestPolicy,
  ) {
    this.requestPolicy = requestPolicy ?? new SecRequestPolicy(userAgent, { minimumIntervalMs, fetchImplementation });
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
    const response = await this.requestPolicy.fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new SecStructuredHttpError(sourceKind, response.status);
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
