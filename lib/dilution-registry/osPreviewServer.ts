import "server-only";

import { getServerEnv } from "@/lib/env";
import { SecRequestPolicy } from "@/lib/sec-structured-data/secRequestPolicy";
import { supabaseSelect } from "@/lib/supabase";
import type {
  DilutionRegistryOsSourceBundle,
} from "./osPreview.ts";
import {
  fetchOfficialSecFilingDocument,
  normalizeSecDocumentText,
} from "./osPreviewSecFallback.ts";

const LEDGER_SELECT = [
  "issuer_cik",
  "accession_number",
  "form",
  "primary_document",
].join(",");

const SOURCE_SELECT = [
  "source_url",
  "payload",
  "raw_content",
].join(",");

const UNIVERSE_SELECT = [
  "issuer_cik",
  "source_accession",
  "source_form",
  "universe_as_of",
  "source_documents",
  "status",
  "reason",
  "required_canonical_security_class_ids",
  "class_evidence",
].join(",");

export async function readDilutionRegistryOsSourceBundle(
  accessionNumber: string,
  context: {
    issuerCik: string;
    asOf: string;
    sourceForm: string;
    sourceRef: string;
  },
): Promise<DilutionRegistryOsSourceBundle> {
  const ledgerResult = await supabaseSelect("sec_filing_ledger", {
    accession_number: `eq.${accessionNumber}`,
    limit: "2",
    select: LEDGER_SELECT,
  });
  if (!ledgerResult.ok) {
    return unavailableBundle("The local SEC filing-ledger lookup failed; network fallback was not attempted.");
  }

  const ledgerRows = records(ledgerResult.data);
  if (ledgerRows.length !== 1) {
    return {
      ok: true,
      sourceMode: null,
      classUniverseMode: null,
      ledger: null,
      documents: [],
      classUniverse: null,
    };
  }
  const ledger = readLedger(ledgerRows[0]);
  if (!ledger) {
    return {
      ok: true,
      sourceMode: null,
      classUniverseMode: null,
      ledger: null,
      documents: [],
      classUniverse: null,
    };
  }
  if (
    ledger.issuer_cik !== context.issuerCik ||
    ledger.accession_number !== accessionNumber ||
    ledger.form !== context.sourceForm
  ) {
    return {
      ok: true,
      sourceMode: null,
      classUniverseMode: null,
      ledger,
      documents: [],
      classUniverse: null,
    };
  }

  const [sourceResult, exactUniverseResult, referenceUniverseResult] = await Promise.all([
    supabaseSelect("sec_structured_raw_sources", {
      cik: `eq.${ledger.issuer_cik}`,
      limit: "100",
      order: "fetched_at.desc",
      "payload->>accession": `eq.${accessionNumber}`,
      select: SOURCE_SELECT,
      source_kind: "eq.filing_xbrl",
    }),
    supabaseSelect("issuer_common_class_universe_snapshots", {
      issuer_cik: `eq.${ledger.issuer_cik}`,
      limit: "2",
      order: "accepted_at.desc,source_identity_hash.desc",
      select: UNIVERSE_SELECT,
      source_accession: `eq.${accessionNumber}`,
    }),
    supabaseSelect("issuer_common_class_universe_snapshots", {
      issuer_cik: `eq.${ledger.issuer_cik}`,
      limit: "10",
      order: "universe_as_of.desc,accepted_at.desc,source_identity_hash.desc",
      select: UNIVERSE_SELECT,
      universe_as_of: `lte.${context.asOf}`,
    }),
  ]);
  if (!sourceResult.ok || !exactUniverseResult.ok || !referenceUniverseResult.ok) {
    return unavailableBundle("A local SEC source or class-universe lookup failed; network fallback was not attempted.", ledger);
  }

  const sourceRows = records(sourceResult.data);
  const documents = sourceRows.flatMap((value) => {
    const document = readDocument(value);
    return document ? [document] : [];
  });
  const exactUniverseRows = records(exactUniverseResult.data);
  const referenceUniverseRows = records(referenceUniverseResult.data);
  const exactUniverse = exactUniverseRows.length === 1
    ? readClassUniverse(exactUniverseRows[0])
    : null;
  const referenceUniverse = exactUniverse ?? readReferenceUniverse(referenceUniverseRows);
  const exactLocalRows = sourceRows.filter(
    (row) => text(record(row.payload)?.document_name) === context.sourceRef,
  );
  if (exactLocalRows.length > 0) {
    if (exactLocalRows.length !== 1 || !readDocument(exactLocalRows[0])) {
      return unavailableBundle(
        "The exact local SEC source row was duplicated or unreadable; network fallback was not attempted.",
        ledger,
      );
    }
    return {
      ok: true,
      sourceMode: "stored",
      classUniverseMode: exactUniverse ? "exact_filing" : referenceUniverse ? "issuer_reference" : null,
      ledger,
      documents,
      classUniverse: referenceUniverse,
    };
  }

  const requestPolicy = getSecRequestPolicy();
  if (!requestPolicy) {
    return unavailableBundle("SEC_USER_AGENT is unavailable; official SEC fallback was not attempted.", ledger);
  }
  const official = await fetchOfficialSecFilingDocument({
    accessionNumber,
    issuerCik: context.issuerCik,
    requestPolicy,
    sourceForm: context.sourceForm,
    sourceRef: context.sourceRef,
  });
  if (!official.ok) return unavailableBundle(official.reason, ledger);
  return {
    ok: true,
    sourceMode: "official_sec_fallback",
    officialSecFallbackArtifact: official.artifact,
    classUniverseMode: referenceUniverse ? "issuer_reference" : null,
    ledger,
    documents: [official.document],
    classUniverse: referenceUniverse,
  };
}

export function normalizeStoredSecDocumentText(source: string) {
  return normalizeSecDocumentText(source);
}

function readLedger(value: Record<string, unknown>) {
  const issuerCik = text(value.issuer_cik);
  const accessionNumber = text(value.accession_number);
  const form = text(value.form);
  const primaryDocument = text(value.primary_document);
  if (!issuerCik || !accessionNumber || !form || !primaryDocument) return null;
  return {
    issuer_cik: issuerCik,
    accession_number: accessionNumber,
    form,
    primary_document: primaryDocument,
  };
}

function readDocument(value: Record<string, unknown>) {
  const payload = record(value.payload);
  const sourceRef = text(payload?.document_name);
  const sourceUrl = text(value.source_url);
  const rawContent = typeof value.raw_content === "string" ? value.raw_content : "";
  if (!sourceRef || !sourceUrl || !rawContent) return null;
  return {
    source_ref: sourceRef,
    source_url: sourceUrl,
    document_name: sourceRef,
    label: sourceRef,
    text: normalizeStoredSecDocumentText(rawContent),
  };
}

function readClassUniverse(value: Record<string, unknown>) {
  return {
    issuer_cik: text(value.issuer_cik),
    source_accession: text(value.source_accession),
    source_form: text(value.source_form),
    universe_as_of: text(value.universe_as_of),
    source_documents: value.source_documents,
    status: text(value.status),
    reason: text(value.reason),
    required_canonical_security_class_ids:
      value.required_canonical_security_class_ids,
    class_evidence: value.class_evidence,
  };
}

function readReferenceUniverse(rows: Record<string, unknown>[]) {
  if (!rows.length) return null;
  const latestAsOf = text(rows[0]?.universe_as_of);
  const frontier = rows.filter((row) => text(row.universe_as_of) === latestAsOf);
  if (frontier.length !== 1) return null;
  return readClassUniverse(frontier[0]);
}

let sharedSecRequestPolicy: SecRequestPolicy | null = null;

function getSecRequestPolicy() {
  if (sharedSecRequestPolicy) return sharedSecRequestPolicy;
  const userAgent = getServerEnv().secUserAgent;
  if (!userAgent) return null;
  sharedSecRequestPolicy = new SecRequestPolicy(userAgent);
  return sharedSecRequestPolicy;
}

function unavailableBundle(
  errorReason: string,
  ledger: DilutionRegistryOsSourceBundle["ledger"] = null,
): DilutionRegistryOsSourceBundle {
  return {
    ok: false,
    errorReason,
    sourceMode: null,
    classUniverseMode: null,
    ledger,
    documents: [],
    classUniverse: null,
  };
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
