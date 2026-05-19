import {
  secFilingAnalysisResponseSchema,
  type SecFilingAnalysisInput,
} from "@/lib/prompts/secFilingAnalysis";

export const SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY = "sec_s3_offering_analysis";
export const SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION = "v8";

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
        "explanation",
      ],
      properties: {
        resale_proceeds_to_company: secOfferingDisplayFactSchema,
        issuer_primary_or_closing_cash: secOfferingDisplayFactSchema,
        conditional_warrant_cash: secOfferingDisplayFactSchema,
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
  "Use structure-first offering classification. Do not introduce public_offering, underwritten_public_offering, or common_stock_public_offering as canonical offering_type values. Treat public offering language as sale method/context, not dilution structure.",
  "For a plain common-stock public offering, the DB-facing canonical offering_type should be other. For a public offering with units, warrants, pre-funded warrants, convertibles, or multiple securities, use mixed or convertible_financing as appropriate. For base shelf or automatic shelf, use shelf_registration. For shelf takedown with concrete terms, classify by the actual securities/structure and preserve shelf takedown as method/context.",
  "If convertible notes or convertible securities are sold in a private placement, classify the structure as convertible_financing and preserve private placement only as sale-method context.",
  "For simple base shelf or automatic shelf with no current sale terms, score 50-59 for large issuers and 55-65 for small or micro issuers; do not score 75+ unless there are actual sale terms or large resale/float overhang.",
  "For a base shelf or automatic shelf, distinguish registered share amount from dollar capacity. Example: a 100,000,000-share shelf with dollar capacity of $183,376,179.78 has both a share registration amount and a dollar capacity; do not collapse those into one value.",
  "For shelf registrations, do not describe dollar capacity as current company proceeds. Shelf capacity is possible future issuance capacity; issuer cash is received only if securities are later sold in a takedown, ATM sale, or prospectus supplement.",
  "For resale shelf, start at 60 and move to 75+ when float overhang is 25% or more.",
  "For ATM, mixed shelf, 424B/prospectus supplement, registered direct, or concrete offering terms, score 50-74 for feed-level dilution or overhang, 75-89 for alert-level material dilution pressure, and 90-100 only for urgent near-term dilution pressure.",
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
  "If warrants or convertibles are part of the registered supply, describe which instruments make up the supply. If future warrants, shelf capacity, or additional securities are outside the current registered pool, put them outside the current supply.",
  "When dilution_metrics.preliminary_score_floor is present, do not score below that floor unless the source terms are clearly stale, routine, or not currently actionable.",
  "When dilution_metrics.preliminary_score_cap is present, do not score above that cap unless the current filing has concrete sale terms, resale overhang, warrant/convertible pressure, or another explicit near-term trigger.",
  "Use calendar_items only for explicit offering closing dates, registration effective dates, warrant redemption or expiration deadlines, lockup expirations, or shareholder approval deadlines.",
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
  "If the registered pool is large versus current shares, explicitly say that the risk is not just dilution but potential selling pressure and repricing risk from a much larger tradable supply base.",
  "Treat company receives no proceeds from resale as a cash-flow limitation, not as a bullish point. It means selling pressure can occur without new cash coming to the issuer, except for separately disclosed warrant cash exercise proceeds.",
  "For complex deals, explain relationships between instruments instead of listing fields. Clearly distinguish the current registered resale pool, convertible-note shares inside that pool, warrant shares inside that pool, and future or additional overhang outside that pool.",
  "The narrative should answer: Why should an investor care now?",
  "For offering_display_model.headline and narrative_summary, do not include calculated percentages or multiples such as 521%, 498%, or ~5.0x. Use share counts and instrument relationships only.",
  "For offering_display_model.current_shares and total_potential_supply, extract share counts only. Do not use market cap, public float, authorized shares, principal amount, or shelf dollar capacity as share counts.",
  "If a shelf filing directly states both a share count and a dollar capacity, set total_potential_supply to the share count with unit shares, and put the dollar capacity in an amount fact such as key_cash_terms.issuer_primary_or_closing_cash or the relevant supply segment amount with unit usd. The amount label should make clear it is shelf capacity, not current proceeds.",
  "If a shelf filing only states dollar capacity and no share count, set total_potential_supply.numeric_value null and unit shares or null; put the dollar capacity in an amount fact with unit usd. Do not invent share-equivalents from the dollar amount.",
  "For offering_display_model.supply_segments, include only instruments that are included in total_potential_supply. Use future_or_excluded_overhang for securities outside the current registered supply. Keep each array to the most important 4 items.",
  "Do not repeat total_potential_supply as a generic Common Stock, Resale Registration, or Registered Resale Shares segment. total_potential_supply already represents the full pool; supply_segments must explain the instrument components inside that pool.",
  "If only part of the registered pool can be broken down by instrument, include the known component segments and explain the unknown or mixed remainder in narrative_summary or source_notes.",
  "Use router_evidence.s3.important_tables.selling_stockholders, including source_components and excluded_shares, to identify conversion-share and warrant-share components. Do not ignore the table just because the prospectus cover has a simpler total share count.",
  "Do not use a generic common stock segment to replace an available instrument breakdown. If the registered supply is made from convertible notes plus warrants, use separate Convertible Notes and Warrants segments.",
  "If the filing states Warrant Shares, warrant exercise shares, or warrants exercisable into common stock inside the registered resale pool, include a Warrants supply segment. Do not omit warrants just because resale proceeds go to selling holders.",
  "If exact warrant share count is not directly available in the prompt input, include the Warrants segment with null shares and set needs_human_review true; do not substitute the total registered pool as the warrant share count.",
  "If warrant shares are inside the current registered pool, their segment relationship_to_total_supply must be included_in_total_supply. Use future_or_excluded_overhang only for additional warrants or securities clearly outside the current registered pool.",
  "Put warrant exercise price in the Warrants segment price field when disclosed, and put conditional cash exercise proceeds in key_cash_terms.conditional_warrant_cash when disclosed.",
  "Before finalizing offering_display_model, compare total_potential_supply against supply_segments. If material warrant or convertible components are disclosed but missing, set needs_human_review true and include the missing component as a segment with null shares rather than omitting it.",
  "For offering_display_model numeric_value, copy/normalize only directly stated numbers. Do not calculate dilution percent, multiples, share conversions, warrant cash, or ratios unless the filing itself states them.",
  "For offering_display_model evidence fields, use short source labels or short excerpts under 18 words.",
  "For offering_display_model watch_items, source_notes, and review_reasons, use at most 3 items each.",
  "If the source text is too ambiguous to connect amount, price, and share count, set needs_human_review true and explain the uncertainty.",
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
    system: secS3OfferingAnalysisSystemPrompt,
    user: JSON.stringify(buildSecS3OfferingPromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s3_offering_analysis",
        strict: true,
        schema: secS3OfferingAnalysisResponseSchema,
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

  return {
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
      offering_security_audit: readRecord(filingPackage.offering_security_audit) || null,
      market_context: filingPackage.market_context || null,
      dilution_metrics: filingPackage.dilution_metrics || null,
      llm_text: routerExcerpt,
      package_stats: filingPackage.package_stats || null,
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
