import { z } from "zod";

const ticker = z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,11}$/);
const cik = z.string().regex(/^\d{10}$/).refine(v => /[1-9]/.test(v));
export const financialTargetSelectionSchema = z.object({
  ticker, issuerCik: cik, sourceRawId: z.string().uuid(), refreshSequence: z.string().regex(/^[1-9]\d*$/),
}).strict();
export const financialTargetSchema = financialTargetSelectionSchema.extend({
  version: z.literal("financial_monitor_target_v1"), scope: z.literal("issuer"),
  companyName: z.string().trim().min(1), exchange: z.string().trim().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  confirmedAt: z.string().datetime({ offset: true }), verifiedAt: z.string().datetime({ offset: true }),
}).strict();
export type FinancialTarget = z.infer<typeof financialTargetSchema>;
export type FinancialTargetSelection = z.infer<typeof financialTargetSelectionSchema>;
export type FinancialTargetResult = { status: "available"; target: FinancialTarget } | { status: "unavailable" };
export function financialTargetSelection(target: FinancialTarget): FinancialTargetSelection {
  return { ticker: target.ticker, issuerCik: target.issuerCik, sourceRawId: target.sourceRawId, refreshSequence: target.refreshSequence };
}
export function sameFinancialTargetSelection(a: FinancialTargetSelection, b: FinancialTargetSelection) {
  return a.ticker === b.ticker && a.issuerCik === b.issuerCik && a.sourceRawId === b.sourceRawId && a.refreshSequence === b.refreshSequence;
}
