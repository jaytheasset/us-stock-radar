import { financialTargetSchema, type FinancialTarget } from "./financialMonitorTarget.ts";
import { z } from "zod";
import { getReadyMonitorCondition } from "./conditionRegistry.ts";
import { safeSecEvidenceUrl } from "./secondaryMonitorEvidence.ts";
import type { FinancialMonitorFactReadResult } from "./financialMonitorFacts.ts";
import type { CanonicalFinancialMonitorCondition } from "./financialMonitorPersistence.ts";
import type { SecPeriodicFinancialEvidence } from "../sec-structured-data/periodicFinancialResolver.ts";

const decimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const text = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const period = z.discriminatedUnion("kind", [z.object({ kind: z.literal("instant"), instant: date }).strict(), z.object({ kind: z.literal("duration"), startDate: date, endDate: date }).strict()]);
const observation = z.object({
  value: decimal, currency: z.string().regex(/^[A-Z]{3}$/), period,
  concept: text, namespace: text, taxonomy: text,
  filingFacts: z.array(z.object({ artifactId: text, hash: z.string().regex(/^[a-f0-9]{64}$/i), url: text, factKey: text, contextRef: text, lexical: z.string(), scale: z.string().nullable(), sign: z.string().nullable() }).strict()).min(1),
  companyFacts: z.array(z.object({ rawId: text, factKey: text, path: text }).strict()).min(1),
}).strict();
export const financialMonitorEvidenceSchema = z.object({
  version: z.literal("financial_monitor_evidence_v1"), eventId: z.string().uuid(), rawItemId: z.string().uuid(), sourceExecutionId: z.string().uuid(),
  accession: z.string().regex(/^\d{10}-\d{2}-\d{6}$/), issuerCik: z.string().regex(/^\d{10}$/), form: text,
  filedAt: text, evaluatedAt: text, persistedAt: text,
  companyName: text.nullable(), ticker: text.nullable(),
  target: z.object({ selected: financialTargetSchema, confirmed: financialTargetSchema }).strict().optional(),
  matches: z.array(z.object({
    condition: z.object({ key: text, operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]), value: decimal, currency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
    label: text, basis: z.enum(["QUARTER", "YEAR_TO_DATE", "ANNUAL", "INSTANT", "QUARTER_AND_YEAR_TO_DATE"]),
    actual: decimal, current: observation, priorYear: observation.nullable(),
  }).strict()).min(1),
}).strict().superRefine((e, ctx) => {
  if (![e.filedAt, e.evaluatedAt, e.persistedAt].every(t => Number.isFinite(Date.parse(t)))) ctx.addIssue({ code: "custom", message: "Invalid timestamp" });
  if (e.target && (e.target.selected.issuerCik !== e.issuerCik || e.target.confirmed.issuerCik !== e.issuerCik
    || e.target.selected.ticker !== e.target.confirmed.ticker || e.ticker !== e.target.selected.ticker
    || e.companyName !== e.target.selected.companyName)) ctx.addIssue({ code: "custom", message: "Invalid target binding" });
  for (const m of e.matches) {
    const def = getReadyMonitorCondition(m.condition.key);
    if (def?.family !== "financial" || def.source.jsonPath?.[1] !== m.basis || m.condition.currency !== m.current.currency
      || (m.priorYear && m.priorYear.currency !== m.condition.currency)
      || (m.condition.key.endsWith(".current") && m.actual !== m.current.value)
      || (m.condition.key.endsWith(".yoy_change") && !m.priorYear)) ctx.addIssue({ code: "custom", message: "Invalid match identity" });
    for (const o of [m.current, m.priorYear]) for (const f of o?.filingFacts ?? []) {
      if (!safeSecEvidenceUrl(f.url, e.accession)) ctx.addIssue({ code: "custom", message: "Invalid SEC source" });
    }
  }
});
export type FinancialMonitorEvidence = z.infer<typeof financialMonitorEvidenceSchema>;

/** Only called after MATCH, with the same already-read official result. No recalculation. */
export function buildFinancialMonitorEvidence(facts: Extract<FinancialMonitorFactReadResult, { status: "available" }>, conditions: readonly CanonicalFinancialMonitorCondition[], evaluatedAt: string, companyName: string | null, target?: { selected: FinancialTarget; confirmed: FinancialTarget }): FinancialMonitorEvidence {
  return financialMonitorEvidenceSchema.parse({
    version: "financial_monitor_evidence_v1", eventId: facts.eventId, rawItemId: facts.rawItemId, sourceExecutionId: facts.sourceExecutionId,
    accession: facts.accession, issuerCik: facts.issuerCik, form: facts.form,
    filedAt: facts.analysis.filing?.acceptedAt || facts.analysis.filing?.filedDate,
    evaluatedAt, persistedAt: facts.persistedAt, companyName: target?.selected.companyName ?? companyName, ticker: target?.selected.ticker ?? null,
    ...(target ? { target } : {}),
    matches: conditions.map(condition => {
      const definition = getReadyMonitorCondition(condition.key)!;
      const [metric, basis] = definition.source.jsonPath!;
      const comparison = facts.analysis.comparisons.find(row => row.metric === metric && row.basis === basis)!;
      const yoy = condition.key.endsWith(".yoy_change");
      return { condition, label: definition.display?.label || condition.key, basis,
        actual: yoy ? (comparison.change.status === "AVAILABLE" ? comparison.change.absoluteChange : null) : comparison.current.normalizedValue,
        current: copyObservation(comparison.current), priorYear: yoy && comparison.priorYear ? copyObservation(comparison.priorYear) : null };
    }),
  });
}

export function readFinancialMonitorEvidence(value: unknown, row: { eventId: string; sourceExecutionId: string; accession: string; issuerCik: string }) {
  if (value == null) return { status: "not_preserved" as const, evidence: null };
  const p = financialMonitorEvidenceSchema.safeParse(value);
  if (!p.success || p.data.eventId !== row.eventId || p.data.sourceExecutionId !== row.sourceExecutionId || p.data.accession !== row.accession || p.data.issuerCik !== row.issuerCik) return { status: "invalid" as const, evidence: null };
  return { status: "stored" as const, evidence: p.data };
}

function copyObservation(e: SecPeriodicFinancialEvidence) {
  return { value: e.normalizedValue, currency: e.currency, period: e.period, concept: e.concept, namespace: e.conceptNamespaceUri, taxonomy: e.taxonomy,
    filingFacts: e.filingFacts.map(f => ({ artifactId: f.source.artifactId, hash: f.source.contentHash, url: f.source.sourceUrl, factKey: f.factKey, contextRef: f.contextRef, lexical: f.valueText, scale: f.scale, sign: f.sign })),
    companyFacts: e.companyFacts.map(f => ({ rawId: f.sourceRawId, factKey: f.sourceFactKey, path: f.sourceFactPath })) };
}
