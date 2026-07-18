import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_FORM25_FORMS } from "../common/forms";

export const secForm25FetchPlan = {
  room: "form25",
  forms: SEC_FORM25_FORMS,
  defaultAttachmentLimit: 5,
  notes: [
    "Form 25/25-NSE analysis needs the security class, exchange, removal reason, and whether common equity is affected.",
    "Reason exhibits are critical; if the index lists one but text is missing, parser should warn.",
  ],
  rules: [
    {
      id: "delisting-reason-exhibit",
      reason: "EX-99 or similar exhibits often contain the actual exchange delisting/removal reason.",
      typePrefixes: ["EX-99"],
      labelPatterns: [/reason|removal|delisting|withdrawal|exchange|listing|notice/i],
      maxDocuments: 3,
    },
    {
      id: "structured-form25-source",
      reason: "Structured source can preserve rule provisions, file number, and effective dates.",
      filenamePatterns: [/\.xml(?:$|[?#])|\.txt(?:$|[?#])/i],
      maxDocuments: 1,
      preserveRawText: true,
    },
  ],
} satisfies SecFormFetchPlan;
