export type FilingsV2EventType =
  | "earnings"
  | "insider"
  | "offering"
  | "dilution"
  | "listing"
  | "legal"
  | "ma"
  | "governance";

export type FilingsV2ImpactFilter = "Alerts 75+" | "50–74";
export type FilingsV2Signal = "bullish" | "bearish" | "neutral" | "volatile";
export type FilingsV2Category = "all" | "high-impact" | "watchlist";
export type FilingsV2Sort = "newest" | "oldest";
export type FilingsV2DateRange = "24 Hours" | "7 Days" | "30 Days";
export type FilingsV2MarketCap = "Mega" | "Large" | "Mid" | "Small" | "Micro";

export type FilingsV2Record = {
  accession: string;
  company: string;
  events: readonly FilingsV2EventType[];
  filedAt: string;
  filedDate: string;
  filedDateTime: string;
  filedTime: string;
  formType: string;
  id: string;
  impact: number;
  keyPoints: readonly string[];
  marketCap: FilingsV2MarketCap;
  relatedIds: readonly string[];
  signal: FilingsV2Signal;
  source: "SEC";
  summary: string;
  ticker?: string;
  title: string;
  watchlist: boolean;
};

export type FilingsV2FilterGroup =
  | "signals"
  | "marketCaps"
  | "formTypes"
  | "eventTypes"
  | "impacts"
  | "dateRanges";

export type FilingsV2FilterState = {
  signals: FilingsV2Signal[];
  marketCaps: FilingsV2MarketCap[];
  formTypes: string[];
  eventTypes: FilingsV2EventType[];
  impacts: FilingsV2ImpactFilter[];
  dateRanges: FilingsV2DateRange[];
};

export const filingsV2LastUpdated = "Jul 15, 2026 · 4:15 PM ET";
export const filingsV2ReferenceDate = "2026-07-15T20:15:00.000Z";

export const filingsV2DefaultFilters: FilingsV2FilterState = {
  signals: [],
  marketCaps: [],
  formTypes: [],
  eventTypes: [],
  impacts: [],
  dateRanges: [],
};

export const filingsV2FormOptions = [
  "8-K",
  "10-Q",
  "10-K",
  "Form 4",
  "S-1",
  "424B5",
  "S-3",
  "13D",
  "Form 25",
] as const;

export const filingsV2EventOptions = [
  "earnings",
  "insider",
  "offering",
  "listing",
  "legal",
  "ma",
  "governance",
] as const;

export const filingsV2HighImpactMinimum = 75;
export const filingsV2ImpactOptions = ["Alerts 75+", "50–74"] as const;
export const filingsV2SignalOptions = ["bullish", "bearish", "neutral", "volatile"] as const;
export const filingsV2DateOptions = ["24 Hours", "7 Days", "30 Days"] as const;
export const filingsV2MarketCapOptions = ["Mega", "Large", "Mid", "Small", "Micro"] as const;

export function matchesFilingsV2ImpactFilter(score: number, filter: FilingsV2ImpactFilter) {
  if (filter === "Alerts 75+") return score >= filingsV2HighImpactMinimum;
  return score >= 50 && score <= 74;
}

type FilingSeed = Omit<
  FilingsV2Record,
  "accession" | "filedDateTime" | "id" | "keyPoints" | "relatedIds" | "source" | "summary" | "watchlist"
> &
  Partial<
    Pick<
      FilingsV2Record,
      "accession" | "filedDateTime" | "keyPoints" | "relatedIds" | "summary" | "watchlist"
    >
  >;

function filing(id: string, seed: FilingSeed): FilingsV2Record {
  if (!Number.isInteger(seed.impact) || seed.impact < 1 || seed.impact > 99) {
    throw new RangeError(`Filing impact score must be an integer from 1 to 99: ${seed.impact}`);
  }

  return {
    accession: seed.accession ?? `0000000000-26-${id.padStart(6, "0")}`,
    filedDateTime: seed.filedDateTime ?? `${seed.filedDate}, 2026 · ${seed.filedTime} ET`,
    id: `filing-v2-${id}`,
    keyPoints: seed.keyPoints ?? [
      `The ${seed.formType} is categorized as a ${seed.events[0] ?? "routine"} filing in this mock list.`,
      "Review the filing and any exhibits before making an investment decision.",
    ],
    relatedIds: seed.relatedIds ?? [],
    source: "SEC",
    summary:
      seed.summary ??
      "Mock context summarizes the filing category and disclosed subject without presenting an AI conclusion.",
    watchlist: seed.watchlist ?? false,
    ...seed,
  };
}

const canonicalFilingsV2Records: readonly FilingsV2Record[] = [
  filing("001", {
    company: "Advanced Micro Devices, Inc.", events: ["earnings"], filedAt: "2026-07-15T20:02:00.000Z", filedDate: "Jul 15", filedTime: "4:02 PM", formType: "8-K", impact: 84, marketCap: "Mega", signal: "bullish", ticker: "AMD", title: "Current report furnishes quarterly results and updated outlook", watchlist: true,
    summary: "The mock 8-K groups an earnings release and outlook update for fast scanning; figures are intentionally omitted.",
    keyPoints: ["Quarterly results are furnished as an exhibit.", "Management includes an updated operating outlook.", "The filing carries an impact score of 84 in this fixture."],
    relatedIds: ["filing-v2-012"],
  }),
  filing("002", {
    company: "Tesla, Inc.", events: ["insider"], filedAt: "2026-07-15T19:48:00.000Z", filedDate: "Jul 15", filedTime: "3:48 PM", formType: "Form 4", impact: 52, marketCap: "Mega", signal: "neutral", ticker: "TSLA", title: "Director reports a change in beneficial ownership", watchlist: true,
  }),
  filing("003", {
    company: "Aurora Innovation, Inc.", events: ["offering", "dilution"], filedAt: "2026-07-15T19:31:00.000Z", filedDate: "Jul 15", filedTime: "3:31 PM", formType: "424B5", impact: 96, marketCap: "Mid", signal: "bearish", ticker: "AUR", title: "Prospectus supplement outlines a proposed common stock offering", watchlist: true,
    summary: "This mock prospectus entry highlights offering structure and possible dilution without estimating proceeds or share impact.",
    keyPoints: ["A prospectus supplement is filed for a proposed offering.", "Final pricing is not included in this mock summary.", "Dilution is flagged as a classification, not a quantified conclusion."],
    relatedIds: ["filing-v2-018", "filing-v2-024"],
  }),
  filing("004", {
    company: "CrowdStrike Holdings, Inc.", events: ["legal"], filedAt: "2026-07-15T18:55:00.000Z", filedDate: "Jul 15", filedTime: "2:55 PM", formType: "8-K", impact: 82, marketCap: "Large", signal: "volatile", ticker: "CRWD", title: "Current report discloses a material legal proceeding update", watchlist: true,
  }),
  filing("005", {
    company: "Palantir Technologies Inc.", events: ["governance"], filedAt: "2026-07-15T18:22:00.000Z", filedDate: "Jul 15", filedTime: "2:22 PM", formType: "8-K", impact: 28, marketCap: "Large", signal: "neutral", ticker: "PLTR", title: "Board committee appointments and governance changes reported",
  }),
  filing("006", {
    company: "Coinbase Global, Inc.", events: ["legal", "governance"], filedAt: "2026-07-15T17:46:00.000Z", filedDate: "Jul 15", filedTime: "1:46 PM", formType: "8-K", impact: 79, marketCap: "Large", signal: "volatile", ticker: "COIN", title: "Company reports regulatory correspondence and oversight actions", watchlist: true,
  }),
  filing("007", {
    company: "NVIDIA Corporation", events: ["insider"], filedAt: "2026-07-15T17:18:00.000Z", filedDate: "Jul 15", filedTime: "1:18 PM", formType: "Form 4", impact: 22, marketCap: "Mega", signal: "neutral", ticker: "NVDA", title: "Executive reports disposition of shares under a trading plan", watchlist: true,
  }),
  filing("008", {
    company: "QuantumScape Corporation", events: ["listing"], filedAt: "2026-07-15T16:37:00.000Z", filedDate: "Jul 15", filedTime: "12:37 PM", formType: "8-K", impact: 61, marketCap: "Mid", signal: "bearish", ticker: "QS", title: "Exchange notice and plan to regain listing compliance disclosed",
  }),
  filing("009", {
    company: "The Boeing Company", events: ["legal"], filedAt: "2026-07-15T15:59:00.000Z", filedDate: "Jul 15", filedTime: "11:59 AM", formType: "8-K", impact: 94, marketCap: "Large", signal: "bearish", ticker: "BA", title: "Material settlement framework disclosed in current report", watchlist: true,
  }),
  filing("010", {
    company: "Microsoft Corporation", events: ["earnings"], filedAt: "2026-07-15T15:16:00.000Z", filedDate: "Jul 15", filedTime: "11:16 AM", formType: "10-Q", impact: 86, marketCap: "Mega", signal: "bullish", ticker: "MSFT", title: "Quarterly report covers cloud growth, margins, and risk factors", watchlist: true,
  }),
  filing("011", {
    company: "Rivian Automotive, Inc.", events: ["offering", "dilution"], filedAt: "2026-07-15T14:42:00.000Z", filedDate: "Jul 15", filedTime: "10:42 AM", formType: "S-3", impact: 78, marketCap: "Mid", signal: "bearish", ticker: "RIVN", title: "Shelf registration statement covers potential future securities sales",
  }),
  filing("012", {
    company: "Advanced Micro Devices, Inc.", events: [], filedAt: "2026-07-15T14:08:00.000Z", filedDate: "Jul 15", filedTime: "10:08 AM", formType: "10-Q", impact: 58, marketCap: "Mega", signal: "neutral", ticker: "AMD", title: "Quarterly report updates financial statements and risk disclosures", watchlist: true,
    relatedIds: ["filing-v2-001"],
  }),
  filing("013", {
    company: "Northstar Acquisition Partners LP", events: ["ma"], filedAt: "2026-07-15T13:37:00.000Z", filedDate: "Jul 15", filedTime: "9:37 AM", formType: "13D", impact: 74, marketCap: "Small", signal: "volatile", title: "Beneficial ownership filing describes strategic transaction discussions",
    summary: "The issuer is not mapped to a supported ticker in this mock record; the ownership disclosure remains searchable by company.",
  }),
  filing("014", {
    company: "Apple Inc.", events: ["insider"], filedAt: "2026-07-15T12:55:00.000Z", filedDate: "Jul 15", filedTime: "8:55 AM", formType: "Form 4", impact: 19, marketCap: "Mega", signal: "neutral", ticker: "AAPL", title: "Officer reports scheduled sale and retained beneficial ownership", watchlist: true,
  }),
  filing("015", {
    company: "Rocket Lab USA, Inc.", events: ["offering"], filedAt: "2026-07-15T12:21:00.000Z", filedDate: "Jul 15", filedTime: "8:21 AM", formType: "S-8", impact: 46, marketCap: "Mid", signal: "neutral", ticker: "RKLB", title: "Registration statement covers employee equity plan shares",
  }),
  filing("016", {
    company: "Netflix, Inc.", events: ["earnings"], filedAt: "2026-07-14T20:09:00.000Z", filedDate: "Jul 14", filedTime: "4:09 PM", formType: "8-K", impact: 88, marketCap: "Mega", signal: "bullish", ticker: "NFLX", title: "Shareholder letter and quarterly financial results furnished", watchlist: true,
  }),
  filing("017", {
    company: "Super Micro Computer, Inc.", events: ["listing", "governance"], filedAt: "2026-07-14T19:34:00.000Z", filedDate: "Jul 14", filedTime: "3:34 PM", formType: "8-K", impact: 92, marketCap: "Large", signal: "volatile", ticker: "SMCI", title: "Company reports filing status and audit committee oversight update", watchlist: true,
  }),
  filing("018", {
    company: "Aurora Innovation, Inc.", events: ["offering"], filedAt: "2026-07-14T18:41:00.000Z", filedDate: "Jul 14", filedTime: "2:41 PM", formType: "S-3", impact: 55, marketCap: "Mid", signal: "neutral", ticker: "AUR", title: "Automatic shelf registration statement filed", relatedIds: ["filing-v2-003"],
  }),
  filing("019", {
    company: "Amazon.com, Inc.", events: ["governance"], filedAt: "2026-07-14T17:57:00.000Z", filedDate: "Jul 14", filedTime: "1:57 PM", formType: "8-K", impact: 31, marketCap: "Mega", signal: "neutral", ticker: "AMZN", title: "Voting results from annual meeting reported",
  }),
  filing("020", {
    company: "GameStop Corp.", events: ["offering", "dilution"], filedAt: "2026-07-13T20:03:00.000Z", filedDate: "Jul 13", filedTime: "4:03 PM", formType: "424B5", impact: 97, marketCap: "Mid", signal: "volatile", ticker: "GME", title: "At-the-market offering prospectus supplement filed", watchlist: true,
  }),
  filing("021", {
    company: "Alphabet Inc.", events: ["legal"], filedAt: "2026-07-13T18:26:00.000Z", filedDate: "Jul 13", filedTime: "2:26 PM", formType: "10-Q", impact: 63, marketCap: "Mega", signal: "neutral", ticker: "GOOGL", title: "Quarterly report updates legal contingencies and commitments",
  }),
  filing("022", {
    company: "Meta Platforms, Inc.", events: ["insider"], filedAt: "2026-07-12T19:11:00.000Z", filedDate: "Jul 12", filedTime: "3:11 PM", formType: "Form 4", impact: 17, marketCap: "Mega", signal: "neutral", ticker: "META", title: "Reporting person discloses tax-withholding share disposition",
  }),
  filing("023", {
    company: "Lucid Group, Inc.", events: ["offering", "dilution"], filedAt: "2026-07-11T17:39:00.000Z", filedDate: "Jul 11", filedTime: "1:39 PM", formType: "S-1", impact: 76, marketCap: "Mid", signal: "bearish", ticker: "LCID", title: "Resale registration statement covers a substantial share block",
  }),
  filing("024", {
    company: "Aurora Innovation, Inc.", events: ["governance"], filedAt: "2026-07-10T16:45:00.000Z", filedDate: "Jul 10", filedTime: "12:45 PM", formType: "8-K", impact: 26, marketCap: "Mid", signal: "neutral", ticker: "AUR", title: "Annual meeting voting results and director elections reported", relatedIds: ["filing-v2-003"],
  }),
  filing("025", {
    company: "Marathon Digital Holdings, Inc.", events: ["offering"], filedAt: "2026-07-09T20:06:00.000Z", filedDate: "Jul 9", filedTime: "4:06 PM", formType: "8-K", impact: 59, marketCap: "Mid", signal: "volatile", ticker: "MARA", title: "Convertible notes transaction and use of proceeds disclosed",
  }),
  filing("026", {
    company: "Beyond Air, Inc.", events: ["listing"], filedAt: "2026-07-08T18:14:00.000Z", filedDate: "Jul 8", filedTime: "2:14 PM", formType: "Form 25", impact: 99, marketCap: "Small", signal: "bearish", ticker: "XAIR", title: "Notification of removal from listing and registration filed",
  }),
  filing("027", {
    company: "JPMorgan Chase & Co.", events: ["earnings"], filedAt: "2026-07-07T12:36:00.000Z", filedDate: "Jul 7", filedTime: "8:36 AM", formType: "8-K", impact: 81, marketCap: "Mega", signal: "bullish", ticker: "JPM", title: "Quarterly earnings materials and financial supplement furnished",
  }),
  filing("028", {
    company: "Longview Renewable Infrastructure and Energy Transition Holdings, Inc.", events: ["ma", "governance"], filedAt: "2026-07-02T19:52:00.000Z", filedDate: "Jul 2", filedTime: "3:52 PM", formType: "13D", impact: 66, marketCap: "Small", signal: "volatile", ticker: "LREV", title: "Amended beneficial ownership filing describes continuing strategic review and board engagement",
  }),
];

type GeneratedFilingTemplate = Pick<
  FilingSeed,
  "company" | "events" | "formType" | "ticker" | "title"
>;

const generatedFilingTemplates = [
  { company: "Advanced Micro Devices, Inc.", events: ["earnings"], formType: "8-K", ticker: "AMD", title: "Current report furnishes a quarterly operating update" },
  { company: "Tesla, Inc.", events: ["insider"], formType: "Form 4", ticker: "TSLA", title: "Reporting person discloses a change in beneficial ownership" },
  { company: "Aurora Innovation, Inc.", events: ["offering"], formType: "S-3", ticker: "AUR", title: "Registration statement outlines potential securities issuance" },
  { company: "CrowdStrike Holdings, Inc.", events: ["legal"], formType: "8-K", ticker: "CRWD", title: "Current report updates a material legal proceeding" },
  { company: "Palantir Technologies Inc.", events: ["governance"], formType: "8-K", ticker: "PLTR", title: "Company reports governance and committee developments" },
  { company: "NVIDIA Corporation", events: ["insider"], formType: "Form 4", ticker: "NVDA", title: "Executive reports a transaction under an equity plan" },
  { company: "QuantumScape Corporation", events: ["listing"], formType: "8-K", ticker: "QS", title: "Exchange compliance status and remediation plan disclosed" },
  { company: "Microsoft Corporation", events: ["earnings"], formType: "10-Q", ticker: "MSFT", title: "Quarterly report updates financial results and risk factors" },
  { company: "Rivian Automotive, Inc.", events: ["offering"], formType: "424B5", ticker: "RIVN", title: "Prospectus supplement describes a proposed offering" },
  { company: "Amazon.com, Inc.", events: ["governance"], formType: "8-K", ticker: "AMZN", title: "Voting results and corporate governance actions reported" },
  { company: "Alphabet Inc.", events: ["legal"], formType: "10-Q", ticker: "GOOGL", title: "Quarterly filing updates legal contingencies" },
  { company: "Marathon Digital Holdings, Inc.", events: ["ma"], formType: "13D", ticker: "MARA", title: "Beneficial ownership filing describes strategic discussions" },
] satisfies readonly GeneratedFilingTemplate[];

const generatedFilingSignals: readonly FilingsV2Signal[] = ["bullish", "bearish", "neutral", "volatile"];
const generatedFilingMarketCaps: readonly FilingsV2MarketCap[] = ["Mega", "Large", "Mid", "Small", "Micro"];
const generatedFilingStart = Date.parse("2026-07-02T18:45:00.000Z");
const generatedFilingInterval = 47 * 60 * 1000;
const generatedFilingCount = 300 - canonicalFilingsV2Records.length;
const generatedDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "America/New_York",
});
const generatedTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
});

const generatedFilingsV2Records = Array.from({ length: generatedFilingCount }, (_, index) => {
  const sequence = canonicalFilingsV2Records.length + index + 1;
  const id = String(sequence).padStart(3, "0");
  const template = generatedFilingTemplates[index % generatedFilingTemplates.length];
  const filedAt = new Date(generatedFilingStart - index * generatedFilingInterval);

  return filing(id, {
    ...template,
    filedAt: filedAt.toISOString(),
    filedDate: generatedDateFormatter.format(filedAt),
    filedTime: generatedTimeFormatter.format(filedAt),
    impact: ((index * 17 + 43) % 99) + 1,
    marketCap: generatedFilingMarketCaps[index % generatedFilingMarketCaps.length],
    signal: generatedFilingSignals[index % generatedFilingSignals.length],
    watchlist: index % 7 === 0,
  });
});

export const filingsV2Records: readonly FilingsV2Record[] = [
  ...canonicalFilingsV2Records,
  ...generatedFilingsV2Records,
];

export const filingsV2EventLabels: Record<FilingsV2EventType, string> = {
  dilution: "Dilution",
  earnings: "Earnings",
  governance: "Governance",
  insider: "Insider",
  legal: "Legal",
  listing: "Listing",
  ma: "M&A",
  offering: "Offering",
};

export const filingsV2SignalLabels: Record<FilingsV2Signal, string> = {
  bearish: "Bearish",
  bullish: "Bullish",
  neutral: "Neutral",
  volatile: "Volatile",
};
