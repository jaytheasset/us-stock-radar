import assert from "node:assert/strict";
import test from "node:test";
import {
  projectSecFilingCurrentState,
  resolveSecAmendmentLineage,
  type SecAmendmentLineageResolution,
  type SecFilingIdentity,
  type SecSemanticFactVersion,
} from "./secAmendmentLineage.ts";

const original = identity("0001193125-25-151306", "8-K", "2025-06-27");
const amendment = identity("0001193125-25-154092", "8-K/A", "2025-07-01");
const replaceExcerpt = `This Amendment No. 1 to the Current Report on Form 8-K filed on June 27, 2025, accession no. ${original.accessionNumber}, furnishes a corrected version of Exhibit 10.1 that supersedes and replaces in its entirety the original exhibit.`;

test("exact official identity, target, operation, and literal source-backed fact scope link", () => {
  const result = resolve(replaceExcerpt, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")]);
  assert.equal(result.status, "linked");
  assert.equal(result.status === "linked" && result.operation, "REPLACE");
  assert.deepEqual(result.status === "linked" && result.affectedFactKeys, ["monitor.corporate_action"]);
});

test("alpha-polluted CIK, wrong submissions CIK, and wrong archive identity fail closed", () => {
  const invalid = [
    resolve(replaceExcerpt, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")], {
      amendment: { ...amendment, issuerCik: "bad1764974" },
    }),
    resolve(replaceExcerpt, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")], {
      submissionsUrl: "https://data.sec.gov/submissions/CIK0000000001.json",
    }),
    resolve(replaceExcerpt, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")], {
      amendment: { ...amendment, primaryDocumentUrl: amendment.primaryDocumentUrl.replace("000119312525154092", "000119312525154099") },
    }),
  ];
  invalid.forEach((result) => assert.equal(result.status, "unavailable_review"));
});

test("negated cancellation, partial non-reliance, and contradictory operations never cancel the root", () => {
  for (const phrase of [
    "does not cancel the prior report",
    "will not cancel the prior report",
    "shall not rescind the original filing",
    "only the prior table should not be relied upon; the original filing remains effective",
    "If the board cancels the prior report, a subsequent notice will be filed",
    "The registrant may cancel the prior report",
    "The new agreement cancels all prior agreements",
    "The original report's revenue table should not be relied upon",
  ]) {
    const result = resolve(`This Amendment concerns the Form 8-K filed on June 27, 2025, accession no. ${original.accessionNumber}. ${phrase}.`, []);
    assert.equal(result.status, "unavailable_review", phrase);
  }
  const conflict = resolve(
    `${replaceExcerpt} The registrant withdraws and cancels the prior Form 8-K in its entirety.`,
    [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")],
  );
  assert.equal(conflict.status, "unavailable_review");
  assert.equal(conflict.status === "unavailable_review" && conflict.reason, "operation_conflicting");
});

test("multiple targets, ambiguous candidates, and date-nearest guesses fail closed", () => {
  assert.equal(resolve(`${replaceExcerpt} Accession no. 0001193125-25-999999.`, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")]).status, "unavailable_review");
  assert.equal(resolve(replaceExcerpt, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")], {
    candidates: [original, { ...original, rawItemId: "10000000-0000-4000-8000-000000000099" }],
  }).status, "unavailable_review");
  assert.equal(resolve("This amendment provides a corrected version of an earlier filing.", [
    scope("monitor.corporate_action", "corrected version"),
  ]).status, "unavailable_review");
  const twoDates = resolve(
    `This amendment concerns the Form 8-K filed on June 27, 2025 and the Form 8-K filed on June 26, 2025. This amendment hereby cancels the original report in its entirety.`,
    [],
    { candidates: [original, { ...original, rawItemId: "10000000-0000-4000-8000-000000000098", accessionNumber: "0001193125-25-151305", filedDate: "2025-06-26", primaryDocumentUrl: original.primaryDocumentUrl.replace("151306", "151305"), indexUrl: original.indexUrl.replace(/151306/g, "151305") }] },
  );
  assert.equal(twoDates.status, "unavailable_review");
  assert.equal(twoDates.status === "unavailable_review" && twoDates.reason, "explicit_target_conflicting");
});

test("fact scope cannot be caller-invented or sourced from the prior document", () => {
  const invalidScopes = [
    [{ semanticFactKey: "monitor.corporate_action", evidence: "invented affected field", sourceUrl: amendment.primaryDocumentUrl }],
    [{ semanticFactKey: "monitor.corporate_action", evidence: "corrected version of Exhibit 10.1", sourceUrl: original.primaryDocumentUrl }],
  ];
  invalidScopes.forEach((affectedFacts) => {
    const result = resolve(replaceExcerpt, affectedFacts);
    assert.equal(result.status, "unavailable_review");
    assert.equal(result.status === "unavailable_review" && result.reason, "invalid_fact_scope_evidence");
  });
});

test("REPLACE changes the version while keeping one stable fact/Alert identity", () => {
  const replacement = resolve(replaceExcerpt, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")]);
  const before = projectSecFilingCurrentState({
    root: original, observations: [], facts: [fact(original, "monitor.corporate_action", 1)],
  });
  const after = projectSecFilingCurrentState({
    root: original,
    observations: [replacement],
    facts: [fact(original, "monitor.corporate_action", 1), fact(amendment, "monitor.corporate_action", 2)],
  });
  assert.equal(before.status, "available");
  assert.equal(after.status, "available");
  assert.equal(after.status === "available" && after.facts[0].factPayload.version, 2);
  assert.equal(
    after.status === "available" && after.facts[0].alertIdentity,
    before.status === "available" && before.facts[0].alertIdentity,
  );
});

test("SUPPLEMENT adds only a new fact; NOOP changes zero; CANCEL clears and blocks revival", () => {
  const supplementAmendment = identity("0001193125-25-154093", "8-K/A", "2025-07-02");
  const supplementExcerpt = `This Amendment amends and supplements the Form 8-K filed on June 27, 2025, accession no. ${original.accessionNumber}, solely to provide a new listing deadline. All other information remains unchanged and no other changes were made.`;
  const supplement = resolveSecAmendmentLineage({
    amendment: supplementAmendment,
    candidates: [original],
    evidence: evidence(supplementAmendment, supplementExcerpt),
    affectedFacts: [{ semanticFactKey: "monitor.listing_risk.deadline", evidence: "provide a new listing deadline", sourceUrl: supplementAmendment.primaryDocumentUrl }],
  });
  assert.equal(supplement.status === "linked" && supplement.operation, "SUPPLEMENT");
  const supplemented = projectSecFilingCurrentState({
    root: original,
    observations: [supplement],
    facts: [fact(original, "monitor.corporate_action", 1), fact(supplementAmendment, "monitor.listing_risk.deadline", 1)],
  });
  assert.equal(supplemented.status, "available");
  assert.equal(supplemented.status === "available" && supplemented.facts.length, 2);

  const noopAmendment = identity("0001193125-25-154094", "8-K/A", "2025-07-03");
  const noopExcerpt = `This Amendment to the Form 8-K filed on June 27, 2025, accession no. ${original.accessionNumber}, is filed solely to correct a typographical caption. It does not change any substantive information or disclosure.`;
  const noop = resolveSecAmendmentLineage({ amendment: noopAmendment, candidates: [original], evidence: evidence(noopAmendment, noopExcerpt), affectedFacts: [] });
  assert.equal(noop.status === "linked" && noop.operation, "NOOP");
  const nooped = projectSecFilingCurrentState({ root: original, observations: [noop], facts: [fact(original, "monitor.corporate_action", 1)] });
  assert.equal(nooped.status === "available" && nooped.facts.length, 1);

  const cancel = linked(identity("0001193125-25-154095", "8-K/A", "2025-07-04"), original, "CANCEL", []);
  const cancelled = projectSecFilingCurrentState({ root: original, observations: [cancel], facts: [fact(original, "monitor.corporate_action", 1)] });
  assert.equal(cancelled.status === "available" && cancelled.cancelled, true);
  assert.equal(cancelled.status === "available" && cancelled.facts.length, 0);
  const revive = linked(identity("0001193125-25-154096", "8-K/A", "2025-07-05"), cancel.amendment, "REPLACE", ["monitor.corporate_action"]);
  const blocked = projectSecFilingCurrentState({
    root: original,
    observations: [cancel, revive],
    facts: [fact(original, "monitor.corporate_action", 1), fact(revive.amendment, "monitor.corporate_action", 2)],
  });
  assert.equal(blocked.status, "unavailable_review");
  assert.equal(blocked.status === "unavailable_review" && blocked.reason, "cancelled_state_cannot_be_revived");
});

test("forks, source-accession mismatch, and scope mismatch fail closed", () => {
  const first = identity("0001193125-25-154097", "8-K/A", "2025-07-06");
  const second = identity("0001193125-25-154098", "8-K/A", "2025-07-07");
  const forked = projectSecFilingCurrentState({
    root: original,
    observations: [linked(first, original, "REPLACE", ["monitor.corporate_action"]), linked(second, original, "REPLACE", ["monitor.corporate_action"])],
    facts: [fact(original, "monitor.corporate_action", 1), fact(first, "monitor.corporate_action", 2), fact(second, "monitor.corporate_action", 3)],
  });
  assert.equal(forked.status, "unavailable_review");
  const bad = { ...fact(amendment, "monitor.corporate_action", 2), sourceRef: { url: original.primaryDocumentUrl, document: "primary.htm", evidence: "wrong accession source" } };
  assert.equal(projectSecFilingCurrentState({
    root: original,
    observations: [resolve(replaceExcerpt, [scope("monitor.corporate_action", "corrected version of Exhibit 10.1")])],
    facts: [fact(original, "monitor.corporate_action", 1), bad],
  }).status, "unavailable_review");
});

function resolve(excerpt: string, affectedFacts: Array<{ semanticFactKey: string; evidence: string; sourceUrl: string }>, overrides: Record<string, unknown> = {}) {
  const changedAmendment = (overrides.amendment as SecFilingIdentity) || amendment;
  return resolveSecAmendmentLineage({
    amendment: changedAmendment,
    candidates: (overrides.candidates as SecFilingIdentity[]) || [original],
    evidence: {
      ...evidence(changedAmendment, excerpt),
      ...(overrides.submissionsUrl ? { submissionsUrl: String(overrides.submissionsUrl) } : {}),
    },
    affectedFacts,
  });
}
function scope(semanticFactKey: string, sourceEvidence: string) {
  return { semanticFactKey, evidence: sourceEvidence, sourceUrl: amendment.primaryDocumentUrl };
}
function evidence(item: SecFilingIdentity, excerpt: string) {
  return {
    amendmentExcerpt: excerpt,
    amendmentDocumentUrl: item.primaryDocumentUrl,
    amendmentIndexUrl: item.indexUrl,
    submissionsUrl: `https://data.sec.gov/submissions/CIK${item.issuerCik.padStart(10, "0")}.json`,
  };
}
function identity(accessionNumber: string, formType: string, filedDate: string): SecFilingIdentity {
  const compact = accessionNumber.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/1764974/${compact}`;
  return {
    rawItemId: `10000000-0000-4000-8000-${compact.slice(-12)}`,
    sourceCode: "sec_edgar", issuerCik: "1764974", accessionNumber, formType, filedDate,
    primaryDocumentUrl: `${base}/primary.htm`, indexUrl: `${base}/${accessionNumber}-index.html`,
  };
}
function fact(item: SecFilingIdentity, semanticFactKey: string, version: number): SecSemanticFactVersion {
  return {
    rawItemId: item.rawItemId, sourceAccessionNumber: item.accessionNumber, semanticFactKey,
    factPayload: { version },
    sourceRef: { url: item.primaryDocumentUrl, document: "primary.htm", evidence: `official source version ${version}` },
  };
}
function linked(amendmentIdentity: SecFilingIdentity, prior: SecFilingIdentity, operation: "REPLACE" | "CANCEL", keys: string[]): Extract<SecAmendmentLineageResolution, { status: "linked" }> {
  return {
    status: "linked", version: "sec_amendment_lineage_v1", amendment: amendmentIdentity, prior,
    formFamily: "8-K", operation, operationEvidence: operation, targetEvidence: prior.accessionNumber,
    affectedFactKeys: keys,
    factScopeEvidence: keys.map((semanticFactKey) => ({ semanticFactKey, evidence: operation, sourceUrl: amendmentIdentity.primaryDocumentUrl })),
    evidence: evidence(amendmentIdentity, operation),
    observationKey: amendmentIdentity.accessionNumber.replace(/\D/g, "").padEnd(64, "0").slice(0, 64),
  };
}
