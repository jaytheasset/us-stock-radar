import { createHash } from "node:crypto";

export const PROXY_STRUCTURED_V1_VERSION = "proxy_structured_v1" as const;

export const PROXY_STRUCTURED_V1_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "source_fingerprint", "meeting", "proposals", "unresolved"],
  properties: {
    version: { type: "string", enum: [PROXY_STRUCTURED_V1_VERSION] },
    source_fingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
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

const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set(["additionalProperties", "uniqueItems"]);

export function projectProxyStructuredV1SchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectProxyStructuredV1SchemaForGemini);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key))
      .map(([key, child]) => [key, projectProxyStructuredV1SchemaForGemini(child)]),
  );
}

export const PROXY_STRUCTURED_V1_PROVIDER_SCHEMA = projectProxyStructuredV1SchemaForGemini(
  PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
) as Record<string, unknown>;

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

export type ProxyStructuredV1SourceDocument = {
  documentId: string;
  sequence: number;
  documentType: string;
  filename: string;
  url: string;
  html?: string;
  text?: string;
};

export type ProxyStructuredV1EvidenceBlock = {
  id: string;
  documentId: string;
  documentSequence: number;
  blockSequence: number;
  text: string;
};

export type ProxyStructuredV1SourcePackage = {
  version: typeof PROXY_STRUCTURED_V1_VERSION;
  sourceFingerprint: string;
  packageFingerprint: string;
  documents: Array<{
    documentId: string;
    sequence: number;
    documentType: string;
    filename: string;
    url: string;
    sourceSha256: string;
    normalizedTextSha256: string;
    normalizedTextChars: number;
  }>;
  evidenceBlocks: ProxyStructuredV1EvidenceBlock[];
};

export type ProxyStructuredV1Result = {
  version: typeof PROXY_STRUCTURED_V1_VERSION;
  source_fingerprint: string;
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

export type ProxyStructuredV1Validation = {
  ok: boolean;
  value: ProxyStructuredV1Result | null;
  errors: string[];
};

export function buildProxyStructuredV1SourcePackage(
  sourceDocuments: readonly ProxyStructuredV1SourceDocument[],
  options: { chunkChars?: number } = {},
): ProxyStructuredV1SourcePackage {
  const chunkChars = options.chunkChars ?? 8_000;
  if (!Number.isInteger(chunkChars) || chunkChars < 500) {
    throw new Error("Proxy Structured v1 chunkChars must be an integer of at least 500");
  }
  if (sourceDocuments.length === 0) {
    throw new Error("Proxy Structured v1 requires at least one source document");
  }

  const sorted = [...sourceDocuments].sort((left, right) => left.sequence - right.sequence);
  const documentIds = new Set<string>();
  const sequences = new Set<number>();
  const documents: ProxyStructuredV1SourcePackage["documents"] = [];
  const evidenceBlocks: ProxyStructuredV1EvidenceBlock[] = [];

  for (const source of sorted) {
    if (!nonEmptyText(source.documentId) || documentIds.has(source.documentId)) {
      throw new Error(`Proxy Structured v1 documentId must be non-empty and unique: ${source.documentId}`);
    }
    if (!Number.isInteger(source.sequence) || source.sequence < 0 || sequences.has(source.sequence)) {
      throw new Error(`Proxy Structured v1 sequence must be a unique non-negative integer: ${source.sequence}`);
    }
    if (!nonEmptyText(source.documentType) || !nonEmptyText(source.filename) || !validHttpUrl(source.url)) {
      throw new Error(`Proxy Structured v1 document identity is incomplete: ${source.documentId}`);
    }
    const hasHtml = typeof source.html === "string";
    const hasText = typeof source.text === "string";
    if (hasHtml === hasText) {
      throw new Error(`Proxy Structured v1 document must provide exactly one of html or text: ${source.documentId}`);
    }

    documentIds.add(source.documentId);
    sequences.add(source.sequence);
    const rawSource = hasHtml ? source.html! : source.text!;
    const normalizedText = hasHtml ? normalizeProxyStructuredV1Html(source.html!) : normalizePlainText(source.text!);
    if (!normalizedText) {
      throw new Error(`Proxy Structured v1 document produced no normalized text: ${source.documentId}`);
    }
    documents.push({
      documentId: source.documentId,
      sequence: source.sequence,
      documentType: source.documentType,
      filename: source.filename,
      url: source.url,
      sourceSha256: sha256(rawSource),
      normalizedTextSha256: sha256(normalizedText),
      normalizedTextChars: normalizedText.length,
    });

    const chunks = chunkNeutralText(normalizedText, chunkChars);
    chunks.forEach((text, blockSequence) => {
      evidenceBlocks.push({
        id: `E${evidenceBlocks.length + 1}`,
        documentId: source.documentId,
        documentSequence: source.sequence,
        blockSequence,
        text,
      });
    });
  }

  const sourceFingerprint = sha256(stableJson(documents.map((document) => ({
    documentId: document.documentId,
    sequence: document.sequence,
    documentType: document.documentType,
    filename: document.filename,
    url: document.url,
    sourceSha256: document.sourceSha256,
  }))));
  const packageFingerprint = sha256(stableJson({
    version: PROXY_STRUCTURED_V1_VERSION,
    sourceFingerprint,
    documents,
    evidenceBlocks,
  }));

  return {
    version: PROXY_STRUCTURED_V1_VERSION,
    sourceFingerprint,
    packageFingerprint,
    documents,
    evidenceBlocks,
  };
}

export function buildProxyStructuredV1Prompt(sourcePackage: ProxyStructuredV1SourcePackage) {
  return {
    system: [
      "Extract source-grounded FACTs from the supplied SEC proxy documents.",
      "Use only the supplied evidence blocks. Never infer, calculate, repair, or import outside facts.",
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
        source_fingerprint: sourcePackage.sourceFingerprint,
        response_schema: PROXY_STRUCTURED_V1_RESPONSE_SCHEMA,
      },
      source_manifest: sourcePackage.documents,
      evidence_blocks: sourcePackage.evidenceBlocks,
    }),
    responseFormat: { json_schema: PROXY_STRUCTURED_V1_RESPONSE_SCHEMA },
    providerResponseSchema: PROXY_STRUCTURED_V1_PROVIDER_SCHEMA,
  };
}

export function parseAndValidateProxyStructuredV1(
  outputText: string,
  sourcePackage: Pick<ProxyStructuredV1SourcePackage, "sourceFingerprint" | "evidenceBlocks">,
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
  sourcePackage: Pick<ProxyStructuredV1SourcePackage, "sourceFingerprint" | "evidenceBlocks">,
): ProxyStructuredV1Validation {
  const errors: string[] = [];
  const root = record(value);
  if (!root) return { ok: false, value: null, errors: ["$ must be an object"] };
  exactKeys(root, ["version", "source_fingerprint", "meeting", "proposals", "unresolved"], "$", errors);

  if (root.version !== PROXY_STRUCTURED_V1_VERSION) {
    errors.push(`$.version must equal ${PROXY_STRUCTURED_V1_VERSION}`);
  }
  if (root.source_fingerprint !== sourcePackage.sourceFingerprint) {
    errors.push("$.source_fingerprint must match the supplied source package");
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

export function normalizeProxyStructuredV1Html(html: string) {
  return normalizePlainText(decodeHtmlEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<(br|hr)\b[^>]*\/?\s*>/gi, "\n")
      .replace(/<\/(?:address|article|aside|blockquote|caption|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  ));
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

function chunkNeutralText(text: string, maxChars: number) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      for (let offset = 0; offset < paragraph.length; offset += maxChars) {
        chunks.push(paragraph.slice(offset, offset + maxChars));
      }
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) flush();
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();
  return chunks;
}

function normalizePlainText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
    ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return named[entity.toLowerCase()] ?? match;
  });
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

function validHttpUrl(value: unknown) {
  if (!nonEmptyText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
