import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_S3_F3_FORMS } from "../common/forms";

export const secS3F3FetchPlan = {
  room: "s3-f3",
  forms: SEC_S3_F3_FORMS,
  defaultAttachmentLimit: 10,
  notes: [
    "Shelf, resale, ATM, and mixed offering analysis depends on fee tables, prospectus supplement text, and selling-holder terms.",
    "This plan keeps F-3/F-3ASR/F-3MEF in the same operational fetch family as S-3/S-3ASR/S-3MEF.",
  ],
  rules: [
    {
      id: "filing-fee-table",
      reason: "Fee table documents can contain maximum offering amount and security mix.",
      typePrefixes: ["EX-FILING FEES", "EX-107"],
      labelPatterns: [/FILING FEE|FEE TABLE|EX-107|EX107|107/i],
      maxDocuments: 2,
      preserveRawText: true,
    },
    {
      id: "prospectus-supplement-or-resale-context",
      reason: "Prospectus supplements and resale exhibits can drive dilution/offering scoring.",
      typePrefixes: ["EX-99", "EX-10"],
      labelPatterns: [/prospectus|supplement|selling stockholder|selling shareholder|resale|atm|sales agreement/i],
      maxDocuments: 4,
    },
    {
      id: "legal-consent-opinion",
      reason: "EX-5 and EX-23 often identify registered securities and filing scope.",
      typePrefixes: ["EX-5", "EX-23"],
      maxDocuments: 2,
    },
  ],
} satisfies SecFormFetchPlan;
