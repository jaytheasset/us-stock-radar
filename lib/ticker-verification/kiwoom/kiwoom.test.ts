import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fetchKiwoomNoticeList, fetchKiwoomSnapshot, parseNoticeList, parseNoticeDetail, snapshotHash, validateSnapshot, KiwoomError, type KiwoomSnapshot } from "./source.ts";
import { parseReviewDraft, validateReviewProof, compareReviewedSource, type ReviewDraft } from "./review.ts";
import { saveKiwoomReview, getKiwoomReview, listKiwoomReviews, type KiwoomReviewRepository } from "./service.ts";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2UAAAAASUVORK5CYII=", "base64");
const meta = { seqid: 4611, scrnTp: "NWGCZ", ttl: "[해외주식] 심볼변경 효력일", makeTime: "2026.10.06", custPsdn: "글로벌영업팀" };
const html = '<p>US security SYN changes to NEW on October 9, 2026.</p><img src="/bbs/VBbsNoticeImageView?apndnm=test.png"><p>계좌 잔고 반영은 별도입니다.</p>';
function sourceFetch(htmlValue = html, bytes = png, calls: string[] = []): typeof fetch {
  return (async (url: string | URL | Request, options?: RequestInit) => {
    const target = String(url); calls.push(target); assert.equal(options?.redirect, "error"); assert.ok(options?.signal);
    if (target.includes("DetailAjax")) return Response.json({ noticeDetail: { ...meta, dtlCntn: htmlValue, attcFile: [] } });
    return new Response(bytes, { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
}
async function snapshot() { return fetchKiwoomSnapshot("4611", sourceFetch()); }
function draft(source: KiwoomSnapshot, patch: Partial<ReviewDraft> = {}): ReviewDraft {
  return { caseId: randomUUID(), expectedRevision: 0, noticeId: source.id, expectedSourceHash: source.sourceHash, verdict: "supports",
    facts: { market: "US", kind: "symbol_change", securityName: "Synthetic Common Stock", oldTicker: "SYN", newTicker: "NEW", effectiveDate: "2026-10-09" },
    proof: { imageSha256: source.images[0]?.sha256 ?? null, locator: "US section, row 1", quote: null }, usMarketRowReviewed: true, reason: "Manually checked exact US market row.", ...patch };
}
function repository() {
  const stored: Record<string, unknown>[] = []; let writes = 0;
  const repo: KiwoomReviewRepository = {
    async select(_table, query) {
      let results = stored.filter(row => Object.entries(query).every(([key, value]) => !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
      if (query.order?.startsWith("revision.desc")) results = [...results].sort((a,b)=>Number(b.revision)-Number(a.revision));
      return { ok: true, data: structuredClone(results.slice(0, Number(query.limit ?? 30))) };
    },
    async rpc(name, input) {
      assert.equal(name, "admin_record_kiwoom_ticker_evidence"); writes++;
      const d = input.p_draft as ReviewDraft, s = input.p_snapshot as KiwoomSnapshot;
      const row = { id: randomUUID(), case_id: d.caseId, revision: d.expectedRevision+1, actor_user_id: input.p_actor_user_id, request_id: input.p_request_id,
        request_hash: input.p_request_hash, source_hash: s.sourceHash, verdict: d.verdict, draft: d, snapshot: s, ticker_authority: "none", created_at: new Date().toISOString() };
      stored.push(structuredClone(row)); return { ok: true, data: { status: "inserted", review: row } };
    },
  };
  return { repo, stored, writes: () => writes };
}
test("official notice discriminator excludes customer posts even with spoofed titles/authors", () => {
  const result = parseNoticeList({ boardList: [{ ...meta, step: 0 }, { ...meta, seqid: 10, step: 1, custPsdn: "글로벌영업팀", ttl: "심볼변경" }] });
  assert.deepEqual(result.map(x=>x.id), ["4611"]); assert.equal(parseNoticeList({ boardList: [] }).length,0);
  for (const value of [null, {}, {boardList:{}}, {boardList:[{...meta,step:"0"}]}, {boardList:[{...meta,step:0,scrnTp:"BWGCZ"}]}, {boardList:[{...meta,step:0},{...meta,step:0}]}])
    assert.throws(()=>parseNoticeList(value));
});
test("detail must be exact official ID; attachments and unsafe images are not silently skipped", () => {
  const value = {noticeDetail:{...meta,dtlCntn:html,attcFile:[]}};
  assert.equal(parseNoticeDetail(value,"4611").imageUrls.length,1);
  assert.throws(()=>parseNoticeDetail(value,"4612"));
  for (const bad of ['https://evil.example/a.png','http://bbn.kiwoom.com/bbs/VBbsNoticeImageView?apndnm=test.png','/bbs/VBbsNoticeImageView?apndnm=test.svg','/bbs/VBbsNoticeImageView?apndnm=x.png&extra=1'])
    assert.throws(()=>parseNoticeDetail({noticeDetail:{...meta,dtlCntn:`<img src="${bad}">`,attcFile:[]}},"4611"));
  assert.throws(()=>parseNoticeDetail({noticeDetail:{...meta,dtlCntn:html,attcFile:[{file:'data.pdf'}]}},"4611"));
});
test("source uses only the fixed public notice and image endpoints; hashes include image bytes", async () => {
  const calls:string[]=[]; const s=await fetchKiwoomSnapshot("4611",sourceFetch(html,png,calls));
  assert.equal(calls.length,2); assert.ok(validateSnapshot(s));
  assert.equal(snapshotHash({...s,capturedAt:'2020-01-01T00:00:00Z'}),s.sourceHash);
  const changed=await fetchKiwoomSnapshot("4611",sourceFetch(html,Buffer.concat([png,Buffer.from('changed')])));
  assert.notEqual(changed.sourceHash,s.sourceHash);
  for (const key of ['title','text','rawHtml','sourceHash'] as const) assert.equal(validateSnapshot({...s,[key]:'altered'}),false);
  assert.equal(validateSnapshot({...s,images:[{...s.images[0],base64:png.subarray(0,20).toString('base64')}]}),false);
});
test("fetch errors and malformed/oversized bodies do not become empty successful lists", async () => {
  const cases:typeof fetch[]=[async()=>new Response('broken'),async()=>new Response('down',{status:503}),async()=>Response.json({boardList:null}),async()=>new Response('{}',{headers:{'content-length':'9000000'}})];
  for(const fetchImpl of cases) await assert.rejects(fetchKiwoomNoticeList(1,fetchImpl));
  assert.deepEqual((await fetchKiwoomNoticeList(1,async()=>Response.json({boardList:[]}))).items,[]);
  await assert.rejects(fetchKiwoomSnapshot('../secret',async()=>assert.fail('invalid ID must not fetch')));
  await assert.rejects(fetchKiwoomSnapshot('4611',sourceFetch(html,Buffer.from('<html>not image</html>'))));
});
test("review has no CIK, ticker-authority, account-date or non-US escape hatch",async()=>{
  const s=await snapshot(),d=draft(s); assert.doesNotThrow(()=>validateReviewProof(parseReviewDraft(d),s));
  for(const value of [{...d,cik:'0001853138'},{...d,verified:true},{...d,facts:{...d.facts,market:'HK'}},{...d,facts:{...d.facts,balanceDate:'2026-10-20'}},
    {...d,facts:{...d.facts,effectiveDate:'2026-02-30'}},{...d,facts:{...d.facts,oldTicker:'A/B'}},{...d,usMarketRowReviewed:false},{...d,facts:{...d.facts,effectiveDate:null}}]) assert.throws(()=>parseReviewDraft(value));
  assert.doesNotThrow(()=>parseReviewDraft({...d,verdict:'unclear',facts:{...d.facts,effectiveDate:null},usMarketRowReviewed:false}));
});
test("proof binds exact image/text and excludes broker-account guidance; not semantic proof",async()=>{
  const s=await snapshot(),d=draft(s);
  for(const proof of [{...d.proof,imageSha256:'f'.repeat(64)},{...d.proof,quote:'not present'}, {imageSha256:null,locator:'broker',quote:'계좌 잔고 반영은 별도입니다.'}])
    assert.throws(()=>validateReviewProof({...d,proof},s));
  assert.doesNotThrow(()=>validateReviewProof({...d,proof:{imageSha256:null,locator:'paragraph 1',quote:'US security SYN changes to NEW on October 9, 2026.'}},s));
  // A genuine image reference is NOT proof the operator interpreted its row correctly.
  assert.doesNotThrow(()=>validateReviewProof({...d,facts:{...d.facts,newTicker:'WRONG'}},s));
});
test("save, read-back, idempotent retry and collision all preserve separate evidence authority",async()=>{
  const s=await snapshot(),d=draft(s),m=repository(),actor=randomUUID(),rid=randomUUID();let fetches=0;
  const deps={repository:m.repo,fetchSnapshot:async()=>{fetches++;return s;}};
  const saved=await saveKiwoomReview({actorUserId:actor,requestId:rid,draft:d},deps);
  assert.equal(saved.review.tickerAuthority,'none');assert.equal(saved.status,'inserted');
  assert.equal((await getKiwoomReview(saved.review.id,m.repo)).snapshot.sourceHash,s.sourceHash);
  assert.equal((await listKiwoomReviews(m.repo)).length,1);
  assert.equal((await saveKiwoomReview({actorUserId:actor,requestId:rid,draft:d},deps)).status,'replayed');
  assert.equal(m.writes(),1);assert.equal(fetches,1);
  await assert.rejects(saveKiwoomReview({actorUserId:actor,requestId:rid,draft:{...d,reason:'changed request'}},deps),e=>e instanceof KiwoomError&&e.code==='KIWOOM_IDEMPOTENCY_CONFLICT');
});
test("changed publisher bytes or failed image fetch blocks save with zero repository writes",async()=>{
  const s=await snapshot(),d=draft(s),m=repository();const changed=await fetchKiwoomSnapshot('4611',sourceFetch(html+'<p>updated</p>'));
  await assert.rejects(saveKiwoomReview({actorUserId:randomUUID(),requestId:randomUUID(),draft:d},{repository:m.repo,fetchSnapshot:async()=>changed}),e=>e instanceof KiwoomError&&e.code==='KIWOOM_SOURCE_CHANGED');
  await assert.rejects(saveKiwoomReview({actorUserId:randomUUID(),requestId:randomUUID(),draft:d},{repository:m.repo,fetchSnapshot:async()=>{throw new Error('image unavailable');}}));
  assert.equal(m.writes(),0);
});
test("withdrawal is append-only and does not require an available upstream",async()=>{
  const s=await snapshot(),d=draft(s),m=repository(),actor=randomUUID();
  const first=await saveKiwoomReview({actorUserId:actor,requestId:randomUUID(),draft:d},{repository:m.repo,fetchSnapshot:async()=>s});
  const next={...d,expectedRevision:1,verdict:'withdrawn' as const,reason:'Withdrawing prior human assessment'};
  const second=await saveKiwoomReview({actorUserId:actor,requestId:randomUUID(),draft:next},{repository:m.repo,fetchSnapshot:async()=>assert.fail('no fetch on withdrawal')});
  assert.equal(m.stored.length,2);assert.equal(first.review.draft.verdict,'supports');assert.equal(second.review.revision,2);
  assert.equal(compareReviewedSource(first.review,s),'same');
  const changed=await fetchKiwoomSnapshot('4611',sourceFetch(html+'<p>update</p>'));assert.equal(compareReviewedSource(first.review,changed),'changed');
});
test("corrupt saved data and unavailable store never masquerade as no history",async()=>{
  for(const data of [null,{},'[]']) await assert.rejects(listKiwoomReviews({select:async()=>({ok:true,data}),rpc:async()=>assert.fail()}));
  const s=await snapshot(),m=repository();const first=await saveKiwoomReview({actorUserId:randomUUID(),requestId:randomUUID(),draft:draft(s)},{repository:m.repo,fetchSnapshot:async()=>s});
  m.stored[0].ticker_authority='approved';await assert.rejects(getKiwoomReview(first.review.id,m.repo));
});

test("withdraw after source recheck must retain the saved source and candidate, not the newly viewed draft",async()=>{
  const s=await snapshot(),d=draft(s),m=repository(),actor=randomUUID();
  const first=await saveKiwoomReview({actorUserId:actor,requestId:randomUUID(),draft:d},{repository:m.repo,fetchSnapshot:async()=>s});
  const changed=await fetchKiwoomSnapshot('4611',sourceFetch(html+'<p>publisher revision</p>'));
  const withdrawal={...first.review.draft,expectedRevision:first.review.revision,verdict:'withdrawn' as const,reason:'Withdraw the historical assessment after source change'};
  const deps={repository:m.repo,fetchSnapshot:async()=>assert.fail('withdrawal must not fetch the publisher')};
  await assert.rejects(saveKiwoomReview({actorUserId:actor,requestId:randomUUID(),draft:{...withdrawal,expectedSourceHash:changed.sourceHash}},deps),e=>e instanceof KiwoomError&&e.code==='KIWOOM_SOURCE_CHANGED');
  await assert.rejects(saveKiwoomReview({actorUserId:actor,requestId:randomUUID(),draft:{...withdrawal,facts:{...d.facts,newTicker:'OTHER'}}},deps),e=>e instanceof KiwoomError&&e.code==='KIWOOM_REVISION_CONFLICT');
  assert.equal(m.writes(),1);
  const saved=await saveKiwoomReview({actorUserId:actor,requestId:randomUUID(),draft:withdrawal},deps);
  assert.equal(saved.review.revision,2);assert.equal(saved.review.snapshot.sourceHash,s.sourceHash);
  assert.deepEqual(saved.review.draft.facts,first.review.draft.facts);assert.equal(m.writes(),2);
});
test("product integration remains admin-only and has no ticker publisher, OCR, AI or cron wiring",()=>{
  const route=readFileSync('app/api/admin/data/kiwoom-verification/route.ts','utf8');
  assert.match(route,/resolveAdminApiAccess\(request, "system.read"\)/);assert.match(route,/resolveAdminApiAccess\(request, "data.run"\)/);
  assert.match(route,/assertSameOriginAuthRequest\(request\)/);assert.match(route,/actorUserId: access.access.userId/);
  assert.doesNotMatch(route,/actorUserId:\s*body/);
  for(const p of ['source.ts','review.ts','service.ts']) { const code=readFileSync(`lib/ticker-verification/kiwoom/${p}`,'utf8');
    assert.doesNotMatch(code,/from ["'][^"']*(?:sec-ticker-resolution|newsIngest|gemini|workflow)/i); }
  const migration=readFileSync('supabase/migrations/20261008121000_kiwoom_ticker_evidence_reviews.sql','utf8');
  assert.match(migration,/ticker_authority = 'none'/);assert.doesNotMatch(migration,/insert into public\.(?:sec_ticker|watchlist|alerts|sec_submissions)/);
});

test("15-second upstream deadline includes a stalled response body", { timeout: 22000 }, async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_request,response)=>{ response.writeHead(200,{"Content-Type":"application/json"});response.write('{"boardList":['); });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;let requests=0;
  const began=Date.now();
  try {
    await assert.rejects(fetchKiwoomNoticeList(1,async(_url,options)=>{requests++;return fetch(`http://127.0.0.1:${port}`,options);}),e=>e instanceof KiwoomError&&e.code==='KIWOOM_UNAVAILABLE');
    assert.equal(requests,1);assert.ok(Date.now()-began>=14000);assert.ok(Date.now()-began<19000);
  } finally { server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
