import {
  APPROVED_EVENT_TYPES,
  deriveDeliveryLevel,
  type MarketContext,
  type ParserOutput,
  type RequiredOutputJson,
  type S4F4AnalysisPlan,
} from "./types.ts";
import { buildCurrentFilingIdentity } from "../common/currentFilingIdentity.ts";

export function buildS4F4AnalysisPrompt(
  parserOutput: ParserOutput,
  analysisPlan: S4F4AnalysisPlan = buildS4F4GenericAnalysisPlan(),
  marketContext?: MarketContext | null,
  displayPayload?: unknown,
  parentFilingContext?: Record<string, unknown> | null,
): string {
  void analysisPlan;
  void displayPayload;
  const currentFiling = buildCurrentFilingIdentity({
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: parserOutput.formType,
  });

  return [
    "You are writing the final investor-facing analysis for an SEC S-4/F-4 filing.",
    "Use only the cleaned_source_blocks, parent filing context, and market_context included below.",
    "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same S-4/F-4 family.",
    "For S-4/A and F-4/A, use parent filing context only as compact historical context. Do not treat the parent filing as newly filed.",
    "If parent filing context is missing, do not invent amendment deltas; say comparison is limited when relevant.",
    "If parent filing context shows this amendment repeats an already-disclosed transaction with no source-backed material update, keep the score capped below alert unless the current filing adds a decisive new update.",
    "If the current amendment changes consideration, exchange ratio, financing, vote terms, closing conditions, redemptions, legal/regulatory status, or other investor economics versus parent context, score based on that changed term.",
    "Do not use parser facts, parser signals, parser classifications, or parser labels as authority.",
    `Choose exactly one event_type from these 16 approved values: ${APPROVED_EVENT_TYPES.join(", ")}.`,
    "First identify the S-4/F-4 filing subtype from source blocks, then apply the matching analysis guide.",
    "Always output display_payload.display_type=generic for S-4/F-4 filings.",
    "Do not use spac_transaction_status for S-4/F-4. De-SPAC S-4/F-4 filings should still use the common generic filing detail UI.",
    "S-4/F-4 scoring is based on the new actionable impact of the filing, not the existence of a merger or the length of the document.",
    "S-4/F-4 subtype: merger, acquisition, share exchange, or business combination. Usually event_type=strategic_transaction. Use shareholder_vote only when the filing is mainly a vote-date, meeting, vote-result, or approval-procedure update rather than deal terms. Use legal_risk, financial_risk, dilution_risk, capital_return, dividends, or other only when that topic is the main source-backed event.",
    "General merger, acquisition, business combination, or share exchange base score is 60-74 when the filing provides transaction terms but no decisive new result.",
    "S-4/F-4 subtype: SPAC/de-SPAC business combination or status update. Use event_type=strategic_transaction for de-SPAC progress, vote, redemption, minimum-cash, closing-condition, closing, or ticker-change status unless the filing is only a procedural vote notice.",
    "de-SPAC scoring is based on newly confirmed status change, not the mere existence of a SPAC merger or business combination.",
    "de-SPAC base score 30-45: no-change amendment, consent, fee table, signature, or admin-only update.",
    "de-SPAC base score 50-59: S-4/F-4 proxy/prospectus update, vote date, record date, or redemption rights explanation only.",
    "de-SPAC base score 60-69: concrete deal terms, target, exchange/ownership, vote requirement, redemption mechanics, minimum cash condition, or PIPE/backstop terms.",
    "de-SPAC base score 70-74: vote, redemption, extension, or financing numbers are disclosed, but closing success or failure is not confirmed.",
    "de-SPAC score 75-84: vote approved or failed, high redemption with financing pressure, minimum cash waiver or failure, PIPE/backstop change, closing completed, or ticker/listing change confirming closing.",
    "de-SPAC score 85+: deal termination, closing failure, minimum cash failure causing deal crisis, financing collapse, listing failure, injunction, or regulatory block.",
    "For de-SPAC, use shareholder_vote when vote result, adjournment, insufficient votes, or approval threshold is the central update.",
    "For de-SPAC, use financial_risk when minimum cash, financing failure, trust depletion, PIPE/backstop failure, solvency, or survival financing is central.",
    "For de-SPAC, use listing_risk when listing failure, exchange approval failure, Nasdaq/NYSE condition failure, or delisting risk is central.",
    "Do not use ipo_listing for ordinary de-SPAC status.",
    "Ticker change alone is not listing_risk and is not 75+.",
    "Calculate redemption rate only when source blocks or market_context provide the pre-redemption public share count or shares subject to redemption.",
    "Do not use generic shares outstanding, current float, market cap, or post-redemption trading data as the redemption-rate denominator.",
    "If redemption share count or amount is disclosed but redemption rate, remaining public float, minimum cash impact, or financing pressure is not clear, score 70-74 rather than 75+.",
    "Redemption rate 50%+ is usually 68-74.",
    "Redemption rate 70%+ can be 75+ only if it pressures float, trust cash, minimum cash, or deal financing.",
    "Redemption rate 85%+ is usually an alert candidate, especially with low float, minimum cash risk, or financing pressure.",
    "Minimum cash failed or waived is 75+ when it materially changes closing certainty; determine signal from source context.",
    "Vote failed or adjourned due to vote issue is 75+.",
    "Closing completed plus ticker/listing confirmed is 75-82.",
    "Ticker change alone without closing confirmation is 60-70, and 75+ is prohibited.",
    "For S-4/F-4 de-SPAC filings, most scores should be 60-74 because these are usually proxy/prospectus filings, not result filings.",
    "For S-4/F-4 de-SPAC filings, use 75+ only when the filing contains a clear status change such as vote result, redemption result with pressure, minimum cash failure or waiver, closing completion, financing collapse, termination, injunction, regulatory block, or material amendment to deal economics.",
    "Do not use ipo_listing for de-SPAC transaction status, redemption, business-combination vote, minimum cash, closing update, or ticker-change update. These are not plain SPAC IPO events.",
    "S-4/F-4 subtype: meeting logistics, vote date, record date, or approval process. Use event_type=shareholder_vote with base score 50-64.",
    "For shareholder_vote, score 75+ only for actual vote result, failed vote, insufficient votes, adjournment caused by voting problems, or changed approval threshold.",
    "Do not treat a substantive de-SPAC S-4/A as routine archive merely because it is an amendment. If the source blocks disclose a business combination plus vote, PIPE/backstop, redemption, minimum cash, listing, or closing-condition facts, score it at least 50 unless the filing explicitly says it is administrative-only or no-change.",
    "S-4/F-4 subtype: exchange offer, share exchange, or registered share issuance. Use strategic_transaction when tied to merger, acquisition, or business combination. Use dilution_risk when new share issuance, exchange ratio, final ownership, or dilution is the dominant impact. Use financial_risk when the exchange is debt restructuring, distressed exchange, maturity extension, solvency repair, or survival financing. Base score is 55-74.",
    "Registered or maximum shares alone should not drive dilution_risk or 75+ unless supported by pro forma ownership, final issuance, closing-result share count, or explicit dilution language.",
    "Routine note registration exchange: if an S-4 only exchanges unregistered notes for registered notes with materially identical terms, no cash proceeds, and no increase in indebtedness, use event_type=other unless distress or financing risk is source-backed. Score 30-49 for administrative/routine cases, or 50-59 only when holder liquidity or tender mechanics are meaningfully relevant.",
    "S-4/F-4 subtype: debt exchange, restructuring, financing condition, solvency, or distressed recapitalization. Use financial_risk when financing or balance-sheet risk is the main source-backed event. Base score is 65-85.",
    "For financial_risk, score 75+ requires distressed context, survival financing, large debt-for-equity conversion, failed financing condition, going-concern pressure, or material solvency risk.",
    "S-4/F-4 subtype: active litigation, injunction, regulatory block, appraisal/dissenters dispute, or enforcement-heavy update. Use legal_risk when legal or regulatory conflict is the main source-backed event. Base score is 65-85 for active blocking or transaction-threatening legal risk.",
    "Routine merger litigation, stockholder complaints, disclosure-only settlements, or standard litigation risk factors should not exceed 55-60 unless they delay, block, threaten, or materially change the transaction.",
    "S-4/F-4 subtype: distribution, spin-off, split-off, dividend-like transaction, or return-of-capital mechanics. Use capital_return or dividends only when the source blocks describe an actual distribution, dividend-like value transfer, spin-off, or split-off to holders. Otherwise keep strategic_transaction. Base score is 55-75.",
    "S-4/F-4 subtype: administrative S-4/A or F-4/A, consent, fee table, signature, no-change exhibit filing, source unavailable, or unclear low-signal update. Use other when no stronger approved event_type is source-backed.",
    "Administrative-only, consent, fee table, signature, or no-change amendment base score is 20-45. Source unavailable, index-only, or graphic-only base score is 10-35.",
    "Archive scoring below 50 is appropriate for administrative amendments, consents, signatures, fee table updates, no-change amendments, source unavailable, or no new transaction content.",
    "Low-feed scoring 50-59 is appropriate for real transaction filings with weak new information, meeting logistics, record dates, vote dates, procedural updates, or already-known merger details without changed economics.",
    "Normal-feed scoring 60-74 is appropriate for standard S-4/F-4 transaction filings with merger agreement, exchange ratio, consideration, vote requirement, closing conditions, de-SPAC proxy/prospectus amendment, or registered share issuance but no decisive result yet.",
    "Alert scoring 75+ requires strong actionable impact: source plus market_context confirmed 20%+ premium or discount, vote approved or failed, deal terminated, closing failed, financing condition failed, minimum cash failed or waived, high redemption result, litigation injunction or regulatory block, material amendment to consideration, exchange ratio, ownership, or closing condition, final ownership, final share count, confirmed dilution, distressed restructuring, or survival financing.",
    "S-4/F-4 generally is not a traditional IPO form. Use ipo_listing only when the filing's primary event is listing effectiveness or first public listing itself, not de-SPAC transaction status, vote, redemption, closing, ticker change, or exchange listing mention.",
    "Build display_payload from source-backed facts only. The display_payload.data object should use the generic filing payload fields already supported by the common filing detail page.",
    "For de-SPAC S-4/F-4 filings, discuss source-backed status items in the generic fields: business combination status, merger vote or meeting, redemption result or redemption rights, trust account or minimum cash condition, sponsor support, PIPE/backstop/non-redemption/lock-up terms, ticker or listing condition, closing condition, regulatory approval, financing condition, litigation, and amendment change status.",
    "Do not treat a plain blank-check IPO registration, generic fractional-share redemption, generic preferred-stock redemption rights, or exchange-agent cash-in-lieu mechanics as de-SPAC status unless the source blocks tie it to a SPAC/de-SPAC business combination.",
    "Distinguish registration or fee-calculation quantities from actual dilution evidence. Filing-fee table quantities are not primary evidence of dilution, deal value, final issuance, or final ownership.",
    "When discussing dilution, cite pro forma ownership, capitalization, weighted-average shares, risk-factor dilution language, or closing-result share counts as evidence. Do not cite filing-fee table quantities as the primary dilution evidence when stronger pro forma or ownership evidence is available.",
    "For de-SPAC or business-combination S-4/F-4 filings, do not describe ownership changes as dilution from the filing itself. Use immediate dilution only when the filing states dilution occurs upon closing, completed issuance, or immediate share issuance; otherwise use post-closing ownership dilution, pro forma ownership shift, public-holder ownership compression, or float/cash pressure when discussing redemption, PIPE, sponsor, or merger consideration effects.",
    "If a quantity is registered, maximum, estimated, or fee-calculation based, qualify it with wording such as registered, up to, estimated, possible, or subject to closing mechanics. Use definitive wording only when final issuance, dilution, deal value, or ownership is separately source-backed.",
    "For mergers and business combinations, distinguish the issuer/acquirer perspective from the target/shareholder perspective. If primary_ticker represents the issuer or acquirer, focus on source-backed issuance, possible dilution, financing, strategic rationale, closing conditions, and integration risk. If primary_ticker represents the target, focus on source-backed consideration, vote requirement, appraisal or dissenters' rights, closing certainty, and delisting or conversion mechanics.",
    "Do not infer premium, relative deal size, dilution percentage, valuation impact, or whether the exchange ratio is favorable without supplied market_context or explicit pro forma, capitalization, ownership, or closing-result source blocks. When those fields are needed for a responsible interpretation, set market_context_needed=true and name the missing fields.",
    "Use current market price as the premium/discount benchmark only when market_context supplies the needed current prices. For target holders, compare consideration value against the target current price. For stock or mixed consideration, calculate implied value only when the acquirer current share price is supplied.",
    "If the target-holder current-market premium or discount is 20% or more in absolute terms, score the filing at 75 or above so delivery becomes alert. Call it current-market premium or current-market discount, not announcement premium.",
    "If current prices needed for premium/discount are missing, do not label premium or discount. Set market_context_needed=true instead.",
    "A merger, acquisition, business combination, share exchange, or de-SPAC transaction should generally be treated as event-driven and potentially volatile, not inherently Positive or Negative.",
    "Do not treat the existence of a merger agreement, transaction filing, board approval, recommendation, or deal process as a positive or negative signal by itself.",
    "Do not treat procedural progress as Positive by default. Signed agreements, filed documents, committee formation, financing commitments, approvals sought, review processes, or transaction steps belong in summary or key_evidence unless they clearly improve investor economics or remove a material risk.",
    "A reduction in uncertainty is Positive only when the filing shows a material condition was satisfied, a major risk was removed, or investor economics improved.",
    "Vote requirements, customary closing conditions, SEC effectiveness, pending closing, delisting, or conversion mechanics are process facts, not standalone Positive or Negative points.",
    "Positive/Negative points require a separate source-backed economic benefit, economic cost, risk outcome, or market-context-supported implication for the primary_ticker.",
    "Merger Positive/Negative hard rule: process facts are invalid in bullish_points and bearish_points.",
    "Invalid merger Positive points: merger agreement exists, board recommends, fairness opinion exists, exchange ratio disclosed, S-4 filed, registration filed, vote required, meeting pending, closing pending.",
    "Invalid merger Negative points: vote required, meeting pending, SEC effectiveness pending, customary closing conditions, delisting, conversion mechanics, filing-fee table quantities, registration fee dollar amounts.",
    "For merger filings, leave bullish_points and bearish_points empty unless a valid directional economic or risk outcome is explicitly source-backed.",
    "For neutral strategic-transaction S-4/F-4 filings, leave bearish_points empty unless there is a distinct adverse outcome. Put ownership-shift, redemption, PIPE, minimum-cash, and closing-condition facts in key_evidence or why_it_matters unless they directly create a bearish conclusion.",
    "Never put neutral procedural transaction facts in bullish_points or bearish_points.",
    "Board recommendations, vote requirements, meeting logistics, customary closing conditions, missing dates, merger-related delisting or conversion mechanics, fairness-opinion existence, and filing-fee table quantities must go to key_evidence, why_it_matters, or what_to_watch_next.",
    "Use bullish_points or bearish_points only when the source explicitly states a favorable or adverse economic/risk outcome for the primary_ticker. The UI displays these legacy keys as Positive and Negative.",
    "Write investor-facing copy only: title, quick_take, summary, why_it_matters, evidence wording, watch items, confidence, and score_reason.",
    "Score bands are fixed: score below 50 = archive, 50 to 74 = feed, 75 or above = alert.",
    "delivery_level is derived by integration from analysis_output.score; do not invent a separate delivery field.",
    "Build display_payload directly from cleaned_source_blocks, parent_filing_context, and market_context. Do not copy parser-built display payload drafts.",
    "Output generic display only. Do not invent unsupported display fields.",
    "display_payload must always include top-level evidence and notes arrays. Use [] when no display-specific evidence or notes are available.",
    "Investor-facing field rules apply to analysis_output for the generic display. De-SPAC filing details belong in quick_take, summary, why_it_matters, key_evidence, and what_to_watch_next.",
    "quick_take: write one clear sentence under 22 words. Include the main event, security or offer type, and likely impact when possible.",
    "summary: write 2-4 short sentences under 100 words total. Explain what happened, who is acting, what securities are affected, and why the filing matters.",
    "For de-SPAC S-4/F-4 summaries, identify both the SPAC or registrant and the target company, and explain their roles in plain language.",
    "summary must use explicit subjects such as The bidder, The company, The offer, The target board, or Shareholders.",
    "why_it_matters: write one clear sentence under 28 words. Explain the market relevance, shareholder impact, dilution risk, control-change risk, or transaction uncertainty.",
    "score_reason: write one sentence under 14 words. Explain the main score driver and any cap or gate reason.",
    "Positive: include up to 3 items through analysis_output.bullish_points. Include fewer items, or none, if there are not enough direct favorable points.",
    "Each Positive item must be under 18 words, with a clear subject.",
    "Positive may include only direct shareholder upside, value realization, premium, cash consideration, reduced dilution, or improved transaction economics.",
    "Positive must not treat closing certainty, committed financing, board process, or procedural conditions as favorable by itself.",
    "Negative: include up to 3 items through analysis_output.bearish_points. Include fewer items, or none, if there are not enough direct adverse points.",
    "Each Negative item must be under 18 words, with a clear subject.",
    "Negative may include only direct adverse effect, discount, dilution, failed-deal risk, financing uncertainty, rejection, coercive terms, or high conditionality.",
    "For pre-closing de-SPAC or business-combination proxy/prospectus filings, do not put public-holder ownership dilution, ownership compression, redemption scenarios, sponsor or PIPE ownership increases, or merger consideration effects in bearish_points. Put them in key_evidence, why_it_matters, summary, or what_to_watch_next unless the filing reports an actual adverse result such as failed vote, termination, minimum cash failure, financing collapse, closing failure, or final redemption pressure.",
    "key_evidence: include up to 3 items. Each item must be under 22 words and include only concrete, source-backed facts.",
    "key_evidence should use concrete terms such as price, premium, share count, minimum condition, expiration date, agreement, waiver, or filing type.",
    "Place closing-certainty facts in key_evidence when they are important but not Positive or Negative.",
    "what_to_watch_next: include up to 3 items. Include concrete upcoming variables, filings, dates, approvals, conditions, or risks.",
    "Each what_to_watch_next item must be under 18 words.",
    "what_to_watch_next must avoid vague advice such as watch market reaction or monitor developments.",
    "Do not use subjectless fragments in user-facing fields.",
    "Do not force three items when only one or two source-backed points exist.",
    "Prefer fewer, clearer items over vague filler.",
    "Do not repeat the same fact across bullish_points, bearish_points, and key_evidence.",
    "If a factor mainly affects closing probability, classify it as key evidence or what_to_watch_next, not bullish_points.",
    "Writing style:",
    "Use plain investor language. Rewrite SEC/legal phrasing into clear, simple wording without changing the meaning.",
    "Do not copy filing jargon when a simpler phrase is possible.",
    "Keep each point self-contained and easy to understand.",
    "Avoid legalistic fragments, copied definitions, and sentence pieces that only make sense inside the original filing.",
    "Return JSON only in the Required Output JSON shape.",
    "",
    "Required Output JSON shape:",
    JSON.stringify(requiredOutputSkeleton(), null, 2),
    "",
    "Current filing identity:",
    JSON.stringify(currentFiling, null, 2),
    "",
    "Cleaned source blocks:",
    JSON.stringify(parserOutput.cleaned_source_blocks, null, 2),
    "",
    "Parent filing context:",
    JSON.stringify(parentFilingContext ?? null, null, 2),
    "",
    "Fixture market_context:",
    JSON.stringify(marketContext ?? null, null, 2),
  ].join("\n");
}

export function validateRequiredOutputJson(output: RequiredOutputJson): string[] {
  const errors: string[] = [];
  const scoreDelivery = deriveDeliveryLevel(output.analysis_output.score);

  if (!APPROVED_EVENT_TYPES.includes(output.analysis_output.event_type)) {
    errors.push(`Unapproved event type: ${output.analysis_output.event_type}`);
  }

  if (output.parser_output.parserGroup !== "s4-f4") {
    errors.push("parser_output.parserGroup must be s4-f4.");
  }

  if (output.analysis_output.source_group !== "filings") {
    errors.push("analysis_output.source_group must be filings.");
  }

  if (output.fixture_expected.expected_delivery_level !== scoreDelivery) {
    errors.push(`Expected delivery level ${output.fixture_expected.expected_delivery_level} does not match score-derived ${scoreDelivery}.`);
  }

  if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(output.display_payload.display_type)) {
    errors.push(`Unsupported display type: ${output.display_payload.display_type}`);
  }

  if (output.fixture_expected.market_context_needed && output.fixture_expected.market_context_fields.length === 0) {
    errors.push("market_context_needed=true requires market_context_fields.");
  }

  if (
    output.fixture_expected.special_ui_needed &&
    !["candidate_special", "spac_transaction_status"].includes(output.display_payload.display_type)
  ) {
    errors.push("special_ui_needed=true requires display_payload.display_type=candidate_special or spac_transaction_status.");
  }

  return errors;
}

function requiredOutputSkeleton(): RequiredOutputJson {
  return {
    parser_output: {
      parserVersion: "string",
      parserGroup: "s4-f4",
      formType: "S-4 / F-4 / S-4/A / F-4/A",
      accessionNumber: "string | null",
      isSupported: true,
      summary: "string | null",
      facts: {},
      signals: [],
      calendarItems: [],
      warnings: [],
      raw: {},
    } as unknown as RequiredOutputJson["parser_output"],
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "other",
      event_title: "string",
      primary_ticker: { ticker: "string | null", exchange: "string | null" },
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 0,
      score_reason: "string",
      signal: "neutral",
      quick_take: "string",
      summary: "string",
      why_it_matters: "string",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "medium",
      needs_human_review: false,
    },
    display_payload: {
      display_type: "generic",
      data: {
        display_version: "s4_f4_generic_v1",
        form_type: "S-4 | S-4/A | F-4 | F-4/A",
        filing_summary: "one concise source-backed summary sentence",
        key_terms: [],
        amendment_context: "string | null",
        source_inventory: [],
      },
      evidence: [],
      notes: [],
    } as unknown as RequiredOutputJson["display_payload"],
    fixture_expected: {
      expected_delivery_level: "archive",
      expected_impact: "low",
      market_context_needed: false,
      market_context_reason: null,
      market_context_fields: [],
      special_ui_needed: false,
      special_ui_reason: null,
      integration_notes: [],
    },
  };
}

export function buildS4F4GenericAnalysisPlan(): S4F4AnalysisPlan {
  return {
    event_type: "other",
    preliminary_action: "analysis_required",
    display_type: "generic",
    display_version: "s4_f4_generic_v1",
    requires_analysis: true,
    deterministic: false,
    reason: "S-4/F-4 runtime uses analysis-only classification from cleaned source blocks.",
    analysis_basis: ["analysis_only_runtime"],
    analysis_focus: [
      "Classify event_type, score, and investor-facing copy from cleaned_source_blocks.",
      "For amendments, use parent_filing_context only when provided.",
    ],
  };
}
