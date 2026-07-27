import { createHash, randomBytes } from "node:crypto";

export const LIVE_ROOM_GUEST_COOKIE = "sr_live_room_guest";
export const LIVE_ROOM_GUEST_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const tokenBytes = 32;

export function createLiveRoomGuestToken() {
  return randomBytes(tokenBytes).toString("base64url");
}

export function isValidLiveRoomGuestToken(value: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function hashLiveRoomGuestToken(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
