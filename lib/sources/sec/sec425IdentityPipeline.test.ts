import test from "node:test";
import assert from "node:assert/strict";
import { fetchSecEdgarRawItems, fetchTickerLookup } from "./parser.ts";
import { buildSecFilingAnalysisPackage } from "../../prompts/secFilingAnalysisPackage.ts";
import { adaptSec425AnalysisPromptResultForAnalysis, buildSec425AnalysisPromptForInput, buildSec425RouterPromptForInput, buildSec425DeterministicAnalysisForInput } from "../../ai/sec425AnalysisAdapter.ts";
import type { SecFilingAnalysisInput } from "../../prompts/secFilingAnalysis.ts";
import { buildSec425FactInput } from "../../ai/sec425FactInput.ts";
import { sec425Adapter } from "./forms/425/adapter.ts";

test("actual collection → package → Primary prompt/projection preserves official catalog positive and distinct index roles, no external calls", async t => {
  const accession = "0001234567-26-000001", base = "https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/";
  let fmp = 0, calls = 0, catalogTicker = "BUY", archiveIsSubject = false;
  t.mock.method(globalThis, "fetch", async (input: unknown) => {
    const url = String(input); calls++;
    if (url.includes("financialmodelingprep")) { fmp++; throw Error("FMP forbidden"); }
    if (url === "https://www.sec.gov/files/company_tickers_exchange.json") return Response.json({ fields: ["cik", "name", "ticker", "exchange"], data: [[1234567, "Example Buyer", catalogTicker, "NYSE"], [7654321, "Example Buyer II", "TARGET", "Nasdaq"]] });
    if (url === base + "index.json") return Response.json({ directory: { item: [] } });
    if (url === base + accession + "-index.html") return new Response(`<html><span class="companyName">Example Buyer (${archiveIsSubject ? "Subject" : "Filed by"}) <a href="?CIK=1234567">CIK 1234567</a></span><span class="companyName">Example Buyer II (${archiveIsSubject ? "Filed by" : "Subject"}) <a href="?CIK=7654321">CIK 7654321</a></span><div class="infoHead">Filing Date</div><div class="info">2026-06-01</div><table summary="Document Format Files"><tr><td>1</td><td>Primary</td><td><a href="primary.htm">primary.htm</a></td><td>425</td><td>1000</td></tr></table></html>`);
    if (url === base + "primary.htm") return new Response("<html><p>Filed by Example Buyer</p><p>Subject Company: Example Buyer II</p><p>Example Buyer signed a merger agreement on June 1. CUSIP 123456789. The transaction remains subject to conditions.</p></html>");
    throw Error("Unrecognized mocked request");
  });
  await fetchTickerLookup(true);
  const raw = await fetchSecEdgarRawItems({ accessionNumber: accession, cik: "1234567", formTypes: ["425"], includeDocuments: true });
  assert.equal(raw.ok, true); assert.equal(raw.items.length, 1);
  const item = raw.items[0];
  const filing = buildSecFilingAnalysisPackage(item);
  const provenance = filing.sec425_identity_provenance!;
  assert.equal(provenance.tickerResolution?.source, "accession_cik_sec");
  const roles = provenance.filingRoles?.roles as { companyName: string; cik: string; role: string }[];
  assert.deepEqual(roles.map(r => [r.companyName, r.cik, r.role]), [["Example Buyer", "1234567", "filed_by"], ["Example Buyer II", "7654321", "subject_company"]]);
  const input = { filing_package: filing } as unknown as SecFilingAnalysisInput;
  const beforeInputCalls = calls, fact = sec425Adapter.buildFactInput(input), factInput = JSON.parse(fact.user);
  assert.equal(calls, beforeInputCalls, "input builder cannot fetch or dispatch a provider");
  assert.deepEqual(factInput.official_company_observations.map((r: { cik: string; listings: { ticker: string }[] }) => [r.cik, r.listings[0]?.ticker]), [["0001234567", "BUY"], ["0007654321", "TARGET"]]);
  assert.ok(factInput.official_company_observations.every((r: { transactionRole: unknown }) => r.transactionRole === null));
  assert.equal(factInput.source.sourceSha256, filing.sec425_primary_source!.sourceSha256);
  assert.deepEqual(factInput.cleaned_source_blocks.map((b: { text: string }) => b.text), (filing.hard_parsers["425"] as { raw: { cleaned_source_blocks: { text: string }[] } }).raw.cleaned_source_blocks.map(b => b.text));
  const incomplete = structuredClone(input) as unknown as { filing_package: typeof filing };
  incomplete.filing_package.sec425_primary_source!.complete = false;
  assert.throws(() => buildSec425FactInput(incomplete as unknown as SecFilingAnalysisInput), /complete_primary_source_required/);
  const corrupt = structuredClone(input) as unknown as { filing_package: typeof filing };
  (corrupt.filing_package.sec425_identity_provenance!.officialCompanies[1].catalogRows as { cik: string }[])[0].cik = "1234567";
  assert.equal(JSON.parse(buildSec425FactInput(corrupt as unknown as SecFilingAnalysisInput).user).official_company_observations[1].status, "unavailable");
  const missing = structuredClone(input) as unknown as { filing_package: typeof filing };
  missing.filing_package.sec425_identity_provenance!.officialCompanies[1].catalogRows = [];
  const absent = JSON.parse(buildSec425FactInput(missing as unknown as SecFilingAnalysisInput).user).official_company_observations[1];
  assert.equal(absent.cik, "0007654321"); assert.equal(absent.tickerStatus, "not_in_catalog"); assert.deepEqual(absent.listings, []);
  const router = { event_type: "strategic_transaction", evidence: [], display_type: "generic", selected_source_block_ids: [], score: 35, archive_like_candidate: true, needs_analysis_llm: false };
  const model = { analysis_output: { primary_ticker: { ticker: "BUY", exchange: "NYSE" }, tickers: [{ ticker: "BUY", exchange: "NYSE" }], summary: "Exact summary retained", score: 60 }, impact_level: "material_progression" };
  const before = JSON.stringify(model), result = adaptSec425AnalysisPromptResultForAnalysis(model, input, router);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.analysis.primary_ticker, { ticker: "BUY", exchange: "NYSE" });
  assert.deepEqual(result.analysis.tickers, [{ ticker: "BUY", exchange: "NYSE" }]);
  assert.equal(result.analysis.summary, "Exact summary retained"); assert.equal(JSON.stringify(model), before);
  assert.deepEqual(result.analysis.sec_425_raw_model_output, model);
  for (const prompt of [buildSec425AnalysisPromptForInput(input, router), buildSec425RouterPromptForInput(input)]) {
    const supplied = JSON.parse(prompt.user); assert.equal(supplied.current_filing.ticker, "BUY");
    assert.equal(supplied.filing_roles.transactionRole, null); assert.equal(supplied.filing_roles.indexRoles.roles.length, 2);
    assert.deepEqual(supplied.official_company_observations.map((r: { cik: string }) => r.cik), ["0001234567", "0007654321"]);
  }
  const wrong = structuredClone(model); wrong.analysis_output.primary_ticker.ticker = "TARGET";
  const rejected = adaptSec425AnalysisPromptResultForAnalysis(wrong, input, router);
  if (rejected.ok) assert.equal((rejected.analysis.primary_ticker as { ticker: unknown }).ticker, null);
  const forged = structuredClone(input) as unknown as { filing_package: typeof filing };
  (forged.filing_package.sec425_identity_provenance!.tickerResolution!.sec_catalog_row as { cik: string }).cik = "7654321";
  const rejectedCik = adaptSec425AnalysisPromptResultForAnalysis(model, forged as unknown as SecFilingAnalysisInput, router);
  if (rejectedCik.ok) assert.equal((rejectedCik.analysis.primary_ticker as { ticker: unknown }).ticker, null);
  const wrongName = structuredClone(input) as unknown as { filing_package: typeof filing };
  wrongName.filing_package.company_name = "Example Buyer II";
  const rejectedName = adaptSec425AnalysisPromptResultForAnalysis(model, wrongName as unknown as SecFilingAnalysisInput, router);
  assert.equal(rejectedName.ok, true);
  if (rejectedName.ok) assert.equal((rejectedName.analysis.primary_ticker as { ticker: unknown }).ticker, null);
  // Deterministic archives use the same final projection, never a separate unchecked display ticker.
  const deterministic = buildSec425DeterministicAnalysisForInput(input, { ...router, route_case: "routine_repetition", deterministic_stage: "router" });
  assert.equal(deterministic?.ok, true);
  if (deterministic?.ok) {
    assert.equal((deterministic.analysis.primary_ticker as { ticker: unknown }).ticker, "BUY");
    assert.equal(((deterministic.analysis.display_payload as { data: { primary_ticker: string } }).data.primary_ticker), "BUY");
  }
  archiveIsSubject = true;
  const subject = await fetchSecEdgarRawItems({ accessionNumber: accession, cik: "1234567", formTypes: ["425"], includeDocuments: true });
  assert.equal(subject.ok, true);
  assert.equal(subject.items[0].raw_payload.filer_cik, "7654321");
  assert.equal(subject.items[0].metadata.filer_cik, "7654321");
  assert.equal(subject.items[0].metadata.sec425_archive_cik, "1234567");
  assert.equal(subject.items[0].raw_payload.cik, "1234567");
  assert.equal(subject.items[0].raw_payload.sec425_archive_cik, "1234567");
  catalogTicker = "OTHER"; await fetchTickerLookup(true);
  assert.equal(fmp, 0); assert.ok(calls > 0);
});
