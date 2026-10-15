import { parseDilutionSplitClauseBinding } from "./corporateActionBinding.ts";
import { parseDilutionRegistryJson as parse } from "./previewCore.ts";
export * from "./previewCore.ts";

// Web Crypto is async; keep it outside the shared synchronous validation rules.
export async function parseDilutionRegistryJson(source: string) {
  const hashes = new Map<string, string>();
  try {
    const value = JSON.parse(source);
    if (Array.isArray(value?.corporate_action_clause_bindings)) {
      for (const binding of value.corporate_action_clause_bindings) {
        const url = typeof binding?.source_document_url === "string"
          ? binding.source_document_url.trim()
          : "";
        if (hashes.has(url)) continue;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
        hashes.set(url, Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
      }
    }
  } catch {
    // JSON and digest failures fail closed through the same Preview errors.
  }
  return parse(source, (issuerCik, value) => parseDilutionSplitClauseBinding(
    issuerCik,
    value,
    (rawItemId, url) => {
      const hash = hashes.get(url);
      if (!hash) throw new Error("Dilution contract source identity is invalid");
      return `sec-raw:v1:${rawItemId.toLowerCase()}:${hash}`;
    },
  ));
}
