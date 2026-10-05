// Browser-safe contract. Identity is the SEC registrant/file-number pair; accession is evidence.
export type EffectCondition = Readonly<{ key: string; operator: string; value: unknown }>;
export type RegistrationTarget = {
  cik: string; fileNumber: string; form: string; accession: string; company: string;
  filedAt: string; sourceUrl: string; filingCount: number;
};
export const EFFECT_TARGET_KEYS = ["effect.observed", "effect.issuer_cik", "effect.file_number", "effect.registration_form", "effect.registration_accession"] as const;
export const REGISTRATION_FORMS = ["S-1", "S-3", "F-1", "F-3"] as const;
export function hasEffect(conditions: readonly { key: unknown }[]) { return Array.isArray(conditions) && conditions.some(c => c && typeof c.key === "string" && c.key.startsWith("effect.")); }
export function effectConditionErrors(conditions: readonly EffectCondition[]) {
  if (!hasEffect(conditions)) return [];
  if (conditions.some(c => !c || typeof c.key !== "string" || typeof c.operator !== "string")) return ["effect_registration_target_confirmation_required"];
  const values = new Map(conditions.map(c => [c.key, c.value]));
  if (conditions.length !== EFFECT_TARGET_KEYS.length || values.size !== conditions.length
    || conditions.some(c => c.operator !== "eq" || !(EFFECT_TARGET_KEYS as readonly string[]).includes(c.key))
    || values.get("effect.observed") !== true
    || !/^\d{10}$/.test(String(values.get("effect.issuer_cik") ?? ""))
    || Number(values.get("effect.issuer_cik")) <= 0
    || !/^333-\d+(?:-\d+)?$/.test(String(values.get("effect.file_number") ?? ""))
    || !(REGISTRATION_FORMS as readonly unknown[]).includes(values.get("effect.registration_form"))
    || !/^\d{10}-\d{2}-\d{6}$/.test(String(values.get("effect.registration_accession") ?? ""))) {
    return ["effect_registration_target_confirmation_required"];
  }
  return [];
}
export function effectTarget(conditions: readonly EffectCondition[]) {
  if (!hasEffect(conditions) || effectConditionErrors(conditions).length) return null;
  const get = (key: string) => String(conditions.find(c => c.key === `effect.${key}`)!.value);
  return { cik: get("issuer_cik"), fileNumber: get("file_number"), form: get("registration_form"), accession: get("registration_accession") };
}
export function targetConditions(target: RegistrationTarget) {
  return [
    { key: "effect.observed", operator: "eq" as const, value: true },
    ...Object.entries({ issuer_cik: target.cik, file_number: target.fileNumber,
      registration_form: target.form, registration_accession: target.accession })
      .map(([key, value]) => ({ key: `effect.${key}`, operator: "eq" as const, value })),
  ];
}
