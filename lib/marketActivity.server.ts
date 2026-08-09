import "server-only";

import { supabaseRpc } from "@/lib/supabase";
import type { LiveRoomActor } from "@/lib/live-room/policy";
import { normalizeMarketActivityChatRows } from "@/lib/marketActivity";

export async function getMarketActivityChatItems(
  actor: LiveRoomActor | null,
) {
  const result = await supabaseRpc("list_market_activity_chat_items", {
    p_blocker_guest_session_id:
      actor?.kind === "guest" ? actor.guestSessionId : null,
    p_blocker_member_user_id:
      actor?.kind === "member" ? actor.userId : null,
    p_limit: 8,
  });

  if (!result.ok) return [];
  return normalizeMarketActivityChatRows(result.data);
}
