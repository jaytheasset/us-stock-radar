import type { SecFormFetchPlan } from "../common/fetchPlan";

export const secOtherFetchPlan = {
  room: "other",
  forms: ["OTHER"],
  defaultAttachmentLimit: 4,
  notes: [
    "Fallback SEC filings should preserve primary text and a small set of high-signal exhibits only.",
    "If a recurring form becomes important, move it out of Other into its own form room instead of expanding this indefinitely.",
  ],
  rules: [
    {
      id: "high-signal-generic-exhibits",
      reason: "EX-99, EX-10, and EX-2 are the generic high-signal fallback attachments.",
      typePrefixes: ["EX-99", "EX-10", "EX-2"],
      maxDocuments: 3,
    },
  ],
} satisfies SecFormFetchPlan;
