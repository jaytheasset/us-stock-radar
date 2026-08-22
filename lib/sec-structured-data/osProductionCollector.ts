import {
  resolveAuthoritativeOsFromFiling,
  type SecAuthoritativeOsDecision,
} from "./authoritativeOsExtraction.ts";
import {
  PostgresSecFilingXbrlArtifactRepository,
  SecFilingXbrlContextService,
  SecFilingXbrlHttpClient,
  filingMatchesOsCandidate,
  readOsCandidateFilingContexts,
  type SecFilingXbrlArtifactRepository,
  type SecFilingXbrlUnavailableReason,
} from "./filingXbrlContext.ts";
import { SecStructuredHttpClient, SecStructuredHttpError } from "./httpClient.ts";
import {
  readOsCandidates,
  type SecOsFilingContextCandidate,
  type SecOsUnavailableObservation,
} from "./osCandidateExtraction.ts";
import {
  deriveIssuerCommonClassUniverseSnapshot,
  PostgresIssuerCommonClassUniverseRepository,
  writeIssuerCommonClassUniverseSnapshot,
  type IssuerCommonClassUniverseRepository,
} from "./issuerCommonClassUniverse.ts";
import { PostgresSecStructuredRepository, type SecStructuredSqlClient } from "./repository.ts";
import { SecRequestError, SecRequestPolicy, type SecRequestPolicyOptions } from "./secRequestPolicy.ts";
import { SecStructuredDataService } from "./service.ts";
import {
  PostgresShareCountHistoryRepository,
  writeAuthoritativeShareCountObservation,
  type ShareCountHistoryRepository,
} from "./shareCountHistory.ts";
import type {
  SecFilingRow,
  SecIssuerIngestResult,
  SecRefreshMode,
  SecStructuredRepository,
} from "./types.ts";

export const SEC_OS_COLLECTION_REASONS = [
  "DB_PERSISTENCE_FAILURE",
  "DB_READ_FAILURE",
  "FILING_CONTEXT_UNAVAILABLE",
  "INCOMPLETE_IXDS",
  "MALFORMED_SOURCE",
  "NON_ELIGIBLE_OS",
  "SEC_FETCH_FAILURE",
  "SEC_NETWORK_FAILURE",
  "SEC_RATE_LIMIT",
] as const;
export type SecOsCollectionReason = (typeof SEC_OS_COLLECTION_REASONS)[number];

export type SecOsCollectionCounts = {
  submissionsFetched: number;
  submissionsUpdated: number;
  companyFactsFetched: number;
  companyFactsUpdated: number;
  osCandidatesFound: number;
  filingContextsRequired: number;
  filingContextsFetched: number;
  filingContextCacheHits: number;
  eligibleObservations: number;
  persistedObservations: number;
  duplicates: number;
  universeSnapshotsEvaluated: number;
  universeSnapshotsInserted: number;
  universeSnapshotDuplicates: number;
  universeSnapshotsIncomplete: number;
  universeSnapshotsAmbiguous: number;
};

export type SecOsCollectionIssue = {
  reason: SecOsCollectionReason;
  stage: "structured_data" | "candidate_discovery" | "filing_context" | "authoritative_extraction" | "universe_persistence" | "history_persistence";
  accession: string | null;
  detail: string;
};

export type SecOsCollectedObservation = {
  accession: string;
  asOf: string;
  sharesOutstanding: string;
  companyFactsSourceFactKeys: string[];
  status: SecAuthoritativeOsDecision["status"];
  reason: SecAuthoritativeOsDecision["reason"];
  persistence: "inserted" | "duplicate" | "not_eligible" | "failed";
  storedIdentity: {
    issuerCik: string;
    accession: string;
    filingDocument: string;
    sourceContentHash: string;
    sourceFactKey: string;
    sourceContextRef: string;
  } | null;
};

export type SecOsCompanyFactsRejection = {
  accession: string | null;
  asOf: string | null;
  sharesOutstanding: string | null;
  taxonomy: string | null;
  concept: string | null;
  reason: SecOsUnavailableObservation["rejectionReason"];
  sourceFactKeys: string[];
};

export type SecOsFilingCollectionResult = {
  accession: string;
  status: "AVAILABLE" | "UNAVAILABLE" | "FAILED";
  source: "cache" | "sec" | null;
  insertedArtifacts: number;
  dedupedArtifacts: number;
  reason: string | null;
};

export type SecOsIssuerCollectionResult = {
  issuerCik: string;
  mode: SecRefreshMode;
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  executedAt: string;
  counts: SecOsCollectionCounts;
  reasonCounts: Partial<Record<SecOsCollectionReason, number>>;
  structuredIngest: SecIssuerIngestResult | null;
  companyFactsRejections: SecOsCompanyFactsRejection[];
  filings: SecOsFilingCollectionResult[];
  observations: SecOsCollectedObservation[];
  issues: SecOsCollectionIssue[];
};

export type SecOsBatchCollectionResult = {
  mode: SecRefreshMode;
  requestedIssuers: number;
  completedIssuers: number;
  partialIssuers: number;
  failedIssuers: number;
  issuers: SecOsIssuerCollectionResult[];
};

type CollectorDependencies = {
  structuredService: Pick<SecStructuredDataService, "ingestIssuer">;
  structuredRepository: Pick<SecStructuredRepository, "readFacts" | "readFilings">;
  filingService: Pick<SecFilingXbrlContextService, "ingestFiling">;
  filingRepository: SecFilingXbrlArtifactRepository;
  historyRepository: ShareCountHistoryRepository;
  universeRepository: IssuerCommonClassUniverseRepository;
  now?: () => Date;
};

export class SecOsProductionCollector {
  private readonly dependencies: CollectorDependencies;

  constructor(dependencies: CollectorDependencies) {
    this.dependencies = dependencies;
  }

  async collectIssuer(input: { cik: string; mode: SecRefreshMode }): Promise<SecOsIssuerCollectionResult> {
    const executedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
    const counts = emptyCounts();
    const issues: SecOsCollectionIssue[] = [];
    const companyFactsRejections: SecOsCompanyFactsRejection[] = [];
    const filings: SecOsFilingCollectionResult[] = [];
    const observations: SecOsCollectedObservation[] = [];
    let structuredIngest: SecIssuerIngestResult;
    try {
      structuredIngest = await this.dependencies.structuredService.ingestIssuer(input);
    } catch (error) {
      issues.push(classifyStructuredFailure(error));
      return finishIssuer({
        issuerCik: normalizeCikForReport(input.cik), mode: input.mode, status: "FAILED", executedAt,
        counts, structuredIngest: null, companyFactsRejections, filings, observations, issues,
      });
    }
    counts.submissionsFetched = structuredIngest.sourceUpdates.submissions.fetched;
    counts.submissionsUpdated = structuredIngest.sourceUpdates.submissions.updated;
    counts.companyFactsFetched = structuredIngest.sourceUpdates.companyFacts.fetched;
    counts.companyFactsUpdated = structuredIngest.sourceUpdates.companyFacts.updated;
    for (const [reason, count] of Object.entries(structuredIngest.rejectionReasons).sort(([left], [right]) => left.localeCompare(right))) {
      issues.push(issue("MALFORMED_SOURCE", "structured_data", null, `${reason} (${count})`));
    }

    let candidates: SecOsFilingContextCandidate[];
    let filingLedger: SecFilingRow[];
    try {
      const discovery = await readOsCandidates(this.dependencies.structuredRepository, structuredIngest.cik);
      candidates = [...discovery.candidates].sort(compareCandidates);
      companyFactsRejections.push(...discovery.rejected.map(toCompanyFactsRejection));
      for (const rejected of discovery.rejected) {
        issues.push(issue(
          "NON_ELIGIBLE_OS", "candidate_discovery", rejected.accession,
          rejected.rejectionReason,
        ));
      }
      filingLedger = await this.dependencies.structuredRepository.readFilings(structuredIngest.cik, 1000);
      counts.osCandidatesFound = candidates.length;
    } catch (error) {
      issues.push(issue("DB_READ_FAILURE", "candidate_discovery", null, stableErrorDetail(error)));
      return finishIssuer({
        issuerCik: structuredIngest.cik, mode: input.mode, status: "PARTIAL", executedAt,
        counts, structuredIngest, companyFactsRejections, filings, observations, issues,
      });
    }

    const candidateGroups = groupCandidatesByAccession(candidates);
    counts.filingContextsRequired = candidateGroups.length;
    const exactFilings = new Map<string, SecFilingRow>();
    for (const [accession, groupedCandidates] of candidateGroups) {
      const matches = filingLedger.filter((filing) => groupedCandidates.every((candidate) => filingMatchesOsCandidate(filing, candidate)));
      if (matches.length !== 1) {
        filings.push({
          accession, status: "UNAVAILABLE", source: null, insertedArtifacts: 0, dedupedArtifacts: 0,
          reason: "FILING_IDENTITY_INVALID",
        });
        issues.push(issue(
          "FILING_CONTEXT_UNAVAILABLE", "filing_context", accession,
          `expected one exact filing ledger row, found ${matches.length}`,
        ));
        continue;
      }
      const filing = matches[0]!;
      exactFilings.set(accession, filing);
      try {
        const result = await this.dependencies.filingService.ingestFiling(filing);
        if (result.source === "cache") counts.filingContextCacheHits += 1;
        else counts.filingContextsFetched += 1;
        filings.push({
          accession,
          status: result.status,
          source: result.source,
          insertedArtifacts: result.inserted,
          dedupedArtifacts: result.deduped,
          reason: result.status === "UNAVAILABLE" ? result.reason : null,
        });
        if (result.status === "UNAVAILABLE") {
          issues.push(classifyFilingUnavailable(accession, result.reason, result.detail));
        }
      } catch (error) {
        filings.push({
          accession, status: "FAILED", source: null, insertedArtifacts: 0, dedupedArtifacts: 0,
          reason: error instanceof SecRequestError ? error.code : "DB_PERSISTENCE_FAILURE",
        });
        issues.push(error instanceof SecRequestError
          ? issue("SEC_NETWORK_FAILURE", "filing_context", accession, networkErrorDetail(error))
          : issue("DB_PERSISTENCE_FAILURE", "filing_context", accession, stableErrorDetail(error)));
      }
    }

    for (const candidate of candidates) {
      try {
        const linked = await readOsCandidateFilingContexts({
          candidate,
          filing: exactFilings.get(candidate.accession),
          repository: this.dependencies.filingRepository,
        });
        const decision = resolveAuthoritativeOsFromFiling(linked);
        try {
          const snapshot = deriveIssuerCommonClassUniverseSnapshot(decision);
          counts.universeSnapshotsEvaluated += 1;
          if (snapshot.status === "INCOMPLETE") counts.universeSnapshotsIncomplete += 1;
          if (snapshot.status === "AMBIGUOUS") counts.universeSnapshotsAmbiguous += 1;
          const persisted = await writeIssuerCommonClassUniverseSnapshot({
            repository: this.dependencies.universeRepository,
            decision,
          });
          counts.universeSnapshotsInserted += persisted.inserted;
          counts.universeSnapshotDuplicates += persisted.deduped;
        } catch (error) {
          issues.push(issue("DB_PERSISTENCE_FAILURE", "universe_persistence", candidate.accession, stableErrorDetail(error)));
        }
        if (decision.status !== "ELIGIBLE") {
          observations.push(toCollectedObservation(decision, "not_eligible"));
          issues.push(issue("NON_ELIGIBLE_OS", "authoritative_extraction", candidate.accession, decision.reason));
          continue;
        }
        counts.eligibleObservations += 1;
        try {
          const persisted = await writeAuthoritativeShareCountObservation({
            repository: this.dependencies.historyRepository,
            decision,
            ingestedAt: executedAt,
          });
          counts.persistedObservations += persisted.inserted;
          counts.duplicates += persisted.deduped;
          observations.push(toCollectedObservation(decision, persisted.inserted === 1 ? "inserted" : "duplicate"));
        } catch (error) {
          observations.push(toCollectedObservation(decision, "failed"));
          issues.push(issue("DB_PERSISTENCE_FAILURE", "history_persistence", candidate.accession, stableErrorDetail(error)));
        }
      } catch (error) {
        issues.push(issue("DB_READ_FAILURE", "authoritative_extraction", candidate.accession, stableErrorDetail(error)));
      }
    }

    return finishIssuer({
      issuerCik: structuredIngest.cik,
      mode: input.mode,
      status: hasOperationalIssue(issues) ? "PARTIAL" : "COMPLETED",
      executedAt,
      counts,
      structuredIngest,
      companyFactsRejections,
      filings,
      observations,
      issues,
    });
  }

  async collectBatch(input: { ciks: readonly string[]; mode: SecRefreshMode }): Promise<SecOsBatchCollectionResult> {
    const issuers: SecOsIssuerCollectionResult[] = [];
    for (const cik of input.ciks) {
      issuers.push(await this.collectIssuer({ cik, mode: input.mode }));
    }
    return {
      mode: input.mode,
      requestedIssuers: input.ciks.length,
      completedIssuers: issuers.filter((result) => result.status === "COMPLETED").length,
      partialIssuers: issuers.filter((result) => result.status === "PARTIAL").length,
      failedIssuers: issuers.filter((result) => result.status === "FAILED").length,
      issuers,
    };
  }
}

export function createSecOsProductionCollector(input: {
  sqlClient: SecStructuredSqlClient;
  userAgent: string;
  now?: () => Date;
  requestPolicy?: Omit<SecRequestPolicyOptions, "fetchImplementation"> & { fetchImplementation?: typeof fetch };
}) {
  const now = input.now ?? (() => new Date());
  const policy = new SecRequestPolicy(input.userAgent, input.requestPolicy);
  const structuredRepository = new PostgresSecStructuredRepository(input.sqlClient);
  const filingRepository = new PostgresSecFilingXbrlArtifactRepository(input.sqlClient);
  const historyRepository = new PostgresShareCountHistoryRepository(input.sqlClient);
  const universeRepository = new PostgresIssuerCommonClassUniverseRepository(input.sqlClient);
  const structuredClient = new SecStructuredHttpClient(
    input.userAgent,
    input.requestPolicy?.minimumIntervalMs,
    input.requestPolicy?.fetchImplementation,
    now,
    policy,
  );
  const filingClient = new SecFilingXbrlHttpClient(
    input.userAgent,
    input.requestPolicy?.fetchImplementation,
    now,
    input.requestPolicy?.minimumIntervalMs,
    policy,
  );
  return new SecOsProductionCollector({
    structuredService: new SecStructuredDataService(structuredClient, structuredRepository, now),
    structuredRepository,
    filingService: new SecFilingXbrlContextService(filingClient, filingRepository),
    filingRepository,
    historyRepository,
    universeRepository,
    now,
  });
}

function emptyCounts(): SecOsCollectionCounts {
  return {
    submissionsFetched: 0,
    submissionsUpdated: 0,
    companyFactsFetched: 0,
    companyFactsUpdated: 0,
    osCandidatesFound: 0,
    filingContextsRequired: 0,
    filingContextsFetched: 0,
    filingContextCacheHits: 0,
    eligibleObservations: 0,
    persistedObservations: 0,
    duplicates: 0,
    universeSnapshotsEvaluated: 0,
    universeSnapshotsInserted: 0,
    universeSnapshotDuplicates: 0,
    universeSnapshotsIncomplete: 0,
    universeSnapshotsAmbiguous: 0,
  };
}

function finishIssuer(input: Omit<SecOsIssuerCollectionResult, "reasonCounts">): SecOsIssuerCollectionResult {
  input.companyFactsRejections.sort((left, right) => [left.accession ?? "", left.asOf ?? "", left.reason].join("|")
    .localeCompare([right.accession ?? "", right.asOf ?? "", right.reason].join("|")));
  input.filings.sort((left, right) => left.accession.localeCompare(right.accession));
  input.observations.sort((left, right) => [left.accession, left.asOf, left.companyFactsSourceFactKeys.join(",")].join("|")
    .localeCompare([right.accession, right.asOf, right.companyFactsSourceFactKeys.join(",")].join("|")));
  input.issues.sort((left, right) => [left.accession ?? "", left.stage, left.reason, left.detail].join("|")
    .localeCompare([right.accession ?? "", right.stage, right.reason, right.detail].join("|")));
  const reasonCounts: Partial<Record<SecOsCollectionReason, number>> = {};
  for (const item of input.issues) reasonCounts[item.reason] = (reasonCounts[item.reason] ?? 0) + 1;
  return { ...input, reasonCounts };
}

function groupCandidatesByAccession(candidates: readonly SecOsFilingContextCandidate[]) {
  const groups = new Map<string, SecOsFilingContextCandidate[]>();
  for (const candidate of candidates) groups.set(candidate.accession, [...(groups.get(candidate.accession) ?? []), candidate]);
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function compareCandidates(left: SecOsFilingContextCandidate, right: SecOsFilingContextCandidate) {
  return [left.accession, left.asOf, left.taxonomy, left.concept, left.sharesOutstanding].join("|")
    .localeCompare([right.accession, right.asOf, right.taxonomy, right.concept, right.sharesOutstanding].join("|"));
}

function toCollectedObservation(
  decision: SecAuthoritativeOsDecision,
  persistence: SecOsCollectedObservation["persistence"],
): SecOsCollectedObservation {
  const authoritative = decision.status === "ELIGIBLE" ? decision.authoritative : null;
  return {
    accession: decision.candidate.accession,
    asOf: decision.candidate.asOf,
    sharesOutstanding: decision.candidate.sharesOutstanding,
    companyFactsSourceFactKeys: decision.candidate.sourceFacts.map((source) => source.sourceFactKey).sort(),
    status: decision.status,
    reason: decision.reason,
    persistence,
    storedIdentity: authoritative ? {
      issuerCik: authoritative.issuerCik,
      accession: authoritative.accession,
      filingDocument: authoritative.filingDocument,
      sourceContentHash: authoritative.source.contentHash,
      sourceFactKey: authoritative.factKey,
      sourceContextRef: authoritative.contextRef,
    } : null,
  };
}

function toCompanyFactsRejection(rejected: SecOsUnavailableObservation): SecOsCompanyFactsRejection {
  return {
    accession: rejected.accession,
    asOf: rejected.asOf,
    sharesOutstanding: rejected.sharesOutstanding,
    taxonomy: rejected.taxonomy,
    concept: rejected.concept,
    reason: rejected.rejectionReason,
    sourceFactKeys: rejected.sourceFacts.map((source) => source.sourceFactKey).sort(),
  };
}

function classifyStructuredFailure(error: unknown): SecOsCollectionIssue {
  if (error instanceof SecRequestError) {
    return issue("SEC_NETWORK_FAILURE", "structured_data", null, networkErrorDetail(error));
  }
  if (error instanceof SecStructuredHttpError) {
    return issue(error.status === 429 ? "SEC_RATE_LIMIT" : "SEC_FETCH_FAILURE", "structured_data", null, error.message);
  }
  const detail = stableErrorDetail(error);
  if (/not valid JSON|raw_body_payload_mismatch|malformed/i.test(detail)) {
    return issue("MALFORMED_SOURCE", "structured_data", null, detail);
  }
  return issue("DB_PERSISTENCE_FAILURE", "structured_data", null, detail);
}

function classifyFilingUnavailable(
  accession: string,
  reason: SecFilingXbrlUnavailableReason,
  detail: string,
): SecOsCollectionIssue {
  if (/HTTP 429\b/i.test(detail)) return issue("SEC_RATE_LIMIT", "filing_context", accession, `${reason}: ${detail}`);
  if (/HTTP (?:500|502|503|504)\b/i.test(detail)) return issue("SEC_FETCH_FAILURE", "filing_context", accession, `${reason}: ${detail}`);
  if (reason === "PRIMARY_IXDS_INCOMPLETE" || reason === "PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS") {
    return issue("INCOMPLETE_IXDS", "filing_context", accession, `${reason}: ${detail}`);
  }
  if ([
    "AMBIGUOUS_CONTEXT_REF", "BROKEN_UNIT_REF", "BROKEN_CONTEXT_REF", "CONFLICTING_UNIT_IDS",
    "CONFLICTING_CONTEXT_IDS", "FILING_XBRL_DOCUMENT_AMBIGUOUS", "FILING_XBRL_PARSE_FAILED",
    "UNINTERPRETABLE_TYPED_MEMBER", "UNSUPPORTED_FILING_XBRL_CONSTRUCT",
  ].includes(reason)) {
    return issue("MALFORMED_SOURCE", "filing_context", accession, `${reason}: ${detail}`);
  }
  return issue("FILING_CONTEXT_UNAVAILABLE", "filing_context", accession, `${reason}: ${detail}`);
}

function issue(
  reason: SecOsCollectionReason,
  stage: SecOsCollectionIssue["stage"],
  accession: string | null,
  detail: string,
): SecOsCollectionIssue {
  return { reason, stage, accession, detail };
}

function hasOperationalIssue(issues: readonly SecOsCollectionIssue[]) {
  return issues.some((item) => item.reason !== "NON_ELIGIBLE_OS");
}

function stableErrorDetail(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function networkErrorDetail(error: SecRequestError) {
  return `${error.message}: ${stableErrorDetail(error.cause)}`;
}

function normalizeCikForReport(value: string) {
  const digits = value.trim();
  return /^[0-9]{1,10}$/.test(digits) ? digits.padStart(10, "0") : digits;
}
