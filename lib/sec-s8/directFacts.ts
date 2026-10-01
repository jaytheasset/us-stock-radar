import { createHash } from "node:crypto";
import { decodeSecHtmlEntities } from "../sources/sec/htmlEntities.ts";
import { parseS8Filing, S8_PARSER_VERSION } from "../sources/sec/forms/s8/parser.ts";

export const S8_DIRECT_VERSION = "sec_s8_direct_v1";
export const S8_SOURCE_VERSION = "sec_s8_original_v1";
type Row = Record<string, unknown>;
export type S8Document = {
  url: string; type: string | null; description: string | null; isPrimary: boolean;
  text: string; sha256: string; charCount: number; truncated: boolean;
};
export const isS8Form = (form: unknown) => ["S-8", "S-8/A", "S-8 POS"].includes(String(form));
export function captureS8Document(form: string | null, document: {
  url: string | null; type: string | null; description: string | null; isPrimary: boolean;
}, text: string): S8Document | undefined {
  if (!isS8Form(form) || !document.url) return undefined;
  const retained = text.slice(0, 2_000_000);
  return { ...document, url: document.url, text: retained, sha256: hash(retained), charCount: text.length,
    truncated: text.length > retained.length };
}
export function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
const str = (value: unknown) => typeof value === "string" ? value : "";
function plain(value: string) { return decodeSecHtmlEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function attrs(value: string) {
  const result: Record<string, string> = {};
  for (const m of value.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) result[m[1].toLowerCase()] = decodeSecHtmlEntities(m[3]);
  return result;
}
type Evidence = { documentUrl: string; documentSha256: string; start: number; end: number; quote: string };
const evidence = (doc: S8Document, start: number, quote: string): Evidence => ({
  documentUrl: doc.url, documentSha256: doc.sha256, start, end: start + quote.length, quote,
});
type DirectValue = { text: string; evidence: Evidence };
type RegistrationRow = {
  contextRef: string; securityClass: DirectValue; securityType: DirectValue | null;
  amountRegistered: { text: string; value: string | null; unit: string | null; evidence: Evidence } | null;
  status: "direct" | "unresolved"; reasons: string[];
  canonicalSecurityId: null; planRelationships: "unresolved";
};

/** The existing parser proposes rows/names; only independently locatable source
 * facts are retained. No aggregate, inferred delta, plan allocation or ratio is promoted. */
export function buildS8DirectFacts(raw: Row) {
  const payload = record(raw.raw_payload);
  if (!isS8Form(payload.form_type)) throw new Error("s8_form_not_supported");
  const accession = str(raw.source_unique_id);
  const issuerCik = str(payload.cik).padStart(10, "0");
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^\d{10}$/.test(issuerCik) || /^0+$/.test(issuerCik))
    throw new Error("s8_filing_identity_invalid");
  if (payload.accession_number !== accession) throw new Error("s8_accession_mismatch");
  const source = record(payload.s8_source);
  if (source.version !== S8_SOURCE_VERSION || !Array.isArray(source.documents) || !source.documents.length)
    throw new Error("s8_original_sources_unavailable");
  const docs = source.documents as S8Document[];
  const seen = new Set<string>();
  for (const doc of docs) {
    let url: URL; try { url = new URL(doc.url); } catch { throw new Error("s8_source_url_invalid"); }
    if (url.protocol !== "https:" || !["sec.gov", "www.sec.gov"].includes(url.hostname)
      || !new RegExp(`^/Archives/edgar/data/\\d+/${accession.replaceAll("-", "")}/[^/]+$`).test(url.pathname)
      || url.search || url.hash || seen.has(doc.url) || typeof doc.text !== "string" || !doc.text
      || hash(doc.text) !== doc.sha256 || typeof doc.isPrimary !== "boolean"
      || typeof doc.truncated !== "boolean" || !Number.isInteger(doc.charCount)
      || (doc.truncated ? doc.charCount <= doc.text.length : doc.charCount !== doc.text.length))
      throw new Error("s8_original_source_invalid");
    seen.add(doc.url);
  }
  const primaries = docs.filter(d => d.isPrimary);
  if (primaries.length !== 1 || primaries[0].url !== payload.primary_document_url)
    throw new Error("s8_primary_source_ambiguous");
  const primary = primaries[0];
  const parsed = parseS8Filing({ fixtureName: accession, accessionNumber: accession,
    formType: str(payload.form_type), filedAt: str(payload.filing_date) || null,
    filingText: primary.text, attachments: docs.filter(d => !d.isPrimary).map(d => ({
      documentType: d.type, description: d.description, text: d.text,
    })), marketContext: null, parentFilingContext: null });
  const rows: RegistrationRow[] = [];
  const limitations: string[] = [];
  for (const doc of docs) {
    if (doc.truncated) { limitations.push(`truncated_document:${doc.url}`); continue; }
    if (!/xmlns:ffd\s*=\s*["']https?:\/\/xbrl\.sec\.gov\/ffd\//i.test(doc.text)) continue;
    const facts = new Map<string, Map<string, Array<{ text: string; attributes: Record<string, string>; evidence: Evidence }>>>();
    for (const match of doc.text.matchAll(/<ix:(nonNumeric|nonFraction)\b([^>]*)>([\s\S]*?)<\/ix:\1>/gi)) {
      const a = attrs(match[2]);
      if (!a.contextref || !a.name?.startsWith("ffd:") || a.continuedat || a.escape === "true" || /<ix:/i.test(match[3])) continue;
      const context = facts.get(a.contextref) ?? new Map(); facts.set(a.contextref, context);
      const list = context.get(a.name) ?? []; context.set(a.name, list);
      list.push({ text: plain(match[3]), attributes: a, evidence: evidence(doc, match.index!, match[0]) });
    }
    for (const [contextRef, context] of facts) {
      const titles = context.get("ffd:OfferingSctyTitl") ?? [];
      if (!titles.length) continue;
      const contexts = [...doc.text.matchAll(/<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi)]
        .filter(m => attrs(m[1]).id === contextRef);
      const identifiers = contexts.length === 1
        ? [...contexts[0][2].matchAll(/<(?:xbrli:)?identifier\b[^>]*>([^<]+)<\/(?:xbrli:)?identifier>/gi)] : [];
      if (identifiers.length !== 1 || !/^\d{1,10}$/.test(plain(identifiers[0][1]))
        || plain(identifiers[0][1]).padStart(10, "0") !== issuerCik) {
        limitations.push(`fee_context_issuer_unresolved:${doc.url}:${contextRef}`); continue;
      }
      const readOne = (name: string) => {
        const values = context.get(`ffd:${name}`) ?? [];
        return values.length === 1 ? values[0] : null;
      };
      const title = readOne("OfferingSctyTitl");
      if (!title || !title.text) { limitations.push(`conflicting_security_title:${doc.url}:${contextRef}`); continue; }
      // Cross-check against the unchanged parser, without accepting its inferred fields.
      if (!(parsed.facts.feeTableRows ?? []).some(row => row.securityClassTitle === title.text)) {
        limitations.push(`parser_row_not_confirmed:${doc.url}:${contextRef}`); continue;
      }
      const securityType = readOne("OfferingSctyTp");
      const amount = readOne("AmtSctiesRegd");
      const reasons: string[] = [];
      let value: string | null = null;
      let unit: string | null = null;
      if (amount) {
        const units = [...doc.text.matchAll(/<(?:xbrli:)?unit\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?unit>/gi)]
          .filter(m => attrs(m[1]).id === amount.attributes.unitref);
        if (units.length === 1 && !/<(?:xbrli:)?divide\b/i.test(units[0][2])) {
          const measures = [...units[0][2].matchAll(/<(?:xbrli:)?measure[^>]*>([^<]+)<\/(?:xbrli:)?measure>/gi)];
          if (measures.length === 1) unit = plain(measures[0][1]);
        }
        // v1 deliberately refuses transformations it cannot verify, including scaled facts.
        if ((!amount.attributes.scale || amount.attributes.scale === "0") && !amount.attributes.sign
          && (!amount.attributes.format || /^ixt(?:\d+)?:num(?:-dot-decimal|dotdecimal)$/.test(amount.attributes.format))
          && /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(amount.text)
          && /^(?:xbrli:)?shares$/.test(unit || "")) value = amount.text.replaceAll(",", "");
        else reasons.push("amount_format_or_unit_unresolved");
      } else reasons.push((context.get("ffd:AmtSctiesRegd")?.length ?? 0) > 1 ? "amount_conflicting_or_repeated" : "amount_unavailable");
      rows.push({ contextRef, securityClass: { text: title.text, evidence: title.evidence },
        securityType: securityType ? { text: securityType.text, evidence: securityType.evidence } : null,
        amountRegistered: amount ? { text: amount.text, value, unit, evidence: amount.evidence } : null,
        status: value === null ? "unresolved" : "direct", reasons, canonicalSecurityId: null, planRelationships: "unresolved" });
    }
  }
  const plans: Array<{ name: string; evidence: Evidence }> = [];
  for (const plan of parsed.facts.planNameFacts ?? []) {
    // Exact contiguous source text only. A parser classification/type is not a source fact.
    for (const doc of docs.filter(d => !d.truncated)) {
      const start = doc.text.indexOf(plan.name);
      if (start >= 0) { plans.push({ name: plan.name, evidence: evidence(doc, start, plan.name) }); break; }
    }
  }
  // Preserve full source statements as disclosures, not inferred plan type,
  // approval/current-plan status, share allocation or issuance events.
  const planDisclosures: Array<{ text: string; evidence: Evidence }> = [];
  for (const doc of docs.filter(d => !d.truncated)) {
    for (const match of doc.text.matchAll(/<(p|div)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      if (/<(?:p|div)\b/i.test(match[2])) continue;
      const text = plain(match[2]);
      if (!/\bplans?\b/i.test(text) || text.length < 15 || text.length > 4000) continue;
      if (planDisclosures.length >= 100) { limitations.push("plan_disclosures_limited_to_100"); break; }
      planDisclosures.push({ text, evidence: evidence(doc, match.index!, match[0]) });
    }
  }
  const relatedReferences: Array<{ registrationFileNumber: string; relationship: "unresolved"; evidence: Evidence }> = [];
  for (const doc of docs.filter(d => !d.truncated)) {
    for (const match of doc.text.matchAll(/\b333-\d+\b/g)) relatedReferences.push({ registrationFileNumber: match[0],
      relationship: "unresolved", evidence: evidence(doc, match.index!, match[0]) });
  }
  if (!rows.length) limitations.push("no_verified_inline_fee_rows");
  limitations.push("registration_not_issuance_or_sale", "no_canonical_plan_allocation_or_parent_resolution",
    "no_aggregate_additional_shares_or_dilution_percentage");
  const facts = { version: S8_DIRECT_VERSION, parserVersion: S8_PARSER_VERSION, accessionNumber: accession,
    issuerCik, formType: payload.form_type, filingDate: str(payload.filing_date) || null,
    acceptedAt: str(payload.accepted_at) || null, isAmendment: payload.form_type !== "S-8",
    registrationRows: rows, plans, planDisclosures, relatedReferences, limitations: [...new Set(limitations)] };
  return { facts, source, sourceSha256: hash(stable(source)), factsSha256: hash(stable(facts)) };
}
