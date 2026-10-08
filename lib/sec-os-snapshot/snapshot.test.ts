import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {sha,validateOutput,type Source} from './contract.ts';
import {bindingFor,buildSource} from './source.ts';
const dir='lib/sec-os-snapshot/fixtures/';
const manifest=JSON.parse(readFileSync(dir+'manifest.json','utf8')) as {id:string;outputSha256:string;sourceArchiveSha256:string}[];
export function fixture(id=manifest[0].id) {return {raw:readFileSync(dir+id+'.json','utf8'),source:JSON.parse(gunzipSync(readFileSync(dir+id+'.source.json.gz')).toString()) as Source};}
for(const item of manifest) test(`frozen ${item.id}: untouched JSON, schema and retained evidence references`,()=>{
 const {raw,source}=fixture(item.id);assert.equal(sha(raw),item.outputSha256);assert.equal(sha(readFileSync(dir+item.id+'.source.json.gz')),item.sourceArchiveSha256);
 assert.deepEqual(validateOutput(raw,source).errors,[]);assert.equal(validateOutput(raw,source).ok,true);
});
test('foreign filing blocks and filing identity are rejected; no correction',()=>{
 const a=fixture(),b=fixture('canaan-f1'),v=JSON.parse(a.raw);v.current_os[0].evidence_blocks=[b.source.blocks[0].id];
 const raw=JSON.stringify(v);assert.equal(validateOutput(raw,a.source).ok,false);assert.equal(JSON.stringify(v),raw);
 assert.equal(validateOutput(a.raw,b.source).ok,false);
});
test('schema invalid quantity is preserved and never coerced',()=>{
 const {raw,source}=fixture(),v=JSON.parse(raw);v.current_os[0].quantity=123;const original=JSON.stringify(v);
 assert.equal(validateOutput(original,source).stage,'schema');assert.equal(JSON.stringify(v),original);
});
test('no-direct is terminal; review candidates never become current_os',()=>{
 const {raw,source}=fixture('tcb-f1a-full');const v=validateOutput(raw,source);assert.equal(v.value?.status,'REVIEW_REQUIRED');assert.deepEqual(v.value?.current_os,[]);
 const empty={version:'os_snapshot_v1',filing:source.filing,status:'NO_DIRECT_CURRENT_OS',current_os:[],review:null};
 assert.equal(validateOutput(JSON.stringify(empty),source).ok,true);
});
test('binding revisions/fingerprint/hashes and complete source readiness',()=>{
 const {source}=fixture();const id='00000000-0000-5000-a000-000000000001',a=bindingFor(id,source);
 assert.equal(bindingFor(id,source).key,a.key);assert.notEqual(bindingFor(id,{...source,fingerprint:sha('new')}).key,a.key);assert.notEqual(bindingFor(id,source,'next').key,a.key);
 assert.throws(()=>buildSource({source_code:'sec_edgar',source_unique_id:source.filing.accession,raw_payload:{accession_number:source.filing.accession,form_type:'F-1',primary_document_html:'x',primary_document_html_truncated:true}}),/not_ready/);
});
