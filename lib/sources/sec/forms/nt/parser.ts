import {
  NT_PARSER_GROUP,
  NT_PARSER_VERSION,
  type NtConfidence,
  type NtFilingDocumentInput,
  type NtFilingInput,
  type NtParserOutput,
  type NtSupportedFormType,
} from "./types";

const SOURCE_TEXT_FLAG_DEFINITIONS = [
  {
    flag: "accounting_audit_terms",
    pattern:
      /\b(accounting|audit|auditor|internal control|restatement|valuation|tax provision|impairment|going concern|material weakness)\b/i,
  },
  {
    flag: "sales_revenue_terms",
    pattern: /\b(sales|revenue|customer|order|gross margin|margin)\b/i,
  },
  {
    flag: "legal_regulatory_terms",
    pattern: /\b(litigation|lawsuit|investigation|subpoena|sec inquiry|regulatory|enforcement)\b/i,
  },
  {
    flag: "exchange_listing_terms",
    pattern: /\b(nasdaq|nyse|listing|delist|continued listing|minimum bid)\b/i,
  },
  {
    flag: "leadership_governance_terms",
    pattern: /\b(chief executive|chief financial|ceo|cfo|resign|resignation|board|governance|disclosure controls)\b/i,
  },
  {
    flag: "strategic_transaction_terms",
    pattern: /\b(merger|acquisition|acquired|divestiture|subsidiary|consolidation|purchase accounting)\b/i,
  },
] as const;

const CHECKED_MARK = String.raw`(?:\u2612|\u2611|\u2713|\u2714|\u25A0|\[\s*[xX]\s*\]|\(\s*[xX]\s*\)|\b[xX]\b)`;
const UNCHECKED_MARK = String.raw`(?:\u2610|\u25A1|\[\s*\]|\b[oO]\b)`;

const CHECKED_EXPLICIT_TOKEN_PATTERN = /☒|☑|✓|✔|■|●|\[\s*[xX]\s*\]/g;
const UNCHECKED_EXPLICIT_TOKEN_PATTERN = /☐|□|\[\s*(?:_|\s*)\s*\]/g;
const RAW_X_TOKEN_PATTERN = /(?<![A-Za-z])x(?![A-Za-z])/gi;
const YES_NO_CHECKBOX_TOKEN = String.raw`(?:\u2612|\u2611|\u2713|\u2714|\u25A0|\u25CF|\u2610|\u25A1|\[\s*[xX]\s*\]|\[\s*(?:_|\s*)\s*\]|\b[xX]\b|\b[oO]\b)`;

const TARGET_REPORT_LABELS = [
  {
    report: "10-K",
    transition: false,
    label: "Form 10-K",
    pattern: /(?<!Transition Report on )\bForm\s+10-K\b/i,
  },
  {
    report: "10-Q",
    transition: false,
    label: "Form 10-Q",
    pattern: /(?<!Transition Report on )\bForm\s+10-Q\b/i,
  },
  {
    report: "20-F",
    transition: false,
    label: "Form 20-F",
    pattern: /(?<!Transition Report on )\bForm\s+20-F\b/i,
  },
  {
    report: "10-K",
    transition: true,
    label: "Transition Report on Form 10-K",
    pattern: /\bTransition\s+Report\s+on\s+Form\s+10-K\b/i,
  },
  {
    report: "10-Q",
    transition: true,
    label: "Transition Report on Form 10-Q",
    pattern: /\bTransition\s+Report\s+on\s+Form\s+10-Q\b/i,
  },
  {
    report: "20-F",
    transition: true,
    label: "Transition Report on Form 20-F",
    pattern: /\bTransition\s+Report\s+on\s+Form\s+20-F\b/i,
  },
] as const;

type NtDocumentCandidate = {
  source: string;
  type: string | null;
  sequence: string | null;
  filename: string | null;
  description: string | null;
  text: string;
  isPrimary: boolean;
  excludedReason: string | null;
};

type NtSelectedDocument = NtDocumentCandidate & {
  normalizedText: string;
  confidence: NtConfidence;
  reason: string;
  credible: boolean;
  warnings: string[];
  inventory: NtParserOutput["raw"]["documentInventory"];
};

type NtSectionName = "partI" | "partII" | "partIII" | "partIV";

type NtSectionBoundary = {
  name: NtSectionName;
  start: number;
  labelEnd: number;
  confidence: NtConfidence;
  anchor: string;
};

type NtSectionSegments = NonNullable<NtParserOutput["raw"]["sectionSegments"]>;

type NtCheckboxResolution = {
  checked: boolean | null;
  token: string | null;
  label: string;
  evidence: string | null;
  confidence: NtConfidence;
  ambiguous: boolean;
};

type NtTargetReportCheckboxGroup = NtParserOutput["facts"]["targetReportCheckboxGroup"];
type NtPartIvFacts = NtParserOutput["facts"]["partIv"];
type NtPortionOnlyFacts = NtParserOutput["facts"]["portionOnly"];
type NtElectronicFilingDifficultyFacts = NtParserOutput["facts"]["electronicFilingDifficulty"];
type NtPartIvYesNo = {
  answer: boolean | null;
  ambiguous: boolean;
  evidence: string | null;
  confidence: NtConfidence;
  foundByFallback: boolean;
};

export function parseNtFiling(input: NtFilingInput): NtParserOutput {
  const selectedDocument = selectNtFilingDocument(input);
  const normalizedText = selectedDocument.normalizedText;
  const sections = segmentForm12b25Sections(normalizedText);
  const isAmendment = detectAmendment(input.formType, normalizedText);
  const amendmentNumber = extractAmendmentNumber(normalizedText);
  const amendmentPurpose = extractAmendmentPurpose(normalizedText);
  const originalAccessionNumber = extractOriginalAccessionNumber(normalizedText);
  const targetReportCheckboxGroup = parseTargetReportCheckboxGroup(input.formType, normalizedText, sections);
  const checkedReports = targetReportCheckboxGroup.checkedReports;
  const transitionReportType =
    targetReportCheckboxGroup.selectedTransitionReport ??
    (targetReportCheckboxGroup.checkedTransitionReports.length === 1
      ? targetReportCheckboxGroup.checkedTransitionReports[0]
      : null);
  const isTransitionReport = transitionReportType !== null;
  const bodyFormType = buildBodyFormType(targetReportCheckboxGroup, isAmendment);
  const submissionBodyFormMismatch = detectSubmissionBodyFormMismatch(input.formType, bodyFormType);
  const amendmentPartialBody = isAmendment && selectedDocument.credible && isAmendmentPartialBody(sections);
  const transitionPeriod = extractTransitionPeriodEnded(normalizedText, sections);
  const transitionPeriodEnded = transitionPeriod.value;
  const delayedReport = detectDelayedReport(
    input.formType,
    targetReportCheckboxGroup,
  );
  const formType = `NT ${delayedReport}` as NtSupportedFormType;
  const extensionDays = delayedReport === "10-Q" ? 5 : 15;
  const lateFilingReason = extractLateFilingReason(normalizedText, sections);
  const partIiiNarrativeFlags = detectPartIiiNarrativeFlags(lateFilingReason);
  const partIi = detectPartIiFacts(normalizedText, sections);
  const partIv = parsePartIvFacts(normalizedText, sections);
  const fallbackSignificantChangeDescription =
    extractSignificantChangeDescription(normalizedText);
  const fallbackSignificantChangeExpected =
    detectSignificantChangeExpected(normalizedText);
  const significantChangeDescription =
    partIv.significantChange.explanation ?? fallbackSignificantChangeDescription;
  const significantChangeExpected =
    partIv.significantChange.evidence ? partIv.significantChange.answer : fallbackSignificantChangeExpected;
  const anticipatedWithinExtension =
    detectAnticipatedWithinExtension(normalizedText, partIi.withinExtensionChecked);
  const unableWithoutUnreasonableEffort =
    partIi.unableWithoutUnreasonableEffortChecked ??
    detectUnableWithoutUnreasonableEffort(normalizedText);
  const accountantStatementText = extractAccountantStatementText(normalizedText);
  const accountantStatementAttached = detectAccountantStatement(
    normalizedText,
    partIi.accountantStatementChecked,
    accountantStatementText,
  );
  const period = extractPeriodOfReport(normalizedText, sections);
  const periodOfReport =
    input.periodOfReport ?? period.value;
  const otherPeriodicReportsFiled = partIv.otherPeriodicReports.evidence
    ? partIv.otherPeriodicReports.answer
    : detectOtherPeriodicReportsFiled(normalizedText);
  const noRelianceOrRestatementDisclosed =
    detectNoRelianceOrRestatement(normalizedText);
  const portionOnly = detectPortionOnlyFacts(normalizedText, sections);
  const electronicFilingDifficulty = detectElectronicFilingDifficulty(lateFilingReason);
  const sourceText = [
    lateFilingReason,
    significantChangeDescription,
    partIv.otherPeriodicReports.explanation,
    amendmentPurpose,
  ]
    .filter(Boolean)
    .join(" ");

  const sourceTextFlags = detectSourceTextFlags({
    sourceText,
    partIiiText: lateFilingReason,
    partIiiNarrativeFlags,
    significantChangeExpected,
    noRelianceOrRestatementDisclosed,
    accountantStatementAttached,
    isAmendment,
    isTransitionReport,
    anticipatedWithinExtension,
  });
  const sourceExcerpts = buildSourceExcerpts(
    lateFilingReason,
    significantChangeDescription,
    amendmentPurpose,
    accountantStatementText,
  );
  const rawDataQuality = buildRawDataQuality({
    formType,
    delayedReport,
    periodOfReport,
    lateFilingReason,
    anticipatedWithinExtension,
    significantChangeExpected,
    amendmentPurpose,
    isAmendment,
    isTransitionReport,
    transitionPeriodEnded,
    checkedReports,
    transitionReportType,
    targetReportCheckboxGroup,
    submissionBodyFormMismatch,
    amendmentPartialBody,
    periodOfReportAmbiguous: period.ambiguous,
    transitionPeriodEndedAmbiguous: transitionPeriod.ambiguous,
    accountantStatementAttached,
    partIv,
    portionOnly,
    electronicFilingDifficulty,
    normalizedText,
  });

  const calendarItems =
    anticipatedWithinExtension === true
      ? [
          {
            label: "Rule 12b-25 extension window",
            date: null,
            description: `Issuer states it expects to file within the ${extensionDays} calendar day extension period.`,
          },
        ]
      : [];

  const company = input.companyName ?? null;
  const subject = company ?? input.ticker ?? "issuer";
  const reportKind = isTransitionReport
    ? `transition report on Form ${transitionReportType}`
    : `Form ${delayedReport}`;
  const significantChangePhrase =
    significantChangeExpected === true
      ? "expects a significant change in results"
      : significantChangeExpected === false
        ? "does not expect a significant change in results"
        : "does not clearly answer the significant-results-change question";
  const amendmentPhrase = isAmendment ? " amendment" : "";
  const summary = selectedDocument.credible
    ? `${formType}${amendmentPhrase} late filing notice for ${subject}${
        periodOfReport ? ` for period ended ${periodOfReport}` : ""
      }; delayed report is ${reportKind}; ${significantChangePhrase}.`
    : `No credible Form 12b-25 body was located for ${input.formType || "NT filing"}.`;

  return {
    parserVersion: NT_PARSER_VERSION,
    parserGroup: NT_PARSER_GROUP,
    formType,
    accessionNumber: input.accessionNumber ?? null,
    isSupported: selectedDocument.credible,
    summary,
    facts: {
      companyName: company,
      ticker: input.ticker ?? null,
      exchange: input.exchange ?? null,
      sourceFormType: input.formType,
      bodyFormType,
      submissionBodyFormMismatch,
      targetReportCheckboxGroup,
      checkedReports,
      delayedReport,
      periodOfReport,
      periodOfReportEvidence: input.periodOfReport ? null : period.evidence,
      filedAt: input.filedAt ?? null,
      extensionDays,
      isAmendment,
      amendmentPartialBody,
      amendmentNumber,
      amendmentPurpose,
      originalAccessionNumber,
      isTransitionReport,
      transitionReportType,
      transitionPeriodEnded,
      transitionPeriodEndedEvidence: transitionPeriod.evidence,
      partIi,
      partIv,
      unableWithoutUnreasonableEffort,
      anticipatedWithinExtension,
      accountantStatementAttached,
      accountantStatementText,
      significantChangeExpected,
      significantChangeDescription,
      otherPeriodicReportsFiled,
      noRelianceOrRestatementDisclosed,
      lateFilingReason,
      partIiiNarrativeFlags,
      portionOnly,
      electronicFilingDifficulty,
      sourceTextFlags,
      rawDataQuality,
      sourceExcerpts,
    },
    signals: [],
    calendarItems,
    warnings: [
      ...selectedDocument.warnings,
      ...buildWarnings(
        anticipatedWithinExtension,
        significantChangeExpected,
        lateFilingReason,
        {
          isAmendment,
          amendmentPartialBody,
          amendmentPurpose,
          isTransitionReport,
          transitionPeriodEnded,
          checkedReports,
          transitionReportType,
          targetReportCheckboxGroup,
          submissionBodyFormMismatch,
          partIv,
          electronicFilingDifficulty,
        },
      ),
    ],
    raw: {
      inputFormType: input.formType,
      textExcerpt: clip(normalizedText, 1200),
      selectedDocument: {
        source: selectedDocument.source,
        type: selectedDocument.type,
        sequence: selectedDocument.sequence,
        filename: selectedDocument.filename,
        description: selectedDocument.description,
        confidence: selectedDocument.confidence,
        reason: selectedDocument.reason,
      },
      documentInventory: selectedDocument.inventory,
      sectionSegments: sections,
      cleanedSourceBlocks: buildNtCleanedSourceBlocks(sections, accountantStatementText, normalizedText),
    },
  };
}

function buildNtCleanedSourceBlocks(
  sections: NtSectionSegments,
  accountantStatementText: string | null,
  normalizedText: string,
): NonNullable<NtParserOutput["raw"]["cleanedSourceBlocks"]> {
  const blocks: NonNullable<NtParserOutput["raw"]["cleanedSourceBlocks"]> = [];
  const add = (blockType: string, label: string, text: string | null) => {
    const normalized = normalizeWhitespace(text ?? "");
    if (!normalized) return;
    blocks.push({
      block_type: blockType,
      label,
      source: "Form 12b-25",
      text: clip(normalized, 5_000),
    });
  };

  add("nt_filing_header", "Filing header and registrant", sections.topBlock);
  add("nt_part_i", "Part I - Registrant information", sections.partI);
  add("nt_part_ii", "Part II - Rule 12b-25 extension statements", sections.partII);
  add("nt_part_iii", "Part III - Narrative", sections.partIII);
  add("nt_part_iv", "Part IV - Other information", sections.partIV);
  add("nt_accountant_statement", "Accountant statement", accountantStatementText);

  if (!blocks.some((block) => block.block_type === "nt_part_iii")) {
    add("nt_filing_body", "Form 12b-25 body", normalizedText);
  }
  return blocks;
}

function selectNtFilingDocument(input: NtFilingInput): NtSelectedDocument {
  const candidates = buildDocumentCandidates(input);
  const inventory = candidates.map((candidate) => ({
    source: candidate.source,
    type: candidate.type,
    sequence: candidate.sequence,
    filename: candidate.filename,
    description: candidate.description,
    isPrimary: candidate.isPrimary,
    primaryCandidate: !candidate.excludedReason,
    textCharCount: candidate.text.length,
    excludedReason: candidate.excludedReason,
  }));
  const warnings: string[] = [];
  const submissionType = normalizeNtFormForSelection(input.formType);
  const primaryCandidates = candidates.filter((candidate) => !candidate.excludedReason);

  const metadataPrimary = primaryCandidates.find((candidate) => candidate.isPrimary && candidate.text.trim());
  if (metadataPrimary) {
    const scored = scoreDocumentCandidate(metadataPrimary);
    if (scored.credible) {
      return makeSelectedDocument(metadataPrimary, scored, inventory, warnings);
    }
    warnings.push("Metadata primary document did not contain a credible Form 12b-25 body; falling back to other body candidates.");
  }

  const matchingType = primaryCandidates.find(
    (candidate) => normalizeNtFormForSelection(candidate.type) === submissionType && candidate.text.trim(),
  );
  if (matchingType) {
    const scored = scoreDocumentCandidate(matchingType);
    if (scored.credible) {
      return makeSelectedDocument(matchingType, scored, inventory, warnings);
    }
    warnings.push("NT typed document block did not contain a credible Form 12b-25 body; falling back to text anchors.");
  }

  const formAnchor = primaryCandidates
    .map((candidate) => ({ candidate, scored: scoreDocumentCandidate(candidate) }))
    .find((item) => item.scored.anchor === "form_12b_25");
  if (formAnchor) {
    return makeSelectedDocument(formAnchor.candidate, formAnchor.scored, inventory, warnings);
  }

  const sectionAnchor = primaryCandidates
    .map((candidate) => ({ candidate, scored: scoreDocumentCandidate(candidate) }))
    .find((item) => item.scored.anchor === "part_iii_part_iv");
  if (sectionAnchor) {
    return makeSelectedDocument(sectionAnchor.candidate, sectionAnchor.scored, inventory, warnings);
  }

  const fallback = primaryCandidates[0] || candidates[0] || {
    source: "empty_input",
    type: input.formType || null,
    sequence: null,
    filename: null,
    description: null,
    text: input.filingText || "",
    isPrimary: false,
    excludedReason: null,
  };
  const scored = {
    credible: false,
    confidence: "low" as const,
    reason: "No credible Form 12b-25 body found in primary text, SGML documents, or supplied document inventory.",
    anchor: "none" as const,
  };
  return makeSelectedDocument(fallback, scored, inventory, [
    ...warnings,
    "No credible Form 12b-25 body found; parser output is low confidence and should not infer missing facts.",
  ]);
}

function buildDocumentCandidates(input: NtFilingInput): NtDocumentCandidate[] {
  const candidates: NtDocumentCandidate[] = [];

  if (input.primaryDocumentText) {
    candidates.push(makeCandidate({
      source: "metadata_primary_document",
      type: input.formType,
      text: input.primaryDocumentText,
      isPrimary: true,
    }));
  }

  for (const document of normalizeInputDocuments(input.documents, "metadata_document")) {
    candidates.push(document);
  }

  const sgmlDocuments = splitSgmlDocuments(input.filingText);
  if (sgmlDocuments.length) {
    candidates.push(...sgmlDocuments);
  } else if (input.filingText) {
    candidates.push(makeCandidate({
      source: "filing_text",
      type: input.formType,
      text: input.filingText,
      isPrimary: false,
    }));
  }

  for (const attachment of normalizeInputDocuments(input.attachments, "attachment")) {
    candidates.push(attachment);
  }

  const rawPayload = toRecord(input.rawPayload);
  candidates.push(...normalizeInputDocuments(recordArray(rawPayload?.documents) as NtFilingDocumentInput[], "raw_payload_document"));
  candidates.push(...normalizeInputDocuments(recordArray(rawPayload?.attachment_texts) as NtFilingDocumentInput[], "raw_payload_attachment"));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      candidate.source,
      candidate.type,
      candidate.sequence,
      candidate.filename,
      candidate.description,
      candidate.text.slice(0, 240),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(candidate.text.trim());
  });
}

function normalizeInputDocuments(
  documents: NtFilingDocumentInput[] | undefined,
  source: string,
): NtDocumentCandidate[] {
  if (!Array.isArray(documents)) return [];
  return documents
    .map((document, index) => makeCandidate({
      source,
      type: nullableString(document.type),
      sequence: nullableString(document.sequence) || String(index + 1),
      filename: nullableString(document.filename) || nullableString(document.document),
      description: nullableString(document.description),
      text: nullableString(document.text) || nullableString(document.html) || "",
      isPrimary: Boolean(document.isPrimary),
    }))
    .filter((document) => document.text.trim());
}

function makeCandidate(args: {
  source: string;
  type?: string | null;
  sequence?: string | null;
  filename?: string | null;
  description?: string | null;
  text: string;
  isPrimary?: boolean;
}): NtDocumentCandidate {
  const label = `${args.type || ""} ${args.filename || ""} ${args.description || ""}`;
  return {
    source: args.source,
    type: nullableString(args.type),
    sequence: nullableString(args.sequence),
    filename: nullableString(args.filename),
    description: nullableString(args.description),
    text: args.text,
    isPrimary: Boolean(args.isPrimary),
    excludedReason: primaryCandidateExclusionReason(label),
  };
}

function splitSgmlDocuments(value: string): NtDocumentCandidate[] {
  const documents: NtDocumentCandidate[] = [];
  if (!/<DOCUMENT\b/i.test(value)) return documents;

  for (const match of value.matchAll(/<DOCUMENT\b[^>]*>([\s\S]*?)<\/DOCUMENT>/gi)) {
    const block = match[1] || "";
    const type = extractSgmlHeader(block, "TYPE");
    const sequence = extractSgmlHeader(block, "SEQUENCE");
    const filename = extractSgmlHeader(block, "FILENAME");
    const description = extractSgmlHeader(block, "DESCRIPTION");
    const text = extractSgmlText(block);
    documents.push(makeCandidate({
      source: "sgml_document",
      type,
      sequence,
      filename,
      description,
      text,
      isPrimary: false,
    }));
  }

  return documents;
}

function extractSgmlHeader(block: string, name: string): string | null {
  const pattern = new RegExp(`<${name}>\\s*([^\\r\\n<]+)`, "i");
  return nullableString(pattern.exec(block)?.[1]);
}

function extractSgmlText(block: string): string {
  const text = /<TEXT\b[^>]*>([\s\S]*?)<\/TEXT>/i.exec(block)?.[1];
  if (text !== undefined) return text;
  return block.replace(/<(?:TYPE|SEQUENCE|FILENAME|DESCRIPTION)>[^\r\n<]*/gi, " ");
}

function primaryCandidateExclusionReason(label: string): string | null {
  if (/\b(?:XML|GRAPHIC|ZIP|JSON|XBRL|EXCEL|PDF)\b/i.test(label)) return "machine_readable_or_binary_document";
  if (/\.(?:xml|xsd|jpg|jpeg|gif|png|zip|pdf|xlsx?)(?:$|\s|\?)/i.test(label)) return "machine_readable_or_binary_document";
  if (/\bEX(?:HIBIT)?[-\s]?\d|\bEX-|\bEXHIBIT\b/i.test(label)) return "exhibit_document";
  return null;
}

function scoreDocumentCandidate(candidate: NtDocumentCandidate): {
  credible: boolean;
  confidence: NtConfidence;
  reason: string;
  anchor: "form_12b_25" | "part_iii_part_iv" | "none";
} {
  const normalizedText = normalizeFilingText(candidate.text);
  const hasFormAnchor = /\bFORM\s+12b-25(?:\/A)?\b/i.test(normalizedText) ||
    /\bNOTIFICATION\s+OF\s+LATE\s+FILING\b/i.test(normalizedText);
  const hasPartIII = hasPartIIIAnchor(normalizedText);
  const hasPartIV = hasPartIVAnchor(normalizedText);

  if (hasFormAnchor && hasPartIII && hasPartIV) {
    return {
      credible: true,
      confidence: "high",
      reason: "Document contains Form 12b-25 and Part III/Part IV anchors.",
      anchor: "form_12b_25",
    };
  }
  if (hasFormAnchor) {
    return {
      credible: true,
      confidence: "medium",
      reason: "Document contains Form 12b-25 or Notification of Late Filing anchor.",
      anchor: "form_12b_25",
    };
  }
  if (hasPartIII && hasPartIV) {
    return {
      credible: true,
      confidence: "low",
      reason: "Document lacks the Form 12b-25 title but contains Part III and Part IV anchors.",
      anchor: "part_iii_part_iv",
    };
  }
  return {
    credible: false,
    confidence: "low",
    reason: "Document does not contain enough Form 12b-25 anchors.",
    anchor: "none",
  };
}

function makeSelectedDocument(
  candidate: NtDocumentCandidate,
  scored: ReturnType<typeof scoreDocumentCandidate>,
  inventory: NtSelectedDocument["inventory"],
  warnings: string[],
): NtSelectedDocument {
  return {
    ...candidate,
    normalizedText: normalizeFilingText(candidate.text),
    confidence: scored.confidence,
    reason: scored.reason,
    credible: scored.credible,
    warnings,
    inventory,
  };
}

function segmentForm12b25Sections(normalizedText: string): NtSectionSegments {
  const warnings: string[] = [];
  const headingBoundaries = findHeadingBoundaries(normalizedText);
  const boundaries = mergeBoundaries(headingBoundaries, findFallbackBoundaries(normalizedText, headingBoundaries, warnings));
  const byName = new Map(boundaries.map((boundary) => [boundary.name, boundary]));
  const ordered = [...boundaries].sort((a, b) => a.start - b.start);
  const signatureStart = findSignatureTailStart(normalizedText, byName.get("partIV")?.start ?? 0);

  for (const section of ["partI", "partII", "partIII", "partIV"] as const) {
    if (!byName.has(section)) warnings.push(`Missing ${formatSectionName(section)} section boundary.`);
  }

  const partI = sectionText("partI");
  const partII = sectionText("partII");
  const partIII = sectionText("partIII");
  const partIV = sectionText("partIV", signatureStart);
  const firstSectionStart = ordered[0]?.start ?? normalizedText.length;
  const topBlock = normalizedText.slice(0, firstSectionStart).trim() || null;
  const signatureTail = signatureStart !== null ? normalizedText.slice(signatureStart).trim() || null : null;
  const confidence = boundaries.some((boundary) => boundary.confidence === "low")
    ? "low"
    : boundaries.some((boundary) => boundary.confidence === "medium")
      ? "medium"
      : "high";

  return {
    topBlock: clipNullable(topBlock, 1200),
    partI: clipNullable(partI, 1600),
    partII: clipNullable(partII, 2200),
    partIII: clipNullable(partIII, 2600),
    partIV: clipNullable(partIV, 2600),
    signatureTail: clipNullable(signatureTail, 1200),
    confidence,
    warnings,
  };

  function sectionText(name: NtSectionName, forcedEnd: number | null = null): string | null {
    const boundary = byName.get(name);
    if (!boundary) return null;
    const next = ordered.find((candidate) => candidate.start > boundary.start);
    const end = forcedEnd !== null
      ? Math.min(forcedEnd, next?.start ?? normalizedText.length)
      : next?.start ?? normalizedText.length;
    return normalizedText.slice(boundary.labelEnd, end).trim() || null;
  }
}

function findHeadingBoundaries(text: string): NtSectionBoundary[] {
  const boundaries: NtSectionBoundary[] = [];
  const headingPattern =
    /\bPART\s*(IV|III|II|I)\s*\.?\s*(?:(?:[-–—:]\s*)?(REGISTRANT\s+INFORMATION|RULE\s+12b-25(?:\s*\([^)]+\))?(?:\s*(?:AND|&)\s*\([^)]+\))?|NARRATIVE|OTHER\s+INFORMATION))?/gi;

  for (const match of text.matchAll(headingPattern)) {
    const afterHeading = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 24);
    if (/^\s*of\b/i.test(afterHeading)) continue;
    const roman = (match[1] || "").toUpperCase();
    const name = roman === "I" ? "partI" : roman === "II" ? "partII" : roman === "III" ? "partIII" : "partIV";
    boundaries.push({
      name,
      start: match.index ?? 0,
      labelEnd: (match.index ?? 0) + match[0].length,
      confidence: "high",
      anchor: match[0].trim(),
    });
  }

  return dedupeBoundaries(boundaries);
}

function findFallbackBoundaries(
  text: string,
  existing: NtSectionBoundary[],
  warnings: string[],
): NtSectionBoundary[] {
  const boundaries: NtSectionBoundary[] = [];
  const add = (name: NtSectionName, pattern: RegExp, confidence: NtConfidence) => {
    if (existing.some((boundary) => boundary.name === name)) return;
    const match = pattern.exec(text);
    if (!match?.[0] && match?.index !== 0) return;
    boundaries.push({
      name,
      start: match.index ?? 0,
      labelEnd: (match.index ?? 0) + match[0].length,
      confidence,
      anchor: match[0],
    });
    warnings.push(`Used fallback anchor for ${formatSectionName(name)} segmentation.`);
  };

  add("partII", /\bRULE\s+12b-25\b|\bsubject\s+report\s+could\s+not\s+be\s+filed\s+without\s+unreasonable\s+effort\s+or\s+expense\b/i, "medium");
  add("partIII", /\bState\s+below\s+in\s+reasonable\s+detail\s+why\b|\bcould\s+not\s+be\s+filed\s+within\s+the\s+prescribed\s+time\s+period\b/i, "medium");
  add("partIV", /\bOTHER\s+INFORMATION\b|\bName\s+and\s+telephone\s+number\s+of\s+person\s+to\s+contact\b|\bHave\s+all\s+other\s+periodic\s+reports\s+required\b|\bIs\s+it\s+anticipated\s+that\s+any\s+significant\s+change\b/i, "medium");

  return boundaries;
}

function mergeBoundaries(primary: NtSectionBoundary[], fallback: NtSectionBoundary[]): NtSectionBoundary[] {
  return dedupeBoundaries([...primary, ...fallback]).sort((a, b) => a.start - b.start);
}

function dedupeBoundaries(boundaries: NtSectionBoundary[]): NtSectionBoundary[] {
  const byName = new Map<NtSectionName, NtSectionBoundary>();
  for (const boundary of boundaries.sort((a, b) => a.start - b.start)) {
    if (!byName.has(boundary.name)) byName.set(boundary.name, boundary);
  }
  return [...byName.values()];
}

function findSignatureTailStart(text: string, startAt: number): number | null {
  const tail = text.slice(startAt);
  const match = /(?:^|\n)\s*SIGNATURES?\b|\bPursuant\s+to\s+the\s+requirements\s+of\s+the\s+Securities\s+Exchange\s+Act\b/i.exec(tail);
  return match?.index === undefined ? null : startAt + match.index;
}

function hasPartIIIAnchor(text: string) {
  return /\bPART\s*III\b|\bState\s+below\s+in\s+reasonable\s+detail\s+why\b|\bcould\s+not\s+be\s+filed\s+within\s+the\s+prescribed\s+time\s+period\b/i.test(text);
}

function hasPartIVAnchor(text: string) {
  return /\bPART\s*IV\b|\bOTHER\s+INFORMATION\b|\bName\s+and\s+telephone\s+number\s+of\s+person\s+to\s+contact\b|\bHave\s+all\s+other\s+periodic\s+reports\s+required\b|\bIs\s+it\s+anticipated\s+that\s+any\s+significant\s+change\b/i.test(text);
}

function formatSectionName(name: NtSectionName) {
  return name.replace(/^part/, "Part ");
}

function parseTargetReportCheckboxGroup(
  submissionFormType: string,
  normalizedText: string,
  sections: NtSectionSegments,
): NtTargetReportCheckboxGroup {
  const searchText = [
    sections.topBlock,
    sections.partI,
    normalizedText.slice(0, 1800),
  ]
    .filter(Boolean)
    .join("\n");
  const evidence: string[] = [];
  const checkedReports: Array<"10-K" | "10-Q" | "20-F"> = [];
  const checkedTransitionReports: Array<"10-K" | "10-Q" | "20-F"> = [];
  const checkedConfidences: NtConfidence[] = [];

  for (const label of TARGET_REPORT_LABELS) {
    const resolution = resolveCheckboxNearLabel(searchText, label.pattern, label.label, {
      competingLabels: TARGET_REPORT_LABELS.map((item) => item.pattern),
      maxDistance: 48,
    });
    if (resolution.checked === true) {
      evidence.push(resolution.evidence || `${resolution.token || "checked"} ${label.label}`);
      checkedConfidences.push(resolution.confidence);
      if (label.transition) {
        checkedTransitionReports.push(label.report);
      } else {
        checkedReports.push(label.report);
      }
    }
  }

  const checkedCount = checkedReports.length + checkedTransitionReports.length;
  const ambiguous = checkedCount > 1;
  const selectedReport = !ambiguous && checkedReports.length === 1 ? checkedReports[0] : null;
  const selectedTransitionReport =
    !ambiguous && checkedTransitionReports.length === 1 ? checkedTransitionReports[0] : null;
  const fallbackReport = submissionReportFromFormType(submissionFormType);

  return {
    selectedReport,
    selectedTransitionReport,
    checkedReports,
    checkedTransitionReports,
    ambiguous,
    evidence,
    confidence: checkedCount === 1
      ? checkedConfidences[0] ?? "high"
      : checkedCount > 1
        ? "low"
        : fallbackReport
          ? "medium"
          : "low",
  };
}

function resolveCheckboxNearLabel(
  text: string,
  labelPattern: RegExp,
  label: string,
  options: {
    competingLabels?: RegExp[];
    maxDistance?: number;
  } = {},
): NtCheckboxResolution {
  const maxDistance = options.maxDistance ?? 64;
  const labelMatch = execWithIndex(text, labelPattern);
  if (!labelMatch) {
    return {
      checked: null,
      token: null,
      label,
      evidence: null,
      confidence: "low",
      ambiguous: false,
    };
  }

  const labelStart = labelMatch.index;
  const labelEnd = labelStart + labelMatch.text.length;
  const lineStart = Math.max(0, text.lastIndexOf("\n", labelStart) + 1);
  const nextNewline = text.indexOf("\n", labelEnd);
  const lineEnd = nextNewline >= 0 ? nextNewline : text.length;
  const localStart = Math.max(lineStart, labelStart - maxDistance);
  const localEnd = Math.min(lineEnd, labelEnd + maxDistance);
  const local = text.slice(localStart, localEnd);
  const localLabelStart = labelStart - localStart;
  const localLabelEnd = labelEnd - localStart;
  const tokens = [
    ...findCheckboxTokens(local, CHECKED_EXPLICIT_TOKEN_PATTERN, true, false),
    ...findCheckboxTokens(local, UNCHECKED_EXPLICIT_TOKEN_PATTERN, false, false),
    ...findCheckboxTokens(local, RAW_X_TOKEN_PATTERN, true, true),
  ]
    .filter((token) =>
      tokenIsLocalToLabel(
        local,
        token.index,
        token.token.length,
        token.rawX,
        localLabelStart,
        localLabelEnd,
        maxDistance,
        options.competingLabels || [],
      ),
    )
    .map((token) => ({
      ...token,
      distance: checkboxTokenDistance(token.index, token.token.length, localLabelStart, localLabelEnd),
    }))
    .sort((a, b) => a.distance - b.distance);

  if (!tokens.length) {
    return {
      checked: null,
      token: null,
      label,
      evidence: clip(local, 240),
      confidence: "low",
      ambiguous: false,
    };
  }

  const nearest = tokens[0];
  const tiedOpposite = tokens.some(
    (token) => token !== nearest && token.distance === nearest.distance && token.checked !== nearest.checked,
  );

  return {
    checked: tiedOpposite ? null : nearest.checked,
    token: nearest.token,
    label,
    evidence: clip(local, 240),
    confidence: nearest.rawX ? "medium" : "high",
    ambiguous: tiedOpposite,
  };
}

function execWithIndex(text: string, pattern: RegExp): { index: number; text: string } | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const copy = new RegExp(pattern.source, flags);
  const match = copy.exec(text);
  if (!match) return null;
  return {
    index: match.index,
    text: match[0],
  };
}

function findCheckboxTokens(
  local: string,
  pattern: RegExp,
  checked: boolean,
  rawX: boolean,
) {
  const tokens: Array<{ token: string; index: number; checked: boolean; rawX: boolean; distance: number }> = [];
  const copy = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (const match of local.matchAll(copy)) {
    if (match.index === undefined) continue;
    tokens.push({
      token: match[0],
      index: match.index,
      checked,
      rawX,
      distance: Number.POSITIVE_INFINITY,
    });
  }
  return tokens;
}

function tokenIsLocalToLabel(
  local: string,
  tokenIndex: number,
  tokenLength: number,
  rawX: boolean,
  labelStart: number,
  labelEnd: number,
  maxDistance: number,
  competingLabels: RegExp[],
) {
  const tokenEnd = tokenIndex + tokenLength;
  const distance = tokenIndex < labelStart ? labelStart - tokenEnd : tokenIndex - labelEnd;
  if (distance < 0 || distance > maxDistance) return false;
  if (rawX && tokenIndex > labelEnd) return false;

  const between = tokenIndex < labelStart
    ? local.slice(tokenEnd, labelStart)
    : local.slice(labelEnd, tokenIndex);
  if (competingLabels.some((pattern) => execWithIndex(between, pattern))) return false;
  const afterToken = local.slice(tokenEnd, Math.min(local.length, tokenEnd + maxDistance));
  if (tokenIndex > labelEnd && competingLabels.some((pattern) => execWithIndex(afterToken, pattern))) return false;
  return true;
}

function checkboxTokenDistance(
  tokenIndex: number,
  tokenLength: number,
  labelStart: number,
  labelEnd: number,
) {
  return tokenIndex < labelStart ? labelStart - (tokenIndex + tokenLength) : tokenIndex - labelEnd;
}

function buildBodyFormType(
  targetReportCheckboxGroup: NtTargetReportCheckboxGroup,
  isAmendment: boolean,
): string | null {
  const report = targetReportCheckboxGroup.selectedReport || targetReportCheckboxGroup.selectedTransitionReport;
  return report ? `NT ${report}${isAmendment ? "/A" : ""}` : null;
}

function detectSubmissionBodyFormMismatch(submissionFormType: string, bodyFormType: string | null) {
  const submission = normalizeNtBaseForm(submissionFormType);
  const body = normalizeNtBaseForm(bodyFormType);
  return Boolean(submission && body && submission !== body);
}

function submissionReportFromFormType(value: string): "10-K" | "10-Q" | "20-F" | null {
  return /\bNT\s*10-K\b/i.test(value)
    ? "10-K"
    : /\bNT\s*10-Q\b/i.test(value)
      ? "10-Q"
      : /\bNT\s*20-F\b/i.test(value)
        ? "20-F"
        : null;
}

function normalizeNtBaseForm(value: string | null | undefined): string | null {
  const match = /\bNT\s*(10-K|10-Q|20-F)(?:\s*\/\s*A)?\b/i.exec(value || "");
  return match?.[1] ? `NT ${match[1].toUpperCase()}` : null;
}

function isAmendmentPartialBody(sections: NtSectionSegments) {
  return !sections.partIII || !sections.partIV || sections.confidence === "low";
}

function detectDelayedReport(
  rawFormType: string,
  targetReportCheckboxGroup: NtTargetReportCheckboxGroup,
): "10-K" | "10-Q" | "20-F" {
  if (!targetReportCheckboxGroup.ambiguous) {
    if (targetReportCheckboxGroup.selectedReport) return targetReportCheckboxGroup.selectedReport;
    if (targetReportCheckboxGroup.selectedTransitionReport) return targetReportCheckboxGroup.selectedTransitionReport;
  }

  const rawMatch = /\bNT\s*(10-K|10-Q|20-F)(?:\/A)?\b/i.exec(rawFormType);
  if (rawMatch?.[1]) return rawMatch[1].toUpperCase() as "10-K" | "10-Q" | "20-F";

  return "10-Q";
}

function detectAmendment(rawFormType: string, normalizedText: string): boolean {
  return (
    /\bNT\s*(?:10-K|10-Q|20-F)\/A\b/i.test(rawFormType) ||
    /\bFORM\s+12b-25\/A\b/i.test(normalizedText) ||
    /\bAmendment\s+(?:No\.?|#)\s*\d+/i.test(normalizedText)
  );
}

function extractAmendmentNumber(normalizedText: string): string | null {
  const match = /\bAmendment\s+(?:No\.?|#)\s*([0-9]+)/i.exec(normalizedText);
  return match?.[1] ?? null;
}

function extractAmendmentPurpose(normalizedText: string): string | null {
  const note = extractSection(
    normalizedText,
    /EXPLANATORY\s+NOTE\b/i,
    /PART\s+I\b/i,
  );
  if (note) return cleanSectionHeading(note, "EXPLANATORY NOTE", []);

  const amendmentMatch =
    /\bThis\s+Amendment\b[^.]{0,260}\.(?:\s+[^.]{0,260}\.){0,2}/i.exec(
      normalizedText,
    );
  return amendmentMatch ? normalizeWhitespace(amendmentMatch[0]) : null;
}

function extractOriginalAccessionNumber(normalizedText: string): string | null {
  const match = /\baccession\s+number\s+([0-9]{10}-[0-9]{2}-[0-9]{6})\b/i.exec(
    normalizedText,
  );
  return match?.[1] ?? null;
}

function detectCheckedReports(
  rawFormType: string,
  normalizedText: string,
): Array<"10-K" | "10-Q" | "20-F"> {
  const source = `${rawFormType} ${normalizedText}`;
  const reports: Array<"10-K" | "10-Q" | "20-F"> = [];

  for (const report of ["10-K", "10-Q", "20-F"] as const) {
    const checkedBefore = checkedBeforePattern(`Form\\s*${escapeRegex(report)}`).test(source);
    const checkedAfter = new RegExp(
      `Form\\s*${escapeRegex(report)}\\s*${CHECKED_MARK}`,
      "i",
    ).test(source);

    if (checkedBefore || checkedAfter) {
      reports.push(report);
    }
  }

  return reports;
}

function detectTransitionReportType(
  normalizedText: string,
): "10-K" | "10-Q" | "20-F" | null {
  for (const report of ["10-K", "10-Q", "20-F"] as const) {
    if (
      checkedBeforePattern(
        `Transition\\s+Report\\s+on\\s+Form\\s*${escapeRegex(report)}`,
      ).test(normalizedText)
    ) {
      return report;
    }
  }

  return null;
}

function extractTransitionPeriodEnded(
  normalizedText: string,
  sections: NtSectionSegments,
): { value: string | null; evidence: string | null; ambiguous: boolean } {
  const searchSources = [
    sections.topBlock,
    sections.partI,
    normalizedText.slice(0, 2200),
  ].filter(Boolean) as string[];

  for (const source of searchSources) {
    const anchored = extractDateNearAnchor(source, /\bFor\s+the\s+Transition\s+Period\s+Ended\b/i);
    if (anchored.value || anchored.ambiguous) return anchored;
  }

  return { value: null, evidence: null, ambiguous: false };
}

function extractLateFilingReason(
  normalizedText: string,
  sections: NtSectionSegments,
): string | null {
  const partIII =
    sections.partIII ||
    extractLastSection(
      normalizedText,
      /PART\s+III\b/i,
      /PART\s+IV\b/i,
    );
  if (!partIII) return null;

  return cleanSectionHeading(partIII, "PART III", [
    "NARRATIVE",
    "Narrative",
    "State below in reasonable detail why Forms 10-K, 20-F, 11-K, 10-Q, N-SAR, N-CSR, or the transition report portion thereof could not be filed within the prescribed time period.",
  ]);
}

function extractSignificantChangeDescription(
  normalizedText: string,
): string | null {
  const marker =
    /significant\s+changes?\s+in\s+(?:the\s+)?results\s+of\s+operations/i;
  const match = marker.exec(normalizedText);
  if (!match) return null;

  const excerpt = cutAtFirstPattern(
    normalizedText.slice(match.index, match.index + 900),
    [/\bSIGNATURES?\b/i, /\bDate:\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\b/i],
  );
  return cleanTrailingCheckboxNoise(clip(excerpt, 650));
}

function detectSignificantChangeExpected(
  normalizedText: string,
): boolean | null {
  const match =
    /significant\s+changes?\s+in\s+(?:the\s+)?results\s+of\s+operations/i.exec(
      normalizedText,
    );
  if (!match) return null;

  const excerpt = normalizedText.slice(match.index, match.index + 500);
  const yesChecked = detectYesNoAnswer(excerpt, "Yes");
  const noChecked = detectYesNoAnswer(excerpt, "No");

  if (yesChecked && !noChecked) return true;
  if (noChecked && !yesChecked) return false;
  if (/significant\s+changes?[^?]+\?\s*Yes\./i.test(excerpt)) return true;
  if (/significant\s+changes?[^?]+\?\s*No\./i.test(excerpt)) return false;
  if (/\bnot\s+anticipat(?:e|ed|es|ing)\b/i.test(excerpt)) return false;
  if (/\banticipat(?:e|ed|es|ing)\b/i.test(excerpt)) return true;
  return null;
}

function detectYesNoAnswer(excerpt: string, answer: "Yes" | "No"): boolean {
  const markBeforeYesNo = new RegExp(
    `${CHECKED_MARK}\\s*Yes\\s*${UNCHECKED_MARK}\\s*No`,
    "i",
  );
  const markBeforeNoYes = new RegExp(
    `${UNCHECKED_MARK}\\s*Yes\\s*${CHECKED_MARK}\\s*No`,
    "i",
  );
  const markAfterYesNo = new RegExp(
    `\\bYes\\s*${CHECKED_MARK}\\s*No\\s*${UNCHECKED_MARK}`,
    "i",
  );
  const markAfterNoYes = new RegExp(
    `\\bYes\\s*${UNCHECKED_MARK}\\s*No\\s*${CHECKED_MARK}`,
    "i",
  );

  if (markBeforeYesNo.test(excerpt) || markAfterYesNo.test(excerpt)) {
    return answer === "Yes";
  }
  if (markBeforeNoYes.test(excerpt) || markAfterNoYes.test(excerpt)) {
    return answer === "No";
  }

  return new RegExp(`${CHECKED_MARK}\\s*${answer}\\b`, "i").test(excerpt);
}

function detectOtherPeriodicReportsFiled(normalizedText: string): boolean | null {
  const match =
    /Have\s+all\s+other\s+periodic\s+reports[^?]+\?(.{0,160})/i.exec(
      normalizedText,
    );
  if (!match?.[1]) return null;
  const excerpt = match[1];
  const yesChecked = detectYesNoAnswer(excerpt, "Yes");
  const noChecked = detectYesNoAnswer(excerpt, "No");

  if (yesChecked && !noChecked) return true;
  if (noChecked && !yesChecked) return false;
  if (/^\s*Yes\b\.?/i.test(excerpt)) return true;
  if (/^\s*No\b\.?/i.test(excerpt)) return false;
  return null;
}

function parsePartIvFacts(
  normalizedText: string,
  sections: NtSectionSegments,
): NtPartIvFacts {
  const partIv = getPartIvText(normalizedText, sections);

  return {
    contact: extractPartIvContact(partIv.text),
    otherPeriodicReports: parsePartIvQ2(partIv.text),
    significantChange: parsePartIvQ3(partIv.text),
  };
}

function getPartIvText(
  normalizedText: string,
  sections: NtSectionSegments,
): { text: string | null; fromFallback: boolean } {
  if (sections.partIV) return { text: sections.partIV, fromFallback: false };

  const anchor = findFirstAnchor(normalizedText, [
    /\bPART\s*IV\b/i,
    /\bOTHER\s+INFORMATION\b/i,
    /\bName\s+and\s+telephone\s+number\s+of\s+person\s+to\s+contact\b/i,
    /\bHave\s+all\s+other\s+periodic\s+reports\s+required\b/i,
    /\bIs\s+it\s+anticipated\s+that\s+any\s+significant\s+change\b/i,
  ]);
  if (!anchor) return { text: null, fromFallback: true };

  return {
    text: cutAtFirstPattern(normalizedText.slice(anchor.index), [
      /\bSIGNATURES?\b/i,
      /\bPursuant\s+to\s+the\s+requirements\s+of\s+the\s+Securities\s+Exchange\s+Act\b/i,
    ]),
    fromFallback: true,
  };
}

function extractPartIvContact(partIvText: string | null): NtPartIvFacts["contact"] {
  const empty = {
    name: null,
    areaCode: null,
    telephoneNumber: null,
    rawContactLine: null,
    confidence: "low" as const,
  };
  if (!partIvText) return empty;

  const anchor = execWithIndex(partIvText, /\bName\s+and\s+telephone\s+number\s+of\s+person\s+to\s+contact\b/i);
  if (!anchor) return empty;

  const afterAnchor = partIvText.slice(anchor.index + anchor.text.length);
  const q2Anchor = findPartIvQ2Anchor(afterAnchor);
  const local = (q2Anchor ? afterAnchor.slice(0, q2Anchor.index) : afterAnchor.slice(0, 260)).trim();
  const phone = findContactPhone(local);
  if (!phone) return { ...empty, rawContactLine: clip(local, 220) || null };

  const beforePhone = local.slice(0, phone.index);
  const name = cleanContactName(beforePhone);
  const rawContactLine = cleanContactLine(local.slice(0, phone.index + phone.raw.length));

  return {
    name,
    areaCode: phone.areaCode,
    telephoneNumber: phone.telephoneNumber,
    rawContactLine: rawContactLine || clip(local, 220),
    confidence: name ? "high" : "medium",
  };
}

function findContactPhone(text: string): {
  raw: string;
  index: number;
  areaCode: string;
  telephoneNumber: string;
} | null {
  const phonePattern = /(?:\+?1[\s.-]+)?\(?([2-9]\d{2})\)?[\s.-]*(\d{3})[\s.-]*(\d{4})\b/g;
  for (const match of text.matchAll(phonePattern)) {
    if (match.index === undefined) continue;
    const nearby = text.slice(Math.max(0, match.index - 36), match.index);
    if (/\b(?:CIK|CUSIP|SEC\s+file|file\s+number|accession|OMB|IRS)\b/i.test(nearby)) continue;
    return {
      raw: match[0],
      index: match.index,
      areaCode: match[1],
      telephoneNumber: `${match[2]}-${match[3]}`,
    };
  }
  return null;
}

function cleanContactName(value: string): string | null {
  const cleaned = normalizeWhitespace(
    value
      .replace(/^\s*(?:\(?\s*1\s*\)?[.)]?\s*)?/i, "")
      .replace(/^[:|.,;\-\s]+/, "")
      .replace(/\b(?:area\s+code|telephone|phone|tel\.?|number|person\s+to\s+contact)\b/gi, " ")
      .replace(/[|:;]+/g, " "),
  );
  if (!cleaned || cleaned.length < 2) return null;
  if (/\d/.test(cleaned)) return null;
  if (/^(?:none|n\/a|not applicable)$/i.test(cleaned)) return null;
  return clip(cleaned, 120);
}

function cleanContactLine(value: string): string | null {
  const cleaned = normalizeWhitespace(
    value
      .replace(/^\s*(?:\(?\s*1\s*\)?[.)]?\s*)?/i, "")
      .replace(/^[:|.,;\-\s]+/, ""),
  );
  return cleaned || null;
}

function parsePartIvQ2(partIvText: string | null): NtPartIvFacts["otherPeriodicReports"] {
  const empty = {
    answer: null,
    ambiguous: false,
    evidence: null,
    explanation: null,
    missingReportHints: [] as string[],
    foundByFallback: false,
  };
  if (!partIvText) return empty;

  const q2Anchor = findPartIvQ2Anchor(partIvText);
  if (!q2Anchor) return empty;

  const afterQ2 = partIvText.slice(q2Anchor.index);
  const q3Anchor = findPartIvQ3Anchor(afterQ2.slice(q2Anchor.text.length));
  const end = q3Anchor ? q2Anchor.text.length + q3Anchor.index : Math.min(afterQ2.length, 900);
  const block = afterQ2.slice(0, end);
  const answer = resolvePartIvYesNo(block, q2Anchor.foundByFallback);
  const explanation = extractQ2MissingReportExplanation(block, answer.answer);

  return {
    answer: answer.answer,
    ambiguous: answer.ambiguous,
    evidence: answer.evidence ?? clip(block, 260),
    explanation,
    missingReportHints: detectMissingReportHints(explanation),
    foundByFallback: q2Anchor.foundByFallback,
  };
}

function parsePartIvQ3(partIvText: string | null): NtPartIvFacts["significantChange"] {
  const empty = {
    answer: null,
    ambiguous: false,
    evidence: null,
    explanation: null,
    quantitativeDisclosurePresent: false,
    foundByFallback: false,
  };
  if (!partIvText) return empty;

  const q3Anchor = findPartIvQ3Anchor(partIvText);
  if (!q3Anchor) return empty;

  const block = cutAtFirstPattern(partIvText.slice(q3Anchor.index), [
    /\bSIGNATURES?\b/i,
    /\bPursuant\s+to\s+the\s+requirements\s+of\s+the\s+Securities\s+Exchange\s+Act\b/i,
    /\bGENERAL\s+INSTRUCTIONS?\b/i,
    /\bINSTRUCTIONS?\b/i,
    /\bDate\s*:\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}\b/i,
    /\bBy\s*:\s*\/s\//i,
  ]);
  const answer = resolvePartIvYesNo(block, q3Anchor.foundByFallback);
  const explanation = extractQ3SignificantChangeExplanation(block, answer.answer);

  return {
    answer: answer.answer,
    ambiguous: answer.ambiguous,
    evidence: answer.evidence ?? clip(block, 280),
    explanation,
    quantitativeDisclosurePresent: hasQuantitativeDisclosure(explanation),
    foundByFallback: q3Anchor.foundByFallback,
  };
}

function findPartIvQ2Anchor(text: string) {
  return findAnchorWithFallback(text, [
    /\bHave\s+all\s+other\s+periodic\s+reports\s+required\b/i,
  ], [
    /\bSection\s+13\s+or\s+15\(d\)\b[^?]{0,180}\bpreceding\s+12\s+months\b/i,
    /\bfor\s+such\s+shorter\s+period\b[^?]{0,180}\brequired\s+to\s+file\b/i,
  ]);
}

function findPartIvQ3Anchor(text: string) {
  return findAnchorWithFallback(text, [
    /\bIs\s+it\s+anticipated\s+that\s+any\s+significant\s+change\s+in\s+results\s+of\s+operations\b/i,
  ], [
    /\bcorresponding\s+period\s+for\s+the\s+last\s+fiscal\s+year\b/i,
    /\bwill\s+be\s+reflected\s+by\s+the\s+earnings\s+statements\b/i,
    /\bto\s+be\s+included\s+in\s+the\s+subject\s+report\b/i,
  ]);
}

function findAnchorWithFallback(
  text: string,
  primaryPatterns: RegExp[],
  fallbackPatterns: RegExp[],
): { index: number; text: string; foundByFallback: boolean } | null {
  const primary = findFirstAnchor(text, primaryPatterns);
  if (primary) return { ...primary, foundByFallback: false };
  const fallback = findFirstAnchor(text, fallbackPatterns);
  return fallback ? { ...fallback, foundByFallback: true } : null;
}

function findFirstAnchor(text: string, patterns: RegExp[]): { index: number; text: string } | null {
  const matches = patterns
    .map((pattern) => execWithIndex(text, pattern))
    .filter((match): match is { index: number; text: string } => Boolean(match))
    .sort((a, b) => a.index - b.index);
  return matches[0] ?? null;
}

function resolvePartIvYesNo(block: string, foundByFallback: boolean): NtPartIvYesNo {
  const beforePattern = new RegExp(
    `(${YES_NO_CHECKBOX_TOKEN})\\s*Yes\\b\\s*[:.]?\\s*(${YES_NO_CHECKBOX_TOKEN})\\s*No\\b`,
    "i",
  );
  const afterPattern = new RegExp(
    `\\bYes\\b\\s*[:.]?\\s*(${YES_NO_CHECKBOX_TOKEN})\\s*\\bNo\\b\\s*[:.]?\\s*(${YES_NO_CHECKBOX_TOKEN})`,
    "i",
  );
  const before = beforePattern.exec(block);
  if (before) {
    return buildPartIvYesNoAnswer(before[1], before[2], block, before.index, before[0].length, foundByFallback);
  }

  const after = afterPattern.exec(block);
  if (after) {
    return buildPartIvYesNoAnswer(after[1], after[2], block, after.index, after[0].length, foundByFallback);
  }

  const plain = /(?:\?|^|\s)(Yes|No)\s*\./i.exec(block);
  if (plain) {
    return {
      answer: /^yes$/i.test(plain[1]),
      ambiguous: false,
      evidence: clip(block.slice(Math.max(0, plain.index - 120), plain.index + plain[0].length + 160), 260),
      confidence: "medium",
      foundByFallback,
    };
  }

  return {
    answer: null,
    ambiguous: false,
    evidence: clip(block, 260),
    confidence: "low",
    foundByFallback,
  };
}

function buildPartIvYesNoAnswer(
  yesToken: string,
  noToken: string,
  block: string,
  matchIndex: number,
  matchLength: number,
  foundByFallback: boolean,
): NtPartIvYesNo {
  const yes = checkboxTokenValue(yesToken);
  const no = checkboxTokenValue(noToken);
  const ambiguous = yes === true && no === true;
  const answer = ambiguous
    ? null
    : yes === true && no === false
      ? true
      : no === true && yes === false
        ? false
        : null;

  return {
    answer,
    ambiguous,
    evidence: clip(block.slice(Math.max(0, matchIndex - 120), matchIndex + matchLength + 180), 280),
    confidence: answer !== null || ambiguous ? "high" : "low",
    foundByFallback,
  };
}

function checkboxTokenValue(token: string): boolean | null {
  const trimmed = token.trim();
  if (/^(?:☒|☑|✓|✔|■|●|\[\s*[xX]\s*\]|[xX])$/.test(trimmed)) return true;
  if (/^(?:☐|□|\[\s*(?:_|\s*)\s*\]|[oO])$/.test(trimmed)) return false;
  return null;
}

function extractQ2MissingReportExplanation(block: string, answer: boolean | null): string | null {
  const instruction =
    /\bIf\s+(?:the\s+)?answer\s+is\s+no\b[^.?:;]*[.?:;]?\s*(?:identify\s+(?:the\s+)?report\(s\)[^.?:;]*[.?:;]?\s*)?/i.exec(block);
  if (!instruction && answer !== false) return null;

  const start = instruction
    ? (instruction.index ?? 0) + instruction[0].length
    : findEndOfYesNoPair(block);
  const explanation = cleanPartIvExplanation(block.slice(start));
  return explanation || null;
}

function extractQ3SignificantChangeExplanation(block: string, answer: boolean | null): string | null {
  const questionEnd = block.indexOf("?");
  const afterQuestion = questionEnd >= 0 ? block.slice(questionEnd + 1) : block;
  const explanation = cleanPartIvExplanation(stripQ3Instruction(stripLeadingYesNoAnswer(afterQuestion)));
  if (explanation) return explanation;
  return answer === true ? null : null;
}

function stripLeadingYesNoAnswer(value: string): string {
  const beforePattern = new RegExp(
    `^\\s*(?:[:?.]\\s*)?${YES_NO_CHECKBOX_TOKEN}\\s*Yes\\b\\s*[:.]?\\s*${YES_NO_CHECKBOX_TOKEN}\\s*No\\b\\.?\\s*`,
    "i",
  );
  const afterPattern = new RegExp(
    `^\\s*(?:[:?.]\\s*)?Yes\\b\\s*[:.]?\\s*${YES_NO_CHECKBOX_TOKEN}\\s*No\\b\\s*[:.]?\\s*${YES_NO_CHECKBOX_TOKEN}\\.?\\s*`,
    "i",
  );
  return value
    .replace(beforePattern, "")
    .replace(afterPattern, "")
    .replace(/^\s*(?:[:?.]\s*)?(?:Yes|No)\s*\.?\s*/i, "");
}

function stripQ3Instruction(value: string): string {
  return value
    .replace(/^If\s+so,\s*attach\s+an\s+explanation\b[^.]*\.?\s*/i, "")
    .replace(/^If\s+so,\s*state\s+the\s+anticipated\s+change\b[^.]*\.?\s*/i, "")
    .replace(/^Attach\s+an\s+explanation\b[^.]*\.?\s*/i, "")
    .replace(/^Explain\s+the\s+anticipated\s+change\b[^.]*\.?\s*/i, "")
    .replace(/^anticipated\s+change\b[^:.;]*[:.;]?\s*/i, "")
    .replace(/^both\s+narratively\s+and\s+quantitatively\b[^.]*\.?\s*/i, "");
}

function findEndOfYesNoPair(block: string): number {
  const beforePattern = new RegExp(
    `${YES_NO_CHECKBOX_TOKEN}\\s*Yes\\b\\s*[:.]?\\s*${YES_NO_CHECKBOX_TOKEN}\\s*No\\b`,
    "i",
  );
  const afterPattern = new RegExp(
    `\\bYes\\b\\s*[:.]?\\s*${YES_NO_CHECKBOX_TOKEN}\\s*\\bNo\\b\\s*[:.]?\\s*${YES_NO_CHECKBOX_TOKEN}`,
    "i",
  );
  const before = beforePattern.exec(block);
  const after = afterPattern.exec(block);
  const match = [before, after]
    .filter((item): item is RegExpExecArray => Boolean(item))
    .sort((a, b) => a.index - b.index)[0];
  return match ? match.index + match[0].length : 0;
}

function cleanPartIvExplanation(value: string): string {
  const cleaned = cutAtFirstPattern(value, [
    /\bSIGNATURES?\b/i,
    /\bPursuant\s+to\s+the\s+requirements\b/i,
    /\bGENERAL\s+INSTRUCTIONS?\b/i,
    /\bINSTRUCTIONS?\b/i,
    /\bDate\s*:\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}\b/i,
    /\bBy\s*:\s*\/s\//i,
  ]);
  return cleanTrailingCheckboxNoise(
    normalizeWhitespace(
      cleaned
        .replace(/^\s*(?:[:;.,-]|\)|\])+/, "")
        .replace(/^\s*(?:N\/A|None)\.?\s*$/i, ""),
    ),
  );
}

function detectMissingReportHints(explanation: string | null): string[] {
  if (!explanation) return [];
  const hints = [
    { label: "10-K", pattern: /\b(?:Form\s*)?10-K\b/i },
    { label: "10-Q", pattern: /\b(?:Form\s*)?10-Q\b/i },
    { label: "20-F", pattern: /\b(?:Form\s*)?20-F\b/i },
    { label: "8-K", pattern: /\b(?:Form\s*)?8-K\b/i },
    { label: "6-K", pattern: /\b(?:Form\s*)?6-K\b/i },
    { label: "annual report", pattern: /\bannual\s+report\b/i },
    { label: "quarterly report", pattern: /\bquarterly\s+report\b/i },
    { label: "transition report", pattern: /\btransition\s+report\b/i },
  ];
  return hints
    .filter((hint) => hint.pattern.test(explanation))
    .map((hint) => hint.label);
}

function hasQuantitativeDisclosure(value: string | null): boolean {
  if (!value) return false;
  const text = stripNonQuantitativeNumbers(value);
  return (
    /\$\s*\(?-?\d[\d,]*(?:\.\d+)?\)?/.test(text) ||
    /\b\d+(?:\.\d+)?\s*%/.test(text) ||
    /\b(?:revenue|sales|net\s+income|net\s+loss|gross\s+margin|operating\s+income|operating\s+loss|EPS|earnings\s+per\s+share|loss\s+per\s+share)\b[^.]{0,90}\$?\(?-?\d/i.test(text) ||
    /\b(?:increased|decreased|increase|decrease|declined|rose|fell)\s+by\b[^.]{0,60}\d/i.test(text) ||
    /\bfrom\s+\$?\(?-?\d[\d,.]*\)?\b[^.]{0,80}\bto\s+\$?\(?-?\d[\d,.]*\)?\b/i.test(text)
  );
}

function stripNonQuantitativeNumbers(value: string): string {
  return value
    .replace(/(?:\+?1[\s.-]+)?\(?[2-9]\d{2}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, " ")
    .replace(/\b[A-Za-z]+\s+\d{1,2},\s+\d{4}\b/g, " ")
    .replace(/\b\d{10}-\d{2}-\d{6}\b/g, " ")
    .replace(/\b(?:CIK|CUSIP|OMB|SEC\s+File\s+Number|File\s+No\.?|Commission\s+File)\b[^.;,\n]{0,40}/gi, " ")
    .replace(/\bRule\s+\d+(?:[a-z])?(?:-\d+)?(?:\([^)]+\))?/gi, " ")
    .replace(/\b(?:Section|Item|Part)\s+\d+[A-Za-z]?(?:\([^)]+\))?/gi, " ")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ");
}

function hasFinancialChangeLanguage(value: string | null): boolean {
  return Boolean(value) &&
    /\b(revenue|sales|net\s+income|net\s+loss|gross\s+margin|EPS|earnings\s+per\s+share|significant\s+change|increased|decreased|declined|increase|decrease)\b/i.test(value || "");
}

function detectAnticipatedWithinExtension(
  normalizedText: string,
  withinExtensionChecked: boolean | null,
): boolean | null {
  if (
    /\bnot\s+(?:expect|expects|anticipate|anticipates)[^.]{0,140}\bwithin\b[^.]{0,80}\bextension\b/i.test(
      normalizedText,
    ) ||
    /\bwill\s+not\s+be\s+filed\b[^.]{0,160}\bextension\b/i.test(normalizedText)
  ) {
    return false;
  }

  if (
    /\b(?:expects?|anticipates?|intends?)\b[^.]{0,180}\bfile\b[^.]{0,120}\b(?:five|5|fifteen|15)\b[^.]{0,80}\b(?:day|calendar day|extension)\b/i.test(
      normalizedText,
    ) ||
    /\b(?:expects?|anticipates?|intends?)\b[^.]{0,180}\bfile\b[^.]{0,120}\bno\s+later\s+than\b[^.]{0,80}\b(?:fifth|fifteenth|5th|15th|five|fifteen)\b/i.test(
      normalizedText,
    ) ||
    /\b(?:expects?|anticipates?|intends?)\b[^.]{0,180}\bfile\b[^.]{0,120}\bwithin\s+the\s+time\s+period\s+prescribed\s+in\s+Rule\s+12b-25\b/i.test(
      normalizedText,
    ) ||
    /\bwill\s+be\s+filed\b[^.]{0,180}\bon\s+or\s+before\b[^.]{0,100}\b(?:fifth|fifteenth|5th|15th)\b/i.test(
      normalizedText,
    )
  ) {
    return true;
  }

  if (withinExtensionChecked === true) return true;
  if (withinExtensionChecked === false) return false;

  return null;
}

function detectPartIiFacts(
  normalizedText: string,
  sections: NtSectionSegments,
): NtParserOutput["facts"]["partIi"] {
  const relief = resolvePartIiReliefCheckbox(normalizedText, sections);
  return {
    rule12b25ReliefChecked: relief.checked,
    rule12b25ReliefEvidence: relief.evidence,
    rule12b25ReliefConfidence: relief.confidence,
    unableWithoutUnreasonableEffortChecked: relief.checked,
    withinExtensionChecked: null,
    accountantStatementChecked: null,
  };
}

function resolvePartIiReliefCheckbox(
  normalizedText: string,
  sections: NtSectionSegments,
): NtCheckboxResolution {
  const labelPattern =
    /\(\s*a\s*\)|\bsubject\s+(?:annual|quarterly|transition)?\s*report\s+could\s+not\s+be\s+filed\b|\bwithout\s+unreasonable\s+effort\s+or\s+expense\b|\bRule\s+12b-25\s*\(\s*b\s*\)|\bRule\s+12b-25\s*\(\s*c\s*\)/i;
  const partIiSources = sections.partII
    ? [sections.partII]
    : buildPartIiFallbackSources(normalizedText);

  for (const source of partIiSources) {
    const resolution = resolveCheckboxNearLabel(source, labelPattern, "Rule 12b-25 relief", {
      maxDistance: 96,
      competingLabels: [
        ...TARGET_REPORT_LABELS.map((item) => item.pattern),
        /\bYes\b/i,
        /\bNo\b/i,
        /\(\s*2\s*\)/i,
        /\(\s*3\s*\)/i,
      ],
    });
    if (resolution.checked !== null || resolution.ambiguous) return resolution;
  }

  return {
    checked: null,
    token: null,
    label: "Rule 12b-25 relief",
    evidence: partIiSources[0] ? clip(partIiSources[0], 240) : null,
    confidence: "low",
    ambiguous: false,
  };
}

function buildPartIiFallbackSources(normalizedText: string): string[] {
  const anchors = [
    /\bsubject\s+(?:annual|quarterly|transition)?\s*report\s+could\s+not\s+be\s+filed\b/gi,
    /\bwithout\s+unreasonable\s+effort\s+or\s+expense\b/gi,
    /\bRule\s+12b-25\s*\(\s*b\s*\)/gi,
    /\bRule\s+12b-25\s*\(\s*c\s*\)/gi,
  ];
  const sources: string[] = [];
  for (const pattern of anchors) {
    for (const match of normalizedText.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const start = Math.max(0, match.index - 140);
      const end = Math.min(normalizedText.length, match.index + match[0].length + 220);
      const source = normalizedText.slice(start, end);
      if (!sources.includes(source)) sources.push(source);
    }
  }
  return sources;
}

function detectUnableWithoutUnreasonableEffort(
  normalizedText: string,
): boolean | null {
  if (
    /\bcould\s+not\s+be\s+(?:eliminated|filed)\b[^.]{0,180}\bwithout\s+unreasonable\s+effort\s+or\s+expense\b/i.test(
      normalizedText,
    )
  ) {
    return true;
  }

  if (
    /\bwithout\s+unreasonable\s+effort\s+or\s+expense\b/i.test(normalizedText)
  ) {
    return true;
  }

  return null;
}

function detectAccountantStatement(
  normalizedText: string,
  accountantStatementChecked: boolean | null,
  accountantStatementText: string | null,
): boolean | null {
  if (accountantStatementText) return true;
  if (accountantStatementChecked !== null) return accountantStatementChecked;

  if (
    /\baccountant'?s?\s+statement\b[^.]{0,160}\b(?:has\s+been\s+|is\s+)?(?:attached|included)\b(?!\s+if\s+applicable)/i.test(
      normalizedText,
    )
  ) {
    return true;
  }

  if (/\baccountant'?s?\s+statement\b/i.test(normalizedText)) return false;
  return null;
}

function extractAccountantStatementText(normalizedText: string): string | null {
  const statement =
    /\bPursuant\s+to\s+Rule\s+12B?-25\b[\s\S]{0,900}?\b(?:Very\s+Truly\s+Yours|signed:|\/s\/|LLP|LLC)\b[^*]{0,200}/i.exec(
      normalizedText,
    )?.[0] ??
    /\bWe\s+have\s+read\b[\s\S]{0,700}?\bagree\s+with\s+the\s+stated\s+reason\b[^*]{0,200}/i.exec(
      normalizedText,
    )?.[0];

  return statement ? clip(normalizeWhitespace(statement), 1200) : null;
}

function extractPeriodOfReport(
  normalizedText: string,
  sections: NtSectionSegments,
): { value: string | null; evidence: string | null; ambiguous: boolean } {
  const searchSources = [
    sections.topBlock,
    sections.partI,
    normalizedText.slice(0, 2200),
  ].filter(Boolean) as string[];
  const anchors = [
    /\bFor\s+Period\s+Ended\b/i,
    /\bPeriod\s+of\s+Report\b/i,
    /\bPeriod\s+Ended\b/i,
    /\bfiscal\s+year\s+ended\b/i,
    /\bquarter\s+ended\b/i,
    /\bquarterly\s+period\s+ended\b/i,
  ];

  for (const source of searchSources) {
    for (const anchor of anchors) {
      const anchored = extractDateNearAnchor(source, anchor);
      if (anchored.value || anchored.ambiguous) return anchored;
    }
  }

  return { value: null, evidence: null, ambiguous: false };
}

function detectNoRelianceOrRestatement(normalizedText: string): boolean {
  return /\bshould\s+no\s+longer\s+be\s+relied\s+upon\b/i.test(normalizedText) ||
    /\bwill\s+need\s+to\s+be\s+restated\b/i.test(normalizedText) ||
    /\bplans?\s+to\s+restate\b/i.test(normalizedText);
}

function extractDateNearAnchor(
  text: string,
  anchorPattern: RegExp,
): { value: string | null; evidence: string | null; ambiguous: boolean } {
  const anchor = execWithIndex(text, anchorPattern);
  if (!anchor) return { value: null, evidence: null, ambiguous: false };

  const windowStart = Math.max(0, anchor.index - 40);
  const windowEnd = Math.min(text.length, anchor.index + anchor.text.length + 140);
  const windowText = text.slice(windowStart, windowEnd);
  const anchorEndOffset = anchor.index + anchor.text.length - windowStart;
  const candidates = findDateCandidates(windowText)
    .filter((candidate) => !looksLikeOmbOrSignatureDate(windowText, candidate.index))
    .map((candidate) => ({
      ...candidate,
      distance: candidate.index >= anchorEndOffset
        ? candidate.index - anchorEndOffset
        : anchorEndOffset - (candidate.index + candidate.value.length) + 24,
    }))
    .sort((a, b) => a.distance - b.distance);

  if (!candidates.length) return { value: null, evidence: clip(windowText, 220), ambiguous: false };
  if (candidates.length > 1 && candidates[1].distance - candidates[0].distance < 8) {
    return { value: null, evidence: clip(windowText, 220), ambiguous: true };
  }

  return {
    value: candidates[0].value,
    evidence: clip(windowText, 220),
    ambiguous: false,
  };
}

function findDateCandidates(text: string): Array<{ value: string; index: number }> {
  const month =
    String.raw`(?:Jan(?:uary)?\.?|Feb(?:ruary)?\.?|Mar(?:ch)?\.?|Apr(?:il)?\.?|May|Jun(?:e)?\.?|Jul(?:y)?\.?|Aug(?:ust)?\.?|Sep(?:t(?:ember)?)?\.?|Oct(?:ober)?\.?|Nov(?:ember)?\.?|Dec(?:ember)?\.?)`;
  const patterns = [
    new RegExp(String.raw`\b${month}\s+\d{1,2},\s+\d{4}\b`, "gi"),
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    new RegExp(String.raw`\b\d{1,2}\s+${month}\s+\d{4}\b`, "gi"),
  ];
  const candidates: Array<{ value: string; index: number }> = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      candidates.push({ value: match[0], index: match.index });
    }
  }
  return candidates.sort((a, b) => a.index - b.index);
}

function looksLikeOmbOrSignatureDate(text: string, dateIndex: number) {
  const nearby = text.slice(Math.max(0, dateIndex - 48), Math.min(text.length, dateIndex + 80));
  return /\bOMB\b|\bExpires?\b|\bExpiration\b|\bSIGNATURES?\b|\bDate\s*:/i.test(nearby);
}

function detectPartIiiNarrativeFlags(partIiiText: string | null): string[] {
  if (!partIiiText) return [];
  const definitions = [
    {
      flag: "part_iii_attached_exhibit_reference",
      pattern: /\b(?:see|refer\s+to)\s+(?:the\s+)?attached\b|\battached\s+(?:exhibit|explanation|statement)\b/i,
    },
    {
      flag: "part_iii_restatement_correction_terms",
      pattern: /\b(restatement|restate|correction|correct|error|non-reliance|no\s+longer\s+be\s+relied\s+upon)\b/i,
    },
    {
      flag: "part_iii_audit_review_terms",
      pattern: /\b(audit|auditor|accountant|independent registered public accounting firm|interim review|review procedures)\b/i,
    },
    {
      flag: "part_iii_internal_control_terms",
      pattern: /\b(internal control|material weakness|disclosure controls)\b/i,
    },
    {
      flag: "part_iii_liquidity_default_terms",
      pattern: /\b(going concern|liquidity|covenant|default)\b/i,
    },
    {
      flag: "part_iii_legal_investigation_terms",
      pattern: /\b(investigation|SEC inquiry|subpoena|litigation|lawsuit)\b/i,
    },
    {
      flag: "part_iii_electronic_filing_difficulty_terms",
      pattern: /\b(electronic filing difficulties|electronic filing|EDGAR filing difficulties|EDGAR|technical difficult(?:y|ies)|unable to file electronically|Regulation S-T|Rule 20[12]|transmission error|filing system)\b/i,
    },
    {
      flag: "part_iii_unable_to_quantify_terms",
      pattern: /\b(cannot estimate|unable to quantify|not yet determined|cannot be estimated)\b/i,
    },
  ];

  return definitions
    .filter((definition) => definition.pattern.test(partIiiText))
    .map((definition) => definition.flag);
}

function detectPortionOnlyFacts(
  normalizedText: string,
  sections: NtSectionSegments,
): NtPortionOnlyFacts {
  const sources = [
    sections.topBlock,
    normalizedText,
  ].filter(Boolean) as string[];
  const portionPattern =
    /\b(?:portion\s+of\s+the\s+filing|portion\s+thereof|identify\s+the\s+Item\(s\)|Item\s+8\b|Item\s+9A\b|financial\s+statements|certain\s+exhibits|Part\s+II,\s*Item|Part\s+I,\s*Item)\b/i;
  const candidates: NtPortionOnlyFacts[] = [];

  for (const source of sources) {
    const match = portionPattern.exec(source);
    if (!match?.[0] && match?.index !== 0) continue;
    const start = Math.max(0, (match.index ?? 0) - 160);
    const end = Math.min(source.length, (match.index ?? 0) + match[0].length + 220);
    const evidence = clip(source.slice(start, end), 360);
    const itemWording = extractPortionItemWording(evidence);
    candidates.push({
      detected: true,
      itemWording,
      ambiguous: itemWording === null,
      evidence,
    });
  }

  const withItem = candidates.find((candidate) => candidate.itemWording);
  if (withItem) return withItem;
  if (candidates[0]) return candidates[0];

  return {
    detected: false,
    itemWording: null,
    ambiguous: false,
    evidence: null,
  };
}

function extractPortionItemWording(evidence: string): string | null {
  const match =
    /\b(?:Part\s+[IVX]+,\s*)?Item\s+\d+[A-Z]?(?:\s*(?:,|and|&)\s*(?:Part\s+[IVX]+,\s*)?Item\s+\d+[A-Z]?)*\b/i.exec(evidence) ??
    /\bfinancial\s+statements\b/i.exec(evidence) ??
    /\bcertain\s+exhibits\b/i.exec(evidence);
  return match ? normalizeWhitespace(match[0]) : null;
}

function detectElectronicFilingDifficulty(
  partIiiText: string | null,
): NtElectronicFilingDifficultyFacts {
  if (!partIiiText) {
    return { detected: false, primaryReason: false, evidence: null };
  }

  const pattern =
    /\b(electronic\s+filing\s+difficulties|EDGAR\s+filing\s+difficulties|technical\s+difficult(?:y|ies)|unable\s+to\s+file\s+electronically|Regulation\s+S-T|Rule\s+20[12]|filing\s+system|transmission\s+error)\b/i;
  const match = pattern.exec(partIiiText);
  if (!match?.[0] && match?.index !== 0) {
    return { detected: false, primaryReason: false, evidence: null };
  }

  const evidence = clip(
    partIiiText.slice(Math.max(0, (match.index ?? 0) - 120), (match.index ?? 0) + match[0].length + 220),
    360,
  );
  const primaryReason = isElectronicFilingPrimaryReason(partIiiText, match.index ?? 0);

  return {
    detected: true,
    primaryReason,
    evidence,
  };
}

function isElectronicFilingPrimaryReason(partIiiText: string, matchIndex: number): boolean {
  const firstReason = partIiiText.slice(0, Math.min(partIiiText.length, 420));
  const hasOperationalReason =
    /\b(audit|auditor|accountant|financial\s+statements?|consolidation|review\s+procedures|internal\s+control|revenue|sales|inventory|valuation|tax|restatement|liquidity|going\s+concern)\b/i.test(firstReason);
  return matchIndex <= 220 && !hasOperationalReason;
}

function detectSourceTextFlags(args: {
  sourceText: string;
  partIiiText: string | null;
  partIiiNarrativeFlags: string[];
  significantChangeExpected: boolean | null;
  noRelianceOrRestatementDisclosed: boolean;
  accountantStatementAttached: boolean | null;
  isAmendment: boolean;
  isTransitionReport: boolean;
  anticipatedWithinExtension: boolean | null;
}): string[] {
  const flags: string[] = SOURCE_TEXT_FLAG_DEFINITIONS.filter((definition) =>
    definition.pattern.test(args.sourceText),
  ).map((definition) => definition.flag);

  if (args.significantChangeExpected === true) {
    flags.push("significant_change_yes");
  }
  if (args.significantChangeExpected === false) {
    flags.push("significant_change_no");
  }
  if (args.noRelianceOrRestatementDisclosed) {
    flags.push("no_reliance_or_restatement_terms");
  }
  if (args.accountantStatementAttached === true) {
    flags.push("accountant_statement_present");
  }
  if (args.isAmendment) {
    flags.push("amendment_marker_present");
  }
  if (args.isTransitionReport) {
    flags.push("transition_report_checked");
  }
  if (args.anticipatedWithinExtension === true) {
    flags.push("extension_within");
  }
  if (args.anticipatedWithinExtension === false) {
    flags.push("extension_not_expected");
  }
  if (/\bas\s+promptly\s+as\s+practicable\b/i.test(args.sourceText)) {
    flags.push("promptly_as_practicable_language");
  }

  return Array.from(new Set(flags));
}

function buildRawDataQuality(args: {
  formType: NtSupportedFormType;
  delayedReport: "10-K" | "10-Q" | "20-F";
  periodOfReport: string | null;
  lateFilingReason: string | null;
  anticipatedWithinExtension: boolean | null;
  significantChangeExpected: boolean | null;
  amendmentPurpose: string | null;
  isAmendment: boolean;
  isTransitionReport: boolean;
  transitionPeriodEnded: string | null;
  checkedReports: Array<"10-K" | "10-Q" | "20-F">;
  transitionReportType: "10-K" | "10-Q" | "20-F" | null;
  targetReportCheckboxGroup: NtTargetReportCheckboxGroup;
  submissionBodyFormMismatch: boolean;
  amendmentPartialBody: boolean;
  periodOfReportAmbiguous: boolean;
  transitionPeriodEndedAmbiguous: boolean;
  accountantStatementAttached: boolean | null;
  partIv: NtPartIvFacts;
  portionOnly: NtPortionOnlyFacts;
  electronicFilingDifficulty: NtElectronicFilingDifficultyFacts;
  normalizedText: string;
}): NtParserOutput["facts"]["rawDataQuality"] {
  const requiredFieldsPresent = {
    formType: Boolean(args.formType),
    delayedReport: Boolean(args.delayedReport),
    periodOfReport: Boolean(args.periodOfReport),
    partIiiNarrative: Boolean(args.lateFilingReason),
    extensionExpectation: args.anticipatedWithinExtension !== null,
    significantChangeAnswer: args.significantChangeExpected !== null,
  };

  const missingCriticalFields = Object.entries(requiredFieldsPresent)
    .filter(([, present]) => !present)
    .map(([field]) => field);
  const ambiguousFields: string[] = [];
  const noiseCandidates: NtParserOutput["facts"]["rawDataQuality"]["noiseCandidates"] = [
    {
      label: "sec_form_instructions",
      reason: "Generic Form 12b-25 instructions and legal warnings recur across filings and are not company-specific facts.",
    },
    {
      label: "rule_12b_25_boilerplate",
      reason: "Part II rule text explains checkbox meanings and should not be confused with issuer-specific narrative.",
    },
    {
      label: "signature_authorization",
      reason: "Signature authorization language repeats across filings and is usually not analytical evidence.",
    },
  ];

  if (args.isAmendment && !args.amendmentPurpose) {
    ambiguousFields.push("amendmentPurpose");
  }
  if (args.amendmentPartialBody) {
    ambiguousFields.push("amendmentPartialBody");
  }
  if (args.isTransitionReport && !args.transitionPeriodEnded) {
    ambiguousFields.push("transitionPeriodEnded");
  }
  if (args.periodOfReportAmbiguous) {
    ambiguousFields.push("periodOfReport");
  }
  if (args.transitionPeriodEndedAmbiguous) {
    ambiguousFields.push("transitionPeriodEnded");
  }
  if (args.checkedReports.length > 0 && args.transitionReportType) {
    ambiguousFields.push("regularAndTransitionReportBothChecked");
  }
  if (args.targetReportCheckboxGroup.ambiguous) {
    ambiguousFields.push("targetReportCheckboxGroup");
  }
  if (
    !args.targetReportCheckboxGroup.selectedReport &&
    !args.targetReportCheckboxGroup.selectedTransitionReport &&
    args.targetReportCheckboxGroup.checkedReports.length === 0 &&
    args.targetReportCheckboxGroup.checkedTransitionReports.length === 0
  ) {
    ambiguousFields.push("targetReportCheckboxMissing");
  }
  if (args.submissionBodyFormMismatch) {
    ambiguousFields.push("submissionBodyFormMismatch");
  }
  if (!args.partIv.contact.name && args.partIv.contact.telephoneNumber) {
    ambiguousFields.push("partIvContactName");
  }
  if (args.partIv.otherPeriodicReports.ambiguous) {
    ambiguousFields.push("partIvQ2Answer");
  }
  if (args.partIv.otherPeriodicReports.answer === false && !args.partIv.otherPeriodicReports.explanation) {
    ambiguousFields.push("partIvQ2MissingReportExplanation");
  }
  if (args.partIv.otherPeriodicReports.foundByFallback) {
    ambiguousFields.push("partIvQ2FallbackAnchor");
  }
  if (args.partIv.significantChange.ambiguous) {
    ambiguousFields.push("partIvQ3Answer");
  }
  if (args.partIv.significantChange.answer === true && !args.partIv.significantChange.explanation) {
    ambiguousFields.push("partIvQ3Explanation");
  }
  if (
    args.partIv.significantChange.answer === true &&
    args.partIv.significantChange.explanation &&
    !args.partIv.significantChange.quantitativeDisclosurePresent
  ) {
    ambiguousFields.push("partIvQ3QuantitativeDisclosure");
  }
  if (
    args.partIv.significantChange.answer === false &&
    hasFinancialChangeLanguage(args.partIv.significantChange.explanation)
  ) {
    ambiguousFields.push("partIvQ3NoWithFinancialChangeExplanation");
  }
  if (args.partIv.significantChange.foundByFallback) {
    ambiguousFields.push("partIvQ3FallbackAnchor");
  }
  if (args.portionOnly.detected && args.portionOnly.ambiguous) {
    ambiguousFields.push("portionOnlyItemDetail");
  }
  if (args.electronicFilingDifficulty.primaryReason) {
    ambiguousFields.push("electronicFilingDifficultyPrimaryReason");
  }
  if (/\bas\s+promptly\s+as\s+practicable\b/i.test(args.normalizedText)) {
    ambiguousFields.push("extensionExpectationPromptlyAsPracticable");
  }
  if (
    args.accountantStatementAttached === true &&
    /\baccountant'?s?\s+statement\b/i.test(args.normalizedText) &&
    !/\bPursuant\s+to\s+Rule\s+12B?-25\b|\bWe\s+have\s+read\b/i.test(
      args.normalizedText,
    )
  ) {
    ambiguousFields.push("accountantStatementReferencedButBodyNotExtracted");
  }

  return {
    requiredFieldsPresent,
    missingCriticalFields,
    ambiguousFields: Array.from(new Set(ambiguousFields)),
    noiseCandidates,
  };
}

function buildSourceExcerpts(
  lateFilingReason: string | null,
  significantChangeDescription: string | null,
  amendmentPurpose: string | null,
  accountantStatementText: string | null,
): NtParserOutput["facts"]["sourceExcerpts"] {
  const excerpts: NtParserOutput["facts"]["sourceExcerpts"] = [];
  if (lateFilingReason) {
    excerpts.push({
      label: "late_filing_reason",
      text: lateFilingReason,
    });
  }
  if (significantChangeDescription) {
    excerpts.push({
      label: "significant_change_question",
      text: significantChangeDescription,
    });
  }
  if (amendmentPurpose) {
    excerpts.push({
      label: "amendment_purpose",
      text: amendmentPurpose,
    });
  }
  if (accountantStatementText) {
    excerpts.push({
      label: "accountant_statement",
      text: accountantStatementText,
    });
  }
  return excerpts;
}

function buildWarnings(
  anticipatedWithinExtension: boolean | null,
  significantChangeExpected: boolean | null,
  lateFilingReason: string | null,
  context: {
    isAmendment: boolean;
    amendmentPartialBody: boolean;
    amendmentPurpose: string | null;
    isTransitionReport: boolean;
    transitionPeriodEnded: string | null;
    checkedReports: Array<"10-K" | "10-Q" | "20-F">;
    transitionReportType: "10-K" | "10-Q" | "20-F" | null;
    targetReportCheckboxGroup: NtTargetReportCheckboxGroup;
    submissionBodyFormMismatch: boolean;
    partIv: NtPartIvFacts;
    electronicFilingDifficulty: NtElectronicFilingDifficultyFacts;
  },
): string[] {
  const warnings: string[] = [];
  if (anticipatedWithinExtension === null) {
    warnings.push("Could not determine whether issuer expects to file within the Rule 12b-25 extension window.");
  }
  if (significantChangeExpected === null) {
    warnings.push("Could not determine the answer to the significant-change-in-results question.");
  }
  if (!lateFilingReason) {
    warnings.push("Could not extract a Part III late-filing narrative.");
  }
  if (context.isAmendment && !context.amendmentPurpose) {
    warnings.push("Filing appears to be an amendment, but amendment purpose was not clearly extracted.");
  }
  if (context.amendmentPartialBody) {
    warnings.push("Amendment body appears partial or weakly segmented; preserve source facts without treating missing sections as a hard parser failure.");
  }
  if (context.isTransitionReport && !context.transitionPeriodEnded) {
    warnings.push("Transition report checkbox is checked, but transition period ended is blank or could not be extracted.");
  }
  if (context.checkedReports.length > 0 && context.transitionReportType) {
    warnings.push("Both a regular report checkbox and a transition report checkbox appear checked; preserve both source facts.");
  }
  if (context.targetReportCheckboxGroup.ambiguous) {
    warnings.push("Multiple target report checkboxes appear checked; target report is ambiguous.");
  }
  if (context.submissionBodyFormMismatch) {
    warnings.push("Body target report checkbox conflicts with EDGAR submission form type; preserve both source facts.");
  }
  if (context.partIv.otherPeriodicReports.ambiguous) {
    warnings.push("Part IV Q2 Yes and No both appear checked; preserve answer as ambiguous.");
  }
  if (context.partIv.otherPeriodicReports.answer === false && !context.partIv.otherPeriodicReports.explanation) {
    warnings.push("Part IV Q2 is answered No, but no missing-report explanation was extracted.");
  }
  if (context.partIv.otherPeriodicReports.foundByFallback) {
    warnings.push("Part IV Q2 anchor was found only through fallback wording.");
  }
  if (context.partIv.significantChange.ambiguous) {
    warnings.push("Part IV Q3 Yes and No both appear checked; preserve answer as ambiguous.");
  }
  if (context.partIv.significantChange.answer === true && !context.partIv.significantChange.explanation) {
    warnings.push("Part IV Q3 is answered Yes, but no significant-change explanation was extracted.");
  }
  if (
    context.partIv.significantChange.answer === true &&
    context.partIv.significantChange.explanation &&
    !context.partIv.significantChange.quantitativeDisclosurePresent
  ) {
    warnings.push("Part IV Q3 is answered Yes, but the extracted explanation has no quantitative-looking disclosure.");
  }
  if (
    context.partIv.significantChange.answer === false &&
    hasFinancialChangeLanguage(context.partIv.significantChange.explanation)
  ) {
    warnings.push("Part IV Q3 is answered No, but local explanation appears to describe a financial results change.");
  }
  if (context.partIv.significantChange.foundByFallback) {
    warnings.push("Part IV Q3 anchor was found only through fallback wording.");
  }
  if (context.electronicFilingDifficulty.primaryReason) {
    warnings.push("Part III narrative appears to cite electronic filing difficulty as the sole or primary reason; preserve as source-backed parser hint only.");
  }
  return warnings;
}

function extractSection(
  normalizedText: string,
  startPattern: RegExp,
  endPattern: RegExp,
): string | null {
  const start = normalizedText.search(startPattern);
  if (start < 0) return null;

  const afterStart = normalizedText.slice(start);
  const end = afterStart.slice(1).search(endPattern);
  const section = end >= 0 ? afterStart.slice(0, end + 1) : afterStart;
  return normalizeWhitespace(section);
}

function cleanSectionHeading(
  section: string,
  requiredHeading: string,
  optionalPhrases: string[],
): string {
  let cleaned = section.replace(
    new RegExp(`^${requiredHeading}\\b\\s*(?:[-–—]\\s*)?`, "i"),
    "",
  );
  for (const phrase of optionalPhrases) {
    cleaned = cleaned.replace(phrase, "");
  }
  cleaned = cleaned
    .replace(/^NARRATIVE\b\s*(?:\([^)]*\))?\s*/i, "")
    .replace(/^\s*\([^)]*\)\s*/i, "")
    .replace(
      /^State\s+below\s+in\s+reasonable\s+detail\b[^.]*prescribed\s+time\s+period\.?\s*/i,
      "",
    )
    .replace(/^\(Attach\s+Extra\s+Sheets\s+if\s+Needed\)\s*/i, "");
  return cleanTrailingCheckboxNoise(normalizeWhitespace(cleaned));
}

function extractLastSection(
  normalizedText: string,
  startPattern: RegExp,
  endPattern: RegExp,
): string | null {
  const starts = Array.from(normalizedText.matchAll(new RegExp(startPattern, "gi")));
  const startMatch = starts.at(-1);
  if (!startMatch?.index && startMatch?.index !== 0) return null;

  const afterStart = normalizedText.slice(startMatch.index);
  const end = afterStart.slice(1).search(endPattern);
  const section = end >= 0 ? afterStart.slice(0, end + 1) : afterStart;
  return normalizeWhitespace(section);
}

function cleanTrailingCheckboxNoise(value: string): string {
  return normalizeWhitespace(
    value
      .replace(/\[\s*\]\s*Yes\s*\[[xX]\]\s*No\.?$/i, "")
      .replace(/\[[xX]\]\s*Yes\s*\[\s*\]\s*No\.?$/i, ""),
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFilingText(value: string): string {
  const html = decodeHtmlEntities(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<([a-z][\w:-]*)\b(?=[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'])[^>]*>[\s\S]*?<\/\1>/gi, " ");

  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|li|ul|ol|body|html)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(?:thead|tbody|tfoot|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl");
}

function fromCodePoint(value: number): string {
  if (!Number.isFinite(value)) return " ";
  try {
    return String.fromCodePoint(value);
  } catch {
    return " ";
  }
}

function cutAtFirstPattern(value: string, patterns: RegExp[]): string {
  const indexes = patterns
    .map((pattern) => value.search(pattern))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return value;
  return value.slice(0, Math.min(...indexes));
}

function checkedBeforePattern(labelPattern: string): RegExp {
  return new RegExp(`${CHECKED_MARK}\\s*(?:\\|\\s*)?${labelPattern}`, "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeNtFormForSelection(value: string | null | undefined): string {
  return (value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^FORM\s+/, "")
    .replace(/^NT\s*(10-[KQ]|20-F)\s*\/\s*A$/, "NT $1/A")
    .replace(/^NT\s*(10-[KQ]|20-F)$/, "NT $1");
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function clipNullable(value: string | null, maxLength: number): string | null {
  return value ? clip(value, maxLength) : null;
}

function nullableString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}
