import {renderS4F4SourceHtml} from '../sources/sec/forms/s4-f4/sourceSelector.ts';
import {sha,stable,type Block} from '../sec-os-snapshot/contract.ts';
import type {Source} from '../sec-offering-plan/contract.ts';
import {FORMS} from './schema.ts';

export const SOURCE_REVISION = 'combined_offering_source_v1';
export type CombinedSource = Source & {sourceVersion: typeof SOURCE_REVISION};
export const isCombinedForm = (form: unknown): form is typeof FORMS[number] =>
  typeof form === 'string' && (FORMS as readonly string[]).includes(form);
const dateValid = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
const optionalText = (s: unknown) => typeof s === 'string' && s.trim() ? s : null;
const unavailable = (reason: string) => ({ok: false as const, status: 'UNAVAILABLE' as const, reason});

/** New domestic-only input boundary. Existing O/S and F1 source contracts are untouched. */
export function buildCombinedSource(raw: Record<string, any>) {
  const p = raw.raw_payload;
  if (!p || typeof p !== 'object' || raw.source_code !== 'sec_edgar' || !isCombinedForm(p.form_type)) {
    return unavailable('unsupported_source_or_form');
  }
  if (typeof p.accession_number !== 'string' || !/^\d{10}-\d{2}-\d{6}$/.test(p.accession_number)
    || p.accession_number !== raw.source_unique_id || typeof p.company_name !== 'string' || !p.company_name.trim()
    || typeof p.cik !== 'string' || !/^\d{10}$/.test(p.cik) || /^0+$/.test(p.cik) || !dateValid(p.filing_date)) {
    return unavailable('official_filing_metadata_incomplete_or_invalid');
  }
  if (typeof p.primary_document_html !== 'string' || !p.primary_document_html.length || p.primary_document_html_truncated !== false) {
    return unavailable('complete_primary_source_required');
  }
  const filing = {issuer: p.company_name, cik: p.cik, accession: p.accession_number, form: p.form_type,
    filing_date: p.filing_date, accepted_at: optionalText(p.accepted_at), file_number: optionalText(p.file_number),
    registration_number: optionalText(p.registration_number)};
  const original = p.primary_document_html, text = renderS4F4SourceHtml(original);
  if (!text.trim()) return unavailable('empty_source');
  const id = `${filing.accession}:combined-primary:${sha(original).slice(0,16)}`;
  const document = {id, url: optionalText(p.primary_document_url) ?? optionalText(raw.source_url) ?? '', original, text,
    original_sha256: sha(original), text_sha256: sha(text)};
  const blocks: Block[] = [], lines = text.split('\n');
  for (let n = 0; n < lines.length; n += 40) {
    const part = lines.slice(n,n+40).join('\n');
    blocks.push({id: `${id}:L${n+1}`, document_id: id, line_start: n+1,
      line_end: Math.min(n+40,lines.length), text: part, sha256: sha(part)});
  }
  const content: Omit<CombinedSource,'fingerprint'> = {sourceVersion: SOURCE_REVISION, filing, ticker: optionalText(p.ticker), documents: [document], blocks};
  return {ok: true as const, source: {...content, fingerprint: sha(stable(content))} satisfies CombinedSource};
}

/** Rebuild from retained source bytes, without changing caller data or accepting experimental IDs. */
export function assertCombinedSource(source: CombinedSource) {
  if (source.sourceVersion !== SOURCE_REVISION || source.documents.length !== 1) throw Error('combined_source_contract_mismatch');
  const d = source.documents[0], f = source.filing;
  const rebuilt = buildCombinedSource({source_code: 'sec_edgar', source_unique_id: f.accession,
    raw_payload: {company_name:f.issuer, cik:f.cik, accession_number:f.accession, form_type:f.form,
      filing_date:f.filing_date, accepted_at:f.accepted_at, file_number:f.file_number, registration_number:f.registration_number,
      ticker:source.ticker, primary_document_url:d.url, primary_document_html:d.original, primary_document_html_truncated:false}});
  if (!rebuilt.ok || stable(rebuilt.source) !== stable(source)) throw Error('combined_source_integrity_mismatch');
}
