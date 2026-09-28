import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOwnershipParserFactRows } from "../lib/monitor/ownershipParserFacts.ts";

const require = createRequire(import.meta.url);
const pg = require("pg") as typeof import("pg");
const { Pool } = pg;
const connectionString = process.env.OWNERSHIP_CONTEXT_ISOLATED_DB_URL;
const expectedPort = process.env.OWNERSHIP_CONTEXT_ISOLATED_DB_PORT;
if (!connectionString || !expectedPort) {
  throw new Error("OWNERSHIP_CONTEXT_ISOLATED_DB_URL and OWNERSHIP_CONTEXT_ISOLATED_DB_PORT are required");
}
const databaseUrl = new URL(connectionString);
assertIsolatedDatabase(databaseUrl, expectedPort);

const pool = new Pool({ connectionString, max: 8 });
const here = dirname(fileURLToPath(import.meta.url));
const migrations = [
  "20260915014346_ownership_structured_context_v1.sql",
  "20260915065614_harden_ownership_context_semantic_refs.sql",
  "20260915082336_ownership_context_sole_reporting_person_scope.sql",
  "20260915091248_ownership_context_semantic_verifier_lineage.sql",
  "20260926185541_ownership_context_multiple_footnote_refs.sql",
  "20260927091759_ownership_context_beneficial_relation_aliases.sql",
  "20260927135804_ownership_context_unambiguous_alias_bindings.sql",
].map((filename) => readFileSync(join(here, "../supabase/migrations", filename), "utf8"));
const fixture = JSON.parse(readFileSync(
  join(here, "../lib/sources/sec/forms/ownership/fixtures/source-uwmc-form4-multi-owner-10b5-1-conversion.json"),
  "utf8",
)) as Record<string, unknown>;
const venuFixture = JSON.parse(readFileSync(
  join(here, "../lib/sources/sec/forms/ownership/fixtures/source-venu-form4-section16-derivative-gift.json"),
  "utf8",
)) as Record<string, unknown>;

const eventId = "a1111111-1111-4111-8111-111111111111";
const rawItemId = "a2222222-2222-4222-8222-222222222222";
const aiRunId = "a3333333-3333-4333-8333-333333333333";
const aiOutputId = "a4444444-4444-4444-8444-444444444444";
const verifierRunId = "a6666666-6666-4666-8666-666666666666";
const verifierOutputId = "a7777777-7777-4777-8777-777777777777";

try {
  await pool.query(baselineSql());
  for (const migration of migrations) await pool.query(migration);
  const anonClient = await pool.connect();
  try {
    await anonClient.query("begin");
    await anonClient.query("set local role anon");
    await assert.rejects(
      anonClient.query("select public.read_event_ownership_context_snapshot($1)", [eventId]),
      (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "42501"),
    );
  } finally {
    try { await anonClient.query("rollback"); } catch {}
    anonClient.release();
  }

  const sourceText = String(fixture.filingText);
  const preservedSourceText = `\n${sourceText}\n `;
  const accession = String(fixture.accessionNumber);
  const ticker = xmlValue(sourceText, "issuerTradingSymbol");
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const rawItem = {
    id: rawItemId,
    source_unique_id: accession,
    raw_payload: {
      form_type: fixture.formType,
      accession_number: accession,
      cik: issuerCik,
      ownership_issuer_cik: issuerCik,
      ticker,
      ownership_issuer_trading_symbol: ticker,
      ownership_source_text: preservedSourceText,
      ownership_source_url: `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const built = buildOwnershipParserFactRows({ eventId, rawItem, symbol: ticker });
  assert.equal(built.form4Transactions.length, 5);
  await pool.query("insert into public.raw_items(id, source_unique_id, raw_payload) values ($1, $2, $3::jsonb)", [
    rawItemId, accession, JSON.stringify(rawItem.raw_payload),
  ]);
  await pool.query(`insert into public.events(
    id, raw_item_id, source_code, source_group, event_type, metadata
  ) values ($1, $2, 'sec_edgar', 'filings', 'insider_ownership', $3::jsonb)`, [
    eventId, rawItemId, JSON.stringify({ form_type: fixture.formType, accession_number: accession }),
  ]);
  await replaceRows(built.form4Transactions);

  const firstFingerprint = await currentFingerprint();
  assert.match(firstFingerprint, /^ownership-context-v1:[0-9a-f]{64}$/);
  const directBefore = await directRows();
  const context = validContext(firstFingerprint);
  const nullArguments = await pool.query(
    "select public.persist_event_ownership_context($1, null, null, null, null, null) as result",
    [eventId],
  );
  assert.equal(nullArguments.rows[0].result.reason, "invalid_arguments");
  const nullFact = [{ row_ref: "row:form4:0", assertions: [{
    fact: null, status: "supported", value: "sell", evidence_refs: ["evidence:form4:0:0"],
  }] }];
  assert.equal((await persistContext(firstFingerprint, nullFact)).reason, "assertion_shape_invalid");
  const nullValue = [{ row_ref: "row:form4:0", assertions: [{
    fact: "economic_direction", status: "supported", value: null, evidence_refs: ["evidence:form4:0:0"],
  }] }];
  assert.equal((await persistContext(firstFingerprint, nullValue)).reason, "assertion_value_invalid");
  const injectedDirectKey = [{ row_ref: "row:form4:0", assertions: [{
    fact: "economic_direction", status: "supported", value: "sell",
    evidence_refs: ["evidence:form4:0:0"], shares: 123,
  }] }];
  assert.equal((await persistContext(firstFingerprint, injectedDirectKey)).reason, "assertion_shape_invalid");
  assert.deepEqual(await persistContext(firstFingerprint, context), {
    status: "stored", updated_row_count: 1, source_fingerprint: firstFingerprint,
  });
  assert.deepEqual(await persistContext(firstFingerprint, []), {
    status: "stored", updated_row_count: 1, source_fingerprint: firstFingerprint,
  });
  assert.equal(await storedContext(), null, "an explicit empty result clears old sidecar state");
  assert.deepEqual(await persistContext(firstFingerprint, []), {
    status: "replayed", updated_row_count: 0, source_fingerprint: firstFingerprint,
  });
  assert.equal((await persistContext(firstFingerprint, context)).status, "stored");
  const malformedEvidenceRef = [{ row_ref: "row:form4:0", assertions: [{
    fact: "economic_direction", status: "supported", value: "sell", evidence_refs: ["evidence:form4:nope:0"],
  }] }];
  assert.equal((await persistContext(firstFingerprint, malformedEvidenceRef)).reason, "evidence_ref_invalid");
  const malformedOwnerRef = [{ row_ref: "row:form4:0", assertions: [{
    fact: "owner_attribution", status: "supported", value: "owner:form4:0:0",
    owner_ref: "owner:form4:nope:0", evidence_refs: ["evidence:form4:0:0"],
  }] }];
  assert.equal((await persistContext(firstFingerprint, malformedOwnerRef)).reason, "owner_ref_invalid");
  const bothOwnerRelations = [{ row_ref: "row:form4:0", assertions: [
    {
      fact: "ownership_relation", status: "supported", value: "indirect",
      owner_ref: "owner:form4:0:0", footnote_ref: "footnote:F3", evidence_refs: ["evidence:form4:0:0"],
    },
    {
      fact: "ownership_relation", status: "supported", value: "direct",
      owner_ref: "owner:form4:0:1", footnote_ref: "footnote:F3", evidence_refs: ["evidence:form4:0:0"],
    },
  ] }];
  const bothOwnerRelationsResult = await persistContext(firstFingerprint, bothOwnerRelations);
  assert.equal(bothOwnerRelationsResult.status, "stored", JSON.stringify(bothOwnerRelationsResult));
  const multipleFootnoteRelation = [{ row_ref: "row:form4:4", assertions: [{
    fact: "ownership_relation", status: "supported", value: "direct",
    owner_ref: "owner:form4:4:1", footnote_refs: ["footnote:F3", "footnote:F5", "footnote:F8"],
    evidence_refs: ["evidence:form4:4:0"],
  }] }];
  assert.equal((await persistContext(firstFingerprint, multipleFootnoteRelation)).status, "stored");
  assert.deepEqual(
    (await storedContextAt(4))?.assertions?.[0]?.footnote_refs,
    ["footnote:F3", "footnote:F5", "footnote:F8"],
    "all selected footnotes persist in their original order",
  );
  const conflictingMultipleFootnotes = structuredClone(multipleFootnoteRelation);
  conflictingMultipleFootnotes[0].assertions[0].footnote_refs = ["footnote:F3", "footnote:F7"];
  assert.equal(
    (await persistContext(firstFingerprint, conflictingMultipleFootnotes)).reason,
    "footnote_row_link_invalid",
    "a conflicting footnote from a different row is rejected before semantic use",
  );
  const conflictHelper = await pool.query(`select public.ownership_context_owner_relation_conflicted(
    $1, 'F7', 'SFS HOLDING CORP', 'direct'
  ) as conflicted`, [preservedSourceText]);
  assert.equal(conflictHelper.rows[0].conflicted, true, "explicit no-interest evidence conflicts with direct ownership");
  const beneficialOwnershipXml = `<ownershipDocument>
    <reportingOwner><rptOwnerName>Lynrock Lake LP</rptOwnerName></reportingOwner>
    <reportingOwner><rptOwnerName>LYNROCK LAKE PARTNERS LLC</rptOwnerName></reportingOwner>
    <reportingOwner><rptOwnerName>Paul Cynthia</rptOwnerName></reportingOwner>
    <footnotes>
      <footnote id="F1">Shares are held directly by Lynrock Lake Master Fund LP (&quot;Lynrock Fund&quot;). The investment manager and general partner of Lynrock Fund are Lynrock Lake LP (&quot;Lynrock&quot;) and Lynrock Lake Partners LLC (&quot;Lynrock GP&quot;), respectively, and each may be deemed to beneficially own the shares held by Lynrock Fund. Cynthia Paul is the Chief Investment Officer of Lynrock and Sole Member of Lynrock GP and may be deemed to beneficially own the shares held by Lynrock Fund. Each of Lynrock, Lynrock GP and Ms. Paul disclaims beneficial ownership in these shares except to the extent of its or her respective pecuniary interest therein.</footnote>
      <footnote id="F2">The price reported in Column 4 is a weighted average price.</footnote>
    </footnotes>
  </ownershipDocument>`;
  for (const ownerName of ["Lynrock Lake LP", "LYNROCK LAKE PARTNERS LLC", "Paul Cynthia"]) {
    const relation = await pool.query(`select
      public.ownership_context_owner_relation_supported($1, 'F1', $2, 'indirect') as supported,
      public.ownership_context_owner_relation_supported($1, 'F2', $2, 'indirect') as supplemental_supported,
      public.ownership_context_owner_relation_conflicted($1, 'F2', $2, 'indirect') as supplemental_conflicted`,
    [beneficialOwnershipXml, ownerName]);
    assert.equal(relation.rows[0].supported, true, `${ownerName} beneficial-ownership chain should be accepted`);
    assert.equal(relation.rows[0].supplemental_supported, false, "price-only supplemental evidence is not relation support");
    assert.equal(relation.rows[0].supplemental_conflicted, false, "price-only supplemental evidence is neutral");
  }
  const exactAliasBoundary = await pool.query(`select
    public.ownership_context_owner_relation_supported($1, 'F1', 'Lynrock Lake LP', 'direct') as owner_direct,
    public.ownership_context_owner_relation_supported($1, 'F1', 'Lynrock Lake Master Fund LP', 'direct') as holder_direct,
    public.ownership_context_owner_relation_conflicted($1, 'F1', 'Lynrock Lake Master Fund LP', 'indirect') as holder_indirect_conflict`,
  [beneficialOwnershipXml]);
  assert.equal(exactAliasBoundary.rows[0].owner_direct, false, "a shorter owner alias cannot prefix-match the direct holder");
  assert.equal(exactAliasBoundary.rows[0].holder_direct, true, "the actual direct holder remains source-supported");
  assert.equal(exactAliasBoundary.rows[0].holder_indirect_conflict, true, "the direct-holder clause conflicts with an indirect claim");
  const simpleBeneficialXml = `<ownershipDocument>
    <reportingOwner><rptOwnerName>Alpha Owner</rptOwnerName></reportingOwner>
    <footnotes><footnote id="F1">Alpha Owner may be deemed to beneficially own the shares held by Gamma Fund.</footnote></footnotes>
  </ownershipDocument>`;
  assert.equal((await pool.query(`select public.ownership_context_owner_relation_supported(
    $1, 'F1', 'Alpha Owner', 'indirect'
  ) as supported`, [simpleBeneficialXml])).rows[0].supported, false,
  "a bare name before the legal qualifier is not a structural owner binding");

  const groupedBeneficialXml = `<ownershipDocument>
    <reportingOwner><rptOwnerName>Alpha Owner</rptOwnerName></reportingOwner>
    <reportingOwner><rptOwnerName>Beta Owner</rptOwnerName></reportingOwner>
    <footnotes><footnote id="F1">Alpha Owner advises the fund while its investment manager and general partner are Beta Owner and Gamma Owner, respectively, and each may be deemed to beneficially own the shares held by Delta Fund.</footnote></footnotes>
  </ownershipDocument>`;
  const groupedRelations = await pool.query(`select
    public.ownership_context_owner_relation_supported($1, 'F1', 'Alpha Owner', 'indirect') as outsider_supported,
    public.ownership_context_owner_relation_supported($1, 'F1', 'Beta Owner', 'indirect') as member_supported`,
  [groupedBeneficialXml]);
  assert.equal(groupedRelations.rows[0].outsider_supported, false,
    "an owner mentioned outside the respectively-bound list cannot inherit the relation");
  assert.equal(groupedRelations.rows[0].member_supported, true,
    "an owner explicitly named in the respectively-bound list remains supported");

  const sharedHonorificXml = `<ownershipDocument>
    <reportingOwner><rptOwnerName>SMITH JOHN</rptOwnerName></reportingOwner>
    <reportingOwner><rptOwnerName>SMITH JANE</rptOwnerName></reportingOwner>
    <footnotes><footnote id="F1">Mr. Smith, as trustee, may be deemed to beneficially own the shares held by Delta Fund.</footnote></footnotes>
  </ownershipDocument>`;
  for (const ownerName of ["SMITH JOHN", "SMITH JANE"]) {
    assert.equal((await pool.query(`select public.ownership_context_owner_relation_supported(
      $1, 'F1', $2, 'indirect'
    ) as supported`, [sharedHonorificXml, ownerName])).rows[0].supported, false,
    `shared honorific alias must be rejected for ${ownerName}`);
  }

  const sharedQuotedAliasXml = `<ownershipDocument>
    <reportingOwner><rptOwnerName>Alpha Holdings LLC</rptOwnerName></reportingOwner>
    <reportingOwner><rptOwnerName>Beta Holdings LLC</rptOwnerName></reportingOwner>
    <footnotes><footnote id="F1">Alpha Holdings LLC (&quot;Manager&quot;) and Beta Holdings LLC (&quot;Manager&quot;) are reporting persons; Manager, as adviser, may be deemed to beneficially own the shares held by Delta Fund.</footnote></footnotes>
  </ownershipDocument>`;
  for (const ownerName of ["Alpha Holdings LLC", "Beta Holdings LLC"]) {
    assert.equal((await pool.query(`select public.ownership_context_owner_relation_supported(
      $1, 'F1', $2, 'indirect'
    ) as supported`, [sharedQuotedAliasXml, ownerName])).rows[0].supported, false,
    `shared declared alias must be rejected for ${ownerName}`);
  }

  const reverseCollisionXml = `<ownershipDocument>
    <reportingOwner><rptOwnerName>Paul Cynthia</rptOwnerName></reportingOwner>
    <reportingOwner><rptOwnerName>Cynthia Paul</rptOwnerName></reportingOwner>
    <footnotes><footnote id="F1">Cynthia Paul is the adviser and may be deemed to beneficially own the shares held by Delta Fund.</footnote></footnotes>
  </ownershipDocument>`;
  for (const ownerName of ["Paul Cynthia", "Cynthia Paul"]) {
    assert.equal((await pool.query(`select public.ownership_context_owner_relation_supported(
      $1, 'F1', $2, 'indirect'
    ) as supported`, [reverseCollisionXml, ownerName])).rows[0].supported, false,
    `reverse-name collision must be rejected for ${ownerName}`);
  }
  const forgedMultipleFootnotes = structuredClone(multipleFootnoteRelation);
  forgedMultipleFootnotes[0].assertions[0].footnote_refs = ["footnote:F3", "footnote:F99"];
  assert.equal((await persistContext(firstFingerprint, forgedMultipleFootnotes)).reason, "footnote_row_link_invalid");
  const wrongRowMultipleFootnotes = structuredClone(multipleFootnoteRelation);
  wrongRowMultipleFootnotes[0].row_ref = "row:form4:2";
  wrongRowMultipleFootnotes[0].assertions[0].owner_ref = "owner:form4:2:1";
  wrongRowMultipleFootnotes[0].assertions[0].evidence_refs = ["evidence:form4:2:0"];
  wrongRowMultipleFootnotes[0].assertions[0].footnote_refs = ["footnote:F3", "footnote:F8"];
  assert.equal((await persistContext(firstFingerprint, wrongRowMultipleFootnotes)).reason, "footnote_row_link_invalid");
  const ambiguousSingularAndPlural = structuredClone(multipleFootnoteRelation);
  (ambiguousSingularAndPlural[0].assertions[0] as Record<string, unknown>).footnote_ref = "footnote:F3";
  assert.equal((await persistContext(firstFingerprint, ambiguousSingularAndPlural)).reason, "assertion_shape_invalid");
  const malformedPluralType = structuredClone(multipleFootnoteRelation) as unknown as Record<string, any>[];
  malformedPluralType[0].assertions[0].footnote_refs = "footnote:F3";
  assert.equal((await persistContext(firstFingerprint, malformedPluralType)).reason, "assertion_shape_invalid");
  const duplicatePluralRefs = structuredClone(multipleFootnoteRelation);
  duplicatePluralRefs[0].assertions[0].footnote_refs = ["footnote:F3", "footnote:F3"];
  assert.equal((await persistContext(firstFingerprint, duplicatePluralRefs)).reason, "assertion_shape_invalid");
  const wrongSfsRelation = structuredClone(bothOwnerRelations);
  wrongSfsRelation[0].assertions[1].value = "indirect";
  assert.equal((await persistContext(firstFingerprint, wrongSfsRelation)).reason, "ownership_relation_owner_evidence_invalid");
  const ownerScopeAndPlan = [{ row_ref: "row:form4:0", assertions: [
    {
      fact: "footnote_scope", status: "supported", value: "owner",
      owner_ref: "owner:form4:0:1", footnote_ref: "footnote:F1", evidence_refs: ["evidence:form4:0:0"],
    },
    {
      fact: "rule_10b5_1_applicability", status: "supported", value: true,
      owner_ref: "owner:form4:0:1", footnote_ref: "footnote:F1", evidence_refs: ["evidence:form4:0:0"],
    },
  ] }];
  const ownerScopeAndPlanResult = await persistContext(firstFingerprint, ownerScopeAndPlan);
  assert.equal(ownerScopeAndPlanResult.status, "stored", JSON.stringify(ownerScopeAndPlanResult));
  const wrongPlanOwner = structuredClone(ownerScopeAndPlan);
  wrongPlanOwner[0].assertions[1].owner_ref = "owner:form4:0:0";
  assert.equal((await persistContext(firstFingerprint, wrongPlanOwner)).reason, "rule_10b5_1_owner_evidence_invalid");
  const derivativeRelation = [{ row_ref: "row:form4:4", assertions: [{
    fact: "derivative_underlying_relation", status: "supported",
    value: "security:form4:underlying:4", security_ref: "security:form4:4",
    evidence_refs: ["evidence:form4:4:0"],
  }] }];
  const derivativeRelationResult = await persistContext(firstFingerprint, derivativeRelation);
  assert.equal(derivativeRelationResult.status, "stored", JSON.stringify(derivativeRelationResult));
  const selfLinkedDerivative = structuredClone(derivativeRelation);
  selfLinkedDerivative[0].assertions[0].value = "security:form4:4";
  assert.equal((await persistContext(firstFingerprint, selfLinkedDerivative)).reason, "underlying_security_ref_invalid");
  await pool.query(`update public.event_form4_transactions
    set calculation_basis = calculation_basis || '{"underlying_security_title":"Forged Common"}'::jsonb
    where event_id = $1 and transaction_index = 4`, [eventId]);
  const forgedUnderlyingFingerprint = await currentFingerprint();
  assert.equal(
    (await persistContext(forgedUnderlyingFingerprint, derivativeRelation)).reason,
    "underlying_security_ref_invalid",
    "calculation metadata cannot mint an underlying ref absent from the same XML row",
  );
  await replaceRows(built.form4Transactions);
  assert.equal(await currentFingerprint(), firstFingerprint);
  await pool.query(`update public.event_form4_transactions
    set calculation_basis = pg_catalog.jsonb_set(
      calculation_basis,
      '{footnote_ids}',
      (calculation_basis->'footnote_ids') || '["F2"]'::jsonb
    ) where event_id = $1 and transaction_index = 1`, [eventId]);
  const forgedFootnoteFingerprint = await currentFingerprint();
  const forgedFootnoteScope = [{ row_ref: "row:form4:1", assertions: [{
    fact: "footnote_scope", status: "supported", value: "row",
    footnote_ref: "footnote:F2", evidence_refs: ["evidence:form4:1:0"],
  }] }];
  assert.equal(
    (await persistContext(forgedFootnoteFingerprint, forgedFootnoteScope)).reason,
    "footnote_row_link_invalid",
    "calculation metadata cannot link a footnote absent from the same XML row",
  );
  await replaceRows(built.form4Transactions);
  assert.equal(await currentFingerprint(), firstFingerprint);
  assert.equal((await persistContext(firstFingerprint, context)).status, "stored");
  await assert.rejects(
    pool.query(`update public.event_form4_transactions
      set context_facts = context_facts || '{"raw_model":{"shares":999}}'::jsonb
      where event_id = $1 and transaction_index = 0`, [eventId]),
    (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23514"),
  );
  assert.deepEqual(await directRows(), directBefore, "context-only RPC cannot modify direct columns");

  const replayRows = built.form4Transactions.map((row) => ({ ...row, updated_at: "2030-01-01T00:00:00.000Z" }));
  await replaceRows(replayRows);
  assert.equal(await currentFingerprint(), firstFingerprint, "timestamps are excluded from the source fingerprint");
  assert.equal((await storedContext())?.source_fingerprint, firstFingerprint, "same-input replay preserves context");

  const changedRows = structuredClone(built.form4Transactions);
  changedRows[0].shares = Number(changedRows[0].shares) + 1;
  await replaceRows(changedRows);
  const changedFingerprint = await currentFingerprint();
  assert.notEqual(changedFingerprint, firstFingerprint);
  assert.equal(await storedContext(), null, "changed direct input invalidates context");
  assert.equal((await persistContext(firstFingerprint, context)).status, "stale");

  await replaceRows(built.form4Transactions);
  const restoredFingerprint = await currentFingerprint();
  const restoredContext = validContext(restoredFingerprint);
  const originalCandidate = {
    version: "ownership_context_v1",
    event_ref: `event:${eventId}`,
    form: "form4",
    source_fingerprint: restoredFingerprint,
    rows: restoredContext,
  };
  await pool.query(`insert into public.ai_runs(
    id, event_id, raw_item_id, prompt_key, prompt_version, model, status
  ) values ($1, $2, $3, 'ownership_structured_context', 'ownership_context_llm_v1.3-required-supported-values', 'isolated-fixture', 'completed')`, [
    aiRunId, eventId, rawItemId,
  ]);
  await pool.query(`insert into public.ai_outputs(id, ai_run_id, event_id, output_type, payload)
    values ($1, $2, $3, 'ownership_context_v1', $4::jsonb)`, [
    aiOutputId, aiRunId, eventId, JSON.stringify({
      purpose: "ownership_structured_context",
      mapped_canonical_output: originalCandidate,
    }),
  ]);
  assert.equal((await persistContext(restoredFingerprint, restoredContext, aiRunId, aiOutputId)).status, "stored");
  assert.equal(await semanticVerifierRefsValid(), false, "legacy analysis refs are not semantic-verifier eligibility");
  await pool.query(`insert into public.ai_runs(
    id, event_id, raw_item_id, prompt_key, prompt_version, model, status, metadata
  ) values ($1, $2, $3, 'ownership_semantic_verifier', 'ownership_semantic_verifier_v1',
    'isolated-verifier-stub', 'completed', $4::jsonb)`, [
    verifierRunId, eventId, rawItemId, JSON.stringify({ purpose: "ownership_semantic_verifier" }),
  ]);
  const verifierPayload = {
    purpose: "ownership_semantic_verifier",
    contract_version: "ownership_semantic_verifier_v1",
    source_analysis_refs: { run_id: aiRunId, output_id: aiOutputId },
    original_structured_candidate: originalCandidate,
    verifications: [],
    effective_contexts: restoredContext,
  };
  await pool.query(`insert into public.ai_outputs(id, ai_run_id, event_id, output_type, payload)
    values ($1, $2, $3, 'ownership_context_v1', $4::jsonb)`, [
    verifierOutputId, verifierRunId, eventId, JSON.stringify(verifierPayload),
  ]);
  assert.equal((await persistContext(
    restoredFingerprint, restoredContext, verifierRunId, verifierOutputId,
  )).status, "stored");
  assert.equal(await semanticVerifierRefsValid(), true);
  const verifiedSnapshot = await pool.query(
    "select public.read_event_ownership_context_snapshot($1) as result", [eventId],
  );
  assert.equal(verifiedSnapshot.rows[0].result.context_semantic_verifier_refs_valid, true);

  const mismatchedEffective = structuredClone(verifierPayload);
  mismatchedEffective.effective_contexts[0].assertions[0].value = "buy";
  await updateVerifierPayload(mismatchedEffective);
  assert.equal(await semanticVerifierRefsValid(), false, "partial containment cannot replace exact assertion equality");
  await updateVerifierPayload(verifierPayload);

  const differentCandidate = structuredClone(verifierPayload);
  differentCandidate.original_structured_candidate = {
    ...differentCandidate.original_structured_candidate,
    source_fingerprint: `ownership-context-v1:${"b".repeat(64)}`,
  };
  await updateVerifierPayload(differentCandidate);
  assert.equal(await semanticVerifierRefsValid(), false, "a verifier trace for another candidate is rejected");
  await updateVerifierPayload(verifierPayload);

  const staleClient = await pool.connect();
  try {
    await staleClient.query("begin");
    await staleClient.query(`update public.raw_items set raw_payload = pg_catalog.jsonb_set(
      raw_payload, '{ownership_source_text}', pg_catalog.to_jsonb((raw_payload->>'ownership_source_text') || ' ')
    ) where id = $1`, [rawItemId]);
    const staleTrace = await staleClient.query(
      "select public.ownership_context_semantic_verifier_refs_valid($1) as valid", [eventId],
    );
    assert.equal(staleTrace.rows[0].valid, false, "a verifier trace cannot survive source fingerprint drift");
  } finally {
    await staleClient.query("rollback");
    staleClient.release();
  }
  assert.equal(await semanticVerifierRefsValid(), true);
  assert.equal((await persistContext(
    restoredFingerprint, restoredContext,
    "a5555555-5555-4555-8555-555555555555", aiOutputId,
  )).reason, "ai_refs_lineage_invalid");

  await replaceRows(built.form4Transactions);
  const raceFingerprint = await currentFingerprint();
  await persistContext(raceFingerprint, validContext(raceFingerprint));
  const contextFirst = await raceWithAdvisoryLock({
    first: () => persistContext(raceFingerprint, validContext(raceFingerprint)),
    second: () => replaceRows(changedRows),
  });
  assert.equal(contextFirst.first.status, "replayed");
  assert.equal(await storedContext(), null, "replacement after a context write invalidates changed input context");

  await replaceRows(built.form4Transactions);
  const replacementFirstFingerprint = await currentFingerprint();
  const replacementFirst = await raceWithAdvisoryLock({
    first: () => replaceRows(changedRows),
    second: () => persistContext(replacementFirstFingerprint, validContext(replacementFirstFingerprint)),
  });
  assert.equal(replacementFirst.second.status, "stale", "context validated before replacement is rejected after changed replacement wins");
  assert.equal(await storedContext(), null);

  await replaceRows(built.form4Transactions);
  const rawRaceFingerprint = await currentFingerprint();
  const rawClient = await pool.connect();
  try {
    await rawClient.query("begin");
    await rawClient.query(`update public.raw_items
      set raw_payload = pg_catalog.jsonb_set(raw_payload, '{ownership_source_text}', pg_catalog.to_jsonb((raw_payload->>'ownership_source_text') || ' '))
      where id = $1`, [rawItemId]);
    const pendingWrite = persistContext(rawRaceFingerprint, validContext(rawRaceFingerprint));
    await delay(100);
    await rawClient.query("commit");
    assert.equal((await pendingWrite).status, "stale", "raw update is serialized before fingerprint acceptance");
  } finally {
    try { await rawClient.query("rollback"); } catch {}
    rawClient.release();
  }
  const unavailable = await pool.query(
    "select public.get_event_ownership_context_fingerprint($1) as result",
    [eventId],
  );
  assert.equal(unavailable.rows[0].result.status, "not_ready", "raw XML drift cannot mint a mixed old-row/new-raw fingerprint");

  const venuEventId = "c1111111-1111-4111-8111-111111111111";
  const venuRawItemId = "c2222222-2222-4222-8222-222222222222";
  const venuSourceText = String(venuFixture.filingText);
  const venuAccession = String(venuFixture.accessionNumber);
  const venuRawItem = {
    id: venuRawItemId,
    source_unique_id: venuAccession,
    raw_payload: {
      form_type: venuFixture.formType,
      accession_number: venuAccession,
      cik: xmlValue(venuSourceText, "issuerCik"),
      ownership_issuer_cik: xmlValue(venuSourceText, "issuerCik"),
      ticker: xmlValue(venuSourceText, "issuerTradingSymbol"),
      ownership_issuer_trading_symbol: xmlValue(venuSourceText, "issuerTradingSymbol"),
      ownership_source_text: venuSourceText,
      ownership_source_url: (venuFixture.source as Record<string, unknown>).url,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const builtVenu = buildOwnershipParserFactRows({
    eventId: venuEventId,
    rawItem: venuRawItem,
    symbol: xmlValue(venuSourceText, "issuerTradingSymbol"),
  });
  assert.equal(builtVenu.form4Transactions.length, 1);
  await pool.query("insert into public.raw_items(id, source_unique_id, raw_payload) values ($1, $2, $3::jsonb)", [
    venuRawItemId, venuAccession, JSON.stringify(venuRawItem.raw_payload),
  ]);
  await pool.query(`insert into public.events(
    id, raw_item_id, source_code, source_group, event_type, metadata
  ) values ($1, $2, 'sec_edgar', 'filings', 'insider_ownership', $3::jsonb)`, [
    venuEventId, venuRawItemId,
    JSON.stringify({ form_type: venuFixture.formType, accession_number: venuAccession }),
  ]);
  await pool.query("select public.replace_event_ownership_facts($1, $2::jsonb, '[]'::jsonb)", [
    venuEventId, JSON.stringify(builtVenu.form4Transactions),
  ]);
  const venuFingerprint = String((await pool.query(
    "select public.ownership_context_source_fingerprint($1) as fingerprint", [venuEventId],
  )).rows[0].fingerprint);
  const venuActualContext = [{ row_ref: "row:form4:0", assertions: [
    {
      fact: "owner_attribution", status: "supported", value: "owner:form4:0:0",
      evidence_refs: ["evidence:form4:0:0"],
    },
    {
      fact: "ownership_relation", status: "supported", value: "direct", owner_ref: "owner:form4:0:0",
      evidence_refs: ["evidence:form4:0:0"],
    },
    {
      fact: "derivative_underlying_relation", status: "supported", value: "security:form4:underlying:0",
      security_ref: "security:form4:0", evidence_refs: ["evidence:form4:0:0"],
    },
    { fact: "rule_10b5_1_applicability", status: "unresolved", evidence_refs: [] },
    {
      fact: "footnote_scope", status: "supported", value: "row", footnote_ref: "footnote:F1",
      evidence_refs: ["evidence:form4:0:0"],
    },
    {
      fact: "footnote_scope", status: "supported", value: "owner", owner_ref: "owner:form4:0:0",
      footnote_ref: "footnote:F1", evidence_refs: ["evidence:form4:0:0"],
    },
  ] }];
  assert.equal(
    (await persistContextFor(venuEventId, "form4", venuFingerprint, venuActualContext)).status,
    "stored",
  );
  const venuSelfLink = structuredClone(venuActualContext);
  venuSelfLink[0].assertions[2].value = "security:form4:0";
  assert.equal(
    (await persistContextFor(venuEventId, "form4", venuFingerprint, venuSelfLink)).reason,
    "underlying_security_ref_invalid",
  );
  const soleSelfReference = await pool.query(`select
    public.ownership_context_footnote_establishes_owner_scope($1, 'F1', 'Solo Owner') as scope_ok,
    public.ownership_context_footnote_mentions_owner($1, 'F1', 'Solo Owner') as plan_owner_ok`, [
    `<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Solo Owner</rptOwnerName></reportingOwnerId></reportingOwner><footnotes><footnote id="F1">Under a Rule 10b5-1 plan, the Reporting Person acted.</footnote></footnotes></ownershipDocument>`,
  ]);
  assert.equal(soleSelfReference.rows[0].scope_ok, true);
  assert.equal(soleSelfReference.rows[0].plan_owner_ok, false, "Rule 10b5-1 owner checks retain explicit-name policy");
  for (const unsafeText of [
    "The Reporting Persons acted.",
    "The other Reporting Person acted.",
    "Another Reporting Person acted.",
  ]) {
    const unsafe = await pool.query(
      "select public.ownership_context_footnote_establishes_owner_scope($1, 'F1', 'Solo Owner') as result",
      [`<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Solo Owner</rptOwnerName></reportingOwnerId></reportingOwner><footnotes><footnote id="F1">${unsafeText}</footnote></footnotes></ownershipDocument>`],
    );
    assert.equal(unsafe.rows[0].result, false, unsafeText);
  }
  const multiOwnerSelfReference = await pool.query(
    "select public.ownership_context_footnote_establishes_owner_scope($1, 'F1', 'Alpha Owner') as result",
    [`<ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>Alpha Owner</rptOwnerName></reportingOwnerId></reportingOwner><reportingOwner><reportingOwnerId><rptOwnerName>Beta Owner</rptOwnerName></reportingOwnerId></reportingOwner><footnotes><footnote id="F1">The Reporting Person acted.</footnote></footnotes></ownershipDocument>`],
  );
  assert.equal(multiOwnerSelfReference.rows[0].result, false);

  const form144Fixture = JSON.parse(readFileSync(
    join(here, "../lib/sources/sec/forms/ownership/fixtures/source-amcor-form144-no-prior-sales.json"),
    "utf8",
  )) as Record<string, unknown>;
  const form144EventId = "b1111111-1111-4111-8111-111111111111";
  const form144RawItemId = "b2222222-2222-4222-8222-222222222222";
  const form144SourceText = String(form144Fixture.filingText);
  const form144Accession = String(form144Fixture.accessionNumber);
  const form144RawItem = {
    id: form144RawItemId,
    source_unique_id: form144Accession,
    raw_payload: {
      form_type: form144Fixture.formType,
      accession_number: form144Accession,
      cik: xmlValue(form144SourceText, "issuerCik"),
      ownership_issuer_cik: xmlValue(form144SourceText, "issuerCik"),
      ticker: "AMCR",
      ownership_issuer_trading_symbol: "AMCR",
      ownership_source_text: form144SourceText,
      ownership_source_url: (form144Fixture.source as Record<string, unknown>).url,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const built144 = buildOwnershipParserFactRows({ eventId: form144EventId, rawItem: form144RawItem, symbol: "AMCR" });
  assert.equal(built144.form144ProposedSales.length, 1);
  await pool.query("insert into public.raw_items(id, source_unique_id, raw_payload) values ($1, $2, $3::jsonb)", [
    form144RawItemId, form144Accession, JSON.stringify(form144RawItem.raw_payload),
  ]);
  await pool.query(`insert into public.events(
    id, raw_item_id, source_code, source_group, event_type, metadata
  ) values ($1, $2, 'sec_edgar', 'filings', 'insider_ownership', $3::jsonb)`, [
    form144EventId, form144RawItemId,
    JSON.stringify({ form_type: form144Fixture.formType, accession_number: form144Accession }),
  ]);
  await pool.query("select public.replace_event_ownership_facts($1, '[]'::jsonb, $2::jsonb)", [
    form144EventId, JSON.stringify(built144.form144ProposedSales),
  ]);
  const form144FingerprintResult = await pool.query(
    "select public.ownership_context_source_fingerprint($1) as fingerprint", [form144EventId],
  );
  const form144Fingerprint = String(form144FingerprintResult.rows[0].fingerprint);
  const form144OwnerContext = [{ row_ref: "row:form144:0", assertions: [{
    fact: "owner_attribution", status: "supported", value: "owner:form144:0:0",
    evidence_refs: ["evidence:form144:0:0"],
  }] }];
  assert.equal((await persistContextFor(form144EventId, "form144", form144Fingerprint, form144OwnerContext)).status, "stored");
  const form144Relation = [{ row_ref: "row:form144:0", assertions: [{
    fact: "ownership_relation", status: "unresolved", evidence_refs: [],
  }] }];
  assert.equal(
    (await persistContextFor(form144EventId, "form144", form144Fingerprint, form144Relation)).reason,
    "ownership_relation_not_applicable",
  );
  const form144Plan = [{ row_ref: "row:form144:0", assertions: [{
    fact: "rule_10b5_1_applicability", status: "unresolved", evidence_refs: [],
  }] }];
  assert.equal(
    (await persistContextFor(form144EventId, "form144", form144Fingerprint, form144Plan)).reason,
    "rule_10b5_1_not_applicable",
  );
  const form144Scope = [{ row_ref: "row:form144:0", assertions: [{
    fact: "footnote_scope", status: "unresolved", evidence_refs: [],
  }] }];
  assert.equal(
    (await persistContextFor(form144EventId, "form144", form144Fingerprint, form144Scope)).reason,
    "footnote_scope_invalid",
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    isolatedDatabase: { host: databaseUrl.hostname, port: databaseUrl.port, database: databaseUrl.pathname.slice(1) },
    assertions: {
      migrationsApplied: migrations.length,
      anonymousRpcExecutionRevoked: true,
      sqlNullAndJsonNullRejected: true,
      rawModelEnvelopeRejectedByConstraint: true,
      directColumnsUnchangedByContextWrite: true,
      explicitEmptyResultClearsPriorSidecars: true,
      malformedOpaqueRefsRejectWithoutException: true,
      multipleFootnoteRefsPreservedInOrder: true,
      malformedDuplicateForgedAndWrongRowFootnoteRefsRejected: true,
      conflictingOwnerEvidenceRejected: true,
      explicitBeneficialOwnershipAliasesAndNeutralSupplementalEvidenceVerified: true,
      ambiguousAliasesAndGroupedBindingsFailClosed: true,
      multiOwnerRelationsRequireOwnerBoundFootnoteClauses: true,
      ownerScopedPlanRequiresMatchingFootnoteSubject: true,
      derivativeTargetUsesIndependentSourceBoundRef: true,
      calculationMetadataCannotForgeXmlBindings: true,
      form144AllowsAttributionButRejectsRelationPlanAndUnlinkedScope: true,
      venuActualCanonicalContextPersists: true,
      soleReportingPersonScopeIsNarrowAndSqlParityVerified: true,
      rule10b51OwnerPolicyUnchanged: true,
      sameInputReplayPreserved: true,
      changedInputInvalidated: true,
      staleFingerprintRejected: true,
      aiReferenceForgeryRejected: true,
      legacyContextVerifierLineageRejected: true,
      semanticVerifierTraceBoundToCandidateAndExactEffectiveAssertions: true,
      staleSemanticVerifierTraceRejected: true,
      contextThenReplacementRaceSafe: true,
      replacementThenContextRaceSafe: true,
      rawUpdateRaceSafe: true,
    },
  }, null, 2)}\n`);
} finally {
  await pool.end();
}

async function replaceRows(rows: readonly Record<string, unknown>[]) {
  const result = await pool.query(
    "select public.replace_event_ownership_facts($1, $2::jsonb, '[]'::jsonb) as result",
    [eventId, JSON.stringify(rows)],
  );
  return result.rows[0].result as Record<string, unknown>;
}

async function persistContext(
  sourceFingerprint: string,
  contexts: readonly Record<string, unknown>[],
  runId: string | null = null,
  outputId: string | null = null,
) {
  const result = await pool.query(
    "select public.persist_event_ownership_context($1, 'form4', $2, $3::jsonb, $4, $5) as result",
    [eventId, sourceFingerprint, JSON.stringify(contexts), runId, outputId],
  );
  return result.rows[0].result as Record<string, any>;
}

async function persistContextFor(
  targetEventId: string,
  form: "form4" | "form144",
  sourceFingerprint: string,
  contexts: readonly Record<string, unknown>[],
) {
  const result = await pool.query(
    "select public.persist_event_ownership_context($1, $2, $3, $4::jsonb, null, null) as result",
    [targetEventId, form, sourceFingerprint, JSON.stringify(contexts)],
  );
  return result.rows[0].result as Record<string, any>;
}

async function currentFingerprint() {
  const result = await pool.query("select public.ownership_context_source_fingerprint($1) as fingerprint", [eventId]);
  return String(result.rows[0].fingerprint || "");
}

async function directRows() {
  const result = await pool.query(`select pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(row_value) - 'created_at' - 'updated_at' - 'context_facts'
    order by transaction_index
  ) as rows from public.event_form4_transactions as row_value where event_id = $1`, [eventId]);
  return result.rows[0].rows;
}

async function storedContext() {
  return storedContextAt(0);
}

async function storedContextAt(transactionIndex: number) {
  const result = await pool.query(`select context_facts from public.event_form4_transactions
    where event_id = $1 and transaction_index = $2`, [eventId, transactionIndex]);
  return result.rows[0].context_facts as Record<string, any> | null;
}

async function semanticVerifierRefsValid() {
  const result = await pool.query(
    "select public.ownership_context_semantic_verifier_refs_valid($1) as valid", [eventId],
  );
  return result.rows[0].valid as boolean;
}

async function updateVerifierPayload(payload: unknown) {
  await pool.query("update public.ai_outputs set payload = $2::jsonb where id = $1", [
    verifierOutputId, JSON.stringify(payload),
  ]);
}

function validContext(sourceFingerprint: string) {
  return [{
    row_ref: "row:form4:0",
    assertions: [{
      fact: "economic_direction",
      status: "supported",
      value: "sell",
      evidence_refs: ["evidence:form4:0:0"],
    }],
  }];
}

async function raceWithAdvisoryLock(input: {
  first(): Promise<Record<string, any>>;
  second(): Promise<Record<string, any>>;
}) {
  const blocker = await pool.connect();
  try {
    await blocker.query("begin");
    await blocker.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ownership-context:' || $1::text, 0))", [eventId]);
    const first = input.first();
    await delay(100);
    const second = input.second();
    await delay(100);
    await blocker.query("commit");
    return { first: await first, second: await second };
  } finally {
    try { await blocker.query("rollback"); } catch {}
    blocker.release();
  }
}

function assertIsolatedDatabase(url: URL, expectedPort: string) {
  assert.ok(new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname), "database must be loopback-only");
  assert.equal(url.port, expectedPort);
  assert.ok(url.pathname.startsWith("/ownership_context_isolated_"), "database name must be dedicated to ownership context isolation");
  assert.notEqual(url.port, "5432");
  assert.notEqual(url.port, "56322", "shared-local database port is forbidden");
}

function xmlValue(sourceText: string, localName: string) {
  return sourceText.match(new RegExp(`<${localName}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${localName}>`, "i"))?.[1]?.trim() ?? null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baselineSql() {
  return String.raw`
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $block$ begin create role service_role nologin; exception when duplicate_object then null; end $block$;
do $block$ begin create role anon nologin; exception when duplicate_object then null; end $block$;
do $block$ begin create role authenticated nologin; exception when duplicate_object then null; end $block$;
create table public.raw_items (
  id uuid primary key, source_unique_id text not null, raw_payload jsonb not null
);
create table public.events (
  id uuid primary key, raw_item_id uuid references public.raw_items(id), source_code text,
  source_group text, event_type text, metadata jsonb not null default '{}'::jsonb
);
create table public.ai_runs (
  id uuid primary key, event_id uuid references public.events(id), raw_item_id uuid references public.raw_items(id),
  prompt_key text not null, prompt_version text not null, model text not null, status text not null,
  metadata jsonb not null default '{}'::jsonb
);
create table public.ai_outputs (
  id uuid primary key, ai_run_id uuid not null references public.ai_runs(id), event_id uuid references public.events(id),
  output_type text not null, payload jsonb not null
);
create table public.event_form4_transactions (
  event_id uuid not null references public.events(id) on delete cascade, transaction_index integer not null,
  symbol text, reporting_owner_names jsonb not null default '[]', reporting_owner_roles jsonb not null default '[]',
  officer_titles jsonb not null default '[]', is_officer boolean, is_director boolean, is_10_percent_owner boolean,
  officer_title text, is_10b5_1 boolean, transaction_kind text, security_title text, transaction_date date,
  deemed_execution_date date, transaction_code text, acquired_disposed_code text, economic_direction text,
  shares numeric, shares_quality text, price_per_share numeric, price_per_share_quality text,
  transaction_value numeric, transaction_value_quality text, post_transaction_shares numeric,
  shares_value_quality text, shares_availability text, price_per_share_value_quality text,
  price_per_share_availability text, transaction_value_value_quality text, transaction_value_availability text,
  post_transaction_shares_value_quality text, post_transaction_shares_availability text,
  direct_or_indirect_ownership text, nature_of_ownership text, fact_as_of date, confidence numeric,
  provenance jsonb not null, evidence jsonb not null default '[]', calculation_basis jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(event_id, transaction_index)
);
create table public.event_form144_proposed_sales (
  event_id uuid not null references public.events(id) on delete cascade, proposed_sale_index integer not null,
  symbol text, seller_name text, reporting_owner_names jsonb not null default '[]', security_title text, exchange text,
  securities_to_be_sold numeric, securities_to_be_sold_quality text, aggregate_market_value numeric,
  aggregate_market_value_quality text, approximate_sale_date date, shares_outstanding numeric,
  shares_outstanding_quality text, proposed_sale_percent numeric, proposed_sale_percent_quality text,
  securities_to_be_sold_value_quality text, securities_to_be_sold_availability text,
  aggregate_market_value_value_quality text, aggregate_market_value_availability text,
  shares_outstanding_value_quality text, shares_outstanding_availability text,
  proposed_sale_percent_value_quality text, proposed_sale_percent_availability text,
  fact_as_of date, confidence numeric, provenance jsonb not null, evidence jsonb not null default '[]',
  calculation_basis jsonb not null default '{}', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), primary key(event_id, proposed_sale_index)
);
grant select, insert, update, delete on all tables in schema public to service_role;
`;
}
