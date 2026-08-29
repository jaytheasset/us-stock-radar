import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Plan } from "../subscriptionPolicy.ts";
import type {
  StockDilutionInstrument,
  StockDilutionSnapshot,
} from "./stockDilution.ts";
import {
  DILUTION_PRIVATE_RESPONSE_HEADERS,
  projectStockDilutionForPlan,
} from "./stockDilutionMembership.ts";

const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  ad_free: 1,
  pro: 2,
  advanced: 3,
  ultimate: 4,
};

const comparePlanRank = (left: Plan, right: Plan) =>
  PLAN_RANK[left] - PLAN_RANK[right];

test("free and ad-free expose only summary, real counts, and two safe current previews", () => {
  const snapshot = fixtureSnapshot();

  for (const plan of ["free", "ad_free"] satisfies Plan[]) {
    const data = jsonRoundTrip(
      projectStockDilutionForPlan(snapshot, plan, comparePlanRank),
    );

    assert.deepEqual(data.counts, { closed: 4, current: 16 });
    assert.equal(data.current.length, 2);
    assert.deepEqual(Object.keys(data.current[0]!).sort(), [
      "asOf",
      "name",
      "status",
      "type",
    ]);
    assert.deepEqual(data.activity, []);
    assert.deepEqual(data.closed, []);
    assert.deepEqual(data.old, []);
    assert.deepEqual(data.access, {
      canViewActivity: false,
      canViewCurrentDetails: false,
      canViewHistory: false,
    });
    assert.equal("fetchedAt" in data, false);
    assert.deepEqual(findForbiddenKeys(data), []);
  }
});

test("pro exposes every current contract but no activity or history detail", () => {
  const data = jsonRoundTrip(
    projectStockDilutionForPlan(fixtureSnapshot(), "pro", comparePlanRank),
  );

  assert.deepEqual(data.counts, { closed: 4, current: 16 });
  assert.equal(data.current.length, 16);
  const firstCurrent = data.current[0]!;
  assert.ok("originalAmount" in firstCurrent);
  assert.equal(firstCurrent.originalAmount, 1_000_001);
  assert.equal(firstCurrent.remainingPotentialShares, 3_000_001);
  assert.equal(firstCurrent.conversionPrice, 0.26);
  assert.deepEqual(data.activity, []);
  assert.deepEqual(data.closed, []);
  assert.deepEqual(data.old, []);
  assert.deepEqual(data.access, {
    canViewActivity: false,
    canViewCurrentDetails: true,
    canViewHistory: false,
  });
});

test("advanced and ultimate expose current contracts, activity, and closed/old history", () => {
  const snapshot = fixtureSnapshot();
  const advanced = jsonRoundTrip(
    projectStockDilutionForPlan(snapshot, "advanced", comparePlanRank),
  );
  const ultimate = jsonRoundTrip(
    projectStockDilutionForPlan(snapshot, "ultimate", comparePlanRank),
  );

  assert.equal(advanced.current.length, 16);
  assert.equal(advanced.activity.length, 2);
  assert.equal(advanced.activity[0]!.sharesIssued, 1_500_000);
  assert.equal(advanced.activity[1]!.unitsCancelled, 250_000);
  assert.equal(advanced.closed.length, 4);
  assert.equal(advanced.old.length, 1);
  assert.deepEqual(advanced.access, {
    canViewActivity: true,
    canViewCurrentDetails: true,
    canViewHistory: true,
  });
  assert.deepEqual(ultimate, advanced);
});

test("sequential projections cannot reuse a previous member response", () => {
  const snapshot = fixtureSnapshot();
  const pro = projectStockDilutionForPlan(snapshot, "pro", comparePlanRank);
  const free = projectStockDilutionForPlan(snapshot, "free", comparePlanRank);
  const freeFirst = projectStockDilutionForPlan(snapshot, "free", comparePlanRank);
  const proSecond = projectStockDilutionForPlan(snapshot, "pro", comparePlanRank);
  const advanced = projectStockDilutionForPlan(
    snapshot,
    "advanced",
    comparePlanRank,
  );
  const anonymous = projectStockDilutionForPlan(
    snapshot,
    "free",
    comparePlanRank,
  );

  assert.equal(pro.current.length, 16);
  assert.equal(free.current.length, 2);
  assert.deepEqual(findForbiddenKeys(free), []);
  assert.equal(freeFirst.current.length, 2);
  assert.equal(proSecond.current.length, 16);
  assert.equal(advanced.activity.length, 2);
  assert.equal(anonymous.activity.length, 0);
  assert.notStrictEqual(pro.current, proSecond.current);
  assert.notStrictEqual(advanced.current, snapshot.current);
});

test("route trusts only the read-only cookie identity and effective server plan", async () => {
  const route = await readFile(
    new URL("../../app/api/market/dilution/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /getOptionalCurrentUserIdReadOnly\(\)/);
  assert.match(route, /getEffectiveUserPlan\(userId\)/);
  assert.match(route, /projectStockDilutionForPlan\(snapshot, plan, comparePlanRank\)/);
  assert.match(route, /:\s*"free";/);
  assert.match(route, /searchParams\.get\("symbol"\)/);
  assert.doesNotMatch(route, /searchParams\.get\(["']plan["']\)/i);
  assert.doesNotMatch(route, /headers\.get\(["'][^"']*plan/i);
  assert.doesNotMatch(route, /request\.json\(\)/);
});

test("every dilution response path uses the exact private cache headers", async () => {
  const route = await readFile(
    new URL("../../app/api/market/dilution/route.ts", import.meta.url),
    "utf8",
  );

  assert.deepEqual(DILUTION_PRIVATE_RESPONSE_HEADERS, {
    "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
    Vary: "Cookie",
  });
  assert.equal((route.match(/NextResponse\.json\(/g) ?? []).length, 1);
  assert.match(
    route,
    /NextResponse\.json\(body,\s*\{[\s\S]*headers:\s*DILUTION_PRIVATE_RESPONSE_HEADERS/,
  );
  assert.equal((route.match(/dilutionJson\(/g) ?? []).length, 4);
  assert.doesNotMatch(route, /\bpublic\b|s-maxage|stale-while-revalidate/);
});

function fixtureSnapshot(): StockDilutionSnapshot {
  return {
    activity: [
      {
        date: "2026-08-15",
        detail: "Converted under the agreement.",
        key: "activity-conversion",
        sharesIssued: 1_500_000,
        title: "Convertible converted",
        unitsCancelled: null,
      },
      {
        date: "2026-08-14",
        detail: "Cancelled after exercise period.",
        key: "activity-cancellation",
        sharesIssued: null,
        title: "Warrants cancelled",
        unitsCancelled: 250_000,
      },
    ],
    closed: Array.from({ length: 4 }, (_, index) =>
      instrument(index + 101, "closed"),
    ),
    current: Array.from({ length: 16 }, (_, index) =>
      instrument(index + 1, "current"),
    ),
    fetchedAt: "2026-08-29T00:00:00.000Z",
    lastChecked: "2026-08-28",
    metrics: {
      atmAmount: 4_353_000,
      convertibleNotePotentialShares: 8_430_000,
      equityLineRemaining: 24_095_569,
      floatShares: null,
      freeFloat: null,
      otherWarrantShares: 8_641_299,
      sharesOutstanding: 62_214_156,
      sharesOutstandingAsOf: "2026-08-10",
      totalWarrantShares: 76_513_659,
    },
    old: [instrument(201, "old")],
    symbol: "TEST",
  };
}

function instrument(
  index: number,
  status: StockDilutionInstrument["status"],
): StockDilutionInstrument {
  return {
    asOf: `2026-08-${String(Math.max(1, 31 - index)).padStart(2, "0")}`,
    availableDate: "2026-09-01",
    conversionPrice: 0.25 + index / 100,
    endDate: "2028-08-01",
    exercisePrice: 0.5 + index / 100,
    interestRate: 8,
    key: `internal-instrument-${index}`,
    lastChecked: "2026-08-28",
    name: `Instrument ${index}`,
    originalAmount: 1_000_000 + index,
    originalCapacity: 5_000_000 + index,
    priceFormula: "90% of the lowest VWAP",
    remainingAmount: 500_000 + index,
    remainingPotentialShares: 3_000_000 + index,
    remainingUnits: 2_000_000 + index,
    sharesIssued: 100_000 + index,
    startDate: "2026-08-01",
    status,
    type: index % 2 ? "convertible_note" : "warrant",
    usedAmount: 250_000 + index,
  };
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findForbiddenKeys(value: unknown): string[] {
  const forbidden = new Set([
    "conversionPrice",
    "detail",
    "exercisePrice",
    "holder",
    "interestRate",
    "key",
    "originalAmount",
    "originalCapacity",
    "priceFormula",
    "remainingAmount",
    "remainingPotentialShares",
    "remainingUnits",
    "sharesIssued",
    "unitsCancelled",
    "usedAmount",
  ]);
  const found = new Set<string>();

  visit(value);
  return [...found].sort();

  function visit(item: unknown) {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) found.add(key);
      visit(child);
    }
  }
}
