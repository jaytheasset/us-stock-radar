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
function fixture() {
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
