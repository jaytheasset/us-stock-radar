import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { applyDilutionRegistrySource } from "../lib/dilution-registry/applyContract.ts";
import {
  appendDilutionCorporateActionClauseBinding,
  createDilutionStoredSplitClauseBinding,
  dilutionContractSourceRef,
} from "../lib/dilution-registry/corporateActionAdjustment.ts";
import {
  runDilutionCorporateActionAdjustmentForEvent,
  runDilutionCorporateActionAdjustmentForIssuer,
} from "../lib/dilution-registry/corporateActionAdjustmentRuntime.ts";
import { fetchStockDilution } from "../lib/dilution-registry/stockDilutionServer.ts";
import {
  canonicalizeCorporateActionAnalyzerResult,
  CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
} from "../lib/monitor/corporateActionCanonicalFacts.ts";
import { persistCorporateActionAnalyzerResult } from "../lib/monitor/corporateActionPersistence.ts";
import { adaptSec8k6kCorporateActionSource } from "../lib/monitor/corporateActionSourceAdapters.ts";
import {
  buildGenericMonitorChildIdentities,
  GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION,
  GENERIC_MONITOR_CHILD_OUTPUT_TYPE,
} from "../lib/monitor/genericMonitorChildExecution.ts";
import { stockSplitExecutionId } from "../lib/monitor/stockSplitExecution.ts";
import {
  createSecSourceRun,
  ensureSecSource,
  finishSecSourceRun,
  saveSecRawItem,
} from "../lib/secStores/rawStore.ts";
import { fetchSecEdgarRawItems } from "../lib/sources/sec/parser.ts";
import { supabaseRpc } from "../lib/supabase.ts";

const { Client } = pg;
const dbUrl = process.env.DCA_ISOLATED_DB_URL;
const expectedDbPort = process.env.DCA_ISOLATED_DB_PORT;
const apiUrl = process.env.SUPABASE_URL;
if (!dbUrl || !expectedDbPort || !apiUrl || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("DCA isolated DB/API variables are required");
}
assertIsolatedTargets(new URL(dbUrl), expectedDbPort, new URL(apiUrl));
process.env.SEC_USER_AGENT ||= "US-Stock-Radar isolated product verification openai.com";

const CASES = [
  {
    key: "cmg",
    cik: "0001058090",
    ticker: "CMG",
    splitAccession: "0001058090-24-000024",
    contractAccession: "0001140361-22-012495",
    contractUrl: "https://www.sec.gov/Archives/edgar/data/1058090/000114036122012495/ny20002259x1_def14a.htm",
    actionKind: "forward_split",
    oldUnits: "1",
    newUnits: "50",
    effectiveDate: "2024-06-26",
    splitNeedle: "Trading is expected to begin on a split-adjusted basis on June 26, 2024.",
    contractNeedle: "the Compensation Committee will equitably adjust the number and kind of shares available for grant under the 2022 Stock Incentive Plan, the number and kind of shares subject to the award limitations set forth in the plan, the number and kind of shares subject to outstanding awards under the plan, and the exercise price of outstanding stock options and of other awards.",
    instrumentKey: "cmg-sosar-2024-q1",
    instrumentType: "stock_option",
    instrumentName: "CMG Q1 2024 SOSAR",
    asOfDate: "2024-03-31",
    originalUnits: "304000",
    originalPrice: "1526.40",
    originalAmount: "8000000",
    expectedUnits: 15_200_000,
    expectedPrice: 30.528,
  },
  {
    key: "rnaz",
    cik: "0001829635",
    ticker: "RNAZ",
    splitAccession: "0001104659-24-004094",
    contractAccession: "0001104659-23-123274",
    contractUrl: "https://www.sec.gov/Archives/edgar/data/1829635/000110465923123274/tm2332042d1_ex4-1.htm",
    actionKind: "reverse_split",
    oldUnits: "40",
    newUnits: "1",
    effectiveDate: "2024-01-16",
    splitNeedle: "to effect a 1-for-40 reverse stock split",
    contractNeedle: "proportionately adjusted",
    instrumentKey: "rnaz-december-2023-placement-agent-warrant",
    instrumentType: "warrant",
    instrumentName: "RNAZ December 2023 Placement Agent Warrant",
    asOfDate: "2023-12-04",
    originalUnits: "300000",
    originalPrice: "0.3025",
    originalAmount: "90750",
    expectedUnits: 7_500,
    expectedPrice: 12.1,
  },
];

const client = new Client({ connectionString: dbUrl });
const sourceRunId = randomUUID();
const fetched = new Map();

try {
  await client.connect();
  await assertCleanFeatureState(client);
  await ensureSecSource();
  await createSecSourceRun({
    force: true,
    includeDocuments: true,
    requestedFormTypes: [],
    requestedLimit: 4,
    runId: sourceRunId,
    startedAt: new Date().toISOString(),
  });

  for (const config of CASES) {
    const split = await fetchAndPersist(config.cik, config.splitAccession);
    const contract = await fetchAndPersist(config.cik, config.contractAccession);
    fetched.set(config.key, { split, contract });
  }
  await finishSecSourceRun(sourceRunId, "completed", new Date().toISOString(), {
    fetched: fetched.size * 2,
    isolated_product_verification: true,
  });

  await seedCorporateActionLineage(client, fetched);

  const canonical = new Map();
  for (const config of CASES) {
    const pair = fetched.get(config.key);
    const facts = canonicalFacts(config, pair.split.item);
    const identity = await seedCanonicalExecution(client, config, pair.split.row, facts);
    const persistence = await persistCorporateActionAnalyzerResult({ identity, result: { applicable: true, facts } });
    assert.equal(persistence.status, "saved", persistence.reason);
    await terminalizeCanonicalExecution(client, identity);
    const eventHookBeforeRegistry = await runDilutionCorporateActionAdjustmentForEvent({ eventId: identity.eventId });
    assert.equal(eventHookBeforeRegistry.status, "not_applicable");
    assert.equal(eventHookBeforeRegistry.reason, "no_dilution_instruments");
    canonical.set(config.key, { facts, identity, eventHookBeforeRegistry });
  }

  const applyResults = new Map();
  for (const config of CASES) {
    const pair = fetched.get(config.key);
    const facts = canonical.get(config.key).facts;
    const executionId = executionIdFor(config, facts);
    const document = contractDocument(config, pair.contract.item);
    const sourceRef = dilutionContractSourceRef(String(pair.contract.row.id), config.contractUrl);
    const binding = registryBinding(config, executionId, String(pair.contract.row.id), sourceRef, document.text);
    const registryOnlySource = registrySource(config);
    const source = registrySource(config, binding);
    const initialApply = await applyDilutionRegistrySource(registryOnlySource, {
      rpc: supabaseRpc,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    assert.equal(initialApply.status, "saved");
    const registryBeforeBinding = await registryCounts(client, config.cik);
    const bindingsBefore = await bindingCount(client, config.cik);
    const projectionsBefore = await projectionCount(client, config.cik);
    let hookResult = null;
    const apply = await applyDilutionRegistrySource(source, {
      rpc: supabaseRpc,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
      runCorporateActionAdjustmentForIssuer: async (input) => {
        hookResult = await runDilutionCorporateActionAdjustmentForIssuer(input);
        return hookResult;
      },
    });
    assert.equal(apply.status, "already_saved");
    assert.equal(hookResult?.status, "completed");
    assert.equal(hookResult?.saved, config.key === "rnaz" ? 2 : 1, JSON.stringify(hookResult));
    const registryAfterBinding = await registryCounts(client, config.cik);
    const bindingsAfter = await bindingCount(client, config.cik);
    const projectionsAfter = await projectionCount(client, config.cik);
    assert.deepEqual(registryAfterBinding, registryBeforeBinding);
    assert.equal(bindingsAfter, bindingsBefore + 1);
    assert.equal(projectionsAfter, projectionsBefore + (config.key === "rnaz" ? 2 : 1));

    let replayHookResult = null;
    const exactBindingReplay = await applyDilutionRegistrySource(source, {
      rpc: supabaseRpc,
      now: () => new Date("2026-09-01T00:00:30.000Z"),
      runCorporateActionAdjustmentForIssuer: async (input) => {
        replayHookResult = await runDilutionCorporateActionAdjustmentForIssuer(input);
        return replayHookResult;
      },
    });
    assert.equal(exactBindingReplay.status, "already_saved");
    assert.equal(replayHookResult?.status, "completed");
    assert.equal(replayHookResult?.saved, 0, JSON.stringify(replayHookResult));
    assert.equal(replayHookResult?.alreadySaved, config.key === "rnaz" ? 2 : 1);
    const registryAfterReplay = await registryCounts(client, config.cik);
    const bindingsAfterReplay = await bindingCount(client, config.cik);
    const projectionsAfterReplay = await projectionCount(client, config.cik);
    assert.deepEqual(registryAfterReplay, registryBeforeBinding);
    assert.equal(bindingsAfterReplay, bindingsAfter);
    assert.equal(projectionsAfterReplay, projectionsAfter);
    applyResults.set(config.key, {
      apply,
      hookResult,
      binding,
      document,
      executionId,
      identityIsolation: {
        initialApply: initialApply.status,
        bindingApply: apply.status,
        exactBindingReplay: exactBindingReplay.status,
        registryBeforeBinding,
        registryAfterBinding,
        registryAfterReplay,
        bindingsBefore,
        bindingsAfter,
        bindingsAfterReplay,
        projectionsBefore,
        projectionsAfter,
        projectionsAfterReplay,
        replayProjectionSaved: replayHookResult.saved,
        replayProjectionAlreadySaved: replayHookResult.alreadySaved,
      },
    });
  }

  const productApplied = {};
  for (const config of CASES) {
    const product = await fetchStockDilution(config.ticker, { now: new Date("2026-09-01T00:01:00.000Z") });
    const instrument = product?.current.find((item) => item.key === config.instrumentKey);
    assert.equal(instrument?.remainingUnits, config.expectedUnits);
    assert.equal(instrument?.exercisePrice, config.expectedPrice);
    assert.equal(instrument?.originalAmount, Number(config.originalAmount));
    assert.equal(instrument?.corporateActionAdjustment?.status, "APPLIED");
    productApplied[config.key] = summarizeInstrument(instrument);
  }

  const replay = {};
  for (const config of CASES) {
    const before = await projectionCount(client, config.cik);
    const result = await runDilutionCorporateActionAdjustmentForIssuer({
      issuerCik: config.cik,
      targetAt: "2026-09-01T00:02:00.000Z",
    });
    const after = await projectionCount(client, config.cik);
    assert.equal(result.saved, 0);
    assert.equal(after, before);
    assert.equal(result.alreadySaved, config.key === "rnaz" ? 2 : 1);
    replay[config.key] = { before, after, alreadySaved: result.alreadySaved };
  }

  const cmg = CASES[0];
  const cmgApply = applyResults.get("cmg");
  const badBinding = createDilutionStoredSplitClauseBinding(cmg.cik, {
    ...toRegistryBinding(cmgApply.binding),
    field_adjustments: toRegistryBinding(cmgApply.binding).field_adjustments.map((item) => ({
      ...item,
      evidence_identity: { ...item.evidence_identity, source_content_hash: "0".repeat(64) },
    })),
  });
  await assert.rejects(
    () => appendDilutionCorporateActionClauseBinding(badBinding, { rpc: supabaseRpc }),
    /could not be appended/,
  );
  await client.query("update public.raw_items set body_text = $2 where id = $1", [
    fetched.get("cmg").contract.row.id,
    cmgApply.document.text.replace(cmg.contractNeedle, `${cmg.contractNeedle.slice(0, -1)}!`),
  ]);
  const tamperedRun = await runDilutionCorporateActionAdjustmentForIssuer({
    issuerCik: cmg.cik,
    targetAt: "2026-09-01T00:03:00.000Z",
  });
  assert.equal(tamperedRun.projections[0]?.status, "REVIEW");
  assert.equal(tamperedRun.projections[0]?.reviewReason, "CONTRACT_EVIDENCE_INVALID");
  const cmgReviewProduct = await fetchStockDilution(cmg.ticker, { now: new Date("2026-09-01T00:03:30.000Z") });
  const cmgReviewed = cmgReviewProduct?.current.find((item) => item.key === cmg.instrumentKey);
  assert.equal(cmgReviewed?.remainingUnits, Number(cmg.originalUnits));
  assert.equal(cmgReviewed?.exercisePrice, Number(cmg.originalPrice));
  assert.equal(cmgReviewed?.corporateActionAdjustment?.status, "REVIEW");

  const rnaz = CASES[1];
  const rnazApply = applyResults.get("rnaz");
  const alternateEvidence = evidenceIdentity(
    rnazApply.binding.source_ref,
    rnazApply.document.text,
    "the Exercise Price shall be multiplied by a fraction",
  );
  const ambiguousBinding = createDilutionStoredSplitClauseBinding(rnaz.cik, {
    ...toRegistryBinding(rnazApply.binding),
    field_adjustments: [{
      field: "exercise_price",
      operation: "divide_by_split_ratio",
      evidence_identity: alternateEvidence,
    }],
  });
  const ambiguousAppend = await appendDilutionCorporateActionClauseBinding(ambiguousBinding, { rpc: supabaseRpc });
  assert.equal(ambiguousAppend.status, "saved");
  const ambiguousRun = await runDilutionCorporateActionAdjustmentForIssuer({
    issuerCik: rnaz.cik,
    targetAt: "2026-09-01T00:04:00.000Z",
  });
  const rnazProjection = ambiguousRun.projections.find((item) => item.instrumentKey === rnaz.instrumentKey);
  assert.equal(rnazProjection?.status, "REVIEW");
  assert.equal(rnazProjection?.reviewReason, "CONTRACT_CLAUSE_AMBIGUOUS");
  const rnazReviewProduct = await fetchStockDilution(rnaz.ticker, { now: new Date("2026-09-01T00:04:30.000Z") });
  const rnazReviewed = rnazReviewProduct?.current.find((item) => item.key === rnaz.instrumentKey);
  const rnazClosed = rnazReviewProduct?.closed.find((item) => item.key === "rnaz-closed-control");
  assert.equal(rnazReviewed?.remainingUnits, Number(rnaz.originalUnits));
  assert.equal(rnazReviewed?.exercisePrice, Number(rnaz.originalPrice));
  assert.equal(rnazReviewed?.corporateActionAdjustment?.status, "REVIEW");
  assert.equal(rnazClosed?.remainingUnits, 4000);
  assert.equal(rnazClosed?.exercisePrice, 1);
  assert.equal(rnazClosed?.corporateActionAdjustment ?? null, null);

  process.stdout.write(`${JSON.stringify({
    database: { host: new URL(dbUrl).hostname, port: new URL(dbUrl).port },
    officialSec: CASES.map((config) => ({
      issuerCik: config.cik,
      splitAccession: config.splitAccession,
      contractAccession: config.contractAccession,
      splitCharacters: fetched.get(config.key).split.item.body_text.length,
      contractCharacters: applyResults.get(config.key).document.text.length,
    })),
    canonicalPersistence: Object.fromEntries([...canonical].map(([key, value]) => [key, {
      eventId: value.identity.eventId,
      eventHookBeforeRegistry: value.eventHookBeforeRegistry.status,
    }])),
    registryApplyHook: Object.fromEntries([...applyResults].map(([key, value]) => [key, {
      status: value.apply.status,
      saved: value.hookResult.saved,
      reviews: value.hookResult.reviews,
      identityIsolation: value.identityIsolation,
    }])),
    productApplied,
    replay,
    failClosed: {
      invalidBindingRejected: true,
      tamperedEvidence: summarizeInstrument(cmgReviewed),
      ambiguousBinding: summarizeInstrument(rnazReviewed),
      closedControl: summarizeInstrument(rnazClosed),
    },
  }, null, 2)}\n`);
} finally {
  await client.end().catch(() => undefined);
}

function assertIsolatedTargets(databaseUrl, expectedPort, restUrl) {
  assert.ok(["127.0.0.1", "localhost"].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, expectedPort);
  assert.ok(!new Set(["54322", "56322"]).has(databaseUrl.port));
  assert.ok(["127.0.0.1", "localhost"].includes(restUrl.hostname));
  assert.equal(restUrl.port, "54371");
}

async function assertCleanFeatureState(db) {
  const result = await db.query(`select
    (select count(*)::integer from public.dilution_instruments) as instruments,
    (select count(*)::integer from public.dilution_corporate_action_adjustments) as adjustments`);
  assert.deepEqual(result.rows[0], { instruments: 0, adjustments: 0 });
}

async function fetchAndPersist(cik, accessionNumber) {
  const fetchedResult = await fetchSecEdgarRawItems({
    cik,
    accessionNumber,
    includeDocuments: true,
    attachmentLimit: 20,
  });
  assert.equal(fetchedResult.ok, true, fetchedResult.error);
  assert.equal(fetchedResult.items.length, 1);
  const item = fetchedResult.items[0];
  assert.ok(item.body_text?.length > 1_000);
  const row = await saveSecRawItem(item, sourceRunId);
  return { item, row };
}

function canonicalFacts(config, item) {
  const body = item.body_text;
  const needleIndex = body.indexOf(config.splitNeedle);
  assert.ok(needleIndex >= 0, `official split text missing for ${config.splitAccession}`);
  const evidence = body.slice(Math.max(0, needleIndex - 220), needleIndex + config.splitNeedle.length + 260);
  const canonicalClassId = `sc:v1:${config.cik}:common_stock:single`;
  const input = adaptSec8k6kCorporateActionSource({
    accession_number: config.splitAccession,
    source_url: item.source_url,
    filed_at: item.published_at,
    title: item.title,
    cleaned_source_blocks: [{ block_id: "sec_body", text: body }],
    issuer_context: {
      availability: "available",
      issuer_cik: config.cik,
      accession_number: config.splitAccession,
      accepted_at: item.raw_payload.accepted_at,
      provenance: "sec_filing_ledger",
    },
    security_class_candidates: [{
      canonical_security_class_id: canonicalClassId,
      security_type: "common_stock",
      security_class_basis: "SINGLE_COMMON_STOCK_CLASS",
      source_member_local_name: null,
      supporting_accessions: [config.splitAccession],
    }],
    reverse_split_execution_candidates: [],
    forward_split_execution_candidates: [],
  });
  const result = canonicalizeCorporateActionAnalyzerResult({
    applicable: true,
    event_kind: config.actionKind,
    action_stage: "effective",
    effective_date: {
      availability: "available",
      value: config.effectiveDate,
      calculation_basis: "split_effective",
      source_ref: "sec_body",
      evidence,
    },
    ratio: {
      availability: "available",
      old_shares: config.oldUnits,
      new_shares: config.newUnits,
      source_ref: "sec_body",
      evidence,
    },
    affected_security: {
      availability: "available",
      canonical_security_class_id: canonicalClassId,
      security_type: "common_stock",
      source_security_title: "common stock",
      source_ref: "sec_body",
      evidence,
    },
    effective_timing: {
      availability: "available",
      kind: "market_open",
      timestamp: null,
      source_ref: "sec_body",
      evidence,
    },
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "sec_body",
      evidence,
    },
    source_ref: "sec_body",
    evidence,
    confidence: "high",
    as_of: { availability: "available", value: config.effectiveDate },
  }, input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.result?.applicable, true);
  return result.result.facts;
}

async function seedCanonicalExecution(db, config, rawRow, facts) {
  const eventId = randomUUID();
  const parentPrimaryAiRunId = randomUUID();
  const parentPromptKey = "sec_8k_6k_analysis_financing_dilution_capital_structure";
  const parentPromptVersion = "v28-corporate-action-routing";
  const [identity] = buildGenericMonitorChildIdentities({
    primary: {
      eventId,
      rawItemId: String(rawRow.id),
      sourceFamily: "sec_8k_6k",
      sourceGroup: "filings",
      sourceCode: "sec_edgar",
      sourceIdentity: config.splitAccession,
      parentPrimaryAiRunId,
      parentPromptKey,
      parentPromptVersion,
    },
    monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "corporate_action" }] },
    now: "2026-08-31T15:50:00.000Z",
  });
  await db.query(`insert into public.events (
      id, raw_item_id, source_code, source_group, source_name, published_at, ticker,
      event_type, score, delivery_level, impact, signal, market_scope, title,
      group_dedupe_key, metadata
    ) values ($1,$2,'sec_edgar','filings','SEC EDGAR',$3,$4,'listing_risk',50,'feed',
      'medium','neutral','company',$5,$6,$7)`, [
    eventId, rawRow.id, facts.source?.accepted_at ?? new Date().toISOString(), config.ticker,
    `Corporate Action ${config.splitAccession}`, `dca-e2e:${config.splitAccession}`,
    { calendar_items: [{ calendar_event_type: config.actionKind === "reverse_split" ? "reverse_split_effective" : "stock_split_effective" }] },
  ]);
  await db.query(`insert into public.ai_runs (
      id,event_id,raw_item_id,prompt_key,prompt_version,model,status,started_at,finished_at,usage,metadata
    ) values ($1,$2,$3,$4,$5,'isolated-e2e','completed',$6,$7,'{}','{}')`, [
    parentPrimaryAiRunId, eventId, rawRow.id, parentPromptKey, parentPromptVersion,
    "2026-08-31T15:49:00.000Z", "2026-08-31T15:49:30.000Z",
  ]);
  await db.query(`insert into public.ai_outputs (id,ai_run_id,event_id,output_type,payload)
    values ($1,$2,$3,$4,$5)`, [randomUUID(), parentPrimaryAiRunId, eventId, parentPromptKey, {
    analysis: {
      event_type: "listing_risk",
      calendar_items: [{ calendar_event_type: config.actionKind === "reverse_split" ? "reverse_split_effective" : "stock_split_effective" }],
      monitor_routes: [{ monitor_analyzer_key: "corporate_action" }],
    },
  }]);
  await db.query(`insert into public.ai_runs (
      id,event_id,raw_item_id,prompt_key,prompt_version,model,status,started_at,usage,metadata
    ) values ($1,$2,$3,'domain_monitor_child',$4,'isolated-e2e','running',$5,'{}',$6)`, [
    identity.executionId, eventId, rawRow.id, CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
    identity.reservedAt, {
      child_schema_version: identity.schemaVersion,
      purpose: identity.purpose,
      logical_job_id: identity.logicalJobId,
      execution_id: identity.executionId,
      monitor_analyzer_key: identity.monitorAnalyzerKey,
      analyzer_contract_version: identity.analyzerContractVersion,
      attempt_kind: identity.attempt.kind,
      attempt_key: identity.attempt.key,
      parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
      parent_prompt_key: identity.parentPromptKey,
      parent_prompt_version: identity.parentPromptVersion,
      source_family: identity.sourceFamily,
      source_group: identity.sourceGroup,
      source_code: identity.sourceCode,
      source_identity: identity.sourceIdentity,
      event_id: identity.eventId,
      raw_item_id: identity.rawItemId,
      reserved_at: identity.reservedAt,
      execution_state: "running",
      phase: "running",
    },
  ]);
  return identity;
}

async function terminalizeCanonicalExecution(db, identity) {
  await db.query(`update public.ai_runs set status='completed', finished_at=$2,
      metadata=jsonb_set(jsonb_set(metadata,'{execution_state}',to_jsonb('succeeded_applicable'::text)),
        '{phase}',to_jsonb('succeeded_applicable'::text)) where id=$1`, [
    identity.executionId, "2026-08-31T15:51:00.000Z",
  ]);
  await db.query(`insert into public.ai_outputs (id,ai_run_id,event_id,output_type,payload)
    values ($1,$2,$3,$4,$5)`, [randomUUID(), identity.executionId, identity.eventId,
    GENERIC_MONITOR_CHILD_OUTPUT_TYPE, {
      schema_version: GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION,
      logical_job_id: identity.logicalJobId,
      execution_id: identity.executionId,
      parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
      monitor_analyzer_key: "corporate_action",
      analyzer_contract_version: identity.analyzerContractVersion,
      result_classification: "succeeded_applicable",
    },
  ]);
}

function executionIdFor(config, facts) {
  assert.equal(facts.effective_date.availability, "available");
  assert.equal(facts.ratio.exact_source_components.availability, "available");
  assert.equal(facts.applicability.affected_security.availability, "available");
  return stockSplitExecutionId({
    actionKind: config.actionKind,
    issuerCik: config.cik,
    canonicalSecurityClassId: facts.applicability.affected_security.canonical_security_class_id,
    effectiveDate: facts.effective_date.value,
    oldShareUnits: facts.ratio.exact_source_components.old_share_units,
    newShareUnits: facts.ratio.exact_source_components.new_share_units,
  });
}

function contractDocument(config, item) {
  if (item.raw_payload.primary_document_url === config.contractUrl) {
    assert.ok(item.body_text.includes(config.contractNeedle));
    return { text: item.body_text, url: config.contractUrl };
  }
  const attachments = Array.isArray(item.raw_payload.attachment_texts) ? item.raw_payload.attachment_texts : [];
  const attachment = attachments.find((value) => value?.url === config.contractUrl);
  assert.ok(attachment?.text?.includes(config.contractNeedle));
  return { text: attachment.text, url: config.contractUrl };
}

function registryBinding(config, executionId, rawItemId, sourceRef, documentText) {
  return {
    instrument_key: config.instrumentKey,
    execution_id: executionId,
    canonical_security_class_id: `sc:v1:${config.cik}:common_stock:single`,
    contract_accession: config.contractAccession,
    contract_raw_item_id: rawItemId,
    source_ref: sourceRef,
    source_document_url: config.contractUrl,
    field_adjustments: [
      {
        field: "remaining_units",
        operation: "multiply_by_split_ratio",
        evidence_identity: evidenceIdentity(sourceRef, documentText, config.contractNeedle),
      },
      {
        field: "exercise_price",
        operation: "divide_by_split_ratio",
        evidence_identity: evidenceIdentity(sourceRef, documentText, config.contractNeedle),
      },
    ],
  };
}

function evidenceIdentity(sourceRef, documentText, evidence) {
  const start = documentText.indexOf(evidence);
  assert.ok(start >= 0, "exact contract evidence is absent from the official document");
  return {
    version: "corporate_action_evidence_identity_v1",
    source_ref: sourceRef,
    range_start: start,
    range_end: start + evidence.length,
    source_content_hash: createHash("sha256").update(evidence).digest("hex"),
    exact_source: true,
  };
}

function registrySource(config, binding = null) {
  const instruments = [{
    instrument_key: config.instrumentKey,
    instrument_type: config.instrumentType,
    name: config.instrumentName,
    first_source_accession: config.contractAccession,
  }];
  const snapshots = [{
    instrument_key: config.instrumentKey,
    as_of_date: config.asOfDate,
    status: "current",
    can_convert_or_exercise: true,
    original_amount: config.originalAmount,
    remaining_units: config.originalUnits,
    exercise_price: config.originalPrice,
    source_accession: config.contractAccession,
    last_checked: config.asOfDate,
  }];
  if (config.key === "rnaz") {
    instruments.push(
      { instrument_key: "rnaz-missing-clause-control", instrument_type: "warrant", name: "Missing Clause Control", first_source_accession: config.contractAccession },
      { instrument_key: "rnaz-closed-control", instrument_type: "warrant", name: "Closed Control", first_source_accession: config.contractAccession },
    );
    snapshots.push(
      { instrument_key: "rnaz-missing-clause-control", as_of_date: config.asOfDate, status: "current", can_convert_or_exercise: true, original_amount: "4000", remaining_units: "4000", exercise_price: "1", source_accession: config.contractAccession, last_checked: config.asOfDate },
      { instrument_key: "rnaz-closed-control", as_of_date: config.asOfDate, status: "closed", can_convert_or_exercise: false, original_amount: "4000", remaining_units: "4000", exercise_price: "1", source_accession: config.contractAccession, last_checked: config.asOfDate },
    );
  }
  return JSON.stringify({
    issuer: { issuer_cik: config.cik, ticker: config.ticker },
    instruments,
    snapshots,
    activities: [],
    totals: [],
    ...(binding ? { corporate_action_clause_bindings: [binding] } : {}),
  });
}

async function seedCorporateActionLineage(db, sourceItems) {
  for (const config of CASES) {
    const rawId = randomUUID();
    const artifactId = randomUUID();
    const factKey = createHash("sha256").update(`isolated-os:${config.cik}`).digest("hex");
    const splitItem = sourceItems.get(config.key).split.item;
    const acceptedAt = splitItem.raw_payload.accepted_at;
    const filedDate = splitItem.raw_payload.filing_date;
    const form = splitItem.raw_payload.form_type;
    const primaryUrl = splitItem.raw_payload.primary_document_url;
    const documentName = new URL(primaryUrl).pathname.split("/").pop();
    const classId = `sc:v1:${config.cik}:common_stock:single`;
    await db.query(`insert into public.sec_structured_raw_sources (
      id,source_kind,source_url,source_identity,cik,fetched_at,ingested_at,content_hash,
      source_schema_version,raw_content_kind,raw_content,payload
    ) values ($1,'submissions',$2,$3,$4,$5,$5,$6,null,'injected_exact_body',$7,$8)`, [
      rawId, `https://data.sec.gov/submissions/CIK${config.cik}.json`,
      `isolated-e2e:${config.cik}`, config.cik, "2026-08-31T15:55:00.000Z",
      createHash("sha256").update(`{"cik":"${config.cik}"}`).digest("hex"),
      `{"cik":"${config.cik}"}`, { cik: config.cik },
    ]);
    await db.query("insert into public.sec_issuers (cik) values ($1) on conflict do nothing", [config.cik]);
    await db.query(`insert into public.sec_filing_ledger (
      accession_number,issuer_cik,form,filed_date,accepted_at,primary_document,
      is_xbrl,is_inline_xbrl,source_raw_id,source_kind,ingested_at
    ) values ($1,$2,$3,$4,$5,$6,true,true,$7,'submissions',$8)`, [
      config.splitAccession, config.cik, form, filedDate, acceptedAt, documentName,
      rawId, "2026-08-31T15:55:00.000Z",
    ]);
    await db.query(`insert into public.sec_issuer_ticker_observations (
      issuer_cik,ticker,exchange,source_raw_id,observed_at,ingested_at
    ) values ($1,$2,'NASDAQ',$3,$4,$4)`, [config.cik, config.ticker, rawId, "2026-08-31T15:55:00.000Z"]);
    const asOf = new Date(Date.parse(acceptedAt) - 86_400_000).toISOString().slice(0, 10);
    const shares = config.key === "cmg" ? "27500000" : "1200000";
    const contextRef = `isolated-${config.key}-instant`;
    await db.query(`insert into public.share_count_history (
      observation_type,issuer_cik,shares_outstanding,as_of,security_class_basis,
      security_class_identity,security_class_metadata,canonical_security_class_id,
      canonical_security_class_kind,canonical_security_class_status,canonical_security_class_provenance,
      share_basis_identity,share_basis_metadata,accession_number,form,filing_document,filed_date,
      accepted_at,accepted_at_source,accepted_at_provenance,ingested_at,
      source_concept_namespace_uri,source_concept_local_name,source_fact_key,source_context_ref,
      source_artifact_id,filing_ledger_raw_source_id,source_fact_identity,source_context,
      source_dimensions,source_provenance,source_type,authoritative_status,
      authoritative_decision_version,authoritative_decision_reason,authoritative_decision_lineage,
      source_document_url,source_content_hash
    ) values (
      'authoritative_xbrl',$1,$2,$3,'SINGLE_COMMON_STOCK_CLASS',
      $4,$5,$6,'common_stock','mapped',$7,
      'shares_outstanding:xbrli_shares',$8,$9,$10,$11,$12,
      $13,'sec_filing_ledger',$14,$15,
      'http://xbrl.sec.gov/dei/2025','EntityCommonStockSharesOutstanding',$16,$17,
      $18,$19,$20,$21,'[]',$22,'sec_authoritative_os','ELIGIBLE',
      'authoritative-os-extraction-v1','ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT',$23,
      $24,$16
    )`, [
      config.cik, shares, asOf,
      { canonicalKey: "SINGLE_COMMON_STOCK_CLASS|dei:EntityCommonStockSharesOutstanding@required-context", identity: "dei:EntityCommonStockSharesOutstanding@required-context" },
      { evidenceFactKey: factKey, contextRef, dimensions: [] },
      classId,
      { version: "share-count-security-class-v1", isolatedVerification: true },
      { measurement: "shares_outstanding", unit: { namespaceUri: "http://www.xbrl.org/2003/instance", localName: "shares" } },
      config.splitAccession, form, documentName, filedDate, acceptedAt,
      { source: "sec_filing_ledger.accepted_at", accessionNumber: config.splitAccession },
      "2026-08-31T15:55:00.000Z", factKey, contextRef, artifactId, rawId,
      { factKey, contextRef, accession: config.splitAccession, documentName, artifactId, concept: { namespaceUri: "http://xbrl.sec.gov/dei/2025", localName: "EntityCommonStockSharesOutstanding" } },
      { id: contextRef, entityIdentifier: config.cik, entityScheme: "http://www.sec.gov/CIK", period: { kind: "instant", instant: asOf }, dimensions: [] },
      {
        companyFacts: [{ sourceFactKey: factKey, sourceFactPath: "facts.dei.EntityCommonStockSharesOutstanding", sourceRawId: rawId }],
        filingLedgerRawSourceId: rawId,
        filingFactSource: { artifactId, sourceUrl: primaryUrl, contentHash: factKey },
      },
      {
        status: "ELIGIBLE", decisionVersion: "authoritative-os-extraction-v1",
        reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
        candidate: { issuerCik: config.cik, sharesOutstanding: shares, asOf, accession: config.splitAccession, form, filedDate },
        filingFacts: [{ factKey }],
      },
      primaryUrl,
    ]);
  }
}

async function projectionCount(db, cik) {
  return Number((await db.query(
    "select count(*)::integer as count from public.dilution_corporate_action_adjustments where issuer_cik=$1",
    [cik],
  )).rows[0].count);
}

async function bindingCount(db, cik) {
  return Number((await db.query(
    "select count(*)::integer as count from public.dilution_corporate_action_clause_bindings where issuer_cik=$1",
    [cik],
  )).rows[0].count);
}

async function registryCounts(db, cik) {
  const result = await db.query(`select
    (select count(*)::integer from public.dilution_instruments where issuer_cik=$1) as instruments,
    (select count(*)::integer from public.dilution_instrument_snapshots snapshot
      join public.dilution_instruments instrument on instrument.id=snapshot.instrument_id
      where instrument.issuer_cik=$1) as snapshots,
    (select count(*)::integer from public.dilution_instrument_activity activity
      join public.dilution_instruments instrument on instrument.id=activity.instrument_id
      where instrument.issuer_cik=$1) as activities,
    (select count(*)::integer from public.dilution_totals where issuer_cik=$1) as totals,
    (select count(*)::integer from public.dilution_instrument_snapshots snapshot
      join public.dilution_instruments instrument on instrument.id=snapshot.instrument_id
      where instrument.issuer_cik=$1 and snapshot.paste_id is not null)
    + (select count(*)::integer from public.dilution_instrument_activity activity
      join public.dilution_instruments instrument on instrument.id=activity.instrument_id
      where instrument.issuer_cik=$1 and activity.paste_id is not null)
    + (select count(*)::integer from public.dilution_totals
      where issuer_cik=$1 and paste_id is not null) as paste_markers`, [cik]);
  return result.rows[0];
}

function toRegistryBinding(binding) {
  return {
    instrument_key: binding.instrument_key,
    execution_id: binding.execution_id,
    canonical_security_class_id: binding.canonical_security_class_id,
    contract_accession: binding.contract_accession,
    contract_raw_item_id: binding.contract_raw_item_id,
    source_ref: binding.source_ref,
    source_document_url: binding.source_document_url,
    field_adjustments: binding.field_adjustments,
  };
}

function summarizeInstrument(instrument) {
  return instrument ? {
    key: instrument.key,
    status: instrument.status,
    remainingUnits: instrument.remainingUnits,
    exercisePrice: instrument.exercisePrice,
    originalAmount: instrument.originalAmount,
    corporateActionAdjustment: instrument.corporateActionAdjustment ?? null,
  } : null;
}
