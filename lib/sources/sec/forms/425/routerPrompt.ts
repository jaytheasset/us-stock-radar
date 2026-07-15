import {
  SEC_425_PARSER_VERSION,
  type Sec425ApprovedEventType,
  type Sec425Confidence,
  type Sec425DeliveryLevel,
  type Sec425DisplayType,
  type Sec425ParserOutput,
  type Sec425SourceBlock,
} from "./types";
import {
  buildCurrentFilingIdentity,
  currentFilingIdentityText,
} from "../common/currentFilingIdentity.ts";

export const SEC_425_ROUTER_PROMPT_KEY = "sec_425_router";
export const SEC_425_ROUTER_PROMPT_VERSION = "v2";
export const SEC_425_DISPLAY_PAYLOAD_VERSION = "sec_425_display_v1";

export const SEC_425_ROUTER_ACTION_VALUES = ["archive", "feed", "alert"] as const;
export const SEC_425_ROUTER_EVENT_TYPES = [
  "strategic_transaction",
  "shareholder_vote",
  "legal_risk",
  "financial_risk",
  "dilution_risk",
  "ipo_listing",
  "other",
] as const satisfies readonly Sec425ApprovedEventType[];
export const SEC_425_ROUTER_CASE_VALUES = [
  "acquisition_offer_or_proposal",
  "transaction_announcement_or_terms",
  "spac_business_combination",
  "transaction_presentation_or_call",
  "stakeholder_faq_or_communication",
  "shareholder_meeting_or_vote",
  "agreement_amendment",
  "regulatory_or_closing_update",
  "deal_litigation_or_regulatory_risk",
  "financing_or_liquidity_risk",
  "routine_repetition",
  "unclear_425_communication",
] as const;
export const SEC_425_COMMUNICATION_MODE_VALUES = [
  "offer_letter",
  "press_release",
  "investor_presentation",
  "fact_sheet",
  "agreement",
  "faq",
  "transcript",
  "stakeholder_communication",
  "meeting_notice",
  "regulatory_update",
  "social_media",
  "mixed",
  "other",
] as const;
export const SEC_425_TRANSACTION_STAGE_VALUES = [
  "proposal",
  "announced",
  "agreement_signed",
  "solicitation",
  "vote_pending",
  "vote_update",
  "regulatory_review",
  "closing_pending",
  "closed",
  "amended",
  "opposition_or_competing_offer",
  "unclear",
] as const;

export type Sec425RouterAction = (typeof SEC_425_ROUTER_ACTION_VALUES)[number];
export type Sec425RouterCase = (typeof SEC_425_ROUTER_CASE_VALUES)[number];
export type Sec425CommunicationMode = (typeof SEC_425_COMMUNICATION_MODE_VALUES)[number];
export type Sec425TransactionStage = (typeof SEC_425_TRANSACTION_STAGE_VALUES)[number];

export type Sec425RouterPromptInput = {
  filing_package: Record<string, unknown>;
  parser_output: Sec425ParserOutput;
  filing_excerpt?: string | null;
  market_context?: Record<string, unknown> | null;
};

export type Sec425RouterDecision = {
  source_group: "filings";
  source_form_type: "425";
  parser_group: "425";
  event_type: Sec425ApprovedEventType;
  score: number;
  expected_delivery_level: Sec425DeliveryLevel;
  action: Sec425RouterAction;
  route_case: Sec425RouterCase;
  communication_mode: Sec425CommunicationMode;
  transaction_stage: Sec425TransactionStage;
  display_type: Sec425DisplayType;
  display_version: typeof SEC_425_DISPLAY_PAYLOAD_VERSION;
  confidence: Sec425Confidence;
  needs_analysis_llm: boolean;
  archive_like_candidate: boolean;
  needs_parent_context: boolean;
  deterministic_stage: "router" | null;
  routing_reason: string;
  evidence: string[];
  selected_source_block_ids: string[];
  source_blocks_used: string[];
  needs_human_review: boolean;
  debug: {
    parser_version: typeof SEC_425_PARSER_VERSION;
    router_prompt_key: typeof SEC_425_ROUTER_PROMPT_KEY;
    router_prompt_version: typeof SEC_425_ROUTER_PROMPT_VERSION;
  };
};

type Sec425RouterPromptBlock = Pick<
  Sec425SourceBlock,
  | "block_id"
  | "block_type"
  | "source_ref"
  | "origin"
  | "document_type"
  | "document_role"
  | "content_role"
  | "exhibit_number"
  | "filename"
  | "heading"
  | "sequence"
  | "text"
>;

export type Sec425RouterSourcePromptInput = {
  current_filing: ReturnType<typeof buildCurrentFilingIdentity>;
  filing_identity_text: string;
  document_inventory: Array<{
    source_ref: string;
    origin: "primary" | "attachment";
    document_type: string | null;
    document_role: string;
    description: string | null;
    filename: string | null;
    source_block_count: number;
  }>;
  cleaned_source_blocks: Sec425RouterPromptBlock[];
  parser_warnings: string[];
};

export const sec425RouterSystemPrompt = [
  "Act as a route planner for one SEC Form 425 communication.",
  "Return only strict JSON matching the schema. Do not write the final investor analysis.",
  "Use only current_filing, document_inventory, and cleaned_source_blocks supplied in the user message.",
  "The cleaned_source_blocks are compact, context-preserving excerpts from the original filing. Treat their block_id values as the only selectable evidence IDs.",
  "Do not infer from parser facts, extracted values, keyword hits, parser summaries, prior event labels, or display labels.",
  "Classify the investor-relevant purpose and transaction stage, not merely the document format. A presentation, FAQ, transcript, or social post can carry material transaction terms or only repeat known information.",
  "Before choosing route_case, identify the communication's stated title, intended audience, and substantive purpose from the original blocks. Treat transaction definitions, forward-looking risk lists, PIPE definitions, and SEC solicitation boilerplate as context, not as the dominant purpose.",
  `Choose event_type only from: ${SEC_425_ROUTER_EVENT_TYPES.join(", ")}.`,
  `Choose route_case only from: ${SEC_425_ROUTER_CASE_VALUES.join(", ")}.`,
  `Choose communication_mode only from: ${SEC_425_COMMUNICATION_MODE_VALUES.join(", ")}.`,
  `Choose transaction_stage only from: ${SEC_425_TRANSACTION_STAGE_VALUES.join(", ")}.`,
  "Use acquisition_offer_or_proposal for a public, unsolicited, hostile, competing, tender, or exchange proposal that is not yet a signed transaction.",
  "Do not treat the legal phrase 'proposed merger' or 'proposed transaction' by itself as transaction_stage proposal. Use proposal only when the source shows an offer or proposal that has not been accepted or signed. Use announced when the transaction is jointly announced but signing is not established in the supplied blocks, and agreement_signed when the supplied blocks establish an executed agreement.",
  "Use transaction_announcement_or_terms for a signed or announced merger or acquisition and its material economics, parties, consideration, or closing conditions.",
  "Choose route_case by the dominant purpose of this Form 425 communication, not merely the underlying transaction type. When the filing expressly says that an FAQ was provided to employees, customers, or partners, use communication_mode faq and route_case stakeholder_faq_or_communication even if introductory questions recap SPAC, PIPE, merger, or listing terms. Override this only when the filing primarily communicates a separate new material transaction change rather than stakeholder guidance.",
  "Use spac_business_combination for investor-facing communications that substantively update de-SPAC target, valuation, PIPE, redemptions, minimum cash, vote, closing, or ticker-transition status, rather than for an explicitly labeled stakeholder FAQ that merely explains those terms.",
  "Use transaction_presentation_or_call when the main new information is transaction rationale, forecasts, operating metrics, or management discussion in a presentation or transcript.",
  "Also use transaction_presentation_or_call for an announcement of a future investor call, webcast, or presentation when the current filing gives the event details but does not yet disclose the promised operating metrics or transaction terms. Do not route such a notice as a substantive SPAC status update merely because it repeats the underlying business combination or prior S-4/proxy progress.",
  "Use stakeholder_faq_or_communication when the communication mainly explains effects on employees, customers, partners, compensation, benefits, or day-to-day operations.",
  "Use shareholder_meeting_or_vote for meeting dates, record dates, adjournments, solicitation, vote status, or vote results. A concrete adjournment, postponement, reconvened date, changed record date, or reported vote result is a shareholder_vote and vote_update even when the underlying proposal is a merger or business combination.",
  "Use agreement_amendment only when the filing changes an agreement term, outside date, consideration, condition, financing, termination right, or another material transaction mechanic.",
  "Use regulatory_or_closing_update for regulatory approval, proxy effectiveness or mailing, satisfaction of closing conditions, closing completion, or a concrete next closing step.",
  "Use deal_litigation_or_regulatory_risk when litigation, injunction, antitrust review, a second request, or another unresolved regulatory obstacle is the dominant investor issue.",
  "Use financing_or_liquidity_risk only when transaction funding, minimum cash, financing availability, liquidity, or failure-to-close funding consequences dominate the communication.",
  "Use routine_repetition only when the selected source blocks show no new material terms, status change, date, vote development, regulatory development, or stakeholder consequence.",
  "A short communication is not automatically routine. Social media, interviews, event notices, and FAQs may still contain a material proposal or status update.",
  "Final conflict check: if an original block expressly labels the communication as an FAQ provided to employees, customers, or partners and the filing contains stakeholder questions or instructions, output communication_mode faq and route_case stakeholder_faq_or_communication. Do not let underlying SPAC, PIPE, merger, or solicitation boilerplate override that communication purpose.",
  "Set archive_like_candidate true and needs_analysis_llm false only for source-backed routine repetition with no material update. Otherwise analysis is required.",
  "Set needs_parent_context true when the communication cannot be understood reliably without a prior merger agreement, proxy, tender document, or earlier transaction event.",
  "Router score is an archive gate, not the final impact score. Use 0-49 only for archive-like repetition and 50 for all cases requiring analysis. Do not assign alert-level scores in the router.",
  "Derive expected_delivery_level and action from score: below 50 archive; 50 feed. The analysis LLM will assign the final score and delivery level.",
  "Select 1-8 source block IDs that best support the route. Use original block_id values exactly and do not return labels in selected_source_block_ids.",
  "Evidence must be short source-backed reasons, not long quotations.",
  "Use display_type spac_transaction_status only for de-SPAC status. Use candidate_special for material transaction terms or complex vote/offer cases. Otherwise use generic.",
].join("\n");

export const sec425RouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_type",
    "parser_group",
    "event_type",
    "score",
    "expected_delivery_level",
    "action",
    "route_case",
    "communication_mode",
    "transaction_stage",
    "display_type",
    "display_version",
    "confidence",
    "needs_analysis_llm",
    "archive_like_candidate",
    "needs_parent_context",
    "deterministic_stage",
    "routing_reason",
    "evidence",
    "selected_source_block_ids",
    "source_blocks_used",
    "needs_human_review",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string", enum: ["425"] },
    parser_group: { type: "string", enum: ["425"] },
    event_type: { type: "string", enum: SEC_425_ROUTER_EVENT_TYPES },
    score: { type: "integer", minimum: 0, maximum: 50 },
    expected_delivery_level: { type: "string", enum: ["archive", "feed"] },
    action: { type: "string", enum: ["archive", "feed"] },
    route_case: { type: "string", enum: SEC_425_ROUTER_CASE_VALUES },
    communication_mode: { type: "string", enum: SEC_425_COMMUNICATION_MODE_VALUES },
    transaction_stage: { type: "string", enum: SEC_425_TRANSACTION_STAGE_VALUES },
    display_type: { type: "string", enum: ["generic", "candidate_special", "spac_transaction_status"] },
    display_version: { type: "string", enum: [SEC_425_DISPLAY_PAYLOAD_VERSION] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    needs_analysis_llm: { type: "boolean" },
    archive_like_candidate: { type: "boolean" },
    needs_parent_context: { type: "boolean" },
    deterministic_stage: { type: ["string", "null"], enum: ["router", null] },
    routing_reason: { type: "string", maxLength: 500 },
    evidence: { type: "array", maxItems: 4, items: { type: "string", maxLength: 300 } },
    selected_source_block_ids: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
    source_blocks_used: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } },
    needs_human_review: { type: "boolean" },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version"],
      properties: {
        parser_version: { type: "string", enum: [SEC_425_PARSER_VERSION] },
        router_prompt_key: { type: "string", enum: [SEC_425_ROUTER_PROMPT_KEY] },
        router_prompt_version: { type: "string", enum: [SEC_425_ROUTER_PROMPT_VERSION] },
      },
    },
  },
} as const;

export function buildSec425RouterPromptDraft(input: Sec425RouterPromptInput) {
  return {
    key: SEC_425_ROUTER_PROMPT_KEY,
    version: SEC_425_ROUTER_PROMPT_VERSION,
    system: sec425RouterSystemPrompt,
    user: JSON.stringify(buildSec425RouterSourcePromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_425_router",
        strict: true,
        schema: sec425RouterResponseSchema,
      },
    },
  };
}

export function buildSec425RouterSourcePromptInput(input: Sec425RouterPromptInput): Sec425RouterSourcePromptInput {
  const filingPackage = input.filing_package || {};
  const parserOutput = input.parser_output;
  const currentFiling = buildCurrentFilingIdentity({
    filingPackage,
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    formFamily: "425",
  });

  return {
    current_filing: currentFiling,
    filing_identity_text: currentFilingIdentityText(currentFiling),
    document_inventory: parserOutput.raw.document_inventory.map((document) => ({
      source_ref: document.source_ref,
      origin: document.origin,
      document_type: document.document_type,
      document_role: document.document_role,
      description: document.description,
      filename: document.filename,
      source_block_count: document.source_block_count,
    })),
    cleaned_source_blocks: parserOutput.raw.router_source_blocks.map(toRouterPromptBlock),
    parser_warnings: parserOutput.warnings.slice(0, 12),
  };
}

export function normalizeSec425RouterResult(value: Record<string, unknown>, parserOutput: Sec425ParserOutput) {
  const availableIds = new Set(parserOutput.raw.router_source_blocks.map((block) => block.block_id));
  const selectedIds = uniqueStrings([
    ...stringArray(value.selected_source_block_ids),
    ...stringArray(value.source_blocks_used),
  ]).filter((blockId) => availableIds.has(blockId)).slice(0, 8);
  const needsAnalysis = value.needs_analysis_llm !== false || value.archive_like_candidate !== true;
  const score = needsAnalysis ? 50 : Math.min(49, Math.max(0, Math.round(numberValue(value.score) ?? 0)));
  const communicationMode = typeof value.communication_mode === "string" ? value.communication_mode : "";
  const routeCase = communicationMode === "faq"
    ? "stakeholder_faq_or_communication"
    : value.route_case;
  const eventType = routeCase === "shareholder_meeting_or_vote"
    ? "shareholder_vote"
    : value.event_type;

  return {
    ...value,
    event_type: eventType,
    route_case: routeCase,
    score,
    expected_delivery_level: needsAnalysis ? "feed" : "archive",
    action: needsAnalysis ? "feed" : "archive",
    needs_analysis_llm: needsAnalysis,
    archive_like_candidate: !needsAnalysis,
    deterministic_stage: needsAnalysis ? null : "router",
    selected_source_block_ids: selectedIds,
    source_blocks_used: selectedIds,
    selected_source_block_ids_normalized: selectedIds.length !== uniqueStrings(stringArray(value.selected_source_block_ids)).length,
    needs_human_review: value.needs_human_review === true || selectedIds.length === 0,
  };
}

function toRouterPromptBlock(block: Sec425SourceBlock): Sec425RouterPromptBlock {
  return {
    block_id: block.block_id,
    block_type: block.block_type,
    source_ref: block.source_ref,
    origin: block.origin,
    document_type: block.document_type,
    document_role: block.document_role,
    content_role: block.content_role,
    exhibit_number: block.exhibit_number,
    filename: block.filename,
    heading: block.heading,
    sequence: block.sequence,
    text: block.text,
  };
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
