import assert from "node:assert/strict";
import test from "node:test";
import {
  readRegistryBackedOfferingFacts,
  type RegistryBackedOfferingFactRepository,
} from "./registryBackedOfferingFacts.ts";
import { evaluateOfferingMonitorConditions } from "../offeringMonitorMatcher.ts";
import { MONITOR_CONDITION_REGISTRY } from "./conditionRegistry.ts";

const eventId = "10000000-0000-4000-8000-000000000001";
const rawItemId = "20000000-0000-4000-8000-000000000002";
const accession = "0001213900-26-088706";
const cik = "0001840317";

test("Registry source descriptors resolve real reader output without making ATM or non-ATM facts matchable", async () => {
  const entries = MONITOR_CONDITION_REGISTRY.filter(entry => entry.family === "offering");
  for (const instrumentType of ["atm_program", "warrant"]) {
    const repo = repository();
    repo.instruments[0].instrument_type = instrumentType;
    const result = await readRegistryBackedOfferingFacts(eventId, repo);
    assert.equal(result.status, "available");
    if (result.status !== "available") continue;
    assert.equal(result.mappingStatus, "unmappable");
    for (const entry of entries) {
      assert.equal(entry.source.reader, readRegistryBackedOfferingFacts.name);
      assert.equal(entry.source.table, "dilution_instrument_snapshots");
      const projected: unknown = entry.source.jsonPath!.reduce<unknown>((value, key) =>
        (value as Record<string, unknown>)[key], result);
      if (entry.key === "offering.side") {
        assert.equal(projected, "unknown");
      } else {
        assert.equal((projected as { availability: string }).availability, "unavailable");
        assert.equal((projected as { value: unknown }).value, null);
      }
      const condition = entry.key === "offering.side"
        ? { key: entry.key, operator: "eq", value: "primary" }
        : { key: entry.key, operator: "gte", value: 0, ...(
          ["offering.amount", "offering.offering_price"].includes(entry.key) ? { currency: "USD" } : {}
        ) };
      assert.equal(evaluateOfferingMonitorConditions(result, [condition]).status, "ineligible");
    }
  }
});

test("keeps VEEA ATM capacity and every Offering amount fact unavailable", async () => {
  const result = await readRegistryBackedOfferingFacts(eventId, repository());
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.mappingStatus, "unmappable");
  assert.equal(result.issuerCik, cik);
  assert.equal(result.accession, accession);
  assert.equal(result.registrySnapshotId, undefined);
  assert.equal(result.registrySourceIdentity, undefined);
  for (const fact of Object.values(result.canonical.facts)) {
    assert.equal(fact.availability, "unavailable");
    assert.equal(fact.value, null);
    assert.equal(fact.source_ref, null);
  }
  assert.deepEqual(
    statusAndReason(evaluateOfferingMonitorConditions(result, [{
      key: "offering.amount",
      operator: "gte",
      value: 4_000_000,
      currency: "USD",
    }])),
    ["ineligible", "fact_unavailable"],
  );
});

test("exact identity disagreement fails closed before exposing any fact object", async () => {
  for (const mutate of [
    (repo: MutableRepository) => { repo.events[0].event_type = "earnings"; },
    (repo: MutableRepository) => { repo.raw[0].raw_payload = { accession_number: accession, cik: "0000000001" }; },
    (repo: MutableRepository) => { repo.instruments[0].issuer_cik = "0000000001"; },
    (repo: MutableRepository) => { repo.snapshots[0].source_accession = "0001213900-26-088713"; },
  ]) {
    const source = repository();
    mutate(source as MutableRepository);
    const result = await readRegistryBackedOfferingFacts(eventId, source);
    assert.equal(result.status, "not_ready");
    assert.equal("canonical" in result, false);
  }
});

test("ambiguous exact Registry rows fail closed and unmappable values remain provenance-free", async () => {
  const ambiguous = repository() as MutableRepository;
  ambiguous.snapshots.push({ ...ambiguous.snapshots[0], id: "42" });
  assert.deepEqual(
    await readRegistryBackedOfferingFacts(eventId, ambiguous),
    {
      status: "not_ready",
      version: "registry_backed_offering_fact_adapter_v1",
      reason: "registry_event_ambiguous",
    },
  );

  const result = await readRegistryBackedOfferingFacts(eventId, repository());
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.mappingStatus, "unmappable");
  assert.equal(result.registrySnapshotId, undefined);
  assert.equal(result.registrySourceIdentity, undefined);
  for (const fact of Object.values(result.canonical.facts)) {
    assert.equal(fact.availability, "unavailable");
    assert.equal(fact.value, null);
    assert.equal(fact.source_ref, null);
  }
});

type MutableRepository = RegistryBackedOfferingFactRepository & {
  events: Record<string, unknown>[];
  raw: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
  instruments: Record<string, unknown>[];
};

function repository(): MutableRepository {
  const events = [{
    id: eventId,
    raw_item_id: rawItemId,
    source_code: "sec_edgar",
    source_group: "filings",
    event_type: "offering",
    ticker: "VEEA",
    metadata: { accession_number: accession, cik },
  }];
  const raw = [{
    id: rawItemId,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: accession,
    raw_payload: { accession_number: accession, cik },
  }];
  const snapshots = [{
    id: "41",
    instrument_id: "11",
    as_of_date: "2026-08-13",
    status: "current",
    currency: "USD",
    original_capacity: "4353000",
    start_date: "2026-08-13",
    source_accession: accession,
    // Deliberately present but semantically different; adapter must ignore it.
    remaining_potential_shares: "76513659",
  }];
  const instruments = [{
    id: "11",
    instrument_key: "veea-roth-atm-20260813",
    issuer_cik: cik,
    instrument_type: "atm_program",
    name: "Roth ATM",
    first_source_accession: accession,
  }];
  return {
    events,
    raw,
    snapshots,
    instruments,
    readEvent: async () => ({ ok: true, data: events }),
    readRawItem: async () => ({ ok: true, data: raw }),
    readSnapshotsByAccession: async () => ({ ok: true, data: snapshots }),
    readInstruments: async () => ({ ok: true, data: instruments }),
  };
}

function statusAndReason(value: Readonly<{ status: string; reasonCode: string }>) {
  return [value.status, value.reasonCode];
}
