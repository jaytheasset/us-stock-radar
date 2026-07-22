import type { FilingUiConsoleContentContractItem } from "@/app/development/filings-ui/FilingUiConsoleClient";
import type { FilingUiConsoleFamily } from "@/lib/development/filingUiConsoleRegistry";
import { NEWS_ANALYSIS_V2_FIXTURE_SLUG } from "@/lib/newsAnalysisConstants";

export const newsAnalysisUiFamily = {
  description: "Generic Filing analysis layout adapted to stored news analysis data.",
  id: "news-analysis",
  label: "News Analysis",
} satisfies FilingUiConsoleFamily;

export const newsAnalysisContentContract: FilingUiConsoleContentContractItem[] = [
  { fullAnalysis: "conditional", label: "Ticker logo and stored price chart", preview: "conditional" },
  { fullAnalysis: "conditional", label: "Quick Take / Why It Matters / Summary", preview: "conditional" },
  { fullAnalysis: "conditional", label: "Score rationale for alert/feed", preview: "hidden" },
  { fullAnalysis: "conditional", label: "Bullish / Bearish / Evidence / Watch Next", preview: "hidden" },
  { fullAnalysis: "conditional", label: "Stored market context", preview: "hidden" },
  { fullAnalysis: "conditional", label: "Related News / Related Filings", preview: "hidden" },
  { fullAnalysis: "conditional", label: "Sanitized Original Article", preview: "hidden" },
];

export const newsAnalysisFixtureRegistration = {
  company: "Ideal Power Fixture Company",
  delivery: "alert",
  eventId: NEWS_ANALYSIS_V2_FIXTURE_SLUG,
  eventType: "contract",
  family: newsAnalysisUiFamily.id,
  fixtureKind: "Fixture" as const,
  formType: "News V2 Fixture",
  label: "Complete News Analysis V2 Fixture",
  notes: "Fixture only: long title, stored-shaped chart, complete analysis, related content, market context, and sanitized long article.",
  route: `/events/${NEWS_ANALYSIS_V2_FIXTURE_SLUG}`,
  score: 88,
  signal: "bullish",
  status: "Ready" as const,
  ticker: "IPWR",
  contentContract: newsAnalysisContentContract,
};

export const actualDbNewsRegistrations = [
  { id: "66116d3f-f7a9-484f-ac3e-62f82a140e99", label: "Actual DB / IPWR" },
  { id: "02486615-d609-4184-aa76-e0f72e80108a", label: "Actual DB / RNW" },
  { id: "4b3a2c05-d03a-4c89-966b-c86aa9912016", label: "Actual DB / OFAC Iran sanctions" },
] as const;
