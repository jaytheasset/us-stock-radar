import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolveSupabaseSecretKey } from "../lib/supabaseKeys.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    }
    return nextResolve(specifier, context);
  },
});

const dbUrl = process.env.OWNERSHIP_ISOLATED_DB_URL;
const expectedDbPort = process.env.OWNERSHIP_ISOLATED_DB_PORT;
const apiUrl = process.env.SUPABASE_URL;
const secretKey = resolveSupabaseSecretKey().key;
if (!dbUrl || !expectedDbPort || !apiUrl || !secretKey) {
  throw new Error(
    "OWNERSHIP_ISOLATED_DB_URL, OWNERSHIP_ISOLATED_DB_PORT, SUPABASE_URL, and a privileged Supabase API key are required",
  );
}
assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));

process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_USER_AGENT ||= "US-Stock-Radar isolated Ownership XML verification engineering@openai.com";
process.env.SEC_ANALYSIS_ALLOW_OPENAI = "true";
process.env.SEC_ANALYSIS_LLM_PROVIDER = "openai";
delete process.env.OPENAI_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const [
  { runSecFilingAnalysisIngest },
  { saveAnalyzedSecFilingEvent },
  { buildOwnershipParserFactRows },
  { persistOwnershipAnalysisFacts },
] = await Promise.all([
  import("../lib/secFilingAnalysisIngest.ts"),
  import("../lib/secStores/eventStore.ts"),
  import("../lib/monitor/ownershipParserFacts.ts"),
  import("../lib/monitor/persistence.ts"),
]);

const CASES = [
  {
    key: "form4",
    formType: "4",
    accession: "0001493152-26-023264",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1685251/000149315226023264/ownership.xml",
    ticker: "XXII",
    expectedTable: "event_form4_transactions",
  },
  {
    key: "form144",
    formType: "144",
    accession: "0001958244-26-000308",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/104169/000195824426000308/primary_doc.xml",
    ticker: "WMT",
    expectedTable: "event_form144_proposed_sales",
  },
] as const;

const summaries: Row[] = [];

try {
  await rest("sources", {
    method: "POST",
    query: { on_conflict: "code" },
    prefer: "resolution=merge-duplicates,return=minimal",
    body: [{ code: "sec_edgar", name: "SEC EDGAR", source_group: "filings", runtime_owner: "external", enabled: false }],
  });
  const clean = await rest("raw_items", {
    query: { select: "id", source_unique_id: `in.(${CASES.map((item) => item.accession).join(",")})` },
  });
  assert.deepEqual(clean, [], "disposable stack must start without target Ownership filings");

  for (const [caseIndex, fixture] of CASES.entries()) {
    const response: Response = await fetch(fixture.sourceUrl, {
      headers: { "User-Agent": process.env.SEC_USER_AGENT! },
    });
    assert.equal(response.ok, true, `${fixture.key} official SEC XML fetch`);
    const sourceText = await response.text();
    assert.ok(sourceText.length > 2_000, `${fixture.key} official SEC XML body`);

    const rawItemId = `88000000-0000-4000-8000-00000000000${caseIndex + 1}`;
    const inserted = await rest("raw_items", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        id: rawItemId,
        source_code: "sec_edgar",
        source_group: "filings",
        source_unique_id: fixture.accession,
        source_url: fixture.sourceUrl.replace(/\/[^/]+$/, `/${fixture.accession}-index.html`),
        title: `SEC Form ${fixture.formType} ${fixture.accession}`,
        published_at: new Date().toISOString(),
        fetched_at: new Date().toISOString(),
        body_text: "",
        analysis_text: "",
        raw_payload: {
          form_type: fixture.formType,
          accession_number: fixture.accession,
          ticker: fixture.ticker,
          exchange: "NYSE",
          company_name: fixture.key === "form4" ? "22nd Century Group, Inc." : "Walmart Inc.",
          ownership_source_text: sourceText,
          ownership_source_url: fixture.sourceUrl,
          ownership_source_format: "ownership_xml",
          ownership_source_text_char_count: sourceText.length,
          ownership_source_text_truncated: false,
        },
        metadata: {},
        dedupe_key: fixture.accession,
      }],
    });
    const rawRow = (inserted as Row[])[0];
    const expected = buildOwnershipParserFactRows({
      eventId: "99999999-9999-4999-8999-999999999999",
      rawItem: rawRow,
      symbol: fixture.ticker,
    });
    assert.ok(
      expected.form4Transactions.length + expected.form144ProposedSales.length > 0,
      `${fixture.key} production parser rows`,
    );

    const firstFailure = await runSecFilingAnalysisIngest({
      rawItemId,
      dryRun: false,
      force: true,
      suppressAlerts: true,
      llmProvider: "openai",
    });
    assert.equal(firstFailure.ok, false, `${fixture.key} summary analysis remains failed`);
    assert.equal(record(firstFailure.ownershipDetailsPersistence).ok, true, `${fixture.key} parser details persist`);
    const eventId = stringValue(firstFailure.event?.id);
    assert.ok(eventId, `${fixture.key} failure path event identity`);

    const failureState = await readState(fixture.expectedTable, fixture.accession, eventId);
    assert.equal(failureState.eventCount, 1);
    assert.equal(failureState.eventAnalysisCount, 0, "summary failure must not create event_analysis success");
    assert.equal(failureState.failedAiRunCount, 1, "summary failure remains a failed AI run");
    assert.equal(failureState.typedCount, expected.form4Transactions.length + expected.form144ProposedSales.length);
    assert.equal(failureState.eventMetadata.analysis_status, "failed");
    assert.equal(failureState.eventMetadata.ownership_details_status, "available");

    const canonicalBeforeReplay = await canonicalRows(fixture.expectedTable, eventId);
    const replayFailure = await runSecFilingAnalysisIngest({
      rawItemId,
      dryRun: false,
      force: true,
      suppressAlerts: true,
      llmProvider: "openai",
    });
    assert.equal(replayFailure.ok, false);
    assert.equal(stringValue(replayFailure.event?.id), eventId);
    assert.equal(
      Number((await readState(fixture.expectedTable, fixture.accession, eventId)).eventCount),
      1,
      "same filing replay creates no duplicate event",
    );
    assert.deepEqual(await canonicalRows(fixture.expectedTable, eventId), canonicalBeforeReplay);

    const lateAnalysis = buildLateWrongAnalysis(fixture.formType, fixture.ticker);
    const saveProductAnalysis = (candidateRawRow: Row, responseId: string) =>
      saveAnalyzedSecFilingEvent({
        rawRow: candidateRawRow,
        input: record(firstFailure.input),
        analysis: lateAnalysis,
        model: "isolated-late-analysis-fixture",
        openAiResponseId: responseId,
        promptKey: "sec_ownership_analysis",
        promptVersion: "v3-semantic-source-judge",
        force: true,
      });
    const lateEvent = await saveProductAnalysis(rawRow, "late-analysis-fixture");
    assert.equal(stringValue(lateEvent.id), eventId);
    assert.equal(
      Number((await readState(fixture.expectedTable, fixture.accession, eventId)).eventCount),
      1,
    );
    const canonicalAfterLateAnalysis = await canonicalRows(fixture.expectedTable, eventId);
    assert.deepEqual(canonicalAfterLateAnalysis, canonicalBeforeReplay, "late LLM detail values never overwrite XML rows");
    assert.equal(
      canonicalAfterLateAnalysis.some((row) => Object.values(row).some((value) => Number(value) === 999_999_999)),
      false,
    );
    const storedRowsBeforeBlockedSaves = await storedRows(fixture.expectedTable, eventId);

    const mismatchedAccessionUrl = structuredClone(rawRow);
    record(mismatchedAccessionUrl.raw_payload).ownership_source_url = CASES[1 - caseIndex].sourceUrl;
    await assert.rejects(
      saveProductAnalysis(mismatchedAccessionUrl, "mismatched-accession-url"),
      /URL does not match the filing accession number/,
    );

    const missingXml = structuredClone(rawRow);
    delete record(missingXml.raw_payload).ownership_source_text;
    await assert.rejects(
      saveProductAnalysis(missingXml, "missing-xml"),
      /raw XML source is absent/,
    );

    const malformedXml = structuredClone(rawRow);
    record(malformedXml.raw_payload).ownership_source_text = sourceText.replace(
      /<\/(?:[A-Za-z_][\w.-]*:)?(?:ownershipDocument|edgarSubmission)>\s*$/i,
      "",
    );
    await assert.rejects(
      saveProductAnalysis(malformedXml, "malformed-xml"),
      /does not contain a complete/,
    );
    assert.deepEqual(
      await canonicalRows(fixture.expectedTable, eventId),
      canonicalBeforeReplay,
      "blocked product saves must preserve existing canonical details",
    );
    assert.deepEqual(
      await storedRows(fixture.expectedTable, eventId),
      storedRowsBeforeBlockedSaves,
      "blocked product saves must perform zero typed-row writes, including timestamps",
    );
    assert.equal(
      Number((await readState(fixture.expectedTable, fixture.accession, eventId)).eventCount),
      1,
      "blocked product saves create no duplicate event",
    );

    const analyzedState = await readState(fixture.expectedTable, fixture.accession, eventId);
    assert.equal(analyzedState.eventAnalysisCount, 1, "late successful summary has one event_analysis row");
    const analyzedMetadata = structuredClone(analyzedState.eventMetadata);
    const failureAfterSuccess = await runSecFilingAnalysisIngest({
      rawItemId,
      dryRun: false,
      force: true,
      suppressAlerts: true,
      llmProvider: "openai",
    });
    assert.equal(failureAfterSuccess.ok, false);
    assert.equal(stringValue(failureAfterSuccess.event?.id), eventId);
    const afterFailedReplay = await readState(fixture.expectedTable, fixture.accession, eventId);
    assert.equal(afterFailedReplay.eventAnalysisCount, 1, "later failure does not remove successful analysis");
    assert.deepEqual(afterFailedReplay.eventMetadata, analyzedMetadata, "later failure does not downgrade event metadata");
    assert.deepEqual(await canonicalRows(fixture.expectedTable, eventId), canonicalBeforeReplay);

    const untrustedRaw = structuredClone(rawRow);
    (record(untrustedRaw.raw_payload)).ownership_source_url = "https://example.com/untrusted.xml";
    await assert.rejects(
      persistOwnershipAnalysisFacts({
        eventId,
        eventTime: stringValue(lateEvent.detected_at),
        ownershipRawItem: untrustedRaw,
        ownershipInputState: "known",
      }),
      /not an official HTTPS SEC URL/,
    );
    assert.deepEqual(await canonicalRows(fixture.expectedTable, eventId), canonicalBeforeReplay);

    summaries.push({
      formType: fixture.formType,
      accession: fixture.accession,
      sourceUrl: fixture.sourceUrl,
      eventId,
      parserRows: canonicalBeforeReplay.length,
      failureState: {
        analysisResultOk: firstFailure.ok,
        eventAnalysisCount: failureState.eventAnalysisCount,
        failedAiRunCount: failureState.failedAiRunCount,
        typedDetailsAvailable: failureState.eventMetadata.ownership_details_status,
      },
      replay: { duplicateEvents: 0, changedCanonicalRows: 0 },
      lateAnalysis: {
        changedCanonicalRows: 0,
        wrongLlmNumberPersisted: false,
        laterFailureDowngradedEvent: false,
      },
      blockedProductSaves: {
        mismatchedOfficialAccessionUrlWrites: 0,
        missingXmlWithValidLlmWrites: 0,
        malformedXmlWithValidLlmWrites: 0,
        existingCanonicalRowsChanged: 0,
      },
    });
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    isolated: {
      databasePort: expectedDbPort,
      apiOrigin: new URL(apiUrl).origin,
      sharedPortsRejected: [56321, 56322],
    },
    cases: summaries,
  }, null, 2)}\n`);
} finally {}

type Row = Record<string, any>;

async function readState(
  table: string,
  accession: string,
  eventId: string,
) {
  assert.ok(new Set(["event_form4_transactions", "event_form144_proposed_sales"]).has(table));
  const [events, analyses, failedRuns, typed] = await Promise.all([
    rest("events", { query: { select: "id,metadata", "metadata->>accession_number": `eq.${accession}` } }),
    rest("event_analysis", { query: { select: "event_id", event_id: `eq.${eventId}` } }),
    rest("ai_runs", { query: { select: "id", event_id: `eq.${eventId}`, status: "eq.failed" } }),
    rest(table, { query: { select: "event_id", event_id: `eq.${eventId}` } }),
  ]) as Row[][];
  return {
    eventCount: events.length,
    eventAnalysisCount: analyses.length,
    failedAiRunCount: failedRuns.length,
    typedCount: typed.length,
    eventMetadata: record(events[0]?.metadata),
  };
}

async function canonicalRows(table: string, eventId: string) {
  const rows = await storedRows(table, eventId);
  return rows.map(({ created_at: _createdAt, updated_at: _updatedAt, ...row }) => row);
}

async function storedRows(table: string, eventId: string) {
  assert.ok(new Set(["event_form4_transactions", "event_form144_proposed_sales"]).has(table));
  const orderColumn = table === "event_form4_transactions" ? "transaction_index" : "proposed_sale_index";
  return await rest(table, {
    query: { select: "*", event_id: `eq.${eventId}`, order: `${orderColumn}.asc` },
  }) as Row[];
}

async function rest(
  table: string,
  options: {
    method?: "GET" | "POST";
    query?: Record<string, string>;
    body?: unknown;
    prefer?: string;
  } = {},
) {
  const url = new URL(`/rest/v1/${table}`, apiUrl);
  for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `${options.method || "GET"} ${table}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

function buildLateWrongAnalysis(formType: string, ticker: string): Row {
  return {
    source_group: "filings",
    market_scope: "company",
    event_type: "insider_ownership",
    event_title: `Late Ownership Analysis for Form ${formType}`,
    primary_ticker: { ticker, exchange: "NYSE" },
    tickers: [ticker],
    score: 0,
    score_reason: "Isolated late-analysis replay fixture.",
    signal: "neutral",
    quick_take: "Late summary fixture.",
    summary: "Late summary fixture.",
    why_it_matters: "Isolated verification only.",
    bullish_points: [],
    bearish_points: [],
    key_evidence: [],
    what_to_watch_next: [],
    related_tickers: [],
    calendar_items: [],
    confidence: "low",
    needs_human_review: true,
    ownership_monitor_facts: {
      version: "ownership_monitor_facts_v1",
      form4: formType.startsWith("4")
        ? { reporting_owners: [], transactions: [{ shares: { value: 999_999_999 } }] }
        : null,
      form144: formType.startsWith("144")
        ? { reporting_owners: [], proposed_sales: [{ proposed_sale_shares: { value: 999_999_999 } }] }
        : null,
    },
  };
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

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
