import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_NT_FORMS } from "../common/forms";

export const secNtFetchPlan = {
  room: "nt",
  forms: SEC_NT_FORMS,
  defaultAttachmentLimit: 4,
  notes: [
    "Late-filing notices usually depend on the primary notice text and any attached explanatory exhibit.",
    "The parser should not infer missing reasons when the notice omits them.",
  ],
  rules: [
    {
      id: "explanatory-exhibit",
      reason: "EX-99 or similar exhibits can contain the late-filing reason or expected filing timing.",
      typePrefixes: ["EX-99"],
      labelPatterns: [/late|delay|notice|explanation|12b-25/i],
      maxDocuments: 2,
    },
    {
      id: "xml-or-structured-notice",
      reason: "Some notices expose structured fields in XML-like source.",
      filenamePatterns: [/\.xml(?:$|[?#])/i],
      maxDocuments: 1,
      preserveRawText: true,
    },
  ],
} satisfies SecFormFetchPlan;
