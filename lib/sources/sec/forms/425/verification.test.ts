import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMainSubmissions } from "../../../../sec-structured-data/mainSubmissions.ts";
import { inspectSec425Identity, inspectSec425Currentness, sec425BlocksHash, type Sec425IdentityEvidence, type IdentityClaim } from "./verification.ts";

// Synthetic issuer/CIK/security observations, not live SEC verification or administrator approval.
const block = { block_id: "b1", text: "Example Buyer CIK 0000000001 (BUY) signed on June 1. This is a newly announced agreement." };
const proof = { block_id: "b1", source_field: "text" as const, quote: block.text };
const claim: IdentityClaim = { key: "party:0", name: "Example Buyer", ticker: "BUY", exchange: "NYSE" };
export function syntheticEvidence(currentClaim: IdentityClaim = claim): Sec425IdentityEvidence {
  const cik = "0000000001", sourceUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const payload = { cik, name: "Example Buyer", tickers: ["BUY"], exchanges: ["NYSE"], filings: { recent: { accessionNumber: [], form: [], filingDate: [] } } };
  const document = { cik, sourceKind: "submissions" as const, sourceUrl, sourceIdentity: sourceUrl, fetchedAt: "2026-06-02T00:00:00.000Z", payload, rawBody: JSON.stringify(payload), rawBodyKind: "injected_exact_body" as const };
  const contentHash = normalizeMainSubmissions([document], cik, document.fetchedAt).rawSources[0].contentHash;
  return { bindings: [{ claim: currentClaim, cik, blocksHash: sec425BlocksHash([block]), evidence: [{ ...proof, quote: "Example Buyer CIK 0000000001" }] }], submissions: [{ document, contentHash, confirmedAt: document.fetchedAt }] };
}
test("exact party CIK + existing Submissions normalization corroborates claim without proving historical symbol or transaction role", () => {
  const context = syntheticEvidence(), before = JSON.stringify(context);
  const result = inspectSec425Identity(claim, [block], context);
  assert.equal(result.status, "corroborated"); assert.equal(result.verifiedCik, "0000000001"); assert.equal(result.verifiedTicker, "BUY");
  assert.equal(result.mapping?.confirmedAt, "2026-06-02T00:00:00.000Z");
  assert.equal(result.historicalTickerVerified, false); assert.equal(result.transactionRoleVerified, false);
  assert.equal(JSON.stringify(context), before);
});
test("abbreviation, adviser ticker, copied filer ticker, changed snapshot, remote source, duplicate reference and missing official proof fail closed", () => {
  for (const ticker of ["OBDC II", "OWL", "FILER"]) {
    const wrong = { ...claim, ticker }, context = syntheticEvidence(wrong);
    const result = inspectSec425Identity(wrong, [block], context);
    assert.equal(result.status, "conflict"); assert.equal(result.verifiedTicker, null); assert.equal(wrong.ticker, ticker);
  }
  const badHash = syntheticEvidence(); badHash.submissions[0].contentHash = "0".repeat(64);
  assert.equal(inspectSec425Identity(claim, [block], badHash).status, "conflict");
  const badUrl = syntheticEvidence(); badUrl.submissions[0].document.sourceUrl = "https://example.test/a";
  assert.equal(inspectSec425Identity(claim, [block], badUrl).status, "conflict");
  const duplicate = syntheticEvidence(); duplicate.bindings.push(duplicate.bindings[0]);
  assert.equal(inspectSec425Identity(claim, [block], duplicate).status, "unresolved");
  assert.equal(inspectSec425Identity(claim, [block]).status, "unresolved");
  assert.equal(inspectSec425Identity(claim, [{ ...block, text: block.text + " changed" }], syntheticEvidence()).status, "conflict");
});
test("company CIK survives missing ticker; exact index role may supply CIK without inventing body CIK", () => {
  const noTicker = { ...claim, ticker: null }, context = syntheticEvidence(noTicker);
  const result = inspectSec425Identity(noTicker, [block], context);
  assert.equal(result.verifiedCik, "0000000001"); assert.equal(result.verifiedTicker, null);
  const noCikBlock = { ...block, text: "Example Buyer (BUY) announced a proposal." }, indexContext = syntheticEvidence();
  indexContext.bindings[0].blocksHash = sec425BlocksHash([noCikBlock]); indexContext.bindings[0].evidence = [];
  indexContext.bindings[0].indexRole = { indexSha256: "a".repeat(64), role: "filed_by" };
  indexContext.index = { accession: "0000000001-26-000001", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/0000000001-26-000001-index.html", indexSha256: "a".repeat(64), roles: [{ role: "filed_by", cik: "1", companyName: "Example Buyer", sourceText: "Example Buyer (Filed by) CIK 0000000001" }] };
  assert.equal(inspectSec425Identity(claim, [noCikBlock], indexContext).status, "corroborated");
  indexContext.index.roles[0].companyName = "Example Buyer II";
  assert.equal(inspectSec425Identity(claim, [noCikBlock], indexContext).verifiedCik, null);
  indexContext.index.roles[0].companyName = "Example Buyer";
  indexContext.bindings[0].indexRole.role = "subject_company";
  assert.equal(inspectSec425Identity(claim, [noCikBlock], indexContext).verifiedCik, null);
});
const action = (quote = proof) => ({ disclosure_context: "current_announcement" as const, action_date_literal: "June 1", action_evidence: [quote], context_evidence: [quote] });
test("current action can pass bindings but still requires semantic review; no comparison with filing date", () => {
  const result = inspectSec425Currentness({ decision: "confirmed", announcementType: "definitive_agreement_signed", evidence: [proof], actionContext: action() }, [block]);
  assert.equal(result.status, "supported_claim"); assert.equal(result.confirmedForConsumption, false);
  assert.equal(result.semanticAccuracy, "unverified");
});
test("prior context conflicts even on the same date; current different-date action is not demoted; mixed/truncated/duplicate quotes remain unresolved", () => {
  const historic = { ...block, text: "As previously announced, Example Buyer signed on June 1." }, hp = { ...proof, quote: historic.text };
  assert.equal(inspectSec425Currentness({ decision: "confirmed", announcementType: "definitive_agreement_signed", evidence: [hp] }, [historic]).status, "conflict");
  const truncated = { ...hp, quote: "Example Buyer signed on June 1." };
  assert.equal(inspectSec425Currentness({ decision: "confirmed", announcementType: "definitive_agreement_signed", evidence: [truncated], actionContext: action(truncated) }, [historic]).status, "unresolved");
  const mixed = { ...block, text: historic.text + " Today, a revised proposal was submitted on June 2." }, mp = { ...proof, quote: "Today, a revised proposal was submitted on June 2." };
  const result = inspectSec425Currentness({ decision: "confirmed", announcementType: "revised_acquisition_proposal", evidence: [hp], actionContext: { ...action(mp), action_date_literal: "June 2" } }, [mixed]);
  assert.equal(result.status, "supported_claim"); // No blanket historical-block classification.
  assert.equal(inspectSec425Currentness({ decision: "confirmed", announcementType: "definitive_agreement_signed", evidence: [proof], actionContext: action() }, [{ ...block, text: block.text + "\n\n" + block.text }]).status, "unresolved");
  assert.equal(inspectSec425Currentness({ decision: "confirmed", announcementType: "definitive_agreement_signed", evidence: [proof], actionContext: { ...action(), disclosure_context: "prior_background" } }, [block]).status, "conflict");
});
test("unavailable/malformed context and no-event keep their own meanings", () => {
  for (const actionContext of [undefined, {}]) assert.equal(inspectSec425Currentness({ decision: "confirmed", announcementType: "definitive_agreement_signed", evidence: null, actionContext: actionContext as never }, [block]).status, "unresolved");
  assert.equal(inspectSec425Currentness({ decision: "not_applicable", announcementType: null, evidence: [proof] }, [block]).status, "not_applicable");
});
