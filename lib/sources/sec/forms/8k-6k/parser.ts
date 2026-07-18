import {
  SEC_8K_6K_FORM_SCOPE,
  SEC_8K_6K_PARSER_GROUP,
  SEC_8K_6K_PARSER_VERSION,
  type Sec8k6kAmendmentInfo,
  type Sec8k6kCalendarItem,
  type Sec8k6kConfidence,
  type Sec8k6kDocumentSummary,
  type Sec8k6kDocumentRoutingOutline,
  type Sec8k6kField,
  type Sec8k6kFilingCue,
  type Sec8k6kFilingCueType,
  type Sec8k6kItem,
  type Sec8k6kMarketContextFacts,
  type Sec8k6kMoneyField,
  type Sec8k6kMoneyValue,
  type Sec8k6kNumberField,
  type Sec8k6kParseInput,
  type Sec8k6kParserOutput,
  type Sec8k6kParserSignal,
  type Sec8k6kReferencedFiling,
  type Sec8k6kUnnumberedSection,
} from "./types";
import { extractSecDocumentRoutingOutline, findSecDocumentHeadline, semanticHeadlineCandidate } from "./documentHeadline";

const SEC_8K_6K_FORMS = ["8-K", "6-K", "8-K/A", "6-K/A"] as const;

type Sec8k6kFormType = (typeof SEC_8K_6K_FORMS)[number];

type DocumentPayload = {
  type?: unknown;
  description?: unknown;
  document?: unknown;
  documentRole?: unknown;
  filename?: unknown;
  url?: unknown;
  includedInParserText?: unknown;
  includedTextCharCount?: unknown;
  importantForParsing?: unknown;
  isPrimary?: unknown;
  noiseClass?: unknown;
  omittedDueToLimit?: unknown;
  sequence?: unknown;
  selectionPriority?: unknown;
  selectionReason?: unknown;
  structuredTableCount?: unknown;
  structuredTables?: unknown;
  tableLikeLineCount?: unknown;
  textCharCount?: unknown;
  textExtractionStatus?: unknown;
  textTruncated?: unknown;
  fetchStatus?: unknown;
  fetchError?: unknown;
};

type AttachmentTextPayload = {
  type?: unknown;
  description?: unknown;
  filename?: unknown;
  url?: unknown;
  text?: unknown;
};

type CuePattern = {
  cueType: Sec8k6kFilingCueType;
  label: string;
  patterns: RegExp[];
  itemNumbers?: string[];
  confidence: Sec8k6kConfidence;
};

type FormProfileFacts = {
  parserPath: "8k_item_sections" | "6k_wrapper_exhibits" | "unknown";
  is8kLike: boolean;
  is6kLike: boolean;
  primaryTextCharCount: number;
  primaryIsShort: boolean;
  primaryHasMeaningfulContent: boolean;
  primaryIsWrapper: boolean;
  wrapperEvidence: string | null;
  meaningfulExhibitCount: number;
  meaningfulTextExhibitCount: number;
  meaningfulNonTextExhibitCount: number;
};

const SUPPORTED_8K_ITEM_NUMBERS = [
  "1.01", "1.02", "1.03", "1.04", "1.05",
  "2.01", "2.02", "2.03", "2.04", "2.05", "2.06",
  "3.01", "3.02", "3.03",
  "4.01", "4.02",
  "5.01", "5.02", "5.03", "5.04", "5.05", "5.06", "5.07", "5.08",
  "6.01", "6.02", "6.03", "6.04", "6.05", "6.06",
  "7.01", "8.01", "9.01",
] as const;

const SUPPORTED_8K_ITEM_NUMBER_SET = new Set<string>(SUPPORTED_8K_ITEM_NUMBERS);
const ITEM_HEADING_PATTERN = new RegExp(`^\\s*\\|?\\s*Item\\s+(${SUPPORTED_8K_ITEM_NUMBERS.map(escapeRegExp).join("|")})\\.?\\s*(.*?)\\s*\\|?\\s*$`, "i");

const ITEM_LABELS: Record<string, string> = {
  "1.01": "Entry into a Material Definitive Agreement",
  "1.02": "Termination of a Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "1.04": "Mine Safety",
  "1.05": "Material Cybersecurity Incidents",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations and Financial Condition",
  "2.03": "Creation of a Direct Financial Obligation",
  "2.04": "Triggering Events That Accelerate a Direct Financial Obligation",
  "2.05": "Costs Associated with Exit or Disposal Activities",
  "2.06": "Material Impairments",
  "3.01": "Notice of Delisting or Failure to Satisfy a Continued Listing Rule",
  "3.02": "Unregistered Sales of Equity Securities",
  "3.03": "Material Modification to Rights of Security Holders",
  "4.01": "Changes in Registrant's Certifying Accountant",
  "4.02": "Non-Reliance on Previously Issued Financial Statements",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure or Appointment of Directors or Officers",
  "5.03": "Amendments to Articles or Bylaws",
  "5.04": "Temporary Suspension of Trading Under Employee Benefit Plans",
  "5.05": "Amendments to Code of Ethics",
  "5.06": "Change in Shell Company Status",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "5.08": "Shareholder Director Nominations",
  "6.01": "ABS Informational and Computational Material",
  "6.02": "Change of Servicer or Trustee",
  "6.03": "Change in Credit Enhancement or External Support",
  "6.04": "Failure to Make a Required Distribution",
  "6.05": "Securities Act Updating Disclosure",
  "6.06": "Static Pool",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events",
  "9.01": "Financial Statements and Exhibits",
};

const SIX_K_WRAPPER_PATTERNS = [
  /\bReport of Foreign Private Issuer\b/i,
  /\battached hereto\b/i,
  /\bfurnished herewith\b/i,
  /\bas Exhibit\s+99(?:\.\d+)?\b/i,
  /\bincorporated by reference\b/i,
  /\bmade public in its home jurisdiction\b/i,
  /\bsubmitted to (?:the )?(?:stock )?exchange\b/i,
];

const FILING_CUE_PATTERNS: CuePattern[] = [
  {
    cueType: "exchange_listing_notice",
    label: "Exchange listing notice or deficiency language",
    itemNumbers: ["3.01"],
    patterns: [
      /\b(?:nasdaq|nyse|exchange)\b[\s\S]{0,180}?\b(?:deficiency|delist(?:ing)?|continued listing|minimum bid|listing standard|noncompliance)\b/i,
      /\b(?:notice|notification)\s+from\s+(?:nasdaq|nyse|the exchange)\b/i,
    ],
    confidence: "high",
  },
  {
    cueType: "securities_offering_or_issuance",
    label: "Securities offering, share issuance, warrant, convertible, or ATM language",
    itemNumbers: ["3.02"],
    patterns: [
      /\b(?:registered direct offering|private placement|securities purchase agreement|at-the-market|ATM offering|equity distribution agreement)\b/i,
      /\b(?:warrants?|convertible notes?|common stock|ordinary shares)[\s\S]{0,180}?\b(?:purchase price|exercise price|gross proceeds|issued|sold|offered)\b/i,
      /\b(?:gross proceeds|aggregate offering price)\s+(?:of|were|will be)?\s*\$?\d/i,
    ],
    confidence: "high",
  },
  {
    cueType: "financial_results",
    label: "Periodic financial results language",
    itemNumbers: ["2.02"],
    patterns: [
      /\b(?:earnings release|financial results|results of operations|quarter(?:ly)? results|fiscal (?:quarter|year))\b/i,
      /\b(?:net income|net loss|earnings per share|EPS|adjusted EBITDA)\b/i,
    ],
    confidence: "high",
  },
  {
    cueType: "sales_or_operating_update",
    label: "Sales, bookings, deliveries, production, or operating update language",
    patterns: [
      /\b(?:preliminary revenue|net sales|same-store sales|comparable sales|bookings|backlog|deliveries|production volumes|monthly sales)\b/i,
      /\b(?:sold|delivered|produced)\s+\d[\d,]*\s+(?:vehicles|units|homes|systems|devices)\b/i,
    ],
    confidence: "medium",
  },
  {
    cueType: "product_or_commercial_update",
    label: "Product, platform, launch, deployment, clearance, or certification language",
    patterns: [
      /\b(?:launch(?:ed|es)?|commercial launch|product release|new platform|customer deployment|strategic product)\b/i,
      /\b(?:received|obtained)\s+(?:CE mark|510\(k\)|clearance|certification)\b/i,
    ],
    confidence: "medium",
  },
  {
    cueType: "leadership_or_governance_change",
    label: "Executive, director, board, bylaw, or governance change language",
    itemNumbers: ["5.02", "5.03"],
    patterns: [
      /\b(?:resign(?:ed|ation)?|appointed|elected|terminated|depart(?:ed|ure)|chief executive officer|chief financial officer|director|board of directors|bylaws?)\b/i,
    ],
    confidence: "high",
  },
  {
    cueType: "insider_or_control_update",
    label: "Insider, beneficial ownership, control, standstill, or voting agreement language",
    patterns: [
      /\b(?:beneficial ownership|beneficially owns|insider ownership|control person|standstill agreement|voting agreement)\b/i,
      /\b(?:director|officer|insider)[\s\S]{0,140}?\b(?:acquired|disposed|purchased|sold)\b/i,
    ],
    confidence: "medium",
  },
  {
    cueType: "shareholder_vote_or_approval",
    label: "Shareholder vote, meeting, proposal, approval, or vote tally language",
    itemNumbers: ["5.07"],
    patterns: [
      /\b(?:shareholder|stockholder)\s+(?:vote|approval|meeting|approved|rejected|proposal)\b/i,
      /\b(?:votes\s+for|votes\s+against|abstain|broker non-votes)\b/i,
    ],
    confidence: "high",
  },
  {
    cueType: "strategic_transaction_terms",
    label: "Merger, acquisition, asset sale, joint venture, or business combination language",
    itemNumbers: ["2.01"],
    patterns: [
      /\b(?:merger agreement|acquisition|acquire|asset sale|divestiture|joint venture|business combination|sale of substantially all assets)\b/i,
      /\b(?:completed|closed|entered into)[\s\S]{0,160}?\b(?:merger|acquisition|asset sale|divestiture|business combination|joint venture|sale agreement)\b/i,
    ],
    confidence: "high",
  },
  {
    cueType: "financial_distress_or_default",
    label: "Default, liquidity, going concern, bankruptcy, impairment, restructuring, or financial distress language",
    itemNumbers: ["2.04", "2.05", "2.06"],
    patterns: [
      /\b(?:default|event of default|covenant breach|liquidity|going concern|bankruptcy|chapter 11|impairment|restructuring|workforce reduction)\b/i,
      /\b(?:material impairment|exit or disposal activities|cost reduction plan)\b/i,
    ],
    confidence: "high",
  },
  {
    cueType: "legal_or_regulatory_proceeding",
    label: "Litigation, investigation, subpoena, settlement, or enforcement language",
    patterns: [
      /\b(?:lawsuit|litigation|complaint|settlement|subpoena|civil investigative demand|SEC investigation|DOJ investigation|enforcement action)\b/i,
    ],
    confidence: "medium",
  },
  {
    cueType: "dividend_declaration",
    label: "Dividend declaration, record date, or payment date language",
    patterns: [
      /\b(?:declared|approved|announced)\s+(?:a\s+)?(?:quarterly|special|cash|regular)?\s*dividend\b/i,
      /\b(?:record date|payment date)[\s\S]{0,120}?\bdividend\b/i,
    ],
    confidence: "high",
  },
  {
    cueType: "capital_return_authorization",
    label: "Share repurchase, buyback, or repurchase authorization language",
    patterns: [
      /\b(?:share repurchase program|stock repurchase program|buyback|repurchase authorization|authorized repurchases?)\b/i,
      /\b(?:repurchase|buy back)\s+(?:up to\s+)?\$?\d/i,
    ],
    confidence: "high",
  },
  {
    cueType: "fda_or_clinical_update",
    label: "FDA, clinical trial, endpoint, PDUFA, NDA, BLA, IND, CRL, or health regulatory language",
    patterns: [
      /\b(?:FDA|PDUFA|NDA|BLA|IND|clinical trial|Phase\s+[123]|primary endpoint|complete response letter|CRL|topline data)\b/i,
      /\b(?:met its primary endpoint|failed to meet its primary endpoint|accepted for review by the FDA)\b/i,
    ],
    confidence: "high",
  },
];

export function parseSec8k6kFiling(input: Sec8k6kParseInput): Sec8k6kParserOutput {
  const rawPayload = toRecord(input.rawPayload) || {};
  const metadata = toRecord(input.metadata) || {};
  const documents = recordArray(rawPayload.documents) as DocumentPayload[];
  const attachmentTexts = recordArray(rawPayload.attachment_texts) as AttachmentTextPayload[];
  const documentSummaries = documents.map(mapDocumentSummary);
  const documentCoverage = buildDocumentCoverageFacts(documents, documentSummaries, attachmentTexts);
  const combinedText = buildCombinedInputText(input, attachmentTexts);
  const secFormType = resolveFormType({
    documents,
    metadata,
    rawPayload,
    title: input.title,
    text: combinedText,
  });
  const formProfile = buildFormProfile({
    documentCoverage,
    documents,
    secFormType,
    text: combinedText,
  });
  const documentRoutingOutlines = buildDocumentRoutingOutlines({
    formType: secFormType,
    primaryText: stringValue(input.analysisText) || stringValue(input.bodyText) || combinedText,
  });
  const items = formProfile.is8kLike ? extract8kItems(combinedText) : [];
  const unnumberedSections = formProfile.is8kLike ? extract8kUnnumberedSections(combinedText) : [];
  const exhibitFacts = buildExhibitFacts({
    attachmentTexts,
    documentSummaries,
    documents,
    items,
    secFormType,
    text: combinedText,
  });
  const tableFacts = buildTableFacts(combinedText, documents);
  const amendment = buildAmendmentInfo(secFormType, combinedText);
  const referencedFilings = extractReferencedFilings(combinedText, items);
  const filingCues = buildFilingCues({
    amendment,
    items,
    text: combinedText,
  });
  const moneyAmounts = findMoneyAmounts(combinedText);
  const shareCounts = findShareCounts(combinedText);
  const dates = findDateFields(combinedText);
  const marketContext = buildMarketContextFacts(filingCues, moneyAmounts, shareCounts, combinedText);
  const calendarItems = buildCalendarItems(combinedText);
  const warnings = buildWarnings({
    amendment,
    combinedText,
    documentCoverage,
    documents: documentSummaries,
    exhibitFacts,
    formProfile,
    isSupported: isSec8k6kForm(secFormType),
    items,
    rawPayload,
    secFormType,
    tableFacts,
  });

  return {
    parserVersion: SEC_8K_6K_PARSER_VERSION,
    parserGroup: SEC_8K_6K_PARSER_GROUP,
    formType: SEC_8K_6K_FORM_SCOPE,
    accessionNumber: nullableString(rawPayload.accession_number) || nullableString(input.sourceUniqueId),
    isSupported: isSec8k6kForm(secFormType),
    summary: buildSummary({
      amendment,
      companyName:
        nullableString(rawPayload.company_name) ||
        nullableString(metadata.company_name) ||
        nullableString(metadata.issuer) ||
        readCompanyName(combinedText),
      cueCount: filingCues.length,
      formType: secFormType,
      itemCount: items.length,
      ticker: nullableString(rawPayload.ticker) || nullableString(metadata.ticker),
    }),
    facts: {
      rawItemId: nullableString(input.rawItemId),
      sourceUrl: nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url),
      filedAt: nullableString(input.publishedAt),
      companyName:
        nullableString(rawPayload.company_name) ||
        nullableString(metadata.company_name) ||
        nullableString(metadata.issuer) ||
        readCompanyName(combinedText),
      ticker: nullableString(rawPayload.ticker) || nullableString(metadata.ticker),
      secFormType,
      isForeignIssuerReport: secFormType === "6-K" || secFormType === "6-K/A",
      isAmendment: amendment.isAmendment,
      amendment,
      items,
      referencedFilings,
      unnumberedSections,
      filingCues,
      sourceCues: filingCues,
      moneyAmounts,
      shareCounts,
      dates,
      marketContext,
      extracted: buildExtractedFacts({
        amendment,
        dates,
        documentCoverage,
        documents: documentSummaries,
        exhibitFacts,
        formProfile,
        items,
        moneyAmounts,
        rawPayload,
        shareCounts,
        tableFacts,
        text: combinedText,
      }),
      documents: documentSummaries,
      documentRoutingOutlines,
      textStats: {
        bodyChars: stringValue(input.bodyText).length,
        analysisChars: stringValue(input.analysisText).length,
        combinedChars: combinedText.length,
      },
    },
    signals: filingCues.map(toParserSignal),
    calendarItems,
    warnings,
    raw: {
      title: nullableString(input.title),
      rawPayload: redactLargeRawPayload(rawPayload),
      metadata,
    },
  };
}

function buildDocumentRoutingOutlines({
  formType,
  primaryText,
}: {
  formType: Sec8k6kFormType | null;
  primaryText: string;
}): Sec8k6kDocumentRoutingOutline[] {
  if (!primaryText) return [];
  const outline = extractSecDocumentRoutingOutline(primaryText);
  if (!outline.title && !outline.subtitle && !outline.lead_context.length && !outline.section_headings.length) {
    return [];
  }
  return [{
    source_ref: "primary_filing",
    document_type: formType,
    title: outline.title,
    subtitle: outline.subtitle,
    lead_context: outline.lead_context,
    section_headings: outline.section_headings,
  }];
}

function buildFilingCues({
  amendment,
  items,
  text,
}: {
  amendment: Sec8k6kAmendmentInfo;
  items: Sec8k6kItem[];
  text: string;
}): Sec8k6kFilingCue[] {
  if (amendment.isRoutineAdministrativeOnly) {
    return [
      {
        cueType: "routine_administrative_amendment",
        label: "Routine or administrative amendment language",
        evidence: amendment.administrativeSignals[0]?.evidence || amendment.excerpt || "Routine amendment language found.",
        confidence: "high",
        itemNumbers: items.map((item) => item.item),
      },
    ];
  }

  const itemNumbers = items.map((item) => item.item);
  const cues: Sec8k6kFilingCue[] = [];

  if (amendment.hasMaterialChangeLanguage) {
    cues.push({
      cueType: "material_amendment_language",
      label: "Amendment language indicates changed or added material terms",
      evidence: amendment.materialChangeSignals[0]?.evidence || amendment.excerpt || "Material amendment language found.",
      confidence: "medium",
      itemNumbers,
    });
  }

  for (const pattern of FILING_CUE_PATTERNS) {
    const itemEvidence = items.find((item) => pattern.itemNumbers?.includes(item.item));
    const keywordEvidence = findFirstEvidence(text, pattern.patterns);
    if (!itemEvidence && !keywordEvidence) continue;
    cues.push({
      cueType: pattern.cueType,
      label: pattern.label,
      evidence: keywordEvidence || itemEvidence?.evidence || pattern.label,
      confidence: pattern.confidence,
      itemNumbers: pattern.itemNumbers?.filter((itemNumber) => itemNumbers.includes(itemNumber)) || [],
    });
  }

  if (cues.length === 0) cues.push(buildUncategorizedCue(text));
  return dedupeCues(cues);
}

function buildUncategorizedCue(text: string): Sec8k6kFilingCue {
  return {
    cueType: "uncategorized_text",
    label: "Supported 8-K/6-K text without a stronger parser cue",
    evidence: truncate(pickEvidenceSentence(text, 0) || text || "No filing text was available.", 420),
    confidence: text ? "medium" : "low",
    itemNumbers: [],
  };
}

function dedupeCues(cues: Sec8k6kFilingCue[]) {
  const seen = new Set<Sec8k6kFilingCueType>();
  const deduped: Sec8k6kFilingCue[] = [];
  for (const cue of cues) {
    if (seen.has(cue.cueType)) continue;
    seen.add(cue.cueType);
    deduped.push(cue);
  }
  return deduped;
}

function buildCombinedInputText(input: Sec8k6kParseInput, attachmentTexts: AttachmentTextPayload[]) {
  const sections = [
    stringValue(input.title),
    stringValue(input.bodyText),
    stringValue(input.analysisText),
    compactText(attachmentTexts.map((item) => stringValue(item.text)).join("\n\n")),
  ];
  const accepted: string[] = [];
  for (const section of sections) {
    const text = compactText(section);
    if (!text || isRedundantSourceText(text, accepted)) continue;
    accepted.push(text);
  }
  return compactText(accepted.join("\n\n"));
}

function isRedundantSourceText(text: string, accepted: string[]) {
  const normalized = normalizeForTextDedup(text);
  if (!normalized) return true;
  return accepted.some((section) => {
    const existing = normalizeForTextDedup(section);
    if (existing === normalized) return true;
    if (normalized.length >= 180 && existing.includes(normalized)) return true;
    return existing.length >= 180 && normalized.includes(existing);
  });
}

function normalizeForTextDedup(text: string) {
  return compactText(text).replace(/\s+/g, " ").toLowerCase();
}

function buildFormProfile({
  documentCoverage,
  documents,
  secFormType,
  text,
}: {
  documentCoverage: ReturnType<typeof buildDocumentCoverageFacts>;
  documents: DocumentPayload[];
  secFormType: Sec8k6kFormType | null;
  text: string;
}): FormProfileFacts {
  const is8kLike = secFormType === "8-K" || secFormType === "8-K/A";
  const is6kLike = secFormType === "6-K" || secFormType === "6-K/A";
  const primaryDocument = documents.find((document) => Boolean(document.isPrimary)) || null;
  const primaryTextCharCount = primaryDocument
    ? numberValue(primaryDocument.textCharCount) || numberValue(primaryDocument.includedTextCharCount)
    : 0;
  const wrapperEvidence = is6kLike ? findFirstEvidence(text.slice(0, 4_000), SIX_K_WRAPPER_PATTERNS) : null;
  const meaningfulExhibits = documentCoverage.importantAttachments.filter((document) =>
    isMeaningfulExhibitLikeDocument({
      description: document.description,
      filename: document.filename,
      noiseClass: document.noiseClass,
      role: document.role,
      type: document.type,
    }),
  );
  const meaningfulTextExhibitCount = meaningfulExhibits.filter((document) => document.textExtractionStatus === "text_extracted" && document.includedTextCharCount > 0).length;
  const meaningfulNonTextExhibitCount = meaningfulExhibits.filter((document) => document.textExtractionStatus !== "text_extracted" || document.includedTextCharCount === 0).length;
  const primaryIsShort = primaryTextCharCount > 0
    ? primaryTextCharCount < 3_500
    : compactText(text).length < 3_500;
  const primaryHasMeaningfulContent = is6kLike && meaningfulExhibits.length === 0 && hasMeaningfulSixKPrimaryContent(text);

  return {
    parserPath: is8kLike ? "8k_item_sections" : is6kLike ? "6k_wrapper_exhibits" : "unknown",
    is8kLike,
    is6kLike,
    primaryTextCharCount,
    primaryIsShort,
    primaryHasMeaningfulContent,
    primaryIsWrapper: is6kLike && Boolean(wrapperEvidence) && primaryIsShort && !primaryHasMeaningfulContent,
    wrapperEvidence,
    meaningfulExhibitCount: meaningfulExhibits.length,
    meaningfulTextExhibitCount,
    meaningfulNonTextExhibitCount,
  };
}

function hasMeaningfulSixKPrimaryContent(text: string) {
  const compact = compactText(text);
  if (!compact) return false;
  const hasActionVerb = /\b(?:announced|reported|entered into|completed|declared|appointed|resigned|received|launched|expects|updates)\b/i.test(compact);
  const hasFilingOnlyWrapper = /\b(?:attached hereto|furnished herewith|incorporated by reference|as Exhibit\s+99(?:\.\d+)?)\b/i.test(compact);
  const hasFinancialMetric = /\b(?:financial results|revenue|net income|net loss|operating income|EBITDA|EPS|cash|debt)\b[\s\S]{0,120}?\$?\d/i.test(compact);
  const hasBusinessContent = /\b(?:business update|corporate update|operations update|press release|product launch|dividend|shareholder meeting|listing notice)\b/i.test(compact) && hasActionVerb;
  return (hasFinancialMetric || hasBusinessContent || hasActionVerb) && !hasFilingOnlyWrapper;
}

function buildExtractedFacts({
  amendment,
  dates,
  documentCoverage,
  documents,
  exhibitFacts,
  formProfile,
  items,
  moneyAmounts,
  rawPayload,
  shareCounts,
  tableFacts,
  text,
}: {
  amendment: Sec8k6kAmendmentInfo;
  dates: Sec8k6kField[];
  documentCoverage: ReturnType<typeof buildDocumentCoverageFacts>;
  documents: Sec8k6kDocumentSummary[];
  exhibitFacts: ReturnType<typeof buildExhibitFacts>;
  formProfile: FormProfileFacts;
  items: Sec8k6kItem[];
  moneyAmounts: Sec8k6kMoneyField[];
  rawPayload: Record<string, unknown>;
  shareCounts: Sec8k6kNumberField[];
  tableFacts: ReturnType<typeof buildTableFacts>;
  text: string;
}) {
  return {
    sourcePackage: buildSourcePackageFacts(rawPayload, documents),
    amendmentContext: buildAmendmentContextFacts(amendment),
    formProfile,
    documentCoverage,
    exhibitFacts,
    noiseCandidates: buildNoiseCandidateFacts(text, documentCoverage, tableFacts),
    tableFacts,
    coverPage: buildCoverPageFacts(text),
    secItems: items.map((item) => ({
      item: item.item,
      label: item.label,
      evidence: item.evidence,
    })),
    offering: {
      offeringAmount: firstMoneyNear(text, /\b(?:gross proceeds|offering|private placement|registered direct|ATM|at-the-market)\b/i),
      shareCount: shareCounts[0] || null,
      price: findPriceField(text),
      warrants: findField(text, /\bwarrants?\b/i),
      useOfProceeds: findField(text, /\b(?:working capital|general corporate purposes|repay debt|use of proceeds)\b/i),
    },
    earnings: {
      period: findField(text, /\b(?:quarter|fiscal year|year ended|three months ended|six months ended)\b/i),
      revenue: firstMoneyNear(text, /\b(?:revenue|net sales)\b/i),
      netIncome: firstMoneyNear(text, /\b(?:net income|net loss)\b/i),
      eps: findField(text, /\b(?:earnings per share|EPS|loss per share)\b/i),
    },
    governance: findField(text, /\b(?:resigned|appointed|elected|board|director|chief executive officer|chief financial officer)\b/i),
    legal: findField(text, /\b(?:lawsuit|litigation|settlement|investigation|subpoena|enforcement action)\b/i),
    fdaClinical: findField(text, /\b(?:FDA|PDUFA|clinical trial|Phase\s+[123]|NDA|BLA|endpoint|complete response letter)\b/i),
    dividend: findField(text, /\bdividend\b/i),
    capitalReturn: findField(text, /\b(?:repurchase|buyback)\b/i),
    listingNotice: findField(text, /\b(?:deficiency|delisting|continued listing|minimum bid|listing standard)\b/i),
    strategicTransaction: findField(text, /\b(?:merger|acquisition|asset sale|joint venture|business combination)\b/i),
    productUpdate: findField(text, /\b(?:launch|product|platform|deployment|clearance|certification)\b/i),
    salesPerformance: findField(text, /\b(?:net sales|bookings|deliveries|production|same-store sales|comparable sales)\b/i),
    financialDistress: findField(text, /\b(?:default|going concern|liquidity|bankruptcy|impairment|restructuring)\b/i),
    moneyAmounts,
    shareCounts,
    dates,
  };
}

function buildExhibitFacts({
  attachmentTexts,
  documentSummaries,
  documents,
  items,
  secFormType,
  text,
}: {
  attachmentTexts: AttachmentTextPayload[];
  documentSummaries: Sec8k6kDocumentSummary[];
  documents: DocumentPayload[];
  items: Sec8k6kItem[];
  secFormType: Sec8k6kFormType | null;
  text: string;
}) {
  const documentExhibits = documents
    .map((document, index) => {
      const summary = documentSummaries[index] || null;
      const noiseClass = documentNoiseClass(document, summary);
      const role = documentRole(document, summary, noiseClass);
      const attachmentText = findAttachmentTextForDocument(document, attachmentTexts);
      const attachmentSample = truncate(stringValue(attachmentText?.text), 1_500);
      const exhibitNumber = normalizeExhibitNumberFromDocument(document);
      const headline = extractRoutingHeadline(
        attachmentSample,
        nullableString(document.description),
        nullableString(document.filename) || nullableString(document.document),
      );
      const routingSummary = extractRoutingSummary(attachmentSample, headline);
      const roleCandidates = inferSixKExhibitRoleCandidates({
        description: nullableString(document.description),
        filename: nullableString(document.filename) || nullableString(document.document),
        text: attachmentSample,
        type: nullableString(document.type),
      });
      return {
        exhibitNumber,
        type: nullableString(document.type),
        description: nullableString(document.description),
        filename: nullableString(document.filename) || nullableString(document.document),
        headline,
        routingSummary,
        role,
        noiseClass,
        textAvailable: Boolean(stringValue(attachmentText?.text)) || numberValue(document.includedTextCharCount) > 0 || numberValue(document.textCharCount) > 0,
        textCharCount: numberValue(document.textCharCount) || stringValue(attachmentText?.text).length,
        isPrimary: Boolean(document.isPrimary),
        roleCandidates,
      };
    })
    .filter((document) => document.exhibitNumber || /^EX-/i.test(document.type || "") || document.role.includes("exhibit"));

  const references = extractExhibitReferences(text, items);
  const referencedExhibits = references.map((reference) => {
    const matchedDocument = findDocumentExhibitByNumber(documentExhibits, reference.exhibitNumber);
    return {
      ...reference,
      matchedDocument: matchedDocument
        ? {
            exhibitNumber: matchedDocument.exhibitNumber,
            type: matchedDocument.type,
            description: matchedDocument.description,
            filename: matchedDocument.filename,
            role: matchedDocument.role,
            noiseClass: matchedDocument.noiseClass,
            textAvailable: matchedDocument.textAvailable,
          }
        : null,
      confidence: matchedDocument ? "high" as const : "low" as const,
    };
  });

  const itemExhibitHints = build8kItemExhibitHints(items, documentExhibits, referencedExhibits);
  const is6kLike = secFormType === "6-K" || secFormType === "6-K/A";
  const sixKExhibits = is6kLike
    ? documentExhibits
        .filter((document) => !document.isPrimary && isMeaningfulExhibitLikeDocument(document))
        .map((document) => ({
          exhibitNumber: document.exhibitNumber,
          type: document.type,
          description: document.description,
          filename: document.filename,
          headline: document.headline,
          routingSummary: document.routingSummary,
          roleCandidates: document.roleCandidates.length ? document.roleCandidates : ["other_material_information"],
          textAvailable: document.textAvailable,
          noiseClass: document.noiseClass,
          confidence: document.roleCandidates.length ? "medium" as const : "low" as const,
        }))
    : [];

  return {
    documentExhibits,
    referencedExhibits,
    unmatchedReferences: referencedExhibits.filter((reference) => !reference.matchedDocument),
    itemExhibitHints,
    sixK: {
      wrapperOrExhibitFirst: is6kLike,
      exhibitCount: sixKExhibits.length,
      exhibits: sixKExhibits,
    },
  };
}

function extractExhibitReferences(text: string, items: Sec8k6kItem[]) {
  const references: Array<{
    exhibitNumber: string;
    source: "item_9_01" | "exhibit_index" | "primary_text_reference";
    item: string | null;
    evidence: string;
  }> = [];
  const addReference = (
    exhibitNumber: string | null,
    source: "item_9_01" | "exhibit_index" | "primary_text_reference",
    evidence: string,
    item: string | null = null,
  ) => {
    if (!exhibitNumber || !SUPPORTED_EXHIBIT_REFERENCE_PATTERN.test(exhibitNumber)) return;
    const normalized = normalizeExhibitNumber(exhibitNumber);
    if (!normalized) return;
    if (isSupportExhibitReference(normalized)) return;
    if (references.some((reference) => reference.exhibitNumber === normalized && reference.source === source && reference.evidence === truncate(evidence, 420))) return;
    references.push({ exhibitNumber: normalized, source, item, evidence: truncate(evidence, 420) });
  };

  const item901 = items.find((item) => item.item === "9.01");
  if (item901) {
    for (const line of item901.evidence.split("\n")) {
      if (/^\s*(?:Item\s*)?9\.01\b/i.test(normalizeParserWhitespace(line))) continue;
      const exhibitNumber = readExhibitNumberFromIndexLine(line);
      if (exhibitNumber) addReference(exhibitNumber, "item_9_01", line, "9.01");
    }
  }

  let inExhibitIndex = false;
  for (const line of text.split("\n")) {
    if (/^\s*EXHIBIT\s+INDEX\b/i.test(line)) {
      inExhibitIndex = true;
      continue;
    }
    if (/^\s*SIGNATURES?\s*$/i.test(line)) inExhibitIndex = false;
    if (inExhibitIndex) {
      const exhibitNumber = readExhibitNumberFromIndexLine(line);
      if (exhibitNumber) addReference(exhibitNumber, "exhibit_index", line, null);
    }
  }

  for (const pattern of [
    /\b(?:attached|furnished|filed)\s+(?:as|herewith\s+as|hereto\s+as)?\s*Exhibit\s+([0-9]{1,3}(?:\.[0-9A-Z]+)?)/gi,
    /\bincorporated\s+by\s+reference[\s\S]{0,80}?\bExhibit\s+([0-9]{1,3}(?:\.[0-9A-Z]+)?)/gi,
    /\bExhibit\s+([0-9]{1,3}(?:\.[0-9A-Z]+)?)\b/gi,
  ]) {
    for (const match of text.matchAll(pattern)) {
      addReference(match[1] || null, "primary_text_reference", pickEvidenceSentence(text, match.index || 0), null);
    }
  }

  return references.slice(0, 40);
}

const SUPPORTED_EXHIBIT_REFERENCE_PATTERN = /^(?:[0-9]{1,3})(?:\.[0-9A-Z]+)?$/i;

function isSupportExhibitReference(exhibitNumber: string) {
  return /^(?:101|104)(?:\.|$)/i.test(exhibitNumber);
}

function build8kItemExhibitHints(
  items: Sec8k6kItem[],
  documentExhibits: Array<{
    description: string | null;
    exhibitNumber: string | null;
    filename: string | null;
    roleCandidates?: string[];
    type: string | null;
  }>,
  referencedExhibits: Array<{
    exhibitNumber: string;
    item: string | null;
    source: string;
  }>,
) {
  const hints: Array<{
    item: string;
    exhibitNumber: string | null;
    documentType: string | null;
    roleHint: string;
    evidence: string;
    confidence: Sec8k6kConfidence;
  }> = [];

  for (const item of items) {
    for (const document of documentExhibits) {
      const roleHint = infer8kItemExhibitRoleHint(item.item, document);
      if (!roleHint) continue;
      const directlyReferenced = referencedExhibits.some(
        (reference) => reference.exhibitNumber === document.exhibitNumber && (reference.item === item.item || reference.source !== "primary_text_reference"),
      );
      hints.push({
        item: item.item,
        exhibitNumber: document.exhibitNumber,
        documentType: document.type,
        roleHint,
        evidence: item.evidence,
        confidence: directlyReferenced ? "high" : "medium",
      });
    }
  }

  return hints.slice(0, 20);
}

function infer8kItemExhibitRoleHint(
  itemNumber: string,
  document: {
    description: string | null;
    exhibitNumber: string | null;
    filename: string | null;
    roleCandidates?: string[];
    type: string | null;
  },
) {
  const haystack = `${document.type || ""} ${document.description || ""} ${document.filename || ""}`.toLowerCase();
  const roleCandidates = document.roleCandidates || [];
  const exhibitNumber = document.exhibitNumber || "";
  if (
    itemNumber === "2.02" &&
    /^99(?:\.|$)/.test(exhibitNumber) &&
    (/\b(?:earnings|results|financial results|press release)\b/i.test(haystack) || roleCandidates.includes("financial_results"))
  ) return "earnings_release_or_financial_results_exhibit";
  if (itemNumber === "7.01" && /^99(?:\.|$)/.test(exhibitNumber) && /\b(?:investor presentation|presentation|regulation fd|press release)\b/i.test(haystack)) return "regulation_fd_or_presentation_exhibit";
  if (itemNumber === "1.01" && /^10(?:\.|$)/.test(exhibitNumber) && /\b(?:agreement|credit agreement|loan agreement|material definitive agreement)\b/i.test(haystack)) return "agreement_exhibit";
  if (itemNumber === "2.01" && /^2(?:\.|$)/.test(exhibitNumber) && /\b(?:merger|acquisition|disposition|purchase agreement)\b/i.test(haystack)) return "transaction_agreement_exhibit";
  if (itemNumber === "4.01" && /^16(?:\.|$)/.test(exhibitNumber) && /\b(?:accountant|letter)\b/i.test(haystack)) return "accountant_letter_exhibit";
  if (itemNumber === "5.02" && /\b(?:employment agreement|resignation|appointment|compensation|separation agreement)\b/i.test(haystack)) return "management_change_related_exhibit";
  if (itemNumber === "8.01" && /\b(?:press release|business update|financing update|corporate update)\b/i.test(haystack)) return "other_event_press_release_or_update_exhibit";
  if (itemNumber === "9.01" && /\b(?:exhibit|financial statements?|pro forma)\b/i.test(haystack)) return "exhibit_list_or_financial_statement_exhibit";
  return null;
}

function inferSixKExhibitRoleCandidates({
  description,
  filename,
  text,
  type,
}: {
  description: string | null;
  filename: string | null;
  text: string;
  type: string | null;
}) {
  const haystack = `${type || ""} ${description || ""} ${filename || ""} ${text}`.toLowerCase();
  const candidates: string[] = [];
  const add = (role: string, pattern: RegExp) => {
    if (pattern.test(haystack)) candidates.push(role);
  };
  add("financial_results", /\b(?:financial results|earnings|results of operations|revenue|net income|ebitda|eps)\b/i);
  add("interim_report", /\b(?:interim report|quarterly report|half-year|six months ended)\b/i);
  add("annual_report", /\b(?:annual report|annual financial statements|20-f)\b/i);
  add("press_release", /\bpress release\b/i);
  add("securities_offering", /\b(?:offering|private placement|registered direct|at-the-market|warrant|ordinary shares|american depositary shares)\b/i);
  add("debt_financing", /\b(?:credit agreement|loan agreement|notes?|debentures?|debt financing|facility)\b/i);
  add("acquisition_or_disposition", /\b(?:acquisition|disposition|merger|purchase agreement|sale agreement|divestiture)\b/i);
  add("management_change", /\b(?:chief executive officer|chief financial officer|resignation|appointed|appointment|employment agreement)\b/i);
  add("board_change", /\b(?:board of directors|director|chairman|committee)\b/i);
  add("shareholder_meeting_result", /\b(?:shareholder meeting|annual general meeting|extraordinary general meeting|votes for|votes against)\b/i);
  add("dividend", /\b(?:dividend|record date|payment date)\b/i);
  add("listing_notice", /\b(?:nasdaq|nyse|stock exchange|listing|delisting|minimum bid|deficiency)\b/i);
  add("litigation_or_regulatory_update", /\b(?:litigation|lawsuit|settlement|investigation|regulatory|enforcement)\b/i);
  add("cybersecurity", /\bcybersecurity\b/i);
  add("business_update", /\b(?:business update|corporate update|operations update|commercial update|product launch)\b/i);
  add("investor_presentation", /\b(?:investor presentation|presentation|slides?)\b/i);
  return uniqueStrings(candidates).slice(0, 6);
}

function findDocumentExhibitByNumber<T extends { exhibitNumber: string | null }>(documents: T[], exhibitNumber: string) {
  const exact = documents.find((document) => document.exhibitNumber === exhibitNumber);
  if (exact) return exact;
  if (/^\d+$/.test(exhibitNumber)) {
    const prefixMatches = documents.filter((document) => document.exhibitNumber?.startsWith(`${exhibitNumber}.`));
    if (prefixMatches.length === 1) return prefixMatches[0] || null;
  }
  return null;
}

function findAttachmentTextForDocument(document: DocumentPayload, attachmentTexts: AttachmentTextPayload[]) {
  const documentExhibitNumber = normalizeExhibitNumberFromDocument(document);
  return attachmentTexts.find((attachment) => {
    const attachmentExhibitNumber = normalizeExhibitNumberFromDocument(attachment);
    if (documentExhibitNumber && attachmentExhibitNumber && documentExhibitNumber === attachmentExhibitNumber) return true;
    const documentLabel = normalizeForTextDedup(`${document.type || ""} ${document.description || ""} ${document.filename || ""} ${document.url || ""}`);
    const attachmentLabel = normalizeForTextDedup(`${attachment.type || ""} ${attachment.description || ""} ${attachment.filename || ""} ${attachment.url || ""}`);
    return Boolean(documentLabel && attachmentLabel && (documentLabel.includes(attachmentLabel) || attachmentLabel.includes(documentLabel)));
  }) || null;
}

function normalizeExhibitNumberFromDocument(document: {
  type?: unknown;
  description?: unknown;
  document?: unknown;
  filename?: unknown;
  url?: unknown;
}) {
  for (const value of [document.type, document.description, document.document, document.filename, document.url]) {
    const text = stringValue(value);
    const normalized = normalizeExhibitNumberFromText(text);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeExhibitNumberFromText(text: string) {
  const compactFilename = text.match(/(?:^|[\\/_\-.])ex(?:hibit)?[-_]?([0-9]{2})([0-9][A-Z]?)(?=\D|$)/i);
  if (compactFilename) return normalizeExhibitNumber(`${compactFilename[1]}.${compactFilename[2]}`);
  const separatedFilename = text.match(/(?:^|[\\/_\-.])ex(?:hibit)?[-_]?([0-9]{1,3})[._-]([0-9A-Z]+)(?=\D|$)/i);
  if (separatedFilename) return normalizeExhibitNumber(`${separatedFilename[1]}.${separatedFilename[2]}`);
  const explicit = text.match(/\b(?:EXHIBIT\s*|EX[-\s]*)([0-9]{1,3}(?:\.[0-9A-Z]+)?)/i)?.[1];
  if (explicit) return normalizeExhibitNumber(explicit);
  const filename = text.match(/(?:^|[\\/_\-.])ex[-_]?([0-9]{1,3})(?:[-_]?([0-9]{1,2}[A-Z]?))?(?=\D|$)/i);
  if (!filename) return null;
  if (filename[2]) return normalizeExhibitNumber(`${filename[1]}.${filename[2]}`);
  return normalizeExhibitNumber(filename[1]);
}

function readExhibitNumberFromIndexLine(line: string) {
  if (/^\s*\|?\s*Item\s+\d\.\d{2}\b/i.test(normalizeParserWhitespace(line))) return null;
  return normalizeExhibitNumber(
    line.match(/^\s*(?:EXHIBIT\s+|EX[-\s]?)?([0-9]{1,3}(?:\.[0-9A-Z]+)?)\b/i)?.[1],
  );
}

function normalizeExhibitNumber(value: string | null | undefined) {
  const text = stringValue(value).toUpperCase().replace(/[^0-9.A-Z]/g, "");
  if (!SUPPORTED_EXHIBIT_REFERENCE_PATTERN.test(text)) return null;
  return text.replace(/^0+(\d)/, "$1");
}

function buildAmendmentInfo(formType: Sec8k6kFormType | null, text: string): Sec8k6kAmendmentInfo {
  const isAmendment = formType === "8-K/A" || formType === "6-K/A";
  const excerpt = isAmendment ? extractAmendmentExcerpt(text) : null;
  const scopeText = excerpt || text;
  const administrativeSignals = isAmendment ? findSignals(scopeText, [
    /\bsolely\s+to\s+(?:furnish|file|correct|amend)\b/i,
    /\bno\s+other\s+changes\b/i,
    /\b(?:typographical|clerical|administrative)\s+(?:error|correction|change)\b/i,
    /\b(?:signature|exhibit|consent)-?only\b/i,
    /\bdoes\s+not\s+amend\s+or\s+update\s+any\s+other\s+disclosure\b/i,
  ]) : [];
  const materialChangeSignals = isAmendment ? findSignals(scopeText, [
    /\b(?:amends and restates|materially amends|updates|revises)\b/i,
    /\b(?:increased|decreased|changed|new|additional)\s+(?:consideration|shares|proceeds|terms|agreement|risk|default)\b/i,
    /\b(?:material change|new material information)\b/i,
  ]) : [];
  const isRoutineAdministrativeOnly = isAmendment && administrativeSignals.length > 0 && materialChangeSignals.length === 0;
  const hasMaterialChangeLanguage = isAmendment && materialChangeSignals.length > 0;

  return {
    isAmendment,
    amendmentNumber: numberFromMatch(scopeText.match(/\bAmendment\s+No\.?\s*(\d+)/i)?.[1]),
    parentAccessionNumber: extractAmendmentParentAccession(scopeText),
    parentFiledDate: extractAmendmentParentFiledDate(scopeText),
    administrativeSignals,
    materialChangeSignals,
    isRoutineAdministrativeOnly,
    hasMaterialChangeLanguage,
    needsParentContext: isAmendment && !isRoutineAdministrativeOnly,
    excerpt,
  };
}

function extractAmendmentParentAccession(value: string) {
  const explicit = value.match(
    /\baccession\s+(?:number|no\.?)\s*[:#]?\s*(\d{10}-\d{2}-\d{6})\b/i,
  )?.[1];
  if (explicit) return explicit;

  const archiveDigits = value.match(/\/Archives\/edgar\/data\/\d+\/(\d{18})(?:\/|\b)/i)?.[1];
  if (!archiveDigits) return null;
  return `${archiveDigits.slice(0, 10)}-${archiveDigits.slice(10, 12)}-${archiveDigits.slice(12)}`;
}

function extractAmendmentParentFiledDate(value: string) {
  const datePattern = "(?:[A-Z][a-z]+\\s+\\d{1,2},\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})";
  const reportContextPatterns = [
    new RegExp(
      `\\b(?:Current\\s+Report|Report\\s+of\\s+Foreign\\s+Private\\s+Issuer)[\\s\\S]{0,180}?\\bon\\s+Form\\s+(?:8-K|6-K)(?:\\/A)?[\\s\\S]{0,220}?\\b(?:filed|furnished)(?:\\s+with\\s+the\\s+(?:SEC|Securities\\s+and\\s+Exchange\\s+Commission))?\\s+(?:on\\s+)?(${datePattern})`,
      "i",
    ),
    new RegExp(
      `\\bForm\\s+(?:8-K|6-K)(?:\\/A)?[\\s\\S]{0,220}?\\b(?:filed|furnished)(?:\\s+with\\s+the\\s+(?:SEC|Securities\\s+and\\s+Exchange\\s+Commission))?\\s+(?:on\\s+)?(${datePattern})`,
      "i",
    ),
  ];
  for (const pattern of reportContextPatterns) {
    const match = value.match(pattern)?.[1];
    if (match) return match;
  }
  return null;
}

function buildMarketContextFacts(
  filingCues: Sec8k6kFilingCue[],
  moneyAmounts: Sec8k6kMoneyField[],
  shareCounts: Sec8k6kNumberField[],
  text: string,
): Sec8k6kMarketContextFacts {
  const cues: Sec8k6kMarketContextFacts["cues"] = [];
  const cueEvidence = (cueType: Sec8k6kFilingCueType) => filingCues.find((cue) => cue.cueType === cueType)?.evidence || "";

  if (hasCue(filingCues, "securities_offering_or_issuance")) {
    cues.push({
      fields: ["price", "market_cap", "shares_outstanding", "public_float"],
      reason: "Filing text includes offering or share-issuance terms with amounts or share counts.",
      evidence: cueEvidence("securities_offering_or_issuance"),
      confidence: "high" as const,
    });
  }
  if (hasCue(filingCues, "capital_return_authorization") && moneyAmounts.length > 0) {
    cues.push({
      fields: ["price", "market_cap", "shares_outstanding"],
      reason: "Filing text includes a repurchase authorization amount.",
      evidence: cueEvidence("capital_return_authorization"),
      confidence: "medium" as const,
    });
  }
  if (hasCue(filingCues, "exchange_listing_notice") && /\bminimum bid\b/i.test(text)) {
    cues.push({
      fields: ["price", "previous_close"],
      reason: "Filing text includes minimum-bid language.",
      evidence: cueEvidence("exchange_listing_notice"),
      confidence: "high" as const,
    });
  }
  if (hasCue(filingCues, "sales_or_operating_update") && moneyAmounts.length > 0) {
    cues.push({
      fields: ["market_cap", "volume", "avg_volume"],
      reason: "Filing text includes sales or operating performance amounts.",
      evidence: cueEvidence("sales_or_operating_update"),
      confidence: "medium" as const,
    });
  }
  if (shareCounts.length > 0 && /\bfloat\b/i.test(text)) {
    cues.push({
      fields: ["public_float", "shares_outstanding"],
      reason: "Filing text includes share-count and float language.",
      evidence: shareCounts[0]?.evidence || pickEvidenceSentence(text, 0),
      confidence: "medium" as const,
    });
  }

  return {
    fields: uniqueStrings(cues.flatMap((cue) => cue.fields)),
    cues,
  };
}

function buildCalendarItems(text: string): Sec8k6kCalendarItem[] {
  const items: Sec8k6kCalendarItem[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["record_date", /\brecord date\s+(?:of|is|will be)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i],
    ["payment_date", /\bpayment date\s+(?:of|is|will be)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i],
    ["closing_date", /\bclosing\s+(?:is expected to occur on|occurred on|date of)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i],
    ["meeting_date", /\b(?:annual|special)\s+meeting\s+(?:will be held on|held on)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i],
    ["pdufa_date", /\bPDUFA\s+(?:target action date|date)\s+(?:of|is)?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i],
  ];
  for (const [label, pattern] of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    items.push({
      label,
      dateText: match[1],
      evidence: pickEvidenceSentence(text, match.index || 0),
    });
  }
  return items;
}

function buildWarnings({
  amendment,
  combinedText,
  documentCoverage,
  documents,
  exhibitFacts,
  formProfile,
  isSupported,
  items,
  rawPayload,
  secFormType,
  tableFacts,
}: {
  amendment: Sec8k6kAmendmentInfo;
  combinedText: string;
  documentCoverage: ReturnType<typeof buildDocumentCoverageFacts>;
  documents: Sec8k6kDocumentSummary[];
  exhibitFacts: ReturnType<typeof buildExhibitFacts>;
  formProfile: FormProfileFacts;
  isSupported: boolean;
  items: Sec8k6kItem[];
  rawPayload: Record<string, unknown>;
  secFormType: Sec8k6kFormType | null;
  tableFacts: ReturnType<typeof buildTableFacts>;
}) {
  const warnings: string[] = [];
  if (!isSupported) warnings.push("unsupported_form_type");
  if (!combinedText) warnings.push("no_filing_text_available");
  if (formProfile.is8kLike && items.length === 0) warnings.push("no_8k_item_headings_detected");
  if (formProfile.is8kLike && items.some((item) => item.item !== "9.01" && itemSectionBodyLength(item) < 40)) {
    warnings.push("item_section_body_too_short");
  }
  if (amendment.needsParentContext) warnings.push("amendment_parent_context_needed");
  if (documents.some((document) => document.fetch_error && !isGraphicOrBinaryDocument(document))) {
    warnings.push("document_fetch_error_present");
  }
  if (documents.some((document) => document.text_truncated)) warnings.push("document_text_truncated");
  if (documentCoverage.importantAttachments.some((document) => document.textExtractionStatus !== "text_extracted")) {
    warnings.push("important_attachment_text_not_extracted");
  }
  if (documentCoverage.importantAttachments.some((document) => document.textExtractionStatus === "text_extracted" && document.includedTextCharCount === 0)) {
    warnings.push("important_attachment_text_empty");
  }
  if (documentCoverage.parserTextCoverage.omittedDueToLimitCount > 0) warnings.push("important_attachment_omitted_due_to_limit");
  if (documentCoverage.imageHeavyPackage.isImageHeavy) warnings.push("image_heavy_package_text_may_be_incomplete");
  if (documentCoverage.nonTextPotentiallyMaterialDocuments.length > 0) warnings.push("potentially_material_non_text_document_present");
  if (documentCoverage.nonTextPotentiallyMaterialDocuments.some((document) => document.noiseClass === "graphic_or_binary")) {
    warnings.push("possible_material_binary_or_pdf_exhibit_without_text");
  }
  if (documentCoverage.noiseProfile.machineReadableSupportCount > 0) warnings.push("machine_readable_support_documents_present");
  if (documentCoverage.noiseProfile.graphicOrBinaryCount > 0) warnings.push("graphic_or_binary_documents_present");
  if (documentCoverage.noiseProfile.spreadsheetOrZipCount > 0) warnings.push("spreadsheet_or_archive_documents_present");
  if (tableFacts.structuredTableCount > 0) warnings.push("structured_html_tables_present");
  if (tableFacts.tableLikeBlockCount > 0) warnings.push("table_like_text_present");
  if (tableFacts.truncatedTableDocumentCount > 0) warnings.push("table_document_text_truncated");
  if (tableFacts.sourceTableLikeLineCount >= 4 && tableFacts.structuredTableCount === 0 && tableFacts.tableLikeBlockCount === 0) {
    warnings.push("table_like_content_low_extraction");
  }
  if (formProfile.primaryIsShort && formProfile.meaningfulExhibitCount > 0) warnings.push("primary_short_exhibit_meaningful");
  if (formProfile.is6kLike && formProfile.primaryIsWrapper && formProfile.meaningfulExhibitCount === 0) {
    warnings.push("six_k_wrapper_without_meaningful_exhibit");
  }
  if (formProfile.is6kLike && formProfile.meaningfulNonTextExhibitCount > 0) warnings.push("six_k_meaningful_exhibit_non_text");
  if (exhibitFacts.unmatchedReferences.length > 0) warnings.push("exhibit_reference_document_match_failed");

  const indexItems = stringArray(rawPayload.index_items);
  const bodyItems = items.map((item) => item.item);
  if ((secFormType === "8-K" || secFormType === "8-K/A") && indexItems.length > 0 && bodyItems.length > 0 && !sameStringSet(indexItems, bodyItems)) warnings.push("sec_index_body_item_mismatch");

  return uniqueStrings(warnings);
}

function buildSummary({
  amendment,
  companyName,
  cueCount,
  formType,
  itemCount,
  ticker,
}: {
  amendment: Sec8k6kAmendmentInfo;
  companyName: string | null;
  cueCount: number;
  formType: Sec8k6kFormType | null;
  itemCount: number;
  ticker: string | null;
}) {
  const issuer = companyName || ticker || "Issuer";
  const amendmentText = amendment.isAmendment ? " amended" : "";
  return `${issuer} filed${amendmentText} ${formType || "8-K/6-K"} with ${itemCount} extracted item(s) and ${cueCount} source-backed filing cue(s).`;
}

function buildDocumentCoverageFacts(
  documents: DocumentPayload[],
  summaries: Sec8k6kDocumentSummary[],
  attachmentTexts: AttachmentTextPayload[] = [],
) {
  const enriched = documents.map((document, index) => {
    const summary = summaries[index];
    const noiseClass = documentNoiseClass(document, summary);
    const role = documentRole(document, summary, noiseClass);
    const attachmentText = findAttachmentTextForDocument(document, attachmentTexts);
    const attachmentTextCharCount = stringValue(attachmentText?.text).length;
    const textExtractionStatus = nullableString(document.textExtractionStatus) || (attachmentTextCharCount > 0 ? "text_extracted" : inferTextExtractionStatus(document, summary, noiseClass));
    const isPotentiallyMaterialNonText = looksPotentiallyMaterialDocument({
      description: nullableString(document.description),
      filename: nullableString(document.filename) || nullableString(document.document),
      role,
      type: nullableString(document.type),
    });
    const importantForParsing = booleanValue(document.importantForParsing) ?? (isPotentiallyMaterialNonText || inferredImportantDocument(role, noiseClass, summary));
    const isPrimary = Boolean(summary?.is_primary || document.isPrimary);
    const textCharCount = summary?.text_char_count || numberValue(document.textCharCount) || attachmentTextCharCount;
    const includedInParserText = booleanValue(document.includedInParserText) ?? (isPrimary || attachmentTextCharCount > 0);
    const includedTextCharCount = includedInParserText
      ? numberValue(document.includedTextCharCount) || attachmentTextCharCount || textCharCount
      : 0;
    return {
      type: summary?.type || nullableString(document.type),
      description: summary?.description || nullableString(document.description),
      filename: nullableString(document.filename),
      role,
      noiseClass,
      importantForParsing,
      includedInParserText,
      includedTextCharCount,
      isPrimary,
      omittedDueToLimit: Boolean(document.omittedDueToLimit),
      sequence: nullableString(document.sequence),
      selectionPriority: numberValue(document.selectionPriority),
      selectionReason: nullableString(document.selectionReason),
      structuredTableCount: numberValue(document.structuredTableCount),
      structuredTables: recordArray(document.structuredTables).map(mapStructuredTableSummary),
      tableLikeLineCount: numberValue(document.tableLikeLineCount),
      textCharCount,
      textExtractionStatus,
      textTruncated: Boolean(summary?.text_truncated || document.textTruncated),
      urlPresent: Boolean(summary?.url_present || nullableString(document.url)),
    };
  });
  const importantAttachments = enriched
    .filter((document) => document.importantForParsing && !document.isPrimary)
    .map((document) => ({
      type: document.type,
      description: document.description,
      filename: document.filename,
      role: document.role,
      noiseClass: document.noiseClass,
      includedInParserText: document.includedInParserText,
      includedTextCharCount: document.includedTextCharCount,
      omittedDueToLimit: document.omittedDueToLimit,
      selectionPriority: document.selectionPriority,
      selectionReason: document.selectionReason,
      structuredTableCount: document.structuredTableCount,
      textCharCount: document.textCharCount,
      textExtractionStatus: document.textExtractionStatus,
      textTruncated: document.textTruncated,
      urlPresent: document.urlPresent,
    }));
  const omittedImportantAttachments = importantAttachments.filter(
    (document) => !document.includedInParserText || document.textExtractionStatus !== "text_extracted",
  );
  const nonTextPotentiallyMaterialDocuments = enriched.filter((document) => {
    if (document.isPrimary) return false;
    if (!["graphic_or_binary", "spreadsheet_or_zip"].includes(document.noiseClass)) return false;
    return document.importantForParsing || looksPotentiallyMaterialDocument(document);
  });
  const noiseProfile = {
    sourceTextDocumentCount: enriched.filter((document) => document.noiseClass === "source_filing_text").length,
    materialTextExhibitCount: enriched.filter((document) => document.noiseClass === "material_exhibit_text").length,
    otherTextExhibitCount: enriched.filter((document) => document.noiseClass === "other_exhibit_text").length,
    machineReadableSupportCount: enriched.filter((document) => document.noiseClass === "machine_readable_xbrl_or_metadata").length,
    graphicOrBinaryCount: enriched.filter((document) => document.noiseClass === "graphic_or_binary").length,
    spreadsheetOrZipCount: enriched.filter((document) => document.noiseClass === "spreadsheet_or_zip").length,
    otherDocumentCount: enriched.filter((document) => document.noiseClass.startsWith("other_")).length,
  };
  const graphicOrBinaryCount = noiseProfile.graphicOrBinaryCount;
  const selectedTextDocuments = enriched.filter((document) => document.includedInParserText);
  const highPriorityAttachments = importantAttachments.filter((document) => document.selectionPriority >= 100);
  const omittedHighPriorityAttachments = highPriorityAttachments.filter(
    (document) => !document.includedInParserText || document.textExtractionStatus !== "text_extracted",
  );

  return {
    documentCount: enriched.length,
    importantAttachmentCount: importantAttachments.length,
    importantAttachments,
    noiseProfile,
    roleProfile: countBy(enriched.map((document) => document.role)),
    selectionAudit: {
      selectedTextDocumentCount: selectedTextDocuments.length,
      selectedImportantAttachmentCount: importantAttachments.filter((document) => document.includedInParserText).length,
      highPriorityAttachmentCount: highPriorityAttachments.length,
      selectedHighPriorityAttachmentCount: highPriorityAttachments.filter((document) => document.includedInParserText).length,
      omittedHighPriorityAttachmentCount: omittedHighPriorityAttachments.length,
      selectionReasons: countBy(enriched.filter((document) => !document.isPrimary).map((document) => document.selectionReason || "unselected")),
      noiseClasses: countBy(enriched.map((document) => document.noiseClass)),
    },
    parserTextCoverage: {
      includedDocumentCount: enriched.filter((document) => document.includedInParserText).length,
      includedImportantAttachmentCount: importantAttachments.filter((document) => document.includedInParserText).length,
      omittedImportantAttachmentCount: omittedImportantAttachments.length,
      omittedDueToLimitCount: importantAttachments.filter((document) => document.omittedDueToLimit).length,
      includedTextCharCount: enriched.reduce((total, document) => total + document.includedTextCharCount, 0),
    },
    omittedOrNonTextImportantAttachments: omittedImportantAttachments,
    nonTextPotentiallyMaterialDocuments: nonTextPotentiallyMaterialDocuments.map((document) => ({
      type: document.type,
      description: document.description,
      filename: document.filename,
      role: document.role,
      noiseClass: document.noiseClass,
      textExtractionStatus: document.textExtractionStatus,
      urlPresent: document.urlPresent,
    })),
    imageHeavyPackage: {
      isImageHeavy: enriched.length >= 10 && (graphicOrBinaryCount >= 10 || graphicOrBinaryCount / Math.max(enriched.length, 1) >= 0.5),
      graphicOrBinaryCount,
      graphicOrBinaryRatio: enriched.length ? Number((graphicOrBinaryCount / enriched.length).toFixed(3)) : 0,
    },
  };
}

function buildNoiseCandidateFacts(
  text: string,
  documentCoverage: ReturnType<typeof buildDocumentCoverageFacts>,
  tableFacts: ReturnType<typeof buildTableFacts>,
) {
  const candidates: Array<{
    kind: string;
    label: string;
    evidence: string;
    confidence: Sec8k6kConfidence;
  }> = [];
  const addCandidate = (kind: string, label: string, evidence: string, confidence: Sec8k6kConfidence = "medium") => {
    if (!evidence || candidates.some((candidate) => candidate.kind === kind)) return;
    candidates.push({ kind, label, evidence: truncate(evidence, 520), confidence });
  };

  if (documentCoverage.noiseProfile.machineReadableSupportCount > 0) {
    addCandidate(
      "machine_readable_support_documents",
      "XBRL/XML/metadata support documents",
      `${documentCoverage.noiseProfile.machineReadableSupportCount} machine-readable support document(s) were present.`,
      "high",
    );
  }
  if (documentCoverage.noiseProfile.graphicOrBinaryCount > 0) {
    addCandidate(
      "graphic_or_binary_documents",
      "Image, graphic, PDF, or binary support documents",
      `${documentCoverage.noiseProfile.graphicOrBinaryCount} graphic/binary document(s) were present.`,
      "high",
    );
  }
  if (documentCoverage.noiseProfile.spreadsheetOrZipCount > 0) {
    addCandidate(
      "spreadsheet_or_archive_documents",
      "Spreadsheet or archive support documents",
      `${documentCoverage.noiseProfile.spreadsheetOrZipCount} spreadsheet/archive document(s) were present.`,
      "high",
    );
  }

  const textCandidates: Array<[string, string, RegExp, Sec8k6kConfidence]> = [
    ["cover_page_boilerplate", "SEC cover page fields", /\b(?:Date of Report|Commission File Number|Exact name of registrant|Registrant'?s telephone number)\b/i, "high"],
    ["exhibit_index", "Exhibit index", /\bEXHIBIT\s+INDEX\b/i, "high"],
    ["signature_block", "Signature block", /\bSIGNATURES?\b[\s\S]{0,180}?(?:By:|\/s\/)/i, "high"],
    ["forward_looking_safe_harbor", "Forward-looking statement or safe-harbor language", /\b(?:forward-looking statements?|safe harbor|Private Securities Litigation Reform Act)\b/i, "high"],
    ["company_profile_boilerplate", "Company profile or about-company paragraph", /\bAbout\s+[A-Z][A-Za-z0-9&.,' -]{2,80}\b/i, "medium"],
    ["contact_boilerplate", "Investor/media contact block", /\b(?:Investor Relations|Media Contact|For further information|Contact:)\b/i, "medium"],
  ];

  for (const [kind, label, pattern, confidence] of textCandidates) {
    const match = text.match(pattern);
    if (match) addCandidate(kind, label, pickEvidenceSentence(text, match.index || 0), confidence);
  }

  if (tableFacts.structuredTableCount >= 20 || tableFacts.tableLikeBlockCount >= 20) {
    addCandidate(
      "dense_table_package",
      "Dense table package",
      `${tableFacts.structuredTableCount} structured table(s) and ${tableFacts.tableLikeBlockCount} table-like text block(s) were detected.`,
      "high",
    );
  }
  if (tableFacts.truncatedTableDocumentCount > 0) {
    addCandidate(
      "truncated_table_documents",
      "Table-bearing document text was truncated",
      `${tableFacts.truncatedTableDocumentCount} table-bearing document(s) had truncated text.`,
      "high",
    );
  }

  return candidates.slice(0, 12);
}

function buildTableFacts(text: string, documents: DocumentPayload[]) {
  const lines = text.split("\n");
  let sourceTableLikeLineCount = documents.reduce((total, document) => total + numberValue(document.tableLikeLineCount), 0);
  const structuredTables = documents.flatMap((document) =>
    recordArray(document.structuredTables).map((table) => ({
      documentType: nullableString(document.type),
      documentDescription: nullableString(document.description),
      filename: nullableString(document.filename),
      includedInParserText: booleanValue(document.includedInParserText) ?? Boolean(document.isPrimary),
      table: mapStructuredTableSummary(table),
    })),
  );
  const tableLikeBlocks: Array<{
    label: string;
    kind: string;
    columnCount: number;
    numericCellCount: number;
    rowCount: number;
    rows: string[][];
    evidence: string;
    confidence: Sec8k6kConfidence;
  }> = [];
  let current: string[] = [];
  let blankLinesInsideTable = 0;
  const flushCurrent = () => {
    if (current.length >= 2 && !isLikelyNoiseTableBlock(current)) {
      sourceTableLikeLineCount += current.length;
      tableLikeBlocks.push(tableBlockFromLines(current));
    }
    current = [];
    blankLinesInsideTable = 0;
  };

  for (const line of lines) {
    if (isTableLikeLine(line)) {
      current.push(line);
      blankLinesInsideTable = 0;
      continue;
    }
    if (!line.trim() && current.length > 0 && blankLinesInsideTable < 1) {
      blankLinesInsideTable += 1;
      continue;
    }
    flushCurrent();
  }
  flushCurrent();

  const documentTableHints = documents
    .map((document) => ({
      type: nullableString(document.type),
      description: nullableString(document.description),
      filename: nullableString(document.filename),
      role: documentRole(document, null, documentNoiseClass(document, null)),
      includedInParserText: booleanValue(document.includedInParserText) ?? Boolean(document.isPrimary),
      includedTextCharCount: numberValue(document.includedTextCharCount),
      structuredTableCount: numberValue(document.structuredTableCount),
      tableLikeLineCount: numberValue(document.tableLikeLineCount),
      textTruncated: Boolean(document.textTruncated),
    }))
    .filter((document) => document.structuredTableCount > 0 || document.tableLikeLineCount > 0 || /table|financial|static pool|pool data|schedule/i.test(`${document.description || ""} ${document.filename || ""}`));

  return {
    structuredTableCount: structuredTables.length,
    structuredTables: structuredTables.slice(0, 16),
    sourceTableLikeLineCount,
    tableLikeBlockCount: tableLikeBlocks.length,
    tableLikeBlocks: tableLikeBlocks.slice(0, 8),
    documentTableHints: documentTableHints.slice(0, 20),
    truncatedTableDocumentCount: documentTableHints.filter((document) => document.textTruncated).length,
  };
}

function buildAmendmentContextFacts(amendment: Sec8k6kAmendmentInfo) {
  return {
    isAmendment: amendment.isAmendment,
    amendmentNumber: amendment.amendmentNumber,
    parentAccessionNumber: amendment.parentAccessionNumber,
    parentFiledDate: amendment.parentFiledDate,
    needsParentContext: amendment.needsParentContext,
    administrativeSignalCount: amendment.administrativeSignals.length,
    materialChangeSignalCount: amendment.materialChangeSignals.length,
    isRoutineAdministrativeOnly: amendment.isRoutineAdministrativeOnly,
    hasMaterialChangeLanguage: amendment.hasMaterialChangeLanguage,
    excerpt: amendment.excerpt,
  };
}

function buildSourcePackageFacts(rawPayload: Record<string, unknown>, documents: Sec8k6kDocumentSummary[]) {
  const primaryDocument = documents.find((document) => document.is_primary) || null;
  return {
    accessionNumber: nullableString(rawPayload.accession_number),
    cik: nullableString(rawPayload.cik),
    filingDate: nullableString(rawPayload.filing_date),
    reportDate: nullableString(rawPayload.report_date),
    acceptedAt: nullableString(rawPayload.accepted_at),
    primaryDocumentUrl: nullableString(rawPayload.primary_document_url),
    completeSubmissionUrl: nullableString(rawPayload.complete_submission_url),
    filingIndexUrl: nullableString(rawPayload.filing_index_url),
    filingIndexItems: stringArray(rawPayload.index_items),
    documentCount: documents.length,
    primaryDocument: primaryDocument
      ? {
          type: primaryDocument.type,
          description: primaryDocument.description,
          textCharCount: primaryDocument.text_char_count,
          textTruncated: primaryDocument.text_truncated,
          fetchStatus: primaryDocument.fetch_status,
          fetchError: primaryDocument.fetch_error,
        }
      : null,
    attachedTextDocumentCount: documents.filter((document) => !document.is_primary && document.text_char_count > 0).length,
    truncatedDocumentCount: documents.filter((document) => document.text_truncated).length,
    fetchErrorCount: documents.filter((document) => document.fetch_error && !isGraphicOrBinaryDocument(document)).length,
    graphicOrBinaryDocumentCount: documents.filter(isGraphicOrBinaryDocument).length,
  };
}

function buildCoverPageFacts(text: string) {
  return {
    reportDate: findField(text, /\bDate of Report\s*\(Date of earliest event reported\)\s*:?\s*([A-Z][a-z]+ \d{1,2}, \d{4})/i),
    commissionFileNumber: findField(text, /\bCommission File Number\s*:?\s*([0-9-]+)/i),
    registrantTelephone: findField(text, /\b(?:Registrant'?s|Issuer'?s)\s+telephone number[\s\S]{0,80}?\(?\d{3}[\s). -]+\d{3}[\s.-]+\d{4}/i),
    form20F: findCheckboxField(text, "20-F"),
    form40F: findCheckboxField(text, "40-F"),
    writtenCommunications425: findCheckboxField(text, "Written communications pursuant to Rule 425"),
    solicitingMaterial14a12: findCheckboxField(text, "Soliciting material pursuant to Rule 14a-12"),
    preCommencementTenderOffer14d2: findCheckboxField(text, "Pre-commencement communications pursuant to Rule 14d-2"),
    preCommencementIssuerTenderOffer13e4: findCheckboxField(text, "Pre-commencement communications pursuant to Rule 13e-4"),
  };
}

function findCheckboxField(text: string, label: string): Sec8k6kField<boolean | null> | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const checkedMark = "[\\u2612\\u2611\\u2713xX]";
  const pattern = new RegExp(`(?:${escaped}[\\s\\S]{0,24}?${checkedMark}|${checkedMark}[\\s\\S]{0,24}?${escaped})`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  return {
    value: new RegExp(checkedMark).test(match[0]) ? true : null,
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "medium",
  };
}

function toParserSignal(cue: Sec8k6kFilingCue): Sec8k6kParserSignal {
  return cue;
}

function extract8kItems(text: string): Sec8k6kItem[] {
  const scanText = text.slice(0, signatureBoundaryIndex(text));
  const lines = splitLinesWithOffsets(scanText);
  const headings: Array<{ item: string; label: string; start: number }> = [];
  let inExhibitIndex = false;
  let inTableOfContents = false;
  let tableOfContentsSawItem = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.text.trim();
    if (/^SIGNATURES?$/i.test(trimmed)) break;
    if (/^TABLE\s+OF\s+CONTENTS$/i.test(trimmed)) {
      inTableOfContents = true;
      tableOfContentsSawItem = false;
      continue;
    }
    if (/^EXHIBIT\s+INDEX\b/i.test(trimmed)) {
      inExhibitIndex = true;
      continue;
    }
    const heading = parse8kItemHeading(line.text) || parseSplit8kItemHeading(line.text, lines[lineIndex + 1]?.text);
    if (inTableOfContents) {
      if (heading) {
        tableOfContentsSawItem = true;
        continue;
      }
      if (!trimmed) {
        if (tableOfContentsSawItem) inTableOfContents = false;
        continue;
      }
      if (/^\d+$/.test(trimmed)) continue;
      inTableOfContents = false;
      tableOfContentsSawItem = false;
    }
    if (!heading) continue;
    if (inExhibitIndex && heading.item !== "9.01") continue;
    if (headings.some((existing) => existing.item === heading.item && Math.abs(existing.start - line.start) < 40)) continue;
    headings.push({ ...heading, start: line.start });
  }

  return headings.map((heading, index) => {
    const nextStart = headings[index + 1]?.start ?? scanText.length;
    const sectionText = compactText(scanText.slice(heading.start, nextStart));
    return {
      item: heading.item,
      label: heading.label,
      evidence: truncateSourceSection(sectionText, itemEvidenceLimit(heading.item)),
    };
  });
}

function extract8kUnnumberedSections(text: string): Sec8k6kUnnumberedSection[] {
  const scanText = text.slice(0, signatureBoundaryIndex(text));
  const lines = splitLinesWithOffsets(scanText);
  const sections: Sec8k6kUnnumberedSection[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const heading = line.text.trim();
    if (!/^(?:Introductory|Explanatory)\s+Note\s*:?$/i.test(heading)) continue;

    let end = scanText.length;
    for (let nextIndex = lineIndex + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      const nextHeading = nextLine.text.trim();
      if (
        parse8kItemHeading(nextLine.text) ||
        parseSplit8kItemHeading(nextLine.text, lines[nextIndex + 1]?.text) ||
        /^(?:Introductory|Explanatory)\s+Note\s*:?$/i.test(nextHeading) ||
        /^SIGNATURES?$/i.test(nextHeading)
      ) {
        end = nextLine.start;
        break;
      }
    }

    const sectionText = truncateSourceSection(scanText.slice(line.start, end), 8_000);
    if (sectionText) sections.push({ heading: heading.replace(/:$/, ""), evidence: sectionText });
  }

  return sections;
}

function splitLinesWithOffsets(text: string) {
  const lines: Array<{ text: string; start: number }> = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    lines.push({ text: line, start: offset });
    offset += line.length + 1;
  }
  return lines;
}

function parse8kItemHeading(line: string) {
  const trimmed = line.trim();
  const match = trimmed.match(ITEM_HEADING_PATTERN);
  if (!match) return null;
  const item = match[1];
  if (!SUPPORTED_8K_ITEM_NUMBER_SET.has(item)) return null;
  const labelText = cleanItemHeadingLabel(match[2] || "");
  if (isLikelyInlineItemReference(labelText)) return null;
  return {
    item,
    label: labelText || ITEM_LABELS[item] || `Item ${item}`,
  };
}

function parseSplit8kItemHeading(line: string, nextLine: string | undefined) {
  if (!/^\s*Item\s*$/i.test(normalizeParserWhitespace(line))) return null;
  const next = normalizeParserWhitespace(nextLine || "").trim();
  const match = next.match(new RegExp(`^(${SUPPORTED_8K_ITEM_NUMBERS.map(escapeRegExp).join("|")})\\.?\\s*(.*)$`, "i"));
  if (!match) return null;
  const item = match[1];
  const labelText = cleanItemHeadingLabel(match[2] || "");
  if (isLikelyInlineItemReference(labelText)) return null;
  return {
    item,
    label: labelText || ITEM_LABELS[item] || `Item ${item}`,
  };
}

function cleanItemHeadingLabel(value: string) {
  return compactText(value.replace(/^\.\s*/, "").replace(/^\|+|\|+$/g, ""));
}

function normalizeParserWhitespace(value: string) {
  return stringValue(value).replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ");
}

function isLikelyInlineItemReference(labelText: string) {
  if (!labelText) return false;
  if (/^(?:is|are|was|were|has|have|had|of|in|under|above|below|from|to|and|or)\b/i.test(labelText)) return true;
  return false;
}

function signatureBoundaryIndex(text: string) {
  const match = text.match(/(?:^|\n)\s*SIGNATURES?\s*(?:\n|$)/i);
  return match?.index == null ? text.length : match.index;
}

function itemSectionBodyLength(item: Sec8k6kItem) {
  const withoutHeading = item.evidence.replace(new RegExp(`^\\s*Item\\s+${escapeRegExp(item.item)}\\.?[^\\n]*`, "i"), "");
  return compactText(withoutHeading).length;
}

function findMoneyAmounts(text: string): Sec8k6kMoneyField[] {
  const matches = [...text.matchAll(/\$\s?(\d[\d,.]*)(?:\s?(thousand|million|billion|m|bn))?/gi)];
  return matches.slice(0, 8).map((match) => {
    const rawText = match[0];
    return {
      value: normalizeMoney(rawText),
      text: rawText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  });
}

function findShareCounts(text: string): Sec8k6kNumberField[] {
  const matches = [...text.matchAll(/\b(\d[\d,.]*)\s+(?:shares|ordinary shares|common shares|ADSs|units)\b/gi)];
  return matches.slice(0, 8).map((match) => {
    const rawText = match[0];
    return {
      value: numberFromMatch(match[1]),
      text: rawText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  });
}

function findDateFields(text: string): Sec8k6kField[] {
  const matches = [...text.matchAll(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/g)];
  return matches.slice(0, 10).map((match) => ({
    value: match[0],
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "medium",
  }));
}

function findSignals(text: string, patterns: RegExp[]): Sec8k6kField[] {
  const signals: Sec8k6kField[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    signals.push({
      value: compactText(match[0]).toLowerCase(),
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    });
  }
  return signals;
}

function findFirstEvidence(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return pickEvidenceSentence(text, match.index || 0);
  }
  return null;
}

function findField(text: string, pattern: RegExp): Sec8k6kField | null {
  const match = text.match(pattern);
  if (!match) return null;
  return {
    value: compactText(match[0]),
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "medium",
  };
}

function findPriceField(text: string): Sec8k6kMoneyField | null {
  const match = text.match(/\b(?:purchase price|offering price|exercise price)\s+(?:of|equal to)?\s*(\$\s?\d[\d,.]*)/i);
  if (!match?.[1]) return null;
  return {
    value: normalizeMoney(match[1]),
    text: match[1],
    evidence: pickEvidenceSentence(text, match.index || 0),
    confidence: "medium",
  };
}

function firstMoneyNear(text: string, labelPattern: RegExp): Sec8k6kMoneyField | null {
  const label = text.match(labelPattern);
  if (!label) return null;
  const scope = text.slice(label.index || 0, (label.index || 0) + 360);
  const money = scope.match(/\$\s?\d[\d,.]*(?:\s?(?:thousand|million|billion|m|bn))?/i);
  if (!money) return null;
  return {
    value: normalizeMoney(money[0]),
    text: money[0],
    evidence: pickEvidenceSentence(text, label.index || 0),
    confidence: "medium",
  };
}

function extractAmendmentExcerpt(text: string) {
  const match = text.match(/\b(?:Explanatory Note|Amendment No\.?\s*\d+|This Amendment)[\s\S]{0,1300}/i);
  return match ? truncate(match[0], 1_300) : truncate(text, 1_000) || null;
}

function resolveFormType({
  documents,
  metadata,
  rawPayload,
  title,
  text,
}: {
  documents: DocumentPayload[];
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  title: unknown;
  text: string;
}): Sec8k6kFormType | null {
  return (
    readFormFromDocuments(documents) ||
    canonicalFormType(nullableString(rawPayload.form_type)) ||
    canonicalFormType(nullableString(metadata.form_type)) ||
    canonicalFormType(readFormFromText(stringValue(title))) ||
    canonicalFormType(readFormFromText(text)) ||
    null
  );
}

function readFormFromDocuments(documents: DocumentPayload[]) {
  const primary = documents.find((document) => Boolean(document.isPrimary) && isSec8k6kForm(canonicalFormType(nullableString(document.type))));
  if (primary) return canonicalFormType(nullableString(primary.type));
  const any = documents.find((document) => isSec8k6kForm(canonicalFormType(nullableString(document.type))));
  return any ? canonicalFormType(nullableString(any.type)) : null;
}

function readFormFromText(text: string) {
  return text.match(/\b(8-K\/A|6-K\/A|8-K|6-K)\b/i)?.[1] || "";
}

function canonicalFormType(value: string | null): Sec8k6kFormType | null {
  const form = stringValue(value).toUpperCase().replace(/\s+/g, "");
  if (form === "8-K/A" || form === "8-KA") return "8-K/A";
  if (form === "6-K/A" || form === "6-KA") return "6-K/A";
  if (form === "8-K") return "8-K";
  if (form === "6-K") return "6-K";
  return null;
}

function isSec8k6kForm(value: unknown): value is Sec8k6kFormType {
  return SEC_8K_6K_FORMS.includes(value as Sec8k6kFormType);
}

function readCompanyName(text: string) {
  return (
    text.match(/\b(?:Exact name of registrant|Registrant):?\s*([A-Z][A-Za-z0-9&.,' -]{2,80})/i)?.[1]?.trim() ||
    text.match(/\b([A-Z][A-Za-z0-9&.,' -]{2,80})\s+(?:announced|reported|entered into|filed)\b/)?.[1]?.trim() ||
    null
  );
}

function mapDocumentSummary(document: DocumentPayload): Sec8k6kDocumentSummary {
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

function redactLargeRawPayload(rawPayload: Record<string, unknown>) {
  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawPayload)) {
    if (key === "attachment_texts") {
      clone[key] = recordArray(value).map((item) => ({
        type: nullableString(item.type),
        description: nullableString(item.description),
        text_char_count: stringValue(item.text).length,
      }));
      continue;
    }
    clone[key] = value;
  }
  return clone;
}

function normalizeMoney(value: string): Sec8k6kMoneyValue {
  const text = stringValue(value);
  const amountMatch = text.match(/(\d[\d,.]*)/);
  if (!amountMatch) return { amount: null, currency: text.includes("$") ? "USD" as const : null, scale: null };
  const base = Number(amountMatch[1].replace(/,/g, ""));
  const scale: Sec8k6kMoneyValue["scale"] = /\bb(?:illion|n)?\b/i.test(text)
    ? "billion"
    : /\bm(?:illion)?\b/i.test(text)
      ? "million"
      : /\bthousand\b/i.test(text)
        ? "thousand"
        : "raw";
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return {
    amount: Number.isFinite(base) ? base * multiplier : null,
    currency: text.includes("$") ? "USD" as const : null,
    scale,
  };
}

function numberFromMatch(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function pickEvidenceSentence(text: string, index: number) {
  const clean = compactText(text);
  if (!clean) return "";
  const safeIndex = Math.max(0, Math.min(index, clean.length - 1));
  const start = Math.max(0, clean.lastIndexOf(".", safeIndex - 1), clean.lastIndexOf("\n", safeIndex - 1));
  let end = clean.indexOf(".", safeIndex + 1);
  if (end < 0 || end - safeIndex > 520) end = Math.min(clean.length, safeIndex + 420);
  else end += 1;
  return truncate(clean.slice(start > 0 ? start + 1 : start, end), 420);
}

function itemEvidenceLimit(itemNumber: string) {
  if (["1.01", "2.01", "3.01", "3.02", "5.02", "5.03", "5.07", "8.01"].includes(itemNumber)) {
    return 32_000;
  }
  return 12_000;
}

function extractRoutingHeadline(text: string, description: string | null, filename: string | null) {
  const fallback = semanticHeadlineCandidate(description || "") || semanticHeadlineCandidate(filename || "");
  const headline = findSecDocumentHeadline(text);
  return nullableString(truncate(headline || fallback || "", 240));
}

function extractRoutingSummary(text: string, headline: string | null) {
  const normalizedHeadline = compactText(headline || "").toLowerCase();
  const lines = text
    .split(/\r?\n/)
    .map((line) => compactText(line))
    .filter(Boolean);
  const meaningful = lines.filter((line) => {
    const semantic = semanticHeadlineCandidate(line);
    if (!semantic) return false;
    if (compactText(semantic).toLowerCase() === normalizedHeadline) return false;
    if (/^(?:press release|news release|immediate release|for immediate release|contact|investor relations)\b/i.test(semantic)) return false;
    if (isTableLikeRoutingText(line)) return false;
    return semantic.length >= 40;
  });
  const context = meaningful.find((line) =>
    /\b(?:announc|approv|authoriz|effect|implement|complet|enter|appoint|resign|dismiss|engag|report|expect|guidance|production|revenue|merger|acquisition|reverse stock split)\w*\b/i.test(line),
  ) || meaningful[0] || "";
  return nullableString(truncate([headline, context].filter(Boolean).join(". "), 620));
}

function isTableLikeRoutingText(value: string) {
  return (value.match(/\|/g) || []).length >= 2 || (value.match(/\t/g) || []).length >= 2;
}

const REFERENCED_FILING_DATE_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}";

function extractReferencedFilings(text: string, items: Sec8k6kItem[]): Sec8k6kReferencedFiling[] {
  const references: Sec8k6kReferencedFiling[] = [];
  const patterns: Array<{ pattern: RegExp; formType: (match: RegExpExecArray) => string }> = [
    {
      pattern: new RegExp(
        `\\b((?:definitive|preliminary)\\s+proxy statement(?:\\s+on\\s+Schedule\\s+14A)?)[\\s\\S]{0,320}?\\bfiled\\b[\\s\\S]{0,180}?\\b(?:on\\s+)?(${REFERENCED_FILING_DATE_PATTERN})\\b`,
        "gi",
      ),
      formType: (match) => (/\bpreliminary\b/i.test(match[1] || "") ? "PRE 14A" : "DEF 14A"),
    },
    {
      pattern: new RegExp(
        `\\b((?:(?:Current|Annual|Quarterly)\\s+Report|Registration\\s+Statement|Prospectus)\\s+(?:on\\s+)?Form\\s+(8-K(?:\\/A)?|6-K(?:\\/A)?|S-[1348](?:\\/A)?|F-[134](?:\\/A)?|424B[345]|425|DEF\\s*14A|PRE\\s*14A|DEFA14A|DEFM14A|DEFC14A))[\\s\\S]{0,320}?\\bfiled\\b[\\s\\S]{0,180}?\\b(?:on\\s+)?(${REFERENCED_FILING_DATE_PATTERN})\\b`,
        "gi",
      ),
      formType: (match) => normalizeReferencedFormType(match[2] || match[1] || ""),
    },
    {
      pattern: new RegExp(
        `\\b(Schedule\\s+(14A|TO(?:-[IT])?|13[DG](?:\\/A)?))[\\s\\S]{0,320}?\\bfiled\\b[\\s\\S]{0,180}?\\b(?:on\\s+)?(${REFERENCED_FILING_DATE_PATTERN})\\b`,
        "gi",
      ),
      formType: (match) => normalizeReferencedFormType(match[2] || match[1] || ""),
    },
  ];

  for (const { pattern, formType } of patterns) {
    for (const match of text.matchAll(pattern)) {
      const matchedText = compactText(match[0] || "");
      const dateText = match[match.length - 1] || "";
      const filedDate = normalizeReferencedFiledDate(dateText);
      const normalizedFormType = formType(match as RegExpExecArray);
      if (!matchedText || !filedDate || !normalizedFormType) continue;
      const evidence = truncate(pickEvidenceSentence(text, match.index || 0) || matchedText, 520);
      const accessionNumber = evidence.match(/\b\d{10}-\d{2}-\d{6}\b/)?.[0] || null;
      const itemNumber = items.find((item) => item.evidence.includes(match[0] || ""))?.item || null;
      references.push({
        formType: normalizedFormType,
        filedDate,
        accessionNumber,
        itemNumber,
        evidence,
        confidence: "high",
      });
    }
  }

  const seen = new Set<string>();
  return references.filter((reference) => {
    if (
      reference.formType === "SCHEDULE 14A" &&
      references.some(
        (candidate) =>
          (candidate.formType === "DEF 14A" || candidate.formType === "PRE 14A") &&
          candidate.filedDate === reference.filedDate,
      )
    ) {
      return false;
    }
    const key = `${reference.formType}|${reference.filedDate}|${reference.accessionNumber || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

function normalizeReferencedFormType(value: string) {
  const compact = value.toUpperCase().replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact === "14A" || compact === "SCHEDULE 14A") return "SCHEDULE 14A";
  if (compact === "DEF 14A") return "DEF 14A";
  if (compact === "PRE 14A") return "PRE 14A";
  if (compact.startsWith("TO")) return `SC ${compact}`;
  if (/^13[DG](?:\/A)?$/.test(compact)) return `SC ${compact}`;
  return compact.replace(/^FORM\s+/, "");
}

function normalizeReferencedFiledDate(value: string) {
  const match = value.match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/i,
  );
  if (!match) return "";
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const month = months.indexOf((match[1] || "").toLowerCase()) + 1;
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(year)) return "";
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function truncateSourceSection(value: string, max: number) {
  const text = compactText(value);
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const boundary = Math.max(
    slice.lastIndexOf("\n\n"),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(". "),
    slice.lastIndexOf("; "),
  );
  if (boundary > Math.floor(max * 0.65)) return `${slice.slice(0, boundary + 1).trim()}...`;
  return `${slice.trim()}...`;
}

function compactText(value: string) {
  return stringValue(value)
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, " ")
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

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function arrayRows(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is unknown[] => Array.isArray(item)) : [];
}

function hasCue(cues: Sec8k6kFilingCue[], cueType: Sec8k6kFilingCueType) {
  return cues.some((cue) => cue.cueType === cueType);
}

function isGraphicOrBinaryDocument(document: Sec8k6kDocumentSummary) {
  const type = `${document.type || ""} ${document.description || ""}`.toLowerCase();
  return /\b(graphic|image|jpg|jpeg|png|gif|excel|xlsx|xls|zip|pdf)\b/.test(type);
}

function documentNoiseClass(document: DocumentPayload, summary: Sec8k6kDocumentSummary | null) {
  const explicit = nullableString(document.noiseClass);
  if (explicit) return explicit;
  const type = stringValue(summary?.type || document.type).toUpperCase();
  const haystack = `${summary?.type || document.type || ""} ${summary?.description || document.description || ""} ${document.filename || ""}`.toLowerCase();
  if (Boolean(summary?.is_primary || document.isPrimary)) return "source_filing_text";
  if (
    /^EX-101\b|^XML\b|^JSON\b/.test(type) ||
    /\.(xml|xsd|json)$/i.test(haystack) ||
    (["EXCEL", "ZIP"].includes(type) && /\b(?:xbrl|idea)\b/.test(haystack))
  ) return "machine_readable_xbrl_or_metadata";
  if (/^GRAPHIC\b/.test(type) || /\.(jpe?g|png|gif|bmp|pdf)$/i.test(haystack) || /\b(graphic|image|pdf)\b/.test(haystack)) return "graphic_or_binary";
  if (/^EXCEL\b|^ZIP\b/.test(type) || /\.(xlsx?|zip)$/i.test(haystack) || /\b(excel|spreadsheet)\b/.test(haystack)) return "spreadsheet_or_zip";
  if (/^EX-99\b/.test(type)) return "material_exhibit_text";
  if (/^EX-/.test(type)) return "other_exhibit_text";
  return (summary?.text_char_count || numberValue(document.textCharCount)) > 0 ? "other_text_document" : "other_non_text_document";
}

function mapStructuredTableSummary(value: Record<string, unknown>) {
  return {
    tableIndex: numberValue(value.tableIndex),
    caption: nullableString(value.caption),
    rowCount: numberValue(value.rowCount),
    columnCount: numberValue(value.columnCount),
    headers: stringArray(value.headers).slice(0, 16),
    sampleRows: arrayRows(value.sampleRows)
      .map((row) => stringArray(row).slice(0, 16))
      .filter((row) => row.length > 0)
      .slice(0, 8),
    numericCellCount: numberValue(value.numericCellCount),
  };
}

function documentRole(document: DocumentPayload, summary: Sec8k6kDocumentSummary | null, noiseClass: string) {
  const explicit = nullableString(document.documentRole);
  if (explicit) return explicit;
  const type = stringValue(summary?.type || document.type).toUpperCase();
  const haystack = `${summary?.description || document.description || ""} ${document.filename || ""}`.toLowerCase();
  if (Boolean(summary?.is_primary || document.isPrimary)) return "primary_filing";
  if (noiseClass === "machine_readable_xbrl_or_metadata") return "xbrl_support";
  if (noiseClass === "graphic_or_binary") return "graphic_or_image";
  if (noiseClass === "spreadsheet_or_zip") return "spreadsheet_or_archive";
  if (/financial statements|pro forma|static pool|pool data|monthly report|table/i.test(haystack)) return "financial_or_table_exhibit";
  if (/^EX-99\b/.test(type)) return "material_exhibit_text";
  if (/^EX-/.test(type)) return "other_exhibit_text";
  return "other_support_document";
}

function inferTextExtractionStatus(document: DocumentPayload, summary: Sec8k6kDocumentSummary | null, noiseClass: string) {
  if (summary?.fetch_error) return summary.fetch_error;
  if (noiseClass === "machine_readable_xbrl_or_metadata") return "not_extracted_support_file";
  if (noiseClass === "graphic_or_binary") return "not_extracted_binary_or_graphic";
  if (noiseClass === "spreadsheet_or_zip") return "not_extracted_binary_or_archive";
  return (summary?.text_char_count || numberValue(document.textCharCount)) > 0 ? "text_extracted" : "no_text_available";
}

function inferredImportantDocument(role: string, noiseClass: string, summary: Sec8k6kDocumentSummary | null) {
  if (summary?.is_primary) return true;
  if (noiseClass === "machine_readable_xbrl_or_metadata" || noiseClass === "graphic_or_binary") return false;
  return ["material_exhibit_text", "other_exhibit_text", "spreadsheet_or_zip"].includes(noiseClass) || /financial|table|static_pool/.test(role);
}

function looksPotentiallyMaterialDocument(document: {
  description: string | null;
  filename: string | null;
  role: string;
  type: string | null;
}) {
  return /\b(?:ex-99|press release|presentation|circular|proxy|notice|financial statements?|pro forma|static pool|pool data|schedule|monthly report)\b/i.test(
    `${document.type || ""} ${document.description || ""} ${document.filename || ""} ${document.role}`,
  );
}

function isMeaningfulExhibitLikeDocument(document: {
  description: string | null;
  filename: string | null;
  noiseClass: string;
  role: string;
  type: string | null;
}) {
  if (/^EX-101\b|^XML\b|xbrl|schema|calculation|definition|label/i.test(`${document.type || ""} ${document.description || ""}`)) return false;
  if (document.noiseClass === "machine_readable_xbrl_or_metadata") return false;
  return /^EX-/i.test(document.type || "") || /exhibit|press release|presentation|financial statements?|agreement|notice|report/i.test(
    `${document.description || ""} ${document.filename || ""} ${document.role}`,
  );
}

function isTableLikeLine(line: string) {
  const compact = line.trim();
  if (!compact) return false;
  const pipeCount = (compact.match(/\|/g) || []).length;
  const numericCount = (compact.match(/\b(?:\$?\d[\d,.]*%?|\([$\d,.]+\))\b/g) || []).length;
  const tableWords = /\b(?:for|against|abstain|broker non-votes|assets|liabilities|revenue|income|operating income|net income|ebitda|eps|cash|debt|shares|principal|interest|record date|payment date|maturity|coupon|receivables)\b/i.test(compact);
  const periodWords = /\b(?:three months ended|six months ended|nine months ended|year ended|quarter|fiscal|20[2-3]\d)\b/i.test(compact);
  if (pipeCount >= 2) return true;
  if (compact.length > 220) return false;
  if (numericCount >= 5) return true;
  return numericCount >= 3 && (tableWords || periodWords);
}

function isLikelyNoiseTableBlock(lines: string[]) {
  const text = lines.join("\n");
  const hasFinancialSignal = /\b(?:revenue|net income|net loss|operating income|ebitda|eps|cash|debt|assets|liabilities|three months ended|six months ended|year ended|fiscal|quarter)\b/i.test(text);
  const hasVoteSignal = /\b(?:for|against|abstain|broker non-votes)\b/i.test(text);
  if (hasFinancialSignal || hasVoteSignal) return false;
  if (/\bEXHIBIT\s+(?:INDEX|NO\.?|DESCRIPTION)\b/i.test(text)) return true;
  if (/\b(?:SIGNATURES?|By:|\/s\/|Investor Relations|Media Contact|Contact:|telephone|email)\b/i.test(text)) return true;
  const rows = lines.map(tableCellsFromLine);
  const numericCellCount = rows.flat().filter((cell) => /\b\$?\(?\d[\d,.]*%?\)?\b/.test(cell)).length;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return columnCount <= 2 && numericCellCount <= 2;
}

function tableBlockFromLines(lines: string[]) {
  const evidence = truncate(lines.slice(0, 6).join("\n"), 620);
  const rows = lines.slice(0, 8).map(tableCellsFromLine).filter((row) => row.length > 0);
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const numericCellCount = rows.flat().filter((cell) => /\b\$?\(?\d[\d,.]*%?\)?\b/.test(cell)).length;
  return {
    label: "table_like_text_block",
    kind: classifyTableKind(evidence),
    columnCount,
    numericCellCount,
    rowCount: lines.length,
    rows,
    evidence,
    confidence: lines.length >= 4 || columnCount >= 3 ? "high" as const : "medium" as const,
  };
}

function tableCellsFromLine(line: string) {
  const pipeCells = line.split("|").map((cell) => compactText(cell)).filter(Boolean);
  if (pipeCells.length >= 2) return pipeCells.slice(0, 12);
  return compactText(line)
    .split(/\s{2,}|\t/)
    .map((cell) => compactText(cell))
    .filter(Boolean)
    .slice(0, 12);
}

function classifyTableKind(text: string) {
  if (/\b(?:for|against|abstain|broker non-votes)\b/i.test(text)) return "vote_table";
  if (/\b(?:assets|liabilities|revenue|income|cash flows?|balance sheet|statement of operations)\b/i.test(text)) return "financial_table";
  if (/\b(?:record date|payment date|dividend|per share)\b/i.test(text)) return "dividend_or_capital_table";
  if (/\b(?:principal|interest|maturity|coupon|credit|loan)\b/i.test(text)) return "debt_or_credit_table";
  if (/\b(?:static pool|pool data|receivables|delinquenc)\b/i.test(text)) return "abs_pool_table";
  return "unclassified_table";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function sameStringSet(left: string[], right: string[]) {
  const leftSet = new Set(left.map((value) => value.trim()).filter(Boolean));
  const rightSet = new Set(right.map((value) => value.trim()).filter(Boolean));
  if (leftSet.size !== rightSet.size) return false;
  for (const value of leftSet) {
    if (!rightSet.has(value)) return false;
  }
  return true;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) {
    if (!value) continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
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

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}
