import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_SC13_FORMS } from "../common/forms";

export const secSc13FetchPlan = {
  room: "sc13",
  forms: SEC_SC13_FORMS,
  defaultAttachmentLimit: 5,
  notes: [
    "SC 13D/13G parser should preserve issuer, reporting person, ownership percentage, Item 4 intent, and amendment context.",
    "Activist letters, agreements, or presentations are often attached rather than fully repeated in the schedule body.",
  ],
  rules: [
    {
      id: "activist-or-ownership-exhibits",
      reason: "EX-99 and agreement exhibits can contain activist intent, group agreements, or transaction plans.",
      typePrefixes: ["EX-99", "EX-10", "EX-2"],
      labelPatterns: [/letter|agreement|joint filing|presentation|intent|plan|purpose/i],
      maxDocuments: 4,
    },
  ],
} satisfies SecFormFetchPlan;
