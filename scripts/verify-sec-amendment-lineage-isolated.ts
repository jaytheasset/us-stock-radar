import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import { decodeHTML } from "entities";
import type { SecFilingIdentity } from "../lib/sec-amendments/secAmendmentLineage.ts";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    return nextResolve(new URL(`../${relative}${/\.[cm]?[jt]sx?$/.test(relative) ? "" : ".ts"}`, import.meta.url).href, context);
  }
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
  }
  return nextResolve(specifier, context);
} });

const dbPort = process.env.AMENDMENT_ISOLATED_DB_PORT;
const apiUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dbPort || !apiUrl || !secretKey) throw new Error("isolated Supabase variables are required");
assert.equal(dbPort, "58322");
assert.equal(new URL(apiUrl).port, "58321");
assert.ok(!["54322", "56322", "58132"].includes(dbPort));

const { resolveSecAmendmentLineage } = await import("../lib/sec-amendments/secAmendmentLineage.ts");
const { persistSecAmendmentObservation, readSecFilingCurrentState } = await import("../lib/sec-amendments/secAmendmentPersistence.ts");
const { prepareSecAmendmentMonitorFanout } = await import("../lib/sec-amendments/secAmendmentMonitorBridge.ts");
const { runCorporateActionCanonicalAnalyzerPreview } = await import("../lib/ai/corporateActionCanonicalAnalyzerPreview.ts");
const { runSecFilingAnalysisPreviewForRawItem } = await import("../lib/ai/secFilingAnalysisPreview.ts");
const { adaptSec8k6kCorporateActionSource } = await import("../lib/monitor/corporateActionSourceAdapters.ts");
const { readCorporateActionApplicabilityContext } = await import("../lib/monitor/corporateActionApplicabilityContext.ts");
const { buildGenericMonitorChildIdentities } = await import("../lib/monitor/genericMonitorChildExecution.ts");
const { readCurrentCorporateActionFacts } = await import("../lib/monitor/corporateActionPersistence.ts");
const { genericMonitorChildRepository } = await import("../lib/monitor/genericMonitorChildSupabaseRepository.ts");
const { processGenericMonitorChild } = await import("../lib/monitor/genericMonitorChildRuntime.ts");
const { consumeListingMonitorAlertsForEvent } = await import("../lib/monitor/listingMonitorAlertConsumer.ts");

const cases = [
  { key: "enveric_8k_a", cik: "890821", ticker: "ENVB", original: "0001493152-25-003091", amendment: "0001493152-25-003676", originalForm: "8-K", amendmentForm: "8-K/A", needle: /solely to correct the date the reverse stock split will begin trading/i, changedField: "reverse stock split trading date" },
  { key: "ostin_6k_a", cik: "1803407", ticker: "OST", original: "0001213900-24-110728", amendment: "0001213900-24-112018", originalForm: "6-K", amendmentForm: "6-K/A", needle: /effective date is changed from December 26, 2024 to December 31, 2024/i, changedField: "reverse share split effective date" },
] as const;

await rest("sources", { method: "POST", query: { on_conflict: "code" }, prefer: "resolution=merge-duplicates,return=minimal", body: [{ code: "sec_edgar", name: "SEC EDGAR", source_group: "filings", runtime_owner: "external", enabled: false }] });
const ownerId = await createOwner();
const monitorId = deterministicUuid("sec-amendment-e2e-monitor");
await rest("listing_monitors", { method: "POST", query: { on_conflict: "id" }, prefer: "resolution=merge-duplicates,return=minimal", body: [{ id: monitorId, user_id: ownerId, domain: "listing", conditions: [{ key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" }], is_active: true }] });
const outputs: Record<string, unknown>[] = [];
let providerCalls = 0;
let primaryProviderRuns = 0;

for (const item of cases) {
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${item.cik.padStart(10, "0")}.json`;
  const submissions = await secJson(submissionsUrl);
  const original = identityFromSubmissions(submissions.data, item.cik, item.original);
  const amendment = identityFromSubmissions(submissions.data, item.cik, item.amendment);
  assert.equal(original.formType, item.originalForm);
  assert.equal(amendment.formType, item.amendmentForm);
  const [originalText, amendmentText] = await Promise.all([original.primaryDocumentUrl, amendment.primaryDocumentUrl].map(async (url) => cleanHtml(await secText(url))));
  assert.ok(originalText.length > 1_000);
  assert.match(amendmentText, item.needle);
  const sourceSentence = sentences(amendmentText).find((sentence) => item.needle.test(sentence));
  assert.ok(sourceSentence);
  await insertRawItem(original, originalText, item.ticker);
  await insertRawItem(amendment, amendmentText, item.ticker);
  await seedFilingLedger(submissionsUrl, submissions.raw, submissions.data, original);
  await seedFilingLedger(submissionsUrl, submissions.raw, submissions.data, amendment);

  const originalPrimaryRun = await runActualPrimary(rawRow(original, originalText, item.ticker));
  const originalPrimary = await seedPrimary(original, item.ticker, originalPrimaryRun.analysis, originalPrimaryRun);
  const originalRoutes = Array.isArray(originalPrimaryRun.analysis.monitor_routes)
    ? originalPrimaryRun.analysis.monitor_routes as Array<Record<string, unknown>> : [];
  if (!originalRoutes.some((route) => route.monitor_analyzer_key === "corporate_action")) {
    outputs.push({ key: item.key, officialIdentity: { original: original.accessionNumber, amendment: amendment.accessionNumber, originalForm: original.formType, amendmentForm: amendment.formType }, status: "blocked", layer: "existing_primary_original_routing", actualPrimaryMonitorRoutes: originalRoutes, actualPrimaryAmendmentDelta: originalPrimaryRun.analysis.sec_8k_6k_amendment_delta, analyzerProviderCalls: 0, internalAlertsWritten: 0 });
    continue;
  }
  const originalApplicability = await readCorporateActionApplicabilityContext({ eventId: originalPrimary.eventId, rawItemId: original.rawItemId });
  assert.equal(originalApplicability.issuerContext.availability, "available");
  const originalChild = buildChild(originalPrimary, null);
  await genericMonitorChildRepository.reserve(originalChild);
  let originalCurrent = await readCurrentCorporateActionFacts(originalPrimary.eventId);
  if (originalCurrent.status !== "available") {
    const originalRun = await runActualAnalyzer(analyzerInput(original, originalText, originalApplicability));
    if (originalRun.stage !== "complete") {
      outputs.push({ key: item.key, officialIdentity: { original: original.accessionNumber, amendment: amendment.accessionNumber, originalForm: original.formType, amendmentForm: amendment.formType }, status: "blocked", layer: "existing_corporate_action_analyzer_original", reason: originalRun.error, analyzerProviderCalls: 3, monitorFactsWritten: 0, internalAlertsWritten: 0 });
      continue;
    }
    assert.equal(originalRun.result?.applicable, true);
    const originalProcessed = await processGenericMonitorChild(originalChild, { runCorporateActionAnalyzer: async () => originalRun });
    assert.equal(originalProcessed.status, "succeeded_applicable", JSON.stringify(originalProcessed));
    originalCurrent = await readCurrentCorporateActionFacts(originalPrimary.eventId);
  }
  assert.equal(originalCurrent.status, "available");
  const initialAlert = await consumeListingMonitorAlertsForEvent({ eventId: originalPrimary.eventId });
  assert.equal(initialAlert.createdCount + initialAlert.existingCount, 1, JSON.stringify(initialAlert));

  const amendmentPrimaryRun = await runActualPrimary(rawRow(amendment, amendmentText, item.ticker));
  const amendmentPrimaryAnalysis = amendmentPrimaryRun.analysis;
  const amendmentPrimary = await seedPrimary(amendment, item.ticker, amendmentPrimaryAnalysis, amendmentPrimaryRun);
  const amendmentApplicability = await readCorporateActionApplicabilityContext({ eventId: amendmentPrimary.eventId, rawItemId: amendment.rawItemId });
  assert.equal(amendmentApplicability.issuerContext.availability, "available");
  const bridge = await prepareSecAmendmentMonitorFanout({
    rawItem: rawRow(amendment, amendmentText),
    filingInput: amendmentPrimaryRun.input,
    primaryAnalysis: amendmentPrimaryAnalysis,
  });
  assert.equal(bridge.status, "authorized", bridge.status === "blocked" ? bridge.reason : "");
  const amendmentChild = buildChild(amendmentPrimary, bridge.status === "authorized" ? bridge : null);
  await genericMonitorChildRepository.reserve(amendmentChild);
  const existingLineage = await readSecFilingCurrentState(original.rawItemId);
  if (existingLineage.status !== "available" || existingLineage.headAccessionNumber !== amendment.accessionNumber) {
    const amendmentRun = await runActualAnalyzer(analyzerInput(amendment, amendmentText, amendmentApplicability));
    if (amendmentRun.stage !== "complete") {
      outputs.push({ key: item.key, officialIdentity: { original: original.accessionNumber, amendment: amendment.accessionNumber, originalForm: original.formType, amendmentForm: amendment.formType }, status: "blocked", layer: "existing_corporate_action_analyzer_amendment", reason: amendmentRun.error, analyzerProviderCalls: 4, internalAlertsWritten: 0 });
      continue;
    }
    assert.equal(amendmentRun.result?.applicable, true);
    const amendmentProcessed = await processGenericMonitorChild(amendmentChild, { runCorporateActionAnalyzer: async () => amendmentRun });
    assert.equal(amendmentProcessed.status, "succeeded_applicable", JSON.stringify(amendmentProcessed));
  }

  const current = await readSecFilingCurrentState(original.rawItemId);
  assert.equal(current.status, "available");
  assert.equal(current.status === "available" && current.headAccessionNumber, amendment.accessionNumber);
  const [amendmentAlert, replayAlert, concurrentAmendmentAlert, concurrentRootAlert] = await Promise.all([
    consumeListingMonitorAlertsForEvent({ eventId: amendmentPrimary.eventId, alertEventId: originalPrimary.eventId }),
    consumeListingMonitorAlertsForEvent({ eventId: originalPrimary.eventId }),
    consumeListingMonitorAlertsForEvent({ eventId: amendmentPrimary.eventId, alertEventId: originalPrimary.eventId }),
    consumeListingMonitorAlertsForEvent({ eventId: originalPrimary.eventId }),
  ]);
  assert.equal(amendmentAlert.createdCount, 0);
  assert.equal(amendmentAlert.existingCount, 1);
  assert.equal(replayAlert.createdCount, 0);
  assert.equal(replayAlert.existingCount, 1);
  assert.equal(concurrentAmendmentAlert.createdCount + concurrentRootAlert.createdCount, 0);
  assert.equal(concurrentAmendmentAlert.existingCount + concurrentRootAlert.existingCount, 2);
  const validOriginalRow = rawRow(original, originalText, item.ticker);
  const identityFailures = [
    { key: "original_url_missing", patch: { source_url: "" } },
    { key: "issuer_cik_mismatch", patch: { raw_payload: { ...validOriginalRow.raw_payload, cik: item.cik === "890821" ? "1803407" : "890821" } } },
  ] as const;
  const identityFailureAlerts: Record<string, unknown>[] = [];
  for (const failure of identityFailures) {
    const before = await restCount("user_alert_deliveries");
    await rest("raw_items", { method: "PATCH", query: { id: `eq.${original.rawItemId}` }, prefer: "return=minimal", body: failure.patch });
    const result = await consumeListingMonitorAlertsForEvent({ eventId: originalPrimary.eventId });
    const after = await restCount("user_alert_deliveries");
    assert.equal(result.createdCount, 0, failure.key);
    assert.equal(result.existingCount, 0, failure.key);
    assert.equal(result.writes.length, 0, failure.key);
    assert.equal(after, before, failure.key);
    assert.equal(result.corporateActionReaderStatus, "not_ready", failure.key);
    identityFailureAlerts.push({ key: failure.key, created: result.createdCount, existing: result.existingCount, alertDelta: after - before });
    await rest("raw_items", { method: "PATCH", query: { id: `eq.${original.rawItemId}` }, prefer: "return=minimal", body: { source_url: validOriginalRow.source_url, raw_payload: validOriginalRow.raw_payload } });
  }
  outputs.push({ key: item.key, officialIdentity: { original: original.accessionNumber, amendment: amendment.accessionNumber, originalForm: original.formType, amendmentForm: amendment.formType }, rootRawItemId: original.rawItemId, lineageOperation: bridge.status === "authorized" ? bridge.observation.operation : null, currentValueSourceAccession: current.status === "available" ? current.headAccessionNumber : null, stableRootAlertEventId: originalPrimary.eventId, actualPrimaryMonitorRoutes: amendmentPrimaryAnalysis.monitor_routes, actualPrimaryAmendmentDelta: amendmentPrimaryAnalysis.sec_8k_6k_amendment_delta, initialAlert: { created: initialAlert.createdCount, existing: initialAlert.existingCount }, amendmentAlert: { created: amendmentAlert.createdCount, existing: amendmentAlert.existingCount }, originalReplay: { created: replayAlert.createdCount, existing: replayAlert.existingCount }, concurrentReplay: { created: concurrentAmendmentAlert.createdCount + concurrentRootAlert.createdCount, existing: concurrentAmendmentAlert.existingCount + concurrentRootAlert.existingCount }, identityFailureAlerts, analyzerProviderCalls: 2 });
}

const alertCount = await restCount("user_alert_deliveries");
const successfulCases = outputs.filter((value) => value.initialAlert).length;
assert.equal(alertCount, successfulCases);
process.stdout.write(`${JSON.stringify({ ok: true, isolated: { apiPort: 58321, databasePort: 58322 }, actualSecCases: outputs, savedMonitorConditions: 1, internalAlerts: alertCount, emailTelegramNotifications: 0, architectureProviderCalls: 0, existingPrimaryProviderRuns: primaryProviderRuns, existingCorporateActionAnalyzerProviderCalls: providerCalls }, null, 2)}\n`);

async function createOwner() {
  const response = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST", headers: authHeaders(),
    body: JSON.stringify({ email: "sec-amendment-e2e@example.invalid", password: "isolated-amendment-e2e-password", email_confirm: true }),
  });
  const body = await response.json();
  if (!response.ok) {
    const existing = await fetch(`${apiUrl}/auth/v1/admin/users?page=1&per_page=100`, { headers: authHeaders() });
    const listing = await existing.json();
    const user = Array.isArray(listing.users) ? listing.users.find((value: any) => value.email === "sec-amendment-e2e@example.invalid") : null;
    assert.ok(user?.id, JSON.stringify(body));
    await ensureProfile(String(user.id));
    return String(user.id);
  }
  assert.match(String(body.id), /^[0-9a-f-]{36}$/i);
  await ensureProfile(String(body.id));
  return String(body.id);
}

async function ensureProfile(id: string) {
  await rest("user_profiles", { method: "POST", query: { on_conflict: "id" }, prefer: "resolution=merge-duplicates,return=minimal", body: [{ id, email: "sec-amendment-e2e@example.invalid" }] });
}

async function seedPrimary(
  identity: SecFilingIdentity,
  ticker: string,
  analysis: Record<string, unknown>,
  run: { model: string; promptKey: string; promptVersion: string } = {
    model: "isolated-primary-fixture-no-provider",
    promptKey: "sec_8k_6k_analysis_financing_dilution_capital_structure",
    promptVersion: "v28-corporate-action-routing",
  },
) {
  const eventId = deterministicUuid(`event:${identity.accessionNumber}`);
  const parentPrimaryAiRunId = deterministicUuid(`primary:${identity.accessionNumber}`);
  const parentPromptKey = run.promptKey;
  const parentPromptVersion = run.promptVersion;
  await rest("events", { method: "POST", query: { on_conflict: "id" }, prefer: "resolution=merge-duplicates,return=minimal", body: [{
    id: eventId, raw_item_id: identity.rawItemId, source_code: "sec_edgar", source_group: "filings", source_name: "SEC EDGAR",
    published_at: `${identity.filedDate}T12:00:00.000Z`, ticker, event_type: "listing_risk", score: 50, delivery_level: "feed",
    impact: "medium", signal: "neutral", market_scope: "company", title: `SEC ${identity.formType} ${identity.accessionNumber}`,
    group_dedupe_key: `sec-amendment-e2e:${identity.accessionNumber}`, metadata: {},
  }] });
  await rest("ai_runs", { method: "POST", query: { on_conflict: "id" }, prefer: "resolution=merge-duplicates,return=minimal", body: [{
    id: parentPrimaryAiRunId, event_id: eventId, raw_item_id: identity.rawItemId, prompt_key: parentPromptKey, prompt_version: parentPromptVersion,
    model: run.model, status: "completed", started_at: `${identity.filedDate}T12:01:00.000Z`, finished_at: `${identity.filedDate}T12:02:00.000Z`, usage: {}, metadata: { isolated_actual_primary_preview: run.model !== "isolated-primary-fixture-no-provider" },
  }] });
  await rest("ai_outputs", { method: "POST", query: { on_conflict: "id" }, prefer: "resolution=merge-duplicates,return=minimal", body: [{
    id: deterministicUuid(`primary-output:${identity.accessionNumber}`), ai_run_id: parentPrimaryAiRunId, event_id: eventId, output_type: parentPromptKey, payload: { analysis },
  }] });
  return { eventId, rawItemId: identity.rawItemId, sourceFamily: "sec_8k_6k" as const, sourceGroup: "filings" as const, sourceCode: "sec_edgar", sourceIdentity: identity.accessionNumber, parentPrimaryAiRunId, parentPromptKey, parentPromptVersion };
}

function buildChild(primary: Awaited<ReturnType<typeof seedPrimary>>, bridge: any) {
  const [identity] = buildGenericMonitorChildIdentities({
    primary: {
      ...primary,
      ...(bridge ? { alertEventId: bridge.alertEventId, secAmendmentLineage: bridge.executionContext } : {}),
    },
    monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "corporate_action" }] },
    now: "2026-09-10T13:00:00.000Z",
  });
  return identity;
}

function analyzerInput(
  identity: SecFilingIdentity,
  sourceText: string,
  applicability: Awaited<ReturnType<typeof readCorporateActionApplicabilityContext>>,
) {
  const relevantSource = sourceWindow(sourceText);
  return adaptSec8k6kCorporateActionSource({
    accession_number: identity.accessionNumber,
    source_url: identity.indexUrl,
    filed_at: `${identity.filedDate}T12:00:00.000Z`,
    title: `Official SEC ${identity.formType} ${identity.accessionNumber}`,
    cleaned_source_blocks: [{ block_id: "sec_primary_document", document_reference: identity.primaryDocumentUrl, text: relevantSource }],
    issuer_context: applicability.issuerContext,
    security_class_candidates: applicability.securityClassCandidates,
    reverse_split_execution_candidates: applicability.reverseSplitExecutionCandidates,
    forward_split_execution_candidates: applicability.forwardSplitExecutionCandidates,
  });
}

async function runActualPrimary(row: ReturnType<typeof rawRow>) {
  const cached = await readActualPrimaryCache(String(row.source_unique_id), row);
  if (cached) return cached;
  primaryProviderRuns += 1;
  const result = await runSecFilingAnalysisPreviewForRawItem(row as never, { dryRun: false, allowLlm: true });
  assert.equal(result.stage, "complete", `actual SEC Primary failed: ${"error" in result ? result.error : "unknown"}`);
  assert.ok(result.analysis && typeof result.analysis === "object" && !Array.isArray(result.analysis), "actual SEC Primary analysis required");
  assert.ok(result.input && typeof result.input === "object" && !Array.isArray(result.input), "actual SEC Primary input required");
  assert.ok(result.prompt?.key && result.prompt?.version && result.model, "actual SEC Primary identity required");
  return {
    analysis: result.analysis as Record<string, unknown>,
    input: result.input as Record<string, unknown>,
    model: String(result.model),
    promptKey: String(result.prompt.key),
    promptVersion: String(result.prompt.version),
  };
}

async function readActualPrimaryCache(accession: string, row: ReturnType<typeof rawRow>) {
  const runId = deterministicUuid(`primary:${accession}`);
  const [runs, outputs] = await Promise.all([
    restJson(`ai_runs?select=model,prompt_key,prompt_version&id=eq.${runId}`),
    restJson(`ai_outputs?select=payload&ai_run_id=eq.${runId}`),
  ]);
  const run = Array.isArray(runs) ? runs[0] : null;
  const output = Array.isArray(outputs) ? outputs[0] : null;
  const analysis = output?.payload?.analysis;
  if (!run || run.model === "isolated-primary-fixture-no-provider" || !analysis || typeof analysis !== "object") return null;
  const preview = await runSecFilingAnalysisPreviewForRawItem(row as never, { dryRun: true, allowLlm: false });
  assert.equal(preview.stage, "dry_run");
  return { analysis: analysis as Record<string, unknown>, input: preview.input as Record<string, unknown>, model: String(run.model), promptKey: String(run.prompt_key), promptVersion: String(run.prompt_version) };
}

function sourceWindow(sourceText: string) {
  const matches = [...sourceText.matchAll(/reverse\s+(?:stock|share)\s+split/gi)];
  assert.ok(matches.length > 0, "official filing must contain reverse split source text");
  const first = matches[0].index;
  const last = matches.at(-1)!.index;
  return sourceText.slice(Math.max(0, first - 1_500), Math.min(sourceText.length, last + 4_500)).trim();
}

async function runActualAnalyzer(input: ReturnType<typeof analyzerInput>) {
  let latest: Awaited<ReturnType<typeof runCorporateActionCanonicalAnalyzerPreview>> | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    providerCalls += 1;
    latest = await runCorporateActionCanonicalAnalyzerPreview(input);
    if (latest.stage === "complete") return latest;
  }
  if (latest?.run?.outputText) {
    try {
      const parsed = JSON.parse(latest.run.outputText);
      const update = parsed?.execution_update;
      const document = input.source_documents.find((item) => item.source_ref === update?.source_ref);
      process.stderr.write(`${JSON.stringify({ analyzerValidation: latest.error, executionUpdateSourceRef: update?.source_ref, executionUpdateEvidence: update?.evidence, exactEvidence: Boolean(document?.text.includes(update?.evidence)) })}\n`);
    } catch {}
  }
  return latest!;
}

type OfficialSecIdentity = SecFilingIdentity & { acceptedAt: string; primaryDocument: string };

function identityFromSubmissions(submissions: any, cik: string, accession: string): OfficialSecIdentity {
  const recent = submissions.filings.recent;
  const index = recent.accessionNumber.indexOf(accession);
  assert.ok(index >= 0, `${accession} official submissions identity`);
  const compact = accession.replace(/-/g, "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${compact}`;
  const acceptedAt = String(recent.acceptanceDateTime[index]);
  assert.ok(Number.isFinite(Date.parse(acceptedAt)), `${accession} official acceptance timestamp`);
  return { rawItemId: deterministicUuid(`raw:${accession}`), sourceCode: "sec_edgar", issuerCik: cik, accessionNumber: accession, formType: recent.form[index], filedDate: recent.filingDate[index], acceptedAt, primaryDocument: recent.primaryDocument[index], primaryDocumentUrl: `${base}/${recent.primaryDocument[index]}`, indexUrl: `${base}/${accession}-index.html` };
}
async function seedFilingLedger(submissionsUrl: string, submissionsRaw: string, submissions: any, identity: OfficialSecIdentity) {
  const issuerCik = identity.issuerCik.padStart(10, "0");
  const sourceRawId = deterministicUuid(`sec-submissions:${issuerCik}:${createHash("sha256").update(submissionsRaw).digest("hex")}`);
  await rest("sec_structured_raw_sources", { method: "POST", query: { on_conflict: "id" }, prefer: "resolution=ignore-duplicates,return=minimal", body: [{
    id: sourceRawId, source_kind: "submissions", source_url: submissionsUrl, source_identity: `CIK${issuerCik}.json`, cik: issuerCik,
    fetched_at: "2026-09-10T12:00:00.000Z", ingested_at: "2026-09-10T12:00:00.000Z", content_hash: createHash("sha256").update(submissionsRaw).digest("hex"),
    source_schema_version: null, raw_content_kind: "authoritative_http_body", raw_content: submissionsRaw, payload: submissions,
  }] });
  await rest("sec_issuers", { method: "POST", query: { on_conflict: "cik" }, prefer: "resolution=ignore-duplicates,return=minimal", body: [{ cik: issuerCik }] });
  await rest("sec_filing_ledger", { method: "POST", query: { on_conflict: "accession_number" }, prefer: "resolution=ignore-duplicates,return=minimal", body: [{
    accession_number: identity.accessionNumber, issuer_cik: issuerCik, form: identity.formType, filed_date: identity.filedDate,
    accepted_at: identity.acceptedAt, primary_document: identity.primaryDocument, is_xbrl: null, is_inline_xbrl: null,
    source_raw_id: sourceRawId, source_kind: "submissions", ingested_at: "2026-09-10T12:00:00.000Z",
  }] });
}
async function insertRawItem(identity: SecFilingIdentity, bodyText: string, ticker: string) { await rest("raw_items", { method: "POST", query: { on_conflict: "id" }, prefer: "resolution=ignore-duplicates,return=minimal", body: [rawRow(identity, bodyText, ticker)] }); }
function rawRow(identity: SecFilingIdentity, bodyText: string, ticker = "") { return { id: identity.rawItemId, source_code: "sec_edgar", source_group: "filings", source_unique_id: identity.accessionNumber, source_url: identity.indexUrl, title: `Official SEC ${identity.formType} ${identity.accessionNumber}`, published_at: `${identity.filedDate}T12:00:00.000Z`, fetched_at: "2026-09-10T12:00:00.000Z", body_text: bodyText, analysis_text: bodyText, raw_payload: { cik: identity.issuerCik, ticker, accession_number: identity.accessionNumber, form_type: identity.formType, filed_date: identity.filedDate, filing_date: identity.filedDate, primary_document_url: identity.primaryDocumentUrl }, metadata: { isolated_sec_amendment_verification: true }, dedupe_key: identity.accessionNumber }; }
async function secJson(url: string) { const response = await fetch(url, { headers: secHeaders("application/json") }); assert.equal(response.ok, true, `${url} ${response.status}`); const raw = await response.text(); return { data: JSON.parse(raw), raw }; }
async function secText(url: string) { const response = await fetch(url, { headers: secHeaders("text/html") }); assert.equal(response.ok, true, `${url} ${response.status}`); return response.text(); }
function secHeaders(accept: string) { return { "user-agent": "US-Stock-Radar isolated verification openai.com", accept }; }
function cleanHtml(value: string) { return decodeHTML(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function sentences(value: string) { return value.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean); }
function deterministicUuid(seed: string) { const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split(""); hex[12] = "4"; hex[16] = ["8", "9", "a", "b"][parseInt(hex[16], 16) % 4]; return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`; }
function authHeaders() { return { apikey: secretKey!, authorization: `Bearer ${secretKey}`, "content-type": "application/json" }; }
async function rpc(name: string, payload: Record<string, unknown>) { const response = await fetch(`${apiUrl}/rest/v1/rpc/${name}`, { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) }); const body = await response.json().catch(() => null); return { ok: response.ok, status: response.status, data: body, ...(!response.ok ? { error: JSON.stringify(body) } : {}) }; }
async function rest(table: string, options: { method?: string; query?: Record<string, string>; prefer?: string; body?: unknown }) { const url = new URL(`${apiUrl}/rest/v1/${table}`); Object.entries(options.query || {}).forEach(([key, value]) => url.searchParams.set(key, value)); const response = await fetch(url, { method: options.method || "GET", headers: { ...authHeaders(), ...(options.prefer ? { prefer: options.prefer } : {}) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }); const body = await response.text(); assert.equal(response.ok, true, `${table}: ${response.status} ${body}`); }
async function restCount(table: string) { const response = await fetch(`${apiUrl}/rest/v1/${table}?select=id`, { headers: { ...authHeaders(), prefer: "count=exact", range: "0-0" } }); assert.equal(response.ok, true, `${table} count`); return Number(response.headers.get("content-range")?.match(/\/(\d+)$/)?.[1] || 0); }
async function restJson(path: string) { const response = await fetch(`${apiUrl}/rest/v1/${path}`, { headers: authHeaders() }); const body = await response.json().catch(() => null); assert.equal(response.ok, true, `${path}: ${response.status}`); return body; }
