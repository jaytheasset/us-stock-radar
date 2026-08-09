export type SecIssuerSecurity = {
  exchange: string | null;
  ticker: string;
};

export type SecIssuerSecurityLinkage = {
  displaySecurity: SecIssuerSecurity;
  issuerCik: string;
  securities: SecIssuerSecurity[];
  source: string;
};

export type SecIssuerEventTickerRow = {
  event_id: string;
  exchange: string | null;
  metadata: {
    issuer_cik: string;
    linkage_source: string;
  };
  reason: string;
  role: "primary" | "related";
  sort_order: number;
  symbol: string;
};

export type SecFilingGroupDedupeResult = {
  groupDedupeKey: string;
  legacyGroupDedupeKey: string;
  lookupGroupDedupeKeys: string[];
  isOwnershipFiling: boolean;
  formType: string | null;
  accessionNumber: string | null;
};

const trustedIssuerCatalogSources = new Set([
  "accession_cik_sec",
  "issuer_cik_sec",
  "issuer_trading_symbol_and_cik_sec",
]);

// Follow-up only: Live Room remains exact-ticker routed. Consuming issuer
// linkage there requires a separate product and routing decision.

export function resolveSecIssuerSecurityLinkage(
  rawPayload: Record<string, unknown>,
): SecIssuerSecurityLinkage | null {
  const issuerCik = normalizeCik(
    rawPayload.cik ||
      rawPayload.cik_padded ||
      rawPayload.ownership_issuer_cik,
  );
  const resolution = toRecord(rawPayload.ticker_resolution);
  const source = stringValue(resolution?.source);
  if (!issuerCik || !trustedIssuerCatalogSources.has(source)) return null;

  const securities = uniqueSecurities(rawPayload.tickers);
  if (!securities.length) return null;
  const displaySecurity = selectSecIssuerDisplaySecurity(securities);
  if (!displaySecurity) return null;

  return {
    displaySecurity,
    issuerCik,
    securities,
    source,
  };
}

export function selectSecIssuerDisplaySecurity(
  securities: readonly SecIssuerSecurity[],
) {
  return [...securities].sort((left, right) => {
    const scoreDifference =
      tickerQualityScore(right.ticker) - tickerQualityScore(left.ticker);
    return scoreDifference || left.ticker.localeCompare(right.ticker);
  })[0] ?? null;
}

export function buildSecIssuerEventTickerRows(
  eventId: string,
  linkage: SecIssuerSecurityLinkage,
): SecIssuerEventTickerRow[] {
  return linkage.securities
    .map((security) => ({
      event_id: eventId,
      exchange: security.exchange,
      metadata: {
        issuer_cik: linkage.issuerCik,
        linkage_source: linkage.source,
      },
      reason:
        security.ticker === linkage.displaySecurity.ticker
          ? "Display ticker selected deterministically from SEC issuer CIK securities"
          : `Verified same-issuer security for CIK ${linkage.issuerCik}`,
      role:
        security.ticker === linkage.displaySecurity.ticker
          ? ("primary" as const)
          : ("related" as const),
      sort_order:
        security.ticker === linkage.displaySecurity.ticker ? 1 : 100,
      symbol: security.ticker,
    }))
    .sort((left, right) =>
      left.sort_order - right.sort_order || left.symbol.localeCompare(right.symbol),
    )
    .map((row, index) => ({ ...row, sort_order: index + 1 }));
}

export function buildSecFilingGroupDedupe(
  rawRow: Record<string, unknown>,
): SecFilingGroupDedupeResult {
  const rawPayload = toRecord(rawRow.raw_payload) || {};
  const formType = normalizeSecFormTypeForDedupe(
    stringValue(rawPayload.form_type) ||
      stringValue(rawPayload.formType) ||
      stringValue(toRecord(rawRow.metadata)?.form_type) ||
      stringValue(rawRow.form_type),
  );
  const legacyGroupDedupeKey = buildSecFilingLegacyGroupDedupeKey(rawRow);
  const isOwnershipFiling = isSecOwnershipFormType(formType);
  const accessionNumber = readSecAccessionNumberForDedupe(rawRow, rawPayload);

  if (accessionNumber) {
    const groupDedupeKey = `sec_edgar:accession:${accessionNumber}`;
    const ownershipLegacyKey = isOwnershipFiling
      ? `sec_edgar:ownership:accession:${accessionNumber}`
      : "";
    return {
      groupDedupeKey,
      legacyGroupDedupeKey,
      lookupGroupDedupeKeys: uniqueStrings([
        groupDedupeKey,
        ownershipLegacyKey,
        legacyGroupDedupeKey,
      ]),
      isOwnershipFiling,
      formType,
      accessionNumber,
    };
  }

  if (isOwnershipFiling) {
    const rawItemId = stringValue(rawRow.id);
    const groupDedupeKey = `sec_edgar:ownership:raw_item:${rawItemId || "unknown"}`;
    return {
      groupDedupeKey,
      legacyGroupDedupeKey,
      lookupGroupDedupeKeys: uniqueStrings([
        groupDedupeKey,
        legacyGroupDedupeKey,
      ]),
      isOwnershipFiling: true,
      formType,
      accessionNumber: null,
    };
  }

  return {
    groupDedupeKey: legacyGroupDedupeKey,
    legacyGroupDedupeKey,
    lookupGroupDedupeKeys: [legacyGroupDedupeKey],
    isOwnershipFiling: false,
    formType,
    accessionNumber: null,
  };
}

export function buildSecFilingGroupDedupeKey(
  rawRow: Record<string, unknown>,
) {
  return buildSecFilingGroupDedupe(rawRow).groupDedupeKey;
}

export function buildSecFilingLegacyGroupDedupeKey(
  rawRow: Record<string, unknown>,
) {
  return `sec_edgar:${stringValue(rawRow.source_unique_id) || stringValue(rawRow.dedupe_key) || stringValue(rawRow.id)}`;
}

export function isSecOwnershipFormType(formType: unknown) {
  const normalized = normalizeSecFormTypeForDedupe(formType);
  return (
    normalized === "4" ||
    normalized === "4/A" ||
    normalized === "144" ||
    normalized === "144/A"
  );
}

function uniqueSecurities(value: unknown): SecIssuerSecurity[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const securities: SecIssuerSecurity[] = [];

  for (const item of value) {
    const row = toRecord(item);
    const ticker = stringValue(row?.ticker).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) || seen.has(ticker)) {
      continue;
    }
    seen.add(ticker);
    securities.push({
      exchange: nullableString(row?.exchange),
      ticker,
    });
  }

  return securities;
}

function tickerQualityScore(ticker: string) {
  const value = ticker.toUpperCase();
  let score = 100;
  if (
    value.endsWith("W") ||
    value.endsWith("WS") ||
    value.endsWith("WT") ||
    value.includes("WARRANT")
  ) {
    score -= 40;
  }
  if (value.endsWith("U") || value.endsWith("UN")) score -= 25;
  if (value.endsWith("R") || value.endsWith("RT")) score -= 20;
  if (value.includes(".")) score -= 5;
  score -= Math.max(0, value.length - 4) * 3;
  return score;
}

function normalizeCik(value: unknown) {
  const digits = stringValue(value).replace(/\D/g, "");
  return digits ? digits.padStart(10, "0") : "";
}

function normalizeSecFormTypeForDedupe(value: unknown) {
  const normalized = stringValue(value)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return normalized.replace(/^FORM\s+/, "");
}

function readSecAccessionNumberForDedupe(
  rawRow: Record<string, unknown>,
  rawPayload: Record<string, unknown>,
) {
  const rawPayloadAccession = normalizeSecAccessionNumber(
    stringValue(rawPayload.accession_number) ||
      stringValue(rawPayload.accessionNumber),
  );
  if (rawPayloadAccession) return rawPayloadAccession;

  return normalizeSecAccessionNumber(rawRow.source_unique_id) || null;
}

function normalizeSecAccessionNumber(value: unknown) {
  const rawValue = stringValue(value);
  if (!/^\d{10}-?\d{2}-?\d{6}$/.test(rawValue)) return "";
  const digits = rawValue.replace(/\D/g, "");
  return `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nullableString(value: unknown) {
  const normalized = stringValue(value);
  return normalized || null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
