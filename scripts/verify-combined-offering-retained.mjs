// Read-only verification of historical experimental evidence. Never execute external scripts,
// rewrite output references/metadata, call a provider, fetch SEC, or write to a database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {sha,stable} from '../lib/sec-os-snapshot/contract.ts';
import {evidenceRefs,planReferenceErrors} from '../lib/sec-offering-plan/contract.ts';
import {atmTermSchema} from '../lib/sec-offering-plan/atm.ts';
import {renderS4F4SourceHtml} from '../lib/sources/sec/forms/s4-f4/sourceSelector.ts';
import {buildCombinedSource} from '../lib/sec-combined-offering/source.ts';
import {combinedBinding,validateCombinedResponse} from '../lib/sec-combined-offering/contract.ts';

const [qualityRoot,atmRoot]=process.argv.slice(2);
if(!qualityRoot||!atmRoot)throw Error('Supply retained quality-r1 and ATM-r2 experiment directories');
const observed=new Map();
function read(path){const bytes=readFileSync(path);observed.set(resolve(path),sha(bytes));return bytes.toString('utf8');}
const json=path=>JSON.parse(read(path));
const results=[];
for(const [root,names,revision]of [[qualityRoot,['cava-s1','purecycle-s3'],'combined_offering_experiment_r1'],[atmRoot,['silvaco','shimmick-atm-amendment','ibio'],'combined_offering_experiment_r2']]){
 const manifest=json(join(root,'manifest.json')),schemaRaw=read(join(root,'schema.json')),prompt=read(join(root,'extraction-instructions.md'));
 assert.equal(sha(schemaRaw),manifest.schemaSha256);assert.equal(sha(prompt),manifest.promptSha256);
 const schema=JSON.parse(schemaRaw);assert.equal(schema.properties.version.const,revision);
 if(revision.endsWith('_r2'))assert.deepEqual(schema.$defs.off_atm_term,atmTermSchema);
 const ajv=new Ajv2020({allErrors:true,strict:false});addFormats(ajv);const validate=ajv.compile(schema);
 for(const name of names){
  const entry=manifest.cases.find(c=>c.name===name);assert.ok(entry);
  const dir=join(root,name),inputRaw=read(join(dir,'input.json')),input=JSON.parse(inputRaw),raw=read(join(dir,'output.json'));
  const output=JSON.parse(raw),retained=json(join(dir,'result.json')),text=read(join(dir,'source-visible.txt'));
  assert.equal(sha(inputRaw),entry.inputSha256);assert.equal(sha(raw),retained.outputSha256);
  assert.equal(sha(text),entry.textSha256);assert.equal(sha(read(join(dir,'request.txt'))),entry.requestSha256);
  assert.equal(validate(output),true,JSON.stringify(validate.errors));assert.equal(stable(output.filing),stable(input.filing));

  // Read candidate fixture copies for 424B, never run repository commands in main.
  let original;
  if(['cava-s1','purecycle-s3'].includes(name))original=read(entry.originalPath);
  else {
   const filename=name==='ibio'?'ibio-424b3-2026-01-30.json':name+'-424b5-2026-05-22.json';
   const container=JSON.parse(read(join(process.cwd(),'lib/sources/sec/forms/424b/fixtures/real-sec',filename)).replace(/^\uFEFF/,''));
   original=container.filingText;
  }
  assert.equal(sha(original),entry.originalSha256);
  let primary=original;
  if(/<DOCUMENT>/i.test(original)){
   const matching=[...original.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi)].map(m=>({
    type:m[1].match(/<TYPE>([^\r\n<]+)/i)?.[1]?.trim(),text:m[1].match(/<TEXT>([\s\S]*?)<\/TEXT>/i)?.[1],
   })).filter(d=>d.type===entry.form&&d.text);
   assert.equal(matching.length,1);primary=matching[0].text;
  }
  assert.equal(sha(primary),entry.primarySha256);assert.equal(renderS4F4SourceHtml(primary),text);
  assert.equal(input.documents.length,1);const document=input.documents[0];
  assert.equal(document.original_sha256,sha(primary));assert.equal(document.text_sha256,sha(text));
  const lines=text.split('\n');assert.equal(document.line_count,lines.length);
  const blocks=new Map(input.blocks.map(b=>[b.id,b]));assert.equal(blocks.size,input.blocks.length);
  let nextLine=1;
  for(const b of input.blocks){assert.equal(b.document_id,document.id);assert.equal(b.line_start,nextLine);
   assert.equal(b.text,lines.slice(b.line_start-1,b.line_end).join('\n'));assert.equal(sha(b.text),b.sha256);nextLine=b.line_end+1;}
  assert.equal(nextLine,lines.length+1);
  for(const id of evidenceRefs(output))assert.ok(blocks.has(id),'Unknown original evidence: '+id);
  assert.deepEqual(planReferenceErrors(output.offering_plan),[]);

  // Preserve metadata as supplied. Missing filing date cannot be filled from a filename/cover.
  const f=input.filing;
  const built=buildCombinedSource({id:'00000000-0000-4000-a000-000000000042',source_code:'sec_edgar',source_unique_id:f.accession,
   raw_payload:{company_name:f.issuer,cik:f.cik,accession_number:f.accession,form_type:f.form,filing_date:f.filing_date,
    accepted_at:f.accepted_at,file_number:f.file_number,registration_number:f.registration_number,
    primary_document_url:document.url,primary_document_html:primary,primary_document_html_truncated:false}});
  let productSource;
  if(built.ok){
   // Old experimental output is not accepted by the new product revision. No refs/version rewrite.
   const checked=validateCombinedResponse(raw,built.source,combinedBinding('00000000-0000-4000-a000-000000000042',built.source));
   assert.equal(checked.ok,false);assert.equal(checked.os_snapshot.stage,'envelope');
   productSource='READY_INPUT_ONLY; original experiment response rejected by product contract';
  } else productSource='UNAVAILABLE: '+built.reason;
  assert.equal(built.ok,['cava-s1','purecycle-s3'].includes(name));
  results.push({name,accession:f.accession,experimentRevision:revision,outputSha256:sha(raw),formatSourceReferences:'PASS',
   os:output.os_snapshot,offering:output.offering_plan,productSource,
   semanticReview:name==='purecycle-s3'?'HOLD: retained USD versus source $ normalization remains unresolved':'NOT_REASSESSED; retained source-backed observations only',
   actualProviderCallsThisVerification:0,productE2E:false});
 }
}
for(const [file,before]of observed)assert.equal(sha(readFileSync(file)),before,'Retained file changed: '+file);
console.log(JSON.stringify({retainedFilesUnchanged:true,actualProviderCalls:0,dbWrites:0,results},null,2));
