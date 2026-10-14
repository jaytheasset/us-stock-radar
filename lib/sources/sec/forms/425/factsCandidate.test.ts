import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectSec425FactCandidate, createSec425FactCandidate, type Sec425FactOutput, type Sec425FactSource } from "./factsCandidate.ts";

const blocks = [{ block_id: "synthetic", text: "Example Buyer (BUY) revised its non-binding tender offer for Example Target (TGT). No financing condition applies.", heading: null }];
const evidence = [{ block_id: "synthetic", source_field: "text" as const, quote: blocks[0].text }];
const sample = (): Sec425FactOutput => ({ decision: "confirmed", reason: "Synthetic revised offer, not an actual filing.", evidence,
  announcement: { announcement_type: "revised_acquisition_proposal", transaction_types: ["acquisition", "tender_offer"],
    parties: [{ name: "Example Buyer", role: "acquirer", ticker: "BUY", participation: null, evidence }, { name: "Example Target", role: "target", ticker: "TGT", participation: null, evidence }],
    statement: "Example Buyer announced a revised non-binding tender offer.", key_terms: [{ value: "Non-binding; no financing condition.", evidence }],
  } });
const bytes = Buffer.from(blocks[0].text);
const source: Sec425FactSource = { accession: "0000000001-26-000001", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000126000001/source.htm", sourceSha256: createHash("sha256").update(bytes).digest("hex"), representation: "sec_public_text_excerpt" };

test("transaction tags are non-exclusive and separate from announcement type; even valid shape is not ready", () => {
  const output = sample(), before = JSON.stringify(output), candidate = createSec425FactCandidate(source, bytes, output, blocks);
  assert.equal(candidate.assessment.mechanicalPass, true); assert.equal(candidate.assessment.available, false); assert.equal(candidate.assessment.alertEligible, false);
  assert.equal(candidate.assessment.semanticStatus, "unverified"); assert.equal(JSON.stringify(output), before);
  (candidate.rawOutput as Sec425FactOutput).announcement!.parties[0].ticker = "MUTATED";
  assert.equal(output.announcement!.parties[0].ticker, "BUY");
});
test("unknown role/ticker stay null and may not be filled from a different party or filing issuer", () => {
  const output = sample(); output.announcement!.parties[1] = { name: "Example Target", role: null, ticker: null, participation: null, evidence };
  const candidate = createSec425FactCandidate(source, bytes, output, blocks);
  assert.equal(candidate.assessment.mechanicalPass, true); assert.equal((candidate.rawOutput as Sec425FactOutput).announcement!.parties[1].ticker, null);
  output.announcement!.parties[1].ticker = "ISSUER";
  assert.ok(inspectSec425FactCandidate(output, blocks).errors.some(x => x.includes("ticker_literal_not_in_own_evidence")));
});
test("different announcement enum, missing evidence, incorrect block/field and too-long quote report failures without repair", () => {
  const a = sample(); (a.announcement!.announcement_type as string) = "shareholder_vote_result"; assert.equal(inspectSec425FactCandidate(a, blocks).schemaPass, false);
  const b = sample(); b.announcement!.key_terms[0].evidence = []; assert.equal(inspectSec425FactCandidate(b, blocks).fieldBindingPass, false);
  const c = structuredClone(sample()); c.evidence[0].block_id = "missing"; assert.equal(inspectSec425FactCandidate(c, blocks).citationPass, false);
  const d = structuredClone(sample()); d.evidence[0].source_field = "heading"; assert.equal(inspectSec425FactCandidate(d, blocks).citationPass, false);
  const long = structuredClone(sample()); long.evidence = [{ ...evidence[0], quote: "a".repeat(241) }]; const before = JSON.stringify(long);
  assert.equal(inspectSec425FactCandidate(long, [{ ...blocks[0], text: "a".repeat(241) }]).mechanicalPass, false); assert.equal(JSON.stringify(long), before);
});
test("not_applicable and uncertain do not create announcement or alert eligibility", () => {
  for (const decision of ["not_applicable", "uncertain"] as const) {
    const output = { decision, reason: "Synthetic prior-only or ambiguous source", announcement: null, evidence };
    const assessment = inspectSec425FactCandidate(output, blocks);
    assert.equal(assessment.mechanicalPass, true); assert.equal(assessment.matchEligible, false);
  }
});
test("source URL/accession/hash mismatch cannot produce a candidate", () => {
  assert.throws(() => createSec425FactCandidate({ ...source, sourceSha256: "0".repeat(64) }, bytes, sample(), blocks), /source_identity/);
  assert.throws(() => createSec425FactCandidate({ ...source, accession: "0000000002-26-000001" }, bytes, sample(), blocks), /source_identity/);
});
test("malformed inputs report schema failure without throwing or losing original response", () => {
  for (const value of [null, [], 2, "x", { evidence: [null, 3, "x"] }, { announcement: { parties: [{ ticker: "BUY", evidence: [null] }] } }]) {
    const before = JSON.stringify(value); const result = inspectSec425FactCandidate(value, blocks);
    assert.equal(result.schemaPass, false); assert.equal(result.mechanicalPass, false); assert.equal(JSON.stringify(value), before);
  }
});
test("exact quote does not validate semantic type or future ticker attribution", () => {
  const output = sample(); output.announcement!.announcement_type = "definitive_agreement_signed";
  const result = inspectSec425FactCandidate(output, blocks);
  assert.equal(result.mechanicalPass, true); assert.equal(result.semanticStatus, "unverified"); assert.equal(result.available, false);
});
