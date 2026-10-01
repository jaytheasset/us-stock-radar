import { createHash } from "node:crypto";
import { record } from "../sec-delisting-state/state.ts";
import { stable, sameScope, type ListingObservation, type Row } from "./observation.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const day = (s: unknown) => String(s ?? "").slice(0, 10);

/** Compare the retained SEC documents used by this observation, not a mutable
 * fetch/enrichment envelope. Never used to relax Form 25 source semantics. */
export function sameRetainedListingEvidence(o: ListingObservation, raw: Row): boolean {
  if (!/^(8-K|6-K)(\/A)?$/.test(o.form)) return false;
  const old = o.sourceSnapshot, a = record(old.raw_payload), b = record(raw.raw_payload);
  if (raw.id !== old.id || raw.source_code !== "sec_edgar" || old.source_code !== "sec_edgar"
    || raw.source_unique_id !== o.accession || old.source_unique_id !== o.accession
    || a.form_type !== o.form || b.form_type !== o.form
    || !/^\d{1,10}$/.test(String(a.cik)) || String(a.cik).padStart(10,"0") !== String(b.cik).padStart(10,"0")
    || day(old.published_at) !== o.filingDate || day(raw.published_at) !== o.filingDate
    || a.text_truncated === true || b.text_truncated === true) return false;
  const docs = (p: Row) => [{ url: p.primary_document_url, text: p.primary_document_html, truncated: p.primary_document_html_truncated },
    ...(Array.isArray(p.attachment_texts) ? p.attachment_texts.map(x => { const d=record(x); return {url:d.url,text:d.text,truncated:d.textTruncated}; }) : [])];
  const before = docs(a), after = docs(b);
  // The primary cover is always identity evidence, even for an exhibit event.
  const cited = new Map<string, string>();
  if (typeof a.primary_document_url !== "string" || typeof a.primary_document_html !== "string") return false;
  cited.set(a.primary_document_url, sha(a.primary_document_html));
  for (const d of o.reported.sources) {
    if (!d.url || !d.sha256 || cited.has(d.url) && cited.get(d.url) !== d.sha256) return false;
    cited.set(d.url,d.sha256);
  }
  if (o.sourceEvent) {
    const e=o.sourceEvent;
    if (cited.has(e.documentUrl) && cited.get(e.documentUrl) !== e.documentHash) return false;
    cited.set(e.documentUrl,e.documentHash);
  }
  for (const [url,hash] of cited) {
    try { const u=new URL(url); if (u.protocol!=="https:" || u.hostname!=="www.sec.gov"
      || !u.pathname.startsWith(`/Archives/edgar/data/${Number(a.cik)}/${o.accession.replaceAll("-","")}/`)) return false; } catch { return false; }
    for (const set of [before,after]) {
      const matches=set.filter(d=>d.url===url);
      if (matches.length!==1 || matches[0].truncated===true || typeof matches[0].text!=="string"
        || sha(matches[0].text)!==hash) return false;
    }
    for (const p of [a,b]) if (Array.isArray(p.documents) && p.documents.some(x=> {
      const d=record(x); return d.url===url && (d.textTruncated===true || d.rawHtmlTruncated===true
        || d.rawTextTruncated===true || Boolean(d.fetchError) || typeof d.fetchStatus==="number" && d.fetchStatus>=400);
    })) return false;
  }
  return true;
}

/** Only a repeated analysis of the same retained filing/issue and the same
 * canonical claims can replace a stale analysis in projection. Another event,
 * changed dates/status, unknown scope, or an unrelated open issue cannot. */
export function sameCanonicalListingClaim(a: ListingObservation, b: ListingObservation): boolean {
  if (a.sourceEvent || b.sourceEvent || !a.scope || !b.scope || !sameScope(a.scope,b.scope)
    || a.rawItemId!==b.rawItemId || a.eventId!==b.eventId || a.accession!==b.accession
    || a.filingDate!==b.filingDate || a.evaluatedAsOf!==b.evaluatedAsOf
    || !sameRetainedListingEvidence(a,b.sourceSnapshot)
    || a.listingRisk?.status!=="available" || b.listingRisk?.status!=="available") return false;
  const fields=(o: ListingObservation) => {
    const f=o.listingRisk!.status==="available" ? o.listingRisk!.facts : null;
    return { classification:f!.classification, security:f!.affected_security, exchange:f!.exchange,
      issue:f!.listing_rule, dates:f!.dates,
      listing:o.reported.listing,trading:o.reported.trading,
      removalDate:o.reported.removalDate,suspensionDate:o.reported.suspensionDate };
  };
  return stable(fields(a))===stable(fields(b));
}
