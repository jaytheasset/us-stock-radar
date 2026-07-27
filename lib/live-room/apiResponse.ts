import "server-only";

import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/supabaseAuth";
import { LiveRoomPolicyError } from "./policy";

export const LIVE_ROOM_PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Expires: "0",
  Pragma: "no-cache",
} as const;

export function liveRoomErrorResponse(error: unknown) {
  if (error instanceof LiveRoomPolicyError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
        retryAfterSeconds: error.retryAfterSeconds,
      },
      {
        status: error.status,
        headers: {
          ...LIVE_ROOM_PRIVATE_HEADERS,
          ...(error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : {}),
        },
      },
    );
  }

  if (error instanceof AuthError) {
    return NextResponse.json(
      {
        ok: false,
        error: error.code,
        message: error.message,
      },
      { status: error.status, headers: LIVE_ROOM_PRIVATE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "LIVE_ROOM_UNAVAILABLE",
      message: "The Live Room is temporarily unavailable.",
    },
    { status: 500, headers: LIVE_ROOM_PRIVATE_HEADERS },
  );
}
