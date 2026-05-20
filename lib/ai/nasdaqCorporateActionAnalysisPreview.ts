import { getServerEnv } from "@/lib/env";
import { resolveNewsPromptMarketContext } from "@/lib/newsMarketContext";
import { buildNasdaqCorporateActionAnalysisPrompt } from "@/lib/prompts/nasdaqCorporateActionAnalysis";
import {
  fetchNasdaqCorporateActionsRawItems,
  type NasdaqCorporateActionParsedRawItem,
} from "@/lib/sources/nasdaqtrader/corporateActionsParser";

type PreviewOptions = {
  dryRun?: boolean;
  sourceUniqueId?: string;
  limit?: number;
};

type AnalysisOptions = {
  persistMarketContext?: boolean;
  refreshMarketContext?: boolean;
};

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

const MAX_OUTPUT_TOKENS = 5000;

export async function runNasdaqCorporateActionAnalysisPreview(options: PreviewOptions = {}) {
  const limit = options.sourceUniqueId ? 1 : clampInt(options.limit, 1, 20, 1);
  const rawResult = await fetchNasdaqCorporateActionsRawItems({
    limit,
    sourceUniqueId: options.sourceUniqueId,
    includeArticleBody: true,
    articleBodyLimit: limit,
  });

  const rawItem = rawResult.items[0];
  if (!rawResult.ok || !rawItem) {
    return {
      ok: false,
      stage: "raw_fetch",
      status: rawResult.status,
      error: rawResult.error || "No Nasdaq Corporate Actions raw item returned",
      rawResult,
    };
  }

  const input = await buildInput(rawItem, {
    persistMarketContext: false,
    refreshMarketContext: true,
  });
  const prompt = buildNasdaqCorporateActionAnalysisPrompt(input);

  if (options.dryRun) {
    return {
      ok: true,
      stage: "dry_run",
      status: 200,
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

  const analysisResult = await runNasdaqCorporateActionAnalysisForRawItem(rawItem);

  return {
    ...analysisResult,
    stage: analysisResult.ok ? "complete" : analysisResult.stage,
  };
}

export async function runNasdaqCorporateActionAnalysisForRawItem(
  rawItem: NasdaqCorporateActionParsedRawItem,
  options: AnalysisOptions = {},
) {
  const input = await buildInput(rawItem, options);
  const prompt = buildNasdaqCorporateActionAnalysisPrompt(input);
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

  const openAiResult = await runStructuredOpenAiJson({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  if (!openAiResult.response.ok) {
    return {
      ok: false,
      stage: "openai",
      status: openAiResult.response.status,
      error: openAiResult.body?.error?.message || openAiResult.response.statusText,
      sourceItem: summarizeRawItem(rawItem),
      input,
      rawOpenAIResponse: openAiResult.body,
    };
  }

  const outputText = readResponseOutputText(openAiResult.body);
  const parsedAnalysis = parseAnalysisJson(outputText);
  const analysis = parsedAnalysis ? sanitizeNasdaqCorporateActionAnalysis(parsedAnalysis) : null;
  const usage = openAiResult.body?.usage || null;

  return {
    ok: Boolean(analysis),
    stage: "complete",
    status: analysis ? openAiResult.response.status : 502,
    model: env.openAiModel,
    openAiResponseId: openAiResult.body?.id || null,
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

function sanitizeNasdaqCorporateActionAnalysis(analysis: Record<string, unknown>) {
  return {
    ...analysis,
    quick_take: removeCusipAdministrativeText(readString(analysis.quick_take) || ""),
    summary: removeCusipAdministrativeText(readString(analysis.summary) || ""),
    why_it_matters: removeCusipAdministrativeText(readString(analysis.why_it_matters) || ""),
    score_reason: removeCusipAdministrativeText(readString(analysis.score_reason) || ""),
    bullish_points: removeCusipItems(analysis.bullish_points),
    bearish_points: removeCusipItems(analysis.bearish_points),
    key_evidence: removeCusipItems(analysis.key_evidence),
    what_to_watch_next: removeCusipItems(analysis.what_to_watch_next),
  };
}

function removeCusipItems(value: unknown) {
  if (!Array.isArray(value)) return value;
  return value
    .map((item) => removeCusipAdministrativeText(String(item || "")))
    .filter((item) => item && !/\bCUSIP\b/i.test(item));
}

function removeCusipAdministrativeText(value: string) {
  const text = value.trim();
  if (!text || !/\bCUSIP\b/i.test(text)) return text;
  const withoutCusipSentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence && !/\bCUSIP\b/i.test(sentence))
    .join(" ")
    .trim();

  return withoutCusipSentences || text.replace(/\b[^.!?]*CUSIP[^.!?]*[.!?]?/gi, "").replace(/\s+/g, " ").trim();
}

async function buildInput(rawItem: NasdaqCorporateActionParsedRawItem, options: AnalysisOptions = {}) {
  const payload = rawItem.raw_payload || {};
  const bodyTickers = readTickerMentions(payload.tickers);
  const symbols = bodyTickers.map((ticker) => ticker.ticker);

  return {
    source_code: rawItem.source_code,
    source_name: String(payload.source_name || payload.provider || "Nasdaq Trader Corporate Actions"),
    source_url: rawItem.source_url,
    published_at: rawItem.published_at,
    title: rawItem.title || "",
    body_text: trimForModel(readString(payload.analysis_text) || rawItem.body_text || ""),
    body_tickers: bodyTickers,
    metadata_tickers_debug_only: [],
    market_context: await resolveNewsPromptMarketContext(symbols, {
      refresh: options.refreshMarketContext ?? true,
      persist: Boolean(options.persistMarketContext),
    }),
    corporate_action: readRecord(payload.corporate_action),
    corporate_action_event_family: readString(payload.corporate_action_event_family),
  };
}

async function runStructuredOpenAiJson({
  apiKey,
  model,
  prompt,
  maxOutputTokens,
}: {
  apiKey: string;
  model: string;
  prompt: {
    system: string;
    user: string;
    responseFormat: {
      json_schema: Record<string, unknown>;
    };
  };
  maxOutputTokens: number;
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      instructions: prompt.system,
      input: prompt.user,
      max_output_tokens: maxOutputTokens,
      text: {
        format: {
          ...prompt.responseFormat.json_schema,
          type: "json_schema",
        },
      },
    }),
  });

  const body = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
  return { response, body };
}

function summarizeRawItem(rawItem: NasdaqCorporateActionParsedRawItem) {
  return {
    source_code: rawItem.source_code,
    source_group: rawItem.source_group,
    source_unique_id: rawItem.source_unique_id,
    source_url: rawItem.source_url,
    title: rawItem.title,
    published_at: rawItem.published_at,
    bodyChars: rawItem.body_text?.length || 0,
    analysisChars: readString(rawItem.raw_payload.analysis_text)?.length || 0,
    removedSections: [],
    ticker_source: rawItem.raw_payload.ticker_source || null,
    tickers: readTickerMentions(rawItem.raw_payload.tickers),
    eventFamily: readString(rawItem.raw_payload.corporate_action_event_family),
  };
}

function readTickerMentions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = readRecord(item);
    const ticker = sanitizeTickerSymbol(record?.symbol);
    if (!ticker) return [];
    return [{
      ticker,
      exchange: readString(record?.exchange) || "NASDAQ",
    }];
  });
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

function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return value.slice(start, end + 1);
}

function estimateCost(model: string, usage: OpenAIUsage | null) {
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
    currency: "USD" as const,
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

function trimForModel(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > 18000 ? `${normalized.slice(0, 18000)}\n[TRUNCATED]` : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeTickerSymbol(value: unknown) {
  const text = String(value || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(text) ? text : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}
