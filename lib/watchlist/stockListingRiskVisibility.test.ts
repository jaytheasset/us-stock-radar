import assert from "node:assert/strict";
import test from "node:test";
import { hasCurrentListingRisk, type StockListingStatus } from "./stockListingStatus.ts";

const base: StockListingStatus = {
  ticker: "SCPX", asOf: "2026-10-01", coverage: "stored_sec_observations_only", availability: "available", reason: null,
  security: { issuerCik: "0001476963", title: "Common Stock", exchange: "NYSE American" },
  automatic: { listing: "unresolved", trading: "unresolved", removalDate: null, suspensionDate: null,
    withdrawalNoticeDate: null, resumptionDate: null }, sources: [], reviewedDates: [],
};

test("only open canonical risks render; resolved axes do not suppress independent open risks", () => {
  for (const listing of ["unresolved", "removal_pending", "confirmed_exchange_delisting", "removal_decision_withdrawn"] as const) {
    for (const trading of ["unresolved", "suspension_scheduled", "suspended", "resumed"] as const) {
      const data = { ...base, automatic: { ...base.automatic, listing, trading } };
      const expected = ["removal_pending", "confirmed_exchange_delisting"].includes(listing)
        || ["suspension_scheduled", "suspended"].includes(trading);
      assert.equal(hasCurrentListingRisk(data), expected, `${listing}/${trading}`);
    }
  }
});
test("missing identity, unavailable or unresolved-only results never become a current warning", () => {
  const risk = { ...base, automatic: { ...base.automatic, trading: "suspended" as const } };
  for (const data of [base, { ...risk, security: null }, { ...risk, availability: "unknown" as const },
    { ...risk, availability: "unavailable" as const }]) assert.equal(hasCurrentListingRisk(data), false);
  assert.equal(base.automatic.listing, "unresolved");
});
