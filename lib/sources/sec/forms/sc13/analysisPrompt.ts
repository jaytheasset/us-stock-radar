import {
  APPROVED_EVENT_TYPES,
  SC13_ROOM_FORM_TYPE,
  type RequiredFixtureResult,
  type Sc13MarketContext,
  type Sc13ParserOutput,
  type Sc13RouteDecision,
} from "./types";
import { buildCurrentFilingIdentity } from "../common/currentFilingIdentity.ts";

export const SC13_ANALYSIS_PROMPT_VERSION = "sc13-analysis-v1";

export function buildSc13AnalysisPrompt(
  parserOutput: Sc13ParserOutput,
  routeDecisionOrOptions: Sc13RouteDecision | {
    marketContext?: Sc13MarketContext | null;
    parentFilingContext?: Record<string, unknown> | null;
  } | null = null,
  options: {
    marketContext?: Sc13MarketContext | null;
    parentFilingContext?: Record<string, unknown> | null;
  } = {},
): string {
  const currentFiling = buildCurrentFilingIdentity({
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: SC13_ROOM_FORM_TYPE,
  });
  const marketContext =
    routeDecisionOrOptions && "event_type" in routeDecisionOrOptions
      ? options.marketContext ?? null
      : routeDecisionOrOptions?.marketContext ?? options.marketContext ?? null;
  const parentFilingContext =
    routeDecisionOrOptions && "event_type" in routeDecisionOrOptions
      ? options.parentFilingContext ?? null
      : routeDecisionOrOptions?.parentFilingContext ?? options.parentFilingContext ?? null;

  return [
    `Prompt version: ${SC13_ANALYSIS_PROMPT_VERSION}`,
    "Produce final investor-facing analysis for an SEC SC 13D/13G filing.",
    "Use only cleaned_source_blocks, market_context, and parent_filing_context supplied here.",
    "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another Schedule 13 form from the same family.",
    "Do not use parser facts, parser signals, parser classification handoff, route hints, event_type hints, or display hints as authority.",
    "There is no router LLM for this room. The analysis LLM must choose event_type, display_type, score, signal, and investor-facing copy from the source blocks.",
    "Build display_payload directly from cleaned_source_blocks, market_context, and parent_filing_context. Do not copy parser-built display payload drafts.",
    "Analyze the current filing first. For SC 13D/A or SC 13G/A, use parent_filing_context only when supplied; if it is missing or ambiguous, do not invent amendment changes.",
    "For SC 13D/A or SC 13G/A with parent_filing_context.status = found, compare current ownership against the parent filing when source-backed parent values exist.",
    "If parent and current ownership values exist, include prior shares/percent and current shares/percent in summary or key_evidence.",
    "Do not describe governance influence unless Item 4, group/control language, voting arrangement, activist language, agreement text, or proxy/transaction text supports it.",
    "For passive SC 13G/A exits, prefer wording like \"the reporting group no longer reports a beneficial ownership stake\" or \"reportable ownership exited.\"",
    "Multiple reporting persons: do not add or combine individual reporting-person shares or percentages unless a cleaned_source_block explicitly states an aggregate/group ownership amount or percentage.",
    "If a filing lists several reporting persons with separate rows and no explicit aggregate/group value, describe the largest or relevant disclosed rows separately and say aggregate ownership was not stated.",
    "Do not call live FMP, live DB, ingest, alert, common code, or UI code.",
    `The room scope is ${SC13_ROOM_FORM_TYPE}.`,
    `Choose exactly one approved event_type: ${APPROVED_EVENT_TYPES.join(", ")}.`,
    "Default display_type is generic. Use offering_terms only when the source blocks clearly describe an offering/exchange with terms that fit the common offering UI. Use candidate_special only when a source-backed special UI candidate is needed.",
    "delivery_level is derived from score only: below 50 archive, 50-74 feed, 75+ alert.",
    "Score means investor attention / urgency, not bullishness or bearishness.",
    "",
    "SC13 analysis principles:",
    "- Core question: analyze what the reporting person can do or appears to intend to do with the ownership position, not ownership percentage alone.",
    "- Default event type: use insider_ownership for ordinary beneficial ownership, passive 13G, simple 13D, ownership percentage updates, and exits/below-5-percent disclosures.",
    "- 13G default: treat Schedule 13G and 13G/A as passive or institutional ownership unless source text proves otherwise; routine passive filings are usually archive or low feed.",
    "- 13D default: treat Schedule 13D and 13D/A as more investor-relevant than 13G, but keep it feed-level at most when Item 4 is only investment-purpose or ordinary ownership text.",
    "- Direct action matters most: raise urgency for source-backed board/proxy/governance pressure, voting or control agreements, strategic transactions, litigation, debt/pledge/forced sale, financing pressure, or conversion pressure.",
    "- Do not switch event_type to leadership_governance merely because a reporting person is an officer, director, family member, founder, control holder, or large voter. Those are ownership context unless the current filing shows an actual governance action.",
    "- Ownership change matters with context: minimal changes are usually archive; meaningful changes are feed candidates; large or control-relevant changes need source-backed action/control risk for alert-level urgency.",
    "- Exit filings are not all the same: passive below-5% exits are usually archive, while a 13D holder, activist, control/family group, or prominent holder exiting a large stake can be feed-level.",
    "- Alert threshold: never assign alert from form type or ownership percentage alone; require concrete source-backed urgency.",
    "- Positive/Negative discipline: points must show direct investor impact, not neutral context, absence of bad news, administrative/tax purpose, routine mechanics, disclosed price, or generic float mechanics.",
    "- Ownership alignment is not Positive by itself: insider/family/control-holder ownership, continued ownership, or insider/director status belongs in key_evidence unless the current filing shows a new direct favorable change.",
    "- Amendments: analyze the change from parent context when available; if parent context is missing, do not invent what changed.",
    "- Conservative fallback: when source evidence is incomplete, ambiguous, or boilerplate-only, lower score and confidence.",
    "",
    "SC13 scoring guide:",
    "- The core SC13 question is not only who owns how much; it is what the holder is trying to do, as shown by Item 4, agreements, disputes, transactions, or financing pressure.",
    "- Routine SC 13G 5-10% with standard 13d-1(b), 13d-1(c), or 13d-1(d) basis/certification and no substantive Item 6/8/9: score 20-39, hard cap 49.",
    "- Routine SC 13G 10-20%: score 35-52, hard cap 55.",
    "- Passive SC 13G 20%+ with no substantive non-routine source text: score 45-62, hard cap 68. Passive 13G should not be alert by ownership percentage alone.",
    "- SC 13G/A below-5-percent or exit filing: score 20-40, hard cap 49 unless the current source text clearly contains a separate non-routine event.",
    "- Simple SC 13D 5-10% with investment-purpose or ownership-only text: score 45-58, hard cap 60.",
    "- Simple SC 13D 10-20% with no source-backed action intent: score 50-64, hard cap 68.",
    "- Simple SC 13D 20%+ with no source-backed action intent: score 58-70, hard cap 74. Do not score 75+ from ownership percentage alone.",
    "- Source-backed 13D/13D/A block sale, registered offering sale, or full exit that reduces a reportable 10%+ holder or control/family group to zero or below 5% should usually be feed-level 50-68, not routine archive.",
    "- Very large source-backed SC13 sale/exit disclosures, such as multi-million-share sales, sale proceeds above $25M, or a full reportable exit by a prominent holder, can reach 60-74 even without activist intent. Cap below 75 unless there is source-backed pressure, distress, forced sale, transaction, governance, or financing urgency.",
    "- 13D governance pressure such as board, director, proxy, management change, voting/control agreement, or governance campaign language: score 65-74 by default; score 75-88 only when the alert gate below is met.",
    "- Explicit proxy fight, board seat demand, director nomination, or management change demand: score 75-88.",
    "- Merger, acquisition, tender offer, sale of company/assets, reorganization, recapitalization, going-private, or transaction-tied support agreement: score 75-90.",
    "- Litigation, investigation, regulatory dispute, injunction, or settlement pressure: score 60-82 depending on direct relevance to the issuer.",
    "- Debt default, margin loan, pledge, forced sale, liquidity pressure, or conversion pressure: score 60-85 depending on direct relevance and urgency.",
    "- For SC 13D/A or SC 13G/A without parent/prior comparison, do not assume a new event merely because the filing is an amendment. If the change is unclear from current source text, hard cap 65.",
    "- If parent_filing_context shows the amendment repeats a prior ownership disclosure without source-backed action, economics, agreement, litigation, governance, transaction, or control-intent change, keep the score low.",
    "- If parent_filing_context plus current source blocks show a new ownership percentage, new Item 4 action, added agreement, new sales plan, litigation, financing pressure, or transaction update, score the actual new change.",
    "- The amendment cap can be lifted only when the current source text itself clearly states proxy fight, board demand, merger, tender, litigation, regulatory dispute, debt/default/pledge, forced sale, or financing/conversion pressure.",
    "",
    "SC13 alert gate:",
    "- Do not produce 75+ by stacking form type, ownership percentage, and generic keywords.",
    "- 75+ requires source-backed action/pressure evidence: explicit board/proxy/management demand; transaction event; agreement tied to governance or a transaction; legal/regulatory dispute tied to management, transaction, listing, or financing; debt/default/pledge/forced-sale/conversion pressure; or small-cap/small-float 20%+ holder with clear action intent.",
    "- Never score 75+ solely because the filing is 13D, because ownership is 20%+, because Item 4 says investment purposes only, because a passive/certified 13G was filed, or because an amendment has unclear changes.",
    "",
    "SC13 directional point rules:",
    "- bullish_points are displayed as Positive; bearish_points are displayed as Negative. These are legacy schema keys, not instructions to force stock-direction labels.",
    "- bullish_points and bearish_points must describe current favorable or adverse effects directly shown by the current filing or supplied parent context.",
    "- Do not put insider/family/control-holder ownership, continued ownership, or insider/director status in bullish_points unless the current filing shows meaningful stake increase, reduced pledge/forced-sale risk, resolved governance dispute, favorable transaction support, improved control clarity, or de-risking of prior overhang.",
    "- Do not use neutral context, absence of bad news, administrative/tax purpose, routine mechanics, disclosed price, or generic float mechanics as bullish_points or bearish_points.",
    "- Put contextual facts that do not directly change upside or downside in key_evidence or what_to_watch_next.",
    "- what_to_watch_next is for facts that are not currently Positive or Negative but would matter if they change later.",
    "- Ownership percentage-point change bands: no/minimal change 0-0.49pp; small change 0.5-1.99pp; meaningful change 2.0-4.99pp; large change 5.0pp+.",
    "- Control-relevant jump means 10.0pp+ change, crossing 20%, crossing 50%, or crossing another source-backed control threshold.",
    "- Risk-reduction/Positive candidate: ownership down 5.0pp+, down from 20%+ to below 10%, down from 10%+ to below 5%, or active 13D holder converts to passive 13G with 2.0pp+ ownership reduction.",
    "- Do not make 0.5-1.99pp ownership decreases Positive. Put them in key_evidence or omit them unless context makes them important.",
    "- Negative/volatile candidate: ownership up 5.0pp+ with active Item 4 language; ownership reaches 10%+ or 20%+ with active intent; or a group appears with control/governance intent.",
    "- Alert candidate: ownership up 10.0pp+ with active intent, 20%+ holder plus board/proxy/transaction demand, or 50% near/above-control ownership with control transaction language.",
    "- Passive 13G ownership bands: 5-9.99% archive to low feed; 10-19.99% feed candidate; 20-34.99% stronger feed candidate; 35%+ feed to alert candidate only with extra source-backed risk; 50%+ requires analysis but passive status alone still does not prove alert.",
    "- Large passive holders belong in key_evidence or what_to_watch_next unless the filing shows active intent, agreements, transaction pressure, proxy action, pledge, forced sale, or financing pressure.",
    "- Simple 13G/A change 0-0.49pp is archive-level; 0.5-1.99pp is archive or low feed; 2.0-4.99pp is feed candidate; 5.0pp+ is feed-or-higher candidate.",
    "- For simple 13G/A, do not use bullish_points or bearish_points for 0-2pp changes. For 2-5pp changes, prefer key_evidence unless source-backed intent or context supports a favorable or adverse effect.",
    "- Prior 13D history alone is not Negative. Put it in what_to_watch_next unless the current filing shows active intent, re-escalation, or a new agreement.",
    "- Warrants, convertibles, or derivative exposure without exercise, sale, conversion pressure, or control intent belong in key_evidence or what_to_watch_next, not bearish_points.",
    "",
    "SC13 event_type guide:",
    "- insider_ownership: beneficial ownership, passive 13G, simple 13D, ownership percentage update, or routine exit/below-5-percent disclosure.",
    "- leadership_governance: board seat demand, director nomination, proxy contest, management change demand, governance campaign, new voting/control agreement, or other current source-backed governance action. Do not use it for ordinary ownership by insiders, directors, family groups, or control holders alone.",
    "- strategic_transaction: merger, acquisition, tender offer, sale, reorganization, going-private transaction, or transaction-tied support agreement.",
    "- legal_risk: lawsuit, investigation, regulatory dispute, injunction, or settlement pressure.",
    "- financial_risk: debt default, margin loan, pledge, forced sale, or liquidity pressure.",
    "- dilution_risk: conversion rights, warrants, preferred stock, notes, blockers, resale mechanics, or issuance mechanics only when the source ties them to actual dilution or conversion pressure. Do not use dilution_risk for simple warrant ownership alone.",
    "- Use other only when none of the approved event types fit.",
    "",
    "Market context use:",
    "- Market context is optional and may adjust urgency, but it must not override source text.",
    "- Raise urgency when market context shows small cap, small float, high volatility, listing/distress context, or when a holder's stake is large relative to float.",
    "- Lower urgency for large-cap routine passive institutional 13G filings, clear below-5-percent exits, and standard certifications without substantive non-routine items.",
    "Do not create new display types.",
    "If market_context materially changes impact, mention only the fields used in score_reason or key_evidence.",
    "analysis_output.source_group must be exactly \"filings\".",
    "analysis_output.market_scope must be exactly one of: company, sector, theme, macro. Use company for a single issuer SC13 filing.",
    "analysis_output.signal must be exactly one of: bullish, bearish, volatile, neutral. Use neutral for passive Schedule 13G filings or de-escalation from active to passive intent.",
    "Do not invent custom signal labels such as de-escalation_to_passive, activist, passive, accumulation, or exit.",
    "",
    "Common filing UI copy limits:",
    "- event_title must be investor-facing and under 90 characters.",
    "- quick_take must be one sentence under 22 words.",
    "- summary must be 2-4 compact sentences under 100 words total.",
    "- why_it_matters must be one sentence under 35 words.",
    "- score_reason must be one sentence under 18 words.",
    "- bullish_points, bearish_points, key_evidence, and what_to_watch_next must have max 3 items each.",
    "- Each Positive/Negative/key_evidence/what_to_watch_next item must be under 20 words.",
    "- Use fewer items, or empty arrays, when the source does not support direct points.",
    "- Do not write paragraph-length bullets or copied legal text in any visible field.",
    "- Rewrite SEC phrasing into plain investor language without changing meaning.",
    "- Avoid vague watch items. Use concrete filings, ownership changes, agreements, proxy actions, transaction updates, or amendment comparisons.",
    "",
    "Return JSON only.",
    "Top-level keys: parser_output, analysis_output, display_payload.",
    "Do not reconstruct parser internals. Use parser_output as an empty object if needed; integration preserves the actual parser output.",
    "analysis_output must include source_group, market_scope, event_type, event_title, primary_ticker, tickers, sector, industry_group, theme_group, sub_theme, score, score_reason, signal, quick_take, summary, why_it_matters, bullish_points, bearish_points, key_evidence, what_to_watch_next, related_tickers, calendar_items, confidence, needs_human_review.",
    "display_payload must include display_type, display_version, data, evidence, notes.",
    "Do not include test-only expected blocks in runtime output.",
    "",
    "current_filing:",
    JSON.stringify(currentFiling, null, 2),
    "",
    "cleaned_source_blocks:",
    JSON.stringify(parserOutput.cleaned_source_blocks, null, 2),
    "",
    "market_context:",
    JSON.stringify(marketContext, null, 2),
    "",
    "parent_filing_context:",
    JSON.stringify(parentFilingContext, null, 2),
  ].join("\n");
}

export function buildSc13DeterministicResult(
  parserOutput: Sc13ParserOutput,
): RequiredFixtureResult | null {
  void parserOutput;
  return null;
}

function buildDeterministicEvidence(parserOutput: Sc13ParserOutput): string[] {
  const facts = parserOutput.facts;
  const evidence: string[] = [];
  if (facts.sharesBeneficiallyOwned !== null && facts.percentOwned !== null) {
    evidence.push(
      `Reported beneficial ownership: ${formatNumber(facts.sharesBeneficiallyOwned)} shares (${formatPercent(facts.percentOwned)}).`,
    );
  }
  if (facts.passiveCertification) {
    evidence.push("Passive certification says the securities were not held to change or influence control.");
  }
  if (facts.isExitFiling) {
    evidence.push("The filing states the holder ceased to beneficially own more than 5% or identifies itself as an exit filing.");
  }
  if (facts.ownershipPercentChange !== null) {
    evidence.push(`Reported ownership changed by ${facts.ownershipPercentChange.toFixed(1)} percentage points.`);
  }
  return evidence;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number | null): string {
  if (value === null) return "unknown";
  return `${value.toFixed(1)}%`;
}

function withPeriod(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}
