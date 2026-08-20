import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const EXPECTED_MODEL = "gemini-2.5-flash-lite";
const EXPECTED_SYSTEM_HASH = "cacc85f70e3dbb1b6a6bff8ada7b4b37209231182da934f4843cbd688f715275";
const EXPECTED_SCHEMA_HASH = "380deb7b1935e946dd4e2f31c170a8d6c9e56fe1ce0b3692ae0af9f6cfa60262";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "29f5fe0d-8171-458c-bfb0-baacb6495e13";
const MONITOR_ID = "a2000000-0000-4000-8000-000000000031";
const COMPILE_URL = "http://localhost/api/monitors/listing/compile";
const CONFIRM_URL = "http://localhost/api/monitors/listing/confirm";
const PREFLIGHT_ONLY = process.argv.includes("--preflight-only");

loadSelectedEnv(process.env.CONDITION_COMPILER_ENV_FILE || "");
if ((process.env.NEWS_GEMINI_MODEL || EXPECTED_MODEL).trim() !== EXPECTED_MODEL) {
  throw new Error("Confirmation acceptance requires the configured gemini-2.5-flash-lite model");
}

const { handleListingConditionCompilerPost } = await import(
  "../app/api/monitors/listing/compile/handler.ts"
);
const { handleListingMonitorConfirmationPost } = await import(
  "../app/api/monitors/listing/confirm/handler.ts"
);
const { compileNaturalLanguageListingConditions } = await import(
  "../lib/monitor/naturalLanguageConditionCompiler.ts"
);
const { runStructuredGeminiJson } = await import("../lib/ai/geminiStructuredJson.ts");
const { consumeListingMonitorAlertsForEvent } = await import(
  "../lib/monitor/listingMonitorAlertConsumer.ts"
);
const { evaluateMonitorConditions } = await import("../lib/listingMonitorMatcher.ts");
const {
  buildNaturalLanguageConditionCompilerPrompt,
  NATURAL_LANGUAGE_CONDITION_COMPILER_PROMPT_VERSION,
} = await import("../lib/prompts/naturalLanguageConditionCompiler.ts");
const { MONITOR_CONDITION_REGISTRY_VERSION } = await import(
  "../lib/monitor/conditionRegistry.ts"
);

const prompt = buildNaturalLanguageConditionCompilerPrompt("__HASH_SENTINEL__");
const identity = Object.freeze({
  registryVersion: MONITOR_CONDITION_REGISTRY_VERSION,
  promptVersion: NATURAL_LANGUAGE_CONDITION_COMPILER_PROMPT_VERSION,
  systemSha256: sha256(prompt.system),
  responseSchemaSha256: sha256(JSON.stringify(prompt.responseFormat)),
});
assert.deepEqual(identity, {
  registryVersion: "monitor_conditions_v1",
  promptVersion: "v1-single-call-semantic-registry",
  systemSha256: EXPECTED_SYSTEM_HASH,
  responseSchemaSha256: EXPECTED_SCHEMA_HASH,
});

const PRICE = condition("market.price", "lt", 1);
const EVENT = condition("corporate_action.event_kind", "eq", "reverse_split");
const ANNOUNCED = condition("corporate_action.action_stage", "eq", "announced");
const EFFECTIVE = condition("corporate_action.action_stage", "eq", "effective");
const cases = [
  {
    id: "A",
    text: "Alert me when a stock below $1 announces a reverse split.",
    raw: [PRICE, EVENT, ANNOUNCED],
    active: [PRICE, EVENT],
    proposed: ANNOUNCED,
    proposedPreview: "Corporate action stage \u2014 Initial plan announced",
    choiceId: "omit",
    final: [PRICE, EVENT],
  },
  {
    id: "B",
    text: "Alert me when a reverse split becomes effective.",
    raw: [EVENT, EFFECTIVE],
    active: [EVENT],
    proposed: EFFECTIVE,
    proposedPreview: "Corporate action stage \u2014 Effective",
    choiceId: "use",
    final: [EVENT, EFFECTIVE],
  },
];

await assertApiPreflight();
const outcomes = [];
let compilerPhysicalAttempts = 0;
let selectionCompilerCalls = 0;
console.log(JSON.stringify({
  confirmationAcceptanceStart: {
    model: EXPECTED_MODEL,
    identity,
    sequence: cases.map((item) => item.id),
    preflightOnly: PREFLIGHT_ONLY,
    compilerCallsPerCase: 1,
    selectionCompilerCalls: 0,
    analyzerCalls: 0,
    marketProviderCalls: 0,
    databaseCalls: 0,
  },
}));

if (!PREFLIGHT_ONLY) {
  for (const acceptance of cases) {
    const outcome = await runCase(acceptance);
    outcomes.push(outcome);
    console.log(JSON.stringify({ confirmationCase: outcome }));
    if (!outcome.semanticPass) break;
  }
}

const passed = !PREFLIGHT_ONLY
  && outcomes.length === cases.length
  && outcomes.every((outcome) => outcome.semanticPass)
  && compilerPhysicalAttempts === cases.length
  && selectionCompilerCalls === 0;
console.log(JSON.stringify({
  confirmationAcceptanceComplete: {
    passed,
    firstBlocker: outcomes.find((outcome) => !outcome.semanticPass)?.id ?? null,
    executedCases: outcomes.length,
    compilerPhysicalAttempts,
    selectionCompilerCalls,
    retryAttempts: 0,
    fallbackAttempts: 0,
    analyzerCalls: 0,
    marketProviderCalls: 0,
    databaseReads: 0,
    databaseWrites: 0,
    outcomes,
  },
}, null, 2));
if (!PREFLIGHT_ONLY && !passed) process.exitCode = 1;

async function runCase(acceptance) {
  let compilerRun = null;
  let providerRun = null;
  let attempts = 0;
  let caughtError = null;
  const response = await handleListingConditionCompilerPost(apiRequest(COMPILE_URL, { text: acceptance.text }), {
    resolveUserId: async () => USER_ID,
    compile: async (input) => {
      try {
        compilerRun = await compileNaturalLanguageListingConditions(input, {
          runPrompt: async (request) => {
            attempts += 1;
            compilerPhysicalAttempts += 1;
            assert.equal(request.model, EXPECTED_MODEL);
            assert.equal(sha256(request.prompt.system), identity.systemSha256);
            assert.equal(sha256(JSON.stringify(request.prompt.responseFormat)), identity.responseSchemaSha256);
            providerRun = await runStructuredGeminiJson(request);
            return providerRun;
          },
        });
        return compilerRun;
      } catch (error) {
        caughtError = error;
        throw error;
      }
    },
  });
  const body = await response.json().catch(() => null);
  const draft = body?.ok === true ? body.data : null;
  const proposal = draft?.proposed?.[0];
  const partitionPass = response.status === 200
    && attempts === 1
    && compilerRun?.result.status === "VALID"
    && exactConditions(compilerRun.result.conditions, acceptance.raw)
    && draft?.draftStatus === "NEEDS_CONFIRMATION"
    && draft?.compilerStatus === "VALID"
    && exactConditions(draft.conditions, acceptance.active)
    && draft.unresolvedCount === 1
    && draft.proposed.length === 1
    && exactConditions([proposal?.condition], [acceptance.proposed])
    && proposal?.preview?.text === acceptance.proposedPreview
    && JSON.stringify(proposal?.choices?.map((choice) => choice.label))
      === JSON.stringify(["Use this filter", "Any stage"])
    && proposal?.state === "pending"
    && clearHumanText([
      ...humanPreview(draft),
      proposal?.preview?.text,
      ...proposal?.choices?.map((choice) => choice.label) ?? [],
    ]);

  let selectedDraft = null;
  let deterministic = null;
  let semanticPass = partitionPass;
  if (partitionPass) {
    const before = compilerPhysicalAttempts;
    const selectedResponse = await handleListingMonitorConfirmationPost(apiRequest(CONFIRM_URL, {
      draft,
      proposalId: proposal.id,
      choiceId: acceptance.choiceId,
    }), { resolveUserId: async () => USER_ID });
    const selectedBody = await selectedResponse.json().catch(() => null);
    selectionCompilerCalls += compilerPhysicalAttempts - before;
    selectedDraft = selectedBody?.ok === true ? selectedBody.data : null;
    const selectionPass = selectedResponse.status === 200
      && selectedDraft?.draftStatus === "READY_FOR_REVIEW"
      && selectedDraft?.unresolvedCount === 0
      && exactConditions(selectedDraft?.conditions, acceptance.final)
      && compilerPhysicalAttempts === before;
    deterministic = selectionPass
      ? acceptance.id === "A"
        ? await runAemdAlertAcceptance(selectedDraft.conditions)
        : runEffectiveMatcherAcceptance(selectedDraft.conditions)
      : null;
    semanticPass = selectionPass && deterministic?.ok === true;
  }

  return {
    id: acceptance.id,
    text: acceptance.text,
    semanticPass,
    httpStatus: response.status,
    rawCompilerConditions: compilerRun?.result.conditions ?? null,
    activeConditions: draft?.conditions ?? null,
    proposedCondition: proposal?.condition ?? null,
    proposedPreview: proposal?.preview?.text ?? null,
    choices: proposal?.choices?.map((choice) => choice.label) ?? [],
    draftStatus: draft?.draftStatus ?? null,
    finalConditions: selectedDraft?.conditions ?? null,
    finalPreview: humanPreview(selectedDraft),
    selectionCompilerCalls: selectedDraft ? 0 : null,
    deterministic,
    rawProviderOutput: providerRun?.parsed ?? null,
    model: compilerRun?.telemetry.model ?? EXPECTED_MODEL,
    physicalAttempts: attempts,
    latencyMs: compilerRun?.telemetry.latencyMs ?? null,
    error: body?.ok === false ? { code: body.error, message: body.message } : describeError(caughtError),
  };
}

async function runAemdAlertAcceptance(conditions) {
  const alerts = new Set();
  let priceReads = 0;
  const monitor = {
    id: MONITOR_ID,
    userId: USER_ID,
    domain: "listing",
    conditions,
    isActive: true,
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
  const dependencies = {
    readCorporateActionFacts: async () => corporateAction("scheduled"),
    readEventTicker: async () => "AEMD",
    readCurrentPrice: async (symbol) => {
      priceReads += 1;
      return {
        asOf: "2026-08-14T11:59:00.000Z",
        availability: "available",
        dataMode: "realtime",
        price: 0.82,
        symbol,
      };
    },
    listActiveMonitors: async () => ({ monitors: [monitor], diagnostics: [] }),
    createAlert: async (input) => {
      const key = `${input.monitorId}:${input.eventId}`;
      if (alerts.has(key)) return { status: "existing", monitorId: input.monitorId };
      alerts.add(key);
      return { status: "created", monitorId: input.monitorId, alertId: input.monitorId };
    },
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  };
  const first = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  const replay = await consumeListingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  return {
    ok: first.evaluations[0]?.status === "match"
      && first.createdCount === 1
      && replay.existingCount === 1
      && alerts.size === 1
      && priceReads === 2,
    firstStatus: first.evaluations[0]?.status ?? null,
    firstCreated: first.createdCount,
    replayExisting: replay.existingCount,
    alertCount: alerts.size,
    priceReads,
  };
}

function runEffectiveMatcherAcceptance(conditions) {
  const scheduled = evaluateMonitorConditions({
    listing: { status: "not_ready", reason: "reader_not_requested" },
    corporateAction: corporateAction("scheduled"),
  }, conditions, { evaluationDate: "2026-08-14" });
  const effective = evaluateMonitorConditions({
    listing: { status: "not_ready", reason: "reader_not_requested" },
    corporateAction: corporateAction("effective"),
  }, conditions, { evaluationDate: "2026-08-14" });
  return {
    ok: scheduled.status === "no_match" && effective.status === "match",
    aemdScheduled: scheduled.status,
    effectiveFixture: effective.status,
  };
}

function corporateAction(actionStage) {
  return {
    status: "available",
    eventId: EVENT_ID,
    rawItemId: "a2000000-0000-4000-8000-000000000042",
    parentPrimaryAiRunId: "a2000000-0000-4000-8000-000000000043",
    sourceExecutionId: "a2000000-0000-4000-8000-000000000044",
    monitorAnalyzerKey: "corporate_action",
    analyzerContractVersion: "corporate_action_reverse_split_analyzer_v1",
    persistedAt: "2026-08-14T00:00:00.000Z",
    factSchemaVersion: "corporate_action_reverse_split_facts_v1",
    facts: {
      version: "corporate_action_reverse_split_facts_v1",
      event_kind: "reverse_split",
      action_stage: actionStage,
      effective_date: { availability: "unavailable" },
      ratio: { old_shares_per_new_share: { availability: "unavailable" } },
      source_ref: "acceptance_source",
      evidence: { availability: "available", value: "Acceptance reverse split fact." },
      confidence: "high",
      as_of: { availability: "available", value: "2026-08-14" },
      source: { source_family: "news", source_id: "acceptance", source_url: null },
    },
  };
}

async function assertApiPreflight() {
  const shouldNotCompile = async () => { throw new Error("compile must not run during preflight"); };
  const loggedOut = await handleListingConditionCompilerPost(apiRequest(COMPILE_URL, { text: cases[0].text }), {
    resolveUserId: async () => null,
    compile: shouldNotCompile,
  });
  assert.equal(loggedOut.status, 401);
  const crossOrigin = await handleListingConditionCompilerPost(
    apiRequest(COMPILE_URL, { text: cases[0].text }, "https://foreign.example"),
    { resolveUserId: async () => USER_ID, compile: shouldNotCompile },
  );
  assert.equal(crossOrigin.status, 403);
}

function exactConditions(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.map(fingerprint).sort().join("|") === expected.map(fingerprint).sort().join("|");
}

function condition(key, operator, value) {
  return { key, operator, value };
}

function fingerprint(value) {
  return JSON.stringify([value?.key, value?.operator, value?.value]);
}

function humanPreview(draft) {
  return draft?.mapped?.flatMap((requirement) => requirement.conditions.map((item) => item.text)) ?? [];
}

function clearHumanText(values) {
  return values.every((value) => typeof value === "string"
    && !/market\.price|corporate_action|reverse_split|action_stage|board_approved|shareholder_approved|\blt\b/.test(value));
}

function describeError(error) {
  return error ? { code: error.code || error.name || "ERROR", details: error.details || [] } : null;
}

function apiRequest(url, body, origin = "http://localhost") {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}

function loadSelectedEnv(path) {
  if (!path) return;
  const source = readFileSync(path, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(GEMINI_API_KEY|NEWS_GEMINI_MODEL)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = unquote(match[2]);
  }
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
