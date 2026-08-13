import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  LISTING_RISK_EVENT_FACTS_JSON_SCHEMA,
  LISTING_RISK_EVENT_FACTS_VERSION,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  LISTING_RISK_ANALYZER_INPUT_VERSION,
  LISTING_RISK_ANALYZER_PROMPT_VERSION,
  LISTING_RISK_ANALYZER_PROVIDER_SCHEMA,
  normalizeListingRiskAnalyzerProviderResult,
  readListingRiskAnalyzerResult,
  type ListingRiskAnalyzerInput,
  validateListingRiskAnalyzerInput,
  validateListingRiskAnalyzerProviderResult,
  validateListingRiskAnalyzerResult,
} from "./listingRiskAnalyzer.ts";
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

test("provider transport uses the existing facts schema and rejects impossible mixed states", () => {
  const providerFactsSchema = LISTING_RISK_ANALYZER_PROVIDER_SCHEMA.properties.applicable_facts.items as any;
  assert.deepEqual(providerFactsSchema.required, LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.required);
  assert.deepEqual(
    providerFactsSchema.properties.classification.properties.event_kind.enum,
    LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.classification.properties.event_kind.enum,
  );
  assert.deepEqual(
    providerFactsSchema.properties.sources.items.properties.source_family.enum,
    LISTING_RISK_EVENT_FACTS_JSON_SCHEMA.properties.sources.items.properties.source_family.enum,
  );
  assert.doesNotMatch(JSON.stringify(LISTING_RISK_ANALYZER_PROVIDER_SCHEMA), /additionalProperties|"type":\[/);
  assert.equal(providerFactsSchema.properties.exchange.properties.value.nullable, true);
  assert.deepEqual(LISTING_RISK_ANALYZER_PROVIDER_SCHEMA.required, ["status", "applicable_facts"]);
  const input = newsInput("The exchange notified the issuer of a newly established listing event.");
  const facts = validFacts(input, "news_article_body", input.source_documents[0].text);

  const applicable = { status: "applicable", applicable_facts: [facts] };
  const notApplicable = { status: "not_applicable", applicable_facts: [] };
  assert.deepEqual(validateListingRiskAnalyzerProviderResult(applicable, input), []);
  assert.deepEqual(validateListingRiskAnalyzerProviderResult(notApplicable, input), []);
  assert.deepEqual(normalizeListingRiskAnalyzerProviderResult(applicable, input), { status: "applicable", facts });
  assert.deepEqual(normalizeListingRiskAnalyzerProviderResult(notApplicable, input), { status: "not_applicable" });

  assert.notDeepEqual(
    validateListingRiskAnalyzerProviderResult({ status: "not_applicable", applicable_facts: [facts] }, input),
    [],
  );
  assert.notDeepEqual(
    validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [] }, input),
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
  canonicalEvidence.sources[0].evidence = "Concise source evidence remains governed by the existing 520-character facts contract.";
  assert.deepEqual(
    validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [canonicalEvidence] }, input),
    [],
    "the analyzer must not add a stricter evidence semantic contract than listingRiskFacts",
  );

  const invalidFacts = structuredClone(facts) as unknown as Record<string, unknown>;
  delete invalidFacts.dates;
  assert.ok(
    validateListingRiskAnalyzerProviderResult({ status: "applicable", applicable_facts: [invalidFacts] }, input)
      .some((error) => error.includes("listing_risk_event_facts must contain exactly")),
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
  facts.affected_security.security_basis = availableText("common_stock");
  facts.dates.notice_date = availableDate("2026-05-01");
  facts.dates.compliance_deadline = { ...availableDate("2026-10-28"), date_status: "scheduled" };

  const result = normalizeListingRiskAnalyzerProviderResult(
    { status: "applicable", applicable_facts: [facts] },
    input,
  );

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
    security_basis: availableText("common_stock"),
    notice_date: availableDate("2026-05-01"),
    compliance_deadline: { ...availableDate("2026-10-28"), date_status: "scheduled" },
  });
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
  assert.equal(LISTING_RISK_ANALYZER_PROMPT_VERSION, "listing_risk_domain_analyzer_v3");
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /primary_context[\s\S]+not evidence/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /historical deficiency[\s\S]+background/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /simple reverse split[\s\S]+not_applicable/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Regained compliance[\s\S]+recovered/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /planned[\s\S]+cure action[\s\S]+not a recovery/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /merger cleanup[\s\S]+procedural/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /trading suspension date[\s\S]+removal effective date[\s\S]+distinct/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Do not infer applicability from event_type/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /structured listing_risk_event_facts_v1 fields are the primary product output/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Extract every condition-relevant field[\s\S]+Continue through the entire object/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /Evidence supports those structured facts; evidence never replaces/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /source_document\.text\.includes\(evidence\) === true/);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /whitespace[\s\S]+Unicode[\s\S]+date formatting/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /smallest useful supporting span[\s\S]+150 to 280[\s\S]+520/i);
  assert.match(LISTING_RISK_DOMAIN_ANALYZER_SYSTEM_PROMPT, /schema-required mechanical representation[\s\S]+must not change/i);
  const prompt = buildListingRiskDomainAnalysisPrompt(newsInput("Source body"));
  assert.equal(prompt.version, "listing_risk_domain_analyzer_v3");
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
  };
}
