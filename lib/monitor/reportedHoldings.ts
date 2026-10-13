import { z } from "zod";
import { financialTargetSchema, financialTargetSelectionSchema } from "./financialMonitorTarget.ts";
import type { CanonicalSection16MonitorCondition } from "./section16MonitorPersistence.ts";

export const REPORTED_HOLDINGS_SCOPE = "Matches non-derivative holdings reported in one Form 3 or Form 5 filing. Each row is evaluated separately; no owner or class totals. Reported holdings are not a new purchase, a change in holdings, or a current account balance.";
export const reportedHoldingsSettingsSchema = z.object({
  form: z.enum(["3", "5"]), securityTitle: z.string().trim().min(1).max(200),
  operator: z.enum(["eq", "gte", "lte"]), amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(100),
}).strict();
export const reportedHoldingsCreateSchema = z.object({ target: financialTargetSelectionSchema, settings: reportedHoldingsSettingsSchema }).strict();
export const reportedHoldingsMonitorSchema = z.object({
  id: z.string().uuid(), userId: z.string().uuid(), target: financialTargetSchema,
  settings: reportedHoldingsSettingsSchema, isActive: z.boolean(), createdAt: z.string().datetime({ offset: true }),
}).strict();
export type ReportedHoldingsSettings = z.infer<typeof reportedHoldingsSettingsSchema>;
export type ReportedHoldingsMonitor = z.infer<typeof reportedHoldingsMonitorSchema>;

/** Fixed, minimal public contract mapped into the unchanged manual same-row matcher. */
export function reportedHoldingsConditions(s: ReportedHoldingsSettings): readonly CanonicalSection16MonitorCondition[] {
  return [
    { key: "ownership.section16.holding.row_kind", operator: "eq", value: "non_derivative" },
    { key: "ownership.section16.holding.security_title", operator: "eq", value: s.securityTitle },
    { key: "ownership.section16.holding.amount_owned", operator: s.operator, value: s.amount },
  ];
}
export function reportedHoldingsConditionText(s: ReportedHoldingsSettings) {
  return `Form ${s.form} · ${s.securityTitle} · Reported shares ${s.operator === "eq" ? "equal to" : s.operator === "gte" ? "at least" : "at most"} ${s.amount}`;
}
