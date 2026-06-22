import type { S8MarketContext, S8ParserOutput, S8RequiredFixtureOutput, S8RouterDecision } from "./types";
import { S8_APPROVED_EVENT_TYPES, S8_CONTEXT_DETAIL_LABELS, S8_SNAPSHOT_METRIC_LABELS, S8_UI_MODES, scoreToS8DeliveryLevel } from "./types";
import { buildS8SourceBlockPromptInput, type S8SourceBlockPromptInput } from "./routerPrompt";

export function buildS8CompactAnalysisInput(params: {
  parserOutput: S8ParserOutput;
  routerDecision: S8RouterDecision;
  marketContext?: S8MarketContext | null;
  parentFilingContext?: Record<string, unknown> | null;
}): S8SourceBlockPromptInput {
  return buildS8SourceBlockPromptInput({
    parserOutput: params.parserOutput,
    marketContext: params.marketContext,
    parentFilingContext: params.parentFilingContext,
  });
}

export function buildS8AnalysisPrompt(params: {
  parserOutput: S8ParserOutput;
  routerDecision: S8RouterDecision;
  marketContext?: S8MarketContext | null;
  parentFilingContext?: Record<string, unknown> | null;
}): string {
  if (isDilutionAnalysisRoute(params.routerDecision)) {
    return buildS8DilutionAnalysisPrompt(params);
  }

  const sourceInput = buildS8SourceBlockPromptInput({
    parserOutput: params.parserOutput,
    marketContext: params.marketContext,
    parentFilingContext: params.parentFilingContext,
  });

  return [
    "You are writing the final investor-facing analysis for an SEC S-8 / S-8/A filing.",
    `Current runtime date for watch-next date checks: ${new Date().toISOString().slice(0, 10)}.`,
    "Use the cleaned_source_blocks packet for non-dilution or uncertain S-8 cases.",
    "S-8 flow is Parser -> cleaned source blocks -> Analysis LLM reads source blocks -> Required Output JSON.",
    "Do not add or assume a Router LLM for S-8.",
    "Return only JSON in the required output shape used by this form room.",
    "",
    "Constraints:",
    "- Choose analysis_output.event_type by reading cleaned_source_blocks. Do not copy parser-generated facts, signals, classification, event_type, display_type, routingHints, selected_classification, or score hints.",
    "- Approved event types: listing_risk, ipo_listing, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.",
    "- Use ipo_listing only for traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
    "- Do not use ipo_listing for ordinary S-8 plan registration, ordinary resale registration, shelf offering, ATM/offering dilution, already-listed issuer resale, or post-closing business update.",
    "- If an IPO/listing event is ever source-backed, use display_payload.data.ipo_kind as traditional or spac. Do not split event_type by IPO subtype.",
    "- Do not invent event_type labels outside the required output schema.",
    "- Do not invent, rename, split, merge, or create new display types.",
    "- Output score only. Do not output or choose delivery_level independently from score.",
    "- delivery_level is derived by integration from score only: score below 50 archive, 50 to 74 feed, 75 or above alert.",
    "- analysis_output.signal must be one of bullish, bearish, volatile, or neutral. Use neutral for cautious or mixed cases; do not output caution.",
    "- This prompt is for S-8 filings that reached analysis. Do not rely on parser-finalized archive output.",
    "- Router or parser-gate fields such as route_action, s8_bucket, analysis_reason, selected_classification, and score_hint are not LLM input and must not appear in the final JSON.",
    "- Analyze only the cleaned_source_blocks packet below. It intentionally excludes full SEC raw text, XML, HTML, complete attachment bodies, parser facts, and parser signals.",
    "- Do not ask for or assume omitted full raw SEC text. If a value is missing from cleaned_source_blocks, say it is unavailable.",
    "- parser_output is preserved by integration/test harness. Do not reconstruct missing raw fields from source blocks, and never convert unknown values to 0.",
    "- Use document_inventory only as availability metadata; it is not source text.",
    "- Use noise_candidates as boilerplate/exhibit context; do not let noise override source-backed compact facts.",
    "- Use market context only if it is supplied below as fixture JSON. Do not call live market APIs.",
    "- Do not query live DB or require filing_context.",
    "- Do not require filing_context for S-8 or S-8/A ownership analysis. Analyze from cleaned_source_blocks only.",
    "- Do not use same-insider 12M patterns, company 90D insider flow, or recent 30D clustering for now.",
    "- Do not add listing-risk-specific fields. Do not add new display_payload.display_type values. Do not emit delivery_level.",
    "- Treat S-8/A as an update filing, not automatically a new event.",
    "- Treat S-8 POS as administrative archive only when it is clearly deregistration-only, exhibit-only, clerical, or no-substantive-change.",
    "- Do not treat an S-8 POS as routine archive merely because it says no additional securities are registered in that amendment when it also carries prior shares into a new plan, replaces an old plan, references newly authorized plan shares, or is paired with a contemporaneous S-8.",
    "- If parent_filing_context is supplied for S-8 POS by registration file number, use it as compact historical context and do not say parent context is missing.",
    "- Preserve source distinctions among current registered shares, prior S-8 registrations, fee-table rows, inducement awards, and reoffer prospectus resale shares.",
    "- If the filing supplies an ADS-to-ordinary-share ratio, explain registered ordinary shares together with the ADS-equivalent amount and avoid scoring from the raw ordinary-share count alone.",
    "- Filing-provided sale prices and Exhibit 107 fee-calculation prices are source facts, not live market context.",
    "- Do not use registered shares as shares outstanding.",
    "- Do not treat Exhibit 107 fee-table amount as company proceeds.",
    "- Do not infer shares outstanding, public float, market cap, dilution percentage, insider status, sale timing, or market impact unless explicitly supplied.",
    "- Do not infer insider selling intent from reoffer or selling-holder registration facts.",
    "- Do not conclude illegality, SEC non-compliance, or S-8 abuse.",
    "- Treat Rule 416 as adjustment coverage, not a fixed extra share amount.",
    "- Keep plan interests separate from common stock share counts.",
    "- Do not treat generic consultant/advisor eligibility boilerplate as high-risk by itself.",
    "- Use analysis_output.needs_human_review as an admin triage flag when the final JSON is complete but source facts remain incomplete, conflicting, or parser-blocked. This is not a router action.",
    "- Do not set needs_human_review only because an otherwise administrative amendment lacks parsed fee-table rows.",
    "- display_payload.display_type must be one of generic, offering_terms, or candidate_special.",
    "- display_payload.data.s8_ui_mode must be one of plan_registration, inducement_awards, reoffer_resale, or post_effective_amendment.",
    "- Use exactly one S-8 UI mode. Do not invent, rename, or split S-8 UI modes.",
    "- UI is fixed: choose the mode from source-backed facts, then fill only fields supported by source blocks.",
    "- Use plan_registration for ordinary employee, director, consultant, or plan-share registration without resale/selling-holder source facts.",
    "- Use inducement_awards when inducement awards, inducement plans, or specific inducement grants are source-backed, including mixed filings that register both ordinary plan shares and inducement-award shares.",
    "- Use reoffer_resale only when a reoffer prospectus, resale prospectus, selling-holder section, or selling-securityholder rows are source-backed.",
    "- Use post_effective_amendment for S-8 POS, deregistration, no-additional-securities, carryover, plan replacement, or amendment-update cases.",
    "- Do not use resale wording for plan_registration, inducement_awards, or post_effective_amendment unless resale source facts are also present.",
    "- Build display_payload from source-backed values only. Do not invent UI fields.",
    "- For display_payload.data.snapshot_metrics, choose up to 4 cards from the approved S-8 labels only: " +
      S8_SNAPSHOT_METRIC_LABELS.join(", ") +
      ".",
    "- For S-8 POS reoffer/resale with parent context, populate display_payload.data.s8_context_details with up to 6 rows from these approved labels only: " +
      S8_CONTEXT_DETAIL_LABELS.join(", ") +
      ".",
    "- For S-8 POS reoffer/resale context details, prefer Parent filing, Parent plan shares, Reoffer subset, Relationship, Company proceeds, and Selling holders when source-backed.",
    "- s8_context_details should explain the relationship between the parent S-8 and current POS filing in short values, not repeat the chart calculation.",
    "- Do not output Company proceeds as an S-8 snapshot metric. Ordinary S-8 plan registration is not a cash offering.",
    "- Use Vesting Period only when cleaned_source_blocks directly state a vesting schedule or vesting condition. Otherwise omit it.",
    "- For ordinary S-8 plan registration, prefer Shares Outstanding, Registered plan shares, Plan Shares / Outstanding, and either Plan Name, Plan Type, Immediate Dilution, or Vesting Period when source-backed.",
    "- For inducement awards, prefer Shares Outstanding, Registered inducement shares, Inducement Shares / Outstanding, Award Type, Grant Date, Recipient Count, or Vesting Period when source-backed.",
    "- For reoffer/resale without parent S-8 context, prefer Shares Outstanding, Reoffer resale shares, Resale Shares / Outstanding, Selling Holders, Plan Name, or Vesting Period when source-backed.",
    "- For S-8 POS reoffer/resale with parent_filing_context, show the parent plan registration and the reoffer subset separately. Prefer Shares Outstanding, Parent plan shares, Reoffer subset, and Parent Plan / Outstanding when source-backed.",
    "- When S-8 POS reoffer/resale has parent plan context, snapshot_metrics must use Reoffer subset instead of Reoffer resale shares, and Parent Plan / Outstanding instead of Resale Shares / Outstanding.",
    "- In S-8 POS reoffer/resale, do not add the reoffer subset on top of the parent plan shares. The reoffer shares are a subset of the parent S-8 plan registration unless the current filing clearly registers additional shares.",
    "- For post-effective amendments, prefer Amendment Status, Additional Shares, Prior Shares Carried Forward, Remaining Plan Shares Removed, and Plan Name when source-backed.",
    "- The UI will not recalculate S-8 share counts from parser facts or raw text. Populate display_payload.data.total_registered_shares from cleaned_source_blocks when the current filing discloses a current total.",
    "- When source-backed, also populate display_payload.data.plan_registered_shares, parent_plan_registered_shares, inducement_award_shares, reoffer_resale_shares, current_shares_outstanding, and estimated_dilution_percent.",
    "- If the current S-8 registers both plan shares and inducement awards, use s8_ui_mode inducement_awards; total_registered_shares must equal the current source-backed components and key_evidence must show the component counts.",
    "- If total_registered_shares and current_shares_outstanding are both source-backed or supplied by market_context, calculate estimated_dilution_percent as total_registered_shares divided by current_shares_outstanding times 100.",
    "- Do not use fee-table dollar amounts, aggregate offering amount, registration fee, or plan interests as share counts.",
    "- If source blocks are insufficient to determine a share count, leave the related display_payload.data field null or empty.",
    "",
    "Common-form output fields:",
    "- event_title is the investor-facing headline.",
    "- quick_take, Positive, Negative, why_it_matters, summary, key_evidence, and what_to_watch_next are the main visible analysis fields.",
    "- analysis_output.bullish_points is displayed as Positive. analysis_output.bearish_points is displayed as Negative. These are legacy schema keys, not instructions to force stock-direction labels.",
    "- Positive and Negative may be empty when the filing is archive-level or one-sided; do not pad them with weak claims.",
    "- For S-8, Positive points must be direct favorable factors only. Do not use neutral mechanics such as no immediate cash offering, previously registered shares, employee alignment, routine compensation, assumed awards, or merger cleanup as Positive points.",
    "- Move neutral mechanics such as previously registered shares, plan consolidation, assumed awards, or no immediate cash offering into summary or key_evidence instead of bullish_points.",
    "- key_evidence should cite compact source-backed facts from the supplied filing packet.",
    "- what_to_watch_next should name concrete follow-up variables, dates, filings, conditions, or risks.",
    "- For administrative S-8/A or S-8 POS with no additional securities, do not tell users to review the parent filing or generic future filings. Either leave what_to_watch_next empty or say no immediate follow-up is needed unless a later filing registers additional shares or changes plan terms.",
    "- Do not name Section 16 filings, Form 4, or insider reports as S-8 follow-up unless the source blocks show those reports apply. Otherwise use broader grant, exercise, vesting, or share-issuance disclosures.",
    "- Do not list a deadline or dated item in what_to_watch_next if that date is before the current runtime date above. Put past dated facts in summary or key_evidence instead.",
    "",
    "Common-form reading approach:",
    "- Start from cleaned_source_blocks, not parser-generated labels or classifier summaries.",
    "- Separate current-filing source text from interpretation. If source blocks are incomplete, say what is unavailable instead of guessing.",
    "- Preserve missing, truncated, image-only, or unfetched source limitations when cleaned_source_blocks disclose them.",
    "- Keep routine employee-benefit registration modest. Highlight reoffer, selling-holder, unusual securities, substantive consultant/advisor, or conflict facts when present.",
    "",
    "Common scoring principles:",
    "- Use 0-34 for purely administrative S-8/A or S-8 POS cases: deregistration-only, exhibit-only, clerical correction, no new securities, and no reoffer, selling-holder, or substantive warning signals.",
    "- Use 35-49 for routine low-signal employee benefit registrations with clean facts but limited investor relevance.",
    "- Use 50-68 for S-8 POS cases that move prior registrations or carryover shares into a newly approved plan, replace an old plan, or pair with a contemporaneous S-8 for newly authorized shares, even if the POS itself says no additional securities are registered.",
    "- Use 50-64 for routine S-8 or General Instruction E additional securities where registered shares or offering terms are meaningful but no major red flags are present.",
    "- Use 65-74 for non-routine S-8 cases with reoffer/resale, selling-holder rows, unusual securities, substantive consultant/advisor context, incomplete/conflicting fee or plan facts, or other warning signals.",
    "- Use 75+ rarely for S-8. Reserve it for strong source-backed warning signals, major resale/overhang facts, severe conflicts, or legal/eligibility risk signals.",
    "- Do not use 75+ for ordinary employee compensation registrations.",
    "- For ADS issuers, cap ordinary employee-plan registrations below 75 unless ADS-equivalent supply, market context, resale context, or severe conflicts support alert-level urgency.",
    "- If source facts remain incomplete, conflicting, or parser-blocked, keep the score conservative and set needs_human_review true.",
    "- Do not create hidden score thresholds in this prompt beyond the approved score bands.",
    "",
    "Classifier calibration context:",
    "- Use other for pure administrative S-8 POS/S-8/A, deregistration-only, exhibit-only, clerical correction, or low-signal routine filings where no stronger approved type fits.",
    "- Use dilution_risk when registered shares, additional shares, assumed award shares, converted award shares, resale/reoffer, selling-holder rows, unusual securities, or structured offering/registration terms are central.",
    "- Use leadership_governance only when compensation plan governance, inducement plans, equity incentive governance, board/executive compensation, or plan adoption/amendment is the main investor-relevant angle and share registration mechanics are secondary.",
    "- Use insider_ownership only when selling-holder, beneficial ownership, officer/director/affiliate ownership, or planned-sale facts dominate over registration mechanics.",
    "- Use legal_risk only when source-backed consultant, promotional, financing, shell, delinquency, or compliance signals dominate the filing.",
    "- These rules are analysis guidance only. The Analysis LLM must make the final event_type call from cleaned_source_blocks.",
    "",
    "Investor-facing answer calibration:",
    "- Keep titles specific but not sensational.",
    "- Keep routine S-8 compensation registration modest: it is common, registers or reserves shares, and does not imply immediate issuance or sale.",
    "- Do not expose parser diagnostics such as fee-table parsing incomplete in investor-facing summary copy. If needed, say only that some registration table details were unavailable.",
    "- Do not imply bad news solely because securities are registered.",
    "- Surface registered amount, plan names, fee rows, and plan-to-share facts when available.",
    "- For reoffer/resale or selling-holder content, say it makes the filing less routine, summarize holder rows compactly, and do not infer sale intent.",
    "- For consultant/advisor context, distinguish boilerplate from substantive eligibility, actual issuance, investor-relations, promotional, financing, placement-agent, finder, or market-making context.",
    "- Do not allege illegality or SEC non-compliance.",
    "- Use key_evidence for cleaned_source_blocks, not invented claims.",
    "- Use what_to_watch_next for concrete follow-ups such as plan adoption, future issuance, resale activity, shareholder approvals, amendments, related filings, or missing source material.",
    "- For administrative S-8/A or S-8 POS with no additional securities, do not tell users to review the parent filing, Section 16 filings, or generic future amendments. Either leave what_to_watch_next empty or say no immediate follow-up is needed unless a later filing registers additional shares or changes plan terms.",
    "- Do not name Section 16 filings, Form 4, or insider reports as S-8 follow-up unless the source blocks show those reports apply. Otherwise use broader grant, exercise, vesting, or share-issuance disclosures.",
    "",
    ...secCommonCopyLimits(),
    "",
    "Required runtime output shape:",
    JSON.stringify(requiredRuntimeOutputTemplate(), null, 2),
    "",
    "Cleaned source blocks:",
    JSON.stringify(sourceInput, null, 2),
  ].join("\n");
}

export function buildS8DilutionAnalysisPrompt(params: {
  parserOutput: S8ParserOutput;
  routerDecision: S8RouterDecision;
  marketContext?: S8MarketContext | null;
  parentFilingContext?: Record<string, unknown> | null;
}): string {
  const sourceInput = buildS8SourceBlockPromptInput({
    parserOutput: params.parserOutput,
    marketContext: params.marketContext,
    parentFilingContext: params.parentFilingContext,
  });

  return [
    "You are writing the final investor-facing dilution analysis for an SEC S-8 / S-8/A filing.",
    `Current runtime date for watch-next date checks: ${new Date().toISOString().slice(0, 10)}.`,
    "Use judgment. Do not turn individual past test failures into brittle prompt rules.",
    "S-8 flow is Parser -> cleaned source blocks -> Analysis LLM -> Required Output JSON.",
    "Do not add or assume a Router LLM for S-8.",
    "Do not rely on parser-finalized archive output; if a case reaches this prompt, score it from source blocks.",
    "Return only JSON in the required output shape used by this form room.",
    "",
    "Hard constraints:",
    "- This prompt is usually reached because source blocks may contain dilution, offering, resale, fee-table, plan-share, or related S-8 text.",
    "- Choose analysis_output.event_type by reading cleaned_source_blocks. Do not copy parser-generated facts, signals, classification, event_type, display_type, routingHints, selected_classification, or score hints.",
    "- Approved event types: listing_risk, ipo_listing, dilution_risk, earnings, sales_performance, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, other.",
    "- Use ipo_listing only for traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
    "- Do not use ipo_listing for ordinary S-8 plan registration, ordinary resale registration, shelf offering, ATM/offering dilution, already-listed issuer resale, or post-closing business update.",
    "- If an IPO/listing event is ever source-backed, use display_payload.data.ipo_kind as traditional or spac. Do not split event_type by IPO subtype.",
    "- Do not invent event_type labels outside the required output schema.",
    "- Do not invent, rename, split, merge, or create new display types.",
    "- Output score only. Do not output or choose delivery_level independently from score.",
    "- delivery_level is derived by integration from score only: score below 50 archive, 50 to 74 feed, 75 or above alert.",
    "- analysis_output.signal must be one of bullish, bearish, volatile, or neutral. Use neutral for cautious or mixed cases; do not output caution.",
    "- Router score_hint is routing context only. Do not copy it as the final score and do not treat it as a parser-computed score.",
    "- Use market context only if it is supplied below as fixture JSON. Do not call live market APIs.",
    "- Do not query live DB or require filing_context.",
    "- Do not require filing_context for S-8 or S-8/A ownership analysis. Analyze from cleaned_source_blocks only.",
    "- Do not use same-insider 12M patterns, company 90D insider flow, or recent 30D clustering for now.",
    "- Do not add listing-risk-specific fields. Do not add new display_payload.display_type values. Do not emit delivery_level.",
    "- Router or parser-gate fields such as route_action, s8_bucket, analysis_reason, selected_classification, and score_hint are not LLM input and must not appear in the final JSON.",
    "- Analyze only the cleaned_source_blocks packet below. It intentionally excludes full SEC raw text, XML, HTML, complete attachment bodies, parser facts, and parser signals.",
    "- Do not ask for or assume omitted full raw SEC text. If a value is missing from cleaned_source_blocks, say it is unavailable.",
    "- parser_output is preserved by integration/test harness. Do not reconstruct missing raw fields from source blocks, and never convert unknown values to 0.",
    "- Start with source-backed rows, plan-share terms, reoffer/resale text, selling-holder rows, consultant/advisor text, and parser warnings only when they are represented in cleaned_source_blocks.",
    "- If source blocks are incomplete, ambiguous, or conflicting, keep the conclusion conservative and identify the missing source-backed variables.",
    "- Use document_inventory only as availability metadata; it is not source text.",
    "- Use noise_candidates as boilerplate/exhibit context; do not let noise override source-backed compact facts.",
    "- Filing-provided sale prices and Exhibit 107 fee-calculation prices are source facts, not live market context.",
    "- Preserve source distinctions among fee-table rows, inducement awards, and reoffer prospectus resale shares when present.",
    "- If the filing supplies an ADS-to-ordinary-share ratio, use the ADS-equivalent amount when judging trading-share overhang; do not treat the raw ordinary-share count as directly comparable to listed ADS float.",
    "- Do not infer insider selling intent from reoffer or selling-holder registration facts.",
    "- Do not conclude illegality, SEC non-compliance, or S-8 abuse.",
    "- Treat Rule 416 as adjustment coverage, not a fixed extra share amount.",
    "- Keep plan interests separate from common stock share counts.",
    "- Do not treat generic consultant/advisor eligibility boilerplate as high-risk by itself.",
    "- Use analysis_output.needs_human_review as an admin triage flag when the final JSON is complete but source facts remain incomplete, conflicting, or parser-blocked. This is not a router action.",
    "- Do not set needs_human_review only because an otherwise administrative amendment lacks parsed fee-table rows.",
    "- display_payload.display_type must be one of generic, offering_terms, or candidate_special.",
    "- display_payload.data.s8_ui_mode must be one of plan_registration, inducement_awards, reoffer_resale, or post_effective_amendment.",
    "- Use exactly one S-8 UI mode. Do not invent, rename, or split S-8 UI modes.",
    "- UI is fixed: choose the mode from source-backed facts, then fill only fields supported by source blocks.",
    "- Use plan_registration for ordinary employee, director, consultant, or plan-share registration without resale/selling-holder source facts.",
    "- Use inducement_awards when inducement awards, inducement plans, or specific inducement grants are source-backed, including mixed filings that register both ordinary plan shares and inducement-award shares.",
    "- Use reoffer_resale only when a reoffer prospectus, resale prospectus, selling-holder section, or selling-securityholder rows are source-backed.",
    "- Use post_effective_amendment for S-8 POS, deregistration, no-additional-securities, carryover, plan replacement, or amendment-update cases.",
    "- Do not use resale wording for plan_registration, inducement_awards, or post_effective_amendment unless resale source facts are also present.",
    "- Build display_payload from source-backed values only. Do not invent UI fields.",
    "- For display_payload.data.snapshot_metrics, choose up to 4 cards from the approved S-8 labels only: " +
      S8_SNAPSHOT_METRIC_LABELS.join(", ") +
      ".",
    "- For S-8 POS reoffer/resale with parent context, populate display_payload.data.s8_context_details with up to 6 rows from these approved labels only: " +
      S8_CONTEXT_DETAIL_LABELS.join(", ") +
      ".",
    "- For S-8 POS reoffer/resale context details, prefer Parent filing, Parent plan shares, Reoffer subset, Relationship, Company proceeds, and Selling holders when source-backed.",
    "- s8_context_details should explain the relationship between the parent S-8 and current POS filing in short values, not repeat the chart calculation.",
    "- Do not output Company proceeds as an S-8 snapshot metric. Ordinary S-8 plan registration is not a cash offering.",
    "- Use Vesting Period only when cleaned_source_blocks directly state a vesting schedule or vesting condition. Otherwise omit it.",
    "- For ordinary S-8 plan registration, prefer Shares Outstanding, Registered plan shares, Plan Shares / Outstanding, and either Plan Name, Plan Type, Immediate Dilution, or Vesting Period when source-backed.",
    "- For inducement awards, prefer Shares Outstanding, Registered inducement shares, Inducement Shares / Outstanding, Award Type, Grant Date, Recipient Count, or Vesting Period when source-backed.",
    "- For reoffer/resale without parent S-8 context, prefer Shares Outstanding, Reoffer resale shares, Resale Shares / Outstanding, Selling Holders, Plan Name, or Vesting Period when source-backed.",
    "- For S-8 POS reoffer/resale with parent_filing_context, show the parent plan registration and the reoffer subset separately. Prefer Shares Outstanding, Parent plan shares, Reoffer subset, and Parent Plan / Outstanding when source-backed.",
    "- When S-8 POS reoffer/resale has parent plan context, snapshot_metrics must use Reoffer subset instead of Reoffer resale shares, and Parent Plan / Outstanding instead of Resale Shares / Outstanding.",
    "- In S-8 POS reoffer/resale, do not add the reoffer subset on top of the parent plan shares. The reoffer shares are a subset of the parent S-8 plan registration unless the current filing clearly registers additional shares.",
    "- For post-effective amendments, prefer Amendment Status, Additional Shares, Prior Shares Carried Forward, Remaining Plan Shares Removed, and Plan Name when source-backed.",
    "- The UI will not recalculate S-8 share counts from parser facts or raw text. Populate display_payload.data.total_registered_shares from cleaned_source_blocks when the current filing discloses a current total.",
    "- When source-backed, also populate display_payload.data.plan_registered_shares, parent_plan_registered_shares, inducement_award_shares, reoffer_resale_shares, current_shares_outstanding, and estimated_dilution_percent.",
    "- If the current S-8 registers both plan shares and inducement awards, use s8_ui_mode inducement_awards; total_registered_shares must equal the current source-backed components and key_evidence must show the component counts.",
    "- If total_registered_shares and current_shares_outstanding are both source-backed or supplied by market_context, calculate estimated_dilution_percent as total_registered_shares divided by current_shares_outstanding times 100.",
    "- Do not use fee-table dollar amounts, aggregate offering amount, registration fee, or plan interests as share counts.",
    "- If source blocks are insufficient to determine a share count, leave the related display_payload.data field null or empty.",
    "- For administrative S-8/A or S-8 POS with no additional securities, do not tell users to review the parent filing or generic future filings. Either leave what_to_watch_next empty or say no immediate follow-up is needed unless a later filing registers additional shares or changes plan terms.",
    "- Do not name Section 16 filings, Form 4, or insider reports as S-8 follow-up unless the source blocks show those reports apply. Otherwise use broader grant, exercise, vesting, or share-issuance disclosures.",
    "- Do not list a deadline or dated item in what_to_watch_next if that date is before the current runtime date above. Put past dated facts in summary or key_evidence instead.",
    "",
    "Dilution analysis objective:",
    "- Extract the source-backed share stack, proceeds stack, and market-context needs from cleaned_source_blocks and fixture market context only.",
    "- Treat absent fields as unknown, not zero. Do not invent shares, prices, proceeds, float, or market cap.",
    "- Distinguish current shares outstanding, public float, market cap, price/previous close, and parser-registered shares.",
    "- Distinguish registered resale supply, selling-holder shares, primary common shares offered/registered, warrant/pre-funded warrant/convertible/preferred underlying shares, equity-line shares, future overhang, and max registered stack share-equivalent when source-backed.",
    "- Distinguish company proceeds, selling-holder proceeds, fee-table-only amounts, offering amount, ATM capacity, shelf capacity, offering price, conversion price, and warrant exercise price when source-backed.",
    "- If missing fee tables, missing parent context, conflicting share counts, or incomplete resale-holder source text prevent a confident interpretation, keep the analysis source-backed and set needs_human_review true for later admin review.",
    "- Do not expose parser diagnostics such as fee-table parsing incomplete in investor-facing summary copy. If needed, say only that some registration table details were unavailable.",
    "- For administrative S-8/A or S-8 POS with no additional securities, do not tell users to review the parent filing, Section 16 filings, or generic future amendments. Either leave what_to_watch_next empty or say no immediate follow-up is needed unless a later filing registers additional shares or changes plan terms.",
    "- Do not name Section 16 filings, Form 4, or insider reports as S-8 follow-up unless the source blocks show those reports apply. Otherwise use broader grant, exercise, vesting, or share-issuance disclosures.",
    "- If parent_filing_context is supplied for S-8 POS by registration file number, parent context is not missing; use it only as compact historical context.",
    "- Do not treat an S-8 POS as routine archive merely because it says no additional securities are registered in that amendment when it also carries prior shares into a new plan, replaces an old plan, references newly authorized plan shares, or is paired with a contemporaneous S-8.",
    "- Preserve missing, truncated, image-only, or unfetched source limitations when cleaned_source_blocks disclose them.",
    "",
    "Important prohibitions:",
    "- Do not use registered shares as shares outstanding.",
    "- Do not use authorized shares as dilution supply.",
    "- Do not compare underlying ordinary shares to listed ADS float without applying the disclosed ADS ratio.",
    "- Do not treat Exhibit 107 fee-table amount as company proceeds.",
    "- Do not treat resale proceeds as company proceeds.",
    "- Do not convert dollar shelf capacity into share-equivalent unless source-backed sale terms or a supplied market context make that conversion explicitly supportable.",
    "- Do not let parser routing hints calculate the final score for you.",
    "",
    "Scoring judgment framework:",
    "- Use 0-34 for purely administrative S-8/A or S-8 POS cases: deregistration-only, exhibit-only, clerical correction, no new securities, and no reoffer, selling-holder, or substantive warning signals.",
    "- Use 35-49 for routine low-signal employee benefit registrations with clean facts but limited investor relevance.",
    "- Use 50-68 for S-8 POS cases that move prior registrations or carryover shares into a newly approved plan, replace an old plan, or pair with a contemporaneous S-8 for newly authorized shares, even if the POS itself says no additional securities are registered.",
    "- Use 50-64 for routine S-8 or General Instruction E additional securities where registered shares or offering terms are meaningful but no major red flags are present.",
    "- Use 65-74 for non-routine S-8 cases with reoffer/resale, selling-holder rows, unusual securities, substantive consultant/advisor context, incomplete/conflicting fee or plan facts, or other warning signals.",
    "- Use 75+ rarely for S-8. Reserve it for strong source-backed warning signals, major resale/overhang facts, severe conflicts, or legal/eligibility risk signals. Do not use 75+ for ordinary employee compensation registrations.",
    "- For ADS issuers, cap ordinary employee-plan registrations below 75 unless ADS-equivalent supply, market context, resale context, or severe conflicts support alert-level urgency.",
    "- Small/micro issuer context matters, especially for base shelf or automatic shelf analysis. Treat market_cap below $300M as small issuer context when market_cap is supplied.",
    "- For base or automatic shelf: large issuer default often falls around 50-59; small/micro issuer default often falls around 55-65.",
    "- For small/micro shelf cases, share capacity at or above 20% of current shares/float or shelf dollar capacity at or above 50% of market cap generally supports alert-level concern; around 50% share/float or 100% market cap supports high-alert concern.",
    "- For large issuers, shelf dollar capacity at or above 25% of market cap can remain feed-capped unless concrete sale terms exist.",
    "- For resale, ATM, mixed, 424B, or concrete sale terms, a base feed floor often exists; at or above 20% share/float impact or 25% market-cap amount generally supports alert-level concern; at or above 50% share/float or 50% market-cap amount can support 90+ severe/urgent concern.",
    "- For S-8 employee-plan registration, focus on source-backed registered shares, plan allocation, amendment context, inducement awards, and fixture market context when supplied. Do not overstate fee-table-only amounts as cash raised.",
    "- Positive points must be direct favorable factors only. Do not use neutral mechanics such as no immediate cash offering, previously registered shares, employee alignment, routine compensation, assumed awards, or merger cleanup as Positive points.",
    "- Move neutral mechanics such as previously registered shares, plan consolidation, assumed awards, or no immediate cash offering into summary or key_evidence instead of bullish_points.",
    "- These are judgment anchors, not a substitute for reading the source facts.",
    "",
    "Classifier and answer calibration:",
    "- Use dilution_risk when registered shares, additional shares, assumed award shares, converted award shares, resale/reoffer, selling-holder rows, unusual securities, or structured offering/registration terms are central.",
    "- Use leadership_governance only when compensation plan governance, inducement plans, equity incentive governance, board/executive compensation, or plan adoption/amendment is the main investor-relevant angle and share registration mechanics are secondary.",
    "- Use insider_ownership only when selling-holder, beneficial ownership, officer/director/affiliate ownership, or planned-sale facts dominate over registration mechanics.",
    "- Use legal_risk only when source-backed consultant, promotional, financing, shell, delinquency, or compliance signals dominate the filing.",
    "- These event-type rules are analysis guidance only. The Analysis LLM must make the final event_type call from cleaned_source_blocks.",
    "- Keep routine S-8 compensation registration modest and do not imply immediate issuance, sale, or bad news solely because shares are registered.",
    "- For reoffer/resale or selling-holder content, say it makes the filing less routine, summarize holder rows compactly, and do not infer sale intent.",
    "- For consultant/advisor context, distinguish boilerplate from substantive eligibility, actual issuance, investor-relations, promotional, financing, placement-agent, finder, or market-making context.",
    "- Rule 416 covers anti-dilution adjustments and must not be counted as fixed extra shares. Plan interests must stay separate from common stock share counts. Indeterminate values remain unavailable, not zero.",
    "",
    "Required runtime output shape:",
    JSON.stringify(requiredRuntimeOutputTemplate(), null, 2),
    "",
    "Cleaned source blocks:",
    JSON.stringify(sourceInput, null, 2),
  ].join("\n");
}

function isDilutionAnalysisRoute(routerDecision: S8RouterDecision): boolean {
  if (routerDecision.route_action !== "send_to_analysis") {
    return false;
  }

  return (
    routerDecision.event_type === "dilution_risk" ||
    routerDecision.s8_bucket === "dilution_registration" ||
    routerDecision.s8_bucket === "material_dilution" ||
    routerDecision.s8_bucket === "reoffer_resale"
  );
}

function secCommonCopyLimits(): string[] {
  return [
    "SEC common copy limits:",
    "- event_title must be investor-facing and attention-worthy, not a raw SEC form title. Keep it under 90 characters.",
    "- quick_take must be one sentence under 22 words.",
    "- bullish_points, bearish_points, key_evidence, and what_to_watch_next must have max 3 items each.",
    "- Each Positive/Negative/key_evidence/what_to_watch_next item must be under 16 words.",
    "- Use compact phrases, not full article-style paragraphs.",
    "- summary must be 2-4 sentences under 100 words total.",
    "- why_it_matters must be one sentence under 35 words.",
    "- what_to_watch_next items must be concrete follow-up variables, dates, filings, conditions, or risks. Avoid vague advice.",
    "- Do not copy parser/schema wording. Rewrite source-backed facts into natural investor-facing language.",
  ];
}

export function validateS8RequiredFixtureOutput(output: S8RequiredFixtureOutput): string[] {
  const errors: string[] = [];

  if ("filing_context" in (output as Record<string, unknown>)) {
    errors.push("filing_context must not be part of required fixture output.");
  }

  if ("filing_context" in (output.parser_output as Record<string, unknown>)) {
    errors.push("filing_context must not be part of parser_output.");
  }

  if (output.parser_output.parserGroup !== "s8") {
    errors.push("parser_output.parserGroup must be s8.");
  }

  if (!S8_APPROVED_EVENT_TYPES.includes(output.analysis_output.event_type)) {
    errors.push(`analysis_output.event_type is not approved: ${output.analysis_output.event_type}.`);
  }

  if (!["bullish", "bearish", "volatile", "neutral"].includes(output.analysis_output.signal)) {
    errors.push(`analysis_output.signal is not approved: ${output.analysis_output.signal}.`);
  }

  const derivedDelivery = scoreToS8DeliveryLevel(output.analysis_output.score);
  if (output.fixture_expected.expected_delivery_level !== derivedDelivery) {
    errors.push(
      `fixture_expected.expected_delivery_level must derive from score ${output.analysis_output.score}; expected ${derivedDelivery}.`,
    );
  }

  if (!["generic", "offering_terms", "candidate_special"].includes(output.display_payload.display_type)) {
    errors.push(`display_payload.display_type is not approved: ${output.display_payload.display_type}.`);
  }

  const s8UiMode = output.display_payload.data?.s8_ui_mode;
  if (typeof s8UiMode !== "string") {
    errors.push("display_payload.data.s8_ui_mode is required.");
  } else if (!S8_UI_MODES.includes(s8UiMode as (typeof S8_UI_MODES)[number])) {
    errors.push(`display_payload.data.s8_ui_mode is not approved: ${s8UiMode}.`);
  }

  if (output.fixture_expected.market_context_needed && output.fixture_expected.market_context_fields.length === 0) {
    errors.push("market_context_fields must be populated when market_context_needed is true.");
  }

  return errors;
}

function requiredOutputTemplate(): S8RequiredFixtureOutput {
  return {
    parser_output: {
      parserVersion: "string",
      parserGroup: "s8",
      formType: "S-8 / S-8/A",
      accessionNumber: "string | null",
      isSupported: true,
      summary: "string | null",
      facts: {
        issuerName: "string | null",
        ticker: "string | null",
        exchange: "string | null",
        filedAt: "string | null",
        isAmendment: false,
        amendmentType: "string | null",
        planNames: [],
        securityType: "string | null",
        registeredShares: 0,
        additionalShares: 0,
        parentRegisteredShares: 0,
        estimatedOfferingAmount: 0,
        registrationFee: 0,
        feeTableRows: [],
        planShareAllocations: [],
        priorRegistrationStatements: [],
        reverseSplitAdjustments: [],
        reofferProspectus: false,
        reofferShares: 0,
        reofferNoIssuerProceeds: false,
        sellingSecurityholders: [],
        inducementAwards: [],
        inducementAwardTotalShares: 0,
        generalInstructionE: false,
        correctionOnly: false,
        filingProvidedPrice: null,
        dilutionPercentOfSharesOutstanding: 0,
        dilutionPercentOfPublicFloat: 0,
        noAdditionalSecurities: false,
        exhibitOnly: false,
        signatureOnly: false,
        needsParentComparison: false,
      },
      signals: [],
      calendarItems: [],
      warnings: [],
      raw: {
        sourceTextExcerpt: "string",
        sourceDocuments: [],
        noiseCandidates: [],
        attachments: [],
        parentFilingContext: null,
        marketContext: null,
        extractedShareCounts: [],
      },
    },
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "other",
      event_title: "string",
      primary_ticker: { ticker: "string | null", exchange: "string | null" },
      tickers: [],
      sector: "string | null",
      industry_group: "string | null",
      theme_group: "string | null",
      sub_theme: "string | null",
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
        s8_ui_mode: "plan_registration",
      },
      evidence: [],
      notes: [],
    },
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

function requiredRuntimeOutputTemplate() {
  return {
    parser_output: {
      parserVersion: "preserve from provided parser output",
      parserGroup: "s8",
      formType: "preserve from provided parser output",
      accessionNumber: "preserve from provided parser output or null",
      isSupported: true,
      summary: "preserve from provided parser output or null",
      facts: "preserve parser facts object; do not invent missing facts",
      signals: [],
      calendarItems: [],
      warnings: [],
      raw: "preserve compact parser raw object when available",
    },
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "approved SEC event type",
      event_title: "short investor-facing title",
      primary_ticker: { ticker: "ticker or null", exchange: "exchange or null" },
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 0,
      score_reason: "short source-backed reason",
      signal: "bullish | bearish | volatile | neutral",
      quick_take: "one sentence",
      summary: "2-4 compact sentences under 100 words total",
      why_it_matters: "one sentence",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "high | medium | low",
      needs_human_review: false,
      archive_summary: null,
    },
    display_payload: {
      display_type: "generic | offering_terms | candidate_special",
      data: {
        s8_ui_mode: "plan_registration | inducement_awards | reoffer_resale | post_effective_amendment",
        total_registered_shares: null,
        plan_registered_shares: null,
        parent_plan_registered_shares: null,
        parent_plan_dilution_percent: null,
        reoffer_subset_of_parent_plan_percent: null,
        reoffer_subset_of_parent_plan: null,
        inducement_award_shares: null,
        reoffer_resale_shares: null,
        current_shares_outstanding: null,
        estimated_dilution_percent: null,
        share_count_basis: "short source-backed explanation or null",
        snapshot_metrics: [
          {
            label: "one approved S-8 snapshot label",
            value: "short source-backed value",
            note: "short plain-English note or null",
            emphasis: false,
            tone: "neutral",
          },
        ],
        s8_context_details: [
          {
            label: "one approved S-8 context label",
            value: "short source-backed value",
          },
        ],
      },
      evidence: [],
      notes: [],
    },
  };
}
