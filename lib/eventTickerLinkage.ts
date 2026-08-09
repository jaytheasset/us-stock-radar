export const eventTickerJoinAlias = "ticker_links";

type EventRow = Record<string, unknown>;

export function applyEventTickerRelationshipFilter(
  search: Record<string, string>,
  tickers: readonly string[],
) {
  const symbols = normalizeEventTickers(tickers);
  search.select = appendEventTickerJoin(search.select || "*");
  if (!symbols.length) {
    search[`${eventTickerJoinAlias}.symbol`] = "eq.__INVALID_TICKER__";
    return search;
  }

  search[`${eventTickerJoinAlias}.symbol`] =
    symbols.length === 1
      ? `eq.${symbols[0]}`
      : `in.(${symbols.join(",")})`;
  return search;
}

export function normalizeEventRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  const rowsById = new Map<string, EventRow>();
  const rowsWithoutId: EventRow[] = [];

  for (const valueRow of value) {
    if (!isRecord(valueRow)) continue;
    const row = { ...valueRow };
    delete row[eventTickerJoinAlias];
    const id = stringValue(row.id);
    if (!id) {
      rowsWithoutId.push(row);
      continue;
    }
    if (!rowsById.has(id)) rowsById.set(id, row);
  }

  return [...rowsById.values(), ...rowsWithoutId];
}

export function normalizeEventTickers(values: readonly string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toUpperCase())
        .filter((value) => /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(value)),
    ),
  );
}

function appendEventTickerJoin(select: string) {
  if (select.includes(`${eventTickerJoinAlias}:event_tickers!inner`)) {
    return select;
  }
  return `${select},${eventTickerJoinAlias}:event_tickers!inner(symbol)`;
}

function isRecord(value: unknown): value is EventRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
