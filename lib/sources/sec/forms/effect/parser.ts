import {
  EFFECT_PARSER_GROUP,
  EFFECT_PARSER_VERSION,
  type CalendarItem,
  type EffectFilerFact,
  type EffectFilingInput,
  type EffectFixtureInput,
  type EffectParseInput,
  type EffectParserOutput,
  type EffectParentFilingContext,
  type EffectSeriesClassContract,
  type EvidenceItem,
  isApprovedEventType,
} from "./types";

const KNOWN_RELATED_FORMS = [
  "S-3ASR",
  "F-3ASR",
  "S-1/A",
  "F-1/A",
  "S-3/A",
  "F-3/A",
  "S-4/A",
  "F-4/A",
  "S-8/A",
  "S-1",
  "F-1",
  "S-3",
  "F-3",
  "S-4",
  "F-4",
  "F-10",
  "S-8",
  "S-6",
  "S-11",
  "N-2",
  "N-4",
  "N-6",
  "N-14",
  "POS AM",
  "POS EX",
  "485APOS",
  "485BPOS",
  "424B3",
  "424B5",
] as const;

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

interface NormalizedInput extends EffectFilingInput {
  parentFilingContext?: EffectParentFilingContext | null;
  marketContext?: Record<string, unknown> | null;
}

interface ExtractedXml {
  xml: string | null;
  effectiveData: string | null;
  rootSubmissionType: string | null;
  effectiveDate: string | null;
  effectiveTime: string | null;
  relatedForm: string | null;
  relatedSubmissionType: string | null;
  referenceAccessionNumber: string | null;
  filers: EffectFilerFact[];
}

interface ExtractedPlainTextEffectFacts {
  effectiveDate: string | null;
  effectiveTime: string | null;
  relatedForm: string | null;
  cik: string | null;
  companyName: string | null;
  registrationNumber: string | null;
}

export function parseEffectFiling(input: EffectParseInput): EffectParserOutput {
  const normalized = normalizeInput(input);
  const sourceText = collectSourceText(normalized);
  const plainText = normalizeWhitespace(stripHtml(sourceText));
  const xml = extractXml(sourceText);
  const plainTextFacts = extractPlainTextEffectFacts(plainText);
  const headerDetected = /<SEC-HEADER>/i.test(sourceText);
  const parentContext = normalized.parentFilingContext ?? null;
  const parentEventType = isApprovedEventType(parentContext?.eventType) ? parentContext.eventType : null;
  const parentIpoKind = normalizeIpoKind(parentContext?.ipoKind);
  const primaryFiler = xml.filers[0] ?? null;
  const headerCompanyName = firstHeaderValue(sourceText, "COMPANY CONFORMED NAME");
  const headerCik = firstHeaderValue(sourceText, "CENTRAL INDEX KEY");
  const headerFiledDate = parseCompactDate(firstHeaderValue(sourceText, "FILED AS OF DATE"));
  const headerEffectivenessDate = parseCompactDate(firstHeaderValue(sourceText, "EFFECTIVENESS DATE"));
  const indexRegistrationFormWasProvided = Object.prototype.hasOwnProperty.call(normalized, "indexRegistrationForm");
  const indexRegistrationForm = normalizeRelatedForm(normalized.indexRegistrationForm);
  const headerRegistrationForm = normalizeRelatedForm(normalized.headerRegistrationForm);
  const formChoice = chooseEffectiveForm({
    fixtureForm: normalized.effectiveFilingForm,
    xmlForm: xml.relatedForm,
    xmlRelatedSubmissionType: xml.relatedSubmissionType,
    indexRegistrationForm,
    headerRegistrationForm,
    parentForm: parentContext?.formType,
    plainTextForm: plainTextFacts.relatedForm,
  });
  const effectiveDateChoice = chooseEffectiveDate({
    fixtureDate: normalized.effectiveDate,
    xmlDate: xml.effectiveDate,
    headerDate: headerEffectivenessDate,
    plainTextDate: plainTextFacts.effectiveDate,
  });
  const normalizedEffectiveTime = normalizeTime(normalized.effectiveTime);
  const xmlEffectiveTime = normalizeTime(xml.effectiveTime);
  const effectiveTime = normalizedEffectiveTime ?? xmlEffectiveTime ?? plainTextFacts.effectiveTime;
  const effectiveTimeSource =
    normalizedEffectiveTime !== null
      ? "fixture.effectiveTime"
      : xmlEffectiveTime !== null
        ? "effectiveData.finalEffectivenessDispTime"
        : plainTextFacts.effectiveTime !== null
          ? "filing text"
          : null;
  const referenceAccessionNumber =
    cleanString(normalized.referenceAccessionNumber) ??
    xml.referenceAccessionNumber ??
    firstMatch(
      plainText,
      /\b(?:reference\s+acc(?:ession)?\s*(?:no\.?|number)?|related\s+accession\s+(?:number|no\.?))\s*[:#]?\s*(\d{10}-\d{2}-\d{6})\b/i,
    );
  const originalAccessionNumber =
    referenceAccessionNumber ??
    cleanString(parentContext?.accessionNumber) ??
    firstMatch(
      plainText,
      /\b(?:original|registration)\s+filing\s+accession\s+(?:number|no\.?)\s*[:#]?\s*(\d{10}-\d{2}-\d{6})\b/i,
    );
  const accessionNumber =
    cleanString(normalized.accessionNumber) ??
    firstHeaderValue(sourceText, "ACCESSION NUMBER") ??
    firstMatch(plainText, /\bSEC\s+Accession\s+No\.?\s*(\d{10}-\d{2}-\d{6})\b/i) ??
    firstMatch(plainText, /\baccession\s+(?:number|no\.?)\s*[:#]?\s*(\d{10}-\d{2}-\d{6})\b/i);
  const registrationNumber =
    cleanString(normalized.registrationNumber) ??
    cleanString(primaryFiler?.fileNumber) ??
    cleanString(parentContext?.registrationNumber) ??
    firstHeaderValue(sourceText, "SEC FILE NUMBER") ??
    plainTextFacts.registrationNumber ??
    firstMatch(plainText, /\b(?:registration|file)\s+(?:number|no\.?)\s*[:#]?\s*((?:333|001|811)-[0-9A-Z-]+)\b/i);
  const originalFilingReference =
    cleanString(normalized.originalFilingReference) ??
    referenceAccessionNumber ??
    cleanString(parentContext?.originalFilingReference) ??
    cleanString(parentContext?.analysisReference) ??
    originalAccessionNumber;
  const companyName =
    cleanString(normalized.companyName) ??
    cleanString(parentContext?.companyName) ??
    cleanString(primaryFiler?.entityName) ??
    headerCompanyName ??
    plainTextFacts.companyName ??
    firstMatch(plainText, /\b(?:company|registrant|issuer)\s*[:\-]\s*([A-Z][A-Za-z0-9 .,&'-]{2,120})/i);
  const cik =
    cleanString(normalized.cik) ??
    cleanString(primaryFiler?.cik) ??
    headerCik ??
    plainTextFacts.cik;
  const filingDate = parseDateLike(normalized.filingDate) ?? parseDateLike(parentContext?.filingDate) ?? headerFiledDate;
  const ticker =
    normalizeTicker(normalized.ticker) ??
    normalizeTicker(parentContext?.ticker) ??
    normalizeTicker(firstMatch(plainText, /\b(?:ticker|trading symbol)\s*[:\-]\s*([A-Z.]{1,8})\b/i));
  const exchange =
    cleanString(normalized.exchange) ??
    cleanString(parentContext?.exchange) ??
    firstMatch(plainText, /\b(?:exchange|market)\s*[:\-]\s*(NASDAQ|NYSE|NYSE American|AMEX|CBOE)\b/i);
  const effectiveRegistrationReference =
    registrationNumber === null
      ? referenceAccessionNumber === null
        ? originalFilingReference
        : `Reference Accession ${referenceAccessionNumber}`
      : `Registration No. ${registrationNumber}`;
  const effectiveTargetClear =
    formChoice.value !== null &&
    (registrationNumber !== null || referenceAccessionNumber !== null || originalFilingReference !== null);
  const parentTarget = evaluateParentTarget({
    parentContext,
    effectiveFilingForm: formChoice.value,
    registrationNumber,
    referenceAccessionNumber,
    originalAccessionNumber,
    originalFilingReference,
    effectiveTargetClear,
  });
  const evidence = buildEvidence({
    effectiveFilingForm: formChoice.value,
    effectiveDate: effectiveDateChoice.value,
    effectiveTime,
    registrationNumber,
    referenceAccessionNumber,
    filers: xml.filers,
    formSource: formChoice.source,
    dateSource: effectiveDateChoice.source,
    timeSource: effectiveTimeSource,
  });
  const warnings = buildWarnings({
    companyName,
    effectiveDate: effectiveDateChoice.value,
    effectiveFilingForm: formChoice.value,
    registrationNumber,
    originalFilingReference,
    xmlRootSubmissionType: xml.rootSubmissionType,
    formSource: formChoice.source,
    hasMultipleFilers: xml.filers.length > 1,
    hasSeriesClassContractData: xml.filers.some((filer) => filer.seriesClassContract !== null),
    indexRegistrationFormWasProvided,
    indexRegistrationForm,
    xmlRelatedForm: xml.relatedForm,
    effectiveTargetClear,
    parentTargetConflicts: parentTarget.conflicts,
    targetAmbiguityWarnings: parentTarget.ambiguityWarnings,
  });

  return {
    parserVersion: EFFECT_PARSER_VERSION,
    parserGroup: EFFECT_PARSER_GROUP,
    formType: "EFFECT",
    accessionNumber,
    isSupported: true,
    summary: buildSummary(companyName, formChoice.value, effectiveDateChoice.value, xml.filers.length),
    facts: {
      companyName,
      ticker,
      exchange,
      cik,
      filingDate,
      effectiveDate: effectiveDateChoice.value,
      effectiveTime,
      accessionNumber,
      registrationNumber,
      effectiveRegistrationReference,
      effectiveFilingForm: formChoice.value,
      relatedSubmissionType: xml.relatedSubmissionType,
      referenceAccessionNumber,
      originalFilingReference,
      originalAccessionNumber,
      originalAnalysisReference: cleanString(parentContext?.analysisReference),
      filers: xml.filers,
      primaryFiler,
      hasMultipleFilers: xml.filers.length > 1,
      hasSeriesClassContractData: xml.filers.some((filer) => filer.seriesClassContract !== null),
      effectiveFormSource: formChoice.source,
      effectiveDateSource: effectiveDateChoice.source,
      parentContextProvided: parentContext !== null,
      parentEventType,
      parentEventTitle: cleanString(parentContext?.eventTitle),
      parentIpoKind,
      parentFormType: parentTarget.parentFormType,
      parentAccessionNumber: parentTarget.parentAccessionNumber,
      parentRegistrationNumber: parentTarget.parentRegistrationNumber,
      parentScore: typeof parentContext?.score === "number" ? parentContext.score : null,
      originalAnalysisShouldBeShown: parentContext?.shouldShowOriginalAnalysis ?? originalFilingReference !== null,
      effectiveTargetClear,
      parentTargetMatch: parentTarget.match,
      parentTargetConflicts: parentTarget.conflicts,
      targetAmbiguityWarnings: parentTarget.ambiguityWarnings,
      sourceExcerpts: evidence,
    },
    signals: buildSignals({
      effectiveFilingForm: formChoice.value,
      effectiveDate: effectiveDateChoice.value,
      effectiveRegistrationReference,
      parentContextProvided: parentContext !== null,
      hasMultipleFilers: xml.filers.length > 1,
      hasSeriesClassContractData: xml.filers.some((filer) => filer.seriesClassContract !== null),
      referenceAccessionNumber,
      formSource: formChoice.source,
      effectiveTargetClear,
      parentTargetMatch: parentTarget.match,
      hasTargetAmbiguity: parentTarget.ambiguityWarnings.length > 0,
    }),
    calendarItems: buildCalendarItems(effectiveDateChoice.value),
    warnings,
    raw: {
      sourceTextLength: plainText.length,
      documentCount: normalized.documents?.length ?? 0,
      xmlDetected: xml.xml !== null,
      headerDetected,
      parentFilingContextUsed: parentContext !== null,
      marketContextProvided: normalized.marketContext !== null && normalized.marketContext !== undefined,
    },
  };
}

function normalizeInput(input: EffectParseInput): NormalizedInput {
  if (isFixtureInput(input)) {
    return {
      ...input.filing,
      parentFilingContext: input.parentFilingContext ?? input.filing.parentFilingContext ?? null,
      marketContext: input.marketContext ?? input.filing.marketContext ?? null,
    };
  }

  return input;
}

function isFixtureInput(input: EffectParseInput): input is EffectFixtureInput {
  return "filing" in input;
}

function collectSourceText(input: NormalizedInput): string {
  const chunks: string[] = [];

  addText(chunks, input.text);
  addText(chunks, input.html);

  for (const document of input.documents ?? []) {
    addText(chunks, document.text);
    addText(chunks, document.html);
  }

  return chunks.join("\n");
}

function extractPlainTextEffectFacts(text: string): ExtractedPlainTextEffectFacts {
  const separator = String.raw`\s*(?:\|\s*)*`;
  const dateText = firstMatch(
    text,
    new RegExp(
      String.raw`\beffective(?:ness)?\s+date\s*:${separator}([A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})`,
      "i",
    ),
  );
  const labeledTime = firstMatch(
    text,
    new RegExp(
      String.raw`\beffective(?:ness)?\s+date\s*:${separator}(?:[A-Za-z]+\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:A\.?M\.?|P\.?M\.?))`,
      "i",
    ),
  );
  const sequential = /\bLIVE\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([A-Z0-9-]+(?:\/A)?)\s+(\d{10})\s+(.{2,160}?)\s+((?:333|001|811)-[0-9A-Z-]+)\b/i.exec(text);

  return {
    effectiveDate: parseDateLike(dateText) ?? parseDateLike(sequential?.[1]),
    effectiveTime: normalizeEffectTime(labeledTime) ?? normalizeTime(sequential?.[2]),
    relatedForm:
      extractRelatedFormFromText(text) ??
      normalizeRelatedForm(sequential?.[3]),
    cik:
      firstMatch(text, new RegExp(String.raw`\bCIK\s*:${separator}(\d{1,10})\b`, "i")) ??
      cleanString(sequential?.[4]),
    companyName:
      decodeXmlEntities(
        firstMatch(
          text,
          new RegExp(String.raw`\bCompany\s+Name\s*:${separator}([^|]{2,160}?)(?=\s*\||\s+File\s+Number\b|$)`, "i"),
        ),
      ) ?? decodeXmlEntities(cleanString(sequential?.[5])),
    registrationNumber:
      firstMatch(
        text,
        new RegExp(String.raw`\b(?:Registration|File)\s+(?:Number|No\.?)\s*:${separator}((?:333|001|811)-[0-9A-Z-]+)\b`, "i"),
      ) ?? cleanString(sequential?.[6]),
  };
}

function addText(chunks: string[], value: string | null | undefined): void {
  const cleaned = cleanString(value);

  if (cleaned !== null) {
    chunks.push(cleaned);
  }
}

function extractXml(sourceText: string): ExtractedXml {
  const xml = firstMatch(sourceText, /(<edgarSubmission>[\s\S]*?<\/edgarSubmission>)/i);
  const effectiveData = xml === null ? null : firstMatch(xml, /<effectiveData>([\s\S]*?)<\/effectiveData>/i);

  if (xml === null || effectiveData === null) {
    return {
      xml,
      effectiveData,
      rootSubmissionType: null,
      effectiveDate: null,
      effectiveTime: null,
      relatedForm: null,
      relatedSubmissionType: null,
      referenceAccessionNumber: null,
      filers: [],
    };
  }

  return {
    xml,
    effectiveData,
    rootSubmissionType: tagValue(xml, "submissionType"),
    effectiveDate: parseDateLike(tagValue(effectiveData, "finalEffectivenessDispDate")),
    effectiveTime: normalizeTime(tagValue(effectiveData, "finalEffectivenessDispTime")),
    relatedForm: normalizeRelatedForm(tagValue(effectiveData, "form")),
    relatedSubmissionType: normalizeRelatedForm(tagValue(effectiveData, "submissionType")),
    referenceAccessionNumber: cleanString(tagValue(effectiveData, "accessionNumber")),
    filers: parseFilers(effectiveData),
  };
}

function parseFilers(effectiveData: string): EffectFilerFact[] {
  return Array.from(effectiveData.matchAll(/<filer>([\s\S]*?)<\/filer>/gi), (match) => {
    const block = match[1];

    return {
      cik: cleanString(tagValue(block, "cik")),
      entityName: decodeXmlEntities(cleanString(tagValue(block, "entityName"))),
      fileNumber: cleanString(tagValue(block, "fileNumber")),
      seriesClassContract: parseSeriesClassContract(block),
    };
  });
}

function parseSeriesClassContract(filerBlock: string): EffectSeriesClassContract | null {
  const existing = firstMatch(filerBlock, /<seriesClassContractData>\s*<existing>([\s\S]*?)<\/existing>\s*<\/seriesClassContractData>/i);

  if (existing === null) {
    return null;
  }

  return {
    seriesId: cleanString(tagValue(existing, "seriesId")),
    seriesName: decodeXmlEntities(cleanString(tagValue(existing, "seriesName"))),
    classContractId: cleanString(tagValue(existing, "classContractId")),
    classContractName: decodeXmlEntities(cleanString(tagValue(existing, "classContractName"))),
  };
}

function tagValue(xml: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
  return cleanString(match?.[1]);
}

function chooseEffectiveForm(input: {
  fixtureForm: string | null | undefined;
  xmlForm: string | null;
  xmlRelatedSubmissionType: string | null;
  indexRegistrationForm: string | null;
  headerRegistrationForm: string | null;
  parentForm: string | null | undefined;
  plainTextForm: string | null;
}): { value: string | null; source: string | null } {
  const candidates = [
    { value: normalizeRelatedForm(input.fixtureForm), source: "fixture.effectiveFilingForm" },
    { value: input.xmlForm, source: "effectiveData.form" },
    { value: input.xmlRelatedSubmissionType, source: "effectiveData.submissionType" },
    { value: input.indexRegistrationForm, source: "fixture.indexRegistrationForm" },
    { value: input.headerRegistrationForm, source: "fixture.headerRegistrationForm" },
    { value: normalizeRelatedForm(input.parentForm), source: "fixture.parentFilingContext.formType" },
    { value: input.plainTextForm, source: "filing text" },
  ];
  const selected = candidates.find((candidate) => candidate.value !== null);

  return selected ?? { value: null, source: null };
}

function chooseEffectiveDate(input: {
  fixtureDate: string | null | undefined;
  xmlDate: string | null;
  headerDate: string | null;
  plainTextDate: string | null;
}): { value: string | null; source: string | null } {
  const candidates = [
    { value: parseDateLike(input.fixtureDate), source: "fixture.effectiveDate" },
    { value: input.xmlDate, source: "effectiveData.finalEffectivenessDispDate" },
    { value: input.headerDate, source: "SEC-HEADER.EFFECTIVENESS DATE" },
    { value: input.plainTextDate, source: "filing text" },
  ];
  const selected = candidates.find((candidate) => candidate.value !== null);

  return selected ?? { value: null, source: null };
}

function firstHeaderValue(sourceText: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^\\s*${escaped}:\\s*(.+)$`, "im").exec(sourceText);
  return cleanString(match?.[1]);
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstMatch(value: string, pattern: RegExp): string | null {
  const match = pattern.exec(value);

  return cleanString(match?.[1]);
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function decodeXmlEntities(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function normalizeTicker(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  return cleaned === null ? null : cleaned.toUpperCase();
}

function normalizeIpoKind(value: string | null | undefined): "traditional" | "spac" | null {
  const cleaned = cleanString(value)?.toLowerCase();

  if (cleaned === "traditional" || cleaned === "spac") {
    return cleaned;
  }

  return null;
}

function normalizeRelatedForm(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);

  if (cleaned === null) {
    return null;
  }

  const upper = cleaned.toUpperCase().replace(/^FORM\s+/, "").replace(/\s+/g, " ");
  return KNOWN_RELATED_FORMS.includes(upper as (typeof KNOWN_RELATED_FORMS)[number]) ? upper : upper;
}

function extractRelatedFormFromText(text: string): string | null {
  for (const formType of KNOWN_RELATED_FORMS) {
    const escaped = formType.replace("/", "\\/").replace(" ", "\\s+");
    const pattern = new RegExp(
      `\\b(?:form\\s*:\\s*(?:\\|\\s*)*|form\\s+|registration\\s+statement\\s+on\\s+|statement\\s+on\\s+)${escaped}\\b`,
      "i",
    );

    if (pattern.test(text)) {
      return formType;
    }
  }

  return null;
}

function parseDateLike(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);

  if (cleaned === null) {
    return null;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleaned);

  if (isoMatch !== null) {
    return cleaned;
  }

  const monthMatch = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(cleaned);

  if (monthMatch !== null) {
    const month = MONTHS[monthMatch[1].toLowerCase()];

    if (month === undefined) {
      return null;
    }

    const day = monthMatch[2].padStart(2, "0");
    return `${monthMatch[3]}-${month}-${day}`;
  }

  return parseCompactDate(cleaned);
}

function parseCompactDate(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);

  if (cleaned === null) {
    return null;
  }

  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(cleaned);

  if (match === null) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeTime(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);

  if (cleaned === null) {
    return null;
  }

  const match = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(cleaned);
  return match === null ? null : cleaned;
}

function normalizeEffectTime(value: string | null | undefined): string | null {
  const normalized = normalizeTime(value);
  if (normalized) return normalized;

  const cleaned = cleanString(value)?.toUpperCase().replace(/\s+/g, " ");
  const match = cleaned?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP])\.?M\.?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  if (hour < 1 || hour > 12) return null;
  if (match[4] === "A") hour %= 12;
  else if (hour < 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
}

function buildEvidence(fields: {
  effectiveFilingForm: string | null;
  effectiveDate: string | null;
  effectiveTime: string | null;
  registrationNumber: string | null;
  referenceAccessionNumber: string | null;
  filers: EffectFilerFact[];
  formSource: string | null;
  dateSource: string | null;
  timeSource: string | null;
}): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];

  if (fields.effectiveFilingForm !== null) {
    evidence.push({
      label: "effective_filing_form",
      value: fields.effectiveFilingForm,
      source: fields.formSource ?? "EFFECT fixture",
    });
  }

  if (fields.effectiveDate !== null) {
    evidence.push({
      label: "effective_date",
      value: fields.effectiveDate,
      source: fields.dateSource ?? "EFFECT fixture",
    });
  }

  if (fields.effectiveTime !== null) {
    evidence.push({
      label: "effective_time",
      value: fields.effectiveTime,
      source: fields.timeSource ?? "EFFECT notice",
    });
  }

  if (fields.registrationNumber !== null) {
    evidence.push({
      label: "registration_number",
      value: fields.registrationNumber,
      source: "effectiveData.filer.fileNumber or SEC-HEADER.SEC FILE NUMBER",
    });
  }

  if (fields.referenceAccessionNumber !== null) {
    evidence.push({
      label: "reference_accession_number",
      value: fields.referenceAccessionNumber,
      source: "effectiveData.accessionNumber",
    });
  }

  for (const filer of fields.filers) {
    if (filer.cik !== null && filer.entityName !== null) {
      evidence.push({
        label: "effective_filer",
        value: `${filer.entityName} (${filer.cik})`,
        source: "effectiveData.filer",
      });
    }

    if (filer.seriesClassContract !== null) {
      const contract = filer.seriesClassContract.classContractName ?? filer.seriesClassContract.classContractId ?? "series/class contract";
      evidence.push({
        label: "series_class_contract",
        value: contract,
        source: "effectiveData.filer.seriesClassContractData",
      });
    }
  }

  return evidence;
}

function buildWarnings(fields: {
  companyName: string | null;
  effectiveDate: string | null;
  effectiveFilingForm: string | null;
  registrationNumber: string | null;
  originalFilingReference: string | null;
  xmlRootSubmissionType: string | null;
  formSource: string | null;
  hasMultipleFilers: boolean;
  hasSeriesClassContractData: boolean;
  indexRegistrationFormWasProvided: boolean;
  indexRegistrationForm: string | null;
  xmlRelatedForm: string | null;
  effectiveTargetClear: boolean;
  parentTargetConflicts: string[];
  targetAmbiguityWarnings: string[];
}): string[] {
  const warnings: string[] = [];

  if (fields.xmlRootSubmissionType !== null && fields.xmlRootSubmissionType !== "EFFECT") {
    warnings.push(`Root XML submissionType was ${fields.xmlRootSubmissionType}, not EFFECT.`);
  }

  if (fields.companyName === null) {
    warnings.push("Company name was not present in the EFFECT fixture.");
  }

  if (fields.effectiveDate === null) {
    warnings.push("Effective date was not present in the EFFECT fixture.");
  }

  if (fields.effectiveFilingForm === null) {
    warnings.push("Related registration form type was not identified.");
  }

  if (fields.formSource === "effectiveData.submissionType") {
    warnings.push("Related registration form came from effectiveData.submissionType because effectiveData.form was absent.");
  }

  if (fields.indexRegistrationFormWasProvided && fields.indexRegistrationForm === null && fields.xmlRelatedForm !== null) {
    warnings.push("Index/header registration form was absent in fixture metadata; XML effectiveData.form was used.");
  }

  if (fields.registrationNumber === null && fields.originalFilingReference === null) {
    warnings.push("No registration number or original filing reference was identified.");
  }

  if (!fields.effectiveTargetClear) {
    warnings.push("Effective registration target is not clear from source-backed EFFECT facts.");
  }

  warnings.push(...fields.parentTargetConflicts);
  warnings.push(...fields.targetAmbiguityWarnings);

  if (fields.hasMultipleFilers) {
    warnings.push("EFFECT notice contains multiple filers; downstream integration should preserve all filer/file-number pairs.");
  }

  if (fields.hasSeriesClassContractData) {
    warnings.push("EFFECT notice contains fund series/class/contract data; operating-company ticker assumptions may not apply.");
  }

  return warnings;
}

function buildCalendarItems(effectiveDate: string | null): CalendarItem[] {
  if (effectiveDate === null) {
    return [];
  }

  return [
    {
      label: "Registration statement effective date",
      date: effectiveDate,
      source: "EFFECT filing",
    },
  ];
}

function buildSignals(fields: {
  effectiveFilingForm: string | null;
  effectiveDate: string | null;
  effectiveRegistrationReference: string | null;
  parentContextProvided: boolean;
  hasMultipleFilers: boolean;
  hasSeriesClassContractData: boolean;
  referenceAccessionNumber: string | null;
  formSource: string | null;
  effectiveTargetClear: boolean;
  parentTargetMatch: boolean | null;
  hasTargetAmbiguity: boolean;
}): string[] {
  const signals: string[] = ["effectiveness_notice"];

  if (fields.effectiveFilingForm !== null && fields.effectiveDate !== null) {
    signals.push("deterministic_effectiveness_notice");
  }

  if (fields.effectiveDate !== null) {
    signals.push("effectiveness_date_identified");
  }

  if (fields.effectiveRegistrationReference !== null) {
    signals.push("registration_reference_identified");
  }

  if (fields.referenceAccessionNumber !== null) {
    signals.push("reference_accession_identified");
  }

  if (fields.formSource === "effectiveData.submissionType") {
    signals.push("post_effective_amendment_reference");
  }

  if (fields.parentContextProvided) {
    signals.push("parent_context_from_fixture");
  }

  if (fields.effectiveTargetClear) {
    signals.push("effective_target_clear");
  }

  if (fields.parentTargetMatch === true) {
    signals.push("parent_target_matched");
  }

  if (fields.parentTargetMatch === false) {
    signals.push("parent_target_conflict");
  }

  if (fields.hasTargetAmbiguity) {
    signals.push("effective_target_ambiguous");
  }

  if (fields.hasMultipleFilers) {
    signals.push("multiple_effective_filers");
  }

  if (fields.hasSeriesClassContractData) {
    signals.push("series_class_contract_data");
  }

  return signals;
}

function evaluateParentTarget(input: {
  parentContext: EffectParentFilingContext | null;
  effectiveFilingForm: string | null;
  registrationNumber: string | null;
  referenceAccessionNumber: string | null;
  originalAccessionNumber: string | null;
  originalFilingReference: string | null;
  effectiveTargetClear: boolean;
}): {
  parentFormType: string | null;
  parentAccessionNumber: string | null;
  parentRegistrationNumber: string | null;
  match: boolean | null;
  conflicts: string[];
  ambiguityWarnings: string[];
} {
  const parentFormType = normalizeRelatedForm(input.parentContext?.formType);
  const parentAccessionNumber = cleanString(input.parentContext?.accessionNumber);
  const parentRegistrationNumber = cleanString(input.parentContext?.registrationNumber);
  const conflicts: string[] = [];
  const ambiguityWarnings: string[] = [];

  if (!input.effectiveTargetClear) {
    ambiguityWarnings.push("Effective registration target is ambiguous: missing related form or registration/accession reference.");
  }

  if (input.parentContext === null) {
    ambiguityWarnings.push("Parent filing context is absent; parser cannot confirm which prior registration analysis should be shown.");
    return {
      parentFormType,
      parentAccessionNumber,
      parentRegistrationNumber,
      match: null,
      conflicts,
      ambiguityWarnings,
    };
  }

  if (parentFormType !== null && input.effectiveFilingForm !== null && parentFormType !== input.effectiveFilingForm) {
    conflicts.push(`Parent form type ${parentFormType} conflicts with EFFECT related form ${input.effectiveFilingForm}.`);
  }

  if (
    parentRegistrationNumber !== null &&
    input.registrationNumber !== null &&
    parentRegistrationNumber !== input.registrationNumber
  ) {
    conflicts.push(
      `Parent registration number ${parentRegistrationNumber} conflicts with EFFECT registration number ${input.registrationNumber}.`,
    );
  }

  const effectAccessionReference = input.referenceAccessionNumber ?? input.originalAccessionNumber;
  if (
    parentAccessionNumber !== null &&
    effectAccessionReference !== null &&
    parentAccessionNumber !== effectAccessionReference
  ) {
    conflicts.push(
      `Parent accession ${parentAccessionNumber} conflicts with EFFECT referenced accession ${effectAccessionReference}.`,
    );
  }

  if (parentRegistrationNumber === null && parentAccessionNumber === null) {
    ambiguityWarnings.push("Parent filing context lacks registration number and accession number for target matching.");
  }

  return {
    parentFormType,
    parentAccessionNumber,
    parentRegistrationNumber,
    match: conflicts.length > 0 ? false : input.effectiveTargetClear && ambiguityWarnings.length === 0,
    conflicts,
    ambiguityWarnings,
  };
}

function buildSummary(companyName: string | null, relatedForm: string | null, effectiveDate: string | null, filerCount: number): string {
  const company = companyName ?? "The issuer";
  const form = relatedForm ?? "a related registration statement";
  const datePhrase = effectiveDate === null ? "" : ` on ${effectiveDate}`;
  const filerPhrase = filerCount > 1 ? ` for ${filerCount} filers` : "";

  if (relatedForm === null && effectiveDate === null) {
    return `${company} filed an EFFECT notice, but the notice does not identify the related registration filing or effective date.`;
  }

  return relatedForm === null
    ? `${company}'s registration statement became effective${datePhrase}${filerPhrase}.`
    : `${company}'s ${form} registration statement became effective${datePhrase}${filerPhrase}.`;
}
