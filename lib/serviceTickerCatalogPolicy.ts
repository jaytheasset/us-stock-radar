export type ValidFmpServiceTickerRow = {
  assetType: "adr_or_class" | "stock";
  exchange: string;
  name: string;
  symbol: string;
};

export type SecIssuerTickerCatalogRow = {
  issuerCik: string;
  symbol: string;
};

const allowedIssuerAssetTypes = new Set<ValidFmpServiceTickerRow["assetType"]>([
  "stock",
  "adr_or_class",
]);

// sync-fmp-universe.js owns trading eligibility. SEC-enriched rows may provide
// issuer CIK evidence, but they cannot make a symbol product-linkable alone.
export function readValidFmpServiceTickerRow(
  value: unknown,
): ValidFmpServiceTickerRow | null {
  const row = toRecord(value);
  if (!row || row.is_active !== true) return null;

  const symbol = normalizeTicker(row.symbol);
  const name = stringValue(row.name);
  const exchange = stringValue(row.exchange);
  const assetType = stringValue(row.asset_type).toLowerCase();
  const metadata = toRecord(row.metadata);
  if (
    !symbol ||
    !name ||
    !exchange ||
    stringValue(metadata?.provider).toLowerCase() !== "fmp" ||
    !allowedIssuerAssetTypes.has(
      assetType as ValidFmpServiceTickerRow["assetType"],
    )
  ) {
    return null;
  }

  return {
    assetType: assetType as ValidFmpServiceTickerRow["assetType"],
    exchange,
    name,
    symbol,
  };
}

export function readSecIssuerTickerCatalogRow(
  value: unknown,
): SecIssuerTickerCatalogRow | null {
  const row = toRecord(value);
  const symbol = normalizeTicker(row?.symbol);
  const issuerCik = readSecCik(row?.metadata);
  return symbol && issuerCik ? { issuerCik, symbol } : null;
}

export function validFmpServiceTickerSymbols(values: readonly unknown[]) {
  return new Set(
    values
      .map((value) => readValidFmpServiceTickerRow(value)?.symbol || "")
      .filter(Boolean),
  );
}

export function resolveIssuerLinkedTickersFromCatalog({
  requestedTickers,
  requestedSecIssuerRows,
  secIssuerCandidateRows,
  fmpTickerRows,
}: {
  requestedTickers: readonly string[];
  requestedSecIssuerRows: readonly unknown[];
  secIssuerCandidateRows: readonly unknown[];
  fmpTickerRows: readonly unknown[];
}) {
  const requested = normalizeTickers(requestedTickers);
  const requestedSet = new Set(requested);
  const validFmpSymbols = validFmpServiceTickerSymbols(fmpTickerRows);
  const issuerCiks = new Set(
    requestedSecIssuerRows
      .map(readSecIssuerTickerCatalogRow)
      .filter(
        (row): row is SecIssuerTickerCatalogRow =>
          Boolean(
            row &&
              requestedSet.has(row.symbol) &&
              validFmpSymbols.has(row.symbol),
          ),
      )
      .map((row) => row.issuerCik),
  );
  if (!issuerCiks.size) return requested;

  return normalizeTickers([
    ...requested,
    ...secIssuerCandidateRows
      .map(readSecIssuerTickerCatalogRow)
      .filter(
        (row): row is SecIssuerTickerCatalogRow =>
          Boolean(
            row &&
              issuerCiks.has(row.issuerCik) &&
              validFmpSymbols.has(row.symbol),
          ),
      )
      .map((row) => row.symbol),
  ]);
}

function readSecCik(value: unknown) {
  const metadata = toRecord(value);
  const rawCik = stringValue(metadata?.sec_cik);
  if (!/^\d{1,10}$/.test(rawCik)) return null;
  return rawCik.padStart(10, "0");
}

function normalizeTickers(values: readonly string[]) {
  return Array.from(new Set(values.map(normalizeTicker).filter(Boolean)));
}

function normalizeTicker(value: unknown) {
  const ticker = stringValue(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
