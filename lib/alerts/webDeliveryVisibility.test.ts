import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWebDeliveredAlertsQuery,
  normalizeWebDeliveredRows,
} from "./webDeliveryVisibility.ts";

const ownerId = "00000000-0000-4000-8000-000000000101";

function delivery({
  id,
  parentStatus,
  parentChannels = ["web", "email"],
  webStatus,
  readAt = null,
}: {
  id: string;
  parentStatus: string;
  parentChannels?: string[];
  webStatus?: string;
  readAt?: string | null;
}) {
  return {
    id,
    user_id: ownerId,
    title: `Alert ${id}`,
    delivery_status: parentStatus,
    delivered_channels: parentChannels,
    delivered_at: "2026-08-03T00:00:00.000Z",
    read_at: readAt,
    web_delivery_attempts: webStatus ? [{ channel: "web", status: webStatus }] : [],
    sent_web_delivery_attempts: webStatus === "sent"
      ? [{ channel: "web", status: "sent", completed_at: "2026-08-03T00:01:00.000Z" }]
      : [],
  };
}

test("Web sent remains visible while Email is queued for retry or failed", () => {
  for (const parentStatus of ["queued", "failed"]) {
    const rows = normalizeWebDeliveredRows([
      {
        ...delivery({ id: `partial-${parentStatus}`, parentStatus, webStatus: "sent" }),
        email_attempt: { status: parentStatus === "queued" ? "pending" : "failed" },
      },
    ]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.delivery_status, "sent");
    assert.deepEqual(rows[0]?.delivered_channels, ["web"]);
    assert.equal(rows[0]?.delivered_at, "2026-08-03T00:01:00.000Z");
  }
});

test("Email success or failure never makes an unsuccessful Web attempt visible", () => {
  const rows = normalizeWebDeliveredRows([
    { ...delivery({ id: "web-queued", parentStatus: "queued", webStatus: "pending" }), email_attempt: { status: "sent" } },
    { ...delivery({ id: "web-failed", parentStatus: "failed", webStatus: "failed" }), email_attempt: { status: "failed" } },
    delivery({ id: "email-only", parentStatus: "sent", parentChannels: ["email"] }),
    delivery({ id: "bad-parent-fallback", parentStatus: "sent", webStatus: "failed" }),
  ]);

  assert.deepEqual(rows, []);
});

test("all-sent and legacy Web deliveries appear exactly once", () => {
  const allSent = delivery({ id: "all-sent", parentStatus: "sent", webStatus: "sent" });
  const legacy = delivery({ id: "legacy", parentStatus: "sent", parentChannels: ["web"] });
  const rows = normalizeWebDeliveredRows([allSent, allSent, legacy]);

  assert.deepEqual(rows.map((row) => row.id), ["all-sent", "legacy"]);
});

test("read state is preserved and the query scopes owner, unread count, and pagination", () => {
  const rows = normalizeWebDeliveredRows([
    delivery({ id: "unread", parentStatus: "queued", webStatus: "sent" }),
    delivery({ id: "read", parentStatus: "failed", webStatus: "sent", readAt: "2026-08-03T00:02:00.000Z" }),
  ]);
  assert.equal(rows[0]?.read_at, null);
  assert.equal(rows[1]?.read_at, "2026-08-03T00:02:00.000Z");

  const query = buildWebDeliveredAlertsQuery({
    userId: ownerId,
    select: "id",
    limit: 25,
    offset: 50,
    unreadOnly: true,
  });
  assert.equal(query.user_id, `eq.${ownerId}`);
  assert.equal(query["web_delivery_attempts.user_id"], `eq.${ownerId}`);
  assert.equal(query["web_delivery_attempts.channel"], "eq.web");
  assert.equal(query["sent_web_delivery_attempts.status"], "eq.sent");
  assert.match(query.or, /sent_web_delivery_attempts\.not\.is\.null/);
  assert.match(query.or, /web_delivery_attempts\.is\.null/);
  assert.match(query.or, /delivery_status\.eq\.sent/);
  assert.match(query.or, /delivered_channels\.cs\.\{web\}/);
  assert.equal(query.read_at, "is.null");
  assert.equal(query.limit, "25");
  assert.equal(query.offset, "50");
});
