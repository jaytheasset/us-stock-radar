import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteListingMonitor,
  ListingMonitorPersistenceError,
  updateListingMonitor,
  type ListingMonitorRepository,
} from "./listingMonitorPersistence.ts";

import {
  createSection16MonitorConditionSet,
  readSection16MonitorConditionSetForOwner,
  validateCanonicalSection16MonitorConditions,
  type Section16MonitorConditionSetRepository,
} from "./section16MonitorPersistence.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const CONDITIONS = [{ key: "ownership.section16.transaction.shares", operator: "eq", value: "10" }];

test("Section 16 condition persistence reuses owner-scoped storage and forces manual inactive state", async () => {
  const rows: Record<string, unknown>[] = [];
  const repository = harness(rows);
  const created = await createSection16MonitorConditionSet({ ownerId: OWNER, conditions: CONDITIONS }, repository);
  assert.equal(created.executionMode, "manual_only_no_alerts");
  assert.equal(created.rowFamily, "transaction");
  assert.equal(rows[0]?.is_active, false);
  assert.equal(rows[0]?.domain, "listing");

  const readback = await readSection16MonitorConditionSetForOwner(OWNER, created.id, repository);
  assert.equal(readback.status, "available");
  if (readback.status === "available") assert.deepEqual(readback.conditionSet.conditions, CONDITIONS);
  assert.equal((await readSection16MonitorConditionSetForOwner(OTHER, created.id, repository)).status, "not_found");
});

test("Section 16 condition validation rejects invalid values and mixed row families", () => {
  assert.deepEqual(validateCanonicalSection16MonitorConditions([
    { key: "ownership.section16.transaction.shares", operator: "eq", value: 10 },
  ]).errors, ["conditions[0]:condition_value_invalid"]);
  assert.deepEqual(validateCanonicalSection16MonitorConditions([
    ...CONDITIONS,
    { key: "ownership.section16.holding.amount_owned", operator: "eq", value: "10" },
  ]).errors, ["row_families_mixed"]);
});

test("Section 16 readback diagnoses an invalid stored condition without crossing owner scope", async () => {
  const now = "2026-09-12T00:00:00.000Z";
  const rows = [{
    id: ID,
    user_id: OWNER,
    domain: "listing",
    conditions: [{ key: "ownership.section16.transaction.unknown", operator: "eq", value: "10" }],
    is_active: false,
    created_at: now,
    updated_at: now,
  }];
  const repository = harness(rows);
  const own = await readSection16MonitorConditionSetForOwner(OWNER, ID, repository);
  assert.equal(own.status, "invalid");
  if (own.status === "invalid") assert.deepEqual(own.errors, ["conditions[0]:condition_key_unknown"]);
  assert.equal((await readSection16MonitorConditionSetForOwner(OTHER, ID, repository)).status, "not_found");
});

test("general Listing updates and delete reject any private Section 16 condition before mutation", async () => {
  const rows: Record<string, unknown>[] = [];
  const repository = harness(rows);
  const created = await createSection16MonitorConditionSet({ ownerId: OWNER, conditions: CONDITIONS }, repository);
  const before = structuredClone(rows[0]);

  const updates = [
    { ownerId: OWNER, monitorId: created.id, isActive: true },
    {
      ownerId: OWNER,
      monitorId: created.id,
      conditions: [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
    },
    {
      ownerId: OWNER,
      monitorId: created.id,
      conditions: [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
      isActive: true,
    },
  ] as const;
  for (const update of updates) {
    await assert.rejects(
      updateListingMonitor(update, repository),
      (error: unknown) => error instanceof ListingMonitorPersistenceError
        && error.code === "listing_monitor_invalid"
        && error.details.includes("private_section16_monitor_mutation_forbidden"),
    );
  }
  await assert.rejects(
    deleteListingMonitor(OWNER, created.id, repository),
    (error: unknown) => error instanceof ListingMonitorPersistenceError
      && error.code === "listing_monitor_invalid"
      && error.details.includes("private_section16_monitor_mutation_forbidden"),
  );

  assert.equal(repository.updateCalls, 0);
  assert.equal(repository.deleteCalls, 0);
  assert.deepEqual(rows[0], before);
  const readback = await readSection16MonitorConditionSetForOwner(OWNER, created.id, repository);
  assert.equal(readback.status, "available");
  if (readback.status === "available") assert.deepEqual(readback.conditionSet.conditions, CONDITIONS);
});

test("the private guard remains narrow enough to repair an invalid public Listing row", async () => {
  const now = "2026-09-12T00:00:00.000Z";
  const rows = [{
    id: ID,
    user_id: OWNER,
    domain: "listing",
    conditions: [{ key: "listing.removed_key", operator: "eq", value: "legacy" }],
    is_active: true,
    created_at: now,
    updated_at: now,
  }];
  const repository = harness(rows);
  const replacement = [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }] as const;
  const repaired = await updateListingMonitor({ ownerId: OWNER, monitorId: ID, conditions: replacement }, repository);
  assert.deepEqual(repaired.conditions, replacement);
  assert.equal(repository.updateCalls, 1);
});

test("the guard detects a private key inside mixed stored conditions", async () => {
  const now = "2026-09-12T00:00:00.000Z";
  const rows = [{
    id: ID,
    user_id: OWNER,
    domain: "listing",
    conditions: [
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      { key: "ownership.section16.unknown", operator: "eq", value: "private" },
    ],
    is_active: false,
    created_at: now,
    updated_at: now,
  }];
  const repository = harness(rows);
  const before = structuredClone(rows[0]);
  await assert.rejects(
    updateListingMonitor({
      ownerId: OWNER,
      monitorId: ID,
      conditions: [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
    }, repository),
    (error: unknown) => error instanceof ListingMonitorPersistenceError
      && error.details.includes("private_section16_monitor_mutation_forbidden"),
  );
  await assert.rejects(
    deleteListingMonitor(OWNER, ID, repository),
    (error: unknown) => error instanceof ListingMonitorPersistenceError
      && error.details.includes("private_section16_monitor_mutation_forbidden"),
  );
  assert.equal(repository.updateCalls, 0);
  assert.equal(repository.deleteCalls, 0);
  assert.deepEqual(rows[0], before);
});

test("a preflight read failure prevents update and delete writes", async () => {
  const rows: Record<string, unknown>[] = [];
  const repository = harness(rows);
  const failingReadRepository: ListingMonitorRepository = {
    ...repository,
    read: async () => ({ ok: false, status: 503, data: [], error: "read unavailable" }),
  };
  for (const mutation of [
    () => updateListingMonitor({ ownerId: OWNER, monitorId: ID, isActive: true }, failingReadRepository),
    () => deleteListingMonitor(OWNER, ID, failingReadRepository),
  ]) {
    await assert.rejects(
      mutation(),
      (error: unknown) => error instanceof ListingMonitorPersistenceError
        && error.code === "listing_monitor_read_failed",
    );
  }
  assert.equal(repository.updateCalls, 0);
  assert.equal(repository.deleteCalls, 0);
});

function harness(rows: Record<string, unknown>[]): Section16MonitorConditionSetRepository
  & ListingMonitorRepository
  & { updateCalls: number; deleteCalls: number } {
  const repository: Section16MonitorConditionSetRepository
    & ListingMonitorRepository
    & { updateCalls: number; deleteCalls: number } = {
    updateCalls: 0,
    deleteCalls: 0,
    create: async (row) => {
      const now = "2026-09-12T00:00:00.000Z";
      const stored = { id: ID, ...row, created_at: now, updated_at: now };
      rows.push(stored);
      return { ok: true, data: [structuredClone(stored)] };
    },
    read: async (ownerId, id) => ({
      ok: true,
      data: structuredClone(rows.filter((row) => row.id === id && row.user_id === ownerId)),
    }),
    list: async (ownerId, activeOnly) => ({
      ok: true,
      data: structuredClone(rows.filter((row) => row.user_id === ownerId && (!activeOnly || row.is_active === true))),
    }),
    update: async (ownerId, id, patch) => {
      const row = rows.find((candidate) => candidate.id === id && candidate.user_id === ownerId);
      if (!row) return { ok: true, data: [] };
      repository.updateCalls += 1;
      Object.assign(row, structuredClone(patch));
      return { ok: true, data: [structuredClone(row)] };
    },
    delete: async (ownerId, id) => {
      const index = rows.findIndex((row) => row.id === id && row.user_id === ownerId);
      if (index < 0) return { ok: true, data: [] };
      repository.deleteCalls += 1;
      return { ok: true, data: [structuredClone(rows.splice(index, 1)[0])] };
    },
  };
  return repository;
}
