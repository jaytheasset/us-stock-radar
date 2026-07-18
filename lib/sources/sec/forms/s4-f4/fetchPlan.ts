import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_S4_F4_FORMS } from "../common/forms";

export const secS4F4FetchPlan = {
  room: "s4-f4",
  forms: SEC_S4_F4_FORMS,
  defaultAttachmentLimit: 12,
  notes: [
    "S-4/F-4 filings need registration/proxy text plus merger agreement, exchange ratio, vote, fairness, and fee-table materials.",
    "This room owns fetch priorities; common ingest owns HTTP execution, raw persistence, DB writes, and alerts.",
  ],
  rules: [
    {
      id: "merger-or-exchange-agreement",
      reason: "EX-2 and agreement exhibits can contain consideration, conditions, termination, and vote requirements.",
      typePrefixes: ["EX-2", "EX-10"],
      labelPatterns: [/agreement|merger|business combination|exchange offer|support|voting/i],
      maxDocuments: 4,
    },
    {
      id: "transaction-communication",
      reason: "EX-99 presentations or press releases can summarize deal rationale, timing, and shareholder impact.",
      typePrefixes: ["EX-99"],
      labelPatterns: [/presentation|press release|investor|shareholder|faq|communication/i],
      maxDocuments: 4,
    },
    {
      id: "fee-opinion-consent",
      reason: "Fee tables, legal opinions, tax opinions, and consents help validate registered securities.",
      typePrefixes: ["EX-FILING FEES", "EX-107", "EX-5", "EX-8", "EX-23"],
      labelPatterns: [/FILING FEE|FEE TABLE|EX-107|tax opinion|legal opinion|consent/i],
      maxDocuments: 4,
      preserveRawText: true,
    },
  ],
} satisfies SecFormFetchPlan;
