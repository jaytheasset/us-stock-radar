import "server-only";

import { supabaseRpc } from "@/lib/supabase";
import type { LiveRoomActor } from "./policy";
import {
  assertLiveRoomMutationRateLimitResult,
  buildLiveRoomRateLimitActorKey,
  type LiveRoomMutationRateLimitAction,
  type LiveRoomMutationRateLimitRpcResult,
} from "./mutationRateLimitPolicy";

type RpcCall = (
  functionName: string,
  payload: Record<string, unknown>,
) => Promise<LiveRoomMutationRateLimitRpcResult>;

export async function assertLiveRoomMutationRateLimit(
  actor: LiveRoomActor,
  action: LiveRoomMutationRateLimitAction,
  rpc: RpcCall = supabaseRpc,
) {
  const result = await rpc("consume_live_room_mutation_rate_limit", {
    p_action: action,
    p_actor_key: buildLiveRoomRateLimitActorKey(actor),
  });
  assertLiveRoomMutationRateLimitResult(result, action);
}
