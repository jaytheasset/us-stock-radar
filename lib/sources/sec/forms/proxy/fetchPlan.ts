import type { SecFormFetchPlan } from "../common/fetchPlan";

export const secProxyFetchPlan = {
  room: "proxy",
  forms: ["DEF 14A", "PRE 14A", "DEFA14A", "DEFM14A", "PREM14A", "DEFC14A", "PREC14A", "SC 14D9", "SC 14D9/A"],
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
