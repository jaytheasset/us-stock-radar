import type { CompanyEvent } from "./types.ts";

const companyNames: Record<string, { exchange: string; name: string }> = {
  AAPL: { exchange: "NASDAQ", name: "Apple Inc." },
  AMZN: { exchange: "NASDAQ", name: "Amazon.com, Inc." },
  META: { exchange: "NASDAQ", name: "Meta Platforms, Inc." },
  MSFT: { exchange: "NASDAQ", name: "Microsoft Corporation" },
  NVDA: { exchange: "NASDAQ", name: "NVIDIA Corporation" },
  TSLA: { exchange: "NASDAQ", name: "Tesla, Inc." },
};

export function getMockCompanyIdentity(ticker: string) {
  return (
    companyNames[ticker] ?? {
      exchange: "U.S. equity",
      name: `${ticker} company`,
    }
  );
}

export function getMockCompanyEvents(ticker: string): CompanyEvent[] {
  return [
    {
      detailHref: null,
      eventId: `mock-${ticker}-news-latest`,
      kind: "news",
      occurredAt: "2026-07-27T12:28:00.000Z",
      score: 71,
      signal: "bullish",
      source: "Company Newswire",
      title: `${ticker} outlines its latest operating priorities`,
    },
    {
      detailHref: null,
      eventId: `mock-${ticker}-filing`,
      kind: "filing",
      occurredAt: "2026-07-25T20:12:00.000Z",
      score: 48,
      signal: "neutral",
      source: "SEC",
      title: `${ticker} files an 8-K with a business update`,
    },
    {
      detailHref: null,
      eventId: `mock-${ticker}-news-older`,
      kind: "news",
      occurredAt: "2026-07-23T13:45:00.000Z",
      score: -36,
      signal: "volatile",
      source: "Market Wire",
      title: `Investors weigh new demand signals for ${ticker}`,
    },
  ];
}

export function createMockCompanyUpdate(
  ticker: string,
  sequence: number,
): CompanyEvent {
  return {
    detailHref: null,
    eventId: `mock-${ticker}-new-${Date.now()}-${sequence}`,
    kind: sequence % 2 === 0 ? "filing" : "news",
    occurredAt: new Date().toISOString(),
    score: sequence % 2 === 0 ? -58 : 82,
    signal: sequence % 2 === 0 ? "bearish" : "bullish",
    source: sequence % 2 === 0 ? "SEC" : "Company Newswire",
    title:
      sequence % 2 === 0
        ? `${ticker} posts a new material filing`
        : `${ticker} releases a new company update`,
  };
}
