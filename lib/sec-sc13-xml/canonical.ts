import { createHash } from "node:crypto";
import {
  parseSc13StructuralXml,
  type Sc13StructuralParseResult,
  type Sc13StructuralReporter,
} from "../sources/sec/forms/sc13/structuralParser.ts";

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const SC13_FORM_PATTERN = /^(?:SC|SCHEDULE)\s+13[DG](?:\/A)?$/;

type Row = Record<string, unknown>;

export class Sc13CanonicalSourceError extends Error {
  readonly code: string;
  readonly issues: ReadonlyArray<{ code: string; message: string }>;

  constructor(code: string, message: string, issues: ReadonlyArray<{ code: string; message: string }> = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

export type Sc13CanonicalPayload = Readonly<{
  filing: Row;
  reporters: Row[];
  structural: Sc13StructuralParseResult;
}>;

export function isSc13RawItem(rawItem: Row): boolean {
  return SC13_FORM_PATTERN.test(normalizedFormType(record(rawItem.raw_payload).form_type));
}

export function buildSc13CanonicalPayload(rawItemId: string, rawItem: Row): Sc13CanonicalPayload | null {
  const rawPayload = record(rawItem.raw_payload);
  const formType = normalizedFormType(rawPayload.form_type);
  if (!SC13_FORM_PATTERN.test(formType)) return null;
  const accessionNumber = requiredAccession(rawPayload.accession_number, "raw payload accession");
  if (requiredAccession(rawItem.source_unique_id, "raw item source identity") !== accessionNumber) {
    throw new Sc13CanonicalSourceError("accession_mismatch", "SC13 raw item identity does not match its payload accession");
  }
  if (!uuidLike(rawItemId)) {
    throw new Sc13CanonicalSourceError("raw_item_identity_invalid", "SC13 raw item ID must be a UUID");
  }

  const structural = parseSc13StructuralXml({
    rawXml: rawString(rawPayload.sc13_source_text),
    sourceFormat: nullableString(rawPayload.sc13_source_format),
    sourceUrl: nullableString(rawPayload.sc13_source_url),
    expectedAccessionNumber: accessionNumber,
    expectedFormType: formType,
    sourceTextCharCount: finiteNumber(rawPayload.sc13_source_text_char_count),
    sourceTextTruncated: rawPayload.sc13_source_text_truncated === true,
    indexSubjectCik: nullableString(rawPayload.sc13_index_subject_cik),
    indexSubjectCikCount: finiteNumber(rawPayload.sc13_index_subject_cik_count),
    indexFiledByCiks: stringArray(rawPayload.sc13_index_filed_by_ciks),
    indexCanonicalXmlUrl: nullableString(rawPayload.sc13_index_canonical_xml_url),
  });
  if (structural.status !== "parsed" || !structural.filing) {
    const issues = structural.issues;
    throw new Sc13CanonicalSourceError(
      "source_unavailable",
      `SC13 canonical XML is unavailable: ${issues.map((issue) => issue.code).join(", ")}`,
      issues,
    );
  }
  assertVerifiedStructuralSource(structural, accessionNumber);

  const filing = structural.filing;
  const sourceXml = requiredString(rawPayload.sc13_source_text, "SC13 raw XML");
  const filedAtRaw = nullableString(rawPayload.accepted_at) ?? nullableString(rawPayload.filing_date);
  const reporters = filing.reportingPersons.map((reporter, index) => reporterPayload(accessionNumber, reporter, index));
  const canonicalFiling: Row = {
    accession_number: accessionNumber,
    raw_item_id: rawItemId,
    form_type_raw: filing.submissionTypeRaw,
    previous_accession_number_raw: filing.previousAccessionNumberRaw,
    amendment_number_raw: filing.amendmentNumberRaw,
    event_date_raw: filing.eventDateRaw,
    event_date: exactUsDate(filing.eventDateRaw),
    filed_at_raw: filedAtRaw,
    filed_at: filedAtRaw,
    header_filer_cik_raw: filing.headerFilerCikRaw,
    header_filer_cik: normalizeCik(filing.headerFilerCikRaw),
    issuer_cik_raw: filing.issuer.issuerCikRaw,
    issuer_cik: normalizeCik(filing.issuer.issuerCikRaw),
    issuer_name_raw: filing.issuer.issuerNameRaw,
    security_class_raw: filing.issuer.security.classTitleRaw,
    cusips_raw: filing.issuer.security.cusipsRaw,
    source_url: structural.source.url,
    source_sha256: structural.source.sha256,
    raw_xml: sourceXml,
    raw_xml_char_count: structural.source.preservedTextCharCount,
    raw_xml_utf8_byte_count: Buffer.byteLength(sourceXml, "utf8"),
    parser_version: structural.parserVersion,
    xsd_package_version: structural.xsdPackageVersion,
    namespace: structural.provenance.namespace,
    schema_version_raw: structural.provenance.schemaVersionRaw,
    archive_directory_cik_raw: structural.provenance.urlArchiveDirectoryCikRaw,
    archive_directory_role: structural.provenance.urlArchiveDirectoryRole,
    index_subject_cik_raw: structural.provenance.indexSubjectCikRaw,
    index_filed_by_ciks_raw: structural.provenance.indexFiledByCiksRaw,
    index_canonical_xml_url: structural.provenance.indexCanonicalXmlUrl,
    provenance_payload: structural.provenance,
    structural_payload: filing,
  };
  canonicalFiling.payload_sha256 = sc13PayloadFingerprint({
    source: structural.source,
    provenance: structural.provenance,
    filing,
    collection: { filedAtRaw },
  });

  return { filing: canonicalFiling, reporters, structural };
}

export function validateSc13CanonicalRead(
  filingRow: Row,
  reporterRows: Row[],
): { ok: true; structural: Sc13StructuralParseResult } | { ok: false; reason: string } {
  try {
    const accessionNumber = requiredAccession(filingRow.accession_number, "stored accession");
    const rawXml = requiredString(filingRow.raw_xml, "stored raw XML");
    const sourceSha = sha256(rawXml);
    if (sourceSha !== requiredString(filingRow.source_sha256, "stored source SHA-256")) {
      return { ok: false, reason: "source_hash_mismatch" };
    }
    if (Number(filingRow.raw_xml_char_count) !== rawXml.length) {
      return { ok: false, reason: "source_length_mismatch" };
    }
    if (Number(filingRow.raw_xml_utf8_byte_count) !== Buffer.byteLength(rawXml, "utf8")) {
      return { ok: false, reason: "source_byte_length_mismatch" };
    }
    const provenance = record(filingRow.provenance_payload);
    const structuralPayload = record(filingRow.structural_payload);
    const structural = parseStructuralReadback({ filingRow, provenance, rawXml, accessionNumber });
    if (structural.status !== "parsed" || !structural.filing) {
      return { ok: false, reason: "stored_source_unavailable" };
    }
    if (stableStringify(structural.filing) !== stableStringify(structuralPayload)) {
      return { ok: false, reason: "structural_payload_mismatch" };
    }
    if (!filingColumnsMatch(filingRow, structural)) {
      return { ok: false, reason: "filing_columns_mismatch" };
    }
    if (reporterRows.length !== structural.filing.reportingPersons.length) {
      return { ok: false, reason: "reporter_count_mismatch" };
    }
    for (const [index, expected] of structural.filing.reportingPersons.entries()) {
      const stored = reporterRows[index];
      if (!stored || Number(stored.reporting_person_index) !== index || stored.accession_number !== accessionNumber) {
        return { ok: false, reason: "reporter_identity_mismatch" };
      }
      if (stableStringify(record(stored.structural_payload)) !== stableStringify(expected)) {
        return { ok: false, reason: "reporter_payload_mismatch" };
      }
      if (!reporterColumnsMatch(stored, expected)) {
        return { ok: false, reason: "reporter_columns_mismatch" };
      }
    }
    const fingerprint = sc13PayloadFingerprint({
      source: structural.source,
      provenance: structural.provenance,
      filing: structural.filing,
      collection: { filedAtRaw: nullableString(filingRow.filed_at_raw) },
    });
    if (fingerprint !== requiredString(filingRow.payload_sha256, "stored payload SHA-256")) {
      return { ok: false, reason: "payload_hash_mismatch" };
    }
    return { ok: true, structural };
  } catch {
    return { ok: false, reason: "stored_payload_invalid" };
  }
}

export function sc13PayloadFingerprint(value: unknown): string {
  return sha256(stableStringify(value));
}

function parseStructuralReadback(input: {
  filingRow: Row;
  provenance: Row;
  rawXml: string;
  accessionNumber: string;
}) {
  return parseSc13StructuralXml({
    rawXml: input.rawXml,
    sourceFormat: "sec_schedule_13_xml",
    sourceUrl: requiredString(input.filingRow.source_url, "stored source URL"),
    expectedAccessionNumber: input.accessionNumber,
    expectedFormType: requiredString(input.filingRow.form_type_raw, "stored form type"),
    sourceTextCharCount: Number(input.filingRow.raw_xml_char_count),
    sourceTextTruncated: false,
    indexSubjectCik: nullableString(input.provenance.indexSubjectCikRaw),
    indexSubjectCikCount: 1,
    indexFiledByCiks: stringArray(input.provenance.indexFiledByCiksRaw),
    indexCanonicalXmlUrl: nullableString(input.provenance.indexCanonicalXmlUrl),
  });
}

function assertVerifiedStructuralSource(
  structural: Extract<Sc13StructuralParseResult, { status: "parsed" }> | Sc13StructuralParseResult,
  accessionNumber: string,
) {
  if (
    structural.status !== "parsed"
    || !structural.filing
    || structural.source.format !== "sec_schedule_13_xml"
    || structural.source.truncated
    || structural.source.textCharCount !== structural.source.preservedTextCharCount
    || !structural.source.sha256
    || !structural.provenance.officialSecArchiveUrl
    || structural.provenance.accessionStatus !== "match"
    || structural.provenance.expectedAccessionNumber !== accessionNumber
    || structural.provenance.urlAccessionNumber !== accessionNumber
    || structural.provenance.namespaceStatus !== "supported"
    || structural.provenance.schemaVersionStatus !== "supported"
    || structural.provenance.indexStatus !== "verified"
    || structural.provenance.urlArchiveDirectoryStatus !== "matched_known_role"
  ) {
    throw new Sc13CanonicalSourceError("source_verification_failed", "SC13 structural source verification did not pass");
  }
  const issuerCik = normalizeCik(structural.filing.issuer.issuerCikRaw);
  const headerFilerCik = normalizeCik(structural.filing.headerFilerCikRaw);
  const indexSubjectCik = normalizeCik(structural.provenance.indexSubjectCikRaw);
  const indexFiledByCiks = structural.provenance.indexFiledByCiksRaw.map(normalizeCik);
  if (!issuerCik || !headerFilerCik || indexSubjectCik !== issuerCik || !indexFiledByCiks.includes(headerFilerCik)) {
    throw new Sc13CanonicalSourceError("role_provenance_mismatch", "SC13 issuer and header filer roles do not match official index provenance");
  }
}

function reporterPayload(accessionNumber: string, reporter: Sc13StructuralReporter, index: number): Row {
  return {
    accession_number: accessionNumber,
    reporting_person_index: index,
    reporting_person_cik_raw: reporter.reportingPersonCikRaw,
    reporting_person_cik: reporter.reportingPersonCikRaw ? normalizeCik(reporter.reportingPersonCikRaw) : null,
    reporting_person_cik_missing_flag_raw: reporter.reportingPersonCikMissingFlagRaw,
    reporting_person_name_raw: reporter.reportingPersonNameRaw,
    member_of_group_raw: reporter.memberOfGroupRaw,
    fund_types_raw: reporter.fundTypesRaw,
    citizenship_or_organization_raw: reporter.citizenshipOrOrganizationRaw,
    sole_voting_power_raw: reporter.soleVotingPowerRaw,
    shared_voting_power_raw: reporter.sharedVotingPowerRaw,
    sole_dispositive_power_raw: reporter.soleDispositivePowerRaw,
    shared_dispositive_power_raw: reporter.sharedDispositivePowerRaw,
    aggregate_amount_owned_raw: reporter.aggregateAmountOwnedRaw,
    aggregate_excludes_certain_shares_flag_raw: reporter.aggregateExcludesCertainSharesFlagRaw,
    percent_of_class_raw: reporter.percentOfClassRaw,
    types_of_reporting_person_raw: reporter.typesOfReportingPersonRaw,
    structural_payload: reporter,
  };
}

function reporterColumnsMatch(stored: Row, expected: Sc13StructuralReporter) {
  const pairs: Array<[keyof Sc13StructuralReporter, string]> = [
    ["reportingPersonCikRaw", "reporting_person_cik_raw"],
    ["reportingPersonCikMissingFlagRaw", "reporting_person_cik_missing_flag_raw"],
    ["reportingPersonNameRaw", "reporting_person_name_raw"],
    ["memberOfGroupRaw", "member_of_group_raw"],
    ["citizenshipOrOrganizationRaw", "citizenship_or_organization_raw"],
    ["soleVotingPowerRaw", "sole_voting_power_raw"],
    ["sharedVotingPowerRaw", "shared_voting_power_raw"],
    ["soleDispositivePowerRaw", "sole_dispositive_power_raw"],
    ["sharedDispositivePowerRaw", "shared_dispositive_power_raw"],
    ["aggregateAmountOwnedRaw", "aggregate_amount_owned_raw"],
    ["aggregateExcludesCertainSharesFlagRaw", "aggregate_excludes_certain_shares_flag_raw"],
    ["percentOfClassRaw", "percent_of_class_raw"],
  ];
  if (pairs.some(([source, target]) => (expected[source] ?? null) !== (stored[target] ?? null))) return false;
  if ((expected.reportingPersonCikRaw ? normalizeCik(expected.reportingPersonCikRaw) : null) !== (stored.reporting_person_cik ?? null)) return false;
  if (stableStringify(expected.fundTypesRaw) !== stableStringify(stored.fund_types_raw)) return false;
  if (stableStringify(expected.typesOfReportingPersonRaw) !== stableStringify(stored.types_of_reporting_person_raw)) return false;
  const decimals: Array<[keyof Sc13StructuralReporter, string]> = [
    ["soleVotingPowerRaw", "sole_voting_power"],
    ["sharedVotingPowerRaw", "shared_voting_power"],
    ["soleDispositivePowerRaw", "sole_dispositive_power"],
    ["sharedDispositivePowerRaw", "shared_dispositive_power"],
    ["aggregateAmountOwnedRaw", "aggregate_amount_owned"],
    ["percentOfClassRaw", "percent_of_class"],
  ];
  if (decimals.some(([source, target]) => canonicalDecimal(expected[source]) !== canonicalDecimal(stored[target]))) return false;
  const expectedExcluded = expected.aggregateExcludesCertainSharesFlagRaw === "Y"
    ? true
    : expected.aggregateExcludesCertainSharesFlagRaw === "N" ? false : null;
  if (expectedExcluded !== (stored.aggregate_excludes_certain_shares ?? null)) return false;
  return true;
}

function filingColumnsMatch(stored: Row, structural: Sc13StructuralParseResult) {
  if (structural.status !== "parsed" || !structural.filing) return false;
  const filing = structural.filing;
  const provenance = structural.provenance;
  const rawPairs: Array<[unknown, unknown]> = [
    [stored.accession_number, provenance.expectedAccessionNumber],
    [stored.form_type_raw, filing.submissionTypeRaw],
    [stored.previous_accession_number_raw ?? null, filing.previousAccessionNumberRaw],
    [stored.amendment_number_raw ?? null, filing.amendmentNumberRaw],
    [stored.event_date_raw, filing.eventDateRaw],
    [stored.event_date, exactUsDate(filing.eventDateRaw)],
    [stored.header_filer_cik_raw, filing.headerFilerCikRaw],
    [stored.header_filer_cik, normalizeCik(filing.headerFilerCikRaw)],
    [stored.issuer_cik_raw, filing.issuer.issuerCikRaw],
    [stored.issuer_cik, normalizeCik(filing.issuer.issuerCikRaw)],
    [stored.issuer_name_raw, filing.issuer.issuerNameRaw],
    [stored.security_class_raw, filing.issuer.security.classTitleRaw],
    [stored.source_url, structural.source.url],
    [stored.source_sha256, structural.source.sha256],
    [Number(stored.raw_xml_char_count), structural.source.preservedTextCharCount],
    [stored.parser_version, structural.parserVersion],
    [stored.xsd_package_version, structural.xsdPackageVersion],
    [stored.namespace, provenance.namespace],
    [stored.schema_version_raw, provenance.schemaVersionRaw],
    [stored.archive_directory_cik_raw, provenance.urlArchiveDirectoryCikRaw],
    [stored.archive_directory_role, provenance.urlArchiveDirectoryRole],
    [stored.index_subject_cik_raw, provenance.indexSubjectCikRaw],
    [stored.index_canonical_xml_url, provenance.indexCanonicalXmlUrl],
  ];
  if (rawPairs.some(([actual, expected]) => actual !== expected)) return false;
  if (stableStringify(stored.cusips_raw) !== stableStringify(filing.issuer.security.cusipsRaw)) return false;
  if (stableStringify(stored.index_filed_by_ciks_raw) !== stableStringify(provenance.indexFiledByCiksRaw)) return false;
  if (stableStringify(record(stored.provenance_payload)) !== stableStringify(provenance)) return false;
  const amendmentNumber = filing.amendmentNumberRaw === null ? null : Number(filing.amendmentNumberRaw);
  if ((stored.amendment_number ?? null) !== amendmentNumber) return false;
  const filedAtRaw = nullableString(stored.filed_at_raw);
  const storedFiledAt = nullableString(stored.filed_at);
  if (filedAtRaw === null) return storedFiledAt === null;
  const parsedFiledAt = new Date(filedAtRaw);
  const parsedStoredFiledAt = storedFiledAt ? new Date(storedFiledAt) : null;
  return Number.isFinite(parsedFiledAt.getTime())
    && Boolean(parsedStoredFiledAt && Number.isFinite(parsedStoredFiledAt.getTime()))
    && parsedStoredFiledAt!.toISOString() === parsedFiledAt.toISOString();
}

function canonicalDecimal(value: unknown) {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^\d+(?:\.\d+)?$/.test(text)) return "invalid";
  const [integer, fraction = ""] = text.split(".");
  const normalizedInteger = integer!.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function exactUsDate(value: string) {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Sc13CanonicalSourceError("event_date_invalid", "SC13 event date is invalid");
  const iso = `${match[3]}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    throw new Sc13CanonicalSourceError("event_date_invalid", "SC13 event date is invalid");
  }
  return iso;
}

function normalizedFormType(value: unknown) {
  return nullableString(value)?.toUpperCase().replace(/^FORM\s+/, "") ?? "";
}

function normalizeCik(value: unknown) {
  const text = nullableString(value);
  if (!text || !/^\d{1,10}$/.test(text)) return "";
  return text.padStart(10, "0");
}

function requiredAccession(value: unknown, label: string) {
  const text = nullableString(value);
  if (!text || !ACCESSION_PATTERN.test(text)) {
    throw new Sc13CanonicalSourceError("accession_invalid", `${label} is invalid`);
  }
  return text;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Sc13CanonicalSourceError("source_missing", `${label} is missing`);
  }
  return value;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rawString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function uuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Row)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}
