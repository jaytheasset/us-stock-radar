import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APPLICATION_NAME,
  DEFAULT_SHARE_IMAGE_PATH,
  PUBLIC_SITEMAP_ROUTES,
  ROBOTS_DISALLOWED_PATHS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  buildManifest,
  buildRobots,
  buildRootMetadata,
  buildSitemap,
} from "./seo.ts";
import {
  buildAnalysisMetadata,
  buildSeoTitle,
  hasMeaningfulAnalysisPayload,
  isIndexableAnalysisDocument,
  type AnalysisSeoDocument,
} from "./analysisSeo.ts";
import {
  getCanonicalAnalysisPath,
  shouldUseCompactFilingArchiveRoute,
} from "./analysisRoutes.ts";
import {
  buildDynamicSitemapEntries,
  buildSitemapWithDynamicLoader,
  collectPaginatedRows,
} from "./seoSitemapCore.ts";

test("root metadata uses the canonical production origin and shared brand defaults", () => {
  const metadata = buildRootMetadata(false);
  const title = metadata.title as { default: string; template: string };
  const openGraph = metadata.openGraph as {
    description: string;
    images: Array<{ height: number; url: string; width: number }>;
    siteName: string;
    title: string;
    type: string;
  };
  const twitter = metadata.twitter as {
    card: string;
    description: string;
    images: string[];
    title: string;
  };

  assert.equal(metadata.metadataBase?.toString(), `${SITE_ORIGIN}/`);
  assert.deepEqual(title, {
    default: APPLICATION_NAME,
    template: `%s | ${SITE_NAME}`,
  });
  assert.equal(metadata.description, SITE_DESCRIPTION);
  assert.equal(metadata.applicationName, APPLICATION_NAME);
  assert.equal(metadata.creator, SITE_NAME);
  assert.equal(metadata.publisher, SITE_NAME);
  assert.equal(metadata.manifest, "/manifest.webmanifest");
  assert.equal(openGraph.type, "website");
  assert.equal(openGraph.siteName, SITE_NAME);
  assert.equal(openGraph.title, APPLICATION_NAME);
  assert.equal(openGraph.description, SITE_DESCRIPTION);
  assert.deepEqual(openGraph.images[0], {
    alt: "US Stock Radar market intelligence dashboard",
    height: 630,
    url: DEFAULT_SHARE_IMAGE_PATH,
    width: 1200,
  });
  assert.deepEqual(twitter, {
    card: "summary_large_image",
    description: SITE_DESCRIPTION,
    images: [DEFAULT_SHARE_IMAGE_PATH],
    title: APPLICATION_NAME,
  });
  assert.deepEqual(metadata.robots, { follow: true, index: true });
});

test("prelaunch metadata and robots retain complete search blocking", () => {
  assert.deepEqual(buildRootMetadata(true).robots, {
    follow: false,
    index: false,
    nocache: true,
    googleBot: {
      follow: false,
      index: false,
      noimageindex: true,
    },
  });
  assert.deepEqual(buildRobots(true), {
    rules: { disallow: "/", userAgent: "*" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  });
});

test("launch robots allow public pages while excluding private and operational paths", () => {
  const robots = buildRobots(false);
  assert.deepEqual(robots, {
    rules: {
      allow: "/",
      disallow: [...ROBOTS_DISALLOWED_PATHS],
      userAgent: "*",
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  });

  for (const path of [
    "/admin",
    "/account",
    "/api",
    "/auth",
    "/alerts",
    "/watchlist",
    "/saved",
    "/messages",
    "/proofs",
    "/development",
  ]) {
    assert.ok((ROBOTS_DISALLOWED_PATHS as readonly string[]).includes(path), path);
  }
});

test("sitemap contains only stable public route indexes on the official origin", () => {
  const sitemap = buildSitemap();
  assert.equal(sitemap.length, PUBLIC_SITEMAP_ROUTES.length);
  assert.deepEqual(
    sitemap.map((entry) => entry.url),
    PUBLIC_SITEMAP_ROUTES.map((entry) => `${SITE_ORIGIN}${entry.path}`),
  );

  const urls = sitemap.map((entry) => new URL(entry.url).pathname);
  assert.equal(urls.includes("/"), false, "redirecting root must not be listed");
  for (const pathname of urls) {
    assert.doesNotMatch(pathname, /\[[^\]]+\]|\/admin|\/account|\/api|\/auth|\/alerts|\/watchlist|\/saved|\/messages|\/proofs|\/development/);
  }
});

test("web manifest uses the SR icon and existing product color tokens", () => {
  assert.deepEqual(buildManifest(), {
    name: APPLICATION_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/dashboard-v2",
    display: "standalone",
    background_color: "#080a0d",
    theme_color: "#080a0d",
    icons: [
      {
        purpose: "any",
        sizes: "any",
        src: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
  });

  const icon = readProjectFile("app/icon.svg");
  assert.match(icon, /<text[^>]*>SR<\/text>/);
  assert.match(icon, /#0d1014/);
  assert.match(icon, /#ff7a1a/);
});

test("generated share and Apple images keep their required dimensions", () => {
  const openGraphImage = readProjectFile("app/opengraph-image.tsx");
  const appleIcon = readProjectFile("app/apple-icon.tsx");
  assert.match(openGraphImage, /width: 1200, height: 630/);
  assert.match(openGraphImage, /us-stock-radar\.com/);
  assert.match(appleIcon, /width: 180, height: 180/);
});

test("personal, admin, auth, and development pages retain explicit noindex metadata", () => {
  for (const path of [
    "app/account/page.tsx",
    "app/account/brokerage/page.tsx",
    "app/account/creator/page.tsx",
    "app/account/messages/page.tsx",
    "app/account/update-password/page.tsx",
    "app/admin/layout.tsx",
    "app/alerts/page.tsx",
    "app/auth/callback/page.tsx",
    "app/community/page.tsx",
    "app/development/layout.tsx",
    "app/forgot-password/page.tsx",
    "app/login/page.tsx",
    "app/messages/[conversationId]/page.tsx",
    "app/proofs/[proofId]/page.tsx",
    "app/saved/page.tsx",
    "app/signup/page.tsx",
    "app/watchlist/page.tsx",
  ]) {
    assert.match(
      readProjectFile(path),
      /robots:\s*\{[\s\S]{0,240}index:\s*false/,
      path,
    );
  }
});

test("real analysis metadata uses the stored headline, plain description, canonical apex, and article timestamps", () => {
  const document: AnalysisSeoDocument = {
    brief: "<p>Acme signed a multi-year supply agreement &amp; raised its delivery target.</p>",
    hasStoredAnalysis: true,
    id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
    kind: "news",
    modifiedAt: "2026-08-02T19:25:27.646Z",
    publishedAt: "2026-07-31T21:00:00.000Z",
    sourceCode: "newsfile",
    sourceName: "Newsfile",
    summary: "Fallback summary",
    ticker: "ACME",
    title: "Acme expands contracted deliveries | Stock Radar",
  };
  const metadata = buildAnalysisMetadata(
    document,
    "/news/4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
  );
  const openGraph = metadata.openGraph as {
    description: string;
    modifiedTime: string;
    publishedTime: string;
    title: string;
    type: string;
    url: string;
  };
  const twitter = metadata.twitter as {
    description: string;
    title: string;
  };

  assert.equal(metadata.title, "Acme expands contracted deliveries");
  assert.equal(
    metadata.description,
    "Acme signed a multi-year supply agreement & raised its delivery target.",
  );
  assert.deepEqual(metadata.alternates, {
    canonical: `${SITE_ORIGIN}/news/${document.id}`,
  });
  assert.equal(openGraph.type, "article");
  assert.equal(openGraph.title, "Acme expands contracted deliveries");
  assert.equal(openGraph.description, metadata.description);
  assert.equal(openGraph.url, `${SITE_ORIGIN}/news/${document.id}`);
  assert.equal(openGraph.publishedTime, "2026-07-31T21:00:00.000Z");
  assert.equal(openGraph.modifiedTime, "2026-08-02T19:25:27.646Z");
  assert.equal(twitter.title, "Acme expands contracted deliveries");
  assert.equal(twitter.description, metadata.description);
  assert.equal(openGraph.title.includes("Newsfile"), false, "provider must not replace the stored headline");
  assert.deepEqual(metadata.robots, { follow: true, index: true });
});

test("analysis indexing depends on completeness and visibility, never score", () => {
  const complete: AnalysisSeoDocument = {
    brief: "A complete saved analysis with enough public context for search.",
    hasStoredAnalysis: true,
    id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd2",
    kind: "filing",
    publishedAt: "2026-07-31T21:30:06.000Z",
    sourceCode: "sec_edgar",
    sourceName: "SEC EDGAR",
    ticker: "SKK",
    title: "SKK Holdings updates its at-the-market program",
  };

  assert.equal(isIndexableAnalysisDocument({ ...complete, score: 1 } as AnalysisSeoDocument), true);
  assert.equal(isIndexableAnalysisDocument({ ...complete, score: 99 } as AnalysisSeoDocument), true);
  assert.equal(isIndexableAnalysisDocument({ ...complete, fixture: true }), false);
  assert.equal(isIndexableAnalysisDocument({ ...complete, metadata: { is_qa: true } }), false);
  assert.equal(isIndexableAnalysisDocument({ ...complete, metadata: { visibility: "private" } }), false);
  assert.equal(isIndexableAnalysisDocument({ ...complete, hasStoredAnalysis: false }), false);
  assert.equal(isIndexableAnalysisDocument({ ...complete, ticker: "N/A" }), false);
  assert.equal(isIndexableAnalysisDocument({ ...complete, brief: "", summary: "" }), false);
});

test("analysis completeness requires substantive saved analysis, not metadata alone", () => {
  assert.equal(hasMeaningfulAnalysisPayload({ metadata: { runtime_source: "llm" } }), false);
  assert.equal(
    hasMeaningfulAnalysisPayload({
      key_evidence: ["The stored filing includes a material operating update."],
      metadata: { runtime_source: "llm" },
    }),
    true,
  );
});

test("analysis titles remove duplicate branding and clip on a readable boundary", () => {
  const title = buildSeoTitle(
    `${"Material operating update ".repeat(8)}| Stock Radar`,
  );
  assert.equal(title.endsWith("…"), true);
  assert.equal(title.includes("Stock Radar"), false);
  assert.ok(title.length <= 110);
});

test("canonical analysis routes preserve archives and compact filing policy", () => {
  const id = "4b51454b-c7ca-4bc9-96a5-3a55390acdd3";
  assert.equal(
    getCanonicalAnalysisPath({ deliveryLevel: "feed", id, sourceGroup: "news" }),
    `/news/${id}`,
  );
  assert.equal(
    getCanonicalAnalysisPath({ deliveryLevel: "archive", id, sourceGroup: "news" }),
    `/news/archive/${id}`,
  );
  assert.equal(
    shouldUseCompactFilingArchiveRoute("archive", { analysis_runtime_source: "llm" }),
    false,
  );
  assert.equal(
    shouldUseCompactFilingArchiveRoute("archive", { analysis_runtime_source: "parser_deterministic" }),
    true,
  );
  assert.equal(
    getCanonicalAnalysisPath({
      deliveryLevel: "archive",
      id,
      metadata: { archive_route: "common_filing_detail" },
      sourceGroup: "filings",
    }),
    `/filings/${id}`,
  );
});

test("dynamic sitemap includes only complete public analysis and active named tickers with DB timestamps", () => {
  const eventId = "4b51454b-c7ca-4bc9-96a5-3a55390acdd4";
  const qaId = "4b51454b-c7ca-4bc9-96a5-3a55390acdd5";
  const entries = buildDynamicSitemapEntries({
    analyses: [
      {
        analysis_scope: "event",
        event_id: eventId,
        updated_at: "2026-08-02T19:21:42.872Z",
      },
      {
        analysis_scope: "event",
        event_id: qaId,
        updated_at: "2026-08-02T19:21:42.900Z",
      },
    ],
    events: [
      {
        delivery_level: "archive",
        detected_at: "2026-08-02T19:21:42.862Z",
        id: eventId,
        published_at: "2026-08-02T17:15:00.000Z",
        quick_take: "A complete low-score archive analysis remains searchable.",
        score: 4,
        source_code: "newsfile",
        source_group: "news",
        source_name: "Newsfile",
        ticker: "VIA",
        title: "VIA files a public operating update",
      },
      {
        delivery_level: "feed",
        detected_at: "2026-08-02T19:21:42.862Z",
        id: qaId,
        metadata: { is_test: true },
        published_at: "2026-08-02T17:15:00.000Z",
        quick_take: "Test content must stay out of search.",
        source_code: "qa_fixture",
        source_group: "news",
        ticker: "QA",
        title: "[QA] fixture event",
      },
    ],
    tickers: [
      {
        asset_type: "stock",
        is_active: true,
        name: "NVIDIA Corporation",
        symbol: "NVDA",
        updated_at: "2026-08-01T11:51:33.139Z",
      },
      {
        asset_type: "stock",
        is_active: false,
        name: "Inactive Corp",
        symbol: "OLD",
        updated_at: "2026-08-01T11:51:33.139Z",
      },
    ],
  });

  assert.deepEqual(entries.map((entry) => entry.url), [
    `${SITE_ORIGIN}/news/archive/${eventId}`,
    `${SITE_ORIGIN}/stocks/NVDA`,
  ]);
  assert.equal(entries[0]?.lastModified, "2026-08-02T19:21:42.872Z");
  assert.equal(entries[1]?.lastModified, "2026-08-01T11:51:33.139Z");
});

test("sitemap keeps all static URLs when the database read fails", async () => {
  const sitemap = await buildSitemapWithDynamicLoader(async () => {
    throw new Error("database unavailable");
  });
  assert.deepEqual(sitemap, buildSitemap());
  assert.match(readProjectFile("app/sitemap.ts"), /dynamic\s*=\s*"force-dynamic"/);
  assert.match(readProjectFile("lib/seoSitemap.ts"), /unstable_cache[\s\S]*revalidate:\s*900/);
});

test("sitemap pagination reads beyond the Data API row cap and respects the URL limit", async () => {
  const source = Array.from({ length: 7 }, (_, index) => `row-${index}`);
  const requests: Array<{ limit: number; offset: number }> = [];
  const rows = await collectPaginatedRows(
    async (offset, limit) => {
      requests.push({ limit, offset });
      return source.slice(offset, offset + limit);
    },
    { maxRows: 5, pageSize: 2 },
  );

  assert.deepEqual(rows, source.slice(0, 5));
  assert.deepEqual(requests, [
    { limit: 2, offset: 0 },
    { limit: 2, offset: 2 },
    { limit: 1, offset: 4 },
  ]);
});

test("legacy news URLs permanently redirect while public news producers use canonical routes", () => {
  assert.match(readProjectFile("app/events/[id]/page.tsx"), /permanentRedirect\(canonicalPath\)/);
  assert.match(readProjectFile("components/news-v2/NewsV2Row.tsx"), /getCanonicalAnalysisPath/);
  assert.match(readProjectFile("lib/saved/server.ts"), /getCanonicalAnalysisPath/);
  assert.match(readProjectFile("lib/telegram/telegramAlertMessage.ts"), /`\/news\/\$\{encodeURIComponent\(event\.id\)\}`/);
  assert.match(readProjectFile("app/news/[id]/page.tsx"), /buildAnalysisMetadata\(detail\.seo, canonicalPath\)/);
});

function readProjectFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
