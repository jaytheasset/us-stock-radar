import {
  readOsCandidateFilingContexts,
  filingMatchesOsCandidate,
  type SecFilingXbrlArtifactRepository,
  type SecFilingXbrlFact,
  type SecOsCandidateFilingContextResult,
  type SecXbrlDimension,
} from "./filingXbrlContext.ts";
import {
  readOsCandidates,
  type SecOsExtractionResult,
  type SecOsFilingContextCandidate,
  type SecOsUnavailableObservation,
} from "./osCandidateExtraction.ts";
import { isSourceBackedCommonStockClassIdentity } from "./shareCountSecurityIdentity.ts";
import type { SecStructuredRepository } from "./types.ts";

export const SEC_AUTHORITATIVE_OS_STATUSES = [
  "ELIGIBLE",
  "REQUIRES_FURTHER_CONTEXT",
  "UNAVAILABLE",
] as const;
export type SecAuthoritativeOsStatus = (typeof SEC_AUTHORITATIVE_OS_STATUSES)[number];

export const SEC_AUTHORITATIVE_OS_DECISION_VERSION = "authoritative-os-extraction-v1" as const;
export const SEC_US_LISTED_FOREIGN_OS_EVIDENCE_VERSION =
  "us-listed-foreign-os-evidence-v1" as const;
const DEI_NAMESPACE_PATTERN = /^https?:\/\/xbrl\.sec\.gov\/dei\/\d{4}$/i;

export const SEC_AUTHORITATIVE_OS_REASONS = [
  "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO",
  "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION",
  "COMPANYFACTS_FILING_VALUE_MISMATCH",
  "COMPANYFACTS_SAME_DATE_CONFLICT",
  "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
  "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
  "FILING_CONTEXT_UNAVAILABLE",
  "FILING_FACT_CIK_MISMATCH",
  "FILING_FACT_CONFLICT",
  "FILING_FACT_MALFORMED",
  "FILING_FACT_UNIT_NOT_SHARES",
  "FILING_RELEVANT_FACT_REJECTED",
  "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN",
  "FOREIGN_TRADING_SECURITY_AMBIGUOUS",
  "FOREIGN_TRADING_SECURITY_NOT_US_EXCHANGE",
  "NON_DEI_AGGREGATE_OR_CLASS_BASIS_REQUIRES_CONTEXT",
  "SECURITY_CLASS_DIMENSION_UNSUPPORTED",
  "UNSUPPORTED_FORM_FOR_AUTHORITATIVE_OS",
] as const;
export type SecAuthoritativeOsReason = (typeof SEC_AUTHORITATIVE_OS_REASONS)[number];

export type SecAuthoritativeOsFilingFactEvidence = {
  factKey: string;
  concept: SecFilingXbrlFact["concept"];
  lexicalValue: string | null;
  normalizedValue: string | null;
  contextRef: string;
  context: SecFilingXbrlFact["context"];
  dimensions: SecXbrlDimension[];
  unitRef: string | null;
  unit: SecFilingXbrlFact["unit"];
  decimals: string | null;
  precision: string | null;
  scale: string | null;
  sign: string | null;
  inlineFormat: string | null;
  isNil: boolean;
  source: SecFilingXbrlFact["source"];
};

export type SecAuthoritativeOsTradingSecurityFactEvidence = {
  factKey: string;
  concept: SecFilingXbrlFact["concept"];
  valueText: string | null;
  contextRef: string;
  context: SecFilingXbrlFact["context"];
  dimensions: SecXbrlDimension[];
  unitRef: string | null;
  isNil: boolean;
  source: SecFilingXbrlFact["source"];
};

export type SecUsListedForeignOsEvidence = {
  evidenceVersion: typeof SEC_US_LISTED_FOREIGN_OS_EVIDENCE_VERSION;
  securityTitleKind: "COMMON_SHARES" | "COMMON_STOCK" | "ORDINARY_SHARES" | "ORDINARY_STOCK" | "EQUITY_SHARES";
  securityTitle: SecAuthoritativeOsTradingSecurityFactEvidence;
  tradingSymbol: SecAuthoritativeOsTradingSecurityFactEvidence;
  exchangeName: SecAuthoritativeOsTradingSecurityFactEvidence;
  linkedOsFactKey: string;
  linkedOsContextRef: string;
};

export type SecAuthoritativeOsSecurityClass =
  | {
      basis: "SINGLE_COMMON_STOCK_CLASS";
      identity: "dei:EntityCommonStockSharesOutstanding@required-context";
      evidenceFactKey: string;
      contextRef: string;
      dimensions: [];
    }
  | {
      basis: "CLASS_SPECIFIC_COMMON_STOCK";
      identity: {
        axis: Extract<SecXbrlDimension, { kind: "explicit" }>["axis"];
        member: Extract<SecXbrlDimension, { kind: "explicit" }>["member"];
      };
      evidenceFactKey: string;
      contextRef: string;
      dimensions: [Extract<SecXbrlDimension, { kind: "explicit" }>];
    };

type SecAuthoritativeOsDecisionBase = {
  issuerCik: string;
  candidate: SecOsFilingContextCandidate;
  decisionVersion: typeof SEC_AUTHORITATIVE_OS_DECISION_VERSION;
  reason: SecAuthoritativeOsReason;
  filingFacts: SecAuthoritativeOsFilingFactEvidence[];
  tradingSecurityFacts: SecAuthoritativeOsTradingSecurityFactEvidence[];
};

export type SecAuthoritativeOsEligibleDecision = SecAuthoritativeOsDecisionBase & {
  status: "ELIGIBLE";
  reason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT" | "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT";
  authoritative: {
    issuerCik: string;
    sharesOutstanding: string;
    filingLexicalValue: string;
    asOf: string;
    securityClass: SecAuthoritativeOsSecurityClass;
    accession: string;
    form: string;
    filingDocument: string;
    filedDate: string;
    acceptedAt: string;
    taxonomy: "dei";
    concept: "EntityCommonStockSharesOutstanding";
    conceptNamespaceUri: string;
    conceptLocalName: "EntityCommonStockSharesOutstanding";
    factKey: string;
    contextRef: string;
    context: SecFilingXbrlFact["context"];
    dimensions: SecXbrlDimension[];
    source: SecFilingXbrlFact["source"];
    companyFactsProvenance: SecOsFilingContextCandidate["sourceFacts"];
    filingLedgerRawSourceId: string;
    tradingSecurityEvidence: SecUsListedForeignOsEvidence | null;
    decisionVersion: typeof SEC_AUTHORITATIVE_OS_DECISION_VERSION;
    decisionReason: SecAuthoritativeOsEligibleDecision["reason"];
  };
};

export type SecAuthoritativeOsNonEligibleDecision = SecAuthoritativeOsDecisionBase & {
  status: "REQUIRES_FURTHER_CONTEXT" | "UNAVAILABLE";
  authoritative: null;
};

export type SecAuthoritativeOsDecision =
  | SecAuthoritativeOsEligibleDecision
  | SecAuthoritativeOsNonEligibleDecision;

export type SecAuthoritativeOsReadResult = {
  issuerCik: string;
  status: SecAuthoritativeOsStatus;
  decisions: SecAuthoritativeOsDecision[];
  rejectedCompanyFacts: SecOsUnavailableObservation[];
  discovery: SecOsExtractionResult;
};

export function resolveAuthoritativeOsFromFiling(
  filingContext: SecOsCandidateFilingContextResult,
): SecAuthoritativeOsDecision {
  const candidate = filingContext.candidate;
  if (filingContext.status === "UNAVAILABLE") {
    return nonEligible(candidate, "UNAVAILABLE", "FILING_CONTEXT_UNAVAILABLE", []);
  }
  const filingFacts = filingContext.matches.map(toFactEvidence).sort(compareFactEvidence);
  const tradingSecurityFacts = (filingContext.tradingSecurityFacts ?? [])
    .map(toTradingSecurityFactEvidence)
    .sort(compareTradingSecurityFactEvidence);
  const reject = (
    status: SecAuthoritativeOsNonEligibleDecision["status"],
    reason: SecAuthoritativeOsReason,
  ) => nonEligible(candidate, status, reason, filingFacts, tradingSecurityFacts);
  if (filingContext.relevantRejections.length > 0) {
    return reject("UNAVAILABLE", "FILING_RELEVANT_FACT_REJECTED");
  }
  if (candidate.rejectionReason === "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT") {
    return reject("REQUIRES_FURTHER_CONTEXT", "COMPANYFACTS_SAME_DATE_CONFLICT");
  }
  const invalidCik = filingContext.matches.some((fact) => !contextMatchesIssuer(fact, candidate.issuerCik));
  if (invalidCik) return reject("UNAVAILABLE", "FILING_FACT_CIK_MISMATCH");
  const malformed = filingFacts.some((fact) => fact.normalizedValue === null);
  if (malformed) return reject("UNAVAILABLE", "FILING_FACT_MALFORMED");
  const unitMismatch = filingContext.matches.some((fact) => !isSharesUnit(fact));
  if (unitMismatch) return reject("UNAVAILABLE", "FILING_FACT_UNIT_NOT_SHARES");
  const exactMatches = filingContext.matches.filter((fact) => normalizeFilingInteger(fact) === candidate.sharesOutstanding);
  if (exactMatches.length === 0) {
    return reject("UNAVAILABLE", "COMPANYFACTS_FILING_VALUE_MISMATCH");
  }
  const foreignPeriodic = isForeignPeriodicForm(candidate.form);
  if (!isDomesticPeriodicForm(candidate.form) && !foreignPeriodic) {
    if (isOtherForeignForm(candidate.form)) {
      return reject("REQUIRES_FURTHER_CONTEXT", "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO");
    }
    return reject("UNAVAILABLE", "UNSUPPORTED_FORM_FOR_AUTHORITATIVE_OS");
  }
  const plain = filingContext.matches.filter((fact) => fact.context.dimensions.length === 0);
  const classSpecific = filingContext.matches.filter(hasSingleAuthoritativeCommonStockClassDimension);
  if (plain.length > 0 && classSpecific.length > 0) {
    return reject("REQUIRES_FURTHER_CONTEXT", "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION");
  }
  if (filingContext.matches.some((fact) => fact.context.dimensions.length > 0
    && !hasSingleAuthoritativeCommonStockClassDimension(fact))) {
    return reject("REQUIRES_FURTHER_CONTEXT", "SECURITY_CLASS_DIMENSION_UNSUPPORTED");
  }
  if (candidate.taxonomy !== "dei" || candidate.concept !== "EntityCommonStockSharesOutstanding") {
    return reject("REQUIRES_FURTHER_CONTEXT", "NON_DEI_AGGREGATE_OR_CLASS_BASIS_REQUIRES_CONTEXT");
  }
  if (foreignPeriodic && filingContext.matches.length !== 1) {
    return reject("REQUIRES_FURTHER_CONTEXT", "FOREIGN_TRADING_SECURITY_AMBIGUOUS");
  }
  let selected: {
    fact: SecFilingXbrlFact;
    securityClass: SecAuthoritativeOsSecurityClass;
    reason: SecAuthoritativeOsEligibleDecision["reason"];
  } | null = null;
  if (plain.length === 1 && exactMatches.length === 1 && filingContext.matches.length === 1) {
    selected = {
      fact: exactMatches[0]!,
      securityClass: {
        basis: "SINGLE_COMMON_STOCK_CLASS",
        identity: "dei:EntityCommonStockSharesOutstanding@required-context",
        evidenceFactKey: exactMatches[0]!.factKey,
        contextRef: exactMatches[0]!.contextRef,
        dimensions: [],
      },
      reason: "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT",
    };
  }
  if (!selected && classSpecific.length === filingContext.matches.length && exactMatches.length === 1
    && hasSingleAuthoritativeCommonStockClassDimension(exactMatches[0]!)) {
    const dimension = exactMatches[0]!.context.dimensions[0] as Extract<SecXbrlDimension, { kind: "explicit" }>;
    selected = {
      fact: exactMatches[0]!,
      securityClass: {
        basis: "CLASS_SPECIFIC_COMMON_STOCK",
        identity: { axis: dimension.axis, member: dimension.member },
        evidenceFactKey: exactMatches[0]!.factKey,
        contextRef: exactMatches[0]!.contextRef,
        dimensions: [dimension],
      },
      reason: "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT",
    };
  }
  if (!selected) return reject("REQUIRES_FURTHER_CONTEXT", "FILING_FACT_CONFLICT");
  let tradingSecurityEvidence: SecUsListedForeignOsEvidence | null = null;
  if (foreignPeriodic) {
    const listing = resolveUsListedForeignTradingSecurity({
      candidate,
      osFact: selected.fact,
      facts: filingContext.tradingSecurityFacts ?? [],
      rejections: filingContext.tradingSecurityRejections ?? [],
    });
    if (listing.status === "REQUIRES_FURTHER_CONTEXT") {
      return reject("REQUIRES_FURTHER_CONTEXT", listing.reason);
    }
    tradingSecurityEvidence = listing.evidence;
  }
  return eligible(
    candidate,
    selected.fact,
    selected.securityClass,
    selected.reason,
    filingFacts,
    tradingSecurityFacts,
    tradingSecurityEvidence,
  );
}

export async function readAuthoritativeOsCandidates(input: {
  structuredRepository: Pick<SecStructuredRepository, "readFacts" | "readFilings">;
  filingXbrlRepository: SecFilingXbrlArtifactRepository;
  cik: string;
}): Promise<SecAuthoritativeOsReadResult> {
  const discovery = await readOsCandidates(input.structuredRepository, input.cik);
  const filingLedger = await input.structuredRepository.readFilings(input.cik, 1000);
  const decisions: SecAuthoritativeOsDecision[] = [];
  for (const candidate of discovery.candidates) {
    const exactFilings = filingLedger.filter((filing) => filingMatchesOsCandidate(filing, candidate));
    const linked = await readOsCandidateFilingContexts({
      candidate,
      filing: exactFilings.length === 1 ? exactFilings[0] : undefined,
      repository: input.filingXbrlRepository,
    });
    decisions.push(resolveAuthoritativeOsFromFiling(linked));
  }
  decisions.sort(compareDecisions);
  return {
    issuerCik: discovery.issuerCik,
    status: summaryStatus(decisions),
    decisions,
    rejectedCompanyFacts: discovery.rejected,
    discovery,
  };
}

function eligible(
  candidate: SecOsFilingContextCandidate,
  fact: SecFilingXbrlFact,
  securityClass: SecAuthoritativeOsSecurityClass,
  reason: SecAuthoritativeOsEligibleDecision["reason"],
  filingFacts: SecAuthoritativeOsFilingFactEvidence[],
  tradingSecurityFacts: SecAuthoritativeOsTradingSecurityFactEvidence[],
  tradingSecurityEvidence: SecUsListedForeignOsEvidence | null,
): SecAuthoritativeOsEligibleDecision {
  const filingLexicalValue = fact.valueText!;
  return {
    issuerCik: candidate.issuerCik,
    candidate,
    status: "ELIGIBLE",
    decisionVersion: SEC_AUTHORITATIVE_OS_DECISION_VERSION,
    reason,
    filingFacts,
    tradingSecurityFacts,
    authoritative: {
      issuerCik: candidate.issuerCik,
      sharesOutstanding: candidate.sharesOutstanding,
      filingLexicalValue,
      asOf: candidate.asOf,
      securityClass,
      accession: candidate.accession,
      form: candidate.form,
      filingDocument: fact.source.documentName,
      filedDate: candidate.filedDate,
      acceptedAt: candidate.acceptedAt,
      taxonomy: "dei",
      concept: "EntityCommonStockSharesOutstanding",
      conceptNamespaceUri: fact.concept.namespaceUri!,
      conceptLocalName: "EntityCommonStockSharesOutstanding",
      factKey: fact.factKey,
      contextRef: fact.contextRef,
      context: fact.context,
      dimensions: fact.context.dimensions,
      source: fact.source,
      companyFactsProvenance: candidate.sourceFacts,
      filingLedgerRawSourceId: candidate.filingLedgerRawSourceId,
      tradingSecurityEvidence,
      decisionVersion: SEC_AUTHORITATIVE_OS_DECISION_VERSION,
      decisionReason: reason,
    },
  };
}

function nonEligible(
  candidate: SecOsFilingContextCandidate,
  status: SecAuthoritativeOsNonEligibleDecision["status"],
  reason: SecAuthoritativeOsReason,
  filingFacts: SecAuthoritativeOsFilingFactEvidence[],
  tradingSecurityFacts: SecAuthoritativeOsTradingSecurityFactEvidence[] = [],
): SecAuthoritativeOsNonEligibleDecision {
  return {
    issuerCik: candidate.issuerCik,
    candidate,
    status,
    decisionVersion: SEC_AUTHORITATIVE_OS_DECISION_VERSION,
    reason,
    filingFacts,
    tradingSecurityFacts,
    authoritative: null,
  };
}

function toTradingSecurityFactEvidence(
  fact: SecFilingXbrlFact,
): SecAuthoritativeOsTradingSecurityFactEvidence {
  return {
    factKey: fact.factKey,
    concept: structuredClone(fact.concept),
    valueText: fact.valueText,
    contextRef: fact.contextRef,
    context: structuredClone(fact.context),
    dimensions: structuredClone(fact.context.dimensions),
    unitRef: fact.unitRef,
    isNil: fact.isNil,
    source: structuredClone(fact.source),
  };
}

function resolveUsListedForeignTradingSecurity(input: {
  candidate: SecOsFilingContextCandidate;
  osFact: SecFilingXbrlFact;
  facts: readonly SecFilingXbrlFact[];
  rejections: readonly unknown[];
}): { status: "ELIGIBLE"; evidence: SecUsListedForeignOsEvidence } | {
  status: "REQUIRES_FURTHER_CONTEXT";
  reason: Extract<SecAuthoritativeOsReason,
    | "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO"
    | "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN"
    | "FOREIGN_TRADING_SECURITY_AMBIGUOUS"
    | "FOREIGN_TRADING_SECURITY_NOT_US_EXCHANGE">;
} {
  const facts = [...input.facts];
  const titleFacts = facts.filter((fact) => fact.concept.localName === "Security12bTitle");
  if (titleFacts.some((fact) => isDepositarySecurityTitle(fact.valueText))) {
    return { status: "REQUIRES_FURTHER_CONTEXT", reason: "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO" };
  }
  if (input.rejections.length > 0 || facts.length < 3) {
    return { status: "REQUIRES_FURTHER_CONTEXT", reason: "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN" };
  }
  if (facts.length !== 3) {
    return { status: "REQUIRES_FURTHER_CONTEXT", reason: "FOREIGN_TRADING_SECURITY_AMBIGUOUS" };
  }
  const contextKeys = new Set(facts.map((fact) => `${fact.source.artifactId}|${fact.contextRef}`));
  if (contextKeys.size !== 1
    || facts.some((fact) => !contextMatchesIssuer(fact, input.candidate.issuerCik)
      || fact.source.issuerCik !== input.candidate.issuerCik
      || fact.source.accession !== input.candidate.accession
      || !fact.concept.namespaceUri
      || !DEI_NAMESPACE_PATTERN.test(fact.concept.namespaceUri)
      || !["Security12bTitle", "TradingSymbol", "SecurityExchangeName"].includes(fact.concept.localName)
      || fact.isNil
      || fact.unitRef !== null
      || fact.unit !== null
      || !periodEndsOn(fact.context.period, input.candidate.asOf)
      || !dimensionsEqual(fact.context.dimensions, input.osFact.context.dimensions))) {
    return { status: "REQUIRES_FURTHER_CONTEXT", reason: "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN" };
  }
  const byConcept = new Map<string, SecFilingXbrlFact>();
  for (const fact of facts) {
    if (byConcept.has(fact.concept.localName) || !compact(fact.valueText)) {
      return { status: "REQUIRES_FURTHER_CONTEXT", reason: "FOREIGN_TRADING_SECURITY_AMBIGUOUS" };
    }
    byConcept.set(fact.concept.localName, fact);
  }
  const title = byConcept.get("Security12bTitle");
  const symbol = byConcept.get("TradingSymbol");
  const exchange = byConcept.get("SecurityExchangeName");
  if (!title || !symbol || !exchange) {
    return { status: "REQUIRES_FURTHER_CONTEXT", reason: "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN" };
  }
  const titleKind = classifyDirectCommonSecurityTitle(title.valueText);
  if (!titleKind || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,9}$/.test(compact(symbol.valueText))) {
    return { status: "REQUIRES_FURTHER_CONTEXT", reason: "FOREIGN_LISTING_OR_CLASS_LINKAGE_UNPROVEN" };
  }
  if (!isUsExchangeName(exchange.valueText)) {
    return { status: "REQUIRES_FURTHER_CONTEXT", reason: "FOREIGN_TRADING_SECURITY_NOT_US_EXCHANGE" };
  }
  return {
    status: "ELIGIBLE",
    evidence: {
      evidenceVersion: SEC_US_LISTED_FOREIGN_OS_EVIDENCE_VERSION,
      securityTitleKind: titleKind,
      securityTitle: toTradingSecurityFactEvidence(title),
      tradingSymbol: toTradingSecurityFactEvidence(symbol),
      exchangeName: toTradingSecurityFactEvidence(exchange),
      linkedOsFactKey: input.osFact.factKey,
      linkedOsContextRef: input.osFact.contextRef,
    },
  };
}

function classifyDirectCommonSecurityTitle(
  value: string | null,
): SecUsListedForeignOsEvidence["securityTitleKind"] | null {
  const title = compact(value);
  if (!title || isDepositarySecurityTitle(title)
    || /\b(?:preferred|preference|warrant|note|bond|unit|right)\b/i.test(title)) return null;
  if (/^(?:class\s+[a-z0-9]+\s+)?common shares?\b/i.test(title)) return "COMMON_SHARES";
  if (/^(?:class\s+[a-z0-9]+\s+)?common stock\b/i.test(title)) return "COMMON_STOCK";
  if (/^(?:class\s+[a-z0-9]+\s+)?ordinary shares?\b/i.test(title)) return "ORDINARY_SHARES";
  if (/^(?:class\s+[a-z0-9]+\s+)?ordinary stock\b/i.test(title)) return "ORDINARY_STOCK";
  if (/^(?:class\s+[a-z0-9]+\s+)?equity shares?\b/i.test(title)) return "EQUITY_SHARES";
  return null;
}

function isDepositarySecurityTitle(value: string | null) {
  return /\b(?:ADS|ADR)s?\b|\bdepositary\b|\bdepository\b|\bdepositary receipts?\b/i.test(compact(value));
}

function isUsExchangeName(value: string | null) {
  return new Set([
    "AMERICAN STOCK EXCHANGE",
    "AMEX",
    "NASDAQ",
    "NASDAQ CAPITAL MARKET",
    "NASDAQ GLOBAL MARKET",
    "NASDAQ GLOBAL SELECT MARKET",
    "NEW YORK STOCK EXCHANGE",
    "NYSE",
    "NYSE AMERICAN",
    "NYSE AMERICAN LLC",
    "THE NASDAQ STOCK MARKET LLC",
  ]).has(compact(value).toUpperCase().replace(/[.,]/g, "").replace(/\s+/g, " "));
}

function periodEndsOn(period: SecFilingXbrlFact["context"]["period"], asOf: string) {
  return period.kind === "duration" && period.endDate === asOf;
}

function dimensionsEqual(left: readonly SecXbrlDimension[], right: readonly SecXbrlDimension[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function compact(value: string | null) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function toFactEvidence(fact: SecFilingXbrlFact): SecAuthoritativeOsFilingFactEvidence {
  return {
    factKey: fact.factKey,
    concept: structuredClone(fact.concept),
    lexicalValue: fact.valueText,
    normalizedValue: normalizeFilingInteger(fact),
    contextRef: fact.contextRef,
    context: fact.context,
    dimensions: fact.context.dimensions,
    unitRef: fact.unitRef,
    unit: fact.unit,
    decimals: fact.decimals,
    precision: fact.precision,
    scale: fact.scale,
    sign: fact.sign,
    inlineFormat: fact.inlineFormat,
    isNil: fact.isNil,
    source: fact.source,
  };
}

export function normalizeFilingInteger(fact: SecFilingXbrlFact): string | null {
  if (fact.isNil || fact.valueText === null || fact.sign === "-") return null;
  let lexical = fact.valueText.trim();
  if (fact.inlineFormat !== null) {
    const format = fact.inlineFormat.toLowerCase();
    if (!format.endsWith(":num-dot-decimal") && !format.endsWith(":numdotdecimal")) return null;
    if (!/^(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?$/.test(lexical)) return null;
    lexical = lexical.replaceAll(",", "");
  } else if (!/^[0-9]+(?:\.[0-9]+)?$/.test(lexical)) {
    return null;
  }
  const [whole, fraction = ""] = lexical.split(".");
  const scale = fact.scale === null ? 0 : /^-?[0-9]+$/.test(fact.scale) ? Number(fact.scale) : Number.NaN;
  if (!Number.isSafeInteger(scale) || Math.abs(scale) > 1000) return null;
  let digits = `${whole}${fraction}`.replace(/^0+(?=[0-9])/, "");
  const trailingZeros = scale - fraction.length;
  if (trailingZeros >= 0) digits += "0".repeat(trailingZeros);
  else {
    const remove = -trailingZeros;
    if (remove >= digits.length || !digits.endsWith("0".repeat(remove))) return null;
    digits = digits.slice(0, -remove);
  }
  digits = digits.replace(/^0+/, "");
  return digits && /^[1-9][0-9]*$/.test(digits) ? digits : null;
}

function isSharesUnit(fact: SecFilingXbrlFact) {
  return fact.unit?.kind === "measure"
    && fact.unit.measure.namespaceUri === "http://www.xbrl.org/2003/instance"
    && fact.unit.measure.localName === "shares";
}

function contextMatchesIssuer(fact: SecFilingXbrlFact, cik: string) {
  const identifier = fact.context.entityIdentifier.replace(/^0+/, "").padStart(10, "0");
  return identifier === cik && /^https?:\/\/www\.sec\.gov\/CIK$/i.test(fact.context.entityScheme);
}

export function hasSingleAuthoritativeCommonStockClassDimension(
  fact: Pick<SecFilingXbrlFact, "concept" | "context">,
): boolean {
  if (fact.context.dimensions.length !== 1) return false;
  const dimension = fact.context.dimensions[0];
  return dimension?.kind === "explicit"
    && isSourceBackedCommonStockClassIdentity({
      sourceConcept: fact.concept,
      axis: dimension.axis,
      member: dimension.member,
    });
}

function isDomesticPeriodicForm(form: string) {
  return ["10-K", "10-K/A", "10-Q", "10-Q/A"].includes(form);
}

function isForeignPeriodicForm(form: string) {
  return ["20-F", "20-F/A", "40-F", "40-F/A"].includes(form);
}

function isOtherForeignForm(form: string) {
  return ["6-K", "6-K/A"].includes(form);
}

function summaryStatus(decisions: readonly SecAuthoritativeOsDecision[]): SecAuthoritativeOsStatus {
  if (decisions.some((decision) => decision.status === "ELIGIBLE")) return "ELIGIBLE";
  if (decisions.some((decision) => decision.status === "REQUIRES_FURTHER_CONTEXT")) return "REQUIRES_FURTHER_CONTEXT";
  return "UNAVAILABLE";
}

function compareFactEvidence(left: SecAuthoritativeOsFilingFactEvidence, right: SecAuthoritativeOsFilingFactEvidence) {
  return left.contextRef.localeCompare(right.contextRef) || left.factKey.localeCompare(right.factKey);
}

function compareTradingSecurityFactEvidence(
  left: SecAuthoritativeOsTradingSecurityFactEvidence,
  right: SecAuthoritativeOsTradingSecurityFactEvidence,
) {
  return [left.source.documentName, left.contextRef, left.concept.localName, left.factKey].join("|")
    .localeCompare([right.source.documentName, right.contextRef, right.concept.localName, right.factKey].join("|"));
}

function compareDecisions(left: SecAuthoritativeOsDecision, right: SecAuthoritativeOsDecision) {
  return [left.candidate.acceptedAt, left.candidate.accession, left.candidate.asOf, left.candidate.sharesOutstanding]
    .join("|")
    .localeCompare([right.candidate.acceptedAt, right.candidate.accession, right.candidate.asOf, right.candidate.sharesOutstanding].join("|"));
}
