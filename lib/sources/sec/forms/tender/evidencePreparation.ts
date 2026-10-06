import type { SecTenderParseInput } from "./types.ts";
import type { TenderSourcePacket, TenderSourceDocument } from "./evidenceSource.ts";

const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown) => Array.isArray(v) ? v.map(record) : [];
const str = (v: unknown) => typeof v === "string" ? v : "";

/** Adapter for existing fetched Tender input. Never uses analysisText, parser output or inferred form.
 * Identity joins require URL/filename; labels/types are not safe document identifiers.
 */
export function prepareTenderEvidence(input: SecTenderParseInput): TenderSourcePacket {
  const raw = record(input.rawPayload);
  const accession = str(raw.accession_number);
  const form = str(raw.form_type);
  const inventory = list(raw.documents);
  const attachments = [...list(raw.attachment_texts), ...list(input.attachmentTexts)];
  const packet: TenderSourcePacket = { accession, form, documents: [], unavailable: [] };
  for (const doc of inventory) {
    const documentId = str(doc.document) || str(doc.filename);
    const url = str(doc.url);
    if (!documentId || !url) { packet.unavailable.push({ documentId: documentId || "unidentified", reason: "missing-document-identity" }); continue; }
    const matches = attachments.filter((a) => (str(a.url) && a.url === url) || ((str(a.document) || str(a.filename)) === documentId));
    if (matches.length > 1) { packet.unavailable.push({ documentId, reason: "ambiguous-source-identity" }); continue; }
    const attachment = matches[0];
    if (attachment && ((str(attachment.url) && attachment.url !== url) || ((str(attachment.document) || str(attachment.filename)) && (str(attachment.document) || str(attachment.filename)) !== documentId))) {
      packet.unavailable.push({ documentId, reason: "conflicting-source-identity" }); continue;
    }
    // bodyText may be a combined filing, so only explicitly document-bound text is accepted.
    const primaryHtml = doc.isPrimary === true && raw.primary_document_url === url ? str(raw.primary_document_html) : "";
    const content = primaryHtml || str(doc.text) || str(attachment?.text);
    if (!content || doc.fetchError || (typeof doc.fetchStatus === "number" && doc.fetchStatus >= 400)) { packet.unavailable.push({ documentId, reason: str(doc.fetchError) || "document-text-not-supplied" }); continue; }
    const truncated = primaryHtml ? raw.primary_document_html_truncated : doc.textTruncated;
    const source: TenderSourceDocument = { accession, form, documentId, url, role: doc.isPrimary === true ? "primary" : "attachment", content, format: /<(?:html|body|p|div|table)\b/i.test(content) ? "html" : "text", completeness: truncated === true ? "truncated" : (truncated === false ? "complete" : "excerpt") };
    packet.documents.push(source);
  }
  return packet;
}
