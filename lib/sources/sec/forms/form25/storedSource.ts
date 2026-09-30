import { createHash } from "node:crypto";
import { decodeSecHtmlEntities } from "../../htmlEntities.ts";
import { parseSecForm25Filing } from "./parser.ts";

export const FORM25_SOURCE_VERSION = "sec_form25_original_sources_v1";
const MAX_SOURCE_CHARS = 2_000_000;
type Row = Record<string, unknown>;
export type Form25OriginalDocument = {
  url: string; type: string | null; description: string | null; isPrimary: boolean;
  text: string; sha256: string; charCount: number; truncated: boolean;
};

/** Original HTTP response text, separate from the unchanged Primary text input. */
export function captureForm25Document(form: string | null, document: {
  url: string | null; type: string | null; description: string | null; isPrimary: boolean;
}, text: string): Form25OriginalDocument | undefined {
  if (!/^(25|25-NSE)(\/A)?$/.test(form || "") || !document.url) return undefined;
  const retained = text.slice(0, MAX_SOURCE_CHARS);
  return { ...document, url: document.url, text: retained, sha256: sourceHash(retained),
    charCount: text.length, truncated: text.length > MAX_SOURCE_CHARS };
}

/** Exact stored source selection. Never manufactures XML from rendered HTML. */
export function readStoredForm25Source(raw: Row) {
  const payload = record(raw.raw_payload);
  const accession = text(raw.source_unique_id);
  const bundle = record(payload.form25_source);
  const fail = (reason: string) => ({ status: "unavailable" as const, reason });
  let documents: Form25OriginalDocument[];
  const original = payload.form25_source !== undefined && payload.form25_source !== null;
  if (original) {
    if (bundle.version !== FORM25_SOURCE_VERSION || !Array.isArray(bundle.documents) || !bundle.documents.length)
      return fail("invalid_form25_source_bundle");
    documents = [];
    for (const value of bundle.documents) {
      const doc = record(value);
      if (!officialForm25Source(text(doc.url), accession) || !text(doc.text)
        || doc.truncated !== false || doc.charCount !== text(doc.text).length
        || doc.sha256 !== sourceHash(text(doc.text)) || typeof doc.isPrimary !== "boolean")
        return fail("form25_original_source_invalid_or_truncated");
      if (documents.some(previous => previous.url === doc.url)) return fail("form25_duplicate_source_url");
      documents.push(doc as Form25OriginalDocument);
    }
    if (documents.filter(doc => doc.isPrimary).length !== 1) return fail("form25_primary_source_ambiguous");
    const primary = documents.find(doc => doc.isPrimary)!;
    if (primary.url !== payload.primary_document_url || primary.text !== payload.primary_document_html)
      return fail("form25_primary_source_mismatch");
    // All retained cleaned attachments must also have their original source.
    if (rows(payload.attachment_texts).some(doc => !documents.some(source => source.url === doc.url)))
      return fail("form25_original_attachment_missing");
  } else {
    // Preserve legacy XML read-back; legacy attachment hashes identify stored
    // extracted text, not original HTTP bytes.
    const primaryText = text(payload.primary_document_html);
    if (!primaryText || payload.primary_document_html_truncated === true
      || typeof payload.primary_document_html_char_count === "number" && payload.primary_document_html_char_count !== primaryText.length)
      return fail("verified_form25_xml_unavailable");
    documents = [{ url: text(payload.primary_document_url), text: primaryText, type: text(payload.form_type),
      description: null, isPrimary: true, sha256: sourceHash(primaryText), charCount: primaryText.length, truncated: false },
    ...rows(payload.attachment_texts).map(doc => ({ url: text(doc.url), text: text(doc.text),
      type: text(doc.type), description: text(doc.description), isPrimary: false,
      sha256: sourceHash(text(doc.text)), charCount: text(doc.text).length, truncated: doc.textTruncated === true }))];
    if (documents.some(doc => !officialForm25Source(doc.url, accession) || !doc.text || doc.truncated))
      return fail("unverified_attachment_source");
  }
  const xmlDocuments = documents.filter(doc => /<notificationOfRemoval\b/i.test(doc.text));
  if (xmlDocuments.length > 1) return fail("form25_xml_source_ambiguous");
  const primary = xmlDocuments[0] ?? documents.find(doc => doc.isPrimary)!;
  const isXml = xmlDocuments.length === 1;
  if (isXml && ["notificationOfRemoval", "issuer", "descriptionClassSecurity", "exchange"].some(tag =>
    (primary.text.match(new RegExp(`<${tag}\\b`, "gi")) || []).length !== 1))
    return fail("form25_xml_identity_ambiguous");
  const primaryText = isXml ? primary.text : form25DocumentText(primary.text);
  const attachments = documents.filter(doc => doc !== primary).map((doc, index) => ({
    ...doc, source: `notice_${index}`, text: original ? form25DocumentText(doc.text) : doc.text,
  }));
  const base = { rawItemId: text(raw.id), sourceUniqueId: accession, sourceUrl: primary.url,
    publishedAt: text(raw.published_at), bodyText: primaryText,
    rawPayload: { form_type: payload.form_type, filing_date: payload.filing_date } };
  const identity = parseSecForm25Filing(base);
  const parser = parseSecForm25Filing({ ...base, rawPayload: { ...base.rawPayload, attachment_texts: attachments } });
  return { status: "available" as const, original, isXml, primary, primaryText, attachments, documents, identity, parser };
}

/** Text projection only; the original markup remains independently retained. */
function form25DocumentText(input: string) {
  return decodeSecHtmlEntities(input.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<ix:hidden[\s\S]*?<\/ix:hidden>|<\?xml[\s\S]*?\?>/gi, " ")
    .replace(/<\/(p|div|tr|table|section|article|h[1-6])>|<br\s*\/?>/gi, "\n").replace(/<\/(td|th)>/gi, " | "))
    .replace(/<[^>]+>/g, " ").replace(/\r/g, "\n").replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function officialForm25Source(url: string, accession: string) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "www.sec.gov"
    && /^\d{10}-\d{2}-\d{6}$/.test(accession)
    && new RegExp(`^/Archives/edgar/data/\\d+/${accession.replaceAll("-", "")}/(?:xsl[^/]+/)?[^/]+$`, "i").test(parsed.pathname); }
  catch { return false; }
}
function sourceHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function record(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.map(record) : []; }
