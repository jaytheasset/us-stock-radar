import { createDilutionStoredSplitClauseBinding } from "./corporateActionAdjustment.ts";
import { parseDilutionRegistryJson as parse } from "./previewCore.ts";
export * from "./previewCore.ts";

// Keep the synchronous server contract, including stored SHA-256 validation.
export function parseDilutionRegistryJson(source: string) {
  return parse(source, createDilutionStoredSplitClauseBinding);
}
