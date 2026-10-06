import { normalizeCik, normalizeSecStructuredDocuments } from "./normalization.ts";
import type { SecStructuredSourceDocument } from "./types.ts";

export function normalizeMainSubmissions(documents: readonly SecStructuredSourceDocument[], cik: string, ingestedAt: string) {
  if (documents.length !== 1) throw new Error("expected_one_main_submissions_document");
  validateMainSubmissions(documents[0], cik);
  const normalized = normalizeSecStructuredDocuments(documents, ingestedAt);
  if (normalized.rejections.length || normalized.rawSources.length !== 1 ||
      normalized.issuerObservations.length !== 1 || normalized.facts.length !== 0) {
    throw new Error(`invalid_main_submissions: ${normalized.rejections.map((item) => item.reason).join(",") || "not_accepted"}`);
  }
  return normalized;
}

function validateMainSubmissions(document: SecStructuredSourceDocument, cik: string) {
  const mainUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  if (document.sourceKind !== "submissions" || normalizeCik(document.cik) !== cik ||
      document.sourceUrl !== mainUrl || document.sourceIdentity !== mainUrl) {
    throw new Error("main_submissions_identity_mismatch");
  }
  if (typeof document.rawBody !== "string" || !document.rawBody.trim()) {
    throw new Error("missing_main_submissions_body");
  }
  const payload = sourceRecord(document.payload);
  if (!payload || normalizeCik(payload.cik) !== cik) throw new Error("main_submissions_cik_mismatch");
  const recent = sourceRecord(sourceRecord(payload.filings)?.recent);
  if (typeof payload.name !== "string" || !payload.name.trim() ||
      !Array.isArray(payload.tickers) || !Array.isArray(payload.exchanges) || !recent ||
      !Array.isArray(recent.accessionNumber)) {
    throw new Error("invalid_main_submissions_structure");
  }
  // Require complete parallel ledger arrays; never truncate or infer missing entries.
  for (const field of ["form", "filingDate"]) {
    if (!Array.isArray(recent[field]) || recent[field].length !== recent.accessionNumber.length) {
      throw new Error("invalid_main_submissions_filing_arrays");
    }
  }
  for (const value of Object.values(recent)) {
    if (!Array.isArray(value) || value.length !== recent.accessionNumber.length) {
      throw new Error("invalid_main_submissions_filing_arrays");
    }
  }
}

function sourceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
