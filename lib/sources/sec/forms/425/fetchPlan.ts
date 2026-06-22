import type { SecFormFetchPlan } from "../common/fetchPlan";

export const sec425FetchPlan = {
  room: "425",
  forms: ["425"],
  defaultAttachmentLimit: 8,
  notes: [
    "Form 425 often puts the real transaction communication in EX-99 press releases, investor presentations, FAQs, or transcripts.",
    "The parser should know when important attachment text was listed but not fetched.",
  ],
  rules: [
    {
      id: "transaction-communications",
      reason: "EX-99 communications often contain merger, vote, consideration, timing, or deal-risk details.",
      typePrefixes: ["EX-99"],
      labelPatterns: [
        /\b(?:press release|presentation|investor|faq|transcript|communication|solicitation)\b/i,
        /\b(?:shareholder|stockholder|employee|investor|customer)\s+letter\b/i,
        /\bletter\s+to\s+(?:shareholders|stockholders|employees|customers)\b/i,
      ],
      maxDocuments: 5,
    },
    {
      id: "deal-agreement-reference",
      reason: "Agreement exhibits can clarify parties, consideration, and conditions when the communication is thin.",
      typePrefixes: ["EX-2", "EX-10"],
      maxDocuments: 2,
    },
  ],
} satisfies SecFormFetchPlan;
