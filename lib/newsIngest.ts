import { randomUUID } from "node:crypto";
import {
  NEWS_EVENT_ANALYSIS_PROMPT_KEY,
  NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
  NEWS_EVENT_TYPE_VALUES,
  SIGNAL_VALUES,
} from "@/lib/prompts/newsEventAnalysis";
import { evaluateCalendarItemPolicy } from "@/lib/calendarPolicy";
import { getCalendarEventGroup, normalizeCalendarEventType } from "@/lib/calendarEventRegistry";
import { runNewsEventAnalysisForRawItem } from "@/lib/ai/newsEventAnalysisPreview";
import { runNasdaqCorporateActionAnalysisForRawItem } from "@/lib/ai/nasdaqCorporateActionAnalysisPreview";
import { prepareSourceHydrationBatch } from "@/lib/sourceHydrationIngestPlan";
import { fetchGlobeNewswireRawItems, type GlobeParsedRawItem } from "@/lib/sources/globe/parser";
import {
  fetchBusinessWireRawItems,
  hydrateBusinessWireRawItems,
  type BusinessWireParsedRawItem,
} from "@/lib/sources/businesswire/parser";
import { fetchPRNewswireRawItems } from "@/lib/sources/prnewswire/parser";
import { fetchNewsfileRawItems } from "@/lib/sources/newsfile/parser";
import {
  fetchAccesswireRawItems,
  hydrateAccesswireRawItems,
  type AccesswireParsedRawItem,
} from "@/lib/sources/accesswire/parser";
import { fetchOfacRawItems } from "@/lib/sources/ofac/parser";
import { fetchDojRawItems } from "@/lib/sources/doj/parser";
import { fetchDeaRawItems } from "@/lib/sources/dea/parser";
import { fetchWhiteHouseRawItems } from "@/lib/sources/whitehouse/parser";
import { fetchFdaRawItems } from "@/lib/sources/fda/parser";
import { fetchNasdaqTraderRawItems } from "@/lib/sources/nasdaqtrader/parser";
import { fetchNasdaqCorporateActionsRawItems } from "@/lib/sources/nasdaqtrader/corporateActionsParser";
import { canonicalizeAnalysisTickersWithCache } from "@/lib/tickerCanonicalizer";
import { buildNewsTickerProxiesWithCache, type NewsTickerProxy } from "@/lib/newsTickerProxies";
import { supabaseDelete, supabaseSelect, supabaseUpsert } from "@/lib/supabase";

type SourceGroup = "news" | "filings" | "market";
type MarketScope = "company" | "sector" | "theme" | "macro";
type Signal = (typeof SIGNAL_VALUES)[number];
type DeliveryLevel = "archive" | "feed" | "alert";
type Impact = "high" | "medium" | "low";
type AnalysisScope = "company" | "sector" | "theme" | "market";
type TickerRole =
  | "primary"
  | "related"
  | "peer"
  | "customer"
  | "supplier"
  | "counterparty"
  | "mentioned"
  | "sector_constituent"
  | "theme_constituent";

type NewsIngestOptions = {
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
  sourceUniqueId?: string;
  haltDate?: string;
  resumptionDate?: string;
};

type NewsRawItem = Omit<GlobeParsedRawItem, "source_code"> & {
  source_code: string;
};

type NewsRawFetchResult = {
  ok: boolean;
  status: number;
  error?: string;
  items: NewsRawItem[];
  diagnostics: Record<string, unknown>;
};

type NewsRawHydrationResult = {
  items: NewsRawItem[];
  diagnostics: Record<string, unknown>;
};

type NewsSourceConfig = {
  sourceCode: string;
  sourceName: string;
  parserName: string;
  fetchErrorLabel: string;
  ingestErrorLabel: string;
  fetchRawItems: (options: {
    limit: number;
    sourceUniqueId?: string;
    haltDate?: string;
    resumptionDate?: string;
    includeArticleBody: boolean;
    articleBodyLimit: number;
  }) => Promise<NewsRawFetchResult>;
  hydrateRawItems?: (
    items: NewsRawItem[],
    options: { limit: number },
  ) => Promise<NewsRawHydrationResult>;
};

type EventDedupe = {
  key: string | null;
  normalizedTitle: string;
  sourceCode: string;
  eventType: string;
  marketScope: MarketScope;
  publishedDate: string | null;
  topicTokens: string[];
};

type DuplicateInRun = {
  key: string | null;
  tokenOverlap: number | null;
};

type PersistedRow = Record<string, unknown>;

const allowedEventTypes = new Set<string>(NEWS_EVENT_TYPE_VALUES);
const allowedSignals = new Set<string>(SIGNAL_VALUES);
const allowedTickerRoles = new Set<string>([
  "primary",
  "related",
  "peer",
  "customer",
  "supplier",
  "counterparty",
  "mentioned",
  "sector_constituent",
  "theme_constituent",
]);

export async function runGlobeNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "globe",
      sourceName: "GlobeNewswire",
      parserName: "globe",
      fetchErrorLabel: "Globe raw fetch failed",
      ingestErrorLabel: "Globe ingest error",
      fetchRawItems: fetchGlobeNewswireRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runBusinessWireNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "businesswire",
      sourceName: "Business Wire",
      parserName: "businesswire",
      fetchErrorLabel: "Business Wire raw fetch failed",
      ingestErrorLabel: "Business Wire ingest error",
      fetchRawItems: fetchBusinessWireRawItems as NewsSourceConfig["fetchRawItems"],
      hydrateRawItems: (items, hydrateOptions) =>
        hydrateBusinessWireRawItems(
          items as BusinessWireParsedRawItem[],
          {
            limit: hydrateOptions.limit,
            timeoutMs: 12_000,
            concurrency: 2,
          },
        ) as Promise<NewsRawHydrationResult>,
    },
    options,
  );
}

export async function runPRNewswireNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "prnewswire",
      sourceName: "PR Newswire",
      parserName: "prnewswire",
      fetchErrorLabel: "PR Newswire raw fetch failed",
      ingestErrorLabel: "PR Newswire ingest error",
      fetchRawItems: fetchPRNewswireRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runNewsfileNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "newsfile",
      sourceName: "Newsfile",
      parserName: "newsfile",
      fetchErrorLabel: "Newsfile raw fetch failed",
      ingestErrorLabel: "Newsfile ingest error",
      fetchRawItems: fetchNewsfileRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runAccesswireNewsIngest(options: NewsIngestOptions = {}) {
  return runAccesswireNewsIngestWithRawFetcher(
    fetchAccesswireRawItems as NewsSourceConfig["fetchRawItems"],
    options,
  );
}

export async function runAccesswireNewsIngestWithRawFetcher(
  fetchRawItems: NewsSourceConfig["fetchRawItems"],
  options: NewsIngestOptions = {},
) {
  return runNewsIngestForSource(
    {
      sourceCode: "accesswire",
      sourceName: "Access Newswire",
      parserName: "accesswire",
      fetchErrorLabel: "Access Newswire raw fetch failed",
      ingestErrorLabel: "Access Newswire ingest error",
      fetchRawItems,
      hydrateRawItems: (items, hydrateOptions) =>
        hydrateAccesswireRawItems(
          items as AccesswireParsedRawItem[],
          {
            limit: hydrateOptions.limit,
            timeoutMs: 12_000,
            concurrency: 2,
          },
        ) as Promise<NewsRawHydrationResult>,
    },
    options,
  );
}

export async function runOfacNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "ofac",
      sourceName: "OFAC",
      parserName: "ofac",
      fetchErrorLabel: "OFAC raw fetch failed",
      ingestErrorLabel: "OFAC ingest error",
      fetchRawItems: fetchOfacRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runDojNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "doj",
      sourceName: "DOJ",
      parserName: "doj",
      fetchErrorLabel: "DOJ raw fetch failed",
      ingestErrorLabel: "DOJ ingest error",
      fetchRawItems: fetchDojRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runDeaNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "dea",
      sourceName: "DEA",
      parserName: "dea",
      fetchErrorLabel: "DEA raw fetch failed",
      ingestErrorLabel: "DEA ingest error",
      fetchRawItems: fetchDeaRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runWhiteHouseNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "whitehouse",
      sourceName: "White House",
      parserName: "whitehouse",
      fetchErrorLabel: "White House raw fetch failed",
      ingestErrorLabel: "White House ingest error",
      fetchRawItems: fetchWhiteHouseRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runFdaNewsIngest(options: NewsIngestOptions = {}) {
  return runFdaNewsIngestWithRawFetcher(
    fetchFdaRawItems as NewsSourceConfig["fetchRawItems"],
    options,
  );
}

export async function runFdaNewsIngestWithRawFetcher(
  fetchRawItems: NewsSourceConfig["fetchRawItems"],
  options: NewsIngestOptions = {},
) {
  return runNewsIngestForSource(
    {
      sourceCode: "fda",
      sourceName: "FDA",
      parserName: "fda",
      fetchErrorLabel: "FDA raw fetch failed",
      ingestErrorLabel: "FDA ingest error",
      fetchRawItems,
    },
    options,
  );
}

export async function runNasdaqTraderNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "nasdaq_trader",
      sourceName: "Nasdaq Trader",
      parserName: "nasdaq_trader",
      fetchErrorLabel: "Nasdaq Trader raw fetch failed",
      ingestErrorLabel: "Nasdaq Trader ingest error",
      fetchRawItems: fetchNasdaqTraderRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

export async function runNasdaqCorporateActionsNewsIngest(options: NewsIngestOptions = {}) {
  return runNewsIngestForSource(
    {
      sourceCode: "nasdaq_corporate_actions",
      sourceName: "Nasdaq Corporate Actions",
      parserName: "nasdaq_corporate_actions",
      fetchErrorLabel: "Nasdaq Corporate Actions raw fetch failed",
      ingestErrorLabel: "Nasdaq Corporate Actions ingest error",
      fetchRawItems: fetchNasdaqCorporateActionsRawItems as NewsSourceConfig["fetchRawItems"],
    },
    options,
  );
}

function runNewsAnalysisForRawItem(
  rawItem: NewsRawItem,
  options: {
    persistMarketContext?: boolean;
    refreshMarketContext?: boolean;
  },
): ReturnType<typeof runNewsEventAnalysisForRawItem> {
  if (rawItem.source_code === "nasdaq_corporate_actions") {
    return runNasdaqCorporateActionAnalysisForRawItem(
      rawItem as Parameters<typeof runNasdaqCorporateActionAnalysisForRawItem>[0],
      options,
    ) as unknown as ReturnType<typeof runNewsEventAnalysisForRawItem>;
  }

  return runNewsEventAnalysisForRawItem(rawItem, options);
}

async function runNewsIngestForSource(config: NewsSourceConfig, options: NewsIngestOptions = {}) {
  const limit = clampInt(options.limit ?? 1, 1, 20);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const sourceUniqueId = nullableString(options.sourceUniqueId);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const resultItems: Array<Record<string, unknown>> = [];
  const seenRunEventKeys = new Set<string>();
  const seenRunEvents: EventDedupe[] = [];
  const stats = {
    checked_count: 0,
    raw_upserted_count: 0,
    analyzed_count: 0,
    event_upserted_count: 0,
    failed_count: 0,
    skipped_count: 0,
    skipped_non_english_count: 0,
    skipped_outside_coverage_count: 0,
    skipped_low_impact_broad_scope_count: 0,
    skipped_low_impact_tickerless_count: 0,
    skipped_no_us_market_target_count: 0,
    skipped_low_value_raw_count: 0,
    skipped_route_classifier_count: 0,
    deterministic_archive_count: 0,
    deterministic_event_count: 0,
    preexisting_count: 0,
    hydration_requested_count: 0,
    hydration_reused_count: 0,
    hydration_failed_count: 0,
  };

  if (!dryRun) {
    await ensureSourceReference(config);
    await assertMutation(
      supabaseUpsert(
        "source_runs",
        {
          id: runId,
          source_code: config.sourceCode,
          source_group: "news",
          run_type: "manual_ingest",
          status: "running",
          started_at: startedAt,
          stats: { requested_limit: limit },
          metadata: { source: config.sourceName, dry_run: false, force },
        },
        { onConflict: "id" },
      ),
      "create source run",
    );
  }

  try {
    const rawResult = await config.fetchRawItems({
      limit,
      sourceUniqueId: sourceUniqueId || undefined,
      haltDate: nullableString(options.haltDate) || undefined,
      resumptionDate: nullableString(options.resumptionDate) || undefined,
      includeArticleBody: !config.hydrateRawItems,
      articleBodyLimit: limit,
    });

    if (!rawResult.ok) {
      if (!dryRun) {
        await finishSourceRun(config, runId, "failed", startedAt, stats, rawResult.error || config.fetchErrorLabel, {
          raw_result: rawResult,
        });
      }

      return {
        ok: false,
        stage: "raw_fetch",
        status: rawResult.status,
        error: rawResult.error || config.fetchErrorLabel,
        rawResult,
      };
    }

    stats.checked_count = rawResult.items.length;
    stats.skipped_non_english_count = numberValue(rawResult.diagnostics.skippedNonEnglish);
    let itemsForProcessing = rawResult.items;
    let hydrationDiagnostics: Record<string, unknown> = {};

    if (config.hydrateRawItems) {
      const batch = await prepareSourceHydrationBatch({
        items: rawResult.items,
        sourceCode: config.sourceCode,
        loadExistingState: async (rawItem) => {
          const [raw, event] = await Promise.all([
            findExistingRawItem(rawItem),
            findExistingEvent(buildGroupDedupeKey(rawItem)),
          ]);
          return { raw: raw || null, event: event || null };
        },
        hydrateItems: (items) =>
          config.hydrateRawItems!(items, { limit: items.length }),
        mergeExistingRaw: mergeListingWithExistingRaw,
        force,
      });

      stats.preexisting_count = batch.stats.preexistingCount;
      stats.hydration_requested_count =
        batch.stats.hydrationRequestedCount;
      stats.hydration_reused_count = batch.stats.hydrationReusedCount;
      stats.hydration_failed_count = batch.stats.hydrationFailedCount;
      hydrationDiagnostics = batch.hydrationDiagnostics;

      for (const skipped of batch.skipped) {
        stats.skipped_count += 1;
        resultItems.push({
          ok: true,
          skipped: true,
          reason: skipped.reason,
          raw_item_id: skipped.raw?.id || null,
          event_id: toRecord(skipped.event)?.id || null,
          source_unique_id: skipped.item.source_unique_id,
          title:
            toRecord(skipped.event)?.title ||
            skipped.item.title,
          score: toRecord(skipped.event)?.score,
          delivery_level: toRecord(skipped.event)?.delivery_level,
        });
      }

      for (const rawItem of batch.retryableFailures) {
        const persistedRaw = dryRun
          ? null
          : await persistRawItem(config, rawItem, runId);
        if (persistedRaw) stats.raw_upserted_count += 1;
        stats.skipped_count += 1;
        resultItems.push({
          ok: true,
          skipped: true,
          dryRun,
          reason: "article_body_fetch_failed",
          retryable: true,
          raw_item_id: persistedRaw?.id || null,
          source_unique_id: rawItem.source_unique_id,
          title: rawItem.title,
          error:
            rawItem.raw_payload.article_fetch_error ||
            `${config.sourceName} hydration returned no usable article text`,
          timed_out: rawItem.raw_payload.article_fetch_timed_out === true,
        });
      }

      itemsForProcessing = batch.processingItems;
    }

    for (const rawItem of itemsForProcessing) {
      try {
        const groupDedupeKey = buildGroupDedupeKey(rawItem);
        const existingEvent = !force && !dryRun ? await findExistingEvent(groupDedupeKey) : null;
        if (existingEvent) {
          stats.skipped_count += 1;
          resultItems.push({
            ok: true,
            skipped: true,
            reason: "existing_event",
            event_id: existingEvent.id,
            source_unique_id: rawItem.source_unique_id,
            title: existingEvent.title || rawItem.title,
            score: existingEvent.score,
            delivery_level: existingEvent.delivery_level,
          });
          continue;
        }

        const rawSkipDecision = readRawItemPrefilterSkipDecision(rawItem);
        const terminalPrefilterDecision =
          rawSkipDecision?.decision === "low_value_raw_prefilter" ||
          rawSkipDecision?.decision === "trading_halt_status_log_only"
            ? rawSkipDecision
            : null;
        const persistedRaw = dryRun
          ? null
          : await persistRawItem(
              config,
              rawItem,
              runId,
              terminalPrefilterDecision,
            );
        if (persistedRaw) stats.raw_upserted_count += 1;

        if (rawSkipDecision) {
          stats.skipped_count += 1;
          incrementSkipStats(stats, rawSkipDecision.decision);
          const haltUpdateResult =
            rawSkipDecision.decision === "trading_halt_update_only"
              ? await applyNasdaqTraderHaltUpdate({ rawItem, persistedRaw, dryRun, rawSkipDecision })
              : null;
          if (haltUpdateResult) {
            incrementCounter(
              stats,
              dryRun
                ? "halt_update_preview_count"
                : haltUpdateResult.updated
                  ? "halt_update_applied_count"
                  : "halt_update_missed_count",
            );
            resultItems.push(haltUpdateResult);
            continue;
          }
          resultItems.push({
            ok: true,
            skipped: true,
            dryRun,
            reason: rawSkipDecision.decision,
            raw_item_id: persistedRaw?.id || null,
            source_unique_id: rawItem.source_unique_id,
            title: rawItem.title,
            raw_item: dryRun ? summarizeRaw(rawItem) : undefined,
            storage_decision: {
              action: "skip_before_llm",
              reason: rawSkipDecision.reason,
              decision: rawSkipDecision.decision,
            },
          });
          continue;
        }

        const deterministicArchive = buildDeterministicArchiveAnalysis(rawItem);
        if (deterministicArchive) {
          if (deterministicArchive.archive_reason) {
            stats.deterministic_archive_count += 1;
          } else {
            stats.deterministic_event_count += 1;
          }

          if (dryRun) {
            resultItems.push({
              ok: true,
              dryRun: true,
              deterministic_archive: Boolean(deterministicArchive.archive_reason),
              deterministic_event: !deterministicArchive.archive_reason,
              source_unique_id: rawItem.source_unique_id,
              title: rawItem.title,
              raw_item: summarizeRaw(rawItem),
              analysis: deterministicArchive,
              score: deterministicArchive.score,
              delivery_level: deterministicArchive.delivery_level,
              signal: deterministicArchive.signal,
              event_type: deterministicArchive.event_type,
              storage_decision: {
                action: deterministicArchive.archive_reason ? "persist_deterministic_archive" : "persist_deterministic_event",
                reason: deterministicArchive.archive_reason
                  ? "LLM skipped for low-priority ticker archive."
                  : "LLM skipped because this official source has structured deterministic halt data.",
              },
            });
            continue;
          }

          if (!persistedRaw) {
            throw new Error("Raw item was not persisted");
          }

          const persistedEvent = await persistAnalyzedEvent({
            config,
            rawItem,
            rawItemId: stringValue(persistedRaw.id),
          analysis: deterministicArchive,
          model: "",
          openAiResponseId: null,
          promptKey: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
          promptVersion: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
        });

          stats.event_upserted_count += 1;
          resultItems.push({
            ok: true,
            deterministic_archive: Boolean(deterministicArchive.archive_reason),
            deterministic_event: !deterministicArchive.archive_reason,
            raw_item_id: persistedRaw.id,
            source_unique_id: rawItem.source_unique_id,
            event_id: persistedEvent.id,
            ticker: persistedEvent.ticker,
            market: persistedEvent.market,
            title: persistedEvent.title,
            score: persistedEvent.score,
            delivery_level: persistedEvent.delivery_level,
            signal: persistedEvent.signal,
            event_type: persistedEvent.event_type,
            source_url: persistedEvent.source_url,
          });
          continue;
        }

        const existingSkipDecision = !force && persistedRaw ? readRawItemEventSkipDecision(persistedRaw) : null;
        if (existingSkipDecision && persistedRaw) {
          stats.skipped_count += 1;
          incrementSkipStats(stats, existingSkipDecision.decision);
          resultItems.push({
            ok: true,
            skipped: true,
            reason: existingSkipDecision.decision,
            raw_item_id: persistedRaw.id,
            source_unique_id: rawItem.source_unique_id,
            title: rawItem.title,
          });
          continue;
        }

        const analysisRun = await runNewsAnalysisForRawItem(rawItem, {
          persistMarketContext: !dryRun,
          refreshMarketContext: true,
        });
        if (!analysisRun.ok || !analysisRun.analysis) {
          stats.failed_count += 1;
          resultItems.push({
            ok: false,
            source_unique_id: rawItem.source_unique_id,
            title: rawItem.title,
            stage: analysisRun.stage,
            error: analysisRun.error || "LLM analysis failed",
          });
          continue;
        }

        stats.analyzed_count += 1;
        let tickerCanonicalization = await canonicalizeAnalysisTickersWithCache(analysisRun.analysis);
        let analysis = tickerCanonicalization.analysis;
        const officialTickerFallback = restoreNasdaqCorporateActionOfficialTickers(rawItem, analysis);
        if (officialTickerFallback.restored_symbols.length) {
          analysis = officialTickerFallback.analysis;
          tickerCanonicalization = {
            ...tickerCanonicalization,
            official_nasdaq_corporate_action_restored_symbols: officialTickerFallback.restored_symbols,
          } as typeof tickerCanonicalization;
        }
        const tickerProxies = await buildAnalysisTickerProxies(analysis);
        const coverage = evaluateCoverageForStorage(analysis, tickerProxies);
        const eventDedupe = buildAnalyzedEventDedupe(rawItem, analysis);
        const duplicateInRun = findDuplicateInRun(eventDedupe, seenRunEventKeys, seenRunEvents);
        const existingDuplicateEvent =
          !force && !dryRun && eventDedupe.key ? await findExistingEventByCrossGroupKey(eventDedupe.key) : null;
        const duplicateDecision = !coverage.dropEvent && (duplicateInRun || existingDuplicateEvent)
          ? {
              dropEvent: true,
              decision: "duplicate_event",
              reason: duplicateInRun
                ? `Duplicate news event already appeared earlier in this ingest run: ${duplicateInRun.key || "similar broad-market policy item"}.`
                : "Duplicate news event already exists from another raw item or source.",
            }
          : null;
        const analysisPromptKey = analysisRun.prompt?.key || NEWS_EVENT_ANALYSIS_PROMPT_KEY;
        const analysisPromptVersion = analysisRun.prompt?.version || NEWS_EVENT_ANALYSIS_PROMPT_VERSION;

        if (dryRun) {
          const dryRunScore = clampScore(numberValue(analysis.score));
          const dryRunDisplay = displayLevelForAnalysis(analysis, dryRunScore);
          const effectiveCoverage = duplicateDecision || coverage;
          if (effectiveCoverage.dropEvent) {
            stats.skipped_count += 1;
            incrementSkipStats(stats, effectiveCoverage.decision);
          } else {
            rememberRunEvent(eventDedupe, seenRunEventKeys, seenRunEvents);
          }
          resultItems.push({
            ok: true,
            dryRun: true,
            skipped: effectiveCoverage.dropEvent,
            raw_item: summarizeRaw(rawItem),
            route_classification: null,
            analysis,
            event_dedupe: eventDedupe.key
              ? {
                  key: eventDedupe.key,
                  normalized_title: eventDedupe.normalizedTitle,
                  duplicate_in_run: Boolean(duplicateInRun),
                  duplicate_key: duplicateInRun?.key || null,
                  token_overlap: duplicateInRun?.tokenOverlap || null,
                  topic_tokens: eventDedupe.topicTokens,
                }
              : null,
            storage_decision: effectiveCoverage.dropEvent
              ? {
                  action: "skip_event",
                  reason: effectiveCoverage.reason,
                  decision: effectiveCoverage.decision,
                  computed_delivery_level: dryRunDisplay.deliveryLevel,
                  computed_impact: dryRunDisplay.impact,
                  display_reason: dryRunDisplay.reason,
                }
              : {
                  action: "persist_event",
                  computed_delivery_level: dryRunDisplay.deliveryLevel,
                  computed_impact: dryRunDisplay.impact,
                  display_reason: dryRunDisplay.reason,
                },
            ticker_proxies: tickerProxies,
            ticker_canonicalization: {
              corrections: tickerCanonicalization.corrections,
              unresolved_symbols: tickerCanonicalization.unresolved_symbols,
              removed_non_equity_symbols: tickerCanonicalization.removed_non_equity_symbols,
              removed_foreign_symbols: tickerCanonicalization.removed_foreign_symbols,
              lookup_error: tickerCanonicalization.lookup_error || null,
            },
            prompt: {
              route_key: null,
              route_version: null,
              analysis_key: analysisPromptKey,
              analysis_version: analysisPromptVersion,
            },
            market_context: analysisRun.input.market_context,
            usage: {
              routing: null,
              analysis: analysisRun.usage || null,
            },
            costEstimate: {
              routing: null,
              analysis: analysisRun.costEstimate || null,
            },
          });
          continue;
        }

        if (!persistedRaw) {
          throw new Error("Raw item was not persisted");
        }

        const effectiveCoverage = duplicateDecision || coverage;
        if (effectiveCoverage.dropEvent) {
          stats.skipped_count += 1;
          incrementSkipStats(stats, effectiveCoverage.decision);
          await markRawItemSkippedForEventStorage(config, persistedRaw, rawItem, effectiveCoverage);
          await persistAiTrace({
            rawItemId: stringValue(persistedRaw.id),
            eventId: null,
            analysis,
            outputText: analysisRun.outputText || "",
            model: analysisRun.model || "",
            openAiResponseId: analysisRun.openAiResponseId || null,
            usage: analysisRun.usage || null,
            promptKey: analysisPromptKey,
            promptVersion: analysisPromptVersion,
          });
          resultItems.push({
            ok: true,
            skipped: true,
            reason: effectiveCoverage.decision,
            raw_item_id: persistedRaw.id,
            source_unique_id: rawItem.source_unique_id,
            title: rawItem.title,
            score: clampScore(numberValue(analysis.score)),
            market_scope: normalizeMarketScope(stringValue(analysis.market_scope)),
          });
          continue;
        }

        rememberRunEvent(eventDedupe, seenRunEventKeys, seenRunEvents);
        const persistedEvent = await persistAnalyzedEvent({
          config,
          rawItem,
          rawItemId: stringValue(persistedRaw.id),
          analysis,
          model: analysisRun.model || "",
          openAiResponseId: analysisRun.openAiResponseId || null,
          promptKey: analysisPromptKey,
          promptVersion: analysisPromptVersion,
        });
        await persistAiTrace({
          rawItemId: stringValue(persistedRaw.id),
          eventId: stringValue(persistedEvent.id),
          analysis,
          outputText: analysisRun.outputText || "",
          model: analysisRun.model || "",
          openAiResponseId: analysisRun.openAiResponseId || null,
          usage: analysisRun.usage || null,
          promptKey: analysisPromptKey,
          promptVersion: analysisPromptVersion,
        });

        stats.event_upserted_count += 1;
        resultItems.push({
          ok: true,
          raw_item_id: persistedRaw.id,
          source_unique_id: rawItem.source_unique_id,
          event_id: persistedEvent.id,
          ticker: persistedEvent.ticker,
          market: persistedEvent.market,
          title: persistedEvent.title,
          score: persistedEvent.score,
          delivery_level: persistedEvent.delivery_level,
          signal: persistedEvent.signal,
          event_type: persistedEvent.event_type,
          source_url: persistedEvent.source_url,
        });
      } catch (error) {
        stats.failed_count += 1;
        resultItems.push({
          ok: false,
          source_unique_id: rawItem.source_unique_id,
          title: rawItem.title,
          error: error instanceof Error ? error.message : "Unknown item ingest error",
        });
      }
    }

    const ok = stats.failed_count === 0;
    const partial = stats.failed_count > 0 && stats.event_upserted_count > 0;
    if (!dryRun) {
      await finishSourceRun(
        config,
        runId,
        ok || partial ? "completed" : "failed",
        startedAt,
        stats,
        ok ? undefined : `One or more ${config.sourceName} items failed`,
        {
          raw_diagnostics: {
            ...rawResult.diagnostics,
            ...hydrationDiagnostics,
          },
          partial,
        },
      );
    }

    return {
      ok,
      partial,
      stage: dryRun ? "dry_run" : "complete",
      runId: dryRun ? null : runId,
      stats,
      items: resultItems,
      diagnostics: {
        ...rawResult.diagnostics,
        ...hydrationDiagnostics,
      },
    };
  } catch (error) {
    if (!dryRun) {
      await finishSourceRun(
        config,
        runId,
        "failed",
        startedAt,
        stats,
        error instanceof Error ? error.message : `Unknown ${config.ingestErrorLabel}`,
      );
    }

    return {
      ok: false,
      stage: "ingest",
      runId: dryRun ? null : runId,
      stats,
      error: error instanceof Error ? error.message : `Unknown ${config.ingestErrorLabel}`,
      items: resultItems,
    };
  }
}

function mergeListingWithExistingRaw(
  listing: NewsRawItem,
  existing: Record<string, unknown>,
): NewsRawItem {
  const existingPayload = toRecord(existing.raw_payload) || {};
  const rawPayload: Record<string, unknown> = {
    ...listing.raw_payload,
    ...existingPayload,
    ticker_source:
      existingPayload.ticker_source ||
      listing.raw_payload.ticker_source ||
      null,
  };
  delete rawPayload.article_fetch_error;
  delete rawPayload.article_fetch_status;
  delete rawPayload.article_fetch_attempts;
  delete rawPayload.article_fetch_timed_out;
  delete rawPayload.article_fetch_retryable;
  delete rawPayload.article_fetch_attempted_at;

  const existingAnalysisText =
    nullableString(existing.analysis_text) ||
    nullableString(existingPayload.analysis_text);
  if (existingAnalysisText) {
    rawPayload.analysis_text = existingAnalysisText;
  }

  return {
    ...listing,
    source_url: stringValue(existing.source_url) || listing.source_url,
    title: nullableString(existing.title) || listing.title,
    published_at:
      nullableString(existing.published_at) ||
      listing.published_at,
    body_text: nullableString(existing.body_text),
    dedupe_key:
      stringValue(existing.dedupe_key) ||
      listing.dedupe_key,
    raw_payload: rawPayload,
  };
}

async function persistRawItem(
  config: NewsSourceConfig,
  rawItem: NewsRawItem,
  runId: string,
  terminalPrefilterDecision: {
    decision: string;
    reason: string;
  } | null = null,
) {
  const existing = await findExistingRawItem(rawItem);
  const id = stringValue(existing?.id) || randomUUID();
  const existingMetadata = toRecord(existing?.metadata) || {};
  const payload = {
    id,
    run_id: runId,
    source_code: rawItem.source_code,
    source_group: rawItem.source_group,
    source_unique_id: rawItem.source_unique_id,
    source_url: rawItem.source_url,
    title: rawItem.title,
    published_at: rawItem.published_at,
    fetched_at: rawItem.fetched_at,
    body_text: rawItem.body_text,
    analysis_text: stringValue(rawItem.raw_payload.analysis_text) || rawItem.body_text,
    raw_payload: rawItem.raw_payload,
    metadata: {
      ...existingMetadata,
      parser: config.parserName,
      ticker_source: rawItem.raw_payload.ticker_source || null,
      removed_analysis_sections: rawItem.raw_payload.removed_analysis_sections || [],
      candidate_class: rawItem.raw_payload.candidate_class || null,
      candidate_reason: rawItem.raw_payload.candidate_reason || null,
      candidate_signals: rawItem.raw_payload.candidate_signals || [],
      article_fetch_error: rawItem.raw_payload.article_fetch_error || null,
      article_fetch_status: rawItem.raw_payload.article_fetch_status || null,
      article_fetch_attempts: rawItem.raw_payload.article_fetch_attempts || null,
      article_fetch_timed_out:
        rawItem.raw_payload.article_fetch_timed_out === true,
      article_fetch_retryable:
        rawItem.raw_payload.article_fetch_retryable === true,
      article_fetch_attempted_at:
        rawItem.raw_payload.article_fetch_attempted_at || null,
      ...(terminalPrefilterDecision
        ? {
            ingest_decision: terminalPrefilterDecision.decision,
            coverage_reason: terminalPrefilterDecision.reason,
            event_created: false,
            workflow_analysis_status: "skipped",
            workflow_analysis_updated_at: new Date().toISOString(),
          }
        : {}),
    },
    dedupe_key: rawItem.dedupe_key,
  };

  const result = await supabaseUpsert("raw_items", payload, { onConflict: "id" });
  await assertMutation(result, "upsert raw item");
  return firstRow(result.data) || payload;
}

async function markRawItemSkippedForEventStorage(
  config: NewsSourceConfig,
  rawRow: PersistedRow,
  rawItem: NewsRawItem,
  coverage: EventStorageDecision,
) {
  const metadata = toRecord(rawRow.metadata) || {};
  const result = await supabaseUpsert(
    "raw_items",
    {
      id: stringValue(rawRow.id),
      source_code: rawItem.source_code,
      source_group: rawItem.source_group,
      source_unique_id: rawItem.source_unique_id,
      source_url: rawItem.source_url,
      title: rawItem.title,
      published_at: rawItem.published_at,
      fetched_at: rawItem.fetched_at,
      body_text: rawItem.body_text,
      analysis_text: stringValue(rawItem.raw_payload.analysis_text) || rawItem.body_text,
      raw_payload: rawItem.raw_payload,
      dedupe_key: rawItem.dedupe_key,
      metadata: {
        ...metadata,
        parser: config.parserName,
        ingest_decision: coverage.decision,
        coverage_reason: coverage.reason,
        event_created: false,
      },
    },
    { onConflict: "id" },
  );
  await assertMutation(result, "mark raw item outside coverage");
}

async function persistAnalyzedEvent({
  config,
  rawItem,
  rawItemId,
  analysis,
  model,
  openAiResponseId,
  promptKey,
  promptVersion,
}: {
  config: NewsSourceConfig;
  rawItem: NewsRawItem;
  rawItemId: string;
  analysis: Record<string, unknown>;
  model: string;
  openAiResponseId: string | null;
  promptKey: string;
  promptVersion: string;
}) {
  const score = clampScore(numberValue(analysis.score));
  const eventType = normalizeEventType(stringValue(analysis.event_type));
  const signal = normalizeSignal(stringValue(analysis.signal));
  const marketScope = normalizeMarketScope(stringValue(analysis.market_scope));
  const primaryTicker = readPrimaryTicker(analysis);
  const tickerProxies = await buildAnalysisTickerProxies(analysis);
  const groupDedupeKey = buildGroupDedupeKey(rawItem);
  const existing = await findExistingEvent(groupDedupeKey);
  const id = stringValue(existing?.id) || randomUUID();
  const displayLevel = displayLevelForAnalysis(analysis, score);
  const sourceEvidence = sourceEvidenceForNewsItem(config, rawItem);
  const payload = {
    id,
    raw_item_id: rawItemId,
    source_code: rawItem.source_code,
    source_group: "news" satisfies SourceGroup,
    source_name: config.sourceName,
    source_url: rawItem.source_url,
    published_at: rawItem.published_at,
    ticker: primaryTicker.ticker,
    market: primaryTicker.exchange,
    event_type: eventType,
    score,
    delivery_level: displayLevel.deliveryLevel,
    impact: displayLevel.impact,
    signal,
    market_scope: marketScope,
    sector: nullableString(analysis.sector),
    industry_group: nullableString(analysis.industry_group),
    theme_group: nullableString(analysis.theme_group),
    sub_theme: nullableString(analysis.sub_theme),
    title: buildDisplayTitleForNewsItem(config, rawItem, analysis),
    quick_take: stringValue(analysis.quick_take),
    summary: stringValue(analysis.summary),
    reason: stringValue(analysis.score_reason),
    detected_at: new Date().toISOString(),
    group_dedupe_key: groupDedupeKey,
    cross_group_event_key: buildAnalyzedEventDedupe(rawItem, analysis).key,
    metadata: {
      issuer: sourceEvidence.issuer,
      source_type: sourceEvidence.sourceType,
      source_release_type: sourceEvidence.sourceReleaseType,
      confidence: stringValue(analysis.confidence),
      needs_human_review: Boolean(analysis.needs_human_review),
      score_reason: stringValue(analysis.score_reason),
      openai_model: model,
      openai_response_id: openAiResponseId,
      prompt_key: promptKey,
      prompt_version: promptVersion,
      display_decision: displayLevel.reason || null,
      source_unique_id: rawItem.source_unique_id,
      body_tickers: analysis.tickers || [],
      related_tickers: analysis.related_tickers || [],
      related_ticker_proxies: tickerProxies,
      ticker_canonicalization: analysis.ticker_canonicalization || null,
      llm_skipped: Boolean(analysis.llm_skipped),
      analysis_source: nullableString(analysis.analysis_source),
      archive_reason: nullableString(analysis.archive_reason),
      low_value_reasons: analysis.low_value_reasons || [],
      candidate_class: nullableString(analysis.candidate_class) || nullableString(rawItem.raw_payload.candidate_class),
      candidate_reason: nullableString(analysis.candidate_reason) || nullableString(rawItem.raw_payload.candidate_reason),
      candidate_signals: analysis.candidate_signals || rawItem.raw_payload.candidate_signals || [],
      nasdaq_halt_group_key: nullableString(rawItem.raw_payload.halt_group_key),
    },
  };

  const result = await supabaseUpsert("events", payload, { onConflict: "id" });
  await assertMutation(result, "upsert event");
  const eventRow = firstRow(result.data) || payload;

  await Promise.all([
    persistEventAnalysis(eventRow, analysis, marketScope),
    persistNewsOfferingTerms({
      eventRow,
      rawItemId,
      analysis,
      model,
      promptKey,
      promptVersion,
    }),
    replaceEventTickers(stringValue(eventRow.id), analysis, primaryTicker, tickerProxies),
    replaceEventCalendarItems({
      eventRow,
      rawItem,
      rawItemId,
      analysis,
      primaryTicker,
      promptKey,
      promptVersion,
    }),
  ]);

  return eventRow;
}

function sourceEvidenceForNewsItem(config: NewsSourceConfig, rawItem: NewsRawItem) {
  const sourceName = sourceDisplayName(config.sourceCode);
  const rawSourceName = nullableString(rawItem.raw_payload.source_name);

  if (config.sourceCode === "nasdaq_trader") {
    const tradeHalt = toRecord(rawItem.raw_payload.trade_halt);
    return {
      issuer: nullableString(tradeHalt?.issueName) || rawSourceName || config.sourceName || sourceName,
      sourceReleaseType: "Nasdaq Trading Halt Notice",
      sourceType: "Exchange Trading Halt Notice",
    };
  }

  if (isGovernmentNewsSource(config.sourceCode)) {
    return {
      issuer: sourceName,
      sourceReleaseType: "Official Release",
      sourceType: "Government Release",
    };
  }

  return {
    issuer: rawSourceName || config.sourceName || sourceName,
    sourceReleaseType: "Official Release",
    sourceType: "Company Press Release",
  };
}

function buildDisplayTitleForNewsItem(
  config: NewsSourceConfig,
  rawItem: NewsRawItem,
  analysis: Record<string, unknown>,
) {
  if (rawItem.source_code === "nasdaq_trader") {
    return buildNasdaqTraderHaltDisplayTitle(rawItem) || stringValue(rawItem.title) || `Untitled ${config.sourceName} item`;
  }

  if (rawItem.source_code === "nasdaq_corporate_actions") {
    return buildNasdaqCorporateActionDisplayTitle(rawItem, analysis) || stringValue(rawItem.title) || `Untitled ${config.sourceName} item`;
  }

  return stringValue(rawItem.title) || `Untitled ${config.sourceName} item`;
}

function buildNasdaqTraderHaltDisplayTitle(rawItem: NewsRawItem) {
  const tradeHalt = toRecord(rawItem.raw_payload.trade_halt);
  const symbol = nullableString(tradeHalt?.issueSymbol) || readPrimaryTickerFromRawItem(rawItem).ticker;
  if (!symbol) return null;
  const reasonCode = nullableString(tradeHalt?.reasonCode);
  const reasonDescription = nullableString(rawItem.raw_payload.reason_description);
  if (reasonCode === "D") return `${symbol} security deletion notice`;
  if (reasonCode?.startsWith("IPO")) return `${symbol} IPO trading status update`;
  if (reasonCode === "M1") return `${symbol} halted for corporate action`;
  return `${symbol} trading halt${reasonDescription ? `: ${reasonDescription}` : reasonCode ? ` ${reasonCode}` : ""}`;
}

function buildNasdaqCorporateActionDisplayTitle(rawItem: NewsRawItem, analysis: Record<string, unknown>) {
  const corporateAction = toRecord(rawItem.raw_payload.corporate_action);
  const companyName =
    cleanCompanyName(nullableString(corporateAction?.company_name) || extractNasdaqCorporateActionTitleCompany(rawItem.title));
  const ticker = readPrimaryTicker(analysis).ticker || readPrimaryTickerFromRawItem(rawItem).ticker;
  const subject = companyName || ticker || "Nasdaq-listed issuer";
  const eventFamily = stringValue(rawItem.raw_payload.corporate_action_event_family);
  const searchText = `${rawItem.title || ""}\n${stringValue(rawItem.raw_payload.analysis_text)}`;
  const ratio = formatReverseSplitRatio(nullableString(corporateAction?.ratio) || searchText);
  const effectiveDate =
    nullableString(corporateAction?.marketplace_effective_date) ||
    nullableString(corporateAction?.marketplace_effective_date_for_suspension) ||
    extractAnticipatedTradeDate(searchText);

  if (/new listing/i.test(searchText) && ratio) {
    return `${subject} to begin Nasdaq trading after ${ratio} reverse split`;
  }

  if (eventFamily === "reverse_split") {
    return `${subject} sets ${ratio ? `${ratio} ` : ""}reverse split${effectiveDate ? ` for ${effectiveDate}` : ""}`;
  }

  if (eventFamily === "merger") {
    return `${subject} merger closes${effectiveDate ? ` with trading suspension set for ${effectiveDate}` : ""}`;
  }

  if (eventFamily === "business_combination") {
    return `${subject} business combination closes${effectiveDate ? ` effective ${effectiveDate}` : ""}`;
  }

  if (eventFamily === "spin_off") {
    return `${subject} spin-off distribution dates set`;
  }

  if (eventFamily === "redemption") {
    return `${subject} redemption terms set`;
  }

  if (eventFamily === "symbol_or_cusip_change" && /\bholding company\b/i.test(searchText)) {
    return `${subject} holding-company reorganization takes effect`;
  }

  if (eventFamily === "symbol_or_cusip_change") {
    return `${subject} trading identifier update takes effect`;
  }

  return null;
}

function cleanCompanyName(value: string | null | undefined) {
  const cleaned = nullableString(value)
    ?.replace(/^Control of\s+/i, "")
    .replace(/\s+(?:Class\s+[A-Z]\s+)?(?:Common Stock|Common Shares|Ordinary Shares|American Depositary Shares)$/i, "")
    .replace(/\s+(?:Rights?|Units?|Warrants?)$/i, "")
    .replace(/\s+\d+(?:\.\d+)?%\s+.*$/i, "")
    .replace(/\s+(?:Fixed\s*-\s*Rate\s+Reset\s+)?Series\s+[A-Z]\s+.*$/i, "")
    .replace(/\s+(?:Cumulative\s+)?(?:Perpetual\s+)?Redeemable\s+Preferred\s+Shares?$/i, "")
    .replace(/\s+Notes?\s+due\s+\d{4}$/i, "")
    .trim();
  return cleaned || null;
}

function extractNasdaqCorporateActionTitleCompany(title: string | null | undefined) {
  const text = stringValue(title);
  return (
    /\bfor\s+(.+?)\s+\([A-Z][A-Z0-9./&\s-]{0,40}\)\s*$/i.exec(text)?.[1] ||
    /\bof\s+(.+?)\s+\([A-Z][A-Z0-9./&\s-]{0,40}\)\s*$/i.exec(text)?.[1] ||
    /\bregarding\s+(.+?)\s+\([A-Z][A-Z0-9./&\s-]{0,40}\)/i.exec(text)?.[1] ||
    null
  );
}

function formatReverseSplitRatio(value: string | null | undefined) {
  const text = stringValue(value);
  const parenthetical = /\((\d+)\s*[-:]\s*(\d+)\)/.exec(text);
  if (parenthetical) return `${parenthetical[1]}-for-${parenthetical[2]}`;
  const direct = /\b(\d+)\s*[-:]\s*(\d+)\s+reverse split/i.exec(text);
  if (direct) return `${direct[1]}-for-${direct[2]}`;
  return null;
}

function extractAnticipatedTradeDate(value: string) {
  return (
    /\bAnticipated First Trade Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(value)?.[1] ||
    /\beffective\s+(?:on\s+)?([A-Za-z]+,\s+[A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(value)?.[1] ||
    /\beffective\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(value)?.[1] ||
    null
  );
}

function isGovernmentNewsSource(sourceCode: string) {
  return ["ofac", "doj", "dea", "whitehouse"].includes(sourceCode.trim().toLowerCase());
}

async function persistEventAnalysis(
  eventRow: Record<string, unknown>,
  analysis: Record<string, unknown>,
  marketScope: MarketScope,
) {
  const payload = {
    event_id: stringValue(eventRow.id),
    analysis_scope: analysisScopeFromMarketScope(marketScope),
    why_it_matters: stringValue(analysis.why_it_matters),
    bullish_points: stringArray(analysis.bullish_points),
    bearish_points: stringArray(analysis.bearish_points),
    key_evidence: stringArray(analysis.key_evidence),
    watch_next: stringArray(analysis.what_to_watch_next),
    metadata: {
      confidence: stringValue(analysis.confidence),
      needs_human_review: Boolean(analysis.needs_human_review),
      llm_skipped: Boolean(analysis.llm_skipped),
      analysis_source: nullableString(analysis.analysis_source),
      archive_reason: nullableString(analysis.archive_reason),
    },
  };

  const result = await supabaseUpsert("event_analysis", payload, { onConflict: "event_id" });
  await assertMutation(result, "upsert event analysis");
}

async function persistNewsOfferingTerms({
  eventRow,
  rawItemId,
  analysis,
  model,
  promptKey,
  promptVersion,
}: {
  eventRow: Record<string, unknown>;
  rawItemId: string;
  analysis: Record<string, unknown>;
  model: string;
  promptKey: string;
  promptVersion: string;
}) {
  const offeringTerms = toRecord(analysis.offering_terms);
  if (offeringTerms?.is_offering !== true) return;

  const offeringAmount = toRecord(offeringTerms.offering_amount);
  const sharesOffered = toRecord(offeringTerms.shares_offered);
  const offeringPrice = toRecord(offeringTerms.offering_price);
  const commonShares = toRecord(offeringTerms.common_shares);
  const prefundedWarrants = toRecord(offeringTerms.prefunded_warrants);
  const prefundedWarrantShares = toRecord(prefundedWarrants?.shares);
  const prefundedWarrantExercisePrice = toRecord(prefundedWarrants?.exercise_price);
  const commonWarrants = toRecord(offeringTerms.common_warrants);
  const commonWarrantShares = toRecord(commonWarrants?.shares);
  const commonWarrantExercisePrice = toRecord(commonWarrants?.exercise_price);
  const convertibleSecurities = toRecord(offeringTerms.convertible_securities);
  const convertiblePrincipal = toRecord(convertibleSecurities?.principal_amount);
  const convertibleConversionPrice = toRecord(convertibleSecurities?.conversion_price);
  const convertibleShareExposure = toRecord(convertibleSecurities?.share_exposure);
  const totalPotentialShareExposure = toRecord(offeringTerms.total_potential_share_exposure);
  const warrants = toRecord(offeringTerms.warrants);
  const warrantExercisePrice = toRecord(warrants?.exercise_price);
  const useOfProceeds = toRecord(offeringTerms.use_of_proceeds);
  const closingDate = toRecord(offeringTerms.closing_date);
  const marketContext = toRecord(offeringTerms.market_context_used);
  const metrics = toRecord(offeringTerms.dilution_metrics);
  const securityType = normalizeOfferingSecurityType(offeringTerms.security_type);
  const rawOfferingType = nullableString(offeringTerms.offering_type);
  const offeringType = normalizeOfferingType(offeringTerms.offering_type, {
    commonWarrantShares: nullableNumber(commonWarrantShares?.count),
    convertiblePrincipalAmount: nullableNumber(convertiblePrincipal?.amount),
    convertibleShareExposure: nullableNumber(convertibleShareExposure?.count),
    prefundedWarrantShares: nullableNumber(prefundedWarrantShares?.count),
    securityType,
  });

  const payload = {
    event_id: stringValue(eventRow.id),
    raw_item_id: rawItemId,
    sec_form_type: null,
    prospectus_type: "other",
    offering_type: offeringType,
    security_type: securityType,
    primary_or_resale: normalizePrimaryOrResale(offeringTerms.primary_or_resale),
    registration_status: "not_disclosed",
    offering_amount_text: nullableString(offeringAmount?.value_text),
    offering_amount: nullableNumber(offeringAmount?.amount),
    offering_amount_currency: nullableString(offeringAmount?.currency),
    shares_offered_text: nullableString(sharesOffered?.value_text),
    shares_offered: nullableNumber(sharesOffered?.count),
    common_shares_offered_text: nullableString(commonShares?.value_text),
    common_shares_offered: nullableNumber(commonShares?.count),
    prefunded_warrant_shares_text: nullableString(prefundedWarrantShares?.value_text),
    prefunded_warrant_shares: nullableNumber(prefundedWarrantShares?.count),
    prefunded_warrant_exercise_price_text: nullableString(prefundedWarrantExercisePrice?.value_text),
    prefunded_warrant_exercise_price: nullableNumber(prefundedWarrantExercisePrice?.price),
    prefunded_warrant_exercise_price_currency: nullableString(prefundedWarrantExercisePrice?.currency),
    common_warrant_shares_text: nullableString(commonWarrantShares?.value_text),
    common_warrant_shares: nullableNumber(commonWarrantShares?.count),
    common_warrant_exercise_price_text: nullableString(commonWarrantExercisePrice?.value_text),
    common_warrant_exercise_price: nullableNumber(commonWarrantExercisePrice?.price),
    common_warrant_exercise_price_currency: nullableString(commonWarrantExercisePrice?.currency),
    convertible_principal_amount_text: nullableString(convertiblePrincipal?.value_text),
    convertible_principal_amount: nullableNumber(convertiblePrincipal?.amount),
    convertible_principal_amount_currency: nullableString(convertiblePrincipal?.currency),
    convertible_share_exposure_text: nullableString(convertibleShareExposure?.value_text),
    convertible_share_exposure: nullableNumber(convertibleShareExposure?.count),
    total_potential_share_exposure_text: nullableString(totalPotentialShareExposure?.value_text),
    total_potential_share_exposure: nullableNumber(totalPotentialShareExposure?.count),
    market_reference_price: nullableNumber(metrics?.market_reference_price),
    market_reference_price_source: readMarketReferenceSource(marketContext),
    market_context_as_of: nullableString(marketContext?.as_of),
    market_cap: nullableNumber(metrics?.market_cap),
    market_cap_source: marketContext ? "news_market_context.market_cap" : null,
    shares_outstanding_market: nullableNumber(metrics?.shares_outstanding_market),
    shares_outstanding_market_source: marketContext ? "news_market_context.shares_outstanding" : null,
    public_float_market: nullableNumber(metrics?.public_float_market),
    public_float_market_source: marketContext ? "news_market_context.public_float" : null,
    volume: nullableNumber(marketContext?.volume),
    avg_volume: nullableNumber(marketContext?.avg_volume),
    market_context: marketContext || {},
    offering_price_text: nullableString(offeringPrice?.value_text),
    offering_price: nullableNumber(offeringPrice?.price),
    offering_price_currency: nullableString(offeringPrice?.currency),
    discount_to_market_percent: nullableNumber(metrics?.discount_to_market_percent),
    discount_to_market_basis: metrics?.discount_to_market_percent !== null ? "news_market_context" : null,
    warrant_coverage_text: nullableString(commonWarrantShares?.value_text) || nullableString(warrants?.coverage_text),
    warrant_exercise_price_text:
      nullableString(commonWarrantExercisePrice?.value_text) || nullableString(warrantExercisePrice?.value_text),
    warrant_exercise_price:
      nullableNumber(commonWarrantExercisePrice?.price) ?? nullableNumber(warrantExercisePrice?.price),
    warrant_exercise_price_currency:
      nullableString(commonWarrantExercisePrice?.currency) || nullableString(warrantExercisePrice?.currency),
    conversion_price_text: nullableString(convertibleConversionPrice?.value_text),
    conversion_price: nullableNumber(convertibleConversionPrice?.price),
    conversion_price_currency: nullableString(convertibleConversionPrice?.currency),
    use_of_proceeds: nullableString(useOfProceeds?.value_text),
    closing_date: normalizeDateString(closingDate?.value),
    immediate_share_exposure: nullableNumber(metrics?.immediate_share_exposure),
    future_warrant_overhang_shares: nullableNumber(metrics?.future_warrant_overhang_shares),
    estimated_dilution_percent: nullableNumber(metrics?.estimated_dilution_percent),
    immediate_float_impact_percent: nullableNumber(metrics?.immediate_float_impact_percent),
    total_potential_dilution_percent: nullableNumber(metrics?.total_potential_dilution_percent),
    total_potential_float_overhang_percent: nullableNumber(metrics?.total_potential_float_overhang_percent),
    float_overhang_percent: nullableNumber(metrics?.float_overhang_percent),
    offering_amount_percent_of_market_cap: nullableNumber(metrics?.offering_amount_percent_of_market_cap),
    max_share_impact_percent: nullableNumber(metrics?.max_share_impact_percent),
    dilution_scale: normalizeDilutionScale(metrics?.dilution_scale),
    overhang_level: normalizeDilutionScale(metrics?.dilution_scale),
    dilution_risk_summary: nullableString(analysis.summary),
    next_trigger: stringArray(analysis.what_to_watch_next)[0] || null,
    field_confidence: {
      source_group: "news",
      source_confidence: "medium",
      offering_amount: offeringAmount?.amount ? "medium" : "low",
      shares_offered: sharesOffered?.count ? "medium" : "low",
      common_shares: commonShares?.count ? "medium" : "low",
      prefunded_warrants: prefundedWarrantShares?.count || prefundedWarrantExercisePrice?.price ? "medium" : "low",
      common_warrants: commonWarrantShares?.count || commonWarrantExercisePrice?.price ? "medium" : "low",
      convertible_securities:
        convertiblePrincipal?.amount || convertibleConversionPrice?.price || convertibleShareExposure?.count
          ? "medium"
          : "low",
      total_potential_share_exposure: totalPotentialShareExposure?.count ? "medium" : "low",
      offering_price: offeringPrice?.price ? "medium" : "low",
      market_context: marketContext ? stringValue(marketContext.data_quality) || "partial" : "missing",
    },
    field_evidence: {
      offering_amount: nullableString(offeringAmount?.evidence),
      shares_offered: nullableString(sharesOffered?.evidence),
      common_shares: nullableString(commonShares?.evidence),
      prefunded_warrants: nullableString(prefundedWarrants?.evidence),
      prefunded_warrant_shares: nullableString(prefundedWarrantShares?.evidence),
      prefunded_warrant_exercise_price: nullableString(prefundedWarrantExercisePrice?.evidence),
      common_warrants: nullableString(commonWarrants?.evidence),
      common_warrant_shares: nullableString(commonWarrantShares?.evidence),
      common_warrant_exercise_price: nullableString(commonWarrantExercisePrice?.evidence),
      convertible_securities: nullableString(convertibleSecurities?.evidence),
      convertible_principal_amount: nullableString(convertiblePrincipal?.evidence),
      convertible_conversion_price: nullableString(convertibleConversionPrice?.evidence),
      convertible_share_exposure: nullableString(convertibleShareExposure?.evidence),
      total_potential_share_exposure: nullableString(totalPotentialShareExposure?.evidence),
      offering_price: nullableString(offeringPrice?.evidence),
      warrant_coverage: nullableString(warrants?.evidence),
      warrant_exercise_price: nullableString(warrantExercisePrice?.evidence),
      use_of_proceeds: nullableString(useOfProceeds?.evidence),
      closing_date: nullableString(closingDate?.evidence),
      evidence: stringArray(offeringTerms.evidence),
    },
    needs_human_review: Boolean(offeringTerms.needs_human_review || analysis.needs_human_review),
    extraction_model: model,
    prompt_key: promptKey,
    prompt_version: promptVersion,
    metadata: {
      source_group: "news",
      source_precedence: "preliminary_news_terms",
      source_confidence: "medium",
      raw_offering_type: rawOfferingType,
      offering_method: inferOfferingMethod(rawOfferingType, offeringType),
      original_offering_terms: offeringTerms,
      dilution_metrics: metrics || {},
    },
  };

  const result = await supabaseUpsert("event_offering_terms", payload, { onConflict: "event_id" });
  await assertMutation(result, "upsert event offering terms");
}

async function replaceEventTickers(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
  tickerProxies: NewsTickerProxy[] = [],
) {
  await assertMutation(supabaseDelete("event_tickers", { event_id: `eq.${eventId}` }), "delete event tickers");
  const rows = buildTickerRows(eventId, analysis, primaryTicker, tickerProxies);
  if (!rows.length) return;

  const result = await supabaseUpsert("event_tickers", rows, {
    onConflict: "event_id,symbol,role",
  });
  await assertMutation(result, "upsert event tickers");
}

async function persistAiTrace({
  rawItemId,
  eventId,
  analysis,
  outputText,
  model,
  openAiResponseId,
  usage,
  promptKey,
  promptVersion,
}: {
  rawItemId: string;
  eventId: string | null;
  analysis: Record<string, unknown>;
  outputText: string;
  model: string;
  openAiResponseId: string | null;
  usage: Record<string, unknown> | null;
  promptKey: string;
  promptVersion: string;
}) {
  const aiRunId = randomUUID();
  const now = new Date().toISOString();
  await assertMutation(
    supabaseUpsert(
      "ai_runs",
      {
        id: aiRunId,
        event_id: eventId,
        raw_item_id: rawItemId,
        prompt_key: promptKey,
        prompt_version: promptVersion,
        model,
        status: "completed",
        started_at: now,
        finished_at: now,
        usage: usage || {},
        metadata: {
          openai_response_id: openAiResponseId,
          route_classification: null,
        },
      },
      { onConflict: "id" },
    ),
    "insert ai run",
  );

  await assertMutation(
    supabaseUpsert(
      "ai_outputs",
      {
        id: randomUUID(),
        ai_run_id: aiRunId,
        event_id: eventId,
        output_type: "news_event_analysis",
        payload: {
          analysis,
          output_text: outputText,
        },
      },
      { onConflict: "id" },
    ),
    "insert ai output",
  );
}

async function finishSourceRun(
  config: NewsSourceConfig,
  runId: string,
  status: "completed" | "failed" | "skipped",
  startedAt: string,
  stats: Record<string, unknown>,
  errorMessage?: string,
  metadata: Record<string, unknown> = {},
) {
  const result = await supabaseUpsert(
    "source_runs",
    {
      id: runId,
      source_code: config.sourceCode,
      source_group: "news",
      run_type: "manual_ingest",
      status,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      stats,
      error_message: errorMessage || null,
      metadata,
    },
    { onConflict: "id" },
  );
  await assertMutation(result, "finish source run");
}

async function ensureSourceReference(config: NewsSourceConfig) {
  await assertMutation(
    supabaseUpsert(
      "sources",
      {
        code: config.sourceCode,
        name: config.sourceName,
        source_group: "news",
        runtime_owner: "manual",
        enabled: true,
        metadata: {
          parser_name: config.parserName,
          managed_by: "news_ingest",
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "code" },
    ),
    "upsert source reference",
  );
}

async function findExistingRawItem(rawItem: NewsRawItem) {
  const search: Record<string, string> = rawItem.source_unique_id
    ? {
        select: "*",
        source_code: `eq.${rawItem.source_code}`,
        source_unique_id: `eq.${rawItem.source_unique_id}`,
        limit: "1",
      }
    : {
        select: "*",
        source_code: `eq.${rawItem.source_code}`,
        dedupe_key: `eq.${rawItem.dedupe_key}`,
        limit: "1",
      };

  const result = await supabaseSelect("raw_items", search);
  if (!result.ok) {
    throw new Error(
      `Could not check existing ${rawItem.source_code} raw item: ${result.error || `HTTP ${result.status}`}`,
    );
  }
  return firstRow(result.data);
}

async function findExistingEvent(groupDedupeKey: string) {
  const result = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.news",
    group_dedupe_key: `eq.${groupDedupeKey}`,
    limit: "1",
  });
  if (!result.ok) {
    throw new Error(
      `Could not check existing news event: ${result.error || `HTTP ${result.status}`}`,
    );
  }
  return firstRow(result.data);
}

async function findExistingEventByCrossGroupKey(crossGroupEventKey: string) {
  const result = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.news",
    cross_group_event_key: `eq.${crossGroupEventKey}`,
    limit: "1",
  });
  return firstRow(result.data);
}

function buildTickerRows(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
  tickerProxies: NewsTickerProxy[] = [],
) {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const seenSymbols = new Set<string>();
  const push = (input: {
    symbol: string | null;
    exchange?: string | null;
    role?: string | null;
    reason?: string | null;
    relevanceScore?: number | null;
    sortOrder?: number;
    metadata?: Record<string, unknown>;
    skipIfSymbolSeen?: boolean;
  }) => {
    const symbol = stringValue(input.symbol).toUpperCase();
    if (!symbol) return;
    if (input.skipIfSymbolSeen && seenSymbols.has(symbol)) return;
    const role = normalizeTickerRole(input.role || "related");
    const key = `${symbol}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    seenSymbols.add(symbol);
    rows.push({
      event_id: eventId,
      symbol,
      exchange: nullableString(input.exchange),
      role,
      relevance_score: input.relevanceScore ?? null,
      sort_order: input.sortOrder ?? rows.length + 1,
      reason: nullableString(input.reason),
      metadata: input.metadata || {},
    });
  };

  push({
    symbol: primaryTicker.ticker,
    exchange: primaryTicker.exchange,
    role: "primary",
    reason: "Primary ticker from LLM analysis",
    sortOrder: 1,
  });

  for (const item of recordArray(analysis.tickers)) {
    push({
      symbol: stringValue(item.ticker),
      exchange: stringValue(item.exchange),
      role: stringValue(item.role),
      reason: stringValue(item.reason),
    });
  }

  for (const item of recordArray(analysis.related_tickers)) {
    push({
      symbol: stringValue(item.ticker),
      exchange: stringValue(item.exchange),
      role: "related",
      reason: stringValue(item.reason),
    });
  }

  for (const proxy of tickerProxies) {
    push({
      symbol: proxy.ticker,
      exchange: proxy.exchange,
      role: proxy.role,
      reason: proxy.reason,
      relevanceScore: proxy.relevanceScore,
      metadata: proxy.metadata,
      skipIfSymbolSeen: true,
    });
  }

  return rows.map((row, index) => ({ ...row, sort_order: index + 1 }));
}

async function buildAnalysisTickerProxies(analysis: Record<string, unknown>) {
  const hasLlmRelatedTicker = recordArray(analysis.related_tickers).some((item) => stringValue(item.ticker));
  if (hasLlmRelatedTicker) return [];

  const primaryTicker = readPrimaryTicker(analysis);
  const excludeSymbols = [
    primaryTicker.ticker,
    ...recordArray(analysis.tickers).map((item) => stringValue(item.ticker)),
    ...recordArray(analysis.related_tickers).map((item) => stringValue(item.ticker)),
  ].filter((value): value is string => Boolean(value));

  return buildNewsTickerProxiesWithCache(
    {
      marketScope: stringValue(analysis.market_scope),
      sector: nullableString(analysis.sector),
      industryGroup: nullableString(analysis.industry_group),
      themeGroup: nullableString(analysis.theme_group),
      subTheme: nullableString(analysis.sub_theme),
      score: numberValue(analysis.score),
    },
    { excludeSymbols },
  );
}

async function replaceEventCalendarItems({
  eventRow,
  rawItem,
  rawItemId,
  analysis,
  primaryTicker,
  promptKey,
  promptVersion,
}: {
  eventRow: Record<string, unknown>;
  rawItem: NewsRawItem;
  rawItemId: string;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
  promptKey: string;
  promptVersion: string;
}) {
  const eventId = stringValue(eventRow.id);
  await assertMutation(
    supabaseDelete("event_calendar_items", { source_event_id: `eq.${eventId}` }),
    "delete event calendar items",
  );

  const rows = buildCalendarRows({
    eventRow,
    rawItem,
    rawItemId,
    analysis,
    primaryTicker,
    promptKey,
    promptVersion,
  });

  if (!rows.length) return;

  const result = await supabaseUpsert("event_calendar_items", rows, { onConflict: "id" });
  await assertMutation(result, "upsert event calendar items");
}

function buildCalendarRows({
  eventRow,
  rawItem,
  rawItemId,
  analysis,
  primaryTicker,
  promptKey,
  promptVersion,
}: {
  eventRow: Record<string, unknown>;
  rawItem: NewsRawItem;
  rawItemId: string;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
  promptKey: string;
  promptVersion: string;
}) {
  const eventId = stringValue(eventRow.id);
  const sourceUrl = stringValue(eventRow.source_url) || rawItem.source_url;
  const ticker = primaryTicker.ticker || null;
  const companyName =
    nullableString(rawItem.raw_payload.company_name) ||
    nullableString(rawItem.raw_payload.source_name) ||
    ticker;

  const rows: Record<string, unknown>[] = [];

  for (const item of recordArray(analysis.calendar_items)) {
    const eventDate = normalizeDateString(item.event_date);
    const estimatedStartDate = normalizeDateString(item.estimated_start_date);
    const estimatedEndDate = normalizeDateString(item.estimated_end_date);

    if (!eventDate && !estimatedStartDate && !estimatedEndDate) continue;

    const calendarEventType = normalizeCalendarEventType(stringValue(item.calendar_event_type));
    const datePrecision = normalizeDatePrecision(stringValue(item.date_precision), eventDate);
    const isEstimated = Boolean(item.is_estimated) || datePrecision !== "exact";
    const calendarPolicy = evaluateCalendarItemPolicy({
      sourceGroup: rawItem.source_group,
      calendarEventType,
      calendarTitle: nullableString(item.calendar_title),
      evidence: nullableString(item.evidence),
      datePrecision,
      eventDate,
      estimatedStartDate,
      estimatedEndDate,
    });
    if (!calendarPolicy.keep) continue;

    const calendarStatus = calendarStatusForSource(rawItem.source_group, datePrecision, isEstimated, Boolean(eventDate));
    const eventTime = normalizeTimeString(item.event_time);
    const calendarTitle =
      stringValue(item.calendar_title) || stringValue(eventRow.title) || stringValue(rawItem.title) || "Scheduled event";

    rows.push({
      id: randomUUID(),
      source_event_id: eventId,
      raw_item_id: rawItemId,
      source_code: rawItem.source_code,
      source_group: rawItem.source_group,
      ticker,
      company_name: companyName,
      calendar_event_key: buildCalendarEventKey({
        ticker,
        calendarEventType,
        eventDate,
        eventTime,
        estimatedStartDate,
        estimatedEndDate,
        title: calendarTitle,
      }),
      calendar_event_type: calendarEventType,
      calendar_group: getCalendarEventGroup(calendarEventType),
      calendar_title: calendarTitle,
      event_date: eventDate,
      event_time: eventTime,
      event_timezone: nullableString(item.event_timezone),
      date_precision: datePrecision,
      estimated_start_date: estimatedStartDate,
      estimated_end_date: estimatedEndDate,
      is_estimated: isEstimated,
      confidence: normalizeConfidence(stringValue(item.confidence)),
      calendar_status: calendarStatus,
      confirmation_source: rawItem.source_group,
      confirmed_at: calendarStatus === "confirmed" ? new Date().toISOString() : null,
      confirmed_by_event_id: calendarStatus === "confirmed" ? eventId : null,
      superseded_by_item_id: null,
      source_url: sourceUrl,
      evidence: nullableString(item.evidence),
      metadata: {
        raw_calendar_item: item,
        prompt_key: promptKey,
        prompt_version: promptVersion,
      },
    });
  }

  return rows;
}

function calendarStatusForSource(
  sourceGroup: SourceGroup,
  datePrecision: string,
  isEstimated: boolean,
  hasExactDate: boolean,
) {
  if (sourceGroup === "filings" && hasExactDate && !isEstimated && datePrecision === "exact") {
    return "confirmed";
  }
  return "tentative";
}

function buildCalendarEventKey({
  ticker,
  calendarEventType,
  eventDate,
  eventTime,
  estimatedStartDate,
  estimatedEndDate,
  title,
}: {
  ticker: string | null;
  calendarEventType: string;
  eventDate: string | null;
  eventTime: string | null;
  estimatedStartDate: string | null;
  estimatedEndDate: string | null;
  title: string;
}) {
  const datePart = eventDate || estimatedStartDate || estimatedEndDate || "unknown";
  const timePart = eventTime || "all_day";
  const titlePart = slugify(title || "");
  return `${(ticker || "market").toLowerCase()}:${calendarEventType}:${datePart}:${timePart}:${titlePart}`.slice(0, 220);
}

function readPrimaryTicker(analysis: Record<string, unknown>) {
  const primary = toRecord(analysis.primary_ticker);
  const ticker = nullableString(primary?.ticker);
  const exchange = nullableString(primary?.exchange);
  if (ticker) return { ticker: ticker.toUpperCase(), exchange };

  const candidate = recordArray(analysis.tickers).find((item) => stringValue(item.role) === "primary");
  const candidateTicker = nullableString(candidate?.ticker);
  return {
    ticker: candidateTicker ? candidateTicker.toUpperCase() : null,
    exchange: nullableString(candidate?.exchange),
  };
}

type EventStorageDecision = {
  dropEvent: boolean;
  decision: string;
  reason: string;
};

function evaluateCoverageForStorage(
  analysis: Record<string, unknown>,
  tickerProxies: NewsTickerProxy[] = [],
): EventStorageDecision {
  const marketScope = normalizeMarketScope(stringValue(analysis.market_scope));
  const primaryTicker = readPrimaryTicker(analysis);
  const hasUsTicker = hasUsListedTicker(analysis, primaryTicker);
  const score = clampScore(numberValue(analysis.score));
  const eventType = stringValue(analysis.event_type);
  const isBroadScope = marketScope === "sector" || marketScope === "theme" || marketScope === "macro";
  const keepTickerlessClinicalFda = eventType === "fda_clinical" && score >= 50;

  if (marketScope === "company" && !hasUsTicker && !keepTickerlessClinicalFda) {
    return {
      dropEvent: true,
      decision: "outside_us_market_coverage",
      reason: "Company-scoped item has no U.S.-listed/OTC ticker or broad U.S. market impact.",
    };
  }

  if (isBroadScope && score < 50) {
    return {
      dropEvent: true,
      decision: "low_impact_broad_scope",
      reason: "Sector/theme/macro item below feed threshold is not stored because broad-scope archive has no display surface.",
    };
  }

  if (isBroadScope && !hasUsTicker && tickerProxies.length === 0) {
    return {
      dropEvent: true,
      decision: "no_us_listed_market_target",
      reason: "Sector/theme/macro item has no direct U.S.-listed ticker or supported proxy target.",
    };
  }

  return { dropEvent: false, decision: "", reason: "" };
}

function readRawItemEventSkipDecision(row: PersistedRow) {
  const metadata = toRecord(row.metadata);
  const decision = stringValue(metadata?.ingest_decision);
  if (
    decision === "outside_us_market_coverage" ||
    decision === "low_impact_broad_scope" ||
    decision === "low_impact_tickerless_broad_scope" ||
    decision === "no_us_listed_market_target"
    || decision === "route_classifier_skip"
    || decision === "duplicate_event"
  ) {
    return {
      decision,
      reason: stringValue(metadata?.coverage_reason),
    };
  }
  return null;
}

function buildDeterministicArchiveAnalysis(rawItem: NewsRawItem) {
  if (rawItem.source_code === "nasdaq_trader") {
    return buildDeterministicNasdaqTraderHaltAnalysis(rawItem);
  }

  if (stringValue(rawItem.raw_payload.candidate_class) !== "ticker_archive_candidate") return null;

  const primaryTicker = readPrimaryTickerFromRawItem(rawItem);
  if (!primaryTicker.ticker) return null;

  const lowValueReasons = stringArray(rawItem.raw_payload.low_value_reasons);
  const candidateSignals = stringArray(rawItem.raw_payload.candidate_signals);
  const eventType = eventTypeForLowValueReasons(lowValueReasons);
  const sourceName = sourceDisplayName(rawItem.source_code);
  const reasonText = lowValueReasons.length ? lowValueReasons.join(", ") : `low-priority ${sourceName} pattern`;
  const quickTake = `Low-priority ${sourceName} archive item for ${primaryTicker.ticker}; review the original release for details.`;
  const archiveEvidenceTitle =
    rawItem.source_code === "nasdaq_corporate_actions"
      ? buildNasdaqCorporateActionDisplayTitle(rawItem, {}) || `${primaryTicker.ticker} Nasdaq corporate action archived`
      : stringValue(rawItem.title);
  const archiveSummary =
    rawItem.source_code === "nasdaq_corporate_actions"
      ? "This Nasdaq corporate action was archived because it appears administrative rather than feed or alert material. Review the original exchange notice if the ticker history becomes relevant."
      : "This release was stored as a low-priority ticker archive item without LLM analysis. It appears to be routine promotional, legal, conference, award, local, personnel, or corporate-update material. Review the original release for details.";
  const archiveCandidateReason =
    rawItem.source_code === "nasdaq_corporate_actions"
      ? "Lower-priority Nasdaq Trader corporate action: administrative trading-identifier update."
      : stringValue(rawItem.raw_payload.candidate_reason);

  return {
    event_type: eventType,
    score: 15,
    delivery_level: "archive",
    impact: "low",
    signal: "neutral",
    market_scope: "company",
    confidence: "high",
    needs_human_review: false,
    primary_ticker: {
      ticker: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      company_name: null,
    },
    tickers: [
      {
        ticker: primaryTicker.ticker,
        exchange: primaryTicker.exchange,
        role: "primary",
        reason: `Ticker found in ${sourceName} release body.`,
      },
    ],
    related_tickers: [],
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    quick_take: quickTake,
    summary: archiveSummary,
    score_reason: `LLM skipped because ${sourceName} parser marked this ticker item as low priority: ${reasonText}.`,
    why_it_matters:
      "Stored for ticker history and source traceability only; not treated as a feed or alert signal.",
    bullish_points: [],
    bearish_points: [],
    key_evidence: [
      archiveEvidenceTitle,
      archiveCandidateReason,
    ].filter(Boolean),
    what_to_watch_next: [`Open the original ${sourceName} release if this archive item becomes relevant.`],
    calendar_items: [],
    llm_skipped: true,
    analysis_source: `deterministic_${rawItem.source_code}_low_value_archive`,
    archive_reason: "low_value_ticker_archive",
    low_value_reasons: lowValueReasons,
    candidate_class: rawItem.raw_payload.candidate_class,
    candidate_reason: rawItem.raw_payload.candidate_reason,
    candidate_signals: candidateSignals,
  };
}

function buildDeterministicNasdaqTraderHaltAnalysis(rawItem: NewsRawItem) {
  const candidateClass = stringValue(rawItem.raw_payload.candidate_class);
  if (candidateClass !== "company_event") return null;

  const tradeHalt = toRecord(rawItem.raw_payload.trade_halt);
  const primaryTicker = readPrimaryTickerFromRawItem(rawItem);
  const symbol = primaryTicker.ticker || nullableString(tradeHalt?.issueSymbol);
  if (!symbol) return null;

  const reasonCode = nullableString(tradeHalt?.reasonCode)?.toUpperCase() || "";
  const reasonDescription = nullableString(rawItem.raw_payload.reason_description);
  const haltDate = nullableString(tradeHalt?.haltDate);
  const haltTime = nullableString(tradeHalt?.haltTime);
  const resumptionTradeTime = nullableString(tradeHalt?.resumptionTradeTime);
  const haltWhen = [haltDate, haltTime].filter(Boolean).join(" ");
  const eventProfile = nasdaqTraderHaltEventProfile(reasonCode);
  const title = buildNasdaqTraderHaltDisplayTitle(rawItem) || stringValue(rawItem.title);
  const reasonPhrase = formatHaltReasonPhrase(reasonDescription);
  const summaryParts = [
    `${symbol} was halted${reasonPhrase ? ` for ${reasonPhrase}` : ""}${haltWhen ? ` at ${haltWhen} Eastern Time` : ""}.`,
    resumptionTradeTime
      ? `Nasdaq lists a resumption trade time of ${[nullableString(tradeHalt?.resumptionDate), resumptionTradeTime].filter(Boolean).join(" ")} Eastern Time.`
      : "No resumption trade time is listed in the current notice.",
  ];

  return {
    event_type: "listing_risk",
    score: eventProfile.score,
    delivery_level: eventProfile.deliveryLevel,
    impact: eventProfile.impact,
    signal: eventProfile.signal,
    market_scope: "company",
    confidence: "high",
    needs_human_review: false,
    primary_ticker: {
      ticker: symbol,
      exchange: primaryTicker.exchange || nullableString(tradeHalt?.market) || "NASDAQ",
      company_name: nullableString(tradeHalt?.issueName),
    },
    tickers: [
      {
        ticker: symbol,
        exchange: primaryTicker.exchange || nullableString(tradeHalt?.market) || "NASDAQ",
        role: "primary",
        reason: "Ticker from Nasdaq Trader halt notice.",
      },
    ],
    related_tickers: [],
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    quick_take: eventProfile.quickTake(symbol, reasonDescription),
    summary: summaryParts.join(" "),
    score_reason: eventProfile.scoreReason(reasonCode, reasonDescription),
    why_it_matters: eventProfile.whyItMatters,
    bullish_points: [],
    bearish_points: eventProfile.bearishPoints,
    key_evidence: [
      title,
      reasonCode ? `Reason code ${reasonCode}${reasonDescription ? `: ${reasonDescription}` : ""}.` : "",
      haltWhen ? `Halt time: ${haltWhen} Eastern Time.` : "",
      resumptionTradeTime ? `Resumption trade time: ${resumptionTradeTime} Eastern Time.` : "",
    ].filter(Boolean),
    what_to_watch_next: eventProfile.watchNext,
    calendar_items: [],
    llm_skipped: true,
    analysis_source: "deterministic_nasdaq_trader_halt",
    archive_reason: null,
    low_value_reasons: [],
    candidate_class: candidateClass,
    candidate_reason: rawItem.raw_payload.candidate_reason,
    candidate_signals: rawItem.raw_payload.candidate_signals || [],
  };
}

function nasdaqTraderHaltEventProfile(reasonCode: string) {
  if (reasonCode === "D") {
    return {
      score: 85,
      deliveryLevel: "alert",
      impact: "high",
      signal: "bearish",
      quickTake: (symbol: string, reason: string | null) =>
        `${symbol} received a Nasdaq deletion halt${formatHaltReasonPhrase(reason) ? ` tied to ${formatHaltReasonPhrase(reason)}` : ""}.`,
      scoreReason: (_code: string, _reason: string | null) => "Security deletion directly affects tradability and listing status.",
      whyItMatters: "Deletion halts can end or sharply impair exchange tradability for current holders.",
      bearishPoints: ["Exchange deletion can remove normal market liquidity."],
      watchNext: ["Confirm delisting timing and any OTC or settlement instructions."],
    };
  }

  if (reasonCode === "H4" || reasonCode === "H9" || reasonCode === "H10" || reasonCode === "H11") {
    return {
      score: 82,
      deliveryLevel: "alert",
      impact: "high",
      signal: "bearish",
      quickTake: (symbol: string, reason: string | null) =>
        `${symbol} is halted for ${formatHaltReasonPhrase(reason) || "a regulatory or compliance concern"}.`,
      scoreReason: (_code: string, _reason: string | null) => "Regulatory or compliance halt can signal listing and liquidity risk.",
      whyItMatters: "Regulatory halts can block trading and point to unresolved disclosure or listing problems.",
      bearishPoints: ["Regulatory concern can pressure valuation and liquidity."],
      watchNext: ["Watch for exchange notices, company filings, and resumption details."],
    };
  }

  if (reasonCode === "T1" || reasonCode === "T2" || reasonCode === "T12") {
    return {
      score: 78,
      deliveryLevel: "alert",
      impact: "high",
      signal: "volatile",
      quickTake: (symbol: string, reason: string | null) =>
        `${symbol} is halted for ${formatHaltReasonPhrase(reason) || "a pending Nasdaq information request"}.`,
      scoreReason: (_code: string, _reason: string | null) => "Information-related halt can precede material news or unresolved disclosure.",
      whyItMatters: "Information halts can quickly reprice the stock once news or requested details are released.",
      bearishPoints: [],
      watchNext: ["Watch for the company release, Nasdaq update, and resumption time."],
    };
  }

  if (reasonCode === "M1" || reasonCode.startsWith("IPO")) {
    return {
      score: 62,
      deliveryLevel: "feed",
      impact: "medium",
      signal: "volatile",
      quickTake: (symbol: string, reason: string | null) =>
        `${symbol} has a Nasdaq trading status update${formatHaltReasonPhrase(reason) ? ` tied to ${formatHaltReasonPhrase(reason)}` : ""}.`,
      scoreReason: (_code: string, _reason: string | null) => "Trading mechanics changed, but direction depends on follow-up details.",
      whyItMatters: "Trading status changes can affect liquidity, order handling, and near-term volatility.",
      bearishPoints: [],
      watchNext: ["Confirm opening, quotation, or corporate-action details before trading."],
    };
  }

  return {
    score: 60,
    deliveryLevel: "feed",
    impact: "medium",
    signal: "volatile",
    quickTake: (symbol: string, reason: string | null) =>
      `${symbol} has a Nasdaq trading halt${formatHaltReasonPhrase(reason) ? ` for ${formatHaltReasonPhrase(reason)}` : ""}.`,
    scoreReason: (_code: string, _reason: string | null) => "Official exchange halt changes near-term tradability.",
    whyItMatters: "A halt can change liquidity and price discovery until Nasdaq posts a resumption update.",
    bearishPoints: [],
    watchNext: ["Watch for the resumption quote and trade times."],
  };
}

function formatHaltReasonPhrase(value: string | null) {
  if (!value) return "";
  return value.replace(/\bNasdaq\b/g, "Nasdaq").replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

function sourceDisplayName(sourceCode: string) {
  if (sourceCode === "businesswire") return "Business Wire";
  if (sourceCode === "prnewswire") return "PR Newswire";
  if (sourceCode === "newsfile") return "Newsfile";
  if (sourceCode === "accesswire") return "Access Newswire";
  if (sourceCode === "ofac") return "OFAC";
  if (sourceCode === "doj") return "DOJ";
  if (sourceCode === "dea") return "DEA";
  if (sourceCode === "whitehouse") return "White House";
  if (sourceCode === "fda") return "FDA";
  if (sourceCode === "nasdaq_corporate_actions") return "Nasdaq Corporate Actions";
  if (sourceCode === "nasdaq_trader") return "Nasdaq Trading Halt";
  if (sourceCode === "globe") return "GlobeNewswire";
  return sourceCode || "news";
}

function readPrimaryTickerFromRawItem(rawItem: NewsRawItem) {
  const tickers = recordArray(rawItem.raw_payload.tickers);
  const preferred = tickers.find((ticker) => Boolean(ticker.usListed)) || tickers[0];
  const ticker = nullableString(preferred?.symbol || preferred?.ticker);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange: nullableString(preferred?.exchange),
  };
}

function restoreNasdaqCorporateActionOfficialTickers(
  rawItem: NewsRawItem,
  analysis: Record<string, unknown>,
) {
  if (rawItem.source_code !== "nasdaq_corporate_actions") {
    return { analysis, restored_symbols: [] as string[] };
  }

  const officialTickers = recordArray(rawItem.raw_payload.tickers)
    .map((ticker) => ({
      ticker: nullableString(ticker.symbol || ticker.ticker)?.toUpperCase() || null,
      exchange: nullableString(ticker.exchange) || "NASDAQ",
    }))
    .filter((ticker): ticker is { ticker: string; exchange: string } => Boolean(ticker.ticker));
  if (!officialTickers.length) return { analysis, restored_symbols: [] as string[] };

  const primaryTicker = readPrimaryTicker(analysis);
  const restoredSymbols: string[] = [];
  const nextAnalysis = { ...analysis };

  if (!primaryTicker.ticker) {
    const officialPrimary = officialTickers[0];
    nextAnalysis.primary_ticker = {
      ticker: officialPrimary.ticker,
      exchange: officialPrimary.exchange,
    };
    restoredSymbols.push(officialPrimary.ticker);
  }

  const existingTickerKeys = new Set(
    recordArray(nextAnalysis.tickers)
      .map((ticker) => nullableString(ticker.ticker)?.toUpperCase())
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
  const nextTickers = [...recordArray(nextAnalysis.tickers)];

  for (const [index, officialTicker] of officialTickers.entries()) {
    if (existingTickerKeys.has(officialTicker.ticker)) continue;
    nextTickers.push({
      ticker: officialTicker.ticker,
      exchange: officialTicker.exchange,
      role: index === 0 ? "primary" : "related",
    });
    existingTickerKeys.add(officialTicker.ticker);
    if (!restoredSymbols.includes(officialTicker.ticker)) restoredSymbols.push(officialTicker.ticker);
  }

  nextAnalysis.tickers = nextTickers;
  return { analysis: nextAnalysis, restored_symbols: restoredSymbols };
}

function eventTypeForLowValueReasons(reasons: string[]) {
  const reasonSet = new Set(reasons);
  if (reasonSet.has("shareholder_lawsuit_ad")) return "legal_risk";
  if (reasonSet.has("personnel_or_culture")) return "leadership_governance";
  if (
    reasonSet.has("local_opening") ||
    reasonSet.has("marketing_campaign") ||
    reasonSet.has("private_product_promo")
  ) {
    return "product_update";
  }
  return "other";
}

function readRawItemPrefilterSkipDecision(rawItem: NewsRawItem) {
  const candidateClass = stringValue(rawItem.raw_payload.candidate_class);
  if (candidateClass === "halt_status_log") {
    return {
      decision: "trading_halt_status_log_only",
      reason:
        stringValue(rawItem.raw_payload.candidate_reason) ||
        "Nasdaq Trader halt stored as raw status data only; not eligible for global feed.",
    };
  }
  if (candidateClass === "halt_update_only") {
    return {
      decision: "trading_halt_update_only",
      reason:
        stringValue(rawItem.raw_payload.candidate_reason) ||
        "Nasdaq Trader halt update should update an existing halt rather than create a new feed event.",
    };
  }
  if (candidateClass !== "low_value_filtered") return null;

  return {
    decision: "low_value_raw_prefilter",
    reason: stringValue(rawItem.raw_payload.candidate_reason) || "Raw parser marked item as low-value before LLM.",
  };
}

async function applyNasdaqTraderHaltUpdate({
  rawItem,
  persistedRaw,
  dryRun,
  rawSkipDecision,
}: {
  rawItem: NewsRawItem;
  persistedRaw: PersistedRow | null;
  dryRun: boolean;
  rawSkipDecision: { decision: string; reason: string };
}) {
  if (rawItem.source_code !== "nasdaq_trader") return null;
  const details = readNasdaqTraderHaltUpdateDetails(rawItem);
  if (!details) return null;

  const baseResult = {
    ok: true,
    skipped: true,
    dryRun,
    reason: rawSkipDecision.decision,
    raw_item_id: persistedRaw?.id || null,
    source_unique_id: rawItem.source_unique_id,
    title: rawItem.title,
    raw_item: dryRun ? summarizeRaw(rawItem) : undefined,
    halt_update: details,
  };

  if (dryRun) {
    return {
      ...baseResult,
      updated: false,
      storage_decision: {
        action: "would_update_existing_halt",
        reason: rawSkipDecision.reason,
        decision: rawSkipDecision.decision,
        halt_group_key: details.haltGroupKey,
      },
    };
  }

  const existingEvent = await findExistingNasdaqTraderHaltEventForUpdate(rawItem);
  if (!existingEvent) {
    return {
      ...baseResult,
      updated: false,
      storage_decision: {
        action: "raw_only_no_matching_halt_event",
        reason: "No matching original Nasdaq halt event was found for this update.",
        decision: rawSkipDecision.decision,
        halt_group_key: details.haltGroupKey,
      },
    };
  }

  const existingMetadata = toRecord(existingEvent.metadata) || {};
  const existingStatus = toRecord(existingMetadata.nasdaq_halt_status) || {};
  const metadata = {
    ...existingMetadata,
    nasdaq_halt_group_key: details.haltGroupKey,
    nasdaq_halt_status: {
      ...existingStatus,
      halt_group_key: details.haltGroupKey,
      latest_update_source_unique_id: rawItem.source_unique_id,
      latest_update_raw_item_id: stringValue(persistedRaw?.id),
      update_reason_code: details.reasonCode,
      update_reason_description: details.reasonDescription,
      resumption_date: details.resumptionDate,
      resumption_quote_time: details.resumptionQuoteTime,
      resumption_trade_time: details.resumptionTradeTime,
      updated_at: new Date().toISOString(),
    },
  };

  const updatePayload = {
    ...existingEvent,
    summary: mergeNasdaqTraderHaltUpdateSummary(stringValue(existingEvent.summary), details),
    metadata,
  };
  const result = await supabaseUpsert("events", updatePayload, { onConflict: "id" });
  await assertMutation(result, "update Nasdaq Trader halt event");

  return {
    ...baseResult,
    updated: true,
    event_id: stringValue(existingEvent.id),
    storage_decision: {
      action: "updated_existing_halt",
      reason: "Merged Nasdaq halt resumption/update fields into the existing halt event.",
      decision: rawSkipDecision.decision,
      halt_group_key: details.haltGroupKey,
    },
  };
}

async function findExistingNasdaqTraderHaltEventForUpdate(rawItem: NewsRawItem) {
  const details = readNasdaqTraderHaltUpdateDetails(rawItem);
  if (!details || !details.symbol) return null;

  const result = await supabaseSelect("events", {
    select: "*",
    source_code: "eq.nasdaq_trader",
    source_group: "eq.news",
    event_type: "eq.listing_risk",
    ticker: `eq.${details.symbol}`,
    order: "published_at.desc",
    limit: "20",
  });
  await assertMutation(result, "select matching Nasdaq Trader halt event");

  const rows = recordArray(result.data);
  return (
    rows.find((row) => stringValue(toRecord(row.metadata)?.nasdaq_halt_group_key) === details.haltGroupKey) ||
    rows.find(
      (row) =>
        nasdaqHaltGroupKeyFromSourceUniqueId(stringValue(toRecord(row.metadata)?.source_unique_id)) ===
        details.haltGroupKey,
    ) ||
    null
  );
}

function readNasdaqTraderHaltUpdateDetails(rawItem: NewsRawItem) {
  const tradeHalt = toRecord(rawItem.raw_payload.trade_halt);
  const reasonCode = nullableString(tradeHalt?.reasonCode)?.toUpperCase() || "";
  if (reasonCode !== "T3" && !["R4", "R9", "C3", "C4", "C9", "C11", "R1", "R2", "MWCQ"].includes(reasonCode)) {
    return null;
  }

  const symbol = nullableString(tradeHalt?.issueSymbol) || readPrimaryTickerFromRawItem(rawItem).ticker;
  const haltDate = nullableString(tradeHalt?.haltDate);
  const haltTime = nullableString(tradeHalt?.haltTime);
  const haltGroupKey =
    nullableString(rawItem.raw_payload.halt_group_key) ||
    ["nasdaq-trader-halt", symbol, compactNasdaqHaltDate(haltDate), compactNasdaqHaltTime(haltTime)]
      .filter(Boolean)
      .join(":");

  return {
    symbol,
    haltGroupKey,
    haltDate,
    haltTime,
    reasonCode,
    reasonDescription: nullableString(rawItem.raw_payload.reason_description),
    resumptionDate: nullableString(tradeHalt?.resumptionDate),
    resumptionQuoteTime: nullableString(tradeHalt?.resumptionQuoteTime),
    resumptionTradeTime: nullableString(tradeHalt?.resumptionTradeTime),
  };
}

function mergeNasdaqTraderHaltUpdateSummary(summary: string, details: NonNullable<ReturnType<typeof readNasdaqTraderHaltUpdateDetails>>) {
  const quoteWhen = formatNasdaqHaltDateTime(details.resumptionDate, details.resumptionQuoteTime);
  const tradeWhen = formatNasdaqHaltDateTime(details.resumptionDate, details.resumptionTradeTime);
  const pieces = [
    quoteWhen ? `quote resumption at ${quoteWhen}` : null,
    tradeWhen ? `trade resumption at ${tradeWhen}` : null,
  ].filter((item): item is string => Boolean(item));
  const updateSentence = pieces.length
    ? `Nasdaq later listed ${joinSentenceParts(pieces)}.`
    : "Nasdaq later published an update without a listed resumption time.";
  if (summary.includes(updateSentence) || (tradeWhen && summary.includes(tradeWhen))) return summary;
  const cleaned = summary.replace(/\s*No resumption trade time is listed in the current notice\./i, "").trim();
  if (!cleaned) return updateSentence;
  return `${cleaned}${cleaned.endsWith(".") ? "" : "."} ${updateSentence}`;
}

function formatNasdaqHaltDateTime(dateValue: string | null, timeValue: string | null) {
  return [dateValue, timeValue].filter(Boolean).join(" ") || null;
}

function joinSentenceParts(parts: string[]) {
  if (parts.length <= 1) return parts[0] || "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function nasdaqHaltGroupKeyFromSourceUniqueId(value: string) {
  const match = /^tradehalt-([A-Z0-9.-]+)-([0-9]+)-([0-9]+)-/i.exec(value);
  return match ? ["nasdaq-trader-halt", match[1].toUpperCase(), match[2], match[3]].join(":") : null;
}

function compactNasdaqHaltDate(value: string | null) {
  return value ? value.replace(/\D/g, "") : null;
}

function compactNasdaqHaltTime(value: string | null) {
  return value ? value.replace(/\D/g, "") : null;
}

function incrementSkipStats(stats: Record<string, number>, decision: string) {
  if (decision === "outside_us_market_coverage") {
    stats.skipped_outside_coverage_count = numberValue(stats.skipped_outside_coverage_count) + 1;
  }
  if (decision === "low_impact_tickerless_broad_scope") {
    stats.skipped_low_impact_tickerless_count = numberValue(stats.skipped_low_impact_tickerless_count) + 1;
  }
  if (decision === "low_impact_broad_scope") {
    stats.skipped_low_impact_broad_scope_count = numberValue(stats.skipped_low_impact_broad_scope_count) + 1;
  }
  if (decision === "no_us_listed_market_target") {
    stats.skipped_no_us_market_target_count = numberValue(stats.skipped_no_us_market_target_count) + 1;
  }
  if (decision === "low_value_raw_prefilter") {
    stats.skipped_low_value_raw_count = numberValue(stats.skipped_low_value_raw_count) + 1;
  }
  if (decision === "trading_halt_status_log_only" || decision === "trading_halt_update_only") {
    stats.skipped_low_value_raw_count = numberValue(stats.skipped_low_value_raw_count) + 1;
  }
  if (decision === "route_classifier_skip") {
    stats.skipped_route_classifier_count = numberValue(stats.skipped_route_classifier_count) + 1;
  }
}

function incrementCounter(stats: Record<string, number>, key: string) {
  stats[key] = numberValue(stats[key]) + 1;
}

function hasUsListedTicker(
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
) {
  if (primaryTicker.ticker && isUsListedExchange(primaryTicker.exchange)) return true;

  return [...recordArray(analysis.tickers), ...recordArray(analysis.related_tickers)].some((item) =>
    isUsListedExchange(stringValue(item.exchange)),
  );
}

function isUsListedExchange(value: string | null) {
  const normalized = stringValue(value)
    .toUpperCase()
    .replace(/[.\s-]+/g, "_");
  if (!normalized) return false;

  return (
    normalized === "NASDAQ" ||
    normalized === "NYSE" ||
    normalized === "NYSE_AMERICAN" ||
    normalized === "NYSE_ARCA" ||
    normalized === "AMEX" ||
    normalized === "CBOE" ||
    normalized === "BATS" ||
    normalized === "OTC" ||
    normalized === "OTCQX" ||
    normalized === "OTCQB" ||
    normalized === "OTC_PINK" ||
    normalized === "PINK" ||
    normalized.startsWith("OTC_")
  );
}

function normalizeEventType(value: string) {
  const normalized = value.trim().toLowerCase();
  return allowedEventTypes.has(normalized) ? normalized : "other";
}

function normalizeSignal(value: string): Signal {
  const normalized = value.trim().toLowerCase();
  return allowedSignals.has(normalized) ? (normalized as Signal) : "neutral";
}

function normalizeMarketScope(value: string): MarketScope {
  const normalized = value.trim().toLowerCase();
  if (normalized === "sector" || normalized === "theme" || normalized === "macro") return normalized;
  return "company";
}

function normalizeTickerRole(value: string): TickerRole {
  const normalized = value.trim().toLowerCase();
  return allowedTickerRoles.has(normalized) ? (normalized as TickerRole) : "related";
}

function deliveryLevelFromScore(score: number): DeliveryLevel {
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function impactFromScore(score: number): Impact {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function displayLevelForAnalysis(
  analysis: Record<string, unknown>,
  score: number,
): { deliveryLevel: DeliveryLevel; impact: Impact; reason: string | null } {
  const primaryTicker = readPrimaryTicker(analysis);
  const hasUsTicker = hasUsListedTicker(analysis, primaryTicker);
  const eventType = stringValue(analysis.event_type);

  if (eventType === "fda_clinical" && !hasUsTicker) {
    return {
      deliveryLevel: "archive",
      impact: "low",
      reason: "tickerless_fda_clinical_archive_only",
    };
  }

  return {
    deliveryLevel: deliveryLevelFromScore(score),
    impact: impactFromScore(score),
    reason: null,
  };
}

function analysisScopeFromMarketScope(value: MarketScope): AnalysisScope {
  return value === "macro" ? "market" : value;
}

function buildTickerEventDedupeKey(ticker: string | null, eventType: string, title: string | null) {
  if (!ticker) return null;
  return `${ticker}:${eventType}:${slugify(normalizeNewsTitleForDedupe(title || ""))}`.slice(0, 180);
}

function buildGroupDedupeKey(rawItem: NewsRawItem) {
  return rawItem.dedupe_key || `${rawItem.source_code}:${rawItem.source_url.toLowerCase()}`;
}

function buildAnalyzedEventDedupe(rawItem: NewsRawItem, analysis: Record<string, unknown>): EventDedupe {
  const primaryTicker = readPrimaryTicker(analysis);
  const eventType = normalizeEventType(stringValue(analysis.event_type));
  const marketScope = normalizeMarketScope(stringValue(analysis.market_scope));
  const normalizedTitle = normalizeNewsTitleForDedupe(rawItem.title || "");
  const publishedDate = readPublishedDate(rawItem.published_at);
  const topicTokens = buildEventTopicTokens(rawItem, analysis);
  const isBroadScope = marketScope === "sector" || marketScope === "theme" || marketScope === "macro";
  const tickerKey = buildTickerEventDedupeKey(primaryTicker.ticker, eventType, rawItem.title);
  const broadKey = isBroadScope
    ? buildBroadMarketEventDedupeKey({
        sourceCode: rawItem.source_code,
        eventType,
        marketScope,
        publishedDate,
        topicTokens,
      })
    : null;

  return {
    key: broadKey || tickerKey,
    normalizedTitle,
    sourceCode: rawItem.source_code,
    eventType,
    marketScope,
    publishedDate,
    topicTokens,
  };
}

function buildBroadMarketEventDedupeKey({
  sourceCode,
  eventType,
  marketScope,
  publishedDate,
  topicTokens,
}: {
  sourceCode: string;
  eventType: string;
  marketScope: MarketScope;
  publishedDate: string | null;
  topicTokens: string[];
}) {
  if (!publishedDate || topicTokens.length < 2) return null;
  return [
    sourceCode,
    marketScope,
    eventType,
    publishedDate,
    topicTokens.slice(0, 8).join("-"),
  ].join(":").slice(0, 180);
}

function findDuplicateInRun(
  eventDedupe: EventDedupe,
  seenRunEventKeys: Set<string>,
  seenRunEvents: EventDedupe[],
): DuplicateInRun | null {
  if (eventDedupe.key && seenRunEventKeys.has(eventDedupe.key)) {
    return { key: eventDedupe.key, tokenOverlap: 1 };
  }

  const isBroadScope =
    eventDedupe.marketScope === "sector" ||
    eventDedupe.marketScope === "theme" ||
    eventDedupe.marketScope === "macro";
  if (!isBroadScope || !eventDedupe.publishedDate || eventDedupe.topicTokens.length < 3) return null;

  for (const seen of seenRunEvents) {
    const seenBroadScope = seen.marketScope === "sector" || seen.marketScope === "theme" || seen.marketScope === "macro";
    if (!seenBroadScope) continue;
    if (seen.sourceCode !== eventDedupe.sourceCode) continue;
    if (seen.eventType !== eventDedupe.eventType) continue;
    if (seen.publishedDate !== eventDedupe.publishedDate) continue;

    const overlap = tokenOverlapRatio(eventDedupe.topicTokens, seen.topicTokens);
    if (overlap >= 0.42) {
      return { key: seen.key, tokenOverlap: overlap };
    }
  }

  return null;
}

function rememberRunEvent(
  eventDedupe: EventDedupe,
  seenRunEventKeys: Set<string>,
  seenRunEvents: EventDedupe[],
) {
  if (eventDedupe.key) seenRunEventKeys.add(eventDedupe.key);
  seenRunEvents.push(eventDedupe);
}

function tokenOverlapRatio(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  return intersection / Math.min(leftSet.size, rightSet.size);
}

function buildEventTopicTokens(rawItem: NewsRawItem, analysis: Record<string, unknown>) {
  const pieces = [
    rawItem.title,
    analysis.quick_take,
    analysis.sector,
    analysis.industry_group,
    analysis.theme_group,
    analysis.sub_theme,
  ];
  const normalized = normalizeTopicText(pieces.filter(Boolean).join(" "));
  const tokens = normalized
    .split(/\s+/)
    .map(normalizeTopicToken)
    .filter((token) => token.length >= 3 && !TOPIC_DEDUPE_STOPWORDS.has(token));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }

  return result.sort();
}

function normalizeTopicText(value: string) {
  return value
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/u\.s\.|united states|american/g, "us")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTopicToken(value: string) {
  const token = value.trim();
  const mapped = TOPIC_DEDUPE_TOKEN_MAP[token];
  if (mapped) return mapped;
  return token.replace(/ies$/, "y").replace(/s$/, "");
}

function readPublishedDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

const TOPIC_DEDUPE_TOKEN_MAP: Record<string, string> = {
  cuban: "cuba",
  chinese: "china",
  imposing: "sanction",
  imposes: "sanction",
  imposed: "sanction",
  sanctions: "sanction",
  sanctioned: "sanction",
  tariffs: "tariff",
  deals: "deal",
  agreements: "agreement",
  restrictions: "restriction",
  officials: "official",
  responsible: "responsibility",
  threats: "threat",
  workers: "worker",
  farmers: "farmer",
  industries: "industry",
  pipelines: "pipeline",
  contracts: "contract",
  contracting: "contract",
  retirement: "retire",
  savings: "saving",
};

const TOPIC_DEDUPE_STOPWORDS = new Set([
  "about",
  "across",
  "action",
  "actions",
  "act",
  "again",
  "against",
  "also",
  "america",
  "and",
  "announce",
  "announced",
  "announces",
  "authorizing",
  "before",
  "bring",
  "broadens",
  "broaden",
  "deliver",
  "delivering",
  "donald",
  "during",
  "executive",
  "expands",
  "fact",
  "federal",
  "for",
  "from",
  "government",
  "house",
  "into",
  "issued",
  "its",
  "january",
  "new",
  "order",
  "over",
  "official",
  "president",
  "presidential",
  "promotes",
  "regime",
  "responsibility",
  "sheet",
  "signed",
  "state",
  "states",
  "that",
  "the",
  "their",
  "those",
  "through",
  "trump",
  "under",
  "united",
  "white",
  "will",
  "with",
]);

function normalizeNewsTitleForDedupe(value: string) {
  return value
    .replace(/^\s*(?:retransmission|correction|correcting and replacing|updated?|update)\s*[:\-]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function summarizeRaw(rawItem: NewsRawItem) {
  return {
    source_unique_id: rawItem.source_unique_id,
    source_url: rawItem.source_url,
    title: rawItem.title,
    published_at: rawItem.published_at,
    body_chars: rawItem.body_text?.length || 0,
    analysis_chars: stringValue(rawItem.raw_payload.analysis_text).length,
    candidate_class: rawItem.raw_payload.candidate_class || null,
    candidate_reason: rawItem.raw_payload.candidate_reason || null,
    candidate_signals: rawItem.raw_payload.candidate_signals || [],
  };
}

async function assertMutation(
  promise:
    | Promise<{ ok: boolean; status: number; error?: string; data?: unknown }>
    | { ok: boolean; status: number; error?: string; data?: unknown },
  label: string,
) {
  const result = await promise;
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error || `HTTP ${result.status}`}`);
  }
  return result;
}

function firstRow(value: unknown): PersistedRow | null {
  return Array.isArray(value) && value[0] && typeof value[0] === "object"
    ? (value[0] as PersistedRow)
    : null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function normalizeDateString(value: unknown) {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return text;
}

function normalizeTimeString(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}:00`;
}

function normalizeDatePrecision(value: string, eventDate: string | null) {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "exact" ||
    normalized === "month" ||
    normalized === "quarter" ||
    normalized === "year" ||
    normalized === "unknown"
  ) {
    return normalized;
  }
  return eventDate ? "exact" : "unknown";
}

function normalizeConfidence(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function normalizeOfferingType(
  value: unknown,
  context: {
    commonWarrantShares?: number | null;
    convertiblePrincipalAmount?: number | null;
    convertibleShareExposure?: number | null;
    prefundedWarrantShares?: number | null;
    securityType?: string;
  } = {},
) {
  const normalized = normalizeOfferingToken(value);
  const hasConvertible =
    context.securityType === "convertible_notes" ||
    numberValue(context.convertiblePrincipalAmount) > 0 ||
    numberValue(context.convertibleShareExposure) > 0;
  const hasMixedComponents =
    context.securityType === "mixed" ||
    context.securityType === "units" ||
    numberValue(context.prefundedWarrantShares) > 0 ||
    numberValue(context.commonWarrantShares) > 0;

  if (hasConvertible) return "convertible_financing";

  if (
    normalized === "atm" ||
    normalized === "registered_direct" ||
    normalized === "private_placement" ||
    normalized === "resale_registration" ||
    normalized === "warrant_exercise" ||
    normalized === "convertible_financing" ||
    normalized === "rights_offering" ||
    normalized === "mixed" ||
    normalized === "other"
  ) {
    return normalized;
  }
  if (normalized === "shelf_takedown" || normalized === "shelf_registration") return "shelf_registration";
  if (
    normalized === "public_offering" ||
    normalized === "underwritten_public_offering" ||
    normalized === "common_stock_public_offering" ||
    normalized === "unit_public_offering" ||
    /(?:^|_)public(?:_|$)/.test(normalized) ||
    /(?:^|_)underwritten(?:_|$)/.test(normalized)
  ) {
    return hasMixedComponents ? "mixed" : "other";
  }
  return "unknown";
}

function inferOfferingMethod(rawOfferingType: string | null, normalizedOfferingType: string) {
  const raw = normalizeOfferingToken(rawOfferingType);
  if (!raw || raw === normalizedOfferingType) return null;
  if (
    raw === "atm" ||
    raw === "registered_direct" ||
    raw === "private_placement" ||
    raw === "rights_offering" ||
    raw === "shelf_takedown" ||
    raw === "shelf_registration"
  ) {
    return raw === "shelf_takedown" ? "shelf_registration" : raw;
  }
  if (
    raw === "public_offering" ||
    raw === "underwritten_public_offering" ||
    raw === "common_stock_public_offering" ||
    raw === "unit_public_offering" ||
    /(?:^|_)public(?:_|$)/.test(raw) ||
    /(?:^|_)underwritten(?:_|$)/.test(raw)
  ) {
    return raw;
  }
  return null;
}

function normalizeOfferingToken(value: unknown) {
  return stringValue(value)
    .trim()
    .toLowerCase()
    .replace(/[-\s/]+/g, "_")
    .replace(/[^a-z0-9_]+/g, "")
    .replace(/^_+|_+$/g, "");
}

function normalizeOfferingSecurityType(value: unknown) {
  const normalized = stringValue(value);
  if (
    normalized === "common_stock" ||
    normalized === "common_shares" ||
    normalized === "ordinary_shares" ||
    normalized === "ads" ||
    normalized === "units" ||
    normalized === "warrants" ||
    normalized === "prefunded_warrants" ||
    normalized === "convertible_notes" ||
    normalized === "debt" ||
    normalized === "mixed" ||
    normalized === "other"
  ) {
    return normalized;
  }
  return "unknown";
}

function normalizePrimaryOrResale(value: unknown) {
  const normalized = stringValue(value);
  if (normalized === "primary" || normalized === "resale" || normalized === "mixed") return normalized;
  return "not_disclosed";
}

function normalizeDilutionScale(value: unknown) {
  const normalized = stringValue(value);
  if (
    normalized === "low" ||
    normalized === "moderate" ||
    normalized === "elevated" ||
    normalized === "high" ||
    normalized === "severe"
  ) {
    return normalized;
  }
  return "unknown";
}

function readMarketReferenceSource(marketContext: Record<string, unknown> | null) {
  if (!marketContext) return null;
  if (nullableNumber(marketContext.price) !== null) return "news_market_context.price";
  if (nullableNumber(marketContext.previous_close) !== null) return "news_market_context.previous_close";
  return null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
