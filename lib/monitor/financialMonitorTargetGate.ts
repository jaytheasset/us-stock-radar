import { financialTargetSchema, type FinancialTargetResult } from "./financialMonitorTarget.ts";
import type { FinancialMonitorFactReadResult } from "./financialMonitorFacts.ts";

export type FinancialTargetReason = "stored_target_invalid" | "target_unavailable" | "target_identity_changed" | "target_issuer_mismatch";
/** Only explicit SQL null is legacy. Malformed/missing targets cannot widen scope. */
export function financialMonitorTargetFailure(target: unknown, current: FinancialTargetResult | null, facts: FinancialMonitorFactReadResult): FinancialTargetReason | null {
  if (target === null) return null;
  const saved = financialTargetSchema.safeParse(target);
  if (!saved.success) return "stored_target_invalid";
  if (current?.status !== "available") return "target_unavailable";
  const verified = financialTargetSchema.safeParse(current.target);
  if (!verified.success) return "target_unavailable";
  if (verified.data.ticker !== saved.data.ticker || verified.data.issuerCik !== saved.data.issuerCik) return "target_identity_changed";
  if (facts.status === "available" && facts.issuerCik !== saved.data.issuerCik) return "target_issuer_mismatch";
  return null;
}
