import "server-only";

import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/supabaseAuth";
import { LIVE_ROOM_PRIVATE_HEADERS } from "@/lib/live-room/apiResponse";
import { SocialVerificationError } from "./policy";

export function socialVerificationErrorResponse(error: unknown) {
  if (error instanceof SocialVerificationError) {
    return NextResponse.json(
      { ok: false, error: error.code, message: error.message },
      { status: error.status, headers: LIVE_ROOM_PRIVATE_HEADERS },
    );
  }
  if (error instanceof AuthError) {
    return NextResponse.json(
      { ok: false, error: error.code, message: error.message },
      { status: error.status, headers: LIVE_ROOM_PRIVATE_HEADERS },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error: "SOCIAL_VERIFICATION_UNAVAILABLE",
      message: "Social account verification is temporarily unavailable.",
    },
    { status: 500, headers: LIVE_ROOM_PRIVATE_HEADERS },
  );
}
