import {
  compareSecOfflineArchiveRawItem,
  assertSecOfflineImportForm,
  type SecOfflineArchiveImportBundle,
  type SecOfflineArchivePreparedItem,
} from "./canonical.ts";

type Row = Record<string, unknown>;

type RepositoryResult = Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}>;

export type SecOfflineArchiveRepository = Readonly<{
  select: (table: string, query: Record<string, string>) => RepositoryResult;
  rpc: (name: string, payload: Record<string, unknown>) => RepositoryResult;
}>;

export type SecOfflineArchivePlanItem = Readonly<{
  accessionNumber: string;
  role: string;
  sourceSha256: string;
  proposedRawItemId: string;
  existingRawItemId: string | null;
  action: "insert" | "replay" | "conflict";
  reason: string | null;
}>;

export type SecOfflineArchiveImportPlan =
  | Readonly<{
      status: "ready" | "conflict";
      manifestSha256: string;
      bundleSha256: string;
      runId: string;
      counts: { insert: number; replay: number; conflict: number };
      items: readonly SecOfflineArchivePlanItem[];
    }>
  | Readonly<{
      status: "unavailable";
      reason: "raw_item_read_failed" | "raw_item_read_malformed";
    }>;

export type SecOfflineArchiveApplyResult = Readonly<{
  status: "inserted" | "replayed" | "mixed";
  runId: string;
  manifestSha256: string;
  bundleSha256: string;
  insertedCount: number;
  replayedCount: number;
  items: readonly Readonly<{
    accessionNumber: string;
    rawItemId: string;
    status: "inserted" | "replayed";
  }>[];
}>;

export class SecOfflineArchivePersistenceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "SecOfflineArchivePersistenceError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_REPOSITORY: SecOfflineArchiveRepository = {
  async select(table, query) {
    const { supabaseSelect } = await import("../supabase.ts");
    return supabaseSelect(table, query);
  },
  async rpc(name, payload) {
    const { supabaseRpc } = await import("../supabase.ts");
    return supabaseRpc(name, payload);
  },
};

export async function planSecOfflineArchiveImport(input: {
  bundle: SecOfflineArchiveImportBundle;
  repository?: SecOfflineArchiveRepository;
}): Promise<SecOfflineArchiveImportPlan> {
  for (const item of input.bundle.items) assertSecOfflineImportForm(item.rawItem.raw_payload.form_type);
  const repository = input.repository ?? DEFAULT_REPOSITORY;
  const accessions = input.bundle.items.map((item) => item.accessionNumber);
  const read = await repository.select("raw_items", {
    select: "id,source_code,source_group,source_unique_id,source_url,dedupe_key,raw_payload",
    source_code: "eq.sec_edgar",
    source_unique_id: `in.(${accessions.join(",")})`,
    limit: String(accessions.length + 1),
  });
  if (!read.ok) return { status: "unavailable", reason: "raw_item_read_failed" };
  if (!Array.isArray(read.data)) return { status: "unavailable", reason: "raw_item_read_malformed" };

  const existingByAccession = new Map<string, Row[]>();
  for (const value of read.data) {
    const row = record(value);
    const accession = text(row.source_unique_id);
    if (!accession) return { status: "unavailable", reason: "raw_item_read_malformed" };
    const rows = existingByAccession.get(accession) ?? [];
    rows.push(row);
    existingByAccession.set(accession, rows);
  }

  const items = input.bundle.items.map((prepared) => planItem(
    prepared,
    existingByAccession.get(prepared.accessionNumber) ?? [],
  ));
  const counts = {
    insert: items.filter((item) => item.action === "insert").length,
    replay: items.filter((item) => item.action === "replay").length,
    conflict: items.filter((item) => item.action === "conflict").length,
  };
  return {
    status: counts.conflict ? "conflict" : "ready",
    manifestSha256: input.bundle.manifestSha256,
    bundleSha256: input.bundle.bundleSha256,
    runId: input.bundle.runId,
    counts,
    items,
  };
}

export async function applySecOfflineArchiveImport(input: {
  bundle: SecOfflineArchiveImportBundle;
  confirmedBundleSha256: string;
  startedAt?: string;
  repository?: SecOfflineArchiveRepository;
}): Promise<SecOfflineArchiveApplyResult> {
  if (input.confirmedBundleSha256 !== input.bundle.bundleSha256) {
    throw new SecOfflineArchivePersistenceError(
      "bundle_confirmation_mismatch",
      "SEC offline archive bundle confirmation does not match the prepared input",
      400,
    );
  }
  const repository = input.repository ?? DEFAULT_REPOSITORY;
  const plan = await planSecOfflineArchiveImport({ bundle: input.bundle, repository });
  if (plan.status === "unavailable") {
    throw new SecOfflineArchivePersistenceError(
      plan.reason,
      "SEC offline archive import plan could not read current raw state",
      503,
    );
  }
  if (plan.status === "conflict") {
    throw new SecOfflineArchivePersistenceError(
      "raw_item_conflict",
      "SEC offline archive import conflicts with an existing accession",
    );
  }

  const startedAt = normalizeTimestamp(input.startedAt ?? new Date().toISOString());
  const response = await repository.rpc("import_sec_offline_archive_raw", {
    p_run_id: input.bundle.runId,
    p_manifest_sha256: input.bundle.manifestSha256,
    p_bundle_sha256: input.bundle.bundleSha256,
    p_started_at: startedAt,
    p_items: input.bundle.items.map((item) => ({
      sourceSha256: item.sourceSha256,
      sourceUtf8ByteCount: item.sourceUtf8ByteCount,
      rawItem: item.rawItem,
    })),
  });
  if (!response.ok) {
    throw new SecOfflineArchivePersistenceError(
      mapRpcError(response.error),
      "SEC offline archive import RPC rejected the prepared bundle",
      response.status || 503,
    );
  }
  return validateApplyResponse(response.data, input.bundle);
}

function planItem(
  prepared: SecOfflineArchivePreparedItem,
  existingRows: Row[],
): SecOfflineArchivePlanItem {
  if (!existingRows.length) {
    return {
      accessionNumber: prepared.accessionNumber,
      role: prepared.role,
      sourceSha256: prepared.sourceSha256,
      proposedRawItemId: prepared.rawItemId,
      existingRawItemId: null,
      action: "insert",
      reason: null,
    };
  }
  if (existingRows.length !== 1) {
    return {
      accessionNumber: prepared.accessionNumber,
      role: prepared.role,
      sourceSha256: prepared.sourceSha256,
      proposedRawItemId: prepared.rawItemId,
      existingRawItemId: null,
      action: "conflict",
      reason: "multiple_existing_raw_items",
    };
  }
  const existing = existingRows[0]!;
  const existingRawItemId = uuid(existing.id) || null;
  const comparison = compareSecOfflineArchiveRawItem(existing, prepared);
  return {
    accessionNumber: prepared.accessionNumber,
    role: prepared.role,
    sourceSha256: prepared.sourceSha256,
    proposedRawItemId: prepared.rawItemId,
    existingRawItemId,
    action: comparison.matches ? "replay" : "conflict",
    reason: comparison.matches ? null : comparison.reason,
  };
}

function validateApplyResponse(
  value: unknown,
  bundle: SecOfflineArchiveImportBundle,
): SecOfflineArchiveApplyResult {
  const row = record(value);
  const status = text(row.status);
  const runId = uuid(row.run_id);
  const manifestSha256 = sha(row.manifest_sha256);
  const bundleSha256 = sha(row.bundle_sha256);
  const insertedCount = integer(row.inserted_count);
  const replayedCount = integer(row.replayed_count);
  const itemValues = Array.isArray(row.items) ? row.items : [];
  if (
    !["inserted", "replayed", "mixed"].includes(status)
    || runId !== bundle.runId
    || manifestSha256 !== bundle.manifestSha256
    || bundleSha256 !== bundle.bundleSha256
    || insertedCount === null
    || replayedCount === null
    || insertedCount < 0
    || replayedCount < 0
    || insertedCount + replayedCount !== bundle.items.length
    || itemValues.length !== bundle.items.length
  ) {
    throw new SecOfflineArchivePersistenceError(
      "rpc_response_invalid",
      "SEC offline archive import RPC returned an invalid response",
      503,
    );
  }
  const expectedAccessions = new Set(bundle.items.map((item) => item.accessionNumber));
  const items = itemValues.map((itemValue) => {
    const item = record(itemValue);
    const accessionNumber = text(item.accession_number);
    const rawItemId = uuid(item.raw_item_id);
    const itemStatus = text(item.status);
    if (
      !expectedAccessions.delete(accessionNumber)
      || !rawItemId
      || !["inserted", "replayed"].includes(itemStatus)
    ) {
      throw new SecOfflineArchivePersistenceError(
        "rpc_response_invalid",
        "SEC offline archive import RPC item result is invalid",
        503,
      );
    }
    return {
      accessionNumber,
      rawItemId,
      status: itemStatus as "inserted" | "replayed",
    };
  });
  if (expectedAccessions.size) {
    throw new SecOfflineArchivePersistenceError(
      "rpc_response_invalid",
      "SEC offline archive import RPC omitted an accession",
      503,
    );
  }
  const actualInsertedCount = items.filter((item) => item.status === "inserted").length;
  const actualReplayedCount = items.length - actualInsertedCount;
  const expectedStatus = actualInsertedCount === 0
    ? "replayed"
    : actualReplayedCount === 0
      ? "inserted"
      : "mixed";
  if (
    actualInsertedCount !== insertedCount
    || actualReplayedCount !== replayedCount
    || status !== expectedStatus
  ) {
    throw new SecOfflineArchivePersistenceError(
      "rpc_response_invalid",
      "SEC offline archive import RPC counts or status are inconsistent",
      503,
    );
  }
  return {
    status: status as "inserted" | "replayed" | "mixed",
    runId,
    manifestSha256,
    bundleSha256,
    insertedCount,
    replayedCount,
    items,
  };
}

function mapRpcError(value: unknown) {
  const message = text(value);
  if (/SEC_OFFLINE_ARCHIVE_RAW_CONFLICT/i.test(message)) return "raw_item_conflict";
  if (/SEC_OFFLINE_ARCHIVE_RUN_CONFLICT/i.test(message)) return "source_run_conflict";
  if (/SEC_OFFLINE_ARCHIVE_INPUT_INVALID/i.test(message)) return "rpc_input_invalid";
  return "rpc_failed";
}

function normalizeTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SecOfflineArchivePersistenceError(
      "started_at_invalid",
      "SEC offline archive import start timestamp is invalid",
      400,
    );
  }
  return date.toISOString();
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function uuid(value: unknown) {
  const candidate = text(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate)
    ? candidate
    : "";
}

function sha(value: unknown) {
  const candidate = text(value).toLowerCase();
  return /^[0-9a-f]{64}$/.test(candidate) ? candidate : "";
}

function integer(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}
