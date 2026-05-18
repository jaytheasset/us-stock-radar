import { getServerEnv } from "@/lib/env";
import { buildSecFilingAnalysisPackage } from "@/lib/prompts/secFilingAnalysisPackage";
import { buildSecFilingAnalysisPrompt, type SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
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

  const input = buildInputFromSecRawRow(rawResult.rawItem);
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
  const input = buildInputFromSecRawRow(rawItem);
  const prompt = buildSecFilingAnalysisPrompt(input);
  const deterministicArchive = buildDeterministicArchiveAnalysis(rawItem, input);
  if (deterministicArchive) {
    return {
      ok: true,
      stage: "complete",
      status: 200,
      model: "deterministic/sec-s3a-amendment-router-v1",
      openAiResponseId: null,
      sourceItem: summarizeRawRow(rawItem),
      input,
      analysis: deterministicArchive,
      outputText: JSON.stringify(deterministicArchive),
    };
  }

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

function buildDeterministicArchiveAnalysis(rawItem: RawItemRow, input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const s3 = readRecord(hardParsers.s3);
  if (stringValue(s3?.analysis_strategy) !== "routine_amendment_archive") return null;

  const amendment = readRecord(s3?.amendment) || {};
  const rawPayload = readRecord(rawItem.raw_payload) || {};
  const ticker = stringValue(rawPayload.ticker);
  const exchange = stringValue(rawPayload.exchange);
  const amendmentNumber = amendment.amendment_number ? `Amendment No. ${amendment.amendment_number}` : "S-3/A amendment";
  const addedExhibits = Array.isArray(amendment.added_exhibits) ? amendment.added_exhibits.map(stringValue).filter(Boolean) : [];
  const exhibitText = addedExhibits.length ? ` Added exhibits: ${addedExhibits.slice(0, 3).join(", ")}.` : "";
  const summary =
    `${amendmentNumber} appears routine: the parser found no offering term, fee table, selling stockholder, or distribution-change signal.${exhibitText} Open the original filing for full details if needed.`;

  return {
    source_group: "filings",
    market_scope: "company",
    event_type: "other",
    event_title: `${ticker || stringValue(rawPayload.company_name) || "Issuer"} routine S-3/A amendment`,
    primary_ticker: {
      ticker: ticker || null,
      exchange: exchange || null,
    },
    tickers: ticker ? [{ ticker, exchange: exchange || null, role: "primary" }] : [],
    sector: null,
    industry_group: null,
    theme_group: null,
    sub_theme: null,
    score: 10,
    score_reason: "Routine amendment; no material term change signal.",
    signal: "neutral",
    quick_take: "Routine S-3/A amendment archived without full SEC analysis.",
    summary,
    why_it_matters: "The amendment does not appear to change offering economics or resale overhang.",
    bullish_points: [],
    bearish_points: [],
    key_evidence: [
      "S-3/A parser classified the amendment as routine.",
      ...addedExhibits.slice(0, 2).map((item) => `Added exhibit: ${item}`),
    ].slice(0, 3),
    what_to_watch_next: ["Review the parent registration statement if this issuer becomes relevant."],
    related_tickers: [],
    calendar_items: [],
    confidence: "medium",
    needs_human_review: false,
  };
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
  return stringValue(rawPayload?.ticker).toUpperCase();
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
