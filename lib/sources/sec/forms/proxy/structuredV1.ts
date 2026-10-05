import { createHash } from "node:crypto";
import type { ProxyParserOutput } from "./parser.ts";
import { buildProxyLegacySourceBlockPromptInput as buildProxySourceBlockPromptInput } from "./sourceInput.ts";

export const PROXY_STRUCTURED_V1_VERSION = "proxy_structured_v1" as const;

export const PROXY_STRUCTURED_V1_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "meeting", "proposals", "unresolved"],
  properties: {
    version: { type: "string", enum: [PROXY_STRUCTURED_V1_VERSION] },
    meeting: {
      type: "object",
      additionalProperties: false,
      required: ["date", "type", "evidence"],
      properties: {
        date: { anyOf: [{ type: "string", format: "date" }, { type: "null" }] },
        type: { type: "string", enum: ["annual", "special", "other", "unclear"] },
        evidence: {
          type: "array",
          items: { type: "string", pattern: "^E[1-9][0-9]*$" },
          uniqueItems: true,
        },
      },
    },
    proposals: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "action", "subject", "terms", "evidence"],
        properties: {
          kind: {
            type: "string",
            enum: [
              "equity_plan",
              "reverse_split",
              "authorized_shares",
              "transaction",
              "charter_amendment",
              "other",
            ],
          },
          action: { type: "string", enum: ["approve", "amend", "authorize", "other", "unclear"] },
          subject: { type: "string", minLength: 1, maxLength: 280 },
          terms: {
            type: "array",
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 500 },
          },
          evidence: {
            type: "array",
            minItems: 1,
            items: { type: "string", pattern: "^E[1-9][0-9]*$" },
            uniqueItems: true,
          },
        },
      },
    },
    unresolved: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
} as const;

const MEETING_TYPES = ["annual", "special", "other", "unclear"] as const;
const PROPOSAL_KINDS = [
  "equity_plan",
  "reverse_split",
  "authorized_shares",
  "transaction",
  "charter_amendment",
  "other",
] as const;
const PROPOSAL_ACTIONS = ["approve", "amend", "authorize", "other", "unclear"] as const;

export type ProxyStructuredV1EvidenceBlock = {
  id: string;
  blockType: string;
  blockSequence: number;
  text: string;
};

export type ProxyStructuredV1ServerContext = {
  cik?: string | null;
  filingDate?: string | null;
  sourceUrl?: string | null;
  primaryDocumentUrl?: string | null;
};

export type ProxyStructuredV1Provenance = {
  source_fingerprint: string;
  package_fingerprint: string;
  accession_number: string | null;
  sec_form_type: string | null;
  issuer_identity: {
    cik: string | null;
    company_name: string | null;
    ticker: string | null;
    exchange: string | null;
  };
  filing_date: string | null;
  source_url: string | null;
  primary_document_url: string | null;
};

export type ProxyStructuredV1SourcePackage = {
  version: typeof PROXY_STRUCTURED_V1_VERSION;
  provenance: ProxyStructuredV1Provenance;
  evidenceBlocks: ProxyStructuredV1EvidenceBlock[];
};

export type ProxyStructuredV1Result = {
  version: typeof PROXY_STRUCTURED_V1_VERSION;
  meeting: {
    date: string | null;
    type: typeof MEETING_TYPES[number];
    evidence: string[];
  };
  proposals: Array<{
    kind: typeof PROPOSAL_KINDS[number];
    action: typeof PROPOSAL_ACTIONS[number];
    subject: string;
    terms: string[];
    evidence: string[];
  }>;
  unresolved: string[];
};

export type ProxyStructuredV1Snapshot = {
  version: typeof PROXY_STRUCTURED_V1_VERSION;
  provenance: ProxyStructuredV1Provenance;
  facts: ProxyStructuredV1Result;
};

export type ProxyStructuredV1Validation = {
  ok: boolean;
  value: ProxyStructuredV1Result | null;
  errors: string[];
};

export type ProxyStructuredV1GeminiResponseBody = {
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

type ProxyStructuredV1GeminiTextResponse = {
  body: ProxyStructuredV1GeminiResponseBody | null;
  outputTextCount: number;
  outputText: string | null;
  finishReason: string | null;
  errors: string[];
};

export function buildProxyStructuredV1GeminiRequest(
  sourcePackage: ProxyStructuredV1SourcePackage,
  maxOutputTokens: number,
) {
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
    throw new Error("Proxy Structured v1 maxOutputTokens must be a positive integer");
  }
  const prompt = buildProxyStructuredV1Prompt(sourcePackage);
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

function parseProxyStructuredV1GeminiTextResponse(
  rawResponseText: string,
): ProxyStructuredV1GeminiTextResponse {
  let body: ProxyStructuredV1GeminiResponseBody | null = null;
  try {
    const parsed = parseJsonWithoutDuplicateKeys(rawResponseText);
    const parsedBody = record(parsed);
    if (!parsedBody) throw new Error("Gemini response body must be a JSON object");
    body = parsedBody as ProxyStructuredV1GeminiResponseBody;
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

export async function runProxyStructuredV1Gemini({
  apiKey,
  model,
  sourcePackage,
  maxOutputTokens,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  sourcePackage: ProxyStructuredV1SourcePackage;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}) {
  const normalizedModel = model.startsWith("models/") ? model : `models/${model}`;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${normalizedModel}:generateContent`;
  const request = buildProxyStructuredV1GeminiRequest(sourcePackage, maxOutputTokens);
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
    const parsedResponse = parseProxyStructuredV1GeminiTextResponse(rawResponseText);
    const body = parsedResponse.body;
    const finishReason = parsedResponse.finishReason;
    const transportOk = response.ok && finishReason === "STOP" && parsedResponse.outputTextCount === 1;
    const validation = parsedResponse.outputText !== null
      ? parseAndValidateProxyStructuredV1(parsedResponse.outputText, sourcePackage)
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

export function buildProxyStructuredV1SourcePackage(
  parserOutput: ProxyParserOutput,
  serverContext: ProxyStructuredV1ServerContext = {},
): ProxyStructuredV1SourcePackage {
  if (parserOutput.raw.importantBlocks.some((block) => block.kind === "preliminary_placeholder")) {
    throw new Error(
      "Proxy Structured v1 cannot use parser-generated preliminary_placeholder text as source evidence",
    );
  }
  const primaryInput = buildProxySourceBlockPromptInput(parserOutput);
  const cleanedBlocks = Array.isArray(primaryInput.cleaned_source_blocks)
    ? primaryInput.cleaned_source_blocks
    : [];
  const currentFiling = record(primaryInput.current_filing) || {};
  const retainedBlocks = cleanedBlocks.flatMap((candidate, originalIndex) => {
    const block = record(candidate);
    if (!block || block.block_type === "current_filing") return [];
    if (!nonEmptyText(block.block_type) || !nonEmptyText(block.text)) {
      throw new Error(`Proxy Structured v1 source block ${originalIndex} is incomplete`);
    }
    return [{
      blockType: block.block_type,
      text: block.text,
    }];
  });
  const evidenceBlocks = retainedBlocks.map((block, index) => ({
    id: `E${index + 1}`,
    blockType: block.blockType,
    blockSequence: index,
    text: block.text,
  }));

  const identity = {
    accession_number: nullableText(currentFiling.accession_number) || nullableText(parserOutput.accessionNumber),
    sec_form_type: nullableText(currentFiling.form_type) || nullableText(parserOutput.raw.secFormType),
    issuer_identity: {
      cik: nullableText(serverContext.cik) || nullableText(currentFiling.cik),
      company_name: nullableText(currentFiling.company_name) || nullableText(parserOutput.facts.companyName),
      ticker: nullableText(currentFiling.ticker) || nullableText(parserOutput.facts.primaryTicker.ticker),
      exchange: nullableText(currentFiling.exchange) || nullableText(parserOutput.facts.primaryTicker.exchange),
    },
    filing_date: nullableText(serverContext.filingDate) || nullableText(currentFiling.filed_at),
    source_url: nullableText(serverContext.sourceUrl) || nullableText(currentFiling.source_url),
    primary_document_url:
      nullableText(serverContext.primaryDocumentUrl) || nullableText(currentFiling.primary_document_url),
  };
  const sourceFingerprint = sha256(stableJson(evidenceBlocks.map((block) => ({
    blockType: block.blockType,
    text: block.text,
  }))));
  const packageFingerprint = sha256(stableJson({
    version: PROXY_STRUCTURED_V1_VERSION,
    sourceFingerprint,
    identity,
    evidenceBlocks,
  }));

  return {
    version: PROXY_STRUCTURED_V1_VERSION,
    provenance: {
      source_fingerprint: sourceFingerprint,
      package_fingerprint: packageFingerprint,
      ...identity,
    },
    evidenceBlocks,
  };
}

export function buildProxyStructuredV1Prompt(sourcePackage: ProxyStructuredV1SourcePackage) {
  return {
    system: [
      "Extract source-grounded FACTs from the supplied SEC proxy documents.",
      "Use only the supplied evidence blocks. Never infer, calculate, repair, or import outside facts.",
      "blockType is mechanical provenance, not a semantic classification. Table warnings are extraction-quality notices, not filing facts.",
      "Return one direct JSON object matching the closed schema; do not add prose or markdown.",
      "Meeting evidence may be empty only when the meeting is unclear and date is null.",
      "Include only material capital-structure or transaction proposals: equity plans, reverse splits, authorized shares, transactions, and related charter amendments.",
      "Exclude routine director elections, auditor ratification, and say-on-pay proposals.",
      "A proposal request or preliminary filing is not evidence that an action was completed.",
      "Keep subject and terms short and close to the source wording. Put unresolved source ambiguity in unresolved.",
    ].join("\n"),
    user: JSON.stringify({
      contract: {
        version: PROXY_STRUCTURED_V1_VERSION,
        response_schema: PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
      },
      evidence_blocks: sourcePackage.evidenceBlocks,
    }),
  };
}

export function parseAndValidateProxyStructuredV1(
  outputText: string,
  sourcePackage: Pick<ProxyStructuredV1SourcePackage, "evidenceBlocks">,
): ProxyStructuredV1Validation {
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
  return validateProxyStructuredV1(parsed, sourcePackage);
}

export function validateProxyStructuredV1(
  value: unknown,
  sourcePackage: Pick<ProxyStructuredV1SourcePackage, "evidenceBlocks">,
): ProxyStructuredV1Validation {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return { ok: false, value: null, errors: ["$ must be an object"] };
  exactKeys(root, ["version", "meeting", "proposals", "unresolved"], "$", errors);

  if (root.version !== PROXY_STRUCTURED_V1_VERSION) {
    errors.push(`$.version must equal ${PROXY_STRUCTURED_V1_VERSION}`);
  }

  const knownEvidence = new Set(sourcePackage.evidenceBlocks.map((block) => block.id));
  const meeting = record(root.meeting);
  if (!meeting) {
    errors.push("$.meeting must be an object");
  } else {
    exactKeys(meeting, ["date", "type", "evidence"], "$.meeting", errors);
    if (meeting.date !== null && !validDate(meeting.date)) {
      errors.push("$.meeting.date must be a real YYYY-MM-DD date or null");
    }
    if (!oneOf(meeting.type, MEETING_TYPES)) {
      errors.push(`$.meeting.type must be one of: ${MEETING_TYPES.join(", ")}`);
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
    if (root.proposals.length > 20) errors.push("$.proposals must contain at most 20 items");
    root.proposals.forEach((candidate, index) => {
      const path = `$.proposals[${index}]`;
      const proposal = record(candidate);
      if (!proposal) {
        errors.push(`${path} must be an object`);
        return;
      }
      exactKeys(proposal, ["kind", "action", "subject", "terms", "evidence"], path, errors);
      if (!oneOf(proposal.kind, PROPOSAL_KINDS)) {
        errors.push(`${path}.kind must be one of: ${PROPOSAL_KINDS.join(", ")}`);
      }
      if (!oneOf(proposal.action, PROPOSAL_ACTIONS)) {
        errors.push(`${path}.action must be one of: ${PROPOSAL_ACTIONS.join(", ")}`);
      }
      validateBoundedString(proposal.subject, `${path}.subject`, 280, errors);
      validateStringArray(proposal.terms, `${path}.terms`, 12, 500, errors);
      validateEvidence(proposal.evidence, `${path}.evidence`, knownEvidence, errors, true);
    });
  }

  validateStringArray(root.unresolved, "$.unresolved", 20, 500, errors);
  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? value as ProxyStructuredV1Result : null,
    errors,
  };
}

export function bindProxyStructuredV1Snapshot(
  sourcePackage: ProxyStructuredV1SourcePackage,
  facts: ProxyStructuredV1Result,
): ProxyStructuredV1Snapshot {
  const validation = validateProxyStructuredV1(facts, sourcePackage);
  if (!validation.ok || !validation.value) {
    throw new Error(`Cannot bind invalid Proxy Structured v1 facts: ${validation.errors.join("; ")}`);
  }
  return {
    version: PROXY_STRUCTURED_V1_VERSION,
    provenance: structuredClone(sourcePackage.provenance),
    facts: structuredClone(validation.value),
  };
}

export function parseJsonWithoutDuplicateKeys(text: string): unknown {
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

function validateEvidence(
  value: unknown,
  path: string,
  knownEvidence: Set<string>,
  errors: string[],
  required: boolean,
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (required && value.length === 0) errors.push(`${path} must contain at least one evidence ID`);
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    if (typeof candidate !== "string" || !/^E[1-9]\d*$/.test(candidate)) {
      errors.push(`${path}[${index}] must be an evidence ID`);
      return;
    }
    if (seen.has(candidate)) errors.push(`${path} must not contain duplicate evidence IDs`);
    seen.add(candidate);
    if (!knownEvidence.has(candidate)) errors.push(`${path}[${index}] references unknown evidence ${candidate}`);
  });
}

function validateStringArray(value: unknown, path: string, maxItems: number, maxLength: number, errors: string[]) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length > maxItems) errors.push(`${path} must contain at most ${maxItems} items`);
  value.forEach((candidate, index) => validateBoundedString(candidate, `${path}[${index}]`, maxLength, errors));
}

function validateBoundedString(value: unknown, path: string, maxLength: number, errors: string[]) {
  if (!nonEmptyText(value) || value.length > maxLength) {
    errors.push(`${path} must be a non-empty string no longer than ${maxLength} characters`);
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, errors: string[]) {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    errors.push(`${path} must contain exactly: ${required.join(", ")}`);
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

function nullableText(value: unknown): string | null {
  return nonEmptyText(value) ? value.trim() : null;
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
