/** A read-side bridge between existing, source-validated SEC observations. */
export type SecIdentifierEvidence = Readonly<{
  sourceUrl: string;
  observedAt: string;
  accessionNumber?: string;
  sourceSha256?: string;
  locator?: string;
}>;

export type SecIdentifierObservation =
  | Readonly<{ kind: "cusip_class"; issuerCik: string; cusip: string; securityTitle: string; evidence: SecIdentifierEvidence }>
  | Readonly<{ kind: "class_ticker"; issuerCik: string; securityTitle: string; ticker: string; evidence: SecIdentifierEvidence }>
  | Readonly<{ kind: "current_ticker"; issuerCik: string; ticker: string; evidence: SecIdentifierEvidence }>
  // Third-party SEC filings can veto a claim but never establish an issuer mapping by themselves.
  | Readonly<{ kind: "reported_pair"; cusip: string; ticker: string; evidence: SecIdentifierEvidence }>;

export type SecIdentifierMapping = Readonly<{
  status: "trusted";
  cusip: string;
  issuerCik: string;
  securityClass: string;
  ticker: string;
  currentTickerObservedAt: string;
  evidence: readonly SecIdentifierObservation[];
}>;

export type SecIdentifierMappingResult = SecIdentifierMapping | Readonly<{
  status: "unmapped" | "conflict";
  reason: string;
}>;

type CusipClass = Extract<SecIdentifierObservation, { kind: "cusip_class" }>;
type ClassTicker = Extract<SecIdentifierObservation, { kind: "class_ticker" }>;
type CurrentTicker = Extract<SecIdentifierObservation, { kind: "current_ticker" }>;
type ReportedPair = Extract<SecIdentifierObservation, { kind: "reported_pair" }>;

const SEC_ARCHIVE = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\//i;
const SEC_CURRENT_CATALOGS = new Set([
  "https://www.sec.gov/files/company_tickers.json",
  "https://www.sec.gov/files/company_tickers_exchange.json",
]);

function validEvidence(observation: SecIdentifierObservation): boolean {
  const { evidence } = observation;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(evidence.observedAt)
    || !Number.isFinite(Date.parse(evidence.observedAt))) return false;
  if (evidence.sourceSha256 && !/^[a-f0-9]{64}$/i.test(evidence.sourceSha256)) return false;
  if (observation.kind === "current_ticker") return SEC_CURRENT_CATALOGS.has(evidence.sourceUrl);
  return SEC_ARCHIVE.test(evidence.sourceUrl)
    && /^\d{10}-\d{2}-\d{6}$/.test(evidence.accessionNumber ?? "");
}

/** Deliberately narrow: a title naming multiple classes, units or an unknown class is not a join key. */
export function secSecurityClassKey(rawTitle: string): string | null {
  const title = rawTitle.toLowerCase().replace(/\s+/g, " ").trim();
  if (!title || /\b(?:units?|options?|rights?)\b/.test(title)) return null;
  const classes = [...title.matchAll(/\bclass\s+([a-z0-9]+)\b/g)].map((match) => match[1]);
  if (new Set(classes).size > 1) return null;
  const security = /\bwarrants?\b/.test(title) ? "warrant"
    : /\bcommon stock\b/.test(title) ? "common stock"
    : /\bcapital stock\b/.test(title) ? "capital stock"
    : null;
  if (!security || (security === "warrant" && /\b(?:common|capital|preferred) stock\b/.test(title) === false)) return null;
  if (/\bpreferred\b/.test(title) && security !== "warrant") return null;
  return `${security}:${classes[0] ?? "unclassified"}`;
}

/**
 * Resolves only a three-link SEC chain: CUSIP -> issuer/class -> class/ticker ->
 * current SEC ticker catalog. No issuer-name or CIK-only fallback is permitted.
 * Callers must supply the complete relevant observation set, not cherry-pick rows.
 */
export function resolveSecSecurityIdentifier(input: {
  cusip: string;
  asOf: string;
  observations: readonly SecIdentifierObservation[];
}): SecIdentifierMappingResult {
  const cusip = input.cusip.trim().toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(cusip)) return { status: "unmapped", reason: "invalid_cusip" };
  const asOfMillis = Date.parse(input.asOf);
  if (!Number.isFinite(asOfMillis)) return { status: "unmapped", reason: "invalid_as_of" };
  const cusipClaims = input.observations.filter((row): row is CusipClass => row.kind === "cusip_class");
  const tickerClaims = input.observations.filter((row): row is ClassTicker => row.kind === "class_ticker");
  const currentClaims = input.observations.filter((row): row is CurrentTicker => row.kind === "current_ticker");
  const pairClaims = input.observations.filter((row): row is ReportedPair => row.kind === "reported_pair");
  const linked = cusipClaims.filter((row) => row.cusip.trim().toUpperCase() === cusip);
  if (linked.length === 0) return { status: "unmapped", reason: "no_cusip_class_evidence" };
  if (linked.some((row) => !validEvidence(row) || !/^\d{10}$/.test(row.issuerCik) || !secSecurityClassKey(row.securityTitle))) {
    return { status: "unmapped", reason: "incomplete_cusip_class_evidence" };
  }
  const keys = new Set(linked.map((row) => `${row.issuerCik}|${secSecurityClassKey(row.securityTitle)}`));
  if (keys.size !== 1) return { status: "conflict", reason: "cusip_issuer_or_class_conflict" };
  const issuerCik = linked[0].issuerCik;
  const securityClass = secSecurityClassKey(linked[0].securityTitle)!;

  // If multiple CUSIPs claim the same issuer/class, we cannot establish which is current.
  const sameClass = cusipClaims.filter((row) =>
    row.issuerCik === issuerCik && secSecurityClassKey(row.securityTitle) === securityClass);
  if (new Set(sameClass.map((row) => row.cusip.trim().toUpperCase())).size !== 1) {
    return { status: "conflict", reason: "class_cusip_conflict" };
  }
  const classTickers = tickerClaims.filter((row) =>
    row.issuerCik === issuerCik && secSecurityClassKey(row.securityTitle) === securityClass);
  if (classTickers.length === 0) return { status: "unmapped", reason: "no_class_ticker_evidence" };
  if (classTickers.some((row) => !validEvidence(row) || !/^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(row.ticker))) {
    return { status: "unmapped", reason: "incomplete_class_ticker_evidence" };
  }
  const tickers = new Set(classTickers.map((row) => row.ticker.toUpperCase()));
  if (tickers.size !== 1) return { status: "conflict", reason: "class_ticker_conflict" };
  const ticker = classTickers[0].ticker.toUpperCase();

  const reportedPairs = pairClaims.filter((row) =>
    row.cusip.trim().toUpperCase() === cusip);
  if (reportedPairs.some((row) => !validEvidence(row) || row.ticker.toUpperCase() !== ticker)) {
    return { status: "conflict", reason: "reported_cusip_ticker_conflict" };
  }

  // One ticker cannot identify two issuer/classes in the supplied SEC cover evidence.
  const sameTickerClasses = tickerClaims.filter((row) => row.ticker.toUpperCase() === ticker);
  if (new Set(sameTickerClasses.map((row) => `${row.issuerCik}|${secSecurityClassKey(row.securityTitle)}`)).size !== 1) {
    return { status: "conflict", reason: "ticker_class_conflict" };
  }
  const current = currentClaims.filter((row) => row.ticker.toUpperCase() === ticker);
  if (current.length === 0) return { status: "unmapped", reason: "not_in_current_sec_ticker_catalog" };
  if (current.some((row) => !validEvidence(row) || row.issuerCik !== issuerCik)) {
    return { status: "conflict", reason: "current_ticker_issuer_conflict" };
  }
  if (current.some((row) => {
    const ageMillis = asOfMillis - Date.parse(row.evidence.observedAt);
    return ageMillis < 0 || ageMillis > 24 * 60 * 60 * 1000;
  })) return { status: "unmapped", reason: "stale_current_ticker_catalog" };
  return {
    status: "trusted", cusip, issuerCik, securityClass, ticker,
    currentTickerObservedAt: current.reduce((latest, row) => row.evidence.observedAt > latest ? row.evidence.observedAt : latest, ""),
    evidence: [...linked, ...classTickers, ...current, ...reportedPairs],
  };
}
