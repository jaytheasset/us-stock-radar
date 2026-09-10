import {
  getReadyMonitorCondition,
  validateMonitorConditionInput,
  type MonitorConditionOperator,
} from "./conditionRegistry.ts";

type RepositoryResult = Readonly<{ ok: boolean; status?: number; data: unknown; error?: string }>;
type StoredRow = Record<string, unknown>;

export type CanonicalFinancialMonitorCondition = Readonly<{
  key: string;
  operator: MonitorConditionOperator;
  value: string;
  currency: string;
}>;

export type FinancialMonitor = Readonly<{
  id: string;
  userId: string;
  domain: "financial";
  conditions: readonly CanonicalFinancialMonitorCondition[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type FinancialMonitorDiagnostic = Readonly<{
  id: string;
  reason: "stored_conditions_invalid" | "stored_monitor_invalid";
  errors: readonly string[];
}>;

export type FinancialMonitorListResult = Readonly<{
  monitors: readonly FinancialMonitor[];
  diagnostics: readonly FinancialMonitorDiagnostic[];
}>;

export type FinancialMonitorRepository = Readonly<{
  create(row: StoredRow): Promise<RepositoryResult>;
  list(ownerId: string): Promise<RepositoryResult>;
}>;

export type FinancialMonitorConsumerRepository = Readonly<{
  listActivePage(offset: number, limit: number): Promise<RepositoryResult>;
}>;

export class FinancialMonitorPersistenceError extends Error {
  readonly code: "financial_monitor_invalid" | "financial_monitor_read_failed" | "financial_monitor_write_failed";
  readonly details: readonly string[];
  constructor(
    code: "financial_monitor_invalid" | "financial_monitor_read_failed" | "financial_monitor_write_failed",
    message: string,
    details: readonly string[] = [],
  ) {
    super(message);
    this.name = "FinancialMonitorPersistenceError";
    this.code = code;
    this.details = details;
  }
}

export async function createFinancialMonitor(
  input: Readonly<{ ownerId: string; conditions: unknown; isActive?: boolean }>,
  repository?: FinancialMonitorRepository,
) {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const validation = validateCanonicalFinancialConditions(input.conditions);
  if (!validation.ok) throw invalidMonitor(validation.errors);
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    throw invalidMonitor(["is_active_invalid"]);
  }
  const resolved = repository || await resolveRepository();
  const result = await resolved.create({
    user_id: ownerId,
    domain: "financial",
    conditions: validation.conditions,
    is_active: input.isActive ?? true,
  });
  assertResult(result, "financial_monitor_write_failed");
  const parsed = parseStoredMonitor(rows(result.data).find((row) => row.user_id === ownerId), ownerId);
  if (!parsed.ok) {
    throw new FinancialMonitorPersistenceError(
      "financial_monitor_write_failed",
      "Financial monitor persistence returned an invalid row",
      parsed.diagnostic.errors,
    );
  }
  return parsed.monitor;
}

export async function listFinancialMonitorsForOwner(
  ownerIdValue: string,
  repository?: FinancialMonitorRepository,
): Promise<FinancialMonitorListResult> {
  const ownerId = requireUuid(ownerIdValue, "ownerId");
  const resolved = repository || await resolveRepository();
  const result = await resolved.list(ownerId);
  assertResult(result, "financial_monitor_read_failed");
  return parseRows(rows(result.data), ownerId);
}

export async function listActiveFinancialMonitorsForConsumer(
  repository?: FinancialMonitorConsumerRepository,
): Promise<FinancialMonitorListResult> {
  const resolved = repository || await resolveConsumerRepository();
  const monitors: FinancialMonitor[] = [];
  const diagnostics: FinancialMonitorDiagnostic[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const result = await resolved.listActivePage(offset, pageSize);
    assertResult(result, "financial_monitor_read_failed");
    const page = rows(result.data);
    for (const row of page) {
      const ownerId = text(row.user_id);
      const parsed = parseStoredMonitor(row, ownerId);
      if (parsed.ok) monitors.push(parsed.monitor);
      else diagnostics.push(parsed.diagnostic);
    }
    if (page.length < pageSize) break;
  }
  return { monitors, diagnostics };
}

export function validateCanonicalFinancialConditions(value: unknown): Readonly<{
  ok: boolean;
  conditions: readonly CanonicalFinancialMonitorCondition[];
  errors: readonly string[];
}> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, conditions: [], errors: ["condition_set_empty"] };
  }
  const conditions: CanonicalFinancialMonitorCondition[] = [];
  const errors: string[] = [];
  value.forEach((candidate, index) => {
    if (!record(candidate) || Object.keys(candidate).sort().join(",") !== "currency,key,operator,value") {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    const validationError = validateMonitorConditionInput(candidate)[0];
    const definition = getReadyMonitorCondition(text(candidate.key));
    if (validationError || definition?.family !== "financial" || !definition.monitorDomains?.includes("financial")) {
      errors.push(`conditions[${index}]:${validationError || "condition_key_unknown"}`);
      return;
    }
    const currency = text(candidate.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push(`conditions[${index}]:currency_required`);
      return;
    }
    conditions.push(Object.freeze({
      key: text(candidate.key),
      operator: candidate.operator as MonitorConditionOperator,
      value: text(candidate.value),
      currency,
    }));
  });
  return { ok: errors.length === 0, conditions: errors.length ? [] : Object.freeze(conditions), errors };
}

function parseRows(input: readonly StoredRow[], ownerId: string) {
  const monitors: FinancialMonitor[] = [];
  const diagnostics: FinancialMonitorDiagnostic[] = [];
  for (const row of input) {
    if (row.user_id !== ownerId) continue;
    const parsed = parseStoredMonitor(row, ownerId);
    if (parsed.ok) monitors.push(parsed.monitor);
    else diagnostics.push(parsed.diagnostic);
  }
  return { monitors, diagnostics };
}

function parseStoredMonitor(row: StoredRow | undefined, ownerId: string):
  | Readonly<{ ok: true; monitor: FinancialMonitor }>
  | Readonly<{ ok: false; diagnostic: FinancialMonitorDiagnostic }> {
  const id = text(row?.id) || "unknown";
  const validation = validateCanonicalFinancialConditions(row?.conditions);
  if (!validation.ok) {
    return { ok: false, diagnostic: { id, reason: "stored_conditions_invalid", errors: validation.errors } };
  }
  const errors: string[] = [];
  if (!UUID_PATTERN.test(id)) errors.push("monitor_id_invalid");
  if (!UUID_PATTERN.test(ownerId) || row?.user_id !== ownerId) errors.push("owner_invalid");
  if (row?.domain !== "financial") errors.push("domain_invalid");
  if (typeof row?.is_active !== "boolean") errors.push("is_active_invalid");
  const createdAt = validTimestamp(row?.created_at);
  const updatedAt = validTimestamp(row?.updated_at);
  if (!createdAt) errors.push("created_at_invalid");
  if (!updatedAt) errors.push("updated_at_invalid");
  if (errors.length) return { ok: false, diagnostic: { id, reason: "stored_monitor_invalid", errors } };
  return {
    ok: true,
    monitor: Object.freeze({
      id,
      userId: ownerId,
      domain: "financial",
      conditions: validation.conditions,
      isActive: row!.is_active as boolean,
      createdAt,
      updatedAt,
    }),
  };
}

async function resolveRepository(): Promise<FinancialMonitorRepository> {
  const supabase = await import("../supabase.ts");
  const select = "id,user_id,domain,conditions,is_active,created_at,updated_at";
  return {
    create: (row) => supabase.supabaseUpsert("financial_monitors", row, { prefer: "return=representation" }),
    list: (ownerId) => supabase.supabaseSelect("financial_monitors", {
      select, user_id: `eq.${ownerId}`, domain: "eq.financial",
      order: "created_at.desc,id.desc", limit: "1000",
    }),
  };
}

async function resolveConsumerRepository(): Promise<FinancialMonitorConsumerRepository> {
  const supabase = await import("../supabase.ts");
  return {
    listActivePage: (offset, limit) => supabase.supabaseSelect("financial_monitors", {
      select: "id,user_id,domain,conditions,is_active,created_at,updated_at",
      domain: "eq.financial", is_active: "eq.true", order: "created_at.asc,id.asc",
      offset: String(offset), limit: String(limit),
    }),
  };
}

function invalidMonitor(details: readonly string[]) {
  return new FinancialMonitorPersistenceError(
    "financial_monitor_invalid",
    "Financial monitor conditions are invalid under the current Registry",
    details,
  );
}

function assertResult(result: RepositoryResult, code: "financial_monitor_read_failed" | "financial_monitor_write_failed") {
  if (!result.ok) throw new FinancialMonitorPersistenceError(code, result.error || `HTTP ${result.status || 0}`);
}

function requireUuid(value: string, label: string) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) throw invalidMonitor([`${label}_invalid`]);
  return normalized;
}

function validTimestamp(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : "";
}
function rows(value: unknown): StoredRow[] { return Array.isArray(value) ? value.filter(record) : []; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
