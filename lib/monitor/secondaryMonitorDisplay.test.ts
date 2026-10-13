import assert from "node:assert/strict";
import test from "node:test";
import { formatSecondaryMonitorValue as format } from "./secondaryMonitorDisplay.ts";

test("saved Form144 value FACT and threshold use the Registry USD contract without changing numbers", () => {
  const values = [1437000, 1000000];
  assert.deepEqual(values.map(value => format("ownership.form144.proposed_sale_value", value)), ["USD\u00a01,437,000.00", "USD\u00a01,000,000.00"]);
  assert.deepEqual(values, [1437000, 1000000]);
});

test("shares, dates, text and unknown keys keep their non-currency presentation", () => {
  assert.equal(format("ownership.form144.proposed_sale_shares", 30000), "30,000");
  assert.equal(format("ownership.form144.proposed_sale_shares", 25000), "25,000");
  assert.equal(format("ownership.form144.proposed_sale_date", "2026-02-06"), "2026-02-06");
  assert.equal(format("ownership.form144.security_class", ["Common", "Preferred"]), "Common, Preferred");
  assert.equal(format("ownership.form144.exchange", "NYSE"), "NYSE");
  assert.equal(format("unknown", 1437000), "1,437,000");
  assert.equal(format("ownership.form144.proposed_sale_value", null), "Unconfirmed");
});
