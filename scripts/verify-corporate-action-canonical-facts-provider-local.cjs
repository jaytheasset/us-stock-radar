const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");

require("tsconfig-paths/register");

const { loadEnvConfig } = require("@next/env");
const { createJiti } = require("jiti");
const { Client } = require("pg");
const { resolveSupabaseSecretKey } = require("./supabase-key-env.cjs");

const repoRoot = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));

if (!args.envDir || args.samples.length === 0) {
  fail("Usage: node scripts/verify-corporate-action-canonical-facts-provider-local.cjs --env-dir <dir> --sample <source-id>:<applicable|not_applicable>[:stage:date:ratio]");
}

loadEnvConfig(path.resolve(args.envDir), true, {
  info() {},
  error() {},
});

assertLocalSupabase(process.env.SUPABASE_URL || "");
if (!resolveSupabaseSecretKey()) fail("Local Supabase privileged API key configuration is unavailable");
if (!process.env.GEMINI_API_KEY) fail("Gemini provider configuration is unavailable");

const dbPort = readLocalDatabasePort();
const client = new Client({
  host: "127.0.0.1",
  port: dbPort,
  user: "postgres",
  password: "postgres",
  database: "postgres",
});

const jiti = createJiti(__filename, { interopDefault: true });
const {
  buildGenericMonitorChildIdentities,
} = jiti("../lib/monitor/genericMonitorChildExecution.ts");
const {
  genericMonitorChildRepository,
} = jiti("../lib/monitor/genericMonitorChildSupabaseRepository.ts");
const {
  processGenericMonitorChild,
} = jiti("../lib/monitor/genericMonitorChildRuntime.ts");
const {
  runCorporateActionCanonicalAnalyzerPreview,
} = jiti("../lib/ai/corporateActionCanonicalAnalyzerPreview.ts");
const {
  readCurrentCorporateActionFacts,
} = jiti("../lib/monitor/corporateActionPersistence.ts");

const temporaryRunIds = [];
const temporaryOutputIds = [];

void main();

async function main() {
  await client.connect();
  const results = [];
  try {
    for (const sample of args.samples) results.push(await verifySample(sample));
  } finally {
    await cleanupTemporaryRows();
    await client.end();
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider_calls: results.reduce((sum, item) => sum + item.provider_calls, 0),
    temporary_rows_cleaned: true,
    samples: results,
  }, null, 2)}\n`);
}

async function verifySample(sample) {
  const rowResult = await client.query(
    `select e.id as event_id, e.raw_item_id, r.source_code, r.source_unique_id
       from public.events e
       join public.raw_items r on r.id = e.raw_item_id
      where r.source_unique_id = $1
        and r.source_code = 'nasdaq_corporate_actions'
      order by e.detected_at desc, e.id desc
      limit 2`,
    [sample.sourceId],
  );
  if (rowResult.rows.length !== 1) fail(`Expected exactly one stored Nasdaq sample for ${sample.sourceId}`);
  const row = rowResult.rows[0];
  const parentRunId = randomUUID();
  const parentOutputId = randomUUID();
  const now = new Date().toISOString();
  temporaryRunIds.push(parentRunId);
  temporaryOutputIds.push(parentOutputId);

  await client.query(
    `insert into public.ai_runs (
       id, event_id, raw_item_id, prompt_key, prompt_version, model, status,
       started_at, finished_at, usage, metadata
     ) values ($1, $2, $3, 'nasdaq_corporate_action_analysis',
       'corporate-action-local-acceptance-v1', 'local_acceptance_fixture',
       'completed', $4, $4, '{}'::jsonb,
       jsonb_build_object('temporary_acceptance_fixture', true))`,
    [parentRunId, row.event_id, row.raw_item_id, now],
  );
  await client.query(
    `insert into public.ai_outputs (id, ai_run_id, event_id, output_type, payload)
     values ($1, $2, $3, 'news_event_analysis',
       jsonb_build_object(
         'analysis', jsonb_build_object(
           'monitor_routes', jsonb_build_array(
             jsonb_build_object('monitor_analyzer_key', 'corporate_action')
           )
         ),
         'output_text', ''
       ))`,
    [parentOutputId, parentRunId, row.event_id],
  );

  const [identity] = buildGenericMonitorChildIdentities({
    primary: {
      eventId: row.event_id,
      rawItemId: row.raw_item_id,
      sourceFamily: "nasdaq_corporate_actions",
      sourceGroup: "news",
      sourceCode: row.source_code,
      sourceIdentity: row.source_unique_id,
      parentPrimaryAiRunId: parentRunId,
      parentPromptKey: "nasdaq_corporate_action_analysis",
      parentPromptVersion: "corporate-action-local-acceptance-v1",
    },
    monitorRouting: {
      monitor_routes: [{ monitor_analyzer_key: "corporate_action" }],
    },
    now,
  });
  temporaryRunIds.push(identity.executionId);
  await genericMonitorChildRepository.reserve(identity);

  let providerTrace = null;
  const execution = await processGenericMonitorChild(identity, {
    runCorporateActionAnalyzer: async (input) => {
      const startedAt = Date.now();
      const result = await runCorporateActionCanonicalAnalyzerPreview(input);
      providerTrace = {
        latency_ms: Date.now() - startedAt,
        model: result.run?.model || null,
        usage: result.run?.usage || null,
        stage: result.stage,
        error: result.error || null,
        validation_errors: result.validation_errors || null,
        output_text: result.stage === "complete" ? null : result.run?.outputText || null,
      };
      return result;
    },
  });
  const duplicate = await processGenericMonitorChild(identity);
  const reader = await readCurrentCorporateActionFacts(row.event_id);

  assertAcceptance(sample, execution, duplicate, reader, providerTrace);
  const facts = reader.status === "available" ? reader.facts : null;
  return {
    source_id: sample.sourceId,
    expected: sample.expected,
    execution_status: execution.status,
    duplicate_status: duplicate.status,
    provider_calls: execution.providerCalls + duplicate.providerCalls,
    provider: providerTrace,
    reader_status: reader.status,
    facts: facts ? {
      event_kind: facts.event_kind,
      action_stage: facts.action_stage,
      effective_date: facts.effective_date,
      old_shares_per_new_share: facts.ratio.old_shares_per_new_share,
      evidence: facts.evidence.availability,
      confidence: facts.confidence,
      as_of: facts.as_of,
      source_id: facts.source.source_id,
    } : null,
  };
}

function assertAcceptance(sample, execution, duplicate, reader, providerTrace) {
  const expectedExecution = sample.expected === "applicable"
    ? "succeeded_applicable"
    : "succeeded_not_applicable";
  const expectedReader = sample.expected === "applicable" ? "available" : "not_applicable";
  if (execution.status !== expectedExecution || execution.persistence !== "saved") {
    fail(`${sample.sourceId} execution was ${execution.status}/${execution.persistence || "unpersisted"}: ${execution.error || providerTrace?.error || providerTrace?.stage || "unknown"}; provider=${JSON.stringify(providerTrace)}`);
  }
  if (execution.providerCalls !== 1 || duplicate.status !== "duplicate" || duplicate.providerCalls !== 0) {
    fail(`${sample.sourceId} did not preserve one-call idempotency`);
  }
  if (reader.status !== expectedReader) fail(`${sample.sourceId} reader returned ${reader.status}`);
  if (reader.status !== "available") return;
  const facts = reader.facts;
  if (facts.event_kind !== "reverse_split") fail(`${sample.sourceId} event_kind is invalid`);
  if (sample.stage && facts.action_stage !== sample.stage) fail(`${sample.sourceId} stage is ${facts.action_stage}`);
  if (sample.date) {
    if (facts.effective_date.availability !== "available" || facts.effective_date.value !== sample.date) {
      fail(`${sample.sourceId} effective date is invalid`);
    }
  }
  if (sample.ratio !== null) {
    const ratio = facts.ratio.old_shares_per_new_share;
    if (ratio.availability !== "available" || ratio.value !== sample.ratio) {
      fail(`${sample.sourceId} normalized ratio is invalid`);
    }
  }
}

async function cleanupTemporaryRows() {
  if (temporaryRunIds.length === 0 && temporaryOutputIds.length === 0) return;
  await client.query("begin");
  try {
    if (temporaryRunIds.length) {
      await client.query(
        "delete from public.event_corporate_action_results where source_execution_id = any($1::uuid[])",
        [temporaryRunIds],
      );
      await client.query("delete from public.ai_outputs where ai_run_id = any($1::uuid[])", [temporaryRunIds]);
      await client.query("delete from public.ai_runs where id = any($1::uuid[])", [temporaryRunIds]);
    }
    if (temporaryOutputIds.length) {
      await client.query("delete from public.ai_outputs where id = any($1::uuid[])", [temporaryOutputIds]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function parseArgs(values) {
  const parsed = { envDir: "", samples: [] };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--env-dir") {
      parsed.envDir = values[index + 1] || "";
      index += 1;
      continue;
    }
    if (values[index] === "--sample") {
      parsed.samples.push(parseSample(values[index + 1] || ""));
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${values[index]}`);
  }
  return parsed;
}

function parseSample(value) {
  const [sourceId, expected, stage = "", date = "", ratioText = ""] = value.split(":");
  if (!/^[A-Za-z0-9._-]{1,240}$/.test(sourceId || "")) fail("Sample source id is invalid");
  if (expected !== "applicable" && expected !== "not_applicable") fail(`Sample expectation is invalid for ${sourceId}`);
  if (expected === "not_applicable" && (stage || date || ratioText)) fail(`Negative sample ${sourceId} cannot declare reverse-split facts`);
  const ratio = ratioText ? Number(ratioText) : null;
  if (ratioText && (!Number.isFinite(ratio) || ratio <= 0)) fail(`Sample ratio is invalid for ${sourceId}`);
  return { sourceId, expected, stage, date, ratio };
}

function readLocalDatabasePort() {
  const config = readFileSync(path.join(repoRoot, "supabase", "config.toml"), "utf8");
  const dbSection = config.match(/\[db\]([\s\S]*?)(?:\n\[|$)/)?.[1] || "";
  const port = Number(dbSection.match(/^port\s*=\s*(\d+)\s*$/m)?.[1]);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) fail("Local Supabase database port is invalid");
  return port;
}

function assertLocalSupabase(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Supabase URL is invalid");
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    fail("Provider acceptance is restricted to local Supabase");
  }
}

function fail(message) {
  throw new Error(message);
}
