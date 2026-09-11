import { validateCanonicalSc13Conditions, validateSc13MonitorTarget } from "./sc13MonitorPersistence.ts";

export type Sc13MonitorApiRequestError = Readonly<{
  ok: false;
  status: 400 | 422;
  code: "INVALID_REQUEST" | "INVALID_TARGET" | "INVALID_CONDITIONS";
  message: string;
  errors: readonly string[];
}>;

export function parseSc13MonitorCreateRequest(value: unknown) {
  if (!record(value) || Object.keys(value).sort().join(",") !== "conditions,target") {
    return invalid("INVALID_REQUEST", 400, ["request_shape_invalid"]);
  }
  const target = validateSc13MonitorTarget(value.target);
  if (!target.ok) return invalid("INVALID_TARGET", 422, target.errors);
  const conditions = validateCanonicalSc13Conditions(value.conditions);
  if (!conditions.ok) return invalid("INVALID_CONDITIONS", 422, conditions.errors);
  return { ok: true as const, value: { target: target.target!, conditions: conditions.conditions } };
}

export function validateSc13MonitorCandidate(value: unknown) {
  const parsed = parseSc13MonitorCreateRequest(value);
  return parsed.ok
    ? { valid: true as const, target: parsed.value.target, conditions: parsed.value.conditions, errors: [] as readonly string[] }
    : { valid: false as const, target: null, conditions: [], errors: parsed.errors, error: parsed };
}

export function isSc13MonitorUuid(value: string) { return UUID_PATTERN.test(value); }

function invalid(code: Sc13MonitorApiRequestError["code"], status: Sc13MonitorApiRequestError["status"], errors: readonly string[]): Sc13MonitorApiRequestError {
  const message = code === "INVALID_TARGET" ? "SC13 monitor target is invalid."
    : code === "INVALID_CONDITIONS" ? "SC13 monitor conditions are invalid."
      : "SC13 monitor request is invalid.";
  return { ok: false, status, code, message, errors };
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
