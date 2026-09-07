import "server-only";

import type { LiveRoomRealtimeConfig } from "./apiRepository";
import { getServerEnv } from "../env.ts";
import {
  getDevelopmentAllowedOrigins,
  isAllowedDevelopmentOrigin,
} from "../devAllowedOrigins.ts";

export function getLiveRoomRealtimeConfig(): LiveRoomRealtimeConfig | null {
  const env = getServerEnv();
  const publishableKey = env.supabasePublishableKey;
  const rawUrl = env.supabaseUrl.trim();
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
