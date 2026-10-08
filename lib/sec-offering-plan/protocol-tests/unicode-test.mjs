import {mkdir,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {freezeOutput,atomicCreate,decode,sha256} from './output-writer.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const samples=['\u00a30.01','\u00a30.0004','\u20ac1.25','$51.00','\u00a5100','\u20a91,000','\u20ab50.000','en dash: \u2013','apostrophe: \u2019','\ud55c\uad6d\uc5b4 \ubb38\uc790\uc5f4','Ti\u1ebfng Vi\u1ec7t: c\u1ed5 phi\u1ebfu'];
const expected={scenario:samples.join(' | '),nested:{security_label:samples[9],price_text:samples[0],evidence_excerpt:samples[10],items:samples.map(text=>({text}))}};
if(process.argv[2]==='--child'){
  const dir=process.argv[3];await mkdir(dir,{recursive:true});
  // Stand-in for the CLI final-file boundary, then the exact production-candidate writer.
  await atomicCreate(join(dir,'cli-final.json'),Buffer.from(JSON.stringify(expected,null,2),'utf8'));
  const result=await freezeOutput(join(dir,'cli-final.json'),join(dir,'frozen-output.json'),join(dir,'host-freeze.json'));
  assert.deepEqual(result.value,expected);
  for(let i=0;i<samples.length;i++)assert.deepEqual([...result.value.nested.items[i].text].map(x=>x.codePointAt(0)),[...samples[i]].map(x=>x.codePointAt(0)));
  const bytes=await readFile(join(dir,'frozen-output.json'));assert(!decode(bytes).includes('?'));assert(!decode(bytes).includes('\ufffd'));
  assert.equal(result.freeze.sha256,sha256(bytes));
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)),expected);
  await assert.rejects(()=>freezeOutput(join(dir,'cli-final.json'),join(dir,'frozen-output.json'),join(dir,'host-freeze.json')));
  assert.throws(()=>decode(Buffer.from([0xc3,0x28])));assert.throws(()=>decode(Buffer.from('\ufffd','utf8')));
  console.log(JSON.stringify({pass:true,strings:samples.length,checks:8,gptCalls:0,sha256:result.freeze.sha256}));
}else{
  const dir=join(root,'unicode-tests');await mkdir(dir,{recursive:true});
  const script=fileURLToPath(import.meta.url);
  const normal=spawnSync(process.execPath,[script,'--child',join(dir,'native')],{encoding:'utf8',windowsHide:true});
  assert.equal(normal.status,0,normal.stderr);
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  // Only file paths and fixed flags cross PowerShell; all payload bytes are created/read in Node.
  const windows=spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-Command','& '+quote(process.execPath)+' '+quote(script)+' --child '+quote(join(dir,'windows-powershell'))+'; exit $LASTEXITCODE'],{encoding:'utf8',windowsHide:true});
  assert.equal(windows.status,0,windows.stderr);
  assert.equal(JSON.parse(normal.stdout).sha256,JSON.parse(windows.stdout).sha256);
  const escaped=JSON.stringify(expected).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  assert.deepEqual(JSON.parse(escaped),expected);
  const result={status:'PASS',gptCalls:0,native:JSON.parse(normal.stdout),windowsPowerShell:JSON.parse(windows.stdout),asciiEscapesSemanticMatch:true};
  await atomicCreate(join(root,'unicode-test-result.json'),Buffer.from(JSON.stringify(result,null,2)+'\n','utf8'));
  console.log(JSON.stringify(result));
}
