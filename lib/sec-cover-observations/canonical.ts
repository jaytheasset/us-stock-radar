import { createHash } from "node:crypto";
import {
  createSecFilingDocumentArtifact,
  createSecFilingXbrlArtifactFromStoredHttpBody,
  parseSecFilingXbrlArtifact,
  parseSecFilingXbrlArtifacts,
  type SecFilingXbrlFact,
  type SecFilingXbrlFactRejection,
  type SecFilingXbrlRawArtifact,
  type SecXbrlContext,
  type SecXbrlQName,
} from "../sec-structured-data/filingXbrlContext.ts";

type Row = Record<string, unknown>;

export const SEC_COVER_OBSERVATION_VERSION = "sec-cover-security-observation-v1";
export const SEC_COVER_OBSERVATION_METHOD = "sec-filing-xbrl-context-parser";
export const SEC_COVER_OBSERVATION_FORMS = new Set([
  "10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A",
]);

export type SecCoverFieldStatus =
  | "observed"
  | "source_missing"
  | "explicit_nil"
  | "explicit_blank"
  | "explicit_empty"
  | "duplicate_equal"
  | "duplicate_conflict"
  | "unsupported";

export type SecCoverExtractionStatus =
  | "available"
  | "partial"
  | "source_missing"
  | "source_truncated"
  | "parse_failed"
  | "unsupported_context"
  | "identity_mismatch"
  | "no_cover_facts";

export type SecCoverFieldObservation = Readonly<{
  concept: "Security12bTitle" | "TradingSymbol" | "SecurityExchangeName";
  status: SecCoverFieldStatus;
  rawLexicalValue: string | null;
  parsedTextValue: string | null;
  facts: readonly Row[];
  rejections: readonly Row[];
}>;

export type SecCoverSecurityObservation = Readonly<{
  observationIndex: number;
  observationKey: string;
  issuerCikRaw: string;
  issuerCik: string;
  contextRef: string;
  contextHash: string;
  context: SecXbrlContext;
  securityTitle: SecCoverFieldObservation;
  tradingSymbol: SecCoverFieldObservation;
  exchange: SecCoverFieldObservation;
}>;

export type SecCoverObservationPayload = Readonly<{
  storageVersion: typeof SEC_COVER_OBSERVATION_VERSION;
  extractionMethod: typeof SEC_COVER_OBSERVATION_METHOD;
  extractionStatus: SecCoverExtractionStatus;
  identity: Readonly<{
    lineageKind: "raw_item_primary_document" | "structured_filing_artifact";
    rawItemId: string | null;
    filingLedgerRawSourceId: string | null;
    sourceCode: "sec_edgar";
    sourceGroup: "filings";
    sourceUniqueId: string;
    accessionNumber: string;
    issuerCikRaw: string;
    issuerCik: string;
    formTypeRaw: string;
    filingDateRaw: string | null;
    acceptedAtRaw: string | null;
    acceptedAt: string | null;
    sourceParserVersion: string | null;
  }>;
  source: Readonly<{
    status: "available" | "missing" | "truncated";
    rawSourceId: string | null;
    role: "primary_document" | "inline_xbrl" | "instance_xml" | null;
    url: string | null;
    documentName: string | null;
    sha256: string | null;
    charCount: number;
    declaredCharCount: number | null;
    fetchedAt: string | null;
  }>;
  parser: Readonly<{
    status: "available" | "unavailable" | "not_run";
    documentKind: string | null;
    unavailableReason: string | null;
    unavailableDetail: string | null;
    rejections: readonly Row[];
    candidateFacts: readonly Row[];
  }>;
  issues: readonly Readonly<{ code: string; detail: string }>[];
  observations: readonly SecCoverSecurityObservation[];
}>;

export type SecCoverPersistencePayload = Readonly<{
  resultId: string;
  rawItemId: string | null;
  sourceRaw: Row | null;
  result: Row;
  observations: readonly Row[];
  payload: SecCoverObservationPayload;
  payloadSha256: string;
}>; 

export type SecCoverStructuredFilingIdentity = Readonly<{
  accessionNumber: string;
  issuerCik: string;
  formType: string;
  filedDate: string;
  acceptedAt: string | null;
  sourceRawId: string;
}>;

export class SecCoverObservationSourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SecCoverObservationSourceError";
    this.code = code;
  }
}

export function isSecCoverObservationRawItem(rawItem: Row) {
  const raw = record(rawItem.raw_payload);
  return stringValue(rawItem.source_code) === "sec_edgar"
    && stringValue(rawItem.source_group) === "filings"
    && (rawString(raw.primary_document_html).length > 0
      || SEC_COVER_OBSERVATION_FORMS.has(normalizeForm(raw.form_type)));
}

export function assertSecCoverCallerMatchesStored(caller: Row, stored: Row) {
  const callerSnapshot = rawItemSnapshot(caller, "");
  const storedSnapshot = rawItemSnapshot(stored, stringValue(stored.id));
  const { fetchedAt: _callerFetchedAt, ...callerComparable } = callerSnapshot;
  const { fetchedAt: _storedFetchedAt, ...storedComparable } = storedSnapshot;
  const comparableCaller = { ...callerComparable, rawItemId: storedSnapshot.rawItemId };
  if (stableStringify(comparableCaller) !== stableStringify(storedComparable)) {
    throw new SecCoverObservationSourceError(
      "caller_stored_identity_mismatch",
      "SEC cover observation caller does not exactly match the stored raw item",
    );
  }
}

export function buildSecCoverObservationPayload(
  rawItemId: string,
  rawItem: Row,
): SecCoverPersistencePayload | null {
  return buildSecCoverObservationPayloadInternal(rawItemId, rawItem, null);
}

function buildSecCoverObservationPayloadInternal(
  rawItemId: string,
  rawItem: Row,
  exactStructuredArtifact: SecFilingXbrlRawArtifact | null,
): SecCoverPersistencePayload | null {
  if (!isSecCoverObservationRawItem(rawItem)) return null;
  if (!UUID_PATTERN.test(rawItemId)) {
    throw new SecCoverObservationSourceError("invalid_raw_item_id", "SEC cover observation raw item ID is invalid");
  }

  const snapshot = rawItemSnapshot(rawItem, rawItemId);
  validateIdentitySnapshot(snapshot);
  const raw = record(rawItem.raw_payload);
  const sourceHtml = rawString(raw.primary_document_html);
  const declaredCharCount = integerOrNull(raw.primary_document_html_char_count);
  const truncated = raw.primary_document_html_truncated === true;
  const sourceUrl = nullableString(raw.primary_document_url);
  const fetchedAt = normalizedTimestamp(rawItem.fetched_at);
  const sourceDocument = sourceUrl ? documentNameFromUrl(sourceUrl) : null;
  let artifact: SecFilingXbrlRawArtifact | null = null;
  const issues: Array<{ code: string; detail: string }> = [];

  let extractionStatus: SecCoverExtractionStatus;
  let parser: SecCoverObservationPayload["parser"] = {
    status: "not_run",
    documentKind: null,
    unavailableReason: null,
    unavailableDetail: null,
    rejections: [],
    candidateFacts: [],
  };
  let observations: SecCoverSecurityObservation[] = [];

  if (!sourceHtml || !sourceUrl || !sourceDocument || !fetchedAt) {
    extractionStatus = "source_missing";
    issues.push({ code: "source_missing", detail: "exact primary SEC document body or provenance is absent" });
  } else if (truncated || (declaredCharCount !== null && declaredCharCount !== sourceHtml.length)) {
    extractionStatus = "source_truncated";
    issues.push({ code: "source_truncated", detail: "primary SEC document body is truncated or its declared length mismatches" });
  } else {
    try {
      artifact = exactStructuredArtifact ?? createSecFilingDocumentArtifact({
        issuerCik: snapshot.issuerCik,
        accession: snapshot.accessionNumber,
        documentName: sourceDocument,
        sourceUrl,
        rawContent: sourceHtml,
        fetchedAt,
        contentType: sourceDocument.toLowerCase().endsWith(".xml") ? "application/xml" : "text/html",
      });
    } catch (error) {
      extractionStatus = "identity_mismatch";
      issues.push({ code: "source_identity_invalid", detail: safeError(error) });
    }

    if (artifact) {
      let parsed = exactStructuredArtifact
        ? parseSecFilingXbrlArtifacts([artifact])
        : parseSecFilingXbrlArtifact(artifact);
      if (!exactStructuredArtifact && parsed.status === "AVAILABLE" && parsed.documentKind === "inline_xbrl") {
        artifact = { ...artifact, role: "inline_xbrl" };
        parsed = parseSecFilingXbrlArtifacts([artifact]);
      }
      if (parsed.status === "UNAVAILABLE") {
        extractionStatus = parsed.reason === "UNINTERPRETABLE_TYPED_MEMBER"
          || parsed.reason === "BROKEN_CONTEXT_REF"
          || parsed.reason === "CONFLICTING_CONTEXT_IDS"
          ? "unsupported_context"
          : "parse_failed";
        parser = {
          status: "unavailable",
          documentKind: null,
          unavailableReason: parsed.reason,
          unavailableDetail: parsed.detail,
          rejections: [],
          candidateFacts: [],
        };
        issues.push({ code: parsed.reason, detail: parsed.detail });
      } else {
        const candidateFacts = parsed.facts.filter((fact) => isCoverSecurityConcept(fact.concept));
        const rejections = parsed.rejections.filter((rejection) =>
          isCoverSecurityConcept(rejection.concept)
        );
        parser = {
          status: "available",
          documentKind: parsed.documentKind,
          unavailableReason: null,
          unavailableDetail: null,
          rejections: rejections.map(rejectionPayload),
          candidateFacts: candidateFacts.map(factPayload),
        };
        const unsupportedSchemes = candidateFacts.filter((fact) => !isSecCikEntityScheme(fact.context.entityScheme));
        const mismatches = candidateFacts.filter((fact) => normalizeCik(fact.context.entityIdentifier) !== snapshot.issuerCik);
        if (unsupportedSchemes.length > 0) {
          extractionStatus = "unsupported_context";
          issues.push({
            code: "unsupported_entity_scheme",
            detail: `cover fact contexts use unsupported entity schemes: ${[...new Set(unsupportedSchemes.map((fact) => fact.context.entityScheme))].join(",")}`,
          });
        } else if (mismatches.length > 0) {
          extractionStatus = "identity_mismatch";
          issues.push({
            code: "context_issuer_cik_mismatch",
            detail: `cover fact contexts do not match stored issuer CIK: ${[...new Set(mismatches.map((fact) => fact.context.entityIdentifier))].join(",")}`,
          });
        } else if (candidateFacts.length === 0 && rejections.length === 0) {
          extractionStatus = "no_cover_facts";
          issues.push({ code: "cover_facts_absent", detail: "source contains no supported DEI cover security facts" });
        } else {
          observations = buildObservations(snapshot.issuerCik, candidateFacts, rejections);
          if (observations.length === 0) {
            extractionStatus = "unsupported_context";
            issues.push({ code: "cover_context_unavailable", detail: "cover facts were rejected before a context observation could be formed" });
          } else if (observations.every(observationComplete)) {
            extractionStatus = "available";
          } else {
            extractionStatus = "partial";
            issues.push({ code: "cover_fields_partial", detail: "one or more security contexts has missing, nil, conflicting, or unsupported cover fields" });
          }
        }
      }
    }
  }

  const source = {
    status: (!sourceHtml || !sourceUrl || !sourceDocument || !fetchedAt) ? "missing" as const
      : truncated || (declaredCharCount !== null && declaredCharCount !== sourceHtml.length) ? "truncated" as const
        : "available" as const,
    rawSourceId: artifact?.id ?? null,
    role: artifact && ["primary_document", "inline_xbrl", "instance_xml"].includes(artifact.role)
      ? artifact.role as "primary_document" | "inline_xbrl" | "instance_xml"
      : null,
    url: sourceUrl,
    documentName: sourceDocument,
    sha256: artifact?.contentHash ?? (sourceHtml ? sha256(sourceHtml) : null),
    charCount: sourceHtml.length,
    declaredCharCount,
    fetchedAt: null,
  };
  const identity = identityPayload(snapshot);
  const payload: SecCoverObservationPayload = {
    storageVersion: SEC_COVER_OBSERVATION_VERSION,
    extractionMethod: SEC_COVER_OBSERVATION_METHOD,
    extractionStatus: extractionStatus!,
    identity,
    source,
    parser,
    issues,
    observations,
  };
  const payloadSha256 = sha256(stableStringify(payload));
  const resultId = deterministicUuid(`sec_cover_observation:${lineageIdentity(payload)}:${payloadSha256}`);
  return {
    resultId,
    rawItemId,
    sourceRaw: artifact ? rawSourcePayload(artifact) : null,
    result: resultRow(resultId, payloadSha256, payload),
    observations: observations.map((observation) => observationRow(resultId, observation)),
    payload,
    payloadSha256,
  };
}

export function buildSecCoverObservationPayloadFromStructuredArtifact(input: {
  filing: SecCoverStructuredFilingIdentity;
  artifact: SecFilingXbrlRawArtifact;
  artifactParserVersion?: string;
}): SecCoverPersistencePayload {
  const { filing, artifact } = input;
  const issuerCik = normalizeCik(filing.issuerCik);
  if (!ACCESSION_PATTERN.test(filing.accessionNumber)
    || !CIK_PATTERN.test(issuerCik)
    || issuerCik === "0000000000"
    || !filing.formType.trim()
    || !/^\d{4}-\d{2}-\d{2}$/.test(filing.filedDate)
    || !UUID_PATTERN.test(filing.sourceRawId)
    || (filing.acceptedAt !== null && normalizedTimestamp(filing.acceptedAt) === null)
    || artifact.issuerCik !== issuerCik
    || artifact.accession !== filing.accessionNumber
    || !["inline_xbrl", "instance_xml"].includes(artifact.role)
    || artifact.rawContentKind !== "authoritative_http_body") {
    throw new SecCoverObservationSourceError(
      "structured_artifact_identity_mismatch",
      "structured SEC filing artifact does not exactly match filing ledger provenance",
    );
  }
  const adapterRawItemId = deterministicUuid(
    `sec_cover_structured_adapter:${filing.accessionNumber}:${filing.sourceRawId}:${artifact.id}`,
  );
  const built = buildSecCoverObservationPayloadInternal(adapterRawItemId, {
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: filing.accessionNumber,
    source_url: artifact.sourceUrl,
    fetched_at: artifact.fetchedAt,
    raw_payload: {
      accession_number: filing.accessionNumber,
      cik: issuerCik,
      form_type: filing.formType,
      filing_date: filing.filedDate,
      accepted_at: filing.acceptedAt,
      parser_version: input.artifactParserVersion ?? "filing-xbrl-context-v1",
      primary_document_url: artifact.sourceUrl,
      primary_document_html: artifact.rawContent,
      primary_document_html_char_count: artifact.rawContent.length,
      primary_document_html_truncated: false,
    },
  }, artifact);
  if (!built || built.payload.source.rawSourceId !== artifact.id || built.payload.source.role !== artifact.role) {
    throw new SecCoverObservationSourceError(
      "structured_artifact_replay_mismatch",
      "structured SEC artifact could not be reproduced by the filing XBRL parser boundary",
    );
  }
  const payload: SecCoverObservationPayload = {
    ...built.payload,
    identity: {
      ...built.payload.identity,
      lineageKind: "structured_filing_artifact",
      rawItemId: null,
      filingLedgerRawSourceId: filing.sourceRawId,
    },
  };
  const payloadSha256 = sha256(stableStringify(payload));
  const resultId = deterministicUuid(`sec_cover_observation:${lineageIdentity(payload)}:${payloadSha256}`);
  return {
    resultId,
    rawItemId: null,
    sourceRaw: built.sourceRaw,
    result: resultRow(resultId, payloadSha256, payload),
    observations: payload.observations.map((observation) => observationRow(resultId, observation)),
    payload,
    payloadSha256,
  };
}

export function validateSecCoverStoredPayload(input: {
  result: Row;
  observations: readonly Row[];
  rawSource?: Row | null;
}): { ok: true; payload: SecCoverObservationPayload } | { ok: false; reason: string } {
  try {
    const payload = input.result.result_payload as SecCoverObservationPayload;
    if (!payload || typeof payload !== "object") return { ok: false, reason: "result_payload_missing" };
    if (sha256(stableStringify(payload)) !== stringValue(input.result.payload_sha256)) {
      return { ok: false, reason: "payload_hash_mismatch" };
    }
    if (stringValue(input.result.id) !== deterministicUuid(`sec_cover_observation:${lineageIdentity(payload)}:${stringValue(input.result.payload_sha256)}`)) {
      return { ok: false, reason: "result_identity_mismatch" };
    }
    const expectedRows = payload.observations.map((observation) => observationRow(stringValue(input.result.id), observation));
    if (stableStringify(expectedRows) !== stableStringify(input.observations.map(normalizeStoredObservationRow))) {
      return { ok: false, reason: "observation_rows_mismatch" };
    }
    if (payload.source.rawSourceId) {
      const rawSource = input.rawSource;
      if (!rawSource || stringValue(rawSource.id) !== payload.source.rawSourceId) {
        return { ok: false, reason: "raw_source_missing" };
      }
      const rawContent = rawString(rawSource.raw_content);
      if (sha256(rawContent) !== payload.source.sha256 || rawContent.length !== payload.source.charCount) {
        return { ok: false, reason: "raw_source_hash_mismatch" };
      }
      const artifact = payload.source.role === "primary_document"
        ? createSecFilingDocumentArtifact({
            issuerCik: payload.identity.issuerCik,
            accession: payload.identity.accessionNumber,
            documentName: payload.source.documentName!,
            sourceUrl: payload.source.url!,
            rawContent,
            fetchedAt: normalizedTimestamp(rawSource.fetched_at)!,
            contentType: nullableString(record(rawSource.payload).content_type),
          })
        : createSecFilingXbrlArtifactFromStoredHttpBody({
            issuerCik: payload.identity.issuerCik,
            accession: payload.identity.accessionNumber,
            documentName: payload.source.documentName!,
            sourceUrl: payload.source.url!,
            role: payload.source.role!,
            rawContent,
            fetchedAt: normalizedTimestamp(rawSource.fetched_at)!,
            contentType: nullableString(record(rawSource.payload).content_type),
          });
      if (artifact.id !== payload.source.rawSourceId || artifact.contentHash !== payload.source.sha256) {
        return { ok: false, reason: "raw_source_identity_mismatch" };
      }
      const replay = payload.identity.lineageKind === "structured_filing_artifact"
        ? buildSecCoverObservationPayloadFromStructuredArtifact({
            filing: {
              accessionNumber: payload.identity.accessionNumber,
              issuerCik: payload.identity.issuerCikRaw,
              formType: payload.identity.formTypeRaw,
              filedDate: payload.identity.filingDateRaw!,
              acceptedAt: payload.identity.acceptedAtRaw,
              sourceRawId: payload.identity.filingLedgerRawSourceId!,
            },
            artifact,
            artifactParserVersion: payload.identity.sourceParserVersion ?? undefined,
          })
        : buildSecCoverObservationPayload(payload.identity.rawItemId!, {
            id: payload.identity.rawItemId,
            source_code: payload.identity.sourceCode,
            source_group: payload.identity.sourceGroup,
            source_unique_id: payload.identity.sourceUniqueId,
            source_url: null,
            fetched_at: rawSource.fetched_at,
            raw_payload: {
              accession_number: payload.identity.accessionNumber,
              cik: payload.identity.issuerCikRaw,
              form_type: payload.identity.formTypeRaw,
              filing_date: payload.identity.filingDateRaw,
              accepted_at: payload.identity.acceptedAtRaw,
              parser_version: payload.identity.sourceParserVersion,
              primary_document_url: payload.source.url,
              primary_document_html: rawContent,
              primary_document_html_char_count: payload.source.declaredCharCount,
              primary_document_html_truncated: false,
            },
          });
      if (!replay
        || replay.payloadSha256 !== stringValue(input.result.payload_sha256)
        || stableStringify(replay.payload) !== stableStringify(payload)) {
        return { ok: false, reason: "parser_replay_mismatch" };
      }
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "stored_payload_invalid" };
  }
}

function buildObservations(
  issuerCik: string,
  facts: readonly SecFilingXbrlFact[],
  rejections: readonly SecFilingXbrlFactRejection[],
) {
  const contextRefs = [...new Set([
    ...facts.map((fact) => fact.contextRef),
    ...rejections.map((rejection) => rejection.contextRef).filter((value): value is string => Boolean(value)),
  ])].sort();
  const observations: SecCoverSecurityObservation[] = [];
  for (const contextRef of contextRefs) {
    const contextFacts = facts.filter((fact) => fact.contextRef === contextRef);
    const context = contextFacts[0]?.context;
    if (!context) continue;
    const contextRejections = rejections.filter((rejection) => rejection.contextRef === contextRef);
    const fields = {
      securityTitle: buildField("Security12bTitle", contextFacts, contextRejections),
      tradingSymbol: buildField("TradingSymbol", contextFacts, contextRejections),
      exchange: buildField("SecurityExchangeName", contextFacts, contextRejections),
    };
    const contextHash = sha256(stableStringify(context));
    const base = {
      issuerCikRaw: context.entityIdentifier,
      issuerCik,
      contextRef,
      contextHash,
      context,
      ...fields,
    };
    observations.push({
      observationIndex: observations.length,
      observationKey: sha256(stableStringify(base)),
      ...base,
    });
  }
  return observations;
}

function buildField(
  concept: SecCoverFieldObservation["concept"],
  contextFacts: readonly SecFilingXbrlFact[],
  contextRejections: readonly SecFilingXbrlFactRejection[],
): SecCoverFieldObservation {
  const facts = contextFacts.filter((fact) => fact.concept.localName === concept);
  const rejections = contextRejections.filter((rejection) => rejection.concept?.localName === concept);
  const payloads = facts.map(factPayload);
  const rejectionPayloads = rejections.map(rejectionPayload);
  if (rejections.length > 0) {
    return { concept, status: "unsupported", rawLexicalValue: null, parsedTextValue: null, facts: payloads, rejections: rejectionPayloads };
  }
  if (facts.length === 0) {
    return { concept, status: "source_missing", rawLexicalValue: null, parsedTextValue: null, facts: [], rejections: [] };
  }
  if (facts.every((fact) => fact.isNil)) {
    return { concept, status: "explicit_nil", rawLexicalValue: null, parsedTextValue: null, facts: payloads, rejections: [] };
  }
  const lexicalValues = facts.map((fact) => simpleLexicalValue(fact.valueTree));
  if (lexicalValues.some((value) => !value.supported)) {
    return { concept, status: "unsupported", rawLexicalValue: null, parsedTextValue: null, facts: payloads, rejections: [] };
  }
  const comparable = new Set(facts.map((fact) => stableStringify({
    valueTree: fact.valueTree,
    valueText: fact.valueText,
    isNil: fact.isNil,
    scale: fact.scale,
    sign: fact.sign,
    inlineFormat: fact.inlineFormat,
  })));
  if (facts.some((fact) => fact.isNil) || comparable.size > 1) {
    return { concept, status: "duplicate_conflict", rawLexicalValue: null, parsedTextValue: null, facts: payloads, rejections: [] };
  }
  const fact = facts[0]!;
  const rawLexicalValue = lexicalValues[0]!.value;
  if (rawLexicalValue === null) {
    return {
      concept,
      status: "explicit_empty",
      rawLexicalValue: null,
      parsedTextValue: fact.valueText,
      facts: payloads,
      rejections: [],
    };
  }
  if (rawLexicalValue !== null && rawLexicalValue.trim() === "") {
    return {
      concept,
      status: "explicit_blank",
      rawLexicalValue,
      parsedTextValue: fact.valueText,
      facts: payloads,
      rejections: [],
    };
  }
  return {
    concept,
    status: facts.length > 1 ? "duplicate_equal" : "observed",
    rawLexicalValue,
    parsedTextValue: fact.valueText,
    facts: payloads,
    rejections: [],
  };
}

function observationComplete(observation: SecCoverSecurityObservation) {
  return [observation.securityTitle, observation.tradingSymbol, observation.exchange]
    .every((field) => field.status === "observed" || field.status === "duplicate_equal");
}

function isCoverSecurityConcept(concept: SecXbrlQName | null) {
  return Boolean(
    concept?.namespaceUri
    && /^https?:\/\/xbrl\.sec\.gov\/dei\/(?:\d{4}|\d{4}-\d{2}-\d{2})$/i.test(concept.namespaceUri)
    && ["Security12bTitle", "TradingSymbol", "SecurityExchangeName"].includes(concept.localName)
  );
}

function isSecCikEntityScheme(value: string) {
  return /^https?:\/\/(?:www\.)?sec\.gov\/CIK$/i.test(value.trim());
}

function factPayload(fact: SecFilingXbrlFact): Row {
  const lexical = simpleLexicalValue(fact.valueTree);
  return {
    factKey: fact.factKey,
    concept: fact.concept,
    rawLexicalStatus: lexical.supported ? "available" : "unsupported_mixed_content",
    rawLexicalValue: lexical.supported ? lexical.value : null,
    parsedTextValue: fact.valueText,
    valueTree: fact.valueTree,
    contextRef: fact.contextRef,
    context: fact.context,
    unitRef: fact.unitRef,
    decimals: fact.decimals,
    precision: fact.precision,
    scale: fact.scale,
    sign: fact.sign,
    inlineFormat: fact.inlineFormat,
    isNil: fact.isNil,
    source: {
      artifactId: fact.source.artifactId,
      issuerCik: fact.source.issuerCik,
      accession: fact.source.accession,
      documentName: fact.source.documentName,
      sourceUrl: fact.source.sourceUrl,
      contentHash: fact.source.contentHash,
      rawContentKind: fact.source.rawContentKind,
    },
  };
}

function rejectionPayload(rejection: SecFilingXbrlFactRejection): Row {
  return {
    reason: rejection.reason,
    detail: rejection.detail,
    concept: rejection.concept,
    conceptQName: rejection.conceptQName,
    contextRef: rejection.contextRef,
  };
}

function rawSourcePayload(artifact: SecFilingXbrlRawArtifact): Row {
  return {
    id: artifact.id,
    source_kind: "filing_xbrl",
    source_url: artifact.sourceUrl,
    source_identity: artifact.sourceIdentity,
    cik: artifact.issuerCik,
    fetched_at: artifact.fetchedAt,
    ingested_at: artifact.fetchedAt,
    content_hash: artifact.contentHash,
    source_schema_version: "filing-xbrl-context-v1",
    raw_content_kind: artifact.rawContentKind,
    raw_content: artifact.rawContent,
    payload: {
      accession: artifact.accession,
      role: artifact.role,
      document_name: artifact.documentName,
      content_type: artifact.contentType,
    },
  };
}

function resultRow(resultId: string, payloadSha256: string, payload: SecCoverObservationPayload): Row {
  return {
    id: resultId,
    lineage_kind: payload.identity.lineageKind,
    raw_item_id: payload.identity.rawItemId,
    filing_ledger_accession_number: payload.identity.lineageKind === "structured_filing_artifact"
      ? payload.identity.accessionNumber
      : null,
    filing_ledger_source_raw_id: payload.identity.filingLedgerRawSourceId,
    filing_ledger_source_kind: payload.identity.lineageKind === "structured_filing_artifact" ? "submissions" : null,
    accession_number: payload.identity.accessionNumber,
    issuer_cik: payload.identity.issuerCik,
    form_type_raw: payload.identity.formTypeRaw,
    filing_date_raw: payload.identity.filingDateRaw,
    accepted_at_raw: payload.identity.acceptedAtRaw,
    accepted_at: payload.identity.acceptedAt,
    source_parser_version: payload.identity.sourceParserVersion,
    source_state: payload.source.status,
    source_state_hash: sha256(stableStringify(payload.source)),
    source_raw_id: payload.source.rawSourceId,
    source_url: payload.source.url,
    source_document: payload.source.documentName,
    source_sha256: payload.source.sha256,
    extraction_method: payload.extractionMethod,
    extraction_version: payload.storageVersion,
    extraction_status: payload.extractionStatus,
    observation_count: payload.observations.length,
    result_payload: payload,
    payload_sha256: payloadSha256,
  };
}

function lineageIdentity(payload: SecCoverObservationPayload) {
  return payload.identity.lineageKind === "raw_item_primary_document"
    ? `raw_item:${payload.identity.rawItemId}`
    : `filing_ledger:${payload.identity.accessionNumber}:${payload.identity.filingLedgerRawSourceId}:${payload.source.rawSourceId}`;
}

function observationRow(resultId: string, observation: SecCoverSecurityObservation): Row {
  return {
    result_id: resultId,
    observation_index: observation.observationIndex,
    observation_key: observation.observationKey,
    issuer_cik_raw: observation.issuerCikRaw,
    issuer_cik: observation.issuerCik,
    context_ref: observation.contextRef,
    context_hash: observation.contextHash,
    period_kind: observation.context.period.kind,
    instant_date: observation.context.period.kind === "instant" ? observation.context.period.instant : null,
    start_date: observation.context.period.kind === "duration" ? observation.context.period.startDate : null,
    end_date: observation.context.period.kind === "duration" ? observation.context.period.endDate : null,
    dimensions_payload: observation.context.dimensions,
    security_title_status: observation.securityTitle.status,
    security_title_raw: observation.securityTitle.rawLexicalValue,
    trading_symbol_status: observation.tradingSymbol.status,
    trading_symbol_raw: observation.tradingSymbol.rawLexicalValue,
    exchange_status: observation.exchange.status,
    exchange_raw: observation.exchange.rawLexicalValue,
    structural_payload: observation,
  };
}

function normalizeStoredObservationRow(row: Row): Row {
  return {
    result_id: stringValue(row.result_id),
    observation_index: Number(row.observation_index),
    observation_key: stringValue(row.observation_key),
    issuer_cik_raw: stringValue(row.issuer_cik_raw),
    issuer_cik: stringValue(row.issuer_cik),
    context_ref: stringValue(row.context_ref),
    context_hash: stringValue(row.context_hash),
    period_kind: stringValue(row.period_kind),
    instant_date: nullableDate(row.instant_date),
    start_date: nullableDate(row.start_date),
    end_date: nullableDate(row.end_date),
    dimensions_payload: row.dimensions_payload,
    security_title_status: stringValue(row.security_title_status),
    security_title_raw: nullableRawString(row.security_title_raw),
    trading_symbol_status: stringValue(row.trading_symbol_status),
    trading_symbol_raw: nullableRawString(row.trading_symbol_raw),
    exchange_status: stringValue(row.exchange_status),
    exchange_raw: nullableRawString(row.exchange_raw),
    structural_payload: row.structural_payload,
  };
}

function rawItemSnapshot(rawItem: Row, rawItemId: string) {
  const raw = record(rawItem.raw_payload);
  const acceptedAtRaw = nullableString(raw.accepted_at);
  return {
    rawItemId,
    sourceCode: stringValue(rawItem.source_code) as "sec_edgar",
    sourceGroup: stringValue(rawItem.source_group) as "filings",
    sourceUniqueId: stringValue(rawItem.source_unique_id),
    accessionNumber: stringValue(raw.accession_number),
    issuerCikRaw: stringValue(raw.cik),
    issuerCik: normalizeCik(raw.cik),
    formTypeRaw: normalizeForm(raw.form_type),
    filingDateRaw: nullableDate(raw.filing_date),
    acceptedAtRaw,
    acceptedAt: normalizedTimestamp(acceptedAtRaw),
    sourceParserVersion: nullableString(raw.parser_version),
    sourceUrl: nullableString(rawItem.source_url),
    primaryDocumentUrl: nullableString(raw.primary_document_url),
    primaryDocumentHtml: rawString(raw.primary_document_html),
    primaryDocumentHtmlCharCount: integerOrNull(raw.primary_document_html_char_count),
    primaryDocumentHtmlTruncated: raw.primary_document_html_truncated === true,
    fetchedAt: normalizedTimestamp(rawItem.fetched_at),
  };
}

function identityPayload(snapshot: ReturnType<typeof rawItemSnapshot>): SecCoverObservationPayload["identity"] {
  return {
    lineageKind: "raw_item_primary_document",
    rawItemId: snapshot.rawItemId,
    filingLedgerRawSourceId: null,
    sourceCode: snapshot.sourceCode,
    sourceGroup: snapshot.sourceGroup,
    sourceUniqueId: snapshot.sourceUniqueId,
    accessionNumber: snapshot.accessionNumber,
    issuerCikRaw: snapshot.issuerCikRaw,
    issuerCik: snapshot.issuerCik,
    formTypeRaw: snapshot.formTypeRaw,
    filingDateRaw: snapshot.filingDateRaw,
    acceptedAtRaw: snapshot.acceptedAtRaw,
    acceptedAt: snapshot.acceptedAt,
    sourceParserVersion: snapshot.sourceParserVersion,
  };
}

function validateIdentitySnapshot(snapshot: ReturnType<typeof rawItemSnapshot>) {
  if (snapshot.sourceCode !== "sec_edgar" || snapshot.sourceGroup !== "filings") {
    throw new SecCoverObservationSourceError("invalid_source", "SEC cover observation source identity is invalid");
  }
  if (!ACCESSION_PATTERN.test(snapshot.accessionNumber) || snapshot.sourceUniqueId !== snapshot.accessionNumber) {
    throw new SecCoverObservationSourceError("invalid_accession", "SEC cover observation accession identity is invalid");
  }
  if (!CIK_PATTERN.test(snapshot.issuerCik) || snapshot.issuerCik === "0000000000") {
    throw new SecCoverObservationSourceError("invalid_issuer_cik", "SEC cover observation issuer CIK is invalid");
  }
  if (!snapshot.formTypeRaw || snapshot.formTypeRaw.length > 32) {
    throw new SecCoverObservationSourceError("invalid_form", "SEC cover observation form identity is invalid");
  }
}

function documentNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/(^|\.)sec\.gov$/i.test(url.hostname)) return null;
    const name = decodeURIComponent(url.pathname.split("/").at(-1) || "");
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(name) ? name : null;
  } catch {
    return null;
  }
}

function simpleLexicalValue(value: unknown): { supported: true; value: string | null } | { supported: false; value: null } {
  if (value === null || value === undefined) return { supported: true, value: null };
  if (typeof value === "string") return { supported: true, value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Row;
    const contentKeys = Object.keys(object).filter((key) => !key.startsWith("@"));
    if (contentKeys.length === 0) return { supported: true, value: null };
    if (contentKeys.length !== 1) return { supported: false, value: null };
    const child = object[contentKeys[0]!];
    if (contentKeys[0] === "#text") {
      return typeof child === "string" ? { supported: true, value: child } : { supported: false, value: null };
    }
    return simpleLexicalValue(child);
  }
  if (Array.isArray(value) && value.length === 1) return simpleLexicalValue(value[0]);
  return { supported: false, value: null };
}

function normalizeForm(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeCik(value: unknown) {
  const text = stringValue(value);
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : "";
}

function normalizedTimestamp(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  const timestamp = new Date(text);
  return Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
}

function integerOrNull(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rawString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function nullableRawString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nullableDate(value: unknown) {
  const text = stringValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Row;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicUuid(value: string) {
  const bytes = Buffer.from(sha256(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown source identity error";
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const CIK_PATTERN = /^\d{10}$/;
