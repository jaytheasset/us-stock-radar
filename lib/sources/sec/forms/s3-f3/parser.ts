export const SEC_S3_PARSER_VERSION = "sec_s3_parser_v1";

export type SecS3DocumentSummary = {
  type: string | null;
  description: string | null;
  url_present: boolean;
  is_primary: boolean;
  text_char_count: number;
  text_truncated: boolean;
  fetch_status: number | null;
  fetch_error: string | null;
};

export type SecS3Field = {
  value: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

export type SecS3CountField = {
  value: number | null;
  text: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

export type SecS3MoneyField = {
  value: {
    amount: number | null;
    currency: "USD" | null;
    scale: "raw" | "thousand" | "million" | "billion" | null;
  };
  text: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

export type SecS3PriceField = {
  value: {
    price: number | null;
    currency: "USD" | null;
  };
  text: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

export type SecS3PercentField = {
  value: number | null;
  text: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

export type SecS3FeeTableRow = {
  registration_category: string | null;
  fee_payment_type: string | null;
  security_type: string | null;
  security_class_title: string | null;
  fee_calculation_rule: string | null;
  amount_registered: SecS3CountField | SecS3MoneyField | null;
  proposed_maximum_offering_price_per_unit: SecS3PriceField | null;
  maximum_aggregate_offering_price: SecS3MoneyField | null;
  fee_rate: number | null;
  registration_fee: SecS3MoneyField | null;
  evidence: string;
};

export type SecS3FeeTableTotals = {
  total_offering_amount: SecS3MoneyField | null;
  total_fees_previously_paid: SecS3MoneyField | null;
  total_fee_offsets: SecS3MoneyField | null;
  net_fee_due: SecS3MoneyField | null;
};

export type SecS3SellingStockholderComponent = {
  component_type: string | null;
  shares: SecS3CountField | null;
  amount: SecS3MoneyField | null;
  text: string;
  evidence: string;
};

export type SecS3SellingStockholderRow = {
  holder_name: string;
  footnote_id: string | null;
  beneficially_owned_before: SecS3CountField | null;
  shares_offered_for_resale: SecS3CountField | null;
  beneficially_owned_after: SecS3CountField | null;
  percent_after: SecS3PercentField | null;
  beneficial_ownership_caps: SecS3PercentField[];
  source_components: SecS3SellingStockholderComponent[];
  excluded_shares: SecS3SellingStockholderComponent[];
  control_persons: string[];
  address: string | null;
  footnote_excerpt: string | null;
  evidence: string;
  confidence: "high" | "medium" | "low";
};

export type SecS3CleanedSourceBlock = {
  block_type: string;
  label: string;
  source: string;
  text: string;
};

export type SecS3AmendmentInfo = {
  is_amendment: boolean;
  amendment_number: SecS3CountField | null;
  registration_number: SecS3Field | null;
  includes_full_prospectus: boolean;
  unchanged_remainder_not_included: boolean;
  added_exhibits: SecS3DocumentSummary[];
  limited_scope_signal_candidates: SecS3Field[];
  change_signal_candidates: SecS3Field[];
  router_payload: {
    form_type: string | null;
    accession_number: string | null;
    registration_number: string | null;
    amendment_number: number | null;
    includes_full_prospectus: boolean;
    unchanged_remainder_not_included: boolean;
    added_exhibits: string[];
    limited_scope_signal_candidates: string[];
    change_signal_candidates: string[];
    amendment_excerpt: string | null;
  };
  amendment_excerpt: string | null;
};

export type SecS3OfferingTerms = {
  registration_statement_kind: SecS3Field | null;
  offering_type: SecS3Field | null;
  security_type: SecS3Field | null;
  primary_or_resale: SecS3Field | null;
  offering_amount: SecS3MoneyField | null;
  shelf_capacity: SecS3MoneyField | null;
  atm_program_size: SecS3MoneyField | null;
  resale_share_count: SecS3CountField | null;
  current_shares_outstanding: SecS3CountField | null;
  warrant_coverage: SecS3Field | null;
  conversion_price: SecS3PriceField | null;
  extracted_field_count: number;
};

export type SecS3ParseInput = {
  rawItemId?: string | null;
  sourceUniqueId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  bodyText?: string | null;
  analysisText?: string | null;
  rawPayload?: unknown;
  metadata?: unknown;
};

export type SecS3FilingFacts = {
  parser_version: typeof SEC_S3_PARSER_VERSION;
  raw_item_id: string | null;
  accession_number: string | null;
  form_type: string | null;
  is_s3_family: boolean;
  issuer: string | null;
  ticker: string | null;
  filed_at: string | null;
  source_url: string | null;
  registration_statement_kind: SecS3Field | null;
  registration_status: SecS3Field | null;
  prospectus_status: SecS3Field | null;
  amendment: SecS3AmendmentInfo;
  primary_or_resale: SecS3Field | null;
  securities_registered: SecS3Field[];
  shares_registered: SecS3CountField | null;
  resale_share_count: SecS3CountField | null;
  current_shares_outstanding: SecS3CountField | null;
  dilution_reference: SecS3Field | null;
  selling_stockholders_section: SecS3Field | null;
  selling_stockholders: SecS3SellingStockholderRow[];
  plan_of_distribution_section: SecS3Field | null;
  use_of_proceeds_section: SecS3Field | null;
  private_placement_reference: SecS3Field | null;
  fee_table: {
    present: boolean;
    text_available: boolean;
    documents: SecS3DocumentSummary[];
    rows: SecS3FeeTableRow[];
    totals: SecS3FeeTableTotals;
  };
  documents: SecS3DocumentSummary[];
  offering_terms: SecS3OfferingTerms;
  extracted_field_count: number;
  needs_human_review: boolean;
  review_reasons: string[];
  cleaned_source_blocks: SecS3CleanedSourceBlock[];
  text_stats: {
    body_chars: number;
    analysis_chars: number;
    attachment_chars: number;
  };
};

type SecDocumentPayload = {
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
  text?: unknown;
};

export function parseSecS3Filing(input: SecS3ParseInput): SecS3FilingFacts {
  const rawPayload = toRecord(input.rawPayload) || {};
  const metadata = toRecord(input.metadata) || {};
  const documents = recordArray(rawPayload.documents) as SecDocumentPayload[];
  const attachmentTexts = recordArray(rawPayload.attachment_texts) as AttachmentTextPayload[];
  const formType = resolveS3FormType({
    documents,
    metadata,
    rawPayload,
    title: input.title,
  });
  const combinedText = compactText(stringValue(input.analysisText) || stringValue(input.bodyText));
  const primaryText = extractPrimaryText(combinedText, formType);
  const attachmentText = compactText(attachmentTexts.map((item) => stringValue(item.text)).join("\n\n"));
  const s3Sources = [stringValue(input.title), primaryText, attachmentText].map(compactText).filter(Boolean);
  const s3Text = s3Sources.join("\n\n");
  const cleanedSourceBlocks = buildS3CleanedSourceBlocks(s3Text);
  const documentSummaries = documents.map(mapDocumentSummary);
  const feeTableDocuments = documentSummaries.filter(isFeeTableDocument);
  const feeTableText = compactText(
    attachmentTexts
      .filter((item) => isFeeTableLabel(`${stringValue(item.type)} ${stringValue(item.description)}`))
      .map((item) => stringValue(item.text))
      .join("\n\n"),
  );
  const feeTable = parseS3FeeTable(feeTableText);

  const registrationStatementKind = findRegistrationStatementKind(s3Text);
  const registrationStatus = findRegistrationStatus(s3Text, formType);
  const prospectusStatus = findProspectusStatus(s3Text);
  const amendment = buildS3AmendmentInfo({
    accessionNumber: nullableString(rawPayload.accession_number) || nullableString(input.sourceUniqueId),
    documents: documentSummaries,
    formType,
    s3Text,
  });
  const primaryOrResale = findPrimaryOrResale(s3Text);
  let securitiesRegistered = findSecuritiesRegistered(s3Text);
  const sharesRegistered = findRegisteredShareCount(s3Text);
  if (primaryOrResale?.value === "resale" && /\bshares of common stock\b/i.test(sharesRegistered?.text || "")) {
    securitiesRegistered = [
      {
        value: "common_stock",
        evidence: sharesRegistered?.evidence || "Resale registration statement registers shares of common stock.",
        confidence: "high",
      },
    ];
  }
  const resaleShareCount =
    primaryOrResale?.value === "resale" && sharesRegistered
      ? sharesRegistered
      : findShareCount(s3Text, [
          /\b(?:resale by|resale of|selling stockholders?.{0,120}?up to|selling shareholders?.{0,120}?up to)\s+(\d[\d,.]*\s+(?:shares of common stock|common shares|ordinary shares|shares))\b/i,
        ]);
  const currentSharesOutstanding = findShareCount(s3Text, [
    /\b(\d[\d,.]*\s+(?:shares of common stock|common shares|ordinary shares|shares))\s+(?:were|are)?\s*(?:issued and outstanding|outstanding)\b/i,
  ]);
  const dilutionReference = findSentenceField(s3Text, /\b(?:substantial dilution|dilution to our existing stockholders|could cause dilution)\b/i);
  const sellingStockholdersFullSection = extractSellingStockholdersSection(s3Text);
  const sellingStockholdersSection = sellingStockholdersFullSection
    ? {
        value: truncate(sellingStockholdersFullSection, 420),
        evidence: truncate(sellingStockholdersFullSection, 420),
        confidence: "medium" as const,
      }
    : findSectionField(s3Text, "selling stockholders") || findSectionField(s3Text, "selling shareholders");
  const sellingStockholders = parseSellingStockholders(sellingStockholdersFullSection || sellingStockholdersSection?.value || "", s3Text);
  const planOfDistributionSection = findSectionField(s3Text, "plan of distribution");
  const useOfProceedsSection = findSectionField(s3Text, "use of proceeds");
  const privatePlacementReference = findSentenceField(s3Text, /\b(?:private placement|PIPE|securities purchase agreement)\b/i);
  const offeringTerms = buildS3OfferingTerms({
    currentSharesOutstanding,
    feeTableTotals: feeTable.totals,
    primaryOrResale,
    registrationStatementKind,
    resaleShareCount,
    securitiesRegistered,
    s3Text,
  });
  const reviewReasons = buildReviewReasons({
    feeTableDocuments,
    feeTableRows: feeTable.rows,
    formType,
    amendment,
    primaryOrResale,
    registrationStatus,
    securitiesRegistered,
    sellingStockholders,
    sharesRegistered,
    s3Text,
  });
  const extractedFieldCount = [
    registrationStatementKind,
    registrationStatus,
    prospectusStatus,
    primaryOrResale,
    sharesRegistered,
    resaleShareCount,
    currentSharesOutstanding,
    dilutionReference,
    sellingStockholdersSection,
    planOfDistributionSection,
    useOfProceedsSection,
    privatePlacementReference,
    ...securitiesRegistered,
  ].filter(Boolean).length + offeringTerms.extracted_field_count + sellingStockholders.length;

  return {
    parser_version: SEC_S3_PARSER_VERSION,
    raw_item_id: nullableString(input.rawItemId),
    accession_number: nullableString(rawPayload.accession_number) || nullableString(input.sourceUniqueId),
    form_type: formType,
    is_s3_family: isS3Family(formType),
    issuer:
      nullableString(rawPayload.company_name) ||
      nullableString(metadata.company_name) ||
      nullableString(metadata.issuer) ||
      readIssuerFromText(s3Text),
    ticker: nullableString(rawPayload.ticker) || nullableString(metadata.ticker),
    filed_at: nullableString(input.publishedAt),
    source_url: nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url),
    registration_statement_kind: registrationStatementKind,
    registration_status: registrationStatus,
    prospectus_status: prospectusStatus,
    amendment,
    primary_or_resale: primaryOrResale,
    securities_registered: securitiesRegistered,
    shares_registered: sharesRegistered,
    resale_share_count: resaleShareCount,
    current_shares_outstanding: currentSharesOutstanding,
    dilution_reference: dilutionReference,
    selling_stockholders_section: sellingStockholdersSection,
    selling_stockholders: sellingStockholders,
    plan_of_distribution_section: planOfDistributionSection,
    use_of_proceeds_section: useOfProceedsSection,
    private_placement_reference: privatePlacementReference,
    fee_table: {
      present: feeTableDocuments.length > 0,
      text_available: feeTableDocuments.some((document) => document.text_char_count > 0) || Boolean(feeTableText),
      documents: feeTableDocuments,
      rows: feeTable.rows,
      totals: feeTable.totals,
    },
    documents: documentSummaries,
    offering_terms: offeringTerms,
    extracted_field_count: extractedFieldCount,
    needs_human_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    cleaned_source_blocks: cleanedSourceBlocks,
    text_stats: {
      body_chars: stringValue(input.bodyText).length,
      analysis_chars: stringValue(input.analysisText).length,
      attachment_chars: attachmentText.length,
    },
  };
}

function findRegistrationStatementKind(text: string): SecS3Field | null {
  if (/\b[SF]-3ASR\b|\bautomatic shelf registration statement\b|\bwell-known seasoned issuer\b/i.test(text)) {
    return field("automatic_shelf_registration", text, /\b[SF]-3ASR\b|\bautomatic shelf registration statement\b|\bwell-known seasoned issuer\b/i, "high");
  }
  if (/\b(?:resale by the selling stockholders|resale by selling stockholders|resale prospectus|selling stockholders? named in this prospectus)\b/i.test(text)) {
    return field("resale_registration", text, /\b(?:resale by the selling stockholders|resale by selling stockholders|resale prospectus|selling stockholders? named in this prospectus)\b/i, "high");
  }
  if (/\b(?:shelf registration statement|base prospectus|from time to time)\b/i.test(text)) {
    return field("shelf_registration", text, /\b(?:shelf registration statement|base prospectus|from time to time)\b/i, "medium");
  }
  return field("registration_statement", text, /\bregistration statement\b/i, "medium");
}

function findRegistrationStatus(text: string, formType: string | null): SecS3Field | null {
  if (
    isAutomaticShelfForm(formType) ||
    /\b(?:automatic shelf registration statement|well-known seasoned issuer|immediately effective upon filing)\b/i.test(text)
  ) {
    return field(
      "automatically_effective",
      text,
      /\b[SF]-3ASR\b|\bautomatic shelf registration statement\b|\bwell-known seasoned issuer\b|\bimmediately effective upon filing\b/i,
      "high",
    );
  }
  const filedNotEffectivePattern =
    /\bsubject\s+to\s+completion\b|\b(?:may\s+not\s+sell|may\s+not\s+be\s+sold|may\s+not\s+be\s+offered)[\s\S]{0,520}?registration\s+statement[\s\S]{0,520}?(?:is|has\s+been|declared)\s+effective\b|\bregistration\s+statement[\s\S]{0,220}?not\s+effective\b/i;
  if (filedNotEffectivePattern.test(text)) {
    return field("filed_not_effective", text, filedNotEffectivePattern, "high");
  }
  if (/\bdeclared effective\b|\bbecame effective\b|\bis effective\b/i.test(text)) {
    return field("effective", text, /\bdeclared effective\b|\bbecame effective\b|\bis effective\b/i, "high");
  }
  if (isS3Family(formType) && /\bFORM [SF]-3\b[\s\S]{0,800}\bREGISTRATION STATEMENT\b/i.test(text)) {
    return {
      value: "filed_not_effective",
      evidence: `Form ${formatS3FamilyFormLabel(formType)} registration statement filed; no automatic shelf or declared-effective language found.`,
      confidence: "low",
    };
  }
  return null;
}

function findProspectusStatus(text: string): SecS3Field | null {
  if (/\bpreliminary prospectus\b/i.test(text)) {
    return field("preliminary_prospectus", text, /\bpreliminary prospectus\b/i, "high");
  }
  if (/\bbase prospectus\b/i.test(text)) {
    return field("base_prospectus", text, /\bbase prospectus\b/i, "medium");
  }
  if (/\bprospectus supplement\b/i.test(text)) {
    return field("prospectus_supplement_required", text, /\bprospectus supplement\b/i, "medium");
  }
  return field("prospectus", text, /\bprospectus\b/i, "low");
}

function findPrimaryOrResale(text: string): SecS3Field | null {
  const resale = field(
    "resale",
    text,
    /\b(?:resale by the selling stockholders|resale by selling stockholders|selling stockholders? named in this prospectus|selling shareholders? named in this prospectus|selling stockholders? may offer and sell|selling shareholders? may offer and sell)\b/i,
    "high",
  );
  const primaryStrong = field(
    "primary",
    text,
    /\b(?:we are offering|we have entered into[^.\n]{0,220}?(?:sales agreement|equity distribution agreement)|ATM Prospectus Supplement|dividend reinvestment and stock purchase plan|participants in the plan may[^.\n]{0,180}?purchase shares)\b/i,
    "medium",
  );
  const primaryGeneric = field(
    "primary",
    text,
    /\b(?:we may offer|we may sell|company may offer)\b/i,
    "medium",
  );
  if (primaryStrong && resale) {
    return {
      value: "mixed",
      evidence: truncate(`${primaryStrong.evidence} ${resale.evidence}`, 420),
      confidence: "medium",
    };
  }
  return resale || primaryStrong || primaryGeneric;
}

function buildS3AmendmentInfo({
  accessionNumber,
  documents,
  formType,
  s3Text,
}: {
  accessionNumber: string | null;
  documents: SecS3DocumentSummary[];
  formType: string | null;
  s3Text: string;
}): SecS3AmendmentInfo {
  const isAmendment = isS3FamilyAmendment(formType);
  const amendmentNumber = isAmendment ? findAmendmentNumber(s3Text) : null;
  const registrationNumber = isS3Family(formType) ? findRegistrationNumber(s3Text) : null;
  const amendmentExcerpt = isAmendment ? extractAmendmentExcerpt(s3Text) : null;
  const addedExhibits = isAmendment ? documents.filter((document) => isS3AmendmentAddedExhibit(document)) : [];
  const limitedScopeSignals = isAmendment ? findLimitedScopeAmendmentSignalCandidates(amendmentExcerpt || s3Text) : [];
  const changeSignals = isAmendment ? findAmendmentChangeSignalCandidates(amendmentExcerpt || s3Text) : [];
  const unchangedRemainderNotIncluded = /\b(?:remainder|rest)\s+of\s+the\s+registration\s+statement[\s\S]{0,180}?\bunchanged\b[\s\S]{0,180}?\bnot\s+been\s+included\b/i.test(
    amendmentExcerpt || s3Text,
  );
  const includesFullProspectus = isAmendment ? hasFullProspectusText(s3Text) && !unchangedRemainderNotIncluded : false;

  return {
    is_amendment: isAmendment,
    amendment_number: amendmentNumber,
    registration_number: registrationNumber,
    includes_full_prospectus: includesFullProspectus,
    unchanged_remainder_not_included: unchangedRemainderNotIncluded,
    added_exhibits: addedExhibits,
    limited_scope_signal_candidates: limitedScopeSignals,
    change_signal_candidates: changeSignals,
    router_payload: {
      form_type: formType,
      accession_number: accessionNumber,
      registration_number: registrationNumber?.value || null,
      amendment_number: amendmentNumber?.value || null,
      includes_full_prospectus: includesFullProspectus,
      unchanged_remainder_not_included: unchangedRemainderNotIncluded,
      added_exhibits: addedExhibits.map(formatDocumentLabel),
      limited_scope_signal_candidates: limitedScopeSignals.map((signal) => signal.value),
      change_signal_candidates: changeSignals.map((signal) => signal.value),
      amendment_excerpt: amendmentExcerpt,
    },
    amendment_excerpt: amendmentExcerpt,
  };
}

function findAmendmentNumber(text: string): SecS3CountField | null {
  const match = text.match(/\bAmendment\s+No\.?\s*(\d+)/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return {
    value: Number.isFinite(parsed) ? parsed : null,
    text: match[1],
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "high",
  };
}

function findRegistrationNumber(text: string): SecS3Field | null {
  const match = text.match(/\bRegistration\s+No\.?\s*([0-9]{3}\s*-\s*[0-9]+)/i);
  if (!match?.[1]) return null;
  const value = match[1].replace(/\s+/g, "").replace("-", "-");
  return {
    value,
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "high",
  };
}

function extractAmendmentExcerpt(text: string) {
  const explanatoryNote = extractNamedSection(text, "EXPLANATORY NOTE", [
    "PART II",
    "PROSPECTUS",
    "SIGNATURES",
    "ITEM 14",
    "ITEM 16",
  ]);
  if (explanatoryNote) return truncate(explanatoryNote, 2_000);

  const amendmentIndex = text.search(/\bAmendment\s+No\.?\s*\d+\b/i);
  if (amendmentIndex >= 0) {
    return truncate(text.slice(Math.max(0, amendmentIndex - 360), amendmentIndex + 1_400), 2_000);
  }
  return null;
}

function extractNamedSection(text: string, heading: string, stopHeadings: string[]) {
  const pattern = new RegExp(`\\b${escapeRegExp(heading)}\\b`, "i");
  const match = text.match(pattern);
  if (!match) return "";
  const start = match.index || 0;
  const source = text.slice(start);
  const stopPattern = new RegExp(`\\n\\s*(?:${stopHeadings.map(escapeRegExp).join("|")})\\b`, "i");
  const stop = source.slice(heading.length).search(stopPattern);
  const end = stop >= 0 ? heading.length + stop : Math.min(source.length, 3_000);
  return compactText(source.slice(0, end));
}

function findLimitedScopeAmendmentSignalCandidates(text: string): SecS3Field[] {
  const signals: Array<[string, RegExp]> = [
    ["sole_purpose_exhibit_filing", /\bsole\s+purpose\b[\s\S]{0,180}?\bfiling\s+Exhibit\b/i],
    ["consists_solely_of_limited_sections", /\bconsists\s+solely\s+of\b[\s\S]{0,220}?\b(?:cover page|explanatory note|part ii|exhibit|signature pages?)\b/i],
    ["remainder_unchanged_not_included", /\b(?:remainder|rest)\s+of\s+the\s+registration\s+statement[\s\S]{0,180}?\bunchanged\b[\s\S]{0,180}?\bnot\s+been\s+included\b/i],
    ["exhibit_only_or_consent", /\b(?:filing|furnishing)\s+(?:Exhibit|a consent|an opinion|an indenture)\b/i],
    ["delaying_amendment", /\bdelaying\s+amendment\b/i],
    ["incorporation_by_reference_update", /\bincorporat(?:e|ed|ing|ion)\s+by\s+reference\b[\s\S]{0,220}?\b(?:annual report|quarterly report|current report|future filings?)\b/i],
    ["no_other_changes", /\bno\s+other\s+changes?\s+(?:have\s+)?been\s+made\b/i],
    ["auditor_consent_update", /\bfiling\s+(?:an?\s+)?updated\s+consent\s+of\b[\s\S]{0,160}?\b(?:independent\s+registered\s+public\s+accounting\s+firm|auditor|accountant)\b/i],
    ["exhibit_107_refile", /\b(?:submitted|filed)\s+to\s+refile\s+Exhibit\s+107\b|\brefil(?:e|ing)\s+Exhibit\s+107\b/i],
  ];
  return uniqueFields(signals.map(([value, pattern]) => field(value, text, pattern, "high")).filter(Boolean) as SecS3Field[]);
}

function findAmendmentChangeSignalCandidates(text: string): SecS3Field[] {
  const signals: Array<[string, RegExp]> = [
    ["offering_amount_change", /\b(?:increase|increased|decrease|decreased|change|changed|amend|amended|update|updated)[^.\n]{0,180}?\b(?:offering amount|maximum aggregate offering price|aggregate offering price|shelf amount)\b/i],
    ["shares_registered_change", /\b(?:increase|increased|decrease|decreased|change|changed|amend|amended|update|updated)[^.\n]{0,180}?\b(?:shares registered|shares being registered|number of shares|securities being registered)\b/i],
    ["selling_stockholder_change", /\b(?:add|adds|added|remove|removed|change|changed|update|updated|amend|amended)[^.\n]{0,180}?\bselling\s+(?:stockholder|shareholder)s?\b/i],
    ["plan_of_distribution_change", /\b(?:material change|change|changed|update|updated|amend|amended)[^.\n]{0,180}?\bplan of distribution\b/i],
    ["use_of_proceeds_change", /\b(?:material change|change|changed|update|updated|amend|amended)[^.\n]{0,180}?\buse of proceeds\b/i],
    ["warrant_or_conversion_terms_change", /\b(?:change|changed|amend|amended|update|updated)[^.\n]{0,180}?\b(?:warrant|exercise price|conversion price|convertible)\b/i],
    ["registration_fee_change", /\b(?:new|revised|updated|amended|additional)[^.\n]{0,180}?\b(?:registration fee|filing fee|fee table)\b/i],
    ["post_effective_amendment", /\bpost-effective amendment\b/i],
  ];
  return uniqueFields(signals.map(([value, pattern]) => field(value, text, pattern, "medium")).filter(Boolean) as SecS3Field[]);
}

function hasFullProspectusText(text: string) {
  return /\b(?:PRELIMINARY\s+)?PROSPECTUS\b[\s\S]{0,1500}?\b(?:we may offer|we may sell|this prospectus provides|common stock|preferred stock|debt securities|selling stockholder)\b/i.test(
    text,
  );
}

function isS3AmendmentAddedExhibit(document: SecS3DocumentSummary) {
  const type = stringValue(document.type).toUpperCase();
  return /^EX-\d/.test(type);
}

function formatDocumentLabel(document: SecS3DocumentSummary) {
  return [document.type, document.description].filter(Boolean).join(" - ") || "Exhibit";
}

function uniqueFields(fields: SecS3Field[]) {
  const seen = new Set<string>();
  const unique: SecS3Field[] = [];
  for (const item of fields) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    unique.push(item);
  }
  return unique;
}

function findSecuritiesRegistered(text: string): SecS3Field[] {
  const coverText = extractProspectusCoverText(text);
  const commonStockResale = field(
    "common_stock",
    coverText,
    /\bprospectus\s+relates\s+to[\s\S]{0,260}?\b(?:resale|offer and resale)[\s\S]{0,260}?\bshares\s+of\s+common\s+stock\b/i,
    "high",
  );
  if (commonStockResale) return [commonStockResale];

  const coverSecurities = findSecuritiesInText(coverText, "high");
  if (coverSecurities.length) return coverSecurities;

  return findSecuritiesInText(text, "medium");
}

function findSecuritiesInText(text: string, confidence: SecS3Field["confidence"]): SecS3Field[] {
  const rules: Array<[string, RegExp]> = [
    ["common_stock", /\b\d[\d,.]*\s+shares of common stock\b|\bshares of common stock\b|\bcommon stock\b/i],
    ["common_shares", /\b\d[\d,.]*\s+common shares\b|\bcommon shares\b/i],
    ["ordinary_shares", /\bordinary shares\b/i],
    ["preferred_stock", /\bpreferred stock\b/i],
    ["debt_securities", /\bdebt securities\b/i],
    ["depositary_shares", /\bdepositary shares\b/i],
    ["purchase_contracts", /\bpurchase contracts\b/i],
    ["warrants", /\bwarrants?\b/i],
    ["units", /\bunits\b/i],
    ["rights", /\brights\b/i],
    ["convertible_notes", /\bconvertible notes?\b|\bconvertible debentures?\b/i],
  ];
  const found: SecS3Field[] = [];
  for (const [value, pattern] of rules) {
    const item = field(value, text, pattern, confidence);
    if (item) found.push(item);
  }
  return found;
}

function findShareCount(text: string, patterns: RegExp[]): SecS3CountField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = match[1].trim();
    return {
      value: normalizeShareCount(valueText),
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "high",
    };
  }
  return null;
}

function findRegisteredShareCount(text: string): SecS3CountField | null {
  const coverCandidate = findBestRegisteredShareCountCandidate(extractProspectusCoverText(text));
  if (coverCandidate) return coverCandidate;

  const bodyCandidate = findBestRegisteredShareCountCandidate(text);
  if (bodyCandidate) return bodyCandidate;

  return findShareCount(text, [
    /\b(?:preliminary prospectus|prospectus)\s+(\d[\d,.]*\s+(?:shares of common stock|common shares|ordinary shares|shares))\b/i,
    /\b(?:resale of|register(?:ing)?(?: the resale of)?)\s+(\d[\d,.]*\s+(?:shares of common stock|common shares|ordinary shares|shares))\b/i,
  ]);
}

function findBestRegisteredShareCountCandidate(text: string): SecS3CountField | null {
  const source = compactText(text);
  if (!source) return null;

  const candidates: Array<SecS3CountField & { rank: number; index: number }> = [];
  const pattern = /\b(\d[\d,.]*\s+(?:shares of common stock|common shares|ordinary shares|shares))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (!match[1]) continue;
    const valueText = match[1].trim();
    const value = normalizeShareCount(valueText);
    if (!value) continue;
    const evidence = pickEvidenceSentence(source, match.index || 0);
    const surroundingContext = source.slice(Math.max(0, (match.index || 0) - 180), (match.index || 0) + 320);
    const rank = rankRegisteredShareCountCandidate(valueText, `${surroundingContext} ${evidence}`, match.index || 0);
    if (rank < 0) continue;
    candidates.push({
      value,
      text: valueText,
      evidence,
      confidence: rank >= 7 ? "high" : "medium",
      rank,
      index: match.index || 0,
    });
  }

  candidates.sort((left, right) => {
    const leftValue = left.value || 0;
    const rightValue = right.value || 0;
    return right.rank - left.rank || rightValue - leftValue || left.index - right.index;
  });

  const best = candidates[0];
  if (!best) return null;
  return {
    value: best.value,
    text: best.text,
    evidence: best.evidence,
    confidence: best.confidence,
  };
}

function rankRegisteredShareCountCandidate(valueText: string, evidence: string, index: number) {
  const context = compactText(`${valueText} ${evidence}`);
  if (/\b(?:authoriz(?:e|es|ed|ing|ation)|outstanding|beneficially owned|owned prior|owned before|owned after|post-offering|after this offering|fee table|calculated solely|description of capital stock|capital stock consists|blank check preferred|undesignated preferred|available for future issuance|employee stock purchase plan|equity incentive plan|inducement plan|stock option plan|compensation plan|benefit plan)\b/i.test(context)) {
    return -1;
  }
  if (/\bpreferred stock\b/i.test(context) && !/\b(?:common stock|convertible|conversion|underlying|issuable|resale|selling stockholders?)\b/i.test(context)) {
    return -1;
  }

  let rank = 0;
  if (/\bshares of common stock\b/i.test(valueText)) rank += 3;
  if (/\b(?:this prospectus relates to|prospectus relates to|offered hereby|offer and resale|resale by|selling stockholders?|selling shareholders?|register(?:ing)?|up to)\b/i.test(evidence)) {
    rank += 5;
  }
  if (/\b(?:underlying|issuable upon|upon exercise|conversion|warrant|pre-funded)\b/i.test(evidence)) rank -= 2;
  if (index < 1_500) rank += 1;
  return rank;
}

function isGenericS3WarrantDescription(value?: string) {
  const text = compactText(value || "");
  if (!text) return false;
  return (
    /\b(?:we may issue|we may offer|may be issued|may be offered)\b[\s\S]{0,220}\bwarrants?\b/i.test(text) ||
    /\bapplicable prospectus supplement\b[\s\S]{0,220}\bwarrants?\b/i.test(text) ||
    /\bin the case of warrants?\b/i.test(text) ||
    /\bas the case may be\b[\s\S]{0,180}\bwarrants?\b/i.test(text)
  );
}

function buildS3OfferingTerms({
  currentSharesOutstanding,
  feeTableTotals,
  primaryOrResale,
  registrationStatementKind,
  resaleShareCount,
  securitiesRegistered,
  s3Text,
}: {
  currentSharesOutstanding: SecS3CountField | null;
  feeTableTotals: SecS3FeeTableTotals;
  primaryOrResale: SecS3Field | null;
  registrationStatementKind: SecS3Field | null;
  resaleShareCount: SecS3CountField | null;
  securitiesRegistered: SecS3Field[];
  s3Text: string;
}): SecS3OfferingTerms {
  const offeringType = findS3OfferingType({
    primaryOrResale,
    registrationStatementKind,
    securitiesRegistered,
    s3Text,
  });
  const atmProgramSize = findMoneyField(s3Text, [
    /\b(?:ATM Prospectus Supplement|equity distribution agreement|sales agreement)[^.\n]{0,360}?(?:up to|maximum aggregate offering price of)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
    /\b(?:up to|maximum aggregate offering price of)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)[^.\n]{0,360}?(?:ATM Prospectus Supplement|equity distribution agreement|sales agreement)\b/i,
  ]);
  const shelfCapacity = feeTableTotals.total_offering_amount;
  const offeringAmount =
    atmProgramSize ||
    (primaryOrResale?.value === "resale"
      ? findMoneyField(s3Text, [/\baggregate offering price\b[^.\n]{0,180}?(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i])
      : findMoneyField(s3Text, [
          /\b(?:aggregate offering price of|up to)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
        ])) ||
    shelfCapacity;
  const warrantCoverageCandidate = findSentenceField(s3Text, /\bwarrants?\s+to\s+purchase\b|\bwarrant shares\b/i);
  const warrantCoverage = isGenericS3WarrantDescription(warrantCoverageCandidate?.evidence)
    ? null
    : warrantCoverageCandidate;
  const conversionPrice = findPriceField(s3Text, [
    /\b(?:conversion price|initial conversion price|convertible at)\s*(?:of)?\s*(\$[\d,.]+)/i,
  ]);
  const securityType = securitiesRegistered[0] || null;
  const fields = [
    registrationStatementKind,
    offeringType,
    securityType,
    primaryOrResale,
    offeringAmount,
    shelfCapacity,
    atmProgramSize,
    resaleShareCount,
    currentSharesOutstanding,
    warrantCoverage,
    conversionPrice,
  ];

  return {
    registration_statement_kind: registrationStatementKind,
    offering_type: offeringType,
    security_type: securityType,
    primary_or_resale: primaryOrResale,
    offering_amount: offeringAmount,
    shelf_capacity: shelfCapacity,
    atm_program_size: atmProgramSize,
    resale_share_count: resaleShareCount,
    current_shares_outstanding: currentSharesOutstanding,
    warrant_coverage: warrantCoverage,
    conversion_price: conversionPrice,
    extracted_field_count: fields.filter(Boolean).length,
  };
}

function findS3OfferingType({
  primaryOrResale,
  registrationStatementKind,
  securitiesRegistered,
  s3Text,
}: {
  primaryOrResale: SecS3Field | null;
  registrationStatementKind: SecS3Field | null;
  securitiesRegistered: SecS3Field[];
  s3Text: string;
}): SecS3Field | null {
  const atm = field(
    "atm",
    s3Text,
    /\b(?:ATM Prospectus Supplement|equity distribution agreement|sales agreement)[^.\n]{0,420}?(?:at-the-market|at the market|offer and sell|offered and sold|common stock)\b/i,
    "high",
  );
  if (atm) return atm;

  const drip = field(
    "dividend_reinvestment_plan",
    s3Text,
    /\b(?:dividend reinvestment and stock purchase plan|dividend reinvestment plan|stock purchase plan)\b/i,
    "high",
  );
  if (drip) return drip;

  if (primaryOrResale?.value === "mixed") {
    return {
      value: "mixed_shelf",
      evidence: primaryOrResale.evidence,
      confidence: "medium",
    };
  }

  if (primaryOrResale?.value === "resale") {
    return {
      value: "resale_registration",
      evidence: primaryOrResale.evidence,
      confidence: primaryOrResale.confidence,
    };
  }

  const securities = new Set(securitiesRegistered.map((item) => item.value));
  const hasUniversalShelfText = /\b(?:unallocated\s+\(universal\)\s+shelf|universal shelf)\b/i.test(s3Text);
  const hasMultipleShelfSecurities =
    securities.size >= 3 ||
    (securities.has("common_stock") && (securities.has("preferred_stock") || securities.has("debt_securities")) && securities.has("warrants"));
  if (hasUniversalShelfText || hasMultipleShelfSecurities) {
    return {
      value: "universal_shelf",
      evidence: hasUniversalShelfText
        ? pickEvidenceSentence(s3Text, s3Text.search(/\b(?:unallocated\s+\(universal\)\s+shelf|universal shelf)\b/i))
        : "Registration covers multiple shelf security classes.",
      confidence: hasUniversalShelfText ? "high" : "medium",
    };
  }

  if (registrationStatementKind) {
    return {
      value: "shelf_registration",
      evidence: registrationStatementKind.evidence,
      confidence: registrationStatementKind.confidence,
    };
  }

  return null;
}

function buildS3CleanedSourceBlocks(text: string): SecS3CleanedSourceBlock[] {
  const sourceText = compactText(text);
  const blocks: SecS3CleanedSourceBlock[] = [];
  if (!sourceText) return blocks;

  addS3CleanedSourceBlock(blocks, {
    block_type: "selected_source_sentences",
    label: "Selected S-3/F-3 source sentences",
    source: "primary_document",
    text: extractS3SourceSentences(
      sourceText,
      [
        /\bat[- ]?the[- ]market offering\b/i,
        /\bRule\s*415\s*\(\s*a\s*\)\s*\(\s*4\s*\)\b/i,
        /\bsales agreement\b/i,
        /\bsales agent\b/i,
        /\b(?:Jefferies|Needham|Canaccord|B\.?\s*Riley|Cantor|H\.?\s*C\.?\s*Wainwright|TD Cowen)\b/i,
        /\bup to\s+\$[\d,.]+/i,
        /\bselling\s+(?:stockholders|shareholders|securityholders)\b/i,
        /\bwe will not receive any proceeds\b/i,
        /\bwe are offering\b/i,
        /\bpublic offering price\b/i,
        /\bgross proceeds\b/i,
        /\bnet proceeds\b/i,
        /\bunderwriters?\b/i,
        /\bGeneral Instruction I\.B\.6\b/i,
        /\bone-third of (?:our )?public float\b/i,
      ],
      18,
    ).join("\n"),
  });

  addS3SourceWindows(blocks, sourceText, {
    blockType: "share_count_basis_context",
    label: "Share count basis context",
    patterns: [
      /\bNumber\s+of\s+(?:Class\s+[A-Z]\s+)?(?:shares?|common\s+stock|ordinary\s+shares|ADSs?)\s+outstanding\s+(?:immediately\s+)?(?:before|prior\s+to|after)\s+(?:this|the)\s+(?:offering|transaction)\b/i,
      /\b(?:Class\s+[A-Z]\s+)?(?:shares?|common\s+stock|ordinary\s+shares|ADSs?)\s+outstanding\s+(?:immediately\s+)?(?:before|prior\s+to|after|as\s+of)\s+(?:this|the)?\s*(?:offering|transaction|date)?\b/i,
      /\b(?:issued\s+and\s+outstanding|shares?\s+outstanding|common\s+stock\s+outstanding|ordinary\s+shares\s+outstanding|ADSs?\s+outstanding)\b/i,
    ],
    limit: 3,
    before: 700,
    after: 2_200,
    preferActive: false,
  });

  addS3SourceWindows(blocks, sourceText, {
    blockType: "prospectus_supplement_context",
    label: "Prospectus supplement context",
    patterns: [
      /\bprospectus supplement\b/i,
      /\bpreliminary prospectus supplement\b/i,
      /\bsubject to completion\b/i,
    ],
    limit: 3,
    before: 1_200,
    after: 5_500,
    preferActive: true,
    minScore: 18,
  });

  addS3HeadingSectionBlock(blocks, sourceText, {
    headingPattern: /\bTHE OFFERING\b/i,
    label: "The Offering section",
    bodyPattern:
      /\b(?:we are offering|we may offer|offer and sell|selling stockholders?|at[- ]?the[- ]market|sales agreement|underwriter|public offering price|gross proceeds|net proceeds|purchase price|up to\s+\$)\b/i,
    limit: 2,
  });

  addS3HeadingSectionBlock(blocks, sourceText, {
    headingPattern: /\bPLAN OF DISTRIBUTION\b/i,
    label: "Plan of Distribution section",
    bodyPattern:
      /\b(?:sales agreement|sales agent|at[- ]?the[- ]market|Rule\s*415|underwriter|underwriting|selling stockholders?|broker|dealer|agent|Jefferies|Needham|Canaccord|B\.?\s*Riley|Cantor|H\.?\s*C\.?\s*Wainwright|TD Cowen)\b/i,
    limit: 2,
  });

  addS3HeadingSectionBlock(blocks, sourceText, {
    headingPattern: /\bUSE OF PROCEEDS\b/i,
    label: "Use of Proceeds section",
    bodyPattern:
      /\b(?:net proceeds|gross proceeds|working capital|general corporate purposes|research and development|debt repayment|repay(?:ment)?|we will not receive|no proceeds)\b/i,
    limit: 2,
  });

  addS3HeadingSectionBlock(blocks, sourceText, {
    headingPattern: /\bDOCUMENTS INCORPORATED BY REFERENCE\b/i,
    label: "Documents incorporated by reference section",
    bodyPattern:
      /\b(?:we incorporate by reference|documents listed below|annual report|quarterly report|current report|proxy statement|filed with the SEC|Exchange Act)\b/i,
    limit: 2,
  });

  addS3HeadingSectionBlock(blocks, sourceText, {
    headingPattern: /\bEXPERTS\b/i,
    label: "Experts and consents section",
    bodyPattern:
      /\b(?:independent registered public accounting firm|audited by|consent|Weaver|Tidwell|MKM Engineering|engineering consulting|reserves|Appraisal Report|experts in accounting|experts in petroleum)\b/i,
    limit: 2,
  });

  addS3SourceWindows(blocks, sourceText, {
    blockType: "active_atm_context",
    label: "ATM sales agreement context",
    patterns: [
      /\bat[- ]?the[- ]market offering\b/i,
      /\bRule\s*415\s*\(\s*a\s*\)\s*\(\s*4\s*\)\b/i,
      /\bsales agreement\b/i,
      /\bsales agent\b/i,
      /\bequity distribution agreement\b/i,
      /\b(?:Jefferies|Needham|Canaccord|B\.?\s*Riley|Cantor|H\.?\s*C\.?\s*Wainwright|TD Cowen)\b/i,
    ],
    limit: 4,
    before: 1_000,
    after: 4_800,
    preferActive: true,
    minScore: 34,
  });

  addS3HeadingSectionBlock(blocks, sourceText, {
    headingPattern: /\bSELLING\s+(?:STOCKHOLDERS|SHAREHOLDERS|SECURITYHOLDERS)\b/i,
    label: "Selling holder section",
    bodyPattern:
      /\b(?:shares offered|offered for resale|beneficially owned|selling stockholders?|selling shareholders?|selling securityholders?|resale|we will not receive any proceeds)\b/i,
    limit: 2,
  });

  addS3SourceWindows(blocks, sourceText, {
    blockType: "active_resale_context",
    label: "Resale registration context",
    patterns: [
      /\bselling\s+(?:stockholders|shareholders|securityholders)\b/i,
      /\bresale\b/i,
      /\breoffer\b/i,
      /\bwe will not receive any proceeds\b/i,
      /\bshares issuable upon exercise\b/i,
      /\bpre-funded warrants?\b/i,
      /\bcommon warrants?\b/i,
      /\bconvertible notes?\b/i,
      /\bconversion shares?\b/i,
    ],
    limit: 4,
    before: 900,
    after: 4_500,
    preferActive: true,
  });

  addS3HeadingSectionBlock(blocks, sourceText, {
    headingPattern: /\bUNDERWRITING\b/i,
    label: "Underwriting section",
    bodyPattern:
      /\b(?:underwriter|underwriting discounts?|public offering price|firm commitment|closing date|gross proceeds|net proceeds|purchase price)\b/i,
    limit: 2,
  });

  addS3SourceWindows(blocks, sourceText, {
    blockType: "active_takedown_context",
    label: "Priced or active takedown context",
    patterns: [
      /\bwe are offering\b/i,
      /\bpublic offering price\b/i,
      /\bunderwriting discounts?\b/i,
      /\bunderwriters?\b/i,
      /\bpurchase price\b/i,
      /\bgross proceeds\b/i,
      /\bnet proceeds\b/i,
      /\bclosing date\b/i,
      /\bfirm commitment\b/i,
    ],
    limit: 4,
    before: 900,
    after: 4_500,
    preferActive: true,
  });

  addS3SourceWindows(blocks, sourceText, {
    blockType: "base_shelf_context",
    label: "Base shelf context",
    patterns: [
      /\bfrom time to time\b/i,
      /\bdelayed or continuous basis\b/i,
      /\bRule\s*415\b/i,
      /\bcommon stock,\s*preferred stock,\s*debt securities,\s*warrants,\s*rights,\s*units\b/i,
      /\bGeneral Instruction I\.B\.6\b/i,
      /\bpublic float\b/i,
      /\bone-third of (?:our )?public float\b/i,
      /\bremaining capacity\b/i,
    ],
    limit: 4,
    before: 900,
    after: 4_000,
    preferActive: false,
  });

  addS3CleanedSourceBlock(blocks, {
    block_type: "primary_document_excerpt",
    label: "S-3/F-3 cover and filing context",
    source: "primary_document",
    text: sourceText.slice(0, 6_000),
  });

  return dedupeS3CleanedSourceBlocks(blocks).slice(0, 18);
}

function addS3SourceWindows(
  blocks: SecS3CleanedSourceBlock[],
  text: string,
  options: {
    blockType: string;
    label: string;
    patterns: RegExp[];
    limit: number;
    before: number;
    after: number;
    preferActive: boolean;
    minScore?: number;
  },
) {
  const candidates: Array<{ index: number; score: number; text: string }> = [];

  for (const pattern of options.patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(globalPattern)) {
      const index = match.index ?? -1;
      if (index < 0) continue;
      const start = Math.max(0, index - options.before);
      const end = Math.min(text.length, index + options.after);
      const window = text.slice(start, end);
      if (isS3TocLikeWindow(window)) continue;
      const score = scoreS3SourceWindow(window, options.preferActive);
      if (typeof options.minScore === "number" && score < options.minScore) continue;
      candidates.push({
        index,
        score,
        text: window,
      });
    }
  }

  const seenRanges: Array<{ start: number; end: number }> = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const start = Math.max(0, candidate.index - options.before);
    const end = Math.min(text.length, candidate.index + options.after);
    const overlaps = seenRanges.some((range) => start <= range.end && end >= range.start);
    if (overlaps) continue;
    seenRanges.push({ start, end });
    addS3CleanedSourceBlock(blocks, {
      block_type: options.blockType,
      label: options.label,
      source: "primary_document",
      text: candidate.text,
    });
    if (seenRanges.length >= options.limit) return;
  }
}

function addS3HeadingSectionBlock(
  blocks: SecS3CleanedSourceBlock[],
  text: string,
  options: {
    headingPattern: RegExp;
    label: string;
    bodyPattern: RegExp;
    limit: number;
  },
) {
  const candidates: Array<{ index: number; score: number; text: string }> = [];
  const nextHeadingPattern =
    /\b(?:RISK FACTORS|DIVIDEND POLICY|CAPITALIZATION|DILUTION|SELLING (?:STOCKHOLDERS|SHAREHOLDERS|SECURITYHOLDERS)|DESCRIPTION OF (?:SECURITIES|CAPITAL STOCK|DEBT SECURITIES|WARRANTS|RIGHTS|UNITS)|PLAN OF DISTRIBUTION|UNDERWRITING|USE OF PROCEEDS|LEGAL MATTERS|EXPERTS|WHERE YOU CAN FIND|INCORPORATION OF CERTAIN DOCUMENTS|MATERIAL U\.S\. FEDERAL INCOME TAX)\b/i;
  const flags = options.headingPattern.flags.includes("g") ? options.headingPattern.flags : `${options.headingPattern.flags}g`;
  const globalPattern = new RegExp(options.headingPattern.source, flags);

  for (const match of text.matchAll(globalPattern)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const afterHeading = text.slice(index + match[0].length, index + match[0].length + 2_400);
    if (!options.bodyPattern.test(afterHeading)) continue;
    const initialWindow = text.slice(index, Math.min(text.length, index + 7_000));
    if (isS3TocLikeWindow(initialWindow)) continue;
    const remaining = text.slice(index + match[0].length + 400);
    const nextHeading = remaining.search(nextHeadingPattern);
    const end = nextHeading >= 0 ? index + match[0].length + 400 + nextHeading : Math.min(text.length, index + 7_000);
    const sectionText = text.slice(index, end);
    candidates.push({
      index,
      score: scoreS3SourceWindow(sectionText, true),
      text: sectionText,
    });
  }

  const seenStarts = new Set<number>();
  for (const candidate of candidates.sort((a, b) => b.score - a.score || a.index - b.index)) {
    const roundedStart = Math.floor(candidate.index / 1_000);
    if (seenStarts.has(roundedStart)) continue;
    seenStarts.add(roundedStart);
    addS3CleanedSourceBlock(blocks, {
      block_type: "source_section_excerpt",
      label: options.label,
      source: "primary_document",
      text: candidate.text,
    });
    if (seenStarts.size >= options.limit) return;
  }
}

function addS3CleanedSourceBlock(blocks: SecS3CleanedSourceBlock[], block: SecS3CleanedSourceBlock) {
  const text = compactText(block.text);
  if (!text || text.length < 80) return;
  blocks.push({
    ...block,
    text: text.length > 12_000 ? `${text.slice(0, 11_997).trim()}...` : text,
  });
}

function extractS3SourceSentences(text: string, patterns: RegExp[], limit: number) {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map(compactText)
    .filter((sentence) => sentence.length >= 40 && !isTocLine(sentence));
  const candidates: Array<{ sentence: string; score: number; index: number }> = [];

  for (const [index, sentence] of sentences.entries()) {
    if (!patterns.some((pattern) => pattern.test(sentence))) continue;
    candidates.push({
      sentence,
      score: scoreS3SourceSentence(sentence),
      index,
    });
  }

  const seen = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((candidate) => candidate.sentence)
    .filter((sentence) => {
      const key = sentence.slice(0, 180).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((sentence) => truncate(sentence, 900));
}

function scoreS3SourceSentence(value: string) {
  let score = scoreS3SourceWindow(value, true);
  if (/\b(?:Jefferies|Needham|Canaccord|B\.?\s*Riley|Cantor|H\.?\s*C\.?\s*Wainwright|TD Cowen)\b/i.test(value)) score += 20;
  if (/\bup to\s+\$[\d,.]+/i.test(value)) score += 14;
  if (/\bRule\s*415\s*\(\s*a\s*\)\s*\(\s*4\s*\)\b/i.test(value)) score += 14;
  if (/\bSale Agreement\b/i.test(value)) score += 12;
  if (/\bcommon stock,\s*preferred stock,\s*debt securities,\s*warrants,\s*rights,\s*units\b/i.test(value)) score -= 10;
  if (/\bapplicable prospectus supplement\b/i.test(value) && !/\b(?:at[- ]?the[- ]market|sales agreement|selling stockholders?|we are offering)\b/i.test(value)) score -= 8;
  return score;
}

function dedupeS3CleanedSourceBlocks(blocks: SecS3CleanedSourceBlock[]) {
  const seen = new Set<string>();
  const result: SecS3CleanedSourceBlock[] = [];
  for (const block of blocks) {
    const key = compactText(block.text).slice(0, 800).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(block);
  }
  return result;
}

function scoreS3SourceWindow(value: string, preferActive: boolean) {
  const text = compactText(value);
  let score = 0;
  if (/\bprospectus supplement\b/i.test(text)) score += 8;
  if (/\bat[- ]?the[- ]market offering\b|\bRule\s*415\s*\(\s*a\s*\)\s*\(\s*4\s*\)\b/i.test(text)) score += 16;
  if (/\bsales agreement\b|\bsales agent\b|\bequity distribution agreement\b/i.test(text)) score += 14;
  if (/\b(?:Jefferies|Needham|Canaccord|B\.?\s*Riley|Cantor|H\.?\s*C\.?\s*Wainwright|TD Cowen)\b/i.test(text)) score += 8;
  if (/\bselling\s+(?:stockholders|shareholders|securityholders)\b|\bresale\b|\breoffer\b/i.test(text)) score += 12;
  if (/\bwe will not receive any proceeds\b|\bshares issuable upon exercise\b|\bpre-funded warrants?\b|\bconversion shares?\b/i.test(text)) score += 8;
  if (/\bwe are offering\b|\bpublic offering price\b|\bunderwriting discounts?\b|\bunderwriters?\b|\bgross proceeds\b|\bnet proceeds\b|\bclosing date\b/i.test(text)) score += 12;
  if (/\bup to\s+\$[\d,.]+/i.test(text)) score += 6;
  if (/\bGeneral Instruction I\.B\.6\b|\bone-third of (?:our )?public float\b|\bpublic float\b/i.test(text)) score += 5;
  if (/\bcommon stock,\s*preferred stock,\s*debt securities,\s*warrants,\s*rights,\s*units\b/i.test(text)) score += preferActive ? -3 : 6;
  if (isS3TocLikeWindow(text)) score -= 20;
  return score;
}

function isS3TocLikeWindow(value: string) {
  const text = compactText(value).slice(0, 1_500);
  if (!text) return false;
  const tocSignals = (text.match(/\b(?:TABLE OF CONTENTS|S-\d+|PROSPECTUS SUMMARY|RISK FACTORS|LEGAL MATTERS|EXPERTS)\b/gi) || []).length;
  if (/\b(?:PLAN OF DISTRIBUTION|THE OFFERING|USE OF PROCEEDS)\s*\|\s*\|/i.test(text)) return true;
  if ((text.match(/\|/g) || []).length >= 8 && /\b(?:LEGAL MATTERS|EXPERTS|RISK FACTORS|TABLE OF CONTENTS)\b/i.test(text)) return true;
  const bodySignals = /\b(?:we have entered|we are offering|we may offer and sell|we will not receive|sales agreement|at[- ]?the[- ]market|gross proceeds|net proceeds|selling stockholders? may offer)\b/i.test(
    text,
  );
  return tocSignals >= 5 && !bodySignals;
}

type SellingStockholderBaseRow = {
  holderName: string;
  footnoteId: string | null;
  ownedBefore: string | null;
  offeredForResale: string | null;
  ownedAfter: string | null;
  percentAfter: string | null;
  addressHint: string | null;
  evidence: string;
};

function parseSellingStockholders(sectionText: string, contextText = ""): SecS3SellingStockholderRow[] {
  const section = compactText(sectionText);
  if (!section) return [];

  const baseRows = parseSplitSellingStockholderRows(section);
  if (!baseRows.length) return [];

  const footnotes = parseSellingStockholderFootnotes(section);
  const sectionCaps = parseBeneficialOwnershipCaps(section);
  const contextCaps = parseBeneficialOwnershipCaps(contextText);

  return baseRows.map((row) => {
    const footnote = row.footnoteId ? footnotes.get(row.footnoteId) || "" : "";
    const includedText = splitFootnoteShareText(footnote).included;
    const excludedText = splitFootnoteShareText(footnote).excluded;
    const footnoteCaps = parseBeneficialOwnershipCaps(footnote);
    const ownershipCaps = uniquePercentFields([...footnoteCaps, ...sectionCaps, ...contextCaps]);

    return {
      holder_name: row.holderName,
      footnote_id: row.footnoteId,
      beneficially_owned_before: countFieldFromCell(row.ownedBefore, row.evidence),
      shares_offered_for_resale: countFieldFromCell(row.offeredForResale, row.evidence),
      beneficially_owned_after: countFieldFromCell(row.ownedAfter, row.evidence),
      percent_after: percentFieldFromCell(row.percentAfter, row.evidence),
      beneficial_ownership_caps: ownershipCaps,
      source_components: parseSellingStockholderComponents(includedText),
      excluded_shares: parseSellingStockholderComponents(excludedText),
      control_persons: extractControlPersons(footnote),
      address: extractStockholderAddress(footnote) || row.addressHint,
      footnote_excerpt: footnote ? truncate(footnote, 700) : null,
      evidence: truncate(row.evidence, 700),
      confidence: row.ownedBefore && row.offeredForResale ? "high" : "medium",
    };
  });
}

function parseSplitSellingStockholderRows(section: string): SellingStockholderBaseRow[] {
  const lines = section.split(/\n/).map((line) => compactText(line)).filter(Boolean);
  const rows: SellingStockholderBaseRow[] = [];
  const nameBuffer: string[] = [];
  let inTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = cleanSellingTableLine(rawLine);
    if (!line) continue;

    if (isSellingStockholdersHeaderAt(lines, index)) {
      inTable = true;
      nameBuffer.length = 0;
      continue;
    }
    if (!inTable) continue;

    const pipedRow = parsePipedSellingStockholderRow(rawLine);
    if (pipedRow) {
      rows.push(pipedRow);
      nameBuffer.length = 0;
      continue;
    }

    const inlineRow = parseInlineSellingStockholderRow(line);
    if (inlineRow) {
      rows.push(inlineRow);
      nameBuffer.length = 0;
      continue;
    }

    const rowName = line.match(/^(.+?)\s+\((\d+[A-Za-z]?)\)$/);
    const rowFootnoteOnly = line.match(/^\((\d+[A-Za-z]?)\)$/);
    if (rowName || (rowFootnoteOnly && nameBuffer.length)) {
      const holderName = rowName ? compactText([...nameBuffer, rowName[1]].join(" ")) : compactText(nameBuffer.join(" "));
      const footnoteId = rowName ? rowName[2] : rowFootnoteOnly?.[1] || null;
      if (!isPotentialSellingStockholderNameFragment(holderName)) {
        nameBuffer.length = 0;
        continue;
      }
      nameBuffer.length = 0;
      const cells = collectSellingStockholderCells(lines, index + 1);
      if (holderName && cells.values.length >= 3) {
        rows.push(buildSellingStockholderBaseRow({
          holderName,
          footnoteId,
          values: cells.values,
          addressHint: null,
          evidence: lines.slice(index - 1, cells.lastIndex + 1).join("\n"),
        }));
        index = cells.lastIndex;
      }
      continue;
    }

    const firstCell = readSellingStockholderNumericCell(line);
    if (firstCell && nameBuffer.length) {
      const holderName = nameBuffer[0];
      const addressHint = compactText(nameBuffer.slice(1).join(", ")) || null;
      nameBuffer.length = 0;
      const cells = collectSellingStockholderCells(lines, index);
      if (holderName && cells.values.length >= 3) {
        rows.push(buildSellingStockholderBaseRow({
          holderName,
          footnoteId: null,
          values: cells.values,
          addressHint,
          evidence: lines.slice(Math.max(0, index - 8), cells.lastIndex + 1).join("\n"),
        }));
        index = cells.lastIndex;
      }
      continue;
    }

    if (isSellingStockholderFootnoteStart(line)) break;
    if (isSellingStockholderTableNoise(line)) continue;

    if (isPotentialSellingStockholderNameFragment(line)) {
      nameBuffer.push(line);
      if (nameBuffer.length > 20) nameBuffer.splice(1, nameBuffer.length - 20);
    }
  }

  return rows;
}

function parsePipedSellingStockholderRow(line: string): SellingStockholderBaseRow | null {
  if (!line.includes("|")) return null;

  const cells = line
    .split("|")
    .map(cleanSellingTableLine)
    .filter(Boolean);
  if (cells.length < 4) return null;

  const holderCell = cells[0];
  if (!/[A-Za-z]/.test(holderCell) || isSellingStockholderTableNoise(holderCell)) return null;

  const footnoteMatch = holderCell.match(/^(.*?)\s+\(?(\d+[A-Za-z]?)\)?$/);
  const holderName = compactText(footnoteMatch?.[1] || holderCell);
  const footnoteId = footnoteMatch?.[2] || null;
  if (!isPotentialSellingStockholderNameFragment(holderName)) return null;

  const values = cells.slice(1).map(readSellingStockholderNumericCell).filter((cell): cell is string => Boolean(cell));
  if (values.length < 3) return null;

  return buildSellingStockholderBaseRow({
    holderName,
    footnoteId,
    values,
    addressHint: null,
    evidence: line,
  });
}

function parseInlineSellingStockholderRow(line: string): SellingStockholderBaseRow | null {
  const cells = [
    ...line.matchAll(/(?:\(?\d+[A-Za-z]?\)?|\d[\d,]*(?:\.\d+)?\s*%?|<\s*1\s*%|less than one percent|less than 1%|--|-|\*)/gi),
  ];
  if (cells.length < 3) return null;

  const firstCell = cells[0];
  const firstCellIndex = firstCell.index ?? -1;
  if (firstCellIndex <= 2) return null;

  const holderText = compactText(line.slice(0, firstCellIndex));
  if (!holderText || !/[A-Za-z]/.test(holderText) || isSellingStockholderTableNoise(holderText)) return null;

  const footnoteMatch = holderText.match(/^(.*?)\s+\((\d+[A-Za-z]?)\)$/);
  const holderName = compactText(footnoteMatch?.[1] || holderText);
  const footnoteId = footnoteMatch?.[2] || null;
  const values = cells
    .map((cell) => cleanSellingTableLine(cell[0]))
    .filter((cell) => !isFootnoteToken(cell));
  if (values.length < 3) return null;

  return buildSellingStockholderBaseRow({
    holderName,
    footnoteId,
    values,
    addressHint: null,
    evidence: line,
  });
}

function buildSellingStockholderBaseRow({
  addressHint,
  evidence,
  footnoteId,
  holderName,
  values,
}: {
  addressHint: string | null;
  evidence: string;
  footnoteId: string | null;
  holderName: string;
  values: string[];
}): SellingStockholderBaseRow {
  const hasPriorOwnershipPercent = isPercentCell(values[1]);
  return {
    holderName,
    footnoteId,
    ownedBefore: values[0] || null,
    offeredForResale: hasPriorOwnershipPercent ? values[2] || null : values[1] || null,
    ownedAfter: hasPriorOwnershipPercent ? values[3] || null : values[2] || null,
    percentAfter: hasPriorOwnershipPercent ? values[4] || null : values[3] || null,
    addressHint,
    evidence,
  };
}

function collectSellingStockholderCells(lines: string[], startIndex: number): { values: string[]; lastIndex: number } {
  const values: string[] = [];
  let lastIndex = startIndex - 1;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = cleanSellingTableLine(lines[index]);
    if (!line) continue;
    if (isSellingStockholderFootnoteStart(line)) break;
    if (isPotentialSellingStockholderNameFragment(line) && values.length >= 3) break;
    const cell = readSellingStockholderNumericCell(line);
    if (!cell) continue;
    values.push(cell);
    lastIndex = index;
    if (values.length >= 5) break;
  }
  return { values, lastIndex };
}

function parseSellingStockholderFootnotes(section: string) {
  const lines = section.split(/\n/).map((line) => compactText(line)).filter(Boolean);
  const footnotes = new Map<string, string>();
  let activeId: string | null = null;
  let chunks: string[] = [];

  const flush = () => {
    if (!activeId) return;
    const text = compactText(chunks.join(" "));
    if (text) footnotes.set(activeId, text);
  };

  for (const rawLine of lines) {
    const line = cleanSellingFootnoteLine(rawLine);
    const start = line.match(/^\((\d+[A-Za-z]?)\)\s*(.*)$/);
    if (start) {
      flush();
      activeId = start[1];
      chunks = [start[2]];
      continue;
    }
    if (!activeId) continue;
    if (isHardSectionHeading(line)) break;
    chunks.push(line);
  }
  flush();

  return footnotes;
}

function parseSellingStockholderComponents(text: string): SecS3SellingStockholderComponent[] {
  const components: SecS3SellingStockholderComponent[] = [];
  const source = compactText(text);
  if (!source) return components;

  for (const part of source.split(/;\s+|\.\s+/)) {
    const evidence = compactText(part);
    if (!evidence || !/\bshares?\b/i.test(evidence)) continue;
    const match = evidence.match(/\b(\d[\d,.]*)\s+((?:shares of common stock|common shares|ordinary shares|first warrant shares|second warrant shares|warrant shares|shares)[^;.]*)/i);
    if (!match) continue;
    if (isLikelyTrancheOrdinalShareFalsePositive(evidence, match.index || 0, match[1])) continue;
    const shareText = `${match[1]} shares`;
    const amountText = evidence.match(/\$\s*\d[\d,.]*/)?.[0] || "";
    components.push({
      component_type: inferSellingStockholderComponentType(evidence),
      shares: {
        value: normalizeShareCount(shareText),
        text: shareText,
        evidence: truncate(evidence, 420),
        confidence: "medium",
      },
      amount: amountText
        ? {
            value: normalizeMoney(amountText),
            text: amountText,
            evidence: truncate(evidence, 420),
            confidence: "medium",
          }
        : null,
      text: truncate(match[2], 240),
      evidence: truncate(evidence, 420),
    });
  }

  return components;
}

function isLikelyTrancheOrdinalShareFalsePositive(evidence: string, index: number, valueText: string) {
  const value = normalizeShareCount(valueText);
  if (value === null || value >= 100) return false;
  const before = evidence.slice(Math.max(0, index - 24), index + valueText.length + 32);
  return /\b(?:tranche|series)\s+[A-Z]-\d+\s+warrant\s+shares?\b/i.test(before);
}

function parseBeneficialOwnershipCaps(text: string): SecS3PercentField[] {
  const caps: SecS3PercentField[] = [];
  const source = compactText(text);
  if (!source) return caps;
  const ownershipPhrase = /\b(?:beneficial ownership|beneficially own|ownership limitation|beneficial ownership limitation|blocker|cap|limitations?)\b/i;
  const sentences = source.split(/(?<=\.)\s+|\n+/).map((sentence) => compactText(sentence)).filter(Boolean);
  for (const sentence of sentences) {
    if (!ownershipPhrase.test(sentence)) continue;
    const matches = sentence.matchAll(/\b(\d{1,2}(?:\.\d+)?)\s*%/g);
    for (const match of matches) {
      const valueText = `${match[1]}%`;
      caps.push({
        value: normalizePercent(valueText),
        text: valueText,
        evidence: truncate(sentence, 420),
        confidence: "medium",
      });
    }
  }
  return uniquePercentFields(caps);
}

function splitFootnoteShareText(footnote: string) {
  const match = footnote.match(/\b(?:does not include|excludes?)\b/i);
  if (!match) return { included: footnote, excluded: "" };
  return {
    included: footnote.slice(0, match.index),
    excluded: footnote.slice(match.index),
  };
}

function countFieldFromCell(value: string | null, evidence: string): SecS3CountField | null {
  if (!value || isPlaceholderCell(value)) return null;
  return {
    value: normalizeShareCount(value),
    text: value,
    evidence: truncate(evidence, 420),
    confidence: "high",
  };
}

function percentFieldFromCell(value: string | null, evidence: string): SecS3PercentField | null {
  if (!value || isPlaceholderCell(value)) return null;
  return {
    value: normalizePercent(value),
    text: value.includes("%") ? value : `${value}%`,
    evidence: truncate(evidence, 420),
    confidence: "high",
  };
}

function cleanSellingTableLine(value: string) {
  return compactText(value)
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSellingFootnoteLine(value: string) {
  return compactText(value)
    .replace(/^\|\s*/, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readSellingStockholderNumericCell(value: string) {
  const text = compactText(value).replace(/\s+/g, " ");
  if (isPlaceholderCell(text)) return text;
  if (/^(?:<\s*1\s*%|less than one percent|less than 1%)$/i.test(text)) return "less than 1%";
  if (/^\d[\d,]*(?:\.\d+)?\s*%?$/.test(text)) return text.includes("%") ? text : text;
  if (/^\d[\d,]*(?:\.\d+)?\s+%$/.test(text)) return text.replace(/\s+%$/, "%");
  return null;
}

function isPercentCell(value: string | null | undefined) {
  return Boolean(value && /%$/.test(value.replace(/\s+/g, "")));
}

function isPlaceholderCell(value: string | null | undefined) {
  if (/^(?:\*|N\/A)$/i.test(stringValue(value))) return true;
  return /^(?:-|--|—|–|\*)$/.test(stringValue(value));
}

function isSellingStockholdersHeaderAt(lines: string[], index: number) {
  const windowText = lines
    .slice(index, Math.min(lines.length, index + 10))
    .map(cleanSellingTableLine)
    .filter(Boolean)
    .join(" ");

  return hasSellingStockholderTableHeader(windowText);
}

function hasSellingStockholderTableHeader(value: string) {
  const text = cleanSellingTableLine(value);
  const hasHolderHeader =
    /\bName\s+of\s+Selling\b[\s\S]{0,120}\b(?:Stockholder|Shareholder)s?\b/i.test(text) ||
    /\bSelling\s+(?:Stockholder|Shareholder)s?\b[\s\S]{0,120}\bName\b/i.test(text);
  if (!hasHolderHeader) return false;

  return /\b(?:beneficially\s+owned|owned\s+(?:prior|before|after)|maximum\s+number\s+of\s+shares|shares?\s+(?:to\s+be\s+)?(?:sold|offered|resold)|offered\s+for\s+resale|pursuant\s+to\s+this\s+prospectus)\b/i.test(
    text,
  );
}

function isSellingStockholderFootnoteStart(value: string) {
  return /^\*?\s*$/.test(value) || /^\(?\d+[A-Za-z]?\)?(?:\s|$)/.test(value);
}

function isSellingStockholderTableNoise(value: string) {
  if (/^\|+$/.test(value)) return true;
  if (/^(?:Name|Shares|of|Common|Stock|Stockholder|Stockholders|Shareholder|Shareholders|Maximum|Number|Private|Placement|Immediately|Following|Beneficially|Owned|Prior to|the|Sale of the Private|Being Offered|Offered|for|Resale|for Resale|Offering|Number|Percentage)$/i.test(value)) {
    return true;
  }
  if (/\b(?:Name of Selling|Number of shares|Shares of Common Stock|Common Stock Beneficially Owned|common stock owned|stock owned prior|stock owned after|stock to be sold|pursuant to this Prospectus|Beneficially Owned|Maximum Number|Offered for Resale|Percentage)\b/i.test(value)) {
    return true;
  }
  return false;
}

function isPotentialSellingStockholderNameFragment(value: string) {
  if (!/[A-Za-z]/.test(value)) return false;
  if (isSellingStockholderTableNoise(value)) return false;
  if (isHardSectionHeading(value)) return false;
  if (/^\d[\d,.]*\s*%?$/.test(value)) return false;
  if (/^(?:less than one percent|represents less than one percent)/i.test(value)) return false;
  return value.length <= 140;
}

function inferSellingStockholderComponentType(value: string) {
  if (/\bdoes not include|excludes?\b/i.test(value)) return "excluded_shares";
  if (/\bwarrants?\b/i.test(value)) return "warrant_shares";
  if (/\bpreferred\b/i.test(value)) return "preferred_conversion_shares";
  if (/\bnote\b|\bconversion\b/i.test(value)) return "note_conversion_shares";
  if (/\bcommon stock\b|\bcommon shares\b/i.test(value)) return "common_shares";
  return null;
}

function extractControlPersons(text: string) {
  return compactText(text)
    .split(/\.\s+/)
    .map((sentence) => compactText(sentence))
    .filter((sentence) => /\b(?:investment manager|adviser|discretionary authority|voting power|dispositive power|may be deemed|managing member|general partner)\b/i.test(sentence))
    .map((sentence) => truncate(sentence, 260))
    .slice(0, 4);
}

function extractStockholderAddress(text: string) {
  const match = compactText(text).match(/\b(?:address|principal business address)[^.\n]{0,80}?\bis\s+([^.;]+(?:[, ][^.;]+){0,6})/i);
  return match?.[1] ? truncate(match[1], 220) : null;
}

function uniquePercentFields(fields: SecS3PercentField[]) {
  const seen = new Set<string>();
  const unique: SecS3PercentField[] = [];
  for (const field of fields) {
    const key = field.text;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(field);
  }
  return unique;
}

function parseS3FeeTable(text: string): { rows: SecS3FeeTableRow[]; totals: SecS3FeeTableTotals } {
  const normalized = normalizeFeeTableText(text);
  if (!normalized) {
    return {
      rows: [],
      totals: emptyFeeTableTotals(),
    };
  }

  const tokens = tokenizeFeeTable(normalized);
  const rows: SecS3FeeTableRow[] = [];
  let registrationCategory: string | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^(?:Newly Registered Securities|Carry Forward Securities|Fees Previously Paid)$/i.test(token)) {
      registrationCategory = token;
      continue;
    }

    if (!/^Fees to be Paid$/i.test(token)) continue;

    const rowStart = index;
    let cursor = index + 1;
    while (isFootnoteToken(readToken(tokens, cursor))) cursor += 1;

    const firstValue = readToken(tokens, cursor);
    let securityType: string | null = null;
    let securityClassTitle: string | null = null;
    let feeCalculationRule: string | null = null;
    if (isFeeSecurityType(firstValue)) {
      securityType = firstValue;
      cursor += 1;
      const classAndRule = readSecurityClassAndFeeRule(tokens, cursor);
      securityClassTitle = classAndRule.securityClassTitle;
      cursor = classAndRule.nextIndex;
      feeCalculationRule = classAndRule.feeCalculationRule;
    } else {
      const classAndRule = readSecurityClassAndFeeRule(tokens, cursor);
      securityClassTitle = classAndRule.securityClassTitle;
      cursor = classAndRule.nextIndex;
      feeCalculationRule = classAndRule.feeCalculationRule;
    }

    while (isFootnoteToken(readToken(tokens, cursor))) cursor += 1;
    if (!feeCalculationRule) {
      const rule = readFeeCalculationRule(tokens, cursor);
      feeCalculationRule = rule.value;
      cursor = rule.nextIndex;
    }

    const amountRegistered = readAmountRegistered(tokens, cursor);
    cursor = amountRegistered.nextIndex;
    const proposedMaximumOfferingPricePerUnit = readPrice(tokens, cursor);
    cursor = proposedMaximumOfferingPricePerUnit.nextIndex;
    const maximumAggregateOfferingPrice = readMoney(tokens, cursor, true);
    cursor = maximumAggregateOfferingPrice.nextIndex;
    const feeRateCandidate = numberFromText(readToken(tokens, cursor));
    const feeRate = feeRateCandidate !== null && feeRateCandidate > 0 && feeRateCandidate < 1 ? feeRateCandidate : null;
    if (feeRate !== null) cursor += 1;
    const registrationFee = readMoney(tokens, cursor);

    if (!securityType && !securityClassTitle && !amountRegistered.field) continue;

    rows.push({
      registration_category: registrationCategory,
      fee_payment_type: token,
      security_type: securityType,
      security_class_title: securityClassTitle,
      fee_calculation_rule: feeCalculationRule || null,
      amount_registered: amountRegistered.field,
      proposed_maximum_offering_price_per_unit: proposedMaximumOfferingPricePerUnit.field,
      maximum_aggregate_offering_price: maximumAggregateOfferingPrice.field,
      fee_rate: feeRate,
      registration_fee: registrationFee.field,
      evidence: tokens.slice(rowStart, Math.min(tokens.length, registrationFee.nextIndex)).join(" | "),
    });
  }

  return {
    rows,
    totals: parseFeeTableTotals(tokens),
  };
}

function normalizeFeeTableText(text: string) {
  return compactText(text)
    .replace(/&#160;|&nbsp;/gi, " ")
    .replace(/&#36;/g, "$")
    .replace(/\u00a0/g, " ");
}

function tokenizeFeeTable(text: string) {
  return text
    .split(/\n+|\|/)
    .map((value) => compactText(value).replace(/:$/, ""))
    .filter((value) => value && value !== "N/A")
    .filter((value) => !/^iso4217:|^xbrli:/i.test(value));
}

function parseFeeTableTotals(tokens: string[]): SecS3FeeTableTotals {
  return {
    total_offering_amount: readTotalMoney(tokens, /^Total Offering Amounts$/i),
    total_fees_previously_paid: readTotalMoney(tokens, /^Total Fees Previously Paid$/i),
    total_fee_offsets: readTotalMoney(tokens, /^Total Fee Offsets$/i),
    net_fee_due: readTotalMoney(tokens, /^Net Fee Due$/i),
  };
}

function readTotalMoney(tokens: string[], labelPattern: RegExp) {
  const index = tokens.findIndex((token) => labelPattern.test(token));
  if (index < 0) return null;
  for (let cursor = index + 1; cursor < Math.min(tokens.length, index + 8); cursor += 1) {
    if (/^(?:Total Offering Amounts|Total Fees Previously Paid|Total Fee Offsets|Net Fee Due)$/i.test(tokens[cursor])) {
      break;
    }
    const money = readMoney(tokens, cursor);
    if (money.field) return money.field;
  }
  return null;
}

function readSecurityClassAndFeeRule(tokens: string[], index: number): {
  securityClassTitle: string | null;
  feeCalculationRule: string | null;
  nextIndex: number;
} {
  const titleParts: string[] = [];
  let cursor = index;

  while (cursor < tokens.length) {
    while (isFootnoteToken(readToken(tokens, cursor))) cursor += 1;

    const rule = readFeeCalculationRule(tokens, cursor);
    if (rule.value) {
      return {
        securityClassTitle: compactText(titleParts.join(" ")) || null,
        feeCalculationRule: rule.value,
        nextIndex: rule.nextIndex,
      };
    }

    const token = readToken(tokens, cursor);
    if (!token || /^Fees to be Paid$/i.test(token) || /^Total Offering Amounts$/i.test(token)) break;
    if (!isPlaceholderToken(token)) titleParts.push(token);
    cursor += 1;
  }

  return {
    securityClassTitle: compactText(titleParts.join(" ")) || null,
    feeCalculationRule: null,
    nextIndex: cursor,
  };
}

function readFeeCalculationRule(tokens: string[], index: number): { value: string | null; nextIndex: number } {
  const token = readToken(tokens, index);
  const nextToken = readToken(tokens, index + 1);
  const combined = compactText(`${token} ${nextToken}`);

  if (/^Rule$/i.test(token) && /^457\b/i.test(nextToken)) {
    return { value: compactFeeCalculationRule(combined), nextIndex: index + 2 };
  }
  if (/^(?:Rule\s*)?457\b/i.test(token) || /^Other$/i.test(token)) {
    return { value: compactFeeCalculationRule(token), nextIndex: index + 1 };
  }
  return { value: null, nextIndex: index };
}

function compactFeeCalculationRule(value: string) {
  return compactText(value).replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
}

function readAmountRegistered(tokens: string[], index: number): {
  field: SecS3CountField | SecS3MoneyField | null;
  nextIndex: number;
} {
  const token = readToken(tokens, index);
  if (isPlaceholderToken(token) || isFootnoteToken(token)) return { field: null, nextIndex: index + 1 };

  const money = readMoney(tokens, index);
  if (money.field) return money;

  const count = normalizeShareCount(token);
  if (count === null) return { field: null, nextIndex: index };
  return {
    field: {
      value: count,
      text: token,
      evidence: token,
      confidence: "high",
    },
    nextIndex: index + 1,
  };
}

function readMoney(tokens: string[], index: number, allowBare = false): { field: SecS3MoneyField | null; nextIndex: number } {
  const token = readToken(tokens, index);
  if (isPlaceholderToken(token) || isFootnoteToken(token)) return { field: null, nextIndex: index + 1 };
  const nextToken = readToken(tokens, index + 1);
  const text = token === "$" ? `$${nextToken}` : token;
  if (!/^\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?$/i.test(text)) {
    return { field: null, nextIndex: index };
  }
  if (!allowBare && token !== "$" && !text.includes("$") && index > 0 && readToken(tokens, index - 1) !== "$") {
    return { field: null, nextIndex: index };
  }
  const moneyText = allowBare && !text.includes("$") ? `$${text}` : text;
  const normalized = normalizeMoney(moneyText);
  if (allowBare && !text.includes("$") && normalized.amount !== null && normalized.amount < 1) {
    return { field: null, nextIndex: index };
  }
  return {
    field: {
      value: normalized,
      text: moneyText,
      evidence: moneyText,
      confidence: "high",
    },
    nextIndex: token === "$" ? index + 2 : index + 1,
  };
}

function readPrice(tokens: string[], index: number): { field: SecS3PriceField | null; nextIndex: number } {
  const token = readToken(tokens, index);
  if (isPlaceholderToken(token) || isFootnoteToken(token)) return { field: null, nextIndex: index + 1 };
  const nextToken = readToken(tokens, index + 1);
  const text = token === "$" ? `$${nextToken}` : token;
  const price = normalizePrice(text);
  if (!/^\$?\s*\d[\d,.]*$/.test(text) || price === null || (!text.includes("$") && price < 1)) {
    return { field: null, nextIndex: index };
  }
  return {
    field: {
      value: {
        price,
        currency: text.includes("$") ? "USD" : null,
      },
      text,
      evidence: text,
      confidence: "high",
    },
    nextIndex: token === "$" ? index + 2 : index + 1,
  };
}

function readToken(tokens: string[], index: number) {
  return tokens[index] || "";
}

function isFeeSecurityType(value: string) {
  return /^(?:Equity|Debt|Other|Unallocated|Asset-Backed Securities)$/i.test(value);
}

function isFootnoteToken(value: string) {
  return /^\(?\d+[A-Za-z]?\)?$/.test(stringValue(value));
}

function isPlaceholderToken(value: string) {
  return /^(?:—|-|--|N\/A|\*)$/i.test(stringValue(value));
}

function emptyFeeTableTotals(): SecS3FeeTableTotals {
  return {
    total_offering_amount: null,
    total_fees_previously_paid: null,
    total_fee_offsets: null,
    net_fee_due: null,
  };
}

function findMoneyField(text: string, patterns: RegExp[]): SecS3MoneyField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = match[1].trim();
    return {
      value: normalizeMoney(valueText),
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findPriceField(text: string, patterns: RegExp[]): SecS3PriceField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = match[1].trim();
    return {
      value: {
        price: normalizePrice(valueText),
        currency: "USD",
      },
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findSentenceField(text: string, pattern: RegExp): SecS3Field | null {
  const match = text.match(pattern);
  if (!match) return null;
  return {
    value: pickEvidenceSentence(text, match.index || 0),
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "medium",
  };
}

function findSectionField(text: string, heading: string): SecS3Field | null {
  const pattern = new RegExp(`\\b${escapeRegExp(heading)}\\b`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  const start = (match.index || 0) + match[0].length;
  const section = text
    .slice(start, start + 1_200)
    .split(/\n{2,}|(?=\b[A-Z][A-Z /-]{3,60}\b\s*\n)/)
    .map((part) => compactText(part))
    .find((part) => part.length > 40 && !isTocLine(part));
  if (!section) return null;
  return {
    value: truncate(section, 420),
    evidence: truncate(section, 420),
    confidence: "medium",
  };
}

function extractSellingStockholdersSection(text: string) {
  if (!text) return "";
  const headingPattern = /\bselling\s+(?:stockholders?|shareholders?)\b/gi;
  let match: RegExpExecArray | null;
  let start = -1;

  while ((match = headingPattern.exec(text))) {
    const following = text.slice(match.index, match.index + 8_000);
    if (/\bName\s+of\s+Selling\s+(?:Stockholder|Shareholder)s?\b|\bbeneficially owned prior to the offering\b/i.test(following)) {
      start = match.index;
      break;
    }
  }

  if (start < 0) return "";

  const sectionText = text.slice(start);
  const minimumLength = Math.min(sectionText.length, 1_500);
  const stopSearch = sectionText.slice(minimumLength);
  const stop = stopSearch.search(
    /\n\s*(?:PLAN OF DISTRIBUTION|DESCRIPTION OF SECURITIES|DESCRIPTION OF CAPITAL STOCK|USE OF PROCEEDS|LEGAL MATTERS|EXPERTS|WHERE YOU CAN FIND MORE INFORMATION|INCORPORATION OF CERTAIN INFORMATION|INTERESTS OF NAMED EXPERTS)\s*\n/i,
  );
  const end = stop >= 0 ? minimumLength + stop : Math.min(sectionText.length, 30_000);
  return compactText(sectionText.slice(0, end));
}

function isHardSectionHeading(value: string) {
  return /^(?:PLAN OF DISTRIBUTION|DESCRIPTION OF SECURITIES|DESCRIPTION OF CAPITAL STOCK|USE OF PROCEEDS|LEGAL MATTERS|EXPERTS|WHERE YOU CAN FIND MORE INFORMATION|INCORPORATION OF CERTAIN INFORMATION|INTERESTS OF NAMED EXPERTS)$/i.test(
    compactText(value),
  );
}

function field(
  value: string,
  text: string,
  pattern: RegExp,
  confidence: SecS3Field["confidence"],
): SecS3Field | null {
  const match = text.match(pattern);
  if (!match) return null;
  return {
    value,
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence,
  };
}

function buildReviewReasons({
  amendment,
  feeTableDocuments,
  feeTableRows,
  formType,
  primaryOrResale,
  registrationStatus,
  securitiesRegistered,
  sellingStockholders,
  sharesRegistered,
  s3Text,
}: {
  amendment: SecS3AmendmentInfo;
  feeTableDocuments: SecS3DocumentSummary[];
  feeTableRows: SecS3FeeTableRow[];
  formType: string | null;
  primaryOrResale: SecS3Field | null;
  registrationStatus: SecS3Field | null;
  securitiesRegistered: SecS3Field[];
  sellingStockholders: SecS3SellingStockholderRow[];
  sharesRegistered: SecS3CountField | null;
  s3Text: string;
}) {
  const reasons: string[] = [];
  if (!isS3Family(formType)) reasons.push("not_s3_family");
  if (!s3Text) reasons.push("no_text_available");
  if (!registrationStatus) reasons.push("registration_status_not_found");
  if (!primaryOrResale && !amendment.is_amendment) reasons.push("primary_or_resale_not_found");
  if (!securitiesRegistered.length) reasons.push("securities_registered_not_found");
  if (!sharesRegistered && primaryOrResale?.value === "resale") reasons.push("resale_share_count_not_found");
  if (primaryOrResale?.value === "resale" && hasSellingStockholderTableHeader(s3Text) && !sellingStockholders.length) {
    reasons.push("selling_stockholders_table_not_parsed");
  }
  if (feeTableDocuments.length && !feeTableDocuments.some((document) => document.text_char_count > 0)) {
    reasons.push("fee_table_document_present_without_text");
  }
  if (feeTableDocuments.length && feeTableDocuments.some((document) => document.text_char_count > 0) && !feeTableRows.length) {
    reasons.push("fee_table_text_present_without_rows");
  }
  return reasons;
}

function extractPrimaryText(combinedText: string, formType: string | null) {
  const form = normalizeForm(formType);
  if (!combinedText || !form) return combinedText;
  const heading = `### ${form}`;
  const start = combinedText.toUpperCase().indexOf(heading);
  if (start < 0) return combinedText;
  const next = combinedText.indexOf("\n\n### ", start + heading.length);
  return compactText(next > start ? combinedText.slice(start, next) : combinedText.slice(start));
}

function extractProspectusCoverText(text: string) {
  const prospectusIndex = text.search(/\b(?:preliminary\s+prospectus|prospectus)\b/i);
  const start = prospectusIndex >= 0 ? prospectusIndex : 0;
  const afterStart = text.slice(start, start + 8_000);
  const stop = afterStart.search(/\b(?:table of contents|risk factors|prospectus summary|the offering)\b/i);
  return compactText(stop > 500 ? afterStart.slice(0, stop) : afterStart.slice(0, 4_000));
}

function mapDocumentSummary(document: SecDocumentPayload): SecS3DocumentSummary {
  return {
    type: nullableString(document.type),
    description: nullableString(document.description),
    url_present: Boolean(nullableString(document.url)),
    is_primary: Boolean(document.isPrimary),
    text_char_count: numberValue(document.textCharCount),
    text_truncated: Boolean(document.textTruncated),
    fetch_status: numberValue(document.fetchStatus) || null,
    fetch_error: nullableString(document.fetchError),
  };
}

function isFeeTableDocument(document: SecS3DocumentSummary) {
  return isFeeTableLabel(`${document.type || ""} ${document.description || ""}`);
}

function isFeeTableLabel(value: string) {
  return /\b(?:EX-FILING FEES|FILING FEE|FEE TABLE|EX-107|EX107|107)\b/i.test(value);
}

function readIssuerFromText(text: string) {
  return text.match(/\bFORM [SF]-3(?:ASR|\/A)?\b[\s\S]{0,260}?\n([A-Z][A-Za-z0-9&.,' -]+?)\s+\|?\s*\(Exact name of registrant/i)?.[1]?.trim() || null;
}

function readFormTypeFromTitle(value: unknown) {
  return stringValue(value).match(/\b([SF]-3ASR|[SF]-3\/A|[SF]-3)\b/i)?.[1]?.toUpperCase() || "";
}

function resolveS3FormType({
  documents,
  metadata,
  rawPayload,
  title,
}: {
  documents: SecDocumentPayload[];
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  title: unknown;
}) {
  return (
    readS3FormTypeFromDocuments(documents) ||
    canonicalS3FormType(nullableString(rawPayload.form_type)) ||
    canonicalS3FormType(nullableString(metadata.form_type)) ||
    canonicalS3FormType(readFormTypeFromTitle(title)) ||
    null
  );
}

function readS3FormTypeFromDocuments(documents: SecDocumentPayload[]) {
  const primary = documents.find((document) => Boolean(document.isPrimary) && isS3Family(nullableString(document.type)));
  if (primary) return canonicalS3FormType(nullableString(primary.type));
  const anyS3Document = documents.find((document) => isS3Family(nullableString(document.type)));
  return anyS3Document ? canonicalS3FormType(nullableString(anyS3Document.type)) : null;
}

function canonicalS3FormType(value: string | null) {
  const form = normalizeForm(value);
  if (form === "S-3/A") return "S-3/A";
  if (form === "F-3/A") return "F-3/A";
  if (form === "S-3ASR") return "S-3ASR";
  if (form === "F-3ASR") return "F-3ASR";
  if (form === "S-3MEF") return "S-3MEF";
  if (form === "F-3MEF") return "F-3MEF";
  if (form === "S-3") return "S-3";
  if (form === "F-3") return "F-3";
  return null;
}

function isS3Family(formType: string | null) {
  return /^[SF]-3(?:ASR|MEF|\/A)?$/i.test(normalizeForm(formType));
}

function isAutomaticShelfForm(formType: string | null) {
  return /^[SF]-3ASR$/i.test(normalizeForm(formType));
}

function isS3FamilyAmendment(formType: string | null) {
  return /^[SF]-3\/A$/i.test(normalizeForm(formType));
}

function formatS3FamilyFormLabel(formType: string | null) {
  return canonicalS3FormType(formType) || "S-3/F-3";
}

function normalizeForm(value: string | null) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeShareCount(value: string) {
  if (isFootnoteToken(value) || isPlaceholderToken(value)) return null;
  const match = value.match(/(\d[\d,.]*)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  if (parsed > 0 && parsed < 1) return null;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMoney(value: string): SecS3MoneyField["value"] {
  const text = stringValue(value);
  const match = text.match(/\$?\s*([\d,.]+)/);
  if (!match) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const scale = readScale(text);
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return {
    amount: base * multiplier,
    currency: text.includes("$") ? "USD" : null,
    scale,
  };
}

function normalizePrice(value: string) {
  const match = stringValue(value).match(/\$?\s*([\d,.]+)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePercent(value: string) {
  const match = stringValue(value).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberFromText(value: string) {
  const parsed = Number(stringValue(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readScale(value: string): SecS3MoneyField["value"]["scale"] {
  if (/\bb(?:illion|n)?\b/i.test(value)) return "billion";
  if (/\bm(?:illion)?\b/i.test(value)) return "million";
  if (/\bthousand\b/i.test(value)) return "thousand";
  return "raw";
}

function pickEvidenceSentence(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf(".", index - 1), text.lastIndexOf("\n\n", index - 1));
  let end = text.indexOf(".", index + 1);
  if (end >= 0 && end - index < 80) {
    const nextEnd = text.indexOf(".", end + 1);
    if (nextEnd >= 0) end = nextEnd;
  }
  if (end < 0) end = Math.min(text.length, index + 360);
  else end += 1;
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), 420);
}

function isTocLine(value: string) {
  const text = compactText(value);
  if ((text.match(/\|/g) || []).length >= 2 && text.length < 260) return true;
  if (/\b(?:table of contents|prospectus summary|risk factors|legal matters|experts|where you can find more information)\b/i.test(text) && text.length < 260) {
    return true;
  }
  return false;
}

function compactText(value: string) {
  return stringValue(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function truncate(value: string, max: number) {
  const text = compactText(value);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
