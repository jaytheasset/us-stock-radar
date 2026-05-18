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

export type SecS3OfferingTerms = {
  offering_type: SecS3Field | null;
  security_type: SecS3Field | null;
  primary_or_resale: SecS3Field | null;
  offering_amount: SecS3MoneyField | null;
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
  const formType =
    nullableString(rawPayload.form_type) ||
    nullableString(metadata.form_type) ||
    readFormTypeFromTitle(input.title) ||
    null;
  const combinedText = compactText(stringValue(input.analysisText) || stringValue(input.bodyText));
  const primaryText = extractPrimaryText(combinedText, formType);
  const attachmentText = compactText(attachmentTexts.map((item) => stringValue(item.text)).join("\n\n"));
  const s3Sources = [stringValue(input.title), primaryText, attachmentText].map(compactText).filter(Boolean);
  const s3Text = s3Sources.join("\n\n");
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
  const primaryOrResale = findPrimaryOrResale(s3Text);
  let securitiesRegistered = findSecuritiesRegistered(s3Text);
  const sharesRegistered = findShareCount(s3Text, [
    /\b(?:preliminary prospectus|prospectus)\s+(\d[\d,.]*\s+(?:shares of common stock|common shares|ordinary shares|shares))\b/i,
    /\b(?:up to|resale of|register(?:ing)?(?: the resale of)?)\s+(\d[\d,.]*\s+(?:shares of common stock|common shares|ordinary shares|shares))\b/i,
  ]);
  if (primaryOrResale?.value === "resale" && /\bshares of common stock\b/i.test(sharesRegistered?.text || "")) {
    securitiesRegistered = [
      {
        value: "common_stock",
        evidence: sharesRegistered?.evidence || "Resale S-3 registers shares of common stock.",
        confidence: "high",
      },
    ];
  }
  const resaleShareCount = findShareCount(s3Text, [
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
    text_stats: {
      body_chars: stringValue(input.bodyText).length,
      analysis_chars: stringValue(input.analysisText).length,
      attachment_chars: attachmentText.length,
    },
  };
}

function findRegistrationStatementKind(text: string): SecS3Field | null {
  if (/\bS-3ASR\b|\bautomatic shelf registration statement\b|\bwell-known seasoned issuer\b/i.test(text)) {
    return field("automatic_shelf_registration", text, /\bS-3ASR\b|\bautomatic shelf registration statement\b|\bwell-known seasoned issuer\b/i, "high");
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
    normalizeForm(formType) === "S-3ASR" ||
    /\b(?:automatic shelf registration statement|well-known seasoned issuer|immediately effective upon filing)\b/i.test(text)
  ) {
    return field(
      "automatically_effective",
      text,
      /\bS-3ASR\b|\bautomatic shelf registration statement\b|\bwell-known seasoned issuer\b|\bimmediately effective upon filing\b/i,
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
  if (isS3Family(formType) && /\bFORM S-3\b[\s\S]{0,800}\bREGISTRATION STATEMENT\b/i.test(text)) {
    return {
      value: "filed_not_effective",
      evidence: "Form S-3 registration statement filed; no automatic shelf or declared-effective language found.",
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
  if (/\b(?:resale by the selling stockholders|resale by selling stockholders|selling stockholders? named in this prospectus|selling shareholders? named in this prospectus)\b/i.test(text)) {
    return field("resale", text, /\b(?:resale by the selling stockholders|resale by selling stockholders|selling stockholders? named in this prospectus|selling shareholders? named in this prospectus)\b/i, "high");
  }
  if (/\b(?:we may offer|we are offering|we may sell|company may offer)\b/i.test(text)) {
    return field("primary", text, /\b(?:we may offer|we are offering|we may sell|company may offer)\b/i, "medium");
  }
  return null;
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

function buildS3OfferingTerms({
  currentSharesOutstanding,
  primaryOrResale,
  registrationStatementKind,
  resaleShareCount,
  securitiesRegistered,
  s3Text,
}: {
  currentSharesOutstanding: SecS3CountField | null;
  primaryOrResale: SecS3Field | null;
  registrationStatementKind: SecS3Field | null;
  resaleShareCount: SecS3CountField | null;
  securitiesRegistered: SecS3Field[];
  s3Text: string;
}): SecS3OfferingTerms {
  const offeringAmount =
    primaryOrResale?.value === "resale"
      ? findMoneyField(s3Text, [/\baggregate offering price\b[^.\n]{0,180}?(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i])
      : findMoneyField(s3Text, [
          /\b(?:aggregate offering price of|up to)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
        ]);
  const warrantCoverage = findSentenceField(s3Text, /\bwarrants?\s+to\s+purchase\b|\bwarrant shares\b/i);
  const conversionPrice = findPriceField(s3Text, [
    /\b(?:conversion price|initial conversion price|convertible at)\s*(?:of)?\s*(\$[\d,.]+)/i,
  ]);
  const securityType = securitiesRegistered[0] || null;
  const fields = [
    registrationStatementKind,
    securityType,
    primaryOrResale,
    offeringAmount,
    resaleShareCount,
    currentSharesOutstanding,
    warrantCoverage,
    conversionPrice,
  ];

  return {
    offering_type: registrationStatementKind,
    security_type: securityType,
    primary_or_resale: primaryOrResale,
    offering_amount: offeringAmount,
    resale_share_count: resaleShareCount,
    current_shares_outstanding: currentSharesOutstanding,
    warrant_coverage: warrantCoverage,
    conversion_price: conversionPrice,
    extracted_field_count: fields.filter(Boolean).length,
  };
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
    const line = cleanSellingTableLine(lines[index]);
    if (!line) continue;

    if (isSellingStockholdersHeaderLine(line)) {
      inTable = true;
      nameBuffer.length = 0;
      continue;
    }
    if (!inTable) continue;
    const rowName = line.match(/^(.+?)\s+\((\d+[A-Za-z]?)\)$/);
    const rowFootnoteOnly = line.match(/^\((\d+[A-Za-z]?)\)$/);
    if (rowName || (rowFootnoteOnly && nameBuffer.length)) {
      const holderName = rowName ? compactText([...nameBuffer, rowName[1]].join(" ")) : compactText(nameBuffer.join(" "));
      const footnoteId = rowName ? rowName[2] : rowFootnoteOnly?.[1] || null;
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
  if (/^\d[\d,]*(?:\.\d+)?\s*%?$/.test(text)) return text.includes("%") ? text : text;
  if (/^\d[\d,]*(?:\.\d+)?\s+%$/.test(text)) return text.replace(/\s+%$/, "%");
  return null;
}

function isPercentCell(value: string | null | undefined) {
  return Boolean(value && /%$/.test(value.replace(/\s+/g, "")));
}

function isPlaceholderCell(value: string | null | undefined) {
  return /^(?:-|--|—|–|\*)$/.test(stringValue(value));
}

function isSellingStockholdersHeaderLine(value: string) {
  return (
    /\bName\s+of\s+Selling\s+(?:Stockholder|Shareholder)s?\b/i.test(value) ||
    /\bof\s+Selling\s+(?:Stockholder|Shareholder)s?\b/i.test(value)
  );
}

function isSellingStockholderFootnoteStart(value: string) {
  return /^\*?\s*$/.test(value) || /^\(\d+[A-Za-z]?\)\b/.test(value);
}

function isSellingStockholderTableNoise(value: string) {
  if (/^\|+$/.test(value)) return true;
  if (/^(?:Shares|of|Common|Stock|Maximum|Number|Private|Placement|Immediately|Following|Beneficially|Owned|Prior to|the|Sale of the Private|Being Offered|Offered|for|Resale|for Resale|Offering|Number|Percentage)$/i.test(value)) {
    return true;
  }
  if (/\b(?:Name of Selling|Shares of Common Stock|Beneficially Owned|Maximum Number|Offered for Resale|Percentage)\b/i.test(value)) {
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
  if (/\bwarrant\b/i.test(value)) return "warrant_shares";
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
    const secondValue = readToken(tokens, cursor + 1);
    let securityType: string | null = null;
    let securityClassTitle: string | null = null;
    if (isFeeSecurityType(firstValue)) {
      securityType = firstValue;
      securityClassTitle = secondValue || null;
      cursor += 2;
    } else {
      securityClassTitle = firstValue || null;
      cursor += 1;
    }

    while (isFootnoteToken(readToken(tokens, cursor))) cursor += 1;
    const feeCalculationRule = readToken(tokens, cursor);
    cursor += 1;

    const amountRegistered = readAmountRegistered(tokens, cursor);
    cursor = amountRegistered.nextIndex;
    const proposedMaximumOfferingPricePerUnit = readPrice(tokens, cursor);
    cursor = proposedMaximumOfferingPricePerUnit.nextIndex;
    const maximumAggregateOfferingPrice = readMoney(tokens, cursor);
    cursor = maximumAggregateOfferingPrice.nextIndex;
    const feeRate = numberFromText(readToken(tokens, cursor));
    cursor += 1;
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
  return {
    field: {
      value: normalizeMoney(moneyText),
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
  if (!primaryOrResale) reasons.push("primary_or_resale_not_found");
  if (!securitiesRegistered.length) reasons.push("securities_registered_not_found");
  if (!sharesRegistered && primaryOrResale?.value === "resale") reasons.push("resale_share_count_not_found");
  if (primaryOrResale?.value === "resale" && /\bselling\s+(?:stockholders?|shareholders?)\b/i.test(s3Text) && !sellingStockholders.length) {
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
  return text.match(/\bFORM S-3\b[\s\S]{0,260}?\n([A-Z][A-Za-z0-9&.,' -]+?)\s+\|?\s*\(Exact name of registrant/i)?.[1]?.trim() || null;
}

function readFormTypeFromTitle(value: unknown) {
  return stringValue(value).match(/\b(S-3ASR|S-3\/A|S-3)\b/i)?.[1]?.toUpperCase() || "";
}

function isS3Family(formType: string | null) {
  return /^S-3(?:ASR|\/A)?$/i.test(normalizeForm(formType));
}

function normalizeForm(value: string | null) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeShareCount(value: string) {
  if (isFootnoteToken(value) || isPlaceholderToken(value)) return null;
  const match = value.match(/(\d[\d,.]*)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
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
