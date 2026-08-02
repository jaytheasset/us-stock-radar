import {
  normalizeAnalysisTicker,
  type AnalysisPeerCandidate,
  type AnalysisPeerFillerBucket,
  type AnalysisPeerFillerBuckets,
} from "./analysisPeerSelection.ts";
import {
  resolveCanonicalMarketGroup,
  resolveFmpIndustriesForMarketGroup,
} from "./taxonomyRegistry.ts";

export const ANALYSIS_PEER_PROVIDER_MAX_REQUESTS = 3;
export const ANALYSIS_PEER_PROVIDER_RESULT_LIMIT = 40;

export type AnalysisPeerProviderClassification = {
  industry: string;
  sector: string;
  subTheme: string;
  themeGroup: string;
};

export type AnalysisPeerProviderFilter = {
  bucket: AnalysisPeerFillerBucket;
  industry?: string;
  sector?: string;
};

export type AnalysisPeerProviderCompany = {
  companyName: string;
  exchange: string;
  symbol: string;
};

export function buildAnalysisPeerProviderFilters(
  classification: AnalysisPeerProviderClassification,
) {
  const filters: AnalysisPeerProviderFilter[] = [];
  const seen = new Set<string>();
  const appendIndustries = (
    bucket: AnalysisPeerFillerBucket,
    value: string,
  ) => {
    for (const industry of resolveFmpIndustriesForMarketGroup(value).slice(0, 1)) {
      const key = `industry:${normalizeFilterValue(industry)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filters.push({ bucket, industry });
    }
  };

  appendIndustries("sub_theme", classification.subTheme);
  appendIndustries("theme", classification.themeGroup);
  appendIndustries("industry_group", classification.industry);

  const sector =
    resolveCanonicalMarketGroup(classification.sector)?.sector ||
    resolveCanonicalMarketGroup(classification.industry)?.sector ||
    classification.sector.trim();
  if (sector) {
    const key = `sector:${normalizeFilterValue(sector)}`;
    if (!seen.has(key)) filters.push({ bucket: "sector", sector });
  }

  return filters.slice(0, ANALYSIS_PEER_PROVIDER_MAX_REQUESTS);
}

export function normalizeAnalysisPeerProviderRows(
  value: unknown,
  bucket: AnalysisPeerFillerBucket,
): AnalysisPeerCandidate[] {
  if (!Array.isArray(value)) return [];

  return value
    .flatMap((item) => {
      const row = recordValue(item);
      if (!row) return [];
      const symbol = normalizeAnalysisTicker(stringValue(row.symbol));
      const companyName = stringValue(row.companyName || row.name);
      const exchange = normalizeUsExchange(
        stringValue(row.exchangeShortName || row.exchange),
      );
      const marketCap = numberValue(row.marketCap);
      const price = numberValue(row.price);
      if (
        !symbol ||
        !companyName ||
        !exchange ||
        row.isActivelyTrading === false ||
        row.isEtf === true ||
        row.isFund === true ||
        !Number.isFinite(marketCap) ||
        marketCap <= 0 ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return [];
      }

      return [{
        candidate: {
          companyName,
          exchange,
          fillerBucket: bucket,
          source: "filler" as const,
          symbol,
        },
        marketCap,
      }];
    })
    .sort((left, right) =>
      right.marketCap - left.marketCap ||
      left.candidate.symbol.localeCompare(right.candidate.symbol),
    )
    .map((item) => item.candidate);
}

export function normalizeAnalysisPeerProviderCompanies(
  value: unknown,
): AnalysisPeerProviderCompany[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = recordValue(item);
    if (!row) return [];
    const symbol = normalizeAnalysisTicker(stringValue(row.symbol));
    const companyName = stringValue(row.companyName || row.name);
    const exchange = normalizeUsExchange(
      stringValue(row.exchangeShortName || row.exchange),
    );
    return symbol && companyName && exchange
      ? [{ companyName, exchange, symbol }]
      : [];
  });
}

export function mergeProviderFillerCandidate(
  buckets: AnalysisPeerFillerBuckets,
  candidate: AnalysisPeerCandidate,
) {
  const bucket = candidate.fillerBucket;
  if (!bucket) return;
  (buckets[bucket] ||= []).push(candidate);
}

export function analysisPeerProviderFilterKey(
  filter: AnalysisPeerProviderFilter,
) {
  return filter.industry
    ? `industry:${normalizeFilterValue(filter.industry)}`
    : `sector:${normalizeFilterValue(filter.sector || "")}`;
}

function normalizeUsExchange(value: string) {
  const normalized = value.toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.includes("NASDAQ")) return "NASDAQ";
  if (normalized === "NYSE" || normalized.includes("NEWYORKSTOCKEXCHANGE")) {
    return "NYSE";
  }
  if (
    normalized === "AMEX" ||
    normalized.includes("NYSEAMERICAN") ||
    normalized.includes("AMERICANSTOCKEXCHANGE")
  ) {
    return "AMEX";
  }
  return "";
}

function normalizeFilterValue(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}
