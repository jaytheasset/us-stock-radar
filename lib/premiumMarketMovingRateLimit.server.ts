import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { createPremiumMarketMovingRateLimiter } from "@/lib/premiumMarketMovingRateLimit";

const consumeIdentityLimit = createPremiumMarketMovingRateLimiter();

export function consumePremiumMarketMovingReadLimit(
  request: NextRequest,
  now = Date.now(),
) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const identity = createHash("sha256")
    .update(ip)
    .digest("hex")
    .slice(0, 24);
  return consumeIdentityLimit(identity, now);
}
