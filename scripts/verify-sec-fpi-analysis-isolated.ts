import assert from "node:assert/strict";
import { registerHooks } from "node:module";
// @ts-expect-error The project intentionally uses pg without a separate declaration package.
import pg from "pg";
import { resolveSupabaseSecretKey } from "../lib/supabaseKeys.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20%7B%7D;",
      };
    }
    return nextResolve(specifier, context);
  },
});

const dbUrl = process.env.FPI_ANALYSIS_ISOLATED_DB_URL;
const expectedDbPort = process.env.FPI_ANALYSIS_ISOLATED_DB_PORT;
const apiUrl = process.env.SUPABASE_URL;
const secretKey = resolveSupabaseSecretKey().key;
const openAiKey = process.env.OPENAI_API_KEY;
if (!dbUrl || !expectedDbPort || !apiUrl || !secretKey || !openAiKey) {
  throw new Error(
    "FPI_ANALYSIS_ISOLATED_DB_URL, FPI_ANALYSIS_ISOLATED_DB_PORT, SUPABASE_URL, a privileged Supabase API key, and OPENAI_API_KEY are required",
  );
}

assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));
process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_USER_AGENT ||= "US-Stock-Radar isolated FPI analysis verification engineering@openai.com";
process.env.SEC_ANALYSIS_ALLOW_OPENAI = "true";
process.env.SEC_ANALYSIS_LLM_PROVIDER = "openai";
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const [
  { runSecRawIngest },
  { runSecFilingAnalysisIngest },
  { findSecRawItem },
  { buildSecFilingAnalysisPackage },
  { getSecDevRoomDiagnostics },
  { createSecOsProductionCollector },
] = await Promise.all([
  import("../lib/secIngest.ts"),
  import("../lib/secFilingAnalysisIngest.ts"),
  import("../lib/ai/secFilingAnalysisPreview.ts"),
  import("../lib/prompts/secFilingAnalysisPackage.ts"),
  import("../lib/development/secFormDevDashboard.ts"),
  import("../lib/sec-structured-data/osProductionCollector.ts"),
]);

type FpiFixture = {
  label: string;
  cik: string;
  accession: string;
  form: "20-F" | "40-F";
  primaryDocument: string;
  retainedAttachments?: readonly string[];
  excludedAttachments?: readonly string[];
  requiredLlmText: readonly RegExp[];
  officialIndexUrl: string;
};

const CASES: readonly FpiFixture[] = [
  {
    label: "Wipro 20-F",
    cik: "0001123799",
    accession: "0001193125-26-253514",
    form: "20-F",
    primaryDocument: "wit-20260331.htm",
    requiredLlmText: [/Wipro/i, /2026/i, /financial statements/i],
    officialIndexUrl: "https://www.sec.gov/Archives/edgar/data/1123799/000119312526253514/0001193125-26-253514-index.html",
  },
  {
    label: "Barrick 40-F",
    cik: "0000756894",
    accession: "0001193125-26-079253",
    form: "40-F",
    primaryDocument: "d833573d40f.htm",
    retainedAttachments: ["d833573dex991.htm", "d833573dex993.htm", "d833573dex994.htm"],
    excludedAttachments: [
      "d833573dex992.htm",
      "d833573dex995.htm",
      "d833573dex996.htm",
      "d833573dex997.htm",
      "d833573dex998.htm",
      "d833573dex999.htm",
      "d833573dex9910.htm",
      "d833573dex9911.htm",
      "d833573dex9912.htm",
      "d833573dex9913.htm",
      "d833573dex9914.htm",
    ],
    requiredLlmText: [/annual information form/i, /financial statements/i, /management['’]s discussion and analysis/i],
    officialIndexUrl: "https://www.sec.gov/Archives/edgar/data/756894/000119312526079253/0001193125-26-079253-index.html",
  },
];

const { Client } = pg;
const client = new Client({ connectionString: dbUrl });
const summaries: Array<Record<string, unknown>> = [];

try {
  await client.connect();
  await assertAccessionStateIsClean(client, CASES.map((item) => item.accession));

  const osCollector = createSecOsProductionCollector({
    sqlClient: client,
    userAgent: process.env.SEC_USER_AGENT,
  });
  const wiproOs = await osCollector.collectIssuer({ cik: CASES[0].cik, mode: "bootstrap" });
  assert.notEqual(wiproOs.status, "FAILED", JSON.stringify(wiproOs));
  assert.equal(wiproOs.counts.persistedObservations, 0, "Wipro ADS/ordinary ambiguity must write no authoritative O/S observation");
  const wiproSnapshot = await oneRow(client, `
    select status, reason, source_accession
      from public.issuer_common_class_universe_snapshots
     where issuer_cik = $1
       and source_accession = $2
     order by created_at desc
     limit 1
  `, [CASES[0].cik, CASES[0].accession]);
  assert.equal(wiproSnapshot?.status, "AMBIGUOUS");
  assert.equal(wiproSnapshot?.reason, "ADS_OR_ORDINARY_AMBIGUOUS");

  for (const fixture of CASES) {
    const officialIndex: Response = await globalThis.fetch(fixture.officialIndexUrl, {
      headers: { "User-Agent": process.env.SEC_USER_AGENT },
    });
    assert.equal(officialIndex.ok, true, `${fixture.label} official SEC index fetch`);
    const officialIndexHtml = await officialIndex.text();
    assert.match(officialIndexHtml, new RegExp(escapeRegExp(fixture.primaryDocument), "i"));
    for (const filename of fixture.retainedAttachments ?? []) {
      assert.match(officialIndexHtml, new RegExp(escapeRegExp(filename), "i"));
    }

    const rawIngest = await runSecRawIngest({
      accessionNumber: fixture.accession,
      cik: fixture.cik,
      formTypes: [fixture.form],
      dryRun: false,
      force: true,
      includeDocuments: true,
      attachmentLimit: 8,
      limit: 1,
    });
    assert.equal(rawIngest.ok, true, JSON.stringify(rawIngest));
    const rawItemId = stringValue(rawIngest.items?.[0]?.raw_item_id);
    assert.ok(rawItemId, `${fixture.label} raw ingest must persist an item`);

    const rawLookup = await findSecRawItem({ rawItemId });
    assert.equal(rawLookup.ok, true, JSON.stringify(rawLookup));
    assert.ok(rawLookup.rawItem, `${fixture.label} persisted raw row must read back`);
    const filingPackage = buildSecFilingAnalysisPackage(rawLookup.rawItem!);
    assert.equal(filingPackage.accession_number, fixture.accession);
    assert.equal(filingPackage.form_type, fixture.form);
    assert.equal(filingPackage.form_family, "periodic_report");
    assert.equal(filingPackage.form_adapter?.parserGroup, "periodic-reports");
    assert.ok(filingPackage.package_stats.included_chars > 10_000, `${fixture.label} must provide substantive original SEC text to the LLM package`);
    for (const pattern of fixture.requiredLlmText) {
      assert.match(filingPackage.llm_text, pattern, `${fixture.label} LLM input must retain ${pattern}`);
    }

    const rawPayload = recordValue(rawLookup.rawItem!.raw_payload);
    const documents = recordArray(rawPayload.documents);
    const primary = documents.find((document) => document.isPrimary === true);
    assert.equal(filenameFromUrl(stringValue(primary?.url)), fixture.primaryDocument);
    const attachments = recordArray(rawPayload.attachment_texts);
    const retainedAttachmentNames = attachments.map((attachment) => filenameFromUrl(stringValue(attachment.url))).filter(Boolean);
    for (const filename of fixture.retainedAttachments ?? []) {
      assert.ok(retainedAttachmentNames.includes(filename), `${fixture.label} retains ${filename}`);
    }
    for (const filename of fixture.excludedAttachments ?? []) {
      assert.ok(!retainedAttachmentNames.includes(filename), `${fixture.label} excludes ${filename} from LLM attachment text`);
    }

    const analysis = await runSecFilingAnalysisIngest({
      rawItemId,
      dryRun: false,
      force: true,
      suppressAlerts: true,
      llmProvider: "openai",
      llmModel: process.env.FPI_ANALYSIS_OPENAI_MODEL || "gpt-4.1-mini",
    });
    assert.equal(analysis.ok, true, `${fixture.label}: ${analysis.stage} ${stringValue(analysis.error)}`);
    assert.equal(analysis.stage, "complete", `${fixture.label}: ${stringValue(analysis.error)}`);
    assert.equal(recordValue(analysis.alertDelivery).suppressed, true, "controlled persist must suppress alert delivery");
    const eventId = stringValue(analysis.event?.id);
    const aiRunId = stringValue(analysis.primaryAiRunId);
    assert.ok(eventId && aiRunId, `${fixture.label} must persist event and AI run identities`);

    const [eventRow, eventAnalysisRow, aiRunRow, aiOutputRow] = await Promise.all([
      oneRow(client, "select * from public.events where id = $1", [eventId]),
      oneRow(client, "select * from public.event_analysis where event_id = $1", [eventId]),
      oneRow(client, "select * from public.ai_runs where id = $1", [aiRunId]),
      oneRow(client, "select * from public.ai_outputs where ai_run_id = $1 and event_id = $2 order by created_at desc limit 1", [aiRunId, eventId]),
    ]);
    assert.equal(eventRow?.raw_item_id, rawItemId);
    assert.ok(eventAnalysisRow, `${fixture.label} event_analysis row`);
    assert.equal(aiRunRow?.status, "completed");
    assert.equal(aiRunRow?.raw_item_id, rawItemId);
    assert.equal(aiRunRow?.event_id, eventId);
    assert.ok(aiOutputRow, `${fixture.label} ai_outputs row`);
    assert.equal(aiOutputRow?.event_id, eventId);
    assert.match(stringValue(aiRunRow?.model), /^gpt-/i, "real GPT model identity must be persisted");

    const alertRows = await oneRow(client, "select count(*)::integer as count from public.alert_delivery_event_runs where event_id = $1", [eventId]);
    assert.equal(Number(alertRows?.count), 0, "suppressed verification must create no alert-delivery run");

    const diagnostics = await getSecDevRoomDiagnostics("periodic-reports", {
      eventId,
      ticker: null,
      accessionNumber: fixture.accession,
    });
    assert.ok(diagnostics, `${fixture.label} diagnostic snapshot`);
    assert.notEqual(diagnostics!.summary.status, "read_failed");
    assert.equal(diagnostics!.summary.result_count, 1);
    const diagnostic = diagnostics!.results[0]!;
    assert.equal(diagnostic.identity.event_id, eventId);
    assert.equal(diagnostic.identity.raw_item_id, rawItemId);
    assert.equal(diagnostic.identity.accession_number, fixture.accession);
    assert.equal(diagnostic.identity.form_type, fixture.form);
    for (const sourceName of ["raw_items", "source_runs", "events", "event_analysis", "ai_runs"] as const) {
      assert.equal(
        diagnostic.sources.find((source) => source.name === sourceName)?.status,
        "available",
        `${fixture.label} diagnostic ${sourceName}`,
      );
    }

    summaries.push({
      label: fixture.label,
      accession: fixture.accession,
      rawItemId,
      eventId,
      aiRunId,
      aiOutputId: aiOutputRow!.id,
      llm: {
        model: aiRunRow!.model,
        promptKey: aiRunRow!.prompt_key,
        promptVersion: aiRunRow!.prompt_version,
      },
      package: {
        formFamily: filingPackage.form_family,
        adapter: filingPackage.form_adapter?.parserGroup,
        includedChars: filingPackage.package_stats.included_chars,
        sections: filingPackage.package_stats.included_sections,
        retainedAttachments: retainedAttachmentNames,
      },
      persistence: {
        eventAnalysis: eventAnalysisRow!.event_id,
        aiOutput: aiOutputRow!.id,
        diagnosticStatus: diagnostics!.summary.status,
      },
      alertsSuppressed: true,
    });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    isolated: {
      apiOrigin: new URL(apiUrl).origin,
      dbPort: expectedDbPort,
      sharedPortsRejected: [56321, 56322],
    },
    wiproOsFailClosed: {
      collectorStatus: wiproOs.status,
      persistedObservations: wiproOs.counts.persistedObservations,
      snapshot: wiproSnapshot,
    },
    analyses: summaries,
  }, null, 2)}\n`);
} finally {
  await client.end();
}

function assertIsolatedTargets(databaseUrl: URL, expectedPort: string, supabaseUrl: URL) {
  const localHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
  assert.ok(localHosts.has(databaseUrl.hostname), "database must be loopback-only");
  assert.ok(localHosts.has(supabaseUrl.hostname), "Supabase API must be loopback-only");
  assert.equal(databaseUrl.port, expectedPort);
  assert.notEqual(databaseUrl.port, "56322", "shared-local database port 56322 is forbidden");
  assert.notEqual(supabaseUrl.port, "56321", "shared-local API port 56321 is forbidden");
  assert.equal(databaseUrl.pathname, "/postgres");
}

async function assertAccessionStateIsClean(connection: InstanceType<typeof Client>, accessions: readonly string[]) {
  const result = await connection.query(
    `select count(*)::integer as count
       from public.raw_items
      where source_code = 'sec_edgar'
        and source_unique_id = any($1::text[])`,
    [accessions],
  );
  assert.equal(Number(result.rows[0]?.count ?? 0), 0, "disposable stack must start without target raw rows");
}

async function oneRow(
  connection: InstanceType<typeof Client>,
  sql: string,
  values: unknown[],
): Promise<Record<string, unknown> | null> {
  const result = await connection.query(sql, values);
  return result.rows[0] ?? null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function filenameFromUrl(value: string) {
  if (!value) return "";
  try {
    return new URL(value).pathname.split("/").pop() || "";
  } catch {
    return value.split(/[\\/]/).pop() || "";
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
