import { buildForm144SemanticRules } from "./form144.ts";

const FORM144_AMENDMENT_RULES = Object.freeze([
  "For Form 144/A, apply every Form 144 rule and analyze only the amendment's source-backed correction scope.",
  "Use an explicit previous accession, amendment explanation, or supplied parent comparison to identify the target. Form type alone does not establish a change.",
  "An omitted original proposed-sale, acquisition-history, or past-sale row is not deleted; a repeated row is not automatically a replacement or a newly proposed sale.",
  "Return adds, modifies, removes, or restates only when the amendment XML or a supplied trusted parent comparison directly establishes that effect. If no parent comparison was supplied, never invent parent evidence; otherwise omit amendment_effect or return unresolved.",
  "Never describe a Form 144/A amendment as an executed sale, and never transfer a prior-sale remark onto the current proposed-sale purpose without explicit linkage.",
]);

export function buildForm144ASemanticRules(): readonly string[] {
  return Object.freeze([...buildForm144SemanticRules(), ...FORM144_AMENDMENT_RULES]);
}
