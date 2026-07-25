import assert from "node:assert/strict";
import test from "node:test";
import { runNasBridge } from "./nasIngestBridge.ts";

test("NAS bridge keeps token headers and exposes only a redacted URL", async () => {
  const bridgeUrl =
    "https://nas.example.test:8443/api/accesswire/raw?private=secret";
  const token = "test-ingest-token";
  let capturedInput = "";
  let capturedInit: RequestInit | undefined;

  const result = await runNasBridge<{
    ok: boolean;
    items: Array<Record<string, unknown>>;
  }>({
    bridgeUrl,
    directResult: {
      status: 403,
      error: "Forbidden",
    },
    fallbackFrom: "test_direct_article_hydration",
    missingError: "bridge missing",
    options: {
      limit: 1,
      sourceUniqueId: "1167001",
      includeArticleBody: true,
      articleBodyLimit: 1,
    },
    source: "accesswire",
    token,
    timeoutMs: 1_000,
    fetchImpl: (async (input, init) => {
      capturedInput = String(input);
      capturedInit = init;
      return Response.json({
        ok: true,
        status: 200,
        items: [
          {
            source_unique_id: "1167001",
            body_text: "NAS article body",
          },
        ],
      });
    }) as typeof fetch,
  });

  const headers = capturedInit?.headers as Record<string, string>;
  const body = JSON.parse(String(capturedInit?.body)) as Record<
    string,
    unknown
  >;

  assert.equal(capturedInput, bridgeUrl);
  assert.equal(headers.Authorization, `Bearer ${token}`);
  assert.equal(headers["X-Ingest-Token"], token);
  assert.equal(body.sourceUniqueId, "1167001");
  assert.equal(body.includeArticleBody, true);
  assert.equal(result.ok, true);
  assert.equal(result.redactedUrl, "https://nas.example.test:8443");
  assert.doesNotMatch(result.redactedUrl, /private|secret|accesswire/i);
  assert.doesNotMatch(JSON.stringify(result), /test-ingest-token/);
});

test("NAS bridge obeys the caller's remaining abort budget", async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const abortTimeout = setTimeout(() => controller.abort(), 50);

  try {
    const result = await runNasBridge({
      bridgeUrl: "https://nas.example.test/api/accesswire/raw",
      directResult: {
        status: 403,
        error: "Forbidden",
      },
      fallbackFrom: "test_shared_budget",
      missingError: "bridge missing",
      options: {
        limit: 1,
        sourceUniqueId: "1167001",
        includeArticleBody: true,
        articleBodyLimit: 1,
      },
      source: "accesswire",
      token: "test-ingest-token",
      timeoutMs: 1_000,
      signal: controller.signal,
      fetchImpl: ((_: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException(
                  "The operation was aborted",
                  "AbortError",
                ),
              ),
            { once: true },
          );
        })) as typeof fetch,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.ok(
      elapsedMs < 250,
      `NAS bridge ignored the shared abort budget: ${elapsedMs}ms`,
    );
  } finally {
    clearTimeout(abortTimeout);
  }
});
