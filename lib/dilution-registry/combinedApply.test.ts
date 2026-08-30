import assert from "node:assert/strict";
import test from "node:test";

import { applyDilutionRegistryAndHumanVerifiedOs } from "./combinedApply.ts";

const APPROVAL = {
  approverUserId: "6fcb1048-5f2d-4ef0-9f8b-c35a8db393bd",
  approvedAt: "2026-08-30T12:00:00.000Z",
};

function source(osObservation: Record<string, unknown> | null = { shares_outstanding: "10" }) {
  return JSON.stringify({
    issuer: { issuer_cik: "0001840317", ticker: "VEEA" },
    instruments: [], snapshots: [], activities: [], totals: [],
    ...(osObservation ? { os_observations: [osObservation] } : {}),
  });
}

function registry(alreadySaved = false) {
  return {
    async rpc() {
      return {
        ok: true,
        data: {
          already_saved: alreadySaved,
          added: { instruments: 0, snapshots: 0, activities: 0, totals: 0 },
        },
      };
    },
  };
}

test("one Apply saves Registry before server-verified O/S", async () => {
  const order: string[] = [];
  const result = await applyDilutionRegistryAndHumanVerifiedOs({
    source: source(), approval: APPROVAL, ingestedAt: APPROVAL.approvedAt,
    registryDependencies: {
      async rpc() {
        order.push("registry");
        return registry().rpc();
      },
    },
    async writeSharesOutstanding(input) {
      order.push("os");
      assert.equal(input.approval.approverUserId, APPROVAL.approverUserId);
      return { status: "INSERTED", inserted: 1, deduped: 0, verifierStatus: "Verified", reasons: [] };
    },
  });
  assert.deepEqual(order, ["registry", "os"]);
  assert.deepEqual(result, {
    registry: { status: "saved" },
    sharesOutstanding: { status: "saved", verifierStatus: "Verified", reasons: [] },
  });
});

test("Registry failure skips O/S, while O/S failure does not undo Registry", async () => {
  let osWrites = 0;
  const registryFailure = await applyDilutionRegistryAndHumanVerifiedOs({
    source: source(), approval: APPROVAL, ingestedAt: APPROVAL.approvedAt,
    registryDependencies: { async rpc() { return { ok: false, data: null }; } },
    async writeSharesOutstanding() {
      osWrites += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(osWrites, 0);
  assert.equal(registryFailure.registry.status, "failed");
  assert.equal(registryFailure.sharesOutstanding.status, "skipped");

  const osFailure = await applyDilutionRegistryAndHumanVerifiedOs({
    source: source(), approval: APPROVAL, ingestedAt: APPROVAL.approvedAt,
    registryDependencies: registry(true),
    async writeSharesOutstanding() { throw new Error("independent writer failed"); },
  });
  assert.equal(osFailure.registry.status, "already_saved");
  assert.equal(osFailure.sharesOutstanding.status, "failed");
});

test("Verified replay, Review, Not Verified, and legacy JSON map to independent statuses", async () => {
  for (const [writerStatus, verifierStatus, expected] of [
    ["REPLAY", "Verified", "already_saved"],
    ["REJECTED", "Review", "skipped"],
    ["REJECTED", "Not Verified", "skipped"],
  ] as const) {
    const result = await applyDilutionRegistryAndHumanVerifiedOs({
      source: source(), approval: APPROVAL, ingestedAt: APPROVAL.approvedAt,
      registryDependencies: registry(true),
      async writeSharesOutstanding() {
        return {
          status: writerStatus,
          inserted: 0,
          deduped: writerStatus === "REPLAY" ? 1 : 0,
          verifierStatus,
          reasons: writerStatus === "REJECTED" ? ["failed closed"] : [],
        };
      },
    });
    assert.equal(result.sharesOutstanding.status, expected);
    assert.equal(result.sharesOutstanding.verifierStatus, verifierStatus);
  }

  let writes = 0;
  const legacy = await applyDilutionRegistryAndHumanVerifiedOs({
    source: source(null), approval: APPROVAL, ingestedAt: APPROVAL.approvedAt,
    registryDependencies: registry(true),
    async writeSharesOutstanding() {
      writes += 1;
      throw new Error("must not run");
    },
  });
  assert.equal(writes, 0);
  assert.equal(legacy.registry.status, "already_saved");
  assert.equal(legacy.sharesOutstanding.status, "skipped");
});
