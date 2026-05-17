import { getServerEnv } from "@/lib/env";
import { buildNewsEventAnalysisPrompt, type NewsEventAnalysisInput } from "@/lib/prompts/newsEventAnalysis";
import { fetchGlobeNewswireRawItems, type GlobeParsedRawItem, type GlobeTickerMention } from "@/lib/sources/globe/parser";

type PreviewOptions = {
  dryRun?: boolean;
  sourceUniqueId?: string;
  searchLimit?: number;
};

const NEWS_EVENT_ANALYSIS_MAX_OUTPUT_TOKENS = 4000;
const NEWS_CALENDAR_EVENT_TYPE_ALLOWLIST = new Set([
  "earnings_release",
  "earnings_call",
  "investor_day",
  "conference_presentation",
  "ex_dividend_date",
  "dividend_record_date",
  "dividend_payment_date",
  "fda_pdufa_date",
  "fda_advisory_committee",
  "clinical_data_readout",
  "medical_conference",
]);

type OpenAIResponseBody = {
  id?: string;
  status?: string;
  output_text?: string;
  usage?: OpenAIUsage;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

type OpenAIUsage = {
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

type CostEstimate = {
  model: string;
  currency: "USD";
  estimatedUsd: number;
  inputTokens: number;
  cachedInputTokens: number;
  billedInputTokens: number;
  outputTokens: number;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  pricing: string;
};

export type NewsEventAnalysisRunResult = {
  ok: boolean;
  stage: "openai" | "complete";
  status: number;
  model?: string;
  openAiResponseId?: string | null;
  sourceItem: ReturnType<typeof summarizeRawItem>;
  input: NewsEventAnalysisInput;
  analysis?: Record<string, unknown> | null;
  outputText?: string;
  usage?: OpenAIUsage | null;
  costEstimate?: CostEstimate | null;
  prompt?: {
    key: string;
    version: string;
  };
  error?: string;
  rawOpenAIResponse?: OpenAIResponseBody | null;
};

export async function runNewsEventAnalysisPreview(options: PreviewOptions = {}) {
  const fetchLimit = options.sourceUniqueId ? clampInt(options.searchLimit, 1, 50, 20) : 1;
  const rawResult = await fetchGlobeNewswireRawItems({
    limit: fetchLimit,
    includeArticleBody: true,
    articleBodyLimit: fetchLimit,
  });

  const rawItem = options.sourceUniqueId
    ? rawResult.items.find((item) => item.source_unique_id === options.sourceUniqueId)
    : rawResult.items[0];

  if (!rawResult.ok || !rawItem) {
    return {
      ok: false,
      stage: "raw_fetch",
      status: rawResult.status,
      error: rawResult.error || sourceItemNotFoundMessage(options.sourceUniqueId, fetchLimit),
      rawResult,
    };
  }

  const input = buildInputFromGlobeRawItem(rawItem);
  const prompt = buildNewsEventAnalysisPrompt(input);

  if (options.dryRun) {
    return {
      ok: true,
      stage: "dry_run",
      sourceItem: summarizeRawItem(rawItem),
      input,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        system: prompt.system,
        responseFormat: prompt.responseFormat,
      },
      analysis: null,
    };
  }

  const env = getServerEnv();
  if (!env.openAiApiKey) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: "OPENAI_API_KEY is missing",
      sourceItem: summarizeRawItem(rawItem),
      input,
    };
  }

  const analysisResult = await runNewsEventAnalysisForRawItem(rawItem);

  return {
    ...analysisResult,
    stage: analysisResult.ok ? "complete" : analysisResult.stage,
  };
}

export async function runNewsEventAnalysisForRawItem(
  rawItem: GlobeParsedRawItem,
): Promise<NewsEventAnalysisRunResult> {
  const input = buildInputFromGlobeRawItem(rawItem);
  const prompt = buildNewsEventAnalysisPrompt(input);
  const env = getServerEnv();

  if (!env.openAiApiKey) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: "OPENAI_API_KEY is missing",
      sourceItem: summarizeRawItem(rawItem),
      input,
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.openAiModel,
      instructions: prompt.system,
      input: prompt.user,
      max_output_tokens: NEWS_EVENT_ANALYSIS_MAX_OUTPUT_TOKENS,
      text: {
        format: {
          ...prompt.responseFormat.json_schema,
          type: "json_schema",
        },
      },
    }),
  });

  const responseBody = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
  if (!response.ok) {
    return {
      ok: false,
      stage: "openai",
      status: response.status,
      error: responseBody?.error?.message || response.statusText,
      sourceItem: summarizeRawItem(rawItem),
      input,
      rawOpenAIResponse: responseBody,
    };
  }

  const outputText = readResponseOutputText(responseBody);
  const analysis = filterNewsCalendarItems(parseAnalysisJson(outputText));
  const usage = responseBody?.usage || null;

  return {
    ok: Boolean(analysis),
    stage: "complete",
    status: analysis ? response.status : 502,
    model: env.openAiModel,
    openAiResponseId: responseBody?.id || null,
    sourceItem: summarizeRawItem(rawItem),
    input,
    analysis,
    outputText,
    usage,
    costEstimate: estimateCost(env.openAiModel, usage),
    prompt: {
      key: prompt.key,
      version: prompt.version,
    },
    error: analysis ? undefined : "OpenAI response did not contain parseable JSON",
  };
}

export function buildInputFromGlobeRawItem(item: GlobeParsedRawItem): NewsEventAnalysisInput {
  const articlePayload = readRecord(item.raw_payload.article_payload);
  const metadataTickers = readTickerMentions(articlePayload?.metadata_tickers);
  const bodyTickers = readTickerMentions(articlePayload?.body_tickers || item.raw_payload.tickers);
  const analysisText =
    readString(item.raw_payload.analysis_text) ||
    readString(articlePayload?.analysis_text) ||
    item.body_text ||
    String(item.raw_payload.teaser || "");

  return {
    source_code: item.source_code,
    source_name: String(item.raw_payload.source_name || item.raw_payload.provider || "GlobeNewswire"),
    source_url: item.source_url,
    published_at: item.published_at,
    title: item.title || "",
    body_text: trimForModel(analysisText),
    body_tickers: bodyTickers.map((ticker) => ({
      ticker: ticker.symbol,
      exchange: ticker.exchange,
    })),
    metadata_tickers_debug_only: metadataTickers.map((ticker) => ({
      ticker: ticker.symbol,
      exchange: ticker.exchange,
    })),
  };
}

function summarizeRawItem(item: GlobeParsedRawItem) {
  return {
    source_code: item.source_code,
    source_group: item.source_group,
    source_unique_id: item.source_unique_id,
    source_url: item.source_url,
    title: item.title,
    published_at: item.published_at,
    bodyChars: item.body_text?.length || 0,
    analysisChars: readString(item.raw_payload.analysis_text)?.length || 0,
    removedSections: item.raw_payload.removed_analysis_sections || [],
    ticker_source: item.raw_payload.ticker_source || null,
  };
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

function sourceItemNotFoundMessage(sourceUniqueId: string | undefined, searchLimit: number) {
  if (!sourceUniqueId) return "No GlobeNewswire raw item returned";
  return `GlobeNewswire raw item ${sourceUniqueId} was not found in the latest ${searchLimit} items`;
}

function estimateCost(model: string, usage: OpenAIUsage | null): CostEstimate | null {
  const pricing = getPricing(model);
  if (!pricing || !usage) return null;

  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    numberValue(usage.input_tokens_details?.cached_tokens),
  );
  const billedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const estimatedUsd =
    (billedInputTokens * pricing.inputUsdPerMillion +
      cachedInputTokens * pricing.cachedInputUsdPerMillion +
      outputTokens * pricing.outputUsdPerMillion) /
    1_000_000;

  return {
    model,
    currency: "USD",
    estimatedUsd: Number(estimatedUsd.toFixed(8)),
    inputTokens,
    cachedInputTokens,
    billedInputTokens,
    outputTokens,
    inputUsdPerMillion: pricing.inputUsdPerMillion,
    cachedInputUsdPerMillion: pricing.cachedInputUsdPerMillion,
    outputUsdPerMillion: pricing.outputUsdPerMillion,
    pricing: pricing.label,
  };
}

function getPricing(model: string) {
  const normalized = model.trim().toLowerCase();
  if (normalized === "gpt-5-mini") {
    return {
      inputUsdPerMillion: 0.25,
      cachedInputUsdPerMillion: 0.025,
      outputUsdPerMillion: 2,
      label: "OpenAI API pricing for gpt-5-mini checked 2026-05-17",
    };
  }

  return null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readResponseOutputText(body: OpenAIResponseBody | null) {
  if (!body) return "";
  if (typeof body.output_text === "string") return body.output_text;

  const parts: string[] = [];
  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
    }
  }

  return parts.join("");
}

function parseAnalysisJson(value: string) {
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

function filterNewsCalendarItems(analysis: Record<string, unknown> | null) {
  if (!analysis) return null;
  const calendarItems = Array.isArray(analysis.calendar_items) ? analysis.calendar_items : [];
  return {
    ...analysis,
    calendar_items: calendarItems.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      return NEWS_CALENDAR_EVENT_TYPE_ALLOWLIST.has(String((item as Record<string, unknown>).calendar_event_type || ""));
    }),
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

function readTickerMentions(value: unknown): GlobeTickerMention[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      if (!record) return null;
      const symbol = record?.symbol || record?.ticker;
      const exchange = record?.exchange;
      if (typeof symbol !== "string" || typeof exchange !== "string") return null;
      return {
        symbol: symbol.toUpperCase(),
        exchange,
        raw: typeof record.raw === "string" ? record.raw : `${exchange}:${symbol}`,
        usListed: Boolean(record.usListed),
      };
    })
    .filter((item): item is GlobeTickerMention => Boolean(item));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function trimForModel(value: string) {
  const normalized = value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > 18000 ? `${normalized.slice(0, 18000)}\n\n[TRUNCATED]` : normalized;
}
