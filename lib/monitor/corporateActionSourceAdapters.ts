import {
  CORPORATE_ACTION_ANALYZER_INPUT_VERSION,
  type CorporateActionAnalyzerInput,
  type CorporateActionIssuerContext,
  type ReverseSplitActionCandidate,
  type CorporateActionSecurityClassCandidate,
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
  issuer_context?: CorporateActionIssuerContext;
  security_class_candidates?: CorporateActionSecurityClassCandidate[];
  origin_event_id?: string;
  reverse_split_action_candidates?: ReverseSplitActionCandidate[];
}): CorporateActionAnalyzerInput {
  return buildInput({
    sourceFamily: "sec",
    sourceId: input.accession_number,
    sourceUrl: input.source_url,
    publishedAt: input.filed_at,
    title: input.title,
    issuerContext: input.issuer_context,
    securityClassCandidates: input.security_class_candidates,
    originEventId: input.origin_event_id,
    actionCandidates: input.reverse_split_action_candidates,
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
  issuerContext?: CorporateActionIssuerContext;
  securityClassCandidates?: CorporateActionSecurityClassCandidate[];
  originEventId?: string;
  actionCandidates?: ReverseSplitActionCandidate[];
}) {
  const issuerContext = input.issuerContext ?? (input.sourceFamily === "sec"
    ? { availability: "unavailable" as const, reason: "filing_ledger_identity_unavailable" as const }
    : { availability: "unavailable" as const, reason: "non_sec_source" as const });
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
    issuer_context: issuerContext,
    security_class_candidates: input.securityClassCandidates?.map((candidate) => ({
      ...candidate,
      supporting_accessions: [...candidate.supporting_accessions],
    })) ?? [],
    ...(input.originEventId ? { origin_event_id: input.originEventId } : {}),
    ...(input.actionCandidates ? {
      reverse_split_action_candidates: input.actionCandidates.map((candidate) => ({
        ...candidate,
        known_ratio: { ...candidate.known_ratio },
        known_effective_date: { ...candidate.known_effective_date },
        prior_observations: candidate.prior_observations.map((observation) => ({
          ...observation,
          ratio: { ...observation.ratio },
          effective_date: { ...observation.effective_date },
        })),
      })),
    } : {}),
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
