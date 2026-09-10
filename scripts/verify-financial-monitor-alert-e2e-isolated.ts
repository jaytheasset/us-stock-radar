import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
// @ts-expect-error pg declarations are intentionally absent from this repository.
import pg from "pg";
import { resolvePeriodicFinancials } from "../lib/sec-structured-data/periodicFinancialResolver.ts";
import { buildPeriodicFinancialMonitorAnalysis } from "../lib/monitor/periodicFinancialMonitor.ts";
import { periodicFinancialAuditSample, preparePeriodicFinancialAuditSample } from "../lib/monitor/periodicFinancialAuditFixture.testSupport.ts";
import { processPeriodicFinancialMonitorChild } from "../lib/monitor/genericMonitorChildRuntime.ts";
import { buildPeriodicFinancialMonitorChildIdentity } from "../lib/monitor/genericMonitorChildExecution.ts";
import { SecStructuredHttpClient } from "../lib/sec-structured-data/httpClient.ts";
import { SecFilingXbrlHttpClient, parseSecFilingXbrlArtifacts } from "../lib/sec-structured-data/filingXbrlContext.ts";
import { normalizeSecStructuredDocuments } from "../lib/sec-structured-data/normalization.ts";
import { SecRequestPolicy } from "../lib/sec-structured-data/secRequestPolicy.ts";

const { Client } = pg;
const dbUrl = process.env.FINANCIAL_ISOLATED_DB_URL || "";
const dbPort = process.env.FINANCIAL_ISOLATED_DB_PORT || "";
const apiUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const appOrigin = (process.env.APP_ORIGIN || "http://127.0.0.1:3111").replace(/\/$/, "");
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!/^58\d{3}$/.test(dbPort) || ["56321", "56322"].includes(dbPort)) throw new Error("A dedicated 58xxx DB port is required");
for (const url of [dbUrl, apiUrl, appOrigin]) {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error("Local isolated endpoints are required");
}
if (!dbUrl.includes(`:${dbPort}/`) || !apiUrl.includes(":58131") || !appOrigin.includes(":3111")) throw new Error("Unexpected isolated endpoint identity");
if (!publishableKey || !secretKey) throw new Error("Isolated Supabase keys are required");

const db = new Client({ connectionString: dbUrl });
await db.connect();
const identity = await db.query("select current_database() as database, current_user as role, to_regclass('public.financial_monitors')::text as table_name");
assert.deepEqual(identity.rows[0], { database: "postgres", role: "postgres", table_name: "financial_monitors" });
await cleanPreviousIsolatedRun();
await db.query(`insert into public.sources (code,name,source_group,runtime_owner,enabled)
  values ('sec_edgar','SEC EDGAR isolated financial fixture','filings','manual',true)
  on conflict (code) do nothing`);
assert.equal((await fetch(`${appOrigin}/api/health`)).status, 200);

const userA = await createUser("owner");
const userB = await createUser("foreign");
const cookieA = await login(userA);
const cookieB = await login(userB);
assert.equal((await api("/api/monitors/financial")).status, 401);
assert.equal((await api("/api/monitors/financial/alerts")).status, 401);

const fixtureAnalyses = [
  fixtureAnalysis("AAPL 2026 Q3 10-Q"),
  fixtureAnalysis("AAPL 2025 10-K"),
  fixtureAnalysis("WIX 2025 20-F US-GAAP FPI"),
];
const tdAnalysis = await officialTd40FAnalysis();
const analyses = [...fixtureAnalyses, tdAnalysis];
const cases = [];
const seededRecords: Array<{ analysis: (typeof analyses)[number]; seeded: Awaited<ReturnType<typeof seedCanonicalOutput>> }> = [];
let resolverOrLlmCalls = 0;

for (const analysis of analyses) {
  const revenue = analysis.comparisons.find((row) => row.metric === "REVENUE" && row.change.status === "AVAILABLE");
  assert.ok(revenue, `${analysis.filing?.form} revenue comparison required`);
  if (revenue.change.status !== "AVAILABLE") throw new Error("Revenue YoY change is unavailable");
  const basis = revenue.basis.toLowerCase();
  const conditions = [{
    key: `financial.revenue.${basis}.yoy_change`,
    operator: revenue.change.absoluteChange.startsWith("-") ? "lt" : "gt",
    value: "0",
    currency: revenue.current.currency,
  }];
  const preview = await api("/api/monitors/financial/validate", { method: "POST", cookie: cookieA, body: { conditions } });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const created = await api("/api/monitors/financial", { method: "POST", cookie: cookieA, body: { conditions } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const monitorId = created.body.data.monitor.id as string;
  const seeded = await seedCanonicalOutput(analysis);
  seededRecords.push({ analysis, seeded });
  const replayDependencies = {
    repository: { claim: async () => false } as never,
    resolveAnalysis: async () => { resolverOrLlmCalls += 1; throw new Error("completed replay must not resolve"); },
  };
  const [first, concurrent] = await Promise.all([
    processPeriodicFinancialMonitorChild(seeded.identity, replayDependencies),
    processPeriodicFinancialMonitorChild(seeded.identity, replayDependencies),
  ]);
  const replay = await processPeriodicFinancialMonitorChild(seeded.identity, replayDependencies);
  const firstAlerts = requireConsumer(first.financialMonitorAlerts);
  const concurrentAlerts = requireConsumer(concurrent.financialMonitorAlerts);
  const replayAlerts = requireConsumer(replay.financialMonitorAlerts);
  assert.equal(firstAlerts.evaluations.find((row) => row.monitorId === monitorId)?.status, "match");
  assert.equal(concurrentAlerts.evaluations.find((row) => row.monitorId === monitorId)?.status, "match");
  assert.equal(replayAlerts.evaluations.find((row) => row.monitorId === monitorId)?.status, "match");
  const count = await db.query("select count(*)::int as count from public.user_alert_deliveries where financial_monitor_id=$1 and alert_event_id=$2", [monitorId, seeded.eventId]);
  assert.equal(count.rows[0].count, 1);
  const alertsA = await api(`/api/monitors/financial/alerts?monitorId=${monitorId}`, { cookie: cookieA });
  const alertsB = await api(`/api/monitors/financial/alerts?monitorId=${monitorId}`, { cookie: cookieB });
  assert.equal(alertsA.status, 200);
  assert.equal(alertsA.body.data.alerts.length, 1);
  assert.equal(alertsA.body.data.alerts[0].eventId, seeded.eventId);
  assert.equal(alertsA.body.data.alerts[0].accession, analysis.targetAccession);
  assert.equal(alertsB.status, 200);
  assert.equal(alertsB.body.data.alerts.length, 0);
  cases.push({
    form: analysis.filing?.form,
    accession: analysis.targetAccession,
    issuerCik: analysis.issuerCik,
    eventId: seeded.eventId,
    sourceExecutionId: seeded.executionId,
    monitorId,
    current: revenue.current.normalizedValue,
    prior: revenue.priorYear?.normalizedValue,
    change: revenue.change.absoluteChange,
    currency: revenue.current.currency,
    period: revenue.current.period,
    sources: [...new Set(revenue.current.filingFacts.map((fact) => `${fact.source.sourceUrl}#sha256=${fact.source.contentHash}`))],
    alertRows: 1,
  });
}

const invalidCondition = await api("/api/monitors/financial", {
  method: "POST", cookie: cookieA,
  body: { conditions: [{ key: "financial.revenue.annual.current", operator: "gt", value: 1, currency: "USD" }] },
});
assert.equal(invalidCondition.status, 422);
const crossOrigin = await api("/api/monitors/financial", {
  method: "POST", cookie: cookieA, origin: "https://foreign.example",
  body: { conditions: [{ key: "financial.revenue.annual.current", operator: "gt", value: "0", currency: "USD" }] },
});
assert.equal(crossOrigin.status, 403);

const ownerList = await api("/api/monitors/financial", { cookie: cookieA });
const foreignList = await api("/api/monitors/financial", { cookie: cookieB });
assert.equal(ownerList.body.data.monitors.length, 4);
assert.equal(foreignList.body.data.monitors.length, 0);
const persistedFailClosed = await verifyPersistedFailClosed(cookieA, seededRecords);
const directRls = await verifyDirectRls(userA, userB);
const planRows = await db.query("select user_id,plan,status from public.user_plan_subscriptions where user_id in ($1,$2)", [userA.id, userB.id]);

console.log(JSON.stringify({
  status: "PASS",
  isolation: { projectId: "stock-radar-financial-581e-20260910-a", apiPort: 58131, dbPort: Number(dbPort), appPort: 3111, sharedPortsTouched: false },
  authOwnershipPlan: { loggedOut: 401, ownerMonitorCount: (await api("/api/monitors/financial", { cookie: cookieA })).body.data.monitors.length, foreignMonitorCount: 0, foreignAlertCount: 0, directRls, subscriptions: planRows.rows },
  forms: cases,
  persistedFailClosed,
  replayAndConcurrency: { expectedRowsPerMonitorEvent: 1, observed: cases.every((row) => row.alertRows === 1) },
  runtimeLlmCalls: resolverOrLlmCalls,
  retainedForAudit: true,
}, null, 2));
await db.end();

function fixtureAnalysis(label: string) {
  const audited = periodicFinancialAuditSample(label);
  return buildPeriodicFinancialMonitorAnalysis(resolvePeriodicFinancials({ issuerCik: audited.cik, targetAccession: audited.accession, ...preparePeriodicFinancialAuditSample(audited) }));
}

async function officialTd40FAnalysis() {
  const cik = "0000947263", accession = "0001562762-25-000289";
  const userAgent = process.env.SEC_USER_AGENT || "US-Stock-Radar official-source audit engineering@openai.com";
  const now = () => new Date();
  const policy = new SecRequestPolicy(userAgent, { minimumIntervalMs: 125 });
  const structured = new SecStructuredHttpClient(userAgent, 125, fetch, now, policy);
  const filingClient = new SecFilingXbrlHttpClient(userAgent, fetch, now, 125, policy);
  const [submissions, companyFacts] = await Promise.all([
    structured.fetchSubmissions(cik, "incremental"),
    structured.fetchCompanyFacts(cik, "incremental"),
  ]);
  const normalized = normalizeSecStructuredDocuments([...submissions, companyFacts], new Date().toISOString());
  const filing = normalized.filings.find((row) => row.accessionNumber === accession);
  assert.ok(filing && filing.form === "40-F");
  const fetched = await filingClient.fetchFilingArtifacts(filing);
  if (fetched.status !== "AVAILABLE") throw new Error(fetched.detail);
  const parsed = parseSecFilingXbrlArtifacts(fetched.artifacts);
  if (parsed.status !== "AVAILABLE") throw new Error(parsed.detail);
  const expectedHashes = new Set([
    "4f4c6b0bac6ddf871f0f357d3b2e2820c311ccb34fc4200c0e46a3ac0030956a",
    "128ebfe20c9f44c416ceb07799ce08a4be99a99a2c0aae98461f0178488054a7",
    "29e0d779f65e26d355a7a43bf114f70c957666bdc21602cba689381fb2117e69",
  ]);
  assert.equal(fetched.artifacts.filter((row) => expectedHashes.has(row.contentHash)).length, 3);
  return buildPeriodicFinancialMonitorAnalysis(resolvePeriodicFinancials({
    issuerCik: cik, targetAccession: accession, filings: normalized.filings,
    companyFacts: normalized.facts, filingXbrl: parsed,
  }));
}

async function seedCanonicalOutput(analysis: ReturnType<typeof fixtureAnalysis>) {
  const rawItemId = randomUUID(), eventId = randomUUID(), parentPrimaryAiRunId = randomUUID();
  const now = new Date().toISOString();
  const childIdentity = buildPeriodicFinancialMonitorChildIdentity({
    primary: {
      eventId, rawItemId, sourceFamily: "sec_periodic_reports", sourceGroup: "filings",
      sourceCode: "sec_edgar", sourceIdentity: analysis.targetAccession,
      parentPrimaryAiRunId, parentPromptKey: "sec_periodic_reports_analysis", parentPromptVersion: "v13-40f",
    }, now,
  });
  const executionId = childIdentity.executionId;
  await db.query(`insert into public.raw_items (id,source_code,source_group,source_unique_id,source_url,title,raw_payload,metadata,dedupe_key)
    values ($1,'sec_edgar','filings',$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [
    rawItemId, analysis.targetAccession, analysis.filing?.primaryDocument || "", `${analysis.filing?.form} actual SEC fixture`,
    JSON.stringify({ accession_number: analysis.targetAccession, cik: analysis.issuerCik, form_type: analysis.filing?.form }),
    JSON.stringify({ cik: analysis.issuerCik, formType: analysis.filing?.form }), `financial-e2e-raw-${rawItemId}`,
  ]);
  await db.query(`insert into public.events (id,raw_item_id,source_code,source_group,source_url,published_at,ticker,event_type,score,delivery_level,impact,signal,title,group_dedupe_key)
    values ($1,$2,'sec_edgar','filings',$3,$4,null,'earnings',50,'feed','medium','neutral',$5,$6)`, [
    eventId, rawItemId, analysis.filing?.primaryDocument || "", analysis.filing?.acceptedAt || now,
    `${analysis.filing?.form} actual SEC fixture`, `financial-e2e-event-${eventId}`,
  ]);
  const metadata = {
    child_schema_version: "generic_monitor_child_execution_v1", monitor_analyzer_key: "periodic_financial",
    analyzer_contract_version: "periodic_financial_monitor_v1", execution_id: executionId,
    event_id: eventId, raw_item_id: rawItemId, source_identity: analysis.targetAccession,
  };
  await db.query(`insert into public.ai_runs (id,event_id,raw_item_id,prompt_key,prompt_version,model,status,started_at,finished_at,metadata)
    values ($1,$2,$3,'domain_monitor_child','periodic_financial_monitor_v1','deterministic','completed',$4,$4,$5::jsonb)`,
    [executionId, eventId, rawItemId, now, JSON.stringify(metadata)]);
  await db.query(`insert into public.ai_outputs (ai_run_id,event_id,output_type,payload)
    values ($1,$2,'domain_monitor_child_execution_result',$3::jsonb)`, [executionId, eventId, JSON.stringify({
      schema_version: "generic_monitor_child_execution_result_v1", execution_id: executionId,
      monitor_analyzer_key: "periodic_financial", result_classification: "succeeded_applicable", analysis,
    })]);
  return { rawItemId, eventId, executionId, identity: childIdentity };
}

async function createUser(label: string) {
  const email = `financial-e2e-${label}-${randomUUID()}@example.test`, password = `Financial-${randomUUID()}-aA1!`;
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST", headers: serviceHeaders(), body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return { id: body.id as string, email, password };
}
async function login(user: { email: string; password: string }) {
  const response = await fetch(`${appOrigin}/api/auth/login`, { method: "POST", headers: { Origin: appOrigin, "Content-Type": "application/json" }, body: JSON.stringify(user) });
  assert.equal(response.status, 200, await response.text());
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  return cookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}
async function api(path: string, options: { method?: string; cookie?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.method && options.method !== "GET") { headers.Origin = options.origin || appOrigin; headers["Content-Type"] = "application/json"; }
  const response = await fetch(`${appOrigin}${path}`, { method: options.method || "GET", headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
  return { status: response.status, body: await response.json().catch(() => null) };
}
function serviceHeaders() { return { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" }; }
function requireConsumer(value: Awaited<ReturnType<typeof processPeriodicFinancialMonitorChild>>["financialMonitorAlerts"]) {
  assert.ok(value && "evaluations" in value, JSON.stringify(value));
  return value;
}

async function verifyPersistedFailClosed(
  cookie: string,
  records: Array<{ analysis: (typeof analyses)[number]; seeded: Awaited<ReturnType<typeof seedCanonicalOutput>> }>,
) {
  const annual = records.find((row) => row.analysis.filing?.form === "10-K")!;
  const quarterly = records.find((row) => row.analysis.filing?.form === "10-Q")!;
  const annualOutput = await db.query("select payload from public.ai_outputs where ai_run_id=$1", [annual.seeded.executionId]);
  const originalPayload = structuredClone(annualOutput.rows[0].payload);
  const results: Record<string, boolean> = {};
  const run = async (name: string, conditions: unknown[], mutate?: (analysis: ReturnType<typeof fixtureAnalysis>) => void) => {
    const created = await api("/api/monitors/financial", { method: "POST", cookie, body: { conditions } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const monitorId = created.body.data.monitor.id as string;
    if (mutate) {
      const payload = structuredClone(originalPayload);
      mutate(payload.analysis);
      await db.query("update public.ai_outputs set payload=$2::jsonb where ai_run_id=$1", [annual.seeded.executionId, JSON.stringify(payload)]);
    }
    await processPeriodicFinancialMonitorChild(annual.seeded.identity, { repository: { claim: async () => false } as never });
    const count = await db.query("select count(*)::int as count from public.user_alert_deliveries where financial_monitor_id=$1 and alert_event_id=$2", [monitorId, annual.seeded.eventId]);
    results[name] = count.rows[0].count === 0;
    assert.equal(results[name], true, name);
    await db.query("update public.ai_outputs set payload=$2::jsonb where ai_run_id=$1", [annual.seeded.executionId, JSON.stringify(originalPayload)]);
  };

  await run("current_provenance_mismatch", [{ key: "financial.revenue.annual.current", operator: "gt", value: "0", currency: "USD" }], (analysis) => {
    analysis.comparisons.find((row) => row.metric === "REVENUE")!.current.companyFacts[0]!.unit = "CAD";
  });
  await run("tampered_yoy_delta", [{ key: "financial.revenue.annual.yoy_change", operator: "eq", value: "999999999999", currency: "USD" }], (analysis) => {
    const revenue = analysis.comparisons.find((row) => row.metric === "REVENUE")!;
    if (revenue.change.status === "AVAILABLE") revenue.change.absoluteChange = "999999999999";
  });
  await run("duration_pair_outside_resolver_contract", [{ key: "financial.revenue.annual.yoy_change", operator: "gt", value: "0", currency: "USD" }], (analysis) => {
    const prior = analysis.comparisons.find((row) => row.metric === "REVENUE")!.priorYear!;
    if (prior.period.kind !== "duration") throw new Error("duration expected");
    const shifted = new Date(`${prior.period.startDate}T00:00:00Z`);
    shifted.setUTCDate(shifted.getUTCDate() + 10);
    prior.period.startDate = shifted.toISOString().slice(0, 10);
    prior.filingFacts.forEach((fact) => { if (fact.context.period.kind === "duration") fact.context.period.startDate = prior.period.kind === "duration" ? prior.period.startDate : ""; });
    prior.companyFacts.forEach((fact) => { fact.startDate = prior.period.kind === "duration" ? prior.period.startDate : null; });
  });
  await run("currency_mismatch", [{ key: "financial.revenue.annual.current", operator: "gt", value: "0", currency: "CAD" }]);

  const unavailable = await api("/api/monitors/financial", {
    method: "POST", cookie,
    body: { conditions: [{ key: "financial.cash.instant.yoy_change", operator: "gt", value: "0", currency: "USD" }] },
  });
  assert.equal(unavailable.status, 201);
  await processPeriodicFinancialMonitorChild(quarterly.seeded.identity, { repository: { claim: async () => false } as never });
  const unavailableCount = await db.query("select count(*)::int as count from public.user_alert_deliveries where financial_monitor_id=$1 and alert_event_id=$2", [unavailable.body.data.monitor.id, quarterly.seeded.eventId]);
  results.prior_year_unavailable = unavailableCount.rows[0].count === 0;
  assert.equal(results.prior_year_unavailable, true);

  const identityMonitor = await api("/api/monitors/financial", {
    method: "POST", cookie,
    body: { conditions: [{ key: "financial.revenue.annual.current", operator: "gt", value: "0", currency: "USD" }] },
  });
  assert.equal(identityMonitor.status, 201);
  const raw = await db.query("select raw_payload from public.raw_items where id=$1", [annual.seeded.rawItemId]);
  const originalRawPayload = raw.rows[0].raw_payload;
  await db.query("update public.raw_items set raw_payload=raw_payload || '{\"issuer_cik\":\"0001628280\"}'::jsonb where id=$1", [annual.seeded.rawItemId]);
  await processPeriodicFinancialMonitorChild(annual.seeded.identity, { repository: { claim: async () => false } as never });
  const identityCount = await db.query("select count(*)::int as count from public.user_alert_deliveries where financial_monitor_id=$1 and alert_event_id=$2", [identityMonitor.body.data.monitor.id, annual.seeded.eventId]);
  results.raw_cik_conflict = identityCount.rows[0].count === 0;
  assert.equal(results.raw_cik_conflict, true);
  await db.query("update public.raw_items set raw_payload=$2::jsonb where id=$1", [annual.seeded.rawItemId, JSON.stringify(originalRawPayload)]);
  return results;
}

async function verifyDirectRls(
  owner: { email: string; password: string },
  foreign: { email: string; password: string },
) {
  const ownerToken = await supabaseLogin(owner);
  const foreignToken = await supabaseLogin(foreign);
  const select = async (token: string) => {
    const response = await fetch(`${apiUrl}/rest/v1/financial_monitors?select=id,user_id`, { headers: { apikey: publishableKey, Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    return await response.json() as Array<{ id: string; user_id: string }>;
  };
  const ownerRows = await select(ownerToken);
  const foreignRows = await select(foreignToken);
  assert.ok(ownerRows.length >= 4 && ownerRows.every((row) => row.user_id === userA.id));
  assert.equal(foreignRows.length, 0);
  const anon = await fetch(`${apiUrl}/rest/v1/financial_monitors?select=id`, { headers: { apikey: publishableKey } });
  assert.ok(anon.status === 401 || (anon.status === 200 && (await anon.json()).length === 0));
  return { ownerRows: ownerRows.length, foreignRows: 0, anonymousDeniedOrEmpty: true };
}

async function supabaseLogin(user: { email: string; password: string }) {
  const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: publishableKey, "Content-Type": "application/json" }, body: JSON.stringify(user),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body.access_token as string;
}

async function cleanPreviousIsolatedRun() {
  const accessions = [
    "0000320193-26-000020",
    "0000320193-25-000079",
    "0001628280-26-015222",
    "0001562762-25-000289",
  ];
  await db.query("delete from auth.users where email like 'financial-e2e-%@example.test'");
  const raw = await db.query("select id from public.raw_items where source_code='sec_edgar' and source_unique_id=any($1::text[])", [accessions]);
  const rawIds = raw.rows.map((row: { id: string }) => row.id);
  if (rawIds.length === 0) return;
  await db.query("delete from public.user_alert_deliveries where financial_source_execution_id in (select id from public.ai_runs where raw_item_id=any($1::uuid[]))", [rawIds]);
  await db.query("delete from public.ai_outputs where ai_run_id in (select id from public.ai_runs where raw_item_id=any($1::uuid[]))", [rawIds]);
  await db.query("delete from public.ai_runs where raw_item_id=any($1::uuid[])", [rawIds]);
  await db.query("delete from public.events where raw_item_id=any($1::uuid[])", [rawIds]);
  await db.query("delete from public.raw_items where id=any($1::uuid[])", [rawIds]);
}
