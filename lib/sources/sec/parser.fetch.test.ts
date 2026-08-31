import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { SEC_FETCH_TIMEOUT_MS, secFetch } from "./secFetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function hangUntilAborted(signal: AbortSignal | null | undefined) {
  assert.ok(signal, "SEC fetch attempt must include an abort signal");

  return new Promise<Response>((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("secFetch returns a normal response with the 30-second production boundary", async () => {
  let attemptSignal: AbortSignal | null | undefined;
  const expected = new Response("ok", { status: 200 });

  globalThis.fetch = (async (_input, init) => {
    attemptSignal = init?.signal;
    return expected;
  }) as typeof fetch;

  const response = await secFetch("https://www.sec.gov/example");

  assert.equal(SEC_FETCH_TIMEOUT_MS, 30_000);
  assert.equal(response, expected);
  assert.ok(attemptSignal);
  assert.equal(attemptSignal.aborted, false);
});

test("secFetch retries a timed-out attempt with a fresh timeout signal", async () => {
  const attemptSignals: AbortSignal[] = [];

  globalThis.fetch = (async (_input, init) => {
    assert.ok(init?.signal);
    attemptSignals.push(init.signal);
    if (attemptSignals.length === 1) return hangUntilAborted(init.signal);
    return new Response("recovered", { status: 200 });
  }) as typeof fetch;

  const response = await secFetch("https://www.sec.gov/example", { timeoutMs: 10 });

  assert.equal(await response.text(), "recovered");
  assert.equal(attemptSignals.length, 2);
  assert.notEqual(attemptSignals[0], attemptSignals[1]);
  assert.equal(attemptSignals[0]?.aborted, true);
  assert.equal(attemptSignals[1]?.aborted, false);
});

test("secFetch clearly fails after the existing maximum attempts all time out", async () => {
  const attemptSignals: AbortSignal[] = [];

  globalThis.fetch = (async (_input, init) => {
    assert.ok(init?.signal);
    attemptSignals.push(init.signal);
    return hangUntilAborted(init.signal);
  }) as typeof fetch;

  await assert.rejects(
    secFetch("https://www.sec.gov/example", { timeoutMs: 5 }),
    (error: unknown) =>
      error instanceof Error && error.name === "TimeoutError" && /timeout/i.test(error.message),
  );

  assert.equal(attemptSignals.length, 3);
  assert.equal(new Set(attemptSignals).size, 3);
  assert.equal(attemptSignals.every((signal) => signal.aborted), true);
});

test("secFetch preserves 429 and 5xx retry behavior", async (context) => {
  for (const retryStatus of [429, 503]) {
    await context.test(`retries HTTP ${retryStatus}`, async () => {
      let attempts = 0;

      globalThis.fetch = (async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("transient", {
            status: retryStatus,
            headers: { "Retry-After": "0" },
          });
        }
        return new Response("ok", { status: 200 });
      }) as typeof fetch;

      const response = await secFetch("https://www.sec.gov/example", { timeoutMs: 50 });

      assert.equal(response.status, 200);
      assert.equal(attempts, 2);
    });
  }
});
