import type { SecFormFetchPlan } from "../common/fetchPlan";

export const secPeriodicReportsFetchPlan = {
  room: "periodic-reports",
  forms: ["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"],
  defaultAttachmentLimit: 8,
  notes: [
    "Periodic reports need primary HTML plus machine-readable XBRL/XML when available.",
    "The parser should warn when XBRL or financial-statement attachments are missing from the fetched package.",
  ],
  rules: [
    {
      id: "xbrl-instance-and-ex101",
      reason: "Financial statement facts and iXBRL instance data can be more reliable than narrative text.",
      typePrefixes: ["EX-101"],
      labelPatterns: [/INSTANCE DOCUMENT|_htm\.xml\b|\.xml(?:$|[?#])/i],
      filenamePatterns: [/_htm\.xml\b|\.xml(?:$|[?#])/i],
      maxDocuments: 4,
      preserveRawText: true,
    },
    {
      id: "earnings-or-investor-exhibits",
      reason: "Some issuers attach earnings releases or investor materials alongside the periodic report.",
      typePrefixes: ["EX-99"],
      labelPatterns: [/earnings|results|presentation|investor|shareholder/i],
      maxDocuments: 2,
    },
    {
      id: "material-contracts-and-risk-exhibits",
      reason: "Material agreements can change liquidity, debt, covenant, or legal-risk interpretation.",
      typePrefixes: ["EX-10", "EX-2"],
      maxDocuments: 2,
    },
  ],
} satisfies SecFormFetchPlan;
