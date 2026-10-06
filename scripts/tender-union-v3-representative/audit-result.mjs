import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {root,json,hash,verifyCase} from './run.mjs';

const manifest=await json(join(root,'manifest.json')),baselines=await json(join(root,'baseline.json'));
const rows=[];let calls=0,inputTokens=0,outputTokens=0;
for(const c of manifest.cases){
 const ctx=await verifyCase(c.name),raw=await readFile(join(ctx.folder,'structured.txt'),'utf8'),out=JSON.parse(raw),provider=await json(join(ctx.folder,'provider-response.txt')),audit=await json(join(ctx.folder,'audit.json')),review=await json(join(ctx.folder,'review.json'));
 assert.equal(raw,provider.candidates[0].content.parts.filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join(''));
 const simplify={
  expiration:out.expiration&&{current:out.expiration.current,previous:out.expiration.previous},
  offer_price:out.offer_price&&{current:out.offer_price.current,previous:out.offer_price.previous},
  board_recommendation:out.board_recommendation&&{current:out.board_recommendation.current,previous:out.board_recommendation.previous},
  offer_status:out.offer_status&&{current:out.offer_status.current},
  final_results_observed:out.final_results_observed&&{observed:out.final_results_observed.observed},
  unresolved:out.unresolved
 };
 assert.ok(isDeepStrictEqual(simplify,baselines[c.name].expected),c.name);
 assert.equal(audit.physicalCalls,1);assert.equal(audit.retries+audit.repairCalls+audit.fallbackCalls,0);assert.equal(audit.semanticCorrections,0);assert.equal(audit.technicalPass,true);assert.equal(review.pass,true);
 calls+=1;inputTokens+=audit.usage.promptTokenCount;outputTokens+=audit.usage.candidatesTokenCount;
 rows.push({name:c.name,accession:c.accession,currencyInventory:audit.currencyInventory,http:audit.httpStatus,inputTokens:audit.usage.promptTokenCount,outputTokens:audit.usage.candidatesTokenCount,latencyMs:audit.latencyMs,semanticPass:true});
}
assert.equal(calls,2);
const result={pass:true,physicalCalls:calls,inputTokens,outputTokens,totalTokens:inputTokens+outputTokens,retry:0,repair:0,fallback:0,semanticCorrections:0,cases:rows,generalizedV3Status:'REPRESENTATIVE_PASS_ACTIVE_AND_TERMINAL; final-results positive not yet revalidated under v3'};
console.log(JSON.stringify(result,null,2));
