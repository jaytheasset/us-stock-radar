export type SecCorrectionPromptCatalogEntry = {
  roomKey: string;
  displayName: string;
  promptKey: string;
  version: string;
  formGroup: string;
  instructions: string;
};

export const SEC_CORRECTION_PROMPT_CATALOG = [
  entry(
    "ownership",
    "Ownership validation repair",
    "sec_ownership_validation_repair",
    "v1-one-pass-source-backed-patch",
    "Forms 4 / 144",
    `Repair one completed SEC Ownership analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original SEC source excerpt and the existing result as evidence.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.
Preserve event classification, score, signal, display mode, transaction type, amendment status, and all fields not explicitly allowed.
Keep Form 144 proposed-sale language distinct from executed Form 4 transactions.
If the source excerpt does not support a reliable replacement, return the issue as unresolved instead of using parser facts or guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "8k-6k",
    "8-K / 6-K validation repair",
    "sec_8k_6k_validation_repair",
    "v7-key-evidence-18-word-limit",
    "8-K / 6-K current reports",
    `SCORE-RATIONALE-ONLY REPAIR BRANCH
Repair only the validator-identified score rationale fields in an existing SEC 8-K/6-K analysis.
This is one bounded repair pass, not a new analysis. Return JSON patches only and do not change any unlisted path.
The warning is not evidence. Use the supplied original source blocks only to preserve the correct investor consequence and material offset.
Write each replacement as a 12-24 word analyst bottom line explaining the practical scoring principle, not the filing facts or transaction mechanics.
Begin with the investor consequence or economic principle. Never begin with The offering, The financing, The transaction, The company, an issuer name, The score, or This score.
Do not repeat exact share counts, security counts, prices, proceeds, dates, issuer names, or terms already visible in the snapshot and details.
Use at most two controlling drivers and one material offset when it changes the investor reading. Do not mention a score, rating, impact band, or delivery level.
If the sources do not support a replacement, return no patch and list the warning code in unresolved_warning_codes. Every patch must cite a supplied source block.

GENERAL VALIDATION REPAIR BRANCH
Repair only the validator-identified fields in an existing SEC 8-K/6-K analysis.
This is one bounded repair pass, not a new analysis. Return JSON patches only.
The warning identifies a possible problem but is not evidence. Use only the supplied original source blocks as factual authority.
Do not change any path that is not explicitly allowed. Do not rewrite unrelated fields, scores, classifications, titles, or UI structure.
Preserve procedural state exactly: approved, conditionally approved, engaged, effective, dismissed, and completed are not interchangeable.
Preserve financial meaning exactly: counted, conditional, alternative, fixed, variable, current period, prior-year period, and prior-quarter period are not interchangeable.
When repairing a calculation or comparison, keep the existing source-backed units and denominator and change only the validator-identified field.
For operating comparisons, the current and comparison values must use the same metric, unit, and period scope. A quarter, half year, year-to-date period, nine-month period, and full year are not interchangeable.
Use only enum values from the existing analysis schema. In particular, operating_mode must be earnings or operating_update for performance output, and comparison_basis must be yoy, qoq, or other.
For operating_nonfinancial_performance_misclassified_as_earnings, use exactly operating_update for analysis_output.event_type, the primary material event event_type, and display_payload.data.operating_mode; use Operating Snapshot for snapshot_title.
For operating_regulatory_event_type_mismatch, keep product_or_regulatory and the source-backed regulatory_stage unchanged, but use fda_clinical for analysis_output.event_type and the primary material event event_type when regulatory_stage is not not_applicable. Use product_update only when regulatory_stage is not_applicable.
For operating_project_economics_section_missing, create one Project Economics detail section and include every material source-backed project valuation, ownership, reserve/capacity, or long-term unit-economics fact supplied for repair. The warning names the required fact categories: return at least one separate rows item for every named category supported by the supplied blocks, and cite every block used for those rows. Preserve primary operating KPIs in the snapshot and do not duplicate project-economics facts elsewhere.
A /display_payload/data/detail_sections collection patch value must be a JSON array of objects shaped exactly as [{"title":"Project Economics","rows":[{"label":"After-Tax NPV (8%)","value":"$3.6 billion","note":null}]}]. Never use label or summary at the section level. Include a separate rows item for each material source-backed valuation, ownership, reserve/capacity, or unit-economics fact in the supplied repair blocks.
For operating_project_economics_fact_duplication, keep each duplicated project-economics fact only in Project Economics. Remove it from snapshot_metrics, business_catalysts, or another detail section while preserving unrelated primary operating facts.
For operating_secondary_material_event_missing, move any separate governance, capital, legal, or transaction detail section into one compact secondary_updates item. Remove that moved section from detail_sections and preserve only details that directly support the primary operating event.
For operating_snapshot_sign_conflict, restore the source-backed negative sign using parentheses or a leading minus sign without changing the disclosed magnitude, unit, or period.
For operating_earnings_alert_offset_missing, reassess score and signal from the full source-backed earnings mix. A GAAP/IFRS loss driven mainly by non-cash impairment, purchase accounting, tax effects, or another one-time item does not by itself support 75 or above. Keep 75 or above only when adjusted profitability, cash flow, guidance, demand, or another near-term driver also materially deteriorated; otherwise lower the score. When a large headline profit-to-loss inflection remains material but adjusted performance or growth provides a meaningful offset, normally use 65-74 rather than collapsing the event to a routine 40-54 score. State one material offset in each score rationale without repeating the filing recap.
For operating_earnings_alert_noncash_gain_dominant, separate reported accounting income from recurring operating performance. A non-cash fair-value change, warrant-liability remeasurement, tax benefit, asset-sale gain, or another one-time accounting gain does not by itself support a bullish signal or score of 75 or above. Keep that direction and range only when adjusted profitability, cash flow, demand, guidance, or another recurring or near-term driver independently supports it. Otherwise lower the score and use neutral or volatile as appropriate. State the accounting driver in Summary and explain the operating-quality principle in both score rationales.
For amendment_parent_comparison_required or amendment_delta_missing_or_invalid, compare the current amendment blocks with the supplied original filing or prior-amendment source blocks. Classify only the present delta. Use clerical_correction for an identifier, caption, date, name, typographical, formatting, or filing-description correction that leaves economic, legal, operational, voting, listing, and transaction substance unchanged. Use supplemental_update or material_change only for a source-backed new investor-relevant fact or changed term. Never repeat the unchanged parent event as the amendment's new event.
For amendment_clerical_event_overstated, set change_kind to clerical_correction, unchanged_parent_event to true, and changed_fields to the corrected administrative fields. Use event_type other, neutral signal, score below 50, and amendment-only title, quick take, summary, and score rationale.
For structured_snapshot_count_mismatch, return exactly four non-duplicative source-backed snapshot rows. Use four useful status, scope, amount, timing, party, condition, or next-stage facts. Never pad with an immaterial Not disclosed row. routine_archive remains empty.
For risk_listing_suspension_date_misclassified_as_removal, preserve the source-backed date role exactly. A trading suspension date is not a delisting or removal effective date. Rewrite only the flagged fields to describe trading as suspended on that date, and mention a later Form 25 removal without assigning an effective date unless the source explicitly provides one.
For capital_reverse_split_alert_policy, use event_type dilution_risk, a bearish signal, and a score of at least 75. Explain listing, price, or capital pressure and do not describe the proportional share consolidation itself as mechanical dilution.
For capital_severe_dilution_alert_policy, apply the shared active-offering dilution bands to the fixed counted ratio already shown in Share Overhang. A ratio of 100% or more is severe: use dilution_risk, bearish, and a score of at least 84, then explain the supply pressure and any material funding offset without repeating the transaction terms.
For capital_conditional_proceeds_snapshot, distinguish cash expected at closing from additional proceeds available only if warrants or another instrument are exercised. Do not present their sum as closed Gross Proceeds or an unconditional Offering Size. Keep both source-backed amounts in one compact row when needed and state the condition in the note.
For capital_atm_mode_mismatch, capital_atm_capacity_row_count, capital_atm_capacity_unit_mismatch, capital_atm_total_note_unit_mismatch, capital_atm_capacity_role_mismatch, capital_atm_capacity_supply_type_mismatch, capital_atm_capacity_numeric_basis_missing, or capital_atm_capacity_value_mismatch, preserve ATM as the transaction method and recover the source-stated capacity unit. Use shares only with compatible shares outstanding, or usd only with a compatible dollar company-value basis. Never convert between shares and dollars. Keep exactly one ATM row as reference with supply_type atm_capacity, and make its current capacity and basis exactly match total_note numerator and denominator. If the sources do not support one compatible model, leave the warning unresolved; persistence will omit the unsafe share_overhang.
For governance_auditor_icfr_scope_misclassified_as_qualification, separate the financial-statement audit opinion from the scope of the internal-control audit. An auditor statement that it was not engaged to opine on ICFR is not an exception to, or qualification of, the financial-statement opinion.
For key_evidence_count_exceeded or key_evidence_word_limit_exceeded, replace the complete key_evidence array with the strongest two or three non-duplicative source-backed proof points. Preserve compliant items when they remain among the strongest evidence, rewrite every overlong item, and do not simply keep the first three. Each item must be no more than 18 words.
For score_rationale_meta_language, rewrite score_reason and score_explanation.summary as investor-impact conclusions. Do not mention a score, rating, impact band, alert/feed/archive level, or why a number was assigned.
For score_rationale_filing_recap, rewrite only the flagged score rationale fields as a 12-24 word analyst bottom line. Explain the practical scoring principle through immediacy, economic scale, dilution mechanics, financing quality, balance-sheet effect, or another controlling investor consequence. Do not repeat exact share counts, prices, proceeds, dates, transaction mechanics, or facts already visible in the snapshot and details. Use at most two controlling drivers and one material offset when it changes the reading. Begin with the investor consequence or economic principle, such as Immediate equity supply, Large actionable overhang, or Severe liquidity pressure. Never begin with The offering, The financing, The transaction, The company, an issuer name, The score, or This score.
Do not fix an incompatible-period comparison by relabeling a value. Replace the labels, displayed values, numeric values, comparison basis, and change note only when the supplied source blocks contain a complete comparable pair; otherwise leave it unresolved.
For an allowed path ending in _numeric, return the replacement as a plain numeric string without units or thousands separators; the integration converts it to a JSON number.
For an allowed snapshot_metrics, business_catalysts, detail_sections, secondary_updates, or key_evidence collection path, return the complete replacement array as a compact JSON string. Preserve valid existing items, remove only validator-identified duplication, and add only source-backed missing items.
If the supplied source blocks do not establish a correction, return no patch for that warning and list its code in unresolved_warning_codes.
Each patch must cite at least one supplied source block that supports the replacement value.`,
  ),
  entry(
    "s1-f1",
    "S-1 / F-1 validation repair",
    "sec_s1_f1_validation_repair",
    "v2-pending-placeholder-patch",
    "S-1 / F-1 registration statements",
    `Repair one completed SEC S-1/F-1 analysis in one bounded pass.
The validator warning identifies a possible inconsistency but is not evidence.
Use only the selected original source blocks and the existing analysis result as evidence.
Return scalar replacement patches only for the exact allowed paths. Never add, remove, reorder, or rewrite arrays or objects.
Preserve event classification, score, signal, display mode, and all fields that are not explicitly allowed.
Preserve the distinction between counted, conditional, alternative, fixed, pending, and not calculable supply.
For unresolved_visible_placeholder issues, a blank or placeholder source term is evidence that the term is not yet disclosed; replace only the affected scalar with concise pending wording instead of repeating the placeholder.
Use natural phrases such as 'Price range not yet disclosed', 'Share count pending', or 'Final proceeds not yet disclosed', choosing only the term supported by the affected field and source context.
Never infer, calculate, or invent a missing price, share count, proceeds amount, or dilution value while repairing a placeholder.
If the selected source blocks do not support a reliable replacement, leave the issue unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "s3-f3",
    "S-3 / F-3 validation repair",
    "sec_s3_validation_repair",
    "v2-one-pass-source-backed-row-role-patch",
    "S-3 / F-3 registration statements",
    `Repair one completed SEC S-3/F-3 analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original source blocks and the existing result as evidence.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, or rewrite arrays or objects.
Preserve event classification, score, signal, display mode, amendment status, and all fields not explicitly allowed.
Preserve counted, conditional, alternative, reference, fixed, variable, pending, and not-calculable distinctions.
For orphan_prefunded_alternative_pool, the only valid row_role replacement is counted. Never return legacy role names such as current_offering_pool or registered_resale_supply.
If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "s4-f4",
    "S-4 / F-4 validation repair",
    "sec_s4_f4_validation_repair",
    "v1-one-pass-source-backed-patch",
    "S-4 / F-4 transaction statements",
    `Repair one completed SEC S-4/F-4 analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original source blocks and the existing result as evidence.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.
Preserve event classification, score, signal, display mode, transaction subtype, amendment status, and all fields not explicitly allowed.
If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "425",
    "Form 425 validation repair",
    "sec_425_validation_repair",
    "v1",
    "Form 425 transaction communications",
    `Repair one SEC Form 425 analysis after validation and return strict JSON.
Use only the supplied original source blocks as factual authority.
Address only the validator warnings. Preserve unrelated analysis content and do not change event type, score, signal, or delivery.
current_changes must list up to 4 explicit actions, decisions, status changes, changed dates, or changed binding terms announced by this filing, each citing an exact supplied source_block_id.
Collapse one decision and its supporting rationale into one current change. A best-interests conclusion is not separate from the board position it explains.
Snapshot and Summary must collectively state every current change before unchanged transaction background.
When a snapshot warning is present, return exactly 4 useful source-backed snapshot items with event-specific labels. Never use missing-value placeholders or parser-generated fragments.
Return no more than 3 Key Evidence items. Each must cover a different objective decision, changed term, amount, deadline, approval, vote result, or condition.
Map Key Evidence one-to-one to different current_changes items and use at most one evidence sentence per current change.
A rationale or best-interests conclusion for the same board decision is not a separate evidence item. Preserve a distinct competing-offer rejection or other separate current change when supported.
When a duplicate-evidence warning is present, delete the weaker duplicate rather than paraphrasing it. If only two distinct facts exist, return two items.
Exclude slogans, aspirations, expected benefits, and promotional claims from Key Evidence.
Each Key Evidence item must be a complete sentence under 28 words and 180 characters.
This is one repair attempt. Return only the requested JSON object.`,
  ),
  entry(
    "424b",
    "424B validation repair",
    "sec_424b_validation_repair",
    "v1-one-pass-source-backed-patch",
    "424B prospectuses",
    `Repair one completed SEC 424B analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original source blocks and the existing result as evidence.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, or rewrite arrays or objects.
Preserve event classification, score, signal, display mode, offering structure, and all fields not explicitly allowed.
Preserve counted, conditional, alternative, reference, fixed, variable, pending, and not-calculable distinctions.
For orphan_prefunded_alternative_pool, the only valid row_role replacement is counted. The adapter recalculates numerator, ratio, and snapshot values from final counted rows.
For orphan_prefunded_alternative_pool, rewrite every allowed prose field that uses the stale dilution percentage so it matches the corrected counted supply or states the effect qualitatively.
For duplicate_prefunded_replacement_pool, keep the ordinary/common maximum pool counted and mark its one-for-one pre-funded replacement row alternative. Rewrite every allowed stale dilution percentage consistently.
If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "tender",
    "Tender validation repair",
    "sec_tender_validation_repair",
    "v1-one-pass-source-backed-patch",
    "Tender / CB / 13E-3 filings",
    `Repair one completed SEC Tender analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original source blocks and the existing result as evidence.
A filing-stated unaffected price or pre-announcement reference price takes priority over site market context for transaction premium.
Never compare a historical offer price with site market context dated materially after the filing.
If the source blocks support a reliable filing-date reference, recalculate the premium accurately. Otherwise remove unsupported premium or discount wording without inventing a number.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.
Preserve event classification, score, signal, transaction fingerprint, and all fields not explicitly allowed.
If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "proxy",
    "Proxy validation repair",
    "sec_proxy_validation_repair",
    "v1-one-pass-source-backed-patch",
    "Proxy statements",
    `Repair one completed SEC Proxy analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original source blocks and the existing result as evidence.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.
Preserve event classification, score, signal, display mode, proposal order, and all fields not explicitly allowed.
For proposal explanations, use one short beginner-friendly sentence with a clear subject.
For a reverse split, distinguish the issuer's objective from investor consequences. Do not claim improved liquidity when source blocks disclose listing, OTC-liquidity, capital-access, or restructuring risk.
If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "periodic-reports",
    "Periodic Reports validation repair",
    "sec_periodic_reports_validation_repair",
    "v6-quarterly-scope-and-quick-take",
    "10-K / 10-Q / 20-F periodic reports",
    `Repair one completed SEC periodic-report analysis in one bounded pass.
Validator warnings identify possible scoring, earnings-quality, or reporting-period inconsistencies but are not evidence.
Use only the selected original source blocks, site market context, and existing result as evidence.
For reporting-period repairs, treat the resolved report_context fiscal metadata and fiscal_period_resolution as authoritative. Do not restore a raw XBRL fiscal-year focus that the parser rejected as internally inconsistent, and do not infer fiscal quarter from calendar month.
For annual-report repairs, YoY means the current fiscal year versus the immediately preceding fiscal year. Replace non-adjacent annual comparison fields with source-backed adjacent-year values when available.
When annual core performance is missing, use existing performance-comparison and snapshot scalar fields for revenue or sales, GAAP/IFRS net income or loss, operating income or loss, or operating cash flow. Capital-return rows must not displace those metrics.
For annual_consolidated_metric_scope_mismatch, a source_scope=segment_or_subset block cannot support a company-wide total. Remove the unscoped claim from narrative scalars or explicitly label it as a segment/subset metric. Replace an unsupported consolidated comparison with another trusted consolidated core metric when available.
For quantitative_narrative_mismatch, make narrative scalar fields agree with the structured performance or amendment comparison. Prefer the exact rounded percentage change, remove inconsistent multiplier wording, and describe a smaller absolute loss as narrowing rather than increasing.
For amendment_title_materiality_mismatch, rewrite the title around the most investor-relevant material correction supported by changed_metrics and source blocks, not a rounding-level secondary change.
For narrative_length_exceeded, rewrite every listed scalar as complete investor-facing sentences within the stated character limit. Preserve the material facts, never cut a sentence, and never end with an ellipsis or other truncation marker.
Score is investor attention and urgency; signal is direction. Market capitalization changes percentage thresholds, not score points.
Do not treat one-time, non-operating, tax, fair-value, derivative, or non-cash gains as pure operating improvement.
Return scalar replacement patches only for exact allowed paths. Never replace a whole array or object. You may replace an explicitly allowed scalar array item path such as /key_evidence/1.
Preserve all unrelated analysis and UI fields. If evidence is insufficient, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "s8",
    "S-8 validation repair",
    "sec_s8_validation_repair",
    "v1-one-pass-source-backed-patch",
    "S-8 registration statements",
    `Repair one completed SEC S-8 analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original source blocks and the existing result as evidence.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.
Preserve event classification, score, signal, S-8 UI mode, filing subtype, and all fields not explicitly allowed.
If the source blocks do not support a reliable replacement, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "sc13",
    "Schedule 13 validation repair",
    "sec_sc13_validation_repair",
    "v1-one-pass-source-backed-patch",
    "Schedules 13D / 13G",
    `Repair one completed SEC Schedule 13D/13G analysis in one bounded pass.
Validator warnings identify possible inconsistencies but are not evidence.
Use only the selected original SEC source blocks and the existing result as evidence.
Return scalar replacement patches only for exact allowed paths. Never add, remove, reorder, truncate, or rewrite arrays or objects.
Preserve event classification, score, signal, display mode, schedule type, amendment status, ownership percentages, and all fields not explicitly allowed.
Keep passive 13G ownership distinct from active 13D intent and preserve proposed, current, and exited ownership states.
If the selected source blocks do not support a reliable replacement, return the issue as unresolved instead of using parser facts or guessing.
This is the only repair attempt. Return JSON only.`,
  ),
  entry(
    "nt",
    "NT Reports validation repair",
    "sec_nt_validation_repair",
    "v5-key-evidence-array-repair",
    "NT 10-K / 10-Q / 20-F reports",
    `Repair one completed SEC NT filing analysis in one bounded pass.
Validator warnings identify possible classification, scoring, or snapshot inconsistencies but are not evidence.
Use only the selected original Part III/Part IV source blocks and the existing result as evidence.
Classify and score a substantive disclosed results change before treating expected filing within the extension as an offset.
Use earnings for broader profit, loss, or EPS changes. Use sales_performance only when the material change is primarily revenue, sales, orders, or margin.
A substantive results change cannot remain other, routine, or below score 50.
Patch scalar values only at exact allowed paths. Preserve unrelated fields and arrays.
For a key_evidence_count_out_of_range warning, do not patch array indexes. Return the complete replacement in key_evidence_replacement.
key_evidence_replacement must contain exactly 2-3 prioritized, source-faithful analyst paraphrases, each no more than 140 characters.
When there is no key_evidence_count_out_of_range warning, return an empty key_evidence_replacement array.
For a key_evidence_too_long warning, rewrite only the flagged array item as one source-faithful analyst paraphrase of no more than 140 characters. Preserve the material fact and remove legal boilerplate.
For snapshot_reason_too_long, rewrite underlying_issue as a plain-English issue label of no more than 64 characters, without the issuer, form name, or reporting period.
For snapshot_results_too_long, rewrite results_change in no more than 90 characters using the expected current direction and only the most useful source-backed figures. Omit prior-period figures unless needed to understand direction.
If evidence is insufficient, return the issue as unresolved instead of guessing.
This is the only repair attempt. Return JSON only.`,
  ),
] as const satisfies readonly SecCorrectionPromptCatalogEntry[];

export function getSecCorrectionPromptsForRoom(roomKey: string): SecCorrectionPromptCatalogEntry[] {
  return SEC_CORRECTION_PROMPT_CATALOG.filter((entry) => entry.roomKey === roomKey);
}

function entry(
  roomKey: string,
  displayName: string,
  promptKey: string,
  version: string,
  formGroup: string,
  instructions: string,
): SecCorrectionPromptCatalogEntry {
  return { roomKey, displayName, promptKey, version, formGroup, instructions };
}
