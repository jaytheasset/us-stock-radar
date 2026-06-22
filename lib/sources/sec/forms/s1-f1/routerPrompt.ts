import {
  APPROVED_SEC_EVENT_TYPES,
  type S1F1ParserOutput,
  type S1F1RouterDecision,
} from "./types.ts";

const DISPLAY_VERSION = "s1-f1-display-v1";

export function buildS1F1LlmSourceInput(parserOutput: S1F1ParserOutput): Record<string, unknown> {
  return {
    parserVersion: parserOutput.parserVersion,
    parserGroup: parserOutput.parserGroup,
    accessionNumber: parserOutput.accessionNumber,
    source_inventory: {
      sourceTextLength: parserOutput.raw.sourceTextLength,
      attachmentNames: parserOutput.raw.attachmentNames,
      documentCounts: parserOutput.raw.documentFilter
        ? {
            documentCount: parserOutput.raw.documentFilter.documentCount,
            bodyCount: parserOutput.raw.documentFilter.bodyCount,
            importantExhibitCount: parserOutput.raw.documentFilter.importantExhibitCount,
            noiseCount: parserOutput.raw.documentFilter.noiseCount,
            mainDocument: parserOutput.raw.documentFilter.mainDocument ?? null,
          }
        : null,
    },
    attachment_inventory: parserOutput.raw.exhibitExtractions?.attachedExhibits.map((item) => ({
      type: item.type,
      filename: item.filename,
      description: item.description,
      sourceTextAvailable: item.sourceTextAvailable,
      textLength: item.textLength,
    })) ?? [],
    parent_filing_context: parserOutput.raw.parentFilingContext ?? null,
    cleaned_source_blocks: parserOutput.raw.cleanedSourceBlocks ?? [],
    parser_warnings: parserOutput.warnings,
  };
}

export function selectPreliminaryS1F1Route(parserOutput: S1F1ParserOutput): S1F1RouterDecision {
  return {
    event_type: "other",
    preliminary_action: "send_to_analysis_llm",
    reasoning: "Ambiguous S-1/F-1 filings must be classified by the router LLM from cleaned source blocks, not parser-generated labels.",
    confidence: "low",
    market_context_needed: false,
    market_context_reason: null,
    market_context_fields: [],
    display_type: "generic",
    display_version: DISPLAY_VERSION,
    analysis_llm_needed: true,
  };
}

export function buildS1F1RouterPrompt(parserOutput: S1F1ParserOutput): string {
  const preliminaryRoute = selectPreliminaryS1F1Route(parserOutput);
  return [
    "You are the SEC S-1/F-1 router for the S-1 / F-1, S-1/A / F-1/A form room.",
    "Use only the compact router/classifier input JSON and any market_context fixture already present in it.",
    "Do not call live market APIs, live DB, ingest, alert delivery, common code, or UI code.",
    "Do not use parser-generated event labels, offering kind flags, signal ranks, or extracted fact labels as classification authority.",
    "Use cleaned source text blocks, preserved tables, source inventory, attachment inventory, and parser warnings.",
    "The parser has only removed noise and preserved relevant source chunks. You must read the source chunks and classify the filing yourself.",
    "Amendments are update filings. Do not treat an S-1/A or F-1/A as a new market event unless the source chunks show a material change.",
    "POS AM and Rule 462(b) MEF filings are boundary variants in this room. Keep them distinct from ordinary S-1/F-1 base registrations and pre-effective amendments.",
    "Do not finish S-1/F-1 filings deterministically. Even low-impact amendments should be routed from source chunks.",
    "Choose exactly one approved event_type.",
    "Choose display_type and display_version for the detail UI when needed. Do not leave UI template decisions to the analysis LLM.",
    "Use spac_transaction_status only when the source chunks show SPAC/de-SPAC transaction-status facts such as target, redemption, closing condition, minimum cash, expected closing, or ticker change.",
    "Do not use spac_transaction_status for plain blank-check IPO registration or ordinary IPO/resale filings.",
    "Return whether analysis_llm_needed is true. The analysis LLM writes investor-facing copy only.",
    "",
    "Approved event_type values, and no others:",
    APPROVED_SEC_EVENT_TYPES.map((eventType) => `- ${eventType}`).join("\n"),
    "",
    "Choose one event_type, one preliminary_action, and one display_type.",
    "For this form room, preliminary_action should be send_to_analysis_llm unless a future shared runtime explicitly supplies a reviewed non-parser override.",
    "",
    "Return JSON only in this shape:",
    JSON.stringify(
      {
        event_type: preliminaryRoute.event_type,
        preliminary_action: preliminaryRoute.preliminary_action,
        reasoning: "string",
        confidence: "high | medium | low",
        market_context_needed: preliminaryRoute.market_context_needed,
        market_context_reason: preliminaryRoute.market_context_reason,
        market_context_fields: preliminaryRoute.market_context_fields,
        display_type: preliminaryRoute.display_type,
        display_version: preliminaryRoute.display_version,
        analysis_llm_needed: preliminaryRoute.analysis_llm_needed,
      },
      null,
      2,
    ),
    "",
    "Compact router/classifier input:",
    JSON.stringify(buildS1F1LlmSourceInput(parserOutput), null, 2),
  ].join("\n");
}
