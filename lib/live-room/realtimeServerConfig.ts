import "server-only";

import type { LiveRoomRealtimeConfig } from "./apiRepository";

export function getLiveRoomRealtimeConfig(): LiveRoomRealtimeConfig | null {
  const publishableKey = (process.env.SUPABASE_ANON_KEY || "").trim();
  const rawUrl = (process.env.SUPABASE_URL || "").trim();
  if (!publishableKey || !rawUrl) return null;

  try {
    const url = new URL(
      rawUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, ""),
    );
    if (
      url.protocol !== "https:" &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "localhost"
    ) {
      return null;
    }
    return { publishableKey, url: url.toString().replace(/\/$/, "") };
  } catch {
    return null;
  }
}
