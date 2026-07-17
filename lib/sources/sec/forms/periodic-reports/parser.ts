import type {
  ConfidenceLevel,
  PeriodicParserOutput,
  PeriodicRawEvidence,
  PeriodicReportAmendmentFacts,
  PeriodicReportCalendarItem,
  PeriodicReportCoverPageFacts,
  PeriodicReportContextSnippet,
  PeriodicReportCoverageCheck,
  PeriodicReportFacts,
  PeriodicReportNoiseCandidate,
  PeriodicReportSection,
  PeriodicReportSecurity,
  PeriodicReportSourceDocument,
  PeriodicReportSourcePackage,
  PeriodicReportXbrlFact,
  SupportedPeriodicReportForm,
} from "./types";

export const SEC_PERIODIC_REPORTS_PARSER_VERSION = "sec_periodic_reports_raw_parser_v4";

const PERIODIC_REPORTS_PARSER_GROUP = "periodic-reports";
const PERIODIC_REPORTS_FORM_SCOPE = "10-K / 10-Q / 20-F, 10-K/A / 10-Q/A / 20-F/A";
const SUPPORTED_PERIODIC_REPORT_FORMS = ["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"] as const;
const PERIODIC_REPORTS_DEFAULT_DISPLAY_TYPE = "generic";
const PERIODIC_REPORTS_DISPLAY_VERSION = "periodic_report_display_v2";
const CORE_DOCUMENT_PERIOD_XBRL_CONCEPTS = new Set([
  "documenttype",
  "documentfiscalperiodfocus",
  "documentfiscalyearfocus",
  "documentperiodenddate",
  "currentfiscalyearenddate",
]);
const SOURCE_MATERIAL_CHECK_IDS = new Set([
  "source_package_inventory",
  "primary_document_inventory",
  "filing_text",
  "attachment_text_inventory",
  "xbrl_document_inventory",
  "xbrl_fact_inventory",
  "source_truncation_check",
]);

export type SecPeriodicReportParseInput = {
  rawItemId?: string | null;
  sourceUniqueId?: string | null;
  sourceUrl?: string | null;
  title?: string | null;
  publishedAt?: string | null;
  bodyText?: string | null;
  analysisText?: string | null;
  attachment_texts?: unknown;
  attachmentTexts?: unknown;
  documents?: unknown;
  xbrl_facts?: unknown;
  xbrlFacts?: unknown;
  rawPayload?: unknown;
  metadata?: unknown;
  parentFilingContext?: unknown;
};

type SecDocumentPayload = {
  sequence?: unknown;
  type?: unknown;
  description?: unknown;
  filename?: unknown;
  url?: unknown;
  href?: unknown;
  isPrimary?: unknown;
  text?: unknown;
  textCharCount?: unknown;
  textTruncated?: unknown;
  rawHtml?: unknown;
  rawHtmlCharCount?: unknown;
  rawHtmlTruncated?: unknown;
};

type AttachmentTextPayload = {
  sequence?: unknown;
  type?: unknown;
  description?: unknown;
  filename?: unknown;
  url?: unknown;
  href?: unknown;
  text?: unknown;
  textCharCount?: unknown;
  textTruncated?: unknown;
};

type SectionHeading = {
  item: string;
  title: string;
  part: string | null;
  index: number;
};

type EvidencePattern = {
  category: string;
  label: string;
  pattern: RegExp;
  confidence: ConfidenceLevel;
  locationHint?: string;
};

type PrimaryDocumentCandidate = {
  document: SecDocumentPayload;
  index: number;
  score: number;
  hardExcluded: boolean;
  reasons: string[];
  normalizedText: string;
};

type PrimaryDocumentSelection = {
  selected: SecDocumentPayload | null;
  confidence: ConfidenceLevel;
  warnings: string[];
};

type DeterministicParserClassification = {
  can_finish_without_llm: boolean;
  event_type: "other";
  display_type: typeof PERIODIC_REPORTS_DEFAULT_DISPLAY_TYPE;
  display_version: typeof PERIODIC_REPORTS_DISPLAY_VERSION;
  score: number;
  derived_delivery_level: "archive";
  analysis_llm_needed: false;
  reason: string;
  evidence: string[];
};

type VisibleBlockKind = "heading" | "paragraph" | "table" | "list" | "cover_page" | "signature" | "exhibit_index" | "empty_decorative";

type VisibleDomBlock = {
  index: number;
  kind: VisibleBlockKind;
  text: string;
  sourceTag: string | null;
  sourcePath: string;
  sourceStart: number | null;
  sourceEnd: number | null;
  tableLike: boolean;
  layoutTableLike: boolean;
  containsInlineXbrl: boolean;
  confidence: ConfidenceLevel;
};

type InlineXbrlMention = {
  blockIndex: number;
  tag: string;
  name: string | null;
  contextRef: string | null;
  unitRef: string | null;
  decimals: string | null;
  visibleText: string;
};

type VisibleTableCell = {
  rowIndex: number;
  columnIndex: number;
  text: string;
  isHeader: boolean;
  rowSpan: number;
  colSpan: number;
  empty: boolean;
  containsInlineXbrl: boolean;
  inlineXbrlMentions: InlineXbrlMention[];
};

type VisibleTableRow = {
  index: number;
  cells: VisibleTableCell[];
  text: string;
  headerLike: boolean;
  numericCellCount: number;
};

type VisibleTableClassification = "data" | "layout" | "toc" | "exhibit_index" | "uncertain";

type VisibleTable = {
  index: number;
  classification: VisibleTableClassification;
  confidence: ConfidenceLevel;
  typeHints: string[];
  caption: string | null;
  unitHint: string | null;
  footnotes: string[];
  rowCount: number;
  columnCount: number;
  cellCount: number;
  numericCellCount: number;
  rows: VisibleTableRow[];
  text: string;
  sourceStart: number | null;
  sourceEnd: number | null;
  blockIndex: number | null;
  warnings: string[];
};

type SecVisibleDocument = {
  text: string;
  blocks: VisibleDomBlock[];
  tables: VisibleTable[];
  inlineXbrlMentions: InlineXbrlMention[];
  warnings: string[];
  diagnostics: {
    parser: "sec_visible_dom_stream_v1" | "plain_text_fallback";
    inputChars: number;
    visibleChars: number;
    blockCount: number;
    tableBlockCount: number;
    extractedTableCount: number;
    inlineXbrlVisibleMentionCount: number;
  };
};

function buildSourcePackage({
  attachmentTexts,
  documents,
  rootInput,
  rawPayload,
}: {
  attachmentTexts: AttachmentTextPayload[];
  documents: SecDocumentPayload[];
  rootInput: SecPeriodicReportParseInput;
  rawPayload: Record<string, unknown>;
}): PeriodicReportSourcePackage {
  const sourceDocuments = dedupeSourceDocuments(documents.map(mapSourceDocument));
  const rawAttachments = recordArray(rawPayload.attachments) as AttachmentTextPayload[];
  const attachmentInventory = [...rawAttachments.map((item) => mapAttachmentText(item, false)), ...attachmentTexts.map((item) => mapAttachmentText(item, true))];
  const xbrlFacts = normalizeXbrlFacts(rawPayload, rootInput, [...rawAttachments, ...attachmentTexts], documents);
  const retainedXbrlFacts = retainXbrlFacts(xbrlFacts, 200);

  return {
    documents: sourceDocuments,
    attachmentTexts: dedupeAttachmentTexts(attachmentInventory).slice(0, 80),
    xbrlFacts: retainedXbrlFacts,
    documentCount: sourceDocuments.length,
    attachmentTextCount: attachmentTexts.length,
    xbrlFactCount: xbrlFacts.length,
    retainedXbrlFactCount: retainedXbrlFacts.length,
    hasPrimaryDocument: sourceDocuments.some((document) => document.isPrimary),
    hasInlineXbrlDocument: sourceDocuments.some((document) => document.isInlineXbrl),
    hasMachineReadableXbrlDocument: sourceDocuments.some((document) => document.isMachineReadableXbrl),
    hasTruncatedSource: sourceDocuments.some((document) => document.textTruncated) || attachmentInventory.some((attachment) => attachment.textTruncated),
  };
}

function retainXbrlFacts(facts: PeriodicReportXbrlFact[], limit: number) {
  if (facts.length <= limit) return facts;

  const coreFacts: PeriodicReportXbrlFact[] = [];
  const retainedCoreConcepts = new Set<string>();
  for (const fact of facts) {
    const concept = normalizeXbrlConceptName(fact.name);
    if (!CORE_DOCUMENT_PERIOD_XBRL_CONCEPTS.has(concept) || retainedCoreConcepts.has(concept)) continue;
    retainedCoreConcepts.add(concept);
    coreFacts.push(fact);
  }

  const coreFinancialFacts = facts
    .filter((fact) => typeof fact.value === "number" && isCoreFinancialXbrlConcept(fact.name))
    .sort(compareXbrlFacts)
    .slice(0, 120);
  const coreSet = new Set([...coreFacts, ...coreFinancialFacts]);
  const ordinaryFacts = facts.filter((fact) => !coreSet.has(fact));
  return [
    ...coreFacts,
    ...coreFinancialFacts,
    ...ordinaryFacts.slice(0, Math.max(0, limit - coreSet.size)),
  ].slice(0, limit);
}

function normalizeXbrlConceptName(name: string) {
  return (name.split(":").pop() || name).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isCoreFinancialXbrlConcept(name: string) {
  const concept = normalizeXbrlConceptName(name);
  if (/(?:practicalexpedient|policy|disclosure|textblock|extensibleenumeration|member|axis|domain)/.test(concept)) return false;
  return /^(?:revenues?|totalrevenues?|salesrevenuenet|salesrevenuegoodsnet|salesrevenueservicesnet|revenuefromcontractwithcustomerexcludingassessedtax|revenuefromcontractwithcustomerincludingassessedtax|grossprofit|operatingincomeloss|operatingprofitloss|profitlossfromoperatingactivities|netincomeloss|profitloss|profitfortheyear|profitlossattributabletoownersofparent|earningspersharebasic|earningspersharediluted|basicearningslosspershare|dilutedearningslosspershare|netcashprovidedbyusedinoperatingactivities|cashflowsfromusedinoperatingactivities|cashandcashequivalents|longtermdebt|shorttermdebt|borrowings)$/.test(concept);
}

type XbrlDocumentPeriodMetadata = {
  reportingPeriod: string | null;
  fiscalYear: string | null;
  fiscalQuarter: string | null;
  documentFiscalPeriodFocus: string | null;
  documentFiscalYearFocus: string | null;
  documentPeriodEndDate: string | null;
  currentFiscalYearEndDate: string | null;
};

function readXbrlDocumentPeriodMetadata(facts: PeriodicReportXbrlFact[]): XbrlDocumentPeriodMetadata {
  const factsByConcept = new Map<string, PeriodicReportXbrlFact[]>();
  for (const fact of facts) {
    const concept = normalizeXbrlConceptName(fact.name);
    if (!CORE_DOCUMENT_PERIOD_XBRL_CONCEPTS.has(concept)) continue;
    const conceptFacts = factsByConcept.get(concept) || [];
    conceptFacts.push(fact);
    factsByConcept.set(concept, conceptFacts);
  }

  const firstConceptValue = (concept: string) =>
    factsByConcept.get(concept)?.map((fact) => nullableString(fact.value)).find(Boolean) || null;
  const documentFiscalPeriodFocus = firstConceptValue("documentfiscalperiodfocus");
  const documentFiscalYearFocus = firstConceptValue("documentfiscalyearfocus");
  const documentPeriodEndDate = firstConceptValue("documentperiodenddate");
  const currentFiscalYearEndDate = firstConceptValue("currentfiscalyearenddate");
  const documentPeriodFacts = factsByConcept.get("documentperiodenddate") || [];
  const reportingPeriod =
    documentPeriodFacts
      .map((fact) => normalizeXbrlPeriodEndDate(nullableString(fact.value)))
      .find(Boolean) ||
    documentPeriodFacts
      .map((fact) => normalizeXbrlPeriodEndDate(fact.period))
      .find(Boolean) ||
    null;

  return {
    reportingPeriod,
    fiscalYear: normalizeFiscalYear(documentFiscalYearFocus),
    fiscalQuarter: normalizeFiscalQuarter(documentFiscalPeriodFocus),
    documentFiscalPeriodFocus,
    documentFiscalYearFocus,
    documentPeriodEndDate,
    currentFiscalYearEndDate,
  };
}

function normalizeFiscalYear(value: unknown) {
  return nullableString(value)?.match(/\b(19\d{2}|20\d{2})\b/)?.[1] || null;
}

function normalizeFiscalQuarter(value: unknown) {
  const text = nullableString(value)?.toLowerCase();
  if (!text) return null;
  if (/^(?:q1|first(?:\s+fiscal)?\s+quarter)$/.test(text)) return "first quarter";
  if (/^(?:q2|second(?:\s+fiscal)?\s+quarter)$/.test(text)) return "second quarter";
  if (/^(?:q3|third(?:\s+fiscal)?\s+quarter)$/.test(text)) return "third quarter";
  if (/^(?:q4|fourth(?:\s+fiscal)?\s+quarter|fy|annual|year)$/.test(text)) return text === "q4" || text.startsWith("fourth") ? "fourth quarter" : null;
  return null;
}

function normalizeXbrlPeriodEndDate(value: string | null) {
  if (!value) return null;
  const isoMatches = [...value.matchAll(/\b(19\d{2}|20\d{2})-(\d{2})-(\d{2})\b/g)];
  const isoMatch = isoMatches.at(-1);
  const naturalMatch = value.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(19\d{2}|20\d{2})\b/i,
  );
  const year = isoMatch?.[1] || naturalMatch?.[3];
  const monthIndex = isoMatch
    ? Number(isoMatch[2]) - 1
    : naturalMatch
      ? [
        "january", "february", "march", "april", "may", "june",
        "july", "august", "september", "october", "november", "december",
      ].indexOf(naturalMatch[1].toLowerCase())
      : -1;
  const day = Number(isoMatch?.[3] || naturalMatch?.[2]);
  const month = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ][monthIndex];
  if (!year || !month || day < 1 || day > 31) return null;
  return `${month} ${day}, ${year}`;
}

function dedupeSourceDocuments(documents: PeriodicReportSourceDocument[]) {
  const result: PeriodicReportSourceDocument[] = [];
  const seen = new Set<string>();
  for (const document of documents) {
    const key = [
      document.sequence || "",
      document.type || "",
      document.filename || "",
      document.url || "",
      document.description || "",
      String(document.textCharCount),
    ]
      .join(":")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(document);
  }
  return result;
}

function mapSourceDocument(document: SecDocumentPayload): PeriodicReportSourceDocument {
  const type = nullableString(document.type);
  const description = nullableString(document.description);
  const filename = nullableString(document.filename);
  const url = nullableString(document.url) || nullableString(document.href);
  const label = compactText([type, description, filename].filter(Boolean).join(" "));
  const textCharCount = numberValue(document.textCharCount) || stringValue(document.text).length;

  return {
    sequence: nullableString(document.sequence),
    type,
    description,
    filename,
    url,
    isPrimary: Boolean(document.isPrimary),
    hasText: textCharCount > 0 || Boolean(stringValue(document.text)),
    textCharCount,
    textTruncated: Boolean(document.textTruncated),
    isInlineXbrl: /\binline\s+xbrl\b/i.test(label) || /\.ix?brl$/i.test(filename || ""),
    isMachineReadableXbrl: /\b(?:EX-101|XBRL|XML|XSD|CAL|DEF|LAB|PRE|INS)\b/i.test(label) || /\.(?:xml|xsd|cal|def|lab|pre|ins)$/i.test(filename || ""),
    isLikelyBoilerplateExhibit: /\b(?:EX-31|EX-32|CERTIFICATION|SIGNATURE)\b/i.test(label),
    evidence: truncate(label || "document without type or description", 300),
  };
}

function mapAttachmentText(attachment: AttachmentTextPayload, includedInSourceText: boolean) {
  const type = nullableString(attachment.type);
  const description = nullableString(attachment.description);
  const filename = nullableString(attachment.filename);
  const url = nullableString(attachment.url) || nullableString(attachment.href);
  const text = stringValue(attachment.text);
  const textCharCount = numberValue(attachment.textCharCount) || text.length;
  const evidence = compactText([type, description, filename, text ? `text chars ${text.length}` : ""].filter(Boolean).join(" "));

  return {
    sequence: nullableString(attachment.sequence),
    type,
    description,
    filename,
    url,
    textCharCount,
    textTruncated: Boolean(attachment.textTruncated),
    includedInSourceText,
    evidence: truncate(evidence || "attachment without type or description", 300),
  };
}

function dedupeDocumentPayloads(documents: SecDocumentPayload[]) {
  const result: SecDocumentPayload[] = [];
  const seen = new Set<string>();
  for (const document of documents) {
    const key = [
      nullableString(document.sequence) || "",
      nullableString(document.type) || "",
      nullableString(document.filename) || "",
      nullableString(document.url) || nullableString(document.href) || "",
      nullableString(document.description) || "",
      String(numberValue(document.textCharCount) || stringValue(document.text).length),
    ]
      .join(":")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(document);
  }
  return result;
}

function selectPrimaryFilingDocument(documents: SecDocumentPayload[], formType: SupportedPeriodicReportForm | null, title: unknown): PrimaryDocumentSelection {
  if (!documents.length) {
    return { selected: null, confidence: "low", warnings: ["primary_document_selection_missing_inventory"] };
  }

  const amendmentMode = Boolean((formType && /\/A$/i.test(formType)) || /\b(?:10-K|10-Q|20-F)\/A\b|Amendment\s+No\.?/i.test(stringValue(title)));
  const candidates = documents
    .map((document, index) => scorePrimaryDocumentCandidate(document, index, formType, amendmentMode))
    .sort((left, right) => right.score - left.score);
  const safeCandidates = candidates.filter((candidate) => !candidate.hardExcluded && candidate.score >= 30);
  const best = safeCandidates[0] || null;
  if (!best) {
    return { selected: null, confidence: "low", warnings: ["primary_document_selection_failed"] };
  }

  const second = safeCandidates[1] || null;
  const ambiguous = Boolean(second && best.score - second.score <= 25 && second.score >= 80);
  const lowConfidence = best.score < (amendmentMode ? 105 : 125) || ambiguous;
  const warnings: string[] = [];
  const extension = readDocumentExtension(best.document);
  if (ambiguous) warnings.push("primary_document_selection_ambiguous");
  if (lowConfidence) warnings.push("primary_document_selection_low_confidence");
  if (extension === "txt") warnings.push("primary_document_txt_fallback");

  return {
    selected: best.document,
    confidence: lowConfidence ? "medium" : "high",
    warnings,
  };
}

function scorePrimaryDocumentCandidate(document: SecDocumentPayload, index: number, formType: SupportedPeriodicReportForm | null, amendmentMode: boolean): PrimaryDocumentCandidate {
  const type = nullableString(document.type);
  const canonicalType = canonicalPeriodicFormType(type);
  const description = nullableString(document.description);
  const filename = nullableString(document.filename);
  const url = nullableString(document.url) || nullableString(document.href);
  const label = compactText([type, description, filename, url].filter(Boolean).join(" "));
  const extension = readDocumentExtension(document);
  const rawText = stringValue(document.text);
  const normalizedText = normalizeSecSourceText(rawText);
  const visibleChars = normalizedText.length || numberValue(document.textCharCount);
  const reasons: string[] = [];
  let score = 0;
  let hardExcluded = false;

  // These package artifacts are not human-readable primary filings, even when large.
  if (isMachineReadableDocument(label, extension, rawText)) {
    score -= 1000;
    hardExcluded = true;
    reasons.push("machine_readable_or_xbrl");
  }
  if (isImageOrGraphicDocument(label, extension)) {
    score -= 1000;
    hardExcluded = true;
    reasons.push("image_or_graphic");
  }
  if (extension === "pdf") {
    score -= 600;
    hardExcluded = true;
    reasons.push("pdf_not_supported_as_primary");
  }
  if (isCertificationDocument(label)) {
    score -= 600;
    hardExcluded = true;
    reasons.push("certification");
  }
  if (isPressReleaseOrPresentation(label)) {
    score -= 350;
    reasons.push("press_release_or_presentation");
  }
  if (isGenericExhibitDocument(label, canonicalType)) {
    score -= 280;
    reasons.push("exhibit_document");
  }
  if (looksLikeExhibitIndexOnly(normalizedText)) {
    score -= 180;
    reasons.push("exhibit_index_only");
  }
  if (looksLikeCoverOnlyStub(normalizedText)) {
    score -= 150;
    reasons.push("cover_only_stub");
  }

  if (formType && canonicalType === formType) {
    score += 140;
    reasons.push("exact_form_type");
  } else if (canonicalType) {
    score += 65;
    reasons.push("periodic_form_type");
  }
  if (Boolean(document.isPrimary)) {
    score += 25;
    reasons.push("runtime_primary_flag");
  }
  if (extension === "htm" || extension === "html") {
    score += 30;
    reasons.push("html_document");
  } else if (extension === "txt") {
    score += 12;
    reasons.push("txt_fallback");
  }
  if (hasSubstantiveVisibleText(normalizedText, visibleChars)) {
    score += 35;
    reasons.push("substantive_visible_text");
  } else {
    score -= 80;
    reasons.push("little_or_no_visible_text");
  }
  if (hasCoverPageLikeText(normalizedText)) {
    score += 45;
    reasons.push("cover_page_text");
  }
  if (hasExpectedFormHeadings(normalizedText, formType)) {
    score += 18;
    reasons.push("expected_form_headings");
  }
  if (amendmentMode && hasAmendmentScopeText(normalizedText)) {
    score += 65;
    reasons.push("amendment_scope_text");
  }
  if (isHumanReadableInlineXbrlBody(label, extension, normalizedText)) {
    score += 10;
    reasons.push("human_readable_inline_xbrl_body");
  }
  if (!hardExcluded && visibleChars > 0) {
    score += Math.min(35, Math.floor(Math.log10(Math.max(visibleChars, 1)) * 10));
    reasons.push("substantive_size_signal");
  }

  return { document, index, score, hardExcluded, reasons, normalizedText };
}

function applyPrimaryDocumentSelection(documents: SecDocumentPayload[], selection: PrimaryDocumentSelection) {
  if (!selection.selected) return documents.map((document) => ({ ...document, isPrimary: false }));
  return documents.map((document) => ({ ...document, isPrimary: document === selection.selected }));
}

function readDocumentExtension(document: SecDocumentPayload) {
  const path = nullableString(document.filename) || nullableString(document.url) || nullableString(document.href) || "";
  return path.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)?.[1]?.toLowerCase() || null;
}

function isMachineReadableDocument(label: string, extension: string | null, text: string) {
  const isHtml = extension === "htm" || extension === "html";
  return (
    /\b(?:EX-101|XML|XSD|CAL|DEF|LAB|PRE|INS|SCHEMA|LINKBASE)\b/i.test(label) ||
    (/\bXBRL\b/i.test(label) && !isHtml) ||
    /\.(?:xml|xsd|cal|def|lab|pre|ins)$/i.test(label) ||
    ["xml", "xsd", "cal", "def", "lab", "pre", "ins"].includes(extension || "") ||
    /<(?:xbrli:xbrl|xbrl|link:linkbase|xs:schema)\b/i.test(text.slice(0, 1200))
  );
}

function isImageOrGraphicDocument(label: string, extension: string | null) {
  return (
    /^\s*GRAPHIC\b/i.test(label) ||
    /\b(?:LOGO|IMAGE FILE|GRAPHIC FILE|JPEG|JPG|PNG|GIF|SVG)\b/i.test(label) ||
    ["jpg", "jpeg", "png", "gif", "svg", "webp", "bmp", "tif", "tiff"].includes(extension || "")
  );
}

function isCertificationDocument(label: string) {
  return /\b(?:EX-31|EX-32|SECTION\s+302|SECTION\s+906|CERTIFICATION)\b/i.test(label);
}

function isPressReleaseOrPresentation(label: string) {
  return /\b(?:PRESS RELEASE|INVESTOR PRESENTATION|PRESENTATION|FACT SHEET|SLIDE)\b/i.test(label);
}

function isGenericExhibitDocument(label: string, canonicalType: SupportedPeriodicReportForm | null) {
  return !canonicalType && /\bEX-\d/i.test(label);
}

function hasSubstantiveVisibleText(text: string, visibleChars: number) {
  return visibleChars >= 400 || text.split(/\s+/).filter(Boolean).length >= 80;
}

function hasCoverPageLikeText(text: string) {
  return /\bUNITED STATES\s+SECURITIES AND EXCHANGE COMMISSION\b/i.test(text) || /\bFORM\s+(?:10-K\/A|10-Q\/A|20-F\/A|10-K|10-Q|20-F)\b/i.test(text) || /\bExact name of registrant\b/i.test(text);
}

function hasExpectedFormHeadings(text: string, formType: SupportedPeriodicReportForm | null) {
  if (formType === "20-F" || formType === "20-F/A") return /\bITEM\s+3\.?D\b/i.test(text) || /\bITEM\s+4\b/i.test(text) || /\bITEM\s+5\b/i.test(text) || /\bITEM\s+8\b/i.test(text);
  if (formType === "10-Q" || formType === "10-Q/A") return /\bPART\s+I\b[\s\S]{0,1200}\bITEM\s+1\b/i.test(text) || /\bITEM\s+2\b[^.\n]{0,120}Management/i.test(text);
  if (formType === "10-K" || formType === "10-K/A") return /\bITEM\s+1\b/i.test(text) || /\bITEM\s+7\b/i.test(text) || /\bITEM\s+8\b/i.test(text);
  return /\bITEM\s+(?:1|2|3\.D|4|5|7|8)\b/i.test(text);
}

function hasAmendmentScopeText(text: string) {
  return /\b(?:EXPLANATORY NOTE|Purpose of Amendment|Amendment No\.?|amended item|solely to|no other changes|does not amend, update or change)\b/i.test(text);
}

function isHumanReadableInlineXbrlBody(label: string, extension: string | null, text: string) {
  return /\bInline\s+XBRL\b/i.test(label) && (extension === "htm" || extension === "html") && hasSubstantiveVisibleText(text, text.length) && hasCoverPageLikeText(text);
}

function looksLikeExhibitIndexOnly(text: string) {
  if (!text) return false;
  const exhibitHits = (text.match(/\bExhibit\s+\d|EX-\d/gi) || []).length;
  const itemHits = (text.match(/\bITEM\s+\d/gi) || []).length;
  return exhibitHits >= 4 && itemHits <= 1 && text.length < 2500;
}

function looksLikeCoverOnlyStub(text: string) {
  if (!text) return false;
  return hasCoverPageLikeText(text) && !hasExpectedFormHeadings(text, null) && !hasAmendmentScopeText(text) && text.length < 1800;
}

function normalizeXbrlFacts(
  rawPayload: Record<string, unknown>,
  rootInput: SecPeriodicReportParseInput,
  attachmentTexts: AttachmentTextPayload[],
  documents: SecDocumentPayload[],
): PeriodicReportXbrlFact[] {
  const xbrlPayload = toRecord(rawPayload.xbrl) || {};
  const candidates = [
    rawPayload.periodic_report_core_xbrl_facts,
    rawPayload.periodicReportCoreXbrlFacts,
    rawPayload.xbrl_facts,
    rawPayload.xbrlFacts,
    rawPayload.inline_xbrl_facts,
    rawPayload.inlineXbrlFacts,
    rootInput.xbrl_facts,
    rootInput.xbrlFacts,
    xbrlPayload.facts,
    xbrlPayload.xbrl_facts,
  ];
  const records = [
    ...candidates.flatMap(normalizeXbrlFactRecords),
    ...extractXbrlFactsFromSourceText(
      rawPayload.primary_document_html || rawPayload.primaryDocumentHtml,
      nullableString(rawPayload.primary_document_url) || readPrimaryDocumentName(documents) || nullableString(rootInput.sourceUrl),
    ),
    ...extractXbrlFactsFromSourceText(rootInput.bodyText, readPrimaryDocumentName(documents) || nullableString(rootInput.sourceUrl)),
    ...extractXbrlFactsFromSourceText(rootInput.analysisText, "analysisText"),
    ...attachmentTexts.flatMap((attachment) =>
      extractXbrlFactsFromSourceText(attachment.text, nullableString(attachment.filename) || nullableString(attachment.description) || nullableString(attachment.type)),
    ),
    ...documents.flatMap((document) => extractXbrlFactsFromSourceText(document.text, nullableString(document.filename) || nullableString(document.description) || nullableString(document.type))),
  ];
  const facts: PeriodicReportXbrlFact[] = [];
  const seen = new Set<string>();

  for (const record of records) {
    const name =
      nullableString(record.name) ||
      nullableString(record.concept) ||
      nullableString(record.tag) ||
      nullableString(record.qname) ||
      nullableString(record.factName);
    if (!name) continue;

    const value = readXbrlValue(record);
    const label = nullableString(record.label) || nullableString(record.balance) || null;
    const unitRef = nullableString(record.unitRef) || nullableString(record.unit) || nullableString(record.unit_ref);
    const decimals = nullableString(record.decimals);
    const contextRef = nullableString(record.contextRef) || nullableString(record.context_ref) || nullableString(record.context);
    const period = readXbrlPeriod(record);
    const statement = nullableString(record.statement) || nullableString(record.section) || nullableString(record.role);
    const sourceDocument = nullableString(record.sourceDocument) || nullableString(record.filename) || nullableString(record.document);
    const hasDimensions = typeof record.hasDimensions === "boolean"
      ? record.hasDimensions
      : typeof record.has_dimensions === "boolean"
        ? record.has_dimensions
        : null;
    const key = `${name}:${value}:${unitRef}:${contextRef}:${period}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    facts.push({
      name,
      label,
      value,
      unitRef,
      decimals,
      contextRef,
      period,
      statement,
      sourceDocument,
      hasDimensions,
      evidence: truncate([name, label, value === null ? null : String(value), unitRef, period].filter(Boolean).join(" | "), 420),
      confidence: value === null ? "medium" : "high",
    });
  }

  return facts.sort(compareXbrlFacts);
}

function extractXbrlFactsFromSourceText(value: unknown, sourceDocument: string | null): Record<string, unknown>[] {
  const text = stringValue(value);
  if (!text || !/(?:<ix:|<xbrli:xbrl|<xbrl|us-gaap:|ifrs-full:|dei:)/i.test(text)) return [];

  const cleaned = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const contextPeriods = extractXbrlContextPeriods(cleaned);
  const records: Record<string, unknown>[] = [];
  const inlinePattern = /<ix:(?:nonFraction|nonNumeric)\b([^>]*)>([\s\S]*?)<\/ix:(?:nonFraction|nonNumeric)>/gi;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlinePattern.exec(cleaned)) !== null && records.length < 2000) {
    const attrs = parseXmlAttributes(inlineMatch[1] || "");
    const name = nullableString(attrs.name);
    if (!name) continue;
    const contextRef = readAttribute(attrs, "contextRef");
    records.push({
      name,
      value: normalizeXmlFactValue(inlineMatch[2] || "", attrs),
      unitRef: readAttribute(attrs, "unitRef"),
      decimals: readAttribute(attrs, "decimals"),
      contextRef,
      period: contextRef ? contextPeriods.get(contextRef) || null : null,
      statement: inferXbrlStatement(name),
      scale: readAttribute(attrs, "scale"),
      format: readAttribute(attrs, "format"),
      sourceDocument,
    });
  }

  const xmlFactPattern = /<([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b([^>]*)>([^<]{1,1000})<\/\1>/gi;
  let xmlMatch: RegExpExecArray | null;
  while ((xmlMatch = xmlFactPattern.exec(cleaned)) !== null && records.length < 3000) {
    const name = xmlMatch[1] || "";
    if (/^(?:xbrli|link|xlink|xsi|ix):/i.test(name)) continue;
    const attrs = parseXmlAttributes(xmlMatch[2] || "");
    const contextRef = readAttribute(attrs, "contextRef");
    records.push({
      name,
      value: normalizeXmlFactValue(xmlMatch[3] || "", attrs),
      unitRef: readAttribute(attrs, "unitRef"),
      decimals: readAttribute(attrs, "decimals"),
      contextRef,
      period: contextRef ? contextPeriods.get(contextRef) || null : null,
      statement: inferXbrlStatement(name),
      sourceDocument,
    });
  }

  return records;
}

function extractXbrlContextPeriods(text: string) {
  const periods = new Map<string, string>();
  const pattern = /<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const attrs = parseXmlAttributes(match[1] || "");
    const id = readAttribute(attrs, "id");
    if (!id) continue;
    const body = match[2] || "";
    const instant = body.match(/<(?:xbrli:)?instant\b[^>]*>([^<]+)<\/(?:xbrli:)?instant>/i)?.[1]?.trim();
    const start = body.match(/<(?:xbrli:)?startDate\b[^>]*>([^<]+)<\/(?:xbrli:)?startDate>/i)?.[1]?.trim();
    const end = body.match(/<(?:xbrli:)?endDate\b[^>]*>([^<]+)<\/(?:xbrli:)?endDate>/i)?.[1]?.trim();
    const period = instant || (start && end ? `${start}/${end}` : end || start || null);
    if (period) periods.set(id, period);
  }
  return periods;
}

function readAttribute(attrs: Record<string, string>, name: string) {
  const entry = Object.entries(attrs).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] || null;
}

function inferXbrlStatement(name: string) {
  const concept = name.split(":").pop() || name;
  if (/Revenue|SalesRevenue|CostOfRevenue|GrossProfit|OperatingIncomeLoss|NetIncomeLoss|ProfitLoss|EarningsPerShare/i.test(concept)) {
    return "Income statement";
  }
  if (/Assets|Liabilities|StockholdersEquity|ShareholdersEquity|CashAndCashEquivalents|LongTermDebt|ShortTermDebt|Borrowings/i.test(concept)) {
    return "Balance sheet";
  }
  if (/NetCashProvidedByUsedIn|PaymentsToAcquire|ProceedsFrom|CashFlow/i.test(concept)) return "Cash flow statement";
  if (/CommonStockSharesOutstanding|EntityCommonStockSharesOutstanding|WeightedAverageNumberOfShares/i.test(concept)) return "Shares";
  return "Other reported XBRL facts";
}

function compareXbrlFacts(left: PeriodicReportXbrlFact, right: PeriodicReportXbrlFact) {
  if (left.hasDimensions !== right.hasDimensions) {
    if (left.hasDimensions === false) return -1;
    if (right.hasDimensions === false) return 1;
    if (left.hasDimensions === true) return 1;
    if (right.hasDimensions === true) return -1;
  }
  const statementRank = (statement: string | null) => {
    if (statement === "Income statement") return 0;
    if (statement === "Balance sheet") return 1;
    if (statement === "Cash flow statement") return 2;
    if (statement === "Shares") return 3;
    return 4;
  };
  const rank = statementRank(left.statement) - statementRank(right.statement);
  if (rank) return rank;
  return (right.period || "").localeCompare(left.period || "");
}

function parseXmlAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const rawName = match[1] || "";
    const name = rawName.includes(":") ? rawName.split(":").pop() || rawName : rawName;
    attrs[name] = decodeHtmlEntities(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function normalizeXmlFactValue(value: string, attrs: Record<string, string>) {
  const text = htmlToPlainText(value);
  if (!text) return null;
  if (/^(?:true|1)$/i.test(readAttribute(attrs, "nil") || "")) return null;
  const parenthesized = /^\(.*\)$/.test(text.trim());
  const sign = readAttribute(attrs, "sign") === "-" || parenthesized ? -1 : 1;
  const scale = Number(readAttribute(attrs, "scale") || 0);
  const normalized = text.replace(/[,$%()\s]/g, "");
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && /^-?[\d.]+$/.test(normalized)) {
    return numeric * sign * (Number.isFinite(scale) ? 10 ** scale : 1);
  }
  return text;
}

function readPrimaryDocumentName(documents: SecDocumentPayload[]) {
  const primary = documents.find((document) => Boolean(document.isPrimary));
  return primary ? nullableString(primary.filename) || nullableString(primary.description) || nullableString(primary.type) : null;
}

function normalizeXbrlFactRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }

  const record = toRecord(value);
  if (!record) return [];

  return Object.entries(record).flatMap(([name, factValue]) => {
    if (Array.isArray(factValue)) {
      return factValue
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => ({ name, ...item }));
    }
    const nested = toRecord(factValue);
    if (nested) return [{ name, ...nested }];
    return [{ name, value: factValue }];
  });
}

function readXbrlValue(record: Record<string, unknown>) {
  const value = record.value ?? record.val ?? record.text ?? record.amount;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    const numeric = Number(text.replace(/,/g, ""));
    return Number.isFinite(numeric) && /^-?[\d,.]+$/.test(text) ? numeric : text;
  }
  return null;
}

function readXbrlPeriod(record: Record<string, unknown>) {
  return (
    nullableString(record.period) ||
    nullableString(record.instant) ||
    nullableString(record.endDate) ||
    nullableString(record.end_date) ||
    [nullableString(record.startDate) || nullableString(record.start_date), nullableString(record.endDate) || nullableString(record.end_date)].filter(Boolean).join("/") ||
    null
  );
}

function dedupeAttachmentTexts(attachments: ReturnType<typeof mapAttachmentText>[]) {
  const result: ReturnType<typeof mapAttachmentText>[] = [];
  const seen = new Set<string>();
  for (const attachment of attachments) {
    const key = `${attachment.sequence || ""}:${attachment.type || ""}:${attachment.filename || ""}:${attachment.evidence}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(attachment);
  }
  return result;
}

export function parseSecPeriodicReport(input: SecPeriodicReportParseInput): PeriodicParserOutput {
  const rawPayload = toRecord(input.rawPayload) || {};
  const metadata = toRecord(input.metadata) || {};
  const rawDocuments = dedupeDocumentPayloads([...recordArray(rawPayload.documents), ...recordArray(input.documents)] as SecDocumentPayload[]);
  const attachmentTexts = [
    ...recordArray(rawPayload.attachment_texts),
    ...recordArray(rawPayload.attachmentTexts),
    ...recordArray(input.attachment_texts),
    ...recordArray(input.attachmentTexts),
  ] as AttachmentTextPayload[];
  const machineReadableAttachmentChars = attachmentTexts
    .filter(isMachineReadableAttachment)
    .reduce((total, item) => total + stringValue(item.text).length, 0);
  const attachmentText = normalizeSecSourceText(
    attachmentTexts
      .filter((item) => !isMachineReadableAttachment(item))
      .map((item) => stringValue(item.text))
      .join("\n\n"),
  );
  const bodyInputWasHtml = isHtmlLikeText(input.bodyText);
  const analysisInputWasHtml = isHtmlLikeText(input.analysisText);
  const bodyText = normalizeSecSourceText(input.bodyText || "");
  const analysisText = normalizeSecSourceText(input.analysisText || "");
  const preliminaryText = compactText([input.title, bodyText || analysisText].map(stringValue).filter(Boolean).join("\n\n"));
  const preliminaryFormType = resolvePeriodicFormType({
    documents: rawDocuments,
    metadata,
    rawPayload,
    text: preliminaryText,
    title: input.title,
  });
  const primaryDocumentSelection = selectPrimaryFilingDocument(rawDocuments, preliminaryFormType, input.title);
  const documents = applyPrimaryDocumentSelection(rawDocuments, primaryDocumentSelection);
  const preservedPrimaryHtml =
    nullableString(rawPayload.primary_document_html) ||
    nullableString(rawPayload.primaryDocumentHtml) ||
    nullableString(primaryDocumentSelection.selected?.rawHtml);
  const primaryDocumentSource =
    preservedPrimaryHtml ||
    stringValue(primaryDocumentSelection.selected?.text) ||
    stringValue(input.bodyText);
  const normalizedPrimaryDocument = normalizeSecVisibleDocument(primaryDocumentSource);
  const selectedPrimaryDocumentText = primaryDocumentSource ? normalizedPrimaryDocument.text : "";
  const primaryFilingText = selectedPrimaryDocumentText || bodyText;
  const sourcePackage = buildSourcePackage({
    attachmentTexts,
    documents,
    rawPayload: preservedPrimaryHtml
      ? { ...rawPayload, primary_document_html: preservedPrimaryHtml }
      : rawPayload,
    rootInput: input,
  });
  const rawSourceText = compactText([primaryFilingText, attachmentText].filter(Boolean).join("\n\n"));
  const usedAnalysisFallback = !rawSourceText && Boolean(analysisText);
  const sourceText = rawSourceText || analysisText;
  const text = compactText([input.title, sourceText].map(stringValue).filter(Boolean).join("\n\n"));

  const formType = resolvePeriodicFormType({
    documents,
    metadata,
    rawPayload,
    text,
    title: input.title,
  });
  const isSupported = isSupportedPeriodicReportForm(formType);
  const accessionNumber = nullableString(rawPayload.accession_number) || nullableString(rawPayload.accessionNumber) || nullableString(input.sourceUniqueId);
  const xbrlPeriodMetadata = readXbrlDocumentPeriodMetadata(sourcePackage.xbrlFacts);
  const payloadReportingPeriod = nullableString(rawPayload.reporting_period) || nullableString(rawPayload.reportingPeriod);
  const reportingPeriod = xbrlPeriodMetadata.reportingPeriod || payloadReportingPeriod || readReportingPeriod(text);
  const payloadFiscalYear = normalizeFiscalYear(rawPayload.fiscal_year) || normalizeFiscalYear(rawPayload.fiscalYear);
  const fiscalYear = xbrlPeriodMetadata.fiscalYear || payloadFiscalYear || readFiscalYear(reportingPeriod, text);
  const payloadFiscalQuarter = normalizeFiscalQuarter(rawPayload.fiscal_quarter) || normalizeFiscalQuarter(rawPayload.fiscalQuarter);
  const textFiscalQuarter = readFiscalQuarter(formType, text);
  const fiscalQuarter = xbrlPeriodMetadata.fiscalQuarter || payloadFiscalQuarter || textFiscalQuarter;
  const fiscalPeriodResolution = {
    reporting_period_source: xbrlPeriodMetadata.reportingPeriod
      ? "xbrl_dei_document_period_end_date"
      : payloadReportingPeriod
        ? "raw_payload"
        : reportingPeriod
          ? "cover_text"
          : "unresolved",
    fiscal_year_source: xbrlPeriodMetadata.fiscalYear
      ? "xbrl_dei_document_fiscal_year_focus"
      : payloadFiscalYear
        ? "raw_payload"
        : fiscalYear
          ? "reporting_period_or_cover_text"
          : "unresolved",
    fiscal_quarter_source: xbrlPeriodMetadata.fiscalQuarter
      ? "xbrl_dei_document_fiscal_period_focus"
      : payloadFiscalQuarter
        ? "raw_payload"
        : textFiscalQuarter
          ? "cover_text"
          : "unresolved",
    xbrl_document_fiscal_period_focus: xbrlPeriodMetadata.documentFiscalPeriodFocus,
    xbrl_document_fiscal_year_focus: xbrlPeriodMetadata.documentFiscalYearFocus,
    xbrl_document_period_end_date: xbrlPeriodMetadata.documentPeriodEndDate,
    xbrl_current_fiscal_year_end_date: xbrlPeriodMetadata.currentFiscalYearEndDate,
  };
  const securities = extractSecurities(text);
  const companyName =
    nullableString(rawPayload.company_name) ||
    nullableString(rawPayload.companyName) ||
    nullableString(metadata.company_name) ||
    nullableString(metadata.companyName) ||
    nullableString(metadata.issuer) ||
    readCompanyNameFromText(text);
  const primaryTicker = nullableString(rawPayload.ticker) || nullableString(metadata.ticker) || securities.find((security) => security.ticker)?.ticker || readTickerFromText(text);
  const exchange = nullableString(rawPayload.exchange) || nullableString(metadata.exchange) || securities.find((security) => security.exchange)?.exchange || readExchangeFromText(text);
  const amendment = buildAmendmentFacts({
    formType,
    parentFilingContext: input.parentFilingContext || rawPayload.parent_filing_context || rawPayload.parentFilingContext,
    text,
  });
  const sections = extractSections(text, formType);
  const contextSnippets = mergeContextSnippets(
    readPreservedPeriodicCoreSourceBlocks(rawPayload),
    extractContextSnippets(normalizedPrimaryDocument.blocks, formType),
  );
  const financialStatementLines = extractFinancialStatementLines(
    normalizedPrimaryDocument.tables,
    sections,
    sourcePackage.xbrlFacts,
  );
  const highValueEvidence = extractHighValueEvidence(text, amendment, financialStatementLines, sourcePackage.xbrlFacts);
  const dateCandidates = extractDateCandidates(text);
  const noiseCandidates = extractNoiseCandidates(text, documents);
  const coverPage: PeriodicReportCoverPageFacts = {
    companyName,
    formType,
    reportingPeriod,
    fiscalYear,
    fiscalQuarter,
    jurisdiction: readJurisdiction(text),
    filerStatus: readFilerStatus(text),
    securities,
  };
  const mustHaveChecks = buildCoverageChecks({
    accessionNumber,
    amendment,
    companyName,
    financialStatementLines,
    formType,
    isSupported,
    reportingPeriod,
    securities,
    sections,
    sourceText,
    sourcePackage,
  });
  const missingCriticalRawData = mustHaveChecks.some((check) => check.critical && (check.status === "missing" || check.status === "ambiguous"));
  const missingSource = buildMissingSourceRecords(mustHaveChecks);
  const deterministicClassification = buildDeterministicParserClassification(amendment);
  const facts: PeriodicReportFacts = {
    companyName,
    primaryTicker,
    exchange,
    reportingPeriod,
    fiscalYear,
    fiscalQuarter,
    isAnnualReport: formType === "10-K" || formType === "10-K/A",
    isQuarterlyReport: formType === "10-Q" || formType === "10-Q/A",
    isForeignIssuerAnnualReport: formType === "20-F" || formType === "20-F/A",
    isAmendment: Boolean(formType && /\/A$/i.test(formType)),
    sourcePackage,
    coverPage,
    amendment,
    sections,
    contextSnippets,
    financialStatementLines,
    highValueEvidence,
    dateCandidates,
    rawDataAudit: {
      missingCriticalRawData,
      hasPotentiallyUselessRawData: noiseCandidates.length > 0,
      mustHaveChecks,
      noiseCandidates,
      retainedEvidenceCount:
        sections.length +
        contextSnippets.length +
        financialStatementLines.length +
        highValueEvidence.length +
        dateCandidates.length +
        sourcePackage.retainedXbrlFactCount,
      notes: buildAuditNotes({ highValueEvidence, missingCriticalRawData, noiseCandidates, sections, sourcePackage }),
    },
  };
  const warnings = buildWarnings({
    accessionNumber,
    amendment,
    documents,
    formType,
    isSupported,
    mustHaveChecks,
    normalizationWarnings: normalizedPrimaryDocument.warnings,
    primaryDocumentSelection,
    securities,
    sourceText,
    usedAnalysisFallback,
    missingSource,
  });

  return {
    parserVersion: SEC_PERIODIC_REPORTS_PARSER_VERSION,
    parserGroup: PERIODIC_REPORTS_PARSER_GROUP,
    formType: formType || PERIODIC_REPORTS_FORM_SCOPE,
    accessionNumber,
    isSupported,
    summary: buildSummary(facts),
    facts,
    signals: [],
    calendarItems: dateCandidates.map(mapDateCandidateToCalendarItem),
    warnings,
    raw: {
      raw_item_id: nullableString(input.rawItemId),
      source_url: nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url) || nullableString(rawPayload.source_url),
      published_at: nullableString(input.publishedAt),
      market_context_used: false,
      parser_assigns_event_type: Boolean(deterministicClassification),
      parser_assigns_score_or_delivery: Boolean(deterministicClassification),
      processing_path: deterministicClassification ? "deterministic_parser_archive" : "parser_analysis",
      next_stage_expected: deterministicClassification ? "ui_payload_builder_then_required_output_json" : "ui_payload_builder_then_analysis_llm",
      deterministic_classification: deterministicClassification,
      parent_filing_context_present: Boolean(input.parentFilingContext || rawPayload.parent_filing_context || rawPayload.parentFilingContext),
      missing_source: missingSource,
      fiscal_period_resolution: fiscalPeriodResolution,
      truncation_notes: stringArray(rawPayload.truncation_notes || rawPayload.truncationNotes),
      source_text_stats: {
        raw_body_chars: stringValue(input.bodyText).length,
        body_chars: bodyText.length,
        body_text_was_html: bodyInputWasHtml,
        primary_document_source: preservedPrimaryHtml
          ? "preserved_primary_html"
          : stringValue(primaryDocumentSelection.selected?.text)
            ? "selected_document_text"
            : "raw_item_body_text",
        preserved_primary_html_chars: stringValue(preservedPrimaryHtml).length,
        normalized_primary_document_block_count: normalizedPrimaryDocument.diagnostics.blockCount,
        normalized_primary_document_visible_chars: normalizedPrimaryDocument.diagnostics.visibleChars,
        raw_analysis_chars: stringValue(input.analysisText).length,
        analysis_chars: analysisText.length,
        analysis_text_was_html: analysisInputWasHtml,
        attachment_chars: attachmentText.length,
        machine_readable_attachment_chars_excluded_from_narrative_text: machineReadableAttachmentChars,
        combined_source_chars: sourceText.length,
        combined_with_title_chars: text.length,
        used_analysis_text_fallback: usedAnalysisFallback,
      },
      source_package: sourcePackage,
      normalized_primary_document: {
        diagnostics: normalizedPrimaryDocument.diagnostics,
        warnings: normalizedPrimaryDocument.warnings,
        blocks: normalizedPrimaryDocument.blocks.slice(0, 120),
        tables: normalizedPrimaryDocument.tables.slice(0, 80),
        inline_xbrl_mentions: normalizedPrimaryDocument.inlineXbrlMentions.slice(0, 80),
      },
      documents: sourcePackage.documents,
      attachment_text_count: sourcePackage.attachmentTextCount,
      xbrl_fact_count: sourcePackage.xbrlFactCount,
      extraction_quality: {
        missing_critical_raw_data: missingCriticalRawData,
        noise_candidate_count: noiseCandidates.length,
        retained_evidence_count: facts.rawDataAudit.retainedEvidenceCount,
      },
    },
  };
}

function resolvePeriodicFormType({
  documents,
  metadata,
  rawPayload,
  text,
  title,
}: {
  documents: SecDocumentPayload[];
  metadata: Record<string, unknown>;
  rawPayload: Record<string, unknown>;
  text: string;
  title: unknown;
}): SupportedPeriodicReportForm | null {
  const candidates = [
    readFormFromDocuments(documents),
    nullableString(rawPayload.form_type),
    nullableString(rawPayload.formType),
    nullableString(metadata.form_type),
    nullableString(metadata.formType),
    readFormFromText(stringValue(title)),
    readFormFromText(text),
  ];

  for (const candidate of candidates) {
    const canonical = canonicalPeriodicFormType(candidate);
    if (canonical) return canonical;
  }

  return null;
}

function readFormFromDocuments(documents: SecDocumentPayload[]) {
  const primary = documents.find((document) => Boolean(document.isPrimary) && canonicalPeriodicFormType(nullableString(document.type)));
  if (primary) return nullableString(primary.type);
  const anyPeriodic = documents.find((document) => canonicalPeriodicFormType(nullableString(document.type)));
  return anyPeriodic ? nullableString(anyPeriodic.type) : null;
}

function readFormFromText(text: string) {
  return text.match(/\b(10-K\/A|10-Q\/A|20-F\/A|10-K|10-Q|20-F)\b/i)?.[1] || null;
}

function canonicalPeriodicFormType(value: string | null): SupportedPeriodicReportForm | null {
  const form = stringValue(value).toUpperCase().replace(/\s+/g, "");
  if (form === "10-K/A" || form === "10-KA") return "10-K/A";
  if (form === "10-Q/A" || form === "10-QA") return "10-Q/A";
  if (form === "20-F/A" || form === "20-FA") return "20-F/A";
  if (form === "10-K") return "10-K";
  if (form === "10-Q") return "10-Q";
  if (form === "20-F") return "20-F";
  return null;
}

function isSupportedPeriodicReportForm(value: string | null): value is SupportedPeriodicReportForm {
  return SUPPORTED_PERIODIC_REPORT_FORMS.includes(value as SupportedPeriodicReportForm);
}

function buildAmendmentFacts({
  formType,
  parentFilingContext,
  text,
}: {
  formType: SupportedPeriodicReportForm | null;
  parentFilingContext: unknown;
  text: string;
}): PeriodicReportAmendmentFacts {
  const isAmendment = Boolean(formType && /\/A$/i.test(formType));
  if (!isAmendment) {
    return {
      isAmendment: false,
      amendmentNumber: null,
      explanatoryNote: null,
      amendedItems: [],
      routineIndicators: [],
      restatementIndicators: [],
      parentAccessionNumber: null,
      originalFilingDate: null,
      sourceEvidence: [],
    };
  }

  const amendmentSource = extractAmendmentSourceText(text);
  const source = amendmentSource || text;
  const parentContext = toRecord(parentFilingContext) || {};

  return {
    isAmendment,
    amendmentNumber: readAmendmentNumber(text),
    explanatoryNote: readExplanatoryNote(source),
    amendedItems: readAmendedItems(source),
    routineIndicators: findPatternEvidence(source, [
      {
        category: "amendment_scope_raw",
        label: "routine_xbrl_exhibit_or_certification_indicator",
        pattern: /\bsolely\s+to\s+(?:file|furnish|include|provide)[^.]{0,260}?(?:exhibit\s+101|interactive data|xbrl|certification|signature)\b[^.]{0,260}/i,
        confidence: "high",
        locationHint: "Explanatory Note",
      },
      {
        category: "amendment_scope_raw",
        label: "no_other_changes_indicator",
        pattern: /\b(?:no other changes|does not amend, update or change|no revisions other than|remainder of the filing is unchanged|rest of the annual report remains unchanged)\b[^.]{0,260}/i,
        confidence: "high",
        locationHint: "Explanatory Note",
      },
    ]),
    restatementIndicators: findPatternEvidence(source, [
      {
        category: "amendment_scope_raw",
        label: "restatement_indicator",
        pattern: /\b(?:restate|restated|restatement|amended and restated|non-reliance|Item\s+4\.02)\b[^.]{0,320}/i,
        confidence: "high",
        locationHint: "Explanatory Note",
      },
      {
        category: "amendment_scope_raw",
        label: "material_weakness_or_controls_change_in_amendment",
        pattern: /\b(?:material weakness|internal control over financial reporting|disclosure controls and procedures)\b[^.]{0,320}/i,
        confidence: "medium",
        locationHint: "Explanatory Note",
      },
    ]),
    parentAccessionNumber: nullableString(parentContext.accession_number) || nullableString(parentContext.accessionNumber),
    originalFilingDate: readOriginalFilingDate(source),
    sourceEvidence: uniqueStrings([readExplanatoryNote(source), ...findPatternEvidence(source, amendmentEvidencePatterns()).map((item) => item.evidence)].filter(Boolean) as string[]),
  };
}

function amendmentEvidencePatterns(): EvidencePattern[] {
  return [
    {
      category: "amendment_scope_raw",
      label: "explanatory_note_present",
      pattern: /\b(?:Explanatory Note|Purpose of Amendment)\b[\s\S]{0,900}/i,
      confidence: "high",
      locationHint: "Explanatory Note",
    },
  ];
}

function extractSections(text: string, formType: SupportedPeriodicReportForm | null): PeriodicReportSection[] {
  if (!text) return [];

  const headings: SectionHeading[] = [];
  const lines = text.split("\n");
  let offset = 0;
  let currentPart: string | null = null;

  for (const line of lines) {
    const cleanLine = compactText(line);
    const partMatch = cleanLine.match(/^PART\s+([IVX]+[A-Z]?)\.?\b/i);
    if (partMatch?.[1]) currentPart = `PART ${partMatch[1].toUpperCase()}`;

    const itemMatch = cleanLine.match(/^ITEM\s+(\d+[A-Z]?|\d+\.[A-Z])\.?\s*(?:[-:]\s*)?(.{0,180})$/i);
    if (itemMatch?.[1]) {
      const title = cleanHeadingTitle(itemMatch[2] || "");
      headings.push({
        item: itemMatch[1].toUpperCase(),
        title,
        part: currentPart,
        index: offset + line.search(/\S/),
      });
    }

    offset += line.length + 1;
  }

  if (!headings.length) return [];

  const grouped = new Map<string, Array<SectionHeading & { end: number; excerpt: string; charCount: number }>>();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const end = headings[index + 1]?.index || text.length;
    const excerpt = compactText(text.slice(heading.index, end));
    const charCount = excerpt.length;
    if (charCount < 20) continue;
    const key = sectionKey(heading, formType);
    const entries = grouped.get(key) || [];
    entries.push({ ...heading, end, excerpt: truncate(excerpt, 4000), charCount });
    grouped.set(key, entries);
  }

  const sections: PeriodicReportSection[] = [];
  for (const [key, entries] of grouped) {
    const best = chooseBestSectionOccurrence(entries);
    sections.push({
      key,
      item: best.item,
      title: best.title,
      part: best.part,
      occurrenceCount: entries.length,
      charCount: best.charCount,
      excerpt: best.excerpt,
      source: "filing_text",
      confidence: best.charCount >= 300 ? "high" : "medium",
    });
  }

  return sections.slice(0, 80);
}

function chooseBestSectionOccurrence<T extends { charCount: number; excerpt: string }>(entries: T[]): T {
  const substantive = entries.filter((entry) => entry.charCount >= 300 && !looksLikeTableOfContents(entry.excerpt));
  const pool = substantive.length ? substantive : entries;
  return [...pool].sort((a, b) => b.charCount - a.charCount)[0];
}

function extractContextSnippets(
  blocks: VisibleDomBlock[],
  formType: SupportedPeriodicReportForm | null,
): PeriodicReportContextSnippet[] {
  const topics: Array<{ topic: string; pattern: RegExp; priority: number }> = [
    {
      topic: "company_value_context",
      pattern: /\b(?:total\s+)?market\s+cap(?:italization)?\b/i,
      priority: -1,
    },
    {
      topic: "financial_results",
      pattern: /\b(?:revenue|revenues|net sales|gross profit|gross margin|operating income|operating loss|net income|net loss|diluted earnings per share|diluted EPS)\b/i,
      priority: 0,
    },
    {
      topic: "period_comparison",
      pattern: /\b(?:increased|decreased|grew|declined|compared with|compared to|year over year|year-over-year)\b/i,
      priority: 1,
    },
    {
      topic: "outlook_and_guidance",
      pattern: /\b(?:guidance|outlook|forecast|expects?|anticipates?|projects?)\b/i,
      priority: 2,
    },
    {
      topic: "liquidity_and_debt",
      pattern: /\b(?:liquidity|cash and cash equivalents|free cash flow|working capital|borrowings|long-term debt|debt maturit|going concern)\b/i,
      priority: 3,
    },
    {
      topic: "segments_and_drivers",
      pattern: /\b(?:reportable segment|segment revenue|data center|customer demand|pricing|volume|product mix)\b/i,
      priority: 4,
    },
    {
      topic: "controls_and_accounting",
      pattern: /\b(?:material weakness|internal control over financial reporting|critical accounting estimate|restatement|non-reliance)\b/i,
      priority: 5,
    },
    {
      topic: "legal_and_regulatory",
      pattern: /\b(?:material legal proceedings|class action|government investigation|regulatory proceeding|settlement|contingenc)\b/i,
      priority: 6,
    },
    {
      topic: "capital_allocation",
      pattern: /\b(?:share repurchase|stock repurchase|cash dividend|capital expenditure|capital allocation)\b/i,
      priority: 7,
    },
  ];
  const usable = blocks.filter((block) =>
    Boolean(block.text) &&
    !block.tableLike &&
    !["signature", "exhibit_index", "empty_decorative"].includes(block.kind),
  );
  const itemByIndex = new Map<number, string | null>();
  let currentItem: string | null = null;
  for (const block of usable) {
    const itemMatch = block.text.match(/^ITEM\s+(\d+[A-Z]?|\d+\.[A-Z])\.?\b/i);
    if (itemMatch?.[1]) currentItem = itemMatch[1].toUpperCase();
    itemByIndex.set(block.index, currentItem);
  }

  const candidates: Array<PeriodicReportContextSnippet & { priority: number; order: number }> = [];
  const perTopic = new Map<string, number>();
  for (let index = 0; index < usable.length; index += 1) {
    const block = usable[index];
    if (block.text.length < 40 || block.text.length > 9000) continue;
    if (looksLikeTableOfContents(block.text) || isBoilerplateSnippet(block.text)) continue;
    const topic = topics.find((candidate) => candidate.pattern.test(block.text));
    if (block.kind === "cover_page" && topic?.topic !== "company_value_context") continue;
    if (!topic || (perTopic.get(topic.topic) || 0) >= 3) continue;

    const neighbors = usable
      .slice(Math.max(0, index - 1), Math.min(usable.length, index + 2))
      .filter((candidate) => !looksLikeTableOfContents(candidate.text) && !isBoilerplateSnippet(candidate.text));
    const text = truncate(uniqueStrings(neighbors.map((candidate) => candidate.text)).join("\n\n"), 3600);
    if (text.length < 80) continue;
    const item = itemByIndex.get(block.index) || null;
    const coreItemBoost = isCorePeriodicItem(item, formType) ? -4 : 0;
    candidates.push({
      id: `periodic_context_${slug(`${topic.topic}_${item || "general"}_${block.index}`)}`,
      topic: topic.topic,
      item,
      sectionKey: item ? `item_${slug(item)}` : null,
      text,
      source: "primary_document_context",
      confidence: item ? "high" : "medium",
      priority: topic.priority + coreItemBoost,
      order: block.index,
    });
    perTopic.set(topic.topic, (perTopic.get(topic.topic) || 0) + 1);
  }

  const seen = new Set<string>();
  return candidates
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .filter((candidate) => {
      const key = candidate.text.toLowerCase().slice(0, 500);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 16)
    .map(({ priority: _priority, order: _order, ...snippet }) => snippet);
}

function readPreservedPeriodicCoreSourceBlocks(rawPayload: Record<string, unknown>): PeriodicReportContextSnippet[] {
  const records = [
    ...recordArray(rawPayload.periodic_report_core_source_blocks),
    ...recordArray(rawPayload.periodicReportCoreSourceBlocks),
  ];
  const result: PeriodicReportContextSnippet[] = [];
  const seen = new Set<string>();

  for (const [index, record] of records.entries()) {
    const text = truncate(stringValue(record.text), 3600);
    if (text.length < 80) continue;
    const key = text.toLowerCase().replace(/\W+/g, "").slice(0, 400);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: nullableString(record.blockId) || nullableString(record.block_id) || `periodic_ingest_core_${index + 1}`,
      topic: "annual_core_performance",
      item: null,
      sectionKey: "annual_core_performance",
      text,
      source: "primary_document_context",
      confidence: "high",
      scope: stringValue(record.scope) === "segment_or_subset" ? "segment_or_subset" : "unknown",
    });
  }

  return result.slice(0, 5);
}

function mergeContextSnippets(
  preferred: PeriodicReportContextSnippet[],
  fallback: PeriodicReportContextSnippet[],
) {
  const result: PeriodicReportContextSnippet[] = [];
  const seen = new Set<string>();
  for (const snippet of [...preferred, ...fallback]) {
    const key = snippet.text.toLowerCase().replace(/\W+/g, "").slice(0, 400);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(snippet);
  }
  return result.slice(0, 16);
}

function isCorePeriodicItem(item: string | null, formType: SupportedPeriodicReportForm | null) {
  if (!item) return false;
  if (/^10-K/i.test(formType || "")) return /^(?:7|7A|8|9A)$/i.test(item);
  if (/^10-Q/i.test(formType || "")) return /^(?:1|2|3|4)$/i.test(item);
  if (/^20-F/i.test(formType || "")) return /^(?:3|5|8|11|15)$/i.test(item);
  return false;
}

function extractFinancialStatementLines(
  tables: VisibleTable[],
  sections: PeriodicReportSection[],
  xbrlFacts: PeriodicReportXbrlFact[],
): PeriodicRawEvidence[] {
  const result: PeriodicRawEvidence[] = [];
  const seen = new Set<string>();
  const financialTables = tables.filter((table) =>
    table.classification === "data" &&
    table.typeHints.some((hint) =>
      ["income_statement", "balance_sheet", "cash_flow_statement", "equity_statement", "segment_revenue"].includes(hint),
    ),
  );

  for (const table of financialTables) {
    for (const row of table.rows) {
      const line = compactText(row.text);
      const label = financialMetricLabel(line);
      if (!label || row.numericCellCount < 1) continue;
      const values = extractNumbers(line);
      if (!values.length) continue;
      const key = `${label}:${line.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(buildFinancialStatementEvidence(result.length, label, values, line, "financial_table"));
      if (result.length >= 18) return result;
    }
  }

  const financialSectionText = sections
    .filter((section) => /financial statements|management.s discussion|operating and financial review|results of operations/i.test(`${section.key} ${section.title}`))
    .map((section) => section.excerpt)
    .join("\n");
  for (const rawLine of financialSectionText.split(/\n|(?<=[.;])\s+(?=[A-Z])/)) {
    const line = compactText(rawLine);
    const label = financialMetricLabel(line);
    if (!label || line.length < 12 || line.length > 700 || !/\d/.test(line)) continue;
    const values = extractNumbers(line);
    if (!values.length) continue;
    const key = `${label}:${line.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(buildFinancialStatementEvidence(result.length, label, values, line, "financial_section"));
    if (result.length >= 18) break;
  }

  for (const fact of xbrlFacts) {
    if (result.length >= 18) break;
    if (fact.hasDimensions === true) continue;
    const label = xbrlFinancialMetricLabel(fact.name);
    if (!label || fact.value === null || fact.value === "") continue;
    const evidence = [fact.name, String(fact.value), fact.unitRef, fact.period].filter(Boolean).join(" | ");
    const key = `${label}:${fact.name}:${fact.period}:${fact.value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const numericValue = typeof fact.value === "number" ? fact.value : Number(String(fact.value).replace(/,/g, ""));
    result.push({
      id: `financial_statement_line_${result.length + 1}`,
      category: "financial_statement_line",
      label,
      value: Number.isFinite(numericValue) ? [numericValue] : [String(fact.value)],
      evidence: truncate(evidence, 700),
      source: fact.sourceDocument || "xbrl",
      locationHint: "Structured XBRL fact",
      confidence: fact.period ? "high" : "medium",
    });
  }

  return result;
}

function xbrlFinancialMetricLabel(name: string) {
  const concept = name.split(":").pop() || name;
  if (/Revenue|SalesRevenueNet/i.test(concept)) return "revenue_or_net_sales";
  if (/GrossProfit/i.test(concept)) return "gross_profit";
  if (/OperatingIncomeLoss/i.test(concept)) return "operating_income_loss";
  if (/NetIncomeLoss|ProfitLoss/i.test(concept)) return "net_income_loss";
  if (/EarningsPerShareDiluted/i.test(concept)) return "diluted_eps";
  if (/CashAndCashEquivalents/i.test(concept)) return "cash_and_equivalents";
  if (/Assets$/i.test(concept)) return "total_assets";
  if (/Liabilities$/i.test(concept)) return "total_liabilities";
  if (/LongTermDebt|ShortTermDebt|Borrowings/i.test(concept)) return "debt_or_borrowings";
  if (/NetCashProvidedByUsedIn/i.test(concept)) return "cash_flow";
  return null;
}

function financialMetricLabel(line: string) {
  const labels: Array<[string, RegExp]> = [
    ["revenue_or_net_sales", /\b(?:revenue|revenues|net sales)\b/i],
    ["gross_profit", /\bgross profit\b/i],
    ["gross_margin", /\bgross margin\b/i],
    ["operating_income_loss", /\b(?:operating income|operating loss|loss from operations|income from operations)\b/i],
    ["net_income_loss", /\b(?:net income|net loss|net earnings|loss attributable)\b/i],
    ["diluted_eps", /\b(?:diluted earnings per share|diluted EPS|earnings per diluted share)\b/i],
    ["cash_and_equivalents", /\bcash and cash equivalents\b/i],
    ["total_assets", /\btotal assets\b/i],
    ["total_liabilities", /\btotal liabilities\b/i],
    ["debt_or_borrowings", /\b(?:total debt|long-term debt|short-term debt|borrowings|notes payable)\b/i],
    ["cash_flow", /\b(?:net cash provided by|net cash used in|cash flows?)\b/i],
  ];
  return labels.find(([, pattern]) => pattern.test(line))?.[0] || null;
}

function buildFinancialStatementEvidence(
  index: number,
  label: string,
  values: number[],
  line: string,
  source: string,
): PeriodicRawEvidence {
  return {
    id: `financial_statement_line_${index + 1}`,
    category: "financial_statement_line",
    label,
    value: values,
    evidence: truncate(line, 700),
    source,
    locationHint: source === "financial_table" ? "Financial statement table" : "Financial statements or MD&A",
    confidence: values.length >= 2 ? "high" : "medium",
  };
}

function extractHighValueEvidence(
  text: string,
  amendment: PeriodicReportAmendmentFacts,
  financialStatementLines: PeriodicRawEvidence[],
  xbrlFacts: PeriodicReportXbrlFact[],
) {
  const evidence = findPatternEvidence(text, [
    {
      category: "listing_notice_raw",
      label: "exchange_deficiency_or_delisting_notice",
      pattern: /\b(?:received|was notified|notice|letter)\b[\s\S]{0,500}?\b(?:Nasdaq|NYSE|New York Stock Exchange)\b[\s\S]{0,500}?\b(?:minimum bid price|continued listing|deficienc|delist)\b[\s\S]{0,300}?/i,
      confidence: "high",
      locationHint: "Risk Factors, MD&A, or Legal/Other Information",
    },
    {
      category: "listing_risk_raw",
      label: "continued_listing_requirement_language",
      pattern: /\b(?:minimum bid price|continued listing requirement|failure to satisfy continued listing|delisting)\b[^.]{0,300}/i,
      confidence: "medium",
      locationHint: "Risk Factors or MD&A",
    },
    {
      category: "financial_risk_raw",
      label: "going_concern_language",
      pattern: /\bsubstantial doubt\b[\s\S]{0,260}?\bgoing concern\b|\bgoing concern\b[\s\S]{0,260}?\bsubstantial doubt\b/i,
      confidence: "high",
      locationHint: "Auditor report, notes, or liquidity section",
    },
    {
      category: "financial_risk_raw",
      label: "liquidity_or_cash_runway_language",
      pattern: /\b(?:insufficient liquidity|will require additional capital|cash runway|fund operations|liquidity position|working capital deficit)\b[^.]{0,300}/i,
      confidence: "medium",
      locationHint: "Liquidity or MD&A",
    },
    {
      category: "financial_risk_raw",
      label: "debt_default_or_covenant_language",
      pattern: /\b(?:event of default|default under|covenant breach|debt covenant|cross-default|waiver of default)\b[^.]{0,320}/i,
      confidence: "high",
      locationHint: "Debt footnotes or liquidity section",
    },
    {
      category: "controls_raw",
      label: "material_weakness_language",
      pattern: /\bmaterial weakness(?:es)?\b[^.]{0,340}/i,
      confidence: "high",
      locationHint: "Controls and procedures",
    },
    {
      category: "legal_raw",
      label: "legal_or_regulatory_proceedings",
      pattern: /\b(?:material legal proceedings|class action|securities litigation|SEC subpoena|Department of Justice|DOJ|investigation|lawsuit|settlement agreement)\b[^.]{0,340}/i,
      confidence: "medium",
      locationHint: "Legal proceedings or contingencies",
    },
    {
      category: "capital_return_raw",
      label: "dividend_declaration_or_payment",
      pattern: /\b(?:declared|paid|approved)\s+(?:a\s+)?(?:(?:quarterly|annual|cash|regular|special)\s+){0,4}dividend\b[^.]{0,300}/i,
      confidence: "high",
      locationHint: "MD&A, notes, or equity section",
    },
    {
      category: "capital_return_raw",
      label: "share_repurchase_activity_or_authorization",
      pattern: /\b(?:authorized|approved|announced|continued)\s+(?:a\s+)?(?:share|stock)\s+repurchase\b[^.]{0,320}|\brepurchased\s+[\d,.]+\s+(?:shares|ordinary shares)\b[^.]{0,320}/i,
      confidence: "high",
      locationHint: "MD&A, liquidity, or issuer purchases table",
    },
    {
      category: "fda_clinical_raw",
      label: "fda_or_clinical_trial_language",
      pattern: /\b(?:FDA|clinical trial|Phase\s+1|Phase\s+2|Phase\s+3|NDA|BLA|IND|PDUFA)\b[^.]{0,340}/i,
      confidence: "medium",
      locationHint: "Business, risk factors, or MD&A",
    },
    {
      category: "cybersecurity_raw",
      label: "cybersecurity_item_or_material_incident_language",
      pattern: /\b(?:Item\s+1C\.?\s+Cybersecurity|material cybersecurity incident|cybersecurity risk management)\b[^.]{0,360}/i,
      confidence: "medium",
      locationHint: "Item 1C Cybersecurity",
    },
    {
      category: "transaction_raw",
      label: "strategic_transaction_or_asset_sale_language",
      pattern: /\b(?:merger|acquisition|divestiture|asset sale|business combination|joint venture|strategic partnership|strategic alternatives)\b[^.]{0,360}/i,
      confidence: "medium",
      locationHint: "Business, MD&A, or notes",
    },
    {
      category: "governance_raw",
      label: "leadership_or_board_change_language",
      pattern: /\b(?:appointed|resigned|retired|terminated)\s+(?:as\s+)?(?:chief executive officer|CEO|chief financial officer|CFO|director|board member)\b[^.]{0,320}/i,
      confidence: "medium",
      locationHint: "Governance or subsequent events",
    },
    {
      category: "ownership_raw",
      label: "insider_or_principal_shareholder_table_language",
      pattern: /\b(?:security ownership of certain beneficial owners|principal shareholders|beneficial ownership)\b[^.]{0,320}/i,
      confidence: "medium",
      locationHint: "Part III or 20-F ownership section",
    },
    {
      category: "shareholder_vote_raw",
      label: "shareholder_vote_or_annual_meeting_language",
      pattern: /\b(?:submitted to a vote of security holders|annual meeting of shareholders|shareholder approval|stockholder approval)\b[^.]{0,320}/i,
      confidence: "medium",
      locationHint: "Shareholder vote or governance section",
    },
    {
      category: "fpi_raw",
      label: "20f_item_16i_hfcaa_language",
      pattern: /\b(?:Item\s+16I|Holding Foreign Companies Accountable Act|HFCAA|PCAOB)\b[^.]{0,360}/i,
      confidence: "medium",
      locationHint: "20-F Item 16I",
    },
    {
      category: "business_update_raw",
      label: "product_launch_or_customer_rollout_language",
      pattern: /\b(?:launched|commercial launch|product launch|new product|platform release|major customer rollout)\b[^.]{0,320}/i,
      confidence: "medium",
      locationHint: "Business or MD&A",
    },
    {
      category: "sales_performance_raw",
      label: "revenue_change_language",
      pattern: /\b(?:revenue|revenues|net sales|sales)\s+(?:increased|grew|rose|decreased|declined|fell)\s+(?:by\s+)?\d+(?:\.\d+)?%[^.]{0,260}/i,
      confidence: "medium",
      locationHint: "Results of operations",
    },
  ]);

  return dedupeEvidence([
    ...amendment.routineIndicators,
    ...amendment.restatementIndicators,
    ...financialStatementLines.slice(0, 4),
    ...xbrlFactsToRawEvidence(xbrlFacts),
    ...evidence,
  ]).slice(0, 50);
}

function xbrlFactsToRawEvidence(facts: PeriodicReportXbrlFact[]): PeriodicRawEvidence[] {
  const importantPattern =
    /(?:Revenue|Sales|NetIncomeLoss|ProfitLoss|OperatingIncomeLoss|Assets|Liabilities|CashAndCashEquivalents|Debt|Borrowings|StockholdersEquity|EarningsPerShare|Dividends|Repayments|CommonStocks?SharesOutstanding)/i;
  return facts
    .filter((fact) => importantPattern.test(fact.name) || importantPattern.test(fact.label || ""))
    .slice(0, 16)
    .map((fact, index) => ({
      id: `xbrl_fact_raw_${index + 1}`,
      category: "xbrl_fact_raw",
      label: fact.name,
      value: fact.value,
      evidence: fact.evidence,
      source: fact.sourceDocument || "xbrl_or_inline_xbrl",
      locationHint: fact.statement || fact.contextRef,
      confidence: fact.confidence,
    }));
}

function extractDateCandidates(text: string): PeriodicRawEvidence[] {
  const patterns: EvidencePattern[] = [
    {
      category: "date_raw",
      label: "dividend_payable_date",
      pattern: /\bpayable\s+on\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})\b[^.]{0,180}/i,
      confidence: "high",
      locationHint: "Dividend disclosure",
    },
    {
      category: "date_raw",
      label: "dividend_record_date",
      pattern: /\b(?:shareholders?|stockholders?)\s+of\s+record\b[^.]{0,120}\bon\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})\b[^.]{0,180}/i,
      confidence: "high",
      locationHint: "Dividend disclosure",
    },
    {
      category: "date_raw",
      label: "listing_cure_deadline",
      pattern: /\b(?:cure period|regain compliance|until|deadline)\b[^.]{0,160}\b([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})\b[^.]{0,180}/i,
      confidence: "medium",
      locationHint: "Listing-risk disclosure",
    },
    {
      category: "date_raw",
      label: "annual_meeting_date",
      pattern: /\bannual meeting\b[^.]{0,180}\b(?:on|held on|to be held on)\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})\b[^.]{0,180}/i,
      confidence: "medium",
      locationHint: "Governance or shareholder matters",
    },
  ];
  return findPatternEvidence(text, patterns, (match) => match[1] || null);
}

function extractNoiseCandidates(text: string, documents: SecDocumentPayload[]): PeriodicReportNoiseCandidate[] {
  const candidates: PeriodicReportNoiseCandidate[] = [];
  const patterns: Array<[string, string, string, RegExp, ConfidenceLevel]> = [
    ["forward_looking", "forward-looking statement boilerplate", "Safe-harbor language can swamp real period facts.", /\bforward-looking statements?\b[\s\S]{0,500}?\b(?:risks and uncertainties|actual results may differ)\b/i, "high"],
    ["cover_checkboxes", "cover-page checkbox block", "Registrant-status checkboxes are useful only as cover metadata, not analysis evidence.", /\bIndicate by check mark\b[\s\S]{0,500}?(?:accelerated filer|shell company)/i, "high"],
    ["table_of_contents", "table of contents", "TOC rows duplicate item headings without the actual disclosure.", /\bTABLE OF CONTENTS\b[\s\S]{0,700}?\bItem\s+\d/i, "medium"],
    ["signatures", "signature block", "Signature pages are administrative unless an amendment is signature-only.", /\bSIGNATURES\b[\s\S]{0,500}?(?:By:|\/s\/)/i, "high"],
    ["certifications", "Section 302 or 906 certification", "Certifications are usually exhibits and can be noisy for downstream LLM analysis.", /\b(?:CERTIFICATION|SECTION\s+302|SECTION\s+906|Sarbanes-Oxley)\b[\s\S]{0,500}/i, "high"],
    ["xbrl_exhibits", "XBRL or inline-data exhibit references", "Interactive-data references are mechanical unless they define amendment scope.", /\b(?:EX-101|Exhibit\s+101|XBRL|Inline XBRL|interactive data)\b[^.]{0,360}/i, "medium"],
  ];

  for (const [category, label, reason, pattern, confidence] of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    candidates.push({
      id: `noise_${category}`,
      category,
      label,
      reason,
      evidence: truncate(compactText(match[0]), 500),
      confidence,
    });
  }

  for (const document of documents) {
    const type = nullableString(document.type);
    const description = nullableString(document.description);
    if (!type && !description) continue;
    if (/\b(?:EX-31|EX-32|EX-101|GRAPHIC|XML|XSD|CAL|DEF|LAB|PRE)\b/i.test(`${type} ${description}`)) {
      candidates.push({
        id: `noise_document_${candidates.length + 1}`,
        category: "document_exhibit",
        label: "non-primary exhibit or machine-readable data file",
        reason: "The parser records the exhibit summary but should not treat it as core narrative evidence unless amendment scope depends on it.",
        evidence: truncate(`${type || "unknown"} ${description || ""}`, 240),
        confidence: "medium",
      });
    }
  }

  return candidates.slice(0, 16);
}

function buildCoverageChecks({
  accessionNumber,
  amendment,
  companyName,
  financialStatementLines,
  formType,
  isSupported,
  reportingPeriod,
  securities,
  sections,
  sourceText,
  sourcePackage,
}: {
  accessionNumber: string | null;
  amendment: PeriodicReportAmendmentFacts;
  companyName: string | null;
  financialStatementLines: PeriodicRawEvidence[];
  formType: SupportedPeriodicReportForm | null;
  isSupported: boolean;
  reportingPeriod: string | null;
  securities: PeriodicReportSecurity[];
  sections: PeriodicReportSection[];
  sourceText: string;
  sourcePackage: PeriodicReportSourcePackage;
}): PeriodicReportCoverageCheck[] {
  const amendmentScopePresent =
    !amendment.isAmendment || Boolean(amendment.explanatoryNote || amendment.routineIndicators.length || amendment.restatementIndicators.length || amendment.amendedItems.length);
  const sectionBoundariesPresent = sections.length > 0 || (amendment.isAmendment && amendmentScopePresent);
  const hasFinancialOrMda =
    (amendment.isAmendment && amendmentScopePresent) ||
    financialStatementLines.length > 0 ||
    sections.some((section) => /\b(?:financial statements|management'?s discussion|operating and financial review|results of operations|MD&A)\b/i.test(section.title));

  return [
    coverage(
      "source_package_inventory",
      "SEC source package inventory captured",
      sourcePackage.documentCount > 0 || sourcePackage.attachmentTextCount > 0 || sourcePackage.retainedXbrlFactCount > 0,
      "Parser should preserve document, attachment, and XBRL inventory before downstream interpretation.",
      `documents:${sourcePackage.documentCount} attachments:${sourcePackage.attachmentTextCount} xbrlFacts:${sourcePackage.retainedXbrlFactCount}`,
      true,
    ),
    coverage(
      "primary_document_inventory",
      "Primary filing document identified",
      sourcePackage.hasPrimaryDocument,
      "Primary document metadata is required to know which filing text was parsed.",
      sourcePackage.documents.find((document) => document.isPrimary)?.evidence || null,
      true,
    ),
    coverage("filing_text", "SEC filing text available", sourceText.length > 0, "Parser needs raw filing text from body or attachments.", sourceText ? `source chars: ${sourceText.length}` : null, true),
    coverage("form_type", "Periodic form type resolved", Boolean(formType && isSupported), "The room supports only 10-K, 10-Q, 20-F and amendments.", formType, true),
    coverage("accession_number", "Accession number available", Boolean(accessionNumber), "Accession is needed for source traceability.", accessionNumber, true),
    coverage("company_name", "Registrant/company name extracted", Boolean(companyName), "Company name anchors the filing package.", companyName, true),
    coverage("reporting_period", "Reporting period extracted", Boolean(reportingPeriod), "Periodic reports must preserve the fiscal period.", reportingPeriod, true),
    coverage(
      "cover_security_identifiers",
      "Ticker/exchange or securities table captured",
      securities.length > 0,
      "Listed securities help later stages identify the impacted instrument; some 20-F filings may require human review.",
      securities[0]?.evidence || null,
      false,
      securities.length > 1 ? "ambiguous" : undefined,
    ),
    coverage(
      "section_boundaries",
      "Item section boundaries detected",
      sectionBoundariesPresent,
      "Analysis needs item-level raw blocks, not one undifferentiated filing; limited amendments may only provide amendment-scope text.",
      sections[0]?.excerpt || amendment.explanatoryNote || amendment.sourceEvidence[0] || null,
      true,
    ),
    coverage("financial_or_mda_raw", "Financial statement or MD&A raw data captured", hasFinancialOrMda, "Periodic filings should expose financial statement or MD&A raw data.", financialStatementLines[0]?.evidence || null, true),
    coverage("amendment_scope", "Amendment scope captured", amendmentScopePresent, "Amendments need the explanatory note or changed-item scope before routing.", amendment.explanatoryNote || amendment.sourceEvidence[0] || null, amendment.isAmendment),
    coverage(
      "attachment_text_inventory",
      "Attachment text inventory preserved",
      sourcePackage.attachmentTextCount > 0,
      "Attachment text should be counted and represented separately from the primary filing body.",
      sourcePackage.attachmentTexts[0]?.evidence || null,
      false,
      sourcePackage.attachmentTextCount > 0 ? undefined : "not_applicable",
    ),
    coverage(
      "xbrl_document_inventory",
      "XBRL or Inline XBRL document inventory preserved",
      sourcePackage.hasInlineXbrlDocument || sourcePackage.hasMachineReadableXbrlDocument,
      "XBRL documents should be identified as raw data/package artifacts, even when not used for investor judgment.",
      sourcePackage.documents.find((document) => document.isInlineXbrl || document.isMachineReadableXbrl)?.evidence || null,
      false,
      sourcePackage.hasInlineXbrlDocument || sourcePackage.hasMachineReadableXbrlDocument ? undefined : "not_applicable",
    ),
    coverage(
      "xbrl_fact_inventory",
      "Structured XBRL fact inventory preserved",
      sourcePackage.retainedXbrlFactCount > 0,
      "When structured XBRL facts are supplied in fixture raw data, parser should retain them without assigning event meaning.",
      sourcePackage.xbrlFacts[0]?.evidence || null,
      false,
      sourcePackage.hasInlineXbrlDocument || sourcePackage.hasMachineReadableXbrlDocument || sourcePackage.retainedXbrlFactCount > 0 ? undefined : "not_applicable",
    ),
    coverage(
      "source_truncation_check",
      "Source truncation checked",
      !sourcePackage.hasTruncatedSource,
      "Truncated source documents or attachments can mean raw data was lost before routing.",
      sourcePackage.hasTruncatedSource ? "one or more source documents or attachments are marked truncated" : "no truncated source markers",
      true,
      sourcePackage.hasTruncatedSource ? "ambiguous" : undefined,
    ),
    coverage("noise_scan", "Boilerplate/noise scan completed", true, "Parser identifies likely useless raw blocks separately from retained evidence.", "noise scan completed", false),
  ];
}

function coverage(
  id: string,
  label: string,
  condition: boolean,
  reason: string,
  evidence: string | null,
  critical: boolean,
  overrideStatus?: "ambiguous" | "not_applicable",
): PeriodicReportCoverageCheck {
  return {
    id,
    label,
    status: overrideStatus || (condition ? "present" : "missing"),
    reason,
    evidence: evidence ? truncate(evidence, 360) : null,
    critical,
  };
}

function buildWarnings({
  accessionNumber,
  amendment,
  documents,
  formType,
  isSupported,
  missingSource,
  mustHaveChecks,
  normalizationWarnings,
  primaryDocumentSelection,
  securities,
  sourceText,
  usedAnalysisFallback,
}: {
  accessionNumber: string | null;
  amendment: PeriodicReportAmendmentFacts;
  documents: SecDocumentPayload[];
  formType: SupportedPeriodicReportForm | null;
  isSupported: boolean;
  missingSource: Array<Pick<PeriodicReportCoverageCheck, "id" | "label" | "status" | "reason" | "evidence" | "critical">>;
  mustHaveChecks: PeriodicReportCoverageCheck[];
  normalizationWarnings: string[];
  primaryDocumentSelection: PrimaryDocumentSelection;
  securities: PeriodicReportSecurity[];
  sourceText: string;
  usedAnalysisFallback: boolean;
}) {
  const warnings: string[] = [];
  if (!isSupported) warnings.push(`unsupported_periodic_report_form:${formType || "unknown"}`);
  if (!accessionNumber) warnings.push("missing_accession_number");
  if (!sourceText) warnings.push("missing_filing_text");
  if (usedAnalysisFallback) warnings.push("using_analysis_text_fallback_not_raw_filing_text");
  if (documents.some((document) => Boolean(document.textTruncated))) warnings.push("source_document_text_truncated");
  warnings.push(...normalizationWarnings);
  warnings.push(...primaryDocumentSelection.warnings);
  if (securities.length > 1) warnings.push("multiple_securities_detected_primary_ticker_may_be_ambiguous");
  if (amendment.isAmendment && !amendment.explanatoryNote && !amendment.routineIndicators.length && !amendment.restatementIndicators.length) {
    warnings.push("amendment_scope_not_clearly_extracted");
  }

  for (const check of mustHaveChecks) {
    if (check.critical && check.status === "missing") warnings.push(`missing_critical_raw_data:${check.id}`);
    if (check.critical && check.status === "ambiguous") warnings.push(`ambiguous_critical_raw_data:${check.id}`);
  }

  for (const source of missingSource) {
    if (source.status === "ambiguous") warnings.push(`ambiguous_source:${source.id}`);
    else warnings.push(`missing_source:${source.id}`);
  }

  return uniqueStrings(warnings);
}

function buildMissingSourceRecords(checks: PeriodicReportCoverageCheck[]) {
  return checks
    .filter((check) => SOURCE_MATERIAL_CHECK_IDS.has(check.id))
    .filter((check) => check.status === "missing" || check.status === "ambiguous" || check.status === "not_applicable")
    .map((check) => ({
      id: check.id,
      label: check.label,
      status: check.status,
      reason: check.reason,
      evidence: check.evidence,
      critical: check.critical,
    }));
}

function buildDeterministicParserClassification(amendment: PeriodicReportAmendmentFacts): DeterministicParserClassification | null {
  if (!amendment.isAmendment) return null;
  const hasRoutineScope = amendment.routineIndicators.some((item) => item.label === "routine_xbrl_exhibit_or_certification_indicator");
  const hasNoOtherChanges = amendment.routineIndicators.some((item) => item.label === "no_other_changes_indicator");
  if (!hasRoutineScope || !hasNoOtherChanges || amendment.restatementIndicators.length > 0) return null;

  return {
    can_finish_without_llm: true,
    event_type: "other",
    display_type: PERIODIC_REPORTS_DEFAULT_DISPLAY_TYPE,
    display_version: PERIODIC_REPORTS_DISPLAY_VERSION,
    score: 20,
    derived_delivery_level: "archive",
    analysis_llm_needed: false,
    reason: "Routine periodic-report amendment limited to exhibit, certification, signature, or XBRL package completion with no other disclosure changes.",
    evidence: uniqueStrings([amendment.explanatoryNote, ...amendment.routineIndicators.map((item) => item.evidence)].filter(Boolean) as string[]).slice(0, 4),
  };
}

function buildAuditNotes({
  highValueEvidence,
  missingCriticalRawData,
  noiseCandidates,
  sections,
  sourcePackage,
}: {
  highValueEvidence: PeriodicRawEvidence[];
  missingCriticalRawData: boolean;
  noiseCandidates: PeriodicReportNoiseCandidate[];
  sections: PeriodicReportSection[];
  sourcePackage: PeriodicReportSourcePackage;
}) {
  const notes: string[] = [];
  notes.push(missingCriticalRawData ? "One or more critical raw-data checks failed; downstream stages should not guess missing facts." : "Critical raw-data checks passed for this fixture.");
  notes.push(`${sections.length} item-level sections retained for downstream routing and analysis.`);
  notes.push(`${sourcePackage.documentCount} SEC package documents, ${sourcePackage.attachmentTextCount} attachment text blocks, and ${sourcePackage.retainedXbrlFactCount} structured XBRL facts inventoried.`);
  notes.push(`${highValueEvidence.length} high-value source-backed evidence candidates retained without assigning event type or score.`);
  if (noiseCandidates.length) notes.push(`${noiseCandidates.length} likely boilerplate/noise blocks identified separately from retained evidence.`);
  return notes;
}

function buildSummary(facts: PeriodicReportFacts) {
  return [
    `Raw parser extracted ${facts.sections.length} section blocks`,
    `${facts.financialStatementLines.length} financial statement lines`,
    `${facts.sourcePackage.retainedXbrlFactCount} XBRL facts`,
    `${facts.highValueEvidence.length} high-value evidence candidates`,
    `${facts.rawDataAudit.noiseCandidates.length} noise candidates`,
    `missing critical raw data: ${facts.rawDataAudit.missingCriticalRawData ? "yes" : "no"}`,
  ].join("; ");
}

function mapDateCandidateToCalendarItem(candidate: PeriodicRawEvidence): PeriodicReportCalendarItem {
  return {
    item_type: candidate.label,
    date: Array.isArray(candidate.value) ? null : typeof candidate.value === "string" ? candidate.value : null,
    description: `Raw date candidate extracted by parser: ${candidate.label}.`,
    evidence: candidate.evidence,
  };
}

function extractSecurities(text: string): PeriodicReportSecurity[] {
  const securities: PeriodicReportSecurity[] = [];
  const tableBlocks = [
    text.match(/Title\s+of\s+each\s+class\s+Trading\s+Symbol\(s\)\s+Name\s+of\s+each\s+exchange[^\n]*\n([\s\S]{0,1000}?)(?:\n\s*Securities registered pursuant|\n\s*Indicate by check mark|\n\s*Forward-looking|\n\s*EXPLANATORY NOTE|\n\s*ITEM\s+\d|\n\s*PART\s+)/i)?.[1],
    text.match(/Securities\s+registered\s+pursuant\s+to\s+Section\s+12\(b\)[\s\S]{0,500}?Title\s+of\s+each\s+class[\s\S]{0,300}?Name\s+of\s+each\s+exchange[^\n]*\n([\s\S]{0,1000}?)(?:\n\s*Securities registered pursuant|\n\s*Indicate by check mark|\n\s*Forward-looking|\n\s*EXPLANATORY NOTE|\n\s*ITEM\s+\d|\n\s*PART\s+)/i)?.[1],
  ].filter(Boolean) as string[];

  for (const block of tableBlocks) {
    for (const rawLine of block.split("\n")) {
      let line = compactText(rawLine);
      if (!line) continue;
      if (/Trading Symbol|Title of each class|Name of each exchange/i.test(line)) {
        line = line.replace(/^.*?Name\s+of\s+each\s+exchange\s+on\s+which\s+registered/i, "").trim();
        if (!line) continue;
      }
      const exchange = readExchangeFromText(line);
      const ticker = readTickerNearExchange(line, exchange);
      const title = readSecurityTitle(line, ticker, exchange);
      if (isBoilerplateSnippet(line) || /^Forward-looking/i.test(line) || /\bactual results may differ\b/i.test(line)) continue;
      if (!ticker && exchange && line.length > 160) continue;
      if (!ticker && !exchange) continue;
      securities.push({
        title,
        ticker,
        exchange,
        evidence: truncate(line, 300),
        confidence: ticker || exchange ? "high" : "medium",
      });
    }
  }

  if (!securities.length) {
    const exchange = readExchangeFromText(text);
    const evidence = truncate(pickEvidenceSentence(text, Math.max(text.search(/\bTrading Symbol|Ticker:|Nasdaq|NYSE/i), 0)), 300);
    const ticker = readTickerFromText(text) || readTickerNearExchange(evidence, exchange);
    if (ticker || exchange) {
      securities.push({
        title: null,
        ticker,
        exchange,
        evidence,
        confidence: "medium",
      });
    }
  }

  return dedupeSecurities(securities).slice(0, 8);
}

function readTickerNearExchange(line: string, exchange: string | null) {
  if (exchange) {
    const exchangeIndex = line.toLowerCase().indexOf(exchange.toLowerCase());
    const beforeExchange = (exchangeIndex >= 0 ? line.slice(0, exchangeIndex).trim() : line).replace(/[|\s]+$/g, "").trim();
    const match = beforeExchange.match(/\b([A-Z][A-Z0-9.]{0,7})\b\s*$/);
    if (match?.[1] && !isCommonNonTicker(match[1])) return match[1];
  }
  const symbolMatch = line.match(/\bTrading Symbol\(s\)\s+([A-Z][A-Z0-9.]{0,7})\b/i) || line.match(/\bTicker:\s*([A-Z][A-Z0-9.]{0,7})\b/i);
  return symbolMatch?.[1] ? symbolMatch[1].toUpperCase() : null;
}

function readSecurityTitle(line: string, ticker: string | null, exchange: string | null) {
  let title = line;
  if (exchange) title = title.replace(new RegExp(escapeRegExp(exchange), "i"), "");
  if (ticker) title = title.replace(new RegExp(`\\b${escapeRegExp(ticker)}\\b`, "i"), "");
  title = compactText(title);
  return title || null;
}

function dedupeSecurities(securities: PeriodicReportSecurity[]) {
  const result: PeriodicReportSecurity[] = [];
  const seen = new Set<string>();
  for (const security of securities) {
    const key = `${security.title || ""}:${security.ticker || ""}:${security.exchange || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(security);
  }
  return result;
}

function findPatternEvidence(text: string, patterns: EvidencePattern[], valueReader?: (match: RegExpMatchArray) => string | null): PeriodicRawEvidence[] {
  const evidence: PeriodicRawEvidence[] = [];
  for (const pattern of patterns) {
    const flags = pattern.pattern.flags.includes("g") ? pattern.pattern.flags : `${pattern.pattern.flags}g`;
    const matcher = new RegExp(pattern.pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text))) {
      const index = match.index || 0;
      const snippet = pattern.pattern.source.includes("[\\s\\S]") ? truncate(compactText(match[0]), 520) : pickEvidenceSentence(text, index);
      if (isBoilerplateSnippet(snippet) && !pattern.category.startsWith("amendment_scope")) continue;
      evidence.push({
        id: `${pattern.category}_${pattern.label}_${evidence.length + 1}`,
        category: pattern.category,
        label: pattern.label,
        value: valueReader ? valueReader(match) : compactText(match[0]),
        evidence: truncate(snippet, 520),
        source: "filing_text",
        locationHint: pattern.locationHint || null,
        confidence: pattern.confidence,
      });
      break;
    }
  }
  return dedupeEvidence(evidence);
}

function dedupeEvidence(items: PeriodicRawEvidence[]) {
  const result: PeriodicRawEvidence[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.category}:${item.label}:${item.evidence}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.map((item, index) => ({ ...item, id: `${item.category}_${index + 1}` }));
}

function extractAmendmentSourceText(text: string) {
  const match = text.match(/\b(?:Explanatory Note|Purpose of Amendment)\b[\s\S]{0,1800}/i);
  return match ? compactText(match[0]) : "";
}

function readExplanatoryNote(text: string) {
  const match = text.match(/\b(?:Explanatory Note|Purpose of Amendment)\b[\s\S]{0,1300}/i);
  return match ? truncate(compactText(match[0]), 900) : null;
}

function readAmendmentNumber(text: string) {
  const match = text.match(/\bAmendment\s+No\.?\s*(\d+)/i);
  return match?.[1] ? Number(match[1]) : null;
}

function readAmendedItems(text: string) {
  const items = new Set<string>();
  const itemPattern = /\bItem\s+(\d+[A-Z]?|\d+\.[A-Z])\.?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(text))) {
    if (match[1]) items.add(`Item ${match[1].toUpperCase()}`);
  }
  return Array.from(items).slice(0, 20);
}

function readOriginalFilingDate(text: string) {
  return (
    text.match(/\boriginally\s+filed\b[^.]{0,160}?\bon\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/i)?.[1] ||
    text.match(/\bfiled\s+with\s+the\s+SEC\s+on\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/i)?.[1] ||
    null
  );
}

function readCompanyNameFromText(text: string) {
  return (
    text.match(/\n\s*([A-Z][A-Za-z0-9&.,' -]{2,})\s+\(Exact name of registrant/i)?.[1]?.trim() ||
    text.match(/\bCompany Name:\s*([A-Z][A-Za-z0-9&.,' -]{2,})/i)?.[1]?.trim() ||
    null
  );
}

function readTickerFromText(text: string) {
  const candidates = [
    text.match(/\bTrading Symbol\(s\)\s+([A-Z][A-Z0-9.]{0,7})\b/i)?.[1],
    text.match(/\bTicker:\s*([A-Z][A-Z0-9.]{0,7})\b/i)?.[1],
  ];
  for (const candidate of candidates) {
    const ticker = candidate?.trim().toUpperCase();
    if (ticker && !isCommonNonTicker(ticker)) return ticker;
  }
  return null;
}

function readExchangeFromText(text: string) {
  const exchangeText =
    text.match(/\b(?:Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|New York Stock Exchange|NYSE American|NYSE|Nasdaq)\b/i)?.[0] ||
    null;
  if (!exchangeText) return null;
  if (/nasdaq global select/i.test(exchangeText)) return "Nasdaq Global Select Market";
  if (/nasdaq global market/i.test(exchangeText)) return "Nasdaq Global Market";
  if (/nasdaq capital/i.test(exchangeText)) return "Nasdaq Capital Market";
  if (/nyse american/i.test(exchangeText)) return "NYSE American";
  if (/new york stock exchange|^NYSE$/i.test(exchangeText)) return "NYSE";
  return exchangeText;
}

function readReportingPeriod(text: string) {
  const candidates = [
    ...text.matchAll(/\b(?:quarterly period|fiscal year|transition period)\s+ended\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/gi),
    ...text.matchAll(/\bperiod\s+ended\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/gi),
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, timestamp: Date.parse(value.replace(/\.$/, "")) }))
    .filter((candidate) => Number.isFinite(candidate.timestamp));
  return candidates.sort((left, right) => right.timestamp - left.timestamp)[0]?.value || null;
}

function readFiscalYear(reportingPeriod: string | null, text: string) {
  return reportingPeriod?.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || text.match(/\bfiscal\s+year\s+(20\d{2}|19\d{2})\b/i)?.[1] || null;
}

function readFiscalQuarter(formType: SupportedPeriodicReportForm | null, text: string) {
  if (formType !== "10-Q" && formType !== "10-Q/A") return null;
  const coverText = text.slice(0, 12_000);
  const explicitQuarter = coverText.match(
    /\b(?:for\s+the\s+)?((?:first|second|third|fourth)(?:\s+fiscal)?\s+quarter)\s+(?:of\s+(?:fiscal\s+year\s+)?(?:19|20)\d{2}\s+)?(?:ended|ending)\b/i,
  )?.[1];
  return normalizeFiscalQuarter(explicitQuarter);
}

function readJurisdiction(text: string) {
  return (
    text.match(/\b(?:State|jurisdiction)\s+of\s+(?:incorporation|organization)[^\n]*\n\s*([A-Za-z ,.-]{2,80})/i)?.[1]?.trim() ||
    text.match(/\borganized\s+under\s+the\s+laws\s+of\s+([A-Za-z ,.-]{2,80})/i)?.[1]?.trim() ||
    null
  );
}

function readFilerStatus(text: string) {
  const statuses: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ["large_accelerated_filer", /\bLarge accelerated filer\b/i],
    ["accelerated_filer", /\bAccelerated filer\b/i],
    ["non_accelerated_filer", /\bNon-accelerated filer\b/i],
    ["smaller_reporting_company", /\bSmaller reporting company\b/i],
    ["emerging_growth_company", /\bEmerging growth company\b/i],
    ["shell_company", /\bShell company\b/i],
  ];
  for (const [status, pattern] of checks) {
    if (pattern.test(text)) statuses.push(status);
  }
  return uniqueStrings(statuses);
}

function cleanHeadingTitle(title: string) {
  return compactText(title.replace(/\s+\d+\s*$/, "").replace(/^[.-]\s*/, ""));
}

function sectionKey(heading: SectionHeading, formType: SupportedPeriodicReportForm | null) {
  const prefix = formType === "20-F" || formType === "20-F/A" ? "20f" : heading.part ? slug(heading.part) : "periodic";
  const titleSlug = heading.title ? slug(heading.title).slice(0, 60).replace(/_+$/g, "") : "";
  const title = titleSlug ? `_${titleSlug}` : "";
  return `${prefix}_item_${slug(heading.item)}${title}`;
}

function looksLikeTableOfContents(excerpt: string) {
  return /\bTABLE OF CONTENTS\b/i.test(excerpt) || excerpt.split("\n").slice(0, 8).filter((line) => /\bItem\s+\d/i.test(line) && /\b\d{1,3}$/.test(line)).length >= 3;
}

function isBoilerplateSnippet(snippet: string) {
  return /\bforward-looking statements?\b/i.test(snippet) || /\bCERTIFICATION\b/i.test(snippet) || /\bSIGNATURES\b/i.test(snippet);
}

function extractNumbers(line: string) {
  const values = line.match(/\(?-?\$?\d[\d,]*(?:\.\d+)?\)?%?/g) || [];
  return values
    .map((value) => Number(value.replace(/[$,%()]/g, "").replace(/,/g, "")))
    .filter((value) => Number.isFinite(value))
    .slice(0, 8);
}

function pickEvidenceSentence(text: string, index: number) {
  const safeIndex = Math.max(0, index);
  const previousPeriod = text.lastIndexOf(".", safeIndex - 1);
  const previousBreak = text.lastIndexOf("\n", safeIndex - 1);
  const start = Math.max(previousPeriod, previousBreak);
  let end = text.indexOf(".", safeIndex + 1);
  if (end >= 0 && end - safeIndex < 80) {
    const nextEnd = text.indexOf(".", end + 1);
    if (nextEnd >= 0) end = nextEnd;
  }
  if (end < 0) end = Math.min(text.length, safeIndex + 420);
  else end += 1;
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), 520);
}

function isMachineReadableAttachment(attachment: AttachmentTextPayload) {
  const label = [attachment.type, attachment.description, attachment.filename, attachment.url, attachment.href].map(stringValue).join(" ");
  const text = stringValue(attachment.text).slice(0, 400);
  return (
    /\b(?:EX-101|XBRL|XML|XSD|CAL|DEF|LAB|PRE|INS)\b/i.test(label) ||
    /\.(?:xml|xsd|cal|def|lab|pre|ins)$/i.test(label) ||
    /<(?:xbrli:xbrl|xbrl|ix:|[A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b/i.test(text)
  );
}

function normalizeSecSourceText(value: unknown) {
  return normalizeSecVisibleDocument(value).text;
}

function isHtmlLikeText(value: unknown) {
  const text = stringValue(value);
  if (!text) return false;
  const sample = text.slice(0, 5000);
  return /<!doctype\s+html|<html\b|<body\b|<ix:|<xhtml:|<table\b|<div\b|<span\b|<p\b|<td\b|<tr\b/i.test(sample);
}

function htmlToPlainText(value: unknown) {
  return normalizeSecVisibleDocument(value).text;
}

function normalizeSecVisibleDocument(value: unknown): SecVisibleDocument {
  const input = stringValue(value);
  if (!input) {
    return emptyVisibleDocument("plain_text_fallback", 0);
  }
  if (!isHtmlLikeText(input)) {
    const text = normalizeVisibleText(input);
    const block = buildVisibleBlock({
      index: 0,
      kind: classifyVisibleBlock(text, null, false, false),
      text,
      sourceTag: null,
      sourcePath: "text",
      sourceStart: 0,
      sourceEnd: input.length,
      tableLike: false,
      layoutTableLike: false,
      containsInlineXbrl: false,
    });
    return {
      text,
      blocks: text ? [block] : [],
      tables: [],
      inlineXbrlMentions: [],
      warnings: text ? [] : ["html_normalization_suspiciously_little_visible_text"],
      diagnostics: {
        parser: "plain_text_fallback",
        inputChars: input.length,
        visibleChars: text.length,
        blockCount: text ? 1 : 0,
        tableBlockCount: 0,
        extractedTableCount: 0,
        inlineXbrlVisibleMentionCount: 0,
      },
    };
  }

  return parseVisibleHtmlDocument(input);
}

function emptyVisibleDocument(parser: SecVisibleDocument["diagnostics"]["parser"], inputChars: number): SecVisibleDocument {
  return {
    text: "",
    blocks: [],
    tables: [],
    inlineXbrlMentions: [],
    warnings: inputChars ? ["html_normalization_suspiciously_little_visible_text"] : [],
    diagnostics: {
      parser,
      inputChars,
      visibleChars: 0,
      blockCount: 0,
      tableBlockCount: 0,
      extractedTableCount: 0,
      inlineXbrlVisibleMentionCount: 0,
    },
  };
}

function parseVisibleHtmlDocument(input: string): SecVisibleDocument {
  type BlockDraft = {
    tag: string | null;
    sourcePath: string;
    sourceStart: number | null;
    tableLike: boolean;
    layoutTableLike: boolean;
    textParts: string[];
    containsInlineXbrl: boolean;
  };
  type InlineDraft = {
    tag: string;
    attrs: Record<string, string>;
    textParts: string[];
  };

  const blocks: VisibleDomBlock[] = [];
  const inlineXbrlMentions: InlineXbrlMention[] = [];
  const warnings: string[] = [];
  const stack: string[] = [];
  const skipStack: string[] = [];
  const inlineStack: InlineDraft[] = [];
  let current = null as BlockDraft | null;
  let tableDepth = 0;
  let parseRecovered = false;

  const startBlock = (tag: string | null, sourceStart: number | null, tableLike = false) => {
    flushBlock(sourceStart);
    current = {
      tag,
      sourcePath: buildSourcePath(stack, tag),
      sourceStart,
      tableLike,
      layoutTableLike: false,
      textParts: [],
      containsInlineXbrl: false,
    };
  };

  const ensureBlock = (tag: string | null, sourceStart: number | null, tableLike = false) => {
    if (!current) {
      current = {
        tag,
        sourcePath: buildSourcePath(stack, tag),
        sourceStart,
        tableLike,
        layoutTableLike: false,
        textParts: [],
        containsInlineXbrl: false,
      };
    }
    if (tableLike) current.tableLike = true;
  };

  const appendVisibleText = (rawText: string, sourceStart: number | null) => {
    if (skipStack.length) return;
    const visible = normalizeVisibleInlineText(decodeHtmlEntities(rawText));
    if (!visible) return;
    ensureBlock(tableDepth > 0 ? "table" : null, sourceStart, tableDepth > 0);
    current?.textParts.push(visible);
    for (const inline of inlineStack) inline.textParts.push(visible);
  };

  const flushBlock = (sourceEnd: number | null = null) => {
    if (!current) return;
    const text = normalizeVisibleText(current.textParts.join(" "));
    const separatorCount = (text.match(/\|/g) || []).length;
    const lineCount = text.split("\n").filter(Boolean).length;
    current.layoutTableLike = current.tableLike && separatorCount <= 1 && lineCount <= 2;
    const isEmpty = !text || isDecorativeText(text);
    const kind = isEmpty ? "empty_decorative" : classifyVisibleBlock(text, current.tag, current.tableLike, current.layoutTableLike);
    if (text || kind === "empty_decorative") {
      blocks.push(
        buildVisibleBlock({
          index: blocks.length,
          kind,
          text,
          sourceTag: current.tag,
          sourcePath: current.sourcePath,
          sourceStart: current.sourceStart,
          sourceEnd,
          tableLike: current.tableLike,
          layoutTableLike: current.layoutTableLike,
          containsInlineXbrl: current.containsInlineXbrl,
        }),
      );
    }
    current = null;
  };

  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(input))) {
    const token = match[0];
    const offset = match.index;
    if (!token) continue;
    if (token.startsWith("<!--")) continue;
    if (!token.startsWith("<")) {
      appendVisibleText(token, offset);
      continue;
    }

    const tag = readHtmlTag(token);
    if (!tag) {
      parseRecovered = true;
      appendVisibleText(token, offset);
      continue;
    }
    const closing = /^<\s*\//.test(token);
    const selfClosing = /\/\s*>$/.test(token) || isVoidHtmlTag(tag);
    const attrs = closing ? {} : parseXmlAttributes(token.replace(/^<\s*[\w:-]+|\/?>$/g, ""));

    if (closing) {
      if (isInlineXbrlVisibleTag(tag)) {
        const inline = inlineStack.pop();
        if (inline) {
          inlineXbrlMentions.push({
            blockIndex: current ? blocks.length : Math.max(0, blocks.length - 1),
            tag: inline.tag,
            name: nullableString(inline.attrs.name),
            contextRef: nullableString(inline.attrs.contextRef) || nullableString(inline.attrs.contextref),
            unitRef: nullableString(inline.attrs.unitRef) || nullableString(inline.attrs.unitref),
            decimals: nullableString(inline.attrs.decimals),
            visibleText: normalizeVisibleText(inline.textParts.join(" ")),
          });
          if (current) current.containsInlineXbrl = true;
        }
      }
      if (skipStack[skipStack.length - 1] === tag) skipStack.pop();
      if (tag === "table" && tableDepth > 0) {
        tableDepth -= 1;
        flushBlock(offset + token.length);
      } else if (isBlockBoundaryTag(tag) && tableDepth === 0) {
        flushBlock(offset + token.length);
      } else if ((tag === "li" || tag === "tr") && tableDepth > 0) {
        current?.textParts.push("\n");
      }
      const lastIndex = stack.lastIndexOf(tag);
      if (lastIndex >= 0) stack.splice(lastIndex);
      else parseRecovered = true;
      continue;
    }

    if (isHiddenHtmlTag(tag) || hasHiddenHtmlAttributes(attrs, token)) {
      if (!selfClosing) skipStack.push(tag);
      if (!selfClosing) stack.push(tag);
      continue;
    }
    if (selfClosing) {
      if (tag === "br") current?.textParts.push("\n");
      continue;
    }

    stack.push(tag);
    if (tag === "table") {
      tableDepth += 1;
      startBlock("table", offset, true);
    } else if ((tag === "tr" || tag === "li") && tableDepth > 0) {
      ensureBlock("table", offset, true);
      current?.textParts.push("\n");
    } else if ((tag === "td" || tag === "th") && tableDepth > 0) {
      ensureBlock("table", offset, true);
      const joined = current?.textParts.join("") || "";
      if (current && joined.trim() && !/\n\s*$/.test(joined)) current.textParts.push(" | ");
    } else if (isBlockBoundaryTag(tag) && tableDepth === 0) {
      startBlock(tag, offset, false);
    }

    if (isInlineXbrlVisibleTag(tag)) {
      inlineStack.push({ tag, attrs, textParts: [] });
      ensureBlock(tag, offset, tableDepth > 0);
      if (current) current.containsInlineXbrl = true;
    }
  }

  if (tableDepth > 0 || stack.some((tag) => !isOptionalCloseTag(tag))) parseRecovered = true;
  flushBlock(input.length);

  const retainedBlocks = blocks.filter((block) => block.kind !== "empty_decorative" || block.text);
  const tableExtraction = extractVisibleTables(input, retainedBlocks);
  const text = compactText(retainedBlocks.map((block) => block.text).filter(Boolean).join("\n"));
  if (parseRecovered) warnings.push("html_normalization_recovered_malformed_markup");
  warnings.push(...tableExtraction.warnings);
  if (input.length >= 300 && text.length < Math.min(120, input.length * 0.05)) warnings.push("html_normalization_suspiciously_little_visible_text");

  return {
    text,
    blocks: retainedBlocks.slice(0, 5000),
    tables: tableExtraction.tables.slice(0, 600),
    inlineXbrlMentions: inlineXbrlMentions.filter((mention) => mention.visibleText).slice(0, 2000),
    warnings: uniqueStrings(warnings),
    diagnostics: {
      parser: "sec_visible_dom_stream_v1",
      inputChars: input.length,
      visibleChars: text.length,
      blockCount: retainedBlocks.length,
      tableBlockCount: retainedBlocks.filter((block) => block.tableLike).length,
      extractedTableCount: tableExtraction.tables.length,
      inlineXbrlVisibleMentionCount: inlineXbrlMentions.filter((mention) => mention.visibleText).length,
    },
  };
}

function extractVisibleTables(input: string, blocks: VisibleDomBlock[]) {
  const tables: VisibleTable[] = [];
  const warnings: string[] = [];
  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  let tableStart: number | null = null;
  let tableDepth = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(input))) {
    const token = match[0];
    const tag = readHtmlTag(token);
    if (!tag || tag !== "table") continue;
    const closing = /^<\s*\//.test(token);
    if (!closing) {
      if (tableDepth === 0) tableStart = match.index;
      tableDepth += 1;
      continue;
    }
    if (tableDepth <= 0 || tableStart === null) {
      warnings.push("table_extraction_recovered_malformed_table");
      continue;
    }
    tableDepth -= 1;
    if (tableDepth === 0) {
      const sourceEnd = match.index + token.length;
      const table = buildVisibleTable(input.slice(tableStart, sourceEnd), tables.length, tableStart, sourceEnd, blocks);
      warnings.push(...table.warnings);
      tables.push(table);
      tableStart = null;
    }
  }

  if (tableStart !== null) {
    const table = buildVisibleTable(input.slice(tableStart), tables.length, tableStart, input.length, blocks, ["table_extraction_recovered_malformed_table"]);
    warnings.push(...table.warnings);
    tables.push(table);
  }

  return { tables, warnings: uniqueStrings(warnings) };
}

function buildVisibleTable(rawHtml: string, index: number, sourceStart: number, sourceEnd: number, blocks: VisibleDomBlock[], initialWarnings: string[] = []): VisibleTable {
  const parsed = parseTableRows(rawHtml);
  const rows = positionTableRows(parsed.rows);
  const rowTexts = rows.map((row) => row.cells.map((cell) => cell.text).join(" | "));
  const text = compactText(rowTexts.join("\n"));
  const block = findTableBlock(blocks, sourceStart, sourceEnd);
  const caption = parsed.caption || readNearbyTableCaption(blocks, sourceStart);
  const footnotes = readNearbyTableFootnotes(blocks, sourceEnd);
  const stats = readTableStats(rows, caption, footnotes);
  const classification = classifyVisibleTable(rows, text, caption, footnotes, stats);
  const warnings = uniqueStrings([...initialWarnings, ...parsed.warnings, ...stats.warnings]);

  return {
    index,
    classification: classification.classification,
    confidence: classification.confidence,
    typeHints: classification.typeHints,
    caption,
    unitHint: stats.unitHint,
    footnotes,
    rowCount: rows.length,
    columnCount: stats.columnCount,
    cellCount: stats.cellCount,
    numericCellCount: stats.numericCellCount,
    rows,
    text,
    sourceStart,
    sourceEnd,
    blockIndex: block?.index ?? null,
    warnings,
  };
}

function parseTableRows(rawHtml: string) {
  type CellDraft = {
    textParts: string[];
    isHeader: boolean;
    rowSpan: number;
    colSpan: number;
    containsInlineXbrl: boolean;
    inlineXbrlMentions: InlineXbrlMention[];
  };
  type RowDraft = {
    cells: CellDraft[];
  };
  type InlineDraft = {
    tag: string;
    attrs: Record<string, string>;
    textParts: string[];
  };

  const rows: RowDraft[] = [];
  const captionParts: string[] = [];
  const warnings: string[] = [];
  const skipStack: string[] = [];
  const inlineStack: InlineDraft[] = [];
  let currentRow: RowDraft | null = null;
  let currentCell: CellDraft | null = null;
  let captionMode = false;
  let recovered = false;

  const ensureRow = () => {
    if (!currentRow) currentRow = { cells: [] };
  };
  const finalizeCell = () => {
    if (!currentCell) return;
    ensureRow();
    currentRow?.cells.push(currentCell);
    currentCell = null;
  };
  const finalizeRow = () => {
    finalizeCell();
    if (currentRow && currentRow.cells.length) rows.push(currentRow);
    currentRow = null;
  };
  const appendCellText = (rawText: string) => {
    if (skipStack.length) return;
    const text = normalizeVisibleInlineText(decodeHtmlEntities(rawText));
    if (!text) return;
    if (captionMode) {
      captionParts.push(text);
      return;
    }
    if (!currentCell) return;
    currentCell.textParts.push(text);
    for (const inline of inlineStack) inline.textParts.push(text);
  };

  const tokenPattern = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenPattern.exec(rawHtml))) {
    const token = match[0];
    if (!token || token.startsWith("<!--")) continue;
    if (!token.startsWith("<")) {
      appendCellText(token);
      continue;
    }

    const tag = readHtmlTag(token);
    if (!tag) {
      recovered = true;
      appendCellText(token);
      continue;
    }
    const closing = /^<\s*\//.test(token);
    const selfClosing = /\/\s*>$/.test(token) || isVoidHtmlTag(tag);
    const attrs = closing ? {} : parseXmlAttributes(token.replace(/^<\s*[\w:-]+|\/?>$/g, ""));

    if (closing) {
      if (isInlineXbrlVisibleTag(tag)) {
        const inline = inlineStack.pop();
        if (inline && currentCell) {
          currentCell.containsInlineXbrl = true;
          currentCell.inlineXbrlMentions.push({
            blockIndex: -1,
            tag: inline.tag,
            name: nullableString(inline.attrs.name),
            contextRef: nullableString(inline.attrs.contextRef) || nullableString(inline.attrs.contextref),
            unitRef: nullableString(inline.attrs.unitRef) || nullableString(inline.attrs.unitref),
            decimals: nullableString(inline.attrs.decimals),
            visibleText: normalizeVisibleText(inline.textParts.join(" ")),
          });
        }
      } else if (tag === "td" || tag === "th") {
        finalizeCell();
      } else if (tag === "tr") {
        finalizeRow();
      } else if (tag === "caption") {
        captionMode = false;
      } else if (skipStack[skipStack.length - 1] === tag) {
        skipStack.pop();
      }
      continue;
    }

    if (isHiddenHtmlTag(tag) || hasHiddenHtmlAttributes(attrs, token)) {
      if (!selfClosing) skipStack.push(tag);
      continue;
    }
    if (tag === "caption") {
      captionMode = true;
      continue;
    }
    if (tag === "tr") {
      finalizeRow();
      currentRow = { cells: [] };
      continue;
    }
    if (tag === "td" || tag === "th") {
      if (currentCell) {
        recovered = true;
        finalizeCell();
      }
      ensureRow();
      currentCell = {
        textParts: [],
        isHeader: tag === "th",
        rowSpan: readSpan(attrs.rowspan || attrs.rowSpan),
        colSpan: readSpan(attrs.colspan || attrs.colSpan),
        containsInlineXbrl: false,
        inlineXbrlMentions: [],
      };
      continue;
    }
    if (tag === "br" && currentCell) {
      currentCell.textParts.push("\n");
      continue;
    }
    if (isInlineXbrlVisibleTag(tag)) {
      inlineStack.push({ tag, attrs, textParts: [] });
      if (currentCell) currentCell.containsInlineXbrl = true;
    }
  }

  if (currentCell || currentRow || inlineStack.length) recovered = true;
  finalizeRow();
  if (recovered) warnings.push("table_extraction_recovered_malformed_table");

  return {
    caption: normalizeVisibleText(captionParts.join(" ")) || null,
    rows,
    warnings,
  };
}

function positionTableRows(rowDrafts: Array<{ cells: Array<Omit<VisibleTableCell, "rowIndex" | "columnIndex" | "text" | "empty"> & { textParts: string[] }> }>): VisibleTableRow[] {
  const rows: VisibleTableRow[] = [];
  let activeSpans: number[] = [];

  for (let rowIndex = 0; rowIndex < rowDrafts.length; rowIndex += 1) {
    const row = rowDrafts[rowIndex];
    let columnIndex = 0;
    const newSpans: Array<{ columnIndex: number; colSpan: number; rowSpan: number }> = [];
    const cells: VisibleTableCell[] = [];

    for (const draft of row.cells) {
      while ((activeSpans[columnIndex] || 0) > 0) columnIndex += 1;
      const text = normalizeVisibleText(draft.textParts.join(" "));
      const cell: VisibleTableCell = {
        rowIndex,
        columnIndex,
        text,
        isHeader: draft.isHeader,
        rowSpan: Math.max(1, draft.rowSpan),
        colSpan: Math.max(1, draft.colSpan),
        empty: text.length === 0,
        containsInlineXbrl: draft.containsInlineXbrl,
        inlineXbrlMentions: draft.inlineXbrlMentions.filter((mention) => mention.visibleText),
      };
      cells.push(cell);
      if (cell.rowSpan > 1) newSpans.push({ columnIndex, colSpan: cell.colSpan, rowSpan: cell.rowSpan });
      columnIndex += cell.colSpan;
    }

    activeSpans = activeSpans.map((value) => Math.max(0, value - 1));
    for (const span of newSpans) {
      for (let offset = 0; offset < span.colSpan; offset += 1) {
        activeSpans[span.columnIndex + offset] = Math.max(activeSpans[span.columnIndex + offset] || 0, span.rowSpan - 1);
      }
    }

    const rowText = normalizeVisibleText(cells.map((cell) => cell.text).join(" | "));
    const numericCellCount = cells.filter((cell) => isNumericLikeTableCell(cell.text)).length;
    rows.push({
      index: rowIndex,
      cells,
      text: rowText,
      headerLike: cells.some((cell) => cell.isHeader) || isHeaderLikeTableRow(cells, numericCellCount),
      numericCellCount,
    });
  }

  return rows;
}

function readTableStats(rows: VisibleTableRow[], caption: string | null, footnotes: string[]) {
  const warnings: string[] = [];
  const cellCount = rows.reduce((total, row) => total + row.cells.length, 0);
  const numericCellCount = rows.reduce((total, row) => total + row.numericCellCount, 0);
  const columnCount = rows.reduce((max, row) => Math.max(max, ...row.cells.map((cell) => cell.columnIndex + cell.colSpan), 0), 0);
  const rowWidths = rows.map((row) => row.cells.reduce((sum, cell) => sum + cell.colSpan, 0));
  const nonEmptyWidths = rowWidths.filter((width) => width > 0);
  if (new Set(nonEmptyWidths).size > 2) warnings.push("table_extraction_uncertain_row_columns");
  return {
    cellCount,
    numericCellCount,
    columnCount,
    unitHint: readTableUnitHint([caption, ...rows.slice(0, 3).map((row) => row.text), ...footnotes].filter(Boolean).join(" ")),
    warnings,
  };
}

function classifyVisibleTable(
  rows: VisibleTableRow[],
  text: string,
  caption: string | null,
  footnotes: string[],
  stats: ReturnType<typeof readTableStats>,
): { classification: VisibleTableClassification; confidence: ConfidenceLevel; typeHints: string[] } {
  const context = compactText([caption, text, ...footnotes].filter(Boolean).join("\n"));
  const typeHints = inferTableTypeHints(context);
  const rowCount = rows.length;
  const cellCount = stats.cellCount;
  const columnCount = stats.columnCount;
  const headerLikeRows = rows.filter((row) => row.headerLike).length;
  const longNarrativeCells = rows.flatMap((row) => row.cells).filter((cell) => wordCount(cell.text) >= 20 && !isNumericLikeTableCell(cell.text)).length;
  const itemRefs = (context.match(/\bITEM\s+\d+[A-Z]?(?:\.|\b)|\bITEM\s+\d+\.[A-Z]\b/gi) || []).length;
  const pageNumberRows = rows.filter((row) => /\b\d{1,4}\s*$/.test(row.text) || /\.{3,}\s*\d{1,4}\s*$/.test(row.text)).length;
  const exhibitRefs = (context.match(/\b(?:Exhibit\s+\d+|EX-\d{1,3}|EX-31|EX-32|EX-101)\b/gi) || []).length;
  const dataSignals = [
    rowCount >= 2 && columnCount >= 2,
    stats.numericCellCount >= 2,
    headerLikeRows > 0,
    /\b(?:20\d{2}|19\d{2}|three months|six months|year ended|quarter ended)\b/i.test(context),
    Boolean(stats.unitHint),
    typeHints.some((hint) => !["toc", "exhibit_index"].includes(hint)),
  ].filter(Boolean).length;

  if ((/\bTABLE OF CONTENTS\b/i.test(context) || itemRefs >= 4) && (pageNumberRows >= 2 || /\.{3,}/.test(context))) {
    return { classification: "toc", confidence: "medium", typeHints: uniqueStrings(["toc", ...typeHints]) };
  }
  if (exhibitRefs >= 2 || /\b(?:incorporated by reference|filed herewith|furnished herewith)\b/i.test(context)) {
    return { classification: "exhibit_index", confidence: "medium", typeHints: uniqueStrings(["exhibit_index", ...typeHints]) };
  }
  if (rowCount <= 1 && cellCount <= 1) {
    return { classification: "layout", confidence: "medium", typeHints };
  }
  if (cellCount <= 2 && longNarrativeCells >= 1 && stats.numericCellCount === 0) {
    return { classification: "layout", confidence: "medium", typeHints };
  }
  if (columnCount <= 1 && stats.numericCellCount === 0) {
    return { classification: "layout", confidence: "medium", typeHints };
  }
  if (dataSignals >= 3) {
    return { classification: "data", confidence: dataSignals >= 5 ? "high" : "medium", typeHints };
  }
  return { classification: "uncertain", confidence: "low", typeHints };
}

function inferTableTypeHints(text: string) {
  const hints: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["balance_sheet", /\b(?:balance sheets?|assets|liabilities|stockholders'? equity|cash and cash equivalents)\b/i],
    ["income_statement", /\b(?:statements? of operations|income statements?|net income|net loss|revenue|net sales|gross profit)\b/i],
    ["comprehensive_income", /\bcomprehensive income\b/i],
    ["cash_flow_statement", /\b(?:statements? of cash flows?|operating activities|investing activities|financing activities)\b/i],
    ["equity_statement", /\b(?:statements? of equity|retained earnings|additional paid-in capital|accumulated deficit)\b/i],
    ["segment_revenue", /\b(?:segment|geographic).{0,80}\b(?:revenue|net sales)\b/i],
    ["debt_maturity", /\b(?:debt|borrowings|maturity|principal payments?|long-term debt)\b/i],
    ["lease_maturity", /\b(?:lease|minimum rental|operating lease|finance lease)\b/i],
    ["share_repurchase", /\b(?:share repurchase|issuer purchases|average price paid|total number of shares purchased)\b/i],
    ["market_risk_sensitivity", /\b(?:market risk|sensitivity|interest rate|foreign currency|basis points?)\b/i],
    ["contractual_obligations", /\b(?:contractual obligations|payments due|purchase obligations)\b/i],
    ["legal_proceedings", /\b(?:legal proceedings|litigation|lawsuit|settlement)\b/i],
    ["related_party_transaction", /\brelated part(?:y|ies)\b/i],
    ["ownership_compensation", /\b(?:director compensation|executive compensation|beneficial ownership|named executive officers?)\b/i],
    ["exhibit_index", /\b(?:EXHIBIT INDEX|Exhibit\s+\d+|EX-\d{1,3})\b/i],
    ["toc", /\bTABLE OF CONTENTS\b/i],
  ];
  for (const [hint, pattern] of patterns) {
    if (pattern.test(text)) hints.push(hint);
  }
  return uniqueStrings(hints);
}

function findTableBlock(blocks: VisibleDomBlock[], sourceStart: number, sourceEnd: number) {
  return (
    blocks.find((block) => block.tableLike && block.sourceStart !== null && Math.abs(block.sourceStart - sourceStart) <= 8) ||
    blocks.find((block) => block.tableLike && block.sourceStart !== null && block.sourceEnd !== null && block.sourceStart >= sourceStart && block.sourceEnd <= sourceEnd + 8) ||
    null
  );
}

function readNearbyTableCaption(blocks: VisibleDomBlock[], sourceStart: number) {
  const candidates = blocks
    .filter((block) => !block.tableLike && block.sourceEnd !== null && block.sourceEnd <= sourceStart)
    .slice(-3)
    .reverse();
  for (const block of candidates) {
    const text = block.text;
    if (!text || text.length > 180) continue;
    if (/\b(?:UNITED STATES SECURITIES|FORM\s+(?:10-K|10-Q|20-F)|Exact name of registrant|SIGNATURES?)\b/i.test(text)) continue;
    if (
      block.kind === "heading" ||
      /^[A-Z0-9 ,()$%-]{8,}$/.test(text) ||
      /\b(?:table|schedule|statement|condensed|consolidated|contractual obligations?|maturit(?:y|ies)|market risk|sensitivity|issuer purchases?|share repurchase)\b/i.test(text)
    ) {
      return text;
    }
  }
  return null;
}

function readNearbyTableFootnotes(blocks: VisibleDomBlock[], sourceEnd: number) {
  const footnotes: string[] = [];
  const candidates = blocks.filter((block) => !block.tableLike && block.sourceStart !== null && block.sourceStart >= sourceEnd).slice(0, 4);
  for (const block of candidates) {
    const text = block.text;
    if (!text || text.length > 700) break;
    if (/^(?:\(\d+\)|\d+\.|\*|Note:|Notes:|See accompanying|Amounts may not foot|Totals may not)/i.test(text)) footnotes.push(text);
    else if (footnotes.length) break;
  }
  return footnotes.slice(0, 4);
}

function readSpan(value: unknown) {
  const span = Number(value);
  return Number.isFinite(span) && span > 0 ? Math.min(50, Math.floor(span)) : 1;
}

function isHeaderLikeTableRow(cells: VisibleTableCell[], numericCellCount: number) {
  const nonEmpty = cells.filter((cell) => !cell.empty);
  if (!nonEmpty.length) return false;
  if (numericCellCount === 0 && nonEmpty.length >= 2 && nonEmpty.every((cell) => wordCount(cell.text) <= 8)) return true;
  return nonEmpty.some((cell) => /\b(?:20\d{2}|19\d{2}|three months|six months|year ended|quarter ended)\b/i.test(cell.text)) && numericCellCount <= 1;
}

function isNumericLikeTableCell(text: string) {
  const value = compactText(text);
  if (!value) return false;
  if (/^[\-–—]$/.test(value)) return true;
  return /^\(?\$?-?\d[\d,]*(?:\.\d+)?\)?-?%?$/.test(value) || /^\$?\(?-?\d[\d,]*(?:\.\d+)?\)?\s*(?:million|thousand|basis points?|bps|%)$/i.test(value);
}

function readTableUnitHint(text: string) {
  return (
    text.match(/\b(?:dollars?|amounts?)\s+in\s+(?:millions|thousands)\b/i)?.[0] ||
    text.match(/\bshares\s+in\s+(?:millions|thousands)\b/i)?.[0] ||
    text.match(/\bin\s+(?:millions|thousands),?\s+except\s+(?:per share|percentages?)\b/i)?.[0] ||
    text.match(/\bbasis points?\b/i)?.[0] ||
    text.match(/\bpercentages?\b/i)?.[0] ||
    null
  );
}

function wordCount(text: string) {
  return compactText(text).split(/\s+/).filter(Boolean).length;
}

function buildVisibleBlock({
  index,
  kind,
  text,
  sourceTag,
  sourcePath,
  sourceStart,
  sourceEnd,
  tableLike,
  layoutTableLike,
  containsInlineXbrl,
}: {
  index: number;
  kind: VisibleBlockKind;
  text: string;
  sourceTag: string | null;
  sourcePath: string;
  sourceStart: number | null;
  sourceEnd: number | null;
  tableLike: boolean;
  layoutTableLike: boolean;
  containsInlineXbrl: boolean;
}): VisibleDomBlock {
  return {
    index,
    kind,
    text,
    sourceTag,
    sourcePath,
    sourceStart,
    sourceEnd,
    tableLike,
    layoutTableLike,
    containsInlineXbrl,
    confidence: kind === "empty_decorative" ? "low" : kind === "paragraph" && tableLike ? "medium" : "high",
  };
}

function classifyVisibleBlock(text: string, tag: string | null, tableLike: boolean, layoutTableLike: boolean): VisibleBlockKind {
  if (!text || isDecorativeText(text)) return "empty_decorative";
  if (/\bSIGNATURES?\b|\/s\//i.test(text)) return "signature";
  if (/\b(?:EXHIBIT INDEX|ITEM\s+15\.?\s+EXHIBITS|ITEM\s+19\.?\s+EXHIBITS)\b|(?:\bEX-\d{1,3}|\bExhibit\s+\d{1,3})/i.test(text)) return "exhibit_index";
  if (/\bUNITED STATES\s+SECURITIES AND EXCHANGE COMMISSION\b|\bFORM\s+(?:10-K\/A|10-Q\/A|20-F\/A|10-K|10-Q|20-F)\b|\bExact name of registrant\b/i.test(text)) return "cover_page";
  if (/^h[1-6]$/i.test(tag || "") || /^(?:PART\s+[IVX]+|ITEM\s+\d+[A-Z]?(?:\.|\b)|ITEM\s+\d+\.[A-Z])\b/i.test(text)) return "heading";
  if (tag === "li" || /^(?:\(?[a-z0-9ivx]+\)|[-*])\s+/i.test(text)) return "list";
  if (tableLike && !layoutTableLike) return "table";
  return "paragraph";
}

function readHtmlTag(token: string) {
  return token.match(/^<\s*\/?\s*([A-Za-z][\w:-]*)/i)?.[1]?.toLowerCase() || null;
}

function isVoidHtmlTag(tag: string) {
  return /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tag);
}

function isBlockBoundaryTag(tag: string) {
  return /^(?:address|article|aside|blockquote|caption|div|dl|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|ul)$/i.test(tag);
}

function isHiddenHtmlTag(tag: string) {
  return /^(?:script|style|noscript|template|head|meta|link|title|ix:header|ix:hidden|xbrli:hidden)$/i.test(tag);
}

function hasHiddenHtmlAttributes(attrs: Record<string, string>, token: string) {
  const style = attrs.style || "";
  return (
    attrs.hidden !== undefined ||
    attrs["aria-hidden"] === "true" ||
    attrs.type === "hidden" ||
    /\s(?:hidden|aria-hidden\s*=\s*["']?true)\b/i.test(token) ||
    /\bdisplay\s*:\s*none\b/i.test(style) ||
    /\bvisibility\s*:\s*hidden\b/i.test(style)
  );
}

function isInlineXbrlVisibleTag(tag: string) {
  return /^ix:(?:nonfraction|nonnumeric|nonnil|fraction)$/i.test(tag);
}

function isOptionalCloseTag(tag: string) {
  return /^(?:p|li|td|th|tr|tbody|thead|tfoot|option)$/i.test(tag);
}

function buildSourcePath(stack: string[], tag: string | null) {
  return [...stack.slice(-5), tag || "text"].filter(Boolean).join(">");
}

function isDecorativeText(text: string) {
  return /^[|._\-\s]+$/.test(text);
}

function normalizeVisibleText(value: string) {
  return compactText(normalizeVisibleInlineText(value)).replace(/\n{3,}/g, "\n\n");
}

function normalizeVisibleInlineText(value: string) {
  return stringValue(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[ \t\f\v]+/g, " ");
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    quot: "\"",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return named[lower] || match;
  });
}

function mapDocumentSummary(document: SecDocumentPayload) {
  return {
    type: nullableString(document.type),
    description: nullableString(document.description),
    is_primary: Boolean(document.isPrimary),
    text_char_count: numberValue(document.textCharCount),
    text_truncated: Boolean(document.textTruncated),
  };
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

function slug(value: string) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCommonNonTicker(value: string) {
  return /^(COMMON|STOCK|SHARES|NYSE|NASDAQ|ADS|ADR|PAR|VALUE|ORDINARY|NAME|TITLE|CLASS)$/i.test(value);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  const text = stringValue(value);
  return text ? [text] : [];
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
