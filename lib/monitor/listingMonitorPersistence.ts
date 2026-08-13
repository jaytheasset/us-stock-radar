import {
  getReadyMonitorCondition,
  validateMonitorConditionInput,
  type MonitorConditionOperator,
} from "./conditionRegistry.ts";

type RepositoryResult = Readonly<{
  ok: boolean;
  status?: number;
  data: unknown;
  error?: string;
}>;

type StoredListingMonitorRow = Record<string, unknown>;

export type CanonicalListingMonitorCondition = Readonly<{
  key: string;
  operator: MonitorConditionOperator;
  value: unknown;
}>;

export type ListingMonitor = Readonly<{
  id: string;
  userId: string;
  domain: "listing";
  conditions: readonly CanonicalListingMonitorCondition[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type ListingMonitorDiagnostic = Readonly<{
  id: string;
  reason: "stored_conditions_invalid" | "stored_monitor_invalid";
  errors: readonly string[];
}>;

export type ListingMonitorListResult = Readonly<{
  monitors: readonly ListingMonitor[];
  diagnostics: readonly ListingMonitorDiagnostic[];
}>;

export type ListingMonitorReadResult =
  | Readonly<{ status: "available"; monitor: ListingMonitor }>
  | Readonly<{ status: "invalid"; diagnostic: ListingMonitorDiagnostic }>
  | Readonly<{ status: "not_found" }>;

export type ListingMonitorRepository = Readonly<{
  create(row: StoredListingMonitorRow): Promise<RepositoryResult>;
  list(ownerId: string, activeOnly: boolean): Promise<RepositoryResult>;
  read(ownerId: string, monitorId: string): Promise<RepositoryResult>;
  update(
    ownerId: string,
    monitorId: string,
    patch: StoredListingMonitorRow,
  ): Promise<RepositoryResult>;
  delete(ownerId: string, monitorId: string): Promise<RepositoryResult>;
}>;

export type ListingMonitorConsumerRepository = Readonly<{
  listActivePage(offset: number, limit: number): Promise<RepositoryResult>;
}>;

export class ListingMonitorPersistenceError extends Error {
  readonly code:
    | "listing_monitor_invalid"
    | "listing_monitor_not_found"
    | "listing_monitor_read_failed"
    | "listing_monitor_write_failed";
  readonly details: readonly string[];

  constructor(
    code: ListingMonitorPersistenceError["code"],
    message: string,
    details: readonly string[] = [],
  ) {
    super(message);
    this.name = "ListingMonitorPersistenceError";
    this.code = code;
    this.details = details;
  }
}

export async function createListingMonitor(
  input: Readonly<{
    ownerId: string;
    conditions: unknown;
    isActive?: boolean;
  }>,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitor> {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const conditions = requireCanonicalListingConditions(input.conditions);
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    throw invalidMonitor("isActive must be a boolean", ["is_active_invalid"]);
  }
  const resolved = await resolveRepository(repository);
  const result = await resolved.create({
    user_id: ownerId,
    domain: "listing",
    conditions,
    is_active: input.isActive ?? true,
  });
  return requireMutationMonitor(result, ownerId, "create");
}

export async function listListingMonitorsForOwner(
  ownerId: string,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitorListResult> {
  return listOwnedMonitors(ownerId, false, repository);
}

export async function listActiveListingMonitorsForOwner(
  ownerId: string,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitorListResult> {
  return listOwnedMonitors(ownerId, true, repository);
}

/**
 * Internal service-only read for the post-canonical Listing consumer. This is
 * intentionally not owner-parameterized and is not connected to a public API.
 * Stored rows still pass the same fail-closed Persistence V1 validation used by
 * owner reads, and pagination avoids silently dropping monitors at the Data API
 * row limit.
 */
export async function listActiveListingMonitorsForConsumer(
  repository?: ListingMonitorConsumerRepository,
): Promise<ListingMonitorListResult> {
  const resolved = repository || await resolveConsumerRepository();
  const monitors: ListingMonitor[] = [];
  const diagnostics: ListingMonitorDiagnostic[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    const result = await resolved.listActivePage(offset, pageSize);
    assertRepositoryResult(result, "active Listing monitor consumer list", "listing_monitor_read_failed");
    const rows = readRows(result.data);
    for (const row of rows) {
      const ownerId = typeof row.user_id === "string" ? row.user_id : "";
      const parsed = parseStoredMonitor(row, ownerId);
      if (parsed.ok) {
        if (parsed.monitor.isActive) monitors.push(parsed.monitor);
      } else {
        diagnostics.push(parsed.diagnostic);
      }
    }
    if (rows.length < pageSize) break;
  }

  return { monitors, diagnostics };
}

export async function readListingMonitorForOwner(
  ownerIdValue: string,
  monitorIdValue: string,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitorReadResult> {
  const ownerId = requireUuid(ownerIdValue, "ownerId");
  const monitorId = requireUuid(monitorIdValue, "monitorId");
  const resolved = await resolveRepository(repository);
  const result = await resolved.read(ownerId, monitorId);
  assertRepositoryResult(result, "listing monitor read", "listing_monitor_read_failed");
  const row = readRows(result.data).find((candidate) => candidate.user_id === ownerId);
  if (!row) return { status: "not_found" };
  const parsed = parseStoredMonitor(row, ownerId);
  return parsed.ok
    ? { status: "available", monitor: parsed.monitor }
    : { status: "invalid", diagnostic: parsed.diagnostic };
}

export async function updateListingMonitor(
  input: Readonly<{
    ownerId: string;
    monitorId: string;
    conditions?: unknown;
    isActive?: boolean;
  }>,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitor> {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const monitorId = requireUuid(input.monitorId, "monitorId");
  if (input.conditions === undefined && input.isActive === undefined) {
    throw invalidMonitor("A Listing monitor update must include conditions or active state", ["update_empty"]);
  }
  const patch: StoredListingMonitorRow = { updated_at: new Date().toISOString() };
  if (input.conditions !== undefined) {
    patch.conditions = requireCanonicalListingConditions(input.conditions);
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") {
      throw invalidMonitor("isActive must be a boolean", ["is_active_invalid"]);
    }
    patch.is_active = input.isActive;
  }
  const resolved = await resolveRepository(repository);
  const result = await resolved.update(ownerId, monitorId, patch);
  return requireMutationMonitor(result, ownerId, "update");
}

export function pauseListingMonitor(
  ownerId: string,
  monitorId: string,
  repository?: ListingMonitorRepository,
) {
  return updateListingMonitor({ ownerId, monitorId, isActive: false }, repository);
}

export function resumeListingMonitor(
  ownerId: string,
  monitorId: string,
  repository?: ListingMonitorRepository,
) {
  return updateListingMonitor({ ownerId, monitorId, isActive: true }, repository);
}

export async function deleteListingMonitor(
  ownerIdValue: string,
  monitorIdValue: string,
  repository?: ListingMonitorRepository,
): Promise<boolean> {
  const ownerId = requireUuid(ownerIdValue, "ownerId");
  const monitorId = requireUuid(monitorIdValue, "monitorId");
  const resolved = await resolveRepository(repository);
  const result = await resolved.delete(ownerId, monitorId);
  assertRepositoryResult(result, "listing monitor delete", "listing_monitor_write_failed");
  return readRows(result.data).some((row) => row.user_id === ownerId && row.id === monitorId);
}

export function validateCanonicalListingConditions(value: unknown): Readonly<{
  ok: boolean;
  conditions: readonly CanonicalListingMonitorCondition[];
  errors: readonly string[];
}> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, conditions: [], errors: ["condition_set_empty"] };
  }
  const conditions: CanonicalListingMonitorCondition[] = [];
  const errors: string[] = [];
  value.forEach((candidate, index) => {
    if (!record(candidate)) {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    const keys = Object.keys(candidate).sort();
    if (keys.length !== 3 || keys[0] !== "key" || keys[1] !== "operator" || keys[2] !== "value") {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    const validationError = validateMonitorConditionInput(candidate)[0];
    if (validationError) {
      errors.push(`conditions[${index}]:${validationError}`);
      return;
    }
    const key = candidate.key as string;
    const definition = getReadyMonitorCondition(key);
    if (!definition || definition.family !== "listing") {
      errors.push(`conditions[${index}]:condition_key_unknown`);
      return;
    }
    conditions.push(Object.freeze({
      key,
      operator: candidate.operator as MonitorConditionOperator,
      value: cloneCanonicalValue(candidate.value),
    }));
  });
  return {
    ok: errors.length === 0,
    conditions: errors.length === 0 ? Object.freeze(conditions) : [],
    errors: Object.freeze(errors),
  };
}

async function listOwnedMonitors(
  ownerIdValue: string,
  activeOnly: boolean,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitorListResult> {
  const ownerId = requireUuid(ownerIdValue, "ownerId");
  const resolved = await resolveRepository(repository);
  const result = await resolved.list(ownerId, activeOnly);
  assertRepositoryResult(result, "listing monitor list", "listing_monitor_read_failed");
  const monitors: ListingMonitor[] = [];
  const diagnostics: ListingMonitorDiagnostic[] = [];
  for (const row of readRows(result.data)) {
    if (row.user_id !== ownerId) continue;
    const parsed = parseStoredMonitor(row, ownerId);
    if (parsed.ok) {
      if (!activeOnly || parsed.monitor.isActive) monitors.push(parsed.monitor);
    } else {
      diagnostics.push(parsed.diagnostic);
    }
  }
  return { monitors, diagnostics };
}

function parseStoredMonitor(
  row: StoredListingMonitorRow,
  ownerId: string,
):
  | Readonly<{ ok: true; monitor: ListingMonitor }>
  | Readonly<{ ok: false; diagnostic: ListingMonitorDiagnostic }> {
  const id = typeof row.id === "string" ? row.id : "unknown";
  const conditionValidation = validateCanonicalListingConditions(row.conditions);
  if (!conditionValidation.ok) {
    return {
      ok: false,
      diagnostic: {
        id,
        reason: "stored_conditions_invalid",
        errors: conditionValidation.errors,
      },
    };
  }
  const errors: string[] = [];
  if (!UUID_PATTERN.test(id)) errors.push("monitor_id_invalid");
  if (!UUID_PATTERN.test(ownerId)) errors.push("owner_invalid");
  if (row.user_id !== ownerId) errors.push("owner_invalid");
  if (row.domain !== "listing") errors.push("domain_invalid");
  if (typeof row.is_active !== "boolean") errors.push("is_active_invalid");
  const createdAt = validTimestamp(row.created_at) ? row.created_at : "";
  const updatedAt = validTimestamp(row.updated_at) ? row.updated_at : "";
  if (!createdAt) errors.push("created_at_invalid");
  if (!updatedAt) errors.push("updated_at_invalid");
  if (errors.length > 0) {
    return {
      ok: false,
      diagnostic: { id, reason: "stored_monitor_invalid", errors },
    };
  }
  return {
    ok: true,
    monitor: Object.freeze({
      id,
      userId: ownerId,
      domain: "listing",
      conditions: conditionValidation.conditions,
      isActive: row.is_active as boolean,
      createdAt,
      updatedAt,
    }),
  };
}

function requireCanonicalListingConditions(value: unknown) {
  const result = validateCanonicalListingConditions(value);
  if (!result.ok) {
    throw invalidMonitor("Listing monitor conditions are invalid under the current Registry", result.errors);
  }
  return result.conditions;
}

function requireMutationMonitor(
  result: RepositoryResult,
  ownerId: string,
  operation: "create" | "update",
) {
  assertRepositoryResult(result, `listing monitor ${operation}`, "listing_monitor_write_failed");
  const row = readRows(result.data).find((candidate) => candidate.user_id === ownerId);
  if (!row) {
    throw new ListingMonitorPersistenceError(
      "listing_monitor_not_found",
      operation === "update" ? "Listing monitor was not found for this owner" : "Listing monitor was not returned after creation",
    );
  }
  const parsed = parseStoredMonitor(row, ownerId);
  if (!parsed.ok) {
    throw new ListingMonitorPersistenceError(
      "listing_monitor_write_failed",
      "Listing monitor persistence returned an invalid row",
      parsed.diagnostic.errors,
    );
  }
  return parsed.monitor;
}

function assertRepositoryResult(
  result: RepositoryResult,
  label: string,
  code: "listing_monitor_read_failed" | "listing_monitor_write_failed",
) {
  if (!result.ok) {
    throw new ListingMonitorPersistenceError(
      code,
      `Could not complete ${label}: ${result.error || `HTTP ${result.status || 0}`}`,
    );
  }
}

function invalidMonitor(message: string, details: readonly string[]) {
  return new ListingMonitorPersistenceError("listing_monitor_invalid", message, details);
}

async function resolveRepository(repository?: ListingMonitorRepository): Promise<ListingMonitorRepository> {
  if (repository) return repository;
  const supabase = await import("../supabase.ts");
  const fields = "id,user_id,domain,conditions,is_active,created_at,updated_at";
  return {
    create: (row) => supabase.supabaseUpsert("listing_monitors", row, {
      prefer: "return=representation",
    }),
    list: (ownerId, activeOnly) => supabase.supabaseSelect("listing_monitors", {
      select: fields,
      user_id: `eq.${ownerId}`,
      domain: "eq.listing",
      ...(activeOnly ? { is_active: "eq.true" } : {}),
      order: "created_at.desc,id.desc",
      limit: "1000",
    }),
    read: (ownerId, monitorId) => supabase.supabaseSelect("listing_monitors", {
      select: fields,
      id: `eq.${monitorId}`,
      user_id: `eq.${ownerId}`,
      domain: "eq.listing",
      limit: "1",
    }),
    update: (ownerId, monitorId, row) => supabase.supabaseUpdate(
      "listing_monitors",
      { id: `eq.${monitorId}`, user_id: `eq.${ownerId}`, domain: "eq.listing" },
      row,
    ),
    delete: (ownerId, monitorId) => supabase.supabaseDelete("listing_monitors", {
      id: `eq.${monitorId}`,
      user_id: `eq.${ownerId}`,
      domain: "eq.listing",
    }),
  };
}

async function resolveConsumerRepository(): Promise<ListingMonitorConsumerRepository> {
  const supabase = await import("../supabase.ts");
  const fields = "id,user_id,domain,conditions,is_active,created_at,updated_at";
  return {
    listActivePage: (offset, limit) => supabase.supabaseSelect("listing_monitors", {
      select: fields,
      domain: "eq.listing",
      is_active: "eq.true",
      order: "created_at.asc,id.asc",
      offset: String(offset),
      limit: String(limit),
    }),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(normalized)) {
    throw invalidMonitor(`${label} must be a UUID`, [`${label}_invalid`]);
  }
  return normalized;
}

function cloneCanonicalValue(value: unknown): unknown {
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function readRows(value: unknown): StoredListingMonitorRow[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
