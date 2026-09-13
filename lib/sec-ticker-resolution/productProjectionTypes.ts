export type SecTickerSourceFiling = Readonly<{
  accessionNumber: string;
  acceptedAt: string;
  currentTicker: string;
  detailHref: string;
  exchange: string;
  filedDate: string;
  formType: string;
  historicalTicker: string;
  issuerCik: string;
  securityTitle: string;
  sourceDocument: string;
  sourceUrl: string;
}>;

export type SecTickerProductProjection = Readonly<{
  currentTicker: string;
  historicalTickers: readonly string[];
  issuerCik: string;
  sourceFilings: readonly SecTickerSourceFiling[];
  status: "available";
}>;

export type SecTickerProductProjectionReadResult =
  | SecTickerProductProjection
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "unavailable"; reason: string }>;

export function parseSecTickerSourceFilingsPayload(value: unknown): SecTickerSourceFiling[] {
  const payload = record(value);
  if (payload.ok !== true || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item) => {
    const row = record(item);
    const accessionNumber = stringValue(row.accessionNumber);
    const acceptedAt = stringValue(row.acceptedAt);
    const currentTicker = normalizeTicker(row.currentTicker);
    const detailHref = stringValue(row.detailHref);
    const exchange = stringValue(row.exchange);
    const filedDate = stringValue(row.filedDate);
    const formType = stringValue(row.formType);
    const historicalTicker = normalizeTicker(row.historicalTicker);
    const issuerCik = stringValue(row.issuerCik);
    const securityTitle = stringValue(row.securityTitle);
    const sourceDocument = stringValue(row.sourceDocument);
    const sourceUrl = safeSecUrl(row.sourceUrl);
    if (
      !/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber) ||
      Number.isNaN(Date.parse(acceptedAt)) || !currentTicker ||
      !/^\/filings\/source\/[0-9a-f-]{36}\/(before|after)$/.test(detailHref) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(filedDate) || !formType ||
      !historicalTicker || !/^\d{10}$/.test(issuerCik) || !securityTitle ||
      !sourceDocument || !sourceUrl
    ) return [];
    return [{
      accessionNumber,
      acceptedAt,
      currentTicker,
      detailHref,
      exchange,
      filedDate,
      formType,
      historicalTicker,
      issuerCik,
      securityTitle,
      sourceDocument,
      sourceUrl,
    }];
  });
}

function safeSecUrl(value: unknown) {
  const text = stringValue(value);
  try {
    const url = new URL(text);
    return url.protocol === "https:" &&
      (url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov")) &&
      url.pathname.startsWith("/Archives/edgar/data/")
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function normalizeTicker(value: unknown) {
  const ticker = stringValue(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
