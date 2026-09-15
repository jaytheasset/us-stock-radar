import {
  readCurrentOwnershipFacts,
  type OwnershipMonitorRepository,
} from "./ownershipMonitorPersistence.ts";
import {
  validateOwnershipContextCandidate,
  type OwnershipContextAiRefs,
  type ValidatedOwnershipContextBundle,
} from "./ownershipStructuredContext.ts";

type RepositoryResult = Readonly<{
  ok: boolean;
  status?: number;
  data: unknown;
  error?: string;
}>;

export type OwnershipContextPersistenceRepository = OwnershipMonitorRepository & Readonly<{
  persistContext(input: Readonly<{
    eventId: string;
    form: "form4" | "form144";
    sourceFingerprint: string;
    contexts: readonly Readonly<{ row_ref: string; assertions: readonly Record<string, unknown>[] }>[];
    aiRefs?: OwnershipContextAiRefs;
  }>): Promise<RepositoryResult>;
}>;

export type OwnershipContextPersistenceResult = Readonly<{
  status: "stored" | "replayed";
  updatedRowCount: number;
  validated: ValidatedOwnershipContextBundle;
}>;

export class OwnershipContextValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(`Ownership context is invalid: ${errors.join("; ")}`);
    this.name = "OwnershipContextValidationError";
    this.errors = errors;
  }
}

/**
 * Validates an untrusted structured-context candidate against the current
 * official XML/parser inventory, then persists only the sanitized assertions.
 * This function is intentionally not wired to any LLM or production workflow.
 */
export async function persistOwnershipStructuredContext(input: Readonly<{
  eventId: string;
  candidate: unknown;
  aiRefs?: OwnershipContextAiRefs;
}>, repository?: OwnershipContextPersistenceRepository): Promise<OwnershipContextPersistenceResult> {
  const resolved = repository ?? await defaultRepository();
  const current = await readCurrentOwnershipFacts(input.eventId, resolved);
  if (current.status !== "available") {
    throw new Error(`Ownership direct facts are not available: ${current.status === "not_ready" ? current.reason : current.status}`);
  }
  if (!current.contextEligibility || current.contextEligibility.status !== "eligible") {
    throw new Error(`Ownership context is not eligible: ${current.contextEligibility?.reason || "ownership_context_unavailable"}`);
  }
  const validation = validateOwnershipContextCandidate(input.candidate, current.contextEligibility.inventory);
  if (!validation.ok) throw new OwnershipContextValidationError(validation.errors);
  const aiRefs = validateAiRefs(input.aiRefs);
  const result = await resolved.persistContext({
    eventId: input.eventId,
    form: validation.value.form,
    sourceFingerprint: validation.value.source_fingerprint,
    contexts: validation.value.rows
      .filter((row) => row.assertions.length > 0)
      .map((row) => ({
        row_ref: row.row_ref,
        assertions: row.assertions as readonly Record<string, unknown>[],
      })),
    ...(aiRefs ? { aiRefs } : {}),
  });
  if (!result.ok) throw new Error(`Could not persist Ownership context: ${result.error || result.status || 0}`);
  const response = rpcObject(result.data);
  if (response.status !== "stored" && response.status !== "replayed") {
    throw new Error(`Ownership context persistence rejected: ${stringValue(response.reason) || "unknown_reason"}`);
  }
  const updatedRowCount = Number(response.updated_row_count);
  if (!Number.isInteger(updatedRowCount) || updatedRowCount < 0) {
    throw new Error("Ownership context persistence returned an invalid row count");
  }
  return {
    status: response.status,
    updatedRowCount,
    validated: validation.value,
  };
}

function validateAiRefs(value: OwnershipContextAiRefs | undefined) {
  if (!value) return undefined;
  if (!UUID_PATTERN.test(value.run_id) || !UUID_PATTERN.test(value.output_id)) {
    throw new OwnershipContextValidationError(["Ownership context AI references must be UUIDs"]);
  }
  return Object.freeze({ run_id: value.run_id.toLowerCase(), output_id: value.output_id.toLowerCase() });
}

async function defaultRepository(): Promise<OwnershipContextPersistenceRepository> {
  const supabase = await import("../supabase.ts");
  return {
    select: supabase.supabaseSelect,
    readContextSnapshot: (eventId) => supabase.supabaseRpc(
      "read_event_ownership_context_snapshot",
      { p_event_id: eventId },
    ),
    persistContext: (input) => supabase.supabaseRpc("persist_event_ownership_context", {
      p_event_id: input.eventId,
      p_form: input.form,
      p_source_fingerprint: input.sourceFingerprint,
      p_contexts: input.contexts,
      p_ai_run_id: input.aiRefs?.run_id ?? null,
      p_ai_output_id: input.aiRefs?.output_id ?? null,
    }),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) return value[0];
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
