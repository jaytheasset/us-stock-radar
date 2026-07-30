import "server-only";

import { supabaseSelect } from "@/lib/supabase";
import { normalizeLiveRoomTicker } from "./adapters";
import { getCommunityRoomIdentity } from "./communityServerRepository";
import type {
  LiveRoomAvailability,
  LiveRoomAvailabilityStatus,
} from "./roomAvailability";

export async function getLiveRoomAvailability(input: {
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomAvailability> {
  let result;
  if (input.ticker && !input.slug) {
    const ticker = normalizeLiveRoomTicker(input.ticker);
    result = await supabaseSelect("live_room_rooms", {
      select: "admin_status",
      room_kind: "eq.company",
      ticker: `eq.${ticker}`,
      limit: "1",
    });
  } else if (input.slug && !input.ticker) {
    const room = await getCommunityRoomIdentity(input.slug);
    result = await supabaseSelect("live_room_rooms", {
      select: "admin_status",
      id: `eq.${room.id}`,
      limit: "1",
    });
  } else {
    return { status: "active" };
  }
  if (!result.ok) return { status: "active" };
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  const value =
    row && typeof row === "object"
      ? String((row as Record<string, unknown>).admin_status || "")
      : "";
  return {
    status: isAvailabilityStatus(value) ? value : "active",
  };
}

function isAvailabilityStatus(
  value: string,
): value is LiveRoomAvailabilityStatus {
  return value === "active" || value === "locked" || value === "archived";
}
