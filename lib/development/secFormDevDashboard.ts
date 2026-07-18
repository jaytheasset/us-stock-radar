import { exec, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runSecFilingAnalysisIngest } from "@/lib/secFilingAnalysisIngest";
import {
  findSecRawItem,
  runSec8k6kRouteOnlyPreviewForRawItem,
  runSec425RouteOnlyPreviewForRawItem,
  runSecFilingAnalysisPreviewForRawItem,
  runSecS1F1RouteOnlyPreviewForRawItem,
} from "@/lib/ai/secFilingAnalysisPreview";
import {
  createSecSourceRun,
  ensureSecSource,
  findExistingSecRawItem,
  finishSecSourceRun,
  saveSecRawItem,
} from "@/lib/secStores/rawStore";
import { fetchSecEdgarRawItems, type SecParsedRawItem } from "@/lib/sources/sec/parser";
import { SEC_FORM_ROOM_MANIFEST } from "@/lib/sources/sec/forms/common/forms";
import { build424bAnalysisPrompt } from "@/lib/sources/sec/forms/424b/analysisPrompt";
import {
  PARSER_GROUP_424B,
  PARSER_VERSION_424B,
  type Sec424bParserOutput,
} from "@/lib/sources/sec/forms/424b/types";
import { buildS1F1AnalysisPrompt } from "@/lib/sources/sec/forms/s1-f1/analysisPrompt";
import { parseS1F1Filing } from "@/lib/sources/sec/forms/s1-f1/parser";
import {
  buildSecPeriodicReportsAmendmentAnalysisPromptDraft,
  buildSecPeriodicReportsAnalysisPromptDraft,
} from "@/lib/sources/sec/forms/periodic-reports/analysisPrompt";
import {
  parseSecPeriodicReport,
  type SecPeriodicReportParseInput,
} from "@/lib/sources/sec/forms/periodic-reports/parser";
import {
  buildProxyAnalysisPrompt,
} from "@/lib/sources/sec/forms/proxy/analysisPrompt";
import { parseProxyFiling } from "@/lib/sources/sec/forms/proxy/parser";
import { supabaseDelete, supabaseSelect } from "@/lib/supabase";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const SEC_DEV_REPEAT_LLM_BLOCK_MS = 30 * 60 * 1000;

export type SecDevTestStatus = "pass" | "fail" | "not_run";

export type SecDevRoom = {
  key: string;
  label: string;
  forms: string[];
  folder: string;
  adapterKey?: string;
};

export type SecDevTestResult = {
  file: string;
  status: SecDevTestStatus;
  command: string | null;
  durationMs: number | null;
  ranAt: string | null;
  output: string | null;
  error: string | null;
};

export type SecDevRoomSnapshot = SecDevRoom & {
  testFiles: string[];
  status: SecDevTestStatus;
  passCount: number;
  failCount: number;
  notRunCount: number;
  lastRunAt: string | null;
};

export type SecDevLiveRunResult = {
  mode:
    | "live_dry_run"
    | "latest_analysis_dry_run"
    | "accession_dry_run"
    | "raw_ingest_only"
    | "route_only"
    | "controlled_persist"
    | "reset_analysis"
    | "accession_samples"
    | "recent_persisted";
  status: "pass" | "fail";
  ranAt: string;
  durationMs: number;
  room: string;
  formTypes: string[];
  accessionNumber: string | null;
  rawItemId: string | null;
  summary: string;
  items: Array<Record<string, unknown>>;
  diagnostics: Record<string, unknown> | null;
  error: string | null;
};

type SecDevDerivedResetResult = {
  requested: boolean;
  accessionNumber: string | null;
  rawItemId: string | null;
  matchedEventIds: string[];
  remainingEventIds: string[];
  deleted: Array<{
    target: string;
    count: number;
  }>;
  rawItemPreserved: boolean;
};

export type SecDevOutputPreview = {
  file: string;
  formType: string;
  eventTitle: string;
  eventType: string;
  displayType: string;
  parserRoute: string;
  isParserCompletedArchive: boolean;
  score: number | null;
  deliveryLevel: string;
  signal: string;
  ticker: string;
  filingSummary: string;
  quickTake: string;
  summary: string;
  scoreReason: string;
  keyEvidence: string[];
  whatToWatchNext: string[];
  parserSignals: string[];
  integrationNotes: string[];
  displayData: Array<{ label: string; value: string }>;
};

export type SecDevPromptPreview = {
  file: string;
  prompts: Array<{
    name: string;
    displayName?: string;
    description?: string;
    text: string;
  }>;
};

export type SecDevRoomDetail = SecDevRoomSnapshot & {
  files: Array<{
    kind: "parser" | "adapter" | "prompt" | "display" | "test" | "fixture" | "expected" | "other";
    name: string;
    path: string;
    exists: boolean;
    content: string;
    truncated: boolean;
  }>;
  fixtures: string[];
  expected: string[];
  testResults: SecDevTestResult[];
  liveRuns: SecDevLiveRunResult[];
  outputPreviews: SecDevOutputPreview[];
  promptPreviews: SecDevPromptPreview[];
};

export type SecDevRoomIssueData = SecDevRoomSnapshot & {
  liveRuns: SecDevLiveRunResult[];
};

const ROOT = process.cwd();
const FORMS_ROOT = path.join(ROOT, "lib", "sources", "sec", "forms");
const OUTPUT_ROOT = path.join(ROOT, "outputs", "sec-dev-dashboard");
const TEST_CACHE_PATH = path.join(OUTPUT_ROOT, "test-results.json");
const LIVE_CACHE_PATH = path.join(OUTPUT_ROOT, "live-results.json");
const FILE_CHAR_LIMIT = 80_000;
const LLM_DISABLED_DRY_RUN_MESSAGE = "LLM required but disabled for SEC analysis dry-run";

type RawItemRow = Record<string, unknown>;

export const SEC_DEV_ROOMS: SecDevRoom[] = [
  ...SEC_FORM_ROOM_MANIFEST.map((room) => ({
    key: room.slug,
    label: room.label,
    forms: [...room.forms],
    folder: room.folder,
    adapterKey: room.workerKey,
  })),
  { key: "other", label: "Other SEC", forms: ["OTHER"], folder: "other" },
];

export async function getSecDevRoomSnapshots(): Promise<SecDevRoomSnapshot[]> {
  const cache = await readTestCache();
  return Promise.all(
    SEC_DEV_ROOMS.map(async (room) => {
      const testFiles = await listRoomTestFiles(room);
      const results = testFiles.map((file) => cache[file]).filter(Boolean) as SecDevTestResult[];
      return buildRoomSnapshot(room, testFiles, results);
    }),
  );
}

export async function getSecDevRoomDetail(roomKey: string): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const [testFiles, fixtures, expected, cache] = await Promise.all([
    listRoomTestFiles(room),
    listJsonFiles(path.join(FORMS_ROOT, room.folder, "fixtures")),
    listJsonFiles(path.join(FORMS_ROOT, room.folder, "expected")),
    readTestCache(),
  ]);
  const liveCache = await readLiveCache();
  const testResults = testFiles.map((file) => cache[file] || buildNotRunResult(file));
  const snapshot = buildRoomSnapshot(room, testFiles, testResults);
  const [files, outputPreviews, promptPreviews, recentPersistedRuns] = await Promise.all([
    readRoomFiles(room, testFiles, fixtures, expected),
    readOutputPreviews(room, expected),
    readPromptPreviews(room),
    readRecentPersistedRuns(room),
  ]);

  return {
    ...snapshot,
    files,
    fixtures,
    expected,
    testResults,
    liveRuns: mergeLiveRuns(liveCache[room.key] || [], recentPersistedRuns),
    outputPreviews,
    promptPreviews,
  };
}

export async function getSecDevAllRoomIssueData(): Promise<SecDevRoomIssueData[]> {
  const [cache, liveCache, recentPersistedRunsByRoom] = await Promise.all([
    readTestCache(),
    readLiveCache(),
    readRecentPersistedRunsByRoom(),
  ]);

  return Promise.all(
    SEC_DEV_ROOMS.map(async (room) => {
      const testFiles = await listRoomTestFiles(room);
      const testResults = testFiles.map((file) => cache[file] || buildNotRunResult(file));
      return {
        ...buildRoomSnapshot(room, testFiles, testResults),
        liveRuns: mergeLiveRuns(liveCache[room.key] || [], recentPersistedRunsByRoom.get(room.key) || []),
      };
    }),
  );
}

export async function runSecDevRoomTests(roomKey: string): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const testFiles = await listRoomTestFiles(room);
  const cache = await readTestCache();
  for (const file of testFiles) {
    cache[file] = await runTestFile(file);
  }
  await writeTestCache(cache);
  return getSecDevRoomDetail(roomKey);
}

export async function runSecDevLiveDryRun(
  roomKey: string,
  options: { limit?: number; countPerForm?: number; attachmentLimit?: number; formTypes?: string[]; dateFrom?: string; dateTo?: string } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const started = Date.now();
  const ranAt = new Date().toISOString();
  const formTypes = resolveRunFormTypes(room, options.formTypes);
  const dateFrom = normalizeDateOnly(options.dateFrom);
  const dateTo = normalizeDateOnly(options.dateTo);
  let liveRun: SecDevLiveRunResult;

  try {
    const rawResult = await fetchSecDevBalancedRawItems({
      formTypes,
      countPerForm: clampNumber(options.countPerForm, 1, 100, 1),
      attachmentLimit: clampNumber(options.attachmentLimit, 0, 12, 6),
      includeDocuments: true,
      dateFrom,
      dateTo,
    });
    if (!rawResult.ok) {
      throw new Error(rawResult.error || "SEC live raw fetch failed");
    }

    const items = [];
    for (const rawItem of rawResult.items) {
      const preview = await runSecFilingAnalysisPreviewForRawItem(rawItem, { dryRun: true });
      items.push(buildPreviewItem(rawItem, preview));
    }
    const excludedCount = countExcludedItems(items);

    liveRun = {
      mode: "live_dry_run",
      status: items.every((item) => item.ok) ? "pass" : "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes,
      accessionNumber: null,
      rawItemId: null,
      summary: `Fetched ${rawResult.items.length} live SEC item(s) for ${formTypes.join(", ")}${formatDateRangeSummary(dateFrom, dateTo)}, no DB writes, no OpenAI calls, no alerts.${excludedCount ? ` Excluded before analysis: ${excludedCount}.` : ""}`,
      items,
      diagnostics: rawResult.diagnostics,
      error: null,
    };
  } catch (error) {
    liveRun = {
      mode: "live_dry_run",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes,
      accessionNumber: null,
      rawItemId: null,
      summary: "Live SEC dry-run failed.",
      items: [],
      diagnostics: null,
      error: error instanceof Error ? error.message : "Live SEC dry-run failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

export async function runSecDevLatestAnalysisDryRun(
  roomKey: string,
  options: {
    limit?: number;
    countPerForm?: number;
    attachmentLimit?: number;
    allowLlm?: boolean;
    formTypes?: string[];
    dateFrom?: string;
    dateTo?: string;
    secPromptVariant?: string;
  } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const started = Date.now();
  const ranAt = new Date().toISOString();
  const formTypes = resolveRunFormTypes(room, options.formTypes);
  const dateFrom = normalizeDateOnly(options.dateFrom);
  const dateTo = normalizeDateOnly(options.dateTo);
  const allowLlm = options.allowLlm === true;
  let liveRun: SecDevLiveRunResult;

  try {
    const rawResult = await fetchSecDevBalancedRawItems({
      formTypes,
      countPerForm: clampNumber(options.countPerForm, 1, 100, 1),
      attachmentLimit: clampNumber(options.attachmentLimit, 0, 12, 6),
      includeDocuments: true,
      dateFrom,
      dateTo,
    });
    if (!rawResult.ok) {
      throw new Error(rawResult.error || "SEC live raw fetch failed");
    }

    const items = [];
    for (const rawItem of rawResult.items) {
      const analysis = await runSecFilingAnalysisPreviewForRawItem(rawItem, {
        dryRun: false,
        allowLlm,
        secPromptVariant: stringValue(options.secPromptVariant) || undefined,
      });
      items.push(buildRuntimeAnalysisItem(rawItem, analysis));
    }
    const hasHardError = items.some((item) => item.ok !== true && stringValue(item.error) !== LLM_DISABLED_DRY_RUN_MESSAGE);
    const llmDisabledCount = items.filter((item) => stringValue(item.error) === LLM_DISABLED_DRY_RUN_MESSAGE).length;
    const excludedCount = countExcludedItems(items);

    liveRun = {
      mode: "latest_analysis_dry_run",
      status: hasHardError ? "fail" : "pass",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes,
      accessionNumber: null,
      rawItemId: null,
      summary: `Analyzed ${rawResult.items.length} latest SEC item(s) for ${formTypes.join(", ")}${formatDateRangeSummary(dateFrom, dateTo)}, no DB writes, no alerts. LLM allowed: ${allowLlm ? "yes" : "no"}.${excludedCount ? ` Excluded before analysis: ${excludedCount}.` : ""}${
        llmDisabledCount ? ` ${llmDisabledCount} item(s) need LLM and were left uncompleted because LLM is off.` : ""
      }`,
      items,
      diagnostics: {
        ...((rawResult.diagnostics && typeof rawResult.diagnostics === "object") ? rawResult.diagnostics : {}),
        llm_allowed: allowLlm,
        date_from: dateFrom,
        date_to: dateTo,
      },
      error: null,
    };
  } catch (error) {
    liveRun = {
      mode: "latest_analysis_dry_run",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes,
      accessionNumber: null,
      rawItemId: null,
      summary: `Latest SEC analysis dry-run failed. LLM allowed: ${allowLlm ? "yes" : "no"}.`,
      items: [],
      diagnostics: {
        llm_allowed: allowLlm,
        date_from: dateFrom,
        date_to: dateTo,
      },
      error: error instanceof Error ? error.message : "Latest SEC analysis dry-run failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

export async function runSecDevAccessionSamples(
  roomKey: string,
  options: { limit?: number; maxPages?: number; delayMs?: number; formTypes?: string[]; dateFrom?: string; dateTo?: string } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const started = Date.now();
  const ranAt = new Date().toISOString();
  const formTypes = resolveRunFormTypes(room, options.formTypes);
  const dateFrom = normalizeDateOnly(options.dateFrom);
  const dateTo = normalizeDateOnly(options.dateTo);
  const target = clampNumber(options.limit, 1, 1000, 100);
  const collectPerForm = formTypes.length > 1;
  const expectedTarget = collectPerForm ? target * formTypes.length : target;
  const maxPages = clampNumber(options.maxPages, 1, 50, 20);
  const delayMs = clampNumber(options.delayMs, 0, 10_000, 700);
  const outputPath = path.join(
    OUTPUT_ROOT,
    "accession-samples",
    `${room.key}-${Date.now()}.json`,
  );
  let liveRun: SecDevLiveRunResult;

  try {
    const scriptPath = path.join(ROOT, "scripts", "dev-sec-sample-accessions.mjs");
    await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--formTypes",
        formTypes.join(","),
        "--target",
        String(target),
        ...(collectPerForm ? ["--mode", "per-form"] : []),
        "--maxPages",
        String(maxPages),
        "--delayMs",
        String(delayMs),
        ...(dateFrom ? ["--dateFrom", dateFrom] : []),
        ...(dateTo ? ["--dateTo", dateTo] : []),
        "--out",
        outputPath,
      ],
      {
        cwd: ROOT,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const raw = await fs.readFile(outputPath, "utf8");
    const sample = JSON.parse(raw) as Record<string, unknown>;
    const sampleItems = Array.isArray(sample.items) ? sample.items.map(readRecord).filter(Boolean) as Record<string, unknown>[] : [];
    const items = sampleItems.map((item) => ({
      ok: true,
      accession_number: stringValue(item.accessionNumber),
      form_type: stringValue(item.formType),
      ticker: null,
      title: stringValue(item.title),
      source_url: stringValue(item.detailUrl),
      updated: stringValue(item.updated),
      requested_form_type: stringValue(item.requestedFormType),
    }));

    const metTarget = items.length >= expectedTarget;
    liveRun = {
      mode: "accession_samples",
      status: metTarget ? "pass" : "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes,
      accessionNumber: null,
      rawItemId: null,
      summary: collectPerForm
        ? `Collected ${items.length}/${expectedTarget} SEC accession sample(s), ${target} per form, for ${formTypes.join(", ")}${formatDateRangeSummary(dateFrom, dateTo)}. No filing text fetch, DB writes, OpenAI calls, or alerts.`
        : `Collected ${items.length}/${target} SEC accession sample(s) for ${formTypes.join(", ")}${formatDateRangeSummary(dateFrom, dateTo)}. No filing text fetch, DB writes, OpenAI calls, or alerts.`,
      items,
      diagnostics: {
        output_path: path.relative(ROOT, outputPath).replace(/\\/g, "/"),
        target,
        expected_target: expectedTarget,
        collection_mode: collectPerForm ? "per_form" : "total",
        maxPages,
        delayMs,
        date_from: dateFrom,
        date_to: dateTo,
        ...(readRecord(sample.diagnostics) || {}),
      },
      error: null,
    };
  } catch (error) {
    liveRun = {
      mode: "accession_samples",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes,
      accessionNumber: null,
      rawItemId: null,
      summary: "SEC accession sample collection failed.",
      items: [],
      diagnostics: {
        target,
        maxPages,
        delayMs,
        date_from: dateFrom,
        date_to: dateTo,
      },
      error: error instanceof Error ? error.message : "SEC accession sample collection failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

async function fetchSecDevBalancedRawItems({
  attachmentLimit,
  countPerForm,
  dateFrom,
  dateTo,
  formTypes,
  includeDocuments,
}: {
  attachmentLimit: number;
  countPerForm: number;
  dateFrom: string | null;
  dateTo: string | null;
  formTypes: string[];
  includeDocuments: boolean;
}) {
  const normalizedForms = uniqueStrings(formTypes);
  if (normalizedForms.length <= 1) {
    return fetchSecEdgarRawItems({
      formTypes: normalizedForms,
      limit: countPerForm,
      countPerForm,
      attachmentLimit,
      includeDocuments,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
  }

  const items: SecParsedRawItem[] = [];
  const perForm: Array<Record<string, unknown>> = [];
  const aggregateDiagnostics = {
    fetch_mode: "per_form_balanced",
    requestedFormTypes: normalizedForms,
    countPerForm,
    feedsRequested: 0,
    parsedFromFeeds: 0,
    documentsRequested: 0,
    documentsFetched: 0,
    documentsFailed: 0,
    dateFrom,
    dateTo,
    per_form: perForm,
  };

  for (const formType of normalizedForms) {
    const result = await fetchSecEdgarRawItems({
      formTypes: [formType],
      limit: countPerForm,
      countPerForm,
      attachmentLimit,
      includeDocuments,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    });
    const diagnostics = readRecord(result.diagnostics) || {};
    aggregateDiagnostics.feedsRequested += numberValue(diagnostics.feedsRequested) ?? 0;
    aggregateDiagnostics.parsedFromFeeds += numberValue(diagnostics.parsedFromFeeds) ?? 0;
    aggregateDiagnostics.documentsRequested += numberValue(diagnostics.documentsRequested) ?? 0;
    aggregateDiagnostics.documentsFetched += numberValue(diagnostics.documentsFetched) ?? 0;
    aggregateDiagnostics.documentsFailed += numberValue(diagnostics.documentsFailed) ?? 0;
    perForm.push({
      formType,
      ok: result.ok,
      count: result.items.length,
      error: stringValue(result.error) || null,
      diagnostics,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        status: result.status,
        fetchedAt: result.fetchedAt,
        count: items.length,
        items,
        diagnostics: aggregateDiagnostics,
        error: result.error || `SEC current feed failed for ${formType}`,
      };
    }
    items.push(...result.items);
  }

  return {
    ok: true as const,
    status: 200,
    fetchedAt: new Date().toISOString(),
    count: items.length,
    items,
    diagnostics: aggregateDiagnostics,
  };
}

function buildPreviewItem(rawItem: RawItemRow, preview: unknown) {
  const previewRecord = readRecord(preview) || {};
  const input = readRecord(previewRecord.input);
  const filingPackage = readRecord(input?.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const parentRegistrationContext = readRecord(filingPackage?.parent_registration_context);
  const parentFilingContext = readRecord(filingPackage?.parent_filing_context);
  const investableUniverseGate = readRecord(filingPackage?.investable_universe_gate);
  const filingContext = readRecord(filingPackage?.filing_context);
  const ownershipContext = readRecord(filingContext?.ownership);
  const archiveContextGuard = readRecord(ownershipContext?.archive_context_guard);
  const prompt = readRecord(previewRecord.prompt);
  const model = stringValue(previewRecord.model);
  const rawPayload = readRecord(rawItem.raw_payload);
  const analysis = readRecord(previewRecord.analysis);
  const isExcluded = isSkipAnalysisResult(analysis, investableUniverseGate);
  const ok = previewRecord.ok === true;

  return {
    ok,
    is_excluded: isExcluded,
    analysis_action: stringValue(analysis?.analysis_action) || (isExcluded ? "skip_analysis" : null),
    skip_gate: stringValue(analysis?.skip_gate) || stringValue(investableUniverseGate?.gate) || null,
    skip_reason: stringValue(analysis?.skip_reason) || stringValue(investableUniverseGate?.reason) || null,
    skip_evidence: stringArray(analysis?.key_evidence).length
      ? stringArray(analysis?.key_evidence).slice(0, 8)
      : stringArray(investableUniverseGate?.evidence).slice(0, 8),
    accession_number: stringValue(rawItem.source_unique_id),
    form_type: rawPayload?.form_type || null,
    ticker: rawPayload?.ticker || null,
    title: stringValue(rawItem.title),
    source_url: stringValue(rawItem.source_url),
    body_chars: stringValue(rawItem.body_text).length,
    hard_parser_keys: hardParsers ? Object.keys(hardParsers) : [],
    prompt_key: stringValue(prompt?.key) || null,
    prompt_version: stringValue(prompt?.version) || null,
    parent_registration_context_present: Boolean(parentRegistrationContext),
    parent_registration_context_status: stringValue(parentRegistrationContext?.status) || null,
    parent_registration_context_match_method: stringValue(parentRegistrationContext?.match_method) || null,
    parent_registration_context_match_reasons: stringArray(parentRegistrationContext?.match_reasons).slice(0, 8),
    parent_context_present: Boolean(parentFilingContext),
    parent_context_status: stringValue(parentFilingContext?.status) || null,
    parent_context_match_method: stringValue(parentFilingContext?.match_method) || null,
    parent_context_confidence: stringValue(parentFilingContext?.confidence) || null,
    filing_context_present: Boolean(filingContext),
    ownership_context_present: Boolean(ownershipContext),
    archive_context_guard: archiveContextGuard
      ? {
          analysis_needed: archiveContextGuard.analysis_needed === true,
          context_signal_level: stringValue(archiveContextGuard.context_signal_level) || null,
          reasons: stringArray(archiveContextGuard.reasons),
          metrics: readRecord(archiveContextGuard.metrics) || null,
        }
      : null,
    stage: stringValue(previewRecord.stage) || null,
    model: model || null,
    runtime_output: analysis
      ? {
          model: model || null,
          event_title: stringValue(analysis.event_title),
          event_type: stringValue(analysis.event_type),
          display_type: null,
          parser_route: isExcluded ? "excluded before analysis" : "preview",
          parent_registration_context: buildParentRegistrationContextDebug(parentRegistrationContext),
          parent_filing_context: buildParentFilingContextDebug(parentFilingContext),
          is_parser_completed_archive: false,
          is_excluded: isExcluded,
          skip_gate: stringValue(analysis.skip_gate) || stringValue(investableUniverseGate?.gate) || null,
          skip_reason: stringValue(analysis.skip_reason) || stringValue(investableUniverseGate?.reason) || null,
          score: numberValue(analysis.score),
          delivery_level: deriveDeliveryLabel(numberValue(analysis.score)),
          signal: stringValue(analysis.signal),
          ticker: null,
          filing_summary: "",
          quick_take: stringValue(analysis.quick_take),
          summary: stringValue(analysis.summary),
          archive_summary: "",
          score_reason: stringValue(analysis.score_reason),
          why_it_matters: stringValue(analysis.why_it_matters),
          key_evidence: stringArray(analysis.key_evidence).slice(0, 8),
          what_to_watch_next: stringArray(analysis.what_to_watch_next).slice(0, 8),
          parser_signals: [],
          display_data: [],
          usage: readRecord(previewRecord.usage) || null,
          cost_estimate: readRecord(previewRecord.costEstimate) || null,
        }
      : null,
    error: ok ? null : stringValue(previewRecord.error) || null,
  };
}

function buildRouteOnlyItem(rawItem: RawItemRow, routeResult: unknown) {
  const resultRecord = readRecord(routeResult) || {};
  const input = readRecord(resultRecord.input);
  const route = readRecord(resultRecord.route);
  const prompt = readRecord(resultRecord.prompt);
  const relatedTransactionContext = buildSec425RelatedTransactionContextPreview(
    resultRecord.relatedTransactionContext,
  );
  const rawPayload = readRecord(rawItem.raw_payload);
  const ok = resultRecord.ok === true;
  const formType = stringValue(rawPayload?.form_type).toUpperCase();
  const isSec8k6kRoute = /^(?:8-K|8-K\/A|6-K|6-K\/A)$/.test(formType);
  const primaryRoute = readRecord(route?.primary_route_candidate);

  return {
    ok,
    accession_number: stringValue(rawItem.source_unique_id),
    raw_item_id: stringValue(rawItem.id) || null,
    form_type: rawPayload?.form_type || null,
    ticker: rawPayload?.ticker || null,
    title: stringValue(rawItem.title),
    source_url: stringValue(rawItem.source_url),
    body_chars: stringValue(rawItem.body_text).length,
    prompt_key: stringValue(prompt?.key) || null,
    prompt_version: stringValue(prompt?.version) || null,
    stage: stringValue(resultRecord.stage) || null,
    model: stringValue(resultRecord.model) || stringValue(prompt?.model) || null,
    route_only: route
      ? isSec8k6kRoute
        ? {
            primary_route_candidate: primaryRoute,
            route_candidates: Array.isArray(route.route_candidates) ? route.route_candidates.slice(0, 8) : [],
            analysis_needed: route.analysis_needed === true,
            archive_like_candidate: route.archive_like_candidate === true,
            deterministic_possible: route.deterministic_possible === true,
            filing_complexity: stringValue(route.filing_complexity),
            low_signal_reason: stringValue(route.low_signal_reason) || null,
            needs_parent_context: route.needs_parent_context === true,
            market_context_needed: route.market_context_needed === true,
            selected_source_block_ids: stringArray(route.selected_source_block_ids),
          }
        : stringValue(route.source_form_type) === "425"
        ? {
            event_type: stringValue(route.event_type),
            route_case: stringValue(route.route_case),
            communication_mode: stringValue(route.communication_mode),
            transaction_stage: stringValue(route.transaction_stage),
            analysis_needed: route.needs_analysis_llm === true,
            archive_like_candidate: route.archive_like_candidate === true,
            material_update_present: route.material_update_present === true,
            material_update_reason: stringValue(route.material_update_reason) || null,
            needs_parent_context: route.needs_parent_context === true,
            confidence: stringValue(route.confidence),
            routing_reason: stringValue(route.routing_reason),
            selected_source_block_ids: stringArray(route.selected_source_block_ids),
          }
        : {
            display_mode: stringValue(route.display_mode),
            confidence: numberValue(route.confidence),
            route_reason: stringValue(route.route_reason),
            required_surfaces: stringArray(route.required_surfaces),
            rejected_modes: Array.isArray(route.rejected_modes) ? route.rejected_modes.slice(0, 5) : [],
          }
      : null,
    related_transaction_context: relatedTransactionContext,
    runtime_output: route
      ? {
          model: stringValue(resultRecord.model) || stringValue(prompt?.model) || null,
          event_title: stringValue(rawItem.title),
          event_type: isSec8k6kRoute
            ? stringValue(primaryRoute?.route_type) || stringValue(route.event_type) || null
            : stringValue(route.event_type) || null,
          display_type: "route_only",
          parser_route: isSec8k6kRoute
            ? "8-K/6-K route-only test"
            : stringValue(route.source_form_type) === "425"
              ? "425 route-only test"
              : "S-1/F-1 route-only test",
          is_parser_completed_archive: false,
          is_excluded: false,
          display_data: isSec8k6kRoute
            ? [
                `primary_route: ${stringValue(primaryRoute?.route_type) || stringValue(route.event_type) || "-"}`,
                `complexity: ${stringValue(route.filing_complexity) || "-"}`,
                `analysis_needed: ${route.analysis_needed === true ? "yes" : "no"}`,
                `selected_blocks: ${stringArray(route.selected_source_block_ids).join(", ") || "-"}`,
              ]
            : stringValue(route.source_form_type) === "425"
            ? [
                `event_type: ${stringValue(route.event_type) || "-"}`,
                `route_case: ${stringValue(route.route_case) || "-"}`,
                `communication_mode: ${stringValue(route.communication_mode) || "-"}`,
                `transaction_stage: ${stringValue(route.transaction_stage) || "-"}`,
                `analysis_needed: ${route.needs_analysis_llm === true}`,
                `source_blocks: ${stringArray(route.selected_source_block_ids).join(", ") || "-"}`,
              ]
            : [
                `display_mode: ${stringValue(route.display_mode) || "-"}`,
                `confidence: ${stringValue(route.confidence) || "-"}`,
                `reason: ${stringValue(route.route_reason) || "-"}`,
                `surfaces: ${stringArray(route.required_surfaces).join(", ") || "-"}`,
              ],
          usage: readRecord(resultRecord.usage) || null,
          cost_estimate: readRecord(resultRecord.costEstimate) || null,
        }
      : null,
    usage: readRecord(resultRecord.usage) || null,
    cost_estimate: readRecord(resultRecord.costEstimate) || null,
    error: ok ? null : stringValue(resultRecord.error) || null,
  };
}

function buildRuntimeAnalysisItem(rawItem: RawItemRow, result: unknown) {
  const resultRecord = readRecord(result) || {};
  const input = readRecord(resultRecord.input);
  const filingPackage = readRecord(input?.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const parentRegistrationContext = readRecord(filingPackage?.parent_registration_context);
  const parentFilingContext = readRecord(filingPackage?.parent_filing_context);
  const filingContext = readRecord(filingPackage?.filing_context);
  const form25RelatedContext = readRecord(filingPackage?.form25_related_filing_context);
  const form25Parser = readRecord(hardParsers?.form25);
  const form25Facts = readRecord(form25Parser?.facts);
  const form25Raw = readRecord(form25Parser?.raw);
  const form25DirectSourceBlocks = debugRecordArray(form25Raw?.directSourceBlocks);
  const ownershipContext = readRecord(filingContext?.ownership);
  const archiveContextGuard = readRecord(ownershipContext?.archive_context_guard);
  const prompt = readRecord(resultRecord.prompt) || readRecord(resultRecord.runtime);
  const model = stringValue(resultRecord.model);
  const rawPayload = readRecord(rawItem.raw_payload);
  const analysis = readRecord(resultRecord.analysis);
  const form25ValidationRepair = readRecord(resultRecord.form25ValidationRepair);
  const ok = resultRecord.ok === true;
  const llmFailureDebug = ok ? null : buildLlmFailureDebug(resultRecord);
  const investableUniverseGate = readRecord(filingPackage?.investable_universe_gate);
  const isExcluded = isSkipAnalysisResult(analysis, investableUniverseGate);
  const parserSignals = readParserSignalsFromHardParsers(hardParsers);
  const score = numberValue(analysis?.score);
  const displayPayload = readRecord(analysis?.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const persisted8k6kRouterResult = readRecord(analysis?.sec_8k_6k_router_result) || readRecord(resultRecord.triage);
  const sec8k6kDebug = readRecord(resultRecord.sec8k6kDebug) ||
    (persisted8k6kRouterResult
      ? {
          router_result: persisted8k6kRouterResult,
          analysis_source_blocks: [],
          analysis_source_bundle: {
            warnings: ["Detailed source-block previews were unavailable after persistence."],
          },
        }
      : null);
  const primaryTicker = readRecord(analysis?.primary_ticker);
  const deliveryLevel = deriveDeliveryLabel(score);
  const isParserCompletedArchive =
    (parserSignals.includes("deterministic_archive") || analysis?.deterministic_parser_archive === true) &&
    deliveryLevel === "archive";

  return {
    ok,
    is_excluded: isExcluded,
    analysis_action: stringValue(analysis?.analysis_action) || (isExcluded ? "skip_analysis" : null),
    skip_gate: stringValue(analysis?.skip_gate) || stringValue(investableUniverseGate?.gate) || null,
    skip_reason: stringValue(analysis?.skip_reason) || stringValue(investableUniverseGate?.reason) || null,
    skip_evidence: stringArray(analysis?.key_evidence).length
      ? stringArray(analysis?.key_evidence).slice(0, 8)
      : stringArray(investableUniverseGate?.evidence).slice(0, 8),
    accession_number: stringValue(rawItem.source_unique_id),
    raw_item_id: stringValue(rawItem.id) || null,
    form_type: rawPayload?.form_type || null,
    ticker: stringValue(primaryTicker?.ticker) || stringValue(rawPayload?.ticker) || null,
    title: stringValue(analysis?.event_title) || stringValue(rawItem.title),
    source_url: stringValue(rawItem.source_url),
    body_chars: stringValue(rawItem.body_text).length,
    hard_parser_keys: hardParsers ? Object.keys(hardParsers) : [],
    prompt_key: stringValue(prompt?.key) || null,
    prompt_version: stringValue(prompt?.version) || null,
    parent_context_present: Boolean(parentFilingContext),
    parent_context_status: stringValue(parentFilingContext?.status) || null,
    parent_context_match_method: stringValue(parentFilingContext?.match_method) || null,
    parent_context_confidence: stringValue(parentFilingContext?.confidence) || null,
    parent_registration_context_present: Boolean(parentRegistrationContext),
    parent_registration_context_status: stringValue(parentRegistrationContext?.status) || null,
    parent_registration_context_match_method: stringValue(parentRegistrationContext?.match_method) || null,
    parent_registration_context_match_reasons: stringArray(parentRegistrationContext?.match_reasons).slice(0, 8),
    filing_context_present: Boolean(filingContext),
    ownership_context_present: Boolean(ownershipContext),
    archive_context_guard: archiveContextGuard
      ? {
          analysis_needed: archiveContextGuard.analysis_needed === true,
          context_signal_level: stringValue(archiveContextGuard.context_signal_level) || null,
          reasons: stringArray(archiveContextGuard.reasons),
          metrics: readRecord(archiveContextGuard.metrics) || null,
        }
      : null,
    event_type: stringValue(analysis?.event_type) || null,
    score,
    delivery_level: deliveryLevel,
    stage: stringValue(resultRecord.stage) || null,
    model: model || null,
    llm_failure_debug: llmFailureDebug,
    runtime_output: analysis
      ? {
          model: model || null,
          event_title: stringValue(analysis.event_title),
          event_type: stringValue(analysis.event_type),
          display_type: stringValue(displayPayload?.display_type) || null,
          parser_route: isExcluded ? "excluded before analysis" : isParserCompletedArchive ? "parser deterministic archive" : "analysis / LLM path",
          parent_registration_context: buildParentRegistrationContextDebug(parentRegistrationContext),
          parent_filing_context: buildParentFilingContextDebug(parentFilingContext),
          is_parser_completed_archive: isParserCompletedArchive,
          is_excluded: isExcluded,
          skip_gate: stringValue(analysis.skip_gate) || stringValue(investableUniverseGate?.gate) || null,
          skip_reason: stringValue(analysis.skip_reason) || stringValue(investableUniverseGate?.reason) || null,
          score,
          delivery_level: deliveryLevel,
          signal: stringValue(analysis.signal),
          ticker: stringValue(primaryTicker?.ticker) || firstString(analysis.tickers) || null,
          filing_summary: stringValue(displayData?.filing_summary) || stringValue(analysis.filing_summary),
          quick_take: stringValue(analysis.quick_take),
          summary: stringValue(analysis.summary),
          archive_summary: stringValue(analysis.archive_summary),
          score_reason: stringValue(analysis.score_reason),
          why_it_matters: stringValue(analysis.why_it_matters),
          key_evidence: stringArray(analysis.key_evidence).slice(0, 8),
          what_to_watch_next: stringArray(analysis.what_to_watch_next).slice(0, 8),
          parser_signals: parserSignals,
          transaction_fingerprint: readRecord(analysis.transaction_fingerprint) || null,
          form25_parser_context: form25Parser
            ? {
                subject_company_cik: stringValue(readRecord(form25Facts?.subject_company_cik)?.value) || null,
                issuer_name: stringValue(readRecord(form25Facts?.issuer_name)?.value) || null,
                removal_reason_text: stringValue(readRecord(form25Facts?.removal_reason_text)?.value) || null,
                direct_source_block_count: form25DirectSourceBlocks.length,
                direct_source_blocks: form25DirectSourceBlocks.slice(0, 3).map((block) => ({
                  block_id: stringValue(block.block_id) || null,
                  label: stringValue(block.label) || null,
                  priority: numberValue(block.priority),
                  text_preview: stringValue(block.text).slice(0, 240),
                })),
              }
            : null,
          form25_lifecycle: readRecord(analysis.form25_lifecycle) || null,
          form25_related_context: buildForm25RelatedContextDebug(form25RelatedContext),
          form25_validation_repair: form25ValidationRepair
            ? {
                attempted: form25ValidationRepair.attempted === true,
                run_ok: form25ValidationRepair.run_ok === true,
                run_error: stringValue(form25ValidationRepair.run_error) || null,
                issue_codes: stringArray(form25ValidationRepair.issue_codes).slice(0, 8),
                source_block_ids: stringArray(form25ValidationRepair.source_block_ids).slice(0, 3),
                applied_patch_paths: stringArray(form25ValidationRepair.applied_patch_paths).slice(0, 16),
                unresolved_warning_codes: stringArray(form25ValidationRepair.unresolved_warning_codes).slice(0, 8),
              }
            : null,
          sec_8k_6k_debug: sec8k6kDebug,
          display_data: previewDisplayData(displayData),
          display_payload_debug: buildDisplayPayloadDebug(displayPayload, displayData, analysis),
          usage: readRecord(resultRecord.usage) || null,
          cost_estimate: readRecord(resultRecord.costEstimate) || null,
        }
      : null,
    error: ok ? null : stringValue(resultRecord.error) || null,
  };
}

function buildLlmFailureDebug(result: Record<string, unknown>) {
  const outputText = stringValue(result.outputText);
  const rawResponse = readRecord(result.rawOpenAIResponse);
  const runtime = readRecord(result.runtime);
  const input = readRecord(result.input);
  const usage = readRecord(result.usage);
  const candidateSummaries = Array.isArray(rawResponse?.candidates)
    ? rawResponse.candidates.map((candidate, index) => {
        const candidateRecord = readRecord(candidate) || {};
        const content = readRecord(candidateRecord.content);
        const parts = Array.isArray(content?.parts) ? content.parts : [];
        const text = parts
          .map((part) => stringValue(readRecord(part)?.text))
          .filter(Boolean)
          .join("\n");
        return {
          index,
          finishReason: stringValue(candidateRecord.finishReason) || null,
          textLength: text.length,
          textPreview: text ? text.slice(0, 4000) : null,
          safetyRatings: candidateRecord.safetyRatings || null,
        };
      })
    : [];

  return {
    stage: stringValue(result.stage) || null,
    status: result.status ?? null,
    error: stringValue(result.error) || null,
    prompt: runtime ? readRecord(runtime.prompt) || runtime : null,
    outputTextLength: outputText.length,
    outputTextPreview: outputText ? outputText.slice(0, 8000) : null,
    outputTextTail: outputText && outputText.length > 8000 ? outputText.slice(-4000) : null,
    usage,
    rawResponseSummary: rawResponse
      ? {
          responseId: stringValue(rawResponse.responseId) || null,
          error: readRecord(rawResponse.error) || null,
          promptFeedback: rawResponse.promptFeedback || null,
          usageMetadata: rawResponse.usageMetadata || null,
          candidates: candidateSummaries,
        }
      : null,
    sourceItem: result.sourceItem || null,
    filingPackage: readRecord(input?.filing_package)
      ? {
          form_type: stringValue(readRecord(input?.filing_package)?.form_type) || null,
          accession_number: stringValue(readRecord(input?.filing_package)?.accession_number) || null,
          form_family: stringValue(readRecord(input?.filing_package)?.form_family) || null,
        }
      : null,
  };
}

function readParserSignalsFromHardParsers(hardParsers: Record<string, unknown> | null) {
  if (!hardParsers) return [];
  const signals: string[] = [];
  for (const value of Object.values(hardParsers)) {
    const parserOutput = readRecord(value);
    signals.push(...stringArray(parserOutput?.signals));
  }
  return uniqueStrings(signals);
}

function countExcludedItems(items: Array<Record<string, unknown>>) {
  return items.filter((item) => item.is_excluded === true || stringValue(item.skip_gate)).length;
}

async function readRecentPersistedRuns(room: SecDevRoom): Promise<SecDevLiveRunResult[]> {
  try {
    const result = await supabaseSelect("events", {
      select: "*",
      source_group: "eq.filings",
      order: "detected_at.desc",
      limit: "120",
    });
    if (!result.ok || !Array.isArray(result.data)) return [];

    const allowedForms = new Set(room.forms.map(normalizeFormForPreviewFilter));
    const rows = result.data
      .map((row) => readRecord(row))
      .filter((row): row is Record<string, unknown> => Boolean(row))
      .filter((row) => persistedEventMatchesRoom(row, allowedForms))
      .slice(0, 10);
    if (!rows.length) return [];

    const analysisByEventId = await readRecentEventAnalysisMap(rows.map((row) => stringValue(row.id)).filter(Boolean));
    return rows.map((row) => buildRecentPersistedRun(room, row, analysisByEventId.get(stringValue(row.id)) || null));
  } catch {
    return [];
  }
}

async function readRecentPersistedRunsByRoom(): Promise<Map<string, SecDevLiveRunResult[]>> {
  const runsByRoom = new Map<string, SecDevLiveRunResult[]>();
  try {
    const result = await supabaseSelect("events", {
      select: "*",
      source_group: "eq.filings",
      order: "detected_at.desc",
      limit: "160",
    });
    if (!result.ok || !Array.isArray(result.data)) return runsByRoom;

    const rows = result.data
      .map((row) => readRecord(row))
      .filter((row): row is Record<string, unknown> => Boolean(row));
    if (!rows.length) return runsByRoom;

    const analysisByEventId = await readRecentEventAnalysisMap(rows.map((row) => stringValue(row.id)).filter(Boolean));

    for (const room of SEC_DEV_ROOMS) {
      const allowedForms = new Set(room.forms.map(normalizeFormForPreviewFilter));
      const roomRows = rows.filter((row) => persistedEventMatchesRoom(row, allowedForms)).slice(0, 10);
      if (!roomRows.length) continue;
      runsByRoom.set(
        room.key,
        roomRows.map((row) => buildRecentPersistedRun(room, row, analysisByEventId.get(stringValue(row.id)) || null)),
      );
    }
  } catch {
    return runsByRoom;
  }

  return runsByRoom;
}

async function readRecentEventAnalysisMap(eventIds: string[]) {
  const result = new Map<string, Record<string, unknown>>();
  if (!eventIds.length) return result;

  try {
    const response = await supabaseSelect("event_analysis", {
      select: "*",
      event_id: `in.(${eventIds.join(",")})`,
      limit: String(eventIds.length),
    });
    if (!response.ok || !Array.isArray(response.data)) return result;

    for (const row of response.data) {
      const record = readRecord(row);
      const eventId = stringValue(record?.event_id);
      if (record && eventId) result.set(eventId, record);
    }
  } catch {
    return result;
  }

  return result;
}

function persistedEventMatchesRoom(row: Record<string, unknown>, allowedForms: Set<string>) {
  const formType = readPersistedEventFormType(row);
  return Boolean(formType && allowedForms.has(normalizeFormForPreviewFilter(formType)));
}

function buildRecentPersistedRun(
  room: SecDevRoom,
  row: Record<string, unknown>,
  eventAnalysis: Record<string, unknown> | null,
): SecDevLiveRunResult {
  const metadata = readRecord(row.metadata) || {};
  const displayPayload = readRecord(metadata.display_payload);
  const displayData = readRecord(displayPayload?.data);
  const analysisMetadata = readRecord(eventAnalysis?.metadata) || {};
  const runtimeAnalysis = {
    ...metadata,
    ...analysisMetadata,
    sec_s3_display_warnings: metadata.sec_s3_display_warnings || analysisMetadata.sec_s3_display_warnings,
  };
  const score = numberValue(row.score);
  const deliveryLevel = stringValue(row.delivery_level) || deriveDeliveryLabel(score);
  const formType = readPersistedEventFormType(row);
  const accessionNumber = readPersistedEventAccession(row);
  const ticker = readPersistedEventTicker(row);
  const ranAt = readPersistedEventTime(row);

  return {
    mode: "recent_persisted",
    status: "pass",
    ranAt,
    durationMs: 0,
    room: room.key,
    formTypes: room.forms,
    accessionNumber: accessionNumber || null,
    rawItemId: stringValue(row.raw_item_id) || null,
    summary: "Recent persisted SEC filing event loaded from the database.",
    items: [
      {
        event_id: stringValue(row.id) || null,
        raw_item_id: stringValue(row.raw_item_id) || null,
        accession_number: accessionNumber || null,
        form_type: formType || null,
        title: stringValue(row.title) || null,
        ticker: ticker || null,
        event_type: stringValue(row.event_type) || null,
        score,
        delivery_level: deliveryLevel,
        detail_url: buildLocalFilingUrl(stringValue(row.id), deliveryLevel),
        runtime_output: {
          event_title: stringValue(row.title),
          event_type: stringValue(row.event_type),
          display_type: stringValue(displayPayload?.display_type) || null,
          parser_route: "persisted DB event",
          parent_registration_context: buildParentRegistrationContextDebug(readRecord(metadata.parent_registration_context)),
          parent_filing_context: buildParentFilingContextDebug(readRecord(metadata.parent_filing_context)),
          is_parser_completed_archive: false,
          is_excluded: false,
          score,
          delivery_level: deliveryLevel,
          signal: stringValue(row.signal),
          ticker,
          filing_summary: stringValue(displayData?.filing_summary),
          quick_take: stringValue(row.quick_take),
          summary: stringValue(row.summary),
          archive_summary: stringValue(metadata.archive_summary),
          score_reason: stringValue(row.reason) || stringValue(metadata.score_reason),
          why_it_matters: stringValue(eventAnalysis?.why_it_matters),
          key_evidence: stringArray(eventAnalysis?.key_evidence).slice(0, 8),
          what_to_watch_next: stringArray(eventAnalysis?.watch_next).slice(0, 8),
          parser_signals: stringArray(metadata.parser_signals),
          transaction_fingerprint: readRecord(metadata.transaction_fingerprint) || null,
          display_data: previewDisplayData(displayData),
          display_payload_debug: buildDisplayPayloadDebug(displayPayload, displayData, runtimeAnalysis),
          usage: null,
          cost_estimate: null,
        },
        alert_delivery: null,
      },
    ],
    diagnostics: {
      source: "supabase.events",
      event_id: stringValue(row.id) || null,
    },
    error: null,
  };
}

function mergeLiveRuns(cachedRuns: SecDevLiveRunResult[], persistedRuns: SecDevLiveRunResult[]) {
  const seenEventIds = new Set<string>();
  const merged: SecDevLiveRunResult[] = [];

  for (const run of [...cachedRuns, ...persistedRuns]) {
    const eventIds = run.items.map((item) => stringValue(item.event_id)).filter(Boolean);
    if (eventIds.length && eventIds.some((eventId) => seenEventIds.has(eventId))) continue;
    for (const eventId of eventIds) seenEventIds.add(eventId);
    merged.push(run);
  }

  return merged.slice(0, 30);
}

function readPersistedEventFormType(row: Record<string, unknown>) {
  const metadata = readRecord(row.metadata) || {};
  const rawPayload = readRecord(metadata.raw_payload);
  const filing = readRecord(metadata.filing);
  const displayPayload = readRecord(metadata.display_payload);
  const displayData = readRecord(displayPayload?.data);

  return (
    stringValue(row.form_type) ||
    stringValue(metadata.form_type) ||
    stringValue(metadata.sec_form) ||
    stringValue(metadata.formType) ||
    stringValue(rawPayload?.form_type) ||
    stringValue(filing?.form_type) ||
    stringValue(displayData?.form_type)
  );
}

function readPersistedEventAccession(row: Record<string, unknown>) {
  const metadata = readRecord(row.metadata) || {};
  const rawPayload = readRecord(metadata.raw_payload);
  const filing = readRecord(metadata.filing);
  return (
    stringValue(row.accession_number) ||
    stringValue(metadata.accession_number) ||
    stringValue(metadata.accessionNumber) ||
    stringValue(rawPayload?.accession_number) ||
    stringValue(filing?.accession_number)
  );
}

function readPersistedEventTicker(row: Record<string, unknown>) {
  const metadata = readRecord(row.metadata) || {};
  const marketContext = readRecord(metadata.market_context);
  const primaryTicker = readRecord(metadata.primary_ticker);
  return (
    stringValue(row.ticker) ||
    stringValue(primaryTicker?.ticker) ||
    stringValue(metadata.ticker) ||
    stringValue(marketContext?.ticker) ||
    stringValue(marketContext?.symbol)
  );
}

function readPersistedEventTime(row: Record<string, unknown>) {
  return (
    stringValue(row.detected_at) ||
    stringValue(row.updated_at) ||
    stringValue(row.created_at) ||
    stringValue(row.published_at) ||
    new Date().toISOString()
  );
}

function isSkipAnalysisResult(
  analysis: Record<string, unknown> | null,
  investableUniverseGate: Record<string, unknown> | null,
) {
  return (
    stringValue(analysis?.analysis_action) === "skip_analysis" ||
    Boolean(stringValue(analysis?.skip_gate)) ||
    stringValue(investableUniverseGate?.action) === "skip_analysis" ||
    Boolean(stringValue(investableUniverseGate?.gate))
  );
}

export async function runSecDevAccessionDryRun(
  roomKey: string,
  options: { accessionNumber?: string; rawItemId?: string; secPromptVariant?: string } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const accessionNumber = stringValue(options.accessionNumber);
  const rawItemId = stringValue(options.rawItemId);
  const started = Date.now();
  const ranAt = new Date().toISOString();
  let liveRun: SecDevLiveRunResult;

  try {
    if (!accessionNumber && !rawItemId) {
      throw new Error("Accession dry-run requires accessionNumber or rawItemId.");
    }

    const rawResult = await findSecRawItem({
      accessionNumber: accessionNumber || undefined,
      rawItemId: rawItemId || undefined,
    });
    if (!rawResult.ok || !rawResult.rawItem) {
      throw new Error(rawResult.error || "SEC raw item not found. Ingest raw first, then dry-run this accession.");
    }

    const analysis = await runSecFilingAnalysisIngest({
      accessionNumber: accessionNumber || undefined,
      rawItemId: rawItemId || undefined,
      dryRun: true,
      secPromptVariant: stringValue(options.secPromptVariant) || undefined,
    });
    const item = buildRuntimeAnalysisItem(rawResult.rawItem, analysis);

    liveRun = {
      mode: "accession_dry_run",
      status: item.ok === true ? "pass" : "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || stringValue(item.accession_number) || null,
      rawItemId: rawItemId || stringValue(rawResult.rawItem.id) || null,
      summary: "Analyzed one existing SEC raw item by accession; no DB writes and no alerts. LLM runs only when the runtime path needs analysis.",
      items: [item],
      diagnostics: null,
      error: item.ok === true ? null : stringValue(item.error) || "Accession analysis dry-run failed",
    };
  } catch (error) {
    liveRun = {
      mode: "accession_dry_run",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || null,
      rawItemId: rawItemId || null,
      summary: "Accession dry-run failed.",
      items: [],
      diagnostics: null,
      error: error instanceof Error ? error.message : "Accession dry-run failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

export async function runSecDevRouteOnly(
  roomKey: string,
  options: { accessionNumber?: string; rawItemId?: string; llmProvider?: string; llmModel?: string } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const accessionNumber = stringValue(options.accessionNumber);
  const rawItemId = stringValue(options.rawItemId);
  const started = Date.now();
  const ranAt = new Date().toISOString();
  let liveRun: SecDevLiveRunResult;
  let routeOnlyStep = "start";

  try {
    routeOnlyStep = "validate_room";
    if (room.key !== "s1-f1" && room.key !== "425" && room.key !== "8k-6k") {
      throw new Error("Route-only dry-run is currently available for the S-1 / F-1, 8-K / 6-K, and 425 rooms.");
    }
    if (!accessionNumber && !rawItemId) {
      throw new Error("Route-only dry-run requires accessionNumber or rawItemId.");
    }

    routeOnlyStep = "find_raw_item";
    const rawResult = await findSecRawItem({
      accessionNumber: accessionNumber || undefined,
      rawItemId: rawItemId || undefined,
    });
    if (!rawResult.ok || !rawResult.rawItem) {
      throw new Error(rawResult.error || "SEC raw item not found. Ingest raw first, then run route-only.");
    }

    routeOnlyStep = "run_route_only_prompt";
    const routeResult = room.key === "8k-6k"
      ? await runSec8k6kRouteOnlyPreviewForRawItem(rawResult.rawItem, {
          llmProvider: stringValue(options.llmProvider) || undefined,
          llmModel: stringValue(options.llmModel) || undefined,
        })
      : room.key === "425"
        ? await runSec425RouteOnlyPreviewForRawItem(rawResult.rawItem, {
          llmProvider: stringValue(options.llmProvider) || undefined,
          llmModel: stringValue(options.llmModel) || undefined,
        })
      : await runSecS1F1RouteOnlyPreviewForRawItem(rawResult.rawItem, {
          llmProvider: stringValue(options.llmProvider) || undefined,
          llmModel: stringValue(options.llmModel) || undefined,
        });
    routeOnlyStep = "build_route_only_item";
    const item = buildRouteOnlyItem(rawResult.rawItem, routeResult);

    liveRun = {
      mode: "route_only",
      status: item.ok === true ? "pass" : "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || stringValue(item.accession_number) || null,
      rawItemId: rawItemId || stringValue(rawResult.rawItem.id) || null,
      summary: room.key === "8k-6k"
        ? "Routed one existing 8-K / 6-K raw item to analysis families and source blocks; no full analysis, no DB writes, no alerts."
        : room.key === "425"
          ? "Routed one existing Form 425 raw item by communication purpose and transaction stage; no full analysis, no DB writes, no alerts."
          : "Routed one existing S-1/F-1 raw item to a display mode only; no full analysis, no DB writes, no alerts.",
      items: [item],
      diagnostics: {
        route_only: true,
        prompt: readRecord(routeResult.prompt) || null,
        source_block_count: readRouteOnlySourceBlockCount(routeResult),
        source_block_previews: buildRouteOnlySourceBlockPreviews(routeResult.input),
        sec_8k_6k_debug: readRecord(readRecord(routeResult)?.sec8k6kDebug) || null,
        related_transaction_context:
          room.key === "425"
            ? buildSec425RelatedTransactionContextPreview(readRecord(routeResult)?.relatedTransactionContext)
            : null,
      },
      error: item.ok === true ? null : stringValue(item.error) || "Route-only dry-run failed",
    };
  } catch (error) {
    liveRun = {
      mode: "route_only",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || null,
      rawItemId: rawItemId || null,
      summary: "Route-only dry-run failed.",
      items: [],
      diagnostics: {
        route_only_step: routeOnlyStep,
        error_name: error instanceof Error ? error.name : null,
      },
      error: error instanceof Error ? error.message || "Route-only dry-run failed with an empty error message" : "Route-only dry-run failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

function buildForm25RelatedContextDebug(context: Record<string, unknown> | null) {
  if (!context) return null;
  const selectedFilings = debugRecordArray(context.selected_filings).slice(0, 8).map((filing) => ({
    event_id: stringValue(filing.event_id) || null,
    raw_item_id: stringValue(filing.raw_item_id) || null,
    accession_number: stringValue(filing.accession_number) || null,
    form_type: stringValue(filing.form_type) || null,
    filed_at: stringValue(filing.filed_at) || null,
    event_type: stringValue(filing.event_type) || null,
    event_title: stringValue(filing.event_title) || stringValue(filing.title) || null,
    score: numberValue(filing.score),
    match_score: numberValue(filing.match_score),
    match_confidence: stringValue(filing.match_confidence) || null,
  }));

  return {
    subject_company_cik: stringValue(context.subject_company_cik) || null,
    candidate_count: numberValue(context.candidate_count),
    selected_count: selectedFilings.length,
    selected_filings: selectedFilings,
  };
}

function debugRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => readRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function readRouteOnlySourceBlockCount(routeResult: unknown) {
  const result = readRecord(routeResult) || {};
  const input = readRecord(result.input);
  if (Array.isArray(input?.cleaned_source_blocks)) return input.cleaned_source_blocks.length;

  const debug = readRecord(result.sec8k6kDebug);
  if (Array.isArray(debug?.selected_source_blocks)) return debug.selected_source_blocks.length;
  return null;
}

function buildSec425RelatedTransactionContextPreview(value: unknown) {
  const context = readRecord(value);
  if (!context) return null;

  const selected = Array.isArray(context.selected_filings) ? context.selected_filings : [];
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];
  return {
    status: stringValue(context.status) || "not_found",
    confidence: stringValue(context.confidence) || "low",
    selected_count: selected.length,
    selected_filings: selected.slice(0, 3).map((value) => {
      const filing = readRecord(value) || {};
      return {
        accession_number: stringValue(filing.accession_number) || null,
        form_type: stringValue(filing.form_type) || null,
        filed_at: stringValue(filing.filed_at) || null,
        company_name: stringValue(filing.company_name) || null,
        event_type: stringValue(filing.event_type) || null,
        event_title: stringValue(filing.event_title).slice(0, 180) || null,
        match_score: numberValue(filing.match_score),
        match_reasons: stringArray(filing.match_reasons).slice(0, 8),
      };
    }),
    candidate_count: candidates.length,
  };
}

function buildRouteOnlySourceBlockPreviews(input: unknown) {
  const blocks = readRecord(input)?.cleaned_source_blocks;
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 18).map((value) => {
    const block = readRecord(value) || {};
    return {
      block_id: stringValue(block.block_id) || null,
      block_type: stringValue(block.block_type) || null,
      document_role: stringValue(block.document_role) || null,
      content_role: stringValue(block.content_role) || null,
      heading: stringValue(block.heading) || null,
      preview: stringValue(block.text).slice(0, 360) || null,
    };
  });
}

export async function runSecDevRawIngestOnly(
  roomKey: string,
  options: {
    accessionNumber?: string;
    cik?: string;
    rawItemId?: string;
    attachmentLimit?: number;
  } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const accessionNumber = stringValue(options.accessionNumber);
  const cik = stringValue(options.cik);
  const rawItemId = stringValue(options.rawItemId);
  const started = Date.now();
  const ranAt = new Date().toISOString();
  let liveRun: SecDevLiveRunResult;

  try {
    if (!accessionNumber && !rawItemId) {
      throw new Error("Raw ingest requires accessionNumber or rawItemId.");
    }

    const rawResult = await ensureDevRawItemForPersist({
      room,
      accessionNumber,
      cik,
      rawItemId,
      attachmentLimit: clampNumber(options.attachmentLimit, 0, 12, 6),
    });
    liveRun = {
      mode: "raw_ingest_only",
      status: "pass",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || stringValue(rawResult.accessionNumber) || null,
      rawItemId: rawResult.rawItemId || rawItemId || null,
      summary: "Ingested one SEC raw item for development testing; no analysis, event, or alert was created.",
      items: [],
      diagnostics: {
        raw_source: rawResult.source,
        fetch: readRecord(rawResult.diagnostics) || null,
      },
      error: null,
    };
  } catch (error) {
    liveRun = {
      mode: "raw_ingest_only",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || null,
      rawItemId: rawItemId || null,
      summary: "Raw ingest failed.",
      items: [],
      diagnostics: null,
      error: error instanceof Error ? error.message : "Raw ingest failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

export async function runSecDevControlledPersist(
  roomKey: string,
  options: {
    accessionNumber?: string;
    cik?: string;
    rawItemId?: string;
    attachmentLimit?: number;
    resetExistingAnalysis?: boolean;
    allowRepeatLlm?: boolean;
    llmProvider?: string;
    llmModel?: string;
    secPromptVariant?: string;
  } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const accessionNumber = stringValue(options.accessionNumber);
  const cik = stringValue(options.cik);
  const rawItemId = stringValue(options.rawItemId);
  const started = Date.now();
  const ranAt = new Date().toISOString();
  let liveRun: SecDevLiveRunResult;

  try {
    if (!accessionNumber && !rawItemId) {
      throw new Error("Controlled persist requires accessionNumber or rawItemId.");
    }

    const rawResult = await ensureDevRawItemForPersist({
      room,
      accessionNumber,
      cik,
      rawItemId,
      attachmentLimit: clampNumber(options.attachmentLimit, 0, 12, 6),
    });
    const repeatGuard = options.allowRepeatLlm
      ? null
      : await findRecentControlledPersistLlmRun(room.key, {
          accessionNumber: accessionNumber || rawResult.accessionNumber,
          rawItemId: rawResult.rawItemId || rawItemId,
        });
    if (repeatGuard) {
      liveRun = {
        mode: "controlled_persist",
        status: "fail",
        ranAt,
        durationMs: Date.now() - started,
        room: room.key,
        formTypes: room.forms,
        accessionNumber: accessionNumber || stringValue(rawResult.accessionNumber) || null,
        rawItemId: rawResult.rawItemId || rawItemId || null,
        summary: "Controlled persist blocked before LLM call by repeat-run guard.",
        items: [],
        diagnostics: {
          raw_source: rawResult.source,
          repeat_run_guard: repeatGuard,
        },
        error: repeatGuard.reason,
      };
      await appendLiveRun(room.key, liveRun);
      return getSecDevRoomDetail(room.key);
    }
    const resetResult = options.resetExistingAnalysis
      ? await resetSecDerivedAnalysisForAccession({
          accessionNumber: accessionNumber || rawResult.accessionNumber,
          rawItemId: rawResult.rawItemId || rawItemId,
        })
      : null;

    const analysis = await runSecFilingAnalysisIngest({
      accessionNumber: accessionNumber || undefined,
      rawItemId: rawResult.rawItemId || rawItemId || undefined,
      dryRun: false,
      force: true,
      suppressAlerts: true,
      llmProvider: stringValue(options.llmProvider) || undefined,
      llmModel: stringValue(options.llmModel) || undefined,
      secPromptVariant: stringValue(options.secPromptVariant) || undefined,
    });
    if (!analysis.ok) {
      const failureRawResult = await findSecRawItem({
        rawItemId: rawResult.rawItemId || rawItemId || undefined,
        accessionNumber: accessionNumber || rawResult.accessionNumber || undefined,
      });
      const failureItem = failureRawResult.rawItem ? buildRuntimeAnalysisItem(failureRawResult.rawItem, analysis) : null;
      const analysisFailure = readRecord(analysis) || {};
      const runtime = readRecord(analysisFailure.runtime);
      liveRun = {
        mode: "controlled_persist",
        status: "fail",
        ranAt,
        durationMs: Date.now() - started,
        room: room.key,
        formTypes: room.forms,
        accessionNumber: accessionNumber || stringValue(rawResult.accessionNumber) || null,
        rawItemId: rawResult.rawItemId || rawItemId || null,
        summary: "Controlled persist failed before event save; analysis did not produce a persisted event.",
        items: failureItem ? [failureItem] : [],
        diagnostics: {
          raw_source: rawResult.source,
          reset_existing_analysis: resetResult,
          failure_raw_lookup: failureRawResult.ok
            ? { ok: true, rawItemId: stringValue(failureRawResult.rawItem?.id) || null }
            : { ok: false, error: failureRawResult.error || "raw item lookup failed" },
          prompt: readRecord(runtime?.prompt) || null,
          llm_failure: failureItem ? readRecord(failureItem.llm_failure_debug) || null : buildLlmFailureDebug(analysisFailure),
        },
        error: stringValue(analysis.error) || "Controlled SEC analysis persist failed",
      };
      await appendLiveRun(room.key, liveRun);
      return getSecDevRoomDetail(room.key);
    }

    const event = readRecord(analysis.event);
    const analysisRecord = readRecord(analysis.analysis);
    const displayPayload = readRecord(analysisRecord?.display_payload);
    const displayData = readRecord(displayPayload?.data);
    const primaryTicker = readRecord(analysisRecord?.primary_ticker);
    const score = numberValue(event?.score ?? analysisRecord?.score);
    const deliveryLevel = stringValue(event?.delivery_level) || deriveDeliveryLabel(score);
    const model = stringValue(analysis.model);
    liveRun = {
      mode: "controlled_persist",
      status: "pass",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || stringValue(rawResult.accessionNumber) || null,
      rawItemId: stringValue(event?.raw_item_id) || rawResult.rawItemId || null,
      summary: "Persisted one controlled SEC filing event; alert delivery suppressed.",
      items: [
        {
          event_id: stringValue(event?.id) || null,
          raw_item_id: stringValue(event?.raw_item_id) || rawResult.rawItemId || null,
          accession_number: accessionNumber || rawResult.accessionNumber || null,
          title: stringValue(event?.title) || stringValue(analysisRecord?.event_title) || null,
          ticker: stringValue(event?.ticker) || null,
          event_type: stringValue(event?.event_type) || stringValue(analysisRecord?.event_type) || null,
          score,
          delivery_level: deliveryLevel,
          model: model || null,
          detail_url: buildLocalFilingUrl(stringValue(event?.id), deliveryLevel),
          runtime_output: analysisRecord
            ? {
                model: model || null,
                event_title: stringValue(analysisRecord.event_title) || stringValue(event?.title),
                event_type: stringValue(analysisRecord.event_type) || stringValue(event?.event_type),
                display_type: stringValue(displayPayload?.display_type) || null,
                parser_route: "controlled persist / analysis path",
                is_parser_completed_archive: false,
                is_excluded: false,
                score,
                delivery_level: deliveryLevel,
                signal: stringValue(analysisRecord.signal),
                ticker: stringValue(primaryTicker?.ticker) || stringValue(event?.ticker) || null,
                filing_summary: stringValue(displayData?.filing_summary) || stringValue(analysisRecord.filing_summary),
                quick_take: stringValue(analysisRecord.quick_take),
                summary: stringValue(analysisRecord.summary),
                archive_summary: stringValue(analysisRecord.archive_summary),
                score_reason: stringValue(analysisRecord.score_reason),
                score_explanation: readRecord(analysisRecord.score_explanation) || null,
                why_it_matters: stringValue(analysisRecord.why_it_matters),
                key_evidence: stringArray(analysisRecord.key_evidence).slice(0, 8),
                what_to_watch_next: stringArray(analysisRecord.what_to_watch_next).slice(0, 8),
                parser_signals: [],
                transaction_fingerprint: readRecord(analysisRecord.transaction_fingerprint) || null,
                display_data: previewDisplayData(displayData),
                display_payload_debug: buildDisplayPayloadDebug(displayPayload, displayData, analysisRecord),
                usage: readRecord(analysis.usage) || null,
                cost_estimate: readRecord(analysis.costEstimate) || null,
              }
            : null,
          alert_delivery: analysis.alertDelivery || null,
        },
      ],
      diagnostics: {
        raw_source: rawResult.source,
        raw_fetch_diagnostics: rawResult.diagnostics || null,
        reset_existing_analysis: resetResult,
        prompt: analysis.runtime ? readRecord(analysis.runtime)?.prompt || null : null,
      },
      error: null,
    };
  } catch (error) {
    liveRun = {
      mode: "controlled_persist",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || null,
      rawItemId: rawItemId || null,
      summary: "Controlled persist failed.",
      items: [],
      diagnostics: null,
      error: error instanceof Error ? error.message : "Controlled persist failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

export async function runSecDevResetAnalysis(
  roomKey: string,
  options: {
    accessionNumber?: string;
    rawItemId?: string;
  } = {},
): Promise<SecDevRoomDetail | null> {
  const room = SEC_DEV_ROOMS.find((item) => item.key === roomKey);
  if (!room) return null;

  const accessionNumber = stringValue(options.accessionNumber);
  const rawItemId = stringValue(options.rawItemId);
  const started = Date.now();
  const ranAt = new Date().toISOString();
  let liveRun: SecDevLiveRunResult;

  try {
    if (!accessionNumber && !rawItemId) {
      throw new Error("Delete existing SEC analysis requires accessionNumber or rawItemId.");
    }

    const resetResult = await resetSecDerivedAnalysisForAccession({
      accessionNumber,
      rawItemId,
    });
    const cachePruneResult = await removeResetTargetFromLiveCache(room.key, resetResult);
    const deletedCount = resetResult.deleted.reduce((total, row) => total + row.count, 0);
    const remainingCount = resetResult.remainingEventIds.length;
    liveRun = {
      mode: "reset_analysis",
      status: remainingCount ? "fail" : "pass",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: resetResult.accessionNumber,
      rawItemId: resetResult.rawItemId,
      summary: resetResult.matchedEventIds.length
        ? `Deleted existing SEC analysis rows for ${resetResult.matchedEventIds.length} event(s); raw item preserved.`
        : cachePruneResult.removedRuns || cachePruneResult.removedItems
          ? "Deleted cached SEC console output; raw item preserved."
          : "No existing SEC analysis event matched; raw item preserved.",
      items: [
        {
          accession_number: resetResult.accessionNumber,
          raw_item_id: resetResult.rawItemId,
          title: resetResult.matchedEventIds.length
            ? `Deleted existing SEC analysis for ${resetResult.accessionNumber || resetResult.rawItemId}`
            : `No existing SEC analysis found for ${resetResult.accessionNumber || resetResult.rawItemId}`,
          deleted_event_ids: resetResult.matchedEventIds,
          remaining_event_ids: resetResult.remainingEventIds,
          deleted_row_count: deletedCount,
          deleted_cached_run_count: cachePruneResult.removedRuns,
          deleted_cached_item_count: cachePruneResult.removedItems,
          raw_item_preserved: resetResult.rawItemPreserved,
          reset_result: resetResult,
        },
      ],
      diagnostics: { reset_existing_analysis: resetResult, cache_prune: cachePruneResult },
      error: remainingCount ? "Some existing SEC analysis events remained after delete." : null,
    };
  } catch (error) {
    liveRun = {
      mode: "reset_analysis",
      status: "fail",
      ranAt,
      durationMs: Date.now() - started,
      room: room.key,
      formTypes: room.forms,
      accessionNumber: accessionNumber || null,
      rawItemId: rawItemId || null,
      summary: "Delete existing SEC analysis failed.",
      items: [],
      diagnostics: null,
      error: error instanceof Error ? error.message : "Delete existing SEC analysis failed",
    };
  }

  await appendLiveRun(room.key, liveRun);
  return getSecDevRoomDetail(room.key);
}

async function removeResetTargetFromLiveCache(roomKey: string, resetResult: SecDevDerivedResetResult) {
  const cache = await readLiveCache();
  const existing = cache[roomKey] || [];
  if (!existing.length) return { removedRuns: 0, removedItems: 0 };

  const targetAccessions = new Set([resetResult.accessionNumber].map(normalizeResetMatchValue).filter(Boolean));
  const targetRawItemIds = new Set([resetResult.rawItemId].map(normalizeResetMatchValue).filter(Boolean));
  const targetEventIds = new Set(resetResult.matchedEventIds.map(normalizeResetMatchValue).filter(Boolean));
  let removedRuns = 0;
  let removedItems = 0;
  const keptRuns: SecDevLiveRunResult[] = [];

  for (const run of existing) {
    if (run.mode === "reset_analysis") {
      keptRuns.push(run);
      continue;
    }

    const runMatches =
      targetAccessions.has(normalizeResetMatchValue(run.accessionNumber)) ||
      targetRawItemIds.has(normalizeResetMatchValue(run.rawItemId));
    const keptItems = run.items.filter((item) => !resetTargetMatchesItem(item, targetAccessions, targetRawItemIds, targetEventIds));
    const removedFromRun = run.items.length - keptItems.length;

    if (runMatches || (run.items.length > 0 && keptItems.length === 0 && removedFromRun > 0)) {
      removedRuns += 1;
      removedItems += run.items.length;
      continue;
    }

    if (removedFromRun > 0) {
      removedItems += removedFromRun;
      keptRuns.push({ ...run, items: keptItems });
      continue;
    }

    keptRuns.push(run);
  }

  if (removedRuns || removedItems) {
    cache[roomKey] = keptRuns;
    await writeLiveCache(cache);
  }

  return { removedRuns, removedItems };
}

async function findRecentControlledPersistLlmRun(
  roomKey: string,
  {
    accessionNumber,
    rawItemId,
  }: {
    accessionNumber: string;
    rawItemId: string;
  },
) {
  const cache = await readLiveCache();
  const runs = cache[roomKey] || [];
  const targetAccession = normalizeResetMatchValue(accessionNumber);
  const targetRawItemId = normalizeResetMatchValue(rawItemId);
  const now = Date.now();
  const match = runs.find((run) => {
    if (run.mode !== "controlled_persist") return false;
    const ranAtMs = Date.parse(run.ranAt);
    if (!Number.isFinite(ranAtMs) || now - ranAtMs > SEC_DEV_REPEAT_LLM_BLOCK_MS) return false;
    return (
      (targetAccession && normalizeResetMatchValue(run.accessionNumber) === targetAccession) ||
      (targetRawItemId && normalizeResetMatchValue(run.rawItemId) === targetRawItemId) ||
      run.items.some((item) => resetTargetMatchesItem(item, new Set([targetAccession].filter(Boolean)), new Set([targetRawItemId].filter(Boolean)), new Set()))
    );
  });
  if (!match) return null;

  return {
    blocked: true,
    reason: `SEC dev LLM repeat blocked for this accession/raw item. Last controlled persist ran at ${match.ranAt}. Pass allowRepeatLlm=true to override.`,
    previousRun: {
      ranAt: match.ranAt,
      status: match.status,
      accessionNumber: match.accessionNumber,
      rawItemId: match.rawItemId,
      eventId: stringValue(match.items[0]?.event_id) || null,
      error: match.error,
    },
    blockWindowMs: SEC_DEV_REPEAT_LLM_BLOCK_MS,
  };
}

function resetTargetMatchesItem(
  item: Record<string, unknown>,
  targetAccessions: Set<string>,
  targetRawItemIds: Set<string>,
  targetEventIds: Set<string>,
) {
  const accession = normalizeResetMatchValue(item.accession_number) || normalizeResetMatchValue(item.accessionNumber);
  const rawItemId = normalizeResetMatchValue(item.raw_item_id) || normalizeResetMatchValue(item.rawItemId);
  const eventId = normalizeResetMatchValue(item.event_id) || normalizeResetMatchValue(item.eventId);
  return (
    (accession && targetAccessions.has(accession)) ||
    (rawItemId && targetRawItemIds.has(rawItemId)) ||
    (eventId && targetEventIds.has(eventId))
  );
}

function normalizeResetMatchValue(value: unknown) {
  return stringValue(value).toLowerCase();
}

async function resetSecDerivedAnalysisForAccession({
  accessionNumber,
  rawItemId,
}: {
  accessionNumber: string;
  rawItemId: string;
}): Promise<SecDevDerivedResetResult> {
  const normalizedAccession = stringValue(accessionNumber);
  const normalizedRawItemId = stringValue(rawItemId);
  if (!normalizedAccession && !normalizedRawItemId) {
    throw new Error("Reset existing SEC analysis requires accessionNumber or rawItemId.");
  }

  const matchedEvents = await findSecDerivedEventsForReset({
    accessionNumber: normalizedAccession,
    rawItemId: normalizedRawItemId,
  });
  const matchedEventIds = matchedEvents.map((event) => stringValue(event.id)).filter(Boolean);
  const deleted: SecDevDerivedResetResult["deleted"] = [];

  if (matchedEventIds.length) {
    await deleteSecDerivedRows(deleted, "user_alert_deliveries", { alert_event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "alert_delivery_event_runs", { event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "deliveries", { event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "event_links.left_event_id", "event_links", {
      left_event_id: `in.(${matchedEventIds.join(",")})`,
    });
    await deleteSecDerivedRows(deleted, "event_links.right_event_id", "event_links", {
      right_event_id: `in.(${matchedEventIds.join(",")})`,
    });
    await deleteSecDerivedRows(deleted, "event_calendar_items", { source_event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "event_tickers", { event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "event_offering_terms", { event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "event_analysis", { event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "ai_outputs", { event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "ai_runs", { event_id: `in.(${matchedEventIds.join(",")})` });
    await deleteSecDerivedRows(deleted, "events", { id: `in.(${matchedEventIds.join(",")})` });
  }

  const remainingEvents = await findSecDerivedEventsForReset({
    accessionNumber: normalizedAccession,
    rawItemId: normalizedRawItemId,
  });

  return {
    requested: true,
    accessionNumber: normalizedAccession || null,
    rawItemId: normalizedRawItemId || null,
    matchedEventIds,
    remainingEventIds: remainingEvents.map((event) => stringValue(event.id)).filter(Boolean),
    deleted,
    rawItemPreserved: true,
  };
}

async function findSecDerivedEventsForReset({
  accessionNumber,
  rawItemId,
}: {
  accessionNumber: string;
  rawItemId: string;
}) {
  const byId = new Map<string, Record<string, unknown>>();
  const searches: Array<Record<string, string>> = [];

  if (rawItemId) {
    searches.push({
      select: "id,raw_item_id,title,metadata,group_dedupe_key",
      source_group: "eq.filings",
      raw_item_id: `eq.${rawItemId}`,
      limit: "50",
    });
  }

  if (accessionNumber) {
    searches.push(
      {
        select: "id,raw_item_id,title,metadata,group_dedupe_key",
        source_group: "eq.filings",
        "metadata->>accession_number": `eq.${accessionNumber}`,
        limit: "50",
      },
      {
        select: "id,raw_item_id,title,metadata,group_dedupe_key",
        source_group: "eq.filings",
        group_dedupe_key: `eq.sec_edgar:${accessionNumber}`,
        limit: "50",
      },
      {
        select: "id,raw_item_id,title,metadata,group_dedupe_key",
        source_group: "eq.filings",
        group_dedupe_key: `eq.sec_edgar:ownership:accession:${accessionNumber}`,
        limit: "50",
      },
    );
  }

  for (const search of searches) {
    const result = await supabaseSelect("events", search);
    if (!result.ok) throw new Error(result.error || "Failed to find existing SEC filing events for reset.");
    for (const row of Array.isArray(result.data) ? result.data : []) {
      const record = readRecord(row);
      const id = stringValue(record?.id);
      if (record && id) byId.set(id, record);
    }
  }

  return Array.from(byId.values());
}

async function deleteSecDerivedRows(
  deleted: SecDevDerivedResetResult["deleted"],
  target: string,
  tableOrSearch: string | Record<string, string>,
  maybeSearch?: Record<string, string>,
) {
  const table = typeof tableOrSearch === "string" ? tableOrSearch : target;
  const search = typeof tableOrSearch === "string" ? maybeSearch : tableOrSearch;
  if (!search) throw new Error(`Missing reset delete filter for ${target}.`);

  const result = await supabaseDelete(table, search);
  if (!result.ok) {
    throw new Error(result.error || `Failed to reset SEC derived rows in ${target}.`);
  }

  deleted.push({
    target,
    count: Array.isArray(result.data) ? result.data.length : 0,
  });
}

async function readRoomFiles(room: SecDevRoom, testFiles: string[], fixtures: string[], expected: string[]) {
  const base = path.join(FORMS_ROOT, room.folder);
  const analysisOnlyRoom = room.key === "proxy" || room.key === "periodic-reports" || room.key === "nt";
  const primaryFiles = [
    ["parser", "parser.ts"],
    ["adapter", "adapter.ts"],
    ["adapter", "index.ts"],
    ...(analysisOnlyRoom ? [] : ([["prompt", "routerPrompt.ts"], ["prompt", "router.ts"]] as const)),
    ["prompt", "analysisPrompt.ts"],
    ...(analysisOnlyRoom ? [] : ([["prompt", "analysis.ts"]] as const)),
    ["display", "displayPayload.ts"],
  ] as const;

  const selectedFixtures = fixtures.slice(0, 5).map((file) => ["fixture", path.join("fixtures", file)] as const);
  const selectedExpected = expected.slice(0, 5).map((file) => ["expected", path.join("expected", file)] as const);
  const selectedTests = testFiles.map((file) => ["test", path.basename(file)] as const);

  return Promise.all(
    [...primaryFiles, ...selectedTests, ...selectedFixtures, ...selectedExpected].map(async ([kind, relative]) => {
      const absolute = path.join(base, relative);
      return readDevFile(kind, absolute);
    }),
  );
}

async function readOutputPreviews(room: SecDevRoom, expected: string[]): Promise<SecDevOutputPreview[]> {
  const directory = path.join(FORMS_ROOT, room.folder, "expected");
  const previews: SecDevOutputPreview[] = [];

  for (const file of expected.slice(0, 40)) {
    try {
      const raw = await fs.readFile(path.join(directory, file), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const record = readRecord(parsed);
      const analysis = readRecord(record?.analysis_output);
      const display = readRecord(record?.display_payload);
      const parserOutput = readRecord(record?.parser_output);
      if (!analysis && !display) continue;

      const primaryTicker = readRecord(analysis?.primary_ticker);
      const score = numberValue(analysis?.score);
      const parserSignals = stringArray(parserOutput?.signals);
      const formType = resolveOutputPreviewFormType(room, parserOutput, file);
      const displayData = readRecord(display?.data);
      const deliveryLevel = deriveDeliveryLabel(score);
      const isParserCompletedArchive = parserSignals.includes("deterministic_archive") && deliveryLevel === "archive";
      previews.push({
        file,
        formType,
        eventTitle: stringValue(analysis?.event_title) || file,
        eventType: stringValue(analysis?.event_type) || "-",
        displayType: stringValue(display?.display_type) || "-",
        parserRoute: isParserCompletedArchive ? "parser deterministic archive" : "analysis / LLM path",
        isParserCompletedArchive,
        score,
        deliveryLevel,
        signal: stringValue(analysis?.signal) || "-",
        ticker: stringValue(primaryTicker?.ticker) || firstString(analysis?.tickers) || "-",
        filingSummary: stringValue(displayData?.filing_summary) || stringValue(analysis?.filing_summary),
        quickTake: stringValue(analysis?.quick_take),
        summary: stringValue(analysis?.summary),
        scoreReason: stringValue(analysis?.score_reason),
        keyEvidence: stringArray(analysis?.key_evidence).slice(0, 6),
        whatToWatchNext: stringArray(analysis?.what_to_watch_next).slice(0, 6),
        parserSignals,
        integrationNotes: [],
        displayData: previewDisplayData(displayData),
      });
    } catch {
      previews.push({
        file,
        formType: resolveOutputPreviewFormType(room, null, file),
        eventTitle: file,
        eventType: "parse_error",
        displayType: "-",
        parserRoute: "-",
        isParserCompletedArchive: false,
        score: null,
        deliveryLevel: "-",
        signal: "-",
        ticker: "-",
        filingSummary: "",
        quickTake: "",
        summary: "Could not parse expected JSON for site output preview.",
        scoreReason: "",
        keyEvidence: [],
        whatToWatchNext: [],
        parserSignals: [],
        integrationNotes: [],
        displayData: [],
      });
    }
  }

  return previews;
}

function resolveOutputPreviewFormType(
  room: SecDevRoom,
  parserOutput: Record<string, unknown> | null,
  file: string,
) {
  const forms = room.forms;
  const normalizedForms = new Map(forms.map((form) => [normalizeFormForPreviewFilter(form), form]));
  const sourceCandidates = [
    parserOutput?.form_type,
    parserOutput?.formType,
    parserOutput?.form,
    parserOutput?.source_form_scope,
  ].map(stringValue);

  for (const candidate of sourceCandidates) {
    const exact = normalizedForms.get(normalizeFormForPreviewFilter(candidate));
    if (exact) return exact;
  }

  const fileToken = normalizeFormFilenameToken(file);
  const sortedForms = [...forms].sort((left, right) => normalizeFormFilenameToken(right).length - normalizeFormFilenameToken(left).length);
  for (const form of sortedForms) {
    const token = normalizeFormFilenameToken(form);
    if (token && fileToken.includes(token)) return form;
  }

  return "";
}

async function readPromptPreviews(room: SecDevRoom): Promise<SecDevPromptPreview[]> {
  const base = path.join(FORMS_ROOT, room.folder);
  const analysisOnlyRoom = room.key === "proxy" || room.key === "periodic-reports" || room.key === "nt";
  const promptFiles = analysisOnlyRoom
    ? ["analysisPrompt.ts"]
    : ["routerPrompt.ts", "router.ts", "analysisPrompt.ts", "analysis.ts"];
  const previews: SecDevPromptPreview[] = [];

  for (const file of promptFiles) {
    const absolute = path.join(base, file);
    try {
      const raw = await fs.readFile(absolute, "utf8");
      const prompts =
        room.key === "424b" && file === "analysisPrompt.ts"
          ? build424bPromptVariantPreviews()
          : room.key === "s1-f1" && file === "analysisPrompt.ts"
            ? buildS1F1PromptVariantPreviews()
            : room.key === "proxy" && file === "analysisPrompt.ts"
              ? buildProxyPromptVariantPreviews()
              : room.key === "periodic-reports" && file === "analysisPrompt.ts"
                ? await buildPeriodicReportsPromptVariantPreviews(base)
            : extractPromptTemplateLiterals(raw);
      if (prompts.length) {
        previews.push({ file, prompts: applyPromptPreviewDisplayLabels(room, prompts) });
      }
    } catch {
      // Prompt files are optional per form room.
    }
  }

  return previews;
}

function buildS1F1PromptVariantPreviews() {
  const previewParserOutput = parseS1F1Filing({
    formType: "S-1",
    accessionNumber: "0000000000-00-000000",
    metadata: {
      companyName: "Prompt Preview Issuer Inc.",
    },
    filingText:
      "We are offering up to [●] shares of common stock and up to [●] pre-funded warrants. The assumed public offering price is $[●] per share. The actual number of securities and offering price will be determined at pricing.",
  });

  return [
    {
      name: "Default active (pending terms)",
      text: normalizePromptPreviewText(buildS1F1AnalysisPrompt(previewParserOutput)),
    },
    {
      // Legacy backup: pre-pending-terms S-1/F-1 default prompt kept for debug-console comparisons.
      name: "Legacy backup (pre-pending terms)",
      text: normalizePromptPreviewText(
        buildS1F1AnalysisPrompt(previewParserOutput, undefined, undefined, { variant: "legacy_default_backup" }),
      ),
    },
  ];
}

function build424bPromptVariantPreviews() {
  const previewParserOutput: Sec424bParserOutput = {
    parserVersion: PARSER_VERSION_424B,
    parserGroup: PARSER_GROUP_424B,
    formType: "424B3",
    accessionNumber: "0000000000-00-000000",
    isSupported: true,
    summary: null,
    facts: {},
    signals: [],
    calendarItems: [],
    warnings: [],
    raw: {
      cleanedSourceBlocks: [
        {
          block_type: "source_block",
          label: "Prompt preview placeholder",
          source: "debug_console",
          text: "Live runs replace this placeholder with the selected filing source blocks.",
        },
      ],
    },
  };

  return [
    {
      name: "Default sectioned (active)",
      text: normalizePromptPreviewText(build424bAnalysisPrompt(previewParserOutput, { variant: "sectioned" })),
    },
    {
      name: "Backup legacy (pre-sectioned)",
      text: normalizePromptPreviewText(build424bAnalysisPrompt(previewParserOutput, { variant: "legacy" })),
    },
  ];
}

function buildProxyPromptVariantPreviews() {
  const previewParserOutput = parseProxyFiling({
    formType: "DEF 14A",
    accessionNumber: "0000000000-00-000000",
    companyName: "Prompt Preview Proxy Corp.",
    primaryTicker: {
      ticker: "PRXY",
      exchange: "NASDAQ",
    },
    filingText: [
      "Prompt Preview Proxy Corp. will hold its annual meeting on June 9, 2026.",
      "Stockholders will vote on the election of directors, an advisory vote to approve named executive officer compensation, and ratification of the independent registered public accounting firm.",
      "The board recommends a vote FOR each proposal.",
      "The record date is April 16, 2026.",
    ].join("\n"),
  });
  return [
    {
      name: "Default proxy",
      text: normalizePromptPreviewText(
        buildProxyAnalysisPrompt({
          parserOutput: previewParserOutput,
        }),
      ),
    },
  ];
}

function applyPromptPreviewDisplayLabels(
  room: SecDevRoom,
  prompts: SecDevPromptPreview["prompts"],
): SecDevPromptPreview["prompts"] {
  if (room.key !== "8k-6k") return prompts;

  return prompts.map((prompt) => {
    const label = SEC_8K_6K_PROMPT_DISPLAY_LABELS[prompt.name];
    return label ? { ...prompt, ...label } : prompt;
  });
}

const SEC_8K_6K_PROMPT_DISPLAY_LABELS: Record<string, { displayName: string; description: string }> = {
  sec8k6kRouterSystemPrompt: {
    displayName: "Router prompt - route planner",
    description: "Chooses analysis families and source block IDs. It does not write the final analysis.",
  },
  sec8k6kAnalysisSystemPrompt: {
    displayName: "Common analysis rules - base prompt",
    description: "Shared writing, evidence, scoring, and output rules for every 8-K / 6-K analysis family.",
  },
  sec8k6kListingFinancialRiskPrompt: {
    displayName: "Analysis family - Listing / Financial Risk",
    description: "Delisting, suspension, bankruptcy, default, liquidity, restatement, and financial distress.",
  },
  sec8k6kFinancingDilutionCapitalStructurePrompt: {
    displayName: "Analysis family - Financing / Dilution / Capital Structure",
    description: "Offerings, warrants, convertibles, reverse splits, dividends, buybacks, debt, and capital changes.",
  },
  sec8k6kStrategicTransactionPrompt: {
    displayName: "Analysis family - Strategic Transaction",
    description: "Mergers, acquisitions, de-SPAC status, closings, terminations, amendments, and asset transactions.",
  },
  sec8k6kGovernanceVoteLeadershipPrompt: {
    displayName: "Analysis family - Governance / Vote / Leadership",
    description: "Shareholder votes, executive and board changes, auditors, governance contests, and control updates.",
  },
  sec8k6kOperatingLegalRoutinePrompt: {
    displayName: "Analysis family - Operating / Legal / Routine",
    description: "Earnings, operating updates, legal and regulatory matters, FDA and clinical events, and routine filings.",
  },
};

async function buildPeriodicReportsPromptVariantPreviews(base: string) {
  const cases = [
    {
      file: "routine-10q-earnings.json",
      name: "Periodic report analysis (10-K / 10-Q / 20-F)",
      amendment: false,
    },
    {
      file: "routine-amendment-10qa.json",
      name: "Periodic amendment analysis (10-K/A / 10-Q/A / 20-F/A)",
      amendment: true,
    },
  ] as const;
  const previews: Array<{ name: string; text: string }> = [];

  for (const previewCase of cases) {
    const raw = await fs.readFile(path.join(base, "fixtures", previewCase.file), "utf8");
    const fixture = readRecord(JSON.parse(raw));
    const filing = readRecord(fixture?.filing);
    if (!filing) continue;

    const parserOutput = parseSecPeriodicReport(filing as SecPeriodicReportParseInput);
    const promptInput = {
      parser_output: parserOutput,
      filing_excerpt: stringValue(filing.bodyText),
      market_context: readRecord(fixture?.market_context),
      parent_filing_context: readRecord(filing.parentFilingContext),
    };
    const prompt = previewCase.amendment
      ? buildSecPeriodicReportsAmendmentAnalysisPromptDraft(promptInput)
      : buildSecPeriodicReportsAnalysisPromptDraft(promptInput);

    previews.push({
      name: previewCase.name,
      text: normalizePromptPreviewText([
        `Prompt key: ${prompt.key}`,
        `Prompt version: ${prompt.version}`,
        "",
        "SYSTEM",
        prompt.system,
        "",
        "EXAMPLE DYNAMIC USER PAYLOAD",
        prompt.user,
      ].join("\n")),
    });
  }

  return previews;
}

function extractPromptTemplateLiterals(source: string) {
  const prompts: Array<{ name: string; text: string }> = [];
  const seen = new Set<string>();
  const namedStringArrays = extractNamedStringArrays(source);
  const exportConstPrompt = /export\s+const\s+([A-Z0-9_]*PROMPT[A-Z0-9_]*)[\s\S]*?=\s*`([\s\S]*?)`\s*(?:\.trim\(\))?\s*;/g;
  let match: RegExpExecArray | null;

  while ((match = exportConstPrompt.exec(source))) {
    const name = match[1] || "prompt";
    if (seen.has(name)) continue;
    seen.add(name);
    prompts.push({
      name,
      text: normalizePromptPreviewText(match[2] || ""),
    });
  }

  const exportArrayPrompt =
    /export\s+const\s+([A-Za-z0-9_$]*Prompt[A-Za-z0-9_$]*)\s*=\s*\[([\s\S]*?)\]\.join\(\s*(["'`])\\n\3\s*\)\s*;/g;
  while ((match = exportArrayPrompt.exec(source))) {
    const name = match[1] || "prompt";
    if (seen.has(name)) continue;
    const text = normalizePromptPreviewText(extractPromptArrayLines(match[2] || "", namedStringArrays).join("\n"));
    if (!text) continue;
    seen.add(name);
    prompts.push({ name, text });
  }

  const ruleArrayPrompt =
    /(?:export\s+)?const\s+([A-Za-z0-9_$]*(?:Prompt|Rules)[A-Za-z0-9_$]*)\s*=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/g;
  while ((match = ruleArrayPrompt.exec(source))) {
    const name = match[1] || "prompt";
    if (seen.has(name)) continue;
    const text = normalizePromptPreviewText((namedStringArrays.get(name) || extractStringLiteralLines(match[2] || "")).join("\n"));
    if (!text || !looksLikePromptPreview(text)) continue;
    seen.add(name);
    prompts.push({ name, text });
  }

  if (!prompts.length) {
    const returnedTemplates = /return\s+`([\s\S]*?)`\s*;/g;
    let index = 1;
    while ((match = returnedTemplates.exec(source))) {
      const text = normalizePromptPreviewText(match[1] || "");
      if (!text) continue;
      prompts.push({ name: `RETURNED_PROMPT_${index}`, text });
      index += 1;
    }
  }

  if (!prompts.length) {
    const returnedArrayPrompt = /return\s+\[([\s\S]*?)\]\.join\(\s*(["'`])\\n\2\s*\)\s*;/g;
    let index = 1;
    while ((match = returnedArrayPrompt.exec(source))) {
      const text = normalizePromptPreviewText(extractPromptArrayLines(match[1] || "", namedStringArrays).join("\n"));
      if (!text) continue;
      prompts.push({ name: `RETURNED_ARRAY_PROMPT_${index}`, text });
      index += 1;
    }
  }

  for (const prompt of extractReturnedStringArrayPromptFunctions(source, namedStringArrays)) {
    if (seen.has(prompt.name)) continue;
    seen.add(prompt.name);
    prompts.push(prompt);
  }

  return prompts.slice(0, 6);
}

function extractNamedStringArrays(source: string) {
  const arrays = new Map<string, string[]>();
  const pattern =
    /(?:export\s+)?const\s+([A-Za-z0-9_$]*(?:Prompt|Rules|Guide|GUIDE)[A-Za-z0-9_$]*)\s*=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const name = match[1] || "";
    const lines = extractStringLiteralLines(match[2] || "");
    if (name && lines.length) arrays.set(name, lines);
  }
  return arrays;
}

function extractReturnedStringArrayPromptFunctions(source: string, namedStringArrays: Map<string, string[]>) {
  const prompts: Array<{ name: string; text: string }> = [];
  const functionPattern =
    /function\s+([A-Za-z0-9_$]*PromptLines[A-Za-z0-9_$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{/g;
  let match: RegExpExecArray | null;

  while ((match = functionPattern.exec(source))) {
    const name = match[1] || "RETURNED_ARRAY_PROMPT";
    const openBrace = source.indexOf("{", match.index);
    if (openBrace < 0) continue;

    const closeBrace = findMatchingSourceBracket(source, openBrace, "{", "}");
    if (closeBrace < 0) continue;

    const body = source.slice(openBrace + 1, closeBrace);
    const returnMatch = /return\s+\[/.exec(body);
    if (!returnMatch) {
      functionPattern.lastIndex = closeBrace + 1;
      continue;
    }

    const arrayStart = openBrace + 1 + returnMatch.index + returnMatch[0].lastIndexOf("[");
    const arrayEnd = findMatchingSourceBracket(source, arrayStart, "[", "]");
    if (arrayEnd < 0 || arrayEnd > closeBrace) {
      functionPattern.lastIndex = closeBrace + 1;
      continue;
    }

    if (!/^\s*;/.test(source.slice(arrayEnd + 1, closeBrace))) {
      functionPattern.lastIndex = closeBrace + 1;
      continue;
    }

    const text = normalizePromptPreviewText(extractPromptArrayLines(source.slice(arrayStart + 1, arrayEnd), namedStringArrays).join("\n"));
    if (text && looksLikePromptPreview(text)) prompts.push({ name, text });
    functionPattern.lastIndex = closeBrace + 1;
  }

  return prompts;
}

function findMatchingSourceBracket(source: string, start: number, open: string, close: string) {
  if (source[start] !== open) return -1;

  let depth = 0;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = start; index < source.length; index += 1) {
    const current = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      if (current === "\n" || current === "\r") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (current === "\\") {
        escaped = true;
        continue;
      }
      if (current === quote) quote = "";
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      continue;
    }

    if (current === open) {
      depth += 1;
      continue;
    }

    if (current === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function extractPromptArrayLines(source: string, namedStringArrays: Map<string, string[]>) {
  const lines: string[] = [];
  const tokenPattern = /\.\.\.([A-Za-z0-9_$]+)|(["'`])((?:\\.|(?!\2)[\s\S])*?)\2/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(source))) {
    const spreadName = match[1] || "";
    if (spreadName) {
      lines.push(...(namedStringArrays.get(spreadName) || []));
      continue;
    }
    const quote = match[2] || '"';
    const rawValue = match[3] || "";
    const decoded = decodeSourceStringLiteral(quote, rawValue);
    if (decoded.trim()) lines.push(decoded);
  }

  return lines;
}

function looksLikePromptPreview(text: string) {
  return /\b(?:SECTION:|score|scoring|event_type|display_payload|analysis|filing|JSON|tender|source|market_context)\b/i.test(text);
}

function extractStringLiteralLines(source: string) {
  const lines: string[] = [];
  const literalPattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match: RegExpExecArray | null;

  while ((match = literalPattern.exec(source))) {
    const quote = match[1] || '"';
    const rawValue = match[2] || "";
    const decoded = decodeSourceStringLiteral(quote, rawValue);
    if (decoded.trim()) lines.push(decoded);
  }

  return lines;
}

function decodeSourceStringLiteral(quote: string, rawValue: string) {
  if (quote === "`") return rawValue.replace(/\\`/g, "`").replace(/\\n/g, "\n");
  try {
    return JSON.parse(`"${rawValue.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return rawValue.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"');
  }
}

async function readDevFile(kind: SecDevRoomDetail["files"][number]["kind"], absolute: string) {
  const relative = path.relative(ROOT, absolute).replace(/\\/g, "/");
  try {
    const raw = await fs.readFile(absolute, "utf8");
    const truncated = raw.length > FILE_CHAR_LIMIT;
    return {
      kind,
      name: path.basename(absolute),
      path: relative,
      exists: true,
      content: truncated ? `${raw.slice(0, FILE_CHAR_LIMIT)}\n\n/* truncated */` : raw,
      truncated,
    };
  } catch {
    return {
      kind,
      name: path.basename(absolute),
      path: relative,
      exists: false,
      content: "",
      truncated: false,
    };
  }
}

async function listRoomTestFiles(room: SecDevRoom) {
  const base = path.join(FORMS_ROOT, room.folder);
  let entries: string[] = [];
  try {
    entries = await fs.readdir(base);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /\.test\.ts$/.test(name))
    .filter((name) => !/(?:live|real-sec)/i.test(name))
    .sort()
    .map((name) => path.join(base, name));
}

async function listJsonFiles(directory: string) {
  try {
    const entries = await fs.readdir(directory);
    return entries.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

function buildRoomSnapshot(room: SecDevRoom, testFiles: string[], results: SecDevTestResult[]): SecDevRoomSnapshot {
  const passCount = results.filter((result) => result.status === "pass").length;
  const failCount = results.filter((result) => result.status === "fail").length;
  const notRunCount = Math.max(0, testFiles.length - passCount - failCount);
  const runTimes = results
    .map((result) => result.ranAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastRunAt = runTimes.length ? runTimes[runTimes.length - 1] : null;
  const status: SecDevTestStatus = failCount > 0 ? "fail" : notRunCount > 0 ? "not_run" : passCount > 0 ? "pass" : "not_run";

  return {
    ...room,
    testFiles: testFiles.map((file) => path.relative(ROOT, file).replace(/\\/g, "/")),
    status,
    passCount,
    failCount,
    notRunCount,
    lastRunAt,
  };
}

function resolveRunFormTypes(room: SecDevRoom, requested: string[] | undefined) {
  const allowed = new Map(room.forms.map((form) => [normalizeFormForPreviewFilter(form), form]));
  const selected = (requested || [])
    .map((form) => allowed.get(normalizeFormForPreviewFilter(form)))
    .filter((form): form is string => Boolean(form));
  return selected.length ? uniqueStrings(selected) : room.forms;
}

async function runTestFile(file: string): Promise<SecDevTestResult> {
  const start = Date.now();
  const command = `npx --yes tsx ${path.relative(ROOT, file).replace(/\\/g, "/")}`;
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: ROOT,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_ENV: "test",
      },
    });
    return {
      file: path.relative(ROOT, file).replace(/\\/g, "/"),
      status: "pass",
      command,
      durationMs: Date.now() - start,
      ranAt: new Date().toISOString(),
      output: trimOutput(`${stdout}\n${stderr}`),
      error: null,
    };
  } catch (error) {
    const record = error as { stdout?: string; stderr?: string; message?: string };
    return {
      file: path.relative(ROOT, file).replace(/\\/g, "/"),
      status: "fail",
      command,
      durationMs: Date.now() - start,
      ranAt: new Date().toISOString(),
      output: trimOutput(`${record.stdout || ""}\n${record.stderr || ""}`),
      error: record.message || "Test failed",
    };
  }
}

async function ensureDevRawItemForPersist({
  attachmentLimit,
  accessionNumber,
  cik,
  rawItemId,
  room,
}: {
  attachmentLimit: number;
  accessionNumber: string;
  cik: string;
  rawItemId: string;
  room: SecDevRoom;
}) {
  if (rawItemId) {
    const existing = await findSecRawItem({ rawItemId });
    if (existing.ok && existing.rawItem) {
      return {
        rawItemId: stringValue(existing.rawItem.id),
        accessionNumber: stringValue(existing.rawItem.source_unique_id),
        source: "existing_raw_item",
      };
    }
  }

  if (accessionNumber) {
    const existing = await findSecRawItem({ accessionNumber });
    if (existing.ok && existing.rawItem) {
      return {
        rawItemId: stringValue(existing.rawItem.id),
        accessionNumber,
        source: "existing_raw_item",
      };
    }
  }

  if (!accessionNumber) {
    throw new Error("Raw item is not present and accessionNumber was not provided for SEC live fetch.");
  }

  const accessionFetchResult = await fetchSecEdgarRawItems({
    accessionNumber,
    cik: cik || undefined,
    formTypes: room.forms,
    includeDocuments: true,
    attachmentLimit,
  });
  if (accessionFetchResult.ok) {
    const rawItem =
      accessionFetchResult.items.find((item) => stringValue(item.source_unique_id) === accessionNumber) ||
      accessionFetchResult.items[0] ||
      null;
    if (rawItem) {
      const persisted = await persistSingleDevRawItem(rawItem);
      return {
        rawItemId: stringValue(persisted.id),
        accessionNumber: stringValue(rawItem.source_unique_id) || accessionNumber,
        source: "archive_accession_persisted_raw_item",
        diagnostics: accessionFetchResult.diagnostics,
      };
    }
  }

  const fetchResult = await fetchSecEdgarRawItems({
    formTypes: room.forms,
    countPerForm: 10,
    limit: 40,
    includeDocuments: true,
    attachmentLimit,
  });
  if (!fetchResult.ok) {
    const directError = accessionFetchResult.error ? ` Direct accession fetch failed: ${accessionFetchResult.error}` : "";
    throw new Error(`${fetchResult.error || "SEC raw fetch failed before controlled persist"}${directError}`);
  }

  const rawItem = fetchResult.items.find((item) => stringValue(item.source_unique_id) === accessionNumber);
  if (!rawItem) {
    throw new Error(
      `Accession ${accessionNumber} was not found in SEC archive lookup or the current SEC feed for ${room.forms.join(", ")}. Add the filing CIK if this is an older archive filing.`,
    );
  }

  const persisted = await persistSingleDevRawItem(rawItem);
  return {
    rawItemId: stringValue(persisted.id),
    accessionNumber,
    source: "live_fetch_persisted_raw_item",
    diagnostics: fetchResult.diagnostics,
  };
}

async function persistSingleDevRawItem(rawItem: SecParsedRawItem) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  await ensureSecSource();
  await createSecSourceRun({
    force: true,
    includeDocuments: true,
    requestedFormTypes: [stringValue(readRecord(rawItem.raw_payload)?.form_type)].filter(Boolean),
    requestedLimit: 1,
    runId,
    startedAt,
  });

  try {
    const existing = await findExistingSecRawItem(rawItem);
    const persisted = await saveSecRawItem(rawItem, runId, existing);
    await finishSecSourceRun(
      runId,
      "completed",
      startedAt,
      {
        checked_count: 1,
        raw_upserted_count: 1,
        skipped_count: 0,
        failed_count: 0,
        documents_requested: countDocuments(rawItem),
        documents_fetched: countFetchedDocuments(rawItem),
        documents_failed: 0,
      },
      undefined,
      { development_controlled_persist: true },
    );
    return persisted;
  } catch (error) {
    await finishSecSourceRun(
      runId,
      "failed",
      startedAt,
      {
        checked_count: 1,
        raw_upserted_count: 0,
        skipped_count: 0,
        failed_count: 1,
      },
      error instanceof Error ? error.message : "Controlled raw persist failed",
      { development_controlled_persist: true },
    );
    throw error;
  }
}

async function appendLiveRun(roomKey: string, result: SecDevLiveRunResult) {
  const cache = await readLiveCache();
  const existing = cache[roomKey] || [];
  cache[roomKey] = [result, ...existing].slice(0, 20);
  await writeLiveCache(cache);
}

async function readLiveCache(): Promise<Record<string, SecDevLiveRunResult[]>> {
  try {
    const raw = await fs.readFile(LIVE_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, SecDevLiveRunResult[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLiveCache(cache: Record<string, SecDevLiveRunResult[]>) {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  await fs.writeFile(LIVE_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function readTestCache(): Promise<Record<string, SecDevTestResult>> {
  try {
    const raw = await fs.readFile(TEST_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, SecDevTestResult>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeTestCache(cache: Record<string, SecDevTestResult>) {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true });
  await fs.writeFile(TEST_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function buildNotRunResult(file: string): SecDevTestResult {
  return {
    file: path.relative(ROOT, file).replace(/\\/g, "/"),
    status: "not_run",
    command: null,
    durationMs: null,
    ranAt: null,
    output: null,
    error: null,
  };
}

function buildLocalFilingUrl(eventId: string, deliveryLevel: string) {
  if (!eventId) return null;
  return deliveryLevel === "archive" ? `/filings/archive/${eventId}` : `/filings/${eventId}`;
}

function buildParentRegistrationContextDebug(context: Record<string, unknown> | null) {
  if (!context) return null;
  const parent = readRecord(context.parent);
  const offeringTerms = readRecord(context.offering_terms);
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];

  return {
    source: stringValue(context.source) || null,
    status: stringValue(context.status) || null,
    confirmed_parent: context.confirmed_parent === true,
    comparison_allowed: context.comparison_allowed === true,
    registration_number: stringValue(context.registration_number) || null,
    registration_number_match: context.registration_number_match === true,
    match_method: stringValue(context.match_method) || null,
    match_count: numberValue(context.match_count),
    match_reasons: stringArray(context.match_reasons).slice(0, 8),
    parent_accession: stringValue(context.accession_number) || stringValue(parent?.accession_number) || null,
    parent_raw_item_id: stringValue(context.raw_item_id) || stringValue(parent?.raw_item_id) || null,
    parent_form_type: stringValue(context.form_type) || stringValue(parent?.form_type) || null,
    parent_filed_at: stringValue(context.filed_at) || stringValue(parent?.filed_at) || null,
    parent_company_name: stringValue(context.company_name) || stringValue(parent?.company_name) || null,
    parent_ticker: stringValue(context.ticker) || stringValue(parent?.ticker) || null,
    candidate_count: candidates.length,
    candidates: candidates
      .map((candidate) => readRecord(candidate))
      .filter(Boolean)
      .slice(0, 5)
      .map((candidate) => ({
        accession_number: stringValue(candidate?.accession_number) || null,
        form_type: stringValue(candidate?.form_type) || null,
        filed_at: stringValue(candidate?.filed_at) || null,
        match_method: stringValue(candidate?.match_method) || null,
        match_reasons: stringArray(candidate?.match_reasons).slice(0, 5),
      })),
    offering_terms: offeringTerms
      ? {
          offering_type: stringValue(offeringTerms.offering_type) || null,
          security_type: stringValue(offeringTerms.security_type) || null,
          primary_or_resale: stringValue(offeringTerms.primary_or_resale) || null,
          shelf_capacity: stringValue(offeringTerms.shelf_capacity) || null,
          resale_share_count: stringValue(offeringTerms.resale_share_count) || null,
          atm_program_size: stringValue(offeringTerms.atm_program_size) || null,
          conversion_price: stringValue(offeringTerms.conversion_price) || null,
        }
      : null,
  };
}

function buildParentFilingContextDebug(context: Record<string, unknown> | null) {
  if (!context) return null;
  const parent = readRecord(context.parent);
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];

  return {
    source: stringValue(context.source) || null,
    status: stringValue(context.status) || null,
    match_method: stringValue(context.match_method) || null,
    confidence: stringValue(context.confidence) || null,
    match_reasons: stringArray(context.match_reasons).slice(0, 8),
    parent_accession: stringValue(context.accession_number) || stringValue(parent?.accession_number) || null,
    parent_form_type: stringValue(context.form_type) || stringValue(parent?.form_type) || null,
    parent_filed_at: stringValue(context.filed_at) || stringValue(parent?.filed_at) || null,
    parent_company_name: stringValue(context.company_name) || stringValue(parent?.company_name) || null,
    candidate_count: candidates.length,
  };
}

function deriveDeliveryLabel(score: number | null) {
  if (score === null) return "-";
  if (score >= 75) return "alert";
  if (score >= 50) return "feed";
  return "archive";
}

function firstString(value: unknown) {
  if (!Array.isArray(value)) return "";
  for (const item of value) {
    const text = stringValue(item);
    if (text) return text;
  }
  return "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = stringValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function previewDisplayData(data: Record<string, unknown> | null) {
  if (!data) return [];
  return Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 10)
    .map(([label, value]) => ({
      label,
      value: previewValue(value),
    }));
}

const APPROVED_S3_AMENDMENT_CHANGE_LABELS = [
  "Prospectus date",
  "Share-count basis",
  "Reference prices",
  "Registered shares",
  "Offering size",
  "Selling holders",
  "Securities covered",
  "Warrant terms",
  "Exercise price",
  "Conversion terms",
  "Sale price",
  "Resale method",
  "Agreement date",
  "Effective date",
  "Registration obligation",
  "Use of proceeds",
  "Company proceeds",
  "Plan of distribution",
  "Risk factors",
  "Fee table",
  "Incorporated documents",
  "Expert consents",
  "Legal opinion",
  "Exhibit status",
];

function buildDisplayPayloadDebug(
  displayPayload: Record<string, unknown> | null,
  data: Record<string, unknown> | null,
  analysis: Record<string, unknown> | null,
) {
  if (!displayPayload && !data) return null;

  return {
    display_type: stringValue(displayPayload?.display_type) || null,
    display_version: stringValue(displayPayload?.display_version) || null,
    display_mode: stringValue(data?.display_mode) || null,
    risk_label: stringValue(data?.risk_label) || null,
    snapshot_metrics: readDebugValue(data?.snapshot_metrics),
    share_overhang: readDebugValue(data?.share_overhang),
    offering_details: readDebugValue(data?.offering_details),
    amendment_changes: readDebugValue(data?.amendment_changes),
    supply_segments: readDebugValue(data?.supply_segments),
    instrument_details: readDebugValue(data?.instrument_details),
    mixed_offering_components: readDebugValue(data?.mixed_offering_components),
    key_cash_terms: readDebugValue(data?.key_cash_terms),
    registered_security_totals: readDebugValue(data?.registered_security_totals),
    s8_context_details: readDebugValue(data?.s8_context_details),
    display_warnings: uniqueStrings([
      ...stringArray(analysis?.sec_s3_display_warnings),
      ...stringArray(analysis?.sec_424b_display_warnings),
      ...stringArray(analysis?.sec_s1_f1_display_warnings),
      ...stringArray(data?.display_warnings),
    ]),
    s3_amendment_change_label_policy: {
      source: "LLM chooses labels; prompt says use approved labels first, custom labels only if needed.",
      approved_labels: APPROVED_S3_AMENDMENT_CHANGE_LABELS,
    },
  };
}

function readDebugValue(value: unknown) {
  if (value === undefined) return null;
  return value;
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (readRecord(value)) return "object";
  return "";
}

function normalizePromptPreviewText(value: string) {
  const text = value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= 60_000) return text;
  return `${text.slice(0, 60_000)}\n\n/* prompt preview truncated */`;
}

function countDocuments(rawItem: SecParsedRawItem) {
  return Array.isArray(rawItem.raw_payload.documents) ? rawItem.raw_payload.documents.length : 0;
}

function countFetchedDocuments(rawItem: SecParsedRawItem) {
  return Array.isArray(rawItem.raw_payload.documents)
    ? rawItem.raw_payload.documents.filter((document) => readRecord(document)?.fetchStatus !== 0).length
    : 0;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeFormForPreviewFilter(value: string) {
  return stringValue(value).toUpperCase().replace(/\s+/g, " ").trim();
}

function normalizeDateOnly(value: unknown) {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function formatDateRangeSummary(dateFrom: string | null, dateTo: string | null) {
  if (dateFrom && dateTo) return ` from ${dateFrom} to ${dateTo}`;
  if (dateFrom) return ` from ${dateFrom}`;
  if (dateTo) return ` through ${dateTo}`;
  return "";
}

function normalizeFormFilenameToken(value: string) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function trimOutput(value: string) {
  const text = value.trim();
  if (text.length <= 30_000) return text;
  return `${text.slice(0, 30_000)}\n\n/* output truncated */`;
}
