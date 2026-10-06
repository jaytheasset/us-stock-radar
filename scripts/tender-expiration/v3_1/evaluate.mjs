import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function evaluateEvidenceSupport(raw, review) {
  let output;
  try { output = JSON.parse(raw); }
  catch { return { pass: false, errors: ["invalid-json"], claims: {} }; }

  const errors = [];
  const fact = Array.isArray(output.facts) && output.facts.length === 1 ? output.facts[0] : null;
  if (!fact || fact.type !== review.fact_type) return { pass: false, errors: ["fact-shape-or-type-mismatch"], claims: {} };

  const selected = Array.isArray(fact.evidence_refs) ? fact.evidence_refs : [];
  if (!selected.length) errors.push("no-selected-evidence");

  const claimNames = ["current", ...(Object.hasOwn(fact, "previous") ? ["previous"] : [])];
  const claimResults = {};

  // First evaluate each emitted claim independently.
  for (const claim of claimNames) {
    const expected = review.claims?.[claim];
    if (!expected) {
      errors.push(`unexpected-claim:${claim}`);
      continue;
    }
    const direct = [];
    const corroborating = [];
    for (const ref of selected) {
      const item = review.refs?.[ref];
      if (!item || !Array.isArray(item.supports) || !item.supports.includes(claim)) continue;
      if (item.strength === "direct") direct.push(ref);
      if (item.strength === "corroborating") corroborating.push(ref);
    }
    if (!direct.length) errors.push(`no-direct-support:${claim}`);
    claimResults[claim] = { direct, corroborating };
  }

  // Then evaluate each selected ref once against the complete emitted fact.
  const unreviewed = [];
  const unsupported = [];
  const conflicting = [];
  for (const ref of selected) {
    const item = review.refs?.[ref];
    if (!item) { unreviewed.push(ref); continue; }
    if (item.strength === "irrelevant") { unsupported.push(ref); continue; }
    if (item.strength === "conflicting") { conflicting.push(ref); continue; }
    const supportsEmittedClaim = Array.isArray(item.supports) && item.supports.some(claim => claimNames.includes(claim));
    if (!supportsEmittedClaim && item.strength !== "context-only") unsupported.push(ref);
  }
  if (unreviewed.length) errors.push(`unreviewed-selected-ref:${unreviewed.join(",")}`);
  if (unsupported.length) errors.push(`unsupported-selected-ref:${unsupported.join(",")}`);
  if (conflicting.length) errors.push(`conflicting-selected-ref:${conflicting.join(",")}`);

  if (!Object.hasOwn(fact, "previous") && review.claims?.previous?.present === false) {
    claimResults.previous = { emitted: false, required: false, pass: true };
  }

  return {
    pass: errors.length === 0,
    errors,
    selectedRefs: selected,
    claims: claimResults,
    selectedRefReview: { unreviewed, unsupported, conflicting },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const raw = fs.readFileSync(path.resolve(here, "../v3/run/structured.txt"), "utf8");
  const review = JSON.parse(fs.readFileSync(path.join(here, "evidence-support-review.json"), "utf8"));
  const result = evaluateEvidenceSupport(raw, review);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.pass) process.exitCode = 1;
}
