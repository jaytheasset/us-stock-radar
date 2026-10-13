import { z } from "zod";

const text = z.string().min(1).max(500);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const scalar = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
const conditionValue = z.union([scalar, z.array(scalar).max(100)]);

/** Small display contract. Adapters supply saved facts, never current monitor/reader values. */
export const secondaryMonitorEvidenceSchema = z.object({
  version: z.literal("secondary_monitor_evidence_v1"),
  family: z.literal("form144"),
  eventId: z.string().uuid(),
  rawItemId: z.string().uuid(),
  sourceExecutionId: z.string().uuid(),
  accessionNumber: z.string().regex(/^\d{10}-\d{2}-\d{6}$/),
  filingForm: z.enum(["144", "144/A"]),
  filedAt: timestamp.nullable(),
  evaluatedAt: timestamp,
  persistedAt: timestamp,
  parserVersion: text,
  rowIndex: z.number().int().nonnegative(),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  companyName: text.nullable(),
  ticker: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,14}$/).nullable(),
  sourceUrl: z.string().nullable(),
  conditions: z.array(z.object({
    key: text, label: text, operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "before", "after", "within_days"]),
    expected: conditionValue,
    fact: scalar.nullable(),
    factStatus: z.enum(["stored", "not_preserved"]),
  }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  if (value.sourceUrl !== null && !safeSecEvidenceUrl(value.sourceUrl, value.accessionNumber)) {
    ctx.addIssue({ code: "custom", message: "Source URL does not identify this accession" });
  }
  for (const condition of value.conditions) {
    if ((condition.factStatus === "stored") !== (condition.fact !== null)) {
      ctx.addIssue({ code: "custom", message: "Fact status mismatch" });
    }
  }
});

export type SecondaryMonitorEvidence = z.infer<typeof secondaryMonitorEvidenceSchema>;
export type SecondaryMonitorDisplay = Readonly<{
  status: "stored" | "partial" | "not_preserved" | "invalid";
  evidence: SecondaryMonitorEvidence | null;
}>;

export function secondaryMonitorDisplay(value: unknown, eventId: unknown, sourceExecutionId: unknown): SecondaryMonitorDisplay {
  if (value === null || value === undefined) return { status: "not_preserved", evidence: null };
  const parsed = secondaryMonitorEvidenceSchema.safeParse(value);
  if (!parsed.success || parsed.data.eventId !== eventId || parsed.data.sourceExecutionId !== sourceExecutionId) {
    return { status: "invalid", evidence: null };
  }
  return {
    status: parsed.data.conditions.every(c => c.factStatus === "stored") ? "stored" : "partial",
    evidence: parsed.data,
  };
}

export function safeSecEvidenceUrl(value: unknown, accession: string): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.sec.gov"
      && !url.username && !url.password && !url.port && !url.search && !url.hash
      && new RegExp(`^/Archives/edgar/data/[0-9]+/${accession.replaceAll("-", "")}/[^/]+$`).test(url.pathname)
      ? value : null;
  } catch { return null; }
}
