export type FilingUiConsoleFamily = {
  id: string;
  label: string;
  description: string;
};

export type FilingUiConsoleRegistration = {
  eventId: string;
  family: string;
  fixture?: {
    company: string;
    delivery: string;
    eventType: string;
    formType: string;
    score: number | null;
    signal: string;
    ticker: string;
  };
  fixtureKind?: "Actual DB" | "Fixture";
  label: string;
  notes: string;
  route?: string;
  surface?: "current" | "design-v2";
};

export const filingUiConsoleFamilies: readonly FilingUiConsoleFamily[] = [
  { id: "generic", label: "Generic", description: "Fallback filing analysis layout." },
  { id: "listing-financial-risk", label: "Listing / Financial Risk", description: "Delisting, bankruptcy, liquidity, and restatement status layouts." },
  { id: "financing-dilution", label: "Financing / Dilution", description: "Capital financing, security terms, and overhang layouts." },
  { id: "strategic-transaction", label: "Strategic Transaction", description: "Merger, acquisition, tender closing, and transaction status layouts." },
  { id: "governance-vote", label: "Governance / Vote / Leadership", description: "Auditor, board, executive, and shareholder vote layouts." },
  { id: "operating-legal", label: "Operating / Legal / Routine", description: "Earnings, operating metrics, regulatory, and legal update layouts." },
  { id: "offering-registration", label: "Offering / Registration", description: "424B, S-1/F-1, S-3/F-3, and related offering layouts." },
  { id: "periodic", label: "Periodic Reports", description: "10-K, 10-Q, 20-F, and amendment layouts." },
  { id: "form-25", label: "Form 25", description: "Delisting lifecycle and security-removal layouts." },
  { id: "form-425", label: "425", description: "Transaction communication and procedural update layouts." },
  { id: "proxy", label: "Proxy", description: "Proxy vote, governance, and meeting layouts." },
  { id: "ownership", label: "Ownership", description: "Forms 3, 4, 5, 13D/G, and 144 layouts." },
  { id: "tender", label: "Tender / CB / 13E3", description: "Tender offer and going-private transaction layouts." },
  { id: "s8", label: "S-8", description: "Equity compensation registration layouts." },
  { id: "nt", label: "NT", description: "Late periodic filing and expected-results layouts." },
] as const;

export const filingUiConsoleRegistrations: readonly FilingUiConsoleRegistration[] = [
  {
    eventId: "241912b7-f9d5-4d5c-99ff-3a5fa0d94eed",
    family: "operating-legal",
    label: "MDB / Earnings and operating update",
    notes: "Performance comparison, guidance, and business updates.",
  },
  {
    eventId: "cf783e79-1ab3-49b7-928f-aee81410be37",
    family: "periodic",
    label: "AMZN / Periodic report",
    notes: "Periodic performance and outlook layout.",
  },
  {
    eventId: "c91ea3c1-6c57-4040-b6e6-7d2d02b80731",
    family: "form-25",
    label: "CARV / Voluntary delisting",
    notes: "Form 25 archive/update presentation.",
  },
  {
    eventId: "cc366235-7035-4e65-a18d-a2fd0dec4ac5",
    family: "form-425",
    label: "NFLX / Competing-deal communication",
    notes: "Material transaction communication layout.",
  },
  {
    eventId: "23a23683-3a58-48aa-bea3-74138521669a",
    family: "proxy",
    label: "RNAZ / Proxy vote",
    notes: "Shareholder meeting and vote presentation.",
  },
  {
    eventId: "aeb233df-1633-4f08-9f17-5876a0905724",
    family: "nt",
    label: "APUS / NT 10-K",
    notes: "Late filing reason and expected-results snapshot.",
  },
] as const;
