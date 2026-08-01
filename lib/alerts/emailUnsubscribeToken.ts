import { createHmac, timingSafeEqual } from "crypto";

const TOKEN_VERSION = "v1";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createEmailUnsubscribeToken(userId: string, secret: string, now = Date.now()) {
  if (!userId || !secret) throw new Error("Email unsubscribe is not configured.");
  const expiresAt = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${TOKEN_VERSION}.${userId}.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyEmailUnsubscribeToken(token: string, secret: string, now = Date.now()) {
  const [version, userId, expiresRaw, signature, extra] = token.split(".");
  if (extra || version !== TOKEN_VERSION || !isUuid(userId) || !/^\d{10}$/.test(expiresRaw) || !signature || !secret) return null;
  const payload = `${version}.${userId}.${expiresRaw}`;
  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(now / 1000)) return null;
  return { userId, expiresAt };
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`stock-radar:email-unsubscribe:${payload}`).digest("base64url");
}
function isUuid(value: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
