import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";

export type SecInvestableUniverseGateResult = {
  gate: "sec_investable_universe";
  action: "skip_analysis";
  reason: string;
  confidence: "high" | "medium";
  evidence: string[];
};

export function evaluateSecInvestableUniverse(input: SecFilingAnalysisInput): SecInvestableUniverseGateResult | null {
  const filingPackage = readRecord(input.filing_package) || {};
  const formType = normalizeFormType(filingPackage.form_type);
  const title = stringValue(filingPackage.title);
  const companyName = stringValue(filingPackage.company_name);
  const text = [companyName, title, stringValue(filingPackage.llm_text)].join("\n");

  if (hasTradableTicker(filingPackage, title)) return null;
  if (isAllowedWithoutResolvedTicker(formType, text)) return null;

  const unresolvedTickerEvidence = collectUnresolvedTickerEvidence(filingPackage, formType, title, companyName);
  if (unresolvedTickerEvidence.length) {
    return {
      gate: "sec_investable_universe",
      action: "skip_analysis",
      confidence: "high",
      reason: "No tradable ticker was identified for this SEC filing, so it is excluded from user-facing filing events.",
      evidence: unresolvedTickerEvidence.slice(0, 5),
    };
  }

  const evidence = collectNonInvestableEvidence(text, formType);
  if (!evidence.length) return null;
  if (hasListingOrTransactionException(text, formType)) return null;
  if (hasCommonEquityTenderException(text, formType)) return null;

  return {
    gate: "sec_investable_universe",
    action: "skip_analysis",
    confidence: evidence.length >= 2 ? "high" : "medium",
    reason: "SEC filing appears to involve a non-listed fund, trust, or similar vehicle without a tradable equity ticker.",
    evidence: evidence.slice(0, 5),
  };
}

export function buildSecInvestableUniverseSkipAnalysis(
  input: SecFilingAnalysisInput,
  gate: SecInvestableUniverseGateResult,
): Record<string, unknown> {
  const filingPackage = readRecord(input.filing_package) || {};
  const formType = normalizeFormType(filingPackage.form_type) || "SEC";

  return {
    analysis_action: "skip_analysis",
    skip_gate: gate.gate,
    skip_reason: gate.reason,
    source_group: "filings",
    market_scope: "company",
    event_type: "other",
    event_title: `${formType} excluded from Stock Radar filing analysis`,
    primary_ticker: {
      ticker: null,
      exchange: null,
    },
    tickers: [],
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    score: 0,
    score_reason: `Excluded before analysis. ${gate.reason}`,
    signal: "neutral",
    quick_take: "SEC filing excluded before user-facing analysis.",
    summary:
      gate.reason,
    why_it_matters:
      "Stock Radar excludes filings that do not map to a tradable listed equity or approved listing/transaction candidate.",
    bullish_points: [],
    bearish_points: [],
    key_evidence: gate.evidence,
    what_to_watch_next: [],
    related_tickers: [],
    calendar_items: [],
    confidence: gate.confidence,
    needs_human_review: false,
  };
}

function hasTradableTicker(filingPackage: Record<string, unknown>, title: string) {
  const primaryTicker = readRecord(filingPackage.primary_ticker);
  const candidates = [
    stringValue(primaryTicker?.ticker),
    stringValue(filingPackage.ticker),
    ...tickerArray(filingPackage.tickers),
    ...tickerHintsFromTitle(title),
  ];
  return candidates.some((candidate) => Boolean(normalizeTicker(candidate)));
}

function isAlwaysAllowedWithoutTicker(formType: string) {
  if (/^(?:S-1|F-1|S-1\/A|F-1\/A|EFFECT|424B4|8-A|8-A12B)$/.test(formType)) return true;
  return false;
}

function isAllowedWithoutResolvedTicker(formType: string, text: string) {
  if (isAlwaysAllowedWithoutTicker(formType)) return true;
  return hasPreListingOrSpacException(text, formType);
}

function hasPreListingOrSpacException(text: string, formType: string) {
  if (/^(?:S-4|S-4\/A|F-4|F-4\/A|425|8-K|8-K\/A|6-K|6-K\/A|PRE 14A|DEF 14A|DEFA14A|DEFM14A|PREM14A)$/.test(formType)) {
    return /\b(?:spac|de-spac|blank check|blank-check|special purpose acquisition|business combination|expected ticker|ticker change|new listing|initial listing|nasdaq listing|nyse listing|direct listing|first trading)\b/i.test(
      text,
    );
  }
  return false;
}

function collectUnresolvedTickerEvidence(
  filingPackage: Record<string, unknown>,
  formType: string,
  title: string,
  companyName: string,
) {
  const evidence = [
    `Form ${formType || "SEC"} has no resolved tradable ticker in raw/parser output.`,
  ];
  if (companyName) evidence.push(`Issuer/company name: ${withPeriod(companyName)}`);
  if (title) evidence.push(`SEC title: ${withPeriod(title)}`);

  const rawTicker = stringValue(filingPackage.ticker);
  const primaryTicker = stringValue(readRecord(filingPackage.primary_ticker)?.ticker);
  const tickerCount = tickerArray(filingPackage.tickers).length;
  if (!normalizeTicker(rawTicker) && !normalizeTicker(primaryTicker) && tickerCount === 0) {
    evidence.push("No usable ticker candidate was present in ticker, primary_ticker, or tickers.");
  }

  return evidence;
}

function collectNonInvestableEvidence(text: string, formType: string) {
  const evidence: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/\b(?:series trust|investment trust|advisers trust|fund trust|statutory trust)\b/i, "Issuer name or text indicates a trust/fund trust."],
    [/\b(?:income fund|municipal income fund|tax[-\s]?free fund|strategic capital(?: fund)?|closed[-\s]?end fund|interval fund|mutual fund|business development company|BDC)\b/i, "Issuer name or text indicates a fund or investment vehicle."],
    [/\b(?:non[-\s]?traded|not listed on (?:a|any) securities exchange|not traded on (?:a|any) exchange)\b/i, "Text indicates non-traded or non-listed securities."],
    [/\b(?:shares of beneficial interest|net asset value|\bNAV\b|valuation date)\b/i, "Text uses fund/NAV or beneficial-interest mechanics."],
    [/\b(?:repurchase offer|issuer tender offer|rule 13e-4)\b/i, "Text indicates issuer repurchase/tender mechanics."],
  ];

  for (const [pattern, reason] of checks) {
    if (pattern.test(text)) evidence.push(reason);
  }

  if (/^(?:DEF 14A|PRE 14A|DEFA14A|SC TO-I|SC TO-I\/A|SC TO-C|SC TO-T|SC TO-T\/A|SC 13E3|SC 13E3\/A|CB|CB\/A)$/.test(formType)) {
    if (/\b(?:fund|trust|investment company|registered investment company)\b/i.test(text)) {
      evidence.push(`${formType} filing has no tradable ticker and fund/trust wording.`);
    }
  }

  return uniqueStrings(evidence);
}

function hasListingOrTransactionException(text: string, formType: string) {
  if (/^(?:S-4|S-4\/A|F-4|F-4\/A|425)$/.test(formType)) return true;
  return /\b(?:spac|de-spac|blank check|blank-check|special purpose acquisition|acquisition corp(?:oration)?|merger corp(?:oration)?|business combination|merger agreement|expected ticker|ticker change|listed on (?:nasdaq|nyse|nyse american)|nasdaq listing|nyse listing|direct listing)\b/i.test(
    text,
  );
}

function hasCommonEquityTenderException(text: string, formType: string) {
  if (!/^(?:SC TO-I|SC TO-I\/A|SC TO-T|SC TO-T\/A|SC 13E3|SC 13E3\/A|CB|CB\/A)$/.test(formType)) return false;
  return /\b(?:common stock|class a common|ordinary shares|american depositary shares|ADSs?)\b/i.test(text) &&
    /\b(?:per share in cash|cash price|offer price|purchase price|tender offer price)\b/i.test(text) &&
    !/\b(?:net asset value|\bNAV\b|valuation date|shares of beneficial interest)\b/i.test(text);
}

function tickerArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      return record ? stringValue(record.ticker) || stringValue(record.symbol) : stringValue(item);
    })
    .filter(Boolean);
}

function tickerHintsFromTitle(title: string) {
  const hints: string[] = [];
  const matches = title.matchAll(/\(([A-Z][A-Z0-9.\-]{0,9}(?:,\s*[A-Z][A-Z0-9.\-]{0,9})*)\)/g);
  for (const match of matches) {
    const group = match[1] || "";
    for (const item of group.split(",")) {
      hints.push(item.trim());
    }
  }
  return hints;
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  if (!ticker || ticker === "N/A" || ticker === "NA" || ticker === "NONE" || ticker === "NULL") return null;
  if (/^(?:CIK|INC|CORP|CORPORATION|LTD|LLC|PLC|TRUST|FUND)$/.test(ticker)) return null;
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return null;
  return ticker;
}

function normalizeFormType(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: string[]) {
  return values.filter((value, index, list) => value && list.indexOf(value) === index);
}

function withPeriod(value: string) {
  const trimmed = value.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
