import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSecOfflineArchiveImportBundle,
  compareSecOfflineArchiveRawItem,
  SecOfflineArchiveImportError,
  SEC_OFFLINE_ARCHIVE_IMPORT_VERSION,
} from "./canonical.ts";
import { planSecOfflineArchiveImport } from "./persistence.ts";

const CIK = "0002041610";
const ACCESSIONS = ["0001104659-26-113076", "0001104659-26-113913"] as const;
const DOCUMENTS = ["before.htm", "after.htm"] as const;
const ACCEPTED = ["2026-10-02T17:29:01.000Z", "2026-10-06T17:08:38.000Z"] as const;
const FILING_DATES = ["2026-10-02", "2026-10-06"] as const;

async function createFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sec-offline-import-"));
  const html = [
    htmlSource("PSKY", "The Nasdaq Stock Market LLC"),
    htmlSource("SKYD", "New York Stock Exchange"),
  ];
  for (let index = 0; index < html.length; index += 1) {
    await fs.writeFile(path.join(directory, DOCUMENTS[index]!), html[index]!, "utf8");
  }
  const submissions = {
    cik: CIK,
    name: "Skydance Corp",
    filings: {
      recent: {
        accessionNumber: [...ACCESSIONS],
        form: ["8-K", "8-K"],
        filingDate: [...FILING_DATES],
        acceptanceDateTime: [...ACCEPTED],
        primaryDocument: [...DOCUMENTS],
      },
      files: [],
    },
  };
  const submissionsText = `${JSON.stringify(submissions, null, 2)}\n`;
  await fs.writeFile(path.join(directory, "submissions.json"), submissionsText, "utf8");
  const manifest = {
    version: 1,
    scope: "test_verified_offline_sources",
    submissions: {
      file: "submissions.json",
      url: `https://data.sec.gov/submissions/CIK${CIK}.json`,
      sha256: hash(submissionsText),
    },
    filings: ACCESSIONS.map((accession, index) => ({
      role: index === 0 ? "before" : "after",
      file: DOCUMENTS[index],
      accession,
      sha256: hash(html[index]!),
      capturedAt: ACCEPTED[index],
    })),
  };
  await writeManifest(directory, manifest);
  return { directory, manifest, html };
}

async function writeManifest(directory: string, manifest: unknown) {
  await fs.writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function htmlSource(ticker: string, exchange: string) {
  return `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"><body><p>Class B Common Stock</p><ix:nonNumeric name="dei:TradingSymbol" contextRef="c1">${ticker}</ix:nonNumeric><ix:nonNumeric name="dei:SecurityExchangeName" contextRef="c1">${exchange}</ix:nonNumeric></body></html>`;
}

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function expectCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof SecOfflineArchiveImportError && error.code === code,
  );
}

test("builds deterministic canonical raw items from verified retained SEC originals without network", async () => {
  const fixture = await createFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail("offline import must not use network");
  try {
    const first = await buildSecOfflineArchiveImportBundle({ directory: fixture.directory });
    const second = await buildSecOfflineArchiveImportBundle({ directory: fixture.directory });
    assert.equal(first.version, "sec-offline-archive-import-v1");
    assert.equal(first.issuerCik, CIK);
    assert.equal(first.items.length, 2);
    assert.equal(first.runId, second.runId);
    assert.equal(first.runId, expectedUuid(`sec_offline_archive_run:${SEC_OFFLINE_ARCHIVE_IMPORT_VERSION}:${first.manifestSha256}`));
    assert.notEqual(first.runId, expectedUuid(`sec_offline_archive_run:future-version:${first.manifestSha256}`));
    for (const item of first.items) {
      assert.equal(item.rawItemId, expectedUuid(`sec_offline_archive_raw:${item.accessionNumber}:${item.sourceSha256}`));
    }
    assert.equal(first.bundleSha256, second.bundleSha256);
    assert.deepEqual(first.items.map((item) => item.rawItemId), second.items.map((item) => item.rawItemId));

    const before = first.items[0]!;
    const payload = record(before.rawItem.raw_payload);
    const provenance = record(payload.offline_archive_import);
    const tickerResolution = record(payload.ticker_resolution);
    const bodyText = before.rawItem.body_text;
    assert.ok(typeof bodyText === "string");
    assert.equal(before.accessionNumber, ACCESSIONS[0]);
    assert.equal(before.rawItem.source_code, "sec_edgar");
    assert.equal(before.rawItem.source_group, "filings");
    assert.equal(before.rawItem.source_unique_id, ACCESSIONS[0]);
    assert.equal(payload.primary_document_html, fixture.html[0]);
    assert.equal(payload.primary_document_sha256, hash(fixture.html[0]));
    assert.equal(payload.primary_document_html_utf8_byte_count, Buffer.byteLength(fixture.html[0], "utf8"));
    assert.equal(provenance.acquisitionMethod, "offline_archive");
    assert.equal(provenance.manifestSha256, first.manifestSha256);
    assert.equal(provenance.bundleSha256, first.bundleSha256);
    assert.match(bodyText, /^### 8-K\n/);
    assert.equal(before.rawItem.analysis_text, bodyText);
    assert.equal(payload.ticker, null);
    assert.equal(tickerResolution.source, "unresolved");
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a retained filing whose bytes do not match the manifest SHA-256", async () => {
  const fixture = await createFixture();
  try {
    fixture.manifest.filings[0]!.sha256 = "f".repeat(64);
    await writeManifest(fixture.directory, fixture.manifest);
    await expectCode(
      buildSecOfflineArchiveImportBundle({ directory: fixture.directory }),
      "filing_sha256_mismatch",
    );
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects duplicate accessions before preparing any raw item", async () => {
  const fixture = await createFixture();
  try {
    fixture.manifest.filings[1]!.accession = fixture.manifest.filings[0]!.accession;
    await writeManifest(fixture.directory, fixture.manifest);
    await expectCode(
      buildSecOfflineArchiveImportBundle({ directory: fixture.directory }),
      "filing_accession_duplicate",
    );
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects an archive file path that escapes the selected directory", async () => {
  const fixture = await createFixture();
  const outside = path.join(path.dirname(fixture.directory), `outside-${randomUUID()}.htm`);
  try {
    await fs.writeFile(outside, fixture.html[0], "utf8");
    (fixture.manifest.filings[0]! as { file: string }).file = `../${path.basename(outside)}`;
    fixture.manifest.filings[0]!.sha256 = hash(fixture.html[0]);
    await writeManifest(fixture.directory, fixture.manifest);
    await expectCode(
      buildSecOfflineArchiveImportBundle({ directory: fixture.directory }),
      "archive_file_path_escape",
    );
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
    await fs.rm(outside, { force: true });
  }
});

test("treats an exact existing production raw as replay but rejects source drift", async () => {
  const fixture = await createFixture();
  try {
    const bundle = await buildSecOfflineArchiveImportBundle({ directory: fixture.directory });
    const prepared = bundle.items[0]!;
    const exactExisting = {
      ...structuredClone(prepared.rawItem),
      id: randomUUID(),
      run_id: randomUUID(),
      metadata: { existingNetworkCapture: true },
    };
    assert.deepEqual(compareSecOfflineArchiveRawItem(exactExisting, prepared), { matches: true });

    const changed = structuredClone(exactExisting);
    changed.raw_payload.primary_document_html += "<!-- source changed -->";
    assert.deepEqual(
      compareSecOfflineArchiveRawItem(changed, prepared),
      { matches: false, reason: "primary_source_sha256_mismatch" },
    );

    const changedIdentity = structuredClone(exactExisting);
    changedIdentity.raw_payload.accepted_at = "2026-10-02T18:29:01.000Z";
    assert.deepEqual(
      compareSecOfflineArchiveRawItem(changedIdentity, prepared),
      { matches: false, reason: "accepted_at_mismatch" },
    );
  } finally {
    await fs.rm(fixture.directory, { recursive: true, force: true });
  }
});

function record(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test("v1 accepts 8-K and 8-K/A but rejects filer-identity forms before source read or repository calls", async () => {
  for (const form of ["8-K", "8-K/A", "SC 13D", "25"]) {
    const fixture = await createFixture();
    let repositoryCalls = 0;
    try {
      const submissionsPath = path.join(fixture.directory, "submissions.json");
      const submissions = JSON.parse(await fs.readFile(submissionsPath, "utf8"));
      submissions.filings.recent.form[0] = form;
      const body = JSON.stringify(submissions);
      await fs.writeFile(submissionsPath, body);
      fixture.manifest.submissions.sha256 = hash(body);
      await writeManifest(fixture.directory, fixture.manifest);
      const unsupported = form === "SC 13D" || form === "25";
      // Missing source must not mask the earlier form-scope rejection.
      if (unsupported) await fs.unlink(path.join(fixture.directory, DOCUMENTS[0]));
      const prepareAndPlan = async () => {
        const prepared = await buildSecOfflineArchiveImportBundle({ directory: fixture.directory });
        assert.equal(prepared.items[0]!.rawItem.raw_payload.form_type, form);
        return planSecOfflineArchiveImport({ bundle: prepared, repository: {
          select: async () => { repositoryCalls++; return { ok: true, status: 200, data: [] }; },
          rpc: async () => { repositoryCalls++; assert.fail("plan must not call RPC"); },
        } });
      };
      if (unsupported) {
        await expectCode(prepareAndPlan(), "filing_form_unsupported_for_offline_import_v1");
        assert.equal(repositoryCalls, 0);
      } else {
        assert.equal((await prepareAndPlan()).status, "ready");
        assert.equal(repositoryCalls, 1);
      }
    } finally { await fs.rm(fixture.directory, { recursive: true, force: true }); }
  }
});

function expectedUuid(value: string) {
  const hex = hash(value).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const id = hex.join("");
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
