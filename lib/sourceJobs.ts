import { getServerEnv } from "@/lib/env";
import type { SourceIngestCronLane } from "@/lib/sourceWorkflowConfig";

export type SourceJob = {
  source: string;
  label: string;
  jobRoute: string;
  workflowLane?: SourceIngestCronLane;
  sourceUrls: Array<{
    label: string;
    url: string;
    primary?: boolean;
  }>;
};

export const sourceJobs: SourceJob[] = [
  {
    source: "sec_edgar",
    label: "SEC EDGAR",
    jobRoute: "/api/sources/sec/ingest",
    workflowLane: "sec",
    sourceUrls: [
      {
        label: "SEC EDGAR current filings Atom feed",
        primary: true,
        url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&owner=include&start=0&count=10&output=atom",
      },
    ],
  },
  {
    source: "globe",
    label: "GlobeNewswire",
    jobRoute: "/api/sources/globe/ingest",
    workflowLane: "news_fast",
    sourceUrls: [
      {
        label: "GlobeNewswire exchange search",
        primary: true,
        url: "https://www.globenewswire.com/en/search/exchange/AMEX,Nasdaq,NYSE,OTC%2520Markets,Pink%2520Sheets,Other%2520OTC?pageSize=50",
      },
    ],
  },
  {
    source: "businesswire",
    label: "Business Wire",
    jobRoute: "/api/sources/businesswire/ingest",
    workflowLane: "news_fast",
    sourceUrls: [
      businessWireFeed("Earnings News", "G1QFDERJXkJeEF9YXA==", true),
      businessWireFeed("IPO News", "G1QFDERJXkJeEF9YXQ=="),
      businessWireFeed("Merger/Acquisition News", "G1QFDERJXkJeEFtRWA=="),
      businessWireFeed("Funding News", "G1QFDERJXkJeEFtRXw=="),
      businessWireFeed("Share Issue News", "G1QFDERJXkJeGVtWXA=="),
      businessWireFeed("Stock Split News", "G1QFDERJXkJeGVtWXg=="),
      businessWireFeed("Stock Sale/Buyback News", "G1QFDERJXkJeGVtWXw=="),
      businessWireFeed("Product & Service News", "G1QFDERJXkJeEFtRWw=="),
      businessWireFeed("Contract/Agreements News", "G1QFDERJXkJeEF5XWA=="),
      businessWireFeed("Dividend News", "G1QFDERJXkJeEF9ZVA=="),
      businessWireFeed("Divestiture News", "G1QFDERJXkJeGVtWXQ=="),
      businessWireFeed("Bankruptcy News", "G1QFDERJXkJeEFtRXQ=="),
      businessWireFeed("Clinical Trials", "G1QFDERJXkJeGFNXXw=="),
      businessWireFeed("SPAC", "G1QFDERJXkJaF1hWXw=="),
      businessWireFeed("Automotive News", "G1QFDERJXkJeEVlZXw=="),
      businessWireFeed("Energy News", "G1QFDERJXkJeEFpQXw=="),
      businessWireFeed("Defense News", "G1QFDERJXkJeGVpZWQ=="),
      businessWireFeed("Health News", "G1QFDERJXkJeEVlZWA=="),
      businessWireFeed("Natural Resources News", "G1QFDERJXkJeEFpQWA=="),
    ],
  },
  {
    source: "prnewswire",
    label: "PR Newswire",
    jobRoute: "/api/sources/prnewswire/ingest",
    workflowLane: "news_fast",
    sourceUrls: [
      prNewswireFeed("Earnings", "financial-services-latest-news/earnings-list.rss", true),
      prNewswireFeed("Dividends", "financial-services-latest-news/dividends-list.rss"),
      prNewswireFeed("Conference Call Announcements", "financial-services-latest-news/conference-call-announcements-list.rss"),
      prNewswireFeed("Acquisitions, Mergers and Takeovers", "financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss"),
      prNewswireFeed("Stock Offering", "financial-services-latest-news/stock-offering-list.rss"),
      prNewswireFeed("Stock Split", "financial-services-latest-news/stock-split-list.rss"),
      prNewswireFeed("Business Technology", "business-technology-latest-news/business-technology-list.rss"),
      prNewswireFeed("Consumer Technology", "consumer-technology-latest-news/consumer-technology-latest-news-list.rss"),
      prNewswireFeed("Energy", "energy-latest-news/energy-latest-news-list.rss"),
      prNewswireFeed("Environment", "environment-latest-news/environment-latest-news-list.rss"),
      prNewswireFeed("Health", "health-latest-news/health-latest-news-list.rss"),
      prNewswireFeed("Heavy Industry & Manufacturing", "heavy-industry-manufacturing-latest-news/heavy-industry-manufacturing-latest-news-list.rss"),
      prNewswireFeed("Policy & Public Interest", "policy-public-interest-latest-news/policy-public-interest-latest-news-list.rss"),
      prNewswireFeed("Telecommunications", "telecommunications-latest-news/telecommunications-latest-news-list.rss"),
      prNewswireFeed("Travel", "travel-latest-news/travel-latest-news-list.rss"),
    ],
  },
  {
    source: "newsfile",
    label: "Newsfile",
    jobRoute: "/api/sources/newsfile/ingest",
    workflowLane: "news_fast",
    sourceUrls: [
      {
        label: "Newsfile Last 25 Stories",
        primary: true,
        url: "https://feeds.newsfilecorp.com/global/Last25Stories",
      },
    ],
  },
  {
    source: "accesswire",
    label: "Access Newswire",
    jobRoute: "/api/sources/accesswire/ingest",
    workflowLane: "news_fast",
    sourceUrls: [
      {
        label: "Access Newswire public newsroom",
        primary: true,
        url: "https://www.accessnewswire.com/newsroom",
      },
      {
        label: "Access Newswire newsroom API used by public newsroom pages",
        url: "https://www.accessnewswire.com/newsroom/api",
      },
    ],
  },
  {
    source: "ofac",
    label: "OFAC",
    jobRoute: "/api/sources/ofac/ingest",
    workflowLane: "news_slow",
    sourceUrls: [
      {
        label: "OFAC recent actions",
        primary: true,
        url: "https://ofac.treasury.gov/recent-actions",
      },
    ],
  },
  {
    source: "doj",
    label: "DOJ",
    jobRoute: "/api/sources/doj/ingest",
    workflowLane: "news_slow",
    sourceUrls: [
      {
        label: "DOJ press release API",
        primary: true,
        url: "https://www.justice.gov/api/v1/press_releases.json?pagesize=20&sort=date&direction=DESC",
      },
    ],
  },
  {
    source: "dea",
    label: "DEA",
    jobRoute: "/api/sources/dea/ingest",
    workflowLane: "news_slow",
    sourceUrls: [
      {
        label: "DOJ press release API filtered client-side for DEA component",
        primary: true,
        url: "https://www.justice.gov/api/v1/press_releases.json?pagesize=50&sort=date&direction=DESC",
      },
      {
        label: "DEA public press releases page",
        url: "https://www.dea.gov/press-releases",
      },
    ],
  },
  {
    source: "whitehouse",
    label: "White House",
    jobRoute: "/api/sources/whitehouse/ingest",
    workflowLane: "news_slow",
    sourceUrls: [
      {
        label: "Presidential actions",
        primary: true,
        url: "https://www.whitehouse.gov/briefing-room/presidential-actions/",
      },
      {
        label: "Fact sheets",
        url: "https://www.whitehouse.gov/fact-sheets/",
      },
      {
        label: "Releases",
        url: "https://www.whitehouse.gov/releases/",
      },
    ],
  },
  {
    source: "fda",
    label: "FDA",
    jobRoute: "/api/sources/fda/ingest",
    workflowLane: "news_slow",
    sourceUrls: [
      {
        label: "FDA press releases RSS",
        primary: true,
        url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
      },
      {
        label: "FDA What's New: Drugs RSS",
        url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml",
      },
      {
        label: "FDA What's New: Vaccines, Blood, and Biologics RSS",
        url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/biologics/rss.xml",
      },
      {
        label: "FDA MedWatch Safety Alerts RSS",
        url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/medwatch/rss.xml",
      },
    ],
  },
  {
    source: "nasdaq_trader",
    label: "Nasdaq Trader",
    jobRoute: "/api/sources/nasdaq-trader/ingest",
    workflowLane: "news_fast",
    sourceUrls: [
      {
        label: "Nasdaq Trader trade halts RSS",
        primary: true,
        url: "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts",
      },
      {
        label: "Nasdaq Trader trade halt code definitions",
        url: "https://classic.nasdaqtrader.com/Trader.aspx?id=tradehaltcodes",
      },
    ],
  },
  {
    source: "nasdaq_corporate_actions",
    label: "Nasdaq Corporate Actions",
    jobRoute: "/api/sources/nasdaq-corporate-actions/ingest",
    workflowLane: "news_fast",
    sourceUrls: [
      {
        label: "Nasdaq Trader current headlines corporate actions feed",
        primary: true,
        url: "https://www.nasdaqtrader.com/rss.aspx?feed=currentheadlines&categorylist=0",
      },
    ],
  },
];

type UrlProbeResult = {
  label: string;
  url: string;
  ok: boolean;
  status: number;
  contentType?: string;
  error?: string;
};

function businessWireFeed(label: string, rss: string, primary = false) {
  return {
    label,
    primary,
    url: `https://feed.businesswire.com/rss/home/?rss=${encodeURIComponent(rss)}`,
  };
}

function prNewswireFeed(label: string, path: string, primary = false) {
  return {
    label,
    primary,
    url: `https://www.prnewswire.com/rss/${path}`,
  };
}

export function getSourceJob(source: string) {
  return sourceJobs.find((job) => job.source === source);
}

export function getSourceJobRegistry() {
  const env = getServerEnv();
  const appBaseUrl = env.appBaseUrl.replace(/\/$/, "");

  return sourceJobs.map((job) => ({
    ...job,
    jobUrl: appBaseUrl ? `${appBaseUrl}${job.jobRoute}` : null,
  }));
}

export async function probeSourceJobs(full = false) {
  const registry = getSourceJobRegistry();

  return Promise.all(
    registry.map(async (job) => {
      const urls = full
        ? job.sourceUrls
        : job.sourceUrls.filter((item) => item.primary).slice(0, 1);
      const probes = await Promise.all(urls.map((item) => probeSourceUrl(item)));
      const okCount = probes.filter((probe) => probe.ok).length;

      return {
        source: job.source,
        label: job.label,
        jobRoute: job.jobRoute,
        jobUrl: job.jobUrl,
        ok: probes.length > 0 && okCount > 0,
        checkedUrls: probes.length,
        totalUrls: job.sourceUrls.length,
        okUrls: okCount,
        probes,
      };
    }),
  );
}

export async function runSourceJob(
  source: string,
  body: unknown,
  options: { baseUrlOverride?: string } = {},
) {
  const env = getServerEnv();
  const job = getSourceJob(source);

  if (!job) {
    return {
      ok: false,
      status: 404,
      error: `Unknown source job: ${source}`,
    };
  }

  const baseUrl = options.baseUrlOverride || env.appBaseUrl;

  if (!baseUrl) {
    return {
      ok: false,
      status: 0,
      error: "APP_BASE_URL is missing",
    };
  }

  const url = `${baseUrl.replace(/\/$/, "")}${job.jobRoute}`;
  const safeBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? { skipTelegram: true, includePreview: true, dryRun: true, ...body }
      : { skipTelegram: true, includePreview: true, dryRun: true };

  try {
    const response = await timedFetch(
      url,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(safeBody),
      },
      Boolean(job.workflowLane)
        ? 120000
        : undefined,
    );
    const data = await response.json().catch(() => null);

    return {
      ok: response.ok,
      status: response.status,
      source,
      jobRoute: job.jobRoute,
      data,
      error: response.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      source,
      jobRoute: job.jobRoute,
      error: error instanceof Error ? error.message : "Source job request failed",
    };
  }
}

async function probeSourceUrl(item: { label: string; url: string }): Promise<UrlProbeResult> {
  try {
    const env = getServerEnv();
    const userAgent = item.url.includes("sec.gov") && env.secUserAgent
      ? env.secUserAgent
      : "US-Stock-Radar/0.1 source-health-check";
    const response = await timedFetch(item.url, {
      headers: {
        Accept: "application/rss+xml, application/json, text/html, */*",
        "User-Agent": userAgent,
      },
    });

    return {
      label: item.label,
      url: item.url,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type") || undefined,
      error: response.ok ? undefined : response.statusText,
    };
  } catch (error) {
    return {
      label: item.label,
      url: item.url,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Source URL request failed",
    };
  }
}

async function timedFetch(input: string | URL, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function readError(data: unknown, fallback: string) {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (typeof data === "object" && "message" in data) {
    return String((data as { message?: unknown }).message || fallback);
  }
  if (typeof data === "object" && "error" in data) {
    return String((data as { error?: unknown }).error || fallback);
  }
  return fallback;
}
