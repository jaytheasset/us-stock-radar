import "server-only";

import { cookies } from "next/headers";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
} from "@/lib/auth/authCookies";

export {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  AUTH_REFRESH_COOKIE_MAX_AGE,
  clearAuthSessionCookies,
  setAuthSessionCookies,
  type AuthCookieSession,
} from "@/lib/auth/authCookies";

export async function getAuthAccessTokenFromCookies() {
  const store = await cookies();
  return store.get(AUTH_ACCESS_COOKIE)?.value || "";
}

export async function getAuthRefreshTokenFromCookies() {
  const store = await cookies();
  return store.get(AUTH_REFRESH_COOKIE)?.value || "";
}

export async function getAuthTokensFromCookies() {
  const store = await cookies();
  return {
    accessToken: store.get(AUTH_ACCESS_COOKIE)?.value || "",
    refreshToken: store.get(AUTH_REFRESH_COOKIE)?.value || "",
  };
}
