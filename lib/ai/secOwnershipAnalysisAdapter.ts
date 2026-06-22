import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import {
  buildDeterministicOwnershipResult,
  buildOwnershipDisplayPayload,
  type OwnershipParserOutput,
} from "@/lib/sources/sec/forms/ownership/parser";
import { buildOwnershipAnalysisPrompt } from "@/lib/sources/sec/forms/ownership/analysisPrompt";

export const SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY = "sec_ownership_analysis";
export const SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION = "v1";

export type SecOwnershipAnalysisPrompt = {
  key: string;
  version: string;
  system: string;
  user: string;
  responseFormat: {
    json_schema: Record<string, unknown>;
  };
};

export type SecOwnershipAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isOwnershipFilingInput(input: SecFilingAnalysisInput) {
  if (readSecFormAnalysisMode(input) === "ownership_direct_analysis") return Boolean(readOwnershipParserOutput(input));
  return Boolean(readOwnershipParserOutput(input));
}

export function buildDeterministicOwnershipAnalysis(input: SecFilingAnalysisInput): SecOwnershipAnalysisAdapterResult | null {
  const parserOutput = readOwnershipParserOutput(input);
  if (!parserOutput) return null;

  const deterministicResult = buildDeterministicOwnershipResult(parserOutput);
  if (!deterministicResult) return null;

  return adaptOwnershipRoomResultForAnalysis(deterministicResult, parserOutput, true);
}

export function buildSecOwnershipAnalysisPrompt(input: SecFilingAnalysisInput): SecOwnershipAnalysisPrompt {
  const parserOutput = readOwnershipParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC ownership parser output is missing from filing package");
  }
  return {
    key: SEC_OWNERSHIP_ANALYSIS_PROMPT_KEY,
    version: SEC_OWNERSHIP_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC ownership filing from cleaned source blocks only.",
      "There is no router LLM. Return strict JSON for the ownership Required Output JSON shape.",
      "Use filing_context.ownership when present as compact site-provided history; absence of filing_context must not fail analysis.",
      "Do not request live DB, FMP, SEC, or market-data lookups.",
      "Do not include full raw XML/source text in the analysis output.",
      "Do not use parser-generated facts, signals, route hints, event labels, display labels, or safety classifications as analysis authority.",
    ].join("\n"),
    user: `${buildOwnershipAnalysisPrompt(parserOutput)}

Site-provided filing_context, optional:
${JSON.stringify(readFilingContext(input), null, 2)}

Integration addendum:
- Do not rewrite parser_output in runtime output. Integration preserves the actual parser output from the filing package.
- For archive scores, use analysis_output.archive_summary when helpful; otherwise analysis_output.summary will be copied to archive_summary for archive display.`,
    responseFormat: {
      json_schema: {
        name: "sec_ownership_required_output",
        strict: false,
        schema: ownershipRequiredOutputJsonSchema,
      },
    },
  };
}

export function adaptOwnershipPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecOwnershipAnalysisAdapterResult {
  return adaptOwnershipRoomResultForAnalysis(value, readOwnershipParserOutput(input));
}

function readOwnershipParserOutput(input: SecFilingAnalysisInput): OwnershipParserOutput | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const ownership = readRecord(hardParsers?.ownership);
  return ownership ? (ownership as unknown as OwnershipParserOutput) : null;
}

function readSecFormAnalysisMode(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const adapter = readRecord(filingPackage?.form_adapter);
  return stringValue(adapter?.analysisMode);
}

function readFilingContext(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  return readRecord(filingPackage?.filing_context) || null;
}

function adaptOwnershipRoomResultForAnalysis(
  value: unknown,
  parserOutput: OwnershipParserOutput | null,
  isDeterministic = false,
): SecOwnershipAnalysisAdapterResult {
  const requiredOutput = normalizeOwnershipRequiredOutput(value, parserOutput, isDeterministic);
  if (!requiredOutput) {
    return {
      ok: false,
      error: "SEC ownership result did not contain Required Output JSON fields",
    };
  }

  if (!isDeterministic) {
    const displayPayloadError = validateOwnershipRuntimeDisplayPayload(requiredOutput.display_payload);
    if (displayPayloadError) {
      return {
        ok: false,
        error: displayPayloadError,
      };
    }
  }

  const adapted = adaptSecFormRoomOutputForIngest(requiredOutput);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC ownership Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: ownershipAdapterOutputToAnalysis(adapted.value),
  };
}

function normalizeOwnershipRequiredOutput(
  value: unknown,
  parserOutput: OwnershipParserOutput | null,
  isDeterministic: boolean,
) {
  const root = readRecord(value);
  if (!root) return null;

  const analysisOutput = readRecord(root.analysis_output);
  const parserDisplayPayload = isDeterministic && parserOutput
    ? (buildOwnershipDisplayPayload(parserOutput) as unknown as Record<string, unknown>)
    : null;
  const llmDisplayPayload = readRecord(root.display_payload);
  const displayPayload =
    isDeterministic
      ? normalizeOwnershipRuntimeDisplayPayload(llmDisplayPayload, parserDisplayPayload)
      : llmDisplayPayload;
  const outputParser = (parserOutput as unknown as Record<string, unknown> | null) || readRecord(root.parser_output);

  if (!analysisOutput || !displayPayload || !outputParser) return null;

  return {
    parser_output: outputParser,
    analysis_output: analysisOutput,
    display_payload: normalizeOwnershipDisplayPayloadForRuntime(displayPayload),
  };
}

function normalizeOwnershipDisplayPayloadForRuntime(displayPayload: Record<string, unknown>) {
  return {
    ...displayPayload,
    data: readRecord(displayPayload.data) || {},
    evidence: arrayValue(displayPayload.evidence),
    notes: arrayValue(displayPayload.notes),
  };
}

function normalizeOwnershipRuntimeDisplayPayload(
  llmDisplayPayload: Record<string, unknown> | null,
  parserDisplayPayload: Record<string, unknown> | null,
) {
  if (!llmDisplayPayload) return parserDisplayPayload;
  if (!parserDisplayPayload) return llmDisplayPayload;

  const llmData = readRecord(llmDisplayPayload.data) || {};
  const parserData = readRecord(parserDisplayPayload.data) || {};
  if (hasOwnershipTransactionDisplayData(llmData)) return llmDisplayPayload;

  return {
    ...parserDisplayPayload,
    display_type: stringValue(llmDisplayPayload.display_type) || parserDisplayPayload.display_type,
    data: {
      ...parserData,
      ...pickOwnershipDisplayCopyFields(llmData),
    },
    evidence: arrayValue(llmDisplayPayload.evidence).length
      ? arrayValue(llmDisplayPayload.evidence)
      : arrayValue(parserDisplayPayload.evidence),
    notes: arrayValue(llmDisplayPayload.notes).length
      ? arrayValue(llmDisplayPayload.notes)
      : arrayValue(parserDisplayPayload.notes),
  };
}

function hasOwnershipTransactionDisplayData(data: Record<string, unknown>) {
  return Boolean(readRecord(data.form4) || readRecord(data.form144));
}

function validateOwnershipRuntimeDisplayPayload(displayPayload: Record<string, unknown>) {
  const data = readRecord(displayPayload.data);
  if (!data || Object.keys(data).length === 0) {
    return "SEC ownership display_payload.data must be filled by the analysis LLM";
  }
  if (!hasOwnershipTransactionDisplayData(data) && !stringValue(data.filing_summary)) {
    return "SEC ownership display_payload.data must include LLM-authored ownership details or filing_summary";
  }
  return "";
}

function pickOwnershipDisplayCopyFields(data: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of [
    "filing_summary",
    "summary",
    "quick_take",
    "score_reason",
    "what_to_watch_next",
    "key_evidence",
  ]) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") result[key] = data[key];
  }
  return result;
}

function ownershipAdapterOutputToAnalysis(value: SecFormRoomAdapterOutput) {
  const score = clampSecScore(numberValue(value.analysis_output.score) ?? 0);
  const archiveSummary =
    nullableSecString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableSecString(value.analysis_output.summary) : null);

  return {
    ...value.analysis_output,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
  };
}

function clampSecScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function nullableSecString(value: unknown) {
  const text = stringValue(value);
  return text || null;
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

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

const ownershipRequiredOutputJsonSchema = {
  type: "object",
  additionalProperties: true,
  required: ["analysis_output", "display_payload"],
  properties: {
    parser_output: {
      type: "object",
      additionalProperties: true,
    },
    analysis_output: {
      type: "object",
      additionalProperties: true,
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
        market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
        event_type: {
          type: "string",
          enum: [
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
          ],
        },
        event_title: { type: "string" },
        primary_ticker: {
          type: ["object", "null"],
          additionalProperties: true,
        },
        tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string" },
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string" },
        summary: { type: "string" },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: { type: "array", items: { type: "string" } },
        what_to_watch_next: { type: "array", items: { type: "string" } },
        related_tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        archive_summary: { type: ["string", "null"] },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "data", "evidence", "notes"],
      properties: {
        display_type: { type: "string", enum: ["generic", "offering_terms", "candidate_special"] },
        data: {
          type: "object",
          additionalProperties: true,
          required: ["filing_summary"],
          properties: {
            filing_summary: { type: "string" },
            form4: { type: ["object", "null"], additionalProperties: true },
            form144: { type: ["object", "null"], additionalProperties: true },
          },
        },
        evidence: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
        notes: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
      },
    },
  },
} as const;
