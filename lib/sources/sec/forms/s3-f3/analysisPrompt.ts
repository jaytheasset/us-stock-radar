import { secFilingAnalysisResponseSchema } from "@/lib/prompts/secFilingAnalysis";
import {
  SEC_S3_F3_ROUTER_ACTION_VALUES,
  SEC_S3_F3_ROUTER_DISPLAY_MODEL_VALUES,
  type SecS3F3RouterPromptInput,
} from "./routerPrompt";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";
import { SEC_RESALE_OVERHANG_SCORING_GUIDE } from "../common/resaleOverhangScoring";

export const SEC_S3_F3_ANALYSIS_PROMPT_KEY = "sec_s3_f3_analysis_draft";
export const SEC_S3_F3_ANALYSIS_PROMPT_VERSION = "v7";

export const SEC_S3_F3_ANALYSIS_CASE_VALUES = [
  "base_shelf",
  "automatic_shelf",
  "resale_registration",
  "atm_program",
  "mixed_shelf",
  "universal_shelf",
  "priced_takedown_supplement",
  "warrant_or_convertible_overhang",
  "routine_amendment",
  "material_amendment",
  "other_s3_f3",
] as const;

export type SecS3F3AnalysisPromptInput = SecS3F3RouterPromptInput & {
  router_result: Record<string, unknown>;
  market_context?: Record<string, unknown> | null;
};

export const secS3F3AnalysisSystemPrompt = [
  "Analyze one SEC S-3/F-3 family filing and return only strict JSON matching the provided response schema.",
  "Use cleaned_source_blocks, router result, and market context as evidence. Do not invent offering terms, dates, amounts, tickers, holders, or dilution math.",
  "Do not fill analysis_output ticker metadata. Set primary_ticker to null, tickers to [], and related_tickers to []; the adapter restores package ticker metadata after analysis.",
  "Listing symbols, ADS tickers, warrant tickers, unit tickers, or exchange status belong in visible display_model fields when material, not in analysis_output ticker metadata.",
  "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same S-3/F-3 family.",
  "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  "This family is the offering/dilution baseline. Keep severity comparable to S-3 offering score 80, F-3 offering score 80, 424B5 offering score 80, and S-8 dilution score 80.",
  "Use the common score/action policy: score below 50 action archive; 50-74 action feed; 75 or above action feed_alert.",
  ...SEC_RESALE_OVERHANG_SCORING_GUIDE,
  "Set event_type to dilution_risk for shelf, resale, ATM, warrant, convertible, selling-holder overhang, concrete offering size, source-backed current sale mechanics, or share-supply mechanics unless the filing clearly belongs only to other.",
  "Never treat values from EX-FILING FEES, EX-107, filing fee tables, Rule 457 calculations, Proposed Maximum Offering Price, Maximum Aggregate Offering Price, assumed offering prices, average high/low market prices, or values described as estimated solely for calculating the registration fee as actual sale price, public offering price, investment price, chart price marker, company proceeds, current financing size, or changed economic terms.",
  "Fee-table values may be used only as SEC registration value, registered amount, filing fee basis, or fee-table basis unless the same value is independently stated as an actual offering or sale term in the prospectus body, cover page, underwriting or placement-agent table, use of proceeds, purchase agreement, or other transaction document.",
  "If an S-3/A or F-3/A changes only fee tables, exhibit lists, consents, signatures, incorporated-document lists, or other administrative material, classify it as routine_amendment and archive below 50. Do not infer new dilution, new proceeds, or an offering terms update from fee-table changes alone.",
  "Base shelf or automatic shelf filings without concrete current sale mechanics usually belong in feed-level severity, not alert-level severity.",
  "ATM programs, priced/takedown supplements, large resale pools, warrant coverage, convertible share pools, and concrete offering amounts can justify alert-level severity when market context supports materiality.",
  "For S-3/A and F-3/A, first decide whether the current amendment contains a full updated prospectus/registration statement or only a partial administrative update.",
  "If the current S-3/A or F-3/A contains full current shelf, resale, ATM, takedown, warrant, convertible, or financing terms, analyze the current filing as the authoritative current version. Use parent context only to identify clearly source-backed changes, and do not force What Changed when the current filing stands on its own.",
  "If the current S-3/A or F-3/A is exhibit-only, consent-only, fee-table-only, signature-only, incorporated-document-only, or otherwise lacks current offering terms, classify by what this amendment changes and do not restate parent filing economics as a new event.",
  "Use display_model_type offering_terms when there are offering or dilution mechanics; use generic_filing or none for routine archive outcomes.",
  "Preserve router, market_context, and display_model objects in machine-readable form. Keep user-facing text compact and investor-focused.",
  "For offering_terms display_model, use the approved S-3/F-3 short labels described in this prompt. Keep labels compact and do not paste legal clauses.",
  "For offering_terms share_overhang, use share_overhang.segments as the visible chart row contract. Put the denominator/current outstanding row in segments with supply_nature base_shares.",
  "Do not put explanatory prose in total_note. total_note is only the UI calculation line: short title, numerator, denominator, ratio, and short suffix.",
  "When share_overhang has numeric segments, every visible percentage in status_value, ratio_value, snapshot_metrics, title, quick_take, summary, and total_note must reconcile to the same segment math: numerator is the sum of current_offering_supply, registered_resale_supply, and common_equivalent_supply segments; denominator is the base_shares segment; conditional_future_supply is excluded.",
  "Before final JSON, add every current_offering_supply, registered_resale_supply, and common_equivalent_supply segment numeric_value. Use that full included numerator in supply_value, total_note.numerator, status_value, ratio_value, and any snapshot percentage; never use only the largest segment or only the common_equivalent segment.",
  "Percentage formula: included numerator divided by base_shares denominator, multiplied by 100. If numerator is many times larger than denominator, the percent must be thousands of percent, not hundreds.",
  "When share_overhang has numeric included-supply segments, use the same included numerator divided by base_shares percentage to apply the SEC offering and resale scoring guide. Do not score from a lower or partial component percentage.",
  "Do not write a lower dilution or overhang percentage while a common_equivalent_supply segment is present. If the included numerator or denominator is uncertain, use Variable or Not fixed yet instead of a partial percentage.",
  "supply_nature controls the math: base_shares is the denominator; current_offering_supply, registered_resale_supply, and common_equivalent_supply are included in the large percent and bar; conditional_future_supply and replacement_supply are visible detail rows excluded from the large percent.",
  "Use common_equivalent_supply for source-backed zero-exercise, nominal-exercise, zero-exercise-price option, or otherwise economically share-equivalent exposure. Use common_equivalent_supply for pre-funded securities only when they are standalone supply, not a one-for-one alternative inside the same maximum current offering pool.",
  "Nominal exercise means a de minimis fixed exercise price such as $0.001 or $0.00001. Do not treat reset, floor-price, VWAP, discount, or below-market formulas as nominal merely because the formula may be below the current market price.",
  "Use conditional_future_supply for dependent future supply excluded from the headline numerator, except pre-funded, zero-exercise, nominal-exercise, or economically share-equivalent instruments, which remain common_equivalent_supply even if exercise happens later.",
  "Never set supply_nature conditional_future_supply for a segment whose source-backed economics include a zero-exercise price option, nominal exercise price, pre-funded warrant, or equivalent already-paid share exposure.",
  "A priced warrant, reset warrant, floor-price warrant, or variable-price warrant is conditional_future_supply unless the same instrument has a source-backed zero-exercise, nominal-exercise, pre-funded, or economically equivalent exercise path.",
  "Low Price, Floor Price, reset, VWAP, or discount mechanics by themselves do not make an instrument common_equivalent_supply.",
  "If you show a separate row for a one-for-one replacement security that is already counted in a current_offering_supply row, set supply_nature to replacement_supply, not common_equivalent_supply.",
  "Pre-funded shares/ADSs or pre-funded units sold in lieu of ordinary shares/ADSs are replacement supply, not additive supply. Count the maximum shares/ADSs-or-pre-funded pool once.",
  "If Ordinary Units and Pre-Funded Units are alternatives in the same maximum pool, share_overhang must use one current_offering_supply segment whose label/value names the ordinary-or-pre-funded pool. Do not add a separate Pre-Funded Warrants segment for the same pool.",
  "Never create both a current_offering_supply segment for ordinary shares/ADSs/units and a common_equivalent_supply segment for pre-funded shares/ADSs with the same numeric_value. That is double-counting; use one combined current_offering_supply segment.",
  "If the numerator is Class A, ADSs, or another specific security basis, the base_shares denominator must use the same specific security basis. Do not add Class B, preferred, voting-power, total ordinary-share, or other-class counts to a Class A or ADS denominator.",
  "If alternative securities share the same maximum pool, use one segment for that maximum share/ADS-equivalent pool and name the alternatives in the label or note.",
  "Snapshot and Offering Details have different jobs. Snapshot metrics are the scan-first numbers or status. Offering Details are separate contract terms, mechanics, dates, parties, instruments, proceeds use, restrictions, or amendment details.",
  "Do not use Offering Details as a second copy of Snapshot. If a fact is already clear in snapshot_metrics, omit it from Offering Details unless the row adds materially different source-backed context.",
  "For Use of Proceeds Offering Details rows, list no more than 2 purposes in value. If more than 2 source-backed purposes are disclosed or the value would exceed 90 characters, use '{purpose1}, {purpose2} + others'.",
  "For Use of Proceeds priority, keep the two most specific investor-relevant purposes first, such as acquisition, debt repayment, R&D/clinical trials, capital expenditures, project financing, or commercialization. Push generic purposes such as working capital and general corporate purposes behind '+ others'. Put only one material amount or caveat in note when needed; do not continue the purpose list in note.",
  "When using '+ others' in Use of Proceeds, do not list a third purpose before '+ others'. The value should have at most two comma-separated purposes before '+ others'.",
  "For resale registrations, use Resale Method for market-price, negotiated-price, broker, dealer, or plan-of-distribution sale mechanics. Use Sale Price only for a source-backed fixed price or equity-line/ELOC purchase price formula for shares sold by the company to a purchaser.",
  "For resale shares issued in a completed private placement, PIPE, recapitalization, convertible note, warrant, preferred stock, or similar prior financing, put the source instrument identity and source-backed financing price/proceeds in Source Instrument, Instrument Terms, or Approx. Placement Price. Do not label ordinary resale market/negotiated pricing as Sale Price.",
  "For resale registration Offering Details, prefer these labels when source-backed: Selling Holders, Agreement Date, Resale Method, Sale Price, Source Instrument, Instrument Terms, Approx. Placement Price, Registration Obligation.",
  "For resale registration Company proceeds, never use None. Use No proceeds to company when resale proceeds go to selling holders. Use Nominal warrant cash only or Future facility sales only when source-backed.",
  "For Selling Holders, do not write generic values like Identified Selling Stockholders when names are disclosed. Keep Selling Holders values under 55 characters when possible.",
  "If there are 1-2 selling holders, list the names. If there are 3 or more selling holders, do not list more than 2 names and use '{count} named holders: {name1}, {name2} + others'. If the exact holder count is not clear, use 'Multiple named holders: {name1}, {name2} + others'.",
  "When a holder row is needed outside the snapshot because it adds separate context, use the same compact naming style.",
  "Never paste a selling-stockholder table, full legal-name list, or per-holder share-count list into Selling holders or Selling Holders UI rows.",
  "Do not add calendar_items for base shelf filing dates or vague future sale language. Add them only for exact offering closings, registration effectiveness, warrant deadlines, lock-up expirations, rights deadlines, or financing-related shareholder approval deadlines.",
].join("\n");

export const secS3F3AnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    ...secFilingAnalysisResponseSchema.required,
    "source_form_type",
    "analysis_family",
    "display_model_type",
    "action",
    "s3_f3_case",
    "parser_facts",
    "router",
    "market_context",
    "display_model",
    "debug",
  ],
  properties: {
    ...secFilingAnalysisResponseSchema.properties,
    primary_ticker: {
      type: ["object", "null"],
      additionalProperties: true,
      properties: {
        ticker: { type: ["string", "null"], maxLength: 12 },
        exchange: { type: ["string", "null"], maxLength: 40 },
      },
    },
    tickers: { type: "array", maxItems: 0, items: { type: "object", additionalProperties: true } },
    related_tickers: { type: "array", maxItems: 0, items: { type: "object", additionalProperties: true } },
    source_form_type: { type: "string" },
    analysis_family: { type: "string", enum: ["sec_s3_f3_offering"] },
    display_model_type: { type: "string", enum: SEC_S3_F3_ROUTER_DISPLAY_MODEL_VALUES },
    action: { type: "string", enum: SEC_S3_F3_ROUTER_ACTION_VALUES },
    s3_f3_case: { type: "string", enum: SEC_S3_F3_ANALYSIS_CASE_VALUES },
    parser_facts: { type: "object", additionalProperties: true },
    router: { type: "object", additionalProperties: true },
    market_context: { type: ["object", "null"], additionalProperties: true },
    display_model: { type: ["object", "null"], additionalProperties: true },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version", "analysis_prompt_key", "analysis_prompt_version"],
      properties: {
        parser_version: { type: ["string", "null"] },
        router_prompt_key: { type: ["string", "null"] },
        router_prompt_version: { type: ["string", "null"] },
        analysis_prompt_key: { type: "string" },
        analysis_prompt_version: { type: "string" },
      },
    },
  },
} as const;

export function buildSecS3F3AnalysisPromptDraft(input: SecS3F3AnalysisPromptInput) {
  return {
    key: SEC_S3_F3_ANALYSIS_PROMPT_KEY,
    version: SEC_S3_F3_ANALYSIS_PROMPT_VERSION,
    system: secS3F3AnalysisSystemPrompt,
    user: JSON.stringify({
      ...buildSecSourceBlockPromptInput({
        filingPackage: input.filing_package,
        parserOutput: input.parser_output || { facts: input.parser_facts },
        fallbackText: input.filing_excerpt,
        marketContext: input.market_context,
      }),
      router_result: input.router_result,
      market_context: input.market_context ?? null,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s3_f3_analysis",
        strict: true,
        schema: secS3F3AnalysisResponseSchema,
      },
    },
  };
}
