import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {types,buildProviderSchema,buildRequest,validateOutput,validateCanonical,projectCanonical,systemPrompt} from './contract.mjs';
import {prior,folder,json,hash,callOnce,accession,sourceFiles} from './run.mjs';
import {projectSource,resolveRefs} from '../tender-fact-batches/runner.mjs';

const source=await json(join(prior,'source.json')),p=projectSource(source),refs=p.providerSource.evidence.map(e=>e.ref);
const mapBytes=await readFile(join(prior,'evidence-map.json'),'utf8'),frozenMapHash=hash(mapBytes);
const empty=()=>Object.fromEntries([...types.map(t=>[t,null]),['unresolved',[]]]);
const price=amount=>({amount,currency_text:'USD',unit:'cash_per_share'});
const positive=type=>({current:type==='expiration'?'2030-05-02':type==='offer_price'?price(10):'accept',previous:null,current_evidence_refs:['E1'],previous_evidence_refs:[]});
const valid=v=>validateOutput(JSON.stringify(v),refs).local.valid;
const withSlot=type=>({...empty(),[type]:positive(type)});

test('01 all five root slots required in provider and local shape',()=>{
 const schema=buildProviderSchema(refs);assert.deepEqual(schema.required,[...types,'unresolved']);
 for(const t of [...types,'unresolved']){const v=empty();delete v[t];assert.equal(valid(v),false);assert.equal(validateOutput(JSON.stringify(v),refs).providerSchema.valid,false);}
});
test('02 all null slots accepted; no canonical false inferred',()=>{assert.equal(valid(empty()),true);for(const t of types)assert.deepEqual(buildProviderSchema(refs).properties[t].type,['object','null']);});
for(const [i,t]of ['expiration','offer_price','board_recommendation'].entries())test(`0${i+3} ${t} requires previous decision`,()=>{
 const v=withSlot(t);assert.equal(valid(v),true);delete v[t].previous;assert.equal(valid(v),false);
 assert.ok(buildProviderSchema(refs).properties[t].required.includes('previous'));
});
test('06 previous value requires previous refs for all historical types',()=>{
 for(const t of types.slice(0,3)){const v=withSlot(t);v[t].previous=v[t].current;assert.equal(valid(v),false);v[t].previous_evidence_refs=['E2'];assert.equal(valid(v),true);delete v[t].previous_evidence_refs;assert.equal(valid(v),false);}
});
test('07 null previous requires explicit empty previous refs',()=>{
 for(const t of types.slice(0,3)){const v=withSlot(t);assert.equal(valid(v),true);v[t].previous_evidence_refs=['E2'];assert.equal(valid(v),false);delete v[t].previous_evidence_refs;assert.equal(valid(v),false);}
});
test('08 foreign refs rejected in every ref location',()=>{
 for(const t of types.slice(0,3))for(const field of ['current_evidence_refs','previous_evidence_refs']){const v=withSlot(t);v[t].previous=v[t].current;v[t].previous_evidence_refs=['E2'];v[t][field]=['E999'];assert.equal(valid(v),false);}
 for(const t of types.slice(3)){const v=empty();v[t]=t==='offer_status'?{current:'terminated',evidence_refs:['E999']}:{observed:true,evidence_refs:['E999']};assert.equal(valid(v),false);}
});
test('09 duplicate refs rejected within arrays; cross-field sharing allowed',()=>{
 for(const t of types.slice(0,3))for(const field of ['current_evidence_refs','previous_evidence_refs']){const v=withSlot(t);v[t].previous=v[t].current;v[t].previous_evidence_refs=['E1'];assert.equal(valid(v),true);v[t][field]=['E1','E1'];assert.equal(valid(v),false);}
 for(const t of types.slice(3)){const v=empty();v[t]=t==='offer_status'?{current:'terminated',evidence_refs:['E1','E1']}:{observed:true,evidence_refs:['E1','E1']};assert.equal(valid(v),false);}
});
test('10 projection preserves even wrong-but-well-shaped values and selected refs',()=>{
 const v=empty();for(const t of types.slice(0,3)){v[t]=positive(t);v[t].previous=t==='expiration'?'2029-04-03':t==='offer_price'?price(999):'reject';v[t].previous_evidence_refs=['E1','E3'];}
 v.offer_status={current:'withdrawn',evidence_refs:['E4']};v.final_results_observed={observed:true,evidence_refs:['E5']};v.unresolved=['expiration: test only'];
 const before=structuredClone(v),out=projectCanonical(v);assert.deepEqual(v,before);assert.equal(out.facts.length,5);
 for(const f of out.facts){if('current'in f)assert.deepEqual(f.current,v[f.type].current);if('previous'in f)assert.deepEqual(f.previous,v[f.type].previous);}
 assert.deepEqual(out.facts[0].evidence_refs,['E1','E3']);assert.deepEqual(out.unresolved,v.unresolved);
 assert.equal(validateCanonical(JSON.stringify(out),refs).local.valid,true);
 out.facts[1].current.amount=123;assert.equal(v.offer_price.current.amount,10);
 const noPrevious=projectCanonical(withSlot('expiration'));assert.equal('previous'in noPrevious.facts[0],false);
});
test('11 null slots create no canonical facts',()=>assert.deepEqual(projectCanonical(empty()),{facts:[],unresolved:[]}));
test('12 observed false forbidden',()=>assert.equal(valid({...empty(),final_results_observed:{observed:false,evidence_refs:['E1']}}),false));
test('13 status false/unknown forbidden',()=>{for(const current of [false,'unknown','expired'])assert.equal(valid({...empty(),offer_status:{current,evidence_refs:['E1']}}),false);});
test('14 exact v1 source/provider/map bytes and frozen hashes; unchanged E ordering',async()=>{
 const old=await json(join(prior,'frozen.json'));
 for(const f of sourceFiles){const bytes=await readFile(join(prior,f));assert.equal(hash(bytes),old.files[f]);try{assert.deepEqual(await readFile(join(folder,f)),bytes);}catch(e){if(e.code!=='ENOENT')throw e;}}
 assert.equal(refs.length,18);assert.deepEqual(refs,source.evidence.map((_,i)=>`E${i+1}`));assert.deepEqual(JSON.parse(mapBytes),p.evidenceMap);
 assert.deepEqual(await json(join(prior,'provider-source.json')),p.providerSource);
});
test('15 exact generic request reconstruction and no non-source baseline leakage',async()=>{
 const request=buildRequest(p.providerSource),v1=await json(join(prior,'request.json'));
 assert.equal(request.contents[0].parts[0].text,v1.contents[0].parts[0].text);
 assert.deepEqual(Object.keys(request),['systemInstruction','contents','generationConfig']);
 const nonSource=JSON.stringify({...request,contents:[]});for(const token of ['2026-07-24','2026-06-22','0.84','0.82','DXL',accession,'"expected":','"baseline":'])assert.ok(!nonSource.includes(token));
 assert.ok(systemPrompt.length<v1.systemInstruction.parts[0].text.length);
});

async function setup(){
 const dir=await mkdtemp(join(tmpdir(),'tender-v2-offline-'));
 await writeFile(join(dir,'evidence-map.json'),mapBytes);
 return {folder:dir,identity:{runId:'offline-mock',accession},source,body:JSON.stringify(buildRequest(p.providerSource)),mapBytes,frozenMapHash,key:'mock-only'};
}
function response(output=empty(),status=200,finishReason='STOP'){return {ok:status===200,status,text:async()=>JSON.stringify({modelVersion:'gemini-3.5-flash',candidates:[{finishReason,content:{parts:[{text:typeof output==='string'?output:JSON.stringify(output)}]}}]})};}
test('16 max one physical fetch; exclusive reservation blocks concurrent/repeated call',async()=>{
 const args=await setup();let count=0;const fetchImpl=async(url,opts)=>{count++;assert.ok(url.endsWith('/gemini-3.5-flash:generateContent'));assert.equal(opts.redirect,'error');assert.equal((await json(join(args.folder,'started.json'))).physicalCallLimit,1);return response();};
 const outcomes=await Promise.allSettled([callOnce({...args,fetchImpl}),callOnce({...args,fetchImpl})]);assert.equal(count,1);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await json(join(args.folder,'audit.json'))).technicalPass,true);
 await assert.rejects(callOnce({...args,fetchImpl}));assert.equal(count,1);
});
test('17 no retry/repair/fallback on transport/HTTP/malformed/schema failure',async()=>{
 for(const kind of ['throw','http','malformed','schema','finish']){const args=await setup();let count=0;const fetchImpl=async()=>{count++;if(kind==='throw')throw Error('mock transport');return kind==='http'?response(empty(),503):kind==='malformed'?response('{bad'):kind==='schema'?response({facts:[]}):response(empty(),200,'MAX_TOKENS');};
  const audit=await callOnce({...args,fetchImpl});assert.equal(count,1);assert.equal(audit.technicalPass,false);assert.equal(audit.retries,0);assert.equal(audit.repairCalls,0);assert.equal(audit.fallbackCalls,0);await assert.rejects(callOnce({...args,fetchImpl}));assert.equal(count,1);
 }
});
test('18 provenance rejects changed hash/map identity, retains exact evidence IDs',()=>{
 const raw=JSON.stringify(projectCanonical(withSlot('expiration')));
 assert.equal(resolveRefs(raw,mapBytes,frozenMapHash,source,validateCanonical).valid,true);
 assert.equal(resolveRefs(raw,mapBytes,'wrong',source,validateCanonical).valid,false);
 const map=JSON.parse(mapBytes);map.E1.evidence_id='foreign';const changed=JSON.stringify(map);assert.equal(resolveRefs(raw,changed,hash(changed),source,validateCanonical).valid,false);
});
test('19 invalid inputs fail before network; successful mock projects without repair',async()=>{
 const args=await setup();let count=0;const fetchImpl=async()=>{count++;return response(withSlot('offer_price'));};
 await assert.rejects(callOnce({...args,mapBytes:mapBytes+' ',fetchImpl}));assert.equal(count,0);
 const audit=await callOnce({...args,fetchImpl});assert.equal(count,1);assert.equal(audit.technicalPass,true);assert.equal(audit.semanticCorrections,0);
 assert.deepEqual(await json(join(args.folder,'canonical.json')),projectCanonical(withSlot('offer_price')));
});
test('20 reject extra fields, missing current refs, wrong value shapes; never normalize',()=>{
 assert.equal(valid({...empty(),extra:true}),false);
 for(const t of types.slice(0,3)){const v=withSlot(t);v[t].current_evidence_refs=[];assert.equal(valid(v),false);delete v[t].current_evidence_refs;assert.equal(valid(v),false);}
 const v=withSlot('expiration');v.expiration.current='tomorrow';assert.equal(validateOutput(JSON.stringify(v),refs).providerSchema.valid,true);assert.equal(valid(v),false);
});
test('21 provider schema and provider-shape validator agree on nullable/required representations',()=>{
 // Independent interpreter of exactly the small JSON Schema subset emitted here.
 const accepts=(s,v)=>{
  const t=v===null?'null':Array.isArray(v)?'array':typeof v;
  if(![s.type].flat().includes(t)||s.enum&&!s.enum.includes(v))return false;
  if(t==='object')return s.required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>s.properties[k]&&accepts(s.properties[k],v[k]));
  if(t==='array')return v.length>=(s.minItems??0)&&v.every(x=>accepts(s.items,x));
  return true;
 };
 const cases=[empty(),...types.slice(0,3).map(withSlot)];
 for(const t of types.slice(0,3)){const v=withSlot(t);v[t].previous=v[t].current;v[t].previous_evidence_refs=['E2'];cases.push(v);const missing=structuredClone(v);delete missing[t].previous;cases.push(missing);}
 cases.push({...empty(),offer_status:{current:'withdrawn',evidence_refs:['E1']}},{...empty(),final_results_observed:{observed:true,evidence_refs:['E1']}},{...empty(),final_results_observed:{observed:false,evidence_refs:['E1']}},{...empty(),extra:1});
 for(const v of cases)assert.equal(accepts(buildProviderSchema(refs),v),validateOutput(JSON.stringify(v),refs).providerSchema.valid);
});
