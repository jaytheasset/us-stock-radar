const MONTH_NUMBERS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export function readPeriodicReportingPeriodFromRawRow(row: Record<string, unknown>) {
  const rawPayload = readRecord(row.raw_payload) || {};
  const metadata = readRecord(row.metadata) || {};
  const coverPage = readRecord(rawPayload.cover_page) || readRecord(rawPayload.coverPage) || {};
  const directCandidates = [
    rawPayload.reporting_period,
    rawPayload.reportingPeriod,
    rawPayload.period_of_report,
    rawPayload.periodOfReport,
    rawPayload.report_period,
    rawPayload.document_period_end_date,
    rawPayload.documentPeriodEndDate,
    metadata.reporting_period,
    metadata.reportingPeriod,
    metadata.period_of_report,
    metadata.periodOfReport,
    coverPage.reporting_period,
    coverPage.reportingPeriod,
    coverPage.period_of_report,
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizePeriodicReportingPeriod(candidate);
    if (normalized) return normalized;
  }

  const xbrlPeriod = readDocumentPeriodEndDateFromXbrlFacts(
    rawPayload.periodic_report_core_xbrl_facts ??
      rawPayload.periodicReportCoreXbrlFacts ??
      rawPayload.xbrl_facts ??
      rawPayload.xbrlFacts,
  );
  if (xbrlPeriod) return xbrlPeriod;

  const primaryDocumentPeriod = readPeriodFromPrimaryDocumentReference(rawPayload);
  if (primaryDocumentPeriod) return primaryDocumentPeriod;

  const text = `${stringValue(row.body_text)}\n${stringValue(row.analysis_text)}`.slice(0, 250_000);
  const xbrlMatch = text.match(/DocumentPeriodEndDate[^\d]{0,160}(\d{4}-\d{2}-\d{2})/i);
  if (xbrlMatch?.[1]) return normalizePeriodicReportingPeriod(xbrlMatch[1]);
  const ntPeriodMatch = text.match(
    /(?:for\s+period\s+ended|period\s+of\s+report)\s*:?\s*((?:[A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})|(?:\d{1,2}\/\d{1,2}\/\d{4})|(?:\d{4}-\d{2}-\d{2}))/i,
  );
  if (ntPeriodMatch?.[1]) return normalizePeriodicReportingPeriod(ntPeriodMatch[1]);
  const periodMatch = text.match(
    /(?:fiscal\s+(?:year|quarter)|three\s+months|six\s+months|nine\s+months|year)\s+ended\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i,
  );
  return normalizePeriodicReportingPeriod(periodMatch?.[1]);
}

export function readPeriodicReportingPeriodFromFilingPackage(value: unknown) {
  const filingPackage = readRecord(value) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const periodicFacts = readRecord(readRecord(hardParsers["periodic-reports"])?.facts) || {};
  const ntFacts = readRecord(readRecord(hardParsers.nt)?.facts) || {};
  const candidates = [
    ntFacts.periodOfReport,
    ntFacts.period_of_report,
    periodicFacts.reportingPeriod,
    periodicFacts.reporting_period,
    filingPackage.reporting_period,
    filingPackage.period_of_report,
  ];
  for (const candidate of candidates) {
    const normalized = normalizePeriodicReportingPeriod(candidate);
    if (normalized) return normalized;
  }
  return "";
}

export function isMatchingNtLifecyclePeriod({
  reportForm,
  noticeForm,
  reportPeriod,
  noticePeriod,
}: {
  reportForm: unknown;
  noticeForm: unknown;
  reportPeriod: unknown;
  noticePeriod: unknown;
}) {
  const normalizedReportForm = normalizePeriodicForm(reportForm);
  const normalizedNoticeForm = normalizePeriodicForm(noticeForm);
  if (!["10-K", "10-Q", "20-F"].includes(normalizedReportForm)) return false;
  if (normalizedNoticeForm !== `NT ${normalizedReportForm}`) return false;
  const normalizedReportPeriod = normalizePeriodicReportingPeriod(reportPeriod);
  return Boolean(
    normalizedReportPeriod &&
    normalizedReportPeriod === normalizePeriodicReportingPeriod(noticePeriod),
  );
}

export function normalizePeriodicReportingPeriod(value: unknown) {
  const text = stringValue(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";

  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return validCalendarDate(isoMatch[1], isoMatch[2], isoMatch[3]);

  const compactMatch = text.match(/\b(\d{4})(\d{2})(\d{2})\b/);
  if (compactMatch) return validCalendarDate(compactMatch[1], compactMatch[2], compactMatch[3]);

  const monthNameMatch = text.match(/\b([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})\b/);
  if (monthNameMatch) {
    const month = MONTH_NUMBERS[monthNameMatch[1].toLowerCase()];
    if (month) return validCalendarDate(monthNameMatch[3], month, monthNameMatch[2]);
  }

  const numericMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numericMatch) return validCalendarDate(numericMatch[3], numericMatch[1], numericMatch[2]);

  return "";
}

function readDocumentPeriodEndDateFromXbrlFacts(value: unknown) {
  for (const fact of normalizeFactRecords(value)) {
    const name = [fact.name, fact.concept, fact.tag, fact.qname, fact.factName]
      .map(stringValue)
      .find(Boolean);
    if (!name || !/(?:^|:)DocumentPeriodEndDate$/i.test(name)) continue;

    const factValue = fact.value ?? fact.val ?? fact.text ?? fact.amount;
    const normalizedValue = normalizePeriodicReportingPeriod(factValue);
    if (normalizedValue) return normalizedValue;

    const period = stringValue(fact.period || fact.instant || fact.endDate || fact.end_date);
    const periodEnd = period.includes("/") ? period.split("/").at(-1) : period;
    const normalizedPeriod = normalizePeriodicReportingPeriod(periodEnd);
    if (normalizedPeriod) return normalizedPeriod;
  }
  return "";
}

function readPeriodFromPrimaryDocumentReference(rawPayload: Record<string, unknown>) {
  const documents = Array.isArray(rawPayload.documents) ? rawPayload.documents : [];
  const primaryDocument = documents
    .map(readRecord)
    .find((document) => document && (document.isPrimary === true || document.is_primary === true));
  const candidates = [
    rawPayload.primary_document_url,
    rawPayload.primaryDocumentUrl,
    primaryDocument?.url,
    primaryDocument?.document,
    primaryDocument?.filename,
  ];

  for (const candidate of candidates) {
    const text = stringValue(candidate);
    const basename = text.split(/[\\/]/).at(-1) || text;
    const match = basename.match(/(?:^|[-_.])(20\d{2})(\d{2})(\d{2})(?=[-_.]|$)/);
    if (!match) continue;
    const normalized = validCalendarDate(match[1], match[2], match[3]);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeFactRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(readRecord).filter((record): record is Record<string, unknown> => Boolean(record));
  const record = readRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([name, factValue]) => {
    if (Array.isArray(factValue)) {
      return factValue
        .map(readRecord)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({ name, ...item }));
    }
    const nested = readRecord(factValue);
    return nested ? [{ name, ...nested }] : [{ name, value: factValue }];
  });
}

function validCalendarDate(yearValue: string, monthValue: string, dayValue: string) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return "";
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function normalizePeriodicForm(value: unknown) {
  return stringValue(value)
    .toUpperCase()
    .replace(/^FORM\s+/, "")
    .replace(/\s*\/\s*A$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
