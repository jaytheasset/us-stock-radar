import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {CodexCliOsSnapshotProvider,redact,type RunProcess} from './provider.ts';
import {bindingFor} from './source.ts';
import {sha,type Source} from './contract.ts';
const source:Source={filing:{issuer:'fixture',cik:'0000000001',accession:'0000000001-26-000001',form:'F-1',filing_date:'2026-01-01'},ticker:null,documents:[{id:'d',url:'https://www.sec.gov/',original:'fixture',text:'fixture',original_sha256:sha('fixture'),text_sha256:sha('fixture')}],blocks:[],fingerprint:sha('fixture')};
const binding=bindingFor('00000000-0000-5000-a000-000000000001',source);
test('provider uses argv, isolated paths, one call, durable replay across instances',async()=>{
 const root=await mkdtemp(join(tmpdir(),'os-provider-test-'));let calls=0;
 const runner:RunProcess=async(exe,args,o)=>{calls++;assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('default_permissions=":workspace"'));assert.ok(o.cwd.startsWith(root));await o.onPid(2147483647);await writeFile(join(o.cwd,'single-extraction.json'),'{invalid but retained}');return{stdout:'out',stderr:'err',exitCode:0};};
 const p=new CodexCliOsSnapshotProvider({executable:process.execPath,root,runner});const first=await p.run(binding,1);
 assert.equal(first.raw,'{invalid but retained}');assert.equal((await new CodexCliOsSnapshotProvider({executable:process.execPath,root,runner}).run(binding,1)).raw,first.raw);assert.equal(calls,1);
 await assert.rejects(p.run(binding,2),/retry_forbidden/);
});
test('worker crash reconciles final file before any invocation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'os-provider-recovery-')),dir=join(root,binding.id,'1');await mkdir(dir,{recursive:true});
 await writeFile(join(dir,'started.json'),JSON.stringify({host:hostname(),pid:2147483647,startedAt:'2026-01-01',cliVersion:'fixture'}));await writeFile(join(dir,'single-extraction.json'),'{}');
 const p=new CodexCliOsSnapshotProvider({executable:process.execPath,root,runner:async()=>{throw Error('must_not_call')}});assert.equal((await p.run(binding,1)).raw,'{}');
});
test('alive or uncertain old invocation blocks replay, including lease recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'os-provider-uncertain-')),dir=join(root,binding.id,'1');await mkdir(dir,{recursive:true});
 const p=new CodexCliOsSnapshotProvider({executable:process.execPath,root,runner:async()=>{throw Error('must_not_call')}});
 for(const pid of [process.pid,0]){await writeFile(join(dir,'started.json'),JSON.stringify({host:hostname(),pid}));await assert.rejects(p.run(binding,1),/uncertain/);}
});
test('diagnostics redact auth-like credentials',()=>{assert.equal(redact('Bearer abc sk-secret eyJabc.def.ghi'),'Bearer [REDACTED] [REDACTED] [REDACTED]');});
test('lost journal cannot turn a DB-marked invocation into a new provider call',async()=>{
 const root=await mkdtemp(join(tmpdir(),'os-provider-lost-'));
 const p=new CodexCliOsSnapshotProvider({executable:process.execPath,root,runner:async()=>{throw Error('must_not_call')}});
 await assert.rejects(p.run(binding,1,true),/missing_journal/);
});

test('native executable preflight failure is durable technical failure without extraction',async()=>{
 const root=await mkdtemp(join(tmpdir(),'os-provider-preflight-'));
 const p=new CodexCliOsSnapshotProvider({executable:join(root,'missing-codex.exe'),root});
 const result=await p.run(binding,1);
 assert.equal(result.technicalError,'provider_preflight_failed');assert.equal(result.raw,'');assert.equal(result.retrySafe,true);
 assert.deepEqual(await p.run(binding,1,true),result);
});

test('input IO failure is recorded before invoking the process runner',async()=>{
 const root=await mkdtemp(join(tmpdir(),'os-provider-input-')),dir=join(root,binding.id,'1');
 await mkdir(join(dir,'filing.json'),{recursive:true});let calls=0;
 const p=new CodexCliOsSnapshotProvider({executable:process.execPath,root,runner:async()=>{calls++;throw Error('must_not_call');}});
 const result=await p.run(binding,1);
 assert.equal(result.technicalError,'provider_preflight_failed');assert.equal(result.retrySafe,true);assert.equal(calls,0);
 assert.deepEqual(await p.run(binding,1,true),result);
});
