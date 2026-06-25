import type { SecFormFetchPlan } from "../common/fetchPlan";

export const secS1F1FetchPlan = {
  room: "s1-f1",
  forms: ["S-1", "F-1", "S-1/A", "F-1/A", "S-1MEF", "F-1MEF", "POS AM"],
  defaultAttachmentLimit: 10,
  notes: [
    "Registration statements need fee tables, prospectus text, selling-holder context, and key legal/consent exhibits.",
    "Offering/dilution scoring depends on preserving share, warrant, unit, resale, and use-of-proceeds terms.",
  ],
  rules: [
    {
      id: "filing-fee-table",
      reason: "Fee table documents can contain security type, share count, and maximum aggregate offering price.",
      typePrefixes: ["EX-FILING FEES", "EX-107"],
      labelPatterns: [/FILING FEE|FEE TABLE|EX-107|EX107|107/i],
      maxDocuments: 2,
      preserveRawText: true,
    },
    {
      id: "legal-consent-opinion",
      reason: "EX-5, EX-8, and EX-23 may clarify securities, jurisdiction, and registration scope.",
      typePrefixes: ["EX-5", "EX-8", "EX-23"],
      maxDocuments: 3,
    },
    {
      id: "material-agreement-or-selling-holder-context",
      reason: "EX-10 and EX-99 can contain agreements, lockups, selling-holder details, or offering communications.",
      typePrefixes: ["EX-10", "EX-99"],
      maxDocuments: 4,
    },
  ],
} satisfies SecFormFetchPlan;
