import type {
  Section16XmlField,
  Section16XmlFootnote,
  Section16XmlHolding,
  Section16XmlParserOutput,
  Section16XmlTransaction,
} from "@/lib/sources/sec/forms/section16Xml/parser";

export const SECTION16_LINEAGE_VERSION = "sec_section16_lineage_v1" as const;
export const SECTION16_LINEAGE_SCOPE = "complete_stored_history_not_sec_global" as const;

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type Section16LineageFiling = Readonly<{
  accessionNumber: string;
  parsed: Section16XmlParserOutput;
}>;

export type Section16LineageLink = Readonly<{
  accessionNumber: string;
  referencedAccessionNumber: string | null;
  status: "linked" | "unresolved";
  reason: string | null;
  evidence: Readonly<{
    source: "date_of_original_submission" | "none";
    originalSubmissionDateRaw: string | null;
    issuerIdentity: "confirmed" | "unresolved";
    reporterIdentity: "confirmed" | "unresolved";
    securityIdentity: "confirmed" | "unresolved";
  }>;
}>;

export type Section16TransactionDecision = Readonly<{
  accessionNumber: string;
  rowOrdinal: number;
  row: Section16XmlTransaction;
  aggregationStatus: "included" | "excluded_confirmed_duplicate";
  reason:
    | "original_or_unlinked_filing"
    | "distinct_transaction"
    | "possible_repeat_without_explicit_sec_evidence"
    | "ambiguous_prior_transaction_match"
    | "confirmed_same_transaction";
  duplicateOf: Readonly<{ accessionNumber: string; rowOrdinal: number }> | null;
  evidence: Readonly<{
    source: "remarks" | "footnote";
    footnoteId: string | null;
    text: string;
  }> | null;
}>;

export type Section16HoldingSnapshot = Readonly<{
  accessionNumber: string;
  rowOrdinal: number;
  preservationStatus: "preserved_filing_snapshot";
  row: Section16XmlHolding;
}>;

export type Section16HoldingCorrection = Readonly<{
  accessionNumber: string;
  rowOrdinal: number;
  corrects: Readonly<{ accessionNumber: string; rowOrdinal: number }>;
  field: "amountOwned";
  previousValueRaw: string;
  correctedValueRaw: string;
  evidence: Readonly<{ source: "footnote"; footnoteId: string; text: string }>;
}>;

export type Section16StoredLineageProjection = Readonly<{
  version: typeof SECTION16_LINEAGE_VERSION;
  scope: typeof SECTION16_LINEAGE_SCOPE;
  issuerCik: string;
  links: readonly Section16LineageLink[];
  transactions: readonly Section16TransactionDecision[];
  holdings: readonly Section16HoldingSnapshot[];
  holdingCorrections: readonly Section16HoldingCorrection[];
  issues: readonly string[];
}>;

export function resolveSection16StoredLineage(
  filings: readonly Section16LineageFiling[],
): Section16StoredLineageProjection {
  const ordered = [...filings].sort(compareFilings);
  const issuerCik = ordered.length > 0 ? normalizedCik(ordered[0]!.parsed.issuer.cik) ?? "" : "";
  const links = ordered.filter((filing) => filing.parsed.isAmendment).map((filing) => resolveLink(filing, ordered));
  const linksByAccession = new Map(links.map((link) => [link.accessionNumber, link]));
  const filingByAccession = new Map(ordered.map((filing) => [filing.accessionNumber, filing]));
  const issues: string[] = links
    .filter((link) => link.status === "unresolved")
    .map((link) => `lineage_unresolved:${link.accessionNumber}:${link.reason ?? "unknown"}`);
  const transactions: Section16TransactionDecision[] = [];
  const holdings: Section16HoldingSnapshot[] = [];
  const holdingCorrections: Section16HoldingCorrection[] = [];

  for (const filing of ordered) {
    filing.parsed.holdings.forEach((row, rowOrdinal) => {
      holdings.push({ accessionNumber: filing.accessionNumber, rowOrdinal, preservationStatus: "preserved_filing_snapshot", row });
    });

    const link = linksByAccession.get(filing.accessionNumber);
    const original = link?.status === "linked" && link.referencedAccessionNumber !== null
      ? filingByAccession.get(link.referencedAccessionNumber)
      : null;
    if (original) {
      holdingCorrections.push(...resolveHoldingCorrections(filing, original));
    }

    filing.parsed.transactions.forEach((row, rowOrdinal) => {
      if (!original) {
        transactions.push({
          accessionNumber: filing.accessionNumber,
          rowOrdinal,
          row,
          aggregationStatus: "included",
          reason: "original_or_unlinked_filing",
          duplicateOf: null,
          evidence: null,
        });
        return;
      }
      const matches = original.parsed.transactions
        .map((candidate, candidateOrdinal) => ({ candidate, candidateOrdinal }))
        .filter(({ candidate }) => transactionsExactlyEqual(row, filing.parsed.footnotes, candidate, original.parsed.footnotes));
      if (matches.length === 0) {
        transactions.push({
          accessionNumber: filing.accessionNumber,
          rowOrdinal,
          row,
          aggregationStatus: "included",
          reason: "distinct_transaction",
          duplicateOf: null,
          evidence: null,
        });
        return;
      }
      const amendmentMatches = filing.parsed.transactions.filter((candidate) => (
        transactionsExactlyEqual(row, filing.parsed.footnotes, candidate, filing.parsed.footnotes)
      ));
      if (matches.length > 1 || amendmentMatches.length > 1) {
        issues.push(`transaction_match_ambiguous:${filing.accessionNumber}:${rowOrdinal}`);
        transactions.push({
          accessionNumber: filing.accessionNumber,
          rowOrdinal,
          row,
          aggregationStatus: "included",
          reason: "ambiguous_prior_transaction_match",
          duplicateOf: null,
          evidence: null,
        });
        return;
      }
      const evidence = explicitSameTransactionEvidence(filing, original, row);
      if (!evidence) {
        issues.push(`transaction_repeat_unconfirmed:${filing.accessionNumber}:${rowOrdinal}`);
        transactions.push({
          accessionNumber: filing.accessionNumber,
          rowOrdinal,
          row,
          aggregationStatus: "included",
          reason: "possible_repeat_without_explicit_sec_evidence",
          duplicateOf: null,
          evidence: null,
        });
        return;
      }
      transactions.push({
        accessionNumber: filing.accessionNumber,
        rowOrdinal,
        row,
        aggregationStatus: "excluded_confirmed_duplicate",
        reason: "confirmed_same_transaction",
        duplicateOf: { accessionNumber: original.accessionNumber, rowOrdinal: matches[0]!.candidateOrdinal },
        evidence,
      });
    });
  }

  return {
    version: SECTION16_LINEAGE_VERSION,
    scope: SECTION16_LINEAGE_SCOPE,
    issuerCik,
    links,
    transactions,
    holdings,
    holdingCorrections,
    issues: [...new Set(issues)].sort(),
  };
}

function resolveLink(
  amendment: Section16LineageFiling,
  history: readonly Section16LineageFiling[],
): Section16LineageLink {
  const originalDateField = amendment.parsed.filing.dateOfOriginalSubmission;
  const originalDate = exactString(originalDateField);
  const evidenceBase = {
    source: originalDate ? "date_of_original_submission" as const : "none" as const,
    originalSubmissionDateRaw: originalDate,
    issuerIdentity: "unresolved" as const,
    reporterIdentity: "unresolved" as const,
    securityIdentity: "unresolved" as const,
  };
  const unresolved = (
    reason: string,
    referencedAccessionNumber: string | null = null,
    evidence: Section16LineageLink["evidence"] = evidenceBase,
  ): Section16LineageLink => ({
    accessionNumber: amendment.accessionNumber,
    referencedAccessionNumber,
    status: "unresolved",
    reason,
    evidence,
  });

  if (!ACCESSION_PATTERN.test(amendment.accessionNumber)) return unresolved("invalid_amendment_accession");
  if (!originalDate || !DATE_PATTERN.test(originalDate)) return unresolved("original_submission_date_missing_or_invalid");
  const datedCandidates = history.filter((candidate) => (
    !candidate.parsed.isAmendment
    && formFamily(candidate.parsed.formType) === formFamily(amendment.parsed.formType)
    && exactString(candidate.parsed.filing.filingDate) === originalDate
  ));
  if (datedCandidates.length === 0) return unresolved("original_not_stored");

  const evaluated = datedCandidates.map((candidate) => evaluateCandidate(amendment, candidate));
  const confirmed = evaluated.filter((item) => item.reason === null);
  if (confirmed.length > 1) return unresolved("multiple_original_candidates");
  if (confirmed.length === 1) {
    if (evaluated.some((item) => item.reason?.includes("unverified"))) {
      return unresolved("multiple_unverified_original_candidates");
    }
    const match = confirmed[0]!;
    return {
      accessionNumber: amendment.accessionNumber,
      referencedAccessionNumber: match.candidate.accessionNumber,
      status: "linked",
      reason: null,
      evidence: {
        source: "date_of_original_submission",
        originalSubmissionDateRaw: originalDate,
        issuerIdentity: "confirmed",
        reporterIdentity: "confirmed",
        securityIdentity: "confirmed",
      },
    };
  }
  if (datedCandidates.length > 1) return unresolved("multiple_unverified_original_candidates");
  const only = evaluated[0]!;
  return unresolved(only.reason ?? "original_identity_unverified", only.candidate.accessionNumber, only.evidence);
}

function evaluateCandidate(amendment: Section16LineageFiling, original: Section16LineageFiling) {
  const amendmentIssuer = normalizedCik(amendment.parsed.issuer.cik);
  const originalIssuer = normalizedCik(original.parsed.issuer.cik);
  const issuerVerified = amendmentIssuer !== null && originalIssuer !== null;
  const issuerMatches = issuerVerified && amendmentIssuer === originalIssuer;
  const amendmentReporters = reporterKeys(amendment);
  const originalReporters = reporterKeys(original);
  const reporterVerified = amendmentReporters !== null && originalReporters !== null;
  const reporterMatches = reporterVerified && sameStrings(amendmentReporters, originalReporters);
  const amendmentSecurities = securityKeys(amendment);
  const originalSecurities = securityKeys(original);
  const securityVerified = amendmentSecurities !== null && originalSecurities !== null;
  const securityMatches = securityVerified && sameStrings(amendmentSecurities, originalSecurities);
  const evidence = {
    source: "date_of_original_submission" as const,
    originalSubmissionDateRaw: exactString(amendment.parsed.filing.dateOfOriginalSubmission),
    issuerIdentity: issuerMatches ? "confirmed" as const : "unresolved" as const,
    reporterIdentity: reporterMatches ? "confirmed" as const : "unresolved" as const,
    securityIdentity: securityMatches ? "confirmed" as const : "unresolved" as const,
  };
  let reason: string | null = null;
  if (!issuerVerified) reason = "issuer_identity_unverified";
  else if (!issuerMatches) reason = "issuer_identity_mismatch";
  else if (!reporterVerified) reason = "reporter_identity_unverified";
  else if (!reporterMatches) reason = "reporter_identity_mismatch";
  else if (!securityVerified) reason = "security_identity_unverified";
  else if (!securityMatches) reason = "security_identity_mismatch";
  else if (!isStrictlyEarlier(original, amendment)) reason = "filing_order_reversed_or_unverified";
  return { candidate: original, evidence, reason };
}

function resolveHoldingCorrections(
  amendment: Section16LineageFiling,
  original: Section16LineageFiling,
): Section16HoldingCorrection[] {
  const corrections: Section16HoldingCorrection[] = [];
  amendment.parsed.holdings.forEach((holding, rowOrdinal) => {
    const currentValue = exactString(holding.amountOwned);
    if (!currentValue || holding.amountOwned.footnoteIds.length === 0) return;
    const candidates = original.parsed.holdings
      .map((candidate, candidateOrdinal) => ({ candidate, candidateOrdinal }))
      .filter(({ candidate }) => (
        holdingIdentity(candidate, original.parsed.footnotes) !== null
        && holdingIdentity(candidate, original.parsed.footnotes) === holdingIdentity(holding, amendment.parsed.footnotes)
      ))
      .filter(({ candidate }) => exactString(candidate.amountOwned) !== null && exactString(candidate.amountOwned) !== currentValue);
    if (candidates.length !== 1) return;
    const previousValue = exactString(candidates[0]!.candidate.amountOwned)!;
    for (const footnoteId of holding.amountOwned.footnoteIds) {
      const footnote = uniqueFootnote(amendment.parsed.footnotes, footnoteId);
      if (!footnote || !explicitHoldingCorrectionText(footnote.text, amendment, original, previousValue)) continue;
      corrections.push({
        accessionNumber: amendment.accessionNumber,
        rowOrdinal,
        corrects: { accessionNumber: original.accessionNumber, rowOrdinal: candidates[0]!.candidateOrdinal },
        field: "amountOwned",
        previousValueRaw: previousValue,
        correctedValueRaw: currentValue,
        evidence: { source: "footnote", footnoteId, text: footnote.text },
      });
      return;
    }
  });
  return corrections;
}

function explicitSameTransactionEvidence(
  amendment: Section16LineageFiling,
  original: Section16LineageFiling,
  row: Section16XmlTransaction,
): Section16TransactionDecision["evidence"] {
  const statements: Array<{ source: "remarks" | "footnote"; footnoteId: string | null; text: string }> = [];
  const remarks = exactString(amendment.parsed.filing.remarks);
  if (remarks) statements.push({ source: "remarks", footnoteId: null, text: remarks });
  for (const footnoteId of row.footnoteIds) {
    const footnote = uniqueFootnote(amendment.parsed.footnotes, footnoteId);
    if (footnote) statements.push({ source: "footnote", footnoteId, text: footnote.text });
  }
  return statements.find((statement) => explicitSameTransactionText(statement.text, amendment, original, row)) ?? null;
}

function explicitSameTransactionText(
  text: string,
  amendment: Section16LineageFiling,
  original: Section16LineageFiling,
  row: Section16XmlTransaction,
) {
  const originalDate = exactString(original.parsed.filing.filingDate);
  const transactionDate = exactString(row.transactionDate);
  const shares = exactString(row.shares);
  const title = exactString(row.securityTitle);
  const code = exactString(row.transactionCode);
  if (!originalDate || !transactionDate || !shares || !title || !code) return false;
  if (formFamily(amendment.parsed.formType) !== formFamily(original.parsed.formType)) return false;
  if (hasContradictionOrUncertainty(text)) return false;
  return sourceSentences(text).some((normalized) => {
    if (/\b(?:not|no|never|neither|nor|cannot|can't|isn't|wasn't|weren't|without)\b/.test(normalized)) return false;
    if (/\b(?:if|may|might|could|would|assuming|possible|possibly|purports?)\b/.test(normalized)) return false;
    const referencesOriginal = normalized.includes(normalizeText(original.accessionNumber))
      || mentionsExactDate(normalized, originalDate);
    return referencesOriginal
      && mentionsExactTransactionIdentity(normalized, transactionDate, shares, title)
      && /\bwas previously reported\b/.test(normalized)
      && /\b(?:is|was|remains) (?:an? )?(?:unchanged|duplicate)\b/.test(normalized)
      && new RegExp(`\\b(?:transaction\\s+)?code\\s+${escapeRegExp(code.toLowerCase())}\\b`).test(normalized);
  });
}

function explicitHoldingCorrectionText(
  text: string,
  amendment: Section16LineageFiling,
  original: Section16LineageFiling,
  previousValue: string,
) {
  const originalDate = exactString(original.parsed.filing.filingDate);
  if (!originalDate || formFamily(amendment.parsed.formType) !== formFamily(original.parsed.formType)) return false;
  if (hasContradictionOrUncertainty(text)) return false;
  const normalized = normalizeText(text);
  return (
    !/\b(?:not|no|never|if|may|might|could|would|assuming|possible|possibly)\b/.test(normalized)
    && (normalized.includes(normalizeText(original.accessionNumber)) || mentionsExactDate(normalized, originalDate))
    && /\bincorrect balance\b/.test(normalized)
    && /\bcorrected herein\b/.test(normalized)
    && containsToken(normalized, previousValue)
  );
}

function transactionsExactlyEqual(
  left: Section16XmlTransaction,
  leftFootnotes: readonly Section16XmlFootnote[],
  right: Section16XmlTransaction,
  rightFootnotes: readonly Section16XmlFootnote[],
) {
  return JSON.stringify(transactionEvidencePayload(left, leftFootnotes))
    === JSON.stringify(transactionEvidencePayload(right, rightFootnotes));
}

function transactionEvidencePayload(row: Section16XmlTransaction, footnotes: readonly Section16XmlFootnote[]) {
  const { rowIndex: _rowIndex, xmlPath: _xmlPath, ...semanticRow } = row;
  const resolvedFootnotes = row.footnoteIds.map((id) => {
    const footnote = uniqueFootnote(footnotes, id);
    return footnote ? { id, text: footnote.text, rawText: footnote.rawText } : { id, unresolved: true };
  });
  return { semanticRow, resolvedFootnotes };
}

function securityKeys(filing: Section16LineageFiling) {
  const rows: Array<Section16XmlTransaction | Section16XmlHolding> = [
    ...filing.parsed.transactions,
    ...filing.parsed.holdings,
  ];
  const keys = rows.map((row) => {
    const title = exactString(row.securityTitle);
    if (!title) return null;
    const underlying = row.rowKind === "derivative" ? exactString(row.underlyingSecurityTitle) : null;
    if (row.rowKind === "derivative" && !underlying) return null;
    const contract = row.rowKind === "derivative" ? derivativeContractIdentity(row, filing.parsed.footnotes) : "";
    if (contract === null) return null;
    return `${row.rowKind}|${normalizeIdentity(title)}|${normalizeIdentity(underlying ?? "")}|${contract}`;
  });
  if (keys.length === 0 || keys.some((key) => key === null)) return null;
  return [...new Set(keys as string[])].sort();
}

function holdingIdentity(row: Section16XmlHolding, footnotes: readonly Section16XmlFootnote[]) {
  const title = exactString(row.securityTitle);
  const direct = exactString(row.directOrIndirectOwnership);
  const nature = fieldIdentityValue(row.natureOfOwnership);
  const underlying = row.rowKind === "derivative" ? exactString(row.underlyingSecurityTitle) : "";
  const contract = row.rowKind === "derivative" ? derivativeContractIdentity(row, footnotes) : "";
  if (!title || !direct || nature === null || underlying === null || contract === null) return null;
  return [row.rowKind, title, underlying, direct, nature, contract].map(normalizeIdentity).join("|");
}

function derivativeContractIdentity(
  row: Pick<Section16XmlTransaction | Section16XmlHolding, "conversionOrExercisePrice" | "exerciseDate" | "expirationDate">,
  footnotes: readonly Section16XmlFootnote[],
) {
  const fields = [row.conversionOrExercisePrice, row.exerciseDate, row.expirationDate]
    .map((field) => contractFieldIdentity(field, footnotes));
  return fields.some((value) => value === null) ? null : fields.join("|");
}

function contractFieldIdentity(field: Section16XmlField, footnotes: readonly Section16XmlFootnote[]) {
  if (field.status === "exact") return `exact:${normalizeIdentity(field.rawValue ?? "")}`;
  if (field.status === "missing" || field.status === "empty") return null;
  if (field.status !== "footnote_only" || field.footnoteIds.length === 0) return null;
  const texts = field.footnoteIds.map((id) => uniqueFootnote(footnotes, id)?.text ?? null);
  if (texts.some((text) => text === null)) return null;
  return `footnote:${[...new Set((texts as string[]).map(normalizeIdentity))].sort().join(";")}`;
}

function reporterKeys(filing: Section16LineageFiling) {
  const keys = filing.parsed.reportingOwners.map((owner) => normalizedCik(owner.cik));
  if (keys.length === 0 || keys.some((key) => key === null) || new Set(keys).size !== keys.length) return null;
  return (keys as string[]).sort();
}

function normalizedCik(field: Section16XmlField) {
  const value = exactString(field);
  return value && /^\d{1,10}$/.test(value) ? value.padStart(10, "0") : null;
}

function fieldIdentityValue(field: Section16XmlField) {
  if (field.status === "missing" || field.status === "empty") return "";
  return exactString(field);
}

function exactString(field: Section16XmlField) {
  return field.status === "exact" && typeof field.rawValue === "string" && field.rawValue.length > 0
    ? field.rawValue
    : null;
}

function uniqueFootnote(footnotes: readonly Section16XmlFootnote[], id: string) {
  const matches = footnotes.filter((footnote) => footnote.id === id);
  return matches.length === 1 ? matches[0]! : null;
}

function isStrictlyEarlier(original: Section16LineageFiling, amendment: Section16LineageFiling) {
  const originalFiled = exactString(original.parsed.filing.filingDate);
  const amendmentFiled = exactString(amendment.parsed.filing.filingDate);
  if (!originalFiled || !amendmentFiled || !DATE_PATTERN.test(originalFiled) || !DATE_PATTERN.test(amendmentFiled)) return false;
  if (originalFiled !== amendmentFiled) return originalFiled < amendmentFiled;
  const originalAccepted = exactString(original.parsed.filing.acceptedAt);
  const amendmentAccepted = exactString(amendment.parsed.filing.acceptedAt);
  if (!originalAccepted || !amendmentAccepted) return false;
  return compareExplicitTimestamps(originalAccepted, amendmentAccepted) === -1;
}

function compareFilings(left: Section16LineageFiling, right: Section16LineageFiling) {
  const leftDate = exactString(left.parsed.filing.filingDate);
  const rightDate = exactString(right.parsed.filing.filingDate);
  if (leftDate && rightDate && DATE_PATTERN.test(leftDate) && DATE_PATTERN.test(rightDate) && leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }
  const acceptedOrder = compareExplicitTimestamps(
    exactString(left.parsed.filing.acceptedAt) ?? "",
    exactString(right.parsed.filing.acceptedAt) ?? "",
  );
  if (acceptedOrder !== null && acceptedOrder !== 0) return acceptedOrder;
  return left.accessionNumber.localeCompare(right.accessionNumber);
}

function compareExplicitTimestamps(left: string, right: string): -1 | 0 | 1 | null {
  const localPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (localPattern.test(left) && localPattern.test(right)) return left === right ? 0 : left < right ? -1 : 1;
  const zonedPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!zonedPattern.test(left) || !zonedPattern.test(right)) return null;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
}

function formFamily(value: string) {
  return value.replace("/A", "");
}

function normalizeIdentity(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[“”"]/g, "").replace(/\s+/g, " ").trim();
}

function sourceSentences(value: string) {
  return value.split(/(?<=[.!?;])\s+/).map(normalizeText).filter(Boolean);
}

function hasContradictionOrUncertainty(value: string) {
  const normalized = normalizeText(value);
  return /\b(?:not|no|never|neither|nor|cannot|can't|isn't|wasn't|weren't|without)\b/.test(normalized)
    || /\b(?:if|may|might|could|would|assuming|possible|possibly|purports?)\b/.test(normalized)
    || /\b(?:statement|description|assertion|claim) is (?:incorrect|inaccurate|false)\b/.test(normalized)
    || /\b(?:this|the) is (?:a )?different transaction\b/.test(normalized)
    || /\bcontradict(?:s|ed|ory|ion)?\b/.test(normalized);
}

function mentionsExactDate(normalizedText: string, isoDate: string) {
  if (normalizedText.includes(isoDate)) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return false;
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const month = monthNames[Number(match[2]) - 1];
  if (!month) return false;
  const day = String(Number(match[3]));
  return new RegExp(`\\b${month}\\s+${day},\\s*${match[1]}\\b`).test(normalizedText);
}

function mentionsExactTransactionIdentity(normalizedText: string, date: string, shares: string, title: string) {
  const dateExpression = exactDateExpression(date);
  if (!dateExpression) return false;
  return new RegExp(
    `\\b(?:this|the) transaction on ${dateExpression} for ${escapeRegExp(shares.toLowerCase())} shares? of ${escapeRegExp(normalizeText(title))}\\b`,
  ).test(normalizedText);
}

function exactDateExpression(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const monthNames = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const monthName = monthNames[Number(match[2]) - 1];
  if (!monthName) return null;
  return `(?:${escapeRegExp(value)}|${monthName} ${Number(match[3])}, ${match[1]})`;
}

function containsToken(haystack: string, needle: string) {
  return new RegExp(`(^|[^0-9a-z.])${escapeRegExp(needle.toLowerCase())}([^0-9a-z.]|$)`).test(haystack);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
