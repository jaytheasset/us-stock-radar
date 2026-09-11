import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    if (specifier.startsWith("@/")) {
      const base = new URL(`../../${specifier.slice(2)}`, import.meta.url);
      const file = new URL(`${base.href}.ts`);
      const index = new URL(`${base.href}/index.ts`);
      return nextResolve(existsSync(fileURLToPath(file)) ? file.href : index.href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { readSc13IssuerCurrentState } = await import("./currentState.ts");

test("treats malformed successful history responses as unavailable, not empty", async () => {
  for (const data of [null, {}, [null], ["row"]]) {
    const result = await readSc13IssuerCurrentState("201", {
      repository: repository(async () => ({ ok: true, status: 200, data, count: 0 })),
    });
    assert.deepEqual(result, {
      status: "unavailable",
      issuerCik: "0000000201",
      historyComplete: false,
      reason: "history_response_invalid",
    });
  }
});

test("fails closed when exact history count changes between pages", async () => {
  let calls = 0;
  const result = await readSc13IssuerCurrentState("201", {
    repository: repository(async () => {
      calls += 1;
      return calls === 1
        ? { ok: true, status: 200, data: accessionRows(0, 100), count: 150 }
        : { ok: true, status: 200, data: accessionRows(100, 1), count: 151 };
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.status === "unavailable" && result.reason, "history_count_changed");
});

test("does not call a full page complete when the configured page ceiling is reached", async () => {
  const result = await readSc13IssuerCurrentState("201", {
    maxPages: 1,
    repository: repository(async () => ({ ok: true, status: 200, data: accessionRows(0, 100), count: null })),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.status === "unavailable" && result.reason, "history_page_limit_exceeded");
});

test("keeps read failure, duplicate accession, and invalid count distinct", async () => {
  const readFailure = await readSc13IssuerCurrentState("201", {
    repository: repository(async () => ({ ok: false, status: 503, data: null, error: "unavailable" })),
  });
  assert.equal(readFailure.status === "unavailable" && readFailure.reason, "history_read_failed");

  const duplicate = await readSc13IssuerCurrentState("201", {
    repository: repository(async () => ({
      ok: true,
      status: 200,
      data: [{ accession_number: "0000000001-26-000001" }, { accession_number: "0000000001-26-000001" }],
      count: 2,
    })),
  });
  assert.equal(duplicate.status === "unavailable" && duplicate.reason, "history_duplicate_accession");

  const invalidCount = await readSc13IssuerCurrentState("201", {
    repository: repository(async () => ({ ok: true, status: 200, data: [], count: -1 })),
  });
  assert.equal(invalidCount.status === "unavailable" && invalidCount.reason, "history_count_invalid");
});

test("returns a well-formed zero-count page as a complete empty history", async () => {
  const result = await readSc13IssuerCurrentState("201", {
    repository: repository(async () => ({ ok: true, status: 200, data: [], count: 0 })),
  });
  assert.deepEqual(result, { status: "empty", issuerCik: "0000000201", historyComplete: true });
});

function repository(
  select: (table: string, query: Record<string, string>) => Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    count?: number | null;
    error?: string;
  }>,
) {
  return {
    select,
    async rpc() {
      return { ok: false, status: 500, data: null, error: "not used" };
    },
  };
}

function accessionRows(offset: number, length: number) {
  return Array.from({ length }, (_, index) => ({
    accession_number: `${String(offset + index + 1).padStart(10, "0")}-26-000001`,
  }));
}
