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
import type { SecStructuredRepository } from "./types.ts";

export const SEC_AUTHORITATIVE_OS_STATUSES = [
  "ELIGIBLE",
  "REQUIRES_FURTHER_CONTEXT",
  "UNAVAILABLE",
] as const;
export type SecAuthoritativeOsStatus = (typeof SEC_AUTHORITATIVE_OS_STATUSES)[number];

export const SEC_AUTHORITATIVE_OS_DECISION_VERSION = "authoritative-os-extraction-v1" as const;

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
  "NON_DEI_AGGREGATE_OR_CLASS_BASIS_REQUIRES_CONTEXT",
  "SECURITY_CLASS_DIMENSION_UNSUPPORTED",
  "UNSUPPORTED_FORM_FOR_AUTHORITATIVE_OS",
] as const;
export type SecAuthoritativeOsReason = (typeof SEC_AUTHORITATIVE_OS_REASONS)[number];

export type SecAuthoritativeOsFilingFactEvidence = {
  factKey: string;
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
    factKey: string;
    contextRef: string;
    context: SecFilingXbrlFact["context"];
    dimensions: SecXbrlDimension[];
    source: SecFilingXbrlFact["source"];
    companyFactsProvenance: SecOsFilingContextCandidate["sourceFacts"];
    filingLedgerRawSourceId: string;
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
  if (filingContext.relevantRejections.length > 0) {
    return nonEligible(candidate, "UNAVAILABLE", "FILING_RELEVANT_FACT_REJECTED", filingFacts);
  }
  if (candidate.rejectionReason === "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT") {
    return nonEligible(candidate, "REQUIRES_FURTHER_CONTEXT", "COMPANYFACTS_SAME_DATE_CONFLICT", filingFacts);
  }
  const invalidCik = filingContext.matches.some((fact) => !contextMatchesIssuer(fact, candidate.issuerCik));
  if (invalidCik) return nonEligible(candidate, "UNAVAILABLE", "FILING_FACT_CIK_MISMATCH", filingFacts);
  const malformed = filingFacts.some((fact) => fact.normalizedValue === null);
  if (malformed) return nonEligible(candidate, "UNAVAILABLE", "FILING_FACT_MALFORMED", filingFacts);
  const unitMismatch = filingContext.matches.some((fact) => !isSharesUnit(fact));
  if (unitMismatch) return nonEligible(candidate, "UNAVAILABLE", "FILING_FACT_UNIT_NOT_SHARES", filingFacts);
  const exactMatches = filingContext.matches.filter((fact) => normalizeFilingInteger(fact) === candidate.sharesOutstanding);
  if (exactMatches.length === 0) {
    return nonEligible(candidate, "UNAVAILABLE", "COMPANYFACTS_FILING_VALUE_MISMATCH", filingFacts);
  }
  if (isForeignForm(candidate.form)) {
    return nonEligible(
      candidate,
      "REQUIRES_FURTHER_CONTEXT",
      "ADS_OR_ORDINARY_BASIS_REQUIRES_STRUCTURED_RATIO",
      filingFacts,
    );
  }
  if (!isDomesticPeriodicForm(candidate.form)) {
    return nonEligible(candidate, "UNAVAILABLE", "UNSUPPORTED_FORM_FOR_AUTHORITATIVE_OS", filingFacts);
  }
  if (candidate.taxonomy !== "dei" || candidate.concept !== "EntityCommonStockSharesOutstanding") {
    return nonEligible(
      candidate,
      "REQUIRES_FURTHER_CONTEXT",
      "NON_DEI_AGGREGATE_OR_CLASS_BASIS_REQUIRES_CONTEXT",
      filingFacts,
    );
  }

  const plain = filingContext.matches.filter((fact) => fact.context.dimensions.length === 0);
  const classSpecific = filingContext.matches.filter(hasSingleClassDimension);
  if (plain.length > 0 && classSpecific.length > 0) {
    return nonEligible(
      candidate,
      "REQUIRES_FURTHER_CONTEXT",
      "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION",
      filingFacts,
    );
  }
  if (filingContext.matches.some((fact) => fact.context.dimensions.length > 0 && !hasSingleClassDimension(fact))) {
    return nonEligible(candidate, "REQUIRES_FURTHER_CONTEXT", "SECURITY_CLASS_DIMENSION_UNSUPPORTED", filingFacts);
  }
  if (plain.length === 1 && exactMatches.length === 1 && filingContext.matches.length === 1) {
    return eligible(candidate, exactMatches[0]!, {
      basis: "SINGLE_COMMON_STOCK_CLASS",
      identity: "dei:EntityCommonStockSharesOutstanding@required-context",
      evidenceFactKey: exactMatches[0]!.factKey,
      contextRef: exactMatches[0]!.contextRef,
      dimensions: [],
    }, "ELIGIBLE_SINGLE_COMMON_STOCK_DEI_CONTEXT", filingFacts);
  }
  if (classSpecific.length === filingContext.matches.length && exactMatches.length === 1 && hasSingleClassDimension(exactMatches[0]!)) {
    const dimension = exactMatches[0]!.context.dimensions[0] as Extract<SecXbrlDimension, { kind: "explicit" }>;
    return eligible(candidate, exactMatches[0]!, {
      basis: "CLASS_SPECIFIC_COMMON_STOCK",
      identity: { axis: dimension.axis, member: dimension.member },
      evidenceFactKey: exactMatches[0]!.factKey,
      contextRef: exactMatches[0]!.contextRef,
      dimensions: [dimension],
    }, "ELIGIBLE_CLASS_SPECIFIC_DEI_CONTEXT", filingFacts);
  }
  return nonEligible(candidate, "REQUIRES_FURTHER_CONTEXT", "FILING_FACT_CONFLICT", filingFacts);
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
): SecAuthoritativeOsEligibleDecision {
  const filingLexicalValue = fact.valueText!;
  return {
    issuerCik: candidate.issuerCik,
    candidate,
    status: "ELIGIBLE",
    decisionVersion: SEC_AUTHORITATIVE_OS_DECISION_VERSION,
    reason,
    filingFacts,
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
      factKey: fact.factKey,
      contextRef: fact.contextRef,
      context: fact.context,
      dimensions: fact.context.dimensions,
      source: fact.source,
      companyFactsProvenance: candidate.sourceFacts,
      filingLedgerRawSourceId: candidate.filingLedgerRawSourceId,
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
): SecAuthoritativeOsNonEligibleDecision {
  return {
    issuerCik: candidate.issuerCik,
    candidate,
    status,
    decisionVersion: SEC_AUTHORITATIVE_OS_DECISION_VERSION,
    reason,
    filingFacts,
    authoritative: null,
  };
}

function toFactEvidence(fact: SecFilingXbrlFact): SecAuthoritativeOsFilingFactEvidence {
  return {
    factKey: fact.factKey,
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

function hasSingleClassDimension(fact: SecFilingXbrlFact): boolean {
  if (fact.context.dimensions.length !== 1) return false;
  const dimension = fact.context.dimensions[0];
  return dimension?.kind === "explicit"
    && dimension.axis.localName === "StatementClassOfStockAxis"
    && isUsGaapNamespace(dimension.axis.namespaceUri)
    && isUsGaapNamespace(dimension.member.namespaceUri)
    && STANDARD_COMMON_STOCK_MEMBERS.has(dimension.member.localName);
}

function isUsGaapNamespace(value: string | null) {
  return value !== null && /^http:\/\/fasb\.org\/us-gaap\/[0-9]{4}$/.test(value);
}

const STANDARD_COMMON_STOCK_MEMBERS = new Set([
  "CommonStockMember",
  "CommonClassAMember",
  "CommonClassBMember",
  "CommonClassCMember",
]);

function isDomesticPeriodicForm(form: string) {
  return ["10-K", "10-K/A", "10-Q", "10-Q/A"].includes(form);
}

function isForeignForm(form: string) {
  return ["20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A"].includes(form);
}

function summaryStatus(decisions: readonly SecAuthoritativeOsDecision[]): SecAuthoritativeOsStatus {
  if (decisions.some((decision) => decision.status === "ELIGIBLE")) return "ELIGIBLE";
  if (decisions.some((decision) => decision.status === "REQUIRES_FURTHER_CONTEXT")) return "REQUIRES_FURTHER_CONTEXT";
  return "UNAVAILABLE";
}

function compareFactEvidence(left: SecAuthoritativeOsFilingFactEvidence, right: SecAuthoritativeOsFilingFactEvidence) {
  return left.contextRef.localeCompare(right.contextRef) || left.factKey.localeCompare(right.factKey);
}

function compareDecisions(left: SecAuthoritativeOsDecision, right: SecAuthoritativeOsDecision) {
  return [left.candidate.acceptedAt, left.candidate.accession, left.candidate.asOf, left.candidate.sharesOutstanding]
    .join("|")
    .localeCompare([right.candidate.acceptedAt, right.candidate.accession, right.candidate.asOf, right.candidate.sharesOutstanding].join("|"));
}
