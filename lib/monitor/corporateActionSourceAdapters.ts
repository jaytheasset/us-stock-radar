import {
  CORPORATE_ACTION_ANALYZER_INPUT_VERSION,
  type CorporateActionAnalyzerInput,
  type CorporateActionSourceDocument,
  type CorporateActionSourceFamily,
  validateCorporateActionAnalyzerInput,
} from "./corporateActionCanonicalFacts.ts";

export function adaptNasdaqCorporateActionSource(input: {
  source_unique_id: string | null;
  source_url: string | null;
  published_at: string | null;
  title: string | null;
  body_text: string;
}): CorporateActionAnalyzerInput {
  return buildInput({
    sourceFamily: "nasdaq",
    sourceId: input.source_unique_id,
    sourceUrl: input.source_url,
    publishedAt: input.published_at,
    title: input.title,
    documents: [{ source_ref: "nasdaq_notice_body", label: "Stored Nasdaq official notice", text: input.body_text }],
  });
}

export function adaptNewsCorporateActionSource(input: {
  source_unique_id: string | null;
  source_url: string | null;
  published_at: string | null;
  title: string | null;
  body_text: string;
}): CorporateActionAnalyzerInput {
  return buildInput({
    sourceFamily: "news",
    sourceId: input.source_unique_id,
    sourceUrl: input.source_url,
    publishedAt: input.published_at,
    title: input.title,
    documents: [{ source_ref: "news_article_body", label: "Stored hydrated news article", text: input.body_text }],
  });
}

export function adaptSec8k6kCorporateActionSource(input: {
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
}): CorporateActionAnalyzerInput {
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
  });
}

function buildInput(input: {
  sourceFamily: CorporateActionSourceFamily;
  sourceId: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  title: string | null;
  documents: CorporateActionSourceDocument[];
}) {
  const result: CorporateActionAnalyzerInput = {
    version: CORPORATE_ACTION_ANALYZER_INPUT_VERSION,
    source_family: input.sourceFamily,
    source_id: cleanText(input.sourceId),
    source_url: cleanNullableText(input.sourceUrl),
    published_at: cleanNullableText(input.publishedAt),
    title: cleanNullableText(input.title),
    source_documents: input.documents.map((document) => ({
      source_ref: document.source_ref.trim(),
      label: cleanNullableText(document.label),
      text: document.text.trim(),
    })),
  };
  const errors = validateCorporateActionAnalyzerInput(result);
  if (errors.length) throw new Error(`Invalid Corporate Action analyzer input: ${errors.join("; ")}`);
  return result;
}

function cleanText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanNullableText(value: string | null | undefined) {
  const text = cleanText(value);
  return text || null;
}
