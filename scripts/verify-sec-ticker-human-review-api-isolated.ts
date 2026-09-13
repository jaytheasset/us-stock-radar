import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

type TestAccount = { email: string; password: string };

const baseUrl = requiredEnv("SEC_TICKER_HUMAN_REVIEW_APP_URL");
const credentialsPath = requiredEnv("SEC_TICKER_HUMAN_REVIEW_TEST_ACCOUNTS_PATH");
const decisionId = requiredEnv("SEC_TICKER_HUMAN_REVIEW_API_DECISION_ID");
const decisionSha256 = requiredEnv("SEC_TICKER_HUMAN_REVIEW_API_DECISION_SHA256");
const outputPath = requiredEnv("SEC_TICKER_HUMAN_REVIEW_API_REPORT_PATH");
assert.equal(baseUrl, "http://127.0.0.2:3114");
assert.match(decisionId, /^[0-9a-f-]{36}$/);
assert.match(decisionSha256, /^[0-9a-f]{64}$/);

const source = JSON.parse(await readFile(credentialsPath, "utf8")) as {
  accounts: Record<"admin" | "ordinary" | "insufficient", TestAccount>;
};
const route = `${baseUrl}/api/admin/data/ticker-resolution/${decisionId}/human-review`;
const payload = {
  action: "reviewed",
  expectedAutomaticSha256: decisionSha256,
  expectedRevision: 0,
  reason: "Product API replay verification of exact SEC evidence.",
};

const crossOrigin = await fetch(route, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://cross-origin.invalid" },
  body: JSON.stringify(payload),
});
assert.equal(crossOrigin.status, 403);

const unauthenticated = await fetch(route, {
  method: "POST",
  headers: { "content-type": "application/json", origin: baseUrl },
  body: JSON.stringify(payload),
});
assert.equal(unauthenticated.status, 401);

for (const label of ["ordinary", "insufficient"] as const) {
  const cookie = await login(source.accounts[label]);
  const response: Response = await fetch(route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: baseUrl,
      "x-request-id": `verify-api-${label}-${randomUUID()}`,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 403, `${label} unexpectedly reached the human review write`);
}

const adminCookie = await login(source.accounts.admin);
const requestId = `verify-api-replay-${randomUUID()}`;
const first = await postAdmin(adminCookie, requestId, payload);
assert.equal(first.response.status, 200, JSON.stringify(first.body));
assert.equal(first.body.data?.write?.status, "inserted");
const replay = await postAdmin(adminCookie, requestId, payload);
assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
assert.equal(replay.body.data?.write?.status, "replayed");
assert.equal(replay.body.data?.write?.humanDecisionId, first.body.data?.write?.humanDecisionId);
const changed = await postAdmin(adminCookie, requestId, {
  ...payload,
  reason: "Changed payload must not replay.",
});
assert.equal(changed.response.status, 409, JSON.stringify(changed.body));
assert.equal(changed.body.error?.code, "ADMIN_TICKER_IDEMPOTENCY_CONFLICT");

const report = {
  schemaVersion: "sec-ticker-human-review-api-isolated-v1",
  appUrl: baseUrl,
  decisionId,
  authorization: {
    crossOrigin: crossOrigin.status,
    unauthenticated: unauthenticated.status,
    ordinary: 403,
    insufficientAdmin: 403,
    operations: 200,
  },
  idempotency: {
    first: first.body.data?.write?.status,
    replay: replay.body.data?.write?.status,
    changedPayloadStatus: changed.response.status,
    singleHumanDecisionId: first.body.data?.write?.humanDecisionId,
  },
  secretsPrinted: false,
  ok: true,
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));

async function login(account: TestAccount) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(account),
  });
  assert.equal(response.status, 200);
  const cookies = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]);
  assert.ok(cookies.length >= 2);
  return cookies.join("; ");
}

async function postAdmin(
  cookie: string,
  requestId: string,
  body: typeof payload,
) {
  const response = await fetch(route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: baseUrl,
      "x-request-id": requestId,
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: (await response.json()) as {
      data?: { write?: Record<string, unknown> };
      error?: { code?: string };
    },
  };
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
