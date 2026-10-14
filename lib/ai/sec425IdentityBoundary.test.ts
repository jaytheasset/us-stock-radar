import test from "node:test";
import assert from "node:assert/strict";
import { parseSec425Filing } from "../sources/sec/forms/425/parser.ts";
import { adaptSec425AnalysisPromptResultForAnalysis } from "./sec425AnalysisAdapter.ts";
import { inspectSec425FactCandidate } from "../sources/sec/forms/425/factsCandidate.ts";
import type { SecFilingAnalysisInput } from "../prompts/secFilingAnalysis.ts";
import { sec425BlocksHash, type Sec425IdentityEvidence } from "../sources/sec/forms/425/verification.ts";
import { normalizeMainSubmissions } from "../sec-structured-data/mainSubmissions.ts";

test("unverified model abbreviation cannot become Primary display/security ticker", () => {
  const parser = parseSec425Filing({ filingText: "Filed by Example. Example entered into a merger agreement.", primaryTicker: "FILER" });
  const input = { filing_package: { cik: "0000000001", primary_ticker: { ticker: "FILER" }, hard_parsers: { "425": parser } } } as unknown as SecFilingAnalysisInput;
  const raw = { analysis_output: { primary_ticker: { ticker: "OBDC II", exchange: null }, tickers: [{ ticker: "OBDC II" }], summary: "Unchanged analysis", score: 60 }, impact_level: "material_progression" };
  const before = JSON.stringify(raw);
  const result = adaptSec425AnalysisPromptResultForAnalysis(raw, input, { event_type: "other", evidence: [], display_type: "generic" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.analysis.primary_ticker, { ticker: null, exchange: null });
  assert.equal(JSON.stringify(raw), before);
});

test("explicitly bound official related ticker is preserved; raw claims are never filled from the filer", () => {
  const parser = parseSec425Filing({ filingText: "Example Buyer CIK 0000000001 announced a merger.", primaryTicker: "FILER" });
  const cik = "0000000001", sourceUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const payload = { cik, name: "Example Buyer", tickers: ["BUY"], exchanges: ["NYSE"], filings: { recent: { accessionNumber: [], form: [], filingDate: [] } } };
  const document = { cik, sourceUrl, sourceIdentity: sourceUrl, sourceKind: "submissions" as const, fetchedAt: "2026-06-01T00:00:00.000Z", payload, rawBody: JSON.stringify(payload), rawBodyKind: "injected_exact_body" as const };
  const block = parser.raw.cleaned_source_blocks.find(b => b.text.includes("Example Buyer CIK 0000000001"))!;
  const context: Sec425IdentityEvidence = { bindings: [{ claim: { key: "related:0", name: "Example Buyer", ticker: "BUY", exchange: "NYSE" }, cik,
    blocksHash: sec425BlocksHash(parser.raw.cleaned_source_blocks), evidence: [{ block_id: block.block_id, source_field: "text", quote: "Example Buyer CIK 0000000001" }] }],
    submissions: [{ document, contentHash: normalizeMainSubmissions([document], cik, document.fetchedAt).rawSources[0].contentHash, confirmedAt: document.fetchedAt }] };
  const input = { filing_package: { primary_ticker: { ticker: "FILER" }, hard_parsers: { "425": parser } } } as unknown as SecFilingAnalysisInput;
  const raw = { impact_level: "material_progression", analysis_output: { score: 60, primary_ticker: { ticker: null, exchange: null }, related_tickers: [{ ticker: "BUY", exchange: "NYSE" }, { ticker: "FAKE", exchange: null }] } };
  const result = adaptSec425AnalysisPromptResultForAnalysis(raw, input, { event_type: "other", evidence: [], display_type: "generic" }, context);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.analysis.related_tickers, [{ ticker: "BUY", exchange: "NYSE" }]);
  assert.deepEqual(result.analysis.primary_ticker, { ticker: null, exchange: null });
  assert.deepEqual(result.analysis.sec_425_raw_model_output, raw);
});

test("historical agreement evidence has its own currentness conflict, separate from not_ready", () => {
  const text = "As previously announced, on September 30, 2025, Example entered into a Merger Agreement.";
  const raw = { decision: "confirmed", reason: "Signing", evidence: [{ block_id: "b1", source_field: "text", quote: text }], announcement: { announcement_type: "definitive_agreement_signed", transaction_types: ["merger"], statement: "Example signed a merger agreement.", parties: [{ name: "Example", role: "acquirer", ticker: null, participation: null, evidence: [] }], key_terms: [] } };
  const result = inspectSec425FactCandidate(raw, [{ block_id: "b1", text }]);
  assert.equal((result as unknown as { currentness: { status: string } }).currentness?.status, "conflict");
});
