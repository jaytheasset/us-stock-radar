import {
  DILUTION_IDENTITY_CLAIM_KINDS,
  DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE,
  DILUTION_IDENTITY_CLAIM_VERSION,
  DILUTION_IDENTITY_DECISION_VERSION,
  DILUTION_SOURCE_OBSERVATION_VERSION,
  normalizeIssuerCik,
  validateDilutionEvidenceIdentity,
  type DilutionEvidenceIdentity,
  type DilutionExposureType,
  type DilutionIdentityClaim,
  type DilutionIdentityClaimKind,
  type DilutionIdentityDecision,
  type DilutionIdentityDecisionReasonCode,
  type DilutionSourceObservation,
} from "./economicExposureContracts.ts";
import {
  ECONOMIC_EXPOSURE_IDENTITY_RULES as RULES,
  type ExposureIdentityRule,
} from "./economicExposureIdentityRules.ts";

/**
 * Pure comparison of source-backed claims. The resolver never reads source
 * text, creates an exposure ID, calls a provider, calculates economics, or
 * writes state. Claim values are compared by exact string equality after trim
 * and Unicode NFC normalization only; there is no case-folding or approximate path.
 */

export const ECONOMIC_EXPOSURE_IDENTITY_RESOLVER_VERSION =
  "economic_exposure_identity_resolver_v1" as const;

export type EconomicExposureIdentityCandidate = Readonly<{
  exposure_id: string;
  issuer_cik: string;
  exposure_type: DilutionExposureType;
  identity_claims: readonly DilutionIdentityClaim[];
  registration_canonical_keys?: readonly string[];
}>;

export type EconomicExposureIdentityCandidateReference = Readonly<{
  exposure_id: string;
  issuer_cik: string;
  exposure_type: DilutionExposureType;
}>;

export type EconomicExposureIdentityClaimReference = Readonly<{
  claim_kind: DilutionIdentityClaimKind;
  value: string;
  evidence_identity: DilutionEvidenceIdentity;
}>;

export type EconomicExposureStrongClaimComparison = Readonly<{
  candidate_exposure_id: string;
  observation_claim: EconomicExposureIdentityClaimReference;
  candidate_claim: EconomicExposureIdentityClaimReference;
}>;

export type EconomicExposureIdentityResolution = DilutionIdentityDecision & Readonly<{
  resolver_version: typeof ECONOMIC_EXPOSURE_IDENTITY_RESOLVER_VERSION;
  matched_strong_claims: readonly EconomicExposureStrongClaimComparison[];
  conflicting_strong_claims: readonly EconomicExposureStrongClaimComparison[];
  independent_strong_claims: readonly EconomicExposureIdentityClaimReference[];
  supporting_evidence_references: readonly DilutionEvidenceIdentity[];
  supporting_registration_matches: readonly string[];
  candidate_exposure_identity: EconomicExposureIdentityCandidateReference | null;
}>;

type NormalizedCandidate = Readonly<{
  exposureId: string;
  issuerCik: string;
  exposureType: DilutionExposureType;
  claims: readonly DilutionIdentityClaim[];
  registrationKeys: readonly string[];
  fingerprint: string;
}>;

type PairEvaluation = Readonly<{
  candidate: NormalizedCandidate;
  matched: readonly EconomicExposureStrongClaimComparison[];
  conflicting: readonly EconomicExposureStrongClaimComparison[];
  anchorMatch: boolean;
  primaryMatch: boolean;
  poolMatch: boolean;
  compositeMatch: boolean;
  contradictory: boolean;
  eligible: boolean;
}>;

const IDENTITY_OBSERVATION_KINDS = new Set([
  "exposure_identity",
  "exposure_terms",
  "exposure_amendment",
]);

/** Pairwise convenience over the explicit one-candidate set. */
export function evaluateExposureIdentityClaim(input: {
  observation: DilutionSourceObservation;
  candidateExposure: EconomicExposureIdentityCandidate;
}): EconomicExposureIdentityResolution {
  return resolveExposureIdentity({
    observation: input.observation,
    candidateExposures: [input.candidateExposure],
  });
}

/**
 * Resolves one observation against the complete candidate set supplied by the
 * caller. CREATE_NEW therefore means the observation carries independent
 * source-backed identity and does not resolve to that explicit set; it never
 * means merely "no candidate happened to match".
 */
export function resolveExposureIdentity(input: {
  observation: DilutionSourceObservation;
  candidateExposures: readonly EconomicExposureIdentityCandidate[];
  registration_canonical_keys?: readonly string[];
}): EconomicExposureIdentityResolution {
  const observation = input.observation;
  const observationClaims = sortClaims(validClaims(observation?.identity_claims));
  const observationRegistrationKeys = uniqueStrings(input.registration_canonical_keys ?? []);

  if (!validObservationStructure(observation)) {
    return resolution({
      observationClaims,
      reason: "EVIDENCE_VALIDATION_FAILED",
      decision: "UNRESOLVED",
    });
  }
  if (observation.exposure_type === null
    || !IDENTITY_OBSERVATION_KINDS.has(observation.observation_kind)) {
    return resolution({
      observationClaims,
      reason: "NON_EXPOSURE_OBSERVATION",
      decision: "UNRESOLVED",
    });
  }
  if (observation.status !== "VALIDATED") {
    return resolution({
      observationClaims,
      reason: "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
      decision: "UNRESOLVED",
    });
  }

  const normalizedCandidates = input.candidateExposures.map(normalizeCandidate);
  if (normalizedCandidates.some((candidate) => candidate === null)) {
    return resolution({
      observationClaims,
      reason: "EVIDENCE_VALIDATION_FAILED",
      decision: "UNRESOLVED",
    });
  }
  const candidates = dedupeCandidates(
    normalizedCandidates.filter((candidate): candidate is NormalizedCandidate => candidate !== null),
  );
  if (conflictingDuplicateExposureIds(candidates)) {
    return resolution({
      observationClaims,
      reason: "CONFLICTING_STRONG_IDENTITY_CLAIMS",
      decision: "CONFLICT",
      candidates,
    });
  }

  const issuerCik = normalizeIssuerCik(observation.issuer_cik)!;
  const exposureType = observation.exposure_type;
  const ruleSet = RULES[exposureType];
  const amendmentClaims = claimsOfKinds(observationClaims, ["amendment_reference"]);
  const hasAmendmentSemantics = amendmentClaims.length > 0
    || observation.observation_kind === "exposure_amendment";

  if (hasAmendmentSemantics) {
    return resolveAmendment({
      observationClaims,
      observationRegistrationKeys,
      issuerCik,
      exposureType,
      candidates,
      ruleSet,
      amendmentClaims,
    });
  }

  const foreignMatches = candidates
    .filter((candidate) => candidate.issuerCik !== issuerCik)
    .filter((candidate) => hasExplicitIdentityMatch(observationClaims, candidate.claims, ruleSet));
  if (foreignMatches.length) {
    return resolution({
      observationClaims,
      reason: "CROSS_ISSUER_IDENTITY_CONFLICT",
      decision: "CONFLICT",
      candidates: foreignMatches,
      matched: foreignMatches.flatMap((candidate) =>
        exactComparisons(observationClaims, candidate, ruleSet.strongKinds)),
    });
  }

  const typeMatches = candidates
    .filter((candidate) => candidate.issuerCik === issuerCik && candidate.exposureType !== exposureType)
    .filter((candidate) => hasSubtypeIdentityMatch(observationClaims, exposureType, candidate));
  if (typeMatches.length) {
    return resolution({
      observationClaims,
      reason: "EXPOSURE_TYPE_CONFLICT",
      decision: "CONFLICT",
      candidates: typeMatches,
      matched: typeMatches.flatMap((candidate) => exactComparisons(
        observationClaims,
        candidate,
        sharedPrimaryKinds(exposureType, candidate.exposureType),
      )),
    });
  }

  const pairs = candidates
    .filter((candidate) => candidate.issuerCik === issuerCik && candidate.exposureType === exposureType)
    .map((candidate) => evaluatePair(observationClaims, candidate, ruleSet));
  const contradictions = pairs.filter((pair) => pair.contradictory);
  if (contradictions.length) {
    return resolution({
      observationClaims,
      reason: "CONFLICTING_STRONG_IDENTITY_CLAIMS",
      decision: "CONFLICT",
      candidates: contradictions.map((pair) => pair.candidate),
      matched: contradictions.flatMap((pair) => pair.matched),
      conflicting: contradictions.flatMap((pair) => pair.conflicting),
    });
  }

  const eligible = pairs.filter((pair) => pair.eligible);
  if (eligible.length > 1) {
    return resolution({
      observationClaims,
      reason: "AMBIGUOUS_STRONG_IDENTITY_MATCH",
      decision: "CONFLICT",
      candidates: eligible.map((pair) => pair.candidate),
      matched: eligible.flatMap((pair) => pair.matched),
    });
  }
  if (eligible.length === 1) {
    const pair = eligible[0];
    return resolution({
      observationClaims,
      observationRegistrationKeys,
      reason: pair.matched.some((match) =>
        match.observation_claim.claim_kind === "original_instrument_reference")
        ? "EXPLICIT_SOURCE_REFERENCE_MATCH"
        : "SOURCE_BACKED_STRONG_IDENTITY_MATCH",
      decision: "LINK_EXISTING",
      candidate: pair.candidate,
      matched: pair.matched,
    });
  }

  const independentClaims = independentClaimReferences(observationClaims, ruleSet);
  if (independentClaims.length) {
    return resolution({
      observationClaims,
      reason: "SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY",
      decision: "CREATE_NEW",
      independent: independentClaims,
    });
  }
  return resolution({
    observationClaims,
    reason: "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
    decision: "UNRESOLVED",
  });
}

function resolveAmendment(input: {
  observationClaims: readonly DilutionIdentityClaim[];
  observationRegistrationKeys: readonly string[];
  issuerCik: string;
  exposureType: DilutionExposureType;
  candidates: readonly NormalizedCandidate[];
  ruleSet: ExposureIdentityRule;
  amendmentClaims: readonly DilutionIdentityClaim[];
}): EconomicExposureIdentityResolution {
  const targetMatches = input.candidates.flatMap((candidate) => {
    const matches = amendmentTargetComparisons(input.amendmentClaims, candidate, input.ruleSet);
    return matches.length ? [{ candidate, matches }] : [];
  });
  const crossIssuer = targetMatches.filter((match) => match.candidate.issuerCik !== input.issuerCik);
  if (crossIssuer.length) {
    return resolution({
      observationClaims: input.observationClaims,
      reason: "CROSS_ISSUER_IDENTITY_CONFLICT",
      decision: "CONFLICT",
      candidates: crossIssuer.map((match) => match.candidate),
      matched: crossIssuer.flatMap((match) => match.matches),
    });
  }
  const wrongType = targetMatches.filter((match) =>
    match.candidate.issuerCik === input.issuerCik
      && match.candidate.exposureType !== input.exposureType);
  if (wrongType.length) {
    return resolution({
      observationClaims: input.observationClaims,
      reason: "EXPOSURE_TYPE_CONFLICT",
      decision: "CONFLICT",
      candidates: wrongType.map((match) => match.candidate),
      matched: wrongType.flatMap((match) => match.matches),
    });
  }
  const targets = targetMatches.filter((match) =>
    match.candidate.issuerCik === input.issuerCik
      && match.candidate.exposureType === input.exposureType);
  if (targets.length > 1) {
    return resolution({
      observationClaims: input.observationClaims,
      reason: "AMBIGUOUS_AMENDMENT_TARGET",
      decision: "CONFLICT",
      candidates: targets.map((match) => match.candidate),
      matched: targets.flatMap((match) => match.matches),
    });
  }
  if (targets.length === 0) {
    return resolution({
      observationClaims: input.observationClaims,
      reason: "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
      decision: "UNRESOLVED",
    });
  }

  const target = targets[0];
  const nonAmendmentClaims = input.observationClaims.filter((claim) =>
    claim.claim_kind !== "amendment_reference");
  const pair = evaluatePair(nonAmendmentClaims, target.candidate, input.ruleSet);
  if (pair.contradictory) {
    return resolution({
      observationClaims: input.observationClaims,
      reason: "CONFLICTING_STRONG_IDENTITY_CLAIMS",
      decision: "CONFLICT",
      candidates: [target.candidate],
      matched: [...target.matches, ...pair.matched],
      conflicting: pair.conflicting,
    });
  }
  return resolution({
    observationClaims: input.observationClaims,
    observationRegistrationKeys: input.observationRegistrationKeys,
    reason: "EXPLICIT_AMENDMENT_REFERENCE_MATCH",
    decision: "AMEND_EXISTING",
    candidate: target.candidate,
    matched: [...target.matches, ...pair.matched],
  });
}

function evaluatePair(
  observationClaims: readonly DilutionIdentityClaim[],
  candidate: NormalizedCandidate,
  ruleSet: ExposureIdentityRule,
): PairEvaluation {
  const matched = exactComparisons(observationClaims, candidate, ruleSet.strongKinds);
  const conflicting = conflictingComparisons(observationClaims, candidate, ruleSet.strongKinds);
  const matchedKinds = new Set(matched.map((match) => match.observation_claim.claim_kind));
  const conflictingKinds = new Set(conflicting.map((match) => match.observation_claim.claim_kind));
  const primaryMatch = ruleSet.primaryKinds.some((kind) => matchedKinds.has(kind));
  const poolMatch = ruleSet.poolKinds.some((kind) => matchedKinds.has(kind));
  const compositeMatch = ruleSet.compositeKinds.some((kinds) =>
    kinds.every((kind) => matchedKinds.has(kind)));
  const independentMatch = ruleSet.independentKinds.some((kind) => matchedKinds.has(kind));
  const anchorMatch = independentMatch || compositeMatch;
  const separatingConflict = ruleSet.separatingKinds.some((kind) => conflictingKinds.has(kind));
  const poolConflict = ruleSet.poolKinds.some((kind) => conflictingKinds.has(kind));
  const primaryConflict = ruleSet.primaryKinds.some((kind) => conflictingKinds.has(kind));
  const contradictory = (primaryMatch && conflicting.length > 0)
    || (poolMatch && poolConflict)
    || (compositeMatch && conflicting.length > 0 && !primaryConflict);
  return {
    candidate,
    matched,
    conflicting,
    anchorMatch,
    primaryMatch,
    poolMatch,
    compositeMatch,
    contradictory,
    eligible: anchorMatch && !separatingConflict && !poolConflict,
  };
}

function resolution(input: {
  observationClaims: readonly DilutionIdentityClaim[];
  observationRegistrationKeys?: readonly string[];
  decision: DilutionIdentityDecision["decision"];
  reason: DilutionIdentityDecisionReasonCode;
  candidate?: NormalizedCandidate;
  candidates?: readonly NormalizedCandidate[];
  matched?: readonly EconomicExposureStrongClaimComparison[];
  conflicting?: readonly EconomicExposureStrongClaimComparison[];
  independent?: readonly EconomicExposureIdentityClaimReference[];
}): EconomicExposureIdentityResolution {
  const matched = sortComparisons(input.matched ?? []);
  const conflicting = sortComparisons(input.conflicting ?? []);
  const independent = sortClaimReferences(input.independent ?? []);
  const involvedCandidates = input.candidate
    ? [input.candidate]
    : [...(input.candidates ?? [])].sort(candidateSort);
  const referencedClaims = [
    ...matched.flatMap((match) => [match.observation_claim, match.candidate_claim]),
    ...conflicting.flatMap((match) => [match.observation_claim, match.candidate_claim]),
    ...independent,
  ];
  const fallbackClaims = input.observationClaims.map(publicClaim);
  const identityClaims = referencedClaims.length ? referencedClaims : fallbackClaims;
  const supportingClaims = [
    ...input.observationClaims.map(publicClaim),
    ...involvedCandidates.flatMap((candidate) => candidate.claims.map(publicClaim)),
  ];
  const registrationMatches = input.candidate
    ? intersectStrings(input.observationRegistrationKeys ?? [], input.candidate.registrationKeys)
    : [];
  return {
    version: DILUTION_IDENTITY_DECISION_VERSION,
    resolver_version: ECONOMIC_EXPOSURE_IDENTITY_RESOLVER_VERSION,
    decision: input.decision,
    reason_code: input.reason,
    target_exposure_id: input.candidate?.exposureId ?? null,
    identity_claim_kinds: sortClaimKinds(identityClaims.map((claim) => claim.claim_kind)),
    identity_evidence: evidenceFromClaimReferences(identityClaims),
    matched_strong_claims: matched,
    conflicting_strong_claims: conflicting,
    independent_strong_claims: independent,
    supporting_evidence_references: evidenceFromClaimReferences(supportingClaims),
    supporting_registration_matches: registrationMatches,
    candidate_exposure_identity: input.candidate
      ? {
          exposure_id: input.candidate.exposureId,
          issuer_cik: input.candidate.issuerCik,
          exposure_type: input.candidate.exposureType,
        }
      : null,
  };
}

function normalizeCandidate(value: EconomicExposureIdentityCandidate): NormalizedCandidate | null {
  const exposureId = stringValue(value?.exposure_id);
  const issuerCik = normalizeIssuerCik(value?.issuer_cik);
  const exposureType = value?.exposure_type;
  if (!exposureId || exposureId.length > 200 || !issuerCik || !RULES[exposureType]) return null;
  const claims = sortClaims(validClaims(value?.identity_claims));
  if (!Array.isArray(value?.identity_claims) || claims.length !== value.identity_claims.length) return null;
  if (claims.some((claim) => !claimAllowedForExposure(claim, exposureType))) return null;
  const registrationKeys = uniqueStrings(value.registration_canonical_keys ?? []);
  if ((value.registration_canonical_keys ?? []).length !== registrationKeys.length
    && (value.registration_canonical_keys ?? []).some((item) => !stringValue(item))) return null;
  const fingerprint = [
    exposureId,
    issuerCik,
    exposureType,
    claims.map(claimKey).join("|"),
    registrationKeys.join("|"),
  ].join("\u001f");
  return { exposureId, issuerCik, exposureType, claims, registrationKeys, fingerprint };
}

function validObservationStructure(value: DilutionSourceObservation) {
  if (!value || value.version !== DILUTION_SOURCE_OBSERVATION_VERSION) return false;
  const issuerCik = normalizeIssuerCik(value.issuer_cik);
  if (!issuerCik || issuerCik !== value.issuer_cik || !Array.isArray(value.identity_claims)) return false;
  if (value.exposure_type === null) return value.identity_claims.length === 0;
  if (!RULES[value.exposure_type]) return false;
  const claims = validClaims(value.identity_claims);
  return claims.length === value.identity_claims.length
    && claims.every((claim) => claimAllowedForExposure(claim, value.exposure_type!));
}

function validClaims(value: unknown): DilutionIdentityClaim[] {
  if (!Array.isArray(value)) return [];
  return value.filter((claim): claim is DilutionIdentityClaim => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) return false;
    const candidate = claim as DilutionIdentityClaim;
    return candidate.version === DILUTION_IDENTITY_CLAIM_VERSION
      && DILUTION_IDENTITY_CLAIM_KINDS.includes(candidate.claim_kind)
      && Boolean(exactValue(candidate.value))
      && candidate.value.length <= 1_000
      && validateDilutionEvidenceIdentity(candidate.evidence_identity).length === 0;
  });
}

function claimAllowedForExposure(claim: DilutionIdentityClaim, exposureType: DilutionExposureType) {
  return DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE[exposureType]
    .includes(claim.claim_kind as never);
}

function evaluateExactKind(
  observationClaims: readonly DilutionIdentityClaim[],
  candidateClaims: readonly DilutionIdentityClaim[],
  kind: DilutionIdentityClaimKind,
) {
  const observation = claimsOfKinds(observationClaims, [kind]);
  const candidate = claimsOfKinds(candidateClaims, [kind]);
  const candidateValues = new Set(candidate.map((claim) => exactValue(claim.value)));
  const matchedObservation = observation.filter((claim) => candidateValues.has(exactValue(claim.value)));
  return { observation, candidate, matchedObservation };
}

function exactComparisons(
  observationClaims: readonly DilutionIdentityClaim[],
  candidate: NormalizedCandidate,
  kinds: readonly DilutionIdentityClaimKind[],
) {
  const comparisons: EconomicExposureStrongClaimComparison[] = [];
  for (const kind of kinds) {
    if (kind === "amendment_reference") continue;
    const evaluated = evaluateExactKind(observationClaims, candidate.claims, kind);
    for (const observationClaim of evaluated.matchedObservation) {
      for (const candidateClaim of evaluated.candidate) {
        if (exactValue(observationClaim.value) !== exactValue(candidateClaim.value)) continue;
        comparisons.push(comparison(candidate, observationClaim, candidateClaim));
      }
    }
  }
  return sortComparisons(comparisons);
}

function conflictingComparisons(
  observationClaims: readonly DilutionIdentityClaim[],
  candidate: NormalizedCandidate,
  kinds: readonly DilutionIdentityClaimKind[],
) {
  const comparisons: EconomicExposureStrongClaimComparison[] = [];
  for (const kind of kinds) {
    if (kind === "amendment_reference") continue;
    const evaluated = evaluateExactKind(observationClaims, candidate.claims, kind);
    if (!evaluated.observation.length || !evaluated.candidate.length
      || evaluated.matchedObservation.length) continue;
    for (const observationClaim of evaluated.observation) {
      for (const candidateClaim of evaluated.candidate) {
        comparisons.push(comparison(candidate, observationClaim, candidateClaim));
      }
    }
  }
  return sortComparisons(comparisons);
}

function amendmentTargetComparisons(
  amendmentClaims: readonly DilutionIdentityClaim[],
  candidate: NormalizedCandidate,
  ruleSet: ExposureIdentityRule,
) {
  const targetKinds = ruleSet.strongKinds.filter((kind) => kind !== "amendment_reference");
  const targetClaims = claimsOfKinds(candidate.claims, targetKinds);
  const comparisons: EconomicExposureStrongClaimComparison[] = [];
  for (const amendmentClaim of amendmentClaims) {
    for (const targetClaim of targetClaims) {
      if (exactValue(amendmentClaim.value) === exactValue(targetClaim.value)) {
        comparisons.push(comparison(candidate, amendmentClaim, targetClaim));
      }
    }
  }
  return sortComparisons(comparisons);
}

function hasExplicitIdentityMatch(
  observationClaims: readonly DilutionIdentityClaim[],
  candidateClaims: readonly DilutionIdentityClaim[],
  ruleSet: ExposureIdentityRule,
) {
  const matchedKinds = new Set(ruleSet.strongKinds.filter((kind) => {
    const values = new Set(claimsOfKinds(candidateClaims, [kind]).map((claim) => exactValue(claim.value)));
    return claimsOfKinds(observationClaims, [kind]).some((claim) => values.has(exactValue(claim.value)));
  }));
  const conflictingPrimary = ruleSet.primaryKinds.some((kind) => {
    const observationValues = claimsOfKinds(observationClaims, [kind]);
    const candidateValues = claimsOfKinds(candidateClaims, [kind]);
    return observationValues.length > 0
      && candidateValues.length > 0
      && !matchedKinds.has(kind);
  });
  return ruleSet.independentKinds.some((kind) => matchedKinds.has(kind))
    || (!conflictingPrimary
      && ruleSet.compositeKinds.some((kinds) => kinds.every((kind) => matchedKinds.has(kind))));
}

function hasSubtypeIdentityMatch(
  observationClaims: readonly DilutionIdentityClaim[],
  observationType: DilutionExposureType,
  candidate: NormalizedCandidate,
) {
  return sharedPrimaryKinds(observationType, candidate.exposureType).some((kind) => {
    const candidateValues = new Set(claimsOfKinds(candidate.claims, [kind]).map((claim) => exactValue(claim.value)));
    return claimsOfKinds(observationClaims, [kind]).some((claim) =>
      candidateValues.has(exactValue(claim.value)));
  });
}

function sharedPrimaryKinds(left: DilutionExposureType, right: DilutionExposureType) {
  const rightKinds = new Set(RULES[right].primaryKinds);
  return RULES[left].primaryKinds.filter((kind) => rightKinds.has(kind));
}

function independentClaimReferences(
  claims: readonly DilutionIdentityClaim[],
  ruleSet: ExposureIdentityRule,
) {
  const references = claimsOfKinds(claims, ruleSet.independentKinds).map(publicClaim);
  for (const composite of ruleSet.compositeKinds) {
    if (composite.every((kind) => claimsOfKinds(claims, [kind]).length > 0)) {
      references.push(...claimsOfKinds(claims, composite).map(publicClaim));
    }
  }
  return sortClaimReferences(references);
}

function comparison(
  candidate: NormalizedCandidate,
  observationClaim: DilutionIdentityClaim,
  candidateClaim: DilutionIdentityClaim,
): EconomicExposureStrongClaimComparison {
  return {
    candidate_exposure_id: candidate.exposureId,
    observation_claim: publicClaim(observationClaim),
    candidate_claim: publicClaim(candidateClaim),
  };
}

function publicClaim(claim: DilutionIdentityClaim): EconomicExposureIdentityClaimReference {
  return {
    claim_kind: claim.claim_kind,
    value: claim.value,
    evidence_identity: claim.evidence_identity,
  };
}

function claimsOfKinds(
  claims: readonly DilutionIdentityClaim[],
  kinds: readonly DilutionIdentityClaimKind[],
) {
  const allowed = new Set(kinds);
  return claims.filter((claim) => allowed.has(claim.claim_kind));
}

function dedupeCandidates(candidates: readonly NormalizedCandidate[]) {
  return [...new Map(
    [...candidates].sort(candidateSort).map((candidate) => [candidate.fingerprint, candidate]),
  ).values()];
}

function conflictingDuplicateExposureIds(candidates: readonly NormalizedCandidate[]) {
  const fingerprintsById = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const fingerprints = fingerprintsById.get(candidate.exposureId) ?? new Set<string>();
    fingerprints.add(candidate.fingerprint);
    fingerprintsById.set(candidate.exposureId, fingerprints);
  }
  return [...fingerprintsById.values()].some((fingerprints) => fingerprints.size > 1);
}

function candidateSort(left: NormalizedCandidate, right: NormalizedCandidate) {
  return left.fingerprint.localeCompare(right.fingerprint);
}

function sortClaims(claims: readonly DilutionIdentityClaim[]) {
  return [...claims].sort((left, right) => claimKey(left).localeCompare(claimKey(right)));
}

function claimKey(claim: DilutionIdentityClaim) {
  return [claim.claim_kind, exactValue(claim.value), evidenceKey(claim.evidence_identity)].join("\u001f");
}

function sortComparisons(comparisons: readonly EconomicExposureStrongClaimComparison[]) {
  const byKey = new Map(comparisons.map((item) => [comparisonKey(item), item]));
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, item]) => item);
}

function comparisonKey(value: EconomicExposureStrongClaimComparison) {
  return [
    value.candidate_exposure_id,
    value.observation_claim.claim_kind,
    exactValue(value.observation_claim.value),
    value.candidate_claim.claim_kind,
    exactValue(value.candidate_claim.value),
    evidenceKey(value.observation_claim.evidence_identity),
    evidenceKey(value.candidate_claim.evidence_identity),
  ].join("\u001f");
}

function sortClaimReferences(claims: readonly EconomicExposureIdentityClaimReference[]) {
  const byKey = new Map(claims.map((claim) => [[
    claim.claim_kind,
    exactValue(claim.value),
    evidenceKey(claim.evidence_identity),
  ].join("\u001f"), claim]));
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, claim]) => claim);
}

function evidenceFromClaimReferences(claims: readonly EconomicExposureIdentityClaimReference[]) {
  const byKey = new Map(claims.map((claim) => [evidenceKey(claim.evidence_identity), claim.evidence_identity]));
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, evidence]) => evidence);
}

function evidenceKey(evidence: DilutionEvidenceIdentity) {
  return [
    evidence.source_ref,
    evidence.range_start,
    evidence.range_end,
    evidence.source_content_hash,
  ].join(":");
}

function sortClaimKinds(kinds: readonly DilutionIdentityClaimKind[]) {
  const order = new Map(DILUTION_IDENTITY_CLAIM_KINDS.map((kind, index) => [kind, index]));
  return uniqueClaimKinds(kinds).sort((left, right) =>
    (order.get(left) ?? 0) - (order.get(right) ?? 0));
}

function uniqueClaimKinds(kinds: readonly DilutionIdentityClaimKind[]) {
  return [...new Set(kinds)];
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map(stringValue).filter(Boolean))].sort();
}

function intersectStrings(left: readonly string[], right: readonly string[]) {
  const rightValues = new Set(right);
  return uniqueStrings(left).filter((value) => rightValues.has(value));
}

function exactValue(value: unknown) {
  return stringValue(value).normalize("NFC");
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
