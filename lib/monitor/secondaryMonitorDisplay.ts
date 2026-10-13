import { getStoredMonitorCondition } from "./conditionRegistry.ts";

/** Presentation only: use the Registry's currency contract for saved facts and thresholds. */
export function formatSecondaryMonitorValue(key: string, value: unknown): string {
  if (Array.isArray(value)) return value.map(item => formatSecondaryMonitorValue(key, item)).join(", ");
  if (typeof value !== "number") return String(value ?? "Unconfirmed");
  const format = getStoredMonitorCondition(key)?.display?.numberFormat;
  if (format?.style === "currency" && format.currency) {
    return new Intl.NumberFormat("en-US", { ...format, currencyDisplay: "code" }).format(value);
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 20 });
}
