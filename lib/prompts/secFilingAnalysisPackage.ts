import { parseSecS3Filing, type SecS3FilingFacts } from "@/lib/sources/sec/forms/s3-f3/parser";

export const SEC_FILING_PACKAGE_VERSION = "sec_filing_package_v1";

export type SecFilingPackageOptions = {
  maxChars?: number;
  maxDocumentChars?: number;
};

type RawItemRow = {
  id?: unknown;
  source_code?: unknown;
  source_group?: unknown;
  source_unique_id?: unknown;
  source_url?: unknown;
  title?: unknown;
  published_at?: unknown;
  body_text?: unknown;
  analysis_text?: unknown;
  raw_payload?: unknown;
  metadata?: unknown;
};

type DocumentPayload = {
  type?: unknown;
  description?: unknown;
  url?: unknown;
  isPrimary?: unknown;
  textCharCount?: unknown;
  textTruncated?: unknown;
  fetchStatus?: unknown;
  fetchError?: unknown;
};

type AttachmentTextPayload = {
  type?: unknown;
  description?: unknown;
  url?: unknown;
  text?: unknown;
};

export function buildSecFilingAnalysisPackage(rawItem: RawItemRow, options: SecFilingPackageOptions = {}) {
  const rawPayload = toRecord(rawItem.raw_payload) || {};
  const metadata = toRecord(rawItem.metadata) || {};
  const documents = recordArray(rawPayload.documents) as DocumentPayload[];
  const attachmentTexts = recordArray(rawPayload.attachment_texts) as AttachmentTextPayload[];
  const bodyText = stringValue(rawItem.analysis_text) || stringValue(rawItem.body_text);
  const maxChars = clampInt(options.maxChars ?? 60_000, 10_000, 180_000);
  const maxDocumentChars = clampInt(options.maxDocumentChars ?? 24_000, 4_000, 80_000);

  const primaryDocumentUrl =
    nullableString(rawPayload.primary_document_url) ||
    nullableString(metadata.primary_document_url) ||
    documents.find((document) => Boolean(document.isPrimary))?.url ||
    null;
  const formType = nullableString(rawPayload.form_type) || nullableString(metadata.form_type);
  const hardParserBundle = buildHardParserFacts(rawItem, formType);
  const hardParsers = hardParserBundle.hardParsers;
  const packageDocuments = documents.map((document) => ({
    type: nullableString(document.type),
    description: nullableString(document.description),
    url: nullableString(document.url),
    is_primary: Boolean(document.isPrimary),
    text_char_count: numberValue(document.textCharCount),
    text_truncated: Boolean(document.textTruncated),
    fetch_status: numberValue(document.fetchStatus) || null,
    fetch_error: nullableString(document.fetchError),
  }));

  const sections = buildTextSections({
    bodyText,
    attachmentTexts,
    maxChars,
    maxDocumentChars,
  });
  const llmText = sections.map((section) => `### ${section.label}\n${section.text}`).join("\n\n").trim();
  const routerEvidence = buildRouterEvidence({
    documents: packageDocuments,
    llmText,
    sourceText: bodyText,
    s3Parsed: hardParserBundle.s3Parsed,
  });

  return {
    package_version: SEC_FILING_PACKAGE_VERSION,
    source_group: "filings",
    source_code: "sec_edgar",
    raw_item_id: nullableString(rawItem.id),
    source_unique_id: nullableString(rawItem.source_unique_id),
    accession_number: nullableString(rawPayload.accession_number) || nullableString(rawItem.source_unique_id),
    cik: nullableString(rawPayload.cik) || nullableString(metadata.cik),
    company_name: nullableString(rawPayload.company_name) || nullableString(metadata.company_name),
    primary_ticker: {
      ticker: nullableString(rawPayload.ticker) || nullableString(metadata.ticker),
      exchange: nullableString(rawPayload.exchange) || nullableString(metadata.exchange),
    },
    tickers: Array.isArray(rawPayload.tickers) ? rawPayload.tickers : [],
    form_type: formType,
    form_family: classifySecFormFamily(formType),
    hard_parsers: hardParsers,
    filed_at: nullableString(rawItem.published_at),
    title: nullableString(rawItem.title),
    filing_detail_url: nullableString(rawItem.source_url),
    primary_document_url: nullableString(primaryDocumentUrl),
    documents: packageDocuments,
    router_evidence: routerEvidence,
    llm_text: llmText,
    package_stats: {
      max_chars: maxChars,
      max_document_chars: maxDocumentChars,
      source_body_chars: bodyText.length,
      included_chars: llmText.length,
      truncated: bodyText.length > maxDocumentChars || sections.some((section) => section.truncated),
      document_count: documents.length,
      attachment_text_count: attachmentTexts.length,
      included_sections: sections.map((section) => ({
        label: section.label,
        chars: section.text.length,
        truncated: section.truncated,
      })),
    },
  };
}

export function classifySecFormFamily(formType: string | null) {
  const form = stringValue(formType).toUpperCase();
  if (!form) return "unknown";
  if (form === "8-K" || form === "8-K/A") return "current_report";
  if (form === "6-K" || form === "6-K/A") return "foreign_current_report";
  if (form.startsWith("10-Q") || form.startsWith("10-K") || form.startsWith("20-F")) return "periodic_report";
  if (form.startsWith("S-") || form.startsWith("F-") || form.startsWith("424B")) return "registration_offering";
  if (form.includes("14A") || form.startsWith("SC 14")) return "proxy_shareholder";
  if (form === "4" || form === "4/A" || form === "3" || form === "5") return "ownership";
  if (form.startsWith("SC 13")) return "ownership";
  if (form.startsWith("SC TO") || form === "CB" || form === "CB/A") return "tender_offer";
  return "other";
}

function buildHardParserFacts(
  rawItem: RawItemRow,
  formType: string | null,
): { hardParsers: Record<string, unknown>; s3Parsed: SecS3FilingFacts | null } {
  if (/^S-3(?:ASR|\/A)?$/i.test(stringValue(formType))) {
    const parsed = parseSecS3Filing({
      rawItemId: nullableString(rawItem.id),
      sourceUniqueId: nullableString(rawItem.source_unique_id),
      sourceUrl: nullableString(rawItem.source_url),
      title: nullableString(rawItem.title),
      publishedAt: nullableString(rawItem.published_at),
      bodyText: nullableString(rawItem.body_text),
      analysisText: nullableString(rawItem.analysis_text),
      rawPayload: rawItem.raw_payload,
      metadata: rawItem.metadata,
    });

    return {
      hardParsers: {
        s3: {
          parser_version: parsed.parser_version,
          form_type: parsed.form_type,
          is_s3_family: parsed.is_s3_family,
          registration_statement_kind: parsed.registration_statement_kind?.value || null,
          registration_status: parsed.registration_status?.value || null,
          prospectus_status: parsed.prospectus_status?.value || null,
          primary_or_resale: parsed.primary_or_resale?.value || null,
          securities_registered: parsed.securities_registered.map((item) => item.value),
          shares_registered: parsed.shares_registered?.text || null,
          resale_share_count: parsed.resale_share_count?.text || null,
          current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
          selling_stockholders: {
            count: parsed.selling_stockholders.length,
            rows: parsed.selling_stockholders.map((holder) => ({
              holder_name: holder.holder_name,
              shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
              beneficially_owned_before: holder.beneficially_owned_before?.text || null,
              beneficially_owned_after: holder.beneficially_owned_after?.text || null,
              percent_after: holder.percent_after?.text || null,
            })),
          },
          fee_table: {
            present: parsed.fee_table.present,
            text_available: parsed.fee_table.text_available,
            row_count: parsed.fee_table.rows.length,
            total_offering_amount: parsed.fee_table.totals.total_offering_amount?.text || null,
            net_fee_due: parsed.fee_table.totals.net_fee_due?.text || null,
          },
          offering_terms: {
            registration_statement_kind: parsed.offering_terms.registration_statement_kind?.value || null,
            offering_type: parsed.offering_terms.offering_type?.value || null,
            security_type: parsed.offering_terms.security_type?.value || null,
            primary_or_resale: parsed.offering_terms.primary_or_resale?.value || null,
            offering_amount: parsed.offering_terms.offering_amount?.text || null,
            shelf_capacity: parsed.offering_terms.shelf_capacity?.text || null,
            atm_program_size: parsed.offering_terms.atm_program_size?.text || null,
            resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
            current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
            warrant_coverage: parsed.offering_terms.warrant_coverage?.value || null,
            conversion_price: parsed.offering_terms.conversion_price?.text || null,
          },
          amendment: parsed.amendment.router_payload,
          needs_human_review: parsed.needs_human_review,
          review_reasons: parsed.review_reasons,
        },
      },
      s3Parsed: parsed,
    };
  }

  return { hardParsers: {}, s3Parsed: null };
}

function buildRouterEvidence({
  documents,
  llmText,
  sourceText,
  s3Parsed,
}: {
  documents: Array<Record<string, unknown>>;
  llmText: string;
  sourceText: string;
  s3Parsed: SecS3FilingFacts | null;
}) {
  if (!s3Parsed) return {};
  return {
    s3: buildS3RouterEvidence({
      documents,
      llmText,
      sourceText,
      parsed: s3Parsed,
    }),
  };
}

function buildS3RouterEvidence({
  documents,
  llmText,
  sourceText,
  parsed,
}: {
  documents: Array<Record<string, unknown>>;
  llmText: string;
  sourceText: string;
  parsed: SecS3FilingFacts;
}) {
  const importantSections = [
    makeEvidenceSection("prospectus_cover", extractProspectusCoverText(llmText)),
    makeEvidenceSection("prospectus_summary", extractNamedSection(llmText, /prospectus\s+summary/i, 2_600)),
    makeEvidenceSection("the_offering", extractNamedSection(llmText, /the\s+offering/i, 2_400)),
    makeEvidenceSection(
      "selling_stockholders",
      extractNamedSection(llmText, /selling\s+(?:stockholders?|shareholders?)/i, 4_000) ||
        parsed.selling_stockholders_section?.value ||
        "",
    ),
    makeEvidenceSection("plan_of_distribution", extractNamedSection(llmText, /plan\s+of\s+distribution/i, 3_000) || parsed.plan_of_distribution_section?.value || ""),
    makeEvidenceSection("use_of_proceeds", extractNamedSection(llmText, /use\s+of\s+proceeds/i, 2_000) || parsed.use_of_proceeds_section?.value || ""),
    makeEvidenceSection("dilution", extractNamedSection(llmText, /dilution/i, 2_000) || parsed.dilution_reference?.evidence || ""),
    makeEvidenceSection("amendment", parsed.amendment.amendment_excerpt || ""),
  ].filter((section): section is { section: string; text: string } => Boolean(section));

  const feeTableRows = parsed.fee_table.rows.slice(0, 12).map((row) => ({
    registration_category: row.registration_category,
    fee_payment_type: row.fee_payment_type,
    security_type: row.security_type,
    security_class_title: row.security_class_title,
    amount_registered: row.amount_registered?.text || null,
    maximum_aggregate_offering_price: row.maximum_aggregate_offering_price?.text || null,
    proposed_maximum_offering_price_per_unit: row.proposed_maximum_offering_price_per_unit?.text || null,
    registration_fee: row.registration_fee?.text || null,
    evidence: row.evidence,
  }));

  const sellingStockholderRows = parsed.selling_stockholders.slice(0, 20).map((holder) => ({
    holder_name: holder.holder_name,
    shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
    beneficially_owned_before: holder.beneficially_owned_before?.text || null,
    beneficially_owned_after: holder.beneficially_owned_after?.text || null,
    percent_after: holder.percent_after?.text || null,
    beneficial_ownership_caps: holder.beneficial_ownership_caps.map((cap) => cap.text),
    source_components: holder.source_components.slice(0, 4).map((component) => component.text),
    excluded_shares: holder.excluded_shares.slice(0, 4).map((component) => component.text),
    footnote_excerpt: holder.footnote_excerpt,
  }));
  const componentCandidates = buildS3ComponentCandidates(`${llmText}\n\n${sourceText}`, parsed);

  return {
    evidence_version: "s3_router_evidence_v1",
    form_type: parsed.form_type,
    accession_number: parsed.accession_number,
    document_fetch: {
      document_count: documents.length,
      fetched_document_count: documents.filter((document) => numberValue(document.text_char_count) > 0).length,
      fee_table_document_count: parsed.fee_table.documents.length,
      fee_table_text_available: parsed.fee_table.text_available,
      fee_table_documents: parsed.fee_table.documents.map((document) => ({
        type: document.type,
        description: document.description,
        text_char_count: document.text_char_count,
        fetch_status: document.fetch_status,
        fetch_error: document.fetch_error,
      })),
    },
    core_terms: {
      registration_statement_kind: parsed.registration_statement_kind?.value || null,
      registration_status: parsed.registration_status?.value || null,
      prospectus_status: parsed.prospectus_status?.value || null,
      primary_or_resale: parsed.primary_or_resale?.value || null,
      securities_registered: parsed.securities_registered.map((item) => item.value),
      shares_registered: parsed.shares_registered?.text || null,
      resale_share_count: parsed.resale_share_count?.text || null,
      current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
      offering_terms: {
        offering_type: parsed.offering_terms.offering_type?.value || null,
        security_type: parsed.offering_terms.security_type?.value || null,
        offering_amount: parsed.offering_terms.offering_amount?.text || null,
        shelf_capacity: parsed.offering_terms.shelf_capacity?.text || null,
        atm_program_size: parsed.offering_terms.atm_program_size?.text || null,
        resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
        current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
        warrant_coverage: parsed.offering_terms.warrant_coverage?.value || null,
        conversion_price: parsed.offering_terms.conversion_price?.text || null,
      },
    },
    amendment: parsed.amendment.router_payload,
    important_sections: importantSections,
    important_tables: {
      fee_table_rows: feeTableRows,
      selling_stockholders: sellingStockholderRows,
    },
    component_candidates: componentCandidates,
    source_documents: documents.slice(0, 30).map((document) => ({
      type: nullableString(document.type),
      description: nullableString(document.description),
      is_primary: Boolean(document.is_primary),
      text_char_count: numberValue(document.text_char_count),
      text_truncated: Boolean(document.text_truncated),
      fetch_status: numberValue(document.fetch_status) || null,
      fetch_error: nullableString(document.fetch_error),
    })),
    router_excerpt: buildS3RouterExcerpt(importantSections, feeTableRows, sellingStockholderRows, componentCandidates),
    needs_human_review: parsed.needs_human_review,
    review_reasons: parsed.review_reasons,
  };
}

type S3ComponentCandidate = {
  label: string;
  instrument_type: string;
  share_count: number | null;
  share_text: string | null;
  amount_text: string | null;
  price_text: string | null;
  relationship: string;
  source: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

type S3ComponentCandidates = {
  evidence_version: "s3_component_candidates_v1";
  registered_pool_components: S3ComponentCandidate[];
  future_or_excluded_components: S3ComponentCandidate[];
  totals: {
    convertible_notes_shares: number | null;
    warrant_shares: number | null;
    total_component_shares: number | null;
    total_potential_supply: number | null;
    component_difference_vs_total_supply: number | null;
    reconciles_to_total_supply: boolean | null;
  };
  notes: string[];
};

function buildS3ComponentCandidates(llmText: string, parsed: SecS3FilingFacts): S3ComponentCandidates {
  const fromText = extractS3ComponentCandidatesFromText(llmText);
  const fromSellingStockholders = extractS3ComponentCandidatesFromSellingStockholders(parsed);
  const totalPotentialSupply = parsed.resale_share_count?.value || parsed.shares_registered?.value || null;
  const textRegisteredComponents = dedupeS3ComponentCandidates(fromText.registeredPoolComponents);
  const textComponentTotal = textRegisteredComponents.reduce((sum, candidate) => sum + (candidate.share_count || 0), 0);
  const textComponentsReconcile =
    Boolean(totalPotentialSupply && textComponentTotal) &&
    Math.abs((totalPotentialSupply || 0) - textComponentTotal) <= Math.max(10, Math.round((totalPotentialSupply || 0) * 0.002));
  const registeredPoolComponents = textComponentsReconcile
    ? textRegisteredComponents
    : mergeS3ComponentCandidateSources(textRegisteredComponents, fromSellingStockholders.registeredPoolComponents);
  const futureOrExcludedComponents = mergeS3ComponentCandidateSources(
    fromText.futureOrExcludedComponents,
    fromSellingStockholders.futureOrExcludedComponents,
  );
  const totals = summarizeS3ComponentCandidates(registeredPoolComponents, totalPotentialSupply);
  const notes = [
    "Candidate extraction only; LLM must confirm relationships against source evidence.",
    "Use registered_pool_components for supply_segments only when evidence supports inclusion in the current registered resale pool.",
  ];
  if (totals.reconciles_to_total_supply === false) {
    notes.push("Component sum does not reconcile to total registered supply; set human review if used.");
  }
  if (futureOrExcludedComponents.length) {
    notes.push("future_or_excluded_components may be outside the current registered pool.");
  }

  return {
    evidence_version: "s3_component_candidates_v1",
    registered_pool_components: registeredPoolComponents.slice(0, 16),
    future_or_excluded_components: futureOrExcludedComponents.slice(0, 12),
    totals,
    notes,
  };
}

function mergeS3ComponentCandidateSources(textCandidates: S3ComponentCandidate[], tableCandidates: S3ComponentCandidate[]) {
  const textInstrumentTypes = new Set(textCandidates.map((candidate) => candidate.instrument_type));
  return dedupeS3ComponentCandidates([
    ...textCandidates,
    ...tableCandidates.filter((candidate) => !textInstrumentTypes.has(candidate.instrument_type)),
  ]);
}

function extractS3ComponentCandidatesFromText(text: string) {
  const source = compactText(text);
  const registeredPoolComponents: S3ComponentCandidate[] = [];
  const futureOrExcludedComponents: S3ComponentCandidate[] = [];
  if (!source) return { registeredPoolComponents, futureOrExcludedComponents };

  const directRegisteredComponents = extractDirectRegisteredPoolComponents(source);
  if (directRegisteredComponents.length) {
    return {
      registeredPoolComponents: directRegisteredComponents,
      futureOrExcludedComponents: extractFutureOrExcludedS3Components(source),
    };
  }

  const componentPattern =
    /\b(\d[\d,.]*)\s+(First|Second|Third|Fourth|Initial|Additional)?\s*(Conversion Shares|Warrant Shares|Pre-Funded Warrant Shares|Preferred Conversion Shares|Note Conversion Shares|Common Warrant Shares)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = componentPattern.exec(source))) {
    if (isLikelyTrancheOrdinalComponentFalsePositive(source, match.index || 0, match[1])) continue;
    const shareText = `${match[1]} shares`;
    const descriptor = compactText(`${match[2] || ""} ${match[3] || ""}`);
    const evidence = pickNearbyText(source, match.index || 0, 320);
    const candidate = makeS3ComponentCandidate({
      label: labelS3Component(descriptor, evidence),
      instrumentType: inferS3InstrumentType(`${descriptor} ${evidence}`),
      shareText,
      relationship: isFutureOrExcludedS3Component(evidence) ? "outside_current_registered_pool" : "included_in_registered_pool",
      source: "source_text",
      evidence,
      confidence: "high",
    });
    if (candidate.relationship === "outside_current_registered_pool") futureOrExcludedComponents.push(candidate);
    else registeredPoolComponents.push(candidate);
  }

  return { registeredPoolComponents, futureOrExcludedComponents };
}

function extractDirectRegisteredPoolComponents(source: string) {
  const genericComponents = extractConsistingOfRegisteredPoolComponents(source);
  if (genericComponents.length) return genericComponents;

  const specs = [
    {
      label: "First notes conversion",
      instrumentType: "convertible_notes",
      pattern: /(\d[\d,]*)\s+shares of Common Stock[^.]{0,160}\bFirst Conversion Shares\b/i,
    },
    {
      label: "First warrant shares",
      instrumentType: "warrants",
      pattern: /(\d[\d,]*)\s+shares of Common Stock[^.]{0,160}\bFirst Warrant Shares\b/i,
    },
    {
      label: "Second notes conversion",
      instrumentType: "convertible_notes",
      pattern: /(\d[\d,]*)\s+shares of Common Stock[^.]{0,160}\bSecond Conversion Shares\b/i,
    },
    {
      label: "Second warrant shares",
      instrumentType: "warrants",
      pattern: /(\d[\d,]*)\s+shares of Common Stock[^.]{0,160}\bSecond Warrant Shares\b/i,
    },
  ];

  return specs
    .map((spec) => {
      const match = source.match(spec.pattern);
      if (!match?.[1]) return null;
      return makeS3ComponentCandidate({
        label: spec.label,
        instrumentType: spec.instrumentType,
        shareText: `${match[1]} shares`,
        relationship: "included_in_registered_pool",
        source: "source_text_named_pool_component",
        evidence: pickNearbyText(source, match.index || 0, 360),
        confidence: "high",
      });
    })
    .filter((candidate): candidate is S3ComponentCandidate => Boolean(candidate));
}

function extractConsistingOfRegisteredPoolComponents(source: string) {
  const anchorPattern =
    /\b(?:(?:this\s+prospectus\s+relates\s+to|prospectus\s+relates\s+to)[\s\S]{0,420}?\bof\s+up\s+to|register[\s\S]{0,420}?\bup\s+to|(?:consisting of|consists of))\b/gi;
  let anchor: RegExpExecArray | null;
  while ((anchor = anchorPattern.exec(source))) {
    const anchorIndex = anchor.index || 0;
    const anchorContext = source.slice(Math.max(0, anchorIndex - 260), anchorIndex + 700);
    if (isNonSupplyS3ComponentContext(anchorContext)) continue;

    const segment = source.slice(anchorIndex, anchorIndex + 2_400);
    if (isNonSupplyS3ComponentContext(segment.slice(0, 700))) continue;

    const tail = segment.slice(180);
    const stop = tail.search(/\n\n|\bThe selling stockholders may offer\b|\bThe registration of these shares\b|\bOur Common Stock\b/i);
    const sentence = stop >= 0 ? segment.slice(0, 180 + stop) : segment;
    const clauses = sentence
      .split(/\s*\([a-z]\)\s+|;\s+|,\s+and\s+/i)
      .map((clause) => compactText(clause))
      .filter(Boolean);

    const candidates: S3ComponentCandidate[] = [];
    for (const clause of clauses) {
      if (isNonSupplyS3ComponentContext(clause)) continue;
      const match = clause.match(/\b(\d[\d,]*)\s+shares\s+of\s+(?:our\s+)?common\s+stock\b/i);
      if (!match?.[1]) continue;

      const instrumentType = inferS3InstrumentTypeFromRegisteredPoolClause(clause);
      candidates.push(makeS3ComponentCandidate({
        label: labelS3Component(instrumentType === "common_stock" ? "common shares" : clause, clause),
        instrumentType,
        shareText: `${match[1]} shares`,
        relationship: "included_in_registered_pool",
        source: "source_text_enumerated_pool_component",
        evidence: truncate(clause, 520),
        confidence: "high",
      }));
    }

    if (candidates.length) return dedupeS3ComponentCandidates(candidates);
  }

  return [];
}

function isNonSupplyS3ComponentContext(text: string) {
  return /\b(?:authoriz(?:e|es|ed|ing|ation)|charter\s+authoriz|authorized\s+capital|shares?\s+authorized|current\s+shares?\s+outstanding|shares?\s+outstanding|issued\s+and\s+outstanding|outstanding|beneficially\s+owned|owned\s+(?:prior|before|after)|post-offering|after\s+this\s+offering|fee\s+table|calculated\s+solely|aggregate\s+market\s+value|public\s+float|non-affiliates?)\b/i.test(
    text,
  );
}

function extractFutureOrExcludedS3Components(source: string) {
  const components: S3ComponentCandidate[] = [];
  const pattern =
    /\b(?:does not include|excludes?|outside|additional|future)[^.]{0,180}?(\d[\d,.]*)\s+(First|Second|Additional)?\s*(Conversion Shares|Warrant Shares|Pre-Funded Warrant Shares|Common Warrant Shares)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (isLikelyTrancheOrdinalComponentFalsePositive(source, match.index || 0, match[1])) continue;
    const descriptor = compactText(`${match[2] || ""} ${match[3] || ""}`);
    components.push(makeS3ComponentCandidate({
      label: labelS3Component(descriptor, pickNearbyText(source, match.index || 0, 360)),
      instrumentType: inferS3InstrumentType(descriptor),
      shareText: `${match[1]} shares`,
      relationship: "outside_current_registered_pool",
      source: "source_text_excluded_component",
      evidence: pickNearbyText(source, match.index || 0, 360),
      confidence: "medium",
    }));
  }
  return components;
}

function extractS3ComponentCandidatesFromSellingStockholders(parsed: SecS3FilingFacts) {
  const registeredPoolComponents: S3ComponentCandidate[] = [];
  const futureOrExcludedComponents: S3ComponentCandidate[] = [];

  for (const holder of parsed.selling_stockholders) {
    for (const component of holder.source_components) {
      const candidate = makeS3ComponentCandidate({
        label: labelS3Component(component.text || component.component_type || "selling stockholder component", component.evidence),
        instrumentType: inferS3InstrumentType(`${component.component_type || ""} ${component.text} ${component.evidence}`),
        shareText: component.shares?.text || null,
        amountText: component.amount?.text || null,
        relationship: "included_in_registered_pool",
        source: "selling_stockholders_table",
        evidence: component.evidence || holder.footnote_excerpt || holder.evidence,
        confidence: component.shares?.value ? "medium" : "low",
      });
      registeredPoolComponents.push(candidate);
    }

    for (const component of holder.excluded_shares) {
      const candidate = makeS3ComponentCandidate({
        label: labelS3Component(component.text || component.component_type || "excluded component", component.evidence),
        instrumentType: inferS3InstrumentType(`${component.component_type || ""} ${component.text} ${component.evidence}`),
        shareText: component.shares?.text || null,
        amountText: component.amount?.text || null,
        relationship: "outside_current_registered_pool",
        source: "selling_stockholders_table",
        evidence: component.evidence || holder.footnote_excerpt || holder.evidence,
        confidence: component.shares?.value ? "medium" : "low",
      });
      futureOrExcludedComponents.push(candidate);
    }
  }

  return {
    registeredPoolComponents: aggregateS3HolderComponents(registeredPoolComponents),
    futureOrExcludedComponents: aggregateS3HolderComponents(futureOrExcludedComponents),
  };
}

function aggregateS3HolderComponents(candidates: S3ComponentCandidate[]) {
  const grouped = new Map<string, S3ComponentCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.share_count || candidate.instrument_type === "common_stock" || candidate.instrument_type === "unknown") continue;
    const key = `${candidate.instrument_type}|${candidate.relationship}`;
    grouped.set(key, [...(grouped.get(key) || []), candidate]);
  }

  return [...grouped.entries()]
    .map(([key, group]) => {
      const [instrumentType, relationship] = key.split("|");
      const shareCount = group.reduce((sum, candidate) => sum + (candidate.share_count || 0), 0);
      return {
        label: labelAggregatedS3Component(instrumentType),
        instrument_type: instrumentType,
        share_count: shareCount || null,
        share_text: shareCount ? `${shareCount.toLocaleString("en-US")} shares` : null,
        amount_text: null,
        price_text: null,
        relationship,
        source: "selling_stockholders_table_aggregate",
        evidence: truncate(group.map((candidate) => candidate.evidence).filter(Boolean).slice(0, 3).join(" | "), 520),
        confidence: group.length >= 2 ? "medium" : "low",
      } satisfies S3ComponentCandidate;
    })
    .filter((candidate) => candidate.share_count);
}

function summarizeS3ComponentCandidates(candidates: S3ComponentCandidate[], totalPotentialSupply: number | null) {
  const convertibleNotesShares = sumS3CandidateShares(candidates, "convertible_notes");
  const warrantShares = sumS3CandidateShares(candidates, "warrants");
  const totalComponentShares = candidates.reduce((sum, candidate) => sum + (candidate.share_count || 0), 0) || null;
  const difference =
    totalPotentialSupply !== null && totalComponentShares !== null ? Math.abs(totalPotentialSupply - totalComponentShares) : null;
  const reconciles =
    difference === null || totalPotentialSupply === null
      ? null
      : difference <= Math.max(10, Math.round(totalPotentialSupply * 0.002));

  return {
    convertible_notes_shares: convertibleNotesShares || null,
    warrant_shares: warrantShares || null,
    total_component_shares: totalComponentShares,
    total_potential_supply: totalPotentialSupply,
    component_difference_vs_total_supply: difference,
    reconciles_to_total_supply: reconciles,
  };
}

function sumS3CandidateShares(candidates: S3ComponentCandidate[], instrumentType: string) {
  return candidates
    .filter((candidate) => candidate.instrument_type === instrumentType)
    .reduce((sum, candidate) => sum + (candidate.share_count || 0), 0);
}

function dedupeS3ComponentCandidates(candidates: S3ComponentCandidate[]) {
  const seen = new Set<string>();
  const deduped: S3ComponentCandidate[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.instrument_type,
      candidate.share_count || "null",
      candidate.relationship,
      normalizeS3ComponentLabel(candidate.label),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped.sort((left, right) => {
    const leftRank = left.instrument_type === "convertible_notes" ? 1 : left.instrument_type === "warrants" ? 2 : 3;
    const rightRank = right.instrument_type === "convertible_notes" ? 1 : right.instrument_type === "warrants" ? 2 : 3;
    return leftRank - rightRank || (left.share_count || 0) - (right.share_count || 0);
  });
}

function makeS3ComponentCandidate({
  label,
  instrumentType,
  shareText,
  amountText = null,
  priceText = null,
  relationship,
  source,
  evidence,
  confidence,
}: {
  label: string;
  instrumentType: string;
  shareText: string | null;
  amountText?: string | null;
  priceText?: string | null;
  relationship: string;
  source: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
}): S3ComponentCandidate {
  return {
    label,
    instrument_type: instrumentType,
    share_count: shareText ? parseS3ShareCount(shareText) : null,
    share_text: shareText,
    amount_text: amountText,
    price_text: priceText,
    relationship,
    source,
    evidence: truncate(evidence, 520),
    confidence,
  };
}

function labelS3Component(descriptor: string, evidence: string) {
  const text = compactText(`${descriptor} ${evidence}`);
  const ordinal = text.match(/\b(First|Second|Third|Fourth|Initial|Additional)\b/i)?.[1];
  const tranche = text.match(/\bTranche\s+([A-Z]-\d+)\b/i)?.[1];
  if (/\b(?:pre-funded|prefunded)\s+warrants?\b/i.test(text)) return "Pre-funded warrant shares";
  if (tranche && /\bwarrants?\b/i.test(text)) return `Tranche ${tranche.toUpperCase()} warrant shares`;
  if (/\bwarrants?\b/i.test(text)) return `${titleCaseWord(ordinal)} warrant shares`.trim();
  if (/\bpreferred\b/i.test(text)) return `${titleCaseWord(ordinal)} preferred conversion shares`.trim();
  if (/\bconversion\b|\bnote\b/i.test(text)) return `${titleCaseWord(ordinal)} convertible-note shares`.trim();
  if (/\bcommon\b/i.test(text)) return `${titleCaseWord(ordinal)} common shares`.trim();
  return titleCaseWord(descriptor) || "Offering component";
}

function labelAggregatedS3Component(instrumentType: string) {
  if (instrumentType === "convertible_notes") return "Convertible-note shares";
  if (instrumentType === "convertible_preferred") return "Preferred conversion shares";
  if (instrumentType === "warrants") return "Warrant shares";
  if (instrumentType === "common_stock") return "Common shares";
  return "Offering component";
}

function inferS3InstrumentType(text: string) {
  if (/\bwarrants?\b/i.test(text)) return "warrants";
  if (/\bpreferred\b/i.test(text)) return "convertible_preferred";
  if (/\bnote\b|\bconversion\b/i.test(text)) return "convertible_notes";
  if (/\bcommon stock\b|\bcommon shares\b|\bordinary shares\b/i.test(text)) return "common_stock";
  return "unknown";
}

function inferS3InstrumentTypeFromRegisteredPoolClause(text: string) {
  if (/\b(?:pre-funded|prefunded)\s+warrants?\b/i.test(text)) return "warrants";
  if (/\btranche\s+[A-Z]-\d+[\w\s-]{0,100}?\bwarrants?\b/i.test(text)) return "warrants";
  if (/\bunderlying\b[\w\s,()-]{0,140}?\bwarrants?\b/i.test(text)) return "warrants";
  return inferS3InstrumentType(text);
}

function isLikelyTrancheOrdinalComponentFalsePositive(source: string, index: number, valueText: string) {
  const shareCount = parseS3ShareCount(valueText);
  if (shareCount === null || shareCount >= 100) return false;
  const nearby = source.slice(Math.max(0, index - 28), index + valueText.length + 36);
  return /\b(?:tranche|series)\s+[A-Z]-\d+\s+warrant\s+shares?\b/i.test(nearby);
}

function isFutureOrExcludedS3Component(text: string) {
  return /\b(?:does not include|excludes?|not part of|outside|additional|future|subsequent|may issue|issuable upon future)\b/i.test(text);
}

function parseS3ShareCount(value: string) {
  const match = stringValue(value).match(/\d[\d,.]*/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeS3ComponentLabel(value: string) {
  return compactText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titleCaseWord(value: unknown) {
  const text = stringValue(value);
  if (!text) return "";
  return text.slice(0, 1).toUpperCase() + text.slice(1).toLowerCase();
}

function pickNearbyText(text: string, index: number, max: number) {
  const start = Math.max(0, index - Math.floor(max / 2));
  const end = Math.min(text.length, index + Math.floor(max / 2));
  return compactText(text.slice(start, end));
}

function makeEvidenceSection(section: string, text: string) {
  const cleaned = compactText(text);
  if (cleaned.length < 40) return null;
  return { section, text: truncate(cleaned, 4_000) };
}

function buildS3RouterExcerpt(
  sections: Array<{ section: string; text: string }>,
  feeTableRows: Array<Record<string, unknown>>,
  sellingStockholderRows: Array<Record<string, unknown>>,
  componentCandidates: S3ComponentCandidates,
) {
  const parts: string[] = [];
  for (const section of sections) {
    parts.push(`### ${section.section}\n${section.text}`);
  }
  if (componentCandidates.registered_pool_components.length || componentCandidates.future_or_excluded_components.length) {
    parts.push(`### component_candidates\n${JSON.stringify(componentCandidates)}`);
  }
  if (feeTableRows.length) {
    parts.push(`### fee_table_rows\n${JSON.stringify(feeTableRows.slice(0, 8))}`);
  }
  if (sellingStockholderRows.length) {
    parts.push(`### selling_stockholders_table\n${JSON.stringify(sellingStockholderRows.slice(0, 10))}`);
  }
  return truncate(parts.join("\n\n"), 18_000).slice(0, 18_000);
}

function extractProspectusCoverText(text: string) {
  const source = compactText(text);
  if (!source) return "";
  const prospectusIndex = source.search(/\b(?:preliminary\s+prospectus|prospectus|registration\s+statement)\b/i);
  const start = prospectusIndex >= 0 ? prospectusIndex : 0;
  const excerpt = source.slice(start, start + 5_000);
  const stop = excerpt.search(/\b(?:table\s+of\s+contents|prospectus\s+summary|risk\s+factors|the\s+offering|selling\s+(?:stockholders?|shareholders?))\b/i);
  return compactText(stop > 500 ? excerpt.slice(0, stop) : excerpt.slice(0, 2_800));
}

function extractNamedSection(text: string, headingPattern: RegExp, maxChars: number) {
  const source = compactText(text);
  if (!source) return "";
  const match = source.match(headingPattern);
  if (!match || match.index === undefined) return "";

  const sectionText = source.slice(match.index);
  const boundaryOffset = Math.min(sectionText.length, 500);
  const boundary = sectionText.slice(boundaryOffset).search(
    /\n\s*(?:#{1,4}\s*)?(?:PROSPECTUS SUMMARY|THE OFFERING|RISK FACTORS|USE OF PROCEEDS|SELLING STOCKHOLDERS|SELLING SHAREHOLDERS|PLAN OF DISTRIBUTION|DESCRIPTION OF SECURITIES|DESCRIPTION OF CAPITAL STOCK|LEGAL MATTERS|EXPERTS|WHERE YOU CAN FIND MORE INFORMATION|INCORPORATION OF CERTAIN INFORMATION|PART II|SIGNATURES)\b/i,
  );
  const end = boundary >= 0 ? Math.min(maxChars, boundaryOffset + boundary) : maxChars;
  return compactText(sectionText.slice(0, end));
}
function buildTextSections({
  bodyText,
  attachmentTexts,
  maxChars,
  maxDocumentChars,
}: {
  bodyText: string;
  attachmentTexts: AttachmentTextPayload[];
  maxChars: number;
  maxDocumentChars: number;
}) {
  const sections: Array<{ label: string; text: string; truncated: boolean }> = [];
  let remaining = maxChars;

  const pushSection = (label: string, text: string, limit: number) => {
    if (!remaining || !text.trim()) return;
    const budget = Math.max(0, Math.min(remaining, limit));
    if (!budget) return;
    const cleaned = compactText(text);
    const truncated = cleaned.length > budget;
    const selected = truncated ? cleaned.slice(0, budget) : cleaned;
    sections.push({ label, text: selected.trim(), truncated });
    remaining -= selected.length;
  };

  pushSection("Primary Filing Text", bodyText, maxDocumentChars);

  for (const attachment of attachmentTexts) {
    if (remaining < 1_000) break;
    if (isAttachmentAlreadyIncluded(bodyText, stringValue(attachment.text))) continue;
    const type = nullableString(attachment.type) || "Exhibit";
    const description = nullableString(attachment.description);
    const label = description ? `${type} - ${description}` : type;
    pushSection(label, stringValue(attachment.text), Math.min(maxDocumentChars, Math.max(4_000, remaining)));
  }

  return sections;
}

function isAttachmentAlreadyIncluded(bodyText: string, attachmentText: string) {
  const body = compactComparableText(bodyText);
  const attachment = compactComparableText(attachmentText);
  if (!body || !attachment || attachment.length < 500) return false;
  return body.includes(attachment.slice(0, Math.min(1_000, attachment.length)));
}

function compactComparableText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function compactText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .split("\n")
    .filter((line) => !isXbrlNoiseLine(line))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function truncate(value: string, max: number) {
  const text = compactText(value);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function isXbrlNoiseLine(line: string) {
  const text = line.trim();
  if (!text) return false;
  if (/^(iso4217|xbrli|us-gaap|dei|srt|country|exch|stpr|naics):[A-Za-z0-9_.:-]+$/.test(text)) return true;
  if (/^(http|https):\/\/xbrl\./i.test(text)) return true;
  return false;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
