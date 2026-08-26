import {
  DILUTION_REGISTRATION_OBSERVATION_KINDS,
  buildRegistrationCanonicalKey,
  normalizeIssuerCik,
  normalizeRegistrationFileNumber,
  validateDilutionEvidenceIdentity,
  type DilutionEvidenceIdentity,
  type DilutionFailClosedStatus,
  type DilutionRegistrationObservationKind,
} from "./economicExposureContracts.ts";

/**
 * Pure identity resolution only. This module does not read documents, call a
 * provider, calculate registration state, create Economic Exposures, or write
 * persistence. Claim evidence is structurally fail-closed here; source-range
 * authenticity remains the responsibility of the upstream evidence builder.
 */

export const REGISTRATION_IDENTITY_RESOLVER_VERSION =
  "registration_identity_resolver_v1" as const;

export const REGISTRATION_IDENTITY_RESOLUTION_BASES = [
  "EXACT_ISSUER_AND_REGISTRATION_FILE_NUMBER",
  "EXACT_PARENT_ACCESSION",
  "EXACT_NUMBER_AND_PARENT_ACCESSION_AGREE",
] as const;

export type RegistrationIdentityResolutionBasis =
  (typeof REGISTRATION_IDENTITY_RESOLUTION_BASES)[number];

export const REGISTRATION_IDENTITY_UNRESOLVED_REASONS = [
  "INVALID_ISSUER_CIK",
  "INVALID_ACCESSION",
  "UNSUPPORTED_FORM",
  "INVALID_OBSERVATION_KIND",
  "INVALID_FILED_DATE",
  "INVALID_ACCEPTED_AT",
  "EVIDENCE_IDENTITY_MISMATCH",
  "INVALID_REGISTRATION_FILE_NUMBER",
  "INVALID_PARENT_ACCESSION",
  "NO_SOURCE_BACKED_IDENTITY",
  "PARENT_ACCESSION_NOT_FOUND",
  "PARENT_REGISTRATION_UNRESOLVED",
] as const;

export type RegistrationIdentityUnresolvedReason =
  (typeof REGISTRATION_IDENTITY_UNRESOLVED_REASONS)[number];

export const REGISTRATION_IDENTITY_CONFLICT_REASONS = [
  "REGISTRATION_NUMBER_PARENT_DISAGREE",
  "CROSS_ISSUER_PARENT",
  "AMBIGUOUS_PARENT_ACCESSION",
  "AMBIGUOUS_ACCESSION_IDENTITY",
] as const;

export type RegistrationIdentityConflictReason =
  (typeof REGISTRATION_IDENTITY_CONFLICT_REASONS)[number];

export type RegistrationIdentitySourceClaim = Readonly<{
  value: string;
  evidence_identity: DilutionEvidenceIdentity;
}>;

export type RegistrationIdentityResolverObservation = Readonly<{
  issuer_cik: string;
  accession: string;
  form: string;
  filed_date: string;
  accepted_at: string | null;
  registration_number_claim: RegistrationIdentitySourceClaim | null;
  explicit_parent_accession_claim: RegistrationIdentitySourceClaim | null;
  observation_kind: DilutionRegistrationObservationKind;
  evidence_identities: readonly DilutionEvidenceIdentity[];
}>;

export type RegistrationIdentitySupportingObservation = Readonly<{
  issuer_cik: string | null;
  accession: string | null;
  form: string | null;
  filed_date: string | null;
  accepted_at: string | null;
  observation_kind: DilutionRegistrationObservationKind | null;
  claimed_registration_file_number: string | null;
  registration_file_number: string | null;
  claimed_parent_accession: string | null;
  parent_accession: string | null;
  resolution_basis: RegistrationIdentityResolutionBasis | null;
  evidence_identities: readonly DilutionEvidenceIdentity[];
}>;

export type RegistrationStrongIdentity = Readonly<{
  canonical_key: string;
  issuer_cik: string;
  registration_file_number: string;
  supporting_accessions: readonly string[];
  evidence_identities: readonly DilutionEvidenceIdentity[];
}>;

export type RegistrationIdentityResolved = Readonly<{
  version: typeof REGISTRATION_IDENTITY_RESOLVER_VERSION;
  status: "RESOLVED";
  canonical_key: string;
  issuer_cik: string;
  registration_file_number: string;
  resolution_bases: readonly RegistrationIdentityResolutionBasis[];
  supporting_observations: readonly RegistrationIdentitySupportingObservation[];
  supporting_accessions: readonly string[];
  evidence_identities: readonly DilutionEvidenceIdentity[];
}>;

export type RegistrationIdentityUnresolved = Readonly<{
  version: typeof REGISTRATION_IDENTITY_RESOLVER_VERSION;
  status: "UNRESOLVED";
  fail_closed_status: Extract<DilutionFailClosedStatus, "REGISTRATION_IDENTITY_UNRESOLVED">;
  reason: RegistrationIdentityUnresolvedReason;
  observation: RegistrationIdentitySupportingObservation;
  supporting_observations: readonly RegistrationIdentitySupportingObservation[];
  supporting_accessions: readonly string[];
  evidence_identities: readonly DilutionEvidenceIdentity[];
}>;

export type RegistrationIdentityConflict = Readonly<{
  version: typeof REGISTRATION_IDENTITY_RESOLVER_VERSION;
  status: "CONFLICT";
  fail_closed_status: Extract<DilutionFailClosedStatus, "IDENTITY_CONFLICT">;
  reason: RegistrationIdentityConflictReason;
  observation: RegistrationIdentitySupportingObservation;
  parent_accession: string | null;
  conflicting_issuer_ciks: readonly string[];
  conflicting_identities: readonly RegistrationStrongIdentity[];
  supporting_observations: readonly RegistrationIdentitySupportingObservation[];
  supporting_accessions: readonly string[];
  evidence_identities: readonly DilutionEvidenceIdentity[];
}>;

export type RegistrationIdentityResolution =
  | RegistrationIdentityResolved
  | RegistrationIdentityUnresolved
  | RegistrationIdentityConflict;

type NormalizedObservation = Readonly<{
  issuerCik: string | null;
  accession: string | null;
  form: string | null;
  filedDate: string | null;
  acceptedAt: string | null;
  observationKind: DilutionRegistrationObservationKind | null;
  claimedRegistrationFileNumber: string | null;
  registrationFileNumber: string | null;
  claimedParentAccession: string | null;
  parentAccession: string | null;
  evidenceIdentities: readonly DilutionEvidenceIdentity[];
  directIdentity: RegistrationStrongIdentity | null;
  invalidReason: RegistrationIdentityUnresolvedReason | null;
  sortKey: string;
}>;

type CandidateSupport = Map<string, Set<number>>;

type InternalDecision =
  | Readonly<{
      status: "RESOLVED";
      canonicalKey: string;
      basis: RegistrationIdentityResolutionBasis;
    }>
  | Readonly<{
      status: "UNRESOLVED";
      reason: RegistrationIdentityUnresolvedReason;
      supportIndices: ReadonlySet<number>;
    }>
  | Readonly<{
      status: "CONFLICT";
      reason: RegistrationIdentityConflictReason;
      candidateSupport: CandidateSupport;
      supportIndices: ReadonlySet<number>;
      parentAccession: string | null;
      issuerCiks: ReadonlySet<string>;
    }>;

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const SUPPORTED_NON_424B_FORMS = new Set([
  "S-1",
  "S-1/A",
  "S-3",
  "S-3/A",
  "F-1",
  "F-1/A",
  "F-3",
  "F-3/A",
  "S-3ASR",
  "F-3ASR",
  "EFFECT",
  "POS AM",
  "MEF",
  "S-1MEF",
  "S-3MEF",
  "F-1MEF",
  "F-3MEF",
]);
const RESOLUTION_BASIS_ORDER = new Map(
  REGISTRATION_IDENTITY_RESOLUTION_BASES.map((basis, index) => [basis, index]),
);

/**
 * Returns canonical registration groups plus fail-closed observation results.
 * Resolved observations sharing normalized issuer CIK + normalized 333 number
 * are emitted as one registration. Input order and exact duplicate inputs do
 * not affect the result.
 */
export function resolveRegistrationIdentities(
  input: readonly RegistrationIdentityResolverObservation[],
): readonly RegistrationIdentityResolution[] {
  const observations = dedupeNormalizedObservations(input.map(normalizeObservation));
  const accessionIndex = buildAccessionIndex(observations);
  const identityByKey = new Map<string, RegistrationStrongIdentity>();
  const candidateSupport = observations.map((observation, index) => {
    const candidates: CandidateSupport = new Map();
    if (observation.directIdentity) {
      identityByKey.set(observation.directIdentity.canonical_key, observation.directIdentity);
      candidates.set(observation.directIdentity.canonical_key, new Set([index]));
    }
    return candidates;
  });

  propagateExactParentCandidates(observations, accessionIndex, candidateSupport);

  const decisions = observations.map((observation, index) => decideObservation({
    observation,
    observationIndex: index,
    observations,
    accessionIndex,
    candidateSupport,
    identityByKey,
  }));

  return buildPublicResults(observations, decisions, identityByKey);
}

function normalizeObservation(
  input: RegistrationIdentityResolverObservation,
): NormalizedObservation {
  const issuerCik = normalizeIssuerCik(input?.issuer_cik);
  const accessionText = stringValue(input?.accession);
  const accession = ACCESSION_PATTERN.test(accessionText) ? accessionText : null;
  const formText = normalizeForm(input?.form);
  const form = isSupportedForm(formText) ? formText : null;
  const filedDateText = stringValue(input?.filed_date);
  const filedDate = validDate(filedDateText) ? filedDateText : null;
  const acceptedAtText = input?.accepted_at === null ? null : stringValue(input?.accepted_at);
  const acceptedAt = acceptedAtText === null || validTimestamp(acceptedAtText) ? acceptedAtText : null;
  const observationKind = includes(DILUTION_REGISTRATION_OBSERVATION_KINDS, input?.observation_kind)
    && validObservationKindForForm(input.observation_kind, formText)
    ? input.observation_kind
    : null;
  const evidenceInput = Array.isArray(input?.evidence_identities) ? input.evidence_identities : [];
  const evidenceIdentities = sortEvidenceIdentities(
    evidenceInput.filter((identity): identity is DilutionEvidenceIdentity =>
      validateDilutionEvidenceIdentity(identity).length === 0),
  );
  const evidenceIsValid = evidenceInput.length > 0
    && evidenceIdentities.length === evidenceInput.length;

  const registrationClaim = sourceClaim(input?.registration_number_claim);
  const claimedRegistrationFileNumber = registrationClaim?.value ?? null;
  const registrationFileNumber = claimedRegistrationFileNumber === null
    ? null
    : normalizeRegistrationFileNumber(claimedRegistrationFileNumber);
  const parentClaim = sourceClaim(input?.explicit_parent_accession_claim);
  const claimedParentAccession = parentClaim?.value ?? null;
  const parentAccession = claimedParentAccession !== null
    && ACCESSION_PATTERN.test(claimedParentAccession)
    && claimedParentAccession !== accession
    ? claimedParentAccession
    : null;
  const claimEvidenceIsValid = evidenceIsValid
    && (registrationClaim === null
      || evidenceIdentityIncluded(registrationClaim.evidence_identity, evidenceIdentities))
    && (parentClaim === null
      || evidenceIdentityIncluded(parentClaim.evidence_identity, evidenceIdentities));

  let invalidReason: RegistrationIdentityUnresolvedReason | null = null;
  if (!issuerCik) invalidReason = "INVALID_ISSUER_CIK";
  else if (!accession) invalidReason = "INVALID_ACCESSION";
  else if (!form) invalidReason = "UNSUPPORTED_FORM";
  else if (!observationKind) invalidReason = "INVALID_OBSERVATION_KIND";
  else if (!filedDate) invalidReason = "INVALID_FILED_DATE";
  else if (input.accepted_at !== null && !acceptedAtText) invalidReason = "INVALID_ACCEPTED_AT";
  else if (acceptedAtText !== null && !validTimestamp(acceptedAtText)) invalidReason = "INVALID_ACCEPTED_AT";
  else if (!claimEvidenceIsValid) invalidReason = "EVIDENCE_IDENTITY_MISMATCH";
  else if (input.registration_number_claim !== null
    && (!registrationClaim || !registrationFileNumber)) {
    invalidReason = "INVALID_REGISTRATION_FILE_NUMBER";
  } else if (input.explicit_parent_accession_claim !== null
    && (!parentClaim || !parentAccession)) {
    invalidReason = "INVALID_PARENT_ACCESSION";
  }

  const canonicalKey = invalidReason === null && issuerCik && registrationFileNumber
    ? buildRegistrationCanonicalKey({
        issuer_cik: issuerCik,
        registration_file_number: registrationFileNumber,
      })
    : null;
  const directIdentity = canonicalKey && issuerCik && registrationFileNumber
    ? {
        canonical_key: canonicalKey,
        issuer_cik: issuerCik,
        registration_file_number: registrationFileNumber,
        supporting_accessions: accession ? [accession] : [],
        evidence_identities: evidenceIdentities,
      } satisfies RegistrationStrongIdentity
    : null;
  const sortKey = [
    accession ?? accessionText,
    issuerCik ?? stringValue(input?.issuer_cik),
    form ?? formText,
    filedDate ?? filedDateText,
    claimedRegistrationFileNumber ?? "",
    claimedParentAccession ?? "",
    observationKind ?? stringValue(input?.observation_kind),
    evidenceIdentities.map(evidenceIdentityKey).join(","),
  ].join("\u001f");

  return {
    issuerCik,
    accession,
    form,
    filedDate,
    acceptedAt,
    observationKind,
    claimedRegistrationFileNumber,
    registrationFileNumber,
    claimedParentAccession,
    parentAccession,
    evidenceIdentities,
    directIdentity,
    invalidReason,
    sortKey,
  };
}

function dedupeNormalizedObservations(observations: readonly NormalizedObservation[]) {
  const sorted = [...observations].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  return sorted.filter((observation, index) => index === 0 || observation.sortKey !== sorted[index - 1].sortKey);
}

function buildAccessionIndex(observations: readonly NormalizedObservation[]) {
  const index = new Map<string, number[]>();
  for (const [observationIndex, observation] of observations.entries()) {
    if (!observation.accession) continue;
    const existing = index.get(observation.accession) ?? [];
    existing.push(observationIndex);
    index.set(observation.accession, existing);
  }
  return index;
}

function propagateExactParentCandidates(
  observations: readonly NormalizedObservation[],
  accessionIndex: ReadonlyMap<string, readonly number[]>,
  candidateSupport: CandidateSupport[],
) {
  const maximumPasses = observations.length * Math.max(1, observations.length) + 1;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let changed = false;
    const next = candidateSupport.map(cloneCandidateSupport);
    for (const [observationIndex, observation] of observations.entries()) {
      if (observation.invalidReason || !observation.parentAccession) continue;
      const targets = accessionIndex.get(observation.parentAccession) ?? [];
      for (const targetIndex of targets) {
        for (const [canonicalKey, sourceIndices] of candidateSupport[targetIndex]) {
          const target = next[observationIndex].get(canonicalKey) ?? new Set<number>();
          if (!target.has(observationIndex)) {
            target.add(observationIndex);
            changed = true;
          }
          for (const sourceIndex of sourceIndices) {
            if (!target.has(sourceIndex)) {
              target.add(sourceIndex);
              changed = true;
            }
          }
          next[observationIndex].set(canonicalKey, target);
        }
      }
    }
    candidateSupport.splice(0, candidateSupport.length, ...next);
    if (!changed) break;
  }
}

function decideObservation(input: {
  observation: NormalizedObservation;
  observationIndex: number;
  observations: readonly NormalizedObservation[];
  accessionIndex: ReadonlyMap<string, readonly number[]>;
  candidateSupport: readonly CandidateSupport[];
  identityByKey: ReadonlyMap<string, RegistrationStrongIdentity>;
}): InternalDecision {
  const {
    observation,
    observationIndex,
    observations,
    accessionIndex,
    candidateSupport,
    identityByKey,
  } = input;
  if (observation.invalidReason) {
    return {
      status: "UNRESOLVED",
      reason: observation.invalidReason,
      supportIndices: new Set([observationIndex]),
    };
  }

  const ownAccessionIndices = observation.accession
    ? accessionIndex.get(observation.accession) ?? [observationIndex]
    : [observationIndex];
  const ownAccessionCandidates = collectCandidateSupport(ownAccessionIndices, candidateSupport);
  const directKey = observation.directIdentity?.canonical_key ?? null;

  if (observation.parentAccession) {
    const parentIndices = accessionIndex.get(observation.parentAccession) ?? [];
    if (parentIndices.length === 0) {
      if (directKey) return resolvedDecision(directKey, "EXACT_ISSUER_AND_REGISTRATION_FILE_NUMBER");
      return {
        status: "UNRESOLVED",
        reason: "PARENT_ACCESSION_NOT_FOUND",
        supportIndices: new Set([observationIndex]),
      };
    }

    const parentCandidates = collectCandidateSupport(parentIndices, candidateSupport);
    const parentIssuerCiks = new Set(
      parentIndices
        .map((index) => observations[index].issuerCik)
        .filter((issuerCik): issuerCik is string => Boolean(issuerCik)),
    );
    const candidateIssuerCiks = new Set(
      [...parentCandidates.keys()]
        .map((canonicalKey) => identityByKey.get(canonicalKey)?.issuer_cik ?? null)
        .filter((issuerCik): issuerCik is string => Boolean(issuerCik)),
    );
    const crossIssuer = [...parentIssuerCiks, ...candidateIssuerCiks]
      .some((issuerCik) => issuerCik !== observation.issuerCik);
    if (crossIssuer) {
      return conflictDecision({
        reason: "CROSS_ISSUER_PARENT",
        observationIndex,
        parentAccession: observation.parentAccession,
        candidates: mergeCandidateSupports(candidateSupport[observationIndex], parentCandidates),
        additionalSupportIndices: parentIndices,
        issuerCiks: [observation.issuerCik, ...parentIssuerCiks, ...candidateIssuerCiks],
      });
    }
    if (parentCandidates.size > 1) {
      return conflictDecision({
        reason: "AMBIGUOUS_PARENT_ACCESSION",
        observationIndex,
        parentAccession: observation.parentAccession,
        candidates: mergeCandidateSupports(candidateSupport[observationIndex], parentCandidates),
        additionalSupportIndices: parentIndices,
        issuerCiks: [observation.issuerCik, ...parentIssuerCiks],
      });
    }

    const parentKey = firstMapKey(parentCandidates);
    if (directKey && parentKey && directKey !== parentKey) {
      return conflictDecision({
        reason: "REGISTRATION_NUMBER_PARENT_DISAGREE",
        observationIndex,
        parentAccession: observation.parentAccession,
        candidates: mergeCandidateSupports(candidateSupport[observationIndex], parentCandidates),
        additionalSupportIndices: parentIndices,
        issuerCiks: [observation.issuerCik],
      });
    }
    if (ownAccessionCandidates.size > 1) {
      return conflictDecision({
        reason: "AMBIGUOUS_ACCESSION_IDENTITY",
        observationIndex,
        parentAccession: observation.parentAccession,
        candidates: ownAccessionCandidates,
        additionalSupportIndices: ownAccessionIndices,
        issuerCiks: [observation.issuerCik],
      });
    }
    if (directKey && parentKey === directKey) {
      return resolvedDecision(directKey, "EXACT_NUMBER_AND_PARENT_ACCESSION_AGREE");
    }
    if (directKey) return resolvedDecision(directKey, "EXACT_ISSUER_AND_REGISTRATION_FILE_NUMBER");
    if (parentKey) return resolvedDecision(parentKey, "EXACT_PARENT_ACCESSION");
    return {
      status: "UNRESOLVED",
      reason: "PARENT_REGISTRATION_UNRESOLVED",
      supportIndices: new Set([observationIndex, ...parentIndices]),
    };
  }

  if (ownAccessionCandidates.size > 1) {
    return conflictDecision({
      reason: "AMBIGUOUS_ACCESSION_IDENTITY",
      observationIndex,
      parentAccession: null,
      candidates: ownAccessionCandidates,
      additionalSupportIndices: ownAccessionIndices,
      issuerCiks: ownAccessionIndices.map((index) => observations[index].issuerCik),
    });
  }
  if (directKey) return resolvedDecision(directKey, "EXACT_ISSUER_AND_REGISTRATION_FILE_NUMBER");
  return {
    status: "UNRESOLVED",
    reason: "NO_SOURCE_BACKED_IDENTITY",
    supportIndices: new Set([observationIndex]),
  };
}

function resolvedDecision(
  canonicalKey: string,
  basis: RegistrationIdentityResolutionBasis,
): InternalDecision {
  return { status: "RESOLVED", canonicalKey, basis };
}

function conflictDecision(input: {
  reason: RegistrationIdentityConflictReason;
  observationIndex: number;
  parentAccession: string | null;
  candidates: CandidateSupport;
  additionalSupportIndices: readonly number[];
  issuerCiks: readonly (string | null)[];
}): InternalDecision {
  const supportIndices = new Set([input.observationIndex, ...input.additionalSupportIndices]);
  for (const indices of input.candidates.values()) {
    for (const index of indices) supportIndices.add(index);
  }
  return {
    status: "CONFLICT",
    reason: input.reason,
    candidateSupport: input.candidates,
    supportIndices,
    parentAccession: input.parentAccession,
    issuerCiks: new Set(input.issuerCiks.filter((value): value is string => Boolean(value))),
  };
}

function buildPublicResults(
  observations: readonly NormalizedObservation[],
  decisions: readonly InternalDecision[],
  identityByKey: ReadonlyMap<string, RegistrationStrongIdentity>,
): readonly RegistrationIdentityResolution[] {
  const resolvedGroups = new Map<string, number[]>();
  for (const [index, decision] of decisions.entries()) {
    if (decision.status !== "RESOLVED") continue;
    const indices = resolvedGroups.get(decision.canonicalKey) ?? [];
    indices.push(index);
    resolvedGroups.set(decision.canonicalKey, indices);
  }

  const resolved: RegistrationIdentityResolved[] = [...resolvedGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([canonicalKey, indices]) => {
      const identity = identityByKey.get(canonicalKey);
      if (!identity) throw new Error(`registration identity invariant failed for ${canonicalKey}`);
      const supportingObservations = projectSupportingObservations(indices, observations, decisions);
      return {
        version: REGISTRATION_IDENTITY_RESOLVER_VERSION,
        status: "RESOLVED",
        canonical_key: canonicalKey,
        issuer_cik: identity.issuer_cik,
        registration_file_number: identity.registration_file_number,
        resolution_bases: uniqueResolutionBases(indices.map((index) => {
          const decision = decisions[index];
          return decision.status === "RESOLVED" ? decision.basis : null;
        })),
        supporting_observations: supportingObservations,
        supporting_accessions: supportingAccessions(supportingObservations),
        evidence_identities: evidenceFromObservations(supportingObservations),
      };
    });

  const conflicts: RegistrationIdentityConflict[] = [];
  const unresolved: RegistrationIdentityUnresolved[] = [];
  for (const [index, decision] of decisions.entries()) {
    if (decision.status === "CONFLICT") {
      const supportIndices = [...decision.supportIndices];
      const supportingObservations = projectSupportingObservations(supportIndices, observations, decisions);
      conflicts.push({
        version: REGISTRATION_IDENTITY_RESOLVER_VERSION,
        status: "CONFLICT",
        fail_closed_status: "IDENTITY_CONFLICT",
        reason: decision.reason,
        observation: projectObservation(index, observations, decisions),
        parent_accession: decision.parentAccession,
        conflicting_issuer_ciks: [...decision.issuerCiks].sort(),
        conflicting_identities: [...decision.candidateSupport.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([canonicalKey, sourceIndices]) => publicStrongIdentity(
            canonicalKey,
            sourceIndices,
            observations,
            decisions,
            identityByKey,
          )),
        supporting_observations: supportingObservations,
        supporting_accessions: supportingAccessions(supportingObservations),
        evidence_identities: evidenceFromObservations(supportingObservations),
      });
    } else if (decision.status === "UNRESOLVED") {
      const supportingObservations = projectSupportingObservations(
        [...decision.supportIndices],
        observations,
        decisions,
      );
      unresolved.push({
        version: REGISTRATION_IDENTITY_RESOLVER_VERSION,
        status: "UNRESOLVED",
        fail_closed_status: "REGISTRATION_IDENTITY_UNRESOLVED",
        reason: decision.reason,
        observation: projectObservation(index, observations, decisions),
        supporting_observations: supportingObservations,
        supporting_accessions: supportingAccessions(supportingObservations),
        evidence_identities: evidenceFromObservations(supportingObservations),
      });
    }
  }

  conflicts.sort((left, right) => observationOutputSortKey(left.observation)
    .localeCompare(observationOutputSortKey(right.observation)));
  unresolved.sort((left, right) => observationOutputSortKey(left.observation)
    .localeCompare(observationOutputSortKey(right.observation)));
  return [...resolved, ...conflicts, ...unresolved];
}

function publicStrongIdentity(
  canonicalKey: string,
  sourceIndices: ReadonlySet<number>,
  observations: readonly NormalizedObservation[],
  decisions: readonly InternalDecision[],
  identityByKey: ReadonlyMap<string, RegistrationStrongIdentity>,
): RegistrationStrongIdentity {
  const identity = identityByKey.get(canonicalKey);
  if (!identity) throw new Error(`registration candidate invariant failed for ${canonicalKey}`);
  const support = projectSupportingObservations([...sourceIndices], observations, decisions);
  return {
    canonical_key: canonicalKey,
    issuer_cik: identity.issuer_cik,
    registration_file_number: identity.registration_file_number,
    supporting_accessions: supportingAccessions(support),
    evidence_identities: evidenceFromObservations(support),
  };
}

function projectSupportingObservations(
  indices: readonly number[],
  observations: readonly NormalizedObservation[],
  decisions: readonly InternalDecision[],
) {
  return [...new Set(indices)]
    .map((index) => projectObservation(index, observations, decisions))
    .sort((left, right) => observationOutputSortKey(left).localeCompare(observationOutputSortKey(right)));
}

function projectObservation(
  index: number,
  observations: readonly NormalizedObservation[],
  decisions: readonly InternalDecision[],
): RegistrationIdentitySupportingObservation {
  const observation = observations[index];
  const decision = decisions[index];
  return {
    issuer_cik: observation.issuerCik,
    accession: observation.accession,
    form: observation.form,
    filed_date: observation.filedDate,
    accepted_at: observation.acceptedAt,
    observation_kind: observation.observationKind,
    claimed_registration_file_number: observation.claimedRegistrationFileNumber,
    registration_file_number: observation.registrationFileNumber,
    claimed_parent_accession: observation.claimedParentAccession,
    parent_accession: observation.parentAccession,
    resolution_basis: decision.status === "RESOLVED" ? decision.basis : null,
    evidence_identities: observation.evidenceIdentities,
  };
}

function observationOutputSortKey(observation: RegistrationIdentitySupportingObservation) {
  return [
    observation.filed_date ?? "",
    observation.accepted_at ?? "",
    observation.accession ?? "",
    observation.form ?? "",
    observation.issuer_cik ?? "",
    observation.claimed_registration_file_number ?? "",
    observation.claimed_parent_accession ?? "",
  ].join("\u001f");
}

function collectCandidateSupport(
  indices: readonly number[],
  candidateSupport: readonly CandidateSupport[],
) {
  const collected: CandidateSupport = new Map();
  for (const index of indices) mergeCandidateSupportInto(collected, candidateSupport[index]);
  return collected;
}

function mergeCandidateSupports(left: CandidateSupport, right: CandidateSupport) {
  const merged = cloneCandidateSupport(left);
  mergeCandidateSupportInto(merged, right);
  return merged;
}

function mergeCandidateSupportInto(target: CandidateSupport, source: CandidateSupport) {
  for (const [canonicalKey, sourceIndices] of source) {
    const targetIndices = target.get(canonicalKey) ?? new Set<number>();
    for (const index of sourceIndices) targetIndices.add(index);
    target.set(canonicalKey, targetIndices);
  }
}

function cloneCandidateSupport(source: CandidateSupport) {
  return new Map([...source.entries()].map(([canonicalKey, indices]) => [
    canonicalKey,
    new Set(indices),
  ]));
}

function firstMapKey(value: CandidateSupport) {
  return value.size === 1 ? value.keys().next().value as string : null;
}

function sourceClaim(value: unknown): RegistrationIdentitySourceClaim | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const claim = value as Record<string, unknown>;
  const claimValue = stringValue(claim.value);
  if (!claimValue || validateDilutionEvidenceIdentity(claim.evidence_identity).length > 0) return null;
  return {
    value: claimValue,
    evidence_identity: claim.evidence_identity as DilutionEvidenceIdentity,
  };
}

function evidenceIdentityIncluded(
  identity: DilutionEvidenceIdentity,
  evidenceIdentities: readonly DilutionEvidenceIdentity[],
) {
  const key = evidenceIdentityKey(identity);
  return evidenceIdentities.some((candidate) => evidenceIdentityKey(candidate) === key);
}

function evidenceIdentityKey(identity: DilutionEvidenceIdentity) {
  return [
    identity.version,
    identity.source_ref,
    identity.range_start,
    identity.range_end,
    identity.source_content_hash,
    identity.exact_source,
  ].join(":");
}

function sortEvidenceIdentities(evidenceIdentities: readonly DilutionEvidenceIdentity[]) {
  const byIdentity = new Map(
    evidenceIdentities.map((identity) => [evidenceIdentityKey(identity), identity]),
  );
  return [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, identity]) => identity);
}

function evidenceFromObservations(
  observations: readonly RegistrationIdentitySupportingObservation[],
) {
  return sortEvidenceIdentities(observations.flatMap((observation) => observation.evidence_identities));
}

function supportingAccessions(
  observations: readonly RegistrationIdentitySupportingObservation[],
) {
  return [...new Set(observations
    .map((observation) => observation.accession)
    .filter((accession): accession is string => Boolean(accession)))];
}

function uniqueResolutionBases(
  values: readonly (RegistrationIdentityResolutionBasis | null)[],
) {
  return [...new Set(values.filter((value): value is RegistrationIdentityResolutionBasis => Boolean(value)))]
    .sort((left, right) =>
      (RESOLUTION_BASIS_ORDER.get(left) ?? 0) - (RESOLUTION_BASIS_ORDER.get(right) ?? 0));
}

function normalizeForm(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, " ");
}

function isSupportedForm(value: string) {
  return SUPPORTED_NON_424B_FORMS.has(value) || /^424B(?:[1-5]|7|8)?$/.test(value);
}

function validObservationKindForForm(
  kind: DilutionRegistrationObservationKind,
  form: string,
) {
  if (kind === "automatically_effective") return form === "S-3ASR" || form === "F-3ASR";
  if (kind === "effectiveness_declared") return form === "EFFECT";
  if (kind === "prospectus_supplement") return /^424B(?:[1-5]|7|8)?$/.test(form);
  return true;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: string) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function includes<TValue>(values: readonly TValue[], value: unknown): value is TValue {
  return values.includes(value as TValue);
}
