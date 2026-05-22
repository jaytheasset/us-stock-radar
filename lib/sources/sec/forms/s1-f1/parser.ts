import type {
  SecFormParser,
  SecFormParserAttachment,
  SecFormParserCalendarItem,
  SecFormParserConfidence,
  SecFormParserInput,
  SecFormParserOutput,
} from "../common/parserContract";
import {
  SEC_S1_F1_PARSER_VERSION,
  type SecS1F1AmendmentInfo,
  type SecS1F1CountField,
  type SecS1F1DocumentSummary,
  type SecS1F1Facts,
  type SecS1F1FeeTableSummary,
  type SecS1F1Field,
  type SecS1F1MoneyField,
  type SecS1F1OfferingKind,
  type SecS1F1OfferingTerms,
  type SecS1F1PriceField,
  type SecS1F1PriceRangeField,
  type SecS1F1RegistrationStatus,
  type SecS1F1Section,
  type SecS1F1SectionLabel,
  type SecS1F1SellingStockholderRow,
} from "./types";

const SUPPORTED_FORMS = new Set(["S-1", "S-1/A", "F-1", "F-1/A"]);
const MAX_SECTION_CHARS = 2_400;
const MAX_EVIDENCE_CHARS = 420;

const SECTION_DEFINITIONS: Array<{
  label: SecS1F1SectionLabel;
  headings: string[];
}> = [
  { label: "prospectus_summary", headings: ["Prospectus Summary", "Summary"] },
  { label: "the_offering", headings: ["The Offering", "Offering"] },
  { label: "risk_factors", headings: ["Risk Factors"] },
  { label: "use_of_proceeds", headings: ["Use of Proceeds"] },
  { label: "dilution", headings: ["Dilution"] },
  { label: "capitalization", headings: ["Capitalization"] },
  { label: "selling_stockholders", headings: ["Selling Stockholders", "Selling Shareholders"] },
  { label: "principal_stockholders", headings: ["Principal Stockholders", "Principal Shareholders"] },
  { label: "underwriting", headings: ["Underwriting", "Underwriters"] },
  { label: "plan_of_distribution", headings: ["Plan of Distribution"] },
  { label: "lockup", headings: ["Shares Eligible for Future Sale", "Lock-Up Agreements", "Lock-Up"] },
  { label: "description_of_securities", headings: ["Description of Securities", "Description of Capital Stock"] },
];

const HARD_STOP_HEADINGS = [
  "Prospectus Summary",
  "Summary",
  "The Offering",
  "Offering",
  "Risk Factors",
  "Use of Proceeds",
  "Dilution",
  "Capitalization",
  "Management",
  "Principal Stockholders",
  "Principal Shareholders",
  "Selling Stockholders",
  "Selling Shareholders",
  "Underwriting",
  "Underwriters",
  "Plan of Distribution",
  "Description of Securities",
  "Description of Capital Stock",
  "Shares Eligible for Future Sale",
  "Lock-Up Agreements",
  "Legal Matters",
  "Experts",
  "Where You Can Find More Information",
  "Index to Financial Statements",
];

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export const parseSecS1F1Filing: SecFormParser<SecS1F1Facts> = (
  input: SecFormParserInput,
): SecFormParserOutput<SecS1F1Facts> => {
  const formType = resolveS1F1FormType(input);
  const isSupported = Boolean(formType && SUPPORTED_FORMS.has(formType));
  const attachments = input.attachments || [];
  const primaryText = compactText(input.primaryDocumentText || "");
  const attachmentText = compactText(attachments.map((attachment) => attachment.text || "").join("\n\n"));
  const combinedText = compactText([input.title, primaryText, attachmentText].filter(Boolean).join("\n\n"));
  const sections = extractSections(combinedText);
  const feeTable = parseFeeTable(combinedText, attachments);
  const amendment = buildAmendmentInfo({
    combinedText,
    formType: formType || input.formType,
    accessionNumber: input.accessionNumber || nullableString(readRecord(input.rawPayload)?.accession_number),
  });
  const terms = buildOfferingTerms({
    combinedText,
    sections,
    amendment,
    feeTable,
  });
  const calendarCandidates = buildCalendarCandidates(terms);
  const documents = buildDocumentSummaries({
    attachments,
    primaryText,
    sections,
  });
  const extractedFieldCount = countExtractedFields(terms, sections, amendment);
  const reviewReasons = buildReviewReasons({
    amendment,
    combinedText,
    extractedFieldCount,
    feeTable,
    formType,
    isSupported,
    sections,
    terms,
  });
  const facts: SecS1F1Facts = {
    parser_version: SEC_S1_F1_PARSER_VERSION,
    raw_item_id: nullableString(input.rawItemId),
    accession_number: nullableString(input.accessionNumber) || nullableString(readRecord(input.rawPayload)?.accession_number),
    form_type: formType || normalizeForm(input.formType) || input.formType,
    is_s1_f1_family: isSupported,
    issuer: nullableString(input.companyName) || readIssuerFromText(combinedText),
    ticker: nullableString(input.ticker),
    filed_at: nullableString(input.filedAt),
    source_url: nullableString(input.sourceUrl),
    documents,
    sections,
    amendment,
    terms,
    calendar_candidates: calendarCandidates,
    llm_reading_package: buildReadingPackage({ combinedText, sections, terms, reviewReasons }),
    extracted_field_count: extractedFieldCount,
    needs_human_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
    text_stats: {
      primary_chars: primaryText.length,
      attachment_chars: attachmentText.length,
      combined_chars: combinedText.length,
    },
  };

  return {
    parserVersion: SEC_S1_F1_PARSER_VERSION,
    parserGroup: "s1-f1",
    formType: facts.form_type,
    accessionNumber: facts.accession_number,
    isSupported,
    summary: buildSummary(facts),
    facts,
    signals: buildSignals(facts),
    calendarItems: calendarCandidates,
    warnings: reviewReasons,
  };
};

function buildOfferingTerms({
  amendment,
  combinedText,
  feeTable,
  sections,
}: {
  amendment: SecS1F1AmendmentInfo;
  combinedText: string;
  feeTable: SecS1F1FeeTableSummary;
  sections: SecS1F1Section[];
}): SecS1F1OfferingTerms {
  const useOfProceeds = getSection(sections, "use_of_proceeds") || findSentenceField(
    combinedText,
    /\b(?:use|intend to use|expects? to use)\s+(?:the\s+)?(?:net\s+)?proceeds\b/i,
    "use_of_proceeds",
  );
  const dilution = getSection(sections, "dilution") || findSentenceField(
    combinedText,
    /\b(?:immediate and substantial dilution|substantial dilution|net tangible book value)\b/i,
    "dilution",
  );
  const capitalization = getSection(sections, "capitalization") || findSentenceField(
    combinedText,
    /\b(?:as adjusted capitalization|pro forma capitalization|cash and capitalization)\b/i,
    "capitalization",
  );
  const sellingStockholdersSection = getSection(sections, "selling_stockholders");
  const underwriterSection = getSection(sections, "underwriting");
  const lockupSection = getSection(sections, "lockup");
  const warrantSection = findInstrumentSection(sections, "warrant_terms");
  const convertibleSection = findInstrumentSection(sections, "convertible_terms");
  const securityTypeCandidates = findSecurityTypeCandidates(combinedText);
  const primarySharesOffered = findPrimarySharesOffered(combinedText);
  const resaleShareCount = findResaleShareCount(combinedText);
  const sharesOffered = primarySharesOffered || resaleShareCount || findAnySharesOffered(combinedText);
  const offeringKind = classifyOfferingKind({
    amendment,
    combinedText,
    primarySharesOffered,
    resaleShareCount,
    sellingStockholdersSection,
  });

  return {
    offering_kind: offeringKind,
    registration_status: findRegistrationStatus(combinedText, amendment),
    primary_or_resale: classifyPrimaryOrResale({ combinedText, primarySharesOffered, resaleShareCount }),
    security_type_candidates: securityTypeCandidates,
    shares_offered: sharesOffered,
    primary_shares_offered: primarySharesOffered,
    resale_share_count: resaleShareCount,
    current_shares_outstanding: findCurrentSharesOutstanding(combinedText),
    price_range: findPriceRange(combinedText),
    offering_price: findOfferingPrice(combinedText),
    offering_amount: findOfferingAmount(combinedText) || feeTable.total_offering_amount || feeTable.maximum_aggregate_offering_price,
    gross_proceeds: findMoneyField(combinedText, [
      /\b(?:gross proceeds|gross proceeds from this offering)[^.\n]{0,160}?(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    ]),
    net_proceeds: findMoneyField(combinedText, [
      /\b(?:net proceeds|net proceeds from this offering)[^.\n]{0,160}?(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    ]),
    use_of_proceeds: useOfProceeds,
    dilution,
    capitalization,
    underwriters: findUnderwriters(combinedText, underwriterSection),
    underwriter_section: underwriterSection,
    lockup_terms: lockupSection || findSentenceField(combinedText, /\block-?up\b[^.\n]{0,220}?\b(?:days?|months?|expire|expiration)\b/i, "lock_up"),
    warrant_terms: warrantSection || findSentenceField(combinedText, /\b(?:warrant|pre-funded warrant|exercise price)\b/i, "warrant_terms"),
    convertible_terms: convertibleSection || findSentenceField(combinedText, /\b(?:convertible notes?|convertible preferred|conversion price)\b/i, "convertible_terms"),
    selling_stockholders_section: sellingStockholdersSection,
    selling_stockholders: parseSellingStockholders(sellingStockholdersSection?.text || combinedText),
    risk_factor_excerpts: extractRiskFactorExcerpts(combinedText, sections),
    expected_pricing_date: findDateField(combinedText, [
      /\b(?:expect|expected|anticipate(?:d)?|intend(?:ed)?)\s+to\s+price[^.\n]{0,120}?\b(on|about|around)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
      /\bpricing\s+(?:date|is expected)[^.\n]{0,120}?\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
    ], "expected_pricing_date"),
    expected_listing_date: findDateField(combinedText, [
      /\b(?:expect|expected|anticipate(?:d)?)\s+(?:[^.\n]{0,80}?\s+)?to\s+begin\s+trading[^.\n]{0,120}?\b(on|about|around)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
      /\b(?:listing|first trading)\s+date[^.\n]{0,120}?\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
    ], "expected_listing_date"),
    expected_effective_date: findDateField(combinedText, [
      /\b(?:declared|become|became|expected to become)\s+effective[^.\n]{0,120}?\b(on|about|around)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
      /\beffective\s+date[^.\n]{0,120}?\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
    ], "expected_effective_date"),
    expected_closing_date: findDateField(combinedText, [
      /\bclosing[^.\n]{0,140}?\b(?:expected|anticipated|occur|take place)[^.\n]{0,120}?\b(on|about|around)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
      /\bexpected\s+closing\s+date[^.\n]{0,120}?\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/i,
    ], "expected_closing_date"),
    fee_table: feeTable,
  };
}

function buildAmendmentInfo({
  accessionNumber,
  combinedText,
  formType,
}: {
  accessionNumber: string | null;
  combinedText: string;
  formType: string;
}): SecS1F1AmendmentInfo {
  const isAmendment = /\/A$/i.test(normalizeForm(formType));
  const amendmentExcerpt = isAmendment ? extractAmendmentExcerpt(combinedText) : null;
  const searchText = amendmentExcerpt || combinedText;
  const amendmentNumber = isAmendment
    ? findCountField(searchText, [/\bAmendment\s+No\.?\s*(\d+)\b/i], "high")
    : null;
  const registrationNumber = findRegistrationNumber(combinedText);
  const changeSignals = isAmendment ? findMaterialChangeSignals(searchText) : [];

  return {
    is_amendment: isAmendment,
    amendment_number: amendmentNumber,
    registration_number: registrationNumber,
    includes_full_prospectus: isAmendment && hasFullProspectusText(combinedText),
    unchanged_remainder_not_included: /\b(?:remainder|rest)\s+of\s+the\s+registration\s+statement[\s\S]{0,180}?\bunchanged\b[\s\S]{0,180}?\bnot\s+been\s+included\b/i.test(
      searchText,
    ),
    material_change_signal_candidates: changeSignals,
    amendment_excerpt: amendmentExcerpt || (isAmendment ? `Amendment ${amendmentNumber?.text || ""} ${accessionNumber || ""}`.trim() : null),
  };
}

function classifyOfferingKind({
  amendment,
  combinedText,
  primarySharesOffered,
  resaleShareCount,
  sellingStockholdersSection,
}: {
  amendment: SecS1F1AmendmentInfo;
  combinedText: string;
  primarySharesOffered: SecS1F1CountField | null;
  resaleShareCount: SecS1F1CountField | null;
  sellingStockholdersSection: SecS1F1Section | null;
}): SecS1F1Field<SecS1F1OfferingKind> {
  const ipoSignal = findSentenceField(
    combinedText,
    /\b(?:initial public offering|this is our initial public offering|no public market currently exists|applied to list|approval for listing)\b/i,
    "ipo_listing",
  );
  const resaleSignal =
    resaleShareCount ||
    sellingStockholdersSection ||
    findSentenceField(combinedText, /\b(?:resale prospectus|selling stockholders?|selling shareholders?|no proceeds from the sale of shares by)\b/i, "resale_registration");
  const primarySignal =
    primarySharesOffered ||
    findSentenceField(combinedText, /\b(?:we are offering|we offer|we are selling|we may offer|offered by us)\b/i, "primary_registration");
  const routineAmendment =
    amendment.is_amendment &&
    amendment.unchanged_remainder_not_included &&
    amendment.material_change_signal_candidates.length === 0 &&
    !primarySignal &&
    !resaleSignal &&
    !ipoSignal;

  if (routineAmendment) {
    return {
      value: "routine_amendment",
      evidence: amendment.amendment_excerpt || "Amendment indicates unchanged remainder without new offering signals.",
      confidence: "medium",
    };
  }

  if (ipoSignal) {
    return {
      value: "ipo_listing",
      evidence: ipoSignal.evidence,
      confidence: ipoSignal.confidence,
    };
  }

  if (primarySignal && resaleSignal) {
    return {
      value: "mixed_primary_resale",
      evidence: truncate(`${fieldEvidence(primarySignal)} ${fieldEvidence(resaleSignal)}`, MAX_EVIDENCE_CHARS),
      confidence: "medium",
    };
  }

  if (resaleSignal) {
    return {
      value: "resale_registration",
      evidence: fieldEvidence(resaleSignal),
      confidence: resaleShareCount ? "high" : "medium",
    };
  }

  if (primarySignal) {
    return {
      value: "primary_registration",
      evidence: fieldEvidence(primarySignal),
      confidence: primarySharesOffered ? "high" : "medium",
    };
  }

  return {
    value: "unknown",
    evidence: "No IPO, primary offering, resale, or routine amendment signal was confidently extracted.",
    confidence: "low",
  };
}

function classifyPrimaryOrResale({
  combinedText,
  primarySharesOffered,
  resaleShareCount,
}: {
  combinedText: string;
  primarySharesOffered: SecS1F1CountField | null;
  resaleShareCount: SecS1F1CountField | null;
}): SecS1F1Field | null {
  const primarySignal =
    primarySharesOffered ||
    findSentenceField(combinedText, /\b(?:we are offering|we offer|we are selling|offered by us|net proceeds to us)\b/i, "primary");
  const resaleSignal =
    resaleShareCount ||
    findSentenceField(combinedText, /\b(?:selling stockholders?|selling shareholders?|no proceeds from the sale of shares by)\b/i, "resale");
  if (primarySignal && resaleSignal) {
    return {
      value: "mixed",
      evidence: truncate(`${fieldEvidence(primarySignal)} ${fieldEvidence(resaleSignal)}`, MAX_EVIDENCE_CHARS),
      confidence: "medium",
    };
  }
  if (resaleSignal) return { value: "resale", evidence: fieldEvidence(resaleSignal), confidence: "high" };
  if (primarySignal) return { value: "primary", evidence: fieldEvidence(primarySignal), confidence: "medium" };
  return null;
}

function findRegistrationStatus(
  text: string,
  amendment: SecS1F1AmendmentInfo,
): SecS1F1Field<SecS1F1RegistrationStatus> | null {
  if (/\bsubject\s+to\s+completion\b|\bpreliminary\s+prospectus\b/i.test(text)) {
    return field("preliminary", text, /\bsubject\s+to\s+completion\b|\bpreliminary\s+prospectus\b/i, "high");
  }
  if (/\bregistration\s+statement[\s\S]{0,280}?\bnot\s+(?:yet\s+)?effective\b|\bmay\s+not\s+be\s+sold[\s\S]{0,280}?\beffective\b/i.test(text)) {
    return field(
      "filed_not_effective",
      text,
      /\bregistration\s+statement[\s\S]{0,280}?\bnot\s+(?:yet\s+)?effective\b|\bmay\s+not\s+be\s+sold[\s\S]{0,280}?\beffective\b/i,
      "high",
    );
  }
  if (/\b(?:declared|became|become)\s+effective\b/i.test(text)) {
    return field("effective", text, /\b(?:declared|became|become)\s+effective\b/i, "high");
  }
  if (amendment.is_amendment) {
    return {
      value: "amended",
      evidence: amendment.amendment_excerpt || "S-1/F-1 amendment filing.",
      confidence: "medium",
    };
  }
  return null;
}

function findSecurityTypeCandidates(text: string): SecS1F1Field[] {
  const candidates: SecS1F1Field[] = [];
  pushField(candidates, field("common_stock", text, /\bcommon stock\b/i, "high"));
  pushField(candidates, field("ordinary_shares", text, /\bordinary shares?\b/i, "high"));
  pushField(candidates, field("american_depositary_shares", text, /\b(?:American Depositary Shares|ADSs?)\b/i, "high"));
  pushField(candidates, field("units", text, /\bunits\b/i, "medium"));
  pushField(candidates, field("warrants", text, /\b(?:warrants?|pre-funded warrants?)\b/i, "medium"));
  pushField(candidates, field("convertible_securities", text, /\b(?:convertible notes?|convertible preferred|conversion shares?)\b/i, "medium"));
  return dedupeFields(candidates);
}

function findPrimarySharesOffered(text: string) {
  return findCountField(text, [
    /\bwe\s+(?:are\s+)?(?:offering|offer|are selling)\s+(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\b/i,
    /\binitial public offering of\s+(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\b/i,
    /\b(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\s+(?:are|is)?\s*(?:being\s+)?offered\s+by\s+us\b/i,
  ]);
}

function findResaleShareCount(text: string) {
  return findCountField(text, [
    /\bresale\s+of\s+(?:up\s+to\s+)?(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\b/i,
    /\bselling\s+(?:stockholders?|shareholders?)[^.\n]{0,180}?(?:offer|sell|resell|register(?:ing)?|up to)\s+(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\b/i,
    /\bregister(?:ing|ed)?\s+(?:for\s+resale\s+)?(?:up\s+to\s+)?(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\b/i,
  ]);
}

function findAnySharesOffered(text: string) {
  return findCountField(text, [
    /\b(?:up\s+to\s+)?(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\s+(?:of\s+(?:common stock|ordinary shares|ADSs?)[^.\n]{0,80})?(?:are|may be|will be)?\s*(?:offered|sold|resold|registered)\b/i,
    /\b(?:offering|registering|selling)\s+(?:up\s+to\s+)?(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\b/i,
  ]);
}

function findCurrentSharesOutstanding(text: string) {
  return findCountField(text, [
    /\b(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\s+(?:of\s+[^.\n]{0,80})?\s+(?:were|are|will be)?\s*(?:issued\s+and\s+)?outstanding\b/i,
    /\boutstanding\s+before\s+this\s+offering[^.\n]{0,120}?(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares?|ADSs?|American Depositary Shares?))\b/i,
  ]);
}

function findPriceRange(text: string): SecS1F1PriceRangeField | null {
  const patterns = [
    /\bbetween\s+(\$?\s*\d[\d,.]*)\s+and\s+(\$?\s*\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share)\b/i,
    /\bprice\s+range\s+of\s+(\$?\s*\d[\d,.]*)\s+(?:to|-|and)\s+(\$?\s*\d[\d,.]*)\b/i,
    /\bestimated\s+(?:initial\s+public\s+)?offering\s+price\s+will\s+be\s+between\s+(\$?\s*\d[\d,.]*)\s+and\s+(\$?\s*\d[\d,.]*)\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1] || !match[2]) continue;
    const evidence = pickEvidenceSentence(text, match.index || 0);
    const left = match[1].trim();
    const right = match[2].trim();
    return {
      value: {
        low: normalizePrice(left),
        high: normalizePrice(right),
        currency: left.includes("$") || right.includes("$") ? "USD" : null,
      },
      text: `${left} - ${right}`,
      evidence,
      confidence: "high",
    };
  }
  return null;
}

function findOfferingPrice(text: string): SecS1F1PriceField | null {
  return findPriceField(text, [
    /\b(?:public offering price|initial public offering price|assumed initial public offering price|offering price)\s+(?:is|of|will be)?\s*(\$?\s*\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share)\b/i,
    /\b(?:at a price of)\s+(\$?\s*\d[\d,.]*)\s+per\s+(?:share|ADS|ordinary share)\b/i,
  ]);
}

function findOfferingAmount(text: string) {
  return findMoneyField(text, [
    /\b(?:maximum aggregate offering price|aggregate offering price|offering amount|total offering amount)[^.\n]{0,160}?(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    /\b(?:up to|approximately)\s+(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)\s+(?:of|in)\s+(?:common stock|ordinary shares|ADSs?|securities)\b/i,
  ]);
}

function findUnderwriters(text: string, underwriterSection: SecS1F1Section | null): SecS1F1Field[] {
  const source = underwriterSection?.text || text;
  const candidates: SecS1F1Field[] = [];
  const patterns = [
    /\bthrough\s+([A-Z][A-Za-z0-9&.,' -]{2,80}),?\s+as\s+(?:representative|underwriter|book-running manager)/gi,
    /\b([A-Z][A-Za-z0-9&.,' -]{2,80})\s+(?:is|are)\s+acting\s+as\s+(?:representative|underwriter|book-running manager|lead manager)/gi,
    /\brepresentative(?:s)?\s+of\s+the\s+underwriters?,?\s+([A-Z][A-Za-z0-9&.,' -]{2,80})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = compactText(match[1] || "");
      if (!value || isBoilerplateName(value)) continue;
      candidates.push({
        value,
        evidence: pickEvidenceSentence(source, match.index || 0),
        confidence: "medium",
      });
    }
  }
  if (!candidates.length && underwriterSection) {
    candidates.push({
      value: "underwriting_section_present",
      evidence: underwriterSection.evidence,
      confidence: "low",
    });
  }
  return dedupeFields(candidates).slice(0, 6);
}

function parseSellingStockholders(text: string): SecS1F1SellingStockholderRow[] {
  if (!/\bselling\s+(?:stockholders?|shareholders?)\b|\bshares\s+offered\b|\bshares\s+owned\s+before\b/i.test(text)) return [];
  const rows: SecS1F1SellingStockholderRow[] = [];
  const lines = text
    .split(/\n+/)
    .map((line) => compactText(line))
    .filter((line) => line.length > 8 && /\d/.test(line));

  for (const line of lines) {
    if (rows.length >= 12) break;
    if (/\b(?:total|name of selling|shares beneficially|percentage|table of contents)\b/i.test(line)) continue;
    const cells = line.includes("|")
      ? line.split("|").map(compactText).filter(Boolean)
      : line.split(/\s{2,}/).map(compactText).filter(Boolean);
    if (cells.length < 2 || !/[A-Za-z]/.test(cells[0] || "")) continue;
    const holderName = cells[0];
    if (holderName.length > 120 || /\b(?:shares|offered|beneficially|owned|before|after)\b/i.test(holderName)) continue;
    const rest = cells.slice(1).join(" | ");
    const counts = [...rest.matchAll(/(\d[\d,.]*)\s*(?:shares?)?/gi)].map((match) =>
      buildCountField(match[0], line, "medium"),
    );
    const percentAfter = buildPercentField(rest, line);
    rows.push({
      holder_name: holderName,
      shares_offered: counts[1] || counts[0] || null,
      shares_owned_before: counts[0] || null,
      shares_owned_after: counts[2] || null,
      percent_after: percentAfter,
      raw_cells: cells,
      evidence: truncate(line, MAX_EVIDENCE_CHARS),
      confidence: counts.length ? "medium" : "low",
    });
  }

  return rows;
}

function extractRiskFactorExcerpts(text: string, sections: SecS1F1Section[]): SecS1F1Field[] {
  const riskText = getSection(sections, "risk_factors")?.text || text;
  const fields: SecS1F1Field[] = [];
  const sentences = splitSentences(riskText);
  for (const sentence of sentences) {
    if (fields.length >= 4) break;
    if (
      /\b(?:dilution|substantial doubt|going concern|limited operating history|losses|Nasdaq|listing|liquidity|warrants?|convertible|control)\b/i.test(
        sentence,
      )
    ) {
      fields.push({
        value: truncate(sentence, MAX_EVIDENCE_CHARS),
        evidence: truncate(sentence, MAX_EVIDENCE_CHARS),
        confidence: "medium",
      });
    }
  }
  if (!fields.length) {
    pushField(fields, findSentenceField(text, /\b(?:substantial dilution|dilution to investors|going concern)\b/i, "risk_factor_excerpt"));
  }
  return fields;
}

function parseFeeTable(text: string, attachments: SecFormParserAttachment[]): SecS1F1FeeTableSummary {
  const feeAttachmentTexts = attachments
    .filter((attachment) => isFeeTableLabel(`${attachment.type || ""} ${attachment.description || ""} ${attachment.filename || ""}`))
    .map((attachment) => attachment.text || "")
    .filter(Boolean);
  const sourceIds = attachments
    .map((attachment, index) => ({ attachment, sourceId: `attachment_${index + 1}` }))
    .filter(({ attachment }) => isFeeTableLabel(`${attachment.type || ""} ${attachment.description || ""} ${attachment.filename || ""}`))
    .map(({ sourceId }) => sourceId);
  const inlineFeeTableMatch = text.match(/\b(?:Calculation of Filing Fee|Filing Fee Table|EX-FILING FEES|Maximum Aggregate Offering Price)\b/i);
  const feeText = compactText([...feeAttachmentTexts, inlineFeeTableMatch ? text.slice(inlineFeeTableMatch.index || 0, (inlineFeeTableMatch.index || 0) + 3_000) : ""].join("\n\n"));
  const present = feeAttachmentTexts.length > 0 || Boolean(inlineFeeTableMatch);

  return {
    present,
    source_ids: sourceIds,
    total_offering_amount: findMoneyField(feeText, [
      /\bTotal Offering Amounts?\b[^$\d]{0,120}(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    ]),
    maximum_aggregate_offering_price: findMoneyField(feeText, [
      /\bMaximum Aggregate Offering Price\b[^$\d]{0,120}(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)/i,
      /\bmaximum aggregate offering price[^.\n]{0,160}?(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    ]),
    registration_fee: findMoneyField(feeText, [
      /\b(?:registration fee|fee due|net fee due)\b[^$\d]{0,120}(\$?\s*\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    ]),
    excerpt: feeText ? truncate(feeText, 1_000) : null,
  };
}

function buildCalendarCandidates(terms: SecS1F1OfferingTerms): SecFormParserCalendarItem[] {
  const items: SecFormParserCalendarItem[] = [];
  pushCalendarItem(items, terms.expected_pricing_date, "ipo_pricing_date", "Expected IPO pricing");
  pushCalendarItem(items, terms.expected_listing_date, "ipo_listing_date", "Expected IPO listing");
  pushCalendarItem(items, terms.expected_effective_date, "registration_effective_date", "Expected registration effectiveness");
  pushCalendarItem(items, terms.expected_closing_date, "offering_closing", "Expected offering closing");

  const lockupEvidence = fieldEvidence(terms.lockup_terms);
  const lockupDate = parseDateFromText(lockupEvidence);
  if (lockupDate) {
    items.push({
      calendarEventType: terms.offering_kind.value === "ipo_listing" ? "ipo_lockup_expiration" : "lockup_expiration",
      calendarTitle: "Lock-up expiration",
      eventDate: lockupDate,
      datePrecision: "exact",
      evidence: truncate(lockupEvidence, MAX_EVIDENCE_CHARS),
      confidence: "medium",
    });
  }

  return dedupeCalendarItems(items);
}

function pushCalendarItem(
  items: SecFormParserCalendarItem[],
  fieldValue: SecS1F1Field | null,
  calendarEventType: string,
  calendarTitle: string,
) {
  if (!fieldValue) return;
  const eventDate = parseDateFromText(fieldValue.value) || parseDateFromText(fieldValue.evidence);
  items.push({
    calendarEventType,
    calendarTitle,
    eventDate,
    datePrecision: eventDate ? "exact" : "unknown",
    evidence: fieldValue.evidence,
    confidence: fieldValue.confidence,
  });
}

function extractSections(text: string): SecS1F1Section[] {
  const sections: SecS1F1Section[] = [];
  const cover = extractCover(text);
  if (cover) sections.push(cover);

  for (const definition of SECTION_DEFINITIONS) {
    const section = findSection(text, definition.label, definition.headings);
    if (section) sections.push(section);
  }

  const warrant = findSentenceSection(text, "warrant_terms", /\b(?:warrant|pre-funded warrant|exercise price)\b/i);
  if (warrant) sections.push(warrant);
  const convertible = findSentenceSection(text, "convertible_terms", /\b(?:convertible notes?|convertible preferred|conversion price)\b/i);
  if (convertible) sections.push(convertible);
  const fee = findSentenceSection(text, "fee_table", /\b(?:Calculation of Filing Fee|Filing Fee Table|Maximum Aggregate Offering Price)\b/i);
  if (fee) sections.push(fee);

  return dedupeSections(sections);
}

function findSection(text: string, label: SecS1F1SectionLabel, headings: string[]): SecS1F1Section | null {
  for (const heading of headings) {
    const pattern = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(heading)}\\s*(?:\\n|$)`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = (match.index || 0) + match[0].length;
      const nextStop = findNextHeadingIndex(text, start);
      const rawSection = text.slice(start, nextStop > start ? nextStop : start + MAX_SECTION_CHARS);
      const sectionText = truncate(compactText(rawSection), MAX_SECTION_CHARS);
      if (sectionText.length < 60 || isLikelyTocBlock(sectionText)) continue;
      return {
        label,
        heading,
        source_id: "primary",
        text: sectionText,
        evidence: truncate(sectionText, MAX_EVIDENCE_CHARS),
        confidence: "medium",
        char_count: sectionText.length,
        text_truncated: compactText(rawSection).length > MAX_SECTION_CHARS,
      };
    }
  }
  return null;
}

function findSentenceSection(text: string, label: SecS1F1SectionLabel, pattern: RegExp): SecS1F1Section | null {
  const match = text.match(pattern);
  if (!match) return null;
  const evidence = pickEvidenceSentence(text, match.index || 0);
  return {
    label,
    heading: label.replace(/_/g, " "),
    source_id: "primary",
    text: evidence,
    evidence,
    confidence: "low",
    char_count: evidence.length,
    text_truncated: false,
  };
}

function extractCover(text: string): SecS1F1Section | null {
  if (!text) return null;
  const stop = text.search(/\n\s*(?:Table of Contents|Prospectus Summary|Risk Factors|The Offering)\s*\n/i);
  const coverText = truncate(compactText(text.slice(0, stop > 500 ? stop : 2_200)), MAX_SECTION_CHARS);
  if (coverText.length < 80) return null;
  return {
    label: "cover",
    heading: "Cover",
    source_id: "primary",
    text: coverText,
    evidence: truncate(coverText, MAX_EVIDENCE_CHARS),
    confidence: "medium",
    char_count: coverText.length,
    text_truncated: compactText(text).length > coverText.length,
  };
}

function buildDocumentSummaries({
  attachments,
  primaryText,
  sections,
}: {
  attachments: SecFormParserAttachment[];
  primaryText: string;
  sections: SecS1F1Section[];
}): SecS1F1DocumentSummary[] {
  return [
    {
      source_id: "primary",
      type: null,
      description: "Primary document text",
      filename: null,
      url_present: false,
      is_primary: true,
      text_char_count: primaryText.length,
      relevant_section_count: sections.filter((section) => section.source_id === "primary").length,
      text_truncated: false,
    },
    ...attachments.map((attachment, index) => ({
      source_id: `attachment_${index + 1}`,
      type: nullableString(attachment.type),
      description: nullableString(attachment.description),
      filename: nullableString(attachment.filename),
      url_present: Boolean(nullableString(attachment.url)),
      is_primary: false,
      text_char_count: stringValue(attachment.text).length,
      relevant_section_count: isFeeTableLabel(`${attachment.type || ""} ${attachment.description || ""} ${attachment.filename || ""}`) ? 1 : 0,
      text_truncated: false,
    })),
  ];
}

function buildReadingPackage({
  combinedText,
  reviewReasons,
  sections,
  terms,
}: {
  combinedText: string;
  reviewReasons: string[];
  sections: SecS1F1Section[];
  terms: SecS1F1OfferingTerms;
}) {
  const keyFacts = [
    fact("offering_kind", terms.offering_kind),
    fact("registration_status", terms.registration_status),
    fact("primary_or_resale", terms.primary_or_resale),
    fact("shares_offered", terms.shares_offered),
    fact("resale_share_count", terms.resale_share_count),
    fact("price_range", terms.price_range),
    fact("offering_amount", terms.offering_amount),
    fact("use_of_proceeds", terms.use_of_proceeds),
    fact("lockup_terms", terms.lockup_terms),
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    cover_excerpt: getSection(sections, "cover")?.text || truncate(combinedText, 1_000) || null,
    key_facts: keyFacts.slice(0, 12),
    relevant_sections: sections.slice(0, 10),
    parser_notes: reviewReasons.length ? reviewReasons : ["parser_extracts_candidates_only_no_market_data"],
  };
}

function fact(name: string, fieldValue: SecS1F1Field | SecS1F1CountField | SecS1F1MoneyField | SecS1F1PriceRangeField | SecS1F1Section | null) {
  if (!fieldValue) return null;
  return {
    name,
    value: fieldText(fieldValue),
    evidence: fieldEvidence(fieldValue),
    confidence: fieldValue.confidence,
  };
}

function buildReviewReasons({
  amendment,
  combinedText,
  extractedFieldCount,
  feeTable,
  formType,
  isSupported,
  sections,
  terms,
}: {
  amendment: SecS1F1AmendmentInfo;
  combinedText: string;
  extractedFieldCount: number;
  feeTable: SecS1F1FeeTableSummary;
  formType: string | null;
  isSupported: boolean;
  sections: SecS1F1Section[];
  terms: SecS1F1OfferingTerms;
}) {
  const reasons: string[] = [];
  if (!isSupported) reasons.push(`unsupported_form_${normalizeForm(formType || "unknown") || "unknown"}`);
  if (!combinedText) reasons.push("no_text_available");
  if (terms.offering_kind.value === "unknown") reasons.push("offering_kind_not_classified");
  if (extractedFieldCount < 5) reasons.push("few_s1_f1_fields_extracted");
  if (terms.offering_kind.value === "ipo_listing" && !terms.price_range && !terms.offering_price) reasons.push("ipo_price_terms_not_found");
  if (terms.offering_kind.value === "ipo_listing" && !terms.shares_offered) reasons.push("ipo_share_count_not_found");
  if (terms.offering_kind.value === "resale_registration" && !terms.resale_share_count) reasons.push("resale_share_count_not_found");
  if (terms.selling_stockholders_section && !terms.selling_stockholders.length) reasons.push("selling_stockholders_section_not_table_parsed");
  if (feeTable.present && !feeTable.total_offering_amount && !feeTable.maximum_aggregate_offering_price) reasons.push("fee_table_amount_not_parsed");
  if (terms.offering_kind.value === "mixed_primary_resale") reasons.push("mixed_primary_resale_needs_llm_review");
  if (amendment.is_amendment && !amendment.includes_full_prospectus && amendment.material_change_signal_candidates.length > 0) {
    reasons.push("amendment_change_signals_without_full_prospectus");
  }
  if (getSection(sections, "dilution") && !terms.current_shares_outstanding) reasons.push("dilution_section_without_outstanding_share_count");
  return reasons;
}

function buildSignals(facts: SecS1F1Facts) {
  const signals: string[] = [facts.terms.offering_kind.value];
  if (facts.terms.registration_status?.value) signals.push(`registration_${facts.terms.registration_status.value}`);
  if (facts.terms.price_range || facts.terms.offering_price) signals.push("priced_or_price_range_terms");
  if (facts.terms.resale_share_count || facts.terms.selling_stockholders.length) signals.push("resale_overhang_candidate");
  if (facts.terms.primary_shares_offered) signals.push("primary_dilution_candidate");
  if (facts.terms.warrant_terms) signals.push("warrant_overhang_candidate");
  if (facts.terms.convertible_terms) signals.push("convertible_overhang_candidate");
  if (facts.terms.fee_table.present) signals.push("fee_table_present");
  if (facts.calendar_candidates.length) signals.push("calendar_candidates_present");
  return Array.from(new Set(signals.filter(Boolean)));
}

function buildSummary(facts: SecS1F1Facts) {
  const issuer = facts.issuer || facts.ticker || "Issuer";
  const kind = facts.terms.offering_kind.value.replace(/_/g, " ");
  const shares = facts.terms.shares_offered?.text || facts.terms.resale_share_count?.text || null;
  const price = facts.terms.price_range?.text || facts.terms.offering_price?.text || null;
  const pieces = [`${issuer} ${kind}`];
  if (shares) pieces.push(shares);
  if (price) pieces.push(price);
  return pieces.join("; ");
}

function countExtractedFields(
  terms: SecS1F1OfferingTerms,
  sections: SecS1F1Section[],
  amendment: SecS1F1AmendmentInfo,
) {
  return [
    terms.offering_kind.value !== "unknown" ? terms.offering_kind : null,
    terms.registration_status,
    terms.primary_or_resale,
    terms.shares_offered,
    terms.primary_shares_offered,
    terms.resale_share_count,
    terms.current_shares_outstanding,
    terms.price_range,
    terms.offering_price,
    terms.offering_amount,
    terms.gross_proceeds,
    terms.net_proceeds,
    terms.use_of_proceeds,
    terms.dilution,
    terms.capitalization,
    terms.lockup_terms,
    terms.warrant_terms,
    terms.convertible_terms,
    terms.expected_pricing_date,
    terms.expected_listing_date,
    terms.expected_effective_date,
    terms.expected_closing_date,
    terms.fee_table.present ? terms.fee_table : null,
    amendment.amendment_number,
    amendment.registration_number,
    ...terms.security_type_candidates,
    ...terms.underwriters,
    ...terms.risk_factor_excerpts,
    ...sections,
  ].filter(Boolean).length + terms.selling_stockholders.length;
}

function findMaterialChangeSignals(text: string): SecS1F1Field[] {
  const candidates: SecS1F1Field[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["price_range_change", /\b(?:price range|initial public offering price|offering price)\b/i],
    ["share_count_change", /\b(?:shares offered|number of shares|up to \d[\d,.]* shares)\b/i],
    ["underwriter_change", /\b(?:underwriter|underwriting agreement|representative)\b/i],
    ["selling_stockholder_change", /\bselling\s+(?:stockholders?|shareholders?)\b/i],
    ["fee_table_change", /\b(?:filing fee table|maximum aggregate offering price|registration fee)\b/i],
    ["use_of_proceeds_change", /\buse of proceeds\b/i],
    ["lockup_change", /\block-?up\b/i],
  ];
  for (const [value, pattern] of patterns) pushField(candidates, field(value, text, pattern, "medium"));
  return candidates;
}

function findRegistrationNumber(text: string): SecS1F1Field | null {
  const match = text.match(/\bRegistration\s+(?:No\.?|Number)\s*([0-9-]{6,})\b/i);
  if (!match?.[1]) return null;
  return {
    value: match[1],
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "high",
  };
}

function extractAmendmentExcerpt(text: string) {
  const match = text.match(/\bAmendment\s+No\.?\s*\d+[\s\S]{0,700}?(?:Registration\s+(?:No\.?|Number)\s*[0-9-]+)?/i);
  if (match) return truncate(compactText(match[0]), MAX_EVIDENCE_CHARS);
  const registration = text.match(/\bAs filed with the Securities and Exchange Commission[\s\S]{0,700}?\bFORM\s+[SF]-1\/A\b/i);
  return registration ? truncate(compactText(registration[0]), MAX_EVIDENCE_CHARS) : null;
}

function hasFullProspectusText(text: string) {
  return /\bProspectus Summary\b/i.test(text) && /\bRisk Factors\b/i.test(text) && /\bUse of Proceeds\b/i.test(text);
}

function findInstrumentSection(sections: SecS1F1Section[], label: "warrant_terms" | "convertible_terms") {
  return sections.find((section) => section.label === label) || null;
}

function getSection(sections: SecS1F1Section[], label: SecS1F1SectionLabel) {
  return sections.find((section) => section.label === label) || null;
}

function findDateField(text: string, patterns: RegExp[], value: string): SecS1F1Field | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const dateText = match?.[2] || match?.[1];
    if (!dateText || !parseDateFromText(dateText)) continue;
    return {
      value: dateText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return findSentenceField(text, new RegExp(`\\b${escapeRegExp(value.replace(/_/g, " "))}\\b`, "i"), value);
}

function findSentenceField(text: string, pattern: RegExp, value: string): SecS1F1Field | null {
  const match = text.match(pattern);
  if (!match) return null;
  const evidence = pickEvidenceSentence(text, match.index || 0);
  return {
    value,
    evidence,
    confidence: "medium",
  };
}

function field<T extends string>(
  value: T,
  text: string,
  pattern: RegExp,
  confidence: SecFormParserConfidence,
): SecS1F1Field<T> | null {
  const match = text.match(pattern);
  if (!match) return null;
  return {
    value,
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence,
  };
}

function findCountField(
  text: string,
  patterns: RegExp[],
  confidence: SecFormParserConfidence = "medium",
): SecS1F1CountField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    return buildCountField(match[1], pickEvidenceSentence(text, match.index || 0), confidence);
  }
  return null;
}

function buildCountField(textValue: string, evidence: string, confidence: SecFormParserConfidence): SecS1F1CountField {
  return {
    value: normalizeShareCount(textValue),
    text: compactText(textValue),
    evidence: truncate(evidence, MAX_EVIDENCE_CHARS),
    confidence,
  };
}

function findMoneyField(text: string, patterns: RegExp[]): SecS1F1MoneyField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = compactText(match[1]);
    return {
      value: normalizeMoney(valueText),
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findPriceField(text: string, patterns: RegExp[]): SecS1F1PriceField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = compactText(match[1]);
    return {
      value: {
        price: normalizePrice(valueText),
        currency: valueText.includes("$") ? "USD" : null,
      },
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function buildPercentField(text: string, evidence: string) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match?.[1]) return null;
  return {
    value: Number(match[1]),
    text: `${match[1]}%`,
    evidence: truncate(evidence, MAX_EVIDENCE_CHARS),
    confidence: "medium" as const,
  };
}

function findNextHeadingIndex(text: string, start: number) {
  let next = -1;
  for (const heading of HARD_STOP_HEADINGS) {
    const pattern = new RegExp(`\\n\\s*${escapeRegExp(heading)}\\s*(?:\\n|$)`, "gi");
    pattern.lastIndex = start + 80;
    const match = pattern.exec(text);
    if (match && (next < 0 || match.index < next)) next = match.index;
  }
  return next;
}

function splitSentences(text: string) {
  return compactText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => compactText(sentence))
    .filter((sentence) => sentence.length > 40 && sentence.length < 800);
}

function pickEvidenceSentence(text: string, index: number) {
  const boundedIndex = Math.max(0, Math.min(index, text.length));
  const beforePeriod = text.lastIndexOf(".", boundedIndex - 1);
  const beforeBreak = text.lastIndexOf("\n", boundedIndex - 1);
  const start = Math.max(0, beforePeriod, beforeBreak);
  let end = text.indexOf(".", boundedIndex + 1);
  const nextBreak = text.indexOf("\n", boundedIndex + 1);
  if (nextBreak > 0 && (end < 0 || nextBreak < end)) end = nextBreak;
  if (end < 0) end = Math.min(text.length, boundedIndex + 360);
  else end += 1;
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), MAX_EVIDENCE_CHARS);
}

function normalizeShareCount(value: string) {
  const match = stringValue(value).match(/(\d[\d,.]*)\s*(thousand|million|billion|m|bn|k)?/i);
  if (!match?.[1]) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const scale = match[2]?.toLowerCase();
  if (scale === "thousand" || scale === "k") return base * 1_000;
  if (scale === "million" || scale === "m") return base * 1_000_000;
  if (scale === "billion" || scale === "bn") return base * 1_000_000_000;
  return base;
}

function normalizeMoney(value: string): SecS1F1MoneyField["value"] {
  const text = stringValue(value);
  const match = text.match(/\$?\s*(\d[\d,.]*)\s*(thousand|million|billion|m|bn|k)?/i);
  if (!match?.[1]) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const scale = readScale(match[2] || "");
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return {
    amount: base * multiplier,
    currency: text.includes("$") ? "USD" : null,
    scale,
  };
}

function normalizePrice(value: string) {
  const match = stringValue(value).match(/\$?\s*(\d[\d,.]*)/);
  if (!match?.[1]) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function readScale(value: string): SecS1F1MoneyField["value"]["scale"] {
  const normalized = value.toLowerCase();
  if (normalized === "billion" || normalized === "bn") return "billion";
  if (normalized === "million" || normalized === "m") return "million";
  if (normalized === "thousand" || normalized === "k") return "thousand";
  return "raw";
}

function parseDateFromText(value: string) {
  const match = stringValue(value).match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const day = match[2].padStart(2, "0");
  return month ? `${match[3]}-${month}-${day}` : null;
}

function resolveS1F1FormType(input: SecFormParserInput) {
  return (
    canonicalS1F1FormType(input.formType) ||
    canonicalS1F1FormType(nullableString(readRecord(input.rawPayload)?.form_type)) ||
    canonicalS1F1FormType(nullableString(readRecord(input.metadata)?.form_type)) ||
    canonicalS1F1FormType(readFormTypeFromTitle(input.title))
  );
}

function readFormTypeFromTitle(value: unknown) {
  return stringValue(value).match(/\b(S-1\/A|F-1\/A|S-1|F-1)\b/i)?.[1] || "";
}

function canonicalS1F1FormType(value: string | null | undefined) {
  const normalized = normalizeForm(value || "");
  if (normalized === "S-1") return "S-1";
  if (normalized === "S-1/A") return "S-1/A";
  if (normalized === "F-1") return "F-1";
  if (normalized === "F-1/A") return "F-1/A";
  return null;
}

function normalizeForm(value: string) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "");
}

function readIssuerFromText(text: string) {
  return (
    text.match(/\b(?:FORM\s+[SF]-1(?:\/A)?)[\s\S]{0,420}?\n([A-Z][A-Za-z0-9&.,' -]+?)\s+\|?\s*\(Exact name of registrant/i)?.[1]?.trim() ||
    null
  );
}

function isFeeTableLabel(value: string) {
  return /\b(?:EX-FILING FEES|FILING FEE|FEE TABLE|EX-107|EX107|107)\b/i.test(value);
}

function isLikelyTocBlock(value: string) {
  const text = compactText(value);
  if (/\btable of contents\b/i.test(text.slice(0, 220))) return true;
  const dottedLines = text.split("\n").filter((line) => /\.{4,}\s*\d+\s*$/.test(line)).length;
  return dottedLines >= 3;
}

function isBoilerplateName(value: string) {
  return /\b(?:we|our|the company|underwriters|representative|book-running|lead manager|joint)\b/i.test(value);
}

function pushField<T>(target: T[], value: T | null | undefined) {
  if (value) target.push(value);
}

function dedupeFields<T extends { value: string }>(fields: T[]) {
  const seen = new Set<string>();
  return fields.filter((fieldValue) => {
    const key = fieldValue.value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeSections(sections: SecS1F1Section[]) {
  const seen = new Set<string>();
  return sections.filter((section) => {
    const key = `${section.label}:${section.text.slice(0, 80).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCalendarItems(items: SecFormParserCalendarItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.calendarEventType}:${item.eventDate || ""}:${item.evidence || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fieldEvidence(value: unknown): string {
  const record = readRecord(value);
  if (!record) return "";
  return stringValue(record.evidence || record.text || record.value);
}

function fieldText(value: unknown): string {
  const record = readRecord(value);
  if (!record) return "";
  if (typeof record.text === "string") return record.text;
  if (typeof record.value === "string") return record.value;
  if (record.value && typeof record.value === "object") return JSON.stringify(record.value);
  return stringValue(record.evidence);
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

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
