import {
  CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
  CORPORATE_ACTION_EVENT_KINDS,
  CORPORATE_ACTION_STAGE_VOCABULARY,
  CORPORATE_ACTION_STAGES,
  type CorporateActionAnalyzerInput,
} from "../monitor/corporateActionCanonicalFacts.ts";

export const CORPORATE_ACTION_CANONICAL_ANALYSIS_PROMPT_KEY = "corporate_action_canonical_analyzer";

export const CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    applicable: { type: "boolean" },
    event_kind: { type: "string", enum: CORPORATE_ACTION_EVENT_KINDS },
    action_stage: { type: "string", enum: CORPORATE_ACTION_STAGES },
    effective_date: dateAvailabilitySchema(),
    ratio: {
      anyOf: [
        unavailableSchema(),
        {
          type: "object",
          properties: {
            availability: { type: "string", enum: ["available"] },
            old_shares: { type: "string" },
            new_shares: { type: "string" },
          },
          required: ["availability", "old_shares", "new_shares"],
        },
      ],
    },
    source_ref: { type: "string" },
    evidence: { type: "string", nullable: true },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    as_of: dateAvailabilitySchema(),
  },
  required: ["applicable"],
} as const;

function unavailableSchema() {
  return {
    type: "object",
    properties: {
      availability: { type: "string", enum: ["unavailable"] },
    },
    required: ["availability"],
  } as const;
}

function dateAvailabilitySchema() {
  return {
    anyOf: [
      unavailableSchema(),
      {
        type: "object",
        properties: {
          availability: { type: "string", enum: ["available"] },
          value: { type: "string", format: "date" },
        },
        required: ["availability", "value"],
      },
    ],
  } as const;
}

export const CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT = [
  "You are the Corporate Action Canonical Analyzer. Analyze the complete stored source documents and decide whether this source semantically establishes a reverse stock split.",
  "The source_documents are the only semantic truth. Source family, title, event_type, parser values, calendar values, routing signals, ticker metadata, and prior AI output never prove applicability or any fact.",
  "Return applicable false for mergers, spin-offs, dividends, forward splits, listing actions without a reverse split, general capital-structure discussion, proposals that do not establish a reverse split, and every other non-reverse-split source.",
  "The LLM alone decides applicability, action stage, whether a date is the reverse-split effective date, and which source-stated ratio components apply. Do not use keyword matching or isolated-word logic; analyze the full source meaning.",
  `action_stage exact meanings: ${CORPORATE_ACTION_STAGE_VOCABULARY.map((entry) => `${entry.value} = ${entry.description}`).join("; ")}.`,
  "Choose the most specific stage established at the stored source's published_at or source-stated as-of time. Never upgrade a historical notice because its future date has passed by today's clock.",
  "Do not decide a stage from one word. A confirmed effective date that was future at the source time is scheduled even if the source is an official exchange notice or also describes earlier approvals. Use effective only when the source establishes that the action had already taken effect at source time or is itself a contemporaneous notice of an action taking effect.",
  "For a non-applicable source return exactly {\"applicable\":false}. Failure, uncertainty about transport, or missing source text is not not-applicable.",
  `For an applicable source return exactly these keys: applicable, event_kind, action_stage, effective_date, ratio, source_ref, evidence, confidence, as_of. applicable is true and event_kind is exactly ${CORPORATE_ACTION_EVENT_KINDS[0]}.`,
  "effective_date is exactly {availability:unavailable} when the source does not establish the reverse-split effective date, otherwise {availability:available,value:YYYY-MM-DD}. Do not substitute publication, record, marketplace, payment, approval, or trading dates.",
  "ratio is exactly {availability:unavailable} when the source does not establish a ratio. Otherwise return {availability:available,old_shares:string,new_shares:string}, where old_shares and new_shares are positive plain decimal strings representing the source-backed old and new share quantities. For a 1-for-20 reverse split return old_shares 20 and new_shares 1. Application code alone performs division into old_shares_per_new_share.",
  "Use exactly one supplied source_ref that supports applicability and every available semantic value. Never invent, alter, concatenate, or copy a label in place of source_ref.",
  "evidence is one shortest useful contiguous verbatim span from the cited source_document.text, or null only when no compact span can be safely copied. Do not paraphrase, normalize whitespace, join passages, or use another document.",
  "confidence is exactly high, medium, or low and reflects semantic certainty from the cited stored source, not confidence in parser or prior AI context.",
  "as_of is exactly {availability:unavailable} when no source-backed observation or effective basis date applies, otherwise {availability:available,value:YYYY-MM-DD}. Do not copy another date merely to populate it.",
  "Return one JSON object only, with no markdown, prose, wrapper, comments, empty strings, extra keys, fallback values, or repairs.",
].join("\n");

export function buildCorporateActionCanonicalAnalysisPrompt(input: CorporateActionAnalyzerInput) {
  return {
    key: CORPORATE_ACTION_CANONICAL_ANALYSIS_PROMPT_KEY,
    version: CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
    system: CORPORATE_ACTION_CANONICAL_ANALYSIS_SYSTEM_PROMPT,
    user: JSON.stringify(input, null, 2),
    responseFormat: {
      json_schema: {
        name: "corporate_action_canonical_result",
        strict: true as const,
        schema: CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA,
      },
    },
  };
}
