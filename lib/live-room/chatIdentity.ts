export const LIVE_ROOM_CHAT_NAME_MIN_LENGTH = 2;
export const LIVE_ROOM_CHAT_NAME_MAX_LENGTH = 24;

const chatNamePattern = /^[A-Za-z][A-Za-z0-9 _-]{1,23}$/;
const reservedChatNameKeys = new Set([
  "guest",
  "member",
  "admin",
  "administrator",
  "moderator",
  "stockradar",
]);

export type LiveRoomChatNameValidation =
  | { ok: true; value: string }
  | { code: "invalid" | "reserved"; message: string; ok: false };

export function normalizeLiveRoomChatName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function validateLiveRoomChatName(
  value: unknown,
): LiveRoomChatNameValidation {
  const normalized = normalizeLiveRoomChatName(value);
  if (
    normalized.length < LIVE_ROOM_CHAT_NAME_MIN_LENGTH ||
    normalized.length > LIVE_ROOM_CHAT_NAME_MAX_LENGTH ||
    !chatNamePattern.test(normalized)
  ) {
    return {
      code: "invalid",
      message:
        "Use 2–24 characters, start with a letter, and use only letters, numbers, spaces, _ or -.",
      ok: false,
    };
  }

  const reservedKey = normalized.toLowerCase().replace(/[ _-]+/g, "");
  if (reservedChatNameKeys.has(reservedKey)) {
    return {
      code: "reserved",
      message: "Choose a different chat name.",
      ok: false,
    };
  }

  return { ok: true, value: normalized };
}

export function isLiveRoomChatNameSet(value: unknown) {
  return validateLiveRoomChatName(value).ok;
}

export function formatPublicChatName(value: unknown) {
  const normalized = normalizeLiveRoomChatName(value);
  if (normalized.toLowerCase() === "guest") return "Guest";
  if (/^[a-z0-9]{2}$/.test(normalized)) return normalized;
  const validation = validateLiveRoomChatName(normalized);
  return validation.ok ? validation.value : "Name unavailable";
}

export function getLiveRoomChatNameInitials(value: unknown) {
  const normalized = normalizeLiveRoomChatName(value);
  const publicName =
    /^[A-Za-z0-9]$/.test(normalized)
      ? normalized
      : formatPublicChatName(normalized);
  if (publicName === "Name unavailable") return "?";
  const characters = publicName.match(/[A-Za-z0-9]/g)?.slice(0, 2) ?? [];
  return characters.length ? characters.join("").toUpperCase() : "?";
}
