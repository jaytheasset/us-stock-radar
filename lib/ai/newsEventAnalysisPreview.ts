import { getServerEnv } from "@/lib/env";
import { evaluateCalendarItemPolicy } from "@/lib/calendarPolicy";
import { resolveNewsPromptMarketContext } from "@/lib/newsMarketContext";
import {
  buildNewsEventAnalysisPrompt,
  type NewsEventAnalysisInput,
  type NewsPromptMarketContext,
} from "@/lib/prompts/newsEventAnalysis";
import { buildNewsClinicalFdaAnalysisPrompt } from "@/lib/prompts/newsClinicalFdaAnalysis";
import {
  buildNewsRouteClassificationPrompt,
  NEWS_ROUTE_VALUES,
  type NewsRouteClassification,
} from "@/lib/prompts/newsRouteClassification";
import { buildNewsSectorThemePolicyAnalysisPrompt } from "@/lib/prompts/newsSectorThemePolicyAnalysis";
import { fetchGlobeNewswireRawItems, type GlobeParsedRawItem, type GlobeTickerMention } from "@/lib/sources/globe/parser";

type PreviewOptions = {
  dryRun?: boolean;
  sourceUniqueId?: string;
  searchLimit?: number;
};

type NewsAnalysisOptions = {
  persistMarketContext?: boolean;
  refreshMarketContext?: boolean;
  marketContextSymbols?: string[];
};

export type NewsAnalysisRawItem = Omit<GlobeParsedRawItem, "source_code"> & {
  source_code: string;
};

const NEWS_ROUTE_CLASSIFICATION_MAX_OUTPUT_TOKENS = 700;
const NEWS_EVENT_ANALYSIS_MAX_OUTPUT_TOKENS = 4000;

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
  skipped?: boolean;
  skipReason?: string;
  model?: string;
  openAiResponseId?: string | null;
  sourceItem: ReturnType<typeof summarizeRawItem>;
  input: NewsEventAnalysisInput;
  routeClassification?: NewsRouteClassification | null;
  analysis?: Record<string, unknown> | null;
  outputText?: string;
  routeOutputText?: string;
  usage?: OpenAIUsage | null;
  routingUsage?: OpenAIUsage | null;
  costEstimate?: CostEstimate | null;
  routingCostEstimate?: CostEstimate | null;
  prompt?: {
    key: string;
    version: string;
    routeKey?: string;
    routeVersion?: string;
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

  const input = await buildInputFromNewsRawItem(rawItem);
  const routePrompt = buildNewsRouteClassificationPrompt(input);
  const prompt = buildNewsEventAnalysisPrompt(input);
  const clinicalFdaPrompt = buildNewsClinicalFdaAnalysisPrompt(input, null);
  const sectorThemePolicyPrompt = buildNewsSectorThemePolicyAnalysisPrompt(input, null);

  if (options.dryRun) {
    return {
      ok: true,
      stage: "dry_run",
      sourceItem: summarizeRawItem(rawItem),
      input,
      prompt: {
        route: {
          key: routePrompt.key,
          version: routePrompt.version,
          system: routePrompt.system,
          responseFormat: routePrompt.responseFormat,
        },
        company: {
          key: prompt.key,
          version: prompt.version,
          system: prompt.system,
          responseFormat: prompt.responseFormat,
        },
        clinical_fda: {
          key: clinicalFdaPrompt.key,
          version: clinicalFdaPrompt.version,
          system: clinicalFdaPrompt.system,
          responseFormat: clinicalFdaPrompt.responseFormat,
        },
        broad_market: {
          key: sectorThemePolicyPrompt.key,
          version: sectorThemePolicyPrompt.version,
          system: sectorThemePolicyPrompt.system,
          responseFormat: sectorThemePolicyPrompt.responseFormat,
        },
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
  rawItem: NewsAnalysisRawItem,
  options: NewsAnalysisOptions = {},
): Promise<NewsEventAnalysisRunResult> {
  const routeInput = buildInputFromGlobeRawItem(rawItem);
  const env = getServerEnv();

  if (!env.openAiApiKey) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: "OPENAI_API_KEY is missing",
      sourceItem: summarizeRawItem(rawItem),
      input: routeInput,
    };
  }

  const routePrompt = buildNewsRouteClassificationPrompt(routeInput);
  let routeResponse = await runStructuredOpenAiJson({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    prompt: routePrompt,
    maxOutputTokens: NEWS_ROUTE_CLASSIFICATION_MAX_OUTPUT_TOKENS,
  });

  if (!routeResponse.response.ok) {
    return {
      ok: false,
      stage: "openai",
      status: routeResponse.response.status,
      error: routeResponse.body?.error?.message || routeResponse.response.statusText,
      sourceItem: summarizeRawItem(rawItem),
      input: routeInput,
      rawOpenAIResponse: routeResponse.body,
    };
  }

  let routeOutputText = readResponseOutputText(routeResponse.body);
  let routeClassification = normalizeNewsRouteClassification(parseAnalysisJson(routeOutputText));
  if (!routeClassification) {
    const retryResponse = await runStructuredOpenAiJson({
      apiKey: env.openAiApiKey,
      model: env.openAiModel,
      prompt: routePrompt,
      maxOutputTokens: NEWS_ROUTE_CLASSIFICATION_MAX_OUTPUT_TOKENS,
    });
    if (retryResponse.response.ok) {
      const retryOutputText = readResponseOutputText(retryResponse.body);
      const retryClassification = normalizeNewsRouteClassification(parseAnalysisJson(retryOutputText));
      if (retryClassification) {
        routeResponse = retryResponse;
        routeOutputText = retryOutputText;
        routeClassification = retryClassification;
      }
    }
  }
  if (!routeClassification) {
    return {
      ok: false,
      stage: "openai",
      status: 502,
      error: "OpenAI route classification did not contain parseable JSON",
      sourceItem: summarizeRawItem(rawItem),
      input: routeInput,
      routeOutputText,
      rawOpenAIResponse: routeResponse.body,
    };
  }

  if (routeClassification.route === "skip") {
    const routingUsage = routeResponse.body?.usage || null;
    return {
      ok: true,
      skipped: true,
      skipReason: routeClassification.reason,
      stage: "complete",
      status: routeResponse.response.status,
      model: env.openAiModel,
      openAiResponseId: routeResponse.body?.id || null,
      sourceItem: summarizeRawItem(rawItem),
      input: routeInput,
      routeClassification,
      analysis: null,
      routeOutputText,
      routingUsage,
      routingCostEstimate: estimateCost(env.openAiModel, routingUsage),
      prompt: {
        key: routePrompt.key,
        version: routePrompt.version,
        routeKey: routePrompt.key,
        routeVersion: routePrompt.version,
      },
    };
  }

  const input = await buildInputFromNewsRawItem(rawItem, {
    persistMarketContext: Boolean(options.persistMarketContext),
    refreshMarketContext: options.refreshMarketContext ?? true,
    marketContextSymbols: routeClassification.candidate_tickers.map((ticker) => ticker.ticker),
  });
  const prompt = buildSecondPassNewsAnalysisPrompt(input, routeClassification);

  const analysisResponse = await runStructuredOpenAiJson({
    apiKey: env.openAiApiKey,
    model: env.openAiModel,
    prompt,
    maxOutputTokens: NEWS_EVENT_ANALYSIS_MAX_OUTPUT_TOKENS,
  });

  if (!analysisResponse.response.ok) {
    return {
      ok: false,
      stage: "openai",
      status: analysisResponse.response.status,
      error: analysisResponse.body?.error?.message || analysisResponse.response.statusText,
      sourceItem: summarizeRawItem(rawItem),
      input,
      routeClassification,
      routeOutputText,
      routingUsage: routeResponse.body?.usage || null,
      routingCostEstimate: estimateCost(env.openAiModel, routeResponse.body?.usage || null),
      rawOpenAIResponse: analysisResponse.body,
    };
  }

  const outputText = readResponseOutputText(analysisResponse.body);
  const analysis = normalizeNewsAnalysis(parseAnalysisJson(outputText), input);
  const usage = analysisResponse.body?.usage || null;
  const routingUsage = routeResponse.body?.usage || null;

  return {
    ok: Boolean(analysis),
    stage: "complete",
    status: analysis ? analysisResponse.response.status : 502,
    model: env.openAiModel,
    openAiResponseId: analysisResponse.body?.id || null,
    sourceItem: summarizeRawItem(rawItem),
    input,
    routeClassification,
    analysis,
    outputText,
    routeOutputText,
    usage,
    routingUsage,
    costEstimate: estimateCost(env.openAiModel, usage),
    routingCostEstimate: estimateCost(env.openAiModel, routingUsage),
    prompt: {
      key: prompt.key,
      version: prompt.version,
      routeKey: routePrompt.key,
      routeVersion: routePrompt.version,
    },
    error: analysis ? undefined : "OpenAI response did not contain parseable JSON",
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

export function buildInputFromGlobeRawItem(item: NewsAnalysisRawItem): NewsEventAnalysisInput {
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
    market_context: null,
  };
}

async function buildInputFromNewsRawItem(
  item: NewsAnalysisRawItem,
  options: NewsAnalysisOptions = {},
): Promise<NewsEventAnalysisInput> {
  const input = buildInputFromGlobeRawItem(item);
  const symbols = [
    ...input.body_tickers.map((ticker) => ticker.ticker),
    ...(options.marketContextSymbols || []),
  ];
  return {
    ...input,
    market_context: await resolveNewsPromptMarketContext(symbols, {
      refresh: options.refreshMarketContext ?? true,
      persist: Boolean(options.persistMarketContext),
    }),
  };
}

function summarizeRawItem(item: NewsAnalysisRawItem) {
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

function normalizeNewsRouteClassification(value: Record<string, unknown> | null): NewsRouteClassification | null {
  if (!value) return null;
  const route = readString(value.route);
  const confidence = readString(value.confidence);
  return {
    route: NEWS_ROUTE_VALUES.includes(route as NewsRouteClassification["route"])
      ? (route as NewsRouteClassification["route"])
      : "company",
    confidence: confidence === "high" || confidence === "low" ? confidence : "medium",
    reason: readString(value.reason) || "",
    candidate_tickers: sanitizeRouteCandidateTickers(value.candidate_tickers),
  };
}

function sanitizeRouteCandidateTickers(value: unknown): NewsRouteClassification["candidate_tickers"] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const record = readRecord(item);
    const ticker = sanitizeTickerSymbol(record?.ticker);
    if (!record || !ticker || seen.has(ticker)) return [];
    seen.add(ticker);
    return [{
      ticker,
      exchange: readString(record.exchange),
      reason: readString(record.reason) || "",
    }];
  }).slice(0, 6);
}

function buildSecondPassNewsAnalysisPrompt(input: NewsEventAnalysisInput, routeClassification: NewsRouteClassification) {
  if (routeClassification.route === "clinical_fda") {
    return buildNewsClinicalFdaAnalysisPrompt(input, routeClassification);
  }
  if (routeClassification.route === "broad_market") {
    return buildNewsSectorThemePolicyAnalysisPrompt(input, routeClassification);
  }
  return buildNewsEventAnalysisPrompt(input, routeClassification);
}

function normalizeNewsAnalysis(analysis: Record<string, unknown> | null, input: NewsEventAnalysisInput) {
  if (!analysis) return null;
  const calendarItems = Array.isArray(analysis.calendar_items) ? analysis.calendar_items : [];
  const primaryTicker = sanitizePrimaryTicker(analysis.primary_ticker);
  const tickers = sanitizeTickerArray(analysis.tickers);
  const excludedRelatedSymbols = new Set(
    [primaryTicker.ticker, ...tickers.map((ticker) => ticker.ticker)].filter(
      (ticker): ticker is string => Boolean(ticker),
    ),
  );
  return {
    ...analysis,
    primary_ticker: primaryTicker,
    tickers,
    related_tickers: sanitizeRelatedTickerArray(analysis.related_tickers, excludedRelatedSymbols),
    offering_terms: normalizeNewsOfferingTerms(analysis.offering_terms, input, primaryTicker.ticker),
    calendar_items: calendarItems.filter((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      return shouldKeepNewsCalendarItem(item as Record<string, unknown>, analysis, input);
    }),
  };
}

function normalizeNewsOfferingTerms(
  value: unknown,
  input: NewsEventAnalysisInput,
  primarySymbol: string | null,
) {
  const record = readRecord(value);
  const isOffering = record?.is_offering === true;
  const offeringTerms = {
    is_offering: isOffering,
    offering_type: readString(record?.offering_type),
    security_type: readString(record?.security_type),
    primary_or_resale: readString(record?.primary_or_resale),
    offering_amount: sanitizeMoneyTerm(record?.offering_amount),
    shares_offered: sanitizeNumberTerm(record?.shares_offered),
    offering_price: sanitizePriceTerm(record?.offering_price),
    warrants: sanitizeWarrantTerms(record?.warrants),
    use_of_proceeds: sanitizeTextTerm(record?.use_of_proceeds),
    closing_date: sanitizeDateTerm(record?.closing_date),
    evidence: sanitizeStringArray(record?.evidence),
    needs_human_review: Boolean(record?.needs_human_review),
  };

  if (!isOffering) {
    return {
      ...emptyNewsOfferingTerms(),
      dilution_metrics: emptyNewsOfferingDilutionMetrics(),
      market_context_used: null,
    };
  }

  const marketContext = findOfferingMarketContext(input, primarySymbol);
  return {
    ...offeringTerms,
    market_context_used: marketContext
      ? {
          symbol: marketContext.symbol,
          price: marketContext.price,
          previous_close: marketContext.previous_close,
          market_cap: marketContext.market_cap,
          shares_outstanding: marketContext.shares_outstanding,
          public_float: marketContext.public_float,
          volume: marketContext.volume,
          avg_volume: marketContext.avg_volume,
          as_of: marketContext.as_of,
          data_quality: marketContext.data_quality,
        }
      : null,
    dilution_metrics: buildNewsOfferingDilutionMetrics(offeringTerms, marketContext),
  };
}

function emptyNewsOfferingTerms() {
  return {
    is_offering: false,
    offering_type: null,
    security_type: null,
    primary_or_resale: null,
    offering_amount: sanitizeMoneyTerm(null),
    shares_offered: sanitizeNumberTerm(null),
    offering_price: sanitizePriceTerm(null),
    warrants: sanitizeWarrantTerms(null),
    use_of_proceeds: sanitizeTextTerm(null),
    closing_date: sanitizeDateTerm(null),
    evidence: [],
    needs_human_review: false,
  };
}

function sanitizeMoneyTerm(value: unknown) {
  const record = readRecord(value);
  return {
    value_text: readString(record?.value_text),
    amount: finiteNumber(record?.amount) ?? parseLooseNumber(record?.value_text),
    currency: readString(record?.currency),
    evidence: readString(record?.evidence),
  };
}

function sanitizeNumberTerm(value: unknown) {
  const record = readRecord(value);
  return {
    value_text: readString(record?.value_text),
    count: finiteNumber(record?.count) ?? parseLooseNumber(record?.value_text),
    evidence: readString(record?.evidence),
  };
}

function sanitizePriceTerm(value: unknown) {
  const record = readRecord(value);
  return {
    value_text: readString(record?.value_text),
    price: finiteNumber(record?.price) ?? parseLooseNumber(record?.value_text),
    currency: readString(record?.currency),
    evidence: readString(record?.evidence),
  };
}

function sanitizeTextTerm(value: unknown) {
  const record = readRecord(value);
  return {
    value_text: readString(record?.value_text),
    evidence: readString(record?.evidence),
  };
}

function sanitizeDateTerm(value: unknown) {
  const record = readRecord(value);
  const precision = readString(record?.date_precision);
  return {
    value: readString(record?.value),
    date_precision:
      precision === "exact" || precision === "month" || precision === "quarter" || precision === "year"
        ? precision
        : "unknown",
    evidence: readString(record?.evidence),
  };
}

function sanitizeWarrantTerms(value: unknown) {
  const record = readRecord(value);
  return {
    included: record?.included === true,
    coverage_text: readString(record?.coverage_text),
    exercise_price: sanitizePriceTerm(record?.exercise_price),
    expiration_text: readString(record?.expiration_text),
    evidence: readString(record?.evidence),
  };
}

function buildNewsOfferingDilutionMetrics(
  offeringTerms: {
    offering_amount: ReturnType<typeof sanitizeMoneyTerm>;
    shares_offered: ReturnType<typeof sanitizeNumberTerm>;
    offering_price: ReturnType<typeof sanitizePriceTerm>;
  },
  marketContext: NewsPromptMarketContext["items"][number] | null,
) {
  const offeringAmount = offeringTerms.offering_amount.amount;
  const sharesOffered = offeringTerms.shares_offered.count;
  const offeringPrice = offeringTerms.offering_price.price;
  const marketPrice = marketContext?.price ?? marketContext?.previous_close ?? null;
  const marketCap = marketContext?.market_cap ?? null;
  const sharesOutstanding = marketContext?.shares_outstanding ?? null;
  const publicFloat = marketContext?.public_float ?? null;
  const estimatedDilutionPercent = percent(sharesOffered, sharesOutstanding);
  const floatOverhangPercent = percent(sharesOffered, publicFloat);
  const offeringAmountPercentOfMarketCap = percent(offeringAmount, marketCap);
  const discountToMarketPercent =
    isPositiveNumber(offeringPrice) && isPositiveNumber(marketPrice)
      ? roundPercent(((marketPrice - offeringPrice) / marketPrice) * 100)
      : null;
  const maxShareImpactPercent = maxNumber([estimatedDilutionPercent, floatOverhangPercent]);

  return {
    available: Boolean(
      offeringAmount ||
        sharesOffered ||
        offeringPrice ||
        marketCap ||
        sharesOutstanding ||
        publicFloat ||
        estimatedDilutionPercent ||
        offeringAmountPercentOfMarketCap,
    ),
    shares_offered: sharesOffered,
    shares_outstanding_market: sharesOutstanding,
    public_float_market: publicFloat,
    market_cap: marketCap,
    market_reference_price: marketPrice,
    offering_amount: offeringAmount,
    offering_price: offeringPrice,
    estimated_dilution_percent: estimatedDilutionPercent,
    float_overhang_percent: floatOverhangPercent,
    offering_amount_percent_of_market_cap: offeringAmountPercentOfMarketCap,
    discount_to_market_percent: discountToMarketPercent,
    max_share_impact_percent: maxShareImpactPercent,
    dilution_scale: classifyNewsDilutionScale(maxShareImpactPercent, offeringAmountPercentOfMarketCap),
    calculation_notes: buildNewsOfferingCalculationNotes({
      sharesOffered,
      sharesOutstanding,
      publicFloat,
      marketCap,
      marketPrice,
    }),
  };
}

function emptyNewsOfferingDilutionMetrics() {
  return {
    available: false,
    shares_offered: null,
    shares_outstanding_market: null,
    public_float_market: null,
    market_cap: null,
    market_reference_price: null,
    offering_amount: null,
    offering_price: null,
    estimated_dilution_percent: null,
    float_overhang_percent: null,
    offering_amount_percent_of_market_cap: null,
    discount_to_market_percent: null,
    max_share_impact_percent: null,
    dilution_scale: "unknown",
    calculation_notes: [],
  };
}

function findOfferingMarketContext(input: NewsEventAnalysisInput, primarySymbol: string | null) {
  const items = input.market_context?.items || [];
  if (!items.length) return null;
  if (primarySymbol) {
    const match = items.find((item) => item.symbol === primarySymbol);
    if (match) return match;
  }
  return items[0] || null;
}

function buildNewsOfferingCalculationNotes({
  sharesOffered,
  sharesOutstanding,
  publicFloat,
  marketCap,
  marketPrice,
}: {
  sharesOffered: number | null;
  sharesOutstanding: number | null;
  publicFloat: number | null;
  marketCap: number | null;
  marketPrice: number | null;
}) {
  const notes: string[] = [];
  if (!sharesOffered) notes.push("shares_offered_not_available");
  if (!sharesOutstanding) notes.push("shares_outstanding_not_available");
  if (!publicFloat) notes.push("public_float_not_available");
  if (!marketCap) notes.push("market_cap_not_available");
  if (!marketPrice) notes.push("market_price_not_available");
  return notes;
}

function classifyNewsDilutionScale(shareImpactPercent: number | null, amountPercent: number | null) {
  const value = Math.max(shareImpactPercent || 0, amountPercent || 0);
  if (!value) return "unknown";
  if (value >= 50) return "severe";
  if (value >= 25) return "high";
  if (value >= 10) return "elevated";
  if (value >= 5) return "moderate";
  return "low";
}

function shouldKeepNewsCalendarItem(
  item: Record<string, unknown>,
  analysis: Record<string, unknown>,
  input: NewsEventAnalysisInput,
) {
  const calendarType = String(item.calendar_event_type || "");
  return evaluateCalendarItemPolicy({
    sourceGroup: "news",
    calendarEventType: calendarType,
    calendarTitle: readString(item.calendar_title),
    evidence: readString(item.evidence),
    datePrecision: readString(item.date_precision),
    eventDate: readString(item.event_date),
    estimatedStartDate: readString(item.estimated_start_date),
    estimatedEndDate: readString(item.estimated_end_date),
  }).keep;
}

function sanitizePrimaryTicker(value: unknown) {
  const record = readRecord(value);
  const ticker = sanitizeTickerSymbol(record?.ticker);
  if (!ticker) return { ticker: null, exchange: null };
  return {
    ticker,
    exchange: readString(record?.exchange),
  };
}

function sanitizeTickerArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = readRecord(item);
    const ticker = sanitizeTickerSymbol(record?.ticker);
    if (!record || !ticker) return [];

    return [
      {
        ticker,
        exchange: readString(record.exchange) || "",
        role: readString(record.role) || "related",
      },
    ];
  });
}

function sanitizeRelatedTickerArray(value: unknown, excludedSymbols: Set<string>) {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = readRecord(item);
    const ticker = sanitizeTickerSymbol(record?.ticker);
    if (!record || !ticker) return [];
    if (excludedSymbols.has(ticker)) return [];

    return [
      {
        ticker,
        exchange: readString(record.exchange),
        reason: readString(record.reason) || "",
      },
    ];
  });
}

function sanitizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = readString(item);
    return text ? [text] : [];
  });
}

function sanitizeTickerSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/^\$/, "");
  const symbol = (raw.includes(":") ? raw.split(":").pop() || "" : raw).trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,5}$/.test(symbol) ? symbol : null;
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

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLooseNumber(value: unknown) {
  const text = readString(value)?.toLowerCase();
  if (!text) return null;
  const match = text.match(/(\d[\d,.]*)\s*(thousand|million|billion|k|m|bn)?/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const scale = match[2]?.toLowerCase();
  if (scale === "thousand" || scale === "k") return base * 1_000;
  if (scale === "million" || scale === "m") return base * 1_000_000;
  if (scale === "billion" || scale === "bn") return base * 1_000_000_000;
  return base;
}

function percent(numerator: number | null, denominator: number | null) {
  if (!isPositiveNumber(numerator) || !isPositiveNumber(denominator)) return null;
  return roundPercent((numerator / denominator) * 100);
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundPercent(value: number) {
  return Number(value.toFixed(2));
}

function maxNumber(values: Array<number | null>) {
  const numbers = values.filter(isPositiveNumber);
  return numbers.length ? Math.max(...numbers) : null;
}

function trimForModel(value: string) {
  const normalized = value.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > 18000 ? `${normalized.slice(0, 18000)}\n\n[TRUNCATED]` : normalized;
}
