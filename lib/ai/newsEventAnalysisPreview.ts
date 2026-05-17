import { getServerEnv } from "@/lib/env";
import { buildNewsEventAnalysisPrompt, type NewsEventAnalysisInput } from "@/lib/prompts/newsEventAnalysis";
import { fetchGlobeNewswireRawItems, type GlobeParsedRawItem, type GlobeTickerMention } from "@/lib/sources/globe/parser";

type PreviewOptions = {
  dryRun?: boolean;
};

type OpenAIResponseBody = {
  id?: string;
  status?: string;
  output_text?: string;
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
  error?: string;
  rawOpenAIResponse?: OpenAIResponseBody | null;
};

export async function runNewsEventAnalysisPreview(options: PreviewOptions = {}) {
  const rawResult = await fetchGlobeNewswireRawItems({
    limit: 1,
    includeArticleBody: true,
    articleBodyLimit: 1,
  });

  if (!rawResult.ok || !rawResult.items[0]) {
    return {
      ok: false,
      stage: "raw_fetch",
      status: rawResult.status,
      error: rawResult.error || "No GlobeNewswire raw item returned",
      rawResult,
    };
  }

  const rawItem = rawResult.items[0];
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
      max_output_tokens: 2500,
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
  const analysis = parseAnalysisJson(outputText);

  return {
    ok: Boolean(analysis),
    stage: "complete",
    status: response.status,
    model: env.openAiModel,
    openAiResponseId: responseBody?.id || null,
    sourceItem: summarizeRawItem(rawItem),
    input,
    analysis,
    outputText,
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
    source_url: item.source_url,
    title: item.title,
    published_at: item.published_at,
    bodyChars: item.body_text?.length || 0,
    analysisChars: readString(item.raw_payload.analysis_text)?.length || 0,
    removedSections: item.raw_payload.removed_analysis_sections || [],
    ticker_source: item.raw_payload.ticker_source || null,
  };
}

function readResponseOutputText(body: OpenAIResponseBody | null) {
  if (!body) return "";
  if (typeof body.output_text === "string") return body.output_text;

  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }

  return "";
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
