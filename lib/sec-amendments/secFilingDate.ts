/** SEC ingestion uses filing_date; older lineage data uses filed_date.
 * Receipt timestamps are not a substitute for an explicitly reported filing date. */
export function readSecLineageFilingDate(payload: Record<string, unknown> | null): string | null {
  const values = [payload?.filing_date, payload?.filed_date]
    .filter(value => value !== undefined && value !== null && value !== "");
  if (!values.length || values.some(value => !isSecLineageFilingDate(value))) return null;
  return values.every(value => value === values[0]) ? values[0] as string : null;
}

export function isSecLineageFilingDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function secLineageParentDateFilter(date: string | null): Record<string, string> {
  if (!isSecLineageFilingDate(date)) throw new Error("SEC amendment target filing date invalid");
  // Include either spelling, then validate the complete row for disagreement.
  return { or: `(raw_payload->>filing_date.eq.${date},raw_payload->>filed_date.eq.${date})` };
}
