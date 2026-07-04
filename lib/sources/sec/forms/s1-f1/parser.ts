import {
  S1F1_PARSER_GROUP,
  S1F1_PARSER_VERSION,
  S1F1_ROOM_FORM_SCOPE,
  type ConfidenceLevel,
  type SecEventType,
  type S1F1AnalysisOutput,
  type S1F1AuditorAccountingExtraction,
  type S1F1CalendarItem,
  type S1F1DetectedSection,
  type S1F1DocumentBlock,
  type S1F1DocumentFilterItem,
  type S1F1DocumentFilterSummary,
  type S1F1DocumentTable,
  type S1F1Evidence,
  type S1F1ExhibitExtractions,
  type S1F1ExhibitIndexItem,
  type S1F1ExtractedTableRow,
  type S1F1ExtractionCandidate,
  type S1F1Facts,
  type S1F1FinancialExtractions,
  type S1F1FinancialLineItem,
  type S1F1FinancialStatementTableInventoryItem,
  type S1F1FilingFacts,
  type S1F1ForeignIssuerPhraseHit,
  type S1F1ForeignIssuerFacts,
  type S1F1FixtureExpected,
  type S1F1GovernanceExtractions,
  type S1F1ContextualCandidate,
  type S1F1CrossSectionHint,
  type S1F1LiquidityPhraseInventory,
  type S1F1MarketContext,
  type S1F1NoteTopicInventory,
  type S1F1SourceCandidate,
  type S1F1OfferingFacts,
  type S1F1ParserInput,
  type S1F1ParserOutput,
  type S1F1RequiredOutputJson,
  type S1F1RiskFactorsStructure,
  type S1F1SectionDetection,
  type S1F1SectionExtractions,
  type S1F1SectionTable,
  type S1F1Signal,
  type S1F1SpacTransactionStatusFacts,
  deliveryLevelFromScore,
} from "./types.ts";
import { filterS1F1SubmissionText } from "./documentFilter.ts";

const SUPPORTED_FORMS = new Set(["S-1", "F-1", "S-1/A", "F-1/A", "POS AM", "S-1MEF", "F-1MEF"]);

const SIGNAL_PRIORITY: SecEventType[] = [
  "ipo_listing",
  "listing_risk",
  "dilution_risk",
  "financial_risk",
  "legal_risk",
  "fda_clinical",
  "strategic_transaction",
  "insider_ownership",
  "leadership_governance",
  "product_update",
  "other",
  "earnings",
  "sales_performance",
  "shareholder_vote",
  "dividends",
  "capital_return",
];

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\t/g, " ");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeFormType(value: string): string {
  return compact(value).toUpperCase();
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, "").replace(/\.$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoney(amount: string | undefined, unit: string | undefined): number | null {
  const parsed = toNumber(amount);
  if (parsed == null) return null;
  const normalizedUnit = unit?.toLowerCase();
  if (normalizedUnit === "billion") return parsed * 1_000_000_000;
  if (normalizedUnit === "million") return parsed * 1_000_000;
  return parsed;
}

function firstMatch(text: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match;
  }
  return null;
}

function firstNonAssumedFixedPrice(text: string): RegExpMatchArray | null {
  const pattern =
    /(?:public offering price|offering price|resale price)[^\n.]{0,80}?\$([0-9][0-9,.]*)\s+per\s+(?:share|ordinary share|ADS|unit)/gi;
  for (const match of text.matchAll(pattern)) {
    const start = Math.max(0, (match.index ?? 0) - 80);
    const context = text.slice(start, (match.index ?? 0) + match[0].length);
    if (/\bassumed\b|\bestimated\b|\bplaceholder\b|\[[^\]]*\]/i.test(context)) continue;
    return match;
  }
  return null;
}

function evidenceFor(text: string, pattern: RegExp, label: string): S1F1Evidence | null {
  const match = pattern.exec(text);
  if (!match || match.index == null) return null;
  const start = Math.max(0, match.index - 90);
  const end = Math.min(text.length, match.index + match[0].length + 130);
  return {
    label,
    excerpt: compact(text.slice(start, end)),
    source: "filing_text",
  };
}

function metadataEvidence(label: string, value: string): S1F1Evidence {
  return {
    label,
    excerpt: value,
    source: "metadata",
  };
}

function offeringTermText(text: string): string {
  const boundary = text.search(/\bTABLE OF CONTENTS\b|\bRISK FACTORS\b/i);
  const end = boundary > 1_000 ? Math.min(boundary, 80_000) : Math.min(text.length, 80_000);
  return text.slice(0, end);
}

function extractCompanyName(text: string, input: S1F1ParserInput): string | null {
  if (input.metadata?.companyName) return input.metadata.companyName;
  const match = firstMatch(text, [
    /(?:exact name of registrant as specified in its charter|company|issuer|registrant)\s*[:\-]\s*([^\n]+)/i,
    /(?:we|our company)\s+are\s+([A-Z][A-Za-z0-9 .,&'-]{2,100})/i,
  ]);
  return match?.[1] ? compact(match[1]).replace(/[.;:]$/, "") : null;
}

function extractTicker(text: string, input: S1F1ParserInput): string | null {
  if (input.metadata?.ticker) return input.metadata.ticker;
  const patterns = [
    /(?:ticker symbol|trading symbol|under the symbol|under the ticker symbol)\s*(?:is|will be|:)?\s*[^A-Z0-9]{0,8}([A-Z][A-Z0-9.-]{0,9})/i,
    /\b(?:Nasdaq|NYSE|NYSE American|New York Stock Exchange)\b[^\n.]{0,200}?under\s+(?:the\s+)?symbol\s*[^A-Z0-9]{0,8}([A-Z][A-Z0-9.-]{0,9})/i,
  ];
  const invalidTickers = new Set(["S", "SYMBOL", "THE", "A"]);
  for (const pattern of patterns) {
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(globalPattern)) {
      const ticker = match[1]?.toUpperCase().replace(/\.$/, "");
      if (ticker && !invalidTickers.has(ticker)) return ticker;
    }
  }
  return null;
}

function extractExchange(text: string, input: S1F1ParserInput): string | null {
  if (input.metadata?.exchange) return input.metadata.exchange;
  const exchangePatterns: Array<[RegExp, string]> = [
    [/Nasdaq Global Select Market/i, "Nasdaq Global Select Market"],
    [/Nasdaq Global Market/i, "Nasdaq Global Market"],
    [/Nasdaq Capital Market/i, "Nasdaq Capital Market"],
    [/New York Stock Exchange|NYSE\b/i, "NYSE"],
    [/NYSE American/i, "NYSE American"],
  ];
  for (const [pattern, exchange] of exchangePatterns) {
    if (pattern.test(text)) return exchange;
  }
  return null;
}

function extractRegistrationNumber(text: string): string | null {
  const match = firstMatch(text, [
    /Registration\s+(?:No\.?|Number)\s*[:#]?\s*(333-[0-9]+)/i,
    /File\s+No\.?\s*[:#]?\s*(333-[0-9]+)/i,
    /earlier effective registration statement[\s\S]{0,260}?(?:File\s+No\.?\s*)?(333-[0-9]+)/i,
    /registration statement[^.\n]{0,180}?(?:Registration|File)\s+No\.?\s*(333-[0-9]+)/i,
    /prior registration statement[^.\n]{0,180}?(333-[0-9]+)/i,
  ]);
  return match?.[1] ?? null;
}

function extractRule462bAmount(text: string): number | null {
  const match = firstMatch(text, [
    /additional[^$.\n]{0,160}?\$([0-9][0-9,.]*)\s*(million|billion)?/i,
    /proposed maximum aggregate offering price[^$.\n]{0,160}?\$([0-9][0-9,.]*)\s*(million|billion)?/i,
  ]);
  return parseMoney(match?.[1], match?.[2]);
}

function extractFilingFacts(text: string, input: S1F1ParserInput): S1F1FilingFacts {
  const reportedFormType = normalizeFormType(input.formType);
  const isRule462bMef = reportedFormType === "S-1MEF" || reportedFormType === "F-1MEF";
  const isPostEffective =
    reportedFormType === "POS AM" || /POST-EFFECTIVE AMENDMENT\s+No\.?\s*\d+\s+TO\s+FORM\s+[SF]-1/i.test(text);
  const filingVariant: S1F1FilingFacts["filing_variant"] = isRule462bMef
    ? "rule_462b_mef"
    : isPostEffective
      ? "post_effective_amendment"
      : /\/A$/i.test(reportedFormType)
        ? "pre_effective_amendment"
        : SUPPORTED_FORMS.has(reportedFormType)
          ? "base_registration"
          : "unknown";

  const deregisterUnsoldSecurities =
    /deregister(?:s|ing)?[^.\n]{0,140}?unsold|unsold[^.\n]{0,140}?deregister|remove from registration[^.\n]{0,140}?unsold|terminate(?:s|d)?[^.\n]{0,120}?offering/i.test(
      text,
    );
  const noAdditionalSecuritiesRegistered =
    /no additional securities (?:are being |will be )?registered|does not register any additional securities/i.test(text);

  const postEffectivePurpose =
    filingVariant !== "post_effective_amendment"
      ? null
      : deregisterUnsoldSecurities
        ? "deregistration"
        : noAdditionalSecuritiesRegistered ||
            /solely[^.\n]{0,120}?(?:file exhibits|update[^.\n]{0,60}?experts|experts section)|prospectus[^.\n]{0,80}?omitted/i.test(
              text,
            )
          ? "limited_update"
          : /prospectus supplement|update[^.\n]{0,80}?prospectus/i.test(text)
            ? "prospectus_update"
            : "unknown";

  const boundaryCase = filingVariant === "post_effective_amendment" || filingVariant === "rule_462b_mef";
  const parentRegistrationNumber = extractRegistrationNumber(text);

  return {
    filing_family: "s1_f1_registration",
    reported_form_type: reportedFormType,
    filing_variant: filingVariant,
    boundary_case: boundaryCase,
    parent_context_needed:
      (filingVariant === "pre_effective_amendment" ||
        (boundaryCase && filingVariant !== "rule_462b_mef")) &&
      !input.parentFilingContext,
    parent_registration_number: parentRegistrationNumber,
    post_effective_purpose: postEffectivePurpose,
    deregister_unsold_securities: deregisterUnsoldSecurities,
    no_additional_securities_registered: noAdditionalSecuritiesRegistered,
    rule_462b: {
      base_form: reportedFormType.startsWith("F-1") ? "F-1" : reportedFormType.startsWith("S-1") ? "S-1" : null,
      prior_registration_number: isRule462bMef ? parentRegistrationNumber : null,
      added_securities_amount: isRule462bMef ? extractRule462bAmount(text) : null,
      automatic_effective:
        isRule462bMef &&
        /effective (?:upon|immediately upon) filing|shall become effective upon filing|Rule 462\(b\)/i.test(text),
      within_20_percent_limit: isRule462bMef && /20\s*%|twenty percent|not exceed[^.\n]{0,80}?20/i.test(text),
    },
    evidence: [
      evidenceFor(text, /post-effective amendment[^.\n]*/i, "Post-effective amendment"),
      evidenceFor(text, /Rule 462\(b\)[^.\n]*/i, "Rule 462(b) registration"),
      evidenceFor(text, /deregister(?:s|ing)?[^.\n]{0,140}?unsold|unsold[^.\n]{0,140}?deregister[^.\n]*/i, "Deregistration of unsold securities"),
      evidenceFor(text, /no additional securities (?:are being |will be )?registered[^.\n]*/i, "No additional securities registered"),
    ].filter((item): item is S1F1Evidence => Boolean(item)),
  };
}

function extractForeignIssuerFacts(text: string, input: S1F1ParserInput): S1F1ForeignIssuerFacts {
  const reportedFormType = normalizeFormType(input.formType);
  return {
    is_foreign_private_issuer: reportedFormType.startsWith("F-1") || /foreign private issuer/i.test(text),
    ads_offering: /\bAmerican Depositary Shares\b|\bADSs?\b/i.test(text),
    vie_structure: /variable interest entit(?:y|ies)|\bVIEs?\b|contractual arrangements/i.test(text),
    hfcaa_or_pcaob_risk:
      /Holding Foreign Companies Accountable Act|\bHFCAA\b|PCAOB|trading[^.\n]{0,80}?prohibit|prohibit[^.\n]{0,80}?trading/i.test(
        text,
      ),
    cayman_holding_company: /Cayman Islands holding company|Cayman Islands exempted company/i.test(text),
  };
}

function extractSecurities(text: string): string[] {
  const securities = new Set<string>();
  const candidates: Array<[RegExp, string]> = [
    [/\bcommon stock\b/i, "common stock"],
    [/\bordinary shares\b/i, "ordinary shares"],
    [/\bamerican depositary shares\b|\bADSs?\b/i, "ADS"],
    [/\bwarrants?\b/i, "warrants"],
    [/\bunits?\b/i, "units"],
    [/\bpreferred stock\b/i, "preferred stock"],
  ];
  for (const [pattern, label] of candidates) {
    if (pattern.test(text)) securities.add(label);
  }
  return [...securities];
}

function extractOfferingFacts(text: string, input: S1F1ParserInput): S1F1OfferingFacts {
  const termsText = offeringTermText(text);
  const hasIpo = /initial public offering|initial offering|no public market currently exists|proposed public offering/i.test(termsText);
  const isSpacIpo = /special purpose acquisition company|blank check company|\bSPAC\b/i.test(termsText);
  const hasResale = /resale|selling stockholders?|selling shareholders?|selling shareholder/i.test(termsText);
  const hasPrimary = /\bwe are offering\b|issuer is offering|company is offering|primary offering|use of proceeds/i.test(termsText);
  const kind: S1F1OfferingFacts["kind"] = hasIpo
    ? "ipo"
    : hasPrimary && hasResale
      ? "mixed"
      : hasResale
        ? "resale"
        : hasPrimary
          ? "primary"
          : "unknown";

  const sharePatterns = [
    /(?:we are offering|company is offering|issuer is offering|offering(?: of)?|resale of|register(?:ing)?(?: for resale)?(?: of)?|sell)\s+(?:up to\s+)?([0-9][0-9,]*)\s+(?:shares|ordinary shares|american depositary shares|ADSs?|units)/i,
    /([0-9][0-9,]*)\s+(?:shares|ordinary shares|american depositary shares|ADSs?|units)[^.]{0,180}?(?:This is an initial offering|This is our initial public offering|initial public offering)/i,
    /registering the sale of an additional\s+([0-9][0-9,]*)\s+(?:shares|ordinary shares|american depositary shares|ADSs?|units)/i,
    /resale by the selling (?:stockholders?|shareholders?) of\s+(?:up to\s+)?([0-9][0-9,]*)\s+(?:shares|ordinary shares|american depositary shares|ADSs?|units)/i,
    /([0-9][0-9,]*)\s+(?:shares|ordinary shares|american depositary shares|ADSs?|units)\s+(?:are being offered|may be sold|registered for resale)/i,
  ];
  const shareMatch = firstMatch(termsText, sharePatterns);

  const sellingShareholderMatch = firstMatch(termsText, [
    /selling (?:stockholders?|shareholders?)[^\n.]{0,180}?(?:sell|offer(?:ing)?(?: an aggregate of)?|resale of|register(?:ing)?(?: for resale)?(?: of)?)\s+(?:up to\s+)?([0-9][0-9,]*)\s+(?:shares|ordinary shares|ADSs?|units)/i,
    /selling (?:stockholders?|shareholders?) of\s+(?:up to\s+)?([0-9][0-9,]*)\s+(?:shares|ordinary shares|ADSs?|units)/i,
    /(?:up to\s+)?([0-9][0-9,]*)\s+(?:shares|ordinary shares|ADSs?|units)[^\n.]{0,120}?selling (?:stockholders?|shareholders?)/i,
  ]);

  const priceRangeMatch = firstMatch(termsText, [
    /price per (?:share|ordinary share|ADS|unit)[^\n.]{0,100}?\$([0-9][0-9,.]*)\s*(?:and|to|-)\s*\$([0-9][0-9,.]*)/i,
    /price of (?:our|the)?\s*(?:common stock|Class A common stock|ADSs?|ordinary shares)?[^\n.]{0,120}?\$([0-9][0-9,.]*)\s*(?:and|to|-)\s*\$([0-9][0-9,.]*)/i,
    /\$([0-9][0-9,.]*)\s*(?:and|to|-)\s*\$([0-9][0-9,.]*)\s+per\s+(?:share|ordinary share|ADS|unit)/i,
    /price range[^\n.]{0,80}?\$([0-9][0-9,.]*)\s*(?:and|to|-)\s*\$([0-9][0-9,.]*)/i,
  ]);

  const fixedPriceMatch = firstNonAssumedFixedPrice(termsText);

  const grossProceedsMatch = firstMatch(termsText, [
    /(?:gross proceeds|offering size|aggregate offering price)[^\n.]{0,100}?\$([0-9][0-9,.]*)\s*(million|billion)?/i,
    /raise[^\n.]{0,80}?\$([0-9][0-9,.]*)\s*(million|billion)?/i,
  ]);

  const useOfProceedsMatch = firstMatch(termsText, [
    /use of proceeds\s*[:\-]\s*([^\n]+)/i,
    /we intend to use the net proceeds\s+([^.\n]+[.])/i,
  ]);

  const underwriterMatch = firstMatch(termsText, [
    /underwriters?\s*[:\-]\s*([^\n.]+)/i,
    /representatives? of the underwriters?\s*[:\-]\s*([^\n.]+)/i,
  ]);

  const grossProceeds = parseMoney(grossProceedsMatch?.[1], grossProceedsMatch?.[2]);
  const sharesOffered = toNumber(shareMatch?.[1]);
  const sellingShareholderShares = toNumber(sellingShareholderMatch?.[1]);
  const priceLow = priceRangeMatch ? toNumber(priceRangeMatch[1]) : toNumber(fixedPriceMatch?.[1]);
  const priceHigh = priceRangeMatch ? toNumber(priceRangeMatch[2]) : toNumber(fixedPriceMatch?.[1]);

  const impliedGrossProceeds =
    grossProceeds ??
    (sharesOffered != null && priceHigh != null ? sharesOffered * priceHigh : null) ??
    (input.parentFilingContext?.offering?.gross_proceeds ?? null);

  return {
    kind,
    ipo_kind: kind === "ipo" ? (isSpacIpo ? "spac" : "traditional") : null,
    securities: extractSecurities(text),
    shares_offered: sharesOffered,
    price_low: priceLow,
    price_high: priceHigh,
    gross_proceeds: impliedGrossProceeds,
    selling_shareholder_shares: sellingShareholderShares,
    use_of_proceeds: useOfProceedsMatch?.[1] ? compact(useOfProceedsMatch[1]) : null,
    underwriters: underwriterMatch?.[1]
      ? underwriterMatch[1].split(/,| and /i).map((value) => compact(value)).filter(Boolean)
      : [],
  };
}

function extractAmendmentFacts(text: string, input: S1F1ParserInput) {
  const reportedFormType = normalizeFormType(input.formType);
  const coverText = text.slice(0, 12_000);
  const isAmendment =
    /\/A$/i.test(reportedFormType) ||
    reportedFormType === "POS AM" ||
    /Amendment No\.?\s*\d+|POST-EFFECTIVE AMENDMENT\s+No\.?\s*\d+\s+TO\s+FORM\s+[SF]-1/i.test(coverText);
  const amendmentNumber = toNumber(text.match(/Amendment No\.?\s*(\d+)/i)?.[1]);
  const routineOrAdministrative =
    isAmendment &&
    /this\s+(?:post-effective\s+)?amendment[^.\n]{0,260}?(?:solely to file exhibits|solely[^.\n]{0,120}?update[^.\n]{0,60}?experts|no material changes?|no other changes?|no additional securities (?:are being |will be )?registered|administrative update|typographical corrections?|exhibit-only)/i.test(
      coverText,
    );
  const materialChangeMatch = firstMatch(text, [
    /(?:this amendment|amendment no\.?\s*\d+)[^.]{0,160}?(?:updates?|revises?|increases?|decreases?|adds?|reflects?)\s+([^.\n]+[.])/i,
    /material(?:ly)? (?:amend|change|update)[^.]{0,160}([^.\n]+[.])/i,
  ]);

  return {
    is_amendment: isAmendment,
    amendment_number: amendmentNumber,
    stated_material_change: materialChangeMatch?.[1] ? compact(materialChangeMatch[1]) : null,
    routine_or_administrative: routineOrAdministrative,
    parent_context_provided: Boolean(input.parentFilingContext),
  };
}

function summarizeMarketContext(
  offering: S1F1OfferingFacts,
  marketContext: S1F1MarketContext | null | undefined,
) {
  if (!marketContext) {
    return {
      provided: false,
      offering_to_market_cap_pct: null,
      shares_to_float_pct: null,
    };
  }

  const offeringToMarketCapPct =
    offering.gross_proceeds != null && marketContext.market_cap
      ? Number(((offering.gross_proceeds / marketContext.market_cap) * 100).toFixed(2))
      : null;

  const sharesToFloatPct =
    offering.shares_offered != null && marketContext.public_float
      ? Number(((offering.shares_offered / marketContext.public_float) * 100).toFixed(2))
      : null;

  return {
    provided: true,
    offering_to_market_cap_pct: offeringToMarketCapPct,
    shares_to_float_pct: sharesToFloatPct,
  };
}

function hasLegalRisk(text: string): boolean {
  return (
    /material legal proceedings?|pending litigation|pending lawsuits?|SEC investigation|subpoena|Holding Foreign Companies Accountable Act|\bHFCAA\b|variable interest entit(?:y|ies)|\bVIEs?\b/i.test(
      text,
    ) || /PCAOB[^.\n]{0,180}?(?:unable to inspect|inspect our auditor|trading[^.\n]{0,80}?prohibit|prohibit[^.\n]{0,80}?trading)/i.test(text)
  );
}

function hasFdaOrClinicalRisk(text: string): boolean {
  return (
    /clinical trial|Phase\s+(?:1|2|3|I|II|III)|trial results?|patient enrollment|\b510\(k\)\b|premarket approval/i.test(
      text,
    ) || /\b(?:IND|NDA|BLA|PDUFA)\b/.test(text)
  );
}

function extractRisks(text: string) {
  return {
    going_concern: /going concern|substantial doubt about (?:our|the company's) ability to continue|cash runway|insufficient liquidity/i.test(
      text,
    ),
    listing_risk: /minimum bid|continued listing|Nasdaq deficiency|NYSE deficiency|does not currently satisfy (?:Nasdaq|NYSE|NYSE American|continued listing)/i.test(
      text,
    ),
    legal_risk: hasLegalRisk(text),
    fda_or_clinical: hasFdaOrClinicalRisk(text),
    insider_control: /controlled company|will control[^.\n]{0,160}?(?:voting power|shares|stock)|majority of (?:the )?voting power/i.test(
      text,
    ),
    strategic_transaction: /merger agreement|business combination agreement|business combination with|de-?SPAC|reverse merger|reorganization agreement|asset purchase agreement|redemption result|minimum cash condition|ticker change/i.test(
      text,
    ),
  };
}

type SectionDefinition = {
  key: string;
  title: string;
  aliases: RegExp[];
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
  { key: "prospectus_summary", title: "Prospectus Summary", aliases: [/^prospectus summary$/i, /^summary$/i] },
  { key: "the_offering", title: "The Offering", aliases: [/^the offering$/i, /^offering$/i] },
  { key: "risk_factors", title: "Risk Factors", aliases: [/^risk factors$/i, /^risks? related to\b/i, /^risks? relating to\b/i] },
  { key: "use_of_proceeds", title: "Use of Proceeds", aliases: [/^(estimated )?use of (net )?proceeds$/i] },
  { key: "dividend_policy", title: "Dividend Policy", aliases: [/^dividend policy$/i, /^dividends?$/i] },
  { key: "capitalization", title: "Capitalization", aliases: [/^capitalization$/i] },
  { key: "dilution", title: "Dilution", aliases: [/^dilution$/i] },
  {
    key: "mda",
    title: "Management's Discussion and Analysis",
    aliases: [
      /^management'?s discussion and analysis/i,
      /^md&a$/i,
      /^operating and financial review(?: and prospects)?$/i,
    ],
  },
  { key: "results_of_operations", title: "Results of Operations", aliases: [/^results of operations$/i, /^operating results$/i] },
  { key: "liquidity_capital_resources", title: "Liquidity and Capital Resources", aliases: [/^liquidity and capital resources$/i, /^capital resources$/i] },
  { key: "cash_flows", title: "Cash Flows", aliases: [/^cash flows?$/i] },
  {
    key: "critical_accounting",
    title: "Critical Accounting Estimates",
    aliases: [/^critical accounting estimates$/i, /^critical accounting policies$/i],
  },
  {
    key: "market_risk",
    title: "Quantitative and Qualitative Disclosures About Market Risk",
    aliases: [/^quantitative and qualitative disclosures about market risk$/i],
  },
  {
    key: "contractual_obligations",
    title: "Contractual Obligations",
    aliases: [/^contractual obligations$/i, /^tabular disclosure of contractual obligations$/i],
  },
  { key: "research_development", title: "Research and Development", aliases: [/^research and development$/i] },
  { key: "trend_information", title: "Trend Information", aliases: [/^trend information$/i] },
  {
    key: "business",
    title: "Business",
    aliases: [/^(our )?business$/i, /^business overview$/i, /^company overview$/i],
  },
  {
    key: "corporate_history_structure",
    title: "Corporate History and Structure",
    aliases: [/^corporate history and structure$/i, /^history and corporate structure$/i],
  },
  {
    key: "summary_financial_data",
    title: "Summary Financial Data",
    aliases: [/^summary financial data$/i, /^summary consolidated financial data$/i, /^selected financial data$/i],
  },
  { key: "management", title: "Management", aliases: [/^management$/i, /^directors and executive officers$/i] },
  { key: "executive_compensation", title: "Executive Compensation", aliases: [/^executive compensation$/i] },
  {
    key: "principal_stockholders",
    title: "Principal Stockholders / Principal Shareholders",
    aliases: [/^principal (stockholders|shareholders)$/i, /^security ownership$/i, /^beneficial ownership$/i],
  },
  {
    key: "selling_stockholders",
    title: "Selling Stockholders / Selling Shareholders / Selling Securityholders",
    aliases: [/^selling (stockholders|shareholders|securityholders)$/i],
  },
  {
    key: "related_party_transactions",
    title: "Certain Relationships and Related Party Transactions",
    aliases: [
      /^certain relationships and related (party )?transactions$/i,
      /^certain relationships and related transactions$/i,
      /^related party transactions$/i,
      /^related person transactions$/i,
      /^transactions with related persons$/i,
      /^transactions with related parties$/i,
      /^policies and procedures for related party transactions$/i,
    ],
  },
  { key: "legal_proceedings", title: "Legal Proceedings", aliases: [/^legal proceedings$/i, /^litigation$/i, /^proceedings$/i, /^claims$/i] },
  { key: "commitments_contingencies", title: "Commitments and Contingencies", aliases: [/^commitments and contingencies$/i, /^contingencies$/i] },
  {
    key: "description_of_securities",
    title: "Description of Securities",
    aliases: [/^description of (capital stock|share capital|securities)$/i, /^description of ordinary shares$/i],
  },
  {
    key: "shares_eligible_for_future_sale",
    title: "Shares Eligible for Future Sale",
    aliases: [/^shares eligible for future sale$/i],
  },
  {
    key: "material_tax_consequences",
    title: "Material U.S. Federal Income Tax Consequences",
    aliases: [/^material u\.?s\.? federal income tax consequences$/i, /^taxation$/i],
  },
  { key: "underwriting", title: "Underwriting", aliases: [/^underwriting$/i, /^placement agent$/i, /^selling agent$/i] },
  { key: "plan_of_distribution", title: "Plan of Distribution", aliases: [/^plan of distribution$/i] },
  { key: "legal_matters", title: "Legal Matters", aliases: [/^legal matters$/i] },
  { key: "experts", title: "Experts", aliases: [/^experts$/i] },
  {
    key: "where_you_can_find_more_information",
    title: "Where You Can Find More Information",
    aliases: [/^where you can find more information$/i, /^additional information$/i],
  },
  {
    key: "index_to_financial_statements",
    title: "Index to Financial Statements",
    aliases: [/^index to (consolidated )?financial statements$/i],
  },
  { key: "market_for_common_equity", title: "Market for Common Equity", aliases: [/^market for common equity$/i] },
  {
    key: "recent_sales_unregistered",
    title: "Recent Sales of Unregistered Securities",
    aliases: [/^recent sales of unregistered securities$/i],
  },
  {
    key: "indemnification",
    title: "Indemnification of Directors and Officers",
    aliases: [/^indemnification of directors and officers$/i],
  },
  {
    key: "other_expenses",
    title: "Other Expenses of Issuance and Distribution",
    aliases: [/^other expenses of issuance and distribution$/i],
  },
  { key: "undertakings", title: "Undertakings", aliases: [/^undertakings$/i] },
  { key: "signatures", title: "Signatures", aliases: [/^signatures$/i] },
  {
    key: "exhibit_index",
    title: "Exhibit Index",
    aliases: [
      /^exhibit index$/i,
      /^index to exhibits$/i,
      /^exhibits$/i,
      /^part ii - information not required in prospectus$/i,
      /^item 16\.? exhibits and financial statement schedules$/i,
      /^item 8\.? exhibits and financial statement schedules$/i,
      /^financial statement schedules$/i,
      /^exhibits and financial statement schedules$/i,
    ],
  },
  {
    key: "enforceability_civil_liabilities",
    title: "Enforceability of Civil Liabilities",
    aliases: [/^enforceability of civil liabilities$/i],
  },
  { key: "exchange_controls", title: "Exchange Controls", aliases: [/^exchange controls?$/i] },
  {
    key: "foreign_private_issuer_status",
    title: "Foreign Private Issuer Status",
    aliases: [/^foreign private issuer status$/i],
  },
  { key: "home_country_practice", title: "Home Country Practice", aliases: [/^home country practice$/i] },
  { key: "depositary", title: "Depositary", aliases: [/^depositary$/i] },
  {
    key: "description_of_ads",
    title: "Description of American Depositary Shares",
    aliases: [/^description of american depositary shares$/i, /^description of adss$/i],
  },
  { key: "regulations", title: "Regulations", aliases: [/^regulations?$/i] },
  {
    key: "operating_and_financial_review",
    title: "Operating and Financial Review and Prospects",
    aliases: [/^operating and financial review and prospects$/i, /^operating and financial review$/i],
  },
];

const FOREIGN_ISSUER_PHRASES: Array<{ phrase: string; pattern: RegExp }> = [
  { phrase: "foreign private issuer", pattern: /foreign private issuer/i },
  { phrase: "ADS", pattern: /\bADSs?\b|American Depositary Shares/i },
  { phrase: "ordinary shares", pattern: /ordinary shares/i },
  { phrase: "depositary", pattern: /depositary/i },
  { phrase: "Cayman", pattern: /Cayman/i },
  { phrase: "BVI", pattern: /\bBVI\b|British Virgin Islands/i },
  { phrase: "PRC", pattern: /\bPRC\b|People'?s Republic of China/i },
  { phrase: "Hong Kong", pattern: /Hong Kong/i },
  { phrase: "VIE", pattern: /\bVIEs?\b/i },
  { phrase: "WFOE", pattern: /\bWFOE\b|wholly foreign-owned enterprise/i },
  { phrase: "contractual arrangements", pattern: /contractual arrangements/i },
  { phrase: "variable interest entity", pattern: /variable interest entit(?:y|ies)/i },
  { phrase: "HFCAA", pattern: /\bHFCAA\b|Holding Foreign Companies Accountable Act/i },
  { phrase: "PCAOB", pattern: /\bPCAOB\b|Public Company Accounting Oversight Board/i },
  { phrase: "exchange control", pattern: /exchange controls?/i },
  { phrase: "dividend remittance", pattern: /dividend remittance|remit dividends?|remittance of dividends/i },
  { phrase: "enforceability of civil liabilities", pattern: /enforceability of civil liabilities/i },
  { phrase: "home country practice", pattern: /home country practice/i },
];

function stripHeadingDecorations(line: string): string {
  return compact(line)
    .replace(/^item\s+\d+[a-z]?\.\s*/i, "")
    .replace(/^[ivxlcdm]+\.\s+/i, "")
    .replace(/\s+\.{2,}\s*(?:[A-Z]-)?\d+$/i, "")
    .replace(/\s+(?:[A-Z]-)?\d+$/i, "")
    .replace(/[.:;]+$/g, "")
    .trim();
}

function isBadHeadingCandidate(line: string): boolean {
  const text = compact(line);
  if (!text) return true;
  if (/^table of contents$/i.test(text)) return true;
  if (/\bcontinued\b/i.test(text)) return true;
  if (/^(?:page|pages?)$/i.test(text)) return true;
  if (/^\d+$/.test(text)) return true;
  if (text.includes(" | ") && /\$|shares?|assets?|liabilities?|revenue|income/i.test(text)) return true;
  if (text.length > 180) return true;
  return false;
}

function isAccountingLineItem(text: string): boolean {
  return /^(cash|assets?|liabilities|stockholders'? equity|shareholders'? equity|revenue|net (loss|income)|operating expenses?|total assets?|total liabilities|accumulated deficit|additional paid-in capital|common stock|ordinary shares|working capital)\b/i.test(
    compact(text),
  );
}

function isPageNumberOrTocText(text: string): boolean {
  const value = compact(text);
  return /^table of contents$/i.test(value) || /^page\s*\d*$/i.test(value) || /^\d+$/.test(value) || /^[A-Z]-?\d+$/.test(value);
}

function matchSectionDefinition(line: string): { definition: SectionDefinition; confidence: ConfidenceLevel; exact: boolean } | null {
  if (isBadHeadingCandidate(line)) return null;
  const normalized = stripHeadingDecorations(line);
  if (!normalized) return null;

  for (const definition of SECTION_DEFINITIONS) {
    if (definition.aliases.some((pattern) => pattern.test(normalized))) {
      const isExact = definition.title.toLowerCase() === normalized.toLowerCase();
      return { definition, confidence: isExact ? "high" : "medium", exact: isExact };
    }
  }
  return null;
}

function nearbyLines(lines: string[], lineIndex: number, radius: number): string {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  return lines.slice(start, end).map(compact).filter(Boolean).join(" ");
}

function hasRecentTableOfContents(lines: string[], lineIndex: number): boolean {
  const start = Math.max(0, lineIndex - 120);
  return lines.slice(start, lineIndex).some((line) => /^table of contents$/i.test(compact(line)));
}

function looksLikeTocEntry(lines: string[], lineIndex: number): boolean {
  const line = compact(lines[lineIndex]);
  if (!hasRecentTableOfContents(lines, lineIndex)) return false;
  const previousLines = lines
    .slice(Math.max(0, lineIndex - 4), lineIndex)
    .map(compact)
    .filter(Boolean);
  if (previousLines.some((candidate) => candidate.length > 55 && /[.;]$/.test(candidate))) return false;
  if (/\.{2,}\s*(?:[A-Z]-)?\d+$/i.test(line) || /\s+(?:[A-Z]-)?\d+$/.test(line)) return true;

  const nextLines = lines
    .slice(lineIndex + 1, lineIndex + 7)
    .map(compact)
    .filter(Boolean);
  if (nextLines[0] && nextLines[0].length > 40 && /[.;]$/.test(nextLines[0]) && !matchSectionDefinition(nextLines[0])) {
    return false;
  }
  const nextHeadingLikeCount = nextLines.filter((candidate) => Boolean(matchSectionDefinition(candidate))).length;
  const nextParagraphLikeCount = nextLines.filter((candidate) => candidate.length > 90 && /[.;]$/.test(candidate)).length;
  return nextHeadingLikeCount >= 2 && nextParagraphLikeCount === 0;
}

function blockLooksLikeTocEntry(blocks: S1F1DocumentBlock[], index: number): boolean {
  const block = blocks[index];
  if (!block || block.order > 120) return false;

  const recentToc = blocks
    .slice(Math.max(0, index - 80), index)
    .some((candidate) => /^table of contents$/i.test(candidate.text));
  if (!recentToc) return false;

  if (/\.{2,}\s*(?:[A-Z]-)?\d+$/i.test(block.text) || /\s+(?:[A-Z]-)?\d+$/.test(block.text)) return true;

  const nextBlocks = blocks.slice(index + 1, index + 6).filter((candidate) => !candidate.insideTable);
  if (nextBlocks[0] && nextBlocks[0].text.length > 45 && /[.;]$/.test(nextBlocks[0].text) && !matchSectionDefinition(nextBlocks[0].text)) {
    return false;
  }

  const headingLikeCount = nextBlocks.filter((candidate) => Boolean(matchSectionDefinition(candidate.text))).length;
  const paragraphLikeCount = nextBlocks.filter((candidate) => candidate.text.length > 90 && /[.;]$/.test(candidate.text)).length;
  return headingLikeCount >= 2 && paragraphLikeCount === 0;
}

function makeDetectedSection(
  definition: SectionDefinition,
  heading: string,
  lineIndex: number,
  confidence: ConfidenceLevel,
  lines: string[],
  tocHint = false,
  options: {
    source?: "dom_block" | "line";
    score?: number;
    blockOrder?: number | null;
    insideTable?: boolean;
  } = {},
): S1F1DetectedSection {
  return {
    key: definition.key,
    title: definition.title,
    heading: stripHeadingDecorations(heading),
    lineIndex,
    confidence,
    excerpt: nearbyLines(lines, lineIndex, 2),
    ...(tocHint ? { tocHint: true } : {}),
    ...(options.source ? { source: options.source } : {}),
    ...(options.score != null ? { score: options.score } : {}),
    ...(options.blockOrder != null ? { blockOrder: options.blockOrder } : {}),
    ...(options.insideTable != null ? { insideTable: options.insideTable } : {}),
  };
}

function findHeadingLineIndex(lines: string[], heading: string, fallback: number): number {
  const normalizedHeading = stripHeadingDecorations(heading).toLowerCase();
  const index = lines.findIndex((line) => stripHeadingDecorations(line).toLowerCase() === normalizedHeading);
  return index >= 0 ? index : fallback;
}

function scoreBlockHeading(
  block: S1F1DocumentBlock,
  match: { definition: SectionDefinition; confidence: ConfidenceLevel; exact: boolean },
  tocKeys: Set<string>,
): number {
  let score = 50;
  const text = compact(block.text);
  if (match.exact) score += 14;
  if (/^h[1-4]$/.test(block.tag)) score += 24;
  if (block.isBold) score += 12;
  if (block.isCentered) score += 10;
  if (block.isAllCaps || block.isTitleCase) score += 7;
  if (block.isStandalone && text.length <= 90) score += 8;
  if (block.anchorHint && match.definition.aliases.some((pattern) => pattern.test(block.anchorHint ?? ""))) score += 8;
  if (tocKeys.has(match.definition.key)) score += 6;

  if (block.insideTable) score -= 36;
  if (block.isTableHeaderCell) score -= 26;
  if (block.isTableRowLabel) score -= 32;
  if (isAccountingLineItem(text)) score -= 70;
  if (isPageNumberOrTocText(text)) score -= 90;
  if (/\bcontinued\b/i.test(text)) score -= 40;
  if (text.length > 130) score -= 30;
  if (/[.;]$/.test(text) && match.definition.key !== "risk_factors") score -= 16;
  if (text.includes(" | ")) score -= 70;

  return score;
}

function detectS1F1SectionsFromBlocks(text: string, blocks: S1F1DocumentBlock[]): S1F1SectionDetection | null {
  if (blocks.length === 0) return null;

  const lines = text.split("\n");
  const tocHints: S1F1DetectedSection[] = [];
  const rawCandidates: S1F1DetectedSection[] = [];
  const tocKeys = new Set<string>();

  blocks.forEach((block, index) => {
    const match = matchSectionDefinition(block.text);
    if (!match) return;
    const lineIndex = findHeadingLineIndex(lines, block.text, block.order);
    const tocHint = blockLooksLikeTocEntry(blocks, index);
    const score = scoreBlockHeading(block, match, tocKeys);
    const detected = makeDetectedSection(match.definition, block.text, lineIndex, match.confidence, lines, tocHint, {
      source: "dom_block",
      score,
      blockOrder: block.order,
      insideTable: block.insideTable,
    });
    if (tocHint) {
      tocHints.push(detected);
      tocKeys.add(detected.key);
      return;
    }
    if (score >= 55) rawCandidates.push(detected);
  });

  if (rawCandidates.length === 0 && tocHints.length === 0) return null;

  const rescoredCandidates = rawCandidates.map((candidate) =>
    tocKeys.has(candidate.key) ? { ...candidate, score: (candidate.score ?? 0) + 6 } : candidate,
  );
  const selectedByKey = new Map<string, S1F1DetectedSection>();
  const warnings: string[] = [];

  for (const candidate of rescoredCandidates) {
    const current = selectedByKey.get(candidate.key);
    if (!current || (candidate.score ?? 0) > (current.score ?? 0) + 4) {
      selectedByKey.set(candidate.key, candidate);
      continue;
    }
    if (current && Math.abs((candidate.score ?? 0) - (current.score ?? 0)) <= 4) {
      warnings.push(`Multiple close body heading candidates detected for ${candidate.key}; selected the earlier candidate.`);
      if ((candidate.blockOrder ?? Number.MAX_SAFE_INTEGER) < (current.blockOrder ?? Number.MAX_SAFE_INTEGER)) {
        selectedByKey.set(candidate.key, candidate);
      }
    }
  }

  const sections = [...selectedByKey.values()].sort(
    (a, b) => (a.blockOrder ?? a.lineIndex) - (b.blockOrder ?? b.lineIndex),
  );
  const seen = new Set(sections.map((section) => section.key));
  for (const hint of tocHints) {
    if (!seen.has(hint.key)) {
      warnings.push(`Heading ${hint.title} appeared only in a likely table of contents block.`);
    }
  }

  return { sections, tocHints, warnings };
}

function detectS1F1SectionsFromLines(text: string): S1F1SectionDetection {
  const lines = text.split("\n");
  const tocHints: S1F1DetectedSection[] = [];
  const bodyCandidates: S1F1DetectedSection[] = [];

  lines.forEach((line, lineIndex) => {
    const match = matchSectionDefinition(line);
    if (!match) return;
    const tocHint = looksLikeTocEntry(lines, lineIndex);
    const detected = makeDetectedSection(match.definition, line, lineIndex, match.confidence, lines, tocHint, {
      source: "line",
      score: tocHint ? 0 : 60,
    });
    if (tocHint) {
      tocHints.push(detected);
    } else {
      bodyCandidates.push(detected);
    }
  });

  const sections: S1F1DetectedSection[] = [];
  const seen = new Set<string>();
  for (const candidate of bodyCandidates) {
    if (seen.has(candidate.key)) continue;
    sections.push(candidate);
    seen.add(candidate.key);
  }

  const warnings: string[] = [];
  const ambiguousKeys = new Set(
    bodyCandidates
      .filter((candidate, index, candidates) => candidates.some((other, otherIndex) => otherIndex !== index && other.key === candidate.key))
      .map((candidate) => candidate.key),
  );
  for (const key of ambiguousKeys) {
    warnings.push(`Multiple body heading candidates detected for ${key}; using the earliest non-TOC candidate.`);
  }
  for (const hint of tocHints) {
    if (!seen.has(hint.key)) {
      warnings.push(`Heading ${hint.title} appeared only in a likely table of contents block.`);
    }
  }

  return { sections, tocHints, warnings };
}

function detectS1F1Sections(text: string, blocks: S1F1DocumentBlock[] = []): S1F1SectionDetection {
  return detectS1F1SectionsFromBlocks(text, blocks) ?? detectS1F1SectionsFromLines(text);
}

function attachTablesToSections(
  sectionDetection: S1F1SectionDetection,
  tables: S1F1DocumentTable[] = [],
): S1F1SectionDetection {
  if (tables.length === 0) return sectionDetection;
  const sortedSections = [...sectionDetection.sections].sort(
    (a, b) => (a.blockOrder ?? a.lineIndex) - (b.blockOrder ?? b.lineIndex),
  );
  const sectionTables: S1F1SectionTable[] = tables.map((table) => {
    const section = [...sortedSections]
      .reverse()
      .find((candidate) => (candidate.blockOrder ?? candidate.lineIndex) <= table.order);
    return {
      tableId: table.id,
      sectionKey: section?.key ?? null,
      sectionTitle: section?.title ?? null,
      text: table.text,
    };
  });
  return { ...sectionDetection, tables: sectionTables };
}

function extractSectionLines(text: string, sectionDetection: S1F1SectionDetection, key: string): string[] {
  const lines = text.split("\n");
  const section = sectionDetection.sections.find((item) => item.key === key);
  if (!section) return [];
  const followingSections = sectionDetection.sections
    .filter((item) => item.lineIndex > section.lineIndex && item.key !== key)
    .sort((a, b) => a.lineIndex - b.lineIndex);
  const endLine = followingSections[0]?.lineIndex ?? lines.length;
  return lines.slice(section.lineIndex + 1, endLine);
}

function extractSectionBlocks(blocks: S1F1DocumentBlock[], sectionDetection: S1F1SectionDetection, key: string): S1F1DocumentBlock[] {
  const section = sectionDetection.sections.find((item) => item.key === key && item.blockOrder != null);
  if (!section || section.blockOrder == null) return [];
  const followingSections = sectionDetection.sections
    .filter((item) => item.blockOrder != null && item.blockOrder > section.blockOrder! && item.key !== key)
    .sort((a, b) => (a.blockOrder ?? 0) - (b.blockOrder ?? 0));
  const endOrder = followingSections[0]?.blockOrder ?? Number.MAX_SAFE_INTEGER;
  return blocks.filter((block) => block.order > section.blockOrder! && block.order < endOrder);
}

function isRiskCategoryHeading(text: string): boolean {
  return /^risks? (related|relating) to\b/i.test(text) || /^general risk factors$/i.test(text);
}

function isRiskFactorHeading(line: string): boolean {
  const text = compact(line);
  if (text.length < 12 || text.length > 320) return false;
  if (/^\d+$/.test(text) || text.includes(" | ")) return false;
  if (/^table of contents$/i.test(text)) return false;
  if (isRiskCategoryHeading(text)) return true;
  if (/\b(risk|risks|may|could|adverse|failure|depend|unable|uncertain|regulatory|competition|limited|history|losses)\b/i.test(text)) {
    return /[.;:]$/.test(text) || /^[A-Z]/.test(text);
  }
  return false;
}

function isRiskFactorBlockHeading(block: S1F1DocumentBlock, nextBlock?: S1F1DocumentBlock): boolean {
  const text = compact(block.text);
  if (block.insideTable || isPageNumberOrTocText(text) || text.includes(" | ")) return false;
  if (text.length < 12 || text.length > 360) return false;
  if (isRiskCategoryHeading(text)) return true;
  const hasRiskWords =
    /\b(risk|risks|may|could|adverse|failure|depend|unable|uncertain|regulatory|competition|limited|history|losses|materially harm|affect our business)\b/i.test(
      text,
    );
  if (!hasRiskWords) return false;
  if (block.isBold || block.isItalic || block.isCentered || block.isAllCaps) return true;
  if (/[.;]$/.test(text) && text.length <= 220 && block.isStandalone && nextBlock) {
    const nextText = compact(nextBlock.text);
    const nextLooksLikeBody = nextText.length >= Math.max(80, text.length + 20) && !matchSectionDefinition(nextText);
    return nextLooksLikeBody;
  }
  return false;
}

function detectRiskFactorsFromBlocks(
  blocks: S1F1DocumentBlock[],
  sectionDetection: S1F1SectionDetection,
): S1F1RiskFactorsStructure | null {
  const riskBlocks = extractSectionBlocks(blocks, sectionDetection, "risk_factors").filter((block) => compact(block.text));
  if (riskBlocks.length === 0) return null;

  const categoryHeadings: string[] = [];
  const riskFactorHeadings: string[] = [];
  const groups: Array<{ category: string | null; headings: string[] }> = [];
  let currentGroup: { category: string | null; headings: string[] } = { category: null, headings: [] };

  for (let index = 0; index < riskBlocks.length; index += 1) {
    const block = riskBlocks[index];
    const nextBlock = riskBlocks[index + 1];
    const heading = stripHeadingDecorations(block.text);
    if (isRiskCategoryHeading(heading)) {
      categoryHeadings.push(heading);
      if (currentGroup.category || currentGroup.headings.length) groups.push(currentGroup);
      currentGroup = { category: heading, headings: [] };
      continue;
    }
    if (!isRiskFactorBlockHeading(block, nextBlock)) continue;
    riskFactorHeadings.push(heading);
    currentGroup.headings.push(heading);
  }

  if (currentGroup.category || currentGroup.headings.length) groups.push(currentGroup);

  return {
    sectionDetected: true,
    categoryHeadings: [...new Set(categoryHeadings)].slice(0, 40),
    riskFactorHeadings: [...new Set(riskFactorHeadings)].slice(0, 100),
    groups: groups
      .map((group) => ({ category: group.category, headings: [...new Set(group.headings)].slice(0, 40) }))
      .filter((group) => group.category || group.headings.length),
    headingCount: new Set(riskFactorHeadings).size,
  };
}

function detectRiskFactorsStructure(
  text: string,
  sectionDetection: S1F1SectionDetection,
  blocks: S1F1DocumentBlock[] = [],
): S1F1RiskFactorsStructure {
  const blockResult = detectRiskFactorsFromBlocks(blocks, sectionDetection);
  if (blockResult) return blockResult;

  const lines = extractSectionLines(text, sectionDetection, "risk_factors").map(compact).filter(Boolean);
  if (lines.length === 0) {
    return {
      sectionDetected: false,
      categoryHeadings: [],
      riskFactorHeadings: [],
      groups: [],
      headingCount: 0,
    };
  }

  const categoryHeadings: string[] = [];
  const riskFactorHeadings: string[] = [];
  const groups: Array<{ category: string | null; headings: string[] }> = [];
  let currentGroup: { category: string | null; headings: string[] } = { category: null, headings: [] };
  for (const line of lines) {
    const heading = stripHeadingDecorations(line);
    if (isRiskCategoryHeading(heading)) {
      categoryHeadings.push(heading);
      if (currentGroup.category || currentGroup.headings.length) groups.push(currentGroup);
      currentGroup = { category: heading, headings: [] };
      continue;
    }
    if (isRiskFactorHeading(line)) {
      riskFactorHeadings.push(heading);
      currentGroup.headings.push(heading);
    }
  }
  if (currentGroup.category || currentGroup.headings.length) groups.push(currentGroup);

  return {
    sectionDetected: true,
    categoryHeadings: [...new Set(categoryHeadings)].slice(0, 40),
    riskFactorHeadings: [...new Set(riskFactorHeadings)].slice(0, 80),
    groups: groups
      .map((group) => ({ category: group.category, headings: [...new Set(group.headings)].slice(0, 40) }))
      .filter((group) => group.category || group.headings.length),
    headingCount: new Set(riskFactorHeadings).size,
  };
}

function detectForeignIssuerPhraseHits(text: string): S1F1ForeignIssuerPhraseHit[] {
  const hits: S1F1ForeignIssuerPhraseHit[] = [];
  for (const phrase of FOREIGN_ISSUER_PHRASES) {
    const evidence = evidenceFor(text, phrase.pattern, phrase.phrase);
    if (evidence) {
      hits.push({
        phrase: phrase.phrase,
        excerpt: evidence.excerpt,
      });
    }
  }
  return hits;
}

function clippedEvidence(value: string, maxLength = 360): string {
  const text = compact(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function isPlaceholderValue(value: string): boolean {
  return /\[[^\]]*\]|__+|●|—|–|N\/A/i.test(value);
}

function parseReadableNumber(value: string, unit: string | null = null): number | null {
  const text = compact(value);
  if (!text || isPlaceholderValue(text) || /^[-—–]$/.test(text)) return null;
  const negative = /\([^)]*\d[^)]*\)/.test(text);
  const numericText = text.replace(/[$,%()]/g, "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0];
  if (!numericText) return null;
  const parsed = Number(numericText);
  if (!Number.isFinite(parsed)) return null;
  const normalizedUnit = unit?.toLowerCase() ?? text.toLowerCase();
  const multiplier = /\bbillion\b/.test(normalizedUnit)
    ? 1_000_000_000
    : /\bmillion\b/.test(normalizedUnit)
      ? 1_000_000
      : /\bthousand\b/.test(normalizedUnit)
        ? 1_000
        : 1;
  return (negative ? -parsed : parsed) * multiplier;
}

function candidate(
  label: string,
  value: string,
  evidence: string,
  confidence: ConfidenceLevel = "medium",
  options: {
    unit?: string | null;
    normalizedValue?: number | null;
    isPlaceholder?: boolean;
    isAssumed?: boolean;
  } = {},
): S1F1ExtractionCandidate {
  return {
    label,
    value: compact(value),
    evidence: clippedEvidence(evidence),
    confidence,
    ...(options.unit !== undefined ? { unit: options.unit } : {}),
    ...(options.normalizedValue !== undefined ? { normalizedValue: options.normalizedValue } : {}),
    ...(options.isPlaceholder ? { isPlaceholder: true } : {}),
    ...(options.isAssumed ? { isAssumed: true } : {}),
  };
}

function globalPattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
}

function findCandidateMatches(
  text: string,
  label: string,
  patterns: RegExp[],
  options: { limit?: number; confidence?: ConfidenceLevel; assumed?: boolean } = {},
): S1F1ExtractionCandidate[] {
  const candidates: S1F1ExtractionCandidate[] = [];
  const seen = new Set<string>();
  const limit = options.limit ?? 8;
  for (const pattern of patterns) {
    for (const match of text.matchAll(globalPattern(pattern))) {
      const value = match[1] ?? match[0];
      const key = `${label}:${compact(value)}:${compact(match[0])}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(
        candidate(label, value, match[0], options.confidence ?? "medium", {
          normalizedValue: parseReadableNumber(value, match[2] ?? null),
          unit: match[2] ?? null,
          isPlaceholder: isPlaceholderValue(value),
          isAssumed: options.assumed || /\bassumed\b|\bestimated\b/i.test(match[0]),
        }),
      );
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

function findOutstandingShareRowCandidates(text: string, limit = 6): S1F1ExtractionCandidate[] {
  const patterns = [
    /((?:Class\s+[A-Z]\s+)?(?:common stock|ordinary shares|ADSs?)[^.\n]{0,220}?(?:outstanding|issued and outstanding)[^.\n]{0,220}?(?:prior to|before|immediately prior to|as of|commencement|execution|purchase agreement)[^.\n]{0,260}?([0-9][0-9,]*)\s+(shares|ordinary shares|ADSs?))/i,
    /((?:outstanding|issued and outstanding)[^.\n]{0,220}?(?:prior to|before|immediately prior to|as of|commencement|execution|purchase agreement)[^.\n]{0,260}?([0-9][0-9,]*)\s+(shares|ordinary shares|ADSs?))/i,
    /((?:number of shares|shares outstanding|common stock outstanding)[^.\n]{0,260}?([0-9][0-9,]*)\s+(shares|ordinary shares|ADSs?))/i,
  ];
  const candidates: S1F1ExtractionCandidate[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(globalPattern(pattern))) {
      const value = `${match[2]} ${match[3]}`;
      const key = compact(value);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(
        candidate("shares_outstanding", value, match[1] ?? match[0], "high", {
          normalizedValue: parseReadableNumber(match[2] ?? ""),
          unit: match[3] ?? null,
        }),
      );
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

function findPhraseCandidates(
  text: string,
  labels: Array<{ label: string; pattern: RegExp; confidence?: ConfidenceLevel }>,
  limitPerLabel = 3,
): S1F1ExtractionCandidate[] {
  return labels.flatMap((item) =>
    findCandidateMatches(text, item.label, [item.pattern], {
      limit: limitPerLabel,
      confidence: item.confidence ?? "medium",
    }),
  );
}

function sectionExists(sectionDetection: S1F1SectionDetection, key: string): boolean {
  return sectionDetection.sections.some((section) => section.key === key);
}

function sectionText(text: string, sectionDetection: S1F1SectionDetection, key: string): string {
  return extractSectionLines(text, sectionDetection, key).join("\n");
}

function combinedSectionText(text: string, sectionDetection: S1F1SectionDetection, keys: string[]): string {
  return keys.map((key) => sectionText(text, sectionDetection, key)).filter(Boolean).join("\n\n");
}

function sectionTables(
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
  keys: string[],
): S1F1DocumentTable[] {
  const tableIds = new Set(
    (sectionDetection.tables ?? [])
      .filter((table) => table.sectionKey && keys.includes(table.sectionKey))
      .map((table) => table.tableId),
  );
  return documentTables.filter((table) => tableIds.has(table.id));
}

function extractedRowsForTables(
  tables: S1F1DocumentTable[],
  sectionKey: string | null,
): S1F1ExtractedTableRow[] {
  return tables.flatMap((table) =>
    table.rows.map((row) => ({
      tableId: table.id,
      sectionKey,
      label: row[0] ?? "",
      cells: row,
      text: row.join(" | "),
    })),
  );
}

function candidateFromTableRow(label: string, row: S1F1ExtractedTableRow): S1F1ExtractionCandidate {
  return candidate(label, row.text, row.text, "medium", {
    normalizedValue: parseReadableNumber(row.text),
    isPlaceholder: isPlaceholderValue(row.text),
  });
}

function firstDistinctNormalized(candidates: S1F1ExtractionCandidate[]): number[] {
  return [...new Set(candidates.map((item) => item.normalizedValue).filter((value): value is number => typeof value === "number"))];
}

function extractOfferingTermsExtraction(
  text: string,
  input: S1F1ParserInput,
  sectionDetection: S1F1SectionDetection,
): S1F1SectionExtractions["offeringTerms"] {
  const offeringText = [
    text.slice(0, 80_000),
    combinedSectionText(text, sectionDetection, ["prospectus_summary", "the_offering", "underwriting", "plan_of_distribution"]),
  ]
    .filter(Boolean)
    .join("\n\n");
  const securities = new Set(extractSecurities(offeringText));
  if (/pre-funded warrants?/i.test(offeringText)) securities.add("pre-funded warrants");
  if (/\brights\b|subscription rights/i.test(offeringText)) securities.add("rights");

  const primaryOfferingLanguage = findCandidateMatches(offeringText, "primary_offering_language", [
    /\b(we are offering[^.\n]{0,220})/i,
    /\b(the company is offering[^.\n]{0,220})/i,
    /\b(issuer is offering[^.\n]{0,220})/i,
  ]);
  const resaleOfferingLanguage = findCandidateMatches(offeringText, "resale_offering_language", [
    /\b(resale by the selling (?:stockholders|shareholders|securityholders)[^.\n]{0,220})/i,
    /\b(selling (?:stockholders|shareholders|securityholders)[^.\n]{0,220})/i,
    /\b(register(?:ing)?[^.\n]{0,160}?for resale[^.\n]{0,160})/i,
  ]);

  const assumedOfferingPriceCandidates = findCandidateMatches(
    offeringText,
    "assumed_offering_price",
    [
      /\b(assumed[^.\n]{0,120}?\$[0-9][0-9,.]*(?:\s*(?:million|billion))?\s+per\s+(?:share|ordinary share|ADS|unit))/i,
      /\b(estimated[^.\n]{0,120}?\$[0-9][0-9,.]*(?:\s*(?:million|billion))?\s+per\s+(?:share|ordinary share|ADS|unit))/i,
      /(\$\[[^\]]+\]\s+per\s+(?:share|ordinary share|ADS|unit))/i,
    ],
    { assumed: true },
  );

  const priceRangeCandidates = findCandidateMatches(offeringText, "price_range", [
    /(\$[0-9][0-9,.]*\s*(?:and|to|-)\s*\$[0-9][0-9,.]*\s+per\s+(?:share|ordinary share|ADS|unit))/i,
    /(price range[^.\n]{0,100}?\$[0-9][0-9,.]*\s*(?:and|to|-)\s*\$[0-9][0-9,.]*)/i,
  ]);

  const offeringTypes = [
    primaryOfferingLanguage.length ? "primary" : null,
    resaleOfferingLanguage.length ? "resale" : null,
  ].filter((item): item is string => Boolean(item));
  if (offeringTypes.length === 0 && /initial public offering|proposed public offering/i.test(offeringText)) offeringTypes.push("ipo");

  const warnings: string[] = [];
  if (primaryOfferingLanguage.length && resaleOfferingLanguage.length) {
    warnings.push("Mixed primary and resale offering language detected; preserve components separately.");
  }
  if (/(pre-funded warrants?|warrants?|units?|rights)/i.test(offeringText)) {
    warnings.push("Offering includes units, warrants, pre-funded warrants, or rights; simple share extraction may be incomplete.");
  }

  const adsRatioCandidates = findCandidateMatches(offeringText, "ads_ratio", [
    /\b(each (?:ADS|American Depositary Share)[^.\n]{0,120}?represents?[^.\n]{0,120}?(?:ordinary shares?|Class [A-Z] ordinary shares?))/i,
    /\b((?:one|two|three|four|five|\d+)\s+(?:ADSs?|American Depositary Shares?)\s+represent[^.\n]{0,120}?(?:ordinary shares?))/i,
  ]);
  if ((securities.has("ADS") || /American Depositary Shares|\bADSs?\b/i.test(offeringText)) && adsRatioCandidates.length === 0) {
    warnings.push("ADS language detected without an explicit ADS-to-share ratio candidate.");
  }
  if (assumedOfferingPriceCandidates.length) {
    warnings.push("Assumed, estimated, or bracketed offering price candidates were preserved but not treated as final prices.");
  }

  return {
    formType: normalizeFormType(input.formType),
    offeringTypes,
    securities: [...securities],
    primaryOfferingLanguage,
    resaleOfferingLanguage,
    shareCountCandidates: findCandidateMatches(offeringText, "shares_offered", [
      /((?:up to\s+)?[0-9][0-9,]*\s+(?:shares|ordinary shares|American Depositary Shares|ADSs?|units|warrants|pre-funded warrants))/i,
    ]),
    adsRatioCandidates,
    assumedOfferingPriceCandidates,
    priceRangeCandidates,
    proposedMaximumAggregateOfferingCandidates: findCandidateMatches(offeringText, "proposed_maximum_aggregate_offering", [
      /(proposed maximum aggregate offering (?:price|amount)[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
    ]),
    estimatedGrossProceedsCandidates: findCandidateMatches(offeringText, "estimated_gross_proceeds", [
      /(estimated gross proceeds[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
      /(gross proceeds[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
    ]),
    estimatedNetProceedsCandidates: findCandidateMatches(offeringText, "estimated_net_proceeds", [
      /(estimated net proceeds[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
      /(net proceeds[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
    ]),
    underwritingDiscountCandidates: findCandidateMatches(offeringText, "underwriting_discount_or_commission", [
      /(underwriting (?:discount|commission)[^.\n]{0,120}?(?:[0-9.]+%|\$[0-9][0-9,.]*))/i,
      /((?:discounts?|commissions?)[^.\n]{0,120}?(?:[0-9.]+%|\$[0-9][0-9,.]*))/i,
    ]),
    overAllotmentCandidates: findCandidateMatches(offeringText, "over_allotment_option", [
      /(over-allotment option[^.\n]{0,220})/i,
      /(option to purchase[^.\n]{0,180}?additional[^.\n]{0,120})/i,
    ]),
    distributionMethodLanguage: findPhraseCandidates(offeringText, [
      { label: "firm_commitment", pattern: /(firm commitment[^.\n]{0,160})/i },
      { label: "best_efforts", pattern: /(best efforts[^.\n]{0,160})/i },
      { label: "minimum_offering", pattern: /(minimum offering[^.\n]{0,160})/i },
      { label: "maximum_offering", pattern: /(maximum offering[^.\n]{0,160})/i },
    ]),
    tickerCandidates: [
      ...(input.metadata?.ticker ? [candidate("ticker", input.metadata.ticker, input.metadata.ticker, "high")] : []),
      ...findCandidateMatches(offeringText, "ticker", [
        /(?:ticker symbol|trading symbol|under the symbol|under the ticker symbol)\s*(?:is|will be|:)?\s*[^A-Z0-9]{0,8}([A-Z][A-Z0-9.-]{0,9})/i,
      ]),
    ],
    exchangeCandidates: [
      ...(input.metadata?.exchange ? [candidate("exchange", input.metadata.exchange, input.metadata.exchange, "high")] : []),
      ...findPhraseCandidates(offeringText, [
        { label: "exchange", pattern: /(Nasdaq Global Select Market|Nasdaq Global Market|Nasdaq Capital Market|New York Stock Exchange|NYSE American|\bNYSE\b)/i },
      ]),
    ],
    noPublicMarketLanguage: findCandidateMatches(offeringText, "no_public_market", [
      /(no public market currently exists[^.\n]{0,180})/i,
      /(there has been no public market[^.\n]{0,180})/i,
    ]),
    sellingStockholderLanguage: findCandidateMatches(offeringText, "selling_stockholder_language", [
      /(selling (?:stockholders|shareholders|securityholders)[^.\n]{0,220})/i,
    ]),
    warnings,
  };
}

function extractUseOfProceedsExtraction(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1SectionExtractions["useOfProceeds"] {
  const detected = sectionExists(sectionDetection, "use_of_proceeds");
  const body = sectionText(text, sectionDetection, "use_of_proceeds");
  const tables = sectionTables(sectionDetection, documentTables, ["use_of_proceeds"]);
  const tableRows = extractedRowsForTables(tables, "use_of_proceeds");
  const combined = [body, ...tableRows.map((row) => row.text)].join("\n");
  const warnings: string[] = [];
  if (!detected) warnings.push("Use of Proceeds body section was not detected.");

  const grossProceedsCandidates = findCandidateMatches(combined, "gross_proceeds", [
    /(gross proceeds[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
  ]);
  const tableTotalCandidates = tableRows
    .filter((row) => /total/i.test(row.label))
    .map((row) => candidateFromTableRow("table_total", row));
  const textGross = firstDistinctNormalized(grossProceedsCandidates);
  const tableGross = firstDistinctNormalized(tableTotalCandidates);
  if (textGross.length && tableGross.length && textGross[0] !== tableGross[0]) {
    warnings.push("Use of Proceeds text and table total candidates conflict; preserve both instead of choosing one.");
  }

  return {
    sectionDetected: detected,
    grossProceedsCandidates,
    netProceedsCandidates: findCandidateMatches(combined, "net_proceeds", [
      /(net proceeds[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
    ]),
    offeringExpenseCandidates: findCandidateMatches(combined, "offering_expenses", [
      /(offering expenses[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
      /(estimated expenses[^.\n]{0,120}?\$[0-9][0-9,.]*\s*(million|billion)?)/i,
    ]),
    useCategories: findPhraseCandidates(combined, [
      { label: "working_capital", pattern: /(working capital)/i },
      { label: "general_corporate_purposes", pattern: /(general corporate purposes)/i },
      { label: "research_and_development", pattern: /(research and development|R&D)/i },
      { label: "sales_and_marketing", pattern: /(sales and marketing)/i },
      { label: "capital_expenditures", pattern: /(capital expenditures?)/i },
      { label: "acquisitions", pattern: /(acquisitions?)/i },
      { label: "debt_repayment", pattern: /(repay(?:ment)?[^.\n]{0,120}?(?:debt|loan|notes?|convertible notes?|bridge financing))/i },
      { label: "related_party_repayment", pattern: /(repay(?:ment)?[^.\n]{0,160}?(?:officers?|directors?|founders?|shareholders?|affiliates?|related parties))/i },
    ]),
    noIssuerProceedsLanguage: findCandidateMatches(combined, "no_issuer_proceeds", [
      /(we will not receive (?:any )?proceeds[^.\n]{0,180})/i,
      /(we will receive no proceeds[^.\n]{0,180})/i,
    ]),
    sellingHolderProceedsLanguage: findCandidateMatches(combined, "selling_holder_proceeds", [
      /(selling (?:stockholders|shareholders|securityholders)[^.\n]{0,180}?receive[^.\n]{0,120}?proceeds)/i,
    ]),
    placeholderCandidates: findCandidateMatches(combined, "placeholder_value", [
      /(\$?\[[^\]]+\])/i,
      /(__+)/i,
    ]),
    tableRows,
    warnings,
  };
}

function extractCapitalizationExtraction(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1SectionExtractions["capitalization"] {
  const detected = sectionExists(sectionDetection, "capitalization");
  const body = sectionText(text, sectionDetection, "capitalization");
  const tables = sectionTables(sectionDetection, documentTables, ["capitalization", "summary_financial_data"]);
  const tableRows = extractedRowsForTables(tables, "capitalization");
  const combined = [body, ...tableRows.map((row) => row.text)].join("\n");
  const warnings: string[] = [];
  if (!detected) warnings.push("Capitalization body section was not detected.");
  const columnLabels = [
    ...new Set(tables.flatMap((table) => table.headerRows[0] ?? []).map(compact).filter(Boolean)),
  ];
  if (tables.length && columnLabels.length === 0) warnings.push("Capitalization table columns could not be confidently aligned.");

  const rowPatterns = [
    /cash and cash equivalents/i,
    /short-term debt|long-term debt|\bdebt\b/i,
    /notes payable|convertible notes?/i,
    /preferred stock/i,
    /common stock|ordinary shares/i,
    /additional paid-in capital/i,
    /accumulated deficit/i,
    /total stockholders'? (?:equity|deficit)/i,
    /total capitalization/i,
  ];

  return {
    sectionDetected: detected,
    unitLabels: [...new Set((combined.match(/\bin (?:thousands|millions|billions)\b/gi) ?? []).map((item) => item.toLowerCase()))],
    columnLabels,
    tableRows,
    rowCandidates: tableRows
      .filter((row) => rowPatterns.some((pattern) => pattern.test(row.text)))
      .map((row) => candidateFromTableRow("capitalization_row", row)),
    shareCountCandidates: [
      ...findOutstandingShareRowCandidates(combined),
      ...findCandidateMatches(combined, "shares_outstanding", [
        /([0-9][0-9,]*\s+(?:shares|ordinary shares|common shares)[^.\n]{0,120}?(?:outstanding|after this offering|before this offering))/i,
      ]),
    ],
    conversionLanguage: findPhraseCandidates(combined, [
      { label: "preferred_stock_conversion", pattern: /(conversion of[^.\n]{0,120}?preferred stock[^.\n]{0,120})/i },
      { label: "convertible_note_conversion", pattern: /(conversion of[^.\n]{0,120}?convertible notes?[^.\n]{0,120})/i },
    ]),
    shareSplitLanguage: findCandidateMatches(combined, "share_split_language", [
      /(reverse (?:stock |share )?split[^.\n]{0,160})/i,
      /(share split[^.\n]{0,160})/i,
    ]),
    adsPresentationLanguage: findCandidateMatches(combined, "ads_share_presentation", [
      /(ADSs?[^.\n]{0,160}?ordinary shares?[^.\n]{0,160})/i,
      /(ordinary shares?[^.\n]{0,160}?ADSs?[^.\n]{0,160})/i,
    ]),
    warnings,
  };
}

function extractDilutionExtraction(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1SectionExtractions["dilution"] {
  const detected = sectionExists(sectionDetection, "dilution");
  const body = sectionText(text, sectionDetection, "dilution");
  const tables = sectionTables(sectionDetection, documentTables, ["dilution"]);
  const tableRows = extractedRowsForTables(tables, "dilution");
  const combined = [body, ...tableRows.map((row) => row.text)].join("\n");
  const warnings: string[] = [];
  if (!detected) warnings.push("Dilution body section was not detected.");

  return {
    sectionDetected: detected,
    offeringPriceCandidates: findCandidateMatches(combined, "offering_price", [
      /(initial public offering price[^.\n]{0,120}?\$[0-9][0-9,.]*\s+per\s+(?:share|ADS))/i,
    ]),
    assumedOfferingPriceCandidates: findCandidateMatches(
      combined,
      "assumed_offering_price",
      [
        /(assumed[^.\n]{0,120}?\$[0-9][0-9,.]*\s+per\s+(?:share|ADS))/i,
        /(\$\[[^\]]+\]\s+per\s+(?:share|ADS))/i,
      ],
      { assumed: true },
    ),
    netTangibleBookValueCandidates: findCandidateMatches(combined, "net_tangible_book_value", [
      /((?:historical |pro forma |pro forma as adjusted )?net tangible book value[^.\n]{0,160}?(?:\$[0-9][0-9,.]*|\(\$[0-9][0-9,.]*\)|\[[^\]]+\]))/i,
    ]),
    increaseAttributableCandidates: findCandidateMatches(combined, "increase_attributable_to_new_investors", [
      /(increase[^.\n]{0,120}?attributable to new investors[^.\n]{0,120}?(?:\$[0-9][0-9,.]*|\(\$[0-9][0-9,.]*\)|\[[^\]]+\]))/i,
    ]),
    dilutionPerShareCandidates: findCandidateMatches(combined, "dilution_per_share", [
      /(dilution (?:per share|per ADS)[^.\n]{0,120}?(?:\$[0-9][0-9,.]*|\(\$[0-9][0-9,.]*\)|\[[^\]]+\]))/i,
    ]),
    dilutionPercentageCandidates: findCandidateMatches(combined, "dilution_percentage", [
      /(dilution[^.\n]{0,120}?[0-9.]+%)/i,
    ]),
    ownershipPercentageCandidates: findCandidateMatches(combined, "ownership_percentage", [
      /((?:existing stockholders|new investors)[^.\n]{0,120}?[0-9.]+%)/i,
    ]),
    shareCountCandidates: [
      ...findOutstandingShareRowCandidates(combined),
      ...findCandidateMatches(combined, "shares_outstanding", [
        /([0-9][0-9,]*\s+(?:shares|ordinary shares|ADSs?)[^.\n]{0,120}?(?:outstanding|after this offering|before this offering))/i,
      ]),
    ],
    adsRatioCandidates: findCandidateMatches(combined, "ads_ratio", [
      /\b(each (?:ADS|American Depositary Share)[^.\n]{0,120}?represents?[^.\n]{0,120}?(?:ordinary shares?))/i,
    ]),
    placeholderCandidates: findCandidateMatches(combined, "placeholder_value", [
      /(\$?\[[^\]]+\])/i,
      /(__+)/i,
    ]),
    tableRows,
    warnings,
  };
}

function extractSectionExtractions(
  text: string,
  input: S1F1ParserInput,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1SectionExtractions {
  return {
    offeringTerms: extractOfferingTermsExtraction(text, input, sectionDetection),
    useOfProceeds: extractUseOfProceedsExtraction(text, sectionDetection, documentTables),
    capitalization: extractCapitalizationExtraction(text, sectionDetection, documentTables),
    dilution: extractDilutionExtraction(text, sectionDetection, documentTables),
  };
}

const FINANCIAL_LINE_PATTERNS: Array<{ label: string; pattern: RegExp; statementTypes: string[] }> = [
  { label: "cash_and_cash_equivalents", pattern: /cash and cash equivalents/i, statementTypes: ["balance_sheet", "cash_flows", "mda_text"] },
  { label: "accounts_receivable", pattern: /accounts receivable/i, statementTypes: ["balance_sheet"] },
  { label: "inventory", pattern: /^inventor(?:y|ies)$/i, statementTypes: ["balance_sheet"] },
  { label: "total_current_assets", pattern: /total current assets/i, statementTypes: ["balance_sheet"] },
  { label: "total_assets", pattern: /^total assets/i, statementTypes: ["balance_sheet"] },
  { label: "accounts_payable", pattern: /accounts payable/i, statementTypes: ["balance_sheet"] },
  { label: "accrued_expenses", pattern: /accrued expenses/i, statementTypes: ["balance_sheet"] },
  { label: "deferred_revenue", pattern: /deferred revenue/i, statementTypes: ["balance_sheet"] },
  { label: "short_term_debt", pattern: /short-term debt|current portion of debt/i, statementTypes: ["balance_sheet"] },
  { label: "notes_payable", pattern: /notes payable/i, statementTypes: ["balance_sheet"] },
  { label: "convertible_notes", pattern: /convertible notes?/i, statementTypes: ["balance_sheet"] },
  { label: "long_term_debt", pattern: /long-term debt/i, statementTypes: ["balance_sheet"] },
  { label: "total_current_liabilities", pattern: /total current liabilities/i, statementTypes: ["balance_sheet"] },
  { label: "total_liabilities", pattern: /^total liabilities$/i, statementTypes: ["balance_sheet"] },
  { label: "preferred_stock", pattern: /preferred stock/i, statementTypes: ["balance_sheet"] },
  { label: "common_or_ordinary_stock", pattern: /common stock|ordinary shares/i, statementTypes: ["balance_sheet"] },
  { label: "additional_paid_in_capital", pattern: /additional paid-in capital/i, statementTypes: ["balance_sheet"] },
  { label: "accumulated_deficit", pattern: /accumulated deficit/i, statementTypes: ["balance_sheet", "mda_text"] },
  { label: "stockholders_equity", pattern: /total stockholders'? equity|total shareholders'? equity/i, statementTypes: ["balance_sheet"] },
  { label: "stockholders_deficit", pattern: /total stockholders'? deficit|total shareholders'? deficit/i, statementTypes: ["balance_sheet"] },
  { label: "liabilities_and_equity", pattern: /total liabilities and (?:stockholders'|shareholders') equity/i, statementTypes: ["balance_sheet"] },
  { label: "revenue", pattern: /^revenues?\b/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "net_revenue", pattern: /net revenue/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "cost_of_revenue", pattern: /cost of revenue|cost of goods sold/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "gross_profit", pattern: /gross profit/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "gross_loss", pattern: /gross loss/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "operating_expenses", pattern: /operating expenses/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "research_and_development", pattern: /research and development/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "sales_and_marketing", pattern: /sales and marketing/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "general_and_administrative", pattern: /general and administrative/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "operating_income", pattern: /operating income/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "operating_loss", pattern: /operating loss/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "interest_expense", pattern: /interest expense/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "income_tax_expense", pattern: /income tax expense/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "net_income", pattern: /^net income/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "net_loss", pattern: /^net loss/i, statementTypes: ["statements_of_operations", "mda_text"] },
  { label: "net_loss_per_share", pattern: /net loss per share/i, statementTypes: ["statements_of_operations"] },
  { label: "weighted_average_shares", pattern: /weighted average shares/i, statementTypes: ["statements_of_operations"] },
  { label: "operating_cash_flow", pattern: /net cash (?:used in|provided by) operating activities/i, statementTypes: ["cash_flows", "mda_text"] },
  { label: "investing_cash_flow", pattern: /net cash (?:used in|provided by) investing activities/i, statementTypes: ["cash_flows", "mda_text"] },
  { label: "financing_cash_flow", pattern: /net cash (?:used in|provided by) financing activities/i, statementTypes: ["cash_flows", "mda_text"] },
  { label: "capital_expenditures", pattern: /capital expenditures/i, statementTypes: ["cash_flows", "mda_text"] },
  { label: "debt_issuance_proceeds", pattern: /proceeds from issuance of debt/i, statementTypes: ["cash_flows"] },
  { label: "common_stock_issuance_proceeds", pattern: /proceeds from issuance of common stock/i, statementTypes: ["cash_flows"] },
  { label: "preferred_stock_issuance_proceeds", pattern: /proceeds from issuance of preferred stock/i, statementTypes: ["cash_flows"] },
  { label: "debt_repayment", pattern: /repayment of debt/i, statementTypes: ["cash_flows"] },
  { label: "cash_beginning_period", pattern: /cash.*beginning of (?:period|year)/i, statementTypes: ["cash_flows"] },
  { label: "cash_end_period", pattern: /cash.*end of (?:period|year)/i, statementTypes: ["cash_flows"] },
];

const LIQUIDITY_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "substantial_doubt", pattern: /substantial doubt[^.\n]{0,180}/i },
  { label: "going_concern", pattern: /(?:continue as a going concern|ability to continue as a going concern|going concern)[^.\n]{0,180}/i },
  { label: "recurring_losses", pattern: /recurring losses[^.\n]{0,180}/i },
  { label: "history_of_losses", pattern: /history of losses[^.\n]{0,180}/i },
  { label: "negative_cash_flows", pattern: /negative cash flows[^.\n]{0,180}/i },
  { label: "working_capital_deficit", pattern: /working capital deficit[^.\n]{0,180}/i },
  { label: "accumulated_deficit", pattern: /accumulated deficit[^.\n]{0,180}/i },
  { label: "additional_capital", pattern: /(?:need|require|raise) additional (?:capital|financing|funds)[^.\n]{0,180}/i },
  { label: "insufficient_liquidity", pattern: /(?:may not have sufficient liquidity|insufficient cash|insufficient liquidity)[^.\n]{0,180}/i },
  { label: "management_plans", pattern: /management'?s plans?[^.\n]{0,180}/i },
  { label: "debt_financing", pattern: /debt financing[^.\n]{0,180}/i },
  { label: "equity_financing", pattern: /equity financing[^.\n]{0,180}/i },
  { label: "bridge_financing", pattern: /bridge financing[^.\n]{0,180}/i },
  { label: "convertible_notes", pattern: /convertible notes?[^.\n]{0,180}/i },
  { label: "default", pattern: /\bdefault\b[^.\n]{0,180}/i },
  { label: "covenant_breach", pattern: /(?:covenant (?:breach|violation|default)|default under a covenant)[^.\n]{0,180}/i },
  { label: "forbearance", pattern: /forbearance[^.\n]{0,180}/i },
  { label: "waiver", pattern: /waiver[^.\n]{0,180}/i },
  { label: "material_adverse_liquidity", pattern: /material adverse effect on liquidity[^.\n]{0,180}/i },
];

const NOTE_TOPIC_PATTERNS: Array<{ topic: string; pattern: RegExp }> = [
  { topic: "revenue_recognition", pattern: /revenue recognition/i },
  { topic: "related_party_transactions", pattern: /related party transactions?/i },
  { topic: "debt", pattern: /\bdebt\b|notes payable/i },
  { topic: "convertible_notes", pattern: /convertible notes?/i },
  { topic: "warrants", pattern: /warrants?/i },
  { topic: "preferred_stock", pattern: /preferred stock/i },
  { topic: "stock_based_compensation", pattern: /stock-based compensation|share-based compensation/i },
  { topic: "leases", pattern: /\bleases?\b/i },
  { topic: "commitments_and_contingencies", pattern: /commitments and contingencies/i },
  { topic: "legal_proceedings", pattern: /legal proceedings/i },
  { topic: "income_taxes", pattern: /income taxes/i },
  { topic: "subsequent_events", pattern: /subsequent events/i },
  { topic: "concentration", pattern: /concentration of credit risk|customer concentration|supplier concentration/i },
  { topic: "segment_information", pattern: /segment information/i },
  { topic: "fair_value_measurements", pattern: /fair value measurements/i },
  { topic: "material_weakness", pattern: /material weakness/i },
  { topic: "restatement", pattern: /restatement/i },
  { topic: "going_concern", pattern: /going concern/i },
];

function classifyFinancialStatementTable(table: S1F1DocumentTable): S1F1FinancialStatementTableInventoryItem["classification"] | null {
  const context = `${table.caption ?? ""}\n${table.text}`.slice(0, 2_500);
  if (/use of proceeds|selling stockholders|capitalization|dilution/i.test(context) && !/balance sheets?|statements? of operations|cash flows/i.test(context)) return null;
  if (/consolidated balance sheets?|balance sheets?/i.test(context)) return "balance_sheet";
  if (/statements? of operations/i.test(context)) return "statements_of_operations";
  if (/statements? of comprehensive (?:loss|income)/i.test(context)) return "statements_of_comprehensive_income_loss";
  if (/statements? of (?:stockholders|shareholders).*equity|statements? of changes in equity/i.test(context)) return "stockholders_equity";
  if (/statements? of cash flows?/i.test(context)) return "cash_flows";
  if (/notes to (?:consolidated )?financial statements/i.test(context)) return "notes";
  if (/summary financial data|summary consolidated financial data/i.test(context)) return "summary_financial_data";
  if (/selected financial data/i.test(context)) return "selected_financial_data";
  if (/financial statements/i.test(context) && /assets|revenue|net loss|cash flows/i.test(context)) return "other_financial_statement";
  return null;
}

function detectTableTitle(table: S1F1DocumentTable): string | null {
  const candidates = [table.caption, table.rows[0]?.join(" "), table.rows[1]?.join(" ")].map((value) => compact(value ?? "")).filter(Boolean);
  return candidates.find((value) => /balance sheets?|statements?|financial data|notes to/i.test(value)) ?? table.caption;
}

function detectPeriodColumns(table: S1F1DocumentTable): string[] {
  const headerText = table.headerRows.flat().join(" | ") || table.rows.slice(0, 3).flat().join(" | ");
  return [...new Set([
    ...[...headerText.matchAll(/(?:three|six|nine|twelve)\s+months ended[^|,\n]*/gi)].map((match) => compact(match[0])),
    ...[...headerText.matchAll(/year ended[^|,\n]*/gi)].map((match) => compact(match[0])),
    ...[...headerText.matchAll(/fiscal year ended[^|,\n]*/gi)].map((match) => compact(match[0])),
    ...[...headerText.matchAll(/\b(?:20\d{2}|19\d{2})\b/g)].map((match) => compact(match[0])),
  ])];
}

function detectAuditedStatus(text: string): "audited" | "unaudited" | "mixed" | "unclear" {
  const audited = /\baudited\b/i.test(text);
  const unaudited = /\bunaudited\b/i.test(text);
  if (audited && unaudited) return "mixed";
  if (unaudited) return "unaudited";
  if (audited) return "audited";
  return "unclear";
}

function detectCurrency(text: string): string | null {
  if (/\bU\.?S\.? dollars|\bUSD\b|\$/i.test(text)) return "USD";
  return text.match(/\b(RMB|Renminbi|HKD|EUR|GBP|CAD|AUD)\b/i)?.[1] ?? null;
}

function detectUnitLabel(text: string): string | null {
  return text.match(/\bin (?:thousands|millions|billions)\b/i)?.[0].toLowerCase() ?? null;
}

function extractFinancialStatementTables(sectionDetection: S1F1SectionDetection, documentTables: S1F1DocumentTable[]): S1F1FinancialStatementTableInventoryItem[] {
  return documentTables.map((table) => {
    const classification = classifyFinancialStatementTable(table);
    if (!classification) return null;
    const sectionTable = (sectionDetection.tables ?? []).find((item) => item.tableId === table.id);
    const text = `${table.caption ?? ""}\n${table.text}`;
    const periodColumns = detectPeriodColumns(table);
    const warnings: string[] = [];
    if (periodColumns.length === 0) warnings.push("Financial statement table period columns could not be confidently aligned.");
    return {
      tableId: table.id,
      classification,
      title: detectTableTitle(table),
      sectionKey: sectionTable?.sectionKey ?? null,
      periodColumns,
      auditedStatus: detectAuditedStatus(text),
      currency: detectCurrency(text),
      unit: detectUnitLabel(text),
      rows: extractedRowsForTables([table], sectionTable?.sectionKey ?? null),
      warnings,
    };
  }).filter((item): item is S1F1FinancialStatementTableInventoryItem => Boolean(item));
}

function rowMatchesFinancialLine(rowLabel: string, statementType: string): string | null {
  return FINANCIAL_LINE_PATTERNS.find((item) => item.pattern.test(rowLabel) && item.statementTypes.includes(statementType))?.label ?? null;
}

function extractFinancialLineItemsFromTables(tables: S1F1FinancialStatementTableInventoryItem[]): S1F1FinancialLineItem[] {
  return tables.flatMap((table) => table.rows.flatMap((row) => {
    const label = rowMatchesFinancialLine(row.label, table.classification);
    if (!label) return [];
    return [{
      statementType: table.classification,
      tableId: table.tableId,
      label,
      rowLabel: row.label,
      columns: table.periodColumns.length ? table.periodColumns : table.rows[0]?.cells.slice(1) ?? [],
      values: row.cells.slice(1),
      evidence: row.text,
      source: "financial_statement_table" as const,
      confidence: table.periodColumns.length ? "medium" : "low" as ConfidenceLevel,
    }];
  }));
}

function extractMdaText(text: string, sectionDetection: S1F1SectionDetection): { sectionKey: string | null; text: string } {
  const key = sectionExists(sectionDetection, "mda")
    ? "mda"
    : sectionExists(sectionDetection, "operating_and_financial_review")
      ? "operating_and_financial_review"
      : null;
  const primaryText = key ? sectionText(text, sectionDetection, key) : "";
  const subsectionText = combinedSectionText(text, sectionDetection, [
    "results_of_operations",
    "liquidity_capital_resources",
    "cash_flows",
    "critical_accounting",
    "market_risk",
    "contractual_obligations",
    "research_development",
    "trend_information",
  ]);
  return { sectionKey: key, text: [primaryText, subsectionText].filter(Boolean).join("\n\n") };
}

function extractMdaLineItems(mdaText: string): S1F1FinancialLineItem[] {
  const lineItems: S1F1FinancialLineItem[] = [];
  for (const sentence of mdaText.split(/\n|(?<=\.)\s+/).map(compact).filter(Boolean)) {
    for (const item of FINANCIAL_LINE_PATTERNS.filter((pattern) => pattern.statementTypes.includes("mda_text"))) {
      if (!item.pattern.test(sentence)) continue;
      lineItems.push({
        statementType: "mda_text",
        tableId: null,
        label: item.label,
        rowLabel: item.label.replace(/_/g, " "),
        columns: [...sentence.matchAll(/(?:year|three months|six months|nine months|fiscal year) ended[^,.;]*/gi)].map((match) => compact(match[0])),
        values: [...sentence.matchAll(/(?:\$|RMB|HKD|EUR|GBP)?\s*\(?[0-9][0-9,.]*\)?\s*(?:million|thousand|billion|%)?/gi)].map((match) => compact(match[0])),
        evidence: clippedEvidence(sentence),
        source: "mda_text",
        confidence: "medium",
      });
    }
  }
  return lineItems.slice(0, 80);
}

function detectLiquidityPhrasesWithSections(text: string, sectionDetection: S1F1SectionDetection): S1F1LiquidityPhraseInventory {
  const contexts = [
    ...sectionDetection.sections.map((section) => ({ sectionKey: section.key, text: extractSectionLines(text, sectionDetection, section.key).join("\n") })),
    { sectionKey: null, text },
  ];
  const phrases: S1F1LiquidityPhraseInventory["phrases"] = [];
  const seen = new Set<string>();
  for (const context of contexts) {
    for (const pattern of LIQUIDITY_PATTERNS) {
      for (const match of context.text.matchAll(globalPattern(pattern.pattern))) {
        const key = `${context.sectionKey}:${pattern.label}:${compact(match[0])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        phrases.push({ ...candidate(pattern.label, match[0], match[0], "medium"), sectionKey: context.sectionKey });
      }
    }
  }
  const sections = new Set(phrases.filter((item) => /going_concern|substantial_doubt/.test(item.label)).map((item) => item.sectionKey ?? "full_text"));
  return {
    phrases: phrases.slice(0, 120),
    warnings: sections.size > 1 ? ["Going-concern or substantial-doubt language appears in multiple sections; preserve section context."] : [],
  };
}

function extractMdaExtraction(text: string, sectionDetection: S1F1SectionDetection): S1F1FinancialExtractions["mda"] {
  const mda = extractMdaText(text, sectionDetection);
  const warnings = mda.sectionKey ? [] : ["MD&A/OFR body section was not detected."];
  return {
    sectionDetected: Boolean(mda.sectionKey),
    sectionKey: mda.sectionKey,
    subsectionHeadings: sectionDetection.sections
      .filter((section) => ["results_of_operations", "liquidity_capital_resources", "cash_flows", "critical_accounting", "market_risk", "contractual_obligations", "research_development", "trend_information"].includes(section.key))
      .map((section) => section.heading),
    lineItems: extractMdaLineItems(mda.text),
    liquidityPhrases: detectLiquidityPhrasesWithSections(mda.text, sectionDetection).phrases,
    warnings,
  };
}

function extractNoteTopicInventory(text: string, sectionDetection: S1F1SectionDetection, statementTables: S1F1FinancialStatementTableInventoryItem[]): S1F1NoteTopicInventory {
  const contexts = [
    { text: sectionText(text, sectionDetection, "index_to_financial_statements"), sourceLocation: "paragraph" as const, sectionKey: "index_to_financial_statements" },
    { text, sourceLocation: "paragraph" as const, sectionKey: null },
    ...statementTables.filter((table) => table.classification === "notes").map((table) => ({ text: table.rows.map((row) => row.text).join("\n"), sourceLocation: "table" as const, sectionKey: table.sectionKey })),
  ];
  const topics: S1F1NoteTopicInventory["topics"] = [];
  const seen = new Set<string>();
  for (const context of contexts) {
    for (const topic of NOTE_TOPIC_PATTERNS) {
      const match = context.text.match(topic.pattern);
      if (!match) continue;
      const key = `${topic.topic}:${context.sourceLocation}:${context.sectionKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      topics.push({
        ...candidate(topic.topic, match[0], clippedEvidence(context.text.slice(Math.max(0, match.index ?? 0), (match.index ?? 0) + 260)), "medium"),
        topic: topic.topic,
        sourceLocation: context.sourceLocation,
        sectionKey: context.sectionKey,
      });
    }
  }
  return { topics, warnings: [] };
}

function extractAuditorAccounting(text: string): S1F1AuditorAccountingExtraction {
  const accountingBasisPhrases = findPhraseCandidates(text, [
    { label: "us_gaap", pattern: /(U\.?S\.? GAAP|accounting principles generally accepted in the United States[^.\n]{0,120})/i },
    { label: "ifrs", pattern: /(International Financial Reporting Standards|IFRS(?! as issued)[^.\n]{0,80})/i },
    { label: "ifrs_iasb", pattern: /(IFRS as issued by the IASB|International Financial Reporting Standards as issued by the International Accounting Standards Board)/i },
    { label: "local_gaap", pattern: /(local GAAP|PRC GAAP|Hong Kong Financial Reporting Standards[^.\n]{0,120})/i },
    { label: "convenience_translation", pattern: /(convenience translation[^.\n]{0,160})/i },
  ]);
  const warnings = accountingBasisPhrases.some((item) => item.label === "us_gaap") &&
    accountingBasisPhrases.some((item) => item.label === "ifrs" || item.label === "ifrs_iasb")
    ? ["Both IFRS and U.S. GAAP language appear; preserve both because context is not resolved by the parser."]
    : [];
  return {
    auditorNameCandidates: findCandidateMatches(text, "auditor_name", [
      /(\/s\/\s*([A-Z][A-Za-z0-9 &.,'-]+(?:LLP|LLC|P\.C\.|CPA)?))/i,
      /(To the [^\n]+?\n([A-Z][A-Za-z0-9 &.,'-]+(?:LLP|LLC|P\.C\.|CPA)?))/i,
    ]).map((item) => ({ ...item, value: item.value.replace(/^\/s\/\s*/i, "") })),
    auditorReportTitleCandidates: findCandidateMatches(text, "auditor_report_title", [/(Report of Independent Registered Public Accounting Firm)/i], { confidence: "high" }),
    auditOpinionDateCandidates: findCandidateMatches(text, "audit_opinion_date", [/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i]),
    pcaobPhrases: findCandidateMatches(text, "pcaob_phrase", [/(Public Company Accounting Oversight Board|PCAOB[^.\n]{0,160})/i]),
    goingConcernParagraphs: findCandidateMatches(text, "going_concern_explanatory_paragraph", [/(going concern[^.\n]{0,260})/i, /(substantial doubt[^.\n]{0,260})/i]),
    auditedFinancialStatementPhrases: findCandidateMatches(text, "audited_financial_statements", [/(audited financial statements[^.\n]{0,180})/i]),
    unauditedInterimPhrases: findCandidateMatches(text, "unaudited_interim_financial_statements", [/(unaudited interim financial statements[^.\n]{0,180})/i, /(unaudited condensed financial statements[^.\n]{0,180})/i]),
    accountingBasisPhrases,
    reportingCurrencyCandidates: findCandidateMatches(text, "reporting_currency", [/(reporting currency[^.\n]{0,120})/i, /(presented in (?:U\.?S\.? dollars|USD|RMB|Renminbi|HKD|EUR|GBP)[^.\n]{0,120})/i]),
    functionalCurrencyCandidates: findCandidateMatches(text, "functional_currency", [/(functional currency[^.\n]{0,120})/i]),
    warnings,
  };
}

function extractFinancialExtractions(text: string, sectionDetection: S1F1SectionDetection, documentTables: S1F1DocumentTable[]): S1F1FinancialExtractions {
  const financialStatementTables = extractFinancialStatementTables(sectionDetection, documentTables);
  const financialLineItems = extractFinancialLineItemsFromTables(financialStatementTables);
  const liquidity = detectLiquidityPhrasesWithSections(text, sectionDetection);
  const mda = extractMdaExtraction(text, sectionDetection);
  const auditorAndAccounting = extractAuditorAccounting(text);
  const notes = extractNoteTopicInventory(text, sectionDetection, financialStatementTables);
  const warnings = [...mda.warnings, ...liquidity.warnings, ...auditorAndAccounting.warnings];
  if (sectionExists(sectionDetection, "index_to_financial_statements") && financialStatementTables.length === 0) {
    warnings.push("Financial statement index was detected but no financial statement tables were classified.");
  }
  return { mda, financialStatementTables, financialLineItems, liquidity, notes, auditorAndAccounting, warnings };
}

function contextual(
  sectionKey: string | null,
  label: string,
  value: string,
  evidence: string,
  confidence: ConfidenceLevel = "medium",
): S1F1ContextualCandidate {
  return { ...candidate(label, value, evidence, confidence, { isPlaceholder: isPlaceholderValue(value) }), sectionKey };
}

function findContextualMatches(
  sectionKey: string | null,
  text: string,
  label: string,
  patterns: RegExp[],
  limit = 12,
): S1F1ContextualCandidate[] {
  return findCandidateMatches(text, label, patterns, { limit }).map((item) => ({ ...item, sectionKey }));
}

function tableRowsForSection(sectionDetection: S1F1SectionDetection, documentTables: S1F1DocumentTable[], keys: string[]): S1F1ExtractedTableRow[] {
  return extractedRowsForTables(sectionTables(sectionDetection, documentTables, keys), keys[0] ?? null);
}

function tableColumns(rows: S1F1ExtractedTableRow[]): string[] {
  const header = rows.find((row) => /name|shares|before|after|amount|relationship|title|age|percentage|%/i.test(row.text));
  return header?.cells ?? [];
}

function isLikelyHeaderRow(row: S1F1ExtractedTableRow): boolean {
  const text = row.text.toLowerCase();
  if (/^\s*\d+(?:\.\d+)?%\s+/i.test(row.label)) return false;
  if (/^(selling\s+)?(?:name|stockholder|shareholder|securityholder|holder|name of beneficial owner)$/i.test(row.label.trim())) return true;
  const headerTerms = ["name", "holder", "stockholder", "shareholder", "securityholder", "beneficial owner", "relationship", "position", "title", "age", "shares", "offered", "before", "after", "amount", "salary", "bonus", "option awards", "stock awards"];
  const hasHeaderTerm = headerTerms.some((term) => text.includes(term));
  const hasPersonLikeLabel = /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4}(?:\s+\(\d+\))?$/.test(row.label);
  return hasHeaderTerm && !hasPersonLikeLabel;
}

function sectionAndTableText(text: string, sectionDetection: S1F1SectionDetection, rows: S1F1ExtractedTableRow[], keys: string[]): string {
  return [combinedSectionText(text, sectionDetection, keys), ...rows.map((row) => row.text)].filter(Boolean).join("\n");
}

function extractNamesFromRows(rows: S1F1ExtractedTableRow[], sectionKey: string | null): S1F1ContextualCandidate[] {
  return rows
    .filter((row) => row.cells.length > 1 && !/name|holder|stockholder|shareholder|securityholder/i.test(row.label))
    .map((row) => contextual(sectionKey, "name_or_row_label", row.label, row.text, "medium"))
    .slice(0, 80);
}

function extractRelatedParty(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
  financialExtractions: S1F1FinancialExtractions,
  sectionExtractions: S1F1SectionExtractions,
): S1F1GovernanceExtractions["relatedParty"] {
  const keys = ["related_party_transactions"];
  const rows = tableRowsForSection(sectionDetection, documentTables, keys);
  const relatedNoteTopics = financialExtractions.notes.topics.filter((topic) => topic.topic === "related_party_transactions");
  const body = sectionAndTableText(text, sectionDetection, rows, keys);
  const noteText = relatedNoteTopics.map((topic) => topic.evidence).join("\n");
  const combined = [body, noteText].filter(Boolean).join("\n");
  const negativeDisclosure = findContextualMatches("related_party_transactions", combined, "negative_related_party_disclosure", [
    /(no related party transactions?[^.\n]{0,180})/i,
    /(no transactions required to be disclosed[^.\n]{0,180})/i,
    /(there have been no transactions with related persons[^.\n]{0,180})/i,
    /(no related person transactions?[^.\n]{0,180})/i,
  ]);
  const transactionTypeCandidates = findPhraseCandidates(combined, [
    { label: "loan", pattern: /\b(loan[^.\n]{0,160})/i },
    { label: "note", pattern: /\b(note[^.\n]{0,160})/i },
    { label: "convertible_note", pattern: /(convertible note[^.\n]{0,160})/i },
    { label: "promissory_note", pattern: /(promissory note[^.\n]{0,160})/i },
    { label: "bridge_financing", pattern: /(bridge financing[^.\n]{0,160})/i },
    { label: "guarantee", pattern: /(guarantee[^.\n]{0,160})/i },
    { label: "consulting_agreement", pattern: /(consulting agreement[^.\n]{0,160})/i },
    { label: "service_agreement", pattern: /(service agreement[^.\n]{0,160})/i },
    { label: "lease", pattern: /(lease[^.\n]{0,160})/i },
    { label: "employment_agreement", pattern: /(employment agreement[^.\n]{0,160})/i },
    { label: "purchase_agreement", pattern: /(purchase agreement[^.\n]{0,160})/i },
    { label: "sale_agreement", pattern: /(sale agreement[^.\n]{0,160})/i },
    { label: "repayment", pattern: /(repay(?:ment)?[^.\n]{0,160})/i },
    { label: "reimbursement", pattern: /(reimbursement[^.\n]{0,160})/i },
    { label: "compensation_related", pattern: /(compensation[^.\n]{0,160})/i },
  ]).map((item) => ({ ...item, sectionKey: "related_party_transactions" }));
  const crossSectionHints = [
    ...sectionExtractions.useOfProceeds.useCategories
      .filter((item) => item.label === "related_party_repayment")
      .map((item) => ({ ...item, sectionKey: "use_of_proceeds" })),
  ];
  const warnings: string[] = [];
  if (negativeDisclosure.length && (transactionTypeCandidates.length || relatedNoteTopics.length)) {
    warnings.push("Explicit negative related-party disclosure coexists with related-party evidence elsewhere; preserve both.");
  }
  const partyNameCandidates = [
    ...extractNamesFromRows(rows, "related_party_transactions"),
    ...findContextualMatches("related_party_transactions", combined, "related_party_name", [
      /([A-Z][A-Za-z.'-]+\s+[A-Z][A-Za-z.'-]+)[^.\n]{0,140}(?:consulting|service|loan|note|agreement|provided|lease|repayment)/i,
    ]),
  ];
  return {
    sectionDetected: sectionExists(sectionDetection, "related_party_transactions"),
    tableRows: rows,
    columnLabels: tableColumns(rows),
    negativeDisclosure,
    partyNameCandidates,
    relationshipCandidates: findContextualMatches("related_party_transactions", combined, "relationship", [
      /(officer|director|founder|shareholder|affiliate|family member|entity controlled by [^.\n]{0,80})/i,
    ]),
    transactionTypeCandidates,
    amountCandidates: findContextualMatches("related_party_transactions", combined, "amount", [/(\$[0-9][0-9,.]*(?:\s*(?:million|thousand))?)/i]),
    interestRateCandidates: findContextualMatches("related_party_transactions", combined, "interest_rate", [/([0-9.]+%)\s+interest/i]),
    maturityCandidates: findContextualMatches("related_party_transactions", combined, "maturity", [/(matur(?:e|ity)[^.\n]{0,160})/i]),
    conversionCandidates: findContextualMatches("related_party_transactions", combined, "conversion", [/(convert(?:ible|ed|sion)[^.\n]{0,160})/i]),
    forgivenessCandidates: findContextualMatches("related_party_transactions", combined, "forgiveness", [/(forgiv(?:e|en|eness)[^.\n]{0,160})/i]),
    outstandingBalanceCandidates: findContextualMatches("related_party_transactions", combined, "outstanding_balance", [/(outstanding balance[^.\n]{0,160})/i]),
    policyLanguage: findContextualMatches("related_party_transactions", combined, "policy_language", [/(polic(?:y|ies)(?: and procedures)?[^.\n]{0,220})/i]),
    crossSectionHints,
    warnings,
  };
}

function extractLegalProceedings(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
  financialExtractions: S1F1FinancialExtractions,
): S1F1GovernanceExtractions["legalProceedings"] {
  const keys = ["legal_proceedings", "commitments_contingencies"];
  const rows = tableRowsForSection(sectionDetection, documentTables, keys);
  const legalText = sectionAndTableText(text, sectionDetection, rows, keys);
  const noteText = financialExtractions.notes.topics
    .filter((topic) => ["commitments_and_contingencies", "legal_proceedings"].includes(topic.topic))
    .map((topic) => topic.evidence)
    .join("\n");
  const riskText = sectionText(text, sectionDetection, "risk_factors");
  const combined = [legalText, noteText].filter(Boolean).join("\n");
  const negativeDisclosure = findContextualMatches("legal_proceedings", legalText, "negative_legal_disclosure", [
    /(not a party to any material legal proceedings[^.\n]{0,180})/i,
    /(no material pending legal proceedings[^.\n]{0,180})/i,
    /(no proceedings known to be contemplated by governmental authorities[^.\n]{0,180})/i,
    /(not currently subject to any material litigation[^.\n]{0,180})/i,
  ]);
  const proceedingCandidates = findPhraseCandidates(combined, [
    { label: "pending_litigation", pattern: /(pending litigation[^.\n]{0,200})/i },
    { label: "threatened_litigation", pattern: /(threatened litigation[^.\n]{0,200})/i },
    { label: "lawsuit", pattern: /(lawsuit[^.\n]{0,200})/i },
    { label: "claim", pattern: /\b(claim[^.\n]{0,200})/i },
    { label: "complaint", pattern: /(complaint[^.\n]{0,200})/i },
    { label: "arbitration", pattern: /(arbitration[^.\n]{0,200})/i },
    { label: "investigation", pattern: /(investigation[^.\n]{0,200})/i },
    { label: "subpoena", pattern: /(subpoena[^.\n]{0,200})/i },
    { label: "enforcement_action", pattern: /(enforcement action[^.\n]{0,200})/i },
    { label: "regulatory_proceeding", pattern: /(regulatory proceeding[^.\n]{0,200})/i },
    { label: "settlement", pattern: /(settlement[^.\n]{0,200})/i },
    { label: "injunction", pattern: /(injunction[^.\n]{0,200})/i },
    { label: "government_investigation", pattern: /(government investigation[^.\n]{0,200})/i },
    { label: "sec_investigation", pattern: /(SEC investigation[^.\n]{0,200})/i },
    { label: "doj_investigation", pattern: /(DOJ investigation[^.\n]{0,200})/i },
    { label: "fda_proceeding", pattern: /(FDA[^.\n]{0,120}?(?:proceeding|investigation|enforcement)[^.\n]{0,120})/i },
  ]).map((item) => ({ ...item, sectionKey: "legal_proceedings" }));
  const riskFactorOnlyHints = findPhraseCandidates(riskText, [
    { label: "risk_factor_litigation_reference", pattern: /(litigation|investigation|claims?|lawsuits?)[^.\n]{0,180}/i },
  ]).map((item) => ({ ...item, sectionKey: "risk_factors" }));
  const warnings: string[] = [];
  if (negativeDisclosure.length && (proceedingCandidates.length || noteText)) warnings.push("Explicit negative legal proceedings disclosure coexists with legal or contingency evidence elsewhere; preserve both.");
  if (riskFactorOnlyHints.length && !proceedingCandidates.length) warnings.push("Litigation terms appear only in Risk Factors and are not treated as confirmed active proceedings.");
  return {
    sectionDetected: sectionExists(sectionDetection, "legal_proceedings") || sectionExists(sectionDetection, "commitments_contingencies"),
    tableRows: rows,
    columnLabels: tableColumns(rows),
    negativeDisclosure,
    proceedingCandidates,
    amountCandidates: findContextualMatches("legal_proceedings", combined, "legal_amount", [/(\$[0-9][0-9,.]*(?:\s*(?:million|thousand))?)/i]),
    dateCandidates: findContextualMatches("legal_proceedings", combined, "legal_date", [/((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i]),
    partyCandidates: findContextualMatches("legal_proceedings", combined, "legal_party", [
      /(?:On\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2},\s+)?([A-Z][A-Za-z0-9 &.,'-]{2,80})\s+filed\s+a\s+lawsuit/i,
      /(?:v\.|versus|against)\s+([A-Z][A-Za-z0-9 &.,'-]{2,80})/i,
    ]),
    riskFactorOnlyHints,
    warnings,
  };
}

function extractOwnership(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1GovernanceExtractions["ownership"] {
  const keys = ["principal_stockholders"];
  const rows = tableRowsForSection(sectionDetection, documentTables, keys);
  const body = sectionAndTableText(text, sectionDetection, rows, keys);
  return {
    sectionDetected: sectionExists(sectionDetection, "principal_stockholders"),
    tableRows: rows,
    columnLabels: tableColumns(rows),
    ownerRows: rows.filter((row) => row.cells.length > 1 && !isLikelyHeaderRow(row)),
    footnotes: findContextualMatches("principal_stockholders", body, "ownership_footnote", [/(\(\d+\)[^.\n]{0,240})/i]),
    ownershipLanguage: findPhraseCandidates(body, [
      { label: "directors_officers_group", pattern: /(directors and executive officers as a group[^.\n]{0,180})/i },
      { label: "five_percent_holder", pattern: /(5% stockholder[^.\n]{0,180})/i },
      { label: "beneficial_ownership", pattern: /(beneficially owned[^.\n]{0,220})/i },
      { label: "voting_power", pattern: /(voting power[^.\n]{0,180})/i },
      { label: "class_a_b", pattern: /(Class [AB][^.\n]{0,160})/i },
      { label: "ads_ownership", pattern: /(ADSs?[^.\n]{0,160}?owned[^.\n]{0,160}|[0-9][0-9,]*\s+ADSs?)/i },
      { label: "options_60_days", pattern: /(options? exercisable within 60 days[^.\n]{0,180})/i },
      { label: "warrants_60_days", pattern: /(warrants? exercisable within 60 days[^.\n]{0,180})/i },
    ]).map((item) => ({ ...item, sectionKey: "principal_stockholders" })),
    lockupHints: findContextualMatches("principal_stockholders", body, "lockup_hint", [/(lock-up[^.\n]{0,180})/i]),
    controlledCompanyHints: findContextualMatches("principal_stockholders", body, "controlled_company_hint", [/(controlled company[^.\n]{0,180})/i]),
    dualClassVotingHints: findContextualMatches("principal_stockholders", body, "dual_class_voting_hint", [/(dual-class[^.\n]{0,180}|Class B[^.\n]{0,120}?voting power[^.\n]{0,120})/i]),
    warnings: [],
  };
}

function extractSellingHolders(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
  sectionExtractions: S1F1SectionExtractions,
): S1F1GovernanceExtractions["sellingHolders"] {
  const keys = ["selling_stockholders", "plan_of_distribution"];
  const rows = tableRowsForSection(sectionDetection, documentTables, keys);
  const body = sectionAndTableText(text, sectionDetection, rows, keys);
  const warnings: string[] = [];
  const hasSellingSection = sectionExists(sectionDetection, "selling_stockholders") || /selling (?:stockholders|shareholders|securityholders)/i.test(body);
  if (hasSellingSection && !sectionExtractions.offeringTerms.offeringTypes.includes("resale")) {
    warnings.push("Selling-holder section indicates resale, but offering extraction did not detect resale language.");
  }
  if (sectionExtractions.offeringTerms.warnings.some((warning) => warning.includes("Mixed primary and resale"))) {
    warnings.push("Mixed primary and resale structure preserved for selling-holder context.");
  }
  return {
    sectionDetected: hasSellingSection,
    tableRows: rows,
    columnLabels: tableColumns(rows),
    holderRows: rows.filter((row) => row.cells.length > 1 && !isLikelyHeaderRow(row)),
    relationshipCandidates: findContextualMatches("selling_stockholders", body, "relationship", [/(relationship[^.\n]{0,180})/i]),
    affiliateCandidates: findContextualMatches("selling_stockholders", body, "affiliate", [/(affiliate[^.\n]{0,180})/i]),
    brokerDealerCandidates: findContextualMatches("selling_stockholders", body, "broker_dealer", [/(broker-dealer[^.\n]{0,180})/i]),
    underwriterStatusCandidates: findContextualMatches("selling_stockholders", body, "underwriter_status", [/(underwriter[^.\n]{0,180})/i]),
    lockupCandidates: findContextualMatches("selling_stockholders", body, "lockup", [/(lock-up[^.\n]{0,180})/i]),
    resaleLanguage: findContextualMatches("selling_stockholders", body, "resale_language", [/(resale[^.\n]{0,220})/i]),
    registrationRightsLanguage: findContextualMatches("selling_stockholders", body, "registration_rights", [/(registration rights[^.\n]{0,200})/i]),
    privatePlacementLanguage: findContextualMatches("selling_stockholders", body, "private_placement", [/(private placement[^.\n]{0,200})/i]),
    securityTypeCandidates: findPhraseCandidates(body, [
      { label: "pre_funded_warrants", pattern: /(pre-funded warrants?[^.\n]{0,160})/i },
      { label: "warrants", pattern: /\b(warrants?[^.\n]{0,160})/i },
      { label: "ordinary_shares", pattern: /(ordinary shares?[^.\n]{0,160})/i },
      { label: "ads", pattern: /\b(ADSs?[^.\n]{0,160})/i },
    ]).map((item) => ({ ...item, sectionKey: "selling_stockholders" })),
    proceedsLanguage: [
      ...sectionExtractions.useOfProceeds.noIssuerProceedsLanguage.map((item) => ({ ...item, sectionKey: "use_of_proceeds" })),
      ...sectionExtractions.useOfProceeds.sellingHolderProceedsLanguage.map((item) => ({ ...item, sectionKey: "use_of_proceeds" })),
    ],
    warnings,
  };
}

function extractManagement(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
  relatedParty: S1F1GovernanceExtractions["relatedParty"],
): S1F1GovernanceExtractions["management"] {
  const keys = ["management", "executive_compensation"];
  const rows = tableRowsForSection(sectionDetection, documentTables, keys);
  const body = sectionAndTableText(text, sectionDetection, rows, keys);
  const personRows = rows.filter(
    (row) =>
      row.cells.length > 1 &&
      !isLikelyHeaderRow(row) &&
      /\b(chief|officer|director|president|founder|chairman|chair|ceo|cfo)\b/i.test(row.text),
  );
  const names = personRows.map((row) => row.label).filter((name) => name.length >= 3);
  const relatedText = [
    ...relatedParty.transactionTypeCandidates.map((item) => item.evidence),
    ...relatedParty.partyNameCandidates.map((item) => item.evidence),
  ].join("\n");
  const relatedPartyOverlapHints = names
    .filter((name) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(relatedText))
    .map((name) => contextual("management", "management_related_party_name_overlap", name, name, "medium"));
  return {
    sectionDetected: sectionExists(sectionDetection, "management") || sectionExists(sectionDetection, "executive_compensation"),
    tableRows: rows,
    columnLabels: tableColumns(rows),
    personRows,
    paragraphCandidates: findContextualMatches("management", body, "management_paragraph", [/([A-Z][A-Za-z .'-]+,\s*(?:Chief|President|Director|Chairman|Founder)[^.\n]{0,160})/i]),
    committeeLanguage: findPhraseCandidates(body, [
      { label: "audit_committee", pattern: /(audit committee[^.\n]{0,160})/i },
      { label: "compensation_committee", pattern: /(compensation committee[^.\n]{0,160})/i },
      { label: "nominating_governance_committee", pattern: /(nominating(?: and (?:corporate )?governance)? committee[^.\n]{0,160})/i },
    ]).map((item) => ({ ...item, sectionKey: "management" })),
    independentDirectorLanguage: findContextualMatches("management", body, "independent_director", [/(independent director[^.\n]{0,160})/i]),
    familyRelationshipLanguage: findContextualMatches("management", body, "family_relationship", [/(family relationship[^.\n]{0,160})/i]),
    compensationTablePresence: rows.some((row) => /salary|bonus|stock awards|option awards|total compensation|named executive officer/i.test(row.text)),
    employmentAgreementLanguage: findContextualMatches("management", body, "employment_agreement", [/(employment agreement[^.\n]{0,180})/i]),
    relatedPartyOverlapHints,
    warnings: [],
  };
}

function buildCrossSectionHints(
  text: string,
  relatedParty: S1F1GovernanceExtractions["relatedParty"],
  legalProceedings: S1F1GovernanceExtractions["legalProceedings"],
  ownership: S1F1GovernanceExtractions["ownership"],
  sellingHolders: S1F1GovernanceExtractions["sellingHolders"],
  management: S1F1GovernanceExtractions["management"],
): S1F1CrossSectionHint[] {
  const hints: S1F1CrossSectionHint[] = [];
  if (relatedParty.negativeDisclosure.length && relatedParty.transactionTypeCandidates.length) {
    hints.push({ label: "related_party_negative_disclosure_conflict", evidence: relatedParty.transactionTypeCandidates[0].evidence, sections: ["related_party_transactions", "notes"], confidence: "medium" });
  }
  if (legalProceedings.negativeDisclosure.length && legalProceedings.proceedingCandidates.length) {
    hints.push({ label: "legal_negative_conflict", evidence: legalProceedings.proceedingCandidates[0].evidence, sections: ["legal_proceedings", "notes"], confidence: "medium" });
  }
  if (relatedParty.crossSectionHints.length) {
    hints.push({ label: "use_of_proceeds_related_party_repayment", evidence: relatedParty.crossSectionHints[0].evidence, sections: ["use_of_proceeds", "related_party_transactions"], confidence: "medium" });
  }
  if (sellingHolders.warnings.length) {
    hints.push({ label: "selling_holder_resale_consistency", evidence: sellingHolders.warnings[0], sections: ["selling_stockholders", "offering_terms"], confidence: "low" });
  }
  if (ownership.controlledCompanyHints.length) {
    hints.push({ label: "ownership_controlled_company_hint", evidence: ownership.controlledCompanyHints[0].evidence, sections: ["principal_stockholders"], confidence: "medium" });
  }
  if (/variable interest entity|\bVIE\b|contractual arrangements/i.test(text) && relatedParty.partyNameCandidates.length) {
    hints.push({ label: "f1_vie_related_party_overlap_hint", evidence: relatedParty.partyNameCandidates[0].evidence, sections: ["f1_phrases", "related_party_transactions"], confidence: "low" });
  }
  if (management.relatedPartyOverlapHints.length) {
    hints.push({ label: "management_related_party_name_overlap", evidence: management.relatedPartyOverlapHints[0].evidence, sections: ["management", "related_party_transactions"], confidence: "medium" });
  }
  if (legalProceedings.riskFactorOnlyHints.length && !legalProceedings.proceedingCandidates.length) {
    hints.push({ label: "litigation_terms_risk_factors_only", evidence: legalProceedings.riskFactorOnlyHints[0].evidence, sections: ["risk_factors"], confidence: "low" });
  }
  return hints;
}

function extractGovernanceExtractions(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
  financialExtractions: S1F1FinancialExtractions,
  sectionExtractions: S1F1SectionExtractions,
): S1F1GovernanceExtractions {
  const relatedParty = extractRelatedParty(text, sectionDetection, documentTables, financialExtractions, sectionExtractions);
  const legalProceedings = extractLegalProceedings(text, sectionDetection, documentTables, financialExtractions);
  const ownership = extractOwnership(text, sectionDetection, documentTables);
  const sellingHolders = extractSellingHolders(text, sectionDetection, documentTables, sectionExtractions);
  const management = extractManagement(text, sectionDetection, documentTables, relatedParty);
  const crossSectionHints = buildCrossSectionHints(text, relatedParty, legalProceedings, ownership, sellingHolders, management);
  const warnings = [
    ...relatedParty.warnings,
    ...legalProceedings.warnings,
    ...sellingHolders.warnings,
  ];
  return { relatedParty, legalProceedings, ownership, sellingHolders, management, crossSectionHints, warnings };
}

function sourceCandidate(
  sectionKey: string | null,
  sourceDocument: string | null,
  label: string,
  value: string,
  evidence: string,
  confidence: ConfidenceLevel = "medium",
): S1F1SourceCandidate {
  return { ...contextual(sectionKey, label, value, evidence, confidence), sourceDocument };
}

function findSourceMatches(
  sectionKey: string | null,
  sourceDocument: string | null,
  text: string,
  labels: Array<{ label: string; pattern: RegExp; confidence?: ConfidenceLevel }>,
  limitPerLabel = 4,
): S1F1SourceCandidate[] {
  return findPhraseCandidates(text, labels, limitPerLabel).map((item) => ({ ...item, sectionKey, sourceDocument }));
}

function classifyExhibitFamily(exhibitNumber: string | null, title: string): string | null {
  const number = exhibitNumber ?? "";
  const haystack = `${number} ${title}`;
  if (/^1(?:\.|\b)|underwriting|placement|selling agency|distribution agreement/i.test(haystack)) return "underwriting_distribution";
  if (/^2(?:\.|\b)|merger|acquisition|reorganization|asset purchase/i.test(haystack)) return "strategic_transaction";
  if (/^3(?:\.|\b)|charter|certificate of incorporation|bylaws|memorandum and articles/i.test(haystack)) return "charter_bylaws";
  if (/^4(?:\.|\b)|warrant|rights agreement|indenture|description of securities/i.test(haystack)) return "securities_description";
  if (/^5(?:\.|\b)|legal opinion|validity/i.test(haystack)) return "legal_opinion";
  if (/^8(?:\.|\b)|tax opinion/i.test(haystack)) return "tax_opinion";
  if (/^10(?:\.|\b)|material contract|loan|lease|employment|consulting|service|license|supply|purchase agreement/i.test(haystack)) return "material_contract";
  if (/^21(?:\.|\b)|subsidiaries/i.test(haystack)) return "subsidiaries";
  if (/^23(?:\.|\b)|consent/i.test(haystack)) return "consents";
  if (/^24(?:\.|\b)|power of attorney/i.test(haystack)) return "power_of_attorney";
  if (/^99(?:\.|\b)/i.test(haystack)) return "other_material";
  if (/^107(?:\.|\b)|filing fee|fee table/i.test(haystack)) return "filing_fee";
  return null;
}

function statusFlagsForExhibit(text: string): string[] {
  const flags: string[] = [];
  if (/filed herewith/i.test(text)) flags.push("filed_herewith");
  if (/filed previously|previously filed/i.test(text)) flags.push("filed_previously");
  if (/incorporated by reference/i.test(text)) flags.push("incorporated_by_reference");
  if (/to be filed by amendment/i.test(text)) flags.push("to_be_filed_by_amendment");
  if (/confidential treatment|redacted|omitted information|schedules? (?:have been )?omitted/i.test(text)) flags.push("redacted_or_omitted");
  return flags;
}

function filenameFromText(text: string): string | null {
  return text.match(/\b([a-z0-9_./-]+\.(?:htm|html|txt|pdf|xml))\b/i)?.[1] ?? null;
}

function exhibitRowsFromTables(
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1ExtractedTableRow[] {
  const sectionRows = tableRowsForSection(sectionDetection, documentTables, ["exhibit_index"]);
  const fallbackRows = extractedRowsForTables(
    documentTables.filter((table) => /exhibit|filed herewith|incorporated by reference|filing fee|legal opinion|consent/i.test(table.text)),
    "exhibit_index",
  ).filter((row) => /^(?:\d+(?:\.\d+)?|107)\b/i.test(row.label) || /filed herewith|incorporated by reference|to be filed by amendment/i.test(row.text));
  const seen = new Set<string>();
  return [...sectionRows, ...fallbackRows].filter((row) => {
    const key = `${row.tableId}:${row.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractExhibitIndex(
  text: string,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1ExhibitExtractions["exhibitIndex"] {
  const tableRows = exhibitRowsFromTables(sectionDetection, documentTables);
  const body = sectionAndTableText(text, sectionDetection, tableRows, ["exhibit_index", "undertakings"]);
  const items: S1F1ExhibitIndexItem[] = tableRows
    .filter((row) => row.cells.length >= 2 && /^(?:\d+(?:\.\d+)?|107)\b/i.test(row.label))
    .map((row) => {
      const exhibitNumber = row.label.match(/^(\d+(?:\.\d+)?|107)/i)?.[1] ?? null;
      const title = compact(row.cells.slice(1).join(" "));
      return {
        exhibitNumber,
        title,
        description: title || null,
        filename: filenameFromText(row.text),
        documentType: exhibitNumber ? `EX-${exhibitNumber}` : null,
        family: classifyExhibitFamily(exhibitNumber, title),
        statusFlags: statusFlagsForExhibit(row.text),
        row,
        evidence: row.text,
      };
    });
  const familyCounts: Record<string, number> = {};
  for (const item of items) {
    if (!item.family) continue;
    familyCounts[item.family] = (familyCounts[item.family] ?? 0) + 1;
  }
  const warnings: string[] = [];
  if (sectionExists(sectionDetection, "exhibit_index") && tableRows.length === 0) {
    warnings.push("Exhibit index section was detected but no readable exhibit table rows were aligned.");
  }
  return {
    sectionDetected: sectionExists(sectionDetection, "exhibit_index") || items.length > 0,
    tableRows,
    columnLabels: tableColumns(tableRows),
    items,
    familyCounts,
    statusCandidates: findContextualMatches("exhibit_index", body, "exhibit_status", [
      /(filed herewith|filed previously|previously filed|incorporated by reference|to be filed by amendment|confidential treatment|redacted|omitted schedules?)/i,
    ]),
    footnotes: findContextualMatches("exhibit_index", body, "exhibit_footnote", [/(\(\d+\)[^.\n]{0,220}|\*[^.\n]{0,220})/i]),
    warnings,
  };
}

function classifyAttachmentKind(type: string | null, name: string | null, description: string | null, text: string): string {
  const haystack = `${type ?? ""} ${name ?? ""} ${description ?? ""} ${text.slice(0, 1_200)}`;
  if (/EX-FILING FEES|EX-107|filing fee|fee table/i.test(haystack)) return "filing_fee_exhibit";
  if (/tax opinion|opinion as to tax/i.test(haystack)) return "tax_opinion";
  if (/EX-5(?:\.|\b)|legal opinion|opinion of counsel|validity of the securities/i.test(haystack)) return "legal_opinion";
  if (/EX-23(?:\.|\b)|consent of independent|auditor consent|registered public accounting firm/i.test(haystack)) return "auditor_consent";
  if (/consent of counsel|legal consent/i.test(haystack)) return "legal_consent";
  if (/placement agency agreement|placement agent agreement/i.test(haystack)) return "placement_agency_agreement";
  if (/selling agency agreement|selling agent agreement/i.test(haystack)) return "selling_agency_agreement";
  if (/distribution agreement/i.test(haystack)) return "distribution_agreement";
  if (/EX-1(?:\.|\b)|underwriting agreement|underwriter/i.test(haystack)) return "underwriting_agreement";
  if (/lock-?up agreement/i.test(haystack)) return "lock_up_agreement";
  if (/registration rights agreement/i.test(haystack)) return "registration_rights_agreement";
  if (/pre-funded warrant agreement/i.test(haystack)) return "pre_funded_warrant_agreement";
  if (/warrant agreement/i.test(haystack)) return "warrant_agreement";
  if (/rights agreement/i.test(haystack)) return "rights_agreement";
  if (/indenture/i.test(haystack)) return "indenture";
  if (/note purchase agreement/i.test(haystack)) return "note_purchase_agreement";
  if (/convertible note/i.test(haystack)) return "convertible_note_agreement";
  if (/credit agreement/i.test(haystack)) return "credit_agreement";
  if (/loan agreement/i.test(haystack)) return "loan_agreement";
  if (/lease agreement/i.test(haystack)) return "lease_agreement";
  if (/employment agreement|offer letter/i.test(haystack)) return "employment_agreement";
  if (/consulting agreement/i.test(haystack)) return "consulting_agreement";
  if (/service agreement/i.test(haystack)) return "service_agreement";
  if (/acquisition agreement|asset purchase agreement/i.test(haystack)) return "acquisition_agreement";
  if (/merger agreement/i.test(haystack)) return "merger_agreement";
  if (/deposit agreement|depositary agreement/i.test(haystack)) return "deposit_agreement";
  if (/american depositary shares|\bADSs?\b/i.test(haystack)) return "ads_related_exhibit";
  if (/memorandum and articles|articles of association/i.test(haystack)) return "memorandum_and_articles";
  if (/bylaws/i.test(haystack)) return "bylaws";
  if (/certificate of incorporation|charter/i.test(haystack)) return "charter";
  if (/subsidiar(?:y|ies)/i.test(haystack)) return "subsidiary_list";
  if (/power of attorney/i.test(haystack)) return "power_of_attorney";
  if (/EX-10|material contract/i.test(haystack)) return "material_contract";
  if (/EX-/i.test(haystack)) return "other_exhibit";
  return "other_document";
}

function inventoryFromFilterItem(item: S1F1DocumentFilterItem): S1F1ExhibitExtractions["attachedExhibits"][number] {
  const text = item.snippets.map((snippet) => snippet.text).join("\n");
  const kind = item.documentKind ?? classifyAttachmentKind(item.type, item.filename, item.description, text);
  const inferredKind = classifyAttachmentKind(item.type, item.filename, item.description, text);
  const warnings: string[] = [];
  if (kind !== inferredKind && kind !== "main_filing" && inferredKind !== "other_document") {
    warnings.push(`Document kind ${kind} differs from title/text signal ${inferredKind}.`);
  }
  if (/^EX-1(?:\.|\b)/i.test(item.type) && !/underwriting_agreement|placement_agency_agreement|selling_agency_agreement|distribution_agreement/i.test(String(kind))) {
    warnings.push(`Document type ${item.type} usually indicates underwriting/distribution, but title/text signal is ${kind}.`);
  }
  if (/^EX-5(?:\.|\b)/i.test(item.type) && String(kind) !== "legal_opinion") {
    warnings.push(`Document type ${item.type} usually indicates legal opinion, but title/text signal is ${kind}.`);
  }
  if (/^EX-23(?:\.|\b)/i.test(item.type) && !/consent/i.test(String(kind))) {
    warnings.push(`Document type ${item.type} usually indicates consent, but title/text signal is ${kind}.`);
  }
  return {
    sequence: item.sequence,
    type: item.type,
    filename: item.filename,
    description: item.description,
    documentKind: kind,
    bucket: item.bucket,
    sourceTextAvailable: item.sourceTextLength > 0,
    textLength: item.textLength,
    titleSignals: [item.type, item.filename, item.description].filter((value): value is string => Boolean(value)),
    disagreementWarnings: warnings,
    evidence: compact([item.type, item.filename, item.description, text].filter(Boolean).join(" | ")),
  };
}

function inventoryFromInputAttachment(attachment: NonNullable<S1F1ParserInput["attachments"]>[number]): S1F1ExhibitExtractions["attachedExhibits"][number] {
  const kind = classifyAttachmentKind(null, attachment.name, attachment.description ?? null, attachment.text ?? "");
  return {
    sequence: null,
    type: null,
    filename: attachment.name,
    description: attachment.description ?? null,
    documentKind: kind,
    bucket: "attachment",
    sourceTextAvailable: Boolean(attachment.text),
    textLength: attachment.text?.length ?? 0,
    titleSignals: [attachment.name, attachment.description].filter((value): value is string => Boolean(value)),
    disagreementWarnings: [],
    evidence: compact([attachment.name, attachment.description, attachment.text?.slice(0, 900)].filter(Boolean).join(" | ")),
  };
}

function extractAttachedExhibits(input: S1F1ParserInput, filterSummary: S1F1DocumentFilterSummary): S1F1ExhibitExtractions["attachedExhibits"] {
  const filterItems = filterSummary.items.filter((item) => item.documentKind !== "main_filing" && (/^EX-/i.test(item.type) || item.bucket === "important_exhibit"));
  const items = [...filterItems.map(inventoryFromFilterItem), ...(input.attachments ?? []).map(inventoryFromInputAttachment)];
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type ?? ""}:${item.filename ?? ""}:${item.description ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function evidenceCorpusForExhibits(attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"]): Array<{ sourceDocument: string | null; text: string; kind: string }> {
  return attachedExhibits.map((item) => ({
    sourceDocument: item.filename ?? item.description ?? item.type,
    text: item.evidence,
    kind: String(item.documentKind),
  }));
}

function extractMaterialContracts(attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"], exhibitIndex: S1F1ExhibitExtractions["exhibitIndex"]): S1F1ExhibitExtractions["materialContracts"] {
  const materialKinds = /material_contract|loan_agreement|credit_agreement|note_purchase_agreement|convertible_note_agreement|warrant_agreement|pre_funded_warrant_agreement|registration_rights_agreement|lock_up_agreement|lease_agreement|employment_agreement|consulting_agreement|service_agreement|acquisition_agreement|merger_agreement|distribution_agreement/i;
  const contractDocuments = attachedExhibits.filter((item) => materialKinds.test(String(item.documentKind)) || /^10(?:\.|\b)/.test(item.type?.replace(/^EX-/i, "") ?? ""));
  const indexText = exhibitIndex.items.filter((item) => item.family === "material_contract").map((item) => item.evidence).join("\n");
  const corpora = [...evidenceCorpusForExhibits(contractDocuments), { sourceDocument: "exhibit_index", text: indexText, kind: "exhibit_index" }];
  const contractTypeCandidates = corpora.flatMap((doc) => findSourceMatches("material_contract_exhibit", doc.sourceDocument, doc.text, [
    { label: "loan_agreement", pattern: /(loan agreement[^.\n]{0,180})/i },
    { label: "credit_agreement", pattern: /(credit agreement[^.\n]{0,180})/i },
    { label: "convertible_note", pattern: /(convertible note[^.\n]{0,180})/i },
    { label: "note_purchase_agreement", pattern: /(note purchase agreement[^.\n]{0,180})/i },
    { label: "securities_purchase_agreement", pattern: /(securities purchase agreement[^.\n]{0,180})/i },
    { label: "subscription_agreement", pattern: /(subscription agreement[^.\n]{0,180})/i },
    { label: "warrant_agreement", pattern: /(warrant agreement[^.\n]{0,180})/i },
    { label: "registration_rights_agreement", pattern: /(registration rights agreement[^.\n]{0,180})/i },
    { label: "lockup_agreement", pattern: /(lock-?up agreement[^.\n]{0,180})/i },
    { label: "lease_agreement", pattern: /(lease agreement[^.\n]{0,180})/i },
    { label: "employment_agreement", pattern: /(employment agreement[^.\n]{0,180})/i },
    { label: "license_agreement", pattern: /(license agreement[^.\n]{0,180})/i },
    { label: "royalty_agreement", pattern: /(royalt(?:y|ies)[^.\n]{0,180})/i },
  ]));
  const termCandidates = corpora.flatMap((doc) => findSourceMatches("material_contract_exhibit", doc.sourceDocument, doc.text, [
    { label: "principal_amount", pattern: /(principal amount[^$.\n]{0,100}?\$[0-9][0-9,.]*(?:\s*(?:million|thousand))?)/i },
    { label: "purchase_price", pattern: /(purchase price[^$.\n]{0,100}?\$[0-9][0-9,.]*(?:\s*(?:million|thousand))?)/i },
    { label: "interest_rate", pattern: /([0-9.]+%\s+(?:per annum\s+)?interest[^.\n]{0,120})/i },
    { label: "maturity_date", pattern: /(matur(?:es|ity date)[^.\n]{0,160})/i },
    { label: "conversion_price", pattern: /(conversion price[^$.\n]{0,80}?\$[0-9][0-9,.]*)/i },
    { label: "exercise_price", pattern: /(exercise price[^$.\n]{0,80}?\$[0-9][0-9,.]*)/i },
    { label: "shares_or_warrants", pattern: /([0-9][0-9,]*\s+(?:shares|warrants)[^.\n]{0,140})/i },
    { label: "default", pattern: /(default[^.\n]{0,180})/i },
    { label: "covenant", pattern: /(covenant[^.\n]{0,180})/i },
    { label: "termination", pattern: /(termination[^.\n]{0,180})/i },
    { label: "governing_law", pattern: /(governed by the laws of [^.\n]{0,120})/i },
  ]));
  const titleCandidates = corpora.flatMap((doc) => findSourceMatches("material_contract_exhibit", doc.sourceDocument, doc.text, [{ label: "agreement_title", pattern: /((?:[A-Z][A-Za-z-]+\s+){0,4}Agreement[^.\n|]{0,120})/i }], 2));
  const dateCandidates = corpora.flatMap((doc) => findSourceMatches("material_contract_exhibit", doc.sourceDocument, doc.text, [{ label: "agreement_date", pattern: /(?:dated|as of)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i }]));
  const partyCandidates = corpora.flatMap((doc) => findSourceMatches("material_contract_exhibit", doc.sourceDocument, doc.text, [
    { label: "agreement_parties", pattern: /(?:by and between|between)\s+([^.\n]{3,220})/i },
    { label: "related_party_language", pattern: /(affiliate|officer|director|founder|shareholder|entity controlled by [^.\n]{0,100})/i },
  ]));
  const redactionCandidates = corpora.flatMap((doc) => findSourceMatches("material_contract_exhibit", doc.sourceDocument, doc.text, [{ label: "redacted_or_omitted", pattern: /(certain information has been omitted|redacted|confidential treatment|schedules? have been omitted[^.\n]{0,160})/i }]));
  return { contractDocuments, contractTypeCandidates, titleCandidates, dateCandidates, partyCandidates, termCandidates, redactionCandidates, warnings: [] };
}

function extractUnderwritingAgreementEvidence(
  text: string,
  sectionDetection: S1F1SectionDetection,
  attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"],
): S1F1ExhibitExtractions["underwritingAgreements"] {
  const sectionBody = combinedSectionText(text, sectionDetection, ["underwriting", "plan_of_distribution"]);
  const agreementDocuments = attachedExhibits.filter((item) => /underwriting_agreement|placement_agency_agreement|selling_agency_agreement|distribution_agreement/i.test(String(item.documentKind)));
  const corpora = [{ sourceDocument: "main_underwriting_sections", text: sectionBody, kind: "main" }, ...evidenceCorpusForExhibits(agreementDocuments)];
  return {
    sectionDetected: sectionExists(sectionDetection, "underwriting") || sectionExists(sectionDetection, "plan_of_distribution"),
    agreementDocuments,
    underwriterCandidates: corpora.flatMap((doc) => findSourceMatches("underwriting", doc.sourceDocument, doc.text, [{ label: "underwriter_name", pattern: /(?:underwriter|representative)[^A-Z.\n]{0,30}([A-Z][A-Za-z0-9 &.,'-]{2,100})/i }])),
    agentCandidates: corpora.flatMap((doc) => findSourceMatches("underwriting", doc.sourceDocument, doc.text, [{ label: "placement_or_selling_agent", pattern: /((?:placement|selling) agent[^.\n]{0,180})/i }])),
    methodLanguage: corpora.flatMap((doc) => findSourceMatches("underwriting", doc.sourceDocument, doc.text, [
      { label: "firm_commitment", pattern: /(firm commitment[^.\n]{0,180})/i },
      { label: "best_efforts", pattern: /(best efforts[^.\n]{0,180})/i },
    ])),
    feeCandidates: corpora.flatMap((doc) => findSourceMatches("underwriting", doc.sourceDocument, doc.text, [
      { label: "underwriting_discount", pattern: /(underwriting discount[^.\n]{0,160}?(?:[0-9.]+%|\$[0-9][0-9,.]*))/i },
      { label: "commission", pattern: /(commission[^.\n]{0,160}?(?:[0-9.]+%|\$[0-9][0-9,.]*))/i },
      { label: "commission", pattern: /([0-9.]+%\s+commission[^.\n]{0,160})/i },
      { label: "expense_allowance", pattern: /(non-accountable expense allowance[^.\n]{0,180}|reimbursement[^.\n]{0,180})/i },
      { label: "tail_fee", pattern: /(tail fee[^.\n]{0,180})/i },
    ])),
    warrantCandidates: corpora.flatMap((doc) => findSourceMatches("underwriting", doc.sourceDocument, doc.text, [{ label: "representative_warrants", pattern: /((?:representative|underwriter|placement agent) warrants?[^.\n]{0,220})/i }])),
    termCandidates: corpora.flatMap((doc) => findSourceMatches("underwriting", doc.sourceDocument, doc.text, [
      { label: "over_allotment", pattern: /(over-allotment option[^.\n]{0,180})/i },
      { label: "stabilization", pattern: /(stabilization[^.\n]{0,180})/i },
      { label: "lockup", pattern: /(lock-?up[^.\n]{0,180})/i },
      { label: "indemnification", pattern: /(indemnification[^.\n]{0,180})/i },
      { label: "right_of_first_refusal", pattern: /(right of first refusal[^.\n]{0,180})/i },
      { label: "termination", pattern: /(termination[^.\n]{0,180})/i },
      { label: "finra", pattern: /(FINRA[^.\n]{0,180})/i },
    ])),
    warnings: [],
  };
}

function extractLockupRegistrationRights(
  text: string,
  sectionDetection: S1F1SectionDetection,
  attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"],
): S1F1ExhibitExtractions["lockupRegistrationRights"] {
  const sections = combinedSectionText(text, sectionDetection, ["underwriting", "plan_of_distribution", "shares_eligible_for_future_sale", "selling_stockholders", "principal_stockholders"]);
  const lockupDocuments = attachedExhibits.filter((item) => String(item.documentKind) === "lock_up_agreement");
  const registrationRightsDocuments = attachedExhibits.filter((item) => String(item.documentKind) === "registration_rights_agreement");
  const corpora = [{ sourceDocument: "main_lockup_registration_sections", text: sections, kind: "main" }, ...evidenceCorpusForExhibits([...lockupDocuments, ...registrationRightsDocuments])];
  return {
    lockupDocuments,
    registrationRightsDocuments,
    lockupLanguage: corpora.flatMap((doc) => findSourceMatches("lockup_registration_rights", doc.sourceDocument, doc.text, [
      { label: "lockup_period", pattern: /(\d+\s+days?[^.\n]{0,120}?lock-?up|lock-?up[^.\n]{0,120}?\d+\s+days?)/i },
      { label: "lockup_parties", pattern: /(officers|directors|stockholders|shareholders)[^.\n]{0,160}?lock-?up/i },
      { label: "underwriter_release", pattern: /(underwriter[^.\n]{0,120}?(?:consent|release)[^.\n]{0,120})/i },
    ])),
    registrationRightsLanguage: corpora.flatMap((doc) => findSourceMatches("lockup_registration_rights", doc.sourceDocument, doc.text, [
      { label: "demand_registration_rights", pattern: /(demand registration rights[^.\n]{0,180})/i },
      { label: "piggyback_registration_rights", pattern: /(piggyback registration rights[^.\n]{0,180})/i },
      { label: "shelf_registration_rights", pattern: /(shelf registration rights[^.\n]{0,180})/i },
      { label: "resale_registration", pattern: /(resale registration[^.\n]{0,180})/i },
      { label: "private_placement_registration", pattern: /(private placement[^.\n]{0,120}?registration[^.\n]{0,120})/i },
      { label: "liquidated_damages", pattern: /(liquidated damages[^.\n]{0,180})/i },
    ])),
    warnings: [],
  };
}

function extractAdsDepositAgreement(
  text: string,
  sectionDetection: S1F1SectionDetection,
  attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"],
): S1F1ExhibitExtractions["adsDepositAgreement"] {
  const body = combinedSectionText(text, sectionDetection, ["description_of_ads", "depositary", "description_of_securities", "exchange_controls", "enforceability_civil_liabilities", "home_country_practice", "foreign_private_issuer_status"]);
  const depositAgreementDocuments = attachedExhibits.filter((item) => /deposit_agreement|ads_related_exhibit/i.test(String(item.documentKind)));
  const corpora = [{ sourceDocument: "main_ads_sections", text: body, kind: "main" }, ...evidenceCorpusForExhibits(depositAgreementDocuments)];
  const adsDetected = /\bADSs?\b|American Depositary Shares/i.test(body) || depositAgreementDocuments.length > 0;
  const warnings = adsDetected && depositAgreementDocuments.length === 0 ? ["ADS language detected but no deposit-agreement exhibit evidence was matched."] : [];
  return {
    adsDetected,
    depositAgreementDocuments,
    adsRatioCandidates: corpora.flatMap((doc) => findSourceMatches("ads_deposit_agreement", doc.sourceDocument, doc.text, [{ label: "ads_ratio", pattern: /(each ADS represents [^.\n]{0,120}?ordinary shares?)/i }])),
    depositaryCandidates: corpora.flatMap((doc) => findSourceMatches("ads_deposit_agreement", doc.sourceDocument, doc.text, [{ label: "depositary_name", pattern: /(?:depositary|depositary bank)\s*(?:is|will be|:)?\s*([A-Z][A-Za-z0-9 &.,'-]{2,120})/i }])),
    feeCandidates: corpora.flatMap((doc) => findSourceMatches("ads_deposit_agreement", doc.sourceDocument, doc.text, [{ label: "ads_fees", pattern: /(ADS fees?[^.\n]{0,180}|fees?[^.\n]{0,120}?ADSs?[^.\n]{0,120})/i }])),
    rightsLanguage: corpora.flatMap((doc) => findSourceMatches("ads_deposit_agreement", doc.sourceDocument, doc.text, [
      { label: "voting_rights", pattern: /(voting rights[^.\n]{0,180})/i },
      { label: "dividend_distribution", pattern: /(dividend distribution[^.\n]{0,180}|distribute dividends[^.\n]{0,180})/i },
      { label: "withdrawal_cancellation", pattern: /(withdrawal|cancellation)[^.\n]{0,180}/i },
      { label: "exchange_controls", pattern: /(exchange controls?[^.\n]{0,180})/i },
      { label: "civil_liabilities", pattern: /(civil liabilities[^.\n]{0,180})/i },
      { label: "home_country_practice", pattern: /(home country practice[^.\n]{0,180})/i },
      { label: "foreign_private_issuer", pattern: /(foreign private issuer[^.\n]{0,180})/i },
    ])),
    warnings,
  };
}

function extractLegalOpinionConsent(
  text: string,
  sectionDetection: S1F1SectionDetection,
  attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"],
): S1F1ExhibitExtractions["legalOpinionsConsents"] {
  const mainText = combinedSectionText(text, sectionDetection, ["legal_matters", "experts"]);
  const legalOpinionDocuments = attachedExhibits.filter((item) => String(item.documentKind) === "legal_opinion");
  const taxOpinionDocuments = attachedExhibits.filter((item) => String(item.documentKind) === "tax_opinion");
  const consentDocuments = attachedExhibits.filter((item) => /auditor_consent|legal_consent/i.test(String(item.documentKind)));
  const corpora = [{ sourceDocument: "legal_matters_experts_sections", text: mainText, kind: "main" }, ...evidenceCorpusForExhibits([...legalOpinionDocuments, ...taxOpinionDocuments, ...consentDocuments])];
  return {
    legalOpinionDocuments,
    taxOpinionDocuments,
    consentDocuments,
    lawFirmCandidates: corpora.flatMap((doc) => findSourceMatches("legal_opinion_consent", doc.sourceDocument, doc.text, [{ label: "law_firm", pattern: /([A-Z][A-Za-z0-9 &.,'-]+ LLP|[A-Z][A-Za-z0-9 &.,'-]+ P\.C\.|[A-Z][A-Za-z0-9 &.,'-]+ Law [A-Za-z]+)(?:[^.\n]{0,120})/i }])),
    auditorFirmCandidates: corpora.flatMap((doc) => findSourceMatches("legal_opinion_consent", doc.sourceDocument, doc.text, [{ label: "auditor_firm", pattern: /([A-Z][A-Za-z0-9 &.,'-]+(?:LLP|CPA|P\.C\.))[^.\n]{0,160}?(?:independent registered public accounting firm|audit report|consent)/i }])),
    opinionLanguage: corpora.flatMap((doc) => findSourceMatches("legal_opinion_consent", doc.sourceDocument, doc.text, [
      { label: "validity_opinion", pattern: /(validity of the securities[^.\n]{0,180})/i },
      { label: "tax_opinion", pattern: /(tax opinion[^.\n]{0,180})/i },
    ])),
    consentLanguage: corpora.flatMap((doc) => findSourceMatches("legal_opinion_consent", doc.sourceDocument, doc.text, [
      { label: "consent_to_use_audit_report", pattern: /(consent[^.\n]{0,160}?use[^.\n]{0,80}?audit report[^.\n]{0,120})/i },
      { label: "expert_consent", pattern: /(consent[^.\n]{0,160}?expert[^.\n]{0,120})/i },
    ])),
    datedSignatureCandidates: corpora.flatMap((doc) => findSourceMatches("legal_opinion_consent", doc.sourceDocument, doc.text, [{ label: "dated_signature", pattern: /(?:\/s\/\s*)?[A-Z][A-Za-z0-9 &.,'-]+(?:LLP|P\.C\.|CPA)?[^.\n]{0,80}((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i }])),
    warnings: [],
  };
}

function extractFilingFeeExhibits(
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
  attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"],
  exhibitIndex: S1F1ExhibitExtractions["exhibitIndex"],
): S1F1ExhibitExtractions["filingFeeExhibits"] {
  const documents = attachedExhibits.filter((item) => String(item.documentKind) === "filing_fee_exhibit");
  const feeTables = documentTables.filter((table) => /EX-107|FILING FEES|fee table|registration fee|proposed maximum aggregate offering price/i.test(`${table.documentType} ${table.filename ?? ""} ${table.text}`));
  const tableRows = extractedRowsForTables(feeTables, "filing_fee_exhibit");
  const body = [...documents.map((item) => item.evidence), ...tableRows.map((row) => row.text), ...exhibitIndex.items.filter((item) => item.family === "filing_fee").map((item) => item.evidence)].join("\n");
  const warnings: string[] = [];
  if ((documents.length || exhibitIndex.items.some((item) => item.family === "filing_fee")) && !tableRows.length) warnings.push("Filing fee exhibit was referenced but no readable fee table rows were aligned.");
  if (tableRows.length && tableColumns(tableRows).length < 2) warnings.push("Filing fee table columns could not be confidently aligned.");
  return {
    sectionDetected: documents.length > 0 || tableRows.length > 0 || exhibitIndex.items.some((item) => item.family === "filing_fee"),
    tableRows,
    columnLabels: tableColumns(tableRows),
    documents,
    feeTableTitleCandidates: findSourceMatches("filing_fee_exhibit", "filing_fee", body, [{ label: "fee_table_title", pattern: /(filing fee table|calculation of filing fee table|fee table[^.\n]{0,120})/i }]),
    feeLineCandidates: findSourceMatches("filing_fee_exhibit", "filing_fee", body, [
      { label: "security_type", pattern: /(common stock|ordinary shares|ADSs?|warrants?|units)[^.\n]{0,140}/i },
      { label: "amount_registered", pattern: /(amount registered[^.\n]{0,160}|[0-9][0-9,]*\s+(?:shares|ADSs?|units|warrants)[^.\n]{0,120})/i },
      { label: "maximum_offering_price", pattern: /(proposed maximum offering price[^.\n]{0,160})/i },
      { label: "maximum_aggregate_offering_price", pattern: /(proposed maximum aggregate offering price[^.\n]{0,160})/i },
      { label: "fee_rate", pattern: /(fee rate[^.\n]{0,120}|0\.[0-9]+\s+per\s+\$[0-9,]+)/i },
      { label: "registration_fee", pattern: /(registration fee[^.\n]{0,160})/i },
      { label: "carry_forward_offset", pattern: /(carry forward|offset[^.\n]{0,160})/i },
      { label: "total_fee_due", pattern: /(total fee due[^.\n]{0,160})/i },
    ]),
    footnotes: findSourceMatches("filing_fee_exhibit", "filing_fee", body, [{ label: "fee_table_footnote", pattern: /(\(\d+\)[^.\n]{0,220})/i }]),
    warnings,
  };
}

function buildExhibitConsistencyHints(
  exhibitIndex: S1F1ExhibitExtractions["exhibitIndex"],
  attachedExhibits: S1F1ExhibitExtractions["attachedExhibits"],
  materialContracts: S1F1ExhibitExtractions["materialContracts"],
  underwritingAgreements: S1F1ExhibitExtractions["underwritingAgreements"],
  lockupRegistrationRights: S1F1ExhibitExtractions["lockupRegistrationRights"],
  adsDepositAgreement: S1F1ExhibitExtractions["adsDepositAgreement"],
  legalOpinionsConsents: S1F1ExhibitExtractions["legalOpinionsConsents"],
  filingFeeExhibits: S1F1ExhibitExtractions["filingFeeExhibits"],
): S1F1ExhibitExtractions["consistencyHints"] {
  const hints: S1F1ExhibitExtractions["consistencyHints"] = [];
  const attachmentNames = attachedExhibits.map((item) => `${item.filename ?? ""} ${item.description ?? ""} ${item.type ?? ""}`.toLowerCase());
  for (const item of exhibitIndex.items) {
    if (item.statusFlags.includes("incorporated_by_reference") || item.statusFlags.includes("to_be_filed_by_amendment")) continue;
    const key = `${item.filename ?? ""} ${item.title}`.toLowerCase();
    if (key && !attachmentNames.some((name) => name.includes((item.filename ?? "").toLowerCase()) || name.includes(item.title.toLowerCase().slice(0, 24)))) {
      hints.push({ label: "exhibit_index_row_without_matching_attachment", evidence: item.evidence, confidence: "low" });
    }
  }
  for (const item of attachedExhibits) {
    const key = `${item.filename ?? ""} ${item.description ?? ""}`.toLowerCase();
    if (exhibitIndex.items.length && !exhibitIndex.items.some((indexItem) => key.includes((indexItem.filename ?? "").toLowerCase()) || key.includes(indexItem.title.toLowerCase().slice(0, 24)))) {
      hints.push({ label: "attachment_without_matching_exhibit_index_row", evidence: item.evidence, confidence: "low" });
    }
    for (const warning of item.disagreementWarnings) hints.push({ label: "exhibit_title_document_type_disagreement", evidence: warning, confidence: "low" });
  }
  if (adsDepositAgreement.adsDetected && adsDepositAgreement.depositAgreementDocuments.length === 0) hints.push({ label: "ads_without_deposit_agreement_hint", evidence: "ADS language detected without matched deposit agreement evidence.", confidence: "low" });
  if (underwritingAgreements.sectionDetected && underwritingAgreements.agreementDocuments.length === 0) hints.push({ label: "underwriting_section_without_underwriting_exhibit_hint", evidence: "Underwriting or Plan of Distribution section detected without matched underwriting-type exhibit.", confidence: "low" });
  if (lockupRegistrationRights.registrationRightsLanguage.length && lockupRegistrationRights.registrationRightsDocuments.length === 0) hints.push({ label: "registration_rights_without_exhibit_hint", evidence: lockupRegistrationRights.registrationRightsLanguage[0].evidence, confidence: "low" });
  if (materialContracts.contractTypeCandidates.length && materialContracts.contractDocuments.length === 0) hints.push({ label: "material_contract_discussion_without_exhibit_hint", evidence: materialContracts.contractTypeCandidates[0].evidence, confidence: "low" });
  if (exhibitIndex.items.some((item) => item.family === "filing_fee") && filingFeeExhibits.documents.length === 0) hints.push({ label: "filing_fee_exhibit_referenced_not_found", evidence: "Filing fee exhibit referenced in index but no attached filing-fee document was matched.", confidence: "low" });
  if (exhibitIndex.items.some((item) => item.family === "legal_opinion") && legalOpinionsConsents.legalOpinionDocuments.length === 0) hints.push({ label: "legal_opinion_exhibit_referenced_not_found", evidence: "Legal opinion exhibit referenced in index but no attached legal-opinion document was matched.", confidence: "low" });
  if (exhibitIndex.items.some((item) => item.family === "consents") && legalOpinionsConsents.consentDocuments.length === 0) hints.push({ label: "consent_exhibit_referenced_not_found", evidence: "Consent exhibit referenced in index but no attached consent document was matched.", confidence: "low" });
  return hints.slice(0, 40);
}

function extractExhibitExtractions(
  text: string,
  input: S1F1ParserInput,
  filterSummary: S1F1DocumentFilterSummary,
  sectionDetection: S1F1SectionDetection,
  documentTables: S1F1DocumentTable[],
): S1F1ExhibitExtractions {
  const exhibitIndex = extractExhibitIndex(text, sectionDetection, documentTables);
  const attachedExhibits = extractAttachedExhibits(input, filterSummary);
  const materialContracts = extractMaterialContracts(attachedExhibits, exhibitIndex);
  const underwritingAgreements = extractUnderwritingAgreementEvidence(text, sectionDetection, attachedExhibits);
  const lockupRegistrationRights = extractLockupRegistrationRights(text, sectionDetection, attachedExhibits);
  const adsDepositAgreement = extractAdsDepositAgreement(text, sectionDetection, attachedExhibits);
  const legalOpinionsConsents = extractLegalOpinionConsent(text, sectionDetection, attachedExhibits);
  const filingFeeExhibits = extractFilingFeeExhibits(sectionDetection, documentTables, attachedExhibits, exhibitIndex);
  const consistencyHints = buildExhibitConsistencyHints(
    exhibitIndex,
    attachedExhibits,
    materialContracts,
    underwritingAgreements,
    lockupRegistrationRights,
    adsDepositAgreement,
    legalOpinionsConsents,
    filingFeeExhibits,
  );
  const warnings = [
    ...exhibitIndex.warnings,
    ...attachedExhibits.flatMap((item) => item.disagreementWarnings),
    ...materialContracts.warnings,
    ...underwritingAgreements.warnings,
    ...lockupRegistrationRights.warnings,
    ...adsDepositAgreement.warnings,
    ...legalOpinionsConsents.warnings,
    ...filingFeeExhibits.warnings,
  ];
  return {
    exhibitIndex,
    attachedExhibits,
    materialContracts,
    underwritingAgreements,
    lockupRegistrationRights,
    adsDepositAgreement,
    legalOpinionsConsents,
    filingFeeExhibits,
    consistencyHints,
    warnings,
  };
}

function firstCandidateValue(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compact(match[1]);
  }
  return null;
}

function firstCandidateEvidence(text: string, patterns: RegExp[], label: string): S1F1Evidence | null {
  for (const pattern of patterns) {
    const evidence = evidenceFor(text, pattern, label);
    if (evidence) return evidence;
  }
  return null;
}

function cleanSpacTargetCandidate(value: string): string | null {
  let candidate = compact(value)
    .replace(/\s+(?:The|Expected|Redemption|Minimum|PIPE|Backstop|Trust|Public)\b.*$/i, "")
    .replace(/[.;:,]+$/g, "")
    .trim();
  if (/\b(?:has|have|been|selected|identified|chosen|announced)\b/i.test(candidate) && !/\b(?:Inc|Corp|Corporation|Ltd|Limited|LLC|PLC|S\.A\.|N\.V\.)\b/i.test(candidate)) {
    return null;
  }
  if (/^(?:has|have|been|selected|no|none|not|a|an|the)\b/i.test(candidate)) return null;
  const entitySuffixMatch = candidate.match(
    /^(.{2,90}?\b(?:Inc|Corp|Corporation|Ltd|Limited|LLC|PLC|S\.A\.|N\.V\.))(?:\b|$)/i,
  );
  if (entitySuffixMatch?.[1]) {
    candidate = entitySuffixMatch[1].replace(/[.;:,]+$/g, "").trim();
  }
  return candidate.length >= 2 ? candidate : null;
}

function firstSpacTargetCompany(text: string): string | null {
  const patterns = [
    /business combination (?:with|between|agreement with)\s+([^.\n]{2,180})/i,
    /target company\s*(?:is|:)\s*([^.\n]{2,180})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const candidate = cleanSpacTargetCandidate(match[1]);
    if (candidate) return candidate;
  }
  return null;
}

function extractSpacTransactionStatus(text: string): S1F1SpacTransactionStatusFacts {
  const hasBlankCheckIpo = /initial public offering[^.\n]{0,240}?(?:blank check company|special purpose acquisition company|\bSPAC\b)|(?:blank check company|special purpose acquisition company|\bSPAC\b)[^.\n]{0,240}?initial public offering/i.test(text);
  const targetCompany = firstSpacTargetCompany(text);
  const transactionStatusEvidence =
    /redemption result|redemption rate|minimum cash condition|cash waiver|PIPE|backstop|expected closing date|ticker change|trust cash (?:before|after)|public shares remaining/i.test(
      text,
    ) || /de-?SPAC[^.\n]{0,180}?(?:closing|transaction|business combination|redemption|ticker)/i.test(text);
  const hasStatusEvidence = Boolean(targetCompany) || transactionStatusEvidence;
  const statusDetected = hasStatusEvidence && !(hasBlankCheckIpo && !targetCompany && !transactionStatusEvidence);
  const sources = [
    firstCandidateEvidence(text, [/business combination[^.\n]{0,240}/i], "SPAC business combination status"),
    firstCandidateEvidence(text, [/redemption (?:result|rate)[^.\n]{0,220}/i], "SPAC redemption status"),
    firstCandidateEvidence(text, [/minimum cash condition[^.\n]{0,220}/i], "SPAC minimum cash condition"),
    firstCandidateEvidence(text, [/ticker change[^.\n]{0,220}|expected ticker[^.\n]{0,220}/i], "SPAC ticker status"),
  ].filter((item): item is S1F1Evidence => Boolean(item));
  const expectedTicker = firstCandidateValue(text, [
    /expected ticker\s*(?:symbol)?\s*(?:is|will be|:)?\s*["']?([A-Z][A-Z0-9.-]{1,9})/i,
    /trade under the symbol\s*["']?([A-Z][A-Z0-9.-]{1,9})/i,
  ])?.replace(/[.;:,]+$/g, "") ?? null;
  const closingDate = firstCandidateValue(text, [/(expected closing date[^.\n]{0,160})/i, /(closing is expected[^.\n]{0,160})/i]);
  const redemptionRate = firstCandidateValue(text, [/(redemption rate[^.\n]{0,120}?(?:[0-9.]+%|[0-9][0-9,.]* shares?))/i]);
  const minCashCondition = firstCandidateValue(text, [/(minimum cash condition[^.\n]{0,180})/i]);
  const pipe = firstCandidateValue(text, [/(PIPE[^.\n]{0,180})/i]);
  const backstop = firstCandidateValue(text, [/(backstop[^.\n]{0,180})/i]);

  return {
    statusDetected,
    current_stage: statusDetected ? "transaction_status_update" : null,
    current_stage_label: statusDetected ? "SPAC/de-SPAC transaction status" : null,
    deal_status: firstCandidateValue(text, [/(business combination[^.\n]{0,180})/i, /(de-?SPAC[^.\n]{0,180})/i]),
    stage_summary: statusDetected ? compact(sources[0]?.excerpt ?? "SPAC/de-SPAC transaction-status facts detected.") : null,
    stages: statusDetected ? ["announced", ...(closingDate ? ["closing_expected"] : []), ...(redemptionRate ? ["redemption_disclosed"] : [])] : [],
    target_company: targetCompany,
    target_summary: targetCompany ? `Target company identified as ${targetCompany}.` : null,
    expected_ticker: expectedTicker,
    deal_value: firstCandidateValue(text, [/(deal value[^.\n]{0,120}?\$[0-9][0-9,.]*(?:\s*(?:million|billion))?)/i]),
    announced_date: firstCandidateValue(text, [/(announced (?:on )?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})/i]),
    sponsor: firstCandidateValue(text, [/(sponsor[^.\n]{0,120})/i]),
    ipo_date: firstCandidateValue(text, [/(IPO date[^.\n]{0,120})/i]),
    ipo_year: firstCandidateValue(text, [/\bIPO(?: was)? (?:completed )?in (20\d{2})/i]),
    unit_right_warrant_terms: firstCandidateValue(text, [/(units?[^.\n]{0,160}?(?:warrants?|rights)[^.\n]{0,160})/i]),
    redemption_rate: redemptionRate,
    trust_cash_before: firstCandidateValue(text, [/(trust cash before[^.\n]{0,140}?\$[0-9][0-9,.]*(?:\s*(?:million|billion))?)/i]),
    trust_cash_after: firstCandidateValue(text, [/(trust cash after[^.\n]{0,140}?\$[0-9][0-9,.]*(?:\s*(?:million|billion))?)/i]),
    redemption_price: firstCandidateValue(text, [/(redemption price[^.\n]{0,120}?\$[0-9][0-9,.]*)/i]),
    public_shares_remaining: firstCandidateValue(text, [/(public shares remaining[^.\n]{0,120}?[0-9][0-9,.]*)/i]),
    min_cash_condition: minCashCondition,
    min_cash_status: firstCandidateValue(text, [/(minimum cash condition[^.\n]{0,120}?(?:satisfied|waived|not satisfied)[^.\n]{0,80})/i]),
    float_impact: firstCandidateValue(text, [/(float impact[^.\n]{0,180})/i]),
    closing_date: closingDate,
    ticker_change_date: firstCandidateValue(text, [/(ticker change date[^.\n]{0,160})/i]),
    risk_flags: [minCashCondition ? "minimum_cash_condition" : null, pipe ? "pipe" : null, backstop ? "backstop" : null, redemptionRate ? "redemption" : null].filter((item): item is string => Boolean(item)),
    watch_next: statusDetected ? ["Track closing conditions, redemptions, financing updates, and ticker-change timing."] : [],
    sources,
    event_history: sources.map((item) => item.excerpt),
    warnings: hasBlankCheckIpo && !statusDetected ? ["Blank-check/SPAC IPO language alone is not treated as de-SPAC transaction status."] : [],
  };
}

function makeSignal(
  event_type: SecEventType,
  label: string,
  severity: S1F1Signal["severity"],
  signal: S1F1Signal["signal"],
  evidence: Array<S1F1Evidence | null>,
  deterministic = false,
): S1F1Signal {
  return {
    event_type,
    label,
    severity,
    signal,
    evidence: evidence.filter((item): item is S1F1Evidence => Boolean(item)),
    ...(deterministic ? { deterministic: true } : {}),
  };
}

function rankSignals(signals: S1F1Signal[]): S1F1Signal[] {
  const severityRank = { high: 0, medium: 1, low: 2 };
  return [...signals].sort((a, b) => {
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return SIGNAL_PRIORITY.indexOf(a.event_type) - SIGNAL_PRIORITY.indexOf(b.event_type);
  });
}

function buildSignals(text: string, facts: S1F1Facts): S1F1Signal[] {
  const signals: S1F1Signal[] = [];
  const offeringEvidence =
    evidenceFor(text, /(?:we are offering|resale of|selling stockholders?|gross proceeds|offering size)[^.]{0,220}/i, "Offering terms") ??
    (facts.offering.gross_proceeds != null
      ? metadataEvidence("Offering terms", `Gross proceeds: ${facts.offering.gross_proceeds}`)
      : null);

  if (facts.filing.post_effective_purpose === "deregistration") {
    signals.push(
      makeSignal(
        "other",
        "Post-effective amendment deregisters unsold securities",
        "low",
        "neutral",
        [
          evidenceFor(
            text,
            /deregister(?:s|ing)?[^.\n]{0,140}?unsold|unsold[^.\n]{0,140}?deregister|remove from registration[^.\n]{0,140}?unsold|terminate(?:s|d)?[^.\n]{0,120}?offering/i,
            "Deregistration of unsold securities",
          ),
        ],
        true,
      ),
    );
    return rankSignals(signals);
  }

  if (facts.filing.post_effective_purpose === "limited_update") {
    signals.push(
      makeSignal(
        "other",
        "Post-effective amendment makes a limited administrative update",
        "low",
        "neutral",
        [
          evidenceFor(
            text,
            /no additional securities (?:are being |will be )?registered|solely[^.\n]{0,120}?(?:file exhibits|update[^.\n]{0,60}?experts|experts section)|prospectus[^.\n]{0,80}?omitted/i,
            "Limited post-effective update",
          ),
        ],
        true,
      ),
    );
    return rankSignals(signals);
  }

  if (facts.filing.filing_variant === "rule_462b_mef") {
    signals.push(
      makeSignal("other", "Rule 462(b) MEF add-on registration", "low", "neutral", [
        evidenceFor(text, /Rule 462\(b\)[^.\n]*/i, "Rule 462(b) registration"),
      ]),
    );
    return rankSignals(signals);
  }

  if (facts.amendment.routine_or_administrative) {
    signals.push(
      makeSignal(
        "other",
        "Routine administrative amendment",
        "low",
        "neutral",
        [evidenceFor(text, /solely to file exhibits|no material changes?|no other changes?|administrative update|signature page|exhibit-only/i, "Routine amendment")],
        true,
      ),
    );
    return rankSignals(signals);
  }

  if (facts.risks.listing_risk) {
    signals.push(
      makeSignal("listing_risk", "Listing-standard or delisting risk disclosed", "high", "bearish", [
        evidenceFor(
          text,
          /minimum bid|continued listing|Nasdaq deficiency|NYSE deficiency|does not currently satisfy (?:Nasdaq|NYSE|NYSE American|continued listing)[^.\n]*/i,
          "Listing risk",
        ),
      ]),
    );
  }

  if (facts.risks.going_concern) {
    signals.push(
      makeSignal("financial_risk", "Going-concern or liquidity risk disclosed", "high", "bearish", [
        evidenceFor(text, /going concern|substantial doubt about (?:our|the company's) ability to continue|cash runway|insufficient liquidity[^.\n]*/i, "Financial risk"),
      ]),
    );
  }

  if (facts.offering.kind === "resale" || facts.offering.kind === "mixed" || facts.offering.kind === "primary") {
    const contextMakesSevere =
      (facts.market_context_summary.offering_to_market_cap_pct ?? 0) >= 15 ||
      (facts.market_context_summary.shares_to_float_pct ?? 0) >= 20;
    signals.push(
      makeSignal(
        "dilution_risk",
        facts.offering.kind === "resale" ? "Resale registration may pressure float" : "Primary or mixed offering may dilute holders",
        contextMakesSevere ? "high" : "medium",
        contextMakesSevere ? "bearish" : "volatile",
        [offeringEvidence],
      ),
    );
  }

  if (facts.offering.kind === "ipo") {
    signals.push(
      makeSignal("ipo_listing", "IPO or new listing registration filed", "medium", "neutral", [
        evidenceFor(text, /initial public offering|proposed public offering|no public market currently exists[^.\n]*/i, "IPO registration"),
      ]),
    );
  }

  if (facts.risks.legal_risk) {
    signals.push(
      makeSignal("legal_risk", "Material litigation or investigation disclosed", "medium", "bearish", [
        evidenceFor(
          text,
          /material legal proceedings?|pending litigation|pending lawsuits?|SEC investigation|subpoena|Holding Foreign Companies Accountable Act|\bHFCAA\b|variable interest entit(?:y|ies)|\bVIEs?\b|PCAOB[^.\n]{0,180}?(?:unable to inspect|inspect our auditor|trading[^.\n]{0,80}?prohibit|prohibit[^.\n]{0,80}?trading)[^.\n]*/i,
          "Legal risk",
        ),
      ]),
    );
  }

  if (facts.risks.fda_or_clinical) {
    signals.push(
      makeSignal("fda_clinical", "FDA or clinical development information disclosed", "medium", "volatile", [
        evidenceFor(
          text,
          /clinical trial|Phase\s+(?:1|2|3|I|II|III)|\b(?:IND|NDA|BLA|PDUFA)\b|trial results?|patient enrollment|\b510\(k\)\b|premarket approval[^.\n]*/i,
          "FDA or clinical",
        ),
      ]),
    );
  }

  if (facts.risks.strategic_transaction) {
    signals.push(
      makeSignal("strategic_transaction", "Strategic transaction context disclosed", "medium", "volatile", [
        evidenceFor(
          text,
          /merger agreement|business combination (?:agreement|with)|de-?SPAC|reverse merger|reorganization agreement|asset purchase agreement|redemption result|minimum cash condition|ticker change[^.\n]*/i,
          "Strategic transaction",
        ),
      ]),
    );
  }

  if (facts.risks.insider_control) {
    signals.push(
      makeSignal("insider_ownership", "Insider or controlling-holder ownership disclosed", "medium", "neutral", [
        evidenceFor(
          text,
          /controlled company|will control[^.\n]{0,160}?(?:voting power|shares|stock)|majority of (?:the )?voting power[^.\n]*/i,
          "Insider ownership",
        ),
      ]),
    );
  }

  if (signals.length === 0) {
    signals.push(makeSignal("other", "No high-specificity S-1/F-1 signal found", "low", "neutral", []));
  }

  return rankSignals(signals);
}

function extractCalendarItems(text: string): S1F1CalendarItem[] {
  const items: S1F1CalendarItem[] = [];
  const pricingEvidence = evidenceFor(
    text,
    /(?:expected to price|anticipated pricing date|pricing is expected)\s*(?:on|:)?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/i,
    "Expected pricing date",
  );
  const pricingDate = pricingEvidence?.excerpt.match(/([A-Z][a-z]+ \d{1,2}, \d{4}|\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (pricingEvidence) {
    items.push({
      label: "Expected offering pricing",
      date: pricingDate,
      evidence: [pricingEvidence],
    });
  }
  return items;
}

function buildWarnings(input: S1F1ParserInput, facts: S1F1Facts): string[] {
  const warnings: string[] = [];
  const reportedFormType = normalizeFormType(input.formType);
  if (!SUPPORTED_FORMS.has(reportedFormType)) {
    warnings.push(`Unsupported form type for S-1/F-1 room: ${input.formType}`);
  }
  if (facts.filing.boundary_case) {
    warnings.push(
      `${facts.filing.reported_form_type} is a boundary filing variant; keep it separate from ordinary S-1/F-1 base or pre-effective amendment handling.`,
    );
  }
  if (facts.filing.parent_context_needed) {
    warnings.push("Parent registration context may be needed; no live DB lookup was used.");
  }
  if (
    facts.filing.filing_variant === "pre_effective_amendment" &&
    !facts.amendment.parent_context_provided &&
    !facts.amendment.routine_or_administrative
  ) {
    warnings.push("Amendment materiality may need parent filing fixture context; no live DB lookup was used.");
  }
  if (
    !facts.filing.boundary_case &&
    facts.offering.kind !== "unknown" &&
    facts.offering.kind !== "ipo" &&
    facts.market_context_summary.provided === false
  ) {
    warnings.push("Market context fixture may be useful to scale offering size against market cap or public float.");
  }
  return warnings;
}

function clipSourceBlockText(value: string, maxLength = 10000): string {
  const text = compact(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

const PRIORITY_SOURCE_CONTEXTS: Array<{
  sectionKey: string;
  sectionTitle: string;
  patterns: RegExp[];
  excludePatterns?: RegExp[];
  maxBlocks?: number;
  window?: {
    before?: number;
    after?: number;
    alignToLines?: boolean;
  };
}> = [
  {
    sectionKey: "concurrent_private_placement_context",
    sectionTitle: "Concurrent private placement source context",
    patterns: [
      /\bwe\s+will\s+issue\s+up\s+to\s+[0-9][0-9,]*\s+shares[^.\n]{0,260}\bSeries\s+C\s+Warrants?\b[^.\n]{0,260}\bSeries\s+D\s+Warrants?\b/i,
      /\bSeries\s+C\s+Warrants?\b[^.\n]{0,600}\bSeries\s+D\s+Warrants?\b/i,
    ],
    maxBlocks: 1,
    window: {
      before: 300,
      after: 1_600,
      alignToLines: false,
    },
  },
  {
    sectionKey: "share_count_basis_context",
    sectionTitle: "Share count basis source context",
    patterns: [
      /\bshares?\s+of\s+(?:Class\s+[A-Z]\s+)?(?:common stock|ordinary shares|ADSs?)\s+outstanding\s+(?:prior to|before|immediately prior to|as of|after|assuming)/i,
      /\b(?:Class\s+[A-Z]\s+)?(?:common stock|ordinary shares|ADSs?)\s+(?:outstanding|issued and outstanding)\s+(?:prior to|before|immediately prior to|as of|after|assuming)/i,
      /\b(?:shares outstanding|common stock outstanding|ordinary shares outstanding|ADSs? outstanding)\s+(?:prior to|before|immediately prior to|as of|after|assuming)/i,
      /\bshares?\s+outstanding\s+(?:prior to|before|immediately prior to|as of|after|assuming)/i,
      /\boutstanding\s+(?:prior to|before|immediately prior to|as of|after|assuming)\s+(?:this|the)\s+(?:offering|resale|transaction|conversion)/i,
      /\b(?:Ordinary Shares|Shares)\b[^.\n]{0,220}\bClass\s+A\s+Ordinary Shares\b[^.\n]{0,220}\bClass\s+B\s+Ordinary Shares\b/i,
      /\b[0-9][0-9,]*\s+Ordinary Shares\b[^.\n]{0,260}\bincluding\b[^.\n]{0,180}\b[0-9][0-9,]*\s+Class\s+A\s+Ordinary Shares\b[^.\n]{0,180}\b[0-9][0-9,]*\s+Class\s+B\s+Ordinary Shares\b/i,
    ],
    window: {
      before: 80,
      after: 1_800,
      alignToLines: false,
    },
  },
  {
    sectionKey: "instrument_supply_context",
    sectionTitle: "Instrument supply source context",
    patterns: [
      /\bClass\s+[A-Z]\s+Ordinary Shares\s+Underlying\s+the\s+Series\s+[A-Z]\s+Warrants\b/i,
      /\b(?:shares|ordinary shares|ADSs?|common stock|Class\s+[A-Z]\s+Ordinary Shares)\s+Underlying\s+the\s+(?:Series\s+[A-Z]\s+)?(?:Warrants?|Pre-Funded Warrants?|Options?|Convertible Notes?)/i,
      /\bzero exercise price\b/i,
      /\bFloor Price\b/i,
      /\bReset Date\b/i,
    ],
    window: {
      before: 900,
      after: 3_000,
      alignToLines: false,
    },
  },
  {
    sectionKey: "instrument_term_context",
    sectionTitle: "Instrument term source context",
    patterns: [
      /\b(?:placement\s+agent|underwriter|agent|representative)\s+warrants?\b/i,
      /\b(?:common|ordinary|pre[-\s]?funded|placement\s+agent|underwriter|agent|representative|Series\s+[A-Z])\s+warrants?\b[^.\n]{0,260}\b(?:exercise\s+price|exercisable|expires?|expiration|term|cashless|beneficial\s+ownership|ownership\s+limitation)\b/i,
      /\b(?:exercise\s+price|exercisable|expires?|expiration|cashless\s+exercise|beneficial\s+ownership\s+limitation)\b[^.\n]{0,260}\b(?:warrants?|pre[-\s]?funded)\b/i,
    ],
    maxBlocks: 2,
    window: {
      before: 700,
      after: 2_800,
      alignToLines: false,
    },
  },
  {
    sectionKey: "placement_agent_warrant_term_context",
    sectionTitle: "Placement agent warrant term source context",
    patterns: [
      /\bplacement\s+agent\s+warrants?\b[\s\S]{0,900}\b(?:immediately\s+exercisable|exercisable\s+immediately|commencement\s+of\s+sales|five[-\s]?year|5[-\s]?year|exercise\s+price)\b/i,
      /\b(?:immediately\s+exercisable|exercisable\s+immediately|commencement\s+of\s+sales|five[-\s]?year|5[-\s]?year|exercise\s+price)\b[\s\S]{0,900}\bplacement\s+agent\s+warrants?\b/i,
    ],
    maxBlocks: 2,
    window: {
      before: 700,
      after: 2_400,
      alignToLines: false,
    },
  },
  {
    sectionKey: "instrument_reset_floor_context",
    sectionTitle: "Instrument reset/floor source context",
    patterns: [
      /\b(?:reset|repric(?:e|ed|es|ing)|anti[-\s]?dilution|adjust(?:ed|ment)?\s+(?:exercise|conversion)\s+price|(?:exercise|conversion)\s+price\s+adjust(?:ed|ment)?)\b/i,
      /\b(?:floor\s+price|price\s+floor|minimum\s+(?:exercise|conversion|purchase|offering|VWAP)?\s*price|minimum\s+VWAP)\b/i,
      /\b(?:VWAP|volume[-\s]?weighted\s+average\s+price|Event\s+Market\s+Price|Alternate\s+Conversion\s+Price|Nasdaq\s+Minimum\s+Price|Minimum\s+Price)\b/i,
      /\b(?:zero\s+exercise\s+price|nominal\s+exercise\s+price|cashless\s+exercise)\b/i,
    ],
    excludePatterns: [
      /\b(?:we|company|issuer)\s+have\s+agreed\s+to\s+not\s+issue\s+any\s+securities\s+that\s+are\s+subject\s+to\s+a\s+price\s+reset\b/i,
    ],
    maxBlocks: 2,
    window: {
      before: 800,
      after: 2_600,
      alignToLines: false,
    },
  },
  {
    sectionKey: "underwriting_context",
    sectionTitle: "Underwriting source context",
    patterns: [
      /\brepresentatives? of the underwriters?\b/i,
      /\bacting as representatives\b/i,
      /\bbook-?running managers?\b/i,
      /\blead underwriters?\b/i,
      /\bunderwriting discounts? and commissions?\b/i,
      /\bfirm commitment\b/i,
      /\bover-?allotment option\b/i,
      /\bunderwriters?\b/i,
      /\bunderwriting\b/i,
    ],
  },
  {
    sectionKey: "resale_equity_line_context",
    sectionTitle: "Resale and equity line source context",
    patterns: [
      /\bcommitted equity facility\b/i,
      /\bequity line\b/i,
      /\bSEPA\b/i,
      /\bstandby equity purchase agreement\b/i,
      /\bcommon stock purchase agreement\b/i,
      /\bpurchase agreement\b/i,
      /\bregistration rights agreement\b/i,
      /\bup to\s+\$[0-9][0-9,.]*(?:\s*(?:million|billion))?\b/i,
      /\bresale by\b/i,
      /\bselling stockholders?\b/i,
      /\bwill not receive any (?:of the )?proceeds\b/i,
    ],
  },
  {
    sectionKey: "issuance_limit_context",
    sectionTitle: "Issuance limit and denominator source context",
    patterns: [
      /\bexchange cap\b/i,
      /\b19\.99%\b/i,
      /\bshareholder approval\b/i,
      /\bminimum purchase price threshold\b/i,
      /\bClass A Common Stock Outstanding\b/i,
      /\bshares outstanding prior to\b/i,
      /\bshares outstanding immediately prior\b/i,
      /\boutstanding prior to the commencement\b/i,
      /\boutstanding immediately prior to the execution\b/i,
    ],
  },
];

function regexWithGlobal(pattern: RegExp): RegExp {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function sourceWindow(
  text: string,
  index: number,
  before = 1000,
  after = 5000,
  alignToLines = true,
): { start: number; end: number } {
  const roughStart = Math.max(0, index - before);
  const roughEnd = Math.min(text.length, index + after);
  if (!alignToLines) {
    return {
      start: roughStart,
      end: roughEnd,
    };
  }
  const lineStart = text.lastIndexOf("\n", roughStart);
  const nextLineEnd = text.indexOf("\n", roughEnd);
  return {
    start: lineStart >= 0 ? lineStart + 1 : roughStart,
    end: nextLineEnd >= 0 ? nextLineEnd : roughEnd,
  };
}

function collectPrioritySourceBlocks(text: string): NonNullable<S1F1ParserOutput["raw"]["cleanedSourceBlocks"]> {
  const blocks: NonNullable<S1F1ParserOutput["raw"]["cleanedSourceBlocks"]> = [];

  for (const context of PRIORITY_SOURCE_CONTEXTS) {
    const ranges: Array<{ start: number; end: number }> = [];
    for (const pattern of context.patterns) {
      const regex = regexWithGlobal(pattern);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const range = sourceWindow(
          text,
          match.index,
          context.window?.before ?? 1000,
          context.window?.after ?? 5000,
          context.window?.alignToLines ?? true,
        );
        const overlapping = ranges.find((item) => range.start <= item.end && range.end >= item.start);
        if (overlapping) {
          overlapping.start = Math.min(overlapping.start, range.start);
          overlapping.end = Math.max(overlapping.end, range.end);
        } else {
          ranges.push(range);
        }
        if (ranges.length >= 4) break;
      }
      if (ranges.length >= 4) break;
    }

    ranges
      .sort((a, b) => a.start - b.start)
      .slice(0, context.maxBlocks ?? 3)
      .forEach((range, index) => {
        const snippet = clipSourceBlockText(text.slice(range.start, range.end), 9000);
        if (!snippet) return;
        if (context.excludePatterns?.some((pattern) => pattern.test(snippet))) return;
        blocks.push({
          source: "primary",
          sectionKey: `${context.sectionKey}_${index + 1}`,
          sectionTitle: context.sectionTitle,
          documentName: null,
          text: snippet,
          tables: [],
        });
      });
  }

  return blocks;
}

function collectCurrentOfferingSidePlacementSourceBlocks(
  text: string,
): NonNullable<S1F1ParserOutput["raw"]["cleanedSourceBlocks"]> {
  const patterns = [
    /\bconcurrent\s+private\s+placement\b/i,
    /\bSeries\s+C\s+Warrants?\b[^.\n]{0,700}\bSeries\s+D\s+Warrants?\b/i,
    /\bwe\s+will\s+issue\s+up\s+to\s+[0-9][0-9,]*\s+shares[^.\n]{0,700}\bSeries\s+[A-Z](?:\s+and\s+Series\s+[A-Z])?\s+Warrants?\b/i,
    /\bVRT Prohibition\b/i,
    /\bwaiver\b[^.\n]{0,300}\bwarrants?\b/i,
  ];
  const ranges: Array<{ start: number; end: number }> = [];

  for (const pattern of patterns) {
    const regex = regexWithGlobal(pattern);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const range = sourceWindow(text, match.index, 500, 1_900, false);
      const overlapping = ranges.find((item) => range.start <= item.end && range.end >= item.start);
      if (overlapping) {
        overlapping.start = Math.min(overlapping.start, range.start);
        overlapping.end = Math.max(overlapping.end, range.end);
      } else {
        ranges.push(range);
      }
      if (ranges.length >= 3) break;
    }
    if (ranges.length >= 3) break;
  }

  const excerpts = ranges
    .sort((a, b) => a.start - b.start)
    .slice(0, 2)
    .map((range) => clipSourceBlockText(text.slice(range.start, range.end), 2_500))
    .filter(Boolean);

  if (!excerpts.length) return [];

  return [
    {
      source: "primary",
      sectionKey: "current_offering_side_placement_source_1",
      sectionTitle: "Current offering side-placement source excerpts",
      documentName: null,
      text: excerpts.join("\n\n---\n\n"),
      tables: [],
    },
  ];
}

function buildCleanedSourceBlocks(
  text: string,
  input: S1F1ParserInput,
  sectionDetection: S1F1SectionDetection,
): NonNullable<S1F1ParserOutput["raw"]["cleanedSourceBlocks"]> {
  const sections = [...sectionDetection.sections]
    .filter((section) => !section.tocHint && !section.insideTable)
    .sort((a, b) => a.lineIndex - b.lineIndex)
    .slice(0, 48);
  const firstSectionLine = sections[0]?.lineIndex ?? 80;
  const frontMatter = text.split("\n").slice(0, Math.max(20, Math.min(firstSectionLine, 220))).join("\n");
  const blocks: NonNullable<S1F1ParserOutput["raw"]["cleanedSourceBlocks"]> = [];

  if (compact(frontMatter)) {
    blocks.push({
      source: "primary",
      sectionKey: "front_matter",
      sectionTitle: "Front matter",
      documentName: null,
      text: clipSourceBlockText(frontMatter, 12000),
      tables: [],
    });
  }

  blocks.push(...collectCurrentOfferingSidePlacementSourceBlocks(text));
  blocks.push(...collectPrioritySourceBlocks(text));

  for (const section of sections) {
    const body = sectionText(text, sectionDetection, section.key);
    const tables = (sectionDetection.tables ?? [])
      .filter((table) => table.sectionKey === section.key)
      .map((table) => clipSourceBlockText(table.text, 5000))
      .slice(0, 6);
    if (!compact(body) && tables.length === 0) continue;
    blocks.push({
      source: "primary",
      sectionKey: section.key,
      sectionTitle: section.title,
      documentName: null,
      text: clipSourceBlockText(body),
      tables,
    });
  }

  for (const attachment of input.attachments ?? []) {
    const textBody = clipSourceBlockText(attachment.text ?? "", 8000);
    if (!textBody) continue;
    blocks.push({
      source: "attachment",
      sectionKey: null,
      sectionTitle: attachment.description ?? null,
      documentName: attachment.name,
      text: textBody,
      tables: [],
    });
  }

  return blocks.slice(0, 60);
}

export function parseS1F1Filing(input: S1F1ParserInput): S1F1ParserOutput {
  const filteredSubmission = filterS1F1SubmissionText(input.filingText, { formType: input.formType });
  const text = normalizeText(filteredSubmission.text);
  const documentBlocks = filteredSubmission.summary.blocks ?? [];
  const documentTables = filteredSubmission.summary.tables ?? [];
  const sectionDetection = attachTablesToSections(detectS1F1Sections(text, documentBlocks), documentTables);
  const cleanedSourceBlocks = buildCleanedSourceBlocks(text, input, sectionDetection);
  const riskFactors = detectRiskFactorsStructure(text, sectionDetection, documentBlocks);
  const foreignIssuerPhraseHits = detectForeignIssuerPhraseHits(text);
  const sectionExtractions = extractSectionExtractions(text, input, sectionDetection, documentTables);
  const financialExtractions = extractFinancialExtractions(text, sectionDetection, documentTables);
  const governanceExtractions = extractGovernanceExtractions(
    text,
    sectionDetection,
    documentTables,
    financialExtractions,
    sectionExtractions,
  );
  const exhibitExtractions = extractExhibitExtractions(text, input, filteredSubmission.summary, sectionDetection, documentTables);
  const spacTransactionStatus = extractSpacTransactionStatus(text);
  const filing = extractFilingFacts(text, input);
  const offering = extractOfferingFacts(text, input);
  const amendment = extractAmendmentFacts(text, input);
  const foreignIssuer = extractForeignIssuerFacts(text, input);
  const risks = extractRisks(text);
  const marketContextSummary = summarizeMarketContext(offering, input.marketContext);
  const facts: S1F1Facts = {
    filing,
    company_name: extractCompanyName(text, input),
    ticker: extractTicker(text, input),
    exchange: extractExchange(text, input),
    registration_kind: offering.kind,
    offering,
    amendment,
    foreign_issuer: foreignIssuer,
    risks,
    market_context_summary: marketContextSummary,
  };
  const signals = buildSignals(text, facts);
  const calendarItems = extractCalendarItems(text);
  const warnings = [
    ...buildWarnings(input, facts),
    ...(filteredSubmission.summary.warnings ?? []),
    ...sectionDetection.warnings,
  ];
  const reportedFormType = normalizeFormType(input.formType);

  return {
    parserVersion: S1F1_PARSER_VERSION,
    parserGroup: S1F1_PARSER_GROUP,
    formType: S1F1_ROOM_FORM_SCOPE,
    accessionNumber: input.accessionNumber ?? null,
    isSupported: SUPPORTED_FORMS.has(reportedFormType),
    summary: `${reportedFormType} parsed for ${facts.company_name ?? "unknown issuer"}; variant: ${
      facts.filing.filing_variant
    }; registration kind: ${facts.registration_kind}; ${signals.length} signal(s) detected.`,
    facts,
    signals,
    calendarItems,
    warnings,
    raw: {
      sourceTextLength: input.filingText.length,
      attachmentNames: input.attachments?.map((attachment) => attachment.name) ?? [],
      documentFilter: filteredSubmission.summary,
      cleanedSourceBlocks,
      sectionDetection,
      riskFactors,
      foreignIssuerPhraseHits,
      sectionExtractions,
      financialExtractions,
      governanceExtractions,
      exhibitExtractions,
      spacTransactionStatus,
      ...(input.marketContext ? { marketContext: input.marketContext } : {}),
      ...(input.parentFilingContext ? { parentFilingContext: input.parentFilingContext } : {}),
    },
  };
}

export function buildDeterministicS1F1Result(parserOutput: S1F1ParserOutput): S1F1RequiredOutputJson | null {
  const deterministic = parserOutput.raw.deterministic;
  if (!deterministic?.canFinishWithoutLlm) return null;

  const score = deterministic.score;
  const isPostEffective = parserOutput.facts.filing.filing_variant === "post_effective_amendment";
  const analysisOutput: S1F1AnalysisOutput = {
    source_group: "filings",
    market_scope: "company",
    event_type: deterministic.event_type,
    event_title: isPostEffective ? "Post-effective S-1/F-1 boundary filing" : "Routine S-1/F-1 amendment",
    primary_ticker: {
      ticker: parserOutput.facts.ticker,
      exchange: parserOutput.facts.exchange,
    },
    tickers: parserOutput.facts.ticker ? [parserOutput.facts.ticker] : [],
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    score,
    score_reason: `Archive-level score because ${deterministic.reason}`,
    signal: "neutral",
    quick_take: isPostEffective
      ? "The post-effective amendment has a mechanically clear boundary purpose and does not require LLM analysis in this fixture."
      : "The amendment appears administrative and does not require LLM analysis in this room fixture.",
    summary: parserOutput.summary ?? "Routine S-1/F-1 amendment parsed.",
    why_it_matters: isPostEffective
      ? "Boundary filings should be preserved as distinct variants so they do not masquerade as ordinary offering amendments."
      : "Administrative registration amendments usually do not change the investor thesis unless they alter offering terms or risk disclosures.",
    bullish_points: [],
    bearish_points: [],
    key_evidence: parserOutput.signals.flatMap((signal) => signal.evidence.map((item) => item.excerpt)),
    what_to_watch_next: ["Check a later amendment or effectiveness notice for changed offering terms."],
    related_tickers: [],
    calendar_items: parserOutput.calendarItems,
    confidence: "high",
    needs_human_review: false,
  };

  const fixtureExpected: S1F1FixtureExpected = {
    expected_delivery_level: deliveryLevelFromScore(score),
    expected_impact: "low",
    market_context_needed: false,
    market_context_reason: null,
    market_context_fields: [],
    special_ui_needed: false,
    special_ui_reason: null,
    integration_notes: ["Deterministic parser completion; no router or analysis LLM needed for this fixture."],
  };

  return {
    parser_output: parserOutput,
    analysis_output: analysisOutput,
    display_payload: {
      display_type: "generic",
      display_version: "s1-f1-display-v1",
      data: {
        deterministic_reason: deterministic.reason,
        filing_variant: parserOutput.facts.filing.filing_variant,
        post_effective_purpose: parserOutput.facts.filing.post_effective_purpose,
        amendment_number: parserOutput.facts.amendment.amendment_number,
      },
      evidence: analysisOutput.key_evidence,
      notes: ["No special detail UI requested by this room."],
    },
    fixture_expected: fixtureExpected,
  };
}
