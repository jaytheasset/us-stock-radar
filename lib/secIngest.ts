import { randomUUID } from "node:crypto";
import { fetchSecEdgarRawItems, type SecParsedRawItem } from "@/lib/sources/sec/parser";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";

type SecRawIngestOptions = {
  formTypes?: string[];
  countPerForm?: number;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
  includeDocuments?: boolean;
  attachmentLimit?: number;
};

type PersistedRow = Record<string, unknown>;

export async function runSecRawIngest(options: SecRawIngestOptions = {}) {
  const dryRun = Boolean(options.dryRun);
  const force = Boolean(options.force);
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const items: Array<Record<string, unknown>> = [];
  const stats = {
    checked_count: 0,
    raw_upserted_count: 0,
    skipped_count: 0,
    failed_count: 0,
    documents_requested: 0,
    documents_fetched: 0,
    documents_failed: 0,
  };

  if (!dryRun) {
    await ensureSecSource();
    await assertMutation(
      supabaseUpsert(
        "source_runs",
        {
          id: runId,
          source_code: "sec_edgar",
          source_group: "filings",
          run_type: "raw_ingest",
          status: "running",
          started_at: startedAt,
          stats: {
            requested_limit: options.limit || null,
            requested_form_types: options.formTypes || null,
          },
          metadata: {
            dry_run: false,
            force,
            include_documents: options.includeDocuments ?? true,
          },
        },
        { onConflict: "id" },
      ),
      "create SEC source run",
    );
  }

  try {
    const rawResult = await fetchSecEdgarRawItems({
      formTypes: options.formTypes,
      countPerForm: options.countPerForm,
      limit: options.limit,
      includeDocuments: options.includeDocuments,
      attachmentLimit: options.attachmentLimit,
    });

    if (!rawResult.ok) {
      if (!dryRun) {
        await finishSourceRun(runId, "failed", startedAt, stats, rawResult.error || "SEC raw fetch failed", {
          raw_diagnostics: rawResult.diagnostics,
        });
      }

      return {
        ok: false,
        stage: "raw_fetch",
        status: rawResult.status,
        error: rawResult.error || "SEC raw fetch failed",
        rawResult,
      };
    }

    stats.checked_count = rawResult.items.length;
    stats.documents_requested = rawResult.diagnostics.documentsRequested;
    stats.documents_fetched = rawResult.diagnostics.documentsFetched;
    stats.documents_failed = rawResult.diagnostics.documentsFailed;

    for (const rawItem of rawResult.items) {
      try {
        if (dryRun) {
          items.push({
            ok: true,
            dryRun: true,
            raw_item: summarizeRaw(rawItem),
          });
          continue;
        }

        const existing = await findExistingRawItem(rawItem);
        if (existing && !force) {
          stats.skipped_count += 1;
          items.push({
            ok: true,
            skipped: true,
            reason: "existing_raw_item",
            raw_item_id: existing.id,
            source_unique_id: rawItem.source_unique_id,
            title: existing.title || rawItem.title,
          });
          continue;
        }

        const persisted = await persistRawItem(rawItem, runId, existing);
        stats.raw_upserted_count += 1;
        items.push({
          ok: true,
          raw_item_id: persisted.id,
          source_unique_id: rawItem.source_unique_id,
          title: persisted.title,
          form_type: readNested(rawItem.raw_payload, "form_type"),
          ticker: readNested(rawItem.raw_payload, "ticker"),
          body_chars: stringValue(rawItem.body_text).length,
        });
      } catch (error) {
        stats.failed_count += 1;
        items.push({
          ok: false,
          source_unique_id: rawItem.source_unique_id,
          title: rawItem.title,
          error: error instanceof Error ? error.message : "Unknown SEC raw item ingest error",
        });
      }
    }

    const ok = stats.failed_count === 0;
    const partial = stats.failed_count > 0 && stats.raw_upserted_count > 0;
    if (!dryRun) {
      await finishSourceRun(
        runId,
        ok || partial ? "completed" : "failed",
        startedAt,
        stats,
        ok ? undefined : "One or more SEC raw items failed",
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
      items,
      diagnostics: rawResult.diagnostics,
    };
  } catch (error) {
    if (!dryRun) {
      await finishSourceRun(
        runId,
        "failed",
        startedAt,
        stats,
        error instanceof Error ? error.message : "Unknown SEC raw ingest error",
      );
    }

    return {
      ok: false,
      stage: "ingest",
      runId: dryRun ? null : runId,
      stats,
      error: error instanceof Error ? error.message : "Unknown SEC raw ingest error",
      items,
    };
  }
}

async function ensureSecSource() {
  await assertMutation(
    supabaseUpsert(
      "sources",
      {
        code: "sec_edgar",
        name: "SEC EDGAR",
        source_group: "filings",
        runtime_owner: "external",
        enabled: true,
        metadata: {
          source_url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom",
          parser: "sec_edgar_raw_parser_v1",
        },
      },
      { onConflict: "code" },
    ),
    "upsert SEC source",
  );
}

async function persistRawItem(rawItem: SecParsedRawItem, runId: string, existing?: PersistedRow | null) {
  const id = stringValue(existing?.id) || randomUUID();
  const metadata = {
    ...(toRecord(existing?.metadata) || {}),
    ...rawItem.metadata,
    parser: "sec_edgar",
    event_created: false,
  };
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
    analysis_text: rawItem.analysis_text,
    raw_payload: rawItem.raw_payload,
    metadata,
    dedupe_key: rawItem.dedupe_key,
  };

  const result = await supabaseUpsert("raw_items", payload, { onConflict: "id" });
  await assertMutation(result, "upsert SEC raw item");
  return firstRow(result.data) || payload;
}

async function findExistingRawItem(rawItem: SecParsedRawItem) {
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
      source_code: "sec_edgar",
      source_group: "filings",
      run_type: "raw_ingest",
      status,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      stats,
      error_message: errorMessage || null,
      metadata,
    },
    { onConflict: "id" },
  );
  await assertMutation(result, "finish SEC source run");
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

function summarizeRaw(rawItem: SecParsedRawItem) {
  return {
    source_unique_id: rawItem.source_unique_id,
    source_url: rawItem.source_url,
    title: rawItem.title,
    published_at: rawItem.published_at,
    form_type: readNested(rawItem.raw_payload, "form_type"),
    cik: readNested(rawItem.raw_payload, "cik"),
    ticker: readNested(rawItem.raw_payload, "ticker"),
    exchange: readNested(rawItem.raw_payload, "exchange"),
    document_count: Array.isArray(rawItem.raw_payload.documents) ? rawItem.raw_payload.documents.length : 0,
    body_chars: stringValue(rawItem.body_text).length,
  };
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

function readNested(value: unknown, key: string) {
  return toRecord(value)?.[key] || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
