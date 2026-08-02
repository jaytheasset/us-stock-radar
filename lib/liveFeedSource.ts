const knownSourceNames: Record<string, string> = {
  accesswire: "Accesswire",
  sec_edgar: "SEC",
  globe: "GlobeNewswire",
  globenewswire: "GlobeNewswire",
  businesswire: "Business Wire",
  prnewswire: "PR Newswire",
  newsfile: "Newsfile",
  ofac: "OFAC",
  doj: "DOJ",
  dea: "DEA",
  whitehouse: "White House",
  "white-house": "White House",
  fmp: "FMP",
  nasdaq_corporate_actions: "Nasdaq Trader",
  nasdaq_trader: "Nasdaq Trader",
  polygon: "Polygon",
};

export function resolveLiveFeedSource(
  sourceName?: string | null,
  sourceCode?: string | null,
) {
  const code = String(sourceCode || "").trim();
  const knownName = knownSourceNames[code.toLowerCase()];
  if (knownName && code.toLowerCase() === "nasdaq_corporate_actions") {
    return knownName;
  }

  const displayName = String(sourceName || "").trim();
  if (displayName) return displayName;

  return knownName || code || "Unknown";
}
