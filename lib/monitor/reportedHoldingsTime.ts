export type ReportedHoldingsFilingTime = { rawAcceptedAt: string | null; rawFilingDate: string | null; instant: string; precision: "second" | "day"; timeZone: "explicit_offset" | "America/New_York" };

/** SEC index acceptance text is Eastern time; never use report/transaction/import dates. */
export function readReportedHoldingsFilingTime(accepted: unknown, filed: unknown): ReportedHoldingsFilingTime | null {
  const rawAcceptedAt = typeof accepted === "string" && accepted.trim() ? accepted.trim() : null;
  const rawFilingDate = typeof filed === "string" && filed.trim() ? filed.trim() : null;
  if (rawAcceptedAt) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawAcceptedAt)) {
      const literal = rawAcceptedAt.slice(0, 19);
      const local = Date.parse(literal + "Z");
      if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 19) !== literal) return null;
      const ms = Date.parse(rawAcceptedAt);
      return Number.isFinite(ms) ? { rawAcceptedAt, rawFilingDate, instant: new Date(ms).toISOString(), precision: "second", timeZone: "explicit_offset" } : null;
    }
    const instant = easternInstant(rawAcceptedAt);
    return instant ? { rawAcceptedAt, rawFilingDate, instant, precision: "second", timeZone: "America/New_York" } : null;
  }
  if (!rawFilingDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawFilingDate)) return null;
  const instant = easternInstant(`${rawFilingDate} 00:00:00`);
  return instant ? { rawAcceptedAt, rawFilingDate, instant, precision: "day", timeZone: "America/New_York" } : null;
}
export function reportedHoldingsWasActive(createdAt: string, filing: ReportedHoldingsFilingTime | null) {
  if (!filing || !/(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt)) return false;
  const created = Date.parse(createdAt), filed = Date.parse(filing.instant);
  return Number.isFinite(created) && (filing.precision === "second" ? created <= filed : created < filed);
}
function easternInstant(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const literal = value.replace("T", " "), nominal = Date.parse(value.replace(" ", "T") + "Z");
  if (!Number.isFinite(nominal)) return null;
  const candidates = [4, 5].map(offset => new Date(nominal + offset * 3600000)).filter(date => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` === literal;
  });
  return candidates.length === 1 ? candidates[0].toISOString() : null;
}
