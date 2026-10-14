export type SecTickerSelectionRow = {
  cik: string;
  ticker: string;
  exchange: string | null;
  name: string | null;
};

export function selectSourceBackedSecTickerRow(
  rows: readonly SecTickerSelectionRow[],
  sourceTicker: string,
) {
  const normalized = sourceTicker.trim().toUpperCase();
  return rows.find((row) => row.ticker.toUpperCase() === normalized) || null;
}

/** Explicit company (exchange: symbol) mentions only. This is identity corroboration,
 * never transaction-role, security-class or current-event inference. */
export function findSourceBackedSecTradingPairs(
  blocks: readonly { block_id: string; heading?: string | null; text: string }[],
  rows: readonly SecTickerSelectionRow[],
) {
  const observations: { status: "corroborated" | "unresolved"; reason: string; sourceTicker: string; sourceCompanyName: string | null;
    row: SecTickerSelectionRow | null; evidence: { block_id: string; source_field: "heading" | "text"; quote: string }; transactionRole: null; historicalTickerVerified: false }[] = [];
  const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const block of blocks) for (const field of ["heading", "text"] as const) {
    const source = block[field]; if (typeof source !== "string") continue;
    for (const match of source.matchAll(/\((NYSE American|NYSE|Nasdaq)\s*:\s*([A-Z][A-Z0-9.-]{0,11})\s*\)/gi)) {
      const symbol = match[2].toUpperCase(), prefix = source.slice(Math.max(0, match.index - 300), match.index);
      const candidates = rows.filter(row => selectSourceBackedSecTickerRow([row], symbol) && row.name && /^\d{1,10}$/.test(row.cik) && Number(row.cik) > 0)
        .flatMap(row => {
          // Case, spaces, commas and periods only. No suffix removal, aliases or partial names.
          const tokens = row.name!.trim().split(/[\s.,]+/).filter(Boolean);
          if (!tokens.length) return [];
          const nameMatch = prefix.match(new RegExp(`(?:^|[\\n;:—–]|\\b(?:with|by|and|of|for|to)\\s+|[,.]\\s+)(${tokens.map(escape).join("[\\s.,]+")})[\\s.,]*$`, "i"));
          return nameMatch && row.exchange?.toUpperCase() === match[1].toUpperCase() ? [{ row, name: nameMatch[1], start: prefix.lastIndexOf(nameMatch[1]) }] : [];
        });
      const unique = [...new Map(candidates.map(c => [JSON.stringify([Number(c.row.cik), c.row.ticker, c.row.exchange, c.row.name]), c])).values()];
      const candidate = unique.length === 1 ? unique[0] : null;
      observations.push({ status: candidate ? "corroborated" : "unresolved",
        reason: candidate ? "explicit_company_symbol_matches_official_sec_row" : "company_symbol_missing_conflicting_or_ambiguous",
        sourceTicker: symbol, sourceCompanyName: candidate?.name ?? null, row: candidate ? { ...candidate.row } : null,
        evidence: { block_id: block.block_id, source_field: field, quote: candidate ? prefix.slice(candidate.start) + match[0] : match[0] },
        transactionRole: null, historicalTickerVerified: false });
    }
  }
  return observations;
}
