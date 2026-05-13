type SourceGroup = "news" | "filings" | "market";

export type EventTypeBadgeTone =
  | "general"
  | "earnings"
  | "dilution"
  | "risk"
  | "deal"
  | "clinical"
  | "regulatory"
  | "market";

export type EventTypeStatus = "active" | "planned";

export type EventTypeDefinition = {
  code: string;
  label: string;
  category: string;
  tone: EventTypeBadgeTone;
  sourceGroups: SourceGroup[];
  status: EventTypeStatus;
  coveredForms?: string[];
  description: string;
  examples: string[];
};

export const eventTypeDefinitions: EventTypeDefinition[] = [
  {
    code: "current_report",
    label: "8-K Update",
    category: "Current Report",
    tone: "regulatory",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: ["8-K", "8-K/A", "6-K", "6-K/A"],
    description: "Material current-report disclosure that does not fit a narrower event type yet.",
    examples: ["Item 8.01 update", "foreign issuer 6-K operational update"],
  },
  {
    code: "prospectus_supplement",
    label: "Prospectus",
    category: "Dilution / Offering",
    tone: "dilution",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: ["424B3", "424B5", "S-3", "S-3/A", "S-3ASR", "F-3", "F-3/A"],
    description: "Prospectus, resale, shelf, ATM, or offering supplement that may affect dilution risk.",
    examples: ["ATM program supplement", "resale prospectus supplement"],
  },
  {
    code: "quarterly_report",
    label: "10-Q",
    category: "Periodic Report",
    tone: "regulatory",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: ["10-Q", "10-Q/A"],
    description: "Quarterly periodic report event surfaced when score clears feed or alert thresholds.",
    examples: ["quarterly operating update", "10-Q liquidity risk"],
  },
  {
    code: "financing_dilution",
    label: "Dilution",
    category: "Dilution / Offering",
    tone: "dilution",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K", "424B5", "S-1", "S-3"],
    description: "Private placement, convertible debt, ATM, warrant, shelf, or other financing with dilution risk.",
    examples: ["private placement", "convertible debenture financing"],
  },
  {
    code: "earnings_result",
    label: "Earnings",
    category: "Earnings",
    tone: "earnings",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K", "10-Q"],
    description: "Reported earnings, revenue, guidance, or operating results.",
    examples: ["Q1 results", "full-year guidance update"],
  },
  {
    code: "earnings_delay",
    label: "Earnings Delay",
    category: "Earnings",
    tone: "earnings",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K", "NT 10-K", "NT 10-Q"],
    description: "Delayed report, postponed earnings release, or late filing with market relevance.",
    examples: ["10-Q delay", "supplier delay affecting revenue timing"],
  },
  {
    code: "earnings_preview",
    label: "Earnings Preview",
    category: "Earnings",
    tone: "earnings",
    sourceGroups: ["news"],
    status: "active",
    description: "Forward-looking earnings setup or pre-announcement before full results.",
    examples: ["preliminary revenue", "earnings date setup"],
  },
  {
    code: "going_concern",
    label: "Going Concern",
    category: "Risk",
    tone: "risk",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K", "10-Q", "10-K"],
    description: "Going-concern warning, audit concern, liquidity risk, or survival-risk disclosure.",
    examples: ["going concern audit opinion", "substantial doubt disclosure"],
  },
  {
    code: "reverse_split",
    label: "Reverse Split",
    category: "Corporate Action",
    tone: "risk",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K", "DEF 14A"],
    description: "Reverse stock split or related compliance action.",
    examples: ["1-for-20 reverse split", "split to regain listing compliance"],
  },
  {
    code: "delisting_watch",
    label: "Delisting Watch",
    category: "Listing Risk",
    tone: "risk",
    sourceGroups: ["news", "filings"],
    status: "planned",
    coveredForms: ["8-K", "6-K"],
    description: "Exchange deficiency notice, noncompliance, hearing, or listing-risk update.",
    examples: ["Nasdaq minimum bid notice", "continued listing deficiency"],
  },
  {
    code: "mna",
    label: "M&A",
    category: "M&A / Strategic",
    tone: "deal",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K", "S-4", "F-4", "SC TO-T", "SC 14D9"],
    description: "Merger, acquisition, tender offer, asset sale, or other strategic transaction.",
    examples: ["merger agreement", "tender offer response"],
  },
  {
    code: "merger_acquisition",
    label: "M&A",
    category: "M&A / Strategic",
    tone: "deal",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K", "S-4", "F-4"],
    description: "Alias used by news parsers for M&A events; can be normalized into mna later.",
    examples: ["acquisition announcement", "business combination"],
  },
  {
    code: "contract_award",
    label: "Contract",
    category: "Commercial",
    tone: "deal",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "Customer contract, government award, purchase order, or commercial agreement.",
    examples: ["Army contract", "enterprise customer agreement"],
  },
  {
    code: "partnership",
    label: "Partnership",
    category: "Commercial",
    tone: "deal",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "Strategic partnership, distribution agreement, license, or collaboration.",
    examples: ["commercial partnership", "joint development agreement"],
  },
  {
    code: "product_launch",
    label: "Product Launch",
    category: "Commercial",
    tone: "general",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "New product, platform, service, or availability announcement.",
    examples: ["AI platform launch", "new service availability"],
  },
  {
    code: "product_delay",
    label: "Product Delay",
    category: "Commercial Risk",
    tone: "risk",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "Delay, shipment push-out, failed rollout, or customer delivery issue.",
    examples: ["supplier delay", "delayed customer fulfillment"],
  },
  {
    code: "product_competition",
    label: "Competition",
    category: "Market Position",
    tone: "market",
    sourceGroups: ["news"],
    status: "active",
    description: "Competitive product or industry pressure affecting a company or peer group.",
    examples: ["new competitor product", "pricing pressure"],
  },
  {
    code: "project_update",
    label: "Project Update",
    category: "Operations",
    tone: "general",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "Project, construction, exploration, or milestone update.",
    examples: ["construction update", "drilling program progress"],
  },
  {
    code: "production_update",
    label: "Production",
    category: "Operations",
    tone: "general",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "Production, delivery, capacity, or operations update.",
    examples: ["monthly production update", "delivery commentary"],
  },
  {
    code: "clinical_update",
    label: "Clinical",
    category: "Healthcare Catalyst",
    tone: "clinical",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "Clinical trial, study, endpoint, enrollment, or medical program update.",
    examples: ["Phase 1 data", "trial enrollment update"],
  },
  {
    code: "regulatory_approval",
    label: "Approval",
    category: "Healthcare Catalyst",
    tone: "clinical",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "FDA, EMA, or other regulator approval, clearance, or authorization.",
    examples: ["FDA clearance", "expanded indication approval"],
  },
  {
    code: "fda_catalyst",
    label: "FDA Catalyst",
    category: "Healthcare Catalyst",
    tone: "clinical",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "FDA decision, advisory committee, PDUFA, safety action, or other FDA-linked catalyst.",
    examples: ["PDUFA date", "FDA safety communication"],
  },
  {
    code: "insider_buy",
    label: "Insider Buy",
    category: "Ownership",
    tone: "deal",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: ["4", "4/A"],
    description: "Open-market insider purchase or other insider transaction worth surfacing.",
    examples: ["CEO open-market buy", "director purchase"],
  },
  {
    code: "ownership_change",
    label: "Ownership Change",
    category: "Ownership",
    tone: "regulatory",
    sourceGroups: ["filings"],
    status: "planned",
    coveredForms: ["SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"],
    description: "Activist, beneficial ownership, or large holder position change.",
    examples: ["13D activist stake", "13G passive holder update"],
  },
  {
    code: "dividend",
    label: "Dividend",
    category: "Corporate Action",
    tone: "market",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: ["8-K", "6-K"],
    description: "Dividend declaration, distribution, special dividend, or payout update.",
    examples: ["monthly distribution", "special dividend"],
  },
  {
    code: "price_momentum",
    label: "Momentum",
    category: "Market",
    tone: "market",
    sourceGroups: ["market"],
    status: "active",
    description: "Market-data-driven momentum event or notable price/volume move.",
    examples: ["unusual volume", "breakout move"],
  },
];

const eventTypeByCode = new Map(eventTypeDefinitions.map((definition) => [definition.code, definition]));

export const eventTypeStats = {
  total: eventTypeDefinitions.length,
  active: eventTypeDefinitions.filter((definition) => definition.status === "active").length,
  planned: eventTypeDefinitions.filter((definition) => definition.status === "planned").length,
  filingBacked: eventTypeDefinitions.filter((definition) => definition.sourceGroups.includes("filings")).length,
};

export function getEventTypeDefinition(code: string) {
  return eventTypeByCode.get(normalizeEventTypeCode(code));
}

export function getEventTypeBadge(code: string): { label: string; tone: EventTypeBadgeTone } {
  const definition = getEventTypeDefinition(code);
  if (definition) return { label: definition.label, tone: definition.tone };
  return { label: formatEventTypeLabel(code), tone: "general" };
}

export function formatEventTypeLabel(code: string) {
  const normalized = normalizeEventTypeCode(code);
  if (!normalized) return "Event";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

function normalizeEventTypeCode(code: string) {
  return code.trim().toLowerCase();
}
