import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION,
  buildOfferingMonitorJobIdentity,
  commitOfferingMonitorResultIfCurrent,
  deterministicExecutionId,
  deterministicJobId,
  enqueueOfferingMonitorJobWithDependencies,
  finalizeOfferingMonitorSidecarOnlyJob,
  processOfferingMonitorFoundationJob,
  type OfferingMonitorJobIdentity,
  type OfferingMonitorParentAuthority,
} from "./offeringMonitorJobFoundation.ts";
import { SEC_S3_F3_FORMS } from "./sources/sec/forms/common/forms.ts";

const EVENT_A = "69606800-ee16-4a75-9bbf-3b64bdc56d69";
const RAW_A = "efea3384-9eef-4e6b-9e63-60dc1cd3090e";
const RUN_A = "5e56353f-e700-4c3f-89c1-0d7c6faf851a";
const RUN_B = "6e56353f-e700-4c3f-89c1-0d7c6faf851b";

test("S-1 Primary completion produces a parent-run-scoped Monitor identity", () => {
  const identity = identityFor("S-1", "sec_s1_f1_analysis", RUN_A);
  assert.ok(identity);
  assert.equal(identity.schemaVersion, "offering_monitor_job_v2");
  assert.equal(identity.family, "s1");
  assert.equal(identity.parentPrimaryAiRunId, RUN_A);
  assert.equal(identity.sourceIdentity, "0001437749-26-021738");
  assert.equal(identity.jobId, identity.executionId);
  assert.equal(identity.executionContractVersion, OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION);
  assert.equal(identity.executionAttemptKey, "automatic");
  assert.equal(identity.logicalJobId, "b6eaecad-5d37-57da-8dcd-5cd985e03977");
  assert.notEqual(identity.executionId, identity.logicalJobId);
  assert.match(identity.jobId, /^[0-9a-f-]{36}$/);
});

test("every canonical S-3/F-3 offering Primary form is eligible without joining its Primary path", () => {
  assert.deepEqual(SEC_S3_F3_FORMS, [
    "S-3",
    "S-3/A",
    "S-3ASR",
    "S-3MEF",
    "F-3",
    "F-3/A",
    "F-3ASR",
    "F-3MEF",
  ]);
  for (const formType of SEC_S3_F3_FORMS) {
    assert.equal(identityFor(formType, "sec_s3_offering_analysis", RUN_A)?.family, "s3", formType);
  }
});

test("424B offering Primary runs remain eligible", () => {
  assert.equal(identityFor("424B4", "sec_424b_analysis", RUN_A)?.family, "424b");
});

test("S-3/F-3 forms with mismatched prompt keys are ineligible", () => {
  for (const formType of SEC_S3_F3_FORMS) {
    assert.equal(identityFor(formType, "sec_s1_f1_analysis", RUN_A), null, formType);
    assert.equal(identityFor(formType, "sec_424b_analysis", RUN_A), null, formType);
  }
});

test("non-target forms, near-matches, F-1, wrong prompt, dry-run, and failed Primary are ineligible", () => {
  assert.equal(identityFor("F-1", "sec_s1_f1_analysis", RUN_A), null);
  assert.equal(identityFor("S-3D", "sec_s3_offering_analysis", RUN_A), null);
  assert.equal(identityFor("F-3D", "sec_s3_offering_analysis", RUN_A), null);
  assert.equal(identityFor("S-4", "sec_s3_offering_analysis", RUN_A), null);
  assert.equal(identityFor("8-K", "sec_8k_6k_capital_financing_analysis", RUN_A), null);
  assert.equal(identityFor("S-1", "sec_filing_analysis", RUN_A), null);
  assert.equal(buildOfferingMonitorJobIdentity({ ok: true, stage: "dry_run" }), null);
  assert.equal(buildOfferingMonitorJobIdentity({ ok: false, stage: "openai" }), null);
});

test("logical work identity remains the Phase 4W deterministic parent identity", () => {
  const first = deterministicJobId({ eventId: EVENT_A, rawItemId: RAW_A, parentPrimaryAiRunId: RUN_A });
  const duplicate = deterministicJobId({ eventId: EVENT_A, rawItemId: RAW_A, parentPrimaryAiRunId: RUN_A });
  const reanalysis = deterministicJobId({ eventId: EVENT_A, rawItemId: RAW_A, parentPrimaryAiRunId: RUN_B });
  assert.equal(first, duplicate);
  assert.equal(first, "b6eaecad-5d37-57da-8dcd-5cd985e03977");
  assert.notEqual(first, reanalysis);
});

test("execution identity separates contract and approved attempt while retaining exact parent lineage", () => {
  const automatic = requiredIdentity(RUN_A);
  const automaticDuplicate = requiredIdentity(RUN_A);
  const approvedAttempt = requiredIdentity(RUN_A, "validation:phase4y");
  const changedContract = deterministicExecutionId({
    logicalJobId: automatic.logicalJobId,
    executionContractVersion: "second_stage_om1_v3",
    executionAttemptKey: automatic.executionAttemptKey,
  });

  assert.equal(automatic.executionId, automaticDuplicate.executionId);
  assert.equal(automatic.logicalJobId, approvedAttempt.logicalJobId);
  assert.equal(automatic.parentPrimaryAiRunId, approvedAttempt.parentPrimaryAiRunId);
  assert.notEqual(automatic.executionId, approvedAttempt.executionId);
  assert.notEqual(automatic.executionId, changedContract);
  assert.equal(automatic.jobId, automatic.executionId);
  assert.equal(approvedAttempt.jobId, approvedAttempt.executionId);
});

test("failed execution A remains immutable while approved execution B gets an independent lifecycle", async () => {
  const executionB = requiredIdentity(RUN_A, "validation:phase4y");
  const phase4wExecutionId = executionB.logicalJobId;
  const history = new Map<string, { status: string; raw: string; parent: string }>([[
    phase4wExecutionId,
    { status: "failed", raw: "phase4w-raw-output", parent: RUN_A },
  ]]);
  const originalA = structuredClone(history.get(phase4wExecutionId));

  const result = await enqueueOfferingMonitorJobWithDependencies(executionB, {
    reserveJob: async (identity) => {
      if (history.has(identity.executionId)) return { reserved: false, jobId: identity.executionId };
      history.set(identity.executionId, { status: "pending", raw: "", parent: identity.parentPrimaryAiRunId });
      return { reserved: true, jobId: identity.executionId };
    },
    startWorkflow: async () => ({ runId: "workflow-execution-b" }),
    attachWorkflowRun: async (identity) => {
      const row = history.get(identity.executionId);
      if (row) row.status = "running";
    },
    markFailed: async () => undefined,
  });

  assert.equal(result.status, "enqueued");
  assert.equal(phase4wExecutionId, "b6eaecad-5d37-57da-8dcd-5cd985e03977");
  assert.notEqual(phase4wExecutionId, executionB.executionId);
  assert.deepEqual(history.get(phase4wExecutionId), originalA);
  assert.deepEqual(history.get(executionB.executionId), { status: "running", raw: "", parent: RUN_A });
});

test("invalid attempt labels do not create ambiguous execution identities", () => {
  assert.equal(identityFor("S-1", "sec_s1_f1_analysis", RUN_A, "contains spaces"), null);
  assert.throws(() => deterministicExecutionId({
    logicalJobId: "",
    executionContractVersion: OFFERING_MONITOR_EXECUTION_CONTRACT_VERSION,
    executionAttemptKey: "automatic",
  }), /identity is incomplete/);
});

test("durable enqueue reserves before starting and never waits for child completion", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  let childCompleted = false;
  const result = await enqueueOfferingMonitorJobWithDependencies(identity, {
    reserveJob: async () => {
      calls.push("reserve");
      return { reserved: true, jobId: identity.jobId };
    },
    startWorkflow: async () => {
      calls.push("start");
      return { runId: "run_child_1" };
    },
    attachWorkflowRun: async () => {
      calls.push("attach");
    },
    markFailed: async () => {
      calls.push("failed");
    },
  });
  assert.deepEqual(calls, ["reserve", "start", "attach"]);
  assert.equal(result.status, "enqueued");
  assert.equal(childCompleted, false);
});

test("duplicate reservation prevents a second workflow start", async () => {
  const identity = requiredIdentity(RUN_A);
  const duplicateIdentity = requiredIdentity(RUN_A);
  assert.equal(identity.executionId, duplicateIdentity.executionId);
  let starts = 0;
  const result = await enqueueOfferingMonitorJobWithDependencies(identity, {
    reserveJob: async () => ({ reserved: false, jobId: identity.jobId }),
    startWorkflow: async () => {
      starts += 1;
      return { runId: "unexpected" };
    },
    attachWorkflowRun: async () => undefined,
    markFailed: async () => undefined,
  });
  assert.equal(result.status, "duplicate");
  assert.equal(starts, 0);
});

test("enqueue failure is isolated and records only the Monitor job failure", async () => {
  const identity = requiredIdentity(RUN_A);
  const primary = Object.freeze({ event: "kept", analysis: "kept", scoreAlert: "queued" });
  const failed: string[] = [];
  const result = await enqueueOfferingMonitorJobWithDependencies(identity, {
    reserveJob: async () => ({ reserved: true, jobId: identity.jobId }),
    startWorkflow: async () => {
      throw new Error("queue unavailable");
    },
    attachWorkflowRun: async () => undefined,
    markFailed: async (jobId) => {
      failed.push(jobId);
    },
  });
  assert.equal(result.status, "enqueue_failed");
  assert.deepEqual(failed, [identity.jobId]);
  assert.deepEqual(primary, { event: "kept", analysis: "kept", scoreAlert: "queued" });
});

test("post-start linkage failure does not relabel a durable child as failed", async () => {
  const identity = requiredIdentity(RUN_A);
  let failed = false;
  const result = await enqueueOfferingMonitorJobWithDependencies(identity, {
    reserveJob: async () => ({ reserved: true, jobId: identity.jobId }),
    startWorkflow: async () => ({ runId: "run_child_2" }),
    attachWorkflowRun: async () => {
      throw new Error("link unavailable");
    },
    markFailed: async () => {
      failed = true;
    },
  });
  assert.equal(result.status, "enqueued");
  assert.equal(failed, false);
  assert.match(result.status === "enqueued" ? result.linkageWarning || "" : "", /link unavailable/);
});

test("current parent is eligible and completes only the Monitor foundation row", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const result = await processOfferingMonitorFoundationJob(identity, repository({
    authority: { status: "current", latestPrimaryAiRunId: RUN_A },
    calls,
  }));
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["authority", "claim", "complete"]);
});

test("sidecar-only completion terminates the execution without any provider or legacy wiring dependency", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const result = await finalizeOfferingMonitorSidecarOnlyJob(identity, {
    status: "completed",
    sharesOutstanding: "1234567",
    asOf: "2026-08-11",
    inserted: 1,
    deduped: 0,
    providerCalled: false,
  }, sidecarTerminalRepository({
    authority: { status: "current", latestPrimaryAiRunId: RUN_A },
    calls,
  }));
  assert.deepEqual(calls, ["authority", "complete:completed"]);
  assert.deepEqual(result, {
    status: "completed",
    jobId: identity.jobId,
    parentPrimaryAiRunId: RUN_A,
    latestPrimaryAiRunId: RUN_A,
    sidecarStatus: "completed",
    providerCalled: false,
  });
});

test("sidecar ineligibility is a clear completed terminal result and fabricates no value", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const sidecar = {
    status: "ineligible" as const,
    reason: "CURRENT_OS_NOT_EXPLICIT",
    providerCalled: false as const,
  };
  const result = await finalizeOfferingMonitorSidecarOnlyJob(identity, sidecar, sidecarTerminalRepository({
    authority: { status: "current", latestPrimaryAiRunId: RUN_A },
    calls,
  }));
  assert.equal(result.status, "completed");
  assert.equal(result.sidecarStatus, "ineligible");
  assert.equal("sharesOutstanding" in sidecar, false);
  assert.deepEqual(calls, ["authority", "complete:ineligible"]);
});

test("sidecar failure stays explicit and terminates the execution as failed", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const result = await finalizeOfferingMonitorSidecarOnlyJob(identity, {
    status: "failed",
    error: "exact raw item unavailable",
    providerCalled: false,
  }, sidecarTerminalRepository({
    authority: { status: "current", latestPrimaryAiRunId: RUN_A },
    calls,
  }));
  assert.equal(result.status, "failed");
  assert.equal(result.providerCalled, false);
  assert.equal(result.latestPrimaryAiRunId, null);
  assert.deepEqual(calls, ["fail:exact raw item unavailable"]);
});

test("stale authority wins after sidecar processing and terminates the execution as stale", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const result = await finalizeOfferingMonitorSidecarOnlyJob(identity, {
    status: "completed",
    sharesOutstanding: "1234567",
    asOf: "2026-08-11",
    inserted: 1,
    deduped: 0,
    providerCalled: false,
  }, sidecarTerminalRepository({
    authority: { status: "stale", latestPrimaryAiRunId: RUN_B },
    calls,
  }));
  assert.equal(result.status, "stale");
  assert.equal(result.latestPrimaryAiRunId, RUN_B);
  assert.deepEqual(calls, ["authority", "stale:completed"]);
});

test("Primary B makes queued Monitor A stale before processing", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const result = await processOfferingMonitorFoundationJob(identity, repository({
    authority: { status: "stale", latestPrimaryAiRunId: RUN_B },
    calls,
  }));
  assert.equal(result.status, "stale");
  assert.equal(result.latestPrimaryAiRunId, RUN_B);
  assert.deepEqual(calls, ["authority", "stale"]);
});

test("a missing Primary parent is fail-closed stale and never claimed", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const result = await processOfferingMonitorFoundationJob(identity, repository({
    authority: { status: "missing", latestPrimaryAiRunId: null },
    calls,
  }));
  assert.equal(result.status, "stale");
  assert.deepEqual(calls, ["authority", "stale"]);
});

test("an already claimed job does not process twice", async () => {
  const identity = requiredIdentity(RUN_A);
  const calls: string[] = [];
  const result = await processOfferingMonitorFoundationJob(identity, repository({
    authority: { status: "current", latestPrimaryAiRunId: RUN_A },
    calls,
    claimed: false,
  }));
  assert.equal(result.status, "duplicate");
  assert.deepEqual(calls, ["authority", "claim"]);
});

test("atomic future writer revokes A save authority after Primary B without affecting another event", async () => {
  const identityA = requiredIdentity(RUN_A);
  const identityB = requiredIdentity(RUN_B);
  const other = { ...requiredIdentity(RUN_A), eventId: "79606800-ee16-4a75-9bbf-3b64bdc56d70" };
  const latest = new Map([[identityA.eventId, RUN_A], [other.eventId, RUN_A]]);
  const saved = new Map<string, unknown>();
  const writer = {
    commitIfParentIsLatest: async ({ identity, value }: { identity: OfferingMonitorJobIdentity; value: unknown }) => {
      if (latest.get(identity.eventId) !== identity.parentPrimaryAiRunId) return { status: "stale" as const };
      saved.set(identity.eventId, value);
      return { status: "saved" as const };
    },
  };

  latest.set(identityA.eventId, RUN_B);
  assert.notEqual(identityA.logicalJobId, identityB.logicalJobId);
  assert.equal(identityA.parentPrimaryAiRunId, RUN_A);
  assert.equal(identityB.parentPrimaryAiRunId, RUN_B);
  assert.deepEqual(
    await commitOfferingMonitorResultIfCurrent(writer, { identity: identityA, value: "A" }),
    { status: "stale" },
  );
  assert.deepEqual(
    await commitOfferingMonitorResultIfCurrent(writer, { identity: identityB, value: "B" }),
    { status: "saved" },
  );
  assert.deepEqual(
    await commitOfferingMonitorResultIfCurrent(writer, { identity: other, value: "other" }),
    { status: "saved" },
  );
  assert.equal(saved.get(identityA.eventId), "B");
  assert.equal(saved.get(other.eventId), "other");
});

test("source ordering keeps persistence and score alert ahead of both async hooks", () => {
  const ingest = source("lib/secFilingAnalysisIngest.ts");
  assert.ok(ingest.indexOf("saveAnalyzedSecFilingEvent") < ingest.indexOf("saveSecFilingAiTrace", ingest.indexOf("const aiTrace")));
  assert.ok(ingest.indexOf("const aiTrace") < ingest.indexOf("runSecFilingAlertDelivery"));
  assert.ok(ingest.indexOf("runSecFilingAlertDelivery") < ingest.indexOf("primaryAiRunId: aiTrace.aiRunId"));

  const workflow = source("workflows/source-ingest.ts");
  assert.ok(workflow.indexOf("await runSecRawAnalysisStep") < workflow.indexOf("await enqueueOfferingMonitorJobStep"));
  const route = source("app/api/sources/sec/analyze/route.ts");
  assert.ok(route.indexOf("await runSecFilingAnalysisIngest") < route.indexOf("await enqueueOfferingMonitorAfterPrimary"));
});

test("foundation keeps the durable child but product runtime is sidecar-only with no Stage 2 or legacy canonical Matcher wiring", () => {
  const starter = source("lib/offeringMonitorJobStarter.ts");
  const child = source("workflows/offering-monitor-normalization.ts");
  const repositorySource = source("lib/offeringMonitorJobRepository.ts");
  const delivery = source("lib/alerts/delivery/runAlertDeliveryForEvent.ts");
  assert.match(starter, /startWorkflow\(\s*offeringMonitorNormalizationWorkflow/);
  assert.doesNotMatch(starter, /returnValue/);
  assert.match(child, /"use workflow"/);
  assert.match(child, /processOfferingShareCountSidecar/);
  assert.match(child, /finalizeOfferingMonitorSidecarOnlyJob/);
  assert.doesNotMatch(child, /processOfferingMonitorSecondStageJob/);
  assert.doesNotMatch(child, /offeringMonitorSecondStageRuntimeDependencies/);
  assert.doesNotMatch(child, /processOfferingMonitorProductionWiring/);
  assert.doesNotMatch(child, /promoteOfferingMonitorCanonical/);
  assert.doesNotMatch(child, /readOfferingMonitorCanonical/);
  assert.doesNotMatch(child, /evaluateOfferingMonitorEvent/);
  assert.match(repositorySource, /resolution=ignore-duplicates/);
  assert.match(repositorySource, /parent_primary_ai_run_id/);
  assert.match(repositorySource, /logical_job_id/);
  assert.match(repositorySource, /execution_id/);
  assert.match(repositorySource, /execution_contract_version/);
  assert.match(repositorySource, /execution_attempt_key/);
  assert.match(repositorySource, /prompt_version: identity\.executionContractVersion/);
  assert.match(repositorySource, /workflow_run_id: workflowRunId/);
  assert.match(repositorySource, /metadata->>phase/);
  assert.match(repositorySource, /stage_2_provider_enabled: false/);
  assert.match(repositorySource, /provider_attempts: 0/);
  assert.match(repositorySource, /legacy_canonical_wiring_enabled: false/);
  assert.match(repositorySource, /legacy_empty_condition_matcher_enabled: false/);
  assert.match(repositorySource, /status: "in\.\(pending,running\)"/);
  assert.doesNotMatch(child, /getStepMetadata|stepId/);
  assert.doesNotMatch(delivery, /offeringMonitor|monitorFoundation|parent_primary_ai_run_id/);
});

function identityFor(
  formType: string,
  promptKey: string,
  parentPrimaryAiRunId: string,
  executionAttemptKey?: string,
) {
  return buildOfferingMonitorJobIdentity({
    ok: true,
    stage: "complete",
    event: { id: EVENT_A },
    sourceItem: {
      id: RAW_A,
      source_unique_id: "0001437749-26-021738",
      form_type: formType,
    },
    input: {
      filing_package: {
        accession_number: "0001437749-26-021738",
        form_type: formType,
      },
    },
    prompt: { key: promptKey, version: "test-v1" },
    primaryAiRunId: parentPrimaryAiRunId,
  }, { now: "2026-08-12T00:00:00.000Z", executionAttemptKey });
}

function requiredIdentity(parentPrimaryAiRunId: string, executionAttemptKey?: string) {
  const identity = identityFor("S-1", "sec_s1_f1_analysis", parentPrimaryAiRunId, executionAttemptKey);
  assert.ok(identity);
  return identity;
}

function repository(options: {
  authority: OfferingMonitorParentAuthority;
  calls: string[];
  claimed?: boolean;
}) {
  return {
    readParentAuthority: async () => {
      options.calls.push("authority");
      return options.authority;
    },
    claimJob: async () => {
      options.calls.push("claim");
      return options.claimed ?? true;
    },
    completeJob: async () => {
      options.calls.push("complete");
    },
    markStale: async () => {
      options.calls.push("stale");
    },
  };
}

function sidecarTerminalRepository(options: {
  authority: OfferingMonitorParentAuthority;
  calls: string[];
}) {
  return {
    readParentAuthority: async () => {
      options.calls.push("authority");
      return options.authority;
    },
    completeAfterSidecar: async (_identity: OfferingMonitorJobIdentity, sidecar: { status: string }) => {
      options.calls.push(`complete:${sidecar.status}`);
    },
    failAfterSidecar: async (_identity: OfferingMonitorJobIdentity, sidecar: { error?: string }) => {
      options.calls.push(`fail:${sidecar.error || ""}`);
    },
    markStaleAfterSidecar: async (_identity: OfferingMonitorJobIdentity, sidecar: { status: string }) => {
      options.calls.push(`stale:${sidecar.status}`);
    },
  };
}

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
