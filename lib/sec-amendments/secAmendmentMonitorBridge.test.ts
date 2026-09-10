import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSecAmendmentMonitorFanout,
  readSecAmendmentMonitorCurrentState,
  verifySecAmendmentExecutionAuthorization,
  type SecAmendmentMonitorBridgeDependencies,
} from "./secAmendmentMonitorBridge.ts";
import type { SecAmendmentLineageResolution, SecFilingIdentity } from "./secAmendmentLineage.ts";

const ROOT_EVENT_ID = "10000000-0000-4000-8000-000000000001";
const ROOT_RUN_ID = "20000000-0000-4000-8000-000000000001";
const ROOT_EXECUTION_ID = "30000000-0000-4000-8000-000000000001";

const cases = [
  {
    name: "Enveric official 8-K/A trading-date correction",
    cik: "890821",
    original: identity("40000000-0000-4000-8000-000000000001", "0001493152-25-003091", "8-K", "2025-01-21", "form8-k.htm"),
    amendment: identity("40000000-0000-4000-8000-000000000002", "0001493152-25-003676", "8-K/A", "2025-01-27", "form8-ka.htm"),
    excerpt: "The purpose of this Current Report on Form 8-K/A, Amendment No. 1, is to amend Item 5.03 of the Current Report on Form 8-K filed by Enveric Biosciences, Inc. on January 21, 2025. This amendment is being filed solely to correct the date the reverse stock split will begin trading on a reverse stock split-adjusted basis on The Nasdaq Capital Market. The Company had previously announced an effective date of 8:00 a.m. New York Time on Monday, January 27, 2025. The reverse stock split-adjusted shares will now begin trading on The Nasdaq Capital Market at 8:00 a.m. New York Time on Wednesday, January 29, 2025.",
    changed: ["reverse stock split trading date"],
  },
  {
    name: "Ostin official 6-K/A effective-date correction",
    cik: "1803407",
    original: identity("40000000-0000-4000-8000-000000000011", "0001213900-24-110728", "6-K", "2024-12-20", "ea0225480-6k_ostin.htm"),
    amendment: identity("40000000-0000-4000-8000-000000000012", "0001213900-24-112018", "6-K/A", "2024-12-23", "ea0225833-6ka1_ostin.htm"),
    excerpt: "Ostin Technology Group Co., Ltd. is filing this Amendment No. 1 on Form 6-K/A to amend its Report of Foreign Issuer on Form 6-K furnished to the U.S. Securities and Exchange Commission on December 20, 2024 announcing its plans to effect a reverse share split at a ratio of 1-for-10. This Amendment is being furnished solely for the purpose of clarifying the effective date is changed from December 26, 2024 to December 31, 2024. Other than as expressly set forth above, this Amendment does not amend, restate, or update the information contained in the Original Report.",
    changed: ["reverse share split effective date"],
  },
] as const;

for (const fixture of cases) {
  test(`${fixture.name} authorizes one existing Corporate Action analyzer with stable root Alert identity`, async () => {
    const calls: string[] = [];
    const result = await prepareSecAmendmentMonitorFanout({
      rawItem: raw(fixture.amendment, fixture.cik, fixture.excerpt),
      filingInput: filingInput(fixture.original),
      primaryAnalysis: primary(fixture.changed),
      dependencies: dependencies(fixture.original, calls),
    });
    assert.equal(result.status, "authorized", JSON.stringify(result));
    assert.equal(result.status === "authorized" && result.observation.operation, "REPLACE");
    assert.deepEqual(result.status === "authorized" && result.authorizedAnalyzerKeys, ["corporate_action"]);
    assert.equal(result.status === "authorized" && result.alertEventId, ROOT_EVENT_ID);
    assert.equal(result.status === "authorized" && result.providerCalls, 0);
    assert.deepEqual(calls, ["persist_sec_filing_amendment_observation", "persist_sec_filing_original_facts"]);
  });
}

test("actual persisted Primary delta shape can authorize a source-proven domain when amendment routing is empty", async () => {
  const fixture = cases[0];
  const result = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik, fixture.excerpt),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: {
      monitor_routes: [],
      sec_8k_6k_amendment_delta: {
        is_amendment: true,
        change_kind: "clerical_correction",
        changed_fields: ["Item 5.03"],
        investor_impact: "The amendment corrects the reverse stock split adjusted trading date.",
        unchanged_parent_event: false,
      },
    },
    dependencies: dependencies(fixture.original, []),
  });
  assert.equal(result.status, "authorized", JSON.stringify(result));
  assert.deepEqual(result.status === "authorized" && result.authorizedAnalyzerKeys, ["corporate_action"]);
  assert.deepEqual(result.status === "authorized" && result.primaryAnalysis.monitor_routes, [{ monitor_analyzer_key: "corporate_action" }]);
});

test("known /A with malformed accession suppresses the primary Alert and starts zero providers", async () => {
  const fixture = cases[0];
  const row = raw(fixture.amendment, fixture.cik, fixture.excerpt);
  (row.raw_payload as Record<string, unknown>).accession_number = "bad-accession";
  const result = await prepareSecAmendmentMonitorFanout({
    rawItem: row,
    filingInput: filingInput(fixture.original),
    primaryAnalysis: primary(fixture.changed),
    dependencies: dependencies(fixture.original, []),
  });
  assert.deepEqual(result, {
    status: "blocked",
    suppressPrimaryAlert: true,
    reason: "amendment_identity_invalid",
    observation: null,
    providerCalls: 0,
  });
});

test("exact parent event/raw mismatch and unrelated warrant correction fail closed before provider work", async () => {
  const fixture = cases[0];
  const mismatch = dependencies(fixture.original, []);
  mismatch.loadEventRawItemId = async () => "40000000-0000-4000-8000-000000000099";
  const blocked = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik, fixture.excerpt),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: primary(fixture.changed),
    dependencies: mismatch,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.status === "blocked" && blocked.providerCalls, 0);

  const warrantText = "This Amendment to the Form 8-K filed on January 21, 2025 is filed solely to correct the warrant exercise price from $4.00 to $4.50. The previously announced 1-for-20 reverse stock split remains unchanged.";
  const warrant = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik, warrantText),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: primary(["warrant exercise price"]),
    dependencies: dependencies(fixture.original, []),
  });
  assert.equal(warrant.status, "blocked");
  assert.equal(warrant.status === "blocked" && warrant.providerCalls, 0);
});

test("a source-established new monitor domain may SUPPLEMENT but cannot overwrite a root domain", async () => {
  const fixture = cases[0];
  const supplementText = "This Form 8-K/A amends and supplements the Form 8-K filed on January 21, 2025 solely to provide a new Nasdaq listing compliance deadline. All other information remains unchanged and no other changes were made.";
  const deps = dependencies(fixture.original, [], { status: "absent" });
  const result = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik, supplementText),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: {
      monitor_routes: [{ monitor_analyzer_key: "listing_risk" }],
      amendment_delta: { is_amendment: true, change_kind: "supplemental_update", changed_fields: ["Nasdaq listing compliance deadline"], unchanged_parent_event: true },
    },
    dependencies: deps,
  });
  assert.equal(result.status, "authorized");
  assert.equal(result.status === "authorized" && result.observation.operation, "SUPPLEMENT");

  const overwrite = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik, supplementText),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: {
      monitor_routes: [{ monitor_analyzer_key: "listing_risk" }],
      amendment_delta: { is_amendment: true, change_kind: "supplemental_update", changed_fields: ["Nasdaq listing compliance deadline"] },
    },
    dependencies: dependencies(fixture.original, [], { status: "available", fact: {
      result: { status: "applicable", facts: {} }, eventId: ROOT_EVENT_ID, rawItemId: fixture.original.rawItemId,
      parentPrimaryAiRunId: ROOT_RUN_ID, sourceExecutionId: ROOT_EXECUTION_ID,
      analyzerContractVersion: "listing_risk_domain_analyzer_v11", persistedAt: "2025-01-21T12:00:00.000Z",
    } }),
  });
  assert.equal(overwrite.status, "blocked");
  assert.match(overwrite.status === "blocked" ? overwrite.reason : "", /supplement_overwrites_existing/);

  const unreadable = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik, supplementText),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: {
      monitor_routes: [{ monitor_analyzer_key: "listing_risk" }],
      amendment_delta: { is_amendment: true, change_kind: "supplemental_update", changed_fields: ["Nasdaq listing compliance deadline"], unchanged_parent_event: true },
    },
    dependencies: dependencies(fixture.original, [], { status: "unavailable", reason: "reader_failed" }),
  });
  assert.equal(unreadable.status, "blocked");
  assert.match(unreadable.status === "blocked" ? unreadable.reason : "", /original_listing_risk_fact_reader_failed/);

  const routeMissing = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik,
      "This Form 8-K/A amends and supplements the Form 8-K filed on January 21, 2025 solely to provide a new reverse stock split ratio. All other information remains unchanged and no other changes were made."),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: {
      monitor_routes: [],
      sec_8k_6k_amendment_delta: { is_amendment: true, change_kind: "supplemental_update", changed_fields: ["reverse stock split ratio"], investor_impact: "A new reverse stock split ratio is provided." },
    },
    dependencies: dependencies(fixture.original, [], { status: "absent" }),
  });
  assert.equal(routeMissing.status, "blocked");
  assert.equal(routeMissing.status === "blocked" && routeMissing.reason, "supplement_requires_explicit_primary_route_v1");
  assert.equal(routeMissing.status === "blocked" && routeMissing.providerCalls, 0);
});

test("cancelled lineage blocks original-event replay even when legacy event facts still exist", async () => {
  const fixture = cases[0];
  const cancel = linkedCancel(fixture.amendment, fixture.original);
  const deps = dependencies(fixture.original, []);
  deps.persistence = {
    rpc: async (name) => ({
      ok: true, status: 200,
      data: name === "read_sec_filing_amendment_ledger"
        ? { status: "available", root: fixture.original, observations: [cancel], facts: [] }
        : { status: "saved", inserted_count: 1, idempotent_count: 0 },
    }),
  };
  assert.deepEqual(await readSecAmendmentMonitorCurrentState(ROOT_EVENT_ID, deps), {
    status: "blocked",
    reason: "lineage_cancelled",
  });
});

test("missing original URL and issuer CIK mismatch fail closed before lineage fallback", async () => {
  const fixture = cases[0];
  const variants = [
    {
      name: "missing original URL",
      mutate(row: Record<string, unknown>) {
        row.source_url = "";
      },
    },
    {
      name: "issuer CIK mismatch",
      mutate(row: Record<string, unknown>) {
        (row.raw_payload as Record<string, unknown>).cik = "1803407";
      },
    },
    {
      name: "SEC source identity mismatch",
      mutate(row: Record<string, unknown>) {
        row.source_code = "nasdaq_corporate_actions";
      },
    },
  ];

  for (const variant of variants) {
    const calls: string[] = [];
    const deps = dependencies(fixture.original, calls);
    const invalid = raw(fixture.original, fixture.cik, "Official original SEC filing.");
    variant.mutate(invalid);
    deps.loadRawItem = async () => invalid;

    assert.deepEqual(
      await readSecAmendmentMonitorCurrentState(ROOT_EVENT_ID, deps),
      { status: "blocked", reason: "root_source_identity_invalid" },
      variant.name,
    );
    assert.deepEqual(calls, [], `${variant.name} must not read the lineage ledger`);
  }
});

test("not_applicable is reserved for a verified root with no amendment effect", async () => {
  const fixture = cases[0];
  const calls: string[] = [];
  const deps = dependencies(fixture.original, calls);
  deps.persistence = {
    rpc: async (name) => {
      calls.push(name);
      return {
        ok: true,
        status: 200,
        data: { status: "available", root: fixture.original, observations: [], facts: [] },
      };
    },
  };

  assert.deepEqual(
    await readSecAmendmentMonitorCurrentState(ROOT_EVENT_ID, deps),
    { status: "not_applicable" },
  );
  assert.deepEqual(calls, ["read_sec_filing_amendment_ledger"]);
});

test("execution authorization rejects missing ledger, issuer mismatch, and root-event mismatch", async () => {
  const fixture = cases[0];
  const prepared = await prepareSecAmendmentMonitorFanout({
    rawItem: raw(fixture.amendment, fixture.cik, fixture.excerpt),
    filingInput: filingInput(fixture.original),
    primaryAnalysis: primary(fixture.changed),
    dependencies: dependencies(fixture.original, []),
  });
  assert.equal(prepared.status, "authorized");
  if (prepared.status !== "authorized") return;
  const child = {
    eventId: "50000000-0000-4000-8000-000000000001",
    alertEventId: ROOT_EVENT_ID,
    rawItemId: fixture.amendment.rawItemId,
    sourceFamily: "sec_8k_6k",
    sourceCode: "sec_edgar",
    sourceIdentity: fixture.amendment.accessionNumber,
    monitorAnalyzerKey: "corporate_action",
    secAmendmentLineage: prepared.executionContext,
  } as never;
  const exact = dependencies(fixture.original, []);
  exact.loadEventRawItemId = async (eventId) => eventId === ROOT_EVENT_ID
    ? fixture.original.rawItemId : fixture.amendment.rawItemId;
  exact.persistence = { rpc: async () => ({ ok: true, status: 200, data: {
    status: "available", root: fixture.original, observations: [prepared.observation], facts: [],
  } }) };
  assert.deepEqual(await verifySecAmendmentExecutionAuthorization(child, exact), { authorized: true });

  exact.persistence = { rpc: async () => ({ ok: true, status: 200, data: {
    status: "available", root: fixture.original, observations: [], facts: [],
  } }) };
  assert.equal((await verifySecAmendmentExecutionAuthorization(child, exact)).authorized, false);
  exact.persistence = { rpc: async () => ({ ok: true, status: 200, data: {
    status: "available", root: { ...fixture.original, issuerCik: "1" }, observations: [prepared.observation], facts: [],
  } }) };
  assert.equal((await verifySecAmendmentExecutionAuthorization(child, exact)).authorized, false);
  exact.loadEventRawItemId = async () => fixture.amendment.rawItemId;
  assert.equal((await verifySecAmendmentExecutionAuthorization(child, exact)).authorized, false);
});

function dependencies(
  root: SecFilingIdentity,
  calls: string[],
  rootFact: any = { status: "available", fact: {
    result: { applicable: true, facts: { evidence: "Official original SEC Corporate Action fact." } },
    eventId: ROOT_EVENT_ID, rawItemId: "", parentPrimaryAiRunId: ROOT_RUN_ID,
    sourceExecutionId: ROOT_EXECUTION_ID, analyzerContractVersion: "corporate_action_canonical_v5",
    persistedAt: "2025-01-21T12:00:00.000Z",
  } },
): SecAmendmentMonitorBridgeDependencies {
  if (rootFact?.status === "available") rootFact = { ...rootFact, fact: { ...rootFact.fact, rawItemId: root.rawItemId } };
  return {
    loadRawItem: async (id) => id === root.rawItemId ? raw(root, root.issuerCik, "Official original SEC filing.") : null,
    loadEventRawItemId: async (id) => id === ROOT_EVENT_ID ? root.rawItemId : null,
    findExactParentCandidates: async () => [{ rawItem: raw(root, root.issuerCik, "Official original SEC filing."), eventId: ROOT_EVENT_ID }],
    readRootFact: async () => rootFact,
    persistence: {
      rpc: async (name) => {
        calls.push(name);
        return { ok: true, status: 200, data: { status: "saved", inserted_count: 1, idempotent_count: 0 } };
      },
    },
  };
}

function primary(changedFields: readonly string[]) {
  return {
    monitor_routes: [{ monitor_analyzer_key: "corporate_action" }],
    amendment_delta: { is_amendment: true, change_kind: "material_change", changed_fields: [...changedFields], unchanged_parent_event: false },
  };
}

function filingInput(root: SecFilingIdentity) {
  return { filing_package: { parent_filing_context: { status: "found", confidence: "high", match_method: "explicit_parent_form_filed_date", parent: { raw_item_id: root.rawItemId, event_id: ROOT_EVENT_ID } } } };
}

function raw(item: SecFilingIdentity, cik: string, text: string): Record<string, unknown> {
  return {
    id: item.rawItemId, source_code: "sec_edgar", source_unique_id: item.accessionNumber, source_url: item.indexUrl,
    published_at: `${item.filedDate}T12:00:00.000Z`, body_text: text,
    raw_payload: { cik, accession_number: item.accessionNumber, form_type: item.formType, filed_date: item.filedDate, primary_document_url: item.primaryDocumentUrl },
  };
}

function identity(rawItemId: string, accessionNumber: string, formType: string, filedDate: string, document: string): SecFilingIdentity {
  const cik = accessionNumber === "0001213900-24-110728" || accessionNumber === "0001213900-24-112018" ? "1803407" : "890821";
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber.replace(/-/g, "")}`;
  return { rawItemId, sourceCode: "sec_edgar", issuerCik: cik, accessionNumber, formType, filedDate, primaryDocumentUrl: `${base}/${document}`, indexUrl: `${base}/${accessionNumber}-index.html` };
}

function linkedCancel(amendment: SecFilingIdentity, prior: SecFilingIdentity): Extract<SecAmendmentLineageResolution, { status: "linked" }> {
  return {
    status: "linked", version: "sec_amendment_lineage_v1", amendment, prior, formFamily: "8-K", operation: "CANCEL",
    operationEvidence: "The registrant hereby cancels the prior Form 8-K in its entirety.", targetEvidence: prior.accessionNumber,
    affectedFactKeys: [], factScopeEvidence: [], evidence: { amendmentExcerpt: "cancelled", amendmentDocumentUrl: amendment.primaryDocumentUrl, amendmentIndexUrl: amendment.indexUrl, submissionsUrl: "https://data.sec.gov/submissions/CIK0000890821.json" }, observationKey: "a".repeat(64),
  };
}
