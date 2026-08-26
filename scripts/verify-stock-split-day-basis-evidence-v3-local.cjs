const path = require("node:path");
const { createHash } = require("node:crypto");

require("tsconfig-paths/register");

const { loadEnvConfig } = require("@next/env");
const { createJiti } = require("jiti");
const { Client } = require("pg");

const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));
loadEnvConfig(path.resolve(args.envDir), true, { info() {}, error() {} });
assertLocalSupabase(process.env.SUPABASE_URL || "");

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
const {
  buildCorporateActionAnalyzerInput,
  processGenericMonitorChild,
} = jiti("../lib/monitor/genericMonitorChildRuntime.ts");
const { runCorporateActionCanonicalAnalyzerPreview } = jiti("../lib/ai/corporateActionCanonicalAnalyzerPreview.ts");
const { readCurrentCorporateActionFacts } = jiti("../lib/monitor/corporateActionPersistence.ts");
const { readStockSplitExecutions } = jiti("../lib/monitor/stockSplitExecution.ts");
const {
  verifyCorporateActionEvidenceIdentity,
} = jiti("../lib/monitor/corporateActionCanonicalFacts.ts");
const {
  validateCorporateActionApplicabilityContextResponse,
} = jiti("../lib/monitor/corporateActionApplicabilityContext.ts");
const { PostgresShareCountHistoryRepository } = jiti("../lib/sec-structured-data/shareCountHistory.ts");
const { reconcileShareCountAnchors } = jiti("../lib/sec-structured-data/shareCountAnchorReconciliation.ts");

void main();

async function main() {
  await client.connect();
  try {
    const source = await readSourceLineage();
    const identity = buildIdentity(source);
    const applicabilityContext = await readApplicabilityContext(source);
    const analyzerInput = buildCorporateActionAnalyzerInput(
      identity,
      source.raw_item,
      source.primary_analysis,
      applicabilityContext,
    );

    await genericMonitorChildRepository.reserve(identity);
    let providerTrace = null;
    let analyzerCalls = 0;
    const execution = await processGenericMonitorChild(identity, {
      loadCorporateActionApplicabilityContext: async () => applicabilityContext,
      runCorporateActionAnalyzer: async (input) => {
        analyzerCalls += 1;
        const startedAt = performance.now();
        const result = await runCorporateActionCanonicalAnalyzerPreview(input);
        providerTrace = {
          stage: result.stage,
          latency_ms: Math.round((performance.now() - startedAt) * 100) / 100,
          model: result.run?.model || null,
          response_id: result.run?.responseId || null,
          usage: result.run?.usage || null,
          error: result.error || null,
          validation_errors: result.validation_errors || null,
        };
        return result;
      },
    });
    const persistedNow = execution.status === "succeeded_applicable"
      && execution.persistence === "saved" && execution.providerCalls === 1 && analyzerCalls === 1;
    const alreadyPersisted = execution.status === "duplicate"
      && execution.providerCalls === 0 && analyzerCalls === 0;
    if (!persistedNow && !alreadyPersisted) {
      fail(`Corporate Action production child failed: ${JSON.stringify({ execution, providerTrace })}`);
    }

    const beforeReplay = await readFactState(source);
    const replay = await processGenericMonitorChild(identity, {
      loadCorporateActionApplicabilityContext: async () => applicabilityContext,
    });
    const afterReplay = await readFactState(source);
    if (replay.status !== "duplicate" || replay.providerCalls !== 0
      || afterReplay.fact_count !== beforeReplay.fact_count
      || afterReplay.result_count !== beforeReplay.result_count) {
      fail(`Corporate Action replay was not duplicate-safe: ${JSON.stringify({ replay, beforeReplay, afterReplay })}`);
    }

    const current = await readCurrentCorporateActionFacts(source.event_id);
    if (current.status !== "available") fail(`Current Corporate Action facts returned ${current.status}`);
    const facts = current.facts;
    const issuer = facts.applicability?.issuer;
    const affected = facts.applicability?.affected_security;
    const exactRatio = facts.ratio.exact_source_components;
    if (issuer?.availability !== "available" || affected?.availability !== "available"
      || exactRatio?.availability !== "available"
      || facts.effective_date.availability !== "available") {
      fail("Canonical calculation fields are unavailable");
    }
    assertExpectedFacts(facts, exactRatio);
    if (!facts.evidence_identity
      || !verifyCorporateActionEvidenceIdentity(facts.evidence_identity, analyzerInput.source_documents)) {
      fail("Root authoritative evidence identity failed source range/hash verification");
    }
    if (facts.evidence.availability !== "available"
      || Array.from(facts.evidence.value).length > 800) {
      fail("Canonical evidence preview is unavailable or exceeds 800 characters");
    }

    const executionKnownAt = new Date(Date.parse(afterReplay.persisted_at) + 1_000).toISOString();
    const executionRead = await readStockSplitExecutions({
      actionKind: args.expectedKind,
      cik: args.cik,
      canonicalSecurityClassId: affected.canonical_security_class_id,
      from: args.expectedEffectiveDate,
      to: args.endAsOf,
      targetAt: `${args.endAsOf}T23:59:59.999Z`,
      knownAt: executionKnownAt,
    });
    if (executionRead.status !== "available"
      || executionRead.materializationStatus !== "SPLIT_EXECUTIONS_AVAILABLE"
      || executionRead.executions.length !== 1
      || executionRead.inactiveExecutions.length !== 0
      || executionRead.conflicts.length !== 0) {
      fail(`Expected one active conflict-free split execution: ${JSON.stringify(executionRead)}`);
    }

    const reconciliation = await reconcileShareCountAnchors({
      repository: new PostgresShareCountHistoryRepository(client),
      cik: args.cik,
      securityClassId: affected.canonical_security_class_id,
      startAnchor: { asOf: args.startAsOf },
      endAnchor: { asOf: args.endAsOf },
      executionKnownAt,
    });
    if (reconciliation.status !== "RECONCILED"
      || reconciliation.appliedStockSplitExecutions.length !== 1) {
      fail(`Stock Split reconciliation failed: ${JSON.stringify(reconciliation)}`);
    }

    const historyCount = await readShareCountHistoryCount();
    const authoritativeDocument = analyzerInput.source_documents.find(
      (document) => document.source_ref === facts.evidence_identity.source_ref,
    );
    process.stdout.write(`${JSON.stringify({
      ok: true,
      source: {
        accession: args.accession,
        raw_item_id: source.raw_item_id,
        event_id: source.event_id,
        parent_primary_ai_run_id: source.parent_primary_ai_run_id,
        authoritative_document: authoritativeDocument ? {
          source_ref: authoritativeDocument.source_ref,
          character_length: Array.from(authoritativeDocument.text).length,
          content_hash: createHash("sha256").update(authoritativeDocument.text).digest("hex"),
        } : null,
      },
      provider: {
        calls: execution.providerCalls,
        analyzer_calls: analyzerCalls,
        verifier_calls: 0,
        repair_calls: 0,
        persisted_now: persistedNow,
        ...providerTrace,
      },
      canonical: {
        event_kind: facts.event_kind,
        effective_date: facts.effective_date.value,
        exact_ratio: {
          old_share_units: exactRatio.old_share_units,
          new_share_units: exactRatio.new_share_units,
        },
        raw_timing: facts.effective_timing,
        calculation_activation: facts.calculation_activation,
        issuer_cik: issuer.issuer_cik,
        canonical_security_class_id: affected.canonical_security_class_id,
        fact_count: afterReplay.fact_count,
        result_count: afterReplay.result_count,
        authoritative_evidence: facts.evidence_identity,
        evidence_preview: {
          character_length: Array.from(facts.evidence.value).length,
          truncated: facts.evidence.preview_truncated === true,
        },
      },
      execution_reader: {
        materialization_status: executionRead.materializationStatus,
        active_count: executionRead.executions.length,
        inactive_count: executionRead.inactiveExecutions.length,
        conflict_count: executionRead.conflicts.length,
        execution_id: executionRead.executions[0].executionId,
        observation_count: executionRead.executions[0].observations.length,
        calculation_activation: executionRead.executions[0].calculationActivation,
      },
      replay: {
        status: replay.status,
        provider_calls: replay.providerCalls,
        canonical_duplicates_added: afterReplay.fact_count - beforeReplay.fact_count,
        result_duplicates_added: afterReplay.result_count - beforeReplay.result_count,
        execution_duplicates_added: executionRead.executions.length - 1,
      },
      os_reconciliation: {
        history_count: historyCount,
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
        applied_execution_count: reconciliation.appliedStockSplitExecutions.length,
        normalization_failure_count: reconciliation.normalizationFailures.length,
        conflict_count: reconciliation.conflicts.length,
      },
      database: { target: "local", writes: "canonical child only" },
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
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

async function readFactState(source) {
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
  const state = result.rows[0];
  if (state?.fact_count !== 1 || state?.result_count !== 1 || !state.persisted_at) {
    fail(`Expected one canonical fact/result: ${JSON.stringify(state)}`);
  }
  return state;
}

async function readShareCountHistoryCount() {
  const result = await client.query(
    "select count(*)::integer as count from public.share_count_history where issuer_cik = $1",
    [args.cik],
  );
  return result.rows[0]?.count ?? 0;
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
  if (!identity) fail("Corporate Action child identity is unavailable");
  return identity;
}

function assertExpectedFacts(facts, exactRatio) {
  if (facts.event_kind !== args.expectedKind
    || exactRatio.old_share_units !== args.expectedOld
    || exactRatio.new_share_units !== args.expectedNew
    || facts.effective_date.value !== args.expectedEffectiveDate
    || facts.calculation_activation?.state !== args.expectedActivation) {
    fail(`Canonical facts did not match requested acceptance: ${JSON.stringify({
      event_kind: facts.event_kind,
      exact_ratio: exactRatio,
      effective_date: facts.effective_date,
      calculation_activation: facts.calculation_activation,
    })}`);
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1] || "";
    if (!key?.startsWith("--") || !value) fail(`Unknown or incomplete argument: ${key || "<missing>"}`);
    parsed[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  if (!parsed.envDir || !/^\d{10}-\d{2}-\d{6}$/.test(parsed.accession || "")
    || !/^\d{10}$/.test(parsed.cik || "")
    || !new Set(["reverse_split", "forward_split"]).has(parsed.expectedKind)
    || !positiveDecimal(parsed.expectedOld) || !positiveDecimal(parsed.expectedNew)
    || !validDate(parsed.expectedEffectiveDate) || !validDate(parsed.startAsOf)
    || !validDate(parsed.endAsOf) || parsed.endAsOf <= parsed.startAsOf
    || !new Set(["ON_EFFECTIVE_DATE", "AFTER_MARKET_CLOSE"]).has(parsed.expectedActivation)) {
    fail("Usage: --env-dir <dir> --accession <SEC accession> --cik <10 digits> --expected-kind <reverse_split|forward_split> --expected-old <decimal> --expected-new <decimal> --expected-effective-date <YYYY-MM-DD> --expected-activation <ON_EFFECTIVE_DATE|AFTER_MARKET_CLOSE> --start-as-of <YYYY-MM-DD> --end-as-of <YYYY-MM-DD>");
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
  if (url.protocol !== "http:" || !new Set(["127.0.0.1", "localhost"]).has(url.hostname)) {
    fail("This validation is restricted to local Supabase");
  }
}

function positiveDecimal(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
    && Number.isFinite(Number(value)) && Number(value) > 0;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function fail(message) {
  throw new Error(message);
}
