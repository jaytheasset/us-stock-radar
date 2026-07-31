export const LIVE_ROOM_PROFILE_BIO_MAX_LENGTH = 280;
export const LIVE_ROOM_PROFILE_BIO_MAX_LINES = 4;

export class LiveRoomProfileBioValidationError extends Error {
  constructor() {
    super("About must be plain text with up to 280 characters and 4 lines.");
    this.name = "LiveRoomProfileBioValidationError";
  }
}

export function normalizeLiveRoomProfileBio(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw invalidBio();
  }

  const normalized = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();

  if (!normalized) return null;
  if (
    Array.from(normalized).length > LIVE_ROOM_PROFILE_BIO_MAX_LENGTH ||
    normalized.split("\n").length > LIVE_ROOM_PROFILE_BIO_MAX_LINES ||
    /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(normalized) ||
    /[<>]/u.test(normalized)
  ) {
    throw invalidBio();
  }

  return normalized;
}

function invalidBio() {
  return new LiveRoomProfileBioValidationError();
}
