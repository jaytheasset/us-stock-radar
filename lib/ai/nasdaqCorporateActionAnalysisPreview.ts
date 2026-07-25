import { getServerEnv } from "@/lib/env";
import { sanitizeNasdaqCorporateActionAnalysis } from "@/lib/ai/nasdaqCorporateActionAnalysis";
import { runNewsGeminiAnalysis } from "@/lib/ai/newsGeminiAnalysis";
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

  if (options.dryRun) {
    const input = await buildInput(rawItem, {
      persistMarketContext: false,
      refreshMarketContext: true,
    });
    const prompt = buildNasdaqCorporateActionAnalysisPrompt(input);
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
  const env = getServerEnv();
  if (!env.geminiApiKey) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: "GEMINI_API_KEY is missing",
      sourceItem: summarizeRawItem(rawItem),
      input: await buildInput(rawItem, {
        ...options,
        refreshMarketContext: false,
      }),
    };
  }

  const input = await buildInput(rawItem, options);
  const prompt = buildNasdaqCorporateActionAnalysisPrompt(input);
  const model = env.newsGeminiModel;
  const result = await runNewsGeminiAnalysis({
    apiKey: env.geminiApiKey,
    model,
    prompt,
    input,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    normalizeAnalysis: (value) =>
      value ? sanitizeNasdaqCorporateActionAnalysis(value) : null,
  });

  if (result.stage === "analysis_error") {
    return {
      ok: false,
      stage: "openai",
      status: result.run.responseOk ? 502 : result.run.status,
      error: result.error,
      sourceItem: summarizeRawItem(rawItem),
      input,
      outputText: result.run.outputText,
      usage: result.run.usage,
      rawOpenAIResponse: result.run.body,
    };
  }

  const outputText = result.run.outputText;
  const analysis = result.analysis;
  const usage = result.run.usage;

  return {
    ok: true,
    stage: "complete",
    status: result.run.status,
    model,
    openAiResponseId: result.run.responseId,
    sourceItem: summarizeRawItem(rawItem),
    input,
    analysis,
    outputText,
    usage,
    costEstimate: null,
    prompt: {
      key: prompt.key,
      version: prompt.version,
    },
  };
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

function clampInt(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}
