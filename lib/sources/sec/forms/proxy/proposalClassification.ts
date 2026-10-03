import type { ProxyProposalDiscoveryResult } from "./proposalDiscovery.ts";

export const PROXY_PROPOSAL_CLASSIFICATION_VERSION = "proxy_proposal_classification_v1" as const;

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

export const PROXY_PROPOSAL_CLASSIFICATION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "items"],
  properties: {
    version: { type: "string", enum: [PROXY_PROPOSAL_CLASSIFICATION_VERSION] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["proposal_id", "is_proposal", "category"],
        properties: {
          proposal_id: { type: "string", pattern: "^P[1-9][0-9]*$" },
          is_proposal: { type: "boolean" },
          category: {
            anyOf: [
              { type: "string", enum: PROXY_PROPOSAL_CATEGORIES },
              { type: "null" },
            ],
          },
        },
      },
    },
  },
} as const;

export type ProxyProposalCategory = typeof PROXY_PROPOSAL_CATEGORIES[number];

export type ProxyProposalClassificationInputItem = {
  proposal_id: string;
  title: string;
  action_summary: string;
};

export type ProxyProposalClassificationInput = {
  items: ProxyProposalClassificationInputItem[];
};

export type ProxyProposalClassificationResult = {
  version: typeof PROXY_PROPOSAL_CLASSIFICATION_VERSION;
  items: Array<{
    proposal_id: string;
    is_proposal: boolean;
    category: ProxyProposalCategory | null;
  }>;
};

export type ProxyProposalClassificationValidation = {
  ok: boolean;
  value: ProxyProposalClassificationResult | null;
  errors: string[];
};

export type ProxyProposalClassificationGeminiResponseBody = {
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

type ProxyProposalClassificationGeminiTextResponse = {
  body: ProxyProposalClassificationGeminiResponseBody | null;
  outputTextCount: number;
  outputText: string | null;
  finishReason: string | null;
  errors: string[];
};

export function buildProxyProposalClassificationInput(
  stage1: ProxyProposalDiscoveryResult,
): ProxyProposalClassificationInput {
  if (stage1.version !== "proxy_proposal_discovery_v1") {
    throw new Error("Proxy Proposal Classification requires proxy_proposal_discovery_v1 input");
  }

  return {
    items: stage1.proposals.map((proposal, index) => ({
      proposal_id: `P${index + 1}`,
      title: proposal.title,
      action_summary: proposal.action_summary,
    })),
  };
}

export function buildProxyProposalClassificationPrompt(
  input: ProxyProposalClassificationInput,
) {
  return {
    system: [
      "Classify every supplied Stage 1 proxy proposal item exactly once.",
      "The server assigned each proposal_id. Preserve every proposal_id exactly; do not omit, duplicate, reorder, rename, or invent IDs.",
      "Use only the supplied title and action_summary. SEC evidence text and evidence references are intentionally not model input.",
      "First decide whether the item is an actual stockholder proposal. If it is not, set is_proposal=false and category=null.",
      "If it is an actual stockholder proposal, set is_proposal=true and assign exactly one category from the enum below.",
      "Categories:",
      "capital_structure: reverse or forward splits, authorized-share changes, recapitalizations, or other changes to the issuer's share or capital structure.",
      "equity_compensation: equity incentive, stock option, employee stock purchase, or other equity compensation plans and amendments.",
      "transaction: mergers, acquisitions, business combinations, asset sales, or comparable strategic transactions submitted for approval.",
      "financing: securities issuances, exchange-cap approvals, debt, warrants, convertibles, or other financing arrangements submitted for approval.",
      "governance: charter, bylaws, board structure, voting rights, consent rights, exculpation, or other governance changes not better classified above.",
      "shareholder_proposal: a proposal explicitly submitted by a shareholder or stockholder proponent. Use this even when its subject overlaps another category.",
      "director_election: election or re-election of directors.",
      "auditor: appointment or ratification of an independent auditor or accounting firm.",
      "executive_compensation: say-on-pay or another stockholder vote on executive compensation, excluding approval of an equity compensation plan.",
      "procedural: adjournment, postponement, quorum, or another meeting-procedure proposal.",
      "other: an actual stockholder proposal that does not accurately fit another category.",
      "Generic other-business boilerplate, future proposal-submission instructions, narrative discussion, and historical actions are not actual proposals: use is_proposal=false and category=null.",
      "Do not extract terms, decide lifecycle or completion, create unresolved output, add explanations, or modify Stage 1 content.",
      "Return one direct JSON object matching the closed response schema, with exactly version and items.",
    ].join("\n"),
    user: JSON.stringify({
      contract: {
        version: PROXY_PROPOSAL_CLASSIFICATION_VERSION,
        response_schema: PROXY_PROPOSAL_CLASSIFICATION_RESPONSE_SCHEMA,
      },
      proposals: input.items,
    }),
  };
}

export function buildProxyProposalClassificationGeminiRequest(
  input: ProxyProposalClassificationInput,
  maxOutputTokens: number,
) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Proxy Proposal Classification maxOutputTokens must be a positive integer");
  }
  const prompt = buildProxyProposalClassificationPrompt(input);
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

export async function runProxyProposalClassificationGemini({
  apiKey,
  model,
  input,
  maxOutputTokens,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  input: ProxyProposalClassificationInput;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}) {
  const normalizedModel = model.startsWith("models/") ? model : `models/${model}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${normalizedModel}:generateContent`;
  const request = buildProxyProposalClassificationGeminiRequest(input, maxOutputTokens);
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
      ? parseAndValidateProxyProposalClassification(parsedResponse.outputText, input)
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

export function parseAndValidateProxyProposalClassification(
  outputText: string,
  input: ProxyProposalClassificationInput,
): ProxyProposalClassificationValidation {
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
  return validateProxyProposalClassification(parsed, input);
}

export function validateProxyProposalClassification(
  value: unknown,
  input: ProxyProposalClassificationInput,
): ProxyProposalClassificationValidation {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return { ok: false, value: null, errors: ["$ must be an object"] };
  exactKeys(root, ["version", "items"], "$", errors);

  if (root.version !== PROXY_PROPOSAL_CLASSIFICATION_VERSION) {
    errors.push(`$.version must equal ${PROXY_PROPOSAL_CLASSIFICATION_VERSION}`);
  }

  const expectedIds = input.items.map((item) => item.proposal_id);
  const knownIds = new Set(expectedIds);
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
      exactKeys(item, ["proposal_id", "is_proposal", "category"], path, errors);
      if (typeof item.proposal_id !== "string" || !/^P[1-9][0-9]*$/.test(item.proposal_id)) {
        errors.push(`${path}.proposal_id must be an ID like P1`);
      } else {
        if (!knownIds.has(item.proposal_id)) {
          errors.push(`${path}.proposal_id references unknown proposal ${item.proposal_id}`);
        }
        if (seenIds.has(item.proposal_id)) {
          errors.push(`${path}.proposal_id duplicates ${item.proposal_id}`);
        }
        seenIds.add(item.proposal_id);
      }
      if (typeof item.is_proposal !== "boolean") {
        errors.push(`${path}.is_proposal must be a boolean`);
      } else if (item.is_proposal) {
        if (!oneOf(item.category, PROXY_PROPOSAL_CATEGORIES)) {
          errors.push(`${path}.category must be one of: ${PROXY_PROPOSAL_CATEGORIES.join(", ")} when is_proposal is true`);
        }
      } else if (item.category !== null) {
        errors.push(`${path}.category must be null when is_proposal is false`);
      }
    });
  }

  for (const proposalId of expectedIds) {
    if (!seenIds.has(proposalId)) errors.push(`$.items is missing proposal ${proposalId}`);
  }

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? value as ProxyProposalClassificationResult : null,
    errors,
  };
}

function parseGeminiTextResponse(rawResponseText: string): ProxyProposalClassificationGeminiTextResponse {
  let body: ProxyProposalClassificationGeminiResponseBody | null = null;
  try {
    const parsed = parseJsonWithoutDuplicateKeys(rawResponseText);
    const parsedBody = record(parsed);
    if (!parsedBody) throw new Error("Gemini response body must be a JSON object");
    body = parsedBody as ProxyProposalClassificationGeminiResponseBody;
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
    for (const [token, parsed] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.slice(index, index + token.length) === token) {
        index += token.length;
        return parsed;
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
