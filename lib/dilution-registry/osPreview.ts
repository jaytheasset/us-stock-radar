import {
  extractLevel2ShareCountSidecar,
  type Level2ShareCountSourceDocument,
} from "../sec-structured-data/level2ShareCountObservation.ts";
import type {
  DilutionRegistryPayload,
  DilutionRegistryRecord,
} from "./preview.ts";
import { isSafeSecSourceRef } from "./osPreviewSecFallback.ts";

export const DILUTION_REGISTRY_OS_OBSERVATION_FIELD = "os_observations" as const;

export type DilutionRegistryOsPreviewStatus =
  | "Verified"
  | "Review"
  | "Not Verified";

export type DilutionRegistryOsPreviewRow = {
  index: number;
  status: DilutionRegistryOsPreviewStatus;
  sharesOutstanding: string | null;
  asOf: string | null;
  securityClassTitle: string | null;
  sourceAccession: string | null;
  sourceForm: string | null;
  sourceRef: string | null;
  sourceCheck: string;
  evidence: string | null;
  reasons: string[];
};

export type DilutionRegistryOsStoredDocument = Level2ShareCountSourceDocument & {
  source_url: string;
};

export type DilutionRegistryOsSourceBundle = {
  ok: boolean;
  errorReason?: string;
  sourceMode: "stored" | "official_sec_fallback" | null;
  classUniverseMode: "exact_filing" | "issuer_reference" | null;
  ledger: {
    issuer_cik: string;
    accession_number: string;
    form: string;
    primary_document: string;
  } | null;
  documents: DilutionRegistryOsStoredDocument[];
  classUniverse: {
    issuer_cik: string;
    source_accession: string;
    source_form: string;
    universe_as_of: string;
    source_documents: unknown;
    status: string;
    reason: string;
    required_canonical_security_class_ids: unknown;
    class_evidence: unknown;
  } | null;
};

export type DilutionRegistryOsPreviewDependencies = {
  readSourceBundle: (
    accessionNumber: string,
    context: {
      issuerCik: string;
      asOf: string;
      sourceForm: string;
      sourceRef: string;
    },
  ) => Promise<DilutionRegistryOsSourceBundle>;
};

const REQUIRED_KEYS = [
  "observation_type",
  "shares_outstanding",
  "as_of",
  "security_class_kind",
  "security_class_title",
  "source_accession",
  "source_form",
  "source_ref",
  "evidence",
] as const;

export async function validateDilutionRegistryOsPreview(
  payload: DilutionRegistryPayload,
  dependencies: DilutionRegistryOsPreviewDependencies,
): Promise<DilutionRegistryOsPreviewRow[]> {
  const rows = payload.os_observations ?? [];
  const issuerCik = readIssuerCik(payload.issuer);
  const bundleReads = new Map<string, Promise<DilutionRegistryOsSourceBundle>>();

  return Promise.all(
    rows.map(async (value, index) => {
      const candidate = record(value);
      if (!candidate) {
        return notVerified(index, null, ["Observation row must be an object."]);
      }

      const display = displayValues(candidate);
      const shapeErrors = exactCandidateShapeErrors(candidate);
      if (!issuerCik) {
        shapeErrors.push("issuer.issuer_cik or issuer.cik must be one exact non-zero ten-digit CIK.");
      }
      if (shapeErrors.length) return notVerified(index, display, shapeErrors);

      const accession = text(candidate.source_accession);
      const bundleKey = [
        issuerCik,
        accession,
        text(candidate.as_of),
        text(candidate.source_form),
        text(candidate.source_ref),
      ].join("|");
      let bundleRead = bundleReads.get(bundleKey);
      if (!bundleRead) {
        bundleRead = dependencies.readSourceBundle(accession, {
          issuerCik,
          asOf: text(candidate.as_of),
          sourceForm: text(candidate.source_form),
          sourceRef: text(candidate.source_ref),
        });
        bundleReads.set(bundleKey, bundleRead);
      }
      const bundle = await bundleRead;
      if (!bundle.ok) {
        return notVerified(index, display, [
          bundle.errorReason ||
            "The local or official SEC source check was unavailable and failed closed.",
        ]);
      }

      const ledgerErrors = validateLedgerIdentity(candidate, issuerCik, bundle);
      if (ledgerErrors.length) return notVerified(index, display, ledgerErrors);

      const sourceRef = text(candidate.source_ref);
      const sourceDocument = bundle.documents.find(
        (document) => document.source_ref === sourceRef,
      );
      const extracted = extractLevel2ShareCountSidecar({
        payload: {
          share_count_observation: {
            observation_type: candidate.observation_type,
            shares_outstanding: candidate.shares_outstanding,
            as_of: candidate.as_of,
            security_class_kind: candidate.security_class_kind,
            security_class_title: candidate.security_class_title,
            source_ref: candidate.source_ref,
            evidence: candidate.evidence,
          },
        },
        accessionNumber: accession,
        sourceDocumentUrl: sourceDocument?.source_url ?? null,
        sourceDocuments: bundle.documents,
      });
      if (!extracted.candidate || extracted.errors.length) {
        return notVerified(index, display, extracted.errors);
      }

      const evidence = extracted.candidate.evidence;
      const semanticErrors = validateExactEvidence(extracted.candidate, evidence);
      const prospectiveOrHypothetical = isProspectiveOrHypotheticalOutstandingClaim(
        evidence,
        extracted.candidate.sharesOutstanding,
      );
      if (prospectiveOrHypothetical) {
        semanticErrors.push(
          "The evidence states a future, hypothetical, projected, pro forma, or post-offering count rather than actual current or historical shares outstanding.",
        );
      }
      const scaledOrAmbiguous = isScaledOrAmbiguousEvidence(evidence);
      if (prospectiveOrHypothetical || (semanticErrors.length && !scaledOrAmbiguous)) {
        return notVerified(index, display, semanticErrors);
      }
      if (scaledOrAmbiguous) {
        return review(index, display, [
          "The source wording is scaled, approximate, or ambiguous; no exact share value was calculated.",
          ...semanticErrors,
        ]);
      }
      if (isAdsOrOrdinaryShareCandidate(extracted.candidate.securityClassTitle, evidence)) {
        return review(index, display, [
          "ADS, ADR, or ordinary-share basis requires review; no ratio or traded-share value was inferred.",
        ]);
      }

      const classDecision = validateSingleCommonClass(
        issuerCik,
        extracted.candidate.sharesOutstanding,
        extracted.candidate.asOf,
        extracted.candidate.sourceDocument,
        bundle.classUniverse,
        bundle.classUniverseMode,
      );
      if (classDecision.status === "Not Verified") {
        return notVerified(index, display, classDecision.reasons);
      }
      if (classDecision.status === "Review") {
        return review(index, display, classDecision.reasons);
      }

      return {
        index,
        status: "Verified",
        ...display,
        sourceCheck: verifiedSourceCheck(bundle),
        reasons: [],
      };
    }),
  );
}

function exactCandidateShapeErrors(candidate: DilutionRegistryRecord) {
  const errors: string[] = [];
  const allowed = new Set<string>(REQUIRED_KEYS);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) errors.push(`os_observations.${key} is not allowed.`);
  }
  for (const key of REQUIRED_KEYS) {
    if (!(key in candidate)) errors.push(`os_observations.${key} is required.`);
  }
  if (
    typeof candidate.source_accession !== "string" ||
    !ACCESSION_PATTERN.test(candidate.source_accession)
  ) {
    errors.push("os_observations.source_accession must be an exact SEC accession.");
  }
  if (
    !boundedText(candidate.source_form, 40) ||
    candidate.source_form !== candidate.source_form.trim()
  ) {
    errors.push("os_observations.source_form is invalid.");
  }
  if (!isSafeSecSourceRef(candidate.source_ref)) {
    errors.push("os_observations.source_ref must be one safe SEC filename.");
  }
  return errors;
}

function validateLedgerIdentity(
  candidate: DilutionRegistryRecord,
  issuerCik: string,
  bundle: DilutionRegistryOsSourceBundle,
) {
  const errors: string[] = [];
  if (!bundle.ledger) {
    errors.push("The exact accession was not found in the stored SEC filing ledger.");
    return errors;
  }
  if (bundle.ledger.issuer_cik !== issuerCik) {
    errors.push("The issuer CIK does not match the stored SEC filing ledger.");
  }
  if (bundle.ledger.accession_number !== text(candidate.source_accession)) {
    errors.push("The source accession does not match the stored SEC filing ledger.");
  }
  if (bundle.ledger.form !== text(candidate.source_form)) {
    errors.push("The source form does not match the stored SEC filing ledger.");
  }
  return errors;
}

function validateExactEvidence(
  candidate: NonNullable<ReturnType<typeof extractLevel2ShareCountSidecar>["candidate"]>,
  evidence: string,
) {
  const errors: string[] = [];
  const numbers = Array.from(evidence.matchAll(/\b[0-9][0-9,]*\b/g)).map(
    (match) => match[0].replaceAll(",", ""),
  );
  if (!numbers.includes(candidate.sharesOutstanding)) {
    errors.push("The stated evidence digits do not exactly match shares_outstanding.");
  }
  if (!evidenceContainsDate(evidence, candidate.asOf)) {
    errors.push("The stated evidence date does not exactly match as_of.");
  }
  if (!normalizedIncludes(evidence, candidate.securityClassTitle)) {
    errors.push("The stated evidence class does not exactly match security_class_title.");
  }
  if (!/(?:shares?\b[^.\n]{0,160}\b(?:issued\s+and\s+)?outstanding|outstanding\s+shares?)/i.test(evidence)) {
    errors.push("The evidence does not state shares outstanding.");
  }
  return errors;
}

function validateSingleCommonClass(
  issuerCik: string,
  sharesOutstanding: string,
  asOf: string,
  sourceDocument: string,
  universe: DilutionRegistryOsSourceBundle["classUniverse"],
  universeMode: DilutionRegistryOsSourceBundle["classUniverseMode"],
): { status: DilutionRegistryOsPreviewStatus; reasons: string[] } {
  if (!universe || universe.issuer_cik !== issuerCik) {
    return {
      status: "Review",
      reasons: ["The issuer has no resolved stored common-class universe."],
    };
  }
  if (universeMode !== "exact_filing" && universeMode !== "issuer_reference") {
    return {
      status: "Review",
      reasons: ["The stored issuer common-class confirmation is not source-bound."],
    };
  }
  if (
    universeMode === "issuer_reference" &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(universe.universe_as_of) ||
      universe.universe_as_of > asOf)
  ) {
    return {
      status: "Review",
      reasons: [
        "The stored issuer common-class confirmation is later than the observation date.",
      ],
    };
  }
  if (universe.status === "COMPLETE_MULTI") {
    return {
      status: "Review",
      reasons: ["The stored issuer evidence has multiple common classes; no issuer total was inferred or summed."],
    };
  }
  if (universe.status !== "COMPLETE_SINGLE") {
    return {
      status: "Review",
      reasons: [
        `The stored issuer common-class universe is ${universe.status || "unresolved"}; no class was inferred.`,
      ],
    };
  }
  if (universeMode === "exact_filing" && (
    universe.universe_as_of !== asOf ||
    !stringArray(universe.source_documents).includes(sourceDocument)
  )) {
    return {
      status: "Review",
      reasons: ["The stored single-class decision is not bound to the candidate date and document."],
    };
  }
  const requiredClasses = stringArray(universe.required_canonical_security_class_ids);
  const classEvidence = records(universe.class_evidence);
  if (requiredClasses.length !== 1 || classEvidence.length !== 1) {
    return {
      status: "Review",
      reasons: ["The stored single-class decision does not contain one exact required common class."],
    };
  }
  if (
    universeMode === "exact_filing" &&
    text(classEvidence[0]?.sharesOutstanding) !== sharesOutstanding
  ) {
    return {
      status: "Not Verified",
      reasons: ["The candidate shares differ from the exact stored single-class source fact."],
    };
  }
  return { status: "Verified", reasons: [] };
}

function isScaledOrAmbiguousEvidence(evidence: string) {
  return /\b(?:approximately|approx\.?|about|around|nearly|more than|less than|up to|million|billion|thousand)\b/i.test(
    evidence,
  );
}

function isProspectiveOrHypotheticalOutstandingClaim(
  evidence: string,
  sharesOutstanding: string,
) {
  const normalized = normalizeText(evidence).replaceAll(",", "");
  return normalized
    .split(/(?<=[.!?;])\s+/)
    .filter((statement) => statement.includes(sharesOutstanding))
    .some((statement) => PROSPECTIVE_OUTSTANDING_PATTERNS.some(
      (pattern) => pattern.test(statement),
    ));
}

function isAdsOrOrdinaryShareCandidate(classTitle: string, evidence: string) {
  return /\b(?:ADSs?|ADRs?|American Depositary Shares?|ordinary shares?)\b/i.test(
    `${classTitle} ${evidence}`,
  );
}

function evidenceContainsDate(evidence: string, asOf: string) {
  if (evidence.includes(asOf)) return true;
  const [year, month, day] = asOf.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== asOf) {
    return false;
  }
  const long = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
  const short = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
  return evidence.includes(long) || evidence.includes(short);
}

function normalizedIncludes(source: string, expected: string) {
  return normalizeText(source).includes(normalizeText(expected));
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function readIssuerCik(issuer: DilutionRegistryRecord | undefined) {
  if (!issuer) return "";
  const values = [issuer.issuer_cik, issuer.cik].flatMap((value) =>
    typeof value === "string" && value === value.trim() ? [value] : [],
  );
  const unique = [...new Set(values)];
  return unique.length === 1 && CIK_PATTERN.test(unique[0]) && unique[0] !== "0000000000"
    ? unique[0]
    : "";
}

function verifiedSourceCheck(bundle: DilutionRegistryOsSourceBundle) {
  const source = bundle.sourceMode === "official_sec_fallback"
    ? "Exact official SEC fallback filing"
    : "Exact stored SEC filing";
  const classCheck = bundle.classUniverseMode === "issuer_reference"
    ? "stored issuer single-common-class confirmation"
    : "single-common-class source match";
  return `${source}, source_ref, contiguous evidence, stated shares/date/class, and ${classCheck}.`;
}

function displayValues(candidate: DilutionRegistryRecord) {
  return {
    sharesOutstanding: nullableText(candidate.shares_outstanding),
    asOf: nullableText(candidate.as_of),
    securityClassTitle: nullableText(candidate.security_class_title),
    sourceAccession: nullableText(candidate.source_accession),
    sourceForm: nullableText(candidate.source_form),
    sourceRef: nullableText(candidate.source_ref),
    evidence: nullableTextPreserve(candidate.evidence),
  };
}

function notVerified(
  index: number,
  display: ReturnType<typeof displayValues> | null,
  reasons: string[],
): DilutionRegistryOsPreviewRow {
  return {
    index,
    status: "Not Verified",
    ...(display ?? emptyDisplay()),
    sourceCheck: "Source check failed closed. This observation was not saved.",
    reasons: uniqueReasons(reasons),
  };
}

function review(
  index: number,
  display: ReturnType<typeof displayValues>,
  reasons: string[],
): DilutionRegistryOsPreviewRow {
  return {
    index,
    status: "Review",
    ...display,
    sourceCheck: "Manual review required. No issuer total or saved O/S was produced.",
    reasons: uniqueReasons(reasons),
  };
}

function emptyDisplay() {
  return {
    sharesOutstanding: null,
    asOf: null,
    securityClassTitle: null,
    sourceAccession: null,
    sourceForm: null,
    sourceRef: null,
    evidence: null,
  };
}

function uniqueReasons(reasons: string[]) {
  return [...new Set(reasons.filter(Boolean))];
}

function records(value: unknown): DilutionRegistryRecord[] {
  return Array.isArray(value) ? value.filter(record) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function nullableText(value: unknown) {
  return text(value) || null;
}

function nullableTextPreserve(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): DilutionRegistryRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as DilutionRegistryRecord)
    : null;
}

const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const CIK_PATTERN = /^[0-9]{10}$/;
const PROSPECTIVE_OUTSTANDING_PATTERNS = [
  /\bshares?\b[^.!?;]{0,120}\b(?:will|would|shall)\s+be\s+(?:issued\s+and\s+)?outstanding\b/,
  /\bshares?\b[^.!?;]{0,120}\b(?:are|is|were|was)?\s*(?:expected|projected|estimated|forecast|anticipated)\s+to\s+be\s+(?:issued\s+and\s+)?outstanding\b/,
  /\b(?:we|the\s+(?:company|registrant|issuer))\s+(?:expect|project|estimate|forecast|anticipate)\b[^.!?;]{0,200}\bshares?\b[^.!?;]{0,120}\boutstanding\b/,
  /\bpro\s+forma\b[^.!?;]{0,240}\b(?:shares?\b[^.!?;]{0,120}\boutstanding|outstanding\s+shares?)\b/,
  /\b(?:following|after)\s+(?:the|this)\s+offering\b[^.!?;]{0,240}\b(?:shares?\b[^.!?;]{0,120}\boutstanding|outstanding\s+shares?)\b/,
  /\bassum(?:ing|ed)\b[^.!?;]{0,160}\boffering\b[^.!?;]{0,200}\b(?:shares?\b[^.!?;]{0,120}\boutstanding|outstanding\s+shares?)\b/,
  /\b(?:projected|estimated|forecast|anticipated)\s+(?:total\s+)?(?:shares?\b[^.!?;]{0,120}\boutstanding|outstanding\s+shares?)\b/,
] as const;
