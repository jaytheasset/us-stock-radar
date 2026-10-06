import test from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidenceSupport } from "./evaluate.mjs";

const baseReview = {
  fact_type: "expiration",
  claims: { current: { value: "2025-02-04" }, previous: { present: false } },
  refs: {
    E1: { supports: ["current"], strength: "direct" },
    E2: { supports: ["current"], strength: "corroborating" },
  },
};

const raw = fact => JSON.stringify({ facts: [fact], unresolved: [] });

test("direct plus corroborating support passes", () => {
  const r = evaluateEvidenceSupport(raw({ type: "expiration", current: "2025-02-04", evidence_refs: ["E1", "E2"] }), baseReview);
  assert.equal(r.pass, true);
  assert.deepEqual(r.claims.current.direct, ["E1"]);
  assert.deepEqual(r.claims.current.corroborating, ["E2"]);
});

test("corroborating-only evidence fails", () => {
  const r = evaluateEvidenceSupport(raw({ type: "expiration", current: "2025-02-04", evidence_refs: ["E2"] }), baseReview);
  assert.equal(r.pass, false);
  assert.ok(r.errors.includes("no-direct-support:current"));
});

test("unreviewed selected ref fails closed", () => {
  const r = evaluateEvidenceSupport(raw({ type: "expiration", current: "2025-02-04", evidence_refs: ["E1", "E9"] }), baseReview);
  assert.equal(r.pass, false);
  assert.ok(r.errors.some(x => x.includes("unreviewed-selected-ref")));
});

test("irrelevant or conflicting selected ref fails", () => {
  for (const strength of ["irrelevant", "conflicting"]) {
    const review = structuredClone(baseReview);
    review.refs.E3 = { supports: ["current"], strength };
    const r = evaluateEvidenceSupport(raw({ type: "expiration", current: "2025-02-04", evidence_refs: ["E1", "E3"] }), review);
    assert.equal(r.pass, false);
  }
});

test("current and previous may use different direct refs", () => {
  const review = structuredClone(baseReview);
  review.claims.previous = { present: true, value: "2025-02-03" };
  review.refs.E2 = { supports: ["previous"], strength: "direct" };
  const r = evaluateEvidenceSupport(raw({ type: "expiration", current: "2025-02-04", previous: "2025-02-03", evidence_refs: ["E1", "E2"] }), review);
  assert.equal(r.pass, true);
  assert.deepEqual(r.claims.current.direct, ["E1"]);
  assert.deepEqual(r.claims.previous.direct, ["E2"]);
});

test("previous requires its own direct support when emitted", () => {
  const review = structuredClone(baseReview);
  review.claims.previous = { present: true, value: "2025-02-03" };
  review.refs.E2 = { supports: ["previous"], strength: "corroborating" };
  const r = evaluateEvidenceSupport(raw({ type: "expiration", current: "2025-02-04", previous: "2025-02-03", evidence_refs: ["E1", "E2"] }), review);
  assert.equal(r.pass, false);
  assert.ok(r.errors.includes("no-direct-support:previous"));
});

test("selected ref supporting no emitted claim fails", () => {
  const review = structuredClone(baseReview);
  review.refs.E3 = { supports: ["previous"], strength: "direct" };
  const r = evaluateEvidenceSupport(raw({ type: "expiration", current: "2025-02-04", evidence_refs: ["E1", "E3"] }), review);
  assert.equal(r.pass, false);
  assert.ok(r.errors.some(x => x.includes("unsupported-selected-ref")));
});

test("raw model output is not mutated or filtered", () => {
  const text = raw({ type: "expiration", current: "2025-02-04", evidence_refs: ["E1", "E2"] });
  const before = text;
  evaluateEvidenceSupport(text, baseReview);
  assert.equal(text, before);
});
