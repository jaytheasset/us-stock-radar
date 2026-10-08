import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { planSecTickerAutomatic as plan, applySecTickerAutomatic as apply, automaticRunnerRepository } from "./automaticRunner.ts";
import { fixture, memory, claim, CIK } from "./automaticRunner.fixtures.ts";
import type { SecTickerResolutionRepository } from "./persistence.ts";
type Row = Record<string, unknown>;
const systemIdentifier = "1234567890"; // Synthetic local identity, not the real DB.
async function setup(narrative = "", exchangeConflict = false) {
  const m = memory();
  const before = fixture(1, "OLD", "2026-02-17T00:00:00Z");
  const after = fixture(2, "NEW", "2026-05-14T00:00:00Z", narrative);
  for (const f of [before, after]) {
    f.raw.raw_payload.primary_document_html = f.raw.raw_payload.primary_document_html.replace("Common Stock, par value", "Class B Common Stock, par value");
    if (f === after && exchangeConflict) f.raw.raw_payload.primary_document_html = f.raw.raw_payload.primary_document_html.replace('>Nasdaq<', '>New York Stock Exchange<');
    f.raw.raw_payload.primary_document_html_char_count = f.raw.raw_payload.primary_document_html.length;
  }
  await m.save(before); const saved = await m.save(after);
  const trigger = { issuerCik: CIK, accessionNumber: saved.accessionNumber, sourceSha256: saved.sourceSha256!, resultId: saved.resultId };
  const calls: string[] = [];
  const repository: SecTickerResolutionRepository = { select: m.repository.select, async rpc(name, payload) { calls.push(name); return m.repository.rpc(name, payload); } };
  const input = { trigger, systemIdentifier, repository };
  return { m, before, after, trigger, calls, repository, input };
}
async function execute(s: Awaited<ReturnType<typeof setup>>, repository = s.repository) {
  const p = await plan({ ...s.input, repository });
  assert.equal(p.status, "ready", JSON.stringify(p.reasons));
  return apply({ ...s.input, repository, confirmedPlanDigest: p.digest });
}
function humanRow(decision: Row) {
  const scope = { issuerCik: decision.issuer_cik, resolutionType: decision.resolution_type, beforeAccessionNumber: decision.before_accession_number, afterAccessionNumber: decision.after_accession_number };
  return { id: randomUUID(), automatic_decision_id: decision.id, automatic_decision_sha256: decision.decision_sha256,
    scope_key: createHash("sha256").update(Object.values(scope).join("\u001f")).digest("hex"), scope_payload: scope,
    revision: 1, action: "reviewed", actor_user_id: randomUUID(), actor_role: "operations", reason: "Synthetic human reviewed the source",
    automatic_snapshot: { id: decision.id, decisionSha256: decision.decision_sha256, decisionPayload: decision.decision_payload },
    previous_human_decision_id: null, withdraws_human_decision_id: null, resulting_effective_action: null, resulting_effective_human_decision_id: null,
    audit_log_id: randomUUID(), evidence_references: {}, request_id: "synthetic-only", request_payload_sha256: "a".repeat(64), created_at: "2026-09-14T00:00:00Z" };
}

test("PSKY-shaped synthetic issuer: deterministic query-only REVIEW, independent source refs and no raw text receipt", async () => {
  const s = await setup("", true); const a = await plan(s.input), b = await plan(s.input);
  assert.deepEqual(a, b); assert.equal(a.classification, "insert"); assert.equal(a.boundaryCount, 1); assert.equal(a.previews.length, 2);
  const selected = a.selected[0]!;
  assert.equal(selected.resolutionState, "REVIEW"); assert.deepEqual(selected.reasons, ["EXCHANGE_CONFLICT", "SUPPORTED_CHANGE_EVIDENCE_MISSING"]);
  assert.equal(selected.oldTicker, "OLD"); assert.equal(selected.newTicker, "NEW"); assert.equal(selected.effectiveDate, null);
  assert.equal(selected.securityClass, "B"); assert.equal(selected.securityType, "common_stock");
  assert.equal(selected.evidenceSource.resultId, s.trigger.resultId); assert.ok(selected.beforeSource.resultId);
  assert.equal(a.expectedMutation.counts.sec_ticker_resolution_decisions!.insert, 1); assert.deepEqual(s.calls, []);
  assert.ok(!JSON.stringify(a).includes("<html")); assert.ok(!JSON.stringify(a).includes(s.after.raw.raw_payload.primary_document_html));
});
test("trigger exact result mismatch never substitutes latest", async () => {
  const s = await setup(); const p = await plan({ ...s.input, trigger: { ...s.trigger, resultId: randomUUID() } });
  assert.equal(p.classification, "unavailable"); assert.ok(p.reasons.includes("trigger_source_mismatch")); assert.deepEqual(s.calls, []);
});
for (const failed of [false, true]) test(`cover reader ${failed ? "failure" : "missing"} is not a successful empty scope`, async () => {
  const s = await setup(); const repository = { ...s.repository, select: async (table: string, q: Record<string,string>) => table === "sec_cover_observation_results" && q.accession_number
    ? { ok: !failed, status: failed ? 503 : 200, data: failed ? null : [] } : s.repository.select(table, q) };
  const p = await plan({ ...s.input, repository }); assert.equal(p.classification, "unavailable");
  assert.deepEqual(p.details, [failed ? "result_read_failed" : "not_found"]);
});
test("observation pair missing", async () => {
  const s = await setup(); s.m.tables.set("sec_cover_observation_results", s.m.get("sec_cover_observation_results").filter(r => r.id === s.trigger.resultId));
  assert.ok((await plan(s.input)).reasons.includes("observation_pair_missing"));
});
test("multiple valid source revisions require review", async () => {
  const s = await setup(); const changed = fixture(2, "NEW", "2026-05-14T00:00:00Z", "changed source revision"); await s.m.save(changed);
  const p = await plan(s.input); assert.equal(p.classification, "review-required"); assert.ok(p.reasons.includes("multiple_source_revisions"));
});
test("issuer cover and decision limits remain bounded", async () => {
  for (const target of ["sec_cover_observation_results", "sec_ticker_resolution_decisions"]) {
    const s = await setup(); const repository = { ...s.repository, select: async (table: string, q: Record<string,string>) => table === target && q.issuer_cik
      ? { ok: true, status: 200, data: Array(101).fill({}) } : s.repository.select(table,q) };
    const p = await plan({...s.input,repository}); assert.equal(p.status,"blocked"); assert.ok(p.reasons.some(r=>r.endsWith("scope_exceeded")));
  }
});
test("same observed symbol run has no boundary", async () => {
  const s = await setup(); const one = memory(); await one.save(fixture(3,"NEW","2026-01-01T00:00:00Z")); await one.save(s.after);
  assert.ok((await plan({...s.input,repository:one.repository})).reasons.includes("no_observed_symbol_boundary"));
});
test("competing discovery claims are not persisted", async () => {
  const s = await setup(claim); await s.m.save(fixture(3,"NEW","2026-06-14T00:00:00Z",claim+" This ticker change is part of a reverse merger."));
  const p = await plan(s.input); assert.equal(p.classification,"review-required"); assert.ok(p.reasons.includes("discovery_claims_or_security_candidates_conflict"));
});
test("exact existing decision replay and issuer/identity/evidence mutation counts", async () => {
  const s = await setup(claim); const p = await plan(s.input);
  assert.equal(p.expectedMutation.rows.filter(r=>r.action==='insert').length,4);
  const first = await apply({...s.input,confirmedPlanDigest:p.digest}); assert.equal(first.status,"complete"); assert.equal(first.writeStatus,"inserted");
  const replay = await plan(s.input); assert.equal(replay.classification,"replay"); assert.equal(replay.digest===p.digest,false);
  assert.ok(replay.expectedMutation.rows.every(r=>r.action==='replay'));
  const second = await apply({...s.input,confirmedPlanDigest:replay.digest}); assert.equal(second.writeStatus,"replayed"); assert.equal(second.decisionId,first.decisionId);
  assert.equal(s.m.get('sec_ticker_resolution_decisions').length,1); assert.equal(s.m.get('sec_issuers').length,1);
});
test("existing human scope prevents a later incompatible claim from replacing the old scope", async () => {
  const s = await setup(); await execute(s);
  s.m.add('sec_ticker_resolution_human_decisions',humanRow(s.m.get('sec_ticker_resolution_decisions')[0]!));
  await s.m.save(fixture(3,'NEW','2026-06-14T00:00:00Z',claim));
  const p = await plan(s.input); assert.equal(p.classification,'review-required'); assert.ok(p.reasons.includes('existing_claim_or_human_scope_requires_review'));
});
test("decision and human content changes affect digest; no actor or reason text in receipt", async () => {
  const s = await setup(); await execute(s); const a=await plan(s.input);
  const decision=s.m.get('sec_ticker_resolution_decisions')[0]!; decision.created_at='2026-09-15T00:00:00Z';
  const b=await plan(s.input); assert.notEqual(a.digest,b.digest);
  const human=humanRow(decision); s.m.add('sec_ticker_resolution_human_decisions',human);
  const c=await plan(s.input); assert.equal(c.classification,'replay'); assert.notEqual(b.digest,c.digest);
  human.reason='Different synthetic review reason'; const d=await plan(s.input); assert.notEqual(c.digest,d.digest);
  assert.ok(!JSON.stringify(d).includes(String(human.actor_user_id))); assert.ok(!JSON.stringify(d).includes(human.reason));
});
test("cover/source/observation/issuer scope and system identity affect plan digest", async () => {
  for (const table of ['sec_cover_observation_results','sec_structured_raw_sources','sec_cover_security_observations']) {
    const s=await setup(); const a=await plan(s.input); s.m.get(table)[0]!.created_at='2026-09-15T00:00:00Z';
    assert.notEqual(a.digest,(await plan(s.input)).digest);
  }
  const s=await setup(); const a=await plan(s.input); await s.m.save(fixture(3,'NEW','2026-06-14T00:00:00Z'));
  assert.notEqual(a.digest,(await plan(s.input)).digest);
  assert.notEqual(a.digest,(await plan({...s.input,systemIdentifier:'1234567891'})).digest);
});
test("digest mismatch performs zero lock and persistence RPC", async () => {
  const s=await setup(); await assert.rejects(apply({...s.input,confirmedPlanDigest:'0'.repeat(64)}),/plan_digest_mismatch/); assert.deepEqual(s.calls,[]);
});
test("accepted time, source SHA and expected issuer mutation affect confirmation",async()=>{
  for(const field of ['accepted_at','source_sha256']){
    const s=await setup();const before=await plan(s.input);s.m.get('sec_cover_observation_results')[0]![field]=field==='accepted_at'?'2026-01-01T00:00:00Z':'0'.repeat(64);
    const after=await plan(s.input);assert.notEqual(before.digest,after.digest);
    await assert.rejects(apply({...s.input,confirmedPlanDigest:before.digest}),/plan_digest_mismatch/);assert.deepEqual(s.calls,[]);
  }
  const s=await setup();const before=await plan(s.input);s.m.add('sec_issuers',{cik:CIK});const after=await plan(s.input);
  assert.notEqual(before.digest,after.digest);assert.equal(after.expectedMutation.counts.sec_issuers!.insert,0);
});
test("multiple selected boundaries are visible but v1 apply is blocked",async()=>{
  const s=await setup();await s.m.save(fixture(3,'THIRD','2026-06-14T00:00:00Z'));
  const p=await plan(s.input);assert.equal(p.boundaryCount,2);assert.equal(p.selected.length,2);assert.equal(p.classification,'review-required');
  await assert.rejects(apply({...s.input,confirmedPlanDigest:p.digest}),/plan_not_ready/);assert.deepEqual(s.calls,[]);
});
test("inconsistent repeated reads cannot form a confirmed snapshot",async()=>{
  const s=await setup();let count=0;const repo={...s.repository,select:async(table:string,q:Record<string,string>)=>{
    const r=structuredClone(await s.repository.select(table,q));
    if(table==='sec_structured_raw_sources'&&q.id&&++count>2&&Array.isArray(r.data)&&r.data[0])r.data[0].created_at='2026-09-15T00:00:00Z';return r;
  }};
  const p=await plan({...s.input,repository:repo});assert.equal(p.classification,'conflict');assert.ok(p.reasons.includes('scope_changed_during_plan'));
});
for(const busy of [false,true]) test(`acquire ${busy?'busy':'failed'} never persists`,async()=>{
  const s=await setup(); const repo={...s.repository,rpc:async(name:string,p:Row)=>name==='acquire_ingest_workflow_lock'?{ok:busy,status:busy?200:503,data:false}:s.repository.rpc(name,p)};
  const r=await execute(s,repo); assert.equal(r.persistenceAttempted,false); assert.equal(r.status,busy?'waiting':'incomplete'); assert.equal(s.m.get('sec_ticker_resolution_decisions').length,0);
});
test("a pre-existing lock row including expired rows is not replaced",async()=>{
  const s=await setup(); s.m.add('ingest_workflow_locks',{lock_key:`sec-ticker-resolution:${CIK}`,expires_at:'2000-01-01T00:00:00Z'});
  const r=await execute(s); assert.equal(r.status,'waiting'); assert.deepEqual(s.calls,[]);
});
test("scope drift after acquire is blocked before persist and lock released",async()=>{
  const s=await setup(); const repo={...s.repository,rpc:async(name:string,p:Row)=>{const r=await s.repository.rpc(name,p);if(name==='acquire_ingest_workflow_lock')s.m.get('sec_cover_observation_results')[0]!.created_at='2026-09-15T00:00:00Z';return r;}};
  const r=await execute(s,repo);assert.equal(r.status,'incomplete');assert.ok(r.reasons.includes('locked_plan_digest_mismatch'));assert.equal(r.persistenceAttempted,false);assert.equal(r.lockReleased,true);
});
test("lease loss immediately before persistence blocks it",async()=>{
  const s=await setup();const repo={...s.repository,rpc:async(name:string,p:Row)=>name==='renew_ingest_workflow_lock'?{ok:true,status:200,data:false}:s.repository.rpc(name,p)};
  const r=await execute(s,repo);assert.ok(r.reasons.includes('issuer_lease_lost'));assert.equal(r.persistenceAttempted,false);assert.equal(r.lockReleased,true);
});
test("human history drift during persistence reread is caught before write",async()=>{
  const s=await setup();await execute(s);const decision=s.m.get('sec_ticker_resolution_decisions')[0]!;
  s.m.add('sec_ticker_resolution_human_decisions',humanRow(decision));
  let acquired=false,scopeReads=0,changed=false;
  const repo:SecTickerResolutionRepository={
    async select(table,q){
      // Locked prepare reads the issuer discovery once; the final prepare sees
      // the new human revision metadata introduced after that full pass.
      if(acquired&&table==='sec_cover_observation_results'&&q.issuer_cik&&++scopeReads===2){s.m.get('sec_ticker_resolution_human_decisions')[0]!.reason='changed during persistence preview';changed=true;}
      return s.repository.select(table,q);
    },async rpc(name,p){const r=await s.repository.rpc(name,p);if(name==='acquire_ingest_workflow_lock')acquired=true;return r;}
  };
  const r=await execute(s,repo);assert.equal(changed,true);assert.equal(r.persistenceAttempted,false);assert.ok(r.reasons.includes('pre_persist_scope_drift'));assert.equal(r.lockReleased,true);
});
test("unapproved RPC and table are blocked at repository boundary",async()=>{
  const s=await setup();for(const allow of [false,true]){
    const r=automaticRunnerRepository(s.repository,allow);await assert.rejects(r.rpc('claim_sec_ticker_resolution_decision',{}),/rpc_forbidden/);
    await assert.rejects(r.rpc('record_sec_cover_observation_persistence_state',{}),/rpc_forbidden/);
    await assert.rejects(r.select('user_profiles',{}),/select_table_forbidden/);
  }assert.deepEqual(s.calls,[]);
});
for(const failure of ['response','reader','lost-response']) test(`persistence ${failure} never claims rollback or verified completion`,async()=>{
  const s=await setup();let wrote=false;
  const repo:SecTickerResolutionRepository={
    async select(table,q){if(wrote&&failure==='reader'&&table==='sec_ticker_resolution_decisions'&&q.id)return{ok:false,status:503,data:null};return s.repository.select(table,q);},
    async rpc(name,p){const r=await s.repository.rpc(name,p);if(name==='persist_sec_ticker_resolution'){wrote=true;if(failure==='response')return{ok:true,status:200,data:{status:'inserted',decision_id:randomUUID()}};if(failure==='lost-response')throw Error('private transport text');}return r;}
  };
  const r=await execute(s,repo);assert.equal(r.status,'incomplete');assert.equal(r.persistenceAttempted,true);assert.equal(r.verified,false);assert.equal(r.lockReleased,true);
  assert.equal(s.m.get('sec_ticker_resolution_decisions').length,1);
  const retry=await execute(s);assert.equal(retry.status,'complete');assert.equal(retry.writeStatus,'replayed');assert.equal(s.m.get('sec_ticker_resolution_decisions').length,1);
});
test("release failure is incomplete even after exact decision verification",async()=>{
  const s=await setup();const repo={...s.repository,rpc:async(name:string,p:Row)=>name==='release_ingest_workflow_lock'?{ok:false,status:503,data:null}:s.repository.rpc(name,p)};
  const r=await execute(s,repo);assert.equal(r.status,'incomplete');assert.equal(r.verified,true);assert.equal(r.lockReleased,false);assert.ok(r.reasons.includes('issuer_lease_release_failed'));
});
test("raw/cover and unrelated metadata untouched; no external requests; receipt omits exact source span",async()=>{
  const s=await setup(claim);const snapshot=structuredClone([...s.m.tables].filter(([name])=>name==='raw_items'||name.startsWith('sec_cover_')||name==='sec_structured_raw_sources'));
  const fetch=globalThis.fetch;let external=0;globalThis.fetch=async()=>{external++;throw Error('external forbidden');};
  try{const p=await plan(s.input);assert.ok(!JSON.stringify(p).includes(claim));assert.equal((await apply({...s.input,confirmedPlanDigest:p.digest})).status,'complete');}finally{globalThis.fetch=fetch;}
  assert.deepEqual([...s.m.tables].filter(([name])=>name==='raw_items'||name.startsWith('sec_cover_')||name==='sec_structured_raw_sources'),snapshot);
  assert.ok(s.calls.every(n=>['acquire_ingest_workflow_lock','renew_ingest_workflow_lock','release_ingest_workflow_lock','persist_sec_ticker_resolution'].includes(n)));assert.equal(external,0);
  for(const table of ['tickers','events','user_profiles','alert_preferences','watchlists','kiwoom_sec_human_judgments','kiwoom_sec_human_comparisons'])assert.equal(s.m.get(table).length,0);
});
