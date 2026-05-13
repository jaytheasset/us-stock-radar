import { getServerEnv } from "@/lib/env";

export type SourceJob = {
  source: string;
  label: string;
  jobRoute: string;
  sourceUrls: Array<{
    label: string;
    url: string;
    primary?: boolean;
  }>;
};

export const sourceJobs: SourceJob[] = [
  {
    source: "globe",
    label: "GlobeNewswire",
    jobRoute: "/jobs/globe",
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
    jobRoute: "/jobs/businesswire",
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
    jobRoute: "/jobs/prnewswire",
    sourceUrls: [
      {
        label: "PR Newswire RSS",
        primary: true,
        url: "https://www.prnewswire.com/rss/news-releases-list.rss",
      },
    ],
  },
  {
    source: "newsfile",
    label: "Newsfile",
    jobRoute: "/jobs/newsfile",
    sourceUrls: [
      {
        label: "Newsfile Last 25 Stories",
        primary: true,
        url: "https://feeds.newsfilecorp.com/global/Last25Stories",
      },
    ],
  },
  {
    source: "ofac",
    label: "OFAC",
    jobRoute: "/jobs/ofac",
    sourceUrls: [
      {
        label: "Treasury OFAC press releases",
        primary: true,
        url: "https://home.treasury.gov/news/press-releases",
      },
    ],
  },
  {
    source: "doj",
    label: "DOJ",
    jobRoute: "/jobs/doj",
    sourceUrls: [
      {
        label: "DOJ press release API",
        primary: true,
        url: "https://www.justice.gov/api/v1/press_releases.json",
      },
    ],
  },
  {
    source: "dea",
    label: "DEA",
    jobRoute: "/jobs/dea",
    sourceUrls: [
      {
        label: "DEA press releases filtered",
        primary: true,
        url: "https://www.dea.gov/press-releases?f%5B0%5D=press_divisions%3A36",
      },
      {
        label: "DEA alternate filtered path",
        url: "https://www.dea.gov/what-we-do/news/press-releases?f%5B0%5D=press_divisions%3A36",
      },
      {
        label: "DEA press releases fallback",
        url: "https://www.dea.gov/press-releases",
      },
    ],
  },
  {
    source: "whitehouse",
    label: "White House",
    jobRoute: "/jobs/whitehouse",
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

export async function runSourceJob(source: string, body: unknown) {
  const env = getServerEnv();
  const job = getSourceJob(source);

  if (!job) {
    return {
      ok: false,
      status: 404,
      error: `Unknown source job: ${source}`,
    };
  }

  if (!env.appBaseUrl) {
    return {
      ok: false,
      status: 0,
      error: "APP_BASE_URL is missing",
    };
  }

  const url = `${env.appBaseUrl.replace(/\/$/, "")}${job.jobRoute}`;
  const safeBody =
    body && typeof body === "object" && !Array.isArray(body)
      ? { skipTelegram: true, includePreview: true, dryRun: true, ...body }
      : { skipTelegram: true, includePreview: true, dryRun: true };

  try {
    const response = await timedFetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(safeBody),
    });
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
    const response = await timedFetch(item.url, {
      headers: {
        Accept: "application/rss+xml, application/json, text/html, */*",
        "User-Agent": "US-Stock-Radar/0.1 source-health-check",
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

async function timedFetch(input: string | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

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
