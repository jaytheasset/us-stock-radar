import {
  SC13_PARSER_GROUP,
  SC13_PARSER_VERSION,
  type Sc13CleanedSourceBlock,
  type Sc13ExhibitComparison,
  type Sc13ExhibitReference,
  type Sc13Facts,
  type Sc13FilingInput,
  type Sc13KeywordHit,
  type Sc13OwnershipPower,
  type Sc13ParseContext,
  type Sc13ParserOutput,
  type Sc13ReportingPersonFact,
  type Sc13RuleBasis,
  type Sc13SourceFlavor,
  type ScheduleType,
} from "./types";

const SUPPORTED_FORMS = new Set([
  "SC 13D",
  "SC 13D/A",
  "SC 13G",
  "SC 13G/A",
  "SCHEDULE 13D",
  "SCHEDULE 13D/A",
  "SCHEDULE 13G",
  "SCHEDULE 13G/A",
]);

type ItemNumber = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";
type Sc13ItemSections = Sc13Facts["itemSections"];

interface ItemHeadingMatch {
  itemNumber: ItemNumber;
  start: number;
  bodyStart: number;
  line: string;
  inferredTitleOnly: boolean;
}

interface ItemSectionsResult {
  sections: Sc13ItemSections;
  warnings: string[];
}

interface ExtractedCoverValue<T> {
  value: T | null;
  raw: string | null;
}

type ExhibitReferenceSource = Sc13ExhibitReference["source"];

interface PreparedSc13Source {
  primaryText: string;
  flavor: Sc13SourceFlavor;
  warnings: string[];
  attachments: Array<Record<string, unknown>>;
  documents: Sc13Facts["sourceDocuments"];
}

interface SecSubmissionDocumentBlock {
  type: string | null;
  sequence: string | null;
  filename: string | null;
  description: string | null;
  text: string;
  raw: string;
}

const ITEM_NUMBERS: ItemNumber[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

const ITEM_TITLE_ALIASES: Record<ItemNumber, string[]> = {
  "1": ["security and issuer", "name of issuer"],
  "2": ["identity and background", "name of person filing"],
  "3": [
    "source and amount of funds or other consideration",
    "if this statement is filed pursuant to rules 13d-1(b) or 13d-2(b) or (c)",
  ],
  "4": ["purpose of transaction", "ownership"],
  "5": ["interest in securities of the issuer", "ownership of five percent or less of a class", "ownership of 5 percent or less of a class"],
  "6": [
    "contracts arrangements understandings or relationships with respect to securities of the issuer",
    "ownership of more than five percent on behalf of another person",
    "ownership of more than 5 percent on behalf of another person",
  ],
  "7": [
    "material to be filed as exhibits",
    "identification and classification of the subsidiary which acquired the security being reported on by the parent holding company",
  ],
  "8": ["identification and classification of members of the group"],
  "9": ["notice of dissolution of group"],
  "10": ["certification", "certifications"],
};

const GOVERNANCE_SOURCE_TERMS = [
  "board",
  "board representation",
  "nominate",
  "director",
  "management",
  "governance",
  "strategic alternatives",
  "sale of the issuer",
  "sale of the company",
  "merger",
  "acquisition",
  "control",
  "proxy",
  "consent solicitation",
  "capital allocation",
  "return capital",
  "engage with",
  "proposal",
  "restructuring",
  "extraordinary transaction",
];

const TRANSACTION_SOURCE_TERMS = [
  "merger",
  "sale of the issuer",
  "sale of the company",
  "acquisition",
  "tender offer",
  "support agreement",
  "voting agreement",
  "business combination",
  "strategic alternatives",
];

const LEGAL_SOURCE_TERMS = [
  "litigation",
  "lawsuit",
  "subpoena",
  "investigation",
  "settlement agreement",
  "standstill",
  "regulatory",
];

const FINANCING_SOURCE_TERMS = [
  "convertible",
  "warrant",
  "bridge financing",
  "note purchase",
  "backstop",
  "financing",
  "preferred stock",
];

const SALES_SOURCE_TERMS = ["10b5-1", "trading plan", "sales plan", "shares sold", "open market transactions"];

const AGREEMENT_TITLE_PATTERNS = [
  "Joint Filing Agreement",
  "Power of Attorney",
  "Letter Agreement",
  "Voting Agreement",
  "Support Agreement",
  "Standstill Agreement",
  "Purchase Agreement",
  "Stock Purchase Agreement",
  "Securities Purchase Agreement",
  "Subscription Agreement",
  "Debt Conversion Agreement",
  "Exchange Agreement",
  "Warrant Agreement",
  "Option Agreement",
  "Lock-Up Agreement",
  "Registration Rights Agreement",
  "Investor Rights Agreement",
  "Shareholder Agreement",
  "Consulting Agreement",
  "Employment Agreement",
  "Merger Agreement",
  "Tender and Support Agreement",
];

const CHECKED_MARKERS = ["\u2612", "\u2611", "\u2713", "\u2714", "[X]", "[x]"];
const UNCHECKED_MARKERS = ["\u2610", "\u25a1", "\u25a2", "\u00a8", "[ ]", "[  ]", "[__]"];
const SOURCE_BLOCK_CHAR_LIMIT = 5_000;
const MAX_SOURCE_BLOCKS = 60;

function prepareSc13Source(rawText: string, attachments: Sc13FilingInput["attachments"] | undefined): PreparedSc13Source {
  const flavor = detectSourceFlavor(rawText);
  const warnings: string[] = [];
  const attachmentEvidence: Array<Record<string, unknown>> = [];
  let primaryText = rawText;
  let documents: Sc13Facts["sourceDocuments"] = [];

  if (flavor === "full_submission") {
    warnings.push("Source flavor detected as full SEC submission text.");
    const submission = extractFullSubmissionPrimary(rawText);
    if (submission.documents.length > 0) {
      primaryText = submission.primary?.text ?? rawText;
      documents = submission.documents.map((document) => ({
        type: document.type,
        filename: document.filename,
        description: document.description,
        selectedPrimary: document === submission.primary,
      }));
      attachmentEvidence.push(
        ...submission.documents
          .filter((document) => document !== submission.primary)
          .map((document) => ({
            type: document.type,
            description: document.description,
            filename: document.filename,
          })),
      );
      if (submission.primary) warnings.push("Primary Schedule 13 document selected from full submission text.");
      if (submission.uncertain) warnings.push("Multiple possible primary Schedule 13 documents found; primary document selection is uncertain.");
    } else {
      warnings.push("Full submission markers were found but document blocks could not be confidently separated.");
    }
  }

  const selectedFlavor = flavor === "full_submission" ? detectSourceFlavor(primaryText) : flavor;
  if (selectedFlavor === "html" || selectedFlavor === "xml" || selectedFlavor === "rendered_xml" || selectedFlavor === "mixed") {
    warnings.push(`${formatSourceFlavor(selectedFlavor)} normalization applied before parsing.`);
    if (hasMalformedMarkup(primaryText)) warnings.push("Source contained malformed markup; normalization fallback was used.");
  }

  return {
    primaryText,
    flavor,
    warnings,
    attachments: attachmentEvidence,
    documents,
  };
}

function detectSourceFlavor(value: string): Sc13SourceFlavor {
  const sample = value.slice(0, 12000);
  if (/<SEC-DOCUMENT\b|<DOCUMENT>\s*[\s\S]*?<TYPE>/i.test(sample)) return "full_submission";
  const hasHtml = /<!doctype\s+html|<html\b|<(?:table|tr|td|th|div|p|br|span)\b/i.test(sample);
  const hasXml = /<\?xml\b|<XML>|<(?:edgarSubmission|informationTable|ownershipDocument|formData|coverPage|reportingPerson)\b/i.test(sample);
  const hasXsl = /xsl:|xmlns:|<ix:|<n1:|<sec-header/i.test(sample);
  if (hasHtml && (hasXml || hasXsl)) return "rendered_xml";
  if (hasHtml) return "html";
  if (hasXml || hasXsl) return "xml";
  if (/<[A-Za-z][^>]{0,120}>/.test(sample)) return "mixed";
  if (sample.trim()) return "plain_text";
  return "unknown";
}

function formatSourceFlavor(flavor: Sc13SourceFlavor): string {
  return flavor.replace(/_/g, " ").toUpperCase();
}

function extractFullSubmissionPrimary(rawText: string): {
  documents: SecSubmissionDocumentBlock[];
  primary: SecSubmissionDocumentBlock | null;
  uncertain: boolean;
} {
  const documents = [...rawText.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi)].map((match) => parseSubmissionDocumentBlock(match[1] ?? ""));
  const candidates = documents.filter(isPrimarySc13DocumentCandidate);
  const sorted = [...candidates].sort((a, b) => primaryDocumentScore(b) - primaryDocumentScore(a));
  const primary = sorted[0] ?? null;
  const uncertain = sorted.length > 1 && primaryDocumentScore(sorted[0]!) === primaryDocumentScore(sorted[1]!);
  return { documents, primary, uncertain };
}

function parseSubmissionDocumentBlock(block: string): SecSubmissionDocumentBlock {
  const textBlock = extractSubmissionTag(block, "TEXT") ?? "";
  return {
    type: cleanText(extractSubmissionTag(block, "TYPE")),
    sequence: cleanText(extractSubmissionTag(block, "SEQUENCE")),
    filename: cleanText(extractSubmissionTag(block, "FILENAME")),
    description: cleanText(extractSubmissionTag(block, "DESCRIPTION")),
    text: textBlock,
    raw: block,
  };
}

function extractSubmissionTag(block: string, tag: string): string | null {
  if (tag.toUpperCase() === "TEXT") {
    const textMatch = /<TEXT>\s*([\s\S]*?)<\/TEXT>/i.exec(block);
    return textMatch?.[1]?.trim() ?? null;
  }
  const pattern = new RegExp(`<${tag}>\\s*([^\\n\\r<]*)`, "i");
  const match = pattern.exec(block);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function isPrimarySc13DocumentCandidate(document: SecSubmissionDocumentBlock): boolean {
  const label = `${document.type ?? ""} ${document.filename ?? ""} ${document.description ?? ""}`;
  const body = document.text.slice(0, 20000);
  return /\b(?:SC\s+13[DG](?:\/A)?|SCHEDULE\s+13[DG](?:\/A)?)\b/i.test(label) || /\bSCHEDULE\s+13[DG](?:\/A)?\b/i.test(body);
}

function primaryDocumentScore(document: SecSubmissionDocumentBlock): number {
  const label = `${document.type ?? ""} ${document.filename ?? ""} ${document.description ?? ""}`;
  const body = document.text.slice(0, 20000);
  let score = 0;
  if (/\bSC\s+13[DG](?:\/A)?\b/i.test(document.type ?? "")) score += 100;
  if (/\bSCHEDULE\s+13[DG](?:\/A)?\b/i.test(body)) score += 40;
  if (/\bItem\s+4\b/i.test(body) || /\bItem\s+10\b/i.test(body)) score += 20;
  if (/\b(?:EX|Exhibit)\b/i.test(document.type ?? "") || /\bEX-99\b/i.test(label)) score -= 80;
  return score;
}

export function parseSc13Filing(
  filing: Sc13FilingInput,
  context: Sc13ParseContext = {},
): Sc13ParserOutput {
  const preparedSource = prepareSc13Source(filing.text ?? "", filing.attachments);
  const text = normalizeSecFilingText(preparedSource.primaryText);
  const formType = normalizeFormType(filing.formType);
  const isSupported = SUPPORTED_FORMS.has(formType);
  const scheduleType = getScheduleType(formType);
  const amendmentNumber = extractAmendmentNumber(text, formType);
  const isAmendment = /\/A$/i.test(formType) || amendmentNumber !== null;
  const ruleBasis = extractRuleBasis(text);
  const itemSectionResult = extractItemSections(text, scheduleType);
  const itemSections = itemSectionResult.sections;
  const item4Purpose = itemSections.item4;
  const item5 = itemSections.item5;
  const certification = itemSections.item10 ?? extractCertification(text);
  const reportingPersonDetails = extractReportingPersonDetails(text);
  const reportingPersons = extractReportingPersons(text, reportingPersonDetails);
  const issuerName = extractIssuerName(text) ?? cleanMetadataIssuerName(filing.issuerName ?? filing.companyName);
  const primaryTicker = {
    ticker:
      filing.primaryTicker?.ticker ??
      extractLineValue(text, [/ticker\s*:?\s*([A-Z][A-Z0-9.\-]{0,9})/i]) ??
      null,
    exchange:
      filing.primaryTicker?.exchange ??
      extractLineValue(text, [/exchange\s*:?\s*([A-Z][A-Z0-9.\- ]{1,24})/i]) ??
      null,
  };
  const explicitAggregateOwnership = extractExplicitAggregateOwnership(text);
  const hasMultipleReportingPersons = reportingPersons.length > 1;
  const percentFromChange = extractPercentChange(text);
  const percentOwned = extractPercentOwned(text, reportingPersonDetails, hasMultipleReportingPersons, explicitAggregateOwnership) ?? percentFromChange?.to ?? null;
  const previousPercentOwned = percentFromChange?.from ?? null;
  const ownershipPercentChange =
    percentOwned !== null && previousPercentOwned !== null
      ? roundTo(percentOwned - previousPercentOwned, 2)
      : null;
  const purposeText = [item4Purpose, item5, certification].filter(Boolean).join("\n");
  const passiveCertification = hasPassiveCertification(certification ?? text);
  const ordinaryCourseCertification = hasOrdinaryCourseCertification(certification ?? text);
  const item4KeywordHits = extractKeywordHits(item4Purpose ?? "", GOVERNANCE_SOURCE_TERMS, "governance", "item4");
  const transactionKeywordHits = extractKeywordHits(purposeText, TRANSACTION_SOURCE_TERMS, "transaction", "filing_text");
  const legalKeywordHits = extractKeywordHits(purposeText, LEGAL_SOURCE_TERMS, "legal", "filing_text");
  const financingKeywordHits = extractKeywordHits([itemSections.item3, item4Purpose, itemSections.item6].filter(Boolean).join("\n"), FINANCING_SOURCE_TERMS, "financing", "filing_text");
  const salesKeywordHits = extractKeywordHits(purposeText, SALES_SOURCE_TERMS, "sales", "filing_text");
  const item4HasActivistLanguage = scheduleType === "13D" && item4KeywordHits.length > 0;
  const strategicTransactionLanguage = transactionKeywordHits.length > 0;
  const legalRiskLanguage = legalKeywordHits.length > 0;
  const financingLanguage = financingKeywordHits.length > 0;
  const salesPlanLanguage = salesKeywordHits.length > 0;
  const isExitFiling = hasExitFilingLanguage(text, itemSections.item5, scheduleType, isAmendment, percentOwned);
  const finalAmendment = /\bfinal\s+amendment\b/i.test(text);
  const ownershipTableIncorporatedByReference = hasOwnershipIncorporationLanguage(item4Purpose ?? item5 ?? text);
  const exhibitReferences = extractExhibitReferences(text, itemSections, scheduleType, [...(filing.attachments ?? []), ...preparedSource.attachments]);
  const priorExhibitReferences = context.priorExhibitReferences ?? context.priorParserOutput?.facts.exhibitReferences ?? null;
  const exhibitComparison = compareExhibitReferences(exhibitReferences, priorExhibitReferences, itemSections.item7, context.priorParserOutput?.facts.itemSections.item7);

  const facts: Sc13Facts = {
    sourceFlavor: preparedSource.flavor,
    sourceDocuments: preparedSource.documents,
    issuerName: cleanText(issuerName),
    reportingPersons,
    reportingPersonDetails,
    hasMultipleReportingPersons,
    securityClass: extractSecurityClass(text),
    cusip: extractCusip(text),
    primaryTicker,
    scheduleType,
    ruleBasis,
    isAmendment,
    amendmentNumber,
    isExitFiling,
    finalAmendment,
    eventDate: cleanText(
      extractValueAfterLabel(text, [
        /date\s+of\s+event(?:\s+which\s+requires\s+filing(?:\s+of\s+this\s+statement)?)?\s*:?\s*(.*)$/i,
        /event\s+date\s*:?\s*(.*)$/i,
      ]) ?? extractValueBeforeCaption(text, /date\s+of\s+event/i),
    ),
    filingDate: filing.filedAt ?? null,
    sharesBeneficiallyOwned: extractSharesOwned(text, reportingPersonDetails, hasMultipleReportingPersons, explicitAggregateOwnership),
    percentOwned,
    previousPercentOwned,
    ownershipPercentChange,
    votingPower: {
      sole: extractPower(text, "sole", "voting", reportingPersonDetails),
      shared: extractPower(text, "shared", "voting", reportingPersonDetails),
    },
    dispositivePower: {
      sole: extractPower(text, "sole", "dispositive", reportingPersonDetails),
      shared: extractPower(text, "shared", "dispositive", reportingPersonDetails),
    },
    ownershipIntent: inferOwnershipIntent(scheduleType, passiveCertification, item4HasActivistLanguage),
    passiveCertification,
    ordinaryCourseCertification,
    sourceOfFunds: cleanText(extractValueAfterLabel(text, [/source\s+of\s+funds(?:\s+\(see\s+instructions\))?\s*:?\s*(.*)$/i])),
    reportingPersonTypes: uniqueStrings(
      reportingPersonDetails
        .map((detail) => detail.typeOfReportingPerson)
        .filter(Boolean)
        .flatMap((value) => value!.split(/\s*,\s*/).map((part) => part.trim()))
        .filter(Boolean),
    ),
    item4Purpose: truncate(cleanWhitespace(item4Purpose), 1200),
    itemSections,
    item4HasActivistLanguage,
    item4KeywordHits,
    transactionKeywordHits,
    financingKeywordHits,
    legalKeywordHits,
    salesKeywordHits,
    strategicTransactionLanguage,
    legalRiskLanguage,
    financingLanguage,
    financingAmountUsd: extractFinancingAmount(purposeText),
    salesPlanLanguage,
    salesTable: extractSalesTable(text),
    ownershipTableIncorporatedByReference,
    jointFilingAgreement: /\bjoint\s+filing\s+agreement\b/i.test(text) || /\brule\s+13d-1\(k\)\b/i.test(text),
    ownershipCalculationNotes: extractOwnershipCalculationNotes(text),
    groupMembers: extractGroupMembers(text),
    exhibitReferences,
    exhibitComparison,
  };

  const warnings = buildWarnings(facts, isSupported, text, [...preparedSource.warnings, ...itemSectionResult.warnings]);

  return {
    parserVersion: SC13_PARSER_VERSION,
    parserGroup: SC13_PARSER_GROUP,
    formType,
    accessionNumber: filing.accessionNumber ?? null,
    isSupported,
    summary: buildSummary(facts),
    cleaned_source_blocks: buildCleanedSourceBlocks(filing, facts, warnings, context.marketContext ?? null),
    facts,
    signals: [],
    calendarItems: facts.eventDate
      ? [{ date: facts.eventDate, label: "SC 13 reportable event date", source: "Date of Event" }]
      : [],
    warnings,
    raw: {
      sourceLength: text.length,
      sourceFlavor: preparedSource.flavor,
      excerpts: {
        item4: truncate(cleanWhitespace(item4Purpose), 700),
        item5: truncate(cleanWhitespace(item5), 700),
        certification: truncate(cleanWhitespace(certification), 700),
      },
    },
  };
}

export function normalizeFormType(formType: string): string {
  return formType
    .trim()
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function getScheduleType(formType: string): ScheduleType {
  if (/13D/i.test(formType)) return "13D";
  if (/13G/i.test(formType)) return "13G";
  return "unknown";
}

function buildSummary(facts: Sc13Facts): string | null {
  const reporter = facts.reportingPersons[0] ?? "A reporting person";
  const issuer = facts.issuerName ?? "the issuer";
  if (facts.isExitFiling) {
    return withPeriod(`${reporter} filed an exit Schedule ${facts.scheduleType}${facts.isAmendment ? " amendment" : ""} for ${issuer}`);
  }
  const ownership =
    facts.sharesBeneficiallyOwned !== null && facts.percentOwned !== null
      ? `${formatNumber(facts.sharesBeneficiallyOwned)} shares (${formatPercent(facts.percentOwned)})`
      : facts.percentOwned !== null
        ? `${formatPercent(facts.percentOwned)} beneficial ownership`
        : null;

  if (!ownership) return `${reporter} filed ${facts.isAmendment ? "an amended" : "a"} Schedule ${facts.scheduleType}.`;
  return withPeriod(`${reporter} reports beneficial ownership of ${ownership} of ${issuer} ${facts.securityClass ?? "securities"}`);
}

function buildCleanedSourceBlocks(
  filing: Sc13FilingInput,
  facts: Sc13Facts,
  warnings: string[],
  marketContext: Sc13ParseContext["marketContext"] = null,
): Sc13CleanedSourceBlock[] {
  const blocks: Sc13CleanedSourceBlock[] = [];

  pushSourceBlock(blocks, {
    block_type: "filing_metadata",
    title: "Filing metadata",
    source: "SEC filing package metadata",
    text: [
      `Form: ${normalizeFormType(filing.formType)}`,
      `Accession: ${filing.accessionNumber ?? "not provided"}`,
      `Filed: ${filing.filedAt ?? facts.filingDate ?? "not provided"}`,
      `Issuer: ${facts.issuerName ?? filing.issuerName ?? filing.companyName ?? "not provided"}`,
      `Ticker: ${facts.primaryTicker.ticker ?? "not provided"}`,
      `Schedule type: ${facts.scheduleType}`,
      `Amendment: ${facts.isAmendment ? "yes" : "no"}`,
    ].join("\n"),
    metadata: {
      form_type: normalizeFormType(filing.formType),
      accession_number: filing.accessionNumber ?? null,
      schedule_type: facts.scheduleType,
      is_amendment: facts.isAmendment,
    },
  });

  pushSourceBlock(blocks, {
    block_type: "source_inventory",
    title: "Source document inventory",
    source: "SEC submission document tags",
    text: facts.sourceDocuments.length
      ? facts.sourceDocuments
          .map((document, index) => {
            return `${index + 1}. ${document.type ?? "unknown"} | ${document.filename ?? "no filename"} | ${document.description ?? "no description"} | selected_primary=${document.selectedPrimary}`;
          })
          .join("\n")
      : `Source flavor: ${facts.sourceFlavor}`,
    metadata: {
      source_flavor: facts.sourceFlavor,
    },
  });

  for (const detail of facts.reportingPersonDetails.slice(0, 8)) {
    const rawText = cleanWhitespace(detail.rawSourceText) || [
      `Reporting person: ${detail.name}`,
      `Shares beneficially owned: ${detail.rawValues?.sharesBeneficiallyOwned ?? detail.sharesBeneficiallyOwned ?? "not disclosed"}`,
      `Percent owned: ${detail.rawValues?.percentOwned ?? detail.percentOwned ?? "not disclosed"}`,
      `Sole voting power: ${detail.rawValues?.soleVotingPower ?? detail.votingPower.sole ?? "not disclosed"}`,
      `Shared voting power: ${detail.rawValues?.sharedVotingPower ?? detail.votingPower.shared ?? "not disclosed"}`,
      `Sole dispositive power: ${detail.rawValues?.soleDispositivePower ?? detail.dispositivePower.sole ?? "not disclosed"}`,
      `Shared dispositive power: ${detail.rawValues?.sharedDispositivePower ?? detail.dispositivePower.shared ?? "not disclosed"}`,
    ].join("\n");

    pushSourceBlock(blocks, {
      block_type: "cover_page",
      title: `Cover page - ${detail.name}`,
      source: "Schedule 13 cover page",
      text: rawText,
      metadata: {
        reporting_person: detail.name,
      },
    });
  }

  for (const itemNumber of ITEM_NUMBERS) {
    const key = `item${itemNumber}` as keyof Sc13ItemSections;
    const text = facts.itemSections[key];
    if (!hasSubstantiveItemText(text)) continue;

    pushSourceBlock(blocks, {
      block_type: "item_section",
      title: `Item ${itemNumber} - ${itemTitleForBlock(itemNumber, facts.scheduleType)}`,
      source: `Schedule ${facts.scheduleType} Item ${itemNumber}`,
      text: text ?? "",
      metadata: {
        item_number: itemNumber,
        schedule_type: facts.scheduleType,
      },
    });
  }

  for (const reference of facts.exhibitReferences.slice(0, 20)) {
    pushSourceBlock(blocks, {
      block_type: "exhibit_reference",
      title: [reference.normalizedLabel, reference.title].filter(Boolean).join(" - ") || "Exhibit reference",
      source: reference.sourceLocation ?? reference.source,
      text: reference.rawText,
      metadata: {
        label: reference.label,
        normalized_label: reference.normalizedLabel,
        source: reference.source,
        uncertain: reference.uncertain,
        agreement_like: reference.agreementLike,
      },
    });
  }

  for (const row of facts.salesTable) {
    pushSourceBlock(blocks, {
      block_type: "sales_table_source",
      title: "Sales table source row",
      source: "Schedule 13 sales table",
      text: [
        `Date: ${row.date ?? "not disclosed"}`,
        `Reporting person: ${row.reportingPerson ?? "not disclosed"}`,
        `Shares sold: ${row.sharesSold ?? "not disclosed"}`,
        `Price range: ${row.priceRange ?? "not disclosed"}`,
        `Weighted average price: ${row.weightedAveragePrice ?? "not disclosed"}`,
      ].join("\n"),
    });
  }

  if (warnings.length > 0) {
    pushSourceBlock(blocks, {
      block_type: "parser_warning",
      title: "Parser warnings",
      source: "parser source audit",
      text: warnings.join("\n"),
    });
  }

  if (marketContext) {
    pushSourceBlock(blocks, {
      block_type: "site_context",
      title: "Market context",
      source: "fixture/site-provided market context",
      text: JSON.stringify(marketContext, null, 2),
    });
  }

  return blocks.slice(0, MAX_SOURCE_BLOCKS);
}

function pushSourceBlock(blocks: Sc13CleanedSourceBlock[], block: Sc13CleanedSourceBlock): void {
  const text = cleanWhitespace(block.text);
  if (!text) return;

  const trimmed = text.length > SOURCE_BLOCK_CHAR_LIMIT ? `${text.slice(0, SOURCE_BLOCK_CHAR_LIMIT).trim()} ...` : text;
  if (blocks.some((candidate) => candidate.block_type === block.block_type && candidate.title === block.title && candidate.text === trimmed)) {
    return;
  }

  blocks.push({
    ...block,
    text: trimmed,
  });
}

function itemTitleForBlock(itemNumber: ItemNumber, scheduleType: ScheduleType): string {
  return titleAliasesForItem(itemNumber, scheduleType)[0] ?? "Source section";
}

function buildWarnings(facts: Sc13Facts, isSupported: boolean, sourceText: string, itemWarnings: string[] = []): string[] {
  const warnings: string[] = [...itemWarnings];
  if (!isSupported) warnings.push("Unsupported SC 13 form type.");
  if (!facts.issuerName) warnings.push("Issuer name was not found in the filing text.");
  if (facts.reportingPersons.length === 0) warnings.push("Reporting person was not found in the filing text.");
  if (facts.scheduleType === "13D" && !facts.isAmendment && !facts.item4Purpose) warnings.push("Item 4 purpose text was not found.");
  if (hasOwnershipRows(sourceText) && facts.reportingPersonDetails.length === 0) {
    warnings.push("Ownership rows were found but reporting person cover-page boundaries were not confidently detected.");
  }
  if (facts.hasMultipleReportingPersons) {
    warnings.push("Multiple reporting persons found; do not sum ownership rows unless the filing states an aggregate.");
  }
  if (facts.reportingPersons.length > 1 && facts.reportingPersonDetails.length === 1) {
    warnings.push("Multiple reporting persons were found but only one cover-page ownership block was extracted.");
  }
  const coverBlockCount = extractReportingPersonBlocks(sourceText).length;
  if (coverBlockCount > facts.reportingPersonDetails.length) {
    warnings.push("At least one malformed cover-page block was skipped during reporting-person extraction.");
  }
  if (facts.ownershipTableIncorporatedByReference) {
    warnings.push("Ownership section incorporates cover-page rows by reference.");
  }
  if (facts.reportingPersonDetails.some((detail) => detail.groupCheckbox.a === true || detail.groupCheckbox.b === true)) {
    warnings.push("At least one cover page has a checked group-membership checkbox.");
  }
  if (facts.reportingPersonDetails.some((detail) => detail.excludesCertainShares)) {
    warnings.push("At least one cover page indicates Row 11 excludes certain shares.");
  }
  for (const detail of facts.reportingPersonDetails) {
    if (isStarOrFootnoteOnly(detail.rawValues?.percentOwned)) {
      warnings.push(`Percent of class for ${detail.name} is a star-only or footnote-only cover-page value.`);
    }
    if (hasUnresolvedShareFootnote(detail.rawValues?.sharesBeneficiallyOwned)) {
      warnings.push(`Share count for ${detail.name} contains unresolved footnote markers.`);
    }
  }
  for (const warning of duplicateReportingPersonWarnings(facts.reportingPersonDetails)) {
    warnings.push(warning);
  }
  const itemPercent = extractPercentFromOwnershipText([facts.itemSections.item5, facts.itemSections.item4].filter(Boolean).join("\n"));
  if (facts.percentOwned !== null && itemPercent !== null && Math.abs(facts.percentOwned - itemPercent) > 0.01) {
    warnings.push("Cover-page percent of class conflicts with ownership percentage stated in item text.");
  }
  if (hasSubstantiveItemText(facts.itemSections.item6)) {
    warnings.push("Item 6 appears non-empty; preserve source text for review.");
  }
  if (facts.scheduleType === "13G" && hasSubstantiveItemText(facts.itemSections.item8)) {
    warnings.push("Item 8 appears non-empty in this Schedule 13G.");
  }
  if (facts.scheduleType === "13G" && hasSubstantiveItemText(facts.itemSections.item9)) {
    warnings.push("Item 9 appears non-empty in this Schedule 13G.");
  }
  if (facts.scheduleType === "13G" && !facts.itemSections.item10 && !extractCertification(sourceText)) {
    warnings.push("Schedule 13G certification section was not found.");
  }
  if (
    facts.scheduleType === "13G" &&
    facts.itemSections.item10 &&
    !hasPassiveCertification(facts.itemSections.item10) &&
    !hasOrdinaryCourseCertification(facts.itemSections.item10)
  ) {
    warnings.push("Schedule 13G Item 10 certification text differs from the expected certification pattern.");
  }
  if (facts.ownershipCalculationNotes.some((note) => /warrant|convertible|as-converted|beneficial ownership limitation/i.test(note))) {
    warnings.push("Ownership calculation includes derivative, conversion, or ownership-cap language.");
  }
  warnings.push(...buildExhibitWarnings(facts));
  return uniqueStrings(warnings);
}

function hasOwnershipRows(text: string): boolean {
  return /(?:sole|shared)\s+(?:voting|dispositive)\s+power|aggregate\s+(?:amount\s+)?beneficially\s+owned|percent\s+of\s+class/i.test(text);
}

function isStarOrFootnoteOnly(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^\s*(?:\*+|[*†‡]|\(\s*\*+\s*\))\s*$/.test(value);
}

function hasUnresolvedShareFootnote(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (isStarOrFootnoteOnly(trimmed)) return true;
  return /[\d,]+(?:\.\d+)?\s*(?:shares?)?\s*(?:\*+|†|‡|\(\d+\))$/i.test(trimmed);
}

function duplicateReportingPersonWarnings(details: Sc13ReportingPersonFact[]): string[] {
  const warnings: string[] = [];
  const byName = new Map<string, Sc13ReportingPersonFact[]>();
  for (const detail of details) {
    const key = detail.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), detail]);
  }

  for (const sameNameDetails of byName.values()) {
    if (sameNameDetails.length < 2) continue;
    const name = sameNameDetails[0]!.name;
    if (sameNameDetails.some((detail) => detail.sharesBeneficiallyOwned !== sameNameDetails[0]!.sharesBeneficiallyOwned)) {
      warnings.push(`Duplicate cover pages for ${name} have conflicting aggregate ownership values.`);
    }
    if (sameNameDetails.some((detail) => detail.percentOwned !== sameNameDetails[0]!.percentOwned)) {
      warnings.push(`Duplicate cover pages for ${name} have conflicting percent-of-class values.`);
    }
  }

  return warnings;
}

function extractPercentFromOwnershipText(text: string): number | null {
  if (!text) return null;
  const explicit = /(?:representing|represented|beneficially\s+owns?)[^.]{0,180}?(-?\d+(?:\.\d+)?)\s*%/i.exec(text);
  return explicit?.[1] ? Number.parseFloat(explicit[1]) : null;
}

function hasSubstantiveItemText(value: string | null): boolean {
  const cleaned = cleanText(value);
  if (!cleaned) return false;
  return !/^(?:not applicable|none|n\/a|no|there are no(?:ne)?)(?:[.\s]|$)/i.test(cleaned);
}

function buildExhibitWarnings(facts: Sc13Facts): string[] {
  const warnings: string[] = [];
  const item7Text = facts.itemSections.item7;
  const item6Text = facts.itemSections.item6;
  const item7Exhibits = facts.exhibitReferences.filter((reference) => reference.source === "item7");
  const bodyExhibits = facts.exhibitReferences.filter((reference) => reference.source === "body");
  const attachmentExhibits = facts.exhibitReferences.filter((reference) => reference.source === "attachment");

  if (facts.scheduleType === "13D") {
    if (!item7Text) warnings.push("Item 7 exhibit section was not found in this Schedule 13D.");
    if (item7Text && isNoExhibitsText(item7Text)) warnings.push("Item 7 states that no exhibits are filed.");
    if (item7Exhibits.length > 0) warnings.push("Schedule 13D Item 7 contains exhibit references.");
    if (bodyExhibits.length > 0 && item7Exhibits.length === 0) {
      warnings.push("Exhibit reference exists in body text but not in Item 7.");
    }
    if (hasSubstantiveItemText(item6Text) && (!item7Text || isNoExhibitsText(item7Text))) {
      warnings.push("Item 6 appears non-empty but Item 7 is missing or states no exhibits.");
    }
    if (item7Exhibits.some((reference) => reference.agreementLike) && !hasSubstantiveItemText(item6Text)) {
      warnings.push("Item 7 lists agreement-like exhibit titles while Item 6 appears empty.");
    }
  } else if (facts.scheduleType === "13G" && hasSubstantiveItemText(item7Text)) {
    warnings.push("Schedule 13G Item 7 contains substantive text but is not treated as an exhibit section.");
  }

  if (attachmentExhibits.some((reference) => !item7Exhibits.some((item7) => sameExhibitLabel(item7, reference)))) {
    warnings.push("Document inventory mentions an exhibit not found in Item 7.");
  }

  for (const reference of facts.exhibitReferences) {
    if (reference.uncertain) warnings.push("Exhibit title is incomplete or ambiguous.");
    if (reference.agreementLike) warnings.push("Agreement-like exhibit title detected.");
  }

  for (const label of duplicateExhibitLabels(facts.exhibitReferences)) {
    warnings.push(`Duplicate exhibit label found: ${label}.`);
  }

  if (facts.exhibitComparison) {
    if (facts.exhibitComparison.added.length > 0) warnings.push("Prior/current exhibit comparison found added exhibit references.");
    if (facts.exhibitComparison.removed.length > 0) warnings.push("Prior/current exhibit comparison found removed exhibit references.");
    if (facts.exhibitComparison.changedTitles.length > 0) warnings.push("Prior/current exhibit comparison found changed exhibit titles.");
    if (facts.exhibitComparison.item7Changed) warnings.push("Prior/current exhibit comparison found Item 7 text changed.");
  }

  return warnings;
}

function extractKeywordHits(
  text: string,
  keywords: string[],
  category: Sc13KeywordHit["category"],
  source: Sc13KeywordHit["source"],
): Sc13KeywordHit[] {
  const hits: Sc13KeywordHit[] = [];
  for (const keyword of keywords) {
    const pattern = new RegExp(`\\b${escapeRegExp(keyword).replace(/\s+/g, "\\s+")}\\b`, "i");
    const match = pattern.exec(text);
    if (!match) continue;
    hits.push({
      category,
      keyword,
      source,
      evidence: extractEvidenceAround(text, match.index, keyword.length),
    });
  }
  return hits;
}

function extractEvidenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + length + 120);
  return truncate(cleanWhitespace(text.slice(start, end)), 280) ?? "";
}

function extractReportingPersons(text: string, reportingPersonDetails: Sc13ReportingPersonFact[]): string[] {
  if (reportingPersonDetails.length > 0) {
    const groupLine = extractLineValue(text, [/group\s+members\s*:?\s*(.+)/i]);
    const groupMembers = groupLine ? splitNames(groupLine) : [];
    return uniqueStrings(
      [...reportingPersonDetails.map((detail) => detail.name), ...groupMembers]
        .map((value) => cleanReportingPersonName(value))
        .map(cleanText)
        .filter((value) => value && !isReportingPersonNameNoise(value)) as string[],
    );
  }

  const values = extractAllLineValues(text, [
    /name\s+of\s+reporting\s+person\s*:?\s*(.+)/gi,
  ]);
  const labelValues = extractAllValuesAfterLabel(text, [
    /names?\s+of\s+reporting\s+persons?\s*:?\s*(.*)$/i,
    /name\s+of\s+reporting\s+person\s*:?\s*(.*)$/i,
    /name\s+of\s+person\s+filing\s*:?\s*(.*)$/i,
  ]);
  const groupLine = extractLineValue(text, [/group\s+members\s*:?\s*(.+)/i]);
  const groupMembers = groupLine ? splitNames(groupLine) : [];
  const directPersons = [
    ...reportingPersonDetails.map((detail) => detail.name),
    ...values,
    ...labelValues,
    ...extractItem2ReportingPersons(text),
    ...groupMembers,
  ];
  const signaturePersons = directPersons.length ? [] : extractSignatureReportingPersons(text);
  return uniqueStrings(
    [
      ...directPersons,
      ...signaturePersons,
    ]
      .map((value) => cleanReportingPersonName(value))
      .map(cleanText)
      .filter(Boolean) as string[],
  );
}

function extractItem2ReportingPersons(text: string): string[] {
  const item2 = extractItemSection(text, "2") ?? text;
  const candidates = [
    /(?:statement\s+on\s+Schedule\s+13D\s+is\s+being\s+filed\s+by|statement\s+is\s+being\s+filed\s+by)\s+(?:Mr\.|Ms\.|Mrs\.)?\s*([^,.;\n]+?)(?:,|\s+the\s+(?:holder|Reporting\s+Person)\b)/i.exec(item2)?.[1],
    /(?:This\s+Schedule\s+13D\s+is\s+filed\s+by)\s+(?:Mr\.|Ms\.|Mrs\.)?\s*([^,.;\n]+?)(?:,|\s+the\s+(?:holder|Reporting\s+Person)\b)/i.exec(item2)?.[1],
  ];
  return candidates
    .map((candidate) => cleanReportingPersonName(candidate ?? ""))
    .map(cleanText)
    .filter((candidate) => candidate && !isReportingPersonNameNoise(candidate)) as string[];
}

function extractReportingPersonDetails(text: string): Sc13ReportingPersonFact[] {
  const blocks = extractReportingPersonBlocks(text);
  return blocks
    .map((block) => {
      const citizenship = extractCoverTextValue(block, [
        /citizenship\s+or\s+place\s+of\s+organization\s*:?\s*(.*)$/i,
        /citizenship\s*:?\s*(.*)$/i,
      ]);
      const sourceOfFunds = extractCoverTextValue(block, [/source\s+of\s+funds(?:\s+\(see\s+instructions\))?\s*:?\s*(.*)$/i]);
      const typeOfReportingPerson = extractCoverTextValue(block, [
        /type\s+of\s+reporting\s+person(?:\s+\(see\s+instructions\))?\s*:?\s*(.*)$/i,
      ]);
      const sharesBeneficiallyOwned =
        extractAggregateSharesValue(block) ??
        extractCoverNumberValue(block, [
          /(?:\d+\.?\s*)?aggregate\s+amount\s+beneficially\s+owned(?:\s+by\s+each\s+reporting\s+person)?\s*:?\s*(.*)$/i,
          /(?:\d+\.?\s*)?owned\s+by\s+each\s+reporting\s+person\s*:?\s*(.*)$/i,
        ]);
      const percentOwned =
        extractPercentOfClassValue(block) ??
        extractCoverPercentValue(block, [
          /percent\s+of\s+class(?:\s+represented\s+by\s+amount\s+in\s+row\s+\(?\d+\)?)?\s*:?\s*(.*)$/i,
          /represented\s+by\s+amount\s+in\s+row\s+\(?\d+\)?\s*:?\s*(.*)$/i,
          /percent\s+of\s+class\s*:?\s*(.*)$/i,
        ]);
      const soleVotingPower =
        extractOwnershipPowerValue(block, "sole", "voting") ??
        extractCoverNumberValue(block, [/sole\s+voting\s+power\s*:?\s*(.*)$/i]);
      const sharedVotingPower =
        extractOwnershipPowerValue(block, "shared", "voting") ??
        extractCoverNumberValue(block, [/shared\s+voting\s+power\s*:?\s*(.*)$/i]);
      const soleDispositivePower =
        extractOwnershipPowerValue(block, "sole", "dispositive") ??
        extractCoverNumberValue(block, [/sole\s+dispositive\s+power\s*:?\s*(.*)$/i]);
      const sharedDispositivePower =
        extractOwnershipPowerValue(block, "shared", "dispositive") ??
        extractCoverNumberValue(block, [/shared\s+dispositive\s+power\s*:?\s*(.*)$/i]);
      const name =
        extractReportingPersonName(block) ??
        extractValueAfterLabel(block, [
          /names?\s+of\s+reporting\s+persons?\s*:?\s*(.*)$/i,
          /name\s+of\s+reporting\s+person\s*:?\s*(.*)$/i,
        ]) ?? extractLineValue(block, [/name\s+of\s+reporting\s+person\s*:?\s*(.+)/i]);
      const cleanName = cleanText(name);
      if (!cleanName || isReportingPersonNameNoise(cleanName)) return null;
      const hasCoverValue =
        citizenship.value !== null ||
        sourceOfFunds.value !== null ||
        typeOfReportingPerson.value !== null ||
        sharesBeneficiallyOwned.raw !== null ||
        percentOwned.raw !== null ||
        soleVotingPower.raw !== null ||
        sharedVotingPower.raw !== null ||
        soleDispositivePower.raw !== null ||
        sharedDispositivePower.raw !== null;
      if (!hasCoverValue && isSignatureReportingPersonBlock(block)) return null;
      return {
        name: cleanReportingPersonName(cleanName),
        citizenshipOrOrganization: cleanText(citizenship.value),
        sourceOfFunds: cleanText(sourceOfFunds.value),
        typeOfReportingPerson: cleanText(typeOfReportingPerson.value),
        sharesBeneficiallyOwned: sharesBeneficiallyOwned.value,
        percentOwned: percentOwned.value,
        votingPower: {
          sole: soleVotingPower.value,
          shared: sharedVotingPower.value,
        },
        dispositivePower: {
          sole: soleDispositivePower.value,
          shared: sharedDispositivePower.value,
        },
        groupCheckbox: extractGroupCheckbox(block),
        excludesCertainShares: extractCheckedStateNear(block, /excludes?\s+certain\s+shares/i),
        comments: cleanText(
          extractValueAfterLabel(block, [/comment\s+for\s+type\s+of\s+reporting\s+person\s*:?\s*(.*)$/i]),
        ),
        rawSourceText: truncate(cleanWhitespace(block), 1200),
        rawValues: {
          citizenshipOrOrganization: citizenship.raw,
          sourceOfFunds: sourceOfFunds.raw,
          typeOfReportingPerson: typeOfReportingPerson.raw,
          sharesBeneficiallyOwned: sharesBeneficiallyOwned.raw,
          percentOwned: percentOwned.raw,
          soleVotingPower: soleVotingPower.raw,
          sharedVotingPower: sharedVotingPower.raw,
          soleDispositivePower: soleDispositivePower.raw,
          sharedDispositivePower: sharedDispositivePower.raw,
        },
      };
    })
    .filter(Boolean) as Sc13ReportingPersonFact[];
}

function extractReportingPersonBlocks(text: string): string[] {
  const normalized = normalizeNewlines(text);
  const marker =
    /(?:^|\n)\s*(?:\(?\d+\)?\.?\s*)?(?:\([a-z]\)\s*)?(?:names?\s+of\s+reporting\s+persons?|name\s+of\s+reporting\s+person)\b[^\n]*/gi;
  const matches = [...normalized.matchAll(marker)];
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? findSectionStartAfter(normalized, start) ?? normalized.length;
    return normalized.slice(start, end);
  });
}

function extractReportingPersonName(block: string): string | null {
  const lines = normalizeNewlines(block).split("\n");
  const markerIndex = lines.findIndex((line) => /(?:names?\s+of\s+reporting\s+persons?|name\s+of\s+reporting\s+person)\b/i.test(line));
  if (markerIndex < 0) return null;

  const markerLine = lines[markerIndex] ?? "";
  const inline = cleanFieldValue(
    stripReportingPersonInlineBoilerplate(
      markerLine.replace(/^.*?(?:names?\s+of\s+reporting\s+persons?|name\s+of\s+reporting\s+person)\b\.?/i, ""),
    ),
  );
  const cleanedInline = inline ? cleanReportingPersonName(inline) : null;
  if (cleanedInline && !isBoilerplateLine(cleanedInline) && !isReportingPersonNameNoise(cleanedInline)) {
    return cleanedInline;
  }

  const parts: string[] = [];
  for (let index = markerIndex + 1; index < lines.length && parts.length < 4; index += 1) {
    const candidate = cleanFieldValue(lines[index]);
    if (!candidate) continue;
    if (parts.length > 0 && isCoverRowBoundary(candidate)) break;
    if (isBoilerplateLine(candidate)) continue;
    if (isCoverRowBoundary(candidate)) {
      break;
    }
    if (isReportingPersonNameNoise(candidate)) continue;
    parts.push(candidate);
  }

  return parts.length > 0 ? cleanReportingPersonName(parts.join(" ")) : null;
}

function stripReportingPersonInlineBoilerplate(value: string): string {
  return value
    .replace(/^\s*[.\-:|]*\s*(?:I\.?R\.?S\.?|IRS)\s*IDENTIFICATION\s+NOS?\.?\s+OF\s+ABOVE\s+PERSONS?(?:\s*\([^)]*\))?\.?\s*/i, "")
    .replace(
      /^\s*[.\-:|]*\s*(?:S\.?S\.?\s+or\s+)?(?:I\.?R\.?S\.?|IRS)\s*(?:IDENTIFICATION\s+)?(?:NO\.?|NUMBER)\s*(?:OF\s+ABOVE\s+PERSONS?)?(?:\s*\([^)]*\))?\.?\s*/i,
      "",
    );
}

function cleanReportingPersonName(value: string): string {
  return value
    .replace(/^[.\s|]+/, "")
    .replace(/\s+\/s\/[\s\S]*$/i, "")
    .replace(/\s+\d+\s*\|\s*SEC\s+use\s+only[\s\S]*$/i, "")
    .replace(/\s*\|\s*SEC\s+use\s+only[\s\S]*$/i, "")
    .replace(/\s+\d+\s*\|\s*(?:check|citizenship|source\s+of\s+funds|sole\s+voting|shared\s+voting|sole\s+dispositive|shared\s+dispositive|aggregate\s+amount|percent\s+of\s+class|type\s+of\s+reporting)[\s\S]*$/i, "")
    .replace(/\s+\d+\.?\s*check\s+the\s+appropriate\s+box[\s\S]*$/i, "")
    .replace(/\s+(?:\([ab]\)|[ab]\.)\s*(?:\u2610|\u2611|\u2612|\u25a1|\u25a2|\u00a8|\[[ xX_]*\]|[xXoO]).*$/i, "")
    .replace(/\s*,?\s*(?:I\.?R\.?S\.?|IRS)\s*(?:identification\s+)?(?:no\.?|number)?\s*:?.*$/i, "")
    .replace(/\s+S\.S\.\s+or\s+I\.R\.S\.[\s\S]*$/i, "")
    .replace(/\s+\d{2}-\d{7,}\b.*$/i, "")
    .replace(/\s+\d{9}\b.*$/i, "")
    .replace(/\s*,?\s+\d+\s+not\s+applicable.*$/i, "")
    .replace(/\s+\d+\s+check\s+the\s+appropriate\s+box[\s\S]*$/i, "")
    .replace(/\s+\(?a\)?\s*[\u2610\u2611\u2612\u25a1\u25a2\u00a8xXoO]?\s*\(?b\)?\s*[\u2610\u2611\u2612\u25a1\u25a2\u00a8xXoO]?.*$/i, "")
    .replace(/\s+-\s+\d{2}-\d{7,}.*/, "")
    .replace(/\s+\d{2}-\d{7,}$/, "")
    .replace(/\s*\|\s*(?:\(?\d+\)?\.?\s*\|\s*)+$/g, "")
    .replace(/\s+(?:\(?\d+\)?\.?\s*){1,4}$/g, "")
    .replace(/\s*\|+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMetadataIssuerName(value: string | null | undefined): string | null {
  const cleaned = cleanIssuerName(value);
  if (!cleaned) return null;
  return cleanText(
    cleaned
      .replace(/\s+\((?:Subject|Issuer|Filer|Filed\s+by)\)\s+CIK\s*:?.*$/i, "")
      .replace(/\s+\((?:Subject|Issuer|Filer|Filed\s+by)\).*$/i, "")
      .replace(/\s+CIK\s*:?.*$/i, "")
      .replace(/\s+files\s+SCHEDULE\s+13[DG](?:\/A)?\s*$/i, ""),
  );
}

function isSignatureReportingPersonBlock(value: string): boolean {
  return /\/s\/|signature|authorized\s+signatory|chief\s+\w+\s+officer|managing\s+director|\b\d{1,2}\/\d{1,2}\/\d{4}\b/i.test(
    value,
  );
}

function isReportingPersonNameNoise(value: string): boolean {
  const cleaned = cleanText(value) ?? "";
  return (
    cleaned.length < 3 ||
    /^[A-Z]{1,3}$/.test(cleaned) ||
    /^\(?[ab]\)?\s*(?:\u2610|\u2611|\u2612|\u25a1|\u25a2|\u00a8|\[[ xX_]*\]|[xXoO])?$/i.test(cleaned) ||
    /I\.R\.S\.\s+Identification/i.test(cleaned) ||
    /check\s+the\s+appropriate\s+box/i.test(cleaned) ||
    /(?:I\.?R\.?S\.?|IRS)\s*(?:identification\s+)?(?:no\.?|number)?/i.test(cleaned) ||
    /NOS?\.?\s+OF\s+ABOVE\s+PERSONS/i.test(cleaned) ||
    /NUMBER\s+OF\s+SHARES\s+BENEFICIALLY\s+OWNED/i.test(cleaned) ||
    /^\d{2}-\d{7,}$/.test(cleaned) ||
    /^\d{9}$/.test(cleaned) ||
    /IDENTIFICATION\s+NO\.\s+OF\s+ABOVE\s+PERSON/i.test(cleaned) ||
    /S\.S\.\s+or\s+I\.R\.S/i.test(cleaned) ||
    /^of\s+above\s+person/i.test(cleaned)
  );
}

function isCoverRowBoundary(value: string): boolean {
  return /^(?:\(?\d+\)?\.?\s*)?(?:\([a-z]\)\s*)?(?:check|tax\s+id|sec\s+use|source\s+of\s+funds|citizenship|sole\s+voting|shared\s+voting|sole\s+dispositive|shared\s+dispositive|aggregate\s+amount|number\s+of\s+shares|percent\s+of\s+class|type\s+of\s+reporting|cusip|item\s+\d+)/i.test(
    value,
  );
}

function extractSignatureReportingPersons(text: string): string[] {
  const signatureStart = /\n\s*SIGNATURES?\b/i.exec(text)?.index;
  if (signatureStart === undefined) return [];

  const lines = normalizeNewlines(text.slice(signatureStart)).split("\n");
  const persons: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const value = cleanReportingPersonName(buffer.join(" "));
    if (value && !isReportingPersonNameNoise(value)) persons.push(value);
    buffer = [];
  };

  for (const rawLine of lines.slice(0, 260)) {
    const line = cleanFieldValue(rawLine);
    if (!line) {
      flush();
      continue;
    }

    if (isSignatureBoilerplateLine(line)) {
      flush();
      continue;
    }

    if (isLikelySignatureReportingPersonLine(line)) {
      buffer.push(line);
      continue;
    }

    flush();
  }
  flush();

  return uniqueStrings(persons);
}

function isSignatureBoilerplateLine(value: string): boolean {
  return (
    /^SIGNATURES?$/i.test(value) ||
    /^Dated?:/i.test(value) ||
    /^After\s+reasonable\s+inquiry/i.test(value) ||
    /^to\s+the\s+best\s+of/i.test(value) ||
    /^in\s+this\s+statement/i.test(value) ||
    /^By:?$/i.test(value) ||
    /^By:/i.test(value) ||
    /^\/s\//i.test(value) ||
    /^Name:/i.test(value) ||
    /^Title:/i.test(value) ||
    /^its\s+/i.test(value) ||
    /,\s*its\s+/i.test(value) ||
    /^\[Signature\s+Page/i.test(value)
  );
}

function isLikelySignatureReportingPersonLine(value: string): boolean {
  if (value.length < 3 || value.length > 90) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/[a-z]/.test(value) && !/\b(?:Inc\.?|Corp\.?|Corporation|LLC|L\.L\.C\.|Ltd\.?|PLC|LP|L\.P\.|Holdings|Enterprises|Partners)\b/.test(value)) {
    return false;
  }
  return /^[A-Z0-9 .,&'/-]+$/.test(value);
}

function extractIssuerName(text: string): string | null {
  const candidates = [
    extractValueBeforeCaption(text, /name\s+of\s+issuer/i),
    extractValueAfterLabel(text, [/name\s+of\s+issuer\s*:?\s*(.*)$/i]),
    extractValueAfterLabel(extractItemSection(text, "1") ?? "", [/name\s+of\s+issuer\s*:?\s*(.*)$/i]),
    extractIssuerNameFromNarrative(text),
  ];

  for (const candidate of candidates) {
    const cleaned = cleanIssuerName(candidate);
    if (cleaned && !isBoilerplateLine(cleaned) && !looksLikeCusip(cleaned)) return cleaned;
  }
  return null;
}

function extractIssuerNameFromNarrative(text: string): string | null {
  const patterns = [
    /(?:shares?|securities)\s+of\s+([A-Z][^.\n]{2,140}?),\s+(?:a|an)\s+[A-Za-z ]+\s+(?:corporation|company|limited|plc|inc\.?)\s+\(?(?:the\s+)?["']?Issuer/i,
    /issued\s+by\s+([A-Z][^.\n]{2,140}?)(?:,|\s+\(?(?:the\s+)?["']?Issuer)/i,
    /(?:the\s+["']?Issuer["']?\)?),?\s+([A-Z][^.\n]{2,140}?)(?:,|\.)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = cleanIssuerName(match?.[1]);
    if (value && !looksLikeCusip(value)) return value;
  }
  return null;
}

function extractSecurityClass(text: string): string | null {
  const candidates = [
    extractValueBeforeCaption(text, /title\s+of\s+class\s+of\s+securities/i),
    extractValueAfterStandaloneLabel(text, /title\s+of\s+class\s+of\s+securities/i),
    extractValueAfterLabel(text, [
      /item\s*2\(d\)\s*title\s+of\s+class\s+of\s+securities\s*:?\s*(.*)$/i,
      /title\s+of\s+class\s+of\s+securities\s*:?\s*(.*)$/i,
      /class\s+of\s+securities\s*:?\s*(.*)$/i,
    ]),
  ];

  for (const candidate of candidates) {
    const cleaned = cleanText(candidate);
    if (
      cleaned &&
      !cleaned.startsWith(",") &&
      !/^ticker\s*:|^exchange\s*:/i.test(cleaned) &&
      !isBoilerplateLine(cleaned) &&
      !looksLikeCusip(cleaned)
    ) {
      return cleaned;
    }
  }
  return null;
}

function extractValueAfterStandaloneLabel(text: string, labelPattern: RegExp): string | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanFieldValue(lines[index] ?? "") ?? "";
    labelPattern.lastIndex = 0;
    if (!labelPattern.test(line)) continue;
    return nextMeaningfulLine(lines, index + 1);
  }
  return null;
}

function extractGroupMembers(text: string): string[] {
  const groupLine = extractLineValue(text, [/group\s+members\s*:?\s*(.+)/i]);
  return groupLine ? splitNames(groupLine).map(cleanText).filter(Boolean) as string[] : [];
}

function extractLineValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match?.[1]) return match[1].split(/\r?\n/)[0].trim();
  }
  return null;
}

function extractValueAfterLabel(text: string, patterns: RegExp[]): string | null {
  return extractAllValuesAfterLabel(text, patterns)[0] ?? null;
}

function extractAllValuesAfterLabel(text: string, patterns: RegExp[]): string[] {
  const lines = normalizeNewlines(text).split("\n");
  const values: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (isBoilerplateLine(line) && !line.includes(":")) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(line);
      if (!match) continue;

      const inlineValue = cleanFieldValue(match[1] ?? "");
      if (inlineValue && !isBoilerplateLine(inlineValue)) {
        values.push(inlineValue);
        continue;
      }

      const nextValue = nextMeaningfulLine(lines, index + 1);
      if (nextValue) values.push(nextValue);
    }
  }

  return uniqueStrings(values);
}

function extractValueBeforeCaption(text: string, captionPattern: RegExp): string | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    captionPattern.lastIndex = 0;
    if (!captionPattern.test(lines[index] ?? "")) continue;
    if ((lines[index] ?? "").includes(":")) continue;
    if (!(lines[index] ?? "").includes(")")) continue;

    const first = previousMeaningfulLine(lines, index - 1);
    if (!first) continue;

    const parts = [first.value];
    let cursor = first.index - 1;
    while (cursor >= 0 && parts.length < 3) {
      const candidate = cleanFieldValue(lines[cursor] ?? "");
      if (!candidate) {
        if (parts.length > 0) break;
        continue;
      }
      if (isBoilerplateLine(candidate)) {
        if (parts.length > 0) break;
        continue;
      }
      if (!shouldPrependCaptionContinuation(candidate, parts[0] ?? "")) break;
      parts.unshift(candidate);
      cursor -= 1;
    }
    if (parts.length > 0) return parts.join(" ");
  }
  return null;
}

function extractAllLineValues(text: string, patterns: RegExp[]): string[] {
  const values: string[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match?.[1]) {
      values.push(match[1].split(/\r?\n/)[0].trim());
      match = pattern.exec(text);
    }
  }
  return values;
}

function extractItemSections(text: string, scheduleType: ScheduleType): ItemSectionsResult {
  const normalized = normalizeItemMarkers(text);
  const sections = emptyItemSections();
  const warnings: string[] = [];
  const headings = collectItemHeadings(normalized, scheduleType, warnings);

  if (headings.length === 0) {
    warnings.push("No Item section headings were found in the filing text.");
    return { sections, warnings: uniqueStrings(warnings) };
  }

  const seen = new Set<ItemNumber>();
  const duplicateItems = new Set<ItemNumber>();
  for (const heading of headings) {
    if (seen.has(heading.itemNumber)) duplicateItems.add(heading.itemNumber);
    seen.add(heading.itemNumber);
  }

  for (const duplicate of duplicateItems) {
    warnings.push(`Duplicate Item ${duplicate} headings found; parser used the first detected span.`);
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (sections[`item${heading.itemNumber}` as keyof Sc13ItemSections] !== null) continue;
    const nextHeading = headings.slice(index + 1).find((candidate) => candidate.itemNumber !== heading.itemNumber);
    const nextStart = nextHeading?.start ?? findSignatureStart(normalized, heading.bodyStart) ?? normalized.length;
    const body = normalized.slice(heading.bodyStart, nextStart);
    sections[`item${heading.itemNumber}` as keyof Sc13ItemSections] = cleanText(body);
  }

  for (const itemNumber of ITEM_NUMBERS) {
    const key = `item${itemNumber}` as keyof Sc13ItemSections;
    if (sections[key] !== null) continue;
    const fallback = extractLooseItemSection(normalized, itemNumber);
    if (!fallback) continue;
    sections[key] = fallback;
    warnings.push(`Item ${itemNumber} boundary recovered from a loose source heading pattern.`);
  }

  for (let index = 1; index < headings.length; index += 1) {
    const previous = Number.parseInt(headings[index - 1]!.itemNumber, 10);
    const current = Number.parseInt(headings[index]!.itemNumber, 10);
    if (current > previous + 1) {
      const interveningRecovered = ITEM_NUMBERS.some((itemNumber) => {
        const numeric = Number.parseInt(itemNumber, 10);
        return numeric > previous && numeric < current && sections[`item${itemNumber}` as keyof Sc13ItemSections] !== null;
      });
      if (interveningRecovered) continue;
      warnings.push(
        `Item boundary sequence jumps from Item ${previous} to Item ${current}; intervening item boundaries may be omitted or not recognized.`,
      );
    }
  }

  return { sections, warnings: uniqueStrings(warnings) };
}

function extractLooseItemSection(text: string, itemNumber: ItemNumber): string | null {
  const pattern = new RegExp(
    `(?:^|\\n|\\s)item\\s*${itemNumber}\\s*(?:\\.|:)([\\s\\S]*?)(?=(?:^|\\n|\\s)item\\s*(?:[1-9]|10)\\s*(?:\\.|:)|\\n\\s*SIGNATURES?\\b|$)`,
    "i",
  );
  const match = pattern.exec(text);
  return cleanText(match?.[1] ?? null);
}

function extractItemSection(text: string, itemNumber: string): string | null {
  if (!isItemNumber(itemNumber)) return null;
  return extractItemSections(text, "unknown").sections[`item${itemNumber}` as keyof Sc13ItemSections];
}

function emptyItemSections(): Sc13ItemSections {
  return {
    item1: null,
    item2: null,
    item3: null,
    item4: null,
    item5: null,
    item6: null,
    item7: null,
    item8: null,
    item9: null,
    item10: null,
  };
}

function collectItemHeadings(text: string, scheduleType: ScheduleType, warnings: string[]): ItemHeadingMatch[] {
  const lines = normalizeNewlines(text).split("\n");
  const offsets = lineStartOffsets(text);
  const headings: ItemHeadingMatch[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = cleanItemHeadingLine(rawLine);
    if (!line) continue;

    const inlineHeadings = collectInlineFormalItemHeadings(rawLine, line, offsets[index] ?? 0, scheduleType);
    if (inlineHeadings.length > 1) {
      headings.push(...inlineHeadings);
      continue;
    }

    const formal = parseFormalItemHeading(line, scheduleType);
    const titleOnly = formal ? null : parseTitleOnlyItemHeading(line, scheduleType);
    const parsed = formal ?? titleOnly;
    if (!parsed) {
      if (/^item$/i.test(line)) {
        warnings.push("Potential Item heading without a number was ignored; item boundary is uncertain.");
      }
      continue;
    }

    const lineStart = offsets[index] ?? 0;
    const inlineBodyStart = findInlineFormalItemBodyStart(rawLine, parsed.itemNumber, scheduleType);
    const bodyStart = inlineBodyStart === null ? lineStart + rawLine.length + (index < lines.length - 1 ? 1 : 0) : lineStart + inlineBodyStart;
    headings.push({
      itemNumber: parsed.itemNumber,
      start: lineStart,
      bodyStart,
      line,
      inferredTitleOnly: parsed.inferredTitleOnly,
    });

    if (parsed.inferredTitleOnly) {
      warnings.push(`Item ${parsed.itemNumber} boundary inferred from title-only heading "${line}".`);
    }
  }

  return headings.sort((a, b) => a.start - b.start);
}

function findInlineFormalItemBodyStart(rawLine: string, itemNumber: ItemNumber, scheduleType: ScheduleType): number | null {
  const marker = new RegExp(`\\bitem\\s+${itemNumber}(?!\\d)\\s*(?:(?:\\.|:|\\||-|--|\\u2013|\\u2014|\\([a-z]\\)))?\\s*`, "i").exec(
    rawLine,
  );
  if (!marker || marker.index === undefined) return null;

  const rest = rawLine.slice(marker.index + marker[0].length);
  const cleanedRest = cleanItemHeadingTitle(rest);
  if (!cleanedRest) return null;

  const normalizedRest = normalizeHeadingTitle(rest);
  const aliases = titleAliasesForItem(itemNumber, scheduleType).sort((a, b) => b.length - a.length);
  const matchingAlias = aliases.find((alias) => normalizedRest === alias || normalizedRest.startsWith(`${alias} `));
  if (!matchingAlias) return marker.index + marker[0].length;

  const trailing = normalizedRest.slice(matchingAlias.length).trim();
  if (!trailing || !/[\w/%\[\]xX]/.test(trailing)) return null;
  return marker.index + marker[0].length;
}

function collectInlineFormalItemHeadings(
  rawLine: string,
  cleanedLine: string,
  lineStart: number,
  scheduleType: ScheduleType,
): ItemHeadingMatch[] {
  const matches: ItemHeadingMatch[] = [];
  const candidatePattern = /\bitem\s+([1-9]|10)(?!\d)\s*(?:(\.|:|\||-|--|\u2013|\u2014|\([a-z]\)))?/gi;
  let match: RegExpExecArray | null;
  while ((match = candidatePattern.exec(rawLine)) !== null) {
    const rawIndex = match.index;

    const rawCandidate = rawLine.slice(rawIndex);
    const cleanedCandidate = cleanItemHeadingLine(rawCandidate);
    const parsed = cleanedCandidate ? parseFormalItemHeading(cleanedCandidate, scheduleType) : null;
    if (!parsed) continue;

    const cleanedPrefix = cleanItemHeadingLine(rawLine.slice(0, rawIndex)) ?? "";
    const cleanedIndex = cleanedPrefix ? cleanedLine.indexOf(cleanedCandidate ?? "", cleanedPrefix.length) : cleanedLine.indexOf(cleanedCandidate ?? "");
    matches.push({
      itemNumber: parsed.itemNumber,
      start: lineStart + rawIndex,
      bodyStart: lineStart + rawIndex + match[0].length,
      line: cleanedCandidate ?? rawCandidate,
      inferredTitleOnly: false,
    });

    if (cleanedIndex < 0) {
      continue;
    }
  }

  return matches;
}

function parseFormalItemHeading(
  line: string,
  scheduleType: ScheduleType,
): { itemNumber: ItemNumber; inferredTitleOnly: boolean } | null {
  const match = /^item\s+([1-9]|10)(?!\d)\s*(?:(\.|:|\||-|--|\u2013|\u2014|\([a-z]\)))?\s*(.*)$/i.exec(line);
  const itemNumber = match?.[1];
  if (!itemNumber || !isItemNumber(itemNumber)) return null;

  const separator = match[2] ?? "";
  const rest = cleanItemHeadingTitle(match[3] ?? "");
  if (scheduleType === "13G" && itemNumber === "5" && normalizeHeadingTitle(rest) === "ownership") {
    return { itemNumber, inferredTitleOnly: false };
  }
  if (!separator && rest && !startsWithKnownItemTitle(itemNumber, rest, scheduleType)) return null;
  if (/^of\s+(?:the\s+)?(?:initial\s+)?13[DG]\b/i.test(rest)) return null;

  return { itemNumber, inferredTitleOnly: false };
}

function parseTitleOnlyItemHeading(
  line: string,
  scheduleType: ScheduleType,
): { itemNumber: ItemNumber; inferredTitleOnly: boolean } | null {
  const normalizedLine = normalizeHeadingTitle(line);
  if (!normalizedLine || normalizedLine.length > 160) return null;

  const candidates = ITEM_NUMBERS.filter((itemNumber) => titleAliasesForItem(itemNumber, scheduleType).includes(normalizedLine));
  if (candidates.length !== 1) return null;
  return { itemNumber: candidates[0]!, inferredTitleOnly: true };
}

function startsWithKnownItemTitle(itemNumber: ItemNumber, value: string, scheduleType: ScheduleType): boolean {
  const normalized = normalizeHeadingTitle(value);
  return titleAliasesForItem(itemNumber, scheduleType).some((title) => normalized === title || normalized.startsWith(`${title} `));
}

function titleAliasesForItem(itemNumber: ItemNumber, scheduleType: ScheduleType): string[] {
  const aliases = ITEM_TITLE_ALIASES[itemNumber];
  if (scheduleType === "13D") {
    if (itemNumber === "4") return aliases.filter((title) => title !== "ownership");
    if (Number.parseInt(itemNumber, 10) > 7) return [];
  }
  if (scheduleType === "13G") {
    if (itemNumber === "4") return aliases.filter((title) => title === "ownership");
    if (itemNumber === "5") return aliases.filter((title) => /ownership/i.test(title));
  }
  return aliases;
}

function cleanItemHeadingLine(value: string): string | null {
  return cleanFieldValue(value.replace(/\s*\|\s*/g, " "));
}

function cleanItemHeadingTitle(value: string): string {
  return value.replace(/^[\s.:\-|()]+/, "").replace(/\s+/g, " ").trim();
}

function normalizeHeadingTitle(value: string): string {
  return cleanItemHeadingTitle(value)
    .replace(/\.$/, "")
    .replace(/[,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function lineStartOffsets(text: string): number[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") offsets.push(index + 1);
  }
  return offsets;
}

function findSignatureStart(text: string, start: number): number | null {
  const rest = text.slice(start);
  const match = /\n\s*SIGNATURES?\b/i.exec(rest);
  return match?.index === undefined ? null : start + match.index;
}

function isItemNumber(value: string): value is ItemNumber {
  return ITEM_NUMBERS.includes(value as ItemNumber);
}

function normalizeItemMarkers(text: string): string {
  return normalizeNewlines(text)
    .replace(/(^|\n)\s*\|?\s*Item\s*\n\s*(\d+[A-Z]?)\.?\s*\|?/gi, "$1Item $2. ")
    .replace(/(^|\n)\s*\|?\s*Item\s*\|\s*(\d+[A-Z]?)\.?\s*\|?/gi, "$1Item $2. ")
    .replace(/(^|\n)\s*\|\s*Item\s+(\d+[A-Z]?)\.?\s*\|?/gi, "$1Item $2. ");
}

function extractCertification(text: string): string | null {
  const match = /certif(?:y|ication)[\s\S]{0,700}/i.exec(text);
  return cleanText(match?.[0] ?? null);
}

function extractAmendmentNumber(text: string, formType: string): number | null {
  const header = text.slice(0, Math.min(firstItemIndex(text) ?? 5000, 5000));
  if (!/\/A$/i.test(formType) && !/\bamendment\s+no\.?/i.test(header)) return null;
  const match = /amendment\s+no\.?\s*[\s):.]*([0-9]+)/i.exec(header);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function extractRuleBasis(text: string): Sc13RuleBasis | null {
  const normalized = normalizeNewlines(text);
  const checkedRule = /(?:\u2612|\u2611|\u2713|\u2714|\[x\]|X)\s*Rule\s*13d-1\(([bcd])\)/i.exec(normalized);
  if (checkedRule?.[1]) return `13d-1(${checkedRule[1].toLowerCase()})` as Sc13RuleBasis;
  const checkedRuleAfter = /Rule\s*13d-1\(([bcd])\)[\s\S]{0,80}(?:\u2612|\u2611|\u2713|\u2714|\[x\]|X)/i.exec(normalized);
  if (checkedRuleAfter?.[1]) return `13d-1(${checkedRuleAfter[1].toLowerCase()})` as Sc13RuleBasis;

  const compactLines = normalized.split("\n").map((line) => line.trim());
  for (let index = 0; index < compactLines.length; index += 1) {
    const line = compactLines[index] ?? "";
    const rule = /Rule\s*13d-1\(([bcd])\)/i.exec(line);
    if (!rule?.[1]) continue;

    const previous = compactLines[index - 1] ?? "";
    const next = compactLines[index + 1] ?? "";
    if (
      isCheckedMarker(previous) ||
      isLegacyCheckedMarkerLine(previous) ||
      isCheckedMarker(line.replace(rule[0], "")) ||
      isCheckedMarker(next)
    ) {
      return `13d-1(${rule[1].toLowerCase()})` as Sc13RuleBasis;
    }
  }

  return null;
}

function looksLikeCusip(value: string): boolean {
  return normalizeCusipCandidate(value) !== null;
}

function normalizeCusipCandidate(value: string | null | undefined): string | null {
  const candidate = cleanFieldValue(value);
  if (!candidate || /common|ordinary|preferred|stock|share|class|title|cusip|item/i.test(candidate)) return null;
  if (/\b(?:inc\.?|corp\.?|corporation|llc|l\.l\.c\.|ltd\.?|plc|lp|l\.p\.|ag|sa|n\.v\.|etf)\b/i.test(candidate)) return null;

  const compact = candidate.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!/[0-9]/.test(compact) || compact.length < 6 || compact.length > 12) return null;
  return compact;
}

function extractCusip(text: string): string | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanFieldValue(lines[index] ?? "") ?? "";
    if (!/cusip/i.test(line)) continue;

    const candidates = [
      ...nearbyCusipCandidates(lines, index, -6, -1),
      cleanFieldValue(lines[index - 2] ?? ""),
      cleanFieldValue(lines[index - 1] ?? ""),
      cleanFieldValue(line.replace(/.*cusip(?:\s+number| no\.?)?\s*:?\s*/i, "")),
      cleanFieldValue(lines[index + 1] ?? ""),
      cleanFieldValue(lines[index + 2] ?? ""),
      ...nearbyCusipCandidates(lines, index, 1, 6),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      const normalized = normalizeCusipCandidate(candidate);
      if (normalized) return normalized;
    }
  }

  return normalizeCusipCandidate(extractValueAfterLabel(text, [/cusip(?:\s+number| no\.?)?\s*:?\s*([A-Z0-9\- ]*)$/i]));
}

function nearbyCusipCandidates(lines: string[], anchorIndex: number, startOffset: number, endOffset: number): string[] {
  const offsets: number[] = [];
  const step = startOffset <= endOffset ? 1 : -1;
  for (let offset = startOffset; step > 0 ? offset <= endOffset : offset >= endOffset; offset += step) {
    offsets.push(offset);
  }
  if (startOffset < 0) offsets.reverse();

  return offsets
    .map((offset) => cleanFieldValue(lines[anchorIndex + offset] ?? ""))
    .filter((candidate): candidate is string => Boolean(candidate));
}

function extractCoverTextValue(text: string, patterns: RegExp[]): ExtractedCoverValue<string> {
  const raw = extractValueAfterLabel(text, patterns);
  return { value: raw, raw };
}

function extractCoverNumberValue(text: string, patterns: RegExp[]): ExtractedCoverValue<number> {
  const raw = extractValueAfterLabel(text, patterns);
  return { value: parseNumberIfValueLine(raw), raw };
}

function extractCoverPercentValue(text: string, patterns: RegExp[]): ExtractedCoverValue<number> {
  const raw = extractValueAfterLabel(text, patterns);
  return { value: parsePercentIfValueLine(raw), raw };
}

function extractAggregateSharesValue(text: string): ExtractedCoverValue<number> | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanFieldValue(lines[index]) ?? "";
    const previous = cleanFieldValue(lines[index - 1]) ?? "";
    const isAggregateLine =
      /aggregate\s+(?:amount\s+)?beneficially\s+owned/i.test(line) ||
      (/amount\s+beneficially\s+owned/i.test(line) && /aggregate/i.test(previous)) ||
      (/owned\s+by\s+each\s+reporting\s+person/i.test(line) && /aggregate\s+(?:amount\s+)?beneficially/i.test(previous));
    if (!isAggregateLine || /number\s+of\s+shares/i.test(line)) continue;

    const inline = cleanFieldValue(
      /(?:aggregate\s+(?:amount\s+)?beneficially\s+owned(?:\s+by\s+each\s+reporting\s+person)?|amount\s+beneficially\s+owned(?:\s+by\s+each\s+reporting\s+person)?|owned\s+by\s+each\s+reporting\s+person)\s*:?\s*(.+)$/i.exec(
        line,
      )?.[1],
    );
    const inlineNumber = parseNumberIfValueLine(inline);
    if (inlineNumber !== null) return { value: inlineNumber, raw: inline };

    const nextValue = extractNumberValueFromFollowingLines(lines, index + 1);
    if (nextValue.raw !== null || nextValue.value !== null) return nextValue;
  }
  return null;
}

function extractAggregateShares(text: string): number | null {
  return extractAggregateSharesValue(text)?.value ?? null;
}

function extractPercentOfClassValue(text: string): ExtractedCoverValue<number> | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanFieldValue(lines[index]) ?? "";
    const previous = cleanFieldValue(lines[index - 1]) ?? "";
    const isPercentLine =
      /percent\s+of\s+class/i.test(line) ||
      (/of\s+class\s+represented\s+by\s+amount/i.test(line) && /percent/i.test(previous)) ||
      (/by\s+amount\s+in\s+row/i.test(line) && /percent\s+of\s+class/i.test(previous));
    if (!isPercentLine) continue;

    const inline = cleanFieldValue(
      /(?:percent\s+of\s+class(?:\s+represented\s+by\s+amount\s+in\s+row\s+\(?\d+\)?)?|of\s+class\s+represented\s+by\s+amount\s+in\s+row\s+\(?\d+\)?|by\s+amount\s+in\s+row\s+\(?\d+\)?)\s*:?\s*(.+)$/i.exec(
        line,
      )?.[1],
    );
    const inlinePercent = parsePercentIfValueLine(inline);
    if (inlinePercent !== null) return { value: inlinePercent, raw: inline };

    const nextPercent = extractPercentValueFromFollowingLines(lines, index + 1);
    if (nextPercent.raw !== null || nextPercent.value !== null) return nextPercent;
  }
  return null;
}

function extractPercentOfClass(text: string): number | null {
  return extractPercentOfClassValue(text)?.value ?? null;
}

function extractOwnershipPowerValue(
  text: string,
  holder: "sole" | "shared",
  powerType: "voting" | "dispositive",
): ExtractedCoverValue<number> | null {
  const lines = normalizeNewlines(text).split("\n");
  const label = new RegExp(`${holder}\\s+${powerType}\\s+power`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanFieldValue(lines[index]) ?? "";
    if (!label.test(line)) continue;

    const inline = cleanFieldValue(/(?:sole|shared)\s+(?:voting|dispositive)\s+power\*?\s*:?\s*(.+)$/i.exec(line)?.[1]);
    const inlineNumber = parseNumberIfValueLine(inline);
    if (inlineNumber !== null) return { value: inlineNumber, raw: inline };

    const nextNumber = extractNumberValueFromFollowingLines(lines, index + 1);
    if (nextNumber.raw !== null || nextNumber.value !== null) return nextNumber;
  }
  return null;
}

function extractOwnershipPower(
  text: string,
  holder: "sole" | "shared",
  powerType: "voting" | "dispositive",
): number | null {
  return extractOwnershipPowerValue(text, holder, powerType)?.value ?? null;
}

function extractNumberFromFollowingLines(lines: string[], startIndex: number): number | null {
  return extractNumberValueFromFollowingLines(lines, startIndex).value;
}

function extractPercentFromFollowingLines(lines: string[], startIndex: number): number | null {
  return extractPercentValueFromFollowingLines(lines, startIndex).value;
}

function extractNumberValueFromFollowingLines(lines: string[], startIndex: number): ExtractedCoverValue<number> {
  for (let offset = 0; offset < 4 && startIndex + offset < lines.length; offset += 1) {
    const raw = cleanFieldValue(lines[startIndex + offset]);
    const parsed = parseNumberIfValueLine(raw);
    if (parsed !== null || isAmbiguousCoverNumberValue(raw)) return { value: parsed, raw };
  }
  return { value: null, raw: null };
}

function extractPercentValueFromFollowingLines(lines: string[], startIndex: number): ExtractedCoverValue<number> {
  for (let offset = 0; offset < 4 && startIndex + offset < lines.length; offset += 1) {
    const raw = cleanFieldValue(lines[startIndex + offset]);
    const parsed = parsePercentIfValueLine(raw);
    if (parsed !== null || isAmbiguousPercentValue(raw)) return { value: parsed, raw };
  }
  return { value: null, raw: null };
}

function parseNumberIfValueLine(value: string | null | undefined): number | null {
  if (!value || /^(?:[1-9]|1[0-4])\.?$/.test(value) || /^row\s+\(?\d+\)?$/i.test(value)) {
    return null;
  }
  if (/^(?:n\/a|not applicable|--|\*+)$|^\(?\s*\*+\s*\)?$/i.test(value.trim())) return null;
  if (/^less\s+than\s+(?:one|\d+(?:\.\d+)?)\s*(?:percent|%)/i.test(value.trim())) return null;
  if (/\bsee\s+row\s+\(?\d+\)?\b/i.test(value)) return null;
  if (
    /aggregate\s+amount|amount\s+in\s+row|excludes?\s+certain\s+shares|percent\s+of\s+class|check\s+box|type\s+of\s+reporting|voting\s+power|dispositive\s+power/i.test(
      value,
    ) &&
    !isNumericValueLine(value)
  ) {
    return null;
  }
  if (isBoilerplateLine(value) && !isNumericValueLine(value)) {
    return null;
  }
  return parseNumber(value);
}

function parsePercentIfValueLine(value: string | null | undefined): number | null {
  if (!value || /^(?:[1-9]|1[0-4])\.?$/.test(value) || /^row\s+\(?\d+\)?$/i.test(value)) {
    return null;
  }
  if (isAmbiguousPercentValue(value)) return null;
  if (/amount\s+in\s+row/i.test(value) && !/%/.test(value)) return null;
  if (isBoilerplateLine(value) && !isNumericValueLine(value)) {
    return null;
  }
  return parsePercent(value);
}

function isNumericValueLine(value: string): boolean {
  return /^-?[\d,]+(?:\.\d+)?\s*(?:%|shares?)?(?:\s+\([^)]+\))?(?:\s*[*†‡])?$/i.test(value.trim());
}

function isAmbiguousCoverNumberValue(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^(?:n\/a|not applicable|--|\*+)$|^\(?\s*\*+\s*\)?$/i.test(value.trim());
}

function isAmbiguousPercentValue(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    /^(?:n\/a|not applicable|--|\*+)$/.test(normalized) ||
    /^\(?\s*\*+\s*\)?$/.test(normalized) ||
    /^less\s+than\s+(?:one|\d+(?:\.\d+)?)\s*percent/.test(normalized) ||
    /^less\s+than\s+\d+(?:\.\d+)?\s*%/.test(normalized)
  );
}

type ExplicitAggregateOwnership = {
  shares: number | null;
  percent: number | null;
};

function extractSharesOwned(
  text: string,
  reportingPersonDetails: Sc13ReportingPersonFact[],
  hasMultipleReportingPersons = reportingPersonDetails.length > 1,
  explicitAggregateOwnership: ExplicitAggregateOwnership | null = extractExplicitAggregateOwnership(text),
): number | null {
  if (hasMultipleReportingPersons) {
    return explicitAggregateOwnership?.shares ?? repeatedCoverValue(reportingPersonDetails.map((detail) => detail.sharesBeneficiallyOwned));
  }
  return (
    reportingPersonDetails.find((detail) => detail.sharesBeneficiallyOwned !== null)?.sharesBeneficiallyOwned ??
    extractAggregateShares(text) ??
    extractAmountBeneficiallyOwned(text) ??
    extractNumberAfterLabel(text, [
      /(?:\d+\.?\s*)?aggregate\s+amount\s+beneficially\s+owned(?:\s+by\s+each\s+reporting\s+person)?\s*:?\s*(.*)$/i,
      /(?:\d+\.?\s*)?owned\s+by\s+each\s+reporting\s+person\s*:?\s*(.*)$/i,
      /(?:\d+\.?\s*)?shares\s+beneficially\s+owned\s*:?\s*(.*)$/i,
      /(?:\d+\.?\s*)?beneficially\s+owned\s*:?\s*(.*)$/i,
    ])
  );
}

function repeatedCoverValue(values: Array<number | null>): number | null {
  const numericValues = values.filter((value): value is number => value !== null);
  const uniqueValues = new Set(numericValues);
  return uniqueValues.size === 1 ? numericValues[0] ?? null : null;
}

function extractExplicitAggregateOwnership(text: string): ExplicitAggregateOwnership | null {
  const normalized = cleanWhitespace([extractItemSection(text, "5"), extractItemSection(text, "4"), text].filter(Boolean).join("\n"));
  if (!normalized) return null;

  const patterns = [
    /(?:may\s+be\s+deemed\s+to\s+)?beneficially\s+owns?\s+an?\s+aggregate\s+of\s+([\d,]+(?:\.\d+)?)\s+(?:shares|ordinary\s+shares|common\s+stock|class\s+[a-z]\s+common\s+stock|ads|american\s+depositary\s+shares)[^.]{0,280}?(?:constitutes?|represents?|approximately|approx\.?)\s+([\d.]+)\s*%/i,
    /aggregate\s+of\s+([\d,]+(?:\.\d+)?)\s+(?:shares|ordinary\s+shares|common\s+stock|class\s+[a-z]\s+common\s+stock|ads|american\s+depositary\s+shares)[^.]{0,280}?(?:constitutes?|represents?|approximately|approx\.?)\s+([\d.]+)\s*%/i,
    /\bin\s+the\s+aggregate\b[^.]{0,240}?\bbeneficially\s+own\s+([\d,]+(?:\.\d+)?)\s+(?:shares|ordinary\s+shares|common\s+stock|class\s+[a-z]\s+common\s+stock|ads|american\s+depositary\s+shares)[^.]{0,280}?(?:approximately|approx\.?|constitutes?|represents?)\s+([\d.]+)\s*%/i,
    /([\d,]+(?:\.\d+)?)\s+(?:shares|ordinary\s+shares|common\s+stock|class\s+[a-z]\s+common\s+stock|ads|american\s+depositary\s+shares)[^.]{0,120}?which\s+constitutes?\s+approximately\s+([\d.]+)\s*%/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const shares = parseNumber(match?.[1]);
    const percent = parsePercent(match?.[2]);
    if (shares !== null || percent !== null) return { shares, percent };
  }

  if (hasZeroOwnershipDisclosure(normalized)) return { shares: 0, percent: 0 };

  return null;
}

function hasZeroOwnershipDisclosure(text: string): boolean {
  const hasZeroShares =
    /aggregate\s+(?:amount\s+)?beneficially\s+owned(?:\s+by\s+each\s+reporting\s+person)?\s+0(?:\.0+)?(?:\s|$)/i.test(text) ||
    /owned\s+by\s+each\s+reporting\s+person\s+0(?:\.0+)?(?:\s|$)/i.test(text) ||
    /beneficial\s+ownership\s+(?:of\s+)?0(?:\.0+)?\s+(?:shares|ordinary\s+shares|common\s+stock|ads|american\s+depositary\s+shares)/i.test(text);
  const hasZeroPercent =
    /percent\s+of\s+class(?:\s+represented\s+by\s+amount\s+in\s+row\s+\(?\d+\)?)?\s+0(?:\.0+)?\s*%/i.test(text) ||
    /represents?\s+0(?:\.0+)?\s*%/i.test(text);
  const hasExitLanguage = /(?:ceased|ceases|no\s+longer)\s+(?:to\s+be\s+)?(?:the\s+)?beneficial\s+owner|ownership\s+of\s+(?:5|five)\s+percent\s+or\s+less/i.test(
    text,
  );
  return (hasZeroShares && hasZeroPercent) || (hasExitLanguage && hasZeroPercent);
}

function extractAmountBeneficiallyOwned(text: string): number | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanFieldValue(lines[index]) ?? "";
    if (!/amount\s+beneficially\s+owned/i.test(line)) continue;

    const inline = cleanFieldValue(/amount\s+beneficially\s+owned\s*:?\s*(.+)$/i.exec(line)?.[1]);
    const inlineNumber = parseNumberIfValueLine(inline);
    if (inlineNumber !== null) return inlineNumber;

    const nextValue = extractNumberValueFromFollowingLines(lines, index + 1);
    if (nextValue.value !== null) return nextValue.value;
  }
  return null;
}

function extractPercentOwned(
  text: string,
  reportingPersonDetails: Sc13ReportingPersonFact[],
  hasMultipleReportingPersons = reportingPersonDetails.length > 1,
  explicitAggregateOwnership: ExplicitAggregateOwnership | null = extractExplicitAggregateOwnership(text),
): number | null {
  if (hasMultipleReportingPersons) {
    return explicitAggregateOwnership?.percent ?? repeatedCoverValue(reportingPersonDetails.map((detail) => detail.percentOwned));
  }
  return (
    reportingPersonDetails.find((detail) => detail.percentOwned !== null)?.percentOwned ??
    extractPercentOfClass(text) ??
    extractPercentAfterLabel(text, [
      /percent\s+of\s+class(?:\s+represented\s+by\s+amount\s+in\s+row\s+\(?\d+\)?)?\s*:?\s*(.*)$/i,
      /represented\s+by\s+amount\s+in\s+row\s+\(?\d+\)?\s*:?\s*(.*)$/i,
      /percentage\s+ownership\s*:?\s*(.*)$/i,
    ]) ??
    parsePercent(extractLineValue(text, [/beneficial\s+ownership\s+of\s*([\d.]+)\s*%/i]))
  );
}

function extractPercentChange(text: string): { from: number; to: number } | null {
  const match = /(?:increased|decreased|changed|reduced|rose|fell)?\s*from\s+([\d.]+)\s*%\s+to\s+([\d.]+)\s*%/i.exec(text);
  if (!match?.[1] || !match[2]) return null;
  return { from: Number.parseFloat(match[1]), to: Number.parseFloat(match[2]) };
}

function extractPower(
  text: string,
  holder: "sole" | "shared",
  powerType: "voting" | "dispositive",
  reportingPersonDetails: Sc13ReportingPersonFact[],
): number | null {
  const detailsPower =
    reportingPersonDetails.find((detail) => detail[`${powerType}Power` as "votingPower" | "dispositivePower"][holder] !== null)?.[
      `${powerType}Power` as "votingPower" | "dispositivePower"
    ][holder] ?? null;
  if (detailsPower !== null) return detailsPower;
  return (
    extractOwnershipPower(text, holder, powerType) ??
    extractNumberAfterLabel(text, [new RegExp(`${holder}\\s+${powerType}\\s+power\\s*:?\\s*(.*)$`, "i")])
  );
}

function extractNumberAfterLabel(text: string, patterns: RegExp[]): number | null {
  const value = extractValueAfterLabel(text, patterns);
  return parseNumberIfValueLine(value);
}

function extractPercentAfterLabel(text: string, patterns: RegExp[]): number | null {
  const value = extractValueAfterLabel(text, patterns);
  if (/^\d+\.?$/.test(value ?? "")) return null;
  return parsePercentIfValueLine(value);
}

function extractGroupCheckbox(text: string): { a: boolean | null; b: boolean | null } {
  const lines = normalizeNewlines(text).split("\n");
  const index = lines.findIndex((line) => /check\s+the\s+appropriate\s+box\s+if\s+a\s+member\s+of\s+a\s+group/i.test(line));
  const line = index >= 0 ? lines.slice(index, index + 20).join(" ") : "";
  return {
    a: extractCheckboxOptionState(line, "a"),
    b: extractCheckboxOptionState(line, "b"),
  };
}

function extractCheckboxOptionState(text: string, option: "a" | "b"): boolean | null {
  const optionPattern = new RegExp(`\\(${option}\\)\\s*([^\\n\\(]*)|${option}\\.\\s*([^\\n\\(]*)`, "i");
  const match = optionPattern.exec(text);
  const markerText = [match?.[1], match?.[2]].filter(Boolean).join(" ");
  if (!markerText) return null;
  if (isCheckedMarker(markerText)) return true;
  if (isUncheckedMarker(markerText)) return false;
  return null;
}

function extractCheckedStateNear(text: string, pattern: RegExp): boolean | null {
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    pattern.lastIndex = 0;
    if (!pattern.test(line)) continue;
    const local = [line, lines[index + 1] ?? "", lines[index - 1] ?? ""].join(" ");
    if (isCheckedMarker(local)) return true;
    if (isUncheckedMarker(local)) return false;
  }
  return null;
}

function isCheckedMarker(value: string): boolean {
  const normalized = value.trim();
  return CHECKED_MARKERS.some((marker) => normalized.includes(marker)) || /(?:^|\s|\[)[xX](?:\]|\s|$)/.test(normalized);
}

function isLegacyCheckedMarkerLine(value: string): boolean {
  return /^\?\s*\|?$/.test(value.trim());
}

function isUncheckedMarker(value: string): boolean {
  const normalized = value.trim();
  return UNCHECKED_MARKERS.some((marker) => normalized.includes(marker));
}

function extractFinancingAmount(text: string): number | null {
  const match = /\$\s*([\d,.]+)\s*(million|billion)?/i.exec(text);
  if (!match?.[1]) return null;
  const base = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === "billion") return Math.round(base * 1_000_000_000);
  if (unit === "million") return Math.round(base * 1_000_000);
  return Math.round(base);
}

function inferOwnershipIntent(
  scheduleType: ScheduleType,
  passiveCertification: boolean,
  item4HasActivistLanguage: boolean,
) {
  // Legacy compatibility field. Prefer factual keyword/certification fields for new parser consumers.
  if (item4HasActivistLanguage) return "active";
  if (scheduleType === "13G" && passiveCertification) return "passive";
  if (scheduleType === "13G") return "passive";
  return "unknown";
}

function hasPassiveCertification(text: string): boolean {
  const normalized = text.toLowerCase();
  const notAcquiredOrHeld =
    /not\s+acquired\s+or\s+held/.test(normalized) ||
    /not\s+acquired[^.]{0,160}not\s+held/.test(normalized);
  return (
    notAcquiredOrHeld &&
    normalized.includes("changing or influencing") &&
    normalized.includes("control")
  );
}

function hasOrdinaryCourseCertification(text: string): boolean {
  const normalized = text.toLowerCase();
  return normalized.includes("ordinary course of business") && normalized.includes("not acquired");
}

function hasExitFilingLanguage(
  text: string,
  item5Text: string | null,
  scheduleType: ScheduleType,
  isAmendment: boolean,
  percentOwned: number | null,
): boolean {
  if (scheduleType !== "13G" || !isAmendment) return false;
  if (percentOwned !== null && percentOwned > 5) return false;

  const source = cleanText(item5Text) || cleanText(text) || "";
  const hasCeasedLanguage = /ceased\s+to\s+be\s+the\s+beneficial\s+owner\s+of\s+more\s+than\s+(?:five|5)\s+percent/i.test(source);
  if (hasCeasedLanguage) return true;

  const hasBelowFiveSection = /ownership\s+of\s+(?:five|5)\s+percent\s+or\s+less/i.test(source);
  const hasBelowFiveValue = /(?:less\s+than\s+(?:five|5)\s*%?|below\s+(?:five|5)\s*%?|(?:five|5)\s*%\s+or\s+less)/i.test(source);
  const hasCheckedMarker = /(?:☒|\[x\]|\(x\)|\bx\b|checked|check\s+the\s+following\s+(?:☒|\[x\]|\(x\)|x))/i.test(source);
  return hasBelowFiveSection && hasBelowFiveValue && hasCheckedMarker;
}

function hasOwnershipIncorporationLanguage(text: string): boolean {
  return /(?:rows?|items?)\s+\d+(?:\s*(?:-|through|to)\s*\d+)?[^.]{0,120}incorporated\s+(?:herein\s+)?by\s+reference/i.test(text);
}

function extractSalesTable(text: string): Sc13Facts["salesTable"] {
  const lines = normalizeNewlines(text).split("\n");
  const salesRows: Sc13Facts["salesTable"] = [];

  for (const line of lines) {
    const match = /([A-Z][a-z]+\s+\d{1,2},\s+\d{4})\s+(.+?)\s+([\d,]+)\*?\s+\$?([\d.]+\s+to\s+\$?[\d.]+[^$]*?)\s+\$?([\d.]+)/.exec(
      line.trim(),
    );
    if (!match) continue;
    salesRows.push({
      date: match[1],
      reportingPerson: cleanText(match[2]),
      sharesSold: parseNumber(match[3]),
      priceRange: cleanText(match[4]),
      weightedAveragePrice: match[5] ? Number.parseFloat(match[5]) : null,
    });
  }

  return salesRows;
}

function extractExhibitReferences(
  text: string,
  itemSections: Sc13ItemSections,
  scheduleType: ScheduleType,
  attachments: Sc13FilingInput["attachments"] | undefined,
): Sc13ExhibitReference[] {
  const references: Sc13ExhibitReference[] = [];
  if (scheduleType === "13D" && itemSections.item7) {
    references.push(...extractExhibitReferencesFromText(itemSections.item7, "item7", "Item 7"));
  }
  references.push(...extractBodyExhibitReferences(text, itemSections.item7));
  references.push(...extractAttachmentExhibitReferences(attachments));
  return markItem6ExhibitMatches(references, itemSections.item6);
}

function extractExhibitReferencesFromText(
  text: string,
  source: ExhibitReferenceSource,
  sourceLocation: string,
): Sc13ExhibitReference[] {
  const references: Sc13ExhibitReference[] = [];
  const labelMatches = [...text.matchAll(/\b(?:(?:Exhibit|Ex\.)\s+|EX\s*-?\s*)(?:[0-9]{1,3}(?:\.[0-9]+)?|[A-Z])\b/gi)];
  for (let index = 0; index < labelMatches.length; index += 1) {
    const match = labelMatches[index]!;
    const start = match.index ?? 0;
    const end = labelMatches[index + 1]?.index ?? findExhibitSegmentEnd(text, start);
    const segment = cleanText(text.slice(start, end));
    if (!segment) continue;
    const label = cleanText(match[0]);
    const titleText = cleanExhibitTitle(segment.slice(match[0].length)) ?? extractAgreementTitle(segment);
    references.push(buildExhibitReference(label, titleText, source, sourceLocation, segment, titleText === null));
  }

  if (references.length > 0) return references;

  const lines = normalizeNewlines(text).split("\n").map((line) => cleanText(line)).filter(Boolean) as string[];
  for (const line of lines) {
    const agreementTitle = extractAgreementTitle(line);
    if (agreementTitle) references.push(buildExhibitReference(null, agreementTitle, source, sourceLocation, line, false));
  }

  return references;
}

function extractLineExhibitReferences(
  line: string,
  source: ExhibitReferenceSource,
  sourceLocation: string,
): Sc13ExhibitReference[] {
  const references: Sc13ExhibitReference[] = [];
  const exhibitPattern = /\b(?:(?:Exhibit|Ex\.)\s+|EX\s*-?\s*)([0-9]{1,3}(?:\.[0-9]+)?|[A-Z])\b(?:\s*[-:.\u2013\u2014]\s*|\s+)?([^.;\n]*)?/gi;
  let match = exhibitPattern.exec(line);
  while (match) {
    const label = cleanText(match[0].replace((match[2] ?? ""), ""));
    const title = cleanExhibitTitle(match[2] ?? "") ?? extractAgreementTitle(line);
    references.push(buildExhibitReference(label, title, source, sourceLocation, line, title === null));
    match = exhibitPattern.exec(line);
  }

  if (references.length === 0 && source !== "body") {
    const agreementTitle = extractAgreementTitle(line);
    if (agreementTitle) {
      references.push(buildExhibitReference(null, agreementTitle, source, sourceLocation, line, false));
    }
  }

  return references;
}

function findExhibitSegmentEnd(text: string, start: number): number {
  const rest = text.slice(start);
  const punctuation = /[.;](?:\s|$)/.exec(rest);
  return punctuation?.index === undefined ? text.length : start + punctuation.index;
}

function extractBodyExhibitReferences(text: string, item7Text: string | null): Sc13ExhibitReference[] {
  const references: Sc13ExhibitReference[] = [];
  const item7Normalized = item7Text ? cleanWhitespace(item7Text) : null;
  const lines = normalizeNewlines(text)
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean) as string[];

  for (const line of lines) {
    if (item7Normalized && item7Normalized.includes(line)) continue;
    if (!/\b(?:exhibit|EX-|Ex\.|agreement)\b/i.test(line)) continue;
    references.push(...extractLineExhibitReferences(line, "body", "filing body"));
  }

  return references.filter((reference) => reference.label !== null || reference.agreementLike).slice(0, 25);
}

function extractAttachmentExhibitReferences(attachments: Sc13FilingInput["attachments"] | undefined): Sc13ExhibitReference[] {
  if (!attachments) return [];
  const references: Sc13ExhibitReference[] = [];

  for (const attachment of attachments) {
    const type = attachmentValue(attachment, ["type", "documentType", "formType"]);
    const label = attachmentValue(attachment, ["label", "description", "title"]);
    const filename = attachmentValue(attachment, ["filename", "name", "document", "url"]);
    const raw = [type, label, filename].filter(Boolean).join(" | ");
    if (!raw || !/\b(?:EX|Exhibit|Agreement|Power of Attorney)\b/i.test(raw)) continue;

    const fromType = normalizeExhibitLabel(type) ? type : null;
    const title = cleanExhibitTitle(label) ?? extractAgreementTitle(raw);
    references.push(buildExhibitReference(fromType, title, "attachment", "document inventory", raw, title === null));
  }

  return references;
}

function attachmentValue(attachment: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = attachment[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function buildExhibitReference(
  label: string | null,
  title: string | null,
  source: ExhibitReferenceSource,
  sourceLocation: string,
  rawText: string,
  uncertain: boolean,
): Sc13ExhibitReference {
  const normalizedLabel = normalizeExhibitLabel(label);
  return {
    label: cleanText(label),
    normalizedLabel,
    title: cleanText(title),
    source,
    sourceLocation,
    rawText: truncate(cleanWhitespace(rawText), 500) ?? rawText,
    uncertain: uncertain || (Boolean(label) && !title && source !== "body"),
    agreementLike: isAgreementLikeTitle(title ?? rawText),
    matchedItem6: false,
  };
}

function markItem6ExhibitMatches(references: Sc13ExhibitReference[], item6Text: string | null): Sc13ExhibitReference[] {
  if (!item6Text) return references;
  const normalizedItem6 = item6Text.toLowerCase();
  return references.map((reference) => {
    const titleMatch = reference.title ? normalizedItem6.includes(reference.title.toLowerCase()) : false;
    const labelMatch = reference.normalizedLabel
      ? normalizedItem6.includes(reference.normalizedLabel.toLowerCase()) ||
        normalizedItem6.includes(reference.normalizedLabel.replace("EX-", "exhibit ").toLowerCase())
      : false;
    return { ...reference, matchedItem6: titleMatch || labelMatch };
  });
}

function cleanExhibitTitle(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const withoutNoise = cleaned
    .replace(/^[\s\-:.\u2013\u2014]+/, "")
    .replace(/^(?:filed\s+herewith|incorporated\s+by\s+reference)\b\.?/i, "")
    .replace(/\s*\(.*?incorporated\s+by\s+reference.*?\)\s*$/i, "")
    .trim();
  if (!withoutNoise || /^[-.:;]$/.test(withoutNoise) || /^see\s+/i.test(withoutNoise)) return null;
  return withoutNoise;
}

function normalizeExhibitLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /\b(?:(?:Exhibit|Ex\.)\s+|EX\s*-?\s*)([0-9]{1,3}(?:\.[0-9]+)?|[A-Z])\b/i.exec(value);
  if (!match?.[1]) return null;
  return `EX-${match[1].toUpperCase()}`;
}

function extractAgreementTitle(value: string): string | null {
  for (const title of AGREEMENT_TITLE_PATTERNS) {
    const pattern = new RegExp(`\\b${escapeRegExp(title).replace(/\s+/g, "\\s+")}\\b`, "i");
    const match = pattern.exec(value);
    if (match?.[0]) return match[0];
  }
  return null;
}

function isAgreementLikeTitle(value: string | null | undefined): boolean {
  if (!value) return false;
  return AGREEMENT_TITLE_PATTERNS.some((title) => new RegExp(`\\b${escapeRegExp(title).replace(/\s+/g, "\\s+")}\\b`, "i").test(value));
}

function duplicateExhibitLabels(references: Sc13ExhibitReference[]): string[] {
  const counts = new Map<string, number>();
  for (const reference of references) {
    if (!reference.normalizedLabel) continue;
    counts.set(reference.normalizedLabel, (counts.get(reference.normalizedLabel) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([label]) => label);
}

function sameExhibitLabel(a: Sc13ExhibitReference, b: Sc13ExhibitReference): boolean {
  return Boolean(a.normalizedLabel && b.normalizedLabel && a.normalizedLabel === b.normalizedLabel);
}

function isNoExhibitsText(value: string | null): boolean {
  return /\b(?:no|none|not\s+applicable)\b.{0,80}\bexhibits?\b|\bno\s+exhibits?\s+(?:are\s+)?(?:filed|submitted)/i.test(value ?? "");
}

function compareExhibitReferences(
  current: Sc13ExhibitReference[],
  prior: Sc13ExhibitReference[] | null | undefined,
  currentItem7: string | null,
  priorItem7: string | null | undefined,
): Sc13ExhibitComparison | null {
  if (!prior) return null;
  const currentByLabel = exhibitMapByLabel(current);
  const priorByLabel = exhibitMapByLabel(prior);
  const added = [...currentByLabel.entries()].filter(([label]) => !priorByLabel.has(label)).map(([, reference]) => reference);
  const removed = [...priorByLabel.entries()].filter(([label]) => !currentByLabel.has(label)).map(([, reference]) => reference);
  const changedTitles: Sc13ExhibitComparison["changedTitles"] = [];

  for (const [label, currentReference] of currentByLabel.entries()) {
    const priorReference = priorByLabel.get(label);
    if (!priorReference) continue;
    if ((currentReference.title ?? null) !== (priorReference.title ?? null)) {
      changedTitles.push({
        normalizedLabel: label,
        currentTitle: currentReference.title,
        priorTitle: priorReference.title,
      });
    }
  }

  return {
    added,
    removed,
    changedTitles,
    item7Changed: priorItem7 === undefined ? null : cleanWhitespace(currentItem7) !== cleanWhitespace(priorItem7),
  };
}

function exhibitMapByLabel(references: Sc13ExhibitReference[]): Map<string, Sc13ExhibitReference> {
  const map = new Map<string, Sc13ExhibitReference>();
  for (const reference of references) {
    if (reference.normalizedLabel && !map.has(reference.normalizedLabel)) map.set(reference.normalizedLabel, reference);
  }
  return map;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractOwnershipCalculationNotes(text: string): string[] {
  const notes: string[] = [];
  const lines = normalizeNewlines(text)
    .split("\n")
    .map((line) => cleanText(line))
    .filter(Boolean) as string[];

  for (const line of lines) {
    if (
      /based\s+(?:on|upon)|outstanding|warrant|convertible|as-converted|beneficial ownership limitation|excludes certain shares|ownership cap|conversion/i.test(
        line,
      )
    ) {
      notes.push(truncate(line, 350)!);
    }
  }

  return uniqueStrings(notes).slice(0, 12);
}

function containsAny(text: string, terms: string[]): boolean {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function splitNames(value: string): string[] {
  return value
    .split(/\s*(?:,|;|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeSecFilingText(value: string): string {
  return normalizeMarkupToText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\bSCHEDULE\s*\n\s*(13[DG](?:\/A)?)\b/gi, "SCHEDULE $1")
    .replace(/\bI\s+tem\s+([1-9]|10)\b/gi, "Item $1")
    .replace(/\bNAMES?\s*\n\s*OF\s+REPORTING\s+PERSONS?\b/gi, "NAMES OF REPORTING PERSONS")
    .replace(/\bNAME\s*\n\s*OF\s+REPORTING\s+PERSON\b/gi, "NAME OF REPORTING PERSON")
    .replace(/\bNUMBER\s+OF\s+SHARES\s+BENEFICIALLY\s*\n\s*OWNED\s+BY\s+EACH\s+REPORTING\s+PERSON\s+WITH\b/gi, "NUMBER OF SHARES BENEFICIALLY OWNED BY EACH REPORTING PERSON WITH")
    .replace(/\bNUMBER\s+OF\s+SHARES\s+BENEFICIALLY\s+OWNED\s+BY\s+EACH\s+REPORTING\s+PERSON\s+WITH\b/gi, "NUMBER OF SHARES BENEFICIALLY OWNED BY EACH REPORTING PERSON WITH")
    .replace(/\bAGGREGATE\s*\n\s*AMOUNT\s+BENEFICIALLY\s+OWNED\b/gi, "AGGREGATE AMOUNT BENEFICIALLY OWNED")
    .replace(/\bAGGREGATE\s+AMOUNT\s+BENEFICIALLY\s+OWNED\s*\n\s*BY\s+EACH\s+REPORTING\s+PERSON\b/gi, "AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON")
    .replace(/\bBENEFICIALLY\s+OWNED\s*\n\s*BY\s+EACH\s+REPORTING\s+PERSON\b/gi, "BENEFICIALLY OWNED BY EACH REPORTING PERSON")
    .replace(/\bPERCENT\s*\n\s*OF\s+CLASS\s+REPRESENTED\b/gi, "PERCENT OF CLASS REPRESENTED")
    .replace(/\bPERCENT\s+OF\s+CLASS\s+REPRESENTED\s*\n\s*BY\s+AMOUNT\s+IN\s+ROW\b/gi, "PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW")
    .replace(/\bTYPE\s*\n\s*OF\s+REPORTING\s+PERSON\b/gi, "TYPE OF REPORTING PERSON")
    .replace(/\bTITLE\s*\n\s*OF\s+CLASS\s+OF\s+SECURITIES\b/gi, "TITLE OF CLASS OF SECURITIES")
    .replace(/\bCUSIP\s*\n\s*(?:No\.?|NUMBER)\b/gi, "CUSIP Number")
    .replace(/\bSOURCE\s*\n\s*OF\s+FUNDS\b/gi, "SOURCE OF FUNDS")
    .replace(/\bSOLE\s*\n\s*VOTING\s+POWER\b/gi, "SOLE VOTING POWER")
    .replace(/\bSHARED\s*\n\s*VOTING\s+POWER\b/gi, "SHARED VOTING POWER")
    .replace(/\bSOLE\s*\n\s*DISPOSITIVE\s+POWER\b/gi, "SOLE DISPOSITIVE POWER")
    .replace(/\bSHARED\s*\n\s*DISPOSITIVE\s+POWER\b/gi, "SHARED DISPOSITIVE POWER")
    .replace(/\bCommon\s*\n\s*Stock\b/gi, "Common Stock")
    .replace(/\bOrdinary\s*\n\s*Shares?\b/gi, "Ordinary Shares")
    .replace(/\bClass\s+([A-Z0-9]+)\s*\n\s*Common\s+Stock\b/gi, "Class $1 Common Stock")
    .replace(/\bClass\s+([A-Z0-9]+)\s*\n\s*Ordinary\s+Shares?\b/gi, "Class $1 Ordinary Shares")
    .replace(/\(Amendment\s*\n\s*No\.?\s*([0-9_ ]*)\)/gi, "(Amendment No. $1)")
    .replace(/\(Name\s*\n\s*of\s+Issuer\)/gi, "(Name of Issuer)")
    .replace(/\(Name\s+of\s*\n\s*Issuer\)/gi, "(Name of Issuer)")
    .replace(/\(Title\s*\n\s*of\s+Class\s+of\s+Securities\)/gi, "(Title of Class of Securities)")
    .replace(/\(Title\s+of\s*\n\s*Class\s+of\s+Securities\)/gi, "(Title of Class of Securities)")
    .replace(/\(Title\s+of\s+Class\s*\n\s*of\s+Securities\)/gi, "(Title of Class of Securities)")
    .replace(/\(CUSIP\s*\n\s*Number\)/gi, "(CUSIP Number)");
}

function normalizeMarkupToText(value: string): string {
  const decoded = decodeHtmlEntities(value);
  if (!/<[A-Za-z!?/][\s\S]*?>/.test(decoded)) return decoded;

  return injectKnownXmlLabels(decoded)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<xsl:[\s\S]*?<\/xsl:[^>]+>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ")
    .replace(/<\/(?:p|div|tr|table|section|article|h[1-6]|li|ul|ol|body|html)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\n")
    .replace(/<(?:td|th|tr|p|div|br|li|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function injectKnownXmlLabels(value: string): string {
  let output = value;
  const replacements: Array<[RegExp, string]> = [
    [/<(?:nameOfIssuer|issuerName)\b[^>]*>([\s\S]*?)<\/(?:nameOfIssuer|issuerName)>/gi, "\nName of Issuer\n$1\n"],
    [/<(?:titleOfClass|titleOfSecurities|classTitle|securitiesClassTitle|securityClassTitle)\b[^>]*>([\s\S]*?)<\/(?:titleOfClass|titleOfSecurities|classTitle|securitiesClassTitle|securityClassTitle)>/gi, "\nTitle of Class of Securities\n$1\n"],
    [/<(?:cusip|cusipNumber|cusipNum|issuerCusip|issuerCusipNumber)\b[^>]*>([\s\S]*?)<\/(?:cusip|cusipNumber|cusipNum|issuerCusip|issuerCusipNumber)>/gi, "\nCUSIP Number\n$1\n"],
    [/<(?:reportingPersonName|nameOfReportingPerson|nameOfReportingPersons)\b[^>]*>([\s\S]*?)<\/(?:reportingPersonName|nameOfReportingPerson|nameOfReportingPersons)>/gi, "\nName of Reporting Person\n$1\n"],
    [/<(?:soleVotingPower|solePowerOrDirectToVote)\b[^>]*>([\s\S]*?)<\/(?:soleVotingPower|solePowerOrDirectToVote)>/gi, "\nSole Voting Power\n$1\n"],
    [/<(?:sharedVotingPower|sharedPowerOrDirectToVote)\b[^>]*>([\s\S]*?)<\/(?:sharedVotingPower|sharedPowerOrDirectToVote)>/gi, "\nShared Voting Power\n$1\n"],
    [/<(?:soleDispositivePower|solePowerOrDirectToDispose)\b[^>]*>([\s\S]*?)<\/(?:soleDispositivePower|solePowerOrDirectToDispose)>/gi, "\nSole Dispositive Power\n$1\n"],
    [/<(?:sharedDispositivePower|sharedPowerOrDirectToDispose)\b[^>]*>([\s\S]*?)<\/(?:sharedDispositivePower|sharedPowerOrDirectToDispose)>/gi, "\nShared Dispositive Power\n$1\n"],
    [/<(?:aggregateAmountOwned|aggregateAmountBeneficiallyOwned|amountBeneficiallyOwned|reportingPersonBeneficiallyOwnedAggregateNumberOfShares)\b[^>]*>([\s\S]*?)<\/(?:aggregateAmountOwned|aggregateAmountBeneficiallyOwned|amountBeneficiallyOwned|reportingPersonBeneficiallyOwnedAggregateNumberOfShares)>/gi, "\nAggregate Amount Beneficially Owned by Each Reporting Person\n$1\n"],
    [/<(?:percentOfClass|percentOfClassRepresented|classPercent)\b[^>]*>([\s\S]*?)<\/(?:percentOfClass|percentOfClassRepresented|classPercent)>/gi, "\nPercent of Class Represented by Amount in Row (9)\n$1\n"],
    [/<(?:typeOfReportingPerson)\b[^>]*>([\s\S]*?)<\/(?:typeOfReportingPerson)>/gi, "\nType of Reporting Person\n$1\n"],
    [/<(?:citizenshipOrOrganization|citizenship)\b[^>]*>([\s\S]*?)<\/(?:citizenshipOrOrganization|citizenship)>/gi, "\nCitizenship or Place of Organization\n$1\n"],
    [/<(?:sourceOfFunds)\b[^>]*>([\s\S]*?)<\/(?:sourceOfFunds)>/gi, "\nSource of Funds\n$1\n"],
  ];
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }
  return output.replace(/<item([1-9]|10)\b[^>]*>([\s\S]*?)<\/item\1>/gi, (_match, itemNumber: string, body: string) => {
    if (isXmlBooleanOnlyItemBody(body)) return "\n";
    return `\nItem ${itemNumber}.\n${body}\n`;
  });
}

function isXmlBooleanOnlyItemBody(value: string): boolean {
  const withoutFlagTags = value.replace(/<notApplicableFlag\b[^>]*>\s*[YN]\s*<\/notApplicableFlag>/gi, " ");
  const stripped = withoutFlagTags.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped === "" || /^[YN]$/i.test(stripped);
}

function hasMalformedMarkup(value: string): boolean {
  const opens = (value.match(/<[A-Za-z][^/!?>]*?>/g) ?? []).length;
  const closes = (value.match(/<\/[A-Za-z][^>]*>/g) ?? []).length;
  return opens > 0 && closes === 0;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&ensp;|&emsp;|&thinsp;|&#160;?;?|&#8239;?;?|&#8194;?;?|&#8195;?;?|&#8201;?;?/gi, " ")
    .replace(/&yacute;|&#253;?/gi, "\u2612")
    .replace(/&thorn;|&#254;?/gi, "\u2610")
    .replace(/\u00fd/g, "\u2612")
    .replace(/\u00fe/g, "\u2610")
    .replace(/&amp;/gi, "&")
    .replace(/&yacute;/gi, "\u2612")
    .replace(/&thorn;|&uml;/gi, "\u2610")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&mdash;/gi, "-")
    .replace(/&ndash;/gi, "-")
    .replace(/&rsquo;|&#8217;/gi, "'")
    .replace(/&lsquo;|&#8216;/gi, "'")
    .replace(/&ldquo;|&#8220;/gi, "\"")
    .replace(/&rdquo;|&#8221;/gi, "\"")
    .replace(/&#168;?|&uml;/gi, "\u2610")
    .replace(/&#9744;?/gi, "\u2610")
    .replace(/&#9745;?|&#9746;?/gi, "\u2612")
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function firstItemIndex(text: string): number | null {
  const match = /(?:^|\n)\s*Item\s*1\b/i.exec(text);
  return match?.index ?? null;
}

function nextMeaningfulLine(lines: string[], startIndex: number): string | null {
  for (let index = startIndex; index < lines.length; index += 1) {
    const candidate = cleanFieldValue(lines[index] ?? "");
    if (candidate && !isBoilerplateLine(candidate)) return candidate;
  }
  return null;
}

function previousMeaningfulLine(lines: string[], startIndex: number): { value: string; index: number } | null {
  for (let index = startIndex; index >= 0; index -= 1) {
    const candidate = cleanFieldValue(lines[index] ?? "");
    if (candidate && !isBoilerplateLine(candidate)) return { value: candidate, index };
  }
  return null;
}

function shouldPrependCaptionContinuation(previous: string, currentFirst: string): boolean {
  return (
    /,\s*$/.test(previous) ||
    (/^(?:common|ordinary|preferred)$/i.test(previous) && /^stock|shares?/i.test(currentFirst)) ||
    (/^class\s+[a-z0-9]+$/i.test(previous) && /^(?:common|ordinary|preferred|stock|shares?)/i.test(currentFirst)) ||
    (/\b(?:inc\.?|corp\.?|corporation|llc|l\.l\.c\.|ltd\.?|plc|lp|l\.p\.|ag|sa|n\.v\.|etf)\b\.?$/i.test(currentFirst) &&
      /^[A-Z0-9][A-Za-z0-9 .,&'-]+$/.test(previous)) ||
    /^(?:inc\.?|corp\.?|corporation|llc|l\.l\.c\.|ltd\.?|plc|lp|l\.p\.|ag|sa|n\.v\.|etf)$/i.test(currentFirst)
  );
}

function findSectionStartAfter(text: string, start: number): number | null {
  const rest = text.slice(start + 1);
  const match = /\n\s*Item\s*\d+[A-Z]?\.?|\n\s*SIGNATURE/i.exec(rest);
  return match?.index === undefined ? null : start + 1 + match.index;
}

function cleanFieldValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/^[\s:|\-]+/, "")
    .replace(/[\s|]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === ":" || cleaned === "|" || cleaned === ")" || cleaned === "* * *") return null;
  return cleaned;
}

function cleanIssuerName(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  return cleaned
    .replace(/^the\s+name\s+of\s+the\s+issuer\s+is\s+/i, "")
    .replace(/^the\s+name\s+of\s+issuer\s+is\s+/i, "")
    .replace(/\s+\(b\)\s+address\s+of\s+issuer[\s\S]*$/i, "")
    .replace(/\s+address\s+of\s+issuer[\s\S]*$/i, "")
    .replace(/\s*\(\s*the\s+["'“”]?\s*issuer\s*["'“”]?\s*\)\.?.*$/i, "")
    .replace(/,\s+a\s+[A-Za-z ]+\s+corporation\b.*$/i, "")
    .trim();
}

function isBoilerplateLine(value: string): boolean {
  return (
    /^\*+\s*\*+\s*\*+$/.test(value) ||
    /^&nbsp;$/i.test(value) ||
    /^\d+$/.test(value) ||
    /^UNITED STATES$/i.test(value) ||
    /^SECURITIES AND EXCHANGE COMMISSION/i.test(value) ||
    /^Washington,\s*D\.?C\.?/i.test(value) ||
    /^Under the Securities Exchange Act/i.test(value) ||
    /^Information Statement Pursuant/i.test(value) ||
    /^\(?Amendment\s+No\.?\s*\)?\*?$/i.test(value) ||
    /^SCHEDULE\s+13[DG](?:\/A)?$/i.test(value) ||
    /^CUSIP\s+(?:No\.?|Number)/i.test(value) ||
    /^Page\s+\d+/i.test(value) ||
    /^Item\s+\d+/i.test(value) ||
    /^NOT\s+APPLICABLE$/i.test(value) ||
    /^SEC\s+USE\s+ONLY$/i.test(value) ||
    /^CHECK\s+(?:THE\s+APPROPRIATE\s+)?BOX/i.test(value) ||
    /^CHECK\s+THE\s+APPROPRIATE\s+BOX/i.test(value) ||
    /^Citizenship\s+or\s+Place\s+of\s+Organization/i.test(value) ||
    /^Owned\s+by\s+Each\s+Reporting\s+Person$/i.test(value) ||
    /^Beneficially\s+Owned\s+by\s+Each\s+Reporting\s+Person(?:\s+With)?$/i.test(value) ||
    /^By\s+Amount\s+in\s+Row/i.test(value) ||
    /^Amount\s+in\s+Row/i.test(value) ||
    /^Represented\s+by$/i.test(value) ||
    /^NOS?\.?\s+OF\s+ABOVE\s+PERSONS/i.test(value) ||
    /^OF\s+ABOVE\s+PERSONS/i.test(value) ||
    /^\(?See\b/i.test(value) ||
    /Instructions?\)?$/i.test(value) ||
    /^I\.R\.S\./i.test(value) ||
    /^IRS\s+(?:No\.?|Number)/i.test(value) ||
    /I\.R\.S\.\s+Identification/i.test(value) ||
    /S\.S\.\s+or\s+I\.R\.S/i.test(value) ||
    /^\(?Name\s+of\s+Issuer\)?$/i.test(value) ||
    /^\(?Title\s+of\s+Class\s+of\s+Securities\)?$/i.test(value) ||
    /^\(?CUSIP\s+Number\)?$/i.test(value) ||
    /^\(?Date\s+of\s+Event/i.test(value)
  );
}

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").replace(/^\|+\s*|\s*\|+$/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function cleanWhitespace(value: string | null | undefined): string | null {
  return cleanText(value);
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function withPeriod(value: string): string {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (/^(?:none|-?0-?|0(?:\.0+)?(?:\s+shares?)?)$/.test(normalized)) return 0;
  if (/^(?:n\/a|not applicable)$/.test(normalized)) return null;
  const compactValue = value.replace(/(?<=\d)\s+(?=\d{3}(?:\D|$))/g, "");
  const matches = [...compactValue.matchAll(/-?[\d,]+(?:\.\d+)?/g)].map((match) => match[0]);
  if (matches.length === 0) return null;
  const selected = /row\s+\(?\d+\)?/i.test(value) && matches.length > 1 ? matches[matches.length - 1] : matches[0];
  const parsed = Number.parseFloat(selected.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercent(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (/^(?:none|-?0-?|0(?:\.0+)?\s*%)$/.test(normalized)) return 0;
  const explicit = /-?\d+(?:\.\d+)?\s*%/.exec(value);
  const matches = [...value.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => match[0]);
  const selected = explicit?.[0] ?? matches[matches.length - 1];
  if (!selected) return null;
  const parsed = Number.parseFloat(selected.replace(/%/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}
