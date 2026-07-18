import {
  SEC_425_APPROVED_EVENT_TYPES,
  SEC_425_CONFIDENCE_VALUES,
  SEC_425_DELIVERY_LEVEL_VALUES,
  SEC_425_DISPLAY_TYPE_VALUES,
  SEC_425_MARKET_SCOPE_VALUES,
  SEC_425_SIGNAL_VALUES,
  deliveryLevelFromScore,
  isSec425ApprovedEventType,
  type Sec425Confidence,
  type Sec425DisplayType,
  type Sec425MarketScope,
  type Sec425AnalysisOutput,
  type Sec425ParserOutput,
  type Sec425RoomResult,
  type Sec425Signal,
  type Sec425SourceBlock,
} from "./types";
import {
  SEC_425_ROUTER_PROMPT_KEY,
  SEC_425_ROUTER_PROMPT_VERSION,
  type Sec425RouterDecision,
  type Sec425RouterPromptInput,
} from "./routerPrompt";
import { buildSec425DisplayPayload } from "./displayPayload";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";

export const SEC_425_ANALYSIS_PROMPT_KEY = "sec_425_analysis_draft";
export const SEC_425_ANALYSIS_PROMPT_VERSION = "v9";

export const SEC_425_ANALYSIS_CASE_VALUES = [
  "strategic_transaction_terms",
  "spac_business_combination",
  "tender_or_exchange_offer",
  "agreement_amendment",
  "shareholder_vote",
  "shareholder_vote_results",
  "shareholder_meeting_adjournment",
  "legal_or_regulatory_deal_risk",
  "financing_or_liquidity_risk",
  "investor_day_notice",
  "routine_archive",
  "other_425",
] as const;

export const SEC_425_IMPACT_LEVEL_VALUES = [
  "repeated_information",
  "procedural_update",
  "material_progression",
  "decisive_outcome",
] as const;

export type Sec425AnalysisCase = (typeof SEC_425_ANALYSIS_CASE_VALUES)[number];

export type Sec425AnalysisPromptInput = Sec425RouterPromptInput & {
  router_result: Sec425RouterDecision;
};

export const sec425AnalysisSystemPrompt = [
  "Write investor-facing analysis for one SEC Form 425 transaction communication and return only strict JSON matching the Required Output JSON shape.",
  "Use only cleaned_source_blocks, router result, and fixture-provided market_context. Do not call, request, or assume live market data.",
  "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same 425 family.",
  "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  `Use only these approved event types: ${SEC_425_APPROVED_EVENT_TYPES.join(", ")}.`,
  "Do not choose the event_type. Copy analysis_output.event_type exactly from router_result.event_type.",
  "Do not choose or change display_type. The router already selected the page family.",
  "Do not use parser-generated display payload fields as evidence. They are not included in this analysis input.",
  "For the selected page family, write only the investor-facing snapshot fields requested in analysis_output from the original cleaned_source_blocks.",
  "Use router_result.routing_reason and cleaned_source_blocks as the evidence base.",
  "Analyze this Form 425 independently. Prior 8-K, 6-K, S-4, F-4, proxy, tender, and Form 425 analyses are not supplied as evidence and must not be assumed.",
  "Treat the router as a candidate gate, not final proof of materiality. Before writing analysis, independently verify from the selected original source blocks that this current Form 425 establishes an explicit material transaction event.",
  "A stakeholder-facing transcript, video, town hall, FAQ, interview, or message explaining an announced transaction is archive-level unless its selected original blocks clearly establish a separate executed or changed action: a signed or amended agreement, changed consideration, vote result, regulatory decision, termination, financing outcome, or concrete closing milestone.",
  "Do not treat management language that it is 'announcing' a transaction, or explanations of deal rationale, benefits, consideration, forecasts, or integration plans, as proof of a separate current-filing event when the document is expressly addressed to employees or other stakeholders in connection with a proposed transaction.",
  "If the selected original blocks do not establish that discrete current action, override the router candidate by using impact_level repeated_information, analysis_case routine_archive, an archive score of 25-39, and one concise summary sentence. Leave bullish_points, bearish_points, key_evidence, and what_to_watch_next empty.",
  "Do not ask for full raw filing text. If filing_excerpt is supplied, treat it as selected source snippets only.",
  "Do not add delivery_level as a model field. The fixture expected delivery level is derived from analysis_output.score: below 50 archive, 50 to 74 feed, 75 or above alert.",
  "Prioritize the standalone investor impact established by the current Form 425: new deal economics, a new or revised proposal, a signed agreement, changed consideration, agreement amendment, termination, vote result, regulatory decision, financing event, or concrete closing milestone.",
  "Do not raise the score merely because the underlying transaction is important. Score the explicit event announced by this filing.",
  "Score impact magnitude separately from direction. A neutral transaction event can have a high score, while bullish or bearish advocacy can still have a low score.",
  "Before scoring, set impact_level to exactly one of repeated_information, procedural_update, material_progression, or decisive_outcome. Use the current filing's new action, decision, changed binding term, or resolved condition as the basis, not its communication format or transaction size.",
  "Use 0-24 for administrative or extremely low-signal communications; 25-39 for explanatory, promotional, or stakeholder communications that repeat known transaction information; and 40-49 for concrete but procedural updates. These are archive scores.",
  "A procedural_update is analyzed but archived. It includes ordinary meeting logistics, record-date changes, proxy mailing, solicitation reminders, or a routine adjournment that does not itself resolve or materially endanger a required transaction condition.",
  "Feed begins only when the current filing establishes a substantive change in transaction economics, closing certainty, a required condition, financing, regulation, litigation, or vote status. Use 50-59 for a meaningful but limited change and 60-69 for stronger but still conditional progress or risk.",
  "Use 70-74 only for a highly material update that remains unresolved or conditional. This is still feed, not alert.",
  "Use 75-84 only when the current Form 425 itself establishes a decisive new catalyst: a signed definitive agreement, a new or revised acquisition proposal, changed principal consideration or control terms, a transaction approval or rejection that resolves a material condition, final regulatory clearance or block, termination, closing, or a material financing outcome.",
  "A resolved material external condition is a decisive_outcome even when closing remains pending. For example, final regulatory approval with no further regulatory approvals required is decisive; an interim approval or pending review is material_progression.",
  "Do not downgrade a decisive current-filing update merely because the underlying transaction was announced earlier. Use 75-79 when this Form 425 first reports final regulatory clearance, shareholder approval, or another resolved required condition but closing remains pending; use 80-84 only when the update creates unusually high closing certainty or an immediate closing step.",
  "Use 85-94 for exceptional changes to control, economics, or closing certainty, such as a superior or competing proposal, transaction collapse, blocking injunction, failed essential financing, or materially revised consideration. Reserve 95-100 for rare immediate and extraordinary outcomes.",
  "Do not score 75 or above unless score_reason can name the decisive current-filing event that changed transaction economics, control, a required condition, or closing outcome. If it cannot, cap the score at 74.",
  "A communication format does not determine the score by itself. Presentations, FAQs, transcripts, interviews, employee communications, and social posts remain below 50 unless their supplied content explicitly announces a decisive event; transaction size, detailed projections, rationale, or promotional language alone do not raise the score.",
  "A meeting date, record-date change, proxy mailing, solicitation reminder, or routine adjournment is archive-level unless another fact in the current filing establishes a substantive transaction change. A disclosed failure to obtain a required vote or another concrete threat may justify 50-74, while an actual approval or rejection of the transaction may qualify for 75 or above.",
  "An announcement of a future call, webcast, investor day, interview, or presentation without a new proposal, signed agreement, revised economics, vote result, regulatory decision, financing event, termination, or concrete closing milestone is archive-level. The promised future discussion is not evidence that those facts were disclosed now.",
  "A filing that only says a social-media post, repost, interview, or other communication occurred, without supplying its substantive content, does not establish a new investor event. Score it below 50 and archive it unless another supplied source block independently provides a material update.",
  "Routine presentations, FAQs, employee communications, interviews, transcripts, reposts, and transaction explanations with no explicit material event in the current filing are archive-level even when they do not expressly say that no new information is included.",
  "For strategic transaction terms, explain consideration, transaction value, parties, closing timeline, and what to watch next.",
  "For a signed transaction agreement, prioritize the complete economic consideration disclosed for each security and any stated post-closing ownership. Do not substitute fractional-share cash cleanup, award treatment, or a defined-term fragment for the principal merger consideration.",
  "For SPAC business-combination terms, focus on target, valuation, PIPE, trust cash, redemptions, earnout shares, warrants, lock-up, support, and expected ticker only when source-backed.",
  "For tender or exchange offers, separate offer mechanics from advocacy, hostile language, and boilerplate tender-offer disclaimers.",
  "For shareholder vote cases, focus on meeting date, record date, adjournment, vote results, board recommendation, vote consequence, and next calendar item.",
  "For amendment cases, analyze only what the amendment changed; do not restate the parent agreement as a new event unless changed terms are evident.",
  "For legal_risk and financial_risk cases, explain how the issue could affect closing certainty, funding, dilution, or downside risk without overstating facts.",
  "For ipo_listing cases, explain only source-backed IPO/listing facts already selected by the router/classifier; keep ipo_kind in display_payload.data as traditional or spac and do not reclassify SPAC redemption, liquidation, or de-SPAC updates as IPO listings.",
  "Keep investor-facing copy consistent with the other SEC analysis rooms: event_title under 90 characters; quick_take one sentence under 22 words; summary 2 to 4 concise sentences under 100 words total; why_it_matters one sentence under 35 words.",
  "Before writing Snapshot, Summary, or Key Evidence, populate current_changes from the original source blocks. Include up to 4 explicit actions, decisions, status changes, changed dates, or changed binding terms announced by this current filing; do not include unchanged background facts.",
  "For each current_changes item, write a concise topic, the complete change, the resulting current value or status, primary or secondary priority, and the exact source_block_id. Collapse one decision and its supporting rationale into one current change; a best-interests conclusion is not separate from the board position it explains. If the filing only repeats known information, return an empty current_changes array.",
  "Snapshot and Summary must collectively cover every current_changes item before using static transaction background. A changed value or status has priority over an unchanged meeting, record, valuation, or transaction fact.",
  "score_reason is the visible score explanation. Write exactly one concise analyst-style conclusion for stock investors, targeting 18-32 words, that explains why the impact is material without repeating the filing summary.",
  "Do not format score_reason as sections, bullets, labels, or an internal scoring review. Do not begin with 'The score' and do not mention the score, score level, impact band, delivery level, form type, filing mechanics, or SEC form labels.",
  "Write no more than 3 key_evidence items. Usually select 2 or 3 of the strongest non-repetitive original-source facts, but use 1 when the filing supports only one distinct material fact. Map each item to a different current_changes item and use at most one evidence sentence per current change. A rationale or best-interests conclusion for the same board decision is not a separate evidence item. Each item must cover a different objective decision, changed term, amount, deadline, approval, vote result, or transaction condition. Exclude slogans, aspirations, expected benefits, and promotional claims. Keep each item under 28 words and 180 characters, and do not restate the full summary.",
  "Write no more than 3 what_to_watch_next items. Keep each item under 72 characters and name a concrete transaction milestone, decision, deadline, or changed condition supported by the filing context.",
  "When router_result.display_type is spac_transaction_status or candidate_special, write exactly 4 snapshot_items. Choose concise labels that fit this filing's actual event; do not force fixed labels such as Vote Date, Target / Ticker, Consideration, Key Condition, or Closing / Listing.",
  "Every snapshot item must be directly supported by the original cleaned_source_blocks. Never use parser facts, extracted values, keyword snippets, or UI defaults to fill a snapshot item.",
  "Never output Not disclosed, Not available, Unknown, N/A, placeholder ticker text, or an inferred date in snapshot_items. If one fact is unavailable, choose another material disclosed fact so the snapshot still contains 4 useful items.",
  "For dates, identify the date's exact role from the source, such as original meeting, adjourned meeting, reconvened meeting, record date, vote deadline, or expected closing. Do not merge different dates or treat an intermediate adjournment date as the final reconvened date.",
  "Keep snapshot_title under 40 characters, snapshot_summary to one sentence under 35 words, each snapshot label under 28 characters, each value under 80 characters, and each optional note under 100 characters.",
  "When router_result.display_type is generic, return empty snapshot_title, snapshot_summary, and snapshot_items.",
  "For archive-score communications, keep bullish_points, bearish_points, key_evidence, and what_to_watch_next empty. Use one concise summary sentence describing the communication and whether it changed the transaction.",
  "Analysis is responsible for investor-facing copy: event_title, score_reason, signal, quick_take, summary, why_it_matters, points, evidence, watch items, confidence, and human-review flag.",
].join("\n");

export const sec425RequiredOutputResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["parser_output", "analysis_output", "display_payload", "fixture_expected"],
  properties: {
    parser_output: {
      type: "object",
      additionalProperties: true,
      required: ["parserVersion", "parserGroup", "formType", "accessionNumber", "isSupported", "summary", "facts", "signals", "calendarItems", "warnings", "raw"],
      properties: {
        parserVersion: { type: "string" },
        parserGroup: { type: "string", enum: ["425"] },
        formType: { type: "string", enum: ["425"] },
        accessionNumber: { type: ["string", "null"] },
        isSupported: { type: "boolean", enum: [true] },
        summary: { type: ["string", "null"] },
        facts: { type: "object", additionalProperties: true },
        signals: { type: "array", items: { type: "object", additionalProperties: true } },
        calendarItems: { type: "array", items: { type: "object", additionalProperties: true } },
        warnings: { type: "array", items: { type: "string" } },
        raw: { type: "object", additionalProperties: true },
      },
    },
    analysis_output: {
      type: "object",
      additionalProperties: false,
      required: [
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
        "current_changes",
        "snapshot_title",
        "snapshot_summary",
        "snapshot_items",
        "bullish_points",
        "bearish_points",
        "key_evidence",
        "what_to_watch_next",
        "related_tickers",
        "calendar_items",
        "confidence",
        "needs_human_review",
      ],
      properties: {
        source_group: { type: "string", enum: ["filings"] },
        market_scope: { type: "string", enum: SEC_425_MARKET_SCOPE_VALUES },
        event_type: { type: "string", enum: SEC_425_APPROVED_EVENT_TYPES },
        event_title: { type: "string", maxLength: 90 },
        primary_ticker: {
          type: "object",
          additionalProperties: false,
          required: ["ticker", "exchange"],
          properties: {
            ticker: { type: ["string", "null"] },
            exchange: { type: ["string", "null"] },
          },
        },
        tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string", maxLength: 180 },
        signal: { type: "string", enum: SEC_425_SIGNAL_VALUES },
        quick_take: { type: "string", maxLength: 180 },
        summary: { type: "string", maxLength: 800 },
        why_it_matters: { type: "string", maxLength: 260 },
        current_changes: {
          type: "array",
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["topic", "change", "result", "priority", "source_block_id"],
            properties: {
              topic: { type: "string", maxLength: 40 },
              change: { type: "string", maxLength: 180 },
              result: { type: "string", maxLength: 80 },
              priority: { type: "string", enum: ["primary", "secondary"] },
              source_block_id: { type: "string", maxLength: 80 },
            },
          },
        },
        snapshot_title: { type: "string", maxLength: 40 },
        snapshot_summary: { type: "string", maxLength: 260 },
        snapshot_items: {
          type: "array",
          maxItems: 4,
          description: "Return exactly four source-backed items for candidate_special or spac_transaction_status. Never return more than four items.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "value", "note"],
            properties: {
              label: { type: "string", maxLength: 28 },
              value: { type: "string", maxLength: 80 },
              note: { type: "string", maxLength: 100 },
            },
          },
        },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: {
          type: "array",
          maxItems: 3,
          items: { type: "string", maxLength: 180 },
        },
        what_to_watch_next: {
          type: "array",
          maxItems: 3,
          items: { type: "string", maxLength: 72 },
        },
        related_tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
        confidence: { type: "string", enum: SEC_425_CONFIDENCE_VALUES },
        needs_human_review: { type: "boolean" },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: false,
      required: ["display_type", "data", "evidence", "notes"],
      properties: {
        display_type: { type: "string", enum: SEC_425_DISPLAY_TYPE_VALUES },
        data: { type: "object", additionalProperties: true },
        evidence: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    fixture_expected: {
      type: "object",
      additionalProperties: false,
      required: [
        "expected_delivery_level",
        "expected_impact",
        "market_context_needed",
        "market_context_reason",
        "market_context_fields",
        "special_ui_needed",
        "special_ui_reason",
        "integration_notes",
      ],
      properties: {
        expected_delivery_level: { type: "string", enum: SEC_425_DELIVERY_LEVEL_VALUES },
        expected_impact: { type: "string", enum: ["low", "medium", "high"] },
        market_context_needed: { type: "boolean" },
        market_context_reason: { type: ["string", "null"] },
        market_context_fields: { type: "array", items: { type: "string" } },
        special_ui_needed: { type: "boolean" },
        special_ui_reason: { type: ["string", "null"] },
        integration_notes: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export function buildSec425AnalysisPromptDraft(input: Sec425AnalysisPromptInput) {
  const sourcePromptInput = buildSecSourceBlockPromptInput({
    filingPackage: input.filing_package,
    parserOutput: input.parser_output as unknown as Record<string, unknown>,
    fallbackText: input.filing_excerpt,
    marketContext: input.market_context,
    maxBlocks: 2,
  });
  const sourceSelection = selectSec425AnalysisSourceBlocks(input.parser_output, input.router_result);
  const analysisSourceBlocks = sourceSelection.blocks.map((block) => ({
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
  }));
  return {
    key: SEC_425_ANALYSIS_PROMPT_KEY,
    version: SEC_425_ANALYSIS_PROMPT_VERSION,
    system: sec425AnalysisSystemPrompt,
    user: JSON.stringify({
      current_filing: sourcePromptInput.current_filing,
      cleaned_source_blocks: analysisSourceBlocks,
      analysis_source_block_count: analysisSourceBlocks.length,
      analysis_source_blocks_truncated: input.parser_output.raw.cleaned_source_blocks.length > analysisSourceBlocks.length,
      analysis_source_selection: {
        mode: sourceSelection.mode,
        router_selected_source_block_ids: input.router_result.selected_source_block_ids,
        selected_block_count: analysisSourceBlocks.length,
      },
      router_result: input.router_result,
      market_context: input.market_context || null,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_425_required_output",
        strict: true,
        schema: sec425RequiredOutputResponseSchema,
      },
    },
  };
}

function selectSec425AnalysisSourceBlocks(
  parserOutput: Sec425ParserOutput,
  routerResult: Sec425RouterDecision,
) {
  const blocks = parserOutput.raw.cleaned_source_blocks;
  const selectedIds = new Set(routerResult.selected_source_block_ids || []);
  const selectedIndexes = blocks
    .map((block, index) => selectedIds.has(block.block_id) ? index : -1)
    .filter((index) => index >= 0);

  if (selectedIndexes.length > 0) {
    const includedIndexes = new Set<number>();
    for (const index of selectedIndexes) {
      includedIndexes.add(index);
      for (const adjacentIndex of [index - 1, index + 1]) {
        const adjacent = blocks[adjacentIndex];
        const selected = blocks[index];
        if (adjacent && selected && adjacent.source_ref === selected.source_ref && !adjacent.is_boilerplate) {
          includedIndexes.add(adjacentIndex);
        }
      }
    }
    const materialDocumentIndexes = selectMaterialDocumentIndexes(blocks, routerResult);
    for (const index of materialDocumentIndexes) includedIndexes.add(index);
    const routeContextIndexes = selectRouteContextIndexes(blocks, routerResult, selectedIndexes);
    for (const index of routeContextIndexes) includedIndexes.add(index);
    return {
      mode: [...materialDocumentIndexes, ...routeContextIndexes].some((index) => !selectedIndexes.includes(index))
        ? "router_selected_with_material_document_context" as const
        : "router_selected_with_adjacent_context" as const,
      blocks: Array.from(includedIndexes)
        .sort((left, right) => left - right)
        .slice(0, 24)
        .map((index) => blocks[index]),
    };
  }

  const routerIds = new Set(parserOutput.raw.router_source_blocks.map((block) => block.block_id));
  const routerBackedBlocks = blocks.filter((block) => routerIds.has(block.block_id)).slice(0, 24);
  if (routerBackedBlocks.length > 0) {
    return {
      mode: "router_bundle_fallback" as const,
      blocks: routerBackedBlocks,
    };
  }

  return {
    mode: "bounded_source_fallback" as const,
    blocks: blocks.filter((block) => !block.is_boilerplate).slice(0, 24),
  };
}

function selectRouteContextIndexes(
  blocks: Sec425SourceBlock[],
  routerResult: Sec425RouterDecision,
  selectedIndexes: number[],
) {
  if (routerResult.route_case !== "shareholder_meeting_or_vote") return [];
  const selectedSourceRefs = new Set(
    selectedIndexes.map((index) => blocks[index]?.source_ref).filter(Boolean),
  );
  return blocks
    .map((block, index) => (
      selectedSourceRefs.has(block.source_ref) &&
      !block.is_boilerplate &&
      block.content_role === "meeting_notice"
        ? index
        : -1
    ))
    .filter((index) => index >= 0)
    .slice(0, 8);
}

function selectMaterialDocumentIndexes(
  blocks: Sec425SourceBlock[],
  routerResult: Sec425RouterDecision,
) {
  const requiredDocumentRoles = routerResult.route_case === "agreement_amendment"
    ? new Set(["agreement_amendment"])
    : null;
  const requiredContentRoles = routerResult.route_case === "agreement_amendment"
    ? new Set(["transaction_agreement"])
    : null;
  if (!requiredDocumentRoles) return [];

  const explicitDocumentIndexes = blocks
    .map((block, index) => (
      !block.is_boilerplate && requiredDocumentRoles.has(block.document_role) ? index : -1
    ))
    .filter((index) => index >= 0);
  const contentRoleIndexes = blocks
    .map((block, index) => (
      !block.is_boilerplate && requiredContentRoles?.has(block.content_role) ? index : -1
    ))
    .filter((index) => index >= 0);
  const candidates = explicitDocumentIndexes.length > 0
    ? explicitDocumentIndexes
    : contentRoleIndexes;

  return candidates
    .map((index) => ({ index, score: scoreMaterialAmendmentBlock(blocks[index]) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 12)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);
}

function scoreMaterialAmendmentBlock(block: Sec425SourceBlock) {
  const text = `${block.heading || ""}\n${block.text}`.trim();
  let score = Math.min(block.char_count / 1_000, 2);

  if (/\b(?:section|article|schedule|exhibit)\b[\s\S]{0,180}\b(?:amend(?:ed|ment)?|delete(?:d)?|replace(?:d)?|insert(?:ed)?|modify|modified)\b/i.test(text)) {
    score += 10;
  }
  if (/\b(?:is hereby amended|deleted in its entirety|replaced with the following|amended and restated)\b/i.test(text)) {
    score += 8;
  }
  if (/\b(?:consideration|purchase price|exchange ratio|liquidation preference|earnout|outside date|termination date|closing condition|financing condition|redemption|lock-?up)\b/i.test(text)) {
    score += 6;
  }
  if (/^\s*(?:whereas\b|now,? therefore\b|capitalized terms used\b)/i.test(block.text)) {
    score -= 8;
  }
  if (/^\s*(?:ex-?\d|exhibit\s+\d|\d+\s+[a-z0-9_.-]+\.html?)\s*$/i.test(block.text)) {
    score -= 12;
  }

  return score;
}

export function buildSec425DeterministicRoomResult(
  parserOutput: Sec425ParserOutput,
  routerDecision: Sec425RouterDecision,
): Sec425RoomResult | null {
  if (routerDecision.deterministic_stage !== "router" || routerDecision.needs_analysis_llm) return null;
  const displayPayload = buildSec425DisplayPayload(parserOutput, routerDecision);
  const ticker = {
    ticker: parserOutput.facts.primary_ticker,
    exchange: parserOutput.facts.exchange,
  };
  const archiveSummary = parserOutput.facts.deterministic_archive_reason ||
    routerDecision.routing_reason ||
    "No new material transaction term or status change is supported by this communication.";
  return {
    parser_output: parserOutput,
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "other",
      event_title: "Routine Form 425 communication with no new material terms",
      primary_ticker: ticker,
      tickers: ticker.ticker ? [ticker] : [],
      sector: null,
      industry_group: null,
      theme_group: "M&A communications",
      sub_theme: "Routine deal communication",
      score: routerDecision.score,
      score_reason: "The communication does not provide a new material transaction term, decision, or status change.",
      signal: "neutral",
      quick_take: "No new investor-relevant transaction change was disclosed.",
      summary: archiveSummary,
      why_it_matters: "No new investor-relevant transaction change is supported by the supplied communication.",
      current_changes: [],
      snapshot_title: "",
      snapshot_summary: "",
      snapshot_items: [],
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: parserOutput.calendarItems,
      confidence: "high",
      needs_human_review: false,
    },
    display_payload: displayPayload,
    fixture_expected: {
      expected_delivery_level: deliveryLevelFromScore(routerDecision.score),
      expected_impact: "low",
      market_context_needed: false,
      market_context_reason: null,
      market_context_fields: [],
      special_ui_needed: false,
      special_ui_reason: null,
      integration_notes: ["Router-confirmed routine repetition can be saved to company filing history without the analysis LLM."],
    },
  };
}

export function validateSec425RoomResult(result: Sec425RoomResult): string[] {
  const errors: string[] = [];
  const analysis = result.analysis_output;
  const fixtureExpected = result.fixture_expected;
  const snapshotItems = Array.isArray(analysis.snapshot_items) ? analysis.snapshot_items : [];
  const currentChanges = Array.isArray(analysis.current_changes) ? analysis.current_changes : [];
  const snapshotTitle = typeof analysis.snapshot_title === "string" ? analysis.snapshot_title : "";
  const snapshotSummary = typeof analysis.snapshot_summary === "string" ? analysis.snapshot_summary : "";

  if (result.parser_output.parserGroup !== "425") errors.push("parser_output.parserGroup must be 425");
  if (result.parser_output.formType !== "425") errors.push("parser_output.formType must be 425");
  if (!result.parser_output.isSupported) errors.push("parser_output.isSupported must be true");
  if (!isSec425ApprovedEventType(analysis.event_type)) errors.push(`analysis_output.event_type is not approved: ${String(analysis.event_type)}`);
  if (!SEC_425_MARKET_SCOPE_VALUES.includes(analysis.market_scope as Sec425MarketScope)) errors.push("analysis_output.market_scope is invalid");
  if (!SEC_425_SIGNAL_VALUES.includes(analysis.signal as Sec425Signal)) errors.push("analysis_output.signal is invalid");
  if (!SEC_425_CONFIDENCE_VALUES.includes(analysis.confidence as Sec425Confidence)) errors.push("analysis_output.confidence is invalid");
  if (!SEC_425_DISPLAY_TYPE_VALUES.includes(result.display_payload.display_type as Sec425DisplayType)) errors.push("display_payload.display_type is invalid");
  if (!Number.isInteger(analysis.score) || analysis.score < 0 || analysis.score > 100) errors.push("analysis_output.score must be an integer from 0 to 100");
  if (analysis.event_title.length > 90) errors.push("analysis_output.event_title must be under 90 characters");
  if (wordCount(analysis.quick_take) > 22) errors.push("analysis_output.quick_take must be under 22 words");
  if (wordCount(analysis.summary) > 100) errors.push("analysis_output.summary must be under 100 words");
  if (wordCount(analysis.why_it_matters) > 35) errors.push("analysis_output.why_it_matters must be under 35 words");
  if (wordCount(analysis.score_reason) > 32) errors.push("analysis_output.score_reason must be 32 words or fewer");
  if (currentChanges.length > 4) {
    errors.push("analysis_output.current_changes must contain no more than 4 items");
  }
  const validSourceBlockIds = new Set(result.parser_output.raw.cleaned_source_blocks.map((block) => block.block_id));
  if (currentChanges.some((item) => !validSourceBlockIds.has(item.source_block_id))) {
    errors.push("analysis_output.current_changes must cite valid original source_block_id values");
  }
  if (hasDuplicateCurrentChanges(currentChanges)) {
    errors.push("analysis_output.current_changes contains duplicate decision topics");
  }
  if (analysis.score >= 50 && "current_changes" in analysis && currentChanges.length === 0) {
    errors.push("material 425 analysis requires at least one source-backed current_changes item");
  }
  const visibleAnalysisText = buildVisibleAnalysisText(analysis);
  const uncoveredChanges = currentChanges.filter((item) => !isCurrentChangeCovered(item.result, visibleAnalysisText));
  if (uncoveredChanges.length > 0) {
    errors.push(`current_changes not reflected in Snapshot or Summary: ${uncoveredChanges.map((item) => item.topic).join(", ")}`);
  }
  if (analysis.key_evidence.length > 3) {
    errors.push("analysis_output.key_evidence must contain no more than 3 non-repetitive items");
  }
  if (analysis.key_evidence.some((item) => wordCount(item) > 28)) {
    errors.push("analysis_output.key_evidence items must be under 28 words");
  }
  if (analysis.key_evidence.some((item) => item.length > 180)) {
    errors.push("analysis_output.key_evidence items must be 180 characters or fewer");
  }
  if (hasDuplicateKeyEvidence(analysis.key_evidence)) {
    errors.push("analysis_output.key_evidence contains duplicate decision topics");
  }
  if (analysis.key_evidence.some((item) => isPromotionalKeyEvidence(item))) {
    errors.push("analysis_output.key_evidence contains promotional or non-verifiable claims");
  }
  if (analysis.what_to_watch_next.length > 3) {
    errors.push("analysis_output.what_to_watch_next must contain no more than 3 items");
  }
  if (analysis.what_to_watch_next.some((item) => item.length > 72)) {
    errors.push("analysis_output.what_to_watch_next items must be under 72 characters");
  }
  const specialSnapshotDisplay =
    result.display_payload.display_type === "spac_transaction_status" ||
    result.display_payload.display_type === "candidate_special";
  const hasSnapshotContractFields =
    "snapshot_title" in analysis ||
    "snapshot_summary" in analysis ||
    "snapshot_items" in analysis;
  if (specialSnapshotDisplay && (result.display_payload.display_type === "spac_transaction_status" || hasSnapshotContractFields)) {
    if (snapshotItems.length !== 4) {
      errors.push(`${result.display_payload.display_type} requires exactly 4 source-backed snapshot items`);
    }
    if (!snapshotTitle.trim() || !snapshotSummary.trim()) {
      errors.push(`${result.display_payload.display_type} requires snapshot_title and snapshot_summary`);
    }
    if (snapshotItems.some((item) => isMissingSnapshotValue(item.value))) {
      errors.push(`${result.display_payload.display_type} snapshot items must not contain missing-value placeholders`);
    }
  } else if (!specialSnapshotDisplay && (snapshotTitle || snapshotSummary || snapshotItems.length > 0)) {
    errors.push("generic display types must not include snapshot output");
  }
  if (analysis.score < 50 && (
    analysis.bullish_points.length > 0 ||
    analysis.bearish_points.length > 0 ||
    analysis.key_evidence.length > 0 ||
    analysis.what_to_watch_next.length > 0
  )) {
    errors.push("archive-score communications must not include point, evidence, or watch lists");
  }

  const derivedDeliveryLevel = deliveryLevelFromScore(analysis.score);
  if (derivedDeliveryLevel !== fixtureExpected.expected_delivery_level) {
    errors.push(`fixture_expected.expected_delivery_level must be derived from score; expected ${derivedDeliveryLevel} for score ${analysis.score}`);
  }
  if (result.display_payload.display_type === "candidate_special" && !fixtureExpected.special_ui_needed) {
    errors.push("candidate_special display payload must set fixture_expected.special_ui_needed true");
  }
  if (fixtureExpected.special_ui_needed && !fixtureExpected.special_ui_reason) {
    errors.push("special_ui_needed requires special_ui_reason");
  }
  if (fixtureExpected.market_context_needed && fixtureExpected.market_context_fields.length === 0) {
    errors.push("market_context_needed requires market_context_fields");
  }
  return errors;
}

function buildVisibleAnalysisText(analysis: Sec425AnalysisOutput) {
  const snapshotItems = Array.isArray(analysis.snapshot_items) ? analysis.snapshot_items : [];
  return [
    analysis.quick_take,
    analysis.summary,
    analysis.snapshot_title,
    analysis.snapshot_summary,
    ...snapshotItems.flatMap((item) => [item.label, item.value, item.note]),
  ].filter(Boolean).join(" ");
}

function isCurrentChangeCovered(result: string, visibleText: string) {
  const normalizedResult = normalizeCoverageText(result);
  const normalizedVisible = normalizeCoverageText(visibleText);
  if (!normalizedResult) return true;
  if (normalizedVisible.includes(normalizedResult)) return true;

  const resultMarkers = extractCoverageMarkers(result);
  if (resultMarkers.length > 0) {
    return resultMarkers.some((marker) => normalizedVisible.includes(normalizeCoverageText(marker)));
  }

  const resultTokens = coverageTokens(result);
  if (resultTokens.length === 0) return true;
  const visibleTokens = new Set(coverageTokens(visibleText));
  const matched = resultTokens.filter((token) => visibleTokens.has(token)).length;
  return matched >= Math.min(3, Math.max(1, Math.ceil(resultTokens.length * 0.6)));
}

function extractCoverageMarkers(value: string) {
  return uniqueStrings([
    ...(value.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?/gi) || []),
    ...(value.match(/(?:\$|US\$)\s?\d[\d,.]*(?:\s?(?:million|billion|M|B))?|\b\d+(?:\.\d+)?%\b/gi) || []),
  ]);
}

function normalizeCoverageText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9$%]+/g, " ").replace(/\s+/g, " ").trim();
}

function coverageTokens(value: string) {
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "by", "with", "from",
    "this", "that", "its", "is", "are", "was", "were", "be", "been", "transaction", "company", "filing",
  ]);
  return uniqueStrings(normalizeCoverageText(value).split(" ").filter((token) => token.length >= 3 && !stopWords.has(token)));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasDuplicateKeyEvidence(items: string[]) {
  const classified = items.map((item) => ({
    actionClass: keyEvidenceActionClass(item),
    tokens: new Set(coverageTokens(item)),
  }));
  for (let left = 0; left < classified.length; left += 1) {
    for (let right = left + 1; right < classified.length; right += 1) {
      if (!classified[left].actionClass || classified[left].actionClass !== classified[right].actionClass) continue;
      const union = new Set([...classified[left].tokens, ...classified[right].tokens]);
      const intersection = [...classified[left].tokens].filter((token) => classified[right].tokens.has(token));
      if (union.size > 0 && intersection.length / union.size >= 0.2) return true;
    }
  }
  return false;
}

function hasDuplicateCurrentChanges(items: Sec425AnalysisOutput["current_changes"]) {
  return hasDuplicateKeyEvidence(items.map((item) => `${item.topic}. ${item.change}. ${item.result}`));
}

function isPromotionalKeyEvidence(value: string) {
  if (extractCoverageMarkers(value).length > 0) return false;
  return !keyEvidenceActionClass(value);
}

function keyEvidenceActionClass(value: string) {
  if (/\b(?:reaffirm|recommend|support|oppose|reject|conclud|best interests|board commitment)\w*\b/i.test(value)) return "board_position";
  if (/\b(?:regulatory|approval|clearance|antitrust|HSR|condition satisfied)\b/i.test(value)) return "regulatory";
  if (/\b(?:vote|voting|stockholder approval|shareholder approval|adjourn|reconven)\w*\b/i.test(value)) return "vote";
  if (/\b(?:sign|execute|enter into|amend|extend|terminate|withdraw|revise|change)\w*\b/i.test(value)) return "agreement_change";
  if (/\b(?:consideration|offer price|per share|exchange ratio|enterprise value|equity value|cash-and-stock|mix of cash and (?:stock|shares)|cash and (?:common )?(?:stock|shares))\b/i.test(value)) return "economics";
  if (/\bmix of cash and\b.{0,80}\b(?:stock|shares)\b/i.test(value)) return "economics";
  if (/\b(?:close|closing|completed|completion|effective time)\b/i.test(value)) return "closing";
  if (/\b(?:financing|funding|PIPE|debt|credit facility|minimum cash|capital rais\w*|liquidity)\b/i.test(value)) return "financing";
  if (/\b(?:tender|redemption|ownership|shares outstanding|physical settlement|voting power)\b/i.test(value)) return "security_status";
  return "";
}

function isMissingSnapshotValue(value: string) {
  return /^(?:-|n\/?a|none|unknown|not\s+(?:disclosed|available|fixed)|symbol|ticker)$/i.test(value.trim());
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export const sec425AnalysisDebugFields = {
  router_prompt_key: SEC_425_ROUTER_PROMPT_KEY,
  router_prompt_version: SEC_425_ROUTER_PROMPT_VERSION,
  analysis_prompt_key: SEC_425_ANALYSIS_PROMPT_KEY,
  analysis_prompt_version: SEC_425_ANALYSIS_PROMPT_VERSION,
} as const;
