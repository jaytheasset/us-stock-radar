import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

const WINDOW_MS = 60 * 60_000;
const MEMBER_LIMIT = 20;
const GLOBAL_LIMIT = 90;
const MAX_IDENTITIES = 500;

type WindowState = { count: number; resetAt: number };

const memberWindows = new Map<string, WindowState>();
let globalWindow: WindowState = { count: 0, resetAt: 0 };

export function consumeKlipySearchLimit(
  request: NextRequest,
  memberUserId: string,
) {
  const now = Date.now();
  globalWindow = consumeWindow(globalWindow, now);
  if (globalWindow.count >= GLOBAL_LIMIT) {
    return denied(globalWindow.resetAt, now);
  }

  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const identity = createHash("sha256")
    .update(`${memberUserId}:${ip}`)
    .digest("hex")
    .slice(0, 24);
  const current = consumeWindow(memberWindows.get(identity), now);
  if (current.count >= MEMBER_LIMIT) {
    memberWindows.set(identity, current);
    return denied(current.resetAt, now);
  }

  current.count += 1;
  globalWindow.count += 1;
  memberWindows.delete(identity);
  memberWindows.set(identity, current);
  prune();
  return { allowed: true as const };
}

function consumeWindow(state: WindowState | undefined, now: number) {
  return !state || state.resetAt <= now
    ? { count: 0, resetAt: now + WINDOW_MS }
    : state;
}

function denied(resetAt: number, now: number) {
  return {
    allowed: false as const,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((resetAt - now) / 1_000),
    ),
  };
}

function prune() {
  while (memberWindows.size > MAX_IDENTITIES) {
    const oldest = memberWindows.keys().next().value;
    if (typeof oldest !== "string") break;
    memberWindows.delete(oldest);
  }
}
