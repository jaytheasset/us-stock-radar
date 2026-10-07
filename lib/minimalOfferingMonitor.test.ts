import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MINIMAL_OFFERING_FACT_KEYS,
  MINIMAL_OFFERING_MONITOR_PROMPT,
  MINIMAL_OFFERING_MONITOR_VERSION,
  MINIMAL_OFFERING_MONITOR_WIRE_VERSION,
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
    primary_or_resale: "mixed",
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

test("1. provider schema is exactly one unconstrained plain string", () => {
  const text = JSON.stringify(minimalOfferingMonitorProviderSchema);
  assert.deepEqual(minimalOfferingMonitorProviderSchema, { type: "string" });
  assert.doesNotMatch(text, /enum|null|object|array|union|oneOf|anyOf|format/);
  assert.doesNotMatch(text, /total_potential_primary_share_exposure/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /analysis_output\.offering_monitor_payload/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /one minified JSON string/);
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
  const value = monitor({ primary_or_resale: "primary" });
  value.facts.resale_share_exposure = fact({ comparison_basis_type: "public_float" });
  assert.equal(validateMinimalOfferingMonitor(value).ok, true);
});

test("10. resale classification rejects primary facts and validates when they are unavailable", () => {
  const value = monitor({ primary_or_resale: "resale" });
  assert.equal(validateMinimalOfferingMonitor(value).ok, false);
  value.facts.actual_primary_offering_amount = fact({ unit: "currency", comparison_basis_type: "market_cap" });
  value.facts.immediate_primary_share_exposure = fact();
  value.facts.additional_potential_primary_share_exposure = fact();
  assert.equal(validateMinimalOfferingMonitor(value).ok, true);
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
    offering_monitor_payload: JSON.stringify({ v: "broken" }),
  };
  const boundary = applyMinimalOfferingMonitorBoundary(analysis);
  assert.equal(boundary.provenance.status, "validation_failed");
  assert.equal(analysis.event_title, "keep title");
  assert.equal(analysis.summary, "keep summary");
  assert.equal(analysis.score, 80);
  assert.equal(analysis.offering_monitor, undefined);
  assert.equal(analysis.offering_monitor_payload, undefined);
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

test("22. distinct exposure security bases remain additive on a compatible comparison basis", () => {
  const value = monitor();
  value.facts.additional_potential_primary_share_exposure.security_basis = "conditional_right";
  value.facts.additional_potential_primary_share_exposure.value = value.facts.immediate_primary_share_exposure.value;
  assert.equal(validateMinimalOfferingMonitor(value).ok, true);
  const total = materializeMinimalOfferingMonitor(value, snapshot).total_potential_primary_share_exposure;
  assert.equal(total.availability, "available");
  assert.equal(total.value, 2_000_000);
  assert.equal(total.comparison_basis_type, "shares_outstanding");
  assert.equal(total.security_basis, "common_stock + conditional_right");
});

test("22b. incompatible immediate/additional comparison basis still fails closed", () => {
  const value = monitor();
  value.facts.additional_potential_primary_share_exposure.comparison_basis_type = "public_float";
  assert.equal(validateMinimalOfferingMonitor(value).ok, false);
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

test("29. valid minified om1 payload normalizes and raw string is removed", () => {
  const analysis: Record<string, unknown> = { offering_monitor_payload: payloadFromCanonical(monitor()) };
  const result = applyMinimalOfferingMonitorBoundary(analysis);
  assert.equal(result.provenance.status, "success");
  assert.equal(result.value?.version, MINIMAL_OFFERING_MONITOR_VERSION);
  assert.equal(analysis.offering_monitor_payload, undefined);
  assert.deepEqual(analysis.offering_monitor, result.value);
});

test("30. duplicate root key is a transport failure", () => {
  const payload = payloadFromCanonical(monitor());
  const result = boundaryFor(`{"v":"om1",${payload.slice(1)}`);
  assert.equal(result.provenance.status, "transport_failed");
  assert.match(result.provenance.errors.join(" "), /duplicate key/);
});

test("31. duplicate nested key is a transport failure", () => {
  const payload = payloadFromCanonical(monitor()).replace('"value":5000000', '"value":1,"value":5000000');
  const result = boundaryFor(payload);
  assert.equal(result.provenance.status, "transport_failed");
  assert.match(result.provenance.errors.join(" "), /duplicate key/);
});

test("32. unknown root and nested keys fail exact transport validation", () => {
  for (const mutate of [
    (wire: Record<string, any>) => { wire.extra = true; },
    (wire: Record<string, any>) => { wire.facts.price.typo = "x"; },
  ]) {
    const wire = wireFromCanonical(monitor());
    mutate(wire);
    assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
  }
});

test("33. missing root and nested keys fail rather than default", () => {
  for (const mutate of [
    (wire: Record<string, any>) => { delete wire.pfw; },
    (wire: Record<string, any>) => { delete wire.facts.price.comparable; },
  ]) {
    const wire = wireFromCanonical(monitor());
    mutate(wire);
    assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
  }
});

test("34. truncated payload and malformed quote are transport failures", () => {
  const payload = payloadFromCanonical(monitor());
  assert.equal(boundaryFor(payload.slice(0, -1)).provenance.status, "transport_failed");
  assert.equal(boundaryFor(payload.replace('"block-price"', '"block-price')).provenance.status, "transport_failed");
});

test("35. wrong wire version and decoded root type fail closed", () => {
  const wire = wireFromCanonical(monitor());
  wire.v = "om2";
  assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
  for (const payload of ['"om1"', "[]", "null"]) {
    assert.equal(boundaryFor(payload).provenance.status, "validation_failed");
  }
});

test("36. numeric strings, suffix numbers, and currency-decorated numbers are rejected", () => {
  for (const bad of ["5000000", "5M", "$5,000,000"]) {
    const wire = wireFromCanonical(monitor());
    wire.facts.amount.value = bad;
    assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
  }
});

test("37. explicit zero, false, and null remain distinct", () => {
  const wire = wireFromCanonical(monitor());
  wire.conv = false;
  wire.pfw = null;
  wire.facts.resale.value = 0;
  const result = boundaryFor(JSON.stringify(wire));
  assert.equal(result.provenance.status, "success");
  assert.equal(result.value?.has_convertible, false);
  assert.equal(result.value?.has_prefunded_warrant, null);
  assert.equal(result.value?.facts.resale_share_exposure.value, 0);
});

test("38. invalid stage and side are rejected by strict canonical validation", () => {
  for (const [key, bad] of [["stage", "pending"], ["side", "primary-ish"]] as const) {
    const wire = wireFromCanonical(monitor());
    wire[key] = bad;
    assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
  }
});

test("39. invalid quality and bound are rejected by strict canonical validation", () => {
  for (const [key, bad] of [["quality", "approximately_exact"], ["bound", "up_to"]] as const) {
    const wire = wireFromCanonical(monitor());
    wire.facts.price[key] = bad;
    assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
  }
});

test("40. availability and value conflicts are rejected", () => {
  const unavailableZero = wireFromCanonical(monitor());
  unavailableZero.facts.price.availability = "unavailable";
  unavailableZero.facts.price.value = 0;
  assert.equal(boundaryFor(JSON.stringify(unavailableZero)).provenance.status, "validation_failed");

  const availableNull = wireFromCanonical(monitor());
  availableNull.facts.price.value = null;
  assert.equal(boundaryFor(JSON.stringify(availableNull)).provenance.status, "validation_failed");
});

test("41. available unknown keeps its numeric value", () => {
  const wire = wireFromCanonical(monitor());
  wire.facts.amount.quality = "unknown";
  const result = boundaryFor(JSON.stringify(wire));
  assert.equal(result.provenance.status, "success");
  assert.equal(result.value?.facts.actual_primary_offering_amount.value, 5_000_000);
  assert.equal(result.value?.facts.actual_primary_offering_amount.value_quality, "unknown");
});

test("42. unavailable facts require explicit null value", () => {
  const value = monitor({ primary_or_resale: "primary" });
  value.facts.resale_share_exposure = fact({ comparison_basis_type: "public_float" });
  const result = boundaryFor(payloadFromCanonical(value));
  assert.equal(result.provenance.status, "success");
  assert.equal(result.value?.facts.resale_share_exposure.value, null);
});

test("43. source references must be compact stable identifiers", () => {
  const wire = wireFromCanonical(monitor());
  wire.facts.price.source = "a long evidence sentence with spaces";
  assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
});

test("44. transport never accepts a total potential field", () => {
  const wire = wireFromCanonical(monitor());
  wire.total = 1_500_000;
  assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "validation_failed");
});

test("45. malformed payload preserves legacy analysis and prior canonical persistence", () => {
  const prior = materializeMinimalOfferingMonitor(monitor(), snapshot);
  const analysis: Record<string, unknown> = {
    event_title: "keep",
    summary: "keep summary",
    offering_monitor_payload: "{",
  };
  const boundary = applyMinimalOfferingMonitorBoundary(analysis);
  const persisted = prepareMinimalOfferingMonitorPersistence({
    analysisOutput: analysis.offering_monitor,
    provenance: analysis.offering_monitor_provenance,
    existingMetadata: { offering_monitor: prior, marker: "keep" },
    marketSnapshot: snapshot,
  });
  assert.equal(boundary.provenance.status, "transport_failed");
  assert.equal(analysis.event_title, "keep");
  assert.equal(analysis.summary, "keep summary");
  assert.deepEqual(persisted.metadata.offering_monitor, prior);
  assert.equal(persisted.metadata.marker, "keep");
});

test("46. unsupported assumed quality remains a strict runtime rejection", () => {
  const wire = wireFromCanonical(monitor());
  wire.facts.price.quality = "assumed";
  const result = boundaryFor(JSON.stringify(wire));
  assert.equal(result.provenance.status, "validation_failed");
  assert.match(result.provenance.errors.join(" "), /value_quality is invalid/);
});

test("47. all existing canonical quality values remain accepted", () => {
  for (const quality of ["exact", "derived", "estimated", "unknown"]) {
    const wire = wireFromCanonical(monitor());
    wire.facts.price.quality = quality;
    assert.equal(boundaryFor(JSON.stringify(wire)).provenance.status, "success");
  }
});

test("48. prompt distinguishes primary, resale, mixed, and multiple security types", () => {
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /primary means issuer-sold securities whose proceeds go to the issuer/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /resale means selling-securityholder resale/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /mixed means both issuer primary sales and selling-securityholder resale/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /Multiple security types or instruments alone do not make a transaction mixed/);
});

test("49. prompt keeps gross primary amount separate from net proceeds and forbids fallback", () => {
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /source-backed gross transaction amount/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /Never substitute estimated net proceeds/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /value=null instead of using net proceeds as a fallback/);
});

test("50. prompt matches om1 comparable and required-key unknown representation", () => {
  assert.doesNotMatch(MINIMAL_OFFERING_MONITOR_PROMPT, /comparable_to_event_market_basis/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /The required om1 key is comparable/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /All keys are required/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /Use explicit JSON null only for an unknown nullable value/);
  assert.doesNotMatch(MINIMAL_OFFERING_MONITOR_PROMPT, /omit (?:it|the key|a key|keys|fields?) when unknown/i);
});

test("51. prompt makes seller evidence authoritative and parser labels non-semantic", () => {
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /raw evidence about the actual sellers, proceeds recipients/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /parser-created block label is not seller evidence/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /Multiple security types or instruments alone do not make a transaction mixed/);
});

test("52. prompt preserves source-backed assumed price without claiming a final price", () => {
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /assumed or estimated registration price as an available numeric value/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /quality=estimated/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /instead of discarding it as unavailable or overstating it as a final transaction price/);
  assert.doesNotMatch(MINIMAL_OFFERING_MONITOR_PROMPT, /quality=assumed/);
});

test("53. prompt prevents combined totals from being reused as additional exposure", () => {
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /additional_potential_primary_share_exposure excludes everything already in immediate and is not total potential exposure/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /Never copy a combined immediate-plus-conditional total into additional/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /Do not return total potential exposure; code adds immediate plus additional/);
});

test("54. prompt requires null rather than an empty unavailable source", () => {
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /For unavailable facts value and source are JSON null/);
  assert.match(MINIMAL_OFFERING_MONITOR_PROMPT, /never use an empty string, N\/A, none, or another placeholder/);
});

function boundaryFor(payload: unknown) {
  const analysis: Record<string, unknown> = { offering_monitor_payload: payload };
  return applyMinimalOfferingMonitorBoundary(analysis);
}

function payloadFromCanonical(value: MinimalOfferingMonitor) {
  return JSON.stringify(wireFromCanonical(value));
}

function wireFromCanonical(value: MinimalOfferingMonitor): Record<string, any> {
  const aliases: Record<string, string> = {
    actual_primary_offering_amount: "amount",
    offering_price: "price",
    immediate_primary_share_exposure: "immediate",
    additional_potential_primary_share_exposure: "additional",
    resale_share_exposure: "resale",
  };
  return {
    v: MINIMAL_OFFERING_MONITOR_WIRE_VERSION,
    app: value.applicability,
    stage: value.financing_stage,
    side: value.primary_or_resale,
    nature: value.security_nature,
    w: value.has_warrant,
    pfw: value.has_prefunded_warrant,
    conv: value.has_convertible,
    facts: Object.fromEntries(MINIMAL_OFFERING_FACT_KEYS.map((key) => {
      const item = value.facts[key];
      return [aliases[key], {
        value: item.value,
        availability: item.availability,
        quality: item.value_quality,
        bound: item.bound,
        unit: item.unit,
        currency: item.currency,
        security_basis: item.security_basis,
        comparison_basis: item.comparison_basis_type,
        comparable: item.comparable_to_event_market_basis,
        source: item.source_ref,
      }];
    })),
  };
}

test("shared helper never infers exposure compatibility from security names", () => {
  const source = readFileSync(new URL("./minimalOfferingMonitor.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /warrant.*additional|prefunded.*immediate|common[_ -]?share.*compatible/i);
});
