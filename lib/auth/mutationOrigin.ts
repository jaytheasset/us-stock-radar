import { NextResponse } from "next/server.js";
import {
  AUTH_PRIVATE_HEADERS,
  isSameOriginRequest,
} from "./authPolicy.ts";

/** Shared response boundary for cookie-authenticated first-party mutations. */
export function rejectCrossOriginMutationRequest(
  request: Request,
  headers: Record<string, string> = AUTH_PRIVATE_HEADERS,
) {
  if (isSameOriginRequest(request)) return null;
  return NextResponse.json(
    {
      ok: false,
      error: "REQUEST_ORIGIN_REJECTED",
      message: "Invalid request origin.",
    },
    { status: 403, headers },
  );
}
