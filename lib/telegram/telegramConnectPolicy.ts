export const TELEGRAM_DESTINATION_CONFLICT_CODE = "TELEGRAM_DESTINATION_ALREADY_CONNECTED";
export const TELEGRAM_DESTINATION_CONFLICT_MESSAGE =
  "This Telegram account is already connected to another Stock Radar account.";

export function normalizeTelegramDestination(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTelegramUsername(value: unknown) {
  if (typeof value !== "string") return null;
  const username = value.trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,32}$/.test(username) ? `@${username}` : null;
}

export function parseTelegramStartToken(value: unknown) {
  if (typeof value !== "string") return "";
  const match = value.trim().match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{16,80})\s*$/);
  return match?.[1] || "";
}

export function classifyTelegramConnectToken(input: {
  expiresAt: unknown;
  usedAt: unknown;
  now?: number;
}) {
  if (typeof input.usedAt === "string" && input.usedAt.trim()) return "used" as const;
  if (typeof input.expiresAt !== "string" || !input.expiresAt.trim()) return "invalid" as const;
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAt)) return "invalid" as const;
  return expiresAt <= (input.now ?? Date.now()) ? ("expired" as const) : ("valid" as const);
}

export function isPrivateTelegramChat(input: {
  chatId: unknown;
  chatType: unknown;
  senderId: unknown;
  senderIsBot: unknown;
}) {
  const chatId = normalizeTelegramDestination(input.chatId);
  const senderId = normalizeTelegramDestination(input.senderId);
  return (
    input.chatType === "private" &&
    input.senderIsBot !== true &&
    Boolean(chatId) &&
    chatId === senderId
  );
}

export function isTelegramDestinationUniqueConflict(input: {
  status?: number;
  error?: string;
}) {
  const error = input.error || "";
  return (
    input.status === 409 ||
    /user_delivery_channels_telegram_destination_uidx|duplicate key value violates unique constraint/i.test(error)
  );
}
