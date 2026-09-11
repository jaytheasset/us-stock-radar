import { compareExactDecimals } from "./periodicFinancialMonitor.ts";
import {
  getReadyMonitorCondition,
  validateMonitorConditionInput,
  type MonitorConditionOperator,
} from "./conditionRegistry.ts";

type RepositoryResult = Readonly<{ ok: boolean; status?: number; data: unknown; error?: string }>;
type StoredRow = Record<string, unknown>;

export type Sc13MonitorTarget = Readonly<{
  issuerCik: string;
  reportingPersonCik: string;
  securityClass: string;
  cusips: readonly string[];
}>;

export type CanonicalSc13MonitorCondition = Readonly<{
  key: string;
  operator: MonitorConditionOperator;
  value: string;
}>;

export type Sc13Monitor = Readonly<{
  id: string;
  userId: string;
  domain: "sc13";
  target: Sc13MonitorTarget;
  conditions: readonly CanonicalSc13MonitorCondition[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type Sc13MonitorDiagnostic = Readonly<{
  id: string;
  reason: "stored_target_invalid" | "stored_conditions_invalid" | "stored_monitor_invalid";
  errors: readonly string[];
}>;

export type Sc13MonitorListResult = Readonly<{
  monitors: readonly Sc13Monitor[];
  diagnostics: readonly Sc13MonitorDiagnostic[];
}>;

export type Sc13MonitorRepository = Readonly<{
  create(row: StoredRow): Promise<RepositoryResult>;
  list(ownerId: string): Promise<RepositoryResult>;
}>;

export type Sc13MonitorConsumerRepository = Readonly<{
  listActivePage(issuerCik: string, offset: number, limit: number): Promise<RepositoryResult>;
}>;

export class Sc13MonitorPersistenceError extends Error {
  readonly code: "sc13_monitor_invalid" | "sc13_monitor_read_failed" | "sc13_monitor_write_failed";
  readonly details: readonly string[];
  constructor(code: Sc13MonitorPersistenceError["code"], message: string, details: readonly string[] = []) {
    super(message);
    this.name = "Sc13MonitorPersistenceError";
    this.code = code;
    this.details = details;
  }
}

export async function createSc13Monitor(
  input: Readonly<{ ownerId: string; target: unknown; conditions: unknown; isActive?: boolean }>,
  repository?: Sc13MonitorRepository,
) {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const target = validateSc13MonitorTarget(input.target);
  const conditions = validateCanonicalSc13Conditions(input.conditions);
  const errors = [...target.errors, ...conditions.errors];
  if (errors.length) throw invalidMonitor(errors);
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") throw invalidMonitor(["is_active_invalid"]);
  const canonicalTarget = target.target!;
  const resolved = repository || await resolveRepository();
  const result = await resolved.create({
    user_id: ownerId,
    domain: "sc13",
    issuer_cik: canonicalTarget.issuerCik,
    reporting_person_cik: canonicalTarget.reportingPersonCik,
    security_class: canonicalTarget.securityClass,
    cusips: canonicalTarget.cusips,
    conditions: conditions.conditions,
    is_active: input.isActive ?? true,
  });
  assertResult(result, "sc13_monitor_write_failed");
  if (!Array.isArray(result.data)) throw new Sc13MonitorPersistenceError("sc13_monitor_write_failed", "SC13 monitor write response is invalid");
  const parsed = parseStoredMonitor(rows(result.data).find((row) => row.user_id === ownerId), ownerId);
  if (!parsed.ok) throw new Sc13MonitorPersistenceError("sc13_monitor_write_failed", "SC13 monitor persistence returned an invalid row", parsed.diagnostic.errors);
  return parsed.monitor;
}

export async function listSc13MonitorsForOwner(ownerIdValue: string, repository?: Sc13MonitorRepository): Promise<Sc13MonitorListResult> {
  const ownerId = requireUuid(ownerIdValue, "ownerId");
  const resolved = repository || await resolveRepository();
  const result = await resolved.list(ownerId);
  assertResult(result, "sc13_monitor_read_failed");
  if (!Array.isArray(result.data)) throw new Sc13MonitorPersistenceError("sc13_monitor_read_failed", "SC13 monitor read response is invalid");
  return parseRows(rows(result.data), ownerId);
}

export async function listActiveSc13MonitorsForConsumer(
  issuerCikValue: string,
  repository?: Sc13MonitorConsumerRepository,
): Promise<Sc13MonitorListResult> {
  const issuerCik = normalizeSc13Cik(issuerCikValue);
  if (!issuerCik) throw invalidMonitor(["issuer_cik_invalid"]);
  const resolved = repository || await resolveConsumerRepository();
  const monitors: Sc13Monitor[] = [];
  const diagnostics: Sc13MonitorDiagnostic[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const result = await resolved.listActivePage(issuerCik, offset, pageSize);
    assertResult(result, "sc13_monitor_read_failed");
    if (!Array.isArray(result.data)) throw new Sc13MonitorPersistenceError("sc13_monitor_read_failed", "SC13 monitor consumer read response is invalid");
    const page = rows(result.data);
    for (const row of page) {
      const parsed = parseStoredMonitor(row, text(row.user_id));
      if (parsed.ok) monitors.push(parsed.monitor);
      else diagnostics.push(parsed.diagnostic);
    }
    if (page.length < pageSize) break;
  }
  return { monitors, diagnostics };
}

export function validateSc13MonitorTarget(value: unknown): Readonly<{
  ok: boolean; target: Sc13MonitorTarget | null; errors: readonly string[];
}> {
  if (!record(value) || sortedKeys(value) !== "cusips,issuerCik,reportingPersonCik,securityClass") {
    return { ok: false, target: null, errors: ["target_invalid"] };
  }
  const issuerCik = normalizeSc13Cik(value.issuerCik);
  const reportingPersonCik = normalizeSc13Cik(value.reportingPersonCik);
  const securityClass = normalizeSc13SecurityClass(value.securityClass);
  const cusips = normalizeSc13Cusips(value.cusips);
  const errors: string[] = [];
  if (!issuerCik) errors.push("issuer_cik_invalid");
  if (!reportingPersonCik) errors.push("reporting_person_cik_invalid");
  if (!securityClass) errors.push("security_class_invalid");
  if (!cusips) errors.push("cusips_invalid");
  return errors.length ? { ok: false, target: null, errors } : {
    ok: true,
    target: Object.freeze({ issuerCik, reportingPersonCik, securityClass, cusips: Object.freeze(cusips!) }),
    errors: [],
  };
}

export function validateCanonicalSc13Conditions(value: unknown): Readonly<{
  ok: boolean; conditions: readonly CanonicalSc13MonitorCondition[]; errors: readonly string[];
}> {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, conditions: [], errors: ["condition_set_empty"] };
  const conditions: CanonicalSc13MonitorCondition[] = [];
  const errors: string[] = [];
  const keys = new Set<string>();
  value.forEach((candidate, index) => {
    if (!record(candidate) || sortedKeys(candidate) !== "key,operator,value") {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    const key = text(candidate.key);
    const validationError = validateMonitorConditionInput(candidate)[0];
    const definition = getReadyMonitorCondition(key);
    if (validationError || definition?.family !== "sc13" || !definition.monitorDomains?.includes("sc13")) {
      errors.push(`conditions[${index}]:${validationError || "condition_key_unknown"}`);
      return;
    }
    if (keys.has(key)) {
      errors.push(`conditions[${index}]:condition_key_duplicate`);
      return;
    }
    const threshold = text(candidate.value);
    if (!validSc13Decimal(key, threshold)) {
      errors.push(`conditions[${index}]:condition_value_out_of_range`);
      return;
    }
    keys.add(key);
    conditions.push(Object.freeze({ key, operator: candidate.operator as MonitorConditionOperator, value: threshold }));
  });
  return { ok: errors.length === 0, conditions: errors.length ? [] : Object.freeze(conditions), errors };
}

export function normalizeSc13Cik(value: unknown) {
  const candidate = text(value);
  return /^\d{1,10}$/.test(candidate) ? candidate.padStart(10, "0") : "";
}

export function normalizeSc13SecurityClass(value: unknown) {
  const candidate = text(value).replace(/\s+/g, " ").toUpperCase();
  return candidate.length > 0 && candidate.length <= 200 ? candidate : "";
}

export function normalizeSc13Cusips(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const normalized = [...new Set(value.map((item) => text(item).toUpperCase()))].sort();
  return normalized.length > 0 && normalized.every((item) => /^[A-Z0-9]{9}$/.test(item)) ? normalized : null;
}

function validSc13Decimal(key: string, value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
  if (key === "sc13.percent_of_class") return compareExactDecimals(value, "100") <= 0;
  return true;
}

function parseRows(input: readonly StoredRow[], ownerId: string): Sc13MonitorListResult {
  const monitors: Sc13Monitor[] = [];
  const diagnostics: Sc13MonitorDiagnostic[] = [];
  for (const row of input) {
    if (row.user_id !== ownerId) continue;
    const parsed = parseStoredMonitor(row, ownerId);
    if (parsed.ok) monitors.push(parsed.monitor);
    else diagnostics.push(parsed.diagnostic);
  }
  return { monitors, diagnostics };
}

function parseStoredMonitor(row: StoredRow | undefined, ownerId: string):
  | Readonly<{ ok: true; monitor: Sc13Monitor }>
  | Readonly<{ ok: false; diagnostic: Sc13MonitorDiagnostic }> {
  const id = text(row?.id) || "unknown";
  const target = validateSc13MonitorTarget({
    issuerCik: row?.issuer_cik,
    reportingPersonCik: row?.reporting_person_cik,
    securityClass: row?.security_class,
    cusips: row?.cusips,
  });
  if (!target.ok) return { ok: false, diagnostic: { id, reason: "stored_target_invalid", errors: target.errors } };
  const conditions = validateCanonicalSc13Conditions(row?.conditions);
  if (!conditions.ok) return { ok: false, diagnostic: { id, reason: "stored_conditions_invalid", errors: conditions.errors } };
  const errors: string[] = [];
  if (!UUID_PATTERN.test(id)) errors.push("monitor_id_invalid");
  if (!UUID_PATTERN.test(ownerId) || row?.user_id !== ownerId) errors.push("owner_invalid");
  if (row?.domain !== "sc13") errors.push("domain_invalid");
  if (typeof row?.is_active !== "boolean") errors.push("is_active_invalid");
  const createdAt = validTimestamp(row?.created_at), updatedAt = validTimestamp(row?.updated_at);
  if (!createdAt) errors.push("created_at_invalid");
  if (!updatedAt) errors.push("updated_at_invalid");
  if (errors.length) return { ok: false, diagnostic: { id, reason: "stored_monitor_invalid", errors } };
  return { ok: true, monitor: Object.freeze({
    id, userId: ownerId, domain: "sc13", target: target.target!, conditions: conditions.conditions,
    isActive: row!.is_active as boolean, createdAt, updatedAt,
  }) };
}

async function resolveRepository(): Promise<Sc13MonitorRepository> {
  const supabase = await import("../supabase.ts");
  const select = "id,user_id,domain,issuer_cik,reporting_person_cik,security_class,cusips,conditions,is_active,created_at,updated_at";
  return {
    create: (row) => supabase.supabaseUpsert("sc13_monitors", row, { prefer: "return=representation" }),
    list: (ownerId) => supabase.supabaseSelect("sc13_monitors", { select, user_id: `eq.${ownerId}`, domain: "eq.sc13", order: "created_at.desc,id.desc", limit: "1000" }),
  };
}

async function resolveConsumerRepository(): Promise<Sc13MonitorConsumerRepository> {
  const supabase = await import("../supabase.ts");
  return { listActivePage: (issuerCik, offset, limit) => supabase.supabaseSelect("sc13_monitors", {
    select: "id,user_id,domain,issuer_cik,reporting_person_cik,security_class,cusips,conditions,is_active,created_at,updated_at",
    domain: "eq.sc13", issuer_cik: `eq.${issuerCik}`, is_active: "eq.true", order: "created_at.asc,id.asc",
    offset: String(offset), limit: String(limit),
  }) };
}

function invalidMonitor(details: readonly string[]) { return new Sc13MonitorPersistenceError("sc13_monitor_invalid", "SC13 monitor target or conditions are invalid", details); }
function assertResult(result: RepositoryResult, code: "sc13_monitor_read_failed" | "sc13_monitor_write_failed") { if (!result.ok) throw new Sc13MonitorPersistenceError(code, result.error || `HTTP ${result.status || 0}`); }
function requireUuid(value: string, label: string) { const normalized = text(value); if (!UUID_PATTERN.test(normalized)) throw invalidMonitor([`${label}_invalid`]); return normalized; }
function validTimestamp(value: unknown) { const candidate = text(value); return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : ""; }
function sortedKeys(value: Record<string, unknown>) { return Object.keys(value).sort().join(","); }
function rows(value: unknown): StoredRow[] { return Array.isArray(value) ? value.filter(record) : []; }
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
