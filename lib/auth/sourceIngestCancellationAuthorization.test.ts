import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { sourceIngestAuthResponse } from "../sourceIngestRouteAuth.ts";

const source = readFileSync("app/api/cron/source-ingest/cancel/route.ts", "utf8");

function loadPost(route: string, onCancel: (id: string) => unknown) {
  const compiled = ts.transpileModule(route, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: { POST?: (request: unknown) => Promise<Response> } = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === "next/server") return { NextResponse: Response };
      if (name === "@/lib/sourceIngestRouteAuth") return { sourceIngestAuthResponse };
      if (name === "@/lib/sourceIngestCancellation") return { cancelSourceIngestWorkflowRun: onCancel };
      throw new Error(`Unexpected route dependency: ${name}`);
    },
  });
  assert.ok(exports.POST);
  return exports.POST;
}

test("real cancellation POST fails closed before reading its body or cancelling a workflow", async () => {
  const previous = [process.env.SOURCE_INGEST_INTERNAL_SECRET, process.env.CRON_SECRET];
  try {
    delete process.env.CRON_SECRET;
    for (const secret of ["", "configured-test-secret"]) {
      process.env.SOURCE_INGEST_INTERNAL_SECRET = secret;
      const post = loadPost(source, () => assert.fail("unauthorized cancellation"));
      const cases: HeadersInit[] = [{}, { authorization: "Bearer wrong-secret" }];
      for (const headers of cases) {
        const response = await post({
          headers: new Headers(headers),
          json() { assert.fail("unauthorized body read"); },
        });
        assert.equal(response.status, secret ? 401 : 500);
        assert.deepEqual(await response.json(), {
          ok: false, error: secret ? "UNAUTHORIZED" : "SOURCE_INGEST_SECRET_MISSING",
        });
        assert.match(response.headers.get("cache-control")!, /no-store/);
      }
    }
    process.env.SOURCE_INGEST_INTERNAL_SECRET = "configured-test-secret";
    for (const mutant of [
      source.replace("sourceIngestAuthResponse(request)", "null"),
      source.replace("if (authResponse) return authResponse;", ""),
    ]) {
      await assert.rejects(() => loadPost(mutant, () => assert.fail("unauthorized cancellation"))({
        headers: new Headers(),
        json() { throw new Error("unauthorized body read"); },
      }), /unauthorized body read/);
    }
    const calls: string[] = [];
    const post = loadPost(source, (id) => { calls.push(id); return { cancelled: true }; });
    const response = await post({
      headers: new Headers({ authorization: "Bearer configured-test-secret" }),
      json: async () => ({ workflowRunId: "test-run" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, ["test-run"]);
  } finally {
    for (const [index, key] of ["SOURCE_INGEST_INTERNAL_SECRET", "CRON_SECRET"].entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  }
});
