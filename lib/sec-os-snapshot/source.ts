import { renderS4F4SourceHtml } from "../sources/sec/forms/s4-f4/sourceSelector.ts";
import { sha, stable, record, type Source, type Block, REVISION, PROFILE, schemaHash, promptHash } from "./contract.ts";

export const isOsForm = (form: unknown) => form === "F-1" || form === "F-1/A";
/** All primary-document lines, in order. No topic selection or value extraction. */
export function buildSource(raw: Record<string, any>): Source {
  const p = record(raw.raw_payload);
  if (raw.source_code !== "sec_edgar" || !isOsForm(p.form_type) || p.accession_number !== raw.source_unique_id || !/^\d{10}-\d{2}-\d{6}$/.test(p.accession_number ?? "")) throw Error("os_source_identity_invalid");
  const retained = typeof p.os_snapshot_primary_html === 'string' && p.os_snapshot_primary_html.length > 0 ? p.os_snapshot_primary_html : null;
  if (!retained && (!p.primary_document_html || p.primary_document_html_truncated !== false)) throw Error("os_source_not_ready");
  const filing = { issuer: String(p.company_name ?? ""), cik: String(p.cik ?? "").padStart(10,"0"), accession: p.accession_number as string, form: p.form_type as string, filing_date: String(p.filing_date ?? "") };
  if (!filing.issuer || !/^\d{10}$/.test(filing.cik) || !/^\d{4}-\d{2}-\d{2}$/.test(filing.filing_date)) throw Error("os_metadata_not_ready");
  const original = retained ?? String(p.primary_document_html), text = renderS4F4SourceHtml(original);
  if (!text.trim()) throw Error("os_source_empty");
  const id = `${filing.accession}:primary:${sha(original).slice(0,16)}`;
  const document = { id, url: String(p.primary_document_url || raw.source_url || ""), original, text, original_sha256: sha(original), text_sha256: sha(text) };
  const lines = text.split("\n"), blocks: Block[] = [];
  for (let n=0; n<lines.length; n+=40) {
    const part = lines.slice(n,n+40).join("\n");
    blocks.push({ id: `${id}:L${n+1}`, document_id: id, line_start: n+1, line_end: Math.min(n+40,lines.length), text: part, sha256: sha(part) });
  }
  const content = { filing, ticker: typeof p.ticker === "string" ? p.ticker : null, documents: [document], blocks };
  return { ...content, fingerprint: sha(stable(content)) };
}
export function bindingFor(rawItemId: string, source: Source, revision = REVISION) {
  const key = sha(stable([rawItemId, source.filing.accession, source.fingerprint, revision, schemaHash, promptHash, PROFILE]));
  return { id: `${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`,
    key, rawItemId, source, sourceFingerprint: source.fingerprint, contractVersion: revision, schemaHash, promptHash, providerProfile: PROFILE };
}
export type Binding = ReturnType<typeof bindingFor>;
