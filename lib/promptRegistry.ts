import {
  NEWS_EVENT_ANALYSIS_PROMPT_KEY,
  NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
  newsEventAnalysisInputTemplate,
  newsEventAnalysisResponseSchema,
  newsEventAnalysisSystemPrompt,
} from "@/lib/prompts/newsEventAnalysis";
import {
  SEC_FILING_ANALYSIS_PROMPT_KEY,
  SEC_FILING_ANALYSIS_PROMPT_VERSION,
  secFilingAnalysisInputTemplate,
  secFilingAnalysisResponseSchema,
  secFilingAnalysisSystemPrompt,
} from "@/lib/prompts/secFilingAnalysis";
import {
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
  SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
  secS3AmendmentTriageResponseSchema,
  secS3AmendmentTriageSystemPrompt,
} from "@/lib/prompts/secS3AmendmentTriage";
import {
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION,
  secS3OfferingAnalysisResponseSchema,
  secS3RequiredOutputSystemPrompt,
} from "@/lib/prompts/secS3OfferingAnalysis";

export type PromptTemplateDraft = {
  key: string;
  version: string;
  task: string;
  model: string;
  status: "draft" | "active" | "planned";
  owner: "ai";
  inputTables: string[];
  outputTarget: string;
  notes: string;
  systemPrompt?: string;
  userInputTemplate?: string;
  responseSchema?: unknown;
  runtimeNotes?: string;
};

export const promptTemplates: PromptTemplateDraft[] = [
  {
    key: NEWS_EVENT_ANALYSIS_PROMPT_KEY,
    version: NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
    task: "Newswire event analysis",
    model: "gemini-2.5-flash-lite",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "events + event_analysis + event_tickers + event_calendar_items",
    notes:
      "Single-call structured news analysis for company, clinical/FDA, and broad-market events after parser and deterministic filtering.",
    systemPrompt: newsEventAnalysisSystemPrompt,
    userInputTemplate: newsEventAnalysisInputTemplate,
    responseSchema: newsEventAnalysisResponseSchema,
    runtimeNotes:
      "One Gemini JSON-mode call. The response contract is included in prompt contents; generationConfig.responseSchema is omitted to avoid provider schema state limits.",
  },
  {
    key: "press_release_event_enrichment",
    version: "v1",
    task: "Press release event enrichment",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items", "events"],
    outputTarget: "events.metadata.llm",
    notes: "Summaries, extracted facts, risk flags, and confidence support for newswire events.",
  },
  {
    key: SEC_FILING_ANALYSIS_PROMPT_KEY,
    version: SEC_FILING_ANALYSIS_PROMPT_VERSION,
    task: "SEC filing event enrichment",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items", "events"],
    outputTarget: "events + event_analysis + event_tickers + event_calendar_items",
    notes:
      "Facts-first SEC filing analysis. Calendar items from exact filing dates are stored as confirmed schedules.",
    systemPrompt: secFilingAnalysisSystemPrompt,
    userInputTemplate: secFilingAnalysisInputTemplate,
    responseSchema: secFilingAnalysisResponseSchema,
    runtimeNotes:
      "OpenAI call: instructions = systemPrompt, input = JSON.stringify({ filing_package }), text.format = responseSchema.",
  },
  {
    key: SEC_S3_AMENDMENT_TRIAGE_PROMPT_KEY,
    version: SEC_S3_AMENDMENT_TRIAGE_PROMPT_VERSION,
    task: "SEC S-3/A amendment triage",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "skip_analysis or route to SEC S-3 offering audit",
    notes:
      "Lightweight S-3/A first pass. It checks whether the amendment itself changed material offering terms before running numeric offering audit.",
    systemPrompt: secS3AmendmentTriageSystemPrompt,
    userInputTemplate: secFilingAnalysisInputTemplate,
    responseSchema: secS3AmendmentTriageResponseSchema,
    runtimeNotes:
      "Runtime runs this before the offering audit only for S-3/A. Routine amendments return skip_analysis and do not run audit or detailed analysis.",
  },
  {
    key: SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
    version: SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION,
    task: "SEC S-3 offering analysis",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "Required Output JSON with display_payload offering_terms UI fields",
    notes:
      "Dedicated S-3/F-3 registration-family contract using the shared 424B offering UI output schema. Source text and source blocks are authoritative.",
    systemPrompt: secS3RequiredOutputSystemPrompt,
    userInputTemplate: secFilingAnalysisInputTemplate,
    responseSchema: secS3OfferingAnalysisResponseSchema,
    runtimeNotes:
      "Runtime calls buildSecS3OfferingAnalysisPrompt(), which uses secS3RequiredOutputSystemPrompt and sec424bRequiredOutputSchema. Offering UI data is stored in display_payload.data and normalized through the common offering adapter.",
  },
  {
    key: "fda_announcement_enrichment",
    version: "v1",
    task: "FDA announcement enrichment",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items", "events"],
    outputTarget: "events.metadata.llm",
    notes: "Regulatory facts, product names, approval status, and affected public companies.",
  },
  {
    key: "government_release_relevance",
    version: "v1",
    task: "Government release relevance check",
    model: "gpt-5-mini",
    status: "planned",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "events.metadata.llm",
    notes: "OFAC, DOJ, DEA, and White House relevance scoring after deterministic extraction.",
  },
  {
    key: "delivery_context_summary",
    version: "v1",
    task: "Notification context summary",
    model: "gpt-5-mini",
    status: "planned",
    owner: "ai",
    inputTables: ["events", "market_snapshots"],
    outputTarget: "deliveries.metadata",
    notes: "Optional concise explanation for Telegram/Web Push. Must not be the first delivery gate.",
  },
];

export function getPromptRegistry() {
  return {
    ok: true,
    mode: "read-only",
    prompts: promptTemplates,
  };
}
