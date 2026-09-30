import "server-only";
import { readStoredForm25Source } from "../sources/sec/forms/form25/storedSource.ts";
import { validDate, record } from "../sec-delisting-state/state.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";
import { persistSecListingObservation } from "./persistence.ts";

export type Form25ListingPersistenceRecord = {
  rawItemId: string; accession: string;
  status: "inserted" | "replayed" | "unavailable" | "failed" | "not_applicable";
  reason?: string; observationId?: string; evaluatedAsOf?: string;
  attachment?: string; listing?: string; trading?: string;
};

/** Source-only ingest sidecar. Never invokes Primary, Monitor or an LLM. */
export async function persistForm25ListingStatusAutomatically(input: {
  rawItemId: string; accession: string; repository?: SecTickerResolutionRepository;
}): Promise<Form25ListingPersistenceRecord> {
  const base = { rawItemId: input.rawItemId, accession: input.accession };
  try {
    const repository = input.repository ?? await defaultRepository();
    const r = await repository.select("raw_items", { select: "*", id: `eq.${input.rawItemId}`, limit: "2" });
    if (!r.ok || !Array.isArray(r.data) || r.data.length !== 1)
      return { ...base, status: "failed", reason: "stored_raw_missing_or_read_failed" };
    const raw = record(r.data[0]);
    if (raw.id !== input.rawItemId || raw.source_code !== "sec_edgar" || raw.source_unique_id !== input.accession)
      return { ...base, status: "unavailable", reason: "stored_raw_identity_mismatch" };
    if (!/^(25|25-NSE)(\/A)?$/.test(String(record(raw.raw_payload).form_type ?? "")))
      return { ...base, status: "not_applicable" };
    const source = readStoredForm25Source(raw);
    if (source.status !== "available") return { ...base, status: "unavailable", reason: source.reason };
    // Stable source-time observation; not a claim that filing date is effective
    // date. The existing as-of reader reevaluates only explicit source dates.
    const asOf = String(raw.published_at ?? "").slice(0, 10);
    if (!validDate(asOf)) return { ...base, status: "unavailable", reason: "filing_date_unavailable" };
    const saved = await persistSecListingObservation({ rawItemId: input.rawItemId, asOf, repository });
    return { ...base, status: saved.status as "inserted" | "replayed", observationId: saved.id,
      evaluatedAsOf: asOf, attachment: saved.observation.attachment.status,
      listing: saved.observation.reported.listing, trading: saved.observation.reported.trading };
  } catch (error) {
    return { ...base, status: "failed", reason: error instanceof Error ? error.message : "listing_observation_persistence_exception" };
  }
}

async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
