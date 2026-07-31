type FilingRow = Record<string, unknown>;

export function selectRelatedFilingRows({
  candidates,
  currentDate,
  currentId,
  formType,
  issuer,
  limit = 4,
  ticker,
}: {
  candidates: FilingRow[];
  currentDate: string;
  currentId: string;
  formType: string;
  issuer: string;
  limit?: number;
  ticker: string;
}) {
  const normalizedTicker = normalizeTicker(ticker);
  const normalizedIssuer = normalizeIssuer(issuer);
  const normalizedForm = normalizeFormFamily(formType);
  const currentTime = parseTime(currentDate);

  return [...new Map(candidates.map((row) => [readString(row, "id"), row])).values()]
    .filter((row) => readString(row, "id") && readString(row, "id") !== currentId)
    .flatMap((row) => {
      const metadata = readRecord(row.metadata);
      const rowTicker = normalizeTicker(readString(row, "ticker"));
      const linkedTickers = readStringArray(row._linked_tickers).map(normalizeTicker);
      const rowIssuer = normalizeIssuer(firstString(
        readString(metadata, "issuer"),
        readString(metadata, "company"),
        readString(metadata, "company_name"),
      ));
      const sameTicker = Boolean(
        normalizedTicker && (rowTicker === normalizedTicker || linkedTickers.includes(normalizedTicker)),
      );
      const sameIssuer = Boolean(normalizedIssuer && rowIssuer === normalizedIssuer);
      if (!sameTicker && !sameIssuer) return [];

      const rowForm = normalizeFormFamily(firstString(
        readString(row, "form_type"),
        readString(metadata, "form_type"),
      ));
      const rowTime = parseTime(firstString(readString(row, "published_at"), readString(row, "detected_at")));
      const distanceDays = currentTime !== null && rowTime !== null
        ? Math.abs(currentTime - rowTime) / 86_400_000
        : Number.POSITIVE_INFINITY;
      const score = (sameTicker ? 100 : 0) + (sameIssuer ? 60 : 0) +
        (normalizedForm && rowForm === normalizedForm ? 15 : 0) +
        (Number.isFinite(distanceDays) ? Math.max(0, 10 - Math.min(distanceDays, 365) / 36.5) : 0);
      return [{ distanceDays, row, rowTime: rowTime ?? 0, score }];
    })
    .sort((left, right) =>
      right.score - left.score || left.distanceDays - right.distanceDays || right.rowTime - left.rowTime,
    )
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(({ row }) => row);
}

function normalizeTicker(value: string) {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : "";
}

function normalizeIssuer(value: string) {
  return value.toLowerCase().replace(/\b(?:incorporated|corporation|company|limited|inc|corp|co|ltd|plc)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeFormFamily(value: string) {
  return value.trim().toUpperCase().replace(/\/A$/, "");
}

function parseTime(value: string) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readRecord(value: unknown): FilingRow | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as FilingRow : null;
}

function readString(row: FilingRow | null, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function firstString(...values: string[]) {
  return values.find(Boolean) || "";
}
