import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SEC_TENDER_ANALYSIS_PROMPT_KEY,
  SEC_TENDER_ANALYSIS_PROMPT_VERSION,
  buildSecTenderAnalysisPromptDraft,
  secTenderAnalysisSystemPrompt,
  secTenderRequiredOutputSchema,
} from "./analysisPrompt";
import { parseSecTenderFiling } from "./parser";
import { buildSecTenderSourceBlockPromptInput } from "./sourceBlockPromptInput";
import {
  SEC_TENDER_APPROVED_EVENT_TYPES,
  SEC_TENDER_DISPLAY_PAYLOAD_VERSION,
  isSecTenderApprovedEventType,
  secTenderDeliveryLevelForScore,
  type SecTenderExpectedOutput,
} from "./types";

const expectedDir = join(process.cwd(), "lib", "sources", "sec", "forms", "tender", "expected");

const topLevelKeys = ["analysis_output", "display_payload", "fixture_expected", "parser_output", "transaction_fingerprint"].sort();
const parserKeys = [
  "accessionNumber",
  "calendarItems",
  "facts",
  "formType",
  "isSupported",
  "parserGroup",
  "parserVersion",
  "raw",
  "signals",
  "summary",
  "warnings",
].sort();
const analysisKeys = [
  "bearish_points",
  "bullish_points",
  "calendar_items",
  "confidence",
  "event_title",
  "event_type",
  "industry_group",
  "key_evidence",
  "market_scope",
  "needs_human_review",
  "primary_ticker",
  "quick_take",
  "related_tickers",
  "score",
  "score_reason",
  "sector",
  "signal",
  "source_group",
  "sub_theme",
  "summary",
  "theme_group",
  "tickers",
  "what_to_watch_next",
  "why_it_matters",
].sort();
const displayKeys = ["data", "display_type", "evidence", "notes"].sort();
const fixtureExpectedKeys = [
  "expected_delivery_level",
  "expected_impact",
  "integration_notes",
  "market_context_fields",
  "market_context_needed",
  "market_context_reason",
  "special_ui_needed",
  "special_ui_reason",
].sort();
const transactionFingerprintKeys = [
  "amendment_change_type",
  "amendment_number",
  "buyer_group",
  "buyer_parent",
  "cash_price",
  "consideration_summary",
  "exchange_ratio",
  "expected_closing",
  "filing_persons",
  "final_result_date",
  "financing_condition",
  "material_terms_changed",
  "merger_agreement_date",
  "minimum_condition",
  "offer_expiration",
  "offer_size",
  "offeror",
  "securities_sought",
  "source_accession",
  "source_evidence",
  "source_forms",
  "target_company",
  "target_ticker",
  "transaction_family",
  "transaction_type",
].sort();

for (const name of [
  "issuer-tender-capital-return.expected.json",
  "third-party-acquisition-tender.expected.json",
  "schedule-13e3-going-private.expected.json",
  "schedule-cb-cross-border-exchange.expected.json",
  "material-amendment-deadline-price.expected.json",
  "routine-amendment-deterministic.expected.json",
]) {
  const expected = readExpected(name);
  assert.deepEqual(Object.keys(expected).sort(), topLevelKeys, `${name} top-level shape`);
  assert.deepEqual(Object.keys(expected.parser_output).sort(), parserKeys, `${name} parser_output shape`);
  assert.deepEqual(Object.keys(expected.analysis_output).sort(), analysisKeys, `${name} analysis_output shape`);
  assert.deepEqual(Object.keys(expected.display_payload).sort(), displayKeys, `${name} display_payload shape`);
  assert.deepEqual(Object.keys(expected.transaction_fingerprint).sort(), transactionFingerprintKeys, `${name} transaction_fingerprint shape`);
  assert.deepEqual(Object.keys(expected.fixture_expected).sort(), fixtureExpectedKeys, `${name} fixture_expected shape`);
  assert.equal(expected.parser_output.parserGroup, "tender");
  assert.equal(expected.parser_output.formType, "Tender / CB / 13E3");
  assert.equal(expected.analysis_output.source_group, "filings");
  assert.ok(isSecTenderApprovedEventType(expected.analysis_output.event_type), `${name} approved event type`);
  assert.equal(secTenderDeliveryLevelForScore(expected.analysis_output.score), expected.fixture_expected.expected_delivery_level);
  assert.equal(expected.display_payload.display_type, "generic");
  assert.equal(expected.transaction_fingerprint.source_accession, expected.parser_output.accessionNumber);
  assert.ok(expected.transaction_fingerprint.source_evidence.length > 0, `${name} fingerprint evidence`);
  assert.ok(expected.transaction_fingerprint.source_evidence.every((item) => item.length <= 180), `${name} compact fingerprint evidence`);
}

const issuerFingerprint = readExpected("issuer-tender-capital-return.expected.json").transaction_fingerprint;
assert.equal(issuerFingerprint.transaction_family, "issuer_repurchase");
assert.equal(issuerFingerprint.transaction_type, "issuer_tender");
assert.equal(issuerFingerprint.offer_size, "$50 million aggregate purchase price");
assert.equal(issuerFingerprint.securities_sought, "up to 2,000,000 shares");
assert.equal(issuerFingerprint.offer_expiration, "2026-06-20");

const schedule13e3Fingerprint = readExpected("schedule-13e3-going-private.expected.json").transaction_fingerprint;
assert.equal(schedule13e3Fingerprint.transaction_family, "going_private");
assert.equal(schedule13e3Fingerprint.transaction_type, "going_private_cash_out");
assert.equal(schedule13e3Fingerprint.target_company, "Harbor Foods Group Inc.");
assert.equal(schedule13e3Fingerprint.cash_price, "$11.25 per share");
assert.ok(schedule13e3Fingerprint.filing_persons.includes("Harbor Foods Group Inc."));

const cbFingerprint = readExpected("schedule-cb-cross-border-exchange.expected.json").transaction_fingerprint;
assert.equal(cbFingerprint.transaction_family, "cross_border");
assert.equal(cbFingerprint.transaction_type, "exchange_offer");
assert.equal(cbFingerprint.exchange_ratio, "0.75 EuroMed plc ordinary shares for each BioThera ADS");
assert.ok(Boolean(cbFingerprint.consideration_summary));

const amendmentFingerprint = readExpected("material-amendment-deadline-price.expected.json").transaction_fingerprint;
assert.equal(amendmentFingerprint.transaction_family, "tender_offer");
assert.equal(amendmentFingerprint.transaction_type, "amendment_update");
assert.equal(amendmentFingerprint.amendment_change_type, "price_change");
assert.deepEqual(amendmentFingerprint.material_terms_changed, ["price", "deadline"]);
assert.equal(amendmentFingerprint.source_accession, "0002222222-26-000025");

const routineFingerprint = readExpected("routine-amendment-deterministic.expected.json").transaction_fingerprint;
assert.equal(routineFingerprint.transaction_type, "amendment_update");
assert.equal(routineFingerprint.amendment_change_type, "no_material_change");
assert.deepEqual(routineFingerprint.material_terms_changed, []);

const routineAmendmentExpected = readExpected("routine-amendment-deterministic.expected.json");
assert.equal(routineAmendmentExpected.analysis_output.event_type, "other");
assert.equal(routineAmendmentExpected.fixture_expected.expected_delivery_level, "archive");
assert.equal(routineAmendmentExpected.fixture_expected.market_context_needed, false);
assert.ok(!routineAmendmentExpected.fixture_expected.integration_notes.some((note) => /without calling the analysis LLM/i.test(note)));

const schemaEventEnum = secTenderRequiredOutputSchema.properties.analysis_output.properties.event_type.enum;
assert.deepEqual(schemaEventEnum, SEC_TENDER_APPROVED_EVENT_TYPES);
assert.deepEqual(secTenderRequiredOutputSchema.properties.display_payload.properties.display_type.enum, [
  "generic",
]);
assert.deepEqual(secTenderRequiredOutputSchema.required, ["analysis_output", "display_payload", "transaction_fingerprint"]);
assert.equal(secTenderRequiredOutputSchema.properties.transaction_fingerprint.additionalProperties, false);
assert.deepEqual(secTenderRequiredOutputSchema.properties.transaction_fingerprint.properties.transaction_family.enum, [
  "tender_offer",
  "going_private",
  "exchange_offer",
  "cross_border",
  "issuer_repurchase",
  "other",
]);
assert.deepEqual(secTenderRequiredOutputSchema.properties.transaction_fingerprint.properties.amendment_change_type.enum, [
  "price_change",
  "deadline_extension",
  "final_results",
  "financing_change",
  "condition_change",
  "procedural",
  "no_material_change",
  "unknown",
]);
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Common output / UI rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Common evidence / context rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Common writing / directional point rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Common event_type guardrails."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Common signal rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Common scoring rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Schedule TO / tender offer rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Schedule 13E-3 going-private rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Form CB cross-border rules."));
assert.ok(secTenderAnalysisSystemPrompt.includes("Form F-X, consent-to-service, foreign-law"));
assert.ok(secTenderAnalysisSystemPrompt.includes("must not appear in Negative, why_it_matters, or score_reason"));
assert.ok(secTenderAnalysisSystemPrompt.includes("pending stock-for-stock Form CB mergers or exchange offers"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cap score at 74 unless source blocks show completion"));
assert.ok(secTenderAnalysisSystemPrompt.includes("return bullish_points as [] unless the filing discloses"));
assert.ok(secTenderAnalysisSystemPrompt.includes("equal principal amount"));
assert.ok(secTenderAnalysisSystemPrompt.includes("same financial terms"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cash price is not applicable"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Use not disclosed only"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SECTION: Calendar item rules."));
assert.ok(!secTenderAnalysisSystemPrompt.includes("SC 14D9"));
assert.ok(!secTenderAnalysisSystemPrompt.includes("Do not call live APIs"));
assert.ok(secTenderAnalysisSystemPrompt.includes("ipo_listing"));
assert.ok(secTenderAnalysisSystemPrompt.includes("display_payload.data.ipo_kind"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Choose exactly one event_type"));
assert.ok(secTenderAnalysisSystemPrompt.includes("common generic filing UI"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Set display_payload.display_type to generic"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Use display payload version"));
assert.ok(secTenderAnalysisSystemPrompt.includes(SEC_TENDER_DISPLAY_PAYLOAD_VERSION));
assert.ok(secTenderAnalysisSystemPrompt.includes("Add transaction_fingerprint as metadata"));
assert.ok(secTenderAnalysisSystemPrompt.includes("display_payload remains UI-facing"));
assert.ok(secTenderAnalysisSystemPrompt.includes("transaction_fingerprint is metadata-facing"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not invent transaction_fingerprint fields"));
assert.ok(secTenderAnalysisSystemPrompt.includes("source-backed target_ticker"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Filing_context compatibility"));
assert.ok(secTenderAnalysisSystemPrompt.includes("filing_context.transaction_history"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cap score at 74"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Target-company response statements"));
assert.ok(secTenderAnalysisSystemPrompt.includes("adds no new board recommendation"));
assert.ok(secTenderAnalysisSystemPrompt.includes("changes price, deadline, financing, conditions, results, or closing status"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Score below 50 is archive, 50 to 74 is feed, and 75 or above is alert"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Delivery is derived downstream from score"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Score means investor attention / urgency"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Use the common filing UI sections"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Map UI Filing summary to analysis_output.summary"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Primary ticker rule"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SEC filing issuer, filer, or reporting public company"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SEC filed-by company is authoritative for the filing actor"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Issuer/filer writing rule"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not write that the buyer filed the form unless the buyer is the SEC filer"));
assert.ok(secTenderAnalysisSystemPrompt.includes("must not say the buyer/acquirer launched, filed, disclosed, or submitted"));
assert.ok(secTenderAnalysisSystemPrompt.includes("[SEC filed-by company] filed Form CB about [buyer/acquirer]'s proposed transaction"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not replace a source-backed filed-by ticker"));
assert.ok(secTenderAnalysisSystemPrompt.includes("target ticker in transaction_fingerprint.target_ticker and related_tickers"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not promote the subject or target ticker to primary"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not use it to replace or backfill analysis_output.primary_ticker"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Summary order"));
assert.ok(secTenderAnalysisSystemPrompt.includes("prioritize transaction mechanics over exhibit inventory"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not summarize exhibit lists unless the exhibit itself changes the transaction terms"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not use exhibit inventory as the summary lead"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not use exhibit inventory as a standalone summary sentence"));
assert.ok(secTenderAnalysisSystemPrompt.includes("the filing attaches"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Summary must not mention Exhibit, attachment, audited financials"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Put exhibit names, audited financials, fairness opinions, meeting notices, translations, or document inventory in key_evidence only"));
assert.ok(secTenderAnalysisSystemPrompt.includes("A less negative fact is not automatically positive"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Positive rules"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Negative rules"));
assert.ok(secTenderAnalysisSystemPrompt.includes("directly improve investor economics"));
assert.ok(secTenderAnalysisSystemPrompt.includes("directly add adverse economics"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Positive hard gate"));
assert.ok(secTenderAnalysisSystemPrompt.includes("procedural progress is not Positive"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Stock consideration, retained equity in a combined company"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not use phrases such as improves transaction certainty"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not present neutral transaction structure as Positive"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Neutral transaction mechanics belong in summary or key_evidence"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not treat procedural progress as Positive by default"));
assert.ok(secTenderAnalysisSystemPrompt.includes("financing commitments"));
assert.ok(secTenderAnalysisSystemPrompt.includes("remove a material risk"));
assert.ok(secTenderAnalysisSystemPrompt.includes("not Positive by themselves"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Put them in summary or key_evidence"));
assert.ok(secTenderAnalysisSystemPrompt.includes("materially improved closing certainty"));
assert.ok(secTenderAnalysisSystemPrompt.includes("A reduction in uncertainty is Positive only when"));
assert.ok(secTenderAnalysisSystemPrompt.includes("just because a term is important or disclosed"));
assert.ok(secTenderAnalysisSystemPrompt.includes("If the favorable or adverse effect is unclear"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Writing style: Use plain investor language"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Write like a direct explanation to a smart retail investor"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Judge clarity from a human reader's point of view"));
assert.ok(secTenderAnalysisSystemPrompt.includes("without stopping to decode it"));
assert.ok(secTenderAnalysisSystemPrompt.includes("rewrite it in ordinary language before returning JSON"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not copy filing jargon when a simpler phrase is possible"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Prefer plain terms such as closing conditions"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not create risks from filing type alone"));
assert.ok(secTenderAnalysisSystemPrompt.includes("filing type, jurisdiction, or cross-border structure alone"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Only include legal, remedy, liquidity, control, or enforcement risks"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Standard foreign-law, disclosure, remedy, service-of-process, or enforcement boilerplate"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Describe only the disclosed transaction, approvals, ownership changes"));
assert.ok(secTenderAnalysisSystemPrompt.includes("unless they are directly supported by the filing"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Write consequences as concrete disclosed mechanics"));
assert.ok(secTenderAnalysisSystemPrompt.includes("not to speculate about market behavior, motives, or investor harm"));
assert.ok(!secTenderAnalysisSystemPrompt.includes("Examples:"));
assert.ok(secTenderAnalysisSystemPrompt.includes("If there is no applicable content, return an empty array []"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not create generic filler points"));
assert.ok(secTenderAnalysisSystemPrompt.includes("quick_take one sentence under 22 words"));
assert.ok(secTenderAnalysisSystemPrompt.includes("summary 2-4 sentences under 100 words total"));
assert.ok(secTenderAnalysisSystemPrompt.includes("why_it_matters one sentence under 28 words"));
assert.ok(secTenderAnalysisSystemPrompt.includes("score_reason under 14 words"));
assert.ok(secTenderAnalysisSystemPrompt.includes("use the ISO currency code plus amount"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not write a bare amount or a local currency symbol by itself"));
assert.ok(secTenderAnalysisSystemPrompt.includes("max 3 means at most 3 items"));
assert.ok(secTenderAnalysisSystemPrompt.includes("short full sentences, not fragments"));
assert.ok(secTenderAnalysisSystemPrompt.includes("under 28 words"));
assert.ok(secTenderAnalysisSystemPrompt.includes("compact phrases or short sentences"));
assert.ok(secTenderAnalysisSystemPrompt.includes("under 22 words"));
assert.ok(secTenderAnalysisSystemPrompt.includes("what_to_watch_next items must be concrete"));
assert.equal(secTenderRequiredOutputSchema.properties.analysis_output.properties.bullish_points.maxItems, 3);
assert.equal(secTenderRequiredOutputSchema.properties.analysis_output.properties.bearish_points.maxItems, 3);
assert.equal(secTenderRequiredOutputSchema.properties.analysis_output.properties.key_evidence.maxItems, 3);
assert.equal(secTenderRequiredOutputSchema.properties.analysis_output.properties.what_to_watch_next.maxItems, 3);
assert.ok(secTenderRequiredOutputSchema.properties.analysis_output.properties.bullish_points.description.includes("Never return more than three items"));
assert.ok(secTenderRequiredOutputSchema.properties.analysis_output.properties.bearish_points.description.includes("Never return more than three items"));
assert.ok(secTenderRequiredOutputSchema.properties.analysis_output.properties.key_evidence.description.includes("Never return more than three items"));
assert.ok(secTenderRequiredOutputSchema.properties.analysis_output.properties.what_to_watch_next.description.includes("Never return more than three items"));
assert.ok(secTenderAnalysisSystemPrompt.includes("The site UI handles Source / Original filing"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not fabricate or restate source links"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Use only cleaned_source_blocks"));
assert.ok(!secTenderAnalysisSystemPrompt.includes("Do not use parser-generated facts"));
assert.ok(!secTenderAnalysisSystemPrompt.includes("Archive rule"));
assert.ok(!secTenderAnalysisSystemPrompt.includes("Do not over-score routine filings"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Tender / CB / 13E3 event_type guardrails"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I or issuer tender status does not automatically mean capital_return"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not use capital_return for employee option exchanges"));
assert.ok(secTenderAnalysisSystemPrompt.includes("future dilution, option overhang, exchange ratio"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not use transaction_family issuer_repurchase"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not use listing_risk merely because delisting"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Use shareholder_vote only when the central substance"));
assert.ok(secTenderAnalysisSystemPrompt.includes("employee option-exchange dilution/overhang is central"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Tender / 13E3 scoring guide"));
assert.ok(secTenderAnalysisSystemPrompt.includes("First identify what is being tendered"));
assert.ok(secTenderAnalysisSystemPrompt.includes("common stock, ordinary shares, or ADS have direct equity-holder impact"));
assert.ok(secTenderAnalysisSystemPrompt.includes("debt, notes, preferred, AT1, capital securities"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Rule 13E-3 or cash-out tender 62-74 by default"));
assert.ok(secTenderAnalysisSystemPrompt.includes("routine completion confirmation of a previously disclosed transaction 60-74"));
assert.ok(secTenderAnalysisSystemPrompt.includes("newly disclosed holder economics, payment, acceptance, delisting effectiveness"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Debt/preferred/AT1/capital securities tender cap rules"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Cap score at 68 unless financial stress"));
assert.ok(secTenderAnalysisSystemPrompt.includes("failed, terminated, blocked, litigated, financing-stressed, or coercive tender 70-90"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Offer price premium / discount guide"));
assert.ok(secTenderAnalysisSystemPrompt.includes("premium_or_discount_percent"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Prefer previous_close when supplied"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I listed common/ordinary/ADS cash issuer tender table"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not apply this table to fund NAV tenders"));
assert.ok(secTenderAnalysisSystemPrompt.includes("employee option exchanges, underwater option repricings"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I employee option exchange scoring"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not use cash tender premium/discount bands"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Hard override before the SC TO-I premium table"));
assert.ok(secTenderAnalysisSystemPrompt.includes("premium alone cannot create alert"));
assert.ok(secTenderAnalysisSystemPrompt.includes("-5% to +5% uses neutral signal and 35-49"));
assert.ok(secTenderAnalysisSystemPrompt.includes("+15% to +30% uses bullish signal and 75-82"));
assert.ok(secTenderAnalysisSystemPrompt.includes("-15% to -30% uses bearish signal and 75-82"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I scale modifier"));
assert.ok(secTenderAnalysisSystemPrompt.includes("10% or higher supports +4 to +7"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not use the scale modifier to cross from feed into alert by itself"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I fund/NAV tender cap"));
assert.ok(secTenderAnalysisSystemPrompt.includes("A market-price discount to NAV, a 5% to 15% market premium, or a tender for 10% of shares is not enough by itself for alert"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I cap rules tied to the issuer-tender criteria"));
assert.ok(secTenderAnalysisSystemPrompt.includes("if premium is below 15%, cap score at 74 unless another alert gate is present"));
assert.ok(secTenderAnalysisSystemPrompt.includes("If offer size is missing, do not use the scale modifier"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cap score at 58"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I 90+ cap"));
assert.ok(secTenderAnalysisSystemPrompt.includes("a voluntary issuer self-tender for listed common stock should normally cap at 88"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not stack premium band plus scale modifier mechanically"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I price structure rules"));
assert.ok(secTenderAnalysisSystemPrompt.includes("classify the price structure as dutch_auction"));
assert.ok(secTenderAnalysisSystemPrompt.includes("classify the price structure as fund_nav_tender"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I Dutch auction signal"));
assert.ok(secTenderAnalysisSystemPrompt.includes("the range crosses the reference price, use volatile"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-I NAV fund tender signal"));
assert.ok(secTenderAnalysisSystemPrompt.includes("If tender price is below NAV"));
assert.ok(secTenderAnalysisSystemPrompt.includes("apply the SC TO-I premium/discount table before the generic tender premium guide"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T / third-party tender rules"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T premium base scores"));
assert.ok(secTenderAnalysisSystemPrompt.includes("+15% to +30% uses 75-84"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T scoring is premium plus control change plus certainty"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T control / scope modifiers"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T certainty modifiers"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T modifier use"));
assert.ok(secTenderAnalysisSystemPrompt.includes("use the lower end when a factor is present but weak"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T modifiers are not automatic add-ons"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not stack them mechanically"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T caps"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not allow a control-purpose tender to exceed 74 solely"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cap the score at 74 even when the tender has a minimum control condition"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Allow 75+ for unsupported or hostile control tenders only when"));
assert.ok(secTenderAnalysisSystemPrompt.includes("competing bid dynamics"));
assert.ok(secTenderAnalysisSystemPrompt.includes("beyond basic deal funding"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Committed financing alone must not override the 74 cap"));
assert.ok(secTenderAnalysisSystemPrompt.includes("not as a standalone bullish or alert gate"));
assert.ok(secTenderAnalysisSystemPrompt.includes("a 51% minimum tender condition"));
assert.ok(secTenderAnalysisSystemPrompt.includes("up to 100% share target"));
assert.ok(secTenderAnalysisSystemPrompt.includes("conditional control path does not by itself justify 75+"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Without board support, a definitive merger agreement"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Treat rights-plan waivers"));
assert.ok(secTenderAnalysisSystemPrompt.includes("conditionality or closing-risk context"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T alert gates"));
assert.ok(secTenderAnalysisSystemPrompt.includes("final payment, acceptance/proration"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC TO-T 90+ gate"));
assert.ok(secTenderAnalysisSystemPrompt.includes("0% to below 5% is a low premium"));
assert.ok(secTenderAnalysisSystemPrompt.includes("15% to below 30% is a meaningful premium and normally alert-level"));
assert.ok(secTenderAnalysisSystemPrompt.includes("30% or higher is a large premium"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not apply common-equity premium alert logic"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Near-par refinancing or capital-structure management"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Large dollar amount alone cannot create alert"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Amendment/procedural cap rules"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Procedural, fee-only, XML/graphic, or holder-form-only material caps at 35"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Final-results amendment cap rules"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Completion confirmation alone is not an alert gate"));
assert.ok(secTenderAnalysisSystemPrompt.includes("small scale and no control or structural impact caps at 65"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Small-scale final or preliminary issuer-tender results"));
assert.ok(secTenderAnalysisSystemPrompt.includes("use accepted shares/value, not the original maximum tender size"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cap score at 74 even when the cash price is 15%+ above market"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Issuer-tender result amendments must not become alerts from premium alone"));
assert.ok(secTenderAnalysisSystemPrompt.includes("accepted value is below $5 million"));
assert.ok(secTenderAnalysisSystemPrompt.includes("normally score 55-68"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Mention accepted scale first, then premium as secondary context"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cap score at 74"));
assert.ok(secTenderAnalysisSystemPrompt.includes("a low premium is a potential minority-holder risk"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not classify SC 13E-3 as listing_risk merely because delisting"));
assert.ok(secTenderAnalysisSystemPrompt.includes("independent exchange listing deficiency"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not classify SC 13E-3 as financial_risk merely because"));
assert.ok(secTenderAnalysisSystemPrompt.includes("financing condition that materially threatens the transaction"));
assert.ok(secTenderAnalysisSystemPrompt.includes("first definitive cash-out disclosure can use 75-82"));
assert.ok(secTenderAnalysisSystemPrompt.includes("A first clear source-backed SC 13E-3 disclosure"));
assert.ok(secTenderAnalysisSystemPrompt.includes("concrete consideration terms plus a clear closing path"));
assert.ok(secTenderAnalysisSystemPrompt.includes("the same definitive cash-out was already disclosed"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cap score at 74"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC 13E-3 premium scoring applies only when both the consideration price"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not invent a premium"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not write above-market, below-market, premium, discount"));
assert.ok(secTenderAnalysisSystemPrompt.includes("do not compare the local ordinary-share buyback price with U.S. ADS/ADR market_context"));
assert.ok(secTenderAnalysisSystemPrompt.includes("ADS/ADR holders must convert ADSs into local ordinary shares"));
assert.ok(secTenderAnalysisSystemPrompt.includes("repurchasing its own local ordinary or equity shares"));
assert.ok(secTenderAnalysisSystemPrompt.includes("distinguish local ordinary/equity shares from U.S. ADSs/ADRs"));
assert.ok(secTenderAnalysisSystemPrompt.includes("cross-border Form CB updates usually cap at 74"));
assert.ok(secTenderAnalysisSystemPrompt.includes("receipt of a merger certificate"));
assert.ok(secTenderAnalysisSystemPrompt.includes("does not newly disclose consideration amount"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Signal is not automatically bullish"));
assert.ok(secTenderAnalysisSystemPrompt.includes("minority holders are forced out"));
assert.ok(secTenderAnalysisSystemPrompt.includes("SC 13E-3 final amendment reports transaction results"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Amendment scoring rule"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Completion-only or delisting-only amendments are feed-level"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not score 75+ merely because the amendment confirms"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Allow 75+ for an SC 13E-3/A amendment only when this filing newly discloses"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Routine completion confirmation of an already disclosed transaction caps at 74"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not give 75+ for going-private"));
assert.ok(secTenderAnalysisSystemPrompt.includes("A 0% to below 5% premium caps score at 72"));
assert.ok(secTenderAnalysisSystemPrompt.includes("A 15% to below 30% premium usually scores at least 75"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Alert gate: score 75+ only if at least one alert gate is met"));
assert.ok(secTenderAnalysisSystemPrompt.includes("source-backed cash premium of 15%+ to market"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Apply the section-specific caps below before allowing score 75+"));
assert.ok(secTenderAnalysisSystemPrompt.includes("90+ rule"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not assign 90+ from premium percentage, size, or form type alone"));
assert.ok(!secTenderAnalysisSystemPrompt.includes("No-alert caps"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Use market_context only when supplied as site-provided context"));
assert.ok(secTenderAnalysisSystemPrompt.includes("Do not describe market_context values as filing disclosures"));
assert.ok(secTenderAnalysisSystemPrompt.includes("If market_context affects score_reason or why_it_matters"));

const prompt = buildSecTenderAnalysisPromptDraft({
  filing_package: { fixture: true },
  parser_output: routineAmendmentExpected.parser_output,
  market_context: null,
});
assert.equal(prompt.key, SEC_TENDER_ANALYSIS_PROMPT_KEY);
assert.equal(prompt.version, SEC_TENDER_ANALYSIS_PROMPT_VERSION);
assert.equal(prompt.responseFormat.json_schema.name, "sec_tender_cb_13e3_required_output");
assert.equal(prompt.responseFormat.json_schema.strict, true);
assert.deepEqual(prompt.responseFormat.json_schema.schema.required, ["analysis_output", "display_payload", "transaction_fingerprint"]);
assert.equal(prompt.responseFormat.json_schema.schema.properties.parser_output, undefined);
assert.equal(prompt.responseFormat.json_schema.schema.properties.fixture_expected, undefined);
assert.ok(prompt.responseFormat.json_schema.schema.properties.transaction_fingerprint);
const promptPayload = JSON.parse(prompt.user) as Record<string, unknown>;
assert.ok(Array.isArray(promptPayload.cleaned_source_blocks));
assert.equal(promptPayload.parser_output, undefined);
assert.equal(promptPayload.facts, undefined);
assert.equal(promptPayload.signals, undefined);
assert.ok(!JSON.stringify(promptPayload).includes("\"route_hint\""));
assert.ok(!JSON.stringify(promptPayload).includes("\"deterministic_classification\""));
assert.ok(!JSON.stringify(promptPayload).includes("\"suggested_display_payload\""));
assert.equal(promptPayload.router_result, undefined);
assert.equal(promptPayload.selected_event_type, undefined);
assert.equal(promptPayload.selected_display_type, undefined);
assert.equal(promptPayload.display_payload, undefined);
assert.equal(promptPayload.filing_context, null);
assert.equal(promptPayload.parent_filing_context, null);
assert.equal(promptPayload.market_context, null);

const mockMarketContext = {
  as_of: "2026-06-01T20:00:00Z",
  ticker: "XYZ",
  company_name: "Example Corp.",
  price: 4.25,
  market_cap: 185000000,
  shares_outstanding: 43500000,
  public_float: 28000000,
  avg_volume_30d: 1200000,
  sector: "Healthcare",
  industry: "Biotechnology",
  exchange: "NASDAQ",
  day_change_percent: -3.2,
  ytd_change_percent: -41.5,
  volatility_note: "Small-cap biotech with elevated trading volatility.",
  liquidity_note: "Average daily dollar volume is thin relative to larger issuers.",
};
const parserOutputWithMarketContext = parseSecTenderFiling({
  sourceUniqueId: "0009999999-26-000100",
  title: "SC TO-I - Example Corp.",
  publishedAt: "2026-06-01",
  bodyText:
    "SC TO-I\nExample Corp.\n(Name of Subject Company)\nExample Corp. is making an issuer tender offer to purchase shares of common stock.",
  rawPayload: {
    accession_number: "0009999999-26-000100",
    form_type: "SC TO-I",
    company_name: "Example Corp.",
    ticker: "XYZ",
  },
  marketContext: mockMarketContext,
});
assert.ok(!JSON.stringify(parserOutputWithMarketContext).includes("Small-cap biotech"));
assert.ok(!JSON.stringify(parserOutputWithMarketContext).includes("Average daily dollar volume"));
const marketPrompt = buildSecTenderAnalysisPromptDraft({
  filing_package: { fixture: true },
  parser_output: routineAmendmentExpected.parser_output,
  market_context: mockMarketContext,
});
const marketPromptPayload = JSON.parse(marketPrompt.user) as Record<string, unknown>;
assert.deepEqual(marketPromptPayload.market_context, mockMarketContext);
assert.ok(Array.isArray(marketPromptPayload.cleaned_source_blocks));
assert.ok(!JSON.stringify(marketPromptPayload.cleaned_source_blocks).includes("Small-cap biotech"));
assert.ok(!JSON.stringify(marketPromptPayload.cleaned_source_blocks).includes("\"site_market_context\""));
assert.equal(marketPromptPayload.parser_output, undefined);
assert.equal(marketPromptPayload.facts, undefined);
assert.equal(marketPromptPayload.signals, undefined);

const purchaseSizeSourceBlocks = buildSecTenderSourceBlockPromptInput({
  filingPackage: {
    rawPayload: {
      form_type: "SC TO-I",
      attachment_texts: [
        {
          type: "EX-99.(a)(1)",
          description: "Offer to Purchase",
          text_excerpt:
            "Offer to Purchase Shares (the &ldquo;Purchase Size&rdquo;) dated June 1, 2026. Tender documents must be received by June 30, 2026.",
          text: [
            "Offer to Purchase Shares (the &ldquo;Purchase Size&rdquo;) dated June 1, 2026.",
            "Specifically, the Fund is offering to purchase Shares, pursuant to tenders by Shareholders, in an amount up to the Purchase Size (calculated as 5% of the Fund&rsquo;s net asset value as of the prior calendar quarter end), and each Share tendered for purchase will be purchased at a price equal to the net asset value per Share calculated as of the Valuation Date.",
            "If Shares in excess of 5% of the Fund's net asset value are duly tendered, the Fund may accept additional Shares or purchase on a pro rata basis.",
          ].join("\n\n"),
        },
      ],
    },
  },
  parserOutput: {
    facts: {
      sec_form_type: "SC TO-I",
    },
  },
});
const purchaseSizeSourceText = JSON.stringify(purchaseSizeSourceBlocks.cleaned_source_blocks);
assert.ok(purchaseSizeSourceText.includes("5% of the Fund's net asset value"));
assert.ok(purchaseSizeSourceText.includes("net asset value per Share calculated as of the Valuation Date"));
assert.ok(
  purchaseSizeSourceBlocks.cleaned_source_blocks.some((block) => block.label === "Offer Size / Purchase Size"),
);
assert.ok(purchaseSizeSourceBlocks.cleaned_source_blocks.some((block) => block.label === "NAV Purchase Price"));

const formCbFilerSourceBlocks = buildSecTenderSourceBlockPromptInput({
  filingPackage: {
    company_name: "Magic Software Enterprises Ltd.",
    primary_ticker: {
      ticker: "MGIC",
      exchange: "NASDAQ",
    },
    rawPayload: {
      form_type: "CB",
      accession_number: "0000950103-25-014243",
      company_name: "Magic Software Enterprises Ltd.",
      ticker: "MGIC",
    },
  },
  parserOutput: {
    facts: {
      sec_form_type: "CB",
    },
  },
  fallbackText: "Matrix IT Ltd. proposes a merger transaction involving Magic Software Enterprises Ltd.",
});
const formCbFilerSourceText = JSON.stringify(formCbFilerSourceBlocks.cleaned_source_blocks);
assert.ok(formCbFilerSourceText.includes("SEC filed-by company"));
assert.ok(formCbFilerSourceText.includes("Magic Software Enterprises Ltd."));
assert.ok(formCbFilerSourceText.includes("Use this company as the filing actor"));

const thirteenE3CashOutBlocks = buildSecTenderSourceBlockPromptInput({
  filingPackage: {
    rawPayload: {
      form_type: "SC 13E3",
      attachment_texts: [
        {
          type: "EX-99.(C)(II)",
          description: "Financial Advisor Presentation",
          text: [
            "CONFIDENTIAL PROJECT",
            "Financial Advisor Presentation",
            "Preliminary Discussion Materials",
            "A prior indication of interest discussed illustrative values of $16.00 to $16.20 per share.",
          ].join("\n"),
        },
        {
          type: "EX-99.(A)(1)",
          description: "Transaction Statement",
          text: [
            "SC 13E-3 Transaction Statement.",
            "Each outstanding share will be converted into the right to receive $16.50 in cash, without interest.",
            "The $16.50 cash amount is the Per Share Merger Consideration payable to unaffiliated holders.",
            "Following the merger, the company will be delisted and deregistered.",
          ].join("\n\n"),
        },
      ],
    },
  },
  parserOutput: {
    facts: {
      sec_form_type: "SC 13E3",
    },
  },
});
const thirteenE3CashOutText = JSON.stringify(thirteenE3CashOutBlocks.cleaned_source_blocks);
assert.ok(thirteenE3CashOutText.includes("$16.50"));
assert.ok(thirteenE3CashOutBlocks.cleaned_source_blocks.some((block) => block.label === "Merger Consideration / Cash-Out Price"));
assert.ok(!thirteenE3CashOutText.includes("$16.00"));
assert.ok(!thirteenE3CashOutText.includes("$16.20"));
assert.ok(!thirteenE3CashOutText.includes("Preliminary Discussion Materials"));
assert.ok(!thirteenE3CashOutText.includes("prior indication of interest"));
assert.ok(!thirteenE3CashOutText.includes("text_excerpt"));

const thirteenE3AdsCashOutBlocks = buildSecTenderSourceBlockPromptInput({
  filingPackage: {
    rawPayload: {
      form_type: "SC 13E3",
    },
  },
  parserOutput: {
    facts: {
      sec_form_type: "SC 13E3",
    },
  },
  fallbackText: [
    "Pursuant to the Merger Agreement, each Share of par value of US$0.0001 each issued and outstanding immediately prior to the Effective Time shall be cancelled and cease to exist, in consideration and exchange for the right to receive US$0.4940 in cash per Share without interest (the \"Per Share Merger Consideration\").",
    "Each ADS issued and outstanding immediately prior to the Effective Time shall be cancelled and cease to exist in exchange for the right to receive US$2.9641 in cash per ADS (the \"Per ADS Merger Consideration\").",
  ].join("\n\n"),
});
const thirteenE3AdsCashOutText = JSON.stringify(thirteenE3AdsCashOutBlocks.cleaned_source_blocks);
assert.ok(thirteenE3AdsCashOutText.includes("US$0.4940"));
assert.ok(thirteenE3AdsCashOutText.includes("US$2.9641"));
assert.ok(thirteenE3AdsCashOutText.includes("Per Share Merger Consideration"));
assert.ok(thirteenE3AdsCashOutText.includes("Per ADS Merger Consideration"));
assert.ok(
  thirteenE3AdsCashOutBlocks.cleaned_source_blocks.some((block) => block.label === "Merger Consideration / Cash-Out Price"),
);

console.log("sec tender analysis expected-output fixtures passed");

function readExpected(name: string): SecTenderExpectedOutput {
  return JSON.parse(readFileSync(join(expectedDir, name), "utf8")) as SecTenderExpectedOutput;
}
