import type { Sc13CanonicalReadResult } from "../sec-sc13-xml/persistence.ts";
import type { SecCoverObservationReadResult } from "../sec-cover-observations/persistence.ts";
import type { SecIdentifierObservation } from "./mapping.ts";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Uses only the existing canonical SC13 reader, which revalidates stored XML and its hash. */
export function secCusipClassObservationsFromSc13(
  read: Sc13CanonicalReadResult,
): SecIdentifierObservation[] {
  if (read.status !== "available") return [];
  const row = read.filing;
  const cusips = Array.isArray(row.cusips_raw) ? row.cusips_raw : [];
  const evidence = {
    sourceUrl: text(row.source_url),
    sourceSha256: text(row.source_sha256),
    accessionNumber: text(row.accession_number),
    observedAt: text(row.filed_at_raw) || text(row.event_date),
    locator: "SC13 issuer security title / CUSIP",
  };
  return cusips.flatMap((cusip): SecIdentifierObservation[] =>
    typeof cusip === "string" ? [{
      kind: "cusip_class", issuerCik: text(row.issuer_cik), cusip,
      securityTitle: text(row.security_class_raw), evidence,
    }] : []);
}

/** Uses only the existing cover reader's validated source payload and same-context title/ticker pairs. */
export function secClassTickerObservationsFromCover(
  read: SecCoverObservationReadResult,
): SecIdentifierObservation[] {
  if (read.status !== "available") return [];
  const observations: SecIdentifierObservation[] = [];
  for (const entry of read.results) {
    const { payload } = entry;
    for (const row of payload.observations) {
      if (!(["observed", "duplicate_equal"].includes(row.securityTitle.status)
        && ["observed", "duplicate_equal"].includes(row.tradingSymbol.status))) continue;
      observations.push({
        kind: "class_ticker", issuerCik: row.issuerCik,
        securityTitle: text(row.securityTitle.parsedTextValue),
        ticker: text(row.tradingSymbol.parsedTextValue),
        evidence: {
          sourceUrl: text(payload.source.url), sourceSha256: text(payload.source.sha256),
          accessionNumber: payload.identity.accessionNumber,
          observedAt: text(payload.identity.acceptedAt) || text(payload.source.fetchedAt),
          locator: `XBRL cover context ${row.contextRef}`,
        },
      });
    }
  }
  return observations;
}

/** Rows must come from a successful SEC current-catalog fetch, not a historical ticker table. */
export function secCurrentTickerObservations(
  rows: readonly Readonly<{ cik_str: number; ticker: string }>[],
  fetchedAt: string,
): SecIdentifierObservation[] {
  return rows.map((row) => ({
    kind: "current_ticker" as const,
    issuerCik: String(row.cik_str).padStart(10, "0"), ticker: row.ticker,
    evidence: {
      sourceUrl: "https://www.sec.gov/files/company_tickers.json",
      observedAt: fetchedAt,
      locator: `ticker=${row.ticker}`,
    },
  }));
}
