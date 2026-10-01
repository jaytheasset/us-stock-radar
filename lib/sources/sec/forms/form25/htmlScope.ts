import type { SecForm25Field, SecForm25ParserOutput } from "./parser.ts";
import type { Form25OriginalDocument } from "./storedSource.ts";

/** Narrow standard Form25 HTML cover support. A same-accession submission
 * header proves the issuer-filed identity; labelled HTML proves class/venue.
 * This does not manufacture XML, infer a venue, or establish an effective date. */
export function readForm25HtmlScope(input: {
  accession: string; form: string; primary: Form25OriginalDocument;
  documents: Form25OriginalDocument[]; parsed: SecForm25ParserOutput;
  project: (source: string) => string;
}) {
  const { primary, documents, parsed, project } = input;
  const none = null;
  if (!/^(25|25-NSE)(\/A)?$/.test(input.form) || !/<html\b/i.test(primary.text)) return none;
  const submissions = documents.filter(doc => /<SEC-HEADER>/i.test(doc.text));
  if (submissions.length !== 1) return none;
  const submission = submissions[0];
  const headers = [...submission.text.matchAll(/<SEC-HEADER>([\s\S]*?)<\/SEC-HEADER>/gi)];
  if (headers.length !== 1) return none;
  const header = headers[0][1];
  const value = (label: string) => {
    const matches = [...header.matchAll(new RegExp(`^\\s*${label}:\\s*([^\\r\\n]+)`, "gmi"))];
    return matches.length === 1 ? matches[0][1].trim() : null;
  };
  const issuerName = value("COMPANY CONFORMED NAME");
  const issuerCik = value("CENTRAL INDEX KEY");
  const issuerEvidence = header.match(/COMPANY CONFORMED NAME:[^\r\n]+[\r\n]+\s*CENTRAL INDEX KEY:[^\r\n]+/)?.[0];
  if (value("ACCESSION NUMBER") !== input.accession || value("CONFORMED SUBMISSION TYPE") !== input.form
    || (header.match(/^FILER:\s*$/gm) || []).length !== 1 || /^SUBJECT COMPANY:|^FILED BY:/m.test(header)
    || !issuerName || !issuerCik || !issuerEvidence || !/^\d{1,10}$/.test(issuerCik) || /^0+$/.test(issuerCik)) return none;
  if ([primary, submission].some(doc => new URL(doc.url).pathname.split("/")[4]?.padStart(10, "0") !== issuerCik.padStart(10, "0"))) return none;

  // The retained primary must be the exact textual content of the document
  // named in that same submission, not a different exhibit or filing's header.
  const named = [...submission.text.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi)].filter(match =>
    match[1].match(/<FILENAME>\s*([^\r\n<]+)/i)?.[1].trim() === new URL(primary.url).pathname.split("/").at(-1));
  if (named.length !== 1 || named[0][1].match(/<TYPE>\s*([^\r\n<]+)/i)?.[1].trim() !== input.form
    || project(named[0][0]) !== project(primary.text)) return none;
  const text = project(primary.text);
  const labels = [...text.matchAll(/([^\n]+)\n\(Exact name of Issuer as specified in its charter, and name of Exchange\s+where security is listed and\/or registered\)/gi)];
  const securityLabels = [...text.matchAll(/([^\n]+)\n\(Description of class of securities\)/gi)];
  if (labels.length !== 1 || securityLabels.length !== 1) return none;
  const label = labels[0][1].trim();
  // Header-name prefix makes the split explicit even if the issuer has commas.
  if (!label.startsWith(`${issuerName}, `)) return none;
  const exchange = label.slice(issuerName.length + 2).trim();
  const security = securityLabels[0][1].trim();
  if (!exchange || exchange.length > 180 || /;|\/|\band\b/i.test(exchange)) return none;

  // FILER is the subject issuer only for the explicitly checked issuer-filed
  // voluntary-withdrawal provision. An exchange-filed notice needs other proof.
  const checks = [...text.matchAll(/[☒☑]|\[\s*X\s*\]/gi)];
  const rule = parsed.facts.rule_provision;
  if (checks.length !== 1 || !/^\s*\|?\s*Pursuant to 17 CFR 240\.12d2-2\(c\),/i.test(text.slice(checks[0].index! + checks[0][0].length))
    || rule?.value !== "17 CFR 240.12d2-2(c)" || rule.source !== "primary_filing_text"
    || parsed.facts.issuer_name?.value !== issuerName
    || parsed.facts.subject_company_cik?.value?.padStart(10, "0") !== issuerCik.padStart(10, "0")
    || parsed.facts.removed_security?.value !== security
    || parsed.facts.exchange && parsed.facts.exchange.value !== exchange) return none;

  const field = (value: string, evidence: string, source: string): SecForm25Field<string> =>
    ({ value, evidence, source, confidence: "high" });
  return {
    issuer_name: field(issuerName, labels[0][0], "primary_filing_text.html.issuer_exchange_label"),
    subject_company_cik: field(issuerCik, issuerEvidence,
      `${submission.url}#SEC-HEADER.FILER.COMPANY_DATA`),
    removed_security: field(security, securityLabels[0][0], "primary_filing_text.html.description_class_security"),
    exchange: field(exchange, labels[0][0], "primary_filing_text.html.issuer_exchange_label"),
  };
}
