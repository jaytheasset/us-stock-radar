// Owned native PostgreSQL only. No Docker, environment files, remote DB or live source calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import net from "node:net";
const root = process.cwd();
registerHooks({ resolve(s,c,n) {
  if (s === "server-only") return { shortCircuit: true, url: "data:text/javascript,export{}" };
  if (s.startsWith("@/")) { for (const ext of [".ts", ".tsx"]) { const f=path.join(root,s.slice(2)+ext); if(fs.existsSync(f))return{shortCircuit:true,url:pathToFileURL(f).href}; } }
  return n(s,c);
} });
const [bin, evidence, output] = process.argv.slice(2);
assert.ok(bin && evidence && output, "Usage: <native pg bin directory> <retained real-sec-link directory> <receipt directory>");
const pg = createRequire(import.meta.url)("pg");
const hash = v => createHash("sha256").update(v).digest("hex");
const read = f => fs.readFileSync(f,"utf8");
const json = f => JSON.parse(read(f));
const q = v => '"'+v.replaceAll('"','""')+'"';
fs.mkdirSync(output,{recursive:true});
const data = path.resolve(output,`owned-pg-${randomUUID()}`), marker=randomUUID();
fs.mkdirSync(data); fs.writeFileSync(data+".owner",marker);
const port = await new Promise((resolve,reject)=>{const s=net.createServer();s.on("error",reject);s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>resolve(p));});});
assert.ok(port > 3110);
const report = { base: "d1c869f2c75d17d2585a50049ed39418377797ad", checks: [], networkCalls:0, forbiddenWrites:0, cleanup:false,
  database: {host:"127.0.0.1",port,data,mode:"owned temporary native PostgreSQL cluster"}, fixtures:"real retained SEC and Kiwoom sources; synthetic login IDs and dependency tables; no real authenticated session" };
const check=(name,v=true)=>{assert.ok(v,name);report.checks.push(name);console.log("PASS",name);};
globalThis.fetch=async()=>{report.networkCalls++;throw new Error("No network allowed");};
const clients=[];let started=false;
function command(name,args){const r=spawnSync(path.join(bin,`${name}.exe`),args,{encoding:"utf8",windowsHide:true,stdio:name==="pg_ctl"?"ignore":"pipe",timeout:60000});if(r.status!==0)throw new Error(`${name}: ${r.stderr || r.stdout || r.error}`);return r.stdout;}
let setup;
try {
  command("initdb",["-D",data,"-U","postgres","-A","trust","--no-locale","-E","UTF8"]);
  command("pg_ctl",["-D",data,"-l",path.resolve(output,"postgres.log"),"-o",`-h 127.0.0.1 -p ${port}`,"-w","start"]);started=true;
  async function connect(role="postgres") { const c=new pg.Client({host:"127.0.0.1",port,user:"postgres",database:"postgres",statement_timeout:8000,connectionTimeoutMillis:5000});clients.push(c);await c.connect();
    assert.equal((await c.query("show data_directory")).rows[0].data_directory.replaceAll("\\","/"),data.replaceAll("\\","/"));
    if(role!=="postgres"){assert.ok(["service_role","anon","authenticated"].includes(role));await c.query(`set role ${role}`);}return c; }
  setup=await connect();
  await setup.query("create role service_role nologin bypassrls; create role anon nologin; create role authenticated nologin; create schema auth; create schema private; create schema extensions; create extension pgcrypto with schema extensions; create table auth.users(id uuid primary key); create table public.user_profiles(id uuid primary key references auth.users(id));");
  const foundation=read("supabase/migrations/20260729195029_admin_foundation_v1.sql");
  for(const name of ["admin_role_assignments","admin_audit_logs"]){const start=foundation.indexOf("create table if not exists public."+name);await setup.query(foundation.slice(start,foundation.indexOf("\n);",start)+3));}
  const ops=read("supabase/migrations/20260730040144_admin_operations_v2.sql"),at=ops.indexOf("create function private.admin_actor_role(");
  await setup.query(ops.slice(at,ops.indexOf("$function$;",at)+11));
  await setup.query("grant usage on schema public,private,auth,extensions to service_role; grant select on public.admin_role_assignments to service_role; grant select,insert on public.admin_audit_logs to service_role; grant execute on function private.admin_actor_role(uuid,text[]) to service_role;");
  const actor=randomUUID(),ordinary=randomUUID(),readOnly=randomUUID();
  for(const id of [actor,ordinary,readOnly]) {await setup.query("insert into auth.users values($1)",[id]);await setup.query("insert into public.user_profiles values($1)",[id]);}
  await setup.query("insert into public.admin_role_assignments(user_id,role) values($1,'operations'),($2,'support')",[actor,readOnly]);
  const { buildSecCoverObservationPayload } = await import("../lib/sec-cover-observations/canonical.ts");
  const { coverObservations } = await import("../lib/sec-ticker-resolution/persistence.ts");
  const { evaluateSecTickerResolution } = await import("../lib/sec-ticker-resolution/canonical.ts");
  const store = await import("../lib/ticker-verification/kiwoom/humanStorage.ts");
  const { reviewRequestHash } = await import("../lib/ticker-verification/kiwoom/review.ts");
  const { snapshotHash } = await import("../lib/ticker-verification/kiwoom/source.ts");
  const manifest=json(path.join(evidence,"manifest.json")), result=json(path.join(evidence,"human-exception-result.json"));
  const submissions=json(path.join(evidence,"submissions.json")), recent=submissions.filings.recent;
  const built=[];
  for(const f of manifest.filings) {
    const raw=read(path.join(evidence,f.file));assert.equal(hash(raw),f.sha256);
    const i=recent.accessionNumber.indexOf(f.accession),id=f.role==="before"?"10000000-0000-4000-8000-000000000001":"20000000-0000-4000-8000-000000000002";
    const url=`https://www.sec.gov/Archives/edgar/data/2041610/${f.accession.replaceAll("-","")}/${recent.primaryDocument[i]}`;
    const b=buildSecCoverObservationPayload(id,{id,source_code:"sec_edgar",source_group:"filings",source_unique_id:f.accession,source_url:url,fetched_at:f.capturedAt,
      raw_payload:{accession_number:f.accession,cik:"0002041610",form_type:recent.form[i],filing_date:recent.filingDate[i],accepted_at:recent.acceptanceDateTime[i],primary_document_url:url,
        primary_document_html:raw,primary_document_html_char_count:raw.length,primary_document_html_truncated:false}});
    assert.ok(b);built.push({b,raw,observations:coverObservations({result:b.result,observations:b.observations,payload:b.payload})});
  }
  const [before,after]=built,p=after.b.payload;
  const source={resultId:after.b.resultId,accessionNumber:p.identity.accessionNumber,issuerCik:p.identity.issuerCik,rawSourceId:p.source.rawSourceId,url:p.source.url,documentName:p.source.documentName,sha256:p.source.sha256,rawContent:after.raw};
  const evaluation=evaluateSecTickerResolution({issuerCik:p.identity.issuerCik,evidenceAccessionNumber:p.identity.accessionNumber,beforeAccessionNumber:before.b.payload.identity.accessionNumber,afterAccessionNumber:p.identity.accessionNumber,
    beforeSourceSha256:before.b.payload.source.sha256,afterSourceSha256:p.source.sha256,source,beforeObservations:before.observations,afterObservations:after.observations});
  assert.deepEqual(evaluation,result.automatic);
  // Minimal existing-table shapes populated by the actual parser; not alternate product readers.
  const seedTables={sec_structured_raw_sources:built.map(x=>x.b.sourceRaw),sec_cover_observation_results:built.map(x=>({...x.b.result,source_kind:"filing_xbrl"})),sec_cover_security_observations:built.flatMap(x=>x.b.observations),
    sec_ticker_resolution_decisions:[evaluation.decision],sec_ticker_security_identities:evaluation.identity?[evaluation.identity]:[],sec_ticker_change_evidence:evaluation.evidence?[evaluation.evidence]:[]};
  for(const [table,rows] of Object.entries(seedTables)) {
    const keys=[...new Set(rows.flatMap(Object.keys))];if(!keys.includes("id"))keys.push("id");if(!keys.includes("created_at"))keys.push("created_at");
    const type=k=>k==="id"||k.endsWith("_id")?"uuid":k==="created_at"?"timestamptz":rows.some(r=>r[k]!==null&&typeof r[k]==="object")?"jsonb":rows.some(r=>typeof r[k]==="number")?"integer":rows.some(r=>typeof r[k]==="boolean")?"boolean":"text";
    await setup.query(`create table public.${table}(${keys.map(k=>`${q(k)} ${type(k)}${k==="id"?" primary key default gen_random_uuid()":k==="created_at"?" default now()":""}`).join(",")})`);
    for(const row of rows) {const ks=Object.keys(row);await setup.query(`insert into public.${table}(${ks.map(q).join(",")}) values(${ks.map((_,i)=>`$${i+1}`).join(",")})`,ks.map(k=>type(k)==="jsonb"?JSON.stringify(row[k]):row[k]));}
    await setup.query(`grant select on public.${table} to service_role`);
  }
  const migrations=["20261008121000_kiwoom_ticker_evidence_reviews.sql","20261008121100_kiwoom_human_comparisons.sql"];
  for(const file of migrations)await setup.query(read(path.join("supabase/migrations",file)));
  report.migrations=migrations.map(file=>({file,sha256:hash(read(path.join("supabase/migrations",file)))}));
  check("actual migrations applied only to owned native cluster; existing role/audit DDL reused");
  const snapshot=json(path.join(evidence,"../live-snapshot.json")),old=result.originalLink,reviewId=old.observed.reviewId,reviewCase=old.observed.caseId;
  const draft={caseId:reviewCase,expectedRevision:0,noticeId:snapshot.id,expectedSourceHash:snapshot.sourceHash,verdict:"unclear",
    facts:{market:"US",kind:"symbol_change",securityName:"Class B source comparison fixture",...old.candidate.values},
    proof:{imageSha256:snapshot.images[0].sha256,locator:old.observed.locator,quote:null},usMarketRowReviewed:true,reason:"Retained original research row; synthetic authenticated actor for isolated DB test"};
  const seedAudit=randomUUID();
  await setup.query("insert into public.admin_audit_logs(id,actor_user_id,actor_role,action,target_type) values($1,$2,'operations','test.seed','test')",[seedAudit,actor]);
  await setup.query("insert into public.kiwoom_ticker_evidence_reviews(id,case_id,revision,actor_user_id,request_id,request_hash,source_hash,verdict,draft,snapshot,audit_log_id) values($1,$2,1,$3,$4,$5,$6,'unclear',$7,$8,$9)",[reviewId,reviewCase,actor,randomUUID(),reviewRequestHash(draft),snapshot.sourceHash,JSON.stringify(draft),JSON.stringify(snapshot),seedAudit]);
  const svc=await connect("service_role"),reader=await connect("service_role"),racer=await connect("service_role");
  function repository(c) {return {async select(table,query){
    assert.ok([...Object.keys(seedTables),"kiwoom_ticker_evidence_reviews","kiwoom_sec_human_judgments","kiwoom_sec_human_comparisons"].includes(table));
    try {const values=[],where=[];for(const [k,v] of Object.entries(query)){if(["select","order","limit"].includes(k))continue;assert.match(k,/^[a-z_][a-z0-9_]*$/);assert.ok(v.startsWith("eq."));values.push(v.slice(3));where.push(`${q(k)}=$${values.length}`);}
      const cols=query.select==="*"?"*":query.select.split(",").map(q).join(","),limit=Number(query.limit??30);assert.ok(limit>0&&limit<=1000);
      const order=query.order?" order by "+query.order.split(",").map(s=>{const[k,d]=s.split(".");assert.ok(["asc","desc"].includes(d));return q(k)+" "+d;}).join(","):"";
      const r=await c.query(`select ${cols} from public.${table}${where.length?" where "+where.join(" and "):""}${order} limit ${limit}`,values);
      return {ok:true,status:200,data:JSON.parse(JSON.stringify(r.rows))};
    } catch(e) {console.error("Fixture SELECT failed",table,e.message);return{ok:false,status:503,data:null,error:e.message};}
  },async rpc(name,args){if(name!=="admin_record_kiwoom_human_comparison"){report.forbiddenWrites++;throw new Error("Unexpected write RPC");}
    try {const r=await c.query("select public.admin_record_kiwoom_human_comparison($1,$2,$3,$4,$5,$6) as value",[args.p_actor_user_id,args.p_request_id,args.p_request_hash,JSON.stringify(args.p_draft),JSON.stringify(args.p_judgment),JSON.stringify(args.p_comparison)]);return{ok:true,status:200,data:r.rows[0].value};}
    catch(e){console.error("RPC rejected",e.message);return{ok:false,status:409,data:null,error:e.message};}
  }};}
  const repo=repository(svc),deps={repository:repo,fetchSnapshot:async()=>snapshot};
  const human=Object.fromEntries(["status","reason","values","eventStatus","security","proofs","exchangeTransfer"].map(k=>[k,result.secHuman[k]]));
  const input={actorUserId:actor,requestId:randomUUID(),draft:{action:"append",caseId:randomUUID(),expectedRevision:0,previousId:null,decisionId:evaluation.decision.id,
    expectedDecisionSha256:old.candidate.decisionSha256,expectedCandidateRevisionSha256:old.candidate.revisionSha256,source:result.secHuman.source,
    reviewId,expectedReviewRevision:1,expectedSnapshotSha256:snapshot.sourceHash,expectedImageSha256:snapshot.images[0].sha256,human,row:old.observed}};
  const saved=await store.saveHumanComparison(input,deps);
  assert.equal(saved.saved.judgment.actor.id,actor);assert.equal(saved.saved.comparison.comparison.status,"match");assert.equal(saved.saved.comparison.assessment.eligible,false);
  assert.deepEqual(saved.saved.comparison.automatic,evaluation);check("PSKY REVIEW/null/class B and three-field match preserved; correspondence unconfirmed and no ticker authority");
  const counts=async()=> (await setup.query("select (select count(*)::int from public.kiwoom_sec_human_judgments) h,(select count(*)::int from public.kiwoom_sec_human_comparisons) c,(select count(*)::int from public.admin_audit_logs where action like 'kiwoom_human.%') a")).rows[0];
  assert.deepEqual(await counts(),{h:1,c:1,a:1});check("judgment + comparison + audit committed atomically");
  const badRow={...input.draft,caseId:randomUUID(),row:{...input.draft.row,locator:"different source row"}};
  await assert.rejects(store.saveHumanComparison({...input,requestId:randomUUID(),draft:badRow},deps),e=>e.code==="KIWOOM_HUMAN_INPUT_INVALID");
  const changedBeforeSave=structuredClone(snapshot);changedBeforeSave.rawHtml+="<!-- new revision -->";changedBeforeSave.sourceHash=snapshotHash(changedBeforeSave);
  await assert.rejects(store.saveHumanComparison({...input,requestId:randomUUID(),draft:{...input.draft,caseId:randomUUID()}},{...deps,fetchSnapshot:async()=>changedBeforeSave}),e=>e.code==="KIWOOM_SOURCE_CHANGED");
  assert.deepEqual(await counts(),{h:1,c:1,a:1});check("wrong row locator and changed source rejected before save with zero partial writes");
  const readBack=await store.readHumanComparison(saved.saved.id,{...deps,repository:repository(reader)});assert.equal(readBack.status,"current");assert.deepEqual(readBack.saved,saved.saved);check("exact read-back through independent connection and current source checks");
  const retry=await store.saveHumanComparison(input,{repository:repo,fetchSnapshot:async()=>assert.fail("replay fetch")});assert.equal(retry.status,"replayed");assert.deepEqual(await counts(),{h:1,c:1,a:1});check("same actor/request/body replay without another write or upstream read");
  await assert.rejects(store.saveHumanComparison({...input,draft:{...input.draft,human:{...human,reason:"different body"}}},deps),e=>e.code==="KIWOOM_HUMAN_IDEMPOTENCY_CONFLICT");check("request ID reuse with different body rejected");
  const raceDraft={...input.draft,caseId:randomUUID()};const races=await Promise.allSettled([repo,repository(racer)].map(repository=>store.saveHumanComparison({...input,requestId:randomUUID(),draft:raceDraft},{...deps,repository})));
  assert.equal(races.filter(x=>x.status==="fulfilled").length,1);assert.ok(races.some(x=>x.status==="rejected"&&x.reason.code==="KIWOOM_HUMAN_REVISION_CONFLICT"));check("same expected revision, different requests: one winner only");
  const sameInput={...input,requestId:randomUUID(),draft:{...input.draft,caseId:randomUUID()}};
  const same=await Promise.all([repo,repository(racer)].map(repository=>store.saveHumanComparison(sameInput,{...deps,repository})));assert.deepEqual(same.map(x=>x.status).sort(),["inserted","replayed"]);check("same request concurrent replay inserts once");
  const interleaved={...input,requestId:randomUUID(),draft:{...input.draft,caseId:randomUUID()}};let completed=false;
  const interleavedRepo={...repo,select:async(table,query)=>{
    if(!completed && table==="kiwoom_sec_human_judgments" && query.case_id){completed=true;await store.saveHumanComparison(interleaved,{...deps,repository:repository(racer)});}
    return repo.select(table,query);
  }};
  const interleavedBefore=await counts();
  assert.equal((await store.saveHumanComparison(interleaved,{...deps,repository:interleavedRepo})).status,"replayed");
  assert.deepEqual(await counts(),Object.fromEntries(Object.entries(interleavedBefore).map(([k,n])=>[k,n+1])));
  check("same request completes between replay lookup and revision lookup: replay, not spurious conflict");
  for(const table of ["kiwoom_sec_human_comparisons","admin_audit_logs"]){const before=await counts();
    await setup.query(`create function private.fail_test() returns trigger language plpgsql as $$ begin raise exception 'INJECTED_FAILURE'; end $$; create trigger fail_test before insert on public.${table} for each row execute function private.fail_test()`);
    await assert.rejects(store.saveHumanComparison({...input,requestId:randomUUID(),draft:{...input.draft,caseId:randomUUID()}},deps));assert.deepEqual(await counts(),before);
    await setup.query(`drop trigger fail_test on public.${table}; drop function private.fail_test()`);check(`${table} insert failure rolls back all preceding inserts`);
  }
  for(const who of [ordinary,readOnly])await assert.rejects(store.saveHumanComparison({...input,actorUserId:who,requestId:randomUUID(),draft:{...input.draft,caseId:randomUUID()}},deps),e=>e.status===403);
  check("ordinary and support actor denied by existing DB role lookup");
  for(const role of ["anon","authenticated"]){const c=await connect(role);
    for(const table of ["kiwoom_sec_human_judgments","kiwoom_sec_human_comparisons"]){await assert.rejects(c.query(`select * from public.${table}`),e=>e.code==="42501");await assert.rejects(c.query(`insert into public.${table} default values`),e=>e.code==="42501");}
    await assert.rejects(c.query("select public.admin_record_kiwoom_human_comparison(null,null,null,null,null,null)"),e=>e.code==="42501");check(`${role} direct read/write/RPC denied`);
  }
  for(const table of ["kiwoom_sec_human_judgments","kiwoom_sec_human_comparisons"]){await assert.rejects(svc.query(`delete from public.${table}`),e=>e.code==="42501");await assert.rejects(setup.query(`delete from public.${table}`),/KIWOOM_EVIDENCE_APPEND_ONLY/);
    const col=table.endsWith("judgments")?"ticker_authority":"comparison_sha256";await assert.rejects(setup.query(`update public.${table} set ${col}=${col}`),/KIWOOM_EVIDENCE_APPEND_ONLY/);}
  check("append-only denies delete/update including trigger enforcement");
  const revised=await store.saveHumanComparison({...input,requestId:randomUUID(),draft:{...input.draft,expectedRevision:1,previousId:saved.saved.id,human:{...human,reason:"A separate new research revision"}}},deps);
  assert.equal((await store.readHumanComparison(saved.saved.id,deps)).status,"stale");assert.equal((await store.readHumanComparison(revised.saved.id,deps)).status,"current");check("new revision keeps historical row and makes prior comparison stale");
  const badRepo={...repo,select:async()=>({ok:false,status:503,data:null})};assert.equal((await store.readHumanComparison(revised.saved.id,{repository:badRepo})).status,"unavailable");
  assert.equal((await store.readHumanComparison(randomUUID(),deps)).status,"not_found");
  assert.equal((await store.readHumanComparison(revised.saved.id,{repository:{...repo,select:async()=>({ok:true,status:200,data:{bad:"shape"}})}})).status,"unavailable");check("not_found distinct from query failure and malformed success");
  const changed=structuredClone(snapshot);changed.rawHtml+="<!-- changed -->";changed.sourceHash=snapshotHash(changed);
  assert.equal((await store.readHumanComparison(revised.saved.id,{...deps,fetchSnapshot:async()=>changed})).status,"stale");
  const image=structuredClone(snapshot);image.images[0].base64=Buffer.concat([Buffer.from(image.images[0].base64,"base64"),Buffer.from("changed")]).toString("base64");image.images[0].sha256=hash(Buffer.from(image.images[0].base64,"base64"));image.sourceHash=snapshotHash(image);
  assert.equal((await store.readHumanComparison(revised.saved.id,{...deps,fetchSnapshot:async()=>image})).status,"stale");
  assert.equal((await store.readHumanComparison(revised.saved.id,{...deps,fetchSnapshot:async()=>{throw Error("outage");}})).status,"unavailable");check("notice/image change stale; source outage unavailable");
  const changedRepo=(table,mutate)=>({...repo,select:async(t,q)=>{const r=await repo.select(t,q);if(t===table)r.data=r.data.map(x=>mutate({...x}));return r;}});
  assert.notEqual((await store.readHumanComparison(revised.saved.id,{...deps,repository:changedRepo("sec_ticker_resolution_decisions",x=>({...x,decision_sha256:"f".repeat(64)}))})).status,"current");
  assert.notEqual((await store.readHumanComparison(revised.saved.id,{...deps,repository:changedRepo("sec_structured_raw_sources",x=>({...x,raw_content:x.raw_content+" changed"}))})).status,"current");
  assert.notEqual((await store.readHumanComparison(revised.saved.id,{...deps,repository:changedRepo("kiwoom_ticker_evidence_reviews",x=>({...x,revision:99}))})).status,"current");
  check("current candidate/source/review changes cannot reuse historical match");
  const changedRow=structuredClone(revised.saved.draft);changedRow.expectedRevision=2;changedRow.previousId=revised.saved.id;changedRow.row.values.newTicker="WRONG";
  const rowRevision=await store.saveHumanComparison({...input,requestId:randomUUID(),draft:changedRow},deps);
  assert.equal(rowRevision.saved.comparison.comparison.status,"conflict");assert.equal((await store.readHumanComparison(revised.saved.id,deps)).status,"stale");check("new transcription revision stores conflict and invalidates prior match");
  const withdrawal={...rowRevision.saved.draft,action:"withdraw",expectedRevision:3,previousId:rowRevision.saved.id,human:{...rowRevision.saved.draft.human,status:"withdrawn",reason:"Withdraw this research assertion"}};
  const withdrawn=await store.saveHumanComparison({...input,requestId:randomUUID(),draft:withdrawal},{repository:repo,fetchSnapshot:async()=>assert.fail("withdrawal upstream")});
  assert.equal(withdrawn.saved.revision,4);assert.equal((await store.readHumanComparison(saved.saved.id,deps)).status,"withdrawn");assert.equal((await store.readHumanComparison(withdrawn.saved.id,deps)).status,"withdrawn");check("withdrawal appends revision, preserves history and never returns current");
  const withdrawnReviewDraft={...draft,expectedRevision:1,verdict:"withdrawn",reason:"Withdraw original Kiwoom review in isolated fixture"};
  await svc.query("select public.admin_record_kiwoom_ticker_evidence($1,$2,$3,$4,$5)",[actor,randomUUID(),reviewRequestHash(withdrawnReviewDraft),JSON.stringify(withdrawnReviewDraft),JSON.stringify(snapshot)]);
  const afterReviewWithdrawal=await store.readHumanComparison(same[0].saved.id,{repository:repo,fetchSnapshot:async()=>assert.fail("withdrawn review cannot fetch/reuse source")});
  assert.equal(afterReviewWithdrawal.status,"withdrawn");assert.equal(afterReviewWithdrawal.saved.comparison.comparison.status,"match");
  await assert.rejects(store.saveHumanComparison({...input,requestId:randomUUID(),draft:{...input.draft,caseId:randomUUID()}},deps),e=>e.code==="KIWOOM_LINK_REVIEW_WITHDRAWN");
  check("existing review withdrawal invalidates a still-active human comparison; historical match retained but append blocked");
  const originalRows=await svc.query("select decision_payload from public.sec_ticker_resolution_decisions where id=$1",[evaluation.decision.id]);assert.deepEqual(originalRows.rows[0].decision_payload,evaluation.decision.decision_payload);
  assert.equal(report.networkCalls,0);assert.equal(report.forbiddenWrites,0);check("automatic payload unchanged; no network or ticker/current/Watchlist/Alert write calls");
  report.psky={automatic:evaluation.summary,state:evaluation.resolutionState,reasons:evaluation.reasons,human:saved.saved.judgment.values,kiwoom:saved.saved.comparison.originalLink.observed.values,
    comparison:saved.saved.comparison.comparison,assessment:saved.saved.comparison.assessment,tickerAuthority:saved.saved.tickerAuthority};
  report.pass=true;
} catch(e) {report.pass=false;report.error=e.stack;console.error(e);process.exitCode=1;}
finally {
  for(const c of clients)await c.end().catch(()=>{});
  if(started || fs.existsSync(path.join(data,"postmaster.pid")))command("pg_ctl",["-D",data,"-m","fast","-w","stop"]);
  assert.equal(read(data+".owner"),marker);
  assert.ok(data.startsWith(path.resolve(output)+path.sep));
  fs.rmSync(data,{recursive:true});fs.unlinkSync(data+".owner");report.cleanup=true;
  fs.writeFileSync(path.join(output,"postgres-result.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,cleanup:report.cleanup}));
}
