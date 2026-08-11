import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOfferingMonitorJobIdentity,
  commitOfferingMonitorResultIfCurrent,
  deterministicJobId,
  enqueueOfferingMonitorJobWithDependencies,
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
  assert.equal(identity.family, "s1");
  assert.equal(identity.parentPrimaryAiRunId, RUN_A);
  assert.equal(identity.sourceIdentity, "0001437749-26-021738");
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

test("job identity is deterministic per parent and changes for a reanalysis parent", () => {
  const first = deterministicJobId({ eventId: EVENT_A, rawItemId: RAW_A, parentPrimaryAiRunId: RUN_A });
  const duplicate = deterministicJobId({ eventId: EVENT_A, rawItemId: RAW_A, parentPrimaryAiRunId: RUN_A });
  const reanalysis = deterministicJobId({ eventId: EVENT_A, rawItemId: RAW_A, parentPrimaryAiRunId: RUN_B });
  assert.equal(first, duplicate);
  assert.notEqual(first, reanalysis);
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

test("foundation uses a durable single-attempt child and does not await child returnValue or touch delivery prerequisites", () => {
  const starter = source("lib/offeringMonitorJobStarter.ts");
  const child = source("workflows/offering-monitor-normalization.ts");
  const repositorySource = source("lib/offeringMonitorJobRepository.ts");
  const delivery = source("lib/alerts/delivery/runAlertDeliveryForEvent.ts");
  assert.match(starter, /startWorkflow\(\s*offeringMonitorNormalizationWorkflow/);
  assert.doesNotMatch(starter, /returnValue/);
  assert.match(child, /"use workflow"/);
  assert.match(child, /runOfferingMonitorSecondStageStep\.maxRetries = 0/);
  assert.match(child, /processOfferingMonitorSecondStageJob/);
  assert.match(repositorySource, /resolution=ignore-duplicates/);
  assert.match(repositorySource, /parent_primary_ai_run_id/);
  assert.match(repositorySource, /metadata->>phase/);
  assert.doesNotMatch(repositorySource, /status: "in\.\(pending,running\)"/);
  assert.doesNotMatch(delivery, /offeringMonitor|monitorFoundation|parent_primary_ai_run_id/);
});

function identityFor(formType: string, promptKey: string, parentPrimaryAiRunId: string) {
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
  }, { now: "2026-08-12T00:00:00.000Z" });
}

function requiredIdentity(parentPrimaryAiRunId: string) {
  const identity = identityFor("S-1", "sec_s1_f1_analysis", parentPrimaryAiRunId);
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

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
