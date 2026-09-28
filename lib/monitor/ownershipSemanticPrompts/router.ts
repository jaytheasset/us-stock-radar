import {
  buildOwnershipCommonSemanticRules,
  type OwnershipSemanticOutputFactField,
} from "./common.ts";
import { buildForm4SemanticRules } from "./form4.ts";
import { buildForm4ASemanticRules } from "./form4A.ts";
import { buildForm144SemanticRules } from "./form144.ts";
import { buildForm144ASemanticRules } from "./form144A.ts";

export type OwnershipSemanticPromptRoute = "form4" | "form4A" | "form144" | "form144A";

type CanonicalOwnershipForm = "form4" | "form144";
type OwnershipSemanticWireFactField = Exclude<
  OwnershipSemanticOutputFactField,
  "owner_attribution" | "ownership_relation" | "footnote_scope"
> | "owner_relations" | "footnote_scopes";

export type RoutedOwnershipSemanticPrompt = Readonly<{
  id: OwnershipSemanticPromptRoute;
  rawForm: "4" | "4/A" | "144" | "144/A";
  canonicalForm: CanonicalOwnershipForm;
  isAmendment: boolean;
  systemRules: readonly string[];
  outputFactFields: readonly OwnershipSemanticWireFactField[];
}>;

const FORM4_OUTPUT_FACTS = Object.freeze([
  "owner_relations",
  "derivative_underlying_relation",
  "rule_10b5_1",
] satisfies OwnershipSemanticWireFactField[]);

const FORM4_AMENDMENT_OUTPUT_FACTS = Object.freeze([
  ...FORM4_OUTPUT_FACTS,
  "footnote_scopes",
  "amendment_effect",
] satisfies OwnershipSemanticWireFactField[]);

const FORM4_SELECTION_OUTPUT_RULES = Object.freeze([
  "For this Form 4 selection output, do not emit footnote_scopes; use linked F references only as evidence for owner_relations, derivative_underlying_relation, or row-local rule_10b5_1.",
]);

const FORM144_OUTPUT_FACTS = Object.freeze([
  "footnote_scopes",
] satisfies OwnershipSemanticWireFactField[]);

export function routeOwnershipSemanticPrompt(input: Readonly<{
  rawForm: string;
  canonicalForm: CanonicalOwnershipForm;
  isAmendment: boolean;
}>):
  | Readonly<{ ok: true; route: RoutedOwnershipSemanticPrompt }>
  | Readonly<{ ok: false; reason: string }> {
  const rawForm = normalizeRawOwnershipForm(input.rawForm);
  if (!rawForm) return { ok: false, reason: "ownership_semantic_prompt_form_unknown" };
  const expectedCanonical = rawForm === "4" || rawForm === "4/A" ? "form4" : "form144";
  const expectedAmendment = rawForm.endsWith("/A");
  if (input.canonicalForm !== expectedCanonical) {
    return { ok: false, reason: "ownership_semantic_prompt_form_family_mismatch" };
  }
  if (input.isAmendment !== expectedAmendment) {
    return { ok: false, reason: "ownership_semantic_prompt_amendment_mismatch" };
  }
  const common = buildOwnershipCommonSemanticRules();
  if (rawForm === "4") return {
    ok: true,
    route: route("form4", rawForm, "form4", false,
      [...common, ...buildForm4SemanticRules(), ...FORM4_SELECTION_OUTPUT_RULES], FORM4_OUTPUT_FACTS),
  };
  if (rawForm === "4/A") return {
    ok: true,
    route: route("form4A", rawForm, "form4", true, [...common, ...buildForm4ASemanticRules()], FORM4_AMENDMENT_OUTPUT_FACTS),
  };
  if (rawForm === "144") return {
    ok: true,
    route: route("form144", rawForm, "form144", false, [...common, ...buildForm144SemanticRules()], FORM144_OUTPUT_FACTS),
  };
  return {
    ok: true,
    route: route("form144A", rawForm, "form144", true, [...common, ...buildForm144ASemanticRules()], [...FORM144_OUTPUT_FACTS, "amendment_effect"]),
  };
}

export function routeOwnershipSemanticPromptFromInventory(input: Readonly<{
  form: CanonicalOwnershipForm;
  isAmendment: boolean;
}>): RoutedOwnershipSemanticPrompt {
  const rawForm = input.form === "form4"
    ? input.isAmendment ? "4/A" : "4"
    : input.isAmendment ? "144/A" : "144";
  const result = routeOwnershipSemanticPrompt({ rawForm, canonicalForm: input.form, isAmendment: input.isAmendment });
  if (!result.ok) throw new Error(result.reason);
  return result.route;
}

function normalizeRawOwnershipForm(value: string): "4" | "4/A" | "144" | "144/A" | null {
  const normalized = value.trim().toUpperCase().replace(/^FORM\s+/, "");
  return normalized === "4" || normalized === "4/A" || normalized === "144" || normalized === "144/A"
    ? normalized
    : null;
}

function route(
  id: OwnershipSemanticPromptRoute,
  rawForm: RoutedOwnershipSemanticPrompt["rawForm"],
  canonicalForm: CanonicalOwnershipForm,
  isAmendment: boolean,
  systemRules: readonly string[],
  outputFactFields: readonly OwnershipSemanticWireFactField[],
): RoutedOwnershipSemanticPrompt {
  return Object.freeze({
    id,
    rawForm,
    canonicalForm,
    isAmendment,
    systemRules: Object.freeze([...systemRules]),
    outputFactFields: Object.freeze([...outputFactFields]),
  });
}
