import {conditionErrors as sec425ConditionErrors} from "../sec425/conditions.ts";
import {offeringPlanConditionErrors} from './offeringPlanConditions.ts';
import { hasEffect, effectConditionErrors } from "../sec-effect/conditions.ts";
import {
  getReadyMonitorCondition,
  getStoredMonitorCondition,
  hasRetiredMonitorConditions,
  validateStoredMonitorConditionInput,
  validateMonitorConditionInput,
  type MonitorConditionOperator,
} from "./conditionRegistry.ts";
import {
  buildForm4InsiderPurchaseConditions,
  FORM4_INSIDER_PURCHASE_MONITOR_KIND,
  parseForm4InsiderPurchaseSettings,
  type Form4InsiderPurchaseSettings,
} from "./form4InsiderPurchaseMonitor.ts";

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
  kind?: "condition_set" | typeof FORM4_INSIDER_PURCHASE_MONITOR_KIND;
  conditions: readonly CanonicalListingMonitorCondition[];
  form4PurchaseSettings?: Form4InsiderPurchaseSettings;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type ListingMonitorDiagnostic = Readonly<{
  id: string;
  reason: "stored_conditions_invalid" | "stored_monitor_invalid" | "stored_conditions_retired";
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
    kind?: "condition_set" | typeof FORM4_INSIDER_PURCHASE_MONITOR_KIND;
    form4PurchaseSettings?: unknown;
    isActive?: boolean;
  }>,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitor> {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const conditions = requireCanonicalListingConditions(input.conditions);
  if (hasEffect(conditions)) await requireEffectTarget(conditions);
  const kind = input.kind ?? "condition_set";
  const form4PurchaseSettings = requireMonitorKindSettings(kind, input.form4PurchaseSettings, conditions);
  if (input.isActive !== undefined && typeof input.isActive !== "boolean") {
    throw invalidMonitor("isActive must be a boolean", ["is_active_invalid"]);
  }
  const resolved = await resolveRepository(repository);
  const result = await resolved.create({
    user_id: ownerId,
    domain: "listing",
    monitor_kind: kind,
    conditions,
    form4_purchase_settings: form4PurchaseSettings ?? null,
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
        if (hasRetiredMonitorConditions(parsed.monitor.conditions)) {
          diagnostics.push({id:parsed.monitor.id,reason:'stored_conditions_retired',errors:['condition_key_retired']});
        } else if (parsed.monitor.isActive) monitors.push(parsed.monitor);
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
    form4PurchaseSettings?: unknown;
    isActive?: boolean;
  }>,
  repository?: ListingMonitorRepository,
): Promise<ListingMonitor> {
  const ownerId = requireUuid(input.ownerId, "ownerId");
  const monitorId = requireUuid(input.monitorId, "monitorId");
  if (input.conditions === undefined && input.form4PurchaseSettings === undefined && input.isActive === undefined) {
    throw invalidMonitor("A Listing monitor update must include conditions or active state", ["update_empty"]);
  }
  const resolved = await resolveRepository(repository);
  const stored = await readStoredListingMonitorForMutation(resolved, ownerId, monitorId);
  if (!stored) {
    throw new ListingMonitorPersistenceError(
      "listing_monitor_not_found",
      "Listing monitor was not found for this owner",
    );
  }
  // Retired records remain owner-readable and pausable, but cannot be reused or resumed.
  if (hasRetiredMonitorConditions(stored.conditions)
    && (input.isActive === true || input.conditions !== undefined || input.form4PurchaseSettings !== undefined)) {
    throw invalidMonitor('This historical condition set has been retired.', ['condition_key_retired']);
  }
  const storedKind = stored.monitor_kind === FORM4_INSIDER_PURCHASE_MONITOR_KIND
    ? FORM4_INSIDER_PURCHASE_MONITOR_KIND
    : "condition_set";
  if (hasEffect(stored.conditions as CanonicalListingMonitorCondition[]) && input.conditions !== undefined
    && !hasEffect(input.conditions as CanonicalListingMonitorCondition[])) {
    throw invalidMonitor("An EFFECT monitor must retain its registration target. Delete the monitor to stop watching it.", ["effect_target_removal_forbidden"]);
  }
  if (input.conditions !== undefined) {
    const nextConditions = requireCanonicalListingConditions(input.conditions);
    if (hasEffect(nextConditions)) await requireEffectTarget(nextConditions);
  }
  if (storedKind === FORM4_INSIDER_PURCHASE_MONITOR_KIND && input.conditions !== undefined) {
    throw invalidMonitor("Form 4 purchase settings must be updated through their typed settings", ["form4_purchase_conditions_immutable"]);
  }
  if (storedKind === "condition_set" && input.form4PurchaseSettings !== undefined) {
    throw invalidMonitor("A generic Listing monitor cannot be converted to a Form 4 purchase monitor", ["monitor_kind_immutable"]);
  }
  const patch: StoredListingMonitorRow = { updated_at: new Date().toISOString() };
  if (input.conditions !== undefined) patch.conditions = requireCanonicalListingConditions(input.conditions);
  if (input.form4PurchaseSettings !== undefined) {
    const settings = requireForm4PurchaseSettings(input.form4PurchaseSettings);
    patch.form4_purchase_settings = settings;
    patch.conditions = requireCanonicalListingConditions(buildForm4InsiderPurchaseConditions(settings));
  }
  if (input.isActive !== undefined) {
    if (typeof input.isActive !== "boolean") {
      throw invalidMonitor("isActive must be a boolean", ["is_active_invalid"]);
    }
    patch.is_active = input.isActive;
  }
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
  const stored = await readStoredListingMonitorForMutation(resolved, ownerId, monitorId);
  if (!stored) return false;
  const result = await resolved.delete(ownerId, monitorId);
  assertRepositoryResult(result, "listing monitor delete", "listing_monitor_write_failed");
  return readRows(result.data).some((row) => row.user_id === ownerId && row.id === monitorId);
}

export function validateCanonicalListingConditions(value: unknown, stage: "stored" | "draft" | "history" = "stored"): Readonly<{
  ok: boolean;
  conditions: readonly CanonicalListingMonitorCondition[];
  errors: readonly string[];
}> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, conditions: [], errors: ["condition_set_empty"] };
  }
  const conditions: CanonicalListingMonitorCondition[] = [];
  const errors: string[] = sec425ConditionErrors(value);
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
    const validationError = (stage === 'history' ? validateStoredMonitorConditionInput(candidate) : validateMonitorConditionInput(candidate))[0];
    if (validationError) {
      errors.push(`conditions[${index}]:${validationError}`);
      return;
    }
    const key = candidate.key as string;
    const definition = stage === 'history' ? getStoredMonitorCondition(key) : getReadyMonitorCondition(key);
    if (!definition?.monitorDomains?.includes("listing")) {
      errors.push(`conditions[${index}]:condition_key_unknown`);
      return;
    }
    conditions.push(Object.freeze({
      key,
      operator: candidate.operator as MonitorConditionOperator,
      value: cloneCanonicalValue(candidate.value),
    }));
  });
  if (stage !== "draft") errors.push(...effectConditionErrors(conditions), ...offeringPlanConditionErrors(conditions, stage === 'history'));
  return {
    ok: errors.length === 0,
    conditions: errors.length === 0 ? Object.freeze(conditions) : [],
    errors: Object.freeze(errors),
  };
}

async function requireEffectTarget(conditions: readonly CanonicalListingMonitorCondition[]) {
  try { await (await import("../sec-effect/registration.ts")).verifyRegistrationTarget(conditions); }
  catch { throw invalidMonitor("Registration evidence is unavailable or conflicts with the selected target.", ["effect_target_unverified"]); }
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
  const conditionValidation = validateCanonicalListingConditions(row.conditions, 'history');
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
  const kind = row.monitor_kind === undefined || row.monitor_kind === null || row.monitor_kind === "condition_set"
    ? "condition_set"
    : row.monitor_kind === FORM4_INSIDER_PURCHASE_MONITOR_KIND
      ? FORM4_INSIDER_PURCHASE_MONITOR_KIND
      : null;
  if (!kind) errors.push("monitor_kind_invalid");
  let form4PurchaseSettings: Form4InsiderPurchaseSettings | undefined;
  if (kind === FORM4_INSIDER_PURCHASE_MONITOR_KIND) {
    const parsedSettings = parseForm4InsiderPurchaseSettings(row.form4_purchase_settings);
    if (!parsedSettings.ok) {
      errors.push(...parsedSettings.errors);
    } else {
      form4PurchaseSettings = parsedSettings.value;
      const expected = requireCanonicalListingConditions(buildForm4InsiderPurchaseConditions(parsedSettings.value));
      if (!canonicalConditionsEqual(conditionValidation.conditions, expected)) {
        errors.push("form4_purchase_conditions_invalid");
      }
    }
  } else if (row.form4_purchase_settings !== undefined && row.form4_purchase_settings !== null) {
    errors.push("form4_purchase_settings_unexpected");
  }
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
      kind: kind!,
      conditions: conditionValidation.conditions,
      ...(form4PurchaseSettings ? { form4PurchaseSettings } : {}),
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

function requireMonitorKindSettings(
  kind: "condition_set" | typeof FORM4_INSIDER_PURCHASE_MONITOR_KIND,
  value: unknown,
  conditions: readonly CanonicalListingMonitorCondition[],
) {
  if (kind === "condition_set") {
    if (value !== undefined && value !== null) {
      throw invalidMonitor("Generic Listing monitors cannot store Form 4 purchase settings", ["form4_purchase_settings_unexpected"]);
    }
    return null;
  }
  const settings = requireForm4PurchaseSettings(value);
  const expected = requireCanonicalListingConditions(buildForm4InsiderPurchaseConditions(settings));
  if (!canonicalConditionsEqual(conditions, expected)) {
    throw invalidMonitor("Form 4 purchase conditions do not match their typed settings", ["form4_purchase_conditions_invalid"]);
  }
  return settings;
}

function requireForm4PurchaseSettings(value: unknown) {
  const parsed = parseForm4InsiderPurchaseSettings(value);
  if (!parsed.ok) {
    throw invalidMonitor("Form 4 purchase settings are invalid", parsed.errors);
  }
  return parsed.value;
}

function canonicalConditionsEqual(
  left: readonly CanonicalListingMonitorCondition[],
  right: readonly CanonicalListingMonitorCondition[],
) {
  if (left.length !== right.length) return false;
  return left.every((condition, index) => {
    const expected = right[index];
    return condition.key === expected.key
      && condition.operator === expected.operator
      && JSON.stringify(condition.value) === JSON.stringify(expected.value);
  });
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

async function readStoredListingMonitorForMutation(
  repository: ListingMonitorRepository,
  ownerId: string,
  monitorId: string,
): Promise<StoredListingMonitorRow | null> {
  const result = await repository.read(ownerId, monitorId);
  assertRepositoryResult(result, "listing monitor mutation preflight", "listing_monitor_read_failed");
  const row = readRows(result.data).find((candidate) => candidate.user_id === ownerId);
  if (!row) return null;
  if (containsPrivateSection16Condition(row.conditions)) {
    throw new ListingMonitorPersistenceError(
      "listing_monitor_invalid",
      "Private manual Section 16 conditions cannot be changed through the Listing monitor mutation path",
      ["private_section16_monitor_mutation_forbidden"],
    );
  }
  return row;
}

function containsPrivateSection16Condition(value: unknown) {
  return Array.isArray(value) && value.some((condition) => (
    record(condition)
    && typeof condition.key === "string"
    && condition.key.startsWith("ownership.section16.")
  ));
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
  const fields = "id,user_id,domain,monitor_kind,conditions,form4_purchase_settings,is_active,created_at,updated_at";
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
  const fields = "id,user_id,domain,monitor_kind,conditions,form4_purchase_settings,is_active,created_at,updated_at";
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
