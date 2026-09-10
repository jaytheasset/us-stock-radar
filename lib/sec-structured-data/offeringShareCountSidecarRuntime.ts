import type { OfferingMonitorJobIdentity } from "../offeringMonitorJobFoundation.ts";
import { readOfferingMonitorParentAuthority } from "../offeringMonitorJobRepository.ts";
import { supabaseSelect } from "../supabase.ts";
import { persistLevel2ShareCountObservationFromSecRawItem } from "./level2ShareCountPersistenceRuntime.ts";
import {
  OFFERING_SHARE_COUNT_SIDECAR_ANALYZER_KEY,
  type OfferingShareCountSidecarDependencies,
} from "./offeringShareCountSidecar.ts";

export const offeringShareCountSidecarRuntimeDependencies: OfferingShareCountSidecarDependencies = {
  readParentAuthority: readOfferingMonitorParentAuthority,
  loadRawItem: loadExactOfferingShareCountRawItem,
  persist: async ({ identity, rawItem, candidate }) => persistLevel2ShareCountObservationFromSecRawItem({
    candidate,
    rawItem,
    eventId: identity.eventId,
    rawItemId: identity.rawItemId,
    parentPrimaryAiRunId: identity.parentPrimaryAiRunId,
    sourceExecutionId: identity.executionId,
    analyzerKey: OFFERING_SHARE_COUNT_SIDECAR_ANALYZER_KEY,
  }),
};

export async function loadExactOfferingShareCountRawItem(identity: OfferingMonitorJobIdentity) {
  const result = await supabaseSelect("raw_items", {
    select: "*",
    id: `eq.${identity.rawItemId}`,
    source_unique_id: `eq.${identity.sourceIdentity}`,
    source_code: "eq.sec_edgar",
    limit: "1",
  });
  if (!result.ok) {
    throw new Error(`Offering O/S exact raw item read failed: ${result.error || result.status}`);
  }
  const rows = Array.isArray(result.data) ? result.data : [];
  const row = record(rows[0]);
  if (!row || text(row.id) !== identity.rawItemId || text(row.source_unique_id) !== identity.sourceIdentity) {
    throw new Error("Offering O/S exact raw item is missing");
  }
  return row;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
