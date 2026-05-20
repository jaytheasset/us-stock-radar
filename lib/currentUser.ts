import "server-only";

export const DEVELOPMENT_USER_ID = "00000000-0000-4000-8000-000000000001";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getCurrentUserId() {
  const configuredUserId = process.env.DEV_USER_ID?.trim();

  if (configuredUserId && isUuid(configuredUserId)) {
    return configuredUserId;
  }

  // Development fallback only. Replace this helper with Supabase Auth session lookup later.
  return DEVELOPMENT_USER_ID;
}
