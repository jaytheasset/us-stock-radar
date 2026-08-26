import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertHistoricalReplayMigrationPrerequisites,
  HISTORICAL_REPLAY_REQUIRED_MIGRATION,
  isHistoricalReplayMigrationPrecheckOnly,
} from "./historicalReplayMigrationGate.ts";

const REQUIRED_CAPABILITIES = {
  issuer_common_class_universe_snapshot_v2: true,
  authoritative_multi_class_share_history: true,
  custom_canonical_security_class_identity: true,
};

test("required migration as latest passes", async () => {
  const result = await assertHistoricalReplayMigrationPrerequisites(clientWith({
    latest_migration: HISTORICAL_REPLAY_REQUIRED_MIGRATION,
    required_migration_applied: true,
    ...REQUIRED_CAPABILITIES,
  }));

  assert.equal(result.latestMigration, HISTORICAL_REPLAY_REQUIRED_MIGRATION);
  assert.equal(result.requiredMigration, HISTORICAL_REPLAY_REQUIRED_MIGRATION);
});

test("later migrations pass when the required migration and capabilities remain present", async () => {
  const result = await assertHistoricalReplayMigrationPrerequisites(clientWith({
    latest_migration: "20260823023000",
    required_migration_applied: true,
    ...REQUIRED_CAPABILITIES,
  }));

  assert.equal(result.latestMigration, "20260823023000");
});

test("missing required migration fails closed even when schema capabilities are present", async () => {
  await assert.rejects(
    assertHistoricalReplayMigrationPrerequisites(clientWith({
      latest_migration: "20260823023000",
      required_migration_applied: false,
      ...REQUIRED_CAPABILITIES,
    })),
    /historical_replay_required_prerequisites_missing:migration:20260822201302/,
  );
});

test("missing schema capability fails closed even when migration history says applied", async () => {
  await assert.rejects(
    assertHistoricalReplayMigrationPrerequisites(clientWith({
      latest_migration: "20260823023000",
      required_migration_applied: true,
      ...REQUIRED_CAPABILITIES,
      authoritative_multi_class_share_history: false,
    })),
    /capability:authoritative_multi_class_share_history/,
  );
});

test("untrusted or malformed migration history fails closed", async () => {
  await assert.rejects(
    assertHistoricalReplayMigrationPrerequisites(clientWith({
      latest_migration: null,
      required_migration_applied: true,
      ...REQUIRED_CAPABILITIES,
    })),
    /historical_replay_migration_history_untrusted/,
  );
});

test("precheck-only is explicit and does not become a default", () => {
  assert.equal(isHistoricalReplayMigrationPrecheckOnly([]), false);
  assert.equal(isHistoricalReplayMigrationPrecheckOnly(["--migration-precheck-only"]), true);
});

for (const runner of [
  "verify-live-multi-class-os-production-path-local.ts",
  "verify-sec-os-production-collection-local.ts",
]) {
  test(`${runner} gates before collector and database mutation`, () => {
    const source = readFileSync(new URL(runner, import.meta.url), "utf8");
    const gate = source.indexOf("await assertHistoricalReplayMigrationPrerequisites(client)");
    const precheckOnly = source.indexOf("isHistoricalReplayMigrationPrecheckOnly(process.argv.slice(2))");
    const transaction = source.indexOf('await client.query("begin")');
    const collector = source.indexOf("new SecOsProductionCollector");

    assert.ok(gate >= 0);
    assert.ok(precheckOnly > gate);
    if (transaction >= 0) assert.ok(gate < transaction);
    assert.ok(gate < collector);
    assert.doesNotMatch(source, /order by version desc limit 1/i);
    assert.doesNotMatch(source, /assert\.equal\(migration\.rows\[0\]\?\.version/);
  });
}

function clientWith(row: Record<string, unknown>) {
  return {
    async query(text: string, values?: unknown[]) {
      assert.match(text, /where version = \$1/);
      assert.doesNotMatch(text, /order by version desc limit 1/i);
      assert.deepEqual(values, [HISTORICAL_REPLAY_REQUIRED_MIGRATION]);
      return { rows: [row] };
    },
  };
}
