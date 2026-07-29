import { createHmac, timingSafeEqual } from "node:crypto";

export function canonicalizeSnapTradePayload(value: unknown): string {
  return JSON.stringify(sortCanonicalValue(value));
}

export function verifySnapTradeSignature(input: {
  consumerKey: string;
  payload: unknown;
  signature: string;
}) {
  const expected = createHmac("sha256", input.consumerKey)
    .update(canonicalizeSnapTradePayload(input.payload))
    .digest();
  const normalized = input.signature.trim();
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) ||
    normalized.length % 4 !== 0
  ) {
    return false;
  }
  const provided = Buffer.from(normalized, "base64");
  return (
    expected.length === provided.length &&
    timingSafeEqual(expected, provided)
  );
}

export function verifySnapTradeWebhookPayload(input: {
  body: string;
  consumerKey: string;
  now?: Date;
  signature: string;
}) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const payload = parsed as Record<string, unknown>;
  if (!verifySnapTradeSignature({
    consumerKey: input.consumerKey,
    payload,
    signature: input.signature,
  })) return null;
  const eventTimestamp =
    typeof payload.eventTimestamp === "string"
      ? payload.eventTimestamp.trim()
      : "";
  const timestamp = Date.parse(eventTimestamp);
  const now = (input.now || new Date()).getTime();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300_000) {
    return null;
  }
  return { eventTimestamp: new Date(timestamp).toISOString(), payload };
}

function sortCanonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortCanonicalValue(child)]),
    );
  }
  return value;
}
