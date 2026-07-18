import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_CURRENT_REPORT_FORMS } from "../common/forms";

export const sec8k6kFetchPlan = {
  room: "8k-6k",
  forms: SEC_CURRENT_REPORT_FORMS,
  defaultAttachmentLimit: 8,
  notes: [
    "Current reports often put the market-moving detail in EX-99 press releases or EX-10 agreements.",
    "Item 4.01 filings may require EX-16 auditor letters to verify whether the former auditor agrees or disagrees with the registrant's disclosure.",
    "The form module owns these document priorities; the shared SEC executor only performs HTTP fetch and raw persistence.",
  ],
  rules: [
    {
      id: "press-release-or-operating-update",
      reason: "EX-99 often contains earnings releases, operating updates, FDA updates, or transaction announcements.",
      typePrefixes: ["EX-99"],
      labelPatterns: [/press release|presentation|investor|shareholder letter|results|earnings|clinical|fda/i],
      maxDocuments: 4,
    },
    {
      id: "material-agreements",
      reason: "EX-10 and EX-2 documents often contain material agreement or transaction terms.",
      typePrefixes: ["EX-10", "EX-2"],
      maxDocuments: 3,
    },
    {
      id: "security-governance-exhibits",
      reason: "EX-3, EX-4, and EX-5 can contain governance, security, or capital-structure details.",
      typePrefixes: ["EX-3", "EX-4", "EX-5"],
      maxDocuments: 2,
    },
    {
      id: "auditor-letters",
      reason: "EX-16 contains the former auditor's agreement, qualification, or disagreement with an Item 4.01 disclosure.",
      typePrefixes: ["EX-16"],
      labelPatterns: [/auditor|accountant|former independent registered public accounting firm/i],
      maxDocuments: 2,
    },
  ],
} satisfies SecFormFetchPlan;
