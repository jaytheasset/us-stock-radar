export type SecCurrentFilingIdentity = {
  form_type: string | null;
  form_family: string | null;
  accession_number: string | null;
  cik: string | null;
  company_name: string | null;
  ticker: string | null;
  exchange: string | null;
  filed_at: string | null;
  source_url: string | null;
  primary_document_url: string | null;
  is_amendment: boolean;
  usage_rule: string;
};

export function buildCurrentFilingIdentity({
  filingPackage,
  parserOutput,
  formFamily,
}: {
  filingPackage?: Record<string, unknown> | null;
  parserOutput?: Record<string, unknown> | null;
  formFamily?: string | null;
}): SecCurrentFilingIdentity {
  const filing = toRecord(filingPackage);
  const rawPayload = toRecord(firstDefined(filing.rawPayload, filing.raw_payload));
  const parser = toRecord(parserOutput);
  const parserRaw = toRecord(parser.raw);
  const parserFacts = toRecord(parser.facts);
  const factsFiling = toRecord(parserFacts.filing);
  const sourcePackage = toRecord(parserRaw.source_package);

  const actualFormType = firstString(
    parserRaw.inputFormType,
    parserRaw.input_form_type,
    parserRaw.secFormType,
    parserRaw.sec_form_type,
    parserRaw.source_form_type,
    factsFiling.reported_form_type,
    factsFiling.form_type,
    factsFiling.formType,
    parserFacts.secFormType,
    parserFacts.sec_form_type,
    parserFacts.source_form_type,
    parserFacts.form_type,
    parserRaw.form_type,
    rawPayload.form_type,
    rawPayload.formType,
    filing.form_type,
    filing.formType,
    parser.formType,
  );
  const family = firstString(formFamily, parser.formType);

  return {
    form_type: actualFormType || null,
    form_family: family || null,
    accession_number: firstString(
      parser.accessionNumber,
      parser.accession_number,
      filing.accession_number,
      filing.accessionNumber,
      rawPayload.accession_number,
      rawPayload.accessionNumber,
    ) || null,
    cik: firstString(filing.cik, rawPayload.cik, parserFacts.cik, factsFiling.cik, parser.cik) || null,
    company_name: firstString(
      filing.company_name,
      filing.companyName,
      rawPayload.company_name,
      rawPayload.companyName,
      parserFacts.companyName,
      parserFacts.company_name,
      parserFacts.issuerName,
      parserFacts.issuer_name,
      factsFiling.company_name,
    ) || null,
    ticker: firstString(filing.ticker, toRecord(filing.primary_ticker).ticker, rawPayload.ticker, parserFacts.ticker) || null,
    exchange: firstString(filing.exchange, toRecord(filing.primary_ticker).exchange, rawPayload.exchange, parserFacts.exchange) || null,
    filed_at: firstString(
      filing.filed_at,
      filing.filedAt,
      filing.publishedAt,
      rawPayload.filing_date,
      rawPayload.filed_at,
      parserRaw.filingDate,
      parserRaw.filing_date,
      factsFiling.filing_date,
    ) || null,
    source_url: firstString(filing.source_url, filing.sourceUrl, rawPayload.source_url, sourcePackage.source_url) || null,
    primary_document_url: firstString(
      filing.primary_document_url,
      filing.primaryDocumentUrl,
      rawPayload.primary_document_url,
      sourcePackage.primary_document_url,
    ) || null,
    is_amendment: isAmendmentForm(actualFormType),
    usage_rule:
      "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another form from the same family.",
  };
}

export function currentFilingIdentityText(identity: SecCurrentFilingIdentity) {
  return JSON.stringify(identity, null, 2);
}

function isAmendmentForm(formType: string) {
  const normalized = formType.toUpperCase().replace(/\s+/g, " ").trim();
  return normalized.endsWith("/A") || normalized.includes(" POS") || normalized.endsWith("POS AM");
}

function firstDefined(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return "";
}
