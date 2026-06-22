import {
  secFilingAnalysisResponseSchema,
  type SecFilingAnalysisInput,
} from "@/lib/prompts/secFilingAnalysis";
import { sec424bRequiredOutputSchema } from "@/lib/ai/sec424bAnalysisAdapter";
import { buildSecSourceBlockPromptInput } from "@/lib/sources/sec/forms/common/sourceBlockPromptInput";

export const SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY = "sec_s3_offering_analysis";
export const SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION = "v13";

export const SEC_S3_ANALYSIS_ACTION_VALUES = ["skip_analysis", "routine_archive", "analyze_offering"] as const;
export const SEC_S3_CASE_VALUES = [
  "base_shelf",
  "automatic_shelf",
  "resale_registration",
  "atm_program",
  "mixed_shelf",
  "dividend_reinvestment_plan",
  "amendment",
  "other_s3",
] as const;

export const SEC_OFFERING_DISPLAY_MODE_VALUES = [
  "share_overhang",
  "atm_capacity",
  "shelf_capacity",
  "priced_offering",
  "convertible_warrant_financing",
  "amendment_change",
  "unknown",
] as const;

export const SEC_OFFERING_DISPLAY_RISK_VALUES = ["severe", "high", "elevated", "moderate", "low", "unknown"] as const;

export const SEC_OFFERING_DISPLAY_UNIT_VALUES = [
  "shares",
  "usd",
  "usd_per_share",
  "percent",
  "text",
  "date",
] as const;

export const SEC_OFFERING_DISPLAY_MEANING_VALUES = [
  "current_shares_outstanding",
  "registered_resale_supply",
  "primary_offering_supply",
  "atm_capacity",
  "shelf_capacity",
  "conversion_shares",
  "warrant_shares",
  "note_principal",
  "offering_amount",
  "conversion_price",
  "warrant_exercise_price",
  "issuer_cash_proceeds",
  "resale_proceeds_to_company",
  "private_placement_proceeds",
  "prefunded_warrant_exercise_cash",
  "common_warrant_cash_exercise",
  "sec_registration_value",
  "future_or_excluded_overhang",
  "watch_trigger",
  "not_disclosed",
  "not_applicable",
  "unknown",
] as const;

export const SEC_OFFERING_DISPLAY_RELATIONSHIP_VALUES = [
  "base_denominator",
  "total_potential_supply",
  "included_in_total_supply",
  "outside_current_registered_pool",
  "company_receives_cash",
  "company_receives_no_cash",
  "conditional_cash_if_exercised",
  "nominal_cash_if_exercised",
  "fee_calculation_only",
  "context_only",
  "not_applicable",
  "unknown",
] as const;

export const SEC_OFFERING_DISPLAY_INSTRUMENT_VALUES = [
  "common_stock",
  "ordinary_shares",
  "ads",
  "convertible_notes",
  "convertible_preferred",
  "warrants",
  "pre_funded_warrants",
  "units",
  "atm_program",
  "shelf_registration",
  "resale_registration",
  "mixed",
  "other",
  "unknown",
] as const;

export const SEC_OFFERING_DISPLAY_CONFIDENCE_VALUES = ["high", "medium", "low", "unknown"] as const;

const secOfferingDisplayFactSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "value_text", "numeric_value", "unit", "meaning", "relationship", "evidence", "confidence"],
  properties: {
    label: { type: "string" },
    value_text: { type: ["string", "null"] },
    numeric_value: { type: ["number", "null"] },
    unit: { type: ["string", "null"], enum: [...SEC_OFFERING_DISPLAY_UNIT_VALUES, null] },
    meaning: { type: "string", enum: SEC_OFFERING_DISPLAY_MEANING_VALUES },
    relationship: { type: "string", enum: SEC_OFFERING_DISPLAY_RELATIONSHIP_VALUES },
    evidence: { type: ["string", "null"] },
    confidence: { type: "string", enum: SEC_OFFERING_DISPLAY_CONFIDENCE_VALUES },
  },
} as const;

const secOfferingDisplaySegmentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "label",
    "instrument_type",
    "shares",
    "amount",
    "price",
    "relationship_to_total_supply",
    "timing_or_condition",
    "evidence",
    "confidence",
  ],
  properties: {
    label: { type: "string" },
    instrument_type: { type: "string", enum: SEC_OFFERING_DISPLAY_INSTRUMENT_VALUES },
    shares: secOfferingDisplayFactSchema,
    amount: secOfferingDisplayFactSchema,
    price: secOfferingDisplayFactSchema,
    relationship_to_total_supply: { type: "string", enum: SEC_OFFERING_DISPLAY_RELATIONSHIP_VALUES },
    timing_or_condition: { type: ["string", "null"] },
    evidence: { type: ["string", "null"] },
    confidence: { type: "string", enum: SEC_OFFERING_DISPLAY_CONFIDENCE_VALUES },
  },
} as const;

export const secOfferingDisplayModelSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "display_mode",
    "risk_label",
    "headline",
    "narrative_summary",
    "current_shares",
    "total_potential_supply",
    "supply_segments",
    "future_or_excluded_overhang",
    "key_cash_terms",
    "watch_items",
    "source_notes",
    "needs_human_review",
    "review_reasons",
  ],
  properties: {
    display_mode: { type: "string", enum: SEC_OFFERING_DISPLAY_MODE_VALUES },
    risk_label: { type: "string", enum: SEC_OFFERING_DISPLAY_RISK_VALUES },
    headline: { type: "string" },
    narrative_summary: { type: "string" },
    current_shares: secOfferingDisplayFactSchema,
    total_potential_supply: secOfferingDisplayFactSchema,
    supply_segments: { type: "array", items: secOfferingDisplaySegmentSchema },
    future_or_excluded_overhang: { type: "array", items: secOfferingDisplaySegmentSchema },
    key_cash_terms: {
      type: "object",
      additionalProperties: false,
      required: [
        "resale_proceeds_to_company",
        "issuer_primary_or_closing_cash",
        "conditional_warrant_cash",
        "prefunded_warrant_exercise_cash",
        "common_warrant_cash_exercise_proceeds",
        "private_placement_proceeds",
        "sec_registration_value",
        "explanation",
      ],
      properties: {
        resale_proceeds_to_company: secOfferingDisplayFactSchema,
        issuer_primary_or_closing_cash: secOfferingDisplayFactSchema,
        conditional_warrant_cash: secOfferingDisplayFactSchema,
        prefunded_warrant_exercise_cash: secOfferingDisplayFactSchema,
        common_warrant_cash_exercise_proceeds: secOfferingDisplayFactSchema,
        private_placement_proceeds: secOfferingDisplayFactSchema,
        sec_registration_value: secOfferingDisplayFactSchema,
        explanation: { type: "string" },
      },
    },
    watch_items: { type: "array", items: { type: "string" } },
    source_notes: { type: "array", items: { type: "string" } },
    needs_human_review: { type: "boolean" },
    review_reasons: { type: "array", items: { type: "string" } },
  },
} as const;

export const secS3OfferingAnalysisSystemPrompt = [
  "Analyze one SEC S-3 family filing package and return only strict JSON matching the provided response schema.",
  "This prompt is only for S-3, S-3ASR, and S-3/A filings. Do not perform broad SEC event routing here.",
  "Use the filing excerpt, important sections, and important tables as the source of truth.",
  "Treat filing_package.parser_candidates as unverified hints only. Parser candidates may be wrong, stale, or mixed across sections; ignore any candidate not supported by the source text.",
  "Use router_evidence.s3.component_candidates as source-backed candidate evidence, not final truth. These candidates are extracted from S-3 text, selling-stockholder footnotes, and table fragments to make complex instrument components visible.",
  "You may select and aggregate already-normalized component_candidates when building offering_display_model.supply_segments; this is allowed evidence selection, not raw financial calculation.",
  "If component_candidates.totals provides convertible_notes_shares and warrant_shares that reconcile to total_potential_supply, use those values for separate Convertible Notes and Warrants supply segments unless source evidence contradicts them.",
  "If component candidates conflict, do not reconcile, or mix included shares with future/excluded shares, keep only source-backed values, set needs_human_review true, and explain the uncertainty.",
  "If filing_package.offering_security_audit is present, treat it as the numeric contract for share stack, proceeds stack, toxic terms, and sanity checks. Do not override audit numbers unless direct filing evidence in the prompt contradicts them.",
  "If filing_package.s3_amendment_triage is present, it means the S-3/A amendment passed lightweight triage and needs offering audit/analysis. Focus on the changed or unresolved amendment terms identified there.",
  "Build offering_display_model from offering_security_audit first, then use component_candidates and source excerpts only to fill gaps or explain uncertainty.",
  "If offering_security_audit has unresolved_conflicts, needs_human_review, or false sanity checks, carry that uncertainty into offering_display_model.needs_human_review and review_reasons.",
  "Use filing_package.market_context and filing_package.dilution_metrics for score calibration when those code-supplied fields are available.",
  "Treat dilution_metrics as preliminary code context, not source evidence. Do not use preliminary percent or multiple values as display facts unless the source text supports the underlying inputs.",
  "The parser extracts candidate facts only. You decide whether the S-3 family filing should be skipped, archived, or analyzed as an offering/dilution event.",
  "Choose analysis_action skip_analysis for routine S-3/A maintenance where no event should be created: exhibit-only, consent-only, signature-only, unchanged-remainder amendments, or amendments with no changed economics, resale holders, fee table economics, distribution plan, ATM, warrant, convertible, or offering terms.",
  "Choose analysis_action routine_archive only for low-priority non-shelf maintenance that is still worth a stored event record.",
  "Choose analysis_action analyze_offering when the filing shows any shelf registration, automatic shelf, ATM program, resale registration, selling stockholder overhang, mixed shelf, concrete offering amount, offering terms, warrants, convertibles, fee table economics, or a material S-3/A change.",
  "If an S-3/A filing is not important enough for a stored archive event, choose skip_analysis instead of routine_archive.",
  "Base shelf, universal shelf, and automatic shelf filings should normally be feed-level analyze_offering events, not archive-only events.",
  "For analyze_offering, set event_type to dilution_risk unless the evidence clearly supports only other. S-3 family filings should almost never be earnings, FDA, leadership, legal, or product events.",
  "Choose s3_case by economic structure, not only by SEC form label. If an S-3ASR contains a concrete selling-stockholder resale pool, use s3_case resale_registration rather than automatic_shelf.",
  "Use s3_case automatic_shelf for S-3ASR base shelf or universal shelf filings only when there is no concrete resale pool, ATM, takedown, warrant/convertible pool, or other current sale mechanics.",
  "Separate shelf context from the current actionable mechanism. A base shelf can be the registration framework while the current filing is still an ATM program, resale registration, takedown, or mixed financing event.",
  "If the package contains a stated ATM program amount, at-the-market sales agreement, sales-agent language, or sale-from-time-to-time language under an equity distribution agreement, use s3_case atm_program even if the same package also references a broader shelf registration or automatic shelf.",
  "If the package only creates shelf capacity and does not include a concrete ATM, resale pool, takedown supplement, priced terms, warrant/convertible pool, or sales agreement, use base_shelf or automatic_shelf according to the form/context.",
  "Use mixed_shelf only when the current filing has multiple active offering mechanisms or security structures that should be evaluated together, such as primary plus resale, common plus warrants/pre-funded warrants, or ATM plus resale. Do not use mixed_shelf merely because a shelf registration provides background for one concrete mechanism.",
  "For shelf-plus-ATM filings, describe shelf capacity as context and ATM capacity as the actionable dilution mechanism. Do not call the event automatic_shelf just because the base registration is automatic.",
  "Use structure-first offering classification. Do not introduce public_offering, underwritten_public_offering, or common_stock_public_offering as canonical offering_type values. Treat public offering language as sale method/context, not dilution structure.",
  "For a plain common-stock public offering, the DB-facing canonical offering_type should be other. For a public offering with units, warrants, pre-funded warrants, convertibles, or multiple securities, use mixed or convertible_financing as appropriate. For base shelf or automatic shelf, use shelf_registration. For shelf takedown with concrete terms, classify by the actual securities/structure and preserve shelf takedown as method/context.",
  "If convertible notes or convertible securities are sold in a private placement, classify the structure as convertible_financing and preserve private placement only as sale-method context.",
  "For simple base shelf or automatic shelf with no current sale terms, score 50-59 for large issuers and 55-65 for small or micro issuers by default.",
  "Small or micro issuer shelf registrations can reach alert-level scoring when shelf capacity is large versus market cap or explicitly registered shares are large versus current shares/float. Treat this as financing overhang and sentiment pressure, not confirmed immediate dilution.",
  "Without concrete takedown, ATM, pricing, closing, or sales-agent terms, do not use urgent 90+ scoring for shelf capacity alone.",
  "For a base shelf or automatic shelf, distinguish registered share amount from dollar capacity. Example: a 100,000,000-share shelf with dollar capacity of $183,376,179.78 has both a share registration amount and a dollar capacity; do not collapse those into one value.",
  "For shelf registrations, do not describe dollar capacity as current company proceeds. Shelf capacity is possible future issuance capacity; issuer cash is received only if securities are later sold in a takedown, ATM sale, or prospectus supplement.",
  "For resale shelf, start at 60 and move to 75+ when registered supply is at least 20% of current shares or public float; move to 90+ when it is at least 50%.",
  "For ATM, mixed shelf, 424B/prospectus supplement, registered direct, or concrete offering terms, score 60-74 for feed-level dilution or overhang, 75-89 when share/float impact is at least 20% or offering amount is at least 25% of market cap, and 90-100 only for urgent near-term dilution pressure at about 50%+ impact.",
  "For skip_analysis, set event_type other, signal neutral, score below 20, calendar_items empty, and archive_summary to a one-sentence internal skip reason.",
  "For routine_archive, set event_type other, signal neutral, score below 50, calendar_items empty unless there is an explicit investor-relevant deadline, and archive_summary to one sentence ending with: Open the original filing for full details if needed.",
  "For routine_archive, summary should match the archive_summary substance and should not imply fresh dilution pressure.",
  "For S-3/A, focus on what changed in the amendment. Use parent_registration_context only as background; do not repeat the parent filing as if it were newly filed.",
  "Do not invent offering prices, closing dates, share counts, selling holders, warrant terms, or dilution percentages.",
  "Do not calculate dilution percent, multiples, or discount to market. Code/UI handles those calculations after selecting source-backed facts.",
  "Do not calculate new share counts from principal amount divided by conversion price, or warrant cash from warrant shares times strike price, unless that exact count or cash amount is already provided by source text or component_candidates.",
  "Do not write calculated percentages or multiples in event_title, quick_take, summary, why_it_matters, bullish_points, bearish_points, key_evidence, or offering_display_model text. Prefer raw share counts; UI/code will render percent and multiple.",
  "Do not describe a no-proceeds resale as bullish. Resale proceeds going to selling holders are not issuer cash.",
  "If a financing has both company cash proceeds and resale registration, separate issuer cash from selling-holder resale proceeds.",
  "Do not collapse cash terms into one company proceeds value. Separate resale proceeds to company, primary/placement closing cash, ATM/shelf capacity, pre-funded warrant exercise cash, common warrant cash exercise proceeds, convertible principal, and SEC registration value.",
  "For mixed deals, key_cash_terms must explain who receives each amount and when: received now, received only if securities are sold, received only if warrants are exercised for cash, received by selling holders, or used only for SEC fee calculation.",
  "Pre-funded warrant exercise cash is usually nominal and should not be mixed with common warrant cash exercise proceeds. Pre-funded warrants matter primarily as near-immediate share exposure.",
  "Common warrant cash exercise proceeds are conditional company cash only if holders exercise for cash. Do not treat them as current proceeds.",
  "SEC fee-table maximum aggregate offering price, total offering amount, or registration value is not company proceeds, not selling-holder proceeds, and not shelf capacity unless the prospectus cover separately states it as shelf capacity. Put it in key_cash_terms.sec_registration_value or source_notes, not issuer_primary_or_closing_cash.",
  "If warrants or convertibles are part of the registered supply, describe which instruments make up the supply. If future warrants, shelf capacity, or additional securities are outside the current registered pool, put them outside the current supply.",
  "When dilution_metrics.preliminary_score_floor is present, do not score below that floor unless the source terms are clearly stale, routine, or not currently actionable.",
  "When dilution_metrics.preliminary_score_cap is present, do not score above that cap unless the current filing has concrete sale terms, resale overhang, warrant/convertible pressure, or another explicit near-term trigger.",
  "Use calendar_items only for explicit offering closing dates, registration effective dates, warrant redemption or expiration deadlines, lockup expirations, rights deadlines, or financing-related shareholder approval deadlines.",
  "Use calendar_event_type registration_effective_date for SEC registration effectiveness tied to this offering or resale registration. Do not use policy_effective_date for SEC registration effectiveness.",
  "Use calendar_event_type shareholder_approval_deadline only when shareholder approval is a financing, warrant, convertible, exchange-limit, or dilution trigger.",
  "Do not add calendar_items for from-time-to-time sale language, intended use of proceeds, expected deployment, ordinary legal boilerplate, or vague future plans.",
  "For primary_ticker, prefer the issuer's U.S.-listed common stock or ADR from the filing package. Do not use warrants, units, rights, or non-common classes as primary unless no common/ADR ticker exists.",
  "Keep output short: event_title under 90 characters; quick_take one sentence under 22 words; summary 1-3 sentences under 65 words total; why_it_matters one sentence under 35 words.",
  "Keep score_reason under 18 words.",
  "Keep bullish_points, bearish_points, key_evidence, and what_to_watch_next to at most 3 items each, and each item under 16 words.",
  "Use compact phrases, not full article-style paragraphs.",
  "For offering_display_model, set null unless analysis_action is analyze_offering and the filing contains concrete dilution/offering mechanics.",
  "For offering_display_model, write narrative_summary as a user-facing explanation of the deal structure, not a list of raw fields. Complex dilution/offering deals may need detail; keep it under 260 words.",
  "The generic summary length limits do not apply to offering_display_model.narrative_summary.",
  "The dilution/offering narrative is not a filing recap. It must explain investor impact.",
  "Do not merely restate the disclosed terms. For each important fact, connect fact -> mechanism -> market risk.",
  "Explain why the structure matters for shareholders: how much potential supply can enter the market relative to current shares; whether the shares are resale shares, newly issued shares, conversion shares, or warrant shares; whether holders have economic incentive to sell, convert, or exercise; whether the company receives cash, receives no resale proceeds, or receives only conditional warrant cash; what timing trigger could make the overhang actionable; and what remains uncertain or needs follow-up confirmation.",
  "narrative_summary must be self-contained investor analysis. Do not write UI/meta phrases such as share overhang view uses, chart shows, shown above, shown below, this view, or this page.",
  "Do not end narrative_summary with imperative fragments such as Confirm holders, Confirm timing, or Review source. If a fact remains uncertain, explain it as an unresolved risk or follow-up variable in a complete sentence.",
  "Do not repeat the same current-shares and potential-supply arithmetic in a separate final sentence unless it adds a new mechanism or timing implication.",
  "If the registered pool is large versus current shares, explicitly say that the risk is not just dilution but potential selling pressure and repricing risk from a much larger tradable supply base.",
  "Treat company receives no proceeds from resale as a cash-flow limitation, not as a bullish point. It means selling pressure can occur without new cash coming to the issuer, except for separately disclosed warrant cash exercise proceeds.",
  "For complex deals, explain relationships between instruments instead of listing fields. Clearly distinguish the current registered resale pool, convertible-note shares inside that pool, warrant shares inside that pool, and future or additional overhang outside that pool.",
  "The narrative should answer: Why should an investor care now?",
  "For offering_display_model.headline and narrative_summary, do not include calculated percentages or multiples such as 521%, 498%, or ~5.0x. Use share counts and instrument relationships only.",
  "For offering_display_model.current_shares and total_potential_supply, extract share counts only. Do not use market cap, public float, authorized shares, principal amount, or shelf dollar capacity as share counts.",
  "Authorized capital stock, authorized shares, charter share capacity, and generic Description of Capital Stock numbers are not potential supply. Do not use them in total_potential_supply or supply_segments.",
  "If a shelf filing directly states both a share count and a dollar capacity, set total_potential_supply to the share count with unit shares, and put the dollar capacity in an amount fact such as key_cash_terms.issuer_primary_or_closing_cash or the relevant supply segment amount with unit usd. The amount label should make clear it is shelf capacity, not current proceeds.",
  "If a shelf filing only states dollar capacity and no share count, set total_potential_supply.numeric_value null and unit shares or null; put the dollar capacity in an amount fact with unit usd. Do not invent share-equivalents from the dollar amount.",
  "For offering_display_model.supply_segments, include only instruments that are included in total_potential_supply. Use future_or_excluded_overhang for securities outside the current registered supply. Keep each array to the most important 4 items.",
  "Do not repeat total_potential_supply as a generic Common Stock, Resale Registration, or Registered Resale Shares segment. total_potential_supply already represents the full pool; supply_segments must explain the instrument components inside that pool.",
  "If only part of the registered pool can be broken down by instrument, include the known component segments and explain the unknown or mixed remainder in narrative_summary or source_notes.",
  "Use router_evidence.s3.important_tables.selling_stockholders, including source_components and excluded_shares, to identify conversion-share and warrant-share components. Do not ignore the table just because the prospectus cover has a simpler total share count.",
  "Do not use a generic common stock segment to replace an available instrument breakdown. If the registered supply is made from convertible notes plus warrants, use separate Convertible Notes and Warrants segments.",
  "If the filing states Warrant Shares, warrant exercise shares, or warrants exercisable into common stock inside the registered resale pool, include a Warrants supply segment. Do not omit warrants just because resale proceeds go to selling holders.",
  "If the filing states pre-funded warrant shares or shares underlying pre-funded warrants inside the registered resale pool, include them as near-immediate share exposure inside total_potential_supply and supply_segments, not as excluded future overhang.",
  "If exact warrant share count is not directly available in the prompt input, include the Warrants segment with null shares and set needs_human_review true; do not substitute the total registered pool as the warrant share count.",
  "If warrant shares are inside the current registered pool, their segment relationship_to_total_supply must be included_in_total_supply. Use future_or_excluded_overhang only for additional warrants or securities clearly outside the current registered pool.",
  "Put warrant exercise price in the Warrants segment price field when disclosed, and put conditional cash exercise proceeds in key_cash_terms.conditional_warrant_cash when disclosed.",
  "Before finalizing offering_display_model, compare total_potential_supply against supply_segments. If material warrant or convertible components are disclosed but missing, set needs_human_review true and include the missing component as a segment with null shares rather than omitting it.",
  "For offering_display_model numeric_value, copy/normalize only directly stated numbers. Do not calculate dilution percent, multiples, share conversions, warrant cash, or ratios unless the filing itself states them.",
  "For offering_display_model evidence fields, use short source labels or short excerpts under 18 words.",
  "For offering_display_model watch_items, source_notes, and review_reasons, use at most 3 items each.",
  "watch_items must be complete short follow-up items, not clipped commands. Prefer noun phrases such as Registration effectiveness and resale timing, Selling-holder identities and sale schedule, or Warrant exercise activity.",
  "If the source text is too ambiguous to connect amount, price, and share count, set needs_human_review true and explain the uncertainty.",
  "For resale registrations with pre-funded warrants and ordinary warrants in the same registered pool, total_potential_supply is the Registered Resale Pool. Do not label the whole pool Immediate Share Exposure. Only pre-funded warrant shares are near-immediate exposure; ordinary warrants are conditional future overhang.",
].join("\n");

const secS3RequiredOutputSystemPrompt = [
  "Analyze one SEC S-3/F-3 family filing from source-backed SEC text.",
  "Return JSON only in the Required Output JSON shape: parser_output, analysis_output, display_payload, and optional transaction_fingerprint or filing_context.",
  "There is no S-3 router LLM and no S-3 offering audit in this flow. Choose event_type, score, display_payload.display_type, and display_payload.data.display_mode directly from the source blocks.",
  "Use parser candidates only as optional orientation. Source text, important sections, tables, market_context, and parent context are the authority.",
  "Do not invent offering terms, dates, prices, share counts, ticker symbols, holders, dilution math, or proceeds.",
  "Use display_payload.display_type = offering_terms when the filing contains offering, resale, ATM, shelf, warrant, convertible, rights, or other dilution mechanics suitable for the offering UI.",
  "Use display_payload.display_type = generic only when the filing lacks concrete offering/dilution mechanics or is a routine low-impact filing.",
  "For offering_terms, choose display_payload.data.display_mode from exactly: atm, resale_registration, primary_offering, registered_direct, warrant_convertible, rights_offering, shelf_capacity, mixed_offering, generic.",
  "Map S-3/F-3 cases as follows: ATM sales agreement = atm; selling stockholder resale = resale_registration; universal/base shelf with no active sale terms = shelf_capacity; priced takedown or fixed-price sale = primary_offering or registered_direct; warrants, convertibles, preferred conversion, or equity line resale = warrant_convertible unless resale clearly dominates; two or more independently material components = mixed_offering.",
  "S-3/F-3 filings are often registration capacity, not completed sales. Do not score up merely because a shelf is large or the form is S-3.",
  "Shelf registration without active sale terms usually scores 20-49 unless market context or source text shows a near-term actionable sale.",
  "ATM capacity is future sale capacity, not completed issuance. Score by size versus market cap or filing-date company value when available, but usually cap below alert unless size is extreme or capital need is explicit.",
  "Resale registration is potential selling-holder overhang. The company usually receives no resale proceeds unless the filing states ELOC, purchase agreement, warrant exercise cash, or other company cash.",
  "Primary, registered direct, priced takedown, warrant, convertible, and mixed offerings should use the same investor-facing display structure as 424B offering filings.",
  "For amendments, score what changed in this filing, not the full parent registration. Routine exhibit, fee, signature, or housekeeping amendments usually archive.",
  "Delivery rule: score below 50 = archive; 50-74 = feed; 75+ = alert.",
  "Alert requires source-backed new information likely to affect near-term price, volatility, liquidity, holder economics, or trading decisions. Do not alert from base shelf capacity alone.",
  "Base shelf, universal shelf, and automatic shelf filings with no active sale terms, no pricing, no sales agent, no takedown, and no named resale pool are registration capacity only. Default score 25-45; hard cap 49 unless the filing itself adds an active sale mechanism.",
  "Do not score 75+ merely because shelf capacity is very large versus market cap. A shelf is future capacity until a later prospectus supplement, ATM sale, takedown, resale mechanics, or priced sale appears.",
  "Writing style: plain investor language. Explain what is being registered, whether shares may enter the market, whether the company receives cash, and what remains uncertain.",
  "Summary must be 2-4 sentences, under 100 words total. why_it_matters one sentence under 35 words. Positive and Negative points may be empty if there are no direct points.",
  "For parser_output, preserve the integration contract fields: parserVersion, parserGroup, formType, accessionNumber, isSupported, facts, signals, calendarItems, warnings, raw.",
  "Set parser_output.parserGroup to s3, parser_output.isSupported to true, and parser_output.facts to a compact source-backed object.",
  "For offering_terms display_payload.data, fill the structured UI fields yourself: display_mode, risk_label, current_shares, total_potential_supply, snapshot_metrics, key_cash_terms, registered_security_totals, supply_segments, investor_takeaway, offering_details, warrant_details, narrative_summary, watch_items, source_notes, review_reasons, needs_human_review.",
  "offering_details must use only approved labels. For shelf_capacity use only: Offering Type, Shelf Status, Securities Covered, Active Sale Terms, Next Required Filing, Use of Proceeds.",
  "For atm, primary_offering, registered_direct, rights_offering, and mixed_offering use only: Offering Type, Purchaser / Investor, Placement Agent / Underwriter, Warrant Terms, Closing Date, Agreement Date, Use of Proceeds.",
  "For warrant_convertible use only: Offering Type, Purchaser / Investor, Placement Agent / Underwriter, Warrant Terms, Exercise Price, Conversion Price, Reset / Repricing, Floor Price, Closing Date, Agreement Date, Use of Proceeds.",
  "For resale_registration use only: Offering Type, Selling Holders, Agreement Date, Approx. Placement Price, Resale Method, Sale Price, Floor Price, Warrant Terms, Lock-up / Restrictions, Registration Obligation.",
  "Never create new offering_details labels such as Offering Amount, Securities Offered, Company Proceeds, or Market Cap. Put those values in snapshot_metrics, key_cash_terms, registered_security_totals, total_potential_supply, or narrative_summary when appropriate.",
  "Do not leave source-backed offering amounts, share counts, sale methods, selling holders, agents, agreement dates, use of proceeds, conversion terms, or warrant terms only in prose.",
  "Do not rely on UI fallback. If a value is unavailable, use null in structured fact fields and explain briefly in source_notes or review_reasons.",
].join("\n");

export const secS3OfferingAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["analysis_action", "s3_case", "archive_summary", "offering_display_model", ...secFilingAnalysisResponseSchema.required],
  properties: {
    analysis_action: { type: "string", enum: SEC_S3_ANALYSIS_ACTION_VALUES },
    s3_case: { type: "string", enum: SEC_S3_CASE_VALUES },
    archive_summary: { type: ["string", "null"] },
    offering_display_model: {
      type: ["object", "null"],
      additionalProperties: false,
      required: secOfferingDisplayModelSchema.required,
      properties: secOfferingDisplayModelSchema.properties,
    },
    ...secFilingAnalysisResponseSchema.properties,
  },
} as const;

export function buildSecS3OfferingAnalysisPrompt(input: SecFilingAnalysisInput) {
  return {
    key: SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
    version: SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION,
    system: secS3RequiredOutputSystemPrompt,
    user: JSON.stringify(buildSecS3OfferingPromptInput(input)),
    responseFormat: {
      json_schema: {
        name: "sec_s3_required_output",
        strict: false,
        schema: sec424bRequiredOutputSchema,
      },
    },
  };
}

function buildSecS3OfferingPromptInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const routerEvidence = readRecord(filingPackage.router_evidence) || {};
  const s3Evidence = readRecord(routerEvidence.s3) || {};
  const routerExcerpt = stringValue(s3Evidence.router_excerpt) || trimForPrompt(stringValue(filingPackage.llm_text), 18_000);
  const marketContext = readRecord(filingPackage.market_context);
  const sourceBlocks = buildSecSourceBlockPromptInput({
    filingPackage,
    parserOutput: buildS3ParserPromptOutput(filingPackage, s3Evidence, hardParsers),
    fallbackText: routerExcerpt,
    marketContext,
    parentFilingContext: readRecord(filingPackage.parent_registration_context),
    maxBlocks: 60,
    maxBlockChars: 5_000,
  });

  return {
    ...sourceBlocks,
    filing_package: {
      package_version: filingPackage.package_version || null,
      source_group: filingPackage.source_group || null,
      source_code: filingPackage.source_code || null,
      raw_item_id: filingPackage.raw_item_id || null,
      source_unique_id: filingPackage.source_unique_id || null,
      accession_number: filingPackage.accession_number || null,
      cik: filingPackage.cik || null,
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
      tickers: Array.isArray(filingPackage.tickers) ? filingPackage.tickers : [],
      form_type: filingPackage.form_type || null,
      form_family: filingPackage.form_family || null,
      filed_at: filingPackage.filed_at || null,
      title: filingPackage.title || null,
      filing_detail_url: filingPackage.filing_detail_url || null,
      primary_document_url: filingPackage.primary_document_url || null,
      documents: Array.isArray(filingPackage.documents) ? filingPackage.documents : [],
      parser_candidates: {
        warning:
          "Unverified parser candidates only. Source text, important sections, and tables override these values.",
        s3: readRecord(hardParsers.s3) || null,
        s3_core_terms: readRecord(s3Evidence.core_terms) || null,
        amendment: readRecord(s3Evidence.amendment) || null,
        needs_human_review: typeof s3Evidence.needs_human_review === "boolean" ? s3Evidence.needs_human_review : null,
        review_reasons: Array.isArray(s3Evidence.review_reasons) ? s3Evidence.review_reasons : [],
      },
      router_evidence: {
        s3: {
          evidence_version: s3Evidence.evidence_version || null,
          form_type: s3Evidence.form_type || null,
          accession_number: s3Evidence.accession_number || null,
          document_fetch: s3Evidence.document_fetch || null,
          important_sections: Array.isArray(s3Evidence.important_sections) ? s3Evidence.important_sections : [],
          important_tables: readRecord(s3Evidence.important_tables) || null,
          component_candidates: readRecord(s3Evidence.component_candidates) || null,
          source_documents: Array.isArray(s3Evidence.source_documents) ? s3Evidence.source_documents : [],
          router_excerpt: routerExcerpt,
        },
      },
      parent_registration_context: filingPackage.parent_registration_context || null,
      s3_amendment_triage: readRecord(filingPackage.s3_amendment_triage) || null,
      market_context: marketContext,
      dilution_metrics: filingPackage.dilution_metrics || null,
      llm_text: routerExcerpt,
      package_stats: filingPackage.package_stats || null,
    },
  };
}

function buildS3ParserPromptOutput(
  filingPackage: Record<string, unknown>,
  s3Evidence: Record<string, unknown>,
  hardParsers: Record<string, unknown>,
) {
  const hardS3 = readRecord(hardParsers.s3) || {};
  return {
    parserVersion: stringValue(hardS3.parser_version) || "sec_s3_parser_v1",
    parserGroup: "s3",
    formType: stringValue(filingPackage.form_type || hardS3.form_type) || "S-3",
    accessionNumber: stringValue(filingPackage.accession_number || hardS3.accession_number) || null,
    isSupported: true,
    facts: {
      form_type: filingPackage.form_type || hardS3.form_type || null,
      accession_number: filingPackage.accession_number || hardS3.accession_number || null,
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
    },
    signals: [],
    calendarItems: [],
    warnings: [],
    raw: {
      cleaned_source_blocks: [],
      important_sections: Array.isArray(s3Evidence.important_sections) ? s3Evidence.important_sections : [],
      important_tables: readRecord(s3Evidence.important_tables) || null,
      component_candidates: readRecord(s3Evidence.component_candidates) || null,
      source_documents: Array.isArray(s3Evidence.source_documents) ? s3Evidence.source_documents : [],
      source_excerpt: stringValue(s3Evidence.router_excerpt),
    },
  };
}

function trimForPrompt(value: string, max: number) {
  const normalized = value.replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 12).trim()}\n[TRUNCATED]` : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
