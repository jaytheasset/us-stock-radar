import { buildProxyFinalStructuredInput, type ProxyFinalStructuredInput } from "./finalStructuredSourceInput.ts";
export { buildProxyFinalStructuredInput } from "./finalStructuredSourceInput.ts";
export type { ProxyFinalStructuredInput, ProxyFinalStructuredFilingIdentity } from "./finalStructuredSourceInput.ts";

export const PROXY_FINAL_STRUCTURED_VERSION = "proxy_final_structured_v1" as const;
export const PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS = 32_000;

export const PROXY_PROPOSAL_CATEGORIES = [
  "capital_structure",
  "equity_compensation",
  "transaction",
  "financing",
  "governance",
  "shareholder_proposal",
  "director_election",
  "auditor",
  "executive_compensation",
  "procedural",
  "other",
] as const;

export const PROXY_FINAL_FACT_FIELDS = [
  "action",
  "subject",
  "affected_share_class",
  "reverse_split_ratio",
  "authorized_shares_before",
  "authorized_shares_after",
  "board_discretion",
  "execution_deadline",
  "effectiveness_condition",
  "fractional_share_treatment",
  "authorized_shares_effect",
  "par_value_effect",
  "proposal_status",
  "prior_completed_capital_action",
  "plan_or_transaction_name",
  "quantitative_term",
  "procedural_trigger",
  "other_material_fact",
] as const;

export type ProxyProposalCategory = typeof PROXY_PROPOSAL_CATEGORIES[number];
export type ProxyFinalFactField = typeof PROXY_FINAL_FACT_FIELDS[number];

export type ProxyFinalStructuredFact = {
  field: ProxyFinalFactField;
  value: string;
  evidence: string[];
};

export type ProxyFinalStructuredConflict = {
  description: string;
  evidence: string[];
};

export type ProxyCapitalValue = { value: string; evidence: string[] };

export type ProxyCapitalCanonicalCore = {
  action: ProxyCapitalValue | null;
  proposal_status: ProxyCapitalValue | null;
  changes: Array<{
    scope: ProxyCapitalValue | null;
    reverse_split_ratio: ProxyCapitalValue | null;
    authorized_shares_before: ProxyCapitalValue | null;
    authorized_shares_after: ProxyCapitalValue | null;
  }>;
  prior_completed_capital_actions: ProxyCapitalValue[];
};

export type ProxyCapitalSupportingDetails = {
  board_discretion?: ProxyCapitalValue | null;
  execution_deadline?: ProxyCapitalValue | null;
  effectiveness_conditions?: ProxyCapitalValue[];
  fractional_share_treatment?: ProxyCapitalValue[];
  authorized_shares_effects?: Array<{ scope: ProxyCapitalValue | null; statement: ProxyCapitalValue }>;
  par_value?: ProxyCapitalValue | null;
  source_conflicts?: Array<{ subject: string; statements: ProxyCapitalValue[] }>;
  other?: ProxyCapitalValue[];
};

export type ProxyCapitalFacts = {
  canonical_core: ProxyCapitalCanonicalCore;
  supporting_details: ProxyCapitalSupportingDetails;
};

export const PROXY_CAPITAL_FACT_KEYS = ["canonical_core", "supporting_details"] as const;
export const PROXY_CAPITAL_CORE_KEYS = [
  "action", "proposal_status", "changes", "prior_completed_capital_actions",
] as const;
export const PROXY_CAPITAL_CHANGE_KEYS = [
  "scope", "reverse_split_ratio", "authorized_shares_before", "authorized_shares_after",
] as const;
export const PROXY_CAPITAL_SUPPORTING_KEYS = [
  "board_discretion", "execution_deadline", "effectiveness_conditions",
  "fractional_share_treatment", "authorized_shares_effects", "par_value", "source_conflicts", "other",
] as const;

export type ProxyFinalStructuredItem = {
  proposal_id: string;
  is_proposal: true;
  category: "capital_structure";
  capital_facts: ProxyCapitalFacts;
} | {
  proposal_id: string;
  is_proposal: boolean;
  category: Exclude<ProxyProposalCategory, "capital_structure"> | null;
  facts: ProxyFinalStructuredFact[];
  source_conflicts: ProxyFinalStructuredConflict[];
};

export type ProxyFinalStructuredResult = {
  version: typeof PROXY_FINAL_STRUCTURED_VERSION;
  items: ProxyFinalStructuredItem[];
};

export type ProxyFinalStructuredValidation = {
  ok: boolean;
  value: ProxyFinalStructuredResult | null;
  errors: string[];
};

const CAPITAL_VALUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["value", "evidence"],
  properties: {
    value: { type: "string", minLength: 1, maxLength: PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS },
    evidence: {
      type: "array", minItems: 1, uniqueItems: true,
      items: { type: "string", pattern: "^E[1-9][0-9]*$" },
    },
  },
} as const;
const NULLABLE_CAPITAL_VALUE_SCHEMA = { anyOf: [CAPITAL_VALUE_SCHEMA, { type: "null" }] } as const;
const CAPITAL_VALUE_ARRAY_SCHEMA = { type: "array", items: CAPITAL_VALUE_SCHEMA } as const;

export const PROXY_CAPITAL_FACTS_RESPONSE_SCHEMA = {
  type: "object", additionalProperties: false, required: PROXY_CAPITAL_FACT_KEYS,
  properties: {
    canonical_core: {
      type: "object", additionalProperties: false, required: PROXY_CAPITAL_CORE_KEYS,
      properties: {
        action: NULLABLE_CAPITAL_VALUE_SCHEMA,
        proposal_status: NULLABLE_CAPITAL_VALUE_SCHEMA,
        changes: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: PROXY_CAPITAL_CHANGE_KEYS,
            properties: {
              scope: NULLABLE_CAPITAL_VALUE_SCHEMA,
              reverse_split_ratio: NULLABLE_CAPITAL_VALUE_SCHEMA,
              authorized_shares_before: NULLABLE_CAPITAL_VALUE_SCHEMA,
              authorized_shares_after: NULLABLE_CAPITAL_VALUE_SCHEMA,
            },
          },
        },
        prior_completed_capital_actions: CAPITAL_VALUE_ARRAY_SCHEMA,
      },
    },
    supporting_details: {
      type: "object", additionalProperties: false,
      properties: {
        board_discretion: NULLABLE_CAPITAL_VALUE_SCHEMA,
        execution_deadline: NULLABLE_CAPITAL_VALUE_SCHEMA,
        effectiveness_conditions: CAPITAL_VALUE_ARRAY_SCHEMA,
        fractional_share_treatment: CAPITAL_VALUE_ARRAY_SCHEMA,
        authorized_shares_effects: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["scope", "statement"],
            properties: { scope: NULLABLE_CAPITAL_VALUE_SCHEMA, statement: CAPITAL_VALUE_SCHEMA },
          },
        },
        par_value: NULLABLE_CAPITAL_VALUE_SCHEMA,
        source_conflicts: {
          type: "array",
          items: {
            type: "object", additionalProperties: false, required: ["subject", "statements"],
            properties: {
              subject: { type: "string", minLength: 1, maxLength: PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS },
              statements: { type: "array", minItems: 2, items: CAPITAL_VALUE_SCHEMA },
            },
          },
        },
        other: CAPITAL_VALUE_ARRAY_SCHEMA,
      },
    },
  },
} as const;

const NON_CAPITAL_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposal_id", "is_proposal", "category", "facts", "source_conflicts"],
  properties: {
    proposal_id: { type: "string", pattern: "^P[1-9][0-9]*$" },
    is_proposal: { type: "boolean" },
    category: {
      anyOf: [
        { type: "string", enum: PROXY_PROPOSAL_CATEGORIES.filter((category) => category !== "capital_structure") },
        { type: "null" },
      ],
    },
    facts: {
      type: "array", maxItems: 40,
      items: {
        type: "object", additionalProperties: false, required: ["field", "value", "evidence"],
        properties: {
          field: { type: "string", enum: PROXY_FINAL_FACT_FIELDS },
          value: { type: "string", minLength: 1, maxLength: 500 },
          evidence: CAPITAL_VALUE_SCHEMA.properties.evidence,
        },
      },
    },
    source_conflicts: {
      type: "array", maxItems: 20,
      items: {
        type: "object", additionalProperties: false, required: ["description", "evidence"],
        properties: {
          description: { type: "string", minLength: 1, maxLength: 1_000 },
          evidence: CAPITAL_VALUE_SCHEMA.properties.evidence,
        },
      },
    },
  },
} as const;

export const PROXY_FINAL_STRUCTURED_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "items"],
  properties: {
    version: { type: "string", enum: [PROXY_FINAL_STRUCTURED_VERSION] },
    items: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object", additionalProperties: false,
            required: ["proposal_id", "is_proposal", "category", "capital_facts"],
            properties: {
              proposal_id: { type: "string", pattern: "^P[1-9][0-9]*$" },
              is_proposal: { type: "boolean", const: true },
              category: { type: "string", enum: ["capital_structure"] },
              capital_facts: PROXY_CAPITAL_FACTS_RESPONSE_SCHEMA,
            },
          },
          NON_CAPITAL_ITEM_SCHEMA,
        ],
      },
    },
  },
} as const;

type GeminiResponseBody = {
  responseId?: string;
  modelVersion?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
    [key: string]: unknown;
  };
  error?: { message?: string };
};

type GeminiTextResponse = {
  body: GeminiResponseBody | null;
  outputTextCount: number;
  outputText: string | null;
  finishReason: string | null;
  errors: string[];
};


export function buildProxyFinalStructuredPrompt(input: ProxyFinalStructuredInput) {
  // Re-project even typed callers: structural typing alone cannot exclude runtime source fields.
  const safeInput = buildProxyFinalStructuredInput({ filing: input.filing, stage1: input.handoff });
  return {
    system: [
      "Normalize every candidate in the validated proxy_analysis_handoff_v3 into the existing final FACT schema in one response.",
      "The server maps handoff.candidates to proposal_id values by array position: the first candidate is P1, the second P2, and so on. Return every ID exactly once in that order; never omit, duplicate, rename, reorder, or invent an ID. An empty candidates array requires items: [].",
      "Call 1 was the last LLM to see SEC source text. Use only filing identity and handoff: document_notes, candidate titles, claims, and their evidence IDs. Do not request or reconstruct SEC text, use parser semantic facts, Primary output, outside knowledge, or a source fallback. Filing identity identifies the document; it does not supply proposal FACT values.",
      "Use document_notes as shared context and each candidate's claims as the factual basis for normalization. Candidate titles may be used for identification and classification, but are not standalone evidence. Every emitted FACT value must be supported by a handoff claim or document_note carrying evidence IDs. Claims may quote the source; preserve their meaning, uncertainty, and conflicts without inventing missing details. Evidence IDs are references only, not permission to retrieve their source text.",
      "First decide whether each candidate is a distinct matter actually submitted to stockholders for approval, election, ratification, authorization, or another vote.",
      "Generic other-business boilerplate, future proposal-submission instructions, narrative discussion, notices, meeting logistics, historical actions, an adjournment or quorum event that already occurred, and quorum-status descriptions are not proposals.",
      "A separately submitted adjournment, postponement, quorum, or other procedural ballot matter is an actual proposal.",
      "For a non-proposal, set is_proposal=false, category=null, facts=[], and source_conflicts=[].",
      "For an actual proposal, set is_proposal=true, assign exactly one category, and extract concise handoff-grounded core facts.",
      "Categories:",
      "capital_structure: reverse or forward splits, authorized-share changes, recapitalizations, or other changes to the issuer's share or capital structure.",
      "equity_compensation: equity incentive, stock option, employee stock purchase, or other equity compensation plans and amendments.",
      "transaction: mergers, acquisitions, business combinations, asset sales, or comparable strategic transactions submitted for approval.",
      "financing: securities issuances, exchange-cap approvals, debt, warrants, convertibles, or other financing arrangements submitted for approval.",
      "governance: charter, bylaws, board structure, voting rights, consent rights, exculpation, or other governance changes not better classified above.",
      "shareholder_proposal: a proposal explicitly submitted by a shareholder or stockholder proponent, even when its subject overlaps another category.",
      "director_election: election or re-election of directors.",
      "auditor: appointment or ratification of an independent auditor or accounting firm.",
      "executive_compensation: say-on-pay or another vote on executive compensation, excluding approval of an equity compensation plan.",
      "procedural: a separately submitted adjournment, postponement, quorum, or other meeting-procedure proposal.",
      "other: an actual proposal that does not accurately fit another category.",
      "For every actual proposal outside capital_structure, include at least an action fact in facts and keep the existing facts/source_conflicts output. Extract other material facts only when explicitly stated in the validated handoff.",
      "Do not discard a material handoff claim merely because it does not fit a dedicated field. Preserve handoff-grounded conditions, thresholds, requirements, or other facts that materially affect how the proposal is approved or carried out, using the most accurate existing field; use other_material_fact for non-capital proposals or supporting_details.other for capital_structure when necessary.",
      "For capital_structure, output only proposal_id, is_proposal=true, category, and capital_facts on the item. Do not output the legacy facts or item-level source_conflicts on a capital_structure item.",
      "capital_facts has exactly canonical_core and supporting_details. Canonical Core is the minimal layer to check for every capital proposal; Supporting Details are optional captured context, not an exhaustive checklist. Missing, null, or empty values do not mean a fact does not exist.",
      "Every canonical_core key and every changes row key is required. Each actual value is {value: handoff-grounded string, evidence: supporting evidence IDs}. Use null when a single value is unavailable or conflicting and [] when no handoff-grounded rows or historical actions can be captured. Never omit a Core key or invent a value.",
      "canonical_core.action briefly states the requested shareholder action and subject, without duplicating detailed numbers or conditions. proposal_status is only a distinct procedural or lifecycle status explicitly stated in the validated handoff, such as preliminary status or Board approval expressly subject to stockholder approval. A Board voting recommendation is not proposal_status, and a request for stockholder approval that merely restates the action is not a distinct status. If no other status is stated, use null. This is not the issuer's latest lifecycle.",
      "canonical_core.changes links each material affected security scope to its current proposed reverse_split_ratio and authorized_shares_before/after. Scope may be a class, combined common stock, or aggregate capital stock; an aggregate is not a share class. Capture handoff-stated aggregate and individual-class authorized quantities without calculating totals. Do not substitute outstanding quantities for authorized quantities or place dedicated Core values in Supporting. Preserve brackets and number formatting as stated in the handoff.",
      "A reverse split ratio may be fixed or a range; do not pick a final ratio from a range. Keep a conflicting Core value null even if one passage appears more authoritative. Retain undisputed values and class-specific quantities when an aggregate is disputed.",
      "canonical_core.prior_completed_capital_actions contains separately completed related prior capital actions with their handoff-stated ratios and dates, not exhaustive issuer history. Never place prior completed values in current changes or proposal_status.",
      "supporting_details may capture handoff-stated board_discretion, execution_deadline, effectiveness_conditions, fractional_share_treatment, authorized_shares_effects, par_value, source_conflicts, and other. authorized_shares_effects links scope to a statement about authorization effects, including unaffected classes. other is the only extension space; do not repeat facts covered by dedicated fields. Supporting completeness is not required, but every supplied value must be accurate and evidenced.",
      "A request for approval, a preliminary filing, a Board recommendation, or a Board approval expressly subject to stockholder approval is not evidence that the proposal was approved or implemented.",
      "Do not calculate missing totals, derive unstated before/after quantities from ratios or unchanged effects, infer an unchanged value from silence, normalize bracket placeholders into final values, or supply any value absent from the validated handoff. Outside capital_structure omit an unavailable fact; within Core use null or [] instead of a guess.",
      "When the validated handoff explicitly preserves conflicting statements, do not choose, combine, calculate, or silently normalize a winning value. Outside capital_structure describe the conflict in source_conflicts with all supporting evidence IDs. For capital_structure preserve conflict statements in supporting_details.source_conflicts, with subject and at least two handoff-grounded statements, each with its own value and evidence. Conflicts affecting a Core value require that value to remain null, without selecting a winner in action, status, or another field. Preserve the conflicting statements and retain undisputed Core values.",
      "A FACT or conflict may cite only evidence IDs attached to the handoff claim or document_note that states the emitted value or conflict; do not borrow evidence IDs from unrelated claims. Evidence references do not make an inferred value handoff-grounded.",
      "Return one direct JSON object matching the closed response schema. Do not add prose, markdown, wrappers, or extra fields.",
    ].join("\n"),
    user: JSON.stringify({
      contract: {
        version: PROXY_FINAL_STRUCTURED_VERSION,
        response_schema: PROXY_FINAL_STRUCTURED_RESPONSE_SCHEMA,
      },
      input: safeInput,
    }),
  };
}

/** Gemini generation guard only. The full FACT contract remains in the prompt and validator. */
export function buildProxyFinalStructuredNativeSchema(): Record<string, unknown> {
  const evidence = {
    type: "array",
    items: { type: "string" },
  };
  const capitalValue = {
    type: "object",
    required: ["value", "evidence"],
    properties: {
      value: { type: "string" },
      evidence,
    },
  };
  const nullableCapitalValue = {
    type: ["object", "null"],
    required: ["value", "evidence"],
    properties: {
      value: { type: "string" },
      evidence,
    },
  };

  return {
    type: "object",
    required: ["version", "items"],
    properties: {
      version: {
        type: "string",
        enum: [PROXY_FINAL_STRUCTURED_VERSION],
      },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["proposal_id", "is_proposal", "category"],
          properties: {
            proposal_id: { type: "string" },
            is_proposal: { type: "boolean" },
            category: { type: ["string", "null"] },
            facts: {
              type: "array",
              items: {
                type: "object",
                required: ["field", "value", "evidence"],
                properties: {
                  field: { type: "string", enum: [...PROXY_FINAL_FACT_FIELDS] },
                  value: { type: "string" },
                  evidence,
                },
              },
            },
            source_conflicts: {
              type: "array",
              items: {
                type: "object",
                required: ["description", "evidence"],
                properties: {
                  description: { type: "string" },
                  evidence,
                },
              },
            },
            capital_facts: {
              type: "object",
              required: ["canonical_core", "supporting_details"],
              properties: {
                canonical_core: {
                  type: "object",
                  required: [
                    "action", "proposal_status", "changes", "prior_completed_capital_actions",
                  ],
                  properties: {
                    action: nullableCapitalValue,
                    proposal_status: nullableCapitalValue,
                    changes: {
                      type: "array",
                      items: {
                        type: "object",
                        required: [
                          "scope", "reverse_split_ratio",
                          "authorized_shares_before", "authorized_shares_after",
                        ],
                        properties: {
                          scope: nullableCapitalValue,
                          reverse_split_ratio: nullableCapitalValue,
                          authorized_shares_before: nullableCapitalValue,
                          authorized_shares_after: nullableCapitalValue,
                        },
                      },
                    },
                    prior_completed_capital_actions: {
                      type: "array",
                      items: capitalValue,
                    },
                  },
                },
                supporting_details: {
                  type: "object",
                  properties: {
                    board_discretion: nullableCapitalValue,
                    execution_deadline: nullableCapitalValue,
                    effectiveness_conditions: {
                      type: "array",
                      items: capitalValue,
                    },
                    fractional_share_treatment: {
                      type: "array",
                      items: capitalValue,
                    },
                    authorized_shares_effects: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["scope", "statement"],
                        properties: {
                          scope: nullableCapitalValue,
                          statement: capitalValue,
                        },
                      },
                    },
                    par_value: nullableCapitalValue,
                    source_conflicts: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["subject", "statements"],
                        properties: {
                          subject: { type: "string" },
                          statements: {
                            type: "array",
                            items: capitalValue,
                          },
                        },
                      },
                    },
                    other: {
                      type: "array",
                      items: capitalValue,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

export function buildProxyFinalStructuredGeminiRequest(
  input: ProxyFinalStructuredInput,
  maxOutputTokens: number,
) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Proxy Final Structured maxOutputTokens must be a positive integer");
  }
  const prompt = buildProxyFinalStructuredPrompt(input);
  return {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: "user", parts: [{ text: prompt.user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseFormat: {
        text: { mimeType: "APPLICATION_JSON", schema: buildProxyFinalStructuredNativeSchema() },
      },
      maxOutputTokens,
      temperature: 0,
    },
  };
}

export async function runProxyFinalStructuredGemini({
  apiKey,
  model,
  input,
  maxOutputTokens,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  input: ProxyFinalStructuredInput;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}) {
  const normalizedModel = model.startsWith("models/") ? model : `models/${model}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${normalizedModel}:generateContent`;
  const request = buildProxyFinalStructuredGeminiRequest(input, maxOutputTokens);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(request),
    });
    const latencyMs = Date.now() - startedAt;
    const rawResponseText = await response.text();
    const parsedResponse = parseGeminiTextResponse(rawResponseText);
    const body = parsedResponse.body;
    const finishReason = parsedResponse.finishReason;
    const transportOk = response.ok && finishReason === "STOP" && parsedResponse.outputTextCount === 1;
    const validation = parsedResponse.outputText !== null
      ? parseAndValidateProxyFinalStructured(parsedResponse.outputText, input)
      : { ok: false, value: null, errors: [...parsedResponse.errors] };
    const error = response.ok
      ? transportOk
        ? undefined
        : finishReason && finishReason !== "STOP"
          ? `Gemini generation stopped: ${finishReason}`
          : parsedResponse.errors.join("; ") || "Gemini response did not contain one non-empty text output"
      : body?.error?.message || response.statusText || `<HTTP ${response.status}>`;
    return {
      ok: transportOk,
      transportOk,
      responseOk: response.ok,
      status: response.status,
      statusText: response.statusText,
      endpoint,
      model,
      request,
      responseId: body?.responseId || null,
      modelVersion: body?.modelVersion || null,
      finishReason,
      outputTextCount: parsedResponse.outputTextCount,
      outputText: parsedResponse.outputText,
      validation,
      usage: body?.usageMetadata || null,
      latencyMs,
      error,
      body,
      rawResponseText,
    };
  } catch (error) {
    return {
      ok: false,
      transportOk: false,
      responseOk: false,
      status: 0,
      statusText: "",
      endpoint,
      model,
      request,
      responseId: null,
      modelVersion: null,
      finishReason: null,
      outputTextCount: 0,
      outputText: null,
      validation: { ok: false, value: null, errors: [] },
      usage: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      body: null,
      rawResponseText: "",
    };
  }
}

export function parseAndValidateProxyFinalStructured(
  outputText: string,
  input: ProxyFinalStructuredInput,
): ProxyFinalStructuredValidation {
  let parsed: unknown;
  try {
    parsed = parseJsonWithoutDuplicateKeys(outputText);
  } catch (error) {
    return {
      ok: false,
      value: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  return validateProxyFinalStructured(parsed, input);
}

export function validateProxyFinalStructured(
  value: unknown,
  input: ProxyFinalStructuredInput,
): ProxyFinalStructuredValidation {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return { ok: false, value: null, errors: ["$ must be an object"] };
  exactKeys(root, ["version", "items"], "$", errors);
  if (root.version !== PROXY_FINAL_STRUCTURED_VERSION) {
    errors.push(`$.version must equal ${PROXY_FINAL_STRUCTURED_VERSION}`);
  }

  const expectedIds = input.handoff.candidates.map((_, index) => `P${index + 1}`);
  const knownIds = new Set(expectedIds);
  const knownEvidence = new Set([
    ...input.handoff.document_notes.flatMap((claim) => claim.evidence),
    ...input.handoff.candidates.flatMap((candidate) => candidate.claims.flatMap((claim) => claim.evidence)),
  ]);
  const seenIds = new Set<string>();
  if (!Array.isArray(root.items)) {
    errors.push("$.items must be an array");
  } else {
    root.items.forEach((candidate, index) => {
      const path = `$.items[${index}]`;
      const item = record(candidate);
      if (!item) {
        errors.push(`${path} must be an object`);
        return;
      }
      const capitalItem = item.category === "capital_structure";
      exactKeys(item, capitalItem
        ? ["proposal_id", "is_proposal", "category", "capital_facts"]
        : ["proposal_id", "is_proposal", "category", "facts", "source_conflicts"], path, errors);
      if (typeof item.proposal_id !== "string" || !/^P[1-9][0-9]*$/.test(item.proposal_id)) {
        errors.push(`${path}.proposal_id must be an ID like P1`);
        return;
      }
      if (!knownIds.has(item.proposal_id)) errors.push(`${path}.proposal_id references unknown proposal ${item.proposal_id}`);
      if (seenIds.has(item.proposal_id)) errors.push(`${path}.proposal_id duplicates ${item.proposal_id}`);
      seenIds.add(item.proposal_id);
      if (item.proposal_id !== expectedIds[index]) {
        errors.push(`${path}.proposal_id must preserve input order as ${expectedIds[index]}`);
      }

      if (typeof item.is_proposal !== "boolean") {
        errors.push(`${path}.is_proposal must be a boolean`);
      } else if (item.is_proposal) {
        if (!oneOf(item.category, PROXY_PROPOSAL_CATEGORIES)) {
          errors.push(`${path}.category must be a proposal category when is_proposal is true`);
        }
      } else if (item.category !== null) {
        errors.push(`${path}.category must be null when is_proposal is false`);
      }

      if (capitalItem) {
        validateCapitalFacts(item.capital_facts, `${path}.capital_facts`, knownEvidence, errors);
      } else {
        validateFacts(item.facts, `${path}.facts`, knownEvidence, item.is_proposal === true, errors);
        validateConflicts(item.source_conflicts, `${path}.source_conflicts`, knownEvidence, errors);
      }
      if (item.is_proposal === false) {
        if (Array.isArray(item.facts) && item.facts.length > 0) errors.push(`${path}.facts must be empty for a non-proposal`);
        if (Array.isArray(item.source_conflicts) && item.source_conflicts.length > 0) {
          errors.push(`${path}.source_conflicts must be empty for a non-proposal`);
        }
      }
    });
  }
  for (const proposalId of expectedIds) {
    if (!seenIds.has(proposalId)) errors.push(`$.items is missing proposal ${proposalId}`);
  }

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? value as ProxyFinalStructuredResult : null,
    errors,
  };
}


function validateCapitalFacts(value: unknown, path: string, knownEvidence: Set<string>, errors: string[]) {
  const capital = record(value);
  if (!capital) {
    errors.push(`${path} must be an object`);
    return;
  }
  exactKeys(capital, [...PROXY_CAPITAL_FACT_KEYS], path, errors);
  const corePath = `${path}.canonical_core`;
  const core = record(capital.canonical_core);
  if (!core) {
    errors.push(`${corePath} must be an object`);
  } else {
    exactKeys(core, [...PROXY_CAPITAL_CORE_KEYS], corePath, errors);
    for (const key of ["action", "proposal_status"] as const) {
      validateCapitalValue(core[key], `${corePath}.${key}`, knownEvidence, true, errors);
    }
    validateCapitalValueArray(core.prior_completed_capital_actions, `${corePath}.prior_completed_capital_actions`, knownEvidence, errors);
    if (!Array.isArray(core.changes)) {
      errors.push(`${corePath}.changes must be an array`);
    } else core.changes.forEach((candidate, index) => {
      const rowPath = `${corePath}.changes[${index}]`;
      const row = record(candidate);
      if (!row) {
        errors.push(`${rowPath} must be an object`);
        return;
      }
      exactKeys(row, [...PROXY_CAPITAL_CHANGE_KEYS], rowPath, errors);
      for (const key of PROXY_CAPITAL_CHANGE_KEYS) {
        validateCapitalValue(row[key], `${rowPath}.${key}`, knownEvidence, true, errors);
      }
    });
  }

  const supportingPath = `${path}.supporting_details`;
  const supporting = record(capital.supporting_details);
  if (!supporting) {
    errors.push(`${supportingPath} must be an object`);
    return;
  }
  for (const key of Object.keys(supporting)) {
    if (!oneOf(key, PROXY_CAPITAL_SUPPORTING_KEYS)) errors.push(`${supportingPath}.${key} is not allowed`);
  }
  for (const key of ["board_discretion", "execution_deadline", "par_value"] as const) {
    if (Object.hasOwn(supporting, key)) validateCapitalValue(supporting[key], `${supportingPath}.${key}`, knownEvidence, true, errors);
  }
  for (const key of ["effectiveness_conditions", "fractional_share_treatment", "other"] as const) {
    if (Object.hasOwn(supporting, key)) validateCapitalValueArray(supporting[key], `${supportingPath}.${key}`, knownEvidence, errors);
  }
  if (Object.hasOwn(supporting, "authorized_shares_effects")) {
    if (!Array.isArray(supporting.authorized_shares_effects)) {
      errors.push(`${supportingPath}.authorized_shares_effects must be an array`);
    } else supporting.authorized_shares_effects.forEach((candidate, index) => {
      const rowPath = `${supportingPath}.authorized_shares_effects[${index}]`;
      const row = record(candidate);
      if (!row) {
        errors.push(`${rowPath} must be an object`);
        return;
      }
      exactKeys(row, ["scope", "statement"], rowPath, errors);
      validateCapitalValue(row.scope, `${rowPath}.scope`, knownEvidence, true, errors);
      validateCapitalValue(row.statement, `${rowPath}.statement`, knownEvidence, false, errors);
    });
  }
  if (!Object.hasOwn(supporting, "source_conflicts")) return;
  if (!Array.isArray(supporting.source_conflicts)) {
    errors.push(`${supportingPath}.source_conflicts must be an array`);
  } else {
    supporting.source_conflicts.forEach((candidate, index) => {
      const conflictPath = `${supportingPath}.source_conflicts[${index}]`;
      const conflict = record(candidate);
      if (!conflict) {
        errors.push(`${conflictPath} must be an object`);
        return;
      }
      exactKeys(conflict, ["subject", "statements"], conflictPath, errors);
      validateBoundedString(conflict.subject, `${conflictPath}.subject`, PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS, errors);
      validateCapitalValueArray(conflict.statements, `${conflictPath}.statements`, knownEvidence, errors);
      if (Array.isArray(conflict.statements) && conflict.statements.length < 2) {
        errors.push(`${conflictPath}.statements must contain at least two source statements`);
      }
    });
  }
}

function validateCapitalValueArray(value: unknown, path: string, knownEvidence: Set<string>, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((candidate, index) => validateCapitalValue(candidate, `${path}[${index}]`, knownEvidence, false, errors));
}

function validateCapitalValue(value: unknown, path: string, knownEvidence: Set<string>, nullable: boolean, errors: string[]) {
  if (nullable && value === null) return;
  const fact = record(value);
  if (!fact) {
    errors.push(`${path} must be a value/evidence object${nullable ? " or null" : ""}`);
    return;
  }
  exactKeys(fact, ["value", "evidence"], path, errors);
  validateBoundedString(fact.value, `${path}.value`, PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS, errors);
  validateEvidence(fact.evidence, `${path}.evidence`, knownEvidence, errors);
}

function validateFacts(
  value: unknown,
  path: string,
  knownEvidence: Set<string>,
  required: boolean,
  errors: string[],
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (required && value.length === 0) errors.push(`${path} must contain at least one source-grounded fact`);
  if (value.length > 40) errors.push(`${path} must contain at most 40 facts`);
  value.forEach((candidate, index) => {
    const factPath = `${path}[${index}]`;
    const fact = record(candidate);
    if (!fact) {
      errors.push(`${factPath} must be an object`);
      return;
    }
    exactKeys(fact, ["field", "value", "evidence"], factPath, errors);
    if (!oneOf(fact.field, PROXY_FINAL_FACT_FIELDS)) errors.push(`${factPath}.field is invalid`);
    validateBoundedString(
      fact.value,
      `${factPath}.value`,
      PROXY_FINAL_FACT_VALUE_VALIDATION_MAX_CHARS,
      errors,
    );
    validateEvidence(fact.evidence, `${factPath}.evidence`, knownEvidence, errors);
  });
}

function validateConflicts(
  value: unknown,
  path: string,
  knownEvidence: Set<string>,
  errors: string[],
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > 20) errors.push(`${path} must contain at most 20 conflicts`);
  value.forEach((candidate, index) => {
    const conflictPath = `${path}[${index}]`;
    const conflict = record(candidate);
    if (!conflict) {
      errors.push(`${conflictPath} must be an object`);
      return;
    }
    exactKeys(conflict, ["description", "evidence"], conflictPath, errors);
    validateBoundedString(conflict.description, `${conflictPath}.description`, 1_000, errors);
    validateEvidence(conflict.evidence, `${conflictPath}.evidence`, knownEvidence, errors);
  });
}

function validateEvidence(
  value: unknown,
  path: string,
  knownEvidence: Set<string>,
  errors: string[],
) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    if (typeof candidate !== "string" || !/^E[1-9][0-9]*$/.test(candidate)) {
      errors.push(`${path}[${index}] must be an evidence ID`);
      return;
    }
    if (seen.has(candidate)) errors.push(`${path} must not contain duplicate evidence IDs`);
    seen.add(candidate);
    if (!knownEvidence.has(candidate)) errors.push(`${path}[${index}] is not present in the Call 2 handoff`);
  });
}

function parseGeminiTextResponse(rawResponseText: string): GeminiTextResponse {
  let body: GeminiResponseBody | null = null;
  try {
    const parsed = parseJsonWithoutDuplicateKeys(rawResponseText);
    const parsedBody = record(parsed);
    if (!parsedBody) throw new Error("Gemini response body must be a JSON object");
    body = parsedBody as GeminiResponseBody;
  } catch (error) {
    return {
      body: null,
      outputTextCount: 0,
      outputText: null,
      finishReason: null,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  const outputs: Array<{ text: string; finishReason: string | null }> = [];
  for (const candidate of body.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string" && part.text.trim()) {
        outputs.push({ text: part.text, finishReason: candidate.finishReason || null });
      }
    }
  }
  const errors: string[] = [];
  if (outputs.length !== 1) {
    errors.push(`Gemini response must contain exactly one non-empty text output; received ${outputs.length}`);
  }
  const output = outputs.length === 1 ? outputs[0] : null;
  return {
    body,
    outputTextCount: outputs.length,
    outputText: output?.text || null,
    finishReason: output?.finishReason
      || body.candidates?.map((candidate) => candidate.finishReason).find(Boolean)
      || null,
    errors,
  };
}

function parseJsonWithoutDuplicateKeys(text: string): unknown {
  let index = 0;
  const fail = (message: string): never => {
    throw new Error(`${message} at character ${index}`);
  };
  const skipWhitespace = () => {
    while (/\s/.test(text[index] || "")) index += 1;
  };
  const parseString = () => {
    if (text[index] !== '"') fail("JSON string must start with a quote");
    const start = index;
    index += 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code < 0x20) fail("unescaped control character");
      if (text[index] === "\\") {
        index += 2;
        continue;
      }
      if (text[index] === '"') {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index)) as string;
        } catch {
          fail("invalid JSON string escape");
        }
      }
      index += 1;
    }
    return fail("unterminated JSON string");
  };
  const parseValue = (): unknown => {
    skipWhitespace();
    if (text[index] === '"') return parseString();
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const result = Object.create(null) as Record<string, unknown>;
      const seen = new Set<string>();
      if (text[index] === "}") {
        index += 1;
        return result;
      }
      while (true) {
        skipWhitespace();
        const key = parseString();
        skipWhitespace();
        if (seen.has(key)) fail(`duplicate key ${JSON.stringify(key)}`);
        seen.add(key);
        if (text[index] !== ":") fail("missing colon");
        index += 1;
        result[key] = parseValue();
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return result;
        }
        if (text[index] !== ",") fail("missing comma");
        index += 1;
      }
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      const result: unknown[] = [];
      if (text[index] === "]") {
        index += 1;
        return result;
      }
      while (true) {
        result.push(parseValue());
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return result;
        }
        if (text[index] !== ",") fail("missing comma");
        index += 1;
      }
    }
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(token, index)) {
        index += token.length;
        return parsed;
      }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) return fail("invalid JSON value");
    index += number[0].length;
    return Number(number[0]);
  };
  const result = parseValue();
  skipWhitespace();
  if (index !== text.length) fail("trailing content");
  return result;
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string, errors: string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
  }
}

function validateBoundedString(value: unknown, path: string, maxLength: number, errors: string[]) {
  if (!nonEmptyText(value) || value.length > maxLength) {
    errors.push(`${path} must be a non-empty string no longer than ${maxLength} characters`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}
