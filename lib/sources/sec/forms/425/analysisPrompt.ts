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
  type Sec425DisplayPayload,
  type Sec425DisplayType,
  type Sec425MarketScope,
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
export const SEC_425_ANALYSIS_PROMPT_VERSION = "v2";

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

export type Sec425AnalysisCase = (typeof SEC_425_ANALYSIS_CASE_VALUES)[number];

export type Sec425AnalysisPromptInput = Sec425RouterPromptInput & {
  router_result: Sec425RouterDecision;
  display_payload: Sec425DisplayPayload;
};

export const sec425AnalysisSystemPrompt = [
  "Write investor-facing analysis for one SEC Form 425 transaction communication and return only strict JSON matching the Required Output JSON shape.",
  "Use only cleaned_source_blocks, router result, related_transaction_context, and fixture-provided market_context. Do not call, request, or assume live market data.",
  "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same 425 family.",
  "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  `Use only these approved event types: ${SEC_425_APPROVED_EVENT_TYPES.join(", ")}.`,
  "Do not choose the event_type. Copy analysis_output.event_type exactly from router_result.event_type.",
  "Do not choose, create, or tune the detail UI. Treat supplied display_payload as read-only integration context.",
  "Return display_payload only when the response schema explicitly asks for it, and then copy it exactly. Runtime integration rebuilds it from the router result and parser output.",
  "Do not create new display types. The router/classifier and UI payload builder already selected display_type, display_version, and display data.",
  "Use router_result.routing_reason and cleaned_source_blocks as the evidence base.",
  "related_transaction_context contains compact analyses of already-saved prior transaction filings. Use it only as background for identifying what this Form 425 changes, confirms, repeats, or advances.",
  "Do not present a prior filing's terms as a new disclosure in the current Form 425. Current facts must come from cleaned_source_blocks; prior context may explain the baseline and transaction lifecycle.",
  "If related_transaction_context.status is not_found, do not invent parent terms. If it is multiple_candidates, use only facts consistently supported by the current filing and avoid claiming a definitive parent match.",
  "Do not ask for full raw filing text. If filing_excerpt is supplied, treat it as selected source snippets only.",
  "Do not add delivery_level as a model field. The fixture expected delivery level is derived from analysis_output.score: below 50 archive, 50 to 74 feed, 75 or above alert.",
  "Prioritize investor impact: deal economics, consideration changes, vote deadlines, litigation or regulatory risk, financing risk, and whether the communication changes previously known terms.",
  "Score the incremental investor impact of this Form 425, not the importance of the underlying transaction. Repeated merger context, prior S-4 effectiveness, or previously mailed proxy materials do not justify a higher score unless this filing adds a material change or a concrete new transaction milestone.",
  "An announcement of a future call, webcast, investor day, interview, or presentation without new economics, operating results, forecasts, vote results, regulatory decisions, financing terms, or closing status is normally feed-level rather than alert-level. The promised future discussion is not evidence that those facts were disclosed now.",
  "A filing that only says a social-media post, repost, interview, or other communication occurred, without supplying its substantive content, does not establish a new investor event. Score it below 50 and archive it unless another supplied source block independently provides a material update.",
  "For routine Form 425 materials that explicitly contain no new material information and no changed terms, keep event_type other, score below 50, neutral signal, high confidence, and needs_human_review false.",
  "For strategic transaction terms, explain consideration, transaction value, parties, closing timeline, and what to watch next.",
  "For a signed transaction agreement, prioritize the complete economic consideration disclosed for each security and any stated post-closing ownership. Do not substitute fractional-share cash cleanup, award treatment, or a defined-term fragment for the principal merger consideration.",
  "For SPAC business-combination terms, focus on target, valuation, PIPE, trust cash, redemptions, earnout shares, warrants, lock-up, support, and expected ticker only when source-backed.",
  "For tender or exchange offers, separate offer mechanics from advocacy, hostile language, and boilerplate tender-offer disclaimers.",
  "For shareholder vote cases, focus on meeting date, record date, adjournment, vote results, board recommendation, vote consequence, and next calendar item.",
  "For amendment cases, analyze only what the amendment changed; do not restate the parent agreement as a new event unless changed terms are evident.",
  "For legal_risk and financial_risk cases, explain how the issue could affect closing certainty, funding, dilution, or downside risk without overstating facts.",
  "For ipo_listing cases, explain only source-backed IPO/listing facts already selected by the router/classifier; keep ipo_kind in display_payload.data as traditional or spac and do not reclassify SPAC redemption, liquidation, or de-SPAC updates as IPO listings.",
  "Write no more than 3 key_evidence items. Usually select 2 or 3 of the strongest non-repetitive original-source facts, but use 1 when the filing supports only one distinct material fact. Do not restate the full summary.",
  "Write no more than 3 what_to_watch_next items. Each item must name a concrete transaction milestone, decision, deadline, or changed condition supported by the filing context.",
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
        event_title: { type: "string" },
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
        score_reason: { type: "string" },
        signal: { type: "string", enum: SEC_425_SIGNAL_VALUES },
        quick_take: { type: "string" },
        summary: { type: "string" },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: {
          type: "array",
          maxItems: 3,
          items: { type: "string", maxLength: 300 },
        },
        what_to_watch_next: {
          type: "array",
          maxItems: 3,
          items: { type: "string", maxLength: 240 },
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
  const filingContext = readRecord(input.filing_package.filing_context);
  const relatedTransactionContext = readRecord(filingContext?.related_transaction);
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
      display_payload: input.display_payload,
      related_transaction_context: relatedTransactionContext,
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
    return {
      mode: materialDocumentIndexes.some((index) => !selectedIndexes.includes(index))
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
      quick_take: archiveSummary,
      summary: archiveSummary,
      why_it_matters: "No new investor-relevant transaction change is supported by the supplied communication.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: routerDecision.evidence,
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

  if (result.parser_output.parserGroup !== "425") errors.push("parser_output.parserGroup must be 425");
  if (result.parser_output.formType !== "425") errors.push("parser_output.formType must be 425");
  if (!result.parser_output.isSupported) errors.push("parser_output.isSupported must be true");
  if (!isSec425ApprovedEventType(analysis.event_type)) errors.push(`analysis_output.event_type is not approved: ${String(analysis.event_type)}`);
  if (!SEC_425_MARKET_SCOPE_VALUES.includes(analysis.market_scope as Sec425MarketScope)) errors.push("analysis_output.market_scope is invalid");
  if (!SEC_425_SIGNAL_VALUES.includes(analysis.signal as Sec425Signal)) errors.push("analysis_output.signal is invalid");
  if (!SEC_425_CONFIDENCE_VALUES.includes(analysis.confidence as Sec425Confidence)) errors.push("analysis_output.confidence is invalid");
  if (!SEC_425_DISPLAY_TYPE_VALUES.includes(result.display_payload.display_type as Sec425DisplayType)) errors.push("display_payload.display_type is invalid");
  if (!Number.isInteger(analysis.score) || analysis.score < 0 || analysis.score > 100) errors.push("analysis_output.score must be an integer from 0 to 100");
  if (analysis.key_evidence.length > 3) {
    errors.push("analysis_output.key_evidence must contain no more than 3 non-repetitive items");
  }
  if (analysis.what_to_watch_next.length > 3) {
    errors.push("analysis_output.what_to_watch_next must contain no more than 3 items");
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

export const sec425AnalysisDebugFields = {
  router_prompt_key: SEC_425_ROUTER_PROMPT_KEY,
  router_prompt_version: SEC_425_ROUTER_PROMPT_VERSION,
  analysis_prompt_key: SEC_425_ANALYSIS_PROMPT_KEY,
  analysis_prompt_version: SEC_425_ANALYSIS_PROMPT_VERSION,
} as const;
