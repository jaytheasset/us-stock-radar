export const PROXY_PROPOSAL_DISCOVERY_VERSION = "proxy_proposal_discovery_v1" as const;

export const PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "meeting", "proposals"],
  properties: {
    version: { type: "string", enum: [PROXY_PROPOSAL_DISCOVERY_VERSION] },
    meeting: {
      type: "object",
      additionalProperties: false,
      required: ["type", "date", "evidence"],
      properties: {
        type: { type: "string", enum: ["annual", "special", "other", "unclear"] },
        date: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        evidence: {
          type: "array",
          items: { type: "string", pattern: "^E[1-9][0-9]*$" },
          uniqueItems: true,
        },
      },
    },
    proposals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "action_summary", "evidence"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 500 },
          action_summary: { type: "string", minLength: 1, maxLength: 500 },
          evidence: {
            type: "array",
            minItems: 1,
            items: { type: "string", pattern: "^E[1-9][0-9]*$" },
            uniqueItems: true,
          },
        },
      },
    },
  },
} as const;

const MEETING_TYPES = ["annual", "special", "other", "unclear"] as const;

export type ProxyProposalDiscoveryEvidenceBlock = {
  id: string;
  blockType: string;
  blockSequence: number;
  text: string;
  source?: Record<string, unknown>;
};

export type ProxyProposalDiscoverySourcePackage = {
  provenance?: Record<string, unknown>;
  evidenceBlocks: ProxyProposalDiscoveryEvidenceBlock[];
};

export type ProxyProposalDiscoveryResult = {
  version: typeof PROXY_PROPOSAL_DISCOVERY_VERSION;
  meeting: {
    type: typeof MEETING_TYPES[number];
    date: string | null;
    evidence: string[];
  };
  proposals: Array<{
    title: string;
    action_summary: string;
    evidence: string[];
  }>;
};

/**
 * Stage 2 may consume only a validated Stage 1 result. Classification,
 * normalization, proposal enums, terms, and uncertainty are intentionally
 * outside this module and are not implemented here.
 */
export type ProxyProposalDiscoveryStage2Input = Readonly<ProxyProposalDiscoveryResult>;

export type ProxyProposalDiscoveryValidation = {
  ok: boolean;
  value: ProxyProposalDiscoveryResult | null;
  errors: string[];
};

export type ProxyProposalDiscoveryGeminiResponseBody = {
  responseId?: string;
  modelVersion?: string;
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
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

type ProxyProposalDiscoveryGeminiTextResponse = {
  body: ProxyProposalDiscoveryGeminiResponseBody | null;
  outputTextCount: number;
  outputText: string | null;
  finishReason: string | null;
  errors: string[];
};

export function buildProxyProposalDiscoveryPrompt(
  sourcePackage: ProxyProposalDiscoverySourcePackage,
) {
  return {
    system: [
      "Discover every stockholder proposal explicitly present in the supplied SEC proxy source blocks.",
      "Stage 1 is recall-only. Preserve all actual proposals, including director elections, auditor ratification, say-on-pay, shareholder proposals, adjournment proposals, and any other matter submitted for a stockholder vote.",
      "Use only the supplied source-backed SEC text and evidence IDs. Never use Primary analysis, parser facts, signals, event types, outside knowledge, or a full-document fallback.",
      "Do not classify proposal type, create a kind or enum, structure terms, decide unresolved status, or provide investment interpretation.",
      "Keep each title close to the source wording and summarize only what stockholders are asked to approve, adopt, elect, ratify, authorize, or otherwise decide.",
      "The blocks may overlap or repeat the same agenda item. Return each actual proposal once, with all useful supporting evidence IDs rather than duplicate proposals.",
      "Do not turn discussion, historical actions, future-stockholder-submission instructions, or generic other-business boilerplate into proposals.",
      "For supplemental materials, include only proposals that the supplied supplement itself explicitly identifies. Do not reconstruct or import an omitted parent proposal list.",
      "If a source-backed item may be a proposal, preserve it instead of dropping it merely because its type or importance is unclear.",
      "A bracket, bullet, blank, or other placeholder is not an actual meeting date; use null.",
      "Return one direct JSON object matching the closed response schema. Do not add prose, markdown, wrappers, or extra fields.",
    ].join("\n"),
    user: JSON.stringify({
      contract: {
        version: PROXY_PROPOSAL_DISCOVERY_VERSION,
        response_schema: PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA,
      },
      evidence_blocks: sourcePackage.evidenceBlocks,
    }),
  };
}

export function buildProxyProposalDiscoveryGeminiRequest(
  sourcePackage: ProxyProposalDiscoverySourcePackage,
  maxOutputTokens: number,
) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Proxy Proposal Discovery maxOutputTokens must be a positive integer");
  }
  const prompt = buildProxyProposalDiscoveryPrompt(sourcePackage);
  return {
    systemInstruction: {
      parts: [{ text: prompt.system }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: prompt.user }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens,
      temperature: 0,
    },
  };
}

export async function runProxyProposalDiscoveryGemini({
  apiKey,
  model,
  sourcePackage,
  maxOutputTokens,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  sourcePackage: ProxyProposalDiscoverySourcePackage;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}) {
  const normalizedModel = model.startsWith("models/") ? model : `models/${model}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${normalizedModel}:generateContent`;
  const request = buildProxyProposalDiscoveryGeminiRequest(sourcePackage, maxOutputTokens);
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
      ? parseAndValidateProxyProposalDiscovery(parsedResponse.outputText, sourcePackage)
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

export function parseAndValidateProxyProposalDiscovery(
  outputText: string,
  sourcePackage: Pick<ProxyProposalDiscoverySourcePackage, "evidenceBlocks">,
): ProxyProposalDiscoveryValidation {
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
  return validateProxyProposalDiscovery(parsed, sourcePackage);
}

export function validateProxyProposalDiscovery(
  value: unknown,
  sourcePackage: Pick<ProxyProposalDiscoverySourcePackage, "evidenceBlocks">,
): ProxyProposalDiscoveryValidation {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return { ok: false, value: null, errors: ["$ must be an object"] };
  exactKeys(root, ["version", "meeting", "proposals"], "$", errors);

  if (root.version !== PROXY_PROPOSAL_DISCOVERY_VERSION) {
    errors.push(`$.version must equal ${PROXY_PROPOSAL_DISCOVERY_VERSION}`);
  }

  const knownEvidence = new Set(sourcePackage.evidenceBlocks.map((block) => block.id));
  const meeting = record(root.meeting);
  if (!meeting) {
    errors.push("$.meeting must be an object");
  } else {
    exactKeys(meeting, ["type", "date", "evidence"], "$.meeting", errors);
    if (!oneOf(meeting.type, MEETING_TYPES)) {
      errors.push(`$.meeting.type must be one of: ${MEETING_TYPES.join(", ")}`);
    }
    if (meeting.date !== null && !validDate(meeting.date)) {
      errors.push("$.meeting.date must be a real YYYY-MM-DD date or null");
    }
    validateEvidence(meeting.evidence, "$.meeting.evidence", knownEvidence, errors, false);
    if ((meeting.date !== null || meeting.type !== "unclear")
      && Array.isArray(meeting.evidence) && meeting.evidence.length === 0) {
      errors.push("$.meeting.evidence must support a stated meeting fact");
    }
  }

  if (!Array.isArray(root.proposals)) {
    errors.push("$.proposals must be an array");
  } else {
    root.proposals.forEach((candidate, index) => {
      const path = `$.proposals[${index}]`;
      const proposal = record(candidate);
      if (!proposal) {
        errors.push(`${path} must be an object`);
        return;
      }
      exactKeys(proposal, ["title", "action_summary", "evidence"], path, errors);
      validateBoundedString(proposal.title, `${path}.title`, 500, errors);
      validateBoundedString(proposal.action_summary, `${path}.action_summary`, 500, errors);
      validateEvidence(proposal.evidence, `${path}.evidence`, knownEvidence, errors, true);
    });
  }

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? value as ProxyProposalDiscoveryResult : null,
    errors,
  };
}

function parseGeminiTextResponse(rawResponseText: string): ProxyProposalDiscoveryGeminiTextResponse {
  let body: ProxyProposalDiscoveryGeminiResponseBody | null = null;
  try {
    const parsed = parseJsonWithoutDuplicateKeys(rawResponseText);
    const parsedBody = record(parsed);
    if (!parsedBody) throw new Error("Gemini response body must be a JSON object");
    body = parsedBody as ProxyProposalDiscoveryGeminiResponseBody;
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
      if (typeof part.text === "string" && part.text.trim().length > 0) {
        outputs.push({ text: part.text, finishReason: candidate.finishReason || null });
      }
    }
  }

  const errors: string[] = [];
  if (outputs.length !== 1) {
    errors.push(`Gemini response must contain exactly one non-empty text output; received ${outputs.length}`);
  }
  const output = outputs.length === 1 ? outputs[0] : null;
  const finishReason = output?.finishReason
    || body.candidates?.map((candidate) => candidate.finishReason).find(Boolean)
    || null;

  return {
    body,
    outputTextCount: outputs.length,
    outputText: output?.text || null,
    finishReason,
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
      const result: Record<string, unknown> = {};
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
    for (const [token, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.slice(index, index + token.length) === token) {
        index += token.length;
        return value;
      }
    }
    const number = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) {
      index += number[0].length;
      return Number(number[0]);
    }
    return fail("invalid JSON value");
  };

  const result = parseValue();
  skipWhitespace();
  if (index !== text.length) fail("unexpected trailing content");
  return result;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
  path: string,
  errors: string[],
) {
  const actual = Object.keys(value);
  for (const key of expected) {
    if (!actual.includes(key)) errors.push(`${path}.${key} is required`);
  }
  for (const key of actual) {
    if (!expected.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function validateBoundedString(value: unknown, path: string, maxLength: number, errors: string[]) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    errors.push(`${path} must be a non-empty string of at most ${maxLength} characters`);
  }
}

function validateEvidence(
  value: unknown,
  path: string,
  knownEvidence: Set<string>,
  errors: string[],
  requireOne: boolean,
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (requireOne && value.length === 0) errors.push(`${path} must contain at least one evidence ID`);
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    if (typeof candidate !== "string" || !/^E[1-9][0-9]*$/.test(candidate)) {
      errors.push(`${path}[${index}] must be an evidence ID like E1`);
    } else if (!knownEvidence.has(candidate)) {
      errors.push(`${path}[${index}] references unknown evidence ${candidate}`);
    }
    if (typeof candidate === "string" && seen.has(candidate)) {
      errors.push(`${path}[${index}] duplicates evidence ${candidate}`);
    }
    if (typeof candidate === "string") seen.add(candidate);
  });
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}
