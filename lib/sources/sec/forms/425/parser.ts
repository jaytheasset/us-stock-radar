import {
  SEC_425_PARSER_GROUP,
  SEC_425_PARSER_VERSION,
  type Sec425CalendarItem,
  type Sec425AmendmentFacts,
  type Sec425DealFacts,
  type Sec425DocumentSummary,
  type Sec425DocumentRole,
  type Sec425Field,
  type Sec425FinancingFacts,
  type Sec425LegalFacts,
  type Sec425OfferFacts,
  type Sec425ParseInput,
  type Sec425ParserFacts,
  type Sec425ParserOutput,
  type Sec425RawDataCandidate,
  type Sec425RawDataFacts,
  type Sec425SignalFact,
  type Sec425SourceBlock,
  type Sec425SourceDocument,
  type Sec425SourceSection,
  type Sec425SpacFacts,
  type Sec425VoteFacts,
  type Sec425VoteResult,
} from "./types";

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

type RawDocumentSegment = {
  source: "primary" | "attachment";
  documentType: string | null;
  documentIndex: number | null;
  description: string | null;
  filename: string | null;
  url: string | null;
  isPrimary: boolean;
  text: string;
};

type SourceBundle = {
  blocks: Sec425SourceBlock[];
  routerBlocks: Sec425SourceBlock[];
  documents: Sec425SourceDocument[];
};

type SectionAnalysis = {
  sections: Sec425SourceSection[];
  contentTypes: string[];
  candidateText: string;
  parserOnlyCase: string | null;
  extractionQuality: Sec425RawDataFacts["extraction_quality"];
};

const TRANSACTION_LANGUAGE_PATTERN =
  /(?:\b(?:merger|merge|acquisition|acquire|combine|business combination|tender offer|exchange offer|de-SPAC|deSPAC|transaction|definitive agreement|merger agreement|purchase agreement|combination agreement|arrangement agreement|cash consideration|stock consideration|all-stock(?: transaction)?|all-cash(?: transaction)?|mixed consideration|mixed cash and stock consideration|exchange ratio|converted into the right to receive|right to receive|cash per share|per share in cash|equity value|enterprise value|implied equity value|premium\s+(?:to|of|over)|purchase price|offer price|valuation|closing|expected to close|closing condition|shareholder approval|stockholder approval|shareholder meeting|stockholder meeting|special meeting|extraordinary general meeting|shareholder vote|stockholder vote|vote|regulatory approval|antitrust approval|HSR|registration statement|proxy statement|prospectus|amendment|amended|waiver|revised proposal|revised offer|increased offer|termination|terminated|termination fee|superior proposal|competing proposal|unsolicited proposal|fiduciary out|no-shop|go-shop|voting agreement|support agreement|board determination|PIPE|private investment in public equity|trust account|redemption|sponsor|pro forma ownership|combined company|expected listing|projected|forecast|outlook|guidance|synergy|synergies|accretive|dilutive|adjusted EBITDA|revenue growth|pro forma|free cash flow)\b|\$\s?\d[\d,.]*\s*(?:per share|per-share)\b|\b\d+(?:\.\d+)?%\s+premium\b)/i;

const RISK_RELEVANT_LANGUAGE_PATTERN =
  /\b(?:superior proposal|competing proposal|unsolicited proposal|revised proposal|revised offer|termination|termination fee|amendment|waiver|fiduciary out|no-shop|go-shop|voting agreement|support agreement|litigation|injunction|antitrust|regulatory approval|conflict of interest|compensation|severance|retention)\b/i;

const BOILERPLATE_HEADING_PATTERN =
  /\b(?:Forward-Looking Statements|Cautionary Statement Regarding Forward-Looking Statements|Safe Harbor Statement|No Offer or Solicitation|Additional\s+Information\s+and\s+Where\s+to\s+Find\s+It|Important Additional Information|Participants in the Solicitation|Where You Can Find Additional Information)\b/i;

export function parseSec425Filing(input: Sec425ParseInput): Sec425ParserOutput {
  const rawPayload = toRecord(input.rawPayload) || {};
  const metadata = toRecord(input.metadata) || {};
  const formType = "425" as const;
  const accessionNumber =
    nullableString(input.accessionNumber) ||
    nullableString(rawPayload.accession_number) ||
    nullableString(input.sourceUniqueId);
  const filingText = normalizeSourceText(stringValue(input.filingText) || stringValue(input.analysisText) || stringValue(input.bodyText));
  const normalizedAttachments = (input.attachments || []).map((attachment, index) => ({
    attachment,
    index,
    text: normalizeSourceText(attachment.text),
  }));
  const attachmentText = compactText(normalizedAttachments.map((attachment) => attachment.text).join("\n\n"));
  const text = compactText([stringValue(input.title), filingText, attachmentText].filter(Boolean).join("\n\n"));
  const documents = buildDocumentSummaries(input, rawPayload);
  const filedBy = readFiledByCompany(text);
  const subjectCompany = readSubjectCompany(text);
  const companyName =
    nullableString(input.companyName) ||
    nullableString(rawPayload.company_name) ||
    nullableString(metadata.company_name) ||
    filedBy;
  const primaryTicker =
    normalizeTicker(input.primaryTicker) ||
    normalizeTicker(rawPayload.ticker) ||
    normalizeTicker(metadata.ticker) ||
    readTicker(text);
  const exchange = nullableString(input.exchange) || nullableString(rawPayload.exchange) || nullableString(metadata.exchange);

  const communicationTypes = findCommunicationTypes(text);
  const transactionParties = findTransactionParties(text, companyName, subjectCompany);
  const deal = findDealFacts(text, transactionParties);
  const amendment = findAmendmentFacts(text, documents);
  const vote = findVoteFacts(text);
  const offer = findOfferFacts(text, subjectCompany);
  const spac = findSpacFacts(text, transactionParties, companyName);
  const legal = findLegalFacts(text);
  const financing = findFinancingFacts(text);
  const boilerplateMarkers = findBoilerplateMarkers(text);
  const noNewMaterialInfo = hasNoNewMaterialInfo(text);
  const materialChange = hasMaterialChange(text);
  const rawSegments: RawDocumentSegment[] = [
    {
      source: "primary",
      documentType: "425",
      documentIndex: null,
      description: nullableString(input.primaryDocumentDescription) || nullableString(input.title),
      filename: nullableString(input.primaryDocumentFilename) || filenameFromUrl(input.primaryDocumentUrl) || filenameFromUrl(input.sourceUrl),
      url: nullableString(input.primaryDocumentUrl) || nullableString(input.sourceUrl),
      isPrimary: true,
      text: filingText,
    },
    ...normalizedAttachments.map(({ attachment, index, text: attachmentTextValue }) => ({
      source: "attachment" as const,
      documentType: nullableString(attachment.documentType) || nullableString(attachment.description),
      documentIndex: index,
      description: nullableString(attachment.description),
      filename: nullableString(attachment.filename) || filenameFromUrl(attachment.url),
      url: nullableString(attachment.url),
      isPrimary: Boolean(attachment.isPrimary),
      text: attachmentTextValue,
    })),
  ];
  const sectionAnalysis = buildSectionAnalysis(rawSegments, documents, stringValue(input.title));
  const rawData = buildRawDataFacts(rawSegments, sectionAnalysis);
  const sourceBundle = buildSourceBundle(rawSegments);
  const deterministicArchiveReason = buildDeterministicArchiveReason({
    noNewMaterialInfo,
    materialChange,
    deal,
    vote,
    legal,
    financing,
    parserOnlyCase: sectionAnalysis.parserOnlyCase,
  });
  const sourceExcerpts = uniqueStrings([
    ...deal.evidence,
    ...vote.evidence,
    ...legal.litigation_or_claims,
    ...legal.regulatory_risk,
    ...legal.injunction_or_delay_risk,
    ...financing.financing_risk,
    ...financing.going_concern_or_liquidity_risk,
    ...amendment.evidence,
    ...offer.evidence,
    ...spac.evidence,
    ...rawData.signal_candidates.map((candidate) => candidate.context),
    findSentence(text, /\binvestor day\b/i),
  ]).slice(0, 16);
  const facts: Sec425ParserFacts = {
    company_name: companyName,
    primary_ticker: primaryTicker,
    exchange,
    filed_by: filedBy,
    subject_company: subjectCompany,
    documents,
    communication_types: communicationTypes,
    transaction_parties: transactionParties,
    deal,
    amendment,
    vote,
    offer,
    spac,
    legal,
    financing,
    boilerplate_markers: boilerplateMarkers,
    no_new_material_info: noNewMaterialInfo,
    material_change: materialChange,
    deterministic_archive_reason: deterministicArchiveReason,
    source_excerpts: sourceExcerpts,
    raw_data: rawData,
    market_context: input.market_context || null,
  };
  const signals = buildSignals(facts);
  const calendarItems = buildCalendarItems(facts, text);
  const warnings = buildWarnings(text, facts);

  return {
    parserVersion: SEC_425_PARSER_VERSION,
    parserGroup: SEC_425_PARSER_GROUP,
    formType,
    accessionNumber,
    isSupported: true,
    summary: buildSummary(facts),
    facts,
    signals,
    calendarItems,
    warnings,
    raw: {
      rawItemId: nullableString(input.rawItemId),
      sourceUniqueId: nullableString(input.sourceUniqueId),
      sourceUrl: nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url),
      publishedAt: nullableString(input.publishedAt),
      title: nullableString(input.title),
      textStats: {
        filingTextChars: filingText.length,
        attachmentTextChars: attachmentText.length,
      },
      parentFilingContextPresent: Boolean(input.parent_filing_context),
      cleaned_source_blocks: sourceBundle.blocks,
      router_source_blocks: sourceBundle.routerBlocks,
      document_inventory: sourceBundle.documents,
    },
  };
}

const SOURCE_BLOCK_CHAR_LIMIT = 4_500;
const ROUTER_BLOCK_CHAR_LIMIT = 1_500;
const ROUTER_BLOCK_LIMIT = 18;
const ROUTER_BLOCKS_PER_DOCUMENT = 4;

function buildSourceBundle(segments: RawDocumentSegment[]): SourceBundle {
  const blocks: Sec425SourceBlock[] = [];
  const documents: Sec425SourceDocument[] = [];

  for (const segment of segments) {
    if (!segment.text) continue;
    const sourceRef = segment.source === "primary" ? "primary" : `attachment_${(segment.documentIndex ?? 0) + 1}`;
    const documentRole = classifyDocumentRole(segment);
    const documentBlocks = isNonTextSourceDocument(segment)
      ? []
      : buildDocumentSourceBlocks(segment, sourceRef, documentRole);
    blocks.push(...documentBlocks);
    documents.push({
      source_ref: sourceRef,
      origin: segment.source,
      document_index: segment.documentIndex,
      document_type: segment.documentType,
      document_role: documentRole,
      description: segment.description,
      filename: segment.filename,
      url: segment.url,
      is_primary: segment.isPrimary,
      text_char_count: segment.text.length,
      source_block_count: documentBlocks.length,
    });
  }

  return {
    blocks,
    routerBlocks: selectRouterSourceBlocks(blocks),
    documents,
  };
}

function isNonTextSourceDocument(segment: RawDocumentSegment) {
  const documentType = compactText(segment.documentType || "");
  const fileReference = compactText([segment.filename, segment.url].filter(Boolean).join(" "));
  return /^(?:GRAPHIC|IMAGE|ZIP|EXCEL|XML|XBRL|JSON)$/i.test(documentType) || /\.(?:jpe?g|png|gif|tiff?|bmp|svg|zip|xls[xm]?|xml|xsd|json)\b/i.test(fileReference);
}

function startsWithTransactionAgreementAmendment(text: string) {
  const titleArea = truncate(text, 1_500);
  return /\b(?:(?:first|second|third|fourth|fifth|sixth)\s+amendment|amendment(?:\s+no\.?\s*\d+)?)\s+(?:to\s+)?(?:the\s+)?(?:agreement\s+and\s+plan\s+of\s+merger|merger\s+agreement|business\s+combination\s+agreement|transaction\s+agreement|arrangement\s+agreement)\b/i.test(titleArea);
}

function classifyDocumentRole(segment: RawDocumentSegment): Sec425DocumentRole {
  const metadata = compactText([
    segment.documentType,
    segment.description,
    segment.filename,
    segment.url,
  ].filter(Boolean).join(" "));
  const sample = truncate(segment.text, 6_000);
  const value = `${metadata}\n${sample}`;

  if (/\b(?:fact sheet|transaction facts?|deal facts?)\b/i.test(metadata)) return "fact_sheet";
  if (/\b(?:offer letter|proposal letter|acquisition proposal|public proposal)\b/i.test(metadata)) return "offer_letter";
  if (/\b(?:stockholders? agreement|shareholders? agreement|voting and support agreement|support agreement)\b/i.test(value)) {
    return "stockholder_agreement";
  }
  if (/\b(?:employment agreement|retention agreement|severance agreement|change in control agreement)\b/i.test(value)) {
    return "employment_agreement";
  }
  if (startsWithTransactionAgreementAmendment(`${metadata}\n${sample}`) && hasAgreementDocumentStructure(value)) {
    return "agreement_amendment";
  }
  if (/\b(?:amendment|amended|first amendment|second amendment|third amendment)\b[\s\S]{0,120}\b(?:merger|business combination|transaction|arrangement) agreement\b/i.test(metadata)) {
    return "agreement_amendment";
  }
  if (/\b(?:agreement and plan of merger|merger agreement|business combination agreement|transaction agreement|arrangement agreement)\b/i.test(metadata)) {
    return "transaction_agreement";
  }
  if (/\b(?:employee faq|frequently asked questions|questions and answers|\bFAQ\b)\b/i.test(metadata)) return "faq";
  if (/\b(?:transcript|conference call transcript|prepared remarks|interview|podcast|video remarks?|town hall)\b/i.test(metadata)) return "transcript";
  if (/\b(?:investor presentation|joint presentation|transaction presentation|investor day|presentation)\b/i.test(metadata)) return "investor_presentation";
  if (/\b(?:press release|news release)\b/i.test(metadata)) return "press_release";
  if (/\b(?:employee communication|all employee|letter to employees|team member communication|internal faq|employee benefits?)\b/i.test(metadata)) {
    return "stakeholder_communication";
  }
  if (/\b(?:amendment|amended|first amendment|second amendment|third amendment)\b[\s\S]{0,120}\b(?:merger|business combination|transaction|arrangement) agreement\b/i.test(value) && hasAgreementDocumentStructure(value)) {
    return "agreement_amendment";
  }
  if (/\b(?:agreement and plan of merger|merger agreement|business combination agreement|transaction agreement|arrangement agreement)\b/i.test(value) && hasAgreementDocumentStructure(value)) {
    return "transaction_agreement";
  }
  if (/\b(?:offer letter|proposal letter|acquisition proposal|public proposal)\b/i.test(value)) return "offer_letter";
  if (/\b(?:fact sheet|transaction facts?|deal facts?)\b/i.test(value)) return "fact_sheet";
  if (/\b(?:employee faq|frequently asked questions|questions and answers|\bFAQ\b)\b/i.test(value) || /(?:^|\n)\s*Q\s*&\s*A\s*(?:\n|$)/im.test(value)) return "faq";
  if (isEventNotice(value)) return "meeting_notice";
  if (/\b(?:transcript|conference call transcript|prepared remarks|interview|podcast|video remarks?|town hall)\b/i.test(value)) return "transcript";
  if (/\b(?:investor presentation|joint presentation|transaction presentation|investor day|presentation)\b/i.test(value)) return "investor_presentation";
  if (/\b(?:press release|news release|for immediate release)\b/i.test(value)) return "press_release";
  if (/\b(?:employee communication|all employee|letter to employees|team member communication|internal faq)\b/i.test(value)) {
    return "stakeholder_communication";
  }
  if (/\b(?:special meeting|record date|meeting date|adjourned|reconvened|reconvene)\b/i.test(value)) return "meeting_notice";
  if (/\b(?:regulatory approval|antitrust clearance|proxy (?:filed|mailed)|definitive proxy statement|closing condition update)\b/i.test(value)) {
    return "regulatory_update";
  }
  if (/\b(?:social media|twitter|tweet|\bX post\b|linkedin|repost)\b/i.test(value)) return "social_media";
  return segment.source === "primary" ? "primary_425" : "other";
}

function hasAgreementDocumentStructure(text: string) {
  return /\b(?:ARTICLE\s+[IVX\d]+|RECITALS|WITNESSETH|NOW,? THEREFORE|representations and warranties|conditions to closing|termination provisions?)\b/i.test(text);
}

function buildDocumentSourceBlocks(
  segment: RawDocumentSegment,
  sourceRef: string,
  documentRole: Sec425DocumentRole,
): Sec425SourceBlock[] {
  const embeddedExhibitRoles = findEmbeddedExhibitRoles(segment.text);
  // document_role describes the document format. content_role is classified per
  // block so a press release can still expose a meeting or regulatory update.
  const inferredContentRole = segment.source === "primary" && embeddedExhibitRoles.size === 0
    ? inferPrimaryContentRole(segment.text)
    : null;
  const units = splitSourceDocument(segment.text, embeddedExhibitRoles, null);
  const blocks: Sec425SourceBlock[] = [];
  let sequence = 0;

  for (const unit of units) {
    const chunks = splitLongSourceText(unit.text, SOURCE_BLOCK_CHAR_LIMIT);
    for (const chunk of chunks) {
      const text = compactText(chunk);
      if (!text) continue;
      sequence += 1;
      const contentRole = unit.contentRole || classifyContentRole(
        text,
        unit.heading,
        inferredContentRole || documentRole,
      );
      const blockType = classifySourceBlockType(text, unit.heading, contentRole, unit.isTable);
      const isBoilerplate = blockType === "legal_boilerplate" || isGenericBoilerplateParagraph(text);
      blocks.push({
        block_id: `425_${sourceRef}_${String(sequence).padStart(3, "0")}`,
        block_type: blockType,
        source_ref: sourceRef,
        origin: segment.source,
        document_index: segment.documentIndex,
        document_type: segment.documentType,
        document_role: documentRole,
        content_role: contentRole,
        exhibit_number: unit.exhibitNumber,
        filename: segment.filename,
        url: segment.url,
        heading: unit.heading,
        sequence,
        text,
        char_count: text.length,
        is_table: unit.isTable,
        is_boilerplate: isBoilerplate,
      });
    }
  }

  return blocks;
}

type SourceUnit = {
  heading: string | null;
  text: string;
  isTable: boolean;
  contentRole: Sec425DocumentRole | null;
  exhibitNumber: string | null;
};

function splitSourceDocument(
  text: string,
  embeddedExhibitRoles: Map<string, Sec425DocumentRole>,
  defaultContentRole: Sec425DocumentRole | null,
): SourceUnit[] {
  const lines = compactText(text).split("\n");
  const units: SourceUnit[] = [];
  let heading: string | null = null;
  let contentRole: Sec425DocumentRole | null = defaultContentRole;
  let exhibitNumber: string | null = null;
  let currentLines: string[] = [];
  let tableLines: string[] = [];

  const flushText = (preserveHeading = false) => {
    const value = compactText(currentLines.join("\n"));
    if (value) {
      units.push({ heading, text: value, isTable: false, contentRole, exhibitNumber });
      if (!preserveHeading) heading = null;
    }
    currentLines = [];
  };
  const flushTable = (preserveHeading = false) => {
    const value = compactText(tableLines.join("\n"));
    if (value) {
      units.push({ heading, text: value, isTable: true, contentRole, exhibitNumber });
      if (!preserveHeading) heading = null;
    }
    tableLines = [];
  };

  for (const rawLine of lines) {
    const line = compactText(rawLine);
    if (!line) {
      flushTable(true);
      flushText(true);
      continue;
    }
    const exhibitBoundary = line.match(/^Exhibit\s+(\d+(?:\.\d+)?)$/i);
    if (exhibitBoundary) {
      flushTable();
      flushText();
      heading = line;
      exhibitNumber = exhibitBoundary[1];
      contentRole = embeddedExhibitRoles.get(exhibitNumber) || defaultRoleForExhibitNumber(exhibitNumber);
      continue;
    }
    const isTableLine = isSourceTableLine(line);
    if (isTableLine) {
      flushText();
      if (tableLines.join("\n").length + line.length > SOURCE_BLOCK_CHAR_LIMIT) flushTable(true);
      tableLines.push(line);
      continue;
    }
    flushTable();
    if (looksLikeSourceHeading(line)) {
      flushText();
      heading = line;
      continue;
    }
    if (currentLines.join("\n").length + line.length > SOURCE_BLOCK_CHAR_LIMIT) flushText(true);
    currentLines.push(line);
  }
  flushTable();
  flushText();

  if (!units.length && text) return [{ heading: null, text, isTable: false, contentRole: null, exhibitNumber: null }];
  return units;
}

function findEmbeddedExhibitRoles(text: string) {
  const roles = new Map<string, Sec425DocumentRole>();
  const value = compactText(text);
  const pattern = /\b(99\.\d+)\b[\s|:;,.()-]{0,80}\b(Offer Letter|Press Release|News Release|Investor Presentation|Joint Presentation|Transaction Presentation|Fact Sheet|Employee FAQ|Frequently Asked Questions|Transcript|Conference Call Transcript|Employee Communication)\b/gi;
  for (const match of value.matchAll(pattern)) {
    const role = documentRoleFromLabel(match[2]);
    if (role) roles.set(match[1], role);
  }
  return roles;
}

function documentRoleFromLabel(value: string): Sec425DocumentRole | null {
  if (/offer letter/i.test(value)) return "offer_letter";
  if (/(?:press|news) release/i.test(value)) return "press_release";
  if (/presentation/i.test(value)) return "investor_presentation";
  if (/fact sheet/i.test(value)) return "fact_sheet";
  if (/faq|frequently asked questions/i.test(value)) return "faq";
  if (/transcript/i.test(value)) return "transcript";
  if (/employee communication/i.test(value)) return "stakeholder_communication";
  return null;
}

function inferPrimaryContentRole(text: string): Sec425DocumentRole | null {
  const value = truncate(compactText(text), 4_000);
  if (
    /\b(?:GLOBE NEWSWIRE|BUSINESS WIRE|PR NEWSWIRE|for immediate release|press release|news release)\b/i.test(value) ||
    /\b[A-Z][A-Z .'-]{2,40},(?:\s+[A-Z][a-z.]{1,15},)?\s+(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+20\d{2})\s+[—-]/.test(value)
  ) return "press_release";
  if (/\b(?:transcript|prepared remarks|interview|podcast|town hall)\b/i.test(value)) return "transcript";
  if (
    /\b(?:investor presentation|joint presentation|transaction presentation)\b/i.test(value) ||
    (/\binvestor day\b/i.test(value) && /\bpresentation\b/i.test(value)) ||
    /\bpresentation\b[\s\S]{0,120}\bfiled in connection with\b/i.test(value) ||
    /\b(?:published|issued|made available)\b[\s\S]{0,80}\bfollowing presentation\b/i.test(value)
  ) {
    return "investor_presentation";
  }
  if (/\b(?:employee faq|frequently asked questions|questions and answers|\bFAQ\b)\b/i.test(value)) return "faq";
  if (hasTranscriptSpeakerPattern(value)) return "transcript";
  if (isEventNotice(value)) return "meeting_notice";
  if (/\b(?:social media|twitter|tweet|\bX post\b|linkedin|repost)\b/i.test(value)) return "social_media";
  return null;
}

function defaultRoleForExhibitNumber(exhibitNumber: string): Sec425DocumentRole | null {
  return /^2(?:\.|$)/.test(exhibitNumber) ? "transaction_agreement" : null;
}

function isSourceTableLine(line: string) {
  const pipes = (line.match(/\|/g) || []).length;
  if (pipes >= 1) return true;
  return /^(?:\$?[\d,.()% -]+\s{2,}){2,}/.test(line);
}

function looksLikeSourceHeading(line: string) {
  if (!line || line.length > 180) return false;
  if (/^Exhibit\s+\d+(?:\.\d+)?$/i.test(line)) return true;
  if (/^(?:Filed by|Subject Company|Commission File|Date|Pursuant to Rule 425)\b/i.test(line)) return false;
  if (/[.!?]$/.test(line)) return false;
  if (classifySectionHeading(line)) return true;
  if (/^(?:Q\.?|A\.?)\s+/i.test(line)) return false;
  if (/^(?:Operator|CEO|CFO|Chief Executive Officer|Chief Financial Officer|[A-Z][a-z]+\s+[A-Z][a-z]+):/.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 18) return false;
  const letters = line.replace(/[^A-Za-z]/g, "");
  const uppercase = line.replace(/[^A-Z]/g, "");
  if (letters.length >= 4 && uppercase.length / letters.length >= 0.75) return true;
  return /\b(?:Overview|Highlights|Transaction|Terms|Timeline|Rationale|Benefits|Questions|Employees|Customers|Shareholders|Stockholders|Meeting|Amendment|Agreement|Approval|Regulatory|Next Steps|Additional Information)\b/i.test(line);
}

function splitLongSourceText(text: string, maxChars: number) {
  const value = compactText(text);
  if (value.length <= maxChars) return [value];
  const sentences = value.split(/(?<=[.!?])\s+(?=[A-Z0-9(])/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) chunks.push(current);
      current = "";
      chunks.push(...splitAtWordBoundary(sentence, maxChars));
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitAtWordBoundary(text: string, maxChars: number) {
  const chunks: string[] = [];
  let remaining = compactText(text);
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const cut = Math.max(window.lastIndexOf(" "), maxChars - 400);
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function classifySourceBlockType(
  text: string,
  heading: string | null,
  documentRole: Sec425DocumentRole,
  isTable: boolean,
) {
  const value = `${heading || ""}\n${text}`;
  if (isSecCoverBlock(value) || looksLikeSourceFileHeader(value) || isSecViewerArtifact(value)) return "cover";
  if (isSourceTableOfContents(value)) return "table_of_contents";
  if (isTable) return "table";
  if (BOILERPLATE_HEADING_PATTERN.test(value) || isGenericBoilerplateParagraph(value)) return "legal_boilerplate";
  if (/^(?:Q\.?|Question\b)/im.test(value) && /(?:^|\n)(?:A\.?|Answer\b)/im.test(value)) return "question_answer";
  if (hasTranscriptSpeakerPattern(value)) return "transcript_turns";
  if (
    documentRole === "transaction_agreement" ||
    documentRole === "agreement_amendment" ||
    documentRole === "stockholder_agreement" ||
    documentRole === "employment_agreement"
  ) return "agreement_section";
  if (documentRole === "investor_presentation" || documentRole === "fact_sheet") return "presentation_section";
  if (documentRole === "press_release" || documentRole === "offer_letter") return "communication_section";
  if (documentRole === "faq") return "question_answer";
  if (documentRole === "transcript") return "transcript_turns";
  if (documentRole === "stakeholder_communication") return "stakeholder_message";
  if (documentRole === "meeting_notice") return "meeting_notice";
  if (documentRole === "regulatory_update") return "regulatory_update";
  if ((hasCoverIdentityLanguage(value) || looksLikeSourceFileHeader(value)) && !containsTransactionLanguage(value)) return "cover";
  return "paragraph";
}

function classifyContentRole(
  text: string,
  heading: string | null,
  documentRole: Sec425DocumentRole,
): Sec425DocumentRole {
  const value = `${heading || ""}\n${text}`;
  if (isSecCoverBlock(value)) return documentRole;
  if (/\b(?:copies? of|the foregoing)\b[\s\S]{0,500}\b(?:attached hereto|incorporated by reference|furnished pursuant to Item)\b/i.test(value)) {
    return documentRole;
  }
  if (
    documentRole === "transaction_agreement" ||
    documentRole === "agreement_amendment" ||
    documentRole === "stockholder_agreement" ||
    documentRole === "employment_agreement"
  ) {
    return documentRole;
  }
  if (/\b(?:fact sheet|transaction facts?|deal facts?)\b/i.test(value)) return "fact_sheet";
  if (/\b(?:offer letter|proposal letter|non-binding (?:offer|proposal|expression of interest)|public acquisition proposal)\b/i.test(value)) return "offer_letter";
  if (/\b(?:frequently asked questions|questions and answers|employee faq|\bFAQ\b)\b/i.test(value) || /(?:^|\n)\s*Q\s*&\s*A\s*(?:\n|$)/im.test(value)) return "faq";
  if (/\b(?:transcript|conference call transcript|prepared remarks|interview|podcast|town hall)\b/i.test(value) || hasTranscriptSpeakerPattern(value)) return "transcript";
  if (/\b(?:investor presentation|joint presentation|transaction presentation|investor day)\b/i.test(value) || /\bpresentation\b[\s\S]{0,120}\bfiled in connection with\b/i.test(value)) return "investor_presentation";
  if (/\b(?:agreement and plan of merger|business combination agreement|merger agreement)\b/i.test(value) && /\b(?:ARTICLE|SECTION|RECITALS|conditions to closing|representations and warranties)\b/i.test(value)) return "transaction_agreement";
  if (/\b(?:employee communication|dear (?:colleagues|employees|team members)|all employee)\b/i.test(value)) return "stakeholder_communication";
  if (
    isEventNotice(value) ||
    /\b(?:special meeting|record date|meeting date|adjourned|reconvened|reconvene|postponed|rescheduled|voting results?)\b/i.test(value)
  ) return "meeting_notice";
  if (
    /\b(?:received|obtained|secured|granted|completed)\b[\s\S]{0,80}\b(?:regulatory approval|antitrust clearance)\b/i.test(value) ||
    /\b(?:SEC\s+(?:declared|has declared)[\s\S]{0,80}\beffective|(?:filed|mailed)\s+(?:its\s+|the\s+)?definitive proxy|closing condition\s+(?:was|has been|is)\s+(?:satisfied|waived))\b/i.test(value)
  ) return "regulatory_update";
  if (/\b(?:social media|twitter|tweet|\bX post\b|linkedin|repost)\b/i.test(value)) return "social_media";
  if (
    /\b(?:for immediate release|business wire|globe newswire|pr newswire|press release|news release)\b/i.test(value) ||
    /\b[A-Z][A-Z .'-]{2,40},(?:\s+[A-Z][a-z.]{1,15},)?\s+(?:[A-Z][a-z]{2,8}\.?\s+\d{1,2},\s+20\d{2})\s+(?:--|[—–]|\?\?)/.test(value)
  ) return "press_release";
  return documentRole;
}

function isSourceTableOfContents(value: string) {
  const sectionRefs = (value.match(/\b(?:ARTICLE|Section)\s+[A-ZIVX\d.]+/gi) || []).length;
  const pageRefs = (value.match(/\|\s*\d{1,3}\s*(?:\||$)/gm) || []).length;
  return sectionRefs >= 5 || pageRefs >= 6;
}

function looksLikeSourceFileHeader(value: string) {
  return /^(?:###\s+)?425\b[\s\S]{0,100}\.(?:htm|html)\b/i.test(value) || /^(?:###\s+)?425\s+-\s+425\b/i.test(value);
}

function isSecViewerArtifact(value: string) {
  return /^\s*\d+\s*-\s*Document\s*-\s*Cover\b/i.test(value) || /\blink:(?:presentationLink|calculationLink|definitionLink)\b/i.test(value);
}

function selectRouterSourceBlocks(blocks: Sec425SourceBlock[]) {
  const selected: Sec425SourceBlock[] = [];
  const byDocument = new Map<string, Sec425SourceBlock[]>();
  for (const block of blocks) {
    const list = byDocument.get(block.source_ref) || [];
    list.push(block);
    byDocument.set(block.source_ref, list);
  }

  for (const documentBlocks of byDocument.values()) {
    const substantive = documentBlocks
      .filter((block) =>
        !block.is_boilerplate &&
        (block.block_type !== "cover" || hasMaterialCoverTail(block.text)) &&
        block.block_type !== "table_of_contents" &&
        (
          block.text.replace(/[^A-Za-z0-9]/g, "").length >= 40 ||
          (
            block.content_role !== "primary_425" &&
            block.content_role !== "other" &&
            block.text.replace(/[^A-Za-z0-9]/g, "").length >= 16
          )
        )
      )
      .sort((left, right) => routerBlockPriority(right) - routerBlockPriority(left) || left.sequence - right.sequence);
    const documentSelected: Sec425SourceBlock[] = [];

    const leadBlock = [...substantive]
      .sort((left, right) => left.sequence - right.sequence)
      .find((block) => isSubstantiveLeadBlock(block));
    if (leadBlock) documentSelected.push(leadBlock);

    const identityBlock = [...substantive]
      .sort((left, right) => left.sequence - right.sequence)
      .find((block) => isTransactionIdentityBlock(block.text));
    if (identityBlock && !documentSelected.some((block) => block.block_id === identityBlock.block_id)) {
      documentSelected.push(identityBlock);
    }

    const roles = new Set<Sec425DocumentRole>();
    for (const block of documentSelected) roles.add(block.content_role);
    for (const block of substantive) {
      if (documentSelected.some((selectedBlock) => selectedBlock.block_id === block.block_id)) continue;
      if (roles.has(block.content_role)) continue;
      documentSelected.push(block);
      roles.add(block.content_role);
      if (documentSelected.length >= ROUTER_BLOCKS_PER_DOCUMENT) break;
    }

    for (const block of substantive) {
      if (documentSelected.length >= ROUTER_BLOCKS_PER_DOCUMENT) break;
      if (documentSelected.some((selectedBlock) => selectedBlock.block_id === block.block_id)) continue;
      documentSelected.push(block);
    }
    selected.push(...documentSelected.map(toRouterSourceBlock));
  }

  return dedupeSourceBlocks(selected).slice(0, ROUTER_BLOCK_LIMIT);
}

function isSubstantiveLeadBlock(block: Sec425SourceBlock) {
  const text = compactText(block.text);
  if (block.block_type === "cover" || block.is_boilerplate) return false;
  if (looksLikeSourceFileHeader(text) || isSecViewerArtifact(text)) return false;
  if (text.length < 80) return false;
  return block.sequence <= 8 || /\b(?:announc(?:e|ed|es)|will provide|entered into|proposed|business combination|merger|acquisition|offer|transaction)\b/i.test(text);
}

function isTransactionIdentityBlock(text: string) {
  return /\b(?:issued|filed|furnished|prepared|published|posted)\s+in\s+connection\s+with\b[\s\S]{0,260}\b(?:business combination|merger|acquisition|transaction|tender offer|exchange offer)\b/i.test(text) ||
    /\b(?:previously announced|proposed|definitive)\b[\s\S]{0,220}\b(?:business combination|merger|acquisition|transaction|tender offer|exchange offer)\b/i.test(text) ||
    /\b(?:business combination|merger|acquisition|transaction|offer)\s+(?:between|with)\b[\s\S]{0,220}\b(?:Corp\.?|Inc\.?|Ltd\.?|plc|Company)\b/i.test(text);
}

function hasMaterialCoverTail(text: string) {
  return /\b(?:Explanatory Note|Item\s+\d+)\b[\s\S]{0,1500}\b(?:reposted|posted|shared|published|issued|interview|transcript|presentation|communication)\b/i.test(text);
}

function routerBlockPriority(block: Sec425SourceBlock) {
  let score = 0;
  if (block.content_role !== "primary_425" && block.content_role !== "other") score += 50;
  if (block.block_type === "cover" && hasMaterialCoverTail(block.text)) score += 70;
  if (block.heading) score += 12;
  if (/\b(?:transaction|deal|business combination|offer|proposal)\s+(?:overview|summary|terms?)\b/i.test(block.heading || "")) score += 35;
  if (
    block.content_role === "meeting_notice" &&
    /\b(?:will now be held|adjourned to|reconven(?:e|ed) on|new record date|new meeting date|rescheduled|postponed|changed from|distribution record date)\b/i.test(block.text)
  ) score += 45;
  if (block.block_type === "question_answer" || block.block_type === "transcript_turns") score += 10;
  if (block.block_type === "question_answer" && /(?:^|\n)\s*(?:Q\.?|Question\b)|\?/im.test(block.text)) score += 30;
  if (
    block.content_role === "faq" &&
    /\?|\b(?:what does this mean|employees?|team members?|day to day|job security|benefits?|compensation|stock options?|promotions?|workplace|manager)\b/i.test(block.text)
  ) score += 40;
  if (block.block_type === "transcript_turns" && hasTranscriptSpeakerPattern(block.text)) score += 30;
  if (block.block_type === "table") score += 4;
  if (block.text.length >= 180) score += 6;
  if (/\b(?:consideration|offer price|per share|transaction value|premium|exchange ratio|closing condition|termination fee|shareholder approval|stockholder approval|record date|meeting date|amendment|regulatory approval|business combination|merger|acquisition)\b/i.test(block.text)) score += 24;
  if (/\b(?:indicate by check mark|the foregoing information is furnished|attached hereto as exhibits?|incorporated by reference into this item|this document is not a substitute for|investors? and security holders? are urged to read)\b/i.test(block.text)) score -= 45;
  if (isProspectiveTransactionFilingNotice(block.text)) score -= 45;
  if (isForwardLookingRiskEnumeration(block.text)) score -= 55;
  if (/^(?:\d+|425|FORM 425|EXHIBIT)\b/i.test(block.text) && block.text.length < 120) score -= 30;
  return score;
}

function toRouterSourceBlock(block: Sec425SourceBlock): Sec425SourceBlock {
  const explanatoryNoteIndex = block.block_type === "cover" && hasMaterialCoverTail(block.text)
    ? block.text.search(/\b(?:Item\s+\d+\s+)?Explanatory Note\b/i)
    : -1;
  const sourceText = explanatoryNoteIndex >= 0 ? block.text.slice(explanatoryNoteIndex) : block.text;
  const text = truncateAtSentence(sourceText, ROUTER_BLOCK_CHAR_LIMIT);
  return { ...block, text, char_count: text.length };
}

function truncateAtSentence(text: string, maxChars: number) {
  const value = compactText(text);
  if (value.length <= maxChars) return value;
  const window = value.slice(0, maxChars + 1);
  const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
  const cut = sentenceEnd >= maxChars * 0.55 ? sentenceEnd + 1 : Math.max(window.lastIndexOf(" "), maxChars - 200);
  return `${value.slice(0, cut).trim()}...`;
}

function dedupeSourceBlocks(blocks: Sec425SourceBlock[]) {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    const key = `${block.source_ref}:${block.text.slice(0, 240)}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filenameFromUrl(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  try {
    const pathname = new URL(text).pathname;
    return nullableString(pathname.split("/").filter(Boolean).pop());
  } catch {
    return nullableString(text.split(/[\\/]/).filter(Boolean).pop());
  }
}

function buildRawDataFacts(segments: RawDocumentSegment[], sectionAnalysis: SectionAnalysis): Sec425RawDataFacts {
  const signalCandidates: Sec425RawDataCandidate[] = [];
  const noiseCandidates: Sec425RawDataCandidate[] = [];
  const tableRows: Sec425RawDataCandidate[] = [];

  for (const segment of segments) {
    if (!segment.text) continue;
    addHeaderCompanyCandidates(signalCandidates, noiseCandidates, segment);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "agreement_mention", /\b(?:Agreement and Plan of Merger|Merger Agreement|Business Combination Agreement|Transaction Agreement|definitive merger agreement)\b/gi, 8);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "deal_combination_phrase", /\b(?:agreement to combine|agreed to combine|all-stock merger|merger of equals|business combination|initial business combination|proposed acquisition of|acquisition of)\b[^.|\n]{0,220}/gi, 10);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "offer_mention", /\b(?:hostile exchange offer|public exchange offer|exchange offer|tender offer|offer to purchase|consent solicitation)\b/gi, 8);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "stock_consideration", /\b\d+(?:\.\d+)?\s+shares?\s+of\s+[A-Z][A-Za-z0-9&.,' -]{1,80}?(?:common stock|common shares|stock)\b/gi, 8);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "mixed_cash_stock_consideration", /\bmix of cash and [^.|\n]{0,120}?(?:common stock|shares|equity)\b/gi, 4);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "consideration_phrase", /\bconsideration\s+(?:of|will be|consists? of|to be issued)[^.|\n]{0,180}/gi, 6);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "money_mention", /\$\s?\d[\d,.]*(?:\s?(?:million|billion|trillion|m|bn))?/gi, 16);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "share_or_unit_count", /\b\d[\d,.]*(?:\.\d+)?\s*(?:million|billion|m|bn)?\s+(?:shares|units|Founder Shares|SPAC Class B Common Shares|New Viking common shares)\b/gi, 12);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "pipe_mention", /\b(?:PIPE\b|private investment in public equity|Subscription Agreement|Securities Purchase Agreement)[^.|\n]{0,220}/gi, 8);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "sponsor_transfer", /\bSponsor[^.|\n]{0,220}\btransfer[^.|\n]{0,180}/gi, 4);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "warrant_terms", /\bwarrants?[^.|\n]{0,180}\b(?:exercise price|\$11\.50|PIPE Warrants?|public warrants?)\b[^.|\n]{0,120}/gi, 6);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "warrant_mention", /\b(?:public warrants?|private placement warrants?|PIPE warrants?|warrant holders?|warrants?)[^.|\n]{0,220}/gi, 8);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "expected_ticker", /\b(?:under the ticker|ticker symbol)\s+["']?[A-Z][A-Z0-9.]{1,8}["']?\b/gi, 4);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "meeting_or_vote", /\b(?:record date|special meeting|shareholder meeting|stockholder meeting|vote results?|Votes For|Votes Against|Abstentions|quorum)\b/gi, 12);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "adjournment_polarity", /\b(?:not adjourned|No adjournment|adjourned|reconvened|reconvene)\b/gi, 8);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "expected_close", /\b(?:transaction|merger|business combination|acquisition)?\s*(?:is\s+|are\s+|currently\s+)?expected to (?:close|be completed|complete)[^.|\n]{0,180}/gi, 6);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "risk_relevant_deal_language", RISK_RELEVANT_LANGUAGE_PATTERN, 16);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "transaction_trigger", TRANSACTION_LANGUAGE_PATTERN, 24);
    addPatternCandidates(signalCandidates, noiseCandidates, segment, "projection_or_metric", /\b(?:projected|forecast|outlook|guidance|synerg(?:y|ies)|accretive|dilutive|adjusted EBITDA|revenue growth|pro forma|free cash flow)[^.|\n]{0,180}/gi, 12);
    addContextualDateCandidates(signalCandidates, noiseCandidates, segment);
    addTableRows(signalCandidates, noiseCandidates, tableRows, segment);
    addVoteTableCandidates(signalCandidates, noiseCandidates, tableRows, segment);
    addExplicitNoiseCandidates(noiseCandidates, segment);
  }

  return {
    signal_candidates: dedupeCandidates(signalCandidates).slice(0, 80),
    noise_candidates: dedupeCandidates(noiseCandidates).slice(0, 60),
    table_rows: dedupeCandidates(tableRows).slice(0, 40),
    sections: sectionAnalysis.sections,
    content_types: sectionAnalysis.contentTypes,
    candidate_text: sectionAnalysis.candidateText,
    parser_only_case: sectionAnalysis.parserOnlyCase,
    extraction_quality: sectionAnalysis.extractionQuality,
  };
}

function buildSectionAnalysis(segments: RawDocumentSegment[], documents: Sec425DocumentSummary[], title: string): SectionAnalysis {
  const sections = segments.flatMap((segment) => detectSections(segment)).slice(0, 40);
  const combinedText = compactText(segments.map((segment) => segment.text).filter(Boolean).join("\n\n"));
  const extractionQuality = readExtractionQuality(combinedText, documents);
  const contentTypes = classifyContentTypes(combinedText, sections, extractionQuality);
  const parserOnlyCase = readParserOnlyCase(combinedText, sections, contentTypes, extractionQuality);
  const candidateText = buildCandidateText(title, combinedText, sections);

  return {
    sections,
    contentTypes,
    candidateText,
    parserOnlyCase,
    extractionQuality,
  };
}

function detectSections(segment: RawDocumentSegment): Sec425SourceSection[] {
  if (!segment.text) return [];
  const lines = segment.text.split(/\n+/).map(compactText).filter(Boolean);
  const sections: Sec425SourceSection[] = [];
  let currentHeading: string | null = null;
  let currentType = "unknown";
  let currentLines: string[] = [];

  const flush = () => {
    const text = compactText(currentLines.join("\n"));
    if (!text && !currentHeading) return;
    const classifiedType = currentType === "unknown" || currentType === "cover" ? classifySectionText(text, currentHeading) : currentType;
    sections.push({
      section_type: classifiedType,
      heading: currentHeading,
      text: truncate(text || currentHeading || "", 1800),
      source: segment.source,
      document_type: segment.documentType,
      document_index: segment.documentIndex,
      contains_transaction_language: containsTransactionLanguage(`${currentHeading || ""}\n${text}`),
      contains_risk_relevant_language: containsRiskRelevantLanguage(`${currentHeading || ""}\n${text}`),
      is_boilerplate: classifiedType === "legal_boilerplate",
    });
  };

  for (const line of lines) {
    const headingType = classifySectionHeading(line);
    if (headingType) {
      flush();
      currentHeading = truncate(line, 160);
      currentType = headingType;
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }
  flush();

  if (!sections.length) {
    const text = truncate(segment.text, 1800);
    const sectionType = classifySectionText(text, null);
    sections.push({
      section_type: sectionType,
      heading: null,
      text,
      source: segment.source,
      document_type: segment.documentType,
      document_index: segment.documentIndex,
      contains_transaction_language: containsTransactionLanguage(text),
      contains_risk_relevant_language: containsRiskRelevantLanguage(text),
      is_boilerplate: sectionType === "legal_boilerplate",
    });
  }

  if (sections[0] && sections[0].section_type === "unknown" && hasCoverIdentityLanguage(sections[0].text)) {
    sections[0].section_type = "cover";
  }

  return sections;
}

function classifySectionHeading(line: string) {
  const heading = compactText(line);
  if (!heading || heading.length > 180) return null;
  if (BOILERPLATE_HEADING_PATTERN.test(heading)) return "legal_boilerplate";
  if (/\b(?:Press Release|News Release|For Immediate Release)\b/i.test(heading)) return "press_release";
  if (/\b(?:Investor Presentation|Presentation|Investor Day|Transaction Overview|Investment Highlights|Pro Forma|Financial Outlook|Projected Revenue|Adjusted EBITDA|Market Opportunity|Combined Company|Slide\s+\d+)\b/i.test(heading)) return "investor_presentation";
  if (/\b(?:Transcript|Conference Call|Webcast|Prepared Remarks|Question-and-Answer(?: Session)?|Q&A)\b/i.test(heading)) return "transcript";
  if (/\b(?:FAQ|Frequently Asked Questions|Questions and Answers|Q&A)\b/i.test(heading)) return "faq";
  if (/\b(?:Employee Communication|Customer Communication|Supplier Communication|Shareholder Communication|Stockholder Communication|Team Member Communication|Integration Communication|Letter to Employees|Letter to Customers|Letter to Suppliers|Letter to Shareholders|Letter to Stockholders)\b/i.test(heading)) {
    return "stakeholder_communication";
  }
  if (/^(?:Contacts?|Investor Relations|Media Relations|Media Contact|Investor Contact)s?$/i.test(heading)) return "contacts";
  if (/^SIGNATURES?$/i.test(heading)) return "signature";
  if (/^(?:UNITED STATES|SECURITIES AND EXCHANGE COMMISSION|FORM\s+8-K|FORM\s+425)$/i.test(heading)) return "cover";
  return null;
}

function classifySectionText(text: string, heading: string | null) {
  const value = `${heading || ""}\n${text}`;
  const headingType = heading ? classifySectionHeading(heading) : null;
  if (headingType && headingType !== "cover") return headingType;
  if (BOILERPLATE_HEADING_PATTERN.test(value) || isMostlyBoilerplate(value)) return "legal_boilerplate";
  if (/\b(?:For Immediate Release|Press Release|News Release)\b/i.test(value)) return "press_release";
  if (/\b(?:Investor Presentation|Slide\s+\d+|Transaction Overview|Investment Highlights|Pro Forma|Financial Outlook|Projected Revenue|Adjusted EBITDA|Market Opportunity|Combined Company)\b/i.test(value)) return "investor_presentation";
  if (/\b(?:Operator:|CEO:|CFO:|Conference Call|Webcast|Transcript|Prepared Remarks|Question-and-Answer(?: Session)?|Q&A)\b/i.test(value) || hasTranscriptSpeakerPattern(value)) return "transcript";
  if (/\b(?:FAQ|Frequently Asked Questions|Q:|A:|Q\.\s|A\.\s|Questions and Answers)\b/i.test(value)) return "faq";
  if (/\b(?:Dear (?:employees|customers|suppliers|shareholders|stockholders|team|team members|colleagues)|To:\s*All Employees|team member communication|customer communication|supplier communication|integration communication)\b/i.test(value)) return "stakeholder_communication";
  if (headingType === "cover" && !text) return "cover";
  if (hasCoverIdentityLanguage(value) && !containsTransactionLanguage(value)) return "cover";
  if (containsTransactionLanguage(value)) return "substantive_body";
  return "unknown";
}

function readExtractionQuality(text: string, documents: Sec425DocumentSummary[]): Sec425RawDataFacts["extraction_quality"] {
  const imageDocumentCount = documents.filter((document) => /graphic|image|\.jpe?g|\.png|\.gif/i.test(`${document.document_type || ""} ${document.description || ""}`)).length;
  const imageMarkerCount = (text.match(/\[(?:image|graphic):/gi) || []).length + imageDocumentCount;
  const pipeTableMarkerCount = (text.match(/\|/g) || []).length;
  const wordCount = (text.match(/\b[A-Za-z][A-Za-z0-9-]*\b/g) || []).length;
  const tableHeavyBrokenText = pipeTableMarkerCount >= 30 && wordCount < 250;
  const likelyExtractionFailure =
    !text ||
    (text.length < 700 && imageMarkerCount >= 3) ||
    (/\b(?:investor presentation|presentation)\b/i.test(text) && text.length < 1200 && imageMarkerCount >= 2) ||
    tableHeavyBrokenText;

  return {
    text_char_count: text.length,
    image_marker_count: imageMarkerCount,
    image_document_count: imageDocumentCount,
    pipe_table_marker_count: pipeTableMarkerCount,
    likely_extraction_failure: likelyExtractionFailure,
    table_heavy_broken_text: tableHeavyBrokenText,
  };
}

function classifyContentTypes(
  text: string,
  sections: Sec425SourceSection[],
  extractionQuality: Sec425RawDataFacts["extraction_quality"],
) {
  const types: string[] = [];
  const sectionTypes = new Set(sections.map((section) => section.section_type));
  const hasTransaction = containsTransactionLanguage(text);
  const hasRisk = containsRiskRelevantLanguage(text);

  if (isCoverOnlyText(text, sections)) types.push("cover-only");
  if (isBoilerplateOnlyText(text, sections)) types.push("boilerplate-only");
  if (sectionTypes.has("press_release") || /\b(?:For Immediate Release|Press Release|News Release)\b/i.test(text)) types.push("press release");
  if (sectionTypes.has("investor_presentation")) types.push("investor presentation");
  if (sectionTypes.has("transcript")) types.push("transcript / conference call");
  if (sectionTypes.has("faq")) types.push("FAQ");
  if (sectionTypes.has("stakeholder_communication")) types.push("employee / customer / shareholder communication");
  if (hasTransaction || hasRisk) types.push("deal update");
  if (extractionQuality.likely_extraction_failure) types.push("image-heavy / extraction failure");
  if (!types.length && text.length > 700) types.push("unknown substantive content");
  if (!types.length && hasCoverIdentityLanguage(text)) types.push("cover-only");
  if (!types.length) types.push("unknown substantive content");
  return uniqueStrings(types);
}

function readParserOnlyCase(
  text: string,
  sections: Sec425SourceSection[],
  contentTypes: string[],
  extractionQuality: Sec425RawDataFacts["extraction_quality"],
) {
  if (extractionQuality.likely_extraction_failure) return null;
  if (contentTypes.includes("cover-only") && isCoverOnlyText(text, sections)) return "cover_only_no_substantive_body";
  if (contentTypes.includes("boilerplate-only") && isBoilerplateOnlyText(text, sections)) return "boilerplate_only_no_deal_specific_language";
  return null;
}

function buildCandidateText(title: string, combinedText: string, sections: Sec425SourceSection[]) {
  const candidates: string[] = [];
  if (title) candidates.push(`Title: ${title}`);

  const firstSubstantive = sections.find((section) =>
    ["substantive_body", "press_release", "investor_presentation", "transcript", "faq", "stakeholder_communication", "unknown"].includes(section.section_type) &&
    !isLowValueParagraph(section.text),
  );
  if (firstSubstantive) candidates.push(formatCandidateSection(firstSubstantive));

  for (const section of sections) {
    const alwaysInclude = ["press_release", "investor_presentation", "transcript", "faq", "stakeholder_communication"].includes(section.section_type);
    const includeBoilerplate = section.is_boilerplate && section.contains_risk_relevant_language;
    if (alwaysInclude || includeBoilerplate) candidates.push(formatCandidateSection(section));
  }

  for (const paragraph of splitCandidateParagraphs(combinedText)) {
    if (isLowValueParagraph(paragraph)) continue;
    if (isGenericBoilerplateParagraph(paragraph) && !containsRiskRelevantLanguage(paragraph)) continue;
    if (containsTransactionLanguage(paragraph) || containsRiskRelevantLanguage(paragraph) || containsCandidateDetailLanguage(paragraph)) {
      candidates.push(paragraph);
    }
  }

  if (combinedText.length < 2500) {
    candidates.push(combinedText);
  }

  return truncate(uniqueStrings(candidates).join("\n\n"), 16000);
}

function formatCandidateSection(section: Sec425SourceSection) {
  const heading = section.heading ? `${section.heading}\n` : "";
  return truncate(`${heading}${section.text}`, 2600);
}

function splitCandidateParagraphs(text: string) {
  return compactText(text)
    .split(/\n{2,}|\n(?=[A-Z][A-Za-z ,/&-]{4,80}$)/)
    .map(compactText)
    .filter((paragraph) => paragraph.length >= 20);
}

function isLowValueParagraph(text: string) {
  const value = compactText(text);
  if (!value) return true;
  if (/^(?:page\s*)?\d+$/i.test(value)) return true;
  if (/^[|.\-_\s]+$/.test(value)) return true;
  if (/^\(?\d{3}\)?[-\s.]?\d{3}[-\s.]?\d{4}$/.test(value)) return true;
  return false;
}

function hasTranscriptSpeakerPattern(text: string) {
  const speakerLines = [...text.matchAll(/(?:^|\n)\s*(Operator|CEO|CFO|Chief Executive Officer|Chief Financial Officer|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s*:/g)]
    .map((match) => match[1])
    .filter((speaker) => !/^(?:Filed By|Subject Company|Commission File Number|Securities Act File Number|Date Filed)$/i.test(speaker));
  return speakerLines.length >= 2 && /\b(?:call|webcast|prepared remarks|question|answer|transaction|merger|business combination|acquisition)\b/i.test(text);
}

function isEventNotice(text: string) {
  return /\b(?:conference call|webcast|investor day)\b/i.test(text) &&
    /\b(?:will host|will hold|is scheduled|register|registration|event url|replay|dial-in|listen live|join us)\b/i.test(text) &&
    !/\b(?:transcript|prepared remarks|question-and-answer|Q&A)\b/i.test(text);
}

function isGenericBoilerplateParagraph(text: string) {
  return /\b(?:forward-looking statements?|safe harbor|does not constitute an offer|no offer or solicitation|not for release,? publication or distribution|this document is not a substitute for|investors? and security holders? are urged to read|additional\s+information\s+(?:about|and)\s+where\s+to\s+find\s+it|where\s+you\s+can\s+find\s+additional\s+information|participants\s+in\s+(?:the\s+)?solicitation)\b/i.test(text) || isProspectiveTransactionFilingNotice(text) || isForwardLookingRiskEnumeration(text);
}

function isProspectiveTransactionFilingNotice(text: string) {
  return /\b(?:intend(?:s)? to|may|will) file\b[\s\S]{0,220}\b(?:SEC|Securities and Exchange Commission)\b[\s\S]{0,900}\b(?:registration statement|proxy statement|prospectus|information statement|Schedule TO|Form F-4|Form S-4)\b/i.test(text) &&
    /\b(?:proposed transaction|business combination|merger|exchange offer)\b/i.test(text);
}

function isForwardLookingRiskEnumeration(text: string) {
  return (text.match(/\(\d{1,2}\)/g) || []).length >= 3 &&
    /\b(?:risks? related to|ability to|uncertaint(?:y|ies)|could adversely affect)\b/i.test(text);
}

function isSecCoverBlock(text: string) {
  const labels = text.match(/(?:^|\n)\s*(?:Filed by|Subject Company|Commission File Number|Securities Act File Number|Date Filed)\s*:?\s+/gim) || [];
  return labels.length >= 2 || (
    labels.length >= 1 &&
    /\b(?:Rule 425|Securities Act of 1933|Securities Exchange Act of 1934)\b/i.test(text)
  );
}

function isMostlyBoilerplate(text: string) {
  return isGenericBoilerplateParagraph(text) && !containsRiskRelevantLanguage(text);
}

function isCoverOnlyText(text: string, sections: Sec425SourceSection[]) {
  if (!hasCoverIdentityLanguage(text)) return false;
  if (containsTransactionLanguage(text) || containsRiskRelevantLanguage(text)) return false;
  const substantiveSections = sections.filter((section) => !["cover", "contacts", "signature"].includes(section.section_type) && section.text.length > 40);
  return substantiveSections.length === 0 && text.length < 5000;
}

function isBoilerplateOnlyText(text: string, sections: Sec425SourceSection[]) {
  if (!text || containsTransactionLanguage(text) || containsRiskRelevantLanguage(text)) return false;
  const meaningfulSections = sections.filter((section) => !["cover", "contacts", "signature"].includes(section.section_type));
  return meaningfulSections.length > 0 && meaningfulSections.every((section) => section.is_boilerplate || isMostlyBoilerplate(section.text));
}

function hasCoverIdentityLanguage(text: string) {
  return /\b(?:UNITED STATES\s+SECURITIES AND EXCHANGE COMMISSION|FORM\s+8-K|CURRENT REPORT|Exact name of registrant|Securities registered pursuant|Title of each class|Trading Symbol)\b/i.test(text);
}

function containsTransactionLanguage(text: string) {
  const withoutCoverRows = text.replace(
    /^.*\b(?:Securities registered pursuant|Title of each class|Trading Symbol|Name of each exchange on which registered|par value).*$/gim,
    " ",
  );
  return TRANSACTION_LANGUAGE_PATTERN.test(withoutCoverRows);
}

function containsRiskRelevantLanguage(text: string) {
  return RISK_RELEVANT_LANGUAGE_PATTERN.test(text);
}

function containsCandidateDetailLanguage(text: string) {
  return /(?:\b(?:price|per-share|per share|exchange ratio|premium\s+(?:to|of|over)|enterprise value|equity value|implied equity value|valuation|financing|PIPE|private investment in public equity|trust account|redemption|sponsor|ownership percentage|pro forma ownership|projected|forecast|outlook|guidance|synerg(?:y|ies)|accretive|dilutive|adjusted EBITDA|revenue growth|pro forma|free cash flow)\b|\b\d+(?:\.\d+)?%\s+premium\b)/i.test(text);
}

function addHeaderCompanyCandidates(
  signalCandidates: Sec425RawDataCandidate[],
  noiseCandidates: Sec425RawDataCandidate[],
  segment: RawDocumentSegment,
) {
  const headerPatterns: Array<[string, RegExp]> = [
    ["filed_by", /\bFiled by\s+([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}[A-Za-z0-9&.,'])?)(?=\s+pursuant to Rule 425|\s+Pursuant to Rule 425)/g],
    ["filed_by", /(?:^|\n|\|)\s*Filed by:?\s+([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}[A-Za-z0-9&.,'])?)(?=\s*(?:\||\n|\(|$|pursuant to|Pursuant to|Commission File|Subject Company))/gi],
    ["subject_company", /\bSubject Company:?\s*([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}[A-Za-z0-9&.,'])?)(?=\s+Commission File|\s+Date:|\s*$)/g],
    ["subject_company", /(?:^|\n|\|)\s*Subject Company:?\s*([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}[A-Za-z0-9&.,'])?)(?=\s*(?:\||\n|\(|$|Commission File|Filed by|pursuant to|Pursuant to))/gi],
  ];
  for (const [kind, pattern] of headerPatterns) {
    addPatternCandidates(signalCandidates, noiseCandidates, segment, kind, pattern, 4, (match) => cleanHeaderCompanyValue(match[1] || match[0]));
  }
}

function cleanHeaderCompanyValue(value: string) {
  return compactText(value)
    .replace(/\s+(?:pursuant to|Pursuant to|Commission File|Filed by|Subject Company)\b[\s\S]*$/i, "")
    .replace(/\s+with the (?:U\.S\.\s+)?Securities and Exchange Commission\b[\s\S]*$/i, "")
    .replace(/\s+with the SEC\b[\s\S]*$/i, "")
    .replace(/[.:;,|-]+$/g, "")
    .trim();
}

function addPatternCandidates(
  signalCandidates: Sec425RawDataCandidate[],
  noiseCandidates: Sec425RawDataCandidate[],
  segment: RawDocumentSegment,
  kind: string,
  pattern: RegExp,
  limit: number,
  readValue: (match: RegExpExecArray) => string = (match) => match[0],
) {
  const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = regex.exec(segment.text)) !== null && count < limit) {
    count += 1;
    const context = pickEvidenceWindow(segment.text, match.index || 0);
    const value = compactText(readValue(match));
    if (!value) continue;
    pushRawCandidate(signalCandidates, noiseCandidates, {
      kind,
      value,
      context,
      source: segment.source,
      document_type: segment.documentType,
      document_index: segment.documentIndex,
      is_table: /\|/.test(context),
      noise_hint: readNoiseHint(kind, context),
    });
  }
}

function addContextualDateCandidates(
  signalCandidates: Sec425RawDataCandidate[],
  noiseCandidates: Sec425RawDataCandidate[],
  segment: RawDocumentSegment,
) {
  const datePattern = /\b(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/gi;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = datePattern.exec(segment.text)) !== null && count < 12) {
    const context = pickEvidenceWindow(segment.text, match.index || 0);
    if (!/\b(?:record date|special meeting|shareholder meeting|stockholder meeting|expected to close|close|adjourn|reconvene|filed|dated|agreement)\b/i.test(context)) {
      continue;
    }
    count += 1;
    pushRawCandidate(signalCandidates, noiseCandidates, {
      kind: "date_mention",
      value: compactText(match[0]),
      context,
      source: segment.source,
      document_type: segment.documentType,
      document_index: segment.documentIndex,
      is_table: /\|/.test(context),
      noise_hint: readNoiseHint("date_mention", context),
    });
  }
}

function addTableRows(
  signalCandidates: Sec425RawDataCandidate[],
  noiseCandidates: Sec425RawDataCandidate[],
  tableRows: Sec425RawDataCandidate[],
  segment: RawDocumentSegment,
) {
  const rows = segment.text.split(/\n+/).map(compactText).filter(Boolean);
  for (const row of rows) {
    const pipeCount = (row.match(/\|/g) || []).length;
    if (pipeCount < 1) continue;
    if (!/\b(?:Votes For|Votes Against|Abstentions|PIPE\b|Warrant|Sponsor|Founder Shares|consideration|exchange ratio|transaction value|enterprise value|equity value|premium|earnout|redemption|valuation|ownership percentage|pro forma ownership|record date|special meeting|extraordinary general meeting|expected to (?:close|be completed|complete)|projected|forecast|outlook|guidance|synerg(?:y|ies)|accretive|dilutive|adjusted EBITDA|revenue growth|pro forma|free cash flow|\$\s?\d|shares?|units?)\b/i.test(row)) {
      continue;
    }
    const noiseHint = readNoiseHint("table_row", row);
    const candidate: Sec425RawDataCandidate = {
      kind: "table_row",
      value: truncate(row, 120),
      context: truncate(row, 420),
      source: segment.source,
      document_type: segment.documentType,
      document_index: segment.documentIndex,
      is_table: true,
      noise_hint: noiseHint,
    };
    if (!noiseHint) tableRows.push(candidate);
    pushRawCandidate(signalCandidates, noiseCandidates, candidate);
  }
}

function addVoteTableCandidates(
  signalCandidates: Sec425RawDataCandidate[],
  noiseCandidates: Sec425RawDataCandidate[],
  tableRows: Sec425RawDataCandidate[],
  segment: RawDocumentSegment,
) {
  const pattern =
    /\bVotes\s+For\b[\s\S]{0,140}?\bVotes\s+Against\b[\s\S]{0,140}?\bAbstentions\b[\s\S]{0,220}?(\d[\d,]*)[\s\S]{0,60}?(\d[\d,]*)[\s\S]{0,60}?(\d[\d,]*)/gi;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = pattern.exec(segment.text)) !== null && count < 12) {
    count += 1;
    const context = truncate(compactText(match[0]), 420);
    const candidate: Sec425RawDataCandidate = {
      kind: "vote_table_row",
      value: `${match[1]} ${match[2]} ${match[3]}`,
      context,
      source: segment.source,
      document_type: segment.documentType,
      document_index: segment.documentIndex,
      is_table: true,
      noise_hint: readNoiseHint("vote_table_row", context),
    };
    tableRows.push(candidate);
    pushRawCandidate(signalCandidates, noiseCandidates, candidate);
  }
}

function addExplicitNoiseCandidates(noiseCandidates: Sec425RawDataCandidate[], segment: RawDocumentSegment) {
  const noisePatterns: Array<[string, RegExp]> = [
    ["cover_securities_table", /\b(?:Securities registered pursuant|Title of each class|Trading Symbol|par value)\b/gi],
    ["safe_harbor_boilerplate", /\b(?:forward-looking statements?|safe harbor|Private Securities Litigation Reform Act)\b/gi],
    ["solicitation_boilerplate", /\b(?:participants in (?:the )?solicitation|may be deemed to be participants|solicitation of proxies)\b/gi],
    ["no_offer_boilerplate", /\b(?:does not constitute an offer|no offer or solicitation)\b/gi],
    ["fee_or_expense_context", /\b(?:reimburse(?:ment)?|expenses? up to|fee equal to)\b/gi],
    ["credit_facility_context", /\b(?:equity line of credit|credit facility|headline capacity)\b/gi],
  ];
  for (const [kind, pattern] of noisePatterns) {
    addPatternCandidates(noiseCandidates, noiseCandidates, segment, kind, pattern, 4, (match) => match[0]);
  }
}

function pushRawCandidate(
  signalCandidates: Sec425RawDataCandidate[],
  noiseCandidates: Sec425RawDataCandidate[],
  candidate: Sec425RawDataCandidate,
) {
  if (candidate.noise_hint) noiseCandidates.push(candidate);
  else signalCandidates.push(candidate);
}

function readNoiseHint(kind: string, context: string) {
  if (/\b(?:Securities registered pursuant|Title of each class|Trading Symbol|par value)\b/i.test(context)) return "cover_securities_table";
  if (containsRiskRelevantLanguage(context)) return null;
  if (/\b(?:forward-looking statements?|safe harbor|Private Securities Litigation Reform Act)\b/i.test(context)) return "safe_harbor_boilerplate";
  if (/\b(?:participants in (?:the )?solicitation|may be deemed to be participants|solicitation of proxies)\b/i.test(context)) return "solicitation_boilerplate";
  if (/\b(?:does not constitute an offer|no offer or solicitation)\b/i.test(context)) return "no_offer_boilerplate";
  if (/\b(?:reimburse(?:ment)?|expenses? up to|fee equal to)\b/i.test(context)) return "fee_or_expense_context";
  if (/\b(?:equity line of credit|credit facility|headline capacity)\b/i.test(context)) return "credit_facility_context";
  if (kind === "pipe_mention" && /\bpipeline\b/i.test(context) && !/\bPIPE\b/.test(context)) return "pipeline_not_pipe_financing";
  if (kind === "money_mention" && /\b(?:exercise price|warrant exercisable)\b/i.test(context)) return null;
  return null;
}

function dedupeCandidates(candidates: Sec425RawDataCandidate[]) {
  const seen = new Set<string>();
  const unique: Sec425RawDataCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.value}:${candidate.context.slice(0, 120)}:${candidate.noise_hint || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function findCommunicationTypes(text: string) {
  const candidates: Array<[string, RegExp]> = [
    ["press_release", /\bpress release\b/i],
    ["investor_presentation", /\binvestor presentation\b|\bpresentation\b/i],
    ["investor_day_notice", /\binvestor day\b/i],
    ["shareholder_letter", /\bletter to (?:stockholders|shareholders)\b|\bdear (?:stockholder|shareholder)s?\b/i],
    ["employee_letter", /\ball employee letter\b|\bemployee letter\b|\bteam member communication\b|\bto:\s*all employees\b|\bdear (?:team|team members|colleagues?|employees)\b/i],
    ["stakeholder_communication", /\b(?:customer|supplier|integration) communication\b|\bdear (?:customers|suppliers|shareholders|stockholders)\b/i],
    ["employee_faq", /\bemployee faq\b|\bfaq\b|\bquestions and answers\b|\bQ&A\b|\bQ\.\s|\bA\.\s/i],
    ["transcript", /\btranscript\b|\bconference call\b|\bwebcast\b|\bprepared remarks\b|\bquestion-and-answer(?: session)?\b|\btown hall\b/i],
    ["proxy_solicitation", /\bsoliciting proxies\b|\bsolicitation of proxies\b|\bproxy statement\b/i],
    ["vote_results", /\bsubmission of matters to a vote of security holders\b|\bvote results\b|\bvotes for\b/i],
    ["meeting_adjournment", /\badjourned\b|\breconvened\b/i],
    ["supplemental_disclosure", /\bsupplemental disclosure\b|\bsupplemental disclosures\b/i],
    ["tender_or_exchange_offer", /\btender offer\b|\bexchange offer\b|\bSchedule TO\b|\bconsent solicitation\b/i],
    ["agreement_filing", /\b(?:merger agreement|business combination agreement|transaction agreement|de-SPAC|deSPAC)\b/i],
    ["website_or_social_media", /\bwebsite\b|\bsocial media\b|\btweet\b|\blinkedin\b/i],
  ];
  return candidates.filter(([, pattern]) => pattern.test(text)).map(([value]) => value);
}

function findTransactionParties(text: string, companyName: string | null, subjectCompany: string | null) {
  const parties: string[] = [];
  if (companyName) parties.push(companyName);
  if (subjectCompany) parties.push(subjectCompany);

  const filedBy = readFiledByCompany(text);
  if (filedBy) parties.push(cleanCompanyName(filedBy));

  const between = text.match(/\b(?:merger agreement|business combination agreement|transaction agreement)\s+(?:by and )?(?:among|between)\s+(.{20,220}?)(?:\.|\n)/i)?.[1];
  if (between) {
    for (const part of between.split(/\s+(?:and|, and)\s+|,\s+/i)) {
      const cleaned = cleanCompanyName(part);
      if (looksLikeCompany(cleaned)) parties.push(cleaned);
    }
  }

  const acquireTarget = text.match(/\b(?:acquire|acquisition of|combine with|merge with)\s+([A-Z][A-Za-z0-9&.,' -]+?)(?:\s+in\b|\s+for\b|\s+and\b|\.|,|\n)/i)?.[1];
  if (acquireTarget) parties.push(cleanCompanyName(acquireTarget));

  return uniqueStrings(parties).slice(0, 6);
}

function findDealFacts(text: string, parties: string[]): Sec425DealFacts {
  const transactionType = readFirstField(text, [
    ["merger", /\bmerger\b|\bmerge\b/i],
    ["acquisition", /\bacquisition\b|\bacquire\b/i],
    ["business_combination", /\bbusiness combination\b|\bde-SPAC\b|\bdeSPAC\b|\bcombine\b|\bcombined company\b/i],
    ["tender_offer", /\btender offer\b|\boffer to purchase\b/i],
    ["exchange_offer", /\bexchange offer\b/i],
  ])?.value || null;
  const status = readFirstField(text, [
    ["announced", /\bannounced\b|\bentered into\b/i],
    ["pending", /\bpending\b|\bproposed\b/i],
    ["delayed", /\bdelay\b|\bdelayed\b|\bpostponed\b/i],
    ["terminated", /\bterminated\b|\btermination\b/i],
    ["completed", /\bcompleted\b|\bclosed\b/i],
  ])?.value || null;
  const considerationEvidence = findConsiderationEvidence(text);
  const exchangeRatio = text.match(/\b(\d+(?:\.\d+)?)\s+(?:shares?|common shares?)\s+of\s+[A-Z][A-Za-z0-9&.,' -]+?(?:common stock|common shares|stock)\b/i)?.[1] || null;
  const cashComponent = findCashComponent(text);
  const stockComponent = exchangeRatio ? `${exchangeRatio} share exchange ratio` : null;
  const transactionValue = text.match(/\b(?:approximately|about)?\s*(\$[\d,.]+\s*(?:million|billion|m|bn))\b/i)?.[1] || null;
  const premium = text.match(/\b(\d+(?:\.\d+)?%\s+premium|premium\s+of\s+\d+(?:\.\d+)?%)\b/i)?.[1] || null;
  const expectedClose = text.match(/\bexpected to close\s+(?:in|during|by)\s+([^.;\n]+)/i)?.[1]?.trim() || null;
  const evidence = uniqueStrings([
    considerationEvidence,
    findSentence(text, /\b(?:merger agreement|business combination agreement|transaction agreement|definitive agreement)\b/i),
    findSentence(text, /\bexpected to close\b/i),
  ].filter(Boolean) as string[]);

  return {
    transaction_type: transactionType,
    transaction_status: status,
    parties,
    consideration_text: considerationEvidence,
    cash_component: cashComponent,
    stock_component: stockComponent,
    exchange_ratio: exchangeRatio,
    transaction_value: transactionValue,
    premium,
    expected_close: expectedClose,
    evidence,
  };
}

function findConsiderationEvidence(text: string) {
  const patterns = [
    /\bconsideration\b.{0,180}\b(?:cash|stock|shares|exchange ratio|per share|will receive|consists?|converted|payable)\b/i,
    /\b(?:will receive|entitled to receive|converted into the right to receive)\b.{0,180}\b(?:cash|shares|stock|per share)\b/i,
    /\bmix of cash and [^.|\n]{0,160}?(?:common stock|shares|equity)\b/i,
    /\bmixed cash and stock consideration\b[^.|\n]{0,160}/i,
    /\b(?:all-stock|all-cash)\s+(?:transaction|deal|merger|acquisition)\b[^.|\n]{0,160}/i,
    /\bexchange ratio\b.{0,120}\b\d+(?:\.\d+)?\b/i,
    /\b\d+(?:\.\d+)?\s+(?:shares?|common shares?)\s+of\s+[A-Z][A-Za-z0-9&.,' -]+?(?:common stock|common shares|stock)\b/i,
    /\$[\d,.]+\s+(?:in cash|cash per share|per share in cash)\b/i,
  ];

  for (const pattern of patterns) {
    const sentence = findSentence(text, pattern);
    if (sentence && !isCoverSecurityNoise(sentence) && !isNoteBoilerplateSentence(sentence)) return sentence;
  }
  return null;
}

function findCashComponent(text: string) {
  const matches = text.matchAll(/\$[\d,.]+\s*(?:in cash|cash per share|per share in cash)\b/gi);
  for (const match of matches) {
    const context = pickEvidenceWindow(text, match.index || 0);
    if (!isCoverSecurityNoise(context) && !isNoteBoilerplateSentence(context)) return match[0];
  }
  return null;
}

function findAmendmentFacts(text: string, documents: Sec425DocumentSummary[]): Sec425AmendmentFacts {
  const amendmentDocument = documents.find((document) => /\bamendment\b/i.test(`${document.description || ""} ${document.document_type || ""}`));
  const amendmentSentence = findSentence(text, /\b(?:first|second|third|fourth)?\s*amendment\b.{0,160}\b(?:merger|business combination|transaction|agreement)\b/i);
  const amendmentTitle =
    amendmentDocument?.description ||
    text.match(/\b((?:First|Second|Third|Fourth)?\s*Amendment\s+to\s+(?:Agreement and Plan of Merger|Business Combination Agreement|Transaction Agreement)[^.\n]*)/i)?.[1]?.trim() ||
    null;
  const amendmentNumber = readAmendmentNumber(amendmentTitle || amendmentSentence || "");
  const amendmentDate = readDateNear(text, /\b(?:first|second|third|fourth)?\s*amendment\b/i);
  const originalAgreementDate =
    text.match(/\b(?:Merger Agreement|Business Combination Agreement|Transaction Agreement),?\s+dated\s+(?:as\s+of\s+)?([^,.;\n]+?\s+\d{1,2},\s+20\d{2})/i)?.[1] ||
    null;
  const amendedSections = findSentences(text, /\b(?:amended and restated|amended|restated|deleted and replaced|modified)\b.{0,120}\b(?:Section|Article|Agreement|Put Rights|Purchase Rights|consideration|deadline)\b/i, 6);
  const unchangedRemainderLanguage = findSentence(text, /\bexcept as (?:provided|set forth) herein\b.{0,180}\b(?:remain|remains|full force and effect|not otherwise modified)\b/i);
  const evidence = uniqueStrings([amendmentSentence, amendmentTitle, unchangedRemainderLanguage, ...amendedSections].filter(Boolean) as string[]);

  return {
    is_amendment_or_follow_up: Boolean(amendmentDocument || amendmentSentence || amendedSections.length || unchangedRemainderLanguage),
    amendment_number: amendmentNumber,
    amendment_title: amendmentTitle,
    amendment_date: amendmentDate,
    original_agreement_date: originalAgreementDate,
    amended_sections: amendedSections,
    unchanged_remainder_language: unchangedRemainderLanguage,
    evidence,
  };
}

function findVoteFacts(text: string): Sec425VoteFacts {
  const meetingSentence = findSentence(text, /\bspecial meeting\b|\bshareholder meeting\b|\bstockholder meeting\b|\bextraordinary general meeting\b/i);
  const meetingDate = meetingSentence
    ? readDateFromText(meetingSentence) || readDateNear(text, /\bspecial meeting\b|\bshareholder meeting\b|\bstockholder meeting\b|\bextraordinary general meeting\b/i)
    : readDateNear(text, /\bspecial meeting\b|\bshareholder meeting\b|\bstockholder meeting\b|\bextraordinary general meeting\b/i);
  const recordSentence = findSentence(text, /\brecord date\b|\brecord as of\b|\bof record as of\b/i);
  const recordDate = recordSentence ? readDateFromText(recordSentence) : null;
  const reconvenedSentence = findSentence(text, /\breconvened\b|\badjourned\s+(?:the\s+)?meeting\s+until\b|\badjourned\s+to\b/i);
  const reconvenedDate = reconvenedSentence
    ? readDateFromText(reconvenedSentence) || readDateNear(text, /\breconvened\b|\badjourned\s+(?:the\s+)?meeting\s+until\b|\badjourned\s+to\b/i)
    : readDateNear(text, /\breconvened\b|\badjourned\s+(?:the\s+)?meeting\s+until\b|\badjourned\s+to\b/i);
  const recommendationSentence = findSentence(text, /\b(?:board|directors)\b.{0,160}?\b(?:recommend|recommends|recommended)\b.{0,80}?\b(?:FOR|against)\b/i);
  const voteRecommendation = /\bagainst\b/i.test(recommendationSentence || "")
    ? "against"
    : /\bfor\b/i.test(recommendationSentence || "")
      ? "for"
      : null;
  const solicitationPresent = /\bsoliciting proxies\b|\bsolicitation of proxies\b|\bproxy statement\b|\bprospectus\b|\bshareholder vote\b|\bstockholder vote\b|\bvote\s+(?:FOR|AGAINST)\b|\bencourage.{0,80}\bvote\b/i.test(text);
  const adjourned = /\badjourned\b/i.test(text);
  const noVoteConducted = /\b(?:no voting results|no official tabulation|before any matters were voted|before any business being conducted|polls were never opened)\b/i.test(text);
  const quorum = findSentence(text, /\bquorum\b|\bshares?.{0,120}\brepresented\b/i);
  const votingThreshold = findSentence(text, /\b(?:majority of outstanding|majority of votes cast|required threshold|higher voting threshold|required proposal)\b/i);
  const voteResults = findVoteResults(text);
  const evidence = uniqueStrings([
    meetingSentence,
    recordSentence,
    reconvenedSentence,
    recommendationSentence,
    quorum,
    votingThreshold,
    findSentence(text, /\bsolicitation of proxies\b|\bsoliciting proxies\b/i),
    ...voteResults.map((result) => result.evidence),
  ].filter(Boolean) as string[]);

  return {
    meeting_date: meetingDate,
    record_date: recordDate,
    reconvened_date: reconvenedDate,
    vote_recommendation: voteRecommendation,
    solicitation_present: solicitationPresent,
    adjourned,
    no_vote_conducted: noVoteConducted,
    quorum,
    voting_threshold: votingThreshold,
    vote_results: voteResults,
    evidence,
  };
}

function findOfferFacts(text: string, subjectCompany: string | null): Sec425OfferFacts {
  const offerType = /\bpublic exchange offers?\b/i.test(text)
    ? "public_exchange_offer"
    : /\bexchange offer\b/i.test(text)
      ? "exchange_offer"
      : /\btender offer\b|\boffer to purchase\b/i.test(text)
        ? "tender_offer"
        : null;
  const isHostileOrUnsolicited = /\bhostile\b|\bunsolicited\b|\bnot been approved\b|\bcommence a hostile\b/i.test(text);
  const consideration = findSentence(text, /\b(?:mix of cash|cash and (?:stock|shares)|common stock|notes|unsecured public notes|consent solicitation|exchange offers?)\b/i);
  const scheduleToReference = /\bSchedule TO\b/i.test(text);
  const formS4Reference = /\bForm S-4\b|\bRegistration Statement on Form S-4\b/i.test(text);
  const consentSolicitation = /\bconsent solicitations?\b/i.test(text);
  const evidence = uniqueStrings([
    findSentence(text, /\b(?:tender offer|exchange offer|public exchange offers?|offer to purchase)\b/i),
    consideration,
    findSentence(text, /\bSchedule TO\b|\bForm S-4\b|\bconsent solicitations?\b/i),
  ].filter(Boolean) as string[]);

  return {
    offer_type: offerType,
    is_hostile_or_unsolicited: isHostileOrUnsolicited,
    subject_company: subjectCompany,
    consideration,
    schedule_to_reference: scheduleToReference,
    form_s4_reference: formS4Reference,
    consent_solicitation: consentSolicitation,
    evidence,
  };
}

function findSpacFacts(text: string, parties: string[], companyName: string | null): Sec425SpacFacts {
  const isSpac = /\bSPAC\b|\bde-SPAC\b|\bdeSPAC\b|\bspecial purpose acquisition company\b|\bbusiness combination\b|\btrust account\b|\bredemption requests?\b/i.test(text);
  const targetName =
    text.match(/\bbetween\s+([A-Z][A-Za-z0-9&.,' -]+?)\s+(?:and|with)\s+([A-Z][A-Za-z0-9&.,' -]+?)(?:\.|,|\n)/i)?.[2]?.trim() ||
    text.match(/\bwith\s+([A-Z][A-Za-z0-9&.,' -]+?)\s+(?:\(|,|\bto become\b|\bfor\b)/i)?.[1]?.trim() ||
    null;
  const combinedCompanyName = text.match(/\bcombined company(?:\s+will be|\s+is expected to be|\s+will be renamed)?\s+([A-Z][A-Za-z0-9&.,' -]+?)(?:\.|,|\sand\b|\sunder\b|\n)/i)?.[1]?.trim() || null;
  const expectedTicker = text.match(/\b(?:under\s+the\s+ticker|ticker symbol)\s+["“]?([A-Z][A-Z0-9.]{1,8})["”]?\b/i)?.[1] || null;
  const preMoneyValuation = text.match(/\b(?:pre-money valuation|Company valuation)\s+(?:of\s+|is\s+|based on\s+)?(\$[\d,.]+\s*(?:million|billion|m|bn))/i)?.[1] || null;
  const pipeAmount = text.match(/\b(?:PIPE|private placement)[^.\n]{0,160}?(\$[\d,.]+\s*(?:million|billion|m|bn))/i)?.[1] || null;
  const trustCash = text.match(/\b(?:trust account|cash held in trust|remaining cash in trust)[^.\n]{0,160}?(\$[\d,.]+\s*(?:million|billion|m|bn))/i)?.[1] || null;
  const earnoutShares = text.match(/\b(up to\s+)?(\d[\d,.]*\s*(?:million|m)?\s+(?:New\s+Viking\s+)?(?:common\s+)?shares?[^.\n]{0,80}earnout|earnout shares?[^.\n]{0,100}\d[\d,.]*\s*(?:million|m)?\s+shares?)/i)?.[0] || null;
  const warrantTerms = findSentence(text, /\bwarrants?\b.{0,160}\b(?:\$11\.50|exercise price|public warrants?|PIPE warrants?)\b/i);
  const sponsorTransfer = findSentence(text, /\bsponsor\b.{0,180}\btransfer\b.{0,120}\bshares?\b/i);
  const redemptionRisk = findSentence(text, /\bredemption requests?\b|\bredeem\b.{0,120}\bpublic shares?\b/i);
  const evidence = uniqueStrings([
    findSentence(text, /\bbusiness combination agreement\b|\bproposed business combination\b|\bde-SPAC\b|\bdeSPAC\b/i),
    findSentence(text, /\bpre-money valuation\b|\bCompany valuation\b/i),
    findSentence(text, /\bPIPE\b/i),
    findSentence(text, /\btrust account\b|\bredemption requests?\b/i),
  ].filter(Boolean) as string[]);

  return {
    is_spac_business_combination: isSpac,
    spac_name: isSpac ? parties.find((party) => /\b(?:Acquisition|Capital|SPAC|Corp\.? I|Corp\.? II|Corp\.? IV)\b/i.test(party)) || companyName : null,
    target_name: targetName,
    combined_company_name: combinedCompanyName,
    expected_ticker: expectedTicker,
    pre_money_valuation: preMoneyValuation,
    pipe_amount: pipeAmount,
    trust_cash: trustCash,
    earnout_shares: earnoutShares,
    warrant_terms: warrantTerms,
    sponsor_transfer: sponsorTransfer,
    redemption_risk: redemptionRisk,
    evidence,
  };
}

function findLegalFacts(text: string): Sec425LegalFacts {
  const litigation = findSentences(text, /\b(?:litigation|lawsuit|complaint|settlement|claims?|plaintiff|class action)\b/i, 8)
    .filter(isInvestorLegalRiskSentence)
    .slice(0, 4);
  const regulatory = findSentences(text, /\b(?:FTC|DOJ|antitrust|HSR Act|Hart-Scott-Rodino|regulatory approval|second request)\b/i, 4);
  const injunction = findSentences(
    text,
    /\b(?:injunction|enjoin|restraining order|hearing)\b|\bdelay(?:ed)?\b.{0,100}\b(?:closing|transaction|merger|business combination|vote|approval)\b|\b(?:closing|transaction|merger|business combination|vote|approval)\b.{0,100}\bdelay(?:ed)?\b/i,
    8,
  ).filter(isInvestorLegalRiskSentence).slice(0, 4);
  return {
    litigation_or_claims: litigation,
    regulatory_risk: regulatory,
    injunction_or_delay_risk: injunction,
  };
}

function isInvestorLegalRiskSentence(sentence: string) {
  if (isNoteBoilerplateSentence(sentence)) return false;
  if (/\bclaims?\b/i.test(sentence) && /\b(?:Trust Account|Public Distributions|Released Claims|this Note|Maker|Payee|contract, tort, equity)\b/i.test(sentence)) {
    return false;
  }
  if (/\b(?:governing law|jurisdiction|venue|waive any objection|jury trial|arising out of or relating to this Note|No failure or delay by a party)\b/i.test(sentence)) {
    return false;
  }
  return true;
}

function isCoverSecurityNoise(text: string) {
  return /\b(?:Securities registered pursuant|Title of each class|Trading Symbol|Name of each exchange|par value)\b/i.test(text);
}

function isNoteBoilerplateSentence(sentence: string) {
  return /\b(?:Maker|Payee|this Note|Target Extension Note|promissory note)\b/i.test(sentence) &&
    /\b(?:governing law|jurisdiction|venue|waive|legal suit|action or proceeding|No failure or delay|par value)\b/i.test(sentence);
}

function findFinancingFacts(text: string): Sec425FinancingFacts {
  const financingRisk = findSentences(text, /\b(?:financing condition|debt financing|financing commitments?|cash condition|funding|financing may not be available)\b/i, 4);
  const goingConcern = findSentences(text, /\b(?:going concern|liquidity|cash runway|substantial doubt|need to raise additional capital|unable to continue)\b/i, 4);
  const financingCondition = findSentence(text, /\bfinancing condition\b|\bdebt financing\b|\bcash condition\b/i);
  return {
    financing_risk: financingRisk,
    financing_condition: financingCondition,
    going_concern_or_liquidity_risk: goingConcern,
  };
}

function hasNoNewMaterialInfo(text: string) {
  const signals = [
    /\bno new material information\b/i,
    /\bdoes not (?:modify|amend|change)\b/i,
    /\bno change to (?:the )?(?:consideration|exchange ratio|timeline|terms)\b/i,
    /\brepeats? (?:the )?previously announced\b/i,
    /\bfor informational purposes only\b/i,
  ];
  return signals.filter((pattern) => pattern.test(text)).length >= 2;
}

function hasMaterialChange(text: string) {
  const changePattern = /\b(?:increased|decreased|revised|amended|changed|changes?|new consideration|additional consideration|extended|terminated|waived)\b.{0,140}\b(?:consideration|exchange ratio|terms|deadline|condition|closing|agreement|price|offer price|purchase price|per share)\b/i;
  return splitSentences(text).some((sentence) => changePattern.test(sentence) && !/\b(?:does not|do not|did not)\s+(?:modify|amend|change)|\bno change\b/i.test(sentence));
}

function buildSignals(facts: Sec425ParserFacts): Sec425SignalFact[] {
  const signals: Sec425SignalFact[] = [];
  for (const communicationType of facts.communication_types) {
    signals.push({
      type: "communication_type",
      value: communicationType,
      evidence: communicationType,
      confidence: "medium",
    });
  }
  if (facts.deal.transaction_type) {
    signals.push({
      type: "deal_communication",
      value: facts.deal.transaction_type,
      evidence: facts.deal.evidence[0] || "Form 425 contains transaction communication language.",
      confidence: "high",
    });
  }
  if (facts.deal.consideration_text) {
    signals.push({
      type: "deal_terms_present",
      value: "consideration_or_exchange_ratio",
      evidence: facts.deal.consideration_text,
      confidence: "high",
    });
  }
  if (facts.amendment.is_amendment_or_follow_up) {
    signals.push({
      type: "amendment_or_follow_up",
      value: facts.amendment.amendment_title || "amendment_or_follow_up",
      evidence: facts.amendment.evidence[0] || "Form 425 contains amendment or follow-up language.",
      confidence: facts.amendment.amendment_title ? "high" : "medium",
    });
  }
  if (facts.vote.solicitation_present) {
    signals.push({
      type: "shareholder_vote",
      value: facts.vote.meeting_date || "vote_solicitation",
      evidence: facts.vote.evidence[0] || "Form 425 contains proxy solicitation language.",
      confidence: facts.vote.meeting_date ? "high" : "medium",
    });
  }
  if (facts.vote.adjourned || facts.vote.vote_results.length) {
    signals.push({
      type: facts.vote.vote_results.length ? "vote_results" : "meeting_adjournment",
      value: facts.vote.reconvened_date || facts.vote.meeting_date || "shareholder_meeting_update",
      evidence: facts.vote.evidence[0] || "Form 425 contains shareholder meeting update language.",
      confidence: facts.vote.vote_results.length ? "high" : "medium",
    });
  }
  if (facts.offer.offer_type) {
    signals.push({
      type: "tender_or_exchange_offer",
      value: facts.offer.offer_type,
      evidence: facts.offer.evidence[0] || "Form 425 contains tender or exchange offer language.",
      confidence: "high",
    });
  }
  if (facts.spac.is_spac_business_combination) {
    signals.push({
      type: "spac_business_combination",
      value: facts.spac.target_name || facts.spac.combined_company_name || "spac_business_combination",
      evidence: facts.spac.evidence[0] || "Form 425 contains SPAC business combination language.",
      confidence: "medium",
    });
  }
  if (facts.spac.pipe_amount || facts.spac.earnout_shares || facts.spac.warrant_terms) {
    const spacSecurityEvidence =
      facts.spac.evidence.find((item) => /\bPIPE\b|\bearnout\b|\bwarrants?\b/i.test(item)) ||
      facts.spac.warrant_terms ||
      facts.spac.sponsor_transfer ||
      facts.spac.evidence[0] ||
      "Form 425 contains SPAC financing or security terms.";
    signals.push({
      type: "spac_financing_or_security_terms",
      value: facts.spac.pipe_amount || facts.spac.earnout_shares || "security_terms",
      evidence: spacSecurityEvidence,
      confidence: "medium",
    });
  }
  if (facts.legal.litigation_or_claims.length || facts.legal.regulatory_risk.length || facts.legal.injunction_or_delay_risk.length) {
    signals.push({
      type: "legal_or_regulatory_risk",
      value: "deal_risk",
      evidence: [...facts.legal.litigation_or_claims, ...facts.legal.regulatory_risk, ...facts.legal.injunction_or_delay_risk][0],
      confidence: "medium",
    });
  }
  if (facts.financing.financing_risk.length || facts.financing.going_concern_or_liquidity_risk.length) {
    signals.push({
      type: "financial_risk",
      value: "financing_or_liquidity_risk",
      evidence: [...facts.financing.financing_risk, ...facts.financing.going_concern_or_liquidity_risk][0],
      confidence: "medium",
    });
  }
  if (facts.no_new_material_info) {
    signals.push({
      type: "routine_repetition",
      value: "no_new_material_terms",
      evidence: facts.deterministic_archive_reason || "Filing states it repeats prior transaction communications and does not change material terms.",
      confidence: "high",
    });
    signals.push({
      type: "deterministic_archive_candidate",
      value: "parser_can_finish_without_llm",
      evidence: facts.deterministic_archive_reason || "No new material information detected.",
      confidence: "high",
    });
  }
  return signals;
}

function buildCalendarItems(facts: Sec425ParserFacts, text: string): Sec425CalendarItem[] {
  const items: Sec425CalendarItem[] = [];
  if (facts.vote.meeting_date) {
    items.push({
      type: "shareholder_vote",
      date: facts.vote.meeting_date,
      label: "Shareholder vote meeting",
      evidence: facts.vote.evidence[0] || "Special meeting date extracted from Form 425 communication.",
    });
  }
  if (facts.vote.reconvened_date && facts.vote.reconvened_date !== facts.vote.meeting_date) {
    items.push({
      type: "reconvened_shareholder_meeting",
      date: facts.vote.reconvened_date,
      label: "Reconvened shareholder meeting",
      evidence: facts.vote.evidence.find((item) => /\breconvened\b|\badjourned\b/i.test(item)) || "Reconvened meeting date extracted from Form 425 communication.",
    });
  }
  const investorDayEvidence = facts.source_excerpts.find((item) => /\binvestor day\b/i.test(item)) || findSentence(text, /\binvestor day\b/i);
  if (facts.communication_types.includes("investor_day_notice") && investorDayEvidence) {
    const investorDayDate = readInvestorDayDate(text) || readDateFromText(investorDayEvidence) || readDateAfter(text, /\binvestor day\b/i);
    if (investorDayDate) {
      items.push({
        type: "investor_day",
        date: investorDayDate,
        label: "Investor day",
        evidence: investorDayEvidence,
      });
    }
  }
  return items;
}

function buildWarnings(text: string, facts: Sec425ParserFacts) {
  const warnings: string[] = [];
  if (!text) warnings.push("no_filing_text");
  if (!facts.primary_ticker) warnings.push("primary_ticker_not_found");
  if (facts.documents.some((document) => document.text_truncated)) warnings.push("document_text_truncated");
  if (facts.raw_data.extraction_quality.likely_extraction_failure) warnings.push("extraction_failure_route_to_ocr_or_vision");
  if (facts.raw_data.extraction_quality.table_heavy_broken_text) warnings.push("table_heavy_text_may_be_broken");
  if (facts.raw_data.parser_only_case === "cover_only_no_substantive_body") warnings.push("cover_only_filing");
  if (facts.raw_data.parser_only_case === "boilerplate_only_no_deal_specific_language") warnings.push("boilerplate_only_no_deal_specific_language");
  if (facts.documents.filter((document) => /graphic|image/i.test(`${document.document_type} ${document.description}`)).length >= 5) {
    warnings.push("image_heavy_filing");
  }
  if (
    /\b(?:reposted|posted|shared)\b[\s\S]{0,160}\b(?:X|Twitter|social media)\b/i.test(text) &&
    facts.documents.some((document) => /graphic|image/i.test(`${document.document_type} ${document.description}`))
  ) {
    warnings.push("social_media_content_may_be_in_graphic");
  }
  if (facts.communication_types.includes("investor_presentation") && !facts.deal.consideration_text && !facts.spac.pipe_amount) {
    warnings.push("investor_presentation_terms_may_be_in_graphics");
  }
  if (facts.vote.vote_results.length && facts.vote.vote_results.some((result) => result.status === "unknown")) {
    warnings.push("vote_result_status_unclear");
  }
  if (!facts.deal.transaction_type && !facts.vote.solicitation_present && !facts.no_new_material_info) {
    warnings.push("no_clear_425_transaction_signal");
  }
  return warnings;
}

function buildSummary(facts: Sec425ParserFacts) {
  if (facts.no_new_material_info && facts.deterministic_archive_reason) {
    return `Routine Form 425 communication: ${facts.deterministic_archive_reason}`;
  }
  if (facts.offer.offer_type) {
    return `Form 425 communication about a ${facts.offer.offer_type.replace(/_/g, " ")} involving ${facts.offer.subject_company || facts.subject_company || "the subject company"}.`;
  }
  if (facts.vote.vote_results.length) {
    return `Form 425 reports shareholder vote results for ${facts.vote.vote_results.length} proposal${facts.vote.vote_results.length === 1 ? "" : "s"}.`;
  }
  if (facts.vote.adjourned && facts.vote.reconvened_date) {
    return `Form 425 announces an adjourned shareholder meeting reconvening on ${facts.vote.reconvened_date}.`;
  }
  if (facts.amendment.is_amendment_or_follow_up && facts.amendment.amendment_title) {
    return `Form 425 follow-up filing includes ${facts.amendment.amendment_title}.`;
  }
  if (facts.spac.is_spac_business_combination && facts.spac.pipe_amount) {
    return `Form 425 SPAC business-combination communication includes PIPE or financing terms.`;
  }
  if (facts.vote.solicitation_present && facts.vote.meeting_date) {
    return `Form 425 proxy solicitation for a shareholder vote on ${facts.vote.meeting_date}.`;
  }
  if (facts.deal.transaction_type && facts.deal.parties.length >= 2) {
    return `Form 425 communication about a ${facts.deal.transaction_type} involving ${facts.deal.parties.slice(0, 2).join(" and ")}.`;
  }
  if (facts.deal.transaction_type) return `Form 425 communication about a ${facts.deal.transaction_type}.`;
  return "Form 425 transaction communication parsed for routing.";
}

function buildDeterministicArchiveReason({
  noNewMaterialInfo,
  materialChange,
  deal,
  vote,
  legal,
  financing,
  parserOnlyCase,
}: {
  noNewMaterialInfo: boolean;
  materialChange: boolean;
  deal: Sec425DealFacts;
  vote: Sec425VoteFacts;
  legal: Sec425LegalFacts;
  financing: Sec425FinancingFacts;
  parserOnlyCase: string | null;
}) {
  if (parserOnlyCase === "cover_only_no_substantive_body") return "The filing contains only cover or filing identity information and no substantive Form 425 communication text.";
  if (parserOnlyCase === "boilerplate_only_no_deal_specific_language") return "The filing contains only generic legal boilerplate and no deal-specific or risk-relevant language.";
  if (!noNewMaterialInfo || materialChange) return null;
  if (vote.meeting_date || legal.litigation_or_claims.length || legal.regulatory_risk.length || financing.financing_risk.length) return null;
  if (deal.consideration_text && deal.exchange_ratio) return null;
  return "The filing says it repeats previously announced transaction information, contains no new material information, and does not change deal consideration, exchange ratio, timeline, or conditions.";
}

function buildDocumentSummaries(input: Sec425ParseInput, rawPayload: Record<string, unknown>): Sec425DocumentSummary[] {
  const rawDocuments = recordArray(rawPayload.documents);
  const documentSummaries = rawDocuments.map((document) => ({
    document_type: nullableString(document.type) || nullableString(document.documentType),
    description: nullableString(document.description),
    url_present: Boolean(nullableString(document.url)),
    is_primary: Boolean(document.isPrimary),
    text_char_count: numberValue(document.textCharCount),
    text_truncated: Boolean(document.textTruncated),
  }));
  const attachmentSummaries = (input.attachments || []).map((attachment) => ({
    document_type: nullableString(attachment.documentType),
    description: nullableString(attachment.description),
    url_present: Boolean(nullableString(attachment.url)),
    is_primary: Boolean(attachment.isPrimary),
    text_char_count: stringValue(attachment.text).length,
    text_truncated: false,
  }));
  return [...documentSummaries, ...attachmentSummaries];
}

function findVoteResults(text: string): Sec425VoteResult[] {
  const results: Sec425VoteResult[] = [];
  for (const sentence of splitSentences(text)) {
    const sentenceMatch = sentence.match(
      /\b((?:Item|Proposal)\s+\d+[^.]*?)\s+was\s+(approved|not approved|rejected|defeated)\s+with\s+([\d,]+)\s+votes?\s+for,\s+([\d,]+)\s+votes?\s+against\s+and\s+([\d,]+)\s+abstentions?/i,
    );
    if (!sentenceMatch) continue;
    results.push({
      proposal: compactText(sentenceMatch[1]),
      status: /approved/i.test(sentenceMatch[2]) ? "approved" : "not_approved",
      votes_for: parseInteger(sentenceMatch[3]),
      votes_against: parseInteger(sentenceMatch[4]),
      abstentions: parseInteger(sentenceMatch[5]),
      evidence: truncate(sentence, 420),
    });
    if (results.length >= 8) return results;
  }
  if (results.length) return results;

  const pattern =
    /\b((?:Item|Proposal)\s+\d+[^.\n]{0,220}?)\s+was\s+(approved|not approved|rejected|defeated)[^.\n]{0,260}?(?:votes?\s+for|for)\s*[:\-]?\s*([\d,]+)[^.\n]{0,80}?(?:votes?\s+against|against)\s*[:\-]?\s*([\d,]+)[^.\n]{0,80}?(?:abstentions?|abstain)\s*[:\-]?\s*([\d,]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null && results.length < 8) {
    results.push({
      proposal: compactText(match[1] || "proposal"),
      status: /approved/i.test(match[2] || "") ? "approved" : /not approved|rejected|defeated/i.test(match[2] || "") ? "not_approved" : "unknown",
      votes_for: parseInteger(match[3]),
      votes_against: parseInteger(match[4]),
      abstentions: parseInteger(match[5]),
      evidence: truncate(compactText(match[0]), 420),
    });
  }
  if (results.length) return results;

  const simpleVoteTable = text.match(/\bVotes For\b[\s\S]{0,80}\bVotes Against\b[\s\S]{0,80}\bAbstentions\b[\s\S]{0,180}?(\d[\d,]*)[\s\S]{0,40}?(\d[\d,]*)[\s\S]{0,40}?(\d[\d,]*)/i);
  if (simpleVoteTable) {
    results.push({
      proposal: "vote_result_table",
      status: "unknown",
      votes_for: parseInteger(simpleVoteTable[1]),
      votes_against: parseInteger(simpleVoteTable[2]),
      abstentions: parseInteger(simpleVoteTable[3]),
      evidence: truncate(compactText(simpleVoteTable[0]), 420),
    });
  }
  return results;
}

function readAmendmentNumber(text: string) {
  if (/\bfirst amendment\b/i.test(text)) return 1;
  if (/\bsecond amendment\b/i.test(text)) return 2;
  if (/\bthird amendment\b/i.test(text)) return 3;
  if (/\bfourth amendment\b/i.test(text)) return 4;
  const match = text.match(/\bAmendment\s+No\.?\s*(\d+)/i);
  return match?.[1] ? parseInteger(match[1]) : null;
}

function readFirstField(text: string, candidates: Array<[string, RegExp]>): Sec425Field | null {
  for (const [value, pattern] of candidates) {
    const sentence = findSentence(text, pattern);
    if (sentence) {
      return {
        value,
        evidence: sentence,
        confidence: "medium",
      };
    }
  }
  return null;
}

function readDateNear(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  return readDateFromText(text.slice(Math.max(0, (match.index || 0) - 120), (match.index || 0) + 260));
}

function readDateAfter(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  return readDateFromText(text.slice(match.index || 0, (match.index || 0) + 360));
}

function readInvestorDayDate(text: string) {
  const match = text.match(/\binvestor day\b[^.\n]{0,180}?\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}/i);
  return match ? readDateFromText(match[0]) : null;
}

function readDateFromText(text: string) {
  const match = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})\b/i);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const day = match[2].padStart(2, "0");
  return `${match[3]}-${month}-${day}`;
}

function readFiledByCompany(text: string) {
  const headerText = text.slice(0, 6000);
  const patterns = [
    /(?:^|\n|\|)\s*Filed by:?\s+([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}?[A-Za-z0-9&.,'])?)(?=\s*(?:\||\n|\(|$|pursuant to|Pursuant to|Commission File|Subject Company))/i,
    /\bFiled by\s+([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}?[A-Za-z0-9&.,'])?)(?=\s+pursuant to Rule 425|\s+Pursuant to Rule 425)/i,
  ];
  for (const pattern of patterns) {
    const match = headerText.match(pattern);
    if (match?.[1]) return cleanCompanyName(match[1]);
  }
  return null;
}

function readSubjectCompany(text: string) {
  const headerText = text.slice(0, 6000);
  const match = headerText.match(
    /(?:^|\n|\|)\s*Subject Company:?\s*([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}?[A-Za-z0-9&.,'])?)(?=\s*(?:\||\n|\(|$|Commission File|Filed by|pursuant to|Pursuant to))/i,
  ) || headerText.match(/\bSubject Company:?\s*([A-Z][A-Za-z0-9&.,'/-](?:[A-Za-z0-9&.,' /-]{0,110}?[A-Za-z0-9&.,'])?)(?=\s+Commission File|\s+Date:|\s*$)/i);
  return match?.[1] ? cleanCompanyName(match[1]) : null;
}

function readTicker(text: string) {
  const match = text.match(/\b(?:NYSE|Nasdaq|NASDAQ|NYSE American)\s*:\s*([A-Z][A-Z0-9. -]{0,8})\b|\(([A-Z]{1,5})\)/);
  return normalizeTicker(match?.[1] || match?.[2]);
}

function findBoilerplateMarkers(text: string) {
  const candidates: Array<[string, RegExp]> = [
    ["forward_looking_statements", /\bforward-looking statements?\b/i],
    ["no_offer_or_solicitation", /\bno offer or solicitation\b|\bdoes not constitute an offer\b/i],
    ["additional_information_where_to_find_it", /\badditional information (?:about|and) where to find it\b|\bwhere to find it\b/i],
    ["participants_in_solicitation", /\bparticipants in (?:the )?solicitation\b/i],
    ["presentation_disclaimer", /\bdisclaimer about this presentation\b|\bprovided for informational purposes only\b/i],
    ["agreement_reliance_disclaimer", /\binvestors should not rely on the representations\b|\brepresentations and warranties\b.{0,120}\bsolely for the benefit\b/i],
  ];
  return candidates.filter(([, pattern]) => pattern.test(text)).map(([value]) => value);
}

function findSentence(text: string, pattern: RegExp) {
  const match = text.match(pattern);
  if (!match) return null;
  return pickEvidenceSentence(text, match.index || 0);
}

function findSentences(text: string, pattern: RegExp, limit: number) {
  const sentences = splitSentences(text);
  return uniqueStrings(sentences.filter((sentence) => pattern.test(sentence)).map((sentence) => truncate(sentence, 420))).slice(0, limit);
}

function splitSentences(text: string) {
  return compactText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z(])|\n+/)
    .map(compactText)
    .filter((sentence) => sentence.length > 20);
}

function pickEvidenceSentence(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf(".", index - 1), text.lastIndexOf("\n", index - 1));
  let end = text.indexOf(".", index + 1);
  if (end >= 0 && end - index < 80) {
    const nextEnd = text.indexOf(".", end + 1);
    if (nextEnd >= 0) end = nextEnd;
  }
  if (end < 0) end = Math.min(text.length, index + 360);
  else end += 1;
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), 420);
}

function pickEvidenceWindow(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf("\n", index - 1), text.lastIndexOf(".", index - 1));
  let end = text.indexOf("\n", index + 1);
  const sentenceEnd = text.indexOf(".", index + 1);
  if (sentenceEnd >= 0 && (end < 0 || sentenceEnd < end)) end = sentenceEnd + 1;
  if (end < 0 || end - index < 80) end = Math.min(text.length, index + 360);
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), 420);
}

function cleanCompanyName(value: string) {
  return compactText(value)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\b(?:a Delaware corporation|a corporation|Inc\.? and|LLC and)$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[;,:-]+$/g, "")
    .trim();
}

function looksLikeCompany(value: string) {
  return /\b(?:Inc\.?|Corp\.?|Corporation|Company|Co\.?|Ltd\.?|Limited|PLC|LLC|Holdings|Therapeutics|Bio|Robotics|Foods|Bancorp)\b/i.test(value);
}

function normalizeSourceText(value: unknown) {
  const raw = stringValue(value);
  if (!raw) return "";
  let text = raw;
  if (/<\s*(?:html|body|table|tr|td|th|div|p|br|li|h[1-6]|img|nav|ix:|xbrli:)\b/i.test(raw)) {
    text = raw
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<img\b([^>]*)>/gi, (_, attrs: string) => imageMarkerFromAttributes(attrs))
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\s*li\b[^>]*>/gi, "\n- ")
      .replace(/<\s*h[1-6]\b[^>]*>/gi, "\n")
      .replace(/<\s*\/\s*(?:p|div|tr|li|h[1-6])\s*>/gi, "\n")
      .replace(/<\s*\/\s*(?:td|th)\s*>/gi, " | ")
      .replace(/<[^>]+>/g, " ");
  }
  return compactText(decodeHtmlEntities(text));
}

function imageMarkerFromAttributes(attrs: string) {
  const alt = readHtmlAttribute(attrs, "alt") || readHtmlAttribute(attrs, "title");
  const src = readHtmlAttribute(attrs, "src");
  const label = compactText(alt || src || "image");
  return `\n[image: ${label}]\n`;
}

function readHtmlAttribute(attrs: string, name: string) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = attrs.match(pattern);
  return match ? decodeHtmlEntities(match[1] || match[2] || match[3] || "") : "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, "\"")
    .replace(/&lsquo;|&rsquo;|&#8216;|&#8217;/gi, "'")
    .replace(/&ndash;|&mdash;|&#8211;|&#8212;/gi, "-")
    .replace(/&middot;/gi, "*")
    .replace(/&#36;/g, "$")
    .replace(/&#9744;/g, "[ ]")
    .replace(/&#9746;/g, "[x]")
    .replace(/&#9679;/g, "*")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => decodeCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => decodeCodePoint(Number.parseInt(code, 10)));
}

function decodeCodePoint(codePoint: number) {
  if (!Number.isFinite(codePoint)) return "";
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return "";
  }
}

function compactText(value: string) {
  return stringValue(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string, max: number) {
  const text = compactText(value);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const text = compactText(value || "");
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  return unique;
}

function normalizeTicker(value: unknown) {
  const text = stringValue(value).toUpperCase().replace(/[^A-Z0-9.]/g, "");
  return text || null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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

function parseInteger(value: unknown) {
  const parsed = Number(stringValue(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
