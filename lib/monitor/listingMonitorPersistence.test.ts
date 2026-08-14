import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createListingMonitor,
  deleteListingMonitor,
  listActiveListingMonitorsForOwner,
  listListingMonitorsForOwner,
  ListingMonitorPersistenceError,
  pauseListingMonitor,
  readListingMonitorForOwner,
  resumeListingMonitor,
  updateListingMonitor,
  validateCanonicalListingConditions,
  type ListingMonitorRepository,
} from "./listingMonitorPersistence.ts";

const ownerA = "a1000000-0000-4000-8000-000000000001";
const ownerB = "b1000000-0000-4000-8000-000000000002";
const atpcConditions = Object.freeze([
  Object.freeze({ key: "market.price", operator: "lt", value: 1 }),
  Object.freeze({ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }),
  Object.freeze({ key: "listing.event_outcome", operator: "eq", value: "adverse" }),
  Object.freeze({ key: "listing.compliance_deadline", operator: "within_days", value: 30 }),
]);
const reverseSplitConditions = Object.freeze([
  Object.freeze({ key: "market.price", operator: "lt", value: 1 }),
  Object.freeze({ key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" }),
]);

test("ATPC Listing monitor round-trips exact canonical JSON through active, pause, resume, and hard delete", async () => {
  const repository = new MemoryListingMonitorRepository();
  const created = await createListingMonitor({ ownerId: ownerA, conditions: atpcConditions }, repository);

  assert.deepEqual(created.conditions, atpcConditions);
  assert.equal(created.domain, "listing");
  assert.equal(created.isActive, true);

  const listed = await listListingMonitorsForOwner(ownerA, repository);
  assert.equal(listed.diagnostics.length, 0);
  assert.deepEqual(listed.monitors[0]?.conditions, atpcConditions);

  const read = await readListingMonitorForOwner(ownerA, created.id, repository);
  assert.equal(read.status, "available");
  if (read.status === "available") assert.deepEqual(read.monitor.conditions, atpcConditions);

  assert.deepEqual(
    (await listActiveListingMonitorsForOwner(ownerA, repository)).monitors.map((monitor) => monitor.id),
    [created.id],
  );
  assert.equal((await pauseListingMonitor(ownerA, created.id, repository)).isActive, false);
  assert.equal((await listActiveListingMonitorsForOwner(ownerA, repository)).monitors.length, 0);
  assert.equal((await resumeListingMonitor(ownerA, created.id, repository)).isActive, true);
  assert.deepEqual(
    (await listActiveListingMonitorsForOwner(ownerA, repository)).monitors.map((monitor) => monitor.id),
    [created.id],
  );

  assert.equal(await deleteListingMonitor(ownerA, created.id, repository), true);
  assert.equal((await readListingMonitorForOwner(ownerA, created.id, repository)).status, "not_found");
  assert.equal(repository.size, 0);
});

test("Price plus reverse split round-trips exact canonical JSON through existing persistence", async () => {
  const repository = new MemoryListingMonitorRepository();
  const created = await createListingMonitor({ ownerId: ownerA, conditions: reverseSplitConditions }, repository);
  assert.deepEqual(created.conditions, reverseSplitConditions);
  const read = await readListingMonitorForOwner(ownerA, created.id, repository);
  assert.equal(read.status, "available");
  if (read.status === "available") assert.deepEqual(read.monitor.conditions, reverseSplitConditions);
  assert.deepEqual(
    (await listActiveListingMonitorsForOwner(ownerA, repository)).monitors[0]?.conditions,
    reverseSplitConditions,
  );
});

test("create and update reject malformed, unsupported, non-Listing, and non-canonical conditions before writing", async () => {
  const repository = new MemoryListingMonitorRepository();
  const invalidConditionSets: unknown[] = [
    [],
    [{ key: "listing.not_registered", operator: "eq", value: "adverse" }],
    [{ key: "listing.event_kind", operator: "contains", value: "deficiency_notice" }],
    [{ key: "listing.event_kind", operator: "eq", value: "warning" }],
    [{ key: "listing.compliance_deadline", operator: "within_days", value: 30.5 }],
    [{ key: "market.price", operator: "lt", value: 0 }],
    [{ key: "market.price", operator: "lte", value: -1 }],
    [{ key: "corporate_action.event_kind", operator: "eq", value: "forward_split" }],
    [{ key: "corporate_action.action_stage", operator: "eq", value: "unknown" }],
    [{ key: "event.ticker", operator: "eq", value: "ATPC" }],
    [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice", prompt: "guess" }],
    ["listing.event_kind eq deficiency_notice"],
  ];

  for (const conditions of invalidConditionSets) {
    await assert.rejects(
      createListingMonitor({ ownerId: ownerA, conditions }, repository),
      (error: unknown) => error instanceof ListingMonitorPersistenceError && error.code === "listing_monitor_invalid",
    );
  }
  assert.equal(repository.createCalls, 0);
  assert.equal(repository.size, 0);

  const created = await createListingMonitor({ ownerId: ownerA, conditions: atpcConditions }, repository);
  await assert.rejects(
    updateListingMonitor({
      ownerId: ownerA,
      monitorId: created.id,
      conditions: [{ key: "listing.event_outcome", operator: "eq", value: "maybe" }],
    }, repository),
    (error: unknown) => error instanceof ListingMonitorPersistenceError && error.code === "listing_monitor_invalid",
  );
  assert.equal(repository.updateCalls, 0);
  assert.deepEqual(repository.row(created.id)?.conditions, atpcConditions);
});

test("active reads fail closed and diagnose stored conditions invalid under the current Registry", async () => {
  const repository = new MemoryListingMonitorRepository();
  const valid = await createListingMonitor({ ownerId: ownerA, conditions: atpcConditions }, repository);
  const invalidId = "a2000000-0000-4000-8000-000000000099";
  repository.seed({
    id: invalidId,
    user_id: ownerA,
    domain: "listing",
    conditions: [{ key: "listing.removed_key", operator: "eq", value: "anything" }],
    is_active: true,
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  });

  const result = await listActiveListingMonitorsForOwner(ownerA, repository);
  assert.deepEqual(result.monitors.map((monitor) => monitor.id), [valid.id]);
  assert.deepEqual(result.diagnostics, [{
    id: invalidId,
    reason: "stored_conditions_invalid",
    errors: ["conditions[0]:condition_key_unknown"],
  }]);
  assert.deepEqual(await readListingMonitorForOwner(ownerA, invalidId, repository), {
    status: "invalid",
    diagnostic: result.diagnostics[0],
  });
});

test("every read and mutation is owner-scoped and does not expose a foreign monitor", async () => {
  const repository = new MemoryListingMonitorRepository();
  const foreign = await createListingMonitor({ ownerId: ownerB, conditions: atpcConditions }, repository);

  assert.equal((await readListingMonitorForOwner(ownerA, foreign.id, repository)).status, "not_found");
  assert.equal((await listListingMonitorsForOwner(ownerA, repository)).monitors.length, 0);
  await assert.rejects(
    pauseListingMonitor(ownerA, foreign.id, repository),
    (error: unknown) => error instanceof ListingMonitorPersistenceError && error.code === "listing_monitor_not_found",
  );
  await assert.rejects(
    updateListingMonitor({ ownerId: ownerA, monitorId: foreign.id, conditions: atpcConditions }, repository),
    (error: unknown) => error instanceof ListingMonitorPersistenceError && error.code === "listing_monitor_not_found",
  );
  assert.equal(await deleteListingMonitor(ownerA, foreign.id, repository), false);

  const ownerRead = await readListingMonitorForOwner(ownerB, foreign.id, repository);
  assert.equal(ownerRead.status, "available");
  if (ownerRead.status === "available") assert.equal(ownerRead.monitor.isActive, true);
});

test("canonical validation preserves supported Registry values without inference or normalization", () => {
  const validation = validateCanonicalListingConditions(atpcConditions);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.conditions, atpcConditions);
  assert.equal(validateCanonicalListingConditions([
    { key: "listing.event_kind", operator: "eq", value: "Deficiency Notice" },
  ]).ok, false);
});

test("persistence remains isolated from Matcher, AI, parser, alert, and workflow execution", () => {
  const source = readFileSync(new URL("./listingMonitorPersistence.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /listingMonitorMatcher|gemini|llm|prompt|alert|workflow|parser/i);
});

class MemoryListingMonitorRepository implements ListingMonitorRepository {
  private readonly rows = new Map<string, Record<string, unknown>>();
  private nextId = 1;
  createCalls = 0;
  updateCalls = 0;

  get size() {
    return this.rows.size;
  }

  row(id: string) {
    return this.rows.get(id);
  }

  seed(row: Record<string, unknown>) {
    this.rows.set(String(row.id), structuredClone(row));
  }

  async create(row: Record<string, unknown>) {
    this.createCalls += 1;
    const id = `a3000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
    const now = new Date().toISOString();
    const stored = { id, created_at: now, updated_at: now, ...structuredClone(row) };
    this.rows.set(id, stored);
    return { ok: true, data: [structuredClone(stored)] };
  }

  async list(ownerId: string, activeOnly: boolean) {
    return {
      ok: true,
      data: [...this.rows.values()]
        .filter((row) => row.user_id === ownerId && row.domain === "listing")
        .filter((row) => !activeOnly || row.is_active === true)
        .map((row) => structuredClone(row)),
    };
  }

  async read(ownerId: string, monitorId: string) {
    const row = this.rows.get(monitorId);
    return {
      ok: true,
      data: row?.user_id === ownerId && row.domain === "listing" ? [structuredClone(row)] : [],
    };
  }

  async update(ownerId: string, monitorId: string, patch: Record<string, unknown>) {
    const row = this.rows.get(monitorId);
    if (!row || row.user_id !== ownerId || row.domain !== "listing") return { ok: true, data: [] };
    this.updateCalls += 1;
    const updated = { ...row, ...structuredClone(patch) };
    this.rows.set(monitorId, updated);
    return { ok: true, data: [structuredClone(updated)] };
  }

  async delete(ownerId: string, monitorId: string) {
    const row = this.rows.get(monitorId);
    if (!row || row.user_id !== ownerId || row.domain !== "listing") return { ok: true, data: [] };
    this.rows.delete(monitorId);
    return { ok: true, data: [structuredClone(row)] };
  }
}
