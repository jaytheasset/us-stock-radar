import {
  MINIMAL_OFFERING_MONITOR_VERSION,
  materializeMinimalOfferingMonitor,
  type MinimalOfferingComparisonBasis,
  type MinimalOfferingMaterialized,
  type MinimalOfferingMonitor,
  type MinimalOfferingNumericFact,
} from "../minimalOfferingMonitor.ts";

export const REGISTRY_BACKED_OFFERING_FACT_ADAPTER_VERSION =
  "registry_backed_offering_fact_adapter_v1" as const;

type RepositoryResult = Readonly<{
  ok: boolean;
  status?: number;
  data: unknown;
  error?: string;
}>;

type RegistryRow = Record<string, unknown>;

export type RegistryBackedOfferingFactReason =
  | "event_id_invalid"
  | "event_missing"
  | "event_ambiguous"
  | "event_identity_mismatch"
  | "raw_item_missing"
  | "raw_item_ambiguous"
  | "raw_item_identity_mismatch"
  | "registry_event_missing"
  | "registry_event_ambiguous"
  | "registry_issuer_mismatch"
  | "registry_semantics_unmappable"
  | "reader_unavailable";

export type RegistryBackedOfferingFactReadResult =
  | Readonly<{
      status: "available";
      version: typeof REGISTRY_BACKED_OFFERING_FACT_ADAPTER_VERSION;
      mappingStatus: "mapped" | "unmappable";
      eventId: string;
      rawItemId: string;
      issuerCik: string;
      accession: string;
      canonical: MinimalOfferingMonitor;
      materialized: MinimalOfferingMaterialized;
      registrySnapshotId?: string;
      registrySourceIdentity?: string;
      reason?: "registry_semantics_unmappable";
    }>
  | Readonly<{
      status: "not_ready";
      version: typeof REGISTRY_BACKED_OFFERING_FACT_ADAPTER_VERSION;
      reason: RegistryBackedOfferingFactReason;
    }>;

export type RegistryBackedOfferingFactRepository = Readonly<{
  readEvent(eventId: string): Promise<RepositoryResult>;
  readRawItem(rawItemId: string): Promise<RepositoryResult>;
  readSnapshotsByAccession(accession: string): Promise<RepositoryResult>;
  readInstruments(instrumentIds: readonly string[]): Promise<RepositoryResult>;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const CIK_PATTERN = /^\d{10}$/;

/**
 * Adapts only one exact SEC event/accession and the Registry snapshots carrying
 * that same accession. Issuer totals and latest/current issuer aggregates are
 * intentionally outside this repository boundary.
 */
export async function readRegistryBackedOfferingFacts(
  eventIdValue: string,
  repository?: RegistryBackedOfferingFactRepository,
): Promise<RegistryBackedOfferingFactReadResult> {
  const eventId = stringValue(eventIdValue);
  if (!UUID_PATTERN.test(eventId)) return notReady("event_id_invalid");

  try {
    const resolved = repository || await resolveRepository();
    const eventResult = await resolved.readEvent(eventId);
    if (!eventResult.ok) return notReady("reader_unavailable");
    const eventRows = rows(eventResult.data);
    if (eventRows.length === 0) return notReady("event_missing");
    if (eventRows.length !== 1) return notReady("event_ambiguous");
    const event = eventRows[0];
    const rawItemId = stringValue(event.raw_item_id);
    const eventMetadata = record(event.metadata) ? event.metadata : {};
    const accession = exactAccession(eventMetadata.accession_number);
    const issuerCik = exactCik(eventMetadata.cik);
    if (
      stringValue(event.id) !== eventId
      || !UUID_PATTERN.test(rawItemId)
      || stringValue(event.source_code) !== "sec_edgar"
      || stringValue(event.source_group) !== "filings"
      || !accession
      || !issuerCik
    ) return notReady("event_identity_mismatch");

    const rawResult = await resolved.readRawItem(rawItemId);
    if (!rawResult.ok) return notReady("reader_unavailable");
    const rawRows = rows(rawResult.data);
    if (rawRows.length === 0) return notReady("raw_item_missing");
    if (rawRows.length !== 1) return notReady("raw_item_ambiguous");
    const raw = rawRows[0];
    const rawPayload = record(raw.raw_payload) ? raw.raw_payload : {};
    if (
      stringValue(raw.id) !== rawItemId
      || stringValue(raw.source_code) !== "sec_edgar"
      || stringValue(raw.source_group) !== "filings"
      || exactAccession(raw.source_unique_id) !== accession
      || exactAccession(rawPayload.accession_number) !== accession
      || exactCik(rawPayload.cik) !== issuerCik
    ) return notReady("raw_item_identity_mismatch");

    const snapshotResult = await resolved.readSnapshotsByAccession(accession);
    if (!snapshotResult.ok) return notReady("reader_unavailable");
    const snapshots = rows(snapshotResult.data);
    if (snapshots.length === 0) return notReady("registry_event_missing");
    if (snapshots.some((snapshot) => exactAccession(snapshot.source_accession) !== accession)) {
      return notReady("registry_event_ambiguous");
    }

    const instrumentIds = [...new Set(snapshots.map((row) => integerId(row.instrument_id)).filter(Boolean))];
    if (instrumentIds.length === 0) return notReady("registry_event_ambiguous");
    const instrumentResult = await resolved.readInstruments(instrumentIds);
    if (!instrumentResult.ok) return notReady("reader_unavailable");
    const instruments = rows(instrumentResult.data);
    const byId = new Map(instruments.map((instrument) => [integerId(instrument.id), instrument]));
    if (byId.size !== instrumentIds.length) return notReady("registry_event_ambiguous");
    if (instrumentIds.some((id) => exactCik(byId.get(id)?.issuer_cik) !== issuerCik)) {
      return notReady("registry_issuer_mismatch");
    }

    const exactRows = snapshots.map((snapshot) => ({
      snapshot,
      instrument: byId.get(integerId(snapshot.instrument_id))!,
    }));
    const candidates = exactRows.filter(({ instrument }) => (
      stringValue(instrument.instrument_type) === "atm_program"
    ));
    if (candidates.length > 1) return notReady("registry_event_ambiguous");
    if (candidates.length === 0) {
      return availableUnmappable({ eventId, rawItemId, issuerCik, accession });
    }

    // An ATM program's original/remaining capacity is authorization headroom,
    // not an actual primary gross transaction amount. No Registry field is
    // mapped to offering.amount in this adapter revision.
    return availableUnmappable({ eventId, rawItemId, issuerCik, accession });
  } catch {
    return notReady("reader_unavailable");
  }
}

function unmappableCanonical(): MinimalOfferingMonitor {
  return {
    version: MINIMAL_OFFERING_MONITOR_VERSION,
    applicability: "applicable",
    financing_stage: "unknown",
    primary_or_resale: "unknown",
    security_nature: "unknown",
    has_warrant: null,
    has_prefunded_warrant: null,
    has_convertible: null,
    facts: {
      actual_primary_offering_amount: unavailableFact("currency", "market_cap"),
      offering_price: unavailableFact("currency_per_security", "market_price"),
      immediate_primary_share_exposure: unavailableFact("shares", "shares_outstanding"),
      additional_potential_primary_share_exposure: unavailableFact("shares", "shares_outstanding"),
      resale_share_exposure: unavailableFact("shares", "public_float"),
    },
  };
}

function availableUnmappable(identity: Readonly<{
  eventId: string;
  rawItemId: string;
  issuerCik: string;
  accession: string;
}>): RegistryBackedOfferingFactReadResult {
  const canonical = unmappableCanonical();
  return {
    status: "available",
    version: REGISTRY_BACKED_OFFERING_FACT_ADAPTER_VERSION,
    mappingStatus: "unmappable",
    reason: "registry_semantics_unmappable",
    ...identity,
    canonical,
    materialized: materializeMinimalOfferingMonitor(canonical, emptyMarketSnapshot()),
  };
}

function unavailableFact(
  unit: MinimalOfferingNumericFact["unit"],
  comparisonBasis: MinimalOfferingComparisonBasis,
): MinimalOfferingNumericFact {
  return {
    value: null,
    availability: "unavailable",
    value_quality: "unknown",
    bound: "unknown",
    unit,
    currency: null,
    security_basis: null,
    comparison_basis_type: comparisonBasis,
    comparable_to_event_market_basis: null,
    source_ref: null,
  };
}

function emptyMarketSnapshot() {
  return {
    price: null,
    market_cap: null,
    shares_outstanding: null,
    public_float: null,
    currency: null,
    security_basis: null,
    price_unit: null,
    market_cap_unit: null,
    share_unit: null,
    as_of: null,
  } as const;
}

function notReady(reason: RegistryBackedOfferingFactReason): RegistryBackedOfferingFactReadResult {
  return { status: "not_ready", version: REGISTRY_BACKED_OFFERING_FACT_ADAPTER_VERSION, reason };
}

async function resolveRepository(): Promise<RegistryBackedOfferingFactRepository> {
  const supabase = await import("../supabase.ts");
  return {
    readEvent: (eventId) => supabase.supabaseSelect("events", {
      select: "id,raw_item_id,source_code,source_group,ticker,metadata",
      id: `eq.${eventId}`,
      limit: "2",
    }),
    readRawItem: (rawItemId) => supabase.supabaseSelect("raw_items", {
      select: "id,source_code,source_group,source_unique_id,raw_payload",
      id: `eq.${rawItemId}`,
      limit: "2",
    }),
    readSnapshotsByAccession: (accession) => supabase.supabaseSelect(
      "dilution_instrument_snapshots",
      {
        select: "id,instrument_id,source_accession",
        source_accession: `eq.${accession}`,
        order: "id.asc",
        limit: "100",
      },
    ),
    readInstruments: (instrumentIds) => supabase.supabaseSelect("dilution_instruments", {
      select: "id,instrument_key,issuer_cik,instrument_type,name,first_source_accession",
      id: `in.(${instrumentIds.join(",")})`,
      order: "id.asc",
      limit: "100",
    }),
  };
}

function rows(value: unknown): RegistryRow[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function record(value: unknown): value is RegistryRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function exactAccession(value: unknown) {
  const candidate = stringValue(value);
  return ACCESSION_PATTERN.test(candidate) ? candidate : "";
}

function exactCik(value: unknown) {
  const candidate = stringValue(value);
  return CIK_PATTERN.test(candidate) && candidate !== "0000000000" ? candidate : "";
}

function integerId(value: unknown) {
  const candidate = typeof value === "number" ? String(value) : stringValue(value);
  return /^(?:0|[1-9]\d*)$/.test(candidate) ? candidate : "";
}
