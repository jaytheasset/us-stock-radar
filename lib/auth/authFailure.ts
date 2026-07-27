const INVALID_SESSION_STATUSES = new Set([400, 401, 403]);

export function shouldClearAuthSessionForStatus(
  status: number | null | undefined,
) {
  return typeof status === "number" && INVALID_SESSION_STATUSES.has(status);
}

export function shouldClearAuthSessionForError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  return shouldClearAuthSessionForStatus(
    typeof status === "number" ? status : null,
  );
}

export type ResolvedAuthSessionState =
  | "authenticated"
  | "invalid"
  | "unavailable";

export function getResolvedAuthSessionState({
  hasUser,
  shouldClearCookies,
}: {
  hasUser: boolean;
  shouldClearCookies: boolean;
}): ResolvedAuthSessionState {
  if (hasUser) return "authenticated";
  return shouldClearCookies ? "invalid" : "unavailable";
}
