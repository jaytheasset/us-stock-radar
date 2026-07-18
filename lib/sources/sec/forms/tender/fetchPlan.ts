import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_TENDER_FORMS } from "../common/forms";

export const secTenderFetchPlan = {
  room: "tender",
  forms: SEC_TENDER_FORMS,
  defaultAttachmentLimit: 12,
  notes: [
    "Tender, CB, and 13E3 filings depend heavily on offer documents, transmittal letters, fairness materials, financing, and amendment exhibits.",
    "Parser output should report missing key offer documents instead of guessing.",
  ],
  rules: [
    {
      id: "offer-document-and-transmittal",
      reason: "Offer documents and transmittal materials contain price, deadline, withdrawal, proration, and conditions.",
      typePrefixes: ["EX-99", "EX-10"],
      labelPatterns: [/offer to purchase|letter of transmittal|withdrawal|proration|expiration|tender|exchange offer/i],
      maxDocuments: 5,
    },
    {
      id: "going-private-or-fairness-material",
      reason: "13E3 cases need fairness, recommendation, financing, and minority-holder risk materials.",
      typePrefixes: ["EX-99", "EX-2"],
      labelPatterns: [/fairness|going private|recommendation|financing|merger agreement|support agreement/i],
      maxDocuments: 5,
    },
    {
      id: "cross-border-home-jurisdiction",
      reason: "CB filings may point to foreign offer documents or home-jurisdiction disclosure.",
      labelPatterns: [/cross-border|home jurisdiction|foreign|canadian|uk|australian|scheme/i],
      maxDocuments: 2,
    },
  ],
} satisfies SecFormFetchPlan;
