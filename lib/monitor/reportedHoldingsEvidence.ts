import { z } from "zod";
import { financialTargetSchema } from "./financialMonitorTarget.ts";
import { reportedHoldingsSettingsSchema } from "./reportedHoldings.ts";
import { safeSecEvidenceUrl } from "./secondaryMonitorEvidence.ts";
import { readReportedHoldingsFilingTime, reportedHoldingsWasActive } from "./reportedHoldingsTime.ts";
import { compareExactDecimals } from "./periodicFinancialMonitor.ts";

const field = z.object({ xmlPath: z.string().min(1), status: z.enum(["exact", "empty", "footnote_only", "missing"]), rawValue: z.string().nullable(), footnoteIds: z.array(z.string()) }).strict();
export const reportedHoldingsEvidenceSchema = z.object({
  version: z.literal("reported_holdings_evidence_v1"), family: z.literal("section16_holdings"),
  rawItemId: z.string().uuid(), accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  issuerCik: z.string().regex(/^\d{10}$/), filingForm: z.enum(["3", "5"]),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceUrl: z.string(), parserVersion: z.string().min(1),
  target: financialTargetSchema, confirmedTarget: financialTargetSchema, settings: reportedHoldingsSettingsSchema,
  monitorCreatedAt: z.string().datetime({ offset: true }), evaluatedAt: z.string().datetime({ offset: true }),
  filingTime: z.object({ rawAcceptedAt: z.string().nullable(), rawFilingDate: z.string().nullable(), instant: z.string().datetime({ offset: true }), precision: z.enum(["second", "day"]), timeZone: z.enum(["explicit_offset", "America/New_York"]) }).strict(),
  periodOfReport: z.string().nullable(),
  matches: z.array(z.object({ rowOrdinal: z.number().int().nonnegative(), xmlPath: z.string().min(1), securityTitle: field, amountOwned: field, directOrIndirect: field, natureOfOwnership: field, footnotes: z.array(z.object({ id: z.string(), text: z.string() }).strict()) }).strict()).min(1),
}).strict().superRefine((e, ctx) => {
  const time = readReportedHoldingsFilingTime(e.filingTime.rawAcceptedAt, e.filingTime.rawFilingDate);
  if (!time || time.instant !== e.filingTime.instant || time.precision !== e.filingTime.precision || time.timeZone !== e.filingTime.timeZone || !reportedHoldingsWasActive(e.monitorCreatedAt, time)) ctx.addIssue({ code: "custom", message: "Invalid holding activation time" });
  if (e.target.issuerCik !== e.issuerCik || e.confirmedTarget.issuerCik !== e.issuerCik || e.target.ticker !== e.confirmedTarget.ticker || e.settings.form !== e.filingForm || !safeSecEvidenceUrl(e.sourceUrl, e.accessionNumber)) ctx.addIssue({ code: "custom", message: "Invalid holding evidence identity" });
  if (new Set(e.matches.map(m => m.rowOrdinal)).size !== e.matches.length) ctx.addIssue({ code: "custom", message: "Duplicate holding row" });
  for (const m of e.matches) if (m.securityTitle.status !== "exact" || m.amountOwned.status !== "exact" || !m.securityTitle.rawValue || m.amountOwned.rawValue === null) ctx.addIssue({ code: "custom", message: "Unavailable matched holding" });
  for (const m of e.matches) {
    let comparison: number | null = null;
    try { comparison = compareExactDecimals(m.amountOwned.rawValue ?? "", e.settings.amount); } catch { /* Invalid persisted evidence fails closed. */ }
    if (m.securityTitle.rawValue?.trim() !== e.settings.securityTitle || comparison === null || (e.settings.operator === "eq" ? comparison !== 0 : e.settings.operator === "gte" ? comparison < 0 : comparison > 0)) ctx.addIssue({ code: "custom", message: "Holding evidence condition mismatch" });
  }
});
export type ReportedHoldingsEvidence = z.infer<typeof reportedHoldingsEvidenceSchema>;
export type ReportedHoldingsDisplay = { status: "stored" | "invalid"; evidence: ReportedHoldingsEvidence | null };
export type ReportedHoldingsAlert = { id: string; monitorId: string; createdAt: string; display: ReportedHoldingsDisplay };
