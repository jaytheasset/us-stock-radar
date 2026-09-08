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

type StoredOfferingMonitorRow = Record<string, unknown>;

export type CanonicalOfferingMonitorCondition = Readonly<{
  key: string;
  operator: MonitorConditionOperator;
  value: unknown;
  currency?: string;
  comparisonBasisType?: string;
}>;

export type OfferingMonitor = Readonly<{
  id: string;
  userId: string;
  domain: "offering";
  conditions: readonly CanonicalOfferingMonitorCondition[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type OfferingMonitorDiagnostic = Readonly<{
  id: string;
  reason: "stored_conditions_invalid" | "stored_monitor_invalid";
  errors: readonly string[];
}>;

export type OfferingMonitorListResult = Readonly<{
  monitors: readonly OfferingMonitor[];
  diagnostics: readonly OfferingMonitorDiagnostic[];
}>;

export type OfferingMonitorRepository = Readonly<{
  create(row: StoredOfferingMonitorRow): Promise<RepositoryResult>;
  list(ownerId: string, activeOnly: boolean): Promise<RepositoryResult>;
}>;

export type OfferingMonitorConsumerRepository = Readonly<{
  listActivePage(offset: number, limit: number): Promise<RepositoryResult>;
}>;

export class OfferingMonitorPersistenceError extends Error {
  readonly code:
    | "offering_monitor_invalid"
    | "offering_monitor_read_failed"
    | "offering_monitor_write_failed";
  readonly details: readonly string[];

  constructor(
    code: OfferingMonitorPersistenceError["code"],
    message: string,
    details: readonly string[] = [],
  ) {
    super(message);
    this.name = "OfferingMonitorPersistenceError";
    this.code = code;
    this.details = details;
  }
}

export async function createOfferingMonitor(
  input: Readonly<{ ownerId: string; conditions: unknown; isActive?: boolean }>,
  repository?: OfferingMonitorRepository,
): Promise<OfferingMonitor> {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const validation = validateCanonicalOfferingConditions(input.conditions);
  if (!validation.ok) {
    throw new OfferingMonitorPersistenceError(
      "offering_monitor_invalid",
      "Offering monitor conditions are invalid under the current Registry",
      validation.errors,
    );
  }
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    throw new OfferingMonitorPersistenceError(
      "offering_monitor_invalid",
      "isActive must be a boolean",
      ["is_active_invalid"],
    );
  }
  const resolved = repository || await resolveRepository();
  const result = await resolved.create({
    user_id: ownerId,
    domain: "offering",
    conditions: validation.conditions,
    is_active: input.isActive ?? true,
  });
  assertResult(result, "offering_monitor_write_failed");
  const row = rows(result.data).find((candidate) => candidate.user_id === ownerId);
  if (!row) {
    throw new OfferingMonitorPersistenceError(
      "offering_monitor_write_failed",
      "Offering monitor was not returned after creation",
    );
  }
  const parsed = parseStoredMonitor(row, ownerId);
  if (!parsed.ok) {
    throw new OfferingMonitorPersistenceError(
      "offering_monitor_write_failed",
      "Offering monitor persistence returned an invalid row",
      parsed.diagnostic.errors,
    );
  }
  return parsed.monitor;
}

export async function listOfferingMonitorsForOwner(
  ownerIdValue: string,
  repository?: OfferingMonitorRepository,
): Promise<OfferingMonitorListResult> {
  const ownerId = requireUuid(ownerIdValue, "ownerId");
  const resolved = repository || await resolveRepository();
  const result = await resolved.list(ownerId, false);
  assertResult(result, "offering_monitor_read_failed");
  return parseRows(rows(result.data), ownerId, false);
}

export async function listActiveOfferingMonitorsForConsumer(
  repository?: OfferingMonitorConsumerRepository,
): Promise<OfferingMonitorListResult> {
  const resolved = repository || await resolveConsumerRepository();
  const monitors: OfferingMonitor[] = [];
  const diagnostics: OfferingMonitorDiagnostic[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const result = await resolved.listActivePage(offset, pageSize);
    assertResult(result, "offering_monitor_read_failed");
    const page = rows(result.data);
    for (const row of page) {
      const ownerId = stringValue(row.user_id);
      const parsed = parseStoredMonitor(row, ownerId);
      if (parsed.ok) {
        if (parsed.monitor.isActive) monitors.push(parsed.monitor);
      } else {
        diagnostics.push(parsed.diagnostic);
      }
    }
    if (page.length < pageSize) break;
  }
  return { monitors, diagnostics };
}

export function validateCanonicalOfferingConditions(value: unknown): Readonly<{
  ok: boolean;
  conditions: readonly CanonicalOfferingMonitorCondition[];
  errors: readonly string[];
}> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, conditions: [], errors: ["condition_set_empty"] };
  }
  const conditions: CanonicalOfferingMonitorCondition[] = [];
  const errors: string[] = [];
  value.forEach((candidate, index) => {
    if (!record(candidate)) {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    const baseError = validateMonitorConditionInput(candidate)[0];
    if (baseError) {
      errors.push(`conditions[${index}]:${baseError}`);
      return;
    }
    const key = stringValue(candidate.key);
    const definition = getReadyMonitorCondition(key);
    if (definition?.family !== "offering") {
      errors.push(`conditions[${index}]:condition_key_unknown`);
      return;
    }
    const numeric = definition.valueType === "number";
    const currencyRequired = key === "offering.amount" || key === "offering.offering_price";
    const allowedKeys = new Set([
      "key",
      "operator",
      "value",
      ...(currencyRequired ? ["currency"] : []),
      ...(numeric ? ["comparisonBasisType"] : []),
    ]);
    if (Object.keys(candidate).some((candidateKey) => !allowedKeys.has(candidateKey))) {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    if (numeric && (typeof candidate.value !== "number" || candidate.value < 0)) {
      errors.push(`conditions[${index}]:condition_value_invalid`);
      return;
    }
    const currency = stringValue(candidate.currency).toUpperCase();
    if (currencyRequired && !/^[A-Z]{3}$/.test(currency)) {
      errors.push(`conditions[${index}]:currency_required`);
      return;
    }
    const expectedBasis = comparisonBasisForKey(key);
    const requestedBasis = stringValue(candidate.comparisonBasisType);
    if (requestedBasis && requestedBasis !== expectedBasis) {
      errors.push(`conditions[${index}]:basis_incompatible`);
      return;
    }
    conditions.push(Object.freeze({
      key,
      operator: candidate.operator as MonitorConditionOperator,
      value: cloneValue(candidate.value),
      ...(currencyRequired ? { currency } : {}),
      ...(requestedBasis ? { comparisonBasisType: requestedBasis } : {}),
    }));
  });
  return { ok: errors.length === 0, conditions: errors.length ? [] : conditions, errors };
}

function parseRows(input: readonly StoredOfferingMonitorRow[], ownerId: string, activeOnly: boolean) {
  const monitors: OfferingMonitor[] = [];
  const diagnostics: OfferingMonitorDiagnostic[] = [];
  for (const row of input) {
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
  row: StoredOfferingMonitorRow,
  ownerId: string,
): Readonly<{ ok: true; monitor: OfferingMonitor }> | Readonly<{
  ok: false;
  diagnostic: OfferingMonitorDiagnostic;
}> {
  const id = stringValue(row.id) || "unknown";
  const validation = validateCanonicalOfferingConditions(row.conditions);
  if (!validation.ok) {
    return {
      ok: false,
      diagnostic: { id, reason: "stored_conditions_invalid", errors: validation.errors },
    };
  }
  const errors: string[] = [];
  if (!UUID_PATTERN.test(id)) errors.push("monitor_id_invalid");
  if (!UUID_PATTERN.test(ownerId) || row.user_id !== ownerId) errors.push("owner_invalid");
  if (row.domain !== "offering") errors.push("domain_invalid");
  if (typeof row.is_active !== "boolean") errors.push("is_active_invalid");
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  if (!createdAt) errors.push("created_at_invalid");
  if (!updatedAt) errors.push("updated_at_invalid");
  if (errors.length) {
    return { ok: false, diagnostic: { id, reason: "stored_monitor_invalid", errors } };
  }
  return {
    ok: true,
    monitor: Object.freeze({
      id,
      userId: ownerId,
      domain: "offering",
      conditions: validation.conditions,
      isActive: row.is_active as boolean,
      createdAt,
      updatedAt,
    }),
  };
}

async function resolveRepository(): Promise<OfferingMonitorRepository> {
  const supabase = await import("../supabase.ts");
  const select = "id,user_id,domain,conditions,is_active,created_at,updated_at";
  return {
    create: (row) => supabase.supabaseUpsert("offering_monitors", row, {
      prefer: "return=representation",
    }),
    list: (ownerId, activeOnly) => supabase.supabaseSelect("offering_monitors", {
      select,
      user_id: `eq.${ownerId}`,
      domain: "eq.offering",
      ...(activeOnly ? { is_active: "eq.true" } : {}),
      order: "created_at.desc,id.desc",
      limit: "1000",
    }),
  };
}

async function resolveConsumerRepository(): Promise<OfferingMonitorConsumerRepository> {
  const supabase = await import("../supabase.ts");
  return {
    listActivePage: (offset, limit) => supabase.supabaseSelect("offering_monitors", {
      select: "id,user_id,domain,conditions,is_active,created_at,updated_at",
      domain: "eq.offering",
      is_active: "eq.true",
      order: "created_at.asc,id.asc",
      offset: String(offset),
      limit: String(limit),
    }),
  };
}

function comparisonBasisForKey(key: string) {
  if (key === "offering.amount") return "market_cap";
  if (key === "offering.offering_price") return "market_price";
  if (key === "offering.resale_share_exposure") return "public_float";
  if (key.includes("share_exposure")) return "shares_outstanding";
  return "";
}

function assertResult(
  result: RepositoryResult,
  code: "offering_monitor_read_failed" | "offering_monitor_write_failed",
) {
  if (!result.ok) {
    throw new OfferingMonitorPersistenceError(
      code,
      result.error || `Offering monitor repository failed with HTTP ${result.status || 0}`,
    );
  }
}

function requireUuid(value: string, label: string) {
  const normalized = stringValue(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw new OfferingMonitorPersistenceError(
      "offering_monitor_invalid",
      `${label} must be a UUID`,
      [`${label}_invalid`],
    );
  }
  return normalized;
}

function cloneValue(value: unknown): unknown {
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}

function timestamp(value: unknown) {
  const candidate = stringValue(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : "";
}

function rows(value: unknown): StoredOfferingMonitorRow[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
