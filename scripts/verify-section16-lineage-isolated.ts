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

const dbUrl = requiredEnv("SECTION16_ISOLATED_DB_URL");
const apiUrl = requiredEnv("SUPABASE_URL");
const expectedPort = requiredEnv("SECTION16_ISOLATED_DB_PORT");
const secretKey = requiredEnv("SUPABASE_SECRET_KEY");
assert.equal(new URL(dbUrl).port, expectedPort);
assert.equal(new URL(dbUrl).hostname, "127.0.0.1");
assert.equal(expectedPort, "59022");
assert.equal(new URL(apiUrl).hostname, "127.0.0.1");
assert.equal(new URL(apiUrl).port, "59021");

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

const [rawStore, persistence, parser, currentState, canonical] = await Promise.all([
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-section16-xml/persistence.ts"),
  import("../lib/sources/sec/forms/section16Xml/parser.ts"),
  import("../lib/sec-section16-xml/currentState.ts"),
  import("../lib/sec-section16-xml/canonical.ts"),
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
  ?? path.join(requiredEnv("TEMP"), "stockradar-section16-e668-lineage-e2e.json");
const statusPath = process.env.SECTION16_LINEAGE_STATUS_OUTPUT
  ?? path.join(requiredEnv("TEMP"), "stockradar-section16-e668-supabase-status.json");
const admin = new PgClient({ connectionString: dbUrl });
await admin.connect();

const output: Row = {
  ok: false,
  isolated: {
    projectId: "stock-radar-section16-e668-20260912",
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

  assert.equal(networkLedger.some((entry) => !entry.allowed), false);
  output.ok = true;
  output.databaseEvidence = target.rows[0];
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
  output.replay = { statuses: replayResults.map((item) => item.writeStatus), changedRows: 0 };
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
  if (desktop) {
    assert.ok(desktopSource, "Desktop source directory is available");
    const attachment = await readFile(path.join(desktopSource, `${fixture.accessionNumber}.txt`));
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

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
