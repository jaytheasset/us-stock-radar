import { createHash } from "node:crypto";

export const SEC_AMENDMENT_LINEAGE_VERSION =
  "sec_amendment_lineage_v1" as const;

export type SecAmendmentOperation =
  "NOOP" | "SUPPLEMENT" | "REPLACE" | "CANCEL";

export type SecFilingIdentity = {
  rawItemId: string;
  sourceCode: "sec_edgar";
  issuerCik: string;
  accessionNumber: string;
  formType: string;
  filedDate: string;
  primaryDocumentUrl: string;
  indexUrl: string;
};

export type SecLineageEvidence = {
  amendmentExcerpt: string;
  amendmentDocumentUrl: string;
  amendmentIndexUrl: string;
  submissionsUrl: string;
  amendmentDocumentSha256?: string;
  amendmentExcerptSha256?: string;
};

export type SecAffectedFactEvidence = {
  semanticFactKey: string;
  evidence: string;
  sourceUrl: string;
};

export type SecAmendmentLineageResolution =
  | {
      status: "linked";
      version: typeof SEC_AMENDMENT_LINEAGE_VERSION;
      amendment: SecFilingIdentity;
      prior: SecFilingIdentity;
      formFamily: string;
      operation: SecAmendmentOperation;
      operationEvidence: string;
      targetEvidence: string;
      affectedFactKeys: string[];
      factScopeEvidence: SecAffectedFactEvidence[];
      evidence: SecLineageEvidence;
      observationKey: string;
    }
  | {
      status: "unavailable_review";
      version: typeof SEC_AMENDMENT_LINEAGE_VERSION;
      amendment: SecFilingIdentity;
      reviewTarget?: SecFilingIdentity;
      reason: string;
      evidence: SecLineageEvidence;
      observationKey: string;
    };

export type SecSemanticFactVersion = {
  rawItemId: string;
  sourceAccessionNumber: string;
  semanticFactKey: string;
  factPayload: Record<string, unknown>;
  sourceRef: {
    url: string;
    document: string;
    evidence: string;
  };
  eventId?: string | null;
  sourceExecutionId?: string | null;
};

export type SecCurrentFact = SecSemanticFactVersion & {
  semanticEventIdentity: string;
  alertIdentity: string;
};

export type SecCurrentStateProjection =
  | {
      status: "available";
      semanticEventIdentity: string;
      rootAccessionNumber: string;
      headAccessionNumber: string;
      cancelled: boolean;
      facts: SecCurrentFact[];
      appliedOperations: Array<{
        amendmentAccessionNumber: string;
        priorAccessionNumber: string;
        operation: SecAmendmentOperation;
      }>;
      reviewObservationKeys: string[];
    }
  | {
      status: "unavailable_review";
      reason: string;
      semanticEventIdentity: string;
      rootAccessionNumber: string;
      reviewObservationKeys: string[];
    };

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const CIK_PATTERN = /^\d{1,10}$/;
const FACT_KEY_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,159}$/;

export function resolveSecAmendmentLineage(input: {
  amendment: SecFilingIdentity;
  candidates: SecFilingIdentity[];
  evidence: SecLineageEvidence;
  affectedFacts?: SecAffectedFactEvidence[];
}): SecAmendmentLineageResolution {
  const { amendment, evidence } = input;
  const observationSeed = stableJson({
    amendment,
    candidates: input.candidates,
    evidence,
  });
  const unavailable = (reason: string): SecAmendmentLineageResolution => ({
    status: "unavailable_review",
    version: SEC_AMENDMENT_LINEAGE_VERSION,
    amendment,
    reason,
    evidence,
    observationKey: digest(`review|${reason}|${observationSeed}`),
  });

  const amendmentError = validateIdentity(amendment, true);
  if (amendmentError)
    return unavailable(`invalid_amendment_identity:${amendmentError}`);
  if (!validateEvidence(evidence, amendment))
    return unavailable("invalid_source_provenance");

  const formFamily = baseForm(amendment.formType);
  const target = extractExplicitTarget(evidence.amendmentExcerpt, formFamily);
  if (target.conflict) return unavailable(target.conflict);
  if (!target.formType || baseForm(target.formType) !== formFamily) {
    return unavailable("explicit_target_form_missing_or_mismatched");
  }
  if (!target.accessionNumber && !target.filedDate) {
    return unavailable("explicit_target_identity_missing");
  }

  const eligible = input.candidates.filter((candidate) => {
    if (validateIdentity(candidate, null)) return false;
    if (candidate.sourceCode !== amendment.sourceCode) return false;
    if (normalizeCik(candidate.issuerCik) !== normalizeCik(amendment.issuerCik))
      return false;
    if (baseForm(candidate.formType) !== formFamily) return false;
    if (candidate.accessionNumber === amendment.accessionNumber) return false;
    if (
      target.accessionNumber &&
      candidate.accessionNumber !== target.accessionNumber
    )
      return false;
    if (target.filedDate && candidate.filedDate !== target.filedDate)
      return false;
    return true;
  });

  if (eligible.length === 0) return unavailable("explicit_target_not_found");
  if (eligible.length !== 1) return unavailable("explicit_target_ambiguous");

  const operation = resolveOperation(evidence.amendmentExcerpt);
  if (operation.status === "unavailable") return unavailable(operation.reason);
  const factScopeEvidence = normalizeAffectedFacts(
    input.affectedFacts || [],
    evidence,
  );
  if (factScopeEvidence === null) return unavailable("invalid_fact_scope_evidence");
  const affectedFactKeys = factScopeEvidence.map((item) => item.semanticFactKey);
  if (
    (operation.operation === "REPLACE" ||
      operation.operation === "SUPPLEMENT") &&
    affectedFactKeys.length === 0
  ) {
    return unavailable("operation_scope_missing");
  }
  if (
    (operation.operation === "NOOP" || operation.operation === "CANCEL") &&
    affectedFactKeys.length > 0
  ) {
    return unavailable("operation_scope_must_be_empty");
  }

  const prior = eligible[0];
  const targetEvidence = target.accessionNumber
    ? `explicit accession ${target.accessionNumber}`
    : `explicit ${target.formType} filing date ${target.filedDate}`;
  return {
    status: "linked",
    version: SEC_AMENDMENT_LINEAGE_VERSION,
    amendment,
    prior,
    formFamily,
    operation: operation.operation,
    operationEvidence: operation.evidence,
    targetEvidence,
    affectedFactKeys,
    factScopeEvidence,
    evidence,
    observationKey: digest(
      stableJson({
        version: SEC_AMENDMENT_LINEAGE_VERSION,
        amendment: amendment.accessionNumber,
        prior: prior.accessionNumber,
        operation: operation.operation,
        affectedFactKeys,
        factScopeEvidence,
        evidence,
      }),
    ),
  };
}

export function projectSecFilingCurrentState(input: {
  root: SecFilingIdentity;
  observations: SecAmendmentLineageResolution[];
  facts: SecSemanticFactVersion[];
}): SecCurrentStateProjection {
  const rootFamily = baseForm(input.root.formType);
  const semanticEventIdentity = buildSecSemanticEventIdentity(input.root);
  let reviewObservationKeys: string[] = [];
  const unavailable = (reason: string): SecCurrentStateProjection => ({
    status: "unavailable_review",
    reason,
    semanticEventIdentity,
    rootAccessionNumber: input.root.accessionNumber,
    reviewObservationKeys,
  });

  const rootError = validateIdentity(input.root, false);
  if (rootError || input.root.formType.endsWith("/A"))
    return unavailable("invalid_root_identity");

  const linkedByObservationKey = new Map<
    string,
    Extract<SecAmendmentLineageResolution, { status: "linked" }>
  >();
  for (const item of input.observations) {
    if (item.status === "linked")
      linkedByObservationKey.set(item.observationKey, item);
  }
  const linked = [...linkedByObservationKey.values()];
  const edgeByPrior = new Map<string, typeof linked>();
  for (const edge of linked) {
    if (
      edge.formFamily !== rootFamily ||
      normalizeCik(edge.amendment.issuerCik) !==
        normalizeCik(input.root.issuerCik) ||
      normalizeCik(edge.prior.issuerCik) !== normalizeCik(input.root.issuerCik)
    )
      continue;
    const edges = edgeByPrior.get(edge.prior.accessionNumber) || [];
    edges.push(edge);
    edgeByPrior.set(edge.prior.accessionNumber, edges);
  }

  const factsByAccession = new Map<string, Map<string, SecSemanticFactVersion>>();
  for (const fact of input.facts) {
    if (!validateFact(fact)) return unavailable("invalid_fact_version");
    const items = factsByAccession.get(fact.sourceAccessionNumber) || new Map<string, SecSemanticFactVersion>();
    const existing = items.get(fact.semanticFactKey);
    if (existing && stableJson(semanticPayload(existing.factPayload)) !== stableJson(semanticPayload(fact.factPayload))) {
      return unavailable("conflicting_fact_versions");
    }
    items.set(fact.semanticFactKey, fact);
    factsByAccession.set(fact.sourceAccessionNumber, items);
  }

  const current = new Map<string, SecSemanticFactVersion>();
  for (const fact of factsByAccession.get(input.root.accessionNumber)?.values() || []) {
    current.set(fact.semanticFactKey, fact);
  }

  let head = input.root.accessionNumber;
  let cancelled = false;
  const visited = new Set<string>([head]);
  const appliedOperations: Extract<
    SecCurrentStateProjection,
    { status: "available" }
  >["appliedOperations"] = [];

  while (true) {
    const children = edgeByPrior.get(head) || [];
    if (children.length === 0) break;
    if (children.length > 1) return unavailable("conflicting_linked_children");
    const edge = children[0];
    if (visited.has(edge.amendment.accessionNumber))
      return unavailable("lineage_cycle");
    visited.add(edge.amendment.accessionNumber);
    const amendmentFacts = [...(
      factsByAccession.get(edge.amendment.accessionNumber)?.values() || []
    )];
    const amendmentKeys = amendmentFacts
      .map((fact) => fact.semanticFactKey)
      .sort();
    const affectedKeys = [...edge.affectedFactKeys].sort();

    if (cancelled && edge.operation !== "NOOP" && edge.operation !== "CANCEL") {
      return unavailable("cancelled_state_cannot_be_revived");
    }
    if (edge.operation === "NOOP") {
      if (amendmentFacts.length || affectedKeys.length)
        return unavailable("noop_has_fact_effect");
    } else if (edge.operation === "SUPPLEMENT") {
      if (!sameStrings(amendmentKeys, affectedKeys))
        return unavailable("supplement_scope_fact_mismatch");
      if (amendmentKeys.some((key) => current.has(key)))
        return unavailable("supplement_overwrites_current_fact");
      for (const fact of amendmentFacts)
        current.set(fact.semanticFactKey, fact);
    } else if (edge.operation === "REPLACE") {
      if (!sameStrings(amendmentKeys, affectedKeys))
        return unavailable("replace_scope_fact_mismatch");
      if (affectedKeys.some((key) => !current.has(key)))
        return unavailable("replace_target_fact_missing");
      for (const fact of amendmentFacts)
        current.set(fact.semanticFactKey, fact);
    } else {
      if (amendmentFacts.length || affectedKeys.length)
        return unavailable("cancel_has_fact_effect");
      current.clear();
      cancelled = true;
    }

    appliedOperations.push({
      amendmentAccessionNumber: edge.amendment.accessionNumber,
      priorAccessionNumber: edge.prior.accessionNumber,
      operation: edge.operation,
    });
    head = edge.amendment.accessionNumber;
  }

  reviewObservationKeys = input.observations
    .filter((item) => (
      item.status === "unavailable_review"
      && Boolean(item.reviewTarget)
      && visited.has(item.reviewTarget!.accessionNumber)
    ))
    .map((item) => item.observationKey)
    .sort();
  if (reviewObservationKeys.length) {
    return unavailable("unresolved_lineage_observation");
  }

  const facts = [...current.values()]
    .sort((left, right) =>
      left.semanticFactKey.localeCompare(right.semanticFactKey),
    )
    .map((fact) => ({
      ...fact,
      semanticEventIdentity,
      alertIdentity: buildSecAlertIdentity(input.root, fact.semanticFactKey),
    }));
  return {
    status: "available",
    semanticEventIdentity,
    rootAccessionNumber: input.root.accessionNumber,
    headAccessionNumber: head,
    cancelled,
    facts,
    appliedOperations,
    reviewObservationKeys,
  };
}

function semanticPayload(value: Record<string, unknown>) {
  const result = value.result;
  return result && typeof result === "object" && !Array.isArray(result)
    ? result as Record<string, unknown>
    : value;
}

export function buildSecSemanticEventIdentity(root: SecFilingIdentity) {
  return `sec-event:v1:${digest(`${normalizeCik(root.issuerCik)}|${baseForm(root.formType)}|${root.accessionNumber}`)}`;
}

export function buildSecAlertIdentity(
  root: SecFilingIdentity,
  semanticFactKey: string,
) {
  return `sec-alert:v1:${digest(`${buildSecSemanticEventIdentity(root)}|${semanticFactKey}`)}`;
}

export function buildSecFactHistoryKey(fact: SecSemanticFactVersion) {
  return digest(
    stableJson({
      rawItemId: fact.rawItemId,
      sourceAccessionNumber: fact.sourceAccessionNumber,
      semanticFactKey: fact.semanticFactKey,
      eventId: fact.eventId || null,
      sourceExecutionId: fact.sourceExecutionId || null,
      factPayload: fact.factPayload,
      sourceRef: fact.sourceRef,
    }),
  );
}

export function readSecAmendmentExplicitTarget(text: string, formFamily: string) {
  return extractExplicitTarget(text, formFamily);
}

function resolveOperation(text: string):
  | { status: "resolved"; operation: SecAmendmentOperation; evidence: string }
  | { status: "unavailable"; reason: string } {
  const sentences = splitSentences(text);
  const find = (patterns: RegExp[]) =>
    sentences.find((sentence) =>
      patterns.every((pattern) => pattern.test(sentence)),
    );

  const cancel =
    find([
      /\b(?:withdraws?|cancels?|rescinds?)\b[\s\S]{0,120}\b(?:original|prior)\s+(?:Form\s+[A-Z0-9/-]+|report|filing)\b/i,
    ]) ||
    find([
      /\b(?:original|prior)\s+(?:Form\s+[A-Z0-9/-]+|report|filing)(?:\s+in\s+its\s+entirety)?\s+(?:should not be relied upon|is no longer effective|is null and void)\b/i,
    ]);
  const safeCancel = cancel && isAffirmativeOperationSentence(cancel, /\b(?:withdraws?|cancels?|rescinds?|null\s+and\s+void|no\s+longer\s+effective|should\s+not\s+be\s+relied\s+upon)\b/i)
    ? cancel
    : null;

  const replace =
    find([
      /\b(?:supersedes and replaces|amends and restates)\b/i,
      /\b(?:entirety|original|prior|exhibit)\b/i,
    ]) ||
    find([
      /\b(?:correct(?:ed)?|revised)\s+version\b/i,
      /\b(?:exhibit|original|prior)\b/i,
    ]) ||
    find([
      /\b(?:filing|furnish(?:ing)?)\b[\s\S]{0,100}\b(?:revised|corrected)\b/i,
      /\b(?:correction|reclassification|replace)\b/i,
    ]) ||
    find([
      /\b(?:correct(?:ing|ed)?|clarifying)\b/i,
      /\b(?:effective\s+date|ratio|exercise\s+price|share\s+count|deadline|amount|terms?)\b[\s\S]{0,120}\b(?:changed\s+from|from\b[\s\S]{0,60}\bto|by\s+amending)\b/i,
    ]) ||
    find([
      /\b(?:solely\s+to\s+correct|correct(?:ing|ed)?)\b/i,
      /\b(?:effective\s+date|trading\s+date|date\b|ratio|exercise\s+price|share\s+count|deadline|amount|terms?)\b/i,
    ]);
  const safeReplace = replace && isAffirmativeOperationSentence(
    replace,
    /\b(?:supersedes|replaces?|amends\s+and\s+restates|correct(?:ed)?|revised|clarifying)\b/i,
  ) ? replace : null;

  const noopPurpose = find([
    /\b(?:sole(?:ly)?|only)\b/i,
    /\b(?:typographical|clerical|formatting|ixbrl|xbrl tagging|signature)\b/i,
  ]);
  const noopEffect = find([
    /\b(?:no|does not)\b/i,
    /\b(?:substantive|underlying|disclosure|information|fact)\b/i,
    /\b(?:change|amend|update)\b/i,
  ]);

  const supplement =
    find([/\b(?:amends and supplements|supplements)\b/i]) ||
    find([
      /\b(?:sole purpose|solely)\b/i,
      /\b(?:disclose|provide|add|report)\b/i,
    ]);
  const preservesOriginal =
    find([/\bno other changes\b/i]) ||
    find([
      /\b(?:all other information|except as described|otherwise)\b/i,
      /\b(?:remains unchanged|no other changes|does not otherwise change)\b/i,
    ]);
  const safeSupplement = supplement && isAffirmativeOperationSentence(
    supplement,
    /\b(?:amends\s+and\s+supplements|supplements|disclose|provide|add|report)\b/i,
  ) ? supplement : null;
  const candidates = [
    safeCancel ? { operation: "CANCEL" as const, evidence: safeCancel } : null,
    safeReplace ? { operation: "REPLACE" as const, evidence: safeReplace } : null,
    noopPurpose && noopEffect
      ? { operation: "NOOP" as const, evidence: `${noopPurpose} ${noopEffect}` }
      : null,
    safeSupplement && preservesOriginal
      ? { operation: "SUPPLEMENT" as const, evidence: `${safeSupplement} ${preservesOriginal}` }
      : null,
  ].filter((item): item is { operation: SecAmendmentOperation; evidence: string } => Boolean(item));
  const operations = [...new Set(candidates.map((item) => item.operation))];
  if (operations.length === 0) return { status: "unavailable", reason: "operation_not_source_established" };
  if (operations.length !== 1) return { status: "unavailable", reason: "operation_conflicting" };
  return { status: "resolved", ...candidates[0] };
}

function isAffirmativeOperationSentence(sentence: string, operation: RegExp) {
  const match = operation.exec(sentence);
  if (!match || match.index < 0) return false;
  if (/^\s*(?:if|unless|when|in\s+the\s+event|subject\s+to)\b/i.test(sentence)) return false;
  const prefix = sentence.slice(Math.max(0, match.index - 48), match.index);
  return !/\b(?:does|do|did|will|shall|would|could|is|are|was|were)\s+not\b[\s\S]*$/i.test(prefix)
    && !/\b(?:may|might|could|would|can|will|shall)\s+(?:hereby\s+)?$/i.test(prefix)
    && !/\b(?:not|never)\s+(?:intended\s+to\s+)?$/i.test(prefix);
}

function extractExplicitTarget(text: string, expectedFamily: string) {
  const accessions = [...new Set([...text.matchAll(/\baccession\s+(?:number|no\.?)\s*[:#]?\s*(\d{10}-\d{2}-\d{6})\b/gi)].map((match) => match[1]))];
  const accessionNumber = accessions.length === 1 ? accessions[0] : null;
  const familyPattern = escapeRegExp(expectedFamily).replace(/\\ /g, "\\s+");
  const formType = new RegExp(
    `\\bForm\\s+${familyPattern}(?!\\/A)\\b`,
    "i",
  ).test(text)
    ? expectedFamily
    : null;
  const datePattern =
    "([A-Z][a-z]+\\s+\\d{1,2},\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})";
  const formDates = [...text.matchAll(new RegExp(
    `\\bForm\\s+${familyPattern}(?!\\/A)\\b[\\s\\S]{0,420}?\\b(?:filed|furnished)\\b[\\s\\S]{0,260}?\\bon\\s+${datePattern}\\b`,
    "gi",
  ))].map((match) => normalizeDate(match[1])).filter(Boolean);
  const fallbackDates = formDates.length ? [] : [...text.matchAll(new RegExp(
    `\\b(?:filed|furnished)(?:\\s+with\\s+the\\s+(?:SEC|Securities and Exchange Commission))?\\s+(?:on\\s+)?${datePattern}\\b`,
    "gi",
  ))].map((match) => normalizeDate(match[1])).filter(Boolean);
  const dates = [...new Set([...formDates, ...fallbackDates])];
  return {
    accessionNumber,
    formType,
    filedDate: dates.length === 1 ? dates[0] : null,
    conflict: accessions.length > 1 || dates.length > 1 ? "explicit_target_conflicting" : null,
  };
}

function validateIdentity(
  identity: SecFilingIdentity,
  amendment: boolean | null,
) {
  if (identity.sourceCode !== "sec_edgar") return "source_code";
  if (!CIK_PATTERN.test(identity.issuerCik)) return "issuer_cik";
  if (!ACCESSION_PATTERN.test(identity.accessionNumber))
    return "accession_number";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(identity.filedDate)) return "filed_date";
  if (!baseForm(identity.formType)) return "form_type";
  if (
    amendment !== null &&
    amendment !== identity.formType.toUpperCase().endsWith("/A")
  )
    return "amendment_form_shape";
  if (
    !isOfficialSecUrl(identity.primaryDocumentUrl) ||
    !isOfficialSecUrl(identity.indexUrl)
  )
    return "sec_url";
  if (!urlMatchesIdentity(identity.primaryDocumentUrl, identity))
    return "primary_document_identity";
  if (!urlMatchesIdentity(identity.indexUrl, identity)) return "index_identity";
  return null;
}

function validateEvidence(
  evidence: SecLineageEvidence,
  amendment: SecFilingIdentity,
) {
  if (!evidence.amendmentExcerpt.trim()) return false;
  if (evidence.amendmentDocumentUrl !== amendment.primaryDocumentUrl)
    return false;
  if (evidence.amendmentIndexUrl !== amendment.indexUrl) return false;
  if (!submissionsUrlMatchesCik(evidence.submissionsUrl, amendment.issuerCik)) return false;
  if (evidence.amendmentDocumentSha256 && !/^[0-9a-f]{64}$/.test(evidence.amendmentDocumentSha256)) return false;
  if (evidence.amendmentExcerptSha256 && !/^[0-9a-f]{64}$/.test(evidence.amendmentExcerptSha256)) return false;
  return [
    evidence.amendmentDocumentUrl,
    evidence.amendmentIndexUrl,
    evidence.submissionsUrl,
  ].every(isOfficialSecUrl);
}

function validateFact(fact: SecSemanticFactVersion) {
  return Boolean(
    fact.rawItemId &&
    ACCESSION_PATTERN.test(fact.sourceAccessionNumber) &&
    FACT_KEY_PATTERN.test(fact.semanticFactKey) &&
    fact.factPayload &&
    typeof fact.factPayload === "object" &&
    !Array.isArray(fact.factPayload) &&
    isOfficialSecUrl(fact.sourceRef.url) &&
    factSourceMatchesIdentity(fact) &&
    fact.sourceRef.document.trim() &&
    fact.sourceRef.evidence.trim(),
  );
}

function urlMatchesIdentity(value: string, identity: SecFilingIdentity) {
  const url = new URL(value);
  const cik = normalizeCik(
    url.pathname.match(/\/Archives\/edgar\/data\/(\d+)\//i)?.[1] || "",
  );
  const compactAccession = identity.accessionNumber.replace(/-/g, "");
  return (
    cik === normalizeCik(identity.issuerCik) &&
    url.pathname.includes(`/${compactAccession}/`)
  );
}

function isOfficialSecUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "www.sec.gov" || url.hostname === "data.sec.gov")
    );
  } catch {
    return false;
  }
}

function baseForm(value: string) {
  const form = value.trim().toUpperCase().replace(/\s+/g, " ");
  return /^[A-Z0-9][A-Z0-9 -]{0,39}(?:\/A)?$/.test(form)
    ? form.replace(/\/A$/, "")
    : "";
}

function normalizeCik(value: string) {
  if (!CIK_PATTERN.test(value)) return "";
  return value.replace(/^0+(?=\d)/, "");
}

function submissionsUrlMatchesCik(value: string, cik: string) {
  try {
    const url = new URL(value);
    const expected = cik.padStart(10, "0");
    return url.hostname === "data.sec.gov" && url.pathname === `/submissions/CIK${expected}.json`;
  } catch {
    return false;
  }
}

function factSourceMatchesIdentity(fact: SecSemanticFactVersion) {
  try {
    const url = new URL(fact.sourceRef.url);
    const compact = fact.sourceAccessionNumber.replace(/-/g, "");
    return url.pathname.includes(`/${compact}/`) && decodeURIComponent(url.pathname.split("/").at(-1) || "") === fact.sourceRef.document;
  } catch {
    return false;
  }
}

function normalizeAffectedFacts(
  values: SecAffectedFactEvidence[],
  evidence: SecLineageEvidence,
) {
  const normalized = values.map((item) => ({
    semanticFactKey: item.semanticFactKey.trim(),
    evidence: item.evidence.replace(/\s+/g, " ").trim(),
    sourceUrl: item.sourceUrl.trim(),
  })).sort((left, right) => left.semanticFactKey.localeCompare(right.semanticFactKey));
  const excerpt = evidence.amendmentExcerpt.replace(/\s+/g, " ").trim().toLowerCase();
  if (new Set(normalized.map((item) => item.semanticFactKey)).size !== normalized.length) return null;
  return normalized.every((item) =>
    FACT_KEY_PATTERN.test(item.semanticFactKey)
    && item.sourceUrl === evidence.amendmentDocumentUrl
    && item.evidence.length >= 12
    && excerpt.includes(item.evidence.toLowerCase())
  ) ? normalized : null;
}

function normalizeDate(value: string | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(`${value} 00:00:00 UTC`);
  return Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
}

function normalizeFactKeys(values: string[]) {
  const keys = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort();
  return keys.every((key) => FACT_KEY_PATTERN.test(key)) ? keys : null;
}

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
}

function sameStrings(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
