export const SEC_OFFERING_TERMS_PARSER_VERSION = "sec_offering_terms_parser_v1";

export type SecOfferingTermField<T = string> = {
  value: T;
  text: string;
  evidence: string;
  source: "title" | "primary_document" | "attachment" | "combined_text";
  confidence: "high" | "medium" | "low";
};

export type SecOfferingMoneyField = SecOfferingTermField<{
  amount: number | null;
  currency: "USD" | null;
  scale: "raw" | "thousand" | "million" | "billion" | null;
}>;

export type SecOfferingNumberField = SecOfferingTermField<{
  count: number | null;
}>;

export type SecOfferingPriceField = SecOfferingTermField<{
  price: number | null;
  currency: "USD" | null;
}>;

export type SecOfferingDateField = SecOfferingTermField<{
  isoDate: string | null;
}>;

export type SecOfferingTerms = {
  parser_version: typeof SEC_OFFERING_TERMS_PARSER_VERSION;
  form_type: string | null;
  document_family: string;
  offering_type: SecOfferingTermField | null;
  security_type: SecOfferingTermField | null;
  primary_or_resale: SecOfferingTermField | null;
  registration_status: SecOfferingTermField | null;
  prospectus_type: SecOfferingTermField | null;
  offering_amount: SecOfferingMoneyField | null;
  shelf_capacity: SecOfferingMoneyField | null;
  amount_remaining: SecOfferingMoneyField | null;
  atm_program_size: SecOfferingMoneyField | null;
  shares_offered: SecOfferingNumberField | null;
  resale_share_count: SecOfferingNumberField | null;
  current_shares_outstanding: SecOfferingNumberField | null;
  public_float: SecOfferingNumberField | SecOfferingMoneyField | null;
  authorized_shares: SecOfferingNumberField | null;
  offering_price: SecOfferingPriceField | null;
  warrant_coverage: SecOfferingTermField | null;
  warrant_exercise_price: SecOfferingPriceField | null;
  conversion_price: SecOfferingPriceField | null;
  use_of_proceeds: SecOfferingTermField | null;
  sales_agent: SecOfferingTermField | null;
  selling_shareholders: SecOfferingTermField | null;
  effective_date: SecOfferingDateField | null;
  closing_date: SecOfferingDateField | null;
  extracted_field_count: number;
  text_stats: {
    title_chars: number;
    primary_chars: number;
    attachment_chars: number;
    combined_chars: number;
  };
  needs_human_review: boolean;
  review_reasons: string[];
};

export type SecOfferingTermsParserInput = {
  formType?: string | null;
  title?: string | null;
  primaryDocumentText?: string | null;
  attachmentTexts?: Array<{
    type?: string | null;
    description?: string | null;
    text?: string | null;
  }> | null;
  text?: string | null;
};

type SourceText = {
  source: SecOfferingTermField["source"];
  text: string;
};

type FieldMatch = {
  match: string;
  valueText: string;
  source: SecOfferingTermField["source"];
};

type KeywordRule = {
  value: string;
  pattern: RegExp;
  confidence?: SecOfferingTermField["confidence"];
};

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

export function parseSecOfferingTerms(input: SecOfferingTermsParserInput): SecOfferingTerms {
  const sources = buildSources(input);
  const combinedText = compactText(sources.map((source) => source.text).join("\n\n"));
  const titleText = compactText(input.title || "");
  const primaryText = compactText(input.primaryDocumentText || input.text || "");
  const attachmentText = compactText((input.attachmentTexts || []).map((item) => item.text || "").join("\n\n"));

  const offeringType = findKeywordField(sources, OFFERING_TYPE_RULES);
  const securityType = findKeywordField(sources, SECURITY_TYPE_RULES);
  const primaryOrResale = findPrimaryOrResale(sources);
  const registrationStatus = findKeywordField(sources, REGISTRATION_STATUS_RULES);
  const prospectusType = findProspectusType(sources, input.formType);
  const offeringAmount = findMoneyField(sources, OFFERING_AMOUNT_PATTERNS);
  const shelfCapacity = findMoneyField(sources, SHELF_CAPACITY_PATTERNS);
  const amountRemaining = findMoneyField(sources, AMOUNT_REMAINING_PATTERNS);
  const atmProgramSize = findMoneyField(sources, ATM_PROGRAM_SIZE_PATTERNS);
  let sharesOffered = findShareCountField(sources, SHARES_OFFERED_PATTERNS);
  const resaleShareCount = findShareCountField(sources, RESALE_SHARE_COUNT_PATTERNS);
  const currentSharesOutstanding = findShareCountField(sources, CURRENT_SHARES_OUTSTANDING_PATTERNS);
  const publicFloat = findPublicFloat(sources);
  const authorizedShares = findShareCountField(sources, AUTHORIZED_SHARES_PATTERNS);
  let offeringPrice = findPriceField(sources, OFFERING_PRICE_PATTERNS);
  let warrantCoverage = findSentenceField(sources, WARRANT_COVERAGE_PATTERNS);
  let warrantExercisePrice = findPriceField(sources, WARRANT_EXERCISE_PRICE_PATTERNS);
  let conversionPrice = findPriceField(sources, CONVERSION_PRICE_PATTERNS);
  const useOfProceeds = findUseOfProceeds(sources);
  const salesAgent = findSalesAgent(sources);
  const sellingShareholders = findSellingShareholders(sources);
  const effectiveDate = findDateField(sources, EFFECTIVE_DATE_PATTERNS);
  const closingDate = findDateField(sources, CLOSING_DATE_PATTERNS);
  const contextPrunedFields = pruneFieldsForOfferingContext({
    offeringType,
    sharesOffered,
    offeringPrice,
    warrantCoverage,
    warrantExercisePrice,
    conversionPrice,
  });
  sharesOffered = contextPrunedFields.sharesOffered;
  offeringPrice = contextPrunedFields.offeringPrice;
  warrantCoverage = contextPrunedFields.warrantCoverage;
  warrantExercisePrice = contextPrunedFields.warrantExercisePrice;
  conversionPrice = contextPrunedFields.conversionPrice;

  const fields = [
    offeringType,
    securityType,
    primaryOrResale,
    registrationStatus,
    prospectusType,
    offeringAmount,
    shelfCapacity,
    amountRemaining,
    atmProgramSize,
    sharesOffered,
    resaleShareCount,
    currentSharesOutstanding,
    publicFloat,
    authorizedShares,
    offeringPrice,
    warrantCoverage,
    warrantExercisePrice,
    conversionPrice,
    useOfProceeds,
    salesAgent,
    sellingShareholders,
    effectiveDate,
    closingDate,
  ];
  const extractedFieldCount = fields.filter(Boolean).length;
  const reviewReasons = buildReviewReasons({
    combinedText,
    extractedFieldCount,
    offeringAmount,
    offeringPrice,
    offeringType,
    primaryOrResale,
    registrationStatus,
    sharesOffered,
  });

  return {
    parser_version: SEC_OFFERING_TERMS_PARSER_VERSION,
    form_type: normalizeString(input.formType) || null,
    document_family: classifyOfferingDocumentFamily(input.formType),
    offering_type: offeringType,
    security_type: securityType,
    primary_or_resale: primaryOrResale,
    registration_status: registrationStatus,
    prospectus_type: prospectusType,
    offering_amount: offeringAmount,
    shelf_capacity: shelfCapacity,
    amount_remaining: amountRemaining,
    atm_program_size: atmProgramSize,
    shares_offered: sharesOffered,
    resale_share_count: resaleShareCount,
    current_shares_outstanding: currentSharesOutstanding,
    public_float: publicFloat,
    authorized_shares: authorizedShares,
    offering_price: offeringPrice,
    warrant_coverage: warrantCoverage,
    warrant_exercise_price: warrantExercisePrice,
    conversion_price: conversionPrice,
    use_of_proceeds: useOfProceeds,
    sales_agent: salesAgent,
    selling_shareholders: sellingShareholders,
    effective_date: effectiveDate,
    closing_date: closingDate,
    extracted_field_count: extractedFieldCount,
    text_stats: {
      title_chars: titleText.length,
      primary_chars: primaryText.length,
      attachment_chars: attachmentText.length,
      combined_chars: combinedText.length,
    },
    needs_human_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
  };
}

export function classifyOfferingDocumentFamily(formType?: string | null) {
  const form = normalizeString(formType).toUpperCase();
  if (!form) return "unknown";
  if (form.startsWith("424B")) return "prospectus_supplement";
  if (form === "EFFECT") return "registration_effectiveness";
  if (form === "FWP") return "free_writing_prospectus";
  if (/^S-[138]/.test(form) || /^F-[13]/.test(form)) return "registration_statement";
  if (form === "8-K" || form === "8-K/A") return "current_report";
  if (form === "6-K" || form === "6-K/A") return "foreign_current_report";
  return "other";
}

const OFFERING_TYPE_RULES: KeywordRule[] = [
  { value: "at_the_market_offering", pattern: /\b(?:at-the-market|at the market|ATM offering|ATM program|equity distribution agreement|sales agreement prospectus)\b/i },
  { value: "registered_direct", pattern: /\bregistered direct\b/i },
  { value: "warrant_terms", pattern: /\b(?:warrant indenture|warrant agreement|warrants? to purchase|up to\s+[\d,.]+\s+warrants?)\b/i },
  { value: "private_placement", pattern: /\bprivate placement\b/i },
  { value: "shelf_registration", pattern: /\b(?:shelf registration|shelf offering|shelf prospectus|universal shelf)\b/i },
  { value: "resale_registration", pattern: /\b(?:resale registration|resale prospectus|selling stockholders?|selling shareholders?)\b/i },
  { value: "rights_offering", pattern: /\brights offering\b/i },
  { value: "warrant_exercise", pattern: /\b(?:exercise of warrants|warrant exercise|warrants? to purchase)\b/i },
  { value: "convertible_financing", pattern: /\b(?:convertible note|convertible debenture|convertible preferred|convert into shares)\b/i },
  { value: "public_offering", pattern: /\b(?:public offering|underwritten offering)\b/i },
];

const SECURITY_TYPE_RULES: KeywordRule[] = [
  { value: "common_stock", pattern: /\bcommon stock\b/i },
  { value: "common_shares", pattern: /\bcommon shares?\b/i },
  { value: "ordinary_shares", pattern: /\bordinary shares?\b/i },
  { value: "ads", pattern: /\b(?:ADSs?|American Depositary Shares?)\b/i },
  { value: "pre_funded_warrants", pattern: /\bpre-funded warrants?\b/i },
  { value: "warrants", pattern: /\bwarrants?\b/i },
  { value: "units", pattern: /\bunits?\b/i },
  { value: "convertible_notes", pattern: /\bconvertible (?:notes?|debentures?)\b/i },
  { value: "preferred_stock", pattern: /\bpreferred (?:stock|shares?)\b/i },
];

const REGISTRATION_STATUS_RULES: KeywordRule[] = [
  { value: "effective", pattern: /\b(?:registration statement|shelf registration statement)\b[^.]{0,180}\b(?:declared effective|became effective|is effective)\b/i },
  { value: "filed_not_effective", pattern: /\b(?:registration statement)\b[^.]{0,180}\b(?:not yet effective|not effective|subject to completion)\b/i },
  { value: "post_effective_amendment", pattern: /\bpost-effective amendment\b/i },
];

const OFFERING_AMOUNT_PATTERNS = [
  /\b(?:gross proceeds of|net proceeds of|aggregate gross proceeds of|aggregate offering price of|aggregate amount of|offering amount of)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
  /\b(?:up to|for up to|offer and sell up to)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)\b/i,
];

const SHELF_CAPACITY_PATTERNS = [
  /\b(?:shelf registration statement|universal shelf|registration statement)\b[^.]{0,220}?\b(?:up to|aggregate offering price of|aggregate amount of)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
];

const AMOUNT_REMAINING_PATTERNS = [
  /\b(?:remaining|remain available|remaining available|available for future issuance)\b[^.]{0,180}?(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
];

const ATM_PROGRAM_SIZE_PATTERNS = [
  /\b(?:at-the-market|at the market|ATM|sales agreement|equity distribution agreement)\b[^.]{0,220}?\b(?:up to|aggregate offering price of|aggregate sales price of)\s+(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
];

const SHARES_OFFERED_PATTERNS = [
  /\b(?:offering of|offer and sell|offering up to|offer up to|issuance of|issue and sell|sell up to)\s+([\d,.]+\s*(?:ordinary shares|common shares|shares of common stock|shares|ADSs?|units))\b/i,
  /\bup to\s+([\d,.]+\s*(?:ordinary shares|common shares|shares of common stock|shares|ADSs?|units))\b/i,
];

const RESALE_SHARE_COUNT_PATTERNS = [
  /\b(?:resale of|resell up to|selling stockholders? may sell|selling shareholders? may sell|sell up to)\s+([\d,.]+\s*(?:ordinary shares|common shares|shares of common stock|shares|ADSs?|units))\b/i,
];

const CURRENT_SHARES_OUTSTANDING_PATTERNS = [
  /\b([\d,.]+\s*(?:ordinary shares|common shares|shares of common stock|shares))\s+(?:were|are)?\s*(?:issued and outstanding|outstanding)\b/i,
  /\b(?:issued and outstanding|outstanding)\s+([\d,.]+\s*(?:ordinary shares|common shares|shares of common stock|shares))\b/i,
];

const AUTHORIZED_SHARES_PATTERNS = [
  /\bauthorized\b[^.]{0,160}?([\d,.]+\s*(?:ordinary shares|common shares|shares of common stock|shares))\b/i,
];

const OFFERING_PRICE_PATTERNS = [
  /\b(?:offering price|purchase price|price per share|public offering price|sales price|at a price of)\s*(?:of)?\s*(\$[\d,.]+)\b/i,
];

const WARRANT_EXERCISE_PRICE_PATTERNS = [
  /\b(?:exercise price|exercisable at|warrant exercise price)\s*(?:of)?\s*(\$[\d,.]+)\b/i,
];

const CONVERSION_PRICE_PATTERNS = [
  /\b(?:conversion price|convertible at|conversion rate based on|convert into shares at)\s*(?:of)?\s*(\$[\d,.]+)\b/i,
];

const WARRANT_COVERAGE_PATTERNS = [
  /\bup to\s+[\d,.]+\s+warrants?\b/i,
  /\bwarrants?\s+to\s+purchase\b/i,
  /\bwarrant coverage\b/i,
  /\bpre-funded warrants?\b/i,
];

const EFFECTIVE_DATE_PATTERNS = [
  /\b(?:declared effective|became effective|is effective|effective date)\b/i,
];

const CLOSING_DATE_PATTERNS = [
  /\b(?:closing date|expected to close|closed on|the closing)\b/i,
];

function buildSources(input: SecOfferingTermsParserInput): SourceText[] {
  const sources: SourceText[] = [];
  const title = compactText(input.title || "");
  const primary = compactText(input.primaryDocumentText || input.text || "");
  const attachments = compactText((input.attachmentTexts || []).map(formatAttachmentText).join("\n\n"));

  if (title) sources.push({ source: "title", text: title });
  if (primary) sources.push({ source: "primary_document", text: primary });
  if (attachments) sources.push({ source: "attachment", text: attachments });
  if (!sources.length) {
    const text = compactText(input.text || "");
    if (text) sources.push({ source: "combined_text", text });
  }

  return sources;
}

function formatAttachmentText(item: { type?: string | null; description?: string | null; text?: string | null }) {
  const label = [item.type, item.description].map((value) => normalizeString(value)).filter(Boolean).join(" - ");
  const text = compactText(item.text || "");
  return label ? `${label}\n${text}` : text;
}

function findKeywordField(sources: SourceText[], rules: KeywordRule[]) {
  for (const rule of rules) {
    const found = findSentenceMatch(sources, rule.pattern);
    if (!found) continue;
    return termField(rule.value, found.valueText, found.match, found.source, rule.confidence || "high");
  }
  return null;
}

function findPrimaryOrResale(sources: SourceText[]) {
  for (const source of sources) {
    const text = source.text;
    const resale = /\b(?:resale|selling stockholders?|selling shareholders?)\b/i.test(text);
    const primary = /\b(?:we may offer|we are offering|company is offering|offer and sell|gross proceeds|net proceeds|sales agreement|at-the-market|registered direct|private placement)\b/i.test(text);
    if (primary && !resale) {
      const found = findSentenceMatch([source], /\b(?:we may offer|we are offering|offer and sell|gross proceeds|net proceeds|sales agreement|at-the-market|registered direct|private placement)\b/i);
      return found ? termField("primary", "primary", found.match, found.source, "high") : null;
    }
    if (resale && !primary) {
      const found = findSentenceMatch([source], /\b(?:resale|selling stockholders?|selling shareholders?)\b/i);
      return found ? termField("resale", "resale", found.match, found.source, "high") : null;
    }
  }

  const combined = sources.map((source) => source.text).join("\n");
  const resale = /\b(?:resale|selling stockholders?|selling shareholders?)\b/i.test(combined);
  const primary = /\b(?:we may offer|we are offering|company is offering|offer and sell|gross proceeds|net proceeds|sales agreement|at-the-market|registered direct|private placement)\b/i.test(combined);
  if (primary && resale) {
    const found = findSentenceMatch(sources, /\b(?:resale|selling stockholders?|selling shareholders?|gross proceeds|net proceeds|sales agreement|at-the-market|registered direct|private placement)\b/i);
    return found ? termField("mixed", "mixed", found.match, found.source, "medium") : null;
  }
  if (primary) {
    const found = findSentenceMatch(sources, /\b(?:we may offer|we are offering|offer and sell|gross proceeds|net proceeds|sales agreement|at-the-market|registered direct|private placement)\b/i);
    return found ? termField("primary", "primary", found.match, found.source, "high") : null;
  }
  if (resale) {
    const found = findSentenceMatch(sources, /\b(?:resale|selling stockholders?|selling shareholders?)\b/i);
    return found ? termField("resale", "resale", found.match, found.source, "high") : null;
  }
  return null;
}

function findProspectusType(sources: SourceText[], formType?: string | null) {
  const form = normalizeString(formType).toUpperCase();
  if (form.startsWith("424B")) {
    const found = findSentenceMatch(sources, /\bprospectus supplement\b/i);
    return termField("prospectus_supplement", "prospectus supplement", found?.match || form, found?.source || "combined_text", "high");
  }
  const found = findKeywordField(sources, [
    { value: "prospectus_supplement", pattern: /\bprospectus supplement\b/i },
    { value: "base_prospectus", pattern: /\bbase prospectus\b/i },
    { value: "free_writing_prospectus", pattern: /\bfree writing prospectus\b/i },
  ]);
  return found;
}

function findMoneyField(sources: SourceText[], patterns: RegExp[]): SecOfferingMoneyField | null {
  const found = findCapturedMatch(sources, patterns);
  if (!found) return null;
  const normalized = normalizeMoney(found.valueText);
  return {
    value: normalized,
    text: found.valueText,
    evidence: found.match,
    source: found.source,
    confidence: normalized.amount === null ? "medium" : "high",
  };
}

function findShareCountField(sources: SourceText[], patterns: RegExp[]): SecOfferingNumberField | null {
  const found = findCapturedMatch(sources, patterns);
  if (!found) return null;
  const count = normalizeShareCount(found.valueText);
  return {
    value: { count },
    text: found.valueText,
    evidence: found.match,
    source: found.source,
    confidence: count === null ? "medium" : "high",
  };
}

function findPriceField(sources: SourceText[], patterns: RegExp[]): SecOfferingPriceField | null {
  const found = findCapturedMatch(sources, patterns);
  if (!found) return null;
  const price = normalizePrice(found.valueText);
  return {
    value: {
      price,
      currency: price === null ? null : "USD",
    },
    text: found.valueText,
    evidence: found.match,
    source: found.source,
    confidence: price === null ? "medium" : "high",
  };
}

function findPublicFloat(sources: SourceText[]): SecOfferingNumberField | SecOfferingMoneyField | null {
  const found = findCapturedMatch(sources, [
    /\bpublic float\b[^.]{0,140}?(\$[\d,.]+\s*(?:thousand|million|billion|m|bn)?)/i,
    /\bpublic float\b[^.]{0,140}?([\d,.]+\s*(?:ordinary shares|common shares|shares of common stock|shares))\b/i,
  ]);
  if (!found) return null;
  if (found.valueText.includes("$")) {
    return {
      value: normalizeMoney(found.valueText),
      text: found.valueText,
      evidence: found.match,
      source: found.source,
      confidence: "high",
    };
  }
  return {
    value: { count: normalizeShareCount(found.valueText) },
    text: found.valueText,
    evidence: found.match,
    source: found.source,
    confidence: "high",
  };
}

function findSentenceField(sources: SourceText[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const found = findSentenceMatch(sources, pattern);
    if (found) return termField(found.valueText, found.valueText, found.match, found.source, "high");
  }
  return null;
}

function findUseOfProceeds(sources: SourceText[]) {
  const heading = findSectionAfterHeading(sources, "use of proceeds");
  if (heading && isLikelyUseOfProceedsText(heading.valueText)) {
    return termField(heading.valueText, heading.valueText, heading.match, heading.source, "high");
  }
  const found =
    findSentenceMatch(sources, /\b(?:we|the company|the issuer)\s+(?:currently\s+)?(?:intend|intends|expect|expects|plan|plans)\s+to\s+use\b/i) ||
    findSentenceMatch(sources, /\bnet proceeds\b[^.]{0,220}\b(?:working capital|general corporate purposes|repay|debt|research|development|operations|acquisition)\b/i);
  if (!found || !isLikelyUseOfProceedsText(found.valueText)) return null;
  return termField(found.valueText, found.valueText, found.match, found.source, "high");
}

function pruneFieldsForOfferingContext({
  offeringType,
  sharesOffered,
  offeringPrice,
  warrantCoverage,
  warrantExercisePrice,
  conversionPrice,
}: {
  offeringType: SecOfferingTermField | null;
  sharesOffered: SecOfferingNumberField | null;
  offeringPrice: SecOfferingPriceField | null;
  warrantCoverage: SecOfferingTermField | null;
  warrantExercisePrice: SecOfferingPriceField | null;
  conversionPrice: SecOfferingPriceField | null;
}) {
  const prunedSharesOffered = isNonOfferingShareSupplyEvidence(sharesOffered?.evidence) ? null : sharesOffered;
  const prunedWarrantCoverage = isGenericWarrantDescription(warrantCoverage?.evidence) ? null : warrantCoverage;

  if (offeringType?.value !== "at_the_market_offering") {
    return { sharesOffered: prunedSharesOffered, offeringPrice, warrantCoverage: prunedWarrantCoverage, warrantExercisePrice, conversionPrice };
  }

  return {
    sharesOffered: hasHistoricalOfferingEvidence(prunedSharesOffered?.evidence) ? null : prunedSharesOffered,
    offeringPrice: isAtmCompatiblePriceEvidence(offeringPrice?.evidence) ? offeringPrice : null,
    warrantCoverage: isAtmCompatibleDerivativeEvidence(prunedWarrantCoverage?.evidence) ? prunedWarrantCoverage : null,
    warrantExercisePrice: isAtmCompatibleDerivativeEvidence(warrantExercisePrice?.evidence) ? warrantExercisePrice : null,
    conversionPrice: isAtmCompatibleDerivativeEvidence(conversionPrice?.evidence) ? conversionPrice : null,
  };
}

function isNonOfferingShareSupplyEvidence(value?: string) {
  const text = compactText(value || "");
  if (!text) return false;
  if (/\b(?:authorized\s+(?:capital\s+stock|shares?|preferred\s+stock)|we\s+are\s+authorized\s+to\s+issue|capital\s+stock\s+consists|description\s+of\s+capital\s+stock|blank\s+check\s+preferred|undesignated\s+preferred|fee\s+table|calculated\s+solely|public\s+float|available\s+for\s+future\s+issuance|employee\s+stock\s+purchase\s+plan|equity\s+incentive\s+plan|inducement\s+plan|stock\s+option\s+plan|compensation\s+plan|benefit\s+plan)\b/i.test(text)) {
    return true;
  }
  return /\bpreferred stock\b/i.test(text) && !/\b(?:common stock|convertible|conversion|underlying|issuable|resale|selling stockholders?)\b/i.test(text);
}

function isGenericWarrantDescription(value?: string) {
  const text = compactText(value || "");
  if (!text) return false;
  return (
    /\b(?:we may issue|we may offer|may be issued|may be offered)\b[\s\S]{0,220}\bwarrants?\b/i.test(text) ||
    /\bapplicable prospectus supplement\b[\s\S]{0,220}\bwarrants?\b/i.test(text) ||
    /\bin the case of warrants?\b/i.test(text) ||
    /\bas the case may be\b[\s\S]{0,180}\bwarrants?\b/i.test(text)
  );
}

function hasHistoricalOfferingEvidence(value?: string) {
  const text = compactText(value || "");
  return /\b(?:registered direct offering|prior offering|previous offering|previously issued|securities purchase agreement)\b/i.test(text);
}

function isAtmCompatiblePriceEvidence(value?: string) {
  const text = compactText(value || "");
  if (!text) return false;
  if (hasHistoricalOfferingEvidence(text)) return false;
  return /\b(?:at-the-market|at the market|sales price|market price|prevailing market prices|actual sales price)\b/i.test(text);
}

function isAtmCompatibleDerivativeEvidence(value?: string) {
  const text = compactText(value || "");
  if (!text) return false;
  if (hasHistoricalOfferingEvidence(text)) return false;
  return /\b(?:at-the-market|at the market|this offering|concurrent offering)\b/i.test(text);
}

function findSalesAgent(sources: SourceText[]) {
  const found = findCapturedMatch(sources, [
    /\b(?:sales agreement with|equity distribution agreement with)\s+([A-Z][A-Za-z0-9&.,'\-\s]{2,120}?(?:Securities|Capital|Markets|Partners|LLC|Inc\.?|Co\.?|Bank|B\. Riley|Roth|Maxim|H\.C\. Wainwright))\b/,
    /\b(?:acting as|as)\s+(?:sales agent|placement agent|underwriter)[^.]{0,100}?\b([A-Z][A-Za-z0-9&.,'\-\s]{2,120}?(?:Securities|Capital|Markets|Partners|LLC|Inc\.?|Co\.?|Bank))\b/,
  ]);
  if (!found || !isLikelyAgentName(found.valueText)) return null;
  return termField(found.valueText, found.valueText, found.match, found.source, "medium");
}

function findSellingShareholders(sources: SourceText[]) {
  const found = findSentenceMatch(sources, /\b(?:selling stockholders?|selling shareholders?)\b/i);
  return found ? termField(found.valueText, found.valueText, found.match, found.source, "medium") : null;
}

function findDateField(sources: SourceText[], patterns: RegExp[]): SecOfferingDateField | null {
  for (const pattern of patterns) {
    const found = findSentenceMatch(sources, pattern);
    if (!found) continue;
    const dateText = findDateText(found.match);
    if (!dateText) continue;
    return {
      value: { isoDate: normalizeDate(dateText) },
      text: dateText || found.valueText,
      evidence: found.match,
      source: found.source,
      confidence: dateText ? "medium" : "low",
    };
  }
  return null;
}

function findCapturedMatch(sources: SourceText[], patterns: RegExp[]): FieldMatch | null {
  for (const source of sources) {
    for (const pattern of patterns) {
      const match = source.text.match(pattern);
      if (!match?.[1]) continue;
      return {
        match: pickEvidenceSentence(source.text, match.index || 0),
        valueText: match[1].trim(),
        source: source.source,
      };
    }
  }
  return null;
}

function findSentenceMatch(sources: SourceText[], pattern: RegExp): FieldMatch | null {
  for (const source of sources) {
    const match = source.text.match(pattern);
    if (!match) continue;
    const evidence = pickEvidenceSentence(source.text, match.index || 0);
    return {
      match: evidence,
      valueText: evidence,
      source: source.source,
    };
  }
  return null;
}

function findSectionAfterHeading(sources: SourceText[], heading: string): FieldMatch | null {
  const headingPattern = new RegExp(`\\b${escapeRegExp(heading)}\\b`, "i");
  for (const source of sources) {
    const match = source.text.match(headingPattern);
    if (!match) continue;
    const start = match.index || 0;
    const text = source.text.slice(start + match[0].length, start + 1_100);
    const cleaned = text
      .split(/\n{2,}|(?=\b[A-Z][A-Za-z\s]{2,40}\b\s*\n)/)
      .map((part) => part.trim())
      .find((part) => part.length > 30 && !isNoisyProspectusNavigation(part));
    if (!cleaned) continue;
    const evidence = truncateEvidence(cleaned);
    return {
      match: evidence,
      valueText: evidence,
      source: source.source,
    };
  }
  return null;
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
  return truncateEvidence(text.slice(start > 0 ? start + 1 : start, end).trim());
}

function truncateEvidence(value: string) {
  const text = compactText(value);
  return text.length > 420 ? `${text.slice(0, 417).trim()}...` : text;
}

function isNoisyProspectusNavigation(value: string) {
  const text = compactText(value);
  if (/\b(?:table of contents|where you can find more information|incorporation of certain information by reference)\b/i.test(text)) {
    return true;
  }
  if (/^(?:S-)?\d+\s*\|/.test(text)) return true;
  if ((text.match(/\|/g) || []).length >= 2 && text.length < 220) return true;
  return false;
}

function isLikelyUseOfProceedsText(value: string) {
  const text = compactText(value);
  if (isNoisyProspectusNavigation(text)) return false;
  if (!/\bproceeds\b/i.test(text)) return false;
  return /\b(?:use|uses|intend|intends|expect|expects|working capital|general corporate purposes|repay|debt|research|development|operations|acquisition)\b/i.test(text);
}

function isLikelyAgentName(value: string) {
  const text = compactText(value);
  if (!text || text.length > 140) return false;
  if (/\b(?:Securities Act|Exchange Act|civil liabilities|registration statement|prospectus)\b/i.test(text)) return false;
  return /\b(?:Securities|Capital|Markets|Partners|LLC|Inc\.?|Co\.?|Bank|B\. Riley|Roth|Maxim|H\.C\. Wainwright)\b/.test(text);
}

function termField(
  value: string,
  text: string,
  evidence: string,
  source: SecOfferingTermField["source"],
  confidence: SecOfferingTermField["confidence"],
): SecOfferingTermField {
  return {
    value,
    text,
    evidence,
    source,
    confidence,
  };
}

function normalizeMoney(value: string): SecOfferingMoneyField["value"] {
  const text = normalizeString(value);
  const numberMatch = text.match(/\$?\s*([\d,.]+)/);
  if (!numberMatch) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const base = Number(numberMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const scale = readScale(text);
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return {
    amount: base * multiplier,
    currency: text.includes("$") ? "USD" : null,
    scale,
  };
}

function normalizeShareCount(value: string) {
  const text = normalizeString(value);
  const numberMatch = text.match(/([\d,.]+)/);
  if (!numberMatch) return null;
  const base = Number(numberMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const scale = readScale(text);
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return base * multiplier;
}

function normalizePrice(value: string) {
  const numberMatch = normalizeString(value).match(/\$?\s*([\d,.]+)/);
  if (!numberMatch) return null;
  const price = Number(numberMatch[1].replace(/,/g, ""));
  return Number.isFinite(price) ? price : null;
}

function readScale(value: string): SecOfferingMoneyField["value"]["scale"] {
  if (/\bb(?:illion|n)?\b/i.test(value)) return "billion";
  if (/\bm(?:illion)?\b/i.test(value)) return "million";
  if (/\bthousand\b/i.test(value)) return "thousand";
  return "raw";
}

function findDateText(value: string) {
  return (
    value.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i)?.[0] ||
    value.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/)?.[0] ||
    ""
  );
}

function normalizeDate(value: string) {
  const text = normalizeString(value);
  const longDate = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (longDate) {
    const month = MONTHS[longDate[1].toLowerCase()];
    const day = longDate[2].padStart(2, "0");
    return `${longDate[3]}-${month}-${day}`;
  }
  const slashDate = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (slashDate) {
    const year = slashDate[3].length === 2 ? `20${slashDate[3]}` : slashDate[3];
    return `${year}-${slashDate[1].padStart(2, "0")}-${slashDate[2].padStart(2, "0")}`;
  }
  return null;
}

function buildReviewReasons({
  combinedText,
  extractedFieldCount,
  offeringAmount,
  offeringPrice,
  offeringType,
  primaryOrResale,
  registrationStatus,
  sharesOffered,
}: {
  combinedText: string;
  extractedFieldCount: number;
  offeringAmount: SecOfferingMoneyField | null;
  offeringPrice: SecOfferingPriceField | null;
  offeringType: SecOfferingTermField | null;
  primaryOrResale: SecOfferingTermField | null;
  registrationStatus: SecOfferingTermField | null;
  sharesOffered: SecOfferingNumberField | null;
}) {
  const reasons: string[] = [];
  if (!combinedText) reasons.push("no_text_available");
  if (combinedText && extractedFieldCount < 3) reasons.push("few_terms_extracted");
  if (!offeringType) reasons.push("offering_type_not_found");
  if (!primaryOrResale) reasons.push("primary_or_resale_not_found");
  if (!offeringAmount && !sharesOffered) reasons.push("offering_size_not_found");
  if (
    offeringType?.value !== "at_the_market_offering" &&
    /\b(?:priced|purchase price|offering price|registered direct|private placement)\b/i.test(combinedText) &&
    !offeringPrice
  ) {
    reasons.push("price_language_without_price_extract");
  }
  if (/\bregistration statement\b/i.test(combinedText) && !registrationStatus) reasons.push("registration_status_not_found");
  return reasons;
}

function compactText(value: string) {
  return normalizeString(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function normalizeString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
