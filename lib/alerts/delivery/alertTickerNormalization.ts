export type StoredAlertTickerRow = {
  symbol?: unknown;
  role?: unknown;
  sort_order?: unknown;
};

export function normalizeStoredAlertTickers(
  eventTickerValue: unknown,
  tickerRows: readonly StoredAlertTickerRow[],
) {
  const eventTicker = readTicker(eventTickerValue);
  const tickers = normalizeTickers([
    ...tickerRows.map((tickerRow) => readTicker(tickerRow.symbol)),
    eventTicker,
  ]);
  const primaryTicker =
    readPrimaryTicker(tickerRows) ||
    (eventTicker && tickers.includes(eventTicker) ? eventTicker : undefined) ||
    tickers[0];

  return { primaryTicker, tickers };
}

function readPrimaryTicker(rows: readonly StoredAlertTickerRow[]) {
  return rows
    .filter((row) => readString(row.role) === "primary")
    .sort(
      (left, right) =>
        readNumber(left.sort_order) - readNumber(right.sort_order),
    )
    .map((row) => readTicker(row.symbol))
    .find(Boolean);
}

function normalizeTickers(values: string[]) {
  return Array.from(new Set(values.map(readTicker).filter(Boolean)));
}

function readTicker(value: unknown) {
  const ticker = readString(value).toUpperCase();
  if (
    !ticker ||
    ticker === "N/A" ||
    ticker === "NA" ||
    ticker === "UNKNOWN" ||
    ticker === "-"
  ) {
    return "";
  }
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : "";
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }
  return Number.NaN;
}
