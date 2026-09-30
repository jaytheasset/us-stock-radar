import { createHash } from "node:crypto";
import { decodeSecHtmlEntities } from "../sources/sec/htmlEntities.ts";
import { record, validDate, validScope, type DelistingScope } from "../sec-delisting-state/state.ts";

/** Explicit, bounded source selection for history research; no ingest/LLM hook.
 * Initial events reuse existing states. Only the two closing events are new. */
export type ListingSourceEvent = {
  version: "listing_source_event_v1";
  kind: "removal_decision" | "trading_suspension" | "removal_decision_withdrawn" | "trading_resumed";
  // Date expressly attached to the source statement/notice. This is not by
  // itself an effective trading date (a notice can report an earlier suspension).
  date: string;
  dateText: string;
  documentUrl: string;
  documentHash: string;
  quote: string;
  securityText: string;
  exchangeText: string;
  issue: string;
  resolves?: { observationId: string; sourceHash: string; eventDate: string };
};
export const sourceEventAxis = (e: ListingSourceEvent) => e.kind.startsWith("removal_") ? "listing" as const : "trading" as const;
export const closingEvent = (e: ListingSourceEvent) => e.kind === "removal_decision_withdrawn" || e.kind === "trading_resumed";
export const sourceText = (text: string) => decodeSecHtmlEntities(text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
  .replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const includes = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase());
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Reject unknown phrasing rather than interpreting or repairing it. Evidence
 * must include the local subject, venue, issue and operative date together. */
export function validateSourceEvent(raw: Record<string, unknown>, scope: DelistingScope | null, e: ListingSourceEvent): void {
  const p = record(raw.raw_payload); const accession = String(raw.source_unique_id ?? "");
  if (!scope || !validScope(scope) || raw.source_code !== "sec_edgar"
    || !/^(8-K|6-K)(\/A)?$/.test(String(p.form_type)) || e.version !== "listing_source_event_v1"
    || String(p.cik ?? "").padStart(10, "0") !== scope.issuerCik
    || !validDate(e.date) || e.date > String(raw.published_at).slice(0, 10)) throw Error("invalid_listing_source_event");
  const official = (url: string) => { try { const u = new URL(url); return u.protocol === "https:" && u.hostname === "www.sec.gov"
    && u.pathname.startsWith(`/Archives/edgar/data/${Number(scope.issuerCik)}/${accession.replaceAll("-", "")}/`); } catch { return false; } };
  const docs = [{ url: p.primary_document_url, text: p.primary_document_html, truncated: p.primary_document_html_truncated },
    ...(Array.isArray(p.attachment_texts) ? p.attachment_texts.map(v => { const d = record(v); return {url:d.url,text:d.text,truncated:d.textTruncated}; }) : [])];
  const selected = docs.filter(d => d.url === e.documentUrl);
  if (!official(String(raw.source_url)) || !official(e.documentUrl) || selected.length !== 1
    || selected[0].truncated === true || typeof selected[0].text !== "string" || p.text_truncated === true
    || sha(selected[0].text) !== e.documentHash) throw Error("listing_event_source_unavailable");
  const q = sourceText(e.quote);
  if (q.length < 40 || q.length > 2400 || q !== e.quote || !sourceText(selected[0].text).includes(q)
    || !e.securityText || !e.exchangeText || !e.issue || e.issue.length < 8
    || !equal(e.securityText, scope.securityTitle) || !equal(e.exchangeText, scope.exchange)
    || !includes(q,e.securityText) || !includes(q,e.exchangeText) || !includes(q,e.issue)
    || !q.includes(e.dateText) || !dateLiteralMatches(e.dateText,e.date)) throw Error("listing_event_evidence_mismatch");
  const patterns = {
    removal_decision: /(?:determined to commence proceedings to delist|delisting determination letter|determination to delist)/i,
    trading_suspension: /(?:had suspended trading|trading[^.]{0,180}was suspended beginning|trading[^.]{0,180}was suspended on)/i,
    removal_decision_withdrawn: /(?:has withdrawn|has rescinded|has cancelled|has canceled) (?:its|the) delisting (?:determination|decision)/i,
    trading_resumed: /trading (?:has resumed|resumed) on /i,
  };
  if (!patterns[e.kind]?.test(q)) throw Error("unsupported_listing_event_statement");
  // A date elsewhere in the paragraph is not the resumption date.
  if (e.kind === "trading_resumed") {
    const clause = q.match(/trading (?:has resumed|resumed) on ([^.]+)/i)?.[1];
    if (!clause?.startsWith(e.dateText)) throw Error("listing_event_operative_date_mismatch");
  }
  // A recognized affirmative clause cannot be embedded in a negated/conditional claim.
  if (/\b(?:not|never|if|unless|would|could|might|may)\b/i.test(q)
    || (e.kind === "trading_resumed" && /\b(?:expected|scheduled|will resume|anticipat\w*)\b/i.test(q)))
    throw Error("conditional_or_negated_listing_event");
  if (closingEvent(e) !== Boolean(e.resolves)) throw Error("listing_event_target_required");
  if (e.resolves && (!/^[\da-f-]{36}$/i.test(e.resolves.observationId) || !/^[a-f0-9]{64}$/.test(e.resolves.sourceHash)
    || !validDate(e.resolves.eventDate) || e.resolves.eventDate >= e.date)) throw Error("invalid_listing_event_target");
}

function dateLiteralMatches(text: string, date: string) {
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const [y,m,d] = date.split("-").map(Number);
  return text === date || text === `${months[m-1]} ${d}, ${y}`;
}

export function validateEventLink(next: ListingSourceEvent, previous: ListingSourceEvent) {
  if (!next.resolves || closingEvent(previous) || sourceEventAxis(next) !== sourceEventAxis(previous)
    || next.resolves.eventDate !== previous.date || !equal(next.issue,previous.issue)
    || !equal(next.securityText,previous.securityText) || !equal(next.exchangeText,previous.exchangeText))
    throw Error("listing_event_issue_or_target_mismatch");
  // Date or precise rule/reason must recur in the follow-up source, not just a company name.
  if (!includes(next.quote, previous.dateText) && !/^(?:Section|Rule)\s+\d[\w.() -]+$/i.test(next.issue))
    throw Error("listing_event_prior_reference_missing");
}
