import { createHash } from "node:crypto";

import {
  parseSection16XmlFiling,
  Section16XmlParseError,
  type Section16SecRawItem,
  type Section16XmlField,
  type Section16XmlHolding,
  type Section16XmlParserOutput,
  type Section16XmlReportingOwner,
  type Section16XmlSignature,
  type Section16XmlTransaction,
} from "../sources/sec/forms/section16Xml/parser.ts";

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const SECTION_16_FORM_PATTERN = /^(?:3|3\/A|5|5\/A)$/;

type Row = Record<string, unknown>;

export class Section16CanonicalSourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "Section16CanonicalSourceError";
    this.code = code;
  }
}

export type Section16CanonicalPayload = Readonly<{
  filing: Row;
  reportingOwners: Row[];
  transactions: Row[];
  holdings: Row[];
  footnotes: Row[];
  signatures: Row[];
  parsed: Section16XmlParserOutput;
}>;

export type Section16CanonicalStoredRows = Readonly<{
  filing: Row;
  reportingOwners: Row[];
  transactions: Row[];
  holdings: Row[];
  footnotes: Row[];
  signatures: Row[];
}>;

export function isSection16XmlRawItem(rawItem: Row): boolean {
  return SECTION_16_FORM_PATTERN.test(normalizedFormType(record(rawItem.raw_payload).form_type));
}

export function buildSection16CanonicalPayload(rawItemId: string, rawItem: Row): Section16CanonicalPayload | null {
  const rawPayload = record(rawItem.raw_payload);
  const formType = normalizedFormType(rawPayload.form_type);
  if (!SECTION_16_FORM_PATTERN.test(formType)) return null;
  if (!uuidLike(rawItemId)) {
    throw new Section16CanonicalSourceError("raw_item_identity_invalid", "Section 16 raw item ID must be a UUID");
  }

  let parsed: Section16XmlParserOutput;
  try {
    parsed = parseSection16XmlFiling(rawItem as Section16SecRawItem);
  } catch (error) {
    if (error instanceof Section16XmlParseError) {
      throw new Section16CanonicalSourceError(error.code, error.message);
    }
    throw error;
  }

  const accessionNumber = parsed.source.accessionNumber;
  if (requiredAccession(rawItem.source_unique_id, "raw item source identity") !== accessionNumber) {
    throw new Section16CanonicalSourceError(
      "accession_mismatch",
      "Section 16 raw item identity does not match the parsed accession",
    );
  }
  if (stringValue(rawItem.source_code) !== "sec_edgar" || stringValue(rawItem.source_group) !== "filings") {
    throw new Section16CanonicalSourceError(
      "source_identity_mismatch",
      "Section 16 canonical persistence requires a stored SEC filings raw item",
    );
  }
  if (
    parsed.source.format !== "ownership_xml"
    || parsed.source.role !== "raw_payload.ownership_source_text"
    || !parsed.source.unknownElementsPreserved
    || !parsed.source.canonicalXml
  ) {
    throw new Section16CanonicalSourceError(
      "source_verification_failed",
      "Section 16 canonical persistence requires complete preserved ownership XML",
    );
  }

  const sourceSha256 = sha256(parsed.source.canonicalXml);
  if (parsed.source.sha256 && parsed.source.sha256 !== sourceSha256) {
    throw new Section16CanonicalSourceError("source_hash_mismatch", "Section 16 parsed source hash does not match its XML");
  }
  const issuerCikRaw = exactFieldValue(parsed.issuer.cik, "issuer CIK");
  const issuerCik = normalizeCik(issuerCikRaw);
  if (!issuerCik) {
    throw new Section16CanonicalSourceError("issuer_identity_invalid", "Section 16 issuer CIK is invalid");
  }

  const filing: Row = {
    accession_number: accessionNumber,
    raw_item_id: rawItemId,
    form_type_raw: parsed.formType,
    is_amendment: parsed.isAmendment,
    issuer_cik_raw: issuerCikRaw,
    issuer_cik: issuerCik,
    issuer_name_raw: rawFieldValue(parsed.issuer.name),
    trading_symbol_raw: rawFieldValue(parsed.issuer.tradingSymbol),
    foreign_trading_symbol_raw: rawFieldValue(parsed.issuer.foreignTradingSymbol),
    filing_date_raw: rawFieldValue(parsed.filing.filingDate),
    accepted_at_raw: rawFieldValue(parsed.filing.acceptedAt),
    period_of_report_raw: rawFieldValue(parsed.filing.periodOfReport),
    date_of_original_submission_raw: rawFieldValue(parsed.filing.dateOfOriginalSubmission),
    source_url: parsed.source.url,
    source_sha256: sourceSha256,
    raw_xml: parsed.source.canonicalXml,
    raw_xml_char_count: parsed.source.canonicalXml.length,
    raw_xml_utf8_byte_count: Buffer.byteLength(parsed.source.canonicalXml, "utf8"),
    parser_version: parsed.parserVersion,
    parser_mode: parsed.parserMode,
    source_payload: parsed.source,
    filing_payload: parsed.filing,
    issuer_payload: parsed.issuer,
    parser_payload: parsed,
  };
  filing.payload_sha256 = section16PayloadFingerprint(parsed);

  return {
    filing,
    reportingOwners: parsed.reportingOwners.map((owner) => reportingOwnerPayload(accessionNumber, owner)),
    transactions: parsed.transactions.map((transaction, rowOrdinal) => transactionPayload(accessionNumber, transaction, rowOrdinal)),
    holdings: parsed.holdings.map((holding, rowOrdinal) => holdingPayload(accessionNumber, holding, rowOrdinal)),
    footnotes: parsed.footnotes.map((footnote, index) => ({
      accession_number: accessionNumber,
      footnote_index: index,
      footnote_id: footnote.id,
      text_value: footnote.text,
      raw_text: footnote.rawText,
      structural_payload: footnote,
    })),
    signatures: parsed.signatures.map((signature) => signaturePayload(accessionNumber, signature)),
    parsed,
  };
}

export function assertSection16CallerMatchesStored(callerRawItem: Row, storedRawItem: Row): void {
  const callerPayload = sourceIdentity(callerRawItem);
  const storedPayload = sourceIdentity(storedRawItem);
  if (stableStringify(callerPayload) !== stableStringify(storedPayload)) {
    throw new Section16CanonicalSourceError(
      "stored_source_mismatch",
      "Section 16 persistence input does not match the stored raw item source",
    );
  }
}

export function validateSection16CanonicalRead(
  rows: Section16CanonicalStoredRows,
): { ok: true; parsed: Section16XmlParserOutput } | { ok: false; reason: string } {
  try {
    const filing = rows.filing;
    const accessionNumber = requiredAccession(filing.accession_number, "stored accession");
    if (!uuidLike(stringValue(filing.raw_item_id))) {
      return { ok: false, reason: "raw_item_identity_invalid" };
    }
    const rawXml = requiredString(filing.raw_xml, "stored raw XML");
    if (sha256(rawXml) !== requiredString(filing.source_sha256, "stored source SHA-256")) {
      return { ok: false, reason: "source_hash_mismatch" };
    }
    if (Number(filing.raw_xml_char_count) !== rawXml.length) {
      return { ok: false, reason: "source_length_mismatch" };
    }
    if (Number(filing.raw_xml_utf8_byte_count) !== Buffer.byteLength(rawXml, "utf8")) {
      return { ok: false, reason: "source_byte_length_mismatch" };
    }

    const parsed = parseSection16XmlFiling({
      source_unique_id: accessionNumber,
      raw_payload: {
        form_type: requiredString(filing.form_type_raw, "stored form type"),
        accession_number: accessionNumber,
        ownership_issuer_cik: requiredString(filing.issuer_cik_raw, "stored issuer CIK"),
        filing_date: filing.filing_date_raw,
        accepted_at: filing.accepted_at_raw,
        ownership_source_url: requiredString(filing.source_url, "stored source URL"),
        ownership_source_format: "ownership_xml",
        ownership_source_text: rawXml,
        ownership_source_text_char_count: Number(filing.raw_xml_char_count),
        ownership_source_text_truncated: false,
        ...(nullableString(record(filing.source_payload).sha256)
          ? { ownership_source_sha256: requiredString(filing.source_sha256, "stored source SHA-256") }
          : {}),
      },
    });

    if (stableStringify(record(filing.parser_payload)) !== stableStringify(parsed)) {
      return { ok: false, reason: "parser_payload_mismatch" };
    }
    if (!filingColumnsMatch(filing, parsed)) {
      return { ok: false, reason: "filing_columns_mismatch" };
    }
    if (requiredString(filing.payload_sha256, "stored payload SHA-256") !== section16PayloadFingerprint(parsed)) {
      return { ok: false, reason: "payload_hash_mismatch" };
    }

    const childChecks: Array<[Row[], readonly unknown[], string, (row: Row, parsedRow: unknown) => boolean]> = [
      [rows.reportingOwners, parsed.reportingOwners, "reporting_owner", reportingOwnerColumnsMatch],
      [rows.transactions, parsed.transactions, "transaction", transactionColumnsMatch],
      [rows.holdings, parsed.holdings, "holding", holdingColumnsMatch],
      [rows.footnotes, parsed.footnotes, "footnote", footnoteColumnsMatch],
      [rows.signatures, parsed.signatures, "signature", signatureColumnsMatch],
    ];
    for (const [storedRows, parsedRows, label, columnsMatch] of childChecks) {
      if (storedRows.length !== parsedRows.length) return { ok: false, reason: `${label}_count_mismatch` };
      for (const [index, parsedRow] of parsedRows.entries()) {
        const stored = storedRows[index];
        if (!stored || stored.accession_number !== accessionNumber || childOrdinal(stored, label) !== index) {
          return { ok: false, reason: `${label}_identity_mismatch` };
        }
        if (stableStringify(record(stored.structural_payload)) !== stableStringify(parsedRow)) {
          return { ok: false, reason: `${label}_payload_mismatch` };
        }
        if (!columnsMatch(stored, parsedRow)) return { ok: false, reason: `${label}_columns_mismatch` };
      }
    }
    return { ok: true, parsed };
  } catch {
    return { ok: false, reason: "stored_payload_invalid" };
  }
}

export function section16PayloadFingerprint(value: unknown): string {
  return sha256(stableStringify(value));
}

function sourceIdentity(rawItem: Row) {
  const rawPayload = record(rawItem.raw_payload);
  const rawXml = rawString(rawPayload.ownership_source_text);
  return {
    sourceCode: stringValue(rawItem.source_code),
    sourceGroup: stringValue(rawItem.source_group),
    sourceUniqueId: stringValue(rawItem.source_unique_id),
    accessionNumber: stringValue(rawPayload.accession_number),
    formType: normalizedFormType(rawPayload.form_type),
    issuerCik: normalizeCik(rawPayload.ownership_issuer_cik),
    sourceUrl: stringValue(rawPayload.ownership_source_url),
    sourceFormat: stringValue(rawPayload.ownership_source_format),
    sourceText: rawXml,
    sourceTextCharCount: rawPayload.ownership_source_text_char_count,
    sourceTextTruncated: rawPayload.ownership_source_text_truncated,
    sourceSha256: sha256(rawXml),
    declaredSourceSha256: nullableString(rawPayload.ownership_source_sha256)?.toLowerCase() ?? null,
  };
}

function reportingOwnerPayload(accessionNumber: string, owner: Section16XmlReportingOwner): Row {
  return {
    accession_number: accessionNumber,
    reporting_owner_index: owner.index,
    reporting_owner_cik_raw: rawFieldValue(owner.cik),
    reporting_owner_cik: normalizeCik(owner.cik.value),
    reporting_owner_name_raw: rawFieldValue(owner.name),
    structural_payload: owner,
  };
}

function transactionPayload(accessionNumber: string, transaction: Section16XmlTransaction, rowOrdinal: number): Row {
  return {
    accession_number: accessionNumber,
    row_ordinal: rowOrdinal,
    row_kind: transaction.rowKind,
    row_index: transaction.rowIndex,
    xml_path: transaction.xmlPath,
    security_title_raw: rawFieldValue(transaction.securityTitle),
    transaction_form_type_raw: rawFieldValue(transaction.transactionFormType),
    transaction_code_raw: rawFieldValue(transaction.transactionCode),
    transaction_timeliness_raw: rawFieldValue(transaction.transactionTimeliness),
    transaction_date_raw: rawFieldValue(transaction.transactionDate),
    deemed_execution_date_raw: rawFieldValue(transaction.deemedExecutionDate),
    shares_raw: rawFieldValue(transaction.shares),
    transaction_total_value_raw: rawFieldValue(transaction.transactionTotalValue),
    price_per_share_raw: rawFieldValue(transaction.pricePerShare),
    acquired_disposed_code_raw: rawFieldValue(transaction.acquiredDisposedCode),
    post_transaction_shares_raw: rawFieldValue(transaction.postTransactionShares),
    post_transaction_value_raw: rawFieldValue(transaction.postTransactionValue),
    direct_or_indirect_ownership_raw: rawFieldValue(transaction.directOrIndirectOwnership),
    nature_of_ownership_raw: rawFieldValue(transaction.natureOfOwnership),
    conversion_or_exercise_price_raw: rawFieldValue(transaction.conversionOrExercisePrice),
    exercise_date_raw: rawFieldValue(transaction.exerciseDate),
    expiration_date_raw: rawFieldValue(transaction.expirationDate),
    underlying_security_title_raw: rawFieldValue(transaction.underlyingSecurityTitle),
    underlying_security_shares_raw: rawFieldValue(transaction.underlyingSecurityShares),
    underlying_security_value_raw: rawFieldValue(transaction.underlyingSecurityValue),
    footnote_ids: transaction.footnoteIds,
    structural_payload: transaction,
  };
}

function holdingPayload(accessionNumber: string, holding: Section16XmlHolding, rowOrdinal: number): Row {
  return {
    accession_number: accessionNumber,
    row_ordinal: rowOrdinal,
    row_kind: holding.rowKind,
    row_index: holding.rowIndex,
    xml_path: holding.xmlPath,
    security_title_raw: rawFieldValue(holding.securityTitle),
    transaction_form_type_raw: rawFieldValue(holding.transactionFormType),
    amount_owned_raw: rawFieldValue(holding.amountOwned),
    value_owned_raw: rawFieldValue(holding.valueOwned),
    direct_or_indirect_ownership_raw: rawFieldValue(holding.directOrIndirectOwnership),
    nature_of_ownership_raw: rawFieldValue(holding.natureOfOwnership),
    conversion_or_exercise_price_raw: rawFieldValue(holding.conversionOrExercisePrice),
    exercise_date_raw: rawFieldValue(holding.exerciseDate),
    expiration_date_raw: rawFieldValue(holding.expirationDate),
    underlying_security_title_raw: rawFieldValue(holding.underlyingSecurityTitle),
    underlying_security_shares_raw: rawFieldValue(holding.underlyingSecurityShares),
    underlying_security_value_raw: rawFieldValue(holding.underlyingSecurityValue),
    footnote_ids: holding.footnoteIds,
    structural_payload: holding,
  };
}

function signaturePayload(accessionNumber: string, signature: Section16XmlSignature): Row {
  return {
    accession_number: accessionNumber,
    signature_index: signature.index,
    signature_name_raw: rawFieldValue(signature.name),
    signature_date_raw: rawFieldValue(signature.date),
    structural_payload: signature,
  };
}

function filingColumnsMatch(stored: Row, parsed: Section16XmlParserOutput) {
  return stored.form_type_raw === parsed.formType
    && stored.is_amendment === parsed.isAmendment
    && stored.issuer_cik_raw === exactFieldValue(parsed.issuer.cik, "issuer CIK")
    && stored.issuer_cik === normalizeCik(parsed.issuer.cik.value)
    && stored.issuer_name_raw === rawFieldValue(parsed.issuer.name)
    && stored.trading_symbol_raw === rawFieldValue(parsed.issuer.tradingSymbol)
    && stored.foreign_trading_symbol_raw === rawFieldValue(parsed.issuer.foreignTradingSymbol)
    && stored.filing_date_raw === rawFieldValue(parsed.filing.filingDate)
    && stored.accepted_at_raw === rawFieldValue(parsed.filing.acceptedAt)
    && stored.period_of_report_raw === rawFieldValue(parsed.filing.periodOfReport)
    && stored.date_of_original_submission_raw === rawFieldValue(parsed.filing.dateOfOriginalSubmission)
    && stored.source_url === parsed.source.url
    && stored.parser_version === parsed.parserVersion
    && stored.parser_mode === parsed.parserMode
    && stableStringify(record(stored.source_payload)) === stableStringify(parsed.source)
    && stableStringify(record(stored.filing_payload)) === stableStringify(parsed.filing)
    && stableStringify(record(stored.issuer_payload)) === stableStringify(parsed.issuer);
}

function reportingOwnerColumnsMatch(stored: Row, parsedRow: unknown) {
  const owner = parsedRow as Section16XmlReportingOwner;
  return Number(stored.reporting_owner_index) === owner.index
    && stored.reporting_owner_cik_raw === rawFieldValue(owner.cik)
    && stored.reporting_owner_cik === normalizeCik(owner.cik.value)
    && stored.reporting_owner_name_raw === rawFieldValue(owner.name);
}

function transactionColumnsMatch(stored: Row, parsedRow: unknown) {
  const transaction = parsedRow as Section16XmlTransaction;
  return Number(stored.row_ordinal) >= 0
    && stored.row_kind === transaction.rowKind
    && Number(stored.row_index) === transaction.rowIndex
    && stored.xml_path === transaction.xmlPath
    && stored.security_title_raw === rawFieldValue(transaction.securityTitle)
    && stored.transaction_form_type_raw === rawFieldValue(transaction.transactionFormType)
    && stored.transaction_code_raw === rawFieldValue(transaction.transactionCode)
    && stored.transaction_timeliness_raw === rawFieldValue(transaction.transactionTimeliness)
    && stored.transaction_date_raw === rawFieldValue(transaction.transactionDate)
    && stored.deemed_execution_date_raw === rawFieldValue(transaction.deemedExecutionDate)
    && stored.shares_raw === rawFieldValue(transaction.shares)
    && stored.transaction_total_value_raw === rawFieldValue(transaction.transactionTotalValue)
    && stored.price_per_share_raw === rawFieldValue(transaction.pricePerShare)
    && stored.acquired_disposed_code_raw === rawFieldValue(transaction.acquiredDisposedCode)
    && stored.post_transaction_shares_raw === rawFieldValue(transaction.postTransactionShares)
    && stored.post_transaction_value_raw === rawFieldValue(transaction.postTransactionValue)
    && stored.direct_or_indirect_ownership_raw === rawFieldValue(transaction.directOrIndirectOwnership)
    && stored.nature_of_ownership_raw === rawFieldValue(transaction.natureOfOwnership)
    && stored.conversion_or_exercise_price_raw === rawFieldValue(transaction.conversionOrExercisePrice)
    && stored.exercise_date_raw === rawFieldValue(transaction.exerciseDate)
    && stored.expiration_date_raw === rawFieldValue(transaction.expirationDate)
    && stored.underlying_security_title_raw === rawFieldValue(transaction.underlyingSecurityTitle)
    && stored.underlying_security_shares_raw === rawFieldValue(transaction.underlyingSecurityShares)
    && stored.underlying_security_value_raw === rawFieldValue(transaction.underlyingSecurityValue)
    && stableStringify(stored.footnote_ids) === stableStringify(transaction.footnoteIds);
}

function holdingColumnsMatch(stored: Row, parsedRow: unknown) {
  const holding = parsedRow as Section16XmlHolding;
  return Number(stored.row_ordinal) >= 0
    && stored.row_kind === holding.rowKind
    && Number(stored.row_index) === holding.rowIndex
    && stored.xml_path === holding.xmlPath
    && stored.security_title_raw === rawFieldValue(holding.securityTitle)
    && stored.transaction_form_type_raw === rawFieldValue(holding.transactionFormType)
    && stored.amount_owned_raw === rawFieldValue(holding.amountOwned)
    && stored.value_owned_raw === rawFieldValue(holding.valueOwned)
    && stored.direct_or_indirect_ownership_raw === rawFieldValue(holding.directOrIndirectOwnership)
    && stored.nature_of_ownership_raw === rawFieldValue(holding.natureOfOwnership)
    && stored.conversion_or_exercise_price_raw === rawFieldValue(holding.conversionOrExercisePrice)
    && stored.exercise_date_raw === rawFieldValue(holding.exerciseDate)
    && stored.expiration_date_raw === rawFieldValue(holding.expirationDate)
    && stored.underlying_security_title_raw === rawFieldValue(holding.underlyingSecurityTitle)
    && stored.underlying_security_shares_raw === rawFieldValue(holding.underlyingSecurityShares)
    && stored.underlying_security_value_raw === rawFieldValue(holding.underlyingSecurityValue)
    && stableStringify(stored.footnote_ids) === stableStringify(holding.footnoteIds);
}

function footnoteColumnsMatch(stored: Row, parsedRow: unknown) {
  const footnote = parsedRow as Section16XmlParserOutput["footnotes"][number];
  return stored.footnote_id === footnote.id
    && stored.text_value === footnote.text
    && stored.raw_text === footnote.rawText;
}

function signatureColumnsMatch(stored: Row, parsedRow: unknown) {
  const signature = parsedRow as Section16XmlSignature;
  return Number(stored.signature_index) === signature.index
    && stored.signature_name_raw === rawFieldValue(signature.name)
    && stored.signature_date_raw === rawFieldValue(signature.date);
}

function childOrdinal(stored: Row, label: string) {
  const column = label === "reporting_owner"
    ? "reporting_owner_index"
    : label === "transaction" || label === "holding"
      ? "row_ordinal"
      : label === "footnote"
        ? "footnote_index"
        : "signature_index";
  return Number(stored[column]);
}

function exactFieldValue(field: Section16XmlField, label: string) {
  if (field.status !== "exact" || field.value === null || typeof field.value !== "string" || !field.value) {
    throw new Section16CanonicalSourceError("required_field_missing", `Section 16 ${label} is not exact`);
  }
  return field.value;
}

function rawFieldValue(field: Section16XmlField<unknown>) {
  return field.rawValue;
}

function normalizeCik(value: unknown) {
  const text = stringValue(value);
  return /^\d{1,10}$/.test(text) ? text.padStart(10, "0") : null;
}

function normalizedFormType(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "");
}

function requiredAccession(value: unknown, label: string) {
  const text = stringValue(value);
  if (!ACCESSION_PATTERN.test(text)) {
    throw new Section16CanonicalSourceError("accession_invalid", `Section 16 ${label} is invalid`);
  }
  return text;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) {
    throw new Section16CanonicalSourceError("stored_payload_invalid", `Section 16 ${label} is missing`);
  }
  return value;
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rawString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function uuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sha256(value: string) {
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
