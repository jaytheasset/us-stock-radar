import { readCurrentListingRiskFacts, type ListingRiskPersistenceDependencies } from "../monitor/listingRiskPersistence.ts";
import { applyCurrentListingRiskEvidence, evaluateStoredForm25, evaluateStoredListingRiskFiling, record, validDate, validScope,
  SEC_DELISTING_STATE_VERSION, type DelistingEvidence, type DelistingScope, type DelistingState, type TradingState } from "./state.ts";

type Row = Record<string, unknown>;
export type DelistingRepository = ListingRiskPersistenceDependencies & {
  select(table: string, query: Record<string, string>): Promise<{ ok: boolean; status: number; data: unknown; error?: string }>;
};
export type StoredDelistingState = {
  version: typeof SEC_DELISTING_STATE_VERSION;
  scope: DelistingScope; asOf: string;
  coverage: "selected_stored_filing_evidence_only";
  listing: DelistingState; trading: TradingState;
  catalog: "inactive_only" | "active_flag_only" | "unavailable";
  reasons: string[]; evidence: DelistingEvidence[];
};

/** Read-only projection. The caller supplies exact stored filing IDs, not a
 * ticker alias. No claim of complete SEC history, live listing status, restored
 * listing, or trading cessation on every venue is made. No automatic trigger. */
export async function readStoredDelistingState(input: {
  scope: DelistingScope; rawItemIds: string[]; asOf: string;
  catalogIsActive?: boolean | null; repository?: DelistingRepository;
}): Promise<StoredDelistingState> {
  const result: StoredDelistingState = {
    version: SEC_DELISTING_STATE_VERSION, scope: input.scope, asOf: input.asOf,
    coverage: "selected_stored_filing_evidence_only", listing: "unresolved", trading: "unresolved",
    catalog: input.catalogIsActive === false ? "inactive_only" : input.catalogIsActive === true ? "active_flag_only" : "unavailable",
    reasons: [], evidence: [],
  };
  const ids = [...new Set(input.rawItemIds)];
  if (!validScope(input.scope) || !validDate(input.asOf) || ids.length > 100
    || ids.some((id) => !/^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id))) {
    return { ...result, reasons: ["invalid_request"] };
  }
  if (!ids.length) return { ...result, reasons: ["no_filing_evidence", "catalog_flag_is_not_listing_evidence"] };
  const repository = input.repository || await defaultRepository();
  try {
    for (const id of ids) {
      const rawResponse = await repository.select("raw_items", { select: "*", id: `eq.${id}`, limit: "2" });
      if (!rawResponse.ok || !Array.isArray(rawResponse.data) || rawResponse.data.length !== 1) {
        return { ...result, listing: "unresolved", trading: "unresolved", reasons: ["raw_source_missing_or_read_failed"] };
      }
      const raw = record(rawResponse.data[0]);
      if (raw.id !== id) return { ...result, reasons: ["raw_identity_mismatch"] };
      const eventResponse = await repository.select("events", {
        select: "id,raw_item_id,source_code,metadata", raw_item_id: `eq.${id}`, limit: "2",
      });
      if (!eventResponse.ok || !Array.isArray(eventResponse.data) || eventResponse.data.length > 1) {
        return { ...result, listing: "unresolved", trading: "unresolved", reasons: ["event_read_failed_or_ambiguous"] };
      }
      const event = eventResponse.data.length ? record(eventResponse.data[0]) : null;
      let evaluated = event && /^(8-K|6-K)(\/A)?$/.test(String(record(raw.raw_payload).form_type))
        ? evaluateStoredListingRiskFiling({ raw, event, scope: input.scope, asOf: input.asOf })
        : evaluateStoredForm25({ raw, event, scope: input.scope, asOf: input.asOf });
      if (event) {
        const current = await readCurrentListingRiskFacts(String(event.id), repository);
        evaluated = applyCurrentListingRiskEvidence(evaluated, current, input.scope, input.asOf);
      }
      result.evidence.push(evaluated);
    }
  } catch {
    return { ...result, listing: "unresolved", trading: "unresolved", reasons: ["evidence_reader_failed"] };
  }
  // No arbitrary newest-row wins or amendment assumption. Conflicting or
  // incomplete selected evidence remains visible and prevents confirmation.
  const listingStates = new Set(result.evidence.map((item) => item.listing));
  const tradingStates = new Set(result.evidence.map((item) => item.trading));
  const dates = new Set(result.evidence.map((item) => item.removalDate).filter(Boolean));
  if (listingStates.size === 1 && dates.size <= 1) result.listing = result.evidence[0].listing;
  else result.reasons.push("selected_evidence_conflicting_or_incomplete");
  if (tradingStates.size === 1) result.trading = result.evidence[0].trading;
  result.reasons.push(...new Set(result.evidence.flatMap((item) => item.reasons)));
  return result;
}

async function defaultRepository(): Promise<DelistingRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
