export const SEC_STRUCTURED_SOURCE_KINDS = ["submissions", "companyfacts", "filing_xbrl"] as const;
export type SecStructuredSourceKind = (typeof SEC_STRUCTURED_SOURCE_KINDS)[number];

export type SecRefreshMode = "bootstrap" | "backfill" | "incremental";

export type SecStructuredSourceDocument = {
  sourceKind: "submissions" | "companyfacts";
  sourceUrl: string;
  sourceIdentity: string;
  cik: string;
  fetchedAt: string;
  sourceSchemaVersion?: string | null;
  payload: unknown;
  rawBody?: string | null;
  rawBodyKind?: "authoritative_http_body" | "injected_exact_body" | null;
};

export type SecRawSourceRow = {
  id: string;
  sourceKind: SecStructuredSourceKind;
  sourceUrl: string;
  sourceIdentity: string;
  cik: string;
  fetchedAt: string;
  ingestedAt: string;
  contentHash: string;
  sourceSchemaVersion: string | null;
  rawContentKind: "authoritative_http_body" | "injected_exact_body" | "canonical_fixture_json";
  rawContent: string;
  payload: Record<string, unknown>;
  numericLexemes: ReadonlyMap<string, string> | null;
};

export type SecIssuerRow = { cik: string; createdAt: string };

export type SecIssuerObservationRow = {
  issuerCik: string;
  entityName: string;
  sourceRawId: string;
  sourceKind: "submissions";
  observedAt: string;
  ingestedAt: string;
};

export type SecTickerObservationRow = {
  issuerCik: string;
  ticker: string;
  exchange: string;
  sourceRawId: string;
  sourceKind: "submissions";
  observedAt: string;
  ingestedAt: string;
};

export type SecFilingRow = {
  accessionNumber: string;
  issuerCik: string;
  form: string;
  filedDate: string;
  acceptedAt: string | null;
  reportDate: string | null;
  primaryDocument: string | null;
  isXbrl: boolean | null;
  isInlineXbrl: boolean | null;
  sourceRawId: string;
  sourceKind: "submissions";
  ingestedAt: string;
};

export type SecCompanyFactRow = {
  sourceFactKey: string;
  sourceFactPath: string;
  issuerCik: string;
  filingAccession: string;
  form: string;
  filedDate: string;
  sourceRawId: string;
  sourceKind: "companyfacts";
  contextKind: "companyfacts_implicit";
  taxonomy: string;
  concept: string;
  unit: string;
  valueKind: "numeric" | "text";
  valueNumeric: string | null;
  valueText: string | null;
  instantDate: string | null;
  startDate: string | null;
  endDate: string | null;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
  frame: string | null;
  ingestedAt: string;
};

export type SecNormalizationRejection = {
  sourceIdentity: string;
  sourceFactPath: string | null;
  reason: string;
};

export type SecNormalizedBatch = {
  rawSources: SecRawSourceRow[];
  issuers: SecIssuerRow[];
  issuerObservations: SecIssuerObservationRow[];
  tickerObservations: SecTickerObservationRow[];
  filings: SecFilingRow[];
  facts: SecCompanyFactRow[];
  rejections: SecNormalizationRejection[];
};

export type SecRepositoryWriteCounts = {
  inserted: number;
  updated: number;
  deduped: number;
  rawSourcesInserted: number;
  issuersInserted: number;
  issuerObservationsInserted: number;
  tickerObservationsInserted: number;
  filingsInserted: number;
  filingsUpdated: number;
  factsInserted: number;
  insertedRawSourceIds: string[];
};

export type SecIssuerIngestResult = SecRepositoryWriteCounts & {
  cik: string;
  mode: SecRefreshMode;
  sourceUpdates: {
    submissions: SecSourceUpdateCounts;
    companyFacts: SecSourceUpdateCounts;
  };
  rejected: number;
  rejectionReasons: Record<string, number>;
  sourceDocuments: number;
  normalizedFacts: number;
};

export type SecSourceUpdateCounts = {
  fetched: number;
  updated: number;
  unchanged: number;
};

export interface SecStructuredSourceClient {
  fetchSubmissions(cik: string, mode: SecRefreshMode): Promise<SecStructuredSourceDocument[]>;
  fetchCompanyFacts(cik: string, mode: SecRefreshMode): Promise<SecStructuredSourceDocument>;
}

export type SecFactReadFilter = {
  cik: string;
  taxonomy?: string | null;
  concept?: string | null;
  unit?: string | null;
  form?: string | null;
  instantDateAfter?: string | null;
  limit?: number;
};

export type SecFilingReadFilter = {
  acceptedAfter?: string | null;
};

export interface SecStructuredRepository {
  ingestBatch(batch: SecNormalizedBatch): Promise<SecRepositoryWriteCounts>;
  readIssuerTickers(cik: string): Promise<SecTickerObservationRow[]>;
  readFilings(cik: string, limit?: number, filter?: SecFilingReadFilter): Promise<SecFilingRow[]>;
  readFacts(filter: SecFactReadFilter): Promise<SecCompanyFactRow[]>;
}
