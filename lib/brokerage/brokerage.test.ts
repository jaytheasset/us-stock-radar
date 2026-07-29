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
  assert.doesNotMatch(source, /\.trading\./);
  assert.match(source, /getUserAccountPositions/);
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
  ]) {
    assert.match(env, new RegExp(key));
  }
});

test("public UI avoids ownership claims and preserves required disclosure", () => {
  const files = [
    read("components/brokerage/BrokerageAccountClient.tsx"),
    read("components/brokerage/BrokerageProofCard.tsx"),
    read("app/proofs/[proofId]/page.tsx"),
  ].join("\n");
  assert.match(files, /Brokerage connected/);
  assert.match(files, /Broker-linked position/);
  assert.match(files, /Broker-linked execution/);
  assert.match(files, /not ownership or the accuracy of the analysis/);
  assert.doesNotMatch(files, /Verified owner|ownership verified/i);
  assert.match(files, /Paper account/);
});

test("Live Room message and post writes use transactional proof wrappers", () => {
  const messages = read("lib/live-room/serverRepository.ts");
  const posts = read("lib/live-room/postServerRepository.ts");
  const brokerage = read("lib/brokerage/serverRepository.ts");
  assert.match(messages, /insert_live_room_message_with_proof/);
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
  assert.match(read("components/live-room/ChatTimeline.tsx"), /BrokerageProofCard/);
  assert.match(read("components/live-room/PostsPanel.tsx"), /BrokerageEvidencePicker/);
});
