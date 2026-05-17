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
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "events + event_analysis + event_tickers + event_calendar_items",
    notes:
      "Structured news analysis contract. Runtime sends system instructions, article JSON input, and strict JSON schema separately.",
    systemPrompt: newsEventAnalysisSystemPrompt,
    userInputTemplate: newsEventAnalysisInputTemplate,
    responseSchema: newsEventAnalysisResponseSchema,
    runtimeNotes:
      "OpenAI call: instructions = systemPrompt, input = JSON.stringify(article input), text.format = responseSchema.",
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
