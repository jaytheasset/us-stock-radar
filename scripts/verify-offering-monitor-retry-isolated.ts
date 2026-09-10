import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EVENT_ID = "98100000-0000-4000-8000-000000000011";
const RAW_ITEM_ID = "98200000-0000-4000-8000-000000000021";
const RETRY_JOB_ID = "98300000-0000-4000-8000-000000000031";
const RACE_JOB_ID = "98300000-0000-4000-8000-000000000032";
const RESERVATION_JOB_ID = "98300000-0000-4000-8000-000000000033";
const ACCESSION = "0001213900-26-088706";
const CIK = "0001840317";

type WorkflowProbe = {
  rawCalls: number;
  siteAnalysisCalls: number;
  sidecarEnqueueCalls: number;
  releaseCalls: number;
};

declare global {
  var __offeringRetryWorkflowProbe: WorkflowProbe | undefined;
}

const dbUrl = process.env.OFFERING_RETRY_ISOLATED_DB_URL || "";
const expectedPort = process.env.OFFERING_RETRY_ISOLATED_DB_PORT || "";
const projectId = process.env.OFFERING_RETRY_ISOLATED_PROJECT_ID || "";
const moduleRoot = process.env.OFFERING_VERIFY_NODE_MODULES || "";
const apiUrl = process.env.SUPABASE_URL || "";
assertIsolatedTarget({ dbUrl, expectedPort, projectId, apiUrl });
if (!moduleRoot) throw new Error("OFFERING_VERIFY_NODE_MODULES is required");
if (!process.env.SUPABASE_SECRET_KEY) throw new Error("SUPABASE_SECRET_KEY is required");

const pgModuleUrl = pathToFileURL(`${moduleRoot.replace(/[\\/]$/, "")}/pg/lib/index.js`).href;
const pg = (await import(pgModuleUrl)).default;
const { Client } = pg;

const mocks = new Map<string, string>([
  ["workflow", dataModule(`
    export class FatalError extends Error {}
    export class RetryableError extends Error {
      constructor(message, options) { super(message); this.options = options; }
    }
    export function getStepMetadata() { return { stepId: "isolated-replay-step", attempt: 1 }; }
    export function getWorkflowMetadata() {
      return {
        workflowRunId: "isolated-replay-run",
        workflowName: "secSourceIngestWorkflow",
        workflowStartedAt: new Date("2026-09-10T00:00:00.000Z"),
        url: "https://isolated.example.test/workflow",
      };
    }
  `)],
  ["server-only", dataModule("export {};\n")],
  ["@/lib/ingestWorkflowLock", dataModule(`
    export async function renewIngestWorkflowLock() { return { ok: true, renewed: true }; }
    export async function releaseIngestWorkflowLock() {
      globalThis.__offeringRetryWorkflowProbe.releaseCalls += 1;
      return { ok: true, released: true };
    }
  `)],
  ["@/lib/newsIngestFallbacks", dataModule(`
    export async function runAccesswireNewsIngestWithFallback() { return {}; }
    export async function runFdaNewsIngestWithFallback() { return {}; }
  `)],
  ["@/lib/newsIngest", dataModule(`
    export async function runBusinessWireNewsIngest() { return {}; }
    export async function runDeaNewsIngest() { return {}; }
    export async function runDojNewsIngest() { return {}; }
    export async function runGlobeNewsIngest() { return {}; }
    export async function runNasdaqCorporateActionsNewsIngest() { return {}; }
    export async function runNasdaqTraderNewsIngest() { return {}; }
    export async function runNewsfileNewsIngest() { return {}; }
    export async function runOfacNewsIngest() { return {}; }
    export async function runPRNewswireNewsIngest() { return {}; }
    export async function runWhiteHouseNewsIngest() { return {}; }
  `)],
  ["@/lib/secFilingAnalysisIngest", dataModule(`
    export async function runSecFilingAnalysisIngest() {
      globalThis.__offeringRetryWorkflowProbe.siteAnalysisCalls += 1;
      throw new Error("site analysis must not rerun for a completed persisted Event");
    }
  `)],
  ["@/lib/secPeriodicOsTriggerBridge", dataModule(`
    export const SEC_PERIODIC_OS_TRIGGER_FORMS = ["10-Q", "10-K", "20-F", "40-F"];
    export function extractPeriodicOsIssuerCiks() { return []; }
    export async function runSecPeriodicOsTriggerBridge() { throw new Error("periodic O/S must not run"); }
  `)],
  ["@/lib/secProspectusOsTriggerBridge", dataModule(`
    export function extractProspectusOsRawItemIds() { return []; }
    export async function runSecProspectusOsTriggerBridge() { throw new Error("prospectus O/S must not run"); }
  `)],
  ["@/lib/offeringMonitorJobFoundation", dataModule(`
    export const OFFERING_MONITOR_JOB_PROMPT_KEY = "offering_monitor_normalization_job";
    export const OFFERING_MONITOR_JOB_VERSION = "offering_monitor_job_v2";
    export function buildOfferingMonitorJobIdentity() { return null; }
  `)],
  ["@/lib/offeringMonitorJobStarter", dataModule(`
    export async function enqueueOfferingMonitorJob() {
      globalThis.__offeringRetryWorkflowProbe.sidecarEnqueueCalls += 1;
      throw new Error("O/S sidecar must not enqueue on Monitor-only replay");
    }
  `)],
  ["@/lib/secIngest", dataModule(`
    export async function runSecRawIngest() {
      globalThis.__offeringRetryWorkflowProbe.rawCalls += 1;
      return {
        ok: true,
        stage: "complete",
        runId: "isolated-source-run",
        stats: { raw_upserted_count: 0 },
        items: [{
          ok: true,
          raw_item_id: ${JSON.stringify(RAW_ITEM_ID)},
          form_type: "S-3",
          cik: ${JSON.stringify(CIK)},
        }],
      };
    }
  `)],
  ["@/lib/sources/sec/forms/common/forms", dataModule(`
    export const SEC_FORM_ROOM_MANIFEST = [{ slug: "offering", forms: ["S-3"] }];
    export const SEC_PRODUCTION_INGEST_SCHEDULE = [{
      id: "isolated-offering-replay",
      rooms: ["offering"],
      countPerForm: 1,
      attachmentLimit: 1,
    }];
  `)],
  ["@/lib/sourceWorkflowConfig", dataModule(`
    export const SEC_WORKFLOW_CONFIG = { lockTtlSeconds: 7200 };
    export const SOURCE_INGEST_WORKFLOW_SOURCES = {};
  `)],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mock = mocks.get(specifier);
    return mock ? { shortCircuit: true, url: mock } : nextResolve(specifier, context);
  },
});

const repository = await import("../lib/offeringMonitorJobRepository.ts");
const { secSourceIngestWorkflow } = await import("../workflows/source-ingest.ts");

const client = new Client({ connectionString: dbUrl });
await client.connect();
try {
  await cleanupFixtures(client);
  await verifyRpcPrivileges(client);
  await seedBase(client);
  await verifyAtomicWriterInterleavings(client, repository);
  await verifyReservationFallback(client, repository);
  const replay = await verifySourceReplay(client, secSourceIngestWorkflow);
  await assertRuntimeBoundaries();

  const report = {
    status: "PASS",
    isolatedProjectId: projectId,
    isolatedDbPort: expectedPort,
    atomicInterleavings: "PASS",
    missingRowRejected: "PASS",
    rpcPrivilegeBoundary: "PASS",
    reservationPendingFallback: "PASS",
    sourceIngestReplay: replay,
    runtimeBoundaries: {
      siteAnalysisReruns: 0,
      sidecarEnqueues: 0,
      llmProviderCalls: 0,
      externalDeliveryCalls: 0,
      legacyStage2Calls: 0,
    },
  };
  const outputPath = path.resolve(
    process.cwd(),
    "outputs/sec-dev-dashboard/offering-monitor-retry-isolated.json",
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
} finally {
  await cleanupFixtures(client).catch((error: unknown) => {
    console.error(`[verify-offering-monitor-retry-isolated] cleanup failed: ${String(error)}`);
  });
  await client.end();
}

async function verifyAtomicWriterInterleavings(client: any, repo: typeof repository) {
  const identity = jobIdentity(RACE_JOB_ID);
  await seedJob(client, RACE_JOB_ID, "pending", {
    phase: "sidecar_only_pending",
    registry_alert_status: "pending",
  });

  await repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, {
    status: "failed",
    error: "registry failure first",
  });
  await repo.completeOfferingMonitorJobAfterSidecar(identity, {
    status: "completed",
    providerCalled: false,
    inserted: 1,
    deduped: 0,
  });
  await assertOwnedMetadata(client, RACE_JOB_ID, "failed", "sidecar_only_completed", "completed");

  await resetJob(client, RACE_JOB_ID);
  await repo.completeOfferingMonitorJobAfterSidecar(identity, {
    status: "completed",
    providerCalled: false,
    inserted: 1,
    deduped: 0,
  });
  await repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, {
    status: "failed",
    error: "sidecar first",
  });
  await assertOwnedMetadata(client, RACE_JOB_ID, "failed", "sidecar_only_completed", "completed");

  await resetJob(client, RACE_JOB_ID);
  await Promise.all([
    repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, {
      status: "failed",
      error: "concurrent registry failure",
    }),
    repo.completeOfferingMonitorJobAfterSidecar(identity, {
      status: "completed",
      providerCalled: false,
      inserted: 1,
      deduped: 0,
    }),
  ]);
  await assertOwnedMetadata(client, RACE_JOB_ID, "failed", "sidecar_only_completed", "completed");

  await repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, { status: "completed" });
  const lateFailed = await repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, {
    status: "failed",
    error: "late failure",
  });
  const latePending = await repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, {
    status: "deferred",
    readerReason: "late pending",
  });
  assert.equal(lateFailed.status, "completed");
  assert.equal(latePending.status, "completed");
  let row = await readJob(client, RACE_JOB_ID);
  assert.equal(row.metadata.registry_alert_status, "completed");
  assert.equal(row.metadata.phase, "sidecar_only_completed");

  await resetJob(client, RACE_JOB_ID);
  await repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, {
    status: "failed",
    error: "attach interleaving",
  });
  await repo.attachOfferingMonitorWorkflowRun(identity, "isolated-workflow-run");
  row = await readJob(client, RACE_JOB_ID);
  assert.equal(row.metadata.registry_alert_status, "failed");
  assert.equal(row.metadata.phase, "sidecar_only_pending");
  assert.equal(row.metadata.workflow_run_id, "isolated-workflow-run");
  await repo.recordOfferingMonitorRegistryExecution(RACE_JOB_ID, { status: "completed" });
  await repo.completeOfferingMonitorJobAfterSidecar(identity, {
    status: "completed",
    providerCalled: false,
    inserted: 1,
    deduped: 0,
  });

  await assert.rejects(
    repo.recordOfferingMonitorRegistryExecution(
      "98300000-0000-4000-8000-000000000099",
      { status: "failed", error: "missing" },
    ),
    /lost job authority: missing/,
  );
}

async function verifyReservationFallback(client: any, repo: typeof repository) {
  const identity = jobIdentity(RESERVATION_JOB_ID);
  const reservation = await repo.reserveOfferingMonitorJob(identity);
  assert.equal(reservation.reserved, true);
  const candidate = await repo.readOfferingMonitorRegistryRetryCandidate({
    eventId: EVENT_ID,
    rawItemId: RAW_ITEM_ID,
  });
  assert.ok(candidate);
  const row = await readJob(client, RESERVATION_JOB_ID);
  assert.equal(row.metadata.registry_alert_status, "pending");
  await repo.recordOfferingMonitorRegistryExecution(RESERVATION_JOB_ID, { status: "completed" });
}

async function verifySourceReplay(client: any, workflow: typeof secSourceIngestWorkflow) {
  globalThis.__offeringRetryWorkflowProbe = {
    rawCalls: 0,
    siteAnalysisCalls: 0,
    sidecarEnqueueCalls: 0,
    releaseCalls: 0,
  };
  await seedJob(client, RETRY_JOB_ID, "completed", {
    phase: "sidecar_only_completed",
    sidecar_status: "completed",
    sidecar_inserted: 1,
    registry_alert_status: "failed",
    registry_alert_error: "intentional prior Monitor failure",
  });

  const input = {
    triggerId: "isolated-trigger",
    groupId: "isolated-offering-replay",
    lockKey: "isolated-lock",
    lockOwner: "isolated-owner",
  };
  const retry = await workflow(input);
  assert.equal(retry.analyses.length, 1);
  assert.equal(retry.analyses[0]?.stage, "completed");
  assert.equal(retry.analyses[0]?.reused, true);
  assert.equal(retry.analyses[0]?.offeringMonitorRegistryRetry?.status, "retried");
  assert.equal(retry.analyses[0]?.offeringMonitorRegistryRetry?.execution?.status, "completed");
  assert.equal(globalThis.__offeringRetryWorkflowProbe.siteAnalysisCalls, 0);
  assert.equal(globalThis.__offeringRetryWorkflowProbe.sidecarEnqueueCalls, 0);
  const completed = await readJob(client, RETRY_JOB_ID);
  assert.equal(completed.status, "completed");
  assert.equal(completed.metadata.phase, "sidecar_only_completed");
  assert.equal(completed.metadata.sidecar_status, "completed");
  assert.equal(completed.metadata.registry_alert_status, "completed");

  const noOp = await workflow(input);
  assert.equal(noOp.analyses.length, 0);
  assert.equal(globalThis.__offeringRetryWorkflowProbe.siteAnalysisCalls, 0);
  assert.equal(globalThis.__offeringRetryWorkflowProbe.sidecarEnqueueCalls, 0);
  assert.equal(globalThis.__offeringRetryWorkflowProbe.rawCalls, 2);
  assert.equal(globalThis.__offeringRetryWorkflowProbe.releaseCalls, 2);

  return {
    status: "PASS",
    initialState: "failed",
    retryExecution: "completed",
    subsequentReplay: "no_op",
    siteAnalysisReruns: 0,
    sidecarEnqueues: 0,
  };
}

async function seedBase(client: any) {
  await client.query(
    `insert into public.sources (code,name,source_group,runtime_owner,enabled,metadata)
     values ('sec_edgar','SEC EDGAR','filings','external',true,'{}'::jsonb)
     on conflict (code) do nothing`,
  );
  await client.query(
    `insert into public.event_types (code,label,category,badge_tone,source_groups,status)
     values ('offering','Offering','filing','neutral',array['filings']::public.source_group[],'active')
     on conflict (code) do nothing`,
  );
  await client.query(
    `insert into public.raw_items (
       id,source_code,source_group,source_unique_id,source_url,title,raw_payload,dedupe_key,metadata
     ) values ($1,'sec_edgar','filings',$2,'https://www.sec.gov/','Isolated offering',
       jsonb_build_object('accession_number',$2::text,'cik','1840317','cik_padded',$3::text),
       $2,jsonb_build_object('workflow_analysis_status','completed','workflow_event_id',$4::text))`,
    [RAW_ITEM_ID, ACCESSION, CIK, EVENT_ID],
  );
  await client.query(
    `insert into public.events (
       id,raw_item_id,source_code,source_group,source_name,source_url,ticker,event_type,
       score,delivery_level,impact,signal,title,group_dedupe_key,metadata
     ) values ($1,$2,'sec_edgar','filings','SEC EDGAR','https://www.sec.gov/','VEEA','offering',
       50,'archive','low','neutral','Isolated offering',$3,
       jsonb_build_object('accession_number',$3::text,'cik','1840317'))`,
    [EVENT_ID, RAW_ITEM_ID, ACCESSION],
  );
  const instrument = await client.query(
    `insert into public.dilution_instruments (
       instrument_key,issuer_cik,instrument_type,name,first_source_accession
     ) values ('isolated-monitor-atm',$1,'atm_program','Isolated ATM',$2) returning id`,
    [CIK, ACCESSION],
  );
  await client.query(
    `insert into public.dilution_instrument_snapshots (
       instrument_id,as_of_date,status,currency,original_capacity,remaining_potential_shares,
       start_date,source_accession,last_checked
     ) values ($1,'2026-09-10','current','USD',4353000,76513659,'2026-08-13',$2,'2026-09-10')`,
    [instrument.rows[0].id, ACCESSION],
  );
}

async function verifyRpcPrivileges(client: any) {
  const result = await client.query(`
    select role_name, function_name,
      has_function_privilege(role_name, function_name, 'EXECUTE') as can_execute
    from (values
      ('anon', 'public.set_offering_monitor_registry_alert_state(uuid,text,text)'),
      ('authenticated', 'public.set_offering_monitor_registry_alert_state(uuid,text,text)'),
      ('service_role', 'public.set_offering_monitor_registry_alert_state(uuid,text,text)'),
      ('anon', 'public.attach_offering_monitor_workflow_run(uuid,text)'),
      ('authenticated', 'public.attach_offering_monitor_workflow_run(uuid,text)'),
      ('service_role', 'public.attach_offering_monitor_workflow_run(uuid,text)'),
      ('anon', 'public.finish_offering_monitor_sidecar_job(uuid,text,text,text,jsonb)'),
      ('authenticated', 'public.finish_offering_monitor_sidecar_job(uuid,text,text,text,jsonb)'),
      ('service_role', 'public.finish_offering_monitor_sidecar_job(uuid,text,text,text,jsonb)')
    ) as privileges(role_name, function_name)
  `);
  for (const row of result.rows) {
    assert.equal(row.can_execute, row.role_name === "service_role", JSON.stringify(row));
  }
}

async function cleanupFixtures(client: any) {
  await client.query(
    `delete from public.user_alert_deliveries where alert_event_id=$1`,
    [EVENT_ID],
  );
  await client.query(
    `delete from public.ai_outputs where ai_run_id = any($1::uuid[])`,
    [[RETRY_JOB_ID, RACE_JOB_ID, RESERVATION_JOB_ID]],
  );
  await client.query(
    `delete from public.ai_runs where id = any($1::uuid[])`,
    [[RETRY_JOB_ID, RACE_JOB_ID, RESERVATION_JOB_ID]],
  );
  await client.query(
    `delete from public.dilution_instrument_snapshots where source_accession=$1`,
    [ACCESSION],
  );
  await client.query(
    `delete from public.dilution_instruments where instrument_key='isolated-monitor-atm'`,
  );
  await client.query(`delete from public.events where id=$1`, [EVENT_ID]);
  await client.query(`delete from public.raw_items where id=$1`, [RAW_ITEM_ID]);
}

async function seedJob(client: any, jobId: string, status: string, metadata: Record<string, unknown>) {
  await client.query(
    `insert into public.ai_runs (
       id,event_id,raw_item_id,prompt_key,prompt_version,model,status,started_at,finished_at,usage,error_message,metadata
     ) values ($1,$2,$3,'offering_monitor_normalization_job','sidecar-only-v1','not_used',$4,
       now(),case when $4='pending' then null else now() end,'{}'::jsonb,null,$5::jsonb)`,
    [jobId, EVENT_ID, RAW_ITEM_ID, status, JSON.stringify(metadata)],
  );
}

async function resetJob(client: any, jobId: string) {
  await client.query(
    `update public.ai_runs
     set status='pending',finished_at=null,error_message=null,
       metadata=jsonb_build_object('phase','sidecar_only_pending','registry_alert_status','pending')
     where id=$1`,
    [jobId],
  );
}

async function readJob(client: any, jobId: string) {
  const result = await client.query(
    `select status,metadata from public.ai_runs where id=$1`,
    [jobId],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function assertOwnedMetadata(
  client: any,
  jobId: string,
  registryStatus: string,
  phase: string,
  topLevelStatus: string,
) {
  const row = await readJob(client, jobId);
  assert.equal(row.status, topLevelStatus);
  assert.equal(row.metadata.registry_alert_status, registryStatus);
  assert.equal(row.metadata.phase, phase);
  assert.equal(row.metadata.sidecar_status, "completed");
}

function jobIdentity(jobId: string) {
  return {
    schemaVersion: "offering_monitor_job_v2",
    purpose: "offering_monitor_normalization",
    logicalJobId: jobId,
    executionId: jobId,
    jobId,
    eventId: EVENT_ID,
    rawItemId: RAW_ITEM_ID,
    parentPrimaryAiRunId: "98400000-0000-4000-8000-000000000041",
    parentPromptKey: "sec_s3_offering_analysis",
    parentPromptVersion: "test-v1",
    sourceIdentity: ACCESSION,
    formType: "S-3",
    family: "s3",
    executionContractVersion: "sidecar-only-v1",
    executionAttemptKey: "automatic",
    enqueuedAt: "2026-09-10T00:00:00.000Z",
  } as const;
}

function assertRuntimeBoundaries() {
  const sources = [
    "lib/monitor/offeringMonitorAutomaticTrigger.ts",
    "lib/monitor/registryBackedOfferingFacts.ts",
    "lib/monitor/offeringMonitorAlertConsumer.ts",
    "workflows/source-ingest.ts",
  ];
  return Promise.all(sources.map(async (file) => {
    const text = await import("node:fs/promises").then((fs) => fs.readFile(file, "utf8"));
    assert.doesNotMatch(text, /generateContent|sendEmail|telegram|processOfferingMonitorSecondStage|processOfferingMonitorProductionWiring/i);
  }));
}

function assertIsolatedTarget(input: {
  dbUrl: string;
  expectedPort: string;
  projectId: string;
  apiUrl: string;
}) {
  const parsedDb = new URL(input.dbUrl);
  const parsedApi = new URL(input.apiUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(parsedDb.hostname));
  assert.ok(["127.0.0.1", "localhost"].includes(parsedApi.hostname));
  assert.equal(parsedDb.port, input.expectedPort);
  assert.notEqual(parsedDb.port, "56322");
  assert.notEqual(parsedApi.port, "56321");
  assert.match(input.projectId, /^stock-radar-offering-retry-isolated-/);
}

function dataModule(source: string) {
  return `data:text/javascript,${encodeURIComponent(source)}`;
}
