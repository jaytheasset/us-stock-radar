import type {
  AccesswireParsedRawItem,
  AccesswireRawFetchResult,
} from "./sources/accesswire/parser.ts";

export function findMatchingAccesswireItem(
  result: AccesswireRawFetchResult | null,
  listing: AccesswireParsedRawItem,
) {
  const items = result?.items || [];
  if (!items.length) return null;

  const sourceUniqueId = stringValue(listing.source_unique_id);
  if (sourceUniqueId) {
    return (
      items.find(
        (item) =>
          stringValue(item.source_unique_id) === sourceUniqueId,
      ) || null
    );
  }

  let hasComparableIdentity = false;
  const listingUrl = normalizeUrl(listing.source_url);
  if (listingUrl) {
    const comparableUrls = items
      .map((item) => ({ item, value: normalizeUrl(item.source_url) }))
      .filter(({ value }) => Boolean(value));
    hasComparableIdentity ||= comparableUrls.length > 0;
    const urlMatch = comparableUrls.find(
      ({ value }) => value === listingUrl,
    );
    if (urlMatch) return urlMatch.item;
  }

  const listingDedupeKey = normalizeDedupeKey(listing.dedupe_key);
  if (listingDedupeKey) {
    const comparableDedupeKeys = items
      .map((item) => ({
        item,
        value: normalizeDedupeKey(item.dedupe_key),
      }))
      .filter(({ value }) => Boolean(value));
    hasComparableIdentity ||= comparableDedupeKeys.length > 0;
    const dedupeMatch = comparableDedupeKeys.find(
      ({ value }) => value === listingDedupeKey,
    );
    if (dedupeMatch) return dedupeMatch.item;
  }

  if (hasComparableIdentity) return null;
  return items.length === 1 ? items[0] : null;
}

function normalizeUrl(value: string | null) {
  const text = stringValue(value);
  if (!text) return "";

  try {
    const url = new URL(text);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().toLowerCase();
  } catch {
    return text.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeDedupeKey(value: string | null) {
  return stringValue(value).toLowerCase();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
