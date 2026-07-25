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
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  prompt: StructuredJsonPrompt;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
}): Promise<GeminiStructuredJsonRun> {
  try {
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

function readGeminiThinkingConfig(model: string) {
  if (!/^gemini-2\.5-flash/.test(model.trim().toLowerCase())) return {};
  return {
    thinkingConfig: {
      thinkingBudget: 0,
    },
  };
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
