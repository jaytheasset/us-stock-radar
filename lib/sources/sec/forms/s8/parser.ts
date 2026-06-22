import type {
  S8Attachment,
  S8ConsultantAdvisorContext,
  S8DetectedSection,
  S8FeeTableRow,
  S8FixtureInput,
  S8InducementAward,
  S8ParserOutput,
  S8PlanNameFact,
  S8PlanShareAllocation,
  S8PriorRegistrationStatement,
  S8RawSourceDocument,
  S8NoiseCandidate,
  S8NormalizedFilingType,
  S8ReverseSplitAdjustment,
  S8SellingSecurityholder,
} from "./types";

export const S8_PARSER_VERSION = "s8-parser-v1";

const CONTEXTUAL_SHARE_PATTERNS = [
  /register(?:s|ed|ing)?\s+(?:the\s+)?(?:offer\s+and\s+sale\s+of\s+)?(?:an\s+aggregate\s+of\s+)?(?:up to\s+|an additional\s+|additional\s+)?([\d,]+)\s+(?:shares|ordinary shares|common shares|class [a-z] common shares|american depositary shares|ads(?:s)?)/gi,
  /(?:registers?|registered|registering|covers?|relates\s+to)\s+(?:an\s+aggregate\s+of\s+)?(?:up to\s+|an additional\s+|additional\s+)?([\d,]+)\s+(?:shares|ordinary shares|common shares|class [a-z] common shares|american depositary shares|ads(?:s)?)/gi,
  /which\s+([\d,]+)\s+(?:shares|ordinary shares|common shares|class [a-z] common shares|american depositary shares|ads(?:s)?)\s+(?:are\s+)?being\s+registered/gi,
  /maximum\s+aggregate\s+number\s+of\s+securities\s+to\s+be\s+registered[:\s]+([\d,]+)/gi,
  /number\s+of\s+shares\s+to\s+be\s+registered[:\s]+([\d,]+)/gi,
];

const BROAD_SHARE_PATTERN =
  /([\d,]+)\s+(?:shares|ordinary shares|common shares|class [a-z] common shares|american depositary shares|ads(?:s)?)\s+(?:of\s+)?(?:common stock|ordinary shares|class [a-z] common stock|common shares)/gi;

const PLAN_PATTERN =
  /(?:under|pursuant to|relating to|relates to|for|in connection with|available under)\s+(?:the\s+)?([A-Z0-9][A-Za-z0-9&,.()' -]{2,140}?(?:Plan|Program|Agreement|Arrangement|Award|Inducement Plan|Stock Plan|Incentive Plan))/g;
const PLAN_NAME_TEXT =
  String.raw`[A-Z0-9][A-Za-z0-9&,.()' -]{0,160}?(?:(?:Equity|Stock|Management)\s+Incentive|Employee\s+Stock\s+Purchase|ESPP|Inducement|Stock\s+Option|Restricted\s+Stock\s+Unit|401\(k\)|Savings|Retirement)[A-Za-z0-9&,.()' -]{0,80}?Plan`;

type FeeTableSource = NonNullable<S8FeeTableRow["source"]>;
type FeeTableExtraction = {
  rows: S8FeeTableRow[];
  source: S8ParserOutput["facts"]["feeTableSource"];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  rule416: boolean;
  planInterests: boolean;
  unusualSecurities: boolean;
};
type PlanSource = S8PlanNameFact["sources"][number];
type PlanExtraction = {
  planNames: string[];
  planNameFacts: S8PlanNameFact[];
  allocations: S8PlanShareAllocation[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
};
type ConsultantAdvisorExtraction = {
  contexts: S8ConsultantAdvisorContext[];
  hasSubstantiveContext: boolean;
  hasFinancingOrPromotionContext: boolean;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};
type SellingHolderExtraction = {
  holders: S8SellingSecurityholder[];
  confidence: "high" | "medium" | "low";
  warnings: string[];
  hasSellingHolderContext: boolean;
};

export function parseS8Filing(input: S8FixtureInput): S8ParserOutput {
  const rawAttachmentText = (input.attachments ?? []).map((attachment) => attachment.text ?? "").join(" ");
  const rawFullText = `${input.filingText} ${rawAttachmentText}`;
  const text = normalizeText(input.filingText);
  const attachments = input.attachments ?? [];
  const attachmentText = normalizeText(attachments.map((attachment) => attachment.text ?? "").join(" "));
  const fullText = normalizeText(`${text} ${attachmentText}`);
  const sourceDocuments = buildRawSourceDocuments(text, attachments);
  const noiseCandidates = buildNoiseCandidates(text, attachments);
  const sections = splitS8PrimarySections(text);
  const sectionConfidence = inferSectionExtractionConfidence(sections, text);
  const headerText = text.slice(0, 3500);
  const lowerHeaderText = headerText.toLowerCase();
  const marketContext = input.marketContext ?? null;

  const feeTableExtraction = extractFeeTableFacts({
    primaryText: input.filingText,
    normalizedPrimaryText: text,
    attachments,
    fullText,
    rawFullText,
  });
  const feeTableRows = feeTableExtraction.rows;
  const planExtraction = extractPlanFacts({
    primaryText: input.filingText,
    normalizedPrimaryText: text,
    attachments,
    fullText,
    feeTableRows,
  });
  const planShareAllocations =
    planExtraction.allocations.length > 0 ? planExtraction.allocations : extractPlanShareAllocations(fullText, feeTableRows);
  const priorRegistrationStatements = extractPriorRegistrationStatements(fullText);
  const reverseSplitAdjustments = extractReverseSplitAdjustments(fullText);
  const sellingHolderExtraction = extractSellingSecurityholders(fullText, rawFullText);
  const sellingSecurityholders = sellingHolderExtraction.holders;
  const inducementAwards = extractInducementAwards(fullText);
  const filingProvidedPrice = extractFilingProvidedPrice(fullText);
  const extractedShareCounts = extractShareCounts(fullText);

  const feeTableRegisteredShares = sumFeeTableShares(feeTableRows);
  const registeredShares =
    feeTableRegisteredShares ?? (extractedShareCounts.length > 0 ? Math.max(...extractedShareCounts) : null);
  const planNames = planExtraction.planNames.length > 0 ? planExtraction.planNames : extractPlanNames(fullText);
  const securityType = extractSecurityType(fullText);
  const estimatedOfferingAmount =
    extractDollarAmount(text, [
      /proposed\s+maximum\s+aggregate\s+offering\s+price[:\s]+\$?([\d,]+(?:\.\d+)?)/i,
      /maximum\s+aggregate\s+offering\s+price[:\s]+\$?([\d,]+(?:\.\d+)?)/i,
      /aggregate\s+offering\s+amount[:\s]+\$?([\d,]+(?:\.\d+)?)/i,
    ]) ?? sumFeeTableOfferingAmount(feeTableRows);
  const registrationFee =
    extractDollarAmount(text, [
      /amount\s+of\s+registration\s+fee[:\s]+\$?([\d,]+(?:\.\d+)?)/i,
      /registration\s+fee[:\s]+\$?([\d,]+(?:\.\d+)?)/i,
    ]) ?? sumFeeTableRegistrationFees(feeTableRows);
  const isAmendment =
    /\/A$/i.test(input.formType) ||
    /S-8\s+POS/i.test(input.formType) ||
    /\bFORM\s+S-8\/A\b/i.test(headerText) ||
    lowerHeaderText.includes("amendment no.") ||
    lowerHeaderText.includes("post-effective amendment");
  const noAdditionalSecurities =
    /no\s+additional\s+(?:securities|shares)\s+(?:are\s+)?(?:(?:being|to\s+be)\s+)?registered/i.test(fullText) ||
    /does\s+not\s+register\s+any\s+additional\s+(?:securities|shares)/i.test(fullText);
  const exhibitOnly =
    /solely\s+to\s+(?:file|include|add|amend)\s+exhibit/i.test(fullText) ||
    (isAmendment && hasAttachmentDescription(attachments, /exhibit/i));
  const signatureOnly = /solely\s+to\s+(?:add|update)\s+signatures?/i.test(fullText);
  const generalInstructionE = /general\s+instruction\s+e/i.test(fullText);
  const correctionOnly =
    /(?:solely|only)\s+to\s+correct/i.test(fullText) ||
    /purpose\s+of\s+this\s+amendment\s+is\s+to\s+correct/i.test(fullText);
  const postEffectiveAmendment = isPostEffectiveS8Amendment(input.formType, fullText);
  const deregistrationOfUnsoldSecurities = hasDeregistrationOfUnsoldSecurities(fullText);
  const reofferProspectus =
    hasSection(sections, "reoffer_prospectus") || /reoffer\s+prospectus|general\s+instruction\s+c/i.test(fullText);
  const resaleProspectus = hasSection(sections, "resale_prospectus") || /resale\s+prospectus/i.test(fullText);
  const sellingHolderSection =
    hasSection(sections, "selling_holders") ||
    sellingHolderExtraction.hasSellingHolderContext ||
    /selling\s+(?:security\s*holders?|securityholders?|stockholders?|shareholders?)/i.test(fullText);
  const resaleContextWindow = hasResaleContext(fullText);
  const controlSecurities = /\bcontrol\s+securities\b|\bcontrol\s+persons?\b/i.test(fullText) && resaleContextWindow;
  const restrictedSecurities = /\brestricted\s+securities\b/i.test(fullText) && resaleContextWindow;
  const rule144 = /\bRule\s+144\b/i.test(fullText);
  const rule144InResaleContext = rule144 && resaleContextWindow;
  const consultantAdvisorExtraction = extractConsultantAdvisorContexts(fullText, sections);
  const consultantAdvisorServiceProvider = consultantAdvisorExtraction.hasSubstantiveContext;
  const investorRelationsPromotionalFinancingServices = consultantAdvisorExtraction.hasFinancingOrPromotionContext;
  const shellReverseMergerDelinquentFiler =
    /\b(?:shell company|former shell|reverse merger|delinquent filer|not current in (?:its|their) reports)\b/i.test(
      fullText,
    );
  const s8PosRegistersAdditionalSecurities =
    /^S-8\s+POS$/i.test(input.formType.trim()) &&
    !noAdditionalSecurities &&
    /(?:register(?:s|ed|ing)?|registration\s+of)[^.]{0,120}\badditional\b[^.]{0,80}\b(?:shares|securities)|\badditional\b[^.]{0,80}\b(?:shares|securities)\b[^.]{0,120}\b(?:registered|registration)\b/i.test(
      fullText,
    );
  const likelyFeeTableMaterial =
    feeTableExtraction.source !== "not_found" ||
    /calculation\s+of\s+filing\s+fee\s+table|filing\s+fee\s+table|Exhibit\s+107|EX-FILING\s+FEES/i.test(fullText) ||
    hasAttachmentDescription(attachments, /EX-FILING\s+FEES|EX-107|FILING\s+FEE|FEE\s+TABLE/i);
  const exFilingFeesExhibit = hasAttachmentDescription(attachments, /EX-FILING\s+FEES|EX-107|FILING\s+FEE/i);
  const reofferShares = extractReofferShares(fullText, sellingSecurityholders);
  const reofferNoIssuerProceeds = extractReofferNoIssuerProceeds(fullText);
  const inducementAwardTotalShares =
    inducementAwards.length > 0 ? inducementAwards.reduce((total, award) => total + award.shares, 0) : null;
  const parentRegisteredShares = input.parentFilingContext?.registeredShares ?? null;
  const additionalShares = inferAdditionalShares({
    isAmendment,
    text: fullText,
    registeredShares,
    parentRegisteredShares,
    noAdditionalSecurities,
    correctionOnly,
  });
  const dilutionPercentOfSharesOutstanding = percentOf(registeredShares, marketContext?.shares_outstanding);
  const dilutionPercentOfPublicFloat = percentOf(registeredShares, marketContext?.public_float);
  const needsParentComparison =
    isAmendment && !noAdditionalSecurities && !correctionOnly && parentRegisteredShares == null;
  const amendmentType = inferAmendmentType({
    isAmendment,
    postEffectiveAmendment,
    deregistrationOfUnsoldSecurities,
    noAdditionalSecurities,
    exhibitOnly,
    signatureOnly,
    correctionOnly,
    additionalShares,
  });
  const normalizedS8Type = normalizeS8FamilyType({
    formType: input.formType,
    fullText,
    generalInstructionE,
    postEffectiveAmendment,
    deregistrationOfUnsoldSecurities,
    noAdditionalSecurities,
    additionalShares,
    s8PosRegistersAdditionalSecurities,
  });
  const feeTablePurposeConflicts = buildFeeTablePurposeConflicts({
    formType: input.formType,
    fullText,
    normalizedS8Type,
    noAdditionalSecurities,
    deregistrationOfUnsoldSecurities,
    generalInstructionE,
    feeTableRows,
    planInterests: feeTableExtraction.planInterests,
    planNameFacts: planExtraction.planNameFacts,
    planShareAllocations,
  });

  const facts: S8ParserOutput["facts"] = {
    issuerName: input.issuer?.name ?? null,
    ticker: input.issuer?.ticker ?? null,
    exchange: input.issuer?.exchange ?? null,
    filedAt: input.filedAt ?? null,
    isAmendment,
    amendmentType,
    planNames,
    planNameFacts: planExtraction.planNameFacts,
    planExtractionConfidence: planExtraction.confidence,
    planExtractionWarnings: planExtraction.warnings,
    securityType,
    registeredShares,
    additionalShares,
    parentRegisteredShares,
    estimatedOfferingAmount,
    registrationFee,
    dilutionPercentOfSharesOutstanding,
    dilutionPercentOfPublicFloat,
    noAdditionalSecurities,
    exhibitOnly,
    signatureOnly,
    needsParentComparison,
    normalizedS8Type,
    s8FamilyDetected: isS8FamilyFiling(input.formType, fullText),
    likelyFeeTableMaterial,
    exFilingFeesExhibit,
    feeTableSource: feeTableExtraction.source,
    feeTableExtractionConfidence: feeTablePurposeConflicts.length > 0 ? "low" : feeTableExtraction.confidence,
    feeTableWarnings: feeTableExtraction.warnings,
    feeTablePurposeConflicts,
    rule416: rule144 || feeTableExtraction.rule416,
    planInterests: feeTableExtraction.planInterests,
    unusualFeeTableSecurities: feeTableExtraction.unusualSecurities,
    postEffectiveAmendment,
    deregistrationOfUnsoldSecurities,
    resaleProspectus,
    sellingHolderSection,
    controlSecurities,
    restrictedSecurities,
    rule144,
    consultantAdvisorServiceProvider,
    investorRelationsPromotionalFinancingServices,
    shellReverseMergerDelinquentFiler,
    s8PosRegistersAdditionalSecurities,
    sectionExtractionConfidence: sectionConfidence,
  };

  addArrayFact(facts, "feeTableRows", feeTableRows);
  addArrayFact(facts, "consultantAdvisorContexts", consultantAdvisorExtraction.contexts);
  addArrayFact(facts, "planShareAllocations", planShareAllocations);
  addArrayFact(facts, "priorRegistrationStatements", priorRegistrationStatements);
  addArrayFact(facts, "reverseSplitAdjustments", reverseSplitAdjustments);
  if (reofferProspectus) facts.reofferProspectus = true;
  if (reofferShares != null) facts.reofferShares = reofferShares;
  if (reofferNoIssuerProceeds) facts.reofferNoIssuerProceeds = true;
  addArrayFact(facts, "sellingSecurityholders", sellingSecurityholders);
  addArrayFact(facts, "inducementAwards", inducementAwards);
  if (inducementAwardTotalShares != null) facts.inducementAwardTotalShares = inducementAwardTotalShares;
  if (generalInstructionE) facts.generalInstructionE = true;
  if (correctionOnly) facts.correctionOnly = true;
  if (filingProvidedPrice) facts.filingProvidedPrice = filingProvidedPrice;
  if (sellingHolderExtraction.hasSellingHolderContext || sellingHolderExtraction.holders.length > 0 || sellingHolderExtraction.warnings.length > 0) {
    facts.sellingHolderExtractionConfidence = sellingHolderExtraction.confidence;
    facts.sellingHolderWarnings = sellingHolderExtraction.warnings;
  }
  if (rule144InResaleContext) facts.rule144InResaleContext = true;
  if (consultantAdvisorExtraction.contexts.length > 0 || consultantAdvisorExtraction.warnings.length > 0) {
    facts.consultantAdvisorContextConfidence = consultantAdvisorExtraction.confidence;
    facts.consultantAdvisorContextWarnings = consultantAdvisorExtraction.warnings;
  }

  const warnings = buildWarnings(input.formType, facts);

  return {
    parserVersion: S8_PARSER_VERSION,
    parserGroup: "s8",
    formType: input.formType,
    accessionNumber: input.accessionNumber ?? null,
    isSupported: facts.s8FamilyDetected === true,
    summary: buildSummary(input.issuer?.name ?? null, facts),
    facts,
    signals: [],
    calendarItems: [],
    warnings,
    raw: {
      sourceTextExcerpt: text.slice(0, 700),
      sourceDocuments,
      noiseCandidates,
      attachments,
      parentFilingContext: input.parentFilingContext ?? null,
      marketContext,
      extractedShareCounts,
      sections,
    },
  };
}

function addArrayFact<K extends keyof S8ParserOutput["facts"]>(
  facts: S8ParserOutput["facts"],
  key: K,
  value: S8ParserOutput["facts"][K],
): void {
  if (Array.isArray(value) && value.length > 0) {
    facts[key] = value;
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&middot;/g, "-")
    .replace(/&mdash;|&ndash;|&#8211;|&#8212;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function isS8FamilyFiling(formType: string, text: string): boolean {
  const form = formType.toUpperCase().replace(/\s+/g, " ").trim();
  if (/^S-8(?:\/A)?$/.test(form) || form === "S-8 POS") return true;
  const cover = text.slice(0, 6000);
  return /\bFORM\s+S-8\/A\b|\bFORM\s+S-8\b|Post-Effective\s+Amendment\s+(?:No\.\s*\d+\s+)?to\s+Form\s+S-8/i.test(
    cover,
  );
}

function normalizeS8FamilyType(params: {
  formType: string;
  fullText: string;
  generalInstructionE: boolean;
  postEffectiveAmendment: boolean;
  deregistrationOfUnsoldSecurities: boolean;
  noAdditionalSecurities: boolean;
  additionalShares: number | null;
  s8PosRegistersAdditionalSecurities: boolean;
}): S8NormalizedFilingType {
  if (params.s8PosRegistersAdditionalSecurities) return "ambiguous_conflicting_s8_family";
  if (params.postEffectiveAmendment || /^S-8\s+POS$/i.test(params.formType.trim())) return "post_effective_amendment";
  if (
    params.generalInstructionE ||
    params.additionalShares != null ||
    /additional\s+(?:shares|securities)/i.test(params.fullText)
  ) {
    return "general_instruction_e_additional_securities";
  }
  if (!isS8FamilyFiling(params.formType, params.fullText)) return "ambiguous_conflicting_s8_family";
  if (/conflict|inconsistent|ambiguous/i.test(params.fullText.slice(0, 8000))) return "ambiguous_conflicting_s8_family";
  return "initial_s8";
}

function isPostEffectiveS8Amendment(formType: string, text: string): boolean {
  return (
    /^S-8\s+POS$/i.test(formType.trim()) ||
    /\bFORM\s+S-8\/A\b/i.test(text.slice(0, 6000)) ||
    /Post-Effective\s+Amendment\s+(?:No\.\s*\d+\s+)?to\s+Form\s+S-8/i.test(text.slice(0, 8000))
  );
}

function hasDeregistrationOfUnsoldSecurities(text: string): boolean {
  return (
    /\bderegister(?:s|ed|ing)?\b[\s\S]{0,260}\b(?:unsold|remaining)\s+securities\b/i.test(text) ||
    /\b(?:unsold|remaining)\s+securities\b[\s\S]{0,260}\bderegister(?:s|ed|ing)?\b/i.test(text) ||
    /\bremove\s+from\s+registration\b[\s\S]{0,260}\b(?:unsold|remaining)?\s*securities\b/i.test(text) ||
    /\bterminate\s+(?:the\s+)?registration\b[\s\S]{0,260}\b(?:unsold|remaining)?\s*securities\b/i.test(text)
  );
}

function splitS8PrimarySections(text: string): S8DetectedSection[] {
  if (!text) return [];
  const definitions: Array<{ key: S8DetectedSection["key"]; pattern: RegExp }> = [
    { key: "explanatory_note", pattern: /\bEXPLANATORY\s+(?:NOTE|STATEMENT)\b/i },
    { key: "part_i", pattern: /\bPART\s+I\b|\bINFORMATION\s+REQUIRED\s+IN\s+THE\s+SECTION\s+10\(a\)\s+PROSPECTUS\b/i },
    { key: "part_ii", pattern: /\bPART\s+II\b|\bINFORMATION\s+REQUIRED\s+IN\s+THE\s+REGISTRATION\s+STATEMENT\b/i },
    { key: "reoffer_prospectus", pattern: /\bREOFFER\s+PROSPECTUS\b/i },
    { key: "resale_prospectus", pattern: /\bRESALE\s+PROSPECTUS\b/i },
    {
      key: "selling_holders",
      pattern: /\bSELLING\s+(?:SECURITYHOLDERS?|STOCKHOLDERS?|SHAREHOLDERS?)\b/i,
    },
    { key: "exhibit_index", pattern: /\bEXHIBIT\s+INDEX\b/i },
    { key: "signatures", pattern: /\bSIGNATURES?\b/i },
  ];

  const matches: S8DetectedSection[] = [];
  for (const definition of definitions) {
    const match = definition.pattern.exec(text);
    if (!match || match.index == null) continue;
    matches.push({
      key: definition.key,
      heading: cleanupWhitespace(match[0]),
      start: match.index,
      end: null,
      confidence: "high",
    });
  }

  matches.sort((left, right) => left.start - right.start);
  const deduped = matches.filter((section, index, all) => {
    return !all.slice(0, index).some((previous) => previous.key === section.key);
  });

  const coverEnd = deduped[0]?.start ?? Math.min(text.length, 3500);
  const sections: S8DetectedSection[] = [];
  if (coverEnd > 200) {
    sections.push({
      key: "cover_page",
      heading: "cover page",
      start: 0,
      end: coverEnd,
      confidence: coverEnd <= 8000 ? "medium" : "low",
    });
  }

  deduped.forEach((section, index) => {
    sections.push({
      ...section,
      end: deduped[index + 1]?.start ?? null,
    });
  });

  return sections;
}

function inferSectionExtractionConfidence(sections: S8DetectedSection[], text: string): "high" | "medium" | "low" {
  if (!text) return "low";
  if (!sections.length) return "low";
  if (sections.some((section) => section.confidence === "low")) return "low";
  const hasRegistrationBody = sections.some((section) => section.key === "part_i" || section.key === "part_ii");
  const hasTerminal = sections.some((section) => section.key === "exhibit_index" || section.key === "signatures");
  if (hasRegistrationBody && hasTerminal) return "high";
  return "medium";
}

function hasSection(sections: S8DetectedSection[], key: S8DetectedSection["key"]): boolean {
  return sections.some((section) => section.key === key);
}

function buildRawSourceDocuments(primaryText: string, attachments: S8Attachment[]): S8RawSourceDocument[] {
  const documents: S8RawSourceDocument[] = [];

  if (primaryText) {
    documents.push({
      id: "primary",
      documentRole: "primary_filing",
      source: "primary",
      documentType: null,
      description: "Primary S-8 filing document",
      textKind: "normalized_text",
      text: primaryText,
    });
  }

  attachments.forEach((attachment, index) => {
    const role = classifyAttachmentRole(attachment);
    if (!role) return;

    const rawText = attachment.text ?? "";
    const normalizedText = normalizeText(rawText);
    const text = shouldPreserveRawAttachmentText(attachment) ? rawText.trim() : normalizedText;
    if (!text) return;

    documents.push({
      id: `attachment_${index + 1}`,
      documentRole: role,
      source: "attachment",
      documentType: attachment.documentType ?? null,
      description: attachment.description ?? null,
      textKind: shouldPreserveRawAttachmentText(attachment) ? "raw_text" : "normalized_text",
      text,
    });
  });

  return documents;
}

function buildNoiseCandidates(primaryText: string, attachments: S8Attachment[]): S8NoiseCandidate[] {
  const candidates: S8NoiseCandidate[] = [];

  if (/incorporated\s+herein\s+by\s+reference|incorporated\s+by\s+reference/i.test(primaryText)) {
    candidates.push({
      label: "incorporation_by_reference",
      source: "primary",
      documentType: null,
      description: "Primary S-8 filing document",
      reason: "Generic S-8 incorporation-by-reference blocks can distract from registration terms.",
    });
  }

  if (/\bSIGNATURES?\b|POWER\s+OF\s+ATTORNEY/i.test(primaryText)) {
    candidates.push({
      label: "signature_block",
      source: "primary",
      documentType: null,
      description: "Primary S-8 filing document",
      reason: "Signature and power-of-attorney blocks usually do not change S-8 registration economics.",
    });
  }

  attachments.forEach((attachment) => {
    const documentType = attachment.documentType ?? null;
    const description = attachment.description ?? null;
    const combined = `${documentType ?? ""} ${description ?? ""}`;

    if (/EX-5\.1|LEGAL\s+OPINION|OPINION/i.test(combined)) {
      candidates.push({
        label: "legal_opinion",
        source: "attachment",
        documentType,
        description,
        reason: "Legal opinion exhibits are usually not the source of share count, proceeds, or resale-holder terms.",
      });
      return;
    }

    if (/EX-23|CONSENT/i.test(combined)) {
      candidates.push({
        label: "consent_exhibit",
        source: "attachment",
        documentType,
        description,
        reason: "Consent exhibits are usually procedural and not the source of S-8 dilution terms.",
      });
      return;
    }

    if (!classifyAttachmentRole(attachment)) {
      candidates.push({
        label: "other_exhibit",
        source: "attachment",
        documentType,
        description,
        reason: "Attachment did not match fee, XBRL fee, reoffer, or selling-holder source roles.",
      });
    }
  });

  return candidates;
}

function classifyAttachmentRole(attachment: S8Attachment): S8RawSourceDocument["documentRole"] | null {
  const documentType = attachment.documentType ?? "";
  const description = attachment.description ?? "";
  const text = attachment.text ?? "";
  const combined = `${documentType} ${description} ${text.slice(0, 1000)}`;

  if (/EX-FILING\s+FEES|EX-107|FILING\s+FEE|FEE\s+TABLE/i.test(combined)) return "fee_exhibit";
  if (/<(?:ix|ffd):|EXTRACTED\s+XBRL|_htm\.xml|INSTANCE\s+DOCUMENT/i.test(combined)) return "xbrl_fee_xml";
  if (/REOFFER\s+PROSPECTUS|SELLING\s+(?:SECURITYHOLDERS?|STOCKHOLDERS?)/i.test(combined)) return "reoffer_source";

  return null;
}

function shouldPreserveRawAttachmentText(attachment: S8Attachment): boolean {
  const rawText = attachment.text ?? "";
  const combined = `${attachment.documentType ?? ""} ${attachment.description ?? ""} ${rawText.slice(0, 1000)}`;
  return /<(?:ix|ffd):|EXTRACTED\s+XBRL|_htm\.xml|INSTANCE\s+DOCUMENT/i.test(combined);
}

function extractShareCounts(text: string): number[] {
  const counts = new Set<number>();

  for (const pattern of CONTEXTUAL_SHARE_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
      const count = toNumber(match[1]);
      if (count && count > 0) counts.add(count);
      match = pattern.exec(text);
    }
  }

  if (counts.size === 0) {
    BROAD_SHARE_PATTERN.lastIndex = 0;
    let match = BROAD_SHARE_PATTERN.exec(text);
    while (match) {
      const count = toNumber(match[1]);
      if (count && count > 0 && !isNoisyBroadShareMatch(text, match.index)) counts.add(count);
      match = BROAD_SHARE_PATTERN.exec(text);
    }
  }

  return Array.from(counts).sort((a, b) => b - a);
}

function isNoisyBroadShareMatch(text: string, index: number): boolean {
  const nearby = text.slice(Math.max(0, index - 160), Math.min(text.length, index + 220));
  return /outstanding|beneficially owned|owned prior|following this offering|percentage ownership|issued and outstanding|shares owned|shares being offered/i.test(
    nearby,
  );
}

function extractFeeTableFacts(params: {
  primaryText: string;
  normalizedPrimaryText: string;
  attachments: S8Attachment[];
  fullText: string;
  rawFullText: string;
}): FeeTableExtraction {
  const candidates = buildFeeTableCandidates(params);
  const warnings: string[] = [];
  let selectedRows: S8FeeTableRow[] = [];
  let selectedSource: S8ParserOutput["facts"]["feeTableSource"] = "not_found";
  let selectedConfidence: FeeTableExtraction["confidence"] = "low";

  for (const candidate of candidates) {
    const rows = extractFeeTableRowsFromText(candidate.text, candidate.rawText, candidate.source);
    if (!rows.length) continue;

    selectedRows = rows;
    selectedSource = candidate.source === "primary_document" || candidate.source === "plain_text" ? "primary_document" : "ex_filing_fees";
    selectedConfidence = candidate.source === "primary_document" ? "medium" : "high";
    break;
  }

  const exCandidate = candidates.find((candidate) => candidate.source === "ex_filing_fees");
  const primaryCandidate = candidates.find((candidate) => candidate.source === "primary_document");
  if (exCandidate && primaryCandidate) {
    const exRows = extractFeeTableRowsFromText(exCandidate.text, exCandidate.rawText, exCandidate.source);
    const primaryRows = extractFeeTableRowsFromText(primaryCandidate.text, primaryCandidate.rawText, primaryCandidate.source);
    if (exRows.length && primaryRows.length && !feeRowsShareTotalsAgree(exRows, primaryRows)) {
      warnings.push("EX-FILING FEES and primary-document fee tables do not agree on registered share totals.");
      selectedConfidence = "low";
      selectedSource = "mixed";
    }
  }

  const likelyFeeMaterial = candidates.some((candidate) => hasFeeTableMaterial(candidate.rawText || candidate.text));
  if (likelyFeeMaterial && selectedRows.length === 0) {
    warnings.push("Fee-table material was detected, but no securities rows were parsed.");
  }

  if (selectedRows.some((row) => row.confidence === "low")) selectedConfidence = "low";
  if (selectedRows.length > 1 && selectedRows.some((row) => !row.securityClassTitle || row.amountRegistered == null)) {
    warnings.push("Multiple fee-table rows exist, but at least one row has incomplete class-title or amount mapping.");
    selectedConfidence = selectedConfidence === "high" ? "medium" : selectedConfidence;
  }
  if (selectedRows.some((row) => row.amountRegisteredText && row.amountRegistered == null && isIndeterminateValue(row.amountRegisteredText))) {
    warnings.push("At least one fee-table amount is indeterminate and was preserved as null.");
  }

  return {
    rows: dedupeFeeRows(selectedRows),
    source: selectedSource,
    confidence: selectedConfidence,
    warnings,
    rule416: selectedRows.some((row) => row.hasRule416) || candidates.some((candidate) => /\bRule\s+416\b/i.test(candidate.rawText)),
    planInterests: selectedRows.some((row) => row.isPlanInterest),
    unusualSecurities: selectedRows.some(isUnusualFeeSecurityRow),
  };
}

function buildFeeTableCandidates(params: {
  primaryText: string;
  normalizedPrimaryText: string;
  attachments: S8Attachment[];
  fullText: string;
  rawFullText: string;
}): Array<{ source: FeeTableSource; text: string; rawText: string; rank: number }> {
  const candidates: Array<{ source: FeeTableSource; text: string; rawText: string; rank: number }> = [];

  params.attachments.forEach((attachment) => {
    const rawText = attachment.text ?? "";
    if (!rawText.trim()) return;
    const combined = `${attachment.documentType ?? ""} ${attachment.description ?? ""} ${rawText.slice(0, 1500)}`;
    if (!isFeeTableAttachment(combined) && !hasFeeTableMaterial(rawText)) return;
    candidates.push({
      source: "ex_filing_fees",
      text: normalizeText(rawText),
      rawText,
      rank: /EX-FILING\s+FEES|EX-107/i.test(combined) ? 100 : 80,
    });
  });

  if (hasFeeTableMaterial(params.primaryText) || hasFeeTableMaterial(params.normalizedPrimaryText)) {
    candidates.push({
      source: "primary_document",
      text: params.normalizedPrimaryText,
      rawText: params.primaryText,
      rank: 40,
    });
  }

  if (!candidates.length && hasFeeTableMaterial(params.rawFullText)) {
    candidates.push({
      source: "plain_text",
      text: params.fullText,
      rawText: params.rawFullText,
      rank: 20,
    });
  }

  return candidates.sort((left, right) => right.rank - left.rank);
}

function isFeeTableAttachment(value: string): boolean {
  return /EX-FILING\s+FEES|EX-107|FILING\s+FEE|FEE\s+TABLE/i.test(value);
}

function hasFeeTableMaterial(value: string): boolean {
  return /calculation\s+of\s+filing\s+fee\s+table|filing\s+fee\s+table|newly\s+registered\s+securities|amount\s+to\s+be\s+registered|amount\s+registered|title\s+of\s+securities\s+to\s+be\s+registered|security\s+class\s+title|net\s+fee\s+due|ffd:/i.test(
    value,
  );
}

function extractFeeTableRowsFromText(text: string, rawText: string, source: FeeTableSource): S8FeeTableRow[] {
  return enrichFeeRowsWithFootnoteText(dedupeFeeRows([
    ...extractFfdFeeTableRows(rawText),
    ...extractHtmlFeeTableRows(rawText, source),
    ...extractDelimitedFeeTableRows(rawText, source),
    ...extractPlainTextFeeTableRows(text, source),
  ]), rawText);
}

function enrichFeeRowsWithFootnoteText(rows: S8FeeTableRow[], rawText: string): S8FeeTableRow[] {
  if (!rows.length || !rawText) return rows;
  if (/<ix:/i.test(rawText)) return rows;
  const normalized = normalizeText(rawText);
  for (const row of rows) {
    const texts: string[] = [];
    for (const marker of row.footnotes ?? []) {
      const number = marker.match(/\d+/)?.[0];
      if (!number) continue;
      const paragraphPattern = new RegExp(`<p[^>]*>\\s*\\(${number}\\)\\s*([\\s\\S]{0,800}?)<\\/p>`, "i");
      const htmlPattern = new RegExp(`\\(${number}\\)\\s*([^<]{0,800})`, "i");
      const htmlMatch = rawText.match(paragraphPattern) ?? rawText.match(htmlPattern);
      const pattern = new RegExp(`\\(${number}\\)\\s*([^()]{0,800}?\\bPlan\\b[^.]*\\.)`, "i");
      const match = normalized.match(pattern);
      if (htmlMatch && /\bPlan\b/i.test(htmlMatch[1])) {
        texts.push(cleanupWhitespace(normalizeText(htmlMatch[1])));
      } else if (match) {
        texts.push(cleanupWhitespace(match[1]));
      }
    }
    if (!texts.length) {
      const nearby = normalized.slice(0, 2500);
      const match = nearby.match(/(?:Represents|Consists\s+of|Includes|Pursuant\s+to\s+General\s+Instruction\s+E)[^.]{0,500}\bPlan\b[^.]*\./i);
      if (match && rows.length === 1) texts.push(cleanupWhitespace(match[0]));
    }
    if (texts.length) row.footnoteText = Array.from(new Set(texts));
  }
  return rows;
}

function extractPlainTextFeeTableRows(text: string, source: FeeTableSource): S8FeeTableRow[] {
  const rows: S8FeeTableRow[] = [];
  const rowPattern =
    /(?:^|\s)(?:\d+\s+)?(Equity|Debt|Other)\s+(.+?)\s+((?:Rule\s+)?457\([^)]+\)(?:\s+and\s+457\([^)]+\))?|Other)(?:\(\d+\))?\s+((?:[\d,]+|N\/A|--|-|Indeterminate|such\s+indeterminate\s+number|such\s+additional\s+number\s+of\s+shares))(?:\s+\(\d+\))?\s+\$?\s*([\d,]+(?:\.\d+)?|N\/A|--|-|Indeterminate)(?:\s+\(\d+\))?\s+\$?\s*([\d,]+(?:\.\d+)?|N\/A|--|-|Indeterminate)\s+([\d.]+%?|N\/A|--|-|Indeterminate)\s+\$?\s*([\d,]+(?:\.\d+)?|N\/A|--|-|Indeterminate)/gi;
  let match = rowPattern.exec(text);

  while (match) {
    rows.push(buildFeeTableRow({
      securityType: match[1],
      securityClassTitle: cleanupWhitespace(match[2]),
      feeCalculationRule: cleanupFeeRule(match[3]),
      amountRegisteredText: match[4],
      proposedMaximumOfferingPricePerUnitText: match[5],
      maximumAggregateOfferingPriceText: match[6],
      feeRateText: match[7],
      registrationFeeText: match[8],
      source: source === "ex_filing_fees" ? "plain_text" : source,
      confidence: "medium",
      nearbyText: match[0],
    }));
    match = rowPattern.exec(text);
  }

  return rows;
}

function extractFfdFeeTableRows(rawText: string): S8FeeTableRow[] {
  if (!rawText) return [];

  const contexts = new Map<string, Record<string, string>>();
  const directFfdPattern = /<ffd:([A-Za-z0-9]+)\b([^>]*)>([\s\S]*?)<\/ffd:\1>/gi;
  let directMatch = directFfdPattern.exec(rawText);

  while (directMatch) {
    const contextRef = getAttributeValue(directMatch[2], "contextRef");
    if (contextRef) collectFfdFact(contexts, contextRef, directMatch[1], directMatch[3]);
    directMatch = directFfdPattern.exec(rawText);
  }

  const inlineXbrlPattern = /<ix:(nonNumeric|nonFraction)\b([^>]*)>([\s\S]*?)<\/ix:\1>/gi;
  let inlineMatch = inlineXbrlPattern.exec(rawText);

  while (inlineMatch) {
    const name = getAttributeValue(inlineMatch[2], "name");
    const contextRef = getAttributeValue(inlineMatch[2], "contextRef");
    const tagName = name?.split(":").at(-1);
    if (contextRef && tagName) collectFfdFact(contexts, contextRef, tagName, inlineMatch[3]);
    inlineMatch = inlineXbrlPattern.exec(rawText);
  }

  const rows: S8FeeTableRow[] = [];
  for (const fields of contexts.values()) {
    const amountRegistered = toFeeNumber(fields.AmtSctiesRegd);
    const maximumAggregateOfferingPrice = toFeeNumber(fields.MaxAggtOfferingPric);
    const registrationFee = toFeeNumber(fields.FeeAmt);
    const securityClassTitle = fields.OfferingSctyTitl ? cleanupWhitespace(fields.OfferingSctyTitl) : null;

    if (!securityClassTitle && amountRegistered == null && maximumAggregateOfferingPrice == null && registrationFee == null) {
      continue;
    }

    rows.push(buildFeeTableRow({
      securityType: fields.OfferingSctyTp ? cleanupWhitespace(fields.OfferingSctyTp) : null,
      securityClassTitle,
      feeCalculationRule: extractFfdFeeCalculationRule(fields),
      amountRegisteredText: fields.AmtSctiesRegd ?? null,
      amountRegistered,
      proposedMaximumOfferingPricePerUnitText: fields.MaxOfferingPricPerScty ?? null,
      proposedMaximumOfferingPricePerUnit: toFeeNumber(fields.MaxOfferingPricPerScty),
      maximumAggregateOfferingPriceText: fields.MaxAggtOfferingPric ?? null,
      maximumAggregateOfferingPrice,
      feeRateText: fields.FeeRate ?? null,
      feeRate: toFeeNumber(fields.FeeRate),
      registrationFeeText: fields.FeeAmt ?? null,
      registrationFee,
      source: "inline_xbrl",
      confidence: "high",
      nearbyText: Object.values(fields).join(" "),
    }));
  }

  return rows;
}

function extractHtmlFeeTableRows(rawText: string, source: FeeTableSource): S8FeeTableRow[] {
  if (!/<table[\s>]/i.test(rawText)) return [];
  const rows: S8FeeTableRow[] = [];
  const tablePattern = /<table\b[\s\S]*?<\/table>/gi;
  let tableMatch = tablePattern.exec(rawText);

  while (tableMatch) {
    const tableHtml = tableMatch[0];
    if (!hasFeeTableMaterial(tableHtml)) {
      tableMatch = tablePattern.exec(rawText);
      continue;
    }

    rows.push(...extractCellRowsFromMatrix(htmlTableToMatrix(tableHtml), source === "ex_filing_fees" ? "html_table" : source));
    tableMatch = tablePattern.exec(rawText);
  }

  return rows;
}

function htmlTableToMatrix(tableHtml: string): string[][] {
  const matrix: string[][] = [];
  const rowPattern = /<tr\b[\s\S]*?<\/tr>/gi;
  let rowMatch = rowPattern.exec(tableHtml);

  while (rowMatch) {
    const cells: string[] = [];
    const cellPattern = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch = cellPattern.exec(rowMatch[0]);
    while (cellMatch) {
      cells.push(cleanupWhitespace(decodeHtmlEntities(cellMatch[1].replace(/<[^>]+>/g, " "))));
      cellMatch = cellPattern.exec(rowMatch[0]);
    }
    if (cells.some(Boolean)) matrix.push(cells);
    rowMatch = rowPattern.exec(tableHtml);
  }

  return matrix;
}

function extractDelimitedFeeTableRows(rawText: string, source: FeeTableSource): S8FeeTableRow[] {
  if (!rawText.includes("|")) return [];
  let matrix = rawText
    .split(/\r?\n/)
    .filter((line) => line.includes("|"))
    .map((line) => {
      return line
        .split("|")
        .map((cell) => cleanupWhitespace(cell))
        .filter((cell) => cell && !/^:?-{3,}:?$/.test(cell));
    })
    .filter((cells) => cells.length >= 3);

  if (matrix.length <= 1) {
    const cells = rawText
      .split("|")
      .map((cell) => cleanupWhitespace(cell))
      .filter((cell) => cell && !/^:?-{3,}:?$/.test(cell));
    const headerStart = cells.findIndex((cell) => feeColumnForHeader(cell));
    if (headerStart >= 0) {
      const headerCells = cells.slice(headerStart);
      const registrationFeeIndex = headerCells.findIndex((cell) => feeColumnForHeader(cell) === "registrationFee");
      const headerLength = registrationFeeIndex >= 0 ? registrationFeeIndex + 1 : Math.min(headerCells.length, 8);
      matrix = [headerCells.slice(0, headerLength)];
      for (let index = headerStart + headerLength; index < cells.length; index += headerLength) {
        const row = cells.slice(index, index + headerLength);
        if (row.length === headerLength) matrix.push(row);
      }
    }
  }

  return extractCellRowsFromMatrix(matrix, source === "ex_filing_fees" ? "plain_text" : source);
}

function extractCellRowsFromMatrix(matrix: string[][], source: FeeTableSource): S8FeeTableRow[] {
  const rows: S8FeeTableRow[] = [];
  const headerIndex = matrix.findIndex((cells) => cells.some((cell) => feeColumnForHeader(cell)));
  if (headerIndex < 0) return rows;

  const headers = matrix[headerIndex].map(feeColumnForHeader);
  const hasSecurityHeader = headers.includes("securityClassTitle") || headers.includes("securityType");
  const hasAmountHeader = headers.includes("amountRegistered") || headers.includes("maximumAggregateOfferingPrice");
  if (!hasSecurityHeader || !hasAmountHeader) return rows;

  for (const cells of matrix.slice(headerIndex + 1)) {
    const combined = cells.join(" ");
    if (/total\s+(?:offering|fee|offset)|net\s+fee\s+due|carry\s+forward/i.test(combined)) continue;
    if (!/\b(?:equity|common|stock|shares|plan interests|registered|457|preferred|warrant|convertible|ads|units|rights)\b/i.test(combined)) continue;

    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header || !cells[index]) return;
      values[header] = cells[index];
    });

    const securityClassTitle = values.securityClassTitle ?? inferSecurityClassFromCells(cells);
    if (!securityClassTitle && !values.amountRegistered && !values.maximumAggregateOfferingPrice) continue;

    rows.push(buildFeeTableRow({
      securityType: values.securityType ?? null,
      securityClassTitle,
      feeCalculationRule: values.feeCalculationRule ? cleanupFeeRule(values.feeCalculationRule) : null,
      amountRegisteredText: values.amountRegistered ?? null,
      proposedMaximumOfferingPricePerUnitText: values.proposedMaximumOfferingPricePerUnit ?? null,
      maximumAggregateOfferingPriceText: values.maximumAggregateOfferingPrice ?? null,
      feeRateText: values.feeRate ?? null,
      registrationFeeText: values.registrationFee ?? null,
      source,
      confidence: "high",
      nearbyText: combined,
    }));
  }

  return rows;
}

function feeColumnForHeader(value: string): string | null {
  const header = normalizeFeeHeader(value);
  if (/^(securitytype|typeofsecurity)$/.test(header)) return "securityType";
  if (/^(titleofsecuritiestoberegistered|securityclasstitle|securitytitle|titleofsecurities)$/.test(header)) {
    return "securityClassTitle";
  }
  if (/^(amounttoberegistered|amountregistered|amountofsecuritiestoberegistered|newlyregisteredsecurities)$/.test(header)) {
    return "amountRegistered";
  }
  if (/^proposedmaximumofferingpriceper(?:share|unit|security)$/.test(header)) {
    return "proposedMaximumOfferingPricePerUnit";
  }
  if (/^(maximumaggregateofferingprice|proposedmaximumaggregateofferingprice|totalofferingamounts)$/.test(header)) {
    return "maximumAggregateOfferingPrice";
  }
  if (/^(feecalculationrule|rule)$/.test(header)) return "feeCalculationRule";
  if (/^(amountofregistrationfee|registrationfee|feeamount|netfeedue)$/.test(header)) return "registrationFee";
  if (/^feerate$/.test(header)) return "feeRate";
  return null;
}

function normalizeFeeHeader(value: string): string {
  return cleanupWhitespace(value)
    .toLowerCase()
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function inferSecurityClassFromCells(cells: string[]): string | null {
  return cells.find((cell) => /\b(?:common stock|ordinary shares|preferred stock|warrants?|convertible|ads|units|rights|plan interests?)\b/i.test(cell)) ?? null;
}

function buildFeeTableRow(params: {
  securityType: string | null;
  securityClassTitle: string | null;
  feeCalculationRule: string | null;
  amountRegisteredText?: string | null;
  amountRegistered?: number | null;
  proposedMaximumOfferingPricePerUnitText?: string | null;
  proposedMaximumOfferingPricePerUnit?: number | null;
  maximumAggregateOfferingPriceText?: string | null;
  maximumAggregateOfferingPrice?: number | null;
  feeRateText?: string | null;
  feeRate?: number | null;
  registrationFeeText?: string | null;
  registrationFee?: number | null;
  source: FeeTableSource;
  confidence: "high" | "medium" | "low";
  nearbyText: string;
}): S8FeeTableRow {
  const nearbyText = cleanupWhitespace(params.nearbyText);
  const title = params.securityClassTitle ? cleanupWhitespace(params.securityClassTitle) : null;
  const amountRegisteredText = params.amountRegisteredText ? cleanupWhitespace(params.amountRegisteredText) : null;
  const hasRule416 = /\bRule\s+416\b|such\s+additional\s+(?:shares|number\s+of\s+shares)/i.test(nearbyText);
  const isPlanInterest = /plan\s+interests?|interests?\s+in\s+the\s+plan/i.test(`${title ?? ""} ${nearbyText}`);
  const footnotes = extractFeeFootnotes(nearbyText);

  return {
    securityType: params.securityType ? cleanupWhitespace(params.securityType) : null,
    securityClassTitle: title,
    feeCalculationRule: params.feeCalculationRule,
    amountRegisteredText,
    amountRegistered: params.amountRegistered ?? toFeeNumber(amountRegisteredText ?? undefined),
    proposedMaximumOfferingPricePerUnitText: params.proposedMaximumOfferingPricePerUnitText
      ? cleanupWhitespace(params.proposedMaximumOfferingPricePerUnitText)
      : null,
    proposedMaximumOfferingPricePerUnit:
      params.proposedMaximumOfferingPricePerUnit ??
      toFeeNumber(params.proposedMaximumOfferingPricePerUnitText ?? undefined),
    maximumAggregateOfferingPriceText: params.maximumAggregateOfferingPriceText
      ? cleanupWhitespace(params.maximumAggregateOfferingPriceText)
      : null,
    maximumAggregateOfferingPrice:
      params.maximumAggregateOfferingPrice ?? toFeeNumber(params.maximumAggregateOfferingPriceText ?? undefined),
    feeRateText: params.feeRateText ? cleanupWhitespace(params.feeRateText) : null,
    feeRate: params.feeRate ?? toFeeNumber(params.feeRateText ?? undefined),
    registrationFeeText: params.registrationFeeText ? cleanupWhitespace(params.registrationFeeText) : null,
    registrationFee: params.registrationFee ?? toFeeNumber(params.registrationFeeText ?? undefined),
    footnotes,
    source: params.source,
    confidence: params.confidence,
    isPlanInterest,
    hasRule416,
  };
}

function extractFeeFootnotes(value: string): string[] {
  const markers = new Set<string>();
  for (const match of value.matchAll(/\((\d+)\)/g)) markers.add(match[0]);
  if (/\bRule\s+416\b/i.test(value)) markers.add("Rule 416");
  return Array.from(markers);
}

function collectFfdFact(
  contexts: Map<string, Record<string, string>>,
  contextRef: string,
  tagName: string,
  rawValue: string,
): void {
  if (!isFfdFeeFact(tagName)) return;
  const fields = contexts.get(contextRef) ?? {};
  const value = cleanupFfdValue(rawValue);
  const existing = fields[tagName];
  if (existing && !/^(?:true|false)$/i.test(existing) && /^(?:true|false)$/i.test(value)) return;
  fields[tagName] = value;
  contexts.set(contextRef, fields);
}

function isFfdFeeFact(tagName: string): boolean {
  return (
    /^Rule457[A-Za-z0-9]*Flg$/.test(tagName) ||
    [
      "OfferingSctyTp",
      "OfferingSctyTitl",
      "AmtSctiesRegd",
      "MaxOfferingPricPerScty",
      "MaxAggtOfferingPric",
      "FeeRate",
      "FeeAmt",
    ].includes(tagName)
  );
}

function extractFfdFeeCalculationRule(fields: Record<string, string>): string | null {
  const ruleLabels: Array<[string, string]> = [
    ["Rule457aFlg", "457(a)"],
    ["Rule457cFlg", "457(c)"],
    ["Rule457fFlg", "457(f)"],
    ["Rule457hFlg", "457(h)"],
    ["Rule457oFlg", "457(o)"],
    ["Rule457rFlg", "457(r)"],
  ];
  const trueRuleLabels: string[] = [];

  for (const [tagName, label] of ruleLabels) {
    const value = fields[tagName];
    if (!value) continue;
    const cleaned = cleanupFeeRule(value);
    if (/^false$/i.test(cleaned)) continue;
    if (/^true$/i.test(cleaned)) {
      trueRuleLabels.push(label);
      continue;
    }
    return cleaned;
  }

  return trueRuleLabels.length > 0 ? trueRuleLabels.join(" and ") : null;
}

function extractPlanFacts(params: {
  primaryText: string;
  normalizedPrimaryText: string;
  attachments: S8Attachment[];
  fullText: string;
  feeTableRows: S8FeeTableRow[];
}): PlanExtraction {
  const facts = new Map<string, S8PlanNameFact>();
  const allocations = new Map<string, S8PlanShareAllocation>();
  const warnings: string[] = [];

  const addPlan = (name: string, source: PlanSource, confidence: "high" | "medium" | "low") => {
    const cleaned = cleanupPlanName(name);
    if (!isUsefulPlanName(cleaned)) return;
    const key = normalizePlanKey(cleaned);
    const existing = facts.get(key);
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
      existing.confidence = combineConfidence(existing.confidence, confidence);
      return;
    }
    facts.set(key, {
      name: cleaned,
      planType: inferPlanType(cleaned),
      sources: [source],
      confidence,
    });
  };

  for (const name of extractCoverPlanNames(params.primaryText)) addPlan(name, "cover", "high");
  for (const name of extractPlanNamesFromContext(params.fullText)) addPlan(name, "explanatory_note", "medium");

  params.feeTableRows.forEach((row, index) => {
    const rowPlans = extractPlanNamesFromFeeRow(row);
    for (const name of rowPlans) addPlan(name, row.footnotes?.length ? "fee_footnote" : "fee_table", "high");
    const cleanPlans = rowPlans.map(cleanupPlanName).filter(isUsefulPlanName);
    if (cleanPlans.length > 0) {
      row.planNames = cleanPlans;
      row.planMatchConfidence = "direct";
    }
    if (cleanPlans.length === 1 && row.amountRegistered != null && !row.isPlanInterest) {
      allocations.set(`${cleanPlans[0]}:${row.amountRegistered}:fee:${index}`, {
        planName: cleanPlans[0],
        shares: row.amountRegistered,
        source: row.footnotes?.length ? "fee_footnote" : "fee_table",
        confidence: "high",
        evidenceLevel: "direct",
        feeRowIndex: index,
      });
    } else if (cleanPlans.length > 1 && row.amountRegistered != null && !row.isPlanInterest) {
      allocations.set(`${cleanPlans.join("|")}:${row.amountRegistered}:combined:${index}`, {
        planName: cleanPlans.join("; "),
        shares: row.amountRegistered,
        source: row.footnotes?.length ? "fee_footnote" : "fee_table",
        confidence: "medium",
        evidenceLevel: "direct",
        feeRowIndex: index,
        linkedPlanNames: cleanPlans,
      });
      warnings.push("A fee-table row mentions multiple plans without allocating shares among them.");
    }
  });

  for (const allocation of extractExplicitPlanShareAllocations(params.fullText)) {
    addPlan(allocation.planName, allocation.source, allocation.confidence ?? "medium");
    allocations.set(`${allocation.planName}:${allocation.shares ?? ""}:${allocation.source}`, allocation);
  }

  for (const attachment of params.attachments) {
    const attachmentText = `${attachment.documentType ?? ""} ${attachment.description ?? ""} ${attachment.text ?? ""}`;
    const source = classifyPlanAttachmentSource(attachment);
    if (!source) continue;
    for (const name of extractPlanNamesFromContext(attachmentText)) addPlan(name, source, source === "legal_opinion" ? "low" : "medium");
  }

  const planFacts = collapseContainedPlanFacts(Array.from(facts.values())).sort(comparePlanFacts);
  const planNames = planFacts.map((fact) => fact.name);
  const commonRows = params.feeTableRows.filter((row) => !row.isPlanInterest && isShareLikeFeeSecurity(row) && row.amountRegistered != null);
  if (commonRows.length === 1 && planFacts.length === 1 && !commonRows[0].planNames?.length) {
    const rowIndex = params.feeTableRows.indexOf(commonRows[0]);
    commonRows[0].planNames = [planFacts[0].name];
    commonRows[0].planMatchConfidence = "inferred";
    allocations.set(`${planFacts[0].name}:${commonRows[0].amountRegistered}:single-plan-inference`, {
      planName: planFacts[0].name,
      shares: commonRows[0].amountRegistered,
      source: "fee_table",
      confidence: "low",
      evidenceLevel: "inferred",
      feeRowIndex: rowIndex >= 0 ? rowIndex : null,
    });
    warnings.push("Plan-to-share matching used single-plan inference rather than direct row text.");
  }

  if (planFacts.length > 1 && commonRows.length > 0 && Array.from(allocations.values()).length === 0) {
    warnings.push("Multiple plan names were detected, but no clear share allocation was available.");
  }
  if (
    planFacts.some((fact) => {
      return (
        fact.sources.some((source) => source === "legal_opinion" || source === "exhibit_index" || source === "plan_exhibit") &&
        !fact.sources.some((source) => source === "cover" || source === "fee_table" || source === "fee_footnote")
      );
    })
  ) {
    warnings.push("At least one plan name appears only in exhibit-derived or exhibit-supporting text.");
  }
  if (planFacts.some((fact) => fact.confidence === "low")) {
    warnings.push("At least one extracted plan name has low confidence.");
  }
  if (params.feeTableRows.some((row) => row.isPlanInterest)) {
    warnings.push("Plan interests are present and must not be mixed with common-stock share counts.");
  }
  if (/general\s+instruction\s+e/i.test(params.fullText) && !planFacts.some((fact) => /existing|prior|202\d|201\d|Plan/i.test(fact.name))) {
    warnings.push("General Instruction E is present, but the prior plan reference is unclear.");
  }

  return {
    planNames,
    planNameFacts: planFacts,
    allocations: Array.from(allocations.values()),
    confidence: inferPlanExtractionConfidence(planFacts, warnings),
    warnings: Array.from(new Set(warnings)),
  };
}

function extractPlanShareAllocations(text: string, feeTableRows: S8FeeTableRow[]): S8PlanShareAllocation[] {
  const allocations = new Map<string, S8PlanShareAllocation>();

  for (const row of feeTableRows) {
    const planName = row.securityClassTitle ? extractPlanNameFromFeeTitle(row.securityClassTitle) : null;
    if (planName) {
      allocations.set(`${planName}:${row.amountRegistered ?? ""}:fee_table`, {
        planName,
        shares: row.amountRegistered,
        source: "fee_table",
        confidence: "medium",
        evidenceLevel: "direct",
      });
    }
  }

  const textPattern =
    /([\d,]+)\s+shares(?:\s+of\s+[A-Za-z ]+)?\s+(?:are\s+)?(?:reserved\s+for\s+issuance\s+)?(?:under|pursuant\s+to|available\s+under)\s+(?:the\s+)?([A-Z0-9][A-Za-z0-9&,.()' -]{2,140}?(?:Plan|Program|Agreement|Arrangement|Award|Inducement Plan|Stock Plan|Incentive Plan))/gi;
  let match = textPattern.exec(text);

  while (match) {
    const shares = toNumber(match[1]);
    const planName = cleanupPlanName(match[2]);
    if (planName) {
      allocations.set(`${planName}:${shares ?? ""}:explanatory_note`, {
        planName,
        shares,
        source: "explanatory_note",
        confidence: "medium",
        evidenceLevel: "direct",
      });
    }
    match = textPattern.exec(text);
  }

  return Array.from(allocations.values());
}

function extractConsultantAdvisorContexts(
  text: string,
  sections: S8DetectedSection[],
): ConsultantAdvisorExtraction {
  const contexts: S8ConsultantAdvisorContext[] = [];
  const termPattern =
    /\b(?:consultants?|advisors?|advisers?|service providers?|independent contractors?|contractors?|non-employee directors?|consulting agreements?|advisory agreements?|consulting services?|advisory services?)\b/gi;
  let match = termPattern.exec(text);

  while (match) {
    const term = cleanupWhitespace(match[0]);
    const windowStart = Math.max(0, match.index - 260);
    const windowEnd = Math.min(text.length, match.index + 360);
    const nearby = cleanupWhitespace(text.slice(windowStart, windowEnd));
    if (isLowSignalAdvisorFalsePositive(nearby, term)) {
      match = termPattern.exec(text);
      continue;
    }

    const section = sectionForIndex(sections, match.index, text.length);
    const context = classifyConsultantAdvisorContext(term, nearby, section);
    contexts.push(context);
    match = termPattern.exec(text);
  }

  const deduped = dedupeConsultantContexts(contexts);
  const hasSubstantiveContext = deduped.some((context) => {
    return [
      "plan_eligibility",
      "actual_recipient_or_issuance",
      "reoffer_or_resale_context",
      "financing_or_promotion_related",
    ].includes(context.bucket);
  });
  const hasFinancingOrPromotionContext = deduped.some((context) => context.bucket === "financing_or_promotion_related");
  const warnings = buildConsultantContextWarnings(deduped);

  return {
    contexts: deduped,
    hasSubstantiveContext,
    hasFinancingOrPromotionContext,
    confidence: inferConsultantContextConfidence(deduped),
    warnings,
  };
}

function classifyConsultantAdvisorContext(
  term: string,
  nearby: string,
  section: S8ConsultantAdvisorContext["section"],
): S8ConsultantAdvisorContext {
  const lowerSignalSection = section === "signatures" || section === "exhibit_index" || isLegalOpinionBoilerplate(nearby);
  const bucket = inferConsultantContextBucket(nearby, section, lowerSignalSection);
  return {
    term,
    bucket,
    section,
    confidence: inferConsultantBucketConfidence(bucket, section, lowerSignalSection),
    evidence: nearby.slice(0, 420),
  };
}

function inferConsultantContextBucket(
  nearby: string,
  section: S8ConsultantAdvisorContext["section"],
  lowerSignalSection: boolean,
): S8ConsultantAdvisorContext["bucket"] {
  if (isFinancingPromotionContext(nearby)) return "financing_or_promotion_related";
  if (section === "reoffer_prospectus" || section === "resale_prospectus" || section === "selling_holders") {
    return "reoffer_or_resale_context";
  }
  if (/\b(?:shares?|awards?|options?|rsus?)\b[^.]{0,120}\b(?:issued|issuable|granted|registered|reserved|compensation)\b[^.]{0,120}\b(?:consultants?|consulting|advisors?|advisers?|advisory|service providers?|contractors?)|\b(?:consulting|advisory)\s+agreement\b|\bshares?\s+(?:for|as)\s+(?:consulting|advisory)\s+services\b|\bcompensation\s+for\s+(?:consulting|advisory)\s+services\b/i.test(nearby)) {
    return "actual_recipient_or_issuance";
  }
  if (/\b(?:eligible|eligibility|participants?|may\s+receive|receive\s+awards?|eligible\s+to\s+receive|eligible\s+for\s+awards?|issuable\s+to|equity\s+awards?\s+to|awards?\s+to)\b[^.]{0,180}\b(?:consultants?|consulting|advisors?|advisers?|advisory|service providers?|independent contractors?|contractors?|non-employee directors?)\b|\b(?:consultants?|consulting|advisors?|advisers?|advisory|service providers?|independent contractors?|contractors?|non-employee directors?)\b[^.]{0,180}\b(?:eligible|participants?|may\s+receive|receive\s+awards?|eligible\s+to\s+receive|eligible\s+for\s+awards?)\b|\b(?:employees?,\s+directors?,\s+officers?,\s+consultants?\s+or\s+advisors?)\b/i.test(nearby)) {
    if (/For\s+purposes\s+of\s+Form\s+S-8|employee\s+includes\s+any\s+person|general\s+instruction|instructions?\s+to\s+Form\s+S-8/i.test(nearby)) {
      return "boilerplate_reference";
    }
    return lowerSignalSection ? "boilerplate_reference" : "plan_eligibility";
  }
  if (lowerSignalSection || /employees?,\s+directors?,\s+officers?,\s+consultants?\s+or\s+advisors?/i.test(nearby)) {
    return "boilerplate_reference";
  }
  return "unknown_context";
}

function isFinancingPromotionContext(value: string): boolean {
  return /\b(?:investor relations|public relations|promotional|promotion|promote|marketing|capital markets|financing|capital raising|placement agent|finder|broker|dealer|market maker|market-making|maintain a market|securities promotion|raising capital|services in connection with financing|services related to raising capital)\b/i.test(
    value,
  );
}

function isLowSignalAdvisorFalsePositive(value: string, term: string): boolean {
  if (/\b(?:legal|tax)\s+advis(?:o|e)rs?\b/i.test(value)) return true;
  if (/\binvestment\s+advis(?:o|e)r\b/i.test(value) && !/\b(?:shares?|awards?|plan|issuable|registered|consulting services?)\b/i.test(value)) return true;
  if (/\bfinancial\s+advis(?:o|e)r\b/i.test(value) && !/\b(?:shares?|awards?|plan|issuable|registered|consulting services?)\b/i.test(value)) return true;
  if (/service provider/i.test(term) && /\b(?:transfer agent|registrar|printer|vendor|EDGAR|filing agent)\b/i.test(value)) return true;
  return false;
}

function isLegalOpinionBoilerplate(value: string): boolean {
  return /\b(?:legal opinion|opinion|tax advisor|legal advisor|counsel|law firm|validly issued|fully paid|non-assessable)\b/i.test(
    value,
  );
}

function sectionForIndex(
  sections: S8DetectedSection[],
  index: number,
  textLength: number,
): S8ConsultantAdvisorContext["section"] {
  const found = sections.find((section) => {
    const end = section.end ?? textLength;
    return index >= section.start && index < end;
  });
  return found?.key ?? "unknown";
}

function inferConsultantBucketConfidence(
  bucket: S8ConsultantAdvisorContext["bucket"],
  section: S8ConsultantAdvisorContext["section"],
  lowerSignalSection: boolean,
): "high" | "medium" | "low" {
  if (bucket === "unknown_context") return "low";
  if (lowerSignalSection) return "low";
  if (bucket === "boilerplate_reference") return "medium";
  if (section === "unknown") return "medium";
  return "high";
}

function inferConsultantContextConfidence(contexts: S8ConsultantAdvisorContext[]): "high" | "medium" | "low" {
  if (!contexts.length) return "high";
  if (contexts.some((context) => context.confidence === "low")) return "low";
  if (contexts.some((context) => context.confidence === "medium")) return "medium";
  return "high";
}

function dedupeConsultantContexts(contexts: S8ConsultantAdvisorContext[]): S8ConsultantAdvisorContext[] {
  const seen = new Set<string>();
  return contexts.filter((context) => {
    const key = `${context.term.toLowerCase()}:${context.bucket}:${context.section}:${context.evidence.slice(0, 120)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildConsultantContextWarnings(contexts: S8ConsultantAdvisorContext[]): string[] {
  const warnings: string[] = [];
  if (contexts.some((context) => context.bucket === "financing_or_promotion_related")) {
    warnings.push("Consultant/advisor language appears near financing, promotion, market, or investor-relations services.");
  }
  if (contexts.some((context) => context.bucket === "actual_recipient_or_issuance")) {
    warnings.push("Consultant/advisor/service-provider language appears tied to specific share issuance or recipient context.");
  }
  if (contexts.some((context) => context.bucket === "plan_eligibility")) {
    warnings.push("Consultant/advisor/service-provider language appears in substantive plan eligibility context.");
  }
  if (contexts.some((context) => context.bucket === "unknown_context")) {
    warnings.push("Consultant/advisor/service-provider language was detected in an uncertain context.");
  }
  return warnings;
}

function extractCoverPlanNames(rawText: string): string[] {
  const names: string[] = [];
  const lines = rawText
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/tr>/gi, "\n")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const labelPattern = /(?:full\s+title\s+of\s+(?:the\s+)?plan|name\s+of\s+plan|plan\s+title|title\s+of\s+the\s+plan)\b[:\s-]*/i;

  lines.forEach((line, index) => {
    const labelMatch = line.match(labelPattern);
    if (labelMatch?.index != null) {
      const sameLineValue = truncateCoverPlanValue(cleanupWhitespace(line.slice(labelMatch.index + labelMatch[0].length)));
      if (sameLineValue && !isCoverPlanStopLine(sameLineValue)) names.push(...splitPlanNameList(sameLineValue));
      for (const nextLine of lines.slice(index + 1, index + 5)) {
        if (isCoverPlanStopLine(nextLine)) break;
        names.push(...splitPlanNameList(truncateCoverPlanValue(nextLine)));
      }
    }
  });

  const tablePattern =
    /<t[dh][^>]*>\s*(?:Full\s+title\s+of\s+(?:the\s+)?plan|Name\s+of\s+plan|Plan\s+title|Title\s+of\s+the\s+plan)\s*<\/t[dh]>\s*<t[dh][^>]*>([\s\S]{0,600}?)<\/t[dh]>/gi;
  let match = tablePattern.exec(rawText);
  while (match) {
    names.push(...splitPlanNameList(normalizeText(match[1])));
    match = tablePattern.exec(rawText);
  }

  return dedupePlanNames(names);
}

function truncateCoverPlanValue(value: string): string {
  return value
    .split(/\b(?:CALCULATION\s+OF\s+FILING\s+FEE|PART\s+I|PART\s+II|SIGNATURES|Name\s+of\s+Registrant|Address)\b/i)[0]
    .trim();
}

function isCoverPlanStopLine(value: string): boolean {
  return /^(?:name\s+of\s+(?:registrant|issuer)|address|telephone|copy\s+to|calculation\s+of\s+filing\s+fee|securities\s+to\s+be\s+registered|common\s+stock|part\s+i|part\s+ii|signatures?)\b/i.test(
    value,
  );
}

function extractPlanNamesFromContext(text: string): string[] {
  const names: string[] = [];
  const directPlanPattern = new RegExp(`(${PLAN_NAME_TEXT})`, "g");
  let directMatch = directPlanPattern.exec(text);

  while (directMatch) {
    names.push(...splitPlanNameList(directMatch[1]));
    directMatch = directPlanPattern.exec(text);
  }

  const contextPattern = new RegExp(
    String.raw`(?:under|pursuant\s+to|issuable\s+under|reserved\s+for\s+issuance\s+under|registered\s+under|additional\s+shares\s+under|shares\s+of\s+common\s+stock\s+under|in\s+connection\s+with|available\s+for\s+issuance\s+under|relating\s+to)\s+(?:the\s+)?(${PLAN_NAME_TEXT})`,
    "gi",
  );
  let contextMatch = contextPattern.exec(text);

  while (contextMatch) {
    names.push(...splitPlanNameList(contextMatch[1]));
    contextMatch = contextPattern.exec(text);
  }

  return dedupePlanNames(names);
}

function extractPlanNamesFromFeeRow(row: S8FeeTableRow): string[] {
  const text = [
    row.securityClassTitle,
    row.amountRegisteredText,
    row.maximumAggregateOfferingPriceText,
    row.footnotes?.join(" "),
    row.footnoteText?.join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  return extractPlanNamesFromContext(text);
}

function extractExplicitPlanShareAllocations(text: string): S8PlanShareAllocation[] {
  const allocations: S8PlanShareAllocation[] = [];
  const patterns = [
    /([\d,]+)\s+(?:additional\s+)?shares(?:\s+of\s+common\s+stock)?(?:\s+are\s+)?(?:being\s+)?(?:registered|reserved\s+for\s+issuance|available\s+for\s+issuance|issuable)?\s+(?:under|pursuant\s+to)\s+(?:the\s+)?([A-Z0-9][A-Za-z0-9&,.()' -]{2,180}?Plan)/gi,
    /(?:registers?|registered|registering|covers?)\s+(?:an\s+aggregate\s+of\s+)?([\d,]+)\s+(?:additional\s+)?shares[^.]{0,120}?\s+(?:under|pursuant\s+to)\s+(?:the\s+)?([A-Z0-9][A-Za-z0-9&,.()' -]{2,180}?Plan)/gi,
    /(?:Represents|Consists\s+of|Includes)\s+([\d,]+)\s+shares[^.]{0,120}?\s+(?:under|pursuant\s+to)\s+(?:the\s+)?([A-Z0-9][A-Za-z0-9&,.()' -]{2,180}?Plan)/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      const shares = toNumber(match[1]);
      const planName = cleanupPlanName(match[2]);
      if (shares != null && isUsefulPlanName(planName)) {
        allocations.push({
          planName,
          shares,
          source: "explanatory_note",
          confidence: "high",
          evidenceLevel: "direct",
        });
      }
      match = pattern.exec(text);
    }
  }

  return allocations;
}

function splitPlanNameList(value: string): string[] {
  const cleaned = cleanupPlanName(value);
  const semicolonParts = cleaned.split(/\s*;\s*/).flatMap((part) => part.split(/\s+\/\s+/));
  const parts: string[] = [];
  for (const part of semicolonParts) {
    const andParts = part.split(/\s+and\s+/i);
    if (andParts.length > 1 && andParts.every((candidate) => /\bPlan\b/i.test(candidate))) {
      parts.push(...andParts);
    } else {
      parts.push(part);
    }
  }
  return parts.map(cleanupPlanName).filter(isUsefulPlanName);
}

function dedupePlanNames(names: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const name of names) {
    const cleaned = cleanupPlanName(name);
    if (!isUsefulPlanName(cleaned)) continue;
    byKey.set(normalizePlanKey(cleaned), cleaned);
  }
  return Array.from(byKey.values());
}

function classifyPlanAttachmentSource(attachment: S8Attachment): PlanSource | null {
  const combined = `${attachment.documentType ?? ""} ${attachment.description ?? ""} ${attachment.text ?? ""}`;
  if (/EX-5\.1|LEGAL\s+OPINION|OPINION/i.test(combined) && /\bPlan\b/i.test(combined)) return "legal_opinion";
  if (/EXHIBIT\s+INDEX/i.test(combined) && /\bPlan\b/i.test(combined)) return "exhibit_index";
  if (/EX-10|PLAN|INCENTIVE|PURCHASE|RETIREMENT|SAVINGS/i.test(combined) && /\bPlan\b/i.test(combined)) return "plan_exhibit";
  return null;
}

function inferPlanType(value: string): S8PlanNameFact["planType"] {
  if (/employee\s+stock\s+purchase|ESPP/i.test(value)) return "employee_stock_purchase";
  if (/stock\s+option/i.test(value)) return "stock_option";
  if (/inducement/i.test(value)) return "inducement";
  if (/401\(k\)|savings|retirement/i.test(value)) return "savings_retirement";
  if (/equity\s+incentive|stock\s+incentive|management\s+incentive|omnibus/i.test(value)) return "equity_incentive";
  return "unknown";
}

function normalizePlanKey(value: string): string {
  return cleanupPlanName(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function combineConfidence(
  existing: "high" | "medium" | "low",
  incoming: "high" | "medium" | "low",
): "high" | "medium" | "low" {
  if (existing === "high" || incoming === "high") return "high";
  if (existing === "medium" || incoming === "medium") return "medium";
  return "low";
}

function comparePlanFacts(left: S8PlanNameFact, right: S8PlanNameFact): number {
  const sourceRank = (fact: S8PlanNameFact) => {
    if (fact.sources.includes("cover")) return 0;
    if (fact.sources.includes("fee_footnote") || fact.sources.includes("fee_table")) return 1;
    if (fact.sources.includes("explanatory_note")) return 2;
    if (fact.sources.includes("primary_body")) return 3;
    return 4;
  };
  return sourceRank(left) - sourceRank(right) || left.name.localeCompare(right.name);
}

function collapseContainedPlanFacts(facts: S8PlanNameFact[]): S8PlanNameFact[] {
  return facts.filter((fact) => {
    const own = normalizePlanKey(fact.name.replace(/^the\s+/i, ""));
    return !facts.some((other) => {
      if (other === fact) return false;
      const candidate = normalizePlanKey(other.name.replace(/^the\s+/i, ""));
      return candidate.length > own.length && candidate.endsWith(own);
    });
  });
}

function inferPlanExtractionConfidence(facts: S8PlanNameFact[], warnings: string[]): "high" | "medium" | "low" {
  if (!facts.length) return "low";
  if (warnings.some((warning) => /low confidence|conflict|ambiguous|only in exhibit|Multiple plan names/i.test(warning))) return "low";
  if (facts.some((fact) => fact.confidence === "low")) return "low";
  if (facts.some((fact) => fact.confidence === "medium")) return "medium";
  return "high";
}

function extractPriorRegistrationStatements(text: string): S8PriorRegistrationStatement[] {
  const statements = new Map<string, S8PriorRegistrationStatement>();
  const pattern = /(?:file|registration)\s+no\.?\s+(333-\d+)(?:\s+filed\s+on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4}))?/gi;
  let match = pattern.exec(text);

  while (match) {
    const nearby = text.slice(Math.max(0, match.index - 180), Math.min(text.length, match.index + 180));
    if (!/Form\s+(?:F-6|S-1|8-K|10-K|10-Q|20-F|6-K|DEF\s+14A)/i.test(nearby)) {
      statements.set(match[1], {
        fileNumber: match[1],
        filedAt: match[2] ?? extractNearbyDate(text, match.index),
      });
    }
    match = pattern.exec(text);
  }

  return Array.from(statements.values());
}

function extractReverseSplitAdjustments(text: string): S8ReverseSplitAdjustment[] {
  const adjustments: S8ReverseSplitAdjustment[] = [];
  const pattern = /(\d+\s*-for-\s*\d+)\s+reverse\s+stock\s+split(?:[^.]{0,120}?effective\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4}))?/gi;
  let match = pattern.exec(text);

  while (match) {
    adjustments.push({
      ratio: match[1].replace(/\s+/g, ""),
      effectiveAt: match[2] ?? null,
    });
    match = pattern.exec(text);
  }

  return adjustments;
}

function extractSellingSecurityholders(text: string, rawText = text): SellingHolderExtraction {
  const holders: S8SellingSecurityholder[] = [];
  const warnings: string[] = [];
  const fixtureRowPattern =
    /Selling\s+Securityholder:\s*([^|]+)\|\s*(?:Relationship:\s*([^|]+)\|)?\s*Shares\s+Owned\s+Before:\s*([\d,]+|--|N\/A)\s*\|\s*Percent\s+Owned\s+Before:\s*([^|]+)\|\s*Shares\s+(?:Registered|Offered):\s*([\d,]+|--|N\/A)/gi;
  let match = fixtureRowPattern.exec(text);

  while (match) {
    const relationship = match[2] ? cleanupWhitespace(match[2]) : null;
    holders.push({
      name: cleanupWhitespace(match[1]),
      relationship,
      relationshipHint: inferSellingHolderRelationshipHint(relationship),
      sharesOwnedBefore: toNullableNumber(match[3]),
      percentOwnedBefore: normalizePercentText(match[4]),
      sharesOffered: toNullableNumber(match[5]),
      sharesRegistered: toNullableNumber(match[5]),
      source: "fixture_row",
      confidence: "high",
    });
    match = fixtureRowPattern.exec(text);
  }

  holders.push(...extractHtmlSellingHolderRows(rawText));
  holders.push(...extractPlainTextSellingHolderRows(text));

  const tableStart = text.search(
    /Selling\s+(?:Security\s*Holder|Securityholder|Stockholder|Shareholder)\s+Shares\s+(?:Owned|Beneficially\s+Owned)\s+(?:Prior\s+to\s+(?:the\s+)?(?:Sale|Offering)|Prior\s+to\s+this\s+Offering)/i,
  );
  if (tableStart >= 0) {
    const tableEnd = text.indexOf("* Less than", tableStart);
    let tableText = text.slice(tableStart, tableEnd > tableStart ? tableEnd : tableStart + 4000);
    const headerMatch = tableText.match(
      /Selling\s+(?:Securityholder|Stockholder)\s+Shares\s+(?:Owned|Beneficially\s+Owned).*?(?:Shares\s+Registered|Offered\s+Shares)/i,
    );
    if (headerMatch?.index != null) {
      tableText = tableText.slice(headerMatch.index + headerMatch[0].length);
    }
    const actualRowPattern =
      /([A-Z][A-Za-z0-9.' -]+(?:\s+[A-Z][A-Za-z0-9.' -]+){0,4})\s+(?:\s*\([^)]+\))*\s*([\d,]+)\s+(?:\s*\([^)]+\))*\s*(\*|[\d.]+\s*%?)\s+([\d,]+)/g;
    let actualMatch = actualRowPattern.exec(tableText);

    while (actualMatch) {
      const name = cleanupWhitespace(actualMatch[1]);
      if (isUsefulSellingHolderName(name) && !holders.some((holder) => holder.name === name)) {
        holders.push({
          name,
          relationship: null,
          relationshipHint: "unknown",
          sharesOwnedBefore: toNullableNumber(actualMatch[2]),
          percentOwnedBefore: normalizePercentText(actualMatch[3]),
          sharesOffered: toNullableNumber(actualMatch[4]),
          sharesRegistered: toNullableNumber(actualMatch[4]),
          source: "plain_text",
          confidence: "medium",
        });
      }
      actualMatch = actualRowPattern.exec(tableText);
    }
  }

  const deduped = dedupeSellingHolders(holders);
  const hasSellingHolderContext = hasSellingHolderHeading(text);
  if (hasSellingHolderContext && deduped.length === 0) warnings.push("Selling-holder heading detected, but no selling-holder table rows were parsed.");
  if (deduped.some((holder) => holder.name && holder.sharesOffered == null && holder.sharesRegistered == null)) {
    warnings.push("Selling-holder rows were parsed, but at least one holder is missing offered-share values.");
  }
  if (deduped.some((holder) => holder.footnotes?.length && !holder.footnoteText?.length)) {
    warnings.push("Selling-holder footnote markers were detected but could not be mapped confidently.");
  }

  return {
    holders: deduped,
    confidence: deduped.length > 0 && warnings.length === 0 ? "high" : hasSellingHolderContext ? "low" : "medium",
    warnings,
    hasSellingHolderContext,
  };
}

function isUsefulSellingHolderName(value: string): boolean {
  return !/Selling Securityholder|Selling Stockholder|Selling Shareholder|Shares Owned|Percentage|Shares Registered|Prior to the Sale|Exhibit|Signature|Calculation of Filing Fee/i.test(value);
}

function extractHtmlSellingHolderRows(rawText: string): S8SellingSecurityholder[] {
  if (!/<table[\s>]/i.test(rawText) || !hasSellingHolderHeading(rawText)) return [];
  const rows: S8SellingSecurityholder[] = [];
  const tablePattern = /<table\b[\s\S]*?<\/table>/gi;
  let tableMatch = tablePattern.exec(rawText);
  while (tableMatch) {
    const tableHtml = tableMatch[0];
    const nearby = rawText.slice(Math.max(0, (tableMatch.index ?? 0) - 800), Math.min(rawText.length, (tableMatch.index ?? 0) + tableHtml.length + 800));
    if (!hasSellingHolderHeading(nearby) || isKnownNonSellingHolderTable(nearby)) {
      tableMatch = tablePattern.exec(rawText);
      continue;
    }
    rows.push(...extractSellingRowsFromMatrix(htmlTableToMatrix(tableHtml), nearby, "html_table"));
    tableMatch = tablePattern.exec(rawText);
  }
  return rows;
}

function extractPlainTextSellingHolderRows(text: string): S8SellingSecurityholder[] {
  if (!hasSellingHolderHeading(text)) return [];
  const start = text.search(/selling\s+(?:security\s*holders?|securityholders?|stockholders?|shareholders?)/i);
  if (start < 0) return [];
  const window = text.slice(start, Math.min(text.length, start + 5000));
  if (isKnownNonSellingHolderTable(window)) return [];
  const rows: S8SellingSecurityholder[] = [];
  const lineRows = window
    .split(/\r?\n|(?=Selling\s+Securityholder:)/i)
    .map((line) => cleanupWhitespace(line))
    .filter(Boolean);
  for (const line of lineRows) {
    const pipeCells = line.includes("|") ? line.split("|").map((cell) => cleanupWhitespace(cell)).filter(Boolean) : [];
    if (pipeCells.length >= 3) rows.push(...extractSellingRowsFromMatrix([pipeCells], line, "plain_text"));
    const simple = line.match(/^([A-Z][A-Za-z0-9 .,'&-]{2,90})\s+((?:Director|Officer|Employee|Consultant|Advisor|Affiliate|Former Officer|Former Director)[A-Za-z ,/-]*)?\s+([\d,]+)\s+(\*|<1%|less than 1%|[\d.]+%)?\s+([\d,]+)\s+([\d,]+|--|N\/A)?\s*(\*|<1%|less than 1%|[\d.]+%)?/i);
    if (simple && isUsefulSellingHolderName(simple[1])) {
      const relationship = simple[2] ? cleanupWhitespace(simple[2]) : null;
      rows.push({
        name: cleanupWhitespace(simple[1]),
        relationship,
        relationshipHint: inferSellingHolderRelationshipHint(relationship),
        sharesOwnedBefore: toNullableNumber(simple[3]),
        percentOwnedBefore: normalizePercentText(simple[4] ?? null),
        sharesOffered: toNullableNumber(simple[5]),
        sharesOwnedAfter: toNullableNumber(simple[6]),
        percentOwnedAfter: normalizePercentText(simple[7] ?? null),
        sharesRegistered: toNullableNumber(simple[5]),
        source: "plain_text",
        confidence: "medium",
      });
    }
  }
  return rows;
}

function extractSellingRowsFromMatrix(matrix: string[][], sourceText: string, source: S8SellingSecurityholder["source"]): S8SellingSecurityholder[] {
  const rows: S8SellingSecurityholder[] = [];
  const headerIndex = matrix.findIndex((cells) => cells.some((cell) => sellingHolderColumnForHeader(cell)));
  if (headerIndex < 0) return rows;
  const headers = matrix[headerIndex].map(sellingHolderColumnForHeader);
  if (!headers.includes("name") || !(headers.includes("sharesOffered") || headers.includes("sharesOwnedBefore") || headers.includes("sharesOwnedAfter"))) return rows;
  for (const cells of matrix.slice(headerIndex + 1)) {
    const values: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header || !cells[index]) return;
      values[header] = cells[index];
    });
    const name = values.name ? cleanupSellingHolderName(values.name) : null;
    if (!name || !isUsefulSellingHolderName(name)) continue;
    const offered = parseHolderShareNumber(values.sharesOffered);
    const before = parseHolderShareNumber(values.sharesOwnedBefore);
    const after = parseHolderShareNumber(values.sharesOwnedAfter);
    if (offered == null && before == null && after == null) continue;
    const relationship = values.relationship ? cleanupWhitespace(values.relationship) : null;
    const footnotes = extractHolderFootnotes(cells.join(" "));
    rows.push({
      name,
      relationship,
      relationshipHint: inferSellingHolderRelationshipHint(relationship),
      sharesOwnedBefore: before,
      percentOwnedBefore: normalizePercentText(values.percentOwnedBefore ?? null),
      sharesOffered: offered,
      sharesOwnedAfter: after,
      percentOwnedAfter: normalizePercentText(values.percentOwnedAfter ?? null),
      sharesRegistered: offered,
      footnotes,
      footnoteText: mapSellingHolderFootnotes(footnotes, sourceText),
      source,
      confidence: "high",
    });
  }
  return rows;
}

function sellingHolderColumnForHeader(value: string): string | null {
  const header = normalizeFeeHeader(value);
  if (/^(sellingsecurityholder|sellingsecurityholders|sellingsecurityholdername|sellingstockholder|sellingstockholders|sellingshareholder|sellingshareholders|name|nameofsellingstockholder|nameofsellingsecurityholder)$/.test(header)) return "name";
  if (/^(relationship|position|office|materialrelationship|relationshipwiththecompany|positionofficeorothermaterialrelationship|natureofrelationship)$/.test(header)) return "relationship";
  if (/^(sharesoffered|sharesbeingoffered|numberofsharesoffered|sharesregisteredforresale|sharescoveredbythisprospectus|commonstockoffered|offeredshares)$/.test(header)) return "sharesOffered";
  if (/^(sharesbeneficiallyownedpriortooffering|sharesbeneficiallyownedbeforeoffering|beneficialownershipbeforeoffering|numberofsharesownedbeforeoffering|sharesownedbeforeoffering|sharesownedprior)(?:number)?$/.test(header)) return "sharesOwnedBefore";
  if (/^(percentageownedbeforeoffering|percentownedbeforeoffering|percentagebeneficiallyownedbeforeoffering|percentbeneficiallyownedbeforeoffering)$/.test(header)) return "percentOwnedBefore";
  if (/^(sharesbeneficiallyownedafteroffering|beneficialownershipafteroffering|numberofsharesownedafteroffering|sharesownedafteroffering)(?:number)?$/.test(header)) return "sharesOwnedAfter";
  if (/^(percentageownedafteroffering|percentownedafteroffering|percentagebeneficiallyownedafteroffering|percentbeneficiallyownedafteroffering)$/.test(header)) return "percentOwnedAfter";
  return null;
}

function parseHolderShareNumber(value?: string | null): number | null {
  if (!value || isIndeterminateValue(value) || /^\s*\*+\s*$/.test(value)) return null;
  const cleaned = value.replace(/\([^)]*\)|[†*]/g, " ");
  const match = cleaned.match(/\b\d[\d,]*\b/);
  return match ? toNumber(match[0]) : null;
}

function normalizePercentText(value?: string | null): string | null {
  if (!value) return null;
  const cleaned = cleanupWhitespace(value.replace(/\([^)]*\)/g, ""));
  if (!cleaned || /^(?:--|N\/A|—|-|indeterminate)$/i.test(cleaned)) return null;
  if (/^\*+$/.test(cleaned)) return "*";
  if (/less than\s+1%|<\s*1%/i.test(cleaned)) return cleaned;
  const match = cleaned.match(/\d+(?:\.\d+)?\s*%/);
  return match ? match[0].replace(/\s+/g, "") : cleaned;
}

function cleanupSellingHolderName(value: string): string {
  return cleanupWhitespace(value.replace(/\([^)]*\)|[†*]/g, " ")).replace(/[.;:,]+$/, "");
}

function extractHolderFootnotes(value: string): string[] {
  const markers = new Set<string>();
  for (const match of value.matchAll(/\((\d+)\)|([†*]+)/g)) markers.add(match[0]);
  return Array.from(markers);
}

function mapSellingHolderFootnotes(markers: string[], sourceText: string): string[] {
  const normalized = normalizeText(sourceText);
  const mapped: string[] = [];
  for (const marker of markers) {
    const number = marker.match(/\d+/)?.[0];
    if (!number) continue;
    const paragraphPattern = new RegExp(`<p[^>]*>\\s*\\(${number}\\)\\s*([\\s\\S]{0,600}?)<\\/p>`, "i");
    const paragraphMatch = sourceText.match(paragraphPattern);
    if (paragraphMatch) {
      mapped.push(cleanupWhitespace(normalizeText(paragraphMatch[1])));
      continue;
    }
    const pattern = new RegExp(`\\(${number}\\)\\s*([^()]{0,500}?(?:sold|options?|RSUs?|awards?|less than|beneficial ownership|director|officer|relationship)[^.]*\\.)`, "i");
    const match = normalized.match(pattern);
    if (match) mapped.push(cleanupWhitespace(match[1]));
  }
  return Array.from(new Set(mapped));
}

function inferSellingHolderRelationshipHint(value?: string | null): NonNullable<S8SellingSecurityholder["relationshipHint"]> {
  if (!value) return "unknown";
  if (/former\s+officer/i.test(value)) return "former_officer";
  if (/former\s+director/i.test(value)) return "former_director";
  if (/affiliate/i.test(value)) return "affiliate";
  if (/director/i.test(value)) return "director";
  if (/\b(?:chief|officer|president|ceo|cfo|coo|secretary|treasurer)\b/i.test(value)) return "officer";
  if (/employee/i.test(value)) return "employee";
  if (/consult/i.test(value)) return "consultant";
  if (/advis/i.test(value)) return "advisor";
  return "unknown";
}

function dedupeSellingHolders(holders: S8SellingSecurityholder[]): S8SellingSecurityholder[] {
  const seen = new Set<string>();
  return holders.filter((holder) => {
    const key = [holder.name, holder.relationship, holder.sharesOwnedBefore, holder.sharesOffered, holder.sharesOwnedAfter].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasSellingHolderHeading(value: string): boolean {
  return /\bSELLING\s+(?:SECURITY\s*HOLDERS?|SECURITYHOLDERS?|STOCKHOLDERS?|SHAREHOLDERS?)\b/i.test(value);
}

function hasResaleContext(value: string): boolean {
  return /\b(?:REOFFER\s+PROSPECTUS|RESALE\s+PROSPECTUS|selling\s+(?:security\s*holders?|securityholders?|stockholders?|shareholders?)|shares?\s+(?:being\s+)?offered|registered\s+for\s+resale|plan\s+of\s+distribution)\b/i.test(value);
}

function isKnownNonSellingHolderTable(value: string): boolean {
  return /calculation\s+of\s+filing\s+fee|fee\s+table|exhibit\s+index|signature|legal\s+opinion|plan\s+summary|document\s+index/i.test(value) &&
    !hasSellingHolderHeading(value);
}

function extractInducementAwards(text: string): S8InducementAward[] {
  const awards: S8InducementAward[] = [];
  const patternWithGrant =
    /(stock\s+options?|restricted\s+stock\s+units?|RSU\s+Awards?)(?:\s*["')]+)?\s+(?:to\s+purchase\s+|covering\s+|representing\s+|with\s+respect\s+to\s+(?:an\s+aggregate\s+of\s+|of\s+)?)?(?:an\s+aggregate\s+of\s+)?([\d,]+)\s+shares[^.]*?granted\s+to\s+(\d+)[^.]*?\s+on\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/gi;
  const patternWithoutGrant =
    /(stock\s+options?|restricted\s+stock\s+units?|RSU\s+Awards?)(?:\s*["')]+)?\s+(?:to\s+purchase\s+|covering\s+|representing\s+|with\s+respect\s+to\s+(?:an\s+aggregate\s+of\s+|of\s+)?)?(?:an\s+aggregate\s+of\s+)?([\d,]+)\s+shares/gi;
  const seen = new Set<string>();
  let match = patternWithGrant.exec(text);

  while (match) {
    const shares = toNumber(match[2]);
    if (shares) {
      seen.add(`${match[1]}:${shares}`);
      awards.push({
        awardType: cleanupWhitespace(match[1]).replace(/^rsu/i, "RSU"),
        shares,
        recipientCount: Number(match[3]),
        grantedAt: match[4],
      });
    }
    match = patternWithGrant.exec(text);
  }

  match = patternWithoutGrant.exec(text);
  while (match) {
    const shares = toNumber(match[2]);
    const key = `${match[1]}:${shares ?? ""}`;
    if (shares && !seen.has(key)) {
      awards.push({
        awardType: cleanupWhitespace(match[1]).replace(/^rsu/i, "RSU"),
        shares,
        recipientCount: null,
        grantedAt: null,
      });
    }
    match = patternWithoutGrant.exec(text);
  }

  return awards;
}

function extractFilingProvidedPrice(text: string): S8ParserOutput["facts"]["filingProvidedPrice"] {
  const match =
    text.match(
    /last\s+(?:reported\s+)?sale\s+price\s+(?:of\s+.*?\s+)?(?:was|is)\s+\$?([\d,]+(?:\.\d+)?)\s+(?:on|as\s+of)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i,
    ) ??
    text.match(
      /(?:on|as\s+of)\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4}),?\s+the\s+last\s+(?:reported\s+)?sale\s+price\s+(?:of\s+.*?\s+)?(?:was|is)\s+\$?([\d,]+(?:\.\d+)?)/i,
    );

  if (!match) return null;

  const priceFirst = /^\d/.test(match[1]);
  const price = toNumber(priceFirst ? match[1] : match[2]);
  if (price == null) return null;

  return {
    price,
    pricedAt: priceFirst ? match[2] : match[1],
    source: "filing_text",
  };
}

function extractPlanNames(text: string): string[] {
  const names = new Set<string>();
  for (const name of extractPlanNamesFromContext(text)) names.add(name);
  PLAN_PATTERN.lastIndex = 0;
  let match = PLAN_PATTERN.exec(text);
  while (match) {
    for (const name of splitPlanNameList(match[1])) names.add(name);
    match = PLAN_PATTERN.exec(text);
  }
  return Array.from(names);
}

function isUsefulPlanName(value: string): boolean {
  if (!value || value.length < 5 || value.length > 130) return false;
  if (
    /Securities Act|Registration Statement|we are registering|grants under the Plan|pursuant to our Plan|Item\s+\d|Exhibit Number|Claimed\.|shares offered|received by such persons|Director Agreement|Registrant Information|outside of|Inducement Awards were granted|registration statement relates to|filed solely|signature page|Power of Attorney|contained in each/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/^(?:the\s+)?(?:Plan|Stock Plan|Incentive Plan|Equity Plan|Employee Plan)$/i.test(value)) return false;
  if (!/\b(?:Plan|Program|Agreement|Arrangement|Award)\b/i.test(value)) return false;
  return true;
}

function extractSecurityType(text: string): string | null {
  const patterns = [
    /class\s+[a-z]\s+common\s+stock/i,
    /common\s+stock/i,
    /ordinary\s+shares/i,
    /common\s+shares/i,
    /american\s+depositary\s+shares/i,
    /\bADSs?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/\bads\b/i, "ADS").replace(/\badss\b/i, "ADSs");
  }

  return null;
}

function extractDollarAmount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const amount = match ? toNumber(match[1]) : null;
    if (amount != null) return amount;
  }

  return null;
}

function extractReofferShares(text: string, holders: S8SellingSecurityholder[]): number | null {
  const explicit =
    text.match(/reoffer\s+prospectus\s+(?:covers|relates\s+to)\s+(?:up\s+to\s+)?([\d,]+)\s+shares/i) ??
    text.match(/reoffer\s+and\s+resale\s+of\s+[^(]*\(([\d,]+)\)\s+(?:ordinary\s+)?shares/i) ??
    text.match(/shares\s+offered\s+her(?:e)?by\s+consist\s+of\s+([\d,]+)\s+(?:ordinary\s+)?shares/i);
  const explicitShares = explicit ? toNumber(explicit[1]) : null;
  if (explicitShares != null) return explicitShares;

  const holderTotal = holders.reduce((sum, holder) => sum + (holder.sharesRegistered ?? 0), 0);
  return holderTotal > 0 ? holderTotal : null;
}

function extractReofferNoIssuerProceeds(text: string): boolean {
  return /(?:we|the\s+company|registrant)\s+will\s+not\s+receive\s+(?:any\s+|all\s+)?(?:of\s+the\s+)?proceeds/i.test(
    text,
  );
}

function extractPlanNameFromFeeTitle(value: string): string | null {
  const match = value.match(/,\s*(.+?(?:Plan|Program|Agreement|Arrangement|Award|Inducement Plan|Stock Plan|Incentive Plan))$/i);
  return match ? cleanupPlanName(match[1]) : null;
}

function extractNearbyDate(text: string, index: number): string | null {
  const windowStart = Math.max(0, index - 120);
  const window = text.slice(windowStart, Math.min(text.length, index + 120));
  const matches = Array.from(window.matchAll(/[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/g));
  const closest = matches.sort((left, right) => {
    const leftDistance = Math.abs(windowStart + (left.index ?? 0) - index);
    const rightDistance = Math.abs(windowStart + (right.index ?? 0) - index);
    return leftDistance - rightDistance;
  })[0];
  return closest ? closest[0] : null;
}

function dedupeFeeRows(rows: S8FeeTableRow[]): S8FeeTableRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.securityClassTitle,
      row.amountRegistered,
      row.proposedMaximumOfferingPricePerUnit,
      row.maximumAggregateOfferingPrice,
      row.registrationFee,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sumFeeTableShares(rows: S8FeeTableRow[]): number | null {
  const total = rows.reduce((sum, row) => {
    if (row.isPlanInterest || !isShareLikeFeeSecurity(row)) return sum;
    return sum + (row.amountRegistered ?? 0);
  }, 0);
  return total > 0 ? total : null;
}

function sumFeeTableOfferingAmount(rows: S8FeeTableRow[]): number | null {
  const total = rows.reduce((sum, row) => sum + (row.maximumAggregateOfferingPrice ?? 0), 0);
  return total > 0 ? roundTo(total, 2) : null;
}

function sumFeeTableRegistrationFees(rows: S8FeeTableRow[]): number | null {
  const total = rows.reduce((sum, row) => sum + (row.registrationFee ?? 0), 0);
  return total > 0 ? roundTo(total, 2) : null;
}

function isShareLikeFeeSecurity(row: S8FeeTableRow): boolean {
  const text = `${row.securityType ?? ""} ${row.securityClassTitle ?? ""}`;
  if (/plan\s+interests?/i.test(text)) return false;
  if (!text.trim()) return true;
  return /\b(?:equity|common stock|ordinary shares|common shares|class [a-z] common|american depositary shares|ads|shares?)\b/i.test(
    text,
  );
}

function isUnusualFeeSecurityRow(row: S8FeeTableRow): boolean {
  const text = `${row.securityType ?? ""} ${row.securityClassTitle ?? ""}`;
  const normalized = text.replace(/\brestricted\s+stock\s+units?\b/gi, "").replace(/\bperformance\s+stock\s+units?\b/gi, "");
  return /\b(?:preferred|warrants?|convertible|american depositary shares|ads|units?|rights?)\b/i.test(normalized);
}

function feeRowsShareTotalsAgree(left: S8FeeTableRow[], right: S8FeeTableRow[]): boolean {
  const leftTotal = sumFeeTableShares(left);
  const rightTotal = sumFeeTableShares(right);
  if (leftTotal == null || rightTotal == null) return true;
  return leftTotal === rightTotal;
}

function buildFeeTablePurposeConflicts(params: {
  formType: string;
  fullText: string;
  normalizedS8Type: S8NormalizedFilingType;
  noAdditionalSecurities: boolean;
  deregistrationOfUnsoldSecurities: boolean;
  generalInstructionE: boolean;
  feeTableRows: S8FeeTableRow[];
  planInterests: boolean;
  planNameFacts: S8PlanNameFact[];
  planShareAllocations: S8PlanShareAllocation[];
}): string[] {
  const conflicts: string[] = [];
  const newlyRegisteredShareRows = params.feeTableRows.filter((row) => {
    return !row.isPlanInterest && isShareLikeFeeSecurity(row) && row.amountRegistered != null && row.amountRegistered > 0;
  });

  if ((params.noAdditionalSecurities || params.deregistrationOfUnsoldSecurities) && newlyRegisteredShareRows.length > 0) {
    conflicts.push("Filing purpose says no additional or unsold securities, but fee table contains newly registered securities.");
  }

  if (/^S-8\s+POS$/i.test(params.formType.trim()) && newlyRegisteredShareRows.length > 0) {
    conflicts.push("EDGAR S-8 POS filing contains fee-table rows for newly registered securities.");
  }

  if (/^S-8\s+POS$/i.test(params.formType.trim()) && params.generalInstructionE) {
    conflicts.push("EDGAR S-8 POS filing also references General Instruction E additional-securities context.");
  }

  if (params.generalInstructionE && newlyRegisteredShareRows.length === 0) {
    conflicts.push("Explanatory note says additional securities under General Instruction E, but no clear fee-table share amount was found.");
  }

  if (
    newlyRegisteredShareRows.length > 0 &&
    params.planInterests &&
    params.planNameFacts.length === 0 &&
    params.planShareAllocations.length === 0
  ) {
    conflicts.push("Fee table contains common-stock rows, but plan extraction only found plan-interest context.");
  }

  if (
    newlyRegisteredShareRows.length > 0 &&
    params.planNameFacts.length > 1 &&
    params.planShareAllocations.length === 0
  ) {
    conflicts.push("Fee table amount exists, but plan-to-share mapping is unclear across multiple plans.");
  }

  if (params.feeTableRows.some(isUnusualFeeSecurityRow)) {
    conflicts.push("Fee table includes unusual securities for S-8 such as preferred stock, warrants, convertibles, ADS, units, or rights.");
  }

  if (params.normalizedS8Type === "ambiguous_conflicting_s8_family" && newlyRegisteredShareRows.length > 0) {
    conflicts.push("Ambiguous S-8 family classification is paired with newly registered fee-table rows.");
  }

  return conflicts;
}

function inferAdditionalShares(params: {
  isAmendment: boolean;
  text: string;
  registeredShares: number | null;
  parentRegisteredShares: number | null;
  noAdditionalSecurities: boolean;
  correctionOnly: boolean;
}): number | null {
  const { isAmendment, text, registeredShares, parentRegisteredShares, noAdditionalSecurities, correctionOnly } =
    params;
  if (!registeredShares || noAdditionalSecurities || correctionOnly) return null;
  if (!isAmendment) return null;

  if (/additional\s+(?:shares|securities)/i.test(text)) return registeredShares;
  if (parentRegisteredShares != null && registeredShares > parentRegisteredShares) {
    return registeredShares - parentRegisteredShares;
  }

  return null;
}

function inferAmendmentType(params: {
  isAmendment: boolean;
  postEffectiveAmendment: boolean;
  deregistrationOfUnsoldSecurities: boolean;
  noAdditionalSecurities: boolean;
  exhibitOnly: boolean;
  signatureOnly: boolean;
  correctionOnly: boolean;
  additionalShares: number | null;
}): string | null {
  if (!params.isAmendment) return null;
  if (params.postEffectiveAmendment && params.deregistrationOfUnsoldSecurities) return "post_effective_deregistration";
  if (params.postEffectiveAmendment) return "post_effective_amendment";
  if (params.correctionOnly && params.noAdditionalSecurities) return "correction_only_no_new_securities";
  if (params.correctionOnly) return "correction_only";
  if (params.noAdditionalSecurities && params.exhibitOnly) return "exhibit_only_no_new_securities";
  if (params.noAdditionalSecurities && params.signatureOnly) return "signature_only_no_new_securities";
  if (params.noAdditionalSecurities) return "administrative_no_new_securities";
  if (params.additionalShares && params.additionalShares > 0) return "additional_share_registration";
  return "amendment_needs_review";
}

function buildWarnings(formType: string, facts: S8ParserOutput["facts"]): string[] {
  const warnings: string[] = [];

  if (!facts.s8FamilyDetected) {
    warnings.push("Fixture form type is outside the S-8 / S-8/A room scope.");
  }

  if (facts.registeredShares == null && !facts.noAdditionalSecurities && !facts.correctionOnly) {
    warnings.push("Registered share count was not extracted.");
  }

  if (facts.needsParentComparison) {
    warnings.push("S-8/A parent filing context is needed to compare amendment impact.");
  }

  if (facts.reofferProspectus && !facts.sellingSecurityholders?.length) {
    warnings.push("Reoffer prospectus detected but selling-securityholder rows were not extracted.");
  }

  if (facts.sectionExtractionConfidence === "low") {
    warnings.push("S-8 primary document section extraction confidence is low.");
  }

  if (facts.normalizedS8Type === "ambiguous_conflicting_s8_family") {
    warnings.push("S-8 family purpose classification is ambiguous or conflicting.");
  }

  if (facts.s8PosRegistersAdditionalSecurities) {
    warnings.push("S-8 POS appears to register additional securities and must not be treated as routine.");
  }

  warnings.push(...(facts.feeTableWarnings ?? []));
  warnings.push(...(facts.feeTablePurposeConflicts ?? []));
  warnings.push(...(facts.planExtractionWarnings ?? []));
  warnings.push(...(facts.consultantAdvisorContextWarnings ?? []));
  warnings.push(...(facts.sellingHolderWarnings ?? []));

  return warnings;
}

function buildSummary(issuerName: string | null, facts: S8ParserOutput["facts"]): string {
  const issuer = issuerName ?? "Issuer";

  if (facts.noAdditionalSecurities) {
    return `${issuer} filed an S-8/A amendment that appears administrative and does not register additional securities.`;
  }

  if (facts.reofferProspectus && facts.reofferShares != null) {
    return `${issuer} filed an S-8 with a reoffer prospectus covering ${formatNumber(facts.reofferShares)} resale shares.`;
  }

  if (facts.correctionOnly) {
    return `${issuer} filed an S-8 amendment that appears to correct previously filed registration text.`;
  }

  if (facts.inducementAwardTotalShares != null) {
    return `${issuer} filed an S-8 registering ${formatNumber(facts.inducementAwardTotalShares)} inducement-award shares.`;
  }

  if (facts.registeredShares != null) {
    const shareText = `${formatNumber(facts.registeredShares)} ${facts.securityType ?? "securities"}`;
    const planText = facts.planNames.length > 0 ? ` under ${facts.planNames.join("; ")}` : "";
    return `${issuer} filed an ${facts.isAmendment ? "S-8/A" : "S-8"} registering ${shareText}${planText}.`;
  }

  return `${issuer} filed an ${facts.isAmendment ? "S-8/A" : "S-8"}, but key registration terms need review.`;
}

function cleanupPlanName(value: string): string {
  let cleaned = value.replace(/\s+/g, " ").replace(/[.;:,]+$/, "").trim();
  const splitPatterns = [
    /under\s+our\s+/gi,
    /under\s+the\s+/gi,
    /under\s+/gi,
    /pursuant\s+to\s+our\s+/gi,
    /pursuant\s+to\s+the\s+/gi,
  ];
  for (const pattern of splitPatterns) {
    const matches = Array.from(cleaned.matchAll(pattern));
    const last = matches.at(-1);
    if (last?.index != null) {
      cleaned = cleaned.slice(last.index + last[0].length).trim();
      break;
    }
  }
  const parenIndex = cleaned.lastIndexOf(") ");
  if (parenIndex >= 0) cleaned = cleaned.slice(parenIndex + 2).trim();
  cleaned = cleaned.replace(/^(?:the\s+)?(?:Company's|Registrant's|our)\s+/i, "");
  cleaned = cleaned.replace(/^(?:Common Stock|Ordinary Shares|Common Shares|Equity),?\s+/i, "");
  cleaned = cleaned.replace(/^\$?[\d,.]+\s+Equity\s+/i, "");
  cleaned = cleaned.replace(/^FORM\s+S-8\.?\s+/i, "");
  cleaned = cleaned.replace(/^Full\s+title\s+of\s+(?:the\s+)?plan\s+/i, "");
  cleaned = cleaned
    .replace(/\s*,?\s*as\s+amended(?:\s+and\s+restated)?(?:\s+from\s+time\s+to\s+time)?\b.*$/i, "")
    .replace(/\s+as\s+may\s+be\s+amended\s+from\s+time\s+to\s+time\b.*$/i, "")
    .replace(/\s+and\s+any\s+successor\s+plan\b.*$/i, "")
    .replace(/\s+together\s+with\s+associated\s+rights\b.*$/i, "")
    .replace(/\s+pursuant\s+to\b.*$/i, "")
    .replace(/\s+under\s+which\b.*$/i, "");
  return cleaned.replace(/[.;:,]+$/, "").trim();
}

function cleanupWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cleanupFeeRule(value: string): string {
  return cleanupWhitespace(value).replace(/\s*\(\d+\)\s*$/g, "");
}

function cleanupFfdValue(value: string): string {
  return cleanupWhitespace(decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")));
}

function getAttributeValue(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeHtmlEntities(match[1]) : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&apos;|&rsquo;/g, "'");
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function toFeeNumber(value: string | undefined): number | null {
  if (!value) return null;
  if (isIndeterminateValue(value)) return null;
  const isPercent = value.includes("%");
  const normalized = value
    .replace(/\([^)]*\)/g, "")
    .replace(/[$,%\s]/g, "")
    .replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return isPercent ? parsed / 100 : parsed;
}

function isIndeterminateValue(value: string): boolean {
  return /^(?:\s*|N\/A|--|-|—|–|Indeterminate)$/i.test(value.trim()) ||
    /such\s+(?:indeterminate|additional)\s+(?:number|amount)\b/i.test(value);
}

function toNullableNumber(value?: string | null): number | null {
  if (!value) return null;
  if (/^(?:--|N\/A)$/i.test(value.trim())) return null;
  return toNumber(value);
}

function hasAttachmentDescription(attachments: S8Attachment[], pattern: RegExp): boolean {
  return attachments.some((attachment) => {
    return pattern.test(`${attachment.documentType ?? ""} ${attachment.description ?? ""} ${attachment.text ?? ""}`);
  });
}

function percentOf(value?: number | null, denominator?: number | null): number | null {
  if (!value || !denominator || denominator <= 0) return null;
  return roundTo((value / denominator) * 100, 2);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compactEvidence(values: Array<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatNullableNumber(value: number | null): string {
  return value == null ? "unknown amount" : formatNumber(value);
}
