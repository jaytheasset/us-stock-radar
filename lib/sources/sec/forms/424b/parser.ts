import {
  FORM_SCOPE_424B,
  PARSER_GROUP_424B,
  PARSER_VERSION_424B,
} from "./types";
import type {
  Sec424bCalendarItem,
  Sec424bMarketContext,
  Sec424bParseInput,
  Sec424bParserOutput,
  Sec424bSignal,
  Sec424bSourceInventoryItem,
} from "./types";

const MONEY_PATTERN = "\\$\\s*([0-9][0-9,]*(?:\\.\\d+)?)\\s*(billion|million|thousand)?";
const DATE_PATTERN =
  "\\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2},\\s+\\d{4}\\b";
const EXTRACTION_WINDOW_CHARS = 80_000;

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal: string) => String.fromCharCode(Number.parseInt(decimal, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/&bull;/gi, " ")
    .replace(/&colon;/gi, ":")
    .replace(/&semi;/gi, ";")
    .replace(/&sol;/gi, "/");
}

function stripSecMarkup(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|tr|table|li|br|hr|h[1-6])>/gi, " . ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function prepareFilingText(value: string): string {
  return normalizeText(stripSecMarkup(value));
}

function extractionWindow(text: string): string {
  const windowed = text.slice(0, EXTRACTION_WINDOW_CHARS);
  const baseProspectusStart = windowed.search(/\bTABLE OF CONTENTS\s*(?:\.\s*)?PROSPECTUS\s*(?:\.\s*)?\$?[0-9]/i);

  if (baseProspectusStart > 5_000) {
    return windowed.slice(0, baseProspectusStart);
  }

  return windowed;
}

function combinedFilingText(input: Sec424bParseInput): string {
  const attachmentText = (input.attachments ?? [])
    .map((attachment) => attachment.text)
    .filter(Boolean)
    .join("\n");

  return [input.filingText, attachmentText].filter(Boolean).join("\n");
}

function buildSourceInventory(input: Sec424bParseInput): {
  primary_text_chars: number;
  attachment_count: number;
  attachment_text_chars: number;
  attachments: Sec424bSourceInventoryItem[];
} {
  const attachments = (input.attachments ?? []).map((attachment) => {
    const label = `${attachment.filename ?? ""} ${attachment.description ?? ""}`;
    return {
      filename: attachment.filename ?? null,
      description: attachment.description ?? null,
      text_chars: attachment.text.length,
      material_hint:
        /\b(?:sales agreement|equity distribution agreement|securities purchase agreement|purchase agreement|placement agency agreement|underwriting agreement|warrant|indenture|note|convertible|resale|selling stockholder|selling shareholder|fee table|6-k|8-k|ex-99|ex-10|ex-4)\b/i.test(
          label,
        ),
    };
  });

  return {
    primary_text_chars: input.filingText.length,
    attachment_count: attachments.length,
    attachment_text_chars: attachments.reduce((total, attachment) => total + attachment.text_chars, 0),
    attachments,
  };
}

function getMarketContext(input: Sec424bParseInput): Sec424bMarketContext | undefined {
  return input.marketContext ?? input.market_context;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const wordNumbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const normalizedValue = value.toLowerCase();
  if (normalizedValue in wordNumbers) {
    return wordNumbers[normalizedValue];
  }

  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseMoney(value: string | undefined, unit: string | undefined): number | null {
  const numeric = parseNumber(value);
  if (numeric == null) {
    return null;
  }

  const normalizedUnit = unit?.toLowerCase();
  if (normalizedUnit === "billion") {
    return Math.round(numeric * 1_000_000_000);
  }

  if (normalizedUnit === "million") {
    return Math.round(numeric * 1_000_000);
  }

  if (normalizedUnit === "thousand") {
    return Math.round(numeric * 1_000);
  }

  return numeric;
}

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match;
    }
  }

  return null;
}

function evidenceExcerpt(text: string, match: RegExpMatchArray | null, fallbackPattern?: RegExp): string | undefined {
  const index = match?.index ?? (fallbackPattern ? text.search(fallbackPattern) : -1);
  if (index < 0) {
    return undefined;
  }

  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + 230);
  return normalizeText(text.slice(start, end));
}

function extractIssuerName(input: Sec424bParseInput, text: string): string | null {
  if (input.issuer?.name) {
    return input.issuer.name;
  }

  const match = firstMatch(text, [
    /prospectus(?: supplement)?\s+([A-Z][A-Za-z0-9&.,' -]{2,80}?(?:Inc\.|Corp\.|Corporation|Ltd\.|Limited|PLC|S\.A\.|Holdings|Systems|Platforms|Therapeutics|BioPharma))/i,
    /issuer:\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
    /company:\s*([A-Z][A-Za-z0-9&.,' -]{2,100})/i,
  ]);

  return match?.[1]?.trim() ?? null;
}

function extractTicker(input: Sec424bParseInput, text: string): string | null {
  if (input.issuer?.ticker) {
    return input.issuer.ticker;
  }

  const match = firstMatch(text, [
    /\((?:NASDAQ|NYSE|NYSE American|Nasdaq Capital Market|OTC(?:QB|QX)?):\s*([A-Z][A-Z0-9.]{0,9})\)/i,
    /(?:NASDAQ|NYSE|NYSE American|Nasdaq Capital Market|OTC(?:QB|QX)?)[\s:]+([A-Z][A-Z0-9.]{0,9})\b/i,
    /trading symbol (?:is|will be)\s+"?([A-Z][A-Z0-9.]{0,9})"?/i,
  ]);

  return match?.[1]?.toUpperCase() ?? null;
}

function extractAtmShareAssumption(text: string): {
  postOfferingShares: number | null;
  assumedSharesSold: number | null;
  assumedOfferingPrice: number | null;
} {
  const match = text.match(
    /Common Stock to be Outstanding Immediately After this Offering[\s.]{0,80}(?:Up to\s+)?([0-9][0-9,]*)\s+shares[^.]{0,240}?assuming sales of\s+([0-9][0-9,]*)\s+shares[^.]{0,160}?assumed public offering price of\s+\$\s*([0-9][0-9,]*(?:\.\d+)?)/i,
  );

  return {
    postOfferingShares: parseNumber(match?.[1]),
    assumedSharesSold: parseNumber(match?.[2]),
    assumedOfferingPrice: parseNumber(match?.[3]),
  };
}

function extractMoneyNear(text: string, labelPattern: string): number | null {
  const pattern = new RegExp(`(?:${labelPattern})[^.]{0,160}?${MONEY_PATTERN}`, "i");
  const match = text.match(pattern);
  return parseMoney(match?.[1], match?.[2]);
}

function extractPercentNear(text: string, labelPattern: string): number | null {
  const pattern = new RegExp(`(?:${labelPattern})[^.]{0,160}?([0-9][0-9,]*(?:\\.\\d+)?)\\s*%`, "i");
  const match = text.match(pattern);
  return parseNumber(match?.[1]);
}

function extractFirstDateNear(text: string, labelPattern: string): string | null {
  const pattern = new RegExp(`(?:${labelPattern})[^.]{0,160}?(${DATE_PATTERN})`, "i");
  const match = text.match(pattern);
  return match?.[1] ?? null;
}

function extractRegistrationNumber(text: string): string | null {
  const match = text.match(/Registration No\.?\s+([0-9-]+)/i);
  return match?.[1] ?? null;
}

function extractSupplementNumber(text: string): string | null {
  const match = text.match(/Prospectus Supplement(?:\s+No\.?\s+([0-9]+))?/i);
  return match?.[1] ?? (match ? "unspecified" : null);
}

function extractParentProspectusDate(text: string): string | null {
  const match = text.match(new RegExp(`prospectus dated\\s+(${DATE_PATTERN})`, "i"));
  return match?.[1] ?? null;
}

function extractCusip(text: string): string | null {
  const match = text.match(/\bCUSIP(?:\s+No\.?)?\s*:?\s*([A-Z0-9]{9})\b/i);
  return match?.[1]?.trim().replace(/\s+/g, " ") ?? null;
}

function extractIsin(text: string): string | null {
  const match = text.match(/\bISIN\s*:?\s*([A-Z]{2}[A-Z0-9]{9}[0-9])\b/i);
  return match?.[1]?.trim() ?? null;
}

function extractTextField(text: string, label: string, nextLabels: string[]): string | null {
  const stopLabels = nextLabels.map((nextLabel) => nextLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`${label}\\s*:?\\s*(.*?)(?=\\s+(?:${stopLabels})\\s*:|\\s+(?:${stopLabels})\\b|\\.)`, "i");
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function extractStructuredNoteTerms(text: string): Record<string, unknown> {
  if (
    !/structured notes?|reference asset|contingent coupon|autocallable|(?:downside|coupon|payment|buffer|initial) barrier/i.test(
      text,
    )
  ) {
    return {
      issuer: null,
      guarantor: null,
      principalAmount: null,
      referenceAsset: null,
      referenceTicker: null,
      tradeDate: null,
      pricingDate: null,
      originalIssueDate: null,
      finalValuationDate: null,
      maturityDate: null,
      contingentCouponRatePercent: null,
      barrierPercent: null,
      initialValue: null,
      cusip: null,
      isin: null,
      listed: null,
    };
  }

  const referenceAsset =
    extractTextField(text, "Reference Asset", [
      "Trade Date",
      "Pricing Date",
      "Original Issue Date",
      "Final Valuation Date",
      "Maturity Date",
      "Contingent Coupon Rate",
    ]) ??
    firstMatch(text, [/linked to\s+(?:the\s+)?([A-Z][A-Za-z0-9 .,&'-]{2,120}?)(?:\s+\(|,|\.)/i])?.[1] ??
    null;
  const referenceTicker = firstMatch(text, [
    /Reference Asset\s*:?\s*.*?\(([A-Z][A-Z0-9.]{0,9})\)\.?\s+Trade Date/i,
    /ticker symbol\s+"?([A-Z][A-Z0-9.]{0,9})"?/i,
  ]);

  return {
    issuer:
      extractTextField(text, "Issuer", ["Guarantor", "Principal Amount", "Reference Asset"]) ?? null,
    guarantor:
      extractTextField(text, "Guarantor", ["Principal Amount", "Reference Asset", "Trade Date"]) ?? null,
    principalAmount: extractMoneyNear(text, "principal amount"),
    referenceAsset: referenceAsset?.replace(/\s*\([A-Z][A-Z0-9.]{0,9}\)\s*$/, "") ?? null,
    referenceTicker: referenceTicker?.[1] ?? null,
    tradeDate: extractFirstDateNear(text, "trade date"),
    pricingDate: extractFirstDateNear(text, "pricing date"),
    originalIssueDate: extractFirstDateNear(text, "original issue date|issue date"),
    finalValuationDate: extractFirstDateNear(text, "final valuation date"),
    maturityDate: extractFirstDateNear(text, "maturity date"),
    contingentCouponRatePercent: extractPercentNear(text, "contingent coupon"),
    barrierPercent: extractPercentNear(text, "barrier"),
    initialValue: extractMoneyNear(text, "initial value"),
    cusip: extractCusip(text),
    isin: extractIsin(text),
    listed: /will not be listed|not listed|will not list/i.test(text) ? false : null,
  };
}

function hasPreferredDepositaryContext(text: string): boolean {
  return /(?:\b[0-9][0-9,]*\s+depositary shares\b|each depositary share[^.]{0,160}?represent|liquidation preference|(?:dividend rate|dividends? (?:will )?accrue)[^.]{0,160}?(?:preferred|preference))/i.test(
    text,
  );
}

function hasRightsOfferingContext(text: string): boolean {
  return /(?:rights offering|over-subscription privilege|oversubscription privilege|transferable rights|subscription rights[^.]{0,160}?(?:to purchase|will expire|record date|exercise|over-subscription)|record date[^.]{0,160}?(?:rights offering|subscription rights))/i.test(
    text,
  );
}

function hasResaleContext(text: string): boolean {
  return /(?:selling stockholders?|selling shareholders?|offer and resell|offers? and resells?|resale prospectus|for resale by)/i.test(
    text,
  );
}

function extractSentences(text: string, patterns: RegExp[], limit = 4): string[] {
  const roughSentences = text
    .split(/(?<=[.!?])\s+/)
    .map(normalizeText)
    .filter(Boolean);

  const matches: string[] = [];
  for (const sentence of roughSentences) {
    if (patterns.some((pattern) => pattern.test(sentence))) {
      matches.push(sentence);
    }

    if (matches.length >= limit) {
      break;
    }
  }

  return matches;
}

function extractUseOfProceeds(text: string): string | null {
  const sentence = extractSentences(
    text,
    [/use (?:the )?(?:net )?proceeds/i, /net proceeds (?:will|are expected to) be used/i],
    1,
  )[0];

  return sentence ?? null;
}

function extractCalendarItems(text: string): Sec424bCalendarItem[] {
  const items: Sec424bCalendarItem[] = [];
  const closingPattern = new RegExp(`(?:close|closing)[^.]{0,90}?(${DATE_PATTERN})`, "i");
  const meetingPattern = new RegExp(`(?:special meeting|stockholder meeting|shareholder meeting)[^.]{0,90}?(${DATE_PATTERN})`, "i");
  const effectivePattern = new RegExp(`(?:effective|dated)[^.]{0,90}?(${DATE_PATTERN})`, "i");

  const closing = text.match(closingPattern);
  if (closing?.[1]) {
    items.push({
      date: closing[1],
      label: "Expected offering closing",
      source: evidenceExcerpt(text, closing) ?? closing[0],
    });
  }

  const meeting = text.match(meetingPattern);
  if (meeting?.[1]) {
    items.push({
      date: meeting[1],
      label: "Stockholder meeting",
      source: evidenceExcerpt(text, meeting) ?? meeting[0],
    });
  }

  const effective = text.match(effectivePattern);
  if (effective?.[1] && !items.some((item) => item.date === effective[1])) {
    items.push({
      date: effective[1],
      label: "Prospectus or registration date",
      source: evidenceExcerpt(text, effective) ?? effective[0],
    });
  }

  return items;
}

function prospectusClass(text: string): string {
  if (/structured notes?|reference asset|contingent coupon|autocallable|(?:downside|coupon|payment|buffer|initial) barrier/i.test(text)) {
    return "structured_note";
  }

  if (
    /at[- ]?the[- ]market offering|at market issuance sales agreement|equity distribution agreement|sales agreement prospectus/i.test(
      text,
    )
  ) {
    return "at_the_market";
  }

  if (/pre-funded warrants?|common warrants?|placement agent warrants?/i.test(text)) {
    return "multi_leg_warrant";
  }

  if (hasRightsOfferingContext(text)) {
    return "rights_offering";
  }

  if (hasPreferredDepositaryContext(text)) {
    return "preferred_depositary";
  }

  if (hasResaleContext(text)) {
    return "resale";
  }

  if (/merger|business combination|share exchange|combination agreement/i.test(text)) {
    return "strategic_transaction";
  }

  if (/prospectus supplement/i.test(text)) {
    return "supplement";
  }

  if (/base prospectus|shelf registration/i.test(text)) {
    return "base_prospectus";
  }

  return "unknown";
}

function buildSummary(issuerName: string | null, formType: string, description: string[]): string {
  const issuer = issuerName ?? "Issuer";
  const details = description.length > 0 ? ` covering ${description.join("; ")}` : "";
  return `${issuer} filed ${formType}${details}.`;
}

function addCleanedSourceBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  block: { block_type: string; label: string; source: string; text: string },
) {
  const text = normalizeText(block.text);
  if (!text) {
    return;
  }

  blocks.push({
    ...block,
    text: text.length > 12_000 ? `${text.slice(0, 11_997).trim()}...` : text,
  });
}

function addSourceWindowBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
  pattern: RegExp,
  label: string,
) {
  const match = text.match(pattern);
  const index = match?.index ?? -1;
  if (index < 0) return;

  const start = Math.max(0, index - 700);
  const end = Math.min(text.length, index + 3_300);
  addCleanedSourceBlock(blocks, {
    block_type: "source_context_window",
    label,
    source: "primary_document",
    text: text.slice(start, end),
  });
}

function addWarrantTermsConditionBlocks(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
) {
  const warrantReferencePattern =
    /\b(?:public|private|common|pre-funded|placement agent|private placement)?\s*warrants?\b/i;
  const highSignalWarrantTermPattern =
    /\b(?:non[-\s]?redeemable|cashless|expire|expiration|liquidation|FINRA|redemption|ownership cap|blocker|transfer restriction|lock[-\s]?up|lockup)\b/i;
  const fallbackWarrantTermPattern = /\b(?:exercisable|exercise price|redeemable|adjustment|subject to adjustment)\b/i;
  const sentences = text.split(/(?<=[.!?])\s+/).map(normalizeText);
  const sentencePriority = (sentence: string) => {
    let priority = 0;
    if (/\bprivate(?: placement)?\s+warrants?\b/i.test(sentence)) priority -= 50;
    if (/\b(?:non[-\s]?redeemable|cashless|liquidation|FINRA)\b/i.test(sentence)) priority -= 40;
    if (/\bpublic\s+warrants?\b/i.test(sentence)) priority += 10;
    return priority;
  };
  const highSignalSentences = sentences
    .filter((sentence) => warrantReferencePattern.test(sentence) && highSignalWarrantTermPattern.test(sentence))
    .sort((a, b) => sentencePriority(a) - sentencePriority(b))
    .slice(0, 12);
  const fallbackSentences = sentences
    .filter(
      (sentence) =>
        warrantReferencePattern.test(sentence) &&
        fallbackWarrantTermPattern.test(sentence) &&
        !highSignalWarrantTermPattern.test(sentence),
    )
    .slice(0, 4);
  const warrantConditionSentences = [...highSignalSentences, ...fallbackSentences].slice(0, 12);

  addCleanedSourceBlock(blocks, {
    block_type: "selected_source_sentences",
    label: "Warrant term condition sentences",
    source: "primary_document",
    text: warrantConditionSentences.join("\n"),
  });

  const warrantTermPatterns = [
    /\b(?:public|private|common|pre-funded|placement agent)?\s*warrants?\s+(?:are|is|will be|may be|become)[^.]{0,420}\b(?:non[-\s]?redeemable|cashless|expire|expiration|liquidation|FINRA|redemption|ownership cap|blocker|transfer restriction|lock[-\s]?up|lockup)\b/i,
    /\b(?:non[-\s]?redeemable|cashless|expire|expiration|liquidation|FINRA|redemption|ownership cap|blocker|transfer restriction|lock[-\s]?up|lockup)\b[^.]{0,420}\b(?:public|private|common|pre-funded|placement agent)?\s*warrants?\b/i,
    /\b(?:public|private|common|pre-funded|placement agent)?\s*warrants?\b[^.]{0,900}\b(?:non[-\s]?redeemable|cashless|expire|expiration|liquidation|FINRA|redemption|ownership cap|blocker|transfer restriction|lock[-\s]?up|lockup)\b/i,
    /\b(?:non[-\s]?redeemable|cashless|expire|expiration|liquidation|FINRA|redemption|ownership cap|blocker|transfer restriction|lock[-\s]?up|lockup)\b[^.]{0,900}\b(?:public|private|common|pre-funded|placement agent)?\s*warrants?\b/i,
  ];
  const matches = warrantTermPatterns.flatMap((pattern) => Array.from(text.matchAll(new RegExp(pattern.source, "gi"))));
  const seenWindows: Array<{ start: number; end: number }> = [];

  for (const match of matches) {
    const index = match.index ?? -1;
    if (index < 0) continue;

    const start = Math.max(0, index - 700);
    const end = Math.min(text.length, index + 3_300);
    const overlaps = seenWindows.some((window) => start <= window.end && end >= window.start);
    if (overlaps) continue;

    seenWindows.push({ start, end });
    addCleanedSourceBlock(blocks, {
      block_type: "source_context_window",
      label: "Warrant term and limit context",
      source: "primary_document",
      text: text.slice(start, end),
    });

    if (seenWindows.length >= 4) return;
  }
}

function addOfferingTableBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
) {
  const anchorPatterns = [
    /\bNumber\s+of\s+(?:Class\s+[A-Z]\s+)?(?:Ordinary\s+Shares|Common\s+Stock|shares?|ADSs?)\s+outstanding\s+(?:immediately\s+)?(?:before|prior\s+to|after)\s+this\s+offering\b/i,
    /\b(?:Class\s+[A-Z]\s+)?(?:Ordinary\s+Shares|Common\s+Stock|shares?|ADSs?)\s+outstanding\s+(?:immediately\s+)?(?:before|prior\s+to|after)\s+this\s+offering\b/i,
    /\bShares\s+of\s+Common\s+Stock\s+outstanding\s+prior\s+to\b/i,
    /\bShares\s+of\s+Common\s+Stock\s+outstanding\s+assuming\s+exercise\b/i,
    /\bExercise\s+price\s+of\s+Warrants\b/i,
    /\bShares\s+of\s+Common\s+Stock\s+offered\s+by\s+the\s+Selling\s+Securityholders\b/i,
  ];
  const anchorMatch = anchorPatterns
    .map((pattern) => text.match(pattern))
    .find((match): match is RegExpMatchArray => Boolean(match?.index && match.index > 0));
  const anchorIndex = anchorMatch?.index ?? -1;
  if (anchorIndex < 0) return;

  const before = text.slice(Math.max(0, anchorIndex - 8_000), anchorIndex);
  const headingMatches = Array.from(before.matchAll(/\bTHE OFFERING\b/gi));
  const headingIndex =
    headingMatches.length > 0
      ? Math.max(0, anchorIndex - before.length + (headingMatches[headingMatches.length - 1].index ?? 0))
      : Math.max(0, anchorIndex - 1_500);
  const after = text.slice(anchorIndex + 500);
  const nextHeading = after.search(/\b(?:RISK FACTORS|USE OF PROCEEDS|DETERMINATION OF OFFERING PRICE|PLAN OF DISTRIBUTION)\b/i);
  const end = nextHeading >= 0 ? anchorIndex + 500 + nextHeading : anchorIndex + 7_000;

  addCleanedSourceBlock(blocks, {
    block_type: "source_table_excerpt",
    label: "The Offering table and security totals",
    source: "primary_document",
    text: text.slice(headingIndex, Math.min(text.length, end)),
  });
}

function addOutstandingShareCountTableBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
) {
  const anchorPatterns = [
    /\bNumber\s+of\s+(?:Class\s+[A-Z]\s+)?(?:Ordinary\s+Shares|Common\s+Stock|shares?|ADSs?)\s+outstanding\s+(?:immediately\s+)?(?:before|prior\s+to|after)\s+this\s+offering\b/i,
    /\b(?:Class\s+[A-Z]\s+)?(?:Ordinary\s+Shares|Common\s+Stock|shares?|ADSs?)\s+outstanding\s+(?:immediately\s+)?(?:before|prior\s+to|after)\s+this\s+offering\b/i,
    /\b(?:shares?|ADSs?)\s+outstanding\s+(?:immediately\s+)?(?:before|prior\s+to|after)\s+(?:this|the)\s+(?:offering|transaction)\b/i,
  ];
  const anchorMatch = anchorPatterns
    .map((pattern) => text.match(pattern))
    .find((match): match is RegExpMatchArray => Boolean(match?.index && match.index >= 0));
  const anchorIndex = anchorMatch?.index ?? -1;
  if (anchorIndex < 0) return;

  addCleanedSourceBlock(blocks, {
    block_type: "source_table_excerpt",
    label: "Outstanding share count table",
    source: "primary_document",
    text: text.slice(Math.max(0, anchorIndex - 700), Math.min(text.length, anchorIndex + 2_200)),
  });
}

function addHeadingSectionBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
  headingPattern: RegExp,
  label: string,
  bodyPattern: RegExp,
) {
  const nextHeadingPattern =
    /\b(?:DIVIDEND POLICY|CAPITALIZATION|DILUTION|DESCRIPTION OF (?:THE NOTES|SHARE CAPITAL|PREFERRED SHARES|DEBT SECURITIES|WARRANTS|SUBSCRIPTION RIGHTS|UNITS)|PLAN OF DISTRIBUTION|TAXATION|LEGAL MATTERS|EXPERTS|WHERE YOU CAN FIND|INCORPORATION OF CERTAIN DOCUMENTS|RISK FACTORS|THE OFFERING)\b/i;
  let bestCandidate: { index: number; score: number } | null = null;

  for (const match of text.matchAll(new RegExp(headingPattern.source, `${headingPattern.flags.includes("i") ? "i" : ""}g`))) {
    const index = match.index ?? -1;
    if (index < 0) continue;

    const afterHeading = text.slice(index + match[0].length, index + match[0].length + 2_000);
    const afterSnippet = normalizeText(afterHeading).slice(0, 1_200);
    if (!bodyPattern.test(afterSnippet)) continue;

    let score = 0;
    const beforeSnippet = normalizeText(text.slice(Math.max(0, index - 600), index));
    const earlyAfter = afterSnippet.slice(0, 800);
    const bodyAfter = earlyAfter.replace(/^[\s.]+/, "");
    const bodyStartsCleanly = /^(?:we|our|the company|net proceeds|gross proceeds|we estimate|we expect|we intend)\b/i.test(
      bodyAfter,
    );
    const tocLike =
      /^(?:S-\d+|\d+)\b/.test(bodyAfter) ||
      (!bodyStartsCleanly &&
        /(?:S-\d+|\d+)\s+(?:DIVIDEND POLICY|CAPITALIZATION|DESCRIPTION OF|PLAN OF DISTRIBUTION|RISK FACTORS|LEGAL MATTERS|EXPERTS)\b/i.test(
          earlyAfter,
        )) ||
      (!bodyStartsCleanly && /\bTABLE OF CONTENTS\b/i.test(beforeSnippet.slice(-250)));

    if (bodyStartsCleanly) score += 6;
    if (/\b(?:net proceeds|gross proceeds|proceeds from this offering)\b/i.test(afterSnippet)) score += 4;
    if (/\b(?:approximately|about|estimated|estimate)\b.{0,120}(?:US\$|\$|million|billion)/i.test(afterSnippet)) {
      score += 4;
    }
    if (/\b(?:research and development|working capital|general corporate purposes|debt repayment|repay(?:ment)? of indebtedness)\b/i.test(afterSnippet)) {
      score += 4;
    }
    if (tocLike) score -= 10;

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { index, score };
    }
  }

  if (!bestCandidate || bestCandidate.score < 1) return;

  const index = bestCandidate.index;
  const remaining = text.slice(index + 200);
  const nextHeading = remaining.search(nextHeadingPattern);
  const end = nextHeading >= 0 ? index + 200 + nextHeading : index + 5_000;

  addCleanedSourceBlock(blocks, {
    block_type: "source_section_excerpt",
    label,
    source: "primary_document",
    text: text.slice(index, Math.min(text.length, end)),
  });
}

function addSellingHolderTableBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
) {
  const tablePatterns = [
    /\bmaximum\s+(?:number\s+)?(?:of\s+)?shares[^.]{0,450}?\boffered\s+for\s+resale\b/i,
    /\bshares\s+(?:of\s+common\s+stock\s+)?beneficially\s+owned[^.]{0,450}?\bselling\s+(?:stockholders|shareholders|securityholders)\b/i,
    /\bname\s+of\s+selling\s+(?:stockholder|shareholder|securityholder)\b/i,
    /\bselling\s+(?:stockholders|shareholders|securityholders)\s+table\b/i,
  ];

  const directMatch = tablePatterns
    .map((pattern) => text.match(pattern))
    .find((match): match is RegExpMatchArray => Boolean(match?.index && match.index > 0));

  let index = directMatch?.index ?? -1;

  if (index < 0) {
    const headingMatches = Array.from(text.matchAll(/\bselling\s+(?:stockholders|shareholders|securityholders)\b/gi));
    const headingMatch = headingMatches.find((match) => {
      const following = text.slice(match.index, match.index + 7_000);
      return /\b(?:beneficially\s+owned|offered\s+for\s+resale|relationships\s+with\s+selling|maximum\s+(?:number\s+)?(?:of\s+)?shares)\b/i.test(
        following,
      );
    });
    index = headingMatch?.index ?? -1;
  }

  if (index < 0) return;

  addCleanedSourceBlock(blocks, {
    block_type: "source_table_excerpt",
    label: "Selling holder table",
    source: "primary_document",
    text: text.slice(Math.max(0, index - 1_000), Math.min(text.length, index + 5_000)),
  });
}

function addShareCountExcerptBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
) {
  const patterns = [
    /\b(?:issued\s+and\s+outstanding|shares?\s+outstanding|outstanding\s+(?:prior to|before|after|immediately prior to|immediately after)|to\s+be\s+outstanding\s+after\s+this\s+offering)\b/gi,
  ];
  const windows: Array<{ start: number; end: number }> = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? -1;
      if (index < 0) continue;
      const start = Math.max(0, index - 700);
      const end = Math.min(text.length, index + 1_700);
      if (windows.some((window) => Math.abs(window.start - start) < 1_000 || (start >= window.start && start <= window.end))) {
        continue;
      }
      windows.push({ start, end });
      if (windows.length >= 8) break;
    }
    if (windows.length >= 8) break;
  }

  if (!windows.length) return;

  addCleanedSourceBlock(blocks, {
    block_type: "source_context_window",
    label: "Share count excerpts",
    source: "primary_document",
    text: windows.map((window) => text.slice(window.start, window.end)).join("\n---\n"),
  });
}

function addOutstandingPercentageContextBlock(
  blocks: Array<{ block_type: string; label: string; source: string; text: string }>,
  text: string,
) {
  const patterns = [
    /\b[^.]{0,520}?(?:beneficially\s+owns?|own(?:s|ed)?)[^.]{0,520}?\b[0-9][0-9,]*(?:\.\d+)?\s+(?:Class\s+[A-Z]\s+)?(?:ordinary\s+shares?|common\s+shares?|shares?)[^.]{0,520}?\brepresents?\s+approximately\s+[0-9]+(?:\.\d+)?%\s+of\s+(?:the\s+)?(?:total\s+)?(?:issued\s+and\s+outstanding|outstanding)[^.]{0,520}?\b(?:ordinary\s+shares?|common\s+shares?|shares?)\b[^.]{0,240}?/gi,
    /\b[^.]{0,520}?\brepresents?\s+approximately\s+[0-9]+(?:\.\d+)?%\s+of\s+(?:the\s+)?(?:total\s+)?(?:issued\s+and\s+outstanding|outstanding)[^.]{0,520}?\b(?:ordinary\s+shares?|common\s+shares?|shares?)\b[^.]{0,520}?\b[0-9][0-9,]*(?:\.\d+)?\s+(?:Class\s+[A-Z]\s+)?(?:ordinary\s+shares?|common\s+shares?|shares?)\b[^.]{0,240}?/gi,
  ];
  const snippets: string[] = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const snippet = normalizeText(match[0]);
      if (!snippet || snippets.some((item) => item === snippet)) continue;
      snippets.push(snippet);
      if (snippets.length >= 4) break;
    }
    if (snippets.length >= 4) break;
  }

  if (!snippets.length) return;

  addCleanedSourceBlock(blocks, {
    block_type: "source_context_window",
    label: "Outstanding share percentage context",
    source: "primary_document",
    text: snippets.join("\n"),
  });
}

function buildCleanedSourceBlocks(input: Sec424bParseInput, text: string, fullText = text) {
  const blocks: Array<{ block_type: string; label: string; source: string; text: string }> = [];

  addCleanedSourceBlock(blocks, {
    block_type: "primary_document_excerpt",
    label: "Primary 424B document excerpt",
    source: "primary_document",
    text: text.slice(0, 12_000),
  });

  const keySentences = extractSentences(
    text,
    [
      /\boffering\b/i,
      /\boffer and sell\b/i,
      /\bat[- ]?the[- ]market\b/i,
      /\bresale\b/i,
      /\bselling stockholders?\b/i,
      /\bwarrants?\b/i,
      /\bright[s]? offering\b/i,
      /\bstructured notes?\b/i,
      /\binitial public offering\b/i,
      /\bbusiness combination\b/i,
      /\bmerger\b/i,
      /\bdilution\b/i,
      /\buse of proceeds\b/i,
      /\bnet proceeds\b/i,
      /\bgross proceeds\b/i,
      /\bproceeds from this offering\b/i,
      /\bproceeds from the sale\b/i,
      /\bissued and outstanding\b/i,
      /\bshares?[^.]{0,120}?outstanding\b/i,
      /\boutstanding[^.]{0,120}?(?:prior to|before|after|this offering)\b/i,
    ],
    18,
  );
  addCleanedSourceBlock(blocks, {
    block_type: "selected_source_sentences",
    label: "Selected 424B source sentences",
    source: "primary_document",
    text: keySentences.join("\n"),
  });

  addOfferingTableBlock(blocks, fullText);
  addOutstandingShareCountTableBlock(blocks, fullText);
  addOutstandingPercentageContextBlock(blocks, fullText);
  addShareCountExcerptBlock(blocks, fullText);

  addHeadingSectionBlock(
    blocks,
    fullText,
    /\bUSE OF PROCEEDS\b/i,
    "Use of Proceeds section",
    /\b(?:use|intend|expect|estimate|receive|net proceeds|gross proceeds|general corporate purposes|research and development|working capital|debt repayment)\b/i,
  );
  addSourceWindowBlock(blocks, fullText, /\b(?:net proceeds|gross proceeds|receive net proceeds|use the net proceeds|proceeds from this offering)\b/i, "Proceeds context");
  if (/\b(?:offer and resale|offer and sell[^.]{0,180}selling|selling (?:securityholders|stockholders)[^.]{0,180}(?:offer|sell|resale)|for resale by)\b/i.test(text)) {
    addSourceWindowBlock(
      blocks,
      fullText,
      /\b(?:offer and resale|offer and sell[^.]{0,180}selling|selling (?:securityholders|stockholders)[^.]{0,180}(?:offer|sell|resale)|for resale by)\b/i,
      "Resale holder context",
    );
    addSellingHolderTableBlock(blocks, fullText);
  }
  if (/\b(?:at[- ]?the[- ]market offering|at market issuance sales agreement|equity distribution agreement)\b/i.test(text)) {
    addSourceWindowBlock(blocks, fullText, /\b(?:at[- ]?the[- ]market offering|at market issuance sales agreement|equity distribution agreement)\b/i, "ATM context");
  }
  if (/\b(?:pre-funded warrants?|common warrants?|placement-agent warrants?|public warrants?|private warrants?|exercise price of warrants?)\b/i.test(text)) {
    addSourceWindowBlock(
      blocks,
      fullText,
      /\b(?:exercise price of warrants?|exercisable[^.]{0,180}?exercise price|pre-funded warrants?|common warrants?|placement-agent warrants?|public warrants?|private warrants?)\b/i,
      "Warrant exercise and market price context",
    );
    addWarrantTermsConditionBlocks(blocks, fullText);
  }
  if (/\b(?:subscription rights|rights offering|over-subscription|oversubscription)\b/i.test(text)) {
    addSourceWindowBlock(blocks, fullText, /\b(?:subscription rights|rights offering|over-subscription|oversubscription)\b/i, "Rights offering context");
  }
  if (/\b(?:depositary shares|preference shares|series [a-z] preferred stock|liquidation preference)\b/i.test(text)) {
    addSourceWindowBlock(blocks, fullText, /\b(?:depositary shares|preference shares|series [a-z] preferred stock|liquidation preference)\b/i, "Preferred or depositary context");
  }
  if (/\b(?:structured notes?|reference asset|contingent coupon|autocallable|barrier)\b/i.test(text)) {
    addSourceWindowBlock(blocks, fullText, /\b(?:structured notes?|reference asset|contingent coupon|autocallable|barrier)\b/i, "Structured note context");
  }
  if (/\b(?:initial public offering|expected to begin trading|blank check company)\b/i.test(text)) {
    addSourceWindowBlock(blocks, fullText, /\b(?:initial public offering|expected to begin trading|blank check company)\b/i, "IPO context");
  }
  if (/\b(?:business combination|merger agreement|combination agreement)\b/i.test(text)) {
    addSourceWindowBlock(blocks, fullText, /\b(?:business combination|merger agreement|combination agreement)\b/i, "Transaction context");
  }
  if (/\b(?:substantial dilution|Nasdaq notice|delisting|FDA|clinical hold|clinical trial|going concern|working capital deficit|cash runway|bankruptcy)\b/i.test(text)) {
    addSourceWindowBlock(
      blocks,
      fullText,
      /\b(?:substantial dilution|Nasdaq notice|delisting|FDA|clinical hold|clinical trial|going concern|working capital deficit|cash runway|bankruptcy)\b/i,
      "Risk context",
    );
  }

  for (const attachment of input.attachments ?? []) {
    const label = `${attachment.filename ?? ""} ${attachment.description ?? ""}`;
    if (
      !/\b(?:sales agreement|equity distribution agreement|securities purchase agreement|purchase agreement|placement agency agreement|underwriting agreement|warrant|indenture|note|convertible|resale|selling stockholder|selling shareholder|fee table|6-k|8-k|ex-99|ex-10|ex-4)\b/i.test(
        label,
      )
    ) {
      continue;
    }

    addCleanedSourceBlock(blocks, {
      block_type: "attachment_source_excerpt",
      label: attachment.description ?? attachment.filename ?? "Attachment excerpt",
      source: attachment.filename ?? "attachment",
      text: attachment.text.slice(0, 8_000),
    });
  }

  return blocks.slice(0, 14);
}

export function parse424bFiling(input: Sec424bParseInput): Sec424bParserOutput {
  const rawText = combinedFilingText(input);
  const fullText = prepareFilingText(rawText);
  const text = extractionWindow(fullText);
  const sourceInventory = buildSourceInventory(input);
  const extractionWasWindowed = fullText.length > text.length;
  const marketContext = getMarketContext(input);
  const normalizedFormType = input.formType.toUpperCase();
  const isSupported = /^424B(?:[1-5]|7|8)?$/.test(normalizedFormType);
  const issuerName = extractIssuerName(input, text);
  const ticker = extractTicker(input, text);
  const atmShareAssumption = extractAtmShareAssumption(text);
  const filingMetadata = {
    registrationNumber: extractRegistrationNumber(text),
    supplementNumber: extractSupplementNumber(text),
    parentProspectusDate: extractParentProspectusDate(text),
    isPreliminary: /subject to completion|preliminary prospectus|preliminary prospectus supplement/i.test(text),
    documentFormatHint: /\bPS-\d+\b|pdf|page \d+ of \d+/i.test(rawText) ? "pdf_text_layer" : "html_text",
  };
  const structuredNoteTerms = extractStructuredNoteTerms(text);
  const variableOrMissingTerms =
    filingMetadata.isPreliminary ||
    /\[\s*[●•]\s*\]|\$\s*\[\s*[●•]\s*\]|not yet been determined/i.test(text);
  const referenceAssetDiffersFromIssuer = Boolean(
    structuredNoteTerms.referenceTicker &&
      ticker &&
      String(structuredNoteTerms.referenceTicker).toUpperCase() !== ticker.toUpperCase(),
  );
  const pdfTableFragility = filingMetadata.documentFormatHint === "pdf_text_layer" && /(?:PS-\d+|page \d+)/i.test(rawText);
  const calendarItems = extractCalendarItems(text);

  const warnings: string[] = [];
  if (!isSupported) {
    warnings.push("Unsupported form type for the 424B room.");
  }

  if (variableOrMissingTerms) {
    warnings.push("Preliminary, blank, or formula-based terms detected; parser should not infer missing final values.");
  }

  if (referenceAssetDiffersFromIssuer) {
    warnings.push("Structured note reference asset appears distinct from issuer; do not treat reference ticker as issuer ticker.");
  }

  if (pdfTableFragility) {
    warnings.push("PDF text-layer page markers detected; table pairings may require review.");
  }

  return {
    parserVersion: PARSER_VERSION_424B,
    parserGroup: PARSER_GROUP_424B,
    formType: isSupported ? normalizedFormType : FORM_SCOPE_424B,
    accessionNumber: input.accessionNumber ?? null,
    isSupported,
    summary: buildSummary(issuerName, normalizedFormType, []),
    facts: {},
    signals: [],
    calendarItems,
    warnings,
    raw: {
      textPreview: text.slice(0, 1500),
      cleaned_source_blocks: buildCleanedSourceBlocks(input, text, fullText),
      sourceTextStats: {
        originalLength: rawText.length,
        normalizedLength: fullText.length,
        extractionLength: text.length,
        extractionWasWindowed,
      },
      sourceInventory,
      atmShareAssumption: {
        postOfferingShareCountAssumptionNotSupply: atmShareAssumption.postOfferingShares,
        assumedSharesSold: atmShareAssumption.assumedSharesSold,
        assumedOfferingPrice: atmShareAssumption.assumedOfferingPrice,
        note:
          atmShareAssumption.postOfferingShares || atmShareAssumption.assumedSharesSold
            ? "ATM assumption fields are for dilution context only; they are not actual shares sold, registered resale supply, or final pricing."
            : null,
      },
      marketContext: marketContext ?? null,
      parentFilingContext: input.parentFilingContext ?? null,
    },
  };
}
