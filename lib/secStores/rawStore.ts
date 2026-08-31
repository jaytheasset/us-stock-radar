import { randomUUID } from "node:crypto";
import type { SecParsedRawItem } from "@/lib/sources/sec/parser";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";
import {
  registerWorkflowSourceRun,
  transitionSourceRunToTerminal,
} from "@/lib/sourceRunState";

type PersistedRow = Record<string, unknown>;

export async function ensureSecSource() {
  await assertMutation(
      supabaseUpsertSanitized(
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

export async function saveSecRawItem(rawItem: SecParsedRawItem, runId: string, existing?: PersistedRow | null) {
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

  const result = await supabaseUpsertSanitized("raw_items", payload, { onConflict: "id" });
  await assertMutation(result, "upsert SEC raw item");
  return firstRow(result.data) || payload;
}

export async function findExistingSecRawItem(rawItem: SecParsedRawItem) {
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

export async function finishSecSourceRun(
  runId: string,
  status: "completed" | "failed" | "skipped",
  startedAt: string,
  stats: Record<string, unknown>,
  errorMessage?: string,
  metadata: Record<string, unknown> = {},
) {
  await transitionSourceRunToTerminal({
    runId,
    status,
    stats,
    errorMessage,
    metadata,
  });
}

export async function createSecSourceRun({
  force,
  includeDocuments,
  requestedFormTypes,
  requestedLimit,
  requestedAccessionNumber,
  runId,
  startedAt,
  metadata = {},
}: {
  force: boolean;
  includeDocuments: boolean;
  requestedFormTypes?: string[];
  requestedLimit?: number;
  requestedAccessionNumber?: string;
  runId: string;
  startedAt: string;
  metadata?: Record<string, unknown>;
}) {
  const workflowRunId = typeof metadata.workflow_run_id === "string"
    ? metadata.workflow_run_id.trim()
    : "";
  if (workflowRunId) {
    return registerWorkflowSourceRun({
      runId,
      sourceCode: "sec_edgar",
      sourceGroup: "filings",
      runType: "raw_ingest",
      startedAt,
      stats: {
        requested_limit: requestedLimit || null,
        requested_form_types: requestedFormTypes || null,
        requested_accession_number: requestedAccessionNumber || null,
      },
      metadata: {
        dry_run: false,
        force,
        include_documents: includeDocuments,
        ...metadata,
      },
    });
  }

  await assertMutation(
    supabaseUpsertSanitized(
      "source_runs",
      {
        id: runId,
        source_code: "sec_edgar",
        source_group: "filings",
        run_type: "raw_ingest",
        status: "running",
        started_at: startedAt,
        stats: {
          requested_limit: requestedLimit || null,
          requested_form_types: requestedFormTypes || null,
          requested_accession_number: requestedAccessionNumber || null,
        },
        metadata: {
          dry_run: false,
          force,
          include_documents: includeDocuments,
          ...metadata,
        },
      },
      {
        onConflict: "id",
        prefer: "resolution=ignore-duplicates,return=representation",
      },
    ),
    "create SEC source run",
  );
  return "running" as const;
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
  return Array.isArray(value) && value[0] && typeof value[0] === "object" ? (value[0] as PersistedRow) : null;
}

function supabaseUpsertSanitized(
  table: string,
  payload: Record<string, unknown> | Array<Record<string, unknown>>,
  options: Parameters<typeof supabaseUpsert>[2] = {},
) {
  return supabaseUpsert(table, sanitizeForPostgresJson(payload) as Record<string, unknown> | Array<Record<string, unknown>>, options);
}

function sanitizeForPostgresJson(value: unknown): unknown {
  if (typeof value === "string") return sanitizePostgresString(value);
  if (Array.isArray(value)) return value.map(sanitizeForPostgresJson);
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    sanitized[sanitizePostgresString(key)] = sanitizeForPostgresJson(item);
  }
  return sanitized;
}

function sanitizePostgresString(value: string) {
  let sanitized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) continue;
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        sanitized += value[index] + value[index + 1];
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    sanitized += value[index];
  }
  return sanitized;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
