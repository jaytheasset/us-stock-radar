import { createHash } from "node:crypto";
import {
  buildRuntimeOwnershipParserInput,
  parseOwnershipForm,
  type OwnershipParserOutput,
} from "../sources/sec/forms/ownership/adapter.ts";
import { OWNERSHIP_PARSER_VERSION } from "../sources/sec/forms/ownership/parser.ts";

type Row = Record<string, unknown>;

export const OWNERSHIP_PARSER_CANONICAL_SOURCE = "sec_ownership_xml_parser";

export type OwnershipParserSourceErrorCode = "source_missing" | "source_verification_failed";

export class OwnershipParserSourceError extends Error {
  readonly code: OwnershipParserSourceErrorCode;

  constructor(code: OwnershipParserSourceErrorCode, message: string) {
    super(message);
    this.name = "OwnershipParserSourceError";
    this.code = code;
  }
}

export type OwnershipParserFactRows = {
  parserOutput: OwnershipParserOutput;
  formType: "4" | "4/A" | "144" | "144/A";
  accessionNumber: string;
  sourceUrl: string;
  issuerCik: string;
  issuerTicker: string | null;
  symbol: string | null;
  form4Transactions: Row[];
  form144ProposedSales: Row[];
};

export function buildOwnershipParserFactRows({
  eventId,
  rawItem,
  symbol,
}: {
  eventId: string;
  rawItem: unknown;
  symbol?: string | null;
}): OwnershipParserFactRows {
  requiredUuidLike(eventId, "eventId");
  const rawRow = requiredRecord(rawItem, "rawItem");
  const rawPayload = record(rawRow.raw_payload);
  const rawSourceText = typeof rawPayload.ownership_source_text === "string"
    ? rawPayload.ownership_source_text
    : null;
  const sourceText = nullableString(rawSourceText);
  if (!sourceText) {
    throw new OwnershipParserSourceError("source_missing", "Ownership raw XML source is absent");
  }
  if (rawPayload.ownership_source_text_truncated === true) {
    throw new OwnershipParserSourceError("source_verification_failed", "Ownership raw XML source is truncated");
  }
  if (nullableString(rawPayload.ownership_source_format) !== "ownership_xml") {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership raw source was not classified as ownership_xml",
    );
  }

  const formType = supportedFormType(rawPayload.form_type ?? rawRow.source_code);
  const accessionNumber = requiredAccession(
    rawPayload.accession_number ?? rawRow.source_unique_id,
    "Ownership accession number",
  );
  const rawIdentity = nullableString(rawRow.source_unique_id);
  if (rawIdentity && rawIdentity !== accessionNumber) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership raw item identity does not match its accession number",
    );
  }
  const sourceUrl = requiredOfficialSecUrl(rawPayload.ownership_source_url, accessionNumber);
  assertExpectedXmlRoot(sourceText, formType);

  const parserOutput = parseOwnershipForm(buildRuntimeOwnershipParserInput(rawRow, formType));
  validateParserOutput(parserOutput, { formType, accessionNumber, sourceUrl });

  const facts = record(parserOutput.facts);
  const issuerIdentity = verifyOwnershipIssuerIdentity({
    sourceText,
    rawPayload,
    requestedSymbol: symbol,
  });
  const normalizedSymbol = issuerIdentity.canonicalTicker;
  // Hash the preserved raw payload byte-for-byte. Parsing may ignore harmless
  // outer whitespace, but DB staleness checks intentionally do not.
  const sourceXmlSha256 = createHash("sha256").update(rawSourceText!, "utf8").digest("hex");
  const reportingOwners = recordArray(facts.reporting_owners);
  const ownerFacts = buildFilingOwnerFacts(reportingOwners);
  const commonProvenance = {
    source: OWNERSHIP_PARSER_CANONICAL_SOURCE,
    parser_version: parserOutput.parserVersion,
    canonical_input: "raw_items.raw_payload.ownership_source_text",
    parser_fallback: false,
    source_verified: true,
    source_format: "structured_xml",
    source_role: "raw_payload.ownership_source_text",
    accession_number: accessionNumber,
    source_url: sourceUrl,
    source_xml_sha256: sourceXmlSha256,
    issuer_identity: {
      source: "ownership_xml",
      match_status: "exact_cik",
      xml_cik: issuerIdentity.xmlCik,
      target_cik: issuerIdentity.targetCik,
      xml_ticker: issuerIdentity.xmlTicker,
      target_ticker: issuerIdentity.targetTicker,
      canonical_ticker: issuerIdentity.canonicalTicker,
    },
  };

  const form4 = record(facts.form4);
  const form4Transactions = recordArray(form4.transactions).map((transaction, transactionIndex) => {
    const shares = exactNumericField(transaction.shares, transaction.shares_status);
    const price = exactNumericField(transaction.price_per_share, transaction.price_per_share_status);
    const following = exactNumericField(
      transaction.shares_owned_following,
      transaction.shares_owned_following_status,
    );
    return compact({
      event_id: eventId,
      transaction_index: transactionIndex,
      symbol: normalizedSymbol,
      reporting_owner_names: ownerFacts.names,
      reporting_owner_roles: ownerFacts.roles,
      officer_titles: ownerFacts.officerTitles,
      is_officer: ownerFacts.rowAttributionSafe ? ownerFacts.isOfficer : null,
      is_director: ownerFacts.rowAttributionSafe ? ownerFacts.isDirector : null,
      is_10_percent_owner: ownerFacts.rowAttributionSafe ? ownerFacts.isTenPercentOwner : null,
      officer_title: ownerFacts.rowAttributionSafe && ownerFacts.officerTitles.length === 1
        ? ownerFacts.officerTitles[0]
        : null,
      is_10b5_1: null,
      transaction_kind: enumValue(transaction.transaction_kind, ["non_derivative", "derivative"]),
      security_title: nullableString(transaction.security_title),
      transaction_date: exactDate(transaction.transaction_date),
      deemed_execution_date: exactDate(transaction.deemed_execution_date),
      transaction_code: singleUppercaseCode(transaction.transaction_code),
      acquired_disposed_code: enumValue(transaction.acquired_disposed_code, ["A", "D"]),
      economic_direction: "unknown",
      shares: shares.value,
      shares_quality: shares.legacyQuality,
      shares_value_quality: shares.quality,
      shares_availability: shares.availability,
      price_per_share: price.value,
      price_per_share_quality: price.legacyQuality,
      price_per_share_value_quality: price.quality,
      price_per_share_availability: price.availability,
      transaction_value: null,
      transaction_value_quality: null,
      transaction_value_value_quality: "unknown",
      transaction_value_availability: "unavailable",
      post_transaction_shares: following.value,
      post_transaction_shares_value_quality: following.quality,
      post_transaction_shares_availability: following.availability,
      direct_or_indirect_ownership: enumValue(transaction.direct_or_indirect_ownership, ["D", "I"]),
      nature_of_ownership: nullableString(transaction.nature_of_ownership),
      fact_as_of: exactDate(transaction.transaction_date),
      confidence: null,
      provenance: {
        ...commonProvenance,
        fact_kind: "reported_form4_transaction",
        source_row: {
          group: nullableString(transaction.transaction_kind) === "derivative"
            ? "derivative_transactions"
            : "non_derivative_transactions",
          index: transactionIndex,
        },
        reporting_owner_scope: ownerFacts.rowAttributionSafe
          ? "single_filing_owner"
          : "filing_level_unattributed_owner_set",
      },
      evidence: stringArray(transaction.evidence),
      calculation_basis: {
        source_values_only: true,
        transaction_value_not_computed: true,
        is_10b5_1_not_promoted_from_filing_scope: true,
        shares: sourceFieldAudit(transaction, "shares"),
        price_per_share: sourceFieldAudit(transaction, "price_per_share"),
        post_transaction_shares: sourceFieldAudit(transaction, "shares_owned_following"),
        footnote_ids: stringArray(transaction.footnote_ids),
        field_footnote_ids: record(transaction.field_footnote_ids),
        underlying_security_title: nullableString(transaction.underlying_security_title),
      },
      updated_at: new Date().toISOString(),
    });
  });

  const form144 = record(facts.form144);
  const form144ReportingOwnerNames = uniqueStrings([
    nullableString(form144.seller_name),
    nullableString(form144.account_person_name),
  ]);
  const form144ProposedSales = recordArray(form144.proposed_sale_rows).map((sale, proposedSaleIndex) => {
    const units = exactNumericField(sale.securities_to_be_sold, sale.securities_to_be_sold_status);
    const marketValue = exactNumericField(sale.aggregate_market_value, sale.aggregate_market_value_status);
    const outstanding = exactNumericField(sale.shares_outstanding, sale.shares_outstanding_status);
    return compact({
      event_id: eventId,
      proposed_sale_index: proposedSaleIndex,
      symbol: normalizedSymbol,
      seller_name: nullableString(form144.seller_name),
      reporting_owner_names: form144ReportingOwnerNames,
      security_title: nullableString(sale.securities_class_title),
      exchange: nullableString(sale.securities_exchange_name),
      securities_to_be_sold: units.value,
      securities_to_be_sold_quality: units.legacyQuality,
      securities_to_be_sold_value_quality: units.quality,
      securities_to_be_sold_availability: units.availability,
      aggregate_market_value: marketValue.value,
      aggregate_market_value_quality: marketValue.legacyQuality,
      aggregate_market_value_value_quality: marketValue.quality,
      aggregate_market_value_availability: marketValue.availability,
      approximate_sale_date: exactDate(sale.approximate_sale_date),
      shares_outstanding: outstanding.value,
      shares_outstanding_quality: outstanding.legacyQuality,
      shares_outstanding_value_quality: outstanding.quality,
      shares_outstanding_availability: outstanding.availability,
      proposed_sale_percent: null,
      proposed_sale_percent_quality: null,
      proposed_sale_percent_value_quality: "unknown",
      proposed_sale_percent_availability: "unavailable",
      fact_as_of: exactDate(sale.approximate_sale_date),
      confidence: null,
      provenance: {
        ...commonProvenance,
        fact_kind: "form144_proposed_sale_notice",
        execution_status: "proposed_not_executed",
        source_row: { group: "proposed_sale_rows", index: proposedSaleIndex },
      },
      evidence: stringArray(sale.evidence),
      calculation_basis: {
        source_values_only: true,
        proposed_sale_percent_not_computed: "unit_comparability_requires_separate_semantic_analysis",
        securities_to_be_sold: sourceFieldAudit(sale, "securities_to_be_sold"),
        aggregate_market_value: sourceFieldAudit(sale, "aggregate_market_value"),
        shares_outstanding: sourceFieldAudit(sale, "shares_outstanding"),
        footnote_ids: stringArray(sale.footnote_ids),
        field_footnote_ids: record(sale.field_footnote_ids),
      },
      updated_at: new Date().toISOString(),
    });
  });

  return {
    parserOutput,
    formType,
    accessionNumber,
    sourceUrl,
    issuerCik: issuerIdentity.xmlCik,
    issuerTicker: issuerIdentity.xmlTicker,
    symbol: normalizedSymbol,
    form4Transactions,
    form144ProposedSales,
  };
}

function verifyOwnershipIssuerIdentity({
  sourceText,
  rawPayload,
  requestedSymbol,
}: {
  sourceText: string;
  rawPayload: Row;
  requestedSymbol?: string | null;
}) {
  const xmlCik = normalizeCik(firstXmlElementText(sourceText, "issuerCik"));
  if (!xmlCik) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership XML issuer CIK is unavailable",
    );
  }
  const targetCik = targetIssuerCik(rawPayload);
  if (!targetCik) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership target issuer CIK is unavailable",
    );
  }
  if (targetCik !== xmlCik) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership XML issuer CIK does not match the target issuer CIK",
    );
  }

  const xmlTicker = normalizeSymbol(firstXmlElementText(sourceText, "issuerTradingSymbol"));
  const targetTicker = targetIssuerTicker(rawPayload);
  const suppliedTicker = normalizeSymbol(requestedSymbol);
  if (
    (xmlTicker && targetTicker && xmlTicker !== targetTicker)
    || (xmlTicker && suppliedTicker && xmlTicker !== suppliedTicker)
    || (targetTicker && suppliedTicker && targetTicker !== suppliedTicker)
    || (suppliedTicker && !xmlTicker && !targetTicker)
  ) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership ticker does not match the verified issuer identity",
    );
  }

  return {
    xmlCik,
    targetCik,
    xmlTicker,
    targetTicker,
    // A caller-supplied symbol is only a consistency check. It is never the
    // canonical source, which prevents cross-issuer ticker injection.
    canonicalTicker: xmlTicker ?? targetTicker,
  };
}

function targetIssuerCik(rawPayload: Row) {
  const explicit = uniqueStrings([
    normalizeCik(rawPayload.ownership_issuer_cik),
    normalizeCik(rawPayload.issuer_cik),
  ]);
  if (explicit.length > 1) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership target issuer CIK fields conflict",
    );
  }
  if (explicit.length === 1) return explicit[0];
  const fallback = uniqueStrings([
    normalizeCik(rawPayload.cik),
    normalizeCik(rawPayload.cik_padded),
  ]);
  if (fallback.length > 1) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership target issuer CIK fields conflict",
    );
  }
  return fallback[0] ?? null;
}

function targetIssuerTicker(rawPayload: Row) {
  const tickers = uniqueStrings([
    normalizeSymbol(rawPayload.ownership_issuer_trading_symbol),
    normalizeSymbol(rawPayload.ticker),
  ]);
  if (tickers.length > 1) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership target issuer ticker fields conflict",
    );
  }
  return tickers[0] ?? null;
}

function firstXmlElementText(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  const match = sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${tag}>`, "i"));
  return match?.[1]
    ?.replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .trim() || null;
}

function normalizeCik(value: unknown) {
  const digits = nullableString(value)?.replace(/^0+/, "") ?? "";
  if (!digits || !/^\d{1,10}$/.test(digits)) return null;
  return digits.padStart(10, "0");
}

function validateParserOutput(
  parserOutput: OwnershipParserOutput,
  expected: { formType: string; accessionNumber: string; sourceUrl: string },
) {
  const facts = record(parserOutput.facts);
  const filing = record(facts.filing);
  const selection = record(record(parserOutput.raw).source_selection);
  const failures = [
    parserOutput.parserVersion === OWNERSHIP_PARSER_VERSION,
    parserOutput.parserGroup === "ownership",
    parserOutput.isSupported === true,
    nullableString(parserOutput.accessionNumber) === expected.accessionNumber,
    nullableString(filing.form_type) === expected.formType,
    nullableString(filing.accession_number) === expected.accessionNumber,
    nullableString(filing.source_format) === "structured_xml",
    nullableString(filing.source_status) === "structured_xml_selected",
    nullableString(filing.source_confidence) === "high",
    nullableString(filing.parser_source_role) === "raw_payload.ownership_source_text",
    nullableString(selection.selected_source_role) === "raw_payload.ownership_source_text",
    nullableString(selection.selected_source_format) === "structured_xml",
    nullableString(selection.selected_source_url) === expected.sourceUrl,
    selection.structured_xml_available === true,
    selection.fallback_used === false,
  ];
  if (failures.some((passed) => !passed)) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership production parser did not verify the preserved SEC XML source",
    );
  }
}

function buildFilingOwnerFacts(owners: Row[]) {
  const names = uniqueStrings(owners.map((owner) => nullableString(owner.name)));
  const roles = uniqueStrings(owners.flatMap((owner) => stringArray(owner.roles)));
  const officerTitles = uniqueStrings(owners.map((owner) => nullableString(owner.title)));
  return {
    names,
    roles,
    officerTitles,
    rowAttributionSafe: owners.length === 1,
    isOfficer: triStateAny(owners, "is_officer"),
    isDirector: triStateAny(owners, "is_director"),
    isTenPercentOwner: triStateAny(owners, "is_ten_percent_owner"),
  };
}

function exactNumericField(value: unknown, status: unknown) {
  const normalizedStatus = nullableString(status);
  if ((normalizedStatus === "numeric" || normalizedStatus === "zero") && isNonNegativeFinite(value)) {
    if (normalizedStatus === "zero" && value !== 0) {
      throw new OwnershipParserSourceError("source_verification_failed", "Ownership parser numeric zero status is inconsistent");
    }
    return { value, quality: "exact", availability: "available", legacyQuality: "exact" } as const;
  }
  return { value: null, quality: "unknown", availability: "unavailable", legacyQuality: null } as const;
}

function sourceFieldAudit(row: Row, prefix: string) {
  return compact({
    text: nullableString(row[`${prefix}_text`]),
    status: nullableString(row[`${prefix}_status`]) ?? "missing",
  });
}

function assertExpectedXmlRoot(sourceText: string, formType: string) {
  const root = formType.startsWith("144") ? "edgarSubmission" : "ownershipDocument";
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${root}`;
  if (!new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*<\\/${tag}>`, "i").test(sourceText)) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      `Ownership XML does not contain a complete ${root} root`,
    );
  }
}

function supportedFormType(value: unknown): "4" | "4/A" | "144" | "144/A" {
  const normalized = nullableString(value)?.toUpperCase().replace(/^FORM\s+/, "");
  if (normalized === "4" || normalized === "4/A" || normalized === "144" || normalized === "144/A") {
    return normalized;
  }
  throw new OwnershipParserSourceError("source_verification_failed", "Raw item is not a supported Ownership form");
}

function requiredAccession(value: unknown, label: string) {
  const accession = nullableString(value);
  if (!accession || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) {
    throw new OwnershipParserSourceError("source_verification_failed", `${label} is invalid`);
  }
  return accession;
}

function requiredOfficialSecUrl(value: unknown, accessionNumber: string) {
  const sourceUrl = nullableString(value);
  if (!sourceUrl) {
    throw new OwnershipParserSourceError("source_missing", "Ownership SEC XML source URL is absent");
  }
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new OwnershipParserSourceError("source_verification_failed", "Ownership SEC XML source URL is invalid");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || (hostname !== "sec.gov" && !hostname.endsWith(".sec.gov"))) {
    throw new OwnershipParserSourceError("source_verification_failed", "Ownership XML source is not an official HTTPS SEC URL");
  }
  const archiveMatch = parsed.pathname.match(/^\/Archives\/edgar\/data\/\d+\/(\d{18})(?:\/|$)/i);
  if (!archiveMatch || archiveMatch[1] !== accessionNumber.replace(/-/g, "")) {
    throw new OwnershipParserSourceError(
      "source_verification_failed",
      "Ownership SEC Archives URL does not match the filing accession number",
    );
  }
  return parsed.href;
}

function exactDate(value: unknown) {
  const text = nullableString(value);
  if (!text) return null;
  const isoCandidate = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? text
    : (() => {
        const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
      })();
  if (!isoCandidate) return null;
  const parsed = new Date(`${isoCandidate}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== isoCandidate
    ? null
    : isoCandidate;
}

function singleUppercaseCode(value: unknown) {
  const text = nullableString(value)?.toUpperCase() ?? null;
  return text && /^[A-Z]$/.test(text) ? text : null;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const text = nullableString(value);
  return text && allowed.includes(text as T) ? text as T : null;
}

function triStateAny(rows: Row[], key: string): boolean | null {
  const values = rows.map((row) => row[key]).filter((value): value is boolean => typeof value === "boolean");
  return values.length ? values.some(Boolean) : null;
}

function normalizeSymbol(value: unknown) {
  const symbol = nullableString(value)?.toUpperCase() ?? null;
  return symbol && /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol) ? symbol : null;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function requiredUuidLike(value: unknown, label: string) {
  const text = nullableString(value);
  if (!text || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} must be a UUID`);
  }
  return text;
}

function requiredRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OwnershipParserSourceError("source_missing", `${label} is absent`);
  }
  return value as Row;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function recordArray(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(nullableString).filter((item): item is string => Boolean(item))
    : [];
}

function uniqueStrings(values: Array<string | null>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function nullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function compact<T extends Row>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
