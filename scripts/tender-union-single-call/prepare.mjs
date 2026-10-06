// One filing-scoped Evidence index and one unified packet; no semantic extraction.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildTenderEvidenceIndex} from '../../lib/sources/sec/forms/tender/evidenceRetrieval.ts';
import {renderTenderSource,tenderSourceHash} from '../../lib/sources/sec/forms/tender/evidenceSource.ts';
export function dedupe(hits){
 const unique=[...new Map(hits.map(h=>[h.id,h])).values()];
 return unique.filter((h,i)=>!unique.some((other,j)=>i!==j&&h.accession===other.accession&&h.document.documentId===other.document.documentId&&h.sourceHash===other.sourceHash&&h.renderedHash===other.renderedHash&&h.location.representation===other.location.representation&&other.location.start<=h.location.start&&other.location.end>=h.location.end&&(other.chars>h.chars||j<i)));
}
async function main(){
 const root=fileURLToPath(new URL('./',import.meta.url)),plan=JSON.parse(await readFile(join(root,'selection/source-plan.json'),'utf8')),out=join(root,'selection/final-sources');await mkdir(out);
 for(const c of plan.cases){
  const response=await fetch(c.url,{headers:{'User-Agent':'StockRadar/1.0 evidence verification admin@stockradar.app'},signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
  const html=await response.text(),rendered=renderTenderSource(html),compact=new URL(c.url).pathname.split('/').at(-2),accession=`${compact.slice(0,10)}-${compact.slice(10,12)}-${compact.slice(12)}`;
  const document={accession,form:c.form,documentId:new URL(c.url).pathname.split('/').at(-1),url:c.url,role:c.role,content:html,format:'html',completeness:'complete'};
  const index=buildTenderEvidenceIndex({accession,form:c.form,documents:[document],unavailable:[]}),searches=plan.queries.map(question=>index.search_evidence({accession,question,limit:5})),all=searches.flatMap(s=>s.hits),selected=dedupe(all);
  const evidence=[];let coverage;let reads=0;
  for(let i=0;i<selected.length;i+=20){const r=index.read_evidence({accession,ids:selected.slice(i,i+20).map(h=>h.id),maxChars:200000});assert.equal(r.status,'read');reads++;coverage=r;evidence.push(...r.evidence);}
  for(const e of evidence){assert.equal(e.text,rendered.slice(e.location.start,e.location.end));assert.equal(e.accession,accession);assert.equal(tenderSourceHash(e.text),e.textHash);}
  const source={accession,form:c.form,coverage:{partialDocuments:coverage.partialDocuments,unavailable:coverage.unavailable,externalReferences:coverage.externalReferences,selection:'bounded source slices; not the complete filing'},evidence};
  const acquisition={url:c.url,httpStatus:200,sourceHash:tenderSourceHash(html),renderedHash:tenderSourceHash(rendered),renderedChars:rendered.length,queries:plan.queries,searches,rawHits:all.length,uniqueIds:new Set(all.map(h=>h.id)).size,selectedIds:selected.map(h=>h.id),dedupe:'exact id then wholly contained same-document/same-revision source ranges; no text edits, stitching or semantic filter',indexBuilds:1,readCalls:reads,selectedChars:evidence.reduce((n,e)=>n+e.text.length,0)};
  for(const [name,value]of [[c.name+'.json',source],[c.name+'.acquisition.json',acquisition]])await writeFile(join(out,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({case:c.name,units:evidence.length,chars:acquisition.selectedChars,reads}));
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main();
