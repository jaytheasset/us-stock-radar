import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

type Row = Record<string, unknown>;
type PgClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number }>;
};

const require = createRequire(import.meta.url);
const pg = require("pg") as {
  Client: new (input: { connectionString: string }) => PgClient;
  types: { setTypeParser(oid: number, parser: (value: string) => string): void };
};
pg.types.setTypeParser(1082, (value) => value);
const { Client } = pg;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    }
    if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
      return {
        shortCircuit: true,
        url: new URL(`../node_modules/${specifier}.js`, import.meta.url).href,
      };
    }
    if (specifier.startsWith("@/")) {
      const candidate = new URL(`../${specifier.slice(2)}`, import.meta.url);
      for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const resolved = new URL(`${candidate.href}${suffix}`);
        if (existsSync(resolved)) return { shortCircuit: true, url: resolved.href };
      }
    }
    if (specifier.startsWith(".") && context.parentURL) {
      const candidate = new URL(specifier, context.parentURL);
      for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const resolved = new URL(`${candidate.href}${suffix}`);
        if (existsSync(resolved)) return { shortCircuit: true, url: resolved.href };
      }
    }
    return nextResolve(specifier, context);
  },
});
const dbUrl = requiredEnv("SEC_TICKER_HUMAN_REVIEW_ISOLATED_DB_URL");
const accountSetupPath = requiredEnv("SEC_TICKER_HUMAN_REVIEW_ACCOUNT_SETUP_PATH");
const outputPath = requiredEnv("SEC_TICKER_HUMAN_REVIEW_REPORT_PATH");
const parsedDbUrl = new URL(dbUrl);
assert.equal(parsedDbUrl.hostname, "127.0.0.1");
assert.equal(parsedDbUrl.port, "59622");

let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls += 1;
  throw new Error("network is forbidden during isolated human-review verification");
};

const [{ persistSecCoverObservationsForRawItem }, tickerPersistence, humanReview] =
  await Promise.all([
    import("../lib/sec-cover-observations/persistence.ts"),
    import("../lib/sec-ticker-resolution/persistence.ts"),
    import("../lib/sec-ticker-resolution/humanReview.ts"),
  ]);
const { resolveAndPersistSecTickerChange } = tickerPersistence;
const {
  applySecTickerResolutionHumanDecision,
  readEffectiveSecTickerResolutionByDecisionId,
} = humanReview;

const accountSetup = JSON.parse(await readFile(accountSetupPath, "utf8")) as {
  prepared: Array<{ label: string; userId: string }>;
};
const accounts = {
  admin: requiredPreparedAccount("admin"),
  ordinary: requiredPreparedAccount("ordinary"),
};
const client = new Client({ connectionString: dbUrl });
await client.connect();
const repository = createRepository(client);
const report: Row = {
  schemaVersion: "sec-ticker-human-review-isolated-e2e-v1",
  repositoryHead: process.env.SEC_TICKER_HUMAN_REVIEW_REPOSITORY_HEAD ?? null,
  database: {
    host: parsedDbUrl.hostname,
    port: parsedDbUrl.port,
    network: "stockradar_ticker_human_review_0cc1_isolated",
    subnet: "10.250.66.0/24",
    protectedServicesUntouched: ["3110", "3113", "56321", "56322", "59521", "59522"],
  },
  externalCalls: { network: 0, llm: 0, cron: 0, alerts: 0, monitor: 0, backfill: 0 },
  checks: [],
};

try {
  const secondAdminUserId = "00000000-0000-4000-8000-000000000202";
  await client.query(
    "insert into public.user_profiles (id,email) values ($1,'ticker-resolution-admin-two@stockradar.test') on conflict (id) do nothing",
    [secondAdminUserId],
  );
  await client.query(
    "insert into public.admin_role_assignments (user_id,role,active) values ($1,'operations',true) on conflict (user_id,role) do update set active=true",
    [secondAdminUserId],
  );
  const decisions = await namedDecisions(client);
  const beforeDigests = await immutableDigests(client);

  const initialAuto = await effective(decisions.actualAutoOne.id, repository);
  assert.equal(initialAuto.effective.disposition, "automatic", JSON.stringify(initialAuto));
  assert.ok(initialAuto.effective.relationship);
  assert.equal(readString(initialAuto.effective.relationship.oldTicker), "VRAR");
  assert.equal(readString(initialAuto.effective.relationship.newTicker), "GGRP");

  const serviceRoleBefore = await humanAndAuditCounts(client);
  await client.query("begin");
  try {
    await client.query("set local role service_role");
    const roleWrite = await client.query(
      "select public.admin_apply_sec_ticker_resolution_human_decision($1::uuid,$2::uuid,$3,$4::integer,$5,$6,$7) as value",
      [
        accounts.admin.userId,
        decisions.actualAutoOne.id,
        decisions.actualAutoOne.decision_sha256,
        0,
        "reviewed",
        "Service-role privilege verification.",
        `verify-service-role-${randomUUID()}`,
      ],
    );
    assert.equal((roleWrite.rows[0]?.value as Row)?.status, "inserted");
  } finally {
    await client.query("rollback");
  }
  assert.deepEqual(await humanAndAuditCounts(client), serviceRoleBefore);
  (report.checks as Row[]).push({ name: "service-role-select-insert-only-rpc", result: "pass" });

  const reviewedRequest = `verify-reviewed-${randomUUID()}`;
  const reviewed = await apply(decisions.actualAutoOne, 0, "reviewed", reviewedRequest, repository);
  assert.equal(reviewed.status, "inserted");
  const reviewedReplay = await apply(decisions.actualAutoOne, 0, "reviewed", reviewedRequest, repository);
  assert.equal(reviewedReplay.status, "replayed");
  assert.equal(reviewedReplay.humanDecisionId, reviewed.humanDecisionId);
  assert.equal(await count(client, "select count(*)::int from public.sec_ticker_resolution_human_decisions where request_id=$1", [reviewedRequest]), 1);
  assert.equal(await count(client, "select count(*)::int from public.admin_audit_logs where request_id=$1", [reviewedRequest]), 1);
  await assertAdminError(
    () => apply(decisions.actualAutoOne, 0, "reviewed", reviewedRequest, repository, "changed replay reason"),
    "ADMIN_TICKER_IDEMPOTENCY_CONFLICT",
  );
  let current = await effective(decisions.actualAutoOne.id, repository);
  assert.equal(current.effective.disposition, "automatic");
  assert.equal(current.effective.reviewed, true);

  await apply(decisions.actualAutoOne, 1, "rejected", `verify-reject-${randomUUID()}`, repository);
  current = await effective(decisions.actualAutoOne.id, repository);
  assert.equal(current.effective.disposition, "rejected");
  assert.equal(current.effective.relationship, null);
  assert.ok(current.availableActions.includes("reviewed"));
  await apply(decisions.actualAutoOne, 2, "reviewed", `verify-reviewed-after-reject-${randomUUID()}`, repository);
  current = await effective(decisions.actualAutoOne.id, repository);
  assert.equal(current.effective.disposition, "rejected");
  assert.ok(current.latestHumanDecision);
  assert.equal(current.latestHumanDecision.action, "reviewed");
  await apply(decisions.actualAutoOne, 3, "withdrawn", `verify-withdraw-${randomUUID()}`, repository);
  current = await effective(decisions.actualAutoOne.id, repository);
  assert.equal(current.effective.disposition, "automatic");
  assert.equal(current.history.length, 4);
  assert.deepEqual(current.history.map((item) => item.action), ["reviewed", "rejected", "reviewed", "withdrawn"]);
  (report.checks as Row[]).push({ name: "review-reject-review-withdraw", result: "pass", finalDisposition: "automatic", historyCount: 4 });

  await assertAdminError(
    () => apply(decisions.veea, 0, "approved", `verify-veea-approve-${randomUUID()}`, repository),
    "ADMIN_TICKER_APPROVAL_EVIDENCE_INSUFFICIENT",
  );
  await apply(decisions.veea, 0, "rejected", `verify-veea-reject-${randomUUID()}`, repository);
  const veeaEffective = await effective(decisions.veea.id, repository);
  assert.equal(veeaEffective.effective.disposition, "rejected");
  assert.equal(veeaEffective.effective.relationship, null);
  assert.equal(readString(decisions.veea.security_identity_id), "");
  assert.equal(readString(decisions.veea.evidence_id), "");
  (report.checks as Row[]).push({ name: "actual-veea-null-evidence-safe-reject", result: "pass", decisionId: decisions.veea.id });

  const eligible = await createEligibleEffectiveDateConflict(client, repository, decisions.actualAutoOne);
  assert.equal(eligible.resolutionState, "REVIEW");
  assert.deepEqual(eligible.evaluation.reasons, ["EFFECTIVE_DATE_CONFLICT"]);
  assert.ok(eligible.evaluation.identity);
  assert.ok(eligible.evaluation.evidence);
  const eligibleRow = await one(client, "select * from public.sec_ticker_resolution_decisions where id=$1", [eligible.decisionId]);
  await apply(eligibleRow, 0, "approved", `verify-eligible-approve-${randomUUID()}`, repository);
  let eligibleEffective = await effective(eligible.decisionId, repository);
  assert.equal(eligibleEffective.effective.disposition, "approved");
  assert.ok(eligibleEffective.effective.relationship);
  assert.equal(readString(eligibleEffective.effective.relationship.oldTicker), "VRAR");
  assert.equal(readString(eligibleEffective.effective.relationship.newTicker), "GGRP");
  await client.query("begin");
  try {
    const revisedApprovalId = await insertRevisedAutomaticDecision(client, eligibleRow, null);
    const revisedApproval = await effective(eligible.decisionId, repository);
    assert.equal(revisedApproval.currentAutomaticDecisionId, revisedApprovalId);
    assert.equal(revisedApproval.effective.disposition, "pending_review");
    assert.equal(revisedApproval.effective.relationship, null);
    assert.equal(revisedApproval.effective.reconsiderationRequired, true);
    assert.equal(revisedApproval.history.length, 1);
    assert.equal(revisedApproval.history[0]?.action, "approved");
  } finally {
    await client.query("rollback");
  }
  await apply(eligibleRow, 1, "withdrawn", `verify-eligible-withdraw-${randomUUID()}`, repository);
  eligibleEffective = await effective(eligible.decisionId, repository);
  assert.equal(eligibleEffective.effective.disposition, "pending_review");
  assert.equal(eligibleEffective.effective.relationship, null);
  (report.checks as Row[]).push({ name: "synthetic-effective-date-conflict-approval-and-withdrawal", result: "pass", decisionId: eligible.decisionId });

  const concurrentClients = [new Client({ connectionString: dbUrl }), new Client({ connectionString: dbUrl })];
  await Promise.all(concurrentClients.map((candidate) => candidate.connect()));
  try {
    const concurrentActors = [accounts.admin.userId, secondAdminUserId];
    const attempts = await Promise.allSettled(
      concurrentClients.map((candidate, index) =>
        apply(
          decisions.missing,
          0,
          "rejected",
          `verify-concurrent-${randomUUID()}`,
          createRepository(candidate),
          undefined,
          concurrentActors[index],
        ),
      ),
    );
    assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
    const rejected = attempts.find((item): item is PromiseRejectedResult => item.status === "rejected");
    assert.match(String(rejected?.reason?.code ?? rejected?.reason), /ADMIN_TICKER_HUMAN_REVISION_CONFLICT/);
    assert.equal((await effective(decisions.missing.id, repository)).history.length, 1);
  } finally {
    await Promise.all(concurrentClients.map((candidate) => candidate.end()));
  }
  await assertAdminError(
    () => apply(decisions.missing, 0, "rejected", `verify-stale-${randomUUID()}`, repository),
    "ADMIN_TICKER_HUMAN_REVISION_CONFLICT",
  );
  (report.checks as Row[]).push({ name: "two-admin-concurrency-and-stale-revision", result: "pass", distinctActors: true, winningEvents: 1 });

  const unauthorizedBefore = await humanAndAuditCounts(client);
  await assertAdminError(
    () => apply(decisions.actualAutoTwo, 0, "rejected", `verify-forged-${randomUUID()}`, repository, undefined, accounts.ordinary.userId),
    "ADMIN_PERMISSION_REQUIRED",
  );
  assert.deepEqual(await humanAndAuditCounts(client), unauthorizedBefore);
  (report.checks as Row[]).push({ name: "database-actor-authorization", result: "pass" });

  await client.query("begin");
  try {
    await apply(decisions.actualAutoOne, 4, "rejected", `verify-stale-source-reject-${randomUUID()}`, repository);
    const revisedResultId = await insertConflictingSourceRevision(client, decisions.actualAutoOne);
    const revisedAutomaticId = await insertRevisedAutomaticDecision(client, decisions.actualAutoOne, revisedResultId);
    const rejectedUnderConflict = await effective(decisions.actualAutoOne.id, repository);
    assert.equal(rejectedUnderConflict.status, "available");
    assert.equal(rejectedUnderConflict.currentAutomaticDecisionId, revisedAutomaticId);
    assert.equal(rejectedUnderConflict.effective.disposition, "rejected");
    assert.equal(rejectedUnderConflict.effective.relationship, null);
    assert.equal(rejectedUnderConflict.effective.reconsiderationRequired, true);
    assert.equal(rejectedUnderConflict.automatic.status, "unavailable");
    const unrelated = await effective(decisions.actualAutoTwo.id, repository);
    assert.equal(unrelated.effective.disposition, "automatic");
    assert.equal(unrelated.history.length, 0);
  } finally {
    await client.query("rollback");
  }
  (report.checks as Row[]).push({
    name: "rejection-survives-source-result-and-automatic-revision",
    result: "pass",
    unrelatedPairUnaffected: true,
    syntheticAdversarialRevision: true,
  });

  const rollbackBefore = await humanAndAuditCounts(client);
  await client.query("begin");
  try {
    await client.query(`create function public.verify_ticker_human_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'VERIFY_AUDIT_FAILURE'; end $$`);
    await client.query(`create trigger verify_ticker_human_audit_failure before insert on public.admin_audit_logs for each row when (new.action like 'ticker_resolution.human_%') execute function public.verify_ticker_human_audit_failure()`);
    await assertAdminError(
      () => apply(decisions.veea, 1, "withdrawn", `verify-audit-failure-${randomUUID()}`, repository),
      "ADMIN_TICKER_WRITE_FAILED",
    );
  } finally {
    await client.query("rollback");
  }
  assert.deepEqual(await humanAndAuditCounts(client), rollbackBefore);
  (report.checks as Row[]).push({ name: "audit-and-human-write-atomic-rollback", result: "pass" });

  await client.query("begin");
  try {
    await client.query("alter table public.sec_ticker_resolution_human_decisions disable trigger sec_ticker_resolution_human_decisions_append_only");
    await client.query("update public.sec_ticker_resolution_human_decisions set automatic_snapshot='{}'::jsonb where automatic_decision_id=$1", [decisions.veea.id]);
    assert.deepEqual(await readEffectiveSecTickerResolutionByDecisionId({ decisionId: readString(decisions.veea.id), repository }), {
      status: "unavailable",
      reason: "human_decision_snapshot_invalid",
    });
  } finally {
    await client.query("rollback");
  }
  (report.checks as Row[]).push({ name: "tampered-history-fails-closed", result: "pass" });

  await verifyPrivilegesAndImmutability(client);
  const afterDigests = await immutableDigests(client);
  assert.equal(afterDigests.actualAutomatic, beforeDigests.actualAutomatic);
  assert.equal(afterDigests.actualEvidence, beforeDigests.actualEvidence);
  assert.equal(afterDigests.actualIdentities, beforeDigests.actualIdentities);
  assert.equal(networkCalls, 0);
  report.externalCalls = { network: networkCalls, llm: 0, cron: 0, alerts: 0, monitor: 0, backfill: 0 };
  report.immutability = { actualAutomatic: "unchanged", actualEvidence: "unchanged", actualIdentities: "unchanged" };
  report.ok = true;
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.end();
}

async function apply(
  decision: Row,
  expectedRevision: number,
  action: "reviewed" | "approved" | "rejected" | "withdrawn",
  requestId: string,
  targetRepository: ReturnType<typeof createRepository>,
  reason = `Verification: ${action} exact persisted source evidence.`,
  actorUserId = accounts.admin.userId,
) {
  return applySecTickerResolutionHumanDecision({
    actorUserId,
    automaticDecisionId: readString(decision.id),
    expectedAutomaticSha256: readString(decision.decision_sha256),
    expectedRevision,
    action,
    reason,
    requestId,
    repository: targetRepository,
  }) as Promise<Row>;
}

async function effective(decisionId: unknown, targetRepository: ReturnType<typeof createRepository>) {
  const result = await readEffectiveSecTickerResolutionByDecisionId({ decisionId: readString(decisionId), repository: targetRepository });
  assert.equal(result.status, "available", JSON.stringify(result));
  return result as Extract<typeof result, { status: "available" }>;
}

async function namedDecisions(pgClient: PgClient) {
  const rows = (await pgClient.query("select * from public.sec_ticker_resolution_decisions order by created_at,id")).rows;
  const find = (predicate: (row: Row) => boolean, label: string) => {
    const row = rows.find(predicate);
    assert.ok(row, `missing seeded decision: ${label}`);
    return row;
  };
  return {
    actualAutoOne: find((row) => {
      const relationship = (row.decision_payload as Row)?.relationship as Row;
      return row.resolution_state === "AUTO" && relationship?.oldTicker === "VRAR" && relationship?.newTicker === "GGRP";
    }, "VRAR/GGRP AUTO"),
    actualAutoTwo: find((row) => readString(row.id) === "92f17062-2c62-5736-97bf-428e0d779585", "GGRP/BTLN AUTO"),
    veea: find((row) => readString(row.issuer_cik) === "0001840317", "VEEA REVIEW"),
    missing: find((row) => row.resolution_state === "UNRESOLVED", "missing-evidence UNRESOLVED"),
  };
}

async function createEligibleEffectiveDateConflict(
  pgClient: PgClient,
  targetRepository: ReturnType<typeof createRepository>,
  beforeDecision: Row,
) {
  const source = inlineCover(
    "GGRP",
    "Common Stock, par value $0.001 per share",
    'Effective February 19, 2026, we changed our ticker symbol on Nasdaq from "VRAR" to "GGRP". The change did not alter other terms of our common stock.',
  );
  const raw = rawItem({
    id: "44900005-0000-4000-8000-000000000015",
    accession: "0001493152-26-900005",
    acceptedAt: "2026-02-18T12:00:00Z",
    source,
  });
  await insertRawItem(pgClient, raw);
  const cover = await persistSecCoverObservationsForRawItem({ rawItemId: raw.id as string, rawItem: raw as never, repository: targetRepository });
  assert.equal(cover.status, "available", JSON.stringify(cover));
  const payload = beforeDecision.decision_payload as Row;
  const input = payload.input as Row;
  return resolveAndPersistSecTickerChange({
    issuerCik: readString(beforeDecision.issuer_cik),
    evidenceAccessionNumber: readString(raw.raw_payload && (raw.raw_payload as Row).accession_number),
    evidenceSourceSha256: sha256(source),
    beforeAccessionNumber: readString(beforeDecision.before_accession_number),
    beforeSourceSha256: readString(input.beforeSourceSha256),
    afterAccessionNumber: readString((raw.raw_payload as Row).accession_number),
    afterSourceSha256: sha256(source),
    repository: targetRepository,
  });
}

function createRepository(pgClient: PgClient) {
  return {
    async select(table: string, query: Record<string, string>) {
      const specs: Record<string, { filters: string[]; order: string }> = {
        raw_items: { filters: ["id"], order: "id" },
        sec_cover_observation_results: { filters: ["accession_number", "source_sha256", "id"], order: "created_at desc,id desc" },
        sec_cover_security_observations: { filters: ["result_id"], order: "observation_index asc" },
        sec_structured_raw_sources: { filters: ["id"], order: "id" },
        sec_ticker_resolution_decisions: { filters: ["id", "issuer_cik", "resolution_type", "method_version"], order: "created_at desc,id desc" },
        sec_ticker_security_identities: { filters: ["id"], order: "id" },
        sec_ticker_change_evidence: { filters: ["id"], order: "id" },
        sec_ticker_resolution_human_decisions: { filters: ["scope_key", "request_id"], order: "revision asc" },
      };
      const spec = specs[table];
      if (!spec) return { ok: false, status: 400, data: null, error: `unsupported table ${table}` };
      const values: unknown[] = [];
      const clauses: string[] = [];
      for (const filter of spec.filters) {
        const value = query[filter];
        if (!value) continue;
        if (!value.startsWith("eq.")) return { ok: false, status: 400, data: null, error: `unsupported filter ${filter}` };
        values.push(value.slice(3));
        clauses.push(`${filter} = $${values.length}`);
      }
      const limit = Math.max(1, Math.min(Number(query.limit || 1000), 1000));
      const result = await pgClient.query(`select * from public.${table}${clauses.length ? ` where ${clauses.join(" and ")}` : ""} order by ${spec.order} limit ${limit}`, values);
      return { ok: true, status: 200, data: JSON.parse(JSON.stringify(result.rows)) };
    },
    async rpc(functionName: string, payload: Row) {
      try {
        if (functionName === "persist_sec_cover_observation_result") {
          const result = await pgClient.query("select public.persist_sec_cover_observation_result($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb) as value", [
            payload.p_raw_item_id,
            payload.p_source === null ? null : json(payload.p_source),
            json(payload.p_result),
            json(payload.p_observations),
          ]);
          return { ok: true, status: 200, data: result.rows[0]?.value };
        }
        if (functionName === "persist_sec_ticker_resolution") {
          const result = await pgClient.query("select public.persist_sec_ticker_resolution($1::jsonb,$2::jsonb,$3::jsonb) as value", [
            payload.p_identity === null ? null : json(payload.p_identity),
            payload.p_evidence === null ? null : json(payload.p_evidence),
            json(payload.p_decision),
          ]);
          return { ok: true, status: 200, data: result.rows[0]?.value };
        }
        if (functionName === "admin_apply_sec_ticker_resolution_human_decision") {
          const result = await pgClient.query("select public.admin_apply_sec_ticker_resolution_human_decision($1::uuid,$2::uuid,$3,$4::integer,$5,$6,$7) as value", [
            payload.p_actor_user_id,
            payload.p_automatic_decision_id,
            payload.p_expected_automatic_sha256,
            payload.p_expected_revision,
            payload.p_action,
            payload.p_reason,
            payload.p_request_id,
          ]);
          return { ok: true, status: 200, data: result.rows[0]?.value };
        }
        return { ok: false, status: 400, data: null, error: `unsupported RPC ${functionName}` };
      } catch (error) {
        return { ok: false, status: 500, data: null, error: error instanceof Error ? error.message : "verification RPC failed" };
      }
    },
  };
}

async function verifyPrivilegesAndImmutability(pgClient: PgClient) {
  assert.equal((await one(pgClient, "select relrowsecurity as value from pg_catalog.pg_class where oid='public.sec_ticker_resolution_human_decisions'::regclass")).value, true);
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await one(pgClient, "select has_table_privilege($1,'public.sec_ticker_resolution_human_decisions','select') as value", [role])).value, false);
    assert.equal((await one(pgClient, "select has_function_privilege($1,'public.admin_apply_sec_ticker_resolution_human_decision(uuid,uuid,text,integer,text,text,text)','execute') as value", [role])).value, false);
  }
  assert.equal((await one(pgClient, "select has_table_privilege('service_role','public.sec_ticker_resolution_human_decisions','select,insert') as value")).value, true);
  assert.equal((await one(pgClient, "select has_table_privilege('service_role','public.sec_ticker_resolution_human_decisions','update,delete') as value")).value, false);
  assert.equal((await one(pgClient, "select has_function_privilege('service_role','public.admin_apply_sec_ticker_resolution_human_decision(uuid,uuid,text,integer,text,text,text)','execute') as value")).value, true);
  await assert.rejects(() => pgClient.query("update public.sec_ticker_resolution_human_decisions set reason=reason"), /append-only/i);
  await assert.rejects(() => pgClient.query("delete from public.sec_ticker_resolution_human_decisions"), /append-only/i);
}

async function insertConflictingSourceRevision(pgClient: PgClient, decision: Row) {
  const payload = decision.decision_payload as Row;
  const input = payload.input as Row;
  const sourceSha = readString(input.afterSourceSha256);
  const revisedResultId = randomUUID();
  await pgClient.query(`insert into public.sec_cover_observation_results (
      id,lineage_kind,raw_item_id,filing_ledger_accession_number,filing_ledger_source_raw_id,filing_ledger_source_kind,
      accession_number,issuer_cik,form_type_raw,filing_date_raw,accepted_at_raw,accepted_at,source_parser_version,
      source_state,source_state_hash,source_raw_id,source_kind,source_url,source_document,source_sha256,
      extraction_method,extraction_version,extraction_status,observation_count,result_payload,payload_sha256,created_at
    ) select $6::uuid,lineage_kind,raw_item_id,filing_ledger_accession_number,filing_ledger_source_raw_id,filing_ledger_source_kind,
      accession_number,issuer_cik,form_type_raw,filing_date_raw,accepted_at_raw,accepted_at,source_parser_version,
      source_state,$2,source_raw_id,source_kind,source_url,source_document,$3,
      extraction_method,extraction_version,extraction_status,observation_count,result_payload,$4,pg_catalog.now()
    from public.sec_cover_observation_results where accession_number=$1 and source_sha256=$5 limit 1`, [
    readString(decision.after_accession_number),
    "a".repeat(64),
    "b".repeat(64),
    "c".repeat(64),
    sourceSha,
    revisedResultId,
  ]);
  return revisedResultId;
}

async function insertRevisedAutomaticDecision(
  pgClient: PgClient,
  decision: Row,
  revisedResultId: string | null,
) {
  const id = randomUUID();
  const decisionSha = sha256(`${readString(decision.decision_sha256)}:${id}`);
  const sourceSha = revisedResultId ? "b".repeat(64) : null;
  await pgClient.query(`insert into public.sec_ticker_resolution_decisions (
      id,issuer_cik,evidence_accession_number,before_accession_number,after_accession_number,
      source_result_id,security_identity_id,evidence_id,resolution_type,resolution_state,method,method_version,
      rule_reasons,decision_payload,decision_sha256,created_at
    ) select $2::uuid,issuer_cik,evidence_accession_number,before_accession_number,after_accession_number,
      coalesce($3::uuid,source_result_id),security_identity_id,evidence_id,resolution_type,resolution_state,method,method_version,
      rule_reasons,
      case when $3::uuid is null then decision_payload
        else pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(decision_payload,'{input,sourceResultId}',pg_catalog.to_jsonb($3::text)),
            '{input,afterResultId}',pg_catalog.to_jsonb($3::text)
          ),
          '{input,sourceSha256}',pg_catalog.to_jsonb($4::text)
        )
      end,
      $5,pg_catalog.clock_timestamp() + interval '1 second'
    from public.sec_ticker_resolution_decisions where id=$1`, [
    decision.id,
    id,
    revisedResultId,
    sourceSha,
    decisionSha,
  ]);
  return id;
}

async function immutableDigests(pgClient: PgClient) {
  return {
    actualAutomatic: readString((await one(pgClient, "select md5(coalesce(jsonb_agg(to_jsonb(d) order by id)::text,'[]')) as value from public.sec_ticker_resolution_decisions d where d.evidence_accession_number not like '%-90000%'")).value),
    actualEvidence: readString((await one(pgClient, "select md5(coalesce(jsonb_agg(to_jsonb(e) order by id)::text,'[]')) as value from public.sec_ticker_change_evidence e where e.source_accession_number not like '%-90000%'")).value),
    actualIdentities: readString((await one(pgClient, "select md5(coalesce(jsonb_agg(to_jsonb(i) order by id)::text,'[]')) as value from public.sec_ticker_security_identities i where i.id in (select d.security_identity_id from public.sec_ticker_resolution_decisions d where d.evidence_accession_number not like '%-90000%')")).value),
  };
}

async function humanAndAuditCounts(pgClient: PgClient) {
  return {
    humans: await count(pgClient, "select count(*)::int from public.sec_ticker_resolution_human_decisions"),
    audits: await count(pgClient, "select count(*)::int from public.admin_audit_logs where action like 'ticker_resolution.human_%'"),
  };
}

async function assertAdminError(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, (error: unknown) => {
    const candidate = error as { code?: string; message?: string };
    return String(candidate.code ?? candidate.message ?? error).includes(code);
  });
}

function rawItem(input: { id: string; accession: string; acceptedAt: string; source: string }): Row {
  const cik = "0001854445";
  return {
    id: input.id,
    run_id: null,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: input.accession,
    source_url: `https://www.sec.gov/Archives/edgar/data/1854445/${input.accession.replace(/-/g, "")}/${input.accession}-index.html`,
    title: `SEC 10-Q ${input.accession}`,
    published_at: input.acceptedAt,
    fetched_at: "2026-09-13T01:00:00Z",
    body_text: null,
    analysis_text: null,
    raw_payload: {
      accession_number: input.accession,
      cik,
      form_type: "10-Q",
      filing_date: input.acceptedAt.slice(0, 10),
      accepted_at: input.acceptedAt,
      parser_version: "sec_edgar_raw_parser_v1",
      primary_document_url: `https://www.sec.gov/Archives/edgar/data/1854445/${input.accession.replace(/-/g, "")}/synthetic.htm`,
      primary_document_html: input.source,
      primary_document_html_char_count: input.source.length,
      primary_document_html_truncated: false,
    },
    metadata: { sentinel: "ticker-human-review-verification" },
    dedupe_key: `sec_edgar:${input.accession}`,
  };
}

async function insertRawItem(pgClient: PgClient, raw: Row) {
  await pgClient.query(`insert into public.raw_items (
    id,run_id,source_code,source_group,source_unique_id,source_url,title,published_at,fetched_at,
    body_text,analysis_text,raw_payload,metadata,dedupe_key
  ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`, [
    raw.id, raw.run_id, raw.source_code, raw.source_group, raw.source_unique_id, raw.source_url, raw.title,
    raw.published_at, raw.fetched_at, raw.body_text, raw.analysis_text, json(raw.raw_payload), json(raw.metadata), raw.dedupe_key,
  ]);
}

function inlineCover(symbol: string, title: string, narrative: string) {
  return `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2026"><body><ix:header><ix:resources><xbrli:context id="cover"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001854445</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context></ix:resources></ix:header><ix:nonNumeric name="dei:Security12bTitle" contextRef="cover">${title}</ix:nonNumeric><ix:nonNumeric name="dei:TradingSymbol" contextRef="cover">${symbol}</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="cover">Nasdaq</ix:nonNumeric><p>${narrative}</p></body></html>`;
}

async function one(pgClient: PgClient, sql: string, values: unknown[] = []) {
  const result = await pgClient.query(sql, values);
  assert.ok(result.rows[0], `query returned no row: ${sql}`);
  return result.rows[0]!;
}

async function count(pgClient: PgClient, sql: string, values: unknown[] = []) {
  return Number((await one(pgClient, sql, values)).count);
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  return value && typeof value === "object" ? JSON.stringify(value) : "";
}

function json(value: unknown) {
  return JSON.stringify(value ?? null);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredPreparedAccount(label: string) {
  const account = accountSetup.prepared.find((item) => item.label === label);
  if (!account?.userId) throw new Error(`prepared ${label} account is required`);
  return account;
}
