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
  nasdaq_corporate_actions: "Nasdaq Corporate Actions",
  nasdaq_trader: "Nasdaq Trader",
  polygon: "Polygon",
};

export function resolveLiveFeedSource(
  sourceName?: string | null,
  sourceCode?: string | null,
) {
  const displayName = String(sourceName || "").trim();
  if (displayName) return displayName;

  const code = String(sourceCode || "").trim();
  return knownSourceNames[code.toLowerCase()] || code || "Unknown";
}
