import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalizeCorporateActionAnalyzerResult,
  CORPORATE_ACTION_EVENT_KINDS,
  CORPORATE_ACTION_EVENT_KIND_VOCABULARY,
  CORPORATE_ACTION_STAGE_VOCABULARY,
  CORPORATE_ACTION_STAGES,
  parseCorporateActionAnalyzerTransportJson,
  validateCorporateActionAnalyzerResult,
  validateCorporateActionAnalyzerTransportResult,
  type CorporateActionAnalyzerTransportResult,
} from "./corporateActionCanonicalFacts.ts";
import {
  adaptNasdaqCorporateActionSource,
  adaptNewsCorporateActionSource,
  adaptSec8k6kCorporateActionSource,
} from "./corporateActionSourceAdapters.ts";
import {
  CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT,
  CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA,
} from "../prompts/corporateActionCanonicalAnalysis.ts";

const sourceText = "The company will effect a one-for-twenty reverse stock split. The reverse stock split will become effective on August 4, 2026.";

function input() {
  return adaptNasdaqCorporateActionSource({
    source_unique_id: "ECA-test-source",
    source_url: "https://example.com/notices/test",
    published_at: "2026-08-01T00:00:00Z",
    title: "Stored official notice",
    body_text: sourceText,
  });
}

function applicable(overrides: Partial<Extract<CorporateActionAnalyzerTransportResult, { applicable: true }>> = {}) {
  return {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: "scheduled",
    effective_date: { availability: "available", value: "2026-08-04" },
    ratio: { availability: "available", old_shares: "20", new_shares: "1" },
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "nasdaq_notice_body",
      evidence: "The company will effect a one-for-twenty reverse stock split.",
    },
    source_ref: "nasdaq_notice_body",
    evidence: "The reverse stock split will become effective on August 4, 2026.",
    confidence: "high",
    as_of: { availability: "available", value: "2026-08-04" },
    ...overrides,
  } as CorporateActionAnalyzerTransportResult;
}

test("applicable transport materializes only the reverse-split contract and mechanically converts old/new shares", () => {
  const canonical = canonicalizeCorporateActionAnalyzerResult(applicable(), input());
  assert.deepEqual(canonical.errors, []);
  assert.equal(canonical.result?.applicable, true);
  if (!canonical.result?.applicable) return;
  assert.equal(canonical.result.facts.event_kind, "reverse_split");
  assert.equal(canonical.result.facts.action_stage, "scheduled");
  assert.deepEqual(canonical.result.facts.ratio.old_shares_per_new_share, {
    availability: "available",
    value: 20,
  });
  assert.deepEqual(canonical.result.facts.effective_date, { availability: "available", value: "2026-08-04" });
  assert.deepEqual(canonical.result.facts.source, {
    source_family: "nasdaq",
    source_id: "ECA-test-source",
    source_url: "https://example.com/notices/test",
  });
  assert.deepEqual(validateCorporateActionAnalyzerResult(canonical.result), []);
});

test("every action stage is a strict semantic enum and synonyms are rejected", () => {
  for (const action_stage of CORPORATE_ACTION_STAGES) {
    assert.deepEqual(validateCorporateActionAnalyzerTransportResult(applicable({ action_stage })), []);
  }
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({ action_stage: "approved" as never })), []);
});

test("canonical vocabulary is the single ordered source for Analyzer values and Monitor exposure", () => {
  assert.deepEqual(CORPORATE_ACTION_EVENT_KINDS, CORPORATE_ACTION_EVENT_KIND_VOCABULARY.map((entry) => entry.value));
  assert.deepEqual(CORPORATE_ACTION_STAGES, CORPORATE_ACTION_STAGE_VOCABULARY.map((entry) => entry.value));
  assert.deepEqual(CORPORATE_ACTION_EVENT_KIND_VOCABULARY, [{
    value: "reverse_split",
    description: "The event establishes a reverse stock split, regardless of its lifecycle stage.",
    monitorable: true,
    displayLabel: "Reverse stock split",
  }]);
  assert.deepEqual(CORPORATE_ACTION_STAGE_VOCABULARY.map(({ value, monitorable, displayLabel }) => ({
    value,
    monitorable,
    displayLabel,
  })), [
    { value: "announced", monitorable: true, displayLabel: "Announced" },
    { value: "board_approved", monitorable: true, displayLabel: "Board approved" },
    { value: "shareholder_approved", monitorable: true, displayLabel: "Shareholder approved" },
    { value: "scheduled", monitorable: true, displayLabel: "Scheduled" },
    { value: "effective", monitorable: true, displayLabel: "Effective" },
    { value: "unknown", monitorable: false, displayLabel: "Unknown" },
  ]);
  assert.ok([...CORPORATE_ACTION_EVENT_KIND_VOCABULARY, ...CORPORATE_ACTION_STAGE_VOCABULARY]
    .every((entry) => entry.description.trim() && entry.displayLabel.trim()));
});

test("non-reverse sources have one exact not-applicable representation with no fake facts", () => {
  const parsed = parseCorporateActionAnalyzerTransportJson('{"applicable":false}');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.transport?.applicable, false);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult({
    applicable: false,
    event_kind: "reverse_split",
  }), []);
  assert.deepEqual(canonicalizeCorporateActionAnalyzerResult({ applicable: false }, input()).result, {
    applicable: false,
  });
});

test("source ref, date, ratio values, duplicate keys, and unknown semantics hard fail", () => {
  assert.match(
    parseCorporateActionAnalyzerTransportJson('{"applicable":false,"applicable":true}').errors.join("; "),
    /duplicate key/,
  );
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({ source_ref: "missing ref" })), []);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({
    effective_date: { availability: "available", value: "2026-02-30" },
  })), []);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult(applicable({
    ratio: { availability: "available", old_shares: "Infinity", new_shares: "1" },
  })), []);
  assert.notDeepEqual(validateCorporateActionAnalyzerTransportResult({
    ...applicable(),
    event_kind: "forward_split",
  }), []);
  assert.equal(canonicalizeCorporateActionAnalyzerResult(applicable({ source_ref: "foreign_document" }), input()).result, null);
  assert.match(canonicalizeCorporateActionAnalyzerResult(applicable({
    execution_update: {
      decision: "CANCEL_EXISTING_EXECUTION",
      target_execution_id: `rse:v1:${"a".repeat(64)}`,
      source_ref: "nasdaq_notice_body",
      evidence: "reverse stock split",
    },
  }), input()).errors.join("; "), /supplied execution candidate/);
});

test("evidence exactness is separated from semantic/source eligibility", () => {
  const exact = canonicalizeCorporateActionAnalyzerResult(applicable(), input());
  const unavailable = canonicalizeCorporateActionAnalyzerResult(applicable({ evidence: "paraphrased effective date" }), input());
  assert.equal(exact.result?.applicable, true);
  assert.equal(unavailable.result?.applicable, true);
  if (exact.result?.applicable && unavailable.result?.applicable) {
    assert.equal(exact.result.facts.evidence.availability, "available");
    assert.deepEqual(unavailable.result.facts.evidence, {
      availability: "unavailable",
      reason: "not_exact_span",
    });
    assert.deepEqual(unavailable.result.facts.effective_date, exact.result.facts.effective_date);
    assert.deepEqual(unavailable.result.facts.ratio, exact.result.facts.ratio);
  }
});

test("all stored-source adapters preserve exact source identity and never load parser or Primary semantic truth", () => {
  const news = adaptNewsCorporateActionSource({
    source_unique_id: "news-1",
    source_url: "https://example.com/news/1",
    published_at: "2026-08-01",
    title: "News",
    body_text: sourceText,
  });
  const sec = adaptSec8k6kCorporateActionSource({
    accession_number: "0000000000-26-000001",
    source_url: "https://www.sec.gov/Archives/example",
    filed_at: "2026-08-01",
    title: "8-K",
    cleaned_source_blocks: [{ block_id: "sec_block_1", text: sourceText }],
  });
  assert.equal(news.source_family, "news");
  assert.equal(sec.source_family, "sec");
  assert.equal(sec.source_documents[0].source_ref, "sec_block_1");
  const adapterSource = readFileSync(new URL("./corporateActionSourceAdapters.ts", import.meta.url), "utf8");
  assert.doesNotMatch(adapterSource, /event_family|calendar_item|event_type|primary_context|regex|keyword/i);
});

test("one-call prompt defines full-source stage semantics and forbids semantic fallbacks", () => {
  assert.deepEqual(CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA.properties.event_kind.enum, CORPORATE_ACTION_EVENT_KINDS);
  assert.deepEqual(CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA.properties.action_stage.enum, CORPORATE_ACTION_STAGES);
  assert.equal(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT.length, 8_981);
  assert.equal(
    createHash("sha256").update(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT).digest("hex"),
    "ae95478e0f3b2592c29f35afaf3c82c97b5d1746bc5ae3de6d90848015bd5f6b",
  );
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /complete stored source documents/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /board_approved/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /shareholder_approved/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /future at the source time is scheduled/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /contemporaneous notice of an action taking effect/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Never upgrade a historical notice/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /parser values, calendar values/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Application code alone performs division/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /exactly one supplied security_class_candidate/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Do not map generic common stock across multiple class candidates/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Never infer market session ordering from a date alone/i);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /SUPERSEDE_EXISTING_EXECUTION/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /CANCEL_EXISTING_EXECUTION/);
  assert.match(CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT, /Never match executions by ratio\/date similarity/i);
});
