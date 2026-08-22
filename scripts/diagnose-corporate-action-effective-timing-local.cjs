const { createHash } = require("node:crypto");
const path = require("node:path");

require("tsconfig-paths/register");

const { loadEnvConfig } = require("@next/env");
const { createJiti } = require("jiti");
const { Client } = require("pg");

const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));

loadEnvConfig(path.resolve(args.envDir), true, { info() {}, error() {} });
assertLocalSupabase(process.env.SUPABASE_URL || "");
if (!process.env.GEMINI_API_KEY) fail("Gemini provider configuration is unavailable");

const client = new Client({
  host: "127.0.0.1",
  port: readLocalDatabasePort(),
  user: "postgres",
  password: "postgres",
  database: "postgres",
});
const jiti = createJiti(__filename, { interopDefault: true });
const { buildGenericMonitorChildIdentities } = jiti("../lib/monitor/genericMonitorChildExecution.ts");
const { buildCorporateActionAnalyzerInput } = jiti("../lib/monitor/genericMonitorChildRuntime.ts");
const { validateCorporateActionApplicabilityContextResponse } = jiti("../lib/monitor/corporateActionApplicabilityContext.ts");
const { runCorporateActionCanonicalAnalyzerPreview } = jiti("../lib/ai/corporateActionCanonicalAnalyzerPreview.ts");
const { buildCorporateActionCanonicalAnalysisPrompt } = jiti("../lib/prompts/corporateActionCanonicalAnalysis.ts");
const { parseJsonWithoutDuplicateKeys } = jiti("../lib/minimalOfferingMonitor.ts");
const { genericMonitorChildRepository } = jiti("../lib/monitor/genericMonitorChildSupabaseRepository.ts");
const { processGenericMonitorChild } = jiti("../lib/monitor/genericMonitorChildRuntime.ts");
const { readCurrentCorporateActionFacts } = jiti("../lib/monitor/corporateActionPersistence.ts");
const { readReverseSplitExecutions } = jiti("../lib/monitor/reverseSplitExecution.ts");
const { PostgresShareCountHistoryRepository } = jiti("../lib/sec-structured-data/shareCountHistory.ts");
const { normalizeClassShareCountForStockSplitsAt } = jiti("../lib/sec-structured-data/stockSplitShareBasisNormalizer.ts");

void main();

async function main() {
  await client.connect();
  try {
    const source = await readSourceLineage();
    const identity = buildIdentity(source);
    const applicabilityContext = await readApplicabilityContext(source);
    const input = buildCorporateActionAnalyzerInput(
      identity,
      source.raw_item,
      source.primary_analysis,
      applicabilityContext,
    );
    const prompt = buildCorporateActionCanonicalAnalysisPrompt(input);
    if (args.persist) {
      await runPersistenceAcceptance({ source, identity, applicabilityContext, prompt });
      return;
    }
    let providerCalls = 0;
    const result = await runCorporateActionCanonicalAnalyzerPreview(input, {
      runPrompt: async (request) => {
        providerCalls += 1;
        const { runStructuredGeminiJson } = jiti("../lib/ai/geminiStructuredJson.ts");
        return runStructuredGeminiJson(request);
      },
    });
    const rawPayload = parseBoundedProviderPayload(result.run?.outputText || "");
    const timing = record(rawPayload?.effective_timing);
    const sourceTimingEvidence = findTimingEvidence(input.source_documents);
    process.stdout.write(`${JSON.stringify({
      ok: result.stage === "complete",
      accession: args.accession,
      raw_item_id: source.raw_item_id,
      event_id: source.event_id,
      parent_primary_ai_run_id: source.parent_primary_ai_run_id,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        sha256: createHash("sha256").update(`${prompt.system}\n${prompt.user}`).digest("hex"),
      },
      source_timing_evidence: sourceTimingEvidence,
      provider_calls: providerCalls,
      provider: {
        stage: result.stage,
        model: boundedString(result.run?.model, 120),
        response_id: boundedString(result.run?.responseId, 160),
        timing_kind: boundedString(timing?.kind, 80),
        raw_timestamp: boundedField(timing?.timestamp),
        timing_source_ref: boundedString(timing?.source_ref, 160),
        timing_evidence: boundedString(timing?.evidence, 400),
        effective_date: boundedField(record(rawPayload?.effective_date)?.value),
        validation_reason: boundedString(
          result.validation_errors?.find((error) => error.includes("effective_timing"))
            || ("error" in result ? result.error : null),
          500,
        ),
      },
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

async function runPersistenceAcceptance({ source, identity, applicabilityContext, prompt }) {
  await genericMonitorChildRepository.reserve(identity);
  let providerResult = null;
  let analyzerCalls = 0;
  const execution = await processGenericMonitorChild(identity, {
    loadCorporateActionApplicabilityContext: async () => applicabilityContext,
    runCorporateActionAnalyzer: async (input) => {
      analyzerCalls += 1;
      providerResult = await runCorporateActionCanonicalAnalyzerPreview(input);
      return providerResult;
    },
  });
  const persistedNow = execution.status === "succeeded_applicable"
    && execution.persistence === "saved" && execution.providerCalls === 1 && analyzerCalls === 1;
  const alreadyPersisted = execution.status === "duplicate"
    && execution.providerCalls === 0 && analyzerCalls === 0;
  if (!persistedNow && !alreadyPersisted) {
    fail(`COSM child failed acceptance: ${JSON.stringify({
      execution,
      analyzer_calls: analyzerCalls,
      provider_stage: providerResult?.stage || null,
      provider_error: boundedString(providerResult?.error, 500),
      timing_diagnostic: providerResult?.timing_diagnostic || null,
    })}`);
  }
  const beforeReplay = await readPersistenceCounts(source);
  const replay = await processGenericMonitorChild(identity, {
    loadCorporateActionApplicabilityContext: async () => applicabilityContext,
  });
  const afterReplay = await readPersistenceCounts(source);
  const current = await readCurrentCorporateActionFacts(source.event_id);
  if (current.status !== "available") fail(`COSM current facts returned ${current.status}`);
  const facts = current.facts;
  const exactRatio = facts.ratio.exact_source_components;
  const issuer = facts.applicability?.issuer;
  const affected = facts.applicability?.affected_security;
  if (issuer?.availability !== "available" || affected?.availability !== "available") {
    fail("COSM canonical issuer/security applicability is unavailable");
  }
  const executionRead = await readReverseSplitExecutions({
    cik: issuer.issuer_cik,
    canonicalSecurityClassId: affected.canonical_security_class_id,
    from: "2022-12-16",
    to: "2022-12-16",
    targetAt: new Date(Date.parse(issuer.accepted_at) + 1_000).toISOString(),
    knownAt: new Date(Date.parse(afterReplay.persisted_at) + 1_000).toISOString(),
  });
  const active = executionRead.executions[0];
  const accepted = facts.event_kind === "reverse_split"
    && exactRatio?.availability === "available"
    && exactRatio.old_share_units === "25"
    && exactRatio.new_share_units === "1"
    && facts.effective_date.availability === "available"
    && facts.effective_date.value === "2022-12-16"
    && facts.effective_timing?.availability === "available"
    && facts.effective_timing.kind !== "exact_timestamp"
    && facts.effective_timing.timestamp === null
    && beforeReplay.fact_count === 1
    && beforeReplay.result_count === 1
    && afterReplay.fact_count === 1
    && afterReplay.result_count === 1
    && replay.status === "duplicate"
    && replay.providerCalls === 0
    && executionRead.status === "available"
    && executionRead.executions.length === 1
    && executionRead.inactiveExecutions.length === 0
    && executionRead.conflicts.length === 0;
  if (!accepted) {
    fail(`COSM canonical/execution/replay acceptance did not match the contract: ${JSON.stringify({
      event_kind: facts.event_kind,
      exact_ratio: exactRatio,
      effective_date: facts.effective_date,
      effective_timing: facts.effective_timing,
      before_replay: beforeReplay,
      after_replay: afterReplay,
      replay,
      execution_status: executionRead.status,
      active_count: executionRead.executions.length,
      inactive_count: executionRead.inactiveExecutions.length,
      conflict_count: executionRead.conflicts.length,
    })}`);
  }
  const osObservationCount = await readCosmOsObservationCount(issuer.issuer_cik);
  const normalization = osObservationCount > 0
    ? await normalizeClassShareCountForStockSplitsAt({
        repository: new PostgresShareCountHistoryRepository(client),
        cik: issuer.issuer_cik,
        securityClassId: affected.canonical_security_class_id,
        targetAt: "2023-04-11T23:59:59Z",
        executionKnownAt: new Date(Date.parse(afterReplay.persisted_at) + 1_000).toISOString(),
      })
    : null;
  if (normalization && (normalization.status !== "NORMALIZED"
    || normalization.appliedExecutions.length !== 1
    || normalization.appliedExecutions[0]?.kind !== "reverse_split"
    || normalization.appliedExecutions[0]?.executionId !== active.executionId
    || normalization.appliedExecutions[0]?.exactRatio.oldShareUnits !== "25"
    || normalization.appliedExecutions[0]?.exactRatio.newShareUnits !== "1")) {
    fail(`COSM Stock Split Normalizer acceptance failed: ${JSON.stringify({
      status: normalization.status,
      reason: normalization.reason,
      applied_execution_ids: normalization.appliedExecutionIds,
      normalized_exact_shares: normalization.normalizedExactShares,
    })}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    accession: args.accession,
    raw_item_id: source.raw_item_id,
    event_id: source.event_id,
    child_execution_id: identity.executionId,
    prompt: {
      key: prompt.key,
      version: prompt.version,
      sha256: createHash("sha256").update(`${prompt.system}\n${prompt.user}`).digest("hex"),
    },
    provider: {
      calls_this_run: execution.providerCalls,
      analyzer_calls: analyzerCalls,
      persisted_now: persistedNow,
      stage: providerResult?.stage || "existing_completed_child",
      model: boundedString(providerResult?.run?.model, 120),
      response_id: boundedString(providerResult?.run?.responseId, 160),
    },
    canonical: {
      event_kind: facts.event_kind,
      action_stage: facts.action_stage,
      ratio: exactRatio,
      effective_date: facts.effective_date,
      effective_timing: facts.effective_timing,
      issuer_cik: issuer.issuer_cik,
      canonical_security_class_id: affected.canonical_security_class_id,
      fact_count: afterReplay.fact_count,
      result_count: afterReplay.result_count,
    },
    reverse_execution: {
      active_count: executionRead.executions.length,
      inactive_count: executionRead.inactiveExecutions.length,
      conflict_count: executionRead.conflicts.length,
      execution_id: active.executionId,
      execution_status: active.executionStatus,
      effective_date: active.effectiveDate,
      effective_timing: active.effectiveTiming,
      exact_ratio: active.exactRatio,
      observation_count: active.observations.length,
    },
    replay: {
      status: replay.status,
      provider_calls: replay.providerCalls,
      canonical_duplicates_added: afterReplay.fact_count - beforeReplay.fact_count,
      result_duplicates_added: afterReplay.result_count - beforeReplay.result_count,
      execution_duplicates_added: executionRead.executions.length - 1,
    },
    stock_split_normalizer: normalization
      ? {
          status: normalization.status,
          reason: normalization.reason,
          observation_count: osObservationCount,
          original_as_of: normalization.originalAsOf,
          original_shares: normalization.originalShares,
          normalized_exact_shares: normalization.normalizedExactShares,
          normalized_integer_shares: normalization.normalizedIntegerShares,
          applied_execution_count: normalization.appliedExecutions.length,
          applied_execution_ids: normalization.appliedExecutionIds,
        }
      : { status: "not_run", reason: "no_existing_COSM_OS_observations", observation_count: 0 },
  }, null, 2)}\n`);
}

async function readPersistenceCounts(source) {
  const result = await client.query(
    `select
       (select count(*)::integer from public.event_corporate_action_facts
         where event_id = $1 and parent_primary_ai_run_id = $2) as fact_count,
       (select count(*)::integer from public.event_corporate_action_results
         where event_id = $1 and parent_primary_ai_run_id = $2) as result_count,
       (select max(persisted_at)::text from public.event_corporate_action_facts
         where event_id = $1 and parent_primary_ai_run_id = $2) as persisted_at`,
    [source.event_id, source.parent_primary_ai_run_id],
  );
  return result.rows[0];
}

async function readCosmOsObservationCount(cik) {
  const result = await client.query(
    "select count(*)::integer as count from public.share_count_history where issuer_cik = $1",
    [cik],
  );
  return result.rows[0]?.count || 0;
}

async function readSourceLineage() {
  const result = await client.query(
    `select e.id as event_id,
            r.id as raw_item_id,
            r.source_code,
            r.source_group,
            r.source_unique_id,
            to_jsonb(r.*) as raw_item,
            a.id as parent_primary_ai_run_id,
            a.prompt_key as parent_prompt_key,
            a.prompt_version as parent_prompt_version,
            o.payload->'analysis' as primary_analysis
       from public.raw_items r
       join public.events e on e.raw_item_id = r.id
       join public.ai_runs a on a.event_id = e.id and a.raw_item_id = r.id
       join public.ai_outputs o on o.ai_run_id = a.id
      where r.source_code = 'sec_edgar'
        and r.source_unique_id = $1
        and a.status = 'completed'
        and o.payload->'analysis'->'monitor_routes'
              @> '[{"monitor_analyzer_key":"corporate_action"}]'::jsonb
      order by a.started_at desc, a.id desc
      limit 1`,
    [args.accession],
  );
  if (result.rows.length !== 1) fail(`Expected one routed Primary lineage for ${args.accession}`);
  return result.rows[0];
}

async function readApplicabilityContext(source) {
  const result = await client.query(
    "select public.read_corporate_action_applicability_context($1::uuid, $2::uuid) as payload",
    [source.event_id, source.raw_item_id],
  );
  if (result.rows.length !== 1) fail("Corporate Action applicability context is unavailable");
  return validateCorporateActionApplicabilityContextResponse(result.rows[0].payload);
}

function buildIdentity(source) {
  const [identity] = buildGenericMonitorChildIdentities({
    primary: {
      eventId: source.event_id,
      rawItemId: source.raw_item_id,
      sourceFamily: "sec_8k_6k",
      sourceGroup: source.source_group,
      sourceCode: source.source_code,
      sourceIdentity: source.source_unique_id,
      parentPrimaryAiRunId: source.parent_primary_ai_run_id,
      parentPromptKey: source.parent_prompt_key,
      parentPromptVersion: source.parent_prompt_version,
    },
    monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "corporate_action" }] },
  });
  return identity;
}

function findTimingEvidence(documents) {
  const pattern = /[^.]{0,120}\b(?:opening of the business day|market open|start of trading|after (?:the )?market close)\b[^.]{0,180}\./i;
  for (const document of documents) {
    const match = document.text.match(pattern);
    if (match) return { source_ref: document.source_ref, text: boundedString(match[0].trim(), 320) };
  }
  return null;
}

function parseBoundedProviderPayload(outputText) {
  if (!outputText || outputText.length > 200_000) return null;
  try {
    const parsed = parseJsonWithoutDuplicateKeys(outputText);
    return record(parsed);
  } catch {
    return null;
  }
}

function boundedField(value) {
  if (value === null) return { value: null, truncated: false };
  if (typeof value === "string") {
    return { value: value.slice(0, 160), truncated: value.length > 160 };
  }
  return { value: `[${typeof value}]`, truncated: false };
}

function boundedString(value, max) {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseArgs(values) {
  const parsed = { envDir: "", accession: "", persist: false };
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1] || "";
    if (key === "--env-dir") parsed.envDir = value;
    else if (key === "--accession") parsed.accession = value;
    else if (key === "--persist") parsed.persist = value === "true";
    else fail(`Unknown or incomplete argument: ${key || "<missing>"}`);
  }
  if (!parsed.envDir || !/^\d{10}-\d{2}-\d{6}$/.test(parsed.accession)) {
    fail("Usage: --env-dir <dir> --accession <SEC accession> [--persist true]");
  }
  return parsed;
}

function readLocalDatabasePort() {
  const { readFileSync } = require("node:fs");
  const config = readFileSync(path.join(repoRoot, "supabase", "config.toml"), "utf8");
  const dbSection = config.match(/\[db\]([\s\S]*?)(?:\n\[|$)/)?.[1] || "";
  const port = Number(dbSection.match(/^port\s*=\s*(\d+)\s*$/m)?.[1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("Local database port is invalid");
  return port;
}

function assertLocalSupabase(value) {
  let url;
  try { url = new URL(value); } catch { fail("Supabase URL is invalid"); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    fail("This diagnostic is restricted to local Supabase");
  }
}

function fail(message) {
  throw new Error(message);
}
