import { buildS8DirectFacts, hash, record, stable } from "./directFacts.ts";
import { buildS8StructuredSource } from "./structuredSource.ts";
import { parseS8Structured, S8_STRUCTURED_VERSION } from "./structuredContract.ts";
import { readS8Registration, type S8Repository } from "./persistence.ts";

export const S8_STRUCTURED_MODEL = "gemini-3.5-flash";
export const S8_STRUCTURED_PURPOSE = "sec_s8_structured";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rows = (value: unknown) => Array.isArray(value) ? value.map(record) : [];
export async function s8Repository(): Promise<S8Repository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
export function s8ExecutionId(rawItemId: string, fingerprint: string, version = S8_STRUCTURED_VERSION) {
  const h = hash(stable([S8_STRUCTURED_PURPOSE, rawItemId, fingerprint, version, "automatic"]));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Reconstruct only stored raw and independently validated direct history. No event/Primary dependency. */
export async function loadS8StructuredInput(rawItemId: string, repo: S8Repository) {
  if (!uuid.test(rawItemId)) throw new Error("s8_invalid_raw_item_id");
  const result = await repo.select("raw_items", { select: "*", id: `eq.${rawItemId}`, limit: "1" });
  if (!result.ok) throw new Error("s8_raw_read_failed");
  const raw = rows(result.data)[0];
  if (!raw || raw.id !== rawItemId || raw.source_code !== "sec_edgar") throw new Error("s8_raw_identity_invalid");
  const source = buildS8StructuredSource(raw);
  const direct = await readS8Registration(source.identity.accession, repo);
  if (direct.status !== "available") throw new Error("s8_direct_unavailable");
  if (direct.provenance.rawItemId !== rawItemId || direct.provenance.sourceSha256 !== source.sourceSha256
    || direct.provenance.factsSha256 !== source.directFactsSha256) throw new Error("s8_direct_source_mismatch");
  const original = buildS8DirectFacts(raw).source;
  const binding = { rawItemId, accession: source.identity.accession, issuerCik: source.identity.issuerCik,
    formType: source.identity.form, sourceFingerprint: source.fingerprint, sourceSha256: source.sourceSha256,
    directFactsSha256: source.directFactsSha256, contractVersion: S8_STRUCTURED_VERSION,
    attempt: "automatic", model: S8_STRUCTURED_MODEL, acceptedAt: direct.facts.acceptedAt, source, original };
  return { raw, source, direct, binding, executionId: s8ExecutionId(rawItemId, source.fingerprint) };
}
export type S8StructuredInput = Awaited<ReturnType<typeof loadS8StructuredInput>>;
export async function s8Rpc(repo: S8Repository, name: string, payload: Record<string, unknown>) {
  const result = await repo.rpc(name, payload);
  if (!result.ok) throw new Error(`${name}:${result.error || "failed"}`);
  return record(result.data);
}
export async function reserveS8Structured(rawItemId: string, repo: S8Repository) {
  const input = await loadS8StructuredInput(rawItemId, repo);
  const reserved = await s8Rpc(repo, "reserve_sec_s8_structured", { p_id: input.executionId, p_binding: input.binding });
  return { ...input, reserved: reserved.inserted === true };
}
/** Current-source reader. Old runs/outputs remain auditable, never silently reused after a refresh. */
export async function readS8Structured(rawItemId: string, supplied?: S8Repository) {
  const repo = supplied ?? await s8Repository();
  try {
    const input = await loadS8StructuredInput(rawItemId, repo);
    const result = await repo.select("ai_runs", { select: "*", id: `eq.${input.executionId}`, limit: "1" });
    if (!result.ok) throw new Error("s8_run_read_failed");
    const run = rows(result.data)[0];
    if (!run) return { status: "unavailable" as const, reason: "structured_missing" };
    if (run.raw_item_id !== rawItemId || run.prompt_key !== S8_STRUCTURED_PURPOSE
      || run.prompt_version !== S8_STRUCTURED_VERSION || run.model !== S8_STRUCTURED_MODEL
      || stable(record(run.metadata).binding) !== stable(input.binding)) throw new Error("s8_execution_binding_mismatch");
    if (run.status !== "succeeded") return { status: "unavailable" as const, reason: `execution_${run.status}` };
    const output = await repo.select("ai_outputs", { select: "*", ai_run_id: `eq.${input.executionId}`,
      output_type: `eq.${S8_STRUCTURED_PURPOSE}`, limit: "2" });
    if (!output.ok) throw new Error("s8_output_read_failed");
    const list = rows(output.data);
    if (list.length !== 1) throw new Error("s8_output_count_invalid");
    const payload = record(list[0].payload);
    if (stable(payload.binding) !== stable(input.binding) || typeof payload.outputText !== "string"
      || payload.outputSha256 !== hash(payload.outputText)) throw new Error("s8_output_binding_mismatch");
    const validated = parseS8Structured(payload.outputText, input.source);
    if (!validated.ok) throw new Error("s8_stored_output_invalid");
    return { status: "available" as const, direct: input.direct.facts, semantic: validated.result.semantic,
      evidence: validated.result.evidence, provenance: { executionId: input.executionId, outputId: list[0].id,
        rawItemId, sourceFingerprint: input.source.fingerprint, sourceSha256: input.source.sourceSha256,
        directFactsSha256: input.source.directFactsSha256, contractVersion: S8_STRUCTURED_VERSION,
        model: run.model, createdAt: record(run.metadata).reservedAt, completedAt: run.finished_at } };
  } catch (error) { return { status: "unavailable" as const, reason: error instanceof Error ? error.message : "s8_reader_failed" }; }
}
