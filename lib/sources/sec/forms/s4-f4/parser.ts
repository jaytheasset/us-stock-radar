import {
  S4_F4_PARSER_GROUP,
  S4_F4_PARSER_VERSION,
  S4_F4_ROOM_LABEL,
  type CalendarItem,
  type CleanedSourceBlock,
  type EvidenceItem,
  type NoiseCandidate,
  type ParserOutput,
  type RawItemCheck,
  type S4F4Facts,
  type S4F4ExhibitFact,
  type S4F4ExchangeOfferKind,
  type S4F4Fixture,
  type SourceAvailability,
} from "./types.ts";

const SUPPORTED_FORMS = new Set(["S-4", "F-4", "S-4/A", "F-4/A"]);
const MONTH_PATTERN =
  "(January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}";
const CLEANED_SOURCE_BLOCK_CHAR_LIMIT = 6_000;
const MAX_CLEANED_SOURCE_BLOCKS = 60;

type SourceDocumentRole = "primary" | "exhibit" | "graphic" | "metadata" | "unknown";

interface SourceDocument {
  type: string;
  fileName: string;
  description: string;
  text: string;
  role: SourceDocumentRole;
}

interface SourcePacket {
  rawInput: string;
  documents: SourceDocument[];
  primaryDocument: SourceDocument | null;
  primaryDocumentText: string;
  bodyTextForExtraction: string;
  selectedExhibitSnippets: Array<{
    type: string;
    fileName: string;
    description: string;
    textChars: number;
    snippet: string;
  }>;
  sourceAvailability: SourceAvailability;
  sourceAvailabilityReason: string;
  isIndexLike: boolean;
}

export function parseS4F4Filing(fixture: S4F4Fixture): ParserOutput {
  const sourcePacket = buildSourcePacket(fixture);
  const text = normalizeWhitespace(sourcePacket.bodyTextForExtraction);
  const lowerText = text.toLowerCase();
  const isSupported = SUPPORTED_FORMS.has(fixture.formType);
  const isAmendment = fixture.formType.endsWith("/A");
  const structure = detectStructure(text, lowerText, isAmendment);
  const exchangeOffer = extractExchangeOfferFacts(text, lowerText, structure.documentKind);
  const exhibits = extractExhibits(fixture, sourcePacket.documents);
  const rawExtraction = buildRawExtraction(fixture, sourcePacket, text, lowerText, structure, exhibits);
  const transactionType: S4F4Facts["transaction"]["type"] = "unknown";
  const cashPerShare = extractCashPerShare(text);
  const stockRatio = extractStockRatio(text);
  const registeredShares = extractRegisteredShares(text);
  const meetingDate = extractDateNear(text, ["special meeting", "shareholder meeting", "extraordinary general meeting"]);
  const recordDate = extractDateNear(text, ["record date"]);
  const voteRequired = hasAny(lowerText, [
    "special meeting",
    "shareholder approval",
    "stockholder approval",
    "vote to approve",
    "extraordinary general meeting",
  ]);
  const materialChange = false;
  const routineAdministrative = false;
  const legalRisk = hasPrimaryLegalUpdate(text, lowerText);
  const financialRisk = hasPrimaryFinancialUpdate(text, lowerText);
  const regulatoryApprovalRisk = hasPrimaryRegulatoryUpdate(text, lowerText);
  const appraisalRights = hasAny(lowerText, ["appraisal rights", "dissenters' rights", "dissenters rights"]);
  const shareIssuanceMentioned = registeredShares !== null || hasAny(lowerText, [
    "issue shares",
    "issuance of shares",
    "new shares",
    "registered shares",
  ]);

  const evidence = collectEvidence(text, {
    transactionType,
    voteRequired,
    shareIssuanceMentioned,
    legalRisk,
    financialRisk,
    regulatoryApprovalRisk,
    materialChange,
    routineAdministrative,
    structure,
    exchangeOffer,
  });

  const facts: S4F4Facts = {
    secFormType: fixture.formType,
    isAmendment,
    companyName: fixture.companyName,
    primaryTicker: fixture.primaryTicker,
    participants: fixture.participants,
    structure,
    transaction: {
      type: transactionType,
      description: describeTransaction(transactionType, fixture),
      consideration: {
        cashPerShare,
        stockRatio,
        notes: extractConsiderationNotes(text),
      },
      registeredShares,
    },
    exchangeOffer,
    vote: {
      required: voteRequired,
      meetingDate,
      recordDate,
      proposal: voteRequired ? extractVoteProposal(text) : null,
    },
    amendment: {
      isAmendment,
      materialChange,
      routineAdministrative,
      changedSections: extractChangedSections(lowerText, { materialChange, routineAdministrative }),
    },
    risk: {
      legalRisk,
      financialRisk,
      regulatoryApprovalRisk,
      appraisalRights,
      litigationMentioned: legalRisk,
    },
    dilution: {
      shareIssuanceMentioned,
      registeredShares,
      marketContextProvided: Boolean(fixture.market_context),
    },
    exhibits,
    rawExtraction,
    evidence,
  };
  const warnings = buildWarnings(facts, isSupported);

  return {
    parserVersion: S4_F4_PARSER_VERSION,
    parserGroup: S4_F4_PARSER_GROUP,
    formType: S4_F4_ROOM_LABEL,
    accessionNumber: fixture.accessionNumber,
    isSupported,
    summary: buildSummary(facts),
    cleaned_source_blocks: buildCleanedSourceBlocks(fixture, sourcePacket, facts, warnings),
    facts,
    signals: [],
    calendarItems: buildCalendarItems(facts),
    warnings,
    raw: {
      fixtureId: fixture.id,
      inputFormType: fixture.formType,
      filingDate: fixture.filingDate ?? null,
      sourceAvailability: sourcePacket.sourceAvailability,
      sourceAvailabilityReason: sourcePacket.sourceAvailabilityReason,
      sourceDocuments: sourcePacket.documents.map((document) => ({
        type: document.type,
        fileName: document.fileName,
        description: document.description,
        role: document.role,
        textChars: document.text.length,
        textSnippet: normalizeWhitespace(document.text).slice(0, 500),
      })),
      primaryDocument: sourcePacket.primaryDocument
        ? {
            type: sourcePacket.primaryDocument.type,
            fileName: sourcePacket.primaryDocument.fileName,
            description: sourcePacket.primaryDocument.description,
            textChars: sourcePacket.primaryDocument.text.length,
            textSnippet: normalizeWhitespace(sourcePacket.primaryDocument.text).slice(0, 800),
          }
        : null,
      selectedExhibitSnippets: sourcePacket.selectedExhibitSnippets,
      sourceExcerpts: evidence,
      attachments: fixture.attachments ?? [],
      exhibitInventory: exhibits.items,
      rawExtraction,
      parentFilingContext: fixture.parentFilingContext ?? null,
      marketContext: fixture.market_context ?? null,
    },
  };
}

function buildSourcePacket(fixture: S4F4Fixture): SourcePacket {
  const rawInput = fixture.filingText ?? "";
  const documents = extractSourceDocuments(rawInput, fixture.formType);
  const isIndexLike = documents.length === 0 && looksLikeSecIndex(rawInput);
  const primaryDocument = selectPrimaryDocument(documents, fixture.formType);
  const selectedExhibits = selectImportantTextualExhibits(documents);
  const selectedExhibitSnippets = selectedExhibits.map((document) => ({
    type: document.type,
    fileName: document.fileName,
    description: document.description,
    textChars: document.text.length,
    snippet: selectedSnippetForExhibit(document),
  }));
  const primaryDocumentText = primaryDocument
    ? cleanDocumentText(primaryDocument.text)
    : documents.length === 0 && !isIndexLike
      ? cleanDocumentText(rawInput)
      : "";
  const primaryTextForChecks = normalizeWhitespace(primaryDocumentText);
  const selectedExhibitText = selectedExhibits
    .map((document) => {
      const cleaned = normalizeWhitespace(cleanDocumentText(document.text)).slice(0, 5000);
      return cleaned ? `Exhibit ${document.type} ${document.description}\n${cleaned}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
  const bodyTextForExtraction = [primaryDocumentText, selectedExhibitText].filter((part) => part.trim()).join("\n\n");
  const hasGraphicOnlyDocuments =
    documents.length > 0 && documents.every((document) => document.role === "graphic" || document.role === "metadata");
  const sourceAvailability = classifySourceAvailability({
    documents,
    hasGraphicOnlyDocuments,
    isIndexLike,
    primaryTextForChecks,
    rawInput,
  });

  return {
    rawInput,
    documents,
    primaryDocument,
    primaryDocumentText,
    bodyTextForExtraction,
    selectedExhibitSnippets,
    sourceAvailability,
    sourceAvailabilityReason: describeSourceAvailability(sourceAvailability, documents.length, primaryTextForChecks.length),
    isIndexLike,
  };
}

function buildCleanedSourceBlocks(
  fixture: S4F4Fixture,
  sourcePacket: SourcePacket,
  facts: S4F4Facts,
  warnings: string[],
): CleanedSourceBlock[] {
  const blocks: CleanedSourceBlock[] = [];
  const primarySource = sourcePacket.primaryDocument
    ? sourceLabel(sourcePacket.primaryDocument)
    : "primary filing text";
  const primaryText = sourcePacket.primaryDocumentText || sourcePacket.bodyTextForExtraction;

  pushSourceBlock(blocks, {
    block_type: "filing_metadata",
    title: "Filing metadata",
    source: "SEC filing package metadata",
    text: [
      `Form: ${facts.secFormType}`,
      `Accession: ${fixture.accessionNumber ?? "not provided"}`,
      `Filed: ${fixture.filingDate ?? "not provided"}`,
      `Company: ${fixture.companyName}`,
      `Primary ticker: ${facts.primaryTicker.ticker ?? "not provided"}`,
      `Participants: ${facts.participants.map((participant) => `${participant.name} (${participant.role})`).join("; ") || "not provided"}`,
    ].join("\n"),
    metadata: {
      form_type: facts.secFormType,
      accession_number: fixture.accessionNumber,
      filing_date: fixture.filingDate ?? null,
    },
  });

  pushSourceBlock(blocks, {
    block_type: "source_availability",
    title: "Source availability",
    source: "parser source audit",
    text: [
      `Availability: ${facts.rawExtraction.sourceAvailability}`,
      `Primary text characters: ${facts.rawExtraction.primaryTextChars}`,
      `Normalized text characters: ${facts.rawExtraction.normalizedTextChars}`,
      `Missing raw items: ${facts.rawExtraction.missingRequiredItems.join(", ") || "none"}`,
      `Ambiguous raw items: ${facts.rawExtraction.ambiguousItems.join(", ") || "none"}`,
    ].join("\n"),
  });

  pushSourceBlock(blocks, {
    block_type: "document_inventory",
    title: "Document and attachment inventory",
    source: "SEC submission document tags",
    text: sourcePacket.documents.length > 0
      ? sourcePacket.documents
          .map((document, index) => {
            return `${index + 1}. ${document.type || "unknown"} | ${document.fileName || "no filename"} | ${document.description || "no description"} | role=${document.role} | chars=${document.text.length}`;
          })
          .join("\n")
      : "No SEC <DOCUMENT> inventory was available in the provided source text.",
  });

  const noiseSummaryBlock = buildSourceNoiseSummaryBlock(facts);
  if (noiseSummaryBlock) {
    pushSourceBlock(blocks, noiseSummaryBlock);
  }

  const amendmentChangeBlock = buildAmendmentChangeNotIdentifiedBlock(facts, primaryText, primarySource);
  if (amendmentChangeBlock) {
    pushSourceBlock(blocks, amendmentChangeBlock);
  }

  for (const section of primarySectionSpecs()) {
    if (section.appliesTo === "f4" && !fixture.formType.startsWith("F-4")) {
      continue;
    }

    const snippet = firstUsefulSnippet(primaryText, section.needles, section.allowBoilerplate, {
      sectionKey: section.key,
      formType: fixture.formType,
    });
    if (!snippet) {
      continue;
    }

    pushSourceBlock(blocks, {
      block_type: "primary_source_section",
      title: section.title,
      source: primarySource,
      text: snippet,
      metadata: {
        section_key: section.key,
      },
    });
  }

  for (const tableBlock of extractTableSourceBlocks(sourcePacket.bodyTextForExtraction)) {
    pushSourceBlock(blocks, tableBlock);
  }

  for (const exhibit of sourcePacket.selectedExhibitSnippets) {
    pushSourceBlock(blocks, {
      block_type: "selected_exhibit_snippet",
      title: `${exhibit.type || "Exhibit"} ${exhibit.description || exhibit.fileName}`.trim(),
      source: exhibit.fileName || exhibit.type || "SEC exhibit",
      text: exhibit.snippet,
      metadata: {
        exhibit_type: exhibit.type,
        file_name: exhibit.fileName,
        description: exhibit.description,
        text_chars: exhibit.textChars,
      },
    });
  }

  for (const ambiguousBlock of buildAmbiguousSourceBlocks(fixture, sourcePacket, facts, primaryText, primarySource)) {
    pushSourceBlock(blocks, ambiguousBlock);
  }

  if (warnings.length > 0) {
    pushSourceBlock(blocks, {
      block_type: "parser_warning",
      title: "Parser warnings",
      source: "parser source audit",
      text: warnings.join("\n"),
    });
  }

  if (fixture.parentFilingContext) {
    pushSourceBlock(blocks, {
      block_type: "site_context",
      title: "Parent filing context",
      source: "site-provided parent filing context",
      text: JSON.stringify(fixture.parentFilingContext, null, 2),
    });
  }

  if (fixture.market_context) {
    pushSourceBlock(blocks, {
      block_type: "site_context",
      title: "Market context",
      source: "site-provided market context",
      text: JSON.stringify(fixture.market_context, null, 2),
    });
  }

  return blocks.slice(0, MAX_CLEANED_SOURCE_BLOCKS);
}

function pushSourceBlock(blocks: CleanedSourceBlock[], block: CleanedSourceBlock): void {
  const text = normalizeWhitespace(block.text);
  if (!text) {
    return;
  }

  const trimmedText = text.length > CLEANED_SOURCE_BLOCK_CHAR_LIMIT
    ? `${text.slice(0, CLEANED_SOURCE_BLOCK_CHAR_LIMIT).trim()} ...`
    : text;

  const duplicate = blocks.some(
    (candidate) => candidate.block_type === block.block_type && candidate.title === block.title && candidate.text === trimmedText,
  );
  if (duplicate) {
    return;
  }

  blocks.push({
    ...block,
    text: trimmedText,
  });
}

function sourceLabel(document: SourceDocument): string {
  return [document.type, document.fileName, document.description].filter(Boolean).join(" | ");
}

function buildAmendmentChangeNotIdentifiedBlock(
  facts: S4F4Facts,
  primaryText: string,
  primarySource: string,
): CleanedSourceBlock | null {
  if (!facts.isAmendment || !primaryText || facts.rawExtraction.primaryTextChars < 20_000) {
    return null;
  }

  if (hasExplicitAdminOnlyAmendmentText(primaryText) || hasExplicitCriticalAmendmentChange(primaryText)) {
    return null;
  }

  const opening = amendmentIntroSourceText(primaryText);
  return {
    block_type: "amendment_change_not_identified",
    title: "Amendment change not identified in opening source text",
    source: primarySource,
    text: [
      "The current amendment includes a full primary filing body, but the parser did not find an opening/explanatory-note sentence that explicitly identifies a critical amendment change or proves an administrative-only amendment.",
      "Do not infer no material change from this parser audit alone. Analysis should review the amendment using the source blocks and source link.",
      opening ? `Opening source excerpt: ${opening}` : "Opening source excerpt was unavailable after source cleaning.",
    ].join("\n"),
    metadata: {
      review_reason: "amendment_change_not_identified",
      primary_text_chars: facts.rawExtraction.primaryTextChars,
    },
  };
}

function buildSourceNoiseSummaryBlock(facts: S4F4Facts): CleanedSourceBlock | null {
  if (facts.rawExtraction.noiseCandidates.length === 0) {
    return null;
  }

  return {
    block_type: "source_noise_summary",
    title: "Dropped or low-priority source noise",
    source: "parser source audit",
    text: [
      "These source categories were detected but should not be used as transaction evidence unless a separate KEEP block supports the same point.",
      ...facts.rawExtraction.noiseCandidates.slice(0, 12).map((candidate) => {
        return `${candidate.item} (${candidate.count}): ${candidate.reason}`;
      }),
    ].join("\n"),
    metadata: {
      label: "DROP",
    },
  };
}

function buildAmbiguousSourceBlocks(
  fixture: S4F4Fixture,
  sourcePacket: SourcePacket,
  facts: S4F4Facts,
  primaryText: string,
  primarySource: string,
): CleanedSourceBlock[] {
  const blocks: CleanedSourceBlock[] = [];
  const exhibitDocumentText = new Set(
    sourcePacket.documents
      .filter((document) => document.role === "exhibit" && normalizeWhitespace(cleanDocumentText(document.text)).length >= 100)
      .flatMap((document) => [
        normalizeWhitespace(document.type).toLowerCase(),
        normalizeWhitespace(document.description).toLowerCase(),
        normalizeWhitespace(document.fileName).toLowerCase(),
      ])
      .filter(Boolean),
  );

  for (const item of facts.exhibits.items.filter(isImportantExhibitInventoryItem).slice(0, 8)) {
    const descriptor = normalizeWhitespace(`${item.type} ${item.description}`).toLowerCase();
    const hasFetchedText = [...exhibitDocumentText].some((value) => descriptor.includes(value) || value.includes(descriptor));
    if (hasFetchedText) {
      continue;
    }

    blocks.push({
      block_type: "ambiguous_source_block",
      title: "Important exhibit listed but text unavailable",
      source: "SEC attachment inventory",
      text: [
        `Attachment inventory lists ${item.type || "unknown exhibit"} ${item.description || ""}`.trim(),
        "The exhibit type/description looks transaction-relevant, but the parser did not receive readable exhibit body text. Do not infer the exhibit terms from inventory alone.",
      ].join("\n"),
      metadata: {
        label: "AMBIGUOUS",
        exhibit_type: item.type,
        description: item.description,
      },
    });
  }

  const registeredSharesSnippet = firstUsefulSnippet(primaryText, [
    "shares registered",
    "securities being registered",
    "shares of common stock being registered",
    "ordinary shares being registered",
    "american depositary shares being registered",
  ]);
  if (registeredSharesSnippet && !hasClearIssuanceOrResaleContext(registeredSharesSnippet)) {
    blocks.push({
      block_type: "ambiguous_source_block",
      title: "Registered-share amount needs context",
      source: primarySource,
      text: [
        "A registered-share amount was found, but the local excerpt does not clearly say whether it is merger issuance, resale, shelf, or fee-table context.",
        registeredSharesSnippet,
      ].join("\n"),
      metadata: {
        label: "AMBIGUOUS",
      },
    });
  }

  if (fixture.formType.startsWith("F-4")) {
    const foreignSnippet = firstUsefulSnippet(primaryText, [
      "scheme of arrangement",
      "court approval",
      "court sanction",
      "ordinary shares",
      "american depositary shares",
      "each ads represents",
      "foreign private issuer",
    ], false, { sectionKey: "f4_cross_border_terms", formType: fixture.formType });
    if (!foreignSnippet && facts.rawExtraction.sourceAvailability !== "index_or_inventory_only") {
      blocks.push({
        block_type: "ambiguous_source_block",
        title: "F-4 cross-border terms not found in parser excerpt",
        source: primarySource,
        text: "This is an F-4/F-4/A filing, but the parser did not find ADS, ordinary-share, scheme, court-approval, or foreign-law terms in the selected source blocks. Analysis should avoid assuming the cross-border mechanics are unavailable.",
        metadata: {
          label: "AMBIGUOUS",
        },
      });
    }
  }

  return blocks;
}

function isImportantExhibitInventoryItem(item: S4F4ExhibitFact): boolean {
  const descriptor = `${item.type} ${item.description}`.toLowerCase();
  if (isFeeTableDescriptor(descriptor)) {
    return false;
  }

  if (hasAny(descriptor, ["consent", "power of attorney", "signature"]) && !hasAny(descriptor, ["support", "voting", "lock-up"])) {
    return false;
  }

  return /ex-(2|10|99)/i.test(item.type) ||
    hasAny(descriptor, [
      "merger agreement",
      "plan of merger",
      "business combination agreement",
      "transaction agreement",
      "support agreement",
      "voting agreement",
      "lock-up",
      "lockup",
      "sponsor support",
      "non-redemption",
      "subscription agreement",
      "pipe",
      "backstop",
      "registration rights",
      "warrant amendment",
      "fairness opinion",
      "financial advisor",
      "investor presentation",
      "press release",
      "shareholder letter",
      "proxy card",
      "notice",
    ]);
}

function hasClearIssuanceOrResaleContext(snippet: string): boolean {
  const lowerSnippet = snippet.toLowerCase();
  return hasAny(lowerSnippet, [
    "to be issued in the merger",
    "to be issued pursuant",
    "issuable upon completion",
    "in connection with the merger",
    "in connection with the business combination",
    "resale by the selling stockholders",
    "offered by the selling stockholders",
    "fee table",
    "calculation of registration fee",
    "maximum aggregate offering price",
  ]);
}

function isFeeTableDescriptor(value: string): boolean {
  return hasAny(value.toLowerCase(), [
    "filing fee",
    "registration fee",
    "calculation of registration fee",
    "fee table",
    "maximum aggregate offering price",
    "maximum offering price",
    "proposed maximum offering price",
    "amount of registration fee",
    "fee rate",
  ]);
}

function primarySectionSpecs(): Array<{
  key: string;
  title: string;
  needles: string[];
  allowBoilerplate?: boolean;
  appliesTo?: "all" | "f4";
}> {
  return [
    {
      key: "document_heading",
      title: "Primary document heading",
      needles: [
        "registration statement",
        "proxy statement/prospectus",
        "joint proxy statement/prospectus",
        "offer to exchange",
        "exchange offer",
        "business combination",
        "merger",
      ],
      allowBoilerplate: true,
    },
    {
      key: "summary",
      title: "Summary or Q&A",
      needles: [
        "summary of the transaction",
        "summary of the merger",
        "summary of the business combination",
        "questions and answers",
        "q&a",
        "frequently asked questions",
      ],
      allowBoilerplate: true,
    },
    {
      key: "transaction_terms",
      title: "Transaction terms",
      needles: [
        "merger agreement",
        "business combination agreement",
        "transaction agreement",
        "plan of merger",
        "arrangement agreement",
        "scheme of arrangement",
        "reorganization agreement",
        "separation agreement",
        "domestication",
        "redomiciliation",
        "share exchange",
        "exchange ratio",
        "cash per share",
        "consideration",
        "registered shares",
        "offer to exchange",
      ],
    },
    {
      key: "consideration_and_issuance",
      title: "Consideration and share issuance",
      needles: [
        "right to receive",
        "per share consideration",
        "cash consideration",
        "stock consideration",
        "shares to be issued",
        "number of shares to be issued",
        "ownership percentage",
        "own approximately",
        "equity value",
        "enterprise value",
        "transaction value",
      ],
    },
    {
      key: "vote_meeting",
      title: "Vote or meeting terms",
      needles: [
        "special meeting",
        "extraordinary general meeting",
        "shareholder approval",
        "stockholder approval",
        "vote to approve",
        "required vote",
        "affirmative vote",
        "quorum",
        "voting deadline",
        "adjournment proposal",
        "nasdaq proposal",
        "compensation proposal",
        "record date",
      ],
    },
    {
      key: "board_recommendation",
      title: "Board recommendation",
      needles: [
        "board recommends",
        "board of directors recommends",
        "unanimously recommends",
        "recommend that you vote",
        "recommendation of the board",
      ],
    },
    {
      key: "background",
      title: "Background of transaction",
      needles: [
        "background of the merger",
        "background of the business combination",
        "background of the transaction",
        "background of the exchange offer",
      ],
    },
    {
      key: "fairness_opinion",
      title: "Fairness opinion or financial advisor",
      needles: [
        "fairness opinion",
        "opinion of",
        "financial advisor",
        "financial adviser",
        "fair from a financial point of view",
      ],
    },
    {
      key: "interests_and_conflicts",
      title: "Director/officer interests",
      needles: [
        "interests of directors and officers",
        "interests of certain persons",
        "golden parachute",
        "retention",
        "severance",
        "conflicts of interest",
      ],
    },
    {
      key: "closing_conditions",
      title: "Closing conditions",
      needles: [
        "conditions to the merger",
        "conditions to the business combination",
        "closing conditions",
        "minimum cash condition",
        "regulatory approval",
        "antitrust approval",
        "foreign investment approval",
      ],
    },
    {
      key: "termination_terms",
      title: "Termination and no-shop terms",
      needles: [
        "termination fee",
        "reverse termination fee",
        "expense reimbursement",
        "outside date",
        "no-shop",
        "non-solicitation",
        "matching right",
        "go-shop",
      ],
    },
    {
      key: "support_lockup_pipe",
      title: "Support, lock-up, PIPE, or backstop terms",
      needles: [
        "support agreement",
        "voting agreement",
        "lock-up agreement",
        "lockup agreement",
        "sponsor support agreement",
        "non-redemption agreement",
        "subscription agreement",
        "pipe financing",
        "backstop agreement",
        "registration rights agreement",
      ],
    },
    {
      key: "spac_de_spac_terms",
      title: "SPAC/de-SPAC status terms",
      needles: [
        "public stockholders may elect to redeem",
        "public shareholders may elect to redeem",
        "redeem their public shares",
        "redeem their shares",
        "redemption rights",
        "redemption deadline",
        "trust account",
        "minimum cash",
        "sponsor agreement",
        "founder shares",
        "non-redemption agreement",
        "earnout",
        "warrant treatment",
        "warrant amendment",
        "ticker change",
        "expected to be listed",
        "expected ticker",
        "nasdaq listing condition",
        "liquidation deadline",
        "business combination agreement",
      ],
    },
    {
      key: "risk_factors",
      title: "Risk factors",
      needles: ["risk factors"],
      allowBoilerplate: true,
    },
    {
      key: "pro_forma",
      title: "Pro forma, ownership, or dilution tables",
      needles: [
        "unaudited pro forma",
        "pro forma condensed combined financial",
        "comparative per share",
        "equivalent per share",
        "pro forma ownership",
        "capitalization table",
        "dilution table",
      ],
      allowBoilerplate: true,
    },
    {
      key: "f4_cross_border_terms",
      title: "F-4 foreign issuer or ADS terms",
      needles: [
        "foreign private issuer",
        "american depositary shares",
        "ordinary shares",
        "each ads represents",
        "depositary agreement",
        "scheme of arrangement",
        "court approval",
        "court sanction",
        "home country",
        "foreign law",
        "tax residency",
        "cayman",
        "british virgin islands",
        "israel",
        "ireland",
        "canada",
      ],
      appliesTo: "f4",
    },
    {
      key: "amendment_changes",
      title: "Amendment or supplement changes",
      needles: [
        "this amendment",
        "supplement no.",
        "material change",
        "revised exchange ratio",
        "amended business combination agreement",
        "solely to file",
        "no change to",
      ],
    },
  ];
}

function firstUsefulSnippet(
  text: string,
  needles: string[],
  allowBoilerplate = false,
  options: { sectionKey?: string; formType?: string } = {},
): string | null {
  for (const snippet of snippetsForNeedles(text, needles)) {
    const normalized = cleanSourceSnippet(snippet, needles);
    if (!normalized) {
      continue;
    }

    const lowerSnippet = normalized.toLowerCase();
    if (!allowBoilerplate && (isRiskBoilerplateSnippet(lowerSnippet) || isTocLikeSnippet(lowerSnippet))) {
      continue;
    }

    if (!isAllowedSectionSnippet(lowerSnippet, options)) {
      continue;
    }

    return normalized;
  }

  const fallback = firstSnippet(text, needles);
  const cleanedFallback = fallback ? cleanSourceSnippet(fallback, needles) : null;
  if (!cleanedFallback) {
    return null;
  }

  const lowerFallback = cleanedFallback.toLowerCase();
  if (!allowBoilerplate && (isRiskBoilerplateSnippet(lowerFallback) || isTocLikeSnippet(lowerFallback))) {
    return null;
  }

  return isAllowedSectionSnippet(lowerFallback, options) ? cleanedFallback : null;
}

function cleanSourceSnippet(snippet: string, needles: string[]): string | null {
  const decoded = decodeHtmlEntities(cleanDocumentText(snippet));
  const bounded = trimTocAndNavigationBoundaries(decoded, needles);
  const normalized = normalizeWhitespace(bounded);
  if (!normalized || isShortNavigationFragment(normalized) || isTocLikeSnippet(normalized.toLowerCase())) {
    return null;
  }

  return normalized;
}

function isShortNavigationFragment(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (normalized.length >= 40) {
    return false;
  }

  if (/[.!?]/.test(normalized)) {
    return false;
  }

  return !/\b(?:is|are|was|were|will|shall|may|must|has|have|had|requires|required|conditioned|recommends|receive|own|elect|vote|entered|includes|provides)\b/i.test(
    normalized,
  );
}

function trimTocAndNavigationBoundaries(value: string, needles: string[]): string {
  let candidate = value
    .replace(/\u00a0/g, " ")
    .replace(/[•●▪◦]/g, " ")
    .replace(/\b(?:TABLE OF CONTENTS|Table of Contents)\b/g, " TABLE OF CONTENTS ");

  const tocPattern = /\btable of contents\b/i;
  let match = tocPattern.exec(candidate);
  let guard = 0;
  while (match && guard < 4) {
    const before = candidate.slice(0, match.index).trim();
    const after = candidate.slice(match.index + match[0].length).trim();
    const beforeScore = sourceBodyScore(before, needles);
    const afterScore = sourceBodyScore(after, needles);

    if (afterScore > beforeScore && afterScore > 0) {
      candidate = after;
    } else if (beforeScore > 0) {
      candidate = before;
    } else {
      candidate = afterScore >= beforeScore ? after : before;
    }

    match = tocPattern.exec(candidate);
    guard += 1;
  }

  return trimPageNavigationEdges(candidate);
}

function trimPageNavigationEdges(value: string): string {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  while (lines.length > 0 && isTocNavigationLine(lines[0])) {
    lines.shift();
  }
  while (lines.length > 0 && isTocNavigationLine(lines[lines.length - 1])) {
    lines.pop();
  }

  return lines.join(" ")
    .replace(/^(?:page\s*)?\d+\s+/i, "")
    .replace(/\s+(?:page\s*)?\d+$/i, "")
    .replace(/^(?:annex|appendix)\s+[a-z0-9-]+\s+/i, "")
    .replace(/\s+(?:annex|appendix)\s+[a-z0-9-]+$/i, "")
    .replace(/^(?:(?:page|certain definitions|questions and answers(?: about (?:the )?(?:transaction|merger|business combination))?|summary(?: of (?:the )?(?:transaction|merger|business combination))?|closing conditions|conditions to closing|risk factors|the transaction|the merger|the business combination|comparative per share(?: data)?|unaudited pro forma(?: condensed combined financial information)?)\s+(?:[a-z]-)?(?:\d+|[ivxlcdm]+)?\s+)+/i, "")
    .trim();
}

function isTocNavigationLine(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized === "page") {
    return true;
  }

  return /^(?:certain definitions|questions and answers(?: about (?:the )?(?:transaction|merger|business combination))?|summary(?: of (?:the )?(?:transaction|merger|business combination))?|closing conditions|conditions to closing|risk factors|the transaction|the merger|the business combination|comparative per share(?: data)?|unaudited pro forma(?: condensed combined financial information)?)\s+(?:[a-z]-)?(?:\d+|[ivxlcdm]+)$/.test(normalized);
}

function sourceBodyScore(value: string, needles: string[]): number {
  const normalized = normalizeWhitespace(value);
  if (!normalized || isTocRowOnly(normalized)) {
    return 0;
  }

  let score = 0;
  if (needles.some((needle) => normalized.toLowerCase().includes(needle.toLowerCase()))) {
    score += 2;
  }
  if (/[.!?]\s+[A-Z0-9]/.test(normalized) || normalized.length > 180) {
    score += 1;
  }
  if (/\b(?:is|are|was|were|will|shall|may|must|has|have|had|requires|required|conditioned|recommends|receive|own|elect|vote|entered|includes|provides)\b/i.test(normalized)) {
    score += 2;
  }
  if (looksLikeTocList(normalized.toLowerCase())) {
    score -= 3;
  }

  return Math.max(0, score);
}

function isAllowedSectionSnippet(
  lowerSnippet: string,
  options: { sectionKey?: string; formType?: string },
): boolean {
  if (options.sectionKey && isGenericAcquisitionShelfSnippet(lowerSnippet, options.sectionKey)) {
    return false;
  }

  if (options.sectionKey === "vote_meeting" && isGenericGovernanceMeetingSnippet(lowerSnippet)) {
    return false;
  }

  if (options.sectionKey === "f4_cross_border_terms") {
    return Boolean(options.formType?.startsWith("F-4")) && isStrongF4CrossBorderSnippet(lowerSnippet);
  }

  if (options.sectionKey === "spac_de_spac_terms") {
    return isSpacStatusSnippet(lowerSnippet);
  }

  return true;
}

function isGenericAcquisitionShelfSnippet(lowerSnippet: string, sectionKey: string): boolean {
  const mergerSpecificSections = new Set([
    "transaction_terms",
    "consideration_and_issuance",
    "vote_meeting",
    "board_recommendation",
    "background",
    "fairness_opinion",
    "closing_conditions",
    "termination_terms",
    "support_lockup_pipe",
    "spac_de_spac_terms",
    "pro_forma",
  ]);
  if (!mergerSpecificSections.has(sectionKey)) {
    return false;
  }

  const hasShelfOrGenericAcquisitionCue = hasAny(lowerSnippet, [
    "from time to time",
    "prospectus supplement",
    "securities offered hereby",
    "may issue securities",
    "may acquire businesses",
    "acquire businesses, assets",
    "other acquisition agreement",
    "applicable agreement or plan of merger",
    "future acquisitions",
  ]);
  if (!hasShelfOrGenericAcquisitionCue) {
    return false;
  }

  return !hasSpecificTransactionCue(lowerSnippet);
}

function hasSpecificTransactionCue(lowerSnippet: string): boolean {
  return hasAny(lowerSnippet, [
    "proxy statement/prospectus",
    "joint proxy statement/prospectus",
    "merger proposal",
    "business combination proposal",
    "vote to approve the merger",
    "vote to approve the business combination",
    "special meeting to approve",
    "agreement and plan of merger, dated",
    "business combination agreement, dated",
    "exchange ratio",
    "right to receive",
    "public stockholders may elect to redeem",
    "minimum cash condition",
    "termination fee",
    "outside date",
    "support agreement",
    "voting agreement",
    "pipe financing",
    "sponsor support agreement",
  ]);
}

function isGenericGovernanceMeetingSnippet(lowerSnippet: string): boolean {
  const hasGenericGovernanceCue = hasAny(lowerSnippet, [
    "annual meeting",
    "regular meeting",
    "corporate governance",
    "bylaws",
    "certificate of incorporation",
    "charter",
    "quorum",
  ]);
  if (!hasGenericGovernanceCue) {
    return false;
  }

  return !hasSpecificTransactionCue(lowerSnippet);
}

function isStrongF4CrossBorderSnippet(lowerSnippet: string): boolean {
  return hasAny(lowerSnippet, [
    "american depositary shares",
    "each ads represents",
    "depositary agreement",
    "scheme of arrangement",
    "court approval",
    "court sanction",
    "foreign private issuer",
    "ordinary shares",
    "foreign law",
    "tax residency",
  ]);
}

function isSpacStatusSnippet(lowerSnippet: string): boolean {
  if (isFractionalShareRedemptionSnippet(lowerSnippet)) {
    return false;
  }

  if (
    hasAny(lowerSnippet, [
      "exchange agent",
      "interest-bearing trust account",
      "interest-bearing trust accounts",
      "benefit plans or related trust accounts",
      "managed accounts",
      "mutual funds",
      "fiduciary or agency capacity",
    ]) &&
    !hasAny(lowerSnippet, ["spac", "special purpose acquisition", "blank check", "public stockholder", "public shareholder", "public shares", "sponsor"])
  ) {
    return false;
  }

  const hasSpacCue = hasAny(lowerSnippet, [
    "spac",
    "special purpose acquisition",
    "blank check",
    "public stockholder",
    "public shareholder",
    "public share",
    "trust account",
    "sponsor",
    "founder shares",
  ]);
  const hasStatusCue = hasAny(lowerSnippet, [
    "redemption rights",
    "redeem their public shares",
    "redeem their shares",
    "minimum cash",
    "trust account",
    "sponsor support",
    "non-redemption",
    "earnout",
    "warrant treatment",
    "warrant amendment",
    "expected ticker",
    "expected to be listed",
    "business combination",
  ]);

  return hasSpacCue && hasStatusCue;
}

function isFractionalShareRedemptionSnippet(lowerSnippet: string): boolean {
  return hasAny(lowerSnippet, [
    "fractional share",
    "fractional shares",
    "cash in lieu",
    "no fractional shares",
    "rounding",
    "exchange agent",
  ]) && lowerSnippet.includes("redemption") &&
    !hasAny(lowerSnippet, ["public stockholder", "public shareholder", "public shares", "trust account", "sponsor"]);
}

function extractTableSourceBlocks(text: string): CleanedSourceBlock[] {
  const blocks: CleanedSourceBlock[] = [];
  const normalizedLines = text
    .split(/\r?\n/)
    .map((line) => cleanDocumentText(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const tableNeedles = [
    "unaudited pro forma",
    "pro forma condensed combined",
    "comparative per share",
    "equivalent per share",
    "selected historical",
    "exchange ratio",
    "pro forma ownership",
    "capitalization",
    "dilution",
    "minimum cash condition",
    "termination fee",
    "pipe financing",
  ];

  for (let index = 0; index < normalizedLines.length && blocks.length < 8; index += 1) {
    const line = normalizedLines[index];
    const lowerLine = line.toLowerCase();
    if (isFeeTableDescriptor(lowerLine)) {
      continue;
    }

    const hasNeedle = tableNeedles.some((needle) => lowerLine.includes(needle));
    const looksTabular =
      /(\$|%|\bshares?\b|\bratio\b|\bassets\b|\bliabilities\b|\brevenue\b|\bincome\b)/i.test(line) &&
      (line.match(/\d[\d,.]*/g) ?? []).length >= 3;

    if (!hasNeedle && !looksTabular) {
      continue;
    }

    const sample = normalizedLines.slice(Math.max(0, index - 2), index + 8).join("\n");
    if (isFeeTableDescriptor(sample.toLowerCase())) {
      continue;
    }
    const cleanedSample = cleanSourceSnippet(sample, tableNeedles);
    if (!cleanedSample) {
      continue;
    }
    if (isLowValueTableSourceBlock(cleanedSample.toLowerCase())) {
      continue;
    }

    pushSourceBlock(blocks, {
      block_type: "table_source_block",
      title: hasNeedle ? "Table or financial source block" : "Numeric table-like source block",
      source: "primary filing or exhibit text",
      text: cleanedSample,
      metadata: {
        line_index: index,
      },
    });
  }

  return blocks;
}

function isLowValueTableSourceBlock(lowerSample: string): boolean {
  if (isTocLikeSnippet(lowerSample)) {
    return true;
  }

  if (isFeeTableDescriptor(lowerSample)) {
    return true;
  }

  const hasDealTableCue = hasAny(lowerSample, [
    "unaudited pro forma",
    "pro forma condensed combined",
    "comparative per share",
    "equivalent per share",
    "exchange ratio",
    "pro forma ownership",
    "minimum cash condition",
    "termination fee",
    "pipe financing",
    "backstop",
  ]);

  if (
    !hasDealTableCue &&
    hasAny(lowerSample, [
      "certificate of incorporation",
      "bylaws",
      "charter",
      "corporate governance",
      "consent of independent",
      "we consent",
      "signature",
    ])
  ) {
    return true;
  }

  return false;
}

function extractSourceDocuments(rawInput: string, formType: string): SourceDocument[] {
  const documents: SourceDocument[] = [];
  const documentPattern = /<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi;
  let match: RegExpExecArray | null;

  while ((match = documentPattern.exec(rawInput)) !== null) {
    const block = match[1] ?? "";
    const type = readDocumentTag(block, "TYPE");
    const fileName = readDocumentTag(block, "FILENAME");
    const description = readDocumentTag(block, "DESCRIPTION");
    const text = readDocumentText(block);

    documents.push({
      type: type || "unknown",
      fileName,
      description,
      text,
      role: classifySourceDocument(type, fileName, description, text, formType),
    });
  }

  return documents;
}

function readDocumentTag(block: string, tagName: string): string {
  const pattern = new RegExp(`<${tagName}>\\s*([^\\r\\n<]*)`, "i");
  return (block.match(pattern)?.[1] ?? "").trim();
}

function readDocumentText(block: string): string {
  const match = block.match(/<TEXT>([\s\S]*?)<\/TEXT>/i);
  return match?.[1] ?? "";
}

function classifySourceDocument(
  type: string,
  fileName: string,
  description: string,
  text: string,
  formType: string,
): SourceDocumentRole {
  const upperType = type.trim().toUpperCase();
  const lowerName = `${fileName} ${description}`.toLowerCase();
  const lowerText = text.toLowerCase();

  if (upperType === formType.toUpperCase()) {
    return "primary";
  }

  if (upperType === "GRAPHIC" || /\.(gif|jpe?g|png|svg|tiff?|bmp)$/i.test(fileName)) {
    return "graphic";
  }

  if (/^(XML|EX-101|XBRL|XSD|JSON)/i.test(upperType) || /\.(xml|xsd|json)$/i.test(fileName)) {
    return "metadata";
  }

  if (upperType.startsWith("EX-") || lowerName.includes("exhibit")) {
    return "exhibit";
  }

  if (
    hasAny(lowerText, [
      "registration statement",
      "proxy statement/prospectus",
      "joint proxy statement/prospectus",
      "offer to exchange",
      "exchange offer",
    ])
  ) {
    return "primary";
  }

  return "unknown";
}

function selectPrimaryDocument(documents: SourceDocument[], formType: string): SourceDocument | null {
  return (
    documents.find((document) => document.type.toUpperCase() === formType.toUpperCase()) ??
    documents.find((document) => document.role === "primary") ??
    null
  );
}

function selectImportantTextualExhibits(documents: SourceDocument[]): SourceDocument[] {
  return documents
    .map((document, index) => ({
      document,
      index,
      rank: importantTextualExhibitRank(document),
    }))
    .filter((item) => item.rank > 0)
    .sort((left, right) => right.rank - left.rank || left.index - right.index)
    .slice(0, 12)
    .map((item) => item.document);
}

function importantTextualExhibitRank(document: SourceDocument): number {
  if (document.role !== "exhibit") {
    return 0;
  }

  const normalizedText = normalizeWhitespace(cleanDocumentText(document.text));
  if (normalizedText.length < 100) {
    return 0;
  }

  const descriptor = `${document.type} ${document.fileName} ${document.description} ${normalizedText.slice(0, 2000)}`;
  const lowerDescriptor = descriptor.toLowerCase();
  const upperType = document.type.toUpperCase();
  if (isFeeTableDescriptor(lowerDescriptor)) {
    return 0;
  }

  if (/^EX-2[345](?:\.|$)/i.test(upperType)) {
    return 0;
  }

  const hasMergerAgreementCue = hasAny(lowerDescriptor, [
    "agreement and plan of merger",
    "merger agreement",
    "business combination agreement",
    "plan of merger",
    "arrangement agreement",
    "scheme of arrangement",
    "transaction agreement",
  ]);
  const hasSupportOrFinancingCue = hasAny(lowerDescriptor, [
    "support agreement",
    "voting agreement",
    "lock-up",
    "lockup",
    "sponsor support",
    "non-redemption",
    "subscription agreement",
    "pipe",
    "backstop",
    "registration rights",
    "financing agreement",
    "warrant amendment",
  ]);
  const hasAdvisorOrCommunicationCue = hasAny(lowerDescriptor, [
    "fairness opinion",
    "fair from a financial point of view",
    "financial advisor",
    "financial adviser",
    "investor presentation",
    "press release",
    "shareholder letter",
    "stockholder letter",
    "proxy card",
    "notice",
  ]);
  const hasAmendmentCue = hasAny(lowerDescriptor, [
    "amendment agreement",
    "amendment to agreement",
    "first amendment",
    "second amendment",
  ]);
  const isAdminExhibit =
    hasAny(lowerDescriptor, [
      "consent of independent",
      "auditor consent",
      "accountant consent",
      "we consent",
      "power of attorney",
      "signature page",
    ]);
  if (isAdminExhibit && !hasMergerAgreementCue && !hasSupportOrFinancingCue && !hasAdvisorOrCommunicationCue && !hasAmendmentCue) {
    return 0;
  }

  if (/^EX-2(?:\.|$)/i.test(upperType) || hasMergerAgreementCue) {
    return 100;
  }
  if (/^EX-10(?:\.|$)/i.test(upperType) && hasSupportOrFinancingCue) {
    return 90;
  }
  if (hasSupportOrFinancingCue) {
    return 88;
  }
  if (hasAdvisorOrCommunicationCue) {
    return 80;
  }
  if (/^EX-99(?:\.|$)/i.test(upperType) && hasSpecificTransactionCue(lowerDescriptor)) {
    return 75;
  }
  if (hasAmendmentCue) {
    return 70;
  }
  if (/^EX-8(?:\.|$)/i.test(upperType) && hasAny(lowerDescriptor, ["tax opinion", "tax consequences", "material u.s. federal income tax"])) {
    return 40;
  }

  return 0;
}

function selectedSnippetForExhibit(document: SourceDocument): string {
  const text = normalizeWhitespace(cleanDocumentText(document.text));
  const targetedSnippet = firstUsefulSnippet(text, [
    "agreement and plan of merger",
    "business combination agreement",
    "plan of merger",
    "scheme of arrangement",
    "fairness opinion",
    "fair from a financial point of view",
    "exchange ratio",
    "cash consideration",
    "stock consideration",
    "closing condition",
    "minimum cash condition",
    "outside date",
    "termination fee",
    "support agreement",
    "voting agreement",
    "lock-up agreement",
    "sponsor support agreement",
    "non-redemption agreement",
    "subscription agreement",
    "pipe financing",
    "backstop agreement",
    "registration rights agreement",
    "warrant amendment",
    "earnout",
    "redemption",
    "trust account",
  ]);

  return (targetedSnippet || text).slice(0, 1200);
}

function classifySourceAvailability({
  documents,
  hasGraphicOnlyDocuments,
  isIndexLike,
  primaryTextForChecks,
  rawInput,
}: {
  documents: SourceDocument[];
  hasGraphicOnlyDocuments: boolean;
  isIndexLike: boolean;
  primaryTextForChecks: string;
  rawInput: string;
}): SourceAvailability {
  if (!normalizeWhitespace(rawInput)) {
    return "empty_or_too_short";
  }

  if (isIndexLike) {
    return "index_or_inventory_only";
  }

  if (hasGraphicOnlyDocuments || looksLikeGraphicOrBinaryOnly(rawInput)) {
    return "graphic_or_binary_only";
  }

  if (primaryTextForChecks.length < 100) {
    return "empty_or_too_short";
  }

  return documents.length > 0 ? "full_submission" : "primary_document";
}

function describeSourceAvailability(
  sourceAvailability: SourceAvailability,
  documentCount: number,
  primaryTextChars: number,
): string {
  if (sourceAvailability === "full_submission") {
    return `Complete SEC submission with ${documentCount} document blocks and ${primaryTextChars} primary-document text characters.`;
  }

  if (sourceAvailability === "primary_document") {
    return `Standalone primary document text with ${primaryTextChars} normalized characters.`;
  }

  if (sourceAvailability === "index_or_inventory_only") {
    return "SEC index or document inventory was provided without the primary filing body.";
  }

  if (sourceAvailability === "graphic_or_binary_only") {
    return "Only graphic, binary-like, or metadata documents were available; no primary filing body was found.";
  }

  if (sourceAvailability === "empty_or_too_short") {
    return "Source text is empty or too short to support router/analysis LLM work.";
  }

  return "Source availability could not be determined.";
}

function looksLikeSecIndex(rawInput: string): boolean {
  const lowerInput = rawInput.toLowerCase();
  return hasAny(lowerInput, [
    "document format files",
    "edgar filing documents",
    "sec.gov/archives/edgar/data",
    "sequence description document type size",
  ]);
}

function looksLikeGraphicOrBinaryOnly(rawInput: string): boolean {
  const text = normalizeWhitespace(cleanDocumentText(rawInput));

  if (!text) {
    return true;
  }

  const encodedLines = countEncodedBinaryLines(rawInput);
  return encodedLines > 0 && text.length < 500;
}

function cleanDocumentText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<SEC-HEADER>[\s\S]*?<\/SEC-HEADER>/gi, " ")
    .replace(/<\/?(?:SEC-DOCUMENT|DOCUMENT|TEXT)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : " ";
    })
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : " ";
    });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function hasPrimaryLegalUpdate(text: string, lowerText: string): boolean {
  const snippets = snippetsForNeedles(text, ["litigation", "lawsuit", "injunction", "legal proceeding"]);
  return snippets.some((snippet) => {
    const lowerSnippet = snippet.toLowerCase();
    if (isRiskBoilerplateSnippet(lowerSnippet) || isTocLikeSnippet(lowerSnippet)) {
      return false;
    }

    if (hasAny(lowerSnippet, ["no pending lawsuits", "no lawsuit", "may be filed", "lawsuits may be filed"])) {
      return false;
    }

    return hasAny(lowerSnippet, [
      "pending lawsuit",
      "pending lawsuits",
      "filed a lawsuit",
      "filed lawsuits",
      "complaint was filed",
      "complaints were filed",
      "settlement agreement",
      "settled",
      "court order",
      "obtained an injunction",
      "granted an injunction",
      "enjoined",
      "challenging the merger",
      "challenging the business combination",
    ]);
  }) || hasAny(lowerText, ["litigation relating to the merger (page", "litigation relating to the mergers (page"]);
}

function hasPrimaryFinancialUpdate(text: string, lowerText: string): boolean {
  const snippets = snippetsForNeedles(text, [
      "debt restructuring",
      "minimum cash condition",
      "solvency",
      "insolvency",
  ]);

  return snippets.some((snippet) => {
    const lowerSnippet = snippet.toLowerCase();
    if (isTocLikeSnippet(lowerSnippet)) {
      return false;
    }

    if (hasAny(lowerSnippet, ["insolvency or similar proceedings", "recognized solvency", "as a going concern, determined"])) {
      return false;
    }

    if (isRiskBoilerplateSnippet(lowerSnippet) && !lowerSnippet.includes("minimum cash condition")) {
      return false;
    }

    return hasAny(lowerSnippet, [
      "minimum cash condition",
      "debt restructuring",
      "restructuring support agreement",
      "failed to obtain financing",
      "unable to obtain financing",
      "insolvent",
      "insolvency proceeding",
    ]);
  }) || lowerText.includes("minimum cash condition");
}

function hasPrimaryRegulatoryUpdate(text: string, _lowerText: string): boolean {
  const snippets = snippetsForNeedles(text, [
    "regulatory approval",
    "antitrust approval",
    "foreign investment approval",
    "competition authority",
  ]);

  return snippets.some((snippet) => {
    const lowerSnippet = snippet.toLowerCase();
    if (isRiskBoilerplateSnippet(lowerSnippet) || isTocLikeSnippet(lowerSnippet)) {
      return false;
    }

    return hasAny(lowerSnippet, [
      "failed to obtain",
      "unable to obtain",
      "approval was denied",
      "approval has been denied",
      "blocked",
      "prohibited",
      "regulatory approval condition was amended",
      "competition authority issued",
    ]);
  });
}

function snippetsForNeedles(text: string, needles: string[]): string[] {
  const lowerText = text.toLowerCase();
  const snippets: string[] = [];

  for (const needle of needles) {
    let index = lowerText.indexOf(needle.toLowerCase());
    while (index !== -1 && snippets.length < 20) {
      const start = Math.max(0, index - 220);
      const end = Math.min(text.length, index + needle.length + 360);
      snippets.push(text.slice(start, end));
      index = lowerText.indexOf(needle.toLowerCase(), index + needle.length);
    }
  }

  return snippets;
}

function isRiskBoilerplateSnippet(lowerSnippet: string): boolean {
  return hasAny(lowerSnippet, [
    "risk factors",
    "risks related to",
    "may delay or prevent",
    "could delay or prevent",
    "could adversely affect",
    "may adversely affect",
    "no assurance",
    "cannot assure",
    "if the merger is not completed",
    "if the business combination is not completed",
    "one of the conditions to completion",
    "customary closing conditions",
    "absence of any injunction",
    "delays in obtaining",
  ]);
}

function isTocLikeSnippet(lowerSnippet: string): boolean {
  const separatorCount = (lowerSnippet.match(/\|/g) ?? []).length;
  return separatorCount >= 6 || isTocRowOnly(lowerSnippet) || looksLikeTocList(lowerSnippet);
}

function isTocRowOnly(value: string): boolean {
  const lowerValue = normalizeWhitespace(value).toLowerCase();
  if (!lowerValue) {
    return true;
  }

  if (/^(?:page\s*)?\d+$/.test(lowerValue)) {
    return true;
  }

  const hasTocMarker = lowerValue.includes("table of contents");
  const hasBodyVerb = /\b(?:is|are|was|were|will|shall|may|must|has|have|had|requires|required|conditioned|recommends|receive|own|elect|vote|entered|includes|provides)\b/.test(lowerValue);
  return hasTocMarker && looksLikeTocList(lowerValue) && !hasBodyVerb;
}

function looksLikeTocList(lowerSnippet: string): boolean {
  const tocHeadingPattern =
    /(questions and answers|summary|summary of the transaction|closing conditions|conditions to closing|risk factors|the merger|the business combination|regulatory approvals|litigation|material u\.s\. federal income tax consequences|comparative per share|unaudited pro forma|where you can find more information|annex [a-z0-9-]+|appendix [a-z0-9-]+)\s+(?:[a-z]-)?(?:\d+|[ivxlcdm]+)/gi;
  const tocHeadingCount = (lowerSnippet.match(tocHeadingPattern) ?? []).length;
  const dottedLeaderCount = (lowerSnippet.match(/\.{2,}\s*(?:[a-z]-)?(?:\d+|[ivxlcdm]+)/g) ?? []).length;
  const pageWordCount = (lowerSnippet.match(/\bpage\b/g) ?? []).length;
  const shortPageRowCount = (lowerSnippet.match(
    /\b(?:certain definitions|questions and answers|summary|summary of the transaction|closing conditions|conditions to closing|risk factors|the merger|the business combination|comparative per share|comparative per share data|unaudited pro forma|pro forma condensed combined financial information)\s+(?:[a-z]-)?(?:\d+|[ivxlcdm]+)\b/gi,
  ) ?? []).length;
  const hasBodyVerb = /\b(?:is|are|was|were|will|shall|may|must|has|have|had|requires|required|conditioned|recommends|receive|own|elect|vote|entered|includes|provides)\b/.test(lowerSnippet);

  return tocHeadingCount >= 3 ||
    dottedLeaderCount >= 2 ||
    (shortPageRowCount >= 2 && !hasBodyVerb) ||
    (lowerSnippet.includes("table of contents") && pageWordCount >= 2);
}

function detectStructure(
  text: string,
  lowerText: string,
  isAmendment: boolean,
): S4F4Facts["structure"] {
  const amendmentIntroText = amendmentIntroSourceText(text);
  const lowerAmendmentIntroText = amendmentIntroText.toLowerCase();
  const bodyOmitted = hasAny(lowerAmendmentIntroText, [
    "the remainder of the registration statement is unchanged",
    "has therefore been omitted",
    "has been omitted",
  ]);
  const isExhibitsOnly =
    isAmendment &&
    bodyOmitted &&
    hasExplicitAdminOnlyAmendmentText(text);
  const hasProxyStatementProspectus = hasAny(lowerText, [
    "proxy statement/prospectus",
    "joint proxy statement/prospectus",
    "proxy statement / prospectus",
  ]);
  const hasQuestionsAndAnswers = hasAny(lowerText, [
    "questions and answers",
    "frequently asked questions",
  ]);
  const hasRiskFactors = lowerText.includes("risk factors");
  const hasProFormaFinancials = hasAny(lowerText, [
    "unaudited pro forma",
    "pro forma condensed combined financial",
  ]);
  const hasCoRegistrantTable = lowerText.includes("table of co-registrants");
  const hasExchangeOffer = lowerText.includes("exchange offer") || lowerText.includes("offer to exchange");
  const hasDebtExchange = hasAny(lowerText, [
    "old notes",
    "original notes",
    "new notes",
    "exchange notes",
    "senior notes due",
  ]);
  const hasSpacSignals = hasAny(lowerText, [
    "spac",
    "pubco",
    "business combination",
    "redemption rights",
    "sponsor agreement",
    "non-redemption agreement",
  ]);

  let documentKind: S4F4Facts["structure"]["documentKind"] = "unknown";

  if (isExhibitsOnly) {
    documentKind = "exhibits_only_amendment";
  } else if (hasExchangeOffer && hasDebtExchange) {
    documentKind = "notes_exchange_offer";
  } else if (hasExchangeOffer) {
    documentKind = "exchange_offer";
  } else if (hasSpacSignals) {
    documentKind = "spac_business_combination";
  } else if (hasProxyStatementProspectus || lowerText.includes("merger")) {
    documentKind = "merger_proxy_prospectus";
  }

  return {
    documentKind,
    isExhibitsOnly,
    bodyOmitted,
    hasProxyStatementProspectus,
    hasQuestionsAndAnswers,
    hasRiskFactors,
    hasProFormaFinancials,
    hasCoRegistrantTable,
  };
}

function amendmentIntroSourceText(text: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  const lowerText = normalized.toLowerCase();
  const candidates = [
    "explanatory note",
    "purpose of this amendment",
    "amendment no.",
    "amendment no ",
    "this amendment",
  ];
  const firstIndex = candidates
    .map((candidate) => lowerText.indexOf(candidate))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (firstIndex === undefined) {
    return normalized.slice(0, 8_000);
  }

  return normalized.slice(Math.max(0, firstIndex - 1_000), Math.min(normalized.length, firstIndex + 8_000));
}

function hasExplicitAdminOnlyAmendmentText(text: string): boolean {
  const intro = amendmentIntroSourceText(text);
  if (!intro) {
    return false;
  }

  const lowerIntro = intro.toLowerCase();
  const hasAdminPurpose =
    /\bexhibits?-only filing\b/i.test(intro) ||
    /\bsolely\s+(?:for\s+the\s+purpose\s+of\s+)?(?:to\s+)?(?:file|add|update|provide|include)\b.{0,180}\b(?:exhibit|consent|signature|filing fee|fee table|tax opinion|legal opinion|power of attorney)\b/i.test(intro) ||
    /\b(?:updated signatures?|signature page|consents?|filing fee exhibit|fee table exhibit|power of attorney)\b/i.test(intro);
  const hasNoOtherChange =
    /\bno other changes?\b/i.test(intro) ||
    /\bno changes?\s+(?:are|were|have been)\s+made\b/i.test(intro) ||
    /\bdoes not modify\b/i.test(intro) ||
    /\b(?:the\s+)?remainder of the registration statement is unchanged\b/i.test(intro) ||
    /\bunchanged\b.{0,120}\bhas therefore been omitted\b/i.test(intro) ||
    hasAny(lowerIntro, ["no change to"]);

  return hasAdminPurpose && hasNoOtherChange && !hasExplicitCriticalAmendmentChange(intro);
}

function hasExplicitCriticalAmendmentChange(text: string): boolean {
  const snippets = snippetsForNeedles(text, [
    "exchange ratio",
    "merger consideration",
    "cash consideration",
    "stock consideration",
    "meeting date",
    "record date",
    "vote required",
    "required vote",
    "closing condition",
    "outside date",
    "termination fee",
    "litigation",
    "regulatory approval",
    "tax consequences",
    "pro forma",
    "ownership",
    "dilution",
    "material adverse effect",
    "financing condition",
    "business combination agreement",
    "merger agreement",
  ]);

  return snippets.some((snippet) => {
    const lowerSnippet = snippet.toLowerCase();
    if (hasAny(lowerSnippet, ["no change to", "no changes to", "does not modify", "unchanged", "remained unchanged"])) {
      return false;
    }

    return /\b(?:material change|revised|changed|amended|modified|updated|increased|decreased|postponed|rescheduled|added|adds|removed|removes|replaced|supplemented)\b/i.test(
      snippet,
    );
  });
}

function extractExchangeOfferFacts(
  text: string,
  lowerText: string,
  documentKind: S4F4Facts["structure"]["documentKind"],
): S4F4Facts["exchangeOffer"] {
  const present = documentKind === "exchange_offer" || documentKind === "notes_exchange_offer";
  const hasConsentSolicitation = lowerText.includes("consent solicitation");
  const hasRightsOffering = lowerText.includes("rights offering");
  const hasMakewholeAgreement = lowerText.includes("makewhole agreement");
  const hasMinimumTenderCondition = lowerText.includes("minimum tender condition");
  const hasWarrants = lowerText.includes("warrant");
  const hasExternalProceedingMechanic = hasAny(lowerText, ["uk proceeding", "scheme of arrangement", "court sanction"]);

  let kind: S4F4ExchangeOfferKind = "unknown";
  if (present && documentKind === "notes_exchange_offer") {
    kind = hasRightsOffering || hasConsentSolicitation || hasWarrants || hasExternalProceedingMechanic
      ? "mixed_restructuring"
      : "debt_exchange";
  } else if (present) {
    kind = lowerText.includes("common stock") || lowerText.includes("ordinary shares") ? "equity_exchange" : "unknown";
  }

  return {
    present,
    kind,
    oldSecurities: extractSecurityMentions(text, ["old notes", "original notes", "outstanding"]),
    newSecurities: extractSecurityMentions(text, ["new notes", "exchange notes", "registered"]),
    hasConsentSolicitation,
    hasRightsOffering,
    hasMakewholeAgreement,
    hasMinimumTenderCondition,
    hasWarrants,
    hasExternalProceedingMechanic,
  };
}

function extractSecurityMentions(text: string, anchors: string[]): string[] {
  const mentions = new Set<string>();
  const notePattern = /(?:\$[0-9,.]+\s+)?(?:aggregate principal amount of\s+)?[0-9.]+%\s+[A-Za-z -]+Notes due \d{4}/gi;
  const matches = text.match(notePattern) ?? [];

  for (const match of matches) {
    const lowerMatch = match.toLowerCase();
    const nearbyAnchor = anchors.some((anchor) => lowerMatch.includes(anchor));
    if (nearbyAnchor || anchors.some((anchor) => findSnippet(text, anchor)?.includes(match))) {
      mentions.add(match.replace(/\s+/g, " ").trim());
    }
  }

  return [...mentions].slice(0, 12);
}

function extractExhibits(fixture: S4F4Fixture, documents: SourceDocument[] = []): S4F4Facts["exhibits"] {
  const items: S4F4ExhibitFact[] = (fixture.attachments ?? []).map((attachment) => ({
    type: typeof attachment.type === "string" ? attachment.type : "unknown",
    description: typeof attachment.description === "string" ? attachment.description : "",
    filedHerewith: typeof attachment.filedHerewith === "boolean" ? attachment.filedHerewith : null,
  }));
  const existingKeys = new Set(items.map((item) => `${item.type}\u0000${item.description}`));

  for (const document of documents) {
    if (document.role !== "exhibit" && document.role !== "graphic") {
      continue;
    }

    const item = {
      type: document.type || "unknown",
      description: document.description || document.fileName,
      filedHerewith: true,
    };
    const key = `${item.type}\u0000${item.description}`;

    if (!existingKeys.has(key)) {
      items.push(item);
      existingKeys.add(key);
    }
  }

  return {
    count: items.length,
    filedHerewithCount: items.filter((item) => item.filedHerewith).length,
    items,
  };
}

function buildRawExtraction(
  fixture: S4F4Fixture,
  sourcePacket: SourcePacket,
  text: string,
  lowerText: string,
  structure: S4F4Facts["structure"],
  exhibits: S4F4Facts["exhibits"],
): S4F4Facts["rawExtraction"] {
  const rawInput = sourcePacket.rawInput;
  const rawLower = rawInput.toLowerCase();
  const primaryText = normalizeWhitespace(sourcePacket.primaryDocumentText);
  const hasPrimaryDocumentText = primaryText.length >= 100 && sourcePacket.sourceAvailability !== "index_or_inventory_only";
  const hasPrimaryFilingMarker = hasAny(lowerText, [
    "registration statement",
    "proxy statement/prospectus",
    "joint proxy statement/prospectus",
    "prospectus",
    "offer to exchange",
    "exchange offer",
    "business combination",
    "merger",
  ]);
  const requiredItems: RawItemCheck[] = [
    rawCheck(
      "primary_document_text",
      "Primary document text",
      hasPrimaryDocumentText ? "present" : "missing",
      hasPrimaryDocumentText ? "high" : "low",
      hasPrimaryDocumentText
        ? `Primary document body has ${primaryText.length} normalized characters.`
        : `Primary document body is unavailable; source availability is ${sourcePacket.sourceAvailability}.`,
      primaryText.slice(0, 240),
    ),
    rawCheck(
      "cover_metadata",
      "Cover metadata",
      fixture.formType && fixture.accessionNumber ? "present" : "ambiguous",
      fixture.formType && fixture.accessionNumber ? "high" : "medium",
      "Form type and accession number should travel with the raw packet.",
      `${fixture.formType} ${fixture.accessionNumber ?? ""}`.trim(),
    ),
    rawCheck(
      "registrant_or_party_metadata",
      "Registrant or party metadata",
      fixture.companyName && fixture.participants.length > 0 ? "present" : "missing",
      fixture.companyName && fixture.participants.length > 0 ? "high" : "low",
      "Company name and participant list are needed before the router tries role interpretation.",
      fixture.participants.map((participant) => participant.name).join("; ") || fixture.companyName,
    ),
    rawCheck(
      "primary_filing_marker",
      "Primary S-4/F-4 body marker",
      !hasPrimaryDocumentText ? "missing" : hasPrimaryFilingMarker ? "present" : "ambiguous",
      hasPrimaryFilingMarker && hasAny(lowerText, ["registration statement", "proxy statement/prospectus", "prospectus"])
        ? "high"
        : "medium",
      "The primary body should include registration statement/prospectus or transaction heading text.",
      firstSnippet(text, [
        "registration statement",
        "proxy statement/prospectus",
        "joint proxy statement/prospectus",
        "prospectus",
        "offer to exchange",
        "exchange offer",
        "business combination",
        "merger",
      ]),
    ),
    rawCheck(
      "exhibit_inventory",
      "Exhibit inventory",
      exhibits.count > 0 ? "present" : "ambiguous",
      exhibits.count > 0 ? "high" : "medium",
      "The raw packet should preserve exhibit type, description, and filed-herewith status when available.",
      exhibits.items.map((item) => `${item.type} ${item.description}`.trim()).join("; "),
    ),
    rawCheck(
      "amendment_marker",
      "Amendment marker",
      !fixture.formType.endsWith("/A")
        ? "not_applicable"
        : hasAny(lowerText, ["amendment no.", "amendment number", "this amendment", "supplement no."])
          ? "present"
          : "ambiguous",
      !fixture.formType.endsWith("/A") ? "high" : "medium",
      fixture.formType.endsWith("/A")
        ? "Amended forms should preserve the explicit amendment/supplement marker when present."
        : "Base S-4/F-4 forms do not require an amendment marker.",
      firstSnippet(text, ["amendment no.", "amendment number", "this amendment", "supplement no."]),
    ),
    rawCheck(
      "primary_body_not_sec_index",
      "Primary body is not SEC index boilerplate",
      sourcePacket.isIndexLike || sourcePacket.sourceAvailability === "index_or_inventory_only" ? "missing" : "present",
      sourcePacket.isIndexLike || sourcePacket.sourceAvailability === "index_or_inventory_only" ? "low" : "high",
      "The parser should receive the filing body, not only the SEC filing index page.",
      sourcePacket.isIndexLike ? firstSnippet(rawInput, ["document format files", "edgar filing documents"]) : null,
    ),
  ];

  const spacSourceSnippet = firstUsefulSnippet(text, [
    "public stockholders may elect to redeem",
    "public shareholders may elect to redeem",
    "redeem their public shares",
    "redemption rights",
    "trust account",
    "minimum cash condition",
    "sponsor support",
    "founder shares",
    "earnout",
    "warrant treatment",
    "expected ticker",
  ], false, { sectionKey: "spac_de_spac_terms", formType: fixture.formType });
  const f4CrossBorderSnippet = fixture.formType.startsWith("F-4")
    ? firstUsefulSnippet(text, [
        "american depositary shares",
        "ordinary shares",
        "each ads represents",
        "scheme of arrangement",
        "court approval",
        "court sanction",
        "foreign private issuer",
        "foreign law",
      ], false, { sectionKey: "f4_cross_border_terms", formType: fixture.formType })
    : null;

  const optionalItems: RawItemCheck[] = [
    rawCheck(
      "proxy_or_prospectus_block",
      "Proxy/prospectus block",
      structure.hasProxyStatementProspectus ? "present" : "missing",
      structure.hasProxyStatementProspectus ? "high" : "medium",
      "Useful raw block for router/analysis when the filing is a merger or vote document.",
      firstSnippet(text, ["proxy statement/prospectus", "joint proxy statement/prospectus"]),
    ),
    rawCheck(
      "vote_block",
      "Vote block",
      hasAny(lowerText, ["special meeting", "shareholder approval", "stockholder approval", "vote to approve"])
        ? "present"
        : "missing",
      "medium",
      "Vote language should be preserved as raw evidence, but the parser should not assign the final event type.",
      firstSnippet(text, ["special meeting", "shareholder approval", "stockholder approval", "vote to approve"]),
    ),
    rawCheck(
      "consideration_terms",
      "Consideration terms",
      hasAny(lowerText, ["exchange ratio", "cash per share", "no fractional shares", "cash in lieu"])
        ? "present"
        : "missing",
      "medium",
      "Consideration snippets are must-keep raw material when present.",
      firstSnippet(text, ["exchange ratio", "cash per share", "no fractional shares", "cash in lieu"]),
    ),
    rawCheck(
      "exchange_offer_heading",
      "Exchange offer heading",
      hasAny(lowerText, ["offer to exchange", "terms of the exchange offer", "exchange offer and withdrawal rights"])
        ? "present"
        : "missing",
      "medium",
      "Only heading-style exchange offer language should be promoted for downstream interpretation.",
      firstSnippet(text, ["offer to exchange", "terms of the exchange offer", "exchange offer and withdrawal rights"]),
    ),
    rawCheck(
      "debt_security_terms",
      "Debt security terms",
      hasAny(lowerText, ["old notes", "new notes", "exchange notes", "senior notes due"])
        ? "present"
        : "missing",
      "medium",
      "Debt exchange filings need old/new security raw snippets, but parser should not assign investor impact.",
      firstSnippet(text, ["old notes", "new notes", "exchange notes", "senior notes due"]),
    ),
    rawCheck(
      "risk_factors",
      "Risk factors",
      structure.hasRiskFactors ? "present" : "missing",
      "medium",
      "Risk factor sections should be preserved for the analysis LLM when present.",
      firstSnippet(text, ["risk factors"]),
    ),
    rawCheck(
      "pro_forma_financials",
      "Pro forma financials",
      structure.hasProFormaFinancials ? "present" : "missing",
      "medium",
      "Pro forma blocks are raw inputs for analysis, not parser conclusions.",
      firstSnippet(text, ["unaudited pro forma", "pro forma condensed combined financial"]),
    ),
    rawCheck(
      "support_lockup_pipe_terms",
      "Support, lock-up, PIPE, or backstop terms",
      hasAny(lowerText, ["support agreement", "voting agreement", "lock-up", "subscription agreement", "pipe financing", "backstop agreement", "non-redemption agreement"])
        ? "present"
        : "missing",
      "medium",
      "Support, voting, lock-up, PIPE, and backstop snippets are must-keep source material when present.",
      firstSnippet(text, ["support agreement", "voting agreement", "lock-up", "subscription agreement", "pipe financing", "backstop agreement", "non-redemption agreement"]),
    ),
    rawCheck(
      "termination_terms",
      "Termination and no-shop terms",
      hasAny(lowerText, ["termination fee", "reverse termination fee", "outside date", "no-shop", "non-solicitation", "go-shop"])
        ? "present"
        : "missing",
      "medium",
      "Termination fee, outside date, and no-shop snippets are must-keep source material when present.",
      firstSnippet(text, ["termination fee", "reverse termination fee", "outside date", "no-shop", "non-solicitation", "go-shop"]),
    ),
    rawCheck(
      "spac_de_spac_terms",
      "SPAC/de-SPAC terms",
      spacSourceSnippet
        ? "present"
        : "missing",
      "medium",
      "SPAC/de-SPAC mechanics should be preserved as source blocks when present.",
      spacSourceSnippet,
    ),
    rawCheck(
      "f4_cross_border_terms",
      "F-4 cross-border or ADS terms",
      f4CrossBorderSnippet
        ? "present"
        : fixture.formType.startsWith("F-4")
          ? "ambiguous"
          : "not_applicable",
      fixture.formType.startsWith("F-4") ? "medium" : "high",
      "F-4 filings should preserve ADS, ordinary-share, scheme, court, or foreign-law mechanics when available.",
      f4CrossBorderSnippet,
    ),
    rawCheck(
      "filing_fee_table",
      "Filing fee table",
      hasAny(rawLower, ["maximum aggregate offering price", "amount of registration fee", "calculation of registration fee", "fee table"])
        ? "noise"
        : "missing",
      "high",
      "Fee-table numbers should be treated as registration-fee context, not merger consideration.",
      firstSnippet(rawInput, ["maximum aggregate offering price", "amount of registration fee", "calculation of registration fee", "fee table"]),
    ),
    rawCheck(
      "exhibits_only_omission_language",
      "Exhibits-only omission language",
      structure.isExhibitsOnly ? "present" : "missing",
      structure.isExhibitsOnly ? "high" : "medium",
      "This language is boilerplate-like but must be kept because it explains missing body text.",
      firstSnippet(text, ["exhibits-only filing", "remainder of the registration statement is unchanged", "has therefore been omitted"]),
    ),
  ];

  const noiseCandidates = buildNoiseCandidates(rawInput, rawLower, exhibits);
  const missingRequiredItems = requiredItems
    .filter((item) => item.status === "missing")
    .map((item) => item.item);
  const ambiguousItems = requiredItems
    .filter((item) => item.status === "ambiguous")
    .map((item) => item.item);

  return {
    sourceAvailability: sourcePacket.sourceAvailability,
    primaryTextChars: primaryText.length,
    normalizedTextChars: text.length,
    requiredItems,
    optionalItems,
    missingRequiredItems,
    ambiguousItems,
    noiseCandidates,
    mustKeepItems: [
      "primary_document_text",
      "cover_metadata",
      "registrant_or_party_metadata",
      "primary_filing_marker",
      "exhibit_inventory",
      "amendment_marker_when_form_is_amended",
      "vote_block_when_present",
      "consideration_terms_when_present",
      "exchange_offer_heading_when_present",
      "debt_security_terms_when_present",
      "support_lockup_pipe_terms_when_present",
      "termination_terms_when_present",
      "spac_de_spac_terms_when_present",
      "f4_cross_border_terms_when_present",
      "pro_forma_financials_when_present",
      "exhibits_only_omission_language_when_present",
    ],
    shouldDropItems: [
      "complete_submission_wrapper",
      "sec_header_block",
      "multi_document_submission",
      "submission_document_metadata_tags",
      "sec_index_navigation",
      "html_markup",
      "inline_css_class_attributes",
      "html_comments",
      "encoded_binary_payloads",
      "script_style_markup",
      "graphic_attachments",
      "inline_xbrl_tag_noise",
      "filing_fee_table_numbers_as_deal_consideration",
      "table_of_contents_without_following_body",
      "duplicated_signature_pages_unless_exhibits_only_or_signature_only",
      "generic_consent_power_of_attorney_signature_pages",
      "generic_s4_f4_risk_factor_boilerplate",
    ],
  };
}

function rawCheck(
  item: string,
  label: string,
  status: RawItemCheck["status"],
  confidence: RawItemCheck["confidence"],
  reason: string,
  sourceText: string | null,
): RawItemCheck {
  return {
    item,
    label,
    status,
    confidence,
    reason,
    evidence: sourceText ? [{ label, value: status, sourceText }] : [],
  };
}

function buildNoiseCandidates(
  rawInput: string,
  rawLower: string,
  exhibits: S4F4Facts["exhibits"],
): NoiseCandidate[] {
  const noise: NoiseCandidate[] = [];
  const graphicCount = exhibits.items.filter((item) => item.type.toUpperCase() === "GRAPHIC").length;
  const documentBlockCount = countMatches(rawInput, /<DOCUMENT>/gi);
  const documentMetadataTagCount = countMatches(rawInput, /<(TYPE|SEQUENCE|FILENAME|DESCRIPTION)>/gi);
  const htmlTagCount = countMatches(rawInput, /<\/?[a-z][^>]{0,300}>/gi);
  const inlineCssAttributeCount = countMatches(rawInput, /\s(?:style|class)\s*=/gi);
  const htmlCommentCount = countMatches(rawInput, /<!--[\s\S]*?-->/g);
  const encodedBinaryLineCount = countEncodedBinaryLines(rawInput);
  const feeTableCount = countMatches(rawInput, /(maximum aggregate offering price|amount of registration fee|calculation of registration fee|fee table|proposed maximum offering price|fee rate)/gi);
  const signatureConsentCount = countMatches(rawInput, /(signature page|power of attorney|accountants?'? consent|auditor consent|expert consent|we consent to the incorporation by reference)/gi);

  if (rawLower.includes("<sec-document>")) {
    noise.push({
      item: "complete_submission_wrapper",
      count: countMatches(rawInput, /<SEC-DOCUMENT>/gi),
      reason: "Complete submission wrapper should be used for document splitting, not passed as body prose.",
      evidence: [],
    });
  }

  if (rawLower.includes("<sec-header>")) {
    noise.push({
      item: "sec_header_block",
      count: countMatches(rawInput, /<SEC-HEADER>/gi),
      reason: "SEC header metadata should be parsed separately from the filing body.",
      evidence: [],
    });
  }

  if (documentBlockCount > 1) {
    noise.push({
      item: "multi_document_submission",
      count: documentBlockCount,
      reason: "Complete submissions often include the primary filing plus exhibits, XML, graphics, and other documents.",
      evidence: [],
    });
  }

  if (documentMetadataTagCount > 0) {
    noise.push({
      item: "submission_document_metadata_tags",
      count: documentMetadataTagCount,
      reason: "Submission document tags should define inventory boundaries rather than become LLM text.",
      evidence: [],
    });
  }

  if (graphicCount > 0) {
    noise.push({
      item: "graphic_attachments",
      count: graphicCount,
      reason: "Graphic attachments are usually not useful text input for router/analysis.",
      evidence: [],
    });
  }

  if (htmlTagCount > 1_000) {
    noise.push({
      item: "html_markup",
      count: htmlTagCount,
      reason: "Large volumes of HTML tags should be stripped after preserving structural boundaries.",
      evidence: [],
    });
  }

  if (inlineCssAttributeCount > 500) {
    noise.push({
      item: "inline_css_class_attributes",
      count: inlineCssAttributeCount,
      reason: "Inline style/class attributes are formatting noise for downstream LLMs.",
      evidence: [],
    });
  }

  if (htmlCommentCount > 50) {
    noise.push({
      item: "html_comments",
      count: htmlCommentCount,
      reason: "Large HTML comment blocks are formatting or conversion artifacts.",
      evidence: [],
    });
  }

  if (hasAny(rawLower, ["<script", "<style"])) {
    noise.push({
      item: "script_style_markup",
      count: (rawInput.match(/<(script|style)\b/gi) ?? []).length,
      reason: "Script/style markup should be stripped before LLM routing.",
      evidence: [],
    });
  }

  if (hasAny(rawLower, ["document format files", "edgar filing documents"])) {
    noise.push({
      item: "sec_index_navigation",
      count: 1,
      reason: "SEC index/navigation text should not be treated as filing body.",
      evidence: [],
    });
  }

  if (rawLower.includes("table of contents")) {
    noise.push({
      item: "table_of_contents_or_page_navigation",
      count: countMatches(rawInput, /table of contents/gi),
      reason: "Table-of-contents rows and page navigation should not be promoted unless body text follows the heading.",
      evidence: [],
    });
  }

  if (hasAny(rawLower, ["<ix:", "xmlns:ix", "us-gaap:", "dei:", "<xbrl", "ex-101", "<xsd"])) {
    noise.push({
      item: "inline_xbrl_tag_noise",
      count: countMatches(rawInput, /(<ix:|xmlns:ix|us-gaap:|dei:|<xbrl|EX-101|<xsd)/gi),
      reason: "Inline XBRL tags and taxonomy documents should become structured metadata or be stripped from body text.",
      evidence: [],
    });
  }

  if (feeTableCount > 0) {
    noise.push({
      item: "filing_fee_table",
      count: feeTableCount,
      reason: "Filing-fee table amounts should not be used as merger consideration, transaction value, or dilution evidence.",
      evidence: [],
    });
  }

  if (signatureConsentCount > 0) {
    noise.push({
      item: "generic_signature_consent_poa",
      count: signatureConsentCount,
      reason: "Generic signatures, consents, and powers of attorney are low-priority unless the source block is a transaction support/voting agreement.",
      evidence: [],
    });
  }

  if (encodedBinaryLineCount > 0) {
    noise.push({
      item: "encoded_binary_payloads",
      count: encodedBinaryLineCount,
      reason: "Encoded binary-like payload lines should be excluded from LLM text packets.",
      evidence: [],
    });
  }

  const riskBoilerplateCount = countRiskBoilerplateMentions(rawLower);
  if (riskBoilerplateCount > 0) {
    noise.push({
      item: "s4_f4_risk_factor_boilerplate",
      count: riskBoilerplateCount,
      reason: "Generic S-4/F-4 risk-factor, litigation, regulatory approval, and closing-condition language should not drive event routing by itself.",
      evidence: [],
    });
  }

  return noise;
}

function countRiskBoilerplateMentions(rawLower: string): number {
  return [
    "risk factors",
    "risks related to",
    "may delay or prevent",
    "could delay or prevent",
    "customary closing conditions",
    "absence of any injunction",
    "regulatory approvals may be required",
    "delays in obtaining",
    "lawsuits may be filed",
  ].reduce((count, phrase) => count + countMatches(rawLower, new RegExp(escapeRegExp(phrase), "g")), 0);
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function countEncodedBinaryLines(value: string): number {
  let count = countMatches(value, /^begin [0-7]{3} /gim);
  const lines = value.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 200 && /^[A-Za-z0-9+/=]+$/.test(trimmed)) {
      count += 1;
    }
  }

  return count;
}

function detectTransactionType(
  lowerText: string,
  formType: string,
  documentKind: S4F4Facts["structure"]["documentKind"],
): S4F4Facts["transaction"]["type"] {
  if (documentKind === "exhibits_only_amendment" || documentKind === "notes_exchange_offer") {
    return formType.endsWith("/A") ? "amendment_update" : "unknown";
  }

  if (lowerText.includes("exchange offer")) {
    return "exchange_offer";
  }

  if (formType.startsWith("F-4") || lowerText.includes("cross-border") || lowerText.includes("business combination")) {
    return "cross_border_business_combination";
  }

  if (lowerText.includes("share exchange")) {
    return "share_exchange";
  }

  if (lowerText.includes("merger")) {
    return "merger";
  }

  if (formType.endsWith("/A")) {
    return "amendment_update";
  }

  return "unknown";
}

function extractCashPerShare(text: string): number | null {
  const cashMatch = text.match(/\$([0-9]+(?:\.[0-9]+)?)\s+(?:in\s+)?cash(?:\s+per\s+share)?/i);
  return cashMatch ? Number(cashMatch[1]) : null;
}

function extractStockRatio(text: string): number | null {
  const ratioPatterns = [
    /exchange ratio (?:of|is|to)\s+([0-9]+(?:\.[0-9]+)?)/i,
    /receive\s+([0-9]+(?:\.[0-9]+)?)\s+(?:shares|ordinary shares|ADSs?|American depositary shares)/i,
    /([0-9]+(?:\.[0-9]+)?)\s+(?:shares|ordinary shares|ADSs?|American depositary shares)\s+(?:of\s+)?[A-Za-z0-9 .,&-]+?\s+(?:for|in exchange for)\s+each/i,
  ];

  for (const pattern of ratioPatterns) {
    const match = text.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function extractRegisteredShares(text: string): number | null {
  const match = text.match(/register(?:s|ing)?\s+(?:up to\s+)?([0-9,.]+)\s+(?:shares|ordinary shares|ADSs?|American depositary shares)/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function extractDateNear(text: string, anchors: string[]): string | null {
  for (const anchor of anchors) {
    const pattern = new RegExp(`${escapeRegExp(anchor)}.{0,120}?(${MONTH_PATTERN})`, "i");
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractConsiderationNotes(text: string): string[] {
  const notes: string[] = [];
  const snippets = [
    findSnippet(text, "cash in lieu"),
    findSnippet(text, "exchange ratio"),
    findSnippet(text, "no interest"),
    findSnippet(text, "no fractional shares"),
  ].filter((snippet): snippet is string => Boolean(snippet));

  for (const snippet of snippets) {
    if (!notes.includes(snippet)) {
      notes.push(snippet);
    }
  }

  return notes;
}

function extractVoteProposal(text: string): string | null {
  const proposalSnippet =
    findSnippet(text, "proposal to approve") ??
    findSnippet(text, "vote to approve") ??
    findSnippet(text, "shareholder approval");

  return proposalSnippet;
}

function extractChangedSections(
  lowerText: string,
  flags: { materialChange: boolean; routineAdministrative: boolean },
): string[] {
  const sections: string[] = [];

  if (flags.materialChange && hasAny(lowerText, ["exchange ratio", "consideration"])) {
    sections.push("transaction consideration");
  }

  if (flags.materialChange && lowerText.includes("financing condition")) {
    sections.push("closing conditions");
  }

  if (flags.materialChange && lowerText.includes("risk factor")) {
    sections.push("risk factors");
  }

  if (flags.routineAdministrative && lowerText.includes("exhibit")) {
    sections.push("exhibits");
  }

  if (flags.routineAdministrative && lowerText.includes("signature")) {
    sections.push("signatures");
  }

  return sections;
}

function collectEvidence(
  text: string,
  flags: {
    transactionType: S4F4Facts["transaction"]["type"];
    voteRequired: boolean;
    shareIssuanceMentioned: boolean;
    legalRisk: boolean;
    financialRisk: boolean;
    regulatoryApprovalRisk: boolean;
    materialChange: boolean;
    routineAdministrative: boolean;
    structure: S4F4Facts["structure"];
    exchangeOffer: S4F4Facts["exchangeOffer"];
  },
): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  addEvidence(evidence, "document structure", flags.structure.documentKind, findSnippet(text, flags.structure.documentKind.replace(/_/g, " ")));
  addEvidence(evidence, "exhibits-only amendment", "exhibits-only filing", flags.structure.isExhibitsOnly ? findSnippet(text, "exhibits-only filing") ?? findSnippet(text, "remainder of the Registration Statement is unchanged") : null);
  addEvidence(evidence, "exchange offer", flags.exchangeOffer.kind, flags.exchangeOffer.present ? findSnippet(text, "Offer to Exchange") ?? findSnippet(text, "Exchange Offer") : null);
  addEvidence(evidence, "consent solicitation", "consent solicitation", flags.exchangeOffer.hasConsentSolicitation ? findSnippet(text, "Consent Solicitation") : null);
  addEvidence(evidence, "rights offering", "rights offering", flags.exchangeOffer.hasRightsOffering ? findSnippet(text, "Rights Offering") : null);
  addEvidence(evidence, "transaction", flags.transactionType, findSnippet(text, flags.transactionType.replace(/_/g, " ")));
  addEvidence(evidence, "merger", "merger", findSnippet(text, "merger"));
  addEvidence(evidence, "vote", "shareholder vote", flags.voteRequired ? findSnippet(text, "special meeting") ?? findSnippet(text, "shareholder approval") : null);
  addEvidence(evidence, "dilution", "share issuance", flags.shareIssuanceMentioned ? findSnippet(text, "register") ?? findSnippet(text, "issuance") : null);
  addEvidence(evidence, "legal update", "source-backed legal update", flags.legalRisk ? findNonBoilerplateSnippet(text, ["litigation", "lawsuit", "injunction", "legal proceeding"]) : null);
  addEvidence(evidence, "financial update", "source-backed financial update", flags.financialRisk ? findNonBoilerplateSnippet(text, ["financing condition", "minimum cash condition", "debt restructuring", "going concern"]) : null);
  addEvidence(evidence, "regulatory update", "source-backed regulatory update", flags.regulatoryApprovalRisk ? findNonBoilerplateSnippet(text, ["regulatory approval", "antitrust approval", "foreign investment approval"]) : null);
  addEvidence(evidence, "material amendment", "material amendment", flags.materialChange ? findSnippet(text, "material change") ?? findSnippet(text, "revised") : null);
  addEvidence(evidence, "routine amendment", "routine amendment", flags.routineAdministrative ? findSnippet(text, "solely to file") ?? findSnippet(text, "no change") : null);

  return evidence;
}

function addEvidence(evidence: EvidenceItem[], label: string, value: string, sourceText: string | null): void {
  if (!sourceText) {
    return;
  }

  if (evidence.some((item) => item.label === label && item.sourceText === sourceText)) {
    return;
  }

  evidence.push({ label, value, sourceText });
}

function firstSnippet(text: string, needles: string[]): string | null {
  for (const needle of needles) {
    const snippet = findSnippet(text, needle);
    if (snippet) {
      return snippet;
    }
  }

  return null;
}

function findSnippet(text: string, needle: string): string | null {
  const lowerText = text.toLowerCase();
  const index = lowerText.indexOf(needle.toLowerCase());
  if (index === -1) {
    return null;
  }

  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + needle.length + 140);
  return text.slice(start, end).trim();
}

function findNonBoilerplateSnippet(text: string, needles: string[]): string | null {
  for (const snippet of snippetsForNeedles(text, needles)) {
    const lowerSnippet = snippet.toLowerCase();
    if (!isRiskBoilerplateSnippet(lowerSnippet) && !isTocLikeSnippet(lowerSnippet)) {
      return snippet.trim();
    }
  }

  return firstSnippet(text, needles);
}

function describeTransaction(type: S4F4Facts["transaction"]["type"], fixture: S4F4Fixture): string | null {
  const target = fixture.participants.find((participant) => participant.role === "target");
  const acquirer = fixture.participants.find((participant) => participant.role === "acquirer");

  if (type === "unknown") {
    return null;
  }

  if (type === "exchange_offer") {
    return `${fixture.companyName} registration statement for an exchange offer.`;
  }

  if (target && acquirer) {
    return `${acquirer.name} and ${target.name} ${type.replace(/_/g, " ")}.`;
  }

  return `${fixture.companyName} ${type.replace(/_/g, " ")} filing.`;
}

function buildSummary(facts: S4F4Facts): string {
  const missingCount = facts.rawExtraction.missingRequiredItems.length;
  const ambiguousCount = facts.rawExtraction.ambiguousItems.length;

  return `${facts.secFormType} raw extraction packet prepared with ${facts.rawExtraction.normalizedTextChars} normalized text characters, ${facts.exhibits.count} exhibit rows, ${missingCount} missing required raw items, and ${ambiguousCount} ambiguous raw items.`;
}

function buildCalendarItems(facts: S4F4Facts): CalendarItem[] {
  const items: CalendarItem[] = [];

  if (facts.vote.meetingDate) {
    items.push({
      date: facts.vote.meetingDate,
      label: "Shareholder meeting",
      type: "meeting",
    });
  }

  if (facts.vote.recordDate) {
    items.push({
      date: facts.vote.recordDate,
      label: "Shareholder vote record date",
      type: "record_date",
    });
  }

  return items;
}

function buildWarnings(facts: S4F4Facts, isSupported: boolean): string[] {
  const warnings: string[] = [];

  if (!isSupported) {
    warnings.push("Unsupported form type for the s4-f4 room.");
  }

  if (
    facts.rawExtraction.sourceAvailability === "index_or_inventory_only" ||
    facts.rawExtraction.sourceAvailability === "graphic_or_binary_only" ||
    facts.rawExtraction.sourceAvailability === "empty_or_too_short"
  ) {
    warnings.push(
      `Primary filing body unavailable (${facts.rawExtraction.sourceAvailability}); do not send this packet to router or analysis LLM.`,
    );
  }

  for (const missingItem of facts.rawExtraction.missingRequiredItems) {
    warnings.push(`Missing required raw item: ${missingItem}.`);
  }

  for (const ambiguousItem of facts.rawExtraction.ambiguousItems) {
    warnings.push(`Ambiguous raw item: ${ambiguousItem}; downstream LLM should not guess from absent source evidence.`);
  }

  for (const noiseCandidate of facts.rawExtraction.noiseCandidates) {
    warnings.push(`Noise candidate detected: ${noiseCandidate.item} (${noiseCandidate.count}).`);
  }

  if (facts.structure.documentKind === "notes_exchange_offer") {
    warnings.push("Notes exchange raw headings detected; router/analysis should interpret old/new security mechanics.");
  }

  if (facts.exchangeOffer.kind === "mixed_restructuring") {
    warnings.push("Exchange-offer raw packet includes restructuring-like language; parser did not assign investor interpretation.");
  }

  if (facts.structure.isExhibitsOnly) {
    warnings.push("Exhibits-only omission language was preserved; missing body text may be expected.");
  }

  if (facts.participants.filter((participant) => participant.role === "registrant").length > 1 || facts.structure.hasCoRegistrantTable) {
    warnings.push("Multiple registrants or co-registrants detected; primary company role should be interpreted downstream.");
  }

  return warnings;
}
