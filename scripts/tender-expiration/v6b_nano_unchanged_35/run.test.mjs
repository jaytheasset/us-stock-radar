import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accession, callOnce, loadSource } from './run.mjs';
import { buildRequest, systemPrompt, validateOutput } from '../v3/contract.ts';
import { hash, projectSource } from '../v3/boundary.mjs';

test('Nano unchanged-amendment fixture has explicit unchanged expiration and distractor date coverage', async () => {
  const source=await loadSource();
  assert.equal(source.accession,accession);
  assert.equal(source.coverage.partialDocuments.length,0);
  assert.equal(source.coverage.unavailable.length,0);
  assert.equal(source.evidence.length,12);
  const joined=source.evidence.map(e=>e.text).join('\n');
  assert.match(joined,/Has the Expiration Date of the offer been changed\?[\s\S]*?No\. The Expiration Date of the offer is still 5:00 p\.m\., New York time, on July 24, 2023/i);
  assert.match(joined,/additional four \(4\) calendar-day period, until 5:00 p\.m\., New York time, on July 28, 2023/i);
});

test('provider projection contains only form coverage and opaque ref/text evidence', async () => {
  const source=await loadSource();
  const {providerSource}=projectSource(source);
  assert.deepEqual(Object.keys(providerSource),['form','coverage','evidence']);
  assert.deepEqual(providerSource.evidence.map(e=>e.ref),['E1','E2','E3','E4','E5','E6','E7','E8','E9','E10','E11','E12']);
  for (const e of providerSource.evidence) assert.deepEqual(Object.keys(e),['ref','text']);
  const sent=JSON.stringify(providerSource);
  for (const key of ['tender:','sourceHash','renderedHash','textHash','documentId','https://www.sec.gov','\"start\"','\"end\"']) assert.equal(sent.includes(key),false,key);
});

test('same v3 prompt and dynamic ref enum are used', async () => {
  const source=await loadSource();
  const {providerSource}=projectSource(source);
  const request=buildRequest(providerSource);
  assert.equal(request.systemInstruction.parts[0].text,systemPrompt);
  assert.deepEqual(request.generationConfig.responseJsonSchema.properties.facts.items.properties.evidence_refs.items.enum,
    ['E1','E2','E3','E4','E5','E6','E7','E8','E9','E10','E11','E12']);
});

test('local contract accepts current-only shape and rejects wrong format/unknown ref', async () => {
  const source=await loadSource();
  const refs=projectSource(source).providerSource.evidence.map(e=>e.ref);
  const good={facts:[{type:'expiration',current:'2023-07-24',evidence_refs:['E5','E6']}],unresolved:[]};
  assert.equal(validateOutput(JSON.stringify(good),refs).local.valid,true);
  const badDate=structuredClone(good); badDate.facts[0].current='January 28';
  assert.equal(validateOutput(JSON.stringify(badDate),refs).local.valid,false);
  const badRef=structuredClone(good); badRef.facts[0].evidence_refs=['E99'];
  assert.equal(validateOutput(JSON.stringify(badRef),refs).local.valid,false);
});

for (const mode of ['success','transport','http','invalid-output']) {
  test(`one physical request guard after ${mode}`, async () => {
    const source=await loadSource();
    const {providerSource,evidenceMap}=projectSource(source);
    const folder=await mkdtemp(join(tmpdir(),'tender-nano-v6b-'));
    const mapBytes=JSON.stringify(evidenceMap,null,2)+'\n';
    await writeFile(join(folder,'evidence-map.json'),mapBytes);
    const body=JSON.stringify(buildRequest(providerSource),null,2)+'\n';
    let calls=0;
    const good={facts:[{type:'expiration',current:'2023-07-24',evidence_refs:['E5','E6']}],unresolved:[]};
    const fetchImpl=async (_url,options)=>{
      calls++; assert.equal(options.body,body);
      if(mode==='transport') throw new Error('simulated timeout');
      const output=mode==='invalid-output'?{...good,version:'x'}:good;
      return new Response(mode==='http'?'{}':JSON.stringify({modelVersion:'test',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]}),{status:mode==='http'?429:200});
    };
    try {
      const result=await callOnce({folder,source,providerSource,mapBytes,frozenMapHash:hash(mapBytes),body,key:'offline',fetchImpl});
      assert.equal(result.technicalPass,mode==='success');
      await assert.rejects(callOnce({folder,source,providerSource,mapBytes,frozenMapHash:hash(mapBytes),body,key:'offline',fetchImpl}),{code:'EEXIST'});
      assert.equal(calls,1);
    } finally { await rm(folder,{recursive:true,force:true}); }
  });
}



