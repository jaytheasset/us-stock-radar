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

const currentReportForms = ["8-K", "8-K/A", "6-K", "6-K/A"];

export const eventTypeDefinitions: EventTypeDefinition[] = [
  {
    code: "listing_risk",
    label: "Listing Risk",
    category: "Filing Events",
    tone: "risk",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: [...currentReportForms, "DEF 14A", "PRE 14A"],
    description: "Exchange listing, compliance, delisting, reverse split, trading suspension, or compliance recovery disclosure.",
    examples: ["Nasdaq deficiency notice", "compliance regained", "reverse split for minimum bid compliance"],
  },
  {
    code: "dilution_risk",
    label: "Dilution Risk",
    category: "Filing Events",
    tone: "dilution",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: [
      ...currentReportForms,
      "S-1",
      "S-1/A",
      "F-1",
      "F-1/A",
      "S-3",
      "S-3/A",
      "S-3ASR",
      "S-3MEF",
      "F-3",
      "F-3/A",
      "F-3ASR",
      "F-3MEF",
      "424B3",
      "424B5",
    ],
    description: "Offering, resale, shelf, ATM, warrant, convertible, private placement, or dilution-risk resolution disclosure.",
    examples: ["ATM offering", "convertible note financing", "debt repayment reducing dilution risk"],
  },
  {
    code: "earnings",
    label: "Earnings",
    category: "Filing Events",
    tone: "earnings",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: [...currentReportForms, "10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A"],
    description: "Earnings, financial results, guidance, late periodic report, or earnings-related filing update.",
    examples: ["quarterly results", "guidance update", "late 10-Q filing"],
  },
  {
    code: "sales_performance",
    label: "Sales Performance",
    category: "Filing Events",
    tone: "earnings",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: currentReportForms,
    description: "Revenue, sales, booking, backlog, order, margin, operating metric, or customer-demand disclosure outside a full earnings report.",
    examples: ["revenue growth update", "sales decline warning", "backlog improvement"],
  },
  {
    code: "operating_update",
    label: "Operating Update",
    category: "Filing Events",
    tone: "general",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: currentReportForms,
    description: "Workforce, restructuring, cost reduction, facility, capacity, or other operating-plan disclosure outside a full earnings report.",
    examples: ["workforce reduction", "cost restructuring plan", "facility exit or consolidation"],
  },
  {
    code: "product_update",
    label: "Product Update",
    category: "Filing Events",
    tone: "general",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: currentReportForms,
    description: "Product, service, project, operations, production, launch, delay, commercialization, or technical milestone disclosure.",
    examples: ["product launch", "production update", "commercial rollout delay"],
  },
  {
    code: "leadership_governance",
    label: "Leadership / Governance",
    category: "Filing Events",
    tone: "regulatory",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: [...currentReportForms, "DEF 14A", "PRE 14A"],
    description: "Executive, board, auditor, governance, control, resignation, appointment, compensation, or internal-control disclosure.",
    examples: ["CEO resignation", "auditor change", "material weakness update"],
  },
  {
    code: "insider_ownership",
    label: "Insider / Ownership",
    category: "Filing Events",
    tone: "regulatory",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: ["4", "4/A", "SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A", "144", "144/A"],
    description: "Insider transaction, beneficial ownership, activist stake, major holder, or planned sale disclosure.",
    examples: ["insider purchase", "13D activist stake", "Rule 144 planned sale"],
  },
  {
    code: "ipo_listing",
    label: "IPO / Listing",
    category: "Filing Events",
    tone: "deal",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: ["S-1", "S-1/A", "F-1", "F-1/A", "424B4", "424B5", "EFFECT"],
    description: "Traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
    examples: ["IPO pricing", "SPAC IPO unit listing", "direct listing effectiveness"],
  },
  {
    code: "shareholder_vote",
    label: "Shareholder Vote",
    category: "Filing Events",
    tone: "regulatory",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: ["DEF 14A", "PRE 14A", "DEFA14A", "DEFM14A", "PREM14A", "DEFC14A", "PREC14A", ...currentReportForms],
    description: "Proxy, shareholder meeting, vote result, proposal, approval, rejection, or consent solicitation disclosure.",
    examples: ["shareholder approval", "proxy vote proposal", "special meeting result"],
  },
  {
    code: "strategic_transaction",
    label: "Strategic Transaction",
    category: "Filing Events",
    tone: "deal",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: [
      ...currentReportForms,
      "S-4",
      "S-4/A",
      "F-4",
      "F-4/A",
      "SC TO-T",
      "SC TO-T/A",
      "SC TO-I",
      "SC TO-I/A",
      "SC 14D9",
      "SC 14D9/A",
    ],
    description: "Merger, acquisition, tender offer, asset sale, JV, partnership, license, strategic investment, or material agreement disclosure.",
    examples: ["merger agreement", "asset sale", "material customer contract"],
  },
  {
    code: "financial_risk",
    label: "Financial Risk",
    category: "Filing Events",
    tone: "risk",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: [...currentReportForms, "10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A", "NT 10-K", "NT 10-Q"],
    description: "Liquidity, going concern, default, debt, covenant, credit facility, restructuring, bankruptcy, or financial-condition disclosure.",
    examples: ["going concern warning", "loan covenant default", "liquidity improvement"],
  },
  {
    code: "legal_risk",
    label: "Legal Risk",
    category: "Filing Events",
    tone: "risk",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: currentReportForms,
    description: "Lawsuit, investigation, subpoena, settlement, regulatory action, enforcement, compliance, or legal-resolution disclosure.",
    examples: ["SEC investigation", "lawsuit settlement", "regulatory inquiry resolved"],
  },
  {
    code: "dividends",
    label: "Dividends",
    category: "Filing Events",
    tone: "market",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: currentReportForms,
    description: "Dividend, distribution, special dividend, payout suspension, payout increase, payout cut, or record-date disclosure.",
    examples: ["monthly distribution", "special dividend", "dividend suspension"],
  },
  {
    code: "capital_return",
    label: "Capital Return",
    category: "Cross-source Events",
    tone: "market",
    sourceGroups: ["news", "filings"],
    status: "active",
    coveredForms: [...currentReportForms, "10-Q", "10-Q/A", "10-K", "10-K/A", "20-F", "20-F/A"],
    description:
      "Share repurchase, buyback authorization, repurchase allocation increase, or capital return program where repurchases are the primary event.",
    examples: ["share repurchase authorization", "buyback program", "repurchase allocation increase"],
  },
  {
    code: "fda_clinical",
    label: "FDA / Clinical",
    category: "Filing Events",
    tone: "clinical",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: currentReportForms,
    description: "FDA, clinical, trial, approval, clearance, CRL, safety, PDUFA, advisory committee, or healthcare regulatory disclosure.",
    examples: ["FDA approval", "clinical trial result", "complete response letter"],
  },
  {
    code: "other",
    label: "Other",
    category: "Filing Events",
    tone: "general",
    sourceGroups: ["filings"],
    status: "active",
    coveredForms: [],
    description: "Fallback for filing disclosures that do not fit the fixed filing event taxonomy.",
    examples: ["administrative filing update", "miscellaneous disclosure"],
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
