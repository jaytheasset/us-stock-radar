import type { SecFormFetchPlan } from "../common/fetchPlan";

export const sec8k6kFetchPlan = {
  room: "8k-6k",
  forms: ["8-K", "8-K/A", "6-K", "6-K/A"],
  defaultAttachmentLimit: 8,
  notes: [
    "Current reports often put the market-moving detail in EX-99 press releases or EX-10 agreements.",
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
  ],
} satisfies SecFormFetchPlan;
