import {
  CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
  CORPORATE_ACTION_AFFECTED_SECURITY_UNAVAILABLE_REASONS,
  CORPORATE_ACTION_EFFECTIVE_TIMING_KINDS,
  CORPORATE_ACTION_EFFECTIVE_TIMING_UNAVAILABLE_REASONS,
  CORPORATE_ACTION_EVENT_KINDS,
  REVERSE_SPLIT_EXECUTION_UPDATE_DECISIONS,
  CORPORATE_ACTION_STAGE_VOCABULARY,
  CORPORATE_ACTION_STAGES,
  type CorporateActionAnalyzerInput,
} from "../monitor/corporateActionCanonicalFacts.ts";
import {
  LEVEL2_SHARE_COUNT_OBSERVATION_FIELD,
  LEVEL2_SHARE_COUNT_PROMPT_CONTRACT,
  LEVEL2_SHARE_COUNT_PROVIDER_SCHEMA,
} from "../sec-structured-data/level2ShareCountObservation.ts";

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
    affected_security: {
      anyOf: [
        {
          type: "object",
          properties: {
            availability: { type: "string", enum: ["unavailable"] },
            reason: { type: "string", enum: CORPORATE_ACTION_AFFECTED_SECURITY_UNAVAILABLE_REASONS },
            source_ref: { type: "string", nullable: true },
            evidence: { type: "string", nullable: true },
          },
          required: ["availability", "reason", "source_ref", "evidence"],
        },
        {
          type: "object",
          properties: {
            availability: { type: "string", enum: ["available"] },
            canonical_security_class_id: { type: "string" },
            security_type: { type: "string", enum: ["common_stock"] },
            source_security_title: { type: "string" },
            source_ref: { type: "string" },
            evidence: { type: "string" },
          },
          required: [
            "availability",
            "canonical_security_class_id",
            "security_type",
            "source_security_title",
            "source_ref",
            "evidence",
          ],
        },
      ],
    },
    effective_timing: {
      anyOf: [
        {
          type: "object",
          properties: {
            availability: { type: "string", enum: ["unavailable"] },
            reason: { type: "string", enum: CORPORATE_ACTION_EFFECTIVE_TIMING_UNAVAILABLE_REASONS },
          },
          required: ["availability", "reason"],
        },
        {
          type: "object",
          properties: {
            availability: { type: "string", enum: ["available"] },
            kind: { type: "string", enum: CORPORATE_ACTION_EFFECTIVE_TIMING_KINDS },
            timestamp: { type: "string", nullable: true },
            source_ref: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["availability", "kind", "timestamp", "source_ref", "evidence"],
        },
      ],
    },
    execution_update: {
      type: "object",
      properties: {
        decision: { type: "string", enum: REVERSE_SPLIT_EXECUTION_UPDATE_DECISIONS },
        target_execution_id: { type: "string", nullable: true },
        source_ref: { type: "string" },
        evidence: { type: "string" },
      },
      required: ["decision", "target_execution_id", "source_ref", "evidence"],
    },
    source_ref: { type: "string" },
    evidence: { type: "string", nullable: true },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    as_of: dateAvailabilitySchema(),
    [LEVEL2_SHARE_COUNT_OBSERVATION_FIELD]: LEVEL2_SHARE_COUNT_PROVIDER_SCHEMA,
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
  "You are the Corporate Action Canonical Analyzer. Analyze the complete stored source documents and decide whether this source semantically establishes an explicit reverse stock split or explicit forward stock split.",
  "The source_documents are the only semantic truth. Source family, title, event_type, parser values, calendar values, routing signals, ticker metadata, and prior AI output never prove applicability or any fact.",
  "Return applicable false for mergers, spin-offs, stock dividends, cash dividends, recapitalizations, ADS-ratio changes, listing actions without an explicit stock split, general capital-structure discussion, proposals that do not establish a stock split, and every other non-stock-split source. Ordinary references to split-adjusted values or historical splits are not a new action.",
  "The LLM alone decides applicability, event kind, action stage, whether a date is the stock-split effective date, and which source-stated ratio components apply. Do not use keyword matching or isolated-word logic; analyze the full source meaning.",
  `action_stage exact meanings: ${CORPORATE_ACTION_STAGE_VOCABULARY.map((entry) => `${entry.value} = ${entry.description}`).join("; ")}.`,
  "Choose the most specific stage established at the stored source's published_at or source-stated as-of time. Never upgrade a historical notice because its future date has passed by today's clock.",
  "Do not decide a stage from one word. A confirmed effective date that was future at the source time is scheduled even if the source is an official exchange notice or also describes earlier approvals. Use effective only when the source establishes that the action had already taken effect at source time or is itself a contemporaneous notice of an action taking effect.",
  `For a non-applicable source return applicable false and no Corporate Action fields; the independent optional ${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD} may still be present only when its SEC filing contract is satisfied. Failure, uncertainty about transport, or missing source text is not not-applicable.`,
  `For an applicable source return exactly these keys: applicable, event_kind, action_stage, effective_date, ratio, affected_security, effective_timing, execution_update, source_ref, evidence, confidence, as_of. applicable is true and event_kind is exactly one of ${CORPORATE_ACTION_EVENT_KINDS.join(", ")}. Use forward_split only for an explicit increase in shares per old share, never a stock dividend or inferred adjustment.`,
  "effective_date is exactly {availability:unavailable} when the source does not establish the stock-split effective date, otherwise {availability:available,value:YYYY-MM-DD}. Do not substitute publication, record, marketplace, payment, approval, or trading dates.",
  "ratio is exactly {availability:unavailable} when the source does not establish a ratio. Otherwise return {availability:available,old_shares:string,new_shares:string}, where old_shares and new_shares are positive plain decimal strings representing source-backed old and new share quantities. Preserve execution orientation: for a 1-for-20 reverse split return old_shares 20 and new_shares 1; for a 4-for-1 forward split return old_shares 1 and new_shares 4; for a 3-for-2 forward split return old_shares 2 and new_shares 3. Application code alone performs division into old_shares_per_new_share and does not calculate outstanding shares.",
  "issuer_context and security_class_candidates are deterministic, authoritative context, not semantic truth about which security the stock split affects. Never invent a CIK, class, candidate, or equivalence.",
  "affected_security is available only when the source meaning explicitly identifies an affected common-stock security and exactly one supplied security_class_candidate is the same security. Copy that exact canonical_security_class_id. source_security_title and evidence must be compact contiguous exact spans from the cited source_ref. A single-common candidate may be selected for source-stated common stock only when issuer_context is available and the supplied candidate basis is SINGLE_COMMON_STOCK_CLASS.",
  `If issuer identity, class support, source meaning, or ADS-versus-ordinary applicability is not safe, return affected_security unavailable with one of: ${CORPORATE_ACTION_AFFECTED_SECURITY_UNAVAILABLE_REASONS.join(", ")}. Do not map generic common stock across multiple class candidates, infer a class from ticker/title synonyms, apply an issuer action to every class, or infer ADS ratios.`,
  `effective_timing preserves only explicit source session meaning. Available kinds are ${CORPORATE_ACTION_EFFECTIVE_TIMING_KINDS.join(", ")}. exact_timestamp requires a source-stated timestamp; other kinds require timestamp null. If only effective_date is known return unavailable/date_only; if neither date nor timing is established return unavailable/not_provided; ambiguous language returns unavailable/ambiguous. Never infer market session ordering from a date alone.`,
  `execution_update is a calculation-safety relation, not action_stage. Choose exactly one of ${REVERSE_SPLIT_EXECUTION_UPDATE_DECISIONS.join(", ")}. Use KEEP_OR_CONFIRM only when the source explicitly confirms or historically re-mentions one supplied same-action-kind execution candidate. Use SUPERSEDE_EXISTING_EXECUTION only when the source explicitly changes one supplied same-action-kind candidate to a different ratio or effective date. Use CANCEL_EXISTING_EXECUTION only when the source explicitly cancels one supplied same-action-kind candidate. Use NEW_EXECUTION only when the source establishes a genuinely new stock split rather than updating or recalling a supplied candidate. Use UNRESOLVED_EXECUTION_UPDATE when the source establishes a change, cancellation, confirmation, or historical reference but its target cannot be selected safely.`,
  "For reverse_split, existing targets come only from reverse_split_execution_candidates. For forward_split, existing targets come only from forward_split_execution_candidates. For KEEP_OR_CONFIRM, SUPERSEDE_EXISTING_EXECUTION, or CANCEL_EXISTING_EXECUTION, copy exactly one supplied same-action-kind execution_id into target_execution_id. For NEW_EXECUTION or UNRESOLVED_EXECUTION_UPDATE, target_execution_id is null. Never match executions by ratio/date similarity, issuer name, ticker, title, or elapsed time. A historical mention is not a new execution, and a reverse execution is never a forward target or vice versa.",
  "execution_update source_ref and evidence must be one compact contiguous exact source span that establishes the relation or new execution. Candidate metadata is bounded deterministic context; only the source text may establish what the current source means.",
  "Use exactly one supplied source_ref that supports applicability and every available semantic value. Never invent, alter, concatenate, or copy a label in place of source_ref.",
  "evidence is one shortest useful contiguous verbatim span from the cited source_document.text, or null only when no compact span can be safely copied. Do not paraphrase, normalize whitespace, join passages, or use another document.",
  "confidence is exactly high, medium, or low and reflects semantic certainty from the cited stored source, not confidence in parser or prior AI context.",
  "as_of is exactly {availability:unavailable} when no source-backed observation or effective basis date applies, otherwise {availability:available,value:YYYY-MM-DD}. Do not copy another date merely to populate it.",
  LEVEL2_SHARE_COUNT_PROMPT_CONTRACT,
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
