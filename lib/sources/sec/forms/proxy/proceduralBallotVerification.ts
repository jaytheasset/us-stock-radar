import type {
  ProxyProposalClassificationResult,
} from "./proposalClassification.ts";
import type {
  ProxyProposalDiscoveryResult,
  ProxyProposalDiscoverySourcePackage,
} from "./proposalDiscovery.ts";

export const PROXY_PROCEDURAL_BALLOT_EVIDENCE_EXCERPT_MAX_CHARS = 2_500;

export const PROXY_PROCEDURAL_BALLOT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["proposal_id", "is_ballot_proposal"],
  properties: {
    proposal_id: { type: "string", pattern: "^P[1-9][0-9]*$" },
    is_ballot_proposal: { type: "boolean" },
  },
} as const;

export type ProxyProceduralBallotInput = {
  proposal_id: string;
  title: string;
  action_summary: string;
  evidence_excerpt: string;
  form_type: string;
};

export type ProxyProceduralBallotResult = {
  proposal_id: string;
  is_ballot_proposal: boolean;
};

export type ProxyProceduralBallotValidation = {
  ok: boolean;
  value: ProxyProceduralBallotResult | null;
  errors: string[];
};

type ProxyProceduralBallotGeminiResponseBody = {
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

type ProxyProceduralBallotGeminiTextResponse = {
  body: ProxyProceduralBallotGeminiResponseBody | null;
  outputTextCount: number;
  outputText: string | null;
  finishReason: string | null;
  errors: string[];
};

export function buildProxyProceduralBallotInputs({
  stage1,
  stage2,
  sourcePackage,
  formType,
}: {
  stage1: ProxyProposalDiscoveryResult;
  stage2: ProxyProposalClassificationResult;
  sourcePackage: Pick<ProxyProposalDiscoverySourcePackage, "evidenceBlocks">;
  formType: string;
}): ProxyProceduralBallotInput[] {
  if (stage1.version !== "proxy_proposal_discovery_v1") {
    throw new Error("Proxy Procedural Ballot Verification requires proxy_proposal_discovery_v1 input");
  }
  if (stage2.version !== "proxy_proposal_classification_v1") {
    throw new Error("Proxy Procedural Ballot Verification requires proxy_proposal_classification_v1 input");
  }
  if (!formType.trim()) {
    throw new Error("Proxy Procedural Ballot Verification requires a form type");
  }

  const evidenceById = new Map<string, string>();
  for (const block of sourcePackage.evidenceBlocks) {
    if (!/^E[1-9][0-9]*$/.test(block.id)) {
      throw new Error(`Invalid Stage 1 evidence ID: ${block.id}`);
    }
    if (evidenceById.has(block.id)) {
      throw new Error(`Duplicate Stage 1 evidence ID: ${block.id}`);
    }
    if (!block.text.trim()) {
      throw new Error(`Stage 1 evidence ${block.id} has empty source text`);
    }
    evidenceById.set(block.id, block.text);
  }

  return stage2.items
    .filter((item) => item.category === "procedural")
    .map((item) => {
      if (!item.is_proposal) {
        throw new Error(`${item.proposal_id} cannot be procedural when is_proposal is false`);
      }
      const match = item.proposal_id.match(/^P([1-9][0-9]*)$/);
      const proposalIndex = match ? Number(match[1]) - 1 : -1;
      const proposal = stage1.proposals[proposalIndex];
      if (!proposal) {
        throw new Error(`Stage 2 references unknown Stage 1 proposal ${item.proposal_id}`);
      }
      const evidenceTexts = proposal.evidence.map((evidenceId) => {
        const text = evidenceById.get(evidenceId);
        if (text === undefined) {
          throw new Error(`${item.proposal_id} references unknown Stage 1 evidence ${evidenceId}`);
        }
        return text;
      });
      if (evidenceTexts.length === 0) {
        throw new Error(`${item.proposal_id} has no Stage 1 evidence`);
      }
      return {
        proposal_id: item.proposal_id,
        title: proposal.title,
        action_summary: proposal.action_summary,
        evidence_excerpt: buildBoundedEvidenceExcerpt(evidenceTexts),
        form_type: formType,
      };
    });
}

export function buildProxyProceduralBallotPrompt(input: ProxyProceduralBallotInput) {
  return {
    system: [
      "Decide only whether this procedural proxy item is a separate proposal submitted to stockholders for approval or a vote.",
      "Preserve proposal_id exactly.",
      "Set is_ballot_proposal=true only when the supplied item itself is a distinct adjournment, quorum, postponement, or other procedural matter on which stockholders are asked to vote or grant approval.",
      "Set is_ballot_proposal=false for generic other-business boilerplate, an adjournment or quorum event that already occurred, a description of quorum status, a notice, meeting logistics, or another operational explanation.",
      "A document or meeting can discuss voting on other proposals without making this procedural item a separate ballot proposal.",
      "Use only proposal_id, title, action_summary, evidence_excerpt, and form_type. The evidence excerpt contains bounded source-backed SEC text cited by Stage 1.",
      "Do not classify category, extract terms, infer another proposal, or add an explanation.",
      "Return one direct JSON object with exactly proposal_id and is_ballot_proposal.",
    ].join("\n"),
    user: JSON.stringify({
      contract: { response_schema: PROXY_PROCEDURAL_BALLOT_RESPONSE_SCHEMA },
      item: input,
    }),
  };
}

export function buildProxyProceduralBallotGeminiRequest(
  input: ProxyProceduralBallotInput,
  maxOutputTokens: number,
) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Proxy Procedural Ballot maxOutputTokens must be a positive integer");
  }
  const prompt = buildProxyProceduralBallotPrompt(input);
  return {
    systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: "user", parts: [{ text: prompt.user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens,
      temperature: 0,
    },
  };
}

export async function runProxyProceduralBallotGemini({
  apiKey,
  model,
  input,
  maxOutputTokens,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  input: ProxyProceduralBallotInput;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}) {
  const normalizedModel = model.startsWith("models/") ? model : `models/${model}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${normalizedModel}:generateContent`;
  const request = buildProxyProceduralBallotGeminiRequest(input, maxOutputTokens);
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
      ? parseAndValidateProxyProceduralBallot(parsedResponse.outputText, input)
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

export function parseAndValidateProxyProceduralBallot(
  outputText: string,
  input: ProxyProceduralBallotInput,
): ProxyProceduralBallotValidation {
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

  const errors: string[] = [];
  const root = record(parsed);
  if (!root) return { ok: false, value: null, errors: ["$ must be an object"] };
  exactKeys(root, ["proposal_id", "is_ballot_proposal"], "$", errors);
  if (root.proposal_id !== input.proposal_id) {
    errors.push(`$.proposal_id must equal ${input.proposal_id}`);
  }
  if (typeof root.is_ballot_proposal !== "boolean") {
    errors.push("$.is_ballot_proposal must be a boolean");
  }
  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? parsed as ProxyProceduralBallotResult : null,
    errors,
  };
}

function buildBoundedEvidenceExcerpt(evidenceTexts: string[]) {
  const separator = "\n\n";
  const separatorCharacters = separator.length * Math.max(0, evidenceTexts.length - 1);
  let remainingCharacters = Math.max(
    0,
    PROXY_PROCEDURAL_BALLOT_EVIDENCE_EXCERPT_MAX_CHARS - separatorCharacters,
  );
  const excerpts = evidenceTexts.map((text, index) => {
    const remainingBlocks = evidenceTexts.length - index;
    const allocation = Math.floor(remainingCharacters / remainingBlocks);
    const excerpt = text.slice(0, allocation);
    remainingCharacters -= excerpt.length;
    return excerpt;
  });
  return excerpts.join(separator).slice(0, PROXY_PROCEDURAL_BALLOT_EVIDENCE_EXCERPT_MAX_CHARS);
}

function parseGeminiTextResponse(rawResponseText: string): ProxyProceduralBallotGeminiTextResponse {
  let body: ProxyProceduralBallotGeminiResponseBody | null = null;
  try {
    const parsed = parseJsonWithoutDuplicateKeys(rawResponseText);
    const parsedBody = record(parsed);
    if (!parsedBody) throw new Error("Gemini response body must be a JSON object");
    body = parsedBody as ProxyProceduralBallotGeminiResponseBody;
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
