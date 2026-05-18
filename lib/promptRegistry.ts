import {
  NEWS_EVENT_ANALYSIS_PROMPT_KEY,
  NEWS_EVENT_ANALYSIS_PROMPT_VERSION,
  newsEventAnalysisInputTemplate,
  newsEventAnalysisResponseSchema,
  newsEventAnalysisSystemPrompt,
} from "@/lib/prompts/newsEventAnalysis";
import {
  NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_KEY,
  NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_VERSION,
  newsClinicalFdaAnalysisInputTemplate,
  newsClinicalFdaAnalysisSystemPrompt,
} from "@/lib/prompts/newsClinicalFdaAnalysis";
import {
  NEWS_ROUTE_CLASSIFICATION_PROMPT_KEY,
  NEWS_ROUTE_CLASSIFICATION_PROMPT_VERSION,
  newsRouteClassificationResponseSchema,
  newsRouteClassificationSystemPrompt,
} from "@/lib/prompts/newsRouteClassification";
import {
  NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_KEY,
  NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_VERSION,
  newsSectorThemePolicyAnalysisInputTemplate,
  newsSectorThemePolicyAnalysisSystemPrompt,
} from "@/lib/prompts/newsSectorThemePolicyAnalysis";
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
    key: NEWS_ROUTE_CLASSIFICATION_PROMPT_KEY,
    version: NEWS_ROUTE_CLASSIFICATION_PROMPT_VERSION,
    task: "News route classification",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "runtime route: company vs clinical/FDA vs sector/theme/policy",
    notes:
      "First-pass classifier that decides whether a news item should be skipped or use the company, clinical/FDA, or broad-market analysis prompt.",
    systemPrompt: newsRouteClassificationSystemPrompt,
    userInputTemplate: newsEventAnalysisInputTemplate,
    responseSchema: newsRouteClassificationResponseSchema,
    runtimeNotes:
      "OpenAI call runs before detailed analysis. Runtime skips low-value items before second-pass analysis when route=skip.",
  },
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
    key: NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_KEY,
    version: NEWS_SECTOR_THEME_POLICY_ANALYSIS_PROMPT_VERSION,
    task: "Broad-market news analysis",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "events + event_analysis + event_tickers",
    notes:
      "Dedicated broad-market news analysis. The LLM identifies the exposure path; runtime maps only that sector/theme classification to cached ticker data.",
    systemPrompt: newsSectorThemePolicyAnalysisSystemPrompt,
    userInputTemplate: newsSectorThemePolicyAnalysisInputTemplate,
    responseSchema: newsEventAnalysisResponseSchema,
    runtimeNotes:
      "Used after news_route_classification returns broad_market. Runtime does not inspect article keywords for proxies.",
  },
  {
    key: NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_KEY,
    version: NEWS_CLINICAL_FDA_ANALYSIS_PROMPT_VERSION,
    task: "Clinical and FDA news analysis",
    model: "gpt-5-mini",
    status: "draft",
    owner: "ai",
    inputTables: ["raw_items"],
    outputTarget: "events + event_analysis + event_tickers + event_calendar_items",
    notes:
      "Dedicated source-neutral clinical/FDA analysis. Any news source can route here when the article's market question is clinical, FDA, drug, device, diagnostic, or biopharma.",
    systemPrompt: newsClinicalFdaAnalysisSystemPrompt,
    userInputTemplate: newsClinicalFdaAnalysisInputTemplate,
    responseSchema: newsEventAnalysisResponseSchema,
    runtimeNotes:
      "Used after news_route_classification returns clinical_fda. Ticker linkage is useful for navigation but not the reason an investable clinical/FDA catalyst exists.",
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
