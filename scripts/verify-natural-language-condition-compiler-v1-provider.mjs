import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const EXPECTED_MODEL = "gemini-2.5-flash-lite";
const EXPECTED_SYSTEM_HASH = "bda99660c26b8cdc5782e3a941716176c2ad4957233c64ff1c74630deb529f46";
const EXPECTED_SCHEMA_HASH = "380deb7b1935e946dd4e2f31c170a8d6c9e56fe1ce0b3692ae0af9f6cfa60262";
const AUTHENTICATED_USER_ID = "10000000-0000-4000-8000-000000000001";
const API_URL = "http://localhost/api/monitors/listing/compile";
const PREFLIGHT_ONLY = process.argv.includes("--preflight-only");

loadSelectedEnv(process.env.CONDITION_COMPILER_ENV_FILE || "");
if ((process.env.NEWS_GEMINI_MODEL || EXPECTED_MODEL).trim() !== EXPECTED_MODEL) {
  throw new Error("Monitor Draft acceptance requires the configured gemini-2.5-flash-lite model");
}

const { handleListingConditionCompilerPost } = await import(
  "../app/api/monitors/listing/compile/handler.ts"
);
const {
  compileNaturalLanguageListingConditions,
  NaturalLanguageConditionCompilerError,
} = await import("../lib/monitor/naturalLanguageConditionCompiler.ts");
const { runStructuredGeminiJson } = await import("../lib/ai/geminiStructuredJson.ts");
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

const cases = [
  {
    id: "A",
    text: "Alert me when a Nasdaq company receives a listing deficiency and has a compliance deadline within 30 days.",
    expected: "ready draft with Nasdaq, deficiency, deadline, and every extra condition visible",
    assess: assessA,
  },
  {
    id: "C",
    text: "Alert me when a company regains listing compliance.",
    expected: "ready recovery draft with every canonical condition visible",
    assess: assessC,
  },
  {
    id: "D",
    text: "Alert me when a stock is below $3 and receives a listing deficiency.",
    expected: "attention draft with explicit unsupported price and mapped deficiency",
    assess: assessD,
  },
];

await assertApiPreflight();

const outcomes = [];
let compilerPhysicalAttempts = 0;
const secondLlmPhysicalAttempts = 0;
console.log(JSON.stringify({
  monitorDraftAcceptanceStart: {
    model: EXPECTED_MODEL,
    identity,
    preflightOnly: PREFLIGHT_ONLY,
    sequence: cases.map((item) => item.id),
    compilerCallsPerCase: 1,
    secondLlmCallsPerCase: 0,
    databaseCalls: 0,
    monitorCreates: 0,
  },
}));

if (!PREFLIGHT_ONLY) {
  for (const acceptance of cases) {
    const outcome = await runCase(acceptance);
    outcomes.push(outcome);
    console.log(JSON.stringify({ monitorDraftCase: outcome }));
    if (!outcome.semanticPass) break;
  }
}

const passed = !PREFLIGHT_ONLY
  && outcomes.length === cases.length
  && outcomes.every((outcome) => outcome.semanticPass);
const latencies = outcomes.map((outcome) => outcome.latencyMs).filter(Number.isFinite);
console.log(JSON.stringify({
  monitorDraftAcceptanceComplete: {
    passed,
    firstBlocker: outcomes.find((outcome) => !outcome.semanticPass)?.id ?? null,
    executedCases: outcomes.length,
    compilerPhysicalAttempts,
    secondLlmPhysicalAttempts,
    averageLatencyMs: latencies.length
      ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
      : null,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : null,
    registryViolations: outcomes.flatMap((outcome) => outcome.registryViolations),
    databaseCalls: 0,
    databaseReads: 0,
    databaseWrites: 0,
    monitorCreates: 0,
    outcomes,
  },
}, null, 2));

if (!PREFLIGHT_ONLY && !passed) process.exitCode = 1;

async function assertApiPreflight() {
  const shouldNotCompile = async () => {
    throw new Error("compile must not run during auth/input preflight");
  };
  const loggedOut = await handleListingConditionCompilerPost(apiRequest({ text: cases[0].text }), {
    resolveUserId: async () => null,
    compile: shouldNotCompile,
  });
  assert.equal(loggedOut.status, 401);

  const crossOrigin = await handleListingConditionCompilerPost(apiRequest(
    { text: cases[0].text },
    "https://foreign.example",
  ), {
    resolveUserId: async () => AUTHENTICATED_USER_ID,
    compile: shouldNotCompile,
  });
  assert.equal(crossOrigin.status, 403);

  const untrustedIdentity = await handleListingConditionCompilerPost(apiRequest({
    text: cases[0].text,
    userId: "client-owned",
  }), {
    resolveUserId: async () => AUTHENTICATED_USER_ID,
    compile: shouldNotCompile,
  });
  assert.equal(untrustedIdentity.status, 400);
}

async function runCase(acceptance) {
  let compilerRun = null;
  let providerRun = null;
  let attempts = 0;
  let caughtError = null;
  const response = await handleListingConditionCompilerPost(apiRequest({ text: acceptance.text }), {
    resolveUserId: async () => AUTHENTICATED_USER_ID,
    compile: async (input) => {
      try {
        compilerRun = await compileNaturalLanguageListingConditions(input, {
          runPrompt: async (request) => {
            assert.equal(request.model, EXPECTED_MODEL);
            assert.equal(sha256(request.prompt.system), identity.systemSha256);
            assert.equal(sha256(JSON.stringify(request.prompt.responseFormat)), identity.responseSchemaSha256);
            attempts += 1;
            compilerPhysicalAttempts += 1;
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
  const assessment = acceptance.assess(draft, compilerRun?.result ?? null);
  const forbiddenProviderKeys = findForbiddenProviderKeys(providerRun?.parsed);
  const semanticPass = response.status === 200
    && attempts === 1
    && secondLlmPhysicalAttempts === 0
    && assessment.ok
    && forbiddenProviderKeys.length === 0;
  return {
    id: acceptance.id,
    text: acceptance.text,
    expected: acceptance.expected,
    semanticPass,
    assessment,
    httpStatus: response.status,
    draftStatus: draft?.draftStatus ?? null,
    compilerStatus: draft?.compilerStatus ?? compilerRun?.result.status ?? null,
    canonicalConditions: draft?.conditions ?? compilerRun?.result.conditions ?? null,
    mappedPreview: draft?.mapped ?? null,
    unsupportedPreview: draft?.unsupported ?? null,
    ambiguousPreview: draft?.ambiguous ?? null,
    rawProviderOutput: providerRun?.parsed ?? null,
    forbiddenProviderKeys,
    model: compilerRun?.telemetry.model ?? EXPECTED_MODEL,
    physicalAttempts: attempts,
    latencyMs: compilerRun?.telemetry.latencyMs ?? null,
    registryViolations: compilerRun ? [] : compilerErrorDetails(caughtError),
    error: body?.ok === false ? { code: body.error, message: body.message } : describeError(caughtError),
  };
}

function assessA(draft) {
  const required = hasCondition(draft, "listing.exchange", "eq", "Nasdaq")
    && hasCondition(draft, "listing.event_kind", "eq", "deficiency_notice")
    && hasCondition(draft, "listing.compliance_deadline", "within_days", 30);
  const visible = hasPreview(draft, "Exchange — Nasdaq")
    && hasPreview(draft, "Listing event — Listing deficiency notice")
    && hasPreview(draft, "Compliance deadline — Within 30 days")
    && everyMappedConditionIsVisible(draft);
  const adverseVisible = !hasCondition(draft, "listing.event_outcome", "eq", "adverse")
    || hasPreview(draft, "Listing outcome — Unfavorable");
  return draft?.draftStatus === "READY_FOR_REVIEW"
    && draft.compilerStatus === "VALID"
    && required
    && visible
    && adverseVisible
    && draft.unsupported.length === 0
    && draft.ambiguous.length === 0
    ? pass()
    : fail("A canonical meaning or a visible mapped preview is missing");
}

function assessC(draft) {
  const recoveredVisible = !hasCondition(draft, "listing.event_outcome", "eq", "recovered")
    || hasPreview(draft, "Listing outcome — Recovered");
  return draft?.draftStatus === "READY_FOR_REVIEW"
    && draft.compilerStatus === "VALID"
    && hasCondition(draft, "listing.event_kind", "eq", "compliance_recovery")
    && hasPreview(draft, "Listing event — Compliance recovery")
    && recoveredVisible
    && everyMappedConditionIsVisible(draft)
    ? pass()
    : fail("recovery canonical meaning or its visible preview is missing");
}

function assessD(draft) {
  const price = draft?.unsupported.find((item) => item.sourceText.includes("below $3"));
  return draft?.draftStatus === "NEEDS_ATTENTION"
    && draft.compilerStatus === "UNSUPPORTED"
    && price?.status === "Unsupported"
    && typeof price.reason === "string"
    && hasCondition(draft, "listing.event_kind", "eq", "deficiency_notice")
    && hasPreview(draft, "Listing event — Listing deficiency notice")
    && everyMappedConditionIsVisible(draft)
    ? pass()
    : fail("price unsupported detail or mapped deficiency preview is missing");
}

function everyMappedConditionIsVisible(draft) {
  if (!draft) return false;
  const previewCount = draft.mapped.flatMap((item) => item.conditions).length;
  return previewCount >= draft.conditions.length
    && draft.mapped.flatMap((item) => item.conditions).every((item) => (
      typeof item.label === "string"
      && typeof item.value === "string"
      && item.text === `${item.label} — ${item.value}`
      && !/deficiency_notice|compliance_recovery|adverse|recovered|within_days|listing\./.test(item.text)
    ));
}

function hasCondition(draft, key, operator, value) {
  return Boolean(draft?.conditions.some((candidate) => (
    candidate.key === key
    && candidate.operator === operator
    && JSON.stringify(candidate.value) === JSON.stringify(value)
  )));
}

function hasPreview(draft, text) {
  return Boolean(draft?.mapped.some((requirement) => (
    requirement.conditions.some((candidate) => candidate.text === text)
  )));
}

function findForbiddenProviderKeys(value, path = "output") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findForbiddenProviderKeys(item, `${path}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, child]) => [
    ...(["id", "condition_refs", "self_check", "status"].includes(key) ? [`${path}.${key}`] : []),
    ...findForbiddenProviderKeys(child, `${path}.${key}`),
  ]);
}

function compilerErrorDetails(error) {
  return error instanceof NaturalLanguageConditionCompilerError ? [...error.details] : [];
}

function describeError(error) {
  if (!error) return null;
  if (error instanceof NaturalLanguageConditionCompilerError) {
    return { code: error.code, details: [...error.details] };
  }
  return { code: error?.name || "ERROR", details: [] };
}

function pass() {
  return { ok: true, reason: null };
}

function fail(reason) {
  return { ok: false, reason };
}

function apiRequest(body, origin = "http://localhost") {
  return new Request(API_URL, {
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
