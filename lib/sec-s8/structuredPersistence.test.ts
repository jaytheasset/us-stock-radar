import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) { return s === "server-only" ? { shortCircuit: true, url: "data:text/javascript,export{}" } : next(s, c); } });
const { loadS8StructuredInput, readS8Structured, s8ExecutionId, S8_STRUCTURED_PURPOSE } = await import("./structuredPersistence.ts");
const { enqueueS8Structured, processS8Structured } = await import("./structuredRuntime.ts");
const { s8MonitorFacts } = await import("../monitor/s8StructuredFacts.ts");
const { evaluateMonitorConditions } = await import("../listingMonitorMatcher.ts");
const { getReadyMonitorConditions } = await import("../monitor/conditionRegistry.ts");
import { buildS8DirectFacts, captureS8Document, hash, stable } from "./directFacts.ts";
import { buildS8StructuredSource } from "./structuredSource.ts";
import type { S8Repository } from "./persistence.ts";
import { S8_STRUCTURED_VERSION, validateS8Structured } from "./structuredContract.ts";

const id = "00000000-0000-4000-a000-000000000001", accession = "0000000001-26-000001";
function setup() {
  const url = `https://www.sec.gov/Archives/edgar/data/1/${accession.replaceAll("-", "")}/s8.htm`;
  const raw = { id, source_code: "sec_edgar", source_unique_id: accession,
    raw_payload: { accession_number: accession, cik: "1", form_type: "S-8", filing_date: "2026-01-02",
      primary_document_url: url, s8_source: { version: "sec_s8_original_v1", documents: [captureS8Document("S-8",
        { url, type: "S-8", description: null, isPrimary: true }, "<html><p>2026 Incentive Plan</p></html>")!] } } };
  const d = buildS8DirectFacts(raw);
  const direct = { accession_number: accession, raw_item_id: id, issuer_cik: d.facts.issuerCik,
    form_type: "S-8", sources: d.source, facts: d.facts, source_sha256: d.sourceSha256, facts_sha256: d.factsSha256 };
  const wire = { version: S8_STRUCTURED_VERSION, filing_kind: "registration", current_plans: [
    { name: "2026 Incentive Plan", evidence: ["E1"] }], prior_filings: [], unresolved: [] };
  const runs: Record<string, any>[] = [], outputs: Record<string, any>[] = [];
  const repo: S8Repository = {
    async select(table, query) {
      const list = table === "raw_items" ? [raw] : table === "sec_s8_registration_filings" ? [direct] : table === "ai_runs" ? runs : outputs;
      return { ok: true, data: structuredClone(list.filter(r => Object.entries(query).every(([k, v]) =>
        ["select", "limit", "order"].includes(k) || String((r as any)[k]) === v.slice(3)))) };
    },
    async rpc(name, args) {
      if (name === "reserve_sec_s8_structured") {
        const old = runs.find(r => r.id === args.p_id);
        if (!old) runs.push({ id: args.p_id, raw_item_id: id, prompt_key: S8_STRUCTURED_PURPOSE,
          prompt_version: S8_STRUCTURED_VERSION, model: "gemini-3.5-flash", status: "pending", metadata: { binding: args.p_binding } });
        return { ok: true, data: { inserted: !old } };
      }
      const run = runs.find(r => r.id === args.p_id)!;
      const action = name === "claim_sec_s8_structured" ? "claim" : args.p_action;
      if (["succeeded","failed","stale"].includes(run?.status)) return {ok:true,data:{status:"duplicate",claimed:false,executionStatus:run.status}};
      if (action === "schedule") {
        if (run.metadata.scheduled) return {ok:true,data:{claimed:false,status:"busy"}};
        run.metadata.scheduled=true; return {ok:true,data:{claimed:true,token:"scheduler"}};
      }
      if (action === "claim") {
        const claimed = run?.status === "pending"; if (claimed) run.status = "running";
        return { ok: true, data: { claimed, status:claimed?"claimed":"busy", token:"owner", binding: run?.metadata.binding,
          checkpoint:run.metadata.s8Checkpoint ?? null } };
      }
      if (action === "checkpoint") {run.metadata.s8Checkpoint=args.p_value;return {ok:true,data:{status:"checkpoint"}};}
      if (action === "finish") {
        run.status = (args.p_value as any)?.stale ? "stale" : run.metadata.s8Checkpoint.status;
        outputs.push({ id: "output", ai_run_id: run.id, output_type: S8_STRUCTURED_PURPOSE, payload: run.metadata.s8Checkpoint.payload });
        return { ok: true, data: { status: run.status } };
      }
      return { ok: true, data: { linked: true } };
    },
  };
  const analyze = async () => {
    const v = validateS8Structured(wire, buildS8StructuredSource(raw)); assert.equal(v.ok, true); if (!v.ok) throw Error("fixture");
    return { stage: "complete" as const, result: v.result, run: { ok: true, responseOk: true,
      status: 200, statusText: "OK", model: "gemini-3.5-flash", responseId: null,
      outputText: JSON.stringify(wire), parsed: wire, usage: null, body: null } };
  };
  async function stored() {
    const i = await loadS8StructuredInput(id, repo);
    runs.push({ id: i.executionId, raw_item_id: id, prompt_key: S8_STRUCTURED_PURPOSE, prompt_version: S8_STRUCTURED_VERSION,
      model: "gemini-3.5-flash", status: "succeeded", metadata: { binding: i.binding } });
    const text = JSON.stringify(wire);
    outputs.push({ id: "output", ai_run_id: i.executionId, output_type: S8_STRUCTURED_PURPOSE,
      payload: { binding: i.binding, outputText: text, outputSha256: hash(text) } });
    return i;
  }
  return { raw, direct, wire, repo, runs, outputs, stored, analyze };
}

test("source execution identity separates source, raw ID and contract; automatic replay stable", () => {
  const value = s8ExecutionId(id, "abc"); assert.equal(value, s8ExecutionId(id, "abc"));
  assert.notEqual(value, s8ExecutionId(id, "changed")); assert.notEqual(value, s8ExecutionId(id, "abc", "s8_structured_v7"));
  assert.notEqual(value, s8ExecutionId("00000000-0000-4000-a000-000000000002", "abc"));
});
test("input requires real raw plus validated direct history and has no Primary dependency", async () => {
  const f = setup(), i = await loadS8StructuredInput(id, f.repo);
  assert.equal(i.binding.accession, accession); assert.equal(i.binding.model, "gemini-3.5-flash");
  assert.equal("parentPrimaryAiRunId" in i.binding, false);
});
test("wrong raw identity is rejected", async () => {
  const f = setup(); f.raw.id = "00000000-0000-4000-a000-000000000002";
  await assert.rejects(loadS8StructuredInput(id, f.repo), /raw_identity/);
});
test("wrong accession is rejected", async () => {
  const f = setup(); f.raw.source_unique_id = "0000000001-26-000002";
  await assert.rejects(loadS8StructuredInput(id, f.repo));
});
test("wrong direct source hash is rejected", async () => {
  const f = setup(); f.direct.source_sha256 = "0".repeat(64);
  await assert.rejects(loadS8StructuredInput(id, f.repo), /direct_unavailable/);
});
test("exact reader keeps direct separate and leaves semantic output unchanged", async () => {
  const f = setup(); await f.stored(); const result = await readS8Structured(id, f.repo);
  assert.equal(result.status, "available"); if (result.status !== "available") return;
  assert.deepEqual(result.semantic, f.wire); assert.deepEqual(result.direct, f.direct.facts);
  assert.equal("directRegistrationRows" in result.semantic, false);
});
test("missing structured result is unavailable", async () => {
  assert.deepEqual(await readS8Structured(id, setup().repo), { status: "unavailable", reason: "structured_missing" });
});
for (const field of ["raw_item_id", "prompt_version", "model"] as const) test(`reader rejects wrong ${field}`, async () => {
  const f = setup(); await f.stored(); f.runs[0][field] = "wrong";
  assert.equal((await readS8Structured(id, f.repo)).status, "unavailable");
});
test("reader rejects fingerprint mismatch", async () => {
  const f = setup(); await f.stored(); f.runs[0].metadata.binding.sourceFingerprint = "0".repeat(64);
  assert.equal((await readS8Structured(id, f.repo)).status, "unavailable");
});
test("changed raw source cannot read old semantic result as current", async () => {
  const f = setup(); await f.stored(); f.raw.raw_payload.filing_date = "2026-01-03";
  assert.equal((await readS8Structured(id, f.repo)).status, "unavailable"); assert.equal(f.outputs.length, 1);
});
test("reader detects tampered output", async () => {
  const f = setup(); await f.stored(); f.outputs[0].payload.outputText += " ";
  assert.equal((await readS8Structured(id, f.repo)).status, "unavailable");
});
test("two enqueues start only one raw-bound workflow", async () => {
  const f = setup(); let starts = 0; const start = async () => { starts++; return { runId: "workflow-1" }; };
  const results = await Promise.all([enqueueS8Structured(id, { repository: f.repo, start }), enqueueS8Structured(id, { repository: f.repo, start })]);
  assert.deepEqual(results.map(r => r.status).sort(), ["duplicate", "enqueued"]); assert.equal(starts, 1);
});
test("ambiguous enqueue failure never permits an automatic replacement call", async () => {
  const f = setup(); const start = async () => { throw Error("transport"); };
  assert.equal((await enqueueS8Structured(id, { repository: f.repo, start })).status, "enqueue_uncertain");
  assert.equal((await enqueueS8Structured(id, { repository: f.repo, start })).status, "duplicate");
});
test("source refresh before execution is stale with zero analyzer calls", async () => {
  const f = setup(); const i = await enqueueS8Structured(id, { repository: f.repo, start: async () => ({ runId: "test" }) });
  f.raw.raw_payload.filing_date = "2026-01-03"; let calls = 0;
  assert.equal((await processS8Structured({ executionId: i.executionId, rawItemId: id }, { repository: f.repo,
    analyze: async () => { calls++; return f.analyze(); } })).status, "stale"); assert.equal(calls, 0);
});
test("failed analyzer is terminal and replay does not call again", async () => {
  const f = setup(); const i = await enqueueS8Structured(id, { repository: f.repo, start: async () => ({ runId: "test" }) }); let calls = 0;
  const options = { repository: f.repo, analyze: async () => { calls++; throw Error("provider failed"); } };
  assert.equal((await processS8Structured({ executionId: i.executionId, rawItemId: id }, options)).status, "failed");
  assert.equal((await processS8Structured({ executionId: i.executionId, rawItemId: id }, options)).status, "duplicate");
  assert.equal(calls, 1);
});
test("successful execution passes fixed model/raw only and persists exact output once", async () => {
  const f = setup(); const queued = await enqueueS8Structured(id, { repository: f.repo, start: async () => ({ runId: "test" }) });
  let calls = 0;
  const job = { executionId: queued.executionId, rawItemId: id };
  const options = { repository: f.repo, analyze: async (raw: Record<string, unknown>, settings: any) => {
    calls++; assert.deepEqual(raw, f.raw); assert.equal(settings.model, "gemini-3.5-flash"); return f.analyze();
  } };
  assert.equal((await processS8Structured(job, options)).status, "succeeded");
  assert.equal((await processS8Structured(job, options)).status, "duplicate");
  assert.equal(calls, 1); assert.equal(f.outputs.length, 1);
  const read = await readS8Structured(id, f.repo); assert.equal(read.status, "available");
  if (read.status === "available") assert.deepEqual(read.semantic, f.wire);
});
test("model error is preserved without semantic repair or retry", async () => {
  const f = setup(); const queued = await enqueueS8Structured(id, { repository: f.repo, start: async () => ({ runId: "test" }) });
  const original = await f.analyze(); original.run.outputText = '{"bad":';
  const result = await processS8Structured({ executionId: queued.executionId, rawItemId: id }, { repository: f.repo,
    analyze: async () => ({ stage: "validation_error", result: null, run: original.run, error: "invalid JSON", validation_errors: ["invalid JSON"] }) });
  assert.equal(result.status, "failed"); assert.equal(f.outputs[0].payload.outputText, '{"bad":');
  assert.equal((await readS8Structured(id, f.repo)).status, "unavailable");
});
test("only filing_kind is registered; arrays and quantities have no scalar conditions", () => {
  const conditions = getReadyMonitorConditions().filter(c => c.family === "s8");
  assert.deepEqual(conditions.map(c => c.key), ["s8.filing_kind"]);
  assert.deepEqual(conditions[0].allowedOperators, ["eq", "in"]); assert.deepEqual(conditions[0].monitorDomains, []);
});
test("existing Matcher eq/in, unavailable/unclear and unresolved semantics", async () => {
  const f = setup(); await f.stored();
  const compare = async (operator: string, value: unknown) => evaluateMonitorConditions({
    s8: s8MonitorFacts(await readS8Structured(id, f.repo)),
    listing: { status: "not_ready", reason: "unused" }, corporateAction: { status: "not_ready", reason: "unused" },
    ownership: { status: "not_ready", reason: "unused" },
  }, [{ key: "s8.filing_kind", operator, value }], { evaluationDate: "2026-01-03" });
  assert.equal((await compare("eq", "registration")).status, "match");
  assert.equal((await compare("in", ["amendment", "registration"])).status, "match");
  assert.equal((await compare("eq", "amendment")).status, "no_match");
  const saved = f.outputs[0].payload;
  for (const wire of [{ ...f.wire, filing_kind: "unclear" }, { ...f.wire, unresolved: ["filing_kind"] }]) {
    saved.outputText = JSON.stringify(wire); saved.outputSha256 = hash(saved.outputText);
    assert.equal((await compare("eq", wire.filing_kind)).status, "ineligible");
  }
  f.outputs.length = 0; assert.equal((await compare("eq", "registration")).status, "ineligible");
  assert.equal(stable(f.direct.facts.registrationRows), "[]");
});

test("explicit verification history does not replace automatic success", async () => {
  const f = setup(); await f.stored(); const automatic = await readS8Structured(id, f.repo);
  const key = "durable-fixture";
  const queued = await enqueueS8Structured(id, {repository:f.repo,verificationKey:key,start:async()=>({runId:"verification"})});
  assert.notEqual(queued.executionId, f.runs[0].id);
  assert.equal((await processS8Structured({executionId:queued.executionId,rawItemId:id,verificationKey:key}, {repository:f.repo,analyze:f.analyze})).status,"succeeded");
  assert.deepEqual(await readS8Structured(id,f.repo),automatic);
  assert.equal((await readS8Structured(id,f.repo,key)).status,"available");
  assert.equal(f.outputs.length,2);
  await assert.rejects(loadS8StructuredInput(id,f.repo,"../unsafe"),/verification_key/);
});

test("persistence-only retry reuses checkpoint and never recalls provider", async () => {
  const {analyzeS8StructuredJob,persistS8StructuredJob}=await import("./structuredRuntime.ts");
  const f=setup();const queued=await enqueueS8Structured(id,{repository:f.repo,start:async()=>({runId:"test"})});let calls=0;
  const prepared=await analyzeS8StructuredJob({executionId:queued.executionId,rawItemId:id},{repository:f.repo,analyze:async()=>{calls++;return f.analyze()}});
  assert.equal(prepared.status,"prepared");assert.equal(f.outputs.length,0);
  const offline:S8Repository={...f.repo,rpc:async()=>({ok:false,data:null,error:"db unavailable"})};
  await assert.rejects(persistS8StructuredJob(prepared,offline),/db unavailable/);
  assert.equal((await persistS8StructuredJob(prepared,f.repo)).status,"succeeded");
  assert.equal(calls,1);assert.equal(f.outputs.length,1);
});

test("source changed after checkpoint is not read as current output", async () => {
  const {analyzeS8StructuredJob,persistS8StructuredJob}=await import("./structuredRuntime.ts");
  const f=setup();const queued=await enqueueS8Structured(id,{repository:f.repo,start:async()=>({runId:"test"})});
  const prepared=await analyzeS8StructuredJob({executionId:queued.executionId,rawItemId:id},{repository:f.repo,analyze:f.analyze});
  await persistS8StructuredJob(prepared,f.repo);
  f.raw.raw_payload.filing_date="2026-01-03";
  assert.equal((await readS8Structured(id,f.repo)).status,"unavailable");
  assert.equal(f.outputs.length,1);
});

test("reclaimed job prefers persisted checkpoint and does not call analyzer", async () => {
  const {analyzeS8StructuredJob}=await import("./structuredRuntime.ts");const f=setup();
  const queued=await enqueueS8Structured(id,{repository:f.repo,start:async()=>({runId:"test"})});
  const job={executionId:queued.executionId,rawItemId:id};
  await analyzeS8StructuredJob(job,{repository:f.repo,analyze:f.analyze});
  f.runs[0].status="pending"; // Mock expired lease; real SQL expiry/race is covered by verify-s8-lease-recovery.
  let calls=0;const result=await processS8Structured(job,{repository:f.repo,analyze:async()=>{calls++;return f.analyze()}});
  assert.equal(result.status,"succeeded");assert.equal(calls,0);assert.equal(f.outputs.length,1);
});

test("recovered checkpoint binding tampering is rejected before any provider call", async () => {
  const {analyzeS8StructuredJob}=await import("./structuredRuntime.ts");const f=setup();
  const queued=await enqueueS8Structured(id,{repository:f.repo,start:async()=>({runId:"test"})});const job={executionId:queued.executionId,rawItemId:id};
  await analyzeS8StructuredJob(job,{repository:f.repo,analyze:f.analyze});f.runs[0].status="pending";
  f.runs[0].metadata.s8Checkpoint.payload.outputSha256="0".repeat(64);
  await assert.rejects(processS8Structured(job,{repository:f.repo,analyze:async()=>{throw Error("must not call")}}),/checkpoint_binding_invalid/);
  assert.equal(f.outputs.length,0);
});

test("failed validation checkpoint resumes storage without semantic retry", async () => {
  const {analyzeS8StructuredJob}=await import("./structuredRuntime.ts");const f=setup();const queued=await enqueueS8Structured(id,{repository:f.repo,start:async()=>({runId:"test"})});const job={executionId:queued.executionId,rawItemId:id};
  const original=await f.analyze();original.run.outputText='{"invalid":';
  await analyzeS8StructuredJob(job,{repository:f.repo,analyze:async()=>({stage:"validation_error",result:null,run:original.run,error:"bad JSON",validation_errors:["bad JSON"]})});
  f.runs[0].status="pending";
  assert.equal((await processS8Structured(job,{repository:f.repo,analyze:async()=>{throw Error("must not retry")}})).status,"failed");
  assert.equal(f.outputs[0].payload.outputText,'{"invalid":');assert.equal((await readS8Structured(id,f.repo)).status,"unavailable");
});
