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
  buildDeterministicOwnershipResult,
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
    assert.ok(prompt.includes("Form 4 actual P/S: shares are at least 1.0% of float/public_float"));
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
    assert.ok(prompt.includes("Use \"open-market purchase\" or \"open-market sale\" only when parser facts"));
    assert.ok(prompt.includes("Form 4 scoring caps"));
    assert.ok(prompt.includes("Form 144 scoring caps"));
    assert.ok(prompt.includes("Clean P/S below $1M"));
    assert.ok(prompt.includes("CEO/CFO P/S of $500k-$1M"));
    assert.ok(prompt.includes("Proposed sale below $5M"));
    assert.ok(prompt.includes("prior three-month gross proceeds below $10M"));
    assert.ok(prompt.includes("Alert gate"));
    assert.ok(prompt.includes("absolute size plus source-backed relative size"));
    assert.ok(prompt.includes("Form 4 alert gate applies only to actual P/S rows"));
    assert.ok(prompt.includes("value > $500k and shares >= 20% of float/public_float"));
    assert.ok(prompt.includes("value > $1M and value >= 10% of market cap"));
    assert.ok(prompt.includes("Form 4 transactions below $500k cannot be alert"));
    assert.ok(prompt.includes("Filing_context is not required for Form 4 alert"));
    assert.ok(prompt.includes("Without filing_context, Form 4 alert scores should usually stay 75-82"));
    assert.ok(prompt.includes("proposed value > $2.5M and proposed shares >= 20% of float/public_float"));
    assert.ok(prompt.includes("proposed value below $2.5M cannot be alert"));
    assert.ok(prompt.includes("filing_context is optional"));
    assert.ok(prompt.includes("parent_filing_context"));
    assert.ok(prompt.includes("parser-provided filing_summary"));
    assert.ok(prompt.includes("keep two facts separate: the current filing's proposed sale"));
    assert.ok(prompt.includes("clarifies the prior-sale history"));
    assert.ok(prompt.includes("attach the withholding language to those prior reported sales"));
    assert.ok(prompt.includes("remarks-only"));
    assert.ok(prompt.includes("proposed sale amount, value, or date were unchanged"));
    assert.ok(prompt.includes("a summary that only describes the remark is incomplete"));
    assert.ok(prompt.includes("do not reuse a parser-provided"));
    assert.ok(prompt.includes("omits what remained unchanged"));
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

test("ownership analysis input is compact and omits full raw XML by default", () => {
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
    assert.equal(prompt.includes("<nonDerivativeTransaction>"), false);
    assert.ok(prompt.includes("\"selected_evidence\""));
});

test("ownership analysis input seeds archive-safe filing summaries without abbreviation sentence breaks", () => {
    const analysisInput = buildOwnershipAnalysisInput({
      parserVersion: "ownership-test",
      parserGroup: "ownership",
      formType: "Form 4 / 4/A, Form 144 / 144/A",
      accessionNumber: "0000000000-26-000001",
      isSupported: true,
      summary: null,
      facts: {
        filing: { form_type: "Form 4" },
        issuer: { trading_symbol: "SION", name: "Sionna Therapeutics, Inc." },
        reporting_owner: { name: "Peter A. Thompson" },
        form4: {
          transactions: [
            {
              transaction_code: "S",
              shares: 101,
              price_per_share: 44.49,
              transaction_value: 4493.49,
              transaction_date: "2026-05-27",
              shares_owned_following: 2671721,
            },
          ],
        },
      },
      signals: ["rule_10b5_1_plan"],
      calendarItems: [],
      warnings: [],
      raw: {},
    } as never);

    const filingSummary = (analysisInput as any).display_payload.data.filing_summary;
    assert.ok(filingSummary.startsWith("Form 4:"));
    assert.ok(filingSummary.includes("Peter A Thompson"));
    assert.ok(filingSummary.includes("reported a sale of 101 SION shares"));
    assert.ok(filingSummary.includes("on 2026-05-27 at $44.49 per share, totaling about $4,493.49"));
    assert.ok(filingSummary.includes("with post-transaction holdings of 2,671,721 shares"));
    assert.ok(filingSummary.includes("$4,493.49"));
    assert.equal(filingSummary.includes("shares; on"), false);
    assert.equal(filingSummary.includes("; at"), false);
    assert.equal(filingSummary.includes("; for"), false);
    assert.equal(filingSummary.includes("; post-transaction"), false);
    assert.equal(filingSummary.includes("Peter A."), false);
    assert.equal(filingSummary.includes("Inc."), false);
});

test("ownership analysis input aggregates same-code Form 4 rows in seeded filing summaries", () => {
    const analysisInput = buildOwnershipAnalysisInput({
      parserVersion: "ownership-test",
      parserGroup: "ownership",
      formType: "Form 4 / 4/A, Form 144 / 144/A",
      accessionNumber: "0000000000-26-000002",
      isSupported: true,
      summary: null,
      facts: {
        filing: { form_type: "4" },
        issuer: { trading_symbol: "HY", name: "Hyster-Yale, Inc." },
        reporting_owner: { name: "Rankin Victoire G" },
        form4: {
          transactions: [
            {
              transaction_code: "G",
              security_title: "Class B shares",
              shares: 635,
              transaction_value: 0,
              transaction_date: "2026-05-29",
              shares_owned_following: 0,
            },
            {
              transaction_code: "G",
              security_title: "Class B shares",
              shares: 377,
              transaction_value: 0,
              transaction_date: "2026-05-29",
              shares_owned_following: 0,
            },
          ],
        },
      },
      signals: ["insider_gift"],
      calendarItems: [],
      warnings: [],
      raw: {},
    } as never);

    const filingSummary = (analysisInput as any).display_payload.data.filing_summary;
    assert.equal(
      filingSummary,
      "Form 4: Rankin Victoire G reported gifts of 1,012 HY Class B shares on 2026-05-29, with $0 reported value and post-transaction holdings of 0 shares.",
    );
    assert.equal(filingSummary.includes("635 shares"), false);
});

test("ownership analysis input seeds Form 144/A amendment summaries from source-backed seller names", () => {
    const analysisInput = buildOwnershipAnalysisInput({
      parserVersion: "ownership-test",
      parserGroup: "ownership",
      formType: "Form 4 / 4/A, Form 144 / 144/A",
      accessionNumber: "0000000000-26-000003",
      isSupported: true,
      summary: "This amendment clarifies prior sales.",
      facts: {
        filing: { form_type: "144/A" },
        issuer: { trading_symbol: "ODD", name: "Oddity Tech Ltd" },
        reporting_owner: { name: "Drucker Mann Lindsay" },
        form144: {
          previous_accession_number: "0001976408-26-000526",
          proposed_sale_rows: [
            {
              seller_name: "Lindsay Drucker Mann",
              shares_or_units: 9603,
              aggregate_market_value: 129736.53,
              approximate_sale_date: "06/01/2026",
            },
          ],
          prior_sales: [
            {
              seller_name: "Lindsay Drucker Mann",
              amount_of_securities_sold: 9604,
              sale_date: "03/31/2026",
            },
          ],
        },
        amendment: {
          previous_accession_number: "0001976408-26-000526",
          local_comparison: {
            labels: ["REMARKS_ONLY"],
            changed_fields: ["remarks"],
          },
        },
      },
      signals: ["form_144_proposed_sale"],
      calendarItems: [],
      warnings: [],
      raw: {},
    } as never);

    const filingSummary = (analysisInput as any).display_payload.data.filing_summary;
    assert.equal(
      filingSummary,
      "Lindsay Drucker Mann's Form 144/A amendment added a remark about prior reported sales; the proposed-sale terms remained 9,603 shares, about $129,736.53, approximate sale date 06/01/2026 from original Form 144 0001976408-26-000526.",
    );
    assert.equal(filingSummary.includes("Drucker Mann Lindsay"), false);
    assert.equal(filingSummary.startsWith("Form 144/A:"), false);
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

test("ownership parser retains deterministic reference outputs for routing and display preservation", () => {
    const adminFixture = readJson<Record<string, unknown>>("fixtures/form4a-admin-amendment.json");
    const routineFixture = readJson<Record<string, unknown>>("fixtures/form144-routine-proposed-sale.json");
    const grantFixture = readJson<Record<string, unknown>>("fixtures/form4-routine-rsu-grant.json");
    const routineExpected = readJson<any>("expected/form144-routine-proposed-sale.expected.json");
    const grantExpected = readJson<any>("expected/form4-routine-rsu-grant.expected.json");

    const adminResult = buildDeterministicOwnershipResult(parseOwnershipFiling(adminFixture as never));
    const routineResult = buildDeterministicOwnershipResult(parseOwnershipFiling(routineFixture as never));
    const grantResult = buildDeterministicOwnershipResult(parseOwnershipFiling(grantFixture as never));

    assert.equal(adminResult, null);
    assert.deepEqual(routineResult?.analysis_output, routineExpected.analysis_output);
    assert.deepEqual(routineResult?.display_payload, routineExpected.display_payload);
    assert.deepEqual(grantResult?.analysis_output, grantExpected.analysis_output);
    assert.deepEqual(grantResult?.display_payload, grantExpected.display_payload);
});
