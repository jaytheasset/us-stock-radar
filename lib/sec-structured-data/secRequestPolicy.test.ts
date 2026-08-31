import assert from "node:assert/strict";
import test from "node:test";
import { SecStructuredHttpClient } from "./httpClient.ts";
import {
  SEC_STRUCTURED_REQUEST_TIMEOUT_MS,
  SecRequestError,
  SecRequestPolicy,
} from "./secRequestPolicy.ts";

test("structured SEC request timeout defaults to 30 seconds", () => {
  assert.equal(SEC_STRUCTURED_REQUEST_TIMEOUT_MS, 30_000);
});

test("shared SEC request policy serializes aggregate cadence and retries only bounded transient statuses", async () => {
  let now = 0;
  const requests: Array<{ url: string; at: number; userAgent: string | null }> = [];
  const attempts = new Map<string, number>();
  const policy = new SecRequestPolicy("Stock Radar ops@example.com", {
    minimumIntervalMs: 125,
    maximumAttempts: 3,
    baseBackoffMs: 500,
    maximumBackoffMs: 1_000,
    nowMs: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    fetchImplementation: async (input, init) => {
      const url = String(input);
      requests.push({ url, at: now, userAgent: new Headers(init?.headers).get("user-agent") });
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      if (url.endsWith("/transient") && attempt === 1) return new Response("busy", { status: 503 });
      return new Response("ok", { status: 200 });
    },
  });

  const [first, second] = await Promise.all([
    policy.fetch("https://www.sec.gov/transient"),
    policy.fetch("https://data.sec.gov/second"),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(requests.map((request) => request.at), [0, 500, 625]);
  assert.equal(requests.every((request) => request.userAgent === "Stock Radar ops@example.com"), true);
  assert.deepEqual([...attempts.values()], [2, 1]);
});

test("non-transient HTTP and malformed JSON are not retried, while final transient metadata is returned", async () => {
  let calls = 0;
  let now = 0;
  const policy = new SecRequestPolicy("Stock Radar ops@example.com", {
    nowMs: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    fetchImplementation: async (input) => {
      calls += 1;
      if (String(input).includes("bad-request")) return new Response("bad", { status: 400 });
      if (String(input).includes("rate-limit")) return new Response("slow", { status: 429 });
      return new Response("not-json", { status: 200 });
    },
  });
  assert.equal((await policy.fetch("https://www.sec.gov/bad-request")).status, 400);
  assert.equal(calls, 1);
  assert.equal((await policy.fetch("https://www.sec.gov/rate-limit")).status, 429);
  assert.equal(calls, 4);

  const client = new SecStructuredHttpClient(
    "Stock Radar ops@example.com",
    125,
    undefined,
    () => new Date("2026-08-22T00:00:00Z"),
    policy,
  );
  await assert.rejects(() => client.fetchCompanyFacts("0000320193", "incremental"), /not valid JSON/);
  assert.equal(calls, 5);
});

test("network retry cap remains explicit", async () => {
  let calls = 0;
  let now = 0;
  const policy = new SecRequestPolicy("Stock Radar ops@example.com", {
    nowMs: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    fetchImplementation: async () => {
      calls += 1;
      throw new TypeError("socket closed");
    },
  });
  await assert.rejects(
    () => policy.fetch("https://www.sec.gov/network"),
    (error: unknown) => error instanceof SecRequestError && error.code === "NETWORK_FAILURE",
  );
  assert.equal(calls, 3);
});

test("per-attempt timeout enters the existing retry flow and can recover", async () => {
  let calls = 0;
  const abortReasons: unknown[] = [];
  const policy = new SecRequestPolicy("Stock Radar ops@example.com", {
    minimumIntervalMs: 100,
    requestTimeoutMs: 5,
    baseBackoffMs: 0,
    maximumBackoffMs: 0,
    sleep: async () => undefined,
    fetchImplementation: async (_input, init) => {
      calls += 1;
      if (calls > 1) return new Response("ok", { status: 200 });
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortReasons.push(init.signal?.reason);
          reject(init.signal?.reason);
        }, { once: true });
      });
    },
  });

  assert.equal((await policy.fetch("https://data.sec.gov/submissions/CIK0001840317.json")).status, 200);
  assert.equal(calls, 2);
  assert.equal(abortReasons.length, 1);
  assert.equal(abortReasons[0] instanceof DOMException, true);
  assert.equal((abortReasons[0] as DOMException).name, "TimeoutError");
});

test("per-attempt timeout fails through SecRequestError after the existing retry cap", async () => {
  let calls = 0;
  const policy = new SecRequestPolicy("Stock Radar ops@example.com", {
    minimumIntervalMs: 100,
    maximumAttempts: 2,
    requestTimeoutMs: 5,
    baseBackoffMs: 0,
    maximumBackoffMs: 0,
    sleep: async () => undefined,
    fetchImplementation: async (_input, init) => {
      calls += 1;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    },
  });

  await assert.rejects(
    () => policy.fetch("https://data.sec.gov/api/xbrl/companyfacts/CIK0001840317.json"),
    (error: unknown) => error instanceof SecRequestError
      && error.code === "NETWORK_FAILURE"
      && error.cause instanceof DOMException
      && error.cause.name === "TimeoutError",
  );
  assert.equal(calls, 2);
});

test("caller abort signal remains connected to every attempt", async () => {
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  let calls = 0;
  const policy = new SecRequestPolicy("Stock Radar ops@example.com", {
    minimumIntervalMs: 100,
    maximumAttempts: 2,
    requestTimeoutMs: 100,
    baseBackoffMs: 0,
    maximumBackoffMs: 0,
    sleep: async () => undefined,
    fetchImplementation: async (_input, init) => {
      calls += 1;
      assert.equal(init?.signal?.aborted, true);
      assert.equal(init?.signal?.reason, reason);
      throw init?.signal?.reason;
    },
  });
  controller.abort(reason);

  await assert.rejects(
    () => policy.fetch("https://www.sec.gov/Archives/example", { signal: controller.signal }),
    (error: unknown) => error instanceof SecRequestError && error.cause === reason,
  );
  assert.equal(calls, 2);
});

test("incremental Submissions skips historical files while bootstrap fetches only issuer-declared history", async () => {
  let now = 0;
  const urls: string[] = [];
  const main = {
    cik: "0000320193",
    filings: { files: [{ name: "CIK0000320193-submissions-001.json" }] },
  };
  const policy = new SecRequestPolicy("Stock Radar ops@example.com", {
    nowMs: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
    fetchImplementation: async (input) => {
      const url = String(input);
      urls.push(url);
      return new Response(JSON.stringify(url.endsWith("CIK0000320193.json") ? main : { filings: [] }), { status: 200 });
    },
  });
  const client = new SecStructuredHttpClient(
    "Stock Radar ops@example.com", 125, undefined, () => new Date("2026-08-22T00:00:00Z"), policy,
  );
  assert.equal((await client.fetchSubmissions("0000320193", "incremental")).length, 1);
  assert.equal((await client.fetchSubmissions("0000320193", "bootstrap")).length, 2);
  assert.deepEqual(urls, [
    "https://data.sec.gov/submissions/CIK0000320193.json",
    "https://data.sec.gov/submissions/CIK0000320193.json",
    "https://data.sec.gov/submissions/CIK0000320193-submissions-001.json",
  ]);
  assert.equal(urls.some((url) => /\.zip$/i.test(url)), false);
});
