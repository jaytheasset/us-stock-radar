import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ownershipAdapter,
  ownershipAdapterKey,
  ownershipAnalysisMode,
  ownershipParserGroup,
  ownershipSupportedForms,
  parseOwnershipForm,
} from "./adapter.ts";
import {
  buildOwnershipDisplayPayload,
  buildOwnershipRoutingDecision,
  parseOwnershipFiling,
} from "./parser.ts";
import {
  buildOwnershipAnalysisInput,
  buildOwnershipAnalysisPrompt,
  validateOwnershipResultShape,
} from "./analysisPrompt.ts";
import {
  buildFmpOwnershipMarketContextFromResponses,
  fetchFmpOwnershipMarketContext,
  OWNERSHIP_FMP_MARKET_CONTEXT_HELPER_NOTE,
} from "./testMarketContext.ts";

const here = dirname(fileURLToPath(import.meta.url));

const expectedFiles = [
  "expected/form4-insider-purchase.expected.json",
  "expected/form4-routine-rsu-grant.expected.json",
  "expected/form4-10b5-1-sale.expected.json",
  "expected/form4-multi-owner-10b5-1-conversion.expected.json",
  "expected/form4-derivative-gift-section16-exit.expected.json",
  "expected/form4a-admin-amendment.expected.json",
  "expected/form4-empty-unsupported.expected.json",
  "expected/form144-routine-proposed-sale.expected.json",
  "expected/form144a-material-increase.expected.json",
  "expected/form144a-no-remarks.expected.json",
];

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(here, relativePath), "utf8")) as T;
}

test("ownership analysis validates every expected fixture against the required output shape", () => {
  for (const expectedFile of expectedFiles) {
    const expected = readJson<unknown>(expectedFile);
    assert.deepEqual(validateOwnershipResultShape(expected), [], expectedFile);
  }
});

test("ownership analysis builds the prompt from current filing parser output and required JSON shape", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/form4-10b5-1-sale.json");
    const parserOutput = parseOwnershipFiling(fixture as never);
    const prompt = buildOwnershipAnalysisPrompt(parserOutput);

    assert.ok(prompt.includes("Return JSON only according to the provided response schema"));
    assert.ok(prompt.includes("Output rules"));
    assert.ok(prompt.includes("parser_output is pass-through"));
    assert.equal(prompt.includes("\"event_type\": \"preselected approved event type\""), false);
    assert.equal(prompt.includes("\"analysis_output\": {"), false);
    assert.ok(prompt.includes("Use selected_routing.event_type exactly"));
    assert.ok(prompt.includes("There is no Ownership router LLM in this path"));
    assert.ok(prompt.includes("Use the provided display_payload/display_type"));
    assert.ok(prompt.includes("Do not create new display types"));
    assert.ok(prompt.includes("analysis_output.ownership_monitor_facts"));
    assert.ok(prompt.includes("ownership_monitor_facts_v1"));
    assert.ok(prompt.includes("raw source rows in source order, without netting"));
    assert.ok(prompt.includes("economic_direction is a separate canonical semantic field"));
    assert.ok(prompt.includes("transaction code or A/D value alone never determines economic"));
    assert.ok(prompt.includes("Preserve an explicit source"));
    assert.ok(prompt.includes("aff10b5One false as false"));
    assert.ok(prompt.includes("percent_calculation as the LLM's"));
    assert.ok(prompt.includes("Do not infer a unit policy, conversion, ADS ratio, or"));
    assert.ok(prompt.includes("Do not calculate transaction value here"));
    assert.ok(prompt.includes("availability available even when value_quality is unknown"));
    assert.ok(prompt.includes("preserve each transaction's actual source-backed"));
    assert.ok(prompt.includes("Do not collapse distinct securities such as RSUs"));
    assert.ok(prompt.includes("appear in the same filing"));
    assert.ok(prompt.includes("Do not fail when missing"));
    assert.ok(prompt.includes("Do not use additive point stacking"));
    assert.ok(prompt.includes("Keep score band reasoning"));
    assert.ok(prompt.includes("Score means investor attention / urgency"));
    assert.ok(prompt.includes("Ownership writing rules"));
    assert.ok(prompt.includes("Describe the economic substance first"));
    assert.ok(prompt.includes("Use the most human-readable source-backed person name available"));
    assert.ok(prompt.includes("event_title must be a readable SEO-friendly filing title"));
    assert.ok(prompt.includes("Bad examples"));
    assert.ok(prompt.includes("Administrative ownership"));
    assert.ok(prompt.includes("{recognizable owner/role} {action} {amount/value}"));
    assert.ok(prompt.includes("Do not repeat ticker, company name, or form type in event_title"));
    assert.ok(prompt.includes("source-backed recognizable parent, sponsor, fund, affiliate, or control"));
    assert.ok(prompt.includes("compare the ownership action against supplied"));
    assert.ok(prompt.includes("When one of these title thresholds is met"));
    assert.ok(prompt.includes("add one compact relative-size"));
    assert.ok(prompt.includes("Form 4 source-confirmed actual purchase/sale: shares are at least 1.0% of float/public_float"));
    assert.ok(prompt.includes("1.5% of shares outstanding when float is unavailable"));
    assert.ok(prompt.includes("transaction value is"));
    assert.ok(prompt.includes("at least 1.0% of market cap"));
    assert.ok(prompt.includes("Form 144 proposed sale: proposed shares are at least 2.0% of float/public_float"));
    assert.ok(prompt.includes("3.0% of shares outstanding when float is unavailable"));
    assert.ok(prompt.includes("value is at least 2.0% of market cap"));
    assert.ok(prompt.includes("use one comparison only"));
    assert.ok(prompt.includes("Prefer float/public_float"));
    assert.ok(prompt.includes("Do not omit the event_title comparison"));
    assert.ok(prompt.includes("about 14% of shares outstanding"));
    assert.ok(prompt.includes("If title thresholds are not met"));
    assert.ok(prompt.includes("SoftBank-linked holder exits $282M reported position"));
    assert.ok(prompt.includes("Kate Gebo signature-name update"));
    assert.ok(prompt.includes("Keep event_title under 14 words"));
    assert.ok(prompt.includes("Form 4/A titles must make amendment status clear"));
    assert.ok(prompt.includes("Form 144/A titles must make amendment status clear"));
    assert.ok(prompt.includes("never use \"proposes to sell\" as the main verb"));
    assert.ok(prompt.includes("Do not lead event_title"));
    assert.ok(prompt.includes("Transaction codes may appear in key_evidence"));
    assert.ok(prompt.includes("Use \"open-market purchase\" or \"open-market sale\" only when the full source"));
    assert.ok(prompt.includes("Form 4 scoring caps"));
    assert.ok(prompt.includes("Form 144 scoring caps"));
    assert.ok(prompt.includes("Clean source-confirmed actual purchase/sale below $1M"));
    assert.ok(prompt.includes("CEO/CFO actual purchase/sale of $500k-$1M"));
    assert.ok(prompt.includes("Proposed sale below $5M"));
    assert.ok(prompt.includes("prior three-month gross proceeds below $10M"));
    assert.ok(prompt.includes("Alert gate"));
    assert.ok(prompt.includes("absolute size plus source-backed relative size"));
    assert.ok(prompt.includes("Form 4 alert gate applies only to rows the LLM source-confirms as actual"));
    assert.ok(prompt.includes("value > $500k and shares >= 20% of float/public_float"));
    assert.ok(prompt.includes("value > $1M and value >= 10% of market cap"));
    assert.ok(prompt.includes("Form 4 transactions below $500k cannot be alert"));
    assert.ok(prompt.includes("Filing_context is not required for Form 4 alert"));
    assert.ok(prompt.includes("Without filing_context, Form 4 alert scores should usually stay 75-82"));
    assert.ok(prompt.includes("proposed value > $2.5M and proposed shares >= 20% of float/public_float"));
    assert.ok(prompt.includes("proposed value below $2.5M cannot be alert"));
    assert.ok(prompt.includes("filing_context is optional"));
    assert.ok(prompt.includes("parent_filing_context"));
    assert.ok(prompt.includes("Author filing_summary directly from ownership_source_evidence"));
    assert.ok(prompt.includes("keep two facts separate: the current filing's proposed sale"));
    assert.ok(prompt.includes("clarifies the prior-sale history"));
    assert.ok(prompt.includes("attach the withholding language to those prior reported sales"));
    assert.ok(prompt.includes("remarks-only"));
    assert.ok(prompt.includes("proposed sale amount, value, or date were unchanged"));
    assert.ok(prompt.includes("a summary that only describes the remark is incomplete"));
    assert.ok(prompt.includes("do not write a filing_summary that"));
    assert.ok(prompt.includes("supplied parent context proves what remained"));
    assert.ok(prompt.includes("Set analysis_output.quick_take to \"\""));
    assert.ok(prompt.includes("For score >= 50 feed/alert"));
    assert.ok(prompt.includes("Quick take, Filing summary, Why it matters"));
    assert.ok(prompt.includes("Map UI \"Filing summary\" to analysis_output.summary"));
    assert.ok(prompt.includes("Map UI \"Positive\" to analysis_output.bullish_points"));
    assert.ok(prompt.includes("Map UI \"Negative\" to analysis_output.bearish_points"));
    assert.ok(prompt.includes("legacy schema keys"));
    assert.ok(prompt.includes("A less negative fact is not automatically positive"));
    assert.ok(prompt.includes("analysis_output.quick_take: one sentence, under 22 words"));
    assert.ok(prompt.includes("analysis_output.summary: 2-4 sentences, under 100 words total"));
    assert.ok(prompt.includes("analysis_output.why_it_matters: one sentence, under 35 words"));
    assert.ok(prompt.includes("analysis_output.score_reason: under 18 words"));
    assert.ok(prompt.includes("analysis_output.bullish_points: max 3 items, each under 16 words"));
    assert.ok(prompt.includes("analysis_output.bearish_points: max 3 items, each under 16 words"));
    assert.ok(prompt.includes("analysis_output.key_evidence: max 3 items, each under 16 words"));
    assert.ok(prompt.includes("analysis_output.what_to_watch_next: max 3 items, each under 16 words"));
    assert.ok(prompt.includes("Avoid vague advice"));
    assert.ok(prompt.includes("market_context is optional"));
    assert.ok(prompt.includes("market_cap"));
    assert.ok(prompt.includes("shares_outstanding"));
    assert.ok(prompt.includes("public_float"));
    assert.ok(prompt.includes("average_daily_dollar_volume"));
    assert.ok(prompt.includes("last_price is context only"));
    assert.ok(prompt.includes("Percent unit rule"));
    assert.ok(prompt.includes("A value of 0.0366 means 0.0366%"));
    assert.ok(prompt.includes("not 3.66%"));
    assert.ok(prompt.includes("Use a percent comparison in event_title only when the comparison is at least"));
    assert.ok(prompt.includes("Compare Form 4 actual transaction value"));
    assert.ok(prompt.includes("Compare Form 144 proposed value"));
    assert.ok(prompt.includes("of market cap"));
    assert.ok(prompt.includes("Feed can be triggered by either source-backed absolute filing size"));
    assert.ok(prompt.includes("do not score it below"));
    assert.ok(prompt.includes("relative size is also below"));
    assert.ok(prompt.includes("value >= 1% of market cap"));
    assert.ok(prompt.includes("missing comparison"));
    assert.ok(prompt.includes("Context use contract"));
    assert.ok(prompt.includes("market_context answers one question"));
    assert.ok(prompt.includes("filing_context answers one question"));
    assert.ok(prompt.includes("average_daily_dollar_volume may be"));
    assert.ok(prompt.includes("standalone feed trigger or alert gate"));
    assert.ok(prompt.includes("Prefer float/public_float"));
    assert.ok(prompt.includes("Filing context rules"));
    assert.ok(prompt.includes("same_insider_12m_trades"));
    assert.ok(prompt.includes("company_90d_insider_flow"));
    assert.ok(prompt.includes("recent_30d_cluster"));
    assert.ok(prompt.includes("related_form144_candidates"));
    assert.ok(prompt.includes("related_form4_execution_candidates"));
    assert.ok(prompt.includes("amendment_parent_candidate"));
    assert.ok(prompt.includes("same-insider 12-month count >= 3"));
    assert.ok(prompt.includes("Company-wide 90-day insider flow"));
    assert.ok(prompt.includes("Context-aware writing rules"));
    assert.ok(prompt.includes("Summary order must be"));
    assert.ok(prompt.includes("Current filing:"));
    assert.ok(prompt.includes("Market context:"));
    assert.ok(prompt.includes("Filing context:"));
    assert.ok(prompt.includes("Do not add \"context unavailable\""));
    assert.ok(prompt.includes("Do not mention filing_context in summary merely because it exists"));
    assert.ok(prompt.includes("Do not call or"));
    assert.ok(prompt.includes("FMP"));
    assert.ok(prompt.includes("re-read event_title before returning"));
});

test("ownership analysis input is compact, omits the full document, and preserves selected raw rows", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/form4-insider-purchase.json");
    const parserOutput = parseOwnershipFiling(fixture as never);
    const analysisInput = buildOwnershipAnalysisInput(parserOutput);
    const prompt = buildOwnershipAnalysisPrompt(parserOutput);

    assert.equal("raw" in analysisInput, false);
    assert.equal("selected_routing" in analysisInput, true);
    assert.equal("display_payload" in analysisInput, true);
    assert.equal((analysisInput as any).selected_routing.event_type, "insider_ownership");
    assert.equal((analysisInput as any).display_payload.data.display_version, "ownership_v1");
    assert.equal(prompt.includes("\"source_excerpt\""), false);
    assert.equal(prompt.includes("<ownershipDocument>"), false);
    assert.equal(prompt.includes("<nonDerivativeTransaction>"), true);
    assert.ok(prompt.includes("\"selected_evidence\""));
});

test("ownership analysis input preserves raw Form 4 evidence and explicit false without semantic answers", () => {
  const analysisInput = buildOwnershipAnalysisInput({
    parserVersion: "ownership-test",
    parserGroup: "ownership",
    formType: "Form 4 / 4/A, Form 144 / 144/A",
    accessionNumber: "0001654954-26-000843",
    isSupported: true,
    summary: "parser-authored semantic summary must not be passed",
    facts: {
      filing: { form_type: "4", aff_10b5_1: false, period_of_report: "2026-02-02" },
      issuer: { trading_symbol: "CMTV" },
      reporting_owners: [{
        name: "Caldwell Christopher L.",
        title: "Pres/CEO/Dir of Company & Bank",
        roles: ["director", "officer"],
        is_director: true,
        is_officer: true,
      }],
      form4: {
        has_purchase: true,
        total_reported_value: 31_771,
        transactions: [{
          transaction_kind: "non_derivative",
          transaction_code: "P",
          transaction_code_meaning: "parser semantic answer",
          transaction_category: "parser semantic answer",
          acquired_disposed_code: "A",
          security_title: "Community Bancorp. Common Stock",
          shares: 700,
          shares_text: "700.0000",
          shares_status: "numeric",
          price_per_share: 31.78,
          price_per_share_text: "31.7800",
          price_per_share_status: "numeric",
          transaction_value: 22_246,
          shares_owned_following: 10_700,
          shares_owned_following_text: "10700.0000",
          shares_owned_following_status: "numeric",
          footnote_ids: ["F1"],
          field_footnote_ids: { directOrIndirectOwnership: ["F1"] },
          evidence: ["<nonDerivativeTransaction>raw row</nonDerivativeTransaction>"],
        }],
      },
      footnotes: { F1: "Trust" },
      remarks: "Raw filing remark",
      signatures: [],
    },
    signals: ["insider_purchase"],
    calendarItems: [],
    warnings: [],
    raw: { selected_evidence: ["raw selected evidence"] },
  } as never) as any;

  const evidence = analysisInput.ownership_source_evidence;
  const transaction = evidence.form4.transactions[0];
  assert.equal(evidence.filing.source_aff10b5One, false);
  assert.deepEqual(evidence.reporting_owners[0].roles, ["director", "officer"]);
  assert.equal(transaction.raw_transaction_code, "P");
  assert.equal(transaction.raw_acquired_disposed_code, "A");
  assert.equal(transaction.derivative_structure, "non_derivative");
  assert.deepEqual(transaction.footnote_ids, ["F1"]);
  assert.deepEqual(evidence.footnotes, { F1: "Trust" });
  assert.equal(evidence.remarks, "Raw filing remark");
  assert.equal("economic_direction" in transaction, false);
  assert.equal("transaction_value" in transaction, false);
  assert.equal("transaction_code_meaning" in transaction, false);
  assert.equal("transaction_category" in transaction, false);
  assert.equal("signals" in analysisInput, false);
  assert.equal("summary" in analysisInput, false);
  assert.equal("filing_summary" in analysisInput.display_payload.data, false);
});

test("ownership analysis input never turns raw A/D into automatic economic direction", () => {
  const fixture = readJson<Record<string, unknown>>("fixtures/form4-multiple-owners-unknown-code.json");
  const input = buildOwnershipAnalysisInput(parseOwnershipFiling(fixture as never)) as any;
  for (const transaction of input.ownership_source_evidence.form4.transactions) {
    assert.equal("economic_direction" in transaction, false);
    assert.ok("raw_acquired_disposed_code" in transaction);
    assert.ok("raw_transaction_code" in transaction);
  }
  assert.ok(buildOwnershipAnalysisPrompt(parseOwnershipFiling(fixture as never)).includes("A/D value alone never determines"));
});

test("ownership analysis input preserves Form 144 raw units and conversion text without parser percent", () => {
  const analysisInput = buildOwnershipAnalysisInput({
    parserVersion: "ownership-test",
    parserGroup: "ownership",
    formType: "Form 4 / 4/A, Form 144 / 144/A",
    accessionNumber: "0001973379-26-000127",
    isSupported: true,
    facts: {
      filing: { form_type: "144" },
      issuer: { trading_symbol: "PDD" },
      reporting_owners: [{ name: "Kam Anthony Ping Leung", roles: ["director"], is_director: true }],
      form144: {
        remarks: "SECTION 3 C BASED ON ADS. SECTION 3E SHARES OR OTHER UNITS OUTSTANDING BASED ON ORDINARY SHARES.",
        proposed_sale_percent_of_shares_outstanding: 0.00002692,
        proposed_sale_rows: [{
          securities_class_title: "ADS EACH REPRESENTING FOUR CLASS A ORDINARY SHARES",
          securities_to_be_sold: 1533,
          securities_to_be_sold_text: "1533",
          securities_to_be_sold_status: "numeric",
          shares_outstanding: 5_693_585_848,
          shares_outstanding_text: "5693585848",
          shares_outstanding_status: "numeric",
          aggregate_market_value: 153_008.73,
          aggregate_market_value_text: "153008.73",
          aggregate_market_value_status: "numeric",
          evidence: ["<securitiesInformation>raw source row</securitiesInformation>"],
        }],
      },
      footnotes: {},
      remarks: "SECTION 3 C BASED ON ADS. SECTION 3E SHARES OR OTHER UNITS OUTSTANDING BASED ON ORDINARY SHARES.",
    },
    signals: ["form_144_proposed_sale"],
    calendarItems: [],
    warnings: [],
    raw: {},
  } as never) as any;

  const form144 = analysisInput.ownership_source_evidence.form144;
  assert.equal(form144.proposed_sale_rows[0].security_title_raw_unit_description, "ADS EACH REPRESENTING FOUR CLASS A ORDINARY SHARES");
  assert.equal(form144.proposed_sale_rows[0].proposed_sale_numerator.raw_text, "1533");
  assert.equal(form144.proposed_sale_rows[0].outstanding_denominator.raw_text, "5693585848");
  assert.match(form144.raw_remarks, /BASED ON ADS/);
  assert.equal("proposed_sale_percent_of_shares_outstanding" in form144, false);
});

test("ownership parser supplies routing and versioned UI payload before analysis", () => {
    const purchaseFixture = readJson<Record<string, unknown>>("fixtures/form4-insider-purchase.json");
    const unsupportedFixture = readJson<Record<string, unknown>>("fixtures/form4-empty-unsupported.json");
    const purchaseParserOutput = parseOwnershipFiling(purchaseFixture as never);
    const unsupportedParserOutput = parseOwnershipFiling(unsupportedFixture as never);

    const purchaseRouting = buildOwnershipRoutingDecision(purchaseParserOutput);
    const unsupportedRouting = buildOwnershipRoutingDecision(unsupportedParserOutput);
    const displayPayload = buildOwnershipDisplayPayload(purchaseParserOutput);

    assert.equal(purchaseRouting.router_used, false);
    assert.equal(purchaseRouting.event_type, "insider_ownership");
    assert.equal(purchaseRouting.display_type, "candidate_special");
    assert.equal(purchaseRouting.display_version, "ownership_v1");
    assert.equal(unsupportedRouting.event_type, "other");
    assert.equal(displayPayload.data.display_version, "ownership_v1");
    assert.equal(displayPayload.data.event_type, "insider_ownership");
    assert.equal(displayPayload.display_type, "candidate_special");
});

test("ownership adapter exposes live integration entrypoints", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/form4-insider-purchase.json");
    const parsed = parseOwnershipForm(fixture as never);
    const adapterParsed = ownershipAdapter.parse({
      id: "raw-fixture-form4",
      source_code: "4",
      source_unique_id: fixture.accessionNumber,
      body_text: fixture.filingText,
      raw_payload: {
        accession_number: fixture.accessionNumber,
      },
      metadata: {},
    }, "4");

    assert.equal(ownershipAdapterKey, "ownership");
    assert.equal(ownershipParserGroup, "ownership");
    assert.deepEqual([...ownershipSupportedForms], ["4", "4/A", "144", "144/A"]);
    assert.equal(ownershipAnalysisMode, "ownership_direct_analysis");
    assert.equal(ownershipAdapter.routerRequired, false);
    assert.equal("tryDeterministicResult" in ownershipAdapter, false);
    assert.equal("buildDeterministicResult" in ownershipAdapter, false);
    assert.equal(ownershipAdapter.parserGroup, "ownership");
    assert.equal(ownershipAdapter.key, "ownership");
    assert.equal(parsed.parserGroup, "ownership");
    assert.equal(adapterParsed.ownershipParsed?.parserGroup, "ownership");
    assert.equal(typeof ownershipAdapter.buildAnalysisPrompt(parsed), "string");
    assert.equal(ownershipAdapter.buildDisplayPayload(parsed).data.display_version, "ownership_v1");
});

test("ownership analysis prompt does not require filing context output", () => {
    const fixture = readJson<Record<string, unknown>>("fixtures/form4-insider-purchase.json");
    assert.equal("filing_context" in fixture, false);

    const parserOutput = parseOwnershipFiling(fixture as never);
    const prompt = buildOwnershipAnalysisPrompt(parserOutput);
    const analysisInput = buildOwnershipAnalysisInput(parserOutput) as Record<string, unknown>;

    assert.ok(prompt.includes("\"parserGroup\": \"ownership\""));
    assert.equal("filing_context" in analysisInput, false);
    assert.ok(prompt.includes("filing_context is optional"));
    assert.ok(prompt.includes("same_insider_12m_trades"));
    assert.ok(prompt.includes("company_90d_insider_flow"));
    assert.ok(prompt.includes("recent_30d_cluster"));
});

test("ownership FMP market context helper is dev-only and shapes optional market_context", async () => {
    const requestedUrls: string[] = [];
    const context = await fetchFmpOwnershipMarketContext("atri", {
      apiKey: "test-key",
      baseUrl: "https://example.test/api",
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      fetcher: async (url) => {
        requestedUrls.push(url);
        if (url.includes("/quote?symbol=ATRI")) {
          return {
            ok: true,
            json: async () => [{
              symbol: "ATRI",
              price: 20,
              marketCap: 2_000_000_000,
              sharesOutstanding: 100_000_000,
              avgVolume: 500_000,
              currency: "USD",
            }],
          };
        }
        if (url.includes("/profile?symbol=ATRI")) {
          return { ok: true, json: async () => [{ symbol: "ATRI", mktCap: 1_900_000_000 }] };
        }
        if (url.includes("/shares-float?symbol=ATRI")) {
          return { ok: true, json: async () => [{ symbol: "ATRI", floatShares: 80_000_000 }] };
        }
        throw new Error(`unexpected test URL: ${url}`);
      },
    });

    assert.equal(context.symbol, "ATRI");
    assert.equal(context.source, "fmp_test_helper");
    assert.equal(context.retrieved_at, "2026-06-01T00:00:00.000Z");
    assert.equal(context.market_cap, 2_000_000_000);
    assert.equal(context.shares_outstanding, 100_000_000);
    assert.equal(context.float, 80_000_000);
    assert.equal(context.public_float, 80_000_000);
    assert.equal(context.average_daily_dollar_volume, 10_000_000);
    assert.equal(context.last_price, 20);
    assert.ok(context.source_notes.includes(OWNERSHIP_FMP_MARKET_CONTEXT_HELPER_NOTE));
    assert.equal(requestedUrls.length, 3);
});

test("ownership FMP market context helper can shape supplied responses without live FMP", () => {
    const context = buildFmpOwnershipMarketContextFromResponses("nscp", {
      retrievedAt: "2026-06-01T01:00:00.000Z",
      quote: [{ price: "12.50", marketCap: "750000000", avgVolume: "100000" }],
      floatData: [{ outstandingShares: "60000000", floatShares: "45000000" }],
    });

    assert.equal(context.symbol, "NSCP");
    assert.equal(context.market_cap, 750_000_000);
    assert.equal(context.shares_outstanding, 60_000_000);
    assert.equal(context.float, 45_000_000);
    assert.equal(context.average_daily_dollar_volume, 1_250_000);
    assert.ok(context.source_notes[0].includes("test-only"));
});

test("ownership parser preserves routing and display inputs for all LLM-analyzed ownership forms", () => {
    for (const [formType, fixturePath] of [
      ["4", "fixtures/form4-insider-purchase.json"],
      ["4/A", "fixtures/form4a-admin-amendment.json"],
      ["144", "fixtures/form144-routine-proposed-sale.json"],
      ["144/A", "fixtures/form144a-material-increase.json"],
    ] as const) {
      const parserOutput = parseOwnershipFiling(readJson<Record<string, unknown>>(fixturePath) as never);
      const routing = buildOwnershipRoutingDecision(parserOutput);
      const displayPayload = buildOwnershipDisplayPayload(parserOutput);

      assert.equal((parserOutput.facts as any).filing.form_type, formType);
      assert.equal(routing.router_used, false);
      assert.equal(displayPayload.data.display_version, "ownership_v1");
      assert.ok(buildOwnershipAnalysisPrompt(parserOutput).includes("final SEC Ownership filing analysis LLM"));
    }
});
