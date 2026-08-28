import { createHash } from "node:crypto";
import { parseDilutionRegistryJson } from "./preview.ts";

export const DILUTION_REGISTRY_PASTE_ID_PREFIX = "dilution-registry:v1:";

/**
 * Returns the stable identity of the exact UTF-8 text that passed Preview.
 * Whitespace, object-key order, and numeric spelling are intentionally part of
 * the identity. The future trusted server must pass this same source text to
 * the database RPC, which independently verifies the digest and parsed value.
 */
export function createDilutionRegistryPasteIdFromSource(
  source: string,
): string {
  const parsed = parseDilutionRegistryJson(source);
  if (!parsed.ok) {
    throw new Error(
      `Invalid Dilution Registry Preview JSON: ${parsed.errors.join(" ")}`,
    );
  }

  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  return `${DILUTION_REGISTRY_PASTE_ID_PREFIX}${digest}`;
}
