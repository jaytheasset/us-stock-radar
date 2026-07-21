import {
  filingUiFamilies,
  type FilingUiFamilyId,
} from "@/lib/development/filingUiRegistry";

export type FilingUiConsoleFamily = {
  id: string;
  label: string;
  description: string;
};

const FAMILY_ID_MAP: Readonly<Record<FilingUiFamilyId, string>> = {
  generic: "generic",
  "listing-financial-risk": "listing-financial-risk",
  "financing-dilution-capital-structure": "financing-dilution",
  "strategic-transaction": "strategic-transaction",
  "governance-vote-leadership": "governance-vote",
  "operating-legal-routine": "operating-legal",
  "offering-registration": "offering-registration",
  "periodic-reports": "periodic",
  "form-25": "form-25",
  "form-425": "form-425",
  proxy: "proxy",
  ownership: "ownership",
  tender: "tender",
  nt: "nt",
  s8: "s8",
};

export const filingUiConsoleFamilies: readonly FilingUiConsoleFamily[] =
  filingUiFamilies.map((family) => ({
    description: familyDescription(family.id),
    id: FAMILY_ID_MAP[family.id],
    label: family.label,
  }));

function familyDescription(family: FilingUiFamilyId) {
  const descriptions: Record<FilingUiFamilyId, string> = {
    generic: "Fallback filing analysis layout.",
    "listing-financial-risk": "Delisting, bankruptcy, liquidity, and restatement status layouts.",
    "financing-dilution-capital-structure": "Capital financing, security terms, and overhang layouts.",
    "strategic-transaction": "Merger, acquisition, tender closing, and transaction status layouts.",
    "governance-vote-leadership": "Auditor, board, executive, and shareholder vote layouts.",
    "operating-legal-routine": "Earnings, operating metrics, regulatory, and legal update layouts.",
    "offering-registration": "424B, S-1/F-1, S-3/F-3, and related offering layouts.",
    "periodic-reports": "10-K, 10-Q, 20-F, and amendment layouts.",
    "form-25": "Delisting lifecycle and security-removal layouts.",
    "form-425": "Transaction communication and procedural update layouts.",
    proxy: "Proxy vote, governance, and meeting layouts.",
    ownership: "Forms 3, 4, 5, 13D/G, and 144 layouts.",
    tender: "Tender offer and going-private transaction layouts.",
    nt: "Late periodic filing and expected-results layouts.",
    s8: "Equity compensation registration layouts.",
  };

  return descriptions[family];
}
