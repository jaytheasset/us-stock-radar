import test from "node:test";
import assert from "node:assert/strict";
import { findSourceBackedSecTradingPairs } from "./sourceTickerSelection.ts";
const row = { cik: "1234567", name: "EXAMPLE INSTRUMENTS INC", ticker: "EXMP", exchange: "Nasdaq" };
test("exact official name/symbol in a heading resolves CIK without assigning transaction role", () => {
  const block = { block_id: "synthetic", heading: 'pending merger with Example Instruments Inc. (Nasdaq: EXMP) at a meeting', text: "Meeting." };
  const before = JSON.stringify(block), [r] = findSourceBackedSecTradingPairs([block], [row]);
  assert.equal(r.status, "corroborated"); assert.equal(r.row?.cik, "1234567"); assert.equal(r.evidence.source_field, "heading");
  assert.ok(block.heading.includes(r.evidence.quote)); assert.equal(r.transactionRole, null); assert.equal(r.historicalTickerVerified, false); assert.equal(JSON.stringify(block), before);
});
test("company-prefix, wrong ticker/exchange and ambiguous official CIKs stay unresolved", () => {
  for (const text of ["Example Instruments Inc II (Nasdaq: EXMP)", "Other Example Instruments Inc (Nasdaq: EXMP)", "Different Company (Nasdaq: EXMP)", "Example Instruments Inc. (NYSE: EXMP)", "Example Instruments Inc. (Nasdaq: FAKE)"])
    assert.equal(findSourceBackedSecTradingPairs([{ block_id: "x", text }], [row])[0].status, "unresolved");
  assert.equal(findSourceBackedSecTradingPairs([{ block_id: "x", text: "Example Instruments Inc. (Nasdaq: EXMP)" }], [row, { ...row, cik: "7654321" }])[0].status, "unresolved");
});
test("abbreviations, model output and unlabelled uppercase text are not source trading pairs", () => {
  assert.deepEqual(findSourceBackedSecTradingPairs([{ block_id: "x", text: 'Example Company II ("EXMP II"); ticker EXMP; LLM says EXMP.' }], [row]), []);
});
