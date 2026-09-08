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
  { consumeListingMonitorAlertsForEvent },
] = await Promise.all([
  import("../lib/secFilingAnalysisIngest.ts"),
  import("../lib/secStores/eventStore.ts"),
  import("../lib/monitor/ownershipParserFacts.ts"),
  import("../lib/monitor/persistence.ts"),
  import("../lib/monitor/listingMonitorAlertConsumer.ts"),
]);

const CASES = [
  {
    key: "agig_form4",
    formType: "4",
    accession: "0001493152-26-023264",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1685251/000149315226023264/ownership.xml",
    ticker: "AGIG",
    issuerCik: "0001156041",
    companyName: "Abundia Global Impact Group, Inc.",
    expectedTable: "event_form4_transactions",
  },
  {
    key: "xxii_form4",
    formType: "4",
    accession: "0000897069-25-001687",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1347858/000089706925001687/form4.xml",
    ticker: "XXII",
    issuerCik: "0001347858",
    companyName: "22nd Century Group, Inc.",
    expectedTable: "event_form4_transactions",
  },
  {
    key: "wmt_form144",
    formType: "144",
    accession: "0001958244-26-000308",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/104169/000195824426000308/primary_doc.xml",
    ticker: "WMT",
    issuerCik: "0000104169",
    companyName: "Walmart Inc.",
    expectedTable: "event_form144_proposed_sales",
  },
] as const;

const summaries: Row[] = [];
let issuerMismatchAudit: Row | null = null;

try {
  const monitorOwnerId = await createAuthUser();
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
    const canonicalRawPayload = {
      form_type: fixture.formType,
      accession_number: fixture.accession,
      ticker: fixture.ticker,
      cik: fixture.issuerCik,
      ownership_issuer_cik: fixture.issuerCik,
      ownership_issuer_trading_symbol: fixture.formType === "4" ? fixture.ticker : null,
      ticker_resolution: {
        source: fixture.formType === "4" ? "issuer_trading_symbol_and_cik_sec" : "issuer_cik_sec",
        confidence: "high",
      },
      exchange: "NYSE",
      company_name: fixture.companyName,
      ownership_source_text: sourceText,
      ownership_source_url: fixture.sourceUrl,
      ownership_source_format: "ownership_xml",
      ownership_source_text_char_count: sourceText.length,
      ownership_source_text_truncated: false,
    };
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
        raw_payload: fixture.key === "agig_form4"
          ? {
              ...canonicalRawPayload,
              ticker: "XXII",
              cik: "0001347858",
              ownership_issuer_cik: "0001347858",
              ownership_issuer_trading_symbol: "XXII",
            }
          : canonicalRawPayload,
        metadata: {},
        dedupe_key: fixture.accession,
      }],
    });
    let rawRow = (inserted as Row[])[0];
    const canonicalRawRow = structuredClone(rawRow);
    canonicalRawRow.raw_payload = canonicalRawPayload;
    const expected = buildOwnershipParserFactRows({
      eventId: "99999999-9999-4999-8999-999999999999",
      rawItem: canonicalRawRow,
      symbol: fixture.ticker,
    });
    assert.ok(
      expected.form4Transactions.length + expected.form144ProposedSales.length > 0,
      `${fixture.key} production parser rows`,
    );
    const monitorConditions = buildMonitorConditions(expected);
    const monitorRows = await rest("listing_monitors", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        user_id: monitorOwnerId,
        domain: "listing",
        conditions: monitorConditions,
        is_active: true,
      }],
    }) as Row[];
    const monitorId = stringValue(monitorRows[0]?.id);
    assert.ok(monitorId, `${fixture.key} active Ownership monitor`);

    if (fixture.key === "agig_form4") {
      const mismatch = await runSecFilingAnalysisIngest({
        rawItemId,
        dryRun: false,
        force: true,
        suppressAlerts: true,
        llmProvider: "openai",
      });
      assert.equal(mismatch.ok, false);
      assert.match(
        stringValue(record(mismatch.ownershipDetailsPersistence).error),
        /issuer CIK does not match/,
      );
      assert.equal((await eventsForAccession(fixture.accession)).length, 0, "issuer mismatch event writes");
      assert.equal((await rest("event_form4_transactions", { query: { select: "event_id" } }) as Row[]).length, 0);
      assert.equal((await monitorAlerts(monitorId)).length, 0, "issuer mismatch Monitor outputs");
      issuerMismatchAudit = {
        xmlIssuerCik: "0001156041",
        targetIssuerCik: "0001347858",
        targetTicker: "XXII",
        eventWrites: 0,
        typedWrites: 0,
        monitorOutputs: 0,
      };
      const corrected = await rest("raw_items", {
        method: "PATCH",
        query: { id: `eq.${rawItemId}` },
        prefer: "return=representation",
        body: { raw_payload: canonicalRawPayload },
      }) as Row[];
      rawRow = corrected[0];
    }

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
    const firstConditionExecution = record(firstFailure.ownershipMonitorConditionExecution);
    assert.equal(firstConditionExecution.ownershipReaderStatus, "available");
    assert.equal(firstConditionExecution.createdCount, 1, `${fixture.key} LLM-failure condition output`);
    assert.equal(
      recordArray(firstConditionExecution.evaluations).find((item) => item.monitorId === monitorId)?.status,
      "match",
    );
    assert.equal((await monitorAlerts(monitorId, eventId)).length, 1);

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
    assert.equal(record(replayFailure.ownershipMonitorConditionExecution).existingCount, 1);
    assert.equal((await monitorAlerts(monitorId, eventId)).length, 1, "condition replay creates no duplicate output");
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
    const lateConditionExecution = await consumeListingMonitorAlertsForEvent({ eventId });
    assert.equal(lateConditionExecution.existingCount, 1);
    assert.equal((await monitorAlerts(monitorId, eventId)).length, 1, "late callback creates no duplicate condition output");
    let storedRowsBeforeBlockedSaves = await storedRows(fixture.expectedTable, eventId);

    const wrongProvenanceMonitorRows = await rest("listing_monitors", {
      method: "POST",
      prefer: "return=representation",
      body: [{
        user_id: monitorOwnerId,
        domain: "listing",
        conditions: monitorConditions,
        is_active: true,
      }],
    }) as Row[];
    const wrongProvenanceMonitorId = stringValue(wrongProvenanceMonitorRows[0]?.id);
    const firstStoredRow = structuredClone(storedRowsBeforeBlockedSaves[0]);
    firstStoredRow.provenance = {
      ...record(firstStoredRow.provenance),
      source: "sec_ownership_analysis",
      canonical_input: "analysis_output.ownership_monitor_facts",
    };
    const rowIdentityColumn = fixture.formType.startsWith("4") ? "transaction_index" : "proposed_sale_index";
    await rest(fixture.expectedTable, {
      method: "PATCH",
      query: {
        event_id: `eq.${eventId}`,
        [rowIdentityColumn]: `eq.${String(firstStoredRow[rowIdentityColumn])}`,
      },
      prefer: "return=minimal",
      body: { provenance: firstStoredRow.provenance },
    });
    const wrongProvenanceExecution = await consumeListingMonitorAlertsForEvent({ eventId });
    assert.equal(wrongProvenanceExecution.ownershipReaderStatus, "not_ready");
    assert.equal(wrongProvenanceExecution.ownershipReaderReason, "ownership_provenance_invalid");
    assert.equal((await monitorAlerts(wrongProvenanceMonitorId, eventId)).length, 0);
    await persistOwnershipAnalysisFacts({
      eventId,
      eventTime: stringValue(lateEvent.detected_at),
      primaryTicker: { symbol: fixture.ticker },
      ownershipRawItem: rawRow,
      ownershipInputState: "known",
    });
    storedRowsBeforeBlockedSaves = await storedRows(fixture.expectedTable, eventId);

    const mismatchedAccessionUrl = structuredClone(rawRow);
    record(mismatchedAccessionUrl.raw_payload).ownership_source_url = CASES[(caseIndex + 1) % CASES.length].sourceUrl;
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
      key: fixture.key,
      formType: fixture.formType,
      ticker: fixture.ticker,
      issuerCik: fixture.issuerCik,
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
      conditionExecution: {
        conditions: monitorConditions,
        llmFailureMatched: true,
        readbackSource: "sec_ownership_xml_parser",
        outputsAfterReplayAndLateCallback: 1,
        extraLlmCalls: 0,
      },
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
      wrongProvenance: {
        readerStatus: "not_ready",
        reason: "ownership_provenance_invalid",
        conditionOutputs: 0,
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
    issuerMismatchAudit,
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
    method?: "GET" | "POST" | "PATCH";
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

async function createAuthUser() {
  const response = await fetch(new URL("/auth/v1/admin/users", apiUrl), {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: `ownership-monitor-${Date.now()}@example.test`,
      password: "Isolated-Ownership-Monitor-Only-2026!",
      email_confirm: true,
    }),
  });
  const text = await response.text();
  assert.equal(response.ok, true, `create isolated auth user: ${text.slice(0, 500)}`);
  const id = stringValue(JSON.parse(text).id);
  assert.ok(id, "isolated auth user id");
  await rest("user_profiles", {
    method: "POST",
    prefer: "return=minimal",
    body: [{ id, email: `ownership-monitor-profile-${Date.now()}@example.test` }],
  });
  return id;
}

function buildMonitorConditions(expected: { form4Transactions: Row[]; form144ProposedSales: Row[] }) {
  const form4Rows = expected.form4Transactions;
  if (form4Rows.length > 0) {
    const row = form4Rows[form4Rows.length - 1];
    return [
      { key: "ownership.form4.transaction_code", operator: "eq", value: row.transaction_code },
      { key: "ownership.form4.acquisition_disposition", operator: "eq", value: row.acquired_disposed_code },
      { key: "ownership.form4.shares", operator: "eq", value: row.shares },
      { key: "ownership.form4.transaction_date", operator: "eq", value: row.transaction_date },
    ];
  }
  const row = expected.form144ProposedSales[0];
  return [
    { key: "ownership.form144.proposed_sale_shares", operator: "eq", value: row.securities_to_be_sold },
    { key: "ownership.form144.proposed_sale_value", operator: "eq", value: row.aggregate_market_value },
    { key: "ownership.form144.proposed_sale_date", operator: "eq", value: row.approximate_sale_date },
  ];
}

async function eventsForAccession(accession: string) {
  return await rest("events", {
    query: {
      select: "id",
      "metadata->>accession_number": `eq.${accession}`,
    },
  }) as Row[];
}

async function monitorAlerts(monitorId: string, eventId?: string) {
  return await rest("user_alert_deliveries", {
    query: {
      select: "id,listing_monitor_id,alert_event_id,listing_source_execution_id",
      listing_monitor_id: `eq.${monitorId}`,
      ...(eventId ? { alert_event_id: `eq.${eventId}` } : {}),
    },
  }) as Row[];
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

function recordArray(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
