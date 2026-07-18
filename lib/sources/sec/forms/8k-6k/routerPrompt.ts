import { buildSec8k6kRouterDigestInput } from "./routerPromptInput";
import { SEC_8K_6K_APPROVED_EVENT_TYPES } from "./types";

export const SEC_8K_6K_ROUTER_PROMPT_KEY = "sec_8k_6k_router_draft";
export const SEC_8K_6K_ROUTER_PROMPT_VERSION = "v14-structured-document-outline";

export const SEC_8K_6K_ROUTER_ACTION_VALUES = ["archive", "feed", "alert"] as const;
export const SEC_8K_6K_ROUTER_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES = ["generic", "offering_terms", "capital_financing", "spac_transaction_status", "candidate_special"] as const;
export const SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES = [
  "sec_8k_6k_generic_v1",
  "sec_8k_6k_offering_terms_v1",
  "sec_8k_6k_capital_financing_v1",
  "sec_8k_6k_spac_transaction_status_v1",
  "sec_8k_6k_candidate_special_v1",
] as const;
export const SEC_8K_6K_ROUTER_CASE_VALUES = [
  "listing_risk",
  "dilution_or_offering",
  "debt_or_credit_financing",
  "ipo_listing",
  "earnings_or_results",
  "sales_or_operating_update",
  "product_or_commercial_update",
  "leadership_or_governance",
  "insider_or_control_update",
  "shareholder_vote",
  "strategic_transaction",
  "financial_distress_or_default",
  "legal_or_regulatory_risk",
  "dividend",
  "capital_return",
  "fda_or_clinical",
  "routine_amendment",
  "material_amendment",
  "other",
] as const;

const sec8k6kRouteCandidateSchema = {
  type: "object",
  additionalProperties: false,
  required: ["route_type", "priority", "confidence", "reason"],
  properties: {
    route_type: {
      type: "string",
      enum: SEC_8K_6K_APPROVED_EVENT_TYPES,
      description: "Candidate event family for downstream analysis. This is not a final event classification.",
    },
    priority: { type: "string", enum: ["primary", "secondary", "context"] },
    confidence: { type: "string", enum: SEC_8K_6K_ROUTER_CONFIDENCE_VALUES },
    reason: {
      type: "string",
      description: "Concise source-backed judgment explaining why this route should receive downstream analysis.",
    },
  },
} as const;

export type Sec8k6kRouterPromptInput = {
  filing_package: Record<string, unknown>;
  parser_output: Record<string, unknown>;
  filing_excerpt?: string | null;
  parent_filing_context?: Record<string, unknown> | null;
  related_filing_contexts?: Array<Record<string, unknown>> | null;
};

export const sec8k6kRouterSystemPrompt = [
  "You are the SEC 8-K / 6-K route planner for Stock Radar. Route one SEC 8-K / 6-K, 8-K/A / 6-K/A filing and return only strict JSON matching the provided schema.",
  "Use source-backed judgment to identify the strongest downstream analysis route, meaningful secondary routes, and whether the filing warrants deeper analysis.",
  "Use only current_filing and router_digest. router_digest contains compact Item summaries, up to two original context snippets centered on material actions, document or exhibit titles and headlines, table headings, amendment state, and source coverage metadata for route classification.",
  "Related filing context, when present in the digest, is compact analysis from an already-analyzed SEC filing that the current source explicitly references. Treat it as supporting routing context, not as authority over the current filing digest.",
  "Do not use full raw SEC text, full attachment text, outside knowledge, live market data, parser-generated labels, parser scores, parser classifications, or investment labels as classification authority.",
  "Item summaries, context_snippets, and document headline summaries are short routing context, not full analysis evidence. Use context_snippets to identify what action, proposal, transaction, approval, or status change the filing actually reports, then choose the analysis family and archive gate.",
  "Missing, PDF, graphic, binary, or truncated text means source coverage may be incomplete; it is not negative news by itself.",
  "For 8-K and 8-K/A, use the digest's Item numbers, titles, brief summaries, exhibit references, document titles or headlines, and table headings, but do not classify by Item number alone.",
  "For 6-K and 6-K/A, do not expect 8-K Item numbers. Use each document's title, subtitle, ordered lead_context, and section_headings to identify the filing subject. These fields preserve the source document's order and outrank isolated later bullets or incidental keyword mentions.",
  "Document-dominance rule: first identify what the document as a whole says it is. An explicit Financial Report, Financial Results, Quarterly Results, Annual Results, or Earnings Release title plus revenue/profit/loss/EPS/cash-flow lead context routes earnings even when a later bullet mentions an acquisition, FDA decision, product, litigation, or executive change. Preserve those later facts as secondary candidates only when they are independently material.",
  "A title or subtitle naming an officer appointment, resignation, FDA decision, offering, merger, listing action, or other event should control only when it describes the document's main announcement. Do not promote a later high-keyword bullet above an earlier document-level title and lead paragraph.",
  "For backward compatibility, return one event_type, route_case, display_type, score, and delivery_level, but treat them as route candidates and archive-gate hints only. They are not final analysis outputs.",
  "Use primary_route_candidate and route_candidates as the source of truth for routing. event_type should match primary_route_candidate.route_type when analysis is needed.",
  "Choose route candidate families from the approved taxonomy: listing_risk, dilution_risk, ipo_listing, earnings, sales_performance, operating_update, product_update, leadership_governance, insider_ownership, shareholder_vote, strategic_transaction, financial_risk, legal_risk, dividends, capital_return, fda_clinical, or other.",
  "Primary-route rule: route by the main new fact visible in the compact digest. Use the document hierarchy: headline, exhibit title, short Item summary, item heading, transaction/resolution/action language, and table heading usually outrank boilerplate, About sections, contacts, forward-looking statements, risk factors, and background profile text.",
  "Event semantics rule: choose the economic substance, not a trigger word, SEC item, or voting procedure. Financial results packages centered on revenue, profit or loss, margins, EPS, cash flow, or equivalent financial-statement performance are earnings. Narrow sales or demand metrics are sales_performance. Production, deliveries, shipments, utilization, uptime, capacity output, operating volume, customers, hashrate, and comparable non-financial operating performance or guidance are operating_update, as are workforce, cost-structure, facility, capacity, and restructuring-plan changes. Product launch, commercialization, development, and project milestones are product_update only when operating performance is not the main new fact. Leadership, board, auditor, control, ownership, transaction, financing/dilution, stress/default/restatement, litigation/regulatory, dividend, buyback, FDA/clinical, IPO/listing, and other events should map to their matching approved route_type.",
  "Operating-performance boundary: when the compact digest reports actual production, deliveries, utilization, uptime, output, operating volume, or similar operating KPIs, route operating_update even if a technical report, project study, reserve update, or growth plan is also furnished. A technical report or project-economics exhibit does not make product_update primary when the filing's main new facts are operating results or non-financial operating guidance. Route earnings only when financial-statement performance or financial guidance is the main event.",
  "Leadership boundary: use leadership_governance only when the main new fact changes a named officer, director, board role, governance right, control arrangement, auditor, or executive compensation decision. A workforce reduction, employee reorganization, facility exit, cost-reduction plan, or restructuring plan is not leadership_governance merely because a CEO announced it or employees are affected.",
  "Operating-versus-distress boundary: use operating_update for restructuring or cost actions undertaken to realign operations, investments, workforce, facilities, or capacity. Use financial_risk only when the compact digest independently shows liquidity stress, inability to meet obligations, default, covenant breach, debt acceleration, going-concern doubt, bankruptcy, receivership, or comparable survival pressure. The word restructuring alone does not establish financial_risk.",
  "Financing-versus-distress boundary: an ordinary loan, note issuance, revolving credit facility, refinancing, acquisition financing, guarantee, collateral package, margin requirement, repayment schedule, or lender remedy uses route_case debt_or_credit_financing and display_type capital_financing unless the current filing independently reports an actual breach, default, acceleration, inability to pay, failed survival financing, or comparable present distress. Standard protective loan terms and hypothetical default remedies do not use financial_distress_or_default by themselves.",
  "Vote-subject rule: shareholder_vote is primary only when the vote itself is mainly a governance, annual-meeting, director, compensation, auditor, shareholder-proposal, or similar governance outcome. A vote approving a merger, acquisition, tender, business combination, or other transaction routes strategic_transaction. A vote approving a current or future share issuance, warrant or convertible amendment, financing capacity, reverse split, authorized-share change, or comparable capital action routes dilution_risk. Keep the vote mechanics as source-backed context within that substantive primary route.",
  "Reverse-split rule: when the current filing announces, approves, authorizes, implements, makes effective, or completes a reverse stock split, use dilution_risk as the primary route, dilution_or_offering as route_case, and capital_financing as display_type. Do not use operating_update, other, or listing_risk as primary. If minimum-bid or exchange compliance pressure is stated, keep listing_risk as a secondary candidate.",
  "Dominance rule: when one filing contains multiple themes, identify one primary route and preserve secondary/context route candidates. A transaction paid in shares is still strategic_transaction when the acquisition/merger is the main event; share issuance is evidence, not automatically dilution_risk. A results package is not reclassified because a note mentions historical acquisitions, litigation, debt, or accounting details.",
  "Other rule: use other only when the filing's main source-backed event is administrative, referential, corrective, housekeeping, or outside the approved event taxonomy. Do not classify by keywords alone. Classify by the filing's main event, not by background descriptions, company profile language, risk factor references, historical disclosures, or incidental mentions.",
  "Do not use other merely because the filing seems low impact. Low impact affects archive gating; other is only for filings whose main event does not fit a substantive approved event_type.",
  "Do not classify a filing as other merely because it relates to a previously announced event. If it reports a new source-backed status change, approval, vote result, closing, termination, redemption result, condition satisfaction or failure, financing change, default, waiver, acceleration, listing change, ticker change, regulatory decision, or material amendment, classify it by the substantive event_type.",
  "Use other only when the filing does not add a substantive new event, condition, result, risk, economic term, financing effect, ownership change, vote outcome, litigation development, listing risk, earnings release, capital return, or strategic transaction.",
  "Examples usually suitable for other unless substantive new facts are present: total voting rights, block listing return, issued share capital update, routine treasury share movement with no buyback authorization, repurchase program update, cancellation, or shareholder return effect, employee plan share issuance without financing terms, analyst meeting schedule, investor presentation furnishing only with no new material event, officer certification only, coverage ratio exhibit only, exchange-rate or reference notice, routine exhibit filing, and minor correction, typo fix, or exhibit refile.",
  "Mechanical share count or denominator updates are not dilution_risk unless the source text shows a substantive financing, investor issuance, securities terms, proceeds, conversion, warrant exercise, offering, resale registration, or materially dilutive transaction.",
  "Insider ownership boundary: use insider_ownership only for a named insider, director, officer, PDMR, reporting person, beneficial owner, shareholder group, or control holder transaction, ownership change, voting-power change, dispositive-power change, or transaction-status change. Share count, total voting rights, block listing, issued capital denominator updates, or employee share-plan issuance are not insider_ownership unless a named holder transaction or ownership change is the main event.",
  "When in doubt, ask: what changed in this filing? If the answer is only that a document was furnished, a count was updated, a typo was corrected, or reference material was filed, use other. If the answer is that a deal closed, vote passed, condition changed, financing terms changed, default occurred, redemption happened, approval was received, or risk became active, do not use other.",
  "Clinical rule: use fda_clinical only when the main event announces a clinical or regulatory development. Pipeline descriptions, prior trial data, or planned study language inside boilerplate/background text do not control classification.",
  "IPO/SPAC rule: use ipo_listing only for the IPO/direct-listing/listing event itself. SPAC or de-SPAC business-combination status, vote, redemption, closing-condition, or ticker-change updates classify by the main event, often strategic_transaction or shareholder_vote, with spac_transaction_status only when enough transaction facts exist.",
  "Amendment rule: for 8-K/A and 6-K/A, decide whether the amendment is routine, supplemental, or materially changes the original event. Clearly clerical amendments are archive/other; substantive amendments need analysis. If parent comparison is needed and parent_filing_context is absent, set needs_parent_context true and do not over-score.",
  "When compact parent or prior-amendment lifecycle context is supplied, use it only to identify the amendment delta and route family. Do not treat unchanged background from the earlier filing as a new event.",
  "router_digest deliberately excludes extracted dates, amounts, share counts, rule-number hits, exchange-name hits, security-name hits, keyword-hit lists, and full original source blocks.",
  "The router only decides route families and archive gating. It does not choose or filter the original source blocks that the analysis LLM receives; downstream analysis receives the complete context-preserving source-block bundle.",
  "For Item 3.01 delisting or exchange noncompliance, consider the digest entries for Item 3.01, related Item 8.01, and Exhibit 99.1. Use listing_risk as the primary route unless the digest clearly shows delisting is only a transaction cleanup.",
  "Security-class removal boundary: listing_risk is for threatened or lost trading of the issuer's common equity or ADSs, or exchange noncompliance that materially affects public shareholders. Do not use listing_risk when notes, preferred shares, warrants, units, or another non-common class is removed solely because it is being fully redeemed, repaid, matured, converted, or retired while common-equity listing is not at risk. Route an issuer redemption or retirement of preferred/equity-linked securities to capital_return; keep related debt repayment and deregistration as context unless present financial distress is independently disclosed.",
  "For Item 2.01 merger or acquisition closing, consider the digest entries for Item 2.01, the transaction or press release, and any delisting or trading-suspension update. Route strategic_transaction as primary; treat delisting/change-of-control/management changes as secondary or context unless exchange noncompliance is the main fact.",
  "For Item 4.01 auditor dismissal, resignation, or engagement, consider the digest entries for Item 4.01 and available Exhibit 16 or 16.1 auditor/accountant letters. Do not infer the auditor's position from Item 4.01 alone when the digest identifies a letter.",
  "For Item 2.05 exit or disposal activities and related Item 2.06 impairment disclosures, consider their digest entries and the relevant Exhibit 99.1 title or headline when available. Route a workforce, facility, or cost realignment to operating_update unless separate digest evidence meets the financial-risk boundary. Treat a CEO employee memo as supporting operating context, not a leadership event by itself.",
  "For Item 5.07 vote results, use the vote result section/table to identify the subject of the vote. Route a merger, acquisition, tender, business combination, or transaction approval to strategic_transaction; route financing approval, share issuance, warrant or convertible amendment, reverse split, or charter/capital change to dilution_risk; use shareholder_vote only for the remaining governance-focused vote outcomes.",
  "For financing 8-Ks, consider Item 1.01, 2.03, 3.02, securities purchase agreement, indenture, warrant agreement, and relevant press-release content. Route the financing itself by its main economic effect.",
  "For a capital or financing candidate, identify every security family or series created, issued, sold, amended, or made newly operative by the current filing event. Do not treat historical instruments as current events merely because they appear in background text.",
  "Independent-event rule: a route candidate represents a separate new event, not a term, use of proceeds, condition, rationale, background fact, or consequence of the primary event. Add a secondary route only when the compact digest clearly identifies another event that would independently warrant its own investor conclusion. Otherwise preserve it as context within the primary route.",
  "For 6-Ks, route from the digest's document outlines and exhibit titles. Do not rely on 8-K Item codes or assume the router has the full exhibit body.",
  "Choose display_type from the approved list only: generic, offering_terms, capital_financing, spac_transaction_status, candidate_special.",
  "For 8-K/6-K financing, dilution, debt/liquidity, capital-structure, dividend, or buyback candidates, use capital_financing as the provisional display candidate. This includes approval-only capital actions even when the current filing does not disclose enough terms for a share-overhang calculation. The analysis LLM makes the final capital UI choice from original source blocks.",
  "Use offering_terms only for existing compatibility cases that already carry a complete offering-terms display model. Do not route a new 8-K/6-K capital event to offering_terms merely because it mentions shares, warrants, or financing.",
  "Use spac_transaction_status only when the compact digest shows enough SPAC/de-SPAC transaction facts to justify that provisional page. Do not use it for a plain blank-check IPO with no target or transaction-status update.",
  "Use candidate_special only when the filing clearly needs a new detail UI and existing display types are insufficient; otherwise use generic.",
  "Router score is only an archive gate, not the final materiality score. If the filing can safely stop at compact archive display, use score 0-49, delivery_level archive, and analysis_needed false. Otherwise use score 50, delivery_level feed, and analysis_needed true so the analysis LLM assigns the final score.",
  "Do not use router delivery_level alert. Alert is only possible after the analysis LLM assigns a final score of 75 or higher.",
  "Archive only when all of these are true: analysis_needed is false; archive_like_candidate or deterministic_possible is true; low_signal_reason explains the routine/low-signal basis; the compact router bundle has enough evidence; no high-priority substantive route candidate exists; needs_parent_context is false; market_context_needed is false; and no material delisting, M&A, financing, default, bankruptcy, accounting, governance, vote, or legal/regulatory candidate is present.",
  "If uncertain, route to analysis.",
  "Evidence must cite only short facts visible in router_digest. Do not invent values, infer market reaction, or pretend the digest is the full filing analysis.",
  "Delivery is downstream score-derived. In router output, delivery_level must stay consistent with the router gate score.",
].join("\n");

export const sec8k6kRouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_scope",
    "event_type",
    "route_case",
    "score",
    "delivery_level",
    "display_type",
    "display_version",
    "ipo_kind",
    "analysis_needed",
    "filing_complexity",
    "primary_route_candidate",
    "route_candidates",
    "needs_parent_context",
    "confidence",
    "routing_reason",
    "archive_like_candidate",
    "deterministic_possible",
    "low_signal_reason",
    "evidence",
    "market_context_needed",
    "market_context_reason",
    "market_context_fields",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_scope: { type: "string", enum: ["8-K / 6-K, 8-K/A / 6-K/A"] },
    event_type: { type: "string", enum: SEC_8K_6K_APPROVED_EVENT_TYPES },
    route_case: { type: "string", enum: SEC_8K_6K_ROUTER_CASE_VALUES },
    score: {
      type: "integer",
      minimum: 0,
      maximum: 100,
      description: "Router archive gate only: 0-49 archive short-circuit, 50 analysis-needed feed-or-higher candidate. Final materiality score comes from analysis LLM.",
    },
    delivery_level: {
      type: "string",
      enum: SEC_8K_6K_ROUTER_ACTION_VALUES,
      description: "Router gate delivery only. Use archive for score < 50, feed for analysis-needed candidates, and do not use alert in router output.",
    },
    display_type: { type: "string", enum: SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES },
    display_version: { type: "string", enum: SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES },
    ipo_kind: { type: ["string", "null"], enum: ["traditional", "spac", null] },
    analysis_needed: { type: "boolean" },
    filing_complexity: { type: "string", enum: ["simple", "moderate", "complex"] },
    primary_route_candidate: sec8k6kRouteCandidateSchema,
    route_candidates: {
      type: "array",
      items: sec8k6kRouteCandidateSchema,
      description: "Candidate route families for downstream analysis. Keep primary first.",
    },
    needs_parent_context: { type: "boolean" },
    confidence: { type: "string", enum: SEC_8K_6K_ROUTER_CONFIDENCE_VALUES },
    routing_reason: { type: "string" },
    archive_like_candidate: { type: "boolean" },
    deterministic_possible: { type: "boolean" },
    low_signal_reason: { type: ["string", "null"] },
    evidence: { type: "array", items: { type: "string" } },
    market_context_needed: { type: "boolean" },
    market_context_reason: { type: ["string", "null"] },
    market_context_fields: { type: "array", items: { type: "string" } },
  },
} as const;

export function buildSec8k6kRouterPromptDraft(input: Sec8k6kRouterPromptInput) {
  return {
    key: SEC_8K_6K_ROUTER_PROMPT_KEY,
    version: SEC_8K_6K_ROUTER_PROMPT_VERSION,
    system: sec8k6kRouterSystemPrompt,
    user: JSON.stringify(buildSec8k6kPromptInputForLlm(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_8k_6k_router",
        strict: true,
        schema: sec8k6kRouterResponseSchema,
      },
    },
  };
}

export function buildSec8k6kPromptInputForLlm(input: Sec8k6kRouterPromptInput) {
  return buildSec8k6kRouterDigestInput({
    filingPackage: input.filing_package,
    parserOutput: toRecord(input.parser_output),
    fallbackText: input.filing_excerpt,
    parentFilingContext: input.parent_filing_context,
    relatedFilingContexts: input.related_filing_contexts,
  });
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
