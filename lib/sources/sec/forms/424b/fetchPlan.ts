import type { SecFormFetchPlan } from "../common/fetchPlan";

export const sec424bFetchPlan = {
  room: "424b",
  forms: ["424B3", "424B5"],
  defaultAttachmentLimit: 8,
  notes: [
    "424B filings often carry final pricing, resale, warrant, unit, ATM, or prospectus-supplement terms.",
    "Fetch should prioritize offering terms without forcing UI or DB writes from the form room.",
  ],
  rules: [
    {
      id: "offering-or-prospectus-supplement",
      reason: "Prospectus supplement text often contains the final deal terms investors need.",
      labelPatterns: [/prospectus|supplement|pricing|resale|warrant|unit|atm|sales agreement/i],
      typePrefixes: ["EX-99", "EX-10"],
      maxDocuments: 4,
    },
    {
      id: "fee-table",
      reason: "Fee tables can contain registered amount and security type when omitted from narrative.",
      typePrefixes: ["EX-FILING FEES", "EX-107"],
      labelPatterns: [/FILING FEE|FEE TABLE|EX-107|EX107|107/i],
      maxDocuments: 2,
      preserveRawText: true,
    },
  ],
} satisfies SecFormFetchPlan;
