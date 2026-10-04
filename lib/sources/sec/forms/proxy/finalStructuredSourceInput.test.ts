import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildProposalSourceSections } from "./finalStructuredSourceInput.ts";
import type { ProxyProposalDiscoveryResult, ProxyProposalDiscoverySourcePackage } from "./proposalDiscovery.ts";

function candidate(title: string, evidence: string[], action_summary = title) { return { title, action_summary, evidence }; }
function discovery(proposals: ProxyProposalDiscoveryResult["proposals"]): ProxyProposalDiscoveryResult {
  return { version: "proxy_proposal_discovery_v1", meeting: { type: "special", date: null, evidence: [] }, proposals };
}
function source(text: string, id = "E1", blockSequence = 0) {
  return { id, text, blockSequence, blockType: "source_document" };
}
function build(stage1: ProxyProposalDiscoveryResult, sourcePackage: ProxyProposalDiscoverySourcePackage) {
  // Preserve legacy source-locator regression coverage independently of the v3 Call 2 path.
  return { evidence_blocks: [], proposals: buildProposalSourceSections(stage1, sourcePackage) };
}
function assertSlices(input: ReturnType<typeof build>, sourcePackage: ProxyProposalDiscoverySourcePackage) {
  assert.deepEqual(input.evidence_blocks, []);
  for (const p of input.proposals) {
    for (const f of p.local_section.fragments) {
      const original = sourcePackage.evidenceBlocks.find(b => b.id === f.block_id)!;
      assert.equal(f.evidence_id, f.block_id);
      assert.equal(p.local_section.text.slice(f.text_offset.start, f.text_offset.end), original.text.slice(f.block_offset.start, f.block_offset.end));
      assert.equal(f.original_source_offset.end - f.original_source_offset.start, f.text_offset.end - f.text_offset.start);
    }
    assert.deepEqual(p.local_section.evidence, [...new Set(p.local_section.fragments.map(f => f.evidence_id))]);
  }
}

test("anchors to evidence positions even when candidate order differs from source proposal numbers", () => {
  const stage1 = discovery([candidate("Ratification of Auditor", ["E2"]), candidate("Reverse Stock Split", ["E1"])]);
  const sourcePackage = { evidenceBlocks: [source("PROPOSAL NUMBER 7\nREVERSE STOCK SPLIT\nApprove a reverse stock split of common stock.", "E1"), source("PRO POSAL 9:\nRATIFICATION OF AUDITOR\nRatify the independent auditor.", "E2", 1)] };
  const before = JSON.stringify({ stage1, sourcePackage });
  const input = build(stage1, sourcePackage);
  assert.match(input.proposals[0].local_section.text, /PRO POSAL 9/);
  assert.doesNotMatch(input.proposals[0].local_section.text, /PROPOSAL NUMBER 7/);
  assert.match(input.proposals[1].local_section.text, /PROPOSAL NUMBER 7/);
  assert.doesNotMatch(input.proposals[1].local_section.text, /PRO POSAL 9/);
  assert.equal(JSON.stringify({ stage1, sourcePackage }), before);
  assertSlices(input, sourcePackage);
});

test("a shared full block cannot reintroduce the next proposal through common evidence", () => {
  const text = "PROPOSAL NUMBER 1\nAUTHORIZED SHARE INCREASE\nIncrease authorized shares from 100,000,000 to 200,000,000.\n\nPROPOSAL NUMBER 2\nEMPLOYEE STOCK PURCHASE PLAN\nApprove the employee stock purchase plan.\n\nPRO POSAL 3:\nADJOURNMENT PROPOSAL\nAdjourn to solicit votes for the authorized share increase.";
  const sourcePackage = { evidenceBlocks: [source(text)] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1"]), candidate("Employee Stock Purchase Plan", ["E1"]), candidate("Adjournment Proposal", ["E1"])]), sourcePackage);
  assert.doesNotMatch(input.proposals[0].local_section.text, /EMPLOYEE STOCK PURCHASE PLAN|PROPOSAL NUMBER 2|PRO POSAL 3/);
  assert.doesNotMatch(input.proposals[1].local_section.text, /PROPOSAL NUMBER 1|PRO POSAL 3/);
  assert.match(input.proposals[2].local_section.text, /Adjourn to solicit votes/);
  assertSlices(input, sourcePackage);
});

test("follows a selected source reference to a wrapped body title without confusing an equity-plan increase", () => {
  const capitalTitle = "Approval of an amendment to our certificate of incorporation to increase the total number of authorized shares of common stock";
  const planTitle = "Approval of an amendment to our equity incentive plan to increase the total number of authorized shares of common stock under the plan";
  const sourcePackage = { evidenceBlocks: [
    source("Approve an amendment to our certificate of incorporation to increase the total number of authorized shares of common stock (Proposal 17).", "E1"),
    source("PROPOSAL 17\n\nAPPROVAL OF AN AMENDMENT TO OUR CERTIFICATE\nOF INCORPORATION TO INCREASE THE TOTAL NUMBER OF AUTHORIZED SHARES OF COMMON STOCK (Item 17 on the Proxy Card)\n\n" + "The certificate amendment increases the authorized common shares. ".repeat(40), "E2", 1),
    source("PROPOSAL 19\n\nAPPROVAL OF AN AMENDMENT TO OUR EQUITY\nINCENTIVE PLAN TO INCREASE THE TOTAL NUMBER OF AUTHORIZED SHARES OF COMMON STOCK UNDER THE PLAN (Item 19 on the Proxy Card)\n\n" + "The equity incentive plan makes shares available for grants. ".repeat(40), "E3", 2),
  ] };
  const input = build(discovery([candidate(capitalTitle, ["E1"]), candidate(planTitle, ["E3"])]), sourcePackage);
  assert.match(input.proposals[0].local_section.text, /PROPOSAL 17/);
  assert.match(input.proposals[0].local_section.text, /certificate amendment increases/);
  assert.doesNotMatch(input.proposals[0].local_section.text, /PROPOSAL 19|shares available for grants/);
  assert.match(input.proposals[1].local_section.text, /PROPOSAL 19/);
  assert.doesNotMatch(input.proposals[1].local_section.text, /PROPOSAL 17/);
  assertSlices(input, sourcePackage);
});

test("even an undiscovered next proposal remains a hard boundary", () => {
  const sourcePackage = { evidenceBlocks: [source("PROPOSAL 1\nREVERSE STOCK SPLIT\nApprove the reverse stock split.\n\nPROPOSAL 2\nADJOURNMENT\nAdjourn to solicit votes for the reverse stock split.")] };
  const input = build(discovery([candidate("Reverse Stock Split", ["E1"])]), sourcePackage);
  assert.doesNotMatch(input.proposals[0].local_section.text, /PROPOSAL 2|Adjourn/);
});

test("retains explicitly linked appendix and table, not unrelated following attachment or proxy card", () => {
  const sourcePackage = { evidenceBlocks: [source("PROPOSAL 1\nAUTHORIZED SHARE INCREASE\nIncrease authorized shares. See Appendix A.\n\nBefore | After\n100,000,000 | 200,000,000\n\nPROPOSAL 2\nAUDITOR RATIFICATION\nRatify the auditor.\n\nAPPENDIX A\nFORM OF CERTIFICATE OF AMENDMENT\nThe authorized shares shall be 200,000,000.\n\nAPPENDIX B\nEMPLOYEE PLAN\nUnrelated employee plan.\n\nSCAN TO VIEW MATERIALS & VOTE\nProxy card instructions.")] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1"]), candidate("Auditor Ratification", ["E1"])]), sourcePackage);
  const p = input.proposals[0].local_section;
  assert.match(p.text, /Before \| After/);
  assert.match(p.text, /APPENDIX A/);
  assert.doesNotMatch(p.text, /APPENDIX B|AUDITOR RATIFICATION|Proxy card instructions/);
  assertSlices(input, sourcePackage);
});

test("Appendix A does not also select an unrelated Annex A inside another plan", () => {
  const sourcePackage = { evidenceBlocks: [source("PROPOSAL 1\nAUTHORIZED SHARE INCREASE\nIncrease authorized shares. See Appendix A.\n\nAPPENDIX A\nCERTIFICATE OF AMENDMENT\nIncrease authorized shares to 200,000,000.\n\nAPPENDIX C\nEMPLOYEE PLAN\nEmployee plan.\n\nANNEX A\nGERMAN PLAN TERMS\nGerman employee tax withholding rules.")] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1"])]), sourcePackage);
  assert.doesNotMatch(input.proposals[0].local_section.text, /GERMAN PLAN TERMS|German employee|APPENDIX C/);
});

test("keeps both selected contradictory list passages without importing other ballot rows or reverse-side card instructions", () => {
  const sourcePackage = { evidenceBlocks: [source('The board recommends “FOR” the independent auditor (Proposal 2), “FOR” a reverse stock split ranging from 1-for-10 to 1-for-100 (Proposal 5), and “FOR” the employee incentive plan (Proposal 6).\n\nPROPOSAL 5\nREVERSE STOCK SPLIT\nApprove a reverse stock split ranging from 1-for-10 to 1-for-50.\n\nREVERSE SIDE OF PROXY CARD\n\nPROPOSAL 6\nEMPLOYEE INCENTIVE PLAN\nApprove the employee incentive plan.')] };
  const input = build(discovery([candidate("Reverse Stock Split", ["E1"]), candidate("Independent Auditor", ["E1"]), candidate("Employee Incentive Plan", ["E1"])]), sourcePackage);
  assert.match(input.proposals[0].local_section.text, /1-for-100/);
  assert.match(input.proposals[0].local_section.text, /1-for-50/);
  assert.doesNotMatch(input.proposals[0].local_section.text, /independent auditor|employee incentive plan|REVERSE SIDE/i);
  assertSlices(input, sourcePackage);
});

test("shared appendix retains selected candidate clauses and legal context but not an evidence-anchored rival amendment", () => {
  const sourcePackage = { evidenceBlocks: [source("PROPOSAL 4\nAUTHORIZED SHARE INCREASE\nIncrease authorized shares. See Appendix A.\n\nPROPOSAL 7\nLIMIT LIABILITY OF OFFICERS\nLimit the liability of officers.\n\nAPPENDIX A\nCERTIFICATE OF AMENDMENT\n\n1. This certificate was adopted in accordance with law.\n\n2. The certificate is hereby amended by replacing the following paragraph:\n\nAuthorized share increase: 200,000,000 authorized shares.\n\n3. The certificate is hereby amended by replacing the following paragraph:\n\nLimited liability of officers: indemnification for officers.\n\n4. Except as amended, the certificate remains effective.")] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1"]), candidate("Limit Liability of Officers", ["E1"])]), sourcePackage);
  assert.match(input.proposals[0].local_section.text, /200,000,000/);
  assert.match(input.proposals[0].local_section.text, /Except as amended/);
  assert.doesNotMatch(input.proposals[0].local_section.text, /indemnification for officers|3\. The certificate/);
  assertSlices(input, sourcePackage);
});

test("selected proxy-card context cannot return operational authorizations that merely share authorized-share words", () => {
  const sourcePackage = { evidenceBlocks: [source("PROPOSAL 1\nAUTHORIZED SHARE INCREASE\nApprove the authorized share increase.\n\nMark, sign and date your Proxy Card\n\nAttorneys of the undersigned are authorized to vote all the shares of capital stock.\n\n1. Approve the authorized share increase.")] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1"])]), sourcePackage);
  assert.doesNotMatch(input.proposals[0].local_section.text, /Attorneys|Mark, sign/);
  assert.match(input.proposals[0].local_section.text, /1\. Approve/);
  assertSlices(input, sourcePackage);
});

test("whitespace-normalized overlapping excerpts are deduped without paraphrasing or discarding the original slice", () => {
  const sourcePackage = { evidenceBlocks: [
    { ...source("Company introduction. An important proposal is to increase our authorized share count. Today, authorized shares are reserved for warrants. These warrants will only", "E1"), blockType: "proxy_source_block" },
    { ...source("An important proposal is to increase our authorized share count.\n\nToday,\nauthorized shares are reserved for warrants. These warrants will only be exercised if the stock price increases.", "E2", 1), source: { startChar: 500, endChar: 500 + "An important proposal is to increase our authorized share count.\n\nToday,\nauthorized shares are reserved for warrants. These warrants will only be exercised if the stock price increases.".length } },
  ] };
  const input = build(discovery([candidate("Increase authorized shares", ["E1", "E2"])]), sourcePackage);
  assert.equal(input.proposals[0].local_section.text.match(/important proposal/g)?.length, 1);
  assert.equal(input.proposals[0].local_section.text.match(/shares are reserved/g)?.length, 1);
  assert.doesNotMatch(input.proposals[0].local_section.text, /Company introduction/);
  assertSlices(input, sourcePackage);
});

test("preserves original block slices and recorded document offsets without inventing absent coordinates", () => {
  const text = "PROPOSAL 4\nREVERSE STOCK SPLIT\nApprove a reverse stock split.";
  const sourcePackage = { evidenceBlocks: [{ ...source(text), source: { documentIndex: 0, origin: "filing_text", startChar: 350, endChar: 350 + text.length } }] };
  const located = build(discovery([candidate("Reverse Stock Split", ["E1"])]), sourcePackage);
  assertSlices(located, sourcePackage);
  for (const f of located.proposals[0].local_section.fragments) {
    assert.equal(f.original_source_offset.coordinate, "document_text");
    assert.equal(f.original_source_offset.start, 350 + f.block_offset.start);
  }
  const unlocated = build(discovery([candidate("Reverse Stock Split", ["E1"])]), { evidenceBlocks: [source(text)] });
  assert.equal(unlocated.proposals[0].local_section.fragments[0].original_source_offset.coordinate, "block_text");
});

test("recorded physical offsets order adjacent source blocks even if their input sequence is shuffled", () => {
  const heading = "PROPOSAL 8\nAUTHORIZED SHARE INCREASE\nIncrease authorized shares.";
  const continuation = "Authorized shares after the amendment: 200,000,000.";
  const next = "PROPOSAL 9\nINDEPENDENT AUDITOR\nRatify the auditor.";
  const located = (text: string, id: string, sequence: number, start: number) => ({ ...source(text, id, sequence), source: { startChar: start, endChar: start + text.length } });
  const sourcePackage = { evidenceBlocks: [
    located(continuation, "E2", 0, 100 + heading.length + 2),
    located(next, "E3", 1, 100 + heading.length + 2 + continuation.length + 2),
    located(heading, "E1", 2, 100),
  ] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1"])]), sourcePackage);
  assert.match(input.proposals[0].local_section.text, /200,000,000/);
  assert.doesNotMatch(input.proposals[0].local_section.text, /PROPOSAL 9|Ratify/);
  assert.deepEqual(input.proposals[0].local_section.fragments.map(f => f.block_id), ["E1", "E2"]);
  assertSlices(input, sourcePackage);
});

test("recovers legacy document coordinates only when reconstruction matches the recorded source hash", () => {
  const text = "PROPOSAL 1\nREVERSE STOCK SPLIT\nApprove a reverse stock split.";
  const sourcePackage = { documents: [{ documentId: "primary", normalizedTextSha256: createHash("sha256").update(text).digest("hex") }], evidenceBlocks: [{ ...source(text), documentId: "primary" }] };
  const input = build(discovery([candidate("Reverse Stock Split", ["E1"])]), sourcePackage);
  assert.equal(input.proposals[0].local_section.fragments[0].original_source_offset.coordinate, "document_text");
  sourcePackage.documents[0].normalizedTextSha256 = "not-the-original-hash";
  const unproved = build(discovery([candidate("Reverse Stock Split", ["E1"])]), sourcePackage);
  assert.equal(unproved.proposals[0].local_section.fragments[0].original_source_offset.coordinate, "block_text");
});

test("dedupes overlapping source ranges but never merges conflicting bracketed values", () => {
  const main = "PROPOSAL 1\nAUTHORIZED SHARE INCREASE\nIncrease authorized shares to 200,000,000.";
  const second = "Increase authorized shares to [200,000,000].";
  const sourcePackage = { evidenceBlocks: [
    { ...source(main), source: { documentIndex: 0, origin: "filing_text", startChar: 0, endChar: main.length } },
    { ...source(main, "E2", 1), source: { documentIndex: 0, origin: "filing_text", startChar: 0, endChar: main.length } },
    source(second, "E3", 2),
  ] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1", "E2", "E3"])]), sourcePackage);
  const text = input.proposals[0].local_section.text;
  assert.equal(text.match(/PROPOSAL 1/g)?.length, 1);
  assert.match(text, /\[200,000,000\]/);
  assert.match(text, /to 200,000,000/);
  assertSlices(input, sourcePackage);
});

test("preserves separately selected source history and both conflicting source passages", () => {
  const sourcePackage = { evidenceBlocks: [source("The reverse stock split was completed on April 10, 2026.\n\nThe authorized share increase will require votes cast approval.", "E1"), source("PROPOSAL 5\nAUTHORIZED SHARE INCREASE\nIncrease authorized shares, subject to outstanding voting power approval.", "E2", 1)] };
  const input = build(discovery([candidate("Authorized Share Increase", ["E1", "E2"])]), sourcePackage);
  assert.match(input.proposals[0].local_section.text, /votes cast approval/);
  assert.match(input.proposals[0].local_section.text, /outstanding voting power approval/);
  // History is only included if it is actually related to the selected candidate; not every capital history is imported.
  assert.doesNotMatch(input.proposals[0].local_section.text, /reverse stock split was completed/);
});

test("a procedural candidate's summary cannot steal separately selected reverse-split history", () => {
  const sourcePackage = { evidenceBlocks: [source("We effected a reverse stock split of common stock and exchangeable shares on April 10, 2026.\n\nPROPOSAL 8\nREVERSE STOCK SPLIT\nApprove a new reverse stock split.\n\nPROPOSAL 9\nADJOURNMENT OF MEETING\nAdjourn the meeting to solicit votes for the reverse stock split.")] };
  const input = build(discovery([
    candidate("Reverse Stock Split", ["E1"], "Approve a current reverse stock split of issued and outstanding common stock at a ratio ranging from one for ten to one for one hundred."),
    candidate("Adjournment of Meeting", ["E1"], "Adjourn the meeting for additional reverse stock split votes."),
  ]), sourcePackage);
  assert.match(input.proposals[0].local_section.text, /exchangeable shares on April 10, 2026/);
  assert.doesNotMatch(input.proposals[0].local_section.text, /PROPOSAL 9/);
  assert.doesNotMatch(input.proposals[1].local_section.text, /We effected a reverse stock split/);
  assertSlices(input, sourcePackage);
});

test("unknown or unrelated evidence fails closed without returning the full source document", () => {
  const stage1 = discovery([candidate("Reverse Stock Split", ["E99"])]);
  assert.throws(() => build(stage1, { evidenceBlocks: [source("No ballot matter is present.")] }), /unknown Stage 1 evidence E99/);
  stage1.proposals[0].evidence = ["E1"];
  assert.throws(() => build(stage1, { evidenceBlocks: [source("No ballot matter is present.")] }), /no source-backed evidence anchor.*no full-document fallback/);
});
