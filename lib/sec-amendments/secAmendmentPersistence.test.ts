import assert from "node:assert/strict";

import {
  persistSecAmendmentObservation,
  persistSecOriginalFacts,
} from "./secAmendmentPersistence.ts";
import {
  resolveSecAmendmentLineage,
  type SecFilingIdentity,
  type SecSemanticFactVersion,
} from "./secAmendmentLineage.ts";

const root = identity(
  "40000000-0000-4000-8000-000000000001",
  "0001000000-26-000001",
  "8-K",
  "2026-01-01",
  "root.htm",
);
const amendment = identity(
  "40000000-0000-4000-8000-000000000002",
  "0001000000-26-000002",
  "8-K/A",
  "2026-01-02",
  "amendment.htm",
);
const fact: SecSemanticFactVersion = {
  rawItemId: root.rawItemId,
  sourceAccessionNumber: root.accessionNumber,
  semanticFactKey: "listing.notice",
  factPayload: { status: "deficient" },
  sourceRef: {
    url: root.primaryDocumentUrl,
    document: "root.htm",
    evidence: "Nasdaq notice",
  },
};

const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
const dependencies = {
  rpc: async (name: string, payload: Record<string, unknown>) => {
    calls.push({ name, payload });
    return {
      ok: true,
      status: 200,
      data: { status: "saved", inserted_count: 1, idempotent_count: 0 },
    };
  },
};

assert.deepEqual(
  await persistSecOriginalFacts({
    identity: root,
    facts: [fact],
    dependencies,
  }),
  {
    status: "saved",
    insertedCount: 1,
    idempotentCount: 0,
  },
);
assert.equal(calls[0].name, "persist_sec_filing_original_facts");
const serialized = (
  calls[0].payload.p_facts as Array<Record<string, unknown>>
)[0];
assert.match(String(serialized.historyKey), /^[0-9a-f]{64}$/);

const unavailable = resolveSecAmendmentLineage({
  amendment,
  candidates: [],
  affectedFacts: [],
  evidence: evidence(
    amendment,
    "This Form 8-K/A refers to the Form 8-K filed on January 1, 2026.",
  ),
});
assert.equal(unavailable.status, "unavailable_review");
assert.deepEqual(
  await persistSecAmendmentObservation({
    observation: unavailable,
    facts: [fact],
    dependencies,
  }),
  {
    status: "rejected",
    reason: "unavailable_observation_must_not_write_facts",
  },
);
assert.equal(calls.length, 1);

console.log("SEC amendment persistence adapter passed");

function identity(
  rawItemId: string,
  accession: string,
  formType: string,
  filedDate: string,
  document: string,
): SecFilingIdentity {
  const compact = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/1000000/${compact}`;
  return {
    rawItemId,
    sourceCode: "sec_edgar",
    issuerCik: "1000000",
    accessionNumber: accession,
    formType,
    filedDate,
    primaryDocumentUrl: `${base}/${document}`,
    indexUrl: `${base}/${accession}-index.html`,
  };
}

function evidence(identityValue: SecFilingIdentity, amendmentExcerpt: string) {
  return {
    amendmentExcerpt,
    amendmentDocumentUrl: identityValue.primaryDocumentUrl,
    amendmentIndexUrl: identityValue.indexUrl,
    submissionsUrl: "https://data.sec.gov/submissions/CIK0001000000.json",
  };
}
