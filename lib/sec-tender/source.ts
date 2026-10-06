import { createHash } from "node:crypto";
import { prepareTenderEvidence } from "../sources/sec/forms/tender/evidencePreparation.ts";
import { buildTenderEvidenceIndex } from "../sources/sec/forms/tender/evidenceRetrieval.ts";
import { TENDER_EVIDENCE_FORMS } from "../sources/sec/forms/tender/evidenceSource.ts";
import type { SecTenderParseInput } from "../sources/sec/forms/tender/types.ts";

export const TENDER_STRUCTURED_VERSION = "tender_structured_v1";
export const TENDER_STRUCTURED_PURPOSE = "sec_tender_structured";
export const TENDER_STRUCTURED_MODEL = "gemini-3.5-flash";
export const TENDER_STRUCTURED_QUERIES = Object.freeze([
  "What are the current and previous fixed cash per share tender consideration and currency?",
  "What is the subject company's board recommendation to shareholders on this tender and any prior recommendation?",
  "Does this filing report an actual tender withdrawal or termination, or actual final tender results rather than preliminary or interim results?",
] as const);

export type TenderStructuredEvidence = Readonly<{
  ref: string;
  evidenceId: string;
  text: string;
  textHash: string;
  sourceHash: string;
  renderedHash: string;
  accession: string;
  form: string;
  document: Readonly<{
    accession: string;
    form: string;
    documentId: string;
    url: string;
    role: "primary" | "attachment";
    format: "html" | "text";
    completeness: "complete" | "excerpt" | "truncated";
  }>;
  location: Readonly<{
    representation: "tender-render-v1" | "prepared-text-v1";
    start: number;
    end: number;
    heading: string | null;
    offsets: "UTF-16-half-open";
  }>;
}>;

export type TenderStructuredSource = Readonly<{
  accession: string;
  form: string;
  coverage: Readonly<{
    unavailable: readonly Readonly<{ documentId: string; reason: string }>[];
    partialDocuments: readonly string[];
    externalReferences: string;
    selection: "deterministic-tender-evidence-v1";
  }>;
  evidence: readonly TenderStructuredEvidence[];
}>;

export type TenderProviderSource = Readonly<{
  accession: string;
  form: string;
  coverage: TenderStructuredSource["coverage"];
  evidence: readonly Readonly<{ ref: string; text: string }>[];
}>;

export type TenderEvidenceMap = Readonly<Record<string, Readonly<{
  evidenceId: string;
  textHash: string;
  accession: string;
  form: string;
  document: TenderStructuredEvidence["document"];
  location: TenderStructuredEvidence["location"];
}>>>;

type Row = Record<string, unknown>;
export const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export const text = (value: unknown) => typeof value === "string" ? value : "";
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function isTenderStructuredForm(value: unknown) {
  return (TENDER_EVIDENCE_FORMS as readonly string[]).includes(text(value).trim().toUpperCase());
}


function rawToTenderInput(raw: Row): SecTenderParseInput {
  return {
    rawItemId: text(raw.id),
    sourceUniqueId: text(raw.source_unique_id),
    sourceUrl: text(raw.source_url),
    title: text(raw.title),
    publishedAt: text(raw.published_at),
    bodyText: text(raw.body_text),
    analysisText: null,
    rawPayload: record(raw.raw_payload),
    metadata: record(raw.metadata),
  };
}

type SearchHit = ReturnType<ReturnType<typeof buildTenderEvidenceIndex>["search_evidence"]>["hits"][number];

export function dedupeTenderHits(hits: readonly SearchHit[]) {
  const unique = [...new Map(hits.map((hit) => [hit.id, hit])).values()];
  return unique.filter((hit, index) => !unique.some((other, otherIndex) => (
    index !== otherIndex
    && hit.accession === other.accession
    && hit.document.documentId === other.document.documentId
    && hit.sourceHash === other.sourceHash
    && hit.renderedHash === other.renderedHash
    && hit.location.representation === other.location.representation
    && other.location.start <= hit.location.start
    && other.location.end >= hit.location.end
    && (other.chars > hit.chars || otherIndex < index)
  )));
}

export function buildTenderStructuredSource(raw: Row): {
  source: TenderStructuredSource;
  providerSource: TenderProviderSource;
  evidenceMap: TenderEvidenceMap;
} {
  if (raw.source_code !== "sec_edgar") throw new Error("tender_source_code_invalid");
  const payload = record(raw.raw_payload);
  const accession = text(payload.accession_number);
  const form = text(payload.form_type).trim().toUpperCase();
  if (raw.source_unique_id !== accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || !isTenderStructuredForm(form)) {
    throw new Error("tender_source_identity_invalid");
  }

  const packet = prepareTenderEvidence(rawToTenderInput(raw));
  if (packet.accession !== accession || packet.form.trim().toUpperCase() !== form) throw new Error("tender_packet_identity_invalid");
  if (packet.unavailable.length || packet.documents.some(d => d.completeness !== "complete")) throw new Error("tender_source_coverage_incomplete");
  const index = buildTenderEvidenceIndex(packet);
  const searches = TENDER_STRUCTURED_QUERIES.map((question) => index.search_evidence({
    accession,
    question,
    limit: 6,
  }));
  const selected = dedupeTenderHits(searches.flatMap((result) => result.hits));
  if (!selected.length) throw new Error("tender_structured_evidence_missing");

  const read = index.read_evidence({ accession, ids: selected.map((hit) => hit.id), maxChars: 200_000 });
  if (read.status !== "read") throw new Error("tender_structured_evidence_budget");
  const evidence: TenderStructuredEvidence[] = read.evidence.map((item, indexValue) => {
    if (item.accession !== accession || item.form.trim().toUpperCase() !== form) throw new Error("tender_cross_filing_evidence");
    if (item.document.completeness !== "complete") throw new Error("tender_selected_source_partial");
    return {
      ref: `E${indexValue + 1}`,
      evidenceId: item.id,
      text: item.text,
      textHash: item.textHash,
      sourceHash: item.sourceHash,
      renderedHash: item.renderedHash,
      accession: item.accession,
      form: item.form,
      document: structuredClone(item.document),
      location: structuredClone(item.location),
    };
  });
  const coverage = {
    unavailable: structuredClone(read.unavailable),
    partialDocuments: [...read.partialDocuments],
    externalReferences: read.externalReferences,
    selection: "deterministic-tender-evidence-v1" as const,
  };
  const source: TenderStructuredSource = { accession, form, coverage, evidence };
  const providerSource: TenderProviderSource = {
    accession,
    form,
    coverage,
    evidence: evidence.map(({ ref, text: evidenceText }) => ({ ref, text: evidenceText })),
  };
  const evidenceMap = Object.fromEntries(evidence.map((item) => [item.ref, {
    evidenceId: item.evidenceId,
    textHash: item.textHash,
    sourceHash: item.sourceHash,
    renderedHash: item.renderedHash,
    accession: item.accession,
    form: item.form,
    document: structuredClone(item.document),
    location: structuredClone(item.location),
  }])) as TenderEvidenceMap;
  return { source, providerSource, evidenceMap };
}

export function buildTenderBinding(raw: Row) {
  const rawItemId = text(raw.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawItemId)) throw new Error("tender_invalid_raw_item_id");
  const payload = record(raw.raw_payload);
  const built = buildTenderStructuredSource(raw);
  const filedAt = text(payload.accepted_at) || text(raw.published_at) || text(payload.filing_date);
  if (!Number.isFinite(Date.parse(filedAt))) throw new Error("tender_filed_at_invalid");
  const sourceFingerprint = hash(stable({
    version: TENDER_STRUCTURED_VERSION,
    packet: prepareTenderEvidence(rawToTenderInput(raw)),
    source: built.source,
    evidenceMap: built.evidenceMap,
  }));
  const binding = {
    rawItemId,
    accession: built.source.accession,
    formType: built.source.form,
    filedAt,
    contractVersion: TENDER_STRUCTURED_VERSION,
    sourceFingerprint,
    source: built.source,
    providerSource: built.providerSource,
    evidenceMap: built.evidenceMap,
  };
  const executionHash = hash(stable([
    TENDER_STRUCTURED_PURPOSE,
    rawItemId,
    built.source.accession,
  ]));
  const executionId = `${executionHash.slice(0, 8)}-${executionHash.slice(8, 12)}-5${executionHash.slice(13, 16)}-a${executionHash.slice(17, 20)}-${executionHash.slice(20, 32)}`;
  return { binding, executionId, ...built };
}
