import { getServerEnv } from "@/lib/env";
import { buildSecFilingAnalysisPackage } from "@/lib/prompts/secFilingAnalysisPackage";
import { buildSecFilingAnalysisPrompt, type SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { parseSecS3Filing, type SecS3FilingFacts } from "@/lib/sources/sec/s3Parser";
import { supabaseSelect } from "@/lib/supabase";

type PreviewOptions = {
  dryRun?: boolean;
  rawItemId?: string;
  accessionNumber?: string;
  ticker?: string;
  calendarCandidate?: boolean;
};

type RawItemRow = Record<string, unknown>;

type OpenAIResponseBody = {
  id?: string;
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
};

export type SecFilingAnalysisRunResult = {
  ok: boolean;
  stage: "raw_item" | "openai" | "complete";
  status: number;
  model?: string;
  openAiResponseId?: string | null;
  sourceItem?: ReturnType<typeof summarizeRawRow>;
  input?: SecFilingAnalysisInput;
  analysis?: Record<string, unknown> | null;
  outputText?: string;
  error?: string;
  rawOpenAIResponse?: OpenAIResponseBody | null;
};

export async function runSecFilingAnalysisPreview(options: PreviewOptions = {}) {
  const rawResult = await findSecRawItem(options);
  if (!rawResult.ok || !rawResult.rawItem) {
    return {
      ok: false,
      stage: "raw_item",
      status: rawResult.status,
      error: rawResult.error || "SEC raw item not found",
    };
  }

  const input = await buildInputFromSecRawRowWithContext(rawResult.rawItem);
  const prompt = buildSecFilingAnalysisPrompt(input);

  if (options.dryRun) {
    return {
      ok: true,
      stage: "dry_run",
      sourceItem: summarizeRawRow(rawResult.rawItem),
      input,
      prompt: {
        key: prompt.key,
        version: prompt.version,
        system: prompt.system,
        responseFormat: prompt.responseFormat,
      },
      analysis: null,
    };
  }

  const analysisResult = await runSecFilingAnalysisForRawRow(rawResult.rawItem);

  return {
    ...analysisResult,
    stage: analysisResult.ok ? "complete" : analysisResult.stage,
  };
}

export async function runSecFilingAnalysisForRawRow(rawItem: RawItemRow): Promise<SecFilingAnalysisRunResult> {
  const input = await buildInputFromSecRawRowWithContext(rawItem);
  const prompt = buildSecFilingAnalysisPrompt(input);

  const env = getServerEnv();

  if (!env.openAiApiKey) {
    return {
      ok: false,
      stage: "openai",
      status: 0,
      error: "OPENAI_API_KEY is missing",
      sourceItem: summarizeRawRow(rawItem),
      input,
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.openAiModel,
      instructions: prompt.system,
      input: prompt.user,
      max_output_tokens: 5000,
      text: {
        format: {
          ...prompt.responseFormat.json_schema,
          type: "json_schema",
        },
      },
    }),
  });

  const responseBody = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
  if (!response.ok) {
    return {
      ok: false,
      stage: "openai",
      status: response.status,
      error: responseBody?.error?.message || response.statusText,
      sourceItem: summarizeRawRow(rawItem),
      input,
      rawOpenAIResponse: responseBody,
    };
  }

  const outputText = readResponseOutputText(responseBody);
  const analysis = parseAnalysisJson(outputText);

  return {
    ok: Boolean(analysis),
    stage: "complete",
    status: response.status,
    model: env.openAiModel,
    openAiResponseId: responseBody?.id || null,
    sourceItem: summarizeRawRow(rawItem),
    input,
    analysis,
    outputText,
    error: analysis ? undefined : "OpenAI response did not contain parseable JSON",
  };
}

export async function findSecRawItem(options: PreviewOptions = {}) {
  if (options.rawItemId) {
    const result = await supabaseSelect("raw_items", {
      select: "*",
      id: `eq.${options.rawItemId}`,
      source_code: "eq.sec_edgar",
      limit: "1",
    });
    return readRawItemResult(result);
  }

  if (options.accessionNumber) {
    const result = await supabaseSelect("raw_items", {
      select: "*",
      source_code: "eq.sec_edgar",
      source_unique_id: `eq.${options.accessionNumber}`,
      limit: "1",
    });
    return readRawItemResult(result);
  }

  const result = await supabaseSelect("raw_items", {
    select: "*",
    source_code: "eq.sec_edgar",
    order: "published_at.desc",
    limit: "100",
  });
  if (!result.ok) return { ok: false, status: result.status, error: result.error, rawItem: null };

  const rows = Array.isArray(result.data) ? (result.data as RawItemRow[]) : [];
  const ticker = stringValue(options.ticker).toUpperCase();
  const candidates = ticker ? rows.filter((row) => readRawTicker(row) === ticker) : rows;
  const rawItem = options.calendarCandidate ? candidates.find(hasCalendarCandidateText) : candidates[0];

  return {
    ok: Boolean(rawItem),
    status: result.status,
    rawItem: rawItem || null,
    error: rawItem ? undefined : "SEC raw item not found",
  };
}

export function buildInputFromSecRawRow(rawItem: RawItemRow): SecFilingAnalysisInput {
  const filingPackage = buildSecFilingAnalysisPackage(rawItem, {
    maxChars: 50_000,
    maxDocumentChars: 24_000,
  }) as Record<string, unknown>;

  return {
    filing_package: filingPackage,
  };
}

async function buildInputFromSecRawRowWithContext(rawItem: RawItemRow): Promise<SecFilingAnalysisInput> {
  const input = buildInputFromSecRawRow(rawItem);
  await attachParentRegistrationContext(input, rawItem);
  return input;
}

async function attachParentRegistrationContext(input: SecFilingAnalysisInput, rawItem: RawItemRow) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const s3 = readRecord(hardParsers?.s3);
  const amendment = readRecord(s3?.amendment);
  if (!filingPackage || !s3 || !amendment || amendment.is_amendment !== true) return;

  const registrationNumber = stringValue(amendment.registration_number);
  if (!registrationNumber) return;

  const parentContext = await findParentS3RegistrationContext({
    currentAccession: stringValue(filingPackage.accession_number) || stringValue(rawItem.source_unique_id),
    rawItem,
    registrationNumber,
  });
  if (!parentContext) return;

  filingPackage.parent_registration_context = parentContext;
}

async function findParentS3RegistrationContext({
  currentAccession,
  rawItem,
  registrationNumber,
}: {
  currentAccession: string;
  rawItem: RawItemRow;
  registrationNumber: string;
}) {
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const metadata = readRecord(rawItem.metadata) || {};
  const ticker = (stringValue(rawPayload.ticker) || stringValue(metadata.ticker)).toUpperCase();
  const rows = await fetchS3ParentCandidateRows(ticker);
  if (!rows.length) return null;

  const currentFiledAt = Date.parse(stringValue(rawItem.published_at));
  const matches: Array<{
    row: RawItemRow;
    parsed: SecS3FilingFacts;
    score: number;
  }> = [];

  for (const row of rows) {
    const accession = readRawAccession(row);
    if (currentAccession && accession === currentAccession) continue;

    const formType = readRawFormType(row);
    if (!/^S-3(?:ASR|\/A)?$/i.test(formType)) continue;

    const rowTicker = readRawTicker(row);
    if (ticker && rowTicker && rowTicker !== ticker) continue;

    const parsed = parseSecS3Filing(rawRowToS3ParseInput(row));
    if (!sameRegistrationNumber(parsed.amendment.registration_number?.value, registrationNumber)) continue;

    const filedAt = Date.parse(stringValue(row.published_at));
    let score = 0;
    if (!parsed.amendment.is_amendment) score += 100;
    if (Number.isFinite(currentFiledAt) && Number.isFinite(filedAt) && filedAt <= currentFiledAt) score += 50;
    if (parsed.fee_table.present) score += 10;
    if (parsed.selling_stockholders.length) score += 10;
    if (parsed.extracted_field_count) score += Math.min(10, parsed.extracted_field_count);

    matches.push({ row, parsed, score });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return Date.parse(stringValue(right.row.published_at)) - Date.parse(stringValue(left.row.published_at));
  });

  const best = matches[0];
  if (!best) return null;

  return buildParentS3Context({
    matchCount: matches.length,
    parsed: best.parsed,
    registrationNumber,
    row: best.row,
  });
}

async function fetchS3ParentCandidateRows(ticker: string) {
  const select = "id,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata";
  const withTicker = ticker
    ? await supabaseSelect("raw_items", {
        select,
        source_code: "eq.sec_edgar",
        "raw_payload->>ticker": `eq.${ticker}`,
        order: "published_at.desc",
        limit: "200",
      })
    : null;

  if (withTicker?.ok && Array.isArray(withTicker.data) && withTicker.data.length > 0) return withTicker.data as RawItemRow[];

  const result = await supabaseSelect("raw_items", {
    select,
    source_code: "eq.sec_edgar",
    order: "published_at.desc",
    limit: "200",
  });
  return result.ok && Array.isArray(result.data) ? (result.data as RawItemRow[]) : [];
}

async function buildParentS3Context({
  matchCount,
  parsed,
  registrationNumber,
  row,
}: {
  matchCount: number;
  parsed: SecS3FilingFacts;
  registrationNumber: string;
  row: RawItemRow;
}) {
  return {
    source: "raw_items",
    match_method: "registration_number",
    match_count: matchCount,
    registration_number: registrationNumber,
    raw_item_id: stringValue(row.id) || null,
    accession_number: parsed.accession_number,
    form_type: parsed.form_type,
    filed_at: parsed.filed_at,
    source_url: parsed.source_url,
    company_name: parsed.issuer,
    ticker: parsed.ticker,
    registration_statement_kind: parsed.registration_statement_kind?.value || null,
    registration_status: parsed.registration_status?.value || null,
    prospectus_status: parsed.prospectus_status?.value || null,
    primary_or_resale: parsed.primary_or_resale?.value || null,
    securities_registered: parsed.securities_registered.map((item) => item.value),
    shares_registered: parsed.shares_registered?.text || null,
    resale_share_count: parsed.resale_share_count?.text || null,
    current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
    offering_terms: {
      offering_type: parsed.offering_terms.offering_type?.value || null,
      security_type: parsed.offering_terms.security_type?.value || null,
      primary_or_resale: parsed.offering_terms.primary_or_resale?.value || null,
      offering_amount: parsed.offering_terms.offering_amount?.text || null,
      resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
      current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
      warrant_coverage: parsed.offering_terms.warrant_coverage?.value || null,
      conversion_price: parsed.offering_terms.conversion_price?.text || null,
    },
    fee_table: {
      present: parsed.fee_table.present,
      text_available: parsed.fee_table.text_available,
      row_count: parsed.fee_table.rows.length,
      total_offering_amount: parsed.fee_table.totals.total_offering_amount?.text || null,
      net_fee_due: parsed.fee_table.totals.net_fee_due?.text || null,
    },
    selling_stockholders: {
      count: parsed.selling_stockholders.length,
      top_holders: parsed.selling_stockholders.slice(0, 8).map((holder) => ({
        holder_name: holder.holder_name,
        shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
        beneficially_owned_before: holder.beneficially_owned_before?.text || null,
        beneficially_owned_after: holder.beneficially_owned_after?.text || null,
        percent_after: holder.percent_after?.text || null,
      })),
    },
    existing_analysis: await fetchExistingParentAnalysis(stringValue(row.id)),
    needs_human_review: parsed.needs_human_review,
    review_reasons: parsed.review_reasons,
  };
}

async function fetchExistingParentAnalysis(rawItemId: string) {
  if (!rawItemId) return null;

  const eventResult = await supabaseSelect("events", {
    select: "*",
    source_group: "eq.filings",
    raw_item_id: `eq.${rawItemId}`,
    order: "detected_at.desc",
    limit: "1",
  });
  const event = eventResult.ok && Array.isArray(eventResult.data) ? readRecord(eventResult.data[0]) : null;
  if (!event) return null;

  const analysisResult = await supabaseSelect("event_analysis", {
    select: "*",
    event_id: `eq.${stringValue(event.id)}`,
    limit: "1",
  });
  const analysis = analysisResult.ok && Array.isArray(analysisResult.data) ? readRecord(analysisResult.data[0]) : null;

  return {
    event_id: stringValue(event.id) || null,
    event_type: stringValue(event.event_type) || null,
    score: numberValue(event.score),
    delivery_level: stringValue(event.delivery_level) || null,
    signal: stringValue(event.signal) || null,
    event_title: stringValue(event.event_title) || stringValue(event.title) || null,
    quick_take: stringValue(event.quick_take) || stringValue(analysis?.quick_take) || null,
    summary: stringValue(event.summary) || stringValue(analysis?.summary) || null,
    key_evidence: readStringArray(analysis?.key_evidence).slice(0, 3),
    what_to_watch_next: readStringArray(analysis?.what_to_watch_next).slice(0, 3),
  };
}

function rawRowToS3ParseInput(row: RawItemRow) {
  return {
    rawItemId: stringValue(row.id),
    sourceUniqueId: stringValue(row.source_unique_id),
    sourceUrl: stringValue(row.source_url),
    title: stringValue(row.title),
    publishedAt: stringValue(row.published_at),
    bodyText: stringValue(row.body_text),
    analysisText: stringValue(row.analysis_text),
    rawPayload: row.raw_payload,
    metadata: row.metadata,
  };
}

function sameRegistrationNumber(left: string | null | undefined, right: string | null | undefined) {
  const normalize = (value: string | null | undefined) => stringValue(value).replace(/\D/g, "");
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  return Boolean(leftValue && rightValue && leftValue === rightValue);
}

function readRawItemResult(result: { ok: boolean; status: number; error?: string; data: unknown }) {
  const row = Array.isArray(result.data) ? (result.data[0] as RawItemRow | undefined) : null;
  return {
    ok: result.ok && Boolean(row),
    status: result.status,
    rawItem: row || null,
    error: result.error,
  };
}

function summarizeRawRow(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload) || {};
  return {
    id: stringValue(row.id),
    source_code: stringValue(row.source_code),
    source_group: stringValue(row.source_group),
    source_url: stringValue(row.source_url),
    source_unique_id: stringValue(row.source_unique_id),
    title: stringValue(row.title),
    published_at: stringValue(row.published_at),
    form_type: stringValue(rawPayload.form_type),
    company_name: stringValue(rawPayload.company_name),
    ticker: stringValue(rawPayload.ticker),
    exchange: stringValue(rawPayload.exchange),
    bodyChars: stringValue(row.body_text).length,
    analysisChars: stringValue(row.analysis_text).length,
  };
}

function hasCalendarCandidateText(row: RawItemRow) {
  const text = `${row.title || ""}\n${row.analysis_text || ""}\n${row.body_text || ""}`.toLowerCase();
  return [
    "earnings call",
    "conference call",
    "webcast",
    "annual meeting",
    "special meeting",
    "record date",
    "payment date",
    "ex-dividend",
    "expiration date",
    "will be held",
    "expected to close",
    "effective date",
    "nasdaq hearing",
    "pdufa",
  ].some((term) => text.includes(term));
}

function readRawTicker(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return (stringValue(rawPayload?.ticker) || stringValue(metadata?.ticker)).toUpperCase();
}

function readRawAccession(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  return stringValue(rawPayload?.accession_number) || stringValue(row.source_unique_id);
}

function readRawFormType(row: RawItemRow) {
  const rawPayload = readRecord(row.raw_payload);
  const metadata = readRecord(row.metadata);
  return stringValue(rawPayload?.form_type) || stringValue(metadata?.form_type);
}

function readResponseOutputText(body: OpenAIResponseBody | null) {
  if (!body) return "";
  if (typeof body.output_text === "string") return body.output_text;

  for (const item of body.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") return content.text;
    }
  }

  return "";
}

function parseAnalysisJson(value: string) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    const extracted = extractJsonObject(value);
    if (!extracted) return null;
    try {
      return JSON.parse(extracted) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function extractJsonObject(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{") && fenced.endsWith("}")) return fenced;

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end <= start) return "";
  return value.slice(start, end + 1);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}
