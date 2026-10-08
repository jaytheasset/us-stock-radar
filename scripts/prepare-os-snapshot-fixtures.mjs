// Explicit offline import of the user's frozen experiment. Never calls a provider.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {validateOutput} from '../lib/sec-os-snapshot/contract.ts';
const root=process.argv[2];if(!root)throw Error('Frozen artifact directory required');
const json=p=>JSON.parse(readFileSync(p,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const cases=[...json(join(root,'regression-selection.json')),...json(join(root,'blind-selection.json')).cases];
const target='lib/sec-os-snapshot/fixtures';mkdirSync(target,{recursive:true});const manifest=[];
for(const c of cases){
 const dir=c.source??c.input, output=readFileSync(join(c.output,'single-extraction.json'));
 if(hash(output)!==json(join(c.output,'single-extraction-freeze.json')).sha256)throw Error('Frozen output hash mismatch');
 const value=JSON.parse(output), docs=json(join(dir,'documents.json')).documents;
 const documents=docs.map(d=>{
   const originalBytes=readFileSync(join(dir,d.original_path)), textBytes=readFileSync(join(dir,d.text_path));
   if(hash(originalBytes)!==d.original_sha256||hash(textBytes)!==d.text_sha256)throw Error('Frozen source hash mismatch');
   return {id:d.id,url:d.url,original:originalBytes.toString('utf8'),text:textBytes.toString('utf8'),original_sha256:d.original_sha256,text_sha256:d.text_sha256};
 });
 const blocks=readFileSync(join(dir,'blocks.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
 const fullSource={filing:value.filing,ticker:null,documents,blocks,fingerprint:hash(JSON.stringify(documents))};
 const validation=validateOutput(output.toString('utf8'),fullSource);if(!validation.ok)throw Error(JSON.stringify(validation));
 // Commit small source excerpts, not a bundled archive of fourteen complete filings.
 // Preserve exact cited text/IDs/line positions; full source hashes are recorded separately.
 const refs=new Set([...value.current_os,...(value.review?.candidates??[])].flatMap(r=>r.evidence_blocks));
 const retainedBlocks=blocks.filter(b=>refs.has(b.id));
 const excerpts=documents.filter(d=>retainedBlocks.some(b=>b.document_id===d.id)).map(d=>{
   const selected=retainedBlocks.filter(b=>b.document_id===d.id), lines=Array(Math.max(...selected.map(b=>b.line_end))).fill('');
   for(const b of selected)b.text.split('\n').forEach((line,i)=>{lines[b.line_start-1+i]=line;});
   const text=lines.join('\n');return {...d,text,original:text,text_sha256:hash(text),original_sha256:hash(text)};
 });
 const source={...fullSource,documents:excerpts,blocks:retainedBlocks};
 const compressed=gzipSync(JSON.stringify(source),{level:9});
 writeFileSync(join(target,c.case_id+'.json'),output);writeFileSync(join(target,c.case_id+'.source.json.gz'),compressed);
 manifest.push({id:c.case_id,outputSha256:hash(output),sourceArchiveSha256:hash(compressed),fullSourceValidation:validation.stage,originalDocuments:documents.map(({id,original_sha256,text_sha256})=>({id,original_sha256,text_sha256})),fixtureKind:'exact cited excerpts; original JSON unchanged'});
}
writeFileSync(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({count:manifest.length}));
