import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decryptBrokerageSecret,
  encryptBrokerageSecret,
  readBrokerageEncryptionKey,
} from "./crypto.ts";
import {
  canUseBrokerage,
  createSnapTradeUserId,
} from "./policy.ts";
import {
  assertOwnedBrokerageAccount,
  mapBrokerageAccount,
  mapBrokeragePosition,
  toPublicBrokerageAccount,
} from "./accountData.ts";
import {
  canonicalizeSnapTradePayload,
  verifySnapTradeSignature,
  verifySnapTradeWebhookPayload,
} from "./webhookSignature.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

test("AES-256-GCM brokerage secrets round-trip with random 12-byte IVs", () => {
  const key = randomBytes(32);
  const first = encryptBrokerageSecret("server-only-secret", key);
  const second = encryptBrokerageSecret("server-only-secret", key);
  assert.equal(Buffer.from(first.iv, "base64").length, 12);
  assert.notEqual(first.iv, second.iv);
  assert.equal(decryptBrokerageSecret(first, key), "server-only-secret");
  assert.throws(() =>
    decryptBrokerageSecret({ ...first, authTag: second.authTag }, key),
  );
  assert.throws(() => readBrokerageEncryptionKey(Buffer.alloc(31).toString("base64")));
});

test("brokerage entitlement is Pro+ and provider user ID is UUID-derived", () => {
  assert.equal(canUseBrokerage("free"), false);
  assert.equal(canUseBrokerage("ad_free"), false);
  assert.equal(canUseBrokerage("pro"), true);
  assert.equal(canUseBrokerage("advanced"), true);
  assert.equal(canUseBrokerage("ultimate"), true);
  assert.equal(
    createSnapTradeUserId("12345678-1234-4123-8123-123456789abc"),
    "stockradar_12345678123441238123123456789abc",
  );
});

test("SnapTrade webhook canonicalization is recursive and preserves array order", () => {
  assert.equal(
    canonicalizeSnapTradePayload({
      z: [{ b: 2, a: 1 }, { d: 4, c: 3 }],
      a: { y: true, x: "value" },
    }),
    '{"a":{"x":"value","y":true},"z":[{"a":1,"b":2},{"c":3,"d":4}]}',
  );
});

test("SnapTrade webhook verifies Base64 HMAC independent of key order and whitespace", () => {
  const previous = process.env.SNAPTRADE_CONSUMER_KEY;
  process.env.SNAPTRADE_CONSUMER_KEY = "webhook-consumer-key";
  try {
    const timestamp = new Date().toISOString();
    const payload = {
      nested: { z: 3, a: [{ y: 2, x: 1 }] },
      eventTimestamp: timestamp,
      webhookId: "webhook-1",
      eventType: "ACCOUNT_UPDATED",
    };
    const signature = createHmac("sha256", "webhook-consumer-key")
      .update(canonicalizeSnapTradePayload(payload))
      .digest("base64");
    const reorderedBody = JSON.stringify(
      {
        webhookId: "webhook-1",
        eventType: "ACCOUNT_UPDATED",
        eventTimestamp: timestamp,
        nested: { a: [{ x: 1, y: 2 }], z: 3 },
      },
      null,
      2,
    );
    assert.equal(verifySnapTradeSignature({
      consumerKey: "webhook-consumer-key",
      payload: JSON.parse(reorderedBody),
      signature,
    }), true);
    assert.equal(
      verifySnapTradeSignature({
        consumerKey: "webhook-consumer-key",
        payload: JSON.parse(reorderedBody.replace('"z": 3', '"z": 4')),
        signature,
      }),
      false,
    );
    assert.equal(
      verifySnapTradeSignature({
        consumerKey: "webhook-consumer-key",
        payload,
        signature: "not-base64!",
      }),
      false,
    );
    assert.equal(
      verifySnapTradeSignature({
        consumerKey: "webhook-consumer-key",
        payload,
        signature: `sha256=${"ab".repeat(32)}`,
      }),
      false,
    );
    const route = read("app/api/webhooks/snaptrade/route.ts");
    assert.match(route, /headers\.get\("signature"\)/);
    assert.doesNotMatch(route, /x-snaptrade-signature|sha256=/);
  } finally {
    if (previous === undefined) delete process.env.SNAPTRADE_CONSUMER_KEY;
    else process.env.SNAPTRADE_CONSUMER_KEY = previous;
  }
});

test("webhook route enforces the five-minute replay window", () => {
  const consumerKey = "replay-key";
  const now = new Date("2026-07-30T12:00:00.000Z");
  const payload = {
    eventTimestamp: "2026-07-30T11:54:59.000Z",
    eventType: "ACCOUNT_UPDATED",
  };
  const signature = createHmac("sha256", consumerKey)
    .update(canonicalizeSnapTradePayload(payload))
    .digest("base64");
  assert.equal(
    verifySnapTradeWebhookPayload({
      body: JSON.stringify(payload),
      consumerKey,
      now,
      signature,
    }),
    null,
  );
  assert.equal(
    verifySnapTradeWebhookPayload({
      body: "null",
      consumerKey,
      now,
      signature,
    }),
    null,
  );
});

test("SDK adapter is server-only, read-only, and never calls trading endpoints", () => {
  const source = read("lib/brokerage/snaptradeProvider.ts");
  assert.match(source, /connectionType: "read"/);
  assert.match(source, /connectionPortalVersion: "v4"/);
  assert.doesNotMatch(source, /\.trading\./);
  assert.match(source, /getAllAccountPositions/);
  assert.doesNotMatch(
    source,
    /getUserAccountPositions|getUserHoldings|getAllUserHoldings/,
  );
  assert.match(source, /getUserAccountOrders/);
  assert.match(
    source,
    /accountInformation\.getAccountActivities\(\{[\s\S]*accountId: account\.id,[\s\S]*limit: ACTIVITY_LIMIT,[\s\S]*type: "BUY,SELL"/,
  );
  assert.match(source, /const ACTIVITY_LOOKBACK_DAYS = 90/);
  assert.match(source, /const ACTIVITY_LIMIT = 100/);
  assert.match(source, /activities\.data\.data \|\| \[\]/);
  assert.doesNotMatch(source, /transactionsAndReporting|getActivities\(\{/);
  assert.doesNotMatch(source, /position\.price|open_pnl|balance/);
  assert.doesNotMatch(source, /console\.(log|warn|error)/);
  assert.match(source, /throw new Error\("BROKERAGE_PROVIDER_REQUEST_FAILED"\)/);
  assert.match(
    source,
    /value === null \|\| value === undefined \|\| value === ""/,
  );
  const portalRoute = read("app/api/account/brokerage/portal/route.ts");
  assert.match(portalRoute, /request\.headers\.get\("origin"\)/);
  assert.match(portalRoute, /assertSameOriginAuthRequest\(request\)/);
});

test("provider and public sharing flags fail closed in production", () => {
  const config = read("lib/brokerage/config.ts");
  assert.match(config, /process\.env\.NODE_ENV !== "production"/);
  assert.match(config, /snaptradePublicProofsEnabled \|\| mockEnabled/);
  const env = read("lib/env.ts");
  for (const key of [
    "SNAPTRADE_CLIENT_ID",
    "SNAPTRADE_CONSUMER_KEY",
    "SNAPTRADE_USER_SECRET_ENCRYPTION_KEY",
    "SNAPTRADE_CONNECTIONS_ENABLED",
    "SNAPTRADE_PUBLIC_PROOFS_ENABLED",
    "SNAPTRADE_MOCK_ENABLED",
    "SNAPTRADE_SANDBOX_BROKER",
    "SNAPTRADE_MANUAL_REFRESH_MONTHLY_LIMIT",
    "SNAPTRADE_MANUAL_REFRESH_COOLDOWN_SECONDS",
    "SNAPTRADE_MANUAL_REFRESH_ESTIMATED_COST_CENTS",
  ]) {
    assert.match(env, new RegExp(key));
  }
  assert.match(config, /process\.env\.NODE_ENV !== "production"[\s\S]+sandboxBroker/);
  assert.match(
    read("lib/brokerage/snaptradeProvider.ts"),
    /\.\.\.\(this\.sandboxBroker \? \{ broker: this\.sandboxBroker \} : \{\}\)/,
  );
});

test("manual refresh is connection-scoped, quota-guarded, and counted by successful webhooks", () => {
  const provider = read("lib/brokerage/snaptradeProvider.ts");
  assert.match(provider, /connections\.refreshBrokerageAuthorization/);
  assert.match(
    provider,
    /authorizationId,[\s\S]+userId: user\.providerUserId,[\s\S]+userSecret: user\.userSecret/,
  );

  const repository = read("lib/brokerage/serverRepository.ts");
  assert.match(repository, /reserve_brokerage_manual_refresh/);
  assert.match(repository, /manualRefreshMonthlyLimit/);
  assert.match(repository, /manualRefreshCooldownSeconds/);
  assert.match(repository, /status: "queued"/);
  assert.match(repository, /status: "succeeded"/);
  assert.match(repository, /provider_accepted_at: null/);
  assert.match(repository, /dataFreshness === "realtime"/);

  const migration = read(
    "supabase/migrations/20260730131500_brokerage_manual_refresh_quota.sql",
  );
  assert.match(migration, /p_monthly_limit integer default 20/);
  assert.match(migration, /p_cooldown_seconds integer default 600/);
  assert.match(migration, /p_estimated_cost_cents integer default 5/);
  assert.match(migration, /status = 'succeeded'[\s\S]+counted_at/);
  assert.match(
    migration,
    /record_brokerage_manual_refresh_webhook[\s\S]+cardinality\(v_completed\) >= cardinality\(v_expected\)/,
  );
  assert.match(migration, /status in \('reserved', 'queued'\)/);
  assert.match(migration, /SYNC_TIMEOUT/);

  const webhook = read("lib/brokerage/webhook.ts");
  assert.match(webhook, /ACCOUNT_HOLDINGS_UPDATED/);
  assert.match(webhook, /brokerageAuthorizationId/);
  assert.match(webhook, /results\.every\(\(result\) => result\.success === true\)/);

  const refreshRoute = read(
    "app/api/account/brokerage/accounts/[accountId]/refresh/route.ts",
  );
  assert.match(refreshRoute, /assertSameOriginAuthRequest\(request\)/);
  assert.match(refreshRoute, /getOptionalCurrentUserId/);
  assert.match(refreshRoute, /BROKERAGE_PRIVATE_HEADERS/);
  assert.doesNotMatch(
    refreshRoute,
    /userSecret|consumerKey|providerToken/,
  );

  const ui = read("components/brokerage/BrokerageAccountClient.tsx");
  assert.match(ui, /manual\s+refreshes remaining/);
  assert.match(ui, /Successful refreshes only/);
  assert.match(ui, /Daily automatic\s+sync continues/);
  assert.match(ui, /10-minute cooldown/);
  assert.match(ui, /Check connection/);
  assert.match(ui, /Refresh data/);
  assert.match(ui, /Sandbox brokerage data refreshed successfully/);
  assert.match(ui, /Manual refresh unavailable/);
  assert.match(ui, /Refresh data stays disabled/);
  assert.doesNotMatch(ui, /Refresh status|return "Loading"/);
});

test("private account DTOs whitelist fields, mask numbers, and distinguish paper accounts", () => {
  const account = mapBrokerageAccount(
    {
      account_category: "Margin",
      brokerage_authorization: "authorization-1",
      id: "account-1",
      institution_account_id: "provider-internal-account-id",
      institution_name: "Sandbox Brokerage",
      is_paper: true,
      name: "Test account",
      number: "1234-5678-9012",
      raw_type: "MARGIN",
      status: "open",
      sync_status: {
        holdings: { initial_sync_completed: true },
        transactions: { initial_sync_completed: true },
      },
      balance: { total: { amount: 123456, currency: "USD" } },
      userSecret: "must-never-leave-server",
      consumerKey: "must-never-leave-server",
      providerToken: "must-never-leave-server",
    } as never,
    {
      data_freshness_mode: "realtime",
      disabled: false,
      id: "authorization-1",
    } as never,
  );
  const serialized = JSON.stringify(account);
  assert.equal(account.isPaper, true);
  assert.equal(account.maskedNumber, "•••• 9012");
  assert.equal(account.connectionStatus, "connected");
  assert.equal(account.dataFreshness, "realtime");
  assert.doesNotMatch(
    serialized,
    /1234-5678|123456|provider-internal|must-never|userSecret|consumerKey|providerToken/,
  );
  assert.equal(assertOwnedBrokerageAccount([account], "account-1")?.id, "account-1");
  assert.equal(assertOwnedBrokerageAccount([account], "account-other"), null);
  assert.doesNotMatch(
    JSON.stringify(
      toPublicBrokerageAccount({
        ...account,
        providerAuthorizationId: "server-only-authorization",
      }),
    ),
    /server-only-authorization|providerAuthorizationId/,
  );
});

test("unified position DTO does not inherit arbitrary provider credentials", () => {
  const position = mapBrokeragePosition({
    cash_equivalent: false,
    cost_basis: 42.5,
    currency: "USD",
    instrument: {
      description: "Example Corporation",
      id: "instrument-1",
      kind: "equity",
      raw_symbol: "EXM",
      symbol: "EXM",
    },
    price: 50,
    units: -2,
    userSecret: "must-never-leave-server",
  } as never);
  assert.equal(position.side, "SHORT");
  assert.equal(position.units, 2);
  assert.equal(position.ticker, "EXM");
  assert.doesNotMatch(JSON.stringify(position), /must-never|userSecret/);
});

test("user mapping is one-to-one and account routes stay private and ownership-scoped", () => {
  const migration = read(
    "supabase/migrations/20260729211748_brokerage_proof_foundation.sql",
  );
  assert.match(
    migration,
    /create table public\.brokerage_connections[\s\S]+user_id uuid primary key/,
  );
  assert.match(migration, /provider_user_id text not null unique/);
  assert.equal(
    createSnapTradeUserId("12345678-1234-4123-8123-123456789abc"),
    createSnapTradeUserId("12345678-1234-4123-8123-123456789abc"),
  );
  assert.notEqual(
    createSnapTradeUserId("12345678-1234-4123-8123-123456789abc"),
    createSnapTradeUserId("22345678-1234-4123-8123-123456789abc"),
  );

  const routes = [
    "app/api/account/brokerage/accounts/route.ts",
    "app/api/account/brokerage/accounts/[accountId]/route.ts",
    "app/api/account/brokerage/accounts/[accountId]/positions/route.ts",
    "app/api/account/brokerage/accounts/[accountId]/orders/route.ts",
    "app/api/account/brokerage/accounts/[accountId]/activities/route.ts",
  ].map(read).join("\n");
  assert.match(routes, /getOptionalCurrentUserId/);
  assert.match(routes, /BROKERAGE_PRIVATE_HEADERS/g);
  const response = read("lib/brokerage/apiResponse.ts");
  assert.match(response, /private, no-store, max-age=0/);
  assert.match(response, /Vary: "Cookie"/);

  const repository = read("lib/brokerage/serverRepository.ts");
  assert.match(
    repository,
    /async function getOwnedBrokerageAccount[\s\S]+const accounts = await provider\.listAccounts\(user\)[\s\S]+assertOwnedBrokerageAccount\(/,
  );
  assert.match(repository, /BROKERAGE_ACCOUNT_NOT_FOUND/);
  assert.match(repository, /BROKERAGE_CREDENTIALS_RESET_REQUIRED/);
  assert.match(repository, /return \{ url \}/);
  assert.doesNotMatch(routes + response, /userSecret|consumerKey|providerToken/);
});

test("public UI avoids ownership claims and preserves required disclosure", () => {
  const files = [
    read("components/brokerage/BrokerageAccountClient.tsx"),
    read("components/brokerage/BrokerageProofCard.tsx"),
    read("app/proofs/[proofId]/page.tsx"),
  ].join("\n");
  assert.match(files, /Brokerage connected/);
  assert.match(files, /isPosition \? "Verified position" : "Verified trade"/);
  assert.doesNotMatch(files, /className=\{styles\.proofType\}/);
  assert.match(files, /America\/New_York/);
  assert.match(files, /not ownership or the accuracy of the analysis/);
  assert.doesNotMatch(files, /Verified owner|ownership verified/i);
  assert.match(files, /Paper account/);
});

test("Live Room message and post writes use transactional proof wrappers", () => {
  const messages = read("lib/live-room/serverRepository.ts");
  const posts = read("lib/live-room/postServerRepository.ts");
  const brokerage = read("lib/brokerage/serverRepository.ts");
  assert.match(messages, /insert_live_room_message_with_attachments/);
  assert.match(posts, /create_live_room_post_with_proof/);
  assert.match(messages, /p_public_sharing_enabled/);
  assert.match(posts, /p_public_sharing_enabled/);
  assert.match(
    brokerage,
    /function readSingle\(value: unknown\)[\s\S]+Array\.isArray\(value\)[\s\S]+typeof value === "object"/,
  );
  assert.match(
    brokerage,
    /p_units: disclosure\.units === true \? candidate\.units : null/,
  );
  assert.match(
    brokerage,
    /p_execution_price:[\s\S]+disclosure\.executionPrice === true[\s\S]+candidate\.executionPrice[\s\S]+: null/,
  );
  const picker = read("components/brokerage/BrokerageEvidencePicker.tsx");
  assert.match(picker, /linked=\{false\}/);
  assert.match(picker, /aria-label="Verified trading"/);
  assert.match(picker, />Verified trading<\/span>/);
  assert.doesNotMatch(picker, />Evidence<\/span>|Add proof|Verified proof/);
  assert.match(picker, /placement="composer"|data-placement=\{placement\}/);
  assert.match(picker, /event\.key !== "Escape"/);
  assert.match(picker, /contains\(event\.target as Node\)/);
  const liveRoomCss = read("components/live-room/LiveRoom.module.css");
  assert.match(
    liveRoomCss,
    /\.composerMeta > span:not\(\.moderationError\)[\s\S]+display: none/,
  );
  assert.doesNotMatch(
    liveRoomCss,
    /\.composerMeta:not\(:has\(\.moderationError\)\)[\s\S]+display: none/,
  );
  assert.match(
    liveRoomCss,
    /\.composerRow\s*\{[\s\S]*grid-template-columns:\s*170px minmax\(220px,\s*1fr\) auto auto auto/,
  );
  assert.match(
    liveRoomCss,
    /@media \(max-width: 760px\)[\s\S]*\.composerRow\s*\{[\s\S]*grid-template-columns:\s*42px minmax\(0,\s*1fr\) 42px 42px 42px/,
  );
  assert.match(read("components/live-room/ChatTimeline.tsx"), /BrokerageProofCard/);
  assert.match(read("components/live-room/PostsPanel.tsx"), /BrokerageEvidencePicker/);
});
