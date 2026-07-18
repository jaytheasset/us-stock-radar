import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  adaptSecTenderAnalysisPromptResultForAnalysis,
  buildSecTenderValidationRepairPlan,
} from "./secTenderAnalysisAdapter";
import { parseSecTenderFiling } from "../sources/sec/forms/tender/parser";

const fixturePath = join(process.cwd(), "lib/sources/sec/forms/tender/expected/third-party-acquisition-tender.expected.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
const analysisOutput = structuredClone(fixture.analysis_output as Record<string, unknown>);
const transactionFingerprint = structuredClone(fixture.transaction_fingerprint as Record<string, unknown>);

analysisOutput.primary_ticker = { ticker: "DSX", exchange: "NYSE" };
analysisOutput.tickers = [{ ticker: "DSX", exchange: "NYSE", role: "primary" }];
analysisOutput.related_tickers = [{ ticker: "GNK", exchange: "NYSE", reason: "Target company ticker." }];
transactionFingerprint.target_ticker = "GNK";

const result = adaptSecTenderAnalysisPromptResultForAnalysis(
  {
    analysis_output: analysisOutput,
    display_payload: fixture.display_payload,
    transaction_fingerprint: transactionFingerprint,
  },
  {
    filing_package: {
      primary_ticker: { ticker: "DSX", exchange: "NYSE" },
      market_context: { symbol: "GNK", exchange: "NYSE" },
      hard_parsers: {
        tender: fixture.parser_output,
      },
    },
  },
);

assert.equal(result.ok, true);

const primaryTicker = result.analysis.primary_ticker as Record<string, unknown>;
assert.equal(primaryTicker.ticker, "DSX");
assert.equal(primaryTicker.exchange, "NYSE");

const tickers = result.analysis.tickers as Array<Record<string, unknown>>;
assert.deepEqual(tickers.map((ticker) => ticker.ticker), ["DSX"]);

const relatedTickers = result.analysis.related_tickers as Array<Record<string, unknown>>;
assert.ok(relatedTickers.some((ticker) => ticker.ticker === "GNK"));
assert.ok(!relatedTickers.some((ticker) => ticker.ticker === "DSX"));

const issuerAnalysisOutput = structuredClone(fixture.analysis_output as Record<string, unknown>);
const issuerTransactionFingerprint = structuredClone(fixture.transaction_fingerprint as Record<string, unknown>);
issuerAnalysisOutput.primary_ticker = { ticker: "SAN", exchange: "NYSE" };
issuerAnalysisOutput.tickers = [{ ticker: "SAN", exchange: "NYSE", role: "primary" }];
issuerAnalysisOutput.related_tickers = [{ ticker: "SAN", exchange: "NYSE", reason: "Duplicate self-tender ticker." }];
issuerTransactionFingerprint.target_ticker = "SAN";

const issuerResult = adaptSecTenderAnalysisPromptResultForAnalysis(
  {
    analysis_output: issuerAnalysisOutput,
    display_payload: fixture.display_payload,
    transaction_fingerprint: issuerTransactionFingerprint,
  },
  {
    filing_package: {
      primary_ticker: { ticker: "SAN", exchange: "NYSE" },
      market_context: { symbol: "SAN", exchange: "NYSE" },
      hard_parsers: {
        tender: fixture.parser_output,
      },
    },
  },
);

assert.equal(issuerResult.ok, true);
assert.equal((issuerResult.analysis.primary_ticker as Record<string, unknown>).ticker, "SAN");
assert.deepEqual(issuerResult.analysis.related_tickers, []);

const cbListedPrimaryOutput = structuredClone(fixture.analysis_output as Record<string, unknown>);
const cbListedFingerprint = structuredClone(fixture.transaction_fingerprint as Record<string, unknown>);
cbListedPrimaryOutput.primary_ticker = { ticker: "MGIC", exchange: "NASDAQ" };
cbListedPrimaryOutput.tickers = [{ ticker: "MGIC", exchange: "NASDAQ", role: "primary" }];
cbListedPrimaryOutput.related_tickers = [];
cbListedFingerprint.transaction_family = "cross_border";
cbListedFingerprint.transaction_type = "exchange_offer";
cbListedFingerprint.target_ticker = "MGIC";

const cbListedResult = adaptSecTenderAnalysisPromptResultForAnalysis(
  {
    analysis_output: cbListedPrimaryOutput,
    display_payload: fixture.display_payload,
    transaction_fingerprint: cbListedFingerprint,
  },
  {
    filing_package: {
      form_type: "CB",
      primary_ticker: { ticker: "RMTHF", exchange: "Other OTC" },
      market_context: { symbol: "RMTHF", exchange: "Other OTC" },
      hard_parsers: {
        tender: fixture.parser_output,
      },
    },
  },
);

assert.equal(cbListedResult.ok, true);
assert.equal((cbListedResult.analysis.primary_ticker as Record<string, unknown>).ticker, "RMTHF");
assert.deepEqual((cbListedResult.analysis.tickers as Array<Record<string, unknown>>).map((ticker) => ticker.ticker), ["RMTHF"]);
assert.ok((cbListedResult.analysis.related_tickers as Array<Record<string, unknown>>).some((ticker) => ticker.ticker === "MGIC"));

const smallResultAnalysisOutput = {
  ...structuredClone(fixture.analysis_output as Record<string, unknown>),
  event_type: "capital_return",
  score: 78,
  delivery_level: "alert",
  score_reason: "Issuer tender with ~22% premium and ~1.9% expected acceptance.",
  quick_take: "Hyperscale reports preliminary results of a $0.21 cash issuer tender to repurchase ~8.85M Class A shares (~1.9%).",
  summary:
    "The company expects to accept 8,854,659 shares at $0.21 per share for approximately USD 1.86 million, about 1.9% of outstanding Class A shares.",
  key_evidence: [
    "Exhibit press release: expected acceptance 8,854,659 shares; aggregate approximately USD 1.86 million; represents about 1.9% of Class A outstanding.",
  ],
  primary_ticker: { ticker: "GPUS", exchange: "NYSE American" },
  tickers: [{ ticker: "GPUS", exchange: "NYSE American" }],
  related_tickers: [],
};
const smallResultFingerprint = {
  ...structuredClone(fixture.transaction_fingerprint as Record<string, unknown>),
  transaction_family: "issuer_repurchase",
  transaction_type: "issuer_tender",
  target_ticker: "GPUS",
  amendment_number: "2",
  cash_price: "USD 0.21 per share",
  offer_size: "Accepted 8,854,659 shares for approximately USD 1.86 million, about 1.9% of Class A outstanding.",
};

const smallResult = adaptSecTenderAnalysisPromptResultForAnalysis(
  {
    analysis_output: smallResultAnalysisOutput,
    display_payload: fixture.display_payload,
    transaction_fingerprint: smallResultFingerprint,
  },
  {
    filing_package: {
      form_type: "SC TO-I/A",
      primary_ticker: { ticker: "GPUS", exchange: "NYSE American" },
      market_context: { symbol: "GPUS", exchange: "NYSE American" },
      hard_parsers: {
        tender: fixture.parser_output,
      },
    },
  },
);

assert.equal(smallResult.ok, true);
assert.equal(smallResult.analysis.score, 68);
assert.equal(smallResult.analysis.delivery_level, "feed");
assert.equal(smallResult.analysis.score_reason, "Small accepted scale caps tender result below alert.");

const cbCompletionResult = adaptSecTenderAnalysisPromptResultForAnalysis(
  {
    analysis_output: {
      ...structuredClone(fixture.analysis_output as Record<string, unknown>),
      event_type: "strategic_transaction",
      score: 78,
      delivery_level: "alert",
      score_reason: "Merger completion removes public trading liquidity.",
      quick_take: "Matrix IT received the merger certificate and completed the merger with Magic Software.",
      summary:
        "The Form CB/A attaches notices of receipt of the merger certificate and completion of the merger transaction. It does not provide U.S.-dollar cash consideration or accepted-share details.",
      key_evidence: [
        "Exhibit 99.1: notice of receipt of merger certificate and completion date.",
        "Exhibit 99.2: notice of completion of the merger transaction.",
      ],
      primary_ticker: { ticker: "RMTHF", exchange: "OTC" },
      tickers: [{ ticker: "RMTHF", exchange: "OTC" }],
      related_tickers: [],
    },
    display_payload: fixture.display_payload,
    transaction_fingerprint: {
      ...structuredClone(fixture.transaction_fingerprint as Record<string, unknown>),
      transaction_family: "cross_border",
      transaction_type: "cross_border_exchange_offer",
      target_ticker: "RMTHF",
      amendment_number: "5",
    },
  },
  {
    filing_package: {
      form_type: "CB/A",
      primary_ticker: { ticker: "RMTHF", exchange: "OTC" },
      market_context: { symbol: "RMTHF", exchange: "OTC" },
      hard_parsers: {
        tender: fixture.parser_output,
      },
    },
  },
);

assert.equal(cbCompletionResult.ok, true);
assert.equal(cbCompletionResult.analysis.score, 74);
assert.equal(cbCompletionResult.analysis.delivery_level, "feed");
assert.equal(
  cbCompletionResult.analysis.score_reason,
  "Completion notice lacks new holder-economics or trading-impact details required for alert.",
);

const rupeeResult = adaptSecTenderAnalysisPromptResultForAnalysis(
  {
    analysis_output: {
      ...issuerAnalysisOutput,
      title: "Wipro proposes buyback at ₹250",
      quick_take: "Wipro proposes a local-share buyback at ₹250 per share.",
      summary: "Wipro approved a tender buyback of local equity shares at ₹250 per share.",
      key_evidence: ["Board approval: up to 600,000,000 shares at ₹250 per equity share."],
    },
    display_payload: {
      ...structuredClone(fixture.display_payload as Record<string, unknown>),
      data: {
        ...(fixture.display_payload as Record<string, Record<string, unknown>>).data,
        filing_summary: "Wipro proposes a tender buyback at ₹250 per local equity share.",
      },
    },
    transaction_fingerprint: {
      ...issuerTransactionFingerprint,
      target_ticker: "WIT",
      cash_price: "₹250 per local equity share",
    },
  },
  {
    filing_package: {
      form_type: "CB",
      primary_ticker: { ticker: "WIT", exchange: "NYSE" },
      market_context: { symbol: "WIT", exchange: "NYSE" },
      hard_parsers: {
        tender: fixture.parser_output,
      },
    },
  },
);

assert.equal(rupeeResult.ok, true);
assert.equal(rupeeResult.analysis.title, "Wipro proposes buyback at INR 250");
assert.match(String(rupeeResult.analysis.summary), /INR 250 per share/);

const stalePremiumParserOutput = parseSecTenderFiling({
  sourceUniqueId: "0001193125-24-181268",
  publishedAt: "2024-07-23",
  bodyText: "SC TO-T tender offer at $57.00 per Share in cash.",
  rawPayload: { form_type: "SC TO-T", accession_number: "0001193125-24-181268" },
  attachmentTexts: [
    {
      type: "EX-99.(A)(1)(A)",
      description: "Offer to Purchase",
      text: [
        "The Offer Price is $57.00 per Share in cash.",
        "The unaffected closing price on July 5, 2024, the last full trading day before public announcement of the merger, was $31.84 per Share.",
      ].join(" "),
    },
  ],
});

const stalePremiumRepairPlan = buildSecTenderValidationRepairPlan({
  analysisResult: {
    analysis_output: {
      event_title: "Morphic tender offer closes at a 0.05% premium",
      quick_take: "The $57 offer represents a 0.05% premium to the current quote.",
      summary: "The transaction pays $57 per share, a 0.05% premium to the current market price.",
      score_reason: "The small premium limits the holder benefit.",
      key_evidence: [],
      bullish_points: [],
      bearish_points: [],
      what_to_watch_next: [],
    },
  },
  input: {
    filing_package: {
      form_type: "SC TO-T",
      filed_at: "2024-07-23",
      llm_text: "SC TO-T tender offer at $57.00 per Share in cash.",
      market_context: {
        price: 56.97,
        previous_close: 56.97,
        as_of: "2026-07-18T00:00:00.000Z",
      },
      hard_parsers: {
        tender: stalePremiumParserOutput,
      },
    },
  },
});

assert.ok(stalePremiumRepairPlan);
assert.ok(stalePremiumRepairPlan.sourceBlockIds.length > 0 && stalePremiumRepairPlan.sourceBlockIds.length <= 3);
assert.ok(stalePremiumRepairPlan.issues.some((issue) => issue.code === "stale_market_context_premium"));
assert.ok(stalePremiumRepairPlan.allowedPatchPaths.includes("/analysis_output/quick_take"));
assert.ok(stalePremiumRepairPlan.prompt.user.includes("31.84"));
assert.ok(stalePremiumRepairPlan.prompt.system.includes("Never compare a historical offer price"));

const indianGroupingResult = adaptSecTenderAnalysisPromptResultForAnalysis(
  {
    analysis_output: {
      ...issuerAnalysisOutput,
      title: "Wipro proposes buyback of up to 60,00,00,000 shares at INR 250",
      quick_take: "Wipro proposes a local-share buyback at INR 250 per share.",
      summary: "Wipro approved a tender buyback of up to 60,00,00,000 local equity shares at INR 250 per share.",
      key_evidence: [
        "Board approval: up to 60,00,00,000 shares at INR 250 per equity share for up to INR 1,50,00,00,00,000.",
      ],
    },
    display_payload: {
      ...structuredClone(fixture.display_payload as Record<string, unknown>),
      data: {
        ...(fixture.display_payload as Record<string, Record<string, unknown>>).data,
        filing_summary: "Wipro proposes a tender buyback of up to 60,00,00,000 shares at INR 250 per local equity share.",
      },
    },
    transaction_fingerprint: {
      ...issuerTransactionFingerprint,
      target_ticker: "WIT",
      cash_price: "INR 250 per local equity share; up to 60,00,00,000 shares",
    },
  },
  {
    filing_package: {
      form_type: "CB",
      primary_ticker: { ticker: "WIT", exchange: "NYSE" },
      market_context: { symbol: "WIT", exchange: "NYSE" },
      hard_parsers: {
        tender: fixture.parser_output,
      },
    },
  },
);

assert.equal(indianGroupingResult.ok, true);
assert.equal(indianGroupingResult.analysis.title, "Wipro proposes buyback of up to 600,000,000 shares at INR 250");
assert.match(String(indianGroupingResult.analysis.summary), /600,000,000 local equity shares/);
assert.match(JSON.stringify(indianGroupingResult.analysis), /150,000,000,000/);
assert.ok(!JSON.stringify(indianGroupingResult.analysis).includes("60,00,00,000"));
assert.match(JSON.stringify(rupeeResult.analysis), /INR 250/);

console.log("sec tender analysis adapter normalization tests passed");
