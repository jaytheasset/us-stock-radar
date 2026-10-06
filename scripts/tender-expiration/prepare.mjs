// Read-only SEC acquisition -> unchanged Tender Evidence search/read -> selected slices.
// No LLM, DB or full-document persistence. Run before freezing the paid-call plan.
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildTenderEvidenceIndex } from '../../lib/sources/sec/forms/tender/evidenceRetrieval.ts';
import { renderTenderSource, tenderSourceHash } from '../../lib/sources/sec/forms/tender/evidenceSource.ts';

const dir = fileURLToPath(new URL('./', import.meta.url));
try { await access(`${dir}results/started.json`); throw new Error('Experiment already started; frozen inputs cannot be rebuilt'); } catch (e) { if(e.code !== 'ENOENT') throw e; }
const cases = [
  ['initial',1,'SC TO-I','attachment','https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm'],
  ['extension',2,'SC TO-T/A','primary','https://www.sec.gov/Archives/edgar/data/1697532/000119312526026154/d805076dsctota.htm'],
  ['unchanged-amendment',3,'SC TO-T/A','attachment','https://www.sec.gov/Archives/edgar/data/1643303/000121390023055698/sctota10ex99-a1o_nano.htm'],
  ['many-dates',4,'SC TO-T','attachment','https://www.sec.gov/Archives/edgar/data/1067701/000110465925006713/tm253288d1_ex99-a1a.htm'],
  ['already-expired',5,'SC TO-I/A','primary','https://www.sec.gov/Archives/edgar/data/1702510/000170251026000009/cars_2026130xsctoa.htm'],
  ['conditional',6,'CB','attachment','https://www.sec.gov/Archives/edgar/data/1629583/000106299317000336/exhibit1-1.htm'],
  ['partial',7,'SC 14D9','primary','https://www.sec.gov/Archives/edgar/data/1697532/000119312525335440/d84762dsc14d9.htm'],
  ['not-established',8,'SC TO-C','primary','https://www.sec.gov/Archives/edgar/data/1610618/000119312525281502/d46394dsctoc.htm'],
];
const queries = [
  'What is the offer expiration or expiry time and deadline, and can it be extended?',
  'Has the expiration date been changed, previously scheduled, extended, expired, or explicitly still unchanged?',
];
const prepared = [];
for (const [name,type,form,role,url] of cases) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: {'User-Agent':'StockRadar/1.0 evidence verification admin@stockradar.app'} });
  assert.equal(response.status,200,url);
  const html = await response.text(); assert.match(html, /<html/i);
  const rendered = renderTenderSource(html);
  const compact = new URL(url).pathname.split('/').at(-2);
  const accession = `${compact.slice(0,10)}-${compact.slice(10,12)}-${compact.slice(12)}`;
  const documentId = new URL(url).pathname.split('/').at(-1);
  // Controlled partial-source test uses an exact prefix, never paraphrased/edited text.
  const content = name === 'partial' ? rendered.slice(0,5000) : html;
  const document = { accession,form,documentId,url,role,content,format:name==='partial'?'text':'html',completeness:name==='partial'?'truncated':'complete' };
  const index = buildTenderEvidenceIndex({ accession,form,documents:[document],unavailable:[] });
  // This source-language question addresses an observed pre-call retrieval gap in CB
  // terminology. It is applied to every input; the underlying selector is unchanged.
  const caseQueries = [...queries, 'Until what date and time is the offer open for acceptance?'];
  const searches = caseQueries.map(question => index.search_evidence({accession,question,limit:5}));
  const ids = [...new Set(searches.flatMap(s=>s.hits.map(h=>h.id)))];
  assert.ok(ids.length, `${name}: source search returned no evidence`);
  const read = index.read_evidence({accession,ids,maxChars:200000}); assert.equal(read.status,'read');
  const representation = name==='partial'?content:rendered;
  for(const e of read.evidence) assert.equal(e.text,representation.slice(e.location.start,e.location.end));
  const source = {accession,form,coverage:{partialDocuments:read.partialDocuments,unavailable:read.unavailable,externalReferences:read.externalReferences,selection:'bounded source slices; not the complete filing'},evidence:read.evidence};
  prepared.push({name,type,source,acquisition:{url,originalDocumentHash:tenderSourceHash(html),renderedHash:tenderSourceHash(rendered),fullRenderedChars:rendered.length,inputChars:content.length,controlledTruncation:name==='partial'?{representation:'tender-render-v1',start:0,end:5000}:null},queries:caseQueries,searches});
  console.log(JSON.stringify({name,accession,type,units:ids.length,chars:read.requiredChars,partial:read.partialDocuments}));
}
assert.equal(new Set(prepared.map(x=>x.source.accession)).size,prepared.length);
await mkdir(`${dir}fixtures`,{recursive:true});
await writeFile(`${dir}fixtures/inputs.json`,JSON.stringify(prepared,null,2)+'\n');
