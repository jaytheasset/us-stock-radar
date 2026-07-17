import type { SecFormFetchPlan } from "../common/fetchPlan.ts";
import { PERIODIC_REPORTS_PARSER_GROUP, SUPPORTED_PERIODIC_REPORT_FORMS } from "./types.ts";

export const secPeriodicReportsFetchPlan = {
  room: PERIODIC_REPORTS_PARSER_GROUP,
  forms: [...SUPPORTED_PERIODIC_REPORT_FORMS],
  defaultAttachmentLimit: 8,
  notes: [
    "Periodic reports need primary HTML plus machine-readable XBRL/XML when available.",
    "The parser should warn when XBRL or financial-statement attachments are missing from the fetched package.",
  ],
  rules: [
    {
      id: "foreign-issuer-annual-report-exhibit",
      reason: "Some Form 20-F issuers place the audited annual report and inline XBRL statements in Exhibit 15.1 instead of the primary filing body.",
      typePrefixes: ["EX-15"],
      labelPatterns: [/annual report|financial statements|EX-15\.1/i],
      filenamePatterns: [/annual|financial|(?:^|[-_.])d2\.(?:htm|html)$/i],
      maxDocuments: 1,
      preserveRawText: true,
    },
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
