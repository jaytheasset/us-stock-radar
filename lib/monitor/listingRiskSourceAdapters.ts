import {
  LISTING_RISK_ANALYZER_INPUT_VERSION,
  type ListingRiskAnalyzerInput,
  type ListingRiskPrimaryContext,
  type ListingRiskSourceDocument,
  validateListingRiskAnalyzerInput,
} from "./listingRiskAnalyzer.ts";

type GenericPrimaryContext = Record<string, unknown> | null | undefined;

export function adaptNewsListingRiskSource(input: {
  source_unique_id: string | null;
  source_url: string | null;
  published_at: string | null;
  title: string | null;
  body_text: string;
  primary_analysis?: GenericPrimaryContext;
}): ListingRiskAnalyzerInput {
  return buildInput({
    sourceFamily: "news",
    sourceId: input.source_unique_id,
    sourceUrl: input.source_url,
    publishedAt: input.published_at,
    title: input.title,
    documents: [{ source_ref: "news_article_body", label: "Stored hydrated news article", text: input.body_text }],
    primaryAnalysis: input.primary_analysis,
  });
}

export function adaptNasdaqListingRiskSource(input: {
  source_unique_id: string | null;
  source_url: string | null;
  published_at: string | null;
  title: string | null;
  body_text: string;
  primary_analysis?: GenericPrimaryContext;
}): ListingRiskAnalyzerInput {
  return buildInput({
    sourceFamily: "nasdaq",
    sourceId: input.source_unique_id,
    sourceUrl: input.source_url,
    publishedAt: input.published_at,
    title: input.title,
    documents: [{ source_ref: "nasdaq_notice_body", label: "Stored Nasdaq notice", text: input.body_text }],
    primaryAnalysis: input.primary_analysis,
  });
}

export function adaptSec8k6kListingRiskSource(input: {
  accession_number: string | null;
  source_url: string | null;
  filed_at: string | null;
  title: string | null;
  cleaned_source_blocks: Array<{
    block_id: string;
    source_ref?: string | null;
    label?: string | null;
    document_reference?: string | null;
    text: string;
  }>;
  primary_analysis?: GenericPrimaryContext;
}): ListingRiskAnalyzerInput {
  return buildInput({
    sourceFamily: "sec",
    sourceId: input.accession_number,
    sourceUrl: input.source_url,
    publishedAt: input.filed_at,
    title: input.title,
    documents: input.cleaned_source_blocks.map((block) => ({
      source_ref: block.block_id,
      label: block.document_reference || block.source_ref || block.label || null,
      text: block.text,
    })),
    primaryAnalysis: input.primary_analysis,
  });
}

function buildInput({
  sourceFamily,
  sourceId,
  sourceUrl,
  publishedAt,
  title,
  documents,
  primaryAnalysis,
}: {
  sourceFamily: ListingRiskAnalyzerInput["source_family"];
  sourceId: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  title: string | null;
  documents: ListingRiskSourceDocument[];
  primaryAnalysis: GenericPrimaryContext;
}) {
  const result: ListingRiskAnalyzerInput = {
    version: LISTING_RISK_ANALYZER_INPUT_VERSION,
    source_family: sourceFamily,
    source_id: cleanNullableText(sourceId),
    source_url: cleanNullableText(sourceUrl),
    published_at: cleanNullableText(publishedAt),
    title: cleanNullableText(title),
    source_documents: documents.map((document) => ({
      source_ref: document.source_ref.trim(),
      label: cleanNullableText(document.label),
      text: document.text.trim(),
    })),
    primary_context: readPrimaryContext(primaryAnalysis),
  };
  const errors = validateListingRiskAnalyzerInput(result);
  if (errors.length) throw new Error(`Invalid Listing Risk analyzer input: ${errors.join("; ")}`);
  return result;
}

function readPrimaryContext(value: GenericPrimaryContext): ListingRiskPrimaryContext | null {
  if (!value) return null;
  const context: ListingRiskPrimaryContext = {};
  if (typeof value.event_type === "string") context.event_type = value.event_type;
  if (typeof value.summary === "string") context.summary = value.summary;
  if (Array.isArray(value.monitor_routes)) context.monitor_routes = value.monitor_routes;
  return Object.keys(context).length ? context : null;
}

function cleanNullableText(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
