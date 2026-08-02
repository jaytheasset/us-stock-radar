import assert from "node:assert/strict";
import test from "node:test";
import { createPremiumMarketMovingRateLimiter } from "./premiumMarketMovingRateLimit.ts";

test("bounds uncached reads per identity and globally, then resets the window", () => {
  const consume = createPremiumMarketMovingRateLimiter();
  const now = 10_000;

  for (let index = 0; index < 30; index += 1) {
    assert.deepEqual(consume("same-identity", now), { allowed: true });
  }
  assert.deepEqual(consume("same-identity", now), {
    allowed: false,
    retryAfterSeconds: 60,
  });

  for (let index = 0; index < 570; index += 1) {
    assert.deepEqual(consume(`identity-${index}`, now), { allowed: true });
  }
  assert.deepEqual(consume("global-limit", now), {
    allowed: false,
    retryAfterSeconds: 60,
  });
  assert.deepEqual(consume("global-limit", now + 60_000), { allowed: true });
});
