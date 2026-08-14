import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  listListingMonitorAlertsForOwner,
  parseListingMonitorAlertQuery,
  parseListingMonitorCreateRequest,
  parseListingMonitorUpdateRequest,
  validateListingMonitorCandidate,
  type ListingMonitorAlertRepository,
} from "./listingMonitorApi.ts";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const MONITOR_ID = "20000000-0000-4000-8000-000000000002";
const ALERT_ID = "30000000-0000-4000-8000-000000000003";
const EVENT_ID = "40000000-0000-4000-8000-000000000004";
const CONDITIONS = Object.freeze([
  Object.freeze({ key: "market.price", operator: "lt", value: 1 }),
  Object.freeze({ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }),
  Object.freeze({ key: "listing.event_outcome", operator: "eq", value: "adverse" }),
]);

test("create and preview accept only Registry-valid canonical Listing conditions", () => {
  const parsed = parseListingMonitorCreateRequest({ conditions: CONDITIONS });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.conditions, CONDITIONS);

  const preview = validateListingMonitorCandidate({ conditions: CONDITIONS });
  assert.deepEqual(preview, { valid: true, conditions: CONDITIONS, errors: [] });
});

test("invalid, unsupported, and malformed monitor requests fail closed", () => {
  const cases = [
    { conditions: [{ key: "listing.not_registered", operator: "eq", value: "adverse" }] },
    { conditions: [{ key: "listing.event_kind", operator: "within_days", value: 1 }] },
    { conditions: [{ key: "listing.event_kind", operator: "eq", value: "not_a_kind" }] },
    { conditions: [{ key: "market.price", operator: "lt", value: 0 }] },
    { conditions: [{ key: "market.price", operator: "eq", value: 1 }] },
    { conditions: [{ operator: "eq", value: "adverse" }] },
    { conditions: [] },
    { domain: "offering", conditions: CONDITIONS },
    { conditions: CONDITIONS, userId: OWNER_ID },
    CONDITIONS,
  ];
  for (const input of cases) {
    const parsed = parseListingMonitorCreateRequest(input);
    assert.equal(parsed.ok, false, JSON.stringify(input));
    const preview = validateListingMonitorCandidate(input);
    assert.equal(preview.valid, false, JSON.stringify(input));
    assert.deepEqual(preview.conditions, []);
    assert.ok(preview.errors.length > 0);
  }
});

test("PATCH supports Registry-validated conditions and explicit pause/resume only", () => {
  assert.deepEqual(parseListingMonitorUpdateRequest({ isActive: false }), {
    ok: true,
    value: { isActive: false },
  });
  assert.deepEqual(parseListingMonitorUpdateRequest({ isActive: true }), {
    ok: true,
    value: { isActive: true },
  });
  const updated = parseListingMonitorUpdateRequest({ conditions: CONDITIONS, isActive: false });
  assert.equal(updated.ok, true);
  assert.equal(parseListingMonitorUpdateRequest({}).ok, false);
  assert.equal(parseListingMonitorUpdateRequest({ isActive: "false" }).ok, false);
  assert.equal(parseListingMonitorUpdateRequest({ name: "unsupported" }).ok, false);
});

test("alert query parsing validates filter and bounds pagination", () => {
  assert.deepEqual(parseListingMonitorAlertQuery(new URLSearchParams()), {
    ok: true,
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(parseListingMonitorAlertQuery(new URLSearchParams({
    monitorId: MONITOR_ID,
    limit: "1000",
    offset: "-2",
  })), {
    ok: true,
    monitorId: MONITOR_ID,
    limit: 100,
    offset: 0,
  });
  assert.equal(parseListingMonitorAlertQuery(new URLSearchParams({ monitorId: "foreign" })).ok, false);
});

test("alert reads are owner-scoped, filterable, paginated, and expose a minimal shape", async () => {
  const calls: unknown[] = [];
  const repository: ListingMonitorAlertRepository = {
    async list(input) {
      calls.push(input);
      return {
        ok: true,
        data: [{
          id: ALERT_ID,
          user_id: "must-not-be-exposed",
          listing_monitor_id: MONITOR_ID,
          alert_event_id: EVENT_ID,
          listing_source_execution_id: "must-not-be-exposed",
          created_at: "2026-08-14T01:02:03.000Z",
        }],
        count: 1,
      };
    },
  };
  const result = await listListingMonitorAlertsForOwner({
    ownerId: OWNER_ID,
    monitorId: MONITOR_ID,
    limit: 5,
    offset: 10,
  }, repository);
  assert.deepEqual(calls, [{ ownerId: OWNER_ID, monitorId: MONITOR_ID, limit: 5, offset: 10 }]);
  assert.deepEqual(result, {
    alerts: [{ id: ALERT_ID, monitorId: MONITOR_ID, eventId: EVENT_ID, createdAt: "2026-08-14T01:02:03.000Z" }],
    total: 1,
    limit: 5,
    offset: 10,
  });
  assert.equal("userId" in result.alerts[0], false);
  assert.equal("sourceExecutionId" in result.alerts[0], false);
});

test("alert rows preserve nullable event/monitor references after established FK deletion semantics", async () => {
  const repository: ListingMonitorAlertRepository = {
    async list() {
      return {
        ok: true,
        data: [{ id: ALERT_ID, listing_monitor_id: null, alert_event_id: null, created_at: "2026-08-14T01:02:03Z" }],
        count: 1,
      };
    },
  };
  const result = await listListingMonitorAlertsForOwner({ ownerId: OWNER_ID }, repository);
  assert.equal(result.alerts[0].monitorId, null);
  assert.equal(result.alerts[0].eventId, null);
});

test("route sources enforce auth, mutation origin checks, and a write-free Registry preview", () => {
  const collection = readProjectFile("app/api/monitors/listing/route.ts");
  const item = readProjectFile("app/api/monitors/listing/[monitorId]/route.ts");
  const preview = readProjectFile("app/api/monitors/listing/validate/route.ts");
  const alerts = readProjectFile("app/api/monitors/listing/alerts/route.ts");
  for (const source of [collection, item, preview, alerts]) {
    assert.match(source, /getOptionalCurrentUserId/);
    assert.doesNotMatch(source, /getDevFallbackUserId|getCurrentUserId/);
  }
  for (const source of [collection, item, preview]) {
    assert.match(source, /rejectCrossOriginMutationRequest/);
  }
  assert.match(item, /params: Promise<\{ monitorId: string \}>/);
  assert.doesNotMatch(preview, /createListingMonitor|updateListingMonitor|deleteListingMonitor|supabase(?:Upsert|Update|Delete)/);
  assert.doesNotMatch([collection, item, preview, alerts].join("\n"), /gemini|generateContent|language model|LLM/i);
  assert.match(preview, /valid: false/);
  assert.match(preview, /conditions: validation\.conditions/);
  assert.match(preview, /errors: \["invalid_json"\]/);
});

function readProjectFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
