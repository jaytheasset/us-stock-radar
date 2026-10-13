import test from 'node:test';
import assert from 'node:assert/strict';
import {readShareCountCorrection,effectiveShareCountObservation,type ShareCountCorrection} from './shareCountCorrection.ts';
import {historyPublicationFixture} from '../sec-os-snapshot/fixtures/historyPublication.ts';
import {prepareOsSnapshotHistory} from '../sec-os-snapshot/historyPublication.ts';
import {InMemoryShareCountHistoryRepository,PostgresShareCountHistoryRepository,mapShareCountHistoryDatabaseRow,toShareCountHistoryDatabaseRow,type ShareCountHistoryObservation} from './shareCountHistory.ts';
import {resolveClassShareCountAt} from './classShareCountResolver.ts';

async function fixture(){
 const f=historyPublicationFixture();
 const {observations}=await prepareOsSnapshotHistory(f.run.id,{rpc:async()=>({ok:true,data:f.context}),select:async()=>({ok:true,data:[]})});
 const row=mapShareCountHistoryDatabaseRow({...toShareCountHistoryDatabaseRow(observations[0]),id:'123',snapshot_publication_valid:true,created_at:'2026-02-02T00:00:00Z'});
 const correction:ShareCountCorrection={id:'a0000000-0000-4000-a000-000000000001',observationId:'123',revision:1,quantity:'900',asOf:'2026-01-29',
  evidence:'TEST ONLY source evidence',reason:'TEST ONLY correction',actorUserId:'a0000000-0000-4000-a000-000000000002',createdAt:'2026-02-03T00:00:00Z',
  originalQuantity:row.sharesOutstanding,originalAsOf:row.asOf,classId:row.canonicalSecurityClassId!,sourceHash:row.sourceContentHash,sourceBindingHash:'f'.repeat(64)};
 return {row,correction};
}
const resolve=(rows:ShareCountHistoryObservation[])=>resolveClassShareCountAt({repository:{readHistory:async()=>rows,insertObservation:async()=>false},
 cik:'0000000091',securityClassId:'sc:v1:0000000091:common_stock:single',targetAt:'2026-02-04T00:00:00Z'});

test('correction is a per-observation read projection; stored literals and source proof remain untouched',async()=>{
 const {row,correction}=await fixture(),before=structuredClone(row);
 const projected=effectiveShareCountObservation({...row,correction});
 assert.equal(projected.sharesOutstanding,'900');assert.equal(projected.asOf,'2026-01-29');
 assert.deepEqual(row,before);assert.deepEqual(projected.sourceProvenance,row.sourceProvenance);
 assert.equal(projected.correction?.originalQuantity,'1000');
 assert.equal((await resolve([{...row,correction}])).sharesOutstanding,'900');
});
test('newer automatic observations win and unrelated same-date disagreements still conflict',async()=>{
 const {row,correction}=await fixture();
 assert.equal((await resolve([{...row,correction},{...row,id:'124',asOf:'2026-01-31',sharesOutstanding:'1100'}])).sharesOutstanding,'1100');
 assert.equal((await resolve([{...row,correction},{...row,id:'125',asOf:'2026-01-29',sharesOutstanding:'901'}])).status,'CONFLICT');
});
test('absent/withdrawn/stale correction projection leaves original source values, not a permanent issuer override',async()=>{
 const {row}=await fixture();assert.equal(readShareCountCorrection(null,row),undefined);
 assert.equal((await resolve([row])).sharesOutstanding,'1000');assert.equal(effectiveShareCountObservation(row),row);
});
test('correction quantities remain exact beyond the JavaScript safe-integer range',async()=>{
 const {row,correction}=await fixture();
 const result=await resolve([{...row,correction:{...correction,quantity:'9007199254740993'}}]);
 assert.equal(result.sharesOutstanding,'9007199254740993');
});
test('historical date bounds preserve original dates; current resolution opts into corrected dates',async()=>{
 const {row,correction}=await fixture();
 const repository=new InMemoryShareCountHistoryRepository();
 await repository.insertObservation({...row,correction:{...correction,observationId:'1'}});
 const upper={asOfTo:'2026-01-29'};
 assert.equal((await repository.readHistory(row.issuerCik,upper)).length,0);
 const corrected=await repository.readHistory(row.issuerCik,{...upper,effectiveDates:true});
 assert.equal(corrected.length,1);assert.equal(corrected[0].asOf,row.asOf);
 assert.equal((await repository.readHistory(row.issuerCik,{asOfFrom:row.asOf})).length,1);
 assert.equal((await repository.readHistory(row.issuerCik,{asOfFrom:row.asOf,effectiveDates:true})).length,0);
 const result=await resolveClassShareCountAt({repository,cik:row.issuerCik,securityClassId:row.canonicalSecurityClassId!,targetAt:'2026-02-04T00:00:00Z'});
 assert.equal(result.sharesOutstanding,'900');assert.equal(result.asOf,correction.asOf);
 const calls:unknown[][]=[];
 const postgres=new PostgresShareCountHistoryRepository({query:async(_sql,values=[])=>{calls.push(values);return {rows:[],rowCount:0};}});
 await postgres.readHistory(row.issuerCik,upper);
 await postgres.readHistory(row.issuerCik,{...upper,effectiveDates:true});
 assert.equal(calls[0][5],false);assert.equal(calls[1][5],true);
});
test('projection cannot be attached to another row, source, class, original value or invalid date/quantity',async()=>{
 const {row,correction}=await fixture();
 for(const change of [{observationId:'124'},{sourceHash:'0'.repeat(64)},{classId:'sc:v1:0000000091:common_stock:class-a'},
  {originalQuantity:'1001'},{originalAsOf:'2026-01-28'},{quantity:'1.5'},{quantity:'0'},{asOf:'2026-02-30'},{asOf:'2026-03-01'}]){
  assert.throws(()=>readShareCountCorrection({...correction,...change},row));
 }
});
