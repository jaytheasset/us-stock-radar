import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { AuthError } from "@/lib/auth/supabaseAuth";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";
import { KlipyProviderError } from "@/lib/klipy/policy";
import { searchKlipy } from "@/lib/klipy/serverProvider";
import { consumeKlipySearchLimit } from "@/lib/klipy/serverRateLimit";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0",
  Pragma: "no-cache",
} as const;

export async function GET(request: NextRequest) {
  let resolution: Awaited<
    ReturnType<typeof resolveLiveRoomActor>
  > | null = null;
  try {
    assertSameOriginKlipySearchRequest(request);
    assertAllowedSearchParams(request.nextUrl.searchParams);
    resolution = await resolveLiveRoomActor(request);
    if (resolution.actor.kind !== "member") {
      throw new KlipyProviderError(
        "KLIPY_MEMBER_REQUIRED",
        "Sign in to search KLIPY.",
        401,
      );
    }
    const rate = consumeKlipySearchLimit(
      request,
      resolution.actor.userId,
    );
    if (!rate.allowed) {
      throw new KlipyProviderError(
        "KLIPY_RATE_LIMITED",
        "Too many KLIPY searches. Try again later.",
        429,
        rate.retryAfterSeconds,
      );
    }
    const page = await searchKlipy({
      cursor: request.nextUrl.searchParams.get("cursor"),
      limit: request.nextUrl.searchParams.get("limit"),
      query: request.nextUrl.searchParams.get("q"),
    });
    const response = NextResponse.json(
      { data: page, ok: true },
      { headers: PRIVATE_HEADERS },
    );
    applyLiveRoomActorCookies(response, resolution);
    return response;
  } catch (error) {
    const normalized =
      error instanceof KlipyProviderError
        ? error
        : error instanceof AuthError
          ? new KlipyProviderError(
              error.code,
              error.message,
              error.status,
            )
        : new KlipyProviderError(
            "KLIPY_UNAVAILABLE",
            "KLIPY search is temporarily unavailable.",
            500,
          );
    const response = NextResponse.json(
      {
        error: normalized.code,
        message: normalized.message,
        ok: false,
        retryAfterSeconds: normalized.retryAfterSeconds,
      },
      {
        headers: {
          ...PRIVATE_HEADERS,
          ...(normalized.retryAfterSeconds
            ? {
                "Retry-After": String(
                  normalized.retryAfterSeconds,
                ),
              }
            : {}),
        },
        status: normalized.status,
      },
    );
    if (resolution) applyLiveRoomActorCookies(response, resolution);
    return response;
  }
}

function assertAllowedSearchParams(search: URLSearchParams) {
  const allowed = new Set(["cursor", "limit", "q"]);
  for (const key of search.keys()) {
    if (!allowed.has(key)) {
      throw new KlipyProviderError(
        "KLIPY_INVALID_QUERY",
        "That KLIPY search is invalid.",
        400,
      );
    }
  }
}

function assertSameOriginKlipySearchRequest(request: NextRequest) {
  if (
    !request.headers.get("origin") &&
    request.headers.get("sec-fetch-site") === "same-origin"
  ) {
    return;
  }
  assertSameOriginAuthRequest(request);
}
