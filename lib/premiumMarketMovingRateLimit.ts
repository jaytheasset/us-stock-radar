const WINDOW_MS = 60_000;
export const PREMIUM_MARKET_MOVING_IDENTITY_LIMIT = 30;
export const PREMIUM_MARKET_MOVING_GLOBAL_LIMIT = 600;
export const PREMIUM_MARKET_MOVING_MAX_IDENTITIES = 1_000;

type WindowState = { count: number; resetAt: number };

export function createPremiumMarketMovingRateLimiter() {
  const identityWindows = new Map<string, WindowState>();
  let globalWindow: WindowState = { count: 0, resetAt: 0 };

  return (identity: string, now = Date.now()) => {
    globalWindow = currentWindow(globalWindow, now);
    if (globalWindow.count >= PREMIUM_MARKET_MOVING_GLOBAL_LIMIT) {
      return denied(globalWindow.resetAt, now);
    }

    const current = currentWindow(identityWindows.get(identity), now);
    if (current.count >= PREMIUM_MARKET_MOVING_IDENTITY_LIMIT) {
      identityWindows.set(identity, current);
      return denied(current.resetAt, now);
    }

    current.count += 1;
    globalWindow.count += 1;
    identityWindows.delete(identity);
    identityWindows.set(identity, current);
    pruneIdentityWindows(identityWindows);
    return { allowed: true as const };
  };
}

function currentWindow(state: WindowState | undefined, now: number) {
  return !state || state.resetAt <= now
    ? { count: 0, resetAt: now + WINDOW_MS }
    : state;
}

function denied(resetAt: number, now: number) {
  return {
    allowed: false as const,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
  };
}

function pruneIdentityWindows(identityWindows: Map<string, WindowState>) {
  while (identityWindows.size > PREMIUM_MARKET_MOVING_MAX_IDENTITIES) {
    const oldest = identityWindows.keys().next().value;
    if (typeof oldest !== "string") break;
    identityWindows.delete(oldest);
  }
}
