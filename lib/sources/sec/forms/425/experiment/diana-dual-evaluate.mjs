// Offline diagnostics only. Whitespace comparisons below never repair or accept quotes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseEnv} from 'node:util';
import {Parser} from 'htmlparser2';
import {durableNew,sha256} from './round2-guard.mjs';
globalThis.fetch=async()=>{throw Error('evaluation_network_forbidden');};
const root='C:/Users/PC/.codex/visualizations/sec425-diana-primary-fact-20261015',dir=root+'/trial';
const read=n=>JSON.parse(fs.readFileSync(dir+'/'+n,'utf8')),plan=read('plan.json');
assert.equal(sha256(fs.readFileSync(dir+'/plan.json')),'9cd8f03f1c47df420d8ebbd1940b5bda7d047dbdfb53504b9fd7fb2bfc40bd4c');
for(const[p,h]of Object.entries(plan.frozenFiles))assert.equal(sha256(fs.readFileSync(p)),h,p);
const attempts=fs.readdirSync(dir+'/ledger').filter(n=>/^attempt-.*\.json$/.test(n));assert.equal(attempts.length,2);
const primary=read('primary-model-output.json'),fact=read('fact-model-output.json'),adapted=read('primary-adapted.json'),candidate=read('fact-candidate.json');
assert.deepEqual(adapted.analysis.sec_425_raw_model_output,primary);assert.deepEqual(candidate.rawOutput,fact);
const primaryUser=JSON.parse(read('primary-prompt.json').user),factUser=JSON.parse(read('fact-prompt.json').user),blocks=factUser.cleaned_source_blocks;
const whitespace=s=>s.replace(/\s+/g,' ').trim();
const quotes=[];
function visit(value,location=''){
 if(Array.isArray(value)){value.forEach((v,i)=>visit(v,location+'/'+i));return;}
 if(!value||typeof value!=='object')return;
 if(value.block_id&&value.quote){
  const block=blocks.find(b=>b.block_id===value.block_id),field=block?.[value.source_field];
  quotes.push({path:location,blockId:value.block_id,sourceField:value.source_field,length:[...value.quote].length,
   exact:typeof field==='string'&&field.includes(value.quote),sameFieldWhitespaceOnly:typeof field==='string'&&whitespace(field).includes(whitespace(value.quote)),
   otherFieldExact:Object.entries(block??{}).filter(([k,v])=>['heading','text'].includes(k)&&k!==value.source_field&&typeof v==='string'&&v.includes(value.quote)).map(([k])=>k)});
 }
 for(const[k,v]of Object.entries(value))visit(v,location+'/'+k);
}
visit(fact);
let nativeText='';const parser=new Parser({ontext:t=>{nativeText+=t;}},{decodeEntities:true});parser.end(fs.readFileSync(dir+'/diana.htm','utf8'));
// Reading aid from genuine retained HTML. Not supplied to a model or substituted into its quotes.
durableNew(root+'/native-source-reading-text.txt',nativeText);
const results=['primary','fact'].map(stage=>{
 const r=read('ledger/result-'+stage+'.json');assert.equal(sha256(fs.readFileSync(dir+'/'+stage+'-response.json')),r.responseSha256);
 assert.equal(sha256(fs.readFileSync(dir+'/'+stage+'-request.json')),r.requestSha256);
 return r;
});
const changedPrimary=Object.keys(primary.analysis_output).filter(k=>JSON.stringify(primary.analysis_output[k])!==JSON.stringify(adapted.analysis[k])).map(k=>({field:k,raw:primary.analysis_output[k],adapted:adapted.analysis[k]}));
const secret=parseEnv(fs.readFileSync('C:/Users/PC/Documents/Codex/US-Stock Radar/.env.local','utf8')).GEMINI_API_KEY;
assert.ok(secret);
function scan(directory){for(const e of fs.readdirSync(directory,{withFileTypes:true})){const p=directory+'/'+e.name;if(e.isDirectory())scan(p);else assert.equal(fs.readFileSync(p).includes(Buffer.from(secret)),false,'credential_echo_in_evidence');}}
scan(root);
const summary={version:'sec425-diana-independent-two-result-v1',actualProviderRequests:results.length,results,
 frozenFilesUnchanged:Object.keys(plan.frozenFiles).length,rawModelOutputsUnchanged:true,credentialScan:'no credential echo',
 primary:{validation:read('primary-validation.json'),scoreReasonLength:[...primary.analysis_output.score_reason].length,changedPrimary,identity:adapted.analysis.sec_425_identity,
 selectedBlocks:primaryUser.cleaned_source_blocks.map(b=>b.block_id)},
 fact:{validation:read('fact-validation.json'),quoteDiagnostics:quotes,quoteCounts:{total:quotes.length,exact:quotes.filter(q=>q.exact).length,over240:quotes.filter(q=>q.length>240).length,sameFieldAfterWhitespaceOnly:quotes.filter(q=>q.sameFieldWhitespaceOnly).length,wrongField:quotes.filter(q=>q.otherFieldExact.length).length},
 blockCount:blocks.length,automaticIdentity:candidate.assessment.identities,currentness:candidate.assessment.currentness},
 totalUsage:{input:results.reduce((n,r)=>n+r.usage.promptTokenCount,0),output:results.reduce((n,r)=>n+r.usage.candidatesTokenCount,0),total:results.reduce((n,r)=>n+r.usage.totalTokenCount,0),latencyMs:results.reduce((n,r)=>n+r.latencyMs,0)},
 semanticEvaluation:'Separate direct-source assessment in docs/operations/SEC425_DIANA_PRIMARY_FACT_RESULT.md; these diagnostics do not prove semantics.',
 routerCalls:0,retry:0,repair:0,fallback:0,SEC:0,DB:0,productStorage:0,Alert:0,canonicalReady:false};
durableNew(root+'/FINAL-EVALUATION.json',summary);
console.log(JSON.stringify({calls:2,frozenFilesUnchanged:summary.frozenFilesUnchanged,quoteCounts:summary.fact.quoteCounts,primaryChanges:changedPrimary,totalUsage:summary.totalUsage,credentialScan:summary.credentialScan}));
