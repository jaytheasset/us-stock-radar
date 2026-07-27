import "server-only";

import { getServerEnv } from "@/lib/env";
import { supabaseUpsert } from "@/lib/supabase";

export type SupabaseAuthUser = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
};

export type SupabaseAuthSession = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: SupabaseAuthUser | null;
};

export class AuthError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

export async function signUpWithEmail(email: string, password: string, redirectTo: string) {
  const payload = await callSupabaseAuth<SupabaseAuthSession>(
    `/auth/v1/signup?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
    method: "POST",
    body: {
      email,
      password,
    },
    },
  );

  if (payload.user) {
    await ensureUserBootstrap(payload.user);
  }

  return payload;
}

export async function signInWithEmail(email: string, password: string) {
  const payload = await callSupabaseAuth<SupabaseAuthSession>("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: {
      email,
      password,
    },
  });

  if (!payload.access_token || !payload.user) {
    throw new AuthError("LOGIN_FAILED", "Login did not return a valid session.", 401);
  }

  await ensureUserBootstrap(payload.user);
  return payload;
}

export async function refreshSupabaseSession(refreshToken: string) {
  if (!refreshToken) {
    throw new AuthError("REFRESH_TOKEN_MISSING", "Refresh token is missing.", 401);
  }

  const payload = await callSupabaseAuth<SupabaseAuthSession>(
    "/auth/v1/token?grant_type=refresh_token",
    {
      method: "POST",
      body: {
        refresh_token: refreshToken,
      },
    },
  );

  if (!payload.access_token || !payload.refresh_token || !payload.user?.id) {
    throw new AuthError("REFRESH_FAILED", "Session refresh did not return a valid session.", 401);
  }

  return payload;
}

export async function resendSignupConfirmation(email: string, redirectTo: string) {
  await callSupabaseAuth<Record<string, unknown>>("/auth/v1/resend", {
    method: "POST",
    body: {
      type: "signup",
      email,
      options: {
        email_redirect_to: redirectTo,
      },
    },
  });
}

export async function requestPasswordRecovery(email: string, redirectTo: string) {
  await callSupabaseAuth<Record<string, unknown>>(
    `/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`,
    {
      method: "POST",
      body: {
        email,
      },
    },
  );
}

export async function updateSupabasePassword(accessToken: string, password: string) {
  return callSupabaseAuth<SupabaseAuthUser>("/auth/v1/user", {
    method: "PUT",
    accessToken,
    body: {
      password,
    },
  });
}

export async function revokeSupabaseSession(accessToken: string) {
  if (!accessToken) return;
  await callSupabaseAuth<Record<string, unknown>>("/auth/v1/logout?scope=local", {
    method: "POST",
    accessToken,
  });
}

export async function getSupabaseAuthUser(accessToken: string): Promise<SupabaseAuthUser | null> {
  if (!accessToken) return null;

  try {
    return await callSupabaseAuth<SupabaseAuthUser>("/auth/v1/user", {
      method: "GET",
      accessToken,
    });
  } catch {
    return null;
  }
}

export async function ensureUserBootstrap(user: SupabaseAuthUser) {
  if (!user.id) return;

  await supabaseUpsert(
    "user_profiles",
    {
      id: user.id,
      email: user.email || null,
    },
    {
      onConflict: "id",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  await supabaseUpsert(
    "user_plan_subscriptions",
    {
      user_id: user.id,
      plan: "free",
      status: "active",
    },
    {
      onConflict: "user_id",
      prefer: "resolution=ignore-duplicates,return=representation",
    },
  );

  await supabaseUpsert(
    "alert_preferences",
    {
      user_id: user.id,
    },
    {
      onConflict: "user_id",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  await supabaseUpsert(
    "user_delivery_channels",
    {
      user_id: user.id,
      channel: "web",
      enabled: true,
    },
    {
      onConflict: "user_id,channel",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );
}

function getAuthEnv() {
  const env = getServerEnv();
  if (!env.supabaseUrl) {
    throw new AuthError("SUPABASE_URL_MISSING", "SUPABASE_URL is required for authentication.", 500);
  }
  if (!env.supabaseAnonKey) {
    throw new AuthError("SUPABASE_ANON_KEY_MISSING", "SUPABASE_ANON_KEY is required for authentication.", 500);
  }

  return {
    baseUrl: env.supabaseUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, ""),
    anonKey: env.supabaseAnonKey,
  };
}

async function callSupabaseAuth<T>(
  path: string,
  options: {
    method: "GET" | "POST" | "PUT";
    body?: Record<string, unknown>;
    accessToken?: string;
  },
): Promise<T> {
  const env = getAuthEnv();
  const response = await fetch(`${env.baseUrl}${path}`, {
    method: options.method,
    cache: "no-store",
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${options.accessToken || env.anonKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const payload = parseAuthBody(text);

  if (!response.ok) {
    throw new AuthError("SUPABASE_AUTH_FAILED", readAuthError(payload, response.statusText), response.status);
  }

  return payload as T;
}

function parseAuthBody(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function readAuthError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.msg === "string") return record.msg;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error_description === "string") return record.error_description;
    if (typeof record.error === "string") return record.error;
  }

  return fallback || "Authentication failed.";
}
