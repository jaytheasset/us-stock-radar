import type {
  KlipyMediaAttachment,
  KlipySearchPage,
} from "./types";

const MEDIA_HOST = "static.klipy.com";
const ITEM_HOST = "klipy.com";
const MAX_MEDIA_DIMENSION = 4096;
const MAX_PROVIDER_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 240;
const MAX_URL_LENGTH = 2048;

export class KlipyProviderError extends Error {
  readonly code: string;
  readonly retryAfterSeconds?: number;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "KlipyProviderError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function normalizeKlipySearchInput(input: {
  cursor?: unknown;
  limit?: unknown;
  query?: unknown;
}) {
  const query =
    typeof input.query === "string"
      ? input.query.replace(/\s+/g, " ").trim()
      : "";
  if (query && query.length < 2) {
    throw new KlipyProviderError(
      "KLIPY_QUERY_TOO_SHORT",
      "Enter at least 2 characters to search KLIPY.",
      400,
    );
  }
  if (query.length > 80) {
    throw new KlipyProviderError(
      "KLIPY_QUERY_TOO_LONG",
      "KLIPY searches can be up to 80 characters.",
      400,
    );
  }

  const cursor =
    typeof input.cursor === "string" ? input.cursor.trim() : "";
  if (
    cursor &&
    (cursor.length > 256 || !/^[A-Za-z0-9._~:%=+-]+$/.test(cursor))
  ) {
    throw new KlipyProviderError(
      "KLIPY_INVALID_CURSOR",
      "That KLIPY result page is no longer available.",
      400,
    );
  }

  const requestedLimit =
    input.limit === null || input.limit === undefined || input.limit === ""
      ? Number.NaN
      : Number(input.limit);
  const limit = Number.isInteger(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 18))
    : 15;
  return { cursor: cursor || null, limit, query };
}

export function normalizeKlipyMediaId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (
    !id ||
    id.length > MAX_PROVIDER_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(id)
  ) {
    throw new KlipyProviderError(
      "KLIPY_MEDIA_INVALID",
      "That KLIPY GIF is no longer available.",
      400,
    );
  }
  return id;
}

export function parseKlipyResponse(payload: unknown): KlipySearchPage {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new KlipyProviderError(
      "KLIPY_RESPONSE_INVALID",
      "KLIPY returned an invalid response.",
      502,
    );
  }

  const items = payload.results.flatMap(parseKlipyResult);
  const nextCursor =
    typeof payload.next === "string" &&
    payload.next.length <= 256 &&
    /^[A-Za-z0-9._~:%=+-]*$/.test(payload.next)
      ? payload.next || null
      : null;
  return { items, nextCursor, provider: "klipy" };
}

function parseKlipyResult(value: unknown): KlipyMediaAttachment[] {
  if (!isRecord(value)) return [];
  const providerMediaId =
    typeof value.id === "string" ? value.id.trim() : "";
  if (
    !providerMediaId ||
    providerMediaId.length > MAX_PROVIDER_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(providerMediaId)
  ) {
    return [];
  }

  const formats = isRecord(value.media_formats)
    ? value.media_formats
    : {};
  const display =
    readMediaFormat(formats.mediumgif) ||
    readMediaFormat(formats.gif);
  const preview =
    readMediaFormat(formats.tinygifpreview) ||
    readMediaFormat(formats.gifpreview) ||
    readMediaFormat(formats.tinygif);
  const itemUrl = readSafeUrl(value.itemurl, ITEM_HOST);
  if (!display || !preview || !itemUrl) return [];

  const title = readText(value.title);
  const description = readText(value.content_description);
  const alt = description || title || "KLIPY GIF";
  return [{
    alt,
    aspect: display.width / display.height,
    description,
    displayUrl: display.url,
    height: display.height,
    itemUrl,
    kind: "gif",
    previewUrl: preview.url,
    provider: "klipy",
    providerMediaId,
    title,
    width: display.width,
  }];
}

function readMediaFormat(value: unknown) {
  if (!isRecord(value)) return null;
  const url = readSafeUrl(value.url, MEDIA_HOST);
  const dims = Array.isArray(value.dims) ? value.dims : [];
  const width = Number(dims[0]);
  const height = Number(dims[1]);
  if (
    !url ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_MEDIA_DIMENSION ||
    height > MAX_MEDIA_DIMENSION
  ) {
    return null;
  }
  return { height, url, width };
}

function readSafeUrl(value: unknown, expectedHost: string) {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== expectedHost ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function readText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
