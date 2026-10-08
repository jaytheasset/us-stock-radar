import { decodeSecHtmlEntities } from "./htmlEntities.ts";

/**
 * Canonical visible-text projection shared by live SEC fetches and offline
 * archive imports. This is presentation/analysis text only; the authoritative
 * source remains the exact preserved document body and its SHA-256.
 */
export function cleanSecDocumentText(input: string) {
  const withoutHidden = input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ");

  const withBreaks = withoutHidden
    .replace(/<\/(p|div|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ");

  return decodeSecHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
