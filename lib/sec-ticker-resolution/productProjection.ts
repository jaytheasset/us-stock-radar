import "server-only";

import {
  readEffectiveSecTickerResolutionByDecisionId,
  type SecTickerEffectiveReadResult,
  type SecTickerHumanReviewRepository,
} from "./humanReview.ts";
import type {
  SecTickerProductProjection,
  SecTickerProductProjectionReadResult,
  SecTickerSourceFiling,
} from "./productProjectionTypes.ts";

type Row = Record<string, unknown>;
type EffectiveAvailable = Extract<SecTickerEffectiveReadResult, { status: "available" }>;

type VerifiedEdge = Readonly<{
  afterAcceptedAt: string;
  beforeAcceptedAt: string;
  decisionId: string;
  effectiveDate: string;
  issuerCik: string;
  newTicker: string;
  oldTicker: string;
  securitySignature: string;
  sourceFilings: readonly SourceFilingEvidence[];
}>;

type SourceFilingEvidence = Readonly<{
  accessionNumber: string;
  acceptedAt: string;
  exchange: string;
  historicalTicker: string;
  issuerCik: string;
  resultId: string;
  sourceDocument: string;
  sourceSha256: string;
  sourceUrl: string;
  securityTitle: string;
}>;

type ProjectionComponent = Readonly<{
  currentTicker: string;
  edges: readonly VerifiedEdge[];
  historicalTickers: readonly string[];
  issuerCik: string;
}>;

const DECISION_LIMIT = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

export async function readSecTickerProductProjectionForTicker(input: {
  ticker: string;
  now?: Date;
  repository?: SecTickerHumanReviewRepository;
}): Promise<SecTickerProductProjectionReadResult> {
  const ticker = normalizeTicker(input.ticker);
  if (!ticker) return { status: "not_found" };
  const repository = input.repository ?? await defaultRepository();
  const decisionRead = await repository.select("sec_ticker_resolution_decisions", {
    select: "id",
    order: "created_at.asc,id.asc",
    limit: String(DECISION_LIMIT),
  });
  if (!decisionRead.ok) {
    return { status: "unavailable", reason: "projection_decision_read_failed" };
  }
  const decisionRows = rows(decisionRead.data);
  if (decisionRows.length >= DECISION_LIMIT) {
    return { status: "unavailable", reason: "projection_decision_scope_truncated" };
  }

  const effectiveReads: EffectiveAvailable[] = [];
  for (let offset = 0; offset < decisionRows.length; offset += 5) {
    const batch = decisionRows.slice(offset, offset + 5);
    const reads = await Promise.all(batch.map((row) => {
      const decisionId = stringValue(row.id);
      return UUID_PATTERN.test(decisionId)
        ? readEffectiveSecTickerResolutionByDecisionId({ decisionId, repository })
        : Promise.resolve({ status: "unavailable", reason: "invalid_decision_id" } as const);
    }));
    if (reads.some((read) => read.status !== "available")) {
      return { status: "unavailable", reason: "projection_effective_read_incomplete" };
    }
    effectiveReads.push(...reads as EffectiveAvailable[]);
  }

  const built = buildSecTickerProjectionComponents(effectiveReads, input.now ?? new Date());
  if (!built.ok) return { status: "unavailable", reason: built.reason };
  const component = built.components.find((item) =>
    item.currentTicker === ticker || item.historicalTickers.includes(ticker));
  if (!component) return { status: "not_found" };

  const sourceFilings = await hydrateSourceFilings(
    component.edges,
    component.currentTicker,
    repository,
  );
  if (!sourceFilings) {
    return { status: "unavailable", reason: "projection_source_filing_read_failed" };
  }
  return {
    status: "available",
    currentTicker: component.currentTicker,
    historicalTickers: component.historicalTickers,
    issuerCik: component.issuerCik,
    sourceFilings,
  };
}

export async function readSecTickerSourceFiling(input: {
  decisionId: string;
  side: "before" | "after";
  now?: Date;
  repository?: SecTickerHumanReviewRepository;
}): Promise<SecTickerSourceFiling | null> {
  if (!UUID_PATTERN.test(input.decisionId)) return null;
  const repository = input.repository ?? await defaultRepository();
  const effective = await readEffectiveSecTickerResolutionByDecisionId({
    decisionId: input.decisionId,
    repository,
  });
  const edge = effective.status === "available"
    ? edgeFromEffective(effective, input.now ?? new Date())
    : null;
  if (!edge) return null;
  const projection = await readSecTickerProductProjectionForTicker({
    ticker: edge.newTicker,
    now: input.now,
    repository,
  });
  if (projection.status !== "available") return null;
  const expectedHref = sourceFilingHref(edge.decisionId, input.side);
  return projection.sourceFilings.find((filing) => filing.detailHref === expectedHref) ?? null;
}

export function buildSecTickerProjectionComponents(
  reads: readonly SecTickerEffectiveReadResult[],
  now: Date,
):
  | Readonly<{ ok: true; components: readonly ProjectionComponent[] }>
  | Readonly<{ ok: false; reason: string }> {
  if (reads.some((read) => read.status !== "available")) {
    return { ok: false, reason: "projection_effective_read_incomplete" };
  }
  const currentByDecision = new Map<string, EffectiveAvailable>();
  for (const read of reads) {
    if (read.status !== "available") continue;
    if (!currentByDecision.has(read.currentAutomaticDecisionId)) {
      currentByDecision.set(read.currentAutomaticDecisionId, read);
    }
  }
  const edges = [...currentByDecision.values()]
    .map((read) => edgeFromEffective(read, now))
    .filter((edge): edge is VerifiedEdge => Boolean(edge));

  const signaturesBySymbol = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const ticker of [edge.oldTicker, edge.newTicker]) {
      const signatures = signaturesBySymbol.get(ticker) ?? new Set<string>();
      signatures.add(edge.securitySignature);
      signaturesBySymbol.set(ticker, signatures);
    }
  }
  const conflictedSymbols = new Set(
    [...signaturesBySymbol.entries()]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([ticker]) => ticker),
  );
  const conflictedSignatures = new Set(
    edges
      .filter((edge) =>
        conflictedSymbols.has(edge.oldTicker) || conflictedSymbols.has(edge.newTicker))
      .map((edge) => edge.securitySignature),
  );
  const safeEdges = edges.filter((edge) => !conflictedSignatures.has(edge.securitySignature));

  const groups = new Map<string, VerifiedEdge[]>();
  for (const edge of safeEdges) {
    const current = groups.get(edge.securitySignature) ?? [];
    current.push(edge);
    groups.set(edge.securitySignature, current);
  }

  const components: ProjectionComponent[] = [];
  for (const groupEdges of groups.values()) {
    const outgoing = new Map<string, VerifiedEdge[]>();
    const incoming = new Map<string, VerifiedEdge[]>();
    for (const edge of groupEdges) {
      outgoing.set(edge.oldTicker, [...(outgoing.get(edge.oldTicker) ?? []), edge]);
      incoming.set(edge.newTicker, [...(incoming.get(edge.newTicker) ?? []), edge]);
    }
    const hasBranch =
      [...outgoing.values()].some((values) => values.length !== 1) ||
      [...incoming.values()].some((values) => values.length !== 1);
    if (hasBranch) continue;
    const unvisited = new Set(groupEdges);

    while (unvisited.size) {
      const seed = unvisited.values().next().value as VerifiedEdge;
      const connected = collectConnectedEdges(seed, unvisited, outgoing, incoming);
      if (!connected.length) continue;
      const starts = connected.filter((edge) =>
        !connected.some((candidate) => candidate.newTicker === edge.oldTicker));
      if (starts.length !== 1) continue;
      const ordered: VerifiedEdge[] = [];
      const visitedTickers = new Set<string>([starts[0]!.oldTicker]);
      let edge: VerifiedEdge | undefined = starts[0];
      while (edge) {
        if (visitedTickers.has(edge.newTicker)) {
          ordered.length = 0;
          break;
        }
        visitedTickers.add(edge.newTicker);
        ordered.push(edge);
        const next = connected.find((candidate) => candidate.oldTicker === edge?.newTicker);
        if (
          next && (
            next.effectiveDate <= edge.effectiveDate ||
            Date.parse(next.beforeAcceptedAt) < Date.parse(edge.afterAcceptedAt)
          )
        ) {
          ordered.length = 0;
          break;
        }
        edge = next;
      }
      if (!ordered.length || ordered.length !== connected.length) continue;
      components.push({
        currentTicker: ordered.at(-1)!.newTicker,
        historicalTickers: ordered.map((item) => item.oldTicker),
        issuerCik: ordered[0]!.issuerCik,
        edges: ordered,
      });
    }
  }
  return { ok: true, components };
}

function edgeFromEffective(read: EffectiveAvailable, now: Date): VerifiedEdge | null {
  if (read.effective.disposition !== "automatic" && read.effective.disposition !== "approved") return null;
  if (read.effective.reconsiderationRequired || read.automatic.status !== "available") return null;
  const automatic = read.automatic.result;
  const automaticState = stringValue(automatic.decision.resolution_state);
  if (read.effective.disposition === "automatic" && automaticState !== "AUTO") return null;

  const relationship = record(read.effective.relationship);
  const identity = record(automatic.identity);
  const evidence = record(automatic.evidence);
  const identityPayload = record(identity.identity_payload);
  const beforeIdentity = record(identityPayload.before);
  const afterIdentity = record(identityPayload.after);
  const issuerCik = stringValue(automatic.decision.issuer_cik);
  const decisionId = read.currentAutomaticDecisionId;
  const oldTicker = normalizeTicker(relationship.oldTicker);
  const newTicker = normalizeTicker(relationship.newTicker);
  const effectiveDate = stringValue(relationship.effectiveDate);
  const today = now.toISOString().slice(0, 10);
  if (
    !UUID_PATTERN.test(decisionId) || !/^\d{10}$/.test(issuerCik) ||
    !oldTicker || !newTicker || oldTicker === newTicker ||
    !DATE_PATTERN.test(effectiveDate) || effectiveDate > today ||
    stringValue(identity.id) !== stringValue(relationship.identityId) ||
    stringValue(evidence.id) !== stringValue(relationship.evidenceId) ||
    stringValue(identity.issuer_cik) !== issuerCik ||
    stringValue(evidence.issuer_cik) !== issuerCik ||
    normalizeTicker(beforeIdentity.tradingSymbol) !== oldTicker ||
    normalizeTicker(afterIdentity.tradingSymbol) !== newTicker
  ) return null;

  const beforeObservation = selectIdentityObservation(
    automatic.sourceObservations.before,
    beforeIdentity,
  );
  const afterObservation = selectIdentityObservation(
    automatic.sourceObservations.after,
    afterIdentity,
  );
  if (!beforeObservation || !afterObservation) return null;
  const beforeAcceptedAt = stringValue(beforeObservation.acceptedAt);
  const afterAcceptedAt = stringValue(afterObservation.acceptedAt);
  if (
    !validTimestamp(beforeAcceptedAt) || !validTimestamp(afterAcceptedAt) ||
    Date.parse(beforeAcceptedAt) >= Date.parse(afterAcceptedAt) ||
    (read.effective.disposition === "automatic" && (
      beforeAcceptedAt.slice(0, 10) > effectiveDate ||
      effectiveDate > afterAcceptedAt.slice(0, 10)
    ))
  ) return null;

  const beforeTitle = normalizeSecurityText(identity.before_security_title);
  const afterTitle = normalizeSecurityText(identity.after_security_title);
  const beforeExchange = normalizeExchange(beforeObservation.exchange);
  const afterExchange = normalizeExchange(afterObservation.exchange);
  const beforeDimensions = stableStringify(arrayValue(beforeIdentity.dimensions));
  const afterDimensions = stableStringify(arrayValue(afterIdentity.dimensions));
  if (
    !beforeTitle || beforeTitle !== afterTitle ||
    !beforeExchange || beforeExchange !== afterExchange ||
    beforeDimensions !== afterDimensions
  ) return null;
  const securityType = stringValue(identity.security_type);
  if (!securityType) return null;
  const securitySignature = stableStringify({
    dimensions: beforeDimensions,
    exchange: beforeExchange,
    issuerCik,
    securityClass: normalizeSecurityText(identity.security_class),
    securityTitle: beforeTitle,
    securityType,
  });
  const sourceFilings = [
    sourceFilingFromObservation(beforeObservation, oldTicker, issuerCik),
    sourceFilingFromObservation(afterObservation, newTicker, issuerCik),
  ];
  if (sourceFilings.some((filing) => !filing)) return null;
  return {
    afterAcceptedAt,
    beforeAcceptedAt,
    decisionId,
    effectiveDate,
    issuerCik,
    newTicker,
    oldTicker,
    securitySignature,
    sourceFilings: sourceFilings as readonly SourceFilingEvidence[],
  };
}

function selectIdentityObservation(
  observations: readonly Row[],
  identitySide: Row,
) {
  const resultId = stringValue(identitySide.resultId);
  const observationKey = stringValue(identitySide.observationKey);
  const matches = observations.filter((observation) =>
    stringValue(observation.resultId) === resultId &&
    stringValue(observation.observationKey) === observationKey);
  return matches.length === 1 ? matches[0]! : null;
}

function sourceFilingFromObservation(
  observation: Row,
  historicalTicker: string,
  issuerCik: string,
): SourceFilingEvidence | null {
  const accessionNumber = stringValue(observation.accessionNumber);
  const acceptedAt = stringValue(observation.acceptedAt);
  const resultId = stringValue(observation.resultId);
  const sourceDocument = stringValue(observation.sourceDocument);
  const sourceSha256 = stringValue(observation.sourceSha256);
  const sourceUrl = stringValue(observation.sourceUrl);
  const exchange = stringValue(observation.exchange);
  const securityTitle = stringValue(observation.securityTitle);
  if (
    !ACCESSION_PATTERN.test(accessionNumber) || !validTimestamp(acceptedAt) ||
    !UUID_PATTERN.test(resultId) || !sourceDocument ||
    !/^[0-9a-f]{64}$/.test(sourceSha256) || !isOfficialSecArchiveUrl(sourceUrl) ||
    normalizeTicker(observation.tradingSymbol) !== historicalTicker ||
    stringValue(observation.issuerCik) !== issuerCik || !securityTitle
  ) return null;
  return {
    accessionNumber,
    acceptedAt,
    exchange,
    historicalTicker,
    issuerCik,
    resultId,
    sourceDocument,
    sourceSha256,
    sourceUrl,
    securityTitle,
  };
}

async function hydrateSourceFilings(
  edges: readonly VerifiedEdge[],
  currentTicker: string,
  repository: SecTickerHumanReviewRepository,
): Promise<SecTickerSourceFiling[] | null> {
  const evidenceByKey = new Map<string, SourceFilingEvidence & { detailHref: string }>();
  for (const edge of edges) {
    edge.sourceFilings.forEach((filing, index) => {
      const key = `${filing.accessionNumber}:${filing.historicalTicker}`;
      if (evidenceByKey.has(key)) return;
      evidenceByKey.set(key, {
        ...filing,
        detailHref: sourceFilingHref(edge.decisionId, index === 0 ? "before" : "after"),
      });
    });
  }
  const evidence = [...evidenceByKey.values()];
  if (!evidence.length) return [];
  const result = await repository.select("sec_cover_observation_results", {
    select: "id,accession_number,form_type_raw,filing_date_raw,accepted_at,source_url,source_document,source_sha256",
    id: `in.(${evidence.map((filing) => filing.resultId).join(",")})`,
    limit: String(evidence.length),
  });
  if (!result.ok) return null;
  const rowsById = new Map(rows(result.data).map((row) => [stringValue(row.id), row] as const));
  const hydrated = evidence.flatMap((filing) => {
    const row = rowsById.get(filing.resultId);
    const filedDate = stringValue(row?.filing_date_raw);
    const formType = stringValue(row?.form_type_raw);
    if (
      !row || stringValue(row.accession_number) !== filing.accessionNumber ||
      stringValue(row.source_url) !== filing.sourceUrl ||
      stringValue(row.source_document) !== filing.sourceDocument ||
      stringValue(row.source_sha256) !== filing.sourceSha256 ||
      !sameTimestamp(stringValue(row.accepted_at), filing.acceptedAt) ||
      !DATE_PATTERN.test(filedDate) || !formType
    ) return [];
    return [{
      accessionNumber: filing.accessionNumber,
      acceptedAt: filing.acceptedAt,
      currentTicker,
      detailHref: filing.detailHref,
      exchange: filing.exchange,
      filedDate,
      formType,
      historicalTicker: filing.historicalTicker,
      issuerCik: filing.issuerCik,
      securityTitle: filing.securityTitle,
      sourceDocument: filing.sourceDocument,
      sourceUrl: filing.sourceUrl,
    }];
  });
  return hydrated.length === evidence.length
    ? hydrated.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))
    : null;
}

function collectConnectedEdges(
  seed: VerifiedEdge,
  unvisited: Set<VerifiedEdge>,
  outgoing: ReadonlyMap<string, readonly VerifiedEdge[]>,
  incoming: ReadonlyMap<string, readonly VerifiedEdge[]>,
) {
  const collected: VerifiedEdge[] = [];
  const queue = [seed];
  while (queue.length) {
    const edge = queue.shift()!;
    if (!unvisited.delete(edge)) continue;
    collected.push(edge);
    const adjacent = [
      ...(outgoing.get(edge.newTicker) ?? []),
      ...(incoming.get(edge.oldTicker) ?? []),
    ];
    queue.push(...adjacent.filter((candidate) => unvisited.has(candidate)));
  }
  return collected;
}

function sourceFilingHref(decisionId: string, side: "before" | "after") {
  return `/filings/source/${encodeURIComponent(decisionId)}/${side}`;
}

function isOfficialSecArchiveUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov")) &&
      url.pathname.startsWith("/Archives/edgar/data/");
  } catch {
    return false;
  }
}

function validTimestamp(value: string) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function sameTimestamp(left: string, right: string) {
  return validTimestamp(left) && validTimestamp(right) && Date.parse(left) === Date.parse(right);
}

function normalizeTicker(value: unknown) {
  const ticker = stringValue(value).toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : "";
}

function normalizeSecurityText(value: unknown) {
  return stringValue(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizeExchange(value: unknown) {
  const normalized = stringValue(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("nasdaq")) return "nasdaq";
  if (normalized.includes("newyorkstockexchange") || normalized === "nyse") return "nyse";
  if (normalized.includes("nyseamerican") || normalized.includes("americanstockexchange")) return "nyse-american";
  return normalized;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function defaultRepository(): Promise<SecTickerHumanReviewRepository> {
  const supabase = await import("../supabase.ts");
  return { rpc: supabase.supabaseRpc, select: supabase.supabaseSelect };
}
