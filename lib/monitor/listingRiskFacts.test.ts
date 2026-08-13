import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parseSecForm25Filing, type SecForm25Field } from "../sources/sec/forms/form25/parser.ts";
import {
  LISTING_RISK_EVENT_FACTS_JSON_SCHEMA,
  LISTING_RISK_EVENT_FACTS_VERSION,
  LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
  LISTING_SOURCE_FAMILIES,
  readListingRiskEventFacts,
  validateListingRiskEventFactEligibility,
  validateListingRiskEventFacts,
  type ListingBooleanFact,
  type ListingDateFact,
  type ListingDateStatus,
  type ListingEventKind,
  type ListingEventOutcome,
  type ListingFactPath,
  type ListingFactProvenance,
  type ListingRiskEventFacts,
  type ListingSourceEvidence,
  type ListingTextFact,
  type ListingValueQuality,
} from "./listingRiskFacts.ts";

const form25Fixtures = join(process.cwd(), "lib", "sources", "sec", "forms", "form25", "fixtures");
const currentReportFixtures = join(process.cwd(), "lib", "sources", "sec", "forms", "8k-6k", "fixtures");

test("Form 25 adverse removal preserves notice, suspension, and removal roles", () => {
  const { facts, parsed, sourceRef } = form25Event(
    "common-share-delisting",
    "listing_removal",
    "adverse",
  );

  facts.listing_requirement = availableText(
    "Nasdaq Listing Rules 5101, 5110(b), and IM-5101-1",
    sourceRef,
  );
  facts.affected_security.security_basis = availableText("common_equity", sourceRef);
  facts.proceeding = { kind: "appeal", status: "not_pursued", source_ref: sourceRef };
  facts.dates.notice_date = availableDate("2024-07-30", "occurred", sourceRef);
  facts.dates.trading_suspension_date = dateFromField(
    parsed.facts.trading_suspension_date,
    "occurred",
    sourceRef,
  );
  facts.dates.removal_effective_date = dateFromField(
    parsed.facts.delisting_or_removal_date,
    "scheduled",
    sourceRef,
  );

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.affected_security.security_basis.value, "common_equity");
  assert.equal(facts.dates.trading_suspension_date.value, "2024-08-08");
  assert.equal(facts.dates.removal_effective_date.value, "2024-09-16");
  assert.notEqual(facts.dates.trading_suspension_date.value, facts.dates.removal_effective_date.value);
});

test("completed-merger Form 25 is a procedural listing removal, not automatic adverse risk", () => {
  const { facts, parsed, sourceRef } = form25Event(
    "merger-completion-removal",
    "listing_removal",
    "procedural",
  );
  facts.dates.trading_suspension_date = dateFromField(
    parsed.facts.trading_suspension_date,
    "occurred",
    sourceRef,
  );
  facts.dates.removal_effective_date = dateFromField(
    parsed.facts.delisting_or_removal_date,
    "scheduled",
    sourceRef,
  );

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.classification.event_kind, "listing_removal");
  assert.equal(facts.classification.event_outcome, "procedural");
});

test("security-retirement Form 25 remains security-scoped and procedural", () => {
  const { facts, parsed, sourceRef } = form25Event(
    "matured-debt-removal",
    "listing_removal",
    "procedural",
  );
  facts.dates.trading_suspension_date = dateFromField(
    parsed.facts.trading_suspension_date,
    "occurred",
    sourceRef,
  );
  facts.dates.removal_effective_date = dateFromField(
    parsed.facts.delisting_or_removal_date,
    "scheduled",
    sourceRef,
  );
  facts.affected_security.security_basis = availableText("senior_notes", sourceRef);

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.match(facts.affected_security.title.value || "", /Senior Notes/);
  assert.equal(facts.affected_security.security_basis.value, "senior_notes");
  assert.equal(facts.classification.event_outcome, "procedural");
});

test("voluntary Form 25 preserves confirmed continued listing without an adverse requirement", () => {
  const { facts, sourceRef } = form25Event(
    "voluntary-withdrawal-continued-listing",
    "voluntary_withdrawal",
    "procedural",
  );
  facts.continued_trading = {
    continues: availableBoolean(true, sourceRef),
    venue: availableText("New York Stock Exchange", sourceRef),
  };

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.continued_trading.continues.value, true);
  assert.equal(facts.continued_trading.venue.value, "New York Stock Exchange");
});

test("8-K deficiency preserves a relative cure period without inventing a deadline", () => {
  const fixture = readJson(join(currentReportFixtures, "listing-risk-8k.json"));
  const facts = secCurrentReportEvent(fixture, "deficiency_notice", "adverse", "Nasdaq", "Common Stock");
  const sourceRef = facts.classification.source_ref;
  facts.listing_requirement = availableText("Minimum bid price requirement", sourceRef);
  facts.compliance_period = availableText("180 calendar days", sourceRef);
  facts.dates.notice_date = availableDate("2026-05-01", "occurred", sourceRef);

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.dates.compliance_deadline.availability, "unavailable");
  assert.equal(facts.dates.compliance_deadline.value, null);
});

test("8-K delisting determination preserves a conditional suspension and intended hearing", () => {
  const fixture = readJson(join(currentReportFixtures, "exchange-delisting-8k.json"));
  const facts = secCurrentReportEvent(
    fixture,
    "delisting_determination",
    "adverse",
    "Nasdaq",
    "Common Stock",
  );
  const sourceRef = facts.classification.source_ref;
  facts.listing_rule = availableText("Nasdaq Listing Rule 5550(a)(2)", sourceRef);
  facts.listing_requirement = availableText("Minimum bid price requirement", sourceRef);
  facts.proceeding = { kind: "hearing", status: "intended", source_ref: sourceRef };
  facts.dates.notice_date = availableDate("2026-04-10", "occurred", sourceRef);
  facts.dates.trading_suspension_date = availableDate("2026-04-15", "conditional", sourceRef);

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.dates.trading_suspension_date.date_status, "conditional");
  assert.equal(facts.dates.removal_effective_date.availability, "unavailable");
});

test("8-K voluntary withdrawal can preserve expected OTC trading without claiming certainty", () => {
  const fixture = readJson(join(currentReportFixtures, "voluntary-delisting-8k.json"));
  const facts = secCurrentReportEvent(
    fixture,
    "voluntary_withdrawal",
    "unknown",
    "New York Stock Exchange",
    "Common Stock",
    "On March 4, 2026",
  );
  const sourceRef = facts.classification.source_ref;
  facts.continued_trading = {
    continues: availableBoolean(true, sourceRef, "estimated"),
    venue: availableText("OTC market", sourceRef, "estimated"),
  };

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.classification.event_outcome, "unknown");
  assert.equal(facts.continued_trading.venue.value_quality, "estimated");
});

test("merger-closing 8-K removal mechanics remain procedural", () => {
  const fixture = readJson(join(currentReportFixtures, "merger-closing-delisting-8k.json"));
  const facts = secCurrentReportEvent(
    fixture,
    "listing_removal",
    "procedural",
    "Nasdaq",
    "Common Stock",
  );
  facts.dates.trading_suspension_date = availableDate(
    "2026-02-21",
    "scheduled",
    facts.classification.source_ref,
  );

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.classification.event_outcome, "procedural");
});

test("missing Form 25 facts remain explicitly unavailable and unknown", () => {
  const { facts } = form25Event("missing-reason-requires-llm", "other", "unknown");

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(facts.listing_rule.value, null);
  assert.equal(facts.listing_rule.availability, "unavailable");
  assert.equal(facts.dates.removal_effective_date.date_status, "unknown");
  assert.equal(facts.proceeding.status, "unknown");
});

test("validator enforces only mechanical availability, date, evidence, enum, and shape rules", () => {
  const fixture = readJson(join(currentReportFixtures, "listing-risk-8k.json"));
  const facts = secCurrentReportEvent(fixture, "deficiency_notice", "adverse", "Nasdaq", "Common Stock");
  const sourceRef = facts.classification.source_ref;

  const unavailableWithValue = clone(facts);
  unavailableWithValue.compliance_period = {
    value: "180 calendar days",
    availability: "unavailable",
    value_quality: "unknown",
    source_ref: null,
  };
  assert.ok(validateListingRiskEventFacts(unavailableWithValue).some((error) => error.includes("unavailable facts")));

  const invalidDate = clone(facts);
  invalidDate.dates.notice_date = availableDate("2026-02-30", "occurred", sourceRef);
  assert.ok(validateListingRiskEventFacts(invalidDate).some((error) => error.includes("valid YYYY-MM-DD")));

  const foreignEvidence = clone(facts);
  foreignEvidence.exchange.source_ref = "missing-source";
  assert.ok(validateListingRiskEventFacts(foreignEvidence).some((error) => error.includes("supplied source")));

  const longEvidence = clone(facts);
  longEvidence.sources[0].evidence = "x".repeat(LISTING_SOURCE_EVIDENCE_MAX_LENGTH + 1);
  assert.deepEqual(validateListingRiskEventFactEligibility(longEvidence), []);
  assert.ok(
    validateListingRiskEventFacts(longEvidence).some((error) =>
      error.includes(`${LISTING_SOURCE_EVIDENCE_MAX_LENGTH} characters or fewer`),
    ),
  );

  const unavailableEvidence = clone(facts);
  unavailableEvidence.sources[0].evidence = null;
  assert.deepEqual(validateListingRiskEventFacts(unavailableEvidence), []);

  const extraField = clone(facts) as ListingRiskEventFacts & { current_listing_state?: string };
  extraField.current_listing_state = "listed";
  assert.ok(validateListingRiskEventFacts(extraField).some((error) => error.includes("must contain exactly")));
});

test("V2 requires complete unique provenance for semantic facts but not unavailable facts or metadata", () => {
  const fixture = readJson(join(currentReportFixtures, "listing-risk-8k.json"));
  const facts = secCurrentReportEvent(fixture, "deficiency_notice", "adverse", "Nasdaq", "Common Stock");
  const paths = facts.fact_provenance.map((entry) => entry.fact_path);
  assert.ok(paths.includes("classification.event_kind"));
  assert.ok(paths.includes("classification.event_outcome"));
  assert.ok(paths.includes("exchange.value"));
  assert.equal(paths.some((path) => /confidence|availability|value_quality|source_ref/.test(path)), false);
  assert.equal(paths.some((path) => String(path) === "as_of.value"), false);
  assert.equal(paths.includes("listing_rule.value"), false);

  const missing = clone(facts);
  missing.fact_provenance = missing.fact_provenance.filter((entry) => entry.fact_path !== "classification.event_kind");
  assert.match(validateListingRiskEventFacts(missing).join("; "), /missing available fact_path classification\.event_kind/);

  const duplicate = clone(facts);
  duplicate.fact_provenance.push(clone(duplicate.fact_provenance[0]));
  assert.match(validateListingRiskEventFacts(duplicate).join("; "), /fact_path must be unique/);
});

test("origin is independent from value_quality and deterministic provenance requires formula lineage", () => {
  const fixture = readJson(join(currentReportFixtures, "listing-risk-8k.json"));
  const facts = secCurrentReportEvent(fixture, "deficiency_notice", "adverse", "Nasdaq", "Common Stock");
  const ref = facts.classification.source_ref;
  facts.affected_security.security_basis = availableText("common_equity", ref, "derived");
  const securityBasis = facts.fact_provenance.find((entry) =>
    entry.fact_path === "affected_security.security_basis.value"
  );
  assert.equal(securityBasis?.origin, "domain_interpreted");
  assert.deepEqual(validateListingRiskEventFacts(facts), []);

  const derived = clone(facts);
  const exchange = derived.fact_provenance.find((entry) => entry.fact_path === "exchange.value");
  assert.ok(exchange);
  Object.assign(exchange, {
    origin: "deterministic_derived",
    source_ref: null,
    evidence: null,
    evidence_status: "unavailable",
    evidence_issue: "not_provided",
    formula_id: "canonical_exchange_from_classification_v1",
    input_fact_paths: ["classification.event_kind"],
  });
  assert.deepEqual(validateListingRiskEventFacts(derived), []);

  const missingFormula = clone(derived);
  const invalid = missingFormula.fact_provenance.find((entry) => entry.fact_path === "exchange.value");
  assert.ok(invalid);
  invalid.formula_id = null;
  assert.match(validateListingRiskEventFacts(missingFormula).join("; "), /requires formula_id/);
});

test("fact evidence unavailable issues preserve eligible facts while invalid source_ref hard fails", () => {
  const fixture = readJson(join(currentReportFixtures, "listing-risk-8k.json"));
  const facts = secCurrentReportEvent(fixture, "deficiency_notice", "adverse", "Nasdaq", "Common Stock");
  for (const issue of ["too_long", "not_exact_span", "not_provided"] as const) {
    const unavailable = clone(facts);
    const entry = unavailable.fact_provenance[0];
    entry.evidence = null;
    entry.evidence_status = "unavailable";
    entry.evidence_issue = issue;
    assert.deepEqual(validateListingRiskEventFacts(unavailable), []);
  }

  const wrongRef = clone(facts);
  wrongRef.fact_provenance[0].source_ref = "missing-source";
  assert.match(validateListingRiskEventFacts(wrongRef).join("; "), /supplied source/);
});

test("validator does not infer event kind or outcome from rule number, form, or removal mechanics", () => {
  const fixture = readJson(join(currentReportFixtures, "exchange-delisting-8k.json"));
  const facts = secCurrentReportEvent(fixture, "other", "unknown", "Nasdaq", "Common Stock");
  facts.listing_rule = availableText("Nasdaq Listing Rule 5550(a)(2)", facts.classification.source_ref);

  assert.deepEqual(validateListingRiskEventFacts(facts), []);
  assert.equal(readListingRiskEventFacts(facts)?.classification.event_kind, "other");
  assert.equal(readListingRiskEventFacts(facts)?.classification.event_outcome, "unknown");
});

test("schema exposes the same event-fact version and excludes current-state storage fields", () => {
  assert.deepEqual(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.version.enum, [
    LISTING_RISK_EVENT_FACTS_VERSION,
  ]);
  assert.equal(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.additionalProperties, false);
  assert.equal(Object.hasOwn(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties, "current_listing_state"), false);
  assert.equal(Object.hasOwn(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties, "reverse_split"), false);
  assert.deepEqual(
    LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.affected_security.required,
    ["title", "ticker", "security_basis"],
  );
  assert.equal(
    LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.sources.items.properties.evidence.maxLength,
    LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
  );
  assert.deepEqual(
    LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.sources.items.properties.evidence.type,
    ["string", "null"],
  );

  const { facts } = form25Event("common-share-delisting", "listing_removal", "adverse");
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA, facts);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.classification, facts.classification);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.exchange, facts.exchange);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.affected_security, facts.affected_security);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.proceeding, facts.proceeding);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.dates, facts.dates);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.continued_trading, facts.continued_trading);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.as_of, facts.as_of);
  assertSchemaRequiredKeys(LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.sources.items, facts.sources[0]);
});

test("news is a first-class provenance family and required security fields match runtime validation", () => {
  assert.deepEqual(LISTING_SOURCE_FAMILIES, ["sec", "nasdaq", "news", "other"]);
  assert.deepEqual(
    LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.sources.items.properties.source_family.enum,
    LISTING_SOURCE_FAMILIES,
  );

  const { facts } = form25Event("common-share-delisting", "listing_removal", "adverse");
  facts.sources = facts.sources.map((source) => ({ ...source, source_family: "news" }));
  assert.deepEqual(validateListingRiskEventFacts(facts), []);

  const missingSecurityBasis = clone(facts) as unknown as Record<string, unknown>;
  delete (missingSecurityBasis.affected_security as Record<string, unknown>).security_basis;
  assert.ok(
    validateListingRiskEventFacts(missingSecurityBasis).some((error) =>
      error.includes("affected_security must contain exactly"),
    ),
  );
});

function form25Event(name: string, eventKind: ListingEventKind, eventOutcome: ListingEventOutcome) {
  const fixture = readJson(join(form25Fixtures, `${name}.json`));
  const parsed = parseSecForm25Filing(fixture);
  const sourceRef = parsed.raw.directSourceBlocks[0]?.source_ref;
  assert.ok(sourceRef, `${name} must expose an existing stable source_ref`);
  const sources = parsed.raw.directSourceBlocks.map((block): ListingSourceEvidence => ({
    source_family: "sec",
    source_id: parsed.accessionNumber,
    source_url: stringOrNull(fixture.sourceUrl),
    source_ref: block.source_ref,
    evidence: compactEvidence(block.text),
  }));
  const facts = emptyEventFacts({
    eventKind,
    eventOutcome,
    sourceRef,
    sources,
    asOf: parsed.facts.filed_at,
  });
  facts.exchange = textFromField(parsed.facts.exchange, sourceRef);
  facts.affected_security.title = textFromField(parsed.facts.removed_security, sourceRef);
  facts.affected_security.ticker = textFromField(parsed.facts.primary_ticker, sourceRef);
  facts.listing_rule = textFromField(parsed.facts.rule_provision, sourceRef);
  return { fixture, parsed, facts, sourceRef };
}

function secCurrentReportEvent(
  fixture: Record<string, unknown>,
  eventKind: ListingEventKind,
  eventOutcome: ListingEventOutcome,
  exchange: string,
  securityTitle: string,
  evidenceAnchor?: string,
) {
  const sourceId = stringOrNull(fixture.sourceUniqueId);
  const sourceUrl = stringOrNull(fixture.sourceUrl);
  const bodyText = String(fixture.bodyText || "");
  assert.match(bodyText, /Item 3\.01|voluntary delisting/i);
  const sourceRef = bodyText.includes("Item 3.01") ? "Item 3.01" : "Item 8.01";
  const evidence = compactEvidence(bodyText, evidenceAnchor || sourceRef);
  const facts = emptyEventFacts({
    eventKind,
    eventOutcome,
    sourceRef,
    sources: [{ source_family: "sec", source_id: sourceId, source_url: sourceUrl, source_ref: sourceRef, evidence }],
    asOf: String(fixture.publishedAt || "").slice(0, 10),
  });
  facts.exchange = availableText(exchange, sourceRef);
  facts.affected_security.title = availableText(securityTitle, sourceRef);
  const rawPayload = object(fixture.rawPayload);
  facts.affected_security.ticker = rawPayload && typeof rawPayload.ticker === "string"
    ? availableText(rawPayload.ticker, sourceRef)
    : unavailableText();
  return facts;
}

function emptyEventFacts({
  eventKind,
  eventOutcome,
  sourceRef,
  sources,
  asOf,
}: {
  eventKind: ListingEventKind;
  eventOutcome: ListingEventOutcome;
  sourceRef: string;
  sources: ListingSourceEvidence[];
  asOf: string | null;
}): ListingRiskEventFacts {
  const facts: ListingRiskEventFacts = {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: { event_kind: eventKind, event_outcome: eventOutcome, source_ref: sourceRef },
    exchange: unavailableText(),
    affected_security: { title: unavailableText(), ticker: unavailableText(), security_basis: unavailableText() },
    listing_rule: unavailableText(),
    listing_requirement: unavailableText(),
    compliance_period: unavailableText(),
    proceeding: { kind: "unknown", status: "unknown", source_ref: null },
    dates: {
      notice_date: unavailableDate(),
      compliance_deadline: unavailableDate(),
      hearing_date: unavailableDate(),
      appeal_deadline: unavailableDate(),
      trading_suspension_date: unavailableDate(),
      removal_effective_date: unavailableDate(),
    },
    continued_trading: { continues: unavailableBoolean(), venue: unavailableText() },
    as_of: asOf ? availableDate(asOf, "occurred", sourceRef) : unavailableDate(),
    confidence: "high",
    sources,
    fact_provenance: [],
  };
  Object.defineProperty(facts, "fact_provenance", {
    enumerable: true,
    configurable: true,
    get: () => buildFactProvenance(facts),
  });
  return facts;
}

function buildFactProvenance(facts: ListingRiskEventFacts): ListingFactProvenance[] {
  const entries: ListingFactProvenance[] = [];
  const add = (
    factPath: ListingFactPath,
    sourceRef: string,
    origin: "source_stated" | "domain_interpreted" = "source_stated",
  ) => {
    const source = facts.sources.find((item) => item.source_ref === sourceRef);
    entries.push({
      fact_path: factPath,
      origin,
      source_ref: sourceRef,
      evidence: source?.evidence ?? null,
      evidence_status: source?.evidence ? "available" : "unavailable",
      evidence_issue: source?.evidence ? null : "not_provided",
      confidence: "high",
      as_of: facts.as_of.value,
      formula_id: null,
      input_fact_paths: [],
    });
  };
  add("classification.event_kind", facts.classification.source_ref, "domain_interpreted");
  add("classification.event_outcome", facts.classification.source_ref, "domain_interpreted");
  const addEnvelope = (fact: { availability: string; source_ref: string | null }, path: ListingFactPath, origin?: "source_stated" | "domain_interpreted") => {
    if (fact.availability === "available" && fact.source_ref) add(path, fact.source_ref, origin);
  };
  addEnvelope(facts.exchange, "exchange.value");
  addEnvelope(facts.affected_security.title, "affected_security.title.value");
  addEnvelope(facts.affected_security.ticker, "affected_security.ticker.value");
  addEnvelope(facts.affected_security.security_basis, "affected_security.security_basis.value", "domain_interpreted");
  addEnvelope(facts.listing_rule, "listing_rule.value");
  addEnvelope(facts.listing_requirement, "listing_requirement.value");
  addEnvelope(facts.compliance_period, "compliance_period.value");
  if (facts.proceeding.kind !== "unknown" && facts.proceeding.source_ref) add("proceeding.kind", facts.proceeding.source_ref, "domain_interpreted");
  if (facts.proceeding.status !== "unknown" && facts.proceeding.source_ref) add("proceeding.status", facts.proceeding.source_ref, "domain_interpreted");
  addEnvelope(facts.dates.notice_date, "dates.notice_date.value");
  addEnvelope(facts.dates.compliance_deadline, "dates.compliance_deadline.value");
  addEnvelope(facts.dates.hearing_date, "dates.hearing_date.value");
  addEnvelope(facts.dates.appeal_deadline, "dates.appeal_deadline.value");
  addEnvelope(facts.dates.trading_suspension_date, "dates.trading_suspension_date.value");
  addEnvelope(facts.dates.removal_effective_date, "dates.removal_effective_date.value");
  addEnvelope(facts.continued_trading.continues, "continued_trading.continues.value");
  addEnvelope(facts.continued_trading.venue, "continued_trading.venue.value");
  return entries;
}

function textFromField(field: SecForm25Field<string> | null, sourceRef: string): ListingTextFact {
  return field ? availableText(field.value, sourceRef) : unavailableText();
}

function dateFromField(
  field: SecForm25Field<string> | null,
  status: ListingDateStatus,
  sourceRef: string,
): ListingDateFact {
  return field ? availableDate(field.value, status, sourceRef) : unavailableDate();
}

function availableText(
  value: string,
  sourceRef: string,
  quality: ListingValueQuality = "exact",
): ListingTextFact {
  return { value, availability: "available", value_quality: quality, source_ref: sourceRef };
}

function unavailableText(): ListingTextFact {
  return { value: null, availability: "unavailable", value_quality: "unknown", source_ref: null };
}

function availableBoolean(
  value: boolean,
  sourceRef: string,
  quality: ListingValueQuality = "exact",
): ListingBooleanFact {
  return { value, availability: "available", value_quality: quality, source_ref: sourceRef };
}

function unavailableBoolean(): ListingBooleanFact {
  return { value: null, availability: "unavailable", value_quality: "unknown", source_ref: null };
}

function availableDate(value: string, status: ListingDateStatus, sourceRef: string): ListingDateFact {
  return {
    value,
    availability: "available",
    value_quality: "exact",
    date_status: status,
    source_ref: sourceRef,
  };
}

function unavailableDate(): ListingDateFact {
  return {
    value: null,
    availability: "unavailable",
    value_quality: "unknown",
    date_status: "unknown",
    source_ref: null,
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactEvidence(value: string, anchor?: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const anchorIndex = anchor ? normalized.indexOf(anchor) : -1;
  const relevant = anchorIndex >= 0 ? normalized.slice(anchorIndex) : normalized;
  const characters = Array.from(relevant);
  if (characters.length <= LISTING_SOURCE_EVIDENCE_MAX_LENGTH) return relevant;
  return `${characters.slice(0, LISTING_SOURCE_EVIDENCE_MAX_LENGTH - 3).join("").trimEnd()}...`;
}

function assertSchemaRequiredKeys(schema: { required: readonly string[] }, value: object) {
  assert.deepEqual([...schema.required].sort(), Object.keys(value).sort());
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
