import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { supportsEffectiveDateClause, hasSupportedEffectiveDate } from "./effectiveDate.ts";
import { scpxListingRiskReplay } from "./fixtures/listingRiskReplay.ts";
import { buildObservation, unattached } from "./observation.ts";
import type { CurrentListingRiskReadResult } from "../monitor/listingRiskPersistence.ts";

const source = JSON.parse(readFileSync(new URL("./fixtures/follow-up.json", import.meta.url), "utf8"))["scpx-before"];
// Exact evidence excerpt/date from the preserved live Scorpius response, not
// an independent assertion that its notice date is the effective date.
const cited = "On June 14, 2024, Scorpius Holdings, Inc. (the “Company”) received notice from the NYSE Regulation that it had suspended trading of the Company’s common stock";

test("Scorpius notice date does not prove an exact suspension or removal date", () => {
  for (const quote of [cited, source.quote]) {
    assert.equal(supportsEffectiveDateClause(quote, "2024-06-14", "trading_suspension_date"), false);
    assert.equal(supportsEffectiveDateClause(quote, "2024-06-14", "removal_effective_date"), false);
  }
});
test("explicit operative dates pass; notices, another date, conditional and expected statements do not", () => {
  assert.equal(supportsEffectiveDateClause("Trading in the common stock was suspended beginning June 14, 2024.", "2024-06-14", "trading_suspension_date"), true);
  assert.equal(supportsEffectiveDateClause("The common stock was removed from listing effective June 14, 2024.", "2024-06-14", "removal_effective_date"), true);
  for (const quote of [
    "Trading was suspended on June 13, 2024. Notice was received June 14, 2024.",
    "Trading is expected to be suspended on June 14, 2024.",
    "Trading was not suspended on June 14, 2024.",
    "If an appeal fails, trading was suspended on June 14, 2024.",
    "Trading was suspended; trading resumed on June 14, 2024.",
    "Trading was suspended. Notice arrived on June 14, 2024.",
  ]) assert.equal(supportsEffectiveDateClause(quote, "2024-06-14", "trading_suspension_date"), false, quote);
  assert.equal(supportsEffectiveDateClause("Trading was suspended on 2024-02-30.", "2024-02-30", "trading_suspension_date"), false);
});
test("canonical projection excludes unsupported dates but retains original model facts and evidence", () => {
  const facts = scpxListingRiskReplay(false);
  const date = { value: "2024-06-14", availability: "available" as const, value_quality: "exact" as const,
    source_ref: facts.sources[0].source_ref, date_status: "occurred" as const };
  facts.classification.event_kind = "trading_suspension";
  facts.dates.trading_suspension_date = date;
  facts.fact_provenance.push({ ...facts.fact_provenance.find(p => p.fact_path === "dates.notice_date.value")!,
    fact_path: "dates.trading_suspension_date.value", evidence: cited });
  const current = { status: "available", facts, eventId: "event", rawItemId: "raw" } as CurrentListingRiskReadResult;
  const raw = { id: "raw", source_code: "sec_edgar", source_unique_id: "0001079973-24-000891",
    source_url: source.url, published_at: "2024-06-17T12:44:57Z", raw_payload: {
      form_type: "8-K", cik: "1476963", primary_document_url: source.url, primary_document_html: `<p>${source.quote}</p>` } };
  const before = structuredClone(current);
  assert.equal(hasSupportedEffectiveDate({ listingRisk: current, sourceSnapshot: raw }, "trading_suspension_date"), false);
  const observation = buildObservation({ raw, asOf: "2024-06-17", scope: null, listingRisk: current,
    eventId: "event", attachment: unattached("missing_identity") });
  assert.equal(observation.reported.suspensionDate, null);
  assert.equal(observation.reported.trading, "unresolved");
  assert.ok(observation.reported.reasons.includes("trading_suspension_date_not_source_supported"));
  assert.deepEqual(observation.listingRisk, before);
  assert.deepEqual(current, before);
  // A plausible effective-date sentence is insufficient unless it is also in
  // the retained source and from the same filing/source reference.
  facts.fact_provenance.at(-1)!.evidence = "Trading was suspended on June 14, 2024.";
  assert.equal(hasSupportedEffectiveDate({ listingRisk: current, sourceSnapshot: raw }, "trading_suspension_date"), false);
  raw.raw_payload.primary_document_html += "<p>Trading was suspended on June 14, 2024.</p>";
  assert.equal(hasSupportedEffectiveDate({ listingRisk: current, sourceSnapshot: raw }, "trading_suspension_date"), true);
  facts.sources[0].source_id = "0001079973-24-000999";
  assert.equal(hasSupportedEffectiveDate({ listingRisk: current, sourceSnapshot: raw }, "trading_suspension_date"), false);
});
