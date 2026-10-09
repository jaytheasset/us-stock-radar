import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,mkdir,readFile,copyFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {validateOutput,sha,type Source} from './contract.ts';
import {bindingFor,familyFor,compactBinding,buildSource,hydrateBinding} from './source.ts';
import {CodexCliOfferingProvider} from './provider.ts';
import {CodexCliOsSnapshotProvider,type RunProcess} from '../sec-os-snapshot/provider.ts';
const manifest=JSON.parse(readFileSync('lib/sec-offering-plan/fixtures/manifest.json','utf8'));
const fixture=(id:string)=>({raw:readFileSync(`lib/sec-offering-plan/fixtures/${id}.json`,'utf8'),source:JSON.parse(gunzipSync(readFileSync(`lib/sec-offering-plan/fixtures/${id}.source.json.gz`)).toString()) as Source});
for(const f of manifest.fixtures)test('frozen gate fixture '+f.id,()=>{const {raw,source}=fixture(f.id);assert.equal(sha(raw),f.rawHash);const v=validateOutput(raw,source);assert.equal(v.ok,true,JSON.stringify(v.errors));assert.equal(JSON.stringify(v.value),JSON.stringify(JSON.parse(raw)));});
const {raw,source}=fixture('arm-f1a'),binding=bindingFor('00000000-0000-5000-a000-000000000001',source);

test('compact binding has no source body and reconstructs both formats without changing the key',()=>{
 const rawItem={id:binding.rawItemId,source_code:'sec_edgar',source_unique_id:source.filing.accession,raw_payload:{accession_number:source.filing.accession,company_name:source.filing.issuer,cik:source.filing.cik,form_type:source.filing.form,filing_date:source.filing.filing_date,primary_document_html:'<p>Original £0.01 Ω</p>',primary_document_html_truncated:false}};
 const s=buildSource(rawItem),full=bindingFor(rawItem.id,s),compact=compactBinding(full),saved=JSON.stringify(compact);
 assert.equal(compact.id,full.id);assert.equal(saved.includes('Original'),false);assert.equal('blocks' in compact,false);assert.equal('source' in compact,false);
 for(const b of [full,compact])assert.deepEqual(hydrateBinding(b,rawItem),full);
 for(const [key,value]of Object.entries({sourceFingerprint:sha('bad'),blockCount:99,filing:{...s.filing,issuer:'wrong'},documents:[]}))assert.throws(()=>hydrateBinding({...compact,[key]:value},rawItem),/mismatch/);
 rawItem.raw_payload.primary_document_html+='changed';assert.throws(()=>hydrateBinding(compact,rawItem),/mismatch/);assert.equal(JSON.stringify(compact),saved);
});
test('family needs official nonconflicting numbers; amendment and revisions stay separate',()=>{
 const f=source.filing;assert.equal(familyFor(f).status,'confirmed');
 assert.equal(familyFor({...f,file_number:null,registration_number:null}).key,null);
 assert.equal(familyFor({...f,registration_number:'333-999999'}).key,null);
 assert.equal(familyFor({...f,file_number:'unknown',registration_number:null}).key,null);
 assert.notEqual(bindingFor(binding.rawItemId,source,'next').id,binding.id);
 assert.notEqual(bindingFor(binding.rawItemId,{...source,fingerprint:sha('new')}).id,binding.id);
 assert.notEqual(bindingFor(binding.rawItemId,{...source,filing:{...f,accession:'0000000001-26-000001'}}).id,binding.id);
});
test('validator reports damaged identity/references and never changes output',()=>{
 const value=JSON.parse(raw);value.filing.accession='0000000001-26-000001';const input=JSON.stringify(value);assert.equal(validateOutput(input,source).ok,false);assert.equal(JSON.stringify(value),input);
 const broken=structuredClone(source);broken.blocks[0].text+='bad';assert.equal(validateOutput(raw,broken).ok,false);
});
test('initial blank amendments remain blank; no calculated proceeds supplied',()=>{
 for(const id of ['birkenstock','viking','amer','on']){const f=fixture(id+'-f1');const v=validateOutput(f.raw,f.source);assert.equal(v.ok,true);assert.ok(v.value!.plan.components.every(c=>c.price.status==='blank'||c.price.status==='not_stated'));assert.deepEqual(v.value!.plan,JSON.parse(f.raw).plan);}
 const v=JSON.parse(raw);assert.ok(v.plan.proceeds.some((p:{kind:string;recipient:string})=>p.kind==='no_proceeds'&&p.recipient==='issuer'));
});
const runnerFor=(bytes:Buffer,called:()=>void):RunProcess=>async(_e,_a,o)=>{called();await o.onPid(2147483647);await writeFile(join(o.cwd,'cli-final-output.json'),bytes);return {stdout:'',stderr:'',exitCode:0};};
test('Unicode byte-preserving freeze and durable replay after new provider instance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'offering-provider-'));let calls=0;
 const runner=runnerFor(Buffer.from(raw),()=>calls++),p=new CodexCliOfferingProvider({root,executable:process.execPath,runner});
 const r=await p.run(binding,1);assert.equal(r.raw,raw);assert.equal(r.integrityError,undefined);assert.equal(JSON.parse(r.freeze!).sha256,sha(raw));
 assert.deepEqual(await new CodexCliOfferingProvider({root,executable:process.execPath,runner}).run(binding,1,true),JSON.parse(JSON.stringify(r)));assert.equal(calls,1);await assert.rejects(p.run(binding,2),/retry_forbidden/);
});
test('invalid JSON/invalid UTF8 retain exact bytes and forbid retry',async()=>{
 for(const bytes of [Buffer.from('{bad'),Buffer.from([0xff,0xfe,0x80])]){const root=await mkdtemp(join(tmpdir(),'offering-invalid-'));const p=new CodexCliOfferingProvider({root,executable:process.execPath,runner:runnerFor(bytes,()=>{})});const r=await p.run(binding,1);assert.ok(r.integrityError);assert.deepEqual(r.rawBytesBase64?Buffer.from(r.rawBytesBase64,'base64'):Buffer.from(r.raw),bytes);assert.equal(r.retrySafe,false);await assert.rejects(p.run(binding,2),/retry_forbidden/);}
});
test('dead-worker final output recovers without invocation; missing or live journal blocks',async()=>{
 const root=await mkdtemp(join(tmpdir(),'offering-recovery-')),dir=join(root,'offering',binding.id,'1');await mkdir(dir,{recursive:true});
 const p=new CodexCliOfferingProvider({root,executable:process.execPath,runner:async()=>{throw Error('must_not_call');}});
 await assert.rejects(p.run(binding,1,true),/missing_journal/);
 for(const pid of [0,process.pid]){await writeFile(join(dir,'started.json'),JSON.stringify({host:hostname(),pid}));await assert.rejects(p.run(binding,1,true),/uncertain/);}
 await writeFile(join(dir,'started.json'),JSON.stringify({host:hostname(),pid:2147483647}));await writeFile(join(dir,'cli-final-output.json'),raw);assert.equal((await p.run(binding,1,true)).raw,raw);
});
test('shared O/S and Offering lock allows only one real subprocess (Node stub, GPT zero)',async()=>{
 const root=await mkdtemp(join(tmpdir(),'offering-shared-'));let started!:()=>void;const ready=new Promise<void>(r=>started=r);let active=0,max=0,calls=0;
 const runner:RunProcess=async(_e,_a,o)=>{calls++;active++;max=Math.max(max,active);const child=spawn(process.execPath,['-e','setTimeout(()=>{},350)'],{windowsHide:true});await o.onPid(child.pid!);started();await new Promise<void>(r=>child.once('exit',()=>r()));active--;await writeFile(join(o.cwd,'single-extraction.json'),'{}');return{stdout:'',stderr:'',exitCode:0};};
 const os=new CodexCliOsSnapshotProvider({root,executable:process.execPath,runner}),offering=new CodexCliOfferingProvider({root,executable:process.execPath,runner});
 const pending=os.run({...binding,providerProfile:'codex-cli:gpt-6-astra:high:v1'},1);await ready;await assert.rejects(offering.run(binding,1),/busy|EEXIST/);await pending;assert.equal(calls,1);assert.equal(max,1);
});
test('exact frozen 11-string transport test runs in Node and Windows PowerShell',async()=>{
 const root=await mkdtemp(join(tmpdir(),'offering-unicode-'));await copyFile('lib/sec-offering-plan/output-writer.mjs',join(root,'output-writer.mjs'));await copyFile('lib/sec-offering-plan/protocol-tests/unicode-test.mjs',join(root,'unicode-test.mjs'));
 const p=spawnSync(process.execPath,[join(root,'unicode-test.mjs')],{encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stderr+p.stdout);
});
