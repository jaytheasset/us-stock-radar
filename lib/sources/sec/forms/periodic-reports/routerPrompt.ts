import type { PeriodicParserOutput } from "./types";

export const SEC_PERIODIC_REPORTS_ROUTER_PROMPT_KEY = "sec_periodic_reports_router_draft";
export const SEC_PERIODIC_REPORTS_ROUTER_PROMPT_VERSION = "v3";
export const SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION = "periodic_report_display_v1";

const PERIODIC_REPORTS_FORM_SCOPE = "10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A";
const APPROVED_SEC_EVENT_TYPES = [
  "listing_risk",
  "dilution_risk",
  "ipo_listing",
  "earnings",
  "sales_performance",
  "product_update",
  "leadership_governance",
  "insider_ownership",
  "shareholder_vote",
  "strategic_transaction",
  "financial_risk",
  "legal_risk",
  "dividends",
  "capital_return",
  "fda_clinical",
  "other",
] as const;

export const SEC_PERIODIC_REPORTS_ROUTER_ACTION_VALUES = ["archive", "feed", "alert"] as const;
export const SEC_PERIODIC_REPORTS_ROUTER_DELIVERY_LEVEL_VALUES = SEC_PERIODIC_REPORTS_ROUTER_ACTION_VALUES;
export const SEC_PERIODIC_REPORTS_ROUTER_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SEC_PERIODIC_REPORTS_ROUTER_DISPLAY_TYPES = ["generic", "offering_terms", "candidate_special"] as const;
export const SEC_PERIODIC_REPORTS_ROUTER_CASE_VALUES = [
  "routine_periodic_report",
  "earnings_results",
  "sales_performance",
  "going_concern_or_liquidity",
  "legal_or_regulatory_risk",
  "dividend_or_capital_return",
  "product_or_business_update",
  "fda_or_clinical_update",
  "leadership_or_governance",
  "strategic_transaction",
  "ipo_listing",
  "listing_risk",
  "routine_amendment_no_llm",
  "material_amendment",
  "needs_human_review",
  "other",
] as const;

export type SecPeriodicReportsRouterPromptInput = {
  filing_package?: Record<string, unknown>;
  parser_output: PeriodicParserOutput;
  filing_excerpt?: string | null;
  market_context?: Record<string, unknown> | null;
  parent_filing_context?: Record<string, unknown> | null;
};

export type SecPeriodicReportsSourceBlock = {
  block_type: string;
  label: string | null;
  source: string | null;
  text: string;
};

export type SecPeriodicReportsSourceBlockPromptInput = {
  cleaned_source_blocks: SecPeriodicReportsSourceBlock[];
};

export const secPeriodicReportsRouterSystemPrompt = [
  `Route one SEC periodic report filing in scope: ${PERIODIC_REPORTS_FORM_SCOPE}.`,
  "Return only strict JSON matching the response schema. Do not call live APIs, live FMP, live databases, ingest, alerts, UI, or shared services.",
  "Use only cleaned_source_blocks, fixture market_context source blocks, and fixture parent_filing_context source blocks supplied in the user message.",
  "Do not use parser-generated facts, signals, route hints, deterministic classification, extraction summaries, event labels, display labels, or investment labels as classification authority.",
  "Do not request or rely on full raw filing text.",
  "Choose exactly one event_type from the approved 16 values. Do not invent or rename event types.",
  "Choose exactly one existing display_type and display_version for the UI payload builder. Do not create new display types.",
  "Use ipo_listing for traditional IPOs, SPAC IPOs, direct listings, IPO pricing, first trading/listing dates, and registration effectiveness tied to a new public listing.",
  "Do not use ipo_listing for ordinary resale registration, shelf offerings, ATM/offering dilution, already-listed issuer resales, or post-closing business updates.",
  "For IPO/listing detail, do not split event_type. Return ipo_kind as traditional or spac; use null when event_type is not ipo_listing or the source does not support the kind.",
  "SPAC redemption, liquidation, and de-SPAC cases are not automatically ipo_listing. Classify by the main event: listing_risk, shareholder_vote, strategic_transaction, financial_risk, or ipo_listing only when IPO/listing itself is dominant.",
  "The UI payload builder, not analysis LLM, builds display_payload.data after classifier output.",
  "Return whether analysis LLM is needed. Routine deterministic parser archive cases do not need analysis LLM.",
  "Periodic reports can bundle many disclosures. Route to the dominant investor-relevant event, not simply the first fact found.",
  "Use earnings for broad quarterly or annual operating results when revenue and profit/loss are the main update.",
  "Use sales_performance when revenue, unit sales, bookings, subscribers, or customer demand is the dominant surprise or deterioration.",
  "Use financial_risk for going-concern language, severe liquidity pressure, covenant/default risk, financing runway problems, or debt stress.",
  "Use legal_risk for material litigation, investigations, subpoenas, enforcement actions, or regulatory proceedings.",
  "Use dividends for dividend declarations or changes. Use capital_return for share repurchase authorizations or meaningful buyback activity.",
  "Use product_update, fda_clinical, leadership_governance, listing_risk, or strategic_transaction only when those facts dominate the periodic report impact.",
  "For 10-K/A, 10-Q/A, and 20-F/A, treat the filing as an update, not automatically as a new event.",
  "Deterministic archive handling is allowed only for mechanically clear routine amendment source text. Otherwise route from cleaned_source_blocks.",
  "If an amendment changes financial statements, going-concern language, legal proceedings, controls, or other material facts, route only the changed matter and mark material_amendment.",
  "Use fixture market context only when the parser or excerpt gives a reason to compare size or severity. Never request or assume live market data.",
  "Score bands are fixed and delivery is derived from preliminary_score: score below 50 derived_delivery_level archive; score 50 to 74 feed; score 75 or above alert.",
  "When evidence is ambiguous, choose needs_human_review, lower confidence, and avoid alert-level scoring unless evidence is concrete.",
].join("\n");

export const secPeriodicReportsRouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_scope",
    "source_form_type",
    "event_type",
    "display_type",
    "display_version",
    "ipo_kind",
    "route_case",
    "preliminary_score",
    "derived_delivery_level",
    "signal",
    "confidence",
    "routing_reason",
    "evidence",
    "source_blocks_used",
    "market_context_needed",
    "market_context_fields",
    "analysis_llm_needed",
    "needs_human_review",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_scope: { type: "string", enum: [PERIODIC_REPORTS_FORM_SCOPE] },
    source_form_type: { type: "string", enum: ["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"] },
    event_type: { type: "string", enum: APPROVED_SEC_EVENT_TYPES },
    display_type: { type: "string", enum: SEC_PERIODIC_REPORTS_ROUTER_DISPLAY_TYPES },
    display_version: { type: "string", enum: [SEC_PERIODIC_REPORTS_DISPLAY_PAYLOAD_VERSION] },
    ipo_kind: { type: ["string", "null"], enum: ["traditional", "spac", null] },
    route_case: { type: "string", enum: SEC_PERIODIC_REPORTS_ROUTER_CASE_VALUES },
    preliminary_score: { type: "integer", minimum: 0, maximum: 100 },
    derived_delivery_level: { type: "string", enum: SEC_PERIODIC_REPORTS_ROUTER_DELIVERY_LEVEL_VALUES },
    signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
    confidence: { type: "string", enum: SEC_PERIODIC_REPORTS_ROUTER_CONFIDENCE_VALUES },
    routing_reason: { type: "string" },
    evidence: { type: "array", items: { type: "string" } },
    source_blocks_used: { type: "array", items: { type: "string" } },
    market_context_needed: { type: "boolean" },
    market_context_fields: { type: "array", items: { type: "string" } },
    analysis_llm_needed: { type: "boolean" },
    needs_human_review: { type: "boolean" },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version"],
      properties: {
        parser_version: { type: ["string", "null"] },
        router_prompt_key: { type: "string" },
        router_prompt_version: { type: "string" },
      },
    },
  },
} as const;

export function buildSecPeriodicReportsRouterPromptDraft(input: SecPeriodicReportsRouterPromptInput) {
  const userPayload = buildSecPeriodicReportsSourceBlockPromptInput(input);
  return {
    key: SEC_PERIODIC_REPORTS_ROUTER_PROMPT_KEY,
    version: SEC_PERIODIC_REPORTS_ROUTER_PROMPT_VERSION,
    system: secPeriodicReportsRouterSystemPrompt,
    user: JSON.stringify(userPayload),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_periodic_reports_router",
        strict: true,
        schema: secPeriodicReportsRouterResponseSchema,
      },
    },
  };
}

export function buildSecPeriodicReportsSourceBlockPromptInput(
  input: SecPeriodicReportsRouterPromptInput,
): SecPeriodicReportsSourceBlockPromptInput {
  const parserOutput = input.parser_output;
  const facts = parserOutput.facts;
  const raw = parserOutput.raw || {};
  const normalized = toRecord(raw.normalized_primary_document) || {};
  const blocks: SecPeriodicReportsSourceBlock[] = [];

  addBlock(blocks, {
    block_type: "filing_metadata",
    label: "SEC filing metadata",
    source: "filing_package",
    text: compactJson({
      parserVersion: parserOutput.parserVersion,
      parserGroup: parserOutput.parserGroup,
      formType: parserOutput.formType,
      accessionNumber: parserOutput.accessionNumber,
      isSupported: parserOutput.isSupported,
      companyName: facts.companyName,
      primaryTicker: facts.primaryTicker,
      exchange: facts.exchange,
      reportingPeriod: facts.reportingPeriod,
      fiscalYear: facts.fiscalYear,
      fiscalQuarter: facts.fiscalQuarter,
      source_url: nullableString(raw.source_url),
      published_at: nullableString(raw.published_at),
      primary_document_url: nullableString(toRecord(input.filing_package)?.primary_document_url),
    }),
  });

  addInventoryBlocks(blocks, parserOutput);
  addPrimaryDocumentBlocks(blocks, normalized);
  addTableBlocks(blocks, normalized);
  addXbrlBlocks(blocks, parserOutput);
  addWarningBlocks(blocks, parserOutput.warnings);

  if (input.parent_filing_context) {
    addBlock(blocks, {
      block_type: "parent_filing_context",
      label: "Site-provided parent filing context",
      source: "integration",
      text: compactJson(input.parent_filing_context),
    });
  }

  if (input.market_context) {
    addBlock(blocks, {
      block_type: "site_market_context",
      label: "Site-provided market context",
      source: "integration",
      text: compactJson(input.market_context),
    });
  }

  if (!hasSourceTextBlock(blocks)) {
    addBlock(blocks, {
      block_type: "source_excerpt",
      label: "Fallback filing excerpt",
      source: "filing_excerpt",
      text: nullableString(input.filing_excerpt),
    });
  }

  return {
    cleaned_source_blocks: dedupeBlocks(blocks).slice(0, 60),
  };
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function addInventoryBlocks(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  const sourcePackage = parserOutput.facts.sourcePackage;

  addBlock(blocks, {
    block_type: "document_inventory",
    label: "Document inventory",
    source: "parser_source_inventory",
    text: compactJson(
      sourcePackage.documents.slice(0, 40).map((document) => ({
        sequence: document.sequence,
        type: document.type,
        description: document.description,
        filename: document.filename,
        url: document.url,
        isPrimary: document.isPrimary,
        hasText: document.hasText,
        textCharCount: document.textCharCount,
        textTruncated: document.textTruncated,
        isInlineXbrl: document.isInlineXbrl,
        isMachineReadableXbrl: document.isMachineReadableXbrl,
      })),
    ),
  });

  addBlock(blocks, {
    block_type: "attachment_inventory",
    label: "Attachment inventory",
    source: "parser_source_inventory",
    text: compactJson(
      sourcePackage.attachmentTexts.slice(0, 30).map((attachment) => ({
        sequence: attachment.sequence,
        type: attachment.type,
        description: attachment.description,
        filename: attachment.filename,
        url: attachment.url,
        textCharCount: attachment.textCharCount,
        textTruncated: attachment.textTruncated,
        includedInSourceText: attachment.includedInSourceText,
      })),
    ),
  });
}

function addPrimaryDocumentBlocks(blocks: SecPeriodicReportsSourceBlock[], normalized: Record<string, unknown> | null) {
  recordArray(normalized?.blocks)
    .filter((block) => !["empty_decorative", "signature"].includes(nullableString(block.kind)))
    .filter((block) => Boolean(nullableString(block.text)))
    .slice(0, 28)
    .forEach((block, index) => {
      addBlock(blocks, {
        block_type: nullableString(block.kind) === "table" ? "table_source_block" : "cleaned_source_block",
        label: `Primary document block ${index + 1}`,
        source: "normalized_primary_document.blocks",
        text: nullableString(block.text),
      });
    });
}

function addTableBlocks(blocks: SecPeriodicReportsSourceBlock[], normalized: Record<string, unknown> | null) {
  for (const [index, table] of recordArray(normalized?.tables).slice(0, 12).entries()) {
    const rows = recordArray(table.rows)
      .slice(0, 12)
      .map((row) => nullableString(row.text))
      .filter(Boolean);
    addBlock(blocks, {
      block_type: "table_source_block",
      label: nullableString(table.caption) || `Extracted table ${index + 1}`,
      source: "normalized_primary_document.tables",
      text: [
        nullableString(table.caption),
        nullableString(table.unitHint) ? `Unit: ${nullableString(table.unitHint)}` : "",
        nullableString(table.text),
        rows.length ? rows.join("\n") : "",
        ...stringArray(table.footnotes).slice(0, 4),
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }
}

function addXbrlBlocks(blocks: SecPeriodicReportsSourceBlock[], parserOutput: PeriodicParserOutput) {
  addBlock(blocks, {
    block_type: "xbrl_source_data",
    label: "Selected XBRL source data",
    source: "source_package.xbrlFacts",
    text: compactJson(
      parserOutput.facts.sourcePackage.xbrlFacts.slice(0, 60).map((fact) => ({
        name: fact.name,
        label: fact.label,
        value: fact.value,
        unitRef: fact.unitRef,
        period: fact.period,
        statement: fact.statement,
        sourceDocument: fact.sourceDocument,
      })),
    ),
  });
}

function addWarningBlocks(blocks: SecPeriodicReportsSourceBlock[], warnings: string[]) {
  addBlock(blocks, {
    block_type: "parser_warnings",
    label: "Parser warnings",
    source: "parser",
    text: warnings.join("\n"),
  });
}

function hasSourceTextBlock(blocks: SecPeriodicReportsSourceBlock[]) {
  return blocks.some((block) => ["cleaned_source_block", "table_source_block", "xbrl_source_data", "source_excerpt"].includes(block.block_type));
}

function addBlock(blocks: SecPeriodicReportsSourceBlock[], block: SecPeriodicReportsSourceBlock) {
  const text = compactText(block.text, 5000);
  if (!text || text === "[]" || text === "{}") return;
  blocks.push({
    block_type: block.block_type,
    label: block.label,
    source: block.source,
    text,
  });
}

function dedupeBlocks(blocks: SecPeriodicReportsSourceBlock[]) {
  const seen = new Set<string>();
  const deduped: SecPeriodicReportsSourceBlock[] = [];
  for (const block of blocks) {
    const key = `${block.block_type}:${block.label || ""}:${block.text.slice(0, 240)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(block);
  }
  return deduped;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(nullableString).filter(Boolean) : [];
}

function nullableString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function compactText(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}
