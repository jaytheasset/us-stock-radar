import type {
  SecFormParserAttachment,
  SecFormParserCalendarItem,
  SecFormParserInput,
  SecFormParserOutput,
} from "../common/parserContract";
import type {
  SecS4F4AmendmentInfo,
  SecS4F4CountField,
  SecS4F4DateField,
  SecS4F4DealType,
  SecS4F4DocumentSummary,
  SecS4F4Facts,
  SecS4F4Field,
  SecS4F4MoneyField,
  SecS4F4Party,
  SecS4F4PartyRole,
  SecS4F4ReadingPackage,
  SecS4F4ShareholderVoteTerms,
  SecS4F4TransactionTerms,
} from "./types";

export const SEC_S4_F4_PARSER_VERSION = "sec_s4_f4_parser_v1";

type RawDocumentPayload = {
  type?: unknown;
  description?: unknown;
  filename?: unknown;
  document?: unknown;
  url?: unknown;
  isPrimary?: unknown;
  text?: unknown;
  textCharCount?: unknown;
  textTruncated?: unknown;
};

type PatternCandidate<T extends string = string> = {
  value: T;
  pattern: RegExp;
  confidence: "high" | "medium" | "low";
};

const S4_F4_FORMS = new Set(["S-4", "S-4/A", "F-4", "F-4/A"]);
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

const DATE_TEXT_PATTERN =
  "(?:[A-Z][a-z]+\\s+\\d{1,2},\\s+\\d{4}|(?:first|second|third|fourth)\\s+quarter\\s+of\\s+\\d{4}|Q[1-4]\\s+\\d{4}|\\d{4})";

export function parseSecS4F4Filing(input: SecFormParserInput): SecFormParserOutput<SecS4F4Facts> {
  const rawPayload = toRecord(input.rawPayload) || {};
  const metadata = toRecord(input.metadata) || {};
  const formType = resolveS4F4FormType(input, rawPayload, metadata);
  const documents = buildDocumentSummaries(input, rawPayload);
  const textBundle = buildTextBundle(input, rawPayload);
  const combinedText = compactText([input.title, textBundle.primaryText, textBundle.attachmentText].filter(Boolean).join("\n\n"));
  const formText = extractPrimaryFormText(combinedText, formType);
  const issuer =
    nullableString(input.companyName) ||
    nullableString(rawPayload.company_name) ||
    nullableString(metadata.company_name) ||
    nullableString(metadata.issuer) ||
    readIssuerFromText(formText, formType);
  const ticker = nullableString(input.ticker) || nullableString(rawPayload.ticker) || nullableString(metadata.ticker);
  const amendment = buildAmendmentInfo(formText, formType);
  const transaction = buildTransactionTerms(formText, issuer);
  const shareholderVote = buildShareholderVoteTerms(formText);
  const calendarCandidates = buildCalendarCandidates(transaction, shareholderVote);
  const llmReadingPackage = buildReadingPackage(formText, transaction, shareholderVote);
  const extractedFieldCount = countExtractedFields(transaction, shareholderVote, amendment);
  const reviewReasons = buildReviewReasons({
    amendment,
    formText,
    formType,
    shareholderVote,
    transaction,
  });
  const facts: SecS4F4Facts = {
    parser_version: SEC_S4_F4_PARSER_VERSION,
    raw_item_id: nullableString(input.rawItemId),
    accession_number: nullableString(input.accessionNumber) || nullableString(rawPayload.accession_number),
    form_type: formType || normalizeForm(input.formType) || input.formType,
    is_s4_f4_family: isS4F4Family(formType),
    issuer,
    ticker,
    filed_at: nullableString(input.filedAt),
    source_url: nullableString(input.sourceUrl) || nullableString(rawPayload.detail_url),
    documents,
    amendment,
    transaction,
    shareholder_vote: shareholderVote,
    calendar_candidates: calendarCandidates,
    llm_reading_package: llmReadingPackage,
    extracted_field_count: extractedFieldCount,
    needs_human_review: reviewReasons.some((reason) => reason !== "limited_scope_amendment"),
    review_reasons: reviewReasons,
    text_stats: {
      primary_chars: textBundle.primaryText.length,
      attachment_chars: textBundle.attachmentText.length,
      combined_chars: combinedText.length,
    },
  };

  return {
    parserVersion: SEC_S4_F4_PARSER_VERSION,
    parserGroup: "s4-f4",
    formType: facts.form_type,
    accessionNumber: facts.accession_number,
    isSupported: facts.is_s4_f4_family,
    summary: buildSummary(facts),
    facts,
    signals: buildSignals(facts),
    calendarItems: calendarCandidates,
    warnings: reviewReasons,
    raw: {
      text_truncated: formText.length < combinedText.length,
      document_count: documents.length,
    },
  };
}

export const parseSecS4F4 = parseSecS4F4Filing;

function buildTransactionTerms(text: string, issuer: string | null): SecS4F4TransactionTerms {
  const dealType = findDealType(text);
  const transactionStructure = findTransactionStructure(text);
  const consideration = findSentenceField(text, [
    /\b(?:merger consideration|transaction consideration|consideration to be received|offer consideration)\b[\s\S]{0,520}?[.]/i,
    /\b(?:each share|each outstanding share|each ordinary share|each common share|each unit|each [A-Z][A-Za-z0-9&.,' -]{2,90}? share)[\s\S]{0,520}?\b(?:converted into|exchanged for|may be exchanged for|right to receive)\b[\s\S]{0,520}?[.]/i,
  ]);
  const cashConsideration = findMoneyField(text, [
    /\b(?:cash consideration|in cash|cash portion|cash election)[^.\n]{0,180}?(\$[\d,.]+(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    /\b(\$[\d,.]+(?:\s*(?:thousand|million|billion|m|bn))?)\s+(?:in\s+cash|cash)\s+(?:per\s+share|for\s+each|consideration)\b/i,
  ]);
  const stockConsideration = findSentenceField(text, [
    /\b(?:stock consideration|share consideration|equity consideration)\b[\s\S]{0,420}?[.]/i,
    /\b(?:right to receive|exchanged for|converted into)\b[\s\S]{0,360}?\b(?:shares?|ordinary shares|common stock|ADSs?|American Depositary Shares)\b[\s\S]{0,240}?[.]/i,
  ]);
  const exchangeRatio = findSentenceField(text, [
    /\bexchange ratio\b[\s\S]{0,320}?[.]/i,
    /\b\d+(?:\.\d+)?\s+(?:shares?|ordinary shares|common shares|ADSs?)\b[\s\S]{0,220}?\b(?:for each|per)\s+(?:share|unit|ordinary share|common share)\b[\s\S]{0,220}?[.]/i,
    /\b(?:converted into|exchanged for|may be exchanged for)\s+\d+(?:\.\d+)?\s+(?:shares?|ordinary shares|common shares|ADSs?)\b[\s\S]{0,240}?[.]/i,
  ]);
  const cashStockMix = findSentenceField(text, [
    /\b(?:cash and stock|stock and cash|cash\/stock|cash-stock)\b[\s\S]{0,420}?[.]/i,
    /\b(?:cash portion|stock portion)\b[\s\S]{0,420}?[.]/i,
  ]);
  const securitiesRegistered = findSecuritiesRegistered(text);
  const sharesToBeIssued = findShareCountField(text, [
    /\b(?:registering|registers|registered|to be registered)[^.\n]{0,220}?(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares|common shares|ADSs?|American Depositary Shares))\b/i,
    /\b(?:issue|issuance|issued|issuable|deliver|delivered)[^.\n]{0,220}?(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares|common shares|ADSs?|American Depositary Shares))\b/i,
    /\b(\d[\d,.]*(?:\s*(?:thousand|million|billion|m|bn))?\s+(?:shares?|ordinary shares|common shares|ADSs?|American Depositary Shares))\s+(?:will\s+be|are\s+being)?\s*(?:issued|issuable|registered|delivered)\b/i,
  ]);
  const ownershipAfterTransaction = findOwnershipFields(text);
  const conditions = findConditionFields(text);
  const terminationFee = findMoneyField(text, [
    /\b(?:termination fee|break[- ]?up fee|reverse termination fee)[^.\n]{0,180}?(\$[\d,.]+(?:\s*(?:thousand|million|billion|m|bn))?)/i,
    /\b(\$[\d,.]+(?:\s*(?:thousand|million|billion|m|bn))?)\s+(?:termination fee|break[- ]?up fee|reverse termination fee)\b/i,
  ]);
  const outsideDate = findDateField(text, [
    {
      pattern: new RegExp(`\\b(?:outside date|end date|termination date)\\b[^.\\n]{0,220}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "medium",
    },
  ]);
  const expectedClosing = findDateField(text, [
    {
      pattern: new RegExp(`\\b(?:expected|anticipated|currently expect|intend)\\b[^.\\n]{0,160}?\\b(?:closing|close|completion|complete)\\b[^.\\n]{0,180}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "medium",
    },
    {
      pattern: new RegExp(`\\b(?:closing|completion)\\b[^.\\n]{0,120}?\\b(?:expected|anticipated)\\b[^.\\n]{0,180}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "medium",
    },
  ]);
  const exchangeOfferExpiration = findDateField(text, [
    {
      pattern: new RegExp(`\\b(?:exchange offer|offer)\\b[\\s\\S]{0,220}?\\b(?:expire|expires|expiration)\\b[\\s\\S]{0,160}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "medium",
    },
    {
      pattern: new RegExp(`\\b(?:expire|expires|expiration)\\b[\\s\\S]{0,160}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "low",
    },
  ]);
  const riskFactorExcerpt = findSectionField(text, "risk factors", 900);
  const financialStatementsReference = findSentenceField(text, [
    /\b(?:financial statements|historical financial statements|audited financial statements)\b[\s\S]{0,420}?[.]/i,
  ]);
  const proFormaReference = findSentenceField(text, [
    /\b(?:unaudited pro forma|pro forma condensed combined|pro forma financial information)\b[\s\S]{0,520}?[.]/i,
  ]);

  return {
    deal_type: dealType,
    transaction_structure: transactionStructure,
    parties: findParties(text, issuer),
    consideration,
    cash_consideration: cashConsideration,
    stock_consideration: stockConsideration,
    exchange_ratio: exchangeRatio,
    cash_stock_mix: cashStockMix,
    securities_registered: securitiesRegistered,
    shares_to_be_issued: sharesToBeIssued,
    ownership_after_transaction: ownershipAfterTransaction,
    conditions,
    termination_fee: terminationFee,
    outside_date: outsideDate,
    expected_closing: expectedClosing,
    exchange_offer_expiration: exchangeOfferExpiration,
    risk_factor_excerpt: riskFactorExcerpt,
    financial_statements_reference: financialStatementsReference,
    pro_forma_reference: proFormaReference,
  };
}

function buildShareholderVoteTerms(text: string): SecS4F4ShareholderVoteTerms {
  const meetingDate = findDateField(text, [
    {
      pattern: new RegExp(`\\b(?:special|annual|extraordinary)?\\s*(?:meeting|shareholder meeting|stockholder meeting|general meeting)\\b[\\s\\S]{0,240}?\\b(?:held|scheduled|convened|will be held|to be held|on)\\b[\\s\\S]{0,120}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "high",
    },
    {
      pattern: new RegExp(`\\b(?:${DATE_TEXT_PATTERN})\\b[^.\\n]{0,180}?\\b(?:special|annual|extraordinary)?\\s*(?:meeting|shareholder meeting|stockholder meeting|general meeting)\\b`, "i"),
      confidence: "medium",
    },
  ]);
  const recordDate = findDateField(text, [
    {
      pattern: new RegExp(`\\brecord date\\b[^.\\n]{0,220}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "high",
    },
  ]);
  const voteDeadline = findDateField(text, [
    {
      pattern: new RegExp(`\\b(?:proxy|vote|voting|redemption)\\b[^.\\n]{0,160}?\\b(?:deadline|cut-off|cutoff|must be received|submit)\\b[^.\\n]{0,180}?(${DATE_TEXT_PATTERN})`, "i"),
      confidence: "medium",
    },
  ]);
  const voteRequirements = findSentenceField(text, [
    /\b(?:approval of|affirmative vote|majority of|holders of|stockholder approval|shareholder approval)\b[\s\S]{0,520}?[.]/i,
  ]);
  const meetingSection =
    findSectionField(text, "special meeting", 900) ||
    findSectionField(text, "the special meeting", 900) ||
    findSectionField(text, "shareholder meeting", 900) ||
    findSectionField(text, "stockholder meeting", 900);

  return {
    meeting_date: meetingDate,
    record_date: recordDate,
    vote_deadline: voteDeadline,
    vote_requirements: voteRequirements,
    proposals: findProposalFields(text),
    meeting_section: meetingSection,
  };
}

function buildCalendarCandidates(
  transaction: SecS4F4TransactionTerms,
  shareholderVote: SecS4F4ShareholderVoteTerms,
): SecFormParserCalendarItem[] {
  const items: SecFormParserCalendarItem[] = [];
  addCalendarDate(items, shareholderVote.meeting_date, "merger_vote", "Merger vote");
  addCalendarDate(items, shareholderVote.record_date, "shareholder_record_date", "Shareholder record date");
  addCalendarDate(items, shareholderVote.vote_deadline, "shareholder_vote", "Shareholder vote deadline");
  addCalendarDate(items, transaction.expected_closing, "merger_closing", "Expected merger closing");
  addCalendarDate(items, transaction.outside_date, "merger_closing", "Merger outside date");
  addCalendarDate(items, transaction.exchange_offer_expiration, "tender_offer_expiration", "Exchange offer expiration");
  return dedupeCalendarItems(items);
}

function addCalendarDate(
  items: SecFormParserCalendarItem[],
  field: SecS4F4DateField | null,
  calendarEventType: string,
  calendarTitle: string,
) {
  if (!field) return;
  items.push({
    calendarEventType,
    calendarTitle,
    eventDate: field.value,
    eventTime: null,
    eventTimezone: null,
    datePrecision: field.date_precision,
    evidence: field.evidence,
    confidence: field.confidence,
  });
}

function buildAmendmentInfo(text: string, formType: string): SecS4F4AmendmentInfo {
  const isAmendment = /\/A$/i.test(normalizeForm(formType)) || /\bAmendment\s+No\.?\s*\d+/i.test(text);
  const amendmentNumber = isAmendment
    ? findShareCountField(text, [/\bAmendment\s+No\.?\s*(\d+)\b/i])
    : null;
  const registrationNumber = isAmendment
    ? findValueField(text, [/\bRegistration\s+No\.?\s*([0-9-]+)\b/i], "high")
    : null;
  const amendmentExcerpt = isAmendment ? extractAmendmentExcerpt(text) : null;
  const amendmentText = amendmentExcerpt || text;
  const limitedScopeSignals = isAmendment
    ? findSignalFields(amendmentText, [
        { value: "exhibit_only", pattern: /\b(?:solely|only|primarily)\b[^.\n]{0,160}\b(?:exhibit|consent|signature|opinion)\b/i, confidence: "medium" },
        { value: "no_material_changes", pattern: /\b(?:no|not)\b[^.\n]{0,120}\b(?:material|substantive)\b[^.\n]{0,120}\b(?:change|revision|amendment)\b/i, confidence: "medium" },
        { value: "unchanged_remainder", pattern: /\b(?:remainder|rest)\s+of\s+the\s+registration\s+statement\b[^.\n]{0,220}\bunchanged\b/i, confidence: "high" },
      ])
    : [];
  const changeSignals = isAmendment
    ? findSignalFields(amendmentText, [
        { value: "changed_consideration", pattern: /\b(?:revise|revised|update|updated|change|changed|amend|amended)\b[^.\n]{0,180}\b(?:consideration|exchange ratio|cash|stock)\b/i, confidence: "medium" },
        { value: "changed_vote_terms", pattern: /\b(?:revise|revised|update|updated|set|establish)\b[^.\n]{0,180}\b(?:meeting date|record date|vote|special meeting)\b/i, confidence: "medium" },
        { value: "changed_deal_terms", pattern: /\b(?:termination fee|outside date|condition|regulatory approval|financing condition)\b/i, confidence: "low" },
      ])
    : [];
  const unchangedRemainder = /\b(?:remainder|rest)\s+of\s+the\s+registration\s+statement\b[\s\S]{0,260}\bunchanged\b[\s\S]{0,180}\b(?:not\s+been\s+included|omitted)\b/i.test(
    amendmentText,
  );

  return {
    is_amendment: isAmendment,
    amendment_number: amendmentNumber,
    registration_number: registrationNumber,
    appears_limited_scope: isAmendment && limitedScopeSignals.length > 0 && changeSignals.length === 0,
    unchanged_remainder_not_included: unchangedRemainder,
    limited_scope_signal_candidates: limitedScopeSignals,
    change_signal_candidates: changeSignals,
    amendment_excerpt: amendmentExcerpt,
  };
}

function findDealType(text: string): SecS4F4Field<SecS4F4DealType> | null {
  const candidates: Array<PatternCandidate<SecS4F4DealType>> = [
    { value: "exchange_offer", pattern: /\b(?:exchange offer|offer to exchange|exchange your shares|exchange their shares)\b/i, confidence: "high" },
    { value: "business_combination", pattern: /\b(?:business combination agreement|de-?SPAC|special purpose acquisition company|SPAC)\b/i, confidence: "high" },
    { value: "merger", pattern: /\b(?:agreement and plan of merger|merger agreement|the merger|merge with|merged with)\b/i, confidence: "high" },
    { value: "reorganization", pattern: /\b(?:reorganization|scheme of arrangement|amalgamation|arrangement agreement)\b/i, confidence: "medium" },
    { value: "asset_acquisition", pattern: /\b(?:asset acquisition|acquisition of substantially all|asset sale|purchase of assets)\b/i, confidence: "medium" },
    { value: "redomiciliation", pattern: /\b(?:redomiciliation|domestication|redomestication|reincorporation)\b/i, confidence: "medium" },
  ];
  return findSignalFields(text, candidates)[0] || null;
}

function findTransactionStructure(text: string): SecS4F4Field | null {
  return findSentenceField(text, [
    /\b(?:Agreement and Plan of Merger|Business Combination Agreement|Transaction Agreement|Arrangement Agreement|merger agreement)\b[\s\S]{0,520}?[.]/i,
    /\b(?:will merge with and into|will be merged with and into|will become a wholly owned subsidiary|surviving corporation)\b[\s\S]{0,420}?[.]/i,
    /\b(?:exchange offer|offer to exchange)\b[\s\S]{0,420}?[.]/i,
  ]);
}

function findParties(text: string, issuer: string | null): SecS4F4Party[] {
  const parties: SecS4F4Party[] = [];
  if (issuer) {
    parties.push({
      name: issuer,
      role: "registrant",
      ticker: null,
      evidence: "Issuer from filing metadata or registration statement cover.",
      confidence: "medium",
    });
  }

  const byAmongMatch = text.match(/\b(?:by and among|by and between)\s+([^.\n]{20,420})/i);
  if (byAmongMatch?.[1]) {
    const names = splitPartyNames(byAmongMatch[1]);
    names.forEach((name, index) => {
      addParty(parties, {
        name,
        role: inferPartyRole(name, issuer, index, names.length),
        ticker: null,
        evidence: pickEvidenceSentence(text, byAmongMatch.index || 0),
        confidence: "medium",
      });
    });
  }

  for (const match of text.matchAll(/\b(?:acquisition of|merger with|business combination with|combine with)\s+([A-Z][A-Za-z0-9&.,' -]{2,90}?)(?:\s+(?:pursuant|for|in|under|and|,|\.))/gi)) {
    const name = cleanPartyName(match[1]);
    if (!name) continue;
    addParty(parties, {
      name,
      role: "target",
      ticker: null,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    });
  }

  for (const match of text.matchAll(/\b([A-Z][A-Za-z0-9&.,' -]{2,90}?)\s+(?:will merge with and into|will be merged with and into|will become a wholly owned subsidiary)/g)) {
    const name = cleanPartyName(lastPartyNameSegment(match[1]));
    if (!name || /^(the|each|shares?|stockholders?)$/i.test(name)) continue;
    addParty(parties, {
      name,
      role: "target",
      ticker: null,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    });
  }

  return parties.slice(0, 8);
}

function findSecuritiesRegistered(text: string): SecS4F4Field[] {
  return dedupeFields(
    findSignalFields(text, [
      { value: "common_stock", pattern: /\b(?:shares? of common stock|common shares|common stock)\b/i, confidence: "medium" },
      { value: "ordinary_shares", pattern: /\bordinary shares?\b/i, confidence: "medium" },
      { value: "ads", pattern: /\b(?:ADSs?|American Depositary Shares?)\b/i, confidence: "medium" },
      { value: "preferred_stock", pattern: /\bpreferred (?:stock|shares?)\b/i, confidence: "medium" },
      { value: "warrants", pattern: /\bwarrants?\b/i, confidence: "low" },
      { value: "units", pattern: /\bunits?\b/i, confidence: "low" },
    ]),
  );
}

function findOwnershipFields(text: string): SecS4F4Field[] {
  return dedupeFields(
    [
      ...findSentenceFields(text, /\b(?:following|after|upon)\s+(?:completion|closing|consummation)\b[\s\S]{0,520}?\b(?:own|ownership|hold|held)\b[\s\S]{0,520}?\b\d+(?:\.\d+)?%[\s\S]{0,220}?[.]/gi, 4),
      ...findSentenceFields(text, /\b(?:former|existing|current)\s+(?:stockholders|shareholders|holders)\b[\s\S]{0,520}?\b\d+(?:\.\d+)?%[\s\S]{0,220}?[.]/gi, 4),
    ],
  );
}

function findConditionFields(text: string): SecS4F4Field[] {
  return dedupeFields(
    findSignalFields(text, [
      { value: "shareholder_approval", pattern: /\b(?:approval|adoption)\b[^.\n]{0,180}\b(?:stockholders?|shareholders?)\b/i, confidence: "high" },
      { value: "registration_effectiveness", pattern: /\bregistration statement\b[^.\n]{0,180}\b(?:effective|declared effective)\b/i, confidence: "high" },
      { value: "listing_approval", pattern: /\b(?:Nasdaq|NYSE|exchange)\b[^.\n]{0,180}\b(?:listing|approval|authorized for listing)\b/i, confidence: "medium" },
      { value: "regulatory_approval", pattern: /\b(?:regulatory approvals?|HSR Act|Hart-Scott-Rodino|antitrust|CFIUS)\b/i, confidence: "medium" },
      { value: "no_injunction", pattern: /\b(?:no injunction|no order|law or order)\b[^.\n]{0,180}\b(?:prohibit|restrain|enjoin)\b/i, confidence: "medium" },
      { value: "financing_condition", pattern: /\b(?:financing condition|debt financing|equity financing)\b/i, confidence: "low" },
    ]),
  );
}

function findProposalFields(text: string): SecS4F4Field[] {
  return dedupeFields(
    findSignalFields(text, [
      { value: "approve_merger_agreement", pattern: /\b(?:approve|adopt)\b[^.\n]{0,180}\b(?:merger agreement|transaction agreement|business combination agreement)\b/i, confidence: "high" },
      { value: "approve_share_issuance", pattern: /\b(?:approve|approval)\b[^.\n]{0,180}\b(?:issuance|issue)\b[^.\n]{0,160}\b(?:shares?|common stock|ordinary shares|ADSs?)\b/i, confidence: "medium" },
      { value: "adjournment", pattern: /\badjournment proposal\b|\bproposal to adjourn\b/i, confidence: "medium" },
      { value: "charter_amendment", pattern: /\b(?:charter|certificate of incorporation|articles of association)\b[^.\n]{0,180}\b(?:amendment|proposal)\b/i, confidence: "low" },
    ]),
  );
}

function findSignalFields<T extends string>(text: string, candidates: Array<PatternCandidate<T>>): Array<SecS4F4Field<T>> {
  const fields: Array<SecS4F4Field<T>> = [];
  for (const candidate of candidates) {
    const match = text.match(candidate.pattern);
    if (!match) continue;
    fields.push({
      value: candidate.value,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: candidate.confidence,
    });
  }
  return fields;
}

function findSentenceFields(text: string, pattern: RegExp, maxCount: number): SecS4F4Field[] {
  const fields: SecS4F4Field[] = [];
  for (const match of text.matchAll(pattern)) {
    const evidence = pickEvidenceSentence(text, match.index || 0);
    fields.push({
      value: evidence,
      evidence,
      confidence: "medium",
    });
    if (fields.length >= maxCount) break;
  }
  return fields;
}

function findSentenceField(text: string, patterns: RegExp[]): SecS4F4Field | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const evidence = pickEvidenceSentence(text, match.index || 0);
    return {
      value: evidence,
      evidence,
      confidence: "medium",
    };
  }
  return null;
}

function findValueField(text: string, patterns: RegExp[], confidence: "high" | "medium" | "low"): SecS4F4Field | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    return {
      value: compactText(match[1]),
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence,
    };
  }
  return null;
}

function findSectionField(text: string, heading: string, maxLength: number): SecS4F4Field | null {
  if (!text) return null;
  const pattern = new RegExp(`\\b${escapeRegExp(heading)}\\b`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  const start = match.index || 0;
  const sectionText = text.slice(start, Math.min(text.length, start + maxLength));
  const evidence = truncate(sectionText, 520);
  return {
    value: evidence,
    evidence,
    confidence: "medium",
  };
}

function findMoneyField(text: string, patterns: RegExp[]): SecS4F4MoneyField | null {
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

function findShareCountField(text: string, patterns: RegExp[]): SecS4F4CountField | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const valueText = compactText(match[1]);
    return {
      value: normalizeCount(valueText),
      text: valueText,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: "medium",
    };
  }
  return null;
}

function findDateField(
  text: string,
  patterns: Array<{ pattern: RegExp; confidence: "high" | "medium" | "low" }>,
): SecS4F4DateField | null {
  for (const candidate of patterns) {
    const match = text.match(candidate.pattern);
    const dateText = match?.[1] || match?.[0];
    if (!dateText) continue;
    const normalized = normalizeDate(dateText);
    return {
      value: normalized.value,
      text: compactText(dateText),
      date_precision: normalized.date_precision,
      evidence: pickEvidenceSentence(text, match.index || 0),
      confidence: candidate.confidence,
    };
  }
  return null;
}

function buildReadingPackage(
  text: string,
  transaction: SecS4F4TransactionTerms,
  shareholderVote: SecS4F4ShareholderVoteTerms,
): SecS4F4ReadingPackage {
  const importantFacts = [
    fact("deal_type", transaction.deal_type?.value, transaction.deal_type),
    fact("consideration", transaction.consideration?.value, transaction.consideration),
    fact("exchange_ratio", transaction.exchange_ratio?.value, transaction.exchange_ratio),
    fact("shares_to_be_issued", transaction.shares_to_be_issued?.text, transaction.shares_to_be_issued),
    fact("meeting_date", shareholderVote.meeting_date?.text, shareholderVote.meeting_date),
    fact("record_date", shareholderVote.record_date?.text, shareholderVote.record_date),
    fact("termination_fee", transaction.termination_fee?.text, transaction.termination_fee),
  ].filter((item): item is SecS4F4ReadingPackage["important_facts"][number] => Boolean(item));

  const parserNotes: string[] = [];
  if (transaction.securities_registered.some((item) => /common_stock|ordinary_shares|ads/.test(item.value))) {
    parserNotes.push("Stock consideration or registered equity may create dilution and ownership impact.");
  }
  if (transaction.conditions.some((item) => item.value === "shareholder_approval")) {
    parserNotes.push("Shareholder approval is a deal condition and should be routed separately from routine amendments.");
  }

  return {
    cover_excerpt: truncate(text.slice(0, 1_200), 900) || null,
    transaction_excerpt: transaction.consideration?.evidence || transaction.transaction_structure?.evidence || null,
    vote_excerpt: shareholderVote.meeting_section?.value || shareholderVote.vote_requirements?.evidence || null,
    risk_excerpt: transaction.risk_factor_excerpt?.value || null,
    important_facts: importantFacts,
    parser_notes: parserNotes,
  };
}

function fact(
  name: string,
  value: string | number | null | undefined,
  field: { evidence: string; confidence: "high" | "medium" | "low" } | null | undefined,
) {
  if (value === null || value === undefined || !field) return null;
  return {
    name,
    value: String(value),
    evidence: field.evidence,
    confidence: field.confidence,
  };
}

function buildReviewReasons({
  amendment,
  formText,
  formType,
  shareholderVote,
  transaction,
}: {
  amendment: SecS4F4AmendmentInfo;
  formText: string;
  formType: string;
  shareholderVote: SecS4F4ShareholderVoteTerms;
  transaction: SecS4F4TransactionTerms;
}) {
  const reasons: string[] = [];
  if (!isS4F4Family(formType)) reasons.push("not_s4_f4_family");
  if (!formText) reasons.push("no_text_available");
  if (amendment.appears_limited_scope) reasons.push("limited_scope_amendment");
  if (amendment.is_amendment && amendment.change_signal_candidates.length > 0) reasons.push("amendment_change_signals_present");
  if (!amendment.appears_limited_scope) {
    if (!transaction.deal_type) reasons.push("deal_type_not_found");
    if (!transaction.parties.length) reasons.push("transaction_parties_not_found");
    if (!transaction.consideration && !transaction.exchange_ratio) reasons.push("consideration_not_found");
    if (!transaction.shares_to_be_issued && transaction.securities_registered.length > 0) reasons.push("registered_share_count_not_found");
    if (!shareholderVote.meeting_date && /(?:special|shareholder|stockholder).{0,80}meeting/i.test(formText)) {
      reasons.push("meeting_date_not_found");
    }
  }
  return reasons;
}

function countExtractedFields(
  transaction: SecS4F4TransactionTerms,
  shareholderVote: SecS4F4ShareholderVoteTerms,
  amendment: SecS4F4AmendmentInfo,
) {
  return [
    transaction.deal_type,
    transaction.transaction_structure,
    transaction.consideration,
    transaction.cash_consideration,
    transaction.stock_consideration,
    transaction.exchange_ratio,
    transaction.cash_stock_mix,
    transaction.shares_to_be_issued,
    transaction.termination_fee,
    transaction.outside_date,
    transaction.expected_closing,
    transaction.exchange_offer_expiration,
    transaction.risk_factor_excerpt,
    transaction.financial_statements_reference,
    transaction.pro_forma_reference,
    shareholderVote.meeting_date,
    shareholderVote.record_date,
    shareholderVote.vote_deadline,
    shareholderVote.vote_requirements,
    shareholderVote.meeting_section,
    amendment.amendment_number,
    amendment.registration_number,
    ...transaction.securities_registered,
    ...transaction.ownership_after_transaction,
    ...transaction.conditions,
    ...shareholderVote.proposals,
    ...amendment.limited_scope_signal_candidates,
    ...amendment.change_signal_candidates,
  ].filter(Boolean).length + transaction.parties.length;
}

function buildSignals(facts: SecS4F4Facts) {
  const signals: string[] = [];
  const dealType = facts.transaction.deal_type?.value;
  if (dealType) signals.push(`s4_f4_${dealType}`);
  if (facts.transaction.shares_to_be_issued || facts.transaction.securities_registered.length > 0) signals.push("stock_issuance_candidate");
  if (facts.shareholder_vote.meeting_date || facts.shareholder_vote.vote_requirements) signals.push("shareholder_vote_candidate");
  if (facts.amendment.appears_limited_scope) signals.push("limited_scope_amendment");
  if (facts.needs_human_review) signals.push("needs_human_review");
  return signals;
}

function buildSummary(facts: SecS4F4Facts) {
  const dealType = facts.transaction.deal_type?.value?.replace(/_/g, " ") || "S-4/F-4 filing";
  const issuer = facts.issuer || "issuer";
  const consideration = facts.transaction.consideration?.value || facts.transaction.exchange_ratio?.value || "transaction terms";
  if (facts.amendment.appears_limited_scope) return `${facts.form_type} limited-scope amendment for ${issuer}.`;
  return `${facts.form_type} ${dealType} filing for ${issuer}: ${truncate(consideration, 180)}`;
}

function buildTextBundle(input: SecFormParserInput, rawPayload: Record<string, unknown>) {
  const rawAttachmentTexts = recordArray(rawPayload.attachment_texts)
    .map((item) => stringValue(item.text))
    .filter(Boolean);
  const attachmentTexts = [
    ...(input.attachments || []).map((item) => stringValue(item.text)),
    ...rawAttachmentTexts,
  ].filter(Boolean);
  const rawPrimaryText =
    stringValue(rawPayload.primary_document_text) ||
    stringValue(rawPayload.primaryDocumentText) ||
    stringValue(rawPayload.analysis_text) ||
    stringValue(rawPayload.body_text);

  return {
    primaryText: compactText(stringValue(input.primaryDocumentText) || rawPrimaryText),
    attachmentText: compactText(attachmentTexts.join("\n\n")),
  };
}

function buildDocumentSummaries(
  input: SecFormParserInput,
  rawPayload: Record<string, unknown>,
): SecS4F4DocumentSummary[] {
  const rawDocuments = recordArray(rawPayload.documents) as RawDocumentPayload[];
  const summaries: SecS4F4DocumentSummary[] = rawDocuments.map((document, index) => ({
    source_id: stringValue(document.filename || document.document || document.url) || `document_${index + 1}`,
    type: nullableString(document.type),
    description: nullableString(document.description),
    filename: nullableString(document.filename || document.document),
    url_present: Boolean(nullableString(document.url)),
    is_primary: Boolean(document.isPrimary) || index === 0,
    text_char_count: numberValue(document.textCharCount) || stringValue(document.text).length,
    text_truncated: Boolean(document.textTruncated),
  }));

  for (const [index, attachment] of (input.attachments || []).entries()) {
    addDocumentSummary(summaries, attachment, index);
  }

  if (!summaries.length && input.primaryDocumentText) {
    summaries.push({
      source_id: "primary_document",
      type: input.formType,
      description: "Primary document text",
      filename: null,
      url_present: Boolean(input.sourceUrl),
      is_primary: true,
      text_char_count: input.primaryDocumentText.length,
      text_truncated: false,
    });
  }

  return summaries.slice(0, 20);
}

function addDocumentSummary(
  summaries: SecS4F4DocumentSummary[],
  attachment: SecFormParserAttachment,
  index: number,
) {
  const sourceId = stringValue(attachment.filename || attachment.url || attachment.description) || `attachment_${index + 1}`;
  if (summaries.some((summary) => summary.source_id === sourceId)) return;
  summaries.push({
    source_id: sourceId,
    type: nullableString(attachment.type),
    description: nullableString(attachment.description),
    filename: nullableString(attachment.filename),
    url_present: Boolean(nullableString(attachment.url)),
    is_primary: false,
    text_char_count: stringValue(attachment.text).length,
    text_truncated: false,
  });
}

function resolveS4F4FormType(
  input: SecFormParserInput,
  rawPayload: Record<string, unknown>,
  metadata: Record<string, unknown>,
) {
  return (
    canonicalS4F4FormType(input.formType) ||
    canonicalS4F4FormType(nullableString(rawPayload.form_type)) ||
    canonicalS4F4FormType(nullableString(metadata.form_type)) ||
    canonicalS4F4FormType(readFormFromTitle(input.title)) ||
    normalizeForm(input.formType)
  );
}

function readFormFromTitle(value: unknown) {
  return stringValue(value).match(/\b([SF]-4\/A|[SF]-4)\b/i)?.[1] || "";
}

function canonicalS4F4FormType(value: string | null) {
  const normalized = normalizeForm(value);
  if (S4_F4_FORMS.has(normalized)) return normalized;
  return "";
}

function isS4F4Family(value: string | null) {
  return S4_F4_FORMS.has(normalizeForm(value));
}

function normalizeForm(value: string | null | undefined) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "");
}

function extractPrimaryFormText(text: string, formType: string) {
  const form = normalizeForm(formType);
  if (!text || !form) return text;
  const heading = `### ${form}`;
  const start = text.toUpperCase().indexOf(heading);
  if (start < 0) return text;
  const next = text.indexOf("\n\n### ", start + heading.length);
  return compactText(next > start ? text.slice(start, next) : text.slice(start));
}

function extractAmendmentExcerpt(text: string) {
  const amendmentIndex = text.search(/\bAmendment\s+No\.?\s*\d+|\bExplanatory Note\b/i);
  if (amendmentIndex < 0) return null;
  const excerpt = text.slice(amendmentIndex, amendmentIndex + 2_500);
  return truncate(excerpt, 1_500);
}

function readIssuerFromText(text: string, formType: string) {
  const form = escapeRegExp(normalizeForm(formType).replace("/A", ""));
  return (
    text.match(new RegExp(`\\bFORM\\s+${form}\\b[\\s\\S]{0,360}?\\n([A-Z][A-Za-z0-9&.,' -]+?)\\s+\\|?\\s*\\(Exact name of registrant`, "i"))?.[1]?.trim() ||
    null
  );
}

function splitPartyNames(value: string) {
  const withoutDates = value.replace(/\bdated\s+as\s+of\b[\s\S]*$/i, "").replace(/\bdated\b[\s\S]*$/i, "");
  return withoutDates
    .split(/\s*,\s+|\s+and\s+|\s*;\s*/)
    .map(cleanPartyName)
    .filter(Boolean)
    .slice(0, 8);
}

function cleanPartyName(value: string | undefined) {
  const cleaned = compactText(value || "")
    .replace(/\b(?:a|an)\s+(?:Delaware|Nevada|Cayman Islands|British Virgin Islands|BVI|Canadian|English)\s+(?:corporation|company|limited company|exempted company|subsidiary)\b/gi, "")
    .replace(/\b(?:corporation|company|inc\.?|ltd\.?|limited|plc|corp\.?)$/i, (suffix) => suffix)
    .replace(/\s+/g, " ")
    .replace(/^[,.\s]+|[,.\s]+$/g, "");
  if (cleaned.length < 3 || cleaned.length > 100) return "";
  if (/^(the|and|with|pursuant|agreement|plan|merger|dated|stockholders?|shareholders?)$/i.test(cleaned)) return "";
  return cleaned;
}

function lastPartyNameSegment(value: string | undefined) {
  const text = compactText(value || "");
  return (
    text
      .split(/\.\s+/)
      .pop()
      ?.split(/\s+and\s+/i)
      .pop()
      ?.split(/\s*,\s*/)
      .pop() || text
  );
}

function inferPartyRole(name: string, issuer: string | null, index: number, total: number): SecS4F4PartyRole {
  if (issuer && name.toLowerCase().includes(issuer.toLowerCase())) return "registrant";
  if (/\bmerger sub\b|\bacquisition sub\b|\bsubsidiary\b/i.test(name)) return "merger_sub";
  if (total > 1 && index === total - 1) return "target";
  if (index === 0) return "acquirer";
  return "other";
}

function addParty(parties: SecS4F4Party[], party: SecS4F4Party) {
  const normalized = party.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized || parties.some((item) => item.name.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized)) return;
  parties.push(party);
}

function normalizeMoney(value: string): SecS4F4MoneyField["value"] {
  const text = stringValue(value);
  const match = text.match(/\$?\s*([\d,.]+)/);
  if (!match) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return { amount: null, currency: text.includes("$") ? "USD" : null, scale: null };
  const scale = readScale(text);
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return {
    amount: base * multiplier,
    currency: text.includes("$") ? "USD" : null,
    scale,
  };
}

function normalizeCount(value: string) {
  const text = stringValue(value);
  const match = text.match(/(\d[\d,.]*)\s*(thousand|million|billion|m|bn|k)?/i);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const scale = match[2]?.toLowerCase();
  if (scale === "thousand" || scale === "k") return base * 1_000;
  if (scale === "million" || scale === "m") return base * 1_000_000;
  if (scale === "billion" || scale === "bn") return base * 1_000_000_000;
  return base;
}

function readScale(value: string): SecS4F4MoneyField["value"]["scale"] {
  if (/\bb(?:illion|n)?\b/i.test(value)) return "billion";
  if (/\bm(?:illion)?\b/i.test(value)) return "million";
  if (/\bthousand\b|\bk\b/i.test(value)) return "thousand";
  return "raw";
}

function normalizeDate(value: string): Pick<SecS4F4DateField, "value" | "date_precision"> {
  const text = compactText(value);
  const exact = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (exact) {
    const month = MONTHS[exact[1].toLowerCase()];
    const day = exact[2].padStart(2, "0");
    return { value: `${exact[3]}-${month}-${day}`, date_precision: "exact" };
  }
  if (/\b(?:first|second|third|fourth)\s+quarter\b|\bQ[1-4]\b/i.test(text)) {
    return { value: null, date_precision: "estimated" };
  }
  if (/\b\d{4}\b/.test(text)) return { value: null, date_precision: "estimated" };
  return { value: null, date_precision: "unknown" };
}

function dedupeFields<T extends SecS4F4Field>(fields: T[]): T[] {
  const seen = new Set<string>();
  return fields.filter((fieldItem) => {
    const key = `${fieldItem.value}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCalendarItems(items: SecFormParserCalendarItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.calendarEventType}:${item.eventDate || ""}:${item.calendarTitle || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickEvidenceSentence(text: string, index: number) {
  const safeIndex = Math.max(0, index);
  const start = Math.max(0, text.lastIndexOf(".", safeIndex - 1), text.lastIndexOf("\n\n", safeIndex - 1));
  let end = text.indexOf(".", safeIndex + 1);
  if (end >= 0 && end - safeIndex < 80) {
    const nextEnd = text.indexOf(".", end + 1);
    if (nextEnd >= 0) end = nextEnd;
  }
  if (end < 0) end = Math.min(text.length, safeIndex + 420);
  else end += 1;
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), 520);
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
