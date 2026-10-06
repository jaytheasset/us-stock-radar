import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const namespace='tender-price-change-dxl-20261007';
export const accession='0001193125-26-298540';
export const ids={raw:'95142e2d-8a3e-474d-aa27-fb0d456d07a2',user:'fc20f31d-60c1-40a8-bbaa-4a39bbd3a715',monitor:'4bc79b0e-405d-4755-baee-c2648325e28c',event:'437c38a2-2bbf-40dc-89ad-2ca21eec1da3'};
export const condition={key:'tender.offer_price_change',operator:'eq',value:'changed'};
export function fixture(){
 const root=new URL('./artifacts/',import.meta.url);
 const acquisition=JSON.parse(fs.readFileSync(new URL('source-acquisition.json',root),'utf8'));
 const html=fs.readFileSync(new URL('sec-original.html',root),'utf8');
 assert.equal(createHash('sha256').update(html).digest('hex'),acquisition.sha256);
 const index=fs.readFileSync(new URL('../tender-terminal-facts/final_results_observed/dxl-interim-sec-index.html',import.meta.url),'utf8');
 assert.ok(index.includes('2026-07-08')&&index.includes('2026-07-08 16:11:42')&&index.includes('0001193125-26-298540'));
 const document=new URL(acquisition.url).pathname.split('/').at(-1);
 assert.equal(document,'sch14d9_amendment_3_july.htm');
 return {id:ids.raw,source_code:'sec_edgar',source_group:'filings',source_unique_id:accession,source_url:acquisition.url,
  title:'Destination XL Group, Inc. — SC 14D9/A',published_at:'2026-07-08T00:00:00Z',body_text:null,analysis_text:null,
  raw_payload:{accession_number:accession,form_type:'SC 14D9/A',filing_date:'2026-07-08',primary_document_url:acquisition.url,
   primary_document_html:html,primary_document_html_truncated:false,documents:[{document,url:acquisition.url,isPrimary:true}],attachment_texts:[]},
  metadata:{synthetic:true,verification:namespace,source_acquisition_sha256:acquisition.sha256},dedupe_key:`sec_edgar:${accession}`};
}
