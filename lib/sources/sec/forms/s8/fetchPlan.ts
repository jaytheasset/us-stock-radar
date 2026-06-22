import type { SecFormFetchPlan } from "../common/fetchPlan";

export const secS8FetchPlan = {
  room: "s8",
  forms: ["S-8", "S-8/A", "S-8 POS"],
  defaultAttachmentLimit: 8,
  notes: [
    "S-8 analysis needs registered share counts, plan names, fee table values, and amendment context.",
    "Plan documents and fee tables are more important than generic signature/admin text.",
  ],
  rules: [
    {
      id: "filing-fee-table",
      reason: "Fee tables usually provide registered share/security counts and proposed maximum offering price.",
      typePrefixes: ["EX-FILING FEES", "EX-107"],
      labelPatterns: [/FILING FEE|FEE TABLE|EX-107|EX107|107/i],
      maxDocuments: 2,
      preserveRawText: true,
    },
    {
      id: "plan-document",
      reason: "Plan exhibits can name the equity plan and clarify whether shares are new, amended, or carried forward.",
      typePrefixes: ["EX-4", "EX-10", "EX-99"],
      labelPatterns: [/plan|equity|incentive|stock option|employee|award|registration rights/i],
      maxDocuments: 4,
    },
    {
      id: "legal-consent-opinion",
      reason: "Legal opinions and consents can confirm registered security classes.",
      typePrefixes: ["EX-5", "EX-23"],
      maxDocuments: 2,
    },
  ],
} satisfies SecFormFetchPlan;
