import { randomUUID } from "node:crypto";
import {
  NEWS_EVENT_ANALYSIS_PROMPT_KEY,
  NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
  NEWS_EVENT_TYPE_VALUES,
  SIGNAL_VALUES,
} from "@/lib/prompts/newsEventAnalysis";
import { getCalendarEventGroup, normalizeCalendarEventType } from "@/lib/calendarEventRegistry";
import { runNewsEventAnalysisForRawItem } from "@/lib/ai/newsEventAnalysisPreview";
import { fetchGlobeNewswireRawItems, type GlobeParsedRawItem } from "@/lib/sources/globe/parser";
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

type GlobeIngestOptions = {
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
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

export async function runGlobeNewsIngest(options: GlobeIngestOptions = {}) {
  const limit = clampInt(options.limit ?? 1, 1, 20);
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const resultItems: Array<Record<string, unknown>> = [];
  const stats = {
    checked_count: 0,
    raw_upserted_count: 0,
    analyzed_count: 0,
    event_upserted_count: 0,
    failed_count: 0,
    skipped_count: 0,
    skipped_non_english_count: 0,
    skipped_outside_coverage_count: 0,
  };

  if (!dryRun) {
    await assertMutation(
      supabaseUpsert(
        "source_runs",
        {
          id: runId,
          source_code: "globe",
          source_group: "news",
          run_type: "manual_ingest",
          status: "running",
          started_at: startedAt,
          stats: { requested_limit: limit },
          metadata: { source: "GlobeNewswire", dry_run: false, force },
        },
        { onConflict: "id" },
      ),
      "create source run",
    );
  }

  try {
    const rawResult = await fetchGlobeNewswireRawItems({
      limit,
      includeArticleBody: true,
      articleBodyLimit: limit,
    });

    if (!rawResult.ok) {
      if (!dryRun) {
        await finishSourceRun(runId, "failed", startedAt, stats, rawResult.error || "Globe raw fetch failed", {
          raw_result: rawResult,
        });
      }

      return {
        ok: false,
        stage: "raw_fetch",
        status: rawResult.status,
        error: rawResult.error || "Globe raw fetch failed",
        rawResult,
      };
    }

    stats.checked_count = rawResult.items.length;
    stats.skipped_non_english_count = rawResult.diagnostics.skippedNonEnglish || 0;

    for (const rawItem of rawResult.items) {
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

        const persistedRaw = dryRun ? null : await persistRawItem(rawItem, runId);
        if (persistedRaw) stats.raw_upserted_count += 1;

        if (!force && persistedRaw && isRawItemSkippedOutsideCoverage(persistedRaw)) {
          stats.skipped_count += 1;
          stats.skipped_outside_coverage_count += 1;
          resultItems.push({
            ok: true,
            skipped: true,
            reason: "outside_us_market_coverage",
            raw_item_id: persistedRaw.id,
            source_unique_id: rawItem.source_unique_id,
            title: rawItem.title,
          });
          continue;
        }

        const analysisRun = await runNewsEventAnalysisForRawItem(rawItem);
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

        if (dryRun) {
          resultItems.push({
            ok: true,
            dryRun: true,
            raw_item: summarizeRaw(rawItem),
            analysis: analysisRun.analysis,
          });
          continue;
        }

        if (!persistedRaw) {
          throw new Error("Raw item was not persisted");
        }

        const coverage = evaluateCoverageForStorage(analysisRun.analysis);
        if (coverage.dropEvent) {
          stats.skipped_count += 1;
          stats.skipped_outside_coverage_count += 1;
          await markRawItemSkippedOutsideCoverage(persistedRaw, rawItem, coverage.reason);
          await persistAiTrace({
            rawItemId: stringValue(persistedRaw.id),
            eventId: null,
            analysis: analysisRun.analysis,
            outputText: analysisRun.outputText || "",
            model: analysisRun.model || "",
            openAiResponseId: analysisRun.openAiResponseId || null,
          });
          resultItems.push({
            ok: true,
            skipped: true,
            reason: "outside_us_market_coverage",
            raw_item_id: persistedRaw.id,
            source_unique_id: rawItem.source_unique_id,
            title: rawItem.title,
            score: clampScore(numberValue(analysisRun.analysis.score)),
            market_scope: normalizeMarketScope(stringValue(analysisRun.analysis.market_scope)),
          });
          continue;
        }

        const persistedEvent = await persistAnalyzedEvent({
          rawItem,
          rawItemId: stringValue(persistedRaw.id),
          analysis: analysisRun.analysis,
          model: analysisRun.model || "",
          openAiResponseId: analysisRun.openAiResponseId || null,
        });
        await persistAiTrace({
          rawItemId: stringValue(persistedRaw.id),
          eventId: stringValue(persistedEvent.id),
          analysis: analysisRun.analysis,
          outputText: analysisRun.outputText || "",
          model: analysisRun.model || "",
          openAiResponseId: analysisRun.openAiResponseId || null,
        });

        stats.event_upserted_count += 1;
        resultItems.push({
          ok: true,
          raw_item_id: persistedRaw.id,
          event_id: persistedEvent.id,
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
        runId,
        ok || partial ? "completed" : "failed",
        startedAt,
        stats,
        ok ? undefined : "One or more Globe items failed",
        {
          raw_diagnostics: rawResult.diagnostics,
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
      diagnostics: rawResult.diagnostics,
    };
  } catch (error) {
    if (!dryRun) {
      await finishSourceRun(
        runId,
        "failed",
        startedAt,
        stats,
        error instanceof Error ? error.message : "Unknown Globe ingest error",
      );
    }

    return {
      ok: false,
      stage: "ingest",
      runId: dryRun ? null : runId,
      stats,
      error: error instanceof Error ? error.message : "Unknown Globe ingest error",
      items: resultItems,
    };
  }
}

async function persistRawItem(rawItem: GlobeParsedRawItem, runId: string) {
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
      parser: "globe",
      ticker_source: rawItem.raw_payload.ticker_source || null,
      removed_analysis_sections: rawItem.raw_payload.removed_analysis_sections || [],
    },
    dedupe_key: rawItem.dedupe_key,
  };

  const result = await supabaseUpsert("raw_items", payload, { onConflict: "id" });
  await assertMutation(result, "upsert raw item");
  return firstRow(result.data) || payload;
}

async function markRawItemSkippedOutsideCoverage(
  rawRow: PersistedRow,
  rawItem: GlobeParsedRawItem,
  reason: string,
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
        ingest_decision: "outside_us_market_coverage",
        coverage_reason: reason,
        event_created: false,
      },
    },
    { onConflict: "id" },
  );
  await assertMutation(result, "mark raw item outside coverage");
}

async function persistAnalyzedEvent({
  rawItem,
  rawItemId,
  analysis,
  model,
  openAiResponseId,
}: {
  rawItem: GlobeParsedRawItem;
  rawItemId: string;
  analysis: Record<string, unknown>;
  model: string;
  openAiResponseId: string | null;
}) {
  const score = clampScore(numberValue(analysis.score));
  const eventType = normalizeEventType(stringValue(analysis.event_type));
  const signal = normalizeSignal(stringValue(analysis.signal));
  const marketScope = normalizeMarketScope(stringValue(analysis.market_scope));
  const primaryTicker = readPrimaryTicker(analysis);
  const groupDedupeKey = buildGroupDedupeKey(rawItem);
  const existing = await findExistingEvent(groupDedupeKey);
  const id = stringValue(existing?.id) || randomUUID();
  const deliveryLevel = deliveryLevelFromScore(score);
  const payload = {
    id,
    raw_item_id: rawItemId,
    source_code: rawItem.source_code,
    source_group: "news" satisfies SourceGroup,
    source_name: "GlobeNewswire",
    source_url: rawItem.source_url,
    published_at: rawItem.published_at,
    ticker: primaryTicker.ticker,
    market: primaryTicker.exchange,
    event_type: eventType,
    score,
    delivery_level: deliveryLevel,
    impact: impactFromScore(score),
    signal,
    market_scope: marketScope,
    sector: nullableString(analysis.sector),
    industry_group: nullableString(analysis.industry_group),
    theme_group: nullableString(analysis.theme_group),
    sub_theme: nullableString(analysis.sub_theme),
    title: stringValue(rawItem.title) || "Untitled GlobeNewswire item",
    quick_take: stringValue(analysis.quick_take),
    summary: stringValue(analysis.summary),
    reason: stringValue(analysis.score_reason),
    detected_at: new Date().toISOString(),
    group_dedupe_key: groupDedupeKey,
    cross_group_event_key: buildCrossGroupEventKey(primaryTicker.ticker, eventType, rawItem.title),
    metadata: {
      issuer: nullableString(rawItem.raw_payload.source_name),
      source_type: "Company Press Release",
      source_release_type: "Official Release",
      confidence: stringValue(analysis.confidence),
      needs_human_review: Boolean(analysis.needs_human_review),
      score_reason: stringValue(analysis.score_reason),
      openai_model: model,
      openai_response_id: openAiResponseId,
      prompt_key: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
      prompt_version: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
      source_unique_id: rawItem.source_unique_id,
      body_tickers: analysis.tickers || [],
      related_tickers: analysis.related_tickers || [],
    },
  };

  const result = await supabaseUpsert("events", payload, { onConflict: "id" });
  await assertMutation(result, "upsert event");
  const eventRow = firstRow(result.data) || payload;

  await Promise.all([
    persistEventAnalysis(eventRow, analysis, marketScope),
    replaceEventTickers(stringValue(eventRow.id), analysis, primaryTicker),
    replaceEventCalendarItems({
      eventRow,
      rawItem,
      rawItemId,
      analysis,
      primaryTicker,
    }),
  ]);

  return eventRow;
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
    },
  };

  const result = await supabaseUpsert("event_analysis", payload, { onConflict: "event_id" });
  await assertMutation(result, "upsert event analysis");
}

async function replaceEventTickers(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
) {
  await assertMutation(supabaseDelete("event_tickers", { event_id: `eq.${eventId}` }), "delete event tickers");
  const rows = buildTickerRows(eventId, analysis, primaryTicker);
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
}: {
  rawItemId: string;
  eventId: string | null;
  analysis: Record<string, unknown>;
  outputText: string;
  model: string;
  openAiResponseId: string | null;
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
        prompt_key: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
        prompt_version: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
        model,
        status: "completed",
        started_at: now,
        finished_at: now,
        usage: {},
        metadata: {
          openai_response_id: openAiResponseId,
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
      source_code: "globe",
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

async function findExistingRawItem(rawItem: GlobeParsedRawItem) {
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
  return firstRow(result.data);
}

async function findExistingEvent(groupDedupeKey: string) {
  const result = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.news",
    group_dedupe_key: `eq.${groupDedupeKey}`,
    limit: "1",
  });
  return firstRow(result.data);
}

function buildTickerRows(
  eventId: string,
  analysis: Record<string, unknown>,
  primaryTicker: { ticker: string | null; exchange: string | null },
) {
  const rows: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const push = (input: {
    symbol: string | null;
    exchange?: string | null;
    role?: string | null;
    reason?: string | null;
    sortOrder?: number;
  }) => {
    const symbol = stringValue(input.symbol).toUpperCase();
    if (!symbol) return;
    const role = normalizeTickerRole(input.role || "related");
    const key = `${symbol}:${role}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      event_id: eventId,
      symbol,
      exchange: nullableString(input.exchange),
      role,
      sort_order: input.sortOrder ?? rows.length + 1,
      reason: nullableString(input.reason),
      metadata: {},
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

  return rows.map((row, index) => ({ ...row, sort_order: index + 1 }));
}

async function replaceEventCalendarItems({
  eventRow,
  rawItem,
  rawItemId,
  analysis,
  primaryTicker,
}: {
  eventRow: Record<string, unknown>;
  rawItem: GlobeParsedRawItem;
  rawItemId: string;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
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
}: {
  eventRow: Record<string, unknown>;
  rawItem: GlobeParsedRawItem;
  rawItemId: string;
  analysis: Record<string, unknown>;
  primaryTicker: { ticker: string | null; exchange: string | null };
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
        prompt_key: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
        prompt_version: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
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

function evaluateCoverageForStorage(analysis: Record<string, unknown>) {
  const marketScope = normalizeMarketScope(stringValue(analysis.market_scope));
  const primaryTicker = readPrimaryTicker(analysis);

  if (marketScope !== "company") return { dropEvent: false, reason: "" };
  if (isUsListedExchange(primaryTicker.exchange)) return { dropEvent: false, reason: "" };

  const hasUsTicker = recordArray(analysis.tickers).some((item) => isUsListedExchange(stringValue(item.exchange)));
  if (hasUsTicker) return { dropEvent: false, reason: "" };

  return {
    dropEvent: true,
    reason: "Company-scoped item has no U.S.-listed/OTC ticker or broad U.S. market impact.",
  };
}

function isRawItemSkippedOutsideCoverage(row: PersistedRow) {
  const metadata = toRecord(row.metadata);
  return metadata?.ingest_decision === "outside_us_market_coverage";
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

function analysisScopeFromMarketScope(value: MarketScope): AnalysisScope {
  return value === "macro" ? "market" : value;
}

function buildCrossGroupEventKey(ticker: string | null, eventType: string, title: string | null) {
  if (!ticker) return null;
  return `${ticker}:${eventType}:${slugify(title || "")}`.slice(0, 180);
}

function buildGroupDedupeKey(rawItem: GlobeParsedRawItem) {
  return rawItem.dedupe_key || `globe:${rawItem.source_url.toLowerCase()}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function summarizeRaw(rawItem: GlobeParsedRawItem) {
  return {
    source_unique_id: rawItem.source_unique_id,
    source_url: rawItem.source_url,
    title: rawItem.title,
    published_at: rawItem.published_at,
    body_chars: rawItem.body_text?.length || 0,
    analysis_chars: stringValue(rawItem.raw_payload.analysis_text).length,
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

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
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
