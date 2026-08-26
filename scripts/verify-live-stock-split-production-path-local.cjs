const path = require("node:path");

require("tsconfig-paths/register");

const { loadEnvConfig } = require("@next/env");
const { createJiti } = require("jiti");
const { Client } = require("pg");

const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));

loadEnvConfig(path.resolve(args.envDir), true, { info() {}, error() {} });
assertLocalSupabase(process.env.SUPABASE_URL || "");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) fail("Local Supabase service-role configuration is unavailable");
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
const { genericMonitorChildRepository } = jiti("../lib/monitor/genericMonitorChildSupabaseRepository.ts");
const { processGenericMonitorChild } = jiti("../lib/monitor/genericMonitorChildRuntime.ts");
const { runCorporateActionCanonicalAnalyzerPreview } = jiti("../lib/ai/corporateActionCanonicalAnalyzerPreview.ts");
const { readCurrentCorporateActionFacts } = jiti("../lib/monitor/corporateActionPersistence.ts");
const { assertHistoricalReplayCanonicalContractState } = jiti("./historicalReplayCanonicalContractGate.ts");
const { readStockSplitExecutions } = jiti("../lib/monitor/stockSplitExecution.ts");
const { PostgresShareCountHistoryRepository } = jiti("../lib/sec-structured-data/shareCountHistory.ts");
const { reconcileShareCountAnchors } = jiti("../lib/sec-structured-data/shareCountAnchorReconciliation.ts");

void main();

async function main() {
  await client.connect();
  try {
    const source = await readSourceLineage();
    const identity = buildIdentity(source);
    await genericMonitorChildRepository.reserve(identity);

    let providerTrace = null;
    const execution = await processGenericMonitorChild(identity, {
      runCorporateActionAnalyzer: async (input) => {
        const startedAt = Date.now();
        const result = await runCorporateActionCanonicalAnalyzerPreview(input);
        providerTrace = {
          stage: result.stage,
          latency_ms: Date.now() - startedAt,
          model: result.run?.model || null,
          response_id: result.run?.responseId || null,
          usage: result.run?.usage || null,
          error: result.error || null,
          validation_errors: result.validation_errors || null,
          failed_output_text: result.stage === "complete" ? null : result.run?.outputText || null,
        };
        return result;
      },
    });
    const savedNow = execution.status === "succeeded_applicable" && execution.persistence === "saved";
    if (!savedNow && execution.status !== "duplicate") {
      fail(`Corporate Action execution failed: ${execution.status}/${execution.persistence || "unpersisted"}: ${execution.error || providerTrace?.error || "unknown"}; provider=${JSON.stringify(providerTrace)}`);
    }

    const duplicate = await processGenericMonitorChild(identity);
    const current = await readCurrentCorporateActionFacts(source.event_id);
    if (current.status !== "available") fail(`Corporate Action current reader returned ${current.status}`);
    const facts = current.facts;
    const affected = facts.applicability?.affected_security;
    if (affected?.availability !== "available") fail("Canonical security class is unavailable");
    const securityClassId = affected.canonical_security_class_id;
    const factState = await readFactState(current);
    const executionRead = await readStockSplitExecutions({
      actionKind: "forward_split",
      cik: args.cik,
      canonicalSecurityClassId: securityClassId,
      from: args.startAsOf,
      to: args.endAsOf,
      targetAt: `${args.endAsOf}T23:59:59.999Z`,
      knownAt: factState.known_at,
    });
    const reconciliation = await reconcileShareCountAnchors({
      repository: new PostgresShareCountHistoryRepository(client),
      cik: args.cik,
      securityClassId,
      startAnchor: { asOf: args.startAsOf },
      endAnchor: { asOf: args.endAsOf },
      executionKnownAt: factState.known_at,
    });
    const historyCount = await readShareCountHistoryCount();
    if (executionRead.status !== "available" || executionRead.executions.length !== 1
      || executionRead.inactiveExecutions.length !== 0 || executionRead.conflicts.length !== 0) {
      fail(`Expected exactly one active conflict-free forward-split execution: ${JSON.stringify(executionRead)}`);
    }
    if (reconciliation.status !== "RECONCILED"
      || reconciliation.appliedStockSplitExecutions.length !== 1) {
      fail(`Expected one applied execution in reconciliation, got ${reconciliation.status}`);
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      source: {
        accession: args.accession,
        raw_item_id: source.raw_item_id,
        event_id: source.event_id,
        parent_primary_ai_run_id: source.parent_primary_ai_run_id,
        parent_prompt_key: source.parent_prompt_key,
        parent_prompt_version: source.parent_prompt_version,
        monitor_routes: source.monitor_routes,
      },
      corporate_action: {
        execution_status: execution.status,
        persistence: execution.persistence,
        provider_calls: execution.providerCalls,
        current_analyzer_contract_version: factState.current_analyzer_contract_version,
        selected_source_execution_id: factState.selected_source_execution_id,
        canonical_fact_count: factState.current_contract_fact_count,
        canonical_result_count: factState.current_contract_result_count,
        preserved_prior_fact_count: factState.preserved_legacy_or_prior_fact_count,
        preserved_prior_result_count: factState.preserved_legacy_or_prior_result_count,
        execution_known_at: factState.known_at,
        duplicate_status: duplicate.status,
        duplicate_provider_calls: duplicate.providerCalls,
        provider: providerTrace,
        event_kind: facts.event_kind,
        action_stage: facts.action_stage,
        effective_date: facts.effective_date,
        effective_timing: facts.effective_timing,
        exact_ratio: facts.ratio.exact_source_components,
        issuer_cik: facts.applicability.issuer,
        affected_security: affected,
        source: facts.source,
        source_ref: facts.source_ref,
        evidence: facts.evidence,
      },
      execution_reader: {
        status: executionRead.status,
        target_at: executionRead.targetAt,
        executions: executionRead.executions.map((item) => ({
          execution_id: item.executionId,
          status: item.status,
          execution_status: item.executionStatus,
          effective_date: item.effectiveDate,
          effective_timing: item.effectiveTiming,
          exact_ratio: item.exactRatio,
          observation_count: item.observations.length,
          accessions: item.observations.map((observation) => observation.accessionNumber),
        })),
        inactive_count: executionRead.inactiveExecutions.length,
        conflict_count: executionRead.conflicts.length,
      },
      os_history_count: historyCount,
      reconciliation: {
        status: reconciliation.status,
        reason: reconciliation.reason,
        basis_target_at: reconciliation.basisTargetAt,
        start_anchor: {
          as_of: reconciliation.startAnchor.asOf,
          shares: reconciliation.startAnchor.sharesOutstanding,
          accession: reconciliation.startAnchor.selectedObservation.accessionNumber,
        },
        normalized_start: reconciliation.normalizedStartShares,
        end_anchor: {
          as_of: reconciliation.endAnchor.asOf,
          shares: reconciliation.endAnchor.sharesOutstanding,
          accession: reconciliation.endAnchor.selectedObservation.accessionNumber,
        },
        net_change_shares: reconciliation.netChangeShares,
        net_change_pct: reconciliation.netChangePct,
        applied_executions: reconciliation.appliedStockSplitExecutions.map((item) => ({
          kind: item.kind,
          execution_id: item.executionId,
          effective_date: item.effectiveDate,
          exact_ratio: item.exactRatio,
          activation: item.activation,
          observation_count: item.observations.length,
        })),
        normalization_failure_count: reconciliation.normalizationFailures.length,
        conflict_count: reconciliation.conflicts.length,
      },
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

async function readFactState(current) {
  const result = await client.query(
    `select
       (select count(*)::integer
          from public.event_corporate_action_facts as facts
         where facts.event_id = $1
           and facts.parent_primary_ai_run_id = $2
           and facts.monitor_analyzer_key = 'corporate_action'
           and facts.analyzer_contract_version = $3) as current_contract_fact_count,
       (select count(*)::integer
          from public.event_corporate_action_results as results
         where results.event_id = $1
           and results.parent_primary_ai_run_id = $2
           and results.monitor_analyzer_key = 'corporate_action'
           and results.analyzer_contract_version = $3) as current_contract_result_count,
       (select count(*)::integer
          from public.event_corporate_action_facts as facts
         where facts.source_execution_id = $4
           and facts.event_id = $1
           and facts.parent_primary_ai_run_id = $2
           and facts.monitor_analyzer_key = 'corporate_action'
           and facts.analyzer_contract_version = $3) as selected_fact_count,
       (select count(*)::integer
          from public.event_corporate_action_results as results
         where results.source_execution_id = $4
           and results.event_id = $1
           and results.parent_primary_ai_run_id = $2
           and results.monitor_analyzer_key = 'corporate_action'
           and results.analyzer_contract_version = $3) as selected_result_count,
       (select count(*)::integer
          from public.event_corporate_action_facts as facts
         where facts.event_id = $1
           and not (
             facts.parent_primary_ai_run_id = $2
             and facts.monitor_analyzer_key = 'corporate_action'
             and facts.analyzer_contract_version = $3
           )) as preserved_legacy_or_prior_fact_count,
       (select count(*)::integer
          from public.event_corporate_action_results as results
         where results.event_id = $1
           and not (
             results.parent_primary_ai_run_id = $2
             and results.monitor_analyzer_key = 'corporate_action'
             and results.analyzer_contract_version = $3
           )) as preserved_legacy_or_prior_result_count,
       (select max(facts.persisted_at)::text
          from public.event_corporate_action_facts as facts
         where facts.source_execution_id = $4
           and facts.event_id = $1
           and facts.parent_primary_ai_run_id = $2
           and facts.monitor_analyzer_key = 'corporate_action'
           and facts.analyzer_contract_version = $3) as selected_fact_persisted_at`,
    [
      current.eventId,
      current.parentPrimaryAiRunId,
      current.analyzerContractVersion,
      current.sourceExecutionId,
    ],
  );
  return assertHistoricalReplayCanonicalContractState(current, result.rows[0]);
}

async function readShareCountHistoryCount() {
  const result = await client.query(
    "select count(*)::integer as count from public.share_count_history where issuer_cik = $1",
    [args.cik],
  );
  return result.rows[0]?.count ?? 0;
}

async function readSourceLineage() {
  const result = await client.query(
    `select e.id as event_id,
            r.id as raw_item_id,
            r.source_code,
            r.source_group,
            r.source_unique_id,
            a.id as parent_primary_ai_run_id,
            a.prompt_key as parent_prompt_key,
            a.prompt_version as parent_prompt_version,
            o.payload->'analysis'->'monitor_routes' as monitor_routes
       from public.raw_items r
       join public.events e on e.raw_item_id = r.id
       join public.ai_runs a on a.event_id = e.id and a.raw_item_id = r.id
       join public.ai_outputs o on o.ai_run_id = a.id
      where r.source_code = 'sec_edgar'
        and r.source_unique_id = $1
        and a.status = 'completed'
        and o.payload->'analysis'->'monitor_routes' @> '[{"monitor_analyzer_key":"corporate_action"}]'::jsonb
      order by a.started_at desc, a.id desc
      limit 1`,
    [args.accession],
  );
  if (result.rows.length !== 1) fail(`Expected exactly one latest routed Primary lineage for ${args.accession}`);
  return result.rows[0];
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

function parseArgs(values) {
  const parsed = {
    envDir: "",
    accession: "",
    cik: "",
    startAsOf: "",
    endAsOf: "",
  };
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1] || "";
    if (key === "--env-dir") parsed.envDir = value;
    else if (key === "--accession") parsed.accession = value;
    else if (key === "--cik") parsed.cik = value;
    else if (key === "--start-as-of") parsed.startAsOf = value;
    else if (key === "--end-as-of") parsed.endAsOf = value;
    else fail(`Unknown or incomplete argument: ${key || "<missing>"}`);
  }
  if (!parsed.envDir || !/^\d{10}-\d{2}-\d{6}$/.test(parsed.accession)
    || !/^\d{10}$/.test(parsed.cik) || !validDate(parsed.startAsOf)
    || !validDate(parsed.endAsOf) || parsed.endAsOf <= parsed.startAsOf) {
    fail("Usage: --env-dir <dir> --accession <SEC accession> --cik <10 digits> --start-as-of <YYYY-MM-DD> --end-as-of <YYYY-MM-DD>");
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
    fail("This validation is restricted to local Supabase");
  }
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function fail(message) {
  throw new Error(message);
}
