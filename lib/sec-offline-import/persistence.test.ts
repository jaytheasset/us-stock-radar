import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  SecOfflineArchiveImportError,
  type SecOfflineArchiveImportBundle,
  type SecOfflineArchivePreparedItem,
} from "./canonical.ts";
import {
  applySecOfflineArchiveImport,
  planSecOfflineArchiveImport,
  SecOfflineArchivePersistenceError,
  type SecOfflineArchiveRepository,
} from "./persistence.ts";

const ACCESSIONS = ["0001104659-26-113076", "0001104659-26-113913"] as const;
const SHAS = ["a".repeat(64), "b".repeat(64)] as const;

test("unsupported forms in a supplied bundle cannot reach repository or RPC in plan/apply", async () => {
  for (const form of ["SC 13D", "25"]) {
    const input = bundle(); input.items[0]!.rawItem.raw_payload.form_type = form;
    let calls = 0;
    const repository: SecOfflineArchiveRepository = {
      select: async () => { calls++; throw new Error("unexpected read"); },
      rpc: async () => { calls++; throw new Error("unexpected RPC"); },
    };
    const unsupported = (error: unknown) => error instanceof SecOfflineArchiveImportError
      && error.code === "filing_form_unsupported_for_offline_import_v1";
    await assert.rejects(planSecOfflineArchiveImport({ bundle: input, repository }), unsupported);
    await assert.rejects(applySecOfflineArchiveImport({ bundle: input, confirmedBundleSha256: input.bundleSha256, repository }), unsupported);
    assert.equal(calls, 0);
  }
});

function bundle(): SecOfflineArchiveImportBundle {
  const items = ACCESSIONS.map((accession, index) => prepared(
    accession,
    SHAS[index]!,
    index === 0 ? "before" : "after",
  ));
  return {
    version: "sec-offline-archive-import-v1",
    manifestVersion: 1,
    manifestSha256: "c".repeat(64),
    bundleSha256: "d".repeat(64),
    submissionsSha256: "e".repeat(64),
    issuerCik: "0002041610",
    runId: "10000000-0000-4000-8000-000000000001",
    items,
  };
}

function prepared(
  accessionNumber: string,
  sourceSha256: string,
  role: string,
): SecOfflineArchivePreparedItem {
  const source = `<html><body>${accessionNumber}</body></html>`;
  sourceSha256 = createHash("sha256").update(source, "utf8").digest("hex");
  const rawItemId = accessionNumber.endsWith("113076")
    ? "20000000-0000-4000-8000-000000000001"
    : "20000000-0000-4000-8000-000000000002";
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/2041610/${accessionNumber.replaceAll("-", "")}/${accessionNumber}-index.html`;
  const primaryUrl = sourceUrl.replace(`${accessionNumber}-index.html`, `${role}.htm`);
  return {
    rawItemId,
    accessionNumber,
    role,
    archiveFile: `${role}.htm`,
    sourceSha256,
    sourceUtf8ByteCount: Buffer.byteLength(source, "utf8"),
    rawItem: {
      id: rawItemId,
      source_code: "sec_edgar",
      source_group: "filings",
      source_unique_id: accessionNumber,
      source_url: sourceUrl,
      title: "Skydance Corp files 8-K",
      published_at: "2026-10-02T17:29:01.000Z",
      fetched_at: "2026-10-08T06:06:39.362Z",
      body_text: "### 8-K\nsource",
      analysis_text: "### 8-K\nsource",
      dedupe_key: `sec_edgar:${accessionNumber}`,
      raw_payload: {
        accession_number: accessionNumber,
        cik: "0002041610",
        form_type: "8-K",
        filing_date: "2026-10-02",
        accepted_at: "2026-10-02T17:29:01.000Z",
        primary_document_url: primaryUrl,
        primary_document_html: source,
        primary_document_html_truncated: false,
        primary_document_sha256: sourceSha256,
        primary_document_html_utf8_byte_count: Buffer.byteLength(source, "utf8"),
        offline_archive_import: {
          version: "sec-offline-archive-import-v1",
          acquisitionMethod: "offline_archive",
          manifestSha256: "c".repeat(64),
          bundleSha256: "d".repeat(64),
          sourceSha256,
        },
      },
      metadata: {
        offline_archive_import: {
          version: "sec-offline-archive-import-v1",
          manifestSha256: "c".repeat(64),
          bundleSha256: "d".repeat(64),
          sourceSha256,
        },
      },
    },
  };
}

function repository(input: {
  rows?: unknown;
  selectOk?: boolean;
  rpc?: SecOfflineArchiveRepository["rpc"];
}) {
  const calls = { selects: 0, rpcs: 0, query: null as Record<string, string> | null };
  const repo: SecOfflineArchiveRepository = {
    async select(table, query) {
      calls.selects += 1;
      calls.query = query;
      assert.equal(table, "raw_items");
      return {
        ok: input.selectOk ?? true,
        status: input.selectOk === false ? 503 : 200,
        data: input.rows ?? [],
      };
    },
    async rpc(name, payload) {
      calls.rpcs += 1;
      if (input.rpc) return input.rpc(name, payload);
      return { ok: false, status: 500, data: null };
    },
  };
  return { repo, calls };
}

function exactExisting(item: SecOfflineArchivePreparedItem) {
  return {
    ...structuredClone(item.rawItem),
    id: randomUUID(),
    run_id: randomUUID(),
  };
}

test("plan classifies absent accessions as inserts with one bounded read", async () => {
  const input = bundle();
  const { repo, calls } = repository({ rows: [] });
  const plan = await planSecOfflineArchiveImport({ bundle: input, repository: repo });
  assert.equal(plan.status, "ready");
  if (plan.status !== "ready") return;
  assert.deepEqual(plan.counts, { insert: 2, replay: 0, conflict: 0 });
  assert.deepEqual(plan.items.map((item) => item.action), ["insert", "insert"]);
  assert.equal(calls.selects, 1);
  assert.equal(calls.query?.source_code, "eq.sec_edgar");
  assert.equal(calls.query?.source_unique_id, `in.(${ACCESSIONS.join(",")})`);
  assert.equal(calls.query?.limit, "3");
  assert.equal(calls.rpcs, 0);
});

test("plan accepts exact existing production raws as replay without requiring importer provenance", async () => {
  const input = bundle();
  const rows = input.items.map((item) => {
    const existing = exactExisting(item);
    existing.metadata = { fetchedByProduction: true };
    return existing;
  });
  const { repo } = repository({ rows });
  const plan = await planSecOfflineArchiveImport({ bundle: input, repository: repo });
  assert.equal(plan.status, "ready");
  if (plan.status !== "ready") return;
  assert.deepEqual(plan.counts, { insert: 0, replay: 2, conflict: 0 });
  assert.ok(plan.items.every((item) => item.action === "replay" && item.existingRawItemId));
});

test("plan exposes source drift as a conflict and never writes", async () => {
  const input = bundle();
  const changed = exactExisting(input.items[0]!);
  changed.raw_payload.primary_document_html += "changed";
  const { repo, calls } = repository({ rows: [changed] });
  const plan = await planSecOfflineArchiveImport({ bundle: input, repository: repo });
  assert.equal(plan.status, "conflict");
  if (plan.status !== "conflict") return;
  assert.deepEqual(plan.counts, { insert: 1, replay: 0, conflict: 1 });
  assert.equal(plan.items[0]?.reason, "primary_source_sha256_mismatch");
  assert.equal(calls.rpcs, 0);
});

test("read failures and malformed success never masquerade as an empty plan", async () => {
  const input = bundle();
  assert.deepEqual(
    await planSecOfflineArchiveImport({ bundle: input, repository: repository({ selectOk: false }).repo }),
    { status: "unavailable", reason: "raw_item_read_failed" },
  );
  assert.deepEqual(
    await planSecOfflineArchiveImport({ bundle: input, repository: repository({ rows: { bad: true } }).repo }),
    { status: "unavailable", reason: "raw_item_read_malformed" },
  );
});

test("apply requires the exact reviewed bundle SHA before any database call", async () => {
  const input = bundle();
  const { repo, calls } = repository({ rows: [] });
  await assert.rejects(
    applySecOfflineArchiveImport({
      bundle: input,
      confirmedBundleSha256: "f".repeat(64),
      repository: repo,
    }),
    (error: unknown) => error instanceof SecOfflineArchivePersistenceError
      && error.code === "bundle_confirmation_mismatch",
  );
  assert.equal(calls.selects, 0);
  assert.equal(calls.rpcs, 0);
});

test("apply stops on a current-state conflict before calling the atomic RPC", async () => {
  const input = bundle();
  const changed = exactExisting(input.items[0]!);
  changed.raw_payload.primary_document_url = "https://www.sec.gov/Archives/edgar/data/2041610/wrong.htm";
  const { repo, calls } = repository({ rows: [changed] });
  await assert.rejects(
    applySecOfflineArchiveImport({
      bundle: input,
      confirmedBundleSha256: input.bundleSha256,
      repository: repo,
    }),
    (error: unknown) => error instanceof SecOfflineArchivePersistenceError
      && error.code === "raw_item_conflict",
  );
  assert.equal(calls.rpcs, 0);
});

test("apply sends the exact prepared bodies once and validates the RPC receipt", async () => {
  const input = bundle();
  let captured: unknown = null;
  const { repo, calls } = repository({
    rows: [],
    rpc: async (name, payload) => {
      assert.equal(name, "import_sec_offline_archive_raw");
      captured = payload;
      return {
        ok: true,
        status: 200,
        data: {
          status: "inserted",
          run_id: input.runId,
          manifest_sha256: input.manifestSha256,
          bundle_sha256: input.bundleSha256,
          inserted_count: 2,
          replayed_count: 0,
          items: input.items.map((item) => ({
            accession_number: item.accessionNumber,
            raw_item_id: item.rawItemId,
            status: "inserted",
          })),
        },
      };
    },
  });
  const result = await applySecOfflineArchiveImport({
    bundle: input,
    confirmedBundleSha256: input.bundleSha256,
    startedAt: "2026-10-08T12:00:00Z",
    repository: repo,
  });
  assert.equal(result.status, "inserted");
  assert.equal(result.insertedCount, 2);
  assert.equal(result.replayedCount, 0);
  assert.equal(calls.selects, 1);
  assert.equal(calls.rpcs, 1);
  assert.ok(captured && typeof captured === "object" && !Array.isArray(captured));
  const rpcPayload = captured as Record<string, unknown>;
  assert.equal(rpcPayload.p_run_id, input.runId);
  assert.equal(rpcPayload.p_started_at, "2026-10-08T12:00:00.000Z");
  const items = rpcPayload.p_items as Array<Record<string, unknown>>;
  assert.equal(items.length, 2);
  assert.equal(
    (items[0]?.rawItem as Record<string, unknown>)?.source_unique_id,
    ACCESSIONS[0],
  );
  assert.equal(
    ((items[0]?.rawItem as Record<string, unknown>)?.raw_payload as Record<string, unknown>)?.primary_document_html,
    input.items[0]?.rawItem.raw_payload.primary_document_html,
  );
});

test("apply rejects a malformed success receipt", async () => {
  const input = bundle();
  const { repo } = repository({
    rows: [],
    rpc: async () => ({ ok: true, status: 200, data: { status: "inserted" } }),
  });
  await assert.rejects(
    applySecOfflineArchiveImport({
      bundle: input,
      confirmedBundleSha256: input.bundleSha256,
      repository: repo,
    }),
    (error: unknown) => error instanceof SecOfflineArchivePersistenceError
      && error.code === "rpc_response_invalid",
  );
});

test("apply rejects internally inconsistent item statuses and summary counts", async () => {
  const input = bundle();
  const { repo } = repository({
    rows: [],
    rpc: async () => ({
      ok: true,
      status: 200,
      data: {
        status: "inserted",
        run_id: input.runId,
        manifest_sha256: input.manifestSha256,
        bundle_sha256: input.bundleSha256,
        inserted_count: 2,
        replayed_count: 0,
        items: input.items.map((item, index) => ({
          accession_number: item.accessionNumber,
          raw_item_id: item.rawItemId,
          status: index === 0 ? "inserted" : "replayed",
        })),
      },
    }),
  });
  await assert.rejects(
    applySecOfflineArchiveImport({
      bundle: input,
      confirmedBundleSha256: input.bundleSha256,
      repository: repo,
    }),
    (error: unknown) => error instanceof SecOfflineArchivePersistenceError
      && error.code === "rpc_response_invalid",
  );
});
