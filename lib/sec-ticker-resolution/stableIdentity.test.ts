import assert from "node:assert/strict";
import test from "node:test";
import { evaluateStableSecSecurityIdentity, type VerifiedSecCoverObservation } from "./canonical.ts";
import { readStableIdentityEvidence, readStoredStableIdentity } from "./stableIdentity.ts";

// Contract fixtures. The separately recorded PLTR E2E uses unchanged real SEC bodies.
const before: VerifiedSecCoverObservation = { resultId: "before", observationKey: "a", issuerCik: "0001321655",
  accessionNumber: "0001321655-24-000135", acceptedAt: "2024-08-05T22:19:46Z", sourceRawId: "raw-before",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1321655/before.htm", sourceDocument: "before.htm",
  sourceSha256: "a".repeat(64), contextRef: "cover", dimensions: [],
  securityTitleStatus: "observed", securityTitle: "Class A Common Stock, par value $0.001 per share",
  tradingSymbolStatus: "observed", tradingSymbol: "PLTR", exchangeStatus: "observed", exchange: "New York Stock Exchange" };
const after = { ...before, resultId: "after", observationKey: "b", accessionNumber: "0001321655-24-000209",
  acceptedAt: "2024-11-04T23:08:49Z", sourceRawId: "raw-after", sourceSha256: "b".repeat(64) };
const evaluate = (b: VerifiedSecCoverObservation = before, a: VerifiedSecCoverObservation = after) => evaluateStableSecSecurityIdentity([b], [a]);

test("unchanged exact security identity does not require ticker-change prose or manufacture a decision", () => {
  const result = evaluate();
  assert.ok(result.identity);
  assert.equal(result.identity.issuer_cik, before.issuerCik);
  assert.equal(result.identity.before_result_id, before.resultId);
  assert.equal(result.identity.after_result_id, after.resultId);
  assert.equal('decision' in result, false);
  assert.deepEqual(evaluate().identity, result.identity, "deterministic replay");
});
test("a real ticker/class/exchange transition cannot use the stable path", () => {
  for (const patch of [{ tradingSymbol: "NEW" }, { securityTitle: "Class B Common Stock" },
    { exchange: "Nasdaq Stock Market LLC" }, { issuerCik: "0000000001" }, { dimensions: [{ member: "Other" }] }]) {
    const r = evaluate(before, { ...after, ...patch });
    assert.equal(r.identity, null);
    assert.match(r.reason, /requires_change_evidence/);
  }
});
test("multiple and incomplete competing securities stay blocked, even with one good row", () => {
  for (const competing of [{ ...before, tradingSymbol: "PLTRW", securityTitle: "Warrants" },
    { ...before, securityTitle: "Class B Common Stock", tradingSymbol: null, tradingSymbolStatus: "source_missing" }]) {
    assert.equal(evaluateStableSecSecurityIdentity([before, competing], [after]).identity, null);
    assert.equal(evaluateStableSecSecurityIdentity([before], [after, competing]).identity, null);
  }
});
test("no incomplete source, duplicate filing, backwards period, or unsupported security", () => {
  for (const patch of [{ acceptedAt: null }, { acceptedAt: "bad-date" }, { acceptedAt: before.acceptedAt },
    { accessionNumber: before.accessionNumber }, { sourceRawId: null }, { sourceSha256: null },
    { exchangeStatus: "conflict" }, { tradingSymbolStatus: "source_missing", tradingSymbol: null }])
    assert.equal(evaluate(before, { ...after, ...patch }).identity, null);
  assert.equal(evaluate({ ...before, securityTitle: "Warrants" }, { ...after, securityTitle: "Warrants" }).identity, null);
});
test("reader failure is unresolved, never interpreted as absence or identity proof", async () => {
  const repository = { select: async () => ({ ok: false, status: 503, data: null }),
    rpc: async () => { throw Error("must not write"); } };
  assert.equal((await readStableIdentityEvidence({ beforeAccession: before.accessionNumber,
    afterAccession: after.accessionNumber, beforeSourceHash: before.sourceSha256!, afterSourceHash: after.sourceSha256! }, repository)).status, "unresolved");
  assert.equal((await readStoredStableIdentity(evaluate().identity!, repository)).status, "unresolved");
});
