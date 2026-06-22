import type { SecFormFetchPlan } from "../common/fetchPlan";

export const secOwnershipFetchPlan = {
  room: "ownership",
  forms: ["4", "4/A", "144", "144/A"],
  defaultAttachmentLimit: 4,
  notes: [
    "Ownership forms must preserve canonical ownership XML or Form 144 XML, not just cleaned XSL-rendered text.",
    "The form module may decide deterministic archive versus compact analysis; it must not send full XML to LLM by default.",
  ],
  rules: [
    {
      id: "canonical-ownership-xml",
      reason: "Form 4 and Form 144 transaction rows are most reliable in canonical XML.",
      filenamePatterns: [/\.xml(?:$|[?#])/i],
      labelPatterns: [/ownershipDocument|edgarSubmission|FORM 4|FORM 144/i],
      maxDocuments: 3,
      preserveRawText: true,
    },
    {
      id: "ownership-explanatory-exhibit",
      reason: "Rare ownership amendments may include explanatory exhibits or remarks.",
      typePrefixes: ["EX-99"],
      maxDocuments: 1,
    },
  ],
} satisfies SecFormFetchPlan;
