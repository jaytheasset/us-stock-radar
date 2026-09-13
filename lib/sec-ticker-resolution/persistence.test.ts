import assert from "node:assert/strict";
import test from "node:test";
import {
  listSecTickerResolutions,
  readSecTickerResolutionByDecisionId,
  SEC_TICKER_RESOLUTION_LIST_LIMIT,
  type SecTickerResolutionRepository,
} from "./persistence.ts";

type Row = Record<string, unknown>;

function repository(select: SecTickerResolutionRepository["select"]): SecTickerResolutionRepository {
  return {
    select,
    rpc: async () => ({ ok: false, status: 500, data: null }),
  };
}

test("bounded list reports an empty successful read without inventing records", async () => {
  const captured: { table: string; query: Record<string, string> } = { table: "", query: {} };
  const result = await listSecTickerResolutions({
    repository: repository(async (table, query) => {
      captured.table = table;
      captured.query = query;
      return { ok: true, status: 200, data: [] };
    }),
  });

  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.deepEqual(result.scope, {
    scanned: 0,
    limit: SEC_TICKER_RESOLUTION_LIST_LIMIT,
    truncated: false,
  });
  assert.deepEqual(result.counts, { AUTO: 0, REVIEW: 0, UNRESOLVED: 0, unavailable: 0 });
  assert.deepEqual(result.relationships, []);
  assert.equal(captured.table, "sec_ticker_resolution_decisions");
  assert.equal(captured.query.limit, String(SEC_TICKER_RESOLUTION_LIST_LIMIT));
});

test("list read failure remains unavailable and does not masquerade as empty", async () => {
  const result = await listSecTickerResolutions({
    repository: repository(async () => ({ ok: false, status: 503, data: { private: "do-not-leak" } })),
  });
  assert.deepEqual(result, { status: "unavailable", reason: "decision_list_read_failed" });
  assert.doesNotMatch(JSON.stringify(result), /do-not-leak/);
});

test("invalid list filters fail before any database read", async () => {
  let reads = 0;
  const repo = repository(async () => {
    reads += 1;
    return { ok: true, status: 200, data: [] };
  });
  assert.deepEqual(
    await listSecTickerResolutions({ state: "APPROVED", repository: repo }),
    { status: "unavailable", reason: "invalid_resolution_state" },
  );
  assert.deepEqual(
    await listSecTickerResolutions({ query: "x".repeat(121), repository: repo }),
    { status: "unavailable", reason: "invalid_resolution_query" },
  );
  assert.equal(reads, 0);
});

test("an unvalidated saved AUTO is excluded from state counts and confirmed relationships", async () => {
  const unvalidatedAuto: Row = {
    id: "67ebe0d3-4592-58a9-b1bf-6c0d32a60b8a",
    resolution_state: "AUTO",
    decision_payload: { input: {} },
  };
  const result = await listSecTickerResolutions({
    state: "AUTO",
    repository: repository(async (table) => ({
      ok: true,
      status: 200,
      data: table === "sec_ticker_resolution_decisions" ? [unvalidatedAuto] : [],
    })),
  });

  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.counts.AUTO, 0);
  assert.equal(result.counts.unavailable, 1);
  assert.deepEqual(result.relationships, []);
  assert.equal(result.unavailable[0]?.decisionId, unvalidatedAuto.id);
});

test("exact decision selection is ID-bound and never substitutes another saved row", async () => {
  const requested = "67ebe0d3-4592-58a9-b1bf-6c0d32a60b8a";
  const other = "92f17062-2c62-5736-97bf-428e0d779585";
  let capturedId = "";
  const result = await readSecTickerResolutionByDecisionId({
    decisionId: requested,
    repository: repository(async (_table, query) => {
      capturedId = query.id;
      return { ok: true, status: 200, data: [{ id: other }] };
    }),
  });
  assert.equal(capturedId, `eq.${requested}`);
  assert.deepEqual(result, { status: "unavailable", reason: "decision_id_mismatch" });
});

test("exact decision not-found, invalid ID, and read failure stay distinct", async () => {
  const validId = "67ebe0d3-4592-58a9-b1bf-6c0d32a60b8a";
  assert.deepEqual(
    await readSecTickerResolutionByDecisionId({
      decisionId: validId,
      repository: repository(async () => ({ ok: true, status: 200, data: [] })),
    }),
    { status: "not_found" },
  );
  assert.deepEqual(
    await readSecTickerResolutionByDecisionId({
      decisionId: "not-a-uuid",
      repository: repository(async () => { throw new Error("must not run"); }),
    }),
    { status: "unavailable", reason: "invalid_decision_id" },
  );
  assert.deepEqual(
    await readSecTickerResolutionByDecisionId({
      decisionId: validId,
      repository: repository(async () => ({ ok: false, status: 500, data: null })),
    }),
    { status: "unavailable", reason: "decision_read_failed" },
  );
});
