import Ajv from "ajv";
import { parseJsonWithoutDuplicateKeys } from "../minimalOfferingMonitor.ts";
import { assertS8StructuredSource, type S8StructuredSource } from "./structuredSource.ts";
import { lexicalName, type SourceCandidate } from "./structuredCandidates.ts";

export const S8_STRUCTURED_VERSION = "s8_structured_v2";
export const FILING_KINDS = ["initial_registration", "additional_registration", "amendment",
  "correction", "post_effective_deregistration", "reoffer_resale", "ambiguous"] as const;
export const AMENDMENT_EFFECTS = ["not_applicable", "adds_registration", "administrative_only",
  "deregisters_unsold", "corrects_prior", "updates_exhibits", "reoffer_subset", "unresolved"] as const;
export const REFERENCE_ROLES = ["historical_reference", "incorporated_history", "parent_candidate",
  "amendment_target", "additional_registration_to", "deregistration_target", "unresolved"] as const;
export type S8StructuredWire = {
  version: typeof S8_STRUCTURED_VERSION; source_fingerprint: string;
  filing: { kind: typeof FILING_KINDS[number]; evidence: string[] };
  plans: Array<{ plan: string; scope: "current_filing" | "historical_reference" | "unresolved"; evidence: string[] }>;
  registrations: Array<{ row: string; relation: "source_linked" | "unresolved"; plans: string[]; evidence: string[] }>;
  references: Array<{ reference: string; role: typeof REFERENCE_ROLES[number]; evidence: string[] }>;
  amendment: { effect: typeof AMENDMENT_EFFECTS[number]; evidence: string[] };
  unresolved: Array<"plan_relationship" | "prior_filing_relationship" | "filing_semantics" | "amendment_effect" | "source_incomplete">;
};
type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>) =>
  ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const choice = (values: readonly string[]) => ({ type: "string", enum: values.length ? values : ["UNAVAILABLE"] });
const arr = (items: Schema, maxItems = 30) => ({ type: "array", items, maxItems });
export function s8StructuredSchema(source: S8StructuredSource) {
  const cites = { ...arr(choice(source.evidence.map(e => e.ref)), 8), uniqueItems: true };
  const plan = choice(source.candidates.plans.map(p => p.ref));
  return obj({
    version: choice([S8_STRUCTURED_VERSION]), source_fingerprint: choice([source.fingerprint]),
    filing: obj({ kind: choice(FILING_KINDS), evidence: cites }),
    plans: arr(obj({ plan, scope: choice(["current_filing", "historical_reference", "unresolved"]), evidence: cites }), source.candidates.plans.length),
    registrations: arr(obj({ row: choice(source.directRows.map(r => r.ref)),
      relation: choice(["source_linked", "unresolved"]), plans: { ...arr(plan, source.candidates.plans.length), uniqueItems: true },
      evidence: cites }), source.directRows.length),
    references: arr(obj({ reference: choice(source.candidates.references.map(r => r.ref)), role: choice(REFERENCE_ROLES), evidence: cites }), source.candidates.references.length),
    amendment: obj({ effect: choice(AMENDMENT_EFFECTS), evidence: cites }),
    unresolved: { ...arr(choice(["plan_relationship", "prior_filing_relationship", "filing_semantics", "amendment_effect", "source_incomplete"]), 5), uniqueItems: true },
  });
}

export function validateS8Structured(candidate: unknown, source: S8StructuredSource) {
  const errors: string[] = [];
  try { assertS8StructuredSource(source); } catch { return { ok: false as const, errors: ["s8_structured_package_changed"] }; }
  const validate = new Ajv({ strict: false, allErrors: true }).compile(s8StructuredSchema(source));
  if (!validate(candidate)) return { ok: false as const, errors: (validate.errors ?? []).map(e => String(e.instancePath) + ":" + e.message) };
  const wire = candidate as S8StructuredWire;
  function check(refs: string[], required: boolean, path: string) {
    if (required && !refs.length) errors.push(path + ":evidence_required");
  }
  // Cover the selected occurrence across all its source blocks, including boundaries.
  const supported = (c: SourceCandidate, refs: string[]) =>
    c.occurrences.filter(o => o.evidence.every(ref => refs.includes(ref)));
  check(wire.filing.evidence, wire.filing.kind !== "ambiguous", "filing");
  check(wire.amendment.evidence, !["unresolved", "not_applicable"].includes(wire.amendment.effect), "amendment");
  const plans = new Set<string>();
  for (const p of wire.plans) {
    check(p.evidence, true, "plan");
    if (plans.has(p.plan)) errors.push("plan:duplicate");
    plans.add(p.plan);
    const c = source.candidates.plans.find(c => c.ref === p.plan)!;
    const occurrences = supported(c, p.evidence);
    if (!occurrences.length) errors.push("plan:unbound_candidate");
    // A literal denied name is not an entity, including in historical scope.
    if (c.occurrences.some(o => o.guards.includes("denied_existence"))) errors.push("plan:denied_existence");
    if (p.scope === "current_filing" && !occurrences.some(o => o.guards.length === 0))
      errors.push("plan:current_scope_not_supported");
  }
  const rows = new Set<string>();
  for (const r of wire.registrations) {
    check(r.evidence, r.relation === "source_linked", r.row);
    if (rows.has(r.row)) errors.push("registration:duplicate_row");
    rows.add(r.row);
    if (r.relation === "unresolved" && r.plans.length) errors.push("unresolved_row_has_plan");
    if (r.relation === "source_linked" && !r.plans.length) errors.push("linked_row_missing_plan");
    for (const plan of r.plans) {
      if (!wire.plans.some(p => p.plan === plan && p.scope === "current_filing")) errors.push("row_plan_not_current");
      const c = source.candidates.plans.find(p => p.ref === plan)!;
      if (!supported(c, r.evidence).some(o => o.guards.length === 0)) errors.push("row_plan_not_in_current_evidence");
      const title = lexicalName(source.directRows.find(row => row.ref === r.row)!.securityClass.text);
      const namedInTitle = source.candidates.plans.filter(p => title.includes(p.label));
      if (namedInTitle.length && !namedInTitle.some(p => p.ref === plan)) errors.push("row_plan_contradicts_direct_title");
    }
  }
  if (rows.size !== source.directRows.length) errors.push("registration_coverage_incomplete");
  const refs = new Set<string>();
  for (const r of wire.references) {
    check(r.evidence, true, "reference");
    const c = source.candidates.references.find(c => c.ref === r.reference)!;
    if (!supported(c, r.evidence).length) errors.push("reference:unbound_candidate");
    if (refs.has(r.reference)) errors.push("reference:duplicate");
    refs.add(r.reference);
    if (r.role === "additional_registration_to"
      && wire.filing.kind !== "additional_registration" && wire.amendment.effect !== "adds_registration")
      errors.push("reference:historical_promoted_without_current_addition");
    if (r.role === "amendment_target" && !["amendment", "correction"].includes(wire.filing.kind)
      && !["administrative_only", "corrects_prior", "updates_exhibits"].includes(wire.amendment.effect))
      errors.push("reference:amendment_target_without_amendment");
    if (r.role === "deregistration_target" && wire.filing.kind !== "post_effective_deregistration"
      && wire.amendment.effect !== "deregisters_unsold") errors.push("reference:deregistration_without_event");
  }
  if (errors.length) return { ok: false as const, errors };
  // Ref dereferencing only: no rewritten claims, repaired output or semantic fallback.
  const selected = [...new Set([...wire.filing.evidence, ...wire.amendment.evidence,
    ...wire.plans.flatMap(p => p.evidence), ...wire.registrations.flatMap(r => r.evidence),
    ...wire.references.flatMap(r => r.evidence)])];
  const snapshot = { version: S8_STRUCTURED_VERSION, identity: source.identity,
    sourceFingerprint: source.fingerprint, sourceSha256: source.sourceSha256,
    semantic: structuredClone(wire), directRegistrationRows: structuredClone(source.directRows),
    plans: wire.plans.map(p => ({ ...structuredClone(p), candidate: structuredClone(source.candidates.plans.find(c => c.ref === p.plan)!) })),
    references: wire.references.map(r => ({ ...structuredClone(r), candidate: structuredClone(source.candidates.references.find(c => c.ref === r.reference)!) })),
    evidence: selected.map(ref => structuredClone(source.evidence.find(e => e.ref === ref)!)),
    limitations: [...source.limitations, "lexical_candidates_are_not_confirmed_entities",
      "semantic_entailment_not_proven_by_schema_or_ref_validation",
      "no_current_reserve_issuance_sale_or_dilution_inference"] };
  return { ok: true as const, result: snapshot };
}
export type S8StructuredSnapshot = Extract<ReturnType<typeof validateS8Structured>, { ok: true }>["result"];
export function parseS8Structured(text: string, source: S8StructuredSource) {
  try { return validateS8Structured(parseJsonWithoutDuplicateKeys(text), source); }
  catch { return { ok: false as const, errors: ["invalid_or_duplicate_key_json"] }; }
}
