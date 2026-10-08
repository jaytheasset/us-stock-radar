// In-process API/component checks: real route, auth gate and policy; synthetic session/store.
// This is not browser, login, or PostgREST E2E.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import ts from "typescript";
import { parseHumanStorageDraft, readHumanComparison, listHumanComparisons, humanStorageHash } from "./humanStorage.ts";

const require = createRequire(import.meta.url), root = process.cwd();
const actor = "12345678-1234-4234-8234-123456789012";
function fixture(storageOverrides = {}) {
  const state = { roles: ["operations"], signedIn: true, calls: [], error: null };
  const modules = new Map();
  class AuthError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  const operation = name => async (...args) => { state.calls.push({ name, args }); if (state.error) throw state.error; return { fixture: name }; };
  const overrides = {
    "lib/auth/sessionResolution.ts": { resolveAuthSession: async () => ({ user: state.signedIn ? { id: actor } : null, refreshedSession: null, shouldClearCookies: false }) },
    "lib/admin/server.ts": { getAdminAccessForUser: async () => ({ userId: actor, roles: state.roles }) },
    "lib/auth/supabaseAuth.ts": { AuthError },
    "lib/auth/authCookies.ts": { AUTH_ACCESS_COOKIE: "access", AUTH_REFRESH_COOKIE: "refresh", clearAuthSessionCookies() {}, setAuthSessionCookies() {} },
    "lib/env.ts": { getServerEnv() { throw Error("Environment access is forbidden in this test"); } },
    "lib/ticker-verification/kiwoom/humanStorage.ts": Object.fromEntries(["humanCandidateDisplay", "listHumanComparisons", "readHumanComparison", "previewHumanComparison", "saveHumanComparison"].map(n => [n, operation(n)])),
    "lib/ticker-verification/kiwoom/service.ts": Object.fromEntries(["getKiwoomReview", "listKiwoomReviews", "saveKiwoomReview"].map(n => [n, operation(n)])),
    ...storageOverrides,
  };
  function load(filename) {
    const relative = path.relative(root, filename).replaceAll("\\", "/");
    if (overrides[relative]) return overrides[relative];
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    const code = ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const localRequire = name => {
      if (name === "server-only") return {};
      if (name.endsWith(".module.css")) return new Proxy({}, { get: (_o, key) => String(key) });
      if (!name.startsWith(".") && !name.startsWith("@/")) return require(name);
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load([base, base + ".ts", base + ".tsx"].find(existsSync) ?? base);
    };
    runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports);
    return module.exports;
  }
  const route = load(path.join(root, "app/api/admin/data/kiwoom-verification/route.ts"));
  const { NextRequest } = require("next/server");
  const request = (query, body, extra = {}) => new NextRequest(`http://localhost:3199/api/admin/data/kiwoom-verification${query}`, body === undefined ? undefined : {
    method: "POST", headers: { origin: "http://localhost:3199", "content-type": "application/json", "x-request-id": actor, ...extra }, body,
  });
  return { state, route, request, load };
}
function privateResponse(r) { assert.match(r.headers.get("cache-control"), /private, no-store/); assert.match(r.headers.get("vary"), /Cookie/); }

test("human API uses existing authenticated read/write policy; support has no system.read or data.run", async () => {
  const { state, route, request } = fixture();
  state.signedIn = false;
  for (const response of [await route.GET(request("?mode=human-history")), await route.POST(request("?mode=human-save", "{}"))]) {
    assert.equal(response.status, 401); privateResponse(response);
  }
  state.signedIn = true; state.roles = [];
  assert.equal((await route.GET(request("?mode=human-history"))).status, 403);
  state.roles = ["support"];
  assert.equal((await route.GET(request("?mode=human-history"))).status, 403);
  for (const mode of ["human-preview", "human-save"]) assert.equal((await route.POST(request(`?mode=${mode}`, "{}"))).status, 403);
  assert.equal(state.calls.length, 0);
  state.roles = ["operations"];
  assert.equal((await route.GET(request("?mode=human-history"))).status, 200);
  assert.deepEqual(state.calls.map(c => c.name), ["listHumanComparisons"]);
});

test("human API rejects cross-origin, malformed and oversized requests before store calls", async () => {
  const { state, route, request } = fixture();
  for (const [body, headers, status] of [["{}", { origin: "https://other.invalid" }, 403], ["{", {}, 400], ["{}", { "content-type": "text/plain" }, 400], [JSON.stringify({ text: "x".repeat(65536) }), {}, 413]]) {
    const r = await route.POST(request("?mode=human-save", body, headers)); assert.equal(r.status, status); privateResponse(r);
  }
  assert.equal(state.calls.length, 0);
});

test("exact IDs, server actor, request ID and explicit failure contract reach new route modes", async () => {
  const { state, route, request } = fixture();
  for (const mode of ["candidate", "human", "human-history"]) {
    const r = await route.GET(request(`?mode=${mode}&decisionId=${actor}&id=${actor}`)); assert.equal(r.status, 200); privateResponse(r);
  }
  assert.equal(state.calls[0].args[0], actor); assert.equal(state.calls[1].args[0], actor);
  await route.POST(request("?mode=human-preview", JSON.stringify({ action: "append" })));
  await route.POST(request("?mode=human-save", JSON.stringify({ action: "withdraw", actorUserId: "untrusted" })));
  const write = state.calls.at(-1); assert.equal(write.name, "saveHumanComparison");
  assert.equal(write.args[0].actorUserId, actor); assert.equal(write.args[0].requestId, actor);
  assert.equal(state.calls.at(-2).args[0], actor);
  // The compiled route has its own Error class instance, so construct it through that same module.
  const source = fixture();
  const ErrorType = source.load(path.join(root, "lib/ticker-verification/kiwoom/source.ts")).KiwoomError;
  source.state.error = new ErrorType("KIWOOM_HUMAN_REVISION_CONFLICT", 409);
  const failed = await source.route.POST(source.request("?mode=human-save", "{}"));
  assert.equal(failed.status, 409); assert.equal((await failed.json()).error.code, "KIWOOM_HUMAN_REVISION_CONFLICT"); privateResponse(failed);
});

test("existing review save and unknown-mode behavior remain distinct", async () => {
  const { state, route, request } = fixture();
  assert.equal((await route.POST(request("", "{}"))).status, 200);
  assert.equal(state.calls[0].name, "saveKiwoomReview");
  assert.equal((await route.POST(request("?mode=unexpected", "{}"))).status, 400);
  assert.equal((await route.POST(request("", JSON.stringify({ text: "x".repeat(16384) })))).status, 413);
  assert.equal(state.calls.length, 1);
});

test("storage boundary rejects actor injection, broker-account input and invalid revision before repository access", () => {
  const draft = { action: "append", caseId: actor, expectedRevision: 0, previousId: null, decisionId: actor,
    expectedDecisionSha256: "a".repeat(64), expectedCandidateRevisionSha256: "b".repeat(64), source: {}, reviewId: actor,
    expectedReviewRevision: 1, expectedSnapshotSha256: "c".repeat(64), expectedImageSha256: "d".repeat(64),
    human: { status: "unconfirmed", reason: "Fixture boundary only", values: {}, eventStatus: "unknown", security: {}, proofs: {}, exchangeTransfer: null }, row: { dateBasis: "unknown" } };
  // Nested evidence is validated against real source in build(); this parser only gates the envelope.
  assert.deepEqual(parseHumanStorageDraft(draft), draft);
  for (const changed of [{ ...draft, actorUserId: actor }, { ...draft, expectedRevision: -1 }, { ...draft, expectedRevision: 1 },
    { ...draft, row: { dateBasis: "broker_account" } }, { ...draft, human: { ...draft.human, actor: actor } }]) assert.throws(() => parseHumanStorageDraft(changed));
  const copy = parseHumanStorageDraft(draft); copy.human.reason = "Mutated"; assert.notEqual(copy.human.reason, draft.human.reason);
  assert.equal(humanStorageHash({ b: 2, a: 1 }), humanStorageHash({ a: 1, b: 2 }));
});

test("reader distinguishes absent record from failure and malformed successful responses", async () => {
  for (const [data, ok, expected] of [[[], true, "not_found"], [null, false, "unavailable"], [{}, true, "unavailable"], [[null], true, "unavailable"]]) {
    const repository = { select: async () => ({ ok, data, status: ok ? 200 : 503 }), rpc: async () => assert.fail("read cannot write") };
    assert.equal((await readHumanComparison(actor, { repository })).status, expected);
    if (expected === "unavailable") await assert.rejects(listHumanComparisons({ repository }));
    else assert.deepEqual(await listHumanComparisons({ repository }), []);
  }
});

test("existing-page component renders separated blank assertions and disabled read-only actions", () => {
  const { load } = fixture();
  const { KiwoomHumanComparison } = load(path.join(root, "components/admin/KiwoomHumanComparison.tsx"));
  const React = require("react"), { renderToStaticMarkup } = require("react-dom/server");
  const html = renderToStaticMarkup(React.createElement(KiwoomHumanComparison, { canWrite: false }));
  for (const label of ["SEC automatic candidate", "Separate SEC human judgment", "Exact saved Kiwoom review", "tickerAuthority: none", "Read-only administrator access."]) assert.ok(html.includes(label));
  assert.match(html, /<fieldset disabled=""/);
  assert.match(html, /<button disabled="">Save human judgment and linked evidence/);
  assert.ok(!html.includes("PSKY"));
});

test("real storage preview/current contracts accept revision 3 independent date without RPC; stale reviews still fail", async () => {
  const { load } = fixture();
  const { evaluateSecTickerResolution, secVisibleText } = load(path.join(root, "lib/sec-ticker-resolution/canonical.ts"));
  const { candidateRevision } = load(path.join(root, "lib/ticker-verification/kiwoom/candidateLink.ts"));
  const { parseNoticeDetail, sha256, snapshotHash } = load(path.join(root, "lib/ticker-verification/kiwoom/source.ts"));
  const { reviewRequestHash } = load(path.join(root, "lib/ticker-verification/kiwoom/review.ts"));
  const beforeAcc = "0000001234-26-000001", acc = "0000001234-26-000002", cik = "0000001234";
  const rawContent = '<p>On October 6, 2026, Class B Common Stock changed from PSKY to SKYD and transferred from The Nasdaq Stock Market LLC to the New York Stock Exchange.</p>';
  const source = { resultId: actor, rawSourceId: actor, accessionNumber: acc, issuerCik: cik,
    url: `https://www.sec.gov/Archives/edgar/data/1234/${acc.replaceAll("-", "")}/source.htm`, documentName: "source.htm", sha256: sha256(rawContent), rawContent };
  const cover = (ticker, accessionNumber, exchange) => ({ resultId: actor, observationKey: accessionNumber, accessionNumber, issuerCik: cik,
    acceptedAt: accessionNumber === beforeAcc ? "2026-10-01T00:00:00Z" : "2026-10-07T00:00:00Z", sourceRawId: actor,
    sourceUrl: source.url, sourceDocument: source.documentName, sourceSha256: source.sha256, contextRef: accessionNumber, dimensions: [],
    securityTitleStatus: "observed", securityTitle: "Class B Common Stock", tradingSymbolStatus: "observed", tradingSymbol: ticker, exchangeStatus: "observed", exchange });
  const evaluation = evaluateSecTickerResolution({ issuerCik: cik, evidenceAccessionNumber: acc, beforeAccessionNumber: beforeAcc, afterAccessionNumber: acc,
    source, beforeObservations: [cover("PSKY", beforeAcc, "Nasdaq")], afterObservations: [cover("SKYD", acc, "NYSE")] });
  const c = candidateRevision(evaluation), values = { oldTicker: "PSKY", newTicker: "SKYD", effectiveDate: "2026-10-06" };
  assert.equal(c.resolutionState, "REVIEW"); assert.equal(c.values.effectiveDate, null);
  const detail = parseNoticeDetail({ noticeDetail: { seqid: 4611, scrnTp: "NWGCZ", ttl: "Synthetic control", makeTime: "2026.10.06", custPsdn: "Fixture",
    dtlCntn: '<p>Synthetic</p><img src="/bbs/VBbsNoticeImageView?apndnm=test.png">', attcFile: [] } }, "4611");
  const { imageUrls, ...meta } = detail, base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ2UAAAAASUVORK5CYII=";
  const snapshot = { ...meta, version: "kiwoom-notice-v1", authority: "supporting_evidence_only", capturedAt: "2026-10-08T00:00:00Z",
    images: [{ sourceUrl: imageUrls[0], mime: "image/png", base64, sha256: sha256(Buffer.from(base64, "base64")) }] };
  snapshot.sourceHash = snapshotHash(snapshot);
  const reviewDraft = { caseId: actor, expectedRevision: 2, noticeId: "4611", expectedSourceHash: snapshot.sourceHash, verdict: "unclear",
    facts: { market: "US", kind: "symbol_change", securityName: "Synthetic", ...values }, proof: { imageSha256: snapshot.images[0].sha256, locator: "Synthetic row 1", quote: null },
    usMarketRowReviewed: true, reason: "Independent test-only review" };
  const review = { id: actor, caseId: actor, revision: 3, actorUserId: actor, requestId: actor, requestHash: reviewRequestHash(reviewDraft),
    createdAt: snapshot.capturedAt, draft: reviewDraft, snapshot, tickerAuthority: "none" };
  const { rawContent: _raw, ...reference } = source, quote = secVisibleText(rawContent), proof = { start: 0, end: quote.length, quote };
  const draft = { action: "append", caseId: actor, expectedRevision: 0, previousId: null, decisionId: c.decisionId, expectedDecisionSha256: c.decisionSha256,
    expectedCandidateRevisionSha256: c.revisionSha256, source: reference, reviewId: actor, expectedReviewRevision: 3, expectedSnapshotSha256: snapshot.sourceHash,
    expectedImageSha256: snapshot.images[0].sha256, human: { status: "confirmed", reason: "Synthetic exact source proof", values, eventStatus: "occurred",
      security: { title: "Class B Common Stock", securityClass: "B" }, proofs: { oldTicker: proof, newTicker: proof, effectiveDate: proof, security: proof, eventStatus: proof }, exchangeTransfer: null },
    row: { method: "manual_transcription", candidateRevisionSha256: c.revisionSha256, reviewId: actor, caseId: actor, reviewRevision: 3, noticeId: "4611",
      sourceHash: snapshot.sourceHash, imageSha256: snapshot.images[0].sha256, locator: reviewDraft.proof.locator,
      cells: { country: "US", event: "symbol change", symbol: "PSKY", securityName: "Synthetic", details: "PSKY to SKYD", date: "October 6, 2026" },
      market: "US", event: "symbol_change", additionalChanges: [], values, dateBasis: "market_effective", securityType: null, securityClass: null,
      rowCorrespondence: "unconfirmed", correspondenceReason: "CIK and class are not reported by Kiwoom" } };
  const real = fixture({ "lib/ticker-verification/kiwoom/humanStorage.ts": undefined,
    "lib/sec-ticker-resolution/persistence.ts": { readSecTickerResolutionByDecisionId: async () => ({ status: "available", evaluation, decision: evaluation.decision, sourceObservations: { before: [], after: [] } }),
      readExactCover: async () => ({ ok: true, value: { payload: { identity: { accessionNumber: acc, issuerCik: cik }, source: reference } } }) },
    "lib/ticker-verification/kiwoom/service.ts": { getKiwoomReview: async () => structuredClone(review) } });
  const storage = real.load(path.join(root, "lib/ticker-verification/kiwoom/humanStorage.ts"));
  let stored = null, comparison = null, latest = { id: actor, revision: 3, verdict: "unclear" }, rpcCalls = 0;
  const deps = { repository: { select: async table => ({ ok: true, status: 200, data:
    table === "sec_structured_raw_sources" ? [{ id: actor, raw_content: rawContent }] : table === "kiwoom_ticker_evidence_reviews" ? [latest] :
    table === "kiwoom_sec_human_judgments" ? (stored ? [stored] : []) : table === "kiwoom_sec_human_comparisons" ? [comparison] : assert.fail(table) }),
    rpc: async () => { rpcCalls++; assert.fail("No save/RPC in preview or current read"); } }, fetchSnapshot: async () => structuredClone(snapshot) };
  const out = await storage.previewHumanComparison(actor, draft, deps);
  assert.equal(out.automatic.summary.effectiveDate, null); assert.equal(out.automatic.resolutionState, "REVIEW");
  assert.deepEqual(out.comparison.fields, { oldTicker: "match", newTicker: "match", effectiveDate: "match" });
  assert.equal(out.assessment.eligible, false); assert.ok(out.assessment.reasons.includes("row_correspondence_unconfirmed"));
  assert.equal(out.tickerAuthority, "none");
  // In-memory persisted envelope exercises the real validating reader, not a write.
  stored = { id: out.secHuman.id, case_id: actor, revision: 1, previous_id: null, actor_user_id: actor, audit_log_id: actor, request_id: actor,
    request_hash: storage.humanStorageHash(draft), draft, judgment: out.secHuman, judgment_sha256: out.humanJudgmentSha256,
    decision_id: c.decisionId, review_id: actor, ticker_authority: "none", created_at: out.secHuman.recordedAt };
  comparison = { judgment_id: stored.id, comparison: out, comparison_sha256: out.comparisonSha256 };
  assert.equal((await storage.readHumanComparison(stored.id, deps)).status, "current");
  stored = null; latest = { ...latest, revision: 4 };
  await assert.rejects(storage.previewHumanComparison(actor, draft, deps), { code: "KIWOOM_LINK_REVIEW_STALE" });
  assert.equal(rpcCalls, 0);
});
