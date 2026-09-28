import { buildForm4SemanticRules } from "./form4.ts";

const FORM4_AMENDMENT_RULES = Object.freeze([
  "For Form 4/A, apply every Form 4 rule and analyze only the amendment's source-backed correction scope.",
  "Use an explicit original filing date, prior accession, amendment explanation, or supplied parent comparison to identify the target. Form type alone does not identify what changed.",
  "An omitted original row is not deleted and a repeated row is not automatically replaced. Do not assume full replacement from form type, repetition, or omission; recognize an explicit restatement only within its evidenced scope and never treat it as authorization to rewrite stored direct facts.",
  "Return adds, modifies, removes, or restates only when the amendment XML or a supplied trusted parent comparison directly establishes that effect. If no parent comparison was supplied, never invent parent evidence; otherwise omit amendment_effect or return unresolved.",
  "Do not repeat unchanged original transactions as new purchases, sales, gifts, exercises, or conversions.",
]);

export function buildForm4ASemanticRules(): readonly string[] {
  return Object.freeze([...buildForm4SemanticRules(), ...FORM4_AMENDMENT_RULES]);
}
