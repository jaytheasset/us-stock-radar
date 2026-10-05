import { createHash } from "node:crypto";
import { parseProxyFiling, PROXY_PARSER_VERSION } from "../sources/sec/forms/proxy/parser.ts";
import { buildProxyProposalDiscoverySourcePackage } from "../sources/sec/forms/proxy/proposalDiscovery.ts";
import { SEC_PROXY_FORMS, normalizeSecFormType } from "../sources/sec/forms/common/forms.ts";

export const VERSION = "proxy_product_v1";
export const PURPOSE = "sec_proxy_structured";
export const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const text = (v: unknown) => typeof v === "string" ? v : "";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).sort(([a],[b]) => a.localeCompare(b)).map(([k,x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export const isProxyForm = (v: unknown) => SEC_PROXY_FORMS.includes(normalizeSecFormType(text(v)) as typeof SEC_PROXY_FORMS[number]);
export function attemptKey(key?: string) {
  if (key === undefined) return "automatic";
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(key)) throw Error("proxy_invalid_verification_key");
  return `verification:${key}`;
}
export function buildProxySource(raw: Record<string, unknown>, verificationKey?: string) {
  const p = record(raw.raw_payload), formType = normalizeSecFormType(text(p.form_type));
  if (raw.source_code !== "sec_edgar" || !isProxyForm(formType)
    || !/^\d{10}-\d{2}-\d{6}$/.test(text(p.accession_number))
    || raw.source_unique_id !== p.accession_number || !/^\d{1,10}$/.test(text(p.cik))) throw Error("proxy_source_identity_invalid");
  const html = text(p.primary_document_html), body = text(raw.body_text);
  if (html ? p.primary_document_html_truncated === true : p.text_truncated === true) throw Error("proxy_source_truncated");
  if (!(html || body).trim()) throw Error("proxy_source_missing");
  const original = { source_code: raw.source_code, source_unique_id: raw.source_unique_id,
    source_url: raw.source_url ?? null, body_text: raw.body_text ?? null, raw_payload: p };
  const parserInput = { formType, accessionNumber: text(p.accession_number), companyName: text(p.company_name),
    primaryTicker: { ticker: text(p.ticker), exchange: text(p.exchange) }, filingText: html || body,
    attachments: (Array.isArray(p.attachment_texts) ? p.attachment_texts : []).map(v => {
      const a = record(v); return { filename: text(a.filename), type: text(a.type), description: text(a.description), url: text(a.url), text: text(a.text) };
    }) };
  const parsed = parseProxyFiling(parserInput);
  const source = buildProxyProposalDiscoverySourcePackage(parsed);
  source.provenance = { ...source.provenance, filing_date: p.filing_date ?? null,
    source_url: raw.source_url ?? p.primary_document_url ?? null, primary_document_url: p.primary_document_url ?? null,
    issuer_identity: { cik: text(p.cik).padStart(10,"0"), company_name: p.company_name ?? null } };
  const binding = { rawItemId: text(raw.id), accession: text(p.accession_number), issuerCik: text(p.cik).padStart(10,"0"),
    formType, filedAt: text(p.accepted_at) || text(p.filing_date), original, source, parserVersion: PROXY_PARSER_VERSION,
    contractVersion: VERSION, attempt: attemptKey(verificationKey), sourceFingerprint: hash(stable({ original, source, version: VERSION })) };
  const h = hash(stable([PURPOSE,binding.rawItemId,binding.sourceFingerprint,VERSION,binding.attempt]));
  const executionId = `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
  return { binding, executionId, source, formType };
}
