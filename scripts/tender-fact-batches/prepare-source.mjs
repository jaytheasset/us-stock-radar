// Public SEC source -> unchanged Tender Evidence search/read. No provider or semantic parser.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { buildTenderEvidenceIndex } from '../../lib/sources/sec/forms/tender/evidenceRetrieval.ts';
import { renderTenderSource, tenderSourceHash } from '../../lib/sources/sec/forms/tender/evidenceSource.ts';
const configPath=resolve(process.argv[2]);const dir=dirname(configPath);const config=JSON.parse(await readFile(configPath,'utf8'));
await mkdir(join(dir,'sources')); // Exclusive: do not revise a prepared input silently.
for(const c of config.cases){
 const r=await fetch(c.url,{headers:{'User-Agent':'StockRadar/1.0 evidence verification admin@stockradar.app'},signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,c.url);
 const html=await r.text();assert.match(html,/<html/i);const rendered=renderTenderSource(html);const compact=new URL(c.url).pathname.split('/').at(-2);
 const accession=`${compact.slice(0,10)}-${compact.slice(10,12)}-${compact.slice(12)}`;const documentId=new URL(c.url).pathname.split('/').at(-1);
 const document={accession,form:c.form,documentId,url:c.url,role:c.role,content:html,format:'html',completeness:'complete'};
 const index=buildTenderEvidenceIndex({accession,form:c.form,documents:[document],unavailable:[]});
 const searches=config.queries.map(question=>index.search_evidence({accession,question,limit:5}));const ids=[...new Set(searches.flatMap(s=>s.hits.map(h=>h.id)))];assert.ok(ids.length);
 const read=index.read_evidence({accession,ids,maxChars:200000});assert.equal(read.status,'read');
 for(const e of read.evidence)assert.equal(e.text,rendered.slice(e.location.start,e.location.end));
 const source={accession,form:c.form,coverage:{partialDocuments:read.partialDocuments,unavailable:read.unavailable,externalReferences:read.externalReferences,selection:'bounded source slices; not the complete filing'},evidence:read.evidence};
 await writeFile(join(dir,'sources',c.name+'.json'),JSON.stringify(source,null,2)+'\n',{flag:'wx'});
 await writeFile(join(dir,'sources',c.name+'.acquisition.json'),JSON.stringify({url:c.url,sourceHash:tenderSourceHash(html),renderedHash:tenderSourceHash(rendered),renderedChars:rendered.length,queries:config.queries,searches},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({name:c.name,accession,units:ids.length,chars:read.requiredChars}));
}
