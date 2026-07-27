import assert from "node:assert/strict";
import test from "node:test";
import {
  detectDirectMessageRisk,
  evaluateDirectMessage,
} from "./moderation.ts";

const now = "2026-07-28T00:00:00.000Z";

test("pending requests reject every URL form and accept body-only text", () => {
  for (const body of [
    "Visit https://example.com",
    "Open www.example.com",
    "Email mailto:user@example.com",
    "Join example.com/chat",
  ]) {
    const decision = evaluateDirectMessage(body, {
      history: [],
      now,
      request: true,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) assert.equal(decision.reason, "request_link");
  }
  assert.equal(
    evaluateDirectMessage("Hi, I liked your AAPL thesis.", {
      history: [],
      now,
      request: true,
    }).allowed,
    true,
  );
});

test("accepted risky language is warned, not blanket blocked", () => {
  const decision = evaluateDirectMessage(
    "Guaranteed return. Join my Telegram VIP room and send USDT to this wallet address.",
    { history: [], now, request: false },
  );
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.deepEqual(decision.riskFlags, [
    "off_platform_contact",
    "guaranteed_return",
    "paid_room",
    "crypto_wallet",
  ]);
  assert.equal(decision.riskScore, 80);
});

test("English and Korean community safety variants map to closed flags", () => {
  assert.deepEqual(
    detectDirectMessageRisk(
      "카카오톡 VIP방에서 수익 보장, 계좌번호로 입금 후 지갑 주소에 코인 전송",
    ),
    [
      "off_platform_contact",
      "money_transfer",
      "guaranteed_return",
      "paid_room",
      "crypto_wallet",
    ],
  );
  assert.deepEqual(
    detectDirectMessageRisk(
      "Call +1 212 555 0123 or email first@example.com, second@example.com",
    ),
    ["repeated_contact"],
  );
  const repeatedAcrossMessages = evaluateDirectMessage(
    "You can also reach second@example.com",
    {
      history: [
        {
          body: "My first contact is first@example.com",
          createdAt: "2026-07-27T23:59:00.000Z",
        },
      ],
      now,
      request: false,
    },
  );
  assert.equal(repeatedAcrossMessages.allowed, true);
  if (repeatedAcrossMessages.allowed) {
    assert.deepEqual(repeatedAcrossMessages.riskFlags, [
      "repeated_contact",
    ]);
  }
});

test("duplicate and burst limits remain active for requests and chats", () => {
  const duplicate = evaluateDirectMessage("same thought", {
    history: [{ body: "Same thought", createdAt: now }],
    now,
    request: false,
  });
  assert.equal(duplicate.allowed, false);
  if (!duplicate.allowed) assert.equal(duplicate.reason, "duplicate");

  const burst = evaluateDirectMessage("fourth", {
    history: [
      { body: "one", createdAt: now },
      { body: "two", createdAt: now },
      { body: "three", createdAt: now },
    ],
    now,
    request: true,
  });
  assert.equal(burst.allowed, false);
  if (!burst.allowed) assert.equal(burst.reason, "rate_limit");
});

test("accepted chats retain the existing two-link ceiling", () => {
  assert.equal(
    evaluateDirectMessage("https://a.com https://b.com", {
      history: [],
      now,
      request: false,
    }).allowed,
    true,
  );
  const decision = evaluateDirectMessage(
    "https://a.com https://b.com https://c.com",
    { history: [], now, request: false },
  );
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.equal(decision.reason, "excessive_links");
});
