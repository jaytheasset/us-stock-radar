import Ajv from "ajv";
import { parseJsonWithoutDuplicateKeys } from "../minimalOfferingMonitor.ts";
import { assertS8StructuredSource, type S8StructuredSource } from "./structuredSource.ts";

export const S8_STRUCTURED_VERSION = "s8_structured_v3";
export const FILING_KINDS = ["initial_registration", "additional_registration", "amendment",
  "correction", "post_effective_deregistration", "reoffer_resale", "ambiguous"] as const;
export const AMENDMENT_EFFECTS = ["not_applicable", "adds_registration", "administrative_only",
  "deregisters_unsold", "corrects_prior", "updates_exhibits", "reoffer_subset", "unresolved"] as const;
export const REFERENCE_ROLES = ["historical_reference", "incorporated_history", "parent_candidate",
  "amendment_target", "additional_registration_to", "deregistration_target", "unresolved"] as const;
export type S8StructuredWire = {
  version: typeof S8_STRUCTURED_VERSION;
  filing: { kind: typeof FILING_KINDS[number]; evidence: string[] };
  plans: Array<{ name: string; scope: "current_filing" | "historical_reference" | "amendment_target" | "unresolved"; evidence: string[] }>;
  registrations: Array<{ row: string; relation: "linked" | "unresolved"; plans: string[]; evidence: string[] }>;
  references: Array<{ reference_text: string; role: typeof REFERENCE_ROLES[number]; evidence: string[] }>;
  amendment: { effect: typeof AMENDMENT_EFFECTS[number]; evidence: string[] };
  unresolved: Array<"plan_relationship" | "prior_filing_relationship" | "filing_semantics" | "amendment_effect" | "source_incomplete">;
};
type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>) =>
  ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const choice = (values: readonly string[]) => ({ type: "string", enum: values.length ? values : ["UNAVAILABLE"] });
const arr = (items: Schema, maxItems = 30) => ({ type: "array", items, maxItems });
const text = { type: "string", minLength: 1, maxLength: 1000 };
export function s8StructuredSchema(source: S8StructuredSource) {
  const evidence = { ...arr(choice(source.evidence.map(e => e.ref)), 8), uniqueItems: true };
  return obj({
    version: choice([S8_STRUCTURED_VERSION]),
    filing: obj({ kind: choice(FILING_KINDS), evidence }),
    plans: arr(obj({ name: text, scope: choice(["current_filing", "historical_reference", "amendment_target", "unresolved"]), evidence })),
    registrations: arr(obj({ row: choice(source.directRows.map(r => r.ref)),
      relation: choice(["linked", "unresolved"]), plans: arr(text, 8), evidence }), source.directRows.length),
    references: arr(obj({ reference_text: text, role: choice(REFERENCE_ROLES), evidence })),
    amendment: obj({ effect: choice(AMENDMENT_EFFECTS), evidence }),
    unresolved: { ...arr(choice(["plan_relationship", "prior_filing_relationship", "filing_semantics", "amendment_effect", "source_incomplete"]), 5), uniqueItems: true },
  });
}

/** Shape/ref validation only. Semantic correctness is assessed separately against SEC evidence. */
export function validateS8Structured(candidate: unknown, source: S8StructuredSource) {
  // Server-owned provenance integrity, never a judgment about the model's meaning.
  try { assertS8StructuredSource(source); } catch { return { ok: false as const, errors: ["s8_structured_package_changed"] }; }
  const validate = new Ajv({ strict: false, allErrors: true }).compile(s8StructuredSchema(source));
  if (!validate(candidate)) return { ok: false as const, errors: (validate.errors ?? []).map(e => String(e.instancePath) + ":" + e.message) };
  const wire = candidate as S8StructuredWire;
  const selected = [...new Set([...wire.filing.evidence, ...wire.amendment.evidence,
    ...wire.plans.flatMap(p => p.evidence), ...wire.registrations.flatMap(r => r.evidence),
    ...wire.references.flatMap(r => r.evidence)])];
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
