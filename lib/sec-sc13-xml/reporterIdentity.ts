import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { decodeSecHtmlEntities } from "../sources/sec/htmlEntities.ts";
import type { Sc13StructuralParseResult } from "../sources/sec/forms/sc13/structuralParser.ts";

export const SC13_REPORTER_IDENTITY_VERSION = "sc13_single_reporter_sec_identity_v1" as const;
const MAX_INDEX = 100_000;
const MAX_HEADER = 32_000;
export const SC13_IDENTITY_MAX_SUBMISSION_BYTES = 256_000;
type Row = Record<string, unknown>;
type OriginalDocument = Readonly<{ url: string; text: string; sha256: string }>;
export type Sc13ReporterIdentitySource = Readonly<{
  version: typeof SC13_REPORTER_IDENTITY_VERSION;
  accessionNumber: string;
  formType: string;
  xmlSourceUrl: string;
  xmlSourceSha256: string;
  index: OriginalDocument;
  submission: Readonly<{
    url: string; sha256: string; header: string; headerSha256: string;
    embeddedDocument: Readonly<{ type: string; filename: string; xmlSha256: string }>;
  }>;
}>;
export type Sc13VerifiedReporterIdentity = Readonly<{
  version: typeof SC13_REPORTER_IDENTITY_VERSION;
  basis: "sec_header_index_single_reporter";
  accessionNumber: string;
  reportingPersonIndex: 0;
  reportingPersonCik: string;
  reportingPersonNameRaw: string;
  xmlSourceUrl: string;
  xmlSourceSha256: string;
  indexSourceUrl: string;
  indexSha256: string;
  submissionSourceUrl: string;
  submissionSha256: string;
  submissionHeaderSha256: string;
}>;

/** Eligibility is deliberately limited to one 13G cover person; no joint-person assignment. */
export function sc13SingleReporterIdentityCandidate(structural: Sc13StructuralParseResult, rawXml: string) {
  const filing = structural.filing;
  if (structural.status !== "parsed" || !filing || !/^SCHEDULE 13G(?:\/A)?$/.test(filing.submissionTypeRaw)
    || filing.reportingPersons.length !== 1 || filing.reportingPersons[0]!.reportingPersonCikRaw !== null
    || structural.provenance.indexStatus !== "verified") return null;
  const reporter = filing.reportingPersons[0]!;
  if (reporter.memberOfGroupRaw !== null && reporter.memberOfGroupRaw !== "b") return null;
  try {
    const parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, trimValues: true }).parse(rawXml);
    const form = row(row(parsed.edgarSubmission).formData);
    const signature = row(form.signatureInformation);
    const items = row(form.items);
    // (b) alone does not assert multiple reporters. Explicit Item 8 N/A is required in either case.
    if (row(items.item8).notApplicableFlag !== "Y" || Object.keys(row(items.item8)).some((key) => key !== "notApplicableFlag")) return null;
    if (!name(reporter.reportingPersonNameRaw) || name(signature.reportingPersonName) !== name(reporter.reportingPersonNameRaw)
      || name(row(items.item2).filingPersonName) !== name(reporter.reportingPersonNameRaw)) return null;
    if (Array.isArray(signature.signatureDetails) || !Object.keys(row(signature.signatureDetails)).length) return null;
    return reporter;
  } catch { return null; }
}

/** Called only while collecting originals. Proves embedded XML equality before retaining bounded evidence. */
export function captureSc13ReporterIdentitySource(input: {
  structural: Sc13StructuralParseResult; rawXml: string; indexUrl: string; indexHtml: string; submissionUrl: string; submissionText: string;
}): Sc13ReporterIdentitySource | null {
  if (!sc13SingleReporterIdentityCandidate(input.structural, input.rawXml) || Buffer.byteLength(input.submissionText, "utf8") > SC13_IDENTITY_MAX_SUBMISSION_BYTES) return null;
  const headers = [...input.submissionText.matchAll(/<SEC-HEADER>[\s\S]*?<\/SEC-HEADER>/g)];
  const documents = [...input.submissionText.matchAll(/<DOCUMENT>\s*([\s\S]*?)<\/DOCUMENT>/g)];
  if (headers.length !== 1 || documents.length !== 1) return null;
  const document = documents[0]![1]!;
  const xmlBlocks = [...document.matchAll(/<XML>\s*([\s\S]*?)\s*<\/XML>/g)];
  const type = exactlyOne(document, /^<TYPE>([^\r\n]+)$/gm);
  const filename = exactlyOne(document, /^<FILENAME>([^\r\n]+)$/gm);
  if (xmlBlocks.length !== 1 || !type || !filename || xmlBlocks[0]![1]!.trim() !== input.rawXml.trim()) return null;
  const accessionNumber = input.structural.provenance.expectedAccessionNumber;
  if (!accessionNumber || !input.submissionText.startsWith(`<SEC-DOCUMENT>${accessionNumber}.txt`)) return null;
  const source: Sc13ReporterIdentitySource = {
    version: SC13_REPORTER_IDENTITY_VERSION, accessionNumber, formType: input.structural.filing!.submissionTypeRaw,
    xmlSourceUrl: input.structural.source.url!, xmlSourceSha256: hash(input.rawXml),
    index: { url: input.indexUrl, text: input.indexHtml, sha256: hash(input.indexHtml) },
    submission: { url: input.submissionUrl, sha256: hash(input.submissionText), header: headers[0]![0], headerSha256: hash(headers[0]![0]),
      embeddedDocument: { type, filename, xmlSha256: hash(xmlBlocks[0]![1]!.trim()) } },
  };
  return verifySc13ReporterIdentitySupplement(input.structural, input.rawXml, source) ? source : null;
}

/** No network or writes: revalidates stored source bindings without changing canonical XML rows. */
export function verifySc13ReporterIdentitySupplement(structural: Sc13StructuralParseResult, rawXml: string, value: unknown): Sc13VerifiedReporterIdentity | null {
  const reporter = sc13SingleReporterIdentityCandidate(structural, rawXml);
  if (!reporter || !isRow(value)) return null;
  const filing = structural.filing!;
  const source = value, index = row(source.index), submission = row(source.submission), document = row(submission.embeddedDocument);
  const accession = structural.provenance.expectedAccessionNumber!;
  const xmlUrl = officialArchiveUrl(structural.source.url, accession);
  const indexUrl = officialArchiveUrl(index.url, accession);
  const submissionUrl = officialArchiveUrl(submission.url, accession);
  if (!xmlUrl || !indexUrl || !submissionUrl || source.version !== SC13_REPORTER_IDENTITY_VERSION || source.accessionNumber !== accession
    || source.formType !== filing.submissionTypeRaw || source.xmlSourceUrl !== structural.source.url || source.xmlSourceSha256 !== structural.source.sha256
    || source.xmlSourceSha256 !== hash(rawXml) || document.xmlSha256 !== hash(rawXml.trim()) || document.type !== filing.submissionTypeRaw
    || document.filename !== xmlUrl.pathname.split("/").at(-1) || indexUrl.pathname.split("/").at(-1) !== `${accession}-index.html`
    || submissionUrl.pathname.split("/").at(-1) !== `${accession}.txt` || !/^[a-f0-9]{64}$/.test(text(submission.sha256))) return null;
  const indexText = text(index.text), header = text(submission.header);
  if (!indexText || indexText.length > MAX_INDEX || !header || header.length > MAX_HEADER || hash(indexText) !== index.sha256 || hash(header) !== submission.headerSha256) return null;
  if (!header.startsWith(`<SEC-HEADER>${accession}.hdr.sgml`) || !header.endsWith("</SEC-HEADER>")) return null;
  if (exactlyOne(header, /^ACCESSION NUMBER:\s*([^\r\n]+)$/gm) !== accession
    || exactlyOne(header, /^CONFORMED SUBMISSION TYPE:\s*([^\r\n]+)$/gm) !== filing.submissionTypeRaw
    || exactlyOne(header, /^PUBLIC DOCUMENT COUNT:\s*([^\r\n]+)$/gm) !== "1") return null;
  const headerRoles = [...header.matchAll(/^(SUBJECT COMPANY|FILED BY|FILER|ISSUER|REPORTING-OWNER):[^\r\n]*\r?\n([\s\S]*?)(?=^(?:SUBJECT COMPANY|FILED BY|FILER|ISSUER|REPORTING-OWNER):|<\/SEC-HEADER>)/gm)];
  if (headerRoles.length !== 2) return null;
  const subject = headerRoles.filter((match) => match[1] === "SUBJECT COMPANY"), filedBy = headerRoles.filter((match) => match[1] === "FILED BY");
  if (subject.length !== 1 || filedBy.length !== 1) return null;
  const headerSubject = headerRole(subject[0]![2]!), headerFiler = headerRole(filedBy[0]![2]!);
  const indexRoles = [...indexText.matchAll(/<span[^>]+class=["'][^"']*\bcompanyName\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].map((match) => indexRole(match[1]!));
  if (indexRoles.length !== 2 || indexRoles.some((role) => !role)) return null;
  const indexSubject = indexRoles.filter((role) => role!.role === "Subject"), indexFiler = indexRoles.filter((role) => role!.role === "Filed by");
  if (indexSubject.length !== 1 || indexFiler.length !== 1 || !headerSubject || !headerFiler) return null;
  const issuer = cik(filing.issuer.issuerCikRaw), filer = cik(filing.headerFilerCikRaw);
  if (!issuer || !filer || issuer === filer || headerSubject.cik !== issuer || headerFiler.cik !== filer
    || indexSubject[0]!.cik !== issuer || indexFiler[0]!.cik !== filer || name(headerFiler.name) !== name(reporter.reportingPersonNameRaw)
    || name(indexFiler[0]!.name) !== name(reporter.reportingPersonNameRaw) || name(headerSubject.name) !== name(indexSubject[0]!.name)
    || headerSubject.form !== filing.submissionTypeRaw || headerFiler.form !== filing.submissionTypeRaw) return null;
  if (exactlyOne(indexText, /<title>EDGAR Filing Documents for ([^<]+)<\/title>/g) !== accession
    || exactlyOne(indexText, /<strong>Form ([^<]+)<\/strong>/g) !== filing.submissionTypeRaw) return null;
  const links = [...indexText.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].flatMap((match) => {
    try { return [new URL(decodeSecHtmlEntities(match[1]!), indexUrl).href]; } catch { return []; }
  });
  if (!links.includes(xmlUrl.href) || !links.includes(submissionUrl.href)) return null;
  return { version: SC13_REPORTER_IDENTITY_VERSION, basis: "sec_header_index_single_reporter", accessionNumber: accession,
    reportingPersonIndex: 0, reportingPersonCik: filer, reportingPersonNameRaw: reporter.reportingPersonNameRaw,
    xmlSourceUrl: xmlUrl.href, xmlSourceSha256: structural.source.sha256!, indexSourceUrl: indexUrl.href, indexSha256: text(index.sha256),
    submissionSourceUrl: submissionUrl.href, submissionSha256: text(submission.sha256), submissionHeaderSha256: text(submission.headerSha256) };
}

/** Only an original, accession-bound index link may initiate the extra bounded collector read. */
export function sc13IdentitySubmissionUrl(indexHtml: string, indexUrl: string, accession: string): string | null {
  if (indexHtml.length > MAX_INDEX || !officialArchiveUrl(indexUrl, accession)) return null;
  const matches = [...indexHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].flatMap((match) => {
    try {
      const url = new URL(decodeSecHtmlEntities(match[1]!), indexUrl);
      return officialArchiveUrl(url.href, accession) && url.pathname.endsWith(`/${accession}.txt`) ? [url.href] : [];
    } catch { return []; }
  });
  return matches.length === 1 ? matches[0]! : null;
}

function headerRole(block: string) {
  const roleCik = cik(exactlyOne(block, /^\s*CENTRAL INDEX KEY:\s*([^\r\n]+)$/gm));
  const roleName = exactlyOne(block, /^\s*COMPANY CONFORMED NAME:\s*([^\r\n]+)$/gm);
  const form = exactlyOne(block, /^\s*FORM TYPE:\s*([^\r\n]+)$/gm);
  return roleCik && roleName && form ? { cik: roleCik, name: roleName, form } : null;
}
function indexRole(block: string) {
  const plain = decodeSecHtmlEntities(block.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const role = /^(.+?)\s+\((Filed by|Subject)\)\s+CIK\s*:\s*(\d{1,10})\b/.exec(plain);
  const ciks = [...block.matchAll(/[?&]CIK=(\d{1,10})\b/g)];
  return role && ciks.length === 1 && cik(role[3]) && cik(role[3]) === cik(ciks[0]![1]) ? { role: role[2]!, name: role[1]!, cik: cik(ciks[0]![1]) } : null;
}
function officialArchiveUrl(value: unknown, accession: string): URL | null {
  if (typeof value !== "string" || !/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\//.test(value) || /[?#]/.test(value) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  try {
    const url = new URL(value);
    return new RegExp(`^/Archives/edgar/data/\\d+/${accession.replaceAll("-", "")}/[\\w.-]+$`).test(url.pathname) ? url : null;
  } catch { return null; }
}
function exactlyOne(value: string, pattern: RegExp) { const matches = [...value.matchAll(pattern)]; return matches.length === 1 ? matches[0]![1]!.trim() : null; }
function name(value: unknown) { return text(value).trim().replace(/\s+/g, " ").toUpperCase(); }
function cik(value: unknown) { const candidate = text(value); return /^\d{1,10}$/.test(candidate) && /[1-9]/.test(candidate) ? candidate.padStart(10, "0") : ""; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function isRow(value: unknown): value is Row { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function row(value: unknown): Row { return isRow(value) ? value : {}; }
function hash(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
