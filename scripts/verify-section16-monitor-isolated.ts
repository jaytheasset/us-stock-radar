import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

type Row = Record<string, any>;
type Fixture = {
  file: string;
  formType: "3" | "3/A" | "5" | "5/A";
  accessionNumber: string;
  issuerCik: string;
  filingDate: string;
  acceptedAt: string;
  sourceUrl: string;
  sha256: string;
};
type DbClient = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Row[] }>;
};

const PgClient = (createRequire(import.meta.url)("pg") as {
  Client: new (options: { connectionString: string }) => DbClient;
}).Client;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    if (specifier.startsWith("@/")) {
      const base = new URL(`../${specifier.slice(2)}`, import.meta.url);
      const file = new URL(`${base.href}.ts`);
      const index = new URL(`${base.href}/index.ts`);
      return nextResolve(existsSync(fileURLToPath(file)) ? file.href : index.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const dbUrl = requiredEnv("SECTION16_MONITOR_ISOLATED_DB_URL");
const apiUrl = requiredEnv("SUPABASE_URL");
const expectedPort = requiredEnv("SECTION16_MONITOR_ISOLATED_DB_PORT");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
assert.equal(new URL(dbUrl).port, expectedPort);
assert.equal(new URL(dbUrl).hostname, "127.0.0.1");
assert.equal(expectedPort, "59122");
assert.equal(new URL(apiUrl).hostname, "127.0.0.1");
assert.equal(new URL(apiUrl).port, "59121");

const isolatedOrigin = new URL(apiUrl).origin;
const networkLedger: Array<{ method: string; origin: string; allowed: boolean }> = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const allowed = url.origin === isolatedOrigin;
  networkLedger.push({ method: init?.method ?? (input instanceof Request ? input.method : "GET"), origin: url.origin, allowed });
  if (!allowed) throw new Error(`network guard blocked ${url.origin}`);
  return nativeFetch(input, init);
};

process.env.S_ENVIRONMENT = "local";
process.env.SUPABASE_DB_URL = dbUrl;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM_PUBLIC = "false";
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";

const [rawStore, persistence, parser, currentState, canonical, monitorFacts, conditionPersistence, listingPersistence, matcher] = await Promise.all([
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-section16-xml/persistence.ts"),
  import("../lib/sources/sec/forms/section16Xml/parser.ts"),
  import("../lib/sec-section16-xml/currentState.ts"),
  import("../lib/sec-section16-xml/canonical.ts"),
  import("../lib/monitor/section16MonitorFacts.ts"),
  import("../lib/monitor/section16MonitorPersistence.ts"),
  import("../lib/monitor/listingMonitorPersistence.ts"),
  import("../lib/section16MonitorMatcher.ts"),
]);

const fixtureDir = path.resolve("lib/sources/sec/forms/section16Xml/fixtures");
const manifests = await Promise.all(["sources.json", "lineage-sources.json"].map(async (file) => (
  JSON.parse(await readFile(path.join(fixtureDir, file), "utf8")) as { fixtures: Fixture[] }
)));
const fixtures = manifests.flatMap((manifest) => manifest.fixtures);
const desktopSource = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "Desktop") : "";
const desktopEvidence = new Map([
  ["0000891839-26-000252", {
    attachmentSha256: "3bf16db8bcd2e49c054f816f892ebc02e26ee2a9dff547e28fede8b6434b2a1b",
    xmlSha256: "c3a49335c43da225011bd63cacbd1001efd5558e93ece1e06135df6044778ba9",
    fileName: "form3a.xml",
  }],
  ["0000036146-26-000004", {
    attachmentSha256: "0cc39dafc8c6126b18e556bf6fa8d9c9afd958ff7f39b3fe260306da613fbf42",
    xmlSha256: "f6e0c48d21865da3886c1739758c3085121f76bce93c90cd6f8f710d4906ee91",
    fileName: "form5.xml",
  }],
  ["0000094049-26-000015", {
    attachmentSha256: "3826c3cee0c1b0415514d53e84ab2f43386a37bdc144ed2dda00e52f67d7576f",
    xmlSha256: "3bf89e5b0054575ebcd2abb18adce9b2f539b8a095b12ae3bde373635fc64a50",
    fileName: "form5a.xml",
  }],
]);
const selectedAccessions = [
  "0000891839-26-000252",
  "0000891839-26-000231",
  "0001127602-25-004959",
  "0000094049-26-000015",
  "0000036146-26-000004",
];
const actualFixtures = selectedAccessions.map(requiredFixture);
const syntheticAccessions = ["0000036146-26-900001", "0000036146-26-900002", "0000036146-26-900003"];
const allAccessions = [...selectedAccessions, ...syntheticAccessions];
const outputPath = process.env.SECTION16_LINEAGE_E2E_OUTPUT
  ?? path.join(requiredEnv("TEMP"), "stockradar-section16-aa5b-monitor-e2e.json");
const statusPath = process.env.SECTION16_LINEAGE_STATUS_OUTPUT
  ?? path.join(requiredEnv("TEMP"), "stockradar-section16-aa5b-supabase-status.json");
const admin = new PgClient({ connectionString: dbUrl });
await admin.connect();

const output: Row = {
  ok: false,
  isolated: {
    projectId: "stock-radar-section16-aa5b-20260912",
    apiOrigin: isolatedOrigin,
    databaseHost: new URL(dbUrl).hostname,
    databasePort: Number(expectedPort),
    sharedPortsRejected: [56321, 56322],
  },
  evidence: [],
};

try {
  const target = await admin.query(`
    select current_database() as database_name,
      current_setting('server_version') as server_version,
      to_regclass('public.sec_section16_filings')::text as canonical_table
  `);
  assert.equal(target.rows[0]?.canonical_table, "sec_section16_filings");
  assert.equal(await countByAccessions("sec_section16_filings", "accession_number", allAccessions), 0);
  assert.equal(await countByAccessions("raw_items", "source_unique_id", allAccessions), 0);

  await rawStore.ensureSecSource();
  const runId = randomUUID();
  assert.equal(await rawStore.createSecSourceRun({
    force: false,
    includeDocuments: true,
    requestedFormTypes: ["3", "3/A", "5", "5/A"],
    runId,
    startedAt: new Date().toISOString(),
  }), "running");

  const owner = await createAuthUser("owner");
  const other = await createAuthUser("other");
  const profiles = await admin.query(
    "select id from public.user_profiles where id = any($1::uuid[]) order by id",
    [[owner.id, other.id]],
  );
  assert.equal(profiles.rows.length, 2, "both isolated auth users have valid profiles");
  const createConditionSet = (conditions: Row[]) => conditionPersistence.createSection16MonitorConditionSet({
    ownerId: owner.id,
    conditions,
  });
  const evaluate = async (
    accessionNumber: string,
    savedConditionSet: Awaited<ReturnType<typeof conditionPersistence.createSection16MonitorConditionSet>>,
  ) => {
    const readback = await conditionPersistence.readSection16MonitorConditionSetForOwner(owner.id, savedConditionSet.id);
    assert.equal(readback.status, "available", `${savedConditionSet.id} condition readback`);
    if (readback.status !== "available") throw new Error("Section 16 condition readback unavailable");
    return matcher.evaluateSection16MonitorFiling({ accessionNumber, conditionSet: readback.conditionSet });
  };
  const ggrpCommon = await createConditionSet([
    { key: "ownership.section16.holding.security_title", operator: "eq", value: "Common Stock" },
    { key: "ownership.section16.holding.amount_owned", operator: "eq", value: "20000" },
    { key: "ownership.section16.holding.direct_or_indirect", operator: "eq", value: "D" },
  ]);
  let missingOriginalDirectMatch: Row | null = null;

  const actualCases = new Map<string, Row>();
  for (const fixture of actualFixtures) {
    const source = await fixtureCase(fixture);
    actualCases.set(fixture.accessionNumber, source);
    output.evidence.push({
      accessionNumber: source.fixture.accessionNumber,
      formType: source.fixture.formType,
      sourceUrl: source.fixture.sourceUrl,
      sourceSha256: source.fixture.sha256,
      sourceKind: source.sourceKind,
      localEvidencePath: source.localEvidencePath,
      attachmentSha256: source.attachmentSha256 ?? null,
      transactions: source.parsed.transactions.length,
      holdings: source.parsed.holdings.length,
    });
  }

  const insertionOrder = [
    "0000891839-26-000252",
    "0000891839-26-000231",
    "0001127602-25-004959",
    "0000094049-26-000015",
    "0000036146-26-000004",
  ];
  const persisted = new Map<string, Row>();
  for (const accession of insertionOrder) {
    const source = actualCases.get(accession)!;
    const saved = await rawStore.saveSecRawItem(source.rawItem, runId);
    const rawItemId = String(saved.id);
    if (accession === insertionOrder[0]) {
      const concurrent = await Promise.all([
        persistence.persistSection16CanonicalXmlForRawItem({ rawItemId, rawItem: source.rawItem }),
        persistence.persistSection16CanonicalXmlForRawItem({ rawItemId, rawItem: source.rawItem }),
      ]);
      assert.deepEqual(concurrent.map((item) => item.writeStatus).sort(), ["inserted", "replayed"]);
      output.concurrentFirstWrite = concurrent.map((item) => item.writeStatus);
    } else {
      const result = await persistence.persistSection16CanonicalXmlForRawItem({ rawItemId, rawItem: source.rawItem });
      assert.equal(result.writeStatus, "inserted");
    }
    persisted.set(accession, { rawItemId, rawItem: source.rawItem });
    if (accession === "0000891839-26-000252") {
      const missingOriginal = await currentState.readSection16IssuerCurrentState("1854445");
      assert.equal(missingOriginal.status, "available");
      if (missingOriginal.status !== "available") throw new Error("GGRP missing-original read unavailable");
      assert.equal(missingOriginal.lineage.links[0]?.reason, "original_not_stored");
      missingOriginalDirectMatch = await evaluate(accession, ggrpCommon);
      assert.equal(missingOriginalDirectMatch.status, "match");
      assert.equal(missingOriginalDirectMatch.evidence?.matchedFilingRowCount, 1);
      output.missingOriginal = { accessionNumber: accession, reason: missingOriginal.lineage.links[0]?.reason };
    }
  }

  const stepanNormal = await currentState.readSection16IssuerCurrentState("94049");
  assert.equal(stepanNormal.status, "available");
  if (stepanNormal.status !== "available") throw new Error("Stepan normal-order read unavailable");
  const stepanPair = ["0001127602-25-004959", "0000094049-26-000015"];
  await admin.query("delete from public.sec_section16_filings where accession_number = any($1::text[])", [stepanPair]);
  const reverseAmendment = persisted.get("0000094049-26-000015")!;
  const reverseOriginal = persisted.get("0001127602-25-004959")!;
  assert.equal((await persistence.persistSection16CanonicalXmlForRawItem({
    rawItemId: String(reverseAmendment.rawItemId),
    rawItem: reverseAmendment.rawItem,
  })).writeStatus, "inserted");
  const stepanMissing = await currentState.readSection16IssuerCurrentState("94049");
  assert.equal(stepanMissing.status, "available");
  if (stepanMissing.status !== "available") throw new Error("Stepan reverse missing-original read unavailable");
  assert.equal(stepanMissing.lineage.links[0]?.reason, "original_not_stored");
  assert.equal((await persistence.persistSection16CanonicalXmlForRawItem({
    rawItemId: String(reverseOriginal.rawItemId),
    rawItem: reverseOriginal.rawItem,
  })).writeStatus, "inserted");
  const stepanReverse = await currentState.readSection16IssuerCurrentState("94049");
  assert.equal(stepanReverse.status, "available");
  if (stepanReverse.status !== "available") throw new Error("Stepan reverse-order read unavailable");
  assert.deepEqual(stepanReverse.lineage, stepanNormal.lineage, "normal and reverse persistence project identically");
  output.persistenceOrder = { normalThenReverseSameProjection: true, isolatedHarnessResetOnly: true };

  for (const fixture of actualFixtures) {
    const read = await persistence.readSection16FilingByAccession(fixture.accessionNumber);
    assert.equal(read.status, "available", `${fixture.accessionNumber} validated readback`);
    if (read.status !== "available") throw new Error("validated readback unavailable");
    assert.equal(read.filing.source_sha256, actualCases.get(fixture.accessionNumber)!.fixture.sha256);
  }

  const trustmarkBase = actualCases.get("0000036146-26-000004")!;
  const repeated = syntheticCase(trustmarkBase, {
    accessionNumber: syntheticAccessions[0]!,
    formType: "5",
    filingDate: "2026-03-02",
    acceptedAt: "2026-03-02 12:00:00",
    xml: trustmarkBase.xml,
  });
  const affirmativeXml = amendmentXml(
    trustmarkBase.xml,
    "The transaction on 2025-04-29 for 10 shares of Common Stock, transaction code P, was previously reported in Form 5 filed 2026-02-13 and is unchanged.",
  );
  const affirmative = syntheticCase(trustmarkBase, {
    accessionNumber: syntheticAccessions[1]!,
    formType: "5/A",
    filingDate: "2026-03-03",
    acceptedAt: "2026-03-03 12:00:00",
    xml: affirmativeXml,
  });
  const changedOmittedXml = removeTransactionByDate(
    replaceFirstTransactionShares(amendmentXml(trustmarkBase.xml, ""), "10", "11"),
    "2025-07-08",
  );
  const changedOmitted = syntheticCase(trustmarkBase, {
    accessionNumber: syntheticAccessions[2]!,
    formType: "5/A",
    filingDate: "2026-03-04",
    acceptedAt: "2026-03-04 12:00:00",
    xml: changedOmittedXml,
  });
  for (const source of [repeated, affirmative, changedOmitted]) {
    const saved = await rawStore.saveSecRawItem(source.rawItem as never, runId);
    const result = await persistence.persistSection16CanonicalXmlForRawItem({ rawItemId: String(saved.id), rawItem: source.rawItem });
    assert.equal(result.writeStatus, "inserted");
  }

  const replayResults = await Promise.all([...persisted.values()].map((item) => (
    persistence.persistSection16CanonicalXmlForRawItem({ rawItemId: item.rawItemId, rawItem: item.rawItem })
  )));
  assert.ok(replayResults.every((item) => item.writeStatus === "replayed"));
  const sameAccession = persisted.get("0000891839-26-000252")!;
  const concurrentReplayResults = await Promise.all([0, 1, 2].map(() => (
    persistence.persistSection16CanonicalXmlForRawItem({
      rawItemId: sameAccession.rawItemId,
      rawItem: sameAccession.rawItem,
    })
  )));
  assert.ok(concurrentReplayResults.every((item) => item.writeStatus === "replayed"));

  const mismatchSource = structuredClone(persisted.get("0000891839-26-000252")!);
  mismatchSource.rawItem.raw_payload.ownership_source_text = mismatchSource.rawItem.raw_payload.ownership_source_text.replace("Glimpse", "Flimpse");
  const beforeMismatch = await countByAccessions("sec_section16_filings", "accession_number", allAccessions);
  await assert.rejects(
    persistence.persistSection16CanonicalXmlForRawItem({ rawItemId: mismatchSource.rawItemId, rawItem: mismatchSource.rawItem }),
    (error) => error instanceof canonical.Section16CanonicalSourceError && error.code === "stored_source_mismatch",
  );
  assert.equal(await countByAccessions("sec_section16_filings", "accession_number", allAccessions), beforeMismatch);

  const ggrp = await currentState.readSection16IssuerCurrentState("1854445");
  assert.equal(ggrp.status, "available");
  if (ggrp.status !== "available") throw new Error("GGRP lineage unavailable");
  assert.equal(ggrp.lineage.links[0]?.status, "linked");
  assert.equal(ggrp.lineage.links[0]?.reason, null);
  assert.equal(ggrp.lineage.links[0]?.evidence.securityIdentity, "unresolved");
  assert.equal(ggrp.lineage.transactions.length, 0);
  assert.equal(ggrp.lineage.holdings.length, 2);
  assert.equal(ggrp.lineage.holdingAdditions.length, 2);
  assert.ok(ggrp.lineage.holdingAdditions.every((item) => (
    item.meaning === "disclosure_added_not_acquisition_or_purchase"
  )));

  const stepan = await currentState.readSection16IssuerCurrentState("94049");
  assert.equal(stepan.status, "available");
  if (stepan.status !== "available") throw new Error("Stepan lineage unavailable");
  assert.equal(stepan.lineage.links[0]?.status, "linked");
  assert.equal(stepan.lineage.transactions.length, 5);
  assert.equal(stepan.lineage.transactions.some((row) => row.aggregationStatus !== "included"), false);
  assert.equal(stepan.lineage.holdings.length, 16);
  assert.deepEqual(
    stepan.lineage.holdingCorrections.map((item) => [item.previousValueRaw, item.correctedValueRaw]),
    [["67.214", "67214"]],
  );

  const trustmark = await currentState.readSection16IssuerCurrentState("36146");
  assert.equal(trustmark.status, "available");
  if (trustmark.status !== "available") throw new Error("Trustmark lineage unavailable");
  assert.equal(trustmark.lineage.transactions.filter((row) => row.aggregationStatus === "excluded_confirmed_duplicate").length, 1);
  assert.equal(trustmark.lineage.transactions.filter((row) => row.accessionNumber === syntheticAccessions[0]).length, 6);
  assert.ok(trustmark.lineage.transactions.filter((row) => row.accessionNumber === syntheticAccessions[0]).every((row) => row.aggregationStatus === "included"));
  const changedFirst = trustmark.lineage.transactions.find((row) => row.accessionNumber === syntheticAccessions[2] && row.rowOrdinal === 0);
  assert.equal(changedFirst?.row.shares.rawValue, "11");
  assert.equal(changedFirst?.aggregationStatus, "included");
  assert.equal(trustmark.lineage.transactions.filter((row) => row.accessionNumber === "0000036146-26-000004").length, 6);

  const ggrpWarrant = await createConditionSet([
    { key: "ownership.section16.holding.security_title", operator: "eq", value: "Warrant (Right to Buy)" },
    { key: "ownership.section16.holding.underlying_security_title", operator: "eq", value: "Common Stock" },
    { key: "ownership.section16.holding.underlying_security_shares", operator: "eq", value: "25000" },
    { key: "ownership.section16.holding.conversion_or_exercise_price", operator: "eq", value: "0.55" },
    { key: "ownership.section16.holding.exercise_date", operator: "eq", value: "2026-11-18" },
    { key: "ownership.section16.holding.expiration_date", operator: "eq", value: "2033-11-18" },
  ]);
  const ggrpMissingAmount = await createConditionSet([
    { key: "ownership.section16.holding.security_title", operator: "eq", value: "Warrant (Right to Buy)" },
    { key: "ownership.section16.holding.amount_owned", operator: "eq", value: "25000" },
  ]);
  const stepanZero = await createConditionSet([
    { key: "ownership.section16.holding.amount_owned", operator: "eq", value: "0" },
  ]);
  const stepanTransaction = await createConditionSet([
    { key: "ownership.section16.transaction.transaction_code", operator: "eq", value: "A" },
    { key: "ownership.section16.transaction.transaction_date", operator: "eq", value: "2016-09-15" },
    { key: "ownership.section16.transaction.shares", operator: "eq", value: "315.467" },
    { key: "ownership.section16.transaction.direct_or_indirect", operator: "eq", value: "D" },
  ]);
  const trustmarkP = await createConditionSet([
    { key: "ownership.section16.transaction.transaction_code", operator: "eq", value: "P" },
  ]);
  const trustmarkS = await createConditionSet([
    { key: "ownership.section16.transaction.transaction_code", operator: "eq", value: "S" },
  ]);
  const trustmarkP10Direct = await createConditionSet([
    { key: "ownership.section16.transaction.transaction_code", operator: "eq", value: "P" },
    { key: "ownership.section16.transaction.shares", operator: "eq", value: "10" },
    { key: "ownership.section16.transaction.direct_or_indirect", operator: "eq", value: "D" },
  ]);
  const trustmarkCrossRow = await createConditionSet([
    { key: "ownership.section16.transaction.transaction_code", operator: "eq", value: "P" },
    { key: "ownership.section16.transaction.shares", operator: "eq", value: "30" },
    { key: "ownership.section16.transaction.direct_or_indirect", operator: "eq", value: "D" },
  ]);
  const syntheticDuplicate = await createConditionSet([
    { key: "ownership.section16.transaction.transaction_code", operator: "eq", value: "P" },
    { key: "ownership.section16.transaction.transaction_date", operator: "eq", value: "2025-04-29" },
    { key: "ownership.section16.transaction.shares", operator: "eq", value: "10" },
    { key: "ownership.section16.transaction.direct_or_indirect", operator: "eq", value: "D" },
  ]);
  const conditionSets = [
    ggrpCommon, ggrpWarrant, ggrpMissingAmount, stepanZero, stepanTransaction,
    trustmarkP, trustmarkS, trustmarkP10Direct, trustmarkCrossRow, syntheticDuplicate,
  ];
  assert.ok(conditionSets.every((set) => set.executionMode === "manual_only_no_alerts"));

  const ownerReadback = await conditionPersistence.readSection16MonitorConditionSetForOwner(owner.id, ggrpWarrant.id);
  assert.equal(ownerReadback.status, "available");
  assert.deepEqual(
    ownerReadback.status === "available" ? ownerReadback.conditionSet.conditions : null,
    ggrpWarrant.conditions,
  );
  assert.equal(
    (await conditionPersistence.readSection16MonitorConditionSetForOwner(other.id, ggrpWarrant.id)).status,
    "not_found",
  );
  const beforeGeneralMutation = await admin.query(
    "select to_jsonb(lm) as snapshot from public.listing_monitors lm where id = $1 and user_id = $2",
    [ggrpWarrant.id, owner.id],
  );
  assert.equal(beforeGeneralMutation.rows.length, 1);
  const blockedGeneralUpdates = [
    { ownerId: owner.id, monitorId: ggrpWarrant.id, isActive: true },
    {
      ownerId: owner.id,
      monitorId: ggrpWarrant.id,
      conditions: [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
    },
    {
      ownerId: owner.id,
      monitorId: ggrpWarrant.id,
      conditions: [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
      isActive: true,
    },
  ];
  for (const update of blockedGeneralUpdates) {
    await assert.rejects(
      listingPersistence.updateListingMonitor(update),
      (error) => error instanceof listingPersistence.ListingMonitorPersistenceError
        && error.code === "listing_monitor_invalid"
        && error.details.includes("private_section16_monitor_mutation_forbidden"),
    );
  }
  await assert.rejects(
    listingPersistence.deleteListingMonitor(owner.id, ggrpWarrant.id),
    (error) => error instanceof listingPersistence.ListingMonitorPersistenceError
      && error.code === "listing_monitor_invalid"
      && error.details.includes("private_section16_monitor_mutation_forbidden"),
  );
  const afterGeneralMutation = await admin.query(
    "select to_jsonb(lm) as snapshot from public.listing_monitors lm where id = $1 and user_id = $2",
    [ggrpWarrant.id, owner.id],
  );
  assert.deepEqual(afterGeneralMutation.rows, beforeGeneralMutation.rows);
  assert.equal(afterGeneralMutation.rows[0]?.snapshot?.is_active, false);
  const afterBlockedMutationReadback = await conditionPersistence.readSection16MonitorConditionSetForOwner(
    owner.id,
    ggrpWarrant.id,
  );
  assert.equal(afterBlockedMutationReadback.status, "available");
  assert.deepEqual(
    afterBlockedMutationReadback.status === "available" ? afterBlockedMutationReadback.conditionSet.conditions : null,
    ggrpWarrant.conditions,
  );
  const afterBlockedMutationMatch = await evaluate("0000891839-26-000252", ggrpWarrant);
  assert.equal(afterBlockedMutationMatch.status, "match");
  assert.equal(afterBlockedMutationMatch.evidence?.matchedFilingRowCount, 1);

  const publicForm4Conditions = [{ key: "ownership.form4.transaction_code", operator: "eq", value: "P" }];
  const publicForm144Conditions = [{ key: "ownership.form144.exchange", operator: "eq", value: "NASD" }];
  const publicOwnershipMonitor = await listingPersistence.createListingMonitor({
    ownerId: owner.id,
    conditions: publicForm4Conditions,
  });
  assert.equal(publicOwnershipMonitor.isActive, true);
  assert.equal((await listingPersistence.pauseListingMonitor(owner.id, publicOwnershipMonitor.id)).isActive, false);
  assert.equal((await listingPersistence.resumeListingMonitor(owner.id, publicOwnershipMonitor.id)).isActive, true);
  const publicOwnershipReplacement = await listingPersistence.updateListingMonitor({
    ownerId: owner.id,
    monitorId: publicOwnershipMonitor.id,
    conditions: publicForm144Conditions,
  });
  assert.deepEqual(publicOwnershipReplacement.conditions, publicForm144Conditions);
  assert.equal(await listingPersistence.deleteListingMonitor(owner.id, publicOwnershipMonitor.id), true);
  await assert.rejects(
    conditionPersistence.createSection16MonitorConditionSet({
      ownerId: owner.id,
      conditions: [{ key: "ownership.section16.transaction.shares", operator: "eq", value: 10 }],
    }),
    (error) => error instanceof conditionPersistence.Section16MonitorConditionSetError
      && error.code === "condition_set_invalid",
  );
  const invalidConditionSetId = randomUUID();
  await admin.query(
    `insert into public.listing_monitors (id,user_id,domain,conditions,is_active)
     values ($1,$2,'listing',$3::jsonb,false)`,
    [invalidConditionSetId, owner.id, JSON.stringify([{ key: "ownership.section16.transaction.unknown", operator: "eq", value: "10" }])],
  );
  const invalidReadback = await conditionPersistence.readSection16MonitorConditionSetForOwner(owner.id, invalidConditionSetId);
  assert.equal(invalidReadback.status, "invalid");
  assert.equal(
    (await conditionPersistence.readSection16MonitorConditionSetForOwner(other.id, invalidConditionSetId)).status,
    "not_found",
  );
  assert.equal((await authenticatedMonitorRows(owner.token, ggrpWarrant.id)).length, 1, "owner RLS read");
  assert.equal((await authenticatedMonitorRows(other.token, ggrpWarrant.id)).length, 0, "other-user RLS isolation");

  const ggrpFacts = await monitorFacts.readSection16MonitorFacts("0000891839-26-000252");
  assert.equal(ggrpFacts.status, "available");
  if (ggrpFacts.status !== "available") throw new Error("GGRP monitor facts unavailable");
  const warrantFact = ggrpFacts.rows.find((row) => row.rowFamily === "holding" && row.rowOrdinal === 1)!;
  const warrantAmountOwned = sourceField(warrantFact, "amountOwned");
  const warrantUnderlyingShares = sourceField(warrantFact, "underlyingSecurityShares");
  assert.equal(warrantAmountOwned.status, "missing");
  assert.equal(warrantUnderlyingShares.rawValue, "25000");
  const ggrpCommonMatch = await evaluate("0000891839-26-000252", ggrpCommon);
  const ggrpWarrantMatch = await evaluate("0000891839-26-000252", ggrpWarrant);
  const ggrpMissingAmountMatch = await evaluate("0000891839-26-000252", ggrpMissingAmount);
  assert.equal(ggrpCommonMatch.status, "match");
  assert.equal(ggrpCommonMatch.evidence?.matchedFilingRowCount, 1);
  assert.equal(ggrpWarrantMatch.status, "match");
  assert.equal(ggrpWarrantMatch.evidence?.matchedFilingRowCount, 1);
  assert.equal(ggrpMissingAmountMatch.status, "ineligible");
  assert.equal(ggrpMissingAmountMatch.reasonCode, "source_field_missing");

  const stepanFacts = await monitorFacts.readSection16MonitorFacts("0000094049-26-000015");
  assert.equal(stepanFacts.status, "available");
  if (stepanFacts.status !== "available") throw new Error("Stepan monitor facts unavailable");
  const stepanZeroMatch = await evaluate("0000094049-26-000015", stepanZero);
  const stepanTransactionMatch = await evaluate("0000094049-26-000015", stepanTransaction);
  assert.equal(stepanZeroMatch.status, "match");
  assert.deepEqual(stepanZeroMatch.evidence?.matchedRows.map((row) => row.rowOrdinal), [2, 5]);
  assert.equal(stepanTransactionMatch.status, "match");
  assert.equal(stepanTransactionMatch.evidence?.matchedFilingRowCount, 1);
  assert.equal(
    stepanFacts.rows.filter((row) => row.rowFamily === "transaction")
      .some((row) => sourceField(row, "transactionDate").rawValue === "2026-02-19"),
    false,
  );

  const trustmarkPMatch = await evaluate("0000036146-26-000004", trustmarkP);
  const trustmarkSMatch = await evaluate("0000036146-26-000004", trustmarkS);
  const trustmarkP10DirectMatch = await evaluate("0000036146-26-000004", trustmarkP10Direct);
  const trustmarkCrossRowMatch = await evaluate("0000036146-26-000004", trustmarkCrossRow);
  assert.equal(trustmarkPMatch.evidence?.matchedFilingRowCount, 5);
  assert.equal(trustmarkSMatch.evidence?.matchedFilingRowCount, 1);
  assert.deepEqual(trustmarkP10DirectMatch.evidence?.matchedRows.map((row) => row.rowOrdinal), [0]);
  assert.equal(trustmarkCrossRowMatch.status, "no_match");
  assert.equal(trustmarkCrossRowMatch.reasonCode, "row_conjunction_not_met");

  const duplicateMatch = await evaluate(syntheticAccessions[1]!, syntheticDuplicate);
  assert.equal(duplicateMatch.status, "no_match");
  assert.equal(duplicateMatch.evidence, undefined);
  const duplicateFacts = await monitorFacts.readSection16MonitorFacts(syntheticAccessions[1]!);
  assert.equal(duplicateFacts.status, "available");
  assert.equal(duplicateFacts.status === "available" ? duplicateFacts.excludedConfirmedDuplicateRowCount : -1, 1);
  const alertCount = await admin.query(
    "select count(*)::integer as count from public.user_alert_deliveries where listing_monitor_id = any($1::uuid[])",
    [conditionSets.map((set) => set.id)],
  );
  assert.equal(alertCount.rows[0]?.count, 0, "manual Section 16 Matcher creates no Alert rows");

  output.conditions = {
    storage: {
      table: "listing_monitors",
      executionMode: "manual_only_no_alerts",
      conditionSetCount: conditionSets.length,
      ownerReadback: ownerReadback.status,
      otherUserReadback: "not_found",
      generalListingUpdateAttemptsBlockedBeforeMutation: blockedGeneralUpdates.length,
      generalListingDeleteBlockedBeforeMutation: true,
      originalFullRowSnapshotPreserved: true,
      officialReaderAfterBlockedMutations: afterBlockedMutationReadback.status,
      matcherAfterBlockedMutations: summarizeMatch(afterBlockedMutationMatch),
      normalForm4Form144LifecyclePreserved: true,
      invalidSaveRejected: true,
      invalidStoredReadback: invalidReadback.status,
      ownerRlsRows: 1,
      otherUserRlsRows: 0,
      alertRows: 0,
      conditionSetIds: {
        ggrpCommon: ggrpCommon.id,
        ggrpWarrant: ggrpWarrant.id,
        ggrpMissingAmount: ggrpMissingAmount.id,
        stepanZero: stepanZero.id,
        stepanTransaction: stepanTransaction.id,
        trustmarkP: trustmarkP.id,
        trustmarkS: trustmarkS.id,
        trustmarkP10Direct: trustmarkP10Direct.id,
        trustmarkCrossRow: trustmarkCrossRow.id,
        syntheticDuplicate: syntheticDuplicate.id,
        invalidStored: invalidConditionSetId,
      },
    },
    ggrp: {
      missingOriginalDirectEvaluation: summarizeMatch(missingOriginalDirectMatch!),
      commonHolding: summarizeMatch(ggrpCommonMatch),
      warrantHolding: summarizeMatch(ggrpWarrantMatch),
      warrantAmountOwned: { status: warrantAmountOwned.status, match: summarizeMatch(ggrpMissingAmountMatch) },
      underlyingSecuritySharesRaw: warrantUnderlyingShares.rawValue,
      meaning: "two_added_disclosed_holdings_not_acquisition_or_purchase_proof",
    },
    stepan: {
      zeroHoldings: summarizeMatch(stepanZeroMatch),
      zeroHoldingOrdinals: stepanZeroMatch.evidence?.matchedRows.map((row) => row.rowOrdinal),
      transaction: summarizeMatch(stepanTransactionMatch),
      transactionDatesExcludeFilingDate: true,
      preservedHistoryHoldings: stepan.lineage.holdings.length,
    },
    trustmark: {
      pRows: summarizeMatch(trustmarkPMatch),
      sRows: summarizeMatch(trustmarkSMatch),
      p10Direct: summarizeMatch(trustmarkP10DirectMatch),
      p30DirectCrossRow: summarizeMatch(trustmarkCrossRowMatch),
    },
    syntheticConfirmedDuplicate: {
      availableActualPairs: 0,
      excludedRows: duplicateFacts.status === "available" ? duplicateFacts.excludedConfirmedDuplicateRowCount : null,
      matcher: summarizeMatch(duplicateMatch),
      separatelyLabeledSynthetic: true,
    },
    countMeaning: "matched_filing_rows_not_unique_trades",
    scope: "complete_stored_history_not_sec_global_no_realtime_position_or_change_aggregation",
  };

  assert.equal(networkLedger.some((entry) => !entry.allowed), false);
  output.ok = true;
  output.databaseEvidence = target.rows[0];
  output.databaseEvidence.schemaMigrationPath = path.resolve("supabase/migrations/20260912012348_sec_section16_xml_canonical_persistence.sql");
  output.actual = {
    ggrp: {
      linkStatus: ggrp.lineage.links[0]?.status,
      reason: ggrp.lineage.links[0]?.reason,
      securityIdentity: ggrp.lineage.links[0]?.evidence.securityIdentity,
      transactions: 0,
      holdings: 2,
      holdingAdditions: ggrp.lineage.holdingAdditions.length,
      acquisitionMeaning: "two_added_disclosed_holdings_cause_and_date_unresolved",
    },
    stepan: {
      linkStatus: stepan.lineage.links[0]?.status,
      includedTransactions: stepan.lineage.transactions.length,
      excludedTransactions: 0,
      preservedHoldings: stepan.lineage.holdings.length,
      holdingCorrection: ["67.214", "67214"],
    },
  };
  output.synthetic = {
    confirmedDuplicateExclusions: 1,
    standaloneRepeatedTransactionsIncluded: 6,
    changedQuantityIncluded: changedFirst?.aggregationStatus === "included",
    omittedOriginalRowsPreserved: trustmark.lineage.transactions.filter((row) => row.accessionNumber === "0000036146-26-000004").length,
  };
  output.replay = {
    statuses: replayResults.map((item) => item.writeStatus),
    sameAccessionConcurrentStatuses: concurrentReplayResults.map((item) => item.writeStatus),
    changedRows: 0,
  };
  output.mismatch = { rejected: true, changedRows: 0 };
  output.finalCounts = {
    rawItems: await countByAccessions("raw_items", "source_unique_id", allAccessions),
    filings: await countByAccessions("sec_section16_filings", "accession_number", allAccessions),
  };
  output.network = { externalRequests: 0, isolatedApiRequests: networkLedger.length };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  await writeFile(statusPath, `${JSON.stringify({
    projectId: output.isolated.projectId,
    apiUrl,
    dbHost: new URL(dbUrl).hostname,
    dbPort: Number(expectedPort),
    status: "running",
    credentials: "intentionally_omitted",
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ok: true, outputPath, statusPath, finalCounts: output.finalCounts })}\n`);
} finally {
  await admin.end();
}

async function fixtureCase(fixture: Fixture) {
  const desktop = desktopEvidence.get(fixture.accessionNumber);
  let resolvedFixture = fixture;
  let xml: string;
  let attachmentSha256: string | null = null;
  let sourceKind = "official_sec_archive_exact_download";
  let localEvidencePath = path.join(fixtureDir, fixture.file);
  if (desktop) {
    assert.ok(desktopSource, "Desktop source directory is available");
    localEvidencePath = path.join(desktopSource, `${fixture.accessionNumber}.txt`);
    const attachment = await readFile(localEvidencePath);
    attachmentSha256 = sha256(attachment);
    assert.equal(attachmentSha256, desktop.attachmentSha256, `${fixture.accessionNumber} complete submission bytes`);
    const extracted = extractOfficialXml(attachment, fixture.formType, fixture.accessionNumber, desktop.fileName);
    assert.equal(sha256(extracted.bytes), desktop.xmlSha256, `${fixture.accessionNumber} XML bytes`);
    xml = extracted.text;
    resolvedFixture = { ...fixture, sha256: desktop.xmlSha256 };
    sourceKind = "official_sec_complete_submission_exact_bytes";
  } else {
    xml = await readFile(path.join(fixtureDir, fixture.file), "utf8");
    assert.equal(sha256(Buffer.from(xml, "utf8")), fixture.sha256, `${fixture.accessionNumber} archive XML bytes`);
  }
  const preserved = parser.preserveSection16XmlSource({
    formType: resolvedFixture.formType,
    sourceUrl: resolvedFixture.sourceUrl,
    text: xml,
    sha256: resolvedFixture.sha256,
  });
  const rawItem = rawItemFor({ fixture: resolvedFixture, preserved, xml });
  return {
    fixture: resolvedFixture,
    xml,
    rawItem,
    parsed: parser.parseSection16XmlFiling(rawItem),
    sourceKind,
    localEvidencePath,
    attachmentSha256,
  };
}

function syntheticCase(base: Row, input: {
  accessionNumber: string;
  formType: "5" | "5/A";
  filingDate: string;
  acceptedAt: string;
  xml: string;
}) {
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/36146/${input.accessionNumber.replaceAll("-", "")}/form5${input.formType.endsWith("/A") ? "a" : ""}.xml`;
  const fixture: Fixture = {
    file: "synthetic_in_memory",
    formType: input.formType,
    accessionNumber: input.accessionNumber,
    issuerCik: "0000036146",
    filingDate: input.filingDate,
    acceptedAt: input.acceptedAt,
    sourceUrl,
    sha256: "",
  };
  const preserved = parser.preserveSection16XmlSource({ formType: input.formType, sourceUrl, text: input.xml });
  const rawItem = rawItemFor({ fixture, preserved, xml: input.xml });
  return { fixture, xml: input.xml, rawItem, parsed: parser.parseSection16XmlFiling(rawItem), base };
}

function rawItemFor(input: { fixture: Fixture; preserved: Row; xml: string }) {
  const { fixture } = input;
  return {
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: fixture.accessionNumber,
    source_url: fixture.sourceUrl.replace(/\/[^/]+$/, `/${fixture.accessionNumber}-index.html`),
    title: `SEC Form ${fixture.formType} isolated lineage evidence`,
    published_at: fixture.acceptedAt,
    fetched_at: new Date().toISOString(),
    body_text: input.xml,
    analysis_text: input.xml,
    dedupe_key: `sec_edgar:${fixture.accessionNumber}`,
    metadata: {},
    raw_payload: {
      form_type: fixture.formType,
      accession_number: fixture.accessionNumber,
      cik: fixture.issuerCik,
      ownership_issuer_cik: fixture.issuerCik,
      filing_date: fixture.filingDate,
      accepted_at: fixture.acceptedAt,
      ...input.preserved,
    },
  };
}

function amendmentXml(xml: string, remarks: string) {
  let amended = xml
    .replace("<documentType>5</documentType>", "<documentType>5/A</documentType>")
    .replace("<periodOfReport>2025-12-31</periodOfReport>", "<periodOfReport>2025-12-31</periodOfReport>\n    <dateOfOriginalSubmission>2026-02-13</dateOfOriginalSubmission>");
  assert.match(amended, /<dateOfOriginalSubmission>2026-02-13<\/dateOfOriginalSubmission>/);
  if (remarks) amended = amended.replace("<ownerSignature>", `<remarks>${remarks}</remarks>\n    <ownerSignature>`);
  return amended;
}

function removeTransactionByDate(xml: string, date: string) {
  const blocks = [...xml.matchAll(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g)]
    .map((match) => match[0]);
  const datePattern = new RegExp(`<transactionDate>\\s*<value>\\s*${date}\\s*<\\/value>\\s*<\\/transactionDate>`);
  const matches = blocks.filter((block) => datePattern.test(block));
  assert.equal(matches.length, 1, `one transaction for ${date}`);
  return xml.replace(matches[0]!, "");
}

function replaceFirstTransactionShares(xml: string, previous: string, next: string) {
  const block = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/)?.[0];
  assert.ok(block, "first non-derivative transaction exists");
  const sharesPattern = new RegExp(`(<transactionShares>\\s*<value>\\s*)${previous}(\\s*<\\/value>\\s*<\\/transactionShares>)`);
  const changed = block.replace(sharesPattern, `$1${next}$2`);
  assert.notEqual(changed, block, "first transaction shares changed");
  return xml.replace(block, changed);
}

function extractOfficialXml(bytes: Buffer, formType: string, accession: string, fileName: string) {
  const submission = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(submission.match(/ACCESSION NUMBER:\s*([^\s]+)/)?.[1], accession);
  assert.equal(submission.match(/CONFORMED SUBMISSION TYPE:\s*([^\s]+)/)?.[1], formType);
  const documents = [...submission.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g)]
    .filter((match) => match[1]?.match(/<TYPE>([^\r\n]+)/)?.[1] === formType);
  assert.equal(documents.length, 1, `${accession} one official form document`);
  const document = documents[0]!;
  assert.equal(document[1]!.match(/<FILENAME>([^\r\n]+)/)?.[1], fileName);
  const text = document[1]!.match(/<XML>\r?\n([\s\S]*?)<\/XML>/)?.[1];
  assert.ok(text, `${accession} XML payload`);
  const characterOffset = submission.indexOf(text, document.index);
  assert.ok(characterOffset >= 0);
  const startByte = Buffer.byteLength(submission.slice(0, characterOffset), "utf8");
  const endByte = Buffer.byteLength(submission.slice(0, characterOffset + text.length), "utf8");
  const xmlBytes = bytes.subarray(startByte, endByte);
  assert.equal(xmlBytes.toString("utf8"), text);
  return { text, bytes: xmlBytes };
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requiredFixture(accessionNumber: string) {
  const fixture = fixtures.find((item) => item.accessionNumber === accessionNumber);
  assert.ok(fixture, accessionNumber);
  return fixture;
}

async function countByAccessions(table: string, column: string, accessions: readonly string[]) {
  const tables = new Set(["raw_items", "sec_section16_filings"]);
  const columns = new Set(["source_unique_id", "accession_number"]);
  assert.ok(tables.has(table) && columns.has(column));
  const result = await admin.query(`select count(*)::integer as count from public.${table} where ${column} = any($1::text[])`, [accessions]);
  return Number(result.rows[0]?.count);
}

async function createAuthUser(label: string) {
  const email = `section16-${label}-${Date.now()}-${randomUUID()}@example.test`;
  const password = `Isolated-Section16-${label}-2026!`;
  const createdResponse = await fetch(new URL("/auth/v1/admin/users", apiUrl), {
    method: "POST",
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const createdText = await createdResponse.text();
  assert.equal(createdResponse.ok, true, `create isolated ${label} user: ${createdText.slice(0, 300)}`);
  const id = String(JSON.parse(createdText).id || "");
  assert.match(id, /^[0-9a-f-]{36}$/i);
  await admin.query(
    `insert into public.user_profiles (id,email) values ($1,$2)
     on conflict (id) do update set email = excluded.email`,
    [id, email],
  );
  const tokenResponse = await fetch(new URL("/auth/v1/token?grant_type=password", apiUrl), {
    method: "POST",
    headers: { apikey: secretKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const tokenText = await tokenResponse.text();
  assert.equal(tokenResponse.ok, true, `sign in isolated ${label} user: ${tokenText.slice(0, 300)}`);
  const token = String(JSON.parse(tokenText).access_token || "");
  assert.ok(token);
  return { id, token };
}

async function authenticatedMonitorRows(token: string, id: string) {
  const url = new URL("/rest/v1/listing_monitors", apiUrl);
  url.searchParams.set("select", "id,user_id,is_active");
  url.searchParams.set("id", `eq.${id}`);
  const response = await fetch(url, {
    headers: { apikey: secretKey, Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  assert.equal(response.ok, true, `authenticated monitor read: ${text.slice(0, 300)}`);
  return JSON.parse(text) as Row[];
}

function summarizeMatch(value: Row) {
  return {
    status: value.status,
    reasonCode: value.reasonCode,
    matchedFilingRowCount: value.evidence?.matchedFilingRowCount ?? 0,
    matchedRowOrdinals: value.evidence?.matchedRows?.map((row: Row) => row.rowOrdinal) ?? [],
    countMeaning: value.evidence?.countMeaning ?? "filing_rows_not_unique_trades",
  };
}

function sourceField(row: { fields: Readonly<Record<string, unknown>> }, name: string) {
  const value = row.fields[name];
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${name} source field`);
  return value as Row;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
