import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const SC13_STRUCTURAL_PARSER_VERSION = "sc13-structural-xml-v1";
export const SC13_XSD_PACKAGE_VERSION = "2.3";
export const SC13_XML_SCHEMA_VERSION = "X0202";

const SCHEDULE_13D_NAMESPACE = "http://www.sec.gov/edgar/schedule13D";
const SCHEDULE_13G_NAMESPACE = "http://www.sec.gov/edgar/schedule13g";
const SUPPORTED_NAMESPACES = new Map<string, "13D" | "13G">([
  [SCHEDULE_13D_NAMESPACE, "13D"],
  [SCHEDULE_13G_NAMESPACE, "13G"],
] as const);

type XmlObject = Record<string, unknown>;
type NamespaceScope = { defaultNamespace: string | null; prefixes: Map<string, string> };
type XmlElement = {
  localName: string;
  namespace: string | null;
  value: unknown;
  scope: NamespaceScope;
};

class StructuralXmlError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type Sc13ArchiveDirectoryRole =
  | "issuer"
  | "header_filer"
  | "reporting_person"
  | "multiple"
  | "unrelated"
  | "unknown";

export interface Sc13StructuralReporter {
  reportingPersonCikRaw: string | null;
  reportingPersonCikMissingFlagRaw: string | null;
  reportingPersonNameRaw: string;
  memberOfGroupRaw: string | null;
  fundTypesRaw: string[];
  citizenshipOrOrganizationRaw: string | null;
  soleVotingPowerRaw: string | null;
  sharedVotingPowerRaw: string | null;
  soleDispositivePowerRaw: string | null;
  sharedDispositivePowerRaw: string | null;
  aggregateAmountOwnedRaw: string | null;
  aggregateExcludesCertainSharesFlagRaw: string | null;
  percentOfClassRaw: string | null;
  typesOfReportingPersonRaw: string[];
}

export interface Sc13StructuralFiling {
  submissionTypeRaw: string;
  previousAccessionNumberRaw: string | null;
  amendmentNumberRaw: string | null;
  eventDateRaw: string;
  headerFilerCikRaw: string;
  issuer: {
    issuerCikRaw: string;
    issuerNameRaw: string;
    security: { classTitleRaw: string; cusipsRaw: string[] };
  };
  reportingPersons: Sc13StructuralReporter[];
}

export interface Sc13StructuralParseInput {
  rawXml: string | null | undefined;
  sourceFormat: string | null | undefined;
  sourceUrl: string | null | undefined;
  expectedAccessionNumber: string | null | undefined;
  expectedFormType: string | null | undefined;
  sourceTextCharCount?: number | null;
  sourceTextTruncated?: boolean | null;
  indexSubjectCik?: string | null;
  indexSubjectCikCount?: number | null;
  indexFiledByCiks?: string[] | null;
  indexCanonicalXmlUrl?: string | null;
}

export interface Sc13StructuralParseResult {
  parserVersion: typeof SC13_STRUCTURAL_PARSER_VERSION;
  xsdPackageVersion: typeof SC13_XSD_PACKAGE_VERSION;
  status: "parsed" | "unavailable";
  source: {
    url: string | null;
    format: "sec_schedule_13_xml" | null;
    sha256: string | null;
    textCharCount: number;
    preservedTextCharCount: number;
    truncated: boolean;
  };
  provenance: {
    officialSecArchiveUrl: boolean;
    namespace: string | null;
    namespaceStatus: "supported" | "unsupported" | "missing";
    schemaVersionRaw: string | null;
    schemaVersionStatus: "supported" | "unsupported" | "missing";
    expectedAccessionNumber: string | null;
    urlAccessionNumber: string | null;
    accessionStatus: "match" | "mismatch" | "missing";
    urlArchiveDirectoryCikRaw: string | null;
    urlArchiveDirectoryRole: Sc13ArchiveDirectoryRole;
    urlArchiveDirectoryStatus: "matched_known_role" | "unrelated_unverified" | "unknown";
    indexSubjectCikRaw: string | null;
    indexFiledByCiksRaw: string[];
    indexCanonicalXmlUrl: string | null;
    indexStatus: "verified" | "mismatch" | "missing";
  };
  filing: Sc13StructuralFiling | null;
  issues: Array<{ code: string; message: string }>;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Arrays for every element let the contract enforce XSD singleton/repeat cardinality.
  isArray: (_name, _path, _isLeaf, isAttribute) => !isAttribute,
});

export function parseSc13StructuralXml(input: Sc13StructuralParseInput): Sc13StructuralParseResult {
  const rawXml = typeof input.rawXml === "string" ? input.rawXml : "";
  const sourceFormat = nullableTrimmed(input.sourceFormat);
  const sourceUrl = nullableTrimmed(input.sourceUrl);
  const expectedAccessionNumber = normalizeAccessionNumber(input.expectedAccessionNumber);
  const sourceTextCharCount = finiteNonNegativeInteger(input.sourceTextCharCount) ?? rawXml.length;
  const truncated = Boolean(input.sourceTextTruncated) || sourceTextCharCount > rawXml.length;
  const source: Sc13StructuralParseResult["source"] = {
    url: sourceUrl,
    format: sourceFormat === "sec_schedule_13_xml" ? "sec_schedule_13_xml" : null,
    sha256: rawXml ? createHash("sha256").update(rawXml, "utf8").digest("hex") : null,
    textCharCount: sourceTextCharCount,
    preservedTextCharCount: rawXml.length,
    truncated,
  };
  const archiveIdentity = parseSecArchiveUrl(sourceUrl);
  const provenance: Sc13StructuralParseResult["provenance"] = {
    officialSecArchiveUrl: Boolean(archiveIdentity),
    namespace: null,
    namespaceStatus: "missing",
    schemaVersionRaw: null,
    schemaVersionStatus: "missing",
    expectedAccessionNumber,
    urlAccessionNumber: archiveIdentity?.accessionNumber ?? null,
    accessionStatus:
      expectedAccessionNumber && archiveIdentity?.accessionNumber
        ? expectedAccessionNumber === archiveIdentity.accessionNumber ? "match" : "mismatch"
        : "missing",
    urlArchiveDirectoryCikRaw: archiveIdentity?.directoryCik ?? null,
    urlArchiveDirectoryRole: "unknown",
    urlArchiveDirectoryStatus: "unknown",
    indexSubjectCikRaw: nullableTrimmed(input.indexSubjectCik),
    indexFiledByCiksRaw: Array.isArray(input.indexFiledByCiks)
      ? input.indexFiledByCiks.map(nullableTrimmed).filter((value): value is string => Boolean(value))
      : [],
    indexCanonicalXmlUrl: nullableTrimmed(input.indexCanonicalXmlUrl),
    indexStatus: "missing",
  };
  const preflightIssues: Sc13StructuralParseResult["issues"] = [];
  if (!rawXml) preflightIssues.push(issue("missing_raw_xml", "Canonical Schedule 13 XML source is missing."));
  if (sourceFormat !== "sec_schedule_13_xml") {
    preflightIssues.push(issue("invalid_source_format", "Canonical Schedule 13 source format is missing or unsupported."));
  }
  if (truncated) preflightIssues.push(issue("truncated_raw_xml", "Canonical Schedule 13 XML source is truncated."));
  if (!archiveIdentity) preflightIssues.push(issue("invalid_source_url", "Source URL is not an official HTTPS SEC Archives document URL."));
  if (!expectedAccessionNumber) preflightIssues.push(issue("missing_expected_accession", "Expected accession number is missing."));
  if (provenance.accessionStatus === "mismatch") {
    preflightIssues.push(issue("accession_mismatch", "Source URL accession does not match the expected filing accession."));
  } else if (provenance.accessionStatus === "missing") {
    preflightIssues.push(issue("missing_url_accession", "Source URL or expected filing accession is unavailable."));
  }
  if (preflightIssues.length > 0) return unavailable(source, provenance, preflightIssues);
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(rawXml)) {
    return unavailable(source, provenance, [issue("unsafe_xml_declaration", "DOCTYPE and ENTITY declarations are not accepted.")]);
  }

  const validation = XMLValidator.validate(rawXml, { allowBooleanAttributes: false });
  if (validation !== true) {
    return unavailable(source, provenance, [
      issue("malformed_xml", `Canonical Schedule 13 source is not well-formed XML: ${validation.err.msg}`),
    ]);
  }

  try {
    const root = readDocumentRoot(xmlParser.parse(rawXml) as XmlObject);
    if (root.localName !== "edgarSubmission") {
      throw new StructuralXmlError("invalid_root", "Root element must be edgarSubmission.");
    }
    provenance.namespace = root.namespace;
    const scheduleFamily = root.namespace ? SUPPORTED_NAMESPACES.get(root.namespace) ?? null : null;
    provenance.namespaceStatus = root.namespace ? (scheduleFamily ? "supported" : "unsupported") : "missing";
    if (!scheduleFamily) {
      throw new StructuralXmlError("unsupported_namespace", "Schedule 13 XML namespace is missing or unsupported.");
    }

    const schemaVersionRaw = requiredText(requiredChild(root, "schemaVersion"), "schemaVersion");
    provenance.schemaVersionRaw = schemaVersionRaw;
    provenance.schemaVersionStatus = schemaVersionRaw === SC13_XML_SCHEMA_VERSION ? "supported" : "unsupported";
    if (provenance.schemaVersionStatus !== "supported") {
      throw new StructuralXmlError("unsupported_schema_version", `Schedule 13 XML schemaVersion must be ${SC13_XML_SCHEMA_VERSION}.`);
    }

    const headerData = requiredChild(root, "headerData");
    const formData = requiredChild(root, "formData");
    optionalChild(root, "documents");
    const submissionTypeRaw = requiredText(requiredChild(headerData, "submissionType"), "submissionType");
    const expectedSubmissionType = normalizeScheduleSubmissionType(input.expectedFormType);
    const actualSubmissionType = normalizeScheduleSubmissionType(submissionTypeRaw);
    if (!expectedSubmissionType) {
      throw new StructuralXmlError("unsupported_expected_form", "Expected form type is not a supported Schedule 13D/G form.");
    }
    if (!actualSubmissionType || actualSubmissionType !== expectedSubmissionType) {
      throw new StructuralXmlError("form_mismatch", "XML submission type does not match the expected Schedule 13 form.");
    }
    if (!actualSubmissionType.includes(scheduleFamily)) {
      throw new StructuralXmlError("namespace_form_mismatch", "XML namespace does not match its submission type.");
    }

    const previousAccessionNumberRaw = optionalValidatedText(
      optionalChild(headerData, "previousAccessionNumber"),
      "previous accession number",
      /^\d{10}-\d{2}-\d{6}$/,
    );
    const filerInfo = requiredChild(headerData, "filerInfo");
    const filer = requiredChild(filerInfo, "filer");
    const filerCredentials = requiredChild(filer, "filerCredentials");
    const headerFilerCikRaw = requiredValidatedText(requiredChild(filerCredentials, "cik"), "header filer CIK", /^\d{1,10}$/);
    const coverPageHeader = requiredChild(formData, "coverPageHeader");
    const amendmentNumberRaw = optionalValidatedText(optionalChild(coverPageHeader, "amendmentNo"), "amendment number", /^\d{1,3}$/);
    const classTitleRaw = requiredText(requiredChild(coverPageHeader, "securitiesClassTitle"), "security class title");
    const eventDateRaw = requiredValidatedText(
      requiredChild(coverPageHeader, scheduleFamily === "13D" ? "dateOfEvent" : "eventDateRequiresFilingThisStatement"),
      "event date",
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,
    );
    const issuerInfo = requiredChild(coverPageHeader, "issuerInfo");
    const issuerCikRaw = requiredValidatedText(
      requiredChild(issuerInfo, scheduleFamily === "13D" ? "issuerCIK" : "issuerCik"),
      "issuer CIK",
      /^\d{1,10}$/,
    );
    const issuerNameRaw = requiredText(requiredChild(issuerInfo, "issuerName"), "issuer name");
    const issuerCusips = requiredChild(issuerInfo, "issuerCusips");
    const cusipsRaw = repeatedChildren(issuerCusips, "issuerCusipNumber", 1).map((element) => {
      const value = textValue(element, true);
      if (value && !/^[A-Za-z0-9@*#]{9,12}$/.test(value)) {
        throw new StructuralXmlError("invalid_element_value", "issuer CUSIP does not match the v2.3 XSD format.");
      }
      return value;
    });
    const reportingPersons = scheduleFamily === "13D"
      ? parse13dReportingPersons(formData)
      : parse13gReportingPersons(formData);

    provenance.urlArchiveDirectoryRole = classifyArchiveDirectoryRole(
      archiveIdentity!.directoryCik,
      issuerCikRaw,
      headerFilerCikRaw,
      reportingPersons.map((reporter) => reporter.reportingPersonCikRaw),
    );
    provenance.urlArchiveDirectoryStatus = provenance.urlArchiveDirectoryRole === "unrelated"
      ? "unrelated_unverified"
      : "matched_known_role";
    if (provenance.urlArchiveDirectoryStatus !== "matched_known_role") {
      throw new StructuralXmlError(
        "unverified_archive_directory_cik",
        "SEC Archives directory CIK does not match the issuer, header filer, or a reporting person.",
      );
    }

    const indexSubjectCikCount = finiteNonNegativeInteger(input.indexSubjectCikCount);
    const indexSubjectCik = normalizeCik(provenance.indexSubjectCikRaw);
    const indexFiledByCiks = provenance.indexFiledByCiksRaw.map(normalizeCik);
    const indexCanonicalIdentity = parseSecArchiveUrl(provenance.indexCanonicalXmlUrl);
    if (
      indexSubjectCikCount !== 1 ||
      !indexSubjectCik ||
      indexFiledByCiks.length === 0 ||
      indexFiledByCiks.some((cik) => !cik) ||
      !indexCanonicalIdentity
    ) {
      provenance.indexStatus = "missing";
      throw new StructuralXmlError("missing_index_provenance", "Official filing index Subject, Filed by, or canonical XML provenance is incomplete.");
    }
    const indexCanonicalMatchesSource = normalizedSecArchiveUrl(provenance.indexCanonicalXmlUrl) === normalizedSecArchiveUrl(sourceUrl);
    const indexRolesOverlap = indexFiledByCiks.includes(indexSubjectCik);
    if (
      indexSubjectCik !== normalizeCik(issuerCikRaw) ||
      !indexFiledByCiks.includes(normalizeCik(headerFilerCikRaw)) ||
      !indexCanonicalMatchesSource ||
      indexCanonicalIdentity.accessionNumber !== expectedAccessionNumber ||
      indexRolesOverlap
    ) {
      provenance.indexStatus = "mismatch";
      throw new StructuralXmlError(
        "index_provenance_mismatch",
        "Official filing index Subject/Filed by roles or canonical XML link do not match the XML filing identities.",
      );
    }
    provenance.indexStatus = "verified";

    return {
      parserVersion: SC13_STRUCTURAL_PARSER_VERSION,
      xsdPackageVersion: SC13_XSD_PACKAGE_VERSION,
      status: "parsed",
      source,
      provenance,
      filing: {
        submissionTypeRaw,
        previousAccessionNumberRaw,
        amendmentNumberRaw,
        eventDateRaw,
        headerFilerCikRaw,
        issuer: {
          issuerCikRaw,
          issuerNameRaw,
          // XSD v2.3 has one class title with an unbounded CUSIP list. Reporter rows are separate.
          security: { classTitleRaw, cusipsRaw },
        },
        reportingPersons,
      },
      issues: [],
    };
  } catch (error) {
    const structuralError = error instanceof StructuralXmlError
      ? error
      : new StructuralXmlError("xml_parse_error", error instanceof Error ? error.message : String(error));
    return unavailable(source, provenance, [issue(structuralError.code, structuralError.message)]);
  }
}

function parse13dReportingPersons(formData: XmlElement): Sc13StructuralReporter[] {
  const container = requiredChild(formData, "reportingPersons");
  return repeatedChildren(container, "reportingPersonInfo", 1, 100).map((row) => ({
    reportingPersonCikRaw: optionalValidatedText(optionalChild(row, "reportingPersonCIK"), "reporting-person CIK", /^\d{1,10}$/),
    reportingPersonCikMissingFlagRaw: optionalText(optionalChild(row, "reportingPersonNoCIK")),
    reportingPersonNameRaw: requiredText(requiredChild(row, "reportingPersonName"), "reporting-person name"),
    memberOfGroupRaw: optionalText(optionalChild(row, "memberOfGroup")),
    fundTypesRaw: repeatedChildren(row, "fundType", 0, 6).map((element) => textValue(element)),
    citizenshipOrOrganizationRaw: optionalText(optionalChild(row, "citizenshipOrOrganization")),
    soleVotingPowerRaw: optionalDecimalText(optionalChild(row, "soleVotingPower"), "sole voting power"),
    sharedVotingPowerRaw: optionalDecimalText(optionalChild(row, "sharedVotingPower"), "shared voting power"),
    soleDispositivePowerRaw: optionalDecimalText(optionalChild(row, "soleDispositivePower"), "sole dispositive power"),
    sharedDispositivePowerRaw: optionalDecimalText(optionalChild(row, "sharedDispositivePower"), "shared dispositive power"),
    aggregateAmountOwnedRaw: optionalDecimalText(optionalChild(row, "aggregateAmountOwned"), "aggregate amount owned"),
    aggregateExcludesCertainSharesFlagRaw: optionalText(optionalChild(row, "isAggregateExcludeShares")),
    percentOfClassRaw: optionalPercentText(optionalChild(row, "percentOfClass"), "percent of class"),
    typesOfReportingPersonRaw: repeatedChildren(row, "typeOfReportingPerson", 0, 13).map((element) => textValue(element)),
  }));
}

function parse13gReportingPersons(formData: XmlElement): Sc13StructuralReporter[] {
  return repeatedChildren(formData, "coverPageHeaderReportingPersonDetails", 1, 100).map((row) => {
    const votingPower = optionalChild(row, "reportingPersonBeneficiallyOwnedNumberOfShares");
    return {
      reportingPersonCikRaw: optionalValidatedText(optionalChild(row, "reportingCik"), "reporting-person CIK", /^\d{1,10}$/),
      reportingPersonCikMissingFlagRaw: optionalText(optionalChild(row, "reportingCikNotPresentInEdgarFlag")),
      reportingPersonNameRaw: requiredText(requiredChild(row, "reportingPersonName"), "reporting-person name"),
      memberOfGroupRaw: optionalText(optionalChild(row, "memberGroup")),
      fundTypesRaw: [],
      citizenshipOrOrganizationRaw: optionalText(optionalChild(row, "citizenshipOrOrganization")),
      soleVotingPowerRaw: votingPower ? optionalDecimalText(optionalChild(votingPower, "soleVotingPower"), "sole voting power") : null,
      sharedVotingPowerRaw: votingPower ? optionalDecimalText(optionalChild(votingPower, "sharedVotingPower"), "shared voting power") : null,
      soleDispositivePowerRaw: votingPower ? optionalDecimalText(optionalChild(votingPower, "soleDispositivePower"), "sole dispositive power") : null,
      sharedDispositivePowerRaw: votingPower ? optionalDecimalText(optionalChild(votingPower, "sharedDispositivePower"), "shared dispositive power") : null,
      aggregateAmountOwnedRaw: optionalDecimalText(optionalChild(row, "reportingPersonBeneficiallyOwnedAggregateNumberOfShares"), "aggregate amount owned"),
      aggregateExcludesCertainSharesFlagRaw: optionalText(optionalChild(row, "aggregateAmountExcludesCertainSharesFlag")),
      percentOfClassRaw: optionalPercentText(optionalChild(row, "classPercent"), "percent of class"),
      typesOfReportingPersonRaw: repeatedChildren(row, "typeOfReportingPerson", 0, 14).map((element) => textValue(element)),
    };
  });
}

function readDocumentRoot(document: XmlObject): XmlElement {
  const roots = Object.entries(document).filter(([name]) => !name.startsWith("?") && !name.startsWith("#") && !name.startsWith("@_"));
  if (roots.length !== 1) throw new StructuralXmlError("invalid_root_count", "XML must contain exactly one document root.");
  const [qualifiedName, values] = roots[0]!;
  if (!Array.isArray(values) || values.length !== 1) {
    throw new StructuralXmlError("invalid_root_count", "XML must contain exactly one document root.");
  }
  return makeElement(qualifiedName, values[0], { defaultNamespace: null, prefixes: new Map() });
}

function requiredChild(parent: XmlElement, localName: string): XmlElement {
  const children = matchingChildren(parent, localName);
  if (children.length !== 1) {
    throw new StructuralXmlError(
      children.length === 0 ? "missing_required_element" : "duplicate_singleton_element",
      `${localName} must occur exactly once under ${parent.localName}.`,
    );
  }
  return children[0]!;
}

function optionalChild(parent: XmlElement, localName: string): XmlElement | null {
  const children = matchingChildren(parent, localName);
  if (children.length > 1) {
    throw new StructuralXmlError("duplicate_singleton_element", `${localName} may occur at most once under ${parent.localName}.`);
  }
  return children[0] ?? null;
}

function repeatedChildren(parent: XmlElement, localName: string, min: number, max = Number.POSITIVE_INFINITY): XmlElement[] {
  const children = matchingChildren(parent, localName);
  if (children.length < min || children.length > max) {
    throw new StructuralXmlError(
      "invalid_element_cardinality",
      `${localName} occurrence count ${children.length} is outside ${min}..${Number.isFinite(max) ? max : "unbounded"}.`,
    );
  }
  return children;
}

function matchingChildren(parent: XmlElement, localName: string): XmlElement[] {
  const object = asObject(parent.value);
  if (!object) return [];
  const children: XmlElement[] = [];
  for (const [qualifiedName, rawValues] of Object.entries(object)) {
    if (qualifiedName.startsWith("?") || qualifiedName.startsWith("#") || qualifiedName.startsWith("@_")) continue;
    if (qualifiedName.split(":").pop() !== localName) continue;
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    for (const rawValue of values) {
      const child = makeElement(qualifiedName, rawValue, parent.scope);
      if (child.namespace !== parent.namespace) {
        throw new StructuralXmlError("foreign_namespace_element", `${localName} under ${parent.localName} is in an unexpected namespace.`);
      }
      children.push(child);
    }
  }
  return children;
}

function makeElement(qualifiedName: string, value: unknown, parentScope: NamespaceScope): XmlElement {
  const scope = applyNamespaceDeclarations(parentScope, asObject(value));
  const separator = qualifiedName.indexOf(":");
  const prefix = separator >= 0 ? qualifiedName.slice(0, separator) : null;
  const localName = separator >= 0 ? qualifiedName.slice(separator + 1) : qualifiedName;
  const namespace = prefix ? scope.prefixes.get(prefix) ?? null : scope.defaultNamespace;
  return { localName, namespace, value, scope };
}

function applyNamespaceDeclarations(parentScope: NamespaceScope, value: XmlObject | null): NamespaceScope {
  const scope = { defaultNamespace: parentScope.defaultNamespace, prefixes: new Map(parentScope.prefixes) };
  if (!value) return scope;
  for (const [name, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "string") continue;
    if (name === "@_xmlns") scope.defaultNamespace = rawValue || null;
    else if (name.startsWith("@_xmlns:")) scope.prefixes.set(name.slice("@_xmlns:".length), rawValue);
  }
  return scope;
}

function requiredText(element: XmlElement, label: string): string {
  const value = textValue(element);
  if (!value) throw new StructuralXmlError("missing_required_value", `${label} value is missing.`);
  return value;
}

function optionalText(element: XmlElement | null): string | null {
  return element ? textValue(element) || null : null;
}

function requiredValidatedText(element: XmlElement, label: string, pattern: RegExp): string {
  const value = requiredText(element, label);
  if (!pattern.test(value)) throw new StructuralXmlError("invalid_element_value", `${label} has an invalid format.`);
  return value;
}

function optionalValidatedText(element: XmlElement | null, label: string, pattern: RegExp): string | null {
  const value = optionalText(element);
  if (value !== null && !pattern.test(value)) {
    throw new StructuralXmlError("invalid_element_value", `${label} has an invalid format.`);
  }
  return value;
}

function optionalDecimalText(element: XmlElement | null, label: string): string | null {
  return optionalValidatedText(element, label, /^\d+(?:\.\d{1,2})?$/);
}

function optionalPercentText(element: XmlElement | null, label: string): string | null {
  const value = optionalDecimalText(element, label);
  if (value !== null && Number(value) > 100) {
    throw new StructuralXmlError("invalid_element_value", `${label} is outside the XSD range.`);
  }
  return value;
}

function textValue(element: XmlElement, allowEmpty = false): string {
  if (typeof element.value === "string") return element.value.trim();
  const object = asObject(element.value);
  if (!object) return "";
  const childNames = Object.keys(object).filter((name) => !name.startsWith("?") && !name.startsWith("#") && !name.startsWith("@_"));
  if (childNames.length > 0) {
    throw new StructuralXmlError("unexpected_nested_element", `${element.localName} must contain text only.`);
  }
  const text = typeof object["#text"] === "string" ? object["#text"].trim() : "";
  return text || (allowEmpty ? "" : "");
}

function unavailable(
  source: Sc13StructuralParseResult["source"],
  provenance: Sc13StructuralParseResult["provenance"],
  issues: Sc13StructuralParseResult["issues"],
): Sc13StructuralParseResult {
  return {
    parserVersion: SC13_STRUCTURAL_PARSER_VERSION,
    xsdPackageVersion: SC13_XSD_PACKAGE_VERSION,
    status: "unavailable",
    source,
    provenance,
    filing: null,
    issues,
  };
}

function issue(code: string, message: string) {
  return { code, message };
}

function parseSecArchiveUrl(sourceUrl: string | null) {
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || !/^(?:www\.)?sec\.gov$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/Archives\/edgar\/data\/(\d{1,10})\/(\d{18})\/[^/]+$/i);
    if (!match) return null;
    return { directoryCik: match[1]!, accessionNumber: dashedAccession(match[2]!) };
  } catch {
    return null;
  }
}

function normalizedSecArchiveUrl(sourceUrl: string | null): string | null {
  if (!parseSecArchiveUrl(sourceUrl)) return null;
  const url = new URL(sourceUrl!);
  return `${url.hostname.toLowerCase()}${url.pathname}`;
}

function classifyArchiveDirectoryRole(
  directoryCik: string,
  issuerCik: string | null,
  headerFilerCik: string | null,
  reporterCiks: Array<string | null>,
): Sc13ArchiveDirectoryRole {
  const normalizedDirectory = normalizeCik(directoryCik);
  if (!normalizedDirectory) return "unknown";
  const roles = new Set<string>();
  if (normalizeCik(issuerCik) === normalizedDirectory) roles.add("issuer");
  if (normalizeCik(headerFilerCik) === normalizedDirectory) roles.add("header_filer");
  if (reporterCiks.some((cik) => normalizeCik(cik) === normalizedDirectory)) roles.add("reporting_person");
  if (roles.size > 1) return "multiple";
  if (roles.has("issuer")) return "issuer";
  if (roles.has("header_filer")) return "header_filer";
  if (roles.has("reporting_person")) return "reporting_person";
  return "unrelated";
}

function normalizeScheduleSubmissionType(value: unknown): string | null {
  const normalized = nullableTrimmed(value)?.toUpperCase().replace(/^SC\s+/, "SCHEDULE ");
  return /^(?:SCHEDULE 13D|SCHEDULE 13D\/A|SCHEDULE 13G|SCHEDULE 13G\/A)$/.test(normalized ?? "")
    ? normalized!
    : null;
}

function normalizeAccessionNumber(value: unknown): string | null {
  const raw = nullableTrimmed(value) ?? "";
  if (!/^(?:\d{18}|\d{10}-\d{2}-\d{6})$/.test(raw)) return null;
  const digits = raw.replace(/-/g, "");
  return digits.length === 18 ? dashedAccession(digits) : null;
}

function dashedAccession(digits: string) {
  return `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

function normalizeCik(value: unknown): string | null {
  const digits = nullableTrimmed(value) ?? "";
  if (!/^\d{1,10}$/.test(digits)) return null;
  return digits.replace(/^0+(?=\d)/, "");
}

function nullableTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asObject(value: unknown): XmlObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as XmlObject : null;
}
