import { getReadyMonitorConditions, getStoredMonitorCondition, MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS } from "./conditionRegistry.ts";
import type { CanonicalFinancialMonitorCondition } from "./financialMonitorPersistence.ts";

export const FINANCIAL_SCOPE = "Evaluates supported SEC periodic filings only for the selected company (SEC issuer CIK). All conditions must match the same filing with the specified period basis and currency.";
export const FINANCIAL_FIELDS = getReadyMonitorConditions().filter(d => d.family === "financial" && d.monitorDomains?.includes("financial"));
/** Group the preserved decimal string; never convert financial values to Number. */
export function formatFinancialAmount(value: string, currency: string) {
  const [whole, fraction] = value.split(".");
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
}
export function financialConditionText(c: CanonicalFinancialMonitorCondition) {
  return `${getStoredMonitorCondition(c.key)?.display?.label || c.key}: ${MONITOR_CONDITION_OPERATOR_DISPLAY_LABELS[c.operator]} ${formatFinancialAmount(c.value, c.currency)}`;
}

export const FINANCIAL_LEGACY_SCOPE = "Legacy — all supported issuers. This monitor has no company target.";
