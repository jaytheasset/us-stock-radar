import { readS8Structured } from "../sec-s8/structuredPersistence.ts";
import type { S8Repository } from "../sec-s8/persistence.ts";

export type S8MonitorFacts =
  | { status: "not_ready"; reason: string }
  | { status: "available"; facts: { filing_kind: string | null }; provenance: unknown };

/** No array reduction, row sums or semantic correction. This adapter has no alert consumer. */
export function s8MonitorFacts(result: Awaited<ReturnType<typeof readS8Structured>>): S8MonitorFacts {
  if (result.status !== "available") return { status: "not_ready", reason: result.reason };
  return { status: "available", facts: {
    filing_kind: result.semantic.unresolved.includes("filing_kind") ? null : result.semantic.filing_kind,
  }, provenance: result.provenance };
}
export async function readS8MonitorFacts(rawItemId: string, repository?: S8Repository) {
  return s8MonitorFacts(await readS8Structured(rawItemId, repository));
}
