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
