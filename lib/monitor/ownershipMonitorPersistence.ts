import {
  buildOwnershipContextReferenceInventory,
  isOwnershipContextSourceFingerprint,
  validateStoredOwnershipContextEnvelope,
  type OwnershipContextReferenceInventory,
  type StoredOwnershipContextEnvelope,
} from "./ownershipStructuredContext.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

type RepositoryResult = Readonly<{
  ok: boolean;
  status?: number;
  data: unknown;
  error?: string;
}>;

export type OwnershipMonitorRepository = Readonly<{
  select(table: string, query: Record<string, string>): Promise<RepositoryResult>;
  readContextSnapshot?(eventId: string): Promise<RepositoryResult>;
}>;

export type CanonicalOwnershipForm4Row = Readonly<Record<string, unknown> & {
  event_id: string;
  transaction_index: number;
}>;

export type CanonicalOwnershipForm144Row = Readonly<Record<string, unknown> & {
  event_id: string;
  proposed_sale_index: number;
}>;

type OwnershipMonitorLineage = Readonly<{
  eventId: string;
  rawItemId: string;
  sourceExecutionId: string;
  accessionNumber: string;
  parserVersion: string;
  persistedAt: string;
}>;

export type CurrentOwnershipContextResult =
  | Readonly<{
      status: "available";
      sourceFingerprint: string;
      rows: readonly Readonly<{ rowRef: string; context: StoredOwnershipContextEnvelope }>[];
    }>
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "stale" | "malformed" | "unavailable"; reason: string }>;

export type OwnershipContextEligibility =
  | Readonly<{ status: "eligible"; inventory: OwnershipContextReferenceInventory }>
  | Readonly<{ status: "ineligible"; reason: string }>;

export type CurrentOwnershipReadResult =
  | (OwnershipMonitorLineage & Readonly<{
      status: "available";
      form: "form4";
      rows: readonly CanonicalOwnershipForm4Row[];
      context?: CurrentOwnershipContextResult;
      contextEligibility?: OwnershipContextEligibility;
    }>)
  | (OwnershipMonitorLineage & Readonly<{
      status: "available";
      form: "form144";
      rows: readonly CanonicalOwnershipForm144Row[];
      context?: CurrentOwnershipContextResult;
      contextEligibility?: OwnershipContextEligibility;
    }>)
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{ status: "not_ready"; reason: string }>;

export async function readCurrentOwnershipFacts(
  eventId: string,
  repository?: OwnershipMonitorRepository,
): Promise<CurrentOwnershipReadResult> {
  if (!UUID_PATTERN.test(eventId)) return { status: "not_ready", reason: "invalid_event_id" };
  const resolved = repository ?? await defaultRepository();
  let snapshotResult: RepositoryResult | null = null;
  try {
    snapshotResult = resolved.readContextSnapshot
      ? await resolved.readContextSnapshot(eventId)
      : null;
  } catch {
    snapshotResult = null;
  }
  const snapshotCandidate = snapshotResult?.ok ? rpcObject(snapshotResult.data) : null;
  const snapshot = snapshotCandidate
    && isRecord(snapshotCandidate.event)
    && Array.isArray(snapshotCandidate.form4_rows)
    && Array.isArray(snapshotCandidate.form144_rows)
      ? snapshotCandidate
      : null;
  const eventResult = snapshot ? null : await resolved.select("events", {
      select: "id,raw_item_id,source_code,source_group,event_type,metadata",
      id: `eq.${eventId}`,
      limit: "1",
    });
  if (eventResult) assertRepositoryResult(eventResult, "event");
  const event = snapshot
    ? (isRecord(snapshot.event) ? snapshot.event : undefined)
    : rows(eventResult!.data)[0];
  if (!event) return { status: "not_ready", reason: "event_missing" };
  if (
    stringValue(event.source_code) !== "sec_edgar"
    || stringValue(event.source_group) !== "filings"
  ) {
    return { status: "not_applicable" };
  }

  const metadata = record(event.metadata);
  const formType = normalizedFormType(metadata.form_type);
  if (!formType && stringValue(event.event_type) !== "insider_ownership") {
    return { status: "not_applicable" };
  }
  if (!formType) return { status: "not_ready", reason: "ownership_form_unavailable" };

  const directResults = snapshot ? null : await Promise.all([
      resolved.select("event_form4_transactions", {
        select: "*", event_id: `eq.${eventId}`, order: "transaction_index.asc", limit: "1000",
      }),
      resolved.select("event_form144_proposed_sales", {
        select: "*", event_id: `eq.${eventId}`, order: "proposed_sale_index.asc", limit: "1000",
      }),
    ]);
  if (directResults) {
    assertRepositoryResult(directResults[0], "Form 4 rows");
    assertRepositoryResult(directResults[1], "Form 144 rows");
  }
  const form4Rows = snapshot ? rows(snapshot.form4_rows) : rows(directResults![0].data);
  const form144Rows = snapshot ? rows(snapshot.form144_rows) : rows(directResults![1].data);
  if (form4Rows.length > 0 && form144Rows.length > 0) {
    return { status: "not_ready", reason: "ownership_form_families_mixed" };
  }
  if (formType === "form4" && form144Rows.length > 0) {
    return { status: "not_ready", reason: "ownership_form_mismatch" };
  }
  if (formType === "form144" && form4Rows.length > 0) {
    return { status: "not_ready", reason: "ownership_form_mismatch" };
  }
  const selectedRows = formType === "form4" ? form4Rows : form144Rows;
  if (selectedRows.length === 0) return { status: "not_ready", reason: "ownership_rows_missing" };

  const rawItemId = stringValue(event.raw_item_id);
  if (!UUID_PATTERN.test(rawItemId)) {
    return { status: "not_ready", reason: "ownership_lineage_invalid" };
  }
  const validated = validateCanonicalRows({
    eventId,
    form: formType,
    rows: selectedRows,
    metadataAccession: stringValue(metadata.accession_number),
  });
  if (!validated.ok) return { status: "not_ready", reason: validated.reason };

  const directRows = selectedRows.map(withoutContextFacts);
  const contextProjection = await readOwnershipContextProjection({
    eventId,
    form: formType,
    isAmendment: isAmendmentForm(metadata.form_type),
    storedRows: selectedRows,
    directRows,
    sourceXml: snapshot ? stringValue(snapshot.ownership_source_text) : null,
    fingerprintResult: snapshot ? record(snapshot.context_fingerprint) : null,
  });

  return {
    status: "available",
    form: formType,
    rows: Object.freeze(directRows.map((row) => Object.freeze({ ...row }))) as never,
    context: contextProjection.context,
    contextEligibility: contextProjection.eligibility,
    eventId,
    rawItemId,
    // Ownership XML persistence has no secondary execution job. The stable
    // event identity is therefore the canonical product execution identity.
    sourceExecutionId: eventId,
    accessionNumber: validated.accessionNumber,
    parserVersion: validated.parserVersion,
    persistedAt: validated.persistedAt,
  };
}

async function readOwnershipContextProjection(input: {
  eventId: string;
  form: "form4" | "form144";
  isAmendment: boolean;
  storedRows: Record<string, unknown>[];
  directRows: Record<string, unknown>[];
  sourceXml: string | null;
  fingerprintResult: Record<string, unknown> | null;
}): Promise<{ context: CurrentOwnershipContextResult; eligibility: OwnershipContextEligibility }> {
  if (!input.fingerprintResult) return {
    context: { status: "unavailable", reason: "ownership_context_fingerprint_reader_unavailable" },
    eligibility: { status: "ineligible", reason: "ownership_context_fingerprint_reader_unavailable" },
  };
  const fingerprintResult = input.fingerprintResult;
  const fingerprint = fingerprintResult.source_fingerprint;
  if (
    fingerprintResult.status !== "available"
    || fingerprintResult.form !== input.form
    || !isOwnershipContextSourceFingerprint(fingerprint)
  ) {
    const reason = stringValue(fingerprintResult.reason) || "ownership_context_fingerprint_unavailable";
    return {
      context: { status: "unavailable", reason },
      eligibility: { status: "ineligible", reason },
    };
  }
  const inventory = buildOwnershipContextReferenceInventory({
    eventId: input.eventId,
    form: input.form,
    isAmendment: input.isAmendment,
    sourceFingerprint: fingerprint,
    rows: input.directRows,
    ...(input.sourceXml ? { sourceXml: input.sourceXml } : {}),
  });
  const eligibility: OwnershipContextEligibility = { status: "eligible", inventory };
  const contexts = input.storedRows
    .map((row, index) => ({ value: row.context_facts, reference: inventory.rows[index] }))
    .filter((item) => item.value !== null && item.value !== undefined);
  if (contexts.length === 0) return { context: { status: "absent" }, eligibility };
  if (fingerprintResult.context_ai_refs_valid === false) return {
    context: { status: "malformed", reason: "ownership_context_ai_refs_invalid" },
    eligibility,
  };

  const validatedRows: Array<{ rowRef: string; context: StoredOwnershipContextEnvelope }> = [];
  for (const item of contexts) {
    if (!item.reference) {
      return { context: { status: "malformed", reason: "ownership_context_row_reference_missing" }, eligibility };
    }
    const validated = validateStoredOwnershipContextEnvelope({
      value: item.value,
      rowRef: item.reference.rowRef,
      inventory,
    });
    if (!validated.ok) return {
      context: {
        status: validated.stale ? "stale" : "malformed",
        reason: validated.stale ? "ownership_context_fingerprint_stale" : "ownership_context_invalid",
      },
      eligibility,
    };
    validatedRows.push({ rowRef: item.reference.rowRef, context: validated.value });
  }
  return {
    context: {
      status: "available",
      sourceFingerprint: fingerprint,
      rows: Object.freeze(validatedRows.map((item) => Object.freeze(item))),
    },
    eligibility,
  };
}

function validateCanonicalRows(input: {
  eventId: string;
  form: "form4" | "form144";
  rows: Record<string, unknown>[];
  metadataAccession: string;
}):
  | { ok: true; accessionNumber: string; parserVersion: string; persistedAt: string }
  | { ok: false; reason: string } {
  const identityColumn = input.form === "form4" ? "transaction_index" : "proposed_sale_index";
  const accessions = new Set<string>();
  const parserVersions = new Set<string>();
  const persistedTimes: number[] = [];

  for (const [position, row] of input.rows.entries()) {
    if (stringValue(row.event_id) !== input.eventId || row[identityColumn] !== position) {
      return { ok: false, reason: "ownership_row_identity_invalid" };
    }
    const provenance = record(row.provenance);
    const sourceRow = record(provenance.source_row);
    const issuerIdentity = record(provenance.issuer_identity);
    const accession = stringValue(provenance.accession_number);
    const parserVersion = stringValue(provenance.parser_version);
    const expectedFactKind = input.form === "form4"
      ? "reported_form4_transaction"
      : "form144_proposed_sale_notice";
    const expectedGroups = input.form === "form4"
      ? new Set(["non_derivative_transactions", "derivative_transactions"])
      : new Set(["proposed_sale_rows"]);
    if (
      provenance.source !== "sec_ownership_xml_parser"
      || provenance.canonical_input !== "raw_items.raw_payload.ownership_source_text"
      || provenance.source_verified !== true
      || provenance.parser_fallback !== false
      || provenance.source_format !== "structured_xml"
      || provenance.source_role !== "raw_payload.ownership_source_text"
      || !/^[0-9a-f]{64}$/.test(stringValue(provenance.source_xml_sha256))
      || provenance.fact_kind !== expectedFactKind
      || issuerIdentity.source !== "ownership_xml"
      || issuerIdentity.match_status !== "exact_cik"
      || !sameVerifiedIssuerIdentity(issuerIdentity, row.symbol)
      || !ACCESSION_PATTERN.test(accession)
      || !parserVersion
      || sourceRow.index !== position
      || !expectedGroups.has(stringValue(sourceRow.group))
      || !officialSecSourceForAccession(provenance.source_url, accession)
    ) {
      return { ok: false, reason: "ownership_provenance_invalid" };
    }
    if (
      input.form === "form144"
      && provenance.execution_status !== "proposed_not_executed"
    ) {
      return { ok: false, reason: "ownership_proposed_sale_semantics_invalid" };
    }
    if (
      input.form === "form4"
      && provenance.reporting_owner_scope !== "single_filing_owner"
      && provenance.reporting_owner_scope !== "filing_level_unattributed_owner_set"
    ) {
      return { ok: false, reason: "ownership_reporter_scope_invalid" };
    }
    if (!validCanonicalRow(input.form, row)) {
      return { ok: false, reason: "ownership_row_values_invalid" };
    }
    const persistedAt = Date.parse(stringValue(row.updated_at));
    if (!Number.isFinite(persistedAt)) {
      return { ok: false, reason: "ownership_persisted_at_invalid" };
    }
    accessions.add(accession);
    parserVersions.add(parserVersion);
    persistedTimes.push(persistedAt);
  }

  if (accessions.size !== 1 || parserVersions.size !== 1) {
    return { ok: false, reason: "ownership_row_lineage_mixed" };
  }
  const accessionNumber = [...accessions][0];
  if (input.metadataAccession && input.metadataAccession !== accessionNumber) {
    return { ok: false, reason: "ownership_accession_mismatch" };
  }
  return {
    ok: true,
    accessionNumber,
    parserVersion: [...parserVersions][0],
    persistedAt: new Date(Math.max(...persistedTimes)).toISOString(),
  };
}

function sameVerifiedIssuerIdentity(identity: Record<string, unknown>, rowSymbol: unknown) {
  const xmlCik = normalizeCik(identity.xml_cik);
  const targetCik = normalizeCik(identity.target_cik);
  if (!xmlCik || xmlCik !== targetCik) return false;
  const xmlTicker = normalizeTicker(identity.xml_ticker);
  const targetTicker = normalizeTicker(identity.target_ticker);
  const canonicalTicker = normalizeTicker(identity.canonical_ticker);
  const storedTicker = normalizeTicker(rowSymbol);
  if (xmlTicker && targetTicker && xmlTicker !== targetTicker) return false;
  return canonicalTicker === (xmlTicker || targetTicker)
    && storedTicker === canonicalTicker;
}

function validCanonicalRow(form: "form4" | "form144", row: Record<string, unknown>) {
  if (!stringArray(row.reporting_owner_names)) return false;
  if (form === "form4") {
    return stringArray(row.reporting_owner_roles)
      && stringArray(row.officer_titles)
      && nullableEnum(row.transaction_kind, ["non_derivative", "derivative"])
      && nullableCode(row.transaction_code)
      && nullableEnum(row.acquired_disposed_code, ["A", "D"])
      && row.economic_direction === "unknown"
      && row.transaction_value === null
      && row.transaction_value_availability === "unavailable"
      && row.transaction_value_value_quality === "unknown"
      && row.is_10b5_1 === null
      && nullableDate(row.transaction_date)
      && numericFact(row, "shares", "shares_value_quality", "shares_availability")
      && numericFact(row, "price_per_share", "price_per_share_value_quality", "price_per_share_availability")
      && numericFact(row, "post_transaction_shares", "post_transaction_shares_value_quality", "post_transaction_shares_availability");
  }
  return nullableDate(row.approximate_sale_date)
    && row.proposed_sale_percent === null
    && row.proposed_sale_percent_availability === "unavailable"
    && row.proposed_sale_percent_value_quality === "unknown"
    && numericFact(row, "securities_to_be_sold", "securities_to_be_sold_value_quality", "securities_to_be_sold_availability")
    && numericFact(row, "aggregate_market_value", "aggregate_market_value_value_quality", "aggregate_market_value_availability")
    && numericFact(row, "shares_outstanding", "shares_outstanding_value_quality", "shares_outstanding_availability");
}

function numericFact(
  row: Record<string, unknown>,
  valueColumn: string,
  qualityColumn: string,
  availabilityColumn: string,
) {
  if (row[availabilityColumn] === "available") {
    return nonNegativeFinite(row[valueColumn]) && row[qualityColumn] === "exact";
  }
  return row[availabilityColumn] === "unavailable"
    && row[valueColumn] === null
    && row[qualityColumn] === "unknown";
}

function officialSecSourceForAccession(value: unknown, accession: string) {
  try {
    const url = new URL(stringValue(value));
    const archive = url.pathname.match(/^\/Archives\/edgar\/data\/\d+\/(\d{18})(?:\/|$)/i);
    return url.protocol === "https:"
      && (url.hostname.toLowerCase() === "sec.gov" || url.hostname.toLowerCase().endsWith(".sec.gov"))
      && archive?.[1] === accession.replace(/-/g, "");
  } catch {
    return false;
  }
}

async function defaultRepository(): Promise<OwnershipMonitorRepository> {
  const supabase = await import("../supabase.ts");
  return {
    select: supabase.supabaseSelect,
    readContextSnapshot: (eventId) => supabase.supabaseRpc(
      "read_event_ownership_context_snapshot",
      { p_event_id: eventId },
    ),
  };
}

function assertRepositoryResult(result: RepositoryResult, label: string) {
  if (!result.ok) {
    throw new Error(`Ownership Monitor ${label} read failed: ${result.error || result.status || 0}`);
  }
}

function normalizedFormType(value: unknown): "form4" | "form144" | null {
  const form = stringValue(value).toUpperCase().replace(/^FORM\s+/, "");
  if (form === "4" || form === "4/A") return "form4";
  if (form === "144" || form === "144/A") return "form144";
  return null;
}

function isAmendmentForm(value: unknown) {
  const form = stringValue(value).toUpperCase().replace(/^FORM\s+/, "");
  return form === "4/A" || form === "144/A";
}

function withoutContextFacts(row: Record<string, unknown>) {
  const { context_facts: _contextFacts, ...direct } = row;
  return direct;
}

function rpcObject(value: unknown) {
  if (isRecord(value)) return value;
  if (Array.isArray(value) && value.length === 1 && isRecord(value[0])) return value[0];
  return {};
}

function nullableDate(value: unknown) {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nullableCode(value: unknown) {
  return value === null || (typeof value === "string" && /^[A-Z]$/.test(value));
}

function nullableEnum(value: unknown, allowed: readonly string[]) {
  return value === null || (typeof value === "string" && allowed.includes(value));
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeCik(value: unknown) {
  const digits = stringValue(value).replace(/^0+/, "");
  return digits && /^\d{1,10}$/.test(digits) ? digits.padStart(10, "0") : "";
}

function normalizeTicker(value: unknown) {
  const ticker = stringValue(value).toUpperCase();
  return ticker && /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker) ? ticker : "";
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0);
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
