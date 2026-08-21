import { createHash } from "node:crypto";
import type {
  SecCompanyFactRow,
  SecFilingRow,
  SecIssuerObservationRow,
  SecIssuerRow,
  SecNormalizedBatch,
  SecNormalizationRejection,
  SecRawSourceRow,
  SecStructuredSourceDocument,
  SecTickerObservationRow,
} from "./types.ts";

const CIK_PATTERN = /^[0-9]{10}$/;
const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
const MAX_RAW_CONTENT_BYTES = 256 * 1024 * 1024;

export function normalizeCik(value: unknown) {
  const digits = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value.trim()
      : "";
  if (!/^[0-9]{1,10}$/.test(digits)) throw new Error("invalid_cik");
  const cik = digits.padStart(10, "0");
  if (!CIK_PATTERN.test(cik) || cik === "0000000000") throw new Error("invalid_cik");
  return cik;
}

export function normalizeSecStructuredDocuments(
  documents: readonly SecStructuredSourceDocument[],
  ingestedAt = new Date().toISOString(),
): SecNormalizedBatch {
  const batch: SecNormalizedBatch = {
    rawSources: [],
    issuers: [],
    issuerObservations: [],
    tickerObservations: [],
    filings: [],
    facts: [],
    rejections: [],
  };
  const issuerKeys = new Set<string>();
  const filingByAccession = new Map<string, SecFilingRow>();

  for (const document of documents.filter((item) => item.sourceKind === "submissions")) {
    try {
      const raw = normalizeRawSource(document, ingestedAt);
      const normalized = normalizeSubmissions(raw);
      batch.rawSources.push(raw);
      if (!issuerKeys.has(raw.cik)) {
        issuerKeys.add(raw.cik);
        batch.issuers.push({ cik: raw.cik, createdAt: ingestedAt });
      }
      batch.issuerObservations.push(...normalized.issuerObservations);
      batch.tickerObservations.push(...normalized.tickerObservations);
      for (const filing of normalized.filings) {
        const previous = filingByAccession.get(filing.accessionNumber);
        if (previous && !sameFilingIdentity(previous, filing)) {
          batch.rejections.push(rejection(raw.sourceIdentity, null, "conflicting_filing_identity"));
          continue;
        }
        if (!previous || (!previous.acceptedAt && filing.acceptedAt)) filingByAccession.set(filing.accessionNumber, filing);
      }
    } catch (error) {
      batch.rejections.push(rejection(document.sourceIdentity, null, errorReason(error)));
    }
  }

  batch.filings = [...filingByAccession.values()];

  for (const document of documents.filter((item) => item.sourceKind === "companyfacts")) {
    try {
      const raw = normalizeRawSource(document, ingestedAt);
      batch.rawSources.push(raw);
      if (!issuerKeys.has(raw.cik)) {
        batch.rejections.push(rejection(raw.sourceIdentity, null, "issuer_missing_from_submissions"));
        continue;
      }
      const normalized = normalizeCompanyFacts(raw);
      batch.rejections.push(...normalized.rejections);
      for (const fact of normalized.facts) {
        const filing = filingByAccession.get(fact.filingAccession);
        if (!filing) {
          batch.rejections.push(rejection(raw.sourceIdentity, fact.sourceFactPath, "filing_missing_from_submissions"));
          continue;
        }
        if (
          filing.issuerCik !== fact.issuerCik ||
          filing.form !== fact.form ||
          filing.filedDate !== fact.filedDate
        ) {
          batch.rejections.push(rejection(raw.sourceIdentity, fact.sourceFactPath, "fact_filing_identity_mismatch"));
          continue;
        }
        batch.facts.push(fact);
      }
    } catch (error) {
      batch.rejections.push(rejection(document.sourceIdentity, null, errorReason(error)));
    }
  }

  batch.rawSources = dedupe(batch.rawSources, (row) => row.id);
  batch.issuerObservations = dedupe(batch.issuerObservations, (row) => `${row.issuerCik}:${row.sourceRawId}`);
  batch.tickerObservations = dedupe(
    batch.tickerObservations,
    (row) => `${row.issuerCik}:${row.ticker}:${row.exchange}:${row.sourceRawId}`,
  );
  batch.facts = dedupe(batch.facts, (row) => row.sourceFactKey);
  return batch;
}

function normalizeRawSource(document: SecStructuredSourceDocument, ingestedAt: string): SecRawSourceRow {
  const cik = normalizeCik(document.cik);
  const payload = record(document.payload, "invalid_source_payload");
  if ("cik" in payload && normalizeCik(payload.cik) !== cik) throw new Error("source_cik_mismatch");
  const url = new URL(requiredString(document.sourceUrl, "missing_source_url"));
  if (url.protocol !== "https:" || !/(^|\.)sec\.gov$/i.test(url.hostname)) throw new Error("invalid_sec_source_url");
  const sourceIdentity = requiredString(document.sourceIdentity, "missing_source_identity");
  const fetchedAt = timestamp(document.fetchedAt, "invalid_fetched_at");
  const canonicalPayload = stableJson(payload);
  let rawContent = canonicalPayload;
  let rawContentKind: SecRawSourceRow["rawContentKind"] = "canonical_fixture_json";
  if (document.rawBody !== undefined && document.rawBody !== null) {
    if (document.rawBodyKind !== "authoritative_http_body" && document.rawBodyKind !== "injected_exact_body") {
      throw new Error("missing_raw_body_kind");
    }
    if (!document.rawBody || Buffer.byteLength(document.rawBody, "utf8") > MAX_RAW_CONTENT_BYTES) {
      throw new Error("invalid_raw_body_size");
    }
    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(document.rawBody);
    } catch {
      throw new Error("invalid_raw_body_json");
    }
    if (stableJson(parsedRaw) !== canonicalPayload) throw new Error("raw_body_payload_mismatch");
    rawContent = document.rawBody;
    rawContentKind = document.rawBodyKind;
  } else if (document.rawBodyKind !== undefined && document.rawBodyKind !== null) {
    throw new Error("raw_body_kind_without_body");
  }
  if (Buffer.byteLength(rawContent, "utf8") > MAX_RAW_CONTENT_BYTES) throw new Error("invalid_raw_body_size");
  const contentHash = sha256(rawContent);
  return {
    id: deterministicUuid(`${document.sourceKind}:${sourceIdentity}:${contentHash}`),
    sourceKind: document.sourceKind,
    sourceUrl: url.toString(),
    sourceIdentity,
    cik,
    fetchedAt,
    ingestedAt: timestamp(ingestedAt, "invalid_ingested_at"),
    contentHash,
    sourceSchemaVersion: nullableString(document.sourceSchemaVersion),
    rawContentKind,
    rawContent,
    payload,
    numericLexemes: rawContentKind === "canonical_fixture_json" || document.sourceKind !== "companyfacts"
      ? null
      : collectJsonNumberLexemes(rawContent),
  };
}

function normalizeSubmissions(raw: SecRawSourceRow) {
  const issuerObservations: SecIssuerObservationRow[] = [];
  const tickerObservations: SecTickerObservationRow[] = [];
  const filings: SecFilingRow[] = [];
  const name = nullableString(raw.payload.name);
  if (name) {
    issuerObservations.push({
      issuerCik: raw.cik,
      entityName: name,
      sourceRawId: raw.id,
      sourceKind: "submissions",
      observedAt: raw.fetchedAt,
      ingestedAt: raw.ingestedAt,
    });
  }

  const tickers = raw.payload.tickers;
  const exchanges = raw.payload.exchanges;
  if (tickers !== undefined || exchanges !== undefined) {
    if (!Array.isArray(tickers) || !Array.isArray(exchanges) || tickers.length !== exchanges.length) {
      throw new Error("invalid_ticker_exchange_arrays");
    }
    for (let index = 0; index < tickers.length; index += 1) {
      const ticker = requiredString(tickers[index], "invalid_ticker").toUpperCase();
      const exchange = requiredString(exchanges[index], "invalid_exchange");
      if (!TICKER_PATTERN.test(ticker)) throw new Error("invalid_ticker");
      tickerObservations.push({
        issuerCik: raw.cik,
        ticker,
        exchange,
        sourceRawId: raw.id,
        sourceKind: "submissions",
        observedAt: raw.fetchedAt,
        ingestedAt: raw.ingestedAt,
      });
    }
  }

  const filingsContainer = optionalRecord(raw.payload.filings);
  const recent = optionalRecord(filingsContainer?.recent) ?? (Array.isArray(raw.payload.accessionNumber) ? raw.payload : null);
  if (!recent) return { issuerObservations, tickerObservations, filings };
  const accessions = recent.accessionNumber;
  if (!Array.isArray(accessions)) throw new Error("invalid_filing_arrays");
  for (let index = 0; index < accessions.length; index += 1) {
    const accessionNumber = requiredString(accessions[index], "invalid_accession");
    if (!ACCESSION_PATTERN.test(accessionNumber)) throw new Error("invalid_accession");
    const form = arrayString(recent.form, index, "invalid_form");
    const filedDate = date(arrayValue(recent.filingDate, index), "invalid_filed_date");
    filings.push({
      accessionNumber,
      issuerCik: raw.cik,
      form,
      filedDate,
      acceptedAt: acceptanceTimestamp(arrayValue(recent.acceptanceDateTime, index)),
      reportDate: nullableDate(arrayValue(recent.reportDate, index), "invalid_report_date"),
      primaryDocument: nullableString(arrayValue(recent.primaryDocument, index)),
      isXbrl: nullableXbrlFlag(arrayValue(recent.isXBRL, index), "invalid_is_xbrl"),
      isInlineXbrl: nullableXbrlFlag(arrayValue(recent.isInlineXBRL, index), "invalid_is_inline_xbrl"),
      sourceRawId: raw.id,
      sourceKind: "submissions",
      ingestedAt: raw.ingestedAt,
    });
  }
  return { issuerObservations, tickerObservations, filings };
}

function normalizeCompanyFacts(raw: SecRawSourceRow) {
  const facts: SecCompanyFactRow[] = [];
  const rejections: SecNormalizationRejection[] = [];
  const taxonomies = record(raw.payload.facts, "missing_companyfacts_facts");
  for (const [taxonomy, taxonomyValue] of Object.entries(taxonomies)) {
    if (!NAME_PATTERN.test(taxonomy)) {
      rejections.push(rejection(raw.sourceIdentity, `facts.${taxonomy}`, "invalid_taxonomy"));
      continue;
    }
    const concepts = optionalRecord(taxonomyValue);
    if (!concepts) {
      rejections.push(rejection(raw.sourceIdentity, `facts.${taxonomy}`, "invalid_taxonomy_facts"));
      continue;
    }
    for (const [concept, conceptValue] of Object.entries(concepts)) {
      const conceptPath = `facts.${taxonomy}.${concept}`;
      if (!NAME_PATTERN.test(concept)) {
        rejections.push(rejection(raw.sourceIdentity, conceptPath, "invalid_concept"));
        continue;
      }
      const conceptRecord = optionalRecord(conceptValue);
      const units = optionalRecord(conceptRecord?.units);
      if (!units) {
        rejections.push(rejection(raw.sourceIdentity, conceptPath, "missing_units"));
        continue;
      }
      for (const [unit, entriesValue] of Object.entries(units)) {
        const unitPath = `${conceptPath}.units.${unit}`;
        if (!unit.trim() || !Array.isArray(entriesValue)) {
          rejections.push(rejection(raw.sourceIdentity, unitPath, "invalid_unit"));
          continue;
        }
        entriesValue.forEach((entryValue, index) => {
          const sourceFactPath = `${unitPath}[${index}]`;
          try {
            facts.push(normalizeCompanyFact(
              raw,
              taxonomy,
              concept,
              unit,
              sourceFactPath,
              ["facts", taxonomy, concept, "units", unit, index, "val"],
              entryValue,
            ));
          } catch (error) {
            rejections.push(rejection(raw.sourceIdentity, sourceFactPath, errorReason(error)));
          }
        });
      }
    }
  }
  return { facts, rejections };
}

function normalizeCompanyFact(
  raw: SecRawSourceRow,
  taxonomy: string,
  concept: string,
  unit: string,
  sourceFactPath: string,
  valuePath: readonly (string | number)[],
  value: unknown,
): SecCompanyFactRow {
  const entry = record(value, "invalid_fact_shape");
  if (entry.instant !== undefined) throw new Error(entry.start !== undefined ? "mixed_fact_period" : "unsupported_fact_period");
  const filingAccession = requiredString(entry.accn, "missing_fact_accession");
  if (!ACCESSION_PATTERN.test(filingAccession)) throw new Error("invalid_fact_accession");
  const form = requiredString(entry.form, "missing_fact_form");
  const filedDate = date(entry.filed, "invalid_fact_filed_date");
  const end = date(entry.end, "missing_fact_end");
  const start = entry.start === undefined || entry.start === null || entry.start === ""
    ? null
    : date(entry.start, "invalid_fact_start");
  if (start && start > end) throw new Error("invalid_fact_duration");

  let valueKind: "numeric" | "text";
  let valueNumeric: string | null = null;
  let valueText: string | null = null;
  if (typeof entry.val === "number" && Number.isFinite(entry.val)) {
    const lexicalValue = raw.numericLexemes?.get(jsonPointer(valuePath));
    if (!lexicalValue && (!Number.isSafeInteger(entry.val) || !Number.isInteger(entry.val))) {
      throw new Error("numeric_fact_lexeme_unavailable");
    }
    valueKind = "numeric";
    valueNumeric = lexicalValue ? canonicalDecimalLexeme(lexicalValue) : String(entry.val);
  } else if (typeof entry.val === "string") {
    valueKind = "text";
    valueText = entry.val;
  } else {
    throw new Error("invalid_fact_value");
  }

  const fiscalYear = nullableFiscalYear(entry.fy);
  const fiscalPeriod = nullableString(entry.fp);
  const frame = nullableString(entry.frame);
  const instantDate = start ? null : end;
  const startDate = start;
  const endDate = start ? end : null;
  const sourceFactKey = sha256(stableJson({
    issuerCik: raw.cik,
    taxonomy,
    concept,
    unit,
    filingAccession,
    form,
    filedDate,
    instantDate,
    startDate,
    endDate,
    valueKind,
    valueNumeric,
    valueText,
    fiscalYear,
    fiscalPeriod,
    frame,
  }));

  return {
    sourceFactKey,
    sourceFactPath,
    issuerCik: raw.cik,
    filingAccession,
    form,
    filedDate,
    sourceRawId: raw.id,
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    taxonomy,
    concept,
    unit,
    valueKind,
    valueNumeric,
    valueText,
    instantDate,
    startDate,
    endDate,
    fiscalYear,
    fiscalPeriod,
    frame,
    ingestedAt: raw.ingestedAt,
  };
}

function sameFilingIdentity(left: SecFilingRow, right: SecFilingRow) {
  return left.issuerCik === right.issuerCik && left.form === right.form && left.filedDate === right.filedDate;
}

function acceptanceTimestamp(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("invalid_accepted_at");
  const trimmed = value.trim();
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return timestamp(compact ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z` : trimmed, "invalid_accepted_at");
}

function timestamp(value: unknown, reason: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(reason);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(reason);
  return parsed.toISOString();
}

function date(value: unknown, reason: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(reason);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(reason);
  return value;
}

function nullableDate(value: unknown, reason: string) {
  return value === undefined || value === null || value === "" ? null : date(value, reason);
}

function nullableXbrlFlag(value: unknown, reason: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(reason);
}

function nullableFiscalYear(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1800 || parsed > 2200) throw new Error("invalid_fiscal_year");
  return parsed;
}

function arrayString(value: unknown, index: number, reason: string) {
  return requiredString(arrayValue(value, index), reason);
}

function arrayValue(value: unknown, index: number) {
  return Array.isArray(value) ? value[index] : undefined;
}

function requiredString(value: unknown, reason: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(reason);
  return value.trim();
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown, reason: string) {
  const result = optionalRecord(value);
  if (!result) throw new Error(reason);
  return result;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rejection(sourceIdentity: string, sourceFactPath: string | null, reason: string): SecNormalizationRejection {
  return { sourceIdentity, sourceFactPath, reason };
}

function errorReason(error: unknown) {
  return error instanceof Error && error.message ? error.message : "invalid_source";
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicUuid(value: string) {
  const bytes = Buffer.from(sha256(value).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${stableJson(source[key])}`).join(",")}}`;
}

function jsonPointer(path: readonly (string | number)[]) {
  return `/${path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function canonicalDecimalLexeme(value: string) {
  const match = value.match(/^(-?)(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!match) throw new Error("invalid_numeric_fact_lexeme");
  const exponentText = match[4] ?? "0";
  if (exponentText.replace(/^[+-]/, "").length > 6) throw new Error("numeric_fact_out_of_range");
  const exponent = Number(exponentText);
  let digits = `${match[2]}${match[3] ?? ""}`;
  let decimalPosition = match[2]!.length + exponent;
  const leadingZeros = digits.match(/^0*/)?.[0].length ?? 0;
  digits = digits.slice(leadingZeros);
  decimalPosition -= leadingZeros;
  if (!digits) return "0";
  if (decimalPosition > 131072 || decimalPosition < -16383) throw new Error("numeric_fact_out_of_range");
  let canonical: string;
  if (decimalPosition <= 0) canonical = `0.${"0".repeat(-decimalPosition)}${digits}`;
  else if (decimalPosition >= digits.length) canonical = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  else canonical = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  if (canonical.includes(".")) canonical = canonical.replace(/0+$/, "").replace(/\.$/, "");
  return match[1] ? `-${canonical}` : canonical;
}

function collectJsonNumberLexemes(source: string) {
  const values = new Map<string, string>();
  let index = 0;
  const whitespace = () => { while (/\s/.test(source[index] ?? "")) index += 1; };
  const parseString = () => {
    const start = index;
    if (source[index] !== '"') throw new Error("invalid_raw_body_json");
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") { index += 2; continue; }
      if (source[index] === '"') {
        index += 1;
        try { return JSON.parse(source.slice(start, index)) as string; }
        catch { throw new Error("invalid_raw_body_json"); }
      }
      index += 1;
    }
    throw new Error("invalid_raw_body_json");
  };
  const parseValue = (path: readonly (string | number)[]) => {
    whitespace();
    const token = source[index];
    if (token === "{") {
      index += 1;
      whitespace();
      if (source[index] === "}") { index += 1; return; }
      while (index < source.length) {
        whitespace();
        const key = parseString();
        whitespace();
        if (source[index] !== ":") throw new Error("invalid_raw_body_json");
        index += 1;
        parseValue([...path, key]);
        whitespace();
        if (source[index] === "}") { index += 1; return; }
        if (source[index] !== ",") throw new Error("invalid_raw_body_json");
        index += 1;
      }
      throw new Error("invalid_raw_body_json");
    }
    if (token === "[") {
      index += 1;
      whitespace();
      if (source[index] === "]") { index += 1; return; }
      let itemIndex = 0;
      while (index < source.length) {
        parseValue([...path, itemIndex]);
        itemIndex += 1;
        whitespace();
        if (source[index] === "]") { index += 1; return; }
        if (source[index] !== ",") throw new Error("invalid_raw_body_json");
        index += 1;
      }
      throw new Error("invalid_raw_body_json");
    }
    if (token === '"') { parseString(); return; }
    for (const literal of ["true", "false", "null"]) {
      if (source.startsWith(literal, index)) { index += literal.length; return; }
    }
    const number = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) throw new Error("invalid_raw_body_json");
    values.set(jsonPointer(path), number[0]);
    index += number[0].length;
  };
  parseValue([]);
  whitespace();
  if (index !== source.length) throw new Error("invalid_raw_body_json");
  return values;
}

function dedupe<T>(rows: readonly T[], key: (row: T) => string) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = key(row);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
