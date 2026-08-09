import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
} from "@/lib/auth/authCookies";
import {
  buildMarketActivityIndexItems,
  marketActivityIndexDefinitions,
  type MarketActivityPayload,
} from "@/lib/marketActivity";
import { getMarketActivityChatItems } from "@/lib/marketActivity.server";
import { readMarketQuoteCacheMap } from "@/lib/marketDataCache";
import { LIVE_ROOM_PRIVATE_HEADERS } from "@/lib/live-room/apiResponse";
import { LIVE_ROOM_GUEST_COOKIE } from "@/lib/live-room/guestIdentity";
import type { LiveRoomActor } from "@/lib/live-room/policy";
import {
  applyLiveRoomActorCookies,
  resolveLiveRoomActor,
} from "@/lib/live-room/serverActor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const quotesPromise = readMarketQuoteCacheMap(
    marketActivityIndexDefinitions.map((item) => item.symbol),
  );
  const hasExistingIdentity =
    request.cookies.has(AUTH_ACCESS_COOKIE) ||
    request.cookies.has(AUTH_REFRESH_COOKIE) ||
    request.cookies.has(LIVE_ROOM_GUEST_COOKIE);
  let resolution: Awaited<ReturnType<typeof resolveLiveRoomActor>> | null = null;
  let actor: LiveRoomActor | null = null;
  let identityFailed = false;

  if (hasExistingIdentity) {
    try {
      resolution = await resolveLiveRoomActor(request);
      actor = resolution.actor;
    } catch {
      // If a known viewer cannot be resolved, omit chat rather than risk
      // bypassing their personal block list. Public market data can still load.
      identityFailed = true;
    }
  }

  const [quotes, chats] = await Promise.all([
    quotesPromise,
    identityFailed ? Promise.resolve([]) : getMarketActivityChatItems(actor),
  ]);
  const data: MarketActivityPayload = {
    chats,
    indices: buildMarketActivityIndexItems(quotes),
  };
  const response = NextResponse.json(
    { data, ok: true },
    { headers: LIVE_ROOM_PRIVATE_HEADERS },
  );
  if (resolution) applyLiveRoomActorCookies(response, resolution);
  return response;
}
