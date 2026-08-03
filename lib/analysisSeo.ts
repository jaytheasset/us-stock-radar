import type { Metadata } from "next";
import {
  DEFAULT_SHARE_IMAGE_PATH,
  SITE_NAME,
  SITE_ORIGIN,
} from "./seo.ts";

export type AnalysisSeoDocument = {
  analysisMetadata?: unknown;
  brief?: string | null;
  fixture?: boolean;
  hasStoredAnalysis: boolean;
  id: string;
  kind: "news" | "filing";
  metadata?: unknown;
  modifiedAt?: string | null;
  publishedAt?: string | null;
  sourceCode?: string | null;
  sourceName?: string | null;
  summary?: string | null;
  ticker?: string | null;
  title?: string | null;
};

const invalidTickerValues = new Set([
  "N/A",
  "NA",
  "NONE",
  "NULL",
  "QA",
  "TEST",
  "TICKER",
  "UNKNOWN",
]);

const placeholderTitles = new Set([
  "archived sec filing",
  "filing analysis",
  "untitled event",
]);

const placeholderDescriptions = new Set([
  "no summary available yet.",
  "this item was archived as a lower-impact market update.",
  "this sec filing was archived as a lower-impact disclosure.",
]);

export function buildAnalysisMetadata(
  document: AnalysisSeoDocument,
  canonicalPath: string,
): Metadata {
  const fallbackTitle = document.kind === "news" ? "News Analysis" : "Filing Analysis";
  const title = buildSeoTitle(document.title) || fallbackTitle;
  const description = buildSeoDescription(document.brief, document.summary);
  const canonical = new URL(canonicalPath, SITE_ORIGIN).toString();
  const publishedTime = validIsoTimestamp(document.publishedAt);
  const modifiedTime = latestIsoTimestamp(document.modifiedAt, publishedTime);
  const indexable = isIndexableAnalysisDocument(document);

  return {
    alternates: { canonical },
    description: description || undefined,
    openGraph: {
      type: "article",
      locale: "en_US",
      siteName: SITE_NAME,
      title,
      description: description || undefined,
      url: canonical,
      publishedTime: publishedTime || undefined,
      modifiedTime: modifiedTime || undefined,
      images: [
        {
          alt: `${title} — ${SITE_NAME}`,
          height: 630,
          url: DEFAULT_SHARE_IMAGE_PATH,
          width: 1200,
        },
      ],
    },
    robots: indexable
      ? { follow: true, index: true }
      : {
          follow: false,
          index: false,
          nocache: true,
          googleBot: {
            follow: false,
            index: false,
            noimageindex: true,
          },
        },
    title,
    twitter: {
      card: "summary_large_image",
      title,
      description: description || undefined,
      images: [DEFAULT_SHARE_IMAGE_PATH],
    },
  };
}

export function isIndexableAnalysisDocument(document: AnalysisSeoDocument) {
  const title = cleanSeoText(document.title, 500).toLowerCase();
  const description = buildSeoDescription(document.brief, document.summary, 500).toLowerCase();

  return Boolean(
    !document.fixture &&
      document.hasStoredAnalysis &&
      isPersistentAnalysisId(document.id) &&
      isSearchableTicker(document.ticker) &&
      title &&
      !placeholderTitles.has(title) &&
      description &&
      !placeholderDescriptions.has(description) &&
      validIsoTimestamp(document.publishedAt) &&
      !isTestLikeDocument(document) &&
      !isHiddenDocument(document.metadata) &&
      !isHiddenDocument(document.analysisMetadata),
  );
}

export function isSearchableTicker(value: unknown) {
  if (typeof value !== "string") return false;
  const ticker = value.trim().toUpperCase();
  return (
    /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) &&
    !invalidTickerValues.has(ticker)
  );
}

export function hasMeaningfulAnalysisPayload(value: unknown) {
  const analysis = asRecord(value);
  if (!analysis) return false;
  return Boolean(
    firstText(analysis.analysis_scope, analysis.why_it_matters) ||
    hasValues(analysis.bullish_points) ||
    hasValues(analysis.bearish_points) ||
    hasValues(analysis.key_evidence) ||
    hasValues(analysis.watch_next)
  );
}

export function buildSeoDescription(
  brief: unknown,
  summary: unknown,
  maxLength = 160,
) {
  return cleanSeoText(firstText(brief, summary), maxLength);
}

export function buildSeoTitle(value: unknown) {
  const withoutBrand = cleanSeoText(value, 500)
    .replace(/\s*(?:[|·—-]\s*)?stock radar\s*$/i, "")
    .trim();
  return cleanSeoText(withoutBrand, 110);
}

export function cleanSeoText(value: unknown, maxLength = 160) {
  if (typeof value !== "string") return "";
  const normalized = decodeBasicHtmlEntities(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  const clipped = normalized.slice(0, Math.max(1, maxLength - 1));
  const wordBoundary = clipped.lastIndexOf(" ");
  const prefix = wordBoundary >= Math.floor(maxLength * 0.65)
    ? clipped.slice(0, wordBoundary)
    : clipped;
  return `${prefix.trimEnd()}…`;
}

export function latestIsoTimestamp(...values: unknown[]) {
  let latest: Date | null = null;
  for (const value of values) {
    const iso = validIsoTimestamp(value);
    if (!iso) continue;
    const date = new Date(iso);
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest?.toISOString() || "";
}

export function validIsoTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function isPersistentAnalysisId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function isTestLikeDocument(document: AnalysisSeoDocument) {
  const sourceCode = cleanSeoText(document.sourceCode, 120).toLowerCase();
  const sourceName = cleanSeoText(document.sourceName, 120).toLowerCase();
  const title = cleanSeoText(document.title, 240).toLowerCase();

  return Boolean(
    /^(?:fixture|qa|test)(?:$|[_-])/.test(sourceCode) ||
      /^(?:fixture|qa|test)(?:$|\s)/.test(sourceName) ||
      /^(?:\[(?:fixture|qa|test)\]|(?:fixture|qa|test)\s*:)/.test(title) ||
      /\b(?:complete|development|ui) fixture\b/.test(title) ||
      metadataBoolean(document.metadata, ["fixture", "is_fixture", "qa", "is_qa", "test", "is_test"]) ||
      metadataBoolean(document.analysisMetadata, ["fixture", "is_fixture", "qa", "is_qa", "test", "is_test"]),
  );
}

function isHiddenDocument(value: unknown) {
  const metadata = asRecord(value);
  if (!metadata) return false;
  if (metadataBoolean(metadata, ["deleted", "is_deleted", "private", "is_private", "hidden", "is_hidden"])) {
    return true;
  }
  if (metadata.is_public === false || metadata.published === false) return true;
  if (firstText(metadata.deleted_at, metadata.deletedAt)) return true;

  const state = firstText(
    metadata.visibility,
    metadata.visibility_status,
    metadata.status,
    metadata.publication_status,
  ).toLowerCase();
  return ["deleted", "draft", "hidden", "private", "qa", "test", "unpublished"].includes(state);
}

function metadataBoolean(value: unknown, keys: string[]) {
  const metadata = asRecord(value);
  return keys.some((key) => metadata?.[key] === true);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function decodeBasicHtmlEntities(value: string) {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&apos;": "'",
    "&#39;": "'",
    "&gt;": ">",
    "&lt;": "<",
    "&nbsp;": " ",
    "&quot;": '"',
  };
  return value.replace(/&(amp|apos|#39|gt|lt|nbsp|quot);/gi, (entity) =>
    entities[entity.toLowerCase()] || entity,
  );
}

function hasValues(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}
