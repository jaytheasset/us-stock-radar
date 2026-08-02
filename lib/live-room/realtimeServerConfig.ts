import "server-only";

import type { LiveRoomRealtimeConfig } from "./apiRepository";
import {
  getDevelopmentAllowedOrigins,
  isAllowedDevelopmentOrigin,
} from "../devAllowedOrigins.ts";

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
      !isAllowedDevelopmentOrigin(url.origin, {
        nodeEnv: process.env.NODE_ENV,
        value: process.env.DEV_ALLOWED_ORIGINS,
      })
    ) {
      return null;
    }
    return {
      publishableKey,
      url: url.toString().replace(/\/$/, ""),
      developmentAllowedOrigins: getDevelopmentAllowedOrigins({
        nodeEnv: process.env.NODE_ENV,
        value: process.env.DEV_ALLOWED_ORIGINS,
      }),
    };
  } catch {
    return null;
  }
}
