export type GeminiUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
  [key: string]: unknown;
};

export type GeminiResponseBody = {
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
    totalTokenCount?: number;
    [key: string]: unknown;
  };
  error?: {
    message?: string;
  };
};

export type StructuredJsonPrompt = {
  system: string;
  user: string;
  responseFormat: {
    json_schema: Record<string, unknown>;
  };
};

export type GeminiResponseSchemaPolicy = "prompt" | "omit";

export type GeminiStructuredJsonRun = {
  ok: boolean;
  responseOk: boolean;
  status: number;
  statusText: string;
  model: string;
  responseId: string | null;
  outputText: string;
  parsed: Record<string, unknown> | null;
  usage: GeminiUsage | null;
  error?: string;
  body: GeminiResponseBody | null;
};

export async function runStructuredGeminiJson({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
  responseSchemaPolicy = "prompt",
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  prompt: StructuredJsonPrompt;
  maxOutputTokens: number;
  responseSchemaPolicy?: GeminiResponseSchemaPolicy;
  fetchImpl?: typeof fetch;
}): Promise<GeminiStructuredJsonRun> {
  try {
    const responseSchema =
      responseSchemaPolicy === "prompt"
        ? readGeminiResponseSchema(prompt)
        : undefined;
    const response = await fetchImpl(buildGeminiGenerateContentUrl(apiKey, model), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
          ...(responseSchema ? { responseSchema } : {}),
          maxOutputTokens,
          temperature: 0,
          ...readGeminiThinkingConfig(model),
        },
      }),
    });
    const body = (await response.json().catch(() => null)) as GeminiResponseBody | null;
    const outputText = readGeminiResponseOutputText(body);
    const finishReason = readGeminiFinishReason(body);
    const stopError =
      finishReason && finishReason !== "STOP" && !outputText
        ? `Gemini generation stopped: ${finishReason}`
        : null;
    const parsed = response.ok && !stopError ? parseStructuredJson(outputText) : null;
    const error =
      stopError ||
      (response.ok
        ? parsed
          ? undefined
          : "Gemini response did not contain parseable JSON"
        : body?.error?.message || response.statusText || `<HTTP ${response.status}>`);

    return {
      ok: response.ok && !stopError && Boolean(parsed),
      responseOk: response.ok,
      status: response.status,
      statusText: response.statusText,
      model,
      responseId: body?.responseId || null,
      outputText,
      parsed,
      usage: normalizeGeminiUsage(body),
      error: error || undefined,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      responseOk: false,
      status: 0,
      statusText: "",
      model,
      responseId: null,
      outputText: "",
      parsed: null,
      usage: null,
      error: error instanceof Error ? error.message : String(error),
      body: null,
    };
  }
}

export function parseStructuredJson(value: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    const extracted = extractJsonObject(value);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export function toGeminiResponseSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => toGeminiResponseSchema(item));
  const record = readRecord(value);
  if (!record) return value;

  const output: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(record)) {
    if (key === "additionalProperties") continue;
    if (key === "maxLength") continue;
    if (key === "maxItems") {
      if (isGeminiProviderBoundedArraySchema(record)) output[key] = childValue;
      continue;
    }
    if (key === "type" && Array.isArray(childValue)) {
      const nonNullType = childValue.find((item) => item !== "null");
      if (typeof nonNullType === "string") {
        output.type = nonNullType;
        if (childValue.includes("null")) output.nullable = true;
      }
      continue;
    }
    output[key] = toGeminiResponseSchema(childValue);
  }

  const maxLength = finiteNumber(record.maxLength);
  if (maxLength !== null && maxLength > 0) {
    const existingDescription = stringValue(output.description);
    const lengthGuidance = `Keep this string within ${maxLength} characters.`;
    output.description = existingDescription
      ? `${existingDescription} ${lengthGuidance}`
      : lengthGuidance;
  }

  return output;
}

function readGeminiResponseSchema(prompt: StructuredJsonPrompt) {
  const schema = readRecord(prompt.responseFormat.json_schema.schema);
  return schema ? toGeminiResponseSchema(schema) : undefined;
}

function readGeminiThinkingConfig(model: string) {
  if (!/^gemini-2\.5-flash/.test(model.trim().toLowerCase())) return {};
  return {
    thinkingConfig: {
      thinkingBudget: 0,
    },
  };
}

function isGeminiProviderBoundedArraySchema(record: Record<string, unknown>) {
  if (record.type !== "array") return false;

  const description = stringValue(record.description);
  const limits = new Map<number, RegExp>([
    [1, /never return more than one item/i],
    [2, /never return more than two items/i],
    [3, /never return more than three items/i],
    [4, /never return more than four items/i],
  ]);
  const maxItems = finiteNumber(record.maxItems);
  return maxItems !== null && Boolean(limits.get(maxItems)?.test(description));
}

function buildGeminiGenerateContentUrl(apiKey: string, model: string) {
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent`);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

function readGeminiResponseOutputText(body: GeminiResponseBody | null) {
  if (!body?.candidates?.length) return "";
  return body.candidates
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();
}

function readGeminiFinishReason(body: GeminiResponseBody | null) {
  return body?.candidates?.map((candidate) => candidate.finishReason).find(Boolean) || null;
}

function normalizeGeminiUsage(body: GeminiResponseBody | null): GeminiUsage | null {
  const usage = body?.usageMetadata;
  if (!usage) return null;
  return {
    input_tokens: usage.promptTokenCount,
    output_tokens: usage.candidatesTokenCount,
    total_tokens: usage.totalTokenCount,
    ...usage,
  };
}

function extractJsonObject(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{") && fenced.endsWith("}")) return fenced;

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return value.slice(start, end + 1);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
