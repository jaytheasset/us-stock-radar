import "server-only";
import { buildS8DirectFacts, hash, isS8Form, record, stable, S8_DIRECT_VERSION } from "./directFacts.ts";

type Row = Record<string, unknown>;
type Result = { ok: boolean; data: unknown; error?: string };
export type S8Repository = {
  select(table: string, query: Record<string, string>): Promise<Result>;
  rpc(name: string, payload: Row): Promise<Result>;
};
async function repository(): Promise<S8Repository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(record) : [];

/** Always build from the stored raw source, never a caller-supplied parser/LLM answer. */
export async function persistS8Registration(input: { rawItemId: string; repository?: S8Repository }) {
  const repo = input.repository ?? await repository();
  const rawResult = await repo.select("raw_items", { select: "*", id: `eq.${input.rawItemId}`, limit: "1" });
  if (!rawResult.ok) throw new Error("s8_raw_read_failed");
  const raw = rows(rawResult.data)[0];
  if (!raw) throw new Error("s8_raw_missing");
  if (!isS8Form(record(raw.raw_payload).form_type)) return { status: "not_applicable" as const };
  const built = buildS8DirectFacts(raw);
  const result = await repo.rpc("persist_sec_s8_registration", {
    p_raw_item_id: input.rawItemId, p_facts: built.facts, p_sources: built.source,
    p_source_sha256: built.sourceSha256, p_facts_sha256: built.factsSha256,
  });
  if (!result.ok) throw new Error(`s8_persistence_failed:${result.error || "unknown"}`);
  const response = record(result.data);
  if (!["inserted", "replayed"].includes(String(response.status))) throw new Error("s8_write_response_invalid");
  return { status: "available" as const, writeStatus: String(response.status), accession: built.facts.accessionNumber,
    registrationRowCount: built.facts.registrationRows.length, planCount: built.facts.plans.length };
}

export async function readS8Registration(accession: string, supplied?: S8Repository) {
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) return { status: "unavailable" as const, reason: "invalid_accession" };
  const repo = supplied ?? await repository();
  const result = await repo.select("sec_s8_registration_filings", { select: "*", accession_number: `eq.${accession}`, limit: "1" });
  if (!result.ok) return { status: "unavailable" as const, reason: "s8_history_read_failed" };
  const row = rows(result.data)[0];
  if (!row) return { status: "not_found" as const };
  try {
    // Validate immutable stored evidence, including every field/quote, independently
    // of refreshed raw envelopes. Historical source remains in this snapshot.
    const facts = record(row.facts);
    if (facts.version !== S8_DIRECT_VERSION || row.accession_number !== accession
      || row.issuer_cik !== facts.issuerCik || row.form_type !== facts.formType
      || hash(stable(row.sources)) !== row.source_sha256 || hash(stable(facts)) !== row.facts_sha256)
      throw new Error("s8_stored_hash_or_identity_mismatch");
    const source = record(row.sources);
    const documents = rows(source.documents);
    const rebuilt = buildS8DirectFacts({ source_unique_id: accession, raw_payload: {
      accession_number: accession, cik: row.issuer_cik, form_type: row.form_type,
      filing_date: facts.filingDate, accepted_at: facts.acceptedAt,
      primary_document_url: documents.find(d => d.isPrimary === true)?.url, s8_source: source,
    } });
    if (stable(rebuilt.facts) !== stable(facts)) throw new Error("s8_direct_facts_revalidation_failed");
    return { status: "available" as const, facts: rebuilt.facts,
      provenance: { rawItemId: row.raw_item_id, sourceSha256: row.source_sha256, factsSha256: row.facts_sha256,
        sources: documents.map(d => ({ url: d.url, sha256: d.sha256, truncated: d.truncated })) } };
  } catch (error) { return { status: "unavailable" as const, reason: error instanceof Error ? error.message : "s8_revalidation_failed" }; }
}

export async function readS8RegistrationHistory(issuerCik: string, supplied?: S8Repository) {
  if (!/^\d{10}$/.test(issuerCik) || /^0+$/.test(issuerCik)) return { status: "unavailable" as const, reason: "invalid_issuer_cik" };
  const repo = supplied ?? await repository();
  const result = await repo.select("sec_s8_registration_filings", { select: "accession_number", issuer_cik: `eq.${issuerCik}`,
    order: "accession_number.desc", limit: "101" });
  if (!result.ok) return { status: "unavailable" as const, reason: "s8_history_read_failed" };
  const entries = rows(result.data);
  const filings = await Promise.all(entries.slice(0, 100).map(r => readS8Registration(String(r.accession_number), repo)));
  return { status: "available" as const, filings, truncated: entries.length > 100 };
}
