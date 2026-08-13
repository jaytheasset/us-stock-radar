import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LISTING_AVAILABILITIES,
  LISTING_DATE_STATUSES,
  LISTING_EVENT_KINDS,
  LISTING_EVENT_OUTCOMES,
  LISTING_FACT_CONFIDENCES,
  LISTING_FACT_ORIGINS,
  LISTING_PROCEEDING_KINDS,
  LISTING_PROCEEDING_STATUSES,
  LISTING_RISK_EVENT_FACTS_JSON_SCHEMA,
  LISTING_RISK_EVENT_FACTS_VERSION,
  LISTING_VALUE_QUALITIES,
  type ListingFactPath,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  canonicalizeListingRiskAnalyzerTransportResult,
  LISTING_RISK_ANALYZER_INPUT_VERSION,
  LISTING_RISK_ANALYZER_MAX_PAYLOAD_CHARS,
  LISTING_RISK_ANALYZER_PROMPT_VERSION,
  LISTING_RISK_PROVIDER_FACT_KEYS,
  LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH,
  normalizeListingRiskAnalyzerProviderResult,
  parseListingRiskAnalyzerTransportJson,
  readListingRiskAnalyzerResult,
  type ListingRiskAnalyzerInput,
  type ListingRiskAnalyzerTransportResult,
  validateListingRiskAnalyzerInput,
  validateListingRiskAnalyzerProviderResult,
  validateListingRiskAnalyzerResult,
  validateListingRiskAnalyzerTransportFactEligibility,
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
  LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY,
  LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF,
  LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_TEXT,
  LISTING_RISK_DOMAIN_ANALYZER_SHORT_EXAMPLE,
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

test("V10 keeps the 19-key Core map exhaustive without a Gemini response schema", () => {
  assert.deepEqual(
    [...new Set(Object.values(LISTING_RISK_PROVIDER_FACT_KEY_TO_PATH))].sort(),
    [...LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.fact_provenance.items.properties.fact_path.enum].sort(),
  );
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const facts = validFacts(input, "news_article_body", input.source_documents[0].text);

  const applicable = transportFromFacts(facts);
  const notApplicable = {
    status: "not_applicable",
    core_facts: [],
    agent_context: { fact_provenance: [], as_of: { availability: "unavailable" }, confidence: "unknown", sources: [] },
  };
  assert.deepEqual(validateListingRiskAnalyzerTransportResult(applicable, input), []);
  assert.deepEqual(validateListingRiskAnalyzerTransportResult(notApplicable, input), []);
  const canonicalFacts = structuredClone(facts);
  canonicalFacts.sources = canonicalFacts.sources.map((source) => ({ ...source, evidence: null }));
  assert.deepEqual(canonicalizeListingRiskAnalyzerTransportResult(applicable, input).result, {
    status: "applicable",
    applicable_facts: [canonicalFacts],
  });
  assert.deepEqual(canonicalizeListingRiskAnalyzerTransportResult(notApplicable, input).result, {
    status: "not_applicable",
    applicable_facts: [],
  });

  assert.notDeepEqual(
    validateListingRiskAnalyzerTransportResult({
      status: "not_applicable",
      core_facts: applicable.core_facts,
      agent_context: { fact_provenance: [], as_of: { availability: "unavailable" }, confidence: "unknown", sources: [] },
    }, input),
    [],
  );
  assert.notDeepEqual(
    validateListingRiskAnalyzerTransportResult({
      status: "applicable",
      core_facts: [],
      agent_context: { fact_provenance: [], as_of: { availability: "unavailable" }, confidence: "unknown", sources: [] },
    }, input),
    [],
  );
});

test("provider transport parses one direct strict JSON text and rejects wrappers, duplicate keys, and trailing content", () => {
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const transport = transportFromFacts(validFacts(input, "news_article_body", input.source_documents[0].text));
  const parsed = parseListingRiskAnalyzerTransportJson(JSON.stringify(transport));
  assert.deepEqual(parsed.errors, []);
  assert.equal(JSON.stringify(parsed.transport), JSON.stringify(transport));
  assert.match(parseListingRiskAnalyzerTransportJson("```json\n{}\n```").errors.join("; "), /invalid JSON/);
  assert.match(parseListingRiskAnalyzerTransportJson('{"status":"applicable","status":"not_applicable"}').errors.join("; "), /duplicate key/);
  assert.match(parseListingRiskAnalyzerTransportJson("{} explanation").errors.join("; "), /trailing content/);
  assert.match(
    parseListingRiskAnalyzerTransportJson("x".repeat(LISTING_RISK_ANALYZER_MAX_PAYLOAD_CHARS + 1)).errors.join("; "),
    /characters or fewer/,
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

test("explicit 19-key transport maps only declared unavailable facts and fails closed on missing, duplicate, or unknown keys", () => {
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const transport = transportFromFacts(validFacts(input, "news_article_body", input.source_documents[0].text));

  const canonical = canonicalizeListingRiskAnalyzerTransportResult(transport, input).result;
  assert.equal(canonical?.applicable_facts[0].exchange.availability, "unavailable");
  assert.equal(canonical?.applicable_facts[0].exchange.value, null);

  const duplicate = structuredClone(transport);
  duplicate.core_facts.push(structuredClone(duplicate.core_facts[0]));
  assert.match(validateListingRiskAnalyzerTransportResult(duplicate, input).join("; "), /key must be unique/);

  const unknown = structuredClone(transport) as any;
  unknown.core_facts[0].key = "unknown_fact";
  assert.match(validateListingRiskAnalyzerTransportResult(unknown, input).join("; "), /core_facts\[0\]\.key is invalid/);

  const missingClassification = structuredClone(transport);
  missingClassification.core_facts = missingClassification.core_facts.filter((row) => row.key !== "classification_event_outcome");
  assert.match(validateListingRiskAnalyzerTransportResult(missingClassification, input).join("; "), /missing required key classification_event_outcome/);

  const missingUnavailable = structuredClone(transport);
  missingUnavailable.core_facts = missingUnavailable.core_facts.filter((row) => row.key !== "exchange");
  assert.match(validateListingRiskAnalyzerTransportResult(missingUnavailable, input).join("; "), /missing required key exchange/);

  const unavailableWithSemanticValue = structuredClone(transport) as any;
  Object.assign(unavailableWithSemanticValue.core_facts.find((row: any) => row.key === "exchange"), { value: "Nasdaq" });
  assert.match(validateListingRiskAnalyzerTransportResult(unavailableWithSemanticValue, input).join("; "), /must contain exactly/);

  const wrongSourceRef = structuredClone(transport);
  assert.equal(wrongSourceRef.core_facts[0].availability, "available");
  wrongSourceRef.core_facts[0].source_ref = "missing-document";
  assert.match(validateListingRiskAnalyzerTransportResult(wrongSourceRef, input).join("; "), /source_ref must identify a supplied source document/);

  const providerDerived = structuredClone(transport) as any;
  providerDerived.agent_context.fact_provenance[0].origin = "deterministic_derived";
  assert.match(validateListingRiskAnalyzerTransportResult(providerDerived, input).join("; "), /origin is invalid/);

  const missingCatalogSource = structuredClone(transport);
  missingCatalogSource.agent_context.sources = [];
  assert.match(validateListingRiskAnalyzerTransportResult(missingCatalogSource, input).join("; "), /sources is missing cited source_ref/);
});

test("Core and Agent provenance link by stable key while evidence-only failures preserve eligible facts", () => {
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const transport = transportFromFacts(validFacts(input, "news_article_body", input.source_documents[0].text));

  const missingAgent = structuredClone(transport);
  missingAgent.agent_context.fact_provenance.shift();
  assert.match(
    validateListingRiskAnalyzerTransportFactEligibility(missingAgent, input).join("; "),
    /missing available core fact/,
  );

  const duplicateAgent = structuredClone(transport);
  duplicateAgent.agent_context.fact_provenance.push(structuredClone(duplicateAgent.agent_context.fact_provenance[0]));
  assert.match(validateListingRiskAnalyzerTransportFactEligibility(duplicateAgent, input).join("; "), /key must be unique/);

  const wrongAgentSource = structuredClone(transport);
  wrongAgentSource.agent_context.fact_provenance[0].source_ref = "missing-document";
  assert.match(
    validateListingRiskAnalyzerTransportFactEligibility(wrongAgentSource, input).join("; "),
    /source_ref must identify a supplied source document/,
  );

  for (const [evidence, issue] of [
    ["x".repeat(521), "too_long"],
    ["not a contiguous source span", "not_exact_span"],
    [null, "not_provided"],
  ] as const) {
    const evidenceOnly = structuredClone(transport);
    evidenceOnly.agent_context.fact_provenance[0].evidence = evidence;
    assert.deepEqual(validateListingRiskAnalyzerTransportFactEligibility(evidenceOnly, input), []);
    assert.notDeepEqual(validateListingRiskAnalyzerTransportResult(evidenceOnly, input), []);
    const canonical = canonicalizeListingRiskAnalyzerTransportResult(evidenceOnly, input);
    assert.deepEqual(canonical.errors, []);
    const facts = canonical.result?.applicable_facts[0];
    assert.equal(facts?.classification.event_kind, "other");
    const provenance = facts?.fact_provenance.find((entry) => entry.fact_path === "classification.event_kind");
    assert.equal(provenance?.evidence, null);
    assert.equal(provenance?.evidence_status, "unavailable");
    assert.equal(provenance?.evidence_issue, issue);
  }

  const canonical = canonicalizeListingRiskAnalyzerTransportResult(transport, input).result?.applicable_facts[0];
  const sourceRef = canonical?.fact_provenance[0]?.source_ref;
  assert.equal(canonical?.sources.find((source) => source.source_ref === sourceRef)?.source_url, input.source_url);
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
  const booleanRow = coercedBoolean.core_facts.find((row) => row.key === "continued_trading_continues");
  assert.ok(booleanRow);
  assert.equal(booleanRow.availability, "available");
  booleanRow.value = "TRUE";
  assert.match(validateListingRiskAnalyzerTransportResult(coercedBoolean, input).join("; "), /must be true or false/);

  const invalidDate = structuredClone(transport);
  const dateRow = invalidDate.core_facts.find((row) => row.key === "hearing_date");
  assert.ok(dateRow);
  assert.equal(dateRow.availability, "available");
  dateRow.value = "May 20, 2026";
  assert.match(validateListingRiskAnalyzerTransportResult(invalidDate, input).join("; "), /must be YYYY-MM-DD/);

  const inferredQualifier = structuredClone(transport);
  const textRow = inferredQualifier.core_facts.find((row) => row.key === "continued_trading_continues");
  assert.ok(textRow);
  assert.equal(textRow.availability, "available");
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
  assert.equal(LISTING_RISK_ANALYZER_PROMPT_VERSION, "listing_risk_domain_analyzer_v10");
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /primary_context[\s\S]+not evidence/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /historical deficiency[\s\S]+background/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /simple reverse split[\s\S]+not_applicable/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Regained compliance[\s\S]+recovered/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /planned[\s\S]+cure action[\s\S]+not a recovery/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /merger cleanup[\s\S]+procedural/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /trading suspension date[\s\S]+removal effective date[\s\S]+distinct/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Do not infer applicability from event_type/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /structured listing_risk_event_facts_v2 fields are the primary product output/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Agent Context is separate from Core Monitor Facts/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Do not create rows for root confidence, availability, source_ref, evidence status, or other metadata/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /all 19 canonical fact keys exactly once in core_facts[\s\S]+explicit availability/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Duplicate, missing, and unknown Core keys are invalid/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /return every source-supported condition-relevant listing_risk_event_facts_v2 value[\s\S]+Continue through all supported facts/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /complete JSON object directly[\s\S]+Do not use markdown fences/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Evidence supports those structured facts; evidence never replaces/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /source_document\.text\.includes\(evidence\) === true/);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /whitespace[\s\S]+Unicode[\s\S]+date formatting/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /smallest useful supporting span[\s\S]+150 to 280[\s\S]+520/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /schema-required mechanical representation[\s\S]+must not change/i);
  const prompt = buildListingRiskDomainAnalysisPrompt(newsInput("Source body"));
  assert.equal(prompt.version, "listing_risk_domain_analyzer_v10");
  assert.deepEqual(prompt.responseFormat.json_schema.schema, { type: "object" });
});

test("v10 prompt glossary stays aligned with every strict inner enum and explains independent semantics", () => {
  for (const literal of [
    ...LISTING_EVENT_KINDS,
    ...LISTING_EVENT_OUTCOMES,
    ...LISTING_VALUE_QUALITIES,
    ...LISTING_DATE_STATUSES,
    ...LISTING_FACT_ORIGINS,
    ...LISTING_PROCEEDING_KINDS,
    ...LISTING_PROCEEDING_STATUSES,
  ]) {
    assert.ok(
      LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY.includes(`${literal} =`),
      `glossary must explain ${literal}`,
    );
  }
  assert.match(
    LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY,
    new RegExp(`availability exact literals are ${LISTING_AVAILABILITIES.join(", ")}`),
  );
  assert.match(
    LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY,
    new RegExp(`Fact confidence exact literals are ${LISTING_FACT_CONFIDENCES.join(", ")}`),
  );
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY, /value_quality describes[\s\S]+origin describes[\s\S]+independent fields/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY, /date_status describes the event-state role[\s\S]+not the date string format/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY, /available fact as_of[\s\S]+YYYY-MM-DD[\s\S]+otherwise null/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY, /Root as_of[\s\S]+typed date envelope/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_ENUM_GLOSSARY, /deficiency_notice exactly[\s\S]+never deficiency or listing deficiency/i);
});

test("short educational example teaches Core and Agent rows while complete fixtures and synonyms stay strict", () => {
  const input: ListingRiskAnalyzerInput = {
    version: LISTING_RISK_ANALYZER_INPUT_VERSION,
    source_family: "other",
    source_id: "educational-example",
    source_url: null,
    published_at: "2030-03-02",
    title: "Educational listing notice",
    source_documents: [{
      source_ref: LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF,
      label: "Educational listing notice",
      text: LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_TEXT,
    }],
    primary_context: null,
  };
  assert.equal(LISTING_RISK_DOMAIN_ANALYZER_SHORT_EXAMPLE.core_facts.length, 4);
  assert.equal(LISTING_RISK_DOMAIN_ANALYZER_SHORT_EXAMPLE.agent_context.fact_provenance.length, 3);
  const complete = transportFromFacts(validFacts(input, LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_REF, LISTING_RISK_DOMAIN_ANALYZER_EXAMPLE_SOURCE_TEXT));
  assert.deepEqual(validateListingRiskAnalyzerTransportResult(complete, input), []);
  const canonicalized = canonicalizeListingRiskAnalyzerTransportResult(
    complete,
    input,
  );
  assert.deepEqual(canonicalized.errors, []);
  assert.ok(canonicalized.result);
  assert.deepEqual(validateListingRiskAnalyzerProviderResult(canonicalized.result, input), []);
  assert.ok(
    LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT.includes(
      JSON.stringify(LISTING_RISK_DOMAIN_ANALYZER_SHORT_EXAMPLE),
    ),
  );

  const synonym = structuredClone(complete) as unknown as {
    core_facts: Array<{ key: string; value?: string }>;
  };
  const eventKind = synonym.core_facts.find((fact) => fact.key === "classification_event_kind");
  assert.ok(eventKind);
  eventKind.value = "listing deficiency";
  assert.match(
    validateListingRiskAnalyzerTransportResult(synonym, input).join("; "),
    /value is invalid for classification_event_kind/,
  );
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
  const coreFacts: any[] = [];
  const agentFacts: any[] = [];
  for (const entry of facts.fact_provenance) {
    const key = pathToKey.get(entry.fact_path);
    assert.ok(key);
    agentFacts.push({
      key,
      value_quality: entry.fact_path === "classification.event_kind"
        || entry.fact_path === "classification.event_outcome"
        || entry.fact_path === "proceeding.kind"
        || entry.fact_path === "proceeding.status"
        ? "not_applicable"
        : envelopeForPath(facts, entry.fact_path)?.value_quality,
      origin: entry.origin,
      source_ref: entry.source_ref,
      evidence: entry.evidence,
      confidence: entry.confidence,
      as_of: entry.as_of,
    });
    const base = { key, availability: "available" as const, source_ref: entry.source_ref };
    if (entry.fact_path === "classification.event_kind") {
      coreFacts.push({ ...base, value: facts.classification.event_kind, date_status: "not_applicable" });
    } else if (entry.fact_path === "classification.event_outcome") {
      coreFacts.push({ ...base, value: facts.classification.event_outcome, date_status: "not_applicable" });
    } else if (entry.fact_path === "proceeding.kind") {
      coreFacts.push({ ...base, value: facts.proceeding.kind, date_status: "not_applicable" });
    } else if (entry.fact_path === "proceeding.status") {
      coreFacts.push({ ...base, value: facts.proceeding.status, date_status: "not_applicable" });
    } else {
      const envelope = envelopeForPath(facts, entry.fact_path);
      assert.ok(envelope);
      if (entry.fact_path === "continued_trading.continues.value") {
        coreFacts.push({
          ...base,
          value: String(envelope.value),
          date_status: "not_applicable",
        });
      } else if (entry.fact_path.startsWith("dates.")) {
        coreFacts.push({
          ...base,
          value: envelope.value,
          date_status: envelope.date_status,
        });
      } else {
        coreFacts.push({
          ...base,
          value: envelope.value,
          date_status: "not_applicable",
        });
      }
    }
  }
  for (const key of LISTING_RISK_PROVIDER_FACT_KEYS) {
    if (!coreFacts.some((row) => row.key === key)) {
      coreFacts.push({ key, availability: "unavailable" });
    }
  }
  return {
    status: "applicable",
    core_facts: coreFacts,
    agent_context: {
      fact_provenance: agentFacts,
      as_of: facts.as_of.availability === "available"
        ? {
            availability: "available",
            value: facts.as_of.value as string,
            value_quality: facts.as_of.value_quality,
            date_status: facts.as_of.date_status,
            source_ref: facts.as_of.source_ref as string,
          }
        : { availability: "unavailable" },
      confidence: facts.confidence || "unknown",
      sources: facts.sources.map((source) => ({ source_ref: source.source_ref })),
    },
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
