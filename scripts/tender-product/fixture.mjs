import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {buildSecTenderParseInputFromArchiveSubmission} from '../../lib/sources/sec/forms/tender/parser.ts';
export const accession='0001702510-26-000009';
export const namespace='tender-product-carlyle-20261006';
export function fixture(){
 const saved=JSON.parse(readFileSync(new URL('../../lib/sources/sec/forms/tender/fixtures/archive-carlyle-final-sc-to-ia-submission.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
 const input=buildSecTenderParseInputFromArchiveSubmission({submissionText:saved.submission_text,sourceUrl:saved.source.sec_archive_url});
 // The legacy adapter omits attachment identity/text from inventory. Bind exact archive
 // DOCUMENT/FILENAME/TEXT bytes locally; do not call the semantic parser or edit fixture.
 const originals=[...saved.submission_text.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi)].map(m=>({name:m[1].match(/<FILENAME>\s*([^\r\n<]*)/i)?.[1]?.trim(),text:m[1].match(/<TEXT>([\s\S]*?)<\/TEXT>/i)?.[1]?.trim()??''}));
 const documents=input.rawPayload.documents.map(d=>{const matches=originals.filter(o=>o.name===d.document);assert.equal(matches.length,1);return {...d,text:matches[0].text,textTruncated:false};});
 assert.equal(input.sourceUniqueId,accession);
 return {id:'a30c2929-0466-4d94-9338-a1ba8d86628e',source_code:'sec_edgar',source_group:'filings',source_unique_id:input.sourceUniqueId,source_url:input.sourceUrl,title:input.title,published_at:input.publishedAt,body_text:input.bodyText,analysis_text:null,raw_payload:{...input.rawPayload,documents,attachment_texts:[]},metadata:{synthetic:true,verification:namespace},dedupe_key:`sec_edgar:${accession}`};
}
