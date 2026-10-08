import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const PURPOSE = "sec_os_snapshot";
export const REVISION = "os_snapshot_v1-prompt-r2";
export const PROFILE = "codex-cli:gpt-6-astra:high:v1";
export const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const record = (x: unknown): Record<string, any> => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, any> : {};
export function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") return `{${Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(x) ?? "null";
}
export const contractDir = resolve(process.cwd(), "lib/sec-os-snapshot/contracts", REVISION);
export const schemaText = readFileSync(resolve(contractDir, "os-snapshot-v1.schema.json"), "utf8");
export const promptText = readFileSync(resolve(contractDir, "extraction-instructions.md"), "utf8");
export const schemaHash = sha(schemaText), promptHash = sha(promptText);
if (schemaHash !== "d7b69bbedc8c1653c6d7f50144836fc884b29919356bb70b71350293f4cdddb2" || promptHash !== "60f2cf5f15f51410dc5cd7b605a336078195d406b093a350dcaa298bf44a5771") throw Error("os_contract_hash_mismatch");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(JSON.parse(schemaText));
export type Filing = { issuer: string; cik: string; accession: string; form: string; filing_date: string };
export type Document = { id: string; url: string; original: string; text: string; original_sha256: string; text_sha256: string };
export type Block = { id: string; document_id: string; line_start: number; line_end: number; text: string; sha256: string };
export type Source = { filing: Filing; ticker: string | null; documents: Document[]; blocks: Block[]; fingerprint: string };
export type Snapshot = { version: string; filing: Filing; status: "PASS" | "REVIEW_REQUIRED" | "NO_DIRECT_CURRENT_OS"; current_os: OsRecord[]; review: null | { code: string; candidates: OsRecord[] } };
export type OsRecord = { scope: string; share_class: string | null; quantity: string; as_of_date: string | null; as_of_text: string; evidence_blocks: string[] };
/** Detection only. Neither AJV defaults/coercion nor semantic repair is enabled. */
export function validateOutput(raw: string, source: Source) {
  const errors: unknown[] = [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, stage: "parse", errors: ["Invalid JSON"], meaning: "NOT_ASSESSED" as const, value: null }; }
  if (!validateSchema(value)) return { ok: false, stage: "schema", errors: structuredClone(validateSchema.errors), meaning: "NOT_ASSESSED" as const, value: null };
  const v = value as Snapshot;
  if (stable(v.filing) !== stable(source.filing)) errors.push("Filing identity mismatch");
  const blocks = new Map(source.blocks.map(b => [b.id,b])), docs = new Map(source.documents.map(d => [d.id,d]));
  if (blocks.size !== source.blocks.length || docs.size !== source.documents.length) errors.push("Duplicate source IDs");
  for (const row of [...v.current_os, ...(v.review?.candidates ?? [])]) for (const id of row.evidence_blocks) {
    const b = blocks.get(id), d = b && docs.get(b.document_id);
    if (!b || !d) { errors.push(`Unknown evidence: ${id}`); continue; }
    if (sha(d.original) !== d.original_sha256 || sha(d.text) !== d.text_sha256 || sha(b.text) !== b.sha256 || d.text.split("\n").slice(b.line_start-1,b.line_end).join("\n") !== b.text) errors.push(`Source integrity: ${id}`);
  }
  return { ok: errors.length === 0, stage: errors.length ? "reference" : "complete", errors, meaning: "NOT_ASSESSED" as const, value: errors.length ? null : v };
}
