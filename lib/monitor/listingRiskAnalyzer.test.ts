import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LISTING_RISK_EVENT_FACTS_JSON_SCHEMA,
  LISTING_RISK_EVENT_FACTS_VERSION,
  type ListingFactPath,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  canonicalizeListingRiskAnalyzerTransportResult,
  LISTING_RISK_ANALYZER_INPUT_VERSION,
  LISTING_RISK_ANALYZER_PROMPT_VERSION,
  LISTING_RISK_ANALYZER_PROVIDER_SCHEMA,
  LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH,
  normalizeListingRiskAnalyzerProviderResult,
  readListingRiskAnalyzerResult,
  type ListingRiskAnalyzerInput,
  type ListingRiskAnalyzerTransportResult,
  validateListingRiskAnalyzerInput,
  validateListingRiskAnalyzerProviderResult,
  validateListingRiskAnalyzerResult,
  validateListingRiskAnalyzerTransportResult,
} from "./listingRiskAnalyzer.ts";
import { buildListingRiskEvidenceRepairPlan } from "./listingRiskEvidenceRepair.ts";
import {
  adaptNasdaqListingRiskSource,
  adaptNewsListingRiskSource,
  adaptSec8k6kListingRiskSource,
} from "./listingRiskSourceAdapters.ts";
import {
  buildListingRiskDomainAnalysisPrompt,
  LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT,
} from "../prompts/listingRiskDomainAnalysis.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("public result mechanically enforces applicable facts or standalone not_applicable", () => {
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const facts = validFacts(input, "news_article_body", input.source_documents[0].text);

  assert.deepEqual(validateListingRiskAnalyzerResult({ status: "applicable", facts }), []);
  assert.deepEqual(validateListingRiskAnalyzerResult({ status: "not_applicable" }), []);
  assert.equal(readListingRiskAnalyzerResult({ status: "applicable", facts })?.status, "applicable");
  assert.equal(readListingRiskAnalyzerResult({ status: "not_applicable" })?.status, "not_applicable");

  assert.notDeepEqual(validateListingRiskAnalyzerResult({ status: "not_applicable", facts }), []);
  assert.notDeepEqual(validateListingRiskAnalyzerResult({ status: "applicable" }), []);
  assert.notDeepEqual(validateListingRiskAnalyzerResult({ status: "failed" }), []);
});

test("provider transport is materially simpler than canonical V2 and rejects impossible mixed states", () => {
  const metrics = schemaMetrics(LISTING_RISK_ANALYZER_PROVIDER_SCHEMA);
  assert.deepEqual(metrics, {
    properties: 17,
    required: 17,
    enumValues: 4,
    nullable: 1,
    objects: 3,
    arrays: 2,
    maxDepth: 3,
    serializedBytes: 971,
  });
  assert.ok(metrics.properties < 20);
  assert.ok(metrics.nullable < 2);
  assert.ok(metrics.serializedBytes < 2_000);
  assert.doesNotMatch(JSON.stringify(LISTING_RISK_ANALYZER_PROVIDER_SCHEMA), /additionalProperties|"type":\[/);
  assert.doesNotMatch(JSON.stringify(LISTING_RISK_ANALYZER_PROVIDER_SCHEMA), /fact_provenance|evidence_status|evidence_issue|formula_id|input_fact_paths|listing_risk_event_facts_v2/);
  assert.deepEqual(LISTING_RISK_ANALYZER_PROVIDER_SCHEMA.required, ["status", "facts", "as_of_facts", "confidence"]);
  assert.deepEqual(
    [...new Set(Object.values(LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH))].sort(),
    [...LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.fact_provenance.items.properties.fact_path.enum].sort(),
  );
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const facts = validFacts(input, "news_article_body", input.source_documents[0].text);

  const applicable = transportFromFacts(facts);
  const notApplicable = { status: "not_applicable", facts: [], as_of_facts: [], confidence: "unknown" };
  assert.deepEqual(validateListingRiskAnalyzerTransportResult(applicable, input), []);
  assert.deepEqual(validateListingRiskAnalyzerTransportResult(notApplicable, input), []);
  assert.deepEqual(canonicalizeListingRiskAnalyzerTransportResult(applicable, input).result, {
    status: "applicable",
    applicable_facts: [{
      ...facts,
      sources: facts.sources.map((source) => ({ ...source, evidence: null })),
    }],
  });
  assert.deepEqual(canonicalizeListingRiskAnalyzerTransportResult(notApplicable, input).result, {
    status: "not_applicable",
    applicable_facts: [],
  });

  assert.notDeepEqual(
    validateListingRiskAnalyzerTransportResult({
      status: "not_applicable",
      facts: applicable.facts,
      as_of_facts: [],
      confidence: "unknown",
    }, input),
    [],
  );
  assert.notDeepEqual(
    validateListingRiskAnalyzerTransportResult({
      status: "applicable",
      facts: [],
      as_of_facts: [],
      confidence: "unknown",
    }, input),
    [],
  );
});

test("provider facts must remain valid and cite the supplied source identity", () => {
  const input = newsInput("Nasdaq notified Example Corp that it regained compliance on 2026-05-01.");
  const facts = validFacts(input, "news_article_body", "regained compliance on 2026-05-01");
  assert.deepEqual(validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [facts] }, input), []);

  const wrongIdentity = structuredClone(facts);
  wrongIdentity.sources[0].source_id = "different-source";
  assert.ok(
    validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [wrongIdentity] }, input)
      .some((error) => error.includes("source_id must match")),
  );

  const canonicalEvidence = structuredClone(facts);
  canonicalEvidence.sources[0].evidence = null;
  assert.deepEqual(validateListingRiskAnalyzerResult({ status: "applicable", facts: canonicalEvidence }), []);
  assert.deepEqual(
    validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [canonicalEvidence] }, input),
    [],
    "mechanically reconstructed source-level compatibility evidence may be null",
  );

  const nonContiguousEvidence = structuredClone(facts);
  nonContiguousEvidence.sources[0].evidence = "Nasdaq notified Example Corp that it regained compliance.";
  assert.ok(
    validateListingRiskAnalyzerProviderResult(
      { status: "applicable", applicable_facts: [nonContiguousEvidence] },
      input,
    ).some((error) => error.includes("contiguous excerpt")),
  );

  const invalidFacts = structuredClone(facts) as unknown as Record<string, unknown>;
  delete invalidFacts.dates;
  assert.ok(
    validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [invalidFacts] }, input)
      .some((error) => error.includes("listing_risk_event_facts must contain exactly")),
  );
});

test("available-only generic transport maps omissions to unavailable and fails closed on duplicate or unknown keys", () => {
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const transport = transportFromFacts(validFacts(input, "news_article_body", input.source_documents[0].text));

  const canonical = canonicalizeListingRiskAnalyzerTransportResult(transport, input).result;
  assert.equal(canonical?.applicable_facts[0].exchange.availability, "unavailable");
  assert.equal(canonical?.applicable_facts[0].exchange.value, null);

  const duplicate = structuredClone(transport);
  duplicate.facts.push(structuredClone(duplicate.facts[0]));
  assert.match(validateListingRiskAnalyzerTransportResult(duplicate, input).join("; "), /key must be unique/);

  const unknown = structuredClone(transport) as any;
  unknown.facts[0].key = "unknown_fact";
  assert.match(validateListingRiskAnalyzerTransportResult(unknown, input).join("; "), /facts\[0\]\.key is invalid/);

  const missingClassification = structuredClone(transport);
  missingClassification.facts = missingClassification.facts.filter((row) => row.key !== "classification_event_outcome");
  assert.match(validateListingRiskAnalyzerTransportResult(missingClassification, input).join("; "), /missing required key classification_event_outcome/);

  const wrongSourceRef = structuredClone(transport);
  wrongSourceRef.facts[0].source_ref = "missing-document";
  assert.match(validateListingRiskAnalyzerTransportResult(wrongSourceRef, input).join("; "), /source_ref must identify a supplied source document/);

  const providerDerived = structuredClone(transport) as any;
  providerDerived.facts[0].origin = "deterministic_derived";
  assert.match(validateListingRiskAnalyzerTransportResult(providerDerived, input).join("; "), /origin is invalid/);
});

test("source family, id, url, and document identity mismatches remain hard failures", () => {
  const input = newsInput("Nasdaq notified Example Corp that it regained compliance on 2026-05-01.");
  const original = validFacts(input, "news_article_body", "regained compliance on 2026-05-01");
  const cases: Array<[string, (facts: ListingRiskEventFacts) => void]> = [
    ["source_family", (facts) => { facts.sources[0].source_family = "sec"; }],
    ["source_id", (facts) => { facts.sources[0].source_id = "wrong-id"; }],
    ["source_url", (facts) => { facts.sources[0].source_url = "https://example.com/wrong"; }],
    ["source_ref", (facts) => {
      facts.sources[0].source_ref = "missing-document";
      facts.classification.source_ref = "missing-document";
    }],
  ];

  for (const [field, mutate] of cases) {
    const facts = structuredClone(original);
    mutate(facts);
    assert.ok(
      validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [facts] }, input)
        .some((error) => error.includes(field)),
      `${field} mismatch must fail provider validation`,
    );
    assert.equal(
      buildListingRiskEvidenceRepairPlan({ status: "applicable", applicable_facts: [facts] }, input),
      null,
      `${field} mismatch must not enter evidence repair`,
    );
  }

  const wrongFactSource = structuredClone(original);
  wrongFactSource.fact_provenance[0].source_ref = "missing-document";
  assert.match(
    validateListingRiskAnalyzerProviderResult(
      { status: "applicable", applicable_facts: [wrongFactSource] },
      input,
    ).join("; "),
    /fact_provenance\[0\]\.source_ref must identify a supplied source document/,
  );
  assert.equal(
    buildListingRiskEvidenceRepairPlan({ status: "applicable", applicable_facts: [wrongFactSource] }, input),
    null,
  );

  const providerDerived = structuredClone(original);
  Object.assign(providerDerived.fact_provenance[0], {
    origin: "deterministic_derived",
    source_ref: null,
    evidence: null,
    evidence_status: "unavailable",
    evidence_issue: "not_provided",
    formula_id: "not-provider-owned",
    input_fact_paths: ["classification.event_outcome"],
  });
  assert.match(
    validateListingRiskAnalyzerProviderResult(
      { status: "applicable", applicable_facts: [providerDerived] },
      input,
    ).join("; "),
    /cannot be deterministic_derived in analyzer provider output/,
  );
});

test("provider-controlled condition fields remain complete and unchanged for a representative source", () => {
  const input = newsInput(
    "On May 1, 2026, Nasdaq notified Example Corp that its Common Stock was deficient under Nasdaq Listing Rule 5550(a)(2). The company has until October 28, 2026 to regain compliance.",
  );
  const sourceRef = input.source_documents[0].source_ref;
  const evidence = input.source_documents[0].text;
  const facts = validFacts(input, sourceRef, evidence);
  const availableText = (value: string) => ({
    value,
    availability: "available" as const,
    value_quality: "exact" as const,
    source_ref: sourceRef,
  });
  const availableDate = (value: string) => ({
    ...availableText(value),
    date_status: "occurred" as const,
  });
  facts.classification = { event_kind: "deficiency_notice", event_outcome: "adverse", source_ref: sourceRef };
  facts.exchange = availableText("Nasdaq");
  facts.listing_rule = availableText("Nasdaq Listing Rule 5550(a)(2)");
  facts.affected_security.title = availableText("Common Stock");
  facts.affected_security.security_basis = { ...availableText("common_stock"), value_quality: "derived" };
  facts.dates.notice_date = availableDate("2026-05-01");
  facts.dates.compliance_deadline = { ...availableDate("2026-10-28"), date_status: "scheduled" };
  facts.fact_provenance.push(
    factProvenance("exchange.value", sourceRef, evidence, "source_stated"),
    factProvenance("listing_rule.value", sourceRef, evidence, "source_stated"),
    factProvenance("affected_security.title.value", sourceRef, evidence, "source_stated"),
    factProvenance("affected_security.security_basis.value", sourceRef, evidence),
    factProvenance("dates.notice_date.value", sourceRef, evidence, "source_stated"),
    factProvenance("dates.compliance_deadline.value", sourceRef, evidence, "source_stated"),
  );

  const canonicalized = canonicalizeListingRiskAnalyzerTransportResult(transportFromFacts(facts), input);
  assert.deepEqual(canonicalized.errors, []);
  const result = normalizeListingRiskAnalyzerProviderResult(canonicalized.result, input);

  assert.equal(result?.status, "applicable");
  assert.deepEqual(result && result.status === "applicable" ? {
    exchange: result.facts.exchange,
    listing_rule: result.facts.listing_rule,
    security_title: result.facts.affected_security.title,
    security_basis: result.facts.affected_security.security_basis,
    notice_date: result.facts.dates.notice_date,
    compliance_deadline: result.facts.dates.compliance_deadline,
  } : null, {
    exchange: availableText("Nasdaq"),
    listing_rule: availableText("Nasdaq Listing Rule 5550(a)(2)"),
    security_title: availableText("Common Stock"),
    security_basis: { ...availableText("common_stock"), value_quality: "derived" },
    notice_date: availableDate("2026-05-01"),
    compliance_deadline: { ...availableDate("2026-10-28"), date_status: "scheduled" },
  });
  assert.equal(
    result && result.status === "applicable"
      ? result.facts.fact_provenance.find((entry) => entry.fact_path === "affected_security.security_basis.value")?.origin
      : null,
    "domain_interpreted",
    "value_quality derived must remain independent from LLM-owned origin",
  );
});

test("generic rows use explicit key-specific mechanical parsing without coercion", () => {
  const input = newsInput("Nasdaq scheduled a hearing on 2026-05-20 and continued trading remains true.");
  const sourceRef = input.source_documents[0].source_ref;
  const facts = validFacts(input, sourceRef, input.source_documents[0].text);
  facts.dates.hearing_date = {
    value: "2026-05-20",
    availability: "available",
    value_quality: "exact",
    date_status: "scheduled",
    source_ref: sourceRef,
  };
  facts.continued_trading.continues = {
    value: true,
    availability: "available",
    value_quality: "derived",
    source_ref: sourceRef,
  };
  facts.fact_provenance.push(
    factProvenance("dates.hearing_date.value", sourceRef, input.source_documents[0].text, "source_stated"),
    factProvenance("continued_trading.continues.value", sourceRef, input.source_documents[0].text),
  );
  facts.fact_provenance.at(-2)!.as_of = "2026-05-01";
  facts.as_of = {
    value: "2026-05-01",
    availability: "available",
    value_quality: "exact",
    date_status: "occurred",
    source_ref: sourceRef,
  };
  const transport = transportFromFacts(facts);
  assert.deepEqual(validateListingRiskAnalyzerTransportResult(transport, input), []);
  const canonical = canonicalizeListingRiskAnalyzerTransportResult(transport, input).result?.applicable_facts[0];
  assert.equal(canonical?.dates.hearing_date.date_status, "scheduled");
  assert.equal(canonical?.continued_trading.continues.value, true);
  assert.equal(canonical?.as_of.value, "2026-05-01");
  assert.equal(
    canonical?.fact_provenance.find((entry) => entry.fact_path === "dates.hearing_date.value")?.as_of,
    "2026-05-01",
  );

  const coercedBoolean = structuredClone(transport);
  const booleanRow = coercedBoolean.facts.find((row) => row.key === "continued_trading_continues");
  assert.ok(booleanRow);
  booleanRow.value = "TRUE";
  assert.match(validateListingRiskAnalyzerTransportResult(coercedBoolean, input).join("; "), /must be true or false/);

  const invalidDate = structuredClone(transport);
  const dateRow = invalidDate.facts.find((row) => row.key === "hearing_date");
  assert.ok(dateRow);
  dateRow.value = "May 20, 2026";
  assert.match(validateListingRiskAnalyzerTransportResult(invalidDate, input).join("; "), /must be YYYY-MM-DD/);

  const inferredQualifier = structuredClone(transport);
  const textRow = inferredQualifier.facts.find((row) => row.key === "continued_trading_continues");
  assert.ok(textRow);
  textRow.date_status = "occurred";
  assert.match(validateListingRiskAnalyzerTransportResult(inferredQualifier, input).join("; "), /date_status must be not_applicable/);
});

test("analyzer input bounds source packages without selecting listing semantics", () => {
  const input = newsInput("Arbitrary source body");
  assert.deepEqual(validateListingRiskAnalyzerInput(input), []);
  assert.notDeepEqual(validateListingRiskAnalyzerInput({ ...input, source_documents: [] }), []);
  assert.notDeepEqual(
    validateListingRiskAnalyzerInput({
      ...input,
      source_documents: [input.source_documents[0], input.source_documents[0]],
    }),
    [],
  );
});

test("News and Nasdaq adapters only load identity, formatting, and bounded Primary context", () => {
  const primary = {
    event_type: "listing_risk",
    summary: "Primary context only",
    monitor_routes: [{ monitor_analyzer_key: "listing_risk" }],
    parser_output: { forbidden: true },
  };
  const simpleSplit = adaptNewsListingRiskSource({
    source_unique_id: "news-1",
    source_url: "https://example.com/news-1",
    published_at: "2026-05-01T00:00:00Z",
    title: "Corporate update",
    body_text: "Company announces a 1-for-20 reverse split.",
    primary_analysis: primary,
  });
  const unrelated = adaptNewsListingRiskSource({
    source_unique_id: "news-1",
    source_url: "https://example.com/news-1",
    published_at: "2026-05-01T00:00:00Z",
    title: "Corporate update",
    body_text: "Company appoints a new director.",
    primary_analysis: primary,
  });
  assert.equal(simpleSplit.source_family, "news");
  assert.equal(simpleSplit.source_documents[0].text, "Company announces a 1-for-20 reverse split.");
  assert.deepEqual(simpleSplit.primary_context, {
    event_type: "listing_risk",
    summary: "Primary context only",
    monitor_routes: [{ monitor_analyzer_key: "listing_risk" }],
  });
  assert.deepEqual(
    { ...simpleSplit, source_documents: unrelated.source_documents },
    unrelated,
    "changing semantic text must not make the adapter add a verdict or facts",
  );
  assert.equal(Object.hasOwn(simpleSplit, "status"), false);
  assert.equal(Object.hasOwn(simpleSplit, "facts"), false);

  const nasdaq = adaptNasdaqListingRiskSource({
    source_unique_id: "nasdaq-1",
    source_url: "https://example.com/nasdaq-1",
    published_at: "2026-05-02",
    title: "Nasdaq notice",
    body_text: "Stored notice text",
  });
  assert.equal(nasdaq.source_family, "nasdaq");
  assert.equal(nasdaq.source_documents[0].text, "Stored notice text");
  assert.equal(Object.hasOwn(nasdaq, "status"), false);
});

test("SEC adapter preserves every prepared source block and uses stable block IDs as provenance", () => {
  const input = adaptSec8k6kListingRiskSource({
    accession_number: "0000000000-26-000001",
    source_url: "https://www.sec.gov/Archives/example",
    filed_at: "2026-05-03",
    title: "8-K",
    cleaned_source_blocks: [
      { block_id: "secblk_current", source_ref: "Item 3.01", label: "Current item", text: "Current filing text" },
      { block_id: "secblk_exhibit", source_ref: "Exhibit 99.1", label: "Press release", text: "Exhibit text" },
    ],
  });
  assert.equal(input.source_family, "sec");
  assert.deepEqual(input.source_documents, [
    { source_ref: "secblk_current", label: "Item 3.01", text: "Current filing text" },
    { source_ref: "secblk_exhibit", label: "Exhibit 99.1", text: "Exhibit text" },
  ]);
});

test("all supported source families use one analyzer fact and result contract", () => {
  for (const sourceFamily of ["news", "nasdaq", "sec"] as const) {
    const input = sourceFamily === "news"
      ? newsInput("Current source evidence")
      : sourceFamily === "nasdaq"
        ? adaptNasdaqListingRiskSource({
            source_unique_id: "nasdaq-qa",
            source_url: "https://example.com/nasdaq-qa",
            published_at: "2026-05-01",
            title: "Notice",
            body_text: "Current source evidence",
          })
        : adaptSec8k6kListingRiskSource({
            accession_number: "0000000000-26-000002",
            source_url: "https://www.sec.gov/Archives/example-2",
            filed_at: "2026-05-01",
            title: "6-K",
            cleaned_source_blocks: [{ block_id: "secblk_qa", text: "Current source evidence" }],
          });
    const sourceRef = input.source_documents[0].source_ref;
    const facts = validFacts(input, sourceRef, "Current source evidence");
    assert.deepEqual(validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [facts] }, input), []);
  }
});

test("shared semantic prompt defines current-event, reverse-split, recovery, procedural, and date boundaries", () => {
  assert.equal(LISTING_RISK_ANALYZER_PROMPT_VERSION, "listing_risk_domain_analyzer_v7");
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /primary_context[\s\S]+not evidence/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /historical deficiency[\s\S]+background/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /simple reverse split[\s\S]+not_applicable/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Regained compliance[\s\S]+recovered/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /planned[\s\S]+cure action[\s\S]+not a recovery/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /merger cleanup[\s\S]+procedural/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /trading suspension date[\s\S]+removal effective date[\s\S]+distinct/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Do not infer applicability from event_type/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /structured listing_risk_event_facts_v2 fields are the primary product output/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /fact_provenance is the authoritative fact-level provenance layer/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Do not create rows for root confidence, availability, source_ref, evidence status, or other metadata/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Emit AVAILABLE facts only[\s\S]+Never omit a supported condition-relevant fact/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Duplicate and unknown keys are invalid/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /return every available condition-relevant listing_risk_event_facts_v2 field[\s\S]+Continue through all supported facts/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Evidence supports those structured facts; evidence never replaces/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /source_document\.text\.includes\(evidence\) === true/);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /whitespace[\s\S]+Unicode[\s\S]+date formatting/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /smallest useful supporting span[\s\S]+150 to 280[\s\S]+520/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /schema-required mechanical representation[\s\S]+must not change/i);
  const prompt = buildListingRiskDomainAnalysisPrompt(newsInput("Source body"));
  assert.equal(prompt.version, "listing_risk_domain_analyzer_v7");
  assert.equal(prompt.responseFormat.json_schema.schema, LISTING_RISK_ANALYZER_PROVIDER_SCHEMA);
});

test("source adapters contain no parser-generated semantic result mapping", () => {
  const source = readFileSync(join(here, "listingRiskSourceAdapters.ts"), "utf8");
  assert.doesNotMatch(source, /event_kind|event_outcome|not_applicable|status\s*:|listing_rule|Rule\s+\d/i);
  assert.doesNotMatch(source, /\.includes\(|\.match\(|\.test\(|new RegExp/i);
});

function newsInput(text: string) {
  return adaptNewsListingRiskSource({
    source_unique_id: "news-source-1",
    source_url: "https://example.com/news-source-1",
    published_at: "2026-05-01T12:00:00Z",
    title: "Stored news article",
    body_text: text,
    primary_analysis: null,
  });
}

function validFacts(
  input: ListingRiskAnalyzerInput,
  sourceRef: string,
  evidence: string,
): ListingRiskEventFacts {
  const unavailableText = () => ({
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  });
  const unavailableDate = () => ({
    ...unavailableText(),
    date_status: "unknown" as const,
  });
  const unavailableBoolean = () => ({
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  });
  return {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: { event_kind: "other", event_outcome: "unknown", source_ref: sourceRef },
    exchange: unavailableText(),
    affected_security: {
      title: unavailableText(),
      ticker: unavailableText(),
      security_basis: unavailableText(),
    },
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
    as_of: unavailableDate(),
    confidence: "high",
    sources: [{
      source_family: input.source_family,
      source_id: input.source_id,
      source_url: input.source_url,
      source_ref: sourceRef,
      evidence,
    }],
    fact_provenance: [
      factProvenance("classification.event_kind", sourceRef, evidence),
      factProvenance("classification.event_outcome", sourceRef, evidence),
    ],
  };
}

function factProvenance(
  factPath: ListingFactPath,
  sourceRef: string,
  evidence: string,
  origin: "source_stated" | "domain_interpreted" = "domain_interpreted",
) {
  return {
    fact_path: factPath,
    origin,
    source_ref: sourceRef,
    evidence,
    evidence_status: "available" as const,
    evidence_issue: null,
    confidence: "high" as const,
    as_of: null,
    formula_id: null,
    input_fact_paths: [],
  };
}

function transportFromFacts(facts: ListingRiskEventFacts): ListingRiskAnalyzerTransportResult {
  const pathToKey = new Map(
    Object.entries(LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH).map(([key, path]) => [path, key]),
  );
  const providerFacts: any[] = [];
  for (const entry of facts.fact_provenance) {
    const key = pathToKey.get(entry.fact_path);
    assert.ok(key);
    const base = {
      key,
      origin: entry.origin,
      source_ref: entry.source_ref,
      evidence: entry.evidence,
      confidence: entry.confidence,
      as_of: entry.as_of,
    };
    if (entry.fact_path === "classification.event_kind") {
      providerFacts.push({ ...base, value: facts.classification.event_kind, value_quality: "not_applicable", date_status: "not_applicable" });
    } else if (entry.fact_path === "classification.event_outcome") {
      providerFacts.push({ ...base, value: facts.classification.event_outcome, value_quality: "not_applicable", date_status: "not_applicable" });
    } else if (entry.fact_path === "proceeding.kind") {
      providerFacts.push({ ...base, value: facts.proceeding.kind, value_quality: "not_applicable", date_status: "not_applicable" });
    } else if (entry.fact_path === "proceeding.status") {
      providerFacts.push({ ...base, value: facts.proceeding.status, value_quality: "not_applicable", date_status: "not_applicable" });
    } else {
      const envelope = envelopeForPath(facts, entry.fact_path);
      assert.ok(envelope);
      if (entry.fact_path === "continued_trading.continues.value") {
        providerFacts.push({
          ...base,
          value: String(envelope.value),
          value_quality: envelope.value_quality,
          date_status: "not_applicable",
        });
      } else if (entry.fact_path.startsWith("dates.")) {
        providerFacts.push({
          ...base,
          value: envelope.value,
          value_quality: envelope.value_quality,
          date_status: envelope.date_status,
        });
      } else {
        providerFacts.push({
          ...base,
          value: envelope.value,
          value_quality: envelope.value_quality,
          date_status: "not_applicable",
        });
      }
    }
  }
  return {
    status: "applicable",
    facts: providerFacts,
    as_of_facts: facts.as_of.availability === "available"
      ? [{
          value: facts.as_of.value as string,
          value_quality: facts.as_of.value_quality,
          date_status: facts.as_of.date_status,
          source_ref: facts.as_of.source_ref as string,
        }]
      : [],
    confidence: facts.confidence || "unknown",
  };
}

function envelopeForPath(facts: ListingRiskEventFacts, path: ListingFactPath): any {
  const values: Partial<Record<ListingFactPath, unknown>> = {
    "exchange.value": facts.exchange,
    "affected_security.title.value": facts.affected_security.title,
    "affected_security.ticker.value": facts.affected_security.ticker,
    "affected_security.security_basis.value": facts.affected_security.security_basis,
    "listing_rule.value": facts.listing_rule,
    "listing_requirement.value": facts.listing_requirement,
    "compliance_period.value": facts.compliance_period,
    "dates.notice_date.value": facts.dates.notice_date,
    "dates.compliance_deadline.value": facts.dates.compliance_deadline,
    "dates.hearing_date.value": facts.dates.hearing_date,
    "dates.appeal_deadline.value": facts.dates.appeal_deadline,
    "dates.trading_suspension_date.value": facts.dates.trading_suspension_date,
    "dates.removal_effective_date.value": facts.dates.removal_effective_date,
    "continued_trading.continues.value": facts.continued_trading.continues,
    "continued_trading.venue.value": facts.continued_trading.venue,
  };
  return values[path];
}

function schemaMetrics(schema: unknown) {
  const result = {
    properties: 0,
    required: 0,
    enumValues: 0,
    nullable: 0,
    objects: 0,
    arrays: 0,
    maxDepth: 0,
    serializedBytes: Buffer.byteLength(JSON.stringify(schema), "utf8"),
  };
  const walk = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    result.maxDepth = Math.max(result.maxDepth, depth);
    if (node.type === "object" || node.properties) result.objects += 1;
    if (node.type === "array" || node.items) result.arrays += 1;
    if (node.nullable === true) result.nullable += 1;
    if (Array.isArray(node.enum)) result.enumValues += node.enum.length;
    if (Array.isArray(node.required)) result.required += node.required.length;
    if (node.properties && typeof node.properties === "object") {
      const properties = node.properties as Record<string, unknown>;
      result.properties += Object.keys(properties).length;
      for (const child of Object.values(properties)) walk(child, depth + 1);
    }
    walk(node.items, depth + 1);
  };
  walk(schema, 0);
  return result;
}
