import {
  APPROVED_SEC_EVENT_TYPES,
  type S1F1ParserOutput,
  type S1F1RequiredOutputJson,
  isApprovedSecEventType,
} from "./types.ts";
import { buildS1F1LlmSourceInput } from "./sourceInput.ts";
import { SEC_RESALE_OVERHANG_SCORING_GUIDE } from "../common/resaleOverhangScoring";

const REQUIRED_TOP_LEVEL_KEYS = ["parser_output", "analysis_output", "display_payload"] as const;

const REQUIRED_ANALYSIS_KEYS = [
  "source_group",
  "market_scope",
  "event_type",
  "event_title",
  "primary_ticker",
  "tickers",
  "sector",
  "industry_group",
  "theme_group",
  "sub_theme",
  "score",
  "score_reason",
  "signal",
  "quick_take",
  "summary",
  "why_it_matters",
  "bullish_points",
  "bearish_points",
  "key_evidence",
  "what_to_watch_next",
  "related_tickers",
  "calendar_items",
  "confidence",
  "needs_human_review",
] as const;

const S1F1_DISPLAY_MODES = [
  "ipo_registration",
  "ipo_amendment",
  "routine_amendment",
  "resale_registration",
  "atm",
  "primary_offering",
  "registered_direct",
  "warrant_convertible",
  "rights_offering",
  "shelf_capacity",
  "mixed_offering",
  "spac_ipo",
  "rule_462b_mef",
  "post_effective_amendment",
  "generic",
] as const;

const S1F1_PROMPT_VERSION = "s1-f1-analysis-v2";

export function buildS1F1AnalysisPrompt(
  parserOutput: S1F1ParserOutput,
  _routerDecision?: unknown,
  _displayPayload?: unknown,
): string {
  return [
    "You are writing the final investor-facing analysis for one SEC S-1/F-1 registration filing.",
    "Use only cleaned_source_blocks, attachment inventory, parent_filing_context if present, and optional market context in the cleaned source input.",
    "S-1/F-1 flow is Parser -> cleaned source blocks -> Analysis LLM -> Required Output JSON.",
    "There is no S-1/F-1 router LLM and no parser-built display payload in runtime.",
    "The parser only preserves relevant source text. Do not treat parser-generated facts, signal labels, offering kinds, risk flags, extraction summaries, or display labels as authority.",
    "Choose event_type, score, signal, display_payload.display_type, and display_payload.data yourself from the source blocks.",
    "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same S-1/F-1 family.",
    "For S-1/A and F-1/A, first decide whether the current amendment contains a full updated prospectus/registration statement or only a partial administrative update.",
    "If the current amendment contains full current offering, resale, IPO, or financing terms, analyze the current filing as the authoritative current version. Use parent_filing_context only to identify clearly source-backed changes. Do not force amendment_changes.",
    "If the current amendment is exhibit-only, consent-only, fee-table-only, financial-update-only, POS-style, or otherwise lacks enough current offering terms, use parent_filing_context as background to explain what registration/offering the amendment relates to.",
    "Write amendment_changes only for source-backed changed terms from explicit current-filing language or reliable comparison with parent_filing_context. If comparison evidence is insufficient, leave amendment_changes empty and do not invent changed economics.",
    "Do not call live APIs, live market data, DBs, ingest code, alert delivery, or UI code.",
    "Do not invent, correct, or substitute ticker symbols. If ticker or exchange is unclear, preserve null or state uncertainty.",
    "If a source block conflicts with package ticker context, keep the package ticker in primary_ticker and explain the conflict in key_evidence or needs_human_review.",
    "",
    "Approved event_type values, and no others:",
    APPROVED_SEC_EVENT_TYPES.map((eventType) => `- ${eventType}`).join("\n"),
    "",
    "Delivery score bands:",
    "- score below 50 = archive",
    "- score 50 to 74 = feed",
    "- score 75 or above = alert",
    "",
    "Writing limits:",
    "- quick_take: one sentence, under 28 words.",
    "- summary: 2-4 sentences, under 100 words total.",
    "- why_it_matters: one sentence, under 35 words.",
    "- score_reason: under 18 words.",
    "- bullish_points: up to 3 short items. This legacy schema key is displayed as Positive; leave empty if there is no direct positive point.",
    "- bearish_points: up to 3 short items. This legacy schema key is displayed as Negative; leave empty if there is no direct negative point.",
    "- key_evidence: up to 4 source-backed facts.",
    "- what_to_watch_next: up to 3 concrete next filings, dates, approvals, pricing terms, effectiveness, lock-up, or closing variables.",
    "Use plain investor language. Avoid abstract phrases such as holder economics, structural impact, optionality, de-risked, or execution visibility.",
    "Do analysis, not just recap. In narrative_summary, why_it_matters, and Negative points, connect source-backed facts to their practical investor consequence: dilution pressure, resale supply, cash need, control concentration, lock-up or sale-readiness, unfavorable conversion/reset terms, pricing uncertainty, or weak protection for existing holders.",
    "Do not infer hidden intent, undisclosed risk, fraud, or management motive. The analysis must explain the situation created by disclosed facts, not speculate about what the company is trying to hide.",
    "Do not create risks from form type alone. Describe the disclosed registration, offering mechanics, terms, changes, conditions, and dates.",
    "",
    "S-1/F-1 fee-table and preliminary-price rules:",
    "- Values from EX-FILING FEES, EX-107, filing fee tables, Calculation of Filing Fee Table, Rule 457(c), Rule 457(o), Rule 457(g), average high/low market price calculations, proposed maximum offering price, maximum aggregate offering price, assumed public offering price, or text described as estimated solely for calculating the registration fee are SEC fee-calculation values.",
    "- Do not use SEC fee-calculation values as Offer price, Sale Price, Company proceeds, chart price marker, final public offering price, investment price, discount/premium basis, or final priced offering terms.",
    "- SEC fee-calculation values may appear only as SEC registration value, registered amount, filing fee basis, Fee table, or source_notes, and must be labeled as fee-table or registration-fee values.",
    "- The same dollar or per-share value may be used as an actual offering term only when it is independently stated as an actual price, purchase price, gross proceeds, net proceeds, or sale term in the prospectus cover, prospectus body, offering table, underwriting or placement section, use of proceeds, purchase agreement, or other transaction document.",
    "- Fee-table share counts and security classes may support registered amount or securities registered, but they do not prove shares were sold, final pricing was set, or company proceeds were received.",
    "- For preliminary S-1/F-1, S-1/A, and F-1/A filings, an assumed offering price or proposed maximum offering price is not a final offering price.",
    "- If the only source for a price is a fee table or fee-calculation sentence, use Not fixed yet or Assumed for fee calculation when a UI status is needed; do not present it as the actual Offer price or Sale Price.",
    "- Separate confirmed offering terms from assumed or estimated values. Confirmed values may be stated directly only when the filing states them as actual offering terms.",
    "- If a price, proceeds amount, valuation, or offering size is assumed, estimated, or used for fee calculation, every title, quick_take, summary, snapshot, score_reason, and display row that uses that value must label it as assumed, estimated, or fee-calculation basis. Do not present it as final.",
    "- Event title must use only confirmed terms. If proceeds, offering size, valuation, or price are estimated from an assumed price, do not include that dollar amount or price in event_title.",
    "- If using an assumed or estimated value would make investor-facing text look like final terms, omit the number from title, quick_take, and summary. Show it only as a clearly labeled estimate or fee-calculation note.",
    "- In quick_take and summary, mention estimated proceeds from an assumed price only when the same sentence clearly says estimated, assuming the stated price, and final price/proceeds are pending. Otherwise omit the estimated proceeds amount.",
    "- A confirmed share count can be shown even when price and proceeds are still pending.",
    "- If only the fee table changes in an S-1/A or F-1/A, classify it as a fee-table or administrative update, not an offering terms update, and do not infer new dilution or new proceeds.",
    "- If a fee table changes together with prospectus-body changes, classify by the actual body changes: shares offered, price range or fixed price, security classes, selling-holder table, underwriters, use of proceeds, purchase agreement, ELOC, SEPA, warrant, convertible, preferred, lock-up, or listing terms.",
    "",
    "S-1/F-1 scoring guide:",
    "- Apply the SEC offering and resale scoring guide first for resale overhang, primary issuance dilution, dollar offering size, sale-readiness, restrictions, and market-cap modifiers.",
    "- Apply the S-1/F-1-specific modifiers below only after that guide. Do not create separate resale percentage bands inside this prompt.",
    ...SEC_RESALE_OVERHANG_SCORING_GUIDE,
    "- Initial S-1/F-1 IPO registration with no final price or share count: usually 35-55.",
    "- IPO S-1/A or F-1/A with concrete price range, share count, underwriters, ADS ratio, or listing timing but no final pricing or first trade: usually 50-70.",
    "- Do not use the IPO amendment 50-70 band for non-IPO resale, ELOC, SEPA, PIPE, registered-direct, or primary-offering amendments. Score those by the active offering, resale, or financing facts in this filing.",
    "- For primary_offering or registered_direct, when the prospectus cover, body, offering table, purchase agreement, placement agreement, or transaction terms source-back new shares or share-equivalent securities, score by new shares divided by the selected share-count basis using the same percentage bands as resale overhang.",
    "- If fixed offering price, sale price, gross proceeds, or net proceeds are supported only by fee-table or assumed values, do not treat the filing as final priced terms and do not score 75+ from those values alone.",
    "- Fee-table-only S-1/A or F-1/A amendments are archive-level, usually 10-35. Fee-calculation price, share count, or amount alone cannot support feed or alert scoring.",
    "- Routine S-1/A or F-1/A amendments that only add/update administrative material are archive-level, usually 10-35.",
    "- Final IPO pricing, first trading imminent, pricing outside filed range, postponement, withdrawal, or major repricing: 75+ possible.",
    "- Mixed primary/resale/warrant/convertible registration: score the highest source-backed investor impact without double-counting the same shares.",
    "- SPAC IPO registration alone is usually feed or archive; de-SPAC transaction-status facts should be scored by the disclosed transaction-status change, not by IPO-registration rules.",
    "- Rule 462(b) MEF: score only the added shares/amount, not the full parent registration. Additional capacity only = usually archive/feed unless very large or final pricing is active.",
    "- POS AM: routine deregistration of unsold securities, no-additional-securities updates, financial-statement updates, consent, exhibit, fee-table, or housekeeping amendments are archive-level, usually 10-35.",
    "- Routine POS AM financial/update filings with no additional securities must use event_type other, signal neutral, and score below 50 unless this filing changes concrete offering economics.",
    "- Do not classify routine POS AM deregistration as listing_risk or bearish merely because a registration is being terminated or unsold securities are removed.",
    "- POS AM can be feed only when this filing changes active offering/resale terms, securities amount, price, effectiveness, company proceeds, resale pool, or another current investor-relevant term.",
    "- Do not score 75+ merely because the form is important or because a registration statement exists. Use 75+ only when the scoring guide and S-1/F-1 modifier both support alert-level impact.",
    "",
    "Display payload contract:",
    "- For primary_ticker and tickers, use filing_package.primary_ticker/tickers exactly when provided. Do not copy filing body text, source excerpts, company descriptions, or CIK text into ticker fields.",
    "- Return display_payload yourself. Do not copy parser-built UI drafts.",
    "- display_payload.display_type must be one of: generic, offering_terms, candidate_special, spac_transaction_status.",
    "- Use offering_terms for IPO registrations, IPO amendments, routine amendments, resale registrations, mixed registrations, Rule 462(b) MEF, POS AM with securities terms, or any source-backed offering/dilution terms.",
    "- Use generic only when the source blocks are too weak for a structured offering UI.",
    "- Use spac_transaction_status only for source-backed de-SPAC transaction-status facts, not plain SPAC IPO registration.",
    "- display_payload.display_version must be s1-f1-display-v1.",
    "- display_payload.data.display_mode must be one of:",
    S1F1_DISPLAY_MODES.map((mode) => `  - ${mode}`).join("\n"),
    "- display_payload.data must be intentionally filled when display_type is offering_terms. Do not leave it as an empty object.",
    "- Choose exactly one primary display_payload.data.display_mode before writing investor-facing text.",
    "- The selected display_mode is the only detailed output path. Do not write a second generic analysis page for the same filing.",
    "- Visible UI contract: for display_type=offering_terms, the primary filing detail UI reads display_payload.data fields such as snapshot_metrics, offering_details, investor_takeaway, narrative_summary, current_shares, total_potential_supply, estimated_dilution_percent, supply_segments, amendment_changes, and watch_next when the selected template supports them.",
    "- Stored-only evidence contract: display_payload.evidence, display_payload.notes, and source_notes are evidence/debug/source-trace fields, not a substitute for primary visible UI rows.",
    "- Do not place investor-critical terms only in display_payload.evidence, display_payload.notes, or source_notes. If a term materially changes how investors should read the filing, put it in a visible display_payload.data field supported by the selected display_mode.",
    "- For display_type=offering_terms, analysis_output.quick_take must match display_payload.data.investor_takeaway in meaning.",
    "- For display_type=offering_terms, analysis_output.summary must match display_payload.data.narrative_summary in meaning.",
    "- For display_type=offering_terms, bullish_points and bearish_points are compatibility fields only. Leave both empty unless the selected display_mode explicitly needs a visible Positive/Negative section.",
    "- Do not create Key Evidence or What To Watch Next as an alternate generic page when the selected display_mode already has snapshot_metrics, offering_details, amendment_changes, or source_notes. Keep them short and consistent with the selected display_mode.",
    "- Secondary modules such as offering_details, amendment_changes, source_notes, and what_to_watch_next may appear only as children of the selected display_mode. They must not imply a second top-level UI mode.",
    "- For IPO display modes, include display_payload.data.ipo_kind as traditional or spac. For non-IPO display modes, omit ipo_kind.",
    "- Ticker fields must contain only short ticker symbols from filing_package, never source text, old ticker strings, exchange descriptions, CIK text, or delisting notes. If filing_package.primary_ticker is present, primary_ticker.ticker must be exactly that ticker.",
    "- Snapshot metrics are the user-facing Dilution/Offering Snapshot cards. Fill up to 4 rows as { label, value, note, tone, emphasis }.",
    "- Offering details are user-facing detail rows. Fill rows as { label, value, note } using the label candidates for the selected display mode.",
    "- Snapshot card values must be short, scan-first, and source-backed. Keep value under 55 characters when possible. Put longer explanation in narrative_summary, key_evidence, or offering_details.",
    "- Snapshot note should be short and plain, under 12 words when possible. Do not put full legal names, page references, or long clauses in snapshot notes.",
    "- Offering Details must use compact row values: no legalese fragments, no paragraph-like values, and no filler. Keep each value under 90 characters when possible.",
    "- Offering Details notes must be 80 characters or fewer. Omit the note instead of writing a long explanation.",
    "- Offering Details should usually have 3-5 rows. For resale_registration, do not output more than 5 offering_details rows.",
    "- Snapshot and Offering Details have different jobs. Snapshot metrics are the scan-first numbers or status. Offering Details are separate contract terms, mechanics, dates, parties, instruments, proceeds use, restrictions, or amendment details.",
    "- Do not use Offering Details as a second copy of Snapshot. If a fact is already clear in snapshot_metrics, omit it from offering_details unless the row adds materially different source-backed context.",
    "- Do not repeat total registered shares, overhang percentage, current shares, or supply component share counts in Offering Details. Put those values in snapshot_metrics, current_shares, total_potential_supply, estimated_dilution_percent, and supply_segments.",
    "- For SEPA, ELOC, PIPE, warrant, convertible, preferred, or recapitalization resale registrations, component share counts belong in supply_segments. Offering Details should carry contract mechanics such as source instrument, agreement date, resale method, sale price or formula, purchase limit, proceeds use, fee, restriction, or registration obligation.",
    "- Preserve the exact share-class or security basis used for share counts. If the filing basis is Class A common stock outstanding, ordinary shares outstanding, ADSs, public float, or non-affiliate shares, use that basis consistently in event_title, snapshot notes, current_shares.evidence, narrative_summary, and supply segment labels. Do not shorten a class-specific basis to generic outstanding shares when multiple share classes, ADS/ordinary structures, or class-specific tables exist.",
    "- For share-overhang bars and supply_segments, label each component by the share exposure being counted, not by the financing instrument principal. Use labels such as Registered conversion shares, Warrant shares, Resale shares, Registered plan shares, Class A shares outstanding, ordinary shares, or ADSs when the counted amount is shares or shares issuable from an instrument.",
    "- Use Convertible notes, Convertible debentures, or Preferred stock as supply segment labels only when the row is showing the instrument or principal itself. When the counted amount is common shares issuable upon conversion, use Registered conversion shares or Conversion shares, and put Convertible Debentures, notes, or preferred stock in Source Instrument or Instrument Details.",
    "- For supply_segments.label, use a standard short label when it fits, but do not force the filing into a fixed enum. If the filing uses a specific class, series, ADS/ordinary-share basis, or instrument-linked share exposure, create a short source-backed label such as Class B conversion shares, Series A preferred conversion shares, Registered conversion shares, Warrant shares, ADSs, or Ordinary shares.",
    "- Do not imply that conversion, exercise, issuance, or resale has already occurred unless the filing states it has occurred. For registered underlying shares, use language such as issuable upon conversion, issuable upon exercise, underlying warrants, or registered for resale. Avoid completed-event phrasing such as following conversion or after exercise unless source-backed.",
    "- In event_title and investor_takeaway, if an overhang percentage uses a class-specific, ADS-specific, ordinary-share, public-float, or non-affiliate-share basis, either name that basis or omit the percentage. Do not write a generic phrase such as outstanding shares when the basis is narrower or different.",
    "- Keep separate legal or contractual limits in separate rows when source-backed. Do not merge Exchange Cap, ownership limit, six-month/tranche cap, floor price, reset formula, and conversion price into one row.",
    "- Do not write placeholder money strings such as $ million, $ per share, or $ and $ in any display_payload field. Use pending wording instead.",
    "- For resale_registration or mixed_offering, if total registered/offered resale shares can be identified, include a snapshot row labeled Overhang vs outstanding when a source-backed share-count basis is available.",
    "- If you write an overhang, dilution, or outstanding-share percentage in snapshot_metrics, also fill current_shares, total_potential_supply, estimated_dilution_percent, and supply_segments using the same source-backed share counts.",
    "- For current_shares, total_potential_supply, estimated_dilution_percent, and supply_segments shares, numeric_value must be a bare JSON number when the value is disclosed or calculated. Do not put the number only inside value_text.",
    "- Absolute share-count rule for resale/mixed registrations: if the filing source blocks state filing-date shares outstanding, use that value for current_shares and the overhang calculation.",
    "- If filing-date shares outstanding is not stated but filing-date non-affiliate shares or public float is stated, use that filing value for current_shares and clearly name the basis in the Overhang vs outstanding note.",
    "- Use latest market_context shares_outstanding only when the filing source blocks do not state shares outstanding, non-affiliate shares, or public float.",
    "- Use latest market_context public_float only when none of the filing source blocks or market_context shares_outstanding provide a source-backed share-count basis.",
    "- Once a filing source share-count basis is available, market_context is not an alternate basis. Do not compare, average, replace, or adjust the filing value with market_context.",
    "- If the filing gives a row such as shares outstanding before/prior to commencement, execution, purchase agreement, offering, or resale, use that row as current_shares for the relevant registration ratio.",
    "- Do not split-adjust, reverse-split-adjust, or market-adjust a filing share-count basis yourself. Use the number as stated unless the same filing explicitly gives a separate adjusted count for the same ratio.",
    "- Reverse split, later market data, or market_context may explain why current trading data differs, but they must not replace or modify a filing source share-count basis for the filing's own resale/overhang percentage.",
    "- A row labeled common stock outstanding, Class A common stock outstanding, shares outstanding prior to commencement, or shares outstanding before a purchase agreement is a filing source share-count basis. Use it as stated.",
    "- If the share-count basis comes from market_context, state that basis in evidence or the Overhang vs outstanding note.",
    "- If current_shares and total_potential_supply are numeric, estimated_dilution_percent must equal total_potential_supply divided by current_shares times 100, and the Overhang vs outstanding snapshot row must use the same percentage.",
    "- If no source-backed share-count basis is available, do not invent an overhang percentage. Use snapshot text to explain that the ratio is not fixed instead of forcing a calculation.",
    "- Do not return empty objects inside snapshot_metrics, offering_details, amendment_changes, or source_notes.",
    "- Keep snapshot value text short. Use null for unavailable non-snapshot fields; do not write Not disclosed as filler.",
    "",
    "Display mode rules:",
    "routine_amendment:",
    "- Use for S-1/A or F-1/A amendments where the current amendment only adds, updates, or corrects administrative material.",
    "- Routine amendment examples include legal opinions, auditor consents, exhibit updates, signature pages, fee-table corrections, incorporated document updates, financial-statement updates, and amendments stating the prospectus or offering terms are unchanged.",
    "- For routine or partial administrative amendments, classify and score by what the amendment changes, not by repeated registration statement content.",
    "- Do not apply this routine-amendment rule to full updated prospectus amendments that contain current offering, resale, IPO, or financing terms.",
    "- Do not treat repeated IPO, resale, SEPA, warrant, convertible, or offering terms as a new investor event when the amendment only supports an exhibit, consent, opinion, fee update, or unchanged prospectus.",
    "- A fee-table-only amendment is routine even when the fee table contains share counts, proposed maximum offering prices, or Rule 457 calculations. Do not turn those fee-table values into offering price, sale price, company proceeds, or dilution terms.",
    "- Use event_type other, signal neutral, score 10-35, and archive-level treatment unless the current amendment changes concrete investor-facing terms.",
    "- Concrete investor-facing changes include registered shares, price, proceeds, selling holders, underwriters, conversion or exercise terms, effectiveness, lock-up, listing timing, or use of proceeds.",
    "- For routine_amendment, snapshot_metrics and offering_details must be empty arrays unless the current filing changes a concrete investor-facing term.",
    "- investor_takeaway and narrative_summary should state the amendment purpose and, when source-backed, that the prospectus or offering terms are unchanged.",
    "- What changed labels may include Legal opinion, Expert consents, Exhibits, Fee table, Financial statements, Signature pages, Prospectus unchanged.",
    "",
    "ipo_registration:",
    "- Use for initial IPO/F-1/S-1 registration before final pricing.",
    "- Initial IPO filings usually do not yet disclose price, share count, valuation, lock-up expiry, final underwriters, or first trade date. Do not fill the UI with Not disclosed rows for those missing final terms.",
    "- If an initial IPO filing contains blank placeholders such as '$ and $', '$ per share', '$ million', empty share counts, or bracketed blanks, do not repeat those placeholders anywhere in analysis_output or display_payload. Say price range, share count, or proceeds are pending instead.",
    "- Never output literal placeholder phrases like between $ and $, $ per share, approximately $ million, or amount pending from a blank fee table. Treat them as missing terms.",
    "- Do not use assumed public offering price, proposed maximum offering price, fee-table share count, or registration-fee amount as IPO price, IPO proceeds, valuation, offering size, or final terms.",
    "- Snapshot labels for initial IPO filings must be exactly these four rows in this order: Filing stage; Terms status; Proposed exchange / ticker; Underwriters.",
    "- For Terms status, use short values such as Price and share count pending or Range filed; do not copy blank price-table placeholders.",
    "- For initial IPO filings, display_payload.data.investor_takeaway should match analysis_output.quick_take in meaning and may use the same wording.",
    "- For initial IPO filings, display_payload.data.narrative_summary should match analysis_output.summary in meaning and may use the same wording.",
    "- For initial IPO filings, company_story should explain what the company does, its business model, and the IPO status in plain investor language. Do not make it a legal filing recap.",
    "- For Underwriters, use a concise source-backed lead underwriter/bookrunner value when named. If the initial filing has not named underwriters yet, use Pending.",
    "- For initial IPO filings, offering_details may be an empty array. Do not create Investor Checks or filler detail rows.",
    "- Do not include market data rows for initial IPO filings. Pre-listing S-1/F-1 filings should not show current market cap, float, price, or share-count context as if it existed when the filing was made.",
    "- Keep Initial IPO Filing output focused on what is known now and what filing comes next. Final IPO pricing data belongs in a final-pricing or final-prospectus output, not the initial S-1 screen.",
    "",
    "ipo_amendment:",
    "- Use for S-1/A or F-1/A updating IPO terms.",
    "- Use this mode when the current amendment discloses concrete IPO terms such as shares or ADSs offered, price range, underwriters, exchange/ticker, ADS ratio, primary/secondary mix, underwriter option, directed-share program, lock-up, or control/voting structure.",
    "- Do not use ipo_amendment when the only apparent change is a filing fee table, Rule 457 calculation, estimated fee price, exhibit, consent, or signature update.",
    "- Treat an IPO price or offering size as concrete only when the prospectus cover, body, offering table, underwriting section, or use-of-proceeds section states it as an actual IPO term. Fee-table-only values are not concrete IPO terms.",
    "- Snapshot labels for IPO terms updates must be exactly these four rows in this order: Shares offered; Price range; Offering size; Exchange / ticker.",
    "- If offering size is not directly stated, calculate a short range only when shares offered and price range are clear. Otherwise use Pending.",
    "- Offering Details labels: Lead underwriters, Underwriter option, Primary / secondary mix, Use of proceeds, Lock-up, Control / voting structure, Foreign issuer / VIE structure, Listing condition, Directed share program, ADS ratio, Selling shareholders.",
    "- Do not repeat snapshot terms in Offering Details. Exchange/ticker, shares offered, price range, and offering size belong in snapshot_metrics only.",
    "- If snapshot_metrics Shares offered already includes underwriter-option or greenshoe shares, omit Underwriter option from Offering Details.",
    "- Keep Offering Details compact. Use only rows that are source-backed and useful to investors; omit obvious or filler rows.",
    "- parent_filing_context is optional for IPO terms updates. Use it only to identify real changes, not to decide the current UI.",
    "- What changed labels: Price range, Shares offered, ADS ratio, Underwriters, Use of proceeds, Lock-up, Risk factors, Prospectus date, Financials updated.",
    "- Only write What Changed from confirmed parent_filing_context or explicit current-filing amendment language. Do not invent a change just because the form is S-1/A or F-1/A.",
    "",
    "resale_registration:",
    "- Use for selling stockholder resale registrations.",
    "- If resale shares are known, snapshot_metrics must contain exactly these four rows in this order: Resale shares; Overhang vs outstanding; Company proceeds; Selling holders.",
    "- Do not replace Overhang vs outstanding with Market price, Current share price, Registered value, or any price-only row.",
    "- Do not omit Overhang vs outstanding when total_potential_supply is numeric and a source-backed share-count basis is available under the priority rule.",
    "- Offering details labels: Offering Type, Selling Holders, Agreement Date, Resale Method, Sale Price, Source Instrument, Purchase Limit, Exchange Cap, Ownership Limit, Six-month Cap, Conversion Price, Floor Price, Reset / Repricing, Sales to Date, Approx. Placement Price, Use of Proceeds, Registration Obligation.",
    "- For resale_registration Overhang vs outstanding, value must be the bare percentage only, such as 85.4%. Put the share-count basis in note.",
    "- For resale_registration Company proceeds, never use None. Use No proceeds to company when resale proceeds go to selling holders. Use Nominal warrant cash only or Future facility sales only when source-backed.",
    "- For resale_registration Selling holders, use compact source-backed holder groups. If holder names are long or there are multiple holders, use concise source-backed group names such as CHS / Nexus / STORY3 affiliates. Use '+ others' only when the filing lists additional holders not shown in the value.",
    "- For resale_registration, total_potential_supply is the full registered resale pool. supply_segments should explain the components inside that pool and must not repeat the total pool as a separate segment.",
    "- Do not put the total registered resale pool or supply segment component counts in Offering Details. Use Offering Details for mechanics and contracts only.",
    "- For resale_registration Offering Details, use at most 5 rows. Prioritize restrictions and mechanics over repeated identity rows. Output is invalid if resale_registration offering_details has more than 5 rows.",
    "- For instrument-linked resale registrations, if row budget is tight, prioritize Source Instrument, Conversion Price, Exchange Cap, Ownership Limit, Six-month Cap, Floor Price, Reset / Repricing, and Purchase Limit over generic Agreement Date or Resale Method rows.",
    "- For the Selling holders snapshot row, put the compact holder group in value and keep note null or very short. Do not repeat full legal names in the note.",
    "- For Selling Holders, do not write generic values like Identified Selling Stockholders when names are disclosed.",
    "- Keep Selling Holders values under 55 characters when possible.",
    "- If there are 1-2 selling holders, list the names.",
    "- If there are 3 or more selling holders, do not list more than 2 names. Use '{count} named holders: {name1}, {name2} + others'.",
    "- If the exact holder count is not clear, use 'Multiple named holders: {name1}, {name2} + others'.",
    "- When a holder row is needed outside the snapshot because it adds separate context, use the same compact naming style. Do not write full legal-name lists, share counts, or phrases like Entities affiliated with. Use base holder or fund group names plus affiliates, for example CHS / Nexus / STORY3 affiliates.",
    "- Never paste a selling-stockholder table, full legal-name list, or per-holder share-count list into Selling holders or Selling Holders UI rows.",
    "- Strip generic legal wrappers from holder names in display rows: write Nexus affiliates, STORY3 affiliates, or Baker Bros. affiliates instead of Entities affiliated with Nexus Capital Management or entities affiliated with Baker Bros.",
    "- Do not put per-holder share counts inside Selling Holders values. Put those share counts in supply_segments, key_evidence, or source_notes instead.",
    "- Resale Registration Offering Details values should be row labels, not prose: Offering Type = ELOC resale, PIPE resale, or private-placement resale when useful; Selling Holders = compact holder groups; Resale Method = Market or negotiated sales; Source Instrument = ELOC purchase agreement, PIPE shares, Warrant shares, Convertible note shares, or prior private placement terms; Purchase Limit = maximum dollar cap or ownership cap when source-backed; Exchange Cap = Nasdaq/NYSE 19.99% cap, shareholder-approval cap, or similar issuance limit when source-backed; Sales to Date = shares sold and cash received to date when source-backed; Registration Obligation = registration rights agreement or required by registration rights.",
    "- For ordinary resale registrations, use Resale Method for market-price, negotiated-price, broker, dealer, or plan-of-distribution sale mechanics. Use Sale Price only for a source-backed fixed price or equity-line/ELOC purchase price formula for shares sold by the company to a purchaser.",
    "- For resale registrations, never use a fee-table proposed maximum offering price, Rule 457 price, assumed public offering price, average high/low price, or registration-fee value as Sale Price, Approx. Placement Price, Company proceeds, or a chart marker.",
    "- For ELOC/equity line resale registrations, use Purchase Limit for the maximum company sale capacity or cap, Exchange Cap for an exchange-rule issuance limit or shareholder-approval condition, and Sales to Date for any already sold shares or cash received. Do not invent labels such as Company Sales to Keystone, Sales to Purchaser to date, Company Sales to Purchaser, or ELOC Proceeds.",
    "- For ELOC/equity line resale registrations with a source-backed Exchange Cap, Offering Details should use exactly these 5 rows when available: Offering Type, Source Instrument, Purchase Limit, Exchange Cap, Use of Proceeds.",
    "- For ELOC/equity line resale registrations, omit Agreement Date, Resale Method, Selling Holders, and Registration Obligation when the display already has Offering Type, Source Instrument, Purchase Limit, Exchange Cap, and Use of Proceeds.",
    "- Do not confuse an Exchange Cap with the registered resale pool or current_shares basis. The Exchange Cap is a near-term issuance restriction; the overhang calculation should still use the full registered resale pool and the best source-backed outstanding-share count.",
    "- For convertible, warrant, preferred, ELOC, SEPA, or other instrument-linked resale registrations, show Exchange Cap, Ownership Limit, Six-month Cap, Conversion Price, Floor Price, Reset / Repricing, or Purchase Limit as separate Offering Details rows when they are source-backed and material.",
    "- Use Use of Proceeds only for how company cash from primary/ELOC/warrant sales will be used. Do not use it for resale proceeds going to selling holders.",
    "- For resale shares issued in a completed private placement, PIPE, recapitalization, or similar prior financing, put the prior financing price and gross proceeds in Source Instrument or Approx. Placement Price when source-backed. Do not label ordinary resale market/negotiated pricing as Sale Price.",
    "- Company proceeds should distinguish no resale proceeds from conditional warrant/conversion cash.",
    "",
    "atm:",
    "- Use for at-the-market programs or equity distribution agreements.",
    "- Snapshot labels must be: Program size; Market cap; Size vs market cap; Sale method.",
    "- ATM is sale capacity over time, not completed issuance. Do not describe the full capacity as already sold.",
    "- Offering Details labels: Offering Type, Sales Agent, Fee / Commission, Agreement Date, End Date, Use of Proceeds.",
    "",
    "primary_offering:",
    "- Use for underwritten or public primary offerings where the company sells new shares, ADSs, units, or share-equivalent securities for cash.",
    "- Snapshot labels should be: New shares; Offer price; Company proceeds; Dilution vs current shares.",
    "- New shares may be confirmed even when price and proceeds are not fixed.",
    "- For Offer price, use only an actual fixed public offering price, purchase price, or price range stated in the prospectus cover, body, offering table, underwriting or placement section, or transaction terms.",
    "- If only an assumed price is disclosed, do not use it as Offer price. Use Pending or Not fixed yet, and mention the assumed price only as an assumed or fee-calculation basis when useful.",
    "- For Company proceeds, use actual gross or net proceeds only when the filing states them as fixed transaction terms. If proceeds are estimated from an assumed price, label them as estimated and state that final proceeds depend on actual pricing and closing.",
    "- Summary must not describe estimated proceeds or assumed price as final transaction terms.",
    "- For Dilution vs current shares, use filing-date shares outstanding from the filing whenever it is present. Do not use market_context shares when the filing provides a filing source share-count basis.",
    "- For Dilution vs current shares, calculate total_potential_supply.numeric_value divided by current_shares.numeric_value times 100. Do not use pro forma after-offering shares, as-adjusted shares, market_context shares, or book-value dilution as the current_shares basis for this UI row.",
    "- Offering Details labels: Offering Type, Underwriter, Placement Agent / Underwriter, Closing Date, Agreement Date, Use of Proceeds, Warrant Terms.",
    "",
    "registered_direct:",
    "- Use for registered direct, PIPE-style, or fixed purchaser takedown filings where named or described investors buy securities directly from the company.",
    "- Snapshot labels should be: New shares; Offer price; Company proceeds; Dilution vs current shares.",
    "- New shares may be confirmed even when price and proceeds are not fixed.",
    "- For Offer price, use only actual purchaser price, fixed offering price, or price range from the prospectus body, purchase agreement, placement agreement, use-of-proceeds section, or transaction description.",
    "- If only an assumed price is disclosed, do not use it as Offer price. Use Pending or Not fixed yet, and mention the assumed price only as an assumed or fee-calculation basis when useful.",
    "- For Company proceeds, use actual gross or net proceeds only when the filing states them as fixed transaction terms. If proceeds are estimated from an assumed price, label them as estimated and state that final proceeds depend on actual pricing and closing.",
    "- Summary must not describe estimated proceeds or assumed price as final transaction terms.",
    "- For Dilution vs current shares, calculate total_potential_supply.numeric_value divided by current_shares.numeric_value times 100. Do not use pro forma after-offering shares, as-adjusted shares, market_context shares, or book-value dilution as the current_shares basis for this UI row.",
    "- Offering Details labels: Offering Type, Purchaser / Investor, Placement Agent / Underwriter, Warrant Terms, Closing Date, Agreement Date, Use of Proceeds.",
    "",
    "warrant_convertible:",
    "- Use when the main investor impact is warrants, pre-funded warrants, convertible notes, convertible preferred stock, rights, units, or other equity-linked instruments.",
    "- Snapshot labels should describe Underlying shares, Exercise / conversion price, Company proceeds, and Dilution vs current shares when source-backed.",
    "- If conversion price is variable or no fixed floor is stated, use Variable rather than forcing a share count or percentage.",
    "- Offering Details labels: Offering Type, Purchaser / Investor, Placement Agent / Underwriter, Warrant Terms, Exercise Price, Conversion Price, Reset / Repricing, Floor Price, Closing Date, Agreement Date, Use of Proceeds.",
    "- Put detailed instrument rows in warrant_details/source_notes when source-backed. Do not squeeze several prices or reset terms into one snapshot card.",
    "",
    "rights_offering:",
    "- Use for subscription rights offerings.",
    "- Snapshot labels should be: Rights offered; Subscription price; Record date; Subscription period when source-backed.",
    "- Offering Details labels: Offering Type, Record Date, Subscription Period, Oversubscription, Backstop / Dealer Manager, Use of Proceeds.",
    "",
    "shelf_capacity:",
    "- Use only for shelf capacity by itself: no concrete resale pool, no active sale method, no priced offering, no current takedown, no named selling-holder resale pool, and no fixed warrant/convertible share pool needing investor attention.",
    "- Snapshot labels should be: Shelf capacity; Market cap; Capacity vs market cap; Sale status.",
    "- Shelf capacity is future capacity, not immediate dilution or immediate company cash.",
    "- Offering Details labels: Offering Type, Shelf Status, Securities Covered, Active Sale Terms, Next Required Filing, Use of Proceeds.",
    "",
    "mixed_offering:",
    "- Use when primary issuance, resale, warrants, convertibles, rights, units, ATM, ELOC, shelf, or other components are independently material and no single component dominates.",
    "- Do not use mixed_offering just because one financing package has both notes and warrants; use warrant_convertible when equity-linked instruments are the main event.",
    "- Snapshot labels should summarize the main components, not every security line: Primary component, Resale component, Warrant/convertible component, Main risk.",
    "- Offering Details labels: Offering Type, Component Summary, Purchaser / Investor, Selling Holders, Placement Agent / Underwriter, Source Instrument, Warrant Terms, Use of Proceeds.",
    "- Do not double-count the same shares across primary issuance, resale, warrants, convertibles, rights, units, or shelf tables.",
    "",
    "spac_ipo:",
    "- Use for blank-check/SPAC IPO registration, not de-SPAC status.",
    "- Snapshot labels: Units offered, Unit price, Trust amount, Warrant / right terms.",
    "- Offering details labels: Sponsor, Trust Account, Redemption Terms, Unit Components, Proposed Exchange.",
    "",
    "rule_462b_mef:",
    "- Use for S-1MEF/F-1MEF or Rule 462(b) additional registration.",
    "- Parent context is optional. Treat the current MEF filing as the primary source. If parent_filing_context is supplied, use it only as supporting context.",
    "- Analyze the incremental registration only. Do not describe the full parent IPO/F-1/S-1 as newly registered unless the current MEF filing itself adds that amount.",
    "- Snapshot labels must be exactly these four rows when source-backed: Additional shares / ADS; Total registered pool; Additional offering value; Rule 462(b) limit.",
    "- If parent context is missing, still analyze the MEF using Additional shares / ADS, Additional offering value, Rule 462(b) limit, and Prior registration statement when source-backed by the current filing.",
    "- Additional shares / ADS is the new MEF add-on amount. Total registered pool is the combined or parent-plus-additional pool only when explicitly stated in the MEF or clearly source-backed by parent context.",
    "- If the filing states only a dollar value or only a share/ADS count, fill the matching row and omit unsupported rows rather than guessing.",
    "- Offering Details labels: Prior registration statement, Rule 462(b) status, Securities added, Base offering, Fee table.",
    "- What changed labels: Additional registration, Prior registration statement, Added shares / amount, Fee table.",
    "- investor_takeaway should state this is an add-on registration under Rule 462(b), not a new standalone offering.",
    "",
    "post_effective_amendment:",
    "- Use for POS AM or post-effective amendments tied to S-1/F-1 registration.",
    "- For routine financial/update POS AM with no additional securities registered, snapshot_metrics must be an empty array. Put the useful explanation in narrative_summary instead of repeating the title/form badge.",
    "- For routine financial/update POS AM, offering_details and amendment_changes must also be empty arrays unless the current filing changes a concrete investor-facing registration term.",
    "- If the current POS AM says no additional securities are being registered, do not copy prior offering shares into Securities affected. Treat the affected securities as no additional securities.",
    "- Do not infer that an IPO is moving forward, advancing, or more likely to complete merely because a POS AM updates financial statements or keeps an effective registration current.",
    "- Do not use ipo_listing for routine POS AM unless the current filing newly changes IPO price, shares, underwriters, effectiveness, listing timing, or other concrete IPO terms.",
    "- Use snapshot rows only when they add concrete non-duplicative status or economic information. Snapshot labels may be: Amendment type; Securities affected; Registration status; New sale / proceeds.",
    "- For routine deregistration, say unsold securities are deregistered/removed and company proceeds are none or no new proceeds if source-backed.",
    "- Do not use Company proceeds as a POS AM snapshot label. Use New sale / proceeds only if the filing changes investor sale activity or company cash from securities sales.",
    "- Do not mention filing fees in New sale / proceeds, narrative_summary, or investor_takeaway unless the filing changes investor proceeds or company cash from securities sales.",
    "- Do not force IPO, resale, or listing-risk framing when the POS AM only deregisters unsold securities or updates administrative material.",
    "- What changed labels: Deregistered securities, Unsold securities removed, Prospectus date, Expert consents, Legal opinion, Filing status.",
    "",
    "generic:",
    "- Use only when the source is too weak for a structured registration UI. Still provide concise analysis_output.",
    "",
    "Required Output JSON shape:",
    JSON.stringify(
      {
        parser_output: {
          parserVersion: parserOutput.parserVersion,
          parserGroup: parserOutput.parserGroup,
          formType: parserOutput.formType,
          accessionNumber: parserOutput.accessionNumber,
          isSupported: parserOutput.isSupported,
          facts: {},
          signals: [],
          calendarItems: [],
          warnings: [],
          raw: {},
        },
        analysis_output: {
          source_group: "filings",
          market_scope: "company",
          event_type: "approved event_type selected from cleaned source blocks",
          event_title: "string",
          primary_ticker: { ticker: "string | null", exchange: "string | null" },
          tickers: [],
          sector: null,
          industry_group: null,
          theme_group: null,
          sub_theme: null,
          score: 0,
          score_reason: "string",
          signal: "bullish | bearish | volatile | neutral",
          quick_take: "string",
          summary: "string",
          why_it_matters: "string",
          bullish_points: [],
          bearish_points: [],
          key_evidence: [],
          what_to_watch_next: [],
          related_tickers: [],
          calendar_items: [],
          confidence: "high | medium | low",
          needs_human_review: false,
        },
        display_payload: {
          display_type: "generic | offering_terms | candidate_special | spac_transaction_status",
          display_version: "s1-f1-display-v1",
          data: {
            display_mode: "one supported S-1/F-1 display mode",
            risk_label: "low | moderate | elevated | high | severe | null",
            current_shares: {
              value_text: "source-backed outstanding shares used as current_shares, or null",
              numeric_value: "number or null",
              unit: "shares",
              evidence: "short source evidence or null",
            },
            total_potential_supply: {
              value_text: "source-backed registered/offered/resale shares used as the numerator, or null",
              numeric_value: "number or null",
              unit: "shares",
              evidence: "short source evidence or null",
            },
            estimated_dilution_percent: {
              value_text: "source-backed or calculated percent using current_shares and total_potential_supply, or null",
              numeric_value: "number or null",
              unit: "percent",
              evidence: "short calculation basis or null",
            },
            supply_segments: [
              {
                role: "new_shares | potential_warrants | potential_instruments | total_potential_supply",
                label: "short segment label",
                shares: {
                  value_text: "segment shares or null",
                  numeric_value: "number or null",
                  unit: "shares",
                  evidence: "short source evidence or null",
                },
                price: {
                  value_text: "source-backed price or null",
                  numeric_value: "number or null",
                  unit: "usd_per_share | percent | null",
                  evidence: "short source evidence or null",
                },
              },
            ],
            snapshot_metrics: [
              {
                label: "one candidate label for the selected display mode",
                value: "short source-backed value",
                note: "short explanation or null",
                tone: "neutral | bullish | bearish | volatile | null",
                emphasis: false,
              },
            ],
            investor_takeaway: "one short sentence or null",
            narrative_summary: "2-4 sentences, under 100 words, or null",
            offering_details: [
              {
                label: "one offering detail label for the selected display mode",
                value: "source-backed value",
                note: "short explanation or null",
              },
            ],
            amendment_changes: [],
            source_notes: [],
            needs_human_review: false,
            review_reasons: [],
          },
          evidence: [],
          notes: [],
        },
      },
      null,
      2,
    ),
    "",
    "Cleaned source input:",
    JSON.stringify(buildS1F1LlmSourceInput(parserOutput), null, 2),
    "",
    `Prompt version: ${S1F1_PROMPT_VERSION}`,
  ].join("\n");
}

export function validateS1F1RequiredOutputShape(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["Expected a JSON object."];
  const root = value as Partial<S1F1RequiredOutputJson> & Record<string, unknown>;

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in root)) errors.push(`Missing top-level key: ${key}`);
  }

  const analysis = root.analysis_output as Record<string, unknown> | undefined;
  if (!analysis || typeof analysis !== "object") {
    errors.push("analysis_output must be an object.");
  } else {
    for (const key of REQUIRED_ANALYSIS_KEYS) {
      if (!(key in analysis)) errors.push(`Missing analysis_output key: ${key}`);
    }
    if (analysis.source_group !== "filings") errors.push("analysis_output.source_group must be filings.");
    if (typeof analysis.event_type !== "string" || !isApprovedSecEventType(analysis.event_type)) {
      errors.push("analysis_output.event_type must be one of the approved SEC event types.");
    }
    if (typeof analysis.score !== "number") {
      errors.push("analysis_output.score must be a number.");
    }
    if ("delivery_level" in analysis) {
      errors.push("analysis_output must not include delivery_level; it is derived from score.");
    }
  }

  const parser = root.parser_output as Record<string, unknown> | undefined;
  const parserFacts = parser?.facts as Record<string, unknown> | undefined;
  if (!parser || typeof parser !== "object") {
    errors.push("parser_output must be an object.");
  } else {
    if (parser.parserGroup !== "s1-f1") errors.push("parser_output.parserGroup must be s1-f1.");
    if (parser.formType !== "S-1 / F-1, S-1/A / F-1/A") {
      errors.push("parser_output.formType must use the exact room scope label.");
    }
  }

  if (analysis && parserFacts && typeof parserFacts === "object") {
    const parserTicker = typeof parserFacts.ticker === "string" ? parserFacts.ticker.trim().toUpperCase() : "";
    const parserExchange = typeof parserFacts.exchange === "string" ? parserFacts.exchange.trim() : "";
    const primaryTicker = analysis.primary_ticker as Record<string, unknown> | undefined;
    const analysisTicker =
      typeof primaryTicker?.ticker === "string" ? primaryTicker.ticker.trim().toUpperCase() : "";
    const analysisExchange =
      typeof primaryTicker?.exchange === "string" ? primaryTicker.exchange.trim() : "";

    if (parserTicker && analysisTicker !== parserTicker) {
      errors.push("analysis_output.primary_ticker.ticker must match parser_output.facts.ticker.");
    }
    if (parserExchange && analysisExchange !== parserExchange) {
      errors.push("analysis_output.primary_ticker.exchange must match parser_output.facts.exchange.");
    }
    if (parserTicker && Array.isArray(analysis.tickers)) {
      const tickers = analysis.tickers.map((ticker) => String(ticker).trim().toUpperCase());
      if (!tickers.includes(parserTicker)) {
        errors.push("analysis_output.tickers must include parser_output.facts.ticker.");
      }
    }
  }

  const display = root.display_payload as Record<string, unknown> | undefined;
  if (!display || typeof display !== "object") {
    errors.push("display_payload must be an object.");
  } else {
    if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(String(display.display_type))) {
      errors.push("display_payload.display_type must be generic, offering_terms, candidate_special, or spac_transaction_status.");
    }
    if ("display_version" in display && typeof display.display_version !== "string") {
      errors.push("display_payload.display_version must be a string when present.");
    }
    const data = display.data as Record<string, unknown> | undefined;
    if (display.display_type === "offering_terms") {
      if (!data || typeof data !== "object" || !Object.keys(data).length) {
        errors.push("display_payload.data must be filled for offering_terms.");
      } else if (!S1F1_DISPLAY_MODES.includes(String(data.display_mode) as (typeof S1F1_DISPLAY_MODES)[number])) {
        errors.push(`display_payload.data.display_mode must be one of: ${S1F1_DISPLAY_MODES.join(", ")}.`);
      }
    }
  }

  return errors;
}
