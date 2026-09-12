import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export const SECTION_16_XML_PARSER_VERSION = "section16-xml-parser-v1";
export const SECTION_16_XML_FORMS = ["3", "3/A", "5", "5/A"] as const;

export type Section16XmlForm = (typeof SECTION_16_XML_FORMS)[number];
export type Section16XmlFieldStatus = "exact" | "empty" | "footnote_only" | "missing";

export interface Section16XmlField<T = string> {
  xmlPath: string;
  status: Section16XmlFieldStatus;
  value: T | null;
  rawValue: string | null;
  footnoteIds: string[];
}

export interface Section16XmlSource {
  role: "raw_payload.ownership_source_text";
  accessionNumber: string;
  url: string;
  format: "ownership_xml";
  charCount: number;
  sha256: string | null;
  canonicalXml: string;
  unknownElementsPreserved: true;
}

export interface Section16XmlIssuer {
  cik: Section16XmlField;
  name: Section16XmlField;
  tradingSymbol: Section16XmlField;
  foreignTradingSymbol: Section16XmlField;
}

export interface Section16XmlReportingOwner {
  index: number;
  cik: Section16XmlField;
  name: Section16XmlField;
  address: {
    nonUsAddress: Section16XmlField<boolean>;
    street1: Section16XmlField;
    street2: Section16XmlField;
    city: Section16XmlField;
    state: Section16XmlField;
    nonUsStateTerritory: Section16XmlField;
    zipCode: Section16XmlField;
    stateDescription: Section16XmlField;
    country: Section16XmlField;
  };
  relationship: {
    isDirector: Section16XmlField<boolean>;
    isOfficer: Section16XmlField<boolean>;
    isTenPercentOwner: Section16XmlField<boolean>;
    isOther: Section16XmlField<boolean>;
    officerTitle: Section16XmlField;
    otherText: Section16XmlField;
  };
}

export interface Section16XmlTransaction {
  rowKind: "non_derivative" | "derivative";
  rowIndex: number;
  xmlPath: string;
  securityTitle: Section16XmlField;
  transactionFormType: Section16XmlField;
  transactionCode: Section16XmlField;
  transactionTimeliness: Section16XmlField;
  equitySwapInvolved: Section16XmlField<boolean>;
  transactionDate: Section16XmlField;
  deemedExecutionDate: Section16XmlField;
  shares: Section16XmlField;
  transactionTotalValue: Section16XmlField;
  pricePerShare: Section16XmlField;
  acquiredDisposedCode: Section16XmlField;
  postTransactionShares: Section16XmlField;
  postTransactionValue: Section16XmlField;
  directOrIndirectOwnership: Section16XmlField;
  natureOfOwnership: Section16XmlField;
  conversionOrExercisePrice: Section16XmlField;
  exerciseDate: Section16XmlField;
  expirationDate: Section16XmlField;
  underlyingSecurityTitle: Section16XmlField;
  underlyingSecurityShares: Section16XmlField;
  underlyingSecurityValue: Section16XmlField;
  footnoteIds: string[];
}

export interface Section16XmlHolding {
  rowKind: "non_derivative" | "derivative";
  rowIndex: number;
  xmlPath: string;
  securityTitle: Section16XmlField;
  transactionFormType: Section16XmlField;
  amountOwned: Section16XmlField;
  valueOwned: Section16XmlField;
  directOrIndirectOwnership: Section16XmlField;
  natureOfOwnership: Section16XmlField;
  conversionOrExercisePrice: Section16XmlField;
  exerciseDate: Section16XmlField;
  expirationDate: Section16XmlField;
  underlyingSecurityTitle: Section16XmlField;
  underlyingSecurityShares: Section16XmlField;
  underlyingSecurityValue: Section16XmlField;
  footnoteIds: string[];
}

export interface Section16XmlFootnote {
  id: string;
  text: string;
  rawText: string;
}

export interface Section16XmlSignature {
  index: number;
  name: Section16XmlField;
  date: Section16XmlField;
}

export interface Section16XmlParserOutput {
  parserVersion: typeof SECTION_16_XML_PARSER_VERSION;
  parserMode: "xml_only_no_llm";
  formType: Section16XmlForm;
  isAmendment: boolean;
  source: Section16XmlSource;
  filing: {
    filingDate: Section16XmlField;
    acceptedAt: Section16XmlField;
    schemaVersion: Section16XmlField;
    documentType: Section16XmlField;
    periodOfReport: Section16XmlField;
    dateOfOriginalSubmission: Section16XmlField;
    noSecuritiesOwned: Section16XmlField<boolean>;
    form3HoldingsReported: Section16XmlField<boolean>;
    form4TransactionsReported: Section16XmlField<boolean>;
    notSubjectToSection16: Section16XmlField<boolean>;
    aff10b5One: Section16XmlField<boolean>;
    remarks: Section16XmlField;
  };
  issuer: Section16XmlIssuer;
  reportingOwners: Section16XmlReportingOwner[];
  transactions: Section16XmlTransaction[];
  holdings: Section16XmlHolding[];
  footnotes: Section16XmlFootnote[];
  signatures: Section16XmlSignature[];
}

export interface PreservedSection16XmlSource {
  ownership_source_url: string;
  ownership_source_format: "ownership_xml";
  ownership_source_text: string;
  ownership_source_text_char_count: number;
  ownership_source_text_truncated: false;
  ownership_source_sha256: string;
}

export interface Section16XmlSourceInput {
  formType: string;
  sourceUrl: string;
  text: string;
  sha256?: string | null;
}

export interface Section16SecRawItem {
  source_unique_id?: unknown;
  published_at?: unknown;
  raw_payload?: unknown;
}

export class Section16XmlParseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Section16XmlParseError";
    this.code = code;
  }
}

export function preserveSection16XmlSource(input: Section16XmlSourceInput): PreservedSection16XmlSource {
  const formType = requiredSection16Form(input.formType);
  const parsedXml = parseOwnershipDocument(input.text);
  const canonicalXml = parsedXml.rawXml;
  const documentType = scalarField(parsedXml.root, "documentType", "/ownershipDocument/documentType");
  if (documentType.status !== "exact" || documentType.value !== formType) {
    throw new Section16XmlParseError(
      "document_type_mismatch",
      `Section 16 XML documentType ${documentType.value ?? "missing"} does not match ${formType}`,
    );
  }
  requiredOfficialSecArchiveUrl(input.sourceUrl);
  const sha256 = nullableString(input.sha256);
  if (sha256 && !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Section16XmlParseError("invalid_source_sha256", "Section 16 source SHA-256 must contain 64 hexadecimal characters");
  }
  if (sha256 && sha256.toLowerCase() !== sha256Hex(canonicalXml)) {
    throw new Section16XmlParseError("source_sha256_mismatch", "Section 16 source SHA-256 does not match the preserved XML bytes");
  }
  return {
    ownership_source_url: input.sourceUrl,
    ownership_source_format: "ownership_xml",
    ownership_source_text: canonicalXml,
    ownership_source_text_char_count: canonicalXml.length,
    ownership_source_text_truncated: false,
    ownership_source_sha256: sha256 ? sha256.toLowerCase() : sha256Hex(canonicalXml),
  };
}

export function parseSection16XmlFiling(rawItem: Section16SecRawItem): Section16XmlParserOutput {
  const rawPayload = record(rawItem.raw_payload);
  const formType = requiredSection16Form(rawPayload.form_type);
  const accessionNumber = requiredAccession(rawPayload.accession_number);
  const rawIdentity = nullableString(rawItem.source_unique_id);
  if (rawIdentity && rawIdentity !== accessionNumber) {
    throw new Section16XmlParseError("accession_identity_mismatch", "SEC raw item identity does not match its accession number");
  }
  if (rawPayload.ownership_source_text_truncated === true) {
    throw new Section16XmlParseError("truncated_source", "Truncated Section 16 XML is not eligible for parsing");
  }
  if (nullableString(rawPayload.ownership_source_format) !== "ownership_xml") {
    throw new Section16XmlParseError("non_xml_source", "Section 16 parser requires preserved ownership_xml source text");
  }
  const sourceText = requiredSourceText(rawPayload.ownership_source_text);
  const parsedXml = parseOwnershipDocument(sourceText);
  const canonicalXml = parsedXml.rawXml;
  const sourceUrl = requiredOfficialSecArchiveUrl(rawPayload.ownership_source_url, accessionNumber);
  const declaredCharCount = optionalNonNegativeInteger(rawPayload.ownership_source_text_char_count);
  if (declaredCharCount !== null && declaredCharCount !== sourceText.length) {
    throw new Section16XmlParseError("source_length_mismatch", "Preserved Section 16 XML character count does not match its source text");
  }
  const sha256 = nullableString(rawPayload.ownership_source_sha256);
  if (sha256 && !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Section16XmlParseError("invalid_source_sha256", "Section 16 source SHA-256 must contain 64 hexadecimal characters");
  }
  if (sha256 && sha256.toLowerCase() !== sha256Hex(sourceText)) {
    throw new Section16XmlParseError("source_sha256_mismatch", "Section 16 source SHA-256 does not match the preserved XML bytes");
  }

  const root = parsedXml.root;
  const documentType = scalarField(root, "documentType", "/ownershipDocument/documentType");
  if (documentType.status !== "exact" || documentType.value !== formType) {
    throw new Section16XmlParseError(
      "document_type_mismatch",
      `Section 16 XML documentType ${documentType.value ?? "missing"} does not match ${formType}`,
    );
  }

  const issuerBlock = requiredDirectChild(root, "issuer", "issuer_missing");
  const issuerCik = scalarField(issuerBlock, "issuerCik", "/ownershipDocument/issuer/issuerCik");
  const expectedIssuerCik = requiredString(
    rawPayload.ownership_issuer_cik,
    "issuer_identity_missing",
    "Collected SEC ownership issuer CIK is required",
  );
  if (
    issuerCik.status !== "exact"
    || !normalizeCik(issuerCik.value)
    || !normalizeCik(expectedIssuerCik)
    || normalizeCik(issuerCik.value) !== normalizeCik(expectedIssuerCik)
  ) {
    throw new Section16XmlParseError("issuer_cik_mismatch", "Section 16 XML issuer CIK does not match the collected SEC issuer identity");
  }

  const transactionRows = [
    ...parseTransactions(root, "nonDerivativeTransaction", "non_derivative"),
    ...parseTransactions(root, "derivativeTransaction", "derivative"),
  ];
  const holdingRows = [
    ...parseHoldings(root, "nonDerivativeHolding", "non_derivative"),
    ...parseHoldings(root, "derivativeHolding", "derivative"),
  ];
  if (formType.startsWith("3") && transactionRows.length > 0) {
    throw new Section16XmlParseError("form3_transaction_rows", "Form 3 XML cannot be interpreted as transaction rows");
  }

  return {
    parserVersion: SECTION_16_XML_PARSER_VERSION,
    parserMode: "xml_only_no_llm",
    formType,
    isAmendment: formType.endsWith("/A"),
    source: {
      role: "raw_payload.ownership_source_text",
      accessionNumber,
      url: sourceUrl,
      format: "ownership_xml",
      charCount: sourceText.length,
      sha256: sha256 ? sha256.toLowerCase() : null,
      canonicalXml,
      unknownElementsPreserved: true,
    },
    filing: {
      filingDate: metadataField(rawPayload.filing_date, "raw_payload.filing_date"),
      acceptedAt: metadataField(rawPayload.accepted_at, "raw_payload.accepted_at"),
      schemaVersion: scalarField(root, "schemaVersion", "/ownershipDocument/schemaVersion"),
      documentType,
      periodOfReport: scalarField(root, "periodOfReport", "/ownershipDocument/periodOfReport"),
      dateOfOriginalSubmission: scalarField(
        root,
        "dateOfOriginalSubmission",
        "/ownershipDocument/dateOfOriginalSubmission",
      ),
      noSecuritiesOwned: booleanField(root, "noSecuritiesOwned", "/ownershipDocument/noSecuritiesOwned"),
      form3HoldingsReported: booleanField(root, "form3HoldingsReported", "/ownershipDocument/form3HoldingsReported"),
      form4TransactionsReported: booleanField(
        root,
        "form4TransactionsReported",
        "/ownershipDocument/form4TransactionsReported",
      ),
      notSubjectToSection16: booleanField(
        root,
        "notSubjectToSection16",
        "/ownershipDocument/notSubjectToSection16",
      ),
      aff10b5One: booleanField(root, "aff10b5One", "/ownershipDocument/aff10b5One"),
      remarks: scalarField(root, "remarks", "/ownershipDocument/remarks"),
    },
    issuer: {
      cik: issuerCik,
      name: scalarField(issuerBlock, "issuerName", "/ownershipDocument/issuer/issuerName"),
      tradingSymbol: scalarField(issuerBlock, "issuerTradingSymbol", "/ownershipDocument/issuer/issuerTradingSymbol"),
      foreignTradingSymbol: scalarField(
        issuerBlock,
        "issuerForeignTradingSymbol",
        "/ownershipDocument/issuer/issuerForeignTradingSymbol",
      ),
    },
    reportingOwners: parseReportingOwners(root),
    transactions: transactionRows,
    holdings: holdingRows,
    footnotes: parseFootnotes(root),
    signatures: parseSignatures(root),
  };
}

function parseReportingOwners(root: XmlNode): Section16XmlReportingOwner[] {
  return directChildren(root, "reportingOwner").map((block, index) => {
    const base = `/ownershipDocument/reportingOwner[${index}]`;
    const id = optionalDirectChild(block, "reportingOwnerId");
    const address = optionalDirectChild(block, "reportingOwnerAddress");
    const relationship = optionalDirectChild(block, "reportingOwnerRelationship");
    return {
      index,
      cik: scalarField(id, "rptOwnerCik", `${base}/reportingOwnerId/rptOwnerCik`),
      name: scalarField(id, "rptOwnerName", `${base}/reportingOwnerId/rptOwnerName`),
      address: {
        nonUsAddress: booleanField(address, "rptOwnerNonUSAddressFlag", `${base}/reportingOwnerAddress/rptOwnerNonUSAddressFlag`),
        street1: scalarField(address, "rptOwnerStreet1", `${base}/reportingOwnerAddress/rptOwnerStreet1`),
        street2: scalarField(address, "rptOwnerStreet2", `${base}/reportingOwnerAddress/rptOwnerStreet2`),
        city: scalarField(address, "rptOwnerCity", `${base}/reportingOwnerAddress/rptOwnerCity`),
        state: scalarField(address, "rptOwnerState", `${base}/reportingOwnerAddress/rptOwnerState`),
        nonUsStateTerritory: scalarField(
          address,
          "rptOwnerNonUSStateTerritory",
          `${base}/reportingOwnerAddress/rptOwnerNonUSStateTerritory`,
        ),
        zipCode: scalarField(address, "rptOwnerZipCode", `${base}/reportingOwnerAddress/rptOwnerZipCode`),
        stateDescription: scalarField(
          address,
          "rptOwnerStateDescription",
          `${base}/reportingOwnerAddress/rptOwnerStateDescription`,
        ),
        country: scalarField(address, "rptOwnerCountry", `${base}/reportingOwnerAddress/rptOwnerCountry`),
      },
      relationship: {
        isDirector: booleanField(relationship, "isDirector", `${base}/reportingOwnerRelationship/isDirector`),
        isOfficer: booleanField(relationship, "isOfficer", `${base}/reportingOwnerRelationship/isOfficer`),
        isTenPercentOwner: booleanField(
          relationship,
          "isTenPercentOwner",
          `${base}/reportingOwnerRelationship/isTenPercentOwner`,
        ),
        isOther: booleanField(relationship, "isOther", `${base}/reportingOwnerRelationship/isOther`),
        officerTitle: scalarField(relationship, "officerTitle", `${base}/reportingOwnerRelationship/officerTitle`),
        otherText: scalarField(relationship, "otherText", `${base}/reportingOwnerRelationship/otherText`),
      },
    };
  });
}

function parseTransactions(
  root: XmlNode,
  tag: "nonDerivativeTransaction" | "derivativeTransaction",
  rowKind: "non_derivative" | "derivative",
): Section16XmlTransaction[] {
  const tableName = rowKind === "derivative" ? "derivativeTable" : "nonDerivativeTable";
  const table = optionalDirectChild(root, tableName);
  if (!table) return [];
  return directChildren(table, tag).map((block, rowIndex) => {
    const base = `/ownershipDocument/${rowKind === "derivative" ? "derivativeTable" : "nonDerivativeTable"}/${tag}[${rowIndex}]`;
    const coding = optionalDirectChild(block, "transactionCoding");
    const amounts = optionalDirectChild(block, "transactionAmounts");
    const postTransaction = optionalDirectChild(block, "postTransactionAmounts");
    const ownershipNature = optionalDirectChild(block, "ownershipNature");
    const underlyingSecurity = optionalDirectChild(block, "underlyingSecurity");
    return {
      rowKind,
      rowIndex,
      xmlPath: base,
      securityTitle: scalarField(block, "securityTitle", `${base}/securityTitle`),
      transactionFormType: scalarField(coding, "transactionFormType", `${base}/transactionCoding/transactionFormType`),
      transactionCode: scalarField(coding, "transactionCode", `${base}/transactionCoding/transactionCode`),
      transactionTimeliness: scalarField(block, "transactionTimeliness", `${base}/transactionTimeliness`),
      equitySwapInvolved: booleanField(coding, "equitySwapInvolved", `${base}/transactionCoding/equitySwapInvolved`),
      transactionDate: scalarField(block, "transactionDate", `${base}/transactionDate`),
      deemedExecutionDate: scalarField(block, "deemedExecutionDate", `${base}/deemedExecutionDate`),
      shares: scalarField(amounts, "transactionShares", `${base}/transactionAmounts/transactionShares`),
      transactionTotalValue: scalarField(
        rowKind === "derivative" ? amounts : null,
        "transactionTotalValue",
        `${base}/transactionAmounts/transactionTotalValue`,
      ),
      pricePerShare: scalarField(amounts, "transactionPricePerShare", `${base}/transactionAmounts/transactionPricePerShare`),
      acquiredDisposedCode: scalarField(
        amounts,
        "transactionAcquiredDisposedCode",
        `${base}/transactionAmounts/transactionAcquiredDisposedCode`,
      ),
      postTransactionShares: scalarField(
        postTransaction,
        "sharesOwnedFollowingTransaction",
        `${base}/postTransactionAmounts/sharesOwnedFollowingTransaction`,
      ),
      postTransactionValue: scalarField(
        postTransaction,
        "valueOwnedFollowingTransaction",
        `${base}/postTransactionAmounts/valueOwnedFollowingTransaction`,
      ),
      directOrIndirectOwnership: scalarField(
        ownershipNature,
        "directOrIndirectOwnership",
        `${base}/ownershipNature/directOrIndirectOwnership`,
      ),
      natureOfOwnership: scalarField(ownershipNature, "natureOfOwnership", `${base}/ownershipNature/natureOfOwnership`),
      conversionOrExercisePrice: scalarField(block, "conversionOrExercisePrice", `${base}/conversionOrExercisePrice`),
      exerciseDate: scalarField(block, "exerciseDate", `${base}/exerciseDate`),
      expirationDate: scalarField(block, "expirationDate", `${base}/expirationDate`),
      underlyingSecurityTitle: scalarField(
        underlyingSecurity,
        "underlyingSecurityTitle",
        `${base}/underlyingSecurity/underlyingSecurityTitle`,
      ),
      underlyingSecurityShares: scalarField(
        underlyingSecurity,
        "underlyingSecurityShares",
        `${base}/underlyingSecurity/underlyingSecurityShares`,
      ),
      underlyingSecurityValue: scalarField(
        underlyingSecurity,
        "underlyingSecurityValue",
        `${base}/underlyingSecurity/underlyingSecurityValue`,
      ),
      footnoteIds: footnoteIds(block),
    };
  });
}

function parseHoldings(
  root: XmlNode,
  tag: "nonDerivativeHolding" | "derivativeHolding",
  rowKind: "non_derivative" | "derivative",
): Section16XmlHolding[] {
  const tableName = rowKind === "derivative" ? "derivativeTable" : "nonDerivativeTable";
  const table = optionalDirectChild(root, tableName);
  if (!table) return [];
  return directChildren(table, tag).map((block, rowIndex) => {
    const base = `/ownershipDocument/${rowKind === "derivative" ? "derivativeTable" : "nonDerivativeTable"}/${tag}[${rowIndex}]`;
    const coding = optionalDirectChild(block, "transactionCoding");
    const postTransaction = optionalDirectChild(block, "postTransactionAmounts");
    const ownershipNature = optionalDirectChild(block, "ownershipNature");
    const underlyingSecurity = optionalDirectChild(block, "underlyingSecurity");
    return {
      rowKind,
      rowIndex,
      xmlPath: base,
      securityTitle: scalarField(block, "securityTitle", `${base}/securityTitle`),
      transactionFormType: scalarField(coding, "transactionFormType", `${base}/transactionCoding/transactionFormType`),
      amountOwned: scalarField(
        postTransaction,
        "sharesOwnedFollowingTransaction",
        `${base}/postTransactionAmounts/sharesOwnedFollowingTransaction`,
      ),
      valueOwned: scalarField(
        postTransaction,
        "valueOwnedFollowingTransaction",
        `${base}/postTransactionAmounts/valueOwnedFollowingTransaction`,
      ),
      directOrIndirectOwnership: scalarField(
        ownershipNature,
        "directOrIndirectOwnership",
        `${base}/ownershipNature/directOrIndirectOwnership`,
      ),
      natureOfOwnership: scalarField(ownershipNature, "natureOfOwnership", `${base}/ownershipNature/natureOfOwnership`),
      conversionOrExercisePrice: scalarField(block, "conversionOrExercisePrice", `${base}/conversionOrExercisePrice`),
      exerciseDate: scalarField(block, "exerciseDate", `${base}/exerciseDate`),
      expirationDate: scalarField(block, "expirationDate", `${base}/expirationDate`),
      underlyingSecurityTitle: scalarField(
        underlyingSecurity,
        "underlyingSecurityTitle",
        `${base}/underlyingSecurity/underlyingSecurityTitle`,
      ),
      underlyingSecurityShares: scalarField(
        underlyingSecurity,
        "underlyingSecurityShares",
        `${base}/underlyingSecurity/underlyingSecurityShares`,
      ),
      underlyingSecurityValue: scalarField(
        underlyingSecurity,
        "underlyingSecurityValue",
        `${base}/underlyingSecurity/underlyingSecurityValue`,
      ),
      footnoteIds: footnoteIds(block),
    };
  });
}

function parseFootnotes(root: XmlNode): Section16XmlFootnote[] {
  const container = optionalDirectChild(root, "footnotes");
  if (!container) return [];
  return directChildren(container, "footnote").map((node) => {
    const id = node.attributes.id ?? "";
    return {
      id,
      text: decodedTextContent(node).trim(),
      rawText: rawTextContent(node),
    };
  });
}

function parseSignatures(root: XmlNode): Section16XmlSignature[] {
  return directChildren(root, "ownerSignature").map((block, index) => {
    const base = `/ownershipDocument/ownerSignature[${index}]`;
    return {
      index,
      name: scalarField(block, "signatureName", `${base}/signatureName`),
      date: scalarField(block, "signatureDate", `${base}/signatureDate`),
    };
  });
}

function booleanField(container: XmlNode | null, tag: string, xmlPath: string): Section16XmlField<boolean> {
  const field = scalarField(container, tag, xmlPath);
  if (field.status !== "exact") return { ...field, value: null };
  const normalized = field.value?.toLowerCase();
  if (normalized === "1" || normalized === "true") return { ...field, value: true };
  if (normalized === "0" || normalized === "false") return { ...field, value: false };
  throw new Section16XmlParseError("invalid_boolean", `Invalid SEC boolean at ${xmlPath}`);
}

function scalarField(container: XmlNode | null, tag: string, xmlPath: string): Section16XmlField {
  if (!container) {
    return { xmlPath, status: "missing", value: null, rawValue: null, footnoteIds: [] };
  }
  const matches = directChildren(container, tag);
  if (matches.length > 1) {
    throw new Section16XmlParseError("duplicate_element", `Multiple SEC XML elements found at ${xmlPath}`);
  }
  const element = matches[0];
  if (!element) {
    return { xmlPath, status: "missing", value: null, rawValue: null, footnoteIds: [] };
  }
  const ids = footnoteIds(element);
  const nestedValues = directChildren(element, "value");
  if (nestedValues.length > 1) {
    throw new Section16XmlParseError("duplicate_element", `Multiple SEC XML value elements found at ${xmlPath}`);
  }
  const nestedValue = nestedValues[0];
  const nonFootnoteChildren = element.children.filter((child) => child.localName !== "footnoteId");
  const valueParts = nestedValue
    ? textParts(nestedValue)
    : nonFootnoteChildren.length === 0
      ? directTextParts(element)
      : null;
  if (valueParts === null) {
    return {
      xmlPath,
      status: ids.length ? "footnote_only" : "empty",
      value: null,
      rawValue: null,
      footnoteIds: ids,
    };
  }
  const rawValue = valueParts.map((part) => part.raw).join("");
  const value = valueParts.map((part) => part.cdata ? part.raw : decodeXml(part.raw)).join("").trim();
  if (!value) {
    return {
      xmlPath,
      status: ids.length ? "footnote_only" : "empty",
      value: null,
      rawValue,
      footnoteIds: ids,
    };
  }
  return { xmlPath, status: "exact", value, rawValue, footnoteIds: ids };
}

function metadataField(value: unknown, xmlPath: string): Section16XmlField {
  if (typeof value !== "string") {
    return { xmlPath, status: "missing", value: null, rawValue: null, footnoteIds: [] };
  }
  const trimmed = value.trim();
  return trimmed
    ? { xmlPath, status: "exact", value: trimmed, rawValue: value, footnoteIds: [] }
    : { xmlPath, status: "empty", value: null, rawValue: value, footnoteIds: [] };
}

interface XmlNode {
  localName: string;
  attributes: Record<string, string>;
  namespaceDeclarations: string[];
  namespaceSyntax: boolean;
  children: XmlNode[];
  content: Array<XmlTextPart | XmlNode>;
}

interface XmlTextPart {
  raw: string;
  cdata: boolean;
}

function parseOwnershipDocument(text: string): { root: XmlNode; rawXml: string } {
  if (typeof text !== "string" || !text.trim()) {
    throw new Section16XmlParseError("missing_source", "Section 16 source text is required");
  }
  const validation = XMLValidator.validate(text, { allowBooleanAttributes: false });
  if (validation !== true) {
    const failure = validation as { err?: { code?: string; msg?: string } };
    throw new Section16XmlParseError(
      "malformed_xml",
      `Section 16 XML is not well formed${failure.err?.code ? ` (${failure.err.code})` : ""}: ${failure.err?.msg ?? "validation failed"}`,
    );
  }
  const parsed = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: false,
    commentPropName: "#comment",
    cdataPropName: "#cdata",
  }).parse(text) as Array<Record<string, unknown>>;
  const roots = parsed.flatMap(elementNodesFromPreserveOrderEntry);
  if (roots.length !== 1 || roots[0].localName !== "ownershipDocument") {
    throw new Section16XmlParseError("non_xml_source", "Section 16 source must contain exactly one ownershipDocument XML root");
  }
  if (containsNamespaceSyntax(roots[0])) {
    throw new Section16XmlParseError("unsupported_namespace", "Namespaced Section 16 XML is not supported without a verified SEC ownership namespace contract");
  }
  return { root: roots[0], rawXml: text };
}

function elementNodesFromPreserveOrderEntry(entry: Record<string, unknown>): XmlNode[] {
  const keys = Object.keys(entry).filter((key) => isElementKey(key));
  return keys.map((key) => convertPreserveOrderElement(key, entry));
}

function convertPreserveOrderElement(name: string, entry: Record<string, unknown>): XmlNode {
  const children: XmlNode[] = [];
  const content: Array<XmlTextPart | XmlNode> = [];
  const rawChildren = Array.isArray(entry[name]) ? entry[name] as Array<Record<string, unknown>> : [];
  for (const childEntry of rawChildren) {
    if (Object.prototype.hasOwnProperty.call(childEntry, "#text")) {
      content.push({ raw: String(childEntry["#text"] ?? ""), cdata: false });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(childEntry, "#cdata")) {
      content.push({ raw: preserveOrderText(childEntry["#cdata"]), cdata: true });
      continue;
    }
    const childNodes = elementNodesFromPreserveOrderEntry(childEntry);
    children.push(...childNodes);
    content.push(...childNodes);
  }
  const attributes: Record<string, string> = {};
  const namespaceDeclarations: string[] = [];
  let namespaceSyntax = name.includes(":");
  const rawAttributes = record(entry[":@"]);
  for (const [attributeName, value] of Object.entries(rawAttributes)) {
    const rawName = attributeName.replace(/^@_/, "");
    if (rawName === "xmlns" || rawName.startsWith("xmlns:")) {
      namespaceDeclarations.push(String(value));
      namespaceSyntax = true;
    } else if (rawName.includes(":")) {
      namespaceSyntax = true;
    }
    const normalizedName = localName(rawName);
    if (Object.prototype.hasOwnProperty.call(attributes, normalizedName)) {
      throw new Section16XmlParseError("duplicate_attribute", `SEC XML contains duplicate attribute ${normalizedName}`);
    }
    attributes[normalizedName] = String(value);
  }
  return {
    localName: localName(name),
    attributes,
    namespaceDeclarations,
    namespaceSyntax,
    children,
    content,
  };
}

function preserveOrderText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((entry) => {
    const item = record(entry);
    return Object.prototype.hasOwnProperty.call(item, "#text") ? String(item["#text"] ?? "") : "";
  }).join("");
}

function isElementKey(key: string) {
  return key !== ":@"
    && key !== "#text"
    && key !== "#comment"
    && key !== "#cdata"
    && !key.startsWith("?");
}

function requiredDirectChild(container: XmlNode, tag: string, code: string): XmlNode {
  const matches = directChildren(container, tag);
  if (matches.length === 0) throw new Section16XmlParseError(code, `Required SEC XML ${tag} element is missing`);
  if (matches.length > 1) throw new Section16XmlParseError("duplicate_element", `Multiple SEC XML ${tag} elements are not allowed here`);
  return matches[0];
}

function optionalDirectChild(container: XmlNode, tag: string): XmlNode | null {
  const matches = directChildren(container, tag);
  if (matches.length > 1) {
    throw new Section16XmlParseError("duplicate_element", `Multiple SEC XML ${tag} elements are not allowed here`);
  }
  return matches[0] ?? null;
}

function directChildren(container: XmlNode, tag: string): XmlNode[] {
  return container.children.filter((child) => child.localName === tag);
}

function descendants(container: XmlNode, tag: string): XmlNode[] {
  const matches: XmlNode[] = [];
  for (const child of container.children) {
    if (child.localName === tag) matches.push(child);
    matches.push(...descendants(child, tag));
  }
  return matches;
}

function containsNamespaceSyntax(node: XmlNode): boolean {
  return node.namespaceSyntax || node.children.some(containsNamespaceSyntax);
}

function isXmlTextPart(part: XmlTextPart | XmlNode): part is XmlTextPart {
  return "raw" in part;
}

function directTextParts(node: XmlNode): XmlTextPart[] {
  return node.content.filter(isXmlTextPart);
}

function textParts(node: XmlNode): XmlTextPart[] {
  return node.content.flatMap((part) => isXmlTextPart(part) ? [part] : textParts(part));
}

function rawTextContent(node: XmlNode): string {
  return textParts(node).map((part) => part.raw).join("");
}

function decodedTextContent(node: XmlNode): string {
  return textParts(node).map((part) => part.cdata ? part.raw : decodeXml(part.raw)).join("");
}

function footnoteIds(node: XmlNode): string[] {
  return [...new Set(descendants(node, "footnoteId").map((item) => item.attributes.id).filter(Boolean))];
}

function localName(qName: string): string {
  return qName.includes(":") ? qName.slice(qName.lastIndexOf(":") + 1) : qName;
}

function requiredOfficialSecArchiveUrl(value: unknown, accessionNumber?: string): string {
  const urlText = requiredString(value, "invalid_source_url", "Official SEC source URL is required");
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new Section16XmlParseError("invalid_source_url", "Section 16 source URL is invalid");
  }
  if (url.protocol !== "https:" || !/^(?:www\.)?sec\.gov$/i.test(url.hostname)) {
    throw new Section16XmlParseError("invalid_source_url", "Section 16 source URL must use official SEC HTTPS archives");
  }
  const archive = /^\/Archives\/edgar\/data\/\d+\/(\d{18})\//i.exec(url.pathname);
  if (!archive || /\/xsl/i.test(url.pathname) || !/\.(?:xml|txt)$/i.test(url.pathname)) {
    throw new Section16XmlParseError("invalid_source_url", "Section 16 source URL must identify a canonical SEC Archives XML or submission text file");
  }
  if (accessionNumber && archive[1] !== accessionNumber.replace(/-/g, "")) {
    throw new Section16XmlParseError("source_accession_mismatch", "Section 16 SEC source URL does not match the accession number");
  }
  return url.toString();
}

function requiredSection16Form(value: unknown): Section16XmlForm {
  const form = nullableString(value)?.toUpperCase().replace(/\s+/g, "") ?? "";
  if (!SECTION_16_XML_FORMS.includes(form as Section16XmlForm)) {
    throw new Section16XmlParseError("unsupported_form", `Unsupported XML-only Section 16 form: ${form || "missing"}`);
  }
  return form as Section16XmlForm;
}

function requiredAccession(value: unknown): string {
  const accession = requiredString(value, "invalid_accession", "Section 16 accession number is required");
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) {
    throw new Section16XmlParseError("invalid_accession", "Section 16 accession number has an invalid format");
  }
  return accession;
}

function normalizeCik(value: unknown): string | null {
  const cik = nullableString(value);
  if (!cik || !/^\d+$/.test(cik)) return null;
  return cik.replace(/^0+/, "") || "0";
}

function optionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Section16XmlParseError("invalid_source_length", "Section 16 source character count must be a non-negative integer");
  }
  return value;
}

function requiredString(value: unknown, code: string, message: string): string {
  const parsed = nullableString(value);
  if (!parsed) throw new Section16XmlParseError(code, message);
  return parsed;
}

function requiredSourceText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Section16XmlParseError("missing_source", "Preserved Section 16 XML source text is required");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function decodeXml(value: string): string {
  return value.replace(/&(quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "amp") return "&";
    if (normalized.startsWith("#x")) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith("#")) return String.fromCodePoint(Number(normalized.slice(1)));
    return entity;
  });
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
