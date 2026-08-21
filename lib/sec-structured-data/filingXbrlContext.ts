import { createHash } from "node:crypto";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { DomUtils, parseDocument } from "htmlparser2";
import { buildSecArchiveFilingUrls } from "../sources/sec/archiveUrls.ts";
import type { SecOsFilingContextCandidate } from "./osCandidateExtraction.ts";
import type { SecFilingRow } from "./types.ts";

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const CIK_PATTERN = /^\d{10}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const XBRL_INSTANCE_NAMESPACE = "http://www.xbrl.org/2003/instance";
const XBRL_DIMENSIONS_NAMESPACE = "http://xbrl.org/2006/xbrldi";
const INLINE_XBRL_NAMESPACES = new Set([
  "http://www.xbrl.org/2013/inlineXBRL",
  "http://www.xbrl.org/2008/inlineXBRL",
]);

export const SEC_FILING_XBRL_UNAVAILABLE_REASONS = [
  "ACCESSION_MISMATCH",
  "AMBIGUOUS_CONTEXT_REF",
  "BROKEN_CONTEXT_REF",
  "CONFLICTING_CONTEXT_IDS",
  "FILING_ARTIFACT_MISSING",
  "FILING_IDENTITY_INVALID",
  "FILING_PRIMARY_DOCUMENT_MISSING",
  "FILING_XBRL_DOCUMENT_AMBIGUOUS",
  "FILING_XBRL_FACT_NOT_FOUND",
  "FILING_XBRL_PARSE_FAILED",
  "PRIMARY_IXDS_INCOMPLETE",
  "PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS",
  "UNINTERPRETABLE_TYPED_MEMBER",
  "UNSUPPORTED_FILING_XBRL_CONSTRUCT",
] as const;

export type SecFilingXbrlUnavailableReason =
  (typeof SEC_FILING_XBRL_UNAVAILABLE_REASONS)[number];

export type SecFilingXbrlArtifactRole =
  | "archive_index"
  | "filing_index"
  | "primary_document"
  | "inline_xbrl"
  | "instance_xml";

export type SecFilingXbrlRawArtifact = {
  id: string;
  issuerCik: string;
  accession: string;
  role: SecFilingXbrlArtifactRole;
  documentName: string;
  sourceUrl: string;
  sourceIdentity: string;
  fetchedAt: string;
  contentType: string | null;
  contentHash: string;
  rawContentKind: "authoritative_http_body" | "injected_exact_body";
  rawContent: string;
};

export type SecFilingXbrlDiscoveredDocument = {
  documentName: string;
  sourceUrl: string;
  size: number | null;
  isPrimary: boolean;
  isInlineCandidate: boolean;
  isInstanceCandidate: boolean;
  sequence: string | null;
  description: string | null;
  attachmentType: string | null;
  isInlineXbrl: boolean | null;
  ixdsDisposition: "primary" | "separate" | "ambiguous" | "not_inline";
};

type SecFilingAttachmentMetadata = {
  sequence: string | null;
  description: string | null;
  documentName: string;
  attachmentType: string | null;
  isInlineXbrl: boolean;
};

export type SecFilingXbrlDiscovery = {
  issuerCik: string;
  accession: string;
  archiveDirectoryUrl: string;
  indexJsonUrl: string;
  filingIndexUrl: string;
  primaryDocument: SecFilingXbrlDiscoveredDocument;
  primaryIxdsDocuments: SecFilingXbrlDiscoveredDocument[];
  separateInlineDocuments: SecFilingXbrlDiscoveredDocument[];
  documents: SecFilingXbrlDiscoveredDocument[];
};

export type SecFilingXbrlFetchResult =
  | {
      status: "AVAILABLE";
      discovery: SecFilingXbrlDiscovery;
      artifacts: SecFilingXbrlRawArtifact[];
    }
  | {
      status: "UNAVAILABLE";
      reason: SecFilingXbrlUnavailableReason;
      detail: string;
      artifacts: SecFilingXbrlRawArtifact[];
    };

export type SecXbrlQName = {
  qname: string;
  prefix: string | null;
  localName: string;
  namespaceUri: string | null;
};

export type SecXbrlExplicitDimension = {
  kind: "explicit";
  axis: SecXbrlQName;
  member: SecXbrlQName;
};

export type SecXbrlTypedDimension = {
  kind: "typed";
  axis: SecXbrlQName;
  valueQName: SecXbrlQName;
  valueText: string | null;
  canonicalXml: string;
  canonicalValueTree: unknown;
};

export type SecXbrlDimension = SecXbrlExplicitDimension | SecXbrlTypedDimension;

export type SecXbrlPeriod =
  | { kind: "instant"; instant: string }
  | { kind: "duration"; startDate: string; endDate: string };

export type SecXbrlContext = {
  id: string;
  entityIdentifier: string;
  entityScheme: string;
  period: SecXbrlPeriod;
  dimensions: SecXbrlDimension[];
};

export type SecFilingXbrlFact = {
  factKey: string;
  concept: SecXbrlQName;
  valueText: string | null;
  valueTree: unknown;
  contextRef: string;
  unitRef: string | null;
  decimals: string | null;
  precision: string | null;
  scale: string | null;
  sign: string | null;
  inlineFormat: string | null;
  isNil: boolean;
  context: SecXbrlContext;
  source: {
    issuerCik: string;
    accession: string;
    documentName: string;
    sourceUrl: string;
    contentHash: string;
  };
};

export type SecFilingXbrlDocument = {
  status: "AVAILABLE";
  documentKind: "inline_xbrl" | "instance_xml";
  namespaces: Record<string, string>;
  contexts: SecXbrlContext[];
  facts: SecFilingXbrlFact[];
  rejections: SecFilingXbrlFactRejection[];
  source: SecFilingXbrlFact["source"];
};

export type SecFilingXbrlDocumentSet = {
  status: "AVAILABLE";
  documentKind: "inline_xbrl_ixds" | "instance_xml";
  contexts: SecXbrlContext[];
  facts: SecFilingXbrlFact[];
  rejections: SecFilingXbrlFactRejection[];
  sources: SecFilingXbrlFact["source"][];
};

export type SecFilingXbrlDocumentSetResult =
  | SecFilingXbrlDocumentSet
  | {
      status: "UNAVAILABLE";
      reason: SecFilingXbrlUnavailableReason;
      detail: string;
      sources: SecFilingXbrlFact["source"][];
    };

export type SecFilingXbrlFactRejection = {
  reason: SecFilingXbrlUnavailableReason;
  detail: string;
  conceptQName: string | null;
  contextRef: string | null;
};

export type SecFilingXbrlParseResult =
  | SecFilingXbrlDocument
  | {
      status: "UNAVAILABLE";
      reason: SecFilingXbrlUnavailableReason;
      detail: string;
      source: SecFilingXbrlFact["source"];
    };

export type SecOsCandidateFilingContextResult =
  | {
      status: "AVAILABLE";
      candidate: SecOsFilingContextCandidate;
      matches: SecFilingXbrlFact[];
    }
  | {
      status: "UNAVAILABLE";
      candidate: SecOsFilingContextCandidate;
      reason: SecFilingXbrlUnavailableReason;
      detail: string;
    };

export interface SecFilingXbrlArtifactRepository {
  ingestArtifacts(artifacts: readonly SecFilingXbrlRawArtifact[]): Promise<{
    inserted: number;
    deduped: number;
  }>;
  readArtifacts(issuerCik: string, accession: string): Promise<SecFilingXbrlRawArtifact[]>;
}

export type SecFilingXbrlIngestResult =
  | {
      status: "AVAILABLE";
      source: "cache" | "sec";
      artifacts: SecFilingXbrlRawArtifact[];
      inserted: number;
      deduped: number;
    }
  | {
      status: "UNAVAILABLE";
      source: "sec";
      reason: SecFilingXbrlUnavailableReason;
      detail: string;
      artifacts: SecFilingXbrlRawArtifact[];
      inserted: number;
      deduped: number;
    };

export type SecFilingXbrlSqlQueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
  rowCount: number | null;
};

export interface SecFilingXbrlSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<SecFilingXbrlSqlQueryResult<Row>>;
}

export class InMemorySecFilingXbrlArtifactRepository implements SecFilingXbrlArtifactRepository {
  private readonly artifacts = new Map<string, SecFilingXbrlRawArtifact>();

  async ingestArtifacts(artifacts: readonly SecFilingXbrlRawArtifact[]) {
    let inserted = 0;
    for (const artifact of artifacts) {
      validateArtifact(artifact);
      const identity = artifactIdentity(artifact);
      if (this.artifacts.has(identity)) continue;
      this.artifacts.set(identity, structuredClone(artifact));
      inserted += 1;
    }
    return { inserted, deduped: artifacts.length - inserted };
  }

  async readArtifacts(issuerCik: string, accession: string) {
    return [...this.artifacts.values()]
      .filter((artifact) => artifact.issuerCik === issuerCik && artifact.accession === accession)
      .sort(compareArtifacts)
      .map((artifact) => structuredClone(artifact));
  }
}

export class PostgresSecFilingXbrlArtifactRepository implements SecFilingXbrlArtifactRepository {
  private readonly client: SecFilingXbrlSqlClient;

  constructor(client: SecFilingXbrlSqlClient) {
    this.client = client;
  }

  async ingestArtifacts(artifacts: readonly SecFilingXbrlRawArtifact[]) {
    let inserted = 0;
    for (const artifact of artifacts) {
      validateArtifact(artifact);
      const result = await this.client.query<{ id: string }>(
        `insert into public.sec_structured_raw_sources (
           id, source_kind, source_url, source_identity, cik, fetched_at,
           ingested_at, content_hash, source_schema_version, raw_content_kind,
           raw_content, payload
         ) values (
           $1, 'filing_xbrl', $2, $3, $4, $5, $5, $6, 'filing-xbrl-context-v1',
           $7, $8, $9::jsonb
         )
         on conflict (source_kind, source_identity, content_hash) do nothing
         returning id`,
        [
          artifact.id,
          artifact.sourceUrl,
          artifact.sourceIdentity,
          artifact.issuerCik,
          artifact.fetchedAt,
          artifact.contentHash,
          artifact.rawContentKind,
          artifact.rawContent,
          JSON.stringify({
            accession: artifact.accession,
            role: artifact.role,
            document_name: artifact.documentName,
            content_type: artifact.contentType,
          }),
        ],
      );
      inserted += result.rowCount ?? result.rows.length;
    }
    return { inserted, deduped: artifacts.length - inserted };
  }

  async readArtifacts(issuerCik: string, accession: string) {
    const result = await this.client.query<Record<string, unknown>>(
      `select id::text, cik, source_url, source_identity, fetched_at::text,
              content_hash, raw_content_kind, raw_content, payload
       from public.sec_structured_raw_sources
       where source_kind = 'filing_xbrl'
         and cik = $1
         and payload ->> 'accession' = $2
       order by source_url, content_hash`,
      [issuerCik, accession],
    );
    return result.rows.map(mapStoredArtifact).sort(compareArtifacts);
  }
}

export class SecFilingXbrlHttpClient {
  private lastRequestAt = 0;
  private readonly userAgent: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => Date;
  private readonly minimumIntervalMs: number;

  constructor(
    userAgent: string,
    fetchImplementation: typeof fetch = fetch,
    now: () => Date = () => new Date(),
    minimumIntervalMs = 125,
  ) {
    if (!userAgent.trim() || !(/@/.test(userAgent) || /https?:\/\//i.test(userAgent))) {
      throw new Error("SEC user agent must identify an organization and contact channel");
    }
    if (minimumIntervalMs < 100) throw new Error("SEC request interval must be at least 100ms");
    this.userAgent = userAgent;
    this.fetchImplementation = fetchImplementation;
    this.now = now;
    this.minimumIntervalMs = minimumIntervalMs;
  }

  async fetchFilingArtifacts(filing: SecFilingRow): Promise<SecFilingXbrlFetchResult> {
    const identity = validateFilingIdentity(filing);
    if (!identity.ok) return unavailableFetch("FILING_IDENTITY_INVALID", identity.detail);
    if (!filing.primaryDocument) {
      return unavailableFetch("FILING_PRIMARY_DOCUMENT_MISSING", "filing ledger has no primary document");
    }
    const urls = buildSecArchiveFilingUrls(filing.issuerCik, filing.accessionNumber);
    if (!urls) return unavailableFetch("FILING_IDENTITY_INVALID", "SEC archive URL could not be built");

    const indexResponse = await this.fetch(urls.indexJsonUrl, "application/json");
    if (!indexResponse.ok) {
      return unavailableFetch("FILING_ARTIFACT_MISSING", `archive index returned HTTP ${indexResponse.status}`);
    }
    const indexBody = await indexResponse.text();
    const fetchedAt = this.now().toISOString();
    const indexArtifact = createArtifact({
      filing,
      role: "archive_index",
      documentName: "index.json",
      sourceUrl: urls.indexJsonUrl,
      fetchedAt,
      contentType: indexResponse.headers.get("content-type"),
      rawContent: indexBody,
      rawContentKind: "authoritative_http_body",
    });
    const filingIndexResponse = await this.fetch(urls.indexHtmlUrl, "text/html,application/xhtml+xml");
    if (!filingIndexResponse.ok) {
      return unavailableFetch("FILING_ARTIFACT_MISSING", `filing index returned HTTP ${filingIndexResponse.status}`, [indexArtifact]);
    }
    const filingIndexBody = await filingIndexResponse.text();
    const filingIndexArtifact = createArtifact({
      filing,
      role: "filing_index",
      documentName: `${filing.accessionNumber}-index.html`,
      sourceUrl: urls.indexHtmlUrl,
      fetchedAt: this.now().toISOString(),
      contentType: filingIndexResponse.headers.get("content-type"),
      rawContent: filingIndexBody,
      rawContentKind: "authoritative_http_body",
    });
    const inventoryArtifacts = [indexArtifact, filingIndexArtifact];
    const discovery = discoverSecFilingXbrlDocuments(filing, indexBody, filingIndexBody);
    if (discovery.status === "UNAVAILABLE") {
      return { ...discovery, artifacts: inventoryArtifacts };
    }

    if (discovery.discovery.primaryDocument.isInlineXbrl) {
      if (discovery.discovery.primaryIxdsDocuments.length === 0) {
        return unavailableFetch("PRIMARY_IXDS_INCOMPLETE", "filing metadata identified no primary IXDS documents", inventoryArtifacts);
      }
      const ambiguous = discovery.discovery.documents.filter((document) => document.ixdsDisposition === "ambiguous");
      if (ambiguous.length > 0) {
        return unavailableFetch(
          "PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS",
          `primary IXDS membership is ambiguous for ${ambiguous.map((document) => document.documentName).join(", ")}`,
          inventoryArtifacts,
        );
      }
      const artifacts = [...inventoryArtifacts];
      for (const document of discovery.discovery.primaryIxdsDocuments) {
        const fetched = await this.fetchDocument(filing, document, "inline_xbrl");
        if (fetched.status === "UNAVAILABLE") return { ...fetched, artifacts };
        if (!isInlineXbrlDocument(fetched.artifact.rawContent)) {
          return unavailableFetch(
            "PRIMARY_IXDS_INCOMPLETE",
            `${document.documentName} is marked iXBRL by filing metadata but is not structurally Inline XBRL`,
            [...artifacts, fetched.artifact],
          );
        }
        artifacts.push(fetched.artifact);
      }
      return { status: "AVAILABLE", discovery: discovery.discovery, artifacts };
    }

    const primary = await this.fetchDocument(filing, discovery.discovery.primaryDocument, "primary_document");
    if (primary.status === "UNAVAILABLE") {
      return { ...primary, artifacts: inventoryArtifacts };
    }
    const artifacts = [...inventoryArtifacts, primary.artifact];
    if (isInlineXbrlDocument(primary.artifact.rawContent)) {
      return unavailableFetch(
        "PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS",
        "primary document is structurally Inline XBRL but filing attachment metadata did not identify it as iXBRL",
        artifacts,
      );
    }

    const instanceCandidates = discovery.discovery.documents.filter((document) => document.isInstanceCandidate);
    if (instanceCandidates.length !== 1) {
      return unavailableFetch(
        "FILING_XBRL_DOCUMENT_AMBIGUOUS",
        `expected one filing instance candidate, found ${instanceCandidates.length}`,
        artifacts,
      );
    }
    const instance = await this.fetchDocument(filing, instanceCandidates[0]!, "instance_xml");
    if (instance.status === "UNAVAILABLE") return { ...instance, artifacts };
    if (!looksLikeXbrlInstance(instance.artifact.rawContent)) {
      return unavailableFetch(
        "UNSUPPORTED_FILING_XBRL_CONSTRUCT",
        "discovered instance candidate is not an XBRL instance",
        [...artifacts, instance.artifact],
      );
    }
    return {
      status: "AVAILABLE",
      discovery: discovery.discovery,
      artifacts: [...artifacts, instance.artifact],
    };
  }

  private async fetchDocument(
    filing: SecFilingRow,
    document: SecFilingXbrlDiscoveredDocument,
    role: "primary_document" | "inline_xbrl" | "instance_xml",
  ): Promise<{ status: "AVAILABLE"; artifact: SecFilingXbrlRawArtifact } | {
    status: "UNAVAILABLE";
    reason: SecFilingXbrlUnavailableReason;
    detail: string;
  }> {
    const response = await this.fetch(document.sourceUrl, "application/xhtml+xml,application/xml,text/html,text/xml");
    if (!response.ok) {
      return {
        status: "UNAVAILABLE",
        reason: "FILING_ARTIFACT_MISSING",
        detail: `${document.documentName} returned HTTP ${response.status}`,
      };
    }
    return {
      status: "AVAILABLE",
      artifact: createArtifact({
        filing,
        role,
        documentName: document.documentName,
        sourceUrl: document.sourceUrl,
        fetchedAt: this.now().toISOString(),
        contentType: response.headers.get("content-type"),
        rawContent: await response.text(),
        rawContentKind: "authoritative_http_body",
      }),
    };
  }

  private async fetch(url: string, accept: string) {
    const remaining = this.minimumIntervalMs - (Date.now() - this.lastRequestAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
    this.lastRequestAt = Date.now();
    return this.fetchImplementation(url, {
      cache: "no-store",
      headers: { Accept: accept, "User-Agent": this.userAgent },
    });
  }
}

export class SecFilingXbrlContextService {
  private readonly sourceClient: Pick<SecFilingXbrlHttpClient, "fetchFilingArtifacts">;
  private readonly repository: SecFilingXbrlArtifactRepository;

  constructor(
    sourceClient: Pick<SecFilingXbrlHttpClient, "fetchFilingArtifacts">,
    repository: SecFilingXbrlArtifactRepository,
  ) {
    this.sourceClient = sourceClient;
    this.repository = repository;
  }

  async ingestFiling(filing: SecFilingRow): Promise<SecFilingXbrlIngestResult> {
    const cached = await this.repository.readArtifacts(filing.issuerCik, filing.accessionNumber);
    if (cachedFilingIsComplete(filing, cached)) {
      return { status: "AVAILABLE", source: "cache", artifacts: cached, inserted: 0, deduped: cached.length };
    }
    const fetched = await this.sourceClient.fetchFilingArtifacts(filing);
    const write = await this.repository.ingestArtifacts(fetched.artifacts);
    if (fetched.status === "UNAVAILABLE") {
      return {
        status: "UNAVAILABLE",
        source: "sec",
        reason: fetched.reason,
        detail: fetched.detail,
        artifacts: fetched.artifacts,
        ...write,
      };
    }
    return { status: "AVAILABLE", source: "sec", artifacts: fetched.artifacts, ...write };
  }

  readOsCandidate(candidate: SecOsFilingContextCandidate) {
    return readOsCandidateFilingContexts({ candidate, repository: this.repository });
  }
}

function cachedFilingIsComplete(
  filing: SecFilingRow,
  artifacts: readonly SecFilingXbrlRawArtifact[],
) {
  const archiveIndex = artifacts.filter((artifact) => artifact.role === "archive_index");
  const filingIndex = artifacts.filter((artifact) => artifact.role === "filing_index");
  if (archiveIndex.length !== 1 || filingIndex.length !== 1) return false;
  const discovery = discoverSecFilingXbrlDocuments(filing, archiveIndex[0]!.rawContent, filingIndex[0]!.rawContent);
  if (discovery.status === "UNAVAILABLE") return false;
  if (discovery.discovery.primaryDocument.isInlineXbrl) {
    if (discovery.discovery.documents.some((document) => document.ixdsDisposition === "ambiguous")) return false;
    const persisted = new Set(
      artifacts.filter((artifact) => artifact.role === "inline_xbrl").map((artifact) => artifact.documentName),
    );
    return discovery.discovery.primaryIxdsDocuments.length > 0
      && discovery.discovery.primaryIxdsDocuments.every((document) => persisted.has(document.documentName));
  }
  return artifacts.some((artifact) => artifact.role === "instance_xml");
}

export function discoverSecFilingXbrlDocuments(
  filing: SecFilingRow,
  indexBody: string,
  filingIndexBody?: string,
): { status: "AVAILABLE"; discovery: SecFilingXbrlDiscovery } | {
  status: "UNAVAILABLE";
  reason: SecFilingXbrlUnavailableReason;
  detail: string;
} {
  const identity = validateFilingIdentity(filing);
  if (!identity.ok) return { status: "UNAVAILABLE", reason: "FILING_IDENTITY_INVALID", detail: identity.detail };
  if (!filing.primaryDocument) {
    return { status: "UNAVAILABLE", reason: "FILING_PRIMARY_DOCUMENT_MISSING", detail: "filing ledger has no primary document" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(indexBody);
  } catch {
    return { status: "UNAVAILABLE", reason: "FILING_XBRL_PARSE_FAILED", detail: "archive index is not valid JSON" };
  }
  const root = asRecord(parsed);
  const directory = asRecord(root?.directory);
  const directoryName = stringValue(directory?.name);
  const urls = buildSecArchiveFilingUrls(filing.issuerCik, filing.accessionNumber)!;
  const expectedPath = new URL(urls.archiveDirectoryUrl).pathname;
  if (directoryName !== expectedPath) {
    return { status: "UNAVAILABLE", reason: "ACCESSION_MISMATCH", detail: "archive index directory does not match filing identity" };
  }
  const attachmentMetadata = filingIndexBody === undefined
    ? { status: "AVAILABLE" as const, byDocumentName: new Map<string, SecFilingAttachmentMetadata>() }
    : parseSecFilingAttachmentMetadata(filing, filingIndexBody);
  if (attachmentMetadata.status === "UNAVAILABLE") return attachmentMetadata;
  const items = Array.isArray(directory?.item) ? directory.item : [];
  const documents: SecFilingXbrlDiscoveredDocument[] = [];
  for (const itemValue of items) {
    const item = asRecord(itemValue);
    const name = stringValue(item?.name);
    if (!name || !safeArchiveDocumentName(name)) continue;
    const size = numericSize(item?.size);
    const sourceUrl = `${urls.archiveDirectoryUrl}/${encodeURIComponent(name)}`;
    const metadata = attachmentMetadata.byDocumentName.get(name);
    const isInlineXbrl = metadata?.isInlineXbrl ?? null;
    documents.push({
      documentName: name,
      sourceUrl,
      size,
      isPrimary: name === filing.primaryDocument,
      isInlineCandidate: isInlineXbrl === true,
      isInstanceCandidate: isInstanceDocumentCandidate(name),
      sequence: metadata?.sequence ?? null,
      description: metadata?.description ?? null,
      attachmentType: metadata?.attachmentType ?? null,
      isInlineXbrl,
      ixdsDisposition: classifyIxdsDisposition({
        isPrimary: name === filing.primaryDocument,
        isInlineXbrl,
        attachmentType: metadata?.attachmentType ?? null,
      }),
    });
  }
  const primary = documents.find((document) => document.isPrimary);
  if (!primary) {
    return { status: "UNAVAILABLE", reason: "FILING_ARTIFACT_MISSING", detail: "primary document is absent from archive index" };
  }
  if (filingIndexBody !== undefined && primary.isInlineXbrl === null) {
    return { status: "UNAVAILABLE", reason: "PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS", detail: "primary document is absent from filing attachment metadata" };
  }
  const primaryIxdsDocuments = documents
    .filter((document) => document.ixdsDisposition === "primary")
    .sort(compareDiscoveredDocuments);
  const separateInlineDocuments = documents
    .filter((document) => document.ixdsDisposition === "separate")
    .sort(compareDiscoveredDocuments);
  return {
    status: "AVAILABLE",
    discovery: {
      issuerCik: filing.issuerCik,
      accession: filing.accessionNumber,
      archiveDirectoryUrl: urls.archiveDirectoryUrl,
      indexJsonUrl: urls.indexJsonUrl,
      filingIndexUrl: urls.indexHtmlUrl,
      primaryDocument: primary,
      primaryIxdsDocuments,
      separateInlineDocuments,
      documents: documents.sort((left, right) => left.documentName.localeCompare(right.documentName)),
    },
  };
}

export function parseSecFilingXbrlArtifact(
  artifact: SecFilingXbrlRawArtifact,
): SecFilingXbrlParseResult {
  const structure = parseArtifactStructure(artifact);
  if (structure.status === "UNAVAILABLE") return structure;
  const contextResult = extractContexts(structure.parsed, structure.namespaces);
  const source = artifactSource(artifact);
  if (contextResult.status === "UNAVAILABLE") return { ...contextResult, source };
  const factResult = extractFacts(
    structure.parsed,
    structure.namespaces,
    contextResult.contextsById,
    artifact,
    structure.documentKind,
  );
  if (factResult.status === "UNAVAILABLE") return { ...factResult, source };
  return {
    status: "AVAILABLE",
    documentKind: structure.documentKind,
    namespaces: structure.namespaces,
    contexts: [...contextResult.contextsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    facts: factResult.facts.sort(compareFacts),
    rejections: factResult.rejections,
    source,
  };
}

export function parseSecFilingXbrlArtifacts(
  artifacts: readonly SecFilingXbrlRawArtifact[],
): SecFilingXbrlDocumentSetResult {
  const filingArtifacts = artifacts
    .filter((artifact) => artifact.role === "inline_xbrl" || artifact.role === "instance_xml")
    .sort(compareArtifacts);
  const sources = filingArtifacts.map(artifactSource);
  if (filingArtifacts.length === 0) {
    return { status: "UNAVAILABLE", reason: "FILING_ARTIFACT_MISSING", detail: "filing XBRL document set is empty", sources };
  }
  const identity = `${filingArtifacts[0]!.issuerCik}:${filingArtifacts[0]!.accession}`;
  if (filingArtifacts.some((artifact) => `${artifact.issuerCik}:${artifact.accession}` !== identity)) {
    return { status: "UNAVAILABLE", reason: "ACCESSION_MISMATCH", detail: "document set contains mixed filing identities", sources };
  }
  const roles = new Set(filingArtifacts.map((artifact) => artifact.role));
  if (roles.size > 1 || (roles.has("instance_xml") && filingArtifacts.length !== 1)) {
    return {
      status: "UNAVAILABLE",
      reason: "FILING_XBRL_DOCUMENT_AMBIGUOUS",
      detail: "document set mixes Inline XBRL and instance XML or contains multiple instances",
      sources,
    };
  }

  const structures: Array<Extract<ReturnType<typeof parseArtifactStructure>, { status: "AVAILABLE" }>> = [];
  for (const artifact of filingArtifacts) {
    const structure = parseArtifactStructure(artifact);
    if (structure.status === "UNAVAILABLE") return { ...structure, sources };
    if (artifact.role === "inline_xbrl" && structure.documentKind !== "inline_xbrl") {
      return { status: "UNAVAILABLE", reason: "PRIMARY_IXDS_INCOMPLETE", detail: `${artifact.documentName} is not Inline XBRL`, sources };
    }
    if (artifact.role === "instance_xml" && structure.documentKind !== "instance_xml") {
      return { status: "UNAVAILABLE", reason: "UNSUPPORTED_FILING_XBRL_CONSTRUCT", detail: `${artifact.documentName} is not an XBRL instance`, sources };
    }
    structures.push(structure);
  }

  const contextsById = new Map<string, SecXbrlContext>();
  for (const structure of structures) {
    const contexts = extractContexts(structure.parsed, structure.namespaces);
    if (contexts.status === "UNAVAILABLE") return { ...contexts, sources };
    for (const [id, context] of contexts.contextsById) {
      const current = contextsById.get(id);
      if (current && stableJson(current) !== stableJson(context)) {
        return { status: "UNAVAILABLE", reason: "CONFLICTING_CONTEXT_IDS", detail: `context id ${id} conflicts across IXDS documents`, sources };
      }
      contextsById.set(id, current ?? context);
    }
  }

  const facts: SecFilingXbrlFact[] = [];
  const rejections: SecFilingXbrlFactRejection[] = [];
  for (const structure of structures) {
    const extracted = extractFacts(
      structure.parsed,
      structure.namespaces,
      contextsById,
      structure.artifact,
      structure.documentKind,
    );
    if (extracted.status === "UNAVAILABLE") return { ...extracted, sources };
    facts.push(...extracted.facts);
    rejections.push(...extracted.rejections);
  }
  return {
    status: "AVAILABLE",
    documentKind: roles.has("inline_xbrl") ? "inline_xbrl_ixds" : "instance_xml",
    contexts: [...contextsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    facts: dedupeBy(facts, (fact) => fact.factKey).sort(compareFacts),
    rejections: dedupeBy(rejections, (rejection) => stableJson(rejection)),
    sources,
  };
}

function parseArtifactStructure(artifact: SecFilingXbrlRawArtifact): {
  status: "AVAILABLE";
  artifact: SecFilingXbrlRawArtifact;
  parsed: unknown;
  namespaces: Record<string, string>;
  documentKind: "inline_xbrl" | "instance_xml";
} | {
  status: "UNAVAILABLE";
  reason: SecFilingXbrlUnavailableReason;
  detail: string;
  source: SecFilingXbrlFact["source"];
} {
  validateArtifact(artifact);
  const source = artifactSource(artifact);
  const validation = XMLValidator.validate(artifact.rawContent, { allowBooleanAttributes: true });
  if (validation !== true) {
    return { status: "UNAVAILABLE", reason: "FILING_XBRL_PARSE_FAILED", detail: "artifact is not well-formed XML/XHTML", source };
  }
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      removeNSPrefix: false,
      processEntities: true,
      allowBooleanAttributes: true,
    }).parse(artifact.rawContent);
  } catch {
    return { status: "UNAVAILABLE", reason: "FILING_XBRL_PARSE_FAILED", detail: "XML/XHTML parser rejected artifact", source };
  }
  const namespaces = collectNamespaces(parsed);
  const documentKind = detectDocumentKind(parsed, namespaces);
  if (!documentKind) {
    return { status: "UNAVAILABLE", reason: "UNSUPPORTED_FILING_XBRL_CONSTRUCT", detail: "artifact is neither inline XBRL nor an XBRL instance", source };
  }
  return { status: "AVAILABLE", artifact, parsed, namespaces, documentKind };
}

export async function readOsCandidateFilingContexts(input: {
  candidate: SecOsFilingContextCandidate;
  repository: SecFilingXbrlArtifactRepository;
}): Promise<SecOsCandidateFilingContextResult> {
  const { candidate, repository } = input;
  const artifacts = await repository.readArtifacts(candidate.issuerCik, candidate.accession);
  const filingArtifacts = artifacts.filter((artifact) => artifact.role === "inline_xbrl" || artifact.role === "instance_xml");
  if (filingArtifacts.length === 0) {
    return unavailableCandidate(candidate, "FILING_ARTIFACT_MISSING", "no persisted filing XBRL artifact exists");
  }
  if (filingArtifacts.some((artifact) => artifact.issuerCik !== candidate.issuerCik || artifact.accession !== candidate.accession)) {
    return unavailableCandidate(candidate, "ACCESSION_MISMATCH", "artifact lineage does not match candidate");
  }
  const parsed = parseSecFilingXbrlArtifacts(filingArtifacts);
  if (parsed.status === "UNAVAILABLE") return unavailableCandidate(candidate, parsed.reason, parsed.detail);
  const relevantRejections = parsed.rejections.filter((rejection) =>
    rejection.conceptQName === `${candidate.taxonomy}:${candidate.concept}`
  );
  const matches = parsed.facts.filter((fact) =>
    fact.concept.qname === `${candidate.taxonomy}:${candidate.concept}`
    && fact.context.period.kind === "instant"
    && fact.context.period.instant === candidate.asOf
  );
  const unique = dedupeBy(matches, (fact) => fact.factKey).sort(compareFacts);
  if (unique.length === 0) {
    const rejection = relevantRejections[0];
    if (rejection) return unavailableCandidate(candidate, rejection.reason, rejection.detail);
    return unavailableCandidate(candidate, "FILING_XBRL_FACT_NOT_FOUND", "no exact accession/concept/as-of filing fact matched candidate");
  }
  return { status: "AVAILABLE", candidate, matches: unique };
}

function extractContexts(
  parsed: unknown,
  namespaces: Readonly<Record<string, string>>,
): { status: "AVAILABLE"; contextsById: Map<string, SecXbrlContext> } | {
  status: "UNAVAILABLE";
  reason: SecFilingXbrlUnavailableReason;
  detail: string;
} {
  const contextNodes = collectNamedNodes(parsed, (name) => {
    const qname = resolveQName(name, namespaces);
    return qname.localName === "context" && qname.namespaceUri === XBRL_INSTANCE_NAMESPACE;
  });
  const contextsById = new Map<string, SecXbrlContext>();
  for (const node of contextNodes) {
    const record = asRecord(node.value);
    if (!record) return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", "context is not an object");
    const id = attribute(record, "id");
    if (!id) return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", "context is missing id");
    const entity = firstDescendant(record, (name) => localName(name) === "entity");
    const identifier = firstDescendant(entity, (name) => localName(name) === "identifier");
    const identifierRecord = asRecord(identifier);
    const entityIdentifier = compactText(readNodeText(identifier));
    const entityScheme = attribute(identifierRecord, "scheme");
    if (!entityIdentifier || !entityScheme) {
      return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", `context ${id} has incomplete entity identity`);
    }
    const periodNode = firstDescendant(record, (name) => localName(name) === "period");
    const period = parsePeriod(periodNode);
    if (!period) return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", `context ${id} has unsupported period`);
    const dimensions = extractDimensions(record, namespaces);
    if (dimensions.status === "UNAVAILABLE") return dimensions;
    const context: SecXbrlContext = {
      id,
      entityIdentifier,
      entityScheme,
      period,
      dimensions: dimensions.dimensions.sort(compareDimensions),
    };
    const current = contextsById.get(id);
    if (current && stableJson(current) !== stableJson(context)) {
      return unavailableParse("CONFLICTING_CONTEXT_IDS", `context id ${id} has conflicting definitions`);
    }
    contextsById.set(id, current ?? context);
  }
  return { status: "AVAILABLE", contextsById };
}

function extractDimensions(
  context: Record<string, unknown>,
  namespaces: Readonly<Record<string, string>>,
): { status: "AVAILABLE"; dimensions: SecXbrlDimension[] } | {
  status: "UNAVAILABLE";
  reason: SecFilingXbrlUnavailableReason;
  detail: string;
} {
  const dimensions: SecXbrlDimension[] = [];
  const nodes = collectNamedNodes(context, (name) => {
    const qname = resolveQName(name, namespaces);
    return qname.namespaceUri === XBRL_DIMENSIONS_NAMESPACE
      && (qname.localName === "explicitMember" || qname.localName === "typedMember");
  });
  for (const node of nodes) {
    const record = asRecord(node.value);
    const axisName = attribute(record, "dimension");
    if (!axisName) return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", "dimension is missing axis QName");
    const axis = resolveQName(axisName, namespaces);
    if (!axis.namespaceUri) return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", `dimension axis ${axisName} has no namespace`);
    if (localName(node.name) === "explicitMember") {
      const memberName = compactText(readNodeText(node.value));
      if (!memberName) return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", "explicit dimension is missing member QName");
      const member = resolveQName(memberName, namespaces);
      if (!member.namespaceUri) return unavailableParse("UNSUPPORTED_FILING_XBRL_CONSTRUCT", `dimension member ${memberName} has no namespace`);
      dimensions.push({ kind: "explicit", axis, member });
      continue;
    }

    const valueEntries = Object.entries(record ?? {}).filter(([name]) => name !== "#text" && !name.startsWith("@"));
    if (valueEntries.length !== 1) {
      return unavailableParse("UNINTERPRETABLE_TYPED_MEMBER", `typed member for ${axisName} must contain exactly one value element`);
    }
    const [valueName, valueNode] = valueEntries[0]!;
    const valueQName = resolveQName(valueName, namespaces);
    if (!valueQName.namespaceUri) {
      return unavailableParse("UNINTERPRETABLE_TYPED_MEMBER", `typed member value ${valueName} has no namespace`);
    }
    let canonicalXml: string;
    try {
      canonicalXml = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: "@",
        format: false,
        suppressEmptyNode: false,
      }).build({ [valueName]: valueNode });
    } catch {
      return unavailableParse("UNINTERPRETABLE_TYPED_MEMBER", `typed member value ${valueName} could not be preserved`);
    }
    dimensions.push({
      kind: "typed",
      axis,
      valueQName,
      valueText: nullableCompactText(readNodeText(valueNode)),
      canonicalXml,
      canonicalValueTree: canonicalize(valueNode),
    });
  }
  return { status: "AVAILABLE", dimensions: dedupeBy(dimensions, dimensionIdentity) };
}

function extractFacts(
  parsed: unknown,
  namespaces: Readonly<Record<string, string>>,
  contextsById: ReadonlyMap<string, SecXbrlContext>,
  artifact: SecFilingXbrlRawArtifact,
  documentKind: "inline_xbrl" | "instance_xml",
): { status: "AVAILABLE"; facts: SecFilingXbrlFact[]; rejections: SecFilingXbrlFactRejection[] } | {
  status: "UNAVAILABLE";
  reason: SecFilingXbrlUnavailableReason;
  detail: string;
} {
  const factNodes: Array<{ conceptName: string; value: unknown; inline: boolean }> = [];
  walkNamedNodes(parsed, (name, value) => {
    const record = asRecord(value);
    const qname = resolveQName(name, namespaces);
    const isInlineNamespace = qname.namespaceUri ? INLINE_XBRL_NAMESPACES.has(qname.namespaceUri) : name.startsWith("ix:");
    if (isInlineNamespace && ["nonFraction", "nonNumeric"].includes(qname.localName)) {
      const conceptName = attribute(record, "name");
      if (conceptName) factNodes.push({ conceptName, value, inline: true });
      return;
    }
    if (isInlineNamespace && ["fraction", "tuple"].includes(qname.localName)) {
      factNodes.push({ conceptName: "", value: { ...record, "@unsupported": qname.localName }, inline: true });
      return;
    }
    if (!isInlineNamespace && attribute(record, "contextRef")) {
      factNodes.push({ conceptName: name, value, inline: false });
    }
  });

  const facts: SecFilingXbrlFact[] = [];
  const rejections: SecFilingXbrlFactRejection[] = [];
  for (const node of factNodes) {
    const record = asRecord(node.value);
    const unsupported = attribute(record, "unsupported");
    if (unsupported || attribute(record, "continuedAt")) {
      rejections.push({
        reason: "UNSUPPORTED_FILING_XBRL_CONSTRUCT",
        detail: unsupported ? `inline ${unsupported} fact is unsupported` : "continued inline fact is unsupported",
        conceptQName: node.conceptName || null,
        contextRef: attribute(record, "contextRef"),
      });
      continue;
    }
    const contextRef = attribute(record, "contextRef");
    if (!contextRef) {
      rejections.push({ reason: "BROKEN_CONTEXT_REF", detail: "filing fact is missing contextRef", conceptQName: node.conceptName || null, contextRef: null });
      continue;
    }
    const context = contextsById.get(contextRef);
    if (!context) {
      rejections.push({ reason: "BROKEN_CONTEXT_REF", detail: `contextRef ${contextRef} does not resolve`, conceptQName: node.conceptName || null, contextRef });
      continue;
    }
    const concept = resolveQName(node.conceptName, namespaces);
    if (!concept.namespaceUri) {
      rejections.push({
        reason: "UNSUPPORTED_FILING_XBRL_CONSTRUCT",
        detail: `fact concept ${node.conceptName} has no namespace`,
        conceptQName: node.conceptName || null,
        contextRef,
      });
      continue;
    }
    const valueTree = canonicalize(stripAttributes(record));
    const valueText = nullableCompactText(readNodeText(stripAttributes(record)));
    const factBase = {
      concept,
      valueText,
      valueTree,
      contextRef,
      unitRef: attribute(record, "unitRef"),
      decimals: attribute(record, "decimals"),
      precision: attribute(record, "precision"),
      scale: attribute(record, "scale"),
      sign: attribute(record, "sign"),
      inlineFormat: node.inline ? attribute(record, "format") : null,
      isNil: attribute(record, "nil") === "true" || attribute(record, "xsi:nil") === "true",
      context,
      source: artifactSource(artifact),
    };
    facts.push({
      ...factBase,
      factKey: sha256(stableJson({
        accession: artifact.accession,
        document: artifact.documentName,
        concept: concept.qname,
        contextRef,
        unitRef: factBase.unitRef,
        valueTree,
        decimals: factBase.decimals,
        precision: factBase.precision,
        scale: factBase.scale,
        sign: factBase.sign,
        inlineFormat: factBase.inlineFormat,
        isNil: factBase.isNil,
      })),
    });
  }
  return {
    status: "AVAILABLE",
    facts: dedupeBy(facts, (fact) => fact.factKey),
    rejections: dedupeBy(rejections, (rejection) => stableJson(rejection)),
  };
}

function detectDocumentKind(
  parsed: unknown,
  namespaces: Readonly<Record<string, string>>,
): "inline_xbrl" | "instance_xml" | null {
  const nodes = collectNamedNodes(parsed, () => true);
  if (nodes.some((node) => {
    const qname = resolveQName(node.name, namespaces);
    return qname.localName === "header" && qname.namespaceUri !== null && INLINE_XBRL_NAMESPACES.has(qname.namespaceUri);
  })) return "inline_xbrl";
  if (nodes.some((node) => {
    const qname = resolveQName(node.name, namespaces);
    return qname.localName === "xbrl" && qname.namespaceUri === XBRL_INSTANCE_NAMESPACE;
  })) return "instance_xml";
  return null;
}

function collectNamespaces(parsed: unknown) {
  const namespaces: Record<string, string> = {};
  walkValues(parsed, (record) => {
    for (const [name, value] of Object.entries(record)) {
      if (name === "@xmlns" && typeof value === "string") namespaces[""] ??= value;
      else if (name.startsWith("@xmlns:") && typeof value === "string") namespaces[name.slice(7)] ??= value;
    }
  });
  return Object.fromEntries(Object.entries(namespaces).sort(([left], [right]) => left.localeCompare(right)));
}

function parsePeriod(node: unknown): SecXbrlPeriod | null {
  const record = asRecord(node);
  const instant = descendantText(record, "instant");
  const startDate = descendantText(record, "startDate");
  const endDate = descendantText(record, "endDate");
  if (validDate(instant) && !startDate && !endDate) return { kind: "instant", instant: instant! };
  if (!instant && validDate(startDate) && validDate(endDate) && startDate! <= endDate!) {
    return { kind: "duration", startDate: startDate!, endDate: endDate! };
  }
  return null;
}

function resolveQName(value: string, namespaces: Readonly<Record<string, string>>): SecXbrlQName {
  const split = value.indexOf(":");
  const prefix = split >= 0 ? value.slice(0, split) : null;
  const local = split >= 0 ? value.slice(split + 1) : value;
  return {
    qname: value,
    prefix,
    localName: local,
    namespaceUri: namespaces[prefix ?? ""] ?? null,
  };
}

function validateFilingIdentity(filing: SecFilingRow): { ok: true } | { ok: false; detail: string } {
  if (!CIK_PATTERN.test(filing.issuerCik) || filing.issuerCik === "0000000000") return { ok: false, detail: "invalid CIK" };
  if (!ACCESSION_PATTERN.test(filing.accessionNumber)) return { ok: false, detail: "invalid accession" };
  if (filing.sourceKind !== "submissions") return { ok: false, detail: "filing is not sourced from submissions" };
  if (filing.primaryDocument && !safeArchiveDocumentName(filing.primaryDocument)) return { ok: false, detail: "invalid primary document name" };
  return { ok: true };
}

function validateArtifact(artifact: SecFilingXbrlRawArtifact) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifact.id)) throw new Error("invalid artifact id");
  if (!CIK_PATTERN.test(artifact.issuerCik) || artifact.issuerCik === "0000000000") throw new Error("invalid artifact CIK");
  if (!ACCESSION_PATTERN.test(artifact.accession)) throw new Error("invalid artifact accession");
  if (!["archive_index", "filing_index", "primary_document", "inline_xbrl", "instance_xml"].includes(artifact.role)) throw new Error("invalid artifact role");
  if (!["authoritative_http_body", "injected_exact_body"].includes(artifact.rawContentKind)) throw new Error("invalid artifact content kind");
  if (!safeArchiveDocumentName(artifact.documentName)) throw new Error("invalid artifact document name");
  if (!HASH_PATTERN.test(artifact.contentHash) || artifact.contentHash !== sha256(artifact.rawContent)) throw new Error("artifact content hash mismatch");
  const url = new URL(artifact.sourceUrl);
  if (url.protocol !== "https:" || !/(^|\.)sec\.gov$/i.test(url.hostname)) throw new Error("invalid artifact SEC URL");
  if (artifact.sourceIdentity !== artifact.sourceUrl) throw new Error("artifact source identity must equal exact URL");
  if (Number.isNaN(new Date(artifact.fetchedAt).valueOf())) throw new Error("invalid artifact fetchedAt");
  const archive = buildSecArchiveFilingUrls(artifact.issuerCik, artifact.accession);
  if (!archive || !url.pathname.startsWith(new URL(archive.archiveDirectoryUrl).pathname + "/")) throw new Error("artifact accession URL mismatch");
}

export function createSecFilingXbrlFixtureArtifact(input: {
  issuerCik: string;
  accession: string;
  documentName: string;
  sourceUrl: string;
  role: SecFilingXbrlArtifactRole;
  rawContent: string;
  fetchedAt?: string;
}): SecFilingXbrlRawArtifact {
  const filing = {
    accessionNumber: input.accession,
    issuerCik: input.issuerCik,
  } as SecFilingRow;
  return createArtifact({
    filing,
    role: input.role,
    documentName: input.documentName,
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt ?? "2026-08-22T00:00:00.000Z",
    contentType: input.role === "archive_index" ? "application/json"
      : input.role === "instance_xml" ? "application/xml"
        : "text/html",
    rawContent: input.rawContent,
    rawContentKind: "injected_exact_body",
  });
}

function createArtifact(input: {
  filing: Pick<SecFilingRow, "issuerCik" | "accessionNumber">;
  role: SecFilingXbrlArtifactRole;
  documentName: string;
  sourceUrl: string;
  fetchedAt: string;
  contentType: string | null;
  rawContent: string;
  rawContentKind: SecFilingXbrlRawArtifact["rawContentKind"];
}): SecFilingXbrlRawArtifact {
  const contentHash = sha256(input.rawContent);
  const sourceIdentity = input.sourceUrl;
  const artifact: SecFilingXbrlRawArtifact = {
    id: deterministicUuid(`filing_xbrl:${sourceIdentity}:${contentHash}`),
    issuerCik: input.filing.issuerCik,
    accession: input.filing.accessionNumber,
    role: input.role,
    documentName: input.documentName,
    sourceUrl: input.sourceUrl,
    sourceIdentity,
    fetchedAt: new Date(input.fetchedAt).toISOString(),
    contentType: input.contentType,
    contentHash,
    rawContentKind: input.rawContentKind,
    rawContent: input.rawContent,
  };
  validateArtifact(artifact);
  return artifact;
}

function mapStoredArtifact(row: Record<string, unknown>): SecFilingXbrlRawArtifact {
  const payload = asRecord(row.payload);
  const role = stringValue(payload?.role) as SecFilingXbrlArtifactRole;
  const artifact: SecFilingXbrlRawArtifact = {
    id: requiredString(row.id, "stored artifact id missing"),
    issuerCik: requiredString(row.cik, "stored artifact CIK missing"),
    accession: requiredString(payload?.accession, "stored artifact accession missing"),
    role,
    documentName: requiredString(payload?.document_name, "stored artifact document name missing"),
    sourceUrl: requiredString(row.source_url, "stored artifact URL missing"),
    sourceIdentity: requiredString(row.source_identity, "stored artifact identity missing"),
    fetchedAt: new Date(requiredString(row.fetched_at, "stored artifact fetchedAt missing")).toISOString(),
    contentType: stringValue(payload?.content_type),
    contentHash: requiredString(row.content_hash, "stored artifact hash missing"),
    rawContentKind: requiredString(row.raw_content_kind, "stored artifact content kind missing") as SecFilingXbrlRawArtifact["rawContentKind"],
    rawContent: requiredString(row.raw_content, "stored artifact body missing"),
  };
  validateArtifact(artifact);
  return artifact;
}

function parseSecFilingAttachmentMetadata(
  filing: SecFilingRow,
  filingIndexBody: string,
): { status: "AVAILABLE"; byDocumentName: Map<string, SecFilingAttachmentMetadata> } | {
  status: "UNAVAILABLE";
  reason: SecFilingXbrlUnavailableReason;
  detail: string;
} {
  let document;
  try {
    document = parseDocument(filingIndexBody, { lowerCaseAttributeNames: true, lowerCaseTags: true });
  } catch {
    return unavailableParse("FILING_XBRL_PARSE_FAILED", "filing attachment index is not parseable HTML");
  }
  if (!compactText(DomUtils.textContent(document)).includes(filing.accessionNumber)) {
    return unavailableParse("ACCESSION_MISMATCH", "filing attachment index does not identify the requested accession");
  }
  const byDocumentName = new Map<string, SecFilingAttachmentMetadata>();
  const tables = DomUtils.getElementsByTagName("table", document.children);
  for (const table of tables) {
    const rows = DomUtils.getElementsByTagName("tr", table.children);
    for (const row of rows) {
      const cells = DomUtils.getElementsByTagName("td", row.children, false);
      if (cells.length < 4) continue;
      const links = DomUtils.getElementsByTagName("a", cells[2]!.children);
      const href = links[0]?.attribs.href ?? null;
      const documentName = filingDocumentNameFromHref(href, filing);
      if (!documentName) continue;
      const metadata: SecFilingAttachmentMetadata = {
        sequence: nullableCompactText(DomUtils.textContent(cells[0]!)),
        description: nullableCompactText(DomUtils.textContent(cells[1]!)),
        documentName,
        attachmentType: nullableCompactText(DomUtils.textContent(cells[3]!)),
        isInlineXbrl: htmlNodeContainsIxbrlSignal(cells[2]!),
      };
      const current = byDocumentName.get(documentName);
      if (current && stableJson(current) !== stableJson(metadata)) {
        return unavailableParse("PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS", `filing attachment metadata conflicts for ${documentName}`);
      }
      byDocumentName.set(documentName, current ?? metadata);
    }
  }
  return { status: "AVAILABLE", byDocumentName };
}

function filingDocumentNameFromHref(href: string | null, filing: SecFilingRow) {
  if (!href) return null;
  const urls = buildSecArchiveFilingUrls(filing.issuerCik, filing.accessionNumber);
  if (!urls) return null;
  let parsed: URL;
  try {
    parsed = new URL(href, urls.indexHtmlUrl);
  } catch {
    return null;
  }
  const target = parsed.searchParams.get("doc");
  const targetUrl = target ? new URL(target, "https://www.sec.gov") : parsed;
  const archivePath = new URL(urls.archiveDirectoryUrl).pathname + "/";
  if (targetUrl.protocol !== "https:" || !/(^|\.)sec\.gov$/i.test(targetUrl.hostname) || !targetUrl.pathname.startsWith(archivePath)) {
    return null;
  }
  const pathname = decodeURIComponent(targetUrl.pathname);
  const documentName = pathname.slice(pathname.lastIndexOf("/") + 1);
  return safeArchiveDocumentName(documentName) ? documentName : null;
}

function htmlNodeContainsIxbrlSignal(
  node: ReturnType<typeof DomUtils.getElementsByTagName>[number],
) {
  if (/(^|\s)iXBRL(\s|$)/i.test(DomUtils.textContent(node))) return true;
  const elements = DomUtils.findAll((element) =>
    Object.values(element.attribs).some((value) => /(^|\s)iXBRL(\s|$)/i.test(value)),
  node.children);
  return elements.length > 0;
}

function classifyIxdsDisposition(input: {
  isPrimary: boolean;
  isInlineXbrl: boolean | null;
  attachmentType: string | null;
}): SecFilingXbrlDiscoveredDocument["ixdsDisposition"] {
  if (input.isInlineXbrl !== true) return "not_inline";
  if (input.isPrimary) return "primary";
  const attachmentType = compactText(input.attachmentType ?? "").toUpperCase();
  if (!attachmentType) return "ambiguous";
  if (attachmentType === "EX-FILING FEES" || attachmentType === "EX-98" || attachmentType.startsWith("EX-98.")) {
    return "separate";
  }
  if (CONDITIONAL_SEPARATE_IXBRL_ATTACHMENT_TYPES.has(attachmentType)) return "ambiguous";
  return "primary";
}

const CONDITIONAL_SEPARATE_IXBRL_ATTACHMENT_TYPES = new Set([
  "EX-2.01",
  "EX-99.C.SBSEF",
  "EX-99.D.SBSEF",
  "EX-99.E.SBSEF",
  "EX-99.F.SBSEF",
  "EX-99.H.SBSEF",
  "EX-99.I.SBSEF",
  "EX-99.J.SBSEF",
  "EX-99.K.SBSEF",
  "EX-99.L.SBSEF",
  "EX-99.P.SBSEF",
  "EX-99.Q.SBSEF",
  "EX-99.R.SBSEF",
  "EX-99.S.SBSEF",
  "EX-99.4R HISTORIC",
]);

function isInstanceDocumentCandidate(name: string) {
  if (!/\.xml$/i.test(name)) return false;
  if (/^(?:FilingSummary|MetaLinks)\.xml$/i.test(name)) return false;
  if (/^R\d+\.xml$/i.test(name)) return false;
  if (/_(?:cal|def|lab|pre)\.xml$/i.test(name)) return false;
  return !/-index-headers\.xml$/i.test(name);
}

function safeArchiveDocumentName(name: string) {
  return Boolean(name && name.length <= 255 && !/[\\/]/.test(name) && name !== "." && name !== "..");
}

function isInlineXbrlDocument(rawContent: string) {
  return detectRawXbrlDocumentKind(rawContent) === "inline_xbrl";
}

function looksLikeXbrlInstance(rawContent: string) {
  return detectRawXbrlDocumentKind(rawContent) === "instance_xml";
}

function detectRawXbrlDocumentKind(rawContent: string) {
  if (XMLValidator.validate(rawContent, { allowBooleanAttributes: true }) !== true) return null;
  try {
    const parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@",
      trimValues: false,
      parseTagValue: false,
      parseAttributeValue: false,
      removeNSPrefix: false,
      processEntities: true,
      allowBooleanAttributes: true,
    }).parse(rawContent);
    const namespaces = collectNamespaces(parsed);
    return detectDocumentKind(parsed, namespaces);
  } catch {
    return null;
  }
}

function artifactSource(artifact: SecFilingXbrlRawArtifact) {
  return {
    issuerCik: artifact.issuerCik,
    accession: artifact.accession,
    documentName: artifact.documentName,
    sourceUrl: artifact.sourceUrl,
    contentHash: artifact.contentHash,
  };
}

function unavailableFetch(
  reason: SecFilingXbrlUnavailableReason,
  detail: string,
  artifacts: SecFilingXbrlRawArtifact[] = [],
): SecFilingXbrlFetchResult {
  return { status: "UNAVAILABLE", reason, detail, artifacts };
}

function unavailableCandidate(
  candidate: SecOsFilingContextCandidate,
  reason: SecFilingXbrlUnavailableReason,
  detail: string,
): SecOsCandidateFilingContextResult {
  return { status: "UNAVAILABLE", candidate, reason, detail };
}

function unavailableParse(reason: SecFilingXbrlUnavailableReason, detail: string) {
  return { status: "UNAVAILABLE" as const, reason, detail };
}

function collectNamedNodes(value: unknown, predicate: (name: string) => boolean) {
  const results: Array<{ name: string; value: unknown }> = [];
  walkNamedNodes(value, (name, child) => {
    if (predicate(name)) results.push({ name, value: child });
  });
  return results;
}

function walkNamedNodes(value: unknown, visit: (name: string, value: unknown) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walkNamedNodes(item, visit);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const [name, child] of Object.entries(record)) {
    if (name.startsWith("@") || name === "#text") continue;
    if (Array.isArray(child)) {
      for (const item of child) {
        visit(name, item);
        walkNamedNodes(item, visit);
      }
    } else {
      visit(name, child);
      walkNamedNodes(child, visit);
    }
  }
}

function walkValues(value: unknown, visit: (record: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walkValues(item, visit);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  visit(record);
  for (const child of Object.values(record)) walkValues(child, visit);
}

function firstDescendant(value: unknown, predicate: (name: string) => boolean): unknown {
  const nodes = collectNamedNodes(value, predicate);
  return nodes[0]?.value;
}

function descendantText(value: unknown, wantedLocalName: string) {
  return nullableCompactText(readNodeText(firstDescendant(value, (name) => localName(name) === wantedLocalName)));
}

function readNodeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(readNodeText).join("");
  const record = asRecord(value);
  if (!record) return "";
  return Object.entries(record)
    .filter(([name]) => !name.startsWith("@"))
    .map(([, child]) => readNodeText(child))
    .join("");
}

function stripAttributes(record: Record<string, unknown> | null): unknown {
  if (!record) return null;
  return Object.fromEntries(Object.entries(record).filter(([name]) => !name.startsWith("@")));
}

function attribute(record: Record<string, unknown> | null, name: string) {
  if (!record) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith("@")) continue;
    const local = key.slice(1).toLowerCase();
    if (local === wanted || local.endsWith(`:${wanted}`)) return stringValue(value);
  }
  return null;
}

function localName(name: string) {
  const split = name.indexOf(":");
  return split >= 0 ? name.slice(split + 1) : name;
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function nullableCompactText(value: string) {
  const compact = compactText(value);
  return compact || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredString(value: unknown, message: string) {
  const result = stringValue(value);
  if (!result) throw new Error(message);
  return result;
}

function numericSize(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicUuid(value: string) {
  const bytes = Buffer.from(sha256(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function artifactIdentity(artifact: SecFilingXbrlRawArtifact) {
  return `${artifact.sourceIdentity}:${artifact.contentHash}`;
}

function dimensionIdentity(dimension: SecXbrlDimension) {
  return stableJson(dimension);
}

function dedupeBy<T>(items: readonly T[], identity: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = identity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compareArtifacts(left: SecFilingXbrlRawArtifact, right: SecFilingXbrlRawArtifact) {
  return left.sourceUrl.localeCompare(right.sourceUrl) || left.contentHash.localeCompare(right.contentHash);
}

function compareDiscoveredDocuments(
  left: SecFilingXbrlDiscoveredDocument,
  right: SecFilingXbrlDiscoveredDocument,
) {
  return (left.sequence ?? "").localeCompare(right.sequence ?? "", undefined, { numeric: true })
    || left.documentName.localeCompare(right.documentName);
}

function compareDimensions(left: SecXbrlDimension, right: SecXbrlDimension) {
  return dimensionIdentity(left).localeCompare(dimensionIdentity(right));
}

function compareFacts(left: SecFilingXbrlFact, right: SecFilingXbrlFact) {
  return left.concept.qname.localeCompare(right.concept.qname)
    || left.contextRef.localeCompare(right.contextRef)
    || left.factKey.localeCompare(right.factKey);
}
