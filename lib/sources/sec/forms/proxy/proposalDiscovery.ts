import type { ProxyParserOutput } from "./parser.ts";

/** Frozen v1 input identity for the unchanged Call 2; never emitted by the current Call 1. */
export const PROXY_PROPOSAL_DISCOVERY_VERSION = "proxy_proposal_discovery_v1" as const;
export const PROXY_ANALYSIS_HANDOFF_VERSION = "proxy_analysis_handoff_v3" as const;
export const PROXY_ANALYSIS_HANDOFF_MAX_OUTPUT_TOKENS = 8_192;

const PROXY_ANALYSIS_CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidence"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 600 },
    evidence: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string", pattern: "^E[1-9][0-9]*$" },
      uniqueItems: true,
    },
  },
} as const;

export const PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "document_notes", "candidates"],
  properties: {
    version: { type: "string", enum: [PROXY_ANALYSIS_HANDOFF_VERSION] },
    document_notes: {
      type: "array",
      maxItems: 5,
      items: PROXY_ANALYSIS_CLAIM_SCHEMA,
    },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "claims"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          claims: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: PROXY_ANALYSIS_CLAIM_SCHEMA,
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
  discoveryBlockId?: string;
  documentId?: string;
  source?: Record<string, unknown>;
};

export type ProxyProposalDiscoverySourcePackage = {
  provenance?: Record<string, unknown>;
  evidenceBlocks: ProxyProposalDiscoveryEvidenceBlock[];
};

type ProxyProposalDiscoveryParserSource = Pick<ProxyParserOutput, "accessionNumber"> & {
  raw: Pick<ProxyParserOutput["raw"], "secFormType" | "discoveryBlocks" | "documentInventory">;
};

/** Build Call 1 evidence exclusively from the parser's source-location blocks. */
export function buildProxyProposalDiscoverySourcePackage(
  parserOutput: ProxyProposalDiscoveryParserSource,
): ProxyProposalDiscoverySourcePackage {
  if (!Array.isArray(parserOutput.raw.discoveryBlocks)) {
    throw new Error("Proxy Proposal Discovery requires raw.discoveryBlocks; no whole-source fallback is allowed");
  }
  const seen = new Set<string>();
  const blocks = [...parserOutput.raw.discoveryBlocks].sort((a, b) =>
    a.sourceDocumentIndex - b.sourceDocumentIndex || a.startChar - b.startChar
      || a.endChar - b.endChar || a.id.localeCompare(b.id),
  );
  const evidenceBlocks = blocks.map((block, index) => {
    const document = parserOutput.raw.documentInventory[block.sourceDocumentIndex];
    if (!block.id || seen.has(block.id) || !document
      || !Number.isInteger(block.sourceDocumentIndex) || block.sourceDocumentIndex < 0
      || !Number.isInteger(block.startChar) || !Number.isInteger(block.endChar)
      || block.startChar < 0 || block.endChar > document.textChars
      || typeof block.text !== "string" || !block.text.trim()
      || block.endChar - block.startChar !== block.text.length
      || !Array.isArray(block.cues) || !block.cues.every(cue => typeof cue === "string")) {
      throw new Error(`Invalid Proxy discovery source block: ${block.id}`);
    }
    seen.add(block.id);
    return {
      // The existing E-ID contract stays unchanged. Ordering is deterministic;
      // retain the parser's own stable ID and document coordinates for resolution.
      id: `E${index + 1}`,
      discoveryBlockId: block.id,
      documentId: `${parserOutput.accessionNumber ?? "filing"}:D${block.sourceDocumentIndex + 1}`,
      blockType: "proxy_discovery_source_block",
      blockSequence: index,
      text: block.text,
      source: {
        discoveryBlockId: block.id,
        documentIndex: block.sourceDocumentIndex,
        documentSequence: document.sequence,
        documentType: block.documentType,
        documentFilename: block.filename,
        documentDescription: document.description,
        origin: document.source,
        isPrimary: block.isPrimary,
        startChar: block.startChar,
        endChar: block.endChar,
        offsetCoordinate: "normalized_document_text",
        cues: [...block.cues],
      },
    };
  });
  return {
    provenance: {
      source_input: "parserOutput.raw.discoveryBlocks",
      accession_number: parserOutput.accessionNumber,
      sec_form_type: parserOutput.raw.secFormType,
    },
    evidenceBlocks,
  };
}

/** Legacy shape retained solely for saved v1 inputs consumed by the unchanged Call 2. */
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

export type ProxyAnalysisHandoffClaim = {
  text: string;
  evidence: string[];
};

export type ProxyAnalysisHandoffResult = {
  version: typeof PROXY_ANALYSIS_HANDOFF_VERSION;
  document_notes: ProxyAnalysisHandoffClaim[];
  candidates: Array<{ title: string; claims: ProxyAnalysisHandoffClaim[] }>;
};

export type ProxyProposalDiscoveryValidation = {
  ok: boolean;
  value: ProxyAnalysisHandoffResult | null;
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
      "Discover every actual stockholder proposal explicitly supported by the supplied SEC proxy candidate source blocks.",
      "The blocks were selected mechanically to preserve recall. Their presence does NOT mean they contain a proposal, and block selection is not a semantic judgment.",
      "Call 1 is a bounded free-analysis handoff, not a final FACT schema. Preserve all actual proposals, including director elections, auditor ratification, say-on-pay, shareholder proposals, adjournment proposals, and any other matter actually submitted for a stockholder vote.",
      "Use only the supplied source-backed SEC text and evidence IDs. Never use Primary analysis, parser facts, signals, event types, outside knowledge, or a full-document fallback.",
      "Do not classify proposal type or emit fixed FACT fields, a kind, category, terms, or unresolved schema. Call 2 performs final normalization. Do not provide investment interpretation.",
      "Emit an item only when the source text itself supports that stockholders are being asked to vote on or decide that matter. A mention of a proposal, Board action, historical action, parent filing, or generic voting authority is not enough by itself.",
      "Explicit numbered proposal/item/matter headings, proposal-specific voting tables, Board voting recommendations, and proposal-specific vote requirements are strong evidence when the text actually presents a stockholder vote.",
      "Never emit generic 'other business' language as a candidate unless the source separately identifies a specific action or subject as a distinct ballot matter. A clause that merely authorizes unspecified other business is not a candidate, even if it is numbered or listed in a meeting notice.",
      "Use a short identifying title. Do not copy a full meeting-notice sentence when a concise source-faithful title identifies the matter.",
      "For each candidate, choose enough high-information source-backed claims for Call 2 to understand the material substance of the matter without seeing the source. Concise does not mean minimal. Use your own judgment about what matters.",
      "Prefer information that is specific to this matter over routine proxy mechanics that could appear in many unrelated proposals. Routine voting procedures, Board recommendations, and generic meeting mechanics should consume claim space only when they materially affect the meaning, status, conditions, or consequences of this particular matter.",
      "Do not follow a filing-type-specific checklist, fixed FACT list, or preselected priority list. Do not favor or omit a detail merely because it resembles a familiar field.",
      "Each claim is generic free analysis, not a FACT field. Keep one distinct factual point per claim, keep it concise, and attach the source evidence IDs that directly support that claim.",
      "Use document_notes only for context shared across the document, not for details that belong to one candidate. An empty document_notes array is valid.",
      "Do not spend limited claim space on routine or repetitive procedural information unless it materially changes the meaning, status, conditions, or consequences of the matter.",
      "Before finalizing each candidate, check whether Call 2 could understand the material substance of the matter using only the selected claims. If omitting a source-stated detail would materially weaken that understanding, preserve it and remove a lower-information or repetitive claim instead.",
      "Return no more than 10 claims per candidate and no more than 5 shared document notes. Remove repetition, generic boilerplate, and low-information prose first.",
      "Reference only the supplied evidence IDs. When source passages materially conflict, preserve the conflict rather than resolving it. Never calculate or infer missing information or present uncertainty as settled.",
      "The blocks may overlap or repeat the same agenda item. Return each actual proposal once, with all useful supporting evidence IDs rather than duplicate proposals.",
      "For supplemental materials, zero proposals is a valid result: use candidates: []. Include only proposals that the supplied supplement itself explicitly identifies; do not reconstruct or import an omitted parent proposal list.",
      "If an actual source-explicit stockholder vote is clear but its type or importance is unclear, preserve the vote rather than dropping it.",
      "A bracket, bullet, blank, or other placeholder is not an actual meeting date; preserve its uncertainty in text without inventing a date.",
      "Return one direct JSON object matching the closed response schema. Do not add prose, markdown, wrappers, or extra fields.",
    ].join("\n"),
    user: JSON.stringify({
      contract: {
        version: PROXY_ANALYSIS_HANDOFF_VERSION,
        response_schema: PROXY_PROPOSAL_DISCOVERY_RESPONSE_SCHEMA,
      },
      source_selection_note: "candidate windows selected mechanically for recall; inclusion does not imply that a proposal exists in the block",
      candidate_source_blocks: sourcePackage.evidenceBlocks.map(({ id, text }) => ({ id, text })),
    }),
  };
}

export function buildProxyProposalDiscoveryGeminiRequest(
  sourcePackage: ProxyProposalDiscoverySourcePackage,
  maxOutputTokens: number = PROXY_ANALYSIS_HANDOFF_MAX_OUTPUT_TOKENS,
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
  maxOutputTokens = PROXY_ANALYSIS_HANDOFF_MAX_OUTPUT_TOKENS,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  sourcePackage: ProxyProposalDiscoverySourcePackage;
  maxOutputTokens?: number;
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
  exactKeys(root, ["version", "document_notes", "candidates"], "$", errors);

  if (root.version !== PROXY_ANALYSIS_HANDOFF_VERSION) {
    errors.push(`$.version must equal ${PROXY_ANALYSIS_HANDOFF_VERSION}`);
  }

  const knownEvidence = new Set(sourcePackage.evidenceBlocks.map((block) => block.id));
  validateClaims(root.document_notes, "$.document_notes", knownEvidence, errors, 0, 5);

  if (!Array.isArray(root.candidates)) {
    errors.push("$.candidates must be an array");
  } else {
    root.candidates.forEach((candidate, index) => {
      const path = `$.candidates[${index}]`;
      const proposal = record(candidate);
      if (!proposal) {
        errors.push(`${path} must be an object`);
        return;
      }
      exactKeys(proposal, ["title", "claims"], path, errors);
      validateBoundedString(proposal.title, `${path}.title`, 200, errors);
      validateClaims(proposal.claims, `${path}.claims`, knownEvidence, errors, 1, 10);
    });
  }

  return {
    ok: errors.length === 0,
    value: errors.length === 0 ? value as ProxyAnalysisHandoffResult : null,
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

function validateBoundedString(value: unknown, path: string, maxLength: number, errors: string[], minLength = 1) {
  // JSON Schema string length counts Unicode code points, not UTF-16 code units.
  if (typeof value !== "string" || [...value].length < minLength || [...value].length > maxLength) {
    errors.push(`${path} must be a string of ${minLength} to ${maxLength} characters`);
  }
}

function validateClaims(
  value: unknown,
  path: string,
  knownEvidence: Set<string>,
  errors: string[],
  minItems: number,
  maxItems: number,
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length < minItems || value.length > maxItems) {
    errors.push(`${path} must contain ${minItems} to ${maxItems} claims`);
  }
  value.forEach((candidate, index) => {
    const claimPath = `${path}[${index}]`;
    const claim = record(candidate);
    if (!claim) {
      errors.push(`${claimPath} must be an object`);
      return;
    }
    exactKeys(claim, ["text", "evidence"], claimPath, errors);
    validateBoundedString(claim.text, `${claimPath}.text`, 600, errors);
    validateEvidence(claim.evidence, `${claimPath}.evidence`, knownEvidence, errors);
    if (Array.isArray(claim.evidence) && (claim.evidence.length < 1 || claim.evidence.length > 4)) {
      errors.push(`${claimPath}.evidence must contain 1 to 4 IDs`);
    }
  });
}

function validateEvidence(
  value: unknown,
  path: string,
  knownEvidence: Set<string>,
  errors: string[],
) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
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
