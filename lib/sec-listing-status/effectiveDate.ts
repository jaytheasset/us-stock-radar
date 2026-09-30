import { officialSource, record, validDate } from "../sec-delisting-state/state.ts";
import { sourceText } from "./sourceEvent.ts";
import type { ListingObservation } from "./observation.ts";

export type EffectiveDateKey = "removal_effective_date" | "trading_suspension_date";
// Bounded operative clauses, not a date elsewhere in a notice. Keep these
// expressions aligned with sec_listing_effective_date_clause in the writer.
const clauses: Record<EffectiveDateKey, string> = {
  removal_effective_date: "(?:remove[^.0-9;]{0,100}from listing|removed from listing|delisted|removal|delisting)[^.0-9;]{0,160}?(?:effective(?: at)?(?: the opening of (?:the )?(?:trading session|business) on)?|on) ",
  trading_suspension_date: "(?:trading[^.0-9;]{0,120}?(?:was|were|has been|is) suspended|(?:stock|shares|securities) (?:was|were) suspended|suspended trading)[^.0-9;]{0,120}?(?:beginning|on|effective(?: at)?(?: the opening of (?:the )?(?:trading session|business) on)?) ",
};

/** Validation only: never substitutes a date or rewrites the saved AI facts. */
export function supportsEffectiveDateClause(text: string, date: string, key: EffectiveDateKey): boolean {
  if (!validDate(date)) return false;
  const quote = sourceText(text).replace(/\b(Inc|Corp|Co|Ltd)\./gi, "$1");
  if (/\b(?:not|never|if|unless|would|could|might|may|expected|scheduled|will|anticipat\w*)\b/i.test(quote)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const literal = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${d}, ${y}`;
  return new RegExp(`${clauses[key]}(?:${date}|${literal})(?![0-9])`, "i").test(quote);
}

export function hasSupportedEffectiveDate(observation: Pick<ListingObservation, "listingRisk" | "sourceSnapshot">,
  key: EffectiveDateKey): boolean {
  const current = observation.listingRisk;
  if (current?.status !== "available") return false;
  const f = current.facts, date = f.dates[key];
  if (date.availability !== "available" || date.value_quality !== "exact" || date.date_status !== "occurred" || !validDate(date.value)) return false;
  const entries = f.fact_provenance.filter(p => p.fact_path === `dates.${key}.value`);
  if (entries.length !== 1) return false;
  const p = entries[0], sources = f.sources.filter(s => s.source_ref === p.source_ref);
  if (p.origin !== "source_stated" || p.evidence_status !== "available" || !p.evidence || sources.length !== 1) return false;
  const s = sources[0], raw = observation.sourceSnapshot, payload = record(raw.raw_payload);
  const accession = String(raw.source_unique_id);
  if (s.source_family !== "sec" || s.source_id !== accession || !officialSource(s.source_url ?? "", accession)
    || date.source_ref !== p.source_ref || payload.text_truncated === true) return false;
  const docs = [{url: payload.primary_document_url, text: payload.primary_document_html, truncated: payload.primary_document_html_truncated},
    ...(Array.isArray(payload.attachment_texts) ? payload.attachment_texts.map(v => {
      const d = record(v); return {url: d.url, text: d.text, truncated: d.textTruncated};
    }) : [])];
  return supportsEffectiveDateClause(p.evidence, date.value, key) && docs.some(d => d.truncated !== true
    && typeof d.text === "string" && officialSource(String(d.url), accession)
    && (s.source_url === d.url || s.source_url === raw.source_url)
    && sourceText(d.text).includes(sourceText(p.evidence!)));
}
