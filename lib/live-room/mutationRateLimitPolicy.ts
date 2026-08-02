import { LiveRoomPolicyError, type LiveRoomActor } from "./policy.ts";

export const LIVE_ROOM_MUTATION_RATE_LIMITS = {
  follow: { limit: 60, windowSeconds: 10 * 60 },
  like: { limit: 120, windowSeconds: 5 * 60 },
  report: { limit: 10, windowSeconds: 60 * 60 },
} as const;

export type LiveRoomMutationRateLimitAction =
  keyof typeof LIVE_ROOM_MUTATION_RATE_LIMITS;

export type LiveRoomMutationRateLimitRpcResult = {
  data: unknown;
  error?: string;
  ok: boolean;
  status: number;
};

export function assertLiveRoomMutationRateLimitResult(
  result: LiveRoomMutationRateLimitRpcResult,
  action: LiveRoomMutationRateLimitAction,
) {
  const row = readSingleRow(result.data);

  if (!result.ok || !row || typeof row.allowed !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_RATE_LIMIT_UNAVAILABLE",
      "This action is temporarily unavailable.",
      503,
    );
  }
  if (row.allowed) return;

  throw new LiveRoomPolicyError(
    `LIVE_ROOM_${action.toUpperCase()}_RATE_LIMITED`,
    rateLimitMessage(action),
    429,
    normalizeRetryAfter(row.retry_after_seconds, action),
  );
}

export function buildLiveRoomRateLimitActorKey(actor: LiveRoomActor) {
  return actor.kind === "member"
    ? `member:${actor.userId}`
    : `guest:${actor.guestSessionId}`;
}

function readSingleRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const row = value[0];
    return row && typeof row === "object"
      ? (row as Record<string, unknown>)
      : null;
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeRetryAfter(
  value: unknown,
  action: LiveRoomMutationRateLimitAction,
) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 1) {
    return Math.min(
      LIVE_ROOM_MUTATION_RATE_LIMITS[action].windowSeconds,
      Math.ceil(parsed),
    );
  }
  return LIVE_ROOM_MUTATION_RATE_LIMITS[action].windowSeconds;
}

function rateLimitMessage(action: LiveRoomMutationRateLimitAction) {
  if (action === "follow") return "Too many follow changes. Try again later.";
  if (action === "like") return "Too many like changes. Try again later.";
  return "Too many reports. Try again later.";
}
