import Ajv from "ajv";
import { parseJsonWithoutDuplicateKeys } from "../minimalOfferingMonitor.ts";
import { assertS8StructuredSource, type S8StructuredSource } from "./structuredSource.ts";

export const S8_STRUCTURED_VERSION = "s8_structured_v6";
export const FILING_KINDS = ["registration", "amendment", "deregistration", "reoffer", "other", "unclear"] as const;
export const PRIOR_FILING_RELATIONSHIPS = ["prior_filing", "current_target", "unclear"] as const;
export const UNRESOLVED_KINDS = ["plan_relationship", "prior_filing_relationship", "filing_kind"] as const;
export type S8StructuredWire = {
  version: typeof S8_STRUCTURED_VERSION;
  filing_kind: typeof FILING_KINDS[number];
  current_plans: Array<{ name: string; evidence: string[] }>;
  prior_filings: Array<{ reference: string; relationship: typeof PRIOR_FILING_RELATIONSHIPS[number]; evidence: string[] }>;
  unresolved: Array<typeof UNRESOLVED_KINDS[number]>;
};
type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>) =>
  ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const choice = (values: readonly string[]) => ({ type: "string", enum: values.length ? values : ["UNAVAILABLE"] });
const arr = (items: Schema, maxItems: number) => ({ type: "array", items, maxItems });
const text = { type: "string", minLength: 1, maxLength: 1000 };
export function s8StructuredSchema(source: S8StructuredSource) {
  const evidence = { ...arr(choice(source.evidence.map(e => e.ref)), 8), uniqueItems: true };
  return obj({
    version: choice([S8_STRUCTURED_VERSION]),
    filing_kind: choice(FILING_KINDS),
    current_plans: arr(obj({ name: text, evidence }), 20),
    prior_filings: arr(obj({ reference: text, relationship: choice(PRIOR_FILING_RELATIONSHIPS), evidence }), 20),
    unresolved: { ...arr(choice(UNRESOLVED_KINDS), 3), uniqueItems: true },
  });
}

/** Shape/ref validation only. Semantic correctness is assessed separately against SEC evidence. */
export function validateS8Structured(candidate: unknown, source: S8StructuredSource) {
  try { assertS8StructuredSource(source); } catch { return { ok: false as const, errors: ["s8_structured_package_changed"] }; }
  const validate = new Ajv({ strict: false, allErrors: true }).compile(s8StructuredSchema(source));
  if (!validate(candidate)) return { ok: false as const, errors: (validate.errors ?? []).map(e => String(e.instancePath) + ":" + e.message) };
  const wire = candidate as S8StructuredWire;
  const selected = [...new Set([...wire.current_plans.flatMap(p => p.evidence),
    ...wire.prior_filings.flatMap(r => r.evidence)])];
  // Preserve every model claim. Bind evidence and direct rows without semantic repairs.
  const snapshot = { version: S8_STRUCTURED_VERSION, identity: source.identity,
    sourceFingerprint: source.fingerprint, sourceSha256: source.sourceSha256,
    semantic: structuredClone(wire), directRegistrationRows: structuredClone(source.directRows),
    evidence: selected.map(ref => structuredClone(source.evidence.find(e => e.ref === ref)!)),
    limitations: [...source.limitations, "structural_validation_only_semantic_accuracy_not_certified",
      "no_current_reserve_issuance_sale_or_dilution_inference"] };
  return { ok: true as const, result: snapshot };
}
export type S8StructuredSnapshot = Extract<ReturnType<typeof validateS8Structured>, { ok: true }>["result"];
export function parseS8Structured(text: string, source: S8StructuredSource) {
  try { return validateS8Structured(parseJsonWithoutDuplicateKeys(text), source); }
  catch { return { ok: false as const, errors: ["invalid_or_duplicate_key_json"] }; }
}
