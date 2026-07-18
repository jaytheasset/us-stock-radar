import type { SecFormFetchPlan } from "../common/fetchPlan";
import { SEC_PROXY_FORMS } from "../common/forms";

export const secProxyFetchPlan = {
  room: "proxy",
  forms: SEC_PROXY_FORMS,
  defaultAttachmentLimit: 8,
  notes: [
    "Proxy analysis needs proposal text, vote dates, recommendations, transaction terms, and supplemental soliciting materials.",
    "Do not create UI from this room; report candidate special UI needs in the final handoff.",
  ],
  rules: [
    {
      id: "supplemental-proxy-material",
      reason: "DEFA/proxy supplements and EX-99 can change vote, deal, governance, or compensation interpretation.",
      typePrefixes: ["EX-99"],
      labelPatterns: [/proxy|supplement|presentation|letter|soliciting|vote|meeting|recommendation/i],
      maxDocuments: 4,
    },
    {
      id: "transaction-or-plan-exhibits",
      reason: "Proxy filings can include merger, compensation, or equity-plan documents.",
      typePrefixes: ["EX-2", "EX-10"],
      maxDocuments: 3,
    },
  ],
} satisfies SecFormFetchPlan;
