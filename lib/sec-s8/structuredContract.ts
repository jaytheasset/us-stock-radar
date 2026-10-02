import Ajv from "ajv";
import { parseJsonWithoutDuplicateKeys } from "../minimalOfferingMonitor.ts";
import { assertS8StructuredSource, type S8StructuredSource } from "./structuredSource.ts";

export const S8_STRUCTURED_VERSION = "s8_structured_v1";
export const FILING_KINDS = ["initial_registration", "additional_registration", "amendment",
  "correction", "post_effective_deregistration", "reoffer_resale", "ambiguous"] as const;
export const AMENDMENT_EFFECTS = ["not_applicable", "adds_registration", "administrative_only",
  "deregisters_unsold", "corrects_prior", "updates_exhibits", "reoffer_subset", "unresolved"] as const;
export const REFERENCE_ROLES = ["historical_reference", "incorporated_history", "parent_candidate",
  "amendment_target", "additional_registration_to", "deregistration_target", "unresolved"] as const;
export type Citation = { ref: string; quote: string };
export type S8StructuredWire = {
  version: typeof S8_STRUCTURED_VERSION; source_fingerprint: string;
  filing: { kind: typeof FILING_KINDS[number]; evidence: Citation[] };
  plans: Array<{ name: string; scope: "current_filing" | "historical_reference"; evidence: Citation[] }>;
  registrations: Array<{ row: string; relation: "source_linked" | "unresolved"; plan_names: string[]; evidence: Citation[] }>;
  references: Array<{ reference: string; role: typeof REFERENCE_ROLES[number]; evidence: Citation[] }>;
  amendment: { effect: typeof AMENDMENT_EFFECTS[number]; evidence: Citation[] };
  unresolved: Array<"plan_relationship" | "prior_filing_relationship" | "filing_semantics" | "amendment_effect" | "source_incomplete">;
};
type Schema = Record<string, unknown>;
const obj = (properties: Record<string, Schema>) =>
  ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const str = { type: "string", minLength: 1, maxLength: 400 };
const choice = (values: readonly string[]) => ({ type: "string", enum: values });
const arr = (items: Schema, maxItems = 30) => ({ type: "array", items, maxItems });
export function s8StructuredSchema(source: S8StructuredSource) {
  const cites = arr(obj({ ref: choice(source.evidence.map(e => e.ref)), quote: { type: "string", minLength: 1, maxLength: 2000 } }), 8);
  return obj({
    version: choice([S8_STRUCTURED_VERSION]), source_fingerprint: choice([source.fingerprint]),
    filing: obj({ kind: choice(FILING_KINDS), evidence: cites }),
    plans: arr(obj({ name: str, scope: choice(["current_filing", "historical_reference"]), evidence: cites })),
    registrations: arr(obj({ row: choice(source.directRows.length ? source.directRows.map(r => r.ref) : ["UNAVAILABLE"]),
      relation: choice(["source_linked", "unresolved"]), plan_names: arr(str, 8), evidence: cites }), source.directRows.length),
    references: arr(obj({ reference: str, role: choice(REFERENCE_ROLES), evidence: cites })),
    amendment: obj({ effect: choice(AMENDMENT_EFFECTS), evidence: cites }),
    unresolved: { ...arr(choice(["plan_relationship", "prior_filing_relationship", "filing_semantics", "amendment_effect", "source_incomplete"]), 5), uniqueItems: true },
  });
}

export function validateS8Structured(candidate: unknown, source: S8StructuredSource) {
  const errors: string[] = [];
  try { assertS8StructuredSource(source); } catch { return { ok: false as const, errors: ["s8_structured_package_changed"] }; }
  const validate = new Ajv({ strict: false, allErrors: true }).compile(s8StructuredSchema(source));
  if (!validate(candidate)) return { ok: false as const, errors: (validate.errors ?? []).map(e => `${e.instancePath}:${e.message}`) };
  const wire = candidate as S8StructuredWire;
  function check(cites: Citation[], required: boolean, path: string) {
    if (required && !cites.length) errors.push(`${path}:evidence_required`);
    const seen = new Set<string>();
    for (const cite of cites) {
      const block = source.evidence.find(e => e.ref === cite.ref);
      if (!cite.quote.trim() || !block?.text.includes(cite.quote)) errors.push(`${path}:quote_not_in_bound_source`);
      const key = JSON.stringify(cite);
      if (seen.has(key)) errors.push(`${path}:duplicate_citation`);
      seen.add(key);
    }
  }
  check(wire.filing.evidence, wire.filing.kind !== "ambiguous", "filing");
  check(wire.amendment.evidence, !["unresolved", "not_applicable"].includes(wire.amendment.effect), "amendment");
  const names = new Set<string>();
  for (const p of wire.plans) {
    check(p.evidence, true, "plan");
    if (!p.name.trim() || !p.evidence.some(e => e.quote.includes(p.name))) errors.push("plan:name_not_in_evidence");
    if (names.has(p.name)) errors.push("plan:duplicate_name");
    names.add(p.name);
  }
  const rows = new Set<string>();
  for (const r of wire.registrations) {
    check(r.evidence, r.relation === "source_linked", r.row);
    if (rows.has(r.row)) errors.push("registration:duplicate_row");
    rows.add(r.row);
    if (r.relation === "unresolved" && r.plan_names.length) errors.push("unresolved_row_has_plan");
    if (r.relation === "source_linked" && !r.plan_names.length) errors.push("linked_row_missing_plan");
    if (new Set(r.plan_names).size !== r.plan_names.length) errors.push("duplicate_plan_link");
    for (const name of r.plan_names) {
      if (!wire.plans.some(p => p.name === name && p.scope === "current_filing")) errors.push("row_plan_not_current");
      if (!r.evidence.some(e => e.quote.includes(name))) errors.push("row_plan_not_in_evidence");
      const title = source.directRows.find(row => row.ref === r.row)!.securityClass.text;
      const namedInTitle = wire.plans.filter(p => p.scope === "current_filing" && title.includes(p.name));
      if (namedInTitle.length && !namedInTitle.some(p => p.name === name)) errors.push("row_plan_contradicts_direct_title");
    }
  }
  if (rows.size !== source.directRows.length) errors.push("registration_coverage_incomplete");
  const refs = new Set<string>();
  for (const r of wire.references) {
    check(r.evidence, true, "reference");
    if (!r.reference.trim() || !r.evidence.some(e => e.quote.includes(r.reference))) errors.push("reference:not_in_evidence");
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
  // Binding only: no repair, semantic fallback or alteration of model selections.
  const evidence = [...wire.filing.evidence, ...wire.amendment.evidence,
    ...wire.plans.flatMap(p => p.evidence), ...wire.registrations.flatMap(r => r.evidence),
    ...wire.references.flatMap(r => r.evidence)].map(cite => {
    const block = source.evidence.find(e => e.ref === cite.ref)!;
    return { ...cite, documentUrl: block.documentUrl, documentSha256: block.documentSha256,
      normalizedSha256: block.normalizedSha256, normalizedStart: block.start + block.text.indexOf(cite.quote),
      normalizedEnd: block.start + block.text.indexOf(cite.quote) + cite.quote.length };
  });
  const snapshot = { version: S8_STRUCTURED_VERSION, identity: source.identity,
    sourceFingerprint: source.fingerprint, sourceSha256: source.sourceSha256,
    semantic: structuredClone(wire), directRegistrationRows: structuredClone(source.directRows),
    evidence, limitations: [...source.limitations, "semantic_entailment_not_proven_by_schema_or_quote_validation",
      "no_current_reserve_issuance_sale_or_dilution_inference"] };
  return { ok: true as const, result: snapshot };
}
export type S8StructuredSnapshot = Extract<ReturnType<typeof validateS8Structured>, { ok: true }>["result"];
export function parseS8Structured(text: string, source: S8StructuredSource) {
  try { return validateS8Structured(parseJsonWithoutDuplicateKeys(text), source); }
  catch { return { ok: false as const, errors: ["invalid_or_duplicate_key_json"] }; }
}
