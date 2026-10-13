import { financialTargetSelectionSchema } from "./financialMonitorTarget.ts";
import { validateCanonicalFinancialConditions } from "./financialMonitorPersistence.ts";

export type FinancialMonitorApiRequestError = Readonly<{
  ok: false; status: 400 | 422; code: "INVALID_REQUEST" | "INVALID_CONDITIONS"; message: string; errors: readonly string[];
}>;

export function parseFinancialMonitorCreateRequest(value: unknown) {
  if (!record(value) || Object.keys(value).sort().join(",") !== "conditions,target") return invalid("INVALID_REQUEST", 400, ["request_shape_invalid"]);
  const target = financialTargetSelectionSchema.safeParse(value.target);
  if (!target.success) return invalid("INVALID_REQUEST", 400, ["verified_target_required"]);
  const validation = validateCanonicalFinancialConditions(value.conditions);
  return validation.ok
    ? { ok: true as const, value: { conditions: validation.conditions, target: target.data } }
    : invalid("INVALID_CONDITIONS", 422, validation.errors);
}

export function validateFinancialMonitorCandidate(value: unknown) {
  const parsed = parseFinancialMonitorCreateRequest(value);
  return parsed.ok
    ? { valid: true as const, conditions: parsed.value.conditions, target: parsed.value.target, errors: [] as readonly string[] }
    : { valid: false as const, conditions: [], errors: parsed.errors, error: parsed };
}

export function isFinancialMonitorUuid(value: string) { return UUID_PATTERN.test(value); }

function invalid(code: FinancialMonitorApiRequestError["code"], status: FinancialMonitorApiRequestError["status"], errors: readonly string[]): FinancialMonitorApiRequestError {
  return { ok: false, status, code, message: code === "INVALID_CONDITIONS" ? "Financial monitor conditions are invalid." : "Financial monitor request is invalid.", errors };
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
