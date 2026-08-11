import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MINIMAL_OFFERING_FACT_KEYS,
  MINIMAL_OFFERING_MONITOR_PROMPT,
  MINIMAL_OFFERING_MONITOR_VERSION,
  applyMinimalOfferingMonitorBoundary,
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  minimalOfferingMonitorProviderSchema,
  prepareMinimalOfferingMonitorPersistence,
  validateMinimalOfferingMonitor,
  type MinimalOfferingMonitor,
  type MinimalOfferingNumericFact,
} from "./minimalOfferingMonitor.ts";

const snapshot = buildMinimalOfferingMarketSnapshot({
  price: 2,
  market_cap: 20_000_000,
  shares_outstanding: 10_000_000,
  public_float: 8_000_000,
  currency: "USD",
  security_basis: "common_stock",
  price_unit: "currency_per_security",
  market_cap_unit: "currency",
  share_unit: "shares",
  as_of: "2026-08-11T00:00:00Z",
});

function fact(overrides: Partial<MinimalOfferingNumericFact> = {}): MinimalOfferingNumericFact {
  return {
    value: null,
    availability: "unavailable",
    value_quality: "unknown",
    bound: "unknown",
    unit: "shares",
    currency: null,
    security_basis: null,
    comparison_basis_type: "shares_outstanding",
    comparable_to_event_market_basis: null,
    source_ref: null,
    ...overrides,
  };
}

function availableShares(value: number, overrides: Partial<MinimalOfferingNumericFact> = {}) {
  return fact({
    value,
    availability: "available",
    value_quality: "exact",
    bound: "exact",
    unit: "shares",
    security_basis: "common_stock",
    comparison_basis_type: "shares_outstanding",
    comparable_to_event_market_basis: true,
    source_ref: "block-1",
    ...overrides,
  });
}

function monitor(overrides: Partial<MinimalOfferingMonitor> = {}): MinimalOfferingMonitor {
  return {
    version: MINIMAL_OFFERING_MONITOR_VERSION,
    applicability: "applicable",
    financing_stage: "priced",
    primary_or_resale: "primary",
    security_nature: "equity_linked",
    has_warrant: true,
    has_prefunded_warrant: true,
    has_convertible: false,
    facts: {
      actual_primary_offering_amount: fact({
        value: 5_000_000,
        availability: "available",
        value_quality: "exact",
        bound: "exact",
        unit: "currency",
        currency: "USD",
        security_basis: "common_stock",
        comparison_basis_type: "market_cap",
        comparable_to_event_market_basis: true,
        source_ref: "block-amount",
      }),
      offering_price: fact({
        value: 1.5,
        availability: "available",
        value_quality: "exact",
        bound: "exact",
        unit: "currency_per_security",
        currency: "USD",
        security_basis: "common_stock",
        comparison_basis_type: "market_price",
        comparable_to_event_market_basis: true,
        source_ref: "block-price",
      }),
      immediate_primary_share_exposure: availableShares(1_000_000),
      additional_potential_primary_share_exposure: availableShares(500_000, { source_ref: "block-warrant" }),
      resale_share_exposure: availableShares(400_000, {
        comparison_basis_type: "public_float",
        source_ref: "block-resale",
      }),
    },
    ...overrides,
  };
}

test("1. provider schema is minimal, named, and contains no transport graph arrays", () => {
  const text = JSON.stringify(minimalOfferingMonitorProviderSchema);
  assert.equal(minimalOfferingMonitorProviderSchema.type, "object");
  assert.ok(text.length < 8_000);
  assert.doesNotMatch(text, /components|groups|calculation_inputs|row_sets|evidence|confidence/);
  assert.doesNotMatch(text, /total_potential_primary_share_exposure/);
});

test("2. available exact value validates", () => {
  assert.equal(validateMinimalOfferingMonitor(monitor()).ok, true);
});

test("3. unavailable is null and never coerced to zero", () => {
  const value = monitor();
  value.facts.offering_price = fact({ unit: "currency_per_security", comparison_basis_type: "market_price" });
  const result = materializeMinimalOfferingMonitor(value, snapshot);
  assert.equal(result.facts.offering_price.value, null);
  assert.equal(result.derived_metrics.offering_discount_to_market_percent.value, null);
});

test("4. available unknown preserves its value and is excluded from safe projection", () => {
  const value = monitor();
  value.facts.actual_primary_offering_amount.value_quality = "unknown";
  const result = materializeMinimalOfferingMonitor(value, snapshot);
  assert.equal(result.facts.actual_primary_offering_amount.value, 5_000_000);
  assert.equal("actual_primary_offering_amount" in result.safe_projection, false);
  assert.equal(result.derived_metrics.actual_primary_offering_amount_percent_of_market_cap.availability, "unavailable");
});

test("5. maximum bound is preserved through amount percent", () => {
  const value = monitor();
  value.facts.actual_primary_offering_amount.bound = "maximum";
  const result = materializeMinimalOfferingMonitor(value, snapshot);
  assert.equal(result.derived_metrics.actual_primary_offering_amount_percent_of_market_cap.bound, "maximum");
});

test("6. actual zero remains available zero", () => {
  const value = monitor();
  value.facts.resale_share_exposure = availableShares(0, { comparison_basis_type: "public_float" });
  const result = materializeMinimalOfferingMonitor(value, snapshot);
  assert.equal(result.facts.resale_share_exposure.value, 0);
  assert.equal(result.derived_metrics.resale_overhang_percent.value, 0);
});

test("7. registration-only financing stage is distinct", () => {
  assert.equal(validateMinimalOfferingMonitor(monitor({ financing_stage: "registration_only" })).ok, true);
});

test("8. active and priced stages both validate", () => {
  assert.equal(validateMinimalOfferingMonitor(monitor({ financing_stage: "active_offering" })).ok, true);
  assert.equal(validateMinimalOfferingMonitor(monitor({ financing_stage: "priced" })).ok, true);
});

test("9. primary classification validates", () => {
  assert.equal(validateMinimalOfferingMonitor(monitor({ primary_or_resale: "primary" })).ok, true);
});

test("10. resale classification validates without changing primary facts", () => {
  const value = monitor({ primary_or_resale: "resale" });
  assert.equal(validateMinimalOfferingMonitor(value).ok, true);
  assert.notEqual(value.facts.resale_share_exposure, value.facts.immediate_primary_share_exposure);
});

test("11. mixed classification validates", () => {
  assert.equal(validateMinimalOfferingMonitor(monitor({ primary_or_resale: "mixed" })).ok, true);
});

test("12. immediate exposure produces its own dilution metric", () => {
  const result = materializeMinimalOfferingMonitor(monitor(), snapshot);
  assert.equal(result.derived_metrics.immediate_primary_dilution_percent.value, 10);
});

test("13. additional potential exposure remains separate", () => {
  const result = materializeMinimalOfferingMonitor(monitor(), snapshot);
  assert.equal(result.facts.additional_potential_primary_share_exposure.value, 500_000);
  assert.equal(result.facts.immediate_primary_share_exposure.value, 1_000_000);
});

test("14. code total is immediate plus additional only", () => {
  const result = materializeMinimalOfferingMonitor(monitor(), snapshot);
  assert.equal(result.total_potential_primary_share_exposure.value, 1_500_000);
  assert.equal(result.derived_metrics.total_potential_primary_dilution_percent.value, 15);
});

test("15. comparable true with exact snapshot basis calculates", () => {
  const result = materializeMinimalOfferingMonitor(monitor(), snapshot);
  assert.equal(result.derived_metrics.actual_primary_offering_amount_percent_of_market_cap.value, 25);
});

test("16. comparable false or null blocks derived metrics", () => {
  for (const comparable of [false, null] as const) {
    const value = monitor();
    value.facts.immediate_primary_share_exposure.comparable_to_event_market_basis = comparable;
    assert.equal(materializeMinimalOfferingMonitor(value, snapshot).derived_metrics.immediate_primary_dilution_percent.availability, "unavailable");
  }
});

test("17. resale exposure uses public float and never primary exposure", () => {
  const result = materializeMinimalOfferingMonitor(monitor(), snapshot);
  assert.equal(result.derived_metrics.resale_overhang_percent.value, 5);
  assert.equal(result.derived_metrics.immediate_primary_dilution_percent.value, 10);
});

test("18. canonical persistence has no parser fallback", () => {
  const source = readFileSync(new URL("./minimalOfferingMonitor.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /parser_output|offering_terms fallback|form_type|security name/i);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /rather than parser semantics/);
});

test("19. malformed canonical records validation failure while legacy fields stay unchanged", () => {
  const analysis: Record<string, unknown> = {
    event_title: "keep title",
    summary: "keep summary",
    score: 80,
    offering_monitor: { version: "broken" },
  };
  const boundary = applyMinimalOfferingMonitorBoundary(analysis);
  assert.equal(boundary.provenance.status, "validation_failed");
  assert.equal(analysis.event_title, "keep title");
  assert.equal(analysis.summary, "keep summary");
  assert.equal(analysis.score, 80);
  assert.equal(analysis.offering_monitor, undefined);
});

test("20. failure preserves prior valid canonical metadata", () => {
  const prior = materializeMinimalOfferingMonitor(monitor(), snapshot);
  const result = prepareMinimalOfferingMonitorPersistence({
    analysisOutput: undefined,
    provenance: { status: "transport_failed", errors: ["missing"] },
    existingMetadata: { offering_monitor: prior, marker: "keep" },
    marketSnapshot: snapshot,
  });
  assert.equal(result.status, "transport_failed");
  assert.deepEqual(result.metadata.offering_monitor, prior);
  assert.equal(result.metadata.marker, "keep");
});

test("21. valid reanalysis replaces canonically and is idempotent", () => {
  const next = monitor({ financing_stage: "closed" });
  const first = prepareMinimalOfferingMonitorPersistence({ analysisOutput: next, provenance: null, existingMetadata: {}, marketSnapshot: snapshot });
  const second = prepareMinimalOfferingMonitorPersistence({ analysisOutput: next, provenance: null, existingMetadata: first.metadata, marketSnapshot: snapshot });
  assert.deepEqual(second.metadata, first.metadata);
  assert.equal((second.metadata.offering_monitor as MinimalOfferingMonitor).financing_stage, "closed");
});

test("22. incompatible immediate/additional basis blocks total", () => {
  const value = monitor();
  value.facts.additional_potential_primary_share_exposure.security_basis = "adr";
  assert.equal(materializeMinimalOfferingMonitor(value, snapshot).total_potential_primary_share_exposure.availability, "unavailable");
});

test("23. currency mismatch blocks amount and discount metrics", () => {
  const value = monitor();
  value.facts.actual_primary_offering_amount.currency = "EUR";
  value.facts.offering_price.currency = "EUR";
  const result = materializeMinimalOfferingMonitor(value, snapshot);
  assert.equal(result.derived_metrics.actual_primary_offering_amount_percent_of_market_cap.unavailable_reason, "currency_mismatch");
  assert.equal(result.derived_metrics.offering_discount_to_market_percent.unavailable_reason, "currency_mismatch");
});

test("24. security basis mismatch blocks derived metrics", () => {
  const value = monitor();
  value.facts.resale_share_exposure.security_basis = "adr";
  assert.equal(materializeMinimalOfferingMonitor(value, snapshot).derived_metrics.resale_overhang_percent.unavailable_reason, "security_basis_mismatch");
});

test("25. source-backed non-equity not_applicable invents no numeric facts", () => {
  const facts = Object.fromEntries(MINIMAL_OFFERING_FACT_KEYS.map((key) => [key, fact()])) as MinimalOfferingMonitor["facts"];
  const value = monitor({
    applicability: "not_applicable",
    financing_stage: "unknown",
    primary_or_resale: "not_applicable",
    security_nature: "non_equity",
    has_warrant: false,
    has_prefunded_warrant: false,
    has_convertible: false,
    facts,
  });
  const validation = validateMinimalOfferingMonitor(value);
  assert.equal(validation.ok, true);
  assert.deepEqual(materializeMinimalOfferingMonitor(value, snapshot).safe_projection, {});
});

test("26. offering discount is deterministic and bound-aware", () => {
  const value = monitor();
  value.facts.offering_price.bound = "maximum";
  const metric = materializeMinimalOfferingMonitor(value, snapshot).derived_metrics.offering_discount_to_market_percent;
  assert.equal(metric.value, 25);
  assert.equal(metric.bound, "minimum");
});

test("27. overly long source reference fails validation", () => {
  const value = monitor();
  value.facts.offering_price.source_ref = "x".repeat(161);
  assert.equal(validateMinimalOfferingMonitor(value).ok, false);
});

test("28. unsupported semantic fields fail instead of being silently accepted", () => {
  const value = monitor() as MinimalOfferingMonitor & { total_potential_primary_share_exposure?: number };
  value.total_potential_primary_share_exposure = 99;
  assert.equal(validateMinimalOfferingMonitor(value).ok, false);
});
