export const SEC_DIAGNOSTIC_SCHEMA_VERSION = "sec_debug_diagnostics_v1" as const;

export type SecDiagnosticFilters = {
  eventId: string | null;
  ticker: string | null;
  accessionNumber: string | null;
};

export type SecDiagnosticFilterResult =
  | { ok: true; filters: SecDiagnosticFilters }
  | { ok: false; error: { code: "INVALID_DIAGNOSTIC_FILTER"; field: string; message: string } };

export type SecDiagnosticSnapshot = {
  schema_version: typeof SEC_DIAGNOSTIC_SCHEMA_VERSION;
  generated_at: string;
  context: {
    page: "/development/sec";
    room: { key: string; label: string; forms: string[] };
    filters: SecDiagnosticFilters;
  };
  summary: {
    status: "available" | "empty";
    result_count: number;
    warning_count: number;
    error_count: number;
  };
  results: SecDiagnosticResult[];
};

export type SecDiagnosticResult = {
  identity: {
    event_id: string | null;
    raw_item_id: string | null;
    accession_number: string | null;
    ticker: string | null;
    company_name: string | null;
    cik: string | null;
    form_type: string | null;
    title: string | null;
  };
  status: {
    overall: string;
    collection: string;
    analysis: string;
    background: string;
  };
  timestamps: {
    filed_at: string | null;
    collected_at: string | null;
    event_observed_at: string | null;
    analysis_started_at: string | null;
    analyzed_at: string | null;
    background_updated_at: string | null;
  };
  sources: Array<{
    name: "raw_items" | "source_runs" | "events" | "event_analysis" | "ai_runs" | "ai_outputs.validation_repair_trace";
    status: "available" | "missing" | "unavailable";
    record_id: string | null;
    observed_at: string | null;
  }>;
  cache: {
    status: "not_used";
    reason: string;
  };
  background: {
    workflow_analysis_status: string;
    source_run_status: string;
    updated_at: string | null;
  };
  analysis: {
    first_result: { availability: "available" | "record_missing"; value: Record<string, unknown> | null };
    validation: { availability: "available" | "record_missing"; errors: Array<Record<string, unknown>> };
    correction: {
      availability: "available" | "record_missing";
      attempted: boolean | null;
      status: string;
      prompt_reference: { key: string | null; version: string | null } | null;
      source_basis: { description: string | null; source_block_ids: string[] } | null;
      applied_changes: Array<Record<string, unknown>>;
      unresolved: Array<Record<string, unknown>>;
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    };
  };
  warnings: string[];
  errors: string[];
  links: { filing_detail: string | null };
};

type SnapshotInput = {
  room: { key: string; label: string; forms: string[] };
  records: Array<Record<string, unknown>>;
  filters?: Partial<SecDiagnosticFilters>;
  generatedAt?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

export function parseSecDiagnosticFilters(input: {
  eventId?: string | null;
  ticker?: string | null;
  accessionNumber?: string | null;
}): SecDiagnosticFilterResult {
  const eventId = stringValue(input.eventId);
  const ticker = stringValue(input.ticker).toUpperCase();
  const accessionNumber = stringValue(input.accessionNumber);

  if (eventId && !UUID_PATTERN.test(eventId)) {
    return invalidFilter("eventId", "eventId must be a UUID.");
  }
  if (ticker && !TICKER_PATTERN.test(ticker)) {
    return invalidFilter("ticker", "ticker must be 1-10 allowlisted market-symbol characters.");
  }
  if (accessionNumber && !ACCESSION_PATTERN.test(accessionNumber)) {
    return invalidFilter("accession", "accession must use the 0000000000-00-000000 format.");
  }

  return {
    ok: true,
    filters: {
      eventId: eventId || null,
      ticker: ticker || null,
      accessionNumber: accessionNumber || null,
    },
  };
}

export function buildSecDiagnosticSnapshot(input: SnapshotInput): SecDiagnosticSnapshot {
  const filters: SecDiagnosticFilters = {
    eventId: stringValue(input.filters?.eventId) || null,
    ticker: stringValue(input.filters?.ticker).toUpperCase() || null,
    accessionNumber: stringValue(input.filters?.accessionNumber) || null,
  };
  const results = input.records
    .filter((record) => matchesFilters(record, filters))
    .map(buildDiagnosticResult);

  return {
    schema_version: SEC_DIAGNOSTIC_SCHEMA_VERSION,
    generated_at: input.generatedAt || new Date().toISOString(),
    context: {
      page: "/development/sec",
      room: {
        key: input.room.key,
        label: input.room.label,
        forms: [...input.room.forms],
      },
      filters,
    },
    summary: {
      status: results.length ? "available" : "empty",
      result_count: results.length,
      warning_count: results.reduce((count, result) => count + result.warnings.length, 0),
      error_count: results.reduce((count, result) => count + result.errors.length, 0),
    },
    results,
  };
}

function buildDiagnosticResult(item: Record<string, unknown>): SecDiagnosticResult {
  const collection = readRecord(item.collection_diagnostics) || {};
  const trace = readRecord(item.validation_repair_trace);
  const traceAvailable = Boolean(trace && stringValue(trace.availability) !== "historical_missing");
  const analysisRun = readRecord(trace?.analysis_run);
  const initial = readRecord(trace?.initial_analysis);
  const repair = readRecord(trace?.repair_analysis);
  const repairPrompt = readRecord(trace?.repair_prompt);
  const sourceSelection = readRecord(trace?.source_selection);
  const warnings = recordArray(trace?.warnings).map(projectValidationEntry);
  const sourceRunError = redactDiagnosticMessage(collection.source_run_error);
  const errors = [sourceRunError, redactDiagnosticMessage(trace?.error_summary)].filter(Boolean);
  const warningMessages = warnings
    .map((warning) => stringValue(warning.description) || stringValue(warning.message) || stringValue(warning.code))
    .filter(Boolean);
  const eventId = nullableString(item.event_id);
  const rawItemId = nullableString(item.raw_item_id);
  const analysisExists = item.analysis_exists === true;
  const collectionStatus = stringValue(collection.collection_status) || "unavailable";
  const workflowStatus = stringValue(collection.workflow_analysis_status) || "unknown";
  const sourceRunStatus = stringValue(collection.source_run_status) || "unavailable";
  const analyzedAt = nullableString(item.analyzed_at);
  const traceAvailability = traceAvailable ? "available" : "record_missing";

  return {
    identity: {
      event_id: eventId,
      raw_item_id: rawItemId,
      accession_number: nullableString(item.accession_number),
      ticker: nullableString(item.ticker),
      company_name: nullableString(item.company_name),
      cik: nullableString(item.cik),
      form_type: nullableString(item.form_type),
      title: nullableString(item.title),
    },
    status: {
      overall: errors.length ? "error" : warningMessages.length ? "warning" : "available",
      collection: collectionStatus,
      analysis: stringValue(item.analysis_status) || (analysisExists ? "completed" : "record_missing"),
      background: workflowStatus,
    },
    timestamps: {
      filed_at: nullableString(item.filed_at),
      collected_at: nullableString(collection.collected_at),
      event_observed_at: nullableString(collection.event_observed_at),
      analysis_started_at: nullableString(analysisRun?.started_at),
      analyzed_at: analyzedAt,
      background_updated_at: nullableString(collection.workflow_analysis_updated_at),
    },
    sources: [
      sourceState("raw_items", rawItemId, collectionStatus === "collected", nullableString(collection.collected_at)),
      sourceState("source_runs", nullableString(collection.source_run_id), sourceRunStatus !== "unavailable", nullableString(collection.source_run_finished_at) || nullableString(collection.source_run_started_at)),
      sourceState("events", eventId, Boolean(eventId), nullableString(collection.event_observed_at)),
      sourceState("event_analysis", eventId, analysisExists, analyzedAt),
      sourceState("ai_runs", nullableString(analysisRun?.id), Boolean(analysisRun), analyzedAt),
      sourceState("ai_outputs.validation_repair_trace", nullableString(collection.repair_trace_record_id), traceAvailable, analyzedAt),
    ],
    cache: {
      status: "not_used",
      reason: "Persisted review reads named database records directly; browser or application cache state is not inferred.",
    },
    background: {
      workflow_analysis_status: workflowStatus,
      source_run_status: sourceRunStatus,
      updated_at: nullableString(collection.workflow_analysis_updated_at),
    },
    analysis: {
      first_result: {
        availability: traceAvailable && initial ? "available" : "record_missing",
        value: traceAvailable ? projectAnalysisValue(initial?.parsed_result) : null,
      },
      validation: {
        availability: traceAvailability,
        errors: traceAvailable ? warnings : [],
      },
      correction: {
        availability: traceAvailability,
        attempted: traceAvailable ? trace?.attempted === true : null,
        status: traceAvailable ? stringValue(trace?.status) || (trace?.attempted === true ? "executed" : "not_attempted") : "record_missing",
        prompt_reference: traceAvailable && repairPrompt
          ? { key: nullableString(repairPrompt.key), version: nullableString(repairPrompt.version) }
          : null,
        source_basis: traceAvailable && sourceSelection
          ? {
              description: nullableString(sourceSelection.description),
              source_block_ids: stringArray(sourceSelection.source_block_ids).slice(0, 50),
            }
          : null,
        applied_changes: traceAvailable ? recordArray(trace?.applied_changes).map(projectChangeEntry) : [],
        unresolved: traceAvailable ? recordArray(trace?.unresolved).map(projectValidationEntry) : [],
        before: traceAvailable ? projectAnalysisValue(initial?.parsed_result) : null,
        after: traceAvailable && trace?.attempted === true
          ? projectAnalysisValue(repair?.parsed_result || trace?.final_analysis)
          : null,
      },
    },
    warnings: warningMessages.map(redactDiagnosticMessage).filter(Boolean),
    errors,
    links: {
      filing_detail: safeLocalPath(item.detail_url),
    },
  };
}

function projectAnalysisValue(value: unknown) {
  const record = readRecord(value);
  if (!record) return null;
  const projected: Record<string, unknown> = {};
  for (const key of [
    "event_title",
    "event_type",
    "quick_take",
    "summary",
    "score",
    "signal",
    "needs_human_review",
    "why_it_matters",
  ]) {
    const scalar = safeScalar(record[key]);
    if (scalar !== null) projected[key] = scalar;
  }
  for (const key of ["key_evidence", "what_to_watch_next"]) {
    const values = stringArray(record[key]).slice(0, 20).map((entry) => redactDiagnosticMessage(entry));
    if (values.length) projected[key] = values;
  }
  return Object.keys(projected).length ? projected : null;
}

function projectValidationEntry(value: Record<string, unknown>) {
  return compactRecord({
    code: safeScalar(value.code),
    field: safeScalar(value.field),
    path: safeScalar(value.path),
    severity: safeScalar(value.severity),
    description: redactDiagnosticMessage(value.description),
    message: redactDiagnosticMessage(value.message),
  });
}

function projectChangeEntry(value: Record<string, unknown>) {
  return compactRecord({
    path: safeScalar(value.path),
    field: safeScalar(value.field),
    before: safeScalar(value.before),
    after: safeScalar(value.after),
    reason: redactDiagnosticMessage(value.reason),
  });
}

function sourceState(
  name: SecDiagnosticResult["sources"][number]["name"],
  recordId: string | null,
  available: boolean,
  observedAt: string | null,
) {
  return {
    name,
    status: (available ? "available" : recordId ? "missing" : "unavailable") as "available" | "missing" | "unavailable",
    record_id: recordId,
    observed_at: observedAt,
  };
}

function matchesFilters(record: Record<string, unknown>, filters: SecDiagnosticFilters) {
  if (filters.eventId && stringValue(record.event_id) !== filters.eventId) return false;
  if (filters.ticker && stringValue(record.ticker).toUpperCase() !== filters.ticker) return false;
  if (filters.accessionNumber && stringValue(record.accession_number) !== filters.accessionNumber) return false;
  return true;
}

function invalidFilter(field: string, message: string): SecDiagnosticFilterResult {
  return { ok: false, error: { code: "INVALID_DIAGNOSTIC_FILTER", field, message } };
}

function safeLocalPath(value: unknown) {
  const path = stringValue(value);
  return path.startsWith("/") && !path.startsWith("//") ? path : null;
}

function redactDiagnosticMessage(value: unknown) {
  return stringValue(value)
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(authorization|cookie|password|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function safeScalar(value: unknown): string | number | boolean | null {
  if (typeof value === "boolean" || typeof value === "number") return value;
  const text = redactDiagnosticMessage(value);
  return text || null;
}

function compactRecord(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== ""));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.map(readRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
