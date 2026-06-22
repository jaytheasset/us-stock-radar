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
  Sec424bSecurityFact,
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

function isHistoricalOfferingContext(text: string, index: number): boolean {
  const context = text.slice(Math.max(0, index - 280), index + 120);
  return /previously completed|prior offering|historical offering|December\s+\d{1,2},\s+20\d{2}/i.test(context);
}

function extractMoneyAfter(text: string, labelPattern: string): number | null {
  const pattern = new RegExp(`${labelPattern}[^.]{0,180}?${MONEY_PATTERN}`, "i");
  for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
    if (isHistoricalOfferingContext(text, match.index ?? 0)) {
      continue;
    }

    return parseMoney(match?.[1], match?.[2]);
  }

  return null;
}

function extractMaxOfferingAmount(text: string): number | null {
  return (
    extractMoneyAfter(
      text,
      "(?:aggregate offering price|maximum aggregate offering price|offer and sell[^.]{0,80}?aggregate offering price)",
    ) ??
    parseMoney(
      text.match(
        new RegExp(
          `\\bUp to\\s+${MONEY_PATTERN}\\s+of\\s+(?:common stock|ordinary shares|class\\s+[a-z]\\s+common stock)`,
          "i",
        ),
      )?.[1],
      text.match(
        new RegExp(
          `\\bUp to\\s+${MONEY_PATTERN}\\s+of\\s+(?:common stock|ordinary shares|class\\s+[a-z]\\s+common stock)`,
          "i",
        ),
      )?.[2],
    )
  );
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

function extractExchange(input: Sec424bParseInput, text: string): string | null {
  if (input.issuer?.exchange) {
    return input.issuer.exchange;
  }

  const match = firstMatch(text, [
    /\((NASDAQ|NYSE|NYSE American|Nasdaq Capital Market|OTC(?:QB|QX)?):\s*[A-Z][A-Z0-9.]{0,9}\)/i,
    /\b(NASDAQ|NYSE|NYSE American|Nasdaq Capital Market|OTC(?:QB|QX)?)\b/i,
  ]);

  return match?.[1]?.toUpperCase() ?? null;
}

function extractSharesOffered(text: string): number | null {
  const match = firstMatch(text, [
    /\bwe (?:are offering|offer|will offer|may offer and sell)\s+(?:up to\s+)?([0-9][0-9,]*)\s+shares\s+of\s+(?:our\s+)?(?:(?:class|series)\s+[a-z]\s+)?(?:common stock|ordinary shares)/i,
    /\bissuer (?:is offering|offers)\s+(?:up to\s+)?([0-9][0-9,]*)\s+shares\s+of\s+(?:(?:class|series)\s+[a-z]\s+)?(?:common stock|ordinary shares)/i,
    /\b(?:primary offering|public offering) of\s+(?:up to\s+)?([0-9][0-9,]*)\s+shares\s+of\s+(?:(?:class|series)\s+[a-z]\s+)?(?:common stock|ordinary shares)/i,
  ]);

  return parseNumber(match?.[1]);
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

function extractSellingStockholderShares(text: string): number | null {
  const match = firstMatch(text, [
    /selling stockholders?[^.]{0,180}?(?:offer and resell|offer|resell|sell)\s+(?:up to\s+)?([0-9][0-9,]*)\s+shares/i,
    /(?:resale|resell)\s+(?:of\s+)?(?:up to\s+)?([0-9][0-9,]*)\s+shares[^.]{0,120}?selling stockholders?/i,
  ]);

  return parseNumber(match?.[1]);
}

function extractWarrantsOffered(text: string): number | null {
  const match = firstMatch(text, [
    /\b([0-9][0-9,]*)\s+(?:pre-funded\s+)?warrants?\b/i,
    /warrants?\s+to\s+purchase\s+([0-9][0-9,]*)\s+shares/i,
  ]);

  return parseNumber(match?.[1]);
}

function extractCountNear(text: string, labelPattern: string): number | null {
  const pattern = new RegExp(`(?:${labelPattern})[^.]{0,120}?([0-9][0-9,]*)`, "i");
  const match = text.match(pattern);
  return parseNumber(match?.[1]);
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

function extractIpoKind(text: string): "traditional" | "spac" | null {
  if (!hasIpoListingContext(text)) {
    return null;
  }

  if (
    /\b(?:SPAC|special purpose acquisition company|blank check company|blank-check company|trust account|units? consisting of one share of common stock and (?:one )?warrant)\b/i.test(
      text,
    )
  ) {
    return "spac";
  }

  return "traditional";
}

function hasIpoListingContext(text: string): boolean {
  const hasIpoSignal =
    /\binitial public offering\b|\bIPO\b|\bdirect listing\b|\bpublic listing\b|\bfirst trading day\b|\bexpected to begin trading\b|\bbegin trading on\b|\bpriced (?:its|our|the) initial public offering\b|\bregistration statement[^.]{0,120}?declared effective\b/i.test(
      text,
    );
  if (!hasIpoSignal) {
    return false;
  }

  if (
    /\b(?:at[- ]the[- ]market|shelf registration|base prospectus|selling stockholders?|selling shareholders?|resale|from time to time|previously completed|post-closing|business combination has closed|de-SPAC|redemption|liquidation)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return /\b(?:listing|listed|trading|Nasdaq|NYSE|New York Stock Exchange|NYSE American|public offering price|price of \$|offering price)\b/i.test(
    text,
  );
}

function extractSpacTransactionStatus(text: string): Record<string, unknown> {
  const spacOrDeSpacContext =
    /\b(?:SPAC|special purpose acquisition company|blank check company|de-SPAC|business combination|merger proposal|combination agreement|minimum cash condition|redemption|trust account|ticker change|combined company)\b/i.test(
      text,
    ) || /\b[A-Z][A-Za-z0-9&.,' -]{2,80}\s+Acquisition Corp\.?\b/.test(text);
  if (!spacOrDeSpacContext) {
    return {
      is_spac_transaction_status: false,
      has_sufficient_facts: false,
    };
  }

  const targetMatch = firstMatch(text, [
    /business combination (?:with|between)[^.]{0,80}?([A-Z][A-Za-z0-9&.,' -]{2,100}?)(?:\.|,| and | holders| stockholders)/i,
    /merger (?:with|between)[^.]{0,80}?([A-Z][A-Za-z0-9&.,' -]{2,100}?)(?:\.|,| and | holders| stockholders)/i,
    /holders of ([A-Z][A-Za-z0-9&.,' -]{2,100}?)(?:\s+in connection|\s+will|\s+are|\.)/i,
  ]);
  const sharesToIssue = extractCountNear(text, "(?:issuance of up to|issue up to|to issue up to)");
  const voteDate = extractFirstDateNear(text, "(?:special meeting|stockholder meeting|shareholder meeting|vote)");
  const closingDate = extractFirstDateNear(text, "(?:closing|business combination is expected to close|transaction is expected to close)");
  const minimumCash = extractMoneyNear(text, "minimum cash condition|minimum cash");
  const redemptionAmount = extractMoneyNear(text, "redemption");
  const tickerChange = firstMatch(text, [
    /(?:ticker|symbol)[^.]{0,80}?(?:change|will be|expected to trade)[^.]{0,80}?"?([A-Z][A-Z0-9.-]{0,9})"?/i,
    /combined company[^.]{0,100}?(?:Nasdaq|NYSE)[^.]{0,80}?"?([A-Z][A-Z0-9.-]{0,9})"?/i,
  ]);
  const publicHolderOwnership = firstMatch(text, [
    /public stockholders[^.]{0,120}?(?:own|hold)[^.]{0,40}?approximately\s+([0-9][0-9,.]*\s*%)/i,
    /approximately\s+([0-9][0-9,.]*\s*%)[^.]{0,80}?public stockholders/i,
  ]);
  const targetHolderOwnership = firstMatch(text, [
    /(?:target (?:stockholders|shareholders|holders)|[A-Z][A-Za-z0-9&.,' -]{2,80} holders)[^.]{0,80}?(?:own|hold)[^.]{0,40}?approximately\s+([0-9][0-9,.]*\s*%)/i,
    /approximately\s+([0-9][0-9,.]*\s*%)[^.]{0,100}?(?:target (?:stockholders|shareholders|holders)|[A-Z][A-Za-z0-9&.,' -]{2,80} holders)/i,
  ]);
  const statusSignals = [
    targetMatch?.[1],
    sharesToIssue,
    voteDate,
    closingDate,
    minimumCash,
    redemptionAmount,
    tickerChange?.[1],
    publicHolderOwnership?.[1],
    targetHolderOwnership?.[1],
  ].filter((value) => value != null && value !== "");

  return {
    is_spac_transaction_status: statusSignals.length >= 2,
    has_sufficient_facts: statusSignals.length >= 2,
    transaction_type: /business combination/i.test(text) ? "business_combination" : /merger/i.test(text) ? "merger" : null,
    target_name: targetMatch?.[1]?.trim() ?? null,
    shares_to_issue: sharesToIssue,
    vote_date: voteDate,
    closing_date: closingDate,
    minimum_cash_condition: minimumCash,
    redemption_amount: redemptionAmount,
    ticker_change_to: tickerChange?.[1] ?? null,
    current_public_holder_ownership: publicHolderOwnership?.[1] ?? null,
    target_holder_ownership: targetHolderOwnership?.[1] ?? null,
  };
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

function extractPreferredDepositaryTerms(text: string): Record<string, unknown> {
  if (!hasPreferredDepositaryContext(text)) {
    return {
      depositaryShareCount: null,
      depositaryFraction: null,
      preferredSeries: null,
      liquidationPreferencePerPreferredShare: null,
      liquidationPreferencePerDepositaryShare: null,
      dividendRatePercent: null,
      redemptionDate: null,
      proposedListingSymbol: null,
    };
  }

  const explicitDepositaryShareCount = firstMatch(text, [
    /\b([0-9][0-9,]*)\s+Depositary Shares\b/i,
    /\b([0-9][0-9,]*)\s+depositary shares\b/i,
  ]);
  const fraction = firstMatch(text, [
    /each depositary share[^.]{0,120}?represent(?:s|ing)\s+(?:a\s+)?(1\/[0-9,]+)(?:st|nd|rd|th)?\s+(?:ownership\s+)?interest/i,
    /(1\/[0-9,]+)(?:st|nd|rd|th)?\s+(?:ownership\s+)?interest[^.]{0,80}?(?:preferred|preference) share/i,
  ]);
  const preferredSeries = firstMatch(text, [
    /(?:Series\s+[A-Z0-9-]+[^.]{0,160}?(?:Preferred|Preference) Shares?)/i,
    /([0-9.]+%\s+[^.]{0,120}?(?:Preferred|Preference) Shares?)/i,
  ]);

  return {
    depositaryShareCount: parseNumber(explicitDepositaryShareCount?.[1]),
    depositaryFraction: fraction?.[1]?.replace(",", "") ?? null,
    preferredSeries: preferredSeries?.[1] ?? preferredSeries?.[0] ?? null,
    liquidationPreferencePerPreferredShare:
      parseMoney(
        text.match(
          /liquidation preference(?:\s+(?:of|is|will be))?\s+\$\s*([0-9][0-9,]*(?:\.\d+)?)\s+per\s+(?:preferred |preference )?share/i,
        )?.[1],
        undefined,
      ) ?? extractMoneyNear(text, "liquidation preference[^.]{0,40}?per\\s+(?:preferred|preference)?\\s*share"),
    liquidationPreferencePerDepositaryShare:
      parseMoney(
        text.match(/(?:equivalent to|representing)\s+\$\s*([0-9][0-9,]*(?:\.\d+)?)\s+per depositary share/i)?.[1],
        undefined,
      ) ?? extractMoneyNear(text, "(?:equivalent to|representing)[^.]{0,80}?per depositary share"),
    dividendRatePercent: extractPercentNear(text, "(?:dividend rate|dividends? (?:will )?accrue|rate of)"),
    redemptionDate: extractFirstDateNear(text, "(?:redeem|redemption|redeemable)"),
    proposedListingSymbol:
      firstMatch(text, [
        /(?:listing symbol|symbol)\s+"?([A-Z][A-Z0-9.-]{0,9})"?/i,
        /(?:NYSE|Nasdaq|NASDAQ)[^.]{0,80}?"([A-Z][A-Z0-9.-]{0,9})"/i,
      ])?.[1] ?? null,
  };
}

function extractRightsOfferingTerms(text: string): Record<string, unknown> {
  if (!hasRightsOfferingContext(text)) {
    return {
      rightsCount: null,
      sharesIssuable: null,
      rightsNeededPerShare: null,
      recordDate: null,
      expirationDate: null,
      subscriptionPriceFormula: null,
      transferable: false,
      overSubscriptionPrivilege: false,
      rightsSymbol: null,
      estimatedProceeds: null,
    };
  }

  const rightsCount = firstMatch(text, [
    /\b([0-9][0-9,]*)\s+(?:transferable\s+)?rights\b/i,
    /\bdistributing\s+([0-9][0-9,]*)\s+rights\b/i,
  ]);
  const sharesIssuable = firstMatch(text, [
    /(?:up to|approximately)\s+([0-9][0-9,]*)\s+shares[^.]{0,120}?(?:issuable|common stock)/i,
    /(?:issue|purchase)\s+(?:up to\s+)?([0-9][0-9,]*)\s+shares[^.]{0,120}?rights/i,
  ]);
  const ratio = firstMatch(text, [
    /one\s+(?:new\s+)?(?:common\s+)?share[^.]{0,80}?for every\s+([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)\s+rights/i,
    /([0-9]+|one|two|three|four|five|six|seven|eight|nine|ten)\s+rights[^.]{0,100}?one\s+(?:new\s+)?(?:common\s+)?share/i,
  ]);
  const rightsSymbol = firstMatch(text, [
    /(?:rights (?:will )?(?:trade|be listed)[^.]{0,120}?symbol\s+"?([A-Z][A-Z0-9 .-]{0,12})"?)/i,
    /(?:rights symbol|symbol for the rights)\s+"?([A-Z][A-Z0-9 .-]{0,12})"?/i,
  ]);

  return {
    rightsCount: parseNumber(rightsCount?.[1]),
    sharesIssuable: parseNumber(sharesIssuable?.[1]),
    rightsNeededPerShare: parseNumber(ratio?.[1]),
    recordDate: extractFirstDateNear(text, "record date"),
    expirationDate: extractFirstDateNear(text, "expiration date|expire"),
    subscriptionPriceFormula:
      extractSentences(text, [/subscription price/i, /formula/i, /NAV/i, /net asset value/i], 2)[0] ?? null,
    transferable: /transferable rights/i.test(text),
    overSubscriptionPrivilege: /over-subscription privilege|oversubscription privilege/i.test(text),
    rightsSymbol: rightsSymbol?.[1]?.trim() ?? null,
    estimatedProceeds: extractMoneyNear(text, "estimated (?:gross |net )?proceeds"),
  };
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

function extractMultiLegWarrantTerms(text: string): Record<string, unknown> {
  if (!/pre-funded warrants?|common warrants?|placement agent warrants?/i.test(text)) {
    return {
      commonSharesOffered: null,
      preFundedWarrants: null,
      commonWarrants: null,
      placementAgentWarrants: null,
      underlyingShares: null,
      commonSharePrice: null,
      preFundedWarrantPurchasePrice: null,
      preFundedWarrantExercisePrice: null,
      commonWarrantExercisePrice: null,
      placementAgentWarrantExercisePrice: null,
      ownershipCapPercent: null,
    };
  }

  const preFundedWarrants = firstMatch(text, [
    /pre-funded warrants?\s+to\s+purchase\s+(?:up to\s+)?([0-9][0-9,]*)\s+shares/i,
    /([0-9][0-9,]*)\s+pre-funded warrants?/i,
  ]);
  const commonWarrants = firstMatch(text, [
    /common warrants?\s+to\s+purchase\s+(?:up to\s+)?([0-9][0-9,]*)\s+shares/i,
    /([0-9][0-9,]*)\s+common warrants?/i,
  ]);

  return {
    commonSharesOffered: extractSharesOffered(text),
    preFundedWarrants: parseNumber(preFundedWarrants?.[1]),
    commonWarrants: parseNumber(commonWarrants?.[1]),
    placementAgentWarrants: extractCountNear(text, "placement agent warrants?"),
    underlyingShares: parseNumber(
      text.match(/([0-9][0-9,]*)\s+shares(?:\s+of\s+(?:class\s+a\s+)?common stock)?\s+issuable upon exercise/i)?.[1],
    ),
    commonSharePrice: extractPricePerShare(text),
    preFundedWarrantPurchasePrice:
      parseMoney(
        text.match(/purchase price for each pre-funded warrant[^.]{0,80}?(?:is|of)\s+\$\s*([0-9][0-9,]*(?:\.\d+)?)/i)?.[1],
        undefined,
      ) ?? extractMoneyNear(text, "pre-funded warrant[^.]{0,120}?(?:purchase price|offering price)"),
    preFundedWarrantExercisePrice: extractMoneyNear(text, "pre-funded warrant[^.]{0,120}?exercise price"),
    commonWarrantExercisePrice: extractMoneyNear(text, "common warrant[^.]{0,120}?exercise price"),
    placementAgentWarrantExercisePrice: extractMoneyNear(text, "placement agent warrant[^.]{0,120}?exercise price"),
    ownershipCapPercent: extractPercentNear(text, "beneficial ownership"),
  };
}

function extractUnitsOffered(text: string): number | null {
  const match = firstMatch(text, [/\b([0-9][0-9,]*)\s+units\b/i]);
  return parseNumber(match?.[1]);
}

function extractSharesOutstanding(text: string, marketContext: Sec424bMarketContext | undefined): number | null {
  if (typeof marketContext?.shares_outstanding === "number") {
    return marketContext.shares_outstanding;
  }

  const patterns = [
    /(?:had|have|there (?:are|were))\s+([0-9][0-9,]*)\s+shares[^.]{0,120}?outstanding/gi,
    /([0-9][0-9,]*)\s+shares[^.]{0,120}?(?:issued and )?outstanding/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const context = text.slice(match.index ?? 0, (match.index ?? 0) + 220);
      if (/held by non-affiliates|non-affiliates/i.test(context)) {
        continue;
      }

      return parseNumber(match?.[1]);
    }
  }

  return null;
}

function extractPublicFloatShares(text: string, marketContext: Sec424bMarketContext | undefined): number | null {
  if (typeof marketContext?.public_float === "number") {
    return marketContext.public_float;
  }

  const match = text.match(/([0-9][0-9,]*)\s+shares[^.]{0,140}?held by non-affiliates/i);
  return parseNumber(match?.[1]);
}

function extractPricePerShare(text: string): number | null {
  const patterns = [
    /(?<!assumed )public offering price of\s+\$\s*([0-9][0-9,]*(?:\.\d+)?)\s+per share/i,
    /offering price (?:is|of)\s+\$\s*([0-9][0-9,]*(?:\.\d+)?)\s+per share/i,
    /purchase price of\s+\$\s*([0-9][0-9,]*(?:\.\d+)?)\s+per share/i,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
      if (isHistoricalOfferingContext(text, match.index ?? 0)) {
        continue;
      }

      return parseNumber(match?.[1]);
    }
  }

  return null;
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

function buildSecurityFacts(
  sharesOffered: number | null,
  sellingStockholderShares: number | null,
  warrantsOffered: number | null,
  unitsOffered: number | null,
  maxOfferingAmount: number | null,
  pricePerShare: number | null,
  preferredTerms: Record<string, unknown>,
  rightsOfferingTerms: Record<string, unknown>,
  structuredNoteTerms: Record<string, unknown>,
  multiLegWarrantTerms: Record<string, unknown>,
): Sec424bSecurityFact[] {
  const securities: Sec424bSecurityFact[] = [];

  if (sharesOffered) {
    securities.push({
      securityType: "common_stock_primary",
      amount: sharesOffered,
      pricePerSecurity: pricePerShare,
      source: "issuer offering share count",
    });
  }

  if (sellingStockholderShares) {
    securities.push({
      securityType: "common_stock_resale",
      amount: sellingStockholderShares,
      source: "selling stockholder resale share count",
    });
  }

  if (warrantsOffered) {
    securities.push({
      securityType: "warrants",
      amount: warrantsOffered,
      source: "warrant count",
    });
  }

  if (unitsOffered) {
    securities.push({
      securityType: "units",
      amount: unitsOffered,
      source: "unit count",
    });
  }

  if (maxOfferingAmount) {
    securities.push({
      securityType: "common_stock_at_market",
      maximumAggregateOfferingAmount: maxOfferingAmount,
      source: "maximum aggregate offering amount",
    });
  }

  if (typeof preferredTerms.depositaryShareCount === "number") {
    securities.push({
      securityType: "depositary_shares_preferred",
      amount: preferredTerms.depositaryShareCount,
      source: "depositary share count",
    });
  }

  if (typeof rightsOfferingTerms.rightsCount === "number" || typeof rightsOfferingTerms.sharesIssuable === "number") {
    securities.push({
      securityType: "subscription_rights",
      amount: (rightsOfferingTerms.rightsCount ?? rightsOfferingTerms.sharesIssuable) as number,
      source: "rights offering terms",
    });
  }

  if (typeof structuredNoteTerms.principalAmount === "number") {
    securities.push({
      securityType: "structured_notes",
      amount: structuredNoteTerms.principalAmount,
      source: "structured note principal amount",
    });
  }

  if (typeof multiLegWarrantTerms.preFundedWarrants === "number") {
    securities.push({
      securityType: "pre_funded_warrants",
      amount: multiLegWarrantTerms.preFundedWarrants,
      source: "pre-funded warrant count",
    });
  }

  if (typeof multiLegWarrantTerms.placementAgentWarrants === "number") {
    securities.push({
      securityType: "placement_agent_warrants",
      amount: multiLegWarrantTerms.placementAgentWarrants,
      source: "placement-agent warrant count",
    });
  }

  return securities;
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
  const exchange = extractExchange(input, text);
  const sharesOffered = extractSharesOffered(text);
  const atmShareAssumption = extractAtmShareAssumption(text);
  const sellingStockholderShares = extractSellingStockholderShares(text);
  const warrantsOffered = extractWarrantsOffered(text);
  const unitsOffered = extractUnitsOffered(text);
  const atTheMarket =
    /at[- ]?the[- ]market offering|at market issuance sales agreement|equity distribution agreement|sales agreement prospectus/i.test(
      text,
    );
  const pricePerShare = atTheMarket ? null : extractPricePerShare(text);
  const grossProceeds = atTheMarket ? null : extractMoneyAfter(text, "gross proceeds");
  const netProceeds = atTheMarket ? null : extractMoneyAfter(text, "net proceeds");
  const maxOfferingAmount = extractMaxOfferingAmount(text);
  const filingMetadata = {
    registrationNumber: extractRegistrationNumber(text),
    supplementNumber: extractSupplementNumber(text),
    parentProspectusDate: extractParentProspectusDate(text),
    isPreliminary: /subject to completion|preliminary prospectus|preliminary prospectus supplement/i.test(text),
    documentFormatHint: /\bPS-\d+\b|pdf|page \d+ of \d+/i.test(rawText) ? "pdf_text_layer" : "html_text",
  };
  const preferredTerms = extractPreferredDepositaryTerms(text);
  const rightsOfferingTerms = extractRightsOfferingTerms(text);
  const structuredNoteTerms = extractStructuredNoteTerms(text);
  const multiLegWarrantTerms = extractMultiLegWarrantTerms(text);
  const spacTransactionStatus = extractSpacTransactionStatus(text);
  const sharesOutstanding = extractSharesOutstanding(text, marketContext);
  const publicFloatShares = extractPublicFloatShares(text, marketContext);
  const offeringToOutstandingRatio =
    sharesOffered && sharesOutstanding ? Number((sharesOffered / sharesOutstanding).toFixed(4)) : null;
  const sellingStockholderToOutstandingRatio =
    sellingStockholderShares && sharesOutstanding
      ? Number((sellingStockholderShares / sharesOutstanding).toFixed(4))
      : null;
  const maxOfferingToMarketCapRatio =
    maxOfferingAmount && typeof marketContext?.market_cap === "number" && marketContext.market_cap > 0
      ? Number((maxOfferingAmount / marketContext.market_cap).toFixed(4))
      : null;
  const resale = hasResaleContext(text);
  const noCompanyProceeds = /will not receive any proceeds|no proceeds from the sale/i.test(text);
  const noNewTerms =
    /solely to|typographical error|administrative|exhibit 107|fee table/i.test(text) &&
    /no securities (?:are|will be) being offered|no terms[^.]{0,80}?changed|no new securities/i.test(text);
  const strategicTransaction = /merger|business combination|share exchange|combination agreement/i.test(text);
  const shareholderVote = /special meeting|stockholder approval|shareholder approval/i.test(text);
  const fdaClinical = /\bFDA\b|clinical hold|clinical trial|phase [123]/i.test(text);
  const listingRisk = /Nasdaq notice|NYSE notice|delisting|minimum bid|stockholders'? equity deficiency/i.test(text);
  const legalRisk = /litigation|lawsuit|settlement|subpoena|SEC investigation/i.test(text);
  const financialRisk = /going concern|liquidity|working capital deficit|cash runway|bankruptcy/i.test(text);
  const ipoKind = extractIpoKind(text);
  const ipoListing = ipoKind !== null;
  const preferredDepositary = hasPreferredDepositaryContext(text);
  const rightsOffering = hasRightsOfferingContext(text);
  const structuredNote =
    /structured notes?|reference asset|contingent coupon|autocallable|(?:downside|coupon|payment|buffer|initial) barrier/i.test(
      text,
    );
  const multiLegWarrant = /pre-funded warrants?|common warrants?|placement agent warrants?/i.test(text);
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
