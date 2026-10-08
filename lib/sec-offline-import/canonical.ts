import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildSecArchiveFilingUrls } from "../sources/sec/archiveUrls.ts";
import { cleanSecDocumentText } from "../sources/sec/documentText.ts";
import type { SecParsedRawItem } from "../sources/sec/parser.ts";

type Row = Record<string, unknown>;

type VerifiedFile = Readonly<{
  text: string;
  sha256: string;
  utf8ByteCount: number;
}>;

type FilingMetadata = Readonly<{
  role: string;
  archiveFile: string;
  accessionNumber: string;
  sourceSha256: string;
  sourceUtf8ByteCount: number;
  capturedAt: string;
  issuerCik: string;
  companyName: string;
  formType: string;
  filingDate: string;
  acceptedAt: string;
  primaryDocument: string;
  indexUrl: string;
  primaryDocumentUrl: string;
  sourceText: string;
}>;

export const SEC_OFFLINE_ARCHIVE_IMPORT_VERSION = "sec-offline-archive-import-v1";
export const SEC_OFFLINE_ARCHIVE_MANIFEST_VERSION = 1;
const MAX_ARCHIVE_FILINGS = 100;
const MAX_ARCHIVE_SOURCE_UTF8_BYTES = 20_000_000;
const MAX_PRIMARY_DOCUMENT_CHARS = 2_000_000;
const MAX_DOCUMENT_TEXT_CHARS = 160_000;
const MAX_COMBINED_TEXT_CHARS = 500_000;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SAFE_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

export class SecOfflineArchiveImportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SecOfflineArchiveImportError";
    this.code = code;
  }
}

export type SecOfflineArchivePreparedItem = Readonly<{
  rawItemId: string;
  accessionNumber: string;
  role: string;
  archiveFile: string;
  sourceSha256: string;
  sourceUtf8ByteCount: number;
  rawItem: SecParsedRawItem & { id: string };
}>;

export type SecOfflineArchiveImportBundle = Readonly<{
  version: typeof SEC_OFFLINE_ARCHIVE_IMPORT_VERSION;
  manifestVersion: number;
  manifestSha256: string;
  bundleSha256: string;
  submissionsSha256: string;
  issuerCik: string;
  runId: string;
  items: readonly SecOfflineArchivePreparedItem[];
}>;

export async function buildSecOfflineArchiveImportBundle(input: {
  directory: string;
  manifestFile?: string;
}): Promise<SecOfflineArchiveImportBundle> {
  const root = await realDirectory(input.directory);
  const manifestName = input.manifestFile ?? "manifest.json";
  const manifestPath = await resolveArchiveFile(root, manifestName);
  const manifestSource = await readVerifiedUtf8File(manifestPath);
  const manifest = parseJsonObject(manifestSource.text, "manifest_invalid_json");
  if (integer(manifest.version) !== SEC_OFFLINE_ARCHIVE_MANIFEST_VERSION) {
    fail("manifest_version_unsupported", "SEC offline archive manifest version is unsupported");
  }

  const submissionsEntry = record(manifest.submissions);
  const submissionsFile = requiredString(submissionsEntry.file, "submissions_file_invalid");
  const submissionsUrl = requiredString(submissionsEntry.url, "submissions_url_invalid");
  const expectedSubmissionsSha = requiredSha(submissionsEntry.sha256, "submissions_sha256_invalid");
  const submissionsUrlMatch = submissionsUrl.match(
    /^https:\/\/data\.sec\.gov\/submissions\/CIK(\d{10})\.json$/,
  );
  if (!submissionsUrlMatch) {
    fail("submissions_url_invalid", "SEC submissions URL must be an exact data.sec.gov CIK source");
  }

  const submissionsPath = await resolveArchiveFile(root, submissionsFile);
  const submissionsSource = await readVerifiedUtf8File(submissionsPath);
  if (submissionsSource.sha256 !== expectedSubmissionsSha) {
    fail("submissions_sha256_mismatch", "SEC submissions source SHA-256 does not match its manifest");
  }
  const submissions = parseJsonObject(submissionsSource.text, "submissions_invalid_json");
  const issuerCik = normalizeCik(submissions.cik);
  if (!issuerCik || issuerCik !== submissionsUrlMatch[1]) {
    fail("submissions_cik_mismatch", "SEC submissions CIK does not match its source URL");
  }
  const companyName = requiredString(submissions.name, "submissions_company_name_invalid");
  const recent = record(record(submissions.filings).recent);
  const accessionNumbers = stringArray(recent.accessionNumber);
  if (!accessionNumbers.length) {
    fail("submissions_recent_missing", "SEC submissions recent filing index is missing");
  }

  const filingEntries = array(manifest.filings);
  if (!filingEntries.length || filingEntries.length > MAX_ARCHIVE_FILINGS) {
    fail("manifest_filings_invalid", "SEC offline archive must contain between 1 and 100 filings");
  }
  const seenAccessions = new Set<string>();
  const seenFiles = new Set<string>();
  const filings: FilingMetadata[] = [];
  let totalSourceUtf8Bytes = 0;

  for (const entryValue of filingEntries) {
    const entry = record(entryValue);
    const role = requiredString(entry.role, "filing_role_invalid");
    const archiveFile = requiredString(entry.file, "filing_file_invalid").replaceAll("\\", "/");
    const accessionNumber = requiredString(entry.accession, "filing_accession_invalid");
    const expectedSourceSha = requiredSha(entry.sha256, "filing_sha256_invalid");
    const capturedAt = requiredTimestamp(entry.capturedAt, "filing_capture_time_invalid");
    if (!ACCESSION_PATTERN.test(accessionNumber)) {
      fail("filing_accession_invalid", "SEC offline archive filing accession is invalid");
    }
    if (seenAccessions.has(accessionNumber)) {
      fail("filing_accession_duplicate", "SEC offline archive contains a duplicate accession");
    }
    if (seenFiles.has(archiveFile)) {
      fail("filing_file_duplicate", "SEC offline archive reuses one source file for multiple filings");
    }
    seenAccessions.add(accessionNumber);
    seenFiles.add(archiveFile);

    const index = accessionNumbers.indexOf(accessionNumber);
    if (index < 0) {
      fail("filing_not_in_submissions", "SEC offline archive filing is absent from retained Submissions metadata");
    }
    const formType = requiredArrayString(recent.form, index, "filing_form_missing");
    const filingDate = requiredDate(
      requiredArrayString(recent.filingDate, index, "filing_date_missing"),
      "filing_date_invalid",
    );
    const acceptedAt = requiredTimestamp(
      requiredArrayString(recent.acceptanceDateTime, index, "filing_acceptance_missing"),
      "filing_acceptance_invalid",
    );
    const primaryDocument = requiredArrayString(
      recent.primaryDocument,
      index,
      "filing_primary_document_missing",
    );
    if (!SAFE_FILE_PATTERN.test(primaryDocument)) {
      fail("filing_primary_document_invalid", "SEC primary document name is invalid");
    }

    const sourcePath = await resolveArchiveFile(root, archiveFile);
    const source = await readVerifiedUtf8File(sourcePath);
    if (source.sha256 !== expectedSourceSha) {
      fail("filing_sha256_mismatch", "SEC filing source SHA-256 does not match its manifest");
    }
    if (!source.text.trim() || source.text.length > MAX_PRIMARY_DOCUMENT_CHARS) {
      fail("filing_source_size_invalid", "SEC filing source is empty or exceeds the canonical raw limit");
    }
    totalSourceUtf8Bytes += source.utf8ByteCount;
    if (totalSourceUtf8Bytes > MAX_ARCHIVE_SOURCE_UTF8_BYTES) {
      fail("archive_source_size_invalid", "SEC offline archive exceeds the canonical batch byte limit");
    }

    const archiveUrls = buildSecArchiveFilingUrls(issuerCik, accessionNumber);
    if (!archiveUrls) {
      fail("filing_archive_url_invalid", "SEC archive URL could not be derived from verified identity");
    }
    filings.push({
      role,
      archiveFile,
      accessionNumber,
      sourceSha256: source.sha256,
      sourceUtf8ByteCount: source.utf8ByteCount,
      capturedAt,
      issuerCik,
      companyName,
      formType: normalizeForm(formType),
      filingDate,
      acceptedAt,
      primaryDocument,
      indexUrl: archiveUrls.indexHtmlUrl,
      primaryDocumentUrl: `${archiveUrls.archiveDirectoryUrl}/${primaryDocument}`,
      sourceText: source.text,
    });
  }

  const manifestSha256 = manifestSource.sha256;
  const bundleSha256 = sha256Utf8(stableStringify({
    version: SEC_OFFLINE_ARCHIVE_IMPORT_VERSION,
    manifestVersion: SEC_OFFLINE_ARCHIVE_MANIFEST_VERSION,
    manifestSha256,
    submissions: {
      file: submissionsFile.replaceAll("\\", "/"),
      url: submissionsUrl,
      sha256: submissionsSource.sha256,
      issuerCik,
    },
    filings: filings.map((filing) => ({
      role: filing.role,
      file: filing.archiveFile,
      accessionNumber: filing.accessionNumber,
      sourceSha256: filing.sourceSha256,
      capturedAt: filing.capturedAt,
      formType: filing.formType,
      filingDate: filing.filingDate,
      acceptedAt: filing.acceptedAt,
      primaryDocument: filing.primaryDocument,
      primaryDocumentUrl: filing.primaryDocumentUrl,
    })),
  }));

  const runId = deterministicUuid(`sec_offline_archive_run:${manifestSha256}`);
  const items = filings.map((filing) => buildPreparedItem({
    filing,
    manifestSha256,
    bundleSha256,
    submissionsFile: submissionsFile.replaceAll("\\", "/"),
    submissionsUrl,
    submissionsSha256: submissionsSource.sha256,
  }));

  return {
    version: SEC_OFFLINE_ARCHIVE_IMPORT_VERSION,
    manifestVersion: SEC_OFFLINE_ARCHIVE_MANIFEST_VERSION,
    manifestSha256,
    bundleSha256,
    submissionsSha256: submissionsSource.sha256,
    issuerCik,
    runId,
    items,
  };
}

function buildPreparedItem(input: {
  filing: FilingMetadata;
  manifestSha256: string;
  bundleSha256: string;
  submissionsFile: string;
  submissionsUrl: string;
  submissionsSha256: string;
}): SecOfflineArchivePreparedItem {
  const { filing } = input;
  const cleaned = cleanSecDocumentText(filing.sourceText);
  if (!cleaned) {
    fail("filing_visible_text_missing", "SEC filing source produced no visible canonical text");
  }
  const textTruncated = cleaned.length > MAX_DOCUMENT_TEXT_CHARS;
  const documentText = textTruncated ? cleaned.slice(0, MAX_DOCUMENT_TEXT_CHARS) : cleaned;
  const combined = `### ${filing.formType}\n${documentText}`;
  const bodyText = combined.length > MAX_COMBINED_TEXT_CHARS
    ? combined.slice(0, MAX_COMBINED_TEXT_CHARS)
    : combined;
  const rawItemId = deterministicUuid(
    `sec_offline_archive_raw:${filing.accessionNumber}:${filing.sourceSha256}`,
  );
  const title = `${filing.companyName} files ${filing.formType}`;
  if (title.length > 2_000) {
    fail("filing_title_invalid", "SEC offline archive filing title exceeds the raw item limit");
  }
  const provenance = {
    version: SEC_OFFLINE_ARCHIVE_IMPORT_VERSION,
    acquisitionMethod: "offline_archive",
    manifestSha256: input.manifestSha256,
    bundleSha256: input.bundleSha256,
    archiveFile: filing.archiveFile,
    archiveRole: filing.role,
    capturedAt: filing.capturedAt,
    submissions: {
      file: input.submissionsFile,
      url: input.submissionsUrl,
      sha256: input.submissionsSha256,
    },
    sourceSha256: filing.sourceSha256,
    sourceUtf8ByteCount: filing.sourceUtf8ByteCount,
  };
  const rawItem: SecParsedRawItem & { id: string } = {
    id: rawItemId,
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: filing.accessionNumber,
    source_url: filing.indexUrl,
    title,
    published_at: filing.acceptedAt,
    fetched_at: filing.capturedAt,
    body_text: bodyText,
    analysis_text: bodyText,
    dedupe_key: `sec_edgar:${filing.accessionNumber}`,
    raw_payload: {
      parser_version: "sec_edgar_raw_parser_v1",
      text_version: "sec_text_clean_v1",
      form_type: filing.formType,
      cik: filing.issuerCik,
      cik_padded: filing.issuerCik,
      filer_cik: filing.issuerCik,
      filer_cik_padded: filing.issuerCik,
      accession_number: filing.accessionNumber,
      accession_no_dashes: filing.accessionNumber.replaceAll("-", ""),
      filing_date: filing.filingDate,
      accepted_at: filing.acceptedAt,
      company_name: filing.companyName,
      ticker: null,
      exchange: null,
      ticker_resolution: {
        source: "unresolved",
        confidence: "none",
        reason: "Offline archive import preserves source identity without assigning a current ticker.",
        cusip: null,
      },
      tickers: [],
      detail_url: filing.indexUrl,
      primary_document_url: filing.primaryDocumentUrl,
      primary_document_html: filing.sourceText,
      primary_document_html_char_count: filing.sourceText.length,
      primary_document_html_utf8_byte_count: filing.sourceUtf8ByteCount,
      primary_document_html_truncated: false,
      primary_document_sha256: filing.sourceSha256,
      periodic_report_core_xbrl_facts: [],
      periodic_report_core_source_blocks: [],
      documents: [{
        sequence: null,
        description: null,
        document: filing.primaryDocument,
        type: filing.formType,
        size: String(filing.sourceUtf8ByteCount),
        url: filing.primaryDocumentUrl,
        isPrimary: true,
        textCharCount: cleaned.length,
        textTruncated,
        rawTextCharCount: 0,
        rawTextTruncated: false,
        rawTextPreserved: false,
        rawHtmlCharCount: filing.sourceText.length,
        rawHtmlTruncated: false,
        rawHtmlPreserved: true,
        rawSourceFormat: null,
        sc13RawTextCharCount: 0,
        sc13RawTextTruncated: false,
        sc13RawTextPreserved: false,
        sc13RawSourceFormat: null,
        sc13RawCaptureStatus: null,
        sc13RawCaptureError: null,
        fetchStatus: null,
        fetchError: null,
        textExtractionStatus: "text_extracted_from_verified_offline_archive",
      }],
      attachment_texts: [],
      text_truncated: bodyText.length >= MAX_COMBINED_TEXT_CHARS,
      offline_archive_import: provenance,
    },
    metadata: {
      parser: "sec_edgar",
      form_type: filing.formType,
      cik: filing.issuerCik,
      filer_cik: filing.issuerCik,
      accession_number: filing.accessionNumber,
      ticker: null,
      exchange: null,
      company_name: filing.companyName,
      primary_document_url: filing.primaryDocumentUrl,
      document_count: 1,
      event_created: false,
      offline_archive_import: provenance,
    },
  };
  return {
    rawItemId,
    accessionNumber: filing.accessionNumber,
    role: filing.role,
    archiveFile: filing.archiveFile,
    sourceSha256: filing.sourceSha256,
    sourceUtf8ByteCount: filing.sourceUtf8ByteCount,
    rawItem,
  };
}

export function compareSecOfflineArchiveRawItem(
  existingValue: unknown,
  prepared: SecOfflineArchivePreparedItem,
): { matches: true } | { matches: false; reason: string } {
  const existing = record(existingValue);
  const expected = prepared.rawItem;
  const existingRaw = record(existing.raw_payload);
  const expectedRaw = record(expected.raw_payload);
  const checks: Array<[boolean, string]> = [
    [string(existing.source_code) === "sec_edgar", "source_code_mismatch"],
    [string(existing.source_group) === "filings", "source_group_mismatch"],
    [string(existing.source_unique_id) === prepared.accessionNumber, "accession_mismatch"],
    [string(existing.source_url) === expected.source_url, "index_url_mismatch"],
    [string(existing.dedupe_key) === expected.dedupe_key, "dedupe_key_mismatch"],
    [string(existingRaw.accession_number) === prepared.accessionNumber, "raw_accession_mismatch"],
    [normalizeCik(existingRaw.cik) === normalizeCik(expectedRaw.cik), "issuer_cik_mismatch"],
    [normalizeForm(existingRaw.form_type) === normalizeForm(expectedRaw.form_type), "form_type_mismatch"],
    [string(existingRaw.filing_date) === string(expectedRaw.filing_date), "filing_date_mismatch"],
    [sameTimestamp(existingRaw.accepted_at, expectedRaw.accepted_at), "accepted_at_mismatch"],
    [string(existingRaw.primary_document_url) === string(expectedRaw.primary_document_url), "primary_url_mismatch"],
    [existingRaw.primary_document_html_truncated === false, "primary_source_truncated"],
  ];
  for (const [ok, reason] of checks) {
    if (!ok) return { matches: false, reason };
  }
  const sourceText = rawString(existingRaw.primary_document_html);
  if (!sourceText) return { matches: false, reason: "primary_source_missing" };
  if (sha256Utf8(sourceText) !== prepared.sourceSha256) {
    return { matches: false, reason: "primary_source_sha256_mismatch" };
  }
  if (Buffer.byteLength(sourceText, "utf8") !== prepared.sourceUtf8ByteCount) {
    return { matches: false, reason: "primary_source_byte_count_mismatch" };
  }
  return { matches: true };
}

async function realDirectory(value: string) {
  const resolved = await fs.realpath(path.resolve(value));
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) fail("archive_directory_invalid", "SEC offline archive path is not a directory");
  return resolved;
}

async function resolveArchiveFile(root: string, relativeValue: string) {
  if (!relativeValue || path.isAbsolute(relativeValue)) {
    fail("archive_file_path_invalid", "SEC offline archive file path must be relative");
  }
  const candidate = await fs.realpath(path.resolve(root, relativeValue));
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("archive_file_path_escape", "SEC offline archive file escapes its archive directory");
  }
  const stat = await fs.stat(candidate);
  if (!stat.isFile()) fail("archive_file_invalid", "SEC offline archive source is not a file");
  return candidate;
}

async function readVerifiedUtf8File(file: string): Promise<VerifiedFile> {
  const bytes = await fs.readFile(file);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("archive_file_not_utf8", "SEC offline archive source is not valid UTF-8");
  }
  const roundTrip = Buffer.from(text!, "utf8");
  if (!roundTrip.equals(bytes)) {
    fail("archive_file_not_utf8_roundtrip", "SEC offline archive UTF-8 source is not byte-preserving");
  }
  return {
    text: text!,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    utf8ByteCount: bytes.length,
  };
}

function parseJsonObject(value: string, code: string): Row {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Row;
  } catch {
    // Converted to a stable public error below.
  }
  fail(code, "SEC offline archive JSON source is invalid");
}

function requiredArrayString(value: unknown, index: number, code: string) {
  const values = Array.isArray(value) ? value : [];
  return requiredString(values[index], code);
}

function requiredString(value: unknown, code: string) {
  const text = string(value);
  if (!text || text.length > 2_000) fail(code, "SEC offline archive required text field is invalid");
  return text;
}

function requiredSha(value: unknown, code: string) {
  const text = string(value).toLowerCase();
  if (!SHA256_PATTERN.test(text)) fail(code, "SEC offline archive SHA-256 field is invalid");
  return text;
}

function requiredTimestamp(value: unknown, code: string) {
  const text = string(value);
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) fail(code, "SEC offline archive timestamp is invalid");
  return date.toISOString();
}

function requiredDate(value: string, code: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    fail(code, "SEC offline archive date is invalid");
  }
  return value;
}

function sameTimestamp(left: unknown, right: unknown) {
  const a = new Date(string(left));
  const b = new Date(string(right));
  return !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && a.getTime() === b.getTime();
}

function normalizeCik(value: unknown) {
  const text = string(value);
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : "";
}

function normalizeForm(value: unknown) {
  return string(value).toUpperCase().replace(/\s+/g, " ");
}

function deterministicUuid(value: string) {
  const bytes = Buffer.from(sha256Utf8(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sha256Utf8(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Row;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(string) : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function rawString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) ? number : null;
}

function fail(code: string, message: string): never {
  throw new SecOfflineArchiveImportError(code, message);
}
