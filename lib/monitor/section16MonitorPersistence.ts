import {
  getSection16MonitorCondition,
  validateSection16MonitorConditionInput,
  type MonitorConditionOperator,
  type Section16MonitorRowFamily,
} from "./conditionRegistry.ts";

type RepositoryResult = Readonly<{
  ok: boolean;
  status?: number;
  data: unknown;
  error?: string;
}>;

type StoredRow = Record<string, unknown>;

export type CanonicalSection16MonitorCondition = Readonly<{
  key: string;
  operator: MonitorConditionOperator;
  value: unknown;
}>;

export type Section16MonitorConditionSet = Readonly<{
  id: string;
  userId: string;
  rowFamily: Section16MonitorRowFamily;
  conditions: readonly CanonicalSection16MonitorCondition[];
  executionMode: "manual_only_no_alerts";
  createdAt: string;
  updatedAt: string;
}>;

export type Section16MonitorConditionSetReadResult =
  | Readonly<{ status: "available"; conditionSet: Section16MonitorConditionSet }>
  | Readonly<{ status: "invalid"; id: string; errors: readonly string[] }>
  | Readonly<{ status: "not_found" }>;

export type Section16MonitorConditionSetRepository = Readonly<{
  create(row: StoredRow): Promise<RepositoryResult>;
  read(ownerId: string, id: string): Promise<RepositoryResult>;
}>;

export class Section16MonitorConditionSetError extends Error {
  readonly code: "condition_set_invalid" | "condition_set_read_failed" | "condition_set_write_failed";
  readonly details: readonly string[];

  constructor(code: Section16MonitorConditionSetError["code"], message: string, details: readonly string[] = []) {
    super(message);
    this.name = "Section16MonitorConditionSetError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Reuses the existing owner-scoped listing_monitors persistence boundary.
 * Section 16 condition sets are forced inactive so the existing Alert consumer
 * cannot execute them; only the explicit manual reader below recognizes them.
 */
export async function createSection16MonitorConditionSet(
  input: Readonly<{ ownerId: string; conditions: unknown }>,
  repository?: Section16MonitorConditionSetRepository,
): Promise<Section16MonitorConditionSet> {
  const ownerId = requiredUuid(input.ownerId, "ownerId");
  const validation = validateCanonicalSection16MonitorConditions(input.conditions);
  if (!validation.ok) throw invalid(validation.errors);
  const resolved = repository ?? await defaultRepository();
  const result = await resolved.create({
    user_id: ownerId,
    domain: "listing",
    conditions: validation.conditions,
    is_active: false,
  });
  assertRepositoryResult(result, "condition_set_write_failed", "Section 16 condition set write failed");
  const row = rows(result.data).find((candidate) => candidate.user_id === ownerId);
  if (!row) throw new Section16MonitorConditionSetError("condition_set_write_failed", "Section 16 condition set was not returned");
  const parsed = parseStoredConditionSet(row, ownerId);
  if (parsed.status !== "available") {
    throw new Section16MonitorConditionSetError(
      "condition_set_write_failed",
      "Section 16 condition set readback was invalid",
      parsed.status === "invalid" ? parsed.errors : [],
    );
  }
  return parsed.conditionSet;
}

export async function readSection16MonitorConditionSetForOwner(
  ownerIdValue: string,
  idValue: string,
  repository?: Section16MonitorConditionSetRepository,
): Promise<Section16MonitorConditionSetReadResult> {
  const ownerId = requiredUuid(ownerIdValue, "ownerId");
  const id = requiredUuid(idValue, "id");
  const resolved = repository ?? await defaultRepository();
  const result = await resolved.read(ownerId, id);
  assertRepositoryResult(result, "condition_set_read_failed", "Section 16 condition set read failed");
  const row = rows(result.data).find((candidate) => candidate.user_id === ownerId);
  return row ? parseStoredConditionSet(row, ownerId) : { status: "not_found" };
}

export function validateCanonicalSection16MonitorConditions(value: unknown): Readonly<{
  ok: boolean;
  rowFamily: Section16MonitorRowFamily | null;
  conditions: readonly CanonicalSection16MonitorCondition[];
  errors: readonly string[];
}> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, rowFamily: null, conditions: [], errors: ["condition_set_empty"] };
  }
  const errors: string[] = [];
  const conditions: CanonicalSection16MonitorCondition[] = [];
  const rowFamilies = new Set<Section16MonitorRowFamily>();
  value.forEach((candidate, index) => {
    if (!record(candidate) || !exactConditionKeys(candidate)) {
      errors.push(`conditions[${index}]:condition_invalid`);
      return;
    }
    const validationError = validateSection16MonitorConditionInput(candidate)[0];
    if (validationError) {
      errors.push(`conditions[${index}]:${validationError}`);
      return;
    }
    const definition = getSection16MonitorCondition(String(candidate.key))!;
    rowFamilies.add(definition.rowFamily);
    conditions.push(Object.freeze({
      key: String(candidate.key),
      operator: candidate.operator as MonitorConditionOperator,
      value: Array.isArray(candidate.value) ? Object.freeze([...candidate.value]) : candidate.value,
    }));
  });
  if (rowFamilies.size > 1) errors.push("row_families_mixed");
  const rowFamily = rowFamilies.size === 1 ? [...rowFamilies][0]! : null;
  return {
    ok: errors.length === 0,
    rowFamily,
    conditions: errors.length === 0 ? Object.freeze(conditions) : [],
    errors: Object.freeze(errors),
  };
}

function parseStoredConditionSet(row: StoredRow, ownerId: string): Section16MonitorConditionSetReadResult {
  const id = typeof row.id === "string" ? row.id : "unknown";
  const validation = validateCanonicalSection16MonitorConditions(row.conditions);
  const errors = [...validation.errors];
  if (!UUID_PATTERN.test(id)) errors.push("condition_set_id_invalid");
  if (row.user_id !== ownerId) errors.push("owner_invalid");
  if (row.domain !== "listing") errors.push("storage_domain_invalid");
  if (row.is_active !== false) errors.push("manual_only_state_invalid");
  const createdAt = validTimestamp(row.created_at) ? row.created_at : "";
  const updatedAt = validTimestamp(row.updated_at) ? row.updated_at : "";
  if (!createdAt) errors.push("created_at_invalid");
  if (!updatedAt) errors.push("updated_at_invalid");
  if (errors.length > 0 || !validation.rowFamily) {
    return { status: "invalid", id, errors: Object.freeze(errors) };
  }
  return {
    status: "available",
    conditionSet: Object.freeze({
      id,
      userId: ownerId,
      rowFamily: validation.rowFamily,
      conditions: validation.conditions,
      executionMode: "manual_only_no_alerts",
      createdAt,
      updatedAt,
    }),
  };
}

async function defaultRepository(): Promise<Section16MonitorConditionSetRepository> {
  const supabase = await import("../supabase.ts");
  const fields = "id,user_id,domain,conditions,is_active,created_at,updated_at";
  return {
    create: (row) => supabase.supabaseUpsert("listing_monitors", row, { prefer: "return=representation" }),
    read: (ownerId, id) => supabase.supabaseSelect("listing_monitors", {
      select: fields,
      id: `eq.${id}`,
      user_id: `eq.${ownerId}`,
      domain: "eq.listing",
      is_active: "eq.false",
      limit: "1",
    }),
  };
}

function assertRepositoryResult(
  result: RepositoryResult,
  code: "condition_set_read_failed" | "condition_set_write_failed",
  message: string,
) {
  if (!result.ok) throw new Section16MonitorConditionSetError(code, `${message}: ${result.error || result.status || 0}`);
}

function invalid(errors: readonly string[]) {
  return new Section16MonitorConditionSetError("condition_set_invalid", "Section 16 conditions are invalid", errors);
}

function requiredUuid(value: string, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!UUID_PATTERN.test(text)) throw invalid([`${label}_invalid`]);
  return text;
}

function exactConditionKeys(value: Record<string, unknown>) {
  const keys = Object.keys(value).sort();
  return keys.length === 3 && keys[0] === "key" && keys[1] === "operator" && keys[2] === "value";
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function rows(value: unknown): StoredRow[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
